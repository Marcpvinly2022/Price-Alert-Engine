

import { Worker } from "bullmq";
import { getRedisConnectionOptions } from "../config/redis.js";
import { NOTIFICATION_QUEUE_NAME } from "../queues/notification.queue.js";
import { deliverNotification } from "../services/notification.delivery.js";
import { prisma } from "../config/database.js";
import { logger } from "../utils/logger.js";


const CONCURRENCY = Number(process.env.NOTIFICATION_WORKER_CONCURRENCY) || 10;


const RATE_LIMIT_PER_SEC =
  Number(process.env.NOTIFICATION_RATE_LIMIT_PER_SEC) || 20;

/**
 * Create and start a notification Worker.
 *
 * We return the instance (rather than a module-level singleton) so the caller —
 * the standalone worker process, or the API server in dev — owns its lifecycle
 * and can close it cleanly on shutdown.
 */
export const createNotificationWorker = () => {
  const worker = new Worker(
    NOTIFICATION_QUEUE_NAME,

    // The processor. Its return value becomes the job's "returnvalue"; throwing
    // marks the attempt failed and triggers BullMQ's retry/backoff.
    async (job) => deliverNotification(job.data.dedupeKey),

    {
      // Own connection OPTIONS → BullMQ creates the DEDICATED BLOCKING
    
      connection: getRedisConnectionOptions(),
      concurrency: CONCURRENCY,
      limiter: { max: RATE_LIMIT_PER_SEC, duration: 1000 },
    },
  );

  // ---- Observability + the DB audit for failures -------------------------

  // Fired once per job that finishes without throwing (includes idempotent
  // skips). deliverNotification already wrote SENT to Postgres; here we just log.
  worker.on("completed", (job, result) => {
    if (result?.skipped) {
      logger.debug(
        { jobId: job.id, reason: result.reason },
        "[WORKER] skipped (idempotent)",
      );
    } else {
      logger.info(
        { jobId: job.id, provider: result?.provider },
        "[WORKER] delivered",
      );
    }
  });

  // Fired on EVERY failed attempt — not only the last. This is where we mirror
 
  worker.on("failed", async (job, err) => {
    if (!job) {
      // Rare: a failure with no job reference (e.g. during shutdown).
      logger.error({ err: err?.message }, "[WORKER] failed with no job ref");
      return;
    }

    const totalAttempts = job.opts?.attempts ?? 1;
    // In BullMQ v6 attemptsMade is incremented BEFORE this event, so after the
    // 5th failure it equals 5 === totalAttempts → this attempt was terminal.
    const attemptsMade = job.attemptsMade;
    const isTerminal = attemptsMade >= totalAttempts;

    // Build the audit patch. On non-terminal attempts we intentionally do NOT

    const data = {
      attemptCount: attemptsMade,
      error: err?.message ?? "unknown error",
      lastErrorAt: new Date(),
    };
    if (isTerminal) {
      data.status = "FAILED";
      data.processingAt = null;
    }

    try {
      // updateMany (not update) so we can add `status: { not: "SENT" }` to the
    
      await prisma.alertNotification.updateMany({
        where: { dedupeKey: job.data.dedupeKey, status: { not: "SENT" } },
        data,
      });
    } catch (dbErr) {
      logger.error(
        { dbErr: dbErr?.message, jobId: job.id },
        "[WORKER] could not write failure audit",
      );
    }

    logger.warn(
      {
        jobId: job.id,
        attemptsMade,
        totalAttempts,
        err: err?.message,
      },
      isTerminal
        ? "[WORKER] delivery FAILED (terminal)"
        : "[WORKER] attempt failed, will retry",
    );
  });

  // Worker-level (usually connection) errors. Logged, not fatal — the
  // retryStrategy in redis.js keeps trying to reconnect underneath.
  worker.on("error", (err) => {
    logger.error({ err: err?.message }, "[WORKER] worker error");
  });

  logger.info(
    { concurrency: CONCURRENCY, rateLimitPerSec: RATE_LIMIT_PER_SEC },
    "[WORKER] notification worker started",
  );

  return worker;
};
