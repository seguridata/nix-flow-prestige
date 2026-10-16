-- ADR-008 — Tablas de consulta, formatos digitales y anexos.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "attachmentKey" TEXT;

-- AlterTable
ALTER TABLE "DocumentTemplate" ADD COLUMN     "attachmentSpecs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PDF';

-- CreateTable
CREATE TABLE "LookupTable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookupTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookupRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookupRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookupTable_tenantId_active_idx" ON "LookupTable"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LookupTable_tenantId_key_key" ON "LookupTable"("tenantId", "key");

-- CreateIndex
CREATE INDEX "LookupRow_tenantId_tableId_active_position_idx" ON "LookupRow"("tenantId", "tableId", "active", "position");

-- CreateIndex
CREATE INDEX "Document_caseId_attachmentKey_idx" ON "Document"("caseId", "attachmentKey");

-- AddForeignKey
ALTER TABLE "LookupRow" ADD CONSTRAINT "LookupRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "LookupTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Datos: la matriz de responsables de gasto (ExpenseResponsible) pasa a ser una tabla de consulta más, una por tenant que la tenga.
-- «area = *» (cualquier área) pasa a celda vacía, que ya significa «cualquiera». Las filas más específicas van primero.
INSERT INTO "LookupTable" ("id", "tenantId", "key", "name", "description", "columns", "revision", "active", "createdBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."tenantId", 'responsables-gasto', 'Responsables de gasto',
       'Quién autoriza cada gasto según área, tipo, concepto y monto. Migrada de la matriz de responsables de gasto.',
       $json$[
         {"key":"etapa","label":"Etapa","type":"select","options":["area","tipoGasto"]},
         {"key":"area","label":"Área del solicitante","type":"text"},
         {"key":"tipoGasto","label":"Tipo de gasto","type":"text"},
         {"key":"concepto","label":"Concepto","type":"text"},
         {"key":"montoMin","label":"Monto desde","type":"number"},
         {"key":"montoMax","label":"Monto hasta","type":"number"},
         {"key":"signerId","label":"Usuario responsable","type":"text"},
         {"key":"nombre","label":"Nombre","type":"text"},
         {"key":"correo","label":"Correo","type":"text"}
       ]$json$::jsonb,
       1, true, 'migracion', now(), now()
FROM (SELECT DISTINCT "tenantId" FROM "ExpenseResponsible") t;

INSERT INTO "LookupRow" ("id", "tenantId", "tableId", "values", "position", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, e."tenantId", lt."id",
       jsonb_strip_nulls(jsonb_build_object(
         'etapa', e."stage",
         'area', NULLIF(e."area", '*'),
         'tipoGasto', e."expenseType",
         'concepto', e."concept",
         'montoMin', e."minAmount",
         'montoMax', e."maxAmount",
         'signerId', e."signerId",
         'nombre', e."name",
         'correo', e."email")),
       (ROW_NUMBER() OVER (
          PARTITION BY e."tenantId"
          ORDER BY (e."concept" IS NULL), (e."expenseType" IS NULL), (e."area" = '*'), e."stage", e."createdAt"
        ) - 1)::int,
       e."active", now(), now()
FROM "ExpenseResponsible" e
JOIN "LookupTable" lt ON lt."tenantId" = e."tenantId" AND lt."key" = 'responsables-gasto';
