import "dotenv/config";
import { Pool } from "pg";
import { assertSafeTestDatabase } from "../scripts/test-env.mjs";
// Refuses anything but a local *_test database: this spec inserts fixture rows.
assertSafeTestDatabase(process.env.DATABASE_URL ?? "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

test("opportunity query expansion and source configuration remain explicit", async ({ page }) => {
  await page.goto("/find-leads");
  await expect(page.locator("#main").getByRole("heading", { name: "Find Opportunities", exact: true })).toBeVisible();
  await page.getByLabel("Service or requirement").fill("NetSuite implementation and integration in US companies");
  await expect(page.getByText("SuiteScript", { exact: true })).toBeVisible();
  await expect(page.getByText("NetSuite integration", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/signalroom-opportunity-search.png", fullPage: true });
  await page.getByRole("link", { name: "Configure sources" }).click();
  await expect(page.locator("#main").getByRole("heading", { name: "Lead Sources & APIs", exact: true })).toBeVisible();
  await expect(page.getByText(/LinkedIn capability unavailable for this connection/)).toBeVisible();
});

test("search failure is shown as failure rather than no opportunities", async ({ page }) => {
  await page.route("**/api/opportunities/search", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "queue_unavailable", message: "Test fixture: queue unavailable. No search started." } }) }));
  await page.goto("/find-leads");
  await page.getByLabel("Service or requirement").fill("NetSuite implementation");
  const checkbox = page.getByRole("checkbox", { name: /Greenhouse/ });
  await checkbox.check();
  await page.getByRole("button", { name: "Find Opportunities", exact: true }).click();
  await expect(page.locator("#main").getByRole("alert")).toContainText("queue unavailable");
});

test("opportunity list and provider credentials require authentication", async ({ playwright }) => {
  const client = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
  for (const path of ["/api/opportunities", "/api/providers"]) {
    const response=await client.get(`${process.env.E2E_BASE_URL ?? "http://localhost:3000"}${path}`);
    expect(response.status()).toBe(401);
  }
  await client.dispose();
});

