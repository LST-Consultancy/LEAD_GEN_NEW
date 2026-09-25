# Acceptance matrix

**As of:** 2026-09-25.

**Scope:** the priority backlog N01–N23 and the ProspecX crosswalk features F001–F082, from
`current-priority-backlog.md` and `current-feature-crosswalk.md`. This document replaces the
"done" labels in `implementation-tracker.md` as the statement of what is proven.

## Status meanings

Every status is backed by code and tests in this repository. A status label alone proves nothing.

| Status | Meaning |
| --- | --- |
| **Not implemented** | No working code path. |
| **Partially implemented** | Works for part of the requirement; the gap is named. |
| **Implemented and locally tested** | The code path exists and automated tests pass. The tests run against the disposable `signalroom_test` database and Redis db 15, with every provider call mocked or replayed from recorded shapes. No live provider was called and nothing was sent or charged. |
| **Live integration verified** | Exercised against the real provider with real credentials inside an agreed budget. |
| **Blocked by a specific external dependency** | The dependency is named. Any code that can exist without it has been built. |

**No new integration built in this pass has been live-verified.** The constraints forbade spending
provider credits, sending outreach or invitations, connecting live accounts, and deploying to
production. Each one needs a bounded live test with your credentials, listed at the end.

## Priority backlog

