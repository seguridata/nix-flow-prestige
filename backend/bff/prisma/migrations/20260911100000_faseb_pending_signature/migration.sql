-- Fase B — firma `pending` / reconciliación (métodos asíncronos: 2FA / biometría).

ALTER TYPE "SignerStatus" ADD VALUE IF NOT EXISTS 'EN_PROCESO';

ALTER TABLE "Signer"
  ADD COLUMN "pendingRef" TEXT,
  ADD COLUMN "pendingSince" TIMESTAMP(3);

CREATE INDEX "Signer_status_pendingSince_idx" ON "Signer"("status", "pendingSince");
