-- Rotación de secreto de webhook con ventana de doble firma.
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "previousSecret" TEXT;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "previousSecretUntil" TIMESTAMP(3);
