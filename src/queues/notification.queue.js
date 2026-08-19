import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "../config/redis.js";
import { logger } from "../utils/logger.js";

// Define the unique name of the queue channel
export const NOTIFICATION_QUEUE_NAME = "notifications";

// Define the specific identifier for the delivery task type
const JOB_NAME = "deliver-notification";

// Instantiate the main BullMQ Queue producer wrapper
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

// Intercept and log network connection failures safely
notificationQueue.on("error", (err) => {
  logger.debug({ err: err?.message }, "[QUEUE] notification queue error");
});

/**
 
 *
 * @param {{ dedupeKey: string, alertId?: string }} item
 */
// Push a single notification to Redis with a unique dedupe key
export const enqueueNotification = async ({ dedupeKey, alertId }) =>
  notificationQueue.add(
    JOB_NAME,
    { dedupeKey, alertId }, // job payload — the Worker looks the row up by dedupeKey
    { jobId: dedupeKey }, // <-- the dedupe primitive
  );

/**

 * @param {Array<{ dedupeKey: string, alertId?: string }>} items
 */
// Pipeline multiple notifications to Redis in a single network round-trip
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
// Disconnect from the Redis server safely during shutdown sequences
export const closeNotificationQueue = async () => {
  await notificationQueue.close();
};
