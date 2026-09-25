-- AlterTable
ALTER TABLE "OpportunitySearch" ADD COLUMN     "searchPhraseId" UUID;

-- AlterTable
ALTER TABLE "SearchPhrase" ADD COLUMN     "createdById" UUID;
