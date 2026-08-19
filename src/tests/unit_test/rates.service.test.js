import { describe, it, expect, vi, beforeEach } from "vitest";

// rates.service is a thin Prisma layer. Mock the pooled client (NAMED `prisma`
// export — same as notification.delivery, unlike alerts.service's default import).
// We deliberately do NOT mock @prisma/client so the real Prisma.Decimal runs.
vi.mock("../../config/database.js", () => ({
  prisma: { fxRate: { create: vi.fn(), findFirst: vi.fn() } },
}));

import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { saveRateSnapshot, getLatestRate } from "../../services/rates.service.js";

describe("rates.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveRateSnapshot", () => {
    it("persists a snapshot with the rate coerced to Prisma.Decimal", async () => {
      const created = { id: "r1" };
      prisma.fxRate.create.mockResolvedValue(created);

      const result = await saveRateSnapshot({
        currencyPair: "USD_NGN",
        rate: 1555.5,
        source: "LIVE_EXCHANGERATE_API",
      });

      const createArg = prisma.fxRate.create.mock.calls[0][0];
      expect(createArg.data.currencyPair).toBe("USD_NGN");
      expect(createArg.data.source).toBe("LIVE_EXCHANGERATE_API");
      // The numeric rate is stored as an exact Decimal — no float drift on money.
      expect(createArg.data.rate).toBeInstanceOf(Prisma.Decimal);
      expect(createArg.data.rate.toString()).toBe("1555.5");
      expect(result).toBe(created);
    });
  });

  describe("getLatestRate", () => {
    it("reads the most recent row for the pair (newest fetchedAt first)", async () => {
      const row = { id: "r1", currencyPair: "USD_NGN", rate: "1555" };
      prisma.fxRate.findFirst.mockResolvedValue(row);

      const result = await getLatestRate("USD_NGN");

      expect(prisma.fxRate.findFirst).toHaveBeenCalledWith({
        where: { currencyPair: "USD_NGN" },
        orderBy: { fetchedAt: "desc" }, // "latest" = most recently fetched
      });
      expect(result).toBe(row);
    });

    it("returns null when the pair has no snapshots yet", async () => {
      // This is the contract the controller relies on to emit its 404.
      prisma.fxRate.findFirst.mockResolvedValue(null);

      const result = await getLatestRate("EUR_NGN");

      expect(result).toBeNull();
    });
  });
});
