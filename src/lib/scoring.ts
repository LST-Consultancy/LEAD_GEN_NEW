/**
 * Lead scoring engine (§71, §72).
 *
 * Two rules drive the design:
 *   1. Never collapse quality into one opaque number. Eight dimensions are
 *      stored separately and the composite is a configurable weighted sum.
 *   2. Every point awarded carries an evidence row naming what caused it, so
 *      "Why 9/10?" always has a real answer.
 *
 * Deterministic and pure — no model call. The AI layer explains these numbers;
 * it does not invent them.
 */

import { clamp } from "@/lib/utils";

export type Dimension =
  | "fit"
  | "intent"
  | "urgency"
  | "authority"
  | "budget"
  | "reachability"
  | "engagement"
  | "recency";

export type Evidence = {
  dimension: Dimension;
  points: number;
  label: string;
  detail?: string;
  sourceType: string;
  sourceRef?: string;
  signalId?: string;
};

export type ScoringWeights = Record<Dimension, number>;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  fit: 25,
  intent: 25,
  urgency: 15,
  authority: 10,
  budget: 10,
  reachability: 5,
  engagement: 5,
  recency: 5,
};

export type ScoringIcp = {
  industries: string[];
  locations: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  buyerRoles: string[];
  seniorities: string[];
  technologies: string[];
  triggerEvents: string[];
  exclusions: string[];
};

export type ScoringSignal = {
  id?: string;
  type: string;
  occurredAt: Date;
  confidence: number;
  keywords: string[];
  excerpt?: string;
};

export type ScoringInput = {
  icp: ScoringIcp;
  company: {
    name: string;
    industry: string | null;
    city: string | null;
    state: string | null;
    employeeCount: number | null;
    technologies: string[];
  };
  role: {
    title: string;
    seniority: string | null;
    department: string | null;
    isDecisionMaker: boolean;
  };
  signals: ScoringSignal[];
  contacts: { kind: string; status: string; isLocked: boolean; optedOut: boolean }[];
  engagement: {
    outboundCount: number;
    inboundCount: number;
    repliedAt: Date | null;
    meetingsHeld: number;
    proposalViews: number;
  };
  budget: { estimatedInr: number | null };
  now?: Date;
};

export type ScoringResult = {
  dimensions: Record<Dimension, number>;
  composite: number;
  displayScore: number;
  tier: "A" | "B" | "C" | "D";
  intent: "COLD" | "AWARE" | "WARM" | "HOT" | "BUYING";
  evidence: Evidence[];
};

/** How much each signal type moves intent, before recency decay. */
const SIGNAL_INTENT_WEIGHT: Record<string, number> = {
  RFP: 78,
  MEETING: 70,
  PROPOSAL_ACTIVITY: 64,
  SOCIAL_POST: 62,
  ANNOUNCEMENT: 52,
  HIRING: 50,
  TECH_CHANGE: 46,
  COMPETITOR_MENTION: 44,
  SOCIAL_COMMENT: 40,
  FUNDING: 38,
  EMAIL_ACTIVITY: 36,
  NEWS: 32,
  WEBSITE_UPDATE: 28,
  JOB_CHANGE: 28,
  EVENT: 24,
  REVIEW: 22,
  MANUAL_NOTE: 18,
};

/** Language that indicates an active, time-boxed project rather than interest. */
const URGENCY_PHRASES = [
  "this quarter",
  "this month",
  "immediately",
  "urgent",
  "asap",
  "by march",
  "by april",
  "deadline",
  "go live",
  "go-live",
  "rfp",
  "shortlist",
  "evaluating",
  "migrating",
  "migration",
  "replacing",
  "onboarding",
  "timeline",
  "kick off",
  "kickoff",
];

const BUDGET_PHRASES = [
  "budget",
  "approved",
  "funded",
  "allocated",
  "lakh",
  "crore",
  "cost",
  "pricing",
  "quote",
  "investment",
];

const SENIORITY_POINTS: Record<string, number> = {
  founder: 100,
  "c-level": 96,
  owner: 96,
  president: 90,
  vp: 82,
  director: 70,
  head: 68,
  senior_manager: 56,
  manager: 46,
  lead: 38,
  senior: 30,
  individual: 20,
};

/** Half-life in days for signal recency decay. */
const DECAY_HALF_LIFE = 21;

