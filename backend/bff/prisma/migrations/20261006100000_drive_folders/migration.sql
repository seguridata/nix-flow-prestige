-- Vista Drive: carpetas personales y ubicación de los expedientes.
CREATE TABLE "Folder" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Folder_tenantId_ownerId_parentId_idx" ON "Folder"("tenantId", "ownerId", "parentId");
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Case" ADD COLUMN "ownerId" TEXT, ADD COLUMN "folderId" TEXT, ADD COLUMN "loose" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Case_tenantId_ownerId_folderId_idx" ON "Case"("tenantId", "ownerId", "folderId");
ALTER TABLE "Case" ADD CONSTRAINT "Case_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
