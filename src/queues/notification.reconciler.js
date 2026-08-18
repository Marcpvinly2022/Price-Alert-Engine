

import { prisma } from "../config/database.js";
import { enqueueNotifications } from "./notification.queue.js";
import { logger } from "../utils/logger.js";

// How often to sweep.
const INTERVAL_MS = Number(process.env.RECONCILER_INTERVAL_MS) || 30_000;

// Only re-enqueue rows OLDER than this. The grace window avoids racing a healthy
// enqueue that's about to happen milliseconds after commit — we only want rows
// that have been PENDING "too long", which signals the enqueue never landed.
const GRACE_MS = Number(process.env.RECONCILER_GRACE_MS) || 30_000;

// Cap work per tick so one sweep can't try to load a million rows at once.
const BATCH = Number(process.env.RECONCILER_BATCH_SIZE) || 1_000;

let timer = null;

/**
 * One reconciliation pass. Exported so it can be unit-tested or invoked manually
 * during verification.
 */
export const reconcileOnce = async () => {
  const cutoff = new Date(Date.now() - GRACE_MS);

  const orphans = await prisma.alertNotification.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { dedupeKey: true, alertId: true },
    take: BATCH,
    orderBy: { createdAt: "asc" }, // oldest first — fairest recovery order
  });

  if (orphans.length === 0) return 0;

  // Idempotent thanks to jobId=dedupeKey: any orphan that actually DID reach
  // Redis is silently ignored here.
  await enqueueNotifications(orphans);

  logger.info(
    { count: orphans.length },
    "[RECONCILER] re-enqueued PENDING orphan(s)",
  );

  // Never hide a truncation: if we filled the batch there may be more, which the
  // next tick will pick up. Say so rather than looking like we covered everything.
  if (orphans.length === BATCH) {
    logger.warn(
      { batch: BATCH },
      "[RECONCILER] hit batch cap; remaining orphans handled next tick",
    );
  }

  return orphans.length;
};

/**
 * Start the periodic sweep. Idempotent — calling twice won't create two timers.
 */
export const startReconciler = () => {
  if (timer) return;

  timer = setInterval(() => {
    // Never let a failed sweep crash the process; log and try again next tick.
    reconcileOnce().catch((err) =>
      logger.error({ err: err?.message }, "[RECONCILER] tick failed"),
    );
  }, INTERVAL_MS);

  // unref() so this timer alone won't keep the process alive — during shutdown
  // we want the process free to exit once real work is drained.
  if (typeof timer.unref === "function") timer.unref();

  logger.info(
    { intervalMs: INTERVAL_MS, graceMs: GRACE_MS, batch: BATCH },
    "[RECONCILER] started",
  );
};

/**
 * Stop the sweep. Called during graceful shutdown.
 */
export const stopReconciler = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info("[RECONCILER] stopped");
};
