# Opportunity intelligence implementation

The existing Signalroom application now has a persistent opportunity discovery path. It is an initial implementation, not completion of every item in the implementation brief. No external results are seeded. Provider fixtures exist only in tests and use fictional domains.

## Run

1. Run `npx prisma migrate deploy` and `npx prisma generate`.
2. Keep the existing `DATABASE_URL`, `REDIS_URL` and authentication settings. Add `PROVIDER_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hex characters. Keep it stable and secret; losing it makes stored credentials unreadable.
3. Start `npm run dev` and restart the worker with `npm run worker` so it loads the new job catalogue.
4. Open `/settings/providers`. A member with `api_keys.manage` can configure providers, confirm licence permissions and test API access. Discovery needs `leads.edit`; enrichment needs `leads.reveal`; CSV needs `leads.export`.
5. Open **Settings → Lead Sources & APIs**. Greenhouse, Lever and Ashby use the company-board form (slug, company, confirmed domain, optional country). Brave works without a company list and can include indexed public LinkedIn posts. Adzuna uses an app ID, API key and selected country markets to discover new hiring companies. Query/page settings control request volume. Settings also reports encryption, Redis and connected workers, with a link to **Workers & Background Jobs**.
6. Enter a requirement at `/find-leads`, inspect expansion terms, choose sources, and start discovery. Progress and per-source failures are persisted. Open a result to inspect original evidence and source-change history.
7. Connect Hunter or SignalHire to find named company decision makers. Hunter is required to verify emails. SignalHire is used when Hunter is unavailable for the company or returns no contacts. These are separate operations; discovery alone never sets a verified status. Research uses the existing AI provider abstraction when its credentials are configured.
8. Save a daily watch. The hourly scheduler enqueues due saved searches. The API also supports 6, 24, 72 and 168 hour cadences. Notifications are in-app only, for previously unseen matches. No outreach is triggered.

## Files and integration

- Schema: `prisma/schema.prisma`.
- Migrations: `20260923050836_opportunity_subsystem` creates the opportunity tables (concurrently generated migration preserved); `20260923120000_opportunity_intelligence` documents duplicate reconciliation without data changes; `20260923123000_opportunity_tenant_ranking` adds the company tenant foreign key and active ranking flag. `20260923140000_discovery_candidates` adds the tenant-linked review inbox. All are additive; no reset was run.
- Pure engine: `src/lib/opportunities/{query-parser,extractor,scoring,identity}.ts`.
- Provider contract/adapters: `src/lib/providers/{opportunity-source,discovery,job-networks,signalhire,hunter,http,credentials}.ts`.
- Services: `src/lib/services/opportunities.ts` and `opportunity-{ingestion,providers,actions,jobs,watches,query,export}.ts`.
- UI: `src/components/opportunities/*`; `/opportunities`, `/opportunities/[id]`, `/settings/providers`; existing Find Leads, Live Demand, Accounts and Saved Alerts integrations.
- Worker: registered `opportunity.discovery`, `opportunity.action`, `opportunity.watches` in the existing Signalroom queue, using its retry/backoff policies and job monitor.
- Tests: `tests/opportunities.test.ts`, `tests/opportunity-{ingestion,providers,security}.test.ts`; `e2e/opportunities.spec.ts`.

## API routes

- `POST /api/opportunities/parse`: optional AI query analysis, validated fallback.
- `POST /api/opportunities/search`: queues discovery with caller-generated UUID idempotency key.
- `GET /api/opportunities/search/[id]`: state, progress, criteria and per-provider outcomes.
- `GET /api/opportunities`: tenant-scoped, paginated filters.
- `GET /api/opportunities/[id]`, `/evidence`, `/timeline`.
- `POST /api/opportunities/[id]/enrich`, `/verify`, `/research`: queued operations.
- `GET /api/opportunities/actions/[id]`: operation status.
- `POST /api/opportunities/[id]/crm`: reuse/create existing Lead person/company relationship.
- `GET /api/opportunities/export`: CSV for one filtered page; provider export rights required; contact suppression and credential provenance respected; spreadsheet formulas escaped.
- `POST /api/opportunity-searches`: creates a watch using existing SavedSearch.
- `POST /api/discovery-candidates/[id]`: dismiss a candidate or confirm its buying company and qualify against the original criteria.
- `GET /api/providers`, `POST /api/providers/[provider]/connect`, `/test`.

## Provider implementation and limitations

Adapters issue real HTTP requests to fixed official API hosts. No live paid-account results were used to validate them; tests exercise documented shapes through explicitly fictional fixtures.

- Brave: one to six query variants with up to 20 results each, plus up to two indexed public LinkedIn-post searches. No company list required. Known domains resolve automatically; other relevant snippets are deduplicated in `/opportunities/review`. Users confirm the buyer before qualification, and original filters still apply. Search-engine page age is stored as metadata, not asserted as the original posting date. Public indexing coverage is incomplete.
- Greenhouse: public Job Board API, up to 500 jobs per configured board. `updated_at` is not treated as a posting date.
- Lever: public postings API, up to 100 jobs per configured board. This is bounded discovery, not complete pagination.
- Ashby: up to 500 listed public postings per configured board, preserving supplied posting dates.
- Adzuna: searches 15 supported country markets, up to three pages of 50 results per keyword/country. No preconfigured company list required. Employer names are source-provided; domains and headcounts remain unknown. Descriptions are snippets; listings are not asserted to be currently open. Partial results survive a later HTTP or quota failure.
- SignalHire: licensed Search API plus synchronous Person API (`withoutWaterfall`), up to ten decision-maker profiles per company. Only current matching employment and work emails are used. Personal emails are excluded. Provider confidence is not treated as a fresh verification. Synchronous lookup has lower coverage than SignalHire's asynchronous waterfall. POST requests are not automatically retried, to avoid duplicate charges.
- Hunter: domain contact discovery, email finder adapter and email-verifier API. No phone discovery. Verification distinguishes valid, invalid, risky, accept-all, disposable and unknown. Role relevance is deterministic title matching, not a confirmed buying committee.
- Direct LinkedIn / Sales Navigator search: explicitly unavailable. No generic OAuth flow claims to grant search. An actual approved partner integration must be supplied and implemented for the customer's supported capabilities. No cookies, login automation, scraping or messaging.
- Apollo, news, public procurement and direct company-site crawling: declared unavailable, not implemented. There is no arbitrary URL fetcher, robots bypass or private-network crawler.

## Evidence, security and accounting

Tenant-scoped queries and composite foreign keys protect opportunity/source/search and company links. Credentials use AES-256-GCM with workspace/provider authenticated data. HTTP is restricted to documented HTTPS API hosts with redirects disabled, bounded response size, timeouts, shared Redis concurrency, minute/hour/day request limits and exponential retry for GET 429/5xx. POST requests are not automatically retried.

Source posting, first discovery, last observation, provider update and last content change are distinct. Missing posting dates remain null. Deterministic intent contributions sum to the displayed intent score, including cap adjustments. Internal-only hiring is capped at 40. Fit uses the existing primary ICP scorer and workspace weights. Unknown authority/reachability/engagement remain zero rather than invented. Technology mentions do not claim installed technology.

Exact provider identity, canonical source URLs and normalized company/title/location keys deduplicate sources. Fuzzy cross-title matching is deliberately not implemented. Company aliases without a domain use conservative name normalization.

ProviderSync logs operations and individual HTTP attempts without request URLs, credentials or bodies. Vendor credit amounts remain unknown when not returned. Opportunity actions currently cost zero Signalroom points; configurable PointLedger charging is not implemented. Vendor API calls may still consume vendor quota.

Unresolved discovery candidates carry expiry dates, are hidden after expiry and are purged by the watch sweep. Source expiry is stored and the watch sweep removes expired source text, evidence and versions; opportunities with no remaining sources are removed. Mixed-source records lose their derived summary and score until refreshed. Workspace contact-data retention/deletion workflows and more detailed provider-specific retention policies still need implementation; do not treat the current retention sweep as a complete compliance system.

## Remaining scope

The complete original specification is broader than this implementation. Remaining work includes broad company attribution/enrichment (including Apollo), a permitted company crawler, news/RFP adapters, licensed LinkedIn capabilities, installed-technology provenance, complete source pagination/removal detection, richer service taxonomy and multilingual parsing, fuzzy deduplication, all advanced filter controls and table contact columns, score refresh after enrichment, complete configurable billing, email alert delivery, external CRM synchronization/task creation, full retention/deletion, and full live-provider browser coverage. Browser tests cover query expansion, configuration/error states, authentication and an explicitly fictional search result opening persisted evidence and contact status; database/provider tests cover ingestion and evidence.

## Provider references

- [Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Hunter API](https://hunter.io/api-documentation)

## Validation notes

Validation can use `SIGNALROOM_BUILD_DIR=.next-opportunity-build npm run build` and `SIGNALROOM_BUILD_DIR=.next-opportunity-e2e E2E_BASE_URL=http://localhost:3107 npm run e2e -- e2e/opportunities.spec.ts` to avoid an already-running local server. These output folders are ignored by git and ESLint. The app's existing Google Fonts imports require build-time network access. BullMQ's existing optional Valkey-driver warning remains; this deployment uses ioredis.

Provider contract tests use fictional fixtures, not live paid-account credentials. Validation for the expanded connectors covers provider contracts, unresolved buyer review, tenant isolation, Settings controls, source failures and the persisted opportunity workflow.

- [SignalHire Search API](https://docs.signalhire.com/search-api/search-by-query)
- [SignalHire synchronous lookup](https://docs.signalhire.com/person-api/without-waterfall)
- [Adzuna job search](https://developer.adzuna.com/docs/search)
- [Ashby public postings](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [LinkedIn API access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
