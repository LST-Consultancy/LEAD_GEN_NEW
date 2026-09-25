import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { mutate, MutationError, loadScoped } from "./mutate";
import { getOpportunity, opportunityPeople } from "./opportunities";
import { toPlain } from "@/lib/serialize";
import { enqueue, getJobOutcome } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { isQueueConfigured } from "@/lib/queue/connection";
import { judgeSearchJob } from "@/lib/opportunities/search-status";
import { estimate, parseEnrichmentConfig, PRICE_NOTE, type EnrichmentConfig } from "@/lib/enrichment/config";
import { freshStages, PLAN, RUN_KINDS, TERMINAL, type RunKind, type Stage } from "@/lib/enrichment/stages";
import type { CompanyProfile } from "@/lib/enrichment/identity";
import { applyCompanyFields, enrichmentConnection, ENRICHMENT_PROVIDER, type EmailDomain } from "./enrichment-runner";

const ACTIVE = ["QUEUED", "RUNNING"];
const permissionFor = (kind: RunKind) => (kind === "research" ? PERMISSIONS.LEADS_EDIT : PERMISSIONS.LEADS_REVEAL);

/** An upper bound for the run before it starts, from the Actors' listed prices. Shown beside the button; never charged as such. */
export function estimateRun(kind: RunKind, cfg: EnrichmentConfig) {
  const parts: Record<string, number> = {};
  for (const stage of PLAN[kind]) {
    if (stage === "resolve") parts.resolve = estimate.search(2) + estimate.company(3);
    if (stage === "details") parts.details = estimate.company(1);
    if (stage === "people") parts.people = estimate.employees(cfg.peoplePerCompany * 2, cfg.employeeMode);
    if (stage === "emails") parts.emails = estimate.website(cfg.websitePages);
    if (stage === "verify") parts.verify = estimate.verify(cfg.emailChecksPerRun, cfg.verifierFormat);
  }
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, total: Math.round(Math.min(total, cfg.maxUsdPerRun) * 1000) / 1000, uncapped: Math.round(total * 1000) / 1000, budget: cfg.maxUsdPerRun, note: PRICE_NOTE };
}

async function queueRun(workspaceId: string, runId: string) {
  const jobKey = `enrich-${runId}-${Date.now()}`;
  const queued = await enqueue(JOB.OPPORTUNITY_ENRICHMENT, { workspaceId, runId }, { dedupeKey: jobKey, dedupeWindowSec: 0 });
  if (!queued.queued) { await db.enrichmentRun.update({ where: { id: runId }, data: { state: "FAILED", error: `${queued.detail} Nothing was run or charged.`, finishedAt: new Date() } }); throw new MutationError(`${queued.detail} Nothing was run or charged.`, "queue_unavailable", 503); }
  await db.enrichmentRun.update({ where: { id: runId }, data: { jobKey } });
}

const startSchema = z.object({ kind: z.enum(RUN_KINDS), refresh: z.boolean().default(false) });
/**
 * Starts one button's run. A second press while a run for this opportunity is active returns that
 * run instead of starting (and paying for) another. Configuration problems and an unavailable queue
 * are refused before anything is created, with the fix in the message.
 */
