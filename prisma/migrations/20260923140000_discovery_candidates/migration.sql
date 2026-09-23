CREATE TABLE "DiscoveryCandidate" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "searchId" UUID NOT NULL,
  "provider" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT NOT NULL, "kind" TEXT NOT NULL, "postedAt" TIMESTAMP(3),
  "document" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'REVIEW', "opportunityId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscoveryCandidate_workspaceId_searchId_fkey" FOREIGN KEY ("workspaceId", "searchId") REFERENCES "OpportunitySearch"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DiscoveryCandidate_workspaceId_searchId_sourceUrl_key" ON "DiscoveryCandidate"("workspaceId", "searchId", "sourceUrl");
CREATE INDEX "DiscoveryCandidate_workspaceId_status_createdAt_idx" ON "DiscoveryCandidate"("workspaceId", "status", "createdAt");
