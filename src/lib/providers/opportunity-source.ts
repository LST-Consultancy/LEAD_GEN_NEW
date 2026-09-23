import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import type { SourceDocument } from "@/lib/opportunities/extractor";
export type ProviderCapabilities = { search: boolean; enrichment: boolean; verification: boolean; changes: boolean; limitation?: string };
export interface OpportunitySourceProvider {
  id: string;
  search(query: SearchCriteria): Promise<SourceDocument[]>;
  getOpportunity(id: string): Promise<SourceDocument | null>;
  getChanges(id: string): Promise<SourceDocument | null>;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
  getCapabilities(): ProviderCapabilities;
}
export const PROVIDERS = [
  { id: "brave", name: "Brave Public Web", kind: "PUBLIC_WEB", implemented: true, key: true, description: "Commercial search API. Storage requires a licence permitting retention. Searches the open web with buyer-phrased queries. A result is kept only when a buyer can be named: the page owner making its own request, or an organisation named in the text and checked word for word. Search indexes do not reach LinkedIn posts." },
  { id: "linkedin_posts", name: "LinkedIn posts (via Apify)", kind: "LINKEDIN", implemented: true, key: true, description: "Searches public LinkedIn posts through a third-party Apify scraper (apimaestro/linkedin-posts-search-scraper-no-cookies) with your Apify API token. This is not a LinkedIn API: scraping is against LinkedIn's User Agreement, and enabling it means your workspace accepts that risk. Apify bills your account for each post returned. A post is kept only when its text or its author's headline names the buyer organisation." },
  { id: "greenhouse", name: "Greenhouse", kind: "JOB_BOARD", implemented: true, key: false, description: "Public Job Board API for explicitly configured company boards. Posting dates may be unavailable." },
  { id: "lever", name: "Lever", kind: "JOB_BOARD", implemented: true, key: false, description: "Public postings API for explicitly configured company boards." },
  { id: "ashby", name: "Ashby", kind: "JOB_BOARD", implemented: true, key: false, description: "Public job postings from configured Ashby company boards." },
  { id: "adzuna", name: "Adzuna Jobs", kind: "JOB_BOARD", implemented: true, key: true, description: "Discover hiring companies across supported country job markets without a company list. Requires your app ID and API key." },
  { id: "signalhire", name: "SignalHire", kind: "CONTACT", implemented: true, key: true, description: "Find company decision makers and retrieve available work emails through the licensed Search and Person APIs. Synchronous lookup; coverage varies." },
  { id: "hunter", name: "Hunter", kind: "CONTACT", implemented: true, key: true, description: "Domain contact discovery and email verification through your licensed Hunter account." },
  { id: "linkedin", name: "LinkedIn / Sales Navigator", kind: "LINKEDIN", implemented: false, key: false, description: "LinkedIn capability unavailable for this connection. Generic member OAuth does not grant prospect search. A partner-approved integration is required." },
  { id: "apollo", name: "Apollo", kind: "CONTACT", implemented: false, key: true, description: "Not implemented. Requires a licensed account and permitted people enrichment capabilities." },
  { id: "company_site", name: "Company websites", kind: "COMPANY_SITE", implemented: false, key: false, description: "Direct crawling is disabled. Use configured public career feeds; a robots-aware, terms-approved crawler is not connected." },
  { id: "news", name: "News / press", kind: "NEWS", implemented: false, key: true, description: "No licensed news adapter connected." },
  { id: "rfp", name: "Public procurement", kind: "RFP", implemented: false, key: true, description: "No procurement adapter connected." },
] as const;
export type ProviderId = typeof PROVIDERS[number]["id"];

export const DISCOVERY_PROVIDERS = ["brave", "linkedin_posts", "greenhouse", "lever", "ashby", "adzuna"] as const;

export class PartialDiscoveryError extends Error {
  constructor(message: string, public readonly documents: SourceDocument[]) { super(message); }
}
