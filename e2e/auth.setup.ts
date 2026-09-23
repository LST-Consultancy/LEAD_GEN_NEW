import { test as setup, expect } from "@playwright/test";
import { DEMO, OWNER_STATE } from "./fixtures";

/**
 * Signs in once, for every spec that needs a session.
 *
 * Not an optimisation — a correctness fix. Signing in per test tripped the
 * app's own sign-in rate limiter (8 attempts per 5 minutes, keyed on the
 * address *and* the source), so the suite failed against a working product.
 * That the limiter caught the test suite is the limiter working; the suite
 * should behave like one person with one session, which is what a real user is.
 *
 * `auth.spec.ts` deliberately does not use this state: it is testing the login
 * form itself, so it must drive the real thing.
 */
setup("authenticate as the workspace owner", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 30_000 });

  await page.context().storageState({ path: OWNER_STATE });
});
