import "dotenv/config";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { assertSafeTestDatabase } from "../scripts/test-env.mjs";
// Refuses anything but a local *_test database: this spec inserts fixture rows.
assertSafeTestDatabase(process.env.DATABASE_URL ?? "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "/tmp";
test.afterAll(async () => { await pool.end(); });

/**
 * The browser half of the enrichment journey. The page, its data and the Apify connection are real
 * (test database); the enrichment API responses a run would produce are mocked in the browser, so
 * this checks what the screen does with them — not Apify, and not the worker (those are in
 * tests/apify-enrichment.test.ts). Everything named here is synthetic.
 */
async function shots(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${SHOTS}/${name}-mobile-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: "light" });
  return overflow;
}

test("found people appear without a reload, the choice is explicit, and a person without an email can be added to CRM", async ({ page }) => {
  const ws = (await pool.query('SELECT m."workspaceId" FROM "WorkspaceMember" m JOIN "User" u ON u.id=m."userId" WHERE u.email=$1 AND m."deletedAt" IS NULL ORDER BY m."isDefault" DESC LIMIT 1', ["rahul@northbridge.example"])).rows[0].workspaceId as string;
  const companyId = randomUUID(); const opportunityId = randomUUID(); const runId = randomUUID();
  await pool.query(`INSERT INTO "Company" (id,"workspaceId",name,country,technologies,tags,"updatedAt") VALUES ($1,$2,'Atzean Technologies LLP (synthetic e2e)','Unknown','{}','{}',now())`, [companyId, ws]);
  await pool.query(`INSERT INTO "Opportunity" (id,"workspaceId","companyId",title,service,types,technologies,requirements,"dedupeKey",status,"updatedAt") VALUES ($1,$2,$3,'Looking for IT staffing partners (synthetic)','IT staffing',ARRAY['EXTERNAL_VENDOR','STAFF_AUGMENTATION']::"OpportunityType"[],'{}','{}',$4,'UNKNOWN',now())`, [opportunityId, ws, companyId, randomUUID()]);
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const conn = await page.request.post("/api/providers/apify_enrichment/connect", { headers: { Origin: base }, data: { apiKey: "e2e-synthetic-apify-token", config: {}, enabled: true, allowedSearch: true, allowedStorage: true, allowedEnrichment: true } });
  const createdConnection = conn.ok();
  try {
    expect(createdConnection, `connect returned ${conn.status()}: ${await conn.text()}`).toBe(true);
    const people = [
      { employmentId: randomUUID(), personId: randomUUID(), name: "Riya Synthetic", title: "Head of Delivery & Talent Acquisition", linkedinUrl: "https://www.linkedin.com/in/riya-synthetic", city: "Pune", country: "India", association: "current", isDecisionMaker: false, evidence: { association: { basis: "A position at this company with no end date." }, relevance: ["Title mentions delivery, talent acquisition."] }, source: "apify:harvestapi/linkedin-company-employees", contacts: [] },
      { employmentId: randomUUID(), personId: randomUUID(), name: "Arjun", title: "", linkedinUrl: "https://www.linkedin.com/in/arjun-synthetic", city: null, country: "Unknown", association: "current", isDecisionMaker: false, evidence: { association: { basis: "Listed under current positions at this company." } }, source: "apify:harvestapi/linkedin-company-employees", contacts: [] },
    ];
    const stages = (status: string) => [{ key: "resolve", status: "skipped", counts: {}, reason: "Company already identified (https://www.linkedin.com/company/atzean-technologies-synthetic)." }, { key: "details", status: "skipped", counts: {} }, { key: "people", status, counts: status === "done" ? { saved: 2, updated: 0, current: 2, uncertain: 0, former: 1, withoutTitle: 1, suppressed: 0 } : {} }];
    const run = (state: string, status: string) => ({ id: runId, kind: "people", trigger: "manual", state, stages: stages(status), result: {}, budgetUsd: 1, spentUsd: 0.13, estimatedUsd: 0.18, cancelRequestedAt: null, notice: null, apifyRuns: [{ stageKey: "people:employees", actorId: "harvestapi/linkedin-company-employees", status: "SUCCEEDED", itemCount: 4, usageUsd: 0.052, estimatedUsd: 0.18 }], terminal: state === "COMPLETED" });
    let polls = 0;
    await page.route(`**/api/opportunities/${opportunityId}/enrichment`, async route => {
      if (route.request().method() === "POST") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ run: run("QUEUED", "pending"), reused: false, note: null }) });
      const real = await (await route.fetch()).json();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...real, people }) });
    });
    await page.route(`**/api/enrichment-runs/${runId}`, route => route.fulfill({ contentType: "application/json", body: JSON.stringify(++polls < 2 ? run("RUNNING", "running") : run("COMPLETED", "done")) }));
    await page.goto(`/opportunities/${opportunityId}`);
    await expect(page.getByText("Nobody identified yet.")).toBeVisible();
    const choose = page.getByLabel("Person for the lead");
    await expect(page.getByRole("button", { name: "Add to CRM" })).toBeDisabled();
    await page.getByRole("button", { name: "Find people", exact: true }).click();
    await expect(page.getByText("Completed with results")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/2 new · 0 updated · 2 current, 0 uncertain, 1 former · 1 without a title/)).toBeVisible();
    await expect(page.getByText(/Estimated beforehand \$0\.18 · Apify reported \$0\.05/)).toBeVisible();
    // New people are listed without a page reload, and nobody is chosen for the user.
    await expect(page.getByRole("link", { name: "Riya Synthetic" })).toBeVisible();
    await expect(page.getByText("Title unknown", { exact: true })).toBeVisible();
    await expect(page.getByText("No email found for this person.").first()).toBeVisible();
    await expect(choose).toHaveValue("");
    await choose.selectOption({ label: "Arjun — title unknown" });
    await expect(page.getByRole("button", { name: "Add to CRM" })).toBeEnabled();
    await expect(page.getByText("An email address is not required.")).toBeVisible();
    expect(await shots(page, "enrichment-people")).toBeLessThanOrEqual(0);
    // The app shell scrolls inside #main, so capture the panel's own sections too.
    const sections = page.locator("#main section");
    await page.getByText("Completed with results").scrollIntoViewIfNeeded();
    await sections.filter({ hasText: "Enrich opportunity" }).first().screenshot({ path: `${SHOTS}/enrichment-run-panel.png` });
    await sections.filter({ hasText: "People at this company" }).first().screenshot({ path: `${SHOTS}/enrichment-people-panel.png` });
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: "dark" });
    await sections.filter({ hasText: "People at this company" }).first().screenshot({ path: `${SHOTS}/enrichment-people-panel-mobile-dark.png` });
  } finally {
    await pool.query('DELETE FROM "Company" WHERE id=$1 AND "workspaceId"=$2', [companyId, ws]);
    if (createdConnection) await pool.query('DELETE FROM "ProviderConnection" WHERE "workspaceId"=$1 AND provider=$2', [ws, "apify_enrichment"]);
  }
});

