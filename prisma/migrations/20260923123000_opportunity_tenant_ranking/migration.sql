ALTER TABLE "Opportunity" ADD COLUMN "activeRank" INTEGER NOT NULL DEFAULT 0;
UPDATE "Opportunity" SET "activeRank" = 1 WHERE "status" IN ('ACTIVE', 'OPEN', 'NEW');
CREATE UNIQUE INDEX "Company_workspaceId_id_key" ON "Company"("workspaceId", "id");
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_companyId_fkey";
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
