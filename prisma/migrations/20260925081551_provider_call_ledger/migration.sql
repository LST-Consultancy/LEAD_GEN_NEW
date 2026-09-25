-- CreateTable
CREATE TABLE "ProviderCall" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "enrichmentRunId" UUID,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "detail" TEXT,
    "units" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderCall_workspaceId_provider_operation_targetKey_creat_idx" ON "ProviderCall"("workspaceId", "provider", "operation", "targetKey", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderCall_workspaceId_createdAt_idx" ON "ProviderCall"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCall_workspaceId_enrichmentRunId_provider_operation_key" ON "ProviderCall"("workspaceId", "enrichmentRunId", "provider", "operation", "targetKey");

-- AddForeignKey
ALTER TABLE "ProviderCall" ADD CONSTRAINT "ProviderCall_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
