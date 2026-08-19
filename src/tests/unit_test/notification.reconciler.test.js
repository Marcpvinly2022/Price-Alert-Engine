import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The reconciler talks to Postgres (named `prisma` export), the BullMQ queue, and
// the logger. We stub all three so the sweep does no real DB/Redis work:
//   - prisma: we drive alertNotification.findMany per test
//   - enqueueNotifications: observed (mocking it also avoids constructing the real
//     BullMQ Queue, which would need a Redis connection at import time)
//   - logger: silenced, and lets us assert the truncation warning
vi.mock("../../config/database.js", () => ({
  prisma: { alertNotification: { findMany: vi.fn() } },
}));
vi.mock("../../queues/notification.queue.js", () => ({ enqueueNotifications: vi.fn() }));
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "../../config/database.js";
import { enqueueNotifications } from "../../queues/notification.queue.js";
import { logger } from "../../utils/logger.js";

// BATCH / GRACE / INTERVAL are read from env AT MODULE LOAD. To hit the batch-cap
// branch without fabricating 1000 rows, we stub a tiny batch and re-import the
// module fresh per test (resetModules drops the ESM cache; the vi.mock stubs above
// persist across the reset, so the fresh copy still sees the same mock fns).
async function loadReconciler() {
  vi.resetModules();
  return import("../../queues/notification.reconciler.js");
}

// A PENDING orphan as findMany returns it (only dedupeKey + alertId are selected).
const orphan = (id) => ({ dedupeKey: `${id}:email:triggered`, alertId: id });

describe("notification.reconciler", () => {
  describe("reconcileOnce", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv("RECONCILER_BATCH_SIZE", "2"); // small cap so we can reach it
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("no-ops (returns 0, never enqueues) when there are no orphans", async () => {
      prisma.alertNotification.findMany.mockResolvedValue([]);
      const { reconcileOnce } = await loadReconciler();

      const count = await reconcileOnce();

      expect(count).toBe(0);
      expect(enqueueNotifications).not.toHaveBeenCalled();
    });

    it("queries only stale PENDING rows, oldest first, capped by the batch size", async () => {
      prisma.alertNotification.findMany.mockResolvedValue([orphan("a1")]);
      const { reconcileOnce } = await loadReconciler();

      await reconcileOnce();

      // status PENDING + createdAt older than the grace cutoff = an enqueue that
      // never landed. `expect.any(Date)` sidesteps needing to freeze the clock.
      expect(prisma.alertNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "PENDING", createdAt: { lt: expect.any(Date) } },
          take: 2, // our stubbed RECONCILER_BATCH_SIZE
          orderBy: { createdAt: "asc" }, // oldest first — fairest recovery order
        }),
      );
    });

    it("re-enqueues exactly the orphans it found and returns the count", async () => {
      const orphans = [orphan("a1")]; // below the batch cap of 2
      prisma.alertNotification.findMany.mockResolvedValue(orphans);
      const { reconcileOnce } = await loadReconciler();

      const count = await reconcileOnce();

      expect(enqueueNotifications).toHaveBeenCalledWith(orphans);
      expect(count).toBe(1);
      expect(logger.warn).not.toHaveBeenCalled(); // didn't hit the cap → no warning
    });

    it("warns about truncation when the batch cap is hit (more may remain)", async () => {
      // Exactly BATCH (2) rows → the sweep is full, so there may be more to do.
      // The reconciler must SAY SO rather than look like it covered everything.
      const full = [orphan("a1"), orphan("a2")];
      prisma.alertNotification.findMany.mockResolvedValue(full);
      const { reconcileOnce } = await loadReconciler();

      const count = await reconcileOnce();

      expect(count).toBe(2);
      expect(enqueueNotifications).toHaveBeenCalledWith(full);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ batch: 2 }),
        expect.stringContaining("batch cap"),
      );
    });
  });

  describe("startReconciler / stopReconciler", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      prisma.alertNotification.findMany.mockResolvedValue([]); // ticks are harmless
      vi.stubEnv("RECONCILER_INTERVAL_MS", "1000");
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it("is idempotent — start twice creates ONE interval, and stop clears it", async () => {
      // Load under real timers (dynamic import), THEN switch to fake timers so the
      // interval is observable via getTimerCount().
      const { startReconciler, stopReconciler } = await loadReconciler();
      vi.useFakeTimers();

      startReconciler();
      startReconciler(); // second call must be a no-op — timer already set
      expect(vi.getTimerCount()).toBe(1);

      stopReconciler();
      expect(vi.getTimerCount()).toBe(0);
      expect(logger.info).toHaveBeenCalledWith("[RECONCILER] stopped");
    });

    it("runs a reconcile sweep on each interval tick", async () => {
      const { startReconciler, stopReconciler } = await loadReconciler();
      vi.useFakeTimers();

      startReconciler();
      // setInterval doesn't fire immediately — nothing swept yet.
      expect(prisma.alertNotification.findMany).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000); // one interval elapses

      expect(prisma.alertNotification.findMany).toHaveBeenCalledTimes(1);
      stopReconciler();
    });
  });
});
