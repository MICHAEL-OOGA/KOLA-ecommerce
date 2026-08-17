-- CreateEnum
CREATE TYPE "SecurityAuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIEDs', 'ERROR');

-- CreateTable
CREATE TABLE "SecurityAuditLog" (
    "id" TEXT NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "outcome" "SecurityAuditOutcome" NOT NULL,
    "userId" TEXT,
    "actorRole" "Role",
    "requestId" VARCHAR(100),
    "ipHash" VARCHAR(64),
    "userAgentHash" VARCHAR(64),
    "identifierHash" VARCHAR(64),
    "resourceType" VARCHAR(64),
    "resourceId" VARCHAR(191),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAuditLog_eventType_createdAt_idx" ON "SecurityAuditLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_userId_createdAt_idx" ON "SecurityAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_outcome_createdAt_idx" ON "SecurityAuditLog"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_resourceType_resourceId_createdAt_idx" ON "SecurityAuditLog"("resourceType", "resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "SecurityAuditLog" ADD CONSTRAINT "SecurityAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
