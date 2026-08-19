import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure Zod middleware — no DB, no network — so we drive it with a fake req/res/next
// and mock nothing. Two behaviours worth pinning beyond the field rules:
//   1. validate() is HIGHER-ORDER: validate(schema) returns the middleware.
//   2. The schema wraps input under `body`, but the middleware UNWRAPS it, so
//      req.validatedBody is the flat object (parsed.body), not { body: ... }.
import { registerSchema, loginSchema, validate } from "../../validators/auth.validator.js";

function makeRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res); // chainable: res.status(400).json(...)
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
// The failure path writes { status, error, details: err.issues }. These pull the
// Zod issues back out so we can assert on them.
function detailMessages(res) {
  return res.json.mock.calls[0][0].details.map((issue) => issue.message);
}
function detailPaths(res) {
  return res.json.mock.calls[0][0].details.map((issue) => issue.path?.join("."));
}

const registerMw = validate(registerSchema);
const loginMw = validate(loginSchema);

const validRegisterBody = {
  firstName: "Ada",
  lastName: "Lovelace",
  displayName: "ada",
  phone: "+2348012345678",
  email: "ada@example.com",
  password: "Str0ng!pass", // upper + lower + digit + special, ≥ 8 chars
};

describe("auth.validator", () => {
  let res, next;
  beforeEach(() => {
    res = makeRes();
    next = vi.fn();
  });

  describe("validate(registerSchema)", () => {
    it("accepts a valid payload, trims fields, and exposes the FLAT body on req.validatedBody", () => {
      // Leading/trailing spaces on firstName prove .trim() runs; the flat result
      // proves the middleware unwrapped `body` for us.
      const req = { body: { ...validRegisterBody, firstName: "  Ada  " } };

      registerMw(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(req.validatedBody).toEqual({
        firstName: "Ada", // trimmed
        lastName: "Lovelace",
        displayName: "ada",
        phone: "+2348012345678",
        email: "ada@example.com",
        password: "Str0ng!pass",
      });
    });

    // The security-critical bit: every password rule is enforced independently.
    // Each case fails exactly ONE rule so we can assert its specific message.
    it.each([
      ["too short", "Sh0rt!", "Password must be at least 8 characters long."],
      ["no uppercase", "nouppercase1!", "Password must contain an uppercase letter."],
      ["no lowercase", "NOLOWERCASE1!", "Password must contain a lowercase letter."],
      ["no digit", "NoDigitsHere!", "Password must contain a number."],
      ["no special character", "NoSpecial123", "Password must contain a special character."],
    ])("rejects a password with %s", (_label, password, expectedMsg) => {
      const req = { body: { ...validRegisterBody, password } };

      registerMw(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(detailMessages(res)).toContain(expectedMsg);
    });

    it("rejects a non-international phone number with the standard 400 envelope", () => {
      const req = { body: { ...validRegisterBody, phone: "12345" } };

      registerMw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "FAIL", error: "VALIDATION_ERROR" }),
      );
      expect(detailMessages(res)).toContain(
        "Phone number must be in international format.",
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects a malformed email (issue points at body.email)", () => {
      const req = { body: { ...validRegisterBody, email: "not-an-email" } };

      registerMw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      // Assert on the issue PATH rather than Zod's default message wording, which
      // can shift between versions.
      expect(detailPaths(res)).toContain("body.email");
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects when a required field is missing (issue points at body.firstName)", () => {
      const { firstName: _omit, ...withoutFirstName } = validRegisterBody;
      const req = { body: withoutFirstName };

      registerMw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(detailPaths(res)).toContain("body.firstName");
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("validate(loginSchema)", () => {
    it("accepts valid credentials and exposes them on req.validatedBody", () => {
      const req = { body: { email: "ada@example.com", password: "any-secret" } };

      loginMw(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(req.validatedBody).toEqual({
        email: "ada@example.com",
        password: "any-secret",
      });
    });

    it("rejects a malformed email", () => {
      const req = { body: { email: "nope", password: "any-secret" } };

      loginMw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(detailPaths(res)).toContain("body.email");
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects an empty password (login requires min length 1)", () => {
      const req = { body: { email: "ada@example.com", password: "" } };

      loginMw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(detailPaths(res)).toContain("body.password");
      expect(next).not.toHaveBeenCalled();
    });
  });
});
