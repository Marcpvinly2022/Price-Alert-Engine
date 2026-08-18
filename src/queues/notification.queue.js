

import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "../config/redis.js";
import { logger } from "../utils/logger.js";


export const NOTIFICATION_QUEUE_NAME = "notifications";


const JOB_NAME = "deliver-notification";

export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {

  connection: getRedisConnectionOptions(),


  defaultJobOptions: {

    attempts: 5,

    // Exponential backoff. BullMQ computes delay = 2^(attemptsMade-1) * delay.

    backoff: { type: "exponential", delay: 30_000 },

    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Surface Redis/queue-level errors instead of letting an unhandled 'error' event
// crash the process. This is our visibility into "Redis went away".
notificationQueue.on("error", (err) => {
  logger.error({ err: err?.message }, "[QUEUE] notification queue error");
});

/**
 
 *
 * @param {{ dedupeKey: string, alertId?: string }} item
 */
export const enqueueNotification = async ({ dedupeKey, alertId }) =>
  notificationQueue.add(
    JOB_NAME,
    { dedupeKey, alertId }, // job payload — the Worker looks the row up by dedupeKey
    { jobId: dedupeKey }, // <-- the dedupe primitive
  );

/**

 * @param {Array<{ dedupeKey: string, alertId?: string }>} items
 */
export const enqueueNotifications = async (items) => {
  if (!items || items.length === 0) return [];

  const jobs = items.map((item) => ({
    name: JOB_NAME,
    data: { dedupeKey: item.dedupeKey, alertId: item.alertId },
    opts: { jobId: item.dedupeKey }, // same per-job dedupe as the single-add path
  }));

  return notificationQueue.addBulk(jobs);
};

/**
 * Close the producer connection. Called during graceful shutdown AFTER the
 * worker has drained, so no in-flight enqueue is cut off.
 */
export const closeNotificationQueue = async () => {
  await notificationQueue.close();
};
