# Overload — Decisions

## Waiting on Adam
*Rewritten at every chunk boundary. Last: 2026-10-05 18:25 UTC — the hold is lifted for 40 and 41: Adam merges in order, the reviewer confirms each deploy green before the next merge. Chunk 8 being changed for 42 (b).*

**Decisions**
- 41 — 029 (#24, `61b2670`) and the chunk 7 code (#25, `55bed82`, Vercel success 18:42 UTC) are live. Next: merge 030 (#26; ready, CI green), then your parity query (expect 0 rows) and app check (entry 41 steps 3–4).
- 45 — Merge migration 031 (#27), then the chunk 8 code (#28). Recommendation: after 41, each when I say the previous deploy is green. Blocked: chunk 8 going live.

**To-dos**
- 39 — Chunk 5 live check: one SQL count (expect 0), then two or three workouts' all-time history pages unchanged. When: next session. Blocked: nothing (a failure blocks the next merge).


## Format for all new entries

An open entry starts with the ask; the reasoning comes after it, under "Evidence".

```
### [n] [One-line summary]
Severity: blocking | deferred
Chunk: [n]
**Ask:** [the question or task, in plain words]
**Options:** [each option, one line] — decisions only
**Recommendation:** [mine, and why in one line] — decisions only
**When:** [e.g. next session] — to-dos only
**Blocked until answered/done:** [what stops]
**Answer:** [Adam's]
**Evidence:**
What happened: [the situation, with full reasoning]
A competent default would: [what anything competent would have
  just done here] — doesn't apply because: [why this is a real
  decision and not a default]
Cost of deferral: [what gets redone if the answer goes against
  the provisional path] — blocking entries: n/a
```

Deferred is only allowed when the work can continue without committing to the answer. If continuing means guessing at something expensive to undo, it's blocking.

When an entry is answered or done, it shrinks to three lines (what, answer, date) under "Closed", and its full text moves to HISTORY.md. Superseded procedures go straight to HISTORY.md, never kept inline. The "Waiting on Adam" section is rewritten at every chunk boundary; if both lists are empty it says "Nothing."

## Open

### 45 Merge migration 031 (weeks plan themselves) and the chunk 8 code
Severity: blocking
Chunk: 8
**Ask:** After 41 is done (029, #25 and 030 live), merge PR #27 (migration 031). Then, once its deploy succeeds, merge PR #28 (chunk 8 code). `check-migration` flags 031, so the merge is yours. It adds one function and changes no data, so no counts are needed.
**Options:** (a) merge #27 → #28 in that order, each when I say its predecessor's deploy is green; (b) hold.
**Recommendation:** (a). 42 (b) is built and verified (Evidence).
**Blocked until answered:** chunk 8 going live. Chunks 9 and 10 can be built meanwhile once you say so.
**Steps:**
1. When I say 030's deploy is green, merge #27. Before that I merge master into its branch, re-run every check, and wait for its own CI.
2. I check the deploy and probe `v2_plan_week` live: an anonymous call must be refused before it writes anything.
3. Merge #28 when I say. After its deploy, in the app (take the update banner):
   - opening Plan on a week not yet planned plans it once, and reopening adds nothing;
   - your first session of a new week plans that week;
   - Settings → NEW WEEK STARTS = EMPTY gives empty weeks, with COPY offered;
   - a deload session isn't copied into the next week.
**Answer:**
**Evidence:**
What happened: chunk 8 was built and verified, then changed for 42 (b) on `2d26e90` (031, md5 `214fd8706ee049a00a9a1807b776b438`) and `95651e3` (code). Reviewer's own checks on `95651e3`:
- typecheck; 738 tests; build; 96 script tests; frozen code; replay 32/32; embeds 25/25.
- Removing the empty skip fails 14 tests; restored, md5 matched.
- Independent scratch fixture, three workouts with weeks 1–3, then `v2_plan_week(meso, 4)` as the user:
  - the new 031 copies week 2 past an empty week 3 (105), and week 1 past deload plus empty (50);
  - all-empty stays empty; re-planning adds 0;
  - the old 031 gives all three empty, so the fixture tells the two versions apart.
A competent default would: merge a green, function-only migration — doesn't apply because: check-migration flags it (Escalations 8, 12).
Cost of deferral: n/a (blocking).


### 41 Merge migration 029 (each week plan's exercise list), the chunk 7 code, and a follow-up 030 that re-runs the backfill
Severity: blocking
Chunk: 7
**Ask:** After 40 is done (028 and chunk 6's code live), merge PR #24 (migration 029), then PR #25 (chunk 7 code) once 029's deploy succeeds, then the follow-up migration 030 once #25 has deployed. `check-migration` flags 029 and 030, so those merges are yours. Both only insert rows, so no live counts are needed (your rule).
**Options:**
- (a) merge 029 → #25 → 030 in that order (recommended);
- (b) skip 030 and instead run 029's backfill block once by hand after #25 deploys — but CONTEXT says never apply migration SQL by hand under automatic deploys;
- (c) skip the re-run and avoid ADD SET / COPY WEEK between 029's deploy and #25's.
**Recommendation:** (a). 030 is a no-op if nothing was missed, and it catches any week plan the old app created in the gap: such a plan has no exercise rows, and the new screens would show it empty. Provisional: 030 is PR #26 (`build/chunk-7-rerun`, stacked on `build/chunk-7`; md5 `47fae288…`; its block is 029's plus a counter; gap scenario proven: inserts exactly the missing rows, then 0). If you pick (b) or (c), it's dropped.
**Blocked until answered:** chunk 7 going live. Chunks 8+ keep stacking.
**Steps:**
1. Merge #24 (029) and tell me. I check every `Supabase Preview` run on the merge commit, probe the new manifest table live, and run `check-embeds.mjs` live.
2. Merge #25 (chunk 7 code), or tell me to. Then merge 030's PR and tell me; I check its deploy.
3. In the SQL Editor, the parity query (0 rows means every week plan's own list equals the workout's exercises, which is how today's screens build it):
   ```sql
   with old_way as (select wp.id as week_plan_id, array_agg(pe.id order by pe.position) as exercise_ids from v2_week_plans wp join v2_program_exercises pe on pe.workout_day_id = wp.workout_day_id where wp.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' group by wp.id),
        new_way as (select wp.id as week_plan_id, array_agg(wpe.program_exercise_id order by wpe.position) as exercise_ids from v2_week_plans wp join v2_week_plan_exercises wpe on wpe.week_plan_id = wp.id where wp.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' group by wp.id)
   select coalesce(o.week_plan_id, n.week_plan_id), o.exercise_ids, n.exercise_ids from old_way o full outer join new_way n on n.week_plan_id = o.week_plan_id where o.exercise_ids is distinct from n.exercise_ids;
   ```
   → **0 rows**.
4. In the app (take the update banner): Plan and the workout screen show exactly the exercises they did before, in the same order. Open a session offline once it's cached; it shows the same list.
**Answer:**
**Evidence:**
What happened: chunk 7 is built and verified. PR #24 is 029 only (md5 `98925a7d05ac8fd2a6e2b23eeaf63c8a`), and PR #25 is the code. Both are stacked on chunk 6, and nothing is merged.
`check-migration` exits 1. 029's entries are the backfill `do $$ … $$` block (it inserts into `v2_week_plan_exercises` and records inserted ids in the new `v2_week_plan_exercises_backfill_manifest`) and `notify pgrst`.
My own scratch check (`supabase/postgres:17.6.1.155`, 000–028 plus the chunk 6 fixture, then 029):
- 0 existing rows changed or lost (column-level);
- backfilled 8 = expected 8;
- 0 planned sets without their exercise row;
- 0 parity differences;
- re-running the backfill inserts 0.
The builder also proved: RLS on the manifest per user; the parity query fails when one exercise row is deleted; and render parity of PlanPage and GymSession against frozen chunk 6 renders, using a decoy on the old path so a regression is visible.
All checks pass on the branch:
- typecheck; 680 tests; build;
- 94 script tests;
- `replay-migrations.sh` 30/30;
- `check-embeds-local.sh` 24/24 (incl. 6 new embeds, hinted because `v2_week_plan_exercises` has two FKs to `v2_program_exercises`);
- `check-frozen-code`.
The gap 030 closes: the screens use `weekPlan.exercises`, which is an empty list (not null) for a week plan without rows, so they don't fall back to the program's exercises.
A competent default would: merge a green, insert-only migration — doesn't apply because: check-migration flags it (Escalations 8, 12), and the re-run vehicle under automatic deploys is your call.
Cost of deferral: n/a (blocking).


### 39 Chunk 5 live check: "Session type, all time" unchanged on today's data (Adam's steps)
Severity: deferred
Chunk: 5
**Ask:** Chunk 5 live check — "Session type, all time" unchanged on today's data. Do the steps below and tell me the results. A failed step is blocking.
**When:** your next session (Adam, 2026-10-04).
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (after PR #19's production deploy; take the update banner):
1. In the SQL Editor, confirm no lineage exists yet:
   `select count(*) from v2_workout_days where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and source_workout_day_id is not null;` → **0**.
2. In the app, open a workout's "session type, all time" history (History → a session → its workout's all-time view, `/session-type/<id>`) for two or three of your workouts. Each lists the same sessions it did before, the same count and the same latest dates, and LOAD MORE still pages.
3. Tell me the results. A failure is blocking.
**Answer:**
**Evidence:**
What happened: Chunk 5 (PR #19) makes a workout's all-time history query its lineage group: the root workout plus every run copy whose `source_workout_day_id` leads to it. No app code writes that column yet, so on your data every group is the workout alone, and the page must show exactly what it showed before. TASKS.md's done-when is "deployed and identical on today's data". Every check I can run passed (tests proven by breaks; a scratch replay with a copy chain returned one combined history and excluded an unrelated workout). The live page needs you.
A competent default would: count the scratch result as proof — doesn't apply because: TASKS.md asks for identical results on your real data, and only your session can read them.
Cost of deferral: if it fails, chunk 5 is reverted or fixed before chunk 6 starts copying workouts.
Provisional path taken: merge once green; chunk 6 waits on its own blocking entries anyway (it has a migration that changes existing data).

## Closed

### 29 The two exercise-library tables are readable by everyone, anon included
- What: The two exercise-library tables (`v2_exercise_libraries`, `_items`) are readable by everyone, anon included — stay in `verify-rls.mjs` `PUBLIC_BY_DESIGN`?
- Answer: Yes: intentional, they hold shared curated content; writes stay closed; any other table returning rows is a LEAK.
- Date: 2026-10-01

### 30 Migration 027 (planner phase-1 schema): how it goes live
- What: How migration 027 (planner phase-1 schema) goes live.
- Answer: Amended to bar `stage_kind` on stage rows; then, after the switch to automatic migrations, live by merging PR #17 (Adam, `7f4405d`). Add-only, so no live counts (Adam's standing rule).
- Date: 2026-10-03 / 2026-10-04

### 31 Live browser verification is unavailable in this environment
- What: Live browser verification is unavailable from the build container.
- Answer: Adam does the live checks; the reviewer writes exact steps (migration chunks: once the migration is live; others: merge, then a deferred to-do). A failed live check is blocking. Standing (CONTEXT.md Repo facts).
- Date: 2026-10-03

### 32 Go-ahead to run scripts/verify-rls.mjs at the chunk 1 boundary
- What: Go-ahead to run `scripts/verify-rls.mjs` at the chunk 1 boundary.
- Answer: Yes, run then (25 tables, 50 probes, all pass); ask again before every run.
- Date: 2026-10-03

### 33 The weight deload rule's starting percentage is not specified
- What: Starting percentage of the weight deload rule (SPEC silent).
- Answer: 75%. Done: PR #21 (`0628f28`).
- Date: 2026-10-04

### 34 Input casing for tempo "X" and rep target "AMRAP"
- What: Lowercase tempo `x` / rep target `amrap` input.
- Answer: Accept lowercase and normalise to `X` / `AMRAP`. Done: PR #21 (`0628f28`).
- Date: 2026-10-04

### 38 Incident: 027 made the mesocycle query ambiguous; no mesocycles showed (fixed by PR #18)
- What: Incident: 027's second `v2_mesocycles → v2_programs` FK made the mesocycle embed ambiguous (fixed by PR #18); run `check-embeds-local.sh` in the `migration-replay` workflow?
- Answer: Yes, add it to the workflow. Done: PR #20 (`b427dc0`); first GitHub run resolved 25/25.
- Date: 2026-10-04

### 35 Chunk 3 live check: planned dropset stages in a real session
- What: Planned dropset stages show LOCKED rows and unlock one by one in a real session.
- Answer: Checked by Adam in a real gym session: works. No screenshots or SQL, by his choice. **Passed.**
- Date: 2026-10-05

### 36 Chunk 4 live check: editing a logged set has no note field and keeps stored notes
- What: Live check of the logged-set edit form (no note field; stored notes unchanged).
- Answer: Not checked. **Waived by Adam, not passed.**
- Date: 2026-10-05

### 37 Chunk 1 live check after 027 deployed
- What: 027's deploy log and the app's main screens on the new schema.
- Answer: Today, Plan, Program and History load normally, and logging worked through a whole session (Adam's gym session). Deploy-log step dropped by Adam; the two stuck `Supabase Preview` runs stay unexplained, and the live probe (36/36) stands as 027's deploy evidence. **Passed** (app steps).
- Date: 2026-10-05

### 42 Does an empty week count as "the last planned week" when a new week copies forward?
- What: Should a workout's empty (non-deload) last occurrence be a copy source for a new week?
- Answer: (b) skip an empty last occurrence, the same as deload. Done on `2d26e90` (031, md5 `214fd870…`) and `95651e3`; reviewer-verified; merge is entry 45.
- Date: 2026-10-05

### 43 G14 reappeared: one workout on several weekdays (Adam's second account)
- What: L6 only checked Adam's main account; his second account has a program with one workout on every weekday, and planning one day's volume shows on all of them (one shared plan row).
- Answer: Existing such programs keep today's behaviour until edited. Opening one in the planner asks to give each weekday its own workout or switch to a sequence; nothing is converted automatically. Deload on a shared row marks every day it covers, as today, and the UI says so. Added to TASKS.md chunks 11 and 21. Chunks 6–8 checked on scratch: no change (entry 40 Evidence). Follow-up question: 44.
- Date: 2026-10-05

### 44 What does the planner's "switch to a sequence" choice do before sequence runs exist?
- What: The G14 prompt offers "switch to a sequence", but sequence runs arrive in chunk 25, after the planner (chunk 11).
- Answer: (a) chunk 11 offers per-weekday workouts or keep-as-is; chunk 25 adds the sequence choice to the same prompt.
- Date: 2026-10-05

### 40 Merge migration 028 (runs own a copy of their program; transition of existing programs)
- What: Merge 028 (#22) and the chunk 6 code (#23); existing programs become their runs' copies with saved clones.
- Answer: Merged by Adam without backup or counts (028's manifest is the rollback). 028 live `71247e7` (probe 3/3, `v2_start_run` refuses anon), #23 live `9fd4876` (Vercel success). Adam's app checks passed. G14 checked: no change.
- Date: 2026-10-05

## Settled decisions

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
