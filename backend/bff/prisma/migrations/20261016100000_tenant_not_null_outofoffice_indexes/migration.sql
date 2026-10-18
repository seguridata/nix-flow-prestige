-- Contrae tenantId a NOT NULL, aísla OutOfOffice por tenant y agrega índices de escala.
-- tenantId es el SLUG que deja TenantContextGuard (no el uuid de TenantMembership).
-- Nunca se asigna un tenant "por defecto": lo que no se puede derivar con certeza aborta la migración.

-- (1) Backfill determinista desde el padre. Idempotente: solo toca filas con tenantId NULL.
UPDATE "SignatureField" f SET "tenantId" = d."tenantId"
  FROM "Document" d WHERE f."tenantId" IS NULL AND d.id = f."documentId";
UPDATE "DocumentComment" c SET "tenantId" = d."tenantId"
  FROM "Document" d WHERE c."tenantId" IS NULL AND d.id = c."documentId";
UPDATE "HumanTask" h SET "tenantId" = r."tenantId"
  FROM "SignatureRequest" r WHERE h."tenantId" IS NULL AND r.id = h."signatureRequestId";
UPDATE "WorkflowRun" w SET "tenantId" = r."tenantId"
  FROM "SignatureRequest" r WHERE w."tenantId" IS NULL AND r.id = w."signatureRequestId";
UPDATE "ProcessWatcher" p SET "tenantId" = r."tenantId"
  FROM "SignatureRequest" r WHERE p."tenantId" IS NULL AND r.id = p."signatureRequestId";

-- La bitácora es inmutable por trigger. El tenantId NO entra al hash canónico, así que
-- rellenarlo no rompe la cadena; se deshabilita el trigger solo durante este UPDATE.
ALTER TABLE "ProcessAuditEvent" DISABLE TRIGGER "ProcessAuditEvent_immutable";
UPDATE "ProcessAuditEvent" e SET "tenantId" = COALESCE(
  (SELECT r."tenantId" FROM "SignatureRequest" r WHERE r.id = e."signatureRequestId"),
  (SELECT d."tenantId" FROM "Document" d WHERE d.id = e."documentId"),
  (SELECT o."tenantId" FROM "OnboardingCase" o WHERE o.id = e."onboardingId")
) WHERE e."tenantId" IS NULL;
-- Eventos huérfanos (su solicitud/documento/caso ya no existe): el actor con UNA sola membresía activa
-- actuó en ese tenant; y, para actores de sistema, los demás eventos de la misma solicitud/documento/caso
-- (si apuntan a un único tenant). Lo ambiguo queda NULL y la comprobación (3) aborta.
UPDATE "ProcessAuditEvent" e SET "tenantId" = (
  SELECT CASE WHEN count(DISTINCT t.slug) = 1 THEN min(t.slug) END
  FROM "TenantMembership" m JOIN "Tenant" t ON t.id = m."tenantId" WHERE m.active AND m."userId" = e."actorId"
) WHERE e."tenantId" IS NULL;
UPDATE "ProcessAuditEvent" e SET "tenantId" = (
  SELECT CASE WHEN count(DISTINCT x."tenantId") = 1 THEN min(x."tenantId") END
  FROM "ProcessAuditEvent" x WHERE x."tenantId" IS NOT NULL AND x.id <> e.id AND (
    (e."signatureRequestId" IS NOT NULL AND x."signatureRequestId" = e."signatureRequestId") OR
    (e."documentId" IS NOT NULL AND x."documentId" = e."documentId") OR
    (e."onboardingId" IS NOT NULL AND x."onboardingId" = e."onboardingId"))
) WHERE e."tenantId" IS NULL;
ALTER TABLE "ProcessAuditEvent" ENABLE TRIGGER "ProcessAuditEvent_immutable";

-- Notificaciones (UserNotification.tenantId sigue nullable): href -> documento/onboarding;
-- si no, firmante o membresía activa del usuario SOLO si apuntan a un único tenant.
-- Lo ambiguo o sin pistas queda NULL (revisión manual).
UPDATE "UserNotification" u SET "tenantId" = COALESCE(
  (SELECT d."tenantId" FROM "Document" d
     WHERE u.href ~ '^/documents/[0-9a-f-]{36}' AND d.id = substring(u.href from '^/documents/([0-9a-f-]{36})')),
  (SELECT o."tenantId" FROM "OnboardingCase" o
     WHERE u.href ~ '^/onboarding/[0-9a-f-]{36}' AND o.id = substring(u.href from '^/onboarding/([0-9a-f-]{36})')),
  (SELECT CASE WHEN count(DISTINCT r."tenantId") = 1 THEN min(r."tenantId") END
     FROM "Signer" s JOIN "SignatureRequest" r ON r.id = s."signatureRequestId" WHERE s."signerId" = u."userId"),
  (SELECT CASE WHEN count(DISTINCT t.slug) = 1 THEN min(t.slug) END
     FROM "TenantMembership" m JOIN "Tenant" t ON t.id = m."tenantId" WHERE m.active AND m."userId" = u."userId")
) WHERE u."tenantId" IS NULL;

-- (2) OutOfOffice: nueva columna, derivada de la membresía activa única del usuario.
ALTER TABLE "OutOfOffice" ADD COLUMN "tenantId" TEXT;
UPDATE "OutOfOffice" o SET "tenantId" = (
  SELECT CASE WHEN count(DISTINCT t.slug) = 1 THEN min(t.slug) END
  FROM "TenantMembership" m JOIN "Tenant" t ON t.id = m."tenantId" WHERE m.active AND m."userId" = o."userId"
);

-- (3) Comprobación previa: si queda algún NULL, se aborta sin cambiar el esquema.
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('SignatureField'), ('HumanTask'), ('WorkflowRun'), ('DocumentComment'),
    ('NotificationOutbox'), ('ProcessAuditEvent'), ('ProcessWatcher'), ('OutOfOffice')
  ) AS t(tbl) LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "tenantId" IS NULL', r.tbl) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede contraer %.tenantId: % fila(s) sin tenant determinable. Asignarlas a mano (ver prisma/scripts/backfill-tenant-ids.ts) y reintentar.', r.tbl, n;
    END IF;
  END LOOP;
END $$;

-- (4) NOT NULL.
ALTER TABLE "SignatureField" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "HumanTask" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "WorkflowRun" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "DocumentComment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "NotificationOutbox" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ProcessAuditEvent" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ProcessWatcher" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "OutOfOffice" ALTER COLUMN "tenantId" SET NOT NULL;

-- (5) OutOfOffice único por (tenantId, userId).
DROP INDEX IF EXISTS "OutOfOffice_userId_key";
CREATE UNIQUE INDEX "OutOfOffice_tenantId_userId_key" ON "OutOfOffice"("tenantId", "userId");

-- (6) Índices de escala.
CREATE INDEX "Document_tenantId_createdAt_idx" ON "Document"("tenantId", "createdAt");
CREATE INDEX "SignatureRequest_tenantId_createdAt_idx" ON "SignatureRequest"("tenantId", "createdAt");
CREATE INDEX "ProcessAuditEvent_tenantId_createdAt_idx" ON "ProcessAuditEvent"("tenantId", "createdAt");
CREATE INDEX "WorkflowRun_status_updatedAt_idx" ON "WorkflowRun"("status", "updatedAt");
