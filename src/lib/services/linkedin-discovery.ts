import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { complete } from "@/lib/ai/complete";
import { canonicalUrl } from "@/lib/opportunities/identity";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import { BUYER_SYSTEM_PROMPT, buyerPrompt, parseBuyerReply, verifyBuyer } from "@/lib/opportunities/buyer";
import { mapLinkedInPost } from "@/lib/opportunities/linkedin-post";
import { effectivePlan, linkedInDateWindow, relevanceTerms, resolveOptions, type ResolvedOptions } from "@/lib/opportunities/linkedin-plan";
import { decidePost, REVIEW_ORDER, suggestBuyerFromHeadline, type PostDecision, type ReviewReason } from "@/lib/opportunities/linkedin-qualify";
import { freshCheckpoint, funnelOf, runLinkedInPlan, type Funnel, type Outcome, type RunCheckpoint, type StopReason } from "@/lib/opportunities/linkedin-run";
import { actorInput, fetchLinkedInPage, LINKEDIN_POSTS_PROVIDER } from "@/lib/providers/linkedin-posts";
import { ingestOpportunity } from "./opportunity-ingestion";

type Policy = { allowedExport: boolean; retentionDays: number };
export type LinkedInOutcome = {
  status: "COMPLETED" | "PARTIAL" | "ERROR" | "CANCELLED"; found: number; message?: string;
  funnel: Funnel; stop: StopReason; stopDetail?: string; dateNote: string | null;
  options: Omit<ResolvedOptions, "queries"> & { edited: boolean };
};

// ── Buyer attribution ────────────────────────────────────────────────────────────────────────────
const AI_BATCH = 20;
export type Attribution = { status: "named"; name: string; quote: string; model: string } | { status: "unresolved" } | { status: "ai_unavailable" };
/**
 * Asks the model who is buying, for posts the rules already judged to be buying requests. The
 * model can only point at a name and quote that literally appear in the post (verifyBuyer); when
 * it cannot run, the posts are marked for retry rather than dropped.
 */
export async function attributeBuyers(workspaceId: string, docs: SourceDocument[], criteria: SearchCriteria): Promise<Attribution[]> {
  const out: Attribution[] = [];
  for (let i = 0; i < docs.length; i += AI_BATCH) {
    const batch = docs.slice(i, i + AI_BATCH);
    const reply = await complete({ workspaceId, userId: null }, { feature: "buyer_attribution", system: BUYER_SYSTEM_PROMPT, prompt: buyerPrompt(batch), maxTokens: 6000, timeoutMs: 60_000 }).catch(() => ({ ok: false as const }));
    if (!reply.ok) { out.push(...batch.map(() => ({ status: "ai_unavailable" as const }))); continue; }
    const proposals = new Map(parseBuyerReply(reply.text).map(p => [p.i, p]));
    batch.forEach((doc, j) => {
      const proposal = proposals.get(j);
      const verified = proposal ? verifyBuyer(doc, criteria, proposal) : null;
      out.push(verified ? { status: "named", name: verified.name, quote: verified.quote, model: reply.model } : { status: "unresolved" });
    });
  }
  return out;
}

// ── Candidate storage ────────────────────────────────────────────────────────────────────────────
type CandidateInput = { status: "REVIEW" | "REJECTED"; reason: string; classification: string | null; evidence: Record<string, unknown>; processing: "DONE" | "RETRY_PENDING"; suggestedBuyer: string | null };
/**
 * One row per post per search. A replayed page rewrites its own rows, but never one a person has
 * already qualified or dismissed.
 */
export async function storeCandidate(workspaceId: string, searchId: string, doc: SourceDocument, c: CandidateInput, policy: Policy, now: Date) {
  const sourceUrl = canonicalUrl(doc.sourceUrl);
  const where = { workspaceId_searchId_sourceUrl: { workspaceId, searchId, sourceUrl } };
  const data = { status: c.status, reason: c.reason, classification: c.classification, evidence: c.evidence as Prisma.InputJsonValue, processing: c.processing, suggestedBuyer: c.suggestedBuyer, title: doc.title, description: doc.description, postedAt: doc.postedAt ? new Date(doc.postedAt) : null, document: doc as unknown as Prisma.InputJsonValue };
  const current = await db.discoveryCandidate.findUnique({ where, select: { id: true, status: true } });
  if (!current) {
    await db.discoveryCandidate.create({ data: { workspaceId, searchId, provider: doc.provider, sourceUrl, kind: doc.kind, expiresAt: new Date(now.getTime() + policy.retentionDays * 86400000), ...data } }).catch(async error => {
      // A concurrent writer created it first; fall through to the guarded update.
      if (!(await db.discoveryCandidate.findUnique({ where }))) throw error;
    });
    return;
  }
  await db.discoveryCandidate.updateMany({ where: { id: current.id, workspaceId, status: { in: ["REVIEW", "REJECTED"] } }, data });
}

