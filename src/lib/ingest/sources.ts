/**
 * Ingestion source registry.
 *
 * Discovering buying signals needs somewhere to discover them *from*: a
 * licensed dataset, a job-board feed, a tender portal. None of those is
 * connected here, and rather than simulate one, each is declared with
 * `configured: false` and a note on what it would need.
 *
 * One adapter does work with no external service — manual import — because a
 * user pasting their own prospect list is a legitimate way for leads to enter
 * the system, and it means the ingestion path is exercised end to end rather
 * than being a stub waiting on a vendor contract.
 *
 * Free of server-only imports so both the app and the worker can read it.
 */

export type SourceKind =
  | "PUBLIC_WEB"
  | "JOB_BOARD"
  | "NEWS"
  | "SOCIAL_PUBLIC"
  | "COMPANY_SITE"
  | "LICENSED_DATASET"
  | "USER_INTEGRATION"
  | "USER_MANUAL"
  | "TENDER_PORTAL";

export type SourceDescriptor = {
  kind: SourceKind;
  label: string;
  /** Whether this source can actually fetch right now. */
  configured: boolean;
  /** What it would take to make it work. Shown in the UI, not hidden in a README. */
  requires: string;
  /** Why this source is worth having, in terms of signal quality. */
  value: string;
  /** Legal and policy posture — §32 forbids unauthorised scraping. */
  compliance: string;
};

export const SOURCES: Record<SourceKind, SourceDescriptor> = {
  USER_MANUAL: {
    kind: "USER_MANUAL",
    label: "Manual import",
    configured: true,
    requires: "Nothing — paste or upload a list you already have.",
    value:
      "Your own list, with whatever context you add. Scored against your ICP the same way any other lead is.",
    compliance: "Data you already hold. Suppression and consent rules still apply before any send.",
  },
  LICENSED_DATASET: {
    kind: "LICENSED_DATASET",
    label: "Licensed B2B dataset",
    configured: false,
    requires: "A data provider contract and API credentials.",
    value: "Firmographics and verified contacts at scale, with provenance you can point at.",
    compliance: "Licensed for the use you put it to. Check the terms cover outbound contact.",
  },
  JOB_BOARD: {
    kind: "JOB_BOARD",
    label: "Job board feed",
    configured: false,
    requires: "An official job-board API, or a public feed that permits programmatic access.",
    value:
      "Among the strongest inferred signals: hiring for a named role usually means the platform decision is made and budget exists.",
    compliance: "Official API or published feed only. No scraping of pages that forbid it.",
  },
  TENDER_PORTAL: {
    kind: "TENDER_PORTAL",
    label: "Public tender portal",
    configured: false,
    requires: "A government or industry tender portal API.",
    value:
      "The highest-confidence intent available — a published requirement with a deadline attached.",
    compliance: "Public procurement notices are published for exactly this purpose.",
  },
  NEWS: {
    kind: "NEWS",
    label: "Business news",
    configured: false,
    requires: "A news API or licensed press feed.",
    value: "Funding, expansion and leadership change — capacity and timing signals.",
    compliance: "Licensed feed or a publisher API. Respect content reuse terms.",
  },
  COMPANY_SITE: {
    kind: "COMPANY_SITE",
    label: "Company website monitoring",
    configured: false,
    requires: "A change-monitoring service, honouring robots.txt and rate limits.",
    value: "Careers pages, product announcements and technology footprint changes.",
    compliance:
      "robots.txt and published crawl policy must be honoured. Pages that forbid automated access are not fetched.",
  },
  SOCIAL_PUBLIC: {
    kind: "SOCIAL_PUBLIC",
    label: "Public social posts",
    configured: false,
    requires: "An official platform API with a scope that permits search.",
    value: "Someone stating a need in their own words. The most actionable signal there is.",
    compliance:
      "Official API only. Scraping a platform that prohibits it is not an option we build on.",
  },
  PUBLIC_WEB: {
    kind: "PUBLIC_WEB",
    label: "Public web search",
    configured: false,
    requires: "A search API with a commercial-use licence.",
    value: "Broad coverage for phrases the narrower sources miss.",
    compliance: "Commercial search API terms apply.",
  },
  USER_INTEGRATION: {
    kind: "USER_INTEGRATION",
    label: "Your own integration",
    configured: false,
    requires: "An API key from this workspace and a push to the ingestion endpoint.",
    value: "Whatever your existing systems already know that this one does not.",
    compliance: "Your data, your basis for holding it.",
  },
};

/** True when at least one source can actually fetch. */
export function hasIngestionSource(): boolean {
  return Object.values(SOURCES).some((s) => s.configured && s.kind !== "USER_MANUAL");
}

/** Sources that work today, manual import included. */
export function availableSources(): SourceDescriptor[] {
  return Object.values(SOURCES).filter((s) => s.configured);
}

export function pendingSources(): SourceDescriptor[] {
  return Object.values(SOURCES).filter((s) => !s.configured);
}
