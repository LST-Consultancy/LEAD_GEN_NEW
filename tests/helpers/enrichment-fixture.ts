/**
 * A synthetic enrichment fixture modelled on the reported screen: "Atzean Technologies LLP", domain
 * unknown, an opportunity asking for IT staffing vendors, nobody saved. Every domain here ends in
 * .example (reserved, RFC 2606) and every person is invented — none of it describes a real company,
 * person or mailbox, and results from it say nothing about live Apify coverage.
 */
import { ProviderRequestError } from "@/lib/providers/provider-errors";

export const ATZEAN = { name: "Atzean Technologies LLP" };
export const COMPANY_URL = "https://www.linkedin.com/company/atzean-technologies-synthetic";
export const POST_REFERENCE = { authorName: "Riya Synthetic", authorHeadline: "Head of Delivery at Atzean Technologies LLP", authorProfileUrl: "https://www.linkedin.com/in/riya-synthetic" };
export const POST_TEXT = "We are looking for IT staffing partners and vendors to supply contract Java developers for a client project in Pune. Share your rate card at partners@atzean-synthetic.example.\n\nPosted by Riya Synthetic, Head of Delivery at Atzean Technologies LLP";

// apify/google-search-scraper: one item per results page.
export const SEARCH_ITEMS = [{ searchQuery: { term: '"Atzean Technologies LLP" official website' }, organicResults: [
  { title: "Atzean Technologies LLP - IT staffing and consulting", url: "https://www.atzean-synthetic.example/", description: "IT staffing, contract developers and software consulting from Pune." },
  { title: "Atzean Technologies LLP | LinkedIn", url: "https://in.linkedin.com/company/atzean-technologies-synthetic", description: "Atzean Technologies LLP | 45 followers on LinkedIn." },
  { title: "ATZEAN TECHNOLOGIES LLP - Company details", url: "https://www.zaubacorp.com/company/ATZEAN-TECHNOLOGIES-LLP/X", description: "Registered LLP." },
] }];
// harvestapi/linkedin-company, shaped as in its documented example.
export const COMPANY_PAGE = { id: "900001", universalName: "atzean-technologies-synthetic", linkedinUrl: `${COMPANY_URL}/`, name: "Atzean Technologies LLP", website: "https://www.atzean-synthetic.example/?utm_source=linkedin", employeeCount: 45, employeeCountRange: { start: 11, end: 50 }, description: "IT staffing and software consulting for product companies.", industries: ["IT Services and IT Consulting"], locations: [{ country: "IN", city: "Pune", headquarter: true, parsed: { city: "Pune", state: "Maharashtra", country: "India" } }] };
// harvestapi/linkedin-company-employees, shaped as in its documented example.
const position = (position: string | null, endDate = "Present", companyLinkedinUrl = `${COMPANY_URL}/`) => ({ ...(position ? { position } : {}), companyName: "Atzean Technologies LLP", companyLinkedinUrl, startDate: { text: "Jan 2023" }, endDate: { text: endDate } });
export const EMPLOYEES = [
  { linkedinUrl: "https://www.linkedin.com/in/riya-synthetic", publicIdentifier: "riya-synthetic", firstName: "Riya", lastName: "Synthetic", headline: "Head of Delivery | Talent Acquisition", location: { parsed: { city: "Pune", country: "India" } }, verified: true, experience: [position("Head of Delivery & Talent Acquisition")] },
  { linkedinUrl: "https://www.linkedin.com/in/former-person-synthetic", firstName: "Former", lastName: "Person", headline: "Recruiter", experience: [position("Technical Recruiter", "Mar 2024")] },
  { linkedinUrl: "https://www.linkedin.com/in/unrelated-person-synthetic", firstName: "Unrelated", lastName: "Person", headline: "Engineer", experience: [{ position: "Engineer", companyName: "Northwind Synthetic", companyLinkedinUrl: "https://www.linkedin.com/company/northwind-synthetic/", endDate: { text: "Present" } }] },
  { linkedinUrl: "https://www.linkedin.com/in/arjun-synthetic", firstName: "Arjun", currentPosition: [{ companyName: "Atzean Technologies LLP" }] },
];
// automation-lab/website-contact-finder, shaped as its dataset schema.
export const WEBSITE_ITEMS = [{ websiteUrl: "https://atzean-synthetic.example/", emails: ["info@atzean-synthetic.example", "riya.synthetic@atzean-synthetic.example", "careers@atzean-synthetic.example", "sales.lead@othercorp.example", "karan.mehta@atzean-synthetic.example"], contactPageUrl: "https://atzean-synthetic.example/contact", scanStatus: "succeeded", pagesSucceeded: 6, socialLinks: { linkedin: `${COMPANY_URL}/` } }];
// bounceverify/bounceverify-email-verifier, fields as in its documented example.
export const VERIFY_ITEMS = [
  { email: "riya.synthetic@atzean-synthetic.example", status: "valid", syntax_valid: true, domain_exists: true, mx_found: true, smtp_valid: true, is_catch_all: false, reason: "SMTP mailbox exists" },
  { email: "info@atzean-synthetic.example", status: "risky", syntax_valid: true, domain_exists: true, mx_found: true, smtp_valid: true, is_catch_all: true, reason: "Catch-all domain" },
  { email: "careers@atzean-synthetic.example", status: "unknown", syntax_valid: true, domain_exists: true, mx_found: true, smtp_valid: false, is_catch_all: false, reason: "SMTP connection timed out" },
  { email: "karan.mehta@atzean-synthetic.example", status: "invalid", syntax_valid: true, domain_exists: true, mx_found: true, smtp_valid: false, is_catch_all: false, reason: "Mailbox does not exist" },
  { email: "partners@atzean-synthetic.example", status: "unknown", syntax_valid: true, domain_exists: true, mx_found: true, is_catch_all: false },
  { email: "format.only@atzean-synthetic.example", syntax_valid: true },
  { email: "odd@atzean-synthetic.example" },
];

