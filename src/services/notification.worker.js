import { prisma } from "../config/database.js";
import { sendNotification } from "./notification.sender.js";


const STALE_PROCESSING_MS =
  Number(process.env.NOTIFICATION_STALE_PROCESSING_MS) || 5 * 60 * 1000;

export const processNotification = async (notificationId) => {
  // 1. CLAIM THE NOTIFICATION
  const claimed = await prisma.alertNotification.updateManyAndReturn({
    where: {
      id: notificationId,
      status: "PENDING",
    },

    data: {
      status: "PROCESSING",
      processingAt: new Date(),
    },

    select: {
      id: true,
      alertId: true,
      channel: true,
      status: true,
      dedupeKey: true,
    },
  });

  // 2. SOMEONE ELSE ALREADY CLAIMED IT
  if (claimed.length === 0) {
    return {
      claimed: false,
      sent: false,
      notificationId,
    };
  }

  const notification = claimed[0];

  try {
    // 3. LOAD THE ALERT DATA NEEDED BY THE PROVIDER
    const alert = await prisma.alert.findUnique({
      where: {
        id: notification.alertId,
      },

      select: {
        id: true,
        userEmail: true,
        phoneNumber: true,
        currencyPair: true,
        targetRate: true,
        condition: true,
      },
    });

    if (!alert) {
      throw new Error(
        `Alert ${notification.alertId} was not found`
      );
    }

    // Attach the alert data to the notification object.
    // Providers can now use notification.alert.*
    notification.alert = alert;

    // 4. DELIVER
    const result = await sendNotification(notification);

    // 5. SUCCESS
    await prisma.alertNotification.update({
      where: {
        id: notification.id,
      },

      data: {
        status: "SENT",
        sentAt: new Date(),
        processingAt: null,
        nextRetryAt: null,

        provider: result?.provider ?? null,
        providerMessageId: result?.providerMessageId ?? null,
      },
    });

    return {
      claimed: true,
      sent: true,
      notificationId: notification.id,
      provider: result?.provider ?? null,
      providerMessageId: result?.providerMessageId ?? null,
    };
  } catch (error) {
    // 6. FAILURE
    const current = await prisma.alertNotification.findUnique({
      where: {
        id: notification.id,
      },

      select: {
        attemptCount: true,
      },
    });

    const attemptCount = (current?.attemptCount ?? 0) + 1;

    const MAX_ATTEMPTS = 5;

    const backoffMs =
      30 * 1000 * Math.pow(2, attemptCount - 1);

    const nextRetryAt =
      attemptCount < MAX_ATTEMPTS
        ? new Date(Date.now() + backoffMs)
        : null;

    await prisma.alertNotification.update({
      where: {
        id: notification.id,
      },

      data: {
        status: "FAILED",
        processingAt: null,

        attemptCount,

        lastErrorAt: new Date(),

        nextRetryAt,

        error: error.message,
      },
    });

    return {
      claimed: true,
      sent: false,
      notificationId: notification.id,
      error: error.message,
      attemptCount,
      nextRetryAt,
    };
  }
};
//recovery stale notification
export async function recoverStaleNotifications() {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  // THE CRITICAL REFACTOR:
  // We do the find, the conditional check, and the update in ONE atomic step!
  const recoveredNotifications =
    await prisma.alertNotification.updateManyAndReturn({
      where: {
        status: "PROCESSING",
        processingAt: {
          lt: staleBefore, // Only pick rows older than 5 mins
        },
      },
      data: {
        status: "PENDING",
        processingAt: null, // Reset the clock
      },
      select: {
        id: true, // Only grab the IDs so we can log them
      },
    });

  // Since it returns an array of the successfully updated records,
  // we can use a standard JS loop just for logging (Zero extra DB calls!)
  for (const notification of recoveredNotifications) {
    console.log(
      `[NOTIFICATION] Recovered stale notification ${notification.id}`,
    );
  }

  console.log(
    `[NOTIFICATION] Recovered ${recoveredNotifications.length} stale notification(s)`,
  );

  return recoveredNotifications.length;
}

// retryDueNotifications
export async function retryDueNotifications() {
  const now = new Date();

  const retryableNotifications =
    await prisma.alertNotification.updateManyAndReturn({
      where: {
        status: "FAILED",

        nextRetryAt: {
          lte: now,
        },

        attemptCount: {
          lt: 5,
        },
      },

      data: {
        status: "PENDING",
        nextRetryAt: null,
      },

      select: {
        id: true,
      },
    });

  for (const notification of retryableNotifications) {
    console.log(
      `[NOTIFICATION] Retry scheduled for notification ${notification.id}`,
    );
  }

  console.log(
    `[NOTIFICATION] Moved ${retryableNotifications.length} notification(s) from FAILED to PENDING`,
  );

  return retryableNotifications.length;
}


