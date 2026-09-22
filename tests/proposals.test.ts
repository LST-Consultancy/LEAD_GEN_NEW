import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  listProposals,
  getProposal,
  createProposal,
  updateProposal,
  sendProposal,
  recordProposalDecision,
  deleteProposal,
  type ProposalInput,
} from "@/lib/services/proposals";
import {
  getPublicProposal,
  recordProposalView,
  decidePublicProposal,
} from "@/lib/services/proposal-public";
import { ForbiddenError } from "@/lib/auth/context";
import { expireProposals, auditProposalTotals } from "@/lib/queue/handlers/proposals";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Proposals");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

function input(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    title: "ERP phase one",
    companyId: "",
    taxRate: 18,
    sections: [{ key: "summary", title: "Executive summary", body: "Eleven weeks, fixed scope." }],
    terms: "50% on signing, 50% on go-live.",
    items: [
      { name: "Implementation", quantity: 1, unit: "project", unitPriceInr: 1_800_000 },
      { name: "Licences", quantity: 25, unit: "seat", unitPriceInr: 7_200 },
    ],
    ...over,
  };
}

/** A sent proposal with its token, ready for the public path. */
async function sentProposal(ctx: Parameters<typeof createProposal>[0], companyId: string, over: Partial<ProposalInput> = {}) {
  const { proposal } = await createProposal(ctx, input({ companyId, ...over }));
  await sendProposal(ctx, proposal.id);
  const row = await db.proposal.findUniqueOrThrow({
    where: { id: proposal.id },
    select: { publicToken: true },
  });
  return { id: proposal.id, token: row.publicToken };
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("creating a proposal", () => {
  it("computes the totals from the lines", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });

    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    expect(Number(proposal.subtotalInr)).toBe(1_980_000);
    expect(Number(proposal.taxInr)).toBe(356_400);
    expect(Number(proposal.totalInr)).toBe(2_336_400);
  });

  it("stores each line's own amount, so the printed figures sum to the subtotal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(
      ctx,
      input({
        companyId: company.id,
        items: [
          { name: "a", quantity: 3, unit: "day", unitPriceInr: 333.335 },
          { name: "b", quantity: 7, unit: "day", unitPriceInr: 11.115 },
        ],
      })
    );
    const sum = proposal.items.reduce((s, i) => s + Math.round(Number(i.amountInr) * 100), 0);
    expect(Math.round(Number(proposal.subtotalInr) * 100)).toBe(sum);
  });

  it("starts as a draft whose public link does not work", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal, note } = await createProposal(ctx, input({ companyId: company.id }));
    expect(proposal.state).toBe("DRAFT");
    expect(note).toMatch(/does not work until you send it/);

    const row = await db.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: { publicToken: true },
    });
    expect(await getPublicProposal(row.publicToken)).toBeNull();
  });

  it("gives every proposal an unguessable token", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const a = await createProposal(ctx, input({ companyId: company.id }));
    const b = await createProposal(ctx, input({ companyId: company.id, title: "Second" }));
    const rows = await db.proposal.findMany({
      where: { id: { in: [a.proposal.id, b.proposal.id] } },
      select: { publicToken: true },
    });
    expect(rows[0].publicToken).not.toBe(rows[1].publicToken);
    for (const r of rows) expect(r.publicToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a validity date already in the past", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await expect(
      createProposal(ctx, input({ companyId: company.id, validUntil: new Date("2020-01-01") }))
    ).rejects.toThrow(/already passed/);
  });

  it("refuses a company from another workspace", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { company } = await makeLead(b.workspace.id, { ownerId: b.ctx.userId });
    await expect(createProposal(a.ctx, input({ companyId: company.id }))).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });

  it("refuses a lead the caller cannot see", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    await expect(
      createProposal(rep, input({ companyId: company.id, leadId: lead.id }))
    ).rejects.toThrow(/don't have access/);
  });

  it("requires at least one line", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await expect(
      createProposal(ctx, input({ companyId: company.id, items: [] }))
    ).rejects.toThrow();
  });

  it("requires the edit permission", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    await expect(
      createProposal(viewer, input({ companyId: company.id }))
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("sending", () => {
  it("makes the link live without needing a mailbox, and says so", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));

    const result = await sendProposal(ctx, proposal.id);
    expect(result.emailed).toBe(false);
    expect(result.note).toMatch(/link is live/);
    expect(result.note).toMatch(/Nothing was emailed/);
    expect(result.publicPath).toMatch(/^\/p\/[0-9a-f]{32}$/);
  });

  it("refuses to email when no mailbox is connected", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await expect(sendProposal(ctx, proposal.id, { byEmail: true })).rejects.toThrow(
      /No email provider is connected/
    );
    // And it did not half-send.
    const after = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(after.state).toBe("DRAFT");
  });

  it("refuses to send a proposal whose totals disagree with its lines", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    // Corrupt the stored total, the way a bad migration or manual edit would.
    await db.proposal.update({ where: { id: proposal.id }, data: { totalInr: 1 } });

    await expect(sendProposal(ctx, proposal.id)).rejects.toThrow(/do not match the line items/);
  });

  it("refuses to send past the validity date", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await db.proposal.update({
      where: { id: proposal.id },
      data: { validUntil: new Date(Date.now() - 5 * 86_400_000) },
    });
    await expect(sendProposal(ctx, proposal.id)).rejects.toThrow(/validity date has passed/);
  });

  it("keeps the original sentAt when re-sent", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await sendProposal(ctx, proposal.id);
    const first = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    await sendProposal(ctx, proposal.id);
    const second = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(second.sentAt?.getTime()).toBe(first.sentAt?.getTime());
  });

  it("will not re-send something already decided", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });
    await expect(sendProposal(ctx, id)).rejects.toThrow(/settled question/);
  });

  it("requires the send permission, which a researcher lacks", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    const researcher = await addMember(workspace.id, "Researcher", "researcher");
    await expect(sendProposal(researcher, proposal.id)).rejects.toThrow();
  });
});

