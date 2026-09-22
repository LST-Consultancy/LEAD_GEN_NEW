-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastUsedStep" INTEGER,
ADD COLUMN     "mfaRecoveryCodes" TEXT[];
