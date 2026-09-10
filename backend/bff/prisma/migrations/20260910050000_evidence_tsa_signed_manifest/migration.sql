-- Fase B / M10-M11: sello de tiempo RFC 3161 real + manifiesto de evidencia
-- firmado (verificable offline).

ALTER TABLE "EvidenceManifest" ADD COLUMN "timestampToken" TEXT;
ALTER TABLE "EvidenceManifest" ADD COLUMN "manifestHash" TEXT;
ALTER TABLE "EvidenceManifest" ADD COLUMN "manifestSignature" TEXT;
ALTER TABLE "EvidenceManifest" ADD COLUMN "manifestSigningKeyId" TEXT;
