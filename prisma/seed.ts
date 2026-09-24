/**
 * Demo seed. Deterministic: a fixed PRNG seed means every run produces the same
 * workspace, which keeps screenshots and tests stable.
 *
 * Scores are not hardcoded. Every lead is run through the real scoring engine
 * so the "Why 9/10?" panel shows genuine evidence rows derived from the same
 * signals the UI displays.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID, createHash } from "node:crypto";
import { scoreLead, DEFAULT_WEIGHTS, type ScoringSignal } from "../src/lib/scoring.js";
import { SYSTEM_ROLES } from "../src/lib/auth/permissions.js";
import { modelForProvider } from "../src/lib/ai/routing.js";
import { estimateCostInr } from "../src/lib/ai/pricing.js";
import {
  COMPANIES,
  FIRST_NAMES_F,
  FIRST_NAMES_M,
  LAST_NAMES,
  ROLE_TEMPLATES,
  SIGNAL_TEMPLATES,
  KNOWLEDGE_DOCS,
} from "./seed-data.js";
import { AGENT_CATALOGUE } from "../src/lib/autopilot/agent-catalogue.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

// --------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// --------------------------------------------------------------------------
let _state = 0x9e3779b9;
function rand(): number {
  _state |= 0;
  _state = (_state + 0x6d2b79f5) | 0;
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const pickN = <T>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
};
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;

const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
/**
 * Scatters a timestamp within the given day without ever landing in the future.
 * Plain `daysAgo(d - rand())` goes negative at d = 0, and a future-dated point
 * ledger row would be read as the head, corrupting the balance.
 */
const withinDay = (d: number) => daysAgo(Math.max(0, d) + rand() * 0.9);
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

const slugName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

