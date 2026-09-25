/**
 * Why an opportunity's fit is what it is, and how far along it is — kept as separate facts. Intent
 * (the source asks for something), fit (the company looks like your ICP), research (the company is
 * identified), contact readiness (someone reachable) and CRM (a lead exists) are independent: a
 * strong request from an unresearched company is high intent, unassessed fit, not contact ready.
 * Pure; shared by the screen and tests.
 */

export type FitIcp = { name: string; industries: string[]; locations: string[]; employeeMin: number | null; employeeMax: number | null; technologies: string[] };
export type FitCompany = { industry: string | null; city: string | null; state: string | null; country: string | null; employeeCount: number | null; technologies?: string[] };
export type FitLine = { points: number; label: string };
export type FitExplanation = { state: "no_icp" | "unassessed" | "partial" | "assessed"; headline: string; lines: FitLine[]; unknown: string[] };

const known = (v: string | null | undefined) => Boolean(v && v.trim() && v !== "Unknown");

/**
 * The fit score read against the primary ICP and the company fields it was computed from. A zero
 * with nothing known is "not assessed", never "a poor fit" — the two need opposite actions.
 */
export function explainFit(icp: FitIcp | null, company: FitCompany, fitScore: number, evidence: FitLine[]): FitExplanation {
  if (!icp) return { state: "no_icp", headline: "Not assessed: no primary ICP is set. Define one in Settings → ICP; a fit of 0 here means unmeasured, not a poor fit.", lines: [], unknown: [] };
  const unknown: string[] = [];
  const asked: string[] = [];
  if (icp.industries.length) { asked.push("industry"); if (!known(company.industry)) unknown.push(`industry (your ICP targets ${icp.industries.slice(0, 3).join(", ")}${icp.industries.length > 3 ? "…" : ""})`); }
  if (icp.employeeMin !== null || icp.employeeMax !== null) { asked.push("size"); if (company.employeeCount === null) unknown.push(`company size (target ${icp.employeeMin ?? 0}–${icp.employeeMax ?? "∞"} employees)`); }
  if (icp.locations.length) { asked.push("location"); if (!known(company.city) && !known(company.state)) unknown.push(`location (your ICP targets ${icp.locations.slice(0, 3).join(", ")})`); }
  const lines = evidence.filter(e => e.label);
  if (!asked.length) return { state: "assessed", headline: `Your ICP “${icp.name}” sets no industry, size or location, so fit rests on technology overlap alone (${fitScore}/100).`, lines, unknown };
  if (unknown.length === asked.length) return { state: "unassessed", headline: `Not assessed yet: this company's ${unknown.map(u => u.split(" (")[0]).join(", ")} ${unknown.length === 1 ? "is" : "are"} unknown, so it could not be compared with “${icp.name}”. Research company fills these in and fit is recomputed.`, lines, unknown };
  if (unknown.length) return { state: "partial", headline: `${fitScore}/100 against “${icp.name}”, from what is known. Still unknown: ${unknown.join("; ")} — so the score may be low for lack of evidence, not because the company does not fit.`, lines, unknown };
  return { state: "assessed", headline: `${fitScore}/100 against “${icp.name}”.`, lines, unknown };
}

export type Readiness = { key: "qualified" | "researched" | "contact_ready" | "in_crm"; label: string; done: boolean; detail: string };

/** The four stages, each true or false on its own evidence. */
export function readinessOf(input: {
  qualified: boolean; qualifiedWhy: string;
  companyResolved: boolean; researchedWhy: string;
  reachablePeople: number; peopleFound: number;
  leads: number;
}): Readiness[] {
  return [
    { key: "qualified", label: "Qualified opportunity", done: input.qualified, detail: input.qualifiedWhy },
    { key: "researched", label: "Company researched", done: input.companyResolved, detail: input.researchedWhy },
    { key: "contact_ready", label: "Contact ready", done: input.reachablePeople > 0,
      detail: input.reachablePeople ? `${input.reachablePeople} ${input.reachablePeople === 1 ? "person has" : "people have"} an address on the company's domain that has not failed a check.`
        : input.peopleFound ? `${input.peopleFound} ${input.peopleFound === 1 ? "person" : "people"} found, none with a usable company address yet. Find emails or a contact provider can fill this in.`
        : "Nobody found at the company yet. Use Find people." },
    { key: "in_crm", label: "In CRM", done: input.leads > 0, detail: input.leads ? `${input.leads} ${input.leads === 1 ? "lead carries" : "leads carry"} this opportunity's sources.` : "Not added to CRM. A lead can be created without an email address." },
  ];
}
