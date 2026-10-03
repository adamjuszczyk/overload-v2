# Overload — Decisions

## Format for all new entries

```
## [n] [One-line summary]
Severity: blocking | deferred
Chunk: [n]
What happened: [the situation, with full reasoning]
A competent default would: [what anything competent would have
  just done here] — doesn't apply because: [why this is a real
  decision and not a default]
Cost of deferral: [what gets redone if the answer goes against
  the provisional path] — blocking entries: n/a
Answer: [mine]
```

Deferred is only allowed when the work can continue without committing to the answer. If continuing means guessing at something expensive to undo, it's blocking.

The entries D1–D28 further down predate this format and stay as they are; they use "Decided / Answer / Constrains".

Decisions Adam made in earlier builds that still constrain the code, each as an answered entry: what was decided, and the answer. Only ones that still apply are here; decisions that were superseded (the global priority table, the daily analysis ship-date placeholder, the phase-4 "wait for 10–20 notes" gate, migration renumbering) were left out. Source for each is the build log now in HISTORY.md (the session named in brackets), the spec Adam wrote, or a code/migration comment where no log exists.

Format of D1–D28: **Decided** — the question. **Answer** — what was chosen. **Constrains** — where it shows up.

## Training data model

**D1 · How is a dropset stored?** *(2026-08-05 review)*
**Answer:** Relationally — stages stay as linked rows in `v2_set_logs` (`parent_set_id` + `stage_index`) and `v2_week_plan_sets` (`parent_week_plan_set_id`); no child stage table. The cost is the stage-exclusion rule: a stage is never an independent set, except that volume counts it.
**Constrains:** every set count, numbering, average, e1RM and history view; `setGroupLogic.ts`; migrations 004/007/009/010/011.

**D2 · How is e1RM computed for the Progress headline?** *(2026-08-05 review)*
**Answer:** RIR-adjusted Epley; a set with no RIR is skipped (never treated as 0); a session with no RIR on any working set is excluded from the meso comparison rather than falling back to unadjusted (which would manufacture a gain). Some exercises therefore show no headline — accepted. The headline is a percentage only, never an absolute weight (SPEC §6).
**Constrains:** `e1rm.ts`, `progressService.ts`, `ExerciseProgress.tsx`, `positionMatch.ts` deltas.

**D3 · Does `is_warmup` ship now while warmup handling is deferred?** *(2026-08-05)*
**Answer:** Yes — the column shipped in migration 006 on both `v2_week_plan_sets` and `v2_set_logs`; Adam did not object and it is treated as settled. Warmup-set handling itself is still deferred.

**D4 · Weight unit model?** *(Phase 3.6)*
**Answer:** Weights are stored in kg. Each program exercise can override the unit (INHERIT/KG/LBS), written as a resolved literal at creation; a logging-time toggle exists; Progress and History convert to the global Settings unit only (SPEC §8.1), the gym screen to the exercise's own unit.
**Constrains:** `weightUnit.ts`, `useWeightDisplay`, `SetRow`, `WorkoutDayEditorPage`.

**D5 · Does set timing change the default rest timer?** *(Phase 3.2)*
**Answer:** No. Start Set / `set_seconds` is opt-in via the `measure_set_time` Settings toggle (global, default off); off leaves rest including set-performance time exactly as before. Historical `rest_seconds` cannot be backfilled.

**D6 · Plan view shape?** *(Phase 3.7)*
**Answer:** A workout-day switcher (chip row) replaces scroll-through-everything; copy is split into whole-week and single-workout; a compact view collapses consecutive plain sets but always shows a dropset as its own entry in true order; compact mode is page-local, not a Setting.

**D7 · Meso weeks?** *(2026-07-11)*
**Answer:** Calendar weeks, Monday-anchored, flipping on Monday rather than on the meso's start weekday.

**D8 · Swap exercise scope?** *(2026-08-27, 2026-09-03)*
**Answer:** A swap applies to one session only, never the template. It is recorded structurally (`v2_session_exercise_swaps`, one row per swap event) so Coach can read it as one substitution. It deliberately carries no reason/cause field; the model must not guess why. Swap-exercise *mid-set* is not planned.

