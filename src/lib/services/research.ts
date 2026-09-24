import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import type { Capability, Operation } from "@/lib/services/capabilities";
import { isConfigured } from "@/lib/ai/provider";
import { TOOLS } from "@/lib/ai/tools";

/**
 * §66 — research.
 *
 * Two different things share this screen, and keeping them apart is the point.
 *
 *  1. **What this workspace already knows** about an account, assembled from its
 *     own rows. Every line cites the row it came from, so nothing on it is a
 *     claim — it is a lookup. This works today and costs nothing.
 *  2. **Deep external research**, which needs a licensed data source and a
 *     model. Neither is wired, so it reports as unavailable rather than
 *     producing a plausible-looking dossier from a model's memory. A confident
 *     paragraph about a company, generated with no source, is the single most
 *     dangerous thing this product could ship.
 */

export type DossierFact = {
  label: string;
  value: string;
  /** Which row this came from, named so it can be checked. */
  source: string;
  href?: string;
  /** When that row was last touched, so a stale fact reads as stale. */
  asOf?: string;
};

export type DossierSection = {
  key: string;
  title: string;
  /** What this section would say if the data existed. Shown when it's empty. */
  emptyMeans: string;
  facts: DossierFact[];
};

export type InternalDossier = {
  lead: { id: string; companyName: string; score: number };
  sections: DossierSection[];
  /** Total facts found, so the screen can lead with how thin or thick it is. */
  factCount: number;
};

export type ResearchCapability = {
  /** Deep research needs both a source and a model; say which is missing. */
  externalAvailable: boolean;
  missing: string[];
  /** What a report would cost, from the tool registry — not a guess. */
  toolBuilt: boolean;
  sourcesConfigured: string[];
  sourcesUnconfigured: { label: string; requires: string }[];
};

/** Takes the workspace's capabilities so the connected-provider list is real, not a static registry. */
export function researchCapability(capabilities: Record<Operation, Capability>): ResearchCapability {
  const tool = TOOLS.find((t) => t.name === "research_company");
  const hasSource = capabilities.company_research.state === "available";
  const hasModel = isConfigured();

  const missing: string[] = [];
  if (!hasSource) missing.push("an external company-research source, which is not built");
  if (!hasModel) missing.push("a model provider");
  if (!tool?.implemented) missing.push("the research_company tool, which isn't built");

  return {
    externalAvailable: missing.length === 0,
    missing,
    toolBuilt: tool?.implemented ?? false,
    // Connected providers serve discovery and contact finding; listed so the user sees what does work.
    sourcesConfigured: [...capabilities.opportunity_discovery.providers, ...capabilities.contact_enrichment.providers]
      .filter((p) => p.state === "healthy" || p.state === "untested")
      .map((p) => p.name),
    sourcesUnconfigured: [],
  };
}

export async function listResearchReports(ctx: AuthContext) {
  const reports = await db.researchReport.findMany({
    where: { workspaceId: ctx.workspaceId, lead: { deletedAt: null, ...leadVisibilityFilter(ctx) } },
    orderBy: { startedAt: "desc" },
    take: 25,
    select: {
      id: true,
      state: true,
      depth: true,
      pointsSpent: true,
      confidence: true,
      modelUsed: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      lead: { select: { id: true, company: { select: { name: true } } } },
    },
  });

  return reports.map((r) => ({
    id: r.id,
    state: r.state,
    depth: r.depth,
    pointsSpent: r.pointsSpent,
    confidence: r.confidence,
    modelUsed: r.modelUsed,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
    leadId: r.lead?.id ?? null,
    companyName: r.lead?.company?.name ?? "Unknown",
  }));
}

/**
 * Everything this workspace already holds on one lead.
 *
 * Read-only, tenant- and visibility-scoped in SQL. Returns null when the lead
 * is out of tenant or out of visibility, so the route produces a 404 and the
 * two are indistinguishable from outside.
 */
