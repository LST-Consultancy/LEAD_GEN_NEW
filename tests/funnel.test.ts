import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  createIcpProfile,
  updateIcpProfile,
  deleteIcpProfile,
  listIcpProfiles,
  previewIcpMatch,
} from "@/lib/services/icp";
import {
  createSearchPhrase,
  updateSearchPhrase,
  deleteSearchPhrase,
  listSearchPhrases,
  getPhraseVerdicts,
} from "@/lib/services/search-phrases";
import { importLeads, parseDelimited } from "@/lib/ingest/import";
import { MutationError } from "@/lib/services/mutate";
import { ForbiddenError } from "@/lib/auth/context";
import { SOURCES, hasIngestionSource, availableSources } from "@/lib/ingest/sources";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Funnel");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

const BASE_ICP = {
  name: "Test ICP",
  industries: ["Manufacturing"],
  locations: ["Maharashtra"],
  employeeMin: 100,
  employeeMax: 2000,
  buyerRoles: ["Head of IT"],
  seniorities: ["head"],
  technologies: [],
  pains: [],
  triggerEvents: [],
  exclusions: [],
};

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("ICP profiles", () => {
  it("makes the first profile primary automatically", async () => {
    const { ctx } = await freshWorkspace();
    const p = await createIcpProfile(ctx, BASE_ICP);
    expect(p.isPrimary).toBe(true);
  });

  it("moves primary rather than allowing two", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    await createIcpProfile(ctx, { ...BASE_ICP, name: "Second", isPrimary: true });

    const primaries = await db.icpProfile.count({
      where: { workspaceId: workspace.id, isPrimary: true, deletedAt: null },
    });
    expect(primaries).toBe(1);
  });

  it("rejects an impossible headcount range", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createIcpProfile(ctx, { ...BASE_ICP, employeeMin: 5000, employeeMax: 10 })
    ).rejects.toThrow(/larger than the maximum/);
  });

  it("rejects an industry that is also excluded", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createIcpProfile(ctx, { ...BASE_ICP, exclusions: ["manufacturing"] })
    ).rejects.toThrow(/both a target industry and an exclusion/);
  });

  it("queues a rescore on save and says how many leads are affected", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const profile = await createIcpProfile(ctx, BASE_ICP);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: profile.id } });

    const result = await updateIcpProfile(ctx, profile.id, {
      ...BASE_ICP,
      employeeMin: 500,
    });

    expect(result.affectedLeads).toBe(1);
    // The note must be truthful either way — queued or not.
    expect(result.rescoreNote).toMatch(/rescored|recomputed|stale/i);
  });

  it("records what changed in the audit trail", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const profile = await createIcpProfile(ctx, BASE_ICP);
    await updateIcpProfile(ctx, profile.id, { ...BASE_ICP, employeeMin: 750 });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: "icp.updated" },
    });
    expect((audit.before as Record<string, unknown>).employeeMin).toBe(100);
    expect((audit.after as Record<string, unknown>).employeeMin).toBe(750);
  });

  it("refuses to delete the only profile", async () => {
    const { ctx } = await freshWorkspace();
    const profile = await createIcpProfile(ctx, BASE_ICP);
    await expect(deleteIcpProfile(ctx, profile.id)).rejects.toThrow(/only ICP profile/);
  });

  it("refuses to delete a profile leads are scored against", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const first = await createIcpProfile(ctx, BASE_ICP);
    await createIcpProfile(ctx, { ...BASE_ICP, name: "Other" });
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: first.id } });

    await expect(deleteIcpProfile(ctx, first.id)).rejects.toThrow(/leads are scored against/);
  });

  it("hands primary to another profile when the primary is deleted", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const first = await createIcpProfile(ctx, BASE_ICP);
    await createIcpProfile(ctx, { ...BASE_ICP, name: "Backup" });

    await deleteIcpProfile(ctx, first.id);
    const primaries = await db.icpProfile.count({
      where: { workspaceId: workspace.id, isPrimary: true, deletedAt: null },
    });
    expect(primaries).toBe(1);
  });

  it("reports precision from real leads", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const profile = await createIcpProfile(ctx, BASE_ICP);
    for (const tier of ["A", "B", "C", "D"] as const) {
      const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier });
      await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: profile.id } });
    }

    const [listed] = await listIcpProfiles(ctx);
    expect(listed.stats.leadCount).toBe(4);
    // Two of four rate A or B.
    expect(listed.stats.precision).toBe(50);
  });

  it("blocks a sales rep from editing the ICP", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const profile = await createIcpProfile(ctx, BASE_ICP);
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    await expect(updateIcpProfile(rep, profile.id, BASE_ICP)).rejects.toThrow(ForbiddenError);
  });

  it("stays inside its own workspace", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const profile = await createIcpProfile(b.ctx, BASE_ICP);
    await expect(updateIcpProfile(a.ctx, profile.id, BASE_ICP)).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });
});

