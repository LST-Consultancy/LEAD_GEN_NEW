-- LinkedIn discovery depth: per-run options, a resumable checkpoint, cancellation,
-- and candidates that record why they are in review or were rejected.
-- Additive only: every new column is nullable or has a default, so existing rows are untouched.
ALTER TABLE "OpportunitySearch" ADD COLUMN "options" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "OpportunitySearch" ADD COLUMN "checkpoint" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "OpportunitySearch" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);

ALTER TABLE "DiscoveryCandidate" ADD COLUMN "reason" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "classification" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "evidence" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "processing" TEXT NOT NULL DEFAULT 'DONE';
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "suggestedBuyer" TEXT;

CREATE INDEX "DiscoveryCandidate_workspaceId_searchId_status_idx" ON "DiscoveryCandidate"("workspaceId", "searchId", "status");
