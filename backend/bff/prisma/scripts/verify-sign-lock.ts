/**
 * Prueba REAL de concurrencia contra Postgres del bloqueo de firma.
 *
 * `SignatureRequestsService.sign()` serializa las firmas del mismo documento con
 * `SELECT "id" FROM "Document" WHERE "id" = $1 FOR UPDATE` dentro de la
 * transacción, y calcula `allSigned` releyendo a TODOS los firmantes tras su
 * propio update. Instanciar el servicio completo exige storage cifrado,
 * adaptadores PAdES, workflow, correo, etc.; aquí se reproduce EXACTAMENTE ese
 * patrón transaccional (misma consulta de bloqueo, mismo claim PENDIENTE →
 * EN_PROCESO, mismo reread + allSigned) con dos transacciones Prisma concurrentes
 * sobre una solicitud PARALELO con 2 firmantes.
 *
 * Demuestra:
 *   A) SIN el FOR UPDATE: las dos transacciones se solapan y ninguna ve la firma
 *      de la otra -> allSigned=false en ambas -> la solicitud NUNCA llega a
 *      COMPLETADA (completado perdido). Es el bug que el lock evita.
 *   B) CON el FOR UPDATE: se serializan (sin solape) y la segunda ve a la primera
 *      -> exactamente una calcula allSigned=true y la solicitud queda COMPLETADA.
 *
 * Uso (Postgres desechable con migraciones aplicadas):
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:55432/db?schema=public \
 *     RUN_PG_TESTS=1 npx tsx prisma/scripts/verify-sign-lock.ts
 * Sale con código 1 si alguna aserción falla. No corre sin RUN_PG_TESTS=1.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

if (process.env.RUN_PG_TESTS !== '1') {
  console.log('verify-sign-lock: omitido (define RUN_PG_TESTS=1 y DATABASE_URL de un Postgres desechable).');
  process.exit(0);
}

const prisma = new PrismaClient();
const WORK_MS = 600; // simula el trabajo de PAdES/storage dentro de la tx
const t0 = Date.now();
const log = (m: string) => console.log(`[+${String(Date.now() - t0).padStart(5)}ms] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fixture {
  tenantId: string;
  caseId: string;
  documentId: string;
  requestId: string;
}

async function makeFixture(label: string): Promise<Fixture> {
  const tenantId = `pgtest-${label}-${randomUUID().slice(0, 8)}`;
  const kase = await prisma.case.create({ data: { tenantId, title: `verify-sign-lock ${label}` } });
  const doc = await prisma.document.create({
    data: {
      caseId: kase.id,
      tenantId,
      filename: 'contrato.pdf',
      hash: 'a'.repeat(64),
      locked: true,
      frozenAt: new Date(),
      objectKey: `pgtest/${randomUUID()}`,
      enc: {},
    },
  });
  const req = await prisma.signatureRequest.create({
    data: {
      documentId: doc.id,
      tenantId,
      order: 'PARALELO',
      status: 'EN_FIRMA',
      methods: ['ACCEPT'],
      signers: {
        create: [
          { signerId: 'ana', name: 'Ana', sortOrder: 0 },
          { signerId: 'beto', name: 'Beto', sortOrder: 1 },
        ],
      },
    },
  });
  return { tenantId, caseId: kase.id, documentId: doc.id, requestId: req.id };
}

async function cleanup(f: Fixture) {
  await prisma.signer.deleteMany({ where: { signatureRequestId: f.requestId } });
  await prisma.signatureRequest.delete({ where: { id: f.requestId } });
  await prisma.document.delete({ where: { id: f.documentId } });
  await prisma.case.delete({ where: { id: f.caseId } });
}

interface Outcome {
  signerId: string;
  allSigned: boolean;
  enter: number;
  exit: number;
}

/** Misma forma que el bloque transaccional de `sign()`. */
/**
 * `barrier` (solo escenario A) alinea a las dos transacciones justo tras su update
 * de FIRMADO y antes del reread, para provocar el solape de forma determinista en
 * vez de depender del azar de los tiempos.
 */
