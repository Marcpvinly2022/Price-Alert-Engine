import "dotenv/config";
import { prisma } from "./src/config/database.js";
import { processNotification } from "./src/services/notification.worker.js";

const TEST_EMAIL = "smayowa689@gmail.com";

async function main() {
  console.log("\n========== EMAIL NOTIFICATION INTEGRATION TEST ==========\n");

  console.log("[TEST] Email:", TEST_EMAIL);

  // 1. Create a test alert
  const alert = await prisma.alert.create({
    data: {
      userId: "resend-test-user",
      userEmail: TEST_EMAIL,
      currencyPair: "USD_NGN",
      targetRate: 2000,
      condition: "ABOVE",
      status: "TRIGGERED",
      triggeredAt: new Date(),
      phoneNumber: "+2349044716157",
    },
  });

  console.log("\n[TEST] Created alert:");
  console.log({
    id: alert.id,
    userEmail: alert.userEmail,
    currencyPair: alert.currencyPair,
    targetRate: Number(alert.targetRate),
    status: alert.status,
  });

  // 2. Create email notification
  const notification = await prisma.alertNotification.create({
    data: {
      alertId: alert.id,
      channel: "EMAIL",
      dedupeKey: `${alert.id}:email:test`,
      status: "PENDING",
    },
  });

  console.log("\n[TEST] Created notification:");
  console.log({
    id: notification.id,
    alertId: notification.alertId,
    channel: notification.channel,
    status: notification.status,
    dedupeKey: notification.dedupeKey,
  });

  // 3. Process notification
  console.log("\n[TEST] Calling processNotification()...");
  console.log("[TEST] Sending email through application...\n");

  const result = await processNotification(notification.id);

  console.log("[TEST] processNotification() result:");
  console.log(result);

  // 4. Read final database state
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
        provider: true,
        providerMessageId: true,
        error: true,
        attemptCount: true,
        sentAt: true,
        processingAt: true,
        nextRetryAt: true,
      },
    });

  console.log("\n[TEST] Final notification in database:");
  console.log(finalNotification);

  // 5. Validate result
  if (
    finalNotification?.status === "SENT" &&
    finalNotification?.provider === "resend" &&
    finalNotification?.providerMessageId
  ) {
    console.log("\n========== RESULT ==========");
    console.log(
      "RESULT: ✅ PASSED — Email was sent through the application and recorded as SENT.",
    );
  } else {
    console.log("\n========== RESULT ==========");
    console.log(
      "RESULT: ❌ FAILED — Email was not successfully recorded as SENT.",
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("\n[TEST] ❌ Test failed:");
  console.error(error);

  await prisma.$disconnect();
  process.exit(1);
});