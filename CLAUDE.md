# Working in this repository

Signalroom — a B2B revenue operating system. Read `README.md` first for the
stack, setup and what is built versus routed-but-inert.

## Non-negotiables

**Never bypass tenant scoping.** Every service function takes an `AuthContext`
and puts `workspaceId` in the `where` clause. Row-level visibility comes from
`leadVisibilityFilter(ctx)` — a Prisma `where` fragment, so the restriction
lands in SQL. Filtering in a component or a `.filter()` after the query is a
security bug. When a record is out of tenant or out of visibility, return `null`
and let the route produce a 404; the two must be indistinguishable from outside.

**Never ship a control that silently does nothing.** If the backend isn't built,
say so in the UI and state that nothing was changed or charged. Routes without a
backend use `PlannedPage` and get their copy from `lib/nav.ts`.

**Never invent a number.** Every figure on screen traces to a row. If a value
rests on an assumption — a stage probability, a coverage ratio, a straight-line
projection — put the assumption next to it. Placeholder metrics are worse than
an empty state.

**Never let an LLM produce a score.** `lib/scoring.ts` is pure and
deterministic. AI explains those numbers; it does not generate them. The Copilot
answers only from the tool registry in `lib/ai/tools.ts`, and says so when it
has no tool for a question.

**Colours are semantic.** Use `surface`, `border`, `text-secondary`,
`intent-hot`, `tier-a`. Never a raw Tailwind colour. Before touching any
`--chart-*` token, re-run the palette validator — those values were computed,
not chosen, and they pass in all-pairs mode in both themes.

## Where code goes

| Need | Location |
| --- | --- |
| Database access | `lib/services/*` — always `import "server-only"` |
| Shared client/server types | `lib/leads/filter.ts` is the pattern: no DB imports |
| A user-facing status word | `lib/vocab.ts`, never inline |
| A new route in the nav | `lib/nav.ts`, then a page |
| Money or date formatting | `lib/format.ts` |
| Audit or activity rows | `lib/services/audit.ts` |
| A new write | `lib/services/*-mutations.ts`, via `mutate()` |
| Calling the API from a component | `lib/api/client.ts` |
| A background job | `lib/queue/handlers/*`, registered in `lib/queue/router.ts` |
| A new lead source | `lib/ingest/sources.ts`, with honest `configured`/`requires`/`compliance` |
| Parsing a pasted list | `lib/ingest/import.ts` — `parseDelimited` is pure and tested separately |
| A rule that can stop a send | `lib/outreach/sendability.ts`, with a `scope` |
| Actually transmitting an email | `lib/outreach/transport.ts`, then an adapter in `lib/outreach/adapters/*` |
| Building the bytes of an email | `lib/outreach/mime.ts` — pure, and the hard parts are tested |
| Choosing a recipient address | `lib/outreach/recipient.ts` — never inline, see below |
| Outreach copy variables | `lib/outreach/template.ts`, and both resolvers must fill it |
| Any money arithmetic | `lib/proposals/money.ts` — integer paise, never float rupees |
| A prospect-facing page | outside the `(app)` group, so no auth runs; the token is the authorisation |
| An audit row with no user | `recordExternalAudit` in `lib/services/audit.ts` |
| A rule that can stop an agent | `lib/autopilot/guardrails.ts`, with a disposition |
| A new agent tool | `lib/ai/tools.ts` — an agent may only hold tools declared there |
| A machine-callable endpoint | `lib/api/manifest.ts`, then `resolveCaller` in the route |
| A new API scope | `lib/auth/api-scopes.ts`, with `requires` *and* `grants` |
| A new webhook event | `lib/services/webhooks.ts`, with honest `emitted` |

Prisma `Decimal` and `Date` must not cross into components. Convert once at the
service boundary with `toPlain()` from `lib/serialize.ts`.

## Writing a mutation

Wrap it in `mutate()` from `lib/services/mutate.ts`. That single call enforces
the permission, writes the audit entry with before/after, and optionally writes
the activity row — doing those by hand at thirty call sites is how one ends up
missing a tenant check.