describe("previewIcpMatch", () => {
  it("does not treat technology as a filter", async () => {
    const { ctx, workspace } = await freshWorkspace();
    // makeLead creates a Manufacturing company with 400 employees, no tech.
    await makeLead(workspace.id, { ownerId: ctx.userId });

    const withoutTech = await previewIcpMatch(ctx, BASE_ICP);
    const withTech = await previewIcpMatch(ctx, { ...BASE_ICP, technologies: ["Salesforce"] });

    // Scoring treats technology overlap as a bonus, so the preview must too —
    // otherwise a valid definition appears to match nothing.
    expect(withTech.matching).toBe(withoutTech.matching);
    expect(withTech.matching).toBeGreaterThan(0);
    expect(withTech.techOverlap).toBe(0);
    expect(withTech.note).toMatch(/bonus in scoring, not a filter/);
  });

  it("narrows on headcount", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId });

    const wide = await previewIcpMatch(ctx, BASE_ICP);
    const narrow = await previewIcpMatch(ctx, { ...BASE_ICP, employeeMin: 5000 });
    expect(narrow.matching).toBeLessThan(wide.matching);
  });
});

describe("search phrases", () => {
  it("rejects the same phrase on the same source twice", async () => {
    const { ctx } = await freshWorkspace();
    await createSearchPhrase(ctx, {
      phrase: "looking for a Salesforce partner",
      sourceKind: "SOCIAL_PUBLIC",
      isActive: true,
      cadenceHours: 24,
      negativeKeywords: [],
    });
    await expect(
      createSearchPhrase(ctx, {
        phrase: "Looking For A Salesforce Partner",
        sourceKind: "SOCIAL_PUBLIC",
        isActive: true,
        cadenceHours: 24,
        negativeKeywords: [],
      })
    ).rejects.toThrow(/already watch that phrase/);
  });

  it("allows the same phrase on a different source", async () => {
    const { ctx } = await freshWorkspace();
    const base = {
      phrase: "hiring Salesforce administrator",
      isActive: true,
      cadenceHours: 24,
      negativeKeywords: [],
    };
    await createSearchPhrase(ctx, { ...base, sourceKind: "JOB_BOARD" });
    await expect(
      createSearchPhrase(ctx, { ...base, sourceKind: "SOCIAL_PUBLIC" })
    ).resolves.toBeDefined();
  });

  it("clears the next run when paused and reschedules on resume", async () => {
    const { ctx } = await freshWorkspace();
    const p = await createSearchPhrase(ctx, {
      phrase: "erp migration tender",
      sourceKind: "TENDER_PORTAL",
      isActive: true,
      cadenceHours: 12,
      negativeKeywords: [],
    });

    await updateSearchPhrase(ctx, p.id, { isActive: false });
    expect((await db.searchPhrase.findUniqueOrThrow({ where: { id: p.id } })).nextRunAt).toBeNull();

    await updateSearchPhrase(ctx, p.id, { isActive: true });
    expect(
      (await db.searchPhrase.findUniqueOrThrow({ where: { id: p.id } })).nextRunAt
    ).not.toBeNull();
  });

  it("keeps attribution when a phrase is removed", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const p = await createSearchPhrase(ctx, {
      phrase: "crm migration",
      sourceKind: "PUBLIC_WEB",
      isActive: true,
      cadenceHours: 24,
      negativeKeywords: [],
    });
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { sourcePhraseId: p.id } });

    const result = await deleteSearchPhrase(ctx, p.id);
    expect(result.note).toMatch(/keep their attribution/);
    // Historical revenue must not lose its origin.
    const stillAttributed = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stillAttributed.sourcePhraseId).toBe(p.id);
  });

  it("attributes won revenue to the phrase that produced the lead", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const p = await createSearchPhrase(ctx, {
      phrase: "published a tender",
      sourceKind: "TENDER_PORTAL",
      isActive: true,
      cadenceHours: 24,
      negativeKeywords: [],
    });
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A" });
    await db.lead.update({
      where: { id: lead.id },
      data: { sourcePhraseId: p.id, lastContactedAt: new Date(), repliedAt: new Date() },
    });

    const pipeline = await db.pipeline.create({
      data: { workspaceId: workspace.id, name: "P", isDefault: true },
    });
    const stage = await db.pipelineStage.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        key: "won",
        name: "Won",
        sortOrder: 0,
        isWon: true,
        probability: 100,
      },
    });
    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        leadId: lead.id,
        companyId: company.id,
        title: "Won deal",
        valueInr: 2_500_000,
        status: "WON",
        wonAt: new Date(),
      },
    });

    const [listed] = await listSearchPhrases(ctx);
    expect(listed.analytics.leads).toBe(1);
    expect(listed.analytics.tierA).toBe(1);
    expect(listed.analytics.wonCount).toBe(1);
    expect(listed.analytics.wonInr).toBe(2_500_000);
    expect(listed.analytics.replyRate).toBe(100);
  });

  it("withholds a verdict until there is enough data", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const p = await createSearchPhrase(ctx, {
      phrase: "too new to judge",
      sourceKind: "PUBLIC_WEB",
      isActive: true,
      cadenceHours: 24,
      negativeKeywords: [],
    });
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { sourcePhraseId: p.id } });

    const { verdicts } = await getPhraseVerdicts(ctx);
    const v = verdicts.find((x) => x.id === p.id);
    expect(v?.verdict).toBe("insufficient_data");
    expect(v?.note).toMatch(/too few to judge/);
  });

  it("does not compute a reply rate when nothing was sent", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const p = await createSearchPhrase(ctx, {
      phrase: "never contacted",
      sourceKind: "PUBLIC_WEB",
      isActive: true,
      cadenceHours: 24,
      negativeKeywords: [],
    });
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { sourcePhraseId: p.id } });

    const [listed] = await listSearchPhrases(ctx);
    // Null, not zero — "not measured" is different from "nobody replied".
    expect(listed.analytics.replyRate).toBeNull();
  });
});