function decay(occurredAt: Date, now: Date): number {
  const days = Math.max(0, (now.getTime() - occurredAt.getTime()) / 86_400_000);
  return Math.pow(0.5, days / DECAY_HALF_LIFE);
}

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function anyMatch(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (n && haystack.includes(n.toLowerCase())) return n;
  }
  return null;
}

export function scoreLead(input: ScoringInput, weights: ScoringWeights = DEFAULT_WEIGHTS): ScoringResult {
  const now = input.now ?? new Date();
  const evidence: Evidence[] = [];
  // Zero-point rows are kept deliberately: "No budget confirmed" and "No
  // buying signal detected yet" are the most useful lines in the explainer.
  const add = (e: Evidence) => evidence.push(e);

  // ---- FIT -----------------------------------------------------------------
  let fit = 0;
  const industry = lower(input.company.industry);
  const icpIndustry = input.icp.industries.find((i) => industry.includes(i.toLowerCase()));
  if (icpIndustry) {
    fit += 34;
    add({
      dimension: "fit",
      points: 34,
      label: `Industry matches your ICP: ${input.company.industry}`,
      sourceType: "company.industry",
      sourceRef: input.company.industry ?? undefined,
    });
  } else if (input.icp.industries.length > 0) {
    add({
      dimension: "fit",
      points: 0,
      label: `Industry "${input.company.industry ?? "unknown"}" is outside your stated ICP`,
      sourceType: "company.industry",
    });
  }

  const place = `${lower(input.company.city)} ${lower(input.company.state)}`;
  const icpLocation = input.icp.locations.find((l) => place.includes(l.toLowerCase()));
  if (icpLocation) {
    fit += 20;
    add({
      dimension: "fit",
      points: 20,
      label: `Located in a target region: ${input.company.city ?? icpLocation}`,
      sourceType: "company.location",
      sourceRef: input.company.city ?? undefined,
    });
  }

  const size = input.company.employeeCount;
  if (size !== null) {
    const min = input.icp.employeeMin ?? 0;
    const max = input.icp.employeeMax ?? Number.MAX_SAFE_INTEGER;
    if (size >= min && size <= max) {
      fit += 26;
      add({
        dimension: "fit",
        points: 26,
        label: `Company size fits (${size} employees, target ${min}–${input.icp.employeeMax ?? "∞"})`,
        sourceType: "company.employeeCount",
      });
    } else {
      const near = size >= min * 0.6 && size <= max * 1.6;
      if (near) {
        fit += 10;
        add({
          dimension: "fit",
          points: 10,
          label: `Company size is close to your target band (${size} employees)`,
          sourceType: "company.employeeCount",
        });
      }
    }
  }

  const techOverlap = input.company.technologies.filter((t) =>
    input.icp.technologies.some((it) => it.toLowerCase() === t.toLowerCase())
  );
  if (techOverlap.length > 0) {
    const pts = Math.min(20, techOverlap.length * 10);
    fit += pts;
    add({
      dimension: "fit",
      points: pts,
      label: `Runs technology you target: ${techOverlap.join(", ")}`,
      sourceType: "company.technologies",
    });
  }

  const exclusionHit = input.icp.exclusions.find(
    (x) => industry.includes(x.toLowerCase()) || lower(input.company.name).includes(x.toLowerCase())
  );
  if (exclusionHit) {
    fit = Math.max(0, fit - 45);
    add({
      dimension: "fit",
      points: -45,
      label: `Matches an ICP exclusion: "${exclusionHit}"`,
      sourceType: "icp.exclusions",
    });
  }

  // ---- INTENT --------------------------------------------------------------
  let intent = 0;
  const ranked = [...input.signals]
    .map((s) => ({
      signal: s,
      value: (SIGNAL_INTENT_WEIGHT[s.type] ?? 12) * decay(s.occurredAt, now) * (s.confidence / 100),
    }))
    .sort((a, b) => b.value - a.value);

  if (ranked.length > 0) {
    // Strongest signal counts fully; each additional one contributes less, so
    // ten weak posts never outrank one explicit buying statement.
    ranked.forEach(({ signal, value }, i) => {
      const contribution = value / (i + 1);
      intent += contribution;
      if (i < 3 && contribution >= 2) {
        add({
          dimension: "intent",
          points: Math.round(contribution),
          label:
            i === 0
              ? `Strongest buying signal: ${humanSignal(signal.type)}`
              : `Supporting signal: ${humanSignal(signal.type)}`,
          detail: signal.excerpt?.slice(0, 160),
          sourceType: "signal",
          signalId: signal.id,
        });
      }
    });
  } else {
    add({
      dimension: "intent",
      points: 0,
      label: "No buying signal detected yet",
      sourceType: "signal",
    });
  }

  if (input.engagement.repliedAt) {
    intent += 18;
    add({
      dimension: "intent",
      points: 18,
      label: "They replied to your outreach",
      sourceType: "conversation.reply",
    });
  }
  if (input.engagement.proposalViews >= 3) {
    intent += 14;
    add({
      dimension: "intent",
      points: 14,
      label: `Opened your proposal ${input.engagement.proposalViews} times`,
      sourceType: "proposal.views",
    });
  }

  // ---- URGENCY -------------------------------------------------------------
  let urgency = 0;
  const signalText = input.signals
    .map((s) => `${s.excerpt ?? ""} ${s.keywords.join(" ")}`)
    .join(" ")
    .toLowerCase();

  const urgencyHit = anyMatch(signalText, URGENCY_PHRASES);
  if (urgencyHit) {
    urgency += 44;
    add({
      dimension: "urgency",
      points: 44,
      label: `Names a timeline or active evaluation ("${urgencyHit}")`,
      sourceType: "signal.language",
    });
  }

  const triggerHit = input.icp.triggerEvents.find((t) => signalText.includes(t.toLowerCase()));
  if (triggerHit) {
    urgency += 26;
    add({
      dimension: "urgency",
      points: 26,
      label: `Matches a trigger event you watch for: ${triggerHit}`,
      sourceType: "icp.triggerEvents",
    });
  }

  const freshest = input.signals.reduce<Date | null>(
    (acc, s) => (!acc || s.occurredAt > acc ? s.occurredAt : acc),
    null
  );
  if (freshest) {
    const days = (now.getTime() - freshest.getTime()) / 86_400_000;
    if (days <= 2) {
      urgency += 30;
      add({
        dimension: "urgency",
        points: 30,
        label: "Signal is less than 48 hours old",
        sourceType: "signal.recency",
      });
    } else if (days <= 7) {
      urgency += 18;
      add({
        dimension: "urgency",
        points: 18,
        label: "Signal appeared this week",
        sourceType: "signal.recency",
      });
    }
  }

  // ---- AUTHORITY -----------------------------------------------------------
  let authority = 0;
  const title = lower(input.role.title);
  const seniorityKey = input.role.seniority ?? inferSeniority(title);
  const seniorityPts = SENIORITY_POINTS[seniorityKey] ?? 25;
  authority += seniorityPts * 0.6;
  add({
    dimension: "authority",
    points: Math.round(seniorityPts * 0.6),
    label: `Seniority: ${input.role.title}`,
    sourceType: "employment.title",
  });

  if (input.role.isDecisionMaker) {
    authority += 24;
    add({
      dimension: "authority",
      points: 24,
      label: "Holds decision-making authority for this kind of purchase",
      sourceType: "employment.isDecisionMaker",
    });
  }

  const roleMatch = input.icp.buyerRoles.find((r) => title.includes(r.toLowerCase()));
  if (roleMatch) {
    authority += 20;
    add({
      dimension: "authority",
      points: 20,
      label: `Matches a buyer role you sell to: ${roleMatch}`,
      sourceType: "icp.buyerRoles",
    });
  }

  // ---- BUDGET --------------------------------------------------------------
  let budget = 0;
  if (input.budget.estimatedInr && input.budget.estimatedInr > 0) {
    budget += 42;
    add({
      dimension: "budget",
      points: 42,
      label: "An estimated deal size has been established",
      sourceType: "lead.estimatedBudget",
    });
  }
  const budgetHit = anyMatch(signalText, BUDGET_PHRASES);
  if (budgetHit) {
    budget += 30;
    add({
      dimension: "budget",
      points: 30,
      label: `Mentions budget or commercial terms ("${budgetHit}")`,
      sourceType: "signal.language",
    });
  }
  if (input.signals.some((s) => s.type === "FUNDING")) {
    budget += 22;
    add({
      dimension: "budget",
      points: 22,
      label: "Recently raised funding — spending capacity is likely",
      sourceType: "signal",
    });
  }
  // Tracked separately: headcount is a proxy for capacity to spend, not
  // evidence that money has been approved.
  const hasDirectBudgetEvidence = budget > 0;
  if (size !== null && size >= 200) {
    budget += 16;
    add({
      dimension: "budget",
      points: 16,
      label: `Organisation size (${size}) implies a real budget line`,
      sourceType: "company.employeeCount",
    });
  }
  if (!hasDirectBudgetEvidence) {
    add({
      dimension: "budget",
      points: 0,
      label: "No budget confirmed",
      detail: "Nothing in the record indicates approved spend. Worth a discovery question.",
      sourceType: "derived",
    });
  }

  // ---- REACHABILITY --------------------------------------------------------
  let reachability = 0;
  const live = input.contacts.filter((c) => !c.optedOut);
  const verifiedEmail = live.find(
    (c) => (c.kind === "WORK_EMAIL" || c.kind === "PERSONAL_EMAIL") && c.status === "VERIFIED"
  );
  const anyEmail = live.find((c) => c.kind === "WORK_EMAIL" || c.kind === "PERSONAL_EMAIL");
  const anyPhone = live.find((c) => c.kind === "MOBILE" || c.kind === "DIRECT_PHONE");
  const hasLinkedIn = live.some((c) => c.kind === "LINKEDIN_URL");

  if (verifiedEmail) {
    reachability += 46;
    add({
      dimension: "reachability",
      points: 46,
      label: "Verified email address available",
      sourceType: "contactMethod",
    });
  } else if (anyEmail) {
    reachability += 22;
    add({
      dimension: "reachability",
      points: 22,
      label: "Email address available but not verified",
      sourceType: "contactMethod",
    });
  }
  if (anyPhone) {
    reachability += 30;
    add({
      dimension: "reachability",
      points: 30,
      label: anyPhone.isLocked ? "Direct phone number available to reveal" : "Direct phone number on file",
      sourceType: "contactMethod",
    });
  }
  if (hasLinkedIn) {
    reachability += 16;
    add({
      dimension: "reachability",
      points: 16,
      label: "Reachable on LinkedIn",
      sourceType: "contactMethod",
    });
  }
  if (input.contacts.some((c) => c.optedOut)) {
    reachability = Math.max(0, reachability - 60);
    add({
      dimension: "reachability",
      points: -60,
      label: "This person has opted out of contact",
      detail: "Suppression is enforced before any send.",
      sourceType: "suppression",
    });
  }
  if (reachability === 0) {
    add({
      dimension: "reachability",
      points: 0,
      label: "No usable contact channel yet",
      sourceType: "contactMethod",
    });
  }

  // ---- ENGAGEMENT ----------------------------------------------------------
  let engagement = 0;
  const { outboundCount, inboundCount, meetingsHeld, proposalViews } = input.engagement;
  if (inboundCount > 0) {
    const pts = Math.min(44, inboundCount * 22);
    engagement += pts;
    add({
      dimension: "engagement",
      points: pts,
      label: `${inboundCount} inbound ${inboundCount === 1 ? "message" : "messages"} from them`,
      sourceType: "message",
    });
  }
  if (meetingsHeld > 0) {
    const pts = Math.min(40, meetingsHeld * 26);
    engagement += pts;
    add({
      dimension: "engagement",
      points: pts,
      label: `${meetingsHeld} ${meetingsHeld === 1 ? "meeting" : "meetings"} held`,
      sourceType: "booking",
    });
  }
  if (proposalViews > 0) {
    const pts = Math.min(20, proposalViews * 6);
    engagement += pts;
    add({
      dimension: "engagement",
      points: pts,
      label: `Proposal viewed ${proposalViews} ${proposalViews === 1 ? "time" : "times"}`,
      sourceType: "proposalView",
    });
  }
  if (outboundCount > 3 && inboundCount === 0) {
    engagement = Math.max(0, engagement - 15);
    add({
      dimension: "engagement",
      points: -15,
      label: `${outboundCount} messages sent with no response`,
      detail: "Consider changing channel or angle rather than sending again.",
      sourceType: "message",
    });
  }
  if (outboundCount === 0 && inboundCount === 0) {
    add({
      dimension: "engagement",
      points: 0,
      label: "No contact attempted yet",
      sourceType: "derived",
    });
  }

  // ---- RECENCY -------------------------------------------------------------
  let recency = 0;
  if (freshest) {
    const days = (now.getTime() - freshest.getTime()) / 86_400_000;
    recency = Math.round(100 * Math.pow(0.5, days / 14));
    add({
      dimension: "recency",
      points: recency,
      label:
        days < 1
          ? "Activity within the last 24 hours"
          : `Most recent evidence is ${Math.round(days)} ${Math.round(days) === 1 ? "day" : "days"} old`,
      sourceType: "signal.recency",
    });
  }

  const dimensions: Record<Dimension, number> = {
    fit: clamp(Math.round(fit), 0, 100),
    intent: clamp(Math.round(intent), 0, 100),
    urgency: clamp(Math.round(urgency), 0, 100),
    authority: clamp(Math.round(authority), 0, 100),
    budget: clamp(Math.round(budget), 0, 100),
    reachability: clamp(Math.round(reachability), 0, 100),
    engagement: clamp(Math.round(engagement), 0, 100),
    recency: clamp(Math.round(recency), 0, 100),
  };

  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const composite = clamp(
    Math.round(
      (Object.keys(dimensions) as Dimension[]).reduce(
        (sum, k) => sum + dimensions[k] * weights[k],
        0
      ) / weightTotal
    ),
    0,
    100
  );

  return {
    dimensions,
    composite,
    displayScore: Math.round((composite / 10) * 10) / 10,
    tier: tierFor(composite),
    intent: intentLevelFor(dimensions.intent, dimensions.urgency, !!input.engagement.repliedAt),
    evidence,
  };
}

