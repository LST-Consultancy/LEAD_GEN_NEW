import { z } from "zod";

export const opportunityTypes = ["INTERNAL_HIRING", "EXTERNAL_VENDOR", "IMPLEMENTATION", "INTEGRATION", "CONSULTING", "OUTSOURCING", "STAFF_AUGMENTATION", "PROJECT", "RFP", "MIGRATION", "DIGITAL_TRANSFORMATION", "UNKNOWN"] as const;
export type OpportunityType = typeof opportunityTypes[number];
export const criteriaSchema = z.object({
  services: z.array(z.string().max(160)).max(30),
  technologies: z.array(z.string().max(80)).max(30),
  opportunityTypes: z.array(z.enum(opportunityTypes)),
  locations: z.array(z.string().max(100)).max(20),
  industries: z.array(z.string().max(100)).max(20).default([]),
  employeeMin: z.number().int().nonnegative().nullable().default(null),
  employeeMax: z.number().int().positive().nullable().default(null),
  dateRange: z.object({ days: z.number().int().min(1).max(3650) }),
  minimumIntent: z.number().min(0).max(100),
  expandedTerms: z.array(z.string().max(200)).max(40),
  negativeKeywords: z.array(z.string().max(80)).max(20).default([]),
  domains: z.array(z.string().max(253)).max(20).default([]),
});
export type SearchCriteria = z.infer<typeof criteriaSchema>;
// Vocabulary packs are composable; unknown services still get generic requirement expansions.
export const VOCABULARY = [
  { name: "NetSuite", pattern: /\bnetsuite\b|\bsuitescript\b/i, terms: ["NetSuite consultant", "SuiteScript", "NetSuite customization", "NetSuite managed services"] },
  { name: "Salesforce", pattern: /\bsalesforce\b/i, terms: ["Salesforce implementation partner", "Salesforce consultant", "CRM integration"] },
  { name: "Full-stack development", pattern: /full[ -]?stack|\bmern\b|\bmean\b/i, terms: ["Full Stack Developer", "Web Application Development", "React Developer", "Next.js Developer", "Node.js Developer", "MERN Developer", "MEAN Developer", "Frontend Developer", "Backend Developer", "Custom Software Development", "Web Development Agency"] },
  ...["React", "Next.js", "Node.js", "AI", "Software", "DevOps", "Cybersecurity", "SAP", "Oracle", "AWS", "Azure", "GCP", "HubSpot", "WordPress", "Shopify", "Kubernetes", "Docker", "Cloudflare"].map(name => ({ name, pattern: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), terms: [`${name} development`, `${name} consulting`] })),
];
const TYPE_PATTERNS: [OpportunityType, RegExp][] = [
  ["IMPLEMENTATION", /implement/i], ["INTEGRATION", /integrat/i], ["MIGRATION", /migrat/i], ["INTERNAL_HIRING", /hir(?:e|ing)|jobs?|developers?/i], ["EXTERNAL_VENDOR", /partner|vendor|agency/i], ["CONSULTING", /consult/i], ["OUTSOURCING", /outsourc|external team/i], ["STAFF_AUGMENTATION", /staff augment/i], ["RFP", /\brfp\b|tender|procurement/i], ["PROJECT", /project|build|development/i], ["DIGITAL_TRANSFORMATION", /digital transformation/i],
];
export function parseOpportunityQuery(raw: string): SearchCriteria {
  const query = z.string().trim().min(3).max(2000).parse(raw);
  const packs = VOCABULARY.filter(v => v.pattern.test(query));
  const types = TYPE_PATTERNS.filter(([, re]) => re.test(query)).map(([type]) => type);
  const actions = types.filter(t => ["IMPLEMENTATION", "INTEGRATION", "MIGRATION", "CONSULTING"].includes(t)).map(t => t.toLowerCase());
  const services = packs.length ? packs.flatMap(p => actions.length ? actions.map(a => `${p.name} ${a}`) : [p.name]) : [query.slice(0, 160)];
  const size = query.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s*(?:employees|people|staff)/i);
  const days = query.match(/(?:last|past|within)\s+(\d+)\s*days?/i);
  return criteriaSchema.parse({ services, technologies: packs.map(p => p.name), opportunityTypes: types,
    locations: [[/\bUS\b|\bUSA\b|United States/i, "United States"], [/\bUK\b|United Kingdom/i, "United Kingdom"], [/\bUAE\b|United Arab Emirates/i, "United Arab Emirates"], [/\bIndia\b/i, "India"]].filter(([re]) => (re as RegExp).test(query)).map(([, name]) => name),
    employeeMin: size ? Number(size[1].replaceAll(",", "")) : null, employeeMax: size ? Number(size[2].replaceAll(",", "")) : null,
    dateRange: { days: days ? Math.min(3650, Math.max(1, Number(days[1]))) : 30 }, minimumIntent: 0,
    expandedTerms: [...new Set([...services, ...packs.flatMap(p => p.terms), ...services.flatMap(s => [`${s} partner`, `looking for ${s}`, `${s} requirement`])])].slice(0, 40),
  });
}
