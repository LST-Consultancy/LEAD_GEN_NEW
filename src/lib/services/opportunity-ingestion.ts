import "server-only";
import { PartialDiscoveryError } from "@/lib/providers/opportunity-source";
import { db } from "@/lib/db";
import { extractOpportunity, type SourceDocument } from "@/lib/opportunities/extractor";
import { hash, normalizedCompany, normalizedDomain, opportunityKey, canonicalUrl } from "@/lib/opportunities/identity";
import { criteriaSchema, type SearchCriteria } from "@/lib/opportunities/query-parser";
import { scoreOpportunity } from "@/lib/opportunities/scoring";
import { DEFAULT_WEIGHTS, type ScoringWeights } from "@/lib/scoring";
import { fitEvidenceFor } from "@/lib/opportunities/fit";
import { discoveryProvider, providerConfigSchema } from "@/lib/providers/discovery";
import { decryptCredential } from "@/lib/providers/credentials";
import { z } from "zod";
import { DEFAULT_RULES } from "@/lib/opportunities/scoring";
import type { Prisma } from "@/generated/prisma/client";
import { complete } from "@/lib/ai/complete";
import { BUYER_SYSTEM_PROMPT, buyerPrompt, parseBuyerReply, screenUnattributed, verifyBuyer, type BuyerAttribution, type ScreenReason } from "@/lib/opportunities/buyer";
import { raiseNotification } from "@/lib/services/notify";
import { LINKEDIN_POSTS_PROVIDER } from "@/lib/providers/linkedin-posts";
import { isApifyPlatform, PLATFORMS } from "@/lib/opportunities/apify-platforms";
import { parseDiscoveryOptions } from "@/lib/opportunities/linkedin-plan";
import { apifyTokenFor, searchApifyPlatform, type PlatformOutcome } from "@/lib/providers/apify-discovery";
import { saveBusinessProspects } from "./business-prospects";
import { finishPhraseRun } from "./phrase-watches";
import { readCheckpoint, runLinkedInDiscovery, saveProviderCheckpoint } from "./linkedin-discovery";

/**
 * Stores one source document as an opportunity, deduplicated per workspace.
 * `assessed` means the caller already applied its qualification rules (the LinkedIn path in
 * linkedin-discovery.ts, and a reviewer's confirmation) — so the legacy relevance, requirement and
 * filter checks below are skipped rather than applied a second time with different semantics.
 */
