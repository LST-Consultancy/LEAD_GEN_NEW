-- CreateTable
CREATE TABLE "DealPlan" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealPlanStep" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completionCriteria" TEXT,
    "dependsOn" TEXT[],
    "isClientGate" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "ownerId" UUID,
    "artifact" TEXT,
    "note" TEXT,
    "clientApprovedBy" TEXT,
    "clientApprovedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealPlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealPlan_dealId_key" ON "DealPlan"("dealId");

-- CreateIndex
CREATE INDEX "DealPlan_workspaceId_idx" ON "DealPlan"("workspaceId");

-- CreateIndex
CREATE INDEX "DealPlanStep_workspaceId_ownerId_status_idx" ON "DealPlanStep"("workspaceId", "ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DealPlanStep_planId_key_key" ON "DealPlanStep"("planId", "key");

-- AddForeignKey
ALTER TABLE "DealPlan" ADD CONSTRAINT "DealPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPlan" ADD CONSTRAINT "DealPlan_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPlanStep" ADD CONSTRAINT "DealPlanStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
