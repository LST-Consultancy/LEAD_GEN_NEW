import { describe, expect, it } from "vitest";
import { checkOrigin, configuredHosts } from "@/lib/security/origin";

const base = {
  method: "POST",
  origin: null as string | null,
  referer: null as string | null,
  host: "app.signalroom.test",
  hasApiKey: false,
};

describe("checkOrigin", () => {
  it("lets reads through without asking where they came from", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(checkOrigin({ ...base, method, origin: "https://evil.test" })).toMatchObject({
        ok: true,
        reason: "not_mutating",
      });
    }
  });

  it("allows a same-origin write", () => {
    expect(
      checkOrigin({ ...base, origin: "https://app.signalroom.test" })
    ).toMatchObject({ ok: true, reason: "same_origin" });
  });

  it("refuses a write from another site", () => {
    const verdict = checkOrigin({ ...base, origin: "https://evil.test" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("cross_origin");
  });

  it("refuses a write that claims no origin at all", () => {
    const verdict = checkOrigin(base);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("missing_origin");
  });

  it("treats a literal `null` origin as no origin, not as a missing header", () => {
    // A sandboxed iframe and a cross-origin redirect both send this. Reading it
    // as absent would be the same as trusting it.
    const verdict = checkOrigin({ ...base, origin: "null" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("missing_origin");
  });

  it("falls back to Referer when Origin is stripped", () => {
    expect(
      checkOrigin({ ...base, referer: "https://app.signalroom.test/leads" })
    ).toMatchObject({ ok: true, reason: "same_origin" });
  });

  it("prefers Origin over Referer when both are present", () => {
    const verdict = checkOrigin({
      ...base,
      origin: "https://evil.test",
      referer: "https://app.signalroom.test/leads",
    });
    expect(verdict.ok).toBe(false);
  });

  it("does not treat a subdomain as the same host", () => {
    // SameSite would allow this; we do not. A sibling subdomain is a different
    // application and often a different owner.
    const verdict = checkOrigin({ ...base, origin: "https://other.signalroom.test" });
    expect(verdict.ok).toBe(false);
  });

  it("does not match on a prefix", () => {
    const verdict = checkOrigin({ ...base, origin: "https://app.signalroom.test.evil.test" });
    expect(verdict.ok).toBe(false);
  });

  it("accepts a host configured for a proxy", () => {
    expect(
      checkOrigin({
        ...base,
        host: "internal-service",
        origin: "https://app.signalroom.test",
        allowedHosts: ["app.signalroom.test"],
      })
    ).toMatchObject({ ok: true });
  });

  it("compares hosts case-insensitively and ignores a trailing dot", () => {
    expect(checkOrigin({ ...base, origin: "https://APP.Signalroom.Test." })).toMatchObject({
      ok: true,
    });
  });

  it("lets an API-key caller through", () => {
    // The key arrives in a header a browser cannot set cross-origin, and
    // without a cookie — forgery is not the threat there.
    expect(
      checkOrigin({ ...base, origin: null, hasApiKey: true })
    ).toMatchObject({ ok: true, reason: "machine_caller" });
  });

  it("ignores a malformed origin rather than throwing", () => {
    const verdict = checkOrigin({ ...base, origin: "not a url" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("missing_origin");
  });
});

describe("configuredHosts", () => {
  it("parses a comma list and ignores blanks", () => {
    expect(configuredHosts(" a.test, b.test ,, c.test ")).toEqual([
      "a.test",
      "b.test",
      "c.test",
    ]);
  });

  it("returns nothing when unset", () => {
    expect(configuredHosts(undefined)).toEqual([]);
    expect(configuredHosts("")).toEqual([]);
  });
});
