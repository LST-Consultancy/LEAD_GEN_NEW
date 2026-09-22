/**
 * Whether a meeting still needs its outcome recorded.
 *
 * One predicate, one meaning. The bookings screen previously had three
 * disagreeing versions of this question, and a seeded meeting that arrives
 * `completed` with empty outcomes was badged "Completed" with no way to record
 * what was said. Shared and DB-free so the screen and any server-side count
 * cannot drift apart again.
 */
export function needsOutcomeRecorded(b: {
  state: string;
  isPast: boolean;
  hasOutcome: boolean;
}): boolean {
  if (!b.isPast || b.hasOutcome) return false;
  return b.state === "scheduled" || b.state === "completed";
}
