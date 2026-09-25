import type { SearchCriteria, OpportunityType } from "./query-parser";
export type SourceDocument = {
  provider: string; kind: string; externalId: string; sourceUrl: string;
  title: string; description: string; company: { name: string; domain?: string; location?: string; country?: string; industry?: string; employees?: number };
  location?: string; employmentType?: string; postedAt: string | null; updatedAt?: string | null;
  closingAt?: string | null; applicationUrl?: string; rawSourceReference: Record<string, unknown>;
  status?: "ACTIVE" | "CLOSED" | "EXPIRED" | "OPEN" | "AWARDED" | "CANCELLED" | "UNKNOWN";
};
export function sourceDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
export function plainText(value: string) { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot);/g, " ").replace(/\s+/g, " ").trim().slice(0, 30000); }
export function extractOpportunity(doc: SourceDocument, criteria: SearchCriteria) {
  const text = plainText(`${doc.title}. ${doc.description}`);
  // A freelance marketplace post is, by definition, a client asking for an outside provider.
  const vendor = doc.kind === "FREELANCE_PROJECT" || /(?:looking for|seeking|need|require|inviting|request for)[^.]{0,130}(?:partner|vendor|agency|consultancy|external (?:development )?team)|\brfp\b|request for proposals/i.test(text);
  const hiring = doc.kind === "JOB_BOARD" || /\b(?:hiring|job opening|join our team|we are recruiting)\b/i.test(text);
  const requirement = vendor || hiring || /(?:plan(?:ning)?|need|require|migrat(?:e|ing)|implement(?:ing)?)[^.]{0,100}(?:implementation|integration|migration|software|development|ERP|CRM|NetSuite|Salesforce)/i.test(text);
  const types: OpportunityType[] = [];
  if (hiring) types.push("INTERNAL_HIRING");
  if (vendor) types.push("EXTERNAL_VENDOR");
  if (requirement) for (const [type, re] of [["IMPLEMENTATION", /implement/i], ["INTEGRATION", /integrat/i], ["MIGRATION", /migrat/i], ["CONSULTING", /consult/i], ["OUTSOURCING", /outsourc|external (?:development )?team/i], ["STAFF_AUGMENTATION", /staff augment/i], ["PROJECT", /project|build|development/i], ["RFP", /\brfp\b|tender|request for proposals/i], ["DIGITAL_TRANSFORMATION", /digital transformation/i]] as [OpportunityType, RegExp][]) if (re.test(text)) types.push(type);
  if (!types.length) types.push("UNKNOWN");
  const technologies = criteria.technologies.filter(t => text.toLowerCase().includes(t.toLowerCase()));
  const service = criteria.services.find(s => text.toLowerCase().includes(s.toLowerCase())) ?? technologies[0] ?? criteria.services[0];
  const relevant = criteria.expandedTerms.some(t => text.toLowerCase().includes(t.toLowerCase())) || technologies.length > 0;
  return { companyName: doc.company.name, opportunityTypes: types, service, technologies, requirements: requirement ? [text.slice(0, 600)] : [],
    location: doc.location ?? doc.company.location ?? null, isExternalVendorOpportunity: vendor, isInternalHiring: hiring,
    isProjectRequirement: requirement, isImplementation: types.includes("IMPLEMENTATION"), isIntegration: types.includes("INTEGRATION"), isMigration: types.includes("MIGRATION"), isConsulting: types.includes("CONSULTING"), isOutsourcing: types.includes("OUTSOURCING"),
    budgetMentioned: /(?:budget|estimated value)\s*[:\w]*\s*[$£€₹\d]/i.test(text), timelineMentioned: /deadline|by \w+ \d|this quarter|this month|urgent/i.test(text),
    urgency: /urgent|immediately|asap/i.test(text) ? "HIGH" : "UNKNOWN", postedAt: sourceDate(doc.postedAt), closingAt: sourceDate(doc.closingAt),
    relevant: relevant && !criteria.negativeKeywords.some(t => text.toLowerCase().includes(t.toLowerCase())), evidence: [text.slice(0, 1000)] };
}
