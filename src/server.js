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

// ── 🛡️ PRODUCTION GLOBAL SAFETY NETS ───────────────────────────────────────
// Intercept asynchronous background promise rejections across your application

process.on("unhandledRejection", (reason) => {
  logger.error({
    msg: "[PROCESS EMERGENCY] Intercepted an unhandled background promise rejection. Keeping engine online.",
    reason: reason instanceof Error ? reason.stack : reason
  });
});


// Intercept synchronous execution branch failures before they trigger an runtime crash
process.on("uncaughtException", (error) => {
  logger.error({
    msg: "[PROCESS EMERGENCY] Intercepted an uncaught application exception thread. Keeping engine online.",
    err: error.stack
  })
})


const PRICE_CHECK_INTERVAL =
  Number(process.env.PRICE_CHECK_INTERVAL_MS) || 30 * 60 * 1000;

const RUN_WORKER_IN_PROCESS = process.env.RUN_WORKER_IN_PROCESS === "true";

let worker = null;
let workerStarted = false;


// 🔄 Automated background health checker and worker initializer
async function initializeQueueService() {
  if(!RUN_WORKER_IN_PROCESS || workerStarted) return;

  // Run the probe connection check
  const isRedisUp = await assertRedisReachable();

  if(isRedisUp){
    logger.info("[REDIS] Wire connection established! Initializing background worker engines...");
    worker = createNotificationWorker();
    startReconciler();
    workerStarted = true;
    logger.info("[SERVER] delivery worker + reconciler running in-process (RUN_WORKER_IN_PROCESS=true)");
  } else {
    logger.warn("[REDIS] Target offline. Fallback state active. Retrying engine auto-initialization in 10 seconds...");
    // ⏱️ Schedule a retry check in 10 seconds without blocking the rest of the application
    setTimeout(initializeQueueService, 10000); 
  }
}

initializeQueueService();

try {
  logger.info("[SERVER] Initializing synchronous boot-time validation engine cycle...");
  await runPriceAlertCycle();
} catch (bootError) {
  logger.error({ err: bootError.message }, "[SERVER] Boot check cycle failed safely. Proceeding to network listener loop.");
}

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
