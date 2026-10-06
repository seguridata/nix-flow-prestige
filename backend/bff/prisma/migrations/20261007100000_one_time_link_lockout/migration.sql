-- Bloqueo por token del portal externo: tras N intentos fallidos el enlace
-- queda bloqueado temporalmente (429) sin consumirse.
ALTER TABLE "OneTimeLink"
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);
