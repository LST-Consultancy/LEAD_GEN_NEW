import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { findPeople, getPeopleFacets, listAccounts, lookUp } from "@/lib/services/people";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("People");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

/** A person at a company, optionally attached to a lead. */
async function makePerson(
  workspaceId: string,
  over: {
    name?: string;
    title?: string;
    seniority?: string;
    department?: string;
    decisionMaker?: boolean;
    companyName?: string;
    industry?: string;
    state?: string;
    intentScore?: number;
    linkedinUrl?: string;
  } = {}
) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const company = await db.company.create({
    data: {
      workspaceId,
      name: over.companyName ?? `Company ${suffix}`,
      domain: `c-${suffix}.example`,
      industry: over.industry ?? "Manufacturing",
      city: "Pune",
      state: over.state ?? "Maharashtra",
      employeeCount: 400,
      intentScore: over.intentScore ?? 0,
    },
  });
  const person = await db.person.create({
    data: {
      workspaceId,
      fullName: over.name ?? `Person ${suffix}`,
      linkedinUrl: over.linkedinUrl,
    },
  });
  await db.employment.create({
    data: {
      workspaceId,
      personId: person.id,
      companyId: company.id,
      title: over.title ?? "Head of IT",
      seniority: over.seniority ?? "head",
      department: over.department ?? "IT",
      isDecisionMaker: over.decisionMaker ?? false,
      isCurrent: true,
    },
  });
  return { person, company };
}

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("findPeople", () => {
  it("states that it searched only the workspace when nothing is connected", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id);

    const result = await findPeople(ctx);
    expect(result.externalSearchAvailable).toBe(false);
    expect(result.scope).toMatch(/No discovery source is connected/);
    expect(result.scope).toMatch(/cannot find people you do not already hold/);
  });

  it("matches on name, title or company", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, { name: "Priya Menon", companyName: "Vaitarna Steel" });
    await makePerson(workspace.id, { name: "Other Person", title: "CFO" });

    expect((await findPeople(ctx, { q: "Priya" })).rows).toHaveLength(1);
    expect((await findPeople(ctx, { q: "Vaitarna" })).rows).toHaveLength(1);
    expect((await findPeople(ctx, { q: "CFO" })).rows).toHaveLength(1);
  });

  it("filters by seniority, department and decision maker", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, { seniority: "c-level", department: "Finance", decisionMaker: true });
    await makePerson(workspace.id, { seniority: "manager", department: "IT" });

    expect((await findPeople(ctx, { seniority: ["c-level"] })).rows).toHaveLength(1);
    expect((await findPeople(ctx, { department: ["Finance"] })).rows).toHaveLength(1);
    expect((await findPeople(ctx, { decisionMakersOnly: true })).rows).toHaveLength(1);
  });

  it("filters by industry, state and company intent", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, { industry: "Fintech", state: "Karnataka", intentScore: 80 });
    await makePerson(workspace.id, { industry: "Manufacturing", state: "Maharashtra" });

    expect((await findPeople(ctx, { industry: ["Fintech"] })).rows).toHaveLength(1);
    expect((await findPeople(ctx, { state: ["Karnataka"] })).rows).toHaveLength(1);
    expect((await findPeople(ctx, { minIntent: 50 })).rows).toHaveLength(1);
  });

  it("separates people who are already leads from those who are not", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, { name: "Not a lead" });
    await makeLead(workspace.id, { ownerId: ctx.userId, name: "Is a lead" });

    const isLead = await findPeople(ctx, { attachment: "is_lead" });
    const notLead = await findPeople(ctx, { attachment: "not_lead" });
    expect(isLead.rows.map((r) => r.name)).toEqual(["Is a lead"]);
    expect(notLead.rows.map((r) => r.name)).toEqual(["Not a lead"]);
  });

  it("distinguishes revealed contacts from locked ones", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { person } = await makePerson(workspace.id, { name: "Has contacts" });
    await db.contactMethod.createMany({
      data: [
        {
          workspaceId: workspace.id,
          personId: person.id,
          kind: "WORK_EMAIL",
          value: "a@b.test",
          maskedValue: "a•••@b.test",
          isLocked: false,
          source: "test",
        },
        {
          workspaceId: workspace.id,
          personId: person.id,
          kind: "MOBILE",
          maskedValue: "9•••••1234",
          isLocked: true,
          source: "test",
        },
      ],
    });
    await makePerson(workspace.id, { name: "No contacts" });

    const revealed = await findPeople(ctx, { hasContact: "revealed" });
    const none = await findPeople(ctx, { hasContact: "none" });
    expect(revealed.rows.map((r) => r.name)).toEqual(["Has contacts"]);
    expect(revealed.rows[0].contacts).toMatchObject({ revealed: 1, locked: 1 });
    expect(none.rows.map((r) => r.name)).toEqual(["No contacts"]);
  });

  it("marks a person who opted out", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { person } = await makePerson(workspace.id, { name: "Opted out" });
    await db.contactMethod.create({
      data: {
        workspaceId: workspace.id,
        personId: person.id,
        kind: "WORK_EMAIL",
        value: "x@y.test",
        maskedValue: "x•••@y.test",
        isLocked: false,
        source: "test",
        optedOutAt: new Date(),
      },
    });

    const result = await findPeople(ctx);
    expect(result.rows[0].contacts.optedOut).toBe(true);
  });

  it("hides another rep's lead attachment", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId, name: "Owned" });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    const asOwner = await findPeople(ctx);
    const asRep = await findPeople(rep);
    expect(asOwner.rows[0].lead).not.toBeNull();
    // The person is still visible; their lead is not.
    expect(asRep.rows[0].lead).toBeNull();
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await makePerson(b.workspace.id);
    expect((await findPeople(a.ctx)).rows).toHaveLength(0);
    expect((await findPeople(b.ctx)).rows).toHaveLength(1);
  });
});