export async function startEnrichment(ctx: AuthContext, opportunityId: string, raw: unknown, opts: { trigger?: "manual" | "auto" } = {}) {
  const input = startSchema.parse(raw ?? {});
  assertPermission(ctx, permissionFor(input.kind));
  const opportunity = await getOpportunity(ctx, opportunityId);
  const conn = await enrichmentConnection(ctx.workspaceId);
  if ("missing" in conn) throw new MutationError(conn.missing, "not_connected", 422);
  if (!isQueueConfigured()) throw new MutationError("Enrichment runs in the background and needs Redis and the worker. Nothing was run or charged.", "queue_unavailable", 503);
  if (input.kind === "verify") {
    const addresses = await db.contactMethod.count({ where: { workspaceId: ctx.workspaceId, kind: { in: ["WORK_EMAIL", "PERSONAL_EMAIL"] }, value: { not: null }, person: { employments: { some: { workspaceId: ctx.workspaceId, companyId: opportunity.companyId, isCurrent: true } } } } })
      + await db.companyContactPoint.count({ where: { workspaceId: ctx.workspaceId, companyId: opportunity.companyId, kind: "EMAIL" } });
    if (!addresses) throw new MutationError("No email addresses have been found for this company yet, so there is nothing to check. Use Find emails first. Nothing was checked or charged.", "no_addresses", 422);
  }
  return mutate(ctx, permissionFor(input.kind), async () => {
    const active = await db.enrichmentRun.findFirst({ where: { workspaceId: ctx.workspaceId, opportunityId, state: { in: ACTIVE } }, orderBy: { createdAt: "desc" } });
    if (active) return { result: { run: toPlain(active), reused: true, note: "A run for this opportunity is already in progress; showing it instead of starting another." as string | null }, log: { action: "opportunity.enrichment_reused", objectType: "EnrichmentRun", objectId: active.id } };
    const est = estimateRun(input.kind, conn.config);
    const run = await db.enrichmentRun.create({ data: { workspaceId: ctx.workspaceId, opportunityId, companyId: opportunity.companyId, requestedById: ctx.userId, kind: input.kind, trigger: opts.trigger ?? "manual", refresh: input.refresh, stages: freshStages(input.kind) as unknown as Prisma.InputJsonValue, budgetUsd: conn.config.maxUsdPerRun, estimatedUsd: est.total } });
    await queueRun(ctx.workspaceId, run.id);
    return { result: { run: toPlain(run), reused: false, note: null as string | null }, log: { action: "opportunity.enrichment_started", objectType: "EnrichmentRun", objectId: run.id, after: { kind: input.kind, refresh: input.refresh, estimatedUsd: est.total } } };
  });
}

/** The run as the screen shows it, with a notice when no worker is picking it up. */
export async function getEnrichmentRun(ctx: AuthContext, runId: string) {
  z.string().uuid().parse(runId);
  const run = await loadScoped(() => db.enrichmentRun.findFirst({ where: { id: runId, workspaceId: ctx.workspaceId } }), "That enrichment run");
  await getOpportunity(ctx, run.opportunityId); // same visibility as the opportunity
  let notice: string | null = null;
  if (ACTIVE.includes(run.state) && run.jobKey) {
    const verdict = judgeSearchJob(await getJobOutcome(run.jobKey), run.createdAt, new Date());
    if (verdict && "fail" in verdict) {
      await db.enrichmentRun.updateMany({ where: { id: run.id, state: { in: ACTIVE } }, data: { state: "FAILED", error: verdict.fail.replace("search", "run"), finishedAt: new Date() } });
      return getEnrichmentRun(ctx, runId);
    }
    if (verdict) notice = verdict.notice.replace("this search has not started", "this has not started");
  }
  const ledger = await db.apifyRun.findMany({ where: { workspaceId: ctx.workspaceId, enrichmentRunId: run.id }, select: { stageKey: true, actorId: true, status: true, itemCount: true, usageUsd: true, estimatedUsd: true } });
  return toPlain({ ...run, notice, apifyRuns: ledger, terminal: TERMINAL.includes(run.state as never) });
}

/** Everything the enrichment panel shows for one opportunity, refetched when a run finishes. */
export async function getOpportunityEnrichment(ctx: AuthContext, opportunityId: string) {
  const opportunity = await getOpportunity(ctx, opportunityId);
  const [company, people, contactPoints, runs, conn] = await Promise.all([
    db.company.findFirstOrThrow({ where: { id: opportunity.companyId, workspaceId: ctx.workspaceId } }),
    opportunityPeople(ctx, opportunity.companyId),
    db.companyContactPoint.findMany({ where: { workspaceId: ctx.workspaceId, companyId: opportunity.companyId }, orderBy: { createdAt: "asc" } }),
    db.enrichmentRun.findMany({ where: { workspaceId: ctx.workspaceId, opportunityId }, orderBy: { createdAt: "desc" }, take: 5 }),
    enrichmentConnection(ctx.workspaceId),
  ]);
  const cfg = "missing" in conn ? parseEnrichmentConfig({}) : conn.config;
  const suppressed = new Set((await db.suppression.findMany({ where: { workspaceId: ctx.workspaceId, value: { in: contactPoints.map(p => p.value), mode: "insensitive" } }, select: { value: true } })).map(s => s.value.toLowerCase()));
  return toPlain({
    company: { id: company.id, name: company.name, domain: company.domain, website: company.website, linkedinUrl: company.linkedinUrl, description: company.description, industry: company.industry, city: company.city, state: company.state, country: company.country, employeeCount: company.employeeCount, employeeBand: company.employeeBand, enrichment: company.enrichment },
    people: people.map(e => ({ employmentId: e.id, personId: e.personId, name: e.person.fullName, title: e.title, linkedinUrl: e.person.linkedinUrl, city: e.person.city, country: e.person.country, association: e.association, isDecisionMaker: e.isDecisionMaker, evidence: e.evidence, source: e.source, contacts: e.person.contactMethods.map(m => ({ id: m.id, kind: m.kind, value: m.value, verificationResult: m.verificationResult, verifiedAt: m.verifiedAt, source: m.source, provenance: m.provenance })) })),
    contactPoints: contactPoints.filter(p => !suppressed.has(p.value.toLowerCase()) && ((p.evidence ?? {}) as { review?: { decision?: string } }).review?.decision !== "attached").map(p => ({ id: p.id, kind: p.kind, value: p.value, isGeneric: p.isGeneric, domainStatus: p.domainStatus, possiblePersonId: p.possiblePersonId, source: p.source, evidence: p.evidence, verificationResult: p.verificationResult, verifiedAt: p.verifiedAt })),
    runs,
    setup: "missing" in conn ? { ready: false, message: conn.missing } : { ready: true, message: null },
    estimates: Object.fromEntries(RUN_KINDS.map(k => [k, estimateRun(k, cfg)])),
    limits: { peoplePerCompany: cfg.peoplePerCompany, websitePages: cfg.websitePages, emailChecksPerRun: cfg.emailChecksPerRun, maxUsdPerRun: cfg.maxUsdPerRun, freshDays: cfg.freshDays, verifyCacheDays: cfg.verifyCacheDays },
  });
}

