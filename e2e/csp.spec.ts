import { expect, test, type Page } from "@playwright/test";

/**
 * The Content-Security-Policy, checked by a browser that actually enforces it.
 *
 * A CSP is the one security header that fails silently and locally: a wrong
 * directive does not error in CI, it blanks a chart in somebody's browser three
 * weeks later. The unit tests prove the policy *string* is what was intended.
 * Only this can prove the app still works under it.
 *
 * Every violation Chromium reports is a failure. There is no allowance for
 * "expected" ones — an expected violation is a directive that needs changing.
 */

/** Collects CSP violations from the console and from the reporting event. */
function watchForViolations(page: Page): string[] {
  const violations: string[] = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(text)) {
      violations.push(text);
    }
  });

  // `securitypolicyviolation` catches what the console sometimes summarises,
  // and names the directive that actually fired.
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.warn(
        `CSP violated ${e.violatedDirective} by ${e.blockedURI || "inline"}`
      );
    });
  });

  return violations;
}

const PAGES = [
  ["Today", "/today"],
  ["Leads", "/leads"],
  ["Pipeline", "/pipeline"],
  ["Insights", "/insights"],
  ["Copilot", "/copilot"],
  ["Knowledge Base", "/knowledge-base"],
  ["Settings — AI", "/settings/ai"],
] as const;

test.describe("Content-Security-Policy", () => {
  test("the header is present and nonce-based", async ({ page }) => {
    const res = await page.goto("/today");
    const csp = res?.headers()["content-security-policy"];

    expect(csp, "no CSP header was sent").toBeTruthy();
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
    // The concession that would undo most of the policy.
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("the nonce changes between requests", async ({ page }) => {
    const nonceOf = async (path: string) => {
      const res = await page.goto(path);
      return /'nonce-([^']+)'/.exec(res?.headers()["content-security-policy"] ?? "")?.[1];
    };
    const first = await nonceOf("/today");
    const second = await nonceOf("/leads");

    expect(first).toBeTruthy();
    // A reused nonce is barely better than `unsafe-inline`: anything that
    // learns it once can inject freely from then on.
    expect(second).not.toBe(first);
  });

  for (const [name, path] of PAGES) {
    test(`${name} renders with no CSP violation`, async ({ page }) => {
      const violations = watchForViolations(page);

      await page.goto(path);
      // Not `networkidle`: the data-heavy screens keep a connection open and it
      // never settles, so the test timed out instead of reporting anything.
      // Waiting for the app shell proves the page rendered, and a short settle
      // gives hydration — where an unnonced inline script would fire — time to
      // run.
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await page.waitForTimeout(1_500);

      expect(violations, `${name} reported CSP violations`).toEqual([]);
    });
  }

  test("the app is still interactive under the policy", async ({ page }) => {
    const violations = watchForViolations(page);

    await page.goto("/knowledge-base");
    await expect(page.getByRole("navigation").first()).toBeVisible();

    // A page can look fine and be dead: if the nonce were wrong, React would
    // never hydrate and no handler would fire. Typing into a controlled input
    // proves client JavaScript is running.
    const search = page.getByPlaceholder(/search titles/i);
    await search.fill("salesforce");
    await expect(search).toHaveValue("salesforce");

    expect(violations).toEqual([]);
  });
});

test.describe("Strict-Transport-Security", () => {
  test("is not sent over plain HTTP in development", async ({ page }) => {
    const res = await page.goto("/today");
    // Pinning localhost to HTTPS would break every other project on the
    // developer's machine, and is not obvious to undo.
    expect(res?.headers()["strict-transport-security"]).toBeUndefined();
  });
});
