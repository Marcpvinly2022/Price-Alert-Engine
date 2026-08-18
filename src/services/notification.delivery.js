

import { prisma } from "../config/database.js";
import { sendNotification } from "./notification.sender.js";
import { logger } from "../utils/logger.js";

/**
 * Deliver a single notification identified by its unique dedupeKey.
 *
 * Returns a result object on success/skip. THROWS on delivery failure so BullMQ
 * registers the attempt as failed and schedules the next retry.
 *
 * @param {string} dedupeKey  e.g. "<alertId>:email:triggered"
 */
export const deliverNotification = async (dedupeKey) => {
  // Load the durable notification row — Postgres is the source of truth.
  const notification = await prisma.alertNotification.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      alertId: true,
      channel: true,
      status: true,
      dedupeKey: true,
    },
  });

  // Job outlived its row (e.g. row was deleted, or a stale job from an old run).

  if (!notification) {
    logger.warn({ dedupeKey }, "[DELIVERY] no notification row; skipping");
    return { skipped: true, reason: "not_found" };
  }

  // DURABLE IDEMPOTENCY GATE — "never notify twice", the layer that still

  if (notification.status === "SENT") {
    return {
      skipped: true,
      reason: "already_sent",
      notificationId: notification.id,
    };
  }

  //  Mark PROCESSING (audit mirror in Postgres). NOTE: this is unconditional,
  await prisma.alertNotification.update({
    where: { id: notification.id },
    data: { status: "PROCESSING", processingAt: new Date() },
  });

  // Load the Alert the provider needs (recipient email, pair, target, …).
  const alert = await prisma.alert.findUnique({
    where: { id: notification.alertId },
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
    // Throwing here lets BullMQ retry; but a missing alert won't fix itself, so
   
    throw new Error(`Alert ${notification.alertId} was not found`);
  }

  // The provider reads notification.alert.* (same shape the old worker built).
  notification.alert = alert;

  //  DELIVER. Throws on provider failure → BullMQ handles the retry.
  const result = await sendNotification(notification);

  // 6. SUCCESS → terminal SENT, with provider metadata for the audit trail.
  await prisma.alertNotification.update({
    where: { id: notification.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      processingAt: null,
      nextRetryAt: null, // vestigial under BullMQ, cleared for tidiness
      provider: result?.provider ?? null,
      providerMessageId: result?.providerMessageId ?? null,
    },
  });

  return {
    sent: true,
    notificationId: notification.id,
    provider: result?.provider ?? null,
    providerMessageId: result?.providerMessageId ?? null,
  };
};