// A retry has no page of its own, so the query that originally found the post is kept.
const evidenceOf = (doc: SourceDocument, d: PostDecision, at: { keyword: string; page: number }, extra: Record<string, unknown> = {}) => ({ ...d.evidence, query: at.keyword || doc.rawSourceReference.searchQuery, page: at.page || null, ...extra });

/**
 * Turns one page of new posts into exactly one outcome each: qualified (new or already known),
 * needs review (with its most actionable reason), or rejected (with its first failing rule).
 */
export async function processLinkedInDocs(args: { workspaceId: string; searchId: string; criteria: SearchCriteria; strict: boolean; policy: Policy; runStartedAt: Date; now: Date }, docs: SourceDocument[], at: { keyword: string; page: number }): Promise<Outcome[]> {
  const { workspaceId, searchId, criteria, policy, now } = args;
  const terms = relevanceTerms(criteria);
  const decided = docs.map(doc => ({ doc, decision: decidePost(doc, criteria, { terms, now, strict: args.strict }) }));
  const outcomes = new Map<SourceDocument, Outcome>();
  for (const { doc, decision } of decided) if (decision.outcome === "rejected") {
    await storeCandidate(workspaceId, searchId, doc, { status: "REJECTED", reason: decision.reason, classification: decision.kind, evidence: evidenceOf(doc, decision, at), processing: "DONE", suggestedBuyer: null }, policy, now);
    outcomes.set(doc, `rejected:${decision.reason}`);
  }
  const candidates = decided.filter(d => d.decision.outcome === "candidate");
  const attributions = candidates.length ? await attributeBuyers(workspaceId, candidates.map(c => c.doc), criteria) : [];
  for (const [i, { doc, decision }] of candidates.entries()) {
    if (decision.outcome !== "candidate") continue;
    const a = attributions[i];
    const reasons: ReviewReason[] = [...(a.status === "ai_unavailable" ? ["ai_unavailable" as const] : a.status === "unresolved" ? ["buyer_unresolved" as const] : []), ...decision.review];
    const attribution = a.status === "named" ? { method: "named_in_text", quote: a.quote, model: a.model } : null;
    if (reasons.length) {
      const reason = REVIEW_ORDER.find(r => reasons.includes(r))!;
      const suggested = a.status === "named" ? a.name : suggestBuyerFromHeadline(doc.rawSourceReference.authorHeadline);
      await storeCandidate(workspaceId, searchId, doc, { status: "REVIEW", reason, classification: "buying", evidence: evidenceOf(doc, decision, at, { reviewReasons: reasons, attribution, suggestedFrom: suggested ? (a.status === "named" ? "post_text" : "author_headline") : null }), processing: a.status === "ai_unavailable" ? "RETRY_PENDING" : "DONE", suggestedBuyer: suggested }, policy, now);
      outcomes.set(doc, `review:${reason}`);
      continue;
    }
    if (a.status !== "named") continue; // unreachable: an unnamed buyer always has a review reason
    const stored = await ingestOpportunity(workspaceId, searchId, { ...doc, company: { ...doc.company, name: a.name }, rawSourceReference: { ...doc.rawSourceReference, buyerAttribution: attribution, qualification: { kind: "buying", quote: decision.evidence.quote, matchedTerms: decision.evidence.matchedTerms, filters: decision.evidence.filters } } }, criteria, policy, now, { assessed: true });
    if (!stored) {
      // The opportunity this post belongs to was deleted; a search must not bring it back.
      await storeCandidate(workspaceId, searchId, doc, { status: "REJECTED", reason: "previously_removed", classification: "buying", evidence: evidenceOf(doc, decision, at), processing: "DONE", suggestedBuyer: a.name }, policy, now);
      outcomes.set(doc, "rejected:previously_removed");
      continue;
    }
    // A row left in review by an earlier attempt at this page is now settled.
    await db.discoveryCandidate.updateMany({ where: { workspaceId, searchId, sourceUrl: canonicalUrl(doc.sourceUrl), status: { in: ["REVIEW", "REJECTED"] } }, data: { status: "QUALIFIED", opportunityId: stored.id, processing: "DONE" } });
    outcomes.set(doc, stored.discoveredAt < args.runStartedAt ? "qualified_known" : "qualified_new");
  }
  return docs.map(d => outcomes.get(d) ?? "rejected:not_relevant");
}

