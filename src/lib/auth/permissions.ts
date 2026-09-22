/**
 * Permission catalogue (§77). Roles are workspace-scoped rows holding a list of
 * these keys, so custom roles need no code change.
 */
export const PERMISSIONS = {
  LEADS_VIEW_ALL: "leads.view_all",
  LEADS_VIEW_OWN: "leads.view_own",
  LEADS_EDIT: "leads.edit",
  LEADS_REVEAL: "leads.reveal",
  LEADS_EXPORT: "leads.export",
  POINTS_SPEND: "points.spend",
  OUTREACH_SEND: "outreach.send",
  OUTREACH_APPROVE: "outreach.approve",
  PIPELINE_EDIT: "pipeline.edit",
  PIPELINE_CONFIGURE: "pipeline.configure",
  PROPOSALS_EDIT: "proposals.edit",
  PROPOSALS_SEND: "proposals.send",
  AUTOPILOT_CONFIGURE: "autopilot.configure",
  AGENTS_CONFIGURE: "agents.configure",
  BILLING_VIEW: "billing.view",
  BILLING_MANAGE: "billing.manage",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  WORKSPACE_MANAGE: "workspace.manage",
  ICP_MANAGE: "icp.manage",
  API_KEYS_MANAGE: "api_keys.manage",
  WEBHOOKS_MANAGE: "webhooks.manage",
  AUDIT_VIEW: "audit.view",
  DATA_DELETE: "data.delete",
  KNOWLEDGE_MANAGE: "knowledge.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL = Object.values(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES: Record<
  string,
  { name: string; description: string; permissions: Permission[] }
> = {
  owner: {
    name: "Owner",
    description: "Full control including billing and workspace deletion.",
    permissions: ALL,
  },
  admin: {
    name: "Admin",
    description: "Everything except billing management and workspace deletion.",
    permissions: ALL.filter(
      (p) => p !== PERMISSIONS.BILLING_MANAGE && p !== PERMISSIONS.WORKSPACE_MANAGE
    ),
  },
  manager: {
    name: "Manager",
    description: "Sees all team pipeline, approves AI actions, no platform admin.",
    permissions: [
      PERMISSIONS.LEADS_VIEW_ALL,
      PERMISSIONS.LEADS_VIEW_OWN,
      PERMISSIONS.LEADS_EDIT,
      PERMISSIONS.LEADS_REVEAL,
      PERMISSIONS.LEADS_EXPORT,
      PERMISSIONS.POINTS_SPEND,
      PERMISSIONS.OUTREACH_SEND,
      PERMISSIONS.OUTREACH_APPROVE,
      PERMISSIONS.PIPELINE_EDIT,
      PERMISSIONS.PIPELINE_CONFIGURE,
      PERMISSIONS.PROPOSALS_EDIT,
      PERMISSIONS.PROPOSALS_SEND,
      PERMISSIONS.AUTOPILOT_CONFIGURE,
      PERMISSIONS.BILLING_VIEW,
      PERMISSIONS.ICP_MANAGE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.KNOWLEDGE_MANAGE,
    ],
  },
  sales_rep: {
    name: "Sales Rep",
    description: "Works their own leads and deals end to end.",
    permissions: [
      PERMISSIONS.LEADS_VIEW_OWN,
      PERMISSIONS.LEADS_EDIT,
      PERMISSIONS.LEADS_REVEAL,
      PERMISSIONS.POINTS_SPEND,
      PERMISSIONS.OUTREACH_SEND,
      PERMISSIONS.PIPELINE_EDIT,
      PERMISSIONS.PROPOSALS_EDIT,
      PERMISSIONS.PROPOSALS_SEND,
    ],
  },
  researcher: {
    name: "Researcher",
    description: "Finds and enriches leads but cannot contact prospects.",
    permissions: [
      PERMISSIONS.LEADS_VIEW_ALL,
      PERMISSIONS.LEADS_VIEW_OWN,
      PERMISSIONS.LEADS_EDIT,
      PERMISSIONS.LEADS_REVEAL,
      PERMISSIONS.POINTS_SPEND,
    ],
  },
  viewer: {
    name: "Viewer",
    description: "Read-only across leads, pipeline and reporting.",
    permissions: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN],
  },
};

export function hasPermission(granted: string[], needed: Permission): boolean {
  return granted.includes(needed);
}

export function hasAnyPermission(granted: string[], needed: Permission[]): boolean {
  return needed.some((p) => granted.includes(p));
}
