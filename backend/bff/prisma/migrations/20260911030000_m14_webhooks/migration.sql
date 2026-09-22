-- M14 — webhooks firmados con reintentos + DLQ.

CREATE TABLE "WebhookSubscription" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'seguridata',
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "events" TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookSubscription_tenantId_active_idx" ON "WebhookSubscription"("tenantId", "active");

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDIENTE',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "lastError" TEXT,
  "responseStatus" INTEGER,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_eventId_key" ON "WebhookDelivery"("subscriptionId", "eventId");
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