| ID | Deliverable | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| N01 | Keep multi-domain contact evidence | Implemented and locally tested | `lib/enrichment/emails.ts`: `classify`, `corroborateAlias` and `domainLabel`. Domain states are matched, alias, review, rejected and free. Addresses on another domain are kept for review, never discarded. There is an accept/reject UI with an audit trail (`decideEmailDomain`), and a rejected domain stays rejected on later runs. Tests: `tests/enrichment-logic.test.ts` (E01) and `tests/apify-enrichment.test.ts` (review domain, accept/reject, tenant isolation). | Run one live enrichment on an Atzean-style company to confirm the `.com`/`.in` alias. |
| N02 | Correct employee mapping | Implemented and locally tested | `mapEmployee` reads `currentPositions[]` with `title`, `current` and `startedOn`, plus `location.linkedinText`, which are the fields in the recorded Short-mode datasets. Company industries are read as objects and the phone as `{number}`. A decision maker is flagged only when current. Tests use those recorded shapes. | Confirm on a live run. |
| N03 | Role and author prioritisation | Implemented and locally tested | `roleFocuses` merges vendor and technology focus, so a staffing ask with implementation tags still targets partnerships, vendor and delivery roles. `assessAuthor` keeps a recruiter who names the company, and records other authors as source contacts, shown in a "Named in the source" panel. | — |
| N04 | Fallback chain Apify → SignalHire → Hunter → Apollo | Implemented and locally tested | A new `contacts` stage (`stageContacts`) with a real Apollo adapter (`lib/providers/apollo.ts`, People Enrichment), SignalHire's synchronous Person API and Hunter Email Finder, all following the documented contracts in `docs/provider-contracts.md`. It has per-provider readiness, skips a provider that lacks a required input (with the reason), and stops at the first hit for each person. It has a per-run lookup cap and records every lookup before it happens, so nothing is paid twice. Progress is shown per provider. You can connect, test and disconnect all four providers. Off by default. Tests: `tests/apify-enrichment.test.ts` ("Contact-provider fallback"). | Live test with one lookup per provider. SignalHire's full lookup only delivers to a public callback URL, so the synchronous mode used here has lower coverage. |
| N05 | Email ownership and role addresses | Implemented and locally tested | Every address is reclassified whatever its source. Role addresses always become company contacts. A full-name match is labelled `inferred_from_name` and a first name plus initial never attaches. A provider association is labelled `provider_associated`. | — |
| N06 | No invented country | Implemented and locally tested | The import and the schema default are now "Unknown", and a country header alias was added. Tests: E06 in `tests/enrichment-logic.test.ts`. | Rows imported earlier as "India" are unchanged, because the right value can't be inferred. Review them by hand if it matters. |
| N07 | Requested Apify sources | Implemented and locally tested | `lib/opportunities/apify-platforms.ts` covers LinkedIn jobs, Indeed, Naukri, Google Search, Reddit, Upwork, Google Maps and public websites. Each Actor, input and output was checked (`docs/provider-contracts.md`). Each has settings, a date mapping that never narrows the window, limits, a per-search USD cap, a ledgered run with redelivery reuse, a free access test, and failure isolation. Tests: `tests/apify-discovery.test.ts`. | Live run per platform on your Apify account. Upwork's per-job charge (one event or two) is unconfirmed. |
| N08 | Offering-aware discovery | Implemented and locally tested | `OfferingProfile` model and Settings → Offerings. Routing (`lib/opportunities/offering.ts`): buyer phrases go to Google, Reddit and Upwork; job titles to job boards; categories to Maps. Results are marked as requests, hiring or business prospects. Maps results become prospect companies, never opportunities. Industries and company size stay with fit and are never used as filters. | — |
| N09 | Common multi-platform orchestration | Implemented and locally tested | One search can run up to 14 sources, each isolated with a checkpoint. There are ledgered runs for resume without re-charge, cancellation, and a per-platform budget. The per-platform funnel reconciles: returned = outside window + unreadable + repeated + assessed. | Cross-source duplicate counts are per platform; the global count is the search's `qualified` figure. |
| N10 | Live enrichment proof | Partially implemented | Tests replay redacted real Actor dataset shapes. | Needs one bounded live run per capability with your credentials. |
| N11 | Explain fit and readiness | Implemented and locally tested | `lib/opportunities/readiness.ts` and the opportunity page strip. Fit is shown as not assessed, partial or assessed, each with the unknown fields named. Fit is recomputed after research. Qualified, researched, contact-ready and in-CRM are read from rows. Tests: `tests/opportunity-readiness.test.ts`, plus an integration test. | — |
| N12 | Phrase and watch integration | Implemented and locally tested | A due phrase becomes a tracked search on the connected sources for its kind (`phrase-watches.ts`). Each run is a SearchRun. A match alerts once. A lead created from a phrase-found opportunity gets `sourcePhraseId`. Opening a watch restores its query, sources and options, and "Update watch" edits it in place. There is a Run-now button. Tests: `tests/phrase-watches.test.ts`. | — |
| N13 | Standalone Lead Lens and People Finder | Implemented and locally tested | An external lookup takes a LinkedIn profile (through SignalHire or Apollo) or a company page or domain (through Apify, accepting a page only when its own website matches). Low-confidence matches wait for your confirmation. Results are cached for 30 days. People Finder filters on origin (post author, enrichment, lookup, import), buyer side, switching, a date window and association, all in SQL. Tests: `tests/lead-lens.test.ts`. | A bare-name external search is deliberately workspace-only, because it matches many namesakes and costs a paid search. |
| N14 | Mailbox onboarding and inbound | Implemented and locally tested | Workspace IMAP mailboxes can be connected, tested, read on demand and revoked. The IMAP client is dependency-free, uses TLS only, and handles literals. A five-minute read-only sync matches replies by In-Reply-To/References. Auto-replies and bounces are recorded but never stop a sequence. A reply stops a stop-on-reply sequence exactly once. The gates use `readsReplies`, which looks at the workspace. Tests: `tests/mailboxes.test.ts` against a scripted IMAP server. | Gmail and Microsoft 365 OAuth mail are blocked on an OAuth app registered with Google or Microsoft (Gmail's read scope needs Google's restricted-scope verification). Sending still uses the server's SMTP relay. |
| N15 | WhatsApp and LinkedIn | WhatsApp Business: implemented and locally tested. Personal WhatsApp: blocked. LinkedIn automation: blocked. | Cloud API adapter with per-workspace encrypted credentials, a free check, opt-in evidence, the 24-hour and template rule, suppression, and idempotent sends. The HMAC-verified webhook handles replies (stopping sequences), STOP (suppressing across every channel) and receipts. Tests: `tests/whatsapp.test.ts`. LinkedIn stays assisted. | Live test needs your Meta Business number and token. Personal WhatsApp pairing has no official API, and the unofficial route breaks Meta's terms. LinkedIn automated DMs need LinkedIn partner API access. |
| N16 | Calendar | Google: implemented and locally tested. Microsoft and CalDAV: not implemented. | Google OAuth with signed state and a cookie nonce. Free/busy, and create, patch and delete events. Invitations go out only when you tick them, and the invitee is chosen by the recipient rules, so a suppressed address is never invited. Tokens refresh and revoke. Bookings report sync per booking. Tests: `tests/calendar.test.ts`. | Live test needs a Google Cloud OAuth client (GOOGLE_OAUTH_CLIENT_ID and _SECRET) with this app's callback registered. |
| N17 | TeamCollab parity | Partially implemented | Members have skills, a step capacity and an away flag. Steps can require a skill. Routing (`lib/teamcollab/routing.ts`) assigns the least-loaded available person and says why; you preview before applying, and owned steps are never moved. A Team load view on TeamCollab shows open steps against capacity. Tests: `tests/team-routing.test.ts`. | Exact reference dashboard and orchestration parity can't be verified without the reference screens. |
| N18 | Voice and briefing | Implemented and locally tested | The morning briefing is built from Today's own queries, and there's a lead voice-note draft. Playback uses the browser's speech engine, with voice, language and speed choices. MP3 download uses OpenAI speech when configured, rate-limited and audited. Nothing is sent automatically. Tests: `tests/voice.test.ts`. | MP3 download needs OPENAI_API_KEY. |
| N19 | Reporting parity | Partially implemented | Account committee: suggested roles with their basis, confirmation, coverage and single-threading warnings, and removal kept in history. Tests: `tests/committee.test.ts`. | A platform-wide India Demand Index is blocked: it needs a cross-customer dataset, and this app shows only your workspace's demand. |
| N20 | Notifications, admin and billing | Notifications and admin: implemented and locally tested. Billing payments: blocked. | Email notification delivery per kind (claimed once, never late). Optional invitation email. Custom role editor with a privilege ceiling and self-lockout guard. Tests: `tests/email-delivery.test.ts` and `tests/roles.test.ts`. | Push notifications are not implemented. Payment collection, plan change and GST tax invoices for the subscription are blocked on a payment gateway account (Razorpay or Stripe), GSTIN details and a pricing decision. |
| N21 | PDF and visual parity | PDF: implemented and locally tested. Visual parity: blocked. | A dependency-free PDF writer (`lib/pdf/simple.ts`). The dossier PDF download has the same scoping, export rule and audit as the print page. Its structure is tested, and the file opened correctly in macOS PDFKit. | The screenshot comparison needs reference ProspecX screenshots or access to ProspecX. |
| N22 | Full release regression | Partially implemented | Full Vitest suite, typecheck, lint and build (see the release gate). Playwright E2E exists. | A manual pass at desktop and mobile widths, in light and dark themes, on the new screens. Live channel tests. |
| N23 | Platform connectors | MCP: implemented and locally tested. CRM connectors: not implemented. | Streamable HTTP MCP server at `/api/mcp`, authenticated with an `insights.read` key, serving read-only tools. Write and spend tools are refused. Tests: `tests/mcp.test.ts`. | Salesforce, HubSpot, Zoho and Pipedrive connectors need OAuth apps and agreed field ownership. |

