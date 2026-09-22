/**
 * The lead filter contract. Deliberately free of any database or server import
 * so both the client filter UI and the server query builder can share it —
 * one definition of what a filter *is*.
 */

import { z } from "zod";

export const leadFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  tiers: z.array(z.enum(["A", "B", "C", "D"])).optional(),
  statuses: z
    .array(z.enum(["NEW", "WORKING", "CONTACTED", "REPLIED", "QUALIFIED", "NURTURE", "UNQUALIFIED"]))
    .optional(),
  intents: z.array(z.enum(["COLD", "AWARE", "WARM", "HOT", "BUYING"])).optional(),
  minScore: z.coerce.number().min(0).max(10).optional(),
  maxScore: z.coerce.number().min(0).max(10).optional(),
  industries: z.array(z.string()).optional(),
  cities: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  employeeMin: z.coerce.number().optional(),
  employeeMax: z.coerce.number().optional(),
  seniorities: z.array(z.string()).optional(),
  departments: z.array(z.string()).optional(),
  decisionMakersOnly: z.coerce.boolean().optional(),
  signalTypes: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  budgetMin: z.coerce.number().optional(),
  budgetMax: z.coerce.number().optional(),
  surfacedWithinDays: z.coerce.number().optional(),
  notContactedForDays: z.coerce.number().optional(),
  replied: z.coerce.boolean().optional(),
  reachable: z.coerce.boolean().optional(),
  revealed: z.coerce.boolean().optional(),
  starred: z.coerce.boolean().optional(),
  hasBudget: z.coerce.boolean().optional(),
  hasSignal: z.coerce.boolean().optional(),
  noOutreach: z.coerce.boolean().optional(),
  needsFollowUp: z.coerce.boolean().optional(),
  ownerIds: z.array(z.string().uuid()).optional(),
  listId: z.string().uuid().optional(),
  includeArchived: z.coerce.boolean().optional(),
  /** AND is the default; OR broadens across the multi-value groups. */
  combine: z.enum(["AND", "OR"]).default("AND"),
  sort: z
    .enum(["score", "surfaced", "activity", "value", "name", "company", "intent"])
    .default("score"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(10).max(200).default(50),
});

export type LeadFilter = z.infer<typeof leadFilterSchema>;

// --------------------------------------------------------------------------
// Smart shortcuts (§18) — each is a named filter with a live count.
// --------------------------------------------------------------------------

export const SHORTCUTS: {
  key: string;
  label: string;
  hint: string;
  filter: Partial<LeadFilter>;
}[] = [
  {
    key: "richest-vein",
    label: "Richest vein",
    hint: "Tier A and B with a signal in the last 14 days and a way to reach them",
    filter: { tiers: ["A", "B"], surfacedWithinDays: 14, reachable: true },
  },
  {
    key: "score-8-plus",
    label: "Score 8+",
    hint: "The strongest leads in the workspace",
    filter: { minScore: 8 },
  },
  {
    key: "reachable-now",
    label: "Reachable now",
    hint: "Verified contact already revealed — no points needed",
    filter: { revealed: true, reachable: true },
  },
  {
    key: "names-a-budget",
    label: "Names a budget",
    hint: "An estimated deal size has been established",
    filter: { hasBudget: true },
  },
  {
    key: "decision-makers",
    label: "Decision makers",
    hint: "People who can actually sign",
    filter: { decisionMakersOnly: true },
  },
  {
    key: "fresh-today",
    label: "Fresh today",
    hint: "Surfaced in the last 24 hours",
    filter: { surfacedWithinDays: 1 },
  },
  {
    key: "hot-intent",
    label: "Hot intent",
    hint: "Hot or actively buying",
    filter: { intents: ["HOT", "BUYING"] },
  },
  {
    key: "no-outreach",
    label: "No outreach yet",
    hint: "Never contacted, despite the score",
    filter: { noOutreach: true, minScore: 6 },
  },
  {
    key: "replied",
    label: "Replied",
    hint: "They responded — these outrank everything else",
    filter: { replied: true },
  },
  {
    key: "needs-follow-up",
    label: "Needs follow-up",
    hint: "A next action is due or overdue",
    filter: { needsFollowUp: true },
  },
  {
    key: "dormant-warming",
    label: "Dormant but warming",
    hint: "Quiet for 21+ days, then a new signal appeared",
    filter: { notContactedForDays: 21, hasSignal: true, surfacedWithinDays: 7 },
  },
];
