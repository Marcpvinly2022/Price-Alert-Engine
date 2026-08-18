import { prisma } from "./src/config/database.js";
import {
    recoverStaleNotifications,
    processNotification,
} from "./src/services/notification.worker.js";

try {
    console.log("\n========== STALE NOTIFICATION RECOVERY TEST ==========\n");

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

    // 2. Create a notification that looks like a worker crashed
    //
    // We intentionally set:
    // status = PROCESSING
    // processingAt = older than the stale threshold
    //
    const staleTime = new Date(
        Date.now() - 10 * 60 * 1000
    );

    const notification = await prisma.alertNotification.create({
        data: {
            alertId: alert.id,
            channel: "LOG",
            dedupeKey: `stale-recovery-test-${Date.now()}`,
            status: "PROCESSING",
            processingAt: staleTime,
            attemptCount: 0,
        },

        select: {
            id: true,
            alertId: true,
            channel: true,
            status: true,
            processingAt: true,
        },
    });

    console.log("[TEST] Created stale notification:");
    console.log(notification);

    // 3. Run recovery
    console.log("\n[TEST] Running stale recovery...");

    const recovered = await recoverStaleNotifications();

    console.log(
        `\n[TEST] Recovered notifications: ${recovered}`
    );

    // 4. Check state after recovery
    const afterRecovery =
        await prisma.alertNotification.findUnique({
            where: {
                id: notification.id,
            },

            select: {
                id: true,
                status: true,
                processingAt: true,
                attemptCount: true,
            },
        });

    console.log("\n[TEST] State after recovery:");
    console.log(afterRecovery);

    // 5. Verify it became PENDING
    if (
        afterRecovery?.status !== "PENDING" ||
        afterRecovery.processingAt !== null
    ) {
        console.log(
            "\nRESULT: ❌ FAILED — stale notification was not recovered."
        );

        process.exit(1);
        //return; 
    }

    console.log(
        "\n[TEST] Recovery successful. Notification is PENDING again."
    );

    // 6. Now process the recovered notification
    console.log(
        "\n[TEST] Processing recovered notification..."
    );

    const result =
        await processNotification(notification.id);

    console.log("\n[TEST] Worker result:");
    console.log(result);

    // 7. Read final state
    const finalNotification =
        await prisma.alertNotification.findUnique({
            where: {
                id: notification.id,
            },

            select: {
                id: true,
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

    // 8. Assertions
    const passed =
        recovered === 1 &&
        result.claimed === true &&
        result.sent === true &&
        finalNotification?.status === "SENT" &&
        finalNotification.processingAt === null &&
        finalNotification.sentAt !== null &&
        finalNotification.error === null &&
        finalNotification.nextRetryAt === null;

    console.log("\n========== RECOVERY RESULT ==========");

    console.log(`Recovered:       ${recovered}`);
    console.log(`Claimed:         ${result.claimed}`);
    console.log(`Sent:            ${result.sent}`);
    console.log(`Final status:    ${finalNotification?.status}`);

    if (passed) {
        console.log(
            "\nRESULT: ✅ PASSED — Stale notification was recovered and successfully sent."
        );
    } else {
        console.log(
            "\nRESULT: ❌ FAILED — Stale notification recovery is incorrect."
        );

        process.exitCode = 1;
    }

} catch (error) {
    console.error(
        "\n[TEST] Stale recovery test failed:"
    );
    console.error(error);

    process.exitCode = 1;

} finally {
    await prisma.$disconnect();
}