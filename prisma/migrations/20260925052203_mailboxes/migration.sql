-- CreateTable
CREATE TABLE "Mailbox" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT NOT NULL,
    "encryptedPassword" TEXT,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "status" TEXT NOT NULL DEFAULT 'UNTESTED',
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "uidValidity" TEXT,
    "lastUid" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "repliesMatched" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mailbox_workspaceId_status_idx" ON "Mailbox"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_workspaceId_address_key" ON "Mailbox"("workspaceId", "address");

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