describe("editing", () => {
  it("recomputes the totals and warns when the proposal is already live", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);

    const result = await updateProposal(
      ctx,
      id,
      input({
        companyId: company.id,
        items: [{ name: "Implementation", quantity: 1, unit: "project", unitPriceInr: 1_000_000 }],
      })
    );
    expect(Number(result.proposal.totalInr)).toBe(1_180_000);
    expect(result.note).toMatch(/already live/);
  });

  it("refuses to edit an accepted proposal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });

    await expect(updateProposal(ctx, id, input({ companyId: company.id }))).rejects.toThrow(
      /rewrite the record/
    );
  });

  it("replaces the lines rather than mixing old and new", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await updateProposal(
      ctx,
      proposal.id,
      input({
        companyId: company.id,
        items: [{ name: "Only line", quantity: 1, unit: "item", unitPriceInr: 500 }],
      })
    );
    const items = await db.proposalItem.findMany({ where: { proposalId: proposal.id } });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Only line");
  });
});

describe("recording a decision from the team", () => {
  it("refuses on a draft, because nobody has seen it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await expect(
      recordProposalDecision(ctx, proposal.id, { decision: "accept" })
    ).rejects.toThrow(/has not been sent/);
  });

  it("requires a reason to decline", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await expect(recordProposalDecision(ctx, id, { decision: "decline" })).rejects.toThrow(
      /only part of a loss that is reusable/
    );
  });

  it("refuses a second decision", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });
    await expect(
      recordProposalDecision(ctx, id, { decision: "decline", reason: "Changed mind" })
    ).rejects.toThrow(/would overwrite the first/);
  });

  it("writes an activity row carrying the amount", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });

    const activity = await db.activity.findFirstOrThrow({
      where: { workspaceId: workspace.id, kind: "proposal.accepted" },
    });
    expect(Number(activity.amountInr)).toBe(2_336_400);
  });
});