## Coach — shared

**D9 · Who can see Coach, and what may it do?** *(2026-08-18 and later)*
**Answer:** Coach is gated to Adam's account: server `COACH_USER_ID` is authoritative, client `VITE_COACH_USER_ID` is cosmetic, both hold the same UUID. Every Coach surface is advisory only — no AI write access to any data. Northstar data is never read or written by any Overload code (standing, all of Overload).

**D10 · Model and snapshot policy?** *(2026-08-18 review; later specs)*
**Answer:** Haiku surfaces pin the dated snapshot `claude-haiku-4-5-20251001` (not the alias) and store `response.model`, not the request constant. Sonnet 5 (`claude-sonnet-5`, no date suffix) is used where chosen deliberately: Mesocycle Analysis and the Q&A planning category. Every analysis row stores `input_snapshot` (shipped in migration 012, not deferred), `model`, `prompt_version` and token counts.

**D11 · Analyses are permanent.** *(2026-08-18)*
**Answer:** One permanent, non-regenerable row per subject (unique index), no update path, so prompt or tag changes apply only to analyses generated afterwards. The daily table cascades from its session (a flagged exception to "permanent"); the weekly table has no FK and no cascade. A paid-but-unsaved generation is an accepted risk mitigated by returning the content in the error and logging it, not by a pending-row state machine.

**D12 · Voice.** *(2026-08-31)*
**Answer:** Coach output reads as a chill but knowledgeable coach — direct "you", dry humour where it fits — without relaxing the two hard requirements in the prompts. Tone calibration beyond that is bundled with the planned/forced-wording fix and the Settings rework, not scheduled.

## Coach — Daily and Weekly

**D13 · Daily analysis ship cutoff.** *(2026-08-18)*
**Answer:** Only sessions completed after `COACH_ANALYSIS_START_DATE = 2026-08-16T22:00:00Z` (midnight Monday 2026-08-17, Poland time) get analyses; the cutoff filters on `completed_at`.

**D14 · Context-log semantics.** *(2026-08-18 review)*
**Answer:** A phase entry's end is implicit (the next entry's start); one entry per start date. A weekly-average weight entry is stored under its week's Monday; a manual weekly average wins over dailies for that week; phase/weight context resolves as of the session's date, not today; weight display is kg only; warmups are excluded from analysis input.

**D15 · When is a week analyzable?** *(2026-08-19/20)*
**Answer:** By plan resolution derived from `program.schedule` (not `v2_week_plans`), and an `in_progress` session does not count as resolved. A blended per-muscle-group metric is rejected outright, not deferred: the week payload regroups per-exercise facts by tag and reports them unblended.
**Constrains:** `weekResolution.ts`, `weekBuckets.ts`, `analyze-week.ts`.

**D16 · Exercise tags.** *(2026-08-20)*
**Answer:** `COACH-EXERCISE-TAGS.md` was approved as proposed, including every ⚠ row; Face Pull and Upright Row are `isolation`. Tag columns live on the shared `exercises` row with no default and no `not null`.

## Coach — Personalization

**D17 · What is gated?** *(2026-08-24 spec §7)*
**Answer:** Form rating (per set), energy and pump (per session) are ungated training data like RIR. The in-workout notes/ask sidebar is the single new gated surface.

**D18 · Rating storage.** *(2026-08-24/25)*
**Answer:** `text` + `CHECK` vocabularies (form: rushed/normal/controlled/extra_controlled; energy: none/low/normal/high/supreme; pump: none/some/good/extreme), with `'none'` (rated) distinct from `NULL` (unrated). Energy/pump are columns on `v2_sessions`. A segmented chip row substitutes for the spec's slider.

**D19 · Notes and Memory.** *(2026-08-25)*
**Answer:** A note outlives its session (`on delete set null`). Notes queue offline; reading them is online-only. Coach Memory is AI-curated from notes by a manual UPDATE MEMORY action (third serverless function), with a provenance table for each curation run.

