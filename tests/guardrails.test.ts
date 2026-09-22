import { describe, expect, it } from "vitest";
import {
  evaluate,
  guardsOf,
  describePolicy,
  type GuardContext,
  type AutopilotSettings,
  type AgentSettings,
  type ProposedAction,
} from "@/lib/autopilot/guardrails";

const AUTOPILOT: AutopilotSettings = {
  mode: "FULL_AUTO",
  maxLeadsPerDay: 20,
  maxRevealsPerDay: 5,
  maxPointsPerDay: 25,
  maxEmailsPerDay: 30,
  maxWhatsappPerDay: 10,
  maxLinkedinPerDay: 10,
  allowedTiers: ["A", "B"],
  minScore: 70,
  allowedIndustries: [],
  allowedLocations: [],
  allowedChannels: ["EMAIL"],
  sendWindowStart: 9,
  sendWindowEnd: 19,
  sendDays: [1, 2, 3, 4, 5],
  blockedDomains: [],
  blockedCompanies: [],
  approvalThresholdInr: 0,
  requireApprovalForSpend: false,
};

const AGENT: AgentSettings = {
  kind: "SDR",
  name: "SDR agent",
  isEnabled: true,
  tools: ["draft_outreach", "send_email", "unlock_contacts", "get_today"],
  approvalPolicy: "auto_within_budget",
  dailyPointBudget: 10,
  dailyActionCap: 20,
};

const LEAD: NonNullable<ProposedAction["lead"]> = {
  tier: "A",
  scoreOutOf100: 88,
  industry: "Manufacturing",
  location: "Maharashtra",
  companyName: "Vaitarna Steel Works",
  domain: "vaitarna.example",
  isSuppressed: false,
};

function ctx(over: {
  autopilot?: Partial<AutopilotSettings>;
  agent?: Partial<AgentSettings>;
  action?: Partial<ProposedAction>;
  usedToday?: Partial<GuardContext["usedToday"]>;
  tool?: GuardContext["tool"];
  providerReady?: boolean;
  localWeekday?: number;
  localHour?: number;
} = {}): GuardContext {
  return {
    autopilot: { ...AUTOPILOT, ...over.autopilot },
    agent: { ...AGENT, ...over.agent },
    action: {
      tool: "draft_outreach",
      riskClass: "WRITE",
      pointsCost: 0,
      ...over.action,
    },
    usedToday: {
      points: 0,
      actions: 0,
      emails: 0,
      whatsapp: 0,
      linkedin: 0,
      leads: 0,
      reveals: 0,
      ...over.usedToday,
    },
    tool: over.tool ?? { known: true, implemented: true },
    providerReady: over.providerReady ?? true,
    localWeekday: over.localWeekday ?? 3,
    localHour: over.localHour ?? 11,
  };
}

describe("READ actions", () => {
  it("are allowed even with autopilot off", () => {
    const v = evaluate(
      ctx({
        autopilot: { mode: "OFF" },
        action: { tool: "get_today", riskClass: "READ" },
      })
    );
    expect(v.disposition).toBe("allow");
  });

  it("ignore budgets, caps and send windows", () => {
    const v = evaluate(
      ctx({
        action: { tool: "get_today", riskClass: "READ" },
        usedToday: { actions: 999, points: 999, emails: 999 },
        localHour: 3,
        localWeekday: 7,
      })
    );
    expect(v.disposition).toBe("allow");
  });

  it("are still refused if the agent is off", () => {
    const v = evaluate(
      ctx({ agent: { isEnabled: false }, action: { tool: "get_today", riskClass: "READ" } })
    );
    expect(v.disposition).toBe("refuse");
    expect(v.headline?.code).toBe("agent_disabled");
  });
});

describe("autopilot mode", () => {
  it("refuses any write when off", () => {
    const v = evaluate(ctx({ autopilot: { mode: "OFF" } }));
    expect(v.disposition).toBe("refuse");
    expect(v.guards.map((g) => g.code)).toContain("autopilot_off");
  });

  it("holds every write for approval in review-first", () => {
    const v = evaluate(ctx({ autopilot: { mode: "REVIEW_FIRST" } }));
    expect(v.disposition).toBe("approve");
    expect(v.headline?.code).toBe("mode_requires_review");
    expect(v.headline?.message).toMatch(/a person approves every action/);
  });

  it("allows a clean write in full-auto", () => {
    expect(evaluate(ctx()).disposition).toBe("allow");
  });

  it("honours an agent set to review-first even in full-auto", () => {
    const v = evaluate(ctx({ agent: { approvalPolicy: "review_first" } }));
    expect(v.disposition).toBe("approve");
    expect(v.guards.map((g) => g.code)).toContain("policy_requires_review");
  });
});

