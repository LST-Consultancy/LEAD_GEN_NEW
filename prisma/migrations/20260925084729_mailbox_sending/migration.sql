-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "encryptedSmtpPassword" TEXT,
ADD COLUMN     "encryptedTokens" TEXT,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "isDefaultSender" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'imap',
ADD COLUMN     "readCursor" TEXT,
ADD COLUMN     "receiveEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sendLastError" TEXT,
ADD COLUMN     "sendStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sendTestedAt" TIMESTAMP(3),
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecurity" TEXT,
ADD COLUMN     "smtpUser" TEXT,
ALTER COLUMN "imapHost" DROP NOT NULL,
ALTER COLUMN "imapUser" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mailboxId" UUID,
ADD COLUMN     "sendClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "senderMailboxId" UUID;
