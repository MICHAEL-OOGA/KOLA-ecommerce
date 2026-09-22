-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "failedAttempts" INTEGER NOT NULL DEFAULT 0;
