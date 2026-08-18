import "dotenv/config";
import app from "./app.js";
import { disconnect } from "./config/database.js";
import { logger } from "./utils/logger.js";
import { runPriceAlertCycle } from "./scheduler/price-alert.scheduler.js";
import { assertRedisReachable } from "./config/redis.js";
import { createNotificationWorker } from "./workers/notification.worker.js";
import {
  startReconciler,
  stopReconciler,
} from "./queues/notification.reconciler.js";
import { closeNotificationQueue } from "./queues/notification.queue.js";

const PRICE_CHECK_INTERVAL =
  Number(process.env.PRICE_CHECK_INTERVAL_MS) || 30 * 60 * 1000;

// ── Optionally run the delivery Worker IN THIS PROCESS ──────────────────────
// Dev convenience: with RUN_WORKER_IN_PROCESS=true, a single `npm run dev` runs
// the whole system — API + price cycle + worker + reconciler — with no Docker
// and no second terminal. In PRODUCTION you leave this false and run the worker
// as its own process via `npm run worker` (as many copies as you need), so the
// API and the delivery fleet scale independently. Same code, two deploy shapes.
const RUN_WORKER_IN_PROCESS = process.env.RUN_WORKER_IN_PROCESS === "true";

let worker = null;
if (RUN_WORKER_IN_PROCESS) {
  // You explicitly asked to run the worker here, so a missing Redis is a real
  // error you want surfaced immediately — fail fast with a clear message.
  await assertRedisReachable();
  worker = createNotificationWorker();
  startReconciler();
  logger.info(
    "[SERVER] delivery worker + reconciler running in-process (RUN_WORKER_IN_PROCESS=true)",
  );
}

// Run one cycle immediately at boot, then every interval. The cycle now only
// fetches the rate, snapshots it, evaluates alerts, and ENQUEUES delivery jobs —
// it does not send email itself anymore.
await runPriceAlertCycle();

const priceCycleTimer = setInterval(() => {
  runPriceAlertCycle().catch((error) => {
    logger.error(
      { err: error?.message },
      "[PRICE ALERT] scheduled cycle failed",
    );
  });
}, PRICE_CHECK_INTERVAL);

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(
    `🔥 Price Alert Engine online. Processing traffic on port: ${PORT}`,
  );
});


let shuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (shuttingDown) return; // ignore a second Ctrl+C
  shuttingDown = true;
  logger.warn(`${signal} received. Winding down safely...`);

  clearInterval(priceCycleTimer); // 1
  stopReconciler(); // 2 (no-op if it was never started)

  // 3 — wait for the HTTP server to finish closing before touching data layers.
  await new Promise((resolve) => server.close(resolve));

  try {
    if (worker) await worker.close(); // 4
    await closeNotificationQueue(); // 5
    await disconnect(); // 6
    logger.info("Database + queue connections released. Engine offline.");
  } catch (error) {
    logger.error({ err: error?.message }, "Error during shutdown");
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
