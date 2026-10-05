-- P1 — inmutabilidad de la bitácora encadenada + deriva de índice.

-- (a) "ProcessAuditEvent" es append-only. Ninguna ruta de la app hace UPDATE/DELETE
--     sobre ella (sólo create/findMany/count); "AuditAnchor" (la cabeza de la cadena)
--     SIGUE siendo editable: no se toca.
--     Excepción acotada: una fila heredada aún sin encadenar (seq y hash NULL) puede
--     actualizarse UNA vez para encadenarla (prisma/scripts/backfill-audit-chain.ts).
CREATE OR REPLACE FUNCTION prestige_audit_event_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."seq" IS NULL AND OLD."hash" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ProcessAuditEvent es inmutable (% no permitido)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ProcessAuditEvent_immutable" ON "ProcessAuditEvent";
CREATE TRIGGER "ProcessAuditEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ProcessAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION prestige_audit_event_immutable();

-- (b) Prisma espera el nombre canónico del @@index([signatureRequestId, signerId, consumedAt]);
--     la migración 20260926140000_p1_passkeys lo creó con un nombre corto.
ALTER INDEX IF EXISTS "PasskeyAssertion_sr_signer_consumed_idx"
  RENAME TO "PasskeyAssertion_signatureRequestId_signerId_consumedAt_idx";

-- (c) Deriva menor: el schema declara `transports String[]` sin @default; el único
--     escritor (passkey-registration.service) siempre lo informa.
ALTER TABLE "PasskeyCredential" ALTER COLUMN "transports" DROP DEFAULT;
