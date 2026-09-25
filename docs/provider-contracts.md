# Provider and Actor contracts

These were checked against the vendors' own documentation and the public Apify API on
2026-09-25. No provider calls were made with credentials and no credits were spent. Anything
marked **unconfirmed** was not verified, and the code does not depend on it.

## Stage-level fallback providers

Each Apify enrichment stage runs first. When it finds nothing, fails, or leaves fields empty, the
same stage may use the providers below. The executable version of this table is
`lib/enrichment/capabilities.ts`; the orchestrator (`lib/services/fallback-orchestrator.ts`) calls
only an operation marked supported there, and only when it has that call's inputs.

| Operation | SignalHire | Hunter | Apollo |
| --- | --- | --- | --- |
| Company identity (name → domain) | **Not supported.** The Company API looks up only by SignalHire id or LinkedIn slug. | `GET /v2/domain-finder?company=`. Free, but blocked once the monthly search quota is used. Returns `data[]{domain, company_name}`. | `POST /api/v1/mixed_companies/search` with `q_organization_name`. 1 credit per page, paid plans only. |
| Company details (by domain) | Not supported | `GET /v2/companies/find?domain=`. 1 credit, charged only when the full record comes back. Returns `name, category.industry, geo{city,state,country}, linkedin.handle, metrics{employees, employeesCount}`. | `GET /api/v1/organizations/enrich?domain=`. 1 credit. |
| People at the company | `POST /api/v1/candidate/searchByQuery` with `currentCompany` and `currentTitle`. No credits; uses the daily search quota. Profiles have `uid, fullName, location, experience[{company,title}]`, no LinkedIn URL, no `current` flag. The first role listed is the latest. | `GET /v2/domain-search?domain=&type=personal`. 1 credit per 1–10 addresses returned. `emails[]{value, first_name, last_name, position, linkedin, verification.status}`. | `POST /api/v1/mixed_people/api_search`. 0 credits; the key needs this endpoint in scope, otherwise 403 `API_INACCESSIBLE`. Last names are obfuscated, so each kept result is revealed with `POST /people/match?id=` for 1 credit. |
| Business email for a person | `POST /api/v1/candidate/search` with `{items:[linkedinUrl], withoutWaterfall:true}`. 1 credit per match. Synchronous mode only, because full mode needs a public callback. | `GET /v2/email-finder?domain&first_name&last_name`. 1 credit only when found. 451 means the person opted out. | `POST /api/v1/people/match`. 1 credit when data is found. `match_confidence` is `high`, `medium`, `low` or `none`. |
| Email verification | **Not supported.** `rating` is not a mailbox check. | `GET /v2/email-verifier?email=`. `status`: `valid`, `invalid`, `accept_all`, `webmail`, `disposable`, `unknown`. 202 means still checking. | **Not supported.** `email_status` is Apollo's label, not a check. |

Error codes, as the docs state them, and as `classifyProviderError` maps them:

- **Hunter**
  - 401 → key refused.
  - 403 → rate limited. The exception is a `no_…` code such as `no_discover_access`, which means the plan does not include the call.
  - 429 → monthly usage exceeded (quota).
  - 451 → opted out, treated as no match.
- **Apollo**
  - 401 → key refused.
  - 403 → not entitled: master-key or scope required, or a paid plan only.
  - 422 → missing input.
  - 429 → rate limited.
- **SignalHire**
  - 401 → key refused.
  - 402 → credits or search quota used up.
  - 403 → account disabled or API not enabled.
  - 406 → validation.
  - 429 → rate limited.
- **Any provider**
  - 5xx or network → transient.
  - A body that fails the adapter's zod schema → `malformed`. That usually means the API changed, and the stage says the adapter needs checking.

**Identity, ownership and verification are separate.**

- **Identity.** A returned person's address is attached only when `checkIdentity` (`lib/enrichment/identity-gate.ts`) rates the match `confirmed` or `supported`:
  - `confirmed`: the same LinkedIn profile.
  - `supported`: the same name, and the provider places them at this company.
  - A different profile, name or employer is a `conflict`. A low-confidence match with nothing else is `weak`.
  - Both `conflict` and `weak` are kept on the company as a possible match for review, and the next provider is still tried.
- **Ownership** is recorded as how the address came to be theirs.
- **Verification** only ever comes from a mailbox check: the Apify verifier, or Hunter's.

**Limits.**

