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
| N01 | Keep multi-domain contact evidence | Implemented and locally tested | `lib/enrichment/emails.ts`: `classify`, `corroborateAlias` and `domainLabel`. **Since the v3 audit (D02):** a same-name domain under another ending is accepted automatically only when the company itself publishes an address there, on a page of its own website or on its own company profile. Otherwise it stays in review with a targeted reason, and nothing is discarded. A partner or vendor domain published on the company's site is not accepted either. Stronger evidence later promotes a pending review; weaker evidence never demotes one, and a person's decision is final. Tests: `tests/enrichment-logic.test.ts` (D02 cases, including unrelated companies sharing a label) and `tests/apify-enrichment.test.ts` ("D02: …" integration). | A live run on a company that really uses two domains. |
| N02 | Correct employee mapping | Implemented and locally tested | `mapEmployee` reads `currentPositions[]` with `title`, `current` and `startedOn`, plus `location.linkedinText`, which are the fields in the recorded Short-mode datasets. Company industries are read as objects and the phone as `{number}`. A decision maker is flagged only when current. Tests use those recorded shapes. | Confirm on a live run. |
| N03 | Role and author prioritisation | Implemented and locally tested | `roleFocuses` merges vendor and technology focus, so a staffing ask with implementation tags still targets partnerships, vendor and delivery roles. `assessAuthor` keeps a recruiter who names the company, and records other authors as source contacts, shown in a "Named in the source" panel. | — |
| N04 | Stage-level fallback: Apify → SignalHire → Hunter → Apollo | Implemented and locally tested | Every stage runs Apify first. When Apify finds nothing, fails or leaves fields empty, the same stage calls the providers that support that operation, in the configured order. The capability registry is `lib/enrichment/capabilities.ts` (from official docs), and each provider runs through the shared orchestrator `lib/services/fallback-orchestrator.ts`. What each stage uses: **company identity** — Hunter Domain Finder (free), then Apollo Organization Search; **company details** — missing fields only, Hunter Company Enrichment then Apollo Organization Enrichment; **people** — SignalHire Search (quota), Hunter Domain Search, Apollo People API Search (free) plus a paid reveal by id; **business email** — SignalHire Person API, Hunter Email Finder, Apollo People Enrichment; **verification** — Hunter Email Verifier only. An operation a provider does not support is skipped with the documented reason. Every call is written to the `ProviderCall` ledger before it is made, under a workspace row lock. Limits are per-run and per-day paid-call caps plus a free-search cap. The outcomes (found, review, no match, unsupported, missing input, not connected, key refused, not on plan, quota, rate limited, transient, malformed, asked recently, interrupted, limit reached, cancelled) are kept distinct and listed per stage on screen. Settings switch each operation on or off, and a switched-off operation is never done by another provider. Off by default. Tests: `tests/fallback-orchestrator.test.ts` (ledger, redelivery, freshness, concurrent caps, error classes, disabled operations) and `tests/apify-enrichment.test.ts` ("Stage-level fallback"). | A bounded live run per provider (`npm run smoke:providers`). Apollo is not connected in the live workspace. |
| N05 | Email ownership and role addresses | Implemented and locally tested | Every address is reclassified whatever its source. Role addresses always become company contacts. A full-name match is labelled `inferred_from_name` and a first name plus initial never attaches. A provider association is labelled `provider_associated`. | — |
| N06 | No invented country | Implemented and locally tested | The import and the schema default are now "Unknown", and a country header alias was added. Tests: E06 in `tests/enrichment-logic.test.ts`. | Rows imported earlier as "India" are unchanged, because the right value can't be inferred. Review them by hand if it matters. |
| N07 | Requested Apify sources | Implemented and locally tested | `lib/opportunities/apify-platforms.ts` covers LinkedIn jobs, Indeed, Naukri, Google Search, Reddit, Upwork, Google Maps and public websites. Each Actor, input and output was checked (`docs/provider-contracts.md`). Each has settings, a date mapping that never narrows the window, limits, a per-search USD cap, a ledgered run with redelivery reuse, a free access test, and failure isolation. Tests: `tests/apify-discovery.test.ts`. | Live run per platform on your Apify account. Upwork's per-job charge (one event or two) is unconfirmed. |
| N08 | Offering-aware discovery | Implemented and locally tested | `OfferingProfile` model and Settings → Offerings. Routing (`lib/opportunities/offering.ts`): buyer phrases go to Google, Reddit and Upwork; job titles to job boards; categories to Maps. Results are marked as requests, hiring or business prospects. Maps results become prospect companies, never opportunities. Industries and company size stay with fit and are never used as filters. | — |
| N09 | Common multi-platform orchestration | Implemented and locally tested | One search can run up to 14 sources, each isolated with a checkpoint. There are ledgered runs for resume without re-charge, cancellation, and a per-platform budget. The per-platform funnel reconciles: returned = outside window + unreadable + repeated + assessed. | Cross-source duplicate counts are per platform; the global count is the search's `qualified` figure. |
| N10 | Live enrichment proof | Partially implemented | Adapter contract tests replay each vendor's documented example responses and error bodies through the real HTTP layer (`tests/provider-replays.test.ts`): request shape, mapping, pagination/limits, error-id extraction, schema-change detection, and POSTs never retried. A bounded smoke script (`src/worker/provider-smoke.ts`) is free by default; paid calls need `--paid --max N` and are capped at 5. Replays are the documented examples, not captured live traffic. | Run the smoke script with your credentials; the paid part only with spending authorisation. |
| N11 | Explain fit and readiness | Implemented and locally tested | `lib/opportunities/readiness.ts` and the opportunity page strip. Fit is shown as not assessed, partial or assessed, each with the unknown fields named. Fit is recomputed after research. Qualified, researched, contact-ready and in-CRM are read from rows. Tests: `tests/opportunity-readiness.test.ts`, plus an integration test. | — |
| N12 | Phrase and watch integration | Implemented and locally tested | A due phrase becomes a tracked search on the connected sources for its kind (`phrase-watches.ts`). Each run is a SearchRun. A match alerts once. A lead created from a phrase-found opportunity gets `sourcePhraseId`. Opening a watch restores its query, sources and options, and "Update watch" edits it in place. There is a Run-now button. Tests: `tests/phrase-watches.test.ts`. | — |
| N13 | Standalone Lead Lens and People Finder | Implemented and locally tested | External lookup takes a LinkedIn profile, a company page or domain, and now **a person's full name** (optionally "at Company"). A name is searched with the free people searches (SignalHire Search on the search quota, Apollo People API Search at 0 credits). Every namesake is listed, with the asked-for company first and Apollo's hidden last names labelled. Only the one a person chooses is revealed, with one credit, under a claim so it cannot be paid for twice. Tests: `tests/lead-lens.test.ts`. | A live name search on your accounts. A two-word company name typed bare is read as a person's name; paste the domain to look up a company. |
| N14 | Mailboxes: sending and receiving | Implemented and locally tested (not live-verified) | **Per-workspace sending (D06):** a mailbox can send over its own SMTP server. It is always TLS (implicit or required STARTTLS), and the password is never sent in clear. It is checked on save by logging in and quitting, with nothing sent. It can also connect through **Gmail or Microsoft 365 OAuth** (`lib/outreach/adapters/oauth-mail.ts`): Gmail API send plus history-based reading, Graph draft-send plus inbox reading. Capability is kept as send-only, receive-only or full. Each direction is tested separately, and revoking erases every secret (Google is told to revoke). There is a workspace default sender and a per-sequence sender; Inbox replies go from the thread's mailbox. A named mailbox that stops working holds its messages rather than sending from someone else. **Delivery:** an atomic claim before every send, so two workers or a redelivery cannot send twice, and a send whose result was lost is failed with a "check Sent" reason rather than resent. Sequence steps are keyed per enrollment and step. Outbound mail carries `In-Reply-To`/`References`, and the Message-ID each provider actually used is stored so replies match. The IMAP reply reading from before is unchanged. Tests: `tests/mailbox-sending.test.ts`, `tests/smtp.test.ts`, `tests/mailboxes.test.ts`. | Live tests with a sandbox mailbox. Gmail and Microsoft sign-in need OAuth apps (GOOGLE_/MICROSOFT_OAUTH_CLIENT_ID/_SECRET). Gmail's read scope needs Google's restricted-scope verification outside your own Workspace. No delivery webhooks, so email never reaches DELIVERED or READ. No per-mailbox daily throttle. |
| N15 | WhatsApp and LinkedIn | WhatsApp Business: implemented and locally tested. Personal WhatsApp: blocked. LinkedIn automation: blocked. | Cloud API adapter with per-workspace encrypted credentials, a free check, opt-in evidence, the 24-hour and template rule, suppression, and idempotent sends. The HMAC-verified webhook handles replies (stopping sequences), STOP (suppressing across every channel) and receipts. Tests: `tests/whatsapp.test.ts`. LinkedIn stays assisted. | Live test needs your Meta Business number and token. Personal WhatsApp pairing has no official API, and the unofficial route breaks Meta's terms. LinkedIn automated DMs need LinkedIn partner API access. |
| N16 | Calendar | Google and Microsoft 365: implemented and locally tested. CalDAV: not implemented. | Google as before. **Microsoft 365** (`lib/calendar/microsoft.ts`): OAuth with signed state, getSchedule free/busy (read in UTC), and create/patch/delete events through Graph. Invitations go only to attendees you choose to invite. There is one calendar per person, and connecting one replaces the other. Microsoft has no per-app revoke, so tokens are erased and the screen says where to remove the grant. Tests: `tests/calendar.test.ts`. | Live tests need the OAuth clients. CalDAV (iCloud, Fastmail, self-hosted) is not implemented: every server needs discovery and app-specific passwords, and it was left out of this pass rather than half-built. |
| N17 | TeamCollab parity | Partially implemented | Members have skills, a step capacity and an away flag. Steps can require a skill. Routing (`lib/teamcollab/routing.ts`) assigns the least-loaded available person and says why; you preview before applying, and owned steps are never moved. A Team load view on TeamCollab shows open steps against capacity. Tests: `tests/team-routing.test.ts`. | Exact reference dashboard and orchestration parity can't be verified without the reference screens. |
| N18 | Voice and briefing | Implemented and locally tested | The morning briefing is built from Today's own queries, and there's a lead voice-note draft. Playback uses the browser's speech engine, with voice, language and speed choices. MP3 download uses OpenAI speech when configured, rate-limited and audited. Nothing is sent automatically. Tests: `tests/voice.test.ts`. | MP3 download needs OPENAI_API_KEY. |
| N19 | Reporting parity | Partially implemented | Account committee: suggested roles with their basis, confirmation, coverage and single-threading warnings, and removal kept in history. Tests: `tests/committee.test.ts`. | A platform-wide India Demand Index is blocked: it needs a cross-customer dataset, and this app shows only your workspace's demand. |
| N20 | Notifications, admin and billing | Notifications (in-app, email, **push**) and admin: implemented and locally tested. Payments: implemented and locally tested in Razorpay test mode; not live. | **Push:** Web Push with VAPID (`lib/push/webpush.ts`). A push carries no content — the service worker fetches the text over the person's session. There are per-kind push switches and a per-browser subscribe. Endpoints are allow-listed to the real browser push services. Each notification is claimed once, and gone subscriptions are dropped. **Payments:** Razorpay Payment Links at the plan row's listed price in paise, with no tax computed. The plan changes only on an HMAC-signed webhook for exactly that amount; a different amount is recorded as a mismatch and not activated. Every event is processed once (keyed by event id), and test mode is shown. Tests: `tests/push.test.ts`, `tests/billing-payments.test.ts`. | VAPID keys and Razorpay keys (test first). GST invoicing, and tax treatment in general, is not implemented and needs your GSTIN and accountant's decision. Pricing is whatever the Plan rows say. |
| N21 | PDF and visual parity | PDF: implemented and locally tested. Visual parity: blocked. | A dependency-free PDF writer (`lib/pdf/simple.ts`). The dossier PDF download has the same scoping, export rule and audit as the print page. Its structure is tested, and the file opened correctly in macOS PDFKit. | The screenshot comparison needs reference ProspecX screenshots or access to ProspecX. |
| N22 | Full release regression | Partially implemented | See "Release checks — 2026-09-25" below. | A manual pass at desktop and mobile widths, in light and dark themes. Live channel tests. |
| N23 | Platform connectors | MCP: implemented and locally tested. CRM connectors: not implemented. | Streamable HTTP MCP server at `/api/mcp`, authenticated with an `insights.read` key, serving read-only tools. Write and spend tools are refused. Tests: `tests/mcp.test.ts`. | Salesforce, HubSpot, Zoho and Pipedrive connectors need OAuth apps and agreed field ownership. |

