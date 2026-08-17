
import { prisma } from "./src/config/database.js";
import { randomUUID } from "crypto";

const WORKERS = 10;

async function main() {
  console.log("\n========== END-TO-END CONCURRENCY TEST ==========\n");

  // ------------------------------------------------------------
  // 1. Find an alert that can be used for the test
  // ------------------------------------------------------------

  const existingAlert = await prisma.alert.findFirst();

  if (!existingAlert) {
    throw new Error("No alert found in database.");
  }

  // ------------------------------------------------------------
  // 2. Create a fresh alert so the test is isolated
  // ------------------------------------------------------------

  const alert = await prisma.alert.create({
    data: {
      userId: existingAlert.userId,
      userEmail: existingAlert.userEmail,
      currencyPair: "USD_NGN",
      targetRate: 2000,
      condition: "ABOVE",
      status: "PENDING",
    },
  });

  console.log("[TEST] Created test alert:");
  console.log({
    id: alert.id,
    status: alert.status,
    currencyPair: alert.currencyPair,
    targetRate: alert.targetRate,
    condition: alert.condition,
  });

  // Every worker will attempt to create the SAME logical notification.
  const dedupeKey = `${alert.id}:triggered`;

  console.log(`\n[TEST] Dedupe key: ${dedupeKey}`);
  console.log(`[TEST] Starting ${WORKERS} concurrent workers...\n`);

  // ------------------------------------------------------------
  // 3. Each worker:
  //
  //    A. Try to claim the alert
  //    B. If successful, mark it TRIGGERED
  //    C. Try to create the notification
  //
  // ------------------------------------------------------------

  async function worker(workerNumber) {
    try {
      /*
       * Atomic alert claim.
       *
       * Only one worker can change PENDING -> TRIGGERED.
       */
      const claimed = await prisma.alert.updateMany({
        where: {
          id: alert.id,
          status: "PENDING",
        },
        data: {
          status: "TRIGGERED",
          triggeredAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        return {
          worker: workerNumber,
          alertClaimed: false,
          notificationCreated: false,
          notificationId: null,
          error: null,
        };
      }

      /*
       * This worker won the alert race.
       *
       * Now it attempts to create the notification.
       *
       * The unique dedupeKey protects us against duplicate
       * logical notifications.
       */
      try {
        const notification =
          await prisma.alertNotification.create({
            data: {
              alertId: alert.id,
              channel: "LOG",
              dedupeKey,
              status: "PENDING",
              attemptCount: 0,
            },
          });

        return {
          worker: workerNumber,
          alertClaimed: true,
          notificationCreated: true,
          notificationId: notification.id,
          error: null,
        };
      } catch (error) {
        return {
          worker: workerNumber,
          alertClaimed: true,
          notificationCreated: false,
          notificationId: null,
          error: error.code ?? error.message,
        };
      }
    } catch (error) {
      return {
        worker: workerNumber,
        alertClaimed: false,
        notificationCreated: false,
        notificationId: null,
        error: error.code ?? error.message,
      };
    }
  }

  // ------------------------------------------------------------
  // 4. Launch all workers simultaneously
  // ------------------------------------------------------------

  const results = await Promise.all(
    Array.from(
      { length: WORKERS },
      (_, index) => worker(index + 1)
    )
  );

  // ------------------------------------------------------------
  // 5. Display worker results
  // ------------------------------------------------------------

  console.log("\n[TEST] Worker results:");

  console.table(
    results.map((result) => ({
      worker: result.worker,
      alertClaimed: result.alertClaimed,
      notificationCreated: result.notificationCreated,
      notificationId: result.notificationId ?? "NONE",
      error: result.error ?? "NONE",
    }))
  );

  // ------------------------------------------------------------
  // 6. Count successful claims
  // ------------------------------------------------------------

  const successfulClaims = results.filter(
    (result) => result.alertClaimed
  ).length;

  const successfulNotifications = results.filter(
    (result) => result.notificationCreated
  ).length;

  console.log(`\n[TEST] Successful alert claims: ${successfulClaims}`);
  console.log(
    `[TEST] Successful notification creates: ${successfulNotifications}`
  );

  // ------------------------------------------------------------
  // 7. Check the actual database state
  // ------------------------------------------------------------

  const finalAlert = await prisma.alert.findUnique({
    where: {
      id: alert.id,
    },
    select: {
      id: true,
      status: true,
      triggeredAt: true,
    },
  });

  const notifications =
    await prisma.alertNotification.findMany({
      where: {
        alertId: alert.id,
      },
      select: {
        id: true,
        alertId: true,
        channel: true,
        status: true,
        dedupeKey: true,
      },
    });

  console.log("\n[TEST] Final alert:");
  console.log(finalAlert);

  console.log("\n[TEST] Notifications in database:");
  console.table(notifications);

  // ------------------------------------------------------------
  // 8. Verify dedupe
  // ------------------------------------------------------------

  const uniqueDedupeKeys = new Set(
    notifications.map(
      (notification) => notification.dedupeKey
    )
  );

  console.log(
    `\n[TEST] Notifications: ${notifications.length}`
  );

  console.log(
    `[TEST] Unique dedupe keys: ${uniqueDedupeKeys.size}`
  );

  // ------------------------------------------------------------
  // 9. Assertions
  // ------------------------------------------------------------

  let passed = true;

  if (successfulClaims !== 1) {
    console.log(
      `\n❌ FAILED — Expected exactly 1 alert claim, got ${successfulClaims}`
    );

    passed = false;
  }

  if (finalAlert?.status !== "TRIGGERED") {
    console.log(
      `❌ FAILED — Alert should be TRIGGERED, got ${finalAlert?.status}`
    );

    passed = false;
  }

  if (notifications.length !== 1) {
    console.log(
      `❌ FAILED — Expected exactly 1 notification, got ${notifications.length}`
    );

    passed = false;
  }

  if (uniqueDedupeKeys.size !== 1) {
    console.log(
      `❌ FAILED — Expected exactly 1 unique dedupe key, got ${uniqueDedupeKeys.size}`
    );

    passed = false;
  }

  if (successfulNotifications !== 1) {
    console.log(
      `❌ FAILED — Expected exactly 1 successful notification creation, got ${successfulNotifications}`
    );

    passed = false;
  }

  // ------------------------------------------------------------
  // 10. Final result
  // ------------------------------------------------------------

  console.log("\n========== END-TO-END RESULT ==========");

  console.log(`Workers:                    ${WORKERS}`);
  console.log(`Successful alert claims:    ${successfulClaims}`);
  console.log(`Notifications created:      ${notifications.length}`);
  console.log(`Unique dedupe keys:         ${uniqueDedupeKeys.size}`);

  if (!passed) {
    console.log(
      "\nRESULT: ❌ FAILED — End-to-end concurrency guarantees are not satisfied."
    );

    process.exitCode = 1;
    return;
  }

  console.log(
    "\nRESULT: ✅ PASSED — Alert claiming and notification deduplication are concurrency-safe."
  );
}

main()
  .catch((error) => {
    console.error("\n[FATAL TEST ERROR]");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

