ALTER TABLE "Signer" ADD COLUMN IF NOT EXISTS "delegatedTo" TEXT;
ALTER TABLE "Signer" ADD COLUMN IF NOT EXISTS "delegatedToName" TEXT;

CREATE TABLE IF NOT EXISTS "DocumentComment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DocumentComment_documentId_createdAt_idx" ON "DocumentComment"("documentId", "createdAt");

CREATE TABLE IF NOT EXISTS "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserNotification_userId_read_createdAt_idx" ON "UserNotification"("userId", "read", "createdAt");
