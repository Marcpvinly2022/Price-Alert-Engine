import prisma from "./src/config/database.js";

const alert = await prisma.alert.findFirst({
    select: {
        id: true,
    },
});

if (!alert) {
    console.log("No Alert found.");
    await prisma.$disconnect();
    process.exit(1);
}

const notification = await prisma.alertNotification.create({
    data: {
        alertId: alert.id,
        channel: "EMAIL",
        dedupeKey: `failure-test-${Date.now()}`,
        status: "PENDING",
    },

    select: {
        id: true,
        alertId: true,
        channel: true,
        status: true,
        attemptCount: true,
    },
});

console.log("\n[TEST] Created failure-test notification:");
console.log(notification);

await prisma.$disconnect();