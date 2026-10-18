-- UserNotification.tenantId pasa a NOT NULL.
-- Las filas que quedaron sin tenant (sin padre ni usuario que permita derivarlo) son avisos efimeros: por decision del
-- dueno del producto (2026-10-16) se borran en lugar de asignarlas a un tenant al azar.
DELETE FROM "UserNotification" WHERE "tenantId" IS NULL;

-- AlterTable
ALTER TABLE "UserNotification" ALTER COLUMN "tenantId" SET NOT NULL;
