import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// WHY WE MOCK BEFORE IMPORTING THE MODULE UNDER TEST
//
// evaluateAlertsForRate() imports three collaborators at module load:
//   - ../config/database.js       → opens a real pg Pool and DEMANDS DATABASE_URL
//   - ../queues/notification.queue.js → opens a real Redis/BullMQ connection
//   - ../utils/logger.js          → pino logger (noisy in test output)
//
// vi.mock() is hoisted above the imports, so when we `import` the SUT below the
// REAL versions of these modules never execute. That means these tests need no
// database, no Redis, and no env vars — they exercise the pure DECISION LOGIC in
// total isolation, which is exactly what we want from a fast unit test.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../config/database.js", () => ({
  // trigger.service.js uses a DEFAULT import (`import prisma from ...`), so the
  // mock must expose the client on `default`.
  default: {
    alert: { findMany: vi.fn() },
    // $transaction is the INTERACTIVE (callback) form. Our beforeEach wires it
    // to invoke the callback with a fake `tx`, so we can assert the writes that
    // happen inside the transaction.
    $transaction: vi.fn(),
  },
}));

vi.mock("../../queues/notification.queue.js", () => ({
  enqueueNotifications: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER the mocks are registered. These resolve to the mocked modules.
import prisma from "../../config/database.js";
import { enqueueNotifications } from "../../queues/notification.queue.js";
import { logger } from "../../utils/logger.js";
import { evaluateAlertsForRate } from "../../services/trigger.service.js";

describe("evaluateAlertsForRate", () => {
  let tx;

  beforeEach(() => {
    // Reset call history between tests (implementations survive clearAllMocks).
    vi.clearAllMocks();

    // A fresh fake transaction client per test. $transaction(cb) runs cb(tx),
    // mirroring Prisma's interactive-transaction contract.
    tx = {
      alert: { updateManyAndReturn: vi.fn() },
      alertNotification: { createMany: vi.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
  });

  it("returns [] and does NO work when no alerts match the rate", async () => {
    prisma.alert.findMany.mockResolvedValue([]);

    const result = await evaluateAlertsForRate({
      currencyPair: "USD_NGN",
      rate: "1600",
    });

    expect(result).toEqual([]);
    // Early return short-circuits before we open a transaction or touch Redis.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(enqueueNotifications).not.toHaveBeenCalled();
  });

  it("queries with correct ABOVE/BELOW semantics and coerces rate to a number", async () => {
    prisma.alert.findMany.mockResolvedValue([]);

    // rate arrives as a STRING (the scheduler passes rateData.rate.toString()).
    await evaluateAlertsForRate({ currencyPair: "USD_NGN", rate: "1600" });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          currencyPair: "USD_NGN",
          status: "PENDING",
          // ABOVE fires when the target is at/below the live rate;
          // BELOW fires when the target is at/above it. Numbers, not strings —
          // proves the Number(rate) coercion happened.
          OR: [
            { condition: "ABOVE", targetRate: { lte: 1600 } },
            { condition: "BELOW", targetRate: { gte: 1600 } },
          ],
        }),
      }),
    );
  });

  it("claims matched alerts, writes EMAIL outbox rows, enqueues, and returns the ids", async () => {
    prisma.alert.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    tx.alert.updateManyAndReturn.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    tx.alertNotification.createMany.mockResolvedValue({ count: 2 });
    enqueueNotifications.mockResolvedValue([]);

    const result = await evaluateAlertsForRate({
      currencyPair: "USD_NGN",
      rate: "1600",
    });

    expect(result).toEqual(["a1", "a2"]);

    // Outbox rows carry the deterministic dedupeKey `${id}:email:triggered`,
    // and skipDuplicates makes the write idempotent under a re-run.
    expect(tx.alertNotification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { alertId: "a1", channel: "EMAIL", dedupeKey: "a1:email:triggered" },
          { alertId: "a2", channel: "EMAIL", dedupeKey: "a2:email:triggered" },
        ],
        skipDuplicates: true,
      }),
    );

    // Enqueue happens AFTER the commit (transactional outbox), keyed identically
    // so BullMQ's jobId dedupes a double-enqueue.
    expect(enqueueNotifications).toHaveBeenCalledWith([
      { dedupeKey: "a1:email:triggered", alertId: "a1" },
      { dedupeKey: "a2:email:triggered", alertId: "a2" },
    ]);
  });

  it("no-ops safely when another worker already claimed the alerts (race)", async () => {
    // findMany saw a candidate, but by the time we UPDATE ... WHERE status =
    // 'PENDING', a competing worker had already flipped it. updateManyAndReturn
    // returns 0 rows → we must NOT create notifications or enqueue.
    prisma.alert.findMany.mockResolvedValue([{ id: "a1" }]);
    tx.alert.updateManyAndReturn.mockResolvedValue([]);

    const result = await evaluateAlertsForRate({
      currencyPair: "USD_NGN",
      rate: "1600",
    });

    expect(result).toEqual([]);
    expect(tx.alertNotification.createMany).not.toHaveBeenCalled();
    expect(enqueueNotifications).not.toHaveBeenCalled();
  });

  it("does NOT throw if enqueue fails — commit already happened, reconciler recovers", async () => {
    // THE resilience guarantee of the outbox: the DB commit is the source of
    // truth. If Redis is down when we try to enqueue, we log and swallow so the
    // cycle keeps running; the reconciler will re-enqueue the PENDING rows.
    prisma.alert.findMany.mockResolvedValue([{ id: "a1" }]);
    tx.alert.updateManyAndReturn.mockResolvedValue([{ id: "a1" }]);
    tx.alertNotification.createMany.mockResolvedValue({ count: 1 });
    enqueueNotifications.mockRejectedValue(new Error("Redis unreachable"));

    const result = await evaluateAlertsForRate({
      currencyPair: "USD_NGN",
      rate: "1600",
    });

    // Committed ids are still returned even though the enqueue blew up.
    expect(result).toEqual(["a1"]);
    // And we leave a breadcrumb for the reconciler trail.
    expect(logger.error).toHaveBeenCalled();
  });
});
