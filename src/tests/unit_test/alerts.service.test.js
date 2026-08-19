import { describe, it, expect, vi, beforeEach } from "vitest";


vi.mock("../../config/database.js", () => ({
  default: {
    alert: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../config/database.direct.js", () => ({ default: {} }));


import prisma from "../../config/database.js";
import {
  createNewUserAlert,
  fetchPaginatedUserAlerts,
  removeUserAlert,
} from "../../services/alerts.service.js";

describe("alerts.service", () => {
  beforeEach(() => {
    // resetAllMocks wipes both call history AND per-test implementations, so no
    // mockResolvedValue leaks into the next test. Re-arm $transaction's array
    // form (fetchPaginatedUserAlerts calls prisma.$transaction([findMany, count])).
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );
  });

  describe("createNewUserAlert", () => {
    it("creates the alert when no matching PENDING alert exists", async () => {
      prisma.alert.findFirst.mockResolvedValue(null); // no duplicate
      const created = { id: "new-1", currencyPair: "USD_NGN" };
      prisma.alert.create.mockResolvedValue(created);

      const result = await createNewUserAlert("user-1", "ada@example.com", {
        currencyPair: "USD_NGN",
        targetRate: 1600,
        condition: "ABOVE",
      });

      expect(result).toBe(created);

      // Dedup is scoped to status PENDING — only an ACTIVE alert counts as a
      // duplicate; a past TRIGGERED one must not block a new one.
      expect(prisma.alert.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: "user-1",
          currencyPair: "USD_NGN",
          condition: "ABOVE",
          status: "PENDING",
        }),
      });

      // The numeric targetRate is stored as a Prisma.Decimal for exact precision.
      const createArg = prisma.alert.create.mock.calls[0][0];
      expect(createArg.data).toEqual(
        expect.objectContaining({
          userId: "user-1",
          userEmail: "ada@example.com",
          currencyPair: "USD_NGN",
          condition: "ABOVE",
        }),
      );
      expect(createArg.data.targetRate.toString()).toBe("1600");
      // No phoneNumber sent → not written (EMAIL-only alert; stored as NULL).
      expect(createArg.data.phoneNumber).toBeUndefined();
    });

    it("stores an optional phoneNumber when the client provides one", async () => {
      prisma.alert.findFirst.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "new-2" });

      await createNewUserAlert("user-1", "ada@example.com", {
        currencyPair: "USD_NGN",
        targetRate: 1600,
        condition: "BELOW",
        phoneNumber: "+2348012345678",
      });

      // The number flows straight from validatedBody → create data; Prisma then
      // persists it. (Actually sending an SMS is a separate, not-yet-wired step.)
      const createArg = prisma.alert.create.mock.calls[0][0];
      expect(createArg.data.phoneNumber).toBe("+2348012345678");
    });

    it("throws a 409 and does NOT create when a duplicate already exists", async () => {
      prisma.alert.findFirst.mockResolvedValue({ id: "existing-1" });

      const err = await createNewUserAlert("user-1", "ada@example.com", {
        currencyPair: "USD_NGN",
        targetRate: 1600,
        condition: "ABOVE",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("A similar active alert already exists");
      expect(err.statusCode).toBe(409); // controller maps this to an HTTP 409
      expect(prisma.alert.create).not.toHaveBeenCalled();
    });
  });

  describe("fetchPaginatedUserAlerts", () => {
    it("clamps out-of-range page/limit (page→min 1, limit→max 50)", async () => {
      prisma.alert.findMany.mockResolvedValue([]);
      prisma.alert.count.mockResolvedValue(0);

      const result = await fetchPaginatedUserAlerts("user-1", -5, 999);

      expect(prisma.alert.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
        skip: 0, // page clamped to 1 → (1-1)*50
        take: 50, // limit clamped to the 50 ceiling
      });
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalCount).toBe(0);
      expect(result.meta.totalPages).toBe(0); // ceil(0/50)
    });

    it("computes skip and totalPages for a normal page", async () => {
      prisma.alert.findMany.mockResolvedValue([{ id: "a1" }]);
      prisma.alert.count.mockResolvedValue(25);

      const result = await fetchPaginatedUserAlerts("user-1", 3, 10);

      expect(prisma.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }), // (3-1)*10
      );
      expect(result.meta.page).toBe(3);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.totalPages).toBe(3); // ceil(25/10)
      expect(result.meta.id).toBe("user-1"); // regression guard: was userId.id (undefined)
      expect(result.alerts).toEqual([{ id: "a1" }]);
    });
  });

  describe("removeUserAlert", () => {
    it("returns null and does NOT delete when the alert isn't found/owned", async () => {
      prisma.alert.findFirst.mockResolvedValue(null);

      const result = await removeUserAlert("alert-1", "user-1");

      expect(result).toBeNull();
      expect(prisma.alert.delete).not.toHaveBeenCalled();
    });

    it("deletes and returns true when the alert is found and owned", async () => {
      prisma.alert.findFirst.mockResolvedValue({
        id: "alert-1",
        userId: "user-1",
      });
      prisma.alert.delete.mockResolvedValue({ id: "alert-1" });

      const result = await removeUserAlert("alert-1", "user-1");

      expect(result).toBe(true);
      // Ownership gate: the lookup is scoped by BOTH id AND userId, so one user
      // can never delete another user's alert.
      expect(prisma.alert.findFirst).toHaveBeenCalledWith({
        where: { id: "alert-1", userId: "user-1" },
      });
      expect(prisma.alert.delete).toHaveBeenCalledWith({
        where: { id: "alert-1" },
      });
    });
  });
});
