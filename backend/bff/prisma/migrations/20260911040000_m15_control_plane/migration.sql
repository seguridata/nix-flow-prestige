-- M15 — control plane: tenants, membresías, políticas y catálogos.

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

CREATE TABLE "TenantMembership" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "roles" TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");
CREATE INDEX "TenantMembership_userId_idx" ON "TenantMembership"("userId");

CREATE TABLE "Policy" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Policy_tenantId_key_key" ON "Policy"("tenantId", "key");

CREATE TABLE "CatalogEntry" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "meta" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogEntry_tenantId_kind_key_key" ON "CatalogEntry"("tenantId", "kind", "key");
CREATE INDEX "CatalogEntry_tenantId_kind_idx" ON "CatalogEntry"("tenantId", "kind");

ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogEntry" ADD CONSTRAINT "CatalogEntry_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed del tenant por defecto (coincide con el claim por defecto del guard).
INSERT INTO "Tenant" ("id", "slug", "name", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'seguridata', 'SeguriData', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