describe("ingestion sources", () => {
  it("is honest about which sources actually work", () => {
    expect(hasIngestionSource()).toBe(false);
    // Manual import is the one that needs nothing external.
    expect(availableSources().map((s) => s.kind)).toEqual(["USER_MANUAL"]);
  });

  it("says what every unconfigured source would need", () => {
    for (const s of Object.values(SOURCES)) {
      expect(s.requires.length).toBeGreaterThan(10);
      expect(s.compliance.length).toBeGreaterThan(10);
    }
  });
});

describe("parseDelimited", () => {
  it("maps a header row by common aliases", () => {
    const { rows, detectedColumns } = parseDelimited(
      "Full Name,Company Name,Job Title,Email Address\nPriya Menon,Acme Ltd,Head of IT,priya@acme.example"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Priya Menon");
    expect(rows[0].companyName).toBe("Acme Ltd");
    expect(rows[0].title).toBe("Head of IT");
    expect(detectedColumns).toContain("email");
  });

  it("handles tabs as well as commas", () => {
    const { rows } = parseDelimited(
      "name\tcompany\nPriya Menon\tAcme Ltd"
    );
    expect(rows[0].companyName).toBe("Acme Ltd");
  });

  it("handles a quoted field containing the delimiter", () => {
    const { rows } = parseDelimited(
      'name,company,note\nPriya Menon,"Acme, Ltd","Met at expo, keen"'
    );
    expect(rows[0].companyName).toBe("Acme, Ltd");
    expect(rows[0].note).toBe("Met at expo, keen");
  });

  it("reports a bad row by line number and keeps the rest", () => {
    const { rows, errors } = parseDelimited(
      "name,company\nPriya Menon,Acme Ltd\n,Orphan Co\nRahul Shah,Beta Ltd"
    );
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });

  it("falls back to positional columns without a header", () => {
    const { rows } = parseDelimited("Priya Menon,Acme Ltd,Head of IT");
    expect(rows[0].fullName).toBe("Priya Menon");
    expect(rows[0].companyName).toBe("Acme Ltd");
  });

  it("returns nothing for empty input", () => {
    expect(parseDelimited("").rows).toEqual([]);
    expect(parseDelimited("   \n  ").rows).toEqual([]);
  });
});

describe("importLeads", () => {
  const csv =
    "name,company,title,email,city,industry,employees\n" +
    "Ritu Chandran,Vaitarna Works,Head of IT,ritu@vaitarna.example,Nashik,Manufacturing,540";

  it("refuses to import without an ICP, because the leads would be unscored", async () => {
    const { ctx } = await freshWorkspace();
    await expect(importLeads(ctx, { text: csv, sourceLabel: "List" })).rejects.toThrow(
      /Define an ICP first/
    );
  });

  it("creates the company, person, employment, contact and lead", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);

    const result = await importLeads(ctx, { text: csv, sourceLabel: "Expo list" });
    expect(result.imported).toBe(1);

    const company = await db.company.findFirstOrThrow({
      where: { workspaceId: workspace.id, name: "Vaitarna Works" },
    });
    expect(company.employeeCount).toBe(540);
    expect(company.industry).toBe("Manufacturing");

    const person = await db.person.findFirstOrThrow({
      where: { workspaceId: workspace.id, fullName: "Ritu Chandran" },
    });
    const employment = await db.employment.findFirstOrThrow({
      where: { personId: person.id, companyId: company.id },
    });
    expect(employment.title).toBe("Head of IT");
  });

  it("does not lock an imported contact, so no point is charged", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    await importLeads(ctx, { text: csv, sourceLabel: "Expo list" });

    const contact = await db.contactMethod.findFirstOrThrow({
      where: { workspaceId: workspace.id, kind: "WORK_EMAIL" },
    });
    expect(contact.isLocked).toBe(false);
    expect(contact.status).toBe("UNVERIFIED");
    expect(
      await db.pointLedger.count({ where: { workspaceId: workspace.id, type: "REVEAL" } })
    ).toBe(0);
  });

  it("leaves an imported lead cold, because there is no buying signal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    await importLeads(ctx, { text: csv, sourceLabel: "Expo list" });

    const lead = await db.lead.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(lead.intent).toBe("COLD");
    expect(lead.surfacedReason).toMatch(/not yet scored against a buying signal/);

    // The timeline records how it arrived rather than being empty.
    const signal = await db.signal.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(signal.sourceKind).toBe("USER_MANUAL");
    expect(signal.aiInterpretation).toMatch(/Imported rather than discovered/);
  });

  it("skips a duplicate instead of creating a second lead", async () => {
    const { ctx } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    await importLeads(ctx, { text: csv, sourceLabel: "First" });

    const second = await importLeads(ctx, { text: csv, sourceLabel: "Second" });
    expect(second.imported).toBe(0);
    expect(second.skipped[0].reason).toMatch(/Already a lead/);
  });

  it("attributes imported leads to their source label", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    await importLeads(ctx, { text: csv, sourceLabel: "Pune expo, Sept 2026" });

    const phrase = await db.searchPhrase.findFirstOrThrow({
      where: { workspaceId: workspace.id, sourceKind: "USER_MANUAL" },
    });
    expect(phrase.phrase).toBe("Pune expo, Sept 2026");
    // Not active: it is a provenance record, not something to re-run.
    expect(phrase.isActive).toBe(false);

    const lead = await db.lead.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(lead.sourcePhraseId).toBe(phrase.id);
  });

  it("reuses an existing company rather than duplicating it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    await importLeads(ctx, { text: csv, sourceLabel: "First" });
    await importLeads(ctx, {
      text:
        "name,company,title,email\nFarhan Qureshi,Vaitarna Works,CFO,farhan@vaitarna.example",
      sourceLabel: "Second",
    });

    expect(
      await db.company.count({ where: { workspaceId: workspace.id, name: "Vaitarna Works" } })
    ).toBe(1);
    expect(await db.lead.count({ where: { workspaceId: workspace.id } })).toBe(2);
  });

  it("rejects a batch that is too large to recover from", async () => {
    const { ctx } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    const huge =
      "name,company\n" +
      Array.from({ length: 501 }, (_, i) => `Person ${i},Company ${i}`).join("\n");
    await expect(importLeads(ctx, { text: huge, sourceLabel: "Huge" })).rejects.toThrow(
      MutationError
    );
  });

  it("requires the edit permission", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createIcpProfile(ctx, BASE_ICP);
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    await expect(importLeads(viewer, { text: csv, sourceLabel: "List" })).rejects.toThrow(
      ForbiddenError
    );
  });
});