- Every provider call is written to the `ProviderCall` ledger *before* it is made, under a row lock on the workspace.
- Paid calls are capped per run and per day across runs. Free searches have their own per-run cap.
- A call already answered for the same target inside the freshness window is not repeated unless the user chooses "Run again".
- If a call started but its answer was lost (a worker died mid-call), it is reported as interrupted and not repeated.
- These caps count calls. They are not a money ceiling, because each provider's plan sets the price.

No live call has been made against any of these endpoints with a real key in this environment.
The shapes above come from the vendors' documentation. They are exercised by replays of the documented example responses (not captured live traffic) in
`tests/provider-replays.test.ts`.

## Apify discovery Actors

These are the reference Actors for multi-platform discovery. A price is the FREE-tier price per
event, in USD; paid plans are cheaper.

| Platform | Actor | Cookies | Price | Input used | Output read |
| --- | --- | --- | --- | --- | --- |
| LinkedIn jobs | `curious_coder/linkedin-jobs-scraper` | none | $0.002 per item | `keywords`, `location`, `datePosted` (`anyTime\|past24Hours\|pastWeek\|pastMonth`), `limitPerSource`, `scrapeCompany` | `id, link, title, companyName, companyLinkedinUrl, companyWebsite, companyEmployeesCount, location, postedAt, descriptionText, employmentType, industries, jobPosterName, jobPosterTitle, jobPosterProfileUrl` |
| Indeed | `valig/indeed-jobs-scraper` | none | $0.0001 per item + $0.001 per start | `country` (lowercase), `title`, `location`, `limit`, `datePosted` (`""\|1\|3\|7\|14`) | `key, url, title, jobUrl, datePublished, location{city,countryCode}, employer{name, corporateWebsite, employeesCount, industry}, description{text}` |
| Naukri | `muhammetakkurtt/naukri-job-scraper` | none | $0.0015 per search item + $0.001 per start | `jobBoard: "naukri"`, `keyword`, `maxJobs`, `freshness` (`all\|30\|15\|7\|3\|1`), `sortBy: "date"`, `cities` | `title, companyName, companyId, jobId, jdURL, experience, salary, location, createdDate, tagsAndSkills, jobDescription` |
| Google Search | `apify/google-search-scraper` | none | $0.0045 per page + $0.001 per start | `queries` (a **string**, one query per line), `maxPagesPerQuery`, `countryCode`, `quickDateRange` (e.g. `w1`, `m1`) | `organicResults[] {title, url, description, position}`. Do not send `resultsPerPage`, which is no longer in the schema. A result date is unconfirmed. |
| Reddit | `trudax/reddit-scraper-lite` | none | $0.004 per result + $0.02 per start | `searches[]`, `searchPosts: true`, `searchComments: false`, `sort: "new"`, `time`, `maxItems`, `maxPostCount`, `skipComments: true`, `includeNSFW: false` | `id, url, username, title, communityName, body, createdAt, dataType, over18` |
| Upwork | `neatrat/upwork-job-scraper` | optional (not sent) | about $0.0035 per job; whether it is charged twice is unconfirmed | `query`, `sort: "newest"`, `perPage`, `pagesToScrape`, `maxJobAge {value, unit}` | `id, title, description, url, budget, absoluteDate, jobType, experienceLevel, clientLocation, clientName, clientNameConfidence, paymentVerified, tags` |
| Google Maps | `compass/crawler-google-places` | none | $0.004 per place + $0.00005 per start | `searchStringsArray`, `locationQuery`, `maxCrawledPlacesPerSearch`, `language`, `skipClosedPlaces: true` | `title, website, phone, address, city, state, countryCode, categoryName, totalScore, reviewsCount, url, placeId, permanentlyClosed` |
| Public websites | `apify/website-content-crawler` | none | compute only (unconfirmed) | `startUrls[{url}]`, `crawlerType: "cheerio"`, `maxCrawlPages` (always capped), `maxCrawlDepth`, `respectRobotsTxtFile: true` | `url, metadata{title, description}, text` |
| LinkedIn posts (existing) | `apimaestro/linkedin-posts-search-scraper-no-cookies` | none | $0.005 per item | see `lib/opportunities/linkedin-plan.ts` | unchanged |

Things to get right:

- Google's `queries` is a string, not an array.
- `misceres/indeed-scraper` has no date filter, which is why `valig/indeed-jobs-scraper` is the default.
- Reddit needs `includeNSFW: false`.
- The website crawler must always have `maxCrawlPages` set. Its default is effectively unlimited.
