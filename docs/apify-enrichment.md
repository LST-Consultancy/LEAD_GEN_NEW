# Opportunity enrichment through Apify

Research company → company details → relevant people → email discovery → email checks, on one
opportunity, using only Apify Actors billed to the workspace's Apify account. No Hunter,
SignalHire or other key is needed. Hunter and SignalHire remain available to callers of the older
`/api/opportunities/[id]/enrich|verify` routes and are never used by this workflow.

## Setup

1. **Settings → Lead Sources & APIs → Apify enrichment → Configure.** Leave the token blank to use
   the Apify token already saved for *LinkedIn posts (via Apify)*, or enter one.
2. Tick the licence box (search, storage and enrichment rights), set retention, save.
3. **Test API access.** Free: it calls Apify's `/users/me` and reads each configured Actor's metadata.
   It cannot prove a paid run will succeed — a plan's spending limit is only discovered by running.
4. The worker must be running (`npm run worker`). Buttons refuse with a message when Redis or the
   connection is missing; nothing is created or charged in that case.

Defaults (all editable in the form): 10 people per company, 10 website pages, 20 email checks per
run, re-check an address after 30 days, research fresh for 30 days, **budget $1.00 per run**,
Actor run timeout 240 s, auto-enrichment **off**.

## Actors

Checked against each Actor's published input schema, example output and pricing on
**2026-09-24** (Apify API `acts/{id}/builds/default` and the Store page). Prices are the listed
FREE-tier figures; higher Apify plans are cheaper. The screen labels every figure before a run as
an estimate and shows Apify's reported `usageTotalUsd` after it.

| Stage | Actor | Input used | Fields read | Listed price |
|---|---|---|---|---|
| Company search | `apify/google-search-scraper` | `queries` (newline-separated), `maxPagesPerQuery: 1`, `maximumLeadsEnrichmentRecords: 0`, optional `countryCode` | `organicResults[].{url,title,description}` | $0.001 start + $0.0045 per results page |
| Company profile | `harvestapi/linkedin-company` | `companies: [url]` or `searches: [name]` | `linkedinUrl, name, website, description/tagline, industries[0], employeeCount, employeeCountRange.{start,end}, locations[].{headquarter, parsed.{city,state,country}}` | $0.004 per company |
| People | `harvestapi/linkedin-company-employees` | `companies: [url]`, `profileScraperMode`, `maxItems`, `searchQuery` (OR of role titles) | `linkedinUrl, publicIdentifier, firstName, lastName, headline, location.parsed, experience[].{position, companyName, companyLinkedinUrl, endDate.text}, currentPosition[]` | $0.02 start + $0.003 / $0.008 / $0.012 per profile (Short / Full / Full + email) |
| Website emails | `automation-lab/website-contact-finder` | `urls: ["https://<domain>"]`, `maxPagesPerSite`, `verifyEmails: false` | `emails[], contactPageUrl, websiteUrl, scanStatus, failureReason.message, pagesSucceeded, socialLinks.linkedin` | $0.035 start + $0.001 per page |
| Email checks | `bounceverify/bounceverify-email-verifier` (default) | `emails: [...]` | `syntax_valid, domain_exists, mx_found, smtp_valid, is_catch_all, is_disposable, status, reason` | $0.00089 per email |
| Email checks (alternative) | `michael.g/email-verifier-validator` | `emails: [...]` | `technical_status` (valid, invalid, unknown, catch_all, disposable), `reason`, `error` | $0.10 per email on FREE, $0.001 from Bronze |

Why a separate checker: the website contact finder's `verifyEmails` only checks addresses *it found
during its own crawl*, so it cannot check addresses from the sources or the employee search.
Neither checker needs an account outside Apify (both stated on their Store pages).

**Not documented, so handled cautiously:** the email field produced by the employee Actor's
*Full + email search* mode does not appear in its README example. It is off by default; when on,
only `email` / `emails` values that are plain addresses are read, and each is stored with a note
that the field is undocumented. The profile's `verified` flag is LinkedIn's badge and is never read
as email verification.

## What each outcome means

| Stored result | Meaning | Contact status |
|---|---|---|
| `MAILBOX_CONFIRMED` | The mail server accepted this address. Not a promise of delivery. | VERIFIED |
| `DOMAIN_VALID` | The domain has mail servers; the mailbox was not confirmed. | UNVERIFIED |
| `SYNTAX_VALID` | Format only. | UNVERIFIED |
| `CATCH_ALL` | The domain accepts any address, so the mailbox cannot be confirmed. | UNVERIFIED |
| `INVALID` | Syntax, domain or mailbox rejected, or a disposable provider. | FAILED |
| `INCONCLUSIVE` | The server refused or did not answer the check. | UNVERIFIED |
| `UNKNOWN` | No usable result. | UNVERIFIED |

Each check stores the Actor, format, time, result, reason and the Actor's original row.

## Rules the implementation keeps

- **A name is not an identity.** A candidate company scores 40 for a name match; resolving needs 60
  and a 20-point lead over the runner-up, from links in the opportunity's own source, the website
  appearing in search, headquarters country and description. Otherwise the run stops at *Needs
  company selection* and shows each candidate's evidence and conflicts.
- **Confirmed beats found.** A value a person chose is marked `confirmedBy` and never overwritten
  by automation; a value of unknown origin is kept and the disagreement recorded; a domain already
  held by another company in the workspace is not taken.
- **Every Actor run is recorded before waiting** (`ApifyRun`). A retry, worker restart or timeout
  re-reads that run; a start whose reply was lost is found by comparing its stored `INPUT`.
- **People are kept without emails, titles or last names**, and marked current, former (all
  positions at the company have ended) or uncertain (returned by the search, no position here).
  Decision-making authority is always labelled as inferred from a title.
- **Role addresses are company contacts** (`CompanyContactPoint`), never given to a person. An
  address is given to a person only when it contains their name, and to nobody if two people fit.
  Addresses on other domains are set aside. Nothing is guessed from a name pattern.
- **Only qualified opportunities are auto-enriched**, only when enabled, above an intent threshold,
  and at most *N* a day, each within the per-run budget.
- **Enrichment never changes the opportunity's status** and never starts outreach.

## Not supported

- **Company-only CRM leads.** A Lead requires a person in this data model, so a company with only
  a generic address cannot be converted; its company contacts stay on the company.
- **Webhooks from Apify.** Runs are polled; there is no Apify webhook endpoint to deduplicate.
