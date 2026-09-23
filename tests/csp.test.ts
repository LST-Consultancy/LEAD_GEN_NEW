import { describe, expect, it } from "vitest";
import { buildCsp, hstsValue, newNonce, shouldSendHsts } from "@/lib/security/csp";

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    })
  ) as Record<string, string[]>;

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", isDev: false });
  const dev = buildCsp({ nonce: "abc123", isDev: true });

  it("carries the nonce so Next's inline hydration scripts run", () => {
    expect(parse(prod)["script-src"]).toContain("'nonce-abc123'");
  });

  it("never allows unsafe-inline scripts", () => {
    // The whole point: `unsafe-inline` would permit Next's own inline scripts
    // and anything an injection managed to add, which is what a CSP is for.
    for (const csp of [prod, dev]) {
      expect(parse(csp)["script-src"]).not.toContain("'unsafe-inline'");
    }
  });

  it("allows eval in development only", () => {
    expect(parse(dev)["script-src"]).toContain("'unsafe-eval'");
    expect(parse(prod)["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("allows the dev server's websocket in development only", () => {
    expect(parse(dev)["connect-src"]).toContain("ws:");
    expect(parse(prod)["connect-src"]).not.toContain("ws:");
  });

  it("upgrades insecure requests in production only", () => {
    // In development everything is http://localhost, and upgrading it breaks
    // the dev server outright.
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("refuses framing, plugins and a rewritten base URI", () => {
    const d = parse(prod);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
  });

  it("restricts where a form may post", () => {
    // A rewritten form action is how a phished credential leaves the page.
    expect(parse(prod)["form-action"]).toEqual(["'self'"]);
  });

  it("permits extra connect origins a deployment actually calls", () => {
    const csp = buildCsp({ nonce: "n", isDev: false, extraConnectSrc: ["https://metrics.test"] });
    expect(parse(csp)["connect-src"]).toContain("https://metrics.test");
  });

  it("keeps style-src permissive, deliberately and narrowly", () => {
    // Next and the chart components set `style` attributes, which carry no
    // nonce. A style injection can deface a page; it cannot execute.
    expect(parse(prod)["style-src"]).toContain("'unsafe-inline'");
    expect(parse(prod)["style-src"]).not.toContain("https:");
  });

  it("produces a header with no stray separators", () => {
    expect(prod).not.toMatch(/;\s*;/);
    expect(prod.trim()).toBe(prod);
  });
});

describe("HSTS", () => {
  it("is sent only over HTTPS, and never in development", () => {
    expect(shouldSendHsts({ proto: "https", isDev: false })).toBe(true);
    expect(shouldSendHsts({ proto: "http", isDev: false })).toBe(false);
    expect(shouldSendHsts({ proto: null, isDev: false })).toBe(false);
    // Pinning localhost to HTTPS in a developer's browser breaks every other
    // project on that machine, and is not obvious to undo.
    expect(shouldSendHsts({ proto: "https", isDev: true })).toBe(false);
  });

  it("is long-lived, covers subdomains and is preload-eligible", () => {
    const value = hstsValue();
    expect(value).toContain("includeSubDomains");
    expect(value).toContain("preload");
    const maxAge = Number(/max-age=(\d+)/.exec(value)?.[1]);
    // Preload lists require at least a year.
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
  });
});

describe("newNonce", () => {
  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 100 }, newNonce));
    expect(seen.size).toBe(100);
  });

  it("is safe to place inside a header value", () => {
    for (let i = 0; i < 50; i++) {
      const nonce = newNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(nonce).not.toContain(";");
      expect(nonce).not.toContain("\n");
    }
  });
});
