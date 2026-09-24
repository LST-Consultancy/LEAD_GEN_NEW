import { DISCOVERY_REASON } from "@/lib/vocab";
import type { Funnel, StopReason } from "./linkedin-run";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const top = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined;

// What to do about the commonest rejection, where there is something useful to say.
const ADVICE: Record<string, string> = {
  seller_promotion: "Buyer-phrased searches still return many vendor posts; that share is normal on LinkedIn.",
  not_relevant: "The queries reached posts that do not mention the subject. Editing them to quote the exact product or service name narrows that.",
  internal_hiring: "Many results were employee vacancies. Posts that hire an agency, freelancer or contractor are kept.",
  outside_date_window: "Many results were older than the date range. A longer range would include them.",
  job_seeker: "Many results were people looking for work.",
  informational: "Many posts discuss the topic without asking for anything.",
};

/**
 * Sentences explaining a run's result, each built only from a count that was recorded. A
 * sentence whose number is not there is not said — this never guesses at why LinkedIn returned
 * what it did.
 */
export function explainRun(f: Funnel, stop: StopReason, opts: { targetQualified: number; maxPosts: number }): string[] {
  const out: string[] = [];
  const qualified = f.qualifiedNew + f.qualifiedKnown;
  const reviewed = Object.values(f.review).reduce((a, b) => a + b, 0);
  const rejected = Object.values(f.rejected).reduce((a, b) => a + b, 0);
  if (f.pagesCompleted === 0) return out;
  if (f.returned === 0) {
    out.push(`LinkedIn returned no posts for ${plural(f.queriesRun, "query", "queries")} in this date range.`);
    return out;
  }
  if (f.duplicates > 0 && f.duplicates >= f.returned * 0.3) out.push(`${f.duplicates} of ${f.returned} posts returned were repeats of posts another query or page had already found, so they are counted once.`);
  if (f.unmappable > 0) out.push(`${plural(f.unmappable, "record")} could not be read as a post and ${f.unmappable === 1 ? "was" : "were"} not used.`);
  const worst = top(f.rejected);
  if (worst && rejected >= f.unique * 0.4) {
    out.push(`${worst[1]} of ${f.unique} unique posts were set aside as “${DISCOVERY_REASON[worst[0]]?.label.toLowerCase() ?? worst[0]}”.${ADVICE[worst[0]] ? ` ${ADVICE[worst[0]]}` : ""}`);
  }
  const waiting = top(f.review);
  if (waiting) out.push(`${plural(reviewed, "relevant post")} ${reviewed === 1 ? "needs" : "need"} a person to confirm ${reviewed === 1 ? "it" : "them"}, most often because: ${DISCOVERY_REASON[waiting[0]]?.label.toLowerCase() ?? waiting[0]}.`);
  if (qualified < opts.targetQualified) {
    if (stop === "depth_limit") out.push("Some queries were still returning new posts when they reached the page limit. A deeper search may find more, and uses more Apify results.");
    if (stop === "budget_posts") out.push(`The budget of ${opts.maxPosts} posts was used before reaching the target of ${opts.targetQualified}.`);
    if (stop === "results_exhausted") out.push("Every query ran out of new results before the target was reached.");
  }
  return out;
}