describe("the public proposal", () => {
  it("shows a sent proposal to a link holder", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);

    const pub = await getPublicProposal(token);
    expect(pub?.title).toBe("ERP phase one");
    expect(pub?.company.name).toBe(company.name);
    expect(pub?.totalInr).toBe(2_336_400);
    expect(pub?.canDecide).toBe(true);
  });

  it("exposes nothing internal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);

    const pub = (await getPublicProposal(token)) as unknown as Record<string, unknown>;
    // The prospect must not receive lead scores, owners, tokens or ids of
    // anything but the proposal itself.
    for (const leaked of ["lead", "publicToken", "createdById", "viewCount", "views", "deal"]) {
      expect(pub[leaked]).toBeUndefined();
    }
  });

  it("returns null for a malformed or unknown token", async () => {
    expect(await getPublicProposal("nope")).toBeNull();
    expect(await getPublicProposal("")).toBeNull();
    expect(await getPublicProposal("a".repeat(32))).toBeNull();
    // Valid shape, nonexistent value.
    expect(await getPublicProposal("0123456789abcdef0123456789abcdef")).toBeNull();
  });

  it("hides a draft, so a guessed token cannot confirm one exists", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    const row = await db.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: { publicToken: true },
    });
    expect(await getPublicProposal(row.publicToken)).toBeNull();
  });

  it("stops working once the proposal is deleted", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);
    await deleteProposal(ctx, id);
    expect(await getPublicProposal(token)).toBeNull();
  });

  it("prefers the line arithmetic when stored totals are corrupt", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);
    await db.proposal.update({ where: { id }, data: { totalInr: 7 } });

    const pub = await getPublicProposal(token);
    // The prospect never sees a total that does not add up.
    expect(pub?.totalInr).toBe(2_336_400);
  });

  it("reports expiry and refuses a decision past it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);
    await db.proposal.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 3 * 86_400_000) },
    });

    const pub = await getPublicProposal(token);
    expect(pub?.state).toBe("EXPIRED");
    expect(pub?.canDecide).toBe(false);
    expect(pub?.cannotDecideBecause).toMatch(/validity date/);

    await expect(
      decidePublicProposal(token, { decision: "accept", byName: "Priya Menon" })
    ).rejects.toThrow(/no longer be accepted/);
  });
});

describe("view tracking", () => {
  it("records a view and moves SENT to VIEWED", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);

    const r = await recordProposalView(token, {
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      isOwnTeam: false,
    });
    expect(r.recorded).toBe(true);

    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    expect(after.state).toBe("VIEWED");
    expect(after.viewCount).toBe(1);
    expect(after.firstViewedAt).not.toBeNull();
  });

  it("does not count the seller's own visit", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);

    const r = await recordProposalView(token, {
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      isOwnTeam: true,
    });
    expect(r).toEqual({ recorded: false, reason: "own_team" });

    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    // Still SENT: buyer interest has not been demonstrated.
    expect(after.state).toBe("SENT");
    expect(after.viewCount).toBe(0);
  });

  it("collapses a burst from the same reader into one view", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);

    await recordProposalView(token, { ip: "203.0.113.7", userAgent: "x", isOwnTeam: false });
    const second = await recordProposalView(token, {
      ip: "203.0.113.7",
      userAgent: "x",
      isOwnTeam: false,
    });
    expect(second).toEqual({ recorded: false, reason: "duplicate_within_a_minute" });

    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    expect(after.viewCount).toBe(1);
  });

  it("counts a different reader separately", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);

    await recordProposalView(token, { ip: "203.0.113.7", userAgent: "x", isOwnTeam: false });
    await recordProposalView(token, { ip: "198.51.100.4", userAgent: "y", isOwnTeam: false });
    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    expect(after.viewCount).toBe(2);
  });

  it("never stores a raw IP address", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);
    await recordProposalView(token, {
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      isOwnTeam: false,
    });

    const view = await db.proposalView.findFirstOrThrow({ where: { proposalId: id } });
    expect(view.ipHash).not.toContain("203.0.113");
    expect(view.ipHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not downgrade a decided proposal back to VIEWED", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });

    await recordProposalView(token, { ip: "203.0.113.9", userAgent: "x", isOwnTeam: false });
    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    expect(after.state).toBe("ACCEPTED");
    // The view is still counted — they came back to re-read it.
    expect(after.viewCount).toBe(1);
  });

  it("shows the seller both the counter and the evidence behind it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);
    await recordProposalView(token, { ip: "203.0.113.7", userAgent: "x", isOwnTeam: false });

    const detail = await getProposal(ctx, id);
    expect(detail?.viewCount).toBe(1);
    expect(detail?.recordedViews).toBe(1);
    expect(detail?.views).toHaveLength(1);
  });
});

