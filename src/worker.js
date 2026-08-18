

import "dotenv/config";
import { assertRedisReachable } from "./config/redis.js";
import { createNotificationWorker } from "./workers/notification.worker.js";
import {
  startReconciler,
  stopReconciler,
} from "./queues/notification.reconciler.js";
import { closeNotificationQueue } from "./queues/notification.queue.js";
import { disconnect } from "./config/database.js";
import { logger } from "./utils/logger.js";

// Fail fast with a clear message if the Ubuntu VM's Redis isn't reachable,
// rather than booting into a silent "nothing ever delivers" state.
await assertRedisReachable();

const worker = createNotificationWorker();
startReconciler();

logger.info("[WORKER] standalone notification worker process online");

// Guard so double signals (Ctrl+C twice) don't run teardown twice.
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn({ signal }, "[WORKER] shutting down…");
  try {
    // ORDER MATTERS:
    stopReconciler(); // 1. stop scheduling new sweeps
    await worker.close(); // 2. stop pulling new jobs AND wait for active ones to finish
    await closeNotificationQueue(); // 3. close the producer connection the reconciler used
    await disconnect(); // 4. only now let go of Postgres — after all DB writes are done
    logger.info("[WORKER] clean shutdown complete");
  } catch (err) {
    logger.error({ err: err?.message }, "[WORKER] error during shutdown");
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
