ALTER TABLE "HumanTask" ADD COLUMN IF NOT EXISTS "claimedBy" TEXT;
ALTER TABLE "HumanTask" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
ALTER TABLE "HumanTask" ADD COLUMN IF NOT EXISTS "outcome" TEXT;

CREATE TABLE IF NOT EXISTS "ProcessDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bpmnXml" TEXT NOT NULL,
    "dmnXml" TEXT,
    "decisionRules" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcessDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProcessDefinition_key_version_key" ON "ProcessDefinition"("key", "version");
CREATE INDEX IF NOT EXISTS "ProcessDefinition_key_idx" ON "ProcessDefinition"("key");

CREATE TABLE IF NOT EXISTS "ProcessAuditEvent" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT,
    "documentId" TEXT,
    "onboardingId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProcessAuditEvent_signatureRequestId_createdAt_idx" ON "ProcessAuditEvent"("signatureRequestId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProcessAuditEvent_documentId_createdAt_idx" ON "ProcessAuditEvent"("documentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProcessAuditEvent_onboardingId_createdAt_idx" ON "ProcessAuditEvent"("onboardingId", "createdAt");

CREATE TABLE IF NOT EXISTS "ProcessWatcher" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessWatcher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProcessWatcher_signatureRequestId_userId_key" ON "ProcessWatcher"("signatureRequestId", "userId");

DO $$ BEGIN
    CREATE TYPE "OnboardingKind" AS ENUM ('EMPLEADO', 'PROVEEDOR', 'CLIENTE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "OnboardingStatus" AS ENUM ('BORRADOR', 'DATOS', 'INE', 'PRUEBA_VIDA', 'EN_REVISION', 'HABILITADO', 'RECHAZADO');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "OnboardingCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "OnboardingKind" NOT NULL DEFAULT 'EMPLEADO',
    "status" "OnboardingStatus" NOT NULL DEFAULT 'BORRADOR',
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "curp" TEXT,
    "rfc" TEXT,
    "ineFrontBase64" TEXT,
    "ineBackBase64" TEXT,
    "ineHash" TEXT,
    "ineVerified" BOOLEAN NOT NULL DEFAULT false,
    "selfieBase64" TEXT,
    "livenessHash" TEXT,
    "livenessScore" DOUBLE PRECISION,
    "livenessOk" BOOLEAN NOT NULL DEFAULT false,
    "faceMatchOk" BOOLEAN NOT NULL DEFAULT false,
    "biometricSessionId" TEXT,
    "enabledSignerId" TEXT,
    "notes" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnboardingCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OnboardingCase_tenantId_status_idx" ON "OnboardingCase"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "OnboardingCase_email_idx" ON "OnboardingCase"("email");
