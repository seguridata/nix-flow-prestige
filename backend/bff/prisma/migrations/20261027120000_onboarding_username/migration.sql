-- OnboardingCase: usuario de acceso generado en el alta y la cuenta de Keycloak asociada.
-- Ambas columnas son opcionales: las altas anteriores quedan sin usuario.

-- AlterTable
ALTER TABLE "OnboardingCase" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE INDEX "OnboardingCase_username_idx" ON "OnboardingCase"("username");