type Handler = (input: Record<string, unknown>) => unknown[] | Error;
type Run = { id: string; actor: string; input: Record<string, unknown>; items: unknown[]; status: string; startedAt: string; polls: number };
/**
 * A fake of Apify's run API for several Actors, routed by Actor. `loseReply(actor)` creates the run
 * and then fails the reply, as a dropped connection would; `pollsUntilDone` keeps runs RUNNING.
 */
export function fakeActors(handlers: Record<string, Handler>, opts: { pollsUntilDone?: number; loseReply?: (actor: string, attempt: number) => boolean } = {}) {
  const runs = new Map<string, Run>(); const starts: { actor: string; input: Record<string, unknown> }[] = []; const aborted: string[] = [];
  const attempts = new Map<string, number>();
  const view = (r: Run) => ({ data: { id: r.id, status: r.status, defaultDatasetId: `ds-${r.id}`, defaultKeyValueStoreId: `kv-${r.id}`, startedAt: r.startedAt, usageTotalUsd: Math.round(r.items.length * 0.004 * 1000) / 1000 } });
  async function handler(_ws: string, _provider: string, url: string, _headers?: Record<string, string>, body?: Record<string, unknown>): Promise<unknown> {
    const u = new URL(url);
    let m = /^\/v2\/acts\/([^/]+)\/runs$/.exec(u.pathname);
    if (m && body) {
      const actor = decodeURIComponent(m[1]).replace("~", "/");
      const h = handlers[actor]; if (!h) throw new Error(`test: no handler for ${actor}`);
      const out = h(body);
      if (out instanceof Error) throw out;
      starts.push({ actor, input: body });
      const id = `run${runs.size + 1}`;
      const run: Run = { id, actor, input: body, items: out, status: opts.pollsUntilDone ? "RUNNING" : "SUCCEEDED", startedAt: new Date().toISOString(), polls: 0 };
      runs.set(id, run);
      const n = (attempts.get(actor) ?? 0) + 1; attempts.set(actor, n);
      if (opts.loseReply?.(actor, n)) throw new ProviderRequestError("lost", "network");
      return view(run);
    }
    if (m) return { data: { items: [...runs.values()].filter(r => r.actor === decodeURIComponent(m![1]).replace("~", "/")).reverse().map(r => ({ id: r.id, status: r.status, startedAt: r.startedAt, defaultKeyValueStoreId: `kv-${r.id}` })) } };
    m = /^\/v2\/actor-runs\/([^/]+)\/abort$/.exec(u.pathname);
    if (m) { const r = runs.get(m[1])!; r.status = "ABORTED"; aborted.push(r.id); return view(r); }
    m = /^\/v2\/actor-runs\/([^/]+)$/.exec(u.pathname);
    if (m) { const r = runs.get(m[1])!; if (r.status === "RUNNING" && ++r.polls >= (opts.pollsUntilDone ?? 0)) r.status = "SUCCEEDED"; return view(r); }
    m = /^\/v2\/datasets\/ds-([^/]+)\/items$/.exec(u.pathname);
    if (m) { const offset = Number(u.searchParams.get("offset") ?? 0); const limit = Number(u.searchParams.get("limit") ?? 1000); return runs.get(m[1])!.items.slice(offset, offset + limit); }
    m = /^\/v2\/key-value-stores\/kv-([^/]+)\/records\/INPUT$/.exec(u.pathname);
    if (m) return runs.get(m[1])!.input;
    if (/^\/v2\/acts\/[^/]+$/.test(u.pathname)) return { data: { id: "actor" } };
    if (u.pathname === "/v2/users/me") return { data: { id: "u" } };
    throw new Error(`test: unexpected Apify call ${url}`);
  }
  return { handler, runs, starts, aborted, startsOf: (actor: string) => starts.filter(s => s.actor === actor).length };
}
export const quotaError = () => new ProviderRequestError("Provider request failed (HTTP 402).", "http", 402);
