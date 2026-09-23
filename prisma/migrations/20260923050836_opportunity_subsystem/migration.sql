-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('INTERNAL_HIRING', 'EXTERNAL_VENDOR', 'IMPLEMENTATION', 'INTEGRATION', 'CONSULTING', 'OUTSOURCING', 'STAFF_AUGMENTATION', 'PROJECT', 'RFP', 'MIGRATION', 'DIGITAL_TRANSFORMATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'ACTIVE', 'AGING', 'CLOSED', 'EXPIRED', 'PAUSED', 'OPEN', 'AWARDED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DiscoveryState" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ContactMethod" ADD COLUMN     "provenance" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "verificationResult" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "ScoringConfig" ADD COLUMN     "opportunityRules" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "types" "OpportunityType"[],
    "status" "OpportunityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "technologies" TEXT[],
    "requirements" TEXT[],
    "location" TEXT,
    "postedAt" TIMESTAMP(3),
    "closingAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "fitScore" INTEGER NOT NULL DEFAULT 0,
    "opportunityScore" INTEGER NOT NULL DEFAULT 0,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySource" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "rawReference" JSONB NOT NULL,
    "allowedExport" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunitySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityEvidence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" INTEGER NOT NULL,
    "scoreContribution" INTEGER NOT NULL,
    "rawReference" JSONB NOT NULL,

    CONSTRAINT "OpportunityEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityVersion" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedFields" JSONB NOT NULL,

    CONSTRAINT "OpportunityVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySearch" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "providers" TEXT[],
    "state" "DiscoveryState" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '{}',
    "providerResults" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "found" INTEGER NOT NULL DEFAULT 0,
    "qualified" INTEGER NOT NULL DEFAULT 0,
    "savedSearchId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "OpportunitySearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySearchResult" (
    "workspaceId" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,

    CONSTRAINT "OpportunitySearchResult_pkey" PRIMARY KEY ("workspaceId","searchId","opportunityId")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedCredentials" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedSearch" BOOLEAN NOT NULL DEFAULT false,
    "allowedStorage" BOOLEAN NOT NULL DEFAULT false,
    "allowedEnrichment" BOOLEAN NOT NULL DEFAULT false,
    "allowedExport" BOOLEAN NOT NULL DEFAULT false,
    "allowedOutreach" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'UNTESTED',
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSync" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "jobId" TEXT,
    "state" TEXT NOT NULL,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "credits" DOUBLE PRECISION,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_status_intentScore_idx" ON "Opportunity"("workspaceId", "status", "intentScore");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_companyId_idx" ON "Opportunity"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_postedAt_idx" ON "Opportunity"("workspaceId", "postedAt");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_discoveredAt_idx" ON "Opportunity"("workspaceId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_workspaceId_id_key" ON "Opportunity"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_workspaceId_dedupeKey_key" ON "Opportunity"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OpportunitySource_workspaceId_opportunityId_idx" ON "OpportunitySource"("workspaceId", "opportunityId");

-- CreateIndex
CREATE INDEX "OpportunitySource_workspaceId_expiresAt_idx" ON "OpportunitySource"("workspaceId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunitySource_workspaceId_provider_externalId_key" ON "OpportunitySource"("workspaceId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "OpportunityEvidence_workspaceId_opportunityId_idx" ON "OpportunityEvidence"("workspaceId", "opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityVersion_workspaceId_opportunityId_changedAt_idx" ON "OpportunityVersion"("workspaceId", "opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "OpportunitySearch_workspaceId_createdAt_idx" ON "OpportunitySearch"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunitySearch_workspaceId_id_key" ON "OpportunitySearch"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunitySearch_workspaceId_idempotencyKey_key" ON "OpportunitySearch"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_workspaceId_provider_key" ON "ProviderConnection"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "ProviderSync_workspaceId_provider_startedAt_idx" ON "ProviderSync"("workspaceId", "provider", "startedAt");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySource" ADD CONSTRAINT "OpportunitySource_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityEvidence" ADD CONSTRAINT "OpportunityEvidence_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityVersion" ADD CONSTRAINT "OpportunityVersion_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySearch" ADD CONSTRAINT "OpportunitySearch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySearchResult" ADD CONSTRAINT "OpportunitySearchResult_workspaceId_searchId_fkey" FOREIGN KEY ("workspaceId", "searchId") REFERENCES "OpportunitySearch"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySearchResult" ADD CONSTRAINT "OpportunitySearchResult_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSync" ADD CONSTRAINT "ProviderSync_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
