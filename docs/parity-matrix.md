# ProspecX → Signalroom visual and interaction parity matrix

**Date:** 2026-09-25

**Method.** This matrix was built from the authenticated reference evidence captured on
2026-09-24. That session used a ProspecX workspace on the Sales role and made no sends,
purchases or production edits. The comparison side is a source read of this repository as it
stands today. **No fresh browser session against ProspecX was made for this document.** No
Signalroom screen was re-rendered for it either: every Signalroom citation is a file that exists
in the repo, checked by listing and grep. Rows marked "Matches" mean that the observed reference
control or behaviour has an equivalent control and code path here. They are not a pixel
comparison, because no reference screenshots exist (see Evidence). Earlier reference evidence is
used as the baseline, as `version-3-audit-2026-09-25.md` asks. Fresh access is requested only for
states that were never captured.

## Evidence keys

All reference evidence lives in
`/Users/lstuser/Documents/Codex/2026-09-24/files-mentioned-by-the-user-lead/outputs/`.
The copies in `ProspecX-Signalroom-Audit/` and `Current-App-Audit/` match the top-level files.

| Key | File | What it is |
| --- | --- | --- |
| VN | `verification-notes.txt` | The raw observation log. The "ProspecX audit evidence, 2026-09-24" half is the reference. The "Signalroom audit" half is the 24 Sep runtime pass. Cited by section, for example VN §Today. |
| MA | `02-module-audit.md` | The ProspecX module map, with routes, controls and each verification boundary. |
| FF | `04-fields-and-forms.md` | The field and form catalogue, with observed placeholders, options and defaults. |
| FC | `03-feature-comparison.md` / `feature-comparison.json` | The 82-feature comparison, F001–F082. |
| CW | `current-feature-crosswalk.md` | Developer-reported task outcomes, T01–T40. These are claims, not proof. |
| CS | `current-status-2026-09-24.md` | Independent audit of the 24 Sep ZIP. |
| V3 | `version-3-audit-2026-09-25.md` | Independent audit of the 25 Sep ZIP, defects D01–D06. |
| AM | `docs/acceptance-matrix.md` (this repo) | Developer acceptance statuses, N01–N23. These are claims, not proof. |

**Screenshots: none.** No `.png`, `.jpg`, `.jpeg` or `.webp` exists in `outputs/`,
`ProspecX-Signalroom-Audit/` or `Current-App-Audit/`. `audit-reader.html` has no embedded images.
Every reference citation below points to a written observation. Visual properties such as
spacing, colour, typography and iconography were never captured. That gap is the main item under
"Needs fresh reference access".

`page-inventory.json` lists **Signalroom's** routes, not ProspecX's, despite its name. The
ProspecX route list is the module map in MA.

## Status vocabulary

| Status | Used when |
| --- | --- |
| Matches | The evidence shows an equivalent control or behaviour. |
| Implemented, differs | It is built here, with a named visible or interaction difference. |
| Partial | Part of the observed reference behaviour exists here, and the missing part is named. |
| Missing | The reference behaviour was observed and has no counterpart here. |
| Planned (inert route) | The route exists but renders `PlannedPage`. **No route currently does.** `src/components/planned-page.tsx` exists, but no `page.tsx` imports it, and every `NavItem` in `src/lib/nav.ts` is `status: "live"`. |
| Not observed in reference | The 2026-09-24 session never captured this state. It needs fresh access. |
| Accepted difference | The evidence records an agreed divergence. **No row uses it**, because none of the evidence records an agreement. See "Differences that need a decision". |

---

## 1. Shell and navigation

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| S-01 | The sidebar has three groups. Work: Today, Leads, Find leads, Pipeline, TeamCollab, My queue, Inbox, Outreach, Autopilot, WhatsApp, LinkedIn, Proposals, Bookings. Intelligence: Lead Lens, People Finder, Live Demand, Lists, Saved & Alerts, Insights, Radar, Team. Support: Settings, Support. (VN §Navigation observed; FC F001) | `src/lib/nav.ts`, `src/components/shell/sidebar.tsx` | Implemented, differs | The groups are Workspace, Intelligence, AI, and Admin & Support. There are extra entries: Opportunities, Accounts, Competitors, Market Intelligence, the whole AI group, and around 30 settings pages in the sidebar. "Find leads" is labelled "Find Opportunities". (CS gap 16) |
| S-02 | The header global search for "Kajal" returned one lead, and Return opened that lead's detail. (VN §Remaining…/Notifications; MA Global search) | `src/components/shell/command-palette.tsx` → `/api/search` | Matches | The palette queries `/api/search`. This lookup was not re-run against a populated Signalroom workspace. |
| S-03 | There is a notifications control in the header. (VN §Navigation) | `src/components/shell/notification-center.tsx` (in `topbar.tsx`) | Matches | It is a popover with "Mark all read". The full-page state is covered in N-01. |
| S-04 | A header approvals count opens a popover with 4 pending Dost AI items: invoice, sign-off, negotiate, send scope. It warns that approving goes to the client at once. (VN §Supplemental; MA Approvals popover) | Sidebar `counter: "approvals"` in `src/lib/nav.ts`; `/approvals` → `src/components/autopilot/approvals-view.tsx` | Implemented, differs | The count is on a sidebar item and there is no header popover. Signalroom's approval queue holds AI agent actions. TeamCollab client-approval gates are recorded on plan steps (CW T18), not in this queue. |
| S-05 | A points balance shows in the header. (VN §Navigation) | `PointsMeter` in `src/components/shell/sidebar.tsx` footer | Implemented, differs | It sits in the sidebar footer, not the header. |
| S-06 | There is a theme control in the header. (VN §Navigation) | `src/components/shell/theme-toggle.tsx` | Matches | The control exists. What ProspecX looks like in dark mode was never captured (M-02). |
| S-07 | Today has "Today classic" and lead console links. (VN §Navigation) | Classic / Mission Control switch in `src/app/(app)/today/today-view.tsx`, persisted by the `sr_today_layout` cookie in `today/page.tsx` | Matches | The lead has a single layout here (LD-01). |
| S-08 | A demand company link opens Account Lens at `/app/account/[name]`. (VN §Supplemental; FC F002) | `src/app/(app)/accounts/[id]/page.tsx` | Implemented, differs | The route is keyed by UUID, not by name. On 24 Sep it returned 404 (VN Signalroom §Supplemental). The route exists now (CW T01) but has not been re-checked at runtime. |