export async function ingestOpportunity(workspaceId: string, searchId: string, doc: SourceDocument, criteria: SearchCriteria, policy: { allowedExport: boolean; retentionDays: number }, now = new Date(), opts: { assessed?: boolean } = {}) {
  const extracted = extractOpportunity(doc, criteria);
  if (!opts.assessed) {
  if (!extracted.relevant) return null;
  if (!doc.company.name.trim()) {
    await db.discoveryCandidate.upsert({ where: { workspaceId_searchId_sourceUrl: { workspaceId, searchId, sourceUrl: canonicalUrl(doc.sourceUrl) } },
      create: { workspaceId, searchId, provider: doc.provider, sourceUrl: canonicalUrl(doc.sourceUrl), title: doc.title, description: doc.description, kind: doc.kind, postedAt: extracted.postedAt ? new Date(extracted.postedAt) : null, document: doc as unknown as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + policy.retentionDays * 86400000) }, update: {} });
    return null;
  }
  if (!extracted.isProjectRequirement) return null;
  if (criteria.opportunityTypes.length && !criteria.opportunityTypes.some(t => extracted.opportunityTypes.includes(t))) return null;
  // Missing firmographics never satisfy an explicit filter.
  if (criteria.employeeMin !== null && (doc.company.employees == null || doc.company.employees < criteria.employeeMin)) return null;
  if (criteria.employeeMax !== null && (doc.company.employees == null || doc.company.employees > criteria.employeeMax)) return null;
  if (criteria.locations.length && !criteria.locations.some(l => `${doc.company.country ?? ""} ${doc.location ?? ""}`.toLowerCase().includes(l.toLowerCase()))) return null;
  if (criteria.industries.length && !criteria.industries.some(i => doc.company.industry?.toLowerCase().includes(i.toLowerCase()))) return null;
  if (extracted.postedAt && (new Date(extracted.postedAt).getTime() < now.getTime() - criteria.dateRange.days * 86400000 || new Date(extracted.postedAt) > now)) return null;
  }
  if (!doc.company.name.trim()) throw new Error("An assessed document must name its buyer before it is stored as an opportunity.");
  const sourceUrl = canonicalUrl(doc.sourceUrl);
  const contentHash = hash({ title: doc.title, description: doc.description, status: doc.status, postedAt: doc.postedAt, closingAt: doc.closingAt, location: doc.location });
  return db.$transaction(async tx => {
    // Serializes resolution and deduplication in this workspace, including worker retries.
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId}::uuid FOR UPDATE`;
    const search = await tx.opportunitySearch.findFirst({ where: { id: searchId, workspaceId } });
    if (!search) throw new Error("Search does not belong to workspace.");
    const prior = await tx.opportunitySource.findUnique({ where: { workspaceId_provider_externalId: { workspaceId, provider: doc.provider, externalId: doc.externalId } } });
    // One LinkedIn post can arrive under several URLs; its activity id is the same under all of them.
    const postKey = typeof doc.rawSourceReference.postKey === "string" ? doc.rawSourceReference.postKey : null;
    const sameUrl = prior ?? await tx.opportunitySource.findFirst({ where: { workspaceId, sourceUrl } })
      ?? (postKey ? await tx.opportunitySource.findFirst({ where: { workspaceId, provider: doc.provider, rawReference: { path: ["postKey"], equals: postKey } } }) : null);
    const sourceOpportunity = sameUrl ? await tx.opportunity.findFirst({ where: { id: sameUrl.opportunityId, workspaceId, deletedAt: null }, include: { company: true } }) : null;
    if (sameUrl && !sourceOpportunity) return null;
    const domain = normalizedDomain(doc.company.domain);
    let company = sourceOpportunity?.company ?? (domain ? await tx.company.findFirst({ where: { workspaceId, domain, deletedAt: null } }) : null);
    if (!company && !domain) {
      const candidates = await tx.company.findMany({ where: { workspaceId, deletedAt: null, domain: null }, take: 500 });
      company = candidates.find(c => normalizedCompany(c.name) === normalizedCompany(doc.company.name)) ?? null;
    }
    if (!company) company = await tx.company.create({ data: { workspaceId, name: doc.company.name, domain, website: domain ? `https://${domain}` : null, country: doc.company.country ?? "Unknown", industry: doc.company.industry, employeeCount: doc.company.employees } });
    const key = opportunityKey(company.id, doc.title, extracted.location);
    let existing = sourceOpportunity ?? await tx.opportunity.findUnique({ where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: key } } });
    if (sameUrl && !existing) return null; // Retained tombstones are not silently resurrected.
    const config = await tx.scoringConfig.findUnique({ where: { workspaceId } });
    const weights: ScoringWeights = config ? { fit: config.fitWeight, intent: config.intentWeight, urgency: config.urgencyWeight, authority: config.authorityWeight, budget: config.budgetWeight, reachability: config.reachabilityWeight, engagement: config.engagementWeight, recency: config.recencyWeight } : DEFAULT_WEIGHTS;
    const icp = await tx.icpProfile.findFirst({ where: { workspaceId, deletedAt: null, isPrimary: true } });
    const fit = fitEvidenceFor(icp, company, weights, now);
    const rules = z.record(z.string(),z.number().min(0).max(100)).safeParse(config?.opportunityRules ?? {});
    const overrides = rules.success ? Object.fromEntries(Object.entries(rules.data).filter(([key])=>key in DEFAULT_RULES)) : {};
    const score = scoreOpportunity(extracted, doc, now, weights, overrides, fit);
    const changed = Boolean(prior && prior.contentHash !== contentHash);
    const data = { activeRank: ["ACTIVE", "OPEN", "NEW"].includes(doc.status ?? "") ? 1 : 0, title: doc.title, service: extracted.service, types: extracted.opportunityTypes, technologies: extracted.technologies, requirements: extracted.requirements, location: extracted.location, postedAt: extracted.postedAt ? new Date(extracted.postedAt) : null, closingAt: extracted.closingAt ? new Date(extracted.closingAt) : null, status: doc.status ?? "UNKNOWN" as const, intentScore: score.intentScore, fitScore: score.fitScore, opportunityScore: score.opportunityScore, scores: { ...score.dimensions, fitEvidence: score.fitEvidence }, lastSeenAt: now, lastCheckedAt: now, ...(changed ? { lastChangedAt: now } : {}) };
    // A weaker additional source must not overwrite stronger evidence.
    const replaceScore = !existing || prior || score.intentScore > existing.intentScore;
    if (existing) existing = await tx.opportunity.update({ where: { id: existing.id, workspaceId }, data: replaceScore ? data : { lastSeenAt: now, lastCheckedAt: now } });
    else existing = await tx.opportunity.create({ data: { workspaceId, companyId: company.id, dedupeKey: key, discoveredAt: now, ...data } });
    if (changed && prior) await tx.opportunityVersion.create({ data: { workspaceId, opportunityId: existing.id, sourceId: prior.id, previousHash: prior.contentHash, currentHash: contentHash, changedAt: now, changedFields: { ...(prior.title !== doc.title ? { title: { before: prior.title, after: doc.title } } : {}), ...(prior.description !== doc.description ? { description: { before: prior.description, after: doc.description } } : {}), sourceStatus: doc.status ?? "UNKNOWN" } } });
    const sourceData = { title: doc.title, description: doc.description, sourceUrl, contentHash, postedAt: data.postedAt, sourceUpdatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null, lastSeenAt: now, allowedExport: policy.allowedExport, rawReference: doc.rawSourceReference as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + policy.retentionDays * 86400000) };
    await tx.opportunitySource.upsert({ where: { workspaceId_provider_externalId: { workspaceId, provider: doc.provider, externalId: doc.externalId } }, create: { workspaceId, opportunityId: existing.id, provider: doc.provider, kind: doc.kind, externalId: doc.externalId, discoveredAt: now, ...sourceData }, update: sourceData });
    if (replaceScore) {
      await tx.opportunityEvidence.deleteMany({ where: { workspaceId, opportunityId: existing.id } });
      await tx.opportunityEvidence.createMany({ data: score.evidence.map(e => ({ workspaceId, opportunityId: existing!.id, ...e, source: doc.provider, sourceUrl, occurredAt: data.postedAt, discoveredAt: prior?.discoveredAt ?? now, rawReference: { excerpt: extracted.evidence[0], hash: contentHash } })) });
    }
    if (score.intentScore >= criteria.minimumIntent) await tx.opportunitySearchResult.upsert({ where: { workspaceId_searchId_opportunityId: { workspaceId, searchId, opportunityId: existing.id } }, create: { workspaceId, searchId, opportunityId: existing.id }, update: {} });
    return { id: existing.id, changed, duplicate: Boolean(prior), discoveredAt: existing.discoveredAt };
  }, { timeout: 20000 });
}
const AI_BATCH = 20;
const withBuyer = (doc: SourceDocument, company: { name: string; domain?: string }, attribution: BuyerAttribution): SourceDocument =>
  ({ ...doc, company: { ...doc.company, ...company }, rawSourceReference: { ...doc.rawSourceReference, buyerAttribution: attribution } });