/**
 * A person chooses which company the buyer is. That choice is recorded as confirmed — so no later
 * automated result can overwrite it — and the steps that were waiting on it continue.
 */
export async function selectEnrichmentCompany(ctx: AuthContext, runId: string, raw: unknown) {
  z.string().uuid().parse(runId);
  const { index, fallbackIndex, none } = z.object({ index: z.number().int().min(0).max(9).optional(), fallbackIndex: z.number().int().min(0).max(9).optional(), none: z.boolean().optional() }).parse(raw ?? {});
  const run = await loadScoped(() => db.enrichmentRun.findFirst({ where: { id: runId, workspaceId: ctx.workspaceId } }), "That enrichment run");
  await getOpportunity(ctx, run.opportunityId);
  if (!isQueueConfigured()) throw new MutationError("Continuing needs Redis and the worker. Nothing was changed.", "queue_unavailable", 503);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    if (run.state !== "NEEDS_SELECTION") throw new MutationError("This run is not waiting for a company choice any more. Refresh to see its current state.", "conflict", 409);
    const result = (run.result ?? {}) as { candidates?: { profile: CompanyProfile; score: number }[]; fallbackCandidates?: { name: string; domain: string | null; linkedinUrl: string | null; source: string }[] };
    const stages = (run.stages as unknown as Stage[]).map(s => ({ ...s }));
    const resolve = stages.find(s => s.key === "resolve")!;
    if (none) {
      Object.assign(resolve, { status: "no_matches", reason: "You said none of the candidates is this company. Nothing was saved." });
      stages.forEach(s => { if (s.status === "blocked") Object.assign(s, { status: "blocked", reason: "Not run: the company was not identified." }); });
      await db.enrichmentRun.update({ where: { id: run.id }, data: { stages: stages as unknown as Prisma.InputJsonValue, state: "NO_MATCHES", finishedAt: new Date() } });
      return { result: { state: "NO_MATCHES" }, log: { action: "opportunity.company_rejected", objectType: "EnrichmentRun", objectId: run.id } };
    }
    // A name match from Hunter or Apollo (no LinkedIn profile): the person's choice is the evidence.
    const fb = fallbackIndex !== undefined ? result.fallbackCandidates?.[fallbackIndex] : undefined;
    if (fallbackIndex !== undefined) {
      if (!fb?.domain) throw new MutationError("Choose one of the listed companies.", "invalid_choice", 422);
      const saved = await applyCompanyFields(ctx.workspaceId, run.companyId, { domain: fb.domain, website: `https://${fb.domain}`, ...(fb.linkedinUrl ? { linkedinUrl: fb.linkedinUrl } : {}) }, { source: "user_selection", runId: run.id, confidence: 100, confirmedBy: ctx.userId });
      Object.assign(resolve, { status: "done", reason: `You chose ${fb.name} (${fb.domain}), found by ${fb.source.split(":")[0]}.`, counts: { identityFieldsUpdated: saved.updated.length } });
      stages.forEach(s => { if (s.status === "blocked") Object.assign(s, { status: "pending", reason: undefined }); });
      await db.enrichmentRun.update({ where: { id: run.id }, data: { stages: stages as unknown as Prisma.InputJsonValue, state: "QUEUED", finishedAt: null } });
      await queueRun(ctx.workspaceId, run.id);
      return { result: { state: "QUEUED" }, log: { action: "opportunity.company_selected", objectType: "EnrichmentRun", objectId: run.id, after: { domain: fb.domain, source: fb.source } } };
    }
    const chosen = index !== undefined ? result.candidates?.[index] : undefined;
    if (!chosen) throw new MutationError("Choose one of the listed companies.", "invalid_choice", 422);
    const saved = await applyCompanyFields(ctx.workspaceId, run.companyId, { linkedinUrl: chosen.profile.linkedinUrl, domain: chosen.profile.domain }, { source: "user_selection", runId: run.id, confidence: 100, confirmedBy: ctx.userId });
    Object.assign(resolve, { status: "done", reason: `You chose ${chosen.profile.name}.`, counts: { identityFieldsUpdated: saved.updated.length } });
    stages.forEach(s => { if (s.status === "blocked") Object.assign(s, { status: "pending", reason: undefined }); });
    await db.enrichmentRun.update({ where: { id: run.id }, data: { stages: stages as unknown as Prisma.InputJsonValue, state: "QUEUED", finishedAt: null, result: { ...result, resolvedProfile: chosen.profile, resolvedScore: { score: 100, reasons: ["Chosen by a person."], conflicts: [] } } as Prisma.InputJsonValue } });
    await queueRun(ctx.workspaceId, run.id);
    return { result: { state: "QUEUED" }, log: { action: "opportunity.company_selected", objectType: "EnrichmentRun", objectId: run.id, after: { linkedinUrl: chosen.profile.linkedinUrl, domain: chosen.profile.domain } } };
  });
}

