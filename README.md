# Signalroom

A revenue operating system: it watches for the moment a business starts looking
for what you sell, works out whether they fit, and tells you what to do about it
— with the evidence attached.

```
Signal → Lead → Research → Reveal → Engage → Reply → Qualify
       → Collaborate → Proposal → Meeting → Close → Learn
```

Every screen in the navigation is now built — 58 of them, none rendering a
placeholder. That is not the same as every screen being *finished*: where a
capability depends on something that does not exist yet (a delivery adapter, a
licensed data source, an OAuth flow), the screen says so by name, states that
nothing was changed or charged, and shows what does work instead. See
[What's built](#whats-built).

---

## Quick start

Requires Node 20.19+ and a local PostgreSQL 14+.

```bash
npm install

# Create the role and databases (adjust the superuser if yours differs)
psql -U postgres -c "CREATE ROLE signalroom LOGIN PASSWORD 'signalroom_dev_pw' CREATEDB"
psql -U postgres -c "CREATE DATABASE signalroom_dev OWNER signalroom"
psql -U postgres -c "CREATE DATABASE signalroom_shadow OWNER signalroom"

cp .env.example .env          # then set AUTH_SECRET to 32+ random characters
npx prisma migrate deploy     # or `npm run db:migrate` in development
npx prisma generate
npm run db:seed

npm run dev
```

Background work runs as a separate process. It needs Redis:

```bash
docker run -d --name signalroom-redis -p 6399:6379 redis:7-alpine
npm run worker          # in a second terminal
```

The app is fully usable without it — every queue-backed feature reports itself
unavailable rather than failing — but scores stop being recomputed, risk flags
go stale, and archiving and retention do not run.

Open <http://localhost:3000> and sign in:

```
rahul@northbridge.example / Signalroom123
```

The seed builds a fictional IT-services workspace — **Northbridge Cloud**, Pune —
with 132 leads, 34 deals, 32 companies and a four-month activity history. Every
company and person in it is invented, and all domains use `.example` so nothing
can be mistaken for a real business or accidentally contacted.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Vitest suite (needs the local database) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Re-seed the demo workspace (destructive) |
| `npm run db:reset` | Drop, migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run worker` | Background worker (needs `REDIS_URL`) |
| `npm run worker:dev` | Worker with reload on change |
| `npm run job -- --list` | List jobs that can be triggered by hand |
| `npm run job -- --all` | Force every recomputation job now |

---

## Stack

| Layer | Choice | Note |
| --- | --- | --- |
| Framework | Next.js 15, React 19, App Router | Server components by default |
| Language | TypeScript, strict | |
| Styling | Tailwind CSS v4 | CSS-first config, semantic tokens only |
| Components | Radix primitives + CVA | Hand-built in the shadcn idiom, not vendored |
| Database | PostgreSQL 14+ | 69 tables |
| ORM | Prisma 7 with `@prisma/adapter-pg` | Prisma 7 requires a driver adapter |
| Auth | Hand-rolled sessions (`jose` + `bcryptjs`) | See [Authentication](#authentication) |
| Client data | TanStack Query | Only where the URL can't carry state |
| Drag and drop | dnd-kit | |
| Queue | BullMQ on Redis | Separate worker process; optional |
| Tests | Vitest | |

### Why auth is hand-rolled

The brief suggested Auth.js, Clerk or Supabase Auth. This uses roughly 150 lines
of its own instead, because the requirements — credentials login, revocable
sessions, MFA-ready, workspace switching, and an audit trail that names the
session — are all straightforward to satisfy directly, and doing so avoids
depending on a beta release for the security-critical path. Swapping in a
provider later means replacing `src/lib/auth/session.ts` and leaving
`src/lib/auth/context.ts` alone.

The cookie carries a signed JWT; the database stores only a SHA-256 digest of the
raw token, so a database leak cannot be replayed as a login and every session
stays individually revocable.

---

## Architecture

```
src/
  app/
    (auth)/            Login, unauthenticated shell
    (app)/             Everything behind auth, inside the app shell
    api/               Typed route handlers
  components/
    ui/                Design-system primitives
    domain/            Tier, intent, score — the product's own vocabulary
    shell/             Sidebar, topbar, command palette, Copilot drawer
    charts/            Stat tiles, heatmap
    today/ leads/ pipeline/ queue/
  lib/
    auth/              Sessions, permissions, request context
    services/          All database access. Server-only.
    leads/             Filter contract shared by client and server
    ai/                Provider abstraction and the Copilot tool registry
    scoring.ts         The lead scoring engine
    vocab.ts           Every user-facing status word and its treatment
    nav.ts             One config driving sidebar, palette and stub pages
prisma/
  schema.prisma        69 models
  seed.ts              Deterministic demo data
tests/                 Vitest suites
```

### Rules the codebase follows

**Business logic lives in `lib/services`, not in components.** React components
receive plain data. The service layer converts Prisma `Decimal` to `number` and
`Date` to ISO strings once, at the boundary (`lib/serialize.ts`), so no component
ever handles a driver type.

**Tenant isolation is enforced in SQL.** Every service function takes an
`AuthContext` and puts `workspaceId` into the `where` clause. Row-level
visibility — a sales rep seeing only their own leads — is a `where` fragment
from `leadVisibilityFilter()`, not a UI condition. A lead outside your tenant and
a lead outside your visibility both return `null`, so the two are
indistinguishable from outside. `tests/tenancy.test.ts` proves this.

**`server-only` guards the service layer.** Importing a service from a client
component is a build error, not a runtime leak. The lead filter contract lives in
`lib/leads/filter.ts` precisely so both sides can share it without dragging the
database in.

**Colours are semantic.** Components reference `surface`, `border`,
`intent-hot`, `tier-a` — never a raw colour. Swapping the palette is a change to
`globals.css` alone.

**Money is INR-first.** Lakh and crore formatting with 2,2,3 digit grouping
(`formatInrCompact`), tabular numerals everywhere a figure sits in a column.

---

## Two ideas the product is built around

### 1. A score is worthless unless you can interrogate it

`src/lib/scoring.ts` is a deterministic, pure function — no model call. It stores
**eight dimensions separately** (fit, intent, urgency, authority, budget,
reachability, engagement, recency) and computes a configurable weighted
composite. Every point awarded writes an evidence row naming what caused it, so
"Why 9/10?" always has a real answer, down to `+34 Industry matches your ICP`.

Rows worth zero points are kept on purpose: *"No budget confirmed"* and *"No
buying signal detected yet"* are the most useful lines in the explainer.

Scores are never generated by an LLM. The AI layer explains these numbers; it
does not invent them.

### 2. The app says what it cannot do

There is no button that silently does nothing.

- Routes without a backend render a placeholder naming the feature, its phase and
  its intended scope — no invented metrics. One nav config (`lib/nav.ts`) drives
  the sidebar, the command palette and those placeholders, so a screen cannot
  claim a capability the nav doesn't describe.
- Buttons whose action isn't wired say so and state that nothing was charged.
- The Copilot answers from a **tool registry** of real scoped queries
  (`lib/ai/tools.ts`). Ask "which deals are stalled?" and it runs `get_pipeline`
  and reports rows, with no model involved at all — the screen labels that
  "Read directly". An open-ended question reads every `READ` tool first and
  passes the results as context, with a prompt forbidding new calculation,
  estimation or recall. Ask for a tool that isn't built, or one that writes, and
  it names the tool and stops. Tools are risk-classed — `READ`, `WRITE`,
  `SPEND`, `EXTERNAL`.
- Where a number rests on an assumption, the assumption is on screen. "Weighted"
  carries *"a statistical figure from stage probabilities, not a forecast."*
- **Lead discovery is honest about its sources.** Nine sources are described
  with what each one needs, what it would return and its compliance basis —
  and eight of them report `configured: false`, because no provider is
  connected. The one that works is manual import, which needs nothing external.
  Find Leads shows that plainly instead of a search box that returns invented
  companies. A phrase's verdict abstains (*"too few to judge"*) rather than
  rating a sample of three, and a reply rate is `null` when nothing was sent —
  "not measured" and "nobody replied" are different facts.
- **An imported lead stays cold.** It gets real fit, authority and reachability
  evidence, but intent has nothing to point at, so it scores Tier C / COLD.
  Buying an email list does not manufacture demand, and the score says so.
- **Outreach refuses rather than pretending.** No mailbox is connected, so
  replying saves a draft and says exactly that; activating a sequence is
  refused with the reason; approving an AI draft is refused because the queue
  could not drain. What *does* run is everything up to the transport — the
  send window, the daily cap, stop-on-reply, the do-not-contact check and the
  template render all execute and are recorded. A message that passes every
  rule and still cannot be delivered is marked **not sent**, never sent.
- **A send is refused by whoever can fix it.** Every blocker is scoped: the
  clock, an admin, the sequence, or the lead. Only a lead-scoped reason ends
  someone's enrollment, so a workspace with no mailbox keeps its enrollments
  intact instead of having them all stopped by the first run of the engine.
- **An unfillable template variable is the template's fault, not the lead's.**
  A typo like `{{sender_frist_name}}` holds the sequence and says which step
  to fix, rather than stopping every enrolled lead one at a time.
- **Proposal money is integer paise, end to end.** Each line is rounded once,
  at the line, so the subtotal equals the sum of the figures printed above it.
  Totals are re-checked before a proposal goes out, re-checked nightly after,
  and a mismatch is *reported* rather than silently corrected — quietly
  changing a price the customer has seen is worse than the mismatch.
- **A proposal's view count excludes your own team.** A seller refreshing
  their own proposal would otherwise inflate the one number on the screen that
  reads as buyer interest. The count is shown next to how many visit rows back
  it, and the exclusion is stated on the card.
- **An external accept is recorded as unverified.** A link holder is not an
  authenticated party, so the audit row is a SYSTEM actor with no user, an
  `INTEGRATION` source, the name marked *claimed*, and
  `identityVerified: false` in the payload.
- **An agent that could do nothing cannot be switched on.** Each agent's
  tools are checked against the registry: undefined, declared-but-unbuilt and
  usable are three different states, shown as three different things. Five of
  the eight seeded agents turn out to be inert, and the screen leads with that
  rather than with "Enabled".
- **Full-auto is refused without a model provider**, because a mode that
  claims agents act on their own while nothing can act is a lie in the
  interface. Review-first and off are both honest with no provider.
- **A guardrail decision is one of four dispositions, not a boolean.** Act,
  ask a person, wait for the clock, or never. Only the evaluator decides, and
  the dry run calls the same function the runner would — so the preview is a
  prediction the system is bound by.
- **The dry run is the honest substitute for watching an agent work.** Real
  leads, real rules, no writes, no model call. It names which tool it
  evaluated — the most consequential one the agent holds, so the preview shows
  the hardest case rather than the easiest.
- **Approving something unbuilt is refused.** A held action whose tool does
  not exist cannot be approved into a queue that will never drain, and the
  button says why.
- **Approving runs it, and re-checks first.** Ten of the fourteen tools are
  built: `add_note`, `create_task`, `update_deal` and `unlock_contacts`
  delegate to the same mutation services a person uses, so an agent's write
  produces the same audit row, the same activity row and the same permission
  check — a tool is never a second way into the database. The guardrails run
  again at the moment of execution, so a lead suppressed between the hold and
  the approval is still refused and nothing is done. Four remain unbuilt, each
  waiting on something real: `draft_outreach` on a model call,
  `research_company` on a data provider, `send_email` and `send_whatsapp` on a
  transport.
- **A filter over your own data is not a prospecting tool, and says so.**
  People Finder, Lead Lens and Radar each state that nothing is connected, so
  a miss means "not in your data" rather than "does not exist". Every
  signal-derived screen shares one freshness notice, so four screens over the
  same data cannot imply different things about how current it is.
- **Smart lists and static lists are counted differently, and shown apart.** A
  smart list re-runs its filter; a static one counts its members against your
  visibility. A saved filter that no longer parses is marked broken rather
  than quietly returning everything or nothing.
- **Every ratio names both of its terms.** The funnel counts each stage
  independently, which can produce a figure above 100% — so the caveat
  explaining why is on the screen rather than the number being massaged.
  Unattributed leads get their own row: not knowing where revenue came from is
  itself the finding.
- **An API key is a narrower person, not a second door.** A key resolves to an
  ordinary `AuthContext` with permissions narrowed to its scopes, so every
  service, tenant check and audit row behaves identically whether the caller is
  a browser or a script. There is no machine-only code path to keep in sync.
- **A key can never exceed its creator, and narrows with them.** Effective
  permissions are the intersection of the scopes and the creator's *current*
  role. Demote them and the key loses the same authority; remove them and it
  stops working. The screen reports `orphaned` and `powerless` as distinct
  states from `revoked`, because a key can be dead without anyone revoking it.
- **The endpoint manifest includes what keys cannot call, and why.** Changing
  the autopilot guardrails and approving an agent action are permanently
  session-only — a key approving on a human's behalf would defeat the point of
  approval.
- **The webhook event catalogue says which events actually fire.** Subscribing
  only to events nothing emits is a silent misconfiguration, so an endpoint in
  that state is named on the screen. A test delivery makes a real request; a
  failure is the useful result.
- **Bookings record, they do not schedule.** With no calendar connected,
  nothing creates an event or sends an invite, and the screen says so. The
  pre-call brief needs no integration — it is assembled from score evidence,
  signals, the buying committee, open deals and earlier meeting outcomes, and
  reports how many of its seven sections actually have data so a thin brief
  admits it.

---

## What's built

**Working end to end, against real data — reads *and* writes:**

| Screen | Notes |
| --- | --- |
| Login | Session auth, workspace switching |
| Today | Classic and Mission Control layouts; brief, lead of the day, revenue, worklist, health score, activity heatmap |
| Leads | Server-side filtering on 25+ dimensions, 11 smart shortcuts with live counts, three view densities, URL-as-state |
| Lead dossier | AI verdict, fit radar, readiness checklist, score explainer, signal timeline, contacts, buying committee |
| Pipeline | Drag-and-drop with optimistic update and rollback, stage value and ageing, risk flags |
| My Queue | Impact-ranked lanes plus Focus Mode |
| Find Leads | Plain-English ICP capture, a match preview before saving, CSV/TSV import with a dry run, and an honest account of which discovery sources are connected |
| ICP settings | Multiple profiles with one primary, precision measured from real leads, a queued rescore on every save |
| Search phrases | Per-phrase lead count, tier mix, reply rate and won revenue, with a verdict that abstains when the sample is too small |
| Inbox | Thread list with lead context beside it, message-state vocabulary, AI-draft approval queue, snooze/close/assign, and a reply composer that saves a draft rather than pretending to send |
| Outreach | Sequences with steps, day offsets, per-step channel, send window, daily cap, stop conditions and per-step copy review |
| Proposals | Line-item pricing with GST, a private customer link, real view tracking that excludes your own team, and accept/decline recorded as it happens |
| Public proposal (`/p/…`) | What the customer sees — no login, no app chrome, the sender's name in the tab, and accept/decline that writes an audited decision |
| Bookings | Meetings recorded against the lead, a pre-call brief assembled from real rows, and outcome capture that turns commitments into tasks |
| Autopilot | Mode, the limits agents work inside, the policy restated in plain English, the agent-action approval queue, per-agent tool health, and a dry run that evaluates real leads against the real guardrails without writing anything |
| Lead Lens | Paste a name, LinkedIn URL or domain and see what the workspace holds — a miss says so rather than returning an empty dossier |
| People Finder | Search roles, seniority, industry and intent across your own data, with the scope stated |
| Live Demand | Signals grouped by what they mean, counting companies as well as signals |
| Accounts | Company intelligence with committee health — single-threaded accounts are named, not counted |
| Radar | What is watched, and honestly whether anything feeds it |
| Competitors | Who gets named in your signals, plus mentions matching nobody tracked |
| Market Intelligence | Sector and region movement, with the caveat that it describes your pipeline, not the market |
| Lists | Smart lists counted by running their filter; static lists counted by members, respecting visibility |
| Saved & Alerts | Saved searches with live match counts and whether an alert could ever fire |
| Insights | Signal-to-revenue funnel where every ratio names both terms, and source attribution including what is unattributed |
| Team | Activity and conversion side by side, with a stated threshold for "busy but not converting" |
| Approval Center | One queue for everything waiting on a person — agent actions and drafted messages — with a bulk approve that itemises what will run, what will not, and exactly how many points leave the account |
| Trust Center | What automation may do, what it can actually reach, which services are connected, the daily limits, and what it has done |
| AI Agents | Per-agent remit, tools, budget and its own run history |
| Agent Activity | Every automated action, filterable by agent, risk class and outcome |
| API Keys | Named, scoped, expirable keys with real authentication, plus the endpoint manifest |
| Webhooks | Signed delivery with retries, a real test send, and an event catalogue that says which events actually fire |
| MCP | The tool manifest, scope model and client config an MCP server would expose |
| CRM Integrations | What each connector would need, and what the API and webhooks already do instead |
| Settings | Account, Team & Roles with a full permission matrix, Billing with the point ledger, Audit Log, Background Jobs |

Also working: global command palette (`⌘K`), universal search, Copilot drawer
(`⌘I`), notification centre, dark/light/system themes, mobile bottom navigation,
and loading, empty, error and partial-error states on every data surface.

**Mutations** (61 API routes). Every write goes through one scaffold
(`lib/services/mutate.ts`) that checks the caller's permission, confirms the row
is in their tenant, applies the change, then records both an audit entry with
before/after and — where it is worth surfacing — a team activity row:

| | |
| --- | --- |
| Leads | star, status, tier, owner, estimated value, next action, archive, restore, discard-with-reason |
| Contacts | reveal, charging real points with a price quote first and an automatic refund if verification fails |
| Scores | override with a required reason; the computed score is kept alongside it as feedback |
| Notes | create, pin, soft-delete to the recycle bin |
| Tasks | create, complete, reopen, snooze, lane moves, soft-delete |
| Deals | create from a lead, edit value and forecast, move stage, resolve a risk flag, soft-delete |
| ICP profiles | create, edit, set primary, delete — guarded so you cannot delete the last profile or one that leads are scored against |
| Search phrases | create, pause, resume, delete — deleting stops the watch but keeps historical attribution |
| Lead import | dry run and commit, with per-row rejection reasons and duplicate detection |
| Conversations | reply, snooze with a required return date, close, reopen, assign, mark read |
| Messages | approve or reject an AI draft, with a required reason on reject |
| Suppression | add an address or domain to do-not-contact, which stops every live enrollment writing to it |
| Sequences | create, edit, activate, pause, enroll, remove — with the send window, step ordering and template variables all validated |
| Proposals | create, edit, send (makes the link live), record a decision, delete — accepted proposals are immutable |
| Public decisions | a link holder accepting or declining, audited as an external actor with the identity marked unverified |
| Bookings | record a meeting, capture the outcome, cancel with a reason — commitments become high-priority tasks |
| Autopilot | set the mode and every limit; refused when the mode would misrepresent what the system does |
| Agents | enable or disable — refused for an agent that could do nothing |
| Agent actions | approve or overrule a held action, with a required reason on overrule |
| API keys | issue (shown once), revoke — a key can never exceed the person who created it |
| Webhooks | create, pause, remove, send a real test delivery |

Services validate their own input rather than trusting the route, because the
same functions are the ones an agent or the MCP layer will call.

**Background jobs** (`npm run worker`). Fourteen jobs, eleven of them on a schedule,
with a monitor at Settings → Background Jobs showing queue health, registered
schedules, recent runs and what each one changed:

| Job | Why it has to be a job |
| --- | --- |
| Rescore all leads | Recency decays daily, so a lead that was hot last week should not still read hot today |
| Detect deal risks | Recomputes stall, inactivity, missing-next-step, passed-close-date and single-threading — and **resolves flags whose problem is fixed**, so the board does not collect stale warnings |
| Re-rank worklist | The ranking depends on deadline proximity, which moves every hour |
| Refresh next best actions | Rule-based and auditable; each option carries a rationale |
| Archive stale leads | Never archives a lead that replied, or has an open deal or task |
| Purge recycle bin | Retention is a promise, so it runs on a schedule |
| Sweep notifications | Deduplicated, so a 15-minute sweep does not re-notify |
| Deliver webhook | HMAC-signed with a timestamp; 4xx is permanent, 5xx retries with backoff |
| Advance sequences | Every ten minutes: decides what is due, re-runs every consent and timing rule, and materialises a queued message or refuses with a reason |
| Send one message | Re-checks sendability at the moment of sending, because minutes pass between queueing and sending and the recipient may have replied in between |
| Wake snoozed threads | A snooze that returns late is a missed follow-up |
| Expire proposals | Just after local midnight, because a proposal is valid for the whole of its last day — not on a rolling 24-hour clock |
| Audit proposal totals | Nightly: re-adds every live proposal's line items and raises a mismatch **without** rewriting the figures a customer may already have seen |

Every handler is idempotent — verified by test and by running the whole set
twice and confirming no row changed. Mutations enqueue follow-up work: revealing
a contact triggers a rescore (reachability is a scored dimension), and moving a
deal triggers risk detection.

**Nothing is routed-but-inert any more.** All 58 navigation entries render a
real screen reading real rows; `PlannedPage` is no longer used by any route.

What remains is *capability* gaps, not screen gaps, and each is named on the
screen that would use it:

- **No delivery adapter**, on any channel. Sequences step, enforce the send
  window, check suppression and bounce limits, and record every hold with its
  reason — but nothing is transmitted. The channel screens report how many of
  your leads each one could reach, counted from contact records.
- **LinkedIn automation is not coming.** There is no sanctioned API for
  third-party sending, so the screen states what the product will never do
  rather than implying it is on a roadmap.
- **Deep external research** needs a licensed source; it stays switched off
  rather than generating a dossier from a model's recollection.
- **Self-serve export and erasure** for a data subject are manual today, and
  Data & Privacy says so instead of offering a button that files nothing.
- **Per-kind notification muting** has nowhere to store the preference, so the
  screen reports your real volume per kind instead of showing dead switches.

The database schema covers all of it already — sequences, proposals, agent runs,
webhooks, API keys, suppression lists and the audit log are modelled and seeded,
so building those screens is UI and service work rather than migrations.

---

## Production readiness

**Done:** tenant isolation with tests · RBAC with a 25-permission catalogue ·
immutable point ledger with idempotency keys and per-workspace row locking ·
audit log capturing UI, API, MCP and Autopilot actors with before/after ·
bcrypt at cost 12 · hashed revocable sessions · security headers ·
soft deletes and a recycle-bin index · suppression list · AI cost logging ·
WCAG-minded markup (semantic tables, ARIA, keyboard navigation, reduced-motion,
validated colour contrast).

Three more landed recently and are worth describing, because each has a
property that is easy to get subtly wrong:

- **CSRF, in middleware.** Every state-changing request must carry an `Origin`
  or `Referer` matching the host, refused before a route runs — so a new route
  is protected by existing rather than by remembering. `SameSite=Lax` on the
  session cookie is not enough on its own: Chrome's "Lax + POST" grace window
  still sends the cookie cross-site for two minutes after it is set, which is
  exactly the window after signing in, and `SameSite` trusts every sibling
  subdomain. API-key callers are exempt, because a browser cannot attach that
  header cross-origin and the request carries no cookie.
- **Rate limiting** on sign-in, the public proposal endpoints, point spending
  and model calls. Counted in Redis when it is configured and in memory when it
  is not; `Settings → Support` says which answered, because an in-memory limit
  behind two servers is really twice as loose and a screen that claimed
  otherwise would be lying. Sign-in is keyed on *both* the address and the
  source and both must pass — on the address alone a botnet still gets
  unlimited guesses at one account, on the source alone a spread-out attack
  costs nothing. The public-proposal limit is keyed on the source rather than
  the token, since keying on the token would let a guesser get a fresh
  allowance with every guess.
- **MFA enrolment**, TOTP per RFC 6238, implemented over `node:crypto` and
  checked against the RFC's published test vectors rather than trusted. A used
  step is recorded so a code cannot be replayed within its window, recovery
  codes are bcrypt-hashed and shown exactly once, and turning it off needs a
  code — a session alone must not be able to remove the thing that protects
  against a stolen session. There is no QR code: rendering one needs an encoder
  this app does not carry, so the key is entered manually and the screen says
  so.

**End-to-end tests** run in a real browser via Playwright (`npm run e2e`), and
cover the three things unit tests structurally cannot: that sign-in works
through the actual form, that the CSRF middleware accepts the app's own writes
while refusing forged ones, and that a prospect with only a link — no account,
no cookie, a separate browser context — can open a proposal and is stopped from
accepting one anonymously.

They sign in for real, so they run inside the product's own rate limit rather
than around it: one shared session via a setup project, and `auth.spec.ts`
driving the form because it is what it tests. Two runs inside five minutes will
hit the limiter, which is the limiter working. Nothing in the suite accepts a
seeded proposal — accepting is irreversible, and a test that cannot run twice is
not a test.

**Logging is structured and correlated.** Middleware mints an id per request,
forwards it to the route, echoes it on every response and includes it in the
sentence shown when something genuinely fails — so a support report can quote
something findable instead of a time of day. An inbound id is reused where it
looks safe, so hops correlate, and rejected otherwise: the value is echoed into
a response header and into log lines, and a newline in it would let a caller
forge entries. Fields are redacted by key before serialisation rather than at
each call site, because a logger handed arbitrary objects is eventually handed a
session token.

What that is *not* is tracing or metrics. There are no spans, no percentiles,
no alerting — a log collector would have correlated lines to read, and nothing
is watching them for you.

**A nonce-based CSP, and HSTS.** `script-src` carries a per-request nonce with
`strict-dynamic` and never `unsafe-inline` — which would permit Next's inline
scripts *and* anything an injection added, i.e. most of what a CSP is for.
`style-src` does allow inline, deliberately and narrowly: Next and the chart
components set `style` attributes, which carry no nonce, and a style injection
can deface a page but cannot execute. `frame-ancestors`, `object-src`,
`base-uri` and `form-action` are all locked down; `unsafe-eval` and the dev
websocket are development-only. HSTS is sent only over real HTTPS, never from a
dev server — pinning `localhost` would break every other project on the
machine.

A CSP is the one header that fails silently in somebody else's browser, so
`e2e/csp.spec.ts` loads seven screens in Chromium and fails on any violation the
browser reports, in both dev and production builds. It earned its keep
immediately: `next-themes` renders its own inline theme script, which Next does
not nonce, and the policy blocked it — the flash-of-white script, broken by the
thing meant to protect it. The nonce is now threaded from middleware through the
root layout into the provider.

**Not done, and needed before real traffic:**

- Metrics, tracing and alerting — logs are correlated, but nothing aggregates
  or watches them
- Real integrations: the provider interface, six adapters' requirements and every
  pre-send rule exist, but no delivery adapter is implemented, so nothing sends
- Payment collection (GST is computed and shown on proposals, but nothing is invoiced or collected)
- Observability beyond structured logs
- Reviewing `connect-src` against whatever a deployment actually calls — the
  policy allows `'self'` only, so an added analytics or error-reporting
  endpoint needs listing

`lib/nav.ts` carries every route's phase and, for a live screen, what is still
withheld from it — the same list `/whats-new` renders.

Three of the fourteen registry tools are still unbuilt — `research_company`,
`send_email` and `send_whatsapp` — and every screen that depends on one says so
by name rather than degrading quietly. All three need something external: a
licensed data source, an ESP, a WhatsApp Business Account.

**`draft_outreach` is built.** It grounds on two things and nothing else: the
Knowledge Base, which bounds what may be claimed about what you sell, and the
lead's own rows, which bound what may be claimed about them. With either
missing it refuses rather than writing something generic — a generic first
message spends the one impression available. The model writes `{{variables}}`
rather than values, so a draft reviewed today still addresses the right person
if the contact changes before it goes; a placeholder the renderer cannot fill
is rejected outright rather than shipped with visible braces. Every draft
reports what it *withheld* for lack of grounding, which in testing correctly
declined to cite a case study marked as a demonstration reference and declined
to pitch a service whose stated minimum volume the prospect had no record of
meeting. Drafting is not sending: nothing is transmitted, queued, or marked
contacted.

### Colour accessibility

The categorical chart palette is **validated, not eyeballed**. Slots 1–4 pass a
six-check validator — lightness band, chroma floor, CVD separation,
normal-vision floor and surface contrast — in all-pairs mode, in both light and
dark. Dark mode is stepped independently rather than flipped: its band is
narrower, and jade and magenta are separated by lightness because their hues
collapse together under deuteranopia. Sequential data uses a single-hue ramp;
status colours are reserved and never reused as a series colour. Re-run the
validator before changing any `--chart-*` token.

---

## Notes for whoever picks this up

- **AI features degrade honestly.** No provider key is set, so
  `lib/ai/provider.ts` reports `isConfigured() === false` and every AI surface
  says what it would do instead of faking it. Add `ANTHROPIC_API_KEY` to turn on
  the generative paths; the routing table in that file maps each feature to a
  fast, reasoning or embedding tier.
- **The seed is deterministic.** A fixed PRNG seed means every run produces the
  same workspace, which keeps screenshots and tests stable. It also computes
  scores through the real engine, so the evidence shown in the UI is genuine
  rather than hardcoded.
- **`prisma.config.ts`, not `.env` alone.** Prisma 7 no longer reads `.env`
  implicitly and takes the datasource URL from that file.
- **Five bugs found during the build**, as a hint about where the sharp edges
  are:
  1. Concurrent point spends overdrew the balance under `READ COMMITTED` —
     every write is an INSERT, so nothing serialised them. Now takes a
     per-workspace row lock.
  2. Zero-point score evidence was silently dropped, which hid the most useful
     lines in the explainer ("No budget confirmed").
  3. A malformed URL parameter threw instead of falling back, so a stale
     bookmark 500'd.
  4. Pipeline movement summed every stage hop, so a deal that walked three
     stages in a week counted three times — "moved forward" read ₹31Cr against
     a ₹15Cr pipeline.
  5. Client components read `Date.now()` directly, causing intermittent
     hydration mismatches on relative timestamps.
  6. Seeded point-ledger rows were timestamped up to a day in the *future*, so
     "latest row" — which is how the balance is read — returned the wrong one.
  7. `createNote` enforced its parent-required rule only in the route, so
     calling the service directly produced an orphan note. Every mutation
     service now validates its own input.
  8. Verification wording was written for email and claimed a LinkedIn URL had
     been "pattern-matched from a company email format".
  9. BullMQ rejects a custom job id containing `:`, which silently turned every
     enqueue into a caught error reported as "queue unreachable".
  10. The job monitor showed "Next just now" for all seven schedules, because a
      next-run time is in the *future* and `formatAge` clamps that to "just now".

  All ten are fixed and covered by tests.
