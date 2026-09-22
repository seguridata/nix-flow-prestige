-- A-07 — tenant denormalizado en Document y SignatureRequest para aislar por
-- tenant las lecturas (sin join). Se rellena desde Case / Document.

ALTER TABLE "Document" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'seguridata';
ALTER TABLE "SignatureRequest" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'seguridata';

UPDATE "Document" d SET "tenantId" = c."tenantId"
FROM "Case" c WHERE c."id" = d."caseId";

UPDATE "SignatureRequest" sr SET "tenantId" = d."tenantId"
FROM "Document" d WHERE d."id" = sr."documentId";

CREATE INDEX "Document_tenantId_idx" ON "Document"("tenantId");
CREATE INDEX "SignatureRequest_tenantId_idx" ON "SignatureRequest"("tenantId");
