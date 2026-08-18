import prisma from "./src/config/database.js";
import { processNotification } from "./src/services/notification.worker.js";


// 1. Find ONE PENDING notification
const notification = await prisma.alertNotification.findFirst({
  where: {
    status: "PENDING",
  },
  select: {
    id: true,
    alertId: true,
  },
});

if (!notification) {
  console.log("No PENDING notification found.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n[TEST] Target notification:");
console.log(notification);


// 2. Start 10 workers against THE SAME notification
const workers = Array.from({ length: 10 }, (_, i) =>
  processNotification(notification.id, i + 1)
);


// 3. Wait for all workers
const results = await Promise.all(workers);


// 4. Display worker results
console.log("\n[TEST] Worker results:");

console.table(
  results.map((result, index) => ({
    worker: index + 1,
    claimed: result?.claimed,
    sent: result?.sent,
    notificationId: result?.notificationId ?? "NONE",
  }))
);


// 5. Read final database state
const finalNotification =
  await prisma.alertNotification.findUnique({
    where: {
      id: notification.id,
    },
  });


console.log("\n[TEST] Final notification:");

console.log({
  id: finalNotification.id,
  alertId: finalNotification.alertId,
  status: finalNotification.status,
  sentAt: finalNotification.sentAt,
  provider: finalNotification.provider,
  error: finalNotification.error,
});


// 6. Count notifications
const pendingCount =
  await prisma.alertNotification.count({
    where: {
      id: notification.id,
      status: "PENDING",
    },
  });

const sentCount =
  await prisma.alertNotification.count({
    where: {
      id: notification.id,
      status: "SENT",
    },
  });


console.log("\n========== NOTIFICATION CONCURRENCY TEST ==========");

console.log("Workers:           10");
console.log("Pending:           ", pendingCount);
console.log("Sent:              ", sentCount);

const successfulClaims = results.filter(
  (result) => result?.claimed === true
).length;

console.log("Successful claims: ", successfulClaims);


if (
  successfulClaims === 1 &&
  pendingCount === 0 &&
  sentCount === 1 &&
  finalNotification.status === "SENT"
) {
  console.log("\nRESULT: ✅ PASSED");
} else {
  console.log("\nRESULT: ❌ FAILED");
}


await prisma.$disconnect();