async function main() {
  // The reset below deletes every workspace and user. Refuse when the target
  // holds anyone who is not a fixture (reserved .example/.invalid domains), so
  // pointing the seed at a working database cannot erase real customers.
  const real = await db.user.count({
    where: { NOT: [{ email: { endsWith: ".example" } }, { email: { endsWith: ".invalid" } }] },
  });
  if (real > 0 && process.env.SEED_ERASES_REAL_DATA !== "yes") {
    throw new Error(
      `Refusing to seed: this database has ${real} real account(s) and seeding deletes every workspace and user. ` +
        "Seed a separate database (npm run db:test:prepare), or set SEED_ERASES_REAL_DATA=yes if erasing it is intended."
    );
  }
  console.log("→ Resetting demo data");
  // Workspace cascade removes all tenant-owned rows; users and plans are global.
  await db.workspace.deleteMany({});
  await db.user.deleteMany({});
  await db.plan.deleteMany({});

  // ---------------------------------------------------------------- plans
  console.log("→ Plans");
  // `_scale` is created so the plan engine has a top tier to select, even
  // though the demo workspace sits on Growth.
  const [starter, growth, _scale] = await Promise.all([
    db.plan.create({
      data: {
        key: "starter",
        name: "Starter",
        description: "One seat, enough points to prove the motion works.",
        priceMonthly: 2499,
        priceYearly: 24990,
        seatsIncluded: 1,
        pointsMonthly: 300,
        sortOrder: 1,
        features: {
          autopilot: false,
          mcp: false,
          api: false,
          linkedinAddon: false,
          sequences: 1,
          researchPerMonth: 20,
          storageGb: 2,
        },
      },
    }),
    db.plan.create({
      data: {
        key: "growth",
        name: "Growth",
        description: "For a working sales team with Autopilot under review.",
        priceMonthly: 7999,
        priceYearly: 79990,
        seatsIncluded: 5,
        pointsMonthly: 1200,
        sortOrder: 2,
        features: {
          autopilot: true,
          autopilotModes: ["OFF", "REVIEW_FIRST"],
          mcp: true,
          api: true,
          linkedinAddon: false,
          sequences: 10,
          researchPerMonth: 150,
          storageGb: 25,
        },
      },
    }),
    db.plan.create({
      data: {
        key: "scale",
        name: "Scale",
        description: "Full autonomy, unlimited sequences, platform access.",
        priceMonthly: 19999,
        priceYearly: 199990,
        seatsIncluded: 15,
        pointsMonthly: 4000,
        sortOrder: 3,
        features: {
          autopilot: true,
          autopilotModes: ["OFF", "REVIEW_FIRST", "FULL_AUTO"],
          mcp: true,
          api: true,
          linkedinAddon: true,
          sequences: -1,
          researchPerMonth: -1,
          storageGb: 250,
        },
      },
    }),
  ]);

  // ---------------------------------------------------------------- users
  console.log("→ Users and workspace");
  const password = await bcrypt.hash("Signalroom123", 12);

  const team = [
    { name: "Rahul Deshpande", email: "rahul@northbridge.example", role: "owner", title: "Founder" },
    { name: "Priya Iyer", email: "priya@northbridge.example", role: "manager", title: "Sales Lead" },
    { name: "Arjun Nair", email: "arjun@northbridge.example", role: "sales_rep", title: "Account Executive" },
    { name: "Sneha Kulkarni", email: "sneha@northbridge.example", role: "sales_rep", title: "Account Executive" },
    { name: "Vikram Reddy", email: "vikram@northbridge.example", role: "researcher", title: "Research Analyst" },
  ];

  const users = await Promise.all(
    team.map((t) =>
      db.user.create({
        data: {
          name: t.name,
          email: t.email,
          passwordHash: password,
          emailVerified: daysAgo(120),
          lastLoginAt: hoursAgo(int(1, 30)),
          locale: "en-IN",
          timezone: "Asia/Kolkata",
        },
      })
    )
  );
  const [owner, manager, rep1, rep2, _researcher] = users;
  const sellers = [owner, manager, rep1, rep2];

  const workspace = await db.workspace.create({
    data: {
      name: "Northbridge Cloud",
      slug: "northbridge-cloud",
      website: "https://northbridge.example",
      industry: "IT Services",
      country: "IN",
      currency: "INR",
      timezone: "Asia/Kolkata",
      locale: "en-IN",
      gstin: "27AAECN1234F1Z5",
      autopilotMode: "REVIEW_FIRST",
      onboardedAt: daysAgo(118),
      archiveAfterDays: 45,
    },
  });

  const roles = await Promise.all(
    Object.entries(SYSTEM_ROLES).map(([key, def]) =>
      db.role.create({
        data: {
          workspaceId: workspace.id,
          key,
          name: def.name,
          description: def.description,
          isSystem: true,
          permissions: def.permissions,
        },
      })
    )
  );
  const roleByKey = new Map(roles.map((r) => [r.key, r]));

  await Promise.all(
    team.map((t, i) =>
      db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: users[i].id,
          roleId: roleByKey.get(t.role)!.id,
          title: t.title,
          isDefault: i === 0,
          joinedAt: daysAgo(118 - i * 6),
          dailyPointCap: t.role === "sales_rep" ? 30 : null,
        },
      })
    )
  );

  // A second workspace so the switcher is genuinely functional.
  const sideWorkspace = await db.workspace.create({
    data: {
      name: "Northbridge Labs (R&D)",
      slug: "northbridge-labs",
      industry: "IT Services",
      autopilotMode: "OFF",
      onboardedAt: daysAgo(30),
    },
  });
  const sideOwnerRole = await db.role.create({
    data: {
      workspaceId: sideWorkspace.id,
      key: "owner",
      name: SYSTEM_ROLES.owner.name,
      description: SYSTEM_ROLES.owner.description,
      isSystem: true,
      permissions: SYSTEM_ROLES.owner.permissions,
    },
  });
  await db.workspaceMember.create({
    data: {
      workspaceId: sideWorkspace.id,
      userId: owner.id,
      roleId: sideOwnerRole.id,
      title: "Founder",
      joinedAt: daysAgo(30),
    },
  });

  // ------------------------------------------------------- subscription & config
  await db.subscription.create({
    data: {
      workspaceId: workspace.id,
      planId: growth.id,
      status: "active",
      seats: 5,
      currentPeriodStart: daysAgo(12),
      currentPeriodEnd: daysAhead(18),
    },
  });
  await db.subscription.create({
    data: {
      workspaceId: sideWorkspace.id,
      planId: starter.id,
      status: "trialing",
      seats: 1,
      currentPeriodEnd: daysAhead(9),
      trialEndsAt: daysAhead(9),
    },
  });

  const icp = await db.icpProfile.create({
    data: {
      workspaceId: workspace.id,
      name: "Mid-market manufacturing & logistics",
      isPrimary: true,
      sellsDescription:
        "Salesforce and ERP implementation plus AI automation for Indian mid-market businesses that still run core operations on spreadsheets.",
      industries: ["Manufacturing", "Logistics", "Distribution", "Energy", "Healthcare"],
      locations: ["Maharashtra", "Gujarat", "Tamil Nadu", "Karnataka", "Telangana", "Pune", "Mumbai", "Chennai", "Bengaluru", "Ahmedabad", "Hyderabad"],
      employeeMin: 100,
      employeeMax: 2000,
      buyerRoles: ["CTO", "Head of IT", "IT Manager", "Director of Operations", "CFO", "Managing Director", "ERP Programme Manager", "Head of Digital Transformation"],
      seniorities: ["founder", "c-level", "vp", "director", "head", "manager"],
      technologies: ["SAP ECC", "Oracle NetSuite", "Tally", "Excel", "Salesforce", "Microsoft Dynamics NAV", "Oracle EBS", "Zoho CRM"],
      pains: ["manual reporting", "month-end close delays", "disconnected systems", "no pipeline visibility", "spreadsheet dependency"],
      triggerEvents: ["crm migration", "erp modernisation", "new plant", "salesforce administrator", "digital transformation", "series b", "ai automation"],
      exclusions: ["staffing", "cryptocurrency", "gambling"],
      rules: {
        minEmployeeCount: 100,
        requireDecisionMakerForTierA: true,
        note: "Tier A requires an identified decision maker and a signal under 14 days old.",
      },
    },
  });

  const secondaryIcp = await db.icpProfile.create({
    data: {
      workspaceId: workspace.id,
      name: "Funded SaaS — AI automation",
      industries: ["SaaS", "Fintech"],
      locations: ["Bengaluru", "Mumbai", "Delhi", "Karnataka", "Maharashtra"],
      employeeMin: 100,
      employeeMax: 600,
      buyerRoles: ["CTO", "VP Engineering", "Head of Digital Transformation"],
      seniorities: ["c-level", "vp", "head"],
      technologies: ["Salesforce", "AWS", "Snowflake", "Segment"],
      pains: ["manual order processing", "support backlog"],
      triggerEvents: ["series b", "ai automation", "funding"],
      exclusions: [],
    },
  });

  await db.scoringConfig.create({ data: { workspaceId: workspace.id } });

  await db.autopilotConfig.create({
    data: {
      workspaceId: workspace.id,
      mode: "REVIEW_FIRST",
      maxLeadsPerDay: 25,
      maxRevealsPerDay: 6,
      maxPointsPerDay: 30,
      maxEmailsPerDay: 40,
      maxWhatsappPerDay: 12,
      maxLinkedinPerDay: 15,
      allowedTiers: ["A", "B"],
      minScore: 68,
      allowedIndustries: ["Manufacturing", "Logistics", "Distribution", "Energy"],
      allowedLocations: ["Maharashtra", "Gujarat", "Tamil Nadu", "Karnataka", "Telangana"],
      allowedChannels: ["EMAIL"],
      sendWindowStart: 10,
      sendWindowEnd: 18,
      sendDays: [1, 2, 3, 4, 5],
      blockedDomains: ["aravallisteel.example"],
      blockedCompanies: [],
      approvalThresholdInr: 500000,
      requireApprovalForSpend: true,
    },
  });

  await db.featureFlag.createMany({
    data: [
      { workspaceId: workspace.id, key: "autopilot", isEnabled: true, rolloutPct: 100 },
      { workspaceId: workspace.id, key: "mission_control_layout", isEnabled: true, rolloutPct: 100 },
      { workspaceId: workspace.id, key: "linkedin_module", isEnabled: false, rolloutPct: 0 },
      { workspaceId: workspace.id, key: "whatsapp", isEnabled: false, rolloutPct: 0 },
      { workspaceId: workspace.id, key: "experimental_scoring", isEnabled: false, rolloutPct: 10 },
      { workspaceId: workspace.id, key: "agents", isEnabled: true, rolloutPct: 100 },
    ],
  });

  // ---------------------------------------------------------------- points
  console.log("→ Point ledger");
  let balance = 0;
  const ledger: {
    type: "PLAN_ALLOCATION" | "PURCHASE" | "REVEAL" | "RESEARCH" | "ADMIN_ADJUSTMENT" | "REFUND";
    delta: number;
    reason: string;
    createdAt: Date;
    actorUserId?: string;
  }[] = [
    { type: "PLAN_ALLOCATION", delta: 1200, reason: "Growth plan monthly allocation", createdAt: daysAgo(12) },
    { type: "PURCHASE", delta: 500, reason: "Top-up purchase — 500 points", createdAt: daysAgo(9) },
  ];
  // Roughly 40-45 points a day across five people — an active prospecting
  // motion. Low enough to be sustainable, high enough that runway matters.
  for (let d = 13; d >= 0; d--) {
    const reveals = int(20, 60);
    for (let i = 0; i < reveals; i++) {
      ledger.push({
        type: "REVEAL",
        delta: -1,
        reason: "Revealed verified contact details",
        createdAt: withinDay(d),
        actorUserId: pick(sellers).id,
      });
    }
    const research = int(0, 4);
    for (let i = 0; i < research; i++) {
      ledger.push({
        type: "RESEARCH",
        delta: -2,
        reason: "Deep research report",
        createdAt: withinDay(d),
        actorUserId: pick(sellers).id,
      });
    }
  }
  ledger.push({
    type: "REFUND",
    delta: 1,
    reason: "Refund: revealed email failed verification, no usable contact returned",
    createdAt: daysAgo(4),
  });
  ledger.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const entry of ledger) {
    balance += entry.delta;
    await db.pointLedger.create({
      data: {
        workspaceId: workspace.id,
        type: entry.type,
        delta: entry.delta,
        balanceAfter: balance,
        reason: entry.reason,
        actorType: entry.type === "PLAN_ALLOCATION" ? "SYSTEM" : "HUMAN",
        actorUserId: entry.actorUserId ?? null,
        createdAt: entry.createdAt,
        idempotencyKey: randomUUID(),
      },
    });
  }
  console.log(`   balance: ${balance} points`);

  // ---------------------------------------------------------------- companies
  console.log("→ Companies");
  const companies = [];
  for (const c of COMPANIES) {
    companies.push(
      await db.company.create({
        data: {
          workspaceId: workspace.id,
          name: c.name,
          legalName: `${c.name} Private Limited`,
          domain: c.domain,
          website: `https://${c.domain}`,
          linkedinUrl: `https://www.linkedin.com/company/${c.domain.split(".")[0]}`,
          description: c.description,
          industry: c.industry,
          subIndustry: c.subIndustry,
          employeeCount: c.employeeCount,
          employeeBand: bandFor(c.employeeCount),
          revenueBandInr: c.revenueBandInr,
          foundedYear: c.foundedYear,
          city: c.city,
          state: c.state,
          country: "India",
          technologies: c.technologies,
          tags: [c.industry.toLowerCase(), c.city.toLowerCase()],
          createdAt: daysAgo(int(20, 115)),
        },
      })
    );
  }

  // ------------------------------------------------------- people & employments
  console.log("→ People, employments and contact methods");
  type PersonBundle = {
    person: { id: string; fullName: string };
    company: (typeof companies)[number];
    role: (typeof ROLE_TEMPLATES)[number];
    contacts: { kind: string; status: string; isLocked: boolean; optedOut: boolean }[];
  };
  const bundles: PersonBundle[] = [];
  const usedNames = new Set<string>();

  for (const company of companies) {
    const headcount = int(3, 5);
    const roleSet = pickN(ROLE_TEMPLATES, headcount);
    for (const role of roleSet) {
      let first: string, last: string, full: string;
      do {
        const female = chance(0.38);
        first = female ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
        last = pick(LAST_NAMES);
        full = `${first} ${last}`;
      } while (usedNames.has(full));
      usedNames.add(full);

      const person = await db.person.create({
        data: {
          workspaceId: workspace.id,
          fullName: full,
          firstName: first,
          lastName: last,
          headline: `${role.title} at ${company.name}`,
          linkedinUrl: `https://www.linkedin.com/in/${slugName(full)}-${int(100, 999)}`,
          city: company.city,
          state: company.state,
          country: "India",
          languages: pickN(["English", "Hindi", "Marathi", "Tamil", "Telugu", "Gujarati"], int(1, 3)),
          createdAt: daysAgo(int(18, 112)),
        },
      });

      await db.employment.create({
        data: {
          workspaceId: workspace.id,
          personId: person.id,
          companyId: company.id,
          title: role.title,
          department: role.department,
          seniority: role.seniority,
          isDecisionMaker: role.isDecisionMaker,
          isCurrent: true,
          startedAt: daysAgo(int(200, 2600)),
        },
      });

      // Contact methods. Most start locked — a lead exists before you pay for
      // the means to contact them (§20).
      const revealed = chance(0.3);
      const emailValue = `${slugName(first)}.${slugName(last)}@${company.domain}`;
      const emailStatus = chance(0.62) ? "VERIFIED" : chance(0.6) ? "LIKELY" : "UNVERIFIED";
      const contacts: PersonBundle["contacts"] = [];

      await db.contactMethod.create({
        data: {
          workspaceId: workspace.id,
          personId: person.id,
          kind: "WORK_EMAIL",
          value: revealed ? emailValue : null,
          maskedValue: maskEmail(emailValue),
          isLocked: !revealed,
          isPrimary: true,
          status: emailStatus,
          confidence: emailStatus === "VERIFIED" ? int(88, 98) : emailStatus === "LIKELY" ? int(58, 76) : int(30, 52),
          source: "Licensed B2B dataset",
          verifiedAt: emailStatus === "VERIFIED" ? daysAgo(int(2, 40)) : null,
          revealedAt: revealed ? daysAgo(int(1, 30)) : null,
          revealedByUserId: revealed ? pick(sellers).id : null,
        },
      });
      contacts.push({ kind: "WORK_EMAIL", status: emailStatus, isLocked: !revealed, optedOut: false });

      if (chance(0.72)) {
        const mobile = `+91 ${int(70, 99)}${int(10000000, 99999999)}`.slice(0, 17);
        await db.contactMethod.create({
          data: {
            workspaceId: workspace.id,
            personId: person.id,
            kind: "MOBILE",
            value: revealed && chance(0.7) ? mobile : null,
            maskedValue: maskPhone(mobile),
            isLocked: !(revealed && chance(0.7)),
            status: chance(0.5) ? "VERIFIED" : "LIKELY",
            confidence: int(55, 92),
            source: "Licensed B2B dataset",
            verifiedAt: chance(0.5) ? daysAgo(int(3, 60)) : null,
          },
        });
        contacts.push({ kind: "MOBILE", status: "LIKELY", isLocked: !revealed, optedOut: false });
      }

      await db.contactMethod.create({
        data: {
          workspaceId: workspace.id,
          personId: person.id,
          kind: "LINKEDIN_URL",
          value: person.linkedinUrl,
          maskedValue: "linkedin.com/in/•••",
          isLocked: false,
          status: "LIKELY",
          confidence: 80,
          source: "Public profile",
        },
      });
      contacts.push({ kind: "LINKEDIN_URL", status: "LIKELY", isLocked: false, optedOut: false });

      bundles.push({ person, company, role, contacts });
    }
  }
  console.log(`   ${bundles.length} people across ${companies.length} companies`);

  // ---------------------------------------------------------------- search phrases
  console.log("→ Search phrases");
  const phraseDefs = [
    { phrase: "looking for Salesforce implementation partner", sourceKind: "SOCIAL_PUBLIC", ai: false },
    { phrase: "hiring Salesforce administrator", sourceKind: "JOB_BOARD", ai: false },
    { phrase: "ERP migration India manufacturing", sourceKind: "PUBLIC_WEB", ai: false },
    { phrase: "NetSuite implementation partner", sourceKind: "SOCIAL_PUBLIC", ai: true },
    { phrase: "month end close taking too long ERP", sourceKind: "SOCIAL_PUBLIC", ai: true },
    { phrase: "AI automation order processing", sourceKind: "SOCIAL_PUBLIC", ai: true },
    { phrase: "ERP modernisation tender", sourceKind: "TENDER_PORTAL", ai: false },
    { phrase: "new manufacturing plant announcement Gujarat", sourceKind: "NEWS", ai: true },
    { phrase: "CRM migration spreadsheet to Salesforce", sourceKind: "SOCIAL_PUBLIC", ai: true },
    { phrase: "Series B funding India SaaS", sourceKind: "NEWS", ai: false },
  ];
  const phrases = [];
  for (const p of phraseDefs) {
    phrases.push(
      await db.searchPhrase.create({
        data: {
          workspaceId: workspace.id,
          phrase: p.phrase,
          sourceKind: p.sourceKind as never,
          isActive: chance(0.85),
          cadenceHours: pick([6, 12, 24, 24, 48]),
          negativeKeywords: pickN(["internship", "training course", "certification", "resume", "salary"], int(0, 3)),
          createdByAi: p.ai,
          lastRunAt: hoursAgo(int(1, 30)),
          nextRunAt: hoursAgo(-int(1, 20)),
          createdAt: daysAgo(int(30, 110)),
        },
      })
    );
  }

  for (const phrase of phrases) {
    const runCount = int(6, 18);
    for (let i = runCount; i > 0; i--) {
      const found = int(0, 14);
      await db.searchRun.create({
        data: {
          workspaceId: workspace.id,
          searchPhraseId: phrase.id,
          state: chance(0.95) ? "SUCCEEDED" : "FAILED",
          signalsFound: found,
          leadsCreated: Math.floor(found * 0.4),
          duplicates: Math.floor(found * 0.25),
          errorMessage: null,
          startedAt: daysAgo(i * 2 + rand()),
          finishedAt: daysAgo(i * 2 + rand() - 0.01),
          idempotencyKey: randomUUID(),
        },
      });
    }
  }

  // ---------------------------------------------------------------- leads
  console.log("→ Signals, leads and scores");
  const leadTargets = bundles.filter(() => chance(0.94));
  const createdLeads: {
    id: string;
    displayScore: number;
    tier: string;
    intent: string;
    companyId: string;
    personId: string;
    ownerId: string;
    bundle: PersonBundle;
    composite: number;
    repliedAt: Date | null;
    status: string;
    estimatedBudgetInr: number | null;
    surfacedAt: Date;
    surfacedReason: string;
    signalCount: number;
  }[] = [];

  let signalTotal = 0;

  for (const bundle of leadTargets) {
    const { person, company, role } = bundle;

    // Signals for this person/company.
    const signalCount = chance(0.1) ? 0 : chance(0.45) ? int(2, 4) : int(1, 2);
    const templates = pickN(SIGNAL_TEMPLATES, signalCount);
    const scoringSignals: ScoringSignal[] = [];
    const signalRows = [];

    for (const t of templates) {
      const ageHours = chance(0.4) ? int(1, 48) : int(49, 30 * 24);
      const occurredAt = hoursAgo(ageHours);
      const dedupe = hash(`${person.id}-${t.type}-${t.title}`);
      const row = await db.signal.create({
        data: {
          workspaceId: workspace.id,
          personId: person.id,
          companyId: company.id,
          type: t.type as never,
          sourceKind: t.sourceKind as never,
          sourceName: t.sourceName,
          sourceUrl: `https://${company.domain}/signal/${dedupe.slice(0, 8)}`,
          title: t.title,
          excerpt: t.excerpt,
          aiInterpretation: t.interpretation,
          confidence: t.confidence,
          intentDelta: Math.round(t.confidence / 4),
          suggestedAction: t.suggestedAction,
          keywords: t.keywords,
          occurredAt,
          detectedAt: new Date(occurredAt.getTime() + int(20, 400) * 60_000),
          searchPhraseId: pick(phrases).id,
          dedupeHash: dedupe,
          createdAt: occurredAt,
        },
      });
      signalRows.push(row);
      signalTotal++;
      scoringSignals.push({
        id: row.id,
        type: t.type,
        occurredAt,
        confidence: t.confidence,
        keywords: t.keywords,
        excerpt: t.excerpt,
      });
    }

    // Engagement history.
    const outbound = chance(0.55) ? int(1, 5) : 0;
    const inbound = outbound > 0 && chance(0.32) ? int(1, 3) : 0;
    const repliedAt = inbound > 0 ? daysAgo(int(0, 12)) : null;
    const meetingsHeld = inbound > 0 && chance(0.4) ? int(1, 2) : 0;
    const proposalViews = meetingsHeld > 0 && chance(0.5) ? int(1, 7) : 0;
    const estimatedBudget = chance(0.55) ? int(4, 160) * 100_000 : null;

    const activeIcp =
      company.industry === "SaaS" || company.industry === "Fintech" ? secondaryIcp : icp;

    const result = scoreLead(
      {
        icp: {
          industries: activeIcp.industries,
          locations: activeIcp.locations,
          employeeMin: activeIcp.employeeMin,
          employeeMax: activeIcp.employeeMax,
          buyerRoles: activeIcp.buyerRoles,
          seniorities: activeIcp.seniorities,
          technologies: activeIcp.technologies,
          triggerEvents: activeIcp.triggerEvents,
          exclusions: activeIcp.exclusions,
        },
        company: {
          name: company.name,
          industry: company.industry,
          city: company.city,
          state: company.state,
          employeeCount: company.employeeCount,
          technologies: company.technologies,
        },
        role: {
          title: role.title,
          seniority: role.seniority,
          department: role.department,
          isDecisionMaker: role.isDecisionMaker,
        },
        signals: scoringSignals,
        contacts: bundle.contacts,
        engagement: {
          outboundCount: outbound,
          inboundCount: inbound,
          repliedAt,
          meetingsHeld,
          proposalViews,
        },
        budget: { estimatedInr: estimatedBudget },
        now: NOW,
      },
      DEFAULT_WEIGHTS
    );

    const status = repliedAt
      ? meetingsHeld > 0
        ? "QUALIFIED"
        : "REPLIED"
      : outbound > 0
        ? "CONTACTED"
        : result.composite >= 70
          ? "WORKING"
          : "NEW";

    const freshestSignal = signalRows.reduce<Date | null>(
      (acc, s) => (!acc || s.occurredAt > acc ? s.occurredAt : acc),
      null
    );
    const surfacedAt = freshestSignal ?? daysAgo(int(5, 60));
    // Name the strongest signal, not an arbitrary one — otherwise "Why they
    // surfaced" can cite a weak website change while the score is driven by a
    // published tender.
    const strongestSignal = [...signalRows].sort((a, b) => b.confidence - a.confidence)[0];
    const surfacedReason =
      strongestSignal?.title ??
      "Matched your ICP on industry, size and buyer role — no buying signal yet";

    const owner_ = pick(sellers);
    const lastActivity = repliedAt ?? (outbound > 0 ? daysAgo(int(0, 20)) : freshestSignal);

    const lead = await db.lead.create({
      data: {
        workspaceId: workspace.id,
        personId: person.id,
        companyId: company.id,
        icpProfileId: activeIcp.id,
        ownerId: owner_.id,
        status: status as never,
        tier: result.tier,
        intent: result.intent,
        isStarred: chance(0.12),
        isRevealed: bundle.contacts.some((c) => !c.isLocked && c.kind === "WORK_EMAIL"),
        estimatedBudgetInr: estimatedBudget,
        surfacedAt,
        surfacedReason,
        sourcePhraseId: pick(phrases).id,
        lastContactedAt: outbound > 0 ? daysAgo(int(0, 22)) : null,
        lastActivityAt: lastActivity,
        repliedAt,
        nextActionAt: chance(0.45) ? daysAhead(int(-3, 9)) : null,
        nextActionLabel: chance(0.45)
          ? pick([
              "Follow up on the migration question",
              "Send the manufacturing case study",
              "Call to confirm timeline",
              "Ask who owns the CRM decision",
              "Share proposal",
              "Check whether budget is approved",
            ])
          : null,
        archivedAt: !repliedAt && !freshestSignal && chance(0.25) ? daysAgo(int(46, 90)) : null,
        createdAt: surfacedAt,
      },
    });

    // Attach signals to the lead now that it exists.
    if (signalRows.length > 0) {
      await db.signal.updateMany({
        where: { id: { in: signalRows.map((s) => s.id) } },
        data: { leadId: lead.id },
      });
    }

    const score = await db.leadScore.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        fitScore: result.dimensions.fit,
        intentScore: result.dimensions.intent,
        urgencyScore: result.dimensions.urgency,
        authorityScore: result.dimensions.authority,
        budgetScore: result.dimensions.budget,
        reachabilityScore: result.dimensions.reachability,
        engagementScore: result.dimensions.engagement,
        recencyScore: result.dimensions.recency,
        composite: result.composite,
        displayScore: result.displayScore,
        computedAt: NOW,
        modelVersion: "v1",
      },
    });

    if (result.evidence.length > 0) {
      await db.leadScoreEvidence.createMany({
        data: result.evidence.map((e) => ({
          workspaceId: workspace.id,
          leadScoreId: score.id,
          dimension: e.dimension,
          points: e.points,
          label: e.label,
          detail: e.detail ?? null,
          signalId: e.signalId ?? null,
          sourceType: e.sourceType,
          sourceRef: e.sourceRef ?? null,
        })),
      });
    }

    // Deal readiness checklist (§25).
    await db.readinessItem.createMany({
      data: [
        {
          workspaceId: workspace.id,
          leadId: lead.id,
          code: "business_need",
          label: "Clear business need",
          state: result.dimensions.intent >= 40 ? "yes" : result.dimensions.intent >= 18 ? "unknown" : "no",
          evidence: signalRows[0]?.title ?? "No signal describing a need yet",
          sortOrder: 1,
        },
        {
          workspaceId: workspace.id,
          leadId: lead.id,
          code: "decision_maker",
          label: "Decision maker identified",
          state: role.isDecisionMaker ? "yes" : "unknown",
          evidence: `${role.title} — ${role.isDecisionMaker ? "holds purchase authority" : "influencer, not confirmed as decision maker"}`,
          sortOrder: 2,
        },
        {
          workspaceId: workspace.id,
          leadId: lead.id,
          code: "active_project",
          label: "Active project",
          state: result.dimensions.urgency >= 45 ? "yes" : result.dimensions.urgency >= 20 ? "unknown" : "no",
          evidence:
            result.dimensions.urgency >= 45
              ? "Signal language names a timeline or live evaluation"
              : "Nothing indicates a live, time-boxed project",
          sortOrder: 3,
        },
        {
          workspaceId: workspace.id,
          leadId: lead.id,
          code: "timeline",
          label: "Timeline mentioned",
          state: scoringSignals.some((s) =>
            s.keywords.some((k) => /quarter|deadline|month|asap|urgent/.test(k))
          )
            ? "yes"
            : "unknown",
          evidence: "Derived from signal language",
          sortOrder: 4,
        },
        {
          workspaceId: workspace.id,
          leadId: lead.id,
          code: "budget",
          label: "Budget confirmed",
          state: result.dimensions.budget >= 60 ? "yes" : result.dimensions.budget >= 25 ? "unknown" : "no",
          evidence:
            result.dimensions.budget >= 60
              ? "Budget indicators present in the record"
              : "No approved spend evident — worth a discovery question",
          sortOrder: 5,
        },
        {
          workspaceId: workspace.id,
          leadId: lead.id,
          code: "engagement",
          label: "Two-way engagement",
          state: inbound > 0 ? "yes" : outbound > 0 ? "no" : "unknown",
          evidence:
            inbound > 0
              ? `${inbound} inbound ${inbound === 1 ? "message" : "messages"} received`
              : outbound > 0
                ? `${outbound} sent, nothing back yet`
                : "No contact attempted",
          sortOrder: 6,
        },
      ],
    });

    createdLeads.push({
      id: lead.id,
      displayScore: Number(result.displayScore),
      tier: result.tier,
      intent: result.intent,
      companyId: company.id,
      personId: person.id,
      ownerId: owner_.id,
      bundle,
      composite: result.composite,
      repliedAt,
      status,
      estimatedBudgetInr: estimatedBudget,
      surfacedAt,
      surfacedReason,
      signalCount: signalRows.length,
    });
  }

  console.log(`   ${createdLeads.length} leads, ${signalTotal} signals`);

  // Company intent scores roll up from their leads.
  for (const company of companies) {
    const leads = createdLeads.filter((l) => l.companyId === company.id);
    if (leads.length === 0) continue;
    const top = Math.max(...leads.map((l) => l.composite));
    const avg = leads.reduce((a, l) => a + l.composite, 0) / leads.length;
    const rolled = Math.round(top * 0.6 + avg * 0.4);
    const lastSignal = await db.signal.findFirst({
      where: { workspaceId: workspace.id, companyId: company.id },
      orderBy: { occurredAt: "desc" },
    });
    await db.company.update({
      where: { id: company.id },
      data: {
        intentScore: rolled,
        lastSignalAt: lastSignal?.occurredAt ?? null,
        intentScoreReason: {
          method: "0.6 × strongest lead + 0.4 × average lead score",
          strongestLeadScore: top,
          averageLeadScore: Math.round(avg),
          leadsConsidered: leads.length,
          note: "Account intent is derived from scored leads at this company, never from the company record alone.",
        },
      },
    });
  }

  // ------------------------------------------------------- buying committee
  console.log("→ Buying committees");
  const committeeRoles = ["CHAMPION", "DECISION_MAKER", "INFLUENCER", "TECHNICAL_EVALUATOR", "FINANCE", "PROCUREMENT", "BLOCKER"];
  for (const company of companies.slice(0, 18)) {
    const members = bundles.filter((b) => b.company.id === company.id);
    for (const m of members) {
      if (!chance(0.7)) continue;
      const role = m.role.isDecisionMaker
        ? pick(["DECISION_MAKER", "CHAMPION"])
        : pick(committeeRoles);
      await db.committeeMember.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          personId: m.person.id,
          role: role as never,
          isAiSuggested: chance(0.7),
          confirmedAt: chance(0.35) ? daysAgo(int(1, 30)) : null,
          influence: m.role.isDecisionMaker ? int(70, 95) : int(25, 70),
          sentiment: pick(["positive", "neutral", "neutral", "unknown", "sceptical"]),
          note: chance(0.3) ? "Role suggested from title and signal context. Confirm before relying on it." : null,
        },
      });
    }
  }

  // ---------------------------------------------------------------- pipeline
  console.log("→ Pipeline and deals");
  const pipeline = await db.pipeline.create({
    data: { workspaceId: workspace.id, name: "New business", isDefault: true },
  });

  const stageDefs = [
    { key: "new", name: "New", probability: 5, stallAfterDays: 5 },
    { key: "contacted", name: "Contacted", probability: 10, stallAfterDays: 7 },
    { key: "replied", name: "Replied", probability: 20, stallAfterDays: 5 },
    { key: "qualified", name: "Qualified", probability: 35, stallAfterDays: 10 },
    { key: "meeting", name: "Meeting", probability: 50, stallAfterDays: 12 },
    { key: "proposal_sent", name: "Proposal Sent", probability: 65, stallAfterDays: 10 },
    { key: "negotiation", name: "Negotiation", probability: 80, stallAfterDays: 14 },
    { key: "won", name: "Won", probability: 100, isWon: true, stallAfterDays: 9999 },
    { key: "lost", name: "Lost", probability: 0, isLost: true, stallAfterDays: 9999 },
  ];
  const stages = [];
  for (let i = 0; i < stageDefs.length; i++) {
    const s = stageDefs[i];
    stages.push(
      await db.pipelineStage.create({
        data: {
          workspaceId: workspace.id,
          pipelineId: pipeline.id,
          key: s.key,
          name: s.name,
          sortOrder: i,
          probability: s.probability,
          isWon: s.isWon ?? false,
          isLost: s.isLost ?? false,
          stallAfterDays: s.stallAfterDays,
        },
      })
    );
  }
  const stageByKey = new Map(stages.map((s) => [s.key, s]));

  // Deals come from the strongest leads, distributed across stages.
  const dealCandidates = [...createdLeads]
    .sort((a, b) => b.composite - a.composite)
    .filter((l) => l.composite >= 45)
    .slice(0, 40);

  // Early stages hold more, smaller deals; late stages hold fewer, larger ones.
  const stagePlan: [stage: string, count: number, valueScale: number][] = [
    ["new", 4, 0.45],
    ["contacted", 5, 0.5],
    ["replied", 4, 0.65],
    ["qualified", 5, 0.8],
    ["meeting", 4, 1],
    ["proposal_sent", 4, 1.1],
    ["negotiation", 3, 1.2],
    ["won", 3, 1],
    ["lost", 2, 0.9],
  ];

  const deals = [];
  let ci = 0;
  for (const [stageKey, count, valueScale] of stagePlan) {
    for (let i = 0; i < count && ci < dealCandidates.length; i++, ci++) {
      const lead = dealCandidates[ci];
      const stage = stageByKey.get(stageKey)!;
      const company = companies.find((c) => c.id === lead.companyId)!;
      const rawValue = lead.estimatedBudgetInr ?? int(6, 90) * 100_000;
      const value = Math.round((rawValue * valueScale) / 50_000) * 50_000;
      // A fifth of deals are brand new, so the "added this week" figure is live.
      const ageDays = chance(0.2) ? int(1, 6) : int(7, 70);
      // Draw stage age relative to this stage's own threshold: most deals are
      // healthy, roughly a quarter have genuinely overrun. A board where
      // everything is flagged tells you nothing.
      const threshold = stage.stallAfterDays;
      const stageAge = Math.min(
        ageDays,
        chance(0.72) ? int(1, Math.max(1, threshold - 1)) : int(threshold + 1, threshold + 12)
      );
      const won = stage.isWon;
      const lost = stage.isLost;

      const deal = await db.deal.create({
        data: {
          workspaceId: workspace.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          leadId: lead.id,
          companyId: company.id,
          ownerId: lead.ownerId,
          title: `${company.name} — ${pick(["Salesforce implementation", "ERP migration", "Sales Cloud rollout", "NetSuite consolidation", "AI order automation", "CRM modernisation"])}`,
          valueInr: value,
          status: won ? "WON" : lost ? "LOST" : "OPEN",
          repForecast: won ? "commit" : pick(["pipeline", "best_case", "commit", null]),
          confidence: won ? 100 : lost ? 0 : Math.max(2, Math.min(95, stage.probability + int(-12, 12))),
          sortOrder: i,
          expectedCloseAt: won || lost ? null : daysAhead(int(-8, 60)),
          stageEnteredAt: daysAgo(stageAge),
          // Never claim a deal has been silent longer than its lead has been
          // quiet — the two panels sit side by side in the dossier.
          lastActivityAt: (() => {
            const drawn = chance(0.75) ? daysAgo(int(0, 24)) : daysAgo(int(25, 45));
            const leadActivity = lead.bundle ? lastActivityFor(lead) : null;
            return leadActivity && leadActivity > drawn ? leadActivity : drawn;
          })(),
          nextActionAt: won || lost ? null : chance(0.7) ? daysAhead(int(-4, 8)) : null,
          nextActionLabel:
            won || lost
              ? null
              : chance(0.7)
                ? pick([
                    "Send revised commercials",
                    "Confirm go-live date",
                    "Get procurement on a call",
                    "Follow up on proposal",
                    "Share integration architecture",
                  ])
                : null,
          wonAt: won ? daysAgo(int(1, 25)) : null,
          lostAt: lost ? daysAgo(int(2, 30)) : null,
          lostReason: lost
            ? pick([
                "Chose a larger systems integrator on perceived delivery risk",
                "Budget deferred to next financial year",
                "Went with an in-house build",
              ])
            : null,
          source: pick(["Search phrase", "Public signal", "Referral", "Inbound"]),
          createdAt: daysAgo(ageDays),
        },
      });
      deals.push({ deal, stageKey, lead, company });

      // Stage history walks forward through the funnel.
      const path = stageDefs.slice(0, stageDefs.findIndex((s) => s.key === stageKey) + 1);
      let cursor = daysAgo(ageDays);
      let prev: string | null = null;
      for (const step of path) {
        if (step.key === "lost" && stageKey !== "lost") continue;
        const target = stageByKey.get(step.key)!;
        const dwell = int(1, Math.max(2, Math.floor(ageDays / path.length)));
        await db.dealStageHistory.create({
          data: {
            workspaceId: workspace.id,
            dealId: deal.id,
            fromStageId: prev,
            toStageId: target.id,
            valueAtMove: value,
            daysInStage: dwell,
            actorType: chance(0.85) ? "HUMAN" : "AI",
            actorUserId: chance(0.85) ? lead.ownerId : null,
            createdAt: cursor,
          },
        });
        prev = target.id;
        cursor = new Date(cursor.getTime() + dwell * 86_400_000);
      }

      // Money tracker, for won deals only.
      if (won) {
        await db.moneyEntry.createMany({
          data: [
            { workspaceId: workspace.id, dealId: deal.id, kind: "quoted", amountInr: value, createdAt: daysAgo(30) },
            {
              workspaceId: workspace.id,
              dealId: deal.id,
              kind: "invoiced",
              amountInr: Math.round(value * 0.3),
              reference: `INV-${int(1000, 9999)}`,
              dueAt: daysAhead(int(-10, 20)),
              createdAt: daysAgo(int(1, 20)),
            },
            ...(chance(0.6)
              ? [
                  {
                    workspaceId: workspace.id,
                    dealId: deal.id,
                    kind: "collected",
                    amountInr: Math.round(value * 0.3),
                    settledAt: daysAgo(int(1, 12)),
                    createdAt: daysAgo(int(1, 12)),
                  },
                ]
              : []),
          ],
        });
      }
    }
  }
  console.log(`   ${deals.length} deals`);

  // ---------------------------------------------------------------- deal risks
  console.log("→ Deal risks");
  for (const { deal, stageKey } of deals) {
    if (deal.status !== "OPEN") continue;
    const stage = stageByKey.get(stageKey)!;
    const stageAgeDays = Math.floor((NOW.getTime() - deal.stageEnteredAt.getTime()) / 86_400_000);
    const inactiveDays = deal.lastActivityAt
      ? Math.floor((NOW.getTime() - deal.lastActivityAt.getTime()) / 86_400_000)
      : 99;

    if (stageAgeDays > stage.stallAfterDays) {
      await db.dealRisk.create({
        data: {
          workspaceId: workspace.id,
          dealId: deal.id,
          code: "stage_stalled",
          severity: stageAgeDays > stage.stallAfterDays * 2.5 ? "high" : "medium",
          title: `Stuck in ${stage.name} for ${stageAgeDays} days`,
          explanation: `Deals at this stage normally move within ${stage.stallAfterDays} days. This one has been here ${stageAgeDays}, which historically correlates with a lower close rate.`,
          evidence: { stageEnteredAt: deal.stageEnteredAt, stageThresholdDays: stage.stallAfterDays, actualDays: stageAgeDays },
          suggestedAction: "Agree a specific next step with a date, or move it to Lost and free up your attention.",
          detectedAt: hoursAgo(int(1, 20)),
        },
      });
    }
    // A missing next step only matters once a deal is being actively worked.
    const midOrLateStage = stage.probability >= 20;
    if (!deal.nextActionAt && midOrLateStage) {
      await db.dealRisk.create({
        data: {
          workspaceId: workspace.id,
          dealId: deal.id,
          code: "no_next_action",
          severity: "medium",
          title: "No next action scheduled",
          explanation:
            "Nothing is booked to move this deal forward. Open deals without a next step are the single largest source of silent pipeline loss.",
          evidence: { nextActionAt: null },
          suggestedAction: "Add a dated next step, even if it is just a check-in call.",
          detectedAt: hoursAgo(int(1, 30)),
        },
      });
    }
    if (inactiveDays > 21) {
      await db.dealRisk.create({
        data: {
          workspaceId: workspace.id,
          dealId: deal.id,
          code: "inactive",
          severity: inactiveDays > 35 ? "high" : "medium",
          title: `No activity for ${inactiveDays} days`,
          explanation: `The last recorded interaction was ${inactiveDays} days ago. Nothing has been sent or received since.`,
          evidence: { lastActivityAt: deal.lastActivityAt, inactiveDays },
          suggestedAction: "Re-open the conversation with new information rather than a bare follow-up.",
          detectedAt: hoursAgo(int(1, 40)),
        },
      });
    }
  }

  // ---------------------------------------------------------------- conversations
  console.log("→ Conversations and messages");
  const repliedLeads = createdLeads.filter((l) => l.repliedAt);
  const contactedLeads = createdLeads.filter((l) => l.status === "CONTACTED").slice(0, 20);

  for (const lead of [...repliedLeads, ...contactedLeads]) {
    const person = lead.bundle.person;
    const company = lead.bundle.company;
    const hasReply = !!lead.repliedAt;
    const state = hasReply ? (chance(0.6) ? "NEEDS_YOU" : "OPEN") : "WAITING";
    const startedAt = daysAgo(int(4, 26));

    const conversation = await db.conversation.create({
      data: {
        workspaceId: workspace.id,
        channel: "EMAIL",
        subject: pick([
          `${company.name} — CRM rollout`,
          "Quick question about your ERP migration",
          "Following up on your Salesforce post",
          `Salesforce implementation for ${company.name}`,
        ]),
        state: state as never,
        leadId: lead.id,
        companyId: company.id,
        assigneeId: lead.ownerId,
        isUnread: hasReply && chance(0.6),
        aiSummary: hasReply
          ? "They confirmed an active evaluation and asked for indicative commercials plus one comparable reference. No decision date given yet."
          : "Two outbound messages sent, no response. Opened once.",
        sentiment: hasReply ? pick(["positive", "neutral", "positive"]) : null,
        lastMessageAt: lead.repliedAt ?? daysAgo(int(2, 14)),
        createdAt: startedAt,
      },
    });

    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "SENT",
        fromAddress: "rahul@northbridge.example",
        toAddress: `${slugName(person.fullName)}@${company.domain}`,
        subject: conversation.subject,
        body: `Hi ${person.fullName.split(" ")[0]},\n\nSaw that ${company.name} is looking at ${pick(["a Salesforce rollout", "ERP modernisation", "CRM migration"])}. We did a comparable project for a ${(company.industry ?? "business").toLowerCase()} business of similar size — 11 weeks, fixed scope for phase one.\n\nWorth 20 minutes to see whether the same shape fits you?\n\nRahul`,
        actorType: "HUMAN",
        actorUserId: lead.ownerId,
        sentAt: startedAt,
        deliveredAt: new Date(startedAt.getTime() + 60_000),
        readAt: chance(0.7) ? new Date(startedAt.getTime() + int(20, 900) * 60_000) : null,
        createdAt: startedAt,
      },
    });

    if (hasReply) {
      const replyAt = lead.repliedAt!;
      await db.message.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          channel: "EMAIL",
          state: "REPLIED",
          fromAddress: `${slugName(person.fullName)}@${company.domain}`,
          toAddress: "rahul@northbridge.example",
          subject: `Re: ${conversation.subject}`,
          body: pick([
            `Hi Rahul,\n\nTimely — we are evaluating options now. Can you send indicative commercials for phase one and one reference we can actually speak to?\n\n${person.fullName.split(" ")[0]}`,
            `Rahul,\n\nInterested, though budget sign-off sits with our CFO. Send something I can forward internally.\n\nThanks,\n${person.fullName.split(" ")[0]}`,
            `Thanks for reaching out. We are mid-evaluation with two other vendors. What would make you different on a project this size?\n\n${person.fullName.split(" ")[0]}`,
          ]),
          actorType: "HUMAN",
          sentAt: replyAt,
          deliveredAt: replyAt,
          readAt: chance(0.5) ? new Date(replyAt.getTime() + 3_600_000) : null,
          createdAt: replyAt,
        },
      });

      // A held AI draft reply, waiting on approval.
      if (chance(0.5)) {
        await db.message.create({
          data: {
            workspaceId: workspace.id,
            conversationId: conversation.id,
            direction: "OUTBOUND",
            channel: "EMAIL",
            state: "PENDING_APPROVAL",
            fromAddress: "rahul@northbridge.example",
            toAddress: `${slugName(person.fullName)}@${company.domain}`,
            subject: `Re: ${conversation.subject}`,
            body: `Hi ${person.fullName.split(" ")[0]},\n\nAttaching indicative commercials for phase one and a reference from a ${(company.industry ?? "business").toLowerCase()} business of comparable size.\n\nOne question so the numbers are useful rather than generic: how many users would be in scope for the first release?\n\nRahul`,
            actorType: "AI",
            generatedByAi: true,
            aiModel: "draft-pending-provider-config",
            createdAt: new Date(replyAt.getTime() + 1_800_000),
          },
        });
      }
    } else {
      await db.message.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          channel: "EMAIL",
          state: "SENT",
          fromAddress: "rahul@northbridge.example",
          toAddress: `${slugName(person.fullName)}@${company.domain}`,
          subject: `Re: ${conversation.subject}`,
          body: `Hi ${person.fullName.split(" ")[0]},\n\nBumping this once in case it got buried. If the timing is wrong, tell me and I'll stop.\n\nRahul`,
          actorType: "HUMAN",
          actorUserId: lead.ownerId,
          sentAt: daysAgo(int(2, 10)),
          deliveredAt: daysAgo(int(2, 10)),
          createdAt: daysAgo(int(2, 10)),
        },
      });
    }
  }

  // ---------------------------------------------------------------- sequences
  console.log("→ Sequences");
  const sequence = await db.sequence.create({
    data: {
      workspaceId: workspace.id,
      name: "Manufacturing — ERP modernisation",
      description:
        "Five touches over 14 days for manufacturing leads showing ERP pain. Stops the moment they reply.",
      isActive: true,
      stopOnReply: true,
      stopOnUnsubscribe: true,
      sendWindowStart: 10,
      sendWindowEnd: 18,
      sendDays: [1, 2, 3, 4, 5],
      dailyCap: 40,
      createdById: manager.id,
      createdAt: daysAgo(40),
    },
  });

  const stepDefs = [
    { dayOffset: 0, channel: "EMAIL", subject: "{{company}} — month-end close", body: "Hi {{first_name}},\n\nYou mentioned month-end close taking two weeks. We shortened that to four days for a {{industry}} business of similar size.\n\nWorth a short call?\n\n{{sender_first_name}}", manual: false },
    { dayOffset: 3, channel: "EMAIL", subject: "Re: {{company}} — month-end close", body: "Hi {{first_name}},\n\nOne number that might be useful: the bottleneck is almost always multi-plant consolidation, not the ERP itself.\n\nHappy to send the two-page breakdown.\n\n{{sender_first_name}}", manual: false },
    { dayOffset: 7, channel: "LINKEDIN", subject: null, body: "Connect and reference the ERP reporting post. Do not pitch in the connection note.", manual: true },
    { dayOffset: 10, channel: "EMAIL", subject: "Closing the loop, {{first_name}}", body: "Hi {{first_name}},\n\nLast note from me. If ERP reporting isn't a priority this quarter, that's a fine answer — I'll stop here.\n\nIf it is, reply with a date and I'll work around it.\n\n{{sender_first_name}}", manual: false },
    { dayOffset: 14, channel: "WHATSAPP", subject: null, body: "Template message, consent required. Short check-in referencing the earlier email thread.", manual: true },
  ];
  for (let i = 0; i < stepDefs.length; i++) {
    const s = stepDefs[i];
    await db.sequenceStep.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        stepOrder: i + 1,
        dayOffset: s.dayOffset,
        channel: s.channel as never,
        isManualTask: s.manual,
        subject: s.subject,
        bodyTemplate: s.body,
      },
    });
  }

  const enrollTargets = createdLeads
    .filter((l) => ["CONTACTED", "NEW", "WORKING"].includes(l.status))
    .slice(0, 34);
  for (const lead of enrollTargets) {
    const replied = !!lead.repliedAt;
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: replied ? "stopped" : chance(0.15) ? "paused" : chance(0.2) ? "completed" : "active",
        currentStep: int(1, 5),
        nextSendAt: replied ? null : daysAhead(int(0, 6)),
        enrolledAt: daysAgo(int(2, 30)),
        repliedAt: lead.repliedAt,
        stopReason: replied ? "Replied — sequence stopped automatically" : null,
      },
    });
  }

  // Suppression registry.
  await db.suppression.createMany({
    data: [
      { workspaceId: workspace.id, kind: "email", value: "unsubscribed@aravallisteel.example", reason: "Unsubscribed via link", source: "email_footer" },
      { workspaceId: workspace.id, kind: "domain", value: "aravallisteel.example", reason: "Account-level do-not-contact requested by phone", source: "manual" },
      { workspaceId: workspace.id, kind: "email", value: "legal@hooghlyjute.example", reason: "Data deletion request received", source: "dpdp_request" },
    ],
  });

  // ---------------------------------------------------------------- proposals
  console.log("→ Proposals");
  const proposalDeals = deals.filter((d) => ["proposal_sent", "negotiation", "won"].includes(d.stageKey));
  for (const { deal, lead, company } of proposalDeals) {
    const subtotal = Number(deal.valueInr);
    const tax = Math.round(subtotal * 0.18);
    const sentAt = daysAgo(int(2, 22));
    const views = int(0, 8);
    const state = deal.status === "WON" ? "ACCEPTED" : views > 0 ? "VIEWED" : "SENT";

    const proposal = await db.proposal.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        companyId: company.id,
        dealId: deal.id,
        title: `${company.name} — ${deal.title.split(" — ")[1] ?? "Implementation"} proposal`,
        state: state as never,
        publicToken: randomUUID().replace(/-/g, ""),
        subtotalInr: subtotal,
        taxRate: 18,
        taxInr: tax,
        totalInr: subtotal + tax,
        sections: [
          { key: "cover", title: "Cover", body: `Prepared for ${company.name}` },
          { key: "summary", title: "Executive summary", body: "Phase one delivers a working system in 11 weeks with a fixed scope and an agreed exit point." },
          { key: "need", title: "Your need", body: "Sales and operations run on disconnected spreadsheets, so enquiry-to-order conversion is invisible." },
          { key: "solution", title: "Recommended solution", body: "Sales Cloud configured to your quoting process, integrated with your existing ERP." },
          { key: "scope", title: "Scope", body: "Discovery, configuration, data migration, two integrations, training, 60 days hypercare." },
          { key: "timeline", title: "Timeline", body: "11 weeks from kickoff. Weekly written progress note every Friday." },
          { key: "investment", title: "Investment", body: "See the itemised schedule. GST at 18% applies." },
          { key: "terms", title: "Terms", body: "30% on signature, 40% at design sign-off, 30% on go-live. Net 30." },
          { key: "next", title: "Next step", body: "Confirm phase one scope and we will hold a kickoff slot for two weeks." },
        ],
        terms: "Valid 21 days from issue. GST at 18% applies on all professional services. Payment terms net 30.",
        validUntil: new Date(sentAt.getTime() + 21 * 86_400_000),
        sentAt,
        firstViewedAt: views > 0 ? new Date(sentAt.getTime() + int(1, 40) * 3_600_000) : null,
        lastViewedAt: views > 0 ? daysAgo(int(0, 6)) : null,
        viewCount: views,
        acceptedAt: deal.status === "WON" ? deal.wonAt : null,
        createdById: lead.ownerId,
        generatedByAi: chance(0.6),
        createdAt: new Date(sentAt.getTime() - 86_400_000),
      },
    });

    const items = [
      { name: "Discovery and process mapping", qty: 1, unit: "phase", price: Math.round(subtotal * 0.14) },
      { name: "Configuration and build", qty: 1, unit: "phase", price: Math.round(subtotal * 0.42) },
      { name: "Data migration", qty: 1, unit: "phase", price: Math.round(subtotal * 0.18) },
      { name: "Integration with existing ERP", qty: 2, unit: "integration", price: Math.round(subtotal * 0.09) },
      { name: "Training and hypercare", qty: 1, unit: "phase", price: Math.round(subtotal * 0.08) },
    ];
    await db.proposalItem.createMany({
      data: items.map((it, i) => ({
        workspaceId: workspace.id,
        proposalId: proposal.id,
        name: it.name,
        quantity: it.qty,
        unit: it.unit,
        unitPriceInr: it.price,
        amountInr: it.price * it.qty,
        sortOrder: i,
      })),
    });

    for (let v = 0; v < views; v++) {
      await db.proposalView.create({
        data: {
          workspaceId: workspace.id,
          proposalId: proposal.id,
          viewedAt: new Date(sentAt.getTime() + int(1, 400) * 3_600_000),
          durationSec: int(20, 600),
          ipHash: hash(`${proposal.id}-${v}`),
          city: company.city,
        },
      });
    }
  }

  // ---------------------------------------------------------------- bookings
  console.log("→ Bookings");
  const meetingDeals = deals.filter((d) => ["meeting", "proposal_sent", "negotiation", "won"].includes(d.stageKey));
  for (const { deal, lead, company } of meetingDeals) {
    const past = chance(0.6);
    const start = past ? daysAgo(int(1, 20)) : daysAhead(int(0, 12));
    await db.booking.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        dealId: deal.id,
        hostUserId: lead.ownerId,
        title: `${company.name} — ${past ? "discovery call" : "scope review"}`,
        state: past ? "completed" : "scheduled",
        startsAt: start,
        endsAt: new Date(start.getTime() + 1_800_000),
        timezone: "Asia/Kolkata",
        meetingUrl: "https://meet.example/northbridge/" + randomUUID().slice(0, 8),
        provider: "google",
        agenda: past ? "Current process, pain points, decision process, timeline." : "Walk through phase one scope and confirm integration surface.",
        transcript: past && chance(0.4) ? "Fictional transcript placeholder for demonstration." : null,
        aiSummary: past && chance(0.4)
          ? "They confirmed an active evaluation and a quarter-end target. Budget sits with finance and is not yet approved. Two competitors in the running; price is the stated concern."
          : null,
        outcomes: past && chance(0.4)
          ? {
              objections: ["Team size relative to rollout scale", "Price versus a larger integrator"],
              commitments: ["Send indicative commercials by Friday", "Arrange one reference call"],
              competitors: ["Large systems integrator"],
              decisionTimeline: "Quarter end",
            }
          : {},
        createdAt: daysAgo(int(3, 25)),
      },
    });
  }

  // ---------------------------------------------------------------- tasks
  console.log("→ Tasks");
  const taskSeeds: {
    title: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    score: number;
    reason: string;
    action: string;
    channel: string | null;
    dueOffset: number;
    lane: string;
    impactMultiplier: number;
  }[] = [
    { title: "Reply to {{name}} — asked for commercials", priority: "URGENT", score: 96, reason: "They asked a direct question 19 hours ago and are mid-evaluation with two competitors. Reply latency is the single biggest predictor of losing this.", action: "Send indicative phase-one commercials plus one reference", channel: "EMAIL", dueOffset: 0, lane: "NEEDS_ATTENTION", impactMultiplier: 1 },
    { title: "Contact {{name}} — new high-intent signal", priority: "URGENT", score: 91, reason: "Posted publicly about shortlisting implementation partners this quarter, 4 hours ago. First credible response usually gets the meeting.", action: "Reach out today referencing their quarter-end deadline", channel: "EMAIL", dueOffset: 0, lane: "QUEUED", impactMultiplier: 1 },
    { title: "Follow up on {{company}} proposal", priority: "HIGH", score: 84, reason: "Proposal opened 5 times in 3 days but no reply. Repeated opens without a response usually means internal circulation, or a price objection nobody has said out loud.", action: "Call rather than email — ask directly what is blocking it", channel: "PHONE", dueOffset: 0, lane: "QUEUED", impactMultiplier: 1 },
    { title: "Re-engage {{company}} — dormant but warming", priority: "MEDIUM", score: 68, reason: "Silent for 26 days, then a new hiring signal appeared yesterday. The reason it went quiet may have just changed.", action: "Open with the new signal, not a bare follow-up", channel: "EMAIL", dueOffset: 1, lane: "QUEUED", impactMultiplier: 0.7 },
    { title: "Confirm decision process at {{company}}", priority: "HIGH", score: 79, reason: "Deal is at Negotiation with no identified finance stakeholder. Deals that reach this stage without procurement involved slip a quarter about half the time.", action: "Ask who signs and what their process needs", channel: "PHONE", dueOffset: 0, lane: "IN_PROGRESS", impactMultiplier: 1 },
    { title: "Send manufacturing case study to {{name}}", priority: "MEDIUM", score: 61, reason: "Raised the team-size objection on the last call. A comparable-size reference addresses it better than reassurance.", action: "Send the auto components case study and offer a reference call", channel: "EMAIL", dueOffset: 2, lane: "QUEUED", impactMultiplier: 0.6 },
    { title: "Chase overdue invoice — {{company}}", priority: "HIGH", score: 74, reason: "Phase-one invoice is 12 days past due on a won deal. Collection risk, not sales risk.", action: "Email accounts with the invoice reference", channel: "EMAIL", dueOffset: -2, lane: "NEEDS_ATTENTION", impactMultiplier: 0.3 },
    { title: "Prepare brief for {{company}} scope review", priority: "MEDIUM", score: 66, reason: "Meeting is in 2 days and no brief exists. Walking in cold to a scope review is how scope creeps.", action: "Generate the pre-meeting brief and read it", channel: null, dueOffset: 1, lane: "QUEUED", impactMultiplier: 0.5 },
    { title: "Qualify budget at {{company}}", priority: "MEDIUM", score: 57, reason: "Score is held down by an unconfirmed budget. One question resolves the largest unknown on this lead.", action: "Ask whether spend is approved for this financial year", channel: "PHONE", dueOffset: 3, lane: "QUEUED", impactMultiplier: 0.5 },
    { title: "Review AI-drafted replies", priority: "MEDIUM", score: 63, reason: "Autopilot is in Review First mode and has drafts waiting. They go stale fast.", action: "Approve, edit or reject each draft", channel: null, dueOffset: 0, lane: "NEEDS_ATTENTION", impactMultiplier: 0.4 },
    { title: "Add stakeholder at {{company}}", priority: "LOW", score: 44, reason: "Only one contact known at an account with a 640-person headcount. Single-threaded deals die when that person leaves.", action: "Identify and reveal a second stakeholder", channel: null, dueOffset: 5, lane: "QUEUED", impactMultiplier: 0.4 },
    { title: "Close out {{company}} — no response in 6 weeks", priority: "LOW", score: 31, reason: "Six touches, no response, no signal movement. Keeping it open costs attention that a live deal needs.", action: "Mark lost with a reason, or move to long-term nurture", channel: null, dueOffset: 0, lane: "QUEUED", impactMultiplier: 0.2 },
  ];

  const taskLeadPool = [...repliedLeads, ...dealCandidates].slice(0, taskSeeds.length + 6);
  const tasks = [];
  for (let i = 0; i < taskSeeds.length; i++) {
    const t = taskSeeds[i];
    const lead = taskLeadPool[i % taskLeadPool.length];
    const relatedDeal = deals.find((d) => d.lead.id === lead.id);
    const title = t.title
      .replace("{{name}}", lead.bundle.person.fullName)
      .replace("{{company}}", lead.bundle.company.name);

    tasks.push(
      await db.task.create({
        data: {
          workspaceId: workspace.id,
          title,
          description: t.action,
          status: t.lane === "IN_PROGRESS" ? "WORKING" : t.lane === "NEEDS_ATTENTION" ? "NEEDS_ATTENTION" : "QUEUED",
          priority: t.priority,
          ownerId: i < 6 ? owner.id : pick(sellers).id,
          leadId: lead.id,
          companyId: lead.companyId,
          dealId: relatedDeal?.deal.id ?? null,
          channel: t.channel as never,
          dueAt: daysAhead(t.dueOffset),
          priorityScore: t.score,
          priorityReason: t.reason,
          expectedImpactInr: relatedDeal
            ? Math.round(Number(relatedDeal.deal.valueInr) * t.impactMultiplier)
            : lead.estimatedBudgetInr
              ? Math.round(lead.estimatedBudgetInr * t.impactMultiplier)
              : null,
          recommendedAction: t.action,
          createdByAi: true,
          lane: t.lane,
          sortOrder: i,
          revenueImpact: t.impactMultiplier >= 0.9 ? "direct" : t.impactMultiplier >= 0.5 ? "indirect" : "hygiene",
          createdAt: hoursAgo(int(1, 40)),
        },
      })
    );
  }

  // Some completed tasks so the heatmap and Done tab have history.
  for (let d = 0; d < 14; d++) {
    const count = int(0, 5);
    for (let i = 0; i < count; i++) {
      const lead = pick(createdLeads);
      await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: pick([
            `Follow up with ${lead.bundle.person.fullName}`,
            `Call ${lead.bundle.company.name}`,
            `Send case study to ${lead.bundle.person.fullName}`,
            `Log notes from ${lead.bundle.company.name} call`,
          ]),
          status: "DONE",
          priority: pick(["LOW", "MEDIUM", "HIGH"]),
          ownerId: pick(sellers).id,
          leadId: lead.id,
          companyId: lead.companyId,
          dueAt: daysAgo(d),
          completedAt: withinDay(d),
          priorityScore: int(30, 80),
          priorityReason: "Completed.",
          lane: "DONE",
          createdAt: daysAgo(d + 1),
        },
      });
    }
  }

  await db.taskAssignment.createMany({
    data: tasks.slice(0, 5).map((t) => ({
      workspaceId: workspace.id,
      taskId: t.id,
      userId: manager.id,
      role: "collaborator",
    })),
  });

  // ---------------------------------------------------------------- notes
  console.log("→ Notes and sticky notes");
  for (const lead of createdLeads.slice(0, 40)) {
    if (!chance(0.5)) continue;
    await db.note.create({
      data: {
        workspaceId: workspace.id,
        body: pick([
          "Prefers WhatsApp over email for anything quick. Said so on the first call.",
          "Budget cycle starts in April. Nothing moves before then regardless of interest.",
          "Burned by a previous vendor who over-promised on timeline. Be conservative and specific.",
          "Wants a reference from a business of comparable size, not a logo slide.",
          "CFO is the real approver. Our contact is a genuine champion but cannot sign.",
          "Asked us not to contact other people at the company without telling them first.",
        ]),
        authorId: lead.ownerId,
        leadId: lead.id,
        companyId: lead.companyId,
        createdAt: daysAgo(int(1, 40)),
      },
    });
  }

  for (const lead of createdLeads.slice(0, 25)) {
    if (!chance(0.4)) continue;
    await db.relationshipMemory.create({
      data: {
        workspaceId: workspace.id,
        personId: lead.personId,
        kind: pick(["preference", "concern", "objection", "promise", "timeline"]),
        content: pick([
          "Prefers a written summary after every call.",
          "Concerned our team size is too small for their rollout.",
          "Promised to introduce us to their finance head once scope is agreed.",
          "Decision window is quarter end; anything after that slips a full quarter.",
          "Does not want vendor calls before 11am.",
        ]),
        sourceType: pick(["call", "email", "meeting"]),
        confidence: int(60, 95),
        createdAt: daysAgo(int(2, 35)),
      },
    });
  }

  await db.stickyNote.createMany({
    data: [
      { workspaceId: workspace.id, authorId: owner.id, kind: "REMINDER", body: "Ask Priya to review the Suryodaya commercials before it goes out.", color: "amber", isPinned: true },
      { workspaceId: workspace.id, authorId: owner.id, kind: "IDEA", body: "Short emails that name the actual operational trigger are outperforming feature-led ones by a wide margin. Rewrite the sequence openers.", color: "teal", isPinned: true },
      { workspaceId: workspace.id, authorId: owner.id, kind: "OBJECTION", body: "\"Your team is too small\" came up three times this month. Need a better answer than reassurance — lead with a bounded phase one.", color: "rose" },
      { workspaceId: workspace.id, authorId: owner.id, kind: "FOLLOW_UP", body: "Kaveri Logistics wants a reference from a cold chain operator specifically. Ask Sahyadri.", color: "sky" },
    ],
  });

  // ---------------------------------------------------------------- lists, radar
  console.log("→ Lists, radar and saved searches");
  const listDefs = [
    { name: "Salesforce prospects", isDynamic: true, filter: { keyword: "salesforce", minScore: 6 }, color: "teal" },
    { name: "Pune & Nashik manufacturers", isDynamic: true, filter: { cities: ["Pune", "Nashik"], industries: ["Manufacturing"] }, color: "sky" },
    { name: "Hot this month", isDynamic: true, filter: { intent: ["HOT", "BUYING"], surfacedWithinDays: 30 }, color: "rose" },
    { name: "Founders to contact", isDynamic: true, filter: { seniorities: ["founder", "c-level"], status: ["NEW", "WORKING"] }, color: "amber" },
    { name: "Proposal follow-ups", isDynamic: false, filter: {}, color: "violet" },
  ];
  const lists = [];
  for (const l of listDefs) {
    lists.push(
      await db.list.create({
        data: {
          workspaceId: workspace.id,
          name: l.name,
          description: l.isDynamic ? "Updates automatically from its saved filter." : "Manually curated.",
          isDynamic: l.isDynamic,
          filterJson: l.filter,
          color: l.color,
          createdById: owner.id,
          createdAt: daysAgo(int(10, 80)),
        },
      })
    );
  }
  const staticList = lists[4];
  for (const lead of dealCandidates.slice(0, 8)) {
    await db.listMember.create({
      data: { workspaceId: workspace.id, listId: staticList.id, leadId: lead.id, addedById: owner.id },
    });
  }

  await db.radarWatch.createMany({
    data: [
      { workspaceId: workspace.id, targetKind: "COMPANY", targetId: companies[0].id, targetLabel: companies[0].name, frequency: "REALTIME", alertOn: ["new_signal", "leadership_change", "hiring_spike"], stage: "READY_TO_BUY", confidence: 88, createdById: owner.id },
      { workspaceId: workspace.id, targetKind: "COMPANY", targetId: companies[1].id, targetLabel: companies[1].name, frequency: "DAILY", alertOn: ["new_signal", "funding"], stage: "EVALUATING", confidence: 71, createdById: owner.id },
      { workspaceId: workspace.id, targetKind: "KEYWORD", targetLabel: "ERP migration", frequency: "DAILY", alertOn: ["new_signal"], stage: "EVALUATING", confidence: 64, createdById: owner.id },
      { workspaceId: workspace.id, targetKind: "TECHNOLOGY", targetLabel: "SAP ECC", frequency: "WEEKLY", alertOn: ["technology_migration"], stage: "AWARE", confidence: 52, createdById: manager.id },
      { workspaceId: workspace.id, targetKind: "INDUSTRY", targetLabel: "Cold chain logistics", frequency: "WEEKLY", alertOn: ["new_signal", "expansion"], stage: "AWARE", confidence: 47, createdById: manager.id },
    ],
  });

  await db.savedSearch.createMany({
    data: [
      { workspaceId: workspace.id, name: "Tier A, reachable, not contacted", surface: "leads", filterJson: { tiers: ["A"], reachable: true, status: ["NEW"] }, alertEnabled: true, frequency: "DAILY", createdById: owner.id },
      { workspaceId: workspace.id, name: "Manufacturing CTOs in Maharashtra", surface: "people_finder", filterJson: { industries: ["Manufacturing"], states: ["Maharashtra"], titles: ["CTO", "Head of IT"] }, alertEnabled: true, frequency: "WEEKLY", createdById: manager.id },
      { workspaceId: workspace.id, name: "Names a budget", surface: "leads", filterJson: { hasBudget: true, minScore: 6 }, alertEnabled: false, frequency: "DAILY", createdById: rep1.id },
    ],
  });

  await db.competitor.createMany({
    data: [
      { workspaceId: workspace.id, name: "Meridian Systems Integration", domain: "meridiansi.example", aliases: ["Meridian SI", "Meridian"], notes: "Large SI. Wins on perceived delivery risk, loses on price and partner attention." },
      { workspaceId: workspace.id, name: "Aurora Cloud Consulting", domain: "auroracloud.example", aliases: ["Aurora"], notes: "Similar size to us. Competes on Salesforce specifically." },
      { workspaceId: workspace.id, name: "Kestrel Digital", domain: "kesteldigital.example", aliases: ["Kestrel"], notes: "Undercuts on price, weak on ERP integration." },
    ],
  });

  // ---------------------------------------------------------------- knowledge, playbooks
  console.log("→ Knowledge base and playbooks");
  await db.knowledgeDoc.createMany({
    data: KNOWLEDGE_DOCS.map((d) => ({
      workspaceId: workspace.id,
      kind: d.kind,
      title: d.title,
      body: d.body,
      tags: d.tags,
      createdById: owner.id,
    })),
  });

  await db.playbook.createMany({
    data: [
      {
        workspaceId: workspace.id,
        name: "Salesforce migration — manufacturing",
        description: "Runs when a manufacturing lead of 200–1,000 people mentions CRM or Salesforce migration.",
        triggerJson: { industries: ["Manufacturing"], employeeMin: 200, employeeMax: 1000, keywords: ["salesforce", "crm migration"] },
        steps: [
          { order: 1, action: "research_company", note: "Build the account dossier first." },
          { order: 2, action: "identify_crm_owner", note: "Find who owns the CRM decision." },
          { order: 3, action: "draft_outreach", note: "Migration-focused opener, under 80 words." },
          { order: 4, action: "attach_knowledge", note: "Include the auto components case study." },
          { order: 5, action: "enroll_sequence", note: "Manufacturing — ERP modernisation." },
        ],
        // Not active, and never run. Every step of this playbook calls a tool
        // that isn't built, so seeding it as a working automation with 14 runs
        // behind it would be the exact claim §126 forbids. The screen resolves
        // each step against the tool registry and says why it can't run.
        isActive: false,
        isAgentTriggerable: false,
        timesRun: 0,
      },
      {
        workspaceId: workspace.id,
        name: "Post-funding outreach delay",
        description: "Holds outreach for 3 weeks after a funding announcement, then contacts with a budget-planning angle.",
        triggerJson: { signalTypes: ["FUNDING"], delayDays: 21 },
        steps: [
          { order: 1, action: "wait", note: "21 days — budget planning has not started before then." },
          { order: 2, action: "research_company", note: "Check what the round was earmarked for." },
          { order: 3, action: "draft_outreach", note: "Reference the stated use of funds." },
        ],
        isActive: false,
        isAgentTriggerable: false,
        timesRun: 0,
      },
    ],
  });

  // ---------------------------------------------------------------- agents
  console.log("→ Agents and runs");
  // The same catalogue a real workspace is set up from; the demo enables all but the proposal agent.
  const agentDefs = AGENT_CATALOGUE.map((a) => ({ ...a, tools: [...a.tools], enabled: a.kind !== "PROPOSAL" }));
  const agents = [];
  for (const a of agentDefs) {
    agents.push(
      await db.aIAgent.create({
        data: {
          workspaceId: workspace.id,
          kind: a.kind as never,
          name: a.name,
          goal: a.goal,
          isEnabled: a.enabled,
          tools: a.tools,
          approvalPolicy: a.kind === "SDR" ? "review_first" : "auto_within_budget",
          dailyPointBudget: a.points,
          dailyActionCap: a.cap,
        },
      })
    );
  }

  // One realistic Autopilot run, as the run log shows it (§43).
  const prospectingAgent = agents.find((a) => a.kind === "PROSPECTING")!;
  const run = await db.agentRun.create({
    data: {
      workspaceId: workspace.id,
      agentId: prospectingAgent.id,
      trigger: "schedule:daily_10am",
      state: "SUCCEEDED",
      summary: "Found 19 signals, 7 met the ICP threshold, revealed 3 contacts, drafted 3 messages, sent 2, held 1 for review.",
      pointsSpent: 3,
      actionsTaken: 8,
      actionsHeld: 1,
      startedAt: hoursAgo(6),
      finishedAt: hoursAgo(5.5),
      idempotencyKey: randomUUID(),
    },
  });

  const runActions: [string, string, string, number, boolean][] = [
    ["search_leads", "READ", "Scanned 10 active search phrases and found 19 new signals", 0, false],
    ["search_leads", "READ", "7 of 19 signals met the Tier A/B threshold and minimum score of 68", 0, false],
    ["unlock_contacts", "SPEND", "Revealed verified email for Suryodaya Auto Components contact", 1, false],
    ["unlock_contacts", "SPEND", "Revealed verified email for Kaveri Logistics Network contact", 1, false],
    ["unlock_contacts", "SPEND", "Revealed verified email for Godavari Chemicals contact", 1, false],
    ["draft_outreach", "WRITE", "Drafted 3 first-touch emails grounded in each lead's signal", 0, false],
    ["send_email", "EXTERNAL", "Sent 2 emails inside the configured 10:00–18:00 window", 0, false],
    ["send_email", "EXTERNAL", "Held 1 email — estimated deal value above the ₹5,00,000 approval threshold", 0, true],
    ["create_task", "WRITE", "Created a review task for the held message", 0, false],
  ];
  for (let i = 0; i < runActions.length; i++) {
    const [tool, risk, summary, points, needsApproval] = runActions[i];
    await db.agentAction.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        sequence: i + 1,
        riskClass: risk,
        tool,
        summary,
        state: needsApproval ? "pending_approval" : "completed",
        pointsSpent: points,
        requiresApproval: needsApproval,
        occurredAt: new Date(hoursAgo(6).getTime() + i * 210_000),
      },
    });
  }

  // ---------------------------------------------------------------- AI insights
  console.log("→ AI insights");
  const topLead = [...createdLeads].sort((a, b) => b.composite - a.composite)[0];
  const openDeals = deals.filter((d) => d.deal.status === "OPEN");

  await db.aIInsight.create({
    data: {
      workspaceId: workspace.id,
      kind: "COACH_TIP",
      title: "Short, trigger-led first emails are outperforming feature-led ones",
      body:
        "Across 11 manufacturing leads contacted this month, emails under 80 words that named the prospect's actual operational trigger got replies at 3.2× the rate of longer feature-led messages. Keep the first email short and specific.",
      whyNow: "You have 4 first-touch emails queued that are all over 150 words.",
      severity: "info",
      evidence: [
        { label: "11 manufacturing leads contacted in the last 30 days", href: "/leads?industry=Manufacturing" },
        { label: "Reply rate: 27% under 80 words vs 8% over 150 words" },
        { label: "Derived from sent messages and inbound replies in this workspace" },
      ],
      forUserId: owner.id,
      confidence: 74,
      createdAt: hoursAgo(3),
    },
  });

  await db.aIInsight.create({
    data: {
      workspaceId: workspace.id,
      kind: "DEAL_RISK",
      title: `${openDeals.length} open deals have no scheduled next action`,
      body:
        "Open deals without a dated next step are the largest single source of silent pipeline loss. Each one below needs either a next step or an honest close-lost.",
      whyNow: "Detected during this morning's pipeline scan.",
      severity: "warning",
      evidence: openDeals.slice(0, 4).map((d) => ({
        label: `${d.company.name} — ${d.deal.title}`,
        detail: d.deal.nextActionAt ? "Has a next action" : "No next action set",
        href: "/pipeline",
      })),
      forUserId: owner.id,
      confidence: 92,
      createdAt: hoursAgo(5),
    },
  });

  if (topLead) {
    await db.aIInsight.create({
      data: {
        workspaceId: workspace.id,
        kind: "LEAD_RECOMMENDATION",
        title: `Contact ${topLead.bundle.person.fullName} first today`,
        body: `Highest-scoring uncontacted lead in the workspace at ${topLead.displayScore}/10. ${topLead.surfacedReason}`,
        whyNow: "The signal behind this lead is the freshest strong signal you have.",
        severity: "info",
        evidence: [
          { label: topLead.surfacedReason, href: `/leads/${topLead.id}` },
          { label: `${topLead.bundle.role.title} at ${topLead.bundle.company.name}` },
          { label: `Tier ${topLead.tier} · intent ${topLead.intent.toLowerCase()}` },
        ],
        leadId: topLead.id,
        forUserId: owner.id,
        confidence: 86,
        createdAt: hoursAgo(2),
      },
    });
  }

  await db.aIInsight.create({
    data: {
      workspaceId: workspace.id,
      kind: "QUERY_OPTIMIZATION",
      title: "\"looking for Salesforce implementation partner\" is your best source",
      body:
        "This phrase produced more Tier A leads than any other and the highest reply rate. Worth expanding with adjacent wording before adding new phrases.",
      whyNow: "Enough runs have accumulated to compare phrases fairly.",
      severity: "info",
      evidence: [
        { label: "Highest Tier A yield of 10 active phrases", href: "/settings/search-phrases" },
        { label: "Suggested expansions: \"Salesforce consulting partner\", \"Sales Cloud rollout partner\"" },
      ],
      forUserId: owner.id,
      confidence: 68,
      createdAt: hoursAgo(9),
    },
  });

  // ---------------------------------------------------------------- next best actions
  for (const lead of createdLeads.slice(0, 50)) {
    const options = lead.repliedAt
      ? [
          { action: "reply_now", label: "Reply now", rationale: "They asked a direct question and are waiting.", score: 95 },
          { action: "book_meeting", label: "Send booking link", rationale: "Positive reply — convert it to a calendar slot before momentum fades.", score: 82 },
          { action: "send_case_study", label: "Send a comparable case study", rationale: "Addresses the credibility question directly.", score: 61 },
        ]
      : lead.composite >= 70
        ? [
            { action: "contact_now", label: "Contact now", rationale: "Strong fit with a recent signal. First credible response usually gets the meeting.", score: 88 },
            { action: "research", label: "Research the account first", rationale: "Tier A lead — a specific opener will outperform a generic one.", score: 64 },
            { action: "add_stakeholder", label: "Find a second stakeholder", rationale: "Single-threaded deals at this size are fragile.", score: 42 },
          ]
        : [
            { action: "wait", label: "Wait for a stronger signal", rationale: "Fit is plausible but nothing indicates an active project. Contacting now spends credibility cheaply.", score: 55 },
            { action: "watch", label: "Add to Radar", rationale: "Worth monitoring rather than contacting.", score: 48 },
          ];

    await db.nextBestAction.createMany({
      data: options.map((o, i) => ({
        workspaceId: workspace.id,
        leadId: lead.id,
        action: o.action,
        label: o.label,
        rationale: o.rationale,
        rank: i,
        score: o.score,
        channel: o.action.includes("reply") || o.action.includes("contact") ? ("EMAIL" as never) : null,
        expectedImpactInr: lead.estimatedBudgetInr,
      })),
    });
  }

  // ---------------------------------------------------------------- activities
  console.log("→ Activity stream");
  const activityKinds = [
    { kind: "lead.surfaced", actor: "SYSTEM" as const, tpl: (n: string, c: string) => `New lead surfaced: ${n} at ${c}` },
    { kind: "signal.detected", actor: "SYSTEM" as const, tpl: (n: string, c: string) => `Buying signal detected at ${c}` },
    { kind: "message.sent", actor: "HUMAN" as const, tpl: (n: string) => `Email sent to ${n}` },
    { kind: "message.replied", actor: "HUMAN" as const, tpl: (n: string) => `${n} replied` },
    { kind: "lead.revealed", actor: "HUMAN" as const, tpl: (n: string) => `Revealed verified contact for ${n}` },
    { kind: "deal.stage_changed", actor: "HUMAN" as const, tpl: (n: string, c: string) => `${c} deal moved forward` },
    { kind: "task.completed", actor: "HUMAN" as const, tpl: (n: string) => `Completed a follow-up for ${n}` },
    { kind: "agent.action", actor: "AI" as const, tpl: (n: string) => `Autopilot drafted outreach for ${n}` },
    { kind: "proposal.viewed", actor: "SYSTEM" as const, tpl: (n: string, c: string) => `${c} opened your proposal` },
    { kind: "meeting.booked", actor: "HUMAN" as const, tpl: (n: string) => `Meeting booked with ${n}` },
  ];

  for (let d = 13; d >= 0; d--) {
    // Weekdays are busier than weekends, which makes the heatmap readable.
    const dow = daysAgo(d).getDay();
    const base = dow === 0 || dow === 6 ? int(0, 4) : int(6, 22);
    for (let i = 0; i < base; i++) {
      const lead = pick(createdLeads);
      const a = pick(activityKinds);
      const relatedDeal = deals.find((x) => x.lead.id === lead.id);
      await db.activity.create({
        data: {
          workspaceId: workspace.id,
          kind: a.kind,
          summary: a.tpl(lead.bundle.person.fullName, lead.bundle.company.name),
          detail: a.kind === "signal.detected" ? lead.surfacedReason : null,
          actorType: a.actor,
          actorUserId: a.actor === "HUMAN" ? lead.ownerId : null,
          leadId: lead.id,
          companyId: lead.companyId,
          dealId: a.kind.startsWith("deal") ? (relatedDeal?.deal.id ?? null) : null,
          channel: a.kind.startsWith("message") ? "EMAIL" : null,
          amountInr: a.kind === "deal.stage_changed" && relatedDeal ? relatedDeal.deal.valueInr : null,
          occurredAt: new Date(daysAgo(d).setHours(int(9, 19), int(0, 59), 0, 0)),
        },
      });
    }
  }

  // ---------------------------------------------------------------- notifications
  console.log("→ Notifications");
  const notifSeeds: { kind: string; title: string; body: string; severity: string; href: string; age: number }[] = [
    { kind: "NEW_REPLY", title: "New reply needs you", body: `${repliedLeads[0]?.bundle.person.fullName ?? "A lead"} asked for indicative commercials.`, severity: "success", href: "/inbox", age: 0.8 },
    { kind: "HOT_LEAD", title: "New Tier A lead", body: `${topLead?.bundle.person.fullName ?? "A lead"} scored ${topLead?.displayScore ?? 9}/10 on a fresh signal.`, severity: "info", href: topLead ? `/leads/${topLead.id}` : "/leads", age: 2 },
    { kind: "DEAL_RISK", title: "Deal at risk", body: "A ₹32,00,000 deal has had no activity for 19 days.", severity: "warning", href: "/pipeline", age: 4 },
    { kind: "PROPOSAL_VIEWED", title: "Proposal opened 5 times", body: "Repeated opens without a reply usually mean internal circulation or an unspoken price objection.", severity: "info", href: "/proposals", age: 7 },
    { kind: "AUTOPILOT_APPROVAL", title: "1 message held for review", body: "Estimated deal value is above your ₹5,00,000 approval threshold.", severity: "warning", href: "/approvals", age: 6 },
    { kind: "TASK_DUE", title: "4 follow-ups due today", body: "Ranked by expected revenue impact in My Queue.", severity: "info", href: "/my-queue", age: 9 },
    { kind: "MEETING_BOOKED", title: "Meeting booked", body: "Scope review confirmed for later this week.", severity: "success", href: "/bookings", age: 26 },
    { kind: "POINTS_LOW", title: "Points running low", body: `${balance} points left. At your current rate that is about 17 days.`, severity: "warning", href: "/settings/billing", age: 30 },
  ];
  for (const n of notifSeeds) {
    await db.notification.create({
      data: {
        workspaceId: workspace.id,
        userId: owner.id,
        kind: n.kind as never,
        title: n.title,
        body: n.body,
        severity: n.severity,
        href: n.href,
        readAt: n.age > 8 ? hoursAgo(n.age - 2) : null,
        createdAt: hoursAgo(n.age),
      },
    });
  }

  // ---------------------------------------------------------------- audit log
  console.log("→ Audit log");
  const auditSeeds: { action: string; objectType: string; source: string; actor: string; actorType: "HUMAN" | "AI" | "SYSTEM"; age: number }[] = [
    { action: "lead.revealed", objectType: "Lead", source: "UI", actor: "Rahul Deshpande", actorType: "HUMAN", age: 2 },
    { action: "deal.stage_changed", objectType: "Deal", source: "UI", actor: "Priya Iyer", actorType: "HUMAN", age: 5 },
    { action: "message.sent", objectType: "Message", source: "AUTOPILOT", actor: "Prospecting agent", actorType: "AI", age: 6 },
    { action: "points.spent", objectType: "PointLedger", source: "AUTOPILOT", actor: "Prospecting agent", actorType: "AI", age: 6 },
    { action: "autopilot.mode_changed", objectType: "AutopilotConfig", source: "UI", actor: "Rahul Deshpande", actorType: "HUMAN", age: 28 },
    { action: "member.invited", objectType: "WorkspaceMember", source: "UI", actor: "Rahul Deshpande", actorType: "HUMAN", age: 72 },
    { action: "lead.exported", objectType: "Lead", source: "API", actor: "API key: reporting-readonly", actorType: "SYSTEM", age: 40 },
    { action: "lead.searched", objectType: "Lead", source: "MCP", actor: "MCP client: Claude Code", actorType: "AI", age: 20 },
    { action: "scoring_config.updated", objectType: "ScoringConfig", source: "UI", actor: "Priya Iyer", actorType: "HUMAN", age: 90 },
    { action: "suppression.added", objectType: "Suppression", source: "UI", actor: "Rahul Deshpande", actorType: "HUMAN", age: 50 },
  ];
  for (const a of auditSeeds) {
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorType: a.actorType,
        actorUserId: a.actorType === "HUMAN" ? owner.id : null,
        actorLabel: a.actor,
        source: a.source as never,
        action: a.action,
        objectType: a.objectType,
        objectId: randomUUID(),
        before: a.action.includes("changed") || a.action.includes("updated") ? { value: "previous" } : undefined,
        after: a.action.includes("changed") || a.action.includes("updated") ? { value: "current" } : undefined,
        ipAddress: "103.21.xxx.xxx",
        createdAt: hoursAgo(a.age),
      },
    });
  }

  await db.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name: "reporting-readonly",
      prefix: "sr_live_7k2p",
      keyHash: hash(`api-key-demo-${workspace.id}`),
      scopes: ["leads.read", "pipeline.read", "insights.read"],
      createdById: owner.id,
      lastUsedAt: hoursAgo(40),
    },
  });

  await db.webhook.create({
    data: {
      workspaceId: workspace.id,
      name: "Ops Slack relay",
      url: "https://hooks.example/northbridge/ops",
      events: ["lead.created", "message.replied", "deal.won", "proposal.viewed"],
      secret: hash(`webhook-demo-${workspace.id}`),
      isActive: true,
      lastStatus: 200,
      lastDeliveryAt: hoursAgo(3),
    },
  });

  // ---------------------------------------------------------------- AI cost log
  //
  // Only features that a code path can actually reach are logged. Seeding
  // `deep_research` or `lead_verdict` usage put rows on the AI settings screen
  // for features the same screen marks "Routed, not built" — two panels
  // contradicting each other. And the cost is computed from the tokens by the
  // same function that prices a live call, rather than invented, so every
  // figure on that screen traces to its row.
  const AI_MODEL = modelForProvider("natural_language_analytics", "anthropic");
  for (let d = 6; d >= 0; d--) {
    for (let i = 0; i < int(1, 5); i++) {
      // A grounded Copilot answer reads every READ tool, so the input is large
      // and the output is a couple of sentences.
      const inputTokens = int(2400, 4200);
      const outputTokens = int(120, 380);
      const success = chance(0.94);
      await db.aIRequestLog.create({
        data: {
          workspaceId: workspace.id,
          feature: "natural_language_analytics",
          provider: "anthropic",
          model: AI_MODEL,
          promptKey: "copilot.grounded.v1",
          latencyMs: success ? int(2800, 7400) : int(300, 900),
          // A failed call generated nothing, so it burned no tokens and cost
          // nothing. Seeding it otherwise would overstate spend.
          inputTokens: success ? inputTokens : 0,
          outputTokens: success ? outputTokens : 0,
          estimatedCostInr: success ? estimateCostInr(AI_MODEL, inputTokens, outputTokens) : 0,
          success,
          errorCode: success ? null : pick(["rate_limited", "timeout", "provider_error"]),
          actorType: "HUMAN",
          createdAt: new Date(daysAgo(d).setHours(int(9, 20), int(0, 59), 0, 0)),
        },
      });
    }

    // Most Copilot questions match one tool and never reach a model at all.
    for (let i = 0; i < int(2, 9); i++) {
      await db.aIRequestLog.create({
        data: {
          workspaceId: workspace.id,
          feature: `copilot.${pick(["get_today", "search_leads", "get_pipeline", "get_replies", "get_revenue", "get_insights"])}`,
          // No provider is called on this path, so naming one would put a
          // vendor on a row that generated nothing.
          provider: "none",
          model: "tool-router",
          latencyMs: int(18, 220),
          success: true,
          actorType: "HUMAN",
          createdAt: new Date(daysAgo(d).setHours(int(9, 20), int(0, 59), 0, 0)),
        },
      });
    }
  }

  // ---------------------------------------------------------------- summary
  const counts = await Promise.all([
    db.lead.count({ where: { workspaceId: workspace.id } }),
    db.company.count({ where: { workspaceId: workspace.id } }),
    db.person.count({ where: { workspaceId: workspace.id } }),
    db.signal.count({ where: { workspaceId: workspace.id } }),
    db.deal.count({ where: { workspaceId: workspace.id } }),
    db.task.count({ where: { workspaceId: workspace.id } }),
    db.conversation.count({ where: { workspaceId: workspace.id } }),
    db.message.count({ where: { workspaceId: workspace.id } }),
    db.proposal.count({ where: { workspaceId: workspace.id } }),
    db.activity.count({ where: { workspaceId: workspace.id } }),
    db.leadScoreEvidence.count({ where: { workspaceId: workspace.id } }),
  ]);

  console.log(`
✓ Seed complete — workspace "${workspace.name}"

  leads            ${counts[0]}
  companies        ${counts[1]}
  people           ${counts[2]}
  signals          ${counts[3]}
  deals            ${counts[4]}
  tasks            ${counts[5]}
  conversations    ${counts[6]}
  messages         ${counts[7]}
  proposals        ${counts[8]}
  activities       ${counts[9]}
  score evidence   ${counts[10]}
  points balance   ${balance}

  Sign in:  rahul@northbridge.example  /  Signalroom123
`);
}

/** The most recent thing that actually happened to a lead. */
function lastActivityFor(lead: { repliedAt: Date | null; surfacedAt: Date }): Date {
  return lead.repliedAt && lead.repliedAt > lead.surfacedAt ? lead.repliedAt : lead.surfacedAt;
}

function bandFor(n: number): string {
  if (n < 50) return "1–50";
  if (n < 200) return "51–200";
  if (n < 500) return "201–500";
  if (n < 1000) return "501–1000";
  if (n < 5000) return "1001–5000";
  return "5000+";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain}`;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 7)}•••••`;
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