export async function getInternalDossier(
  ctx: AuthContext,
  leadId: string
): Promise<InternalDossier | null> {
  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...leadVisibilityFilter(ctx),
    },
    include: {
      company: { include: { employments: { take: 12, include: { person: true } } } },
      person: true,
      score: true,
      signals: { where: { deletedAt: null }, take: 10, orderBy: { detectedAt: "desc" } },
      deals: { where: { deletedAt: null }, take: 5, orderBy: { updatedAt: "desc" } },
      notes: { where: { deletedAt: null }, take: 5, orderBy: { createdAt: "desc" } },
      owner: { select: { name: true } },
    },
  });
  if (!lead) return null;

  const company = lead.company;
  const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

  const sections: DossierSection[] = [
    {
      key: "company",
      title: "Company",
      emptyMeans:
        "Nothing is recorded about the company itself. Import or enrichment would fill this.",
      facts: [
        company?.industry && {
          label: "Industry",
          value: company.industry,
          source: "Company record",
          asOf: fmtDate(company.updatedAt),
        },
        company?.employeeCount && {
          label: "Headcount",
          value: `${company.employeeCount}`,
          source: "Company record",
          asOf: fmtDate(company.updatedAt),
        },
        company?.city && {
          label: "Location",
          value: [company.city, company.state].filter(Boolean).join(", "),
          source: "Company record",
          asOf: fmtDate(company.updatedAt),
        },
        company?.website && {
          label: "Website",
          value: company.website,
          source: "Company record",
          asOf: fmtDate(company.updatedAt),
        },
        company?.technologies?.length && {
          label: "Technologies recorded",
          value: company.technologies.join(", "),
          source: "Company record",
          asOf: fmtDate(company.updatedAt),
        },
      ].filter(Boolean) as DossierFact[],
    },
    {
      key: "people",
      title: "People",
      emptyMeans:
        "No contacts are recorded, so there is nobody to address. That is usually the first gap to close.",
      // The lead's own contact first, then everyone else recorded at the
      // company — an account is worked through people, not a single row.
      facts: [
        {
          label: lead.person.fullName,
          value: lead.person.headline ?? "No title recorded",
          source: "Lead contact",
          href: `/leads/${lead.id}`,
          asOf: fmtDate(lead.person.updatedAt),
        },
        ...company.employments
          .filter((e) => e.person.id !== lead.personId)
          .map((e) => ({
            label: e.person.fullName,
            value: e.title ?? e.person.headline ?? "No title recorded",
            source: "Employment record",
            href: `/leads/${lead.id}`,
            asOf: fmtDate(e.person.updatedAt),
          })),
      ],
    },
    {
      key: "signals",
      title: "Signals",
      emptyMeans:
        "No buying signal has been detected. Without one, timing is a guess — this is what search phrases are for.",
      facts: lead.signals.map((s) => ({
        label: s.title,
        value: s.excerpt,
        // Named so a claim can be checked against where it came from.
        source: `${s.sourceName} · confidence ${s.confidence}/100`,
        href: s.sourceUrl ?? undefined,
        asOf: fmtDate(s.occurredAt),
      })),
    },
    {
      key: "commercial",
      title: "Commercial",
      emptyMeans: "No deal exists yet, so there is no value or stage to report.",
      facts: lead.deals.map((d) => ({
        label: d.title,
        value: `${d.status} · ₹${d.valueInr.toString()}`,
        source: "Deal record",
        href: `/pipeline`,
        asOf: fmtDate(d.updatedAt),
      })),
    },
    {
      key: "internal",
      title: "What your team has said",
      emptyMeans: "Nobody has written a note on this account.",
      facts: lead.notes.map((n) => ({
        label: n.body.slice(0, 80),
        value: n.body.length > 80 ? `${n.body.slice(80, 260)}…` : "",
        source: "Note",
        href: `/leads/${lead.id}`,
        asOf: fmtDate(n.createdAt),
      })),
    },
  ];

  return {
    lead: {
      id: lead.id,
      companyName: company?.name ?? "Unnamed company",
      score: lead.score ? Number(lead.score.displayScore) : 0,
    },
    sections,
    factCount: sections.reduce((n, s) => n + s.facts.length, 0),
  };
}