// ── A run ────────────────────────────────────────────────────────────────────────────────────────
export type RetryRecord = { at: string; attempted: number; outcomes: Record<string, number> };
export type SearchCheckpoint = { jobKey?: string; providers?: Record<string, { outcome?: unknown; run?: RunCheckpoint; retries?: RetryRecord[] }> };
/** Merges one provider's entry into the search checkpoint in SQL, so writers never overwrite each other's keys. */
export async function saveProviderCheckpoint(workspaceId: string, searchId: string, provider: string, entry: Record<string, unknown>) {
  const json = JSON.stringify(entry);
  await db.$executeRaw`UPDATE "OpportunitySearch" SET checkpoint = checkpoint || jsonb_build_object('providers', COALESCE(checkpoint->'providers', '{}'::jsonb) || jsonb_build_object(${provider}::text, COALESCE(checkpoint->'providers'->${provider}::text, '{}'::jsonb) || ${json}::jsonb)) WHERE id = ${searchId}::uuid AND "workspaceId" = ${workspaceId}::uuid`;
}
export const readCheckpoint = (raw: unknown): SearchCheckpoint => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SearchCheckpoint) : {});

export async function runLinkedInDiscovery(args: {
  workspaceId: string; search: { id: string; query: string; options: unknown; checkpoint: unknown };
  criteria: SearchCriteria; config: { maxPostsPerSearch: number }; key: string | undefined; policy: Policy;
  onProgress?: (funnel: Funnel, pagesPlanned: number) => Promise<void>;
}): Promise<{ outcome: LinkedInOutcome; checkpoint: RunCheckpoint }> {
  const { workspaceId, search, criteria } = args;
  const options = resolveOptions(search.options, args.config.maxPostsPerSearch);
  const window = linkedInDateWindow(criteria.dateRange.days);
  const all = readCheckpoint(search.checkpoint);
  const prior = all.providers?.[LINKEDIN_POSTS_PROVIDER]?.run;
  // A resumed run keeps the plan it started with, so page numbers still refer to the same queries.
  let cp: RunCheckpoint = prior?.v === 1 ? { ...prior, stop: undefined, stopDetail: undefined } : freshCheckpoint(effectivePlan(criteria, options, search.query).map(p => p.keyword), Date.now());
  const { queries, ...limits } = options;
  const summary = { ...limits, edited: Boolean(queries) };

  if (!args.key) {
    const outcome: LinkedInOutcome = { status: "ERROR", found: 0, message: "The Apify API token is missing. Nothing was searched or charged.", funnel: funnelOf(cp), stop: "provider_error", dateNote: window.note, options: summary };
    return { outcome, checkpoint: cp };
  }
  const key = args.key;
  const save = async (next: RunCheckpoint) => {
    cp = next;
    await saveProviderCheckpoint(workspaceId, search.id, LINKEDIN_POSTS_PROVIDER, { run: next });
    await args.onProgress?.(funnelOf(next), next.plan.length * options.maxPagesPerQuery);
  };
  const runStartedAt = new Date(cp.startedAt);
  cp = await runLinkedInPlan(cp, options, { days: criteria.dateRange.days, sort: window.sort }, {
    fetchPage: ({ keyword, page, limit, record, resumed, onStarted }) => fetchLinkedInPage(workspaceId, key, actorInput(keyword, page, limit, criteria.dateRange.days), record, resumed, onStarted),
    mapItem: (item, keyword) => mapLinkedInPost(item, LINKEDIN_POSTS_PROVIDER, keyword),
    keyOf: doc => String(doc.rawSourceReference.postKey ?? doc.sourceUrl),
    processDocs: (docs, at) => processLinkedInDocs({ workspaceId, searchId: search.id, criteria, strict: options.strictFilters, policy: args.policy, runStartedAt, now: new Date() }, docs, at),
    save,
    cancelled: async () => Boolean((await db.opportunitySearch.findFirst({ where: { id: search.id, workspaceId }, select: { cancelRequestedAt: true } }))?.cancelRequestedAt),
    now: () => Date.now(),
  });
  const funnel = funnelOf(cp);
  const stopped = cp.stop ?? "results_exhausted";
  const failed = stopped === "rate_limited" || stopped === "provider_error";
  const status: LinkedInOutcome["status"] = stopped === "cancelled" ? "CANCELLED" : failed ? (funnel.pagesCompleted ? "PARTIAL" : "ERROR") : "COMPLETED";
  return { outcome: { status, found: funnel.unique, funnel, stop: stopped, ...(cp.stopDetail ? { stopDetail: cp.stopDetail } : {}), ...(failed ? { message: cp.stopDetail } : {}), dateNote: window.note, options: summary }, checkpoint: cp };
}