test("fictional search result opens persisted evidence, dates and contact status", async ({ page }) => {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("Browser fixtures require a local database.");
  const member=(await pool.query('SELECT m."workspaceId" FROM "WorkspaceMember" m JOIN "User" u ON u.id=m."userId" WHERE u.email=$1 AND m."deletedAt" IS NULL ORDER BY m."isDefault" DESC LIMIT 1',["rahul@northbridge.example"])).rows[0];
  const workspaceId=member.workspaceId;const suffix=randomUUID();
  const company={id:randomUUID(),name:"Fictional Browser Fixture"};const personId=randomUUID();
  await pool.query(`INSERT INTO "Company" (id,"workspaceId",name,domain,country,technologies,tags,"updatedAt") VALUES ($1,$2,$3,$4,'Unknown','{}','{}',now())`,[company.id,workspaceId,company.name,`browser-${suffix}.invalid`]);
  await pool.query(`INSERT INTO "Person" (id,"workspaceId","fullName",country,languages,"updatedAt") VALUES ($1,$2,$3,'Unknown','{}',now())`,[personId,workspaceId,"Fictional Browser Buyer"]);
  try {
    await pool.query(`INSERT INTO "Employment" (id,"workspaceId","personId","companyId",title,"isDecisionMaker","updatedAt") VALUES ($1,$2,$3,$4,'CTO',true,now())`,[randomUUID(),workspaceId,personId,company.id]);
    await pool.query(`INSERT INTO "ContactMethod" (id,"workspaceId","personId",kind,value,"maskedValue","isLocked",source,"updatedAt") VALUES ($1,$2,$3,'WORK_EMAIL','buyer@fictional-browser.invalid','b***@fictional-browser.invalid',false,'fictional-e2e-fixture',now())`,[randomUUID(),workspaceId,personId]);
    const o={id:randomUUID(),title:"Fictional NetSuite implementation requirement",types:["EXTERNAL_VENDOR","IMPLEMENTATION"],intentScore:70,status:"ACTIVE",postedAt:null,lastCheckedAt:new Date().toISOString()};
    await pool.query(`INSERT INTO "Opportunity" (id,"workspaceId","companyId",title,service,types,technologies,requirements,"dedupeKey",status,"activeRank","intentScore","updatedAt") VALUES ($1,$2,$3,$4,'NetSuite implementation',ARRAY['EXTERNAL_VENDOR','IMPLEMENTATION']::"OpportunityType"[],ARRAY['NetSuite'],ARRAY['Fictional test requirement'],$5,'ACTIVE',1,70,now())`,[o.id,workspaceId,company.id,o.title,suffix]);
    await pool.query(`INSERT INTO "OpportunitySource" (id,"workspaceId","opportunityId",provider,kind,"externalId","sourceUrl",title,description,"contentHash","rawReference","expiresAt") VALUES ($1,$2,$3,'fictional-e2e-fixture','PUBLIC_WEB',$4,'https://fictional-browser.invalid/requirement',$5,'Explicitly fictional browser-test requirement for an implementation partner.',$4,'{"fixture":true}',now()+interval '1 day')`,[randomUUID(),workspaceId,o.id,suffix,o.title]);
    await pool.query(`INSERT INTO "OpportunityEvidence" (id,"workspaceId","opportunityId",type,description,source,"sourceUrl",confidence,"scoreContribution","rawReference") VALUES ($1,$2,$3,'fixture','Fictional test evidence: explicit implementation requirement','fictional-e2e-fixture','https://fictional-browser.invalid/requirement',80,70,'{"fixture":true}')`,[randomUUID(),workspaceId,o.id]);
    const jobId=randomUUID();
    await page.route("**/api/opportunities/search",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({id:jobId,state:"QUEUED",progress:0,qualified:0,providerResults:{}})}));
    await page.route(`**/api/opportunities/search/${jobId}`,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({id:jobId,state:"COMPLETED",progress:100,qualified:1,providerResults:{fixture:{status:"COMPLETED"}}})}));
    await page.route(`**/api/opportunities?searchId=${jobId}`,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({total:1,page:1,items:[{...o,company,sources:[{provider:"fictional-e2e-fixture"}]}]})}));
    await page.goto("/find-leads");
    await page.getByLabel("Service or requirement").fill("NetSuite implementation");
    await page.getByRole("checkbox",{name:/Greenhouse/}).check();
    await page.getByRole("button",{name:"Find Opportunities",exact:true}).click();
    await page.getByRole("link",{name:o.title,exact:true}).click();
    await expect(page.locator("#main").getByRole("heading",{name:"Evidence and intent score"})).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Fictional test evidence: explicit implementation requirement",{exact:false})).toBeVisible();
    await expect(page.getByText("Fictional Browser Buyer · CTO")).toBeVisible();
    await expect(page.getByText(/buyer@fictional-browser.invalid · UNKNOWN/)).toBeVisible();
    await expect(page.getByRole("link",{name:/View original evidence/})).toHaveAttribute("href","https://fictional-browser.invalid/requirement");
    await page.screenshot({path:"/tmp/signalroom-opportunity-detail.png",fullPage:true});
  } finally {
    await pool.query('DELETE FROM "Company" WHERE id=$1 AND "workspaceId"=$2',[company.id,workspaceId]);
    await pool.query('DELETE FROM "Person" WHERE id=$1 AND "workspaceId"=$2',[personId,workspaceId]);
  }
});

test.afterAll(async () => { await pool.end(); });

test("settings exposes lead APIs, worker readiness and provider-specific controls", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Lead Sources & APIs", exact: true }).click();
  await expect(page.locator("#main").getByRole("heading", { name: "Discovery readiness" })).toBeVisible();
  await expect(page.locator("#main").getByRole("link", { name: "Workers & background jobs", exact: true })).toHaveAttribute("href", "/settings/jobs");
  const form = page.locator("#provider-form");
  await form.getByLabel("Provider", { exact: true }).selectOption("signalhire");
  await expect(form.getByLabel("Provider API key", { exact: true })).toBeVisible();
  await form.getByLabel("Provider", { exact: true }).selectOption("adzuna");
  await expect(form.getByLabel("Adzuna application ID")).toBeVisible();
  await expect(form.getByRole("group", { name: "Job markets" })).toBeVisible();
  await form.getByLabel("Provider", { exact: true }).selectOption("ashby");
  await form.getByRole("button", { name: "Add company board" }).click();
  await expect(form.getByLabel("Board 1 company")).toBeVisible();
  await form.getByLabel("Provider", { exact: true }).selectOption("brave");
  // Removed: search indexes don't reach LinkedIn posts, so that option did nothing.
  await expect(form.getByLabel(/Include indexed public LinkedIn posts/)).toHaveCount(0);
  await page.screenshot({ path: "/tmp/signalroom-provider-settings.png", fullPage: true });
});
