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
import { createHash } from 'node:crypto';
import { StorageService } from '../../src/storage/storage.service';

const prisma = new PrismaClient();
const storage = new StorageService();

interface LegacyRow {
  id: string;
  tenantId: string;
  filename: string;
  contentBase64: string | null;
  hash: string;
  objectKey: string | null;
}

async function main() {
  if (!storage.enabled) {
    throw new Error('S3_ENDPOINT no configurado: no hay storage al que migrar.');
  }
  const rows = await prisma.$queryRawUnsafe<LegacyRow[]>(
    `SELECT "id", "tenantId", "filename", "contentBase64", "hash", "objectKey"
       FROM "Document"
      WHERE "contentBase64" IS NOT NULL
        AND ("objectKey" IS NULL OR "objectKey" LIKE 'legacy/%')`,
  );
  console.log(`[backfill] ${rows.length} documento(s) por migrar`);

  let ok = 0;
  for (const row of rows) {
    if (!row.contentBase64) continue;
    if (!row.tenantId) throw new Error(`Documento ${row.id} sin tenant; resolver antes del backfill`);
    if (!process.argv.includes('--apply')) continue;
    const bytes = Buffer.from(row.contentBase64, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error(`Hash incorrecto: ${row.id}`);
    const stored = await storage.putObject({
      prefix: `documents/${row.tenantId}`,
      tenantId: row.tenantId,
      filename: row.filename,
      bytes,
      contentType: 'application/pdf',
    });
    const readback = await storage.getObject(stored.objectKey, stored.enc, row.tenantId);
    if (createHash('sha256').update(readback).digest('hex') !== row.hash) throw new Error(`Copia incorrecta: ${row.id}`);
    const count = await prisma.$executeRawUnsafe(
      `UPDATE "Document"
          SET "objectKey" = $1, "enc" = $2::jsonb, "sizeBytes" = $3
        WHERE "id" = $4 AND "tenantId" = $5 AND "hash" = $6
          AND "objectKey" IS NOT DISTINCT FROM $7 AND "contentBase64" = $8`,
      stored.objectKey,
      JSON.stringify(stored.enc),
      stored.sizeBytes,
      row.id,
      row.tenantId,
      row.hash,
      row.objectKey,
      row.contentBase64,
    );
    if (count !== 1) throw new Error(`Cambio concurrente: ${row.id}; referencia no reemplazada`);
    ok += 1;
    console.log(`[backfill] ${row.id} -> ${stored.objectKey} (${stored.sizeBytes} B)`);
  }
  console.log(`[backfill] ${process.argv.includes('--apply') ? 'aplicado' : 'dry-run; usa --apply para escribir'}: ${ok}/${rows.length}`);
}

main()
  .catch((err) => {
    console.error('[backfill] error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
