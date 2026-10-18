-- Fase B — sello de tiempo RFC 3161 por evento de firma.

CREATE TABLE "SignatureEventTimestamp" (
  "id" TEXT NOT NULL,
  "signatureRequestId" TEXT NOT NULL,
  "signerId" TEXT NOT NULL,
  "signedHash" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignatureEventTimestamp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureEventTimestamp_signatureRequestId_signerId_key"
  ON "SignatureEventTimestamp"("signatureRequestId", "signerId");