## 2. Dashboard / Today

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| T-01 | Mission control has an AI copilot. (VN §Today) | `CopilotBrief` in `src/components/today/brief.tsx`; `src/components/shell/copilot-drawer.tsx` | Implemented, differs | The brief is a deterministic summary, and conversation happens in a drawer or at `/copilot`. See AI-01. |
| T-02 | A locked lead of the day, with Open, Reveal and Console. (VN §Today) | `src/components/today/lead-of-day.tsx` (uses `RevealButton`) | Matches | Dismissing lasts one day and is stored in the browser (`lead-of-day.tsx:74–79`). The no-op defect from 24 Sep (FC F005) is reported fixed (CW T02). |
| T-03 | Opportunity and revenue value, with an **editable goal** button. (VN §Today) | `RevenueInReach` / `RevenueInMotion` in `src/components/today/revenue.tsx` | Partial | The tiles are Open pipeline, Weighted, Commit and At risk. No goal or target control was found in `src/components/today/`. |
| T-04 | Sales health covers reply rate, coverage, consistency, freshness and follow-through. (VN §Today) | `src/components/today/health.tsx`; dimensions in `src/lib/services/today.ts:661–668` | Implemented, differs | There are eight weighted dimensions: coverage (with a 3× assumption stated), momentum, follow-up discipline, response rate, conversion, deal aging, buyer intent and next-step hygiene. There is no "consistency" or "freshness" dimension. |
| T-05 | 14-day momentum with 7-day comparisons, plus an **activity heatmap**. (VN §Today) | Period switch in `RevenueInMotion` (`revenue.tsx:231`) | Partial | There are period-switched movement tiles. There is no heatmap component. `nav.ts` still lists "Activity heatmaps by hour and day" as planned, under Team. |
| T-06 | Widgets for hot, awaiting reply, added and overnight. (VN §Today) | `brief.tsx:111–114`: New signals, New leads, Replies waiting, Due today | Implemented, differs | The four tiles link to filtered views. Their labels and grouping differ. |
| T-07 | A prioritised worklist of buyers and follow-ups. (VN §Today) | `src/components/today/worklist.tsx` | Matches | Draft, snooze and delegate are reported wired (CW T02). They were placeholder toasts on 24 Sep (FC F041). |
| T-08 | An AI coach. (VN §Today) | `AiSalesCoach` in `src/components/today/sidecards.tsx:43` | Implemented, differs | It is withheld, with an explanatory empty state, until the workspace has enough data. When shown, it states its confidence and evidence. |
| T-09 | India Demand Index: aggregate industries and trends. (VN §Today; FC F007) | `DemandIndexTeaser` in `sidecards.tsx:472` | Partial | This shows demand from the workspace's own searches only, and says so. The platform-wide index is blocked on a cross-customer dataset (AM F007, N19). |
| T-10 | An audio morning briefing. Playback was not tested. (VN §Today; FC F006) | `today/page.tsx` "Morning briefing — listen" → `src/components/voice/voice-player.tsx`; `MorningBriefing` card in `sidecards.tsx:421` | Implemented, differs | It uses browser speech synthesis. MP3 download needs `OPENAI_API_KEY` (AM N18). The `sidecards.tsx:421` card is still commented "Honest about not being wired up" and renders beside the new player, so check it for stale copy. |
| T-11 | A pipeline forecast. (VN §Today) | "Commit" tile, `revenue.tsx:72–78` | Implemented, differs | The assumption is stated beside the figure: stage probability above 65% and owner confidence of 70% or more. |
| T-12 | Seven-day sent, replied, booked and sequences. (VN §Today) | `revenue.tsx:97–121`: Added this week, Moved forward, Moved backward, Won (30 days), On watch | Implemented, differs | These are deal-movement figures, not outreach-activity counts. |
| T-13 | A calendar connect card on Today. (VN §Today) | `src/components/admin/calendar-connection.tsx` on `/settings/calendar` | Implemented, differs | Calendar connection exists, but only in Settings. No Today card was found. |
| T-14 | Reminders, stages and search-suggestion widgets. (VN §Today) | "Due today" tile (`brief.tsx:113`) → `/my-queue` | Partial | Reminders surface as due tasks. No stage or search-suggestion widget was found in `src/components/today/`. |
| T-15 | "Find fresh leads free today" (also shown as 1 point per keyword), and a plan widget. (VN §Today; FF Find leads notes the conflicting pricing copy) | none on Today | Missing | There is no Today entry point for a discovery run or plan status. Discovery starts at `/find-leads`. |
| T-16 | A sticky-notes textarea, five colours, and Add disabled when empty. (VN §Today) | `StickyNotes` in `sidecards.tsx:375`; creates `kind: "PERSONAL", color: "amber"` (`sidecards.tsx:355`) | Implemented, differs | The Today composer always uses amber. The five colours are only on the TeamCollab scratchpad (FF Signalroom Shared note). |
| T-17 | Start a work session. (VN §Today via FC F005) | `onStartSession` → `/my-queue?focus=1` (`today-view.tsx:135`) | Matches | It was a placeholder on 24 Sep and is reported wired (CW T02). |

## 3. Leads list

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| L-01 | Counts for total, hot, reached and qualified, plus an "AI read" and four focus shortcuts. (VN §Leads) | `src/components/leads/shortcuts.tsx`; shortcut keys in `src/lib/leads/filter.ts:95–137` | Implemented, differs | There are eight shortcuts: richest-vein, score-8-plus, reachable-now, names-a-budget, decision-makers, fresh-today, hot-intent and no-outreach. No "AI read" summary was found on the Leads screen. |
| L-02 | A Fresh / Older cohort checkbox, showing 88 / 26. (VN §Leads; FF Lead filters) | Added-date range in `src/components/leads/filter-panel.tsx` (CW T13) | Implemented, differs | There is no two-way Fresh/Older toggle. The same cut needs a date range. |
| L-03 | The search placeholder covers name, company and headline. (FF Lead filters) | `leads-view.tsx:119`: "Search name, company, title, signal…" | Matches | — |
| L-04 | Sort options: Newest scraped, Top score, Biggest budget, Oldest first. (FF Lead filters) | `sort` enum in `lib/leads/filter.ts:59–62`: score, surfaced, activity, value, name, company and intent, plus `dir` | Implemented, differs | Sorting is per column with a direction. The default is score, not newest. |
| L-05 | A Cards/Table toggle, verified. (VN §Leads) | `View = "table" \| "cards" \| "compact"` in `src/components/leads/leads-view.tsx:37` | Matches | Signalroom adds a Compact view. |
| L-06 | Tier: All, A Hot, B, C, D. (FF Lead filters) | Tiers A–D in `filter-panel.tsx` (VN Signalroom §Runtime verified) | Matches | — |
| L-07 | Status: New, Contacted, Replied, Qualified, Proposal Sent, Won, Lost, Saved, archived. (FF Lead filters) | `LEAD_STATUS` in `src/lib/vocab.ts:90`: New, Working, Contacted, Replied, Qualified, Nurture, Unqualified | Implemented, differs | Proposal Sent, Won and Lost are deal stages, not lead statuses (CW T14). There is no Saved status. Archived is a separate flag. |
| L-08 | Intent: Buyer project, Buyer brand, Hiring, Informational. (FF Lead filters) | Intent facet Cold, Aware, Warm, Hot, Buying (VN Signalroom §Runtime verified) | Implemented, differs | Intent here is a temperature scale, not a buyer-type taxonomy. |
| L-09 | Starred and Trash views. (VN §Leads) | `starred` in `lib/leads/filter.ts:49`; Trash → `/recycle-bin` | Implemented, differs | Trash is a separate screen, not a view of the list. |
| L-10 | Expanded filters. Added: anytime, today, week, month. Min score 1–10 and max score 10–1. Source: Found by Prospecx or Added manually. A country text field. Comma-separated tags. "Has verified contact" and "Has stated budget". (FF Lead filters) | `filter-panel.tsx`, with country, tag, source and added-date added (CW T13) | Implemented, differs | Dates are a range, not presets. The score scale is 0–10. Signalroom adds AND/OR groups and industry, city, size, technology, seniority, department and owner facets (VN Signalroom). |
| L-11 | Table columns: Lead, Company, Tier, Score, Intent, Status, Contacts, Updated, plus watch. (FF Lead filters) | `src/components/leads/leads-table.tsx` | Implemented, differs | The table is wider: selection/star, Signal, Stage, Reachable, Value, Last activity, Next action, Owner and Surfaced (VN Signalroom §Runtime verified). |
| L-12 | Previous/Next pagination at 50 per page. (VN §Leads) | `pageSize` default 50, range 10–200 (`lib/leads/filter.ts:64`) | Matches | Moving between pages is unproven here, because the 24 Sep dataset had 2 records (FC F010). |
| L-13 | Unlocking a locked lead costs 1 point, spent per lead. (VN §Leads) | `src/components/leads/reveal-button.tsx`; `/api/leads/[id]/reveal` | Matches | The per-lead point price was not compared. |
| L-14 | Bulk selection, add, import and export: "No bulk selection/add/import/export observed here." (VN §Leads) | `src/components/leads/bulk-actions.tsx`, `add-lead-dialog.tsx`, `SaveSearchButton` | Not observed in reference | Signalroom has these. The Sales role never showed them in ProspecX, so they cannot be called a parity match or a gap. |

