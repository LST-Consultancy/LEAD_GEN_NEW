-- Apify enrichment: field provenance on Company, current/former/uncertain on Employment, a stable
-- profile key on Person, company-level contact points, enrichment runs and a ledger of Apify runs.
-- Additive only: new tables, and new columns that are nullable or defaulted.
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "enrichment" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Employment" ADD COLUMN     "association" TEXT NOT NULL DEFAULT 'current',
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "profileKey" TEXT;

-- CreateTable
CREATE TABLE "CompanyContactPoint" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isGeneric" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "verificationResult" TEXT NOT NULL DEFAULT 'UNCHECKED',
    "verification" JSONB NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "requestedById" UUID,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "refresh" BOOLEAN NOT NULL DEFAULT false,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB NOT NULL DEFAULT '{}',
    "budgetUsd" DOUBLE PRECISION NOT NULL,
    "spentUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "jobKey" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApifyRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "enrichmentRunId" UUID,
    "stageKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "runId" TEXT,
    "datasetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "usageUsd" DOUBLE PRECISION,
    "estimatedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ApifyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyContactPoint_workspaceId_companyId_idx" ON "CompanyContactPoint"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContactPoint_workspaceId_companyId_value_key" ON "CompanyContactPoint"("workspaceId", "companyId", "value");

-- CreateIndex
CREATE INDEX "EnrichmentRun_workspaceId_opportunityId_createdAt_idx" ON "EnrichmentRun"("workspaceId", "opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrichmentRun_workspaceId_state_idx" ON "EnrichmentRun"("workspaceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentRun_workspaceId_id_key" ON "EnrichmentRun"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "ApifyRun_workspaceId_actorId_inputHash_idx" ON "ApifyRun"("workspaceId", "actorId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApifyRun_workspaceId_enrichmentRunId_stageKey_key" ON "ApifyRun"("workspaceId", "enrichmentRunId", "stageKey");

-- CreateIndex
CREATE INDEX "Person_workspaceId_profileKey_idx" ON "Person"("workspaceId", "profileKey");

-- AddForeignKey
ALTER TABLE "CompanyContactPoint" ADD CONSTRAINT "CompanyContactPoint_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApifyRun" ADD CONSTRAINT "ApifyRun_workspaceId_enrichmentRunId_fkey" FOREIGN KEY ("workspaceId", "enrichmentRunId") REFERENCES "EnrichmentRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