describe("facets", () => {
  it("draws the filter vocabulary from the data", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, { seniority: "c-level", department: "Finance", industry: "Fintech" });
    await makePerson(workspace.id, { seniority: "head", department: "IT", industry: "Manufacturing" });

    const facets = await getPeopleFacets(ctx);
    expect(facets.seniorities.map((s) => s.value).sort()).toEqual(["c-level", "head"]);
    expect(facets.departments.map((d) => d.value).sort()).toEqual(["Finance", "IT"]);
    expect(facets.industries.map((i) => i.value).sort()).toEqual(["Fintech", "Manufacturing"]);
  });

  it("omits nulls rather than offering an empty filter", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { person, company } = await makePerson(workspace.id);
    await db.employment.updateMany({
      where: { personId: person.id },
      data: { seniority: null, department: null },
    });
    await db.company.update({ where: { id: company.id }, data: { industry: null } });

    const facets = await getPeopleFacets(ctx);
    expect(facets.seniorities).toHaveLength(0);
    expect(facets.departments).toHaveLength(0);
    expect(facets.industries).toHaveLength(0);
  });
});

describe("listAccounts", () => {
  it("reports committee health, not just a member count", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company, person } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.committeeMember.create({
      data: {
        workspaceId: workspace.id,
        companyId: company.id,
        personId: person.id,
        role: "DECISION_MAKER",
        influence: 80,
        confirmedAt: new Date(),
      },
    });
    void lead;

    const [account] = await listAccounts(ctx);
    expect(account.committeeHealth).toMatchObject({
      mapped: 1,
      confirmed: 1,
      hasDecisionMaker: true,
      blockers: 0,
    });
  });

  it("flags a single-threaded account with an open deal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company, person } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.committeeMember.create({
      data: {
        workspaceId: workspace.id,
        companyId: company.id,
        personId: person.id,
        role: "CHAMPION",
        influence: 60,
      },
    });
    const pipeline = await db.pipeline.create({
      data: { workspaceId: workspace.id, name: "P", isDefault: true },
    });
    const stage = await db.pipelineStage.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        key: "q",
        name: "Qualify",
        sortOrder: 0,
        probability: 30,
      },
    });
    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        leadId: lead.id,
        companyId: company.id,
        title: "Deal",
        valueInr: 500_000,
        status: "OPEN",
      },
    });

    const [account] = await listAccounts(ctx);
    expect(account.committeeHealth.singleThreaded).toBe(true);
    expect(account.openValueInr).toBe(500_000);
  });

  it("does not call an account single-threaded with no open deal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company, person } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.committeeMember.create({
      data: {
        workspaceId: workspace.id,
        companyId: company.id,
        personId: person.id,
        role: "CHAMPION",
        influence: 60,
      },
    });
    const [account] = await listAccounts(ctx);
    expect(account.committeeHealth.singleThreaded).toBe(false);
  });

  it("marks an inferred committee member as unconfirmed", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company, person } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.committeeMember.create({
      data: {
        workspaceId: workspace.id,
        companyId: company.id,
        personId: person.id,
        role: "INFLUENCER",
        influence: 40,
      },
    });
    const [account] = await listAccounts(ctx);
    expect(account.committee[0].confirmed).toBe(false);
    expect(account.committeeHealth.confirmed).toBe(0);
  });

  it("hides another rep's leads from the account row", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    expect((await listAccounts(ctx))[0].leads).toHaveLength(1);
    expect((await listAccounts(rep))[0].leads).toHaveLength(0);
  });
});

describe("lookUp", () => {
  it("recognises a name, a domain and a LinkedIn URL", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, {
      name: "Priya Menon",
      companyName: "Vaitarna Steel",
      linkedinUrl: "https://linkedin.com/in/priya-menon",
    });

    expect((await lookUp(ctx, "Priya")).kind).toBe("name");
    expect((await lookUp(ctx, "vaitarna.example")).kind).toBe("domain");
    expect((await lookUp(ctx, "https://linkedin.com/in/priya-menon")).kind).toBe("url");
  });

  it("finds a person by LinkedIn URL", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makePerson(workspace.id, {
      name: "Priya Menon",
      linkedinUrl: "https://linkedin.com/in/priya-menon",
    });
    const result = await lookUp(ctx, "https://linkedin.com/in/priya-menon");
    expect(result.people.map((p) => p.name)).toEqual(["Priya Menon"]);
  });

  it("returns empty results rather than throwing for an unknown query", async () => {
    const { ctx } = await freshWorkspace();
    const result = await lookUp(ctx, "Nobody At All");
    expect(result.people).toEqual([]);
    expect(result.companies).toEqual([]);
  });

  it("refuses a query too short to mean anything", async () => {
    const { ctx } = await freshWorkspace();
    expect((await lookUp(ctx, "a")).kind).toBe("too_short");
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await makePerson(b.workspace.id, { name: "Theirs Person" });
    expect((await lookUp(a.ctx, "Theirs")).people).toHaveLength(0);
    expect((await lookUp(b.ctx, "Theirs")).people).toHaveLength(1);
  });
});
