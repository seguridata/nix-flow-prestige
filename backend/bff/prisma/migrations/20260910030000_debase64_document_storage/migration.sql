-- De-base64 del contenido de documentos: el PDF pasa a object storage cifrado
-- (envelope AES-256-GCM). La BD deja de guardar `contentBase64` y ahora exige
-- `objectKey` + `enc` (metadatos de cifrado) + `sizeBytes`.
--
-- ⚠️  En un entorno CON DATOS reales, ejecutar ANTES el backfill:
--     bunx tsx prisma/scripts/backfill-storage.ts
-- Ese script sube y cifra el contenido existente y rellena objectKey/enc/sizeBytes.
-- Las sentencias UPDATE de abajo son una red de seguridad para filas que el
-- backfill no haya cubierto; deben quedar marcadas para revisión manual.

ALTER TABLE "Document" ADD COLUMN "enc" JSONB;
ALTER TABLE "Document" ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0;

UPDATE "Document" SET "enc" = '{}'::jsonb WHERE "enc" IS NULL;
UPDATE "Document"
  SET "objectKey" = 'legacy/pendiente-de-backfill/' || "id"
  WHERE "objectKey" IS NULL;

ALTER TABLE "Document" ALTER COLUMN "enc" SET NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "objectKey" SET NOT NULL;

ALTER TABLE "Document" DROP COLUMN "contentBase64";