describe("tool permission", () => {
  it("refuses a tool the agent is not granted", () => {
    const v = evaluate(ctx({ action: { tool: "update_deal", riskClass: "WRITE", pointsCost: 0 } }));
    expect(v.disposition).toBe("refuse");
    expect(v.guards.map((g) => g.code)).toContain("tool_not_granted");
  });

  it("refuses a tool the app does not define, and says to remove it", () => {
    const v = evaluate(
      ctx({
        agent: { tools: ["find_leads"] },
        action: { tool: "find_leads", riskClass: "WRITE", pointsCost: 0 },
        tool: { known: false, implemented: false },
      })
    );
    expect(v.disposition).toBe("refuse");
    const guard = v.guards.find((g) => g.code === "tool_unknown");
    expect(guard?.message).toMatch(/not a tool this app defines/);
    expect(guard?.message).toMatch(/Remove it from the agent/);
  });

  it("refuses a declared but unbuilt tool", () => {
    const v = evaluate(ctx({ tool: { known: true, implemented: false } }));
    expect(v.disposition).toBe("refuse");
    expect(v.guards.map((g) => g.code)).toContain("tool_not_implemented");
  });

  it("does not report both unknown and unimplemented for the same tool", () => {
    const v = evaluate(ctx({ tool: { known: false, implemented: false } }));
    const codes = v.guards.map((g) => g.code);
    expect(codes).toContain("tool_unknown");
    expect(codes).not.toContain("tool_not_implemented");
  });
});

describe("targeting", () => {
  it("refuses a suppressed lead above everything else", () => {
    const v = evaluate(
      ctx({
        action: { lead: { ...LEAD, isSuppressed: true } },
        usedToday: { actions: 999 },
        localHour: 3,
      })
    );
    expect(v.disposition).toBe("refuse");
    // Severity, not insertion order: the cap is not the reason to show.
    expect(v.headline?.code).toBe("lead_suppressed");
  });

  it("refuses a tier outside the remit", () => {
    const v = evaluate(ctx({ action: { lead: { ...LEAD, tier: "D" } } }));
    expect(v.guards.map((g) => g.code)).toContain("tier_not_allowed");
  });

  it("refuses a score below the minimum, naming both numbers", () => {
    const v = evaluate(ctx({ action: { lead: { ...LEAD, scoreOutOf100: 40 } } }));
    const g = v.guards.find((x) => x.code === "score_below_minimum");
    expect(g?.message).toContain("40");
    expect(g?.message).toContain("70");
  });

  it("ignores the industry list when it is empty", () => {
    const v = evaluate(ctx({ action: { lead: { ...LEAD, industry: null } } }));
    expect(v.guards.map((g) => g.code)).not.toContain("industry_not_allowed");
  });

  it("refuses an industry outside a non-empty list", () => {
    const v = evaluate(
      ctx({
        autopilot: { allowedIndustries: ["Manufacturing"] },
        action: { lead: { ...LEAD, industry: "Hospitality" } },
      })
    );
    expect(v.guards.map((g) => g.code)).toContain("industry_not_allowed");
  });

  it("refuses an unknown industry when a list is set", () => {
    const v = evaluate(
      ctx({
        autopilot: { allowedIndustries: ["Manufacturing"] },
        action: { lead: { ...LEAD, industry: null } },
      })
    );
    expect(v.guards.map((g) => g.code)).toContain("industry_not_allowed");
  });

  it("matches a blocked company case-insensitively", () => {
    const v = evaluate(
      ctx({ autopilot: { blockedCompanies: ["vaitarna steel works"] }, action: { lead: LEAD } })
    );
    expect(v.guards.map((g) => g.code)).toContain("company_blocked");
  });

  it("matches a blocked domain as a suffix", () => {
    const v = evaluate(
      ctx({
        autopilot: { blockedDomains: ["example"] },
        action: { lead: { ...LEAD, domain: "mail.vaitarna.example" } },
      })
    );
    expect(v.guards.map((g) => g.code)).toContain("domain_blocked");
  });

  it("does not block a domain that merely contains the string", () => {
    const v = evaluate(
      ctx({
        autopilot: { blockedDomains: ["acme.test"] },
        action: { lead: { ...LEAD, domain: "acme.test.co.in" } },
      })
    );
    expect(v.guards.map((g) => g.code)).not.toContain("domain_blocked");
  });

  it("skips all targeting when the action has no lead", () => {
    const v = evaluate(ctx({ action: { tool: "get_today", riskClass: "READ" } }));
    expect(v.disposition).toBe("allow");
  });
});

