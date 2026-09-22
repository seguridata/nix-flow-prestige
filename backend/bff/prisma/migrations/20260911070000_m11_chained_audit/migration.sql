-- M11 — auditoría inmutable encadenada.

ALTER TABLE "ProcessAuditEvent"
  ADD COLUMN "seq" BIGINT,
  ADD COLUMN "prevHash" TEXT,
  ADD COLUMN "hash" TEXT;

CREATE UNIQUE INDEX "ProcessAuditEvent_seq_key" ON "ProcessAuditEvent"("seq");
CREATE INDEX "ProcessAuditEvent_seq_idx" ON "ProcessAuditEvent"("seq");

CREATE TABLE "AuditAnchor" (
  "id" TEXT NOT NULL,
  "seq" BIGINT NOT NULL DEFAULT 0,
  "hash" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditAnchor_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AuditAnchor" ("id", "seq", "hash", "updatedAt")
VALUES ('head', 0, '', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
