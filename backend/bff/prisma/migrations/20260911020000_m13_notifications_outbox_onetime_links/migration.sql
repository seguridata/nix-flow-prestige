-- M13 — bandeja de salida de correo (outbox + DLQ) y enlaces de un solo uso.

CREATE TYPE "OutboxStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'DLQ');

CREATE TABLE "NotificationOutbox" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "toAddress" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "template" TEXT,
  "payload" JSONB,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDIENTE',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 6,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

CREATE TABLE "OneTimeLink" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'sign',
  "signatureRequestId" TEXT,
  "signerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OneTimeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OneTimeLink_tokenHash_key" ON "OneTimeLink"("tokenHash");
CREATE INDEX "OneTimeLink_signerId_idx" ON "OneTimeLink"("signerId");
CREATE INDEX "OneTimeLink_signatureRequestId_idx" ON "OneTimeLink"("signatureRequestId");