/**
 * Names the buyer on results that arrive without one, or sets them aside with a counted reason.
 * Rules decide first; the model is asked only about what the rules cannot, and its answer must be
 * a name and quote that literally appear in the text. Nothing unattributed reaches ingestion.
 */
export async function resolveBuyers(workspaceId: string, documents: SourceDocument[], criteria: SearchCriteria) {
  const kept: SourceDocument[] = []; const askAi: SourceDocument[] = [];
  const screened: Partial<Record<ScreenReason, number>> = {};
  const count = (reason: ScreenReason, n = 1) => { screened[reason] = (screened[reason] ?? 0) + n; };
  for (const doc of documents) {
    if (doc.company.name.trim()) { kept.push(doc); continue; }
    const s = screenUnattributed(doc, extractOpportunity(doc, criteria));
    if (s.verdict === "drop") count(s.reason);
    else if (s.verdict === "resolved") kept.push(withBuyer(doc, s.company, s.attribution));
    else askAi.push(doc);
  }
  for (let i = 0; i < askAi.length; i += AI_BATCH) {
    const batch = askAi.slice(i, i + AI_BATCH);
    const reply = await complete({ workspaceId, userId: null }, { feature: "buyer_attribution", system: BUYER_SYSTEM_PROMPT, prompt: buyerPrompt(batch), maxTokens: 6000, timeoutMs: 60_000 });
    if (!reply.ok) { count("ai_unavailable", batch.length); continue; }
    const proposals = new Map(parseBuyerReply(reply.text).map(p => [p.i, p]));
    batch.forEach((doc, j) => {
      const proposal = proposals.get(j);
      const verified = proposal ? verifyBuyer(doc, criteria, proposal) : null;
      if (verified) kept.push(withBuyer(doc, { name: verified.name }, { method: "named_in_text", quote: verified.quote, model: reply.model }));
      else count("no_named_buyer");
    });
  }
  return { kept, screened };
}

