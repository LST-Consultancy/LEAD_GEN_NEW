import { afterAll, describe, expect, it, vi } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { ingestOpportunity, discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { getOpportunity, listOpportunities, getOpportunitySearch } from "@/lib/services/opportunities";
import { connectOpportunityProvider, listOpportunityProviders } from "@/lib/services/opportunity-providers";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { listDiscoveryCandidates, reviewDiscoveryCandidate } from "@/lib/services/discovery-review";
import { randomUUID } from "node:crypto";
vi.mock("@/lib/providers/http", () => ({ providerJson: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
async function workspace() { const w=await makeWorkspace("OpportunityFixture"); created.workspaceIds.push(w.workspace.id);created.userIds.push(w.user.id);created.planIds.push(w.plan.id); return w; }
const criteria=parseOpportunityQuery("NetSuite implementation");
async function search(w: Awaited<ReturnType<typeof workspace>>) { return db.opportunitySearch.create({data:{workspaceId:w.workspace.id,createdById:w.user.id,query:"NetSuite implementation",criteria,providers:["greenhouse"],idempotencyKey:randomUUID()}}); }
const doc: SourceDocument={provider:"greenhouse",kind:"JOB_BOARD",externalId:"fictional:1",title:"NetSuite implementation developer",description:"We are hiring a NetSuite implementation developer.",company:{name:"Fictional Opportunity Fixture",domain:"opportunity-fixture.invalid"},postedAt:null,sourceUrl:"https://opportunity-fixture.invalid/jobs/1",rawSourceReference:{id:"fictional:1"},status:"ACTIVE"};
afterAll(async()=>{ await cleanup(created); await db.$disconnect();vi.unstubAllEnvs(); });
describe("opportunity persistence and tenancy",()=>{
 it("deduplicates retries, preserves unknown posting dates and versions changed content",async()=>{ const w=await workspace();const s=await search(w); const first=await ingestOpportunity(w.workspace.id,s.id,doc,criteria,{allowedExport:false,retentionDays:30});await ingestOpportunity(w.workspace.id,s.id,doc,criteria,{allowedExport:false,retentionDays:30}); expect(await db.opportunity.count({where:{workspaceId:w.workspace.id}})).toBe(1);expect(await db.company.count({where:{workspaceId:w.workspace.id}})).toBe(1);expect(await db.opportunityVersion.count({where:{workspaceId:w.workspace.id}})).toBe(0); const before=await getOpportunity(w.ctx,first!.id);expect(before.postedAt).toBeNull();await ingestOpportunity(w.workspace.id,s.id,{...doc,description:doc.description+" Integration responsibilities added."},criteria,{allowedExport:false,retentionDays:30});const after=await getOpportunity(w.ctx,first!.id);expect(after.versions).toHaveLength(1);expect(after.discoveredAt).toBe(before.discoveredAt);expect(after.sources).toHaveLength(1);expect(after.evidence.reduce((n,e)=>n+e.scoreContribution,0)).toBe(after.intentScore); });
 it("merges matching source records across providers",async()=>{const w=await workspace();const s=await search(w); await ingestOpportunity(w.workspace.id,s.id,doc,criteria,{allowedExport:false,retentionDays:30});await ingestOpportunity(w.workspace.id,s.id,{...doc,provider:"lever",externalId:"other:1"},criteria,{allowedExport:false,retentionDays:30});const list=await listOpportunities(w.ctx);expect(list.total).toBe(1);expect(list.items[0].sources).toHaveLength(2);});
 it("rejects cross-workspace reads and ingestion links",async()=>{const a=await workspace();const b=await workspace();const s=await search(a);const r=await ingestOpportunity(a.workspace.id,s.id,doc,criteria,{allowedExport:false,retentionDays:30});await expect(getOpportunity(b.ctx,r!.id)).rejects.toMatchObject({status:404});await expect(getOpportunitySearch(b.ctx,s.id)).rejects.toMatchObject({status:404});expect((await listOpportunities(b.ctx)).total).toBe(0);await expect(ingestOpportunity(b.workspace.id,s.id,doc,criteria,{allowedExport:false,retentionDays:30})).rejects.toThrow();});
 it("reports unavailable providers as failure, not empty completed searches",async()=>{const w=await workspace();const s=await search(w);expect(await discoverOpportunities(w.workspace.id,s.id)).toMatchObject({state:"FAILED",qualified:0});expect((await getOpportunitySearch(w.ctx,s.id)).providerResults).toMatchObject({greenhouse:{status:"NOT_CONNECTED"}});});
 it("encrypts credentials and never returns them",async()=>{vi.stubEnv("PROVIDER_ENCRYPTION_KEY","ab".repeat(32));const w=await workspace();await connectOpportunityProvider(w.ctx,"hunter",{apiKey:"fictional-test-secret",config:{boards:[]},allowedStorage:true,allowedEnrichment:true});const stored=await db.providerConnection.findFirst({where:{workspaceId:w.workspace.id}});expect(stored?.encryptedCredentials).not.toContain("fictional-test-secret");expect(JSON.stringify(await listOpportunityProviders(w.ctx))).not.toContain("fictional-test-secret");});
});

describe("configured discovery worker",()=>{
 it("persists a real adapter response, reports progress and does not duplicate on redelivery",async()=>{
   const w=await workspace();const s=await search(w);
   await connectOpportunityProvider(w.ctx,"greenhouse",{config:{boards:[{slug:"fictional",company:"Fictional Fixture",domain:"fixture.invalid"}]},allowedSearch:true,allowedStorage:true});
   vi.mocked(providerJson).mockResolvedValue({jobs:[{id:42,title:"NetSuite implementation developer",absolute_url:"https://fixture.invalid/job/42",content:"Hiring NetSuite implementation developer"}]});
   expect(await discoverOpportunities(w.workspace.id,s.id)).toMatchObject({state:"COMPLETED",qualified:1});
   expect((await getOpportunitySearch(w.ctx,s.id)).progress).toBe(100);
   expect(await discoverOpportunities(w.workspace.id,s.id)).toMatchObject({skipped:true});
   expect(await db.opportunity.count({where:{workspaceId:w.workspace.id}})).toBe(1);
 });
 it("separates successful empty discovery from provider errors",async()=>{
   const w=await workspace();const s=await search(w);
   await connectOpportunityProvider(w.ctx,"greenhouse",{config:{boards:[{slug:"fictional",company:"Fictional Fixture",domain:"fixture.invalid"}]},allowedSearch:true,allowedStorage:true});
   vi.mocked(providerJson).mockResolvedValue({jobs:[]});expect(await discoverOpportunities(w.workspace.id,s.id)).toMatchObject({state:"COMPLETED",qualified:0});
   const failed=await search(w);vi.mocked(providerJson).mockRejectedValue(new Error("Test provider failure"));expect(await discoverOpportunities(w.workspace.id,failed.id)).toMatchObject({state:"FAILED",qualified:0});
 });
});

describe("unresolved discovery evidence", () => {
 it("retains and deduplicates unresolved posts without manufacturing companies, then qualifies confirmed buyers", async () => {
   vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32)); const w = await workspace(); const other = await workspace(); const s = await search(w);
   const post = { ...doc, provider: "brave", kind: "LINKEDIN_PUBLIC_POST", description: "Looking for a NetSuite implementation partner", company: { name: "" } };
   await connectOpportunityProvider(w.ctx, "brave", { apiKey: "fixture-key", config: {}, allowedSearch: true, allowedStorage: true });
   await ingestOpportunity(w.workspace.id, s.id, post, criteria, { allowedExport: false, retentionDays: 30 });
   await ingestOpportunity(w.workspace.id, s.id, post, criteria, { allowedExport: false, retentionDays: 30 });
   const candidates = await listDiscoveryCandidates(w.ctx); expect(candidates).toHaveLength(1); expect(await db.company.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
   expect(await listDiscoveryCandidates(other.ctx)).toEqual([]);
   await expect(reviewDiscoveryCandidate(other.ctx, candidates[0].id, { action: "dismiss" })).rejects.toMatchObject({ status: 404 });
   const result = await reviewDiscoveryCandidate(w.ctx, candidates[0].id, { action: "qualify", company: "Fictional Confirmed Buyer", domain: "confirmed-buyer.invalid" });
   expect(result.status).toBe("QUALIFIED"); expect((await getOpportunity(w.ctx, result.opportunityId!)).company.name).toBe("Fictional Confirmed Buyer"); expect(await listDiscoveryCandidates(w.ctx)).toEqual([]);
   const again = await reviewDiscoveryCandidate(w.ctx, candidates[0].id, { action: "qualify", company: "Fictional Confirmed Buyer" }); expect(again.opportunityId).toBe(result.opportunityId);
 });
 it("does not expose expired candidate evidence", async () => { const w = await workspace(); const s = await search(w); await ingestOpportunity(w.workspace.id, s.id, { ...doc, company: { name: "" } }, criteria, { allowedExport: false, retentionDays: 1 }, new Date(Date.now() - 2 * 86400000)); expect(await listDiscoveryCandidates(w.ctx)).toEqual([]); });
});
