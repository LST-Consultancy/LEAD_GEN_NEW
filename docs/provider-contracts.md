# Provider and Actor contracts

These were checked against the vendors' own documentation and the public Apify API on
2026-09-25. No provider calls were made with credentials and no credits were spent. Anything
marked **unconfirmed** was not verified, and the code does not depend on it.

## Contact providers (the fallback after Apify)

| Provider | Call used | Auth | Cost | Notes |
| --- | --- | --- | --- | --- |
| SignalHire | `POST https://www.signalhire.com/api/v1/candidate/search` with `{ items: [linkedinUrl], withoutWaterfall: true }` | `apikey` header | 1 credit per successful match | The full lookup delivers results **only** to a public `callbackUrl`, and they cannot be polled. A self-hosted instance cannot receive that, so the app uses synchronous mode, which reads SignalHire's stored data and finds fewer contacts. Item `status`: `success`, `failed`, `credits_are_over`, `timeout_exceeded`, `duplicate_query`. Each contact is `{type, value, rating, subType}`; `subType` for an email is `work`, `personal` or null. Personal emails are not used. Health check: `GET /credits` returns `{credits}`. |
| Hunter | `GET https://api.hunter.io/v2/email-finder?domain&first_name&last_name` | `api_key` query | 1 credit, only when an address is found | Returns `data.email`, `score`, `accept_all` and `verification.status`. A 451 response means the person asked Hunter not to process their data, and the app records it as a note, not an error. Health check: `GET /account` is free. |
| Apollo | `POST https://api.apollo.io/api/v1/people/match` | `x-api-key` header | 1 credit when data is found | People API Search returns no emails, so it is not used. `reveal_personal_emails` and `reveal_phone_number` are always false; phone numbers need a webhook and cost 8 extra credits. `match_confidence` is `high`, `medium`, `low` or `none`. `email_status` only documents `verified`; the other values are unconfirmed. Health check: `GET /auth/health` returns `{healthy, is_logged_in}`. |

No provider's own confidence score or status counts as a verification here. A check result
comes only from the verify stage (`lib/enrichment/verification.ts`).

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