/** Retries only the steps that failed, in the same run, so recorded Apify runs are re-read, not bought again. */
export async function retryEnrichment(ctx: AuthContext, runId: string) {
  z.string().uuid().parse(runId);
  const run = await loadScoped(() => db.enrichmentRun.findFirst({ where: { id: runId, workspaceId: ctx.workspaceId } }), "That enrichment run");
  await getOpportunity(ctx, run.opportunityId);
  assertPermission(ctx, permissionFor(run.kind as RunKind));
  if (!isQueueConfigured()) throw new MutationError("Retrying needs Redis and the worker. Nothing was run or charged.", "queue_unavailable", 503);
  return mutate(ctx, permissionFor(run.kind as RunKind), async () => {
    const stages = (run.stages as unknown as Stage[]).map(s => ({ ...s }));
    if (!["PARTIAL", "FAILED", "CANCELLED"].includes(run.state) || !stages.some(s => ["failed", "cancelled"].includes(s.status))) throw new MutationError("Nothing in this run failed, so there is nothing to retry.", "nothing_to_retry", 409);
    stages.forEach(s => { if (["failed", "cancelled"].includes(s.status)) Object.assign(s, { status: "pending", reason: undefined }); });
    const { count } = await db.enrichmentRun.updateMany({ where: { id: run.id, workspaceId: ctx.workspaceId, state: run.state }, data: { stages: stages as unknown as Prisma.InputJsonValue, state: "QUEUED", error: null, finishedAt: null, cancelRequestedAt: null } });
    if (!count) throw new MutationError("This run changed while you were looking at it. Refresh and try again.", "conflict", 409);
    await queueRun(ctx.workspaceId, run.id);
    return { result: { state: "QUEUED" }, log: { action: "opportunity.enrichment_retried", objectType: "EnrichmentRun", objectId: run.id } };
  });
}

