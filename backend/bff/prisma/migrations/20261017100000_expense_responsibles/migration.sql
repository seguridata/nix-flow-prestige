-- Matriz de responsables de gasto por tenant (autorización por área y por tipo de gasto).
CREATE TABLE "ExpenseResponsible" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "expenseType" TEXT,
  "stage" TEXT NOT NULL,
  "minAmount" DECIMAL(18,2),
  "maxAmount" DECIMAL(18,2),
  "signerId" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseResponsible_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExpenseResponsible_tenantId_stage_area_idx" ON "ExpenseResponsible"("tenantId", "stage", "area");
CREATE INDEX "ExpenseResponsible_tenantId_stage_expenseType_idx" ON "ExpenseResponsible"("tenantId", "stage", "expenseType");
