import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/supabase.js", () => ({
  supabase: { auth: { getUser: vi.fn() } },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { supabase } from "../../config/supabase.js";
import { requireAuth } from "../../middleware/auth.js";

// Minimal Express res double: status() and json() must be chainable
// (the middleware calls res.status(401).json(...)), so they return `res`.
function makeRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when the Authorization header is missing", async () => {
    const req = { headers: {} };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Access token missing.",
    });
    // Gate stays shut: we never call the token verifier and never pass control on.
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the header is malformed (not 'Bearer ')", async () => {
    const req = { headers: { authorization: "Token abc123" } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when Supabase returns an error for the token", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid JWT" },
    });
    const req = { headers: { authorization: "Bearer bad.token.here" } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    // The raw token (after "Bearer ") is what gets verified.
    expect(supabase.auth.getUser).toHaveBeenCalledWith("bad.token.here");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid or expired validation token.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when Supabase returns no user (even without an error)", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const req = { headers: { authorization: "Bearer expired.token" } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches a minimal req.user and calls next() on a valid token", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: {
        // Supabase returns a large user object; the middleware must copy ONLY
        // id + email downstream (no tokens/metadata leak into req.user).
        user: { id: "user-1", email: "ada@example.com", role: "authenticated" },
      },
      error: null,
    });
    const req = { headers: { authorization: "Bearer good.token" } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(req.user).toEqual({ id: "user-1", email: "ada@example.com" });
    expect(next).toHaveBeenCalledTimes(1);
    // On success it must NOT write a response — control passes to the route.
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 500 if the token verifier throws unexpectedly", async () => {
    supabase.auth.getUser.mockRejectedValue(new Error("supabase unreachable"));
    const req = { headers: { authorization: "Bearer any.token" } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal Identity Verification Exception.",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
