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

const funnel = { queriesPlanned: 8, queriesRun: 8, pagesAttempted: 11, pagesCompleted: 11, pagesFailed: 0, postsRequested: 190, returned: 176, unmappable: 1, duplicates: 41, unique: 134, qualifiedNew: 4, qualifiedKnown: 1,
  review: { buyer_unresolved: 22, filter_unknown: 3 }, rejected: { seller_promotion: 51, not_relevant: 23, internal_hiring: 17, informational: 9, job_seeker: 4 }, usageUsd: 0.88,
  perQuery: [{ keyword: '"NetSuite" ("looking for" OR "seeking" OR "searching for") (consultant OR partner OR "implementation partner")', pages: 2, returned: 50, unique: 44, qualified: 2, end: "page_cap" }] };

async function workspaceId() {
  return (await pool.query('SELECT m."workspaceId" FROM "WorkspaceMember" m JOIN "User" u ON u.id=m."userId" WHERE u.email=$1 AND m."deletedAt" IS NULL ORDER BY m."isDefault" DESC LIMIT 1', ["rahul@northbridge.example"])).rows[0].workspaceId as string;
}
async function withLinkedInConnection<T>(ws: string, fn: () => Promise<T>) {
  const existing = (await pool.query('SELECT id FROM "ProviderConnection" WHERE "workspaceId"=$1 AND provider=$2', [ws, "linkedin_posts"])).rows[0];
  const id = randomUUID();
  if (!existing) await pool.query('INSERT INTO "ProviderConnection" (id,"workspaceId",provider,config,enabled,"allowedSearch","allowedStorage",status,"updatedAt") VALUES ($1,$2,$3,$4,true,true,true,$5,now())', [id, ws, "linkedin_posts", JSON.stringify({ maxPostsPerSearch: 300 }), "FIXTURE"]);
  try { return await fn(); } finally { if (!existing) await pool.query('DELETE FROM "ProviderConnection" WHERE id=$1', [id]); }
}
async function shots(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: `${SHOTS}/${name}-mobile.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${SHOTS}/${name}-mobile-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: "light" });
  return overflow;
}

test("a LinkedIn search shows its plan and budget before running, and its funnel after", async ({ page }) => {
  const ws = await workspaceId();
  await withLinkedInConnection(ws, async () => {
    const jobId = randomUUID();
    await page.route("**/api/opportunities/search", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: jobId, state: "QUEUED", progress: 0, found: 0, qualified: 0, providerResults: {}, needsReview: 0, rejected: 0, retryPending: 0, crmLeads: 0, retries: [], resumable: false }) }));
    await page.route(`**/api/opportunities/search/${jobId}`, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: jobId, state: "COMPLETED", progress: 100, found: 134, qualified: 5, startedAt: new Date().toISOString(), providerResults: { linkedin_posts: { status: "COMPLETED", found: 134, funnel, stop: "depth_limit", dateNote: null, options: { targetQualified: 10, maxPosts: 200, depth: "standard", edited: false } } }, needsReview: 25, rejected: 104, retryPending: 0, crmLeads: 0, retries: [], resumable: false }) }));
    await page.route(`**/api/opportunities?searchId=${jobId}`, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ total: 0, page: 1, items: [] }) }));
    await page.goto("/find-leads");
    await page.getByLabel("Service or requirement").fill("NetSuite implementation");
    await expect(page.getByRole("checkbox", { name: /LinkedIn posts/ })).toBeChecked();
    await page.getByText(/^LinkedIn search:/).click();
    await expect(page.getByText(/"Oracle NetSuite"/).first()).toBeVisible();
    await expect(page.getByText(/at most 200 posts/)).toBeVisible();
    await page.getByRole("button", { name: "Edit queries" }).click();
    await expect(page.getByLabel("LinkedIn queries, one per line")).toContainText('"SuiteScript"');
    expect(await shots(page, "linkedin-options")).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Find Opportunities", exact: true }).click();
    await expect(page.getByText(/Stopped:.*search depth reached/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Unique posts", { exact: true })).toBeVisible();
    await expect(page.getByText(/Added to CRM:/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Review 25 posts" })).toBeVisible();
    await expect(page.getByText(/51 of 134 unique posts were set aside as “seller promotion”/)).toBeVisible();
    expect(await shots(page, "linkedin-funnel")).toBeLessThanOrEqual(0);
    // The app shell scrolls inside #main, so capture the funnel itself too.
    await page.getByText(/Stopped:/).scrollIntoViewIfNeeded();
    await page.locator("li", { has: page.getByText(/Stopped:/) }).screenshot({ path: `${SHOTS}/linkedin-funnel-panel.png` });
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: "dark" });
    await page.locator("li", { has: page.getByText(/Stopped:/) }).screenshot({ path: `${SHOTS}/linkedin-funnel-panel-mobile-dark.png` });
  });
});

test("review shows each post's reason and evidence, and rejected posts can be inspected", async ({ page }) => {
  const ws = await workspaceId();
  const owner = (await pool.query('SELECT id FROM "User" WHERE email=$1', ["rahul@northbridge.example"])).rows[0].id;
  const searchId = randomUUID();
  await pool.query('INSERT INTO "OpportunitySearch" (id,"workspaceId","createdById",query,criteria,providers,state,"idempotencyKey","finishedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', [searchId, ws, owner, "NetSuite implementation", JSON.stringify({ services: ["NetSuite implementation"], technologies: ["NetSuite"], opportunityTypes: [], locations: ["United States"], industries: [], employeeMin: null, employeeMax: null, dateRange: { days: 30 }, minimumIntent: 0, expandedTerms: [], negativeKeywords: [], domains: [] }), ["linkedin_posts"], "COMPLETED", randomUUID()]);
  const candidate = (status: string, reason: string, classification: string, title: string, evidence: object, suggested: string | null) => pool.query('INSERT INTO "DiscoveryCandidate" (id,"workspaceId","searchId",provider,"sourceUrl",title,description,kind,document,status,reason,classification,evidence,"suggestedBuyer","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()+interval \'1 day\')',
    [randomUUID(), ws, searchId, "linkedin_posts", `https://www.linkedin.com/posts/fictional-e2e-${randomUUID()}`, title, `${title}\n\nPosted by Fictional Author, Head of Finance at Contoso Retail`, "LINKEDIN_PUBLIC_POST", JSON.stringify({ title }), status, reason, classification, JSON.stringify(evidence), suggested]);
  try {
    await candidate("REVIEW", "filter_unknown", "buying", "Fictional: we are hiring a freelance NetSuite consultant for a Shopify integration", { quote: "we are hiring a freelance NetSuite consultant", matchedTerms: ["NetSuite"], filters: [{ field: "location", wanted: "United States", state: "unknown", value: null }], query: '"NetSuite" (hiring OR "looking to hire") (freelancer OR contractor)', suggestedFrom: "author_headline", reviewReasons: ["filter_unknown"] }, "Contoso Retail");
    await candidate("REJECTED", "seller_promotion", "seller_promotion", "Fictional: Looking for a NetSuite partner? We help mid-market firms. Book a call.", { quote: "Looking for a NetSuite partner? We help", matchedTerms: ["NetSuite"], filters: [], query: '"NetSuite" RFP' }, null);
    await page.goto(`/opportunities/review?searchId=${searchId}`);
    await expect(page.getByText("Company details unknown.")).toBeVisible();
    await expect(page.getByText("location: unknown")).toBeVisible();
    await expect(page.getByLabel("Buying company")).toHaveValue("Contoso Retail");
    await expect(page.getByText(/is a suggestion read from the author's headline/)).toBeVisible();
    expect(await shots(page, "linkedin-review")).toBeLessThanOrEqual(0);
    await page.locator("article").first().screenshot({ path: `${SHOTS}/linkedin-review-card.png` });
    await page.getByRole("link", { name: /^Rejected/ }).click();
    await expect(page.getByText("Seller promotion.")).toBeVisible();
    await expect(page.getByRole("button", { name: /qualify it anyway/ })).toBeVisible();
    expect(await shots(page, "linkedin-rejected")).toBeLessThanOrEqual(0);
  } finally {
    await pool.query('DELETE FROM "OpportunitySearch" WHERE id=$1 AND "workspaceId"=$2', [searchId, ws]);
  }
});
