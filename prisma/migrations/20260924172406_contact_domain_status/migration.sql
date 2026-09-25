-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "country" SET DEFAULT 'Unknown';

-- AlterTable
ALTER TABLE "CompanyContactPoint" ADD COLUMN     "domainStatus" TEXT NOT NULL DEFAULT 'matched',
ADD COLUMN     "possiblePersonId" UUID;

-- AlterTable
ALTER TABLE "Person" ALTER COLUMN "country" SET DEFAULT 'Unknown';
