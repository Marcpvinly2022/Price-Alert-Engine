import { prisma } from "./src/config/database.js";

const notification = await prisma.alertNotification.findUnique({
  where: {
    id: "945698e2-b552-4194-a499-cf870fbf86cf",
  },
  select: {
    id: true,
    status: true,
    attemptCount: true,
    nextRetryAt: true,
    lastErrorAt: true,
    processingAt: true,
    sentAt: true,
    error: true,
  },
});

console.log("\n[TEST] Notification state:");
console.log(notification);

await prisma.$disconnect();