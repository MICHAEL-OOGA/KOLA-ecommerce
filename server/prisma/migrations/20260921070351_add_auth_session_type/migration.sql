-- CreateEnum
CREATE TYPE "AuthSessionType" AS ENUM ('CUSTOMER', 'ADMIN');

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "sessionType" "AuthSessionType" NOT NULL DEFAULT 'CUSTOMER';
