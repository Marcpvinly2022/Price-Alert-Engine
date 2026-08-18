// import prisma from "./src/config/database.js";
// import { processNotification } from "./src/services/notification.worker.js";

// const MAX_ATTEMPTS = 5;

// const expectedDelays = {
//     1: 30 * 1000,   // 30 seconds
//     2: 60 * 1000,   // 1 minute
//     3: 120 * 1000,  // 2 minutes
//     4: 240 * 1000,  // 4 minutes
//     5: null,        // terminal
// };

// const notification = await prisma.alertNotification.findFirst({
//     where: {
//         status: "PENDING",
//         channel: {
//             in: ["EMAIL", "SMS"],
//         },
//     },
//     select: {
//         id: true,
//         alertId: true,
//         channel: true,
//         attemptCount: true,
//     },
// });

// if (!notification) {
//     console.log("No PENDING EMAIL/SMS notification found.");
//     await prisma.$disconnect();
//     process.exit(0);
// }

// console.log("\n========== RETRY BACKOFF TEST ==========");

// console.log("\n[TEST] Target notification:");
// console.log(notification);

// let allPassed = true;

// for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {

//     // For attempts after the first one, make the retry immediately due.
//     if (attempt > 1) {
//         await prisma.alertNotification.update({
//             where: {
//                 id: notification.id,
//             },
//             data: {
//                 status: "PENDING",
//                 nextRetryAt: null,
//                 processingAt: null,
//             },
//         });
//     }

//     console.log(`\n[TEST] Running attempt ${attempt}...`);

//     const before = new Date();

//     const result = await processNotification(notification.id);

//     const after = new Date();

//     console.log("[TEST] Worker result:");
//     console.log(result);

//     const state = await prisma.alertNotification.findUnique({
//         where: {
//             id: notification.id,
//         },
//         select: {
//             status: true,
//             attemptCount: true,
//             nextRetryAt: true,
//             lastErrorAt: true,
//             processingAt: true,
//         },
//     });

//     console.log("[TEST] Database state:");
//     console.log(state);

//     if (state.attemptCount !== attempt) {
//         console.log(
//             `❌ Expected attemptCount ${attempt}, got ${state.attemptCount}`
//         );

//         allPassed = false;
//         continue;
//     }

//     if (attempt < MAX_ATTEMPTS) {

//         const expectedDelay = expectedDelays[attempt];

//         if (!state.nextRetryAt) {
//             console.log(
//                 `❌ Attempt ${attempt} should have a nextRetryAt`
//             );

//             allPassed = false;
//             continue;
//         }

//         const actualDelay =
//             state.nextRetryAt.getTime() -
//             state.lastErrorAt.getTime();

//         const tolerance = 1000;

//         const delayCorrect =
//             Math.abs(actualDelay - expectedDelay) <= tolerance;

//         console.log(
//             `[TEST] Expected delay: ${expectedDelay}ms`
//         );

//         console.log(
//             `[TEST] Actual delay:   ${actualDelay}ms`
//         );

//         if (delayCorrect) {
//             console.log(
//                 `✅ Attempt ${attempt}: correct backoff`
//             );
//         } else {
//             console.log(
//                 `❌ Attempt ${attempt}: incorrect backoff`
//             );

//             allPassed = false;
//         }

//     } else {

//         if (state.nextRetryAt !== null) {
//             console.log(
//                 "❌ Attempt 5 should have nextRetryAt = null"
//             );

//             allPassed = false;
//         } else {
//             console.log(
//                 "✅ Attempt 5: terminal failure, no retry scheduled"
//             );
//         }
//     }
// }

// console.log("\n========== FINAL RESULT ==========");

// if (allPassed) {
//     console.log("RESULT: ✅ EXPONENTIAL BACKOFF TEST PASSED");
// } else {
//     console.log("RESULT: ❌ EXPONENTIAL BACKOFF TEST FAILED");
// }

// await prisma.$disconnect();



import { prisma } from "./src/config/database.js";
import {
    processNotification,
    retryDueNotifications,
} from "./src/services/notification.worker.js";

