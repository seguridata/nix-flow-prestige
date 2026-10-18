-- Per-tenant catalog visibility preserves definitions and immutable execution history.
CREATE TABLE "ProcessCatalogPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcessCatalogPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProcessCatalogPreference_tenantId_key_key" ON "ProcessCatalogPreference"("tenantId", "key");
CREATE INDEX "ProcessCatalogPreference_tenantId_archivedAt_idx" ON "ProcessCatalogPreference"("tenantId", "archivedAt");
