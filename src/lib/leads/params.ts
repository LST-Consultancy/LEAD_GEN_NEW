import { SHORTCUTS, leadFilterSchema, type LeadFilter } from "@/lib/leads/filter";

/**
 * URL search params are the single source of truth for the Leads screen. That
 * makes every filtered view shareable, bookmarkable and saveable without a
 * separate persistence layer.
 */

const ARRAY_KEYS = [
  "tiers",
  "statuses",
  "intents",
  "industries",
  "cities",
  "states",
  "seniorities",
  "departments",
  "signalTypes",
  "technologies",
  "ownerIds",
] as const;

const BOOL_KEYS = [
  "decisionMakersOnly",
  "replied",
  "reachable",
  "revealed",
  "starred",
  "hasBudget",
  "hasSignal",
  "noOutreach",
  "needsFollowUp",
  "includeArchived",
] as const;

const NUM_KEYS = [
  "minScore",
  "maxScore",
  "employeeMin",
  "employeeMax",
  "budgetMin",
  "budgetMax",
  "surfacedWithinDays",
  "notContactedForDays",
  "page",
  "pageSize",
] as const;

export function parseLeadParams(
  params: Record<string, string | string[] | undefined>
): { filter: LeadFilter; shortcut: string | null } {
  const raw: Record<string, unknown> = {};

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  if (first(params.q)) raw.q = first(params.q);
  if (first(params.combine)) raw.combine = first(params.combine);
  if (first(params.sort)) raw.sort = first(params.sort);
  if (first(params.dir)) raw.dir = first(params.dir);
  if (first(params.listId)) raw.listId = first(params.listId);

  for (const key of ARRAY_KEYS) {
    const value = first(params[key]);
    if (value) raw[key] = value.split(",").filter(Boolean);
  }
  for (const key of BOOL_KEYS) {
    const value = first(params[key]);
    if (value === "1" || value === "true") raw[key] = true;
  }
  for (const key of NUM_KEYS) {
    const value = first(params[key]);
    if (value !== undefined && value !== "") raw[key] = value;
  }

  // A shortcut is a named preset. It seeds the filter, and any explicit param
  // in the URL then overrides it.
  const shortcutKey = first(params.shortcut) ?? null;
  const shortcut = shortcutKey ? SHORTCUTS.find((s) => s.key === shortcutKey) : undefined;
  const merged = shortcut ? { ...shortcut.filter, ...raw } : raw;

  return {
    filter: parseTolerantly(merged),
    shortcut: shortcut?.key ?? null,
  };
}

/**
 * URLs get hand-edited, bookmarked and truncated. A single bad value must not
 * take the page down, so an invalid field is dropped and the rest is kept —
 * the user sees their filters minus the broken one, not a 500.
 */
function parseTolerantly(input: Record<string, unknown>): LeadFilter {
  const candidate = { ...input };

  // Each pass removes the fields Zod rejected. Two passes clears any realistic
  // URL; beyond that, fall back to an unfiltered view.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = leadFilterSchema.safeParse(candidate);
    if (result.success) return result.data;

    const offending = new Set(
      result.error.issues
        .map((issue) => issue.path[0])
        .filter((key): key is string => typeof key === "string")
    );
    if (offending.size === 0) break;
    for (const key of offending) delete candidate[key];
  }

  return leadFilterSchema.parse({});
}

/** Builds a query string from a partial filter, dropping empty values. */
export function buildLeadQuery(
  filter: Partial<LeadFilter> & { shortcut?: string | null }
): string {
  const sp = new URLSearchParams();

  if (filter.shortcut) sp.set("shortcut", filter.shortcut);
  if (filter.q) sp.set("q", filter.q);
  if (filter.combine && filter.combine !== "AND") sp.set("combine", filter.combine);
  if (filter.sort && filter.sort !== "score") sp.set("sort", filter.sort);
  if (filter.dir && filter.dir !== "desc") sp.set("dir", filter.dir);
  if (filter.listId) sp.set("listId", filter.listId);

  for (const key of ARRAY_KEYS) {
    const value = filter[key];
    if (Array.isArray(value) && value.length > 0) sp.set(key, value.join(","));
  }
  for (const key of BOOL_KEYS) {
    if (filter[key]) sp.set(key, "1");
  }
  for (const key of NUM_KEYS) {
    const value = filter[key];
    if (value !== undefined && value !== null) {
      if (key === "page" && value === 1) continue;
      if (key === "pageSize" && value === 50) continue;
      sp.set(key, String(value));
    }
  }

  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Counts the user-meaningful filters in play, for the "N active" chip. */
export function countActiveFilters(filter: Partial<LeadFilter>): number {
  let n = 0;
  if (filter.q) n++;
  for (const key of ARRAY_KEYS) {
    const value = filter[key];
    if (Array.isArray(value) && value.length > 0) n++;
  }
  for (const key of BOOL_KEYS) {
    if (filter[key]) n++;
  }
  for (const key of NUM_KEYS) {
    if (key === "page" || key === "pageSize") continue;
    if (filter[key] !== undefined) n++;
  }
  if (filter.listId) n++;
  return n;
}
