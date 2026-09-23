import { expect, type Page } from "@playwright/test";

/** Where the shared signed-in session is stored between projects. */
export const OWNER_STATE = "e2e/.auth/owner.json";

/** The seeded owner account. Matches what the login page itself offers. */
export const DEMO = {
  email: "rahul@northbridge.example",
  password: "Signalroom123",
};

/**
 * Signs in through the real form.
 *
 * Only for specs that are testing sign-in itself. Everything else reuses the
 * session `auth.setup.ts` establishes — signing in per test exhausts the
 * product's own rate limiter and fails a suite against a working app.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 30_000 });
}

/**
 * The first lead id on the Leads screen.
 *
 * Read from the page rather than hard-coded: the seed randomises ids, and a
 * fixed id would make the suite pass only on the machine it was written on.
 */
export async function firstLeadId(page: Page): Promise<string> {
  await page.goto("/leads");
  const link = page.locator('a[href^="/leads/"]').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  const href = await link.getAttribute("href");
  const id = href?.split("/leads/")[1]?.split(/[?#]/)[0];
  if (!id) throw new Error("no lead link found on /leads");
  return id;
}
