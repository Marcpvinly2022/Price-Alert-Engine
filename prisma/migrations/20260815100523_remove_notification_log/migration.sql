/*
  Warnings:

  - You are about to drop the `NotificationLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "NotificationLog" DROP CONSTRAINT "NotificationLog_alertId_fkey";

-- DropTable
DROP TABLE "NotificationLog";
