-- P1 sprint 1: el canónico se puede congelar. La copia firmada vive aparte.
ALTER TABLE "Document" ADD COLUMN "frozenAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "presentedObjectKey" TEXT;
ALTER TABLE "Document" ADD COLUMN "presentedEnc" JSONB;
ALTER TABLE "Document" ADD COLUMN "presentedHash" TEXT;

CREATE INDEX "Document_tenantId_caseId_idx" ON "Document"("tenantId", "caseId");
