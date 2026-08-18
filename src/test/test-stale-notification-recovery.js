import prisma from "./src/config/database.js";
import { recoverStaleNotifications } from "./src/services/notification.worker.js";

const STALE_TIME = new Date(Date.now() - 10 * 60 * 1000);

const notification = await prisma.alertNotification.findFirst({
  where: {
    status: "PENDING",
  },
});

if (!notification) {
  console.log("No PENDING notification available for test.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n========== STALE RECOVERY TEST ==========\n");

console.log("[TEST] Target notification:");
console.log({
  id: notification.id,
  alertId: notification.alertId,
  status: notification.status,
});

/*
 * Simulate a worker that claimed the notification
 * but then crashed.
 */
await prisma.alertNotification.update({
  where: {
    id: notification.id,
  },

  data: {
    status: "PROCESSING",
    processingAt: STALE_TIME,
  },
});

console.log("\n[TEST] Simulated stale PROCESSING notification");

const beforeRecovery =
  await prisma.alertNotification.findUnique({
    where: {
      id: notification.id,
    },
  });

console.log("[TEST] Before recovery:");
console.log({
  status: beforeRecovery.status,
  processingAt: beforeRecovery.processingAt,
});

/*
 * Run recovery.
 */
const recovered = await recoverStaleNotifications();

console.log("\n[TEST] Recovered:", recovered);

/*
 * Verify.
 */
const afterRecovery =
  await prisma.alertNotification.findUnique({
    where: {
      id: notification.id,
    },
  });

console.log("\n[TEST] After recovery:");
console.log({
  status: afterRecovery.status,
  processingAt: afterRecovery.processingAt,
});

/*
 * Assertions
 */
const passed =
  afterRecovery.status === "PENDING" &&
  afterRecovery.processingAt === null;

console.log(
  `\nRESULT: ${passed ? "✅ PASSED" : "❌ FAILED"}`
);

await prisma.$disconnect();