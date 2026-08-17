import prisma from "./src/config/database.js";
import { retryDueNotifications } from "./src/services/notification.worker.js";

console.log("\n========== RETRY DUE NOTIFICATIONS TEST ==========");

// --------------------------------------------------
// 1. Find a FAILED notification
// --------------------------------------------------

const notification = await prisma.alertNotification.findFirst({
    where: {
        status: "FAILED",
    },

    select: {
        id: true,
        alertId: true,
        channel: true,
        status: true,
        attemptCount: true,
        nextRetryAt: true,
    },
});

if (!notification) {
    console.log("No FAILED notification found.");

    await prisma.$disconnect();
    process.exit(0);
}

console.log("\n[TEST] Target notification:");
console.log(notification);


// --------------------------------------------------
// 2. TEST A — nextRetryAt is in the FUTURE
// --------------------------------------------------

console.log("\n========== TEST A: RETRY NOT DUE ==========");

const futureRetryAt =
    new Date(Date.now() + 60 * 1000);

await prisma.alertNotification.update({
    where: {
        id: notification.id,
    },

    data: {
        status: "FAILED",
        nextRetryAt: futureRetryAt,
    },
});

console.log(
    `[TEST] nextRetryAt set to future: ${futureRetryAt.toISOString()}`
);

const beforeFutureTest =
    await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
        },

        select: {
            id: true,
            status: true,
            attemptCount: true,
            nextRetryAt: true,
        },
    });

console.log("\n[TEST] Before retryDueNotifications():");
console.log(beforeFutureTest);


// Run retry scheduler

const futureResult =
    await retryDueNotifications();

console.log(
    `\n[TEST] retryDueNotifications() returned: ${futureResult}`
);


// Check database

const afterFutureTest =
    await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
        },

        select: {
            id: true,
            status: true,
            attemptCount: true,
            nextRetryAt: true,
        },
    });

console.log("\n[TEST] After retryDueNotifications():");
console.log(afterFutureTest);


// --------------------------------------------------
// Verify TEST A
// --------------------------------------------------

const futureTestPassed =
    afterFutureTest.status === "FAILED";

if (futureTestPassed) {
    console.log(
        "\nTEST A RESULT: ✅ PASSED — notification was NOT retried early."
    );
} else {
    console.log(
        "\nTEST A RESULT: ❌ FAILED — notification was retried too early."
    );
}


// --------------------------------------------------
// 3. TEST B — nextRetryAt is in the PAST
// --------------------------------------------------

console.log("\n========== TEST B: RETRY IS DUE ==========");

const pastRetryAt =
    new Date(Date.now() - 1000);

await prisma.alertNotification.update({
    where: {
        id: notification.id,
    },

    data: {
        status: "FAILED",
        nextRetryAt: pastRetryAt,
    },
});

console.log(
    `[TEST] nextRetryAt set to past: ${pastRetryAt.toISOString()}`
);


// Check before

const beforePastTest =
    await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
        },

        select: {
            id: true,
            status: true,
            attemptCount: true,
            nextRetryAt: true,
        },
    });

console.log("\n[TEST] Before retryDueNotifications():");
console.log(beforePastTest);


// Run retry scheduler

const pastResult =
    await retryDueNotifications();

console.log(
    `\n[TEST] retryDueNotifications() returned: ${pastResult}`
);


// Check after

const afterPastTest =
    await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
        },

        select: {
            id: true,
            status: true,
            attemptCount: true,
            nextRetryAt: true,
        },
    });

console.log("\n[TEST] After retryDueNotifications():");
console.log(afterPastTest);


// --------------------------------------------------
// Verify TEST B
// --------------------------------------------------

const pastTestPassed =
    afterPastTest.status === "PENDING" &&
    afterPastTest.nextRetryAt === null;

if (pastTestPassed) {
    console.log(
        "\nTEST B RESULT: ✅ PASSED — notification became PENDING when retry was due."
    );
} else {
    console.log(
        "\nTEST B RESULT: ❌ FAILED — notification was not moved to PENDING."
    );
}


// --------------------------------------------------
// FINAL RESULT
// --------------------------------------------------

console.log("\n========== FINAL RESULT ==========");

if (futureTestPassed && pastTestPassed) {
    console.log(
        "RESULT: ✅ ALL RETRY SEMANTICS PASSED"
    );
} else {
    console.log(
        "RESULT: ❌ RETRY SEMANTICS FAILED"
    );
}

await prisma.$disconnect();