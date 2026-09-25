-- CreateTable
CREATE TABLE "ExternalLookup" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "requestedById" UUID,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "personId" UUID,
    "companyId" UUID,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalLookup_workspaceId_targetKey_createdAt_idx" ON "ExternalLookup"("workspaceId", "targetKey", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalLookup_workspaceId_createdAt_idx" ON "ExternalLookup"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExternalLookup" ADD CONSTRAINT "ExternalLookup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
