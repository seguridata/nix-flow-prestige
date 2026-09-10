-- M10 — política de firma versionada.

ALTER TABLE "SignatureRequest"
  ADD COLUMN "policyVersion" INTEGER,
  ADD COLUMN "policySnapshot" JSONB;

ALTER TABLE "EvidenceManifest"
  ADD COLUMN "signaturePolicy" JSONB;