export function tierFor(composite: number, cutoffs = { a: 80, b: 60, c: 40 }): "A" | "B" | "C" | "D" {
  if (composite >= cutoffs.a) return "A";
  if (composite >= cutoffs.b) return "B";
  if (composite >= cutoffs.c) return "C";
  return "D";
}

export function intentLevelFor(
  intentScore: number,
  urgencyScore: number,
  hasReplied: boolean
): "COLD" | "AWARE" | "WARM" | "HOT" | "BUYING" {
  const blended = intentScore * 0.7 + urgencyScore * 0.3;
  // "Buying" is deliberately rare. It claims someone is actively purchasing,
  // which is the strongest statement the system makes about a person.
  if (hasReplied && blended >= 68) return "BUYING";
  if (blended >= 80) return "BUYING";
  if (blended >= 60) return "HOT";
  if (blended >= 38) return "WARM";
  if (blended >= 16) return "AWARE";
  return "COLD";
}

function inferSeniority(title: string): string {
  if (/founder|co-founder/.test(title)) return "founder";
  if (/\b(ceo|cto|cfo|coo|cio|cmo|cro)\b/.test(title)) return "c-level";
  if (/owner|proprietor|partner/.test(title)) return "owner";
  if (/president/.test(title)) return "president";
  if (/\bvp\b|vice president/.test(title)) return "vp";
  if (/director/.test(title)) return "director";
  if (/head of|head,/.test(title)) return "head";
  if (/senior manager|sr\.? manager/.test(title)) return "senior_manager";
  if (/manager/.test(title)) return "manager";
  if (/lead\b/.test(title)) return "lead";
  if (/senior|sr\./.test(title)) return "senior";
  return "individual";
}

