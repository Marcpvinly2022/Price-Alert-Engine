import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// WHY EACH TEST RELOADS THE MODULE (vi.resetModules + dynamic import)
//
// fx.provider.js builds ONE CircuitBreaker at import time and keeps it for the
// life of the process. opossum trips the breaker OPEN once the error rate crosses
// errorThresholdPercentage (50%). A single failing request is a 100% error rate,
// so a failure test could leave the breaker OPEN — and a shared breaker would then
// short-circuit the NEXT test straight to the fallback WITHOUT calling fetch,
// making a "live success" test fail for the wrong reason.
//
// Reloading the module per test gives every test its own pristine breaker, so the
// tests are order-independent and each asserts exactly one behavior.
//
// NOTE: fetch is fully mocked here — these tests make ZERO real network calls, so
// they never touch (or exhaust) the ExchangeRate-API quota.
// ─────────────────────────────────────────────────────────────────────────────

async function loadProvider() {
  vi.resetModules(); // drop the cached module (and its breaker)
  return import("../../providers/fx.provider.js"); // re-evaluate → brand-new breaker
}

// Build a fake fetch Response. The provider only uses `ok`, `status`, and json().
function mockFetchResolve(body, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }),
  );
}

function mockFetchReject(error) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
}

describe("fetchUsdNgnRate (FX provider + circuit breaker)", () => {
  beforeEach(() => {
    // A present key lets the live path run through to fetch(). We set it BEFORE
    // import; `import 'dotenv/config'` won't override an already-set var, so the
    // real .env can't leak its real key into the test.
    vi.stubEnv("EXCHANGERATE_API_KEY", "test-key-123");

    // The provider logs to console on every call and on fallback — silence it so
    // the test output stays readable.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the LIVE rate and calls the correctly-built v6 URL on success", async () => {
    mockFetchResolve({ result: "success", conversion_rates: { NGN: 1360.5 } });

    const { fetchUsdNgnRate } = await loadProvider();
    const result = await fetchUsdNgnRate();

    expect(result).toEqual({
      currencyPair: "USD_NGN",
      rate: 1360.5,
      source: "LIVE_EXCHANGERATE_API",
    });

    // Locks in the URL-construction fix: key is a PATH segment on the v6 host,
    // not a query param (this exact shape was the original "fetch failed" bug).
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://v6.exchangerate-api.com/v6/test-key-123/latest/USD",
      expect.any(Object),
    );
  });

  it("falls back to the SIMULATOR when the network call throws", async () => {
    // This is the whole reason the breaker exists: a provider outage must not
    // break the cycle — it degrades to a synthetic rate instead.
    mockFetchReject(new Error("fetch failed"));

    const { fetchUsdNgnRate } = await loadProvider();
    const result = await fetchUsdNgnRate();

    expect(result.source).toBe("SIMULATE_PROVIDER");
    expect(result.currencyPair).toBe("USD_NGN");
    // Simulator is 1550 ± drift, where drift ∈ [-10, 9].
    expect(result.rate).toBeGreaterThanOrEqual(1540);
    expect(result.rate).toBeLessThanOrEqual(1559);
  });

  it("falls back when the API returns a logical error payload (result !== 'success')", async () => {
    // HTTP 200 but the body says failure (e.g. invalid key). The provider treats
    // this as a failure and the breaker routes to the fallback.
    mockFetchResolve({ result: "error", "error-type": "invalid-key" });

    const { fetchUsdNgnRate } = await loadProvider();
    const result = await fetchUsdNgnRate();

    expect(result.source).toBe("SIMULATE_PROVIDER");
  });

  it("falls back on a non-2xx HTTP status", async () => {
    mockFetchResolve({}, { ok: false, status: 500 });

    const { fetchUsdNgnRate } = await loadProvider();
    const result = await fetchUsdNgnRate();

    expect(result.source).toBe("SIMULATE_PROVIDER");
  });

  it("falls back when the payload is missing the NGN conversion rate", async () => {
    mockFetchResolve({ result: "success", conversion_rates: {} });

    const { fetchUsdNgnRate } = await loadProvider();
    const result = await fetchUsdNgnRate();

    expect(result.source).toBe("SIMULATE_PROVIDER");
  });
});
