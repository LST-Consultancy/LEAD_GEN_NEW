import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { firstLeadId } from "./fixtures";

/**
 * Proposal authoring, deal editing, invitations and proposal defaults, through
 * the real interface. Repeatable: nothing here accepts an invitation, makes a
 * proposal live, emails anyone or spends points.
 */

test("a proposal started from a lead saves as a draft with the totals it showed", async ({ page }) => {
  const id = await firstLeadId(page);
  await page.goto(`/leads/${id}`);
  await page.getByRole("link", { name: "Proposal", exact: true }).click();
  await expect(page).toHaveURL(/\/proposals\/new\?leadId=/);
  await expect(page.getByRole("heading", { name: "New proposal" })).toBeVisible();

  const tag = randomUUID().slice(0, 6);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(`E2E proposal ${tag}`);
  await page.getByLabel("Line 1 name").fill("Implementation");
  await page.getByLabel("Line 1 quantity").fill("2");
  await page.getByLabel("Line 1 unit price").fill("1000.50");
  await page.getByLabel("Tax rate (%)").fill("18");
  // 2 × 1,000.50 = 2,001.00; 18% = 360.18; total 2,361.18
  await expect(page.getByText("₹2,361.18").first()).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Preview — how the customer will see it")).toBeVisible();
  await page.getByRole("button", { name: "Back to editing" }).click();

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByRole("heading", { name: "Edit proposal" })).toBeVisible();
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("1000.5");

  await page.goto("/proposals");
  await expect(page.getByText(`E2E proposal ${tag}`)).toBeVisible();
});

test("a deal's next action can be edited from its pipeline card", async ({ page }) => {
  await page.goto("/pipeline");
  const edit = page.getByRole("button", { name: /^Edit / }).first();
  await expect(edit).toBeAttached({ timeout: 30_000 });
  await edit.click({ force: true });
  const label = `E2E follow-up ${randomUUID().slice(0, 6)}`;
  await page.getByLabel("Next action").fill(label);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Deal updated")).toBeVisible();
  await expect(page.getByText(label).first()).toBeVisible();
});

test("an invitation link opens a join page for someone signed out", async ({ page, browser }) => {
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const email = `e2e-${randomUUID().slice(0, 8)}@invitee.invalid`;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByText("No email was sent.")).toBeVisible();

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await stranger.newPage();
  await other.goto(link);
  await expect(other.getByRole("heading", { name: /^Join / })).toBeVisible();
  await expect(other.getByText(email)).toBeVisible();
  await other.goto(link.replace(/[A-Za-z0-9_-]+$/, "not-a-real-token-at-all"));
  await expect(other.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
  await stranger.close();

  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: `Withdraw invitation for ${email}` }).click();
  await expect(page.getByText(`Invitation for ${email} withdrawn`)).toBeVisible();
});

test("proposal defaults save, survive a reload, and Cancel restores them", async ({ page }) => {
  await page.goto("/settings/proposals");
  const days = String(20 + Math.floor(Math.random() * 40));
  await page.getByLabel("Valid for (days)").fill(days);
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Defaults saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Valid for (days)")).toHaveValue(days);

  await page.getByLabel("Valid for (days)").fill("99");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Valid for (days)")).toHaveValue(days);
});
