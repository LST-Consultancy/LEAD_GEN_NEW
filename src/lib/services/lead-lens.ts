import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped } from "./mutate";
import { decryptCredential } from "@/lib/providers/credentials";
import { apifyTokenFor } from "@/lib/providers/apify-discovery";
import { runLedgeredActor } from "@/lib/providers/apify-ledger";
import { signalHireProvider } from "@/lib/providers/signalhire";
import { apolloProvider } from "@/lib/providers/apollo";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { PageFetchError } from "@/lib/opportunities/linkedin-run";
import { parseEnrichmentConfig, estimate } from "@/lib/enrichment/config";
import { providerState, FALLBACK_LABEL, type FallbackProvider } from "@/lib/enrichment/fallback";
import { classifyTarget, fromApollo, fromSignalHire, type LookedUpPerson } from "@/lib/enrichment/lookup";
import { companyDomain, linkedInCompanyUrl, mapCompanyProfile, parseSearchItems, type CompanyProfile } from "@/lib/enrichment/identity";
import { classify } from "@/lib/enrichment/emails";
import { normalizedCompany } from "@/lib/opportunities/identity";
import { applyCompanyFields, ENRICHMENT_PROVIDER, profileValues } from "./enrichment-runner";

const FRESH_DAYS = 30;
const PERSON_PROVIDERS: FallbackProvider[] = ["signalhire", "apollo"];

/** Recent external lookups, newest first, with what each saved. */
export async function listExternalLookups(ctx: AuthContext) {
  const rows = await db.externalLookup.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" }, take: 20 });
  return toPlain(rows);
}

async function personProviders(workspaceId: string) {
  const [enrich, rows] = await Promise.all([
    db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: ENRICHMENT_PROVIDER } } }),
    db.providerConnection.findMany({ where: { workspaceId, provider: { in: PERSON_PROVIDERS } } }),
  ]);
  const order = parseEnrichmentConfig(enrich?.config).fallback.order.filter(p => PERSON_PROVIDERS.includes(p));
  for (const p of PERSON_PROVIDERS) if (!order.includes(p)) order.push(p);
  return order.map(p => { const r = rows.find(x => x.provider === p); return { ...providerState(p, r ? { enabled: r.enabled, allowedEnrichment: r.allowedEnrichment, allowedStorage: r.allowedStorage, hasKey: Boolean(r.encryptedCredentials), status: r.status } : null), row: r }; });
}

async function findOrCreateCompany(workspaceId: string, name: string, domain: string | null) {
  if (domain) { const byDomain = await db.company.findFirst({ where: { workspaceId, domain, deletedAt: null } }); if (byDomain) return byDomain; }
  const byName = (await db.company.findMany({ where: { workspaceId, deletedAt: null, name: { equals: name, mode: "insensitive" } }, take: 5 })).find(c => normalizedCompany(c.name) === normalizedCompany(name) && (!domain || !c.domain));
  if (byName) { if (domain && !byName.domain) return db.company.update({ where: { id: byName.id }, data: { domain, website: `https://${domain}` } }); return byName; }
  return db.company.create({ data: { workspaceId, name, domain, website: domain ? `https://${domain}` : null, country: "Unknown" } });
}

