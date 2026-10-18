-- M16 — OCR/MRZ de INE + puertos IdentityVerifier / BiometricEngine.

ALTER TABLE "OnboardingCase"
  ADD COLUMN "ineOcr" JSONB,
  ADD COLUMN "ineCheck" JSONB,
  ADD COLUMN "faceMatchScore" DOUBLE PRECISION,
  ADD COLUMN "biometricEngine" TEXT;
