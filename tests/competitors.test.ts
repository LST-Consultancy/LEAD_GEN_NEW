import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import { createCompetitor, deleteCompetitor, updateCompetitor } from "@/lib/services/competitor-mutations";
import { getCompetitors } from "@/lib/services/signals";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("competitors", () => {
  it("creates with cleaned aliases, refuses duplicates, edits, and removes to the recycle bin", async () => {
    const w = await makeWorkspace("Competitors");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const c = await createCompetitor(w.ctx, { name: "Meridian Systems", aliases: ["Meridian SI", "meridian si", "Meridian Systems"], domain: "meridiansi.com" });
    expect(c.aliases).toEqual(["meridian si"]);
    await expect(createCompetitor(w.ctx, { name: "meridian systems" })).rejects.toMatchObject({ code: "duplicate_name" });
    await expect(createCompetitor(w.ctx, { name: "Kestrel", domain: "https://kestrel.io" })).rejects.toThrow(/Just the domain/);

    await updateCompetitor(w.ctx, c.id, { name: "Meridian Systems", aliases: ["Meridian"], notes: "Wins on delivery risk." });
    expect((await getCompetitors(w.ctx)).competitors[0]).toMatchObject({ aliases: ["Meridian"], notes: "Wins on delivery risk." });

    await deleteCompetitor(w.ctx, c.id);
    expect((await getCompetitors(w.ctx)).competitors).toHaveLength(0);
    expect(await db.deletedRecord.count({ where: { workspaceId: w.workspace.id, objectType: "Competitor", objectId: c.id } })).toBe(1);
    // Adding the same name again brings the row back rather than failing on the unique name.
    const again = await createCompetitor(w.ctx, { name: "Meridian Systems" });
    expect(again.id).toBe(c.id);
  });

  it("needs knowledge.manage", async () => {
    const w = await makeWorkspace("Competitors2");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const rep = await addMember(w.workspace.id, "CompRep", "sales_rep"); created.userIds.push(rep.userId);
    await expect(createCompetitor(rep, { name: "Kestrel" })).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
