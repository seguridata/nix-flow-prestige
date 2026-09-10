/**
 * M11 — encadena los `ProcessAuditEvent` previos a la migración (seq/hash NULL)
 * por orden de `createdAt`, y deja `AuditAnchor.head` en la cabeza resultante.
 * Idempotente: si no hay eventos sin encadenar, no hace nada.
 *
 *   cd backend/bff && bun prisma/scripts/backfill-audit-chain.ts
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
function body(e: {
  seq: bigint;
  signatureRequestId: string | null;
  documentId: string | null;
  onboardingId: string | null;
  actorId: string;
  actorName: string | null;
  action: string;
  payload: unknown;
  createdAt: Date;
}) {
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
const link = (prev: string, b: string) => createHash('sha256').update(`${prev}\n${b}`).digest('hex');

async function main() {
  const pending = await prisma.processAuditEvent.findMany({
    where: { OR: [{ seq: null }, { hash: null }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (pending.length === 0) {
    console.log('nada que encadenar');
    return;
  }
  const anchor = await prisma.auditAnchor.findUnique({ where: { id: 'head' } });
  let seq = anchor?.seq ?? 0n;
  let prev = anchor?.hash ?? '';

  for (const e of pending) {
    seq += 1n;
    const b = body({ ...e, seq });
    const hash = link(prev, b);
    await prisma.processAuditEvent.update({ where: { id: e.id }, data: { seq, prevHash: prev, hash } });
    prev = hash;
  }
  await prisma.auditAnchor.upsert({
    where: { id: 'head' },
    create: { id: 'head', seq, hash: prev },
    update: { seq, hash: prev },
  });
  console.log(`encadenados ${pending.length} eventos; cabeza seq=${seq}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
