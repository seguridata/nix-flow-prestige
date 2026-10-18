-- Formatos con campos y flujo precargado; flujos publicables.
ALTER TABLE "ProcessDefinition" ADD COLUMN "flow" JSONB, ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE TABLE "DocumentTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "objectKey" TEXT NOT NULL,
  "enc" JSONB NOT NULL,
  "hash" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "fields" JSONB NOT NULL DEFAULT '[]',
  "signatureBoxes" JSONB NOT NULL DEFAULT '[]',
  "flow" JSONB NOT NULL,
  "flowKey" TEXT,
  "flowVersion" INTEGER,
  "methods" "SignatureMethod"[],
  "kycPolicy" "KycPolicy" NOT NULL DEFAULT 'NONE',
  "requirePasskey" BOOLEAN NOT NULL DEFAULT false,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentTemplate_tenantId_name_key" ON "DocumentTemplate"("tenantId", "name");
CREATE INDEX "DocumentTemplate_tenantId_published_idx" ON "DocumentTemplate"("tenantId", "published");
