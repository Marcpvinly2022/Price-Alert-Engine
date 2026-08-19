import { describe, it, expect, vi, beforeEach } from "vitest";

// The controller delegates all data work to rates.service, so we mock the service
// and assert only the HTTP shaping (status codes, envelope, error passthrough).
vi.mock("../../services/rates.service.js", () => ({ getLatestRate: vi.fn() }));

import * as rateService from "../../services/rates.service.js";
import { handleGetLatestRate } from "../../controllers/rates.controller.js";

function makeRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res); // chainable: res.status(200).json(...)
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("handleGetLatestRate", () => {
  let res, next;
  beforeEach(() => {
    vi.clearAllMocks();
    res = makeRes();
    next = vi.fn();
  });

  it("returns 200 + the rate when one exists, keyed off the path param", async () => {
    const row = { id: "r1", currencyPair: "USD_NGN", rate: "1555" };
    rateService.getLatestRate.mockResolvedValue(row);
    const req = { params: { currencyPair: "USD_NGN" } };

    await handleGetLatestRate(req, res, next);

    expect(rateService.getLatestRate).toHaveBeenCalledWith("USD_NGN");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: "SUCCESS", data: row });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns a 404 RATE_NOT_FOUND envelope when the pair has no rate", async () => {
    rateService.getLatestRate.mockResolvedValue(null);
    const req = { params: { currencyPair: "EUR_NGN" } };

    await handleGetLatestRate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    // status must be "FAIL" to match every other error envelope in the API
    // (this line caught the 'FALL' typo).
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAIL", error: "RATE_NOT_FOUND" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards unexpected errors to next() instead of responding itself", async () => {
    const boom = new Error("db unreachable");
    rateService.getLatestRate.mockRejectedValue(boom);
    const req = { params: { currencyPair: "USD_NGN" } };

    await handleGetLatestRate(req, res, next);

    // The central error handler owns the response — the controller must not write one.
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});
