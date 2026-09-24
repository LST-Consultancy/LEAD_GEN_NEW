/**
 * What a job title does and does not tell us about purchase authority.
 *
 * A title is a claim about rank, not proof of signing power. Only the ranks that
 * normally hold budget are marked *likely* decision makers; the UI labels that as
 * inferred. "Procurement analyst" or "administrator" used to be marked decision
 * makers because a broad pattern matched, which overstated who could say yes.
 */
export type Seniority = "c_level" | "vp" | "director" | "head" | "manager" | "individual";

const RULES: [Seniority, RegExp][] = [
  ["c_level", /\b(chief\s+\w+\s+officer|c[etfoisdm]o|founder|co-?founder|owner|president|managing director|partner)\b/i],
  ["vp", /\b(vp|svp|evp|vice[\s-]president)\b/i],
  ["director", /\bdirector\b/i],
  ["head", /\bhead\b/i],
  ["manager", /\b(manager|lead|supervisor)\b/i],
];

// Roles worth storing from a contact search: people who buy, run or influence systems work.
const RELEVANT = /\b(c[etfoi]o|chief|founder|owner|president|partner|vp|vice[\s-]president|director|head|manager|lead|procurement|purchasing|finance|it\b|technology|systems|operations|erp|administrator)\b/i;

export function titleAuthority(title: string | null | undefined): { seniority: Seniority; likelyDecisionMaker: boolean; relevant: boolean } {
  const t = (title ?? "").trim();
  const seniority = RULES.find(([, re]) => re.test(t))?.[0] ?? "individual";
  return { seniority, likelyDecisionMaker: seniority === "c_level" || seniority === "vp", relevant: RELEVANT.test(t) };
}

/** Identity key for "the same person at the same company", tolerant of case, spacing and accents. */
export function personKey(fullName: string): string {
  return fullName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
