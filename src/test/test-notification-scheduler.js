import { prisma } from "./src/config/database.js";
import { runNotificationCycle } from "./src/services/notification.scheduler.js";

try {
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

    // 2. Create LOG notification
    const notification = await prisma.alertNotification.create({
        data: {
            alertId: alert.id,
            channel: "LOG",
            dedupeKey: `scheduler-test-${Date.now()}`,
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

    console.log("\n========== SCHEDULER LOG TEST ==========");

    console.log("\n[TEST] Created notification:");
    console.log(notification);

    // 3. Run ONE scheduler cycle
    console.log("\n[TEST] Running scheduler cycle...");

    const result = await runNotificationCycle();

    console.log("\n[TEST] Scheduler result:");
    console.log(result);

    // 4. Read final state
    const finalNotification =
        await prisma.alertNotification.findUnique({
            where: {
                id: notification.id,
            },

            select: {
                id: true,
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

    console.log("\n[TEST] Final notification state:");
    console.log(finalNotification);

    // 5. Assertions
    const passed =
        finalNotification?.status === "SENT" &&
        finalNotification.processingAt === null &&
        finalNotification.sentAt !== null &&
        finalNotification.error === null &&
        finalNotification.nextRetryAt === null;

    console.log("\n========== RESULT ==========");

    if (passed) {
        console.log(
            "RESULT: ✅ PASSED — LOG notification was processed and SENT."
        );
    } else {
        console.log("RESULT: ❌ FAILED");
    }

} catch (error) {
    console.error("\n[TEST] Scheduler test failed:");
    console.error(error);
} finally {
    await prisma.$disconnect();
}