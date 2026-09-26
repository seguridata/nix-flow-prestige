-- P1 sprint 3: passkeys como factor de presencia atado al hash congelado.
ALTER TYPE "SignatureMethod" ADD VALUE 'PASSKEY';

ALTER TABLE "SignatureRequest" ADD COLUMN "requirePasskey" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PasskeyCredential" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "signerId" TEXT,
  "credentialId" BYTEA NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasskeyCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasskeyCredential_credentialId_key" ON "PasskeyCredential"("credentialId");
CREATE INDEX "PasskeyCredential_tenantId_userId_idx" ON "PasskeyCredential"("tenantId", "userId");
CREATE INDEX "PasskeyCredential_tenantId_signerId_idx" ON "PasskeyCredential"("tenantId", "signerId");

CREATE TABLE "PasskeyAssertion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "signatureRequestId" TEXT NOT NULL,
  "signerId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "credentialId" BYTEA,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "PasskeyAssertion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PasskeyAssertion_sr_signer_consumed_idx"
  ON "PasskeyAssertion"("signatureRequestId", "signerId", "consumedAt");

CREATE TABLE "PasskeyRegistrationChallenge" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challenge" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PasskeyRegistrationChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PasskeyRegistrationChallenge_tenantId_userId_idx"
  ON "PasskeyRegistrationChallenge"("tenantId", "userId");
