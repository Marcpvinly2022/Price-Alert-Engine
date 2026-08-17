import prisma from "./src/config/database.js";
import { processNotification } from "./src/services/notification.worker.js";

const MAX_ATTEMPTS = 5;

// 1. Find an EMAIL/SMS notification that can be used for the test
const notification = await prisma.alertNotification.findFirst({
    where: {
        status: "PENDING",
        channel: {
            in: ["EMAIL", "SMS"],
        },
    },
    select: {
        id: true,
        alertId: true,
        channel: true,
        attemptCount: true,
    },
});

if (!notification) {
    console.log("No PENDING EMAIL/SMS notification found.");
    await prisma.$disconnect();
    process.exit(0);
}

console.log("\n========== MAX RETRY TEST ==========");

console.log("\n[TEST] Target notification:");
console.log(notification);


// ---------------------------------------------------------
// Reset it to attempt 4.
//
// We want the next failure to become attempt 5.
// ---------------------------------------------------------

await prisma.alertNotification.update({
    where: {
        id: notification.id,
    },
    data: {
        status: "PENDING",
        attemptCount: 4,
        nextRetryAt: null,
        processingAt: null,
        lastErrorAt: null,
        error: null,
    },
});

console.log("\n[TEST] Notification prepared at attempt 4.");


// ---------------------------------------------------------
// Attempt 5
// ---------------------------------------------------------

console.log("\n[TEST] Running attempt 5...");

const attempt5 = await processNotification(notification.id);

console.log("\n[TEST] Attempt 5 result:");
console.log(attempt5);


// ---------------------------------------------------------
// Read database after attempt 5
// ---------------------------------------------------------

const afterAttempt5 =
    await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
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

console.log("\n[TEST] Database after attempt 5:");
console.log(afterAttempt5);


// ---------------------------------------------------------
// Attempt 6
//
// This MUST NOT happen.
// retryDueNotifications() should not move attempt 5
// back to PENDING because attemptCount is already 5.
// ---------------------------------------------------------

console.log("\n[TEST] Trying to schedule attempt 6...");

// Make retryDueNotifications() think the retry is due.
await prisma.alertNotification.update({
    where: {
        id: notification.id,
    },
    data: {
        nextRetryAt: new Date(Date.now() - 1000),
    },
});

console.log("[TEST] nextRetryAt forced into the past.");


// Import dynamically so we can use the retry scheduler.
const { retryDueNotifications } =
    await import("./src/services/notification.worker.js");

const retried = await retryDueNotifications();

console.log("\n[TEST] retryDueNotifications() returned:");
console.log(retried);


// ---------------------------------------------------------
// Final state
// ---------------------------------------------------------

const finalNotification =
    await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
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

console.log("\n[TEST] Final database state:");
console.log(finalNotification);


// ---------------------------------------------------------
// Assertions
// ---------------------------------------------------------

const attempt5Correct =
    afterAttempt5.status === "FAILED" &&
    afterAttempt5.attemptCount === MAX_ATTEMPTS &&
    afterAttempt5.nextRetryAt === null;

const noAttempt6 =
    retried === 0 &&
    finalNotification.status === "FAILED" &&
    finalNotification.attemptCount === MAX_ATTEMPTS;

console.log("\n========== RESULTS ==========");

console.log(
    "Attempt 5 became terminal FAILED:",
    attempt5Correct ? "✅ PASSED" : "❌ FAILED"
);

console.log(
    "Attempt 6 was blocked:",
    noAttempt6 ? "✅ PASSED" : "❌ FAILED"
);

if (attempt5Correct && noAttempt6) {
    console.log("\nRESULT: ✅ MAX RETRY SEMANTICS PASSED");
} else {
    console.log("\nRESULT: ❌ MAX RETRY SEMANTICS FAILED");
}

await prisma.$disconnect();