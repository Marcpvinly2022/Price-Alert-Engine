-- AlterTable
ALTER TABLE "AlertNotification" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AlertNotification_status_nextRetryAt_idx" ON "AlertNotification"("status", "nextRetryAt");
