import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { getProposalDefaults, saveProposalDefaults, LOGO_MAX_BYTES } from "@/lib/services/proposal-defaults";
import { createProposal, sendProposal } from "@/lib/services/proposals";
import { getPublicProposal } from "@/lib/services/proposal-public";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() {
  const w = await makeWorkspace("Defaults");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
// A 1×1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const base = { taxRate: 12, validityDays: 21 };

describe("proposal defaults", () => {
  it("saves and reads back, with packages as structured money", async () => {
    const w = await workspace();
    expect((await getProposalDefaults(w.ctx)).saved).toBe(false);
    await saveProposalDefaults(w.ctx, { ...base, terms: "Net 15.", logoDataUrl: PNG, website: "https://lst.example", packages: [{ name: "Starter", unit: "package", priceInr: 250000.5, inclusions: ["Discovery", "Build"] }] });
    const d = await getProposalDefaults(w.ctx);
    expect(d).toMatchObject({ saved: true, taxRate: 12, validityDays: 21, terms: "Net 15.", logoDataUrl: PNG });
    expect(d.packages).toEqual([{ name: "Starter", unit: "package", priceInr: 250000.5, inclusions: ["Discovery", "Build"] }]);
    // The audit row records that a logo exists, not the image.
    const audit = await db.auditLog.findFirstOrThrow({ where: { workspaceId: w.workspace.id, action: "proposal_defaults.updated" } });
    expect(JSON.stringify(audit)).not.toContain("base64");
  });

  it("rejects an oversized logo, an SVG, and malformed contact details", async () => {
    const w = await workspace();
    const big = `data:image/png;base64,${"A".repeat(Math.ceil((LOGO_MAX_BYTES + 1024) * 4 / 3))}`;
    await expect(saveProposalDefaults(w.ctx, { ...base, logoDataUrl: big })).rejects.toThrow(/256 KB/);
    await expect(saveProposalDefaults(w.ctx, { ...base, logoDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).rejects.toThrow(/SVG/);
    await expect(saveProposalDefaults(w.ctx, { ...base, website: "lst.example" })).rejects.toThrow(/https/);
    await expect(saveProposalDefaults(w.ctx, { ...base, contactEmail: "nope" })).rejects.toThrow(/email/);
    await expect(saveProposalDefaults(w.ctx, { ...base, packages: [{ name: "", unit: "x", priceInr: 1, inclusions: [] }] })).rejects.toThrow(/name/);
    expect((await getProposalDefaults(w.ctx)).saved).toBe(false);
  });

  it("needs pipeline configuration access", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "DefaultsRep", "sales_rep"); created.userIds.push(rep.userId);
    await expect(saveProposalDefaults(rep, base)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("never changes a proposal that already exists, and brands the customer's page", async () => {
    const w = await workspace();
    const { company } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await saveProposalDefaults(w.ctx, { ...base, terms: "Old terms." });
    const { proposal } = await createProposal(w.ctx, { title: "Issued", companyId: company.id, taxRate: 12, terms: "Old terms.", items: [{ name: "Build", quantity: 1, unit: "item", unitPriceInr: 1000 }] });
    await sendProposal(w.ctx, proposal.id);
    await saveProposalDefaults(w.ctx, { taxRate: 28, validityDays: 7, terms: "New terms.", logoDataUrl: PNG, contactEmail: "hello@lst.example" });
    const stored = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(Number(stored.taxRate)).toBe(12);
    expect(stored.terms).toBe("Old terms.");
    const pub = await getPublicProposal(stored.publicToken);
    expect(pub?.workspace.logoUrl).toBe(PNG);
    expect(pub?.workspace.contact?.email).toBe("hello@lst.example");
    expect(pub?.taxRate).toBe(12);
  });
});
