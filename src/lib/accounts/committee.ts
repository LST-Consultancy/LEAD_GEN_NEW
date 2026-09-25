/**
 * The buying committee at an account: a suggested role for each person from their title, and
 * which roles the mapped committee covers. Pure and deterministic — a suggestion states the words
 * in the title it rests on, and stays a suggestion until a person confirms it.
 */
export const COMMITTEE_ROLES = ["CHAMPION", "DECISION_MAKER", "INFLUENCER", "TECHNICAL_EVALUATOR", "FINANCE", "PROCUREMENT", "BLOCKER", "UNKNOWN"] as const;
export type CommitteeRole = typeof COMMITTEE_ROLES[number];
/** The roles a typical B2B purchase needs someone for; a champion and blocker come from conversations, not titles. */
export const KEY_ROLES: CommitteeRole[] = ["DECISION_MAKER", "CHAMPION", "TECHNICAL_EVALUATOR", "FINANCE", "PROCUREMENT"];

const RULES: [RegExp, CommitteeRole][] = [
  [/\b(procurement|purchas\w*|sourcing|vendor manage\w*|buyer)\b/i, "PROCUREMENT"],
  [/\b(cfo|finance|financial|controller|accounts?|treasur\w*)\b/i, "FINANCE"],
  [/\b(cto|cio|architect|engineer\w*|technical|technology|it manager|head of it|devops|security|data)\b/i, "TECHNICAL_EVALUATOR"],
  [/\b(ceo|founder|co-?founder|managing director|md|president|owner|coo|chief|vp|vice president|director|head)\b/i, "DECISION_MAKER"],
  [/\b(manager|lead|specialist|analyst|consultant|executive|officer)\b/i, "INFLUENCER"],
];

export function suggestRole(title: string | null, likelyDecisionMaker = false): { role: CommitteeRole; basis: string } {
  const t = (title ?? "").trim();
  if (!t) return { role: "UNKNOWN", basis: "No title is recorded, so no role can be suggested." };
  for (const [re, role] of RULES) {
    const m = re.exec(t);
    if (m) {
      // A senior title that is also a function (VP Finance) keeps the function; seniority is carried by influence.
      return { role, basis: `The title “${t}” contains “${m[0]}”.` };
    }
  }
  return likelyDecisionMaker ? { role: "DECISION_MAKER", basis: `Marked as a likely decision maker from the title “${t}”.` } : { role: "UNKNOWN", basis: `Nothing in the title “${t}” indicates a buying role.` };
}

export function coverage(members: { role: string; confirmed: boolean }[]) {
  const confirmed = members.filter(m => m.confirmed);
  const covered = KEY_ROLES.filter(r => confirmed.some(m => m.role === r));
  return {
    covered, missing: KEY_ROLES.filter(r => !covered.includes(r)),
    singleThreaded: confirmed.length <= 1,
    blockers: confirmed.filter(m => m.role === "BLOCKER").length,
    unconfirmed: members.length - confirmed.length,
  };
}