async function signTx(
  f: Fixture,
  signerId: string,
  withLock: boolean,
  barrier?: () => Promise<void>,
): Promise<Outcome> {
  return prisma.$transaction(
    async (tx) => {
      if (withLock) {
        await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${f.documentId} FOR UPDATE`;
      }
      const enter = Date.now();
      log(`${signerId}: dentro de la sección crítica`);
      const request = await tx.signatureRequest.findUniqueOrThrow({
        where: { id: f.requestId },
        include: { signers: true },
      });
      const signer = request.signers.find((s) => s.signerId === signerId)!;
      const claim = await tx.signer.updateMany({
        where: { id: signer.id, status: 'PENDIENTE' },
        data: { status: 'EN_PROCESO', usedMethod: 'ACCEPT' },
      });
      if (claim.count === 0) throw new Error(`${signerId}: claim fallido`);
      await sleep(WORK_MS); // PDF presentado: leer, firmar, reescribir
      await tx.signer.update({ where: { id: signer.id }, data: { status: 'FIRMADO', signedAt: new Date() } });
      if (barrier) await barrier();
      const signersNow = await tx.signer.findMany({ where: { signatureRequestId: f.requestId } });
      const allSigned = signersNow.every((s) => s.status === 'FIRMADO');
      await tx.signatureRequest.update({
        where: { id: f.requestId },
        data: { status: allSigned ? 'COMPLETADA' : 'EN_FIRMA' },
      });
      const exit = Date.now();
      log(`${signerId}: allSigned=${allSigned}, saliendo de la tx`);
      return { signerId, allSigned, enter, exit };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

async function scenario(withLock: boolean) {
  const label = withLock ? 'con-lock' : 'sin-lock';
  console.log(`\n=== Escenario ${withLock ? 'B' : 'A'}: ${withLock ? 'CON' : 'SIN'} SELECT ... FOR UPDATE ===`);
  const f = await makeFixture(label);
  try {
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const barrier = withLock
      ? undefined
      : async () => {
          if (++arrived === 2) release();
          await gate;
        };
    const [a, b] = await Promise.all([signTx(f, 'ana', withLock, barrier), signTx(f, 'beto', withLock, barrier)]);
    const final = await prisma.signatureRequest.findUniqueOrThrow({
      where: { id: f.requestId },
      include: { signers: true },
    });
    const overlap = a.enter < b.exit && b.enter < a.exit;
    log(`estado final solicitud=${final.status}; firmantes=${final.signers.map((s) => `${s.signerId}:${s.status}`).join(',')}`);
    check(final.signers.every((s) => s.status === 'FIRMADO'), 'ambos firmantes quedaron FIRMADO');
    if (withLock) {
      check(!overlap, `las transacciones se serializaron (sin solape: ${a.signerId}[${a.enter - t0}-${a.exit - t0}] ${b.signerId}[${b.enter - t0}-${b.exit - t0}])`);
      check([a, b].filter((o) => o.allSigned).length === 1, 'exactamente una calculó allSigned=true');
      check(final.status === 'COMPLETADA', 'la solicitud quedó COMPLETADA');
    } else {
      check(overlap, 'las transacciones se solaparon (no hay exclusión mutua)');
      check(final.status !== 'COMPLETADA', 'contraste: sin lock la solicitud NO llegó a COMPLETADA (completado perdido)');
    }
  } finally {
    await cleanup(f);
  }
}

async function main() {
  const [{ reg }] = await prisma.$queryRaw<{ reg: string | null }[]>`SELECT to_regclass('public."Document"')::text AS reg`;
  console.log(`Tabla de documentos en Postgres: ${reg}`);
  check(reg === '"Document"', 'la tabla se llama "Document" (la que bloquea sign())');

  await scenario(false);
  await scenario(true);

  console.log(failures === 0 ? '\nRESULTADO: OK' : `\nRESULTADO: ${failures} aserción(es) fallaron`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