## Exercise Library

**D20 · Library model.** *(2026-08-28)*
**Answer:** Multiple curated global libraries (preview / download / delete each), read-only in the database with no write policy. Exercises have a three-state lifecycle (active / lost / gone); deleting one with real history moves it to Lost Exercises. The existing 70 exercises got retroactive provenance: 46 legacy-default, 24 hand-added (approved via EXERCISE-LIBRARY-PROVENANCE.md).

**D21 · Reassignment (the four §11 questions).** *(2026-08-28, all approved as proposed)*
**Answer:** (1) Confirmation is type-the-target-name. (2) Every reassignment writes a `v2_exercise_reassignments` audit row (migration 022, applied before 021). (3) `is_archived` and `status` stay orthogonal — no consolidation in v1. (4) Restore-from-Lost ships in v1. Reassignment must not be run on Adam's real history without his explicit go-ahead.

## Q&A Sidebar

**D22 · Scope and boundaries.** *(2026-09-01 spec)*
**Answer:** Conversational and advisory only. Ruled out rather than deferred: any write access, any Northstar data, a dedicated review UI, a tone/settings toggle. Four categories (in_session, general, planning, app_mechanics) chosen by the originating screen, never inferred by the model; Haiku for all but planning (Sonnet 5). Every exchange is logged permanently with its context snapshot, grouped by a client-minted conversation id.

**D23 · Q&A storage and cost (the §12 questions).** *(2026-09-01)*
**Answer:** RLS is `select` + `insert` only — no update/delete policy at all, Adam's explicit choice over the `for all` convention. `session_id` is `on delete set null`. Memory proposals are deferred to v1.1 (v1 answers only). `app_mechanics` ships in v1. One shared `QaPanel` for both entry points. `HISTORY_TURN_CAP = 4` as the starting point; conversations cap at 20 turns.

## Priority Context and Mesocycle Analysis

**D24 · Priority Context scope.** *(2026-09-02, Adam changed direction)*
**Answer:** Priority (top/high/normal/low) is set by hand per mesocycle, per muscle_group (12) and per muscle_subgroup (22), and lives in the planner (`/meso/:id/priorities`), not Coach → CONTEXT. muscle_group priority is a ceiling; subgroup priority is relative emphasis within it, never a cross-group ranking. A new meso starts blank (no row = normal) plus an explicit one-tap COPY FROM previous meso, offered only into an empty destination, "previous" ordered by `start_date`. Priorities page is online-only like meso creation. No AI writes, no inference from volume.
**Constrains:** `priorityTags.ts` (`PRIORITY_TREE` supplies the group→subgroup partition that did not exist), `priorityContext.ts`, migration 024. PRIORITY-CONTEXT-SPEC.md was edited from this side at Adam's instruction.