/** Saves a looked-up person, filling only empty fields; returns what was saved and what was not. */
async function savePerson(ctx: AuthContext, lookupId: string, provider: string, p: LookedUpPerson) {
  const key = p.linkedinUrl ? classifyTarget(p.linkedinUrl) : null;
  const profileKey = key?.kind === "person_linkedin" ? key.key : null;
  const existing = (profileKey ? await db.person.findFirst({ where: { workspaceId: ctx.workspaceId, profileKey, deletedAt: null } }) : null)
    ?? (p.linkedinUrl ? await db.person.findFirst({ where: { workspaceId: ctx.workspaceId, linkedinUrl: p.linkedinUrl, deletedAt: null } }) : null);
  const person = existing
    ? await db.person.update({ where: { id: existing.id }, data: { firstName: existing.firstName ?? p.firstName, lastName: existing.lastName ?? p.lastName, headline: existing.headline ?? p.headline, profileKey: existing.profileKey ?? profileKey, city: existing.city ?? p.city, country: existing.country !== "Unknown" ? existing.country : p.country ?? "Unknown" } })
    : await db.person.create({ data: { workspaceId: ctx.workspaceId, fullName: p.fullName, firstName: p.firstName, lastName: p.lastName, headline: p.headline, linkedinUrl: p.linkedinUrl, profileKey, city: p.city, country: p.country ?? "Unknown" } });
  let companyId: string | null = null; let emailsSaved = 0; let emailsNotSaved = 0;
  if (p.employer) {
    const company = await findOrCreateCompany(ctx.workspaceId, p.employer.name, p.employer.domain);
    companyId = company.id;
    const evidence = { source: `lookup:${provider}`, lookupId, retrievedAt: new Date().toISOString(), association: { value: "current", basis: `${FALLBACK_LABEL[provider as FallbackProvider] ?? provider} lists this as the person's current position.` } };
    const job = await db.employment.findFirst({ where: { workspaceId: ctx.workspaceId, personId: person.id, companyId } });
    if (job) await db.employment.update({ where: { id: job.id }, data: { title: job.title || p.title || "", isCurrent: true, association: "current", evidence: evidence as Prisma.InputJsonValue } });
    else await db.employment.create({ data: { workspaceId: ctx.workspaceId, personId: person.id, companyId, title: p.title ?? "", isCurrent: true, association: "current", evidence: evidence as Prisma.InputJsonValue, source: `lookup:${provider}` } });
    const domain = companyDomain(company.domain);
    const blocked = new Set((await db.suppression.findMany({ where: { workspaceId: ctx.workspaceId, value: { in: p.emails.map(e => e.email), mode: "insensitive" } }, select: { value: true } })).map(x => x.value.toLowerCase()));
    for (const e of p.emails) {
      const f = classify(e.email, domain, { kind: "provider", url: null, excerpt: null, provider });
      if (!f.sameDomain || f.generic || blocked.has(f.email)) { emailsNotSaved++; continue; }
      if (await db.contactMethod.findFirst({ where: { workspaceId: ctx.workspaceId, kind: "WORK_EMAIL", value: { equals: f.email, mode: "insensitive" } } })) continue;
      await db.contactMethod.create({ data: { workspaceId: ctx.workspaceId, personId: person.id, kind: "WORK_EMAIL", value: f.email, maskedValue: f.email.replace(/^(.).+@/, "$1***@"), isLocked: false, status: "UNVERIFIED", confidence: 60, source: `${provider}:lookup`, verificationResult: "UNCHECKED", provenance: { discovery: { kind: "provider", provider, lookupId, providerLabel: e.label, providerConfidence: e.confidence }, ownership: { basis: "provider_associated", note: `Returned by ${provider} for this profile.` } } as Prisma.InputJsonValue } });
      emailsSaved++;
    }
  } else emailsNotSaved = p.emails.length;
  return { personId: person.id, companyId, created: !existing, emailsSaved, emailsNotSaved };
}

async function saveCompany(workspaceId: string, lookupId: string, actor: string, profile: CompanyProfile) {
  const existing = (profile.domain ? await db.company.findFirst({ where: { workspaceId, domain: profile.domain, deletedAt: null } }) : null)
    ?? await db.company.findFirst({ where: { workspaceId, linkedinUrl: profile.linkedinUrl, deletedAt: null } });
  const company = existing ?? await db.company.create({ data: { workspaceId, name: profile.name, country: "Unknown" } });
  await applyCompanyFields(workspaceId, company.id, profileValues(profile), { source: `apify:${actor}`, runId: lookupId, confidence: 70 });
  return { companyId: company.id, created: !existing };
}

