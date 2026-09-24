-- CreateTable
CREATE TABLE "ProposalDefaults" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "terms" TEXT,
    "pricingNote" TEXT,
    "description" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "logoDataUrl" TEXT,
    "packages" JSONB NOT NULL DEFAULT '[]',
    "caseStudies" JSONB NOT NULL DEFAULT '[]',
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProposalDefaults_workspaceId_key" ON "ProposalDefaults"("workspaceId");

-- AddForeignKey
ALTER TABLE "ProposalDefaults" ADD CONSTRAINT "ProposalDefaults_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
