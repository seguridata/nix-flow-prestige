-- P1 sprint 4: política de identidad exigida antes de aceptar `complete`.
CREATE TYPE "KycPolicy" AS ENUM ('NONE', 'ONCE', 'EVERY_SIGN');

ALTER TABLE "SignatureRequest" ADD COLUMN "kycPolicy" "KycPolicy" NOT NULL DEFAULT 'NONE';
