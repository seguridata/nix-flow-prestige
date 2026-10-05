import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ProcessAuditEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  signatureRequestId?: string;
  documentId?: string;
  onboardingId?: string;
  actorId: string;
  actorName?: string;
  action: string;
  payload?: unknown;
  /** Tenant dueño del evento. Si se omite se deriva de la solicitud/documento/onboarding. */
  tenantId?: string;
}

/** Tope de eventos que `verify()` recalcula por llamada (anti-DoS). */
export const VERIFY_MAX_EVENTS = 5000;

export interface ChainVerification {
  mode: 'global' | 'scoped';
  ok: boolean;
  count: number;
  /** `seq` del primer evento cuya cadena no cuadra (si `ok` es false). */
  firstBreakSeq?: string;
  reason?: string;
  headSeq?: string;
  headHash?: string;
  checkedAt: string;
  /** true si había más eventos que `VERIFY_MAX_EVENTS`: sólo se verificó el primer tramo. */
  truncated?: boolean;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Cuerpo canónico e independiente del id/uuid: sólo el contenido semántico. */
function canonicalBody(e: {
  seq: bigint;
  signatureRequestId: string | null;
  documentId: string | null;
  onboardingId: string | null;
  actorId: string;
  actorName: string | null;
  action: string;
  payload: unknown;
  createdAt: Date;
}): string {
  return JSON.stringify(
    sortDeep({
      seq: e.seq.toString(),
      signatureRequestId: e.signatureRequestId,
      documentId: e.documentId,
      onboardingId: e.onboardingId,
      actorId: e.actorId,
      actorName: e.actorName,
      action: e.action,
      payload: e.payload ?? null,
      createdAt: e.createdAt.toISOString(),
    }),
  );
}

function linkHash(prevHash: string, body: string): string {
  return createHash('sha256').update(`${prevHash}\n${body}`).digest('hex');
}

/**
 * M11 — bitácora inmutable encadenada. `append()` toma la cabeza global con
 * `SELECT … FOR UPDATE` (serializa escrituras concurrentes), calcula `seq`,
 * `prevHash` y `hash`, inserta el evento y mueve la cabeza — todo en una
 * transacción. `verify()` recalcula la cadena y detecta cualquier alteración.
 */
@Injectable()
export class AuditChainService {
  private readonly log = new Logger(AuditChainService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(input: AuditInput): Promise<ProcessAuditEvent> {
    return this.prisma.$transaction(async (tx) => {
      const head = await tx.$queryRaw<{ seq: bigint; hash: string }[]>`
        SELECT "seq", "hash" FROM "AuditAnchor" WHERE "id" = 'head' FOR UPDATE`;
      const prevHash = head[0]?.hash ?? '';
      const seq = (head[0]?.seq ?? 0n) + 1n;
      const createdAt = new Date();
      const tenantId = input.tenantId ?? (await this.deriveTenant(tx, input));

      const body = canonicalBody({
        seq,
        signatureRequestId: input.signatureRequestId ?? null,
        documentId: input.documentId ?? null,
        onboardingId: input.onboardingId ?? null,
        actorId: input.actorId,
        actorName: input.actorName ?? null,
        action: input.action,
        payload: input.payload ?? null,
        createdAt,
      });
      const hash = linkHash(prevHash, body);

      const row = await tx.processAuditEvent.create({
        data: {
          seq,
          prevHash,
          hash,
          signatureRequestId: input.signatureRequestId,
          documentId: input.documentId,
          onboardingId: input.onboardingId,
          // El tenantId NO entra al hash canónico (no romper eventos ya existentes).
          tenantId,
          actorId: input.actorId,
          actorName: input.actorName,
          action: input.action,
          payload: input.payload === undefined ? undefined : (input.payload as object),
          createdAt,
        },
      });

      await tx.$executeRaw`
        UPDATE "AuditAnchor" SET "seq" = ${seq}, "hash" = ${hash}, "updatedAt" = now()
        WHERE "id" = 'head'`;

      return row;
    });
  }

  /** Deriva el tenant del recurso referenciado por el evento (best-effort). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async deriveTenant(tx: any, input: AuditInput): Promise<string | undefined> {
    try {
      if (input.signatureRequestId) {
        const r = await tx.signatureRequest?.findUnique({
          where: { id: input.signatureRequestId },
          select: { tenantId: true },
        });
        if (r?.tenantId) return r.tenantId as string;
      }
      if (input.documentId) {
        const d = await tx.document?.findUnique({
          where: { id: input.documentId },
          select: { tenantId: true },
        });
        if (d?.tenantId) return d.tenantId as string;
      }
      if (input.onboardingId) {
        const o = await tx.onboardingCase?.findUnique({
          where: { id: input.onboardingId },
          select: { tenantId: true },
        });
        if (o?.tenantId) return o.tenantId as string;
      }
    } catch (err) {
      this.log.warn(`no se pudo derivar tenant del evento: ${(err as Error).message}`);
    }
    return undefined;
  }

  /**
   * `signatureRequestId`/`onboardingId` omitidos → verificación GLOBAL (recalcula
   * toda la cadena). Con un scope → verificación SCOPED: comprueba que cada
   * evento del scope es coherente consigo mismo (`hash === H(prevHash, body)`) y
   * que los `seq` crecen; no puede recomputar el enlace inter-evento (los
   * vecinos pertenecen a otros scopes).
   */
  async verify(scope?: {
    signatureRequestId?: string;
    onboardingId?: string;
    tenantId?: string;
  }): Promise<ChainVerification> {
    // Con tenantId siempre es scoped: los vecinos de la cadena global son de otros tenants.
    const scoped = Boolean(scope?.signatureRequestId || scope?.onboardingId || scope?.tenantId);
    const rows = await this.prisma.processAuditEvent.findMany({
      where: {
        hash: { not: null },
        seq: { not: null },
        ...(scope?.signatureRequestId ? { signatureRequestId: scope.signatureRequestId } : {}),
        ...(scope?.onboardingId ? { onboardingId: scope.onboardingId } : {}),
        ...(scope?.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      orderBy: { seq: 'asc' },
      take: VERIFY_MAX_EVENTS + 1,
    });
    const truncated = rows.length > VERIFY_MAX_EVENTS;
    if (truncated) rows.pop();

    const now = new Date().toISOString();
    if (rows.length === 0) {
      return { mode: scoped ? 'scoped' : 'global', ok: true, count: 0, checkedAt: now };
    }

    let prevHash = scoped ? null : '';
    let lastSeq = -1n;
    for (const r of rows) {
      const seq = r.seq as bigint;
      const body = canonicalBody({
        seq,
        signatureRequestId: r.signatureRequestId,
        documentId: r.documentId,
        onboardingId: r.onboardingId,
        actorId: r.actorId,
        actorName: r.actorName,
        action: r.action,
        payload: r.payload,
        createdAt: r.createdAt,
      });
      const expected = linkHash(r.prevHash ?? '', body);
      if (expected !== r.hash) {
        return {
          mode: scoped ? 'scoped' : 'global',
          ok: false,
          count: rows.length,
          firstBreakSeq: seq.toString(),
          reason: 'el hash del evento no coincide con su contenido',
          checkedAt: now,
        };
      }
      if (!scoped && prevHash !== null && r.prevHash !== prevHash) {
        return {
          mode: 'global',
          ok: false,
          count: rows.length,
          firstBreakSeq: seq.toString(),
          reason: 'prevHash no enlaza con el evento anterior',
          checkedAt: now,
        };
      }
      if (seq <= lastSeq) {
        return {
          mode: scoped ? 'scoped' : 'global',
          ok: false,
          count: rows.length,
          firstBreakSeq: seq.toString(),
          reason: 'seq no es estrictamente creciente',
          checkedAt: now,
        };
      }
      lastSeq = seq;
      prevHash = r.hash;
    }

    const anchor = await this.prisma.auditAnchor.findUnique({ where: { id: 'head' } });
    return {
      mode: scoped ? 'scoped' : 'global',
      ok: true,
      count: rows.length,
      truncated: truncated || undefined,
      headSeq: anchor?.seq.toString(),
      headHash: anchor?.hash,
      checkedAt: now,
    };
  }
}
