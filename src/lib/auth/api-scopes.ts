import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * §65 — what a machine caller may be granted.
 *
 * A scope is coarser than a permission on purpose: an integration should ask
 * for "read leads", not for the nine internal permissions that happen to
 * imply. Each scope declares which permissions it grants and its risk class,
 * so the same four-way classification the agent layer uses applies to API and
 * MCP callers too.
 */

export type ScopeRisk = "READ" | "WRITE" | "SPEND" | "EXTERNAL";

export type ApiScope = {
  key: string;
  label: string;
  risk: ScopeRisk;
  /** What a holder can do, in a sentence, for the consent screen. */
  describes: string;
  /**
   * Permissions the scope passes through *if the creator holds them*.
   *
   * Broader than `requires` on purpose: `leads.read` grants `view_all` to a
   * manager and only `view_own` to a rep, and the row-level visibility filter
   * then does the rest. The key is as wide as its creator, never wider.
   */
  grants: Permission[];
  /**
   * The minimum that makes the scope meaningful.
   *
   * Checked when a key is created. Requiring all of `grants` instead made
   * `leads.read` ungrantable by anyone without `view_all` — so a rep could not
   * issue a read key for their own leads, which is the common case.
   */
  requires: Permission[];
};

export const API_SCOPES: ApiScope[] = [
  {
    key: "leads.read",
    label: "Read leads",
    risk: "READ",
    describes: "List and read leads, their scores and the evidence behind them.",
    grants: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN],
    requires: [PERMISSIONS.LEADS_VIEW_OWN],
  },
  {
    key: "leads.write",
    label: "Change leads",
    risk: "WRITE",
    describes: "Edit a lead's status, owner, tier, value and next action; add notes and tasks.",
    grants: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_EDIT],
    requires: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_EDIT],
  },
  {
    key: "pipeline.read",
    label: "Read pipeline",
    risk: "READ",
    describes: "List deals, stages, values and risk flags.",
    grants: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN],
    requires: [PERMISSIONS.LEADS_VIEW_OWN],
  },
  {
    key: "pipeline.write",
    label: "Change pipeline",
    risk: "WRITE",
    describes: "Create and edit deals, and move them between stages.",
    grants: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.PIPELINE_EDIT],
    requires: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.PIPELINE_EDIT],
  },
  {
    key: "insights.read",
    label: "Read reporting",
    risk: "READ",
    describes: "Read the revenue, health and worklist figures the dashboards use.",
    grants: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN],
    requires: [PERMISSIONS.LEADS_VIEW_OWN],
  },
  {
    key: "contacts.reveal",
    label: "Reveal contacts",
    risk: "SPEND",
    describes:
      "Unlock verified contact details. This spends points from the workspace balance and cannot be undone.",
    grants: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_REVEAL, PERMISSIONS.POINTS_SPEND],
    requires: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_REVEAL, PERMISSIONS.POINTS_SPEND],
  },
  {
    key: "outreach.send",
    label: "Send outreach",
    risk: "EXTERNAL",
    describes: "Send email and enrol leads in sequences. This reaches people outside the app.",
    grants: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.OUTREACH_SEND],
    requires: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.OUTREACH_SEND],
  },
  {
    key: "proposals.read",
    label: "Read proposals",
    risk: "READ",
    describes: "List proposals with their totals, view counts and decisions.",
    grants: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN],
    requires: [PERMISSIONS.LEADS_VIEW_OWN],
  },
  {
    key: "proposals.write",
    label: "Change proposals",
    risk: "WRITE",
    describes: "Create and edit proposals. Sending one is a separate scope.",
    grants: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.PROPOSALS_EDIT],
    requires: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.PROPOSALS_EDIT],
  },
];

export const SCOPE_INDEX = new Map(API_SCOPES.map((s) => [s.key, s]));

/** The permissions a set of scopes asks for, deduplicated. */
export function permissionsForScopes(scopes: string[]): Permission[] {
  const out = new Set<Permission>();
  for (const key of scopes) {
    for (const p of SCOPE_INDEX.get(key)?.grants ?? []) out.add(p);
  }
  return [...out];
}

/**
 * The effective permissions of a key: what its scopes ask for, **intersected
 * with what the person who created it actually has**.
 *
 * This is the property that makes keys safe to hand out. A key can never
 * exceed its creator's authority, and if that person is later demoted the key
 * narrows with them rather than becoming an orphaned escalation.
 */
export function effectivePermissions(
  scopes: string[],
  creatorPermissions: string[]
): { granted: Permission[]; withheld: Permission[] } {
  const asked = permissionsForScopes(scopes);
  const granted = asked.filter((p) => creatorPermissions.includes(p));
  const withheld = asked.filter((p) => !creatorPermissions.includes(p));
  return { granted, withheld };
}

/** Scopes a given role could grant at all, for the create form. */
export function grantableScopes(permissions: string[]): {
  scope: ApiScope;
  grantable: boolean;
  missing: Permission[];
}[] {
  return API_SCOPES.map((scope) => {
    // Against `requires`, not `grants`: a rep holding only `view_own` can
    // still issue a read key for their own leads.
    const missing = scope.requires.filter((p) => !permissions.includes(p));
    return { scope, grantable: missing.length === 0, missing };
  });
}

/** The minimum permissions a set of scopes needs to be worth issuing at all. */
export function requiredPermissions(scopes: string[]): Permission[] {
  const out = new Set<Permission>();
  for (const key of scopes) {
    for (const p of SCOPE_INDEX.get(key)?.requires ?? []) out.add(p);
  }
  return [...out];
}

export const SCOPE_RISK_ORDER: ScopeRisk[] = ["EXTERNAL", "SPEND", "WRITE", "READ"];

/** The riskiest scope in a set, for sorting and badging. */
export function highestRisk(scopes: string[]): ScopeRisk | null {
  const risks = scopes
    .map((s) => SCOPE_INDEX.get(s)?.risk)
    .filter((r): r is ScopeRisk => r !== undefined);
  if (risks.length === 0) return null;
  return SCOPE_RISK_ORDER.find((r) => risks.includes(r)) ?? null;
}
