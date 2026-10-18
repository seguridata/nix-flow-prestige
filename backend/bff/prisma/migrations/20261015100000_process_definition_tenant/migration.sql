-- Los flujos dejan de ser un catálogo global: cada uno pertenece a un tenant.
-- Las semillas del sistema (sin `flow`) quedan en 'platform': visibles para todos, de solo lectura para los tenants.
ALTER TABLE "ProcessDefinition" ADD COLUMN "tenantId" TEXT;

UPDATE "ProcessDefinition" SET "tenantId" = 'platform' WHERE "flow" IS NULL;

-- Flujos creados por un administrador: se atribuyen al tenant del formato que los usa y, si ninguno los usa,
-- al tenant por defecto ('seguridata'). Revisar esta atribución en bases con más de un tenant antes de desplegar.
UPDATE "ProcessDefinition" p
SET "tenantId" = COALESCE(
  (SELECT t."tenantId" FROM "DocumentTemplate" t WHERE t."flowKey" = p."key" ORDER BY t."createdAt" LIMIT 1),
  'seguridata'
)
WHERE p."flow" IS NOT NULL;

ALTER TABLE "ProcessDefinition" ALTER COLUMN "tenantId" SET NOT NULL;

DROP INDEX IF EXISTS "ProcessDefinition_key_version_key";
DROP INDEX IF EXISTS "ProcessDefinition_key_idx";
CREATE UNIQUE INDEX "ProcessDefinition_tenantId_key_version_key" ON "ProcessDefinition"("tenantId", "key", "version");
CREATE INDEX "ProcessDefinition_tenantId_key_idx" ON "ProcessDefinition"("tenantId", "key");
