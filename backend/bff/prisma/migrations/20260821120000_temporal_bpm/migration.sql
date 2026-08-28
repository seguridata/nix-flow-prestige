-- AlterTable
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "objectKey" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "mimeType" TEXT NOT NULL DEFAULT 'application/pdf';

-- AlterTable
ALTER TABLE "SignatureRequest" ADD COLUMN IF NOT EXISTS "slaHours" INTEGER NOT NULL DEFAULT 72;
ALTER TABLE "SignatureRequest" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "HumanTaskStatus" AS ENUM ('CREADA', 'ASIGNADA', 'COMPLETADA', 'CANCELADA', 'EXPIRADA');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "HumanTask" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "HumanTaskStatus" NOT NULL DEFAULT 'CREADA',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "workflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConsentAcceptance" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgentHash" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkflowRun" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT,
    "taskQueue" TEXT NOT NULL,
    "processKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HumanTask_signerId_status_idx" ON "HumanTask"("signerId", "status");
CREATE INDEX IF NOT EXISTS "HumanTask_signatureRequestId_idx" ON "HumanTask"("signatureRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConsentAcceptance_signatureRequestId_signerId_textVersion_key" ON "ConsentAcceptance"("signatureRequestId", "signerId", "textVersion");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowRun_signatureRequestId_key" ON "WorkflowRun"("signatureRequestId");
CREATE INDEX IF NOT EXISTS "WorkflowRun_workflowId_idx" ON "WorkflowRun"("workflowId");

ALTER TABLE "HumanTask" DROP CONSTRAINT IF EXISTS "HumanTask_signatureRequestId_fkey";
ALTER TABLE "HumanTask" ADD CONSTRAINT "HumanTask_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsentAcceptance" DROP CONSTRAINT IF EXISTS "ConsentAcceptance_signatureRequestId_fkey";
ALTER TABLE "ConsentAcceptance" ADD CONSTRAINT "ConsentAcceptance_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun" DROP CONSTRAINT IF EXISTS "WorkflowRun_signatureRequestId_fkey";
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
