/**
 * Backfill: mueve el contenido de documentos que aún vive como `contentBase64`
 * en Postgres a object storage cifrado (envelope AES-256-GCM), y rellena
 * `objectKey` / `enc` / `sizeBytes`.
 *
 * Procedimiento en un entorno CON DATOS reales (la migración
 * `20260910030000_debase64_document_storage` es destructiva):
 *
 *   1. Desplegar el código nuevo (trae StorageService y este script) SIN aplicar
 *      todavía la migración destructiva.
 *   2. Aplicar solo la parte no destructiva a mano, o crear una migración previa
 *      que añada `enc JSONB NULL` y `sizeBytes INTEGER NOT NULL DEFAULT 0` y deje
 *      `contentBase64` en su sitio.
 *   3. Ejecutar:  bunx tsx prisma/scripts/backfill-storage.ts
 *   4. Verificar que 0 filas quedan con `contentBase64` no nulo y `objectKey`
 *      nulo.
 *   5. Aplicar la migración destructiva (enforce NOT NULL + DROP contentBase64).
 *
 * Usa SQL directo para no depender de que el cliente Prisma coincida con el
 * esquema intermedio.
 */
import { PrismaClient } from '@prisma/client';
import { StorageService } from '../../src/storage/storage.service';

const prisma = new PrismaClient();
const storage = new StorageService();

interface LegacyRow {
  id: string;
  filename: string;
  contentBase64: string | null;
}

async function main() {
  if (!storage.enabled) {
    throw new Error('S3_ENDPOINT no configurado: no hay storage al que migrar.');
  }
  const rows = await prisma.$queryRawUnsafe<LegacyRow[]>(
    `SELECT "id", "filename", "contentBase64"
       FROM "Document"
      WHERE "contentBase64" IS NOT NULL
        AND ("objectKey" IS NULL OR "objectKey" LIKE 'legacy/%')`,
  );
  console.log(`[backfill] ${rows.length} documento(s) por migrar`);

  let ok = 0;
  for (const row of rows) {
    if (!row.contentBase64) continue;
    const bytes = Buffer.from(row.contentBase64, 'base64');
    const stored = await storage.putObject({
      prefix: 'documents',
      filename: row.filename,
      bytes,
      contentType: 'application/pdf',
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "Document"
          SET "objectKey" = $1, "enc" = $2::jsonb, "sizeBytes" = $3
        WHERE "id" = $4`,
      stored.objectKey,
      JSON.stringify(stored.enc),
      stored.sizeBytes,
      row.id,
    );
    ok += 1;
    console.log(`[backfill] ${row.id} -> ${stored.objectKey} (${stored.sizeBytes} B)`);
  }
  console.log(`[backfill] listo: ${ok}/${rows.length}`);
}

main()
  .catch((err) => {
    console.error('[backfill] error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
