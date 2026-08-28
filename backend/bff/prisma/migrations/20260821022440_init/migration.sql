-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('ABIERTO', 'EN_PROCESO', 'CERRADO');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('DIGITAL', 'AUTOGRAFA', 'BIOMETRICA');

-- CreateEnum
CREATE TYPE "SigningOrder" AS ENUM ('SECUENCIAL', 'PARALELO');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDIENTE', 'EN_FIRMA', 'COMPLETADA', 'RECHAZADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "SignerStatus" AS ENUM ('PENDIENTE', 'FIRMADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('FIRMANTE', 'REVISOR');

-- CreateEnum
CREATE TYPE "SignatureFieldType" AS ENUM ('SIGNATURE', 'INITIALS', 'DATE', 'TEXT');

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'ABIERTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "hash" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "contentBase64" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "methods" "SignatureMethod"[],
    "order" "SigningOrder" NOT NULL DEFAULT 'SECUENCIAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDIENTE',
    "requestedBy" TEXT,
    "requestedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signer" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "role" "SignerRole" NOT NULL DEFAULT 'FIRMANTE',
    "status" "SignerStatus" NOT NULL DEFAULT 'PENDIENTE',
    "signedAt" TIMESTAMP(3),
    "usedMethod" "SignatureMethod",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Signer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureField" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "type" "SignatureFieldType" NOT NULL,
    "page" INTEGER NOT NULL,
    "xPct" DOUBLE PRECISION NOT NULL,
    "yPct" DOUBLE PRECISION NOT NULL,
    "widthPct" DOUBLE PRECISION NOT NULL,
    "heightPct" DOUBLE PRECISION NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceManifest" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "presentedHash" TEXT NOT NULL,
    "signedHash" TEXT NOT NULL,
    "packageHash" TEXT NOT NULL,
    "signingOrder" "SigningOrder" NOT NULL,
    "chainOfCustody" JSONB NOT NULL,
    "consentRecords" JSONB NOT NULL,
    "signatures" JSONB NOT NULL,
    "timestampProvider" TEXT NOT NULL,
    "timestampIssuedAt" TIMESTAMP(3) NOT NULL,
    "timestampTokenHash" TEXT NOT NULL,
    "validationConclusion" TEXT NOT NULL,
    "validationReasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Case_tenantId_idx" ON "Case"("tenantId");

-- CreateIndex
CREATE INDEX "Document_caseId_idx" ON "Document"("caseId");

-- CreateIndex
CREATE INDEX "SignatureRequest_documentId_idx" ON "SignatureRequest"("documentId");

-- CreateIndex
CREATE INDEX "SignatureRequest_status_idx" ON "SignatureRequest"("status");

-- CreateIndex
CREATE INDEX "Signer_signerId_idx" ON "Signer"("signerId");

-- CreateIndex
CREATE UNIQUE INDEX "Signer_signatureRequestId_signerId_key" ON "Signer"("signatureRequestId", "signerId");

-- CreateIndex
CREATE INDEX "SignatureField_documentId_idx" ON "SignatureField"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceManifest_signatureRequestId_key" ON "EvidenceManifest"("signatureRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceManifest_manifestId_key" ON "EvidenceManifest"("manifestId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signer" ADD CONSTRAINT "Signer_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureField" ADD CONSTRAINT "SignatureField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceManifest" ADD CONSTRAINT "EvidenceManifest_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