## Crosswalk features

The table lists features whose status changed in this pass, or that were previously marked
"decision". Features not listed keep the evidence recorded in `implementation-tracker.md` for
T01–T40.

| Feature | Status now | Evidence |
| --- | --- | --- |
| F006 Spoken briefing | Implemented and locally tested | N18 |
| F007 / F055 India Demand Index | Blocked by a specific external dependency | Needs a cross-customer dataset. Workspace demand is live. |
| F015 Assignment / claim | Implemented and locally tested | Bulk assign already existed. Added a claim queue: unowned leads without contact details and an atomic claim (`tests/lead-claims.test.ts`). |
| F022 Deep company research | Implemented and locally tested | Apify research stage, plus external lookup through Lead Lens. |
| F024 Personalised voice notes | Implemented and locally tested | N18 |
| F025 PDF dossier | Implemented and locally tested | N21 |
| F026 / F027 / F029 Discovery providers, ICP and phrases | Implemented and locally tested | N07, N08, N12 |
| F032 / F034 Decision makers and identity quality | Implemented and locally tested | N02–N05 |
| F033 Promote to CRM | Implemented and locally tested | A person lead as before. A new company-only deal for when nobody is known yet. Phrase attribution. |
| F038 / F039 / F062 TeamCollab orchestration and routing | Partially implemented | N17 |
| F043 / F044 Mailbox UI, send, receive and stop-on-reply | Implemented and locally tested (IMAP); OAuth mail blocked | N14 |
| F046 WhatsApp Business | Implemented and locally tested | N15 |
| F047 WhatsApp personal pairing | Blocked by a specific external dependency | No official API (Meta terms). |
| F048 LinkedIn messaging | Partially implemented (assisted); automation blocked | Needs LinkedIn partner API access. |
| F052 Bookings calendar sync | Implemented and locally tested (Google) | N16 |
| F053 Lead Lens | Implemented and locally tested | N13 |
| F054 People Finder | Implemented and locally tested | N13 |
| F056 Accounts committee | Implemented and locally tested | N19 |
| F066 Invitations and roles | Implemented and locally tested | N20 |
| F068 Notification preferences and delivery | Implemented and locally tested (email); push not implemented | N20 |
| F071 Billing payments, plans and invoices | Blocked by a specific external dependency | Needs a payment gateway account, GSTIN and a pricing decision. |
| F074 MCP | Implemented and locally tested | N23 |
| F077 CRM connectors | Not implemented | Needs vendor OAuth apps and agreed field ownership. |