test("an ambiguous company asks which one it is, with the evidence for each", async ({ page }) => {
  const ws = (await pool.query('SELECT m."workspaceId" FROM "WorkspaceMember" m JOIN "User" u ON u.id=m."userId" WHERE u.email=$1 AND m."deletedAt" IS NULL ORDER BY m."isDefault" DESC LIMIT 1', ["rahul@northbridge.example"])).rows[0].workspaceId as string;
  const owner = (await pool.query('SELECT id FROM "User" WHERE email=$1', ["rahul@northbridge.example"])).rows[0].id;
  const companyId = randomUUID(); const opportunityId = randomUUID(); const runId = randomUUID();
  await pool.query(`INSERT INTO "Company" (id,"workspaceId",name,country,technologies,tags,"updatedAt") VALUES ($1,$2,'Atzean Technologies LLP (synthetic e2e)','Unknown','{}','{}',now())`, [companyId, ws]);
  await pool.query(`INSERT INTO "Opportunity" (id,"workspaceId","companyId",title,service,types,technologies,requirements,"dedupeKey",status,"updatedAt") VALUES ($1,$2,$3,'Looking for IT staffing partners (synthetic)','IT staffing',ARRAY['EXTERNAL_VENDOR']::"OpportunityType"[],'{}','{}',$4,'UNKNOWN',now())`, [opportunityId, ws, companyId, randomUUID()]);
  const candidate = (slug: string, city: string) => ({ profile: { name: "Atzean Technologies LLP", linkedinUrl: `https://www.linkedin.com/company/${slug}`, domain: null, city, country: "India", industry: "IT Services and IT Consulting", employeeCount: 40, description: null }, score: 60, reasons: ["Name matches (“Atzean Technologies LLP”).", "Headquartered in India, as expected.", "Its description mentions staffing."], conflicts: [] });
  await pool.query(`INSERT INTO "EnrichmentRun" (id,"workspaceId","opportunityId","companyId","requestedById",kind,state,stages,result,"budgetUsd","finishedAt") VALUES ($1,$2,$3,$4,$5,'people','NEEDS_SELECTION',$6,$7,1,now())`, [runId, ws, opportunityId, companyId, owner,
    JSON.stringify([{ key: "resolve", status: "needs_selection", counts: { candidates: 2 }, reason: "More than one company fits: Atzean Technologies LLP and Atzean Technologies LLP are within 20 points of each other." }, { key: "details", status: "blocked", counts: {}, reason: "Waiting for you to choose the company." }, { key: "people", status: "blocked", counts: {}, reason: "Waiting for you to choose the company." }]),
    JSON.stringify({ candidates: [candidate("atzean-pune-synthetic", "Pune"), candidate("atzean-mumbai-synthetic", "Mumbai")] })]);
  try {
    await page.goto(`/opportunities/${opportunityId}`);
    await expect(page.getByText("Needs company selection")).toBeVisible();
    await expect(page.getByText("Which company is this?")).toBeVisible();
    await expect(page.getByRole("button", { name: "This is the company" })).toHaveCount(2);
    await expect(page.getByText(/Pune/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "None of these" })).toBeVisible();
    expect(await shots(page, "enrichment-choose")).toBeLessThanOrEqual(0);
    await page.getByText("Which company is this?").scrollIntoViewIfNeeded();
    await page.locator("#main section").filter({ hasText: "Which company is this?" }).first().screenshot({ path: `${SHOTS}/enrichment-choose-panel.png` });
  } finally {
    await pool.query('DELETE FROM "Company" WHERE id=$1 AND "workspaceId"=$2', [companyId, ws]);
  }
});
