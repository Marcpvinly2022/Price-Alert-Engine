import { prisma } from "./src/config/database.js";
import { processNotification } from "./src/services/notification.worker.js";

const WORKER_COUNT = 10;

try {
    console.log("\n========== NOTIFICATION CONCURRENCY TEST ==========\n");

    // 1. Find an existing alert
    const alert = await prisma.alert.findFirst({
        select: {
            id: true,
        },
    });

    if (!alert) {
        console.log("No alert found.");
        process.exit(0);
    }

    // 2. Create ONE notification
    const notification = await prisma.alertNotification.create({
        data: {
            alertId: alert.id,
            channel: "LOG",
            dedupeKey: `concurrency-test-${Date.now()}`,
            status: "PENDING",
            attemptCount: 0,
        },
        select: {
            id: true,
            alertId: true,
            channel: true,
            status: true,
        },
    });

    console.log("[TEST] Created notification:");
    console.log(notification);

    // 3. Start 10 workers against THE SAME notification
    console.log(
        `\n[TEST] Starting ${WORKER_COUNT} concurrent workers...`
    );

    const workerPromises = Array.from(
        { length: WORKER_COUNT },
        (_, index) =>
            processNotification(notification.id)
                .then((result) => ({
                    worker: index + 1,
                    ...result,
                }))
                .catch((error) => ({
                    worker: index + 1,
                    error: error.message,
                }))
    );

    const results = await Promise.all(workerPromises);

    // 4. Display worker results
    console.log("\n[TEST] Worker results:");

    console.table(
        results.map((result) => ({
            worker: result.worker,
            claimed: result.claimed ?? false,
            sent: result.sent ?? false,
            error: result.error ?? "NONE",
        }))
    );

    // 5. Count successful claims
    const successfulClaims = results.filter(
        (result) => result.claimed === true
    ).length;

    const successfulSends = results.filter(
        (result) => result.sent === true
    ).length;

    // 6. Read final database state
    const finalNotification =
        await prisma.alertNotification.findUnique({
            where: {
                id: notification.id,
            },
            select: {
                id: true,
                alertId: true,
                channel: true,
                status: true,
                attemptCount: true,
                processingAt: true,
                sentAt: true,
                nextRetryAt: true,
                lastErrorAt: true,
                error: true,
            },
        });

    console.log("\n[TEST] Final notification:");
    console.log(finalNotification);

    // 7. Assertions
    const passed =
        successfulClaims === 1 &&
        successfulSends === 1 &&
        finalNotification?.status === "SENT" &&
        finalNotification.processingAt === null &&
        finalNotification.sentAt !== null &&
        finalNotification.error === null &&
        finalNotification.nextRetryAt === null;

    console.log("\n========== CONCURRENCY RESULT ==========");

    console.log(`Workers:             ${WORKER_COUNT}`);
    console.log(`Successful claims:  ${successfulClaims}`);
    console.log(`Successful sends:   ${successfulSends}`);
    console.log(`Final status:       ${finalNotification?.status}`);

    if (passed) {
        console.log(
            "\nRESULT: ✅ PASSED — Exactly one worker claimed and sent the notification."
        );
    } else {
        console.log(
            "\nRESULT: ❌ FAILED — Notification concurrency protection is incorrect."
        );
    }

} catch (error) {
    console.error("\n[TEST] Notification concurrency test failed:");
    console.error(error);
} finally {
    await prisma.$disconnect();
}