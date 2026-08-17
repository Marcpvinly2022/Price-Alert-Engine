/*
  Warnings:

  - Added the required column `updatedAt` to the `AlertNotification` table.
    Existing rows are backfilled using `createdAt`.
*/

-- DropForeignKey
ALTER TABLE "AlertNotification"
DROP CONSTRAINT "AlertNotification_alertId_fkey";

-- DropIndex
DROP INDEX "AlertNotification_status_idx";

-- AlterTable
ALTER TABLE "AlertNotification"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "processingAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill updatedAt for existing rows
UPDATE "AlertNotification"
SET "updatedAt" = "createdAt"
WHERE "updatedAt" IS NULL;

-- Make updatedAt required after existing rows have been populated
ALTER TABLE "AlertNotification"
ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AlertNotification_status_processingAt_idx"
ON "AlertNotification"("status", "processingAt");

-- AddForeignKey
ALTER TABLE "AlertNotification"
ADD CONSTRAINT "AlertNotification_alertId_fkey"
FOREIGN KEY ("alertId") REFERENCES "Alert"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;