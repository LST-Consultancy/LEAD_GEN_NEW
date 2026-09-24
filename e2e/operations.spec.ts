import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Plans, competitors, playbooks and reports through the interface. Repeatable: names are unique, a plan is reused if it exists. */

test("a deal plan starts, enforces dependencies, and records progress", async ({ page }) => {
  await page.goto("/teamcollab");
  await expect(page.getByRole("heading", { name: "Deal plans" }).or(page.getByText("Deal plans"))).toBeVisible({ timeout: 30_000 });
  const firstDeal = page.locator('a[href^="/teamcollab/"]').first();
  await firstDeal.click();
  await expect(page).toHaveURL(/\/teamcollab\/[0-9a-f-]{36}$/);
  const start = page.getByRole("button", { name: "Start the plan" });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await expect(page.getByText("Plan started")).toBeVisible();
  }
  await expect(page.getByText("Contract signed", { exact: true })).toBeVisible();
  // Scope waits on discovery unless discovery is already done.
  const scope = page.getByLabel("Status of Scope agreed");
  const discovery = page.getByLabel("Status of Discovery call");
  if ((await discovery.inputValue()) !== "done") {
    await scope.selectOption("done");
    await expect(page.getByText(/Finish Discovery call first/)).toBeVisible();
    await discovery.selectOption("done");
    await expect(page.getByText("Step updated")).toBeVisible();
  }
  await expect(page.getByLabel("Status of Discovery call")).toHaveValue("done");

  const tpl = `E2E template ${randomUUID().slice(0, 6)}`;
  await page.getByRole("button", { name: "Save as template" }).click();
  await page.getByLabel("Template name").fill(tpl);
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText(`Saved as ${tpl} v1`)).toBeVisible();
  await page.goto("/teamcollab");
  await expect(page.getByText(tpl)).toBeVisible();
  await page.getByRole("button", { name: `Remove template ${tpl}` }).click();
  await expect(page.getByText(`${tpl} removed`)).toBeVisible();
});

test("a competitor can be tracked, edited and removed", async ({ page }) => {
  await page.goto("/competitors");
  const name = `E2E Rival ${randomUUID().slice(0, 6)}`;
  await page.getByRole("button", { name: /Track (a|your first) competitor/ }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByLabel("Other names it goes by").fill("Rival Co, RC");
  await page.getByRole("button", { name: "Track", exact: true }).click();
  await expect(page.getByText(`${name} is now tracked`)).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Stop tracking ${name}` }).click();
  await expect(page.getByText(`${name} removed`)).toBeVisible();
});

test("a playbook can be written and saved as an inactive draft", async ({ page }) => {
  await page.goto("/playbooks");
  await page.getByRole("button", { name: /New playbook|Write your first playbook/ }).first().click();
  const name = `E2E playbook ${randomUUID().slice(0, 6)}`;
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByLabel("Keywords").fill("netsuite, erp");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Step 1 action").selectOption("wait");
  await page.getByLabel("Step 1 note").fill("Three days after the signal");
  await page.getByRole("button", { name: "Create playbook" }).click();
  await expect(page.getByText("Playbook created")).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
});

test("insights and live demand show the counted reports", async ({ page }) => {
  await page.goto("/insights");
  await expect(page.getByText("One cohort, followed forward")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Tier and status mix")).toBeVisible();
  await page.goto("/live-demand");
  await expect(page.getByText("Active demand by kind of work")).toBeVisible({ timeout: 30_000 });
});

test("a lead's dossier opens in a print layout", async ({ page, browser }) => {
  await page.goto("/leads");
  const link = page.locator('a[href^="/leads/"]').filter({ hasNotText: /^$/ }).first();
  const href = await link.getAttribute("href");
  const id = href!.split("/").pop()!.split("?")[0];
  await page.goto(`/print/leads/${id}`);
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Signals" })).toBeVisible();
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await stranger.newPage();
  await other.goto(`/print/leads/${id}`);
  await expect(other).toHaveURL(/\/login/);
  await stranger.close();
});
