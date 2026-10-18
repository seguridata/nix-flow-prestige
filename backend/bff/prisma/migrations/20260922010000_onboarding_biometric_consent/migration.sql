-- Consentimiento expreso y por escrito (LFPDPPP) antes de capturar INE o biometría.
ALTER TABLE "OnboardingCase" ADD COLUMN "biometricConsentAt" TIMESTAMP(3);
ALTER TABLE "OnboardingCase" ADD COLUMN "biometricConsentVersion" TEXT;
ALTER TABLE "OnboardingCase" ADD COLUMN "biometricConsentTextHash" TEXT;
ALTER TABLE "OnboardingCase" ADD COLUMN "biometricConsentIp" TEXT;
ALTER TABLE "OnboardingCase" ADD COLUMN "biometricConsentUserAgent" TEXT;
ALTER TABLE "OnboardingCase" ADD COLUMN "biometricConsentActorId" TEXT;