describe("a prospect deciding", () => {
  it("accepts, and records that the identity is unverified", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id, token } = await sentProposal(ctx, company.id);

    const result = await decidePublicProposal(token, {
      decision: "accept",
      byName: "Priya Menon",
    });
    expect(result.decision).toBe("accept");

    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    expect(after.state).toBe("ACCEPTED");
    expect(after.acceptedAt).not.toBeNull();

    const audit = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: "proposal.accepted_by_recipient" },
    });
    expect(audit.actorType).toBe("SYSTEM");
    expect(audit.actorUserId).toBeNull();
    expect(audit.source).toBe("INTEGRATION");
    expect(audit.actorLabel).toContain("claimed");
    expect((audit.after as Record<string, unknown>).identityVerified).toBe(false);
  });

  it("says in the activity detail that the name is not verified", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);
    await decidePublicProposal(token, { decision: "accept", byName: "Priya Menon" });

    const activity = await db.activity.findFirstOrThrow({
      where: { workspaceId: workspace.id, kind: "proposal.accepted" },
    });
    expect(activity.detail).toMatch(/not a verified identity/);
    expect(activity.actorType).toBe("SYSTEM");
  });

  it("notifies whoever is accountable for the proposal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);
    await decidePublicProposal(token, { decision: "accept", byName: "Priya Menon" });

    const notification = await db.notification.findFirstOrThrow({
      where: { workspaceId: workspace.id, kind: "PROPOSAL_ACCEPTED" },
    });
    expect(notification.userId).toBe(ctx.userId);
    expect(notification.body).toMatch(/not a verified identity/);
  });

  it("requires a name", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);
    await expect(
      decidePublicProposal(token, { decision: "accept", byName: "" })
    ).rejects.toThrow();
  });

  it("requires a reason to decline", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);
    await expect(
      decidePublicProposal(token, { decision: "decline", byName: "Priya Menon" })
    ).rejects.toThrow(/say briefly why/);
  });

  it("refuses a second decision from the link", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { token } = await sentProposal(ctx, company.id);
    await decidePublicProposal(token, { decision: "accept", byName: "Priya Menon" });
    await expect(
      decidePublicProposal(token, { decision: "decline", byName: "Someone Else", reason: "No" })
    ).rejects.toThrow(/already accepted/);
  });

  it("refuses on an unknown token without revealing anything", async () => {
    await expect(
      decidePublicProposal("0123456789abcdef0123456789abcdef", {
        decision: "accept",
        byName: "Priya Menon",
      })
    ).rejects.toThrow(/not available/);
  });
});

describe("listing", () => {
  it("shows a proposal as expired even before a sweep has run", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await db.proposal.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 86_400_000) },
    });

    const [listed] = await listProposals(ctx);
    expect(listed.state).toBe("EXPIRED");
    // And it is honest that the stored value has not changed yet.
    expect(listed.storedState).toBe("SENT");
  });

  it("gives a live proposal its customer link, and a draft none", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await createProposal(ctx, input({ companyId: company.id, title: "Still a draft" }));
    await sentProposal(ctx, company.id, { title: "Live one" });

    const listed = await listProposals(ctx);
    const draft = listed.find((p) => p.title === "Still a draft")!;
    const live = listed.find((p) => p.title === "Live one")!;
    expect(draft.publicPath).toBeNull();
    expect(live.publicPath).toMatch(/^\/p\/[0-9a-f]{32}$/);
  });

  it("surfaces a totals mismatch rather than hiding it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await db.proposal.update({ where: { id }, data: { taxInr: 1 } });

    const [listed] = await listProposals(ctx);
    expect(listed.totalsMismatch).not.toBeNull();
    expect(listed.totalsMismatch!.join(" ")).toContain("Tax");
  });

  it("hides another rep's proposal from a rep", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await createProposal(ctx, input({ companyId: company.id, leadId: lead.id }));
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    expect(await listProposals(ctx)).toHaveLength(1);
    expect(await listProposals(rep)).toHaveLength(0);
  });

  it("does not leak across workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { company } = await makeLead(b.workspace.id, { ownerId: b.ctx.userId });
    const { id } = await sentProposal(b.ctx, company.id);

    expect(await getProposal(a.ctx, id)).toBeNull();
    expect(await getProposal(b.ctx, id)).not.toBeNull();
  });
});

