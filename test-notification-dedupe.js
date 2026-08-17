import { prisma } from "./src/config/database.js";

const WORKERS = 10;

try {
    console.log("\n========== NOTIFICATION DEDUPE CONCURRENCY TEST ==========\n");

    const alert = await prisma.alert.findFirst({
        select: {
            id: true,
        },
    });

    if (!alert) {
        console.log("No alert found.");
        process.exit(0);
    }

    const dedupeKey = `dedupe-concurrency-${Date.now()}`;

    console.log("[TEST] Alert:", alert.id);
    console.log("[TEST] Dedupe key:", dedupeKey);
    console.log(`[TEST] Starting ${WORKERS} concurrent creators...\n`);

    const results = await Promise.all(
        Array.from({ length: WORKERS }, (_, index) =>
            prisma.alertNotification
                .create({
                    data: {
                        alertId: alert.id,
                        channel: "LOG",
                        dedupeKey,
                        status: "PENDING",
                        attemptCount: 0,
                    },
                    select: {
                        id: true,
                        alertId: true,
                        channel: true,
                        status: true,
                        dedupeKey: true,
                    },
                })
                .then(notification => ({
                    worker: index + 1,
                    success: true,
                    notification,
                    error: null,
                }))
                .catch(error => ({
                    worker: index + 1,
                    success: false,
                    notification: null,
                    error: error.code || error.message,
                }))
        )
    );

    console.log("[TEST] Worker results:");

    console.table(
        results.map(result => ({
            worker: result.worker,
            success: result.success,
            notificationId:
                result.notification?.id ?? "NONE",
            error:
                result.error ?? "NONE",
        }))
    );

    const successfulCreates =
        results.filter(result => result.success);

    const failedCreates =
        results.filter(result => !result.success);

    console.log("\n[TEST] Successful creates:", successfulCreates.length);
    console.log("[TEST] Failed creates:", failedCreates.length);

    // Check the database directly.
    const notifications =
        await prisma.alertNotification.findMany({
            where: {
                dedupeKey,
            },
            select: {
                id: true,
                alertId: true,
                channel: true,
                status: true,
                dedupeKey: true,
            },
        });

    console.log("\n[TEST] Notifications in database:");
    console.table(notifications);

    console.log("\n========== DEDUPE RESULT ==========");

    if (notifications.length !== 1) {
        console.log(
            `RESULT: ❌ FAILED — Expected exactly 1 notification, found ${notifications.length}.`
        );

        process.exitCode = 1;
    } else if (successfulCreates.length !== 1) {
        console.log(
            `RESULT: ❌ FAILED — Expected exactly 1 successful create, got ${successfulCreates.length}.`
        );

        process.exitCode = 1;
    } else {
        console.log(
            "RESULT: ✅ PASSED — Concurrent creation produced exactly one notification."
        );
    }

} catch (error) {
    console.error("\n[TEST] Test failed:");
    console.error(error);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}