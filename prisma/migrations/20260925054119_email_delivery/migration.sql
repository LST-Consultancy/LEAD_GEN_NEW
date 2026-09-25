-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailClaimedAt" TIMESTAMP(3),
ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "email" BOOLEAN NOT NULL DEFAULT false;
