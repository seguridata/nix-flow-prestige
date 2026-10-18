-- Concepto de gasto en la matriz de responsables.
ALTER TABLE "ExpenseResponsible" ADD COLUMN "concept" TEXT;
CREATE INDEX "ExpenseResponsible_tenantId_stage_concept_idx" ON "ExpenseResponsible"("tenantId", "stage", "concept");
