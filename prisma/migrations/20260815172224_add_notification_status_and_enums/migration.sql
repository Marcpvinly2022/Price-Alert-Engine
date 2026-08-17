-- Create new enum types
CREATE TYPE "AlertCondition" AS ENUM ('ABOVE', 'BELOW');

CREATE TYPE "NotificationChannel" AS ENUM ('LOG', 'EMAIL', 'SMS');

CREATE TYPE "NotificationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED'
);


-- Safely convert existing Alert.condition values
ALTER TABLE "Alert"
ALTER COLUMN "condition" TYPE "AlertCondition"
USING "condition"::"AlertCondition";


-- Add notification processing fields
ALTER TABLE "AlertNotification"
ADD COLUMN "error" TEXT,
ADD COLUMN "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING';


-- Safely convert existing channel values
ALTER TABLE "AlertNotification"
ALTER COLUMN "channel" TYPE "NotificationChannel"
USING "channel"::"NotificationChannel";


-- Make sentAt optional
ALTER TABLE "AlertNotification"
ALTER COLUMN "sentAt" DROP NOT NULL,
ALTER COLUMN "sentAt" DROP DEFAULT;


-- Index notification status for workers/queries
CREATE INDEX "AlertNotification_status_idx"
ON "AlertNotification"("status");