/** Stops before the next step; a running Apify run is asked to abort. What was saved stays. */
export async function cancelEnrichment(ctx: AuthContext, runId: string) {
  z.string().uuid().parse(runId);
  const run = await loadScoped(() => db.enrichmentRun.findFirst({ where: { id: runId, workspaceId: ctx.workspaceId } }), "That enrichment run");
  await getOpportunity(ctx, run.opportunityId);
  return mutate(ctx, permissionFor(run.kind as RunKind), async () => {
    if (!ACTIVE.includes(run.state)) return { result: { state: run.state }, log: { action: "opportunity.enrichment_cancelled", objectType: "EnrichmentRun", objectId: run.id } };
    const now = new Date();
    const { count } = await db.enrichmentRun.updateMany({ where: { id: run.id, state: "QUEUED" }, data: { state: "CANCELLED", cancelRequestedAt: now, finishedAt: now, stages: (run.stages as unknown as Stage[]).map(s => (s.status === "pending" ? { ...s, status: "cancelled" } : s)) as unknown as Prisma.InputJsonValue } });
    if (!count) await db.enrichmentRun.update({ where: { id: run.id }, data: { cancelRequestedAt: now } });
    return { result: { state: count ? "CANCELLED" : "RUNNING" }, log: { action: "opportunity.enrichment_cancelled", objectType: "EnrichmentRun", objectId: run.id } };
  });
}

/**
 * Optional, off by default: after a discovery run, enrich its newly qualified opportunities above the
 * intent threshold, at most `maxPerDay` a day. Raw scraped posts and review candidates are never
 * enriched automatically. A failure here never fails the discovery run.
 */
export async function autoEnrichAfterDiscovery(workspaceId: string, searchId: string) {
  const row = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: ENRICHMENT_PROVIDER } } });
  const cfg = parseEnrichmentConfig(row?.config);
  if (!row?.enabled || !cfg.autoEnrich.enabled) return { queued: 0, reason: "off" };
  const search = await db.opportunitySearch.findFirst({ where: { id: searchId, workspaceId } });
  if (!search?.startedAt) return { queued: 0, reason: "not_started" };
  const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId: search.createdById, deletedAt: null }, include: { role: true, user: true, workspace: true } });
  if (!member?.role.permissions.includes(PERMISSIONS.LEADS_REVEAL)) return { queued: 0, reason: "no_permission" };
  const since = new Date(Date.now() - 86400000);
  const today = await db.enrichmentRun.count({ where: { workspaceId, trigger: "auto", createdAt: { gte: since } } });
  const room = cfg.autoEnrich.maxPerDay - today;
  if (room <= 0) return { queued: 0, reason: "daily_cap" };
  const fresh = await db.opportunity.findMany({ where: { workspaceId, deletedAt: null, intentScore: { gte: cfg.autoEnrich.minIntent }, discoveredAt: { gte: search.startedAt }, results: { some: { workspaceId, searchId } } }, select: { id: true }, orderBy: { intentScore: "desc" }, take: room });
  const ctx: AuthContext = { userId: member.userId, sessionId: "worker", user: member.user, workspaceId, workspace: member.workspace, memberId: member.id, roleKey: member.role.key, roleName: member.role.name, permissions: member.role.permissions, workspaces: [] };
  let queued = 0;
  for (const o of fresh) {
    if (await db.enrichmentRun.findFirst({ where: { workspaceId, opportunityId: o.id } })) continue;
    try { await startEnrichment(ctx, o.id, { kind: "enrich" }, { trigger: "auto" }); queued++; } catch { /* reported on the run or skipped; discovery is unaffected */ }
  }
  return { queued, reason: null };
}

const domainDecisionSchema = z.object({ domain: z.string().trim().toLowerCase().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), decision: z.enum(["accept", "reject"]) });
/**
 * A person decides whether a domain seen in evidence is this company's email domain. Accepting
 * turns its addresses from "review" into the company's own (the next Find emails run may then give
 * a named address to its person); rejecting keeps them as evidence but never checks or assigns
 * them. Either way the decision is recorded and later runs do not re-open it.
 */
export async function decideEmailDomain(ctx: AuthContext, opportunityId: string, raw: unknown) {
  const input = domainDecisionSchema.parse(raw ?? {});
  const opportunity = await getOpportunity(ctx, opportunityId);
  const company = await loadScoped(() => db.company.findFirst({ where: { id: opportunity.companyId, workspaceId: ctx.workspaceId } }), "That company");
  const e = (company.enrichment ?? {}) as { emailDomains?: EmailDomain[] } & Record<string, unknown>;
  const list = e.emailDomains ?? [];
  const prior = list.find(d => d.domain === input.domain);
  if (!prior) throw new MutationError("That domain has not been seen for this company, so there is nothing to decide.", "not_found", 404);
  const status = input.decision === "accept" ? "alias" : "rejected";
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const next = list.map(d => (d.domain === input.domain ? { ...d, status, basis: input.decision === "accept" ? "Confirmed as the company's email domain by a person." : "Rejected as the company's email domain by a person.", at: new Date().toISOString(), decidedBy: ctx.userId } as EmailDomain : d));
    await db.company.update({ where: { id: company.id }, data: { enrichment: { ...e, emailDomains: next } as Prisma.InputJsonValue } });
    const { count } = await db.companyContactPoint.updateMany({ where: { workspaceId: ctx.workspaceId, companyId: company.id, kind: "EMAIL", value: { endsWith: `@${input.domain}`, mode: "insensitive" } }, data: { domainStatus: status } });
    return {
      result: { domain: input.domain, status, addresses: count },
      log: { action: "company.email_domain_decided", objectType: "Company", objectId: company.id, before: { domain: input.domain, status: prior.status }, after: { domain: input.domain, status } },
    };
  });
}

