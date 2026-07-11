# Overload v2 — Claude Context
*Read this first. Then read Overload-v2-SPEC.md, TASKS.md, AUDIT.md.*

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
**not yet applied to the live Supabase project as of end of 
2026-07-10 session.** Must be run manually in the Supabase SQL 
Editor (same workflow as 001/002) before the auto-finish toggle 
in Settings will work — until then, saving settings with the 
toggle off (auto_finish_minutes = null) fails with a Postgres 
400 (column does not exist), confirmed live against production 
during this session.

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

---

## Key files
- Overload-v2-SPEC.md — product source of truth
- TASKS.md — technical architecture, data models, scheduling algorithm
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
  the user's auto_finish_minutes setting
- src/features/notifications/toastStore.ts + Toast.tsx — minimal 
  global toast (Zustand + component mounted in App.tsx), added 
  for the "Session completed automatically" notification; no 
  toast library existed before this
- tokens.css — all CSS custom properties

---

## Active work
**Blocking:** run supabase/migrations/003_v2_auto_finish_minutes.sql 
in the Supabase SQL Editor — the auto-finish feature (Settings 
toggle + background completion) will 400 on every settings save 
until this column exists. Everything else from the 2026-07-10 
session works against production as-is.

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
- P2: history downloads all set logs ever (performance at scale)
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
"1min 40s", "3min 20s", etc.). **The auto-finish migration has not 
been run against production** (see "Active work" above) — confirmed 
this live: toggling the Settings switch produces a real Postgres 400 
("column auto_finish_minutes does not exist") until the SQL in 
003_v2_auto_finish_minutes.sql is applied via the Supabase SQL 
Editor. settingsService.ts has a defensive fallback so the app 
doesn't show "undefined" in the meantime (falls back to the column's 
own default of 5), but the toggle-off path won't persist until the 
migration runs. Session-note autofill and the auto-finish polling 
logic itself were verified by code review + typecheck only — 
exercising them live would mean completing/reopening a real tracked 
session or waiting out a real inactivity window against production 
data.

---

## Pending feedback to address
From real usage (one day):
- Warmup sets handling
- Edit logged set RIR after logging (partially fixed — E1 done)
- Rest timer counts set time too (timer starts wrong moment)

---

## How to start a Claude Code session
1. Read this file
2. Read Overload-v2-SPEC.md
3. Read TASKS.md
4. Read AUDIT.md
5. Read specific files relevant to the task
6. Update this file at the end of the session