describe("spending", () => {
  it("allows a spend inside both budgets", () => {
    const v = evaluate(
      ctx({ action: { tool: "unlock_contacts", riskClass: "SPEND", pointsCost: 3 } })
    );
    expect(v.disposition).toBe("allow");
  });

  it("defers when the agent's own budget would be exceeded", () => {
    const v = evaluate(
      ctx({
        action: { tool: "unlock_contacts", riskClass: "SPEND", pointsCost: 5 },
        usedToday: { points: 8 },
      })
    );
    expect(v.disposition).toBe("defer");
    const g = v.guards.find((x) => x.code === "point_budget_exhausted");
    expect(g?.message).toContain("13");
    expect(g?.message).toContain("10");
  });

  it("defers when the workspace limit would be exceeded", () => {
    const v = evaluate(
      ctx({
        agent: { dailyPointBudget: 0 },
        action: { tool: "unlock_contacts", riskClass: "SPEND", pointsCost: 5 },
        usedToday: { points: 24 },
      })
    );
    expect(v.disposition).toBe("defer");
    expect(v.guards.some((g) => g.message.includes("workspace limit"))).toBe(true);
  });

  it("treats a zero agent budget as no agent-level limit", () => {
    const v = evaluate(
      ctx({
        agent: { dailyPointBudget: 0 },
        action: { tool: "unlock_contacts", riskClass: "SPEND", pointsCost: 5 },
      })
    );
    expect(v.disposition).toBe("allow");
  });

  it("requires approval for any spend when the workspace says so", () => {
    const v = evaluate(
      ctx({
        autopilot: { requireApprovalForSpend: true },
        action: { tool: "unlock_contacts", riskClass: "SPEND", pointsCost: 2 },
      })
    );
    expect(v.disposition).toBe("approve");
    expect(v.headline?.message).toMatch(/needs approval/);
  });

  it("does not check point budgets for a free action", () => {
    const v = evaluate(
      ctx({ autopilot: { requireApprovalForSpend: true }, usedToday: { points: 999 } })
    );
    expect(v.disposition).toBe("allow");
  });
});

describe("caps", () => {
  it("defers at the agent's action cap", () => {
    const v = evaluate(ctx({ usedToday: { actions: 20 } }));
    expect(v.disposition).toBe("defer");
    expect(v.guards.map((g) => g.code)).toContain("action_cap_reached");
  });

  it("treats a zero action cap as unlimited", () => {
    const v = evaluate(ctx({ agent: { dailyActionCap: 0 }, usedToday: { actions: 500 } }));
    expect(v.disposition).toBe("allow");
  });

  it("defers at a per-channel cap", () => {
    const v = evaluate(
      ctx({
        action: { tool: "send_email", riskClass: "EXTERNAL", pointsCost: 0, channel: "EMAIL" },
        usedToday: { emails: 30 },
      })
    );
    expect(v.disposition).toBe("defer");
    expect(v.guards.map((g) => g.code)).toContain("channel_cap_reached");
  });

  it("counts each channel separately", () => {
    const v = evaluate(
      ctx({
        autopilot: { allowedChannels: ["EMAIL", "WHATSAPP"] },
        action: { tool: "send_email", riskClass: "EXTERNAL", pointsCost: 0, channel: "EMAIL" },
        usedToday: { whatsapp: 10 },
      })
    );
    expect(v.disposition).toBe("allow");
  });
});

