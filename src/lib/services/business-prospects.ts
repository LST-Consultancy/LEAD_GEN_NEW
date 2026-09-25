import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { normalizedCompany } from "@/lib/opportunities/identity";
import { normalisePhone } from "@/lib/enrichment/emails";
import type { Place } from "@/lib/opportunities/apify-platforms";

const COUNTRY: Record<string, string> = { IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", SG: "Singapore", AU: "Australia", CA: "Canada", DE: "Germany" };

/**
 * Google Maps places saved as business prospects: a company record carrying where it was listed,
 * its category and its published phone — evidence of fit, never of intent, so no opportunity is
 * created. A company already in the workspace (same domain, or same name with no domain) is not
 * duplicated; a field it already has is not overwritten.
 */
export async function saveBusinessProspects(workspaceId: string, searchId: string, provider: string, places: Place[]) {
  const counts = { created: 0, known: 0, phones: 0 };
  const now = new Date().toISOString();
  for (const p of places) {
    const byDomain = p.domain ? await db.company.findFirst({ where: { workspaceId, domain: p.domain, deletedAt: null } }) : null;
    const byName = byDomain ?? (await db.company.findMany({ where: { workspaceId, deletedAt: null, domain: null, name: { equals: p.name, mode: "insensitive" } }, take: 5 })).find(c => normalizedCompany(c.name) === normalizedCompany(p.name)) ?? null;
    const listing = { provider, searchId, placeId: p.placeId, mapsUrl: p.mapsUrl, category: p.category, rating: p.rating, reviews: p.reviews, address: p.address, searchString: p.searchString, at: now };
    let companyId: string;
    if (byName) {
      const e = (byName.enrichment ?? {}) as Record<string, unknown> & { prospectSources?: typeof listing[] };
      const sources = [...(e.prospectSources ?? []).filter(s => s.placeId !== p.placeId), listing].slice(-10);
      await db.company.update({ where: { id: byName.id }, data: { enrichment: { ...e, prospectSources: sources } as Prisma.InputJsonValue,
        ...(byName.industry ? {} : p.category ? { industry: p.category } : {}), ...(byName.city ? {} : p.city ? { city: p.city } : {}), ...(byName.state ? {} : p.state ? { state: p.state } : {}),
        ...(byName.country && byName.country !== "Unknown" ? {} : p.countryCode && COUNTRY[p.countryCode] ? { country: COUNTRY[p.countryCode] } : {}),
        ...(byName.domain || !p.domain ? {} : { domain: p.domain, website: p.website }) } });
      companyId = byName.id; counts.known++;
    } else {
      const c = await db.company.create({ data: { workspaceId, name: p.name, domain: p.domain, website: p.website, industry: p.category, city: p.city, state: p.state, country: (p.countryCode && COUNTRY[p.countryCode]) || "Unknown",
        enrichment: { prospectSources: [listing], fields: Object.fromEntries(["industry", "city", "state", "website"].filter(k => (p as Record<string, unknown>)[k === "industry" ? "category" : k]).map(k => [k, { source: `apify:${provider}`, runId: searchId, retrievedAt: now, confidence: 60 }])) } as Prisma.InputJsonValue } });
      companyId = c.id; counts.created++;
    }
    const phone = p.phone ? normalisePhone(p.phone) : null;
    if (phone && !await db.companyContactPoint.findUnique({ where: { workspaceId_companyId_value: { workspaceId, companyId, value: phone } } })) {
      await db.companyContactPoint.create({ data: { workspaceId, companyId, kind: "PHONE", value: phone, isGeneric: true, domainStatus: "matched", source: `apify:${provider}`, evidence: { kind: "business_listing", url: p.mapsUrl, retrievedAt: now } as Prisma.InputJsonValue } });
      counts.phones++;
    }
  }
  return counts;
}