const pointDecisionSchema = z.object({ pointId: z.string().uuid(), decision: z.enum(["attach", "dismiss"]) });
/**
 * A person settles an address a provider returned for someone whose identity was not confirmed:
 * "attach" gives it to the possible owner, recorded as confirmed by that person; "dismiss" keeps it
 * on the company with no owner. Either way the evidence stays, and the decision is final.
 */
export async function decideContactPoint(ctx: AuthContext, opportunityId: string, raw: unknown) {
  const input = pointDecisionSchema.parse(raw ?? {});
  const opportunity = await getOpportunity(ctx, opportunityId);
  const point = await loadScoped(() => db.companyContactPoint.findFirst({ where: { id: input.pointId, workspaceId: ctx.workspaceId, companyId: opportunity.companyId, kind: "EMAIL" } }), "That address");
  const evidence = (point.evidence ?? {}) as Record<string, unknown> & { review?: Record<string, unknown> };
  if (!evidence.review) throw new MutationError("That address is not waiting for a decision.", "not_reviewable", 409);
  if (evidence.review.decision) throw new MutationError("Someone has already decided about this address. Refresh to see it.", "conflict", 409);
  const personId = point.possiblePersonId;
  if (input.decision === "attach") {
    if (!personId || point.isGeneric) throw new MutationError("This address does not name a person, so it stays on the company.", "not_attachable", 422);
    if (!["matched", "alias"].includes(point.domainStatus)) throw new MutationError("This address is not on the company's email domain. Decide the domain first.", "domain_undecided", 422);
    const blocked = await db.suppression.count({ where: { workspaceId: ctx.workspaceId, value: { equals: point.value, mode: "insensitive" } } });
    if (blocked) throw new MutationError("This address is on the do-not-contact list, so it cannot be given to a person.", "suppressed", 422);
    await loadScoped(() => db.employment.findFirst({ where: { workspaceId: ctx.workspaceId, companyId: opportunity.companyId, personId } }), "That person");
  }
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const at = new Date().toISOString();
    if (input.decision === "attach") {
      const exists = await db.contactMethod.findFirst({ where: { workspaceId: ctx.workspaceId, personId: personId!, value: { equals: point.value, mode: "insensitive" } } });
      if (!exists) await db.contactMethod.create({ data: { workspaceId: ctx.workspaceId, personId: personId!, kind: "WORK_EMAIL", value: point.value, maskedValue: point.value.replace(/^(.).+@/, "$1***@"), isLocked: false, status: "UNVERIFIED", confidence: 70, source: point.source, verificationResult: point.verificationResult, verifiedAt: point.verifiedAt, provenance: { discovery: { kind: "provider", source: point.source, retrievedAt: evidence.retrievedAt ?? null }, ownership: { basis: "confirmed_by_person", userId: ctx.userId, at }, identity: { level: "confirmed_by_person", provider: evidence.review?.identity ?? null } } as Prisma.InputJsonValue } });
    }
    await db.companyContactPoint.update({ where: { id: point.id }, data: { ...(input.decision === "dismiss" ? { possiblePersonId: null } : {}), evidence: { ...evidence, review: { ...evidence.review, decision: input.decision === "attach" ? "attached" : "dismissed", decidedBy: ctx.userId, decidedAt: at } } as Prisma.InputJsonValue } });
    return {
      result: { decision: input.decision },
      log: { action: "company.contact_point_decided", objectType: "CompanyContactPoint", objectId: point.id, before: { possiblePersonId: personId }, after: { decision: input.decision, personId: input.decision === "attach" ? personId : null } },
    };
  });
}