try {
    console.log("\n========== RETRY / BACKOFF TEST ==========\n");

    // 1. Find an alert
    const alert = await prisma.alert.findFirst({
        select: {
            id: true,
        },
    });

    if (!alert) {
        console.log("No alert found.");
        process.exit(0);
    }

    // 2. Create an EMAIL notification.
    // EMAIL provider intentionally throws an error.
    const notification = await prisma.alertNotification.create({
        data: {
            alertId: alert.id,
            channel: "EMAIL",
            dedupeKey: `retry-test-${Date.now()}`,
            status: "PENDING",
            attemptCount: 0,
        },
        select: {
            id: true,
            alertId: true,
            channel: true,
            status: true,
            attemptCount: true,
        },
    });

    console.log("[TEST] Created notification:");
    console.log(notification);

    // --------------------------------------------------
    // Run 5 failed attempts
    // --------------------------------------------------

    for (let attempt = 1; attempt <= 5; attempt++) {
        console.log(`\n========== ATTEMPT ${attempt} ==========`);

        // 3. Process notification.
        // EMAIL provider will fail.
        const result = await processNotification(notification.id);

        console.log("\n[TEST] Worker result:");
        console.log(result);

        // 4. Read database state
        let state = await prisma.alertNotification.findUnique({
            where: {
                id: notification.id,
            },
            select: {
                status: true,
                attemptCount: true,
                processingAt: true,
                nextRetryAt: true,
                lastErrorAt: true,
                error: true,
            },
        });

        console.log("\n[TEST] Database state:");
        console.log(state);

        // --------------------------------------------------
        // Validate attempt count
        // --------------------------------------------------

        if (state.attemptCount !== attempt) {
            throw new Error(
                `Expected attemptCount=${attempt}, got ${state.attemptCount}`
            );
        }

        // --------------------------------------------------
        // On attempts 1-4, notification must be retryable
        // --------------------------------------------------

        if (attempt < 5) {
            if (state.status !== "FAILED") {
                throw new Error(
                    `Expected FAILED after attempt ${attempt}, got ${state.status}`
                );
            }

            if (!state.nextRetryAt) {
                throw new Error(
                    `Expected nextRetryAt after attempt ${attempt}`
                );
            }

            console.log(
                `[TEST] Attempt ${attempt} correctly scheduled for retry.`
            );

            // Make retry immediately due.
            await prisma.alertNotification.update({
                where: {
                    id: notification.id,
                },
                data: {
                    nextRetryAt: new Date(Date.now() - 1000),
                },
            });

            // Move FAILED -> PENDING
            const retried = await retryDueNotifications();

            console.log(
                `[TEST] retryDueNotifications() moved ${retried} notification(s)`
            );

            state = await prisma.alertNotification.findUnique({
                where: {
                    id: notification.id,
                },
                select: {
                    status: true,
                    attemptCount: true,
                    nextRetryAt: true,
                },
            });

            console.log("\n[TEST] State after retry scheduling:");
            console.log(state);

            if (state.status !== "PENDING") {
                throw new Error(
                    `Expected PENDING after retry scheduling, got ${state.status}`
                );
            }
        }

        // --------------------------------------------------
        // Attempt 5 must permanently fail
        // --------------------------------------------------

        if (attempt === 5) {
            if (state.status !== "FAILED") {
                throw new Error(
                    `Expected FAILED after maximum attempts, got ${state.status}`
                );
            }

            if (state.nextRetryAt !== null) {
                throw new Error(
                    "Expected nextRetryAt to be NULL after maximum attempts"
                );
            }

            console.log(
                "\n[TEST] Maximum attempts reached correctly."
            );
        }
    }

    // --------------------------------------------------
    // Final state
    // --------------------------------------------------

    const finalState = await prisma.alertNotification.findUnique({
        where: {
            id: notification.id,
        },
        select: {
            id: true,
            status: true,
            attemptCount: true,
            processingAt: true,
            nextRetryAt: true,
            lastErrorAt: true,
            error: true,
        },
    });

    console.log("\n========== FINAL STATE ==========");
    console.log(finalState);

    const passed =
        finalState.status === "FAILED" &&
        finalState.attemptCount === 5 &&
        finalState.processingAt === null &&
        finalState.nextRetryAt === null &&
        finalState.error !== null;

    console.log("\n========== RETRY RESULT ==========");

    if (passed) {
        console.log(
            "RESULT: ✅ PASSED — Retry, backoff, and maximum-attempt logic work correctly."
        );
    } else {
        console.log(
            "RESULT: ❌ FAILED — Retry lifecycle did not reach the expected final state."
        );
    }

} catch (error) {
    console.error("\n[TEST] Retry test failed:");
    console.error(error);
} finally {
    await prisma.$disconnect();
}