## 4. Lead detail

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| LD-01 | Two layouts for the lead, Console and Classic, and both were opened. (VN §Lead detail; MA Lead console + Classic) | `src/app/(app)/leads/[id]/page.tsx` | Implemented, differs | There is one dossier layout. |
| LD-02 | Back and a PDF dossier download. The download was not exercised. (VN §Lead detail; FC F025) | `header.tsx:230` → `/api/leads/[id]/pdf`; `src/app/print/leads/[id]/page.tsx` | Matches | Reported implemented (AM N21). PDF visual fidelity against the reference is unverified. |
| LD-03 | "Unassigned", Claim, and a Share assignee dropdown (Jyoti / Aditi). (VN §Lead detail; FF Lead status and assignment) | `header.tsx:205–209` shows the owner avatar only; `src/components/leads/claim-queue.tsx` on `/leads`; `/api/leads/[id]/claim`; bulk assign in `bulk-actions.tsx` | Implemented, differs | There is no claim or share control in the dossier header. Claiming happens from the Leads claim queue (AM F015). |
| LD-04 | A status dropdown with 9 values. (FF Lead status and assignment) | `StatusMenu` in `src/components/leads/dossier/lead-actions.tsx:94` | Implemented, differs | It has 7 statuses. See L-07. |
| LD-05 | Star. (VN §Lead detail) | `StarToggle` in `header.tsx:227` | Matches | — |
| LD-06 | LinkedIn, score 9, tier A, "buyer brand 90%", country and date. (VN §Lead detail) | LinkedIn link at `header.tsx:155–162`, with tier and intent badges | Implemented, differs | Intent is a temperature label, not a buyer-type percentage (L-08). |
| LD-07 | AI verdict with deal temperature 91/100. (VN §Lead detail) | `AiVerdict` in `src/components/leads/dossier/verdict.tsx` with `DealTemperature` | Matches | The explanation is built from `lib/leads/assessment.ts`. The "all evidenced" defect (FC F019) is reported fixed (CW T08). |
| LD-08 | Fit radar with Intent 3/3, Fit 3/3, Urgency 1/2, Budget 2/2; freshness "85% within 7 days"; readiness 5/7 (71%). (VN §Lead detail) | `FitRadarPanel`, `ReadinessChecklist` (`verdict.tsx`); `fit-radar.tsx` | Implemented, differs | Unknown dimensions show as "not assessed" (CW T08). Freshness appears as an age in the verdict text (`verdict.tsx:146`), not as a percentage. |
| LD-09 | The full original signal, with source, date and "open post". (VN §Lead detail) | `SignalTimeline` in `src/components/leads/dossier/timeline.tsx` | Matches | — |
| LD-10 | The contact is marked "Likely", with a "not independently verified" tooltip, under a "Verified contacts" heading. The Classic header shows "Locked / No email" and conflicts with it. (VN §Lead detail) | `ContactPanel` in `src/components/leads/dossier/contacts.tsx` | Implemented, differs | Signalroom shows the provider, confidence and verification state separately (FC F021), and does not carry the reference's contradiction. |
| LD-11 | Battlecard with a Build button. It was empty and nothing was generated. (VN §Lead detail) | `src/components/leads/dossier/battlecard.tsx`; `/api/leads/[id]/battlecard` | Implemented, differs | Assembled deterministically: every line cites its row and no model is involved (CW T15). |
| LD-12 | Draft with Generate, in EN, Hinglish or Hindi. The email stays English. (VN §Lead detail; FF Voice note) | Email, WhatsApp, LinkedIn, Call and Meeting dialogs in `src/components/leads/dossier/quick-actions.tsx` | Implemented, differs | The dialogs offer the same three languages (CW T15). Nothing sends from the dossier: drafts open a composer, wa.me or the profile (`quick-actions.tsx:29`). |
| LD-13 | Voice note: 2000-character text, 10 Indian languages, 12 Sarvam voices, 5 ElevenLabs voices. Samples were not played. (VN §Lead detail; FF Voice note) | `src/components/voice/lead-voice-note.tsx` → `voice-player.tsx` | Implemented, differs | Voices and languages are whatever the browser's speech engine offers, with a speed control. There is no Sarvam or ElevenLabs. MP3 needs OpenAI (AM N18). No send path. |
| LD-14 | Deep research confirmation: 2 points (1761 → 1759), with scope funding, hiring, tech stack, products, news, similar companies and buying signals; 7-day cache. Cancelled. (VN §Lead detail; FF Research quote) | Research panel footer, `src/components/leads/dossier/side-panels.tsx:650–657`; company research in `src/components/opportunities/enrichment-panel.tsx` | Partial | Updated 2026-09-25. The stale copy is fixed, and the lead page now links the company to Lead Lens for a costed external lookup. There is still no in-place research quote modal on the lead, and no funding, news or hiring research. |
| LD-15 | A Colleagues panel, empty. (VN §Lead detail) | `ReachableColleagues` in `contacts.tsx` | Matches | — |
| LD-16 | A private-notes textarea. (VN §Lead detail; FF notes) | `AddNote` in `lead-actions.tsx`; `/api/leads/[id]/notes` | Implemented, differs | Notes are added in a dialog with a required body ("What did you learn?", FF Signalroom Lead actions), not typed into a persistent notes pad. |
| LD-17 | A log-outreach modal (WhatsApp, Email, LinkedIn, Call) with optional text. (VN §Lead detail; FF notes) | Per-channel "Log as sent" and "Log reply" in `quick-actions.tsx:47–53, 235` | Implemented, differs | Logging lives inside each channel dialog, not in one modal. |
| LD-18 | A reminder with a blank date/time and optional "Follow up about…"; Set is disabled while blank. (VN §Lead detail; FF notes) | `src/components/tasks/create-task-dialog.tsx`, with `TASK_DUE` reminders (CW T07) | Implemented, differs | It is a task with title, priority, channel and due date, not a single-purpose reminder. |
| LD-19 | Timeline empty; Relevant / Not a fit toggles. (VN §Lead detail; FF Star / relevance) | `timeline.tsx`; "Discard as irrelevant" with a reason in `lead-actions.tsx:228–244` | Implemented, differs | There is no positive "Relevant" rating. The negative is a discard, which requires a reason and is recorded as targeting feedback. |
| LD-20 | "Watch on Radar" and "Add to TeamCollab". Neither was submitted. (VN §Lead detail) | Deal plans at `src/app/(app)/teamcollab/[dealId]/page.tsx`, linked from each deal (CW T18) | Partial | TeamCollab attaches to a deal, not a lead. No per-lead Radar watch was found in `src/components/leads/dossier/`. |
| LD-21 | Identity editing: "No identity editor or duplicate/clone control observed." (FF Lead status and assignment) | `src/components/leads/dossier/edit-details.tsx` | Not observed in reference | Signalroom has one. ProspecX's Sales role showed none. |

## 5. Lead discovery, Find leads and Lead Lens

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| F-01 | `/app/scrape` has "What you sell" and "Who you sell to" textareas. "Suggest search phrases" is disabled while they are empty. (VN §Find leads; FF Find leads) | `src/app/(app)/find-leads/page.tsx` → `src/components/opportunities/search-view.tsx`, and `src/components/find/find-view.tsx` ("Describe who you sell to…", line 67) | Implemented, differs | The page leads with an opportunity search: a service text field and source checkboxes. Describing the buyer produces an ICP definition plus suggested phrases (VN Signalroom §FindOpportunities). |
| F-02 | 65 active phrases, each with Remove, and "Add custom phrase". (VN §Find leads) | `/settings/search-phrases` → `src/components/phrases/phrases-view.tsx` | Implemented, differs | Phrases live on a separate settings screen. Each has where-to-watch, frequency and negative keywords (FF Signalroom Search phrase) and can be paused. |
| F-03 | "Find leads now", at 0 points per search once every 3 hours; last run 4 hours ago. Not run. (VN §Find leads) | Phrase Run-now (AM N12); per-search USD caps (AM N07) | Implemented, differs | Cost is shown as provider budget, not points. There is no free 3-hour window. |
| F-04 | Lead Lens at `/app/lookup`: name or LinkedIn URL. "Look up" costs 3 points and is disabled while blank. It promises role, company, location, career timeline, verified email and phone, and an opening angle. It saves the lead, and repeat profiles are free. (VN §Lead Lens; MA Lead Lens) | `src/app/(app)/lead-lens/page.tsx` → `src/components/intelligence/lead-lens-view.tsx`, `external-lookup.tsx` | Implemented, differs | The workspace is searched first. External lookup takes only a LinkedIn profile, company page or domain. A bare name stays workspace-only (AM N13). Cost is stated in provider credits, with a 30-day free re-show (`external-lookup.tsx:21–36`). No career timeline or opening-angle output was confirmed in source. |
| F-05 | A Lead Lens result. The lookup was never executed. (VN §Lead Lens) | `external-lookup.tsx` (found, review, confirm) | Not observed in reference | The reference result layout is unknown. |
| F-06 | People Finder filters: search over company, person or post text; role/title; location autocomplete; Any fit, 5+, 7+ or 8+ hot; Decision-makers, Buyer-intent and Switching toggles. (VN §People Finder; FF People Finder) | `src/app/(app)/people-finder/page.tsx` → `src/components/intelligence/people-finder-view.tsx` | Implemented, differs | The search box takes name, job title or company, with no post text. Signalroom adds an origin select. Buyer and switching are company-level, read from stored opportunities (`people-finder-view.tsx:196–202`). No location autocomplete was found. |
| F-07 | 80 person cards showing name, headline, company and location, fit 0–100, DM and buyer badges, a post excerpt, and **Save** and **Similar** buttons. (VN §People Finder) | `people-finder-view.tsx` | Partial | No per-person Save or Similar control was found. `nav.ts` still lists "Saving a search as a list" as planned. |
| F-08 | A nonsense search shows an empty state with web company search and decision-maker-by-role suggestions. Clear restores the 80. (VN §People Finder) | Empty state at `people-finder-view.tsx:220` | Implemented, differs | The empty state says "Widen the filters, or import a list" and offers no external search. |
| F-09 | People "Save search": name placeholder "My people search", daily alerts on, "Save & alert me". Not saved. (VN §Supplemental; FF People Finder) | none in People Finder (`SaveSearchButton` exists on Leads only) | Missing | Signalroom has no saved people search. |
| F-10 | Live Demand: 114 opportunities in 9 categories (SaaS & Web 43 … Fulfilment 1), a category filter, and category cards with buyers, companies, top score, age and excerpt. (VN §Live Demand) | `src/app/(app)/live-demand/page.tsx` → `src/components/intelligence/live-demand-view.tsx` | Implemented, differs | Categories come from the workspace's own opportunity types (CW T28). The reference counts are platform data and must not be copied. |
| F-11 | The `/app/demand/devops` drilldown: a ranked-fit card with headline, company link, country, score, excerpt, "View post" and "Work this lead". (VN §Live Demand) | Categories expand in place (`live-demand-view.tsx:50`), with lead and source links (`:161`, `:172`) | Implemented, differs | There is no per-category route. The drilldown is an in-page expansion. |

## 6. Opportunities

ProspecX showed no separate Opportunities module (MA). Its nearest flow runs from a demand card
to the lead.

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| O-01 | A demand card's "Work this lead" goes straight to a lead, and the signal stays attached to the dossier. (VN §Live Demand; FC F033) | `src/app/(app)/opportunities/[id]/page.tsx`; Add to CRM with explicit person selection (CS "Live enrichment findings") | Implemented, differs | There is an extra step: opportunity, then enrichment, then choosing a person, then Add to CRM. A company-only deal is possible when no person is known (AM F033). |
| O-02 | Evidence detail and classification behind a demand card. Seen for one DevOps card only. (VN §Live Demand; FC F031) | `opportunities/[id]/page.tsx`, with the readiness strip (AM N11) | Implemented, differs | Fit is shown as not assessed, partial or assessed, with the unknown fields named. ProspecX shows a single fit score. |

## 7. Enrichment

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| E-01 | Credit prices: unlock 1, research 2, Lead Lens 3 points. (VN §Remaining – Billing; MA Credits and paid work) | Points ledger at `/settings/billing`; provider USD budgets on enrichment | Implemented, differs | Signalroom keeps internal points separate from provider-billed enrichment (MA Credits and paid work). The prices are not comparable one-for-one. |
| E-02 | Research asks for confirmation before charging, and describes a 7-day cache. (VN §Lead detail) | `src/components/opportunities/enrichment-panel.tsx` (company, people, emails, checks) | Implemented, differs | Research lives on the opportunity, not the lead, and is priced against a per-run budget. See LD-14 for the gap on the lead page. |
| E-03 | "Verified email/phone" is promised by Lead Lens but was never executed. (VN §Lead Lens) | `src/lib/enrichment/verification.ts`: only `MAILBOX_CONFIRMED` sets `VERIFIED` | Not observed in reference | What ProspecX means by "verified" is unknown. |

## 8. Pipeline and deals

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| P-01 | The board has New, Contacted, Replied, Qualified, Proposal Sent, Won and Lost. 100 loaded (New 94, Contacted 6). (VN §Pipeline; MA Pipeline) | `src/app/(app)/pipeline/page.tsx` → `src/components/pipeline/board.tsx` | Implemented, differs | The board holds **deals**, not leads, in 9 stages with probabilities: New 5% … Negotiation 80%, Won, Lost (VN Signalroom §Pipeline). It adds Meeting and Negotiation. Lead status is a separate model (CW T14). |
| P-02 | Cards show name, company, tier, score, value and age. (VN §Pipeline) | `src/components/pipeline/deal-card.tsx` (tier, score, intent, value, age in stage, next action) | Implemented, differs | Adds next action and a weighted value (`board.tsx:52`). |
| P-03 | The UI describes dragging across stages, with closing recording the value. Dragging was not exercised. (VN §Pipeline) | dnd-kit `DndContext` in `board.tsx`; a lost-reason prompt (`board.tsx:81`); `deal-edit-dialog.tsx` | Implemented, differs | Lost requires a reason, and an optimistic move rolls back on failure. What ProspecX does after a drop was never observed. |
| P-04 | TeamCollab roadmap money: outstanding, unbilled and collected. (VN §TeamCollab) | Pipeline header totals across won deals (CW T19); `src/components/leads/dossier/deal-money.tsx` | Implemented, differs | Money appears on Pipeline and in the dossier, not in TeamCollab. |

## 9. TeamCollab and My Queue

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| TC-01 | Three tabs, Roadmap, Orchestration and Dashboards, all opened. (VN §TeamCollab) | Tabs Plans and Scratchpad in `src/app/(app)/teamcollab/page.tsx` | Implemented, differs | The information architecture differs. Team load shows at the top of Plans. |
| TC-02 | Roadmap phases with sub-stages. Prospecting: planning, in TeamCollab. Scoping & Sales: drafting scope, checking scope, scope sent, drafting proposal, negotiating, won-not-paid. Delivery: in delivery, awaiting sign-off. Cash: invoiced/awaiting payment, paid/closed won. Zero-count stage buttons are disabled. (VN §TeamCollab) | `src/components/plans/plans-list.tsx` (per-deal progress, blocked count, next step) | Partial | There is no phase-by-stage roadmap with counts. |
| TC-03 | Orchestration: one tab per lead ("Dost AI 0/11") and lanes Queued, In progress, Needs attention, Done. 11 steps (scope draft … chase paid), with dependency waiting, client-facing gates, overdue and assignee. (VN §TeamCollab) | `src/app/(app)/teamcollab/[dealId]/page.tsx` → `src/components/plans/plan-view.tsx`; 11-step v1 template (CW T18) | Implemented, differs | Plans are per deal and reached from a list, not lead tabs. Dependencies and client gates are enforced on the server. Lane presentation was not compared. |
| TC-04 | Step detail: description, assignee with automatic routing and "Why", a work textarea ("paste scope summary/link"), Save disabled while empty, Reassign, Start and Mark done. (VN §TeamCollab; FF TeamCollab step) | `plan-view.tsx`; `src/lib/teamcollab/routing.ts` (AM N17) | Implemented, differs | Routing is previewed and then applied, and it explains why. It is not automatic on creation. |
| TC-05 | Money on a step: record type "Invoiced", Amount, Add. (VN §TeamCollab; FF TeamCollab step) | `deal-money.tsx`: invoice, payment and adjustment, on won deals only | Implemented, differs | Recorded in the dossier, not on the step. The plan's invoice and payment steps read that record (CW T19). |
| TC-06 | History includes a "fallback standard plan when model unavailable". (VN §TeamCollab) | Versioned standard template plus saved templates (CW T18) | Implemented, differs | No model-generated plan exists, so there is nothing to fall back from. |
| TC-07 | Dashboards: cash lanes, needs-you, approvals, team pulse. (VN §TeamCollab) | `src/components/plans/team-load.tsx` | Partial | Only team load (open steps against capacity) exists. There are no cash lanes, needs-you or pulse views. |
| TC-08 | My Queue tabs: Queued 1, Working 0, Needs you 0, Done 0. A linked overdue task with Start. (VN §TeamCollab) | `src/app/(app)/my-queue/page.tsx` → `src/components/queue/queue-view.tsx:75–78` | Matches | — |

## 10. Outreach, sequences and Inbox

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| OU-01 | Outreach is empty. "Start followups" opens a lead search with Start on each row. (VN §Messaging; FF Follow-up enrollment) | `src/components/outreach/outreach-view.tsx` → `/outreach/new`; `EnrollLeadsButton` in `sequence-actions.tsx` | Implemented, differs | The flow starts from the sequence: build it, then enrol leads. ProspecX starts from the lead. |
| OU-02 | "Email only": 3 touches on days 0, 3 and 10, stopping on reply. (VN §Messaging; FF Follow-up enrollment) | Day 0/3/10 preset in `src/components/outreach/sequence-editor.tsx` (CW T17) | Implemented, differs | The preset is editable. Activating stop-on-reply is gated on a reply reader (`readsReplies`). |
| OU-03 | "Multichannel": LinkedIn invite, then DM, then WhatsApp, then email. It skips a disconnected channel and needs an email on file. (VN §Messaging; FF Follow-up enrollment) | `validateShape` refuses automatic non-email steps, and the builder makes them manual tasks | Implemented, differs | Only email steps send automatically. WhatsApp and LinkedIn steps become manual tasks. |
| OU-04 | An enrolled or running sequence. The modal was closed without enrolling. (VN §Messaging) | `EnrollmentList` in `sequence-actions.tsx` | Not observed in reference | — |
| IN-01 | Inbox tabs All, Unread, Sent and Refresh. (VN §Messaging; MA Inbox) | `src/components/inbox/inbox-view.tsx:117–118` onward: Needs you, Waiting, Open, Snoozed, Closed, All | Implemented, differs | Filters are by workflow state, not read state. |
| IN-02 | A disconnected-mailbox empty state with "Go to settings". The Sent tab shows the same connect state. (VN §Messaging) | `EmptyState` at `inbox-view.tsx:246`; the no-mailbox note at `:361` names Settings → Email Accounts | Matches | The wording differs. The empty state was not re-rendered. |
| IN-03 | An Inbox with threads, and replying. Never observed, because the mailbox was disconnected. (VN §Messaging) | Thread view and Draft reply (CW T15) in `inbox-view.tsx` | Not observed in reference | — |

## 11. Mailboxes and channels

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| CH-01 | Email accounts, Add account. Tabs for Gmail (default), Outlook and Custom SMTP. Fields: email, optional From name, app password, SMTP host and port, IMAP host and port, optional Always CC. Test, and Connect disabled while blank. Presets: `smtp.gmail.com:465` / `imap.gmail.com:993` and `smtp-mail.outlook.com:587` / `outlook.office365.com:993`. (VN §Remaining – Email accounts; FF Email connection) | `src/app/(app)/settings/email/page.tsx` → `src/components/integrations/email-accounts-view.tsx` and `mailboxes-panel.tsx` (name, address, IMAP server, port, user, password, folder) | Implemented, differs | Updated 2026-09-25 after this matrix was drawn. Each mailbox now has its own SMTP sending, with a From name, as well as IMAP reading, plus "Connect with Google" and "Connect with Microsoft" OAuth buttons. Differences: there is no Always CC, the buttons live on one panel rather than in tabs, and SMTP and IMAP are set up as two forms. Not live-verified. |
| CH-02 | A connected mailbox, or a Test result. Never observed, because no credentials were entered. (FF Email connection) | Test and "Read now" in `mailboxes-panel.tsx:34` | Not observed in reference | — |
| CH-03 | WhatsApp at `/app/messages`, disconnected, with "Connect now". (VN §Messaging; MA WhatsApp) | `src/app/(app)/whatsapp/page.tsx` → `whatsapp-view.tsx` (`variant="channel"`) | Implemented, differs | The official Business API only (`whatsapp-view.tsx:43`). |
| CH-04 | Personal WhatsApp, with QR and code tabs. The code tab reveals country code and phone. Pairing was not started. (VN §Remaining – LinkedIn/WhatsApp; FF Other settings) | `/settings/whatsapp` → `whatsapp-view.tsx` (`variant="settings"`) | Missing | There is no personal pairing. AM F047 records it as blocked: there is no official API. |
| CH-05 | WhatsApp Business API: Meta sign-in, then pick or create a number. Not started. (VN §Remaining; FF Other settings) | `/settings/whatsapp-api` → `src/components/integrations/whatsapp-connection.tsx` | Implemented, differs | Credentials are entered for the Meta Cloud API, rather than through Meta's hosted sign-in. Not live-verified (AM N15). |
| CH-06 | A WhatsApp conversation or composer. Unreachable while disconnected. (MA WhatsApp) | `/whatsapp`; `src/components/leads/dossier/whatsapp-card.tsx` | Not observed in reference | — |
| CH-07 | LinkedIn at `/app/linkedin`, disconnected. A command centre describes request, acceptance, DM and reply, with warm-up and best time. "Connect LinkedIn". (VN §Messaging; MA LinkedIn) | `src/app/(app)/linkedin/page.tsx` → `src/components/integrations/linkedin-view.tsx:52–60` | Partial | Only the assisted flow exists: draft, open the profile, send by hand, log it. The page explains why there is no Connect button. Automation is blocked on partner API access (AM F048). |
| CH-08 | Settings → My LinkedIn: a hosted secure login with Connect. (VN §Remaining; MA Settings – My LinkedIn) | `/settings/linkedin` (same view) | Missing | There is no connection flow, deliberately. |
| CH-09 | A connected LinkedIn command centre. Never observed. (MA LinkedIn) | — | Not observed in reference | — |

## 12. Calendar and bookings

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| B-01 | Bookings shows Google Calendar/Meet disconnected, with Connect. (VN §Bookings; MA Bookings) | `src/app/(app)/bookings/page.tsx` → `bookings-view.tsx`; Google OAuth in `src/components/admin/calendar-connection.tsx` on `/settings/calendar` | Implemented, differs | Connecting happens in Settings → Calendar, and only Google is supported (AM N16). Not live-verified. |
| B-02 | A booking URL field with placeholder `https://cal.com/you/15min`, Save, and a share link. The help text names cal.com, Calendly and Google Meet. (VN §Bookings; FF Bookings) | `src/components/admin/booking-url-form.tsx` (https only, `https://cal.com/…` placeholder) on `/settings/calendar` | Implemented, differs | The link is set per workspace in Settings (CW T25), not on the Bookings page or in the user's Account. |
| B-03 | A booking list, or creating one. No booking was created. (VN §Bookings) | `bookings-view.tsx`, `src/components/bookings/booking-dialog.tsx` | Not observed in reference | — |
| B-04 | A connected calendar: sync, free/busy, invites. Never observed. (MA Bookings) | Google free/busy and event operations (AM N16) | Not observed in reference | — |

## 13. Proposals

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| PR-01 | Proposals is empty. "New proposal" opens a lead search. No draft was generated. (VN §Proposals; MA Proposals) | `proposals-view.tsx:116` → `src/app/(app)/proposals/new/page.tsx` → `ProposalEditor` with lead and deal selectors | Implemented, differs | It opens a full manual editor. ProspecX implies generating from the chosen lead, and no AI drafting exists here (`nav.ts` lists it as planned). |
| PR-02 | An "Edit setup" link says logo, pricing and terms are applied. (VN §Proposals) | `/settings/proposals`; no link to it found in `proposals-view.tsx` | Partial | Defaults are applied when a proposal is created (`proposals/new/page.tsx`), but the Proposals list has no setup link. |
| PR-03 | A generated proposal draft. Never observed. (VN §Proposals) | `src/components/proposals/proposal-editor.tsx` | Not observed in reference | — |
| PR-04 | The recipient link, totals, and accept or decline. Never observed without creating a proposal. (FC F050) | `src/app/p/[token]/page.tsx` | Not observed in reference | — |
| PR-05 | Proposal setup: logo upload (PNG, JPG or SVG up to 256 KB) with replace and remove; description, contact email, phone, website, address; currency defaulting to INR; Suggest with AI; Add package (name, free-text price, "included" line, remove); optional pricing note; terms with Generate with AI; Save. (VN §Remaining – Proposal setup; FF Proposal setup) | `/settings/proposals` → `src/components/admin/proposal-setup-view.tsx`, `proposal-defaults-form.tsx` | Implemented, differs | Logos are PNG, JPEG or WebP up to 256 KB; SVG is refused because it can carry script. Package price is numeric INR (`priceInr`). There is no currency selector and no AI suggestions (CW T24). The planned copy in `nav.ts:571–574` ("Editable workspace defaults — today each proposal carries its own terms") is now stale. |

## 14. Reports and intelligence (Insights, Radar, Lists, Saved, Accounts)

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| R-01 | Insights headline figures: total 116 including 2 trashed (114 active); worked 8 (7%); hot 82 (score 8+); won 0. (VN §Remaining intelligence) | `src/app/(app)/insights/page.tsx` → `src/components/intelligence/insights-view.tsx` | Implemented, differs | The sections are "Signal to revenue" and "Where revenue comes from". The headline tiles were not compared one by one. The reference counts are its data and must not be copied. |
| R-02 | A conversion funnel. (VN §Remaining intelligence) | `insights-view.tsx:80`; "One cohort, followed forward" in `reporting-cards.tsx:15` | Implemented, differs | Signalroom shows both a stage funnel and a cohort funnel (CW T28). |
| R-03 | Score mix and status. (VN §Remaining intelligence) | "Tier and status mix" in `reporting-cards.tsx:47`, with cells that open Leads | Implemented, differs | It is a tier × status grid, not separate score and status charts. |
| R-04 | A phrase table with PHRASE, LEADS and WON. (VN §Remaining intelligence) | Per-phrase leads, won count and won INR in `src/components/phrases/phrases-view.tsx:65–75` | Implemented, differs | It lives in Settings → Search phrases, not on Insights. |
| R-05 | Radar: 103 opportunities and 1 account. Filters All, Ready to buy, Evaluating and Aware, plus Contactable and Search. (VN §Remaining intelligence; MA Radar) | `src/app/(app)/radar/page.tsx` → `src/components/intelligence/radar-view.tsx` | Partial | Radar is a list of watches with Aware, Evaluating and Ready stage badges (`radar-view.tsx:37–40`). There is no ranked opportunity list, no Contactable filter and no search. |
| R-06 | Radar "Act now" (5) and a ranked list of 40, with score buttons and Draft, Open, Assign and Status actions. (VN §Remaining intelligence) | none | Missing | FC F060 names the same gap. |
| R-07 | Radar multi-project buyers (empty), buying committee, and a changes timeline with Mark acted, Snooze 24h and Dismiss. (VN §Remaining intelligence) | Committee on `/accounts/[id]` (`committee-editor.tsx`); nothing for changes | Partial | The committee exists per account. There is no changes timeline with act, snooze or dismiss. |
| R-08 | Lists: placeholder "New list name (e.g. Q3 e-commerce targets)…". New list is disabled while blank. The created list showed 0 leads, and its detail page opened. (VN §Lists; FF Lists) | `src/components/intelligence/lists-view.tsx`, with `NewListButton` at line 147; a list opens `/leads?listId=` (line 202) | Implemented, differs | Lists are created in a dialog. A list's "detail" is the Leads screen filtered to it; there is no `/lists/[id]` page. |
| R-09 | Saved & Alerts is empty, and explains saving from People Finder or watching an account with alerts. (VN §Remaining intelligence; MA Saved & Alerts) | `src/app/(app)/saved-alerts/page.tsx` → `alerts-view.tsx` | Implemented, differs | It holds saved lead searches and opportunity watches, not people searches or account watches (F-09, R-10). |
| R-10 | Account Lens: company, country, top fit 8, 1 opportunity / 1 buyer signal / 1 decision maker, **Watch**, a category link, and a committee card (fit 84). (VN §Supplemental; MA Account Lens) | `src/app/(app)/accounts/[id]/page.tsx` → `AccountDetail` in `accounts-view.tsx`, `committee-editor.tsx` | Partial | The committee has suggested roles, confirmation and coverage (AM N19). No account Watch control was found in `accounts-view.tsx`. |

## 15. Team and TeamCollab routing

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| TM-01 | Team and Settings → Team show the same 3 members (Owner, Sales). The current user is Sales. (VN §Remaining intelligence) | `src/app/(app)/settings/team/page.tsx` | Implemented, differs | The table adds Leads, Open deals, Pipeline and Point cap columns. `/team` is a separate performance view (TM-04). |
| TM-02 | Who does what: routing by skill and capacity. Users set their own; managers can set anyone's. "Add a skill" offered only "Pick" or "Add missing skill". Cancelled. (VN §Remaining intelligence; FF Other settings) | "Skills & capacity" column with `MemberRouting` (`settings/team/page.tsx:80, 133`); `src/lib/teamcollab/routing.ts` | Implemented, differs | Capacity is a step count plus an away flag. The skill picker's options and flow were not compared. |
| TM-03 | Invitations and role administration. "No invite control visible" to the Sales role. Owner behaviour unknown. (VN §Remaining intelligence; FC F066) | Invites and `src/components/admin/role-editor.tsx` on `settings/team/page.tsx` | Not observed in reference | Signalroom has them (AM N20). ProspecX's owner view was never seen. |
| TM-04 | `/app/team` shows the same member and skills content as Settings → Team. (VN §Remaining intelligence; MA Team) | `src/app/(app)/team/page.tsx` → `src/components/intelligence/team-view.tsx` | Implemented, differs | `/team` is rep performance analytics, not member skills. |

