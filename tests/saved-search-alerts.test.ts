import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, makeLead, cleanup } from "./helpers/fixtures";
import { fireSavedSearchAlerts } from "@/lib/services/saved-search-alerts";
import { buildLeadQuery, parseLeadParams } from "@/lib/leads/params";
import { leadFilterSchema } from "@/lib/leads/filter";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
const HOUR = 3_600_000;

async function workspace() {
  const w = await makeWorkspace("SavedAlerts");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
const save = (workspaceId: string, createdById: string, extra: Partial<{ frequency: "REALTIME" | "DAILY" | "WEEKLY"; alertEnabled: boolean; filterJson: object; createdAt: Date }> = {}) =>
  db.savedSearch.create({ data: { workspaceId, createdById, name: `Fixture ${Math.random()}`, surface: "leads", filterJson: { tiers: ["A"] }, alertEnabled: true, frequency: "REALTIME", createdAt: new Date(Date.now() - 2 * HOUR), ...extra } });
const notes = (workspaceId: string, userId: string) => db.notification.count({ where: { workspaceId, userId, kind: "LEAD_SIGNAL" } });

describe("saved-search alerts", () => {
  it("alerts once for leads surfaced after the search was saved, and a rerun adds nothing", async () => {
    const w = await workspace();
    await makeLead(w.workspace.id, { tier: "A", ownerId: w.user.id });           // new since save: counts
    await makeLead(w.workspace.id, { tier: "C", ownerId: w.user.id });           // doesn't match
    const s = await save(w.workspace.id, w.user.id);
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(1);
    const n = await db.notification.findFirstOrThrow({ where: { workspaceId: w.workspace.id, userId: w.user.id, kind: "LEAD_SIGNAL" } });
    expect(n.title).toMatch(/^1 new lead matches/);
    expect(n.href).toBe("/leads?tiers=A");
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(0);
    expect(await notes(w.workspace.id, w.user.id)).toBe(1);
    expect((await db.savedSearch.findUniqueOrThrow({ where: { id: s.id } })).lastAlertAt).not.toBeNull();
  });

  it("says nothing when nothing new matches, or the alert is off, or the search is deleted", async () => {
    const w = await workspace();
    await save(w.workspace.id, w.user.id);                                         // no leads at all
    const off = await save(w.workspace.id, w.user.id, { alertEnabled: false });
    const gone = await save(w.workspace.id, w.user.id);
    await db.savedSearch.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    void off;
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(0);
    await makeLead(w.workspace.id, { tier: "A", ownerId: w.user.id });
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(1);          // only the live, alerting one
  });

  it("respects the frequency window", async () => {
    const w = await workspace();
    const s = await save(w.workspace.id, w.user.id, { frequency: "DAILY" });
    await db.savedSearch.update({ where: { id: s.id }, data: { lastAlertAt: new Date(Date.now() - 2 * HOUR) } });
    await makeLead(w.workspace.id, { tier: "A", ownerId: w.user.id });
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(0);          // alerted two hours ago
    expect((await fireSavedSearchAlerts(w.workspace.id, new Date(Date.now() + 23 * HOUR))).fired).toBe(1);
  });

  it("counts only what the creator can see", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "AlertRep", "sales_rep"); created.userIds.push(rep.userId);
    await save(w.workspace.id, rep.userId);
    await makeLead(w.workspace.id, { tier: "A", ownerId: w.user.id });           // the owner's, invisible to the rep
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(0);
    await makeLead(w.workspace.id, { tier: "A", ownerId: rep.userId });
    expect((await fireSavedSearchAlerts(w.workspace.id)).fired).toBe(1);
    expect((await db.notification.findFirstOrThrow({ where: { workspaceId: w.workspace.id, userId: rep.userId, kind: "LEAD_SIGNAL" } })).title).toMatch(/^1 new/);
  });
});

describe("saved-search link", () => {
  it("restores the stored filter exactly", () => {
    const stored = leadFilterSchema.parse({ tiers: ["A", "B"], intents: ["HOT"], minScore: 6, q: "netsuite", combine: "OR", sort: "surfaced" });
    const qs = new URLSearchParams(buildLeadQuery(stored).slice(1));
    const { filter } = parseLeadParams(Object.fromEntries(qs));
    expect(filter).toEqual(stored);
  });
});