```ts
export async function updateThing(ctx: AuthContext, id: string, raw: Input) {
  const input = thingSchema.parse(raw);      // validate here, not in the route
  const thing = await loadScoped(            // 404 if out of tenant or visibility
    () => db.thing.findFirst({ where: { id, workspaceId: ctx.workspaceId } }),
    "That thing"
  );

  return mutate(ctx, PERMISSIONS.THING_EDIT, async () => {
    const updated = await db.thing.update({ where: { id }, data: input });
    return {
      result: toPlain(updated),
      log: {
        action: "thing.updated",
        objectType: "Thing",
        objectId: id,
        before: { name: thing.name },
        after: { name: updated.name },
        // Omit `activity` for private or trivial changes, like a star.
        activity: { kind: "thing.updated", summary: `${thing.name} updated` },
      },
    };
  });
}
```

Deleting means `softDelete()`, which indexes the row for the recycle bin so
restore and the visible purge date both work. Never hard-delete tenant data.

Throw `MutationError` with a sentence a person can act on; the API error mapper
passes it straight through, so the wording you write is the wording the user
reads.

## Writing a background job

Add it to `JOB` in `lib/queue/jobs.ts` with a payload type, a retry policy and
— if it recurs — a schedule with a sentence explaining *why* that cadence. Then
write the handler and register it in `runJob`; the switch is exhaustive, so a
job without a handler is a type error.

**Handlers must be idempotent.** BullMQ redelivers a job whose worker died
mid-flight, so a second run has to be harmless. The existing handlers achieve
this by being pure recomputations (rescore), by replacing rather than appending
(evidence, next-best-actions), or by checking "already done" first (webhook
delivery). Verify it: run the job twice and confirm no row count moves.

Enqueue with `enqueue()`, which never throws — a queue outage must not fail the
user's request. Check `result.queued` if the caller needs to know. Dedupe keys
are sanitised because BullMQ reserves `:`.

## Conventions

- **URL as state** where it can be. The Leads screen puts filters in search
  params, which makes every view shareable and saveable for free. Reach for
  TanStack Query only when the URL genuinely can't carry it.
- **Parse tolerantly.** URLs get hand-edited and bookmarks go stale. Drop the
  invalid field and keep the rest — see `parseTolerantly` in `lib/leads/params.ts`.
- **Optimistic mutations snapshot and roll back**, and the failure toast says
  what was restored. `commitMove` in `components/pipeline/board.tsx` is the
  reference.
- **Every data surface needs four states**: skeleton, empty, error and
  partial-error. `components/ui/states.tsx` has them. Empty states teach — name
  what's missing, why, and the one action that fixes it.
- **Spending points** goes through `spendPoints` with an idempotency key. It
  takes a per-workspace row lock; don't write to `PointLedger` directly, and
  never update or delete a ledger row.
- **The queue is optional.** Guard on `isQueueConfigured()` and degrade to an
  explicit "unavailable" state, the way `lib/ai/provider.ts` does. The app must
  stay usable with no Redis.
- **Never read the clock directly in a client component.** Relative times are
  rendered once on the server and again at hydration; two `Date.now()` calls
  either side of a boundary produce a hydration mismatch. Use `formatAge`,
  `formatRelative`, `hoursSince` or `isPast` from `lib/format.ts` — they all
  floor the reference to the start of the minute so both renders agree.
- **A preview must use the same semantics as the engine it previews.** The ICP
  match preview gates on industry and headcount only, because that is what
  `lib/scoring.ts` treats as a requirement — technology overlap is a *bonus*
  there. When the preview filtered on tech too, a correct ICP previewed as
  "0 of 115 leads match", which reads as a broken definition.
- **Withhold a statistic rather than computing it from nothing.** A reply rate
  over zero sends is `null`, not `0%`, and a phrase verdict below the sample
  threshold is `insufficient_data` with a sentence saying so.
- **Deleting a thing must not rewrite history.** Removing a search phrase stops
  the watch and leaves `Lead.sourcePhraseId` intact, so won revenue keeps its
  origin. Same reason ICP profiles can't be deleted while leads are scored
  against them.
- **A blocker carries a scope, not a boolean.** `lib/outreach/sendability.ts`
  classifies every reason a send can be refused as `schedule` (the clock will
  clear it), `config` (an admin must connect something), `sequence` (someone
  paused it) or `lead` (this person cannot be contacted). `dispositionOf()`
  turns that into send / reschedule / hold / stop. **Only `lead` ends an
  enrollment.** With a boolean "the clock will fix it", a missing mailbox
  looked the same as a suppressed address, so the first run of the engine
  permanently stopped every enrollment in a workspace that had not connected
  one yet.
