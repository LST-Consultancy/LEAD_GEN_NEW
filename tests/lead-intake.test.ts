import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, makeLead, cleanup } from "./helpers/fixtures";
import { importLeads, parseDelimited } from "@/lib/ingest/import";
import { updateLeadDetails } from "@/lib/services/lead-mutations";
import { rescoreWorkspace } from "@/lib/queue/handlers/rescore";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

async function workspace(withIcp = true) {
  const w = await makeWorkspace("Intake");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  if (withIcp) {
    await db.icpProfile.create({ data: { workspaceId: w.workspace.id, name: "Intake ICP", isPrimary: true, industries: ["Manufacturing"], locations: ["Pune"], employeeMin: 50, employeeMax: 5000, buyerRoles: ["CFO"], seniorities: ["c_level"], technologies: [], pains: [], triggerEvents: [], exclusions: [] } });
  }
  return w;
}
const counts = (workspaceId: string) => Promise.all([
  db.person.count({ where: { workspaceId } }), db.company.count({ where: { workspaceId } }), db.lead.count({ where: { workspaceId } }),
]);
const ROW = { fullName: "Asha Kulkarni", companyName: "Deccan Castings", title: "Chief Financial Officer", email: "asha@deccancastings.in", city: "Pune", industry: "Manufacturing", employeeCount: 400 };

describe("manual intake", () => {
  it("adds one lead that scores, and a repeat reports the existing lead instead of duplicating", async () => {
    const w = await workspace();
    const first = await importLeads(w.ctx, { rows: [ROW], sourceLabel: "Met at a summit" });
    expect(first.imported).toBe(1);
    await rescoreWorkspace(w.workspace.id);
    expect(await db.leadScore.count({ where: { leadId: first.leadIds[0] } })).toBe(1);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: first.leadIds[0] } });
    expect(lead.ownerId).toBe(w.user.id);
    // A contact the user typed in is theirs: unlocked, no points.
    expect(await db.contactMethod.count({ where: { personId: lead.personId, isLocked: true } })).toBe(0);

    const before = await counts(w.workspace.id);
    const again = await importLeads(w.ctx, { rows: [{ ...ROW, fullName: "asha  kulkarni" }] });
    expect(again.imported).toBe(0);
    expect(again.skipped[0]).toMatchObject({ existingLeadId: lead.id });
    expect(await counts(w.workspace.id)).toEqual(before);
  });

  it("rejects an invalid email or URL and writes nothing", async () => {
    const w = await workspace();
    const before = await counts(w.workspace.id);
    await expect(importLeads(w.ctx, { rows: [{ ...ROW, email: "not-an-email" }] })).rejects.toThrow();
    await expect(importLeads(w.ctx, { rows: [{ ...ROW, linkedinUrl: "linkedin/asha" }] })).rejects.toThrow();
    await expect(importLeads(w.ctx, { rows: [{ ...ROW, fullName: "A" }] })).rejects.toThrow();
    expect(await counts(w.workspace.id)).toEqual(before);
  });

  it("with no ICP, says to set one up and writes nothing", async () => {
    const w = await workspace(false);
    await expect(importLeads(w.ctx, { rows: [ROW] })).rejects.toMatchObject({ code: "no_icp" });
    expect(await counts(w.workspace.id)).toEqual([0, 0, 0]);
    expect(await db.searchPhrase.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
  });

  it("the dry run parses and reports row errors without touching the database", async () => {
    const parsed = parseDelimited("name,company,email\nAsha Kulkarni,Deccan Castings,asha@deccancastings.in\nNo Company,,x@y.in\n");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("refuses a viewer on the server", async () => {
    const w = await workspace();
    const viewer = await addMember(w.workspace.id, "IntakeViewer", "viewer"); created.userIds.push(viewer.userId);
    await expect(importLeads(viewer, { rows: [ROW] })).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("editing the person behind a lead", () => {
  it("corrects name, title and city, re-deriving authority from the new title", async () => {
    const w = await workspace();
    const { lead, person } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await updateLeadDetails(w.ctx, lead.id, { fullName: "Asha R. Kulkarni", title: "Chief Financial Officer", city: "Pune" });
    const p = await db.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(p).toMatchObject({ fullName: "Asha R. Kulkarni", firstName: "Asha", lastName: "R. Kulkarni", city: "Pune" });
    const job = await db.employment.findFirstOrThrow({ where: { personId: person.id, companyId: lead.companyId, isCurrent: true } });
    expect(job).toMatchObject({ title: "Chief Financial Officer", isDecisionMaker: true, seniority: "c_level" });
    await updateLeadDetails(w.ctx, lead.id, { title: "Procurement Analyst" });
    expect((await db.employment.findUniqueOrThrow({ where: { id: job.id } })).isDecisionMaker).toBe(false);
    expect(await db.auditLog.count({ where: { objectId: lead.id, action: "lead.details_updated" } })).toBe(2);
  });

  it("refuses a malformed LinkedIn URL and one that belongs to someone else", async () => {
    const w = await workspace();
    const a = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const b = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await expect(updateLeadDetails(w.ctx, a.lead.id, { linkedinUrl: "https://example.com/asha" })).rejects.toThrow(/LinkedIn profile URL/);
    await updateLeadDetails(w.ctx, a.lead.id, { linkedinUrl: "https://www.linkedin.com/in/asha-k" });
    await expect(updateLeadDetails(w.ctx, b.lead.id, { linkedinUrl: "https://www.linkedin.com/in/asha-k" })).rejects.toMatchObject({ code: "duplicate_linkedin" });
  });

  it("is invisible to a rep who does not own the lead, and refused for a viewer", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "IntakeRep", "sales_rep"); created.userIds.push(rep.userId);
    const viewer = await addMember(w.workspace.id, "IntakeViewer2", "viewer"); created.userIds.push(viewer.userId);
    const { lead, person } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await expect(updateLeadDetails(rep, lead.id, { fullName: "Changed Name" })).rejects.toMatchObject({ status: 404 });
    await expect(updateLeadDetails(viewer, lead.id, { fullName: "Changed Name" })).rejects.toMatchObject({ name: "ForbiddenError" });
    expect((await db.person.findUniqueOrThrow({ where: { id: person.id } })).fullName).toBe(person.fullName);
  });
});
