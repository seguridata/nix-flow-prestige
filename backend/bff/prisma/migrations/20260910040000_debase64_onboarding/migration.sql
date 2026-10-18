-- De-base64 de las imágenes de onboarding (INE frente/reverso y selfie de
-- prueba de vida). Pasan a object storage cifrado (envelope AES-256-GCM); la
-- BD guarda solo una referencia Json { key, sha256, size, enc }.
--
-- ⚠️  Con DATOS reales: extender prisma/scripts/backfill-storage.ts para
-- `OnboardingCase` (mismo patrón que Document) y ejecutarlo ANTES de aplicar
-- esta migración, ya que hace DROP de las columnas base64.

ALTER TABLE "OnboardingCase" ADD COLUMN "ineFront" JSONB;
ALTER TABLE "OnboardingCase" ADD COLUMN "ineBack" JSONB;
ALTER TABLE "OnboardingCase" ADD COLUMN "selfie" JSONB;

ALTER TABLE "OnboardingCase" DROP COLUMN "ineFrontBase64";
ALTER TABLE "OnboardingCase" DROP COLUMN "ineBackBase64";
ALTER TABLE "OnboardingCase" DROP COLUMN "selfieBase64";
