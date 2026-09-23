import { expect, test } from "@playwright/test";
import { DEMO } from "./fixtures";

/**
 * Sign-in, in a real browser.
 *
 * The unit suite already proves the password check, the session digest and the
 * rate limiter in isolation. What it cannot prove is that the three work
 * together through an actual browser — in particular that the CSRF middleware,
 * which refuses any write without a matching `Origin`, does not refuse the
 * login form itself. That is exactly the class of bug a unit test cannot see
 * and a user hits immediately.
 */

test.describe("signing in", () => {
  test("an unauthenticated visitor is sent to the login page", async ({ page }) => {
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("Work email")).toBeVisible();
  });

  test("valid credentials reach the workspace", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(DEMO.email);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/today/, { timeout: 30_000 });
    // Proves the session cookie survived the redirect, not merely that the
    // POST returned 200.
    await expect(page.getByRole("navigation").first()).toBeVisible();
  });

  test("a wrong password is refused without saying whether the account exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(DEMO.email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const error = page.getByText(/don't match/i);
    await expect(error).toBeVisible();
    // The same sentence must come back for an address that does not exist, or
    // the form becomes an account-enumeration oracle.
    const wrongAccount = await error.textContent();

    await page.getByLabel("Work email").fill("nobody@nowhere.invalid");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/don't match/i)).toHaveText(wrongAccount ?? "");
  });

  test("the session survives a reload and a fresh navigation", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(DEMO.email);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 30_000 });

    await page.reload();
    await expect(page).toHaveURL(/\/today/);

    await page.goto("/leads");
    await expect(page).not.toHaveURL(/\/login/);
  });
});