## Version 3 audit defects (2026-09-25)

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| D01 | Fallback was contacts-only | Fixed; implemented and locally tested | See N04. Research, Find people, Find emails, Check emails and Enrich all run through the same orchestrator. A missing company, missing people, missing details and unchecked addresses each have their own fallback. |
| D02 | A same domain label was treated as proof | Fixed; implemented and locally tested | See N01. Tests cover a company legitimately using two domains and unrelated companies that share a label. |
| D03 | A successful fallback could show "No matches" | Fixed; implemented and locally tested | `MAIN.emails` and `MAIN.enrich` include `contacts`. Regression test: Apify finds no email, Hunter finds one, the run is COMPLETED and the address shows on the person. |
| D04 | Low-confidence matches were attached | Fixed; implemented and locally tested | `lib/enrichment/identity-gate.ts` keeps identity separate from ownership and verification. Only `confirmed` (same profile) or `supported` (same name and employer) attaches. A `conflict` or `weak` result is kept on the company as a possible match, with the evidence and "It is them" / "Not theirs" actions, and the next provider is still tried. |
| D05 | "Has any email" skipped people with unusable addresses | Fixed; implemented and locally tested | `addressDecision` in `lib/enrichment/fallback.ts`: invalid or bouncing → search for a replacement; suppressed or opted out → blocked; confirmed and fresh → skip; stale confirmed → recheck; catch-all or unknown → skip; role or off-domain only → search. Each person's decision and reason is shown under "Why each person was searched or not". |
| D06 | Mailbox completion overstated | Fixed in code; not live-verified | See N14. |

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

## Release checks — 2026-09-25

All against `signalroom_test`, Redis db 15 and the :3100 E2E server:

- `tsc --noEmit` passes.
- Lint passes.
- Vitest: 105 files, 1522 tests passed.
- `SIGNALROOM_BUILD_DIR=.next-verify npm run build` passes.
- Playwright: the first full run had 55 passed, 7 failed and 1 skipped. One failure was a stale selector, now fixed; six were dev-server recompile timing. All seven pass on re-run. No clean full E2E run has been made since.

Not yet done: the manual visual pass (desktop and 390px, light and dark, keyboard-only). See `docs/delivery-2026-09-25.md`.
