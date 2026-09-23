import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/providers/http",()=>({providerJson:vi.fn()}));
import { providerJson } from "@/lib/providers/http";
import { discoveryProvider } from "@/lib/providers/discovery";
import { signalHireProvider } from "@/lib/providers/signalhire";
import { hunterProvider } from "@/lib/providers/hunter";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
const request=vi.mocked(providerJson);
const config={boards:[{slug:"fictional-fixture",company:"Fictional Fixture",domain:"fictional.invalid"}]};
const query=parseOpportunityQuery("NetSuite implementation");
beforeEach(()=>{ request.mockReset(); });
describe("provider contracts using explicitly fictional HTTP fixtures",()=>{
 it("normalizes Greenhouse without inventing a posting date",async()=>{request.mockResolvedValue({jobs:[{id:42,title:"NetSuite Developer",absolute_url:"https://fictional.invalid/job/42",content:"<p>We are hiring.</p>",updated_at:"2026-09-23T00:00:00Z"}]});const result=await discoveryProvider("workspace","greenhouse",config).search(query);expect(result[0].postedAt).toBeNull();expect(result[0].updatedAt).toBe("2026-09-23T00:00:00.000Z");expect(result[0].company.name).toBe("Fictional Fixture");});
 it("normalizes Lever source dates and application links",async()=>{request.mockResolvedValue([{id:"42",text:"NetSuite Developer",hostedUrl:"https://fictional.invalid/job/42",createdAt:1790121600000,descriptionPlain:"Hiring NetSuite developer",applyUrl:"https://fictional.invalid/apply/42"}]);const result=await discoveryProvider("workspace","lever",config).search(query);expect(result[0].postedAt).not.toBeNull();expect(result[0].applicationUrl).toContain("apply/42");});
 it("does not mistake a web publisher for a company",async()=>{request.mockResolvedValue({web:{results:[{title:"NetSuite requirement",url:"https://publisher.invalid/article",description:"NetSuite implementation"}]}});const records = await discoveryProvider("workspace","brave",config,"test-only-key").search(query); expect(records).toHaveLength(1); expect(records[0].company.name).toBe("");});
 it("does not fabricate records after provider failure",async()=>{request.mockRejectedValue(new Error("Provider unavailable"));const outcome = await discoveryProvider("workspace","greenhouse",config).search(query).then(() => "unexpected success", error => (error as Error).message); expect(outcome).toBe("Provider unavailable");});
 it("returns true empty results for a successful empty board",async()=>{request.mockResolvedValue({jobs:[]});expect(await discoveryProvider("workspace","greenhouse",config).search(query)).toEqual([]);});
 it("keeps LinkedIn unavailable instead of using credentials as implied access",async()=>{await expect(discoveryProvider("workspace","linkedin",config).search(query)).rejects.toThrow("LinkedIn capability unavailable");expect(request).not.toHaveBeenCalled();});
 it.each([["valid",false,false,"VALID"],["invalid",false,false,"INVALID"],["valid",true,false,"DISPOSABLE"],["valid",false,true,"ACCEPT_ALL"],["unknown",false,false,"UNKNOWN"]])("uses Hunter verification status %s",async(status,disposable,accept_all,expected)=>{request.mockResolvedValue({data:{status,disposable,accept_all,score:80}});expect((await hunterProvider("workspace","test-only-key").verifyEmail("fictional@fictional.invalid")).status).toBe(expected);});
});

describe("expanded discovery adapters", () => {
 it("searches public LinkedIn posts without requiring company domains or inventing a buyer/date", async () => {
   request.mockResolvedValue({ web: { results: [{ title: "Fictional buyer seeks NetSuite partner", url: "https://www.linkedin.com/posts/fictional-example", description: "Looking for a NetSuite implementation partner", page_age: "2026-09-23T00:00:00Z" }] } });
   const rows = await discoveryProvider("workspace", "brave", { boards: [] }, "test-key").search(query);
   expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ kind: "LINKEDIN_PUBLIC_POST", company: { name: "" }, postedAt: null });
   expect(request.mock.calls.some(c => new URL(c[2]).searchParams.get("q")?.includes("site:linkedin.com/posts/"))).toBe(true);
 });
 it("reads Ashby listed jobs only and preserves supplied dates", async () => {
   request.mockResolvedValue({ jobs: [{ title: "NetSuite developer", jobUrl: "https://jobs.ashbyhq.com/fictional/1", descriptionPlain: "We are hiring", publishedAt: "2026-09-22T00:00:00Z", isListed: true }, { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/fictional/2", isListed: false }] });
   const rows = await discoveryProvider("workspace", "ashby", config).search(query); expect(rows).toHaveLength(1); expect(rows[0].postedAt).toBe("2026-09-22T00:00:00.000Z");
 });
 it("discovers new employers from Adzuna without configured boards", async () => {
   request.mockResolvedValue({ results: [{ id: "42", title: "NetSuite developer", description: "We are hiring", redirect_url: "https://adzuna.com/jobs/42", company: { display_name: "Fictional New Employer" }, location: { display_name: "New York" }, created: "2026-09-22T00:00:00Z" }] });
   const rows = await discoveryProvider("workspace", "adzuna", { boards: [], appId: "test-app", countries: ["us"] }, "test-key").search(query);
   expect(rows[0].company).toEqual({ name: "Fictional New Employer", country: "United States" }); expect(rows[0].status).toBe("UNKNOWN"); expect(new URL(request.mock.calls[0][2]).searchParams.get("app_id")).toBe("test-app");
 });
 it("retains retrieved documents when a later market request fails", async () => {
   request.mockResolvedValueOnce({ results: [{ id: "42", title: "NetSuite developer", description: "Hiring", redirect_url: "https://adzuna.com/jobs/42", company: { display_name: "Fictional Employer" } }] }).mockRejectedValueOnce(new Error("quota"));
   await expect(discoveryProvider("workspace", "adzuna", { appId: "test", countries: ["us", "gb"], maxQueries: 1 }, "test").search(query)).rejects.toMatchObject({ documents: [expect.objectContaining({ externalId: "us:42" })] });
 });
 it("SignalHire checks current company and returns only work emails", async () => {
   request.mockResolvedValueOnce({ profiles: [{ uid: "fictional1" }, { uid: "fictional2" }] }).mockResolvedValueOnce([
     { item: "fictional1", status: "success", candidate: { uid: "fictional1", fullName: "Fictional Buyer", experience: [{ company: "Fictional Employer", position: "CTO", current: true }], contacts: [{ type: "email", value: "buyer@fictional.invalid", subType: "work", rating: 100 }, { type: "email", value: "personal@fictional.invalid", subType: "personal", rating: 100 }] } },
     { item: "fictional2", status: "success", candidate: { uid: "fictional2", fullName: "Former Buyer", experience: [{ company: "Fictional Employer", position: "CTO", current: false }], contacts: [{ type: "email", value: "former@fictional.invalid", subType: "work" }] } },
   ]);
   const rows = await signalHireProvider("workspace", "test-key").findPerson("Fictional Employer"); expect(rows).toHaveLength(1); expect(rows[0].email).toBe("buyer@fictional.invalid"); expect(request.mock.calls[1][4]).toMatchObject({ withoutWaterfall: true, items: ["fictional1", "fictional2"] });
 });
 it("SignalHire preserves empty searches without spending lookup credits", async () => { request.mockResolvedValue({ profiles: [] }); expect(await signalHireProvider("workspace", "key").findPerson("Fictional")).toEqual([]); expect(request).toHaveBeenCalledTimes(1); });
});