function humanSignal(type: string): string {
  return (
    {
      RFP: "a published RFP or tender",
      SOCIAL_POST: "a public post about their need",
      ANNOUNCEMENT: "a company announcement",
      HIRING: "hiring for a role tied to what you sell",
      TECH_CHANGE: "a change in their technology stack",
      SOCIAL_COMMENT: "a public comment about their need",
      FUNDING: "a funding round",
      NEWS: "press coverage",
      WEBSITE_UPDATE: "a change on their website",
      JOB_CHANGE: "a decision maker changing roles",
      EVENT: "event participation",
      REVIEW: "a public review",
      COMPETITOR_MENTION: "a mention of a competitor",
      EMAIL_ACTIVITY: "email engagement",
      PROPOSAL_ACTIVITY: "activity on your proposal",
      MEETING: "a meeting that took place",
      MANUAL_NOTE: "a note you recorded",
    }[type] ?? "a detected signal"
  );
}

export const DIMENSION_LABELS: Record<Dimension, { label: string; question: string }> = {
  fit: { label: "ICP Fit", question: "Do they look like the customers you sell to?" },
  intent: { label: "Intent", question: "Is there evidence they want to buy this?" },
  urgency: { label: "Urgency", question: "Is there a timeline forcing a decision?" },
  authority: { label: "Authority", question: "Can this person actually decide?" },
  budget: { label: "Budget", question: "Is there money available for it?" },
  reachability: { label: "Reachability", question: "Can you actually contact them?" },
  engagement: { label: "Engagement", question: "Have they responded to you?" },
  recency: { label: "Recency", question: "How fresh is the evidence?" },
};
