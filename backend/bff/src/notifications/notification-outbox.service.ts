import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { finishPage, pageArgs, prismaPage } from '../common/pagination';
import { MailerService } from './mailer.service';
import { decryptObject, encryptObject, isEncMeta, type EncMeta } from '../storage/object-crypto';

/** Marcador del enlace de firma en `body`: el token real nunca se guarda en claro. */
export const LINK_PLACEHOLDER = '{{LINK}}';

/** Lease con el que una réplica «reclama» un lote (el enum no tiene EN_PROCESO). */
const LEASE_SECONDS = 300;

/** Campos que se devuelven al admin: NUNCA `payload` (lleva el enlace cifrado). */
const PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  channel: true,
  toAddress: true,
  subject: true,
  body: true,
  template: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  lastError: true,
  nextAttemptAt: true,
  sentAt: true,
  dedupeKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ClaimedRow {
  id: string;
  toAddress: string;
  subject: string;
  body: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export interface EnqueueEmail {
  to: string;
  subject: string;
  /** Si lleva enlace secreto, usa `{{LINK}}` como marcador y pásalo en `link`. */
  html: string;
  template?: string;
  payload?: Record<string, unknown>;
  /** Idempotencia: si ya existe una fila con este dedupeKey, no se vuelve a encolar. */
  dedupeKey?: string;
  /** Tenant dueño del mensaje (aislamiento del listado/reintento del admin). */
  tenantId?: string;
  /**
   * Enlace secreto (token de firma). Se guarda CIFRADO (envelope AES-GCM de
   * storage) en `payload.linkEnc` y sólo se sustituye en `{{LINK}}` al enviar.
   */
  link?: string;
}

/** Backoff exponencial acotado: 1, 2, 4, 8, 16, 30 min (attempt empieza en 1). */
function backoffMs(attempt: number): number {
  return Math.min(2 ** (attempt - 1), 30) * 60_000;
}

@Injectable()
export class NotificationOutboxService {
  private readonly log = new Logger(NotificationOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  private buildPayload(msg: EnqueueEmail): Prisma.InputJsonValue | undefined {
    const base: Record<string, unknown> = { ...(msg.payload ?? {}) };
    if (msg.link) {
      const { ciphertext, enc } = encryptObject(Buffer.from(msg.link, 'utf8'));
      base.linkEnc = { ct: ciphertext.toString('base64'), enc };
    }
    return Object.keys(base).length ? (base as Prisma.InputJsonValue) : undefined;
  }

  /** Reconstruye el HTML real (con el enlace) sólo en el momento del envío. */
  private renderBody(row: ClaimedRow): string {
    if (!row.body.includes(LINK_PLACEHOLDER)) return row.body;
    const linkEnc = (row.payload as { linkEnc?: { ct?: string; enc?: unknown } } | null)?.linkEnc;
    if (!linkEnc?.ct || !isEncMeta(linkEnc.enc)) {
      throw new Error('Mensaje con {{LINK}} sin enlace cifrado: no se envía el marcador');
    }
    const link = decryptObject(Buffer.from(linkEnc.ct, 'base64'), linkEnc.enc as EncMeta).toString('utf8');
    return row.body.split(LINK_PLACEHOLDER).join(link);
  }

  /**
   * Claim atómico: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
   * RETURNING *`. El lease (`nextAttemptAt = now() + lease`) va en el mismo
   * UPDATE, así que otra réplica no ve estas filas hasta que expire.
   */
  private claim(limit: number, tenantId?: string): Promise<ClaimedRow[]> {
    const tenantFilter = tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty;
    return this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "NotificationOutbox"
         SET "nextAttemptAt" = now() + make_interval(secs => ${LEASE_SECONDS}),
             "updatedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "NotificationOutbox"
          WHERE "status" IN ('PENDIENTE', 'FALLIDO')
            AND "nextAttemptAt" <= now()
            ${tenantFilter}
          ORDER BY "nextAttemptAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING *`);
  }

  async enqueueEmail(msg: EnqueueEmail) {
    if (!msg.to) return null;
    try {
      return await this.prisma.notificationOutbox.create({
        data: {
          channel: 'email',
          toAddress: msg.to,
          subject: msg.subject,
          body: msg.html,
          template: msg.template,
          tenantId: msg.tenantId,
          payload: this.buildPayload(msg),
          dedupeKey: msg.dedupeKey,
        },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      // Choque de dedupeKey único → ya estaba encolado, no es un error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Procesa un lote de mensajes vencidos. Devuelve el conteo por resultado.
   * `tenantId` (despacho manual del admin) limita el lote a ese tenant.
   */
  async dispatchDue(limit = 25, tenantId?: string) {
    if (!this.mailer.enabled) return { skipped: true as const, sent: 0, failed: 0, dead: 0 };

    const due = await this.claim(limit, tenantId);

    let sent = 0;
    let failed = 0;
    let dead = 0;

    for (const row of due) {
      try {
        await this.mailer.send({ to: row.toAddress, subject: row.subject, html: this.renderBody(row) });
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          // El enlace cifrado ya no hace falta una vez enviado.
          data: {
            status: 'ENVIADO',
            sentAt: new Date(),
            lastError: null,
            attempts: { increment: 1 },
            payload: Prisma.DbNull,
          },
        });
        sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        const toDlq = attempts >= row.maxAttempts;
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: toDlq ? 'DLQ' : 'FALLIDO',
            attempts,
            lastError: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          },
        });
        if (toDlq) {
          dead += 1;
          this.log.error(`Outbox ${row.id} → DLQ tras ${attempts} intentos: ${message}`);
        } else {
          failed += 1;
        }
      }
    }

    if (sent || failed || dead) this.log.log(`Outbox: ${sent} enviados, ${failed} reintentables, ${dead} a DLQ`);
    return { skipped: false as const, sent, failed, dead };
  }

  /** Listado del tenant. Nunca expone `payload` (enlace cifrado). */
  async list(params: { tenantId: string; status?: string; take?: number; limit?: number; cursor?: string }) {
    const args = pageArgs(params);
    const rows = await this.prisma.notificationOutbox.findMany({
      where: { tenantId: params.tenantId, ...(params.status ? { status: params.status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: PUBLIC_SELECT,
      // take (uso interno) solo aplica al modo array; con limit/cursor manda la paginación.
      ...(args.paged ? prismaPage(args) : { take: Math.min(params.take ?? 100, 500) }),
    });
    return finishPage(rows, args);
  }

  async retry(id: string, tenantId: string) {
    const row = await this.prisma.notificationOutbox.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(`Mensaje ${id} no encontrado`);
    return this.prisma.notificationOutbox.update({
      where: { id },
      data: { status: 'PENDIENTE', nextAttemptAt: new Date(), lastError: null },
      select: PUBLIC_SELECT,
    });
  }
}
