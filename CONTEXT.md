# Overload — Claude Context
*Current state only. Finished work and build logs live in HISTORY.md; settled decisions live in DECISIONS.md.*

## What this is
Overload is a strength training PWA for a serious intermediate-to-advanced lifter: programs, weekly planning, live session logging and history. It is three layers — Program (what exercises) → Weekly Plan (sets + RIR targets per session per exercise) → Session Log (what actually happened) — on a Supabase backend shared with Northstar v2, single user.

This build is phase 1 of the Overload Planner Extension: the [P1] items in SPEC.md. Phase 2 and SPEC's "Later" list are not being done.

## Where the build is
- Current chunk: 1 — built, amended and verified on scratch; **not applied, not merged**.
- Finished: none.
- Waiting on me: DECISIONS.md 30 — apply 027 (final version only: `3dbeebb`, 16494 characters / 18450 bytes, md5 `3a0ead06021e6131fa0177dab6bda220`) through the placeholder-collapse transport (`transport/027_planner_p1_schema.transport.sql`, 15780 characters; step 2 there), do steps 1–6, then report. 31 and 32 are answered.
- Chunk 1 state: `supabase/migrations/027_planner_p1_schema.sql` on `build/chunk-1` (pushed): six new tables, the data-model columns on nine tables, stage-row `stage_kind` checks on `v2_week_plan_sets` and `v2_set_logs` (Adam's answer to 30), `notify`. `check-migration` exits 1 with the 8 statements TASKS.md predicted. Reviewer-verified on a fresh scratch copy with `review-027.sh` (session scratchpad): catalog diff = data model (+72 columns, +61 constraints, +21 indexes, +6 policies, nothing removed); counts and row fingerprints unchanged on all nine tables; old-client settings upsert preserves non-default new columns; RLS A/B/anon; named CHECK rejections incl. both stage-row checks. `verify-rls.mjs` run 2026-10-03 with Adam's go-ahead: 25 tables, 50 probes, all pass. After Adam's report: API column probes (Adam-filtered, `limit=0`, made-up-column control) and anon reads of the six new tables (Adam-filtered), then the chunk 1 PR to master.
- Scratch cluster (this container only): PostgreSQL 16.14 on port 54329, `/var/lib/postgresql/chunk1-pg16`; `overload_scratch` = 001–026 + fixtures; `rev_pre`/`rev_post` = reviewer's before/after copies; builder scripts in the session scratchpad `chunk1/` (`run_all.sh`).

## What exists
Current state, one line per part. Migrations are `supabase/migrations/NNN_*.sql`.

**Platform**
- Stack as listed in Repo facts. Auth: Supabase email/password (same credentials as Northstar v2); `LoginPage`, `useAuth`.
- Routes: `/today /plan /progress /history /exercise/:id /session-type/:dayId /program /program/:id /program/:id/day/:dayId /meso/:id/priorities /library /settings /coach`. Nav = TODAY, PLAN, PROGRESS, HISTORY, PROGRAM, LIBRARY, SETTINGS, plus COACH only for the Coach user.
- PWA: vite-plugin-pwa, `injectRegister: false`; `usePwaUpdate` checks hourly and on visibility for a new bundle and shows an update banner. Service worker precaches a fixed asset list and has only a top-level-navigation fallback (no `/api/` handling).
- Offline: Dexie cache (`db.ts`) primed on session start; `useLogSet`, `useCreateSession`, `useCompleteSession`, `useSkipSession` queue through the sync queue (`useSyncQueue`); all write mutations use `networkMode: 'always'`. Meso creation, History cross-meso views, priorities, Library and all Coach features are online-only.
- Settings: theme, accent colour, rest timer, weight unit, auto-finish minutes (default 5, nullable), `measure_set_time` toggle. Toast store for notifications.

**Database** (all `v2_`-prefixed, RLS `for all … user_id = auth.uid()` unless noted; `exercises` is shared with Northstar)
- 001–002 base schema + RLS; 003 `auto_finish_minutes`; 004–006 dropset stages, set timing, units/warmup columns; 007 dropset backfill (verified both sides); 008 reference-panel index; 009 three `security_invoker` history views (`v2_history_session_summary`, `v2_exercise_set_history`, `v2_session_type_history`); 010 parent FKs `on delete cascade`; 011 view fix for skipped-head stages; 012 Coach daily tables (session analyses, phase entries, weight entries); 013 `exercises.muscle_subgroup text[]` + `movement_pattern` + `v2_coach_week_analyses`; 014 tags for all 70 exercises; 015 all-skipped "completed" sessions reclassified to skipped; 016 `form_rating`/`energy_rating`/`pump_rating`; 017 `v2_coach_notes`; 018 `v2_coach_memory_entries` + `v2_coach_curation_runs`; 019 `v2_exercise_libraries`/`_items` (read-only) + `exercises.status/source_library_id/lost_at`; 020 legacy provenance (46 of 70 rows); 021 `reassign_exercise_history(p_source,p_target)` (`security invoker`); 022 `v2_exercise_reassignments` audit; 023 `v2_coach_qa_exchanges` (select+insert RLS only); 024 `v2_coach_meso_tag_priorities`; 025 `v2_session_exercise_swaps`; 026 `v2_coach_meso_analyses`.
- Delete semantics: analysis tables cascade from their session (daily) or have no FK (weekly); `v2_coach_notes`, Q&A exchanges, swaps and meso analyses use `on delete set null`; priorities cascade with their meso.

**Gym / Today**
- `scheduler.ts`: pure, 8 result variants; `useScheduler`, missed-session prompt, rest-day screen, read-only `SessionPreview`. Missed sessions (run under Vitest 2026-10-03): 7-day look-back, never before the meso start, crossing week boundaries; a scheduled day counts as handled by any completed/in-progress/skipped session dated that day; DO IT NOW creates the session under the *missed* date (works offline), after which today's own workout is offered again; MARK SKIPPED writes a skipped row (online only); dismiss lasts one screen mount.
- `ExerciseCard`/`SetRow`: identity-matches logs to planned/extra slots by `weekPlanSetId`; optimistic logging, skip set, skip whole exercise, edit logged set, per-set form-rating chips; scroll-to-current-set button; session header shows live duration.
- Dropsets: one head + stages (`parent_set_id`/`parent_week_plan_set_id` + `stage_index`); `setGroupLogic.ts` groups; `SetGroup` shows bold ADD STAGE when the plan expects a stage, a low-emphasis "mark as dropset" link otherwise, and neither on a skipped head; cascade delete removes stages first, head last.
- Reference panel: `referenceLogic.ts` two-slot resolver (LAST WEEK → LAST TIME → FIRST TIME primary; `EARLIER THIS WEEK` secondary), meso-scoped reach-back, `all_skipped_in_meso`; one batched `fetchReferenceSessions` per screen.
- Optional Start Set flow (`measure_set_time`): `setTimerStore`, freezes true rest, captures `set_seconds`; floating `RestTimer` plus `RestTimerInline` under the just-logged row.
- Finish: `useAutoFinishSession` (30 s poll, grace window after reopen) and manual finish both use `deriveCompletedAt` (max `logged_at`; null with no eligible logs); `SessionComplete` captures energy/pump; note editable after completion; an all-skipped session completes as `skipped`.
- Swap exercise (session-only): `SwapExerciseSheet` + `exerciseSwapLogic.ts`; writes `v2_session_exercise_swaps`, skips the original's remaining sets, shows one merged card with prefill from the original's plan.
- Add exercise mid-workout: same sheet in `'add'` mode (muscle-group filter chips, excludes exercises already active); card lives in local state until its first set is logged, then is rebuilt from logs (`extraExercises`).
- `WorkoutSidebarSheet` (Coach user only): NOTES tab (raw Coach Notes, optionally session-scoped) and ASK tab (in-session Q&A via `QaPanel`).

**Plan / Program**
- `PlanPage`: `WorkoutSwitcher` chip row (one workout day at a time), per-set RIR targets and dropset stages (ADD STAGE authoring), deload flag (one `v2_week_plans.is_deload` per workout per week, toggled per workout panel once that workout has a plan row; no whole-week action; copying carries the flag into the new week), whole-week COPY WEEK and single-workout copy (shared `copyOnePlanForward` → `copySetsWithGrouping`; COPY offered only when the destination is empty and the source has rows), page-local COMPACT view (`compactPlanLogic.toRuns`, read-only).
- Program builder: programs → workout days → exercises with optional suggested reps; per-exercise weight unit INHERIT/KG/LBS (literal resolved at creation); weekly schedule grid; meso create/activate/complete/delete (one active at a time — app code only: complete every active meso, then insert, two requests and no constraint; two concurrent starts left two active on a scratch copy; deleting a meso removes its plan, logged sessions survive untagged); START MESOCYCLE creates the meso then opens `/meso/:id/priorities`.

**Progress / History**
- Progress: per-exercise charts and meso overview dashboard; E1RM headline (`e1rm.ts`) — RIR-adjusted Epley, first vs most recent eligible session in the active meso, percentage only, hidden with <2 eligible sessions; stage-excluding set counts/RIR/reps; `fetchExerciseProgress` pages with `.range()`. `positionMatch.ts` (two-stream set-by-set comparison, no rollup) feeds History's SIDE BY SIDE and Coach payloads.
- History: session list from `v2_history_session_summary` with real pagination; filters by meso/session/date/muscle group; exercise search; session detail with grouped dropsets and delete; all-time `ExerciseHistoryView` and `SessionTypeHistoryView` (online-only) over the 009 views.
- Weight units: `weightUnit.ts` (exact 0.45359237, kg stored, `resolveEditedWeightKg` drift guard) + `useWeightDisplay`; Progress/History convert to the global unit, the gym screen to each exercise's resolved unit.

**Library**
- Multiple curated global libraries (preview / download / delete per library), three-state exercise lifecycle (active / lost / gone — deleting an exercise with history moves it to Lost Exercises; restore ships), reassignment of a lost exercise's history via `ReassignSheet` (type-the-target-name confirmation, 022 audit row), tag-editing screen for `muscle_subgroup`/`movement_pattern`, explicit default-library import. Reassignment has only been proven on throwaway data.

**Coach** (gated: client `isCoachUser` via `VITE_COACH_USER_ID` is cosmetic; server `COACH_USER_ID` is authoritative; both are Adam's user id). `/coach` tabs: ANALYSIS (Session / Week / Meso sub-tabs), ASK, CONTEXT.
- Shared server auth `coachApiAuth.ts` (JWT via `supabase.auth.getUser`, then user gate). Endpoints in `api/coach/`: `analyze`, `analyze-week`, `analyze-meso`, `ask`, `curate-memory`; `vercel.json` gives `api/**` 60 s and `analyze-meso` 290 s.
- Daily: `analyze.ts`, `coachPrompt.ts` `PROMPT_VERSION 7`, Haiku 4.5 pinned `claude-haiku-4-5-20251001`; one permanent row per session; payload from `analysisInput.ts` (position-matched streams, reference kind, phase, weight trend, memory, notes, ratings, `swaps`); analyses only for sessions completed after `COACH_ANALYSIS_START_DATE` (`2026-08-16T22:00:00.000Z`); idempotent; `stop_reason` checked.
- Weekly: `analyze-week.ts`, `WEEK_PROMPT_VERSION 3`, Haiku 4.5; a week is analyzable by plan resolution (`weekResolution.ts`, completeness re-derived server-side); `weekBuckets.ts` regroups per-exercise facts by tag with `muscleGroup` fallback, never a blended per-group metric; one row per Monday `week_start`.
- Mesocycle: `analyze-meso.ts`, `claude-sonnet-5` (no date suffix), `MESO_PROMPT_VERSION 2`, `effort` high, `MESO_MAX_TOKENS 32000`; manual trigger per completed meso (no row has been generated yet — Vercel timeouts), one permanent row per meso (`mesocycle_id` nullable, name/dates denormalised); reads Priority Context for the analysed meso, never the active one; `mesoAnalysisInput.ts` + `mesoWeekRollup.ts`.
- Ask: `ask.ts`, `coachQaPrompt.ts` `QA_PROMPT_VERSION 1`; four categories decided by originating screen (in_session, general, planning, app_mechanics) — Haiku for all but planning (Sonnet 5); `HISTORY_TURN_CAP 4`, `MAX_TURNS_PER_CONVERSATION 20`; every exchange permanent with a context snapshot; advisory only. Entry points: workout sheet ASK tab and Coach → ASK; shared `QaPanel` with `qaSidebarStore`.
- Context tab: phase log (implicit end dates, unique per start date), weight log (daily and weekly-average kinds; weekly entries normalise to Monday), weekly averages, Coach Notes, Coach Memory (`curate-memory.ts`, Haiku, `CURATION_PROMPT_VERSION 1`, `curationApply.ts` validates decisions; UPDATE MEMORY is manual).
- Personalization: form (per set), energy and pump (per session) are ungated training data like RIR and show in Progress/History; notes/memory feed the daily and weekly prompts.
- Priority Context: per-meso sparse rows (top/high/normal/low) over `PRIORITY_TREE` in `priorityTags.ts`; `densifyPriorities` makes "no row = normal" the default; `fetchPriorityContext(client, userId, mesocycleId)`; `MesoPrioritiesPage` with optimistic writes and an explicit COPY FROM previous meso.

**Tooling and tests**
- Vitest (node env; component tests opt into jsdom per file); 548 tests in 37 files pass (re-run 2026-10-03). Pure logic lives in testable modules (`setGroupLogic`, `referenceLogic`, `e1rm`, `positionMatch`, `weightUnit`, `qa*`, `*Input`).
- `scripts/`: `check-context-size.mjs` (CONTEXT.md ≤ 75 KB), `check-migration.mjs` + `migration-rules.mjs` (safe-list classifier, tested by `migration-rules.test.mjs`), `gen-icons.mjs`, `verify-rls.mjs` + `verify-rls-tables.test.mjs` (below). `transport-collapse.mjs` + `transport-collapse.test.mjs` (below). Run the tests with `node --test "scripts/*.test.mjs"` (60 tests: 26 migration-rule + 5 verify-rls-tables + 29 transport-collapse; not part of `npm test`, which is Vitest over `src/`).
- `scripts/verify-rls.mjs` — committed RLS check; run `node scripts/verify-rls.mjs`. Needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `RLS_TEST_EMAIL`, `RLS_TEST_PASSWORD` (the test account owns no data). For each table in its `TABLES` list (25 tables/views found by searching `src/` and `api/` for `.from('…')`) it runs one select with the anon key and no session, and one signed in as the test account. Reads only. Zero rows or permission-denied (`42501`) = pass; any row = LEAK; any other error (unreachable, bad key, missing table, failed sign-in) = FAIL; a missing variable also fails. Exit 1 on any leak, failure or missing variable. **New tables must be added to `TABLES`** or they aren't checked. `v2_exercise_libraries` and `v2_exercise_library_items` are in `PUBLIC_BY_DESIGN`: migration 019 makes them readable by everyone (`using (true)`, no `user_id`), so rows there don't count as a leak (errors still fail); intentional, because they hold shared curated content, no per-user data (DECISIONS.md 29). Live runs: 2026-10-01 (first) and 2026-10-03: 25 tables, 50 probes, all pass. Its selects are unfiltered by design (they probe RLS as anon and as the no-data test account), so running it is a live read outside the "filter to Adam's user_id" rule — ask before running it.
- `scripts/verify-rls-tables.test.mjs` — fails if a table named in a `.from('…')` call in `src/` or `api/` is missing from `TABLES`, if `TABLES` names one the app no longer uses, if `TABLES` has a duplicate, or if a new dynamic `.from(variable)` call appears (the two known ones, `reassignService.ts` and `useSyncQueue.ts`, only receive names that have literal calls elsewhere). Reads `verify-rls.mjs` as text, so it needs no env vars and no network. Proven in this repo 2026-10-03 (planner build, before chunk 1): with `'v2_session_exercise_swaps'` deleted from `TABLES`, test 3 failed naming it and the three files that use it (4 pass, 1 fail); the file restored byte-identical (`cmp`), 5 of 5 pass. The adding-a-fake-table direction was not re-proven here.
- `scripts/transport-collapse.mjs` — placeholder-collapse transport for hand-applied migrations: `node scripts/transport-collapse.mjs <file.sql> [out]` replaces every run of 4+ identical characters with `@@R<hex codepoint>x<count>@@`, checks the round trip and that no run of 4+ survives, and prints the transport and expanded lengths + SHA-256 (with and without the final newline) and the browser-console snippet that expands the editor text and prints the same two hashes (the snippet and the script share one expansion source string). `crypto.subtle` needs a secure context (the dashboard is HTTPS; a test page must be `localhost`, not `about:blank`). Its test round-trips every migration in `supabase/migrations`; proven 2026-10-04 by a short-by-one expander (22 fail) and disabled collapse (21 fail). Transport files live in `transport/` on the working branch.

## Repo facts
- Stack (unchanged text from the prior CONTEXT.md):
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
  - Stack additions this build: none.
- Supabase deploys migrations from main: no — applied by hand
  in the SQL Editor. Automatic deploys and preview branches are
  off: Supabase's history never recorded 001–026, and v1's
  migrations aren't in this repo. Rebuilding the history from
  the live schema is planned, to switch back to automatic.
- Local default branch is `master` (`origin/master`); `check-migration.mjs` defaults to comparing against `origin/main`.
- Repo/package/Vercel project are all named `overload-v2` (v3 work never renamed it). Production alias `overload-v2-sage.vercel.app`; push to `origin/master` deploys.
- `vercel.json` `ignoreCommand` is exactly `git diff --quiet HEAD^ HEAD -- . ':(exclude)*.md'`: it skips the build when the pushed commit changes only `.md` files (any directory) and builds otherwise. Vercel rejects an `ignoreCommand` over 256 characters (the previous 274-character version failed validation on the merge to master). Its known gap: it compares only `HEAD^` to `HEAD`, so a multi-commit push whose last commit is docs-only is skipped even if earlier commits changed code.
- Supabase project is shared with Northstar v2 (formerly Atlas); Adam's user id is `12e79b69-9891-4f53-a7cf-650edd83659f`. No service-role key, DB connection string or CLI link exists in the dev environment.
- Commands: `npm run typecheck` (app + api tsconfigs), `npm test`, `npm run build`, `node scripts/check-context-size.mjs`, `node scripts/verify-rls.mjs` (needs the four variables above). Dev server: `.claude/launch.json` "Overload v2 dev" (port 5173); plain `vite` does not run `api/**`.
- Set Vercel env vars with `vercel env add` (more reliable than dashboard automation) and redeploy for them to take effect.
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (both must be stripped of non-ASCII/invisible characters), `VITE_COACH_USER_ID`, server `COACH_USER_ID`, `ANTHROPIC_API_KEY`. `.env.local` is gitignored. `verify-rls.mjs` also reads `RLS_TEST_EMAIL` and `RLS_TEST_PASSWORD` (a test account that owns no data; never Adam's).
- Docs: SPEC.md = Overload Planner Extension spec (phases 1–2; it answers every gap G1–G15 raised against it). TASKS.md = its phase-1 plan (draft, 26 chunks in build order; no spec gap is open; the legacy "Do it now" backfill is part of chunk 24). Overload-v3-SPEC.md / TASKS-v3.md = the v3 spec / plan (shipped). Overload-v2-SPEC.md / TASKS-v2.md = v2 originals, still accurate for the shipped foundation. Code comments written before 2026-10-03 that cite "SPEC.md §n" / "TASKS.md §n" with no prefix mean the v3 files. AUDIT.md = Fable 5 audit (fixed and deferred). Each initiative has its own SPEC/TASKS pair with its own section numbering (COACH-ANALYSIS-*, COACH-WEEK-ANALYSIS-*, COACH-PERSONALIZATION-*, EXERCISE-LIBRARY-* (+PROVENANCE), QA-SIDEBAR-*, PRIORITY-CONTEXT-*); COACH-EXERCISE-TAGS.md is the approved tag list.
- File layout: CONTEXT.md is current state only, ≤ 75 KB, enforced by `scripts/check-context-size.mjs`; HISTORY.md is the prior CONTEXT.md verbatim plus everything moved out of this file later; DECISIONS.md holds settled decisions, and new entries use the format at its top.
- **Next migration number: 027.**
- Standing answers for this build (Adam, 2026-10-03; DECISIONS.md 30–32):
  - The reviewer may push any `build/chunk-N` branch, and opens a PR to master for each finished chunk; if the reviewer can't merge it, Adam merges it. A chunk with a migration still never merges before Adam has applied it.
  - Live checks are done by Adam (this container can't reach or sign in to the app). For each chunk whose verification needs the live app, the reviewer writes the exact steps and what Adam should see. A chunk with a migration: the steps go in its blocking entry, and Adam does them right after applying. A chunk without a migration: merge once every check the reviewer can run passes, write the live steps as a deferred entry, and continue with the next chunk that doesn't depend on it. A failed live check from Adam is blocking.
  - `verify-rls.mjs` still needs a go-ahead before every run.
  - Builders run on the `sonnet` model alias (accepted for this build). Builder effort can't be set from inside the session: the Agent tool has no effort parameter, and an agent definition (`~/.claude/agents/builder.md`: Sonnet 5, effort max) written mid-session wasn't loaded when chunk 1 started. It showed up as the agent type `builder` later in the same session, and whether its effort setting takes effect can't be confirmed from inside the session.
- Session start: read CONTEXT.md, then DECISIONS.md, then the SPEC/TASKS sections the task names; read HISTORY.md only to trace why something is the way it is.

### Open items and known issues (real, not started or unresolved; none is part of this build)
- **Mesocycle Analysis: Phases 1–6 are in the code** (migration 026, `analyze-meso.ts`, `mesoAnalysisInput.ts`, `coachMesoPrompt.ts` v2, Meso sub-tab; commits 2026-09-04 → 2026-09-12), but **no meso analysis has been generated yet: Vercel timeouts stop the generation** (Adam, 2026-09-29; the exact failure was not re-observed this session). No build-log entry for it exists in CONTEXT.md/HISTORY.md, and MESOCYCLE-ANALYSIS-SPEC.md / -TASKS.md are not in the repo — its lines under "What exists" come from code and commit messages only.
- **Newest app change:** add-exercise-mid-workout + planned-dropset ADD STAGE fix (`2b28fab`, 2026-09-13). Adam reported on 2026-10-03 that adding an exercise mid-workout works in the live app (his report; not re-checked by the reviewer).
- Reassignment (`reassign_exercise_history`) has never been run against Adam's real exercise history — first real merge needs its own go-ahead.
- Unconfirmed whether closed: the old log carried one Q&A check past 2026-09-02 — the in-session conversation through the workout sheet's own UI, which needs a real in-progress session.
- `ProgramPage.tsx` `handleStartMeso` has no try/catch or error UI; offline/failed meso creation fails silently (meso creation is online-only by design).
- `historyService.ts` `fetchHistoryDetail`/`deleteSession` rely on RLS alone (no `.eq('user_id')`); harmless while `sessionId` only comes from the user's own list — revisit if a session-id URL route is added.
- Daily analysis row `738a60a4-f108-4167-ae43-27268b22c0b4` (session `c111f9ac-…`, 2026-09-03, `PROMPT_VERSION 6`) reads a real swap as two unrelated facts and can never be corrected (permanent row).
- Planned-vs-forced swap wording: `swaps` carries no reason field, so the model can still word a forced swap as planned unless `sessionNotes` says why.
- Residual set-delete concurrency edges: post-cascade renumbering reads a render-time snapshot; `useLogSet`'s single `offlineTempIdRef` is shared across exercises.
- `rest_seconds` changes meaning when `measure_set_time` is on (true rest vs time since last log); AVG REST TIME charts show a step change, no marker yet.
- E4 (REDO lossy without warning); Q1 (hardcoded colours remain in History, Settings, Program builder, a few modal backdrops); A2 (no unique identity for a WeekPlanSet edited mid-session — improved, not closed); "set notes unwritable" half of M5 (`GymSession.tsx` hardcodes `note: null`).
- Backlog: warmup-sets handling (planned as Planner Extension phase-1 chunk 15); Settings rework with a Coach tab; tone calibration; AI equipment substitution; selective memory retrieval. Not planned: month analysis, live mid-workout energy/pump, swap-exercise mid-set.
- Standing risk: Overload, Northstar (and formerly Atlas) share one Supabase project and the `exercises` table; `exercises.source_library_id` is the first FK from it into a `v2_` table. Northstar's source isn't visible from here.

## Escalation criteria
Stop and report to Adam (do not route around, do not ask "should I continue without it") when:
1. **Live verification is required and browser tooling is unavailable.** Probe it before starting the build (`requestAnimationFrame` probe or a real navigation — never assume from a prior session). Same weight as a failing test. Only exception: Adam, in-session, told plainly what won't be verified, overrides it for that step.
2. **A query surfaces data that isn't Adam's.** That is a bug in the query: stop, don't investigate, don't record what it returned, narrow it, re-run.
3. **A login is needed** (Supabase dashboard, the app, SQL Editor). Adam signs in himself; passwords, tokens and session JWTs are never entered, typed, printed or recorded. If a tool or classifier refuses to return a token, stop and ask Adam (he once chose to reconstruct the payload from documented data instead); don't hunt for a workaround, and don't assume last session's extraction technique still works. Use the dry-run technique below, which never touches a token.
4. **A near-the-cap or anomalous measurement:** a Coach generation approaching the function cap (weekly: over ~35 s of 60 s; daily E1 was 14 s of 60 s; measure first, before anything else in that step), or an investigation turning up real corrupted data broader than known (2026-08-11: 11 of 23 sessions had implausible durations) — report, don't push over it.
5. **A found problem meets a deploy gate.** A brief that says "stop and report rather than ship over a problem" is not cleared by fixing it yourself; ask in-session before deploying.
6. **Anything irreversible or spending real money:** a real Anthropic generation that writes a permanent row (Adam chooses the session), a first reassignment against Adam's real exercise history, deleting or mutating real rows, any write to production for live testing (needs an explicit go-ahead first; the permission classifier may also block a delete — ask again rather than retry).
7. **A hash/length mismatch after applying a migration or function** = failed apply, not a curiosity.
8. **`node scripts/check-migration.mjs` exits 1 or 2:** don't merge; the merge is Adam's, with a blocking DECISIONS.md entry.
9. **Two documents disagree** (cross-references, migration numbers, spec vs shipped label): read the section fresh, report the conflict, don't pick a side silently. Same for a decision the spec leaves open — flag it, don't assume it.
10. **Data the check needs doesn't exist** (no second account, no real notes, no complete meso, no in-progress session): say so plainly. Never fabricate rows or substitute silently to force a run.
11. **Northstar data is ever in reach.** Standing rule for all of Overload: never read or write it.
12. Any migration scripts/check-migration flags. Every
   destructive one is flagged.
13. Any change beyond the chunk's stated scope in TASKS.md.
14. Anything SPEC.md is ambiguous or silent about.
15. A failed production database deploy after any merge.
16. Any change to Coach code (`src/features/coach/*`, `api/coach/*`), or to the existing exports of `referenceLogic.ts` or `setGroupLogic.ts`.
17. Any live check that writes (a throwaway program, run, session or set).
18. Any run of `scripts/verify-rls.mjs`.
19. Any UI that can't be built from the app's existing components and design tokens. Builders never invent a new visual language.

## Reviewer's own rules
- Verify against the real thing. A passing check proves only
  what it actually touched. If unreachable and passing produce
  the same signal, the check is wrong.
- Never fix before understanding the cause.
- Don't read code to check what a script can check. If no
  script covers it yet, write one — or verify manually and say
  that's what happened.
- Commit verification scripts to scripts/ and run all of them
  at every chunk boundary, not just this chunk's.
- Escalate with full reasoning, not a verdict and options.
- Never write an unconfirmed belief into this file as fact.
- Never merge a chunk with a migration. Write a blocking
  DECISIONS.md entry with the migration file and the
  check-migration result, and wait until I say it's applied.
  The migration goes live before the code that needs it.
- The shared scripts (check-migration, migration-rules,
  check-context-size) are never changed during a build. If a
  chunk changes one, revert that change before merging and say
  so in the chunk report.
- At every chunk boundary: update this file, move anything no
  longer true into HISTORY.md, then compact. Rules discovered
  during this build are never pruned — they don't stop being
  true.

## Checks that lied
Each of these gave a false result. Treat the check as insufficient on its own.
1. **"180 tests still pass" as proof a fetch-layer change was behaviour-neutral** (2026-08-20). The suite only covered the pure builder; nothing called `assembleAnalysisInput`. For any fetch-layer refactor, re-run the real function against real production data and compare to frozen `input_snapshot`s.
2. **Deep-compare reporting a mismatch that wasn't one:** Postgres `jsonb` does not preserve key order. Compare with recursively sorted keys.
3. **A clean migration apply / "Success" / "no error".** Migration 021's base64 paste lost 2 characters (a dropped `4pSA` group keeps base64 byte-aligned) and a pre-flight `getValue().length` mismatch (11234 vs 11236) went unread. Hash and length-check the applied text; confirm row counts by query, never by the Success banner.
4. **Supabase SQL Editor page text/screenshot:** `get_page_text` and screenshots lag and can show the previous query or an empty editor; the hidden textarea `.value` is only an IME window. Ground truth is `window.monaco.editor.getModels()[0].getValue()`.
5. **Browser `left_click` reporting success or timing out** without firing a click event (found 2026-08-25; also in mobile-viewport emulation). Verify resulting state; a programmatic `element.click()` via `javascript_tool` is a disclosed exception, not a substitute. Coordinate clicks landed on wrong elements. Computer-screenshot compositing can return stale frames.
6. **Testing a fix in a tab with a stale service worker** reproduced the old bug (false negative). After a deploy, update the registration and reload before testing; a "RELOAD" banner means the tab is on the old bundle.
7. **Grepping the client bundle for server-only code** (`PROMPT_VERSION`, prompts) is a category error — those modules are never in it. Verify server changes by construction, the deployed function list, or a real call.
8. **A successful push.** `ignoreCommand` compared `HEAD` to `HEAD^` and silently skipped a deploy whose last commit was docs-only (2026-08-31); it was replaced by a `$VERCEL_GIT_PREVIOUS_SHA` version, then on 2026-09-29 (Adam's instruction, because that version exceeded Vercel's 256-character limit) by the `HEAD^` form again, so the gap is live. Confirm a deploy landed at four levels: `vercel ls` (a real build, not a 2 s "Canceled" row), `vercel inspect` on the canonical alias (`Ready`, production), the function list, and a grep of the deployed bundle for new strings (and absence of old ones).
9. **typecheck + build + Vitest all green while every API call crashed:** Vite/Vitest bundler resolution tolerates extensionless relative imports; Vercel's Node ESM does not (`ERR_MODULE_NOT_FOUND`). Also a raw env var carrying an invisible character produced a 401 for a valid token. Only a real deploy + call finds these.
10. **A valid-looking multi-turn check that missed a first-turn bug:** Q&A turn 0 of every new conversation was generated, saved, paid for and never rendered (fetch raced the optimistic write). Every check that sent a second message passed. Static review can't see it; only a real call against the deployed endpoint did.
11. **Tests that pass under a broken implementation.** Phase 4's first Priority Context tests were decorative (asserted only on records rebuilt by a ternary). Prove a test by injecting the break it claims to catch.
12. **Data-modifying CTEs:** an `UPDATE` in a sibling CTE reported success and matched zero rows (single snapshot). RLS-blocked `UPDATE`/`DELETE` also returns zero rows and no error — that is the proof of permanence, not a failure.
13. **Supabase "creates a table without RLS" dialog on multi-CTE fixtures** is a linter false positive (no `CREATE TABLE`; `pg_class.relrowsecurity` true). Distinct from the real "Potential issue detected" destructive-query dialog — see rules.
14. **An unscoped query** returned another account's schedule and produced a wrong "expected sessions" figure; the conclusion had to be recomputed from Adam-scoped data.
15. **Reasoning from one consumer:** "skipped-head stage is not a data-integrity risk" was argued from `buildLoggedSlots` only; volume/set-count consumers were wrong. Audit every consumer of a rule before calling it harmless.
16. **A DDL read standing in for a baseline:** "the migration is purely additive" is exactly the claim that needs a live before/after count.
17. **Terminal-rendered or hand-retyped model output** looked truncated and failed `JSON.parse` because of the retyping, not the model (`stop_reason` was `end_turn`). Write the raw response to disk and parse it in the process that received it.
18. **Comparing a local `dist` bundle hash to the deployed one:** Vercel inlines its own `VITE_*` values, so the hashes legitimately differ. A mismatch is not evidence of a stale deploy.
19. **A desktop-width screenshot that looked fine:** the three Ask category labels wrapped raggedly at 375 px. Check mobile width on the real page.
20. **Editing source during a live browser test** triggers a Vite full reload that wipes page state and can look like an app bug.
21. **Hand-typed fixture dates** (2026-10-03): a scheduler scenario dated its "Friday" session 2026-09-26 (a Saturday) and left a Wednesday unhandled, so three scenarios returned `missed_sessions` the scheduler hadn't caused. Derive fixture dates from the weekday and print the queue, not just the result type.
22. **An injected failure that never fired** (2026-10-03): a CHECK added to force a mid-copy failure couldn't be created (existing rows violated it), so the "atomicity" run simply succeeded. Confirm the injected error's text appears before reading "nothing persisted" as proof; a `NOT VALID` constraint injects on new rows only.
23. **A preservation check on default values** (2026-10-03): an old-client upsert "left the new columns untouched" while they still held their defaults, which proves nothing. Set non-default values first.

## Rules discovered during this build
**Data and architecture**
- TanStack Query owns all Supabase data; Zustand owns UI state only. Never mix.
- All colours via `--accent` and other CSS custom properties; no hardcoded hex in components.
- `today` is never computed at module load; use state refreshed on `visibilitychange` and at midnight.
- Set logs: `weight` and `reps` are nullable (null when `is_skipped`).
- Meso week numbers are calendar weeks, Monday-anchored: `differenceInCalendarWeeks(date, mesoStartDate, { weekStartsOn: 1 }) + 1`, or `startOfWeek(date, { weekStartsOn: 1 })` for a window boundary. Never `differenceInWeeks`. Pass `weekStartsOn` explicitly.
- **Stage-exclusion:** a `v2_set_logs` row with `parent_set_id` (or `v2_week_plan_sets` with `parent_week_plan_set_id`) is a drop stage and is never an independent set — excluded from set counts, numbering, avg reps/RIR, top set, e1RM eligibility, planned-set lists. **Volume is the one exception (stages count).** Enforce via `setGroupLogic.ts` (`headsOnly`, `groupSetLogs`, `groupWeekPlanSets`, `canAddStageTo`, `isStageOfSkippedHead`) or the 009/011 views, never ad hoc. A stage of a skipped head contributes nothing. Orphan dropsets (`is_dropset` with null parent) render as independent heads.
- Dropset write paths pass the parent id directly from the tap (ADD STAGE); no inference anywhere except the 007 backfill and copy-week reconstruction (`copySetsWithGrouping`, which re-maps ids by group).
- Deleting a dropset head deletes stages first (descending), head last; ADD STAGE is disabled while a head is mid-delete; awaited deletes need `networkMode: 'always'` so offline rejects instead of hanging.
- e1RM: RIR-adjusted Epley (`reps + rir`); sets with null RIR are skipped, never defaulted to 0; a session with no RIR anywhere is excluded, not mixed in unadjusted; headline is a percentage, never an absolute weight.
- Weights are stored in kg. An edit whose displayed value is unchanged returns the original stored kg (`resolveEditedWeightKg`); a program exercise's unit is written as a resolved literal at creation.
- `EARLIER THIS WEEK` is the shipped label for the reference panel's secondary slot; SPEC/TASKS still say `THIS WEEK` (it collided with `PlanTargetsPanel`). Not a bug.
- Plan-view compact mode is page-local, not persisted.
- Permanent-record tables (`v2_coach_session_analyses`, `_week_analyses`, `_meso_analyses`, `_qa_exchanges`) have no update path. Prompt or tag changes are prospective only; a row generated under an old prompt/tag stays that way and is never "fixed". Exercise identity is denormalised into analysis JSON (no FK to `exercises`).
- New tables use the standard `for all using/with check (user_id = auth.uid())` RLS; deviations (select+insert only; read-only libraries) are deliberate and documented in the migration.
- Modules reachable from `api/**` take an injected `SupabaseClient` and must not value-import `src/lib/supabase.ts` (no `import.meta.env` in Node). Every relative import in that chain needs an explicit `.js` extension. Strip BOM/zero-width/non-ASCII characters from `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` before use.
- Coach endpoint order: verify JWT → user gate → return an existing row if present (idempotency) → validate/re-derive eligibility server-side (never trust the client) → assemble → model call → check `stop_reason` before parsing or saving (`max_tokens`/`refusal` → error, nothing written) → insert persisting `response.model`, the exact `input_snapshot`, `prompt_version` and tokens → return. Catch `23505` and return the winning row. A paid-but-unsaved generation returns its content in the error body and is logged.
- Pin dated model snapshots for Haiku (`claude-haiku-4-5-20251001`); Sonnet 5 is `claude-sonnet-5` with no suffix. Haiku 4.5 rejects `effort`. Sonnet thinking tokens count toward `max_tokens`. Bump the `*_PROMPT_VERSION` whenever a prompt changes.
- Coach is advisory only: no AI write access to anything; the model never picks a Q&A category (the originating screen does); no Northstar data.
- `COACH_USER_ID` and `VITE_COACH_USER_ID` must hold the same UUID; nothing enforces it — re-check by hand after any env change. Wrong server value → 403s; wrong client value → feature unreachable.
- A bare `select` from a table shared across accounts through any RLS-bypassing path must carry an explicit `user_id = <Adam>` filter — including one-off investigation queries.
- Mesocycle Analysis must be given the analysed meso's id, never the active meso's.
- Coach modules may read only `v2_` tables and `exercises` (id, name, tags — nothing else from it); the Q&A "advisory only / never touches user data" properties are kept true by shape (`assembleAppMechanicsContext` takes zero parameters; `QA_ROUTES` is `Object.freeze`d because it decides model and cost tier). `APP_MECHANICS_REFERENCE` is hand-written prose no test can catch drifting — update it whenever rating vocabularies, dropset behaviour, week numbering, or unit resolution change.
- Position-match convention: session A is the earlier/baseline side; `deltaPercent = (e1rmB − e1rmA) / e1rmA × 100`; the per-set eligibility gate there does *not* require `parentSetId == null` (a second stage is a legitimate comparison item), unlike the whole-session e1RM headline.
- Check UI at 375 px, not just desktop.
- Coach imports `referenceLogic.ts` (`resolveExerciseReference`, `resolveSecondaryReference`) and `setGroupLogic.ts`, and reads the plan through `program.schedule`, `v2_week_plan_sets` → `v2_program_exercises(exercise_id)` and `workout_day_id` equality. While Coach must stay unchanged, new behaviour in those areas goes in new functions; the existing exports stay byte-identical.
- Anything that starts a run (or ends the active one) runs in one transaction under a per-user advisory lock; the app's two-request complete-then-insert can leave two active runs.
- A new table the app reads or writes is added to `TABLES` in `scripts/verify-rls.mjs` in the same change; a table not listed there is not RLS-checked, and `verify-rls-tables.test.mjs` fails until it is. Only a deliberately world-readable catalog goes in `PUBLIC_BY_DESIGN`, with the migration that makes it so cited.

**Database / migrations**
- Before applying any migration, run and record a row count on **every table the file mentions** (target, FK, join), scoped to Adam's `user_id` where one exists — even when the DDL looks purely additive. Re-count after.
- Verify the applied text against the local file: `md5(prosrc)`/`length(prosrc)` for functions, equivalent for DDL; a per-line length diff localises a loss. Any migration/function body with a long repetitive run (box-drawing `───`, repeated punctuation) must be transported as plain text or with runs replaced by a marker and expanded in the browser, never a plain base64 paste; hash the reassembled text before running it. Compare `getValue().length` right after `setValue`. For this build: every hand-applied migration's blocking entry gives the transport file from `scripts/transport-collapse.mjs` and the snippet's expected `transport`/`expanded` lines, never a raw-file paste (entry 30's first version told Adam to paste raw 027, banners and all — caught by Adam 2026-10-04 before he applied it).
- Migrations are applied by hand (Supabase automatic deploys are off). Read and write the Supabase SQL Editor only through `window.monaco.editor.getModels()[0].getValue()/.setValue()` — no simulated typing, no keyboard select-all/clear (exactly one model per tab; `.focus()` the hidden textarea if focus is needed; open a fresh tab for a suspect editor). A destructive statement opens a "Potential issue detected" dialog: the toolbar Run only opens it; click the dialog's own "Run query" or the previous result stays on screen and looks like a silent no-op.
- Prove constraints by attempting to violate them (`23514`, `23503`, `23505`, zero rows written); prove `on delete set null`/cascade by really deleting a throwaway parent; prove read-only/append-only RLS through the anon-key client.
- Write fixtures as sequential statements (a `DO` block with local variables), never sibling data-modifying CTEs (single snapshot — a sibling's write is invisible to an `UPDATE`). Same rule is load-bearing in `021` step 2a, where a subquery must see pre-merge state.
- Throwaway data: label it (`TEST-…`, `ZZ_TEST_…`, "throwaway"), scope to Adam, delete in FK-safe order, and prove cleanup with `count(*)` against the baseline — not by the UI looking empty. Deleting a meso leaves its sessions behind (an orphaned `in_progress` one keeps being picked up as "the" session) — delete those too.
- Apply additive migrations before deploying code that writes the new columns (e.g. `measure_set_time` before `settingsService` sends it).
- Scratch copy for checking a migration: a local PostgreSQL cluster under `/var/lib/postgresql/` (a cluster inside the session scratchpad dies when the harness resets the scratchpad's permissions to root-only); the Supabase/v1 stand-ins (auth schema + `auth.uid()`, `anon`/`authenticated` roles with Supabase's default grants, v1's `exercises`) are written out in TASKS.md; 001–026 replay cleanly on PostgreSQL 16.
- Live schema probe that reads no data: `GET /rest/v1/<table>?select=<columns>&user_id=eq.<Adam>&limit=0` with the anon key answers `200 []` when every column exists and `400 / 42703` when one doesn't — always include a made-up-column control.
- Migrations 004–026 are numbered in `supabase/migrations`; TASKS-v3.md numbering was corrected once (008 reference index displaced the history-views slot) — trust the folder.

**Verification and process**
- Live browser verification against real data is a hard gate whenever a task calls for it (see Escalation 1). Live tests write only with an explicit go-ahead.
- Dry-run technique (no credential handling): from the dev-server tab, dynamic `import()` the real compiled modules and call them with the app's own already-authenticated `supabase` singleton. Throwaway scripts (`*.ts` at repo root) are deleted immediately, never committed, and `git status` is checked afterwards.
- Plain `vite` dev does not serve `api/**`: exercise endpoints on a deployed build or by invoking the handler directly with a minimal request/response. Do not grep for a deferred live check and call it verified — carry it forward by name.
- Adversarial review: independent reviewers per dimension, each finding independently re-verified against current source; report raw vs confirmed counts, fix confirmed bugs, keep refuted findings noted. Say which findings got adversarial verification and which were checked by hand.
- Read the actual current file/section before editing or citing it; check code instead of assuming ("confirmed, not assumed"). Report expected results as expectations until checked; report outcomes faithfully.
- Don't launch a background duplicate of a check that already ran inline; if one is in flight, stop it or account for it in the next message.
- Commit and push only when asked. At the end of every session, commit CONTEXT.md to the working branch — never to master. Isolate a standalone deploy from unrelated uncommitted work with `git stash push --keep-index` plus an isolated typecheck; split unrelated work into separate commits; byte-diff restored files rather than trusting a typecheck.
- A new rule discovered mid-build is written into this file's rules in the same session, not left only in a log.
- Builders commit to a `build/chunk-N` branch cut from the working branch, never to master; the reviewer pushes it (standing answer under Repo facts).
- The cloud environment's network policy denies `overload-v2-sage.vercel.app` (403 to CONNECT; Chromium `ERR_TUNNEL_CONNECTION_FAILED`, probed 2026-10-03); the Supabase host is reachable. Live-app checks can't run from this container (DECISIONS.md 31); Adam does the live checks.
- A fresh container has no `node_modules`: run `npm ci` before typecheck/test/build.
