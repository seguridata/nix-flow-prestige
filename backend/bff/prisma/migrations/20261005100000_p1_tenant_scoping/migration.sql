-- P1 hardening: tenantId en tablas hijas para aislamiento por tenant.
-- Nullable + backfill desde el padre; el hash de la cadena de auditoría NO cambia.
ALTER TABLE "ProcessAuditEvent"   ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "NotificationOutbox"  ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "HumanTask"           ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "DocumentComment"     ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "UserNotification"    ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ProcessWatcher"      ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "WorkflowRun"         ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "SignatureField"      ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

UPDATE "HumanTask" t SET "tenantId" = r."tenantId" FROM "SignatureRequest" r WHERE t."signatureRequestId" = r."id" AND t."tenantId" IS NULL;
UPDATE "WorkflowRun" w SET "tenantId" = r."tenantId" FROM "SignatureRequest" r WHERE w."signatureRequestId" = r."id" AND w."tenantId" IS NULL;
UPDATE "ProcessWatcher" w SET "tenantId" = r."tenantId" FROM "SignatureRequest" r WHERE w."signatureRequestId" = r."id" AND w."tenantId" IS NULL;
UPDATE "SignatureField" f SET "tenantId" = d."tenantId" FROM "Document" d WHERE f."documentId" = d."id" AND f."tenantId" IS NULL;
UPDATE "DocumentComment" c SET "tenantId" = d."tenantId" FROM "Document" d WHERE c."documentId" = d."id" AND c."tenantId" IS NULL;
UPDATE "ProcessAuditEvent" e SET "tenantId" = r."tenantId" FROM "SignatureRequest" r WHERE e."signatureRequestId" = r."id" AND e."tenantId" IS NULL;
UPDATE "ProcessAuditEvent" e SET "tenantId" = d."tenantId" FROM "Document" d WHERE e."documentId" = d."id" AND e."tenantId" IS NULL;
UPDATE "ProcessAuditEvent" e SET "tenantId" = o."tenantId" FROM "OnboardingCase" o WHERE e."onboardingId" = o."id" AND e."tenantId" IS NULL;

CREATE INDEX IF NOT EXISTS "ProcessAuditEvent_tenantId_idx"  ON "ProcessAuditEvent"("tenantId");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_tenantId_idx" ON "NotificationOutbox"("tenantId");
CREATE INDEX IF NOT EXISTS "HumanTask_tenantId_idx"          ON "HumanTask"("tenantId");
CREATE INDEX IF NOT EXISTS "DocumentComment_tenantId_idx"    ON "DocumentComment"("tenantId");
CREATE INDEX IF NOT EXISTS "UserNotification_tenantId_idx"   ON "UserNotification"("tenantId");
CREATE INDEX IF NOT EXISTS "ProcessWatcher_tenantId_idx"     ON "ProcessWatcher"("tenantId");
CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_idx"        ON "WorkflowRun"("tenantId");
CREATE INDEX IF NOT EXISTS "SignatureField_tenantId_idx"     ON "SignatureField"("tenantId");
