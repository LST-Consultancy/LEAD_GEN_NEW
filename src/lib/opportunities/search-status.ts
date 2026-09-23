export type SearchJobOutcome =
  | { state: "unavailable" }
  | { state: "missing" }
  | { state: "waiting"; workers: number | null }
  | { state: "in_progress" }
  | { state: "failed"; reason: string; attempts: number };

export type SearchJobVerdict = { fail: string } | { notice: string } | null;

// Enqueue happens before the start request returns, so a job missing after this long was lost, not late.
export const MISSING_JOB_GRACE_MS = 120_000;

export function judgeSearchJob(outcome: SearchJobOutcome, createdAt: Date, now: Date): SearchJobVerdict {
  switch (outcome.state) {
    case "failed":
      // A worker started before this job type existed rejects it by name; retrying cannot help.
      if (outcome.reason.startsWith("No handler registered"))
        return { fail: "The background worker is running older code that cannot run this search. Restart the worker, then start the search again. Nothing was charged." };
      return { fail: `The search stopped after ${outcome.attempts} failed ${outcome.attempts === 1 ? "attempt" : "attempts"}. Nothing was saved or charged. Start it again; if it fails again, check Settings → Workers & Background Jobs.` };
    case "missing":
      return now.getTime() - createdAt.getTime() > MISSING_JOB_GRACE_MS
        ? { fail: "This search is no longer in the queue, so it will not run. Nothing was charged. Start it again." }
        : null;
    case "waiting":
      return outcome.workers === 0
        ? { notice: "No background worker is running, so this search has not started. It will run as soon as a worker connects." }
        : null;
    default:
      return null;
  }
}