**D25 · Mesocycle Analysis.** *(2026-09-02 spec; 2026-09-04 review; 2026-09-05 measurements)*
**Answer:** Rare, deep, manually triggered, one permanent non-regenerable record per completed meso, advisory only, Sonnet 5 by deliberate choice. It reads Priority Context for the analysed meso (fallback if absent: treat everything as normal, don't block). The analysis survives its meso's deletion (`mesocycle_id` nullable, `on delete set null`, identity denormalised) — reversed at review from an initial cascade. `effort` high and `max_tokens` 32,000 were chosen from measured output on the real MESO 1.0 payload. Source: migration 026 and `analyze-meso.ts` comments — the spec and tasks files are not in the repo.

## Not planned

**D26 · Out of scope.** Month analysis; live mid-workout energy/pump; swap-exercise mid-set. Deprioritised, not dropped: selective memory retrieval (once the memory list is large), AI equipment substitution (with the plan creator), warmup-sets handling, Settings rework with a Coach tab.

## Process

**D27 · Migrations Adam merges himself.** *(scripts, 2026-09-29)*
**Answer:** A migration whose statements are not all on the safe list in `scripts/migration-rules.mjs` (changes that cannot alter or remove existing data) is not merged by the build; `node scripts/check-migration.mjs` exits 1 (or 2 if it could not check), and the merge is Adam's, with a blocking entry here.

**D28 · Docs-only pushes don't deploy.** *(2026-08-15)*
**Answer:** `vercel.json` `ignoreCommand` skips the production build when a push changes only `.md` files. Currently `git diff --quiet HEAD^ HEAD -- . ':(exclude)*.md'` (set 2026-09-29; the longer per-file, last-deployed-SHA version exceeded Vercel's 256-character limit).

## 29 The two exercise-library tables are readable by everyone, anon included
Severity: deferred
Chunk: verify-rls (2026-10-01)
What happened: `scripts/verify-rls.mjs` expects zero rows from every table for both the anon key and a signed-in account that owns no data. `v2_exercise_libraries` and `v2_exercise_library_items` break that expectation by design: migration 019 gives each a `for select using (true)` policy with no `user_id` column and no `to` clause, so any role, anon included, can read them, and once the catalogs hold content a strict zero-rows rule would fail on every run. The first real run on 2026-10-01 confirmed it: anon read 1 row from `v2_exercise_libraries`. PR #5 asked whether anon being able to read them is intended, and whether they should stay in `PUBLIC_BY_DESIGN` (rows pass, any other error still fails, both probes still run) or be made strict or dropped from the list.
A competent default would: keep the strict zero-rows rule for every table and treat world-readable rows as a leak — doesn't apply because: this is a deliberate exposure of shared curated content, and whether anon may read it is a product decision, not something the script can infer.
Cost of deferral: n/a (answered)
Answer: given in-session on 2026-10-01 by the person running the build: both tables stay in `PUBLIC_BY_DESIGN`. They are intentionally readable by everyone, including anon, because they hold shared content (curated exercise libraries, no per-user data). Writes stay closed: there is no write policy. Any other table returning rows to anon or to the signed-in test account is still a LEAK.

## 30 Migration 027 (planner phase-1 schema) needs applying by hand before chunk 1 can close
Severity: blocking
Chunk: 1
What happened: Chunk 1's builder wrote `supabase/migrations/027_planner_p1_schema.sql` and nothing else (commit `273b07d` on the local branch `build/chunk-1`; md5 `6828eea01febab618e389bab89a51d5a`, 18232 bytes, 325 lines). Repo facts say migrations are applied by hand in the SQL Editor, and Escalations 8 and 12 apply, so the chunk is not merged.
`node scripts/check-migration.mjs origin/master` exits **1**, flagging 8 statements. These are the 7 TASKS.md predicted from R4 plus the `notify`:
- 3× "new column carries a constraint or generated value": the ALTERs on `v2_programs` (`kind`/`schedule_type`/`planning_type` CHECKs), `v2_set_logs` (`stage_kind` CHECK) and `v2_user_settings` (`warmup_display`/`week_start` CHECKs). Every existing row takes a default or NULL that satisfies them.
- 4× "foreign key action can change existing rows later": `on delete set null` on the new columns `v2_workout_days.source_workout_day_id`, `v2_mesocycles.source_program_id`, `v2_program_exercises.superset_block_id` and `v2_week_plan_sets.program_set_id`. Each is NULL on every existing row, so the action can only ever touch rows written by later chunks.
- 1× "not on the safe list": `notify pgrst, 'reload schema'`, which only reloads PostgREST's schema cache.
None of the 8 can alter existing data. All six new tables and the `v2_week_plans` / `v2_sessions` ALTERs pass the classifier.
What I verified myself, on a fresh copy of the builder's scratch baseline (PostgreSQL 16.14 with 001–026 and fixtures), applying the committed text:
- Catalog diff before/after: exactly the tables and columns in TASKS.md's data model, nothing extra. No existing column, constraint, index or policy removed or changed. Every new table has RLS on and the standard `for all … user_id = auth.uid()` policy. FK actions are as specified. `target_weight` is `numeric(6,2)`.
- Row count and md5 fingerprint over the pre-027 columns are identical on all nine altered tables. Existing programs read `saved | weekday | week_dependent`, and settings read `rows | copy`.
- The old client's settings upsert was run after setting non-default `warmup_display`, `week_start` and `deload_rules`. All three were left untouched.
- RLS on a new table: A sees its 1 row. B sees 0 and updates 0. B inserting a row stamped with A's id is refused by the RLS policy. Anon sees 0.
- Probes: a 10–8 range, AMRAP with reps, a staged warmup, a `'top'` mark and `week_start='blank'` are each rejected with their named CHECK. An 8–12 range is accepted.
The builder's own R1–R3 (73 constraint probes, its harness proven by dropping two constraints) agree.
`npm run typecheck`, `npm test` (548/548), `npm run build`, `node --test "scripts/*.test.mjs"` (31/31), `check-context-size` and `gen-icons` (icons regenerated byte-identical) all pass on `build/chunk-1`.
Live, before you apply (in the SQL Editor):
- Run `select '<t>', count(*) from <t> where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'` for each of `v2_programs`, `v2_workout_days`, `v2_mesocycles`, `v2_program_exercises`, `v2_week_plans`, `v2_week_plan_sets`, `v2_sessions`, `v2_set_logs` and `v2_user_settings`.
- Check that the pasted editor text is 18232 characters with md5 `6828eea0…`.
After you apply: the same counts again (all must be equal). I then run the read-only API column probes (Adam-filtered, `limit=0`, made-up-column control) once you say it's applied.
Open from the builder, for you to decide before applying, because it's cheaper now than as a later flagged migration: `stage_kind` on `v2_week_plan_sets` and `v2_set_logs` is vocabulary-checked only. Nothing in the DB stops a stage row carrying a kind (the data model says "heads only" there but lists explicit checks only for program sets). Provisional: leave it to app code, as the file does now.
Also: `build/chunk-1` exists only in this container. I may push only `claude/epic-lovelace-0pvxbr`, so to get the file to you and keep it safe if the container is reclaimed, I need your permission to push `build/chunk-1` to origin. Without it, I'll keep it unmerged and local.
A competent default would: merge the chunk once its checks pass — doesn't apply because: the migration is applied by hand, check-migration exits 1, and the reviewer's rules say the migration goes live before any code and the merge is yours.
Cost of deferral: n/a
Answer:

## 31 Live browser verification is unavailable in this environment
Severity: blocking
Chunk: 1
What happened: Escalation 1 says to probe the browser tooling before the build. Headless Chromium (Playwright) launches here, but navigation to `https://overload-v2-sage.vercel.app/` fails with `ERR_TUNNEL_CONNECTION_FAILED`, and `curl` gets a 403 on CONNECT: the cloud environment's network policy denies that host. The Supabase host is reachable. There is also no way for you to sign in to a browser inside this container (Escalation 3). Chunk 1's live gate ("the deployed app (unchanged code) loads Today, Plan, Program and History, and the next set you log in a real session saves normally") therefore can't be run by me. Later chunks with UI gates will hit the same wall.
A competent default would: skip the browser step and rely on the scratch and API checks — doesn't apply because: Escalation 1 gives this the weight of a failing test, and only you can say plainly what won't be verified.
Cost of deferral: n/a
Answer:

## 32 Go-ahead to run scripts/verify-rls.mjs at the chunk 1 boundary
Severity: blocking
Chunk: 1
What happened: The boundary rule is to run every script in `scripts/`, but Escalation 18 makes any run of `verify-rls.mjs` an escalation, because its selects are unfiltered by design (anon plus the no-data test account). Its four env vars are set here. Chunk 1 adds nothing to `TABLES` (the new tables join with their first code user), so the run would re-check today's 25 tables, plus a one-off anon `limit=0` read of the six new tables, which is the chunk's own "zero rows to the anon key" check.
A competent default would: run it, since it is read-only — doesn't apply because: the rule asks for a go-ahead before each run.
Cost of deferral: n/a
Answer:
