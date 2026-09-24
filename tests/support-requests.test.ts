import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import { createSupportRequest, listSupportRequests, updateSupportRequest } from "@/lib/services/support-requests";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("support requests", () => {
  it("routes to administrators, keeps a history, and lets only them answer", async () => {
    const w = await makeWorkspace("Support"); const other = await makeWorkspace("Support2");
    for (const x of [w, other]) { created.workspaceIds.push(x.workspace.id); created.userIds.push(x.user.id); created.planIds.push(x.plan.id); }
    const rep = await addMember(w.workspace.id, "SupRep", "sales_rep"); const rep2 = await addMember(w.workspace.id, "SupRep2", "sales_rep");
    created.userIds.push(rep.userId, rep2.userId);

    const r = await createSupportRequest(rep, { subject: "Export button", message: "Export all downloads an empty file since this morning." });
    expect(r.reference).toMatch(/^SR-[A-Z0-9]{6}$/);
    await expect(createSupportRequest(rep, { subject: "x", message: "short" })).rejects.toThrow();

    expect((await listSupportRequests(w.ctx)).map((x) => x.id)).toContain(r.id);    // admin sees all
    expect((await listSupportRequests(rep)).map((x) => x.id)).toEqual([r.id]);       // author sees own
    expect(await listSupportRequests(rep2)).toEqual([]);                               // colleague does not
    expect(await listSupportRequests(other.ctx)).toEqual([]);                          // other tenant does not

    await expect(updateSupportRequest(rep, r.id, { status: "answered", note: "fixed" })).rejects.toMatchObject({ status: 403 });
    await expect(updateSupportRequest(rep2, r.id, { status: "closed" })).rejects.toMatchObject({ status: 404 });
    await expect(updateSupportRequest(w.ctx, r.id, { status: "answered" })).rejects.toMatchObject({ code: "note_required" });
    await updateSupportRequest(w.ctx, r.id, { status: "answered", note: "Reconnected the export worker." });
    await updateSupportRequest(rep, r.id, { status: "closed" });
    const row = (await listSupportRequests(rep))[0];
    expect(row.status).toBe("closed");
    expect(row.history.map((h) => h.status)).toEqual(["open", "answered", "closed"]);
    const stored = await db.supportRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(Array.isArray((stored.diagnostics as { checks: unknown[] }).checks)).toBe(true);
  });
});
