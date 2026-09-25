import { expect, test, type Page } from "@playwright/test";

/**
 * The screens added for the 2026-09-25 completion pass, in a real browser against the seeded test
 * database: each renders its heading, logs no console error, has no horizontal overflow at phone
 * width, and is captured at desktop and phone width for the visual inventory
 * (test-results/screens/). Nothing here connects a provider, sends a message or spends a credit.
 */
const SCREENS: { name: string; path: string; heading: RegExp }[] = [
  { name: "offerings", path: "/settings/offerings", heading: /Offerings/ },
  { name: "email-accounts", path: "/settings/email", heading: /Reply reading/ },
  { name: "whatsapp-api", path: "/settings/whatsapp-api", heading: /WhatsApp API/ },
  { name: "calendar", path: "/settings/calendar", heading: /Your calendar/ },
  { name: "team", path: "/settings/team", heading: /Team & roles/ },
  { name: "providers", path: "/settings/providers", heading: /Discovery readiness/ },
  { name: "mcp", path: "/settings/mcp", heading: /MCP/ },
  { name: "lead-lens", path: "/lead-lens", heading: /Lead Lens/ },
  { name: "people-finder", path: "/people-finder", heading: /people|person/i },
  { name: "find-opportunities", path: "/find-leads", heading: /Find Opportunities/ },
  { name: "search-phrases", path: "/settings/search-phrases", heading: /phrase/i },
  { name: "today", path: "/today", heading: /Morning briefing/ },
];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const s of SCREENS) {
  test(`${s.name} renders cleanly at desktop and phone width`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(s.path);
    await expect(page.getByText(s.heading).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/screens/${s.name}-desktop.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${s.name} scrolls sideways at phone width by ${overflow}px`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/screens/${s.name}-phone.png`, fullPage: true });
    expect(errors, `${s.name} logged console errors`).toEqual([]);
  });
}

test("an offering can be created and routes into a search", async ({ page }) => {
  await page.goto("/settings/offerings");
  const name = `E2E offering ${Date.now()}`;
  if (await page.getByRole("button", { name: "Add offering" }).isVisible()) await page.getByRole("button", { name: "Add offering" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("How buyers ask").fill("looking for a NetSuite partner");
  await page.getByLabel("Job titles that signal need").fill("NetSuite Administrator");
  await page.getByRole("button", { name: "Save offering" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.goto("/find-leads");
  const picker = page.getByLabel("Offering");
  if (await picker.isVisible()) {
    await picker.selectOption({ label: name });
    // Either a plan (a source is connected) or the honest refusal (none is) — never silence.
    await expect(page.getByText(new RegExp(`From “${name}”|is connected with search and storage rights`))).toBeVisible();
  }
});
