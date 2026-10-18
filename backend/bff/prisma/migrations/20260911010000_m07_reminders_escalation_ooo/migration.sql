-- M07 — recordatorios / escalamiento / delegación sobre timers de Temporal.

-- HumanTask: prioridad de bandeja + contadores de recordatorio + marca de escalamiento + firmante original.
ALTER TABLE "HumanTask"
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "delegatedFrom" TEXT;

CREATE INDEX "HumanTask_status_priority_idx" ON "HumanTask"("status", "priority");

-- «Fuera de oficina»: delegación automática de firmas al crearse la solicitud.
CREATE TABLE "OutOfOffice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "delegateId" TEXT NOT NULL,
  "delegateName" TEXT,
  "reason" TEXT,
  "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "until" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutOfOffice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutOfOffice_userId_key" ON "OutOfOffice"("userId");
