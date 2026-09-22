/**
 * What a playbook step can be, and whether it can actually run.
 *
 * A playbook is a promise that a sequence of things will happen. Most of that
 * promise rests on tools, and this app has tools that are defined but not yet
 * built. So the only honest way to show a playbook is to resolve every step
 * against the registry and report what is missing — an "Active" toggle over
 * steps that cannot execute is a control that silently does nothing.
 *
 * Pure and DB-free so the same resolution runs on both sides.
 */

/** Steps that are control flow rather than a tool call. These always work. */
export const CONTROL_ACTIONS: Record<string, string> = {
  wait: "Pauses the playbook for a stated period before continuing.",
  watch: "Keeps the lead under observation without contacting anyone.",
};

export type StepStatus = "control" | "built" | "unbuilt" | "unknown";

export type ResolvedStep = {
  order: number;
  action: string;
  note?: string;
  status: StepStatus;
  /** One sentence on why this step is or isn't runnable. */
  reason: string;
};

export type PlaybookHealth = {
  runnable: number;
  unbuilt: string[];
  unknown: string[];
  /** True when not one step could do anything. */
  inert: boolean;
  /** The sentence the screen shows. Null when the playbook can run end to end. */
  blockedBecause: string | null;
};

export function resolveSteps(
  steps: { order: number; action: string; note?: string }[],
  tools: { name: string; implemented: boolean }[]
): ResolvedStep[] {
  const byName = new Map(tools.map((t) => [t.name, t]));

  return [...steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => {
      const control = CONTROL_ACTIONS[step.action];
      if (control) {
        return { ...step, status: "control" as const, reason: control };
      }
      const tool = byName.get(step.action);
      if (!tool) {
        return {
          ...step,
          status: "unknown" as const,
          reason: "No tool by this name exists, so nothing would happen at this step.",
        };
      }
      return tool.implemented
        ? { ...step, status: "built" as const, reason: "This tool is built and would run." }
        : {
            ...step,
            status: "unbuilt" as const,
            reason: "This tool is defined but not built yet, so the playbook would stop here.",
          };
    });
}

export function healthOf(steps: ResolvedStep[]): PlaybookHealth {
  const unbuilt = steps.filter((s) => s.status === "unbuilt").map((s) => s.action);
  const unknown = steps.filter((s) => s.status === "unknown").map((s) => s.action);
  const runnable = steps.filter((s) => s.status === "built" || s.status === "control").length;

  // A playbook whose only runnable steps are waits does nothing either — it
  // would sit there and then stop, which reads as working until you check.
  const doesSomething = steps.some((s) => s.status === "built");
  const inert = !doesSomething;

  let blockedBecause: string | null = null;
  if (inert && steps.length === 0) {
    blockedBecause = "This playbook has no steps, so running it would do nothing.";
  } else if (inert) {
    blockedBecause =
      unknown.length && !unbuilt.length
        ? `No step names a tool that exists (${unknown.join(", ")}), so running this would do nothing.`
        : `Every step that would act needs a tool that isn't built yet (${[...unbuilt, ...unknown].join(", ")}), so running this would do nothing.`;
  } else if (unbuilt.length || unknown.length) {
    const first = steps.find((s) => s.status === "unbuilt" || s.status === "unknown");
    blockedBecause = `It would stop at step ${first?.order} — \`${first?.action}\` ${
      first?.status === "unbuilt" ? "isn't built yet" : "isn't a tool that exists"
    }.`;
  }

  return { runnable, unbuilt, unknown, inert, blockedBecause };
}
