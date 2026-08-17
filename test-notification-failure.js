import prisma from "./src/config/database.js";
import { processNotification } from "./src/services/notification.worker.js";

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

console.log("\n========== FAILURE PATH TEST ==========");

console.log("\n[TEST] Target notification:");
console.log(notification);

console.log("\n[TEST] Processing notification...");

const result = await processNotification(notification.id);

console.log("\n[TEST] Worker result:");
console.log(result);

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
            nextRetryAt: true,
            lastErrorAt: true,
            processingAt: true,
            sentAt: true,
            error: true,
        },
    });

console.log("\n[TEST] Final database state:");
console.log(finalNotification);

await prisma.$disconnect();