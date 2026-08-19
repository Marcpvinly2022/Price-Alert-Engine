import { describe, it, expect, vi, beforeEach } from "vitest";

// deliverNotification wires together the REAL prisma (named export), the channel
// sender, and the logger. We stub all three so this test touches no DB, no Redis,
// and no email provider:
//   - prisma: we drive alertNotification.findUnique/update + alert.findUnique per test
//   - sendNotification: stood in for here (its own routing is covered separately)
//   - logger: silenced, and lets us assert the "no row" warning
vi.mock("../../config/database.js", () => ({
  // IMPORTANT: notification.delivery.js imports { prisma } (a NAMED export),
  // unlike alerts.service.js which imports the default — so the mock only needs
  // to expose `prisma`.
  prisma: {
    alertNotification: { findUnique: vi.fn(), update: vi.fn() },
    alert: { findUnique: vi.fn() },
  },
}));
vi.mock("../../services/notification.sender.js", () => ({ sendNotification: vi.fn() }));
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "../../config/database.js";
import { sendNotification } from "../../services/notification.sender.js";
import { logger } from "../../utils/logger.js";
import { deliverNotification } from "../../services/notification.delivery.js";

// A PENDING row ready for delivery, plus the Alert row the provider needs.
const pendingRow = {
  id: "n1",
  alertId: "a1",
  channel: "EMAIL",
  status: "PENDING",
  dedupeKey: "a1:email:triggered",
};
const alertRow = {
  id: "a1",
  userEmail: "ada@example.com",
  phoneNumber: null,
  currencyPair: "USD_NGN",
  targetRate: "1360",
  condition: "BELOW",
};

describe("deliverNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips (no send, no write) when the notification row is gone", async () => {
    // The job outlived its row (deleted, or a stale job from an old run). It must
    // NOT throw — a throw would make BullMQ retry a row that will never exist.
    prisma.alertNotification.findUnique.mockResolvedValue(null);

    const result = await deliverNotification("missing:key");

    expect(result).toEqual({ skipped: true, reason: "not_found" });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(prisma.alertNotification.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("IDEMPOTENCY GATE: an already-SENT row is skipped without re-sending or re-writing", async () => {
    // The durable "never notify twice" guarantee: even if BullMQ replays the job,
    // a SENT row must not touch the provider or the DB a second time.
    prisma.alertNotification.findUnique.mockResolvedValue({
      ...pendingRow,
      status: "SENT",
    });

    const result = await deliverNotification(pendingRow.dedupeKey);

    expect(result).toEqual({
      skipped: true,
      reason: "already_sent",
      notificationId: "n1",
    });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(prisma.alert.findUnique).not.toHaveBeenCalled(); // never even loads the alert
    expect(prisma.alertNotification.update).not.toHaveBeenCalled();
  });

  it("happy path: PENDING → PROCESSING → SENT, sends once, records provider metadata", async () => {
    prisma.alertNotification.findUnique.mockResolvedValue({ ...pendingRow });
    prisma.alert.findUnique.mockResolvedValue({ ...alertRow });
    sendNotification.mockResolvedValue({
      provider: "log",
      providerMessageId: "msg-1",
    });

    const result = await deliverNotification(pendingRow.dedupeKey);

    // Two writes, in order: first PROCESSING (audit mirror), then terminal SENT.
    expect(prisma.alertNotification.update).toHaveBeenCalledTimes(2);
    const firstWrite = prisma.alertNotification.update.mock.calls[0][0];
    expect(firstWrite).toEqual({
      where: { id: "n1" },
      data: { status: "PROCESSING", processingAt: expect.any(Date) },
    });
    const secondWrite = prisma.alertNotification.update.mock.calls[1][0];
    expect(secondWrite.data).toEqual(
      expect.objectContaining({
        status: "SENT",
        sentAt: expect.any(Date),
        processingAt: null,
        provider: "log",
        providerMessageId: "msg-1",
      }),
    );

    // The provider is handed the notification WITH the alert attached.
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "n1",
        channel: "EMAIL",
        alert: expect.objectContaining({ userEmail: "ada@example.com" }),
      }),
    );

    expect(result).toEqual({
      sent: true,
      notificationId: "n1",
      provider: "log",
      providerMessageId: "msg-1",
    });
  });

  it("defaults provider metadata to null when the provider returns none", async () => {
    prisma.alertNotification.findUnique.mockResolvedValue({ ...pendingRow });
    prisma.alert.findUnique.mockResolvedValue({ ...alertRow });
    sendNotification.mockResolvedValue(undefined); // provider handed nothing back

    const result = await deliverNotification(pendingRow.dedupeKey);

    // The `result?.provider ?? null` guards collapse to null rather than undefined.
    const secondWrite = prisma.alertNotification.update.mock.calls[1][0];
    expect(secondWrite.data.provider).toBeNull();
    expect(secondWrite.data.providerMessageId).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.providerMessageId).toBeNull();
  });

  it("throws (for BullMQ to retry) when the alert row is missing — and never marks SENT", async () => {
    prisma.alertNotification.findUnique.mockResolvedValue({ ...pendingRow });
    prisma.alert.findUnique.mockResolvedValue(null);

    await expect(deliverNotification(pendingRow.dedupeKey)).rejects.toThrow(
      /Alert a1 was not found/,
    );

    // It marked PROCESSING (1 write) but never reached the SENT write, and never
    // called the provider.
    expect(prisma.alertNotification.update).toHaveBeenCalledTimes(1);
    expect(prisma.alertNotification.update.mock.calls[0][0].data.status).toBe(
      "PROCESSING",
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("propagates a provider failure and leaves the row PROCESSING (never SENT)", async () => {
    prisma.alertNotification.findUnique.mockResolvedValue({ ...pendingRow });
    prisma.alert.findUnique.mockResolvedValue({ ...alertRow });
    sendNotification.mockRejectedValue(new Error("smtp unreachable"));

    await expect(deliverNotification(pendingRow.dedupeKey)).rejects.toThrow(
      /smtp unreachable/,
    );

    // Critical: a failed send must NOT flip the row to SENT — only the PROCESSING
    // write happened, so BullMQ's retry (and the reconciler) can recover it later.
    expect(prisma.alertNotification.update).toHaveBeenCalledTimes(1);
    expect(prisma.alertNotification.update.mock.calls[0][0].data.status).toBe(
      "PROCESSING",
    );
  });
});
