import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { AuditChainService } from './audit-chain.service';
import type { PrismaService } from '../prisma/prisma.service';

interface Row {
  id: string;
  seq: bigint;
  prevHash: string | null;
  hash: string | null;
  signatureRequestId: string | null;
  documentId: string | null;
  onboardingId: string | null;
  actorId: string;
  actorName: string | null;
  action: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Fake Prisma que soporta el patrón del servicio: `$transaction(fn)` con
 * `$queryRaw`/`$executeRaw` sobre una fila-ancla en memoria + `processAuditEvent`.
 */
function fakePrisma() {
  const anchor = { seq: 0n, hash: '' };
  const rows: Row[] = [];
  const api = {
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>): Promise<T> {
      return fn(api);
    },
    async $queryRaw() {
      return [{ seq: anchor.seq, hash: anchor.hash }];
    },
    async $executeRaw(strings: TemplateStringsArray, ...vals: unknown[]) {
      // UPDATE "AuditAnchor" SET seq = ${seq}, hash = ${hash} ...
      anchor.seq = vals[0] as bigint;
      anchor.hash = vals[1] as string;
      return 1;
    },
    processAuditEvent: {
      create: async ({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `e${rows.length}`,
          seq: data.seq as bigint,
          prevHash: data.prevHash ?? null,
          hash: data.hash ?? null,
          signatureRequestId: data.signatureRequestId ?? null,
          documentId: data.documentId ?? null,
          onboardingId: data.onboardingId ?? null,
          actorId: data.actorId as string,
          actorName: data.actorName ?? null,
          action: data.action as string,
          payload: data.payload ?? null,
          createdAt: data.createdAt as Date,
        };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        let out = rows.filter((r) => r.hash !== null && r.seq !== null);
        const sr = (where?.signatureRequestId as string) ?? null;
        if (sr) out = out.filter((r) => r.signatureRequestId === sr);
        return [...out].sort((a, b) => Number(a.seq - b.seq));
      },
    },
    auditAnchor: {
      findUnique: async () => ({ id: 'head', seq: anchor.seq, hash: anchor.hash }),
    },
  };
  return { prisma: api as unknown as PrismaService, rows, anchor };
}

describe('AuditChainService (M11)', () => {
  it('encadena eventos: seq monótono, prevHash enlaza y verify global es ok', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new AuditChainService(prisma);

    await svc.append({ actorId: 'a', action: 'REQUEST_CREATED', signatureRequestId: 'r1' });
    await svc.append({ actorId: 'b', action: 'SIGNATURE_APPLIED', signatureRequestId: 'r1', payload: { m: 'DIGITAL' } });
    await svc.append({ actorId: 'system', action: 'SEALED', signatureRequestId: 'r1' });

    expect(rows.map((r) => r.seq)).toEqual([1n, 2n, 3n]);
    expect(rows[0].prevHash).toBe('');
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);

    const v = await svc.verify();
    expect(v).toMatchObject({ mode: 'global', ok: true, count: 3, headSeq: '3' });
  });

  it('detecta manipulación: alterar el payload de un evento rompe la cadena', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new AuditChainService(prisma);
    await svc.append({ actorId: 'a', action: 'X' });
    await svc.append({ actorId: 'b', action: 'Y', payload: { amount: 100 } });
    await svc.append({ actorId: 'c', action: 'Z' });

    rows[1].payload = { amount: 999999 }; // tamper

    const v = await svc.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBreakSeq).toBe('2');
  });

  it('detecta manipulación: cambiar un hash almacenado rompe el enlace', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new AuditChainService(prisma);
    await svc.append({ actorId: 'a', action: 'X' });
    await svc.append({ actorId: 'b', action: 'Y' });

    rows[0].hash = createHash('sha256').update('falso').digest('hex');

    const v = await svc.verify();
    expect(v.ok).toBe(false);
  });

  it('verify scoped comprueba la coherencia propia de cada evento del scope', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new AuditChainService(prisma);
    await svc.append({ actorId: 'a', action: 'X', signatureRequestId: 'r1' });
    await svc.append({ actorId: 'b', action: 'Y', signatureRequestId: 'r2' });
    await svc.append({ actorId: 'c', action: 'Z', signatureRequestId: 'r1' });

    const ok = await svc.verify({ signatureRequestId: 'r1' });
    expect(ok).toMatchObject({ mode: 'scoped', ok: true, count: 2 });

    rows[2].actorId = 'intruso';
    const bad = await svc.verify({ signatureRequestId: 'r1' });
    expect(bad.ok).toBe(false);
  });
});