- **Sharing the rules is not enough; share the inputs too.** `checkSendable`
  made every call site ask the same questions, but the engine and enrollment
  still computed the *answers* differently — one honoured a per-contact
  `optedOutAt` and the other did not, so a lead who had unsubscribed was
  refused with "no email address on this lead". Recipient choice now lives in
  `lib/outreach/recipient.ts` and everything calls it.
- **Report the most specific reason.** No address, unsubscribed, and
  hard-bounced are three different facts that lead to three different actions.
  `checkSendable` suppresses the generic `no_address` blocker when a
  suppression already explains the absence.
- **A control that is deliberately absent says why.** `MANUAL_TRIGGER` in
  `lib/queue/jobs.ts` records, per job, either that a manual run is allowed or
  the reason it is not — and the monitor renders that reason where the button
  would be. The list used to be duplicated in the route and the view.
- **Round money once, at the line.** `lineAmount` rounds each line to paise so
  the subtotal equals the sum of the figures printed beside the lines.
  Rounding only at the end gives a subtotal that does not match its own table,
  which is the one arithmetic error a customer will always spot.
- **Report a money mismatch; never silently fix it.** `reconcile` returns the
  discrepancy. The send path refuses to publish one and the nightly audit job
  raises it, but neither rewrites the stored figures — a price the customer has
  already seen must not change without someone deciding to change it.
- **Compare validity dates by local calendar day.** A proposal valid until the
  30th is valid for all of the 30th in the workspace's timezone. An
  instant-based comparison expires it at 05:30 IST. `isExpired` and
  `daysUntilExpiry` use `localDateKey`.
- **Your own team's activity is not buyer signal.** The proposal view counter
  excludes readers with a session in the owning workspace, and bursts from one
  reader inside a minute collapse to a single view. Without that, the number
  the seller reads as interest is mostly their own refreshes.
- **State the limit of what a public action proves.** A link holder's name is
  *claimed*, never verified, and every record of their decision says so.
- **Put the scale in the field name when a value has two of them.**
  `LeadScore` carries `composite` (0–100) and `displayScore` (0–10), and
  `minScore` is a composite threshold. Passing the display score refused every
  lead in the workspace for being "below 70" when it scored 7.0. The guardrail
  field is now `scoreOutOf100`, which makes the mistake unwriteable.
- **A guardrail returns a disposition, not a boolean.** `allow`, `approve`,
  `defer`, `refuse` — see `lib/autopilot/guardrails.ts`. The headline guard is
  picked by *severity*, not insertion order, or a daily cap gets reported
  ahead of "this lead is on the do-not-contact list".
- **An agent may only hold tools the registry declares.** `toolHealth()`
  distinguishes unknown from declared-but-unbuilt, because they need different
  fixes: remove it from the agent, or build it. An agent with no usable tool is
  *inert* and cannot be enabled.
- **A preview must call the function the runner calls.** `dryRunAgent` runs the
  real evaluator over real leads and writes nothing. That is what makes it a
  prediction rather than a guess.
- **A tool is never a second way into the database.** Every non-READ tool's
  `execute` delegates to the ordinary mutation service, so an agent gets the
  same permission check, tenant scoping, audit row and activity row a human
  does. A tool that wrote with `db.*` directly would bypass all four.
- **Price a SPEND tool before deciding, not after.** The guardrails need the
  cost to know whether approval is required, so every implemented SPEND tool
  has `priceOf`. A quote that cannot be produced refuses the call rather than
  spending blind.
- **Record refusals and deferrals, not just successes.** Without an
  `AgentAction` row for them, "the agent did nothing" and "the agent was
  stopped for a reason" look identical later. Only `completed` and `approved`
  count against a budget — a refusal must not consume the day's allowance.
- **Approval satisfies approval requirements, not safety rules.** The re-check
  at execution time skips the approval-scoped guards via `alreadyApproved`,
  because otherwise review-first mode *deadlocks*: the re-check sees "this mode
  requires review", holds the action again, and approving that holds a third
  time. Suppression, budgets, send windows and a missing provider still apply —
  approval is permission to act, not an exemption.
- **Machine callers use `resolveCaller`, never a parallel auth path.** It
  returns an ordinary `AuthContext` whether the caller is a session or a key,
  so the services enforce scopes for free. A *bad* key is a failure, never a
  fall-through to the session — falling back would let a browser-authenticated
  request succeed with authority the key never had.
