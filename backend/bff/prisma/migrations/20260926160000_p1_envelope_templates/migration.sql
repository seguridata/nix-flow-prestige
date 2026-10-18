-- P1 sprint 5: plantillas de envelope (defaults reutilizables de order/kycPolicy/métodos).
CREATE TABLE "EnvelopeTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" "SigningOrder" NOT NULL DEFAULT 'SECUENCIAL',
  "kycPolicy" "KycPolicy" NOT NULL DEFAULT 'NONE',
  "allowedMethods" "SignatureMethod"[],
  "requirePasskey" BOOLEAN NOT NULL DEFAULT false,
  "slaHours" INTEGER NOT NULL DEFAULT 72,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnvelopeTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnvelopeTemplate_tenantId_name_key" ON "EnvelopeTemplate"("tenantId", "name");
CREATE INDEX "EnvelopeTemplate_tenantId_idx" ON "EnvelopeTemplate"("tenantId");
