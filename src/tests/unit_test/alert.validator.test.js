import { describe, it, expect, vi, beforeEach } from "vitest";


import { validateCreateAlert } from "../../validators/alert.validator.js";

// Minimal res double: status() and json() are chainable (the failure path calls
// res.status(400).json(...)), so both return `res`.
function makeRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("validateCreateAlert — phoneNumber gate", () => {
  let res, next;
  beforeEach(() => {
    res = makeRes();
    next = vi.fn();
  });

  it("accepts a valid international phoneNumber and forwards it on req.validatedBody", () => {
    const req = {
      body: {
        currencyPair: "USD_NGN",
        targetRate: 1600,
        condition: "BELOW",
        phoneNumber: "+2348012345678",
      },
    };

    validateCreateAlert(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled(); // no 400
    // The whole point of the fix: the number is NOT stripped, so the service
    // downstream can persist it.
    expect(req.validatedBody.phoneNumber).toBe("+2348012345678");
  });

  it("is optional — a request with no phoneNumber still validates (EMAIL-only alert)", () => {
    const req = {
      body: { currencyPair: "USD_NGN", targetRate: 1600, condition: "BELOW" },
    };

    validateCreateAlert(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // Omitted → key absent → service writes NULL. This is the default path.
    expect(req.validatedBody.phoneNumber).toBeUndefined();
  });

  it("rejects a malformed phoneNumber with a 400 VALIDATION_ERROR", () => {
    const req = {
      body: {
        currencyPair: "USD_NGN",
        targetRate: 1600,
        condition: "BELOW",
        phoneNumber: "12345", // too short for the international format
      },
    };

    validateCreateAlert(req, res, next);

    // Bad input never reaches the controller/service.
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAIL", error: "VALIDATION_ERROR" }),
    );
  });
});
