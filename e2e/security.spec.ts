import { expect, test } from "@playwright/test";

/**
 * The security middleware, from a browser rather than from curl.
 *
 * The unit tests prove `checkOrigin` classifies headers correctly. What they
 * cannot prove is the thing that actually matters: that a real browser's
 * ordinary writes carry an `Origin` the middleware accepts. A CSRF check that
 * is correct in isolation and refuses the app's own forms is worse than no
 * check at all — it fails closed, on every user, immediately.
 */

test.describe("cross-site request forgery", () => {
  test("the app's own writes are allowed", async ({ page }) => {
    // A loaded page is required: a relative `fetch` and `document.cookie` both
    // need an origin to be relative *to*.
    await page.goto("/today");

    // Issued from the page, so the browser attaches a same-origin `Origin`
    // exactly as it would for any control in the UI.
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/sticky-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "IDEA", body: "e2e: same-origin write should be allowed" }),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, id: body?.id as string | undefined };
    });

    expect(status.status).toBe(200);

    // Clean up after ourselves — these tests share the developer's database.
    if (status.id) {
      const deleted = await page.evaluate(
        async (id) => (await fetch(`/api/sticky-notes/${id}`, { method: "DELETE" })).status,
        status.id
      );
      expect(deleted).toBe(200);
    }
  });

  test("a write claiming another origin is refused", async ({ page }) => {
    await page.goto("/today");

    // `fetch` will not let a page forge its own `Origin`, so this is issued
    // through the request context with the header set explicitly — the shape a
    // real forgery takes, with the victim's cookies attached.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await page.request.post("/api/sticky-notes", {
      headers: {
        "content-type": "application/json",
        origin: "https://evil.test",
        cookie: cookieHeader,
      },
      data: { kind: "IDEA", body: "e2e: forged write must be refused" },
      failOnStatusCode: false,
    });

    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("cross_origin");
  });

  test("reads are not blocked by the origin check", async ({ page }) => {
    await page.goto("/today");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // A GET carries no forgery risk, and blocking it would break every
    // embedded view and every link a colleague pastes.
    const res = await page.request.get("/api/sticky-notes", {
      headers: { origin: "https://evil.test", cookie: cookieHeader },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
  });
});

test.describe("session handling", () => {
  test("the session cookie is httpOnly, so script cannot read it", async ({ page }) => {
    await page.goto("/today");
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "sr_session");

    expect(session, "no session cookie was set").toBeTruthy();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");

    // The definitive check: the value must be invisible to injected script,
    // which is what makes an XSS a defaced page rather than a stolen account.
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain("sr_session");
  });
});
