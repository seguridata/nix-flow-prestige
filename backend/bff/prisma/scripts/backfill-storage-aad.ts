/** Dry-run por defecto. --apply copia, verifica y cambia referencias con CAS; jamás borra originales. */
import { PrismaClient, Prisma, type DocumentTemplate, type OnboardingCase } from '@prisma/client';
import { StorageService } from '../../src/storage/storage.service';
import { type EncMeta } from '../../src/storage/object-crypto';
import { migrateStorageObject, needsStorageMigration, type MigrationObject } from '../../src/storage/storage-migration';

const prisma = new PrismaClient();
const storage = new StorageService();
const apply = process.argv.includes('--apply');
let pending = 0;
let migrated = 0;

async function migrate(ref: MigrationObject, save: (key: string, enc: Prisma.InputJsonValue) => Promise<number>) {
  if (!needsStorageMigration(ref)) return;
  pending++;
  if (!apply) return;
  const stored = await migrateStorageObject(storage, ref);
  const count = await save(stored.objectKey, stored.enc as unknown as Prisma.InputJsonValue);
  if (count !== 1) throw new Error('Referencia modificada concurrentemente; no se reemplazó');
  migrated++;
}

async function main() {
  if (process.env.STORAGE_REQUIRE_TENANT_AAD === 'true') throw new Error('Ejecutar antes de activar STORAGE_REQUIRE_TENANT_AAD');
  // Lecturas paginadas: no carga PDFs ni todo el catálogo en memoria.
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.document.findMany({ take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) {
      if (Boolean(row.presentedObjectKey) !== Boolean(row.presentedEnc)) throw new Error(`Documento ${row.id}: referencia de ceremonia incompleta`);
      await migrate({ key: row.objectKey, enc: row.enc as unknown as EncMeta, hash: row.hash, tenantId: row.tenantId, prefix: 'documents' },
        async (objectKey, enc) => (await prisma.document.updateMany({ where: { id: row.id, tenantId: row.tenantId, objectKey: row.objectKey, hash: row.hash, enc: { equals: row.enc as Prisma.InputJsonValue } }, data: { objectKey, enc } })).count);
      if (row.presentedObjectKey && row.presentedEnc) {
        await migrate({ key: row.presentedObjectKey, enc: row.presentedEnc as unknown as EncMeta, hash: row.presentedHash || '', tenantId: row.tenantId, prefix: 'presented' },
          async (presentedObjectKey, presentedEnc) => (await prisma.document.updateMany({ where: { id: row.id, tenantId: row.tenantId, presentedObjectKey: row.presentedObjectKey, presentedHash: row.presentedHash, presentedEnc: { equals: row.presentedEnc as Prisma.InputJsonValue } }, data: { presentedObjectKey, presentedEnc } })).count);
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  cursor = undefined;
  for (;;) {
    const rows: DocumentTemplate[] = await prisma.documentTemplate.findMany({ take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) {
      await migrate({ key: row.objectKey, enc: row.enc as unknown as EncMeta, hash: row.hash, tenantId: row.tenantId, prefix: 'templates' },
        async (objectKey, enc) => (await prisma.documentTemplate.updateMany({ where: { id: row.id, tenantId: row.tenantId, objectKey: row.objectKey, hash: row.hash, enc: { equals: row.enc as Prisma.InputJsonValue } }, data: { objectKey, enc } })).count);
    }
    cursor = rows[rows.length - 1].id;
  }
  cursor = undefined;
  for (;;) {
    const rows: OnboardingCase[] = await prisma.onboardingCase.findMany({ take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) {
      for (const field of ['ineFront', 'ineBack', 'selfie'] as const) {
        const original = row[field];
        if (!original) continue;
        const ref = original as unknown as { key: string; enc: EncMeta; sha256: string; size: number };
        await migrate({ key: ref.key, enc: ref.enc, hash: ref.sha256, tenantId: row.tenantId, prefix: 'onboarding' },
          async (key, enc) => (await prisma.onboardingCase.updateMany({ where: { id: row.id, tenantId: row.tenantId, [field]: { equals: original } }, data: { [field]: { ...ref, key, enc } } })).count);
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', pending, migrated, originalsRetained: true }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
