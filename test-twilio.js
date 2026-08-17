import "dotenv/config";
import { prisma } from "./src/config/database.js";
import { processNotification } from "./src/services/notification.worker.js";

async function main() {
  console.log("\n========== SMS NOTIFICATION INTEGRATION TEST ==========\n");

  const phoneNumber = process.env.TEST_PHONE_NUMBER;

  if (!phoneNumber) {
    throw new Error("TEST_PHONE_NUMBER is not configured in .env");
  }

  console.log("[TEST] Phone:", phoneNumber);

  // --------------------------------------------------
  // 1. CREATE TEST ALERT
  // --------------------------------------------------

  const alert = await prisma.alert.create({
    data: {
      userId: "sms-test-user",
      userEmail: "sms-test@example.com",
      phoneNumber,
      currencyPair: "USD_NGN",
      targetRate: 2000,
      condition: "ABOVE",
      status: "TRIGGERED",
      triggeredAt: new Date(),
    },
  });

  console.log("\n[TEST] Created alert:");
  console.log({
    id: alert.id,
    phoneNumber: alert.phoneNumber,
    currencyPair: alert.currencyPair,
    targetRate: alert.targetRate,
    status: alert.status,
  });

  // --------------------------------------------------
  // 2. CREATE SMS NOTIFICATION
  // --------------------------------------------------

  const notification = await prisma.alertNotification.create({
    data: {
      alertId: alert.id,
      channel: "SMS",
      dedupeKey: `${alert.id}:sms:test`,
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

  // --------------------------------------------------
  // 3. PROCESS NOTIFICATION
  // --------------------------------------------------

  console.log("\n[TEST] Calling processNotification()...");
  console.log("[TEST] Sending SMS through application...\n");

  const result = await processNotification(notification.id);

  console.log("\n[TEST] processNotification() result:");
  console.dir(result, { depth: null });

  // --------------------------------------------------
  // 4. READ FINAL DATABASE STATE
  // --------------------------------------------------

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
  console.dir(finalNotification, { depth: null });

  // --------------------------------------------------
  // 5. ASSERT RESULT
  // --------------------------------------------------

  if (
    finalNotification.status === "SENT" &&
    finalNotification.provider === "twilio" &&
    finalNotification.providerMessageId
  ) {
    console.log("\n========== RESULT ==========");
    console.log(
      "RESULT: ✅ PASSED — SMS was sent through the application and recorded as SENT."
    );
  } else {
    console.log("\n========== RESULT ==========");
    console.log(
      "RESULT: ❌ FAILED — SMS notification was not successfully recorded."
    );
  }
}

main()
  .catch((error) => {
    console.error("\n[TEST] ❌ Test failed:");
    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });