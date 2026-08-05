# Overload v3 — Claude Context
*Read this first. Then read SPEC.md (v3 product spec), TASKS.md (v3 technical
plan), AUDIT.md.*

**Document naming as of 2026-08-05:** SPEC.md and TASKS.md are the **v3**
documents. Overload-v2-SPEC.md and TASKS-v2.md are the v2 originals — still
accurate for the app as currently shipped, superseded only where v3 changes
something. The codebase, package name and Vercel project are all still called
`overload-v2`; that has not been renamed and does not need to be.

---

## What this app is
A strength training PWA for a serious intermediate-to-advanced lifter. 
Three-layer architecture: Program (what exercises) → Weekly Plan 
(sets + RIR targets per session per exercise) → Session Log 
(what actually happened). Single user, Supabase backend, shared 
project with Northstar v2.

---

## Current state
**Deployed:** Yes — Vercel (overload-v2)
**Auth:** Supabase email/password, same credentials as Northstar v2

All core features built and working:
- Exercise library (shared exercises table with Northstar v2, 
  muscle_group column added)
- Program builder (exercises + optional suggested reps, no sets/RIR)
- Meso management (create, activate, complete, delete, one active at a time)
- Weekly plan builder (per session → per exercise → per set targets, 
  RIR + dropset flags, copy from previous week, deload flag)
- Gym UI (scheduler with 8 result variants, ExerciseCard with 
  identity-matched planned/extra set rows, smart last-session 
  reference panel, optimistic set logging, rest timer, skip set, 
  spontaneous dropsets)
- Session preview (read-only walkthrough before START SESSION)
- Rest day screen (minimal, moon glyph, weekly session progress)
- Progress (per-exercise charts, meso overview dashboard)
- History (filters by meso/session/date/muscle group, delete)
- Settings (theme, accent colour, rest timer, weight unit)
- PWA: offline set logging with sync queue, offline cache primed 
  on session start
- All 13 Fable 5 audit fixes applied
- 2026-07-09 session: ADD SET infinite loop fix, comma/period 
  decimal fix, preview session, smart reference component, 
  rest day screen (see "2026-07-09 session" below)
- 2026-07-10 session: rest time display formatting everywhere, 
  session note autofill on continue, auto-finish session after 
  inactivity (see "2026-07-10 session" below)
- 2026-07-11 session: meso week numbering fixed to flip on Monday 
  instead of on whatever weekday the meso happened to start 
  (see "2026-07-11 session" below)
- 2026-08-04 session: fixed reopening a finished session immediately 
  re-finishing it (see "2026-08-04 session" below)
- 2026-08-05 session: **v3 technical planning only — no implementation 
  code written.** Produced TASKS.md (the v3 plan) from SPEC.md; three 
  review decisions locked, one open (see "2026-08-05 session" below)
- 2026-08-05 session (second, same day): **Phase 3.0 — migration 
  foundation, code landed, migrations 004–006 applied to production.** 
  Types/Dexie extended, AUDIT M5's write path fixed, 007's Step 1 audit 
  queries run against live data: 0 orphan drops, 0 duplicate set_numbers, 
  8 drop rows across 4 sessions. Backfill not run yet as of this point.
  See "2026-08-05 session (Phase 3.0)" below
- 2026-08-05 session (later, same day — verification): CONTEXT.md had 
  drifted into two contradictory narratives about whether 007's backfill 
  had run (uncommitted edits across an interrupted session — confirmed 
  via `git log`, nothing about this was ever committed). Diagnostic 
  queries this session show `v2_set_logs` already has `parent_set_id` 
  set on all 8 known dropset rows (0 unlinked) and scope unchanged at 
  8 rows/4 sessions — strong evidence the backfill *did* run at some 
  point, but Step 3's own verify queries were not (re-)run this session, 
  so that isn't asserted as confirmed fact here. See "2026-08-05 session 
  (Phase 3.0 verification)" below
- 2026-08-05 session (final, same day — backfill formally confirmed): 
  007 Step 3's two verify queries run fresh (log side): both return 0, 
  as required. A row-by-row correctness check re-derived every one of 
  the 8 `v2_set_logs` dropset rows' expected `parent_set_id` from the 
  same inference rule the backfill uses and compared it to the stored 
  value — 0 mismatches. The plan side (`v2_week_plan_sets`, never 
  checked before this) came back with 7 dropset rows, all already 
  linked, 0 unlinked, and its own row-by-row correctness check also 
  found 0 mismatches across all 7. **The 007 backfill is now formally 
  verified complete on both sides**, not just diagnostically likely. See 
  "2026-08-05 session (Phase 3.0 — backfill formally verified)" below 
  for the exact queries and results

---

## Tech stack
- React 19, TypeScript, Vite, vite-plugin-pwa
- Tailwind CSS v4 + tokens.css (all colours as CSS custom properties)
- Supabase JS v2 (auth + database)
- TanStack Query v5 (server state)
- Zustand v5 (UI state only — rest timer, pending sync IDs)
- Dexie v4 (offline cache)
- Recharts v3 (charts)
- date-fns v4
- React Router v6
- Lucide React

---

## Database tables
**Shared with Northstar v2:**
- exercises (v1 table, muscle_group column added)

**Overload v2 specific (all v2_ prefixed):**
v2_programs, v2_workout_days, v2_program_exercises,
v2_mesocycles, v2_week_plans, v2_week_plan_sets,
v2_sessions, v2_set_logs, v2_user_settings

RLS enabled and verified on all v2_ tables.
exercises table RLS inherited from v1 — verify if issues arise.

v2_user_settings.auto_finish_minutes (nullable integer, default 5) 
added in supabase/migrations/003_v2_auto_finish_minutes.sql — 
applied to the live Supabase project on 2026-07-11. Confirmed live: 
toggling AUTO-FINISH SESSION off/on in Settings now persists cleanly 
with no Postgres errors.

**v3 columns (migrations 004–006) applied to production on 2026-08-05:**
- v2_week_plan_sets: + parent_week_plan_set_id (uuid, null, FK on delete
  cascade), + stage_index (int, not null default 0), + is_warmup
  (bool, not null default false)
- v2_set_logs: + stage_index (int, not null default 0), + set_seconds
  (int, nullable), + entered_unit (text, nullable), + is_warmup
  (bool, not null default false)
- v2_program_exercises: + weight_unit (text, nullable — null = inherit)
- v2_user_settings: + measure_set_time (bool, not null default false)

Verified live via information_schema query, not just "no error" from the
migration itself — see "2026-08-05 session (Phase 3.0)" below. **No
existing data was touched by 004–006** — those are additive columns only.

**007's backfill is verified complete on both sides as of 2026-08-05
(final same-day session).** Step 3's two verify queries, run fresh
against `v2_set_logs`:
- `select count(*) from v2_set_logs where is_dropset and parent_set_id is null;` → **0**
- `select count(*) from v2_set_logs where not is_dropset and parent_set_id is not null;` → **0**

A row-by-row correctness check (not just presence) re-derived each of the
8 `is_dropset` rows' expected `parent_set_id` independently, using the
same inference rule as the backfill (nearest preceding non-dropset row,
same `session_id` + `exercise_id`, ordered by `set_number` then
`logged_at`), and compared it to the stored value: **8 total, 0
mismatches.**

The plan side (`v2_week_plan_sets` / `parent_week_plan_set_id`) had never
been independently checked before this session. Completion check:
`still_unlinked = 0`, `already_linked = 7`, `total dropset rows = 7` — all
linked, scope fully accounted for. The same row-by-row correctness check
scoped to the plan side: **7 total, 0 mismatches.**

See "2026-08-05 session (Phase 3.0 — backfill formally verified)" below
for the exact queries run.

---

## Key architectural rules
- State separation: TanStack Query owns all Supabase data. 
  Zustand owns UI state only. Never mix.
- All colours via --accent and other CSS custom properties. 
  No hardcoded hex anywhere in components.
- today must never be computed at module load — always use 
  state refreshed on visibilitychange and at midnight
- Offline: useLogSet, useCreateSession, useCompleteSession, 
  useSkipSession all queue offline via sync queue
- Set logs: weight and reps are nullable (null when is_skipped = true)
- Meso week numbers are calendar weeks, Monday-anchored: always compute 
  them with `differenceInCalendarWeeks(date, mesoStartDate, 
  { weekStartsOn: 1 }) + 1` (or `startOfWeek(date, { weekStartsOn: 1 })` 
  for a week-window boundary), never `differenceInWeeks` — that function 
  has no weekStartsOn option and instead counts raw 7-day periods from 
  the meso's exact start date, which drifts off Monday whenever the 
  meso didn't start on one (see "2026-07-11 session" below)
- **Stage-exclusion rule (v3, takes effect in Phase 3.1 — NOT yet true 
  in code).** Once the dropset restructure lands, a `v2_set_logs` row 
  with `parent_set_id` set (or a `v2_week_plan_sets` row with 
  `parent_week_plan_set_id` set) is a **drop stage**, and must never be 
  counted as an independent set. Every count, average or set list goes 
  through a named view (v2_history_session_summary, 
  v2_exercise_set_history, v2_session_type_history) or a pure function 
  (e1rm.ts, setGroupLogic.ts) that applies the filter — never an ad-hoc 
  aggregate against v2_set_logs. **The one deliberate exception is 
  volume:** a drop stage is real work performed, so volume sums include 
  stages. Everything else excludes them.
  Until Phase 3.1 ships, no filter for this rule exists anywhere in the 
  app — do not assume the rule is enforced when reading current code. 
  TASKS.md §2.7 lists all 10 existing sites that violate it today.
  **On `parent_set_id` / `parent_week_plan_set_id` specifically:** as of
  2026-08-05 (final same-day session), both are **formally verified
  correctly populated for every historical dropset row** — not just
  present, but individually re-derived via the same inference rule the
  backfill uses and confirmed to match the stored value, 8/8 on the log
  side and 7/7 on the plan side, 0 mismatches either way. See "2026-08-05
  session (Phase 3.0 — backfill formally verified)" below for the exact
  queries. Separately, `GymSession.tsx`'s write-path fix for
  `parent_set_id` on *new* rows (AUDIT M5) has been written but not
  deployed — nothing has been committed or pushed — so a dropset logged
  through the live app today would still get `parent_set_id: null`; only
  historical rows are covered by the backfill. The stage-exclusion rule
  itself still has no enforcement anywhere in the app regardless of any
  of this — that's Phase 3.1's job, not something either the migrations
  or the backfill provide on their own.

---

## Key files
- SPEC.md — **v3** product source of truth
- TASKS.md — **v3** technical plan (schema changes, migrations, phase order).
  Awaiting approval as of 2026-08-05; no code written against it yet
- Overload-v2-SPEC.md — v2 product spec (superseded where v3 differs)
- TASKS-v2.md — v2 technical architecture, data models, scheduling algorithm.
  Still the accurate description of the app as shipped
- AUDIT.md — Fable 5 audit findings, fixed and deferred items
- src/lib/supabase.ts — Supabase client (strips non-ASCII from env vars)
- src/lib/db.ts — Dexie schema
- src/features/gym/scheduler.ts — pure scheduling function, 
  8 SchedulerResult variants
- src/features/gym/ExerciseCard.tsx — active-session exercise row, 
  identity-matches SetLogs to planned/extra slots via weekPlanSetId
- src/features/gym/ExerciseReference.tsx + referenceLogic.ts — smart 
  LAST WEEK / LAST TIME / FIRST TIME reference panel (pure resolver 
  logic is in referenceLogic.ts, testable independent of the component)
- src/features/gym/SessionPreview.tsx + PreviewExerciseCard.tsx — 
  read-only session walkthrough reachable from Today
- src/features/gym/RestDayScreen.tsx — rest day screen
- src/features/gym/ExerciseHeader.tsx + PlanTargetsPanel.tsx — shared 
  pieces used by both ExerciseCard and PreviewExerciseCard
- src/lib/formatRestTime.ts — single source of truth for "45s" / 
  "1min 32s" rest-time formatting, used in History, Progress 
  (both charts), and RestTimer
- src/features/gym/useAutoFinishSession.ts — client-side polling 
  hook (30s interval) that auto-completes a session once every 
  planned set has a set_log row and the last one is older than 
  the user's auto_finish_minutes setting. Also gates on a grace 
  window since the hook last (re)armed, to avoid immediately 
  re-finishing a reopened session (see "2026-08-04 session" below)
- src/features/notifications/toastStore.ts + Toast.tsx — minimal 
  global toast (Zustand + component mounted in App.tsx), added 
  for the "Session completed automatically" notification; no 
  toast library existed before this
- tokens.css — all CSS custom properties

---

## Active work
**Phase 3.0 (migration foundation) is complete and formally verified —
schema, audit, and backfill on both sides.** Status, precisely:

1. **Migrations 004, 005, 006 — applied to production, confirmed.**
   Verified via `information_schema` listing all 9 new columns with
   correct types/defaults.
2. **007 Step 1 (audit) — run, confirmed clean.** 0 orphan drops, 0
   duplicate set_numbers, 8 drop rows / 4 sessions.
3. **007 Step 2 (backfill, both sides) — confirmed complete, not just
   diagnostically likely.** Step 3's two verify queries, run fresh
   against `v2_set_logs`, both return 0 (no dropset row unlinked; no
   head row incorrectly parented). A row-by-row correctness check
   independently re-derived all 8 log-side dropset rows' expected
   `parent_set_id` from the same inference rule the backfill uses and
   found 0 mismatches against the stored value. The plan side
   (`v2_week_plan_sets`), never checked before this session, came back
   with 7 dropset rows, all linked, 0 unlinked, and its own row-by-row
   correctness check also found 0 mismatches across all 7. See
   "2026-08-05 session (Phase 3.0 — backfill formally verified)" below
   for the exact queries and raw results.
4. **AUDIT M5's `GymSession.tsx` write-path fix is written but not
   deployed** — nothing has been committed or pushed. A dropset logged
   through the live app right now would still get `parent_set_id: null`.
   This is the one remaining gap: historical data is fully backfilled,
   but new writes won't carry a real `parentSetId` until this fix ships.

**The DB-access blocker hit earlier in this work is resolved, but not
durably** — each time, a live session got in only because you logged
into the Supabase dashboard in the Browser pane and gave explicit
go-ahead. Nothing persists between sessions: no service-role key, DB
connection string, or Supabase CLI link exists in this environment. If a
future session reports the same blocker, that's expected, not a sign
something regressed.

The `is_warmup` column shipped as part of 006, per TASKS.md §2.5's own
migration text — flagged in an earlier report as still formally open per
§5.4, and not objected to since. Treating it as settled unless told
otherwise; it's live in both `v2_week_plan_sets` and `v2_set_logs` now.

The 003 migration has been applied and the auto-finish toggle confirmed 
working end-to-end against production (see "2026-07-10 session" below). 
Migrations 004–006 are **applied**; 007 is **fully run and verified**
(audit, backfill, Step 3 verify, plus an independent row-by-row
correctness check on both sides); 008 and 009 remain unwritten — they
belong to Phase 3.4 and 3.8 respectively, not 3.0.

**The settingsService.ts deploy-ordering risk flagged earlier no longer
applies** — `measure_set_time` exists in `v2_user_settings` now, so
`upsertSettings()` sending it on every save is safe. The application code
(TypeScript/React) itself has still not been deployed — nothing has been
committed or pushed — but there is no longer a specific reason it would
break Settings if it were.

**Phase 3.0 is formally done.** Phase 3.1 (dropset-as-one-unit UI) can
start — see the ADD STAGE / inference-heuristic note under "Known
issues" first, since that's a piece of 3.0's fix Phase 3.1 needs to
retire, independent of the backfill's now-confirmed status.

---

## Known issues
See AUDIT.md deferred section for full list.
Most impactful deferred items:
- A2 / H2: ExerciseCard now matches sets to planned/extra slots by 
  weekPlanSetId identity instead of array position (2026-07-09), 
  which fixes the ADD SET infinite-loop symptom and the specific 
  extra-set corruption H2 described — but the wider "no unique 
  identity for a WeekPlanSet edited mid-session" concern behind A2 
  is not fully resolved; treat as improved, not closed.
- P2: history downloads all set logs ever (performance at scale). 
  Scoped for a fix in v3 Phase 3.4 — three Postgres views replace the 
  client-side aggregation (TASKS.md §2.6)
- M5 (spontaneous dropsets never get parentSetId): **historical data
  side fully resolved and formally verified; code fix for new writes
  still not deployed.** On historical data: the 007 backfill is
  confirmed complete on both `v2_set_logs` (8/8 rows correctly linked,
  0 mismatches on independent re-derivation) and `v2_week_plan_sets`
  (7/7, 0 mismatches) — see "2026-08-05 session (Phase 3.0 — backfill
  formally verified)". On new writes: `GymSession.tsx`'s hardcoded
  `parentSetId: null` was replaced 2026-08-05 with a real computation
  (nearest preceding non-dropset log for that exercise in the current
  session — the same inference rule 007's backfill uses, so new writes
  would stay internally consistent with how old rows are grouped) — see
  the ADD STAGE / inference-heuristic note directly below for a
  limitation in that fix worth knowing before Phase 3.1. That fix has
  not been committed or deployed, so **every dropset logged through the
  live app today still gets `parent_set_id: null`**, exactly as before
  M5 was "fixed" in the working tree — only historical rows benefit from
  the backfill until this ships. The "set notes unwritable" half of M5
  is untouched regardless; `GymSession.tsx` still hardcodes `note: null`
  on every log call.
- **ADD STAGE / inference-heuristic limitation (new, 2026-08-05,
  read before starting Phase 3.1):** `GymSession.tsx`'s `parentSetId`
  assignment for a newly logged dropset is **inference-based** — it
  guesses the parent as the nearest preceding non-dropset log for that
  exercise in the session, exactly mirroring 007's backfill heuristic.
  Confirmed by reading the actual code (not describing from memory) that
  this is correct for the *current* UI: `SetRow.tsx`'s DROP toggle is the
  **only** entry point for `isDropset`, and it only ever applies to
  the set currently being submitted — enforced in three independent
  places, not just convention. (1) The already-logged branch
  (`if (currentLog) { ... }`) early-returns into a completely different
  render tree before the DROP button's JSX is ever reached, so it's not
  just hidden, it's unreachable. (2) The edit path's type signature
  (`onUpdate: (changes: { weight, reps, rir, note }) => void`) excludes
  `isDropset` entirely — there is no data channel to send it through
  even if a UI existed. (3) `sessionService.ts`'s `updateSetLog` builds
  its Postgres patch by checking each field name individually and never
  checks for `is_dropset`, so it would be silently dropped even if
  somehow present. Given that, there is no live UI signal today for
  "this specific set is a stage of that specific prior set" — inference
  is the only option, not a shortcut taken instead of an available direct
  reference.
  **This must change once Phase 3.1 ships ADD STAGE.** TASKS.md §3
  describes `SetRow.tsx`'s DROP toggle becoming ADD STAGE, tied to a
  specific already-logged set. At that point the user's tap directly
  identifies the parent set — Phase 3.1 should read that id straight
  from the interaction and stop inferring it, retiring this heuristic for
  the live-write path. (007's backfill can and should keep using
  inference indefinitely — it has no other option for historical data.)
  Flagging this here, not just in a chat reply, so whichever session
  builds 3.1 sees it without being told again.
- E4: REDO is lossy without warning user
- Q1 (hardcoded colours): still present in History, Settings, 
  Program builder, and a few modal backdrops — out of scope for the 
  2026-07-09 session (only SetRow.tsx's two rgba() literals were 
  fixed since that file was already being edited for FIX 2)

---

## 2026-07-09 session
1. **FIX — ADD SET infinite loop**: ExerciseCard.tsx's "extra set" rows 
   always rendered with `currentLog={null}` regardless of whether that 
   slot had been logged, and the extra-set counter never reflected 
   what was actually logged — every log caused a fresh phantom input 
   to appear. Rewrote to match SetLogs to planned/extra slots by 
   `weekPlanSetId` identity; `extraSlotCount` state only grows via 
   ADD SET and is seeded from already-logged extra sets on mount.
2. **FIX — comma/period decimals**: SetRow.tsx weight inputs changed 
   from `type="number"` to `type="text"` (native number inputs can 
   silently reject/blank a typed comma), plus `value.replace(',', '.')` 
   before `parseFloat` in both the log and edit paths.
3. **FEATURE — Preview session**: new PREVIEW SESSION button on Today 
   (suggest_from_plan/suggest_no_plan states) opens SessionPreview.tsx, 
   a read-only walkthrough with a START SESSION button at the bottom.
4. **FEATURE — Smart last-session reference**: replaced the old 
   two-panel LAST SESSION display with ExerciseReference.tsx. Counts 
   how many workout days in the active program contain the exercise 
   (`useExerciseOccurrenceCounts` in usePrograms.ts) and fetches a 
   same-workout-day "last completed session" via 
   `fetchLastCompletedSessionForExercise` in sessionService.ts (a 
   Supabase `!inner` join filtered on `v2_sessions.status`/
   `workout_day_id` — confirmed working against production data). 
   The any-workout-day side reuses the existing `lastLogs` query 
   (`useLastSessionLogs`, which already has a Dexie offline fallback) 
   instead of a second online-only fetch, so the panel degrades 
   gracefully offline for the common case. Decides FIRST TIME / LAST 
   WEEK / LAST TIME / both-side-by-side; recency thresholds (10 days 
   ≈ "last week", 28 days ≈ absence) live in referenceLogic.ts as 
   named constants.
5. **FEATURE — Rest day screen**: RestDayScreen.tsx — moon glyph 
   (SVG `<mask>` crescent — an initial single-path arc version 
   rendered invisible because the two endpoints were too far apart 
   for the inner arc's radius; caught by rendering both side by side 
   before shipping), week number + meso name, and a dot-segment "N of 
   M sessions done this week" summary computed from the meso-anchored 
   week window (not calendar Mon–Sun, consistent with AUDIT.md A4).

Full typecheck (`npm run typecheck`) is clean. Interactively verified 
against live production data via the read-only PREVIEW SESSION flow 
(confirms Feature 1 + Feature 2 end-to-end, including the `!inner` 
Supabase query, with zero write requests in the network log) and a 
standalone SVG render for the rest day moon glyph. Did not exercise 
the ADD SET fix or comma/period fix live (would require logging real 
sets into production data) — those are covered by static trace-through 
and typecheck only.

---

## 2026-07-10 session
1. **FIX — rest time display formatting**: new `formatRestTime()` in 
   src/lib/formatRestTime.ts (`<60s` → "45s", `≥60s` → "1min 32s"), 
   applied everywhere rest time was previously shown as a raw number 
   of seconds — SessionDetail.tsx (history), ExerciseProgress.tsx and 
   MesoProgress.tsx (both the chart tooltip and the Y-axis tick 
   formatter for the AVG REST TIME charts), and RestTimer.tsx (the 
   live active-session timer, which previously used its own m:ss 
   `fmt()` — replaced, not duplicated).
2. **FIX — session note autofill on continue**: SessionComplete.tsx's 
   note textarea previously always started blank. It now seeds from 
   `session.note` (already present in the `useActiveSession` payload) 
   the first time it resolves, via a one-shot ref guard — mirrors the 
   `userEditedRef` pattern already used in SetRow.tsx so a later 
   refetch never clobbers text the user is mid-typing. No separate 
   fetch was needed since reopenSession never clears the note column.
3. **FEATURE — auto-finish session after inactivity**: 
   useAutoFinishSession.ts polls every 30s; once every WeekPlanSet id 
   has a matching set_log (by weekPlanSetId) and the newest log's 
   loggedAt is older than `auto_finish_minutes`, it calls the same 
   `useCompleteSession` mutation FINISH SESSION uses (so it queues 
   offline identically) and shows a new global toast ("Session 
   completed automatically" — src/features/notifications/, no toast 
   library existed before this). Settings gained an AUTO-FINISH 
   SESSION card (on/off + minutes 1–60, default 5).
   - **Schema note**: the task spec's migration text said 
     `auto_finish_minutes integer not null default 5` but also "null 
     = disabled" — those two clauses conflict (`not null` can't hold 
     null). Shipped the column as nullable instead 
     (supabase/migrations/003_v2_auto_finish_minutes.sql) so the 
     disabled state is representable; kept default 5 so existing 
     rows and NOT NULL are not required together.

Full typecheck (`npm run typecheck`) is clean. Interactively verified 
against live production data: rest-time formatting confirmed in 
History (session detail, e.g. "5min 41s", "2min 19s") and in the 
Meso Overview AVG REST TIME/WEEK chart (Y-axis ticks render "0s", 
"1min 40s", "3min 20s", etc.). The 003 migration was applied on 
2026-07-11 (manually, via the Supabase SQL Editor); re-verified live 
afterward that toggling AUTO-FINISH SESSION off then back on in 
Settings saves cleanly with zero failed requests (previously a 
Postgres 400 — "column auto_finish_minutes does not exist" — before 
the migration ran). settingsService.ts's defensive `undefined → 5` 
fallback (for the pre-migration gap) is now dead in practice but 
harmless to leave in place. Session-note autofill and the auto-finish 
polling logic itself remain verified by code review + typecheck 
only — exercising them live would mean completing/reopening a real 
tracked session or waiting out a real inactivity window against 
production data.

---

## 2026-07-11 session
1. **FIX — meso week numbering flips on Sunday instead of Monday (AUDIT.md 
   A4, now resolved)**: every "which meso week is this" calculation used 
   `differenceInWeeks(date, mesoStartDate) + 1` — date-fns's raw 7-day-period 
   counter, anchored to the meso's exact start date rather than to calendar 
   weeks. A meso started on a Sunday (the normal case per the SPEC's "plan 
   Sunday night" workflow) flipped "Week N" on Sundays, one day before the 
   Monday a training week is meant to start. `differenceInWeeks` has no 
   `weekStartsOn` option at all — passing one is a type error — so the fix 
   is a function swap to `differenceInCalendarWeeks(date, mesoStartDate, 
   { weekStartsOn: 1 })`, which is calendar-week-aware. Six call sites 
   fixed (the task's own suggested file list — src/features/scheduling/ 
   and src/features/meso/ — doesn't match this codebase's actual layout, 
   which moved during Phase 1; the real call sites are 
   src/features/gym/useScheduler.ts's `currentWeek` — the single source 
   most other screens consume, src/features/gym/scheduler.ts's missed-session 
   backfill loop, src/features/plan/PlanPage.tsx and 
   src/features/programs/ProgramPage.tsx's local `weekNumber()` helpers, 
   and src/features/progress/progressService.ts's per-session week bucketing 
   for the meso progress chart). Also fixed 
   src/features/gym/RestDayScreen.tsx's "N of M sessions this week" window, 
   which derived its own week boundary via `mesoStart + (currentWeek-1)*7 
   days` — no longer valid once `currentWeek` is calendar-anchored — 
   replaced with a direct `startOfWeek(today, { weekStartsOn: 1 })`.
   AUDIT.md A4 moved from Deferred to Fixed (FIX 14).

Full typecheck (`npm run typecheck`) is clean. Verified the fix logic in 
isolation with a small node script comparing old vs. new week numbers 
across a Sunday-start meso's first two weeks — confirms the exact 
reported symptom (old: Sunday 06-21 already shows week 2; new: week 2 
starts Monday 06-15 and holds through Sunday 06-21, flipping to week 3 
on Monday 06-22). Did not verify live against the production meso — no 
stored login session on the dev server port used this session, and 
credentials weren't available to sign in. This fix changes what "Week 
N" displays across Plan, Program, Progress, Today, and the rest day 
screen for the currently active meso — worth an eyes-on check against 
the real meso next time the app is open.

---

## 2026-08-04 session
1. **FIX — reopening a finished session immediately re-finished it**: 
   `GymSession` fully unmounts when a session completes (`TodayPage` 
   switches from rendering `GymSession` to `CompletedTodayScreen` once 
   the scheduler sees `status: 'completed'`) and fully remounts when 
   the user hits Continue (`useReopenSession` flips it back to 
   `in_progress`, scheduler switches back to `active_session`, 
   `GymSession` mounts fresh). `useAutoFinishSession`'s `triggeredRef` 
   only reset on `session.id` change, so a fresh mount always starts 
   armed. Its `check()` also ran synchronously on mount, before the 
   30s interval. For a session reopened with every planned set already 
   logged (the common "reopen to edit/continue" case), the existing 
   staleness check — last log older than `auto_finish_minutes` — was 
   already true the instant the poller re-armed, since that staleness 
   is exactly why the session was finishable in the first place. Net 
   effect: reopen, then within one tick the session silently 
   auto-completed again, blocking any further logging or editing. 
   Fix: added `armedAtRef` (reset alongside `triggeredRef`, on mount 
   and on `session.id` change) and gate `check()` on 
   `Date.now() - armedAtRef.current >= autoFinishMinutes * 60_000` in 
   addition to the existing last-log staleness check. For a normal 
   (non-reopened) session this is a no-op — mount always precedes the 
   last log, so by the time the log becomes stale the arm-time grace 
   window has already elapsed too. For a reopened session it forces a 
   full `auto_finish_minutes` wait after reopen before the poller can 
   fire again, giving the user a real window to log or edit.

Full typecheck (`npm run typecheck`) is clean. Not verified live — this 
is a timing-dependent client-side hook that requires a real logged-in 
session, real production set-log data, and waiting out the poll/grace 
window to exercise meaningfully; no stored credentials were available 
in this environment to sign in and reproduce the original repro steps 
(reopen a finished session, confirm it stays open past one 30s poll 
tick). Worth an eyes-on check against the real app next time it's open: 
finish a session, hit Continue, and confirm it doesn't silently 
re-finish within the next `auto_finish_minutes`.

---

## 2026-08-05 session
**Planning only — no implementation code was written.** Produced TASKS.md,
the v3 technical plan, from SPEC.md + TASKS-v2.md + AUDIT.md.

Three findings from reading the actual codebase that shaped the plan:

1. **M5 is worse than AUDIT.md describes.** `GymSession.tsx:165` hardcodes
   `parentSetId: null`, so every set log row in production is unparented —
   not only spontaneous dropsets. The v3 dropset migration therefore cannot
   read `parent_set_id` to reconstruct grouping and must infer it from
   ordering: a run of `is_dropset` rows belongs to the nearest preceding
   non-dropset row in the same (session, exercise). Two audit queries run
   before the backfill (orphan drops with no preceding main set; duplicate
   set_numbers, which AUDIT A3 leaves unconstrained and M3 actively causes).
2. **FIX 14 simplified the v3 reference panel more than expected.** Because
   meso weeks are now Monday-anchored calendar weeks, "the immediately
   preceding meso week" is exactly "the previous Monday-anchored calendar
   week" — a pure date window, no meso join, no meso-start arithmetic. The
   v2 `RECENT_DAYS = 10` / `ABSENCE_DAYS = 28` constants in referenceLogic.ts
   were approximating that boundary and get deleted.
3. **A single-set delete path exists, and it matters for migration timing.**
   `SetRow.tsx:344 → ExerciseCard.tsx:97 → GymSession.tsx:167 →
   sessionService.ts:258` deletes one v2_set_logs row directly (the per-set
   delete from FIX 8 / AUDIT E1). Since `parent_set_id` keeps
   `ON DELETE SET NULL` until the final v3 migration, deleting a dropset head
   in the interim would silently promote its stages into main working sets and
   feed wrong numbers into the new e1RM headline. Plan includes a client-side
   cascade guard — **stages first, head last**, because the reverse order
   fails into exactly the corruption it's meant to prevent. History's
   SessionDetail.tsx is read-only for sets and needs no guard; the plan side
   gets CASCADE from the start.

Three decisions locked in review:

- **Dropset model: relational, not structural.** Stages stay as linked rows
  in v2_set_logs (`parent_set_id` + new `stage_index`), no child stage table.
  Paid for with the stage-exclusion rule (see Key architectural rules above)
  plus an audit of all 10 existing sites that violate it today (TASKS.md §2.7).
- **e1RM: RIR-adjusted, null-RIR sets skipped** (not `?? 0`, not plain Epley).
  A session where *no* working set has an RIR is excluded from the meso
  comparison entirely rather than falling back to unadjusted — unadjusted e1RM
  is systematically lower, so mixing the two would manufacture a gain out of
  the formula changing mid-comparison. Accepted consequence: sparse RIR
  recording means some exercises show no headline.
- **Vitest** proposed as the one new devDependency (no runtime deps added for
  v3). Not objected to in review.

Still open: whether to add `is_warmup` now while warmup sets are deferred
(TASKS.md §5.4). Two lower-stakes calls are deliberately deferred to Phase 3.0
because the backfill audit output decides them.

Nothing was typechecked or verified — there is no code to check. TASKS.md is
awaiting approval before Phase 3 begins.

---

## 2026-08-05 session (Phase 3.0)
Second session the same day. Began Phase 3.0 — migration foundation — per
TASKS.md §4, in the order §4 itself specifies (fix M5's write path before the
backfill runs, so new unparented rows don't keep arriving into data that's
just been grouped). Started blocked on DB access, landed the code-only work
first, then — mid-session, after you supplied a live Supabase login — applied
the migrations and ran the audit queries too. See the full arc below; the
short version is steps 1–4 of Phase 3.0 are done, step 5 (the backfill) is
deliberately still outstanding.

**What was written:**

1. **Migrations 004, 005, 006** (`supabase/migrations/`) — transcribed
   directly from TASKS.md §2.1/§2.2/§2.4/§2.5, expand-only (nullable/defaulted
   columns), safe with the old client still live. 006 includes `is_warmup` on
   both tables, because that's what TASKS.md's own migration text specifies —
   see "Active work" above for why that's still flagged as your call
   (§5.4), not treated as settled.
2. **Migration 007** (`007_v3_backfill_dropset_stages.sql`) — the three audit
   queries, the backfill, and the verify queries, transcribed from §2.1 with
   explicit STEP 1 / STEP 2 / STEP 3 banners so the destructive backfill can't
   be run by pasting the whole file into the SQL Editor by accident.
3. **`src/types/index.ts` + `src/lib/db.ts`** extended per §3: `ProgramExercise`
   gained `weightUnit`; `WeekPlanSet` gained `parentWeekPlanSetId`,
   `stageIndex`, `isWarmup`; `SetLog` gained `stageIndex`, `isWarmup`,
   `setSeconds`, `enteredUnit`; `UserSettings` gained `measureSetTime`. Dexie
   bumped to `version(2)` adding a `parentSetId` index on `set_logs`, plus the
   matching new fields on `CachedSetLog`. Did **not** add the `SetGroup` view
   type §3 also mentions — nothing consumes it yet (that's `setGroupLogic.ts`
   / `SetGroup.tsx` in Phase 3.1); adding it now would've been speculative.
4. **Mapper updates**, one level deeper than §4 item 2 literally asked for,
   because leaving the new type fields required-but-unpopulated would mean
   the types lie about the runtime shape. Every place that maps a Supabase row
   into one of the extended types now reads the new column, with a
   `?? default` fallback for "column doesn't exist yet" — the exact same
   pattern `settingsService.ts` already used for `auto_finish_minutes` before
   003 was applied. Touched: `programService.ts`, `weekPlanService.ts`,
   `sessionService.ts`, `settingsService.ts` (+ `upsertSettings`'s row
   builder), `settingsStore.ts` (`DEFAULT_SETTINGS`), `useSession.ts` (four
   object-literal `SetLog`/`CachedSetLog` constructions across the offline
   log path), `offlineCache.ts` (`primeOfflineCache`'s cache-write path).
5. **AUDIT M5 write-path fix** — `GymSession.tsx`'s `onLog` handler no longer
   hardcodes `parentSetId: null`. It now filters `allCurrentLogs` to the
   current exercise, and for a dropset log, finds the highest-`setNumber`
   entry that isn't itself a dropset and uses its id as the parent; a
   non-dropset log always gets `parentSetId: null` (it's a head). This
   mirrors 007's own inference rule exactly, so anything logged through this
   path from now on agrees with how the backfill would have grouped it.
   Deliberately scoped to just this — the "set notes unwritable" half of M5
   and the full dropset-as-one-unit UI are Phase 3.1, not this fix.

**Verification:** `npm run typecheck` clean. Dev server starts and the login
screen renders with zero console errors — confirms the type/mapper changes
don't break the build or crash before auth. Could not go further: no stored
login session exists in this environment, and entering credentials to sign in
is out of policy regardless (same constraint every prior session has hit).
Nothing in this batch is exercisable pre-login anyway — it's all
data-shape/write-path plumbing behind the session screen.

**Blocker hit, then resolved, same session:** initially, this environment had
no way to execute SQL against the live Supabase project — `.env.local` has
only the anon key, no service-role key or DB connection string anywhere in
the repo, no `supabase/config.toml` (CLI never linked), and no authenticated
browser session in either the sandboxed Browser pane or Claude-in-Chrome.
Reported this back and stopped rather than guessing. You then logged into the
Supabase dashboard in the Browser pane yourself and said to proceed — that
authenticated session is what made the rest of this possible. It is *not* a
standing capability of this environment: nothing was added that would let a
future session do this on its own (no key or connection string was saved
anywhere), so the same blocker will resurface next time unless a browser
session is live again or different credentials are provided.

**Migrations 004, 005, 006 applied to production**, one at a time via the
Supabase SQL Editor, confirming success before moving to the next (each
returned "Success. No rows returned" for its ALTER TABLE / CREATE INDEX
statements — no errors). Independently re-verified afterward with a single
`information_schema.columns` query listing all 9 new columns across
`v2_program_exercises`, `v2_set_logs`, `v2_user_settings`, and
`v2_week_plan_sets` — types, nullability, and defaults all matched the
migration files exactly.

**007's Step 1 (the three audit queries) run against real production data:**

| Query | Result |
|---|---|
| (a) Orphan drops — dropset-flagged row with no preceding main set | **0** |
| (b) Duplicate `set_number` within a (session, exercise) pair | **0 rows** |
| (c) Scope — total drop rows / sessions touched | **8 drop rows / 4 sessions** |

All three came back clean. There is no undecidable orphan case, no ambiguous
ordering from duplicate set numbers, and the affected surface is small (8
rows in 4 sessions, out of however many are in the table overall — not
queried, wasn't asked for). This resolves TASKS.md §5.5's "genuinely
undecidable until the audit query runs" framing for orphan handling — with
zero orphans, the leave-unparented-vs-clear-the-flag question doesn't
actually arise.

**007's Step 2 (the backfill) was deliberately NOT run**, even with every
count clean. The instruction for this phase was explicit that a clean audit
doesn't auto-authorize the backfill — that decision needed to happen after
you'd seen the real numbers, not automatically inside the same turn that
produced them. So: numbers are in this file now, and the backfill is still
outstanding, waiting on an explicit go-ahead.

**A UI mechanics note for future sessions doing browser-driven SQL Editor
work:** this project's SQL Editor runs Monaco, and keyboard-based
select-all/clear (`Ctrl+A`, `Home`+`Delete`/`Backspace` with `repeat`,
`Escape` to dismiss autocomplete) was unreliable via this browser automation
tool — modifier keys in particular did not appear to reach the page
correctly. What worked reliably: typing fresh content into a **newly created
snippet** (sidebar "+" → "Create a new snippet") rather than trying to clear
an already-populated editor, and reading back `get_page_text` before every
Run to confirm the typed content matched exactly. This left roughly half a
dozen extra "Untitled query" snippets in the sidebar's private query list,
including one with corrupted/merged text from an early failed clear attempt
(visible content: starts with "xmlroot-- Overload Zv3...") — none were
deleted, since attempting that carried a real risk of deleting one of your
existing named queries instead, given how unreliable coordinate-based
clicks were proving in that session. Safe to clean up by hand next time
you're in the SQL Editor; harmless if left alone.

---

## 2026-08-05 session (Phase 3.0 verification)
Later the same day, across what appears to have been more than one
conversation turn (some interrupted — see below). Two things happened,
in two parts.

**Part 1 — a backfill narrative appeared in CONTEXT.md that this session
has no direct memory of producing.** At some point after the "Phase 3.0"
session above (which ends with the backfill deliberately not run),
several sections of this file — Database tables, Active work, Known
issues, Key architectural rules — were rewritten to assert the backfill
had run, with specific numbers (8 log rows/4 sessions, 7 plan rows, both
Step 3 verify queries passing). That narrative was detailed and internally
consistent *within those sections*, but the dated session log above was
never updated to match, and no new dated entry documented when or how
the backfill supposedly happened — leaving the file self-contradictory.
Also worth recording plainly: at least one turn in this stretch appears
to have been interrupted mid-task (a "Continue from where you left off"
prompt arrived with nothing to continue), and the DB-access blocker
recurred in between despite CONTEXT.md's own claim that it had already
been resolved — evidence the working browser session does not persist
across whatever caused the interruption, exactly as the "not a standing
capability" warning above already anticipated.

**Part 2 — verified what's actually true before writing anything.**
Two things were checked, in order:

1. **Git history on CONTEXT.md.** `git log --oneline -- CONTEXT.md` shows
   the last commit touching this file is `281fd2b`, dated 2026-08-04 —
   before any Phase 3.0 work existed. `git diff HEAD --stat -- CONTEXT.md`
   shows the entire current file as uncommitted (333 insertions / 12
   deletions against that commit); no stash, no other branch, nothing
   hiding a second version. **So the "backfill complete" narrative was
   never committed — it's uncommitted content from an interrupted
   session, exactly as suspected, not two competing recorded states.**
   This explains the *mechanism* of the contradiction but doesn't by
   itself confirm or refute whether the backfill actually ran against
   production.
2. **Two diagnostic queries against live production**, run only after
   re-establishing Supabase access (lost again between turns, restored
   once you logged in again):
   - Direct completion check: `still_unlinked = 0`, `already_linked = 8`
     (`select count(*) filter (where is_dropset and parent_set_id is null)
     as still_unlinked, count(*) filter (where is_dropset and
     parent_set_id is not null) as already_linked from v2_set_logs`).
   - 007 Step 1(c)'s scope query, fresh: `drop_rows = 8`,
     `sessions_touched = 4` — unchanged from the original audit baseline.

**Branching instruction was explicit and was followed literally, not
reinterpreted.** The authorized "proceed" condition was
`still_unlinked = 8, already_linked = 0` (nothing done yet). The
authorized "STOP and report, don't guess" condition included
"already_linked is nonzero" — which is exactly what came back
(`already_linked = 8`). Per instruction, this session **stopped** rather
than proceeding to the SELECT-equivalent dry run, the real backfill, or
Step 3's verify queries, and rather than concluding on its own that the
obvious reading ("it already ran cleanly, scope hasn't drifted, nothing
to do") is correct. That reading is plausible — 0 unlinked, 8 linked,
scope unchanged is what a clean, already-completed backfill would look
like — but it was not treated as confirmed, because Step 3's own verify
queries have still never actually been run and passed in any session on
record, and the plan-side table (`v2_week_plan_sets`) was not checked at
all in this session (out of scope for the two authorized queries).

**CONTEXT.md was then rewritten across every affected section** —
Current state, Database tables, Key architectural rules, Active work,
Known issues — to state only what's actually verified as of this
session: migrations and audit confirmed; log-side backfill *apparently*
applied based on diagnostic evidence but not formally confirmed; plan-side
backfill status unknown; M5's code fix written but not deployed. No
section asserts "backfill complete." Also added: an explicit
known-limitation note (under "Known issues") that `GymSession.tsx`'s
`parentSetId` inference is correct for the current UI but must be
replaced with direct ID assignment once Phase 3.1's ADD STAGE flow ships
— confirmed by reading `SetRow.tsx`, `ExerciseCard.tsx`, and
`sessionService.ts` directly (not from memory) that no retroactive
dropset-flagging path exists anywhere in the current UI; the DROP toggle
is enforced as submission-only in three independent places (an early
JSX return, an update-path type signature, and a DB-patch field
whitelist), not just by convention.

**To actually close this out:** run Step 3's two verify queries against
current production data in a session that documents the result, and
independently check `v2_week_plan_sets` for `parent_week_plan_set_id`
population. Until then, treat the historical backfill as likely-done,
not done.

---

## 2026-08-05 session (Phase 3.0 — backfill formally verified)
Final session of the day. Three checks, run in order, exactly as
instructed — with an explicit branch to stop and report rather than fix
or reinterpret if anything came back unexpected. Nothing did.

**1. 007 Step 3's two verify queries, log side, run fresh:**

```sql
select count(*) from v2_set_logs where is_dropset and parent_set_id is null;
-- result: 0

select count(*) from v2_set_logs where not is_dropset and parent_set_id is not null;
-- result: 0
```

Both match expected (0, 0).

**2. Correctness check, log side — not just presence.** For all 8
`is_dropset` rows in `v2_set_logs`, independently re-derived the expected
`parent_set_id` using the same inference rule as the backfill (nearest
preceding non-dropset row, same `session_id` + `exercise_id`, ordered by
`set_number` then `logged_at`), then compared to the stored value:

```sql
with ordered as (
  select id, session_id, exercise_id, is_dropset, set_number, logged_at,
         count(*) filter (where not is_dropset) over (
           partition by session_id, exercise_id
           order by set_number, logged_at
           rows between unbounded preceding and current row
         ) as group_no
  from v2_set_logs
),
grouped as (
  select o.id, o.group_no,
         first_value(o.id) over w as computed_head_id
  from ordered o
  window w as (partition by o.session_id, o.exercise_id, o.group_no
               order by o.set_number, o.logged_at)
),
compared as (
  select sl.id, sl.parent_set_id as stored_parent,
         case when g.group_no = 0 then null else g.computed_head_id end as expected_parent,
         (sl.parent_set_id is distinct from
          (case when g.group_no = 0 then null else g.computed_head_id end)) as mismatch
  from v2_set_logs sl join grouped g on g.id = sl.id
  where sl.is_dropset
)
select count(*) as total_dropset_rows,
       count(*) filter (where mismatch) as mismatch_count,
       string_agg(case when mismatch then id::text end, ' ;; ') as mismatch_details
from compared;
```

Result: `total_dropset_rows = 8`, `mismatch_count = 0`,
`mismatch_details = NULL`. All 8 stored values matched the independently
re-derived expected value exactly — not merely present, but correct.

**3. Plan side, never checked before this session.**

Completion + scope check:
```sql
select count(*) filter (where is_dropset and parent_week_plan_set_id is null) as still_unlinked,
       count(*) filter (where is_dropset and parent_week_plan_set_id is not null) as already_linked,
       count(*) filter (where is_dropset) as total_dropset_rows
from v2_week_plan_sets;
-- result: still_unlinked = 0, already_linked = 7, total_dropset_rows = 7
```

Rows exist, `already_linked` matches scope, `still_unlinked` is 0 — per
the instructed branch, this meant re-running the correctness check
scoped to the plan side rather than a backfill dry run:

```sql
-- same structure as the log-side correctness check, partitioned by
-- week_plan_id + program_exercise_id, ordered by set_number only
-- (no logged_at column on this table)
-- result: total_dropset_rows = 7, mismatch_count = 0, mismatch_details = NULL
```

All 7 plan-side stored values matched their independently re-derived
expected value exactly.

**All three checks came back clean — 1, 2, and 3.** Per the session's own
instruction, this is what authorizes the change below: CONTEXT.md now
states the backfill (both sides) as verified complete, not diagnostically
likely, because Step 3 and an independent correctness check actually ran
and passed in this session, on both tables. Updated: "Current state",
"Database tables", "Key architectural rules", "Active work", "Known
issues" — all now agree with each other and with what's above, replacing
every earlier "likely but not confirmed" / "apparently ran" hedge.

**What is not yet done, still:** `GymSession.tsx`'s M5 write-path fix
remains uncommitted and undeployed — new dropsets logged through the
live app still get `parent_set_id: null`. The backfill only covers
historical data that existed at the time it ran. This file was committed
after this update (CONTEXT.md only — the rest of the working tree,
including that fix, migrations 004–007, and all other Phase 3.0 code
changes, remains uncommitted, as it has throughout this work).

---

## Pending feedback to address
From real usage (one day):
- Warmup sets handling
- Edit logged set RIR after logging (partially fixed — E1 done)
- Rest timer counts set time too (timer starts wrong moment)

---

## How to start a Claude Code session
1. Read this file
2. Read SPEC.md (v3 product spec)
3. Read TASKS.md (v3 technical plan)
4. Read AUDIT.md
5. Read TASKS-v2.md if you need the shipped app's architecture — v3 extends
   that foundation rather than replacing it
6. Read specific files relevant to the task
7. Update this file at the end of the session