## Live verification still owed

Each of these is a bounded test that needs your credentials and must stay inside a budget you set.
None was run.

| Integration | Minimal test | Cost ceiling |
| --- | --- | --- |
| Apify discovery | One query on each platform, with `maxItemsPerQuery` set to 5 | Under $0.20 in total at listed prices |
| Apify enrichment | One enrichment on one opportunity | Under the $1 per-run budget |
| SignalHire / Hunter / Apollo | One fallback lookup each, on a person with a known LinkedIn URL | 3 credits |
| IMAP reply reading | Connect a test mailbox and reply to one test email | Free |
| WhatsApp Cloud API | Record a test number's opt-in, send one approved template, reply STOP | One conversation charge |
| Google Calendar | Connect a test calendar, then book, move and cancel with no invite | Free |
| Notification and invitation email | Turn on email for one kind; send one invitation to your own address | Free |
| MCP | `claude mcp add` with an `insights.read` key; call `get_today` | Free |

## Release gate

Before calling a build releasable, all four must be clean:

```bash
npm run typecheck
npm run lint
npm run test
SIGNALROOM_BUILD_DIR=.next-verify npm run build
```

Then check the new screens at desktop and mobile widths, in light and dark themes, with data and
empty:

- Offerings
- Email Accounts → Reply reading
- WhatsApp API
- Calendar
- Team (the role editor and skills)
- Lead Lens
- People Finder filters
- The opportunity readiness strip
- The account committee
- The Today briefing
- The lead page's WhatsApp and voice-note cards

The rollout steps are in `docs/implementation-tracker.md` under "Rollout — 2026-09-25".