/** Only an unfinished search can be failed, so a worker that finishes concurrently wins. Returns whether it changed. */
export async function failOpportunitySearch(workspaceId: string, searchId: string, error: string) {
  const { count } = await db.opportunitySearch.updateMany({ where: { id: searchId, workspaceId, state: { in: ["QUEUED", "RUNNING"] }, finishedAt: null }, data: { state: "FAILED", error, finishedAt: new Date() } });
  return count > 0;
}
export async function discoverOpportunities(workspaceId: string, searchId: string) {
  const search = await db.opportunitySearch.findFirst({ where: { id: searchId, workspaceId } });
  if (!search || ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(search.state)) return { skipped: true };
  const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId: search.createdById, deletedAt: null, workspace: { deletedAt: null } }, include: { role: true } });
  if (!member?.role.permissions.includes("leads.edit")) {
    await db.opportunitySearch.update({ where: { id: searchId, workspaceId }, data: { state: "CANCELLED", error: "The requesting member no longer has discovery permission.", finishedAt: new Date() } });
    return { skipped: true };
  }
  const criteria = criteriaSchema.parse(search.criteria);
  if (search.cancelRequestedAt) {
    await db.opportunitySearch.updateMany({ where: { id: searchId, workspaceId, finishedAt: null }, data: { state: "CANCELLED", finishedAt: new Date(), progress: 100 } });
    return { skipped: true };
  }
  // A redelivered or resumed job keeps its first start time.
  await db.opportunitySearch.update({ where: { id: searchId, workspaceId }, data: { state: "RUNNING", progress: Math.max(10, search.progress), startedAt: search.startedAt ?? new Date(), steps: { queryExpansion: "completed", sourceDiscovery: "running" } } });
  const outcomes: Record<string, { status: string; found: number; message?: string; screened?: Partial<Record<ScreenReason, number>> } & Record<string, unknown>> = {};
  const done = readCheckpoint(search.checkpoint).providers ?? {};
  let found = 0; let success = 0; let cancelled = false;
  for (const [index, provider] of search.providers.entries()) {
    // A provider that finished before a redelivery or resume is not searched (or charged) again.
    const finished = done[provider]?.outcome as (typeof outcomes)[string] | undefined;
    if (finished?.status === "COMPLETED") { outcomes[provider] = finished; found += finished.found; success++; continue; }
    const connection = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
    if (!connection?.enabled || !connection.allowedSearch || !connection.allowedStorage) { outcomes[provider] = { status: "NOT_CONNECTED", found: 0, message: "Connect this provider and confirm search/storage rights." }; continue; }
    const sync = await db.providerSync.create({ data: { workspaceId, provider, operation: "search", jobId: searchId, state: "RUNNING" } });
    if (provider === LINKEDIN_POSTS_PROVIDER) {
      try {
        const config = providerConfigSchema.parse(connection.config);
        const { outcome } = await runLinkedInDiscovery({ workspaceId, search, criteria, config, key: connection.encryptedCredentials ? decryptCredential(connection.encryptedCredentials, workspaceId, provider) : undefined, policy: connection,
          onProgress: async (funnel, pagesPlanned) => { await db.opportunitySearch.update({ where: { id: searchId, workspaceId }, data: { progress: Math.min(90, 10 + Math.round(((index + Math.min(1, funnel.pagesAttempted / Math.max(1, pagesPlanned))) / search.providers.length) * 80)), providerResults: { ...outcomes, [provider]: { status: "RUNNING", found: funnel.unique, funnel } } as Prisma.InputJsonValue } }); } });
        outcomes[provider] = outcome;
        await saveProviderCheckpoint(workspaceId, searchId, provider, { outcome });
        if (outcome.status === "COMPLETED") success++;
        if (outcome.status === "CANCELLED") cancelled = true;
        found += outcome.found;
        const f = outcome.funnel;
        await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: outcome.status === "ERROR" ? "FAILED" : outcome.status, recordsFound: f.unique, recordsCreated: f.qualifiedNew, recordsUpdated: f.qualifiedKnown, duplicates: f.duplicates, credits: f.usageUsd, error: outcome.message ?? null, finishedAt: new Date() } });
      } catch {
        const message = "LinkedIn discovery failed unexpectedly. Posts already processed were kept; resume the search to continue.";
        outcomes[provider] = { status: "ERROR", found: 0, message };
        await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "FAILED", error: message, finishedAt: new Date() } });
      }
      if (cancelled) break;
      continue;
    }
    if (isApifyPlatform(provider)) {
      try {
        const key = await apifyTokenFor(workspaceId, provider);
        if (!key) throw new PartialDiscoveryError("No Apify token is saved. Add one on this connection or on LinkedIn posts. Nothing was run or charged.", []);
        let result: PlatformOutcome; let partialMessage: string | null = null;
        try { result = await searchApifyPlatform({ workspaceId, searchId, provider, rawConfig: connection.config, criteria, key, routing: parseDiscoveryOptions(search.options).routing, shouldCancel: async () => Boolean((await db.opportunitySearch.findFirst({ where: { id: searchId, workspaceId }, select: { cancelRequestedAt: true } }))?.cancelRequestedAt) }); }
        catch (error) { const o = (error as { outcome?: PlatformOutcome }).outcome; if (!o) throw error; result = o; partialMessage = error instanceof Error ? error.message : "Part of this platform's search failed."; }
        let created = 0; let duplicates = 0; let updated = 0;
        const { kept, screened } = await resolveBuyers(workspaceId, result.documents, criteria);
        for (const document of kept) {
          const r = await ingestOpportunity(workspaceId, searchId, document, criteria, connection);
          if (r?.changed) updated++; else if (r?.duplicate) duplicates++; else if (r) created++;
        }
        const prospects = result.places.length ? await saveBusinessProspects(workspaceId, searchId, provider, result.places) : null;
        const partial = Boolean(partialMessage);
        const nothingRan = !result.runs && !partial;
        found += result.documents.length + result.places.length; if (!partial && !nothingRan) success++;
        outcomes[provider] = { status: partial ? "PARTIAL" : nothingRan ? "SKIPPED" : "COMPLETED", found: result.documents.length + result.places.length, screened,
          platformFunnel: { returned: result.returned, outsideWindow: result.outsideWindow, unreadable: result.unreadable, repeated: result.repeated, assessed: result.documents.length, created, duplicates, updated, prospectsCreated: prospects?.created ?? 0, prospectsKnown: prospects?.known ?? 0, usageUsd: Math.round(result.usageUsd * 1000) / 1000, runs: result.runs },
          resultClass: PLATFORMS[provider].resultClass,
          ...(partialMessage || result.notes.length ? { message: [partialMessage, ...result.notes].filter(Boolean).join(" ") } : {}) };
        await saveProviderCheckpoint(workspaceId, searchId, provider, { outcome: outcomes[provider] });
        await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: partial ? "PARTIAL" : "COMPLETED", recordsFound: result.returned, recordsCreated: created + (prospects?.created ?? 0), recordsUpdated: updated, duplicates, credits: result.usageUsd, error: partialMessage, finishedAt: new Date() } });
      } catch (error) {
        const message = error instanceof PartialDiscoveryError ? error.message : "This platform's discovery failed unexpectedly. Results already saved are kept; resume the search to continue.";
        outcomes[provider] = { status: "ERROR", found: 0, message };
        await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "FAILED", error: message, finishedAt: new Date() } });
      }
      await db.opportunitySearch.update({ where: { id: searchId, workspaceId }, data: { progress: Math.min(90, 10 + Math.round(Object.keys(outcomes).length / search.providers.length * 80)), providerResults: outcomes as Prisma.InputJsonValue, found } });
      continue;
    }
    try {
      const adapter = discoveryProvider(workspaceId, provider, providerConfigSchema.parse(connection.config), connection.encryptedCredentials ? decryptCredential(connection.encryptedCredentials, workspaceId, provider) : undefined);
      let documents: SourceDocument[]; let partial = false;
      try { documents = await adapter.search(criteria); }
      catch (error) { if (!(error instanceof PartialDiscoveryError) || !error.documents.length) throw error; documents = error.documents; partial = true; }
      let created = 0; let duplicates = 0; let updated = 0;
      const { kept, screened } = await resolveBuyers(workspaceId, documents, criteria);
      for (const document of kept) {
        const result = await ingestOpportunity(workspaceId, searchId, document, criteria, connection);
        if (result?.changed) updated++; else if (result?.duplicate) duplicates++; else if (result) created++;
      }
      found += documents.length; if (!partial) success++;
      outcomes[provider] = { status: partial ? "PARTIAL" : "COMPLETED", found: documents.length, screened, ...(partial ? { message: "Some requests failed or reached quota. Retrieved matches were retained; narrow the search or retry later." } : {}) };
      await saveProviderCheckpoint(workspaceId, searchId, provider, { outcome: outcomes[provider] });
      await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: partial ? "PARTIAL" : "COMPLETED", recordsFound: documents.length, recordsCreated: created, recordsUpdated: updated, duplicates, finishedAt: new Date() } });
    } catch {
      const message = "Provider discovery failed. Check credentials, permissions, response format and quota. Partial records may have been retained.";
      outcomes[provider] = { status: "ERROR", found: 0, message };
      await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "FAILED", error: message, finishedAt: new Date() } });
    }
    await db.opportunitySearch.update({ where: { id: searchId, workspaceId }, data: { progress: Math.min(90, 10 + Math.round(Object.keys(outcomes).length / search.providers.length * 80)), providerResults: outcomes as Prisma.InputJsonValue, found } });
  }
  const qualified = await db.opportunitySearchResult.count({ where: { workspaceId, searchId } });
  const state = cancelled ? "CANCELLED" : success === search.providers.length ? "COMPLETED" : success || found || qualified ? "PARTIAL" : "FAILED";
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "OpportunitySearch" WHERE id = ${searchId}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`;
    const current = await tx.opportunitySearch.findFirst({ where: { id: searchId, workspaceId } });
    if (current?.finishedAt) return;
    await tx.opportunitySearch.update({ where: { id: searchId, workspaceId }, data: { state, progress: 100, found, qualified, providerResults: outcomes as Prisma.InputJsonValue, finishedAt: new Date(), error: state === "FAILED" ? "Search could not complete. Inspect source status." : null, steps: { queryExpansion: "completed", sourceDiscovery: state.toLowerCase(), deduplication: "completed", companyResolution: "completed", scoring: "completed", enrichment: "not_requested" } } });
    await finishPhraseRun(tx, search, state, found);
    if (search.savedSearchId && qualified) {
      const currentResults = await tx.opportunitySearchResult.findMany({ where: { workspaceId, searchId }, select: { opportunityId: true } });
      const previousResults = await tx.opportunitySearchResult.findMany({ where: { workspaceId, opportunityId: { in: currentResults.map(r => r.opportunityId) }, search: { workspaceId, savedSearchId: search.savedSearchId, id: { not: searchId }, finishedAt: { not: null } } }, select: { opportunityId: true } });
      const known = new Set(previousResults.map(r => r.opportunityId));
      const newCount = currentResults.filter(r => !known.has(r.opportunityId)).length;
      if (newCount) {
        await raiseNotification({ data: { workspaceId, userId: search.createdById, kind: "LEAD_SIGNAL", title: "New opportunity matches", body: `${newCount} new matching opportunities. Review source evidence before outreach.`, href: `/opportunities?searchId=${searchId}` } }, tx);
        await tx.savedSearch.updateMany({ where: { id: search.savedSearchId, workspaceId }, data: { lastAlertAt: new Date() } });
      }
    }
  });
  // Optional and off by default; bounded by its own per-day cap. Never allowed to fail discovery.
  if (qualified && state !== "CANCELLED") await import("./enrichment").then(m => m.autoEnrichAfterDiscovery(workspaceId, searchId)).catch(() => null);
  return { state, found, qualified };
}
