import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, makeLead, cleanup } from "./helpers/fixtures";
import { SYSTEM_ROLES, PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/context";
import { logTouch } from "@/lib/services/lead-activity";
import { createTask } from "@/lib/services/tasks";
import { addLeadsToList, createList } from "@/lib/services/lists";
import { bulkAssign, exportLeads, quoteBulkReveal } from "@/lib/services/lead-bulk";
import { getAccount } from "@/lib/services/people";

/**
 * Every role against every write added by the audit work, on the server. A
 * button hidden in the UI is a convenience; this is the part that has to hold
 * when someone calls the API directly.
 */
const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

const ROLES = ["owner", "manager", "sales_rep", "researcher", "viewer"] as const;
type Role = (typeof ROLES)[number];
const can = (role: Role, p: Permission) => SYSTEM_ROLES[role].permissions.includes(p);

let owner: AuthContext;
let ownersLead: string;
let otherWorkspaceCompany: string;
const actors = {} as Record<Role, { ctx: AuthContext; leadId: string; companyId: string }>;

beforeAll(async () => {
  const w = await makeWorkspace("RoleMatrix");
  const other = await makeWorkspace("RoleMatrixOther");
  for (const x of [w, other]) { created.workspaceIds.push(x.workspace.id); created.userIds.push(x.user.id); created.planIds.push(x.plan.id); }
  owner = w.ctx;
  ownersLead = (await makeLead(w.workspace.id, { ownerId: w.user.id })).lead.id;
  otherWorkspaceCompany = (await makeLead(other.workspace.id)).company.id;
  for (const role of ROLES) {
    const ctx = role === "owner" ? owner : await addMember(w.workspace.id, `Matrix${role}`, role);
    if (role !== "owner") created.userIds.push(ctx.userId);
    const { lead, company } = await makeLead(w.workspace.id, { ownerId: ctx.userId });
    actors[role] = { ctx, leadId: lead.id, companyId: company.id };
  }
});

/** Resolves to "allowed", "forbidden" or "not_found" — the three things a caller can observe. */
async function outcome(p: Promise<unknown>): Promise<"allowed" | "forbidden" | "not_found"> {
  try { await p; return "allowed"; }
  catch (err) {
    const e = err as { name?: string; status?: number };
    if (e.name === "ForbiddenError" || e.status === 403) return "forbidden";
    if (e.status === 404 || e.name === "NotFoundError") return "not_found";
    throw err;
  }
}

describe.each(ROLES)("%s", (role) => {
  const edit = () => can(role, PERMISSIONS.LEADS_EDIT) ? "allowed" : "forbidden";

  it("logs a touch on their own lead only with leads.edit", async () => {
    const a = actors[role];
    expect(await outcome(logTouch(a.ctx, a.leadId, { channel: "PHONE", direction: "OUTBOUND", outcome: "connected" }))).toBe(edit());
  });

  it("creates a task only with leads.edit", async () => {
    const a = actors[role];
    expect(await outcome(createTask(a.ctx, { title: `Matrix ${role}`, leadId: a.leadId }))).toBe(edit());
  });

  it("adds to a static list only with leads.edit", async () => {
    const a = actors[role];
    const { list } = await createList(owner, { name: `Matrix list ${role}` });
    expect(await outcome(addLeadsToList(a.ctx, list.id, [a.leadId]))).toBe(edit());
  });

  it("exports only with leads.export", async () => {
    const a = actors[role];
    expect(await outcome(exportLeads(a.ctx, { leadIds: [a.leadId] }))).toBe(can(role, PERMISSIONS.LEADS_EXPORT) ? "allowed" : "forbidden");
  });

  it("gets a reveal quote only with leads.reveal", async () => {
    const a = actors[role];
    expect(await outcome(quoteBulkReveal(a.ctx, [a.leadId]))).toBe(can(role, PERMISSIONS.LEADS_REVEAL) ? "allowed" : "forbidden");
  });

  it("reassigns only with view_all and edit, and never changes an owner otherwise", async () => {
    const a = actors[role];
    const r = await outcome(bulkAssign(a.ctx, { leadIds: [ownersLead], ownerId: owner.userId }).then((res) => {
      if (!res.outcomes.every((o) => o.ok)) throw Object.assign(new Error("refused per lead"), { status: 403 });
    }));
    expect(r).toBe(can(role, PERMISSIONS.LEADS_VIEW_ALL) && can(role, PERMISSIONS.LEADS_EDIT) ? "allowed" : "forbidden");
    expect((await db.lead.findUniqueOrThrow({ where: { id: ownersLead } })).ownerId).toBe(owner.userId);
  });

  it("cannot touch a lead outside their visibility; it looks like it does not exist", async () => {
    const a = actors[role];
    const expected = !can(role, PERMISSIONS.LEADS_EDIT) ? "forbidden" : can(role, PERMISSIONS.LEADS_VIEW_ALL) ? "allowed" : "not_found";
    expect(await outcome(logTouch(a.ctx, ownersLead, { channel: "PHONE", direction: "OUTBOUND", outcome: "no_answer" }))).toBe(expected);
  });

  it("never sees another workspace's account", async () => {
    expect(await getAccount(actors[role].ctx, otherWorkspaceCompany)).toBeNull();
  });
});
