import { expect, test, type Page } from "@playwright/test";

/**
 * The public proposal page — the one surface a customer touches.
 *
 * Nothing else in the product is both unauthenticated and capable of changing a
 * commercial outcome, so this is where an E2E test earns its cost. The unit
 * suite proves the token check and the money arithmetic; only a browser can
 * prove that a prospect with a link, no account and no cookie can actually read
 * the thing and answer it.
 *
 * These tests deliberately do **not** accept a seeded proposal: accepting is
 * irreversible and would leave the developer's demo data in a state no later
 * run could undo. They assert on what the page renders and on the guards
 * around the decision instead.
 */

/**
 * A live proposal token, taken from the app rather than hard-coded.
 *
 * Uses the session already established by `auth.setup.ts`; signing in here per
 * test exhausted the product's own rate limiter and failed the suite against a
 * working app.
 */
async function anyProposalToken(page: Page): Promise<string | null> {
  // Read from the API, not by scraping the page. The public link is offered as
  // a copy-to-clipboard control rather than an anchor, so a link selector found
  // nothing and the tests skipped silently — green, and proving nothing.
  //
  // `publicPath` is null until a proposal is sent, which is correct: an
  // unsent proposal has no link to share.
  await page.goto("/proposals");
  const paths = await page.evaluate(async () => {
    const res = await fetch("/api/proposals");
    if (!res.ok) return [];
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.proposals ?? body.rows ?? []);
    type Row = { publicPath?: string | null; state?: string };
    // Decidable ones first. "Not yet answered" is not enough — an *expired*
    // proposal is also unanswered and shows no controls either, so filtering on
    // acceptedAt/declinedAt alone picked one that could only ever skip.
    const decidable = rows.filter((r: Row) => r.state === "SENT" || r.state === "VIEWED");
    return [...decidable, ...rows]
      .map((r: Row) => r.publicPath)
      .filter((p: string | null | undefined): p is string => typeof p === "string");
  });

  const first = paths[0];
  return first ? first.split("/p/")[1]?.split(/[?#]/)[0] ?? null : null;
}

test.describe("the public proposal link", () => {
  test("an unknown token does not reveal whether it ever existed", async ({ page }) => {
    const res = await page.goto("/p/not-a-real-token-at-all");
    // A guessable difference between "no such proposal" and "expired" would
    // turn the page into an oracle for probing tokens.
    expect(res?.status()).toBeGreaterThanOrEqual(400);
    await expect(page.locator("body")).not.toContainText("Accept this proposal");
  });

  test("a real token opens with no session at all", async ({ page, browser }) => {
    const token = await anyProposalToken(page);
    test.skip(!token, "no proposal with a public link in the seed");

    // A completely separate context: no cookies, no storage, nothing carried
    // over. This is the prospect's browser, not the seller's.
    const fresh = await browser.newContext();
    const prospect = await fresh.newPage();
    try {
      await prospect.goto(`/p/${token}`);
      await expect(prospect.locator("body")).toContainText(/proposal/i, { timeout: 30_000 });

      // The product's own name must not appear in the tab title on a page a
      // customer sees — the proposal is from the seller, not from this tool.
      const title = await prospect.title();
      expect(title.toLowerCase()).not.toContain("signalroom");
    } finally {
      await fresh.close();
    }
  });

  test("answering requires a name, and says that name is not verified", async ({ page, browser }) => {
    const token = await anyProposalToken(page);
    test.skip(!token, "no proposal with a public link in the seed");

    const fresh = await browser.newContext();
    const prospect = await fresh.newPage();
    try {
      await prospect.goto(`/p/${token}`);
      const accept = prospect.getByRole("button", { name: "Accept this proposal" });

      // Already decided proposals show no controls; that is correct, not a
      // failure, so the assertion only runs when a decision is still open.
      test.skip((await accept.count()) === 0, "this proposal has already been answered");

      await accept.click();
      const confirm = prospect.getByRole("button", { name: "Confirm acceptance" });

      // Confirm is unavailable until a name is given, so nobody accepts a
      // contract anonymously by pressing one button.
      await expect(confirm).toBeDisabled();
      await expect(prospect.getByText(/does not verify who you are/i)).toBeVisible();

      await prospect.getByLabel("Your name").fill("A");
      await expect(confirm, "a single character is not a name").toBeDisabled();

      await prospect.getByLabel("Your name").fill("Priya Menon");
      await expect(confirm).toBeEnabled();

      // Deliberately stops here. Accepting is irreversible, and a test that
      // mutates seeded data cannot be run twice.
    } finally {
      await fresh.close();
    }
  });
});
