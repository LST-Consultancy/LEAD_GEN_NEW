-- CreateTable
CREATE TABLE "OfferingProfile" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "services" TEXT[],
    "technologies" TEXT[],
    "buyerPhrases" TEXT[],
    "jobTitles" TEXT[],
    "prospectCategories" TEXT[],
    "industries" TEXT[],
    "locations" TEXT[],
    "employeeMin" INTEGER,
    "employeeMax" INTEGER,
    "negativeKeywords" TEXT[],
    "platforms" TEXT[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OfferingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferingProfile_workspaceId_deletedAt_idx" ON "OfferingProfile"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferingProfile_workspaceId_id_key" ON "OfferingProfile"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "OfferingProfile" ADD CONSTRAINT "OfferingProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