describe("deleting", () => {
  it("refuses to delete an accepted proposal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });
    await expect(deleteProposal(ctx, id)).rejects.toThrow(/record of an agreement/);
  });

  it("indexes the deletion for the recycle bin", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await deleteProposal(ctx, proposal.id);

    const record = await db.deletedRecord.findFirstOrThrow({
      where: { workspaceId: workspace.id, objectType: "Proposal", objectId: proposal.id },
    });
    expect(record.purgeAfter.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("the expiry sweep", () => {
  it("expires only what is past its date, and notifies the author", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const past = await sentProposal(ctx, company.id);
    const future = await sentProposal(ctx, company.id, { title: "Still live" });

    await db.proposal.update({
      where: { id: past.id },
      data: { validUntil: new Date(Date.now() - 2 * 86_400_000) },
    });
    await db.proposal.update({
      where: { id: future.id },
      data: { validUntil: new Date(Date.now() + 10 * 86_400_000) },
    });

    const result = await expireProposals(workspace.id);
    expect(result.expired).toBe(1);
    expect(result.notified).toBe(1);

    expect((await db.proposal.findUniqueOrThrow({ where: { id: past.id } })).state).toBe("EXPIRED");
    expect((await db.proposal.findUniqueOrThrow({ where: { id: future.id } })).state).toBe("SENT");
  });

  it("is idempotent", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await db.proposal.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 86_400_000) },
    });

    await expireProposals(workspace.id);
    const second = await expireProposals(workspace.id);
    expect(second.expired).toBe(0);
    // And it did not send a second notification.
    expect(
      await db.notification.count({ where: { workspaceId: workspace.id } })
    ).toBe(1);
  });

  it("never expires an accepted proposal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await recordProposalDecision(ctx, id, { decision: "accept" });
    await db.proposal.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 86_400_000) },
    });

    expect((await expireProposals(workspace.id)).expired).toBe(0);
    expect((await db.proposal.findUniqueOrThrow({ where: { id } })).state).toBe("ACCEPTED");
  });

  it("leaves a proposal with no validity date alone", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await sentProposal(ctx, company.id);
    expect((await expireProposals(workspace.id)).expired).toBe(0);
  });

  it("does not touch another workspace", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { company } = await makeLead(b.workspace.id, { ownerId: b.ctx.userId });
    const { id } = await sentProposal(b.ctx, company.id);
    await db.proposal.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 86_400_000) },
    });

    expect((await expireProposals(a.workspace.id)).expired).toBe(0);
    expect((await expireProposals(b.workspace.id)).expired).toBe(1);
  });
});

describe("the totals audit", () => {
  it("finds a corrupted total and raises it without rewriting the figures", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { id } = await sentProposal(ctx, company.id);
    await db.proposal.update({ where: { id }, data: { totalInr: 42 } });

    const result = await auditProposalTotals(workspace.id);
    expect(result.mismatched).toBe(1);
    expect(result.notified).toBe(1);

    // Deliberately unchanged: silently altering a price the customer has
    // already seen would be worse than the mismatch.
    const after = await db.proposal.findUniqueOrThrow({ where: { id } });
    expect(Number(after.totalInr)).toBe(42);

    const notification = await db.notification.findFirstOrThrow({
      where: { workspaceId: workspace.id, kind: "INTEGRATION_ERROR" },
    });
    expect(notification.severity).toBe("critical");
    expect(notification.body).toMatch(/have not been changed/);
  });

  it("passes a healthy set of proposals", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await sentProposal(ctx, company.id);
    await sentProposal(ctx, company.id, { title: "Second" });

    const result = await auditProposalTotals(workspace.id);
    expect(result.checked).toBe(2);
    expect(result.mismatched).toBe(0);
  });

  it("ignores drafts, which are still being written", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { proposal } = await createProposal(ctx, input({ companyId: company.id }));
    await db.proposal.update({ where: { id: proposal.id }, data: { totalInr: 1 } });

    expect((await auditProposalTotals(workspace.id)).checked).toBe(0);
  });
});