const view = async (workspaceId: string, id: string) => {
  const row = await db.externalLookup.findFirstOrThrow({ where: { id, workspaceId } });
  const [person, company] = await Promise.all([
    row.personId ? db.person.findFirst({ where: { id: row.personId, workspaceId }, select: { id: true, fullName: true, headline: true, linkedinUrl: true, employments: { where: { isCurrent: true }, select: { title: true, company: { select: { id: true, name: true, domain: true } } }, take: 1 } } }) : null,
    row.companyId ? db.company.findFirst({ where: { id: row.companyId, workspaceId }, select: { id: true, name: true, domain: true, industry: true, city: true, country: true, employeeCount: true, linkedinUrl: true } }) : null,
  ]);
  return toPlain({ ...row, person, company });
};

/**
 * Looks a LinkedIn profile, LinkedIn company page or domain up outside the workspace. Spends the
 * workspace's provider credits, so it is explicit, permission-checked and cached: a found answer
 * within 30 days is shown again rather than bought again, and a lookup already running is not
 * started twice. An uncertain match is returned for a person to confirm, never saved silently.
 */
export async function externalLookup(ctx: AuthContext, raw: unknown) {
  const { target, refresh } = z.object({ target: z.string().trim().min(3).max(500), refresh: z.boolean().default(false) }).parse(raw ?? {});
  const t = classifyTarget(target);
  if (t.kind === "unsupported") throw new MutationError(t.reason, "unsupported_target", 422);
  const permission = t.kind === "person_linkedin" ? PERMISSIONS.LEADS_REVEAL : PERMISSIONS.LEADS_EDIT;
  assertPermission(ctx, permission);
  const since = new Date(Date.now() - FRESH_DAYS * 86400000);
  const cached = refresh ? null : await db.externalLookup.findFirst({ where: { workspaceId: ctx.workspaceId, targetKey: t.key, status: "FOUND", createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
  if (cached) return { ...(await view(ctx.workspaceId, cached.id)), cached: true };
  if (await db.externalLookup.findFirst({ where: { workspaceId: ctx.workspaceId, targetKey: t.key, status: "RUNNING", createdAt: { gte: new Date(Date.now() - 10 * 60000) } } })) throw new MutationError("This is already being looked up. Wait for it to finish instead of paying twice.", "in_progress", 409);

  const row = await db.externalLookup.create({ data: { workspaceId: ctx.workspaceId, requestedById: ctx.userId, kind: t.kind, target, targetKey: t.key } });
  const fail = async (note: string, status = "FAILED") => { await db.externalLookup.update({ where: { id: row.id }, data: { status, note, finishedAt: new Date() } }); throw new MutationError(note, status === "NOT_CONNECTED" ? "not_connected" : "lookup_failed", 422); };
  try {
    if (t.kind === "person_linkedin") {
      const providers = await personProviders(ctx.workspaceId);
      const usable = providers.filter(p => p.usable);
      if (!usable.length) return await fail(`Looking up a profile needs SignalHire or Apollo connected with enrichment and storage rights. ${providers.map(p => p.why).join(" ")} Nothing was looked up or charged.`, "NOT_CONNECTED");
      const tried: string[] = [];
      for (const p of usable) {
        const key = decryptCredential(p.row!.encryptedCredentials!, ctx.workspaceId, p.provider);
        let found: LookedUpPerson | null = null;
        try {
          if (p.provider === "signalhire") { const r = await signalHireProvider(ctx.workspaceId, key).lookupByLinkedIn(t.url); if (r.status === "credits_are_over") { tried.push("SignalHire has no credits left"); continue; } found = r.candidate ? fromSignalHire(r.candidate, t.url) : null; }
          else { const r = await apolloProvider(ctx.workspaceId, key).matchPerson({ firstName: null, lastName: null, linkedinUrl: t.url }, { name: "", domain: null }); found = r.person && r.confidence !== "none" ? fromApollo(r.person, r.confidence, t.url) : null; }
        } catch (error) { tried.push(`${FALLBACK_LABEL[p.provider]}: ${error instanceof ProviderRequestError && (error.status === 402 || error.status === 429) ? "quota or credits are used up" : error instanceof ProviderRequestError && (error.status === 401 || error.status === 403) ? "the API key was refused" : "the lookup failed"}`); continue; }
        if (!found) { tried.push(`${FALLBACK_LABEL[p.provider]} had no match`); continue; }
        if (found.match === "low") {
          await db.externalLookup.update({ where: { id: row.id }, data: { status: "NEEDS_CONFIRMATION", provider: p.provider, candidates: [found] as unknown as Prisma.InputJsonValue, note: `${FALLBACK_LABEL[p.provider]} found a low-confidence match. Check it is the right person before saving.`, finishedAt: new Date() } });
          return { ...(await view(ctx.workspaceId, row.id)), cached: false };
        }
        return await mutate(ctx, permission, async () => {
          const saved = await savePerson(ctx, row.id, p.provider, found!);
          await db.externalLookup.update({ where: { id: row.id }, data: { status: "FOUND", provider: p.provider, personId: saved.personId, companyId: saved.companyId, note: `${saved.created ? "Saved as a new person" : "Matched a person already in the workspace; empty fields filled"}. ${saved.emailsSaved} work ${saved.emailsSaved === 1 ? "email" : "emails"} saved (unchecked)${saved.emailsNotSaved ? `; ${saved.emailsNotSaved} not saved (role address, personal, or not on the employer's domain)` : ""}.`, finishedAt: new Date() } });
          return { result: { ...(await view(ctx.workspaceId, row.id)), cached: false }, log: { action: "lead_lens.lookup", objectType: "ExternalLookup", objectId: row.id, after: { kind: t.kind, provider: p.provider, personId: saved.personId } } };
        });
      }
      return await fail(`No match: ${tried.join("; ")}.`, "NO_MATCH");
    }

    // Companies: Apify, on the workspace's Apify token and the enrichment Actors.
    const key = await apifyTokenFor(ctx.workspaceId, ENRICHMENT_PROVIDER);
    if (!key) return await fail("Looking up a company needs an Apify token (Apify enrichment or LinkedIn posts connection). Nothing was looked up or charged.", "NOT_CONNECTED");
    const cfg = parseEnrichmentConfig((await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: ENRICHMENT_PROVIDER } } }))?.config);
    let urls: string[] = [];
    if (t.kind === "company_linkedin") urls = [t.url];
    else {
      const search = await runLedgeredActor({ workspaceId: ctx.workspaceId, provider: ENRICHMENT_PROVIDER, key, stageKey: `lookup:${row.id}:search`, actorId: cfg.actors.search, input: { queries: `"${t.domain}" site:linkedin.com/company`, maxPagesPerQuery: 1 }, maxItems: 2, estimateUsd: estimate.search(1), maxUsd: cfg.maxUsdPerRun });
      urls = [...new Set(parseSearchItems(search.items).map(h => linkedInCompanyUrl(h.url)).filter((u): u is string => Boolean(u)))].slice(0, 3);
      if (!urls.length) return await fail(`No LinkedIn company page mentions ${t.domain}.`, "NO_MATCH");
    }
    const pages = await runLedgeredActor({ workspaceId: ctx.workspaceId, provider: ENRICHMENT_PROVIDER, key, stageKey: `lookup:${row.id}:company`, actorId: cfg.actors.company, input: { companies: urls }, maxItems: urls.length, estimateUsd: estimate.company(urls.length), maxUsd: cfg.maxUsdPerRun });
    const profiles = pages.items.map(mapCompanyProfile).filter((p): p is CompanyProfile => Boolean(p));
    // A domain lookup accepts only a page whose own website is that domain; a mention proves nothing.
    const matches = t.kind === "domain" ? profiles.filter(p => companyDomain(p.domain) === t.domain) : profiles.slice(0, 1);
    if (matches.length !== 1) {
      await db.externalLookup.update({ where: { id: row.id }, data: { status: matches.length ? "NEEDS_CONFIRMATION" : "NO_MATCH", provider: "apify", candidates: profiles as unknown as Prisma.InputJsonValue, note: matches.length ? `${matches.length} company pages list ${t.kind === "domain" ? t.domain : "this"} as their website. Choose one.` : `None of the ${profiles.length} LinkedIn pages found lists ${t.kind === "domain" ? t.domain : "a website"} as its own website, so none was saved.`, finishedAt: new Date() } });
      return { ...(await view(ctx.workspaceId, row.id)), cached: false };
    }
    return await mutate(ctx, permission, async () => {
      const saved = await saveCompany(ctx.workspaceId, row.id, cfg.actors.company, matches[0]);
      await db.externalLookup.update({ where: { id: row.id }, data: { status: "FOUND", provider: "apify", companyId: saved.companyId, note: saved.created ? "Saved as a new company." : "Matched a company already in the workspace; fields filled where the evidence was at least as strong.", finishedAt: new Date() } });
      return { result: { ...(await view(ctx.workspaceId, row.id)), cached: false }, log: { action: "lead_lens.lookup", objectType: "ExternalLookup", objectId: row.id, after: { kind: t.kind, companyId: saved.companyId } } };
    });
  } catch (error) {
    if (error instanceof MutationError) throw error;
    return await fail(error instanceof PageFetchError ? error.message : "The lookup failed unexpectedly. Nothing further was charged.");
  }
}

/** A person confirms one candidate of an uncertain lookup; only then is it saved. */
export async function confirmLookup(ctx: AuthContext, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const { index } = z.object({ index: z.number().int().min(0).max(9) }).parse(raw ?? {});
  const row = await loadScoped(() => db.externalLookup.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That lookup");
  if (row.status !== "NEEDS_CONFIRMATION") throw new MutationError("This lookup is not waiting for a choice.", "conflict", 409);
  const candidate = (row.candidates as unknown[])[index];
  if (!candidate) throw new MutationError("Choose one of the listed candidates.", "invalid_choice", 422);
  const permission = row.kind === "person_linkedin" ? PERMISSIONS.LEADS_REVEAL : PERMISSIONS.LEADS_EDIT;
  return mutate(ctx, permission, async () => {
    if (row.kind === "person_linkedin") {
      const saved = await savePerson(ctx, row.id, row.provider ?? "provider", candidate as LookedUpPerson);
      await db.externalLookup.update({ where: { id: row.id }, data: { status: "FOUND", personId: saved.personId, companyId: saved.companyId, note: `Confirmed by a person and saved. ${saved.emailsSaved} work ${saved.emailsSaved === 1 ? "email" : "emails"} saved (unchecked).` } });
    } else {
      const cfg = parseEnrichmentConfig((await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: ENRICHMENT_PROVIDER } } }))?.config);
      const saved = await saveCompany(ctx.workspaceId, row.id, cfg.actors.company, candidate as CompanyProfile);
      await db.externalLookup.update({ where: { id: row.id }, data: { status: "FOUND", companyId: saved.companyId, note: "Confirmed by a person and saved." } });
    }
    return { result: await view(ctx.workspaceId, row.id), log: { action: "lead_lens.confirmed", objectType: "ExternalLookup", objectId: row.id, after: { index } } };
  });
}

/** What the Lead Lens screen can offer: which external lookups are connected, and recent ones. */
export async function leadLensReadiness(ctx: AuthContext) {
  const [people, token, recent] = await Promise.all([personProviders(ctx.workspaceId), apifyTokenFor(ctx.workspaceId, ENRICHMENT_PROVIDER), listExternalLookups(ctx)]);
  const usable = people.filter(p => p.usable).map(p => FALLBACK_LABEL[p.provider]);
  return { personProviders: usable, personWhy: usable.length ? null : people.map(p => p.why).join(" "), companyReady: Boolean(token), canReveal: ctx.permissions.includes(PERMISSIONS.LEADS_REVEAL), canEdit: ctx.permissions.includes(PERMISSIONS.LEADS_EDIT), recent };
}