describe("external actions", () => {
  it("refuses a channel autopilot may not use", () => {
    const v = evaluate(
      ctx({
        action: { tool: "send_whatsapp", riskClass: "EXTERNAL", pointsCost: 0, channel: "WHATSAPP" },
        agent: { tools: ["send_whatsapp"] },
      })
    );
    expect(v.disposition).toBe("refuse");
    expect(v.guards.map((g) => g.code)).toContain("channel_not_allowed");
  });

  it("refuses when no provider is connected", () => {
    const v = evaluate(
      ctx({
        action: { tool: "send_email", riskClass: "EXTERNAL", pointsCost: 0, channel: "EMAIL" },
        providerReady: false,
      })
    );
    expect(v.disposition).toBe("refuse");
    expect(v.guards.map((g) => g.code)).toContain("no_provider");
  });

  it("defers outside the send window", () => {
    const v = evaluate(
      ctx({
        action: { tool: "send_email", riskClass: "EXTERNAL", pointsCost: 0, channel: "EMAIL" },
        localHour: 4,
      })
    );
    expect(v.disposition).toBe("defer");
    expect(v.guards.map((g) => g.code)).toContain("outside_send_window");
  });

  it("defers on a non-sending day", () => {
    const v = evaluate(
      ctx({
        action: { tool: "send_email", riskClass: "EXTERNAL", pointsCost: 0, channel: "EMAIL" },
        localWeekday: 7,
      })
    );
    const g = v.guards.find((x) => x.code === "outside_send_window");
    expect(g?.message).toMatch(/not a sending day/);
  });

  it("does not apply the send window to a WRITE action", () => {
    const v = evaluate(ctx({ localHour: 3, localWeekday: 7 }));
    expect(v.disposition).toBe("allow");
  });
});

describe("the money threshold", () => {
  it("requires approval at or above the threshold", () => {
    const v = evaluate(
      ctx({
        autopilot: { approvalThresholdInr: 500_000 },
        action: { tool: "draft_outreach", riskClass: "WRITE", pointsCost: 0, valueInr: 500_000 },
      })
    );
    expect(v.disposition).toBe("approve");
    const g = v.guards.find((x) => x.code === "value_over_threshold");
    expect(g?.message).toContain("5,00,000");
  });

  it("allows below the threshold", () => {
    const v = evaluate(
      ctx({
        autopilot: { approvalThresholdInr: 500_000 },
        action: { tool: "draft_outreach", riskClass: "WRITE", pointsCost: 0, valueInr: 499_999 },
      })
    );
    expect(v.disposition).toBe("allow");
  });

  it("ignores a zero threshold", () => {
    const v = evaluate(
      ctx({ action: { tool: "draft_outreach", riskClass: "WRITE", pointsCost: 0, valueInr: 9_999_999 } })
    );
    expect(v.disposition).toBe("allow");
  });
});

describe("severity ordering", () => {
  it("a refusal outranks an approval and a deferral", () => {
    const v = evaluate(
      ctx({
        autopilot: { mode: "REVIEW_FIRST" },
        action: { lead: { ...LEAD, tier: "D" } },
        usedToday: { actions: 999 },
      })
    );
    expect(v.disposition).toBe("refuse");
    expect(v.headline?.disposition).toBe("refuse");
  });

  it("an approval outranks a deferral", () => {
    const v = evaluate(
      ctx({ autopilot: { mode: "REVIEW_FIRST" }, usedToday: { actions: 999 } })
    );
    expect(v.disposition).toBe("approve");
  });

  it("groups guards by disposition for the UI", () => {
    const v = evaluate(
      ctx({
        autopilot: { mode: "REVIEW_FIRST" },
        action: { lead: { ...LEAD, tier: "D" } },
        usedToday: { actions: 999 },
      })
    );
    expect(guardsOf(v, "refuse")).toHaveLength(1);
    expect(guardsOf(v, "approve")).toHaveLength(1);
    expect(guardsOf(v, "defer")).toHaveLength(1);
  });
});

describe("describePolicy", () => {
  it("says agents cannot act when off", () => {
    const lines = describePolicy({ ...AUTOPILOT, mode: "OFF" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/cannot change or send anything/);
  });

  it("leads with the approval posture", () => {
    expect(describePolicy({ ...AUTOPILOT, mode: "REVIEW_FIRST" })[0]).toMatch(
      /waits for a person/
    );
    expect(describePolicy(AUTOPILOT)[0]).toMatch(/without asking/);
  });

  it("states the spend rule when it applies", () => {
    const lines = describePolicy({ ...AUTOPILOT, requireApprovalForSpend: true });
    expect(lines.join(" ")).toMatch(/costs points needs approval, even in full-auto/);
  });

  it("omits lists that are empty rather than saying 'none'", () => {
    const lines = describePolicy(AUTOPILOT).join(" ");
    expect(lines).not.toMatch(/industries/);
    expect(lines).not.toMatch(/Never /);
  });

  it("names blocked companies and domains together", () => {
    const lines = describePolicy({
      ...AUTOPILOT,
      blockedCompanies: ["Acme"],
      blockedDomains: ["rival.example"],
    }).join(" ");
    expect(lines).toMatch(/Never Acme, rival.example/);
  });
});
