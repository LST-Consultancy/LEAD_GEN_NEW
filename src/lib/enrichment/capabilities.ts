/**
 * What each enrichment provider can do, per operation, from its official API documentation
 * (checked 2026-09-25; see docs/provider-contracts.md). The orchestrator only calls an operation a
 * provider supports, and only when it has the inputs that operation needs; anything else is
 * skipped with the reason written here. Pure and client-safe, so Settings shows the same table.
 *
 * Nothing here claims more than the docs say: SignalHire has no verifier and no company lookup by
 * name or domain; Apollo has no verifier; only Hunter verifies mailboxes.
 */
export const OPERATIONS = ["company", "people", "emails", "verify"] as const;
export type Operation = typeof OPERATIONS[number];
export const OPERATION_LABEL: Record<Operation, string> = { company: "Company identity and details", people: "People at the company", emails: "Business email for a person", verify: "Email verification" };

export type Need = "company_name" | "domain" | "person_linkedin" | "person_name" | "email";
export type Cost = "free" | "quota" | "credit";
export type Capability =
  | { supported: true; calls: { name: string; endpoint: string; needs: Need[]; cost: Cost; costNote: string }[]; notes?: string }
  | { supported: false; why: string };

export type EnrichmentProvider = "signalhire" | "hunter" | "apollo";

export const CAPABILITIES: Record<EnrichmentProvider, Record<Operation, Capability>> = {
  signalhire: {
    company: { supported: false, why: "SignalHire's Company API looks a company up only by its SignalHire ID or LinkedIn slug, not by name or domain, and is off unless SignalHire enables it for the account." },
    people: { supported: true, calls: [{ name: "Search by query", endpoint: "POST /api/v1/candidate/searchByQuery", needs: ["company_name"], cost: "quota", costNote: "No credits; counts against the account's daily search quota." }], notes: "Results carry name, location and each role's company and title, but no LinkedIn URL and no 'current' flag — the first role listed is taken as the latest." },
    emails: { supported: true, calls: [{ name: "Person API (synchronous)", endpoint: "POST /api/v1/candidate/search", needs: ["person_linkedin"], cost: "credit", costNote: "1 credit per successful match." }], notes: "Synchronous mode only (no public callback URL), which reads SignalHire's stored data and finds fewer contacts." },
    verify: { supported: false, why: "SignalHire has no verification endpoint; its contact 'rating' is not a mailbox check." },
  },
  hunter: {
    company: { supported: true, calls: [
      { name: "Domain Finder", endpoint: "GET /v2/domain-finder?company=", needs: ["company_name"], cost: "free", costNote: "Free; blocked once the monthly search quota is used up." },
      { name: "Company Enrichment", endpoint: "GET /v2/companies/find?domain=", needs: ["domain"], cost: "credit", costNote: "1 search credit, charged only when name, category, description, location and size all come back." },
    ] },
    people: { supported: true, calls: [{ name: "Domain Search", endpoint: "GET /v2/domain-search?domain=&type=personal", needs: ["domain"], cost: "credit", costNote: "1 search credit per 1–10 addresses returned; nothing when none." }], notes: "People are found through addresses Hunter has seen on the web for the domain, so each comes with an address." },
    emails: { supported: true, calls: [{ name: "Email Finder", endpoint: "GET /v2/email-finder?domain=&first_name=&last_name=", needs: ["domain", "person_name"], cost: "credit", costNote: "1 credit, only if an address is found." }] },
    verify: { supported: true, calls: [{ name: "Email Verifier", endpoint: "GET /v2/email-verifier?email=", needs: ["email"], cost: "credit", costNote: "1 verification credit; a 202 means still checking." }] },
  },
  apollo: {
    company: { supported: true, calls: [
      { name: "Organization Search", endpoint: "POST /api/v1/mixed_companies/search (q_organization_name)", needs: ["company_name"], cost: "credit", costNote: "1 credit per page; paid plans only." },
      { name: "Organization Enrichment", endpoint: "GET /api/v1/organizations/enrich?domain=", needs: ["domain"], cost: "credit", costNote: "1 credit per organisation." },
    ] },
    people: { supported: true, calls: [
      { name: "People API Search", endpoint: "POST /api/v1/mixed_people/api_search", needs: ["domain"], cost: "free", costNote: "0 credits; needs a key with this endpoint in scope (or a master key). Last names are obfuscated." },
      { name: "People Enrichment by id", endpoint: "POST /api/v1/people/match?id=", needs: [], cost: "credit", costNote: "1 credit to reveal a person's full name and business email." },
    ], notes: "Search returns obfuscated last names, so each person worth keeping is revealed with a paid match before being saved." },
    emails: { supported: true, calls: [{ name: "People Enrichment", endpoint: "POST /api/v1/people/match", needs: ["person_name", "domain"], cost: "credit", costNote: "1 credit when data is found; none when match confidence is 'none'." }], notes: "A LinkedIn URL can stand in for name and domain." },
    verify: { supported: false, why: "Apollo has no verification endpoint; the email_status on an enrichment is Apollo's label, not a mailbox check." },
  },
};

/** Which of an operation's needs are missing from what is known. */
export function missingNeeds(needs: Need[], have: Partial<Record<Need, boolean>>): Need[] {
  return needs.filter(n => !have[n]);
}
export const NEED_LABEL: Record<Need, string> = { company_name: "the company's name", domain: "the company's domain", person_linkedin: "the person's LinkedIn profile", person_name: "the person's first and last name", email: "an address to check" };