## 16. Settings, billing and admin

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| ST-01 | The Settings navigation, all visited: Account, Workspace, Team, Proposal setup, Billing & points, ICP phrases, Notifications, Email accounts, Assistant, My LinkedIn, What's New, My WhatsApp, WhatsApp API, Archived leads, Recycle bin, MCP, API keys. (VN §Remaining intelligence/settings) | `src/app/(app)/settings/page.tsx`; Admin & Support group in `nav.ts` | Implemented, differs | There are more entries (ICP, Offerings, Calendar, CRM, Providers, Webhooks, Privacy, Jobs, Audit) and no Assistant page (ST-10). |
| ST-02 | Account: profile, booking URL, password (current / new with a minimum of 8 / confirm, disabled while empty), logout. (VN §Remaining; FF Bookings/account/password) | `src/app/(app)/settings/account/page.tsx` → `src/components/admin/account-forms.tsx` (`ProfileForm`: name, timezone, language; `PasswordForm`), `mfa-panel.tsx` | Implemented, differs | The booking URL is workspace-level (B-02). MFA and per-session sign-out are added (CW T29). The password rule text was not compared. |
| ST-03 | Workspace: company name, "Research my company", tagline, website, logo URL, description; case studies/proof with "Improve with AI"; token lists for ideal clients, industries, geography, search phrases and budget signals; "Save workspace". (VN §Remaining; FF Workspace profile) | `/settings/workspace` → `src/components/admin/workspace-settings-view.tsx` (Name, Website, Industry, GSTIN, Timezone, Currency, Locale); `/settings/icp`; `/settings/offerings`; case studies in proposal defaults | Partial | There is no tagline, logo URL, description, "Research my company" or AI improvement. Positioning is split across ICP, Offerings and Proposal setup. |
| ST-04 | Billing: Quarterly plan active, 89 days, paid until 21 Dec 2026, auto-renewal, "Manage subscription" (not clicked). (VN §Remaining – Billing) | `src/app/(app)/settings/billing/page.tsx` | Partial | Display only. The page says payment collection, GST invoicing and plan changes "land in Phase 10" (`billing/page.tsx:233–235`). Blocked on a payment gateway (AM F071). |
| ST-05 | Points: 1761 remaining, 2104 granted, 343 used; unlock 1 and research 2. (VN §Remaining – Billing) | Append-only ledger and spend by type on `billing/page.tsx` | Implemented, differs | The ledger is immutable. Per-action prices were not compared. |
| ST-06 | A plan list: quarterly 4000 credits, 6-month and yearly, INR prices, and a LinkedIn add-on shown Active. (VN §Remaining – Billing) | Plans from DB rows (`billing/page.tsx:188–222`) | Implemented, differs | The catalogue is the workspace's own rows. Pricing was flagged as a separate decision rather than a copy (FC F071; CW T33). |
| ST-07 | GSTIN and address are optional, Save is disabled while unchanged, and invoice history is empty. (VN §Remaining – Billing; FF Other settings) | GSTIN on Workspace settings; no invoice history | Partial | There is no billing address and no invoice history section. |
| ST-08 | ICP phrases: add text, rescan, remove; buyer-problem guidance; a job-title auto-pause claim. (VN §Remaining – ICP phrases; MA Settings – ICP phrases) | `/settings/search-phrases` → `phrases-view.tsx` (add, pause/resume, delete); `/settings/icp` → `src/components/icp/icp-editor.tsx` | Implemented, differs | Pause is manual. No rescan or automatic job-title pause was found. |
| ST-09 | Notifications: Push and Email toggles on; a WhatsApp number with country code, with Enable disabled while empty; switches for hot leads, replies, scrape, low points and billing; Save disabled while unchanged. (VN §Remaining – Notifications; FF Notification preferences) | `/settings/notifications` → `src/components/admin/notifications-settings-view.tsx` | Partial | There are per-kind in-app and email switches, saved optimistically with no Save button (AM N20). There is no push and no WhatsApp alert number. The `nav.ts:605–608` planned copy ("Per-kind muting — there is nowhere to store the preference yet") is stale. |
| ST-10 | Assistant: characters Cardy, Casey and Scout; styles Pixel, Drawn and Painted; left or right; size slider (84); show, hover explanation and pointer tracking; replay tour and celebration; a command list. (VN §Remaining – Assistant settings; FF Other settings) | `/settings/ai` → `src/components/ai/ai-settings-view.tsx` configures model providers | Missing | There is no assistant character, tour or celebration anywhere in `src/`. |
| ST-11 | What's New was read. Its claims were not treated as verified. (VN §Remaining) | `src/app/(app)/whats-new/page.tsx` → `src/components/admin/whats-new-view.tsx` | Matches | On 24 Sep its content was stale (VN Signalroom §Settings). Re-read it. |
| ST-12 | Archived: no records, with a 45-day auto-archive claim. (VN §Remaining) | `src/app/(app)/archived/page.tsx` → `archived-view.tsx`; 45/30-day retention in `/settings/privacy` | Matches | — |
| ST-13 | Recycle bin: 2 records, each with Restore and Permanent delete. Untouched. (VN §Remaining) | `src/app/(app)/recycle-bin/page.tsx` → `src/components/admin/recycle-bin-view.tsx` | Implemented, differs | Restore works and the purge date is shown. Early permanent delete is not built (`nav.ts:784–787`). |
| ST-14 | MCP: OAuth-style sign-in consent; URL `https://prospecx.in/api/mcp` with Copy; weekly and monthly call counts; last used; a daily 50-point cap (0 used); connected clients (none). (VN §Remaining – MCP; FF Other settings) | `/settings/mcp` → `src/components/integrations/mcp-view.tsx` (`/api/mcp` URL, Copy, a `claude mcp add` example) | Implemented, differs | Auth is by an `insights.read` API key, not OAuth consent. Tools are read-only (AM N23). No usage counts, point cap or client list were found. `nav.ts:702–705` still says "The MCP transport itself" is planned, which is stale. |
| ST-15 | API keys: an owner-only message for the Sales role. Scopes could not be inspected. (VN §Remaining; FC F075) | `/settings/api-keys` → `src/components/integrations/api-keys-view.tsx` | Not observed in reference | ProspecX's key form was never seen. |
| ST-16 | Support: live chat, new request, requests, FAQs, shortcuts. New request has subject and message, with Send disabled while empty; cancelled. A chat greeting appeared automatically. (VN §Remaining – Support; FF Other settings) | `src/app/(app)/support/page.tsx` → `src/components/admin/support-view.tsx`, `support-requests.tsx` | Implemented, differs | Requests go to the workspace's own admins (CW T37). There is no live chat widget. The FAQ at `support-view.tsx:88` still says WhatsApp has no sending adapter, which is stale against AM N15. The `nav.ts:838–840` planned copy ("In-app ticketing — nothing here opens a case") is stale too. |
| ST-17 | A keyboard-shortcuts section on Support. (VN §Remaining – Support) | none (`src/components/leads/shortcuts.tsx` holds filter shortcuts, not key bindings) | Missing | — |

## 17. Notifications

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| N-01 | `/app/notifications` is a full page, empty, about saved-search and account-watch matches. (VN §Remaining; MA Notifications) | Popover `src/components/shell/notification-center.tsx`; no `/notifications` route | Implemented, differs | There is a popover only, with no full-page history view. |
| N-02 | A populated notification list, or a delivered alert. Never triggered. (MA Notifications) | `raiseNotification` in `lib/services/notify.ts` | Not observed in reference | — |
| N-03 | A Push delivery toggle, defaulting to on. (FF Notification preferences) | `src/components/admin/notifications-settings-view.tsx` (PushDevice, Push column) | Implemented, differs | Updated 2026-09-25. Web push exists, with per-kind Push switches and a per-browser subscribe (AM N20). It defaults to **off** where ProspecX defaults to on, because the browser asks each person first. It needs VAPID keys on the server. |

## 18. Copilot, AI and Autopilot

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| AI-01 | An AI copilot on Today's mission control. (VN §Today) | `src/components/shell/copilot-drawer.tsx`; `/copilot` → `src/components/ai/copilot-console.tsx` | Implemented, differs | A drawer plus a full page. It answers only from the tool registry in `lib/ai/tools.ts`. |
| AI-02 | Assistant commands: day, attention, money, approvals, replies, hot, stale, pipeline, points, lookalikes, draft, find, setup, teach, capabilities. The UI says answers come from existing fetched data, not a model. (VN §Remaining – Assistant settings) | Tool registry `lib/ai/tools.ts` (VN Signalroom §Copilot: 6 read tools, 5 agent write tools, 3 unbuilt) | Partial | There is no command vocabulary. The questions a user can ask are bounded by the registered tools, and lookalikes, teach and points have no confirmed counterpart. |
| AI-03 | Autopilot: Off. Cycle Today / 7 days / All. Find 63, Reveal 0, Reach out 0, Follow-up 0, Replies 0. No runs. (VN §Supplemental; MA Autopilot) | `src/app/(app)/autopilot/page.tsx` → `src/components/autopilot/autopilot-view.tsx` | Implemented, differs | Autopilot is agent-based, with per-agent daily point budgets (`autopilot-view.tsx:739–742`). No per-cycle find, reveal, reach-out funnel with a period switch was found. |
| AI-04 | Modes: Off; Review first (find and draft, hold, no auto-spend); Full auto (reveal and send). No mode change was attempted. (VN §Supplemental) | `MODES` in `autopilot-view.tsx:98–113`: OFF, REVIEW_FIRST, FULL_AUTO | Matches | Agents run only with a model provider connected (`nav.ts:187–190`). |
| AI-05 | A running Autopilot and its run log. Never observed, because no runs existed. (MA Autopilot) | `/agent-activity` → `src/components/autopilot/activity-view.tsx` | Not observed in reference | — |

