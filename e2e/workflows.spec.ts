import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { firstLeadId } from "./fixtures";

/**
 * The core work loop through the real interface, against the seeded test
 * database. Everything here can run twice: names are unique per run and no
 * step spends points, sends a message or accepts a proposal.
 */

test("a company link opens its account page", async ({ page }) => {
  await page.goto("/leads");
  const companyLink = page.locator('a[href^="/accounts/"]').first();
  await expect(companyLink).toBeVisible({ timeout: 30_000 });
  const name = (await companyLink.textContent())?.trim() ?? "";
  await companyLink.click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.locator("#main").getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("link", { name: "All accounts" })).toBeVisible();
});

test("an unknown account id is a not-found page", async ({ page }) => {
  await page.goto(`/accounts/${randomUUID()}`);
  await expect(page.getByText(/couldn.t find that|doesn.t exist/i).first()).toBeVisible();
});

test("logging a call records it on the lead's timeline", async ({ page }) => {
  const id = await firstLeadId(page);
  await page.goto(`/leads/${id}`);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  const note = `E2E call ${randomUUID().slice(0, 8)}`;
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Outcome").selectOption("voicemail");
  await dialog.getByLabel("Notes").fill(note);
  await page.getByRole("button", { name: "Log call" }).click();
  await expect(page.getByText("Call logged")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Call to .* — left voicemail/).first()).toBeVisible();
});

test("a meeting booked from a lead appears in Bookings", async ({ page }) => {
  const id = await firstLeadId(page);
  await page.goto(`/leads/${id}`);
  await page.getByRole("button", { name: "Meeting", exact: true }).click();
  const title = `E2E meeting ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Title").fill(title);
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Date").fill(date);
  await page.getByRole("button", { name: "Book meeting" }).click();
  await expect(page.getByText("Meeting booked")).toBeVisible();
  await page.goto("/bookings");
  await expect(page.getByText(title)).toBeVisible();
});

test("a task added on a lead shows up in My Queue", async ({ page }) => {
  const id = await firstLeadId(page);
  await page.goto(`/leads/${id}`);
  await page.getByRole("button", { name: /^Tasks/ }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  const title = `E2E task ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("What needs doing").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task added")).toBeVisible();
  await page.goto("/my-queue?tab=queued");
  await expect(page.getByText(title)).toBeVisible();
});

test("selected leads can be added to a new list, which then shows them", async ({ page }) => {
  await page.goto("/leads");
  const boxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
  await expect(boxes.first()).toBeVisible({ timeout: 30_000 });
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Add to list" }).click();
  await page.getByLabel("List", { exact: true }).selectOption("new");
  const name = `E2E list ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("New list name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added to list")).toBeVisible();
  await page.goto("/lists");
  await expect(page.getByText(name)).toBeVisible();
});

test("bulk reveal quotes the price and cancelling spends nothing", async ({ page }) => {
  await page.goto("/leads");
  const boxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
  await expect(boxes.first()).toBeVisible({ timeout: 30_000 });
  await boxes.nth(0).check();
  await page.getByRole("button", { name: "Reveal contacts" }).click();
  await expect(page.getByRole("dialog").getByText(/locked contacts across/)).toBeVisible();
  await expect(page.getByText(/Balance: \d+ points/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("exporting all matching leads downloads a CSV", async ({ page }) => {
  await page.goto("/leads");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("Do it on a recommendation puts it in My Queue", async ({ page }) => {
  const id = await firstLeadId(page);
  await page.goto(`/leads/${id}`);
  const doIt = page.getByRole("button", { name: "Do it", exact: true });
  test.skip((await doIt.count()) === 0, "this seeded lead's top recommendation was already chosen");
  await doIt.click();
  await expect(page.getByText("Added to My Queue")).toBeVisible();
  await expect(page.getByText("Chosen — it is in My Queue.")).toBeVisible();
});