- **A scope declares `requires` and `grants` separately.** `grants` is what it
  passes through if the creator holds it; `requires` is the minimum that makes
  it meaningful. Checking against `grants` made `leads.read` ungrantable by
  anyone without `view_all`, so a rep could not issue a read key for their own
  leads — the common case.
- **A read screen and its gate must ask the same question.** `listApiKeys`
  omitted `deletedAt: null` on the creator lookup and so called a key "active"
  that `authenticateApiKey` refused as orphaned. Any screen describing whether
  a credential works must filter exactly as the authenticator does.
- **Dense type scale.** `text-sm` is 13px here, not 14. Tabular numerals on
  anything in a column.
- **Transitions 150–250ms**, and not on everything.

## Before saying a screen is done

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

`npm run e2e` runs Playwright against a real browser and the seeded database.
It signs in for real, so two runs inside five minutes trip the product's own
sign-in limiter — that is the limiter working, not the suite breaking. Specs
reuse one session via the `setup` project; only `auth.spec.ts` drives the login
form, because that is what it tests. Nothing in the suite accepts a seeded
proposal: accepting is irreversible, and a test that cannot run twice is not a
test.

Then look at it: desktop and mobile width, light and dark, with data and empty.
`npm run build` while `npm run dev` is running will invalidate the dev server's
chunks — restart it afterwards. It can also make the *build* fail with
"Failed to collect page data for /_not-found"; stop the dev server and rebuild
before believing that one.

## Gotchas

- **A 5xx from a relay must not be retried.** `sendEmail` returns `retryable`,
  and the handler keeps a message QUEUED only when it is true. Retrying
  something a relay has already refused permanently is how a sending domain's
  reputation degrades, and the refusal will not change.
- **An SMTP reply can span several lines.** `250-SIZE` continues, `250 SIZE`
  ends. Reading only the first line makes EHLO capability detection wrong, and
  the practical effect is that STARTTLS is never detected — so mail goes out in
  clear against a server that offered TLS.
- **A body line beginning with `.` must be doubled before DATA.** A lone `.` on
  its own line is what ends the message, so an unescaped one truncates it
  exactly there. `dotStuff` in `lib/outreach/mime.ts`.
- **A credential is not an adapter.** `ADAPTER_BUILT` in
  `lib/outreach/provider.ts` is separate from `isEmailConfigured()`, because a
  key for a provider with no adapter makes every screen say "connected" and
  still sends nothing. `canActuallySend()` is the one to gate on.

- **A CSP nonce has to reach third-party inline scripts yourself.** Next stamps
  its own inline scripts with the nonce from the request's CSP header, but not
  ones a library renders. `next-themes` emits a theme-setting script before
  first paint; it takes a `nonce` prop, threaded from middleware through the
  root layout. Anything else that renders an inline script needs the same, and
  `e2e/csp.spec.ts` is what catches it.
- **`waitForLoadState("networkidle")` never settles on the data-heavy screens.**
  Today, Leads and Pipeline keep a connection open, so a test waiting on it
  times out instead of asserting. Wait for the app shell and a short settle.


- **Prisma 7** requires a driver adapter (`@prisma/adapter-pg`) and reads the
  datasource URL from `prisma.config.ts`, not `.env` implicitly. The generated
  client lives in `src/generated/prisma` and is gitignored — run
  `npx prisma generate` after pulling a schema change.
- **`server-only` breaks Vitest.** It's aliased to a stub in
  `vitest.config.mts`.
- **dnd-kit needs a stable `DndContext id`** or its generated ARIA ids mismatch
  between server and client renders.
- **Integration tests share one database** and truncate tables, so
  `fileParallelism` is off and `tests/setup.ts` refuses a non-local
  `DATABASE_URL`.
- **Streaming and 404s**: `notFound()` after the shell has flushed yields a 200
  status with 404 content. That's a Next.js streaming trade-off, not a bug.
- **The worker needs `server-only` aliased.** It runs under tsx, not Next's
  bundler, so `tsconfig.worker.json` maps it to the package's own no-op build —
  the same file Next swaps in via the `react-server` condition.
- **`formatAge` is for the past.** It clamps a future date to "just now". Use
  `formatRelative` for anything upcoming, like a next scheduled run.
