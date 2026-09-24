/**
 * The standard deal plan: sales → delivery → cash, eleven steps.
 *
 * Pure data. Versioned so a plan records which template it came from; changing
 * the template later never rewrites an existing plan, whose steps are its own.
 * This is a sensible default for a services business, not a copy of anyone's
 * method — edit the steps on the plan to fit the deal.
 */
export type PlanPhase = "sales" | "delivery" | "cash";
export type TemplateStep = { key: string; phase: PlanPhase; title: string; completionCriteria: string; dependsOn: string[]; isClientGate?: boolean };

export const STANDARD_PLAN = {
  key: "standard",
  version: 1,
  steps: [
    { key: "discovery", phase: "sales", title: "Discovery call", completionCriteria: "Pain, budget owner and timeline written down.", dependsOn: [] },
    { key: "scope", phase: "sales", title: "Scope agreed", completionCriteria: "A written scope the buyer has confirmed.", dependsOn: ["discovery"] },
    { key: "proposal", phase: "sales", title: "Proposal sent", completionCriteria: "Proposal link live and shared.", dependsOn: ["scope"] },
    { key: "negotiation", phase: "sales", title: "Commercials settled", completionCriteria: "Price, terms and start date agreed.", dependsOn: ["proposal"] },
    { key: "signed", phase: "sales", title: "Contract signed", completionCriteria: "Signed contract or PO received.", dependsOn: ["negotiation"], isClientGate: true },
    { key: "kickoff", phase: "delivery", title: "Kick-off", completionCriteria: "Team, plan and first milestone agreed with the client.", dependsOn: ["signed"] },
    { key: "delivery", phase: "delivery", title: "Deliver the work", completionCriteria: "Every scoped item delivered.", dependsOn: ["kickoff"] },
    { key: "signoff", phase: "delivery", title: "Client sign-off", completionCriteria: "The client confirms the work is accepted.", dependsOn: ["delivery"], isClientGate: true },
    { key: "invoice", phase: "cash", title: "Invoice raised", completionCriteria: "Invoice recorded on the deal.", dependsOn: ["signed"] },
    { key: "payment", phase: "cash", title: "Payment received", completionCriteria: "Payment recorded on the deal.", dependsOn: ["invoice"] },
    { key: "review", phase: "cash", title: "Account review", completionCriteria: "Outcome, referral or expansion noted.", dependsOn: ["signoff", "payment"] },
  ] satisfies TemplateStep[],
} as const;

export const STEP_STATUS = ["todo", "in_progress", "blocked", "done", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUS)[number];

type StepState = { key: string; status: string; dependsOn: string[] };

/** Dependencies that still stop this step. Done or skipped counts as out of the way. */
export function waitingOn(step: StepState, all: StepState[]): string[] {
  return step.dependsOn.filter((k) => {
    const dep = all.find((s) => s.key === k);
    return dep && dep.status !== "done" && dep.status !== "skipped";
  });
}

/** True if following dependsOn from any step can come back to it. */
export function hasCycle(steps: { key: string; dependsOn: string[] }[]): boolean {
  const by = new Map(steps.map((s) => [s.key, s.dependsOn]));
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const d of by.get(k) ?? []) if (visit(d)) return true;
    state.set(k, 2);
    return false;
  };
  return steps.some((s) => visit(s.key));
}
