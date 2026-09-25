-- AlterTable
ALTER TABLE "DealPlanStep" ADD COLUMN     "requiredSkill" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "isAway" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stepCapacity" INTEGER;
