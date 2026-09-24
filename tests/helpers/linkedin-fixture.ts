/**
 * A deterministic stand-in for the Apify LinkedIn actor and a mixed set of fictional posts.
 *
 * The fake implements the same asynchronous contract the adapter uses — start a run, poll it,
 * read its dataset, list runs, read a run's stored INPUT — so tests exercise the real request
 * sequence. Nothing here is LinkedIn data, and results from it say nothing about live coverage.
 */
import type { ActorInput } from "@/lib/providers/linkedin-posts";

export const NOW = Date.UTC(2026, 8, 24, 12);
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();
let seq = 0;
const post = (slug: string, text: string, author: { name: string; headline: string }, postedAt: string | null = daysAgo(3), activity = `7300000000000${String(++seq).padStart(6, "0")}`) =>
  ({ post_url: `https://www.linkedin.com/posts/${slug}_activity-${activity}-abcd?utm_source=share&trk=public`, urn: `urn:li:activity:${activity}`, text, author: { ...author, profile_url: `https://www.linkedin.com/in/${slug}` }, ...(postedAt ? { posted_at: { date: postedAt.replace("T", " ").slice(0, 19), timestamp: Date.parse(postedAt) } } : {}) });

// Each fixture post is fictional, and its role in a test is named.
export const P = {
  namedBuyer: post("fictional-cfo", "We are looking for a NetSuite implementation partner to start in Q4. Budget approved.", { name: "Fictional CFO", headline: "CFO at Northwind Traders" }),
  seller: post("fictional-seller", "Looking for a NetSuite partner? We help mid-market companies implement NetSuite in 90 days. Book a call.", { name: "A Seller", headline: "Founder, NetSuite consultancy" }),
  jobSeeker: post("fictional-seeker", "I'm looking for a new role as a NetSuite consultant. #OpenToWork", { name: "A Seeker", headline: "NetSuite Consultant" }),
  vacancy: post("fictional-hr", "We're hiring a NetSuite Administrator to join our team. Full-time role, apply now.", { name: "HR Person", headline: "HR at Fabrikam" }),
  hiresFreelancer: post("fictional-finance", "We are hiring a freelance NetSuite consultant for a 3-month integration project with Shopify.", { name: "Finance Head", headline: "Head of Finance at Contoso Retail" }),
  recommend: post("fictional-ops", "Can anyone recommend a NetSuite consultant for our warehouse integration?", { name: "Ops Lead", headline: "Operations" }),
  informational: post("fictional-writer", "NetSuite 2026.2 release notes are out. Here is what changed for finance teams.", { name: "Writer", headline: "Analyst" }),
  offTopic: post("fictional-other", "Great quarter for our Salesforce team, thanks everyone.", { name: "Other", headline: "Sales" }),
  old: post("fictional-old", "We are looking for a NetSuite implementation partner for our subsidiary.", { name: "Old Poster", headline: "CFO at Old Co" }, daysAgo(60)),
  undated: post("fictional-undated", "We need a NetSuite consultant to help with our SuiteScript customisation.", { name: "No Date", headline: "Controller" }, null),
  laterPageBuyer: post("fictional-later", "Our company is looking for an Oracle NetSuite partner to help with implementation. Tailspin Toys is ready to start.", { name: "Later", headline: "COO at Tailspin Toys" }),
};
/** The same post as `namedBuyer`, under the other URL LinkedIn uses for it. */
export const duplicateOfNamedBuyer = { ...P.namedBuyer, post_url: `https://www.linkedin.com/feed/update/${P.namedBuyer.urn}/`, urn: undefined };
export const unreadable = { unexpected: true };
export const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => post(`filler-${tag}-${i}`, `Thoughts on NetSuite reporting, part ${i}.`, { name: `Filler ${i}`, headline: "Writer" }));

type Run = { id: string; input: ActorInput; items: unknown[]; status: string; startedAt: string; polls: number };
/**
 * `pages(input)` decides what a page returns. `failStart(input)` makes starting that page fail
 * with the given error, before any run exists; `loseReply` fails it after the run was created. `pollsUntilDone` keeps a run RUNNING for that many polls.
 */
export function fakeApify(opts: { pages: (input: ActorInput) => unknown[]; failStart?: (input: ActorInput, attempt: number) => Error | null; pollsUntilDone?: number; loseReply?: (input: ActorInput, attempt: number) => Error | null }) {
  const runs = new Map<string, Run>();
  const starts: ActorInput[] = []; const calls: string[] = [];
  const startAttempts = new Map<string, number>();
  const view = (r: Run) => ({ data: { id: r.id, status: r.status, defaultDatasetId: `ds-${r.id}`, defaultKeyValueStoreId: `kv-${r.id}`, startedAt: r.startedAt, usageTotalUsd: r.items.length * 0.005 } });
  async function handler(_ws: string, _provider: string, url: string, _headers?: Record<string, string>, body?: Record<string, unknown>): Promise<unknown> {
    const u = new URL(url); calls.push(`${body ? "POST" : "GET"} ${u.pathname}`);
    if (body && /\/acts\/[^/]+\/runs$/.test(u.pathname)) {
      const input = body as unknown as ActorInput;
      if ("total_posts" in body) throw new Error("test: total_posts must never be sent");
      const k = JSON.stringify(input); const attempt = (startAttempts.get(k) ?? 0) + 1; startAttempts.set(k, attempt);
      const fail = opts.failStart?.(input, attempt); if (fail) throw fail;
      starts.push(input);
      const id = `run${runs.size + 1}`;
      const run: Run = { id, input, items: opts.pages(input).slice(0, input.limit), status: opts.pollsUntilDone ? "RUNNING" : "SUCCEEDED", startedAt: new Date().toISOString(), polls: 0 };
      runs.set(id, run);
      // The run was created and will be billed, but its id never reached the caller.
      const lost = opts.loseReply?.(input, attempt); if (lost) throw lost;
      return view(run);
    }
    let m = /\/actor-runs\/([^/]+)$/.exec(u.pathname);
    if (m) { const r = runs.get(m[1])!; if (r.status === "RUNNING" && ++r.polls >= (opts.pollsUntilDone ?? 0)) r.status = "SUCCEEDED"; return view(r); }
    m = /\/datasets\/ds-([^/]+)\/items$/.exec(u.pathname);
    if (m) return runs.get(m[1])!.items;
    if (/\/acts\/[^/]+\/runs$/.test(u.pathname)) return { data: { items: [...runs.values()].reverse().map(r => ({ id: r.id, status: r.status, startedAt: r.startedAt, defaultKeyValueStoreId: `kv-${r.id}` })) } };
    m = /\/key-value-stores\/kv-([^/]+)\/records\/INPUT$/.exec(u.pathname);
    if (m) return runs.get(m[1])!.input;
    if (u.pathname.endsWith("/users/me")) return { data: { id: "u" } };
    throw new Error(`test: unexpected Apify call ${url}`);
  }
  return { handler, runs, starts, calls };
}