- **BullMQ rejects a custom job id containing `:`** — every enqueue then fails
  silently and reports as "queue unreachable". `safeJobId()` in
  `lib/queue/producer.ts` sanitises it.
- **Dedupe keys must be time-bucketed.** A permanent key made a second
  legitimate rescore a no-op while the UI promised "101 leads will be
  recomputed". `bucketed()` scopes the key to a window.
- **Word-boundary matching breaks industry stems.** `lib/icp/extract.ts` needs
  both matchers: `findTerm` for whole words with optional plurals ("VPs"), and
  `findStem` for prefixes ("manufactur" → "manufacturing"). Using only one
  loses either plurals or stems.
- **"I sell Salesforce" is not "the prospect runs Salesforce."** The extractor
  scores sell-cues against stack-cues to decide between `sellsTechnologies` and
  `technologies`; getting this backwards inverts the whole ICP. The two lists
  also need *opposite* phrase suggestions — "looking for an SAP partner" finds
  companies buying SAP, which is wrong when SAP is what your prospects want to
  leave.
- **The forward cue window is one word wide, deliberately.** It has to be, so
  "Salesforce implementation" reads as sell-side. Widening it to a character
  span let the next clause decide: in *"Oracle NetSuite for distributors
  currently using Tally"*, Tally's cues dragged Oracle NetSuite into the stack
  bucket.
- **Plurals are not always on the last word.** "VPs of IT" pluralises the
  first, so `findTerm` allows an optional plural after *every* word of a
  multi-word term.
- **Anything the extractor used must be consumed.** A fired cue, a sibling
  pattern of a matched trigger ("just raised funding" hits both `raised` and
  `funding`), and the tail of a stem-matched word all have to be marked
  accounted for, or they resurface under "not understood" and contradict the
  match list right next to them.
- **`npm run build` warns that `@valkey/valkey-glide` is missing.** That is
  BullMQ's optional Valkey driver; this app uses ioredis. Harmless.
- **Grid children need `min-w-0`.** A grid item defaults to
  `min-width: auto`, so a long unbroken string defeats `truncate` and pushes
  the whole column past the viewport instead. This is what broke the Inbox at
  phone width.
- **Scheduling columns are `timestamp without time zone`.** Prisma writes and
  reads them in UTC, which is self-consistent — but raw SQL using `now()`
  writes *local* time, and in IST that is a five-and-a-half hour skew that
  makes a due row look scheduled for later. Use
  `(now() AT TIME ZONE 'UTC')` in any hand-written SQL that touches
  `nextSendAt`, `snoozedUntil` or similar.
- **`tsconfig.worker.json` emits CJS, so there is no top-level await.** Wrap a
  one-off worker-side script in an async function and call it.
- **A variable added to `TEMPLATE_VARIABLES` must also be filled** by
  `templateValues` in the outreach handler *and* by `previewStep`. Declaring
  one without resolving it makes every use permanently "missing", which stops
  leads. There is a test that renders every declared variable to catch this.
- **Adding a `NotificationKind` needs a migration.** It is a Postgres enum, so
  `prisma migrate dev` then `prisma generate`; a stale client fails typecheck
  with "not assignable to type 'NotificationKind'".
- **`Notification` is per-user and has no dedupe key.** Pick the accountable
  user explicitly — the proposal's author, falling back to the lead's owner.
- **One predicate, one meaning.** The bookings screen had three separate
  conditions for "this meeting still needs an outcome" and they disagreed: a
  seeded meeting arrives `completed` with empty outcomes, so gating capture on
  `state === "scheduled"` badged it Completed and offered no way to record
  anything. `needsOutcomeRecorded` is now the single source.
- **Never let a test infer a provider's absence from `.env`.** Several tests
  asserted "nothing is configured" and silently inverted their meaning the
  moment a real `ANTHROPIC_API_KEY` was added to the developer's environment.
  Tests about the unconfigured path now call a `withoutAi()` / `withoutEmail()`
  / `withoutCalendar()` helper that stubs the keys empty, so they state their
  assumption instead of inheriting it.
- **`api` in `lib/api/client.ts` had no `put`** while several routes were PUT,
  so nothing could call them. Add the method to both the `api` object and the
  method union in `request()`.
- **`.next/types` goes stale after adding a route.** A typecheck that
  complains a brand-new route "does not satisfy AppRouteHandlerRoutes" is
  reading a generated validator from before the file existed —
  `rm -rf .next/types` and re-run.
