-- CreateTable
CREATE TABLE "PlanTemplate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTemplate_workspaceId_deletedAt_idx" ON "PlanTemplate"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplate_workspaceId_name_version_key" ON "PlanTemplate"("workspaceId", "name", "version");

-- AddForeignKey
ALTER TABLE "PlanTemplate" ADD CONSTRAINT "PlanTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