## 19. Mobile, theme, keyboard and state coverage

| # | Reference state observed (evidence) | Signalroom route / component | Status | Difference / note |
| --- | --- | --- | --- | --- |
| M-01 | Any ProspecX screen at phone width. "Mobile not tested." (FC F082; `01-audit-report.md` §limits) | `src/components/shell/mobile-nav.tsx`; 390px checks reported (CW T40) | Not observed in reference | — |
| M-02 | Any ProspecX screen in dark theme. Only the existence of a theme control was recorded. (VN §Navigation) | `theme-toggle.tsx`; semantic tokens | Not observed in reference | — |
| M-03 | Keyboard-only use beyond the command palette. Only palette Return navigation was observed. (VN §Remaining) | `command-palette.tsx` | Not observed in reference | — |
| M-04 | Loading states. Account Lens and list-detail loading were observed. (MA coverage row 34; VN §Lists) | `loading.tsx` per route (for example `src/app/(app)/today/loading.tsx`), `components/ui/states.tsx` | Matches | Both show loading placeholders. A visual comparison needs screenshots. |
| M-05 | Error, invalid-input and provider-failure states. Deliberately not injected against production. (MA coverage row 31; FF "Interaction states that were deliberately not inferred") | `error.tsx` per route; `ErrorState` in `components/ui/states.tsx` | Not observed in reference | — |
| M-06 | Success messages after saving. Only the list-created result was observed. (MA coverage row 32) | Toasts and `note` strings from mutations | Not observed in reference | — |

---

## Summary counts

| Status | Rows |
| --- | --- |
| Matches | 23 |
| Implemented, differs | 85 |
| Partial | 20 |
| Missing | 8 |
| Planned (inert route) | 0 |
| Not observed in reference | 22 |
| Accepted difference | 0 |
| **Total** | **158** |

Counted from the Status column of every row above. "Implemented, differs" dominates because most
reference screens have a built counterpart with a different information architecture or
vocabulary.

## Differences that need a decision (none are accepted yet)

The evidence names these as scope choices, but **none records an agreement**. They stay under
their evidence-based statuses until someone signs one off.

- Personal WhatsApp pairing (CH-04) and automated LinkedIn messaging (CH-07, CH-08). V3 asks for
  either the feature "or an explicit agreed scope difference".
- A platform-wide demand index (T-09). This needs a cross-customer dataset (AM N19).
- Plan pricing (ST-06). "Pricing need not copy ProspecX" (FC F071; CW T33).
- Deals as the pipeline unit, not lead statuses (P-01, L-07). "Map not copy" (VN Signalroom
  §Pipeline; CW T14).
- A bare-name external Lead Lens search (F-04). It is workspace-only by design (AM N13). V3 lists
  it as pending "if retaining exact requested Lead Lens scope".

## Signalroom-only screens (no reference counterpart; not counted above)

The ProspecX navigation was fully traversed (VN §Navigation observed, ST-01). These screens have
no counterpart in it, so they are not parity rows:

`/opportunities`, `/opportunities/review`, `/accounts` (list), `/competitors`,
`/market-intelligence`, `/research`, `/playbooks`, `/ai-agents`, `/knowledge-base`, `/trust`,
`/approvals` (as a page), `/settings/icp`, `/settings/offerings`, `/settings/providers`,
`/settings/integrations`, `/settings/webhooks`, `/settings/privacy`, `/settings/jobs`,
`/settings/audit`, `/print/leads/[id]` and `/invite/[token]`.

The SignalHire, Hunter and Apollo fallback and the multi-platform Apify roster are user
requirements, not observed reference capabilities (CS "Some items are your additional
requirements…").

## Needs fresh reference access

These are the specific states that the 2026-09-24 session did not capture. Everything else above
rests on existing evidence and does not need re-access.

1. **Screenshots of every state already observed.** They do not exist, so spacing, typography,
   colour and iconography cannot be compared. Capture them at desktop and 390px, in light and
   dark.
2. ProspecX at 390px mobile width, on any screen (M-01).
3. ProspecX in dark theme (M-02).
4. Keyboard-only traversal: sidebar, filters, dialogs, and focus order in the lead console (M-03).
5. A Lead Lens result, a research dossier result and the cache re-show (F-05, E-03). These cost
   3 and 2 points; set the budget first.
6. A populated Inbox thread and reply (IN-03). This needs a test mailbox connected on ProspecX.
7. A connected mailbox with its Test result (CH-02), a WhatsApp conversation (CH-06) and the
   LinkedIn command centre when connected (CH-09).
8. A connected calendar and the booking list (B-03, B-04).
9. A generated proposal and its recipient page (PR-03, PR-04). Nothing in the suite accepts a
   proposal, because accepting cannot be undone. Do the same on ProspecX: view only, never accept.
10. An enrolled sequence (OU-04) and a running Autopilot with its run log (AI-05).
11. The owner-role screens: API key creation (ST-15), invitations and role administration
    (TM-03), and bulk actions or import on Leads if the owner role has them (L-14).
12. A populated notification list (N-02), plus error states and success toasts (M-05, M-06).
13. Lead identity editing, if ProspecX offers it to any role (LD-21).
14. Anything that changed on ProspecX after 2026-09-24. Re-check Today, Leads and the lead
    console first, since they carry the most rows.

## How to re-verify

These are instructions. None of this was done for this document.

**Where.** Use the E2E server on :3100 against `signalroom_test`, never the live instance on
:3000. Run `npm run db:test:prepare` first. For ProspecX, use a non-production workspace, or view
only: no sends, purchases, approvals or deletes.

**For each row:**

1. Open the Signalroom route in the "Signalroom route / component" column and the matching
   ProspecX state cited in the reference column.
2. Check each viewport:
   - Desktop at 1280px wide.
   - Mobile at 390px wide. There must be no horizontal page scroll, and long strings must
     truncate inside grid children.
3. Check each theme:
   - Light.
   - Dark, set through the theme toggle and through `prefers-color-scheme`.
4. Check each data state:
   - **With data:** a seeded workspace with multi-page leads (more than 50), so pagination (L-12)
     actually pages.
   - **Empty:** a fresh workspace. Every data surface must show its teaching empty state.
   - **Error and partial error:** where `components/ui/states.tsx` provides them.
5. Do it keyboard only. Tab through the sidebar, the command palette, filters and dialogs (Esc
   closes, focus returns to the trigger), the pipeline board (keyboard drag), and every form's
   disabled-until-valid submit. Note any control that cannot be reached or activated.
6. Record the result by changing the Status cell and citing the new evidence: a screenshot
   filename stored beside this document, and the date. Promote a row to "Matches" only when both
   screenshots show equivalent behaviour. Move a row to "Accepted difference" only with a written
   decision.
7. Re-check the stale-copy findings: T-10, LD-14, PR-05, ST-09, ST-14 and ST-16. Stale planned
   notes in `nav.ts` or stale help text are "never ship a control that silently does nothing"
   issues in reverse: they describe as missing something that now exists.

**Before calling any row fixed:**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Don't run `npm run build` against a running dev server or the live `.next`. Use
`SIGNALROOM_BUILD_DIR=.next-verify` as in `docs/acceptance-matrix.md`.
