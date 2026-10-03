# TASKS.md — Overload Planner Extension, phase 1

**Spec:** SPEC.md (Overload Planner Extension). This file plans the **[P1]** items only. Every [P2] item is out of scope; where a P1 chunk touches something phase 2 extends, the chunk stops at the P1 edge and says so.
**Status:** draft, written 2026-10-03 in a planning-only session — no application code was written. A chunk does not start while a spec gap that blocks it is open.
**Predecessors:** TASKS-v3.md (the v3 plan, shipped) and TASKS-v2.md. Code comments written before 2026-10-03 that cite "TASKS.md §n" or "SPEC.md §n" with no prefix mean TASKS-v3.md / Overload-v3-SPEC.md.
**Baseline when this was written:** migrations 001–026 live (next number 027); `npm run typecheck` clean; 548 tests in 37 files pass; `check-context-size` and `migration-rules.test.mjs` pass.

---

## Spec gaps

Each gap is something SPEC.md is silent or ambiguous about that a chunk needs. The options are listed neutrally — none is chosen here. The chunks named under **Blocks** stop until the gap is answered.

**G1 · Logged warmup sets vs. an unchanged Coach.**
SPEC says warmup sets are "never counted in volume, set counts, or 'last time' matching", and that Coach "stays exactly as it is". Found in the code: Coach's shared week rollup counts every non-skipped head that has weight and reps as a working set — `mesoWeekRollup.ts:96-103` (its query doesn't select `is_warmup` at all) — and so does `mesoAnalysisInput.ts:338-365` (`setsCompleted`, `avgReps`, `avgRir`). Both Mesocycle Analysis and the Q&A planning context use that rollup. No warmup has ever been logged (`useLogSet` hard-codes `isWarmup: false`), so this has never mattered; once chunk 15 logs warmups with numbers, it will. (Daily and weekly analysis already drop warmups via `positionMatch.ts:143`.)
Options: (a) leave Coach untouched and accept that its rollups count numbered warmups as working sets; (b) allow an input-side filter in those two Coach files only, no prompt or prompt-version change; (c) other.
Blocks: chunk 15.

**G2 · Priorities: where run marks live, given Coach reads the old table.**
SPEC: priorities become focus / don't care on groups and subgroups, on the program and per run, with the mapping top → focus, low → don't care, the middle two → normal. Found: Coach's Mesocycle Analysis reads per-meso rows from `v2_coach_meso_tag_priorities` (`priorityContext.ts`), and its prompt (`coachMesoPrompt.ts:289-313`, `MESO_PROMPT_VERSION 2`) documents exactly `"low"|"normal"|"high"|"top"` with *ceiling* semantics (group = ceiling, subgroup = relative emphasis inside it). SPEC's new rule is an *override* (a subgroup's own mark applies to that subgroup).
Needs answering:
(i) Run marks: (a) new storage only (`v2_program_priorities` on the run's copy); the old table is left as history, so Coach sees no priorities for any run started after the change; (b) new storage for saved programs, but run marks also written to the old table as `top` (focus) / `low` (don't care), so Coach keeps reading them, under its own ceiling reading; (c) other.
(ii) A subgroup with no mark of its own under a marked group: does it take the group's mark (so "chest" focus covers upper chest unless upper chest is marked), or is it normal ("anything unlisted is normal")? The summary wording "chest without upper chest" depends on it.
(iii) Existing rows: map only the active run's rows, or also give the saved program (template) the mapped marks? Completed mesos' rows stay where they are either way (scratch run below: completed MESO 1.0 shares the active run's copy under G3 option A').
Blocks: chunk 10, and chunk 11 through its dependency on 10.

**G3 · How existing programs and mesocycles move to "a run owns a copy of its program".**
SPEC: "Activating a program creates a run with its own copy of the plan"; the program tab edits that copy, never the saved program. Silent on runs activated before this build. Today the active meso, every completed meso of the same program, and the program you edit in the builder are one set of rows: deleting a program exercise deletes its planned sets in every week of every meso that used it (`v2_week_plan_sets.program_exercise_id … on delete cascade`).
Options (each was run on the scratch copy — see "Scratch-copy runs"):
(A') every program any mesocycle points at becomes that run's copy (no existing id changes anywhere) and a fresh saved program is cloned from it to be the template; non-destructive — adds rows and sets flags;
(A'') the existing programs stay templates; the active meso gets a new copy and its week plans, planned sets, sessions and swaps are re-pointed at the copy (rewrites foreign keys in existing rows);
(A''') no transition — mesocycles started before the build keep editing the shared program until they end; only new runs get copies.
Blocks: chunk 6.

**G4 · "Week start" setting for existing users.**
SPEC: week-dependent weeks copy the last planned week by default; "a setting lets weeks start empty instead — default for new users: copy". Silent on existing users. Today's behaviour is effectively *empty*: a new week has no plan until you press COPY WEEK. Options: existing users start on copy / on empty.
Blocks: chunk 8.

**G5 · Session-only exercise order is [P1] in "Objects stored", but its only feature is [P2].**
"Session [existing, extended] — [P1] … session-only exercise order", while "Reorder this session" is listed under [P2] Logging mechanics and the [P2] Today items. No P1 feature writes it. Include the column in phase 1 (unused until phase 2), or leave it to phase 2?
Blocks: only that column — it is held out of chunk 1.

**G6 · Missed weekday sessions once "Move this session" exists.**
SPEC: moving a session to another day is "this week only", and "today's 'do it the next day' is the simplest case of the same action". Today's actual behaviour (fact 4, chunk 24): a 7-day look-back prompt that crosses week boundaries, whose DO IT NOW stores the session under the *missed* date and whose MARK SKIPPED writes a skipped row. Does that prompt (a) go, replaced by Move; (b) stay as is; (c) stay but only for days of the current week? And does DO IT NOW for a missed day of *last* week remain possible?
Blocks: chunk 24.

**G7 · "Last time": LAST WEEK next to deload weeks, and the reach-back.**
SPEC: "LAST WEEK only when the match is from the immediately preceding, non-deload week. Otherwise LAST TIME + elapsed time." (i) If last week was a deload week (or the match's week was partly deload), is the reference LAST TIME from the last normal week, or does LAST WEEK skip back over the deload week? (ii) "Crosses run boundaries": does that also apply to the existing reach-back (the slot shown when the matched session's sets were all skipped), which today is deliberately limited to the current meso?
Blocks: chunk 23.

**G8 · Sequence details.**
(i) Can one workout appear more than once in a sequence (e.g. A, B, A, C)? The answer decides whether a sequence slot can be identified by its workout. (ii) After **Skip**, when is the next workout due: on the day of the skip, or after the rest days that follow the skipped workout, counted from the skip? "Rest days count from the last workout done" — a skipped workout isn't done.
Blocks: chunk 25.

**G9 · Deload rules details.**
(i) Unmarking a session whose sets the rules calculated: keep the calculated sets, or restore what was planned before? (ii) The reps rule (±n) on a range target and on AMRAP. (iii) Which sets the sets rule removes (the last working sets? does a staged set count as one? warmups untouched?). (iv) "Pre-calculated from the last normal week" when that workout didn't happen in the last normal week (moved away, skipped): use its last normal occurrence instead?
Blocks: chunk 22.

**G10 · Rest chain edges inside supersets.**
(i) The block's rest after a round when no superset override is set: the normal chain of the exercise that ends the round, or the global rest? (ii) An exercise's "rest after" when its last set ends inside a round (unequal set counts). (iii) A set's own rest override inside a round, where "no timer within a round" is the superset default — which wins?
Blocks: chunk 16.

**G11 · Tags: one per set, or several?**
"Per set … preset list plus custom text"; the Week object says "tags per set"; "'Apply to all sets' fills one tag across an exercise's sets". Storage (`text[]`) supports both; the tag editor needs the answer.
Blocks: chunk 19.

**G12 · Navigation after the program screen folds into Plan.**
SPEC: "[P1] The program screen folds into the plan screen as its program tab"; "no active run → 'Start a program', leading to the planner". Silent on where these live once PROGRAM leaves the bottom bar: the list of saved programs; opening the planner on a saved program while a run is active; ending a run; starting a different program; the completed runs list (today on PROGRAM, with delete and the priorities pages Mesocycle Analysis reads).
Blocks: chunk 26.

**G13 · Changing a running program's exercise list or superset grouping.**
The week-plan actions listed are "edit any value; swap or reorder exercises". For week-dependent runs SPEC also says "permanent volume changes are made in a week and carry forward through copying" — volume being "the exercise list and the sets" — which implies adding/removing an exercise in a week. Is that in phase 1, and for stable runs too (as a one-off)? Same silence for superset grouping: SPEC puts it in planner step 2 but in neither mid-run list (design fields / volume) — can a running program's grouping change, and where (program tab, week plan, neither)?
Blocks: chunk 9; the mid-run regrouping part of chunk 13.

**G14 · (Conditional on live data) A saved program with one workout on two weekdays.**
Today's schedule grid lets one workout sit on several weekdays (`WeeklyScheduleGrid.tsx` writes any day → any workout), and both days then share one planned row per week (scheduler scenario S8, under chunk 24). SPEC's model gives each workout "its day of the week" (one). The live check L6 below says whether any of your programs has this. If one does: what happens to it — split into two workouts, keep one day, or leave it as it is until it's next edited?
Blocks: chunk 8 and chunk 11, only if L6 finds such a program.

---

## Facts verified against the real app — index

The full finding sits next to the chunk that depends on it. "Live data" = needs your SQL Editor session (Escalation 3); the Adam-scoped queries are under "Live-data checks".

| SPEC fact | Finding (short) | How it was verified | Chunk |
|---|---|---|---|
| How deload weeks are stored today | One boolean per **planned session**, not per week: `v2_week_plans.is_deload`, one row per (meso, workout, week). Toggled per workout in Plan; no whole-week action. Copy-forward copies the flag into the next week. | Code + migration 001 + scratch catalog check; live column probe | 21 (and 8) |
| The four priority levels' stored values | `'low' \| 'normal' \| 'high' \| 'top'` text with a CHECK (024); no row = normal; `'focus'` is rejected | Code + migration 024 + scratch insert (23514); live column probe | 10 |
| Only one run active at a time | True only by app code: start = "complete all active, then insert", two requests, no constraint. Two concurrent starts leave two active runs. | Code + every migration + scratch catalog check + scratch race test | 6 |
| Today's skip / do it the next day | 7-day look-back prompt (never before meso start, crosses week boundaries); DO IT NOW stores the session under the **missed** date; MARK SKIPPED writes a skipped row; dismiss is per screen mount | Production `scheduler.ts` run under Vitest (scenarios S0–S10) + code | 24 |

Live schema check (2026-10-03): on the nine core tables, the columns phase 1 builds on (among them `is_deload`, `week_number`, `notes`, `priority`, `tag_type`, `status`, `program_id`, `schedule`, `target_reps`, `weight_unit`, `is_warmup`, `parent_week_plan_set_id`, `stage_index`, `note`, `form_rating`, `energy_rating`, `measure_set_time`, `auto_finish_minutes`) each answered `200 []` through the public API, every request filtered `user_id=eq.<Adam>` with `limit=0` (anonymous role, so RLS returns no rows either way); a made-up column answered `400 / 42703`, so the probe tells present from absent. That proves those columns exist live as 001–026 define them — nothing about the data, and not every column.

---

## Scratch-copy runs

Run on 2026-10-03 against a local PostgreSQL 16.14 copy (live runs 17.6). Recipe, so a builder can rebuild it: create the stand-ins below, replay `supabase/migrations/001…026` in order (all 26 apply cleanly), then load fixtures in one sequential `DO` block (two users; programs incl. one workout on two weekdays and one never run; a completed and an active meso sharing one program; 13 week plans incl. a deload row and an empty row; 56 planned sets incl. a planned dropset; 7 sessions incl. a DO IT NOW and an in-progress one; four-level priority rows).

```sql
-- Stand-ins for what Supabase and Overload v1 provide outside this repo (scratch only).
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table exercises (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, name text not null,
  is_archived boolean not null default false, created_at timestamptz not null default now());
alter table exercises enable row level security;
create policy "Users access own rows" on exercises for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;           -- Supabase's default grants; RLS restricts rows
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
```
Test as a user with `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` inside a transaction.

| # | What was run | What happened | Chunk |
|---|---|---|---|
| R1 | Draft P1 schema (the chunk 1 data model) on the fixtures | Applied cleanly; row counts identical before/after on all nine core tables; existing programs default to saved / weekday / week-dependent. Constraint probes: a 10–8 range, AMRAP with a rep number, a staged warmup and a `'top'` mark were each rejected; an 8–12 range was accepted | 1 |
| R2 | The old client's exact write shapes after R1: session insert, set-log insert with every current key, planned-set insert, program-exercise insert incl. `target_reps`, settings full-row upsert | All succeed; the old full-row upsert left non-default `warmup_display` and `deload_rules` untouched | 1 |
| R3 | RLS on the six new tables | User B saw 0 of A's rows, updated 0, and an insert as A was refused by RLS; A saw its own | 1 |
| R4 | `classify()` from `scripts/migration-rules.mjs` on the draft | Not safe: 7 flagged statements — 3 "new column carries a constraint" (CHECKs on new columns of `v2_programs`, `v2_set_logs`, `v2_user_settings`), 4 "foreign key action" (`on delete set null` on 4 new FK columns). Every new table passed. None can alter existing data (defaults satisfy the CHECKs; the new FK columns are NULL on every existing row) | 1 |
| R5 | Week exercise-list backfill (chunk 7) | 25 rows = predicted 25; 0 planned sets left without their exercise row; the empty week-4 plan lists the same exercises today's screen shows; re-run inserts 0 | 7 |
| R6 | Legacy transition, option A' (G3) | 3 programs became run copies (one per program any meso used); md5 of every session / week plan / planned set / log id and every `meso.program_id` unchanged; cloned templates map their schedules to their own workouts (incl. one workout on Mon+Thu); cloned exercises equal the originals | 6 |
| R7 | Atomic "start a run" function: end active runs + deep copy (workouts with lineage, superset blocks, exercises, sets with stage parents, sequence with rest days, warmup items, priorities) | Copy complete (2 workouts, 5 sequence slots, 2 warmup items, 1 block, 2 exercises, 6 sets incl. 2 stages, 2 marks); 0 references from the copy back into the template; previous run completed; exactly one active | 6 |
| R8 | Two concurrent starts — control without a lock, then with a per-user advisory lock | Without the lock: **2 active runs** (the race is real, and today's app-layer start has the same shape); with the lock: 1 | 6 |
| R9 | Atomicity: a constraint violation injected at the last copy step | Nothing persisted — no program, workout, set or run; the previous run stayed active | 6 |
| R10 | Idempotent week planning, two concurrent callers for the same week | Caller 1 planned 2 sessions, caller 2 planned 0 (it waited on the unique key, then skipped copying); rows exactly match the run copy (2 exercises, 6 sets incl. 2 stage rows; stage parents inside the same week plan) | 8 |
| R11 | Relaxing `v2_set_logs_check` for warmups | Before: a numberless warmup is rejected. After: existing rows valid, numberless warmup accepted, a working set missing reps still rejected. Classifier flags it (drop + add constraint) | 15 |
| R12 | `create or replace view v2_history_session_summary` with `and not sl.is_warmup` on `set_count` | Count fell 5 → 4 for the session holding a warmup; `security_invoker=true` and the `authenticated` grant survived | 15 |
| R13 | Priorities mapping on top of R6 | Active MESO 2.0: 2 focus, 2 don't care, 2 rows dropped as normal; old table untouched; completed MESO 1.0 shares the active run's copy, so only the active run's marks can be mapped onto it | 10 |
| R14 | Suggested reps: backup table → optional conversion → drop → rollback | 12 values backed up; 34 unlogged planned working sets of the active run got them as rep targets; column dropped; rollback restored all 12 with an identical md5 fingerprint (a real rollback also needs the converted set ids in the backup) | 12 |
| R15 | Facts 1–3 at the database level | Two active mesos for one user are accepted (only a non-unique `(user_id, status)` index exists); the priority CHECK is exactly the four values; `is_deload` exists only on `v2_week_plans` (the two history views derive theirs from it) | 6, 10, 21 |

Scratch SQL lives only in the session scratchpad; none of it is a committed migration.

---

## Data models

SPEC's objects mapped onto the existing schema. "New" = added by chunk 1 unless another chunk is named. Conventions kept: `v2_` prefix; `user_id` on every row with the standard `for all using/with check (user_id = auth.uid())` RLS; text + CHECK vocabularies (D18); weights stored in kg (D4); stages as linked rows (D1).

### Mapping at a glance

| SPEC object | Stored as |
|---|---|
| Program (saved) | `v2_programs` with `kind = 'saved'` |
| A run's copy of the plan | `v2_programs` with `kind = 'run'`, plus its own workouts, exercises, sets, blocks, sequence, warmup items and marks (deep copy, chunk 6) |
| Program workout | `v2_workout_days` (weekday comes from the program's `schedule`, unchanged) |
| Sequence | `v2_program_sequence_items` |
| Warmup routine | `v2_workout_warmup_items` |
| Program exercise | `v2_program_exercises` |
| Superset block (+ its rest overrides) | `v2_program_superset_blocks` |
| Program set | `v2_program_sets` |
| Priorities | `v2_program_priorities` (run marks also subject to G2) |
| Run | `v2_mesocycles` (`program_id` → the run's copy; new `source_program_id` → the saved program) |
| Week / cycle | the `v2_week_plans` rows sharing `(mesocycle_id, week_number)`; for sequence runs `week_number` is the cycle index |
| Planned session in a week (incl. its deload flag) | one `v2_week_plans` row; its `is_deload` *is* the session's deload flag |
| Exercises as planned for that week | `v2_week_plan_exercises` |
| Planned set | `v2_week_plan_sets` |
| Session | `v2_sessions` (deload read through `week_plan_id`; new `moved_to_date`) |
| Set log | `v2_set_logs` |
| Settings | `v2_user_settings` |
| Deload rules | `jsonb` on `v2_user_settings` (global default) and `v2_programs` (override) |

Set kind is not a new column anywhere: **warmup** = `is_warmup = true` (exists since 006 on both planned sets and logs, and every consumer — views, e1RM, Progress, Coach — already reads it); **staged** = a head with `stage_kind` set, plus stage rows linked by the existing parent id + `stage_index`; **working** = neither. A legacy head that has stages but no `stage_kind` reads as a dropset. Stage rows keep `is_dropset = true` whatever the stage kind, because existing readers use it to mean "is a stage row".

### Program — `v2_programs` (existing)
| Column | Type | Notes |
|---|---|---|
| id, user_id, name, created_at, updated_at | existing | |
| schedule | jsonb, existing | `{ monday: workout_day_id \| null, … }` — stays the single source of weekdays for weekday programs (scheduler, Plan and Coach's week resolution all read it). Empty `{}` for sequence programs. |
| kind | text not null default `'saved'` · `saved \| run` | new |
| schedule_type | text not null default `'weekday'` · `weekday \| sequence` | new |
| planning_type | text not null default `'week_dependent'` · `stable \| week_dependent` | new. Existing programs get week-dependent because that is exactly how they behave today (weeks hold the sets; you copy forward). |
| deload_rules | jsonb, null | new. Null = use the global default; an object = this program's override (shape under Settings). |

### Program workout — `v2_workout_days` (existing)
| Column | Type | Notes |
|---|---|---|
| id, program_id, user_id, name, position | existing | |
| source_workout_day_id | uuid null → `v2_workout_days` on delete set null | new. On a run's copy: the saved program's workout it came from. Lets "session type, all time" follow a workout across runs (chunk 5). |

### Sequence — `v2_program_sequence_items` (new)
`id, user_id, program_id → v2_programs (cascade), position int ≥ 0, workout_day_id → v2_workout_days (cascade) null`. Null `workout_day_id` = a rest day. Unique `(program_id, position)`. Whether one workout may appear twice is G8(i).

### Warmup routine — `v2_workout_warmup_items` (new)
`id, user_id, workout_day_id → v2_workout_days (cascade), position int ≥ 0, body text (non-blank)`. Unique `(workout_day_id, position)`. Ticks are not stored (SPEC: "nothing else is logged").

### Superset block — `v2_program_superset_blocks` (new)
`id, user_id, workout_day_id → v2_workout_days (cascade), rest_within_round_seconds int ≥ 0 null, rest_after_round_seconds int ≥ 0 null, created_at`. Exercises pointing at the same block form one superset; null overrides = SPEC defaults (G10).

### Program exercise — `v2_program_exercises` (existing)
| Column | Type | Notes |
|---|---|---|
| id, workout_day_id, user_id, exercise_id, position, weight_unit | existing | `weight_unit` = SPEC's "unit preference (existing)" |
| target_reps | integer, existing | SPEC's "suggested reps" — UI removed in chunk 11, **column dropped in chunk 12** |
| superset_block_id | uuid null → blocks, on delete set null | new |
| rest_seconds, rest_after_seconds | integer ≥ 0, null | new — design fields |
| tempo | text, null, ≤ 20 chars | new — design field; format (4 fields, digits or X) validated in TS (chunk 2) |
| week_only | boolean not null default false | new — run copies only: a slot created by a week edit (a swapped-in or added exercise), hidden from the program tab. Keeps every planned set pointing at a program exercise whose `exercise_id` is the exercise actually planned that week — which is how Coach reads planned exercises. |
| removed_at | timestamptz null | new — run copies only: removed from the run's program; planned weeks keep their rows (hard delete would cascade into planned sets of every week of the run). |

### Program set — `v2_program_sets` (new)
For a stable program these are the volume for every week; for week-dependent, week 1.
| Column | Type | Notes |
|---|---|---|
| id, user_id, created_at | | |
| program_exercise_id | uuid → `v2_program_exercises` (cascade) | |
| position | int > 0 | order within the exercise; a stage shares its head's position |
| is_warmup | boolean default false | set kind warmup |
| stage_kind | text null · `dropset \| rest_pause \| myo_reps \| cluster` | heads only |
| stage_rest_seconds | int ≥ 0 null | heads only; null = the kind's default (dropset none; others 15 s) — design field |
| parent_program_set_id, stage_index | uuid → self (cascade), int | stages; `stage_index = 0` exactly when there is no parent |
| rep_min, rep_max, is_amrap | int > 0 null, int ≥ rep_min null, boolean | rep target: number = min = max; range = min < max; AMRAP = flag, no numbers; none = all empty |
| rest_seconds | int ≥ 0 null | rest after this set — design field |

Checks (verified on scratch, R1): max needs min and ≥ min; AMRAP carries no numbers; stages carry no kind, stage rest or warmup flag; a warmup is never staged.

### Priorities — `v2_program_priorities` (new)
`id, user_id, program_id → v2_programs (cascade), tag_type ('muscle_group' | 'muscle_subgroup'), tag_value (non-blank; vocabulary owned by priorityTags.ts / exerciseTags.ts as in 024), mark ('focus' | 'dont_care'), created_at, updated_at`; unique `(user_id, program_id, tag_type, tag_value)`. No row = normal. Holds saved programs' marks and runs' marks (on the run's copy). The old `v2_coach_meso_tag_priorities` stays; what happens to it is G2.

### Run — `v2_mesocycles` (existing)
| Column | Type | Notes |
|---|---|---|
| id, user_id, name, status (`active \| completed`), start_date, end_date, created_at | existing | "end when the user ends it" = status + end_date, as today |
| program_id | existing | the run's copy (`kind = 'run'`) for every run started from chunk 6 on; for existing runs too unless G3 chooses A''' |
| source_program_id | uuid null → `v2_programs` on delete set null | new — the saved program the run started from |

Sequence position is derived, not stored: the run's last completed-or-skipped session gives the slot, its week plan gives the cycle (chunk 25) — nothing to drift. One active run per user stays an app rule, made race-safe by the start function's per-user lock (chunk 6, R8).

### Week / cycle and planned session — `v2_week_plans` (existing, unchanged)
`id, user_id, mesocycle_id, workout_day_id, week_number, is_deload, notes, created_at`, unique `(mesocycle_id, workout_day_id, week_number)`. A week is the set of rows sharing `(mesocycle_id, week_number)`; it "exists once planned" = its rows exist. `is_deload` is the planned session's deload flag (fact 1). Planned once, atomically, by `v2_plan_week` (chunk 8).

### Exercises as planned for a week — `v2_week_plan_exercises` (new)
| Column | Type | Notes |
|---|---|---|
| id, user_id, created_at | | |
| week_plan_id | uuid → `v2_week_plans` (cascade) | |
| program_exercise_id | uuid → `v2_program_exercises` (cascade) | the slot planned this week (a week-only slot after a swap/add) |
| position | int ≥ 0 | this week's order |
| carry_program_exercise_id | uuid null → `v2_program_exercises` on delete set null | what copying forward uses; null = `program_exercise_id`. An "only this week" swap stores the pre-swap slot here. |
| carry_position | int null | what copying forward uses; null = `position`. An "only this week" reorder leaves it at the old order. |

Unique `(week_plan_id, program_exercise_id)` — so planned sets keep linking by `(week_plan_id, program_exercise_id)` exactly as today, and no existing reader of planned sets changes.

### Planned set — `v2_week_plan_sets` (existing)
| Column | Type | Notes |
|---|---|---|
| id, week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset, parent_week_plan_set_id, stage_index, is_warmup | existing | |
| program_set_id | uuid null → `v2_program_sets` on delete set null | new — the run copy's set this came from; how the workout screen finds the set's design fields (rest override, stage rest) |
| stage_kind | text null (same four kinds) | new — heads only |
| target_weight | numeric(6,2) ≥ 0 null | new — kg; week plan only, never in the program |
| rep_min, rep_max, is_amrap | as program sets | new — copied from the source when the week is planned; editing them is the week's override |
| tags | text[] null | new — never copied; one or several per set is G11 |

### Session — `v2_sessions` (existing)
| Column | Type | Notes |
|---|---|---|
| all existing columns | | `date` keeps meaning "the date this session is *for*" (as DO IT NOW already uses it) |
| moved_to_date | date null | new — weekday runs: the day it was moved to, same week. A session moved before it starts is created as a `planned` row (the status exists but is unused today). |
| deload flag | — | read through `week_plan_id` → `v2_week_plans.is_deload`; every session from chunk 8 on has a planned row |
| session-only exercise order | — | held: G5 |

### Set log — `v2_set_logs` (existing)
| Column | Type | Notes |
|---|---|---|
| all existing columns | | `note` column stays; only its edit UI goes (chunk 4) |
| stage_kind | text null (four kinds) | new — on the head, "as planned" |
| check `v2_set_logs_check` | | relaxed in chunk 15 to `is_skipped or is_warmup or (weight and reps not null)` |

### Settings — `v2_user_settings` (existing)
| Column | Type | Notes |
|---|---|---|
| all existing columns | | |
| warmup_display | text not null default `'rows'` · `rows \| tick` | new |
| deload_rules | jsonb null | new — null = no rules switched on |
| week_start | text · `copy \| empty` | **chunk 8**, default per G4 |

Deload rules shape (settings and program override; validated by `deloadRules.ts`, chunk 22; an absent key = that rule is off):
```
{ "sets":   { "mode": "percent" | "count", "value": 50, "rounding": "down" | "up" },
  "weight": { "percent": 90, "rounding": "down" | "up", "step": 2.5, "stepUnit": "kg" | "lbs" },
  "reps":   { "delta": -2 },
  "rir":    { "delta": 2 } }
```
Turning rules on starts from `{ "sets": { "mode": "percent", "value": 50, "rounding": "down" } }` (SPEC: sets −50%, everything else unchanged); a weight rule, when switched on, starts at rounding down to 2.5 kg. Sets never go below 1.

### Reference data (code, not tables — chunk 2)
Set kinds; the four stage kinds with their default stage rest and weight carry-over (dropset drops; the others carry); the four preset tags in SPEC's order ("push here", "maintain strength", "focus on execution", "push back"); rep-target and tempo formats; the deload-rules starting values; the muscle group → subgroup tree already in `priorityTags.ts` (`PRIORITY_TREE`, 12 groups / 22 subgroups).

---

## File and folder structure

Existing layout is kept (`src/features/<area>/`, pure logic in testable modules, services take the Supabase client). One new feature folder: `src/features/planner/`.

**New**
| Path | Chunk | What |
|---|---|---|
| `supabase/migrations/027_planner_p1_schema.sql` | 1 | additive schema |
| `src/lib/plannerVocabulary.ts` (+ test) | 2 | reference data |
| `supabase/migrations/0NN_start_run.sql` | 6 | `v2_start_run` + the G3 transition |
| `src/features/programs/runService.ts` | 6 | `startRun` RPC wrapper |
| `src/features/plan/ProgramTab.tsx` | 6 | the run's copy inside Plan |
| `supabase/migrations/0NN_week_plan_exercises_backfill.sql` | 7 | backfill |
| `supabase/migrations/0NN_plan_week.sql` | 8 | `v2_plan_week` + `week_start` |
| `src/features/plan/weekSources.ts` (+ test) | 8 | pure source selection |
| `src/features/plan/weekEdits.ts` (+ test) | 9 | swap / reorder / carry semantics |
| `supabase/migrations/0NN_priority_marks.sql` | 10 | mapping (shape per G2) |
| `src/lib/priorityMarks.ts` (+ test), `src/features/plan/PrioritiesEditor.tsx` | 10 | effective marks, summary wording, editor |
| `src/features/planner/{PlannerPage, StepPriorities, StepExercises, StepVolume}.tsx`, `plannerService.ts`, `usePlanner.ts` | 11 | the stepped planner |
| `supabase/migrations/0NN_drop_target_reps.sql` | 12 | backup + optional conversion + drop |
| `src/features/gym/supersetRounds.ts` (+ test), `SupersetBlock.tsx` | 13 | rounds |
| `supabase/migrations/0NN_warmup_sets.sql` | 15 | check relax + views |
| `scripts/check-warmup-consumers.mjs` | 15 | lists every set-count consumer and whether it filters warmups |
| `src/features/gym/restChain.ts` (+ test) | 16 | timer value resolver |
| `src/features/gym/WarmupRoutineChecklist.tsx`, `warmupRoutineStore.ts` | 18 | checklist + client-only tick state |
| `src/features/plan/SetTargetsEditor.tsx`, `TagPicker.tsx` | 19 | per-set targets and tags in the week plan |
| `src/features/plan/applyAhead.ts` (+ test) | 20 | applies one recorded change to later planned weeks |
| `src/lib/deloadRules.ts` (+ test), `src/features/settings/DeloadRulesEditor.tsx` | 22 | rules calculator and its editor |
| `src/features/gym/referenceByExercise.ts` (+ test) | 23 | new resolver beside the untouched `referenceLogic.ts` |
| `src/features/gym/MoveSessionSheet.tsx` | 24 | move a session within the week |
| `src/features/gym/sequenceSchedule.ts` (+ test), `src/features/planner/SequenceEditor.tsx` | 25 | due dates; sequence editing |

**Changed most** — `src/types/index.ts`; `src/features/plan/{PlanPage, weekPlanService, useWeekPlan}`; `src/features/gym/{GymSession, ExerciseCard, SetGroup, SetRow, ExerciseHeader, PlanTargetsPanel, SessionPreview, TodayPage, scheduler, useScheduler, restTimerStore, RestTimer, RestTimerInline, ExerciseReference, sessionService, useSession}`; `src/features/programs/{ProgramPage, programService, usePrograms, mesoService, useMesos}`; `src/features/settings/*`; `src/features/offline/offlineCache.ts`; `src/lib/db.ts` (plain new fields on cached rows — no Dexie version bump, same precedent as `stageIndex`); `src/features/history/{historyService, useHistory}`; `src/App.tsx`, `src/components/Nav.tsx`; `scripts/verify-rls.mjs` (`TABLES`, chunks 7, 10, 11, 13, 18, 25).

**Removed** — `src/features/programs/{ProgramBuilderPage, WorkoutDayEditorPage, WeeklyScheduleGrid}.tsx` (chunk 11); `src/features/coach/MesoPrioritiesPage.tsx` and `PrioritySelector.tsx` only if G2's answer replaces them (chunk 10).

**Never touched by phase 1** — `api/coach/*`, every `src/features/coach/*` module except what G1/G2 answers allow, and the existing exports of `referenceLogic.ts` and `setGroupLogic.ts` (Coach imports both). The shared scripts (`check-migration`, `migration-rules`, `check-context-size`) are never changed during a build.

---

## Core stack

**No additions.** Each phase-1 need is covered by what's there:

| Need | Covered by |
|---|---|
| Atomic multi-row writes (start a run, plan a week, migrations) | Postgres functions called with `supabase.rpc` — the pattern 021's `reassign_exercise_history` already uses (`security invoker`, RLS applies) |
| Reordering exercises, blocks, sequence slots | Up/down moves, the interaction `WorkoutDayEditorPage` already uses; SPEC asks for moving, not dragging, so no drag-and-drop library |
| The stepped planner, editors, sheets | React 19 + the existing component patterns; no form library (none in the codebase) |
| Validation of rep targets, tempo, deload rules | Plain TypeScript modules with Vitest, as `priorityTags.ts` / `ratingScales.ts` |
| Server state / UI state / offline | TanStack Query / Zustand / Dexie, unchanged |
| Dates (weeks, cycles, due dates) | date-fns v4 with explicit `weekStartsOn: 1` (house rule) |

---

## Chunks in build order

Order follows the rules: schema first, in its own chunk; then reference data; then the heart — what a workout is: a run owning its plan, weeks owning their sessions, the planner, and the set structures as they render on the workout screen; supporting views last. Two small fixes to live behaviour (3, 4) depend on nothing and sit before the heart; chunk 5 is a prerequisite that keeps chunk 6 from splitting history.

Every chunk with a migration follows the Reviewer's rules: `node scripts/check-migration.mjs` result recorded in a blocking DECISIONS.md entry; the migration is applied by hand by you and goes live **before** the code that needs it; Adam-scoped row counts on every table the file mentions, before and after; hash/length check of the applied text; all scripts in `scripts/` run at the boundary.

---

### Chunk 1 — Schema: the phase-1 data model (additive)
**Goal:** Add every phase-1 table and column the later chunks need, without changing what the app does.
**Scope:** `supabase/migrations/027_planner_p1_schema.sql` only, per "Data models": six new tables with RLS, policies and indexes; new columns on `v2_programs`, `v2_workout_days`, `v2_mesocycles`, `v2_program_exercises`, `v2_week_plan_sets`, `v2_sessions`, `v2_set_logs`, `v2_user_settings`; a `notify pgrst, 'reload schema'` at the end. No `src/` change. Held out: the session exercise-order column (G5) and `week_start` (G4, chunk 8).
**Depends on:** —
**Migration:** additive, **not destructive**. Existing data: no row changes; existing rows get column defaults (`saved` / `weekday` / `week_dependent`, `rows`, `false`) or NULL. Rollback: drop the six new tables, then the new columns. `check-migration` will exit 1 with the 7 statements of R4 plus the `notify` line ("not on the safe list"); each is justified in the DECISIONS entry (CHECKs on new columns whose defaults satisfy them; `on delete set null` on new FK columns that are NULL on every existing row; `notify` only reloads PostgREST's schema cache).
**Verification:** (1) scratch: R1–R4 re-run on the final file; (2) live, after you apply it: Adam-scoped counts before/after on every existing table the file mentions — the eight it alters plus `v2_week_plans`, which a new table references (all must be equal); an API probe per new column (`200 []`, Adam-filtered, `limit=0`) with a made-up-column control (`400`); the six new tables answer zero rows to the anon key (no app code uses them yet, so they join `TABLES` in `scripts/verify-rls.mjs` with the chunk whose code first reads or writes them — see the boundary rules); applied-text hash/length check; the deployed app (unchanged code) loads Today, Plan, Program and History, and the next set you log in a real session saves normally. **Would not catch:** whether the shapes suit the features — each feature chunk re-proves the part it uses; a stale PostgREST schema cache (that's why the probe runs after the reload).
**Done when:** 027 is live, counts are unchanged, every probe answers as expected, and the DECISIONS entry records your go-ahead.

### Chunk 2 — Reference data: planner vocabulary
**Goal:** One pure module holds phase 1's fixed vocabularies and formats, so every later chunk reads the same values.
**Scope:** `src/lib/plannerVocabulary.ts` + test: set kinds and their storage mapping (warmup ↔ `is_warmup`, staged ↔ `stage_kind`); the four stage kinds with default stage rest (dropset none; rest-pause, myo-reps, cluster 15 s) and weight carry-over; the four preset tags; rep target ↔ `rep_min/rep_max/is_amrap` with parse/format ("8", "8–12", "AMRAP"); tempo parse/normalise (four fields, digits or `X`, e.g. `3-1-1-0`, `3-1-X-0`); the deload-rules starting values. No UI, no Supabase.
**Depends on:** 1 (only by build order; no runtime dependency).
**Verification:** Vitest cases incl. rejects ("12-8", "31X0", "3-1-1"); each test proven by breaking the code it guards (Checks that lied #11); typecheck. **Would not catch:** a later chunk hard-coding its own copy — each chunk's review greps for duplicated literals.
**Done when:** the module and its tests are on master and nothing at runtime has changed.

### Chunk 3 — Fix: planned staged sets show every stage from the start
**Goal:** A dropset planned in the week plan shows its head and every stage row on the workout screen before anything is logged, each stage row locked until the one before it is logged.
**Scope:** `SetGroup.tsx` (render planned stages under an unlogged head), `SetRow.tsx` (a locked state), `ExerciseCard.tsx` (pass planned stages for unlogged heads); a jsdom test. Existing dropset data only — other stage kinds are chunk 14.
**Depends on:** —
**Found in the code:** with the head unlogged, `SetGroup.tsx:115-130` returns the head row alone; planned stages appear only after the head is logged, behind ADD STAGE (`expectStage`, `ExerciseCard.tsx:547`). That is the regression SPEC describes.
**Verification (as SPEC requires):** load a week plan with a planned dropset (head + 2 stages) into a real session in the running app and confirm 3 rows before any log, stage rows locked; log the head → stage 1 unlocks, stage 2 stays locked; log stage 1 → stage 2 unlocks; Adam-scoped query: the stage logs carry `parent_set_id` = the head and `stage_index` 1, 2. The jsdom test must fail when the old render path is restored. Needs your sign-in for the real session (Escalation 3); a throwaway session needs your go-ahead (it writes). **Would not catch:** rest-pause/myo-reps/cluster (chunk 14), superset interplay (chunk 13).
**Done when:** the real-session check has passed at 375 px and is recorded with a screenshot.

### Chunk 4 — Remove the note section from logged-set editing
**Goal:** Editing a logged set no longer shows a note field.
**Scope:** `SetRow.tsx` edit mode (the note input, its state, and `note` in the update payload) and the `onUpdate` types up the chain. Stored notes stay in `v2_set_logs.note` untouched; no migration; History and Coach readers unchanged.
**Depends on:** —
**Verification:** in the running app, edit a logged set: no note field; save; Adam-scoped query shows that row's `note` unchanged. A jsdom test asserts edit mode renders no note input. **Would not catch:** notes shown elsewhere (out of scope by SPEC's wording).
**Done when:** deployed, the edit form has no note field, and existing notes are untouched.

### Chunk 5 — "Session type, all time" follows a workout across runs
**Goal:** A workout's all-time history includes its copies in other runs, so chunk 6 never splits it.
**Scope:** `historyService.fetchSessionTypeHistory` / `useSessionTypeHistory` query the workout's lineage group (the root workout plus every workout whose `source_workout_day_id` is the root) instead of one id; a pure lineage-group resolver with tests. No view change. (It is the only History read keyed on `workout_day_id`; the session list filters by meso, status, date and muscle.)
**Depends on:** 1.
**Verification:** unit tests; scratch fixture with a copy chain returns one combined history; live, today (no copies yet): the history page returns exactly the same row ids before and after for each of your workouts (Adam-scoped). **Would not catch:** lineage written by real copies — chunk 6 re-checks after its first real start.
**Done when:** deployed and identical on today's data.

### Chunk 6 — A run owns a copy of its program
**Goal:** Starting a program creates a run with its own copy of the plan, and editing the run never changes the saved program.
**Scope:** migration: `v2_start_run(program, name, start)` — `security invoker`; per-user advisory lock; ends the active run; deep-copies the saved program (workouts with lineage, superset blocks, exercises, sets incl. stage parents, sequence, warmup items, marks); creates the mesocycle with `program_id` = copy, `source_program_id` = saved — plus the G3 transition. ProgramPage's START MESOCYCLE calls it (`runService.ts`); program lists show `kind = 'saved'` only; Plan gets a **Program** tab listing the run's workouts and opening the existing workout editor on the run's copy. At this stage the run copy's exercise list still drives every week live, exactly as the shared program does today, so the tab can edit it for both planning types; chunk 9 introduces the per-type rules.
**Depends on:** 1, 5. **Blocked by:** G3.
**Fact — only one run at a time (SPEC: "assumed unchanged"):** true, but only by application code. `001` says "enforced at the application layer"; no migration adds a constraint (scratch catalog: only the primary key and a non-unique `(user_id, status)` index). `useCreateMeso` (`useMesos.ts:24-35`) runs `completeAllActiveMesos` then `createMeso` — two requests, no transaction; there is no re-activate path; every reader takes `mesos.find(status === 'active')` over a list ordered newest first. Scratch: the schema accepts two active mesos for one user (R15), and two concurrent starts of the same shape leave two active runs (R8). The start function keeps the rule and closes the race (R8 with the lock: one). Live: L3 confirms you have at most one active today.
**Migration:** `v2_start_run`: new function — not destructive. G3 transition: A' is **not destructive** (adds a saved clone per program a meso uses, sets `kind = 'run'` on the originals and lineage on their workouts, fills `source_program_id`; no id changes — R6); A'' rewrites foreign keys in existing rows (sessions, week plans, planned sets, swaps); A''' changes nothing. Rollback for A': delete the clones (they're the `kind = 'saved'` rows created by the migration, recorded in a manifest table it writes), reset `kind`, `source_workout_day_id`, `source_program_id`. `check-migration`: exit 1 (function, updates).
**Verification:** scratch R6–R9 re-run on the final file; live after apply: Adam-scoped before/after counts and the R6 id-hash check on sessions, week plans, planned sets, logs and `meso.program_id`; Today/Plan/History show the same active run unchanged; the Mesocycle Analysis input for a completed meso is identical before/after (dry-run technique, compared with sorted keys — Checks that lied #2); the first real start after deploy is checked for a complete copy and lineage. **Would not catch:** Coach's daily and weekly reference for the first session of each workout in a *new* run (see "Consequences for Coach").
**Done when:** the function and transition are live, a run started through the app has its own copy, and editing that copy leaves the saved program byte-identical.

### Chunk 7 — Each planned session owns its exercise list (refactor, no visible change)
**Goal:** The workout and plan screens render from the week's own exercise list, with output identical to today.
**Scope:** migration: backfill `v2_week_plan_exercises` for every existing week plan = the workout's program exercises in program order (R5; idempotent). `weekPlanService` / `useWeekPlan` read exercises with plans; every path that creates a week plan row (ADD SET, COPY WEEK, COPY THIS WORKOUT) writes its exercise rows; `GymSession`, `SessionPreview`, `PlanPage`, `useAutoFinishSession` and `offlineCache` (+ a plain `exercises` field on the cached week plan) read the week's list; a session with no week plan still renders the workout's exercises as today. Until chunk 9, an edit to the run copy's exercise list is applied to every planned week of that run, preserving chunk 6's behaviour.
**Depends on:** 6.
**Migration:** inserts into the new table only; **not destructive**; existing rows unchanged. Rollback: delete the backfilled rows (the migration records their ids). `check-migration`: exit 1 (insert into a table that already exists by then). Because the old client could create a week plan between apply and deploy, re-run the idempotent backfill right after deploy and record "rows inserted" (expected 0).
**Verification:** live, Adam-scoped: backfilled count = Σ(program exercises of each plan's workout), 0 planned sets without an exercise row; a parity script (dry-run technique) computes the exercise list both ways for every planned session of the active run — 0 differences; jsdom snapshots of PlanPage and GymSession identical before/after; offline: prime, go offline, reload the session — same list. **Would not catch:** week-level divergence, which doesn't exist until chunk 9.
**Done when:** backfill applied and re-run, parity script reports 0 differences, deployed.

### Chunk 8 — Weeks plan themselves, from the right source
**Goal:** A week (cycle) is planned the first time it's opened in Plan or when it starts, whichever comes first, from its source — and from then on it's its own week.
**Scope:** migration: `v2_plan_week(meso, week)` — atomic and idempotent (insert … on conflict do nothing; only the caller that created a row copies into it — R10). Sources per SPEC: stable → the run copy, always; week-dependent → week 1 from the run copy, later weeks from that workout's last planned **non-deload** occurrence (using the carry fields) or empty, per `week_start`; weight and RIR targets from the last planned week for both types; tags never; `is_deload` never copied. Add `week_start` to settings (default per G4) with its Settings row; Plan's week view and Today call the function; COPY WEEK and COPY THIS WORKOUT stay as manual actions under the same source rules; the empty-state "Copy last week" on an empty week-dependent week. A pure `weekSources.ts` decides sources and is unit-tested.
**Depends on:** 7. **Blocked by:** G4; G14 if L6 finds a workout on two weekdays.
**Found in the code (fact 1, copy side):** today `copyOnePlanForward` writes `is_deload: prevPlan.is_deload` into the new week (`weekPlanService.ts:270` and `:286`), so copying a deload week makes the next week deload too. This chunk stops that.
**Migration:** new function + `week_start` column; **not destructive**; existing rows get the G4 default. Rollback: drop both.
**Verification:** scratch R10 on the final function; unit tests for source choice incl. a partly-deload week and a missing source; live: opening next week in Plan creates its rows once (Adam-scoped count; reopening adds none), contents equal the source minus tags and the deload flag; starting the first session of a new week plans it. **Would not catch:** a week started offline — that session starts without a plan, as today (stated in the chunk's notes); sequence cycles (chunk 25 reuses the function with the cycle index).
**Done when:** live; a new week appears planned on first open; the manual copy actions follow the same rules.

### Chunk 9 — Edit a week's exercises
**Goal:** In a week plan you can swap and reorder exercises (and add or remove one, per G13), with "only this week" for week-dependent runs, and the program tab of a week-dependent run becomes read-only, since weeks are now where its volume changes.
**Scope:** week actions in Plan; `weekEdits.ts` (pure carry semantics): a swap points the slot at a week-only program exercise for the replacement (its planned sets move with it); "only this week" keeps the old slot/order in the carry fields so copying forward reverts; for stable runs every week edit is a one-off. Program tab on a week-dependent run: read-only, shown as week 1's reference (every run is week-dependent until chunk 11 can create stable programs; editing a stable run's copy arrives with chunk 11). Removing an exercise from a run copy becomes a soft removal (`removed_at`). Chunk 7's "apply run-copy edits to every week" bridge is removed here.
**Depends on:** 8. **Blocked by:** G13.
**Verification:** unit tests of carry semantics (only-this-week swap/reorder then copy forward → original; permanent swap → carried); live on the active run: swap in a week with only-this-week, plan the next week → original exercise; Adam-scoped query: that week's planned sets resolve through their program exercise to the *replacement* exercise (how Coach reads planned exercises); the program tab is read-only on a week-dependent run. **Would not catch:** stable runs (chunk 11); applying a change to already-planned weeks (chunk 20); superset blocks (chunk 13 extends the reorder).
**Done when:** swaps/reorders with carry rules work live, and the week-dependent program tab is read-only.

### Chunk 10 — Priorities: focus / don't care
**Goal:** Priorities are focus / don't-care marks on muscle groups and subgroups, on the saved program and per run in the plan screen, with existing four-level marks mapped.
**Scope:** `priorityMarks.ts` (effective mark per G2(ii); the summary phrased from the group, e.g. "chest without upper chest"); `PrioritiesEditor.tsx` (groups unfolding to subgroups, each focus / don't care / left normal) for the run's copy in Plan; the start function already copies marks; migration: the four-level mapping (top → focus, low → don't care, high and normal → no row) into the run copy's marks, plus whatever G2(i) and (iii) decide.
**Depends on:** 6. **Blocked by:** G2.
**Fact — the four levels as stored:** `v2_coach_meso_tag_priorities.priority` is text with `CHECK (priority in ('low','normal','high','top'))`, default `'normal'` (024); the UI scale is low → normal → high → top (`priorityTags.ts:24`); a missing row means normal (`densifyPriorities`), while a stored `'normal'` row is explicit and Coach tells the two apart (`isExplicit`). Rows are per mesocycle, per `muscle_group` (12) or `muscle_subgroup` (22). Scratch: `'focus'` is rejected (23514) and the CHECK reads exactly the four values (R15). "The two middle levels" are therefore `normal` and `high`. Live: L2 gives your distribution.
**Migration:** writes the mapped marks; whether the old table changes is G2. Destructive only if G2 chooses to rewrite or delete old rows — then back them up into a table first. Rollback: delete the mapped marks (and restore old rows from the backup if any changed). `check-migration`: exit 1.
**Verification:** scratch R13 on the final file; unit tests of effective marks and summary wording; live: Adam-scoped before/after counts per level vs. mapped marks (MESO 2.0-style check: every top → one focus, every low → one don't care, middle levels → none); Coach's meso payload compared per G2's answer. **Would not catch:** Coach's reading of the new marks, which depends on G2.
**Done when:** the run's marks are edited in Plan in the new vocabulary and existing marks arrived mapped.

### Chunk 11 — The stepped program planner
**Goal:** Saved programs are created and edited in three steps — priorities (skippable), exercises & order with the weekday schedule, volume — and a run can be started from the planner.
**Scope:** `src/features/planner/*`: step 1 uses the chunk 10 editor on the saved program; step 2 adds workouts, exercises (existing picker), order (up/down) and one weekday per workout (no two workouts on one weekday — SPEC "later"); step 3 picks stable / week-dependent and plans sets: the number of sets per exercise is the only required value, filled for all sets at once then adjustable per set, with per-set rep targets (number / range / AMRAP); back and forward between steps; empty state "Add an exercise"; save stores the program as is; Start creates a run via chunk 6. On a stable run, the program tab edits the run's copy (exercises and sets) with the same step 2/step 3 components; changes reach weeks not yet planned (applying them to planned weeks is chunk 20). Routes: `/program/:id` opens the planner. Removed: ProgramBuilderPage, WorkoutDayEditorPage, WeeklyScheduleGrid, and the suggested-reps UI (PlanPage's "· N REPS", `ExerciseHeader`'s reps line); planned rep targets show instead in Plan and on workout rows. Plan's no-run empty state becomes "Start a program" → planner. Schedule type stays weekday until chunk 25 adds sequence (planner and scheduler together); design fields, kinds, supersets and the warmup routine arrive with their own chunks.
**Depends on:** 2, 6, 7, 8, 9, 10. **Blocked by:** G2 (via 10); G14 if L6 finds a workout on two weekdays.
**Verification:** in the running app: create a program (3 workouts, Mon/Wed/Fri, stable, 3 sets each with an 8–12 range), save; Adam-scoped queries show the program, workouts, schedule, exercises and sets exactly as entered; reopen and save unchanged → no row changes (`updated_at` aside); start it → run copy equals the template (chunk 6 check) and week 1 is planned with those sets (chunk 8); the workout screen shows "8–12"; a week-dependent program saves its sets as week 1; on the stable run just started, an exercise added in the program tab appears in the next unplanned week only and the planned current week is unchanged (Adam-scoped); the saved program stays byte-identical; old builder routes no longer exist; 375 px. **Would not catch:** fields added by later chunks.
**Done when:** the old builder is gone and every saved-program edit happens in the planner.

### Chunk 12 — Remove suggested reps from the schema
**Goal:** The `target_reps` column is gone, with its values kept or converted as you decide.
**Scope:** migration: backup table (exercise id, value, and the ids of any planned sets converted), the optional conversion, `alter table v2_program_exercises drop column target_reps`; the last code references (types, mappers, the start function and clone code) removed — the UI went in chunk 11.
**Depends on:** 11.
**Decision at build time (SPEC: "blocking decision"):** what happens to existing values — (a) discard after backup; (b) convert into rep targets on the active run's unlogged planned working sets that have none (R14: 34 such sets on the fixtures); (c) other.
**Migration:** **destructive** — drops a column with data. Changes: every suggested-reps value leaves the live table (kept in the backup); with (b), planned sets of the active run gain rep targets. Rollback: re-add the column and restore from the backup; with (b), clear the converted sets listed in the backup. Precondition: no device may still run a bundle older than chunk 11 — the old client inserts `target_reps` (`programService.addProgramExercise`) and would fail after the drop; accept the update banner on every device first. `check-migration`: exit 1 (drop).
**Verification:** scratch R14 re-run (rollback fingerprint must match); live: `grep -rn target_reps src api` = 0 before apply; Adam-scoped count of non-null values before = backup row count; API probe `select=target_reps` → `400 / 42703` after; one planner save and one workout screen render after the drop. **Would not catch:** an old bundle still open somewhere — hence the precondition.
**Done when:** the column is gone, the backup holds every value, and the app runs with no reference to it.

### Chunk 13 — Supersets
**Goal:** Exercises can be grouped into supersets that render as a block of rounds, with the current set zigzagging through the round, and every reorder moves a superset as one block.
**Scope:** planner step 2 groups exercises (`superset_block_id`, any number of exercises); regrouping in a running program waits for G13; `supersetRounds.ts` builds rounds (round 1 = A1, B1, C1; unequal counts allowed — 4 of A and 3 of B gives 4 rounds, round 4 holds only A; leftover sets stay in the block) and the zigzag order; `SupersetBlock.tsx` on the workout screen renders rounds in that order, so the existing "current set" button (first `[data-unlogged-set]` in DOM order) follows A1 → B1 → A2; reorders in the program tab and week plan move the block as a unit (session reorder is phase 2); "last time" stays per exercise. Superset rest overrides are authored and timed in chunk 16.
**Depends on:** 9, 11. **Blocked by:** G13, for mid-run regrouping only.
**Verification:** unit tests (rounds, empty slots, zigzag); a real session with a 2-exercise superset of 4 and 3 sets: block shows 4 rounds, round 4 has one row, the current-set button visits A1, B1, A2, …; reorder in the week plan moves both exercises together (Adam-scoped positions); the run copy carries the block (chunk 6 copy). **Would not catch:** rest timing inside a round (chunk 16).
**Done when:** supersets can be planned and render as rounds live.

### Chunk 14 — Staged sets: all four stage kinds
**Goal:** A set can be planned as a dropset, rest-pause, myo-reps or cluster in the planner or the week plan, and logs as one set with its stages, the non-dropset kinds carrying the previous stage's weight by default.
**Scope:** planner step 3 and the week plan: set kind staged, stage kind, its stages; the workout screen labels stages by kind; each non-dropset stage's weight defaults to the previous stage's (dropset stages behave as today); logs record `stage_kind` on the head; stage rows keep `is_dropset = true` for existing readers; a head with stages and no kind reads as a dropset; stages never count as separate sets except in volume (existing rule, `setGroupLogic` unchanged); deleting a head deletes its stages (existing cascade).
**Depends on:** 3, 11.
**Verification:** unit tests for carry-over; a real session with a planned rest-pause set of 3 stages: all rows render from the start, locked in turn (chunk 3), stage weights default to the head's weight; Adam-scoped query: head `stage_kind = 'rest_pause'`, stages linked with `stage_index` 1–2; Progress/History set counts unchanged by stages, volume includes them; `setGroupLogic.test.ts` and Coach tests pass unmodified. **Would not catch:** stage-rest timing (chunk 16).
**Done when:** all four kinds can be planned and logged live.

### Chunk 15 — Warmup sets
**Goal:** Warmup sets are planned in step 3, logged with optional weight and reps (rows) or ticked (tick), and never counted in volume, set counts or "last time" matching.
**Scope:** migration: relax `v2_set_logs_check` (R11) and redefine `v2_history_session_summary` and `v2_session_type_history` so `set_count` excludes warmups (R12); planner step 3 and the week plan offer warmup sets; the workout screen shows them per the `warmup_display` setting (`rows` default with optional numbers, or `tick`), with a rest timer and nothing else; the Settings row; logging writes `is_warmup = true`; app-side counts exclude warmups — set numbering (`ExerciseCard`), Today's completed count, History detail, Progress — and reference matching ignores them; `scripts/check-warmup-consumers.mjs` lists every set-count consumer with its filter.
**Depends on:** 11. **Blocked by:** G1.
**Migration:** constraint relaxation + two view redefinitions; **not destructive** (no data changes; volume in the views already excludes warmups). Rollback: restore the 001 check (only possible while no numberless warmup exists — the rollback script checks first) and the 009/011 view bodies. Confirm the live constraint name before applying (L7). `check-migration`: exit 1.
**Verification:** scratch R11–R12 on the final file; unit tests per counting helper; real session in both display modes: a ticked warmup stores `weight`/`reps` NULL with `is_warmup` true (Adam-scoped); the session's set count in History excludes it; the consumer script shows a warmup filter on every app-side count. **Would not catch:** Coach's rollups — that is G1.
**Done when:** warmups can be planned, shown both ways and logged, and no app-side count includes them.

### Chunk 16 — The rest chain
**Goal:** The rest timer uses the most specific value — the set's own override, then on an exercise's last set its "rest after", then the exercise's rest, then the global setting — with SPEC's superset and staged-set rules.
**Scope:** rest design fields in the planner (saved programs) and the program tab (run copy only, applying from the next session on): exercise rest, rest after, set rest override, superset rest within a round / after a round, stage rest; `restChain.ts` resolves the value (superset default: no timer between exercises within a round, the block's rest after each round; staged: dropset no timer, others 15 s unless overridden; warmups follow the same chain); `restTimerStore` carries a per-rest target or "no timer"; `RestTimer` / `RestTimerInline` show it. The workout screen reads design fields from the run copy when the session loads.
**Depends on:** 13, 14. **Blocked by:** G10.
**Verification:** resolver unit tests, one per chain level and per superset/stage case; a real session: after set 2 the target is that set's override; after the last set it's "rest after"; inside a superset round no timer starts; after the round, the block's rest; a dropset stage starts no timer, a rest-pause stage 15 s; changing a rest in the program tab shows on the next session load. **Would not catch:** interaction with the Start Set flow beyond its existing tests (`measure_set_time` unchanged).
**Done when:** the timer target follows the chain live.

### Chunk 17 — Tempo
**Goal:** Each exercise can carry a tempo in the program (e.g. `3-1-1-0`, `X` allowed), shown next to the exercise during the workout and never tracked.
**Scope:** tempo field in the planner and the program tab (design field, run copy only), validated by chunk 2's parser; `ExerciseHeader` shows it.
**Depends on:** 2, 11.
**Verification:** parser cases already in chunk 2's tests; a real session shows the tempo beside the exercise name; a tempo edited in the program tab shows on the next session load; no tempo column appears on any log row (nothing tracked). **Would not catch:** tempo on swapped-in or added exercises (they have none unless set on their slot).
**Done when:** tempo is planned and visible during the workout.

### Chunk 18 — Warmup routine
**Goal:** Each workout carries an ordered checklist shown at the top of the session; items tick off and nothing is logged.
**Scope:** items editor in planner step 2 and the program tab (design field); `WarmupRoutineChecklist.tsx` at the top of `GymSession`; tick state is client-only per session (`warmupRoutineStore`, kept in localStorage keyed by session id so a reload keeps it; never sent to the database).
**Depends on:** 11.
**Verification:** a real session shows the items in order; ticks survive a reload; no network write on tick (request log) and no new rows (Adam-scoped counts). **Would not catch:** ticks across devices — by design nothing is stored.
**Done when:** the checklist renders and ticks live.

### Chunk 19 — Week targets and tags
**Goal:** The week plan carries per-set weight targets, rep-target overrides, RIR targets and tags, all shown on the workout screen's set rows.
**Scope:** Plan's set rows edit weight target (in the exercise's unit, stored kg), rep target (the week's override), RIR (exists), tags (preset list + custom text; "Apply to all sets"); `PlanTargetsPanel` and `SetRow` show them; a set without a target shows none; AMRAP counts as a working set and its RIR defaults to 0, editable. Copying (chunk 8) already carries weight and RIR and never tags.
**Depends on:** 8, 11. **Blocked by:** G11.
**Verification:** unit tests on formatting; live: set targets and a tag in week N → shown on the workout rows; plan week N+1 → weights and RIR carried, tags empty (Adam-scoped). **Would not catch:** RPE display (phase 2).
**Done when:** targets and tags can be planned and are visible during the workout.

### Chunk 20 — "Apply this change to planned weeks ahead"
**Goal:** After an edit in a week — or a stable program-tab edit — when later weeks are already planned, you can apply just that change to them.
**Scope:** a change record (edit type, slot, set position, new value) for every edit type from chunks 9, 13, 14, 19 and stable program-tab volume edits; `applyAhead.ts` applies one change to later planned weeks, touching nothing else; offered only when later planned weeks exist; both planning types.
**Depends on:** 9, 13, 14, 19.
**Verification:** unit tests: a weight change touches only that set in later weeks; a swap applied ahead swaps only that slot; other edits in those weeks untouched; live on two planned weeks (Adam-scoped diff). **Would not catch:** edit types added after this chunk — each later chunk that adds one extends `applyAhead.ts` and its tests.
**Done when:** the offer appears exactly when later planned weeks exist and applies only that change.

### Chunk 21 — Deload is a property of a session
**Goal:** Deload is marked per session or for a whole week, deload sessions are visibly marked, and they are never a copy source or a "last time" reference.
**Scope:** Plan: mark a session; "Mark this week as deload" marks every planned session of the week; visible marking; labels per session on Today, preview and workout screen ("DELOAD" for that session, not "DELOAD WEEK"); copy sources already skip deload sessions (chunk 8); last-time exclusion lands in chunk 23. With no rules on, marking changes only how the session is treated; its contents are planned by hand.
**Depends on:** 8.
**Fact — how deload is stored today:** one boolean per **planned session**, not per week: `v2_week_plans.is_deload`, a row per (meso, workout, week) — unique `(mesocycle_id, workout_day_id, week_number)` (001; scratch catalog R15). It is the only stored deload column; the history views derive theirs through `v2_sessions.week_plan_id` (009/011), as do Progress (`progressService.ts:107`) and Coach daily (`analysisInput.ts:385-389`). Plan toggles it per workout panel, and only once that workout has a plan row (`PlanPage.tsx:346-354`); there is no whole-week action, yet Today labels it "DELOAD WEEK" (`TodayPage.tsx:136-143`). Coach's Mesocycle Analysis collapses it to "a week is deload if any planned row in it is" (`mesoAnalysisInput.ts:652`, `mesoWeekRollup.ts:74`). Copy-forward copies the flag (chunk 8). Sessions started without a plan have no deload information (views treat them as normal). **Consequence: moving deload to per-session marking needs no data migration** — the change is the week shortcut, the labels, the copy rules and the rules engine. Exception: a workout on two weekdays shares one row (G14/L6). Live: L1 shows how your deload rows are spread.
**Verification:** live: "Mark this week as deload" sets `is_deload` on every planned row of that week (Adam-scoped), unmarking one session clears only that row; Today and the workout screen show "DELOAD" on marked sessions only; plan the next week → it copies from the last normal occurrence, not the deload one. **Would not catch:** rules (chunk 22).
**Done when:** per-session marking and the week shortcut work live, with correct labels.

### Chunk 22 — Deload rules
**Goal:** With rules switched on, a session marked deload is pre-calculated from the last normal week — its planned sets, and the weights actually logged in it (planned weight where nothing was logged) — using the global rules or the program's override.
**Scope:** `deloadRules.ts` (pure: sets −% or −n with rounding up/down, never below 1; weight as % of base rounded up/down to a precision step in kg or lbs; reps ±n; RIR +n; each independent and optional; defaults per SPEC); Settings: default deload rules editor; planner step 3 / program: the override; on marking (chunk 21) with rules on, the session's planned sets are replaced by the calculated ones and stay hand-editable.
**Depends on:** 11, 21. **Blocked by:** G9.
**Migration:** none (columns from chunk 1).
**Verification:** calculator unit tests (4 sets −50% → 2 either way; 3 sets −50% → 1 down / 2 up; 1 set −50% → 1; 82.5 kg × 90% = 74.25 → 72.5 down / 75 up at 2.5 kg; a lbs step); live: rules on, mark a session → its planned sets equal the calculator's output from the last normal week's logs (Adam-scoped); a program override wins over the global default. **Would not catch:** scheduled deloads (SPEC: later).
**Done when:** marking with rules on produces the calculated plan live.

### Chunk 23 — "Last time" matches by exercise
**Goal:** The reference panel matches by exercise across runs, never uses deload sessions, labels LAST WEEK only per G7, and for sequence runs always shows LAST TIME with elapsed time and hides EARLIER THIS WEEK; FIRST TIME only when the exercise has truly never been done.
**Scope:** `referenceByExercise.ts` beside `referenceLogic.ts`, whose existing exports stay byte-identical because Coach's `analysisInput.ts` imports them; a candidate query by exercise id over all completed sessions with the deload flag through `week_plan_id` (today's query is per workout day — `sessionService.ts:523-547`); elapsed time from `moved_to_date` when set; warmups never matched; `ExerciseReference` and its offline fallback; reordering never affects matching.
**Depends on:** 21. **Blocked by:** G7.
**Verification:** unit tests per rule (previous week normal → LAST WEEK; previous week deload → per G7; done only in another workout → LAST TIME; done only in an earlier run → LAST TIME; sequence → LAST TIME and no EARLIER THIS WEEK); `git diff` shows no change to `referenceLogic.ts` and Coach's tests pass unmodified; live: an exercise last done in a different workout shows LAST TIME with the right elapsed days. **Would not catch:** Coach's own reference (unchanged by design).
**Done when:** the live panel follows the new rules.

### Chunk 24 — Weekday runs: move a session, several sessions a day
**Goal:** In a weekday run any session can be moved to another day of the same week, a day can hold several sessions (listed, each opening on its own), and Today's empty state shows the next scheduled session and when it's due.
**Scope:** "Move this session" on Today and in Plan writes `moved_to_date` (creating a `planned` session row when the session hasn't started); `scheduler.ts` returns the sessions due today (scheduled and not moved away, plus moved here); `TodayPage` lists them; one session in progress at a time, as today; the missed-session prompt per G6; the empty state. History keeps showing a session under its planned `date` (as DO IT NOW does today; clock times are phase 2).
**Depends on:** 8. **Blocked by:** G6.
**Fact — today's skip / do it the next day:** verified by running the production `schedule()` (scenarios S0–S10) and reading the prompt and services:
- The scheduler walks from 7 days back — never before the meso start — to yesterday; a weekday the program schedules is **missed** unless *some* session dated that day is `completed`, `in_progress` or `skipped`, whichever workout it is (S0, S6, S7). Last week's days are included (S6). A `planned`-status row doesn't count (S9).
- Each missed date resolves its own week's plan (S1). Missed sessions take over Today before today's workout: "Catch up on missed sessions…" plus a sheet listing them newest first (`TodayPage.tsx:62-78`, `MissedSessionPrompt.tsx`).
- **DO IT NOW** creates the session with `date` = the **missed** date, `started_at` = now, in progress (`createSession`; S3); it works offline. After it completes, today's own workout is offered again, so two can be done on one day, and History shows the caught-up one under the missed date (S4).
- **MARK SKIPPED** inserts a `skipped` row for the missed date, or marks an existing row skipped (`skipMissedSession`; S5); online only (`useSkipMissedSession` has no offline branch).
- **Dismiss** (X or backdrop) skips to today's workout for that screen mount only (`useState`), writes nothing, and the prompt returns on the next mount until the day leaves the 7-day window (S2).
- One workout on two weekdays: both dates are expected and share one plan row (S8). `completed_today` looks only at sessions dated today (S10).
**Verification:** scheduler unit tests (move Mon → Fri; swapping two days = two moves; moving onto a day that has one → both listed; the G6 behaviour); live: move a planned session, Today shows it on the target day and not on the original; a `planned` row with `moved_to_date` exists (Adam-scoped). **Would not catch:** sequence runs (chunk 25).
**Done when:** moves and multi-session days work live.

### Chunk 25 — Sequence runs
**Goal:** A program can run as an ordered sequence of workouts and rest days not tied to dates, the cycle replacing the week everywhere the week is used.
**Scope:** planner step 2 gains the schedule type and a sequence editor (workout and rest-day slots, up/down); `sequenceSchedule.ts`: the next workout = the slot after the last workout done, due after the rest days between them counted from that day (A on Monday with two rests → B due Thursday); not training on a due day misses nothing; "Train anyway" on a rest day starts the next workout and the remaining rest days disappear; "Skip" drops a workout and the sequence moves on (due date per G8); cycles are week plans with `week_number` = cycle index (planning via chunk 8); labels "Cycle n"; "Mark this cycle as deload"; Today: next workout and when it's due, or on a rest day the next workout with "Train anyway"; reference per chunk 23's sequence rule.
**Depends on:** 8, 11, 23. **Blocked by:** G8.
**Verification:** unit tests for due dates (rests counted from the last workout; missed due day shifts; Train anyway; Skip per G8; cycle rollover); live on a sequence test run (a throwaway run writes — needs your go-ahead): Today shows the right next workout on a rest day, Train anyway starts it, the next due date counts from that session. **Would not catch:** Coach's weekly analysis on a sequence run (see "Consequences for Coach").
**Done when:** a sequence program can be planned, started and trained live.

### Chunk 26 — Navigation: the program screen folds into Plan
**Goal:** PROGRAM leaves the bottom bar and everything it offered is reachable from Plan.
**Scope:** `Nav.tsx` (TODAY, PLAN, PROGRESS, HISTORY, LIBRARY, SETTINGS, + COACH for the Coach user — the phase-2 bar is not part of this), `App.tsx` (redirect `/program` → `/plan`), Plan's sections per G12.
**Depends on:** 6, 11. **Blocked by:** G12.
**Verification:** a checklist of every former PROGRAM capability, each reached from Plan in the running app; old deep links redirect; 375 px. **Would not catch:** phase 2's navigation.
**Done when:** PROGRAM is gone from the bar and nothing it did is lost.

---

## Consequences for Coach (no decision needed unless you object)

Phase 1 changes no Coach code (SPEC: Coach stays exactly as it is). Unchanged Coach reads the plan through `program.schedule`, `v2_week_plans` / `v2_week_plan_sets` → `v2_program_exercises`, `workout_day_id` equality and `v2_coach_meso_tag_priorities`. What it will then see:
- **New runs get new workout ids** (chunk 6). Daily and weekly analysis find their reference by `workout_day_id` (`analysisInput.ts`), so the first session of each workout in a run started after chunk 6 reads as `first_time`; today a new meso of the same program shares ids and finds the previous meso. Runs moved over by G3 A' keep their ids.
- **Sequence runs** (chunk 25): weekly analysis derives expected sessions from `program.schedule` (`weekResolution.ts`), which is empty for sequence programs, so no week of a sequence run becomes analyzable.
- **Moved sessions** (chunk 24) keep their planned `date`, so Coach reports them on the planned weekday.
- **Rest-pause, myo-reps and cluster stages** (chunk 14) look like dropset stages to Coach.
- **Week-level swaps** (chunk 9) stay readable: the planned sets point at the replacement through a week-only slot, so Coach sees the exercise that was actually planned.
- Logged warmups (G1) and priorities (G2) are open gaps, not accepted consequences.

---

## Live-data checks for Adam

Run in the SQL Editor (it bypasses RLS, so every query that reads rows filters to your id explicitly; the catalog queries read no user rows). Nothing here writes. All eight were run on the scratch copy first: with your id they return only catalog rows (no such user there), and with the fixture account they return the expected shapes — L6 finds the fixture's workout on two weekdays.

```sql
-- L1 · fact 1: how deload is spread across planned sessions, per week
select m.name as meso, wp.week_number, count(*) as planned_sessions,
       count(*) filter (where wp.is_deload) as deload_sessions
from v2_week_plans wp join v2_mesocycles m on m.id = wp.mesocycle_id
where wp.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
group by m.name, wp.week_number
having count(*) filter (where wp.is_deload) > 0
order by m.name, wp.week_number;

-- L2 · fact 2: four-level rows per meso, and the constraint as applied
select m.name, m.status, p.tag_type, p.priority, count(*)
from v2_coach_meso_tag_priorities p join v2_mesocycles m on m.id = p.mesocycle_id
where p.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
group by 1, 2, 3, 4 order by 1, 3, 4;
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'v2_coach_meso_tag_priorities'::regclass and contype = 'c';

-- L3 · fact 3: runs by status, and the indexes on v2_mesocycles
select status, count(*) from v2_mesocycles
where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' group by status;
select indexdef from pg_indexes where tablename = 'v2_mesocycles';

-- L4 · fact 4: sessions done on a later day than the day they were for (DO IT NOW)
select date, (started_at at time zone 'Europe/Warsaw')::date as started_on, status
from v2_sessions
where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  and started_at is not null and (started_at at time zone 'Europe/Warsaw')::date <> date
order by date desc limit 30;

-- L5 · G3 sizing: programs and the mesos that use them
select p.name, count(m.id) as mesos, count(m.id) filter (where m.status = 'active') as active
from v2_programs p left join v2_mesocycles m on m.program_id = p.id
where p.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' group by p.name order by p.name;

-- L6 · G14: a workout on two or more weekdays
select p.name, j.value as workout_day_id, count(*) as weekdays
from v2_programs p, jsonb_each_text(p.schedule) as j(key, value)
where p.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and j.value is not null
group by p.name, j.value having count(*) > 1;

-- L7 · chunk 15: the set-log check's live name, and that no warmup rows exist yet
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'v2_set_logs'::regclass and contype = 'c';
select (select count(*) from v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and is_warmup) as warmup_logs,
       (select count(*) from v2_week_plan_sets where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and is_warmup) as warmup_planned;

-- L8 · chunk 12: suggested-reps values that exist
select count(*) filter (where target_reps is not null) as with_reps, count(*) as total
from v2_program_exercises where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f';
```

---

## At every chunk boundary

- Run every script in `scripts/` plus `npm run typecheck`, `npm test`, `npm run build`; a chunk adds its verification scripts there. That includes `node scripts/verify-rls.mjs` (needs `RLS_TEST_EMAIL` / `RLS_TEST_PASSWORD` for a test account that owns no data — never yours; they are set in this environment). Its selects are unfiltered by design — RLS probes as anon and as the test account — so it is a live read outside the Adam-scoped rule: ask before each run. Its 2026-10-03 run: 25 tables, 50 probes, all pass.
- CONTEXT rule: a table the app starts reading or writing joins `TABLES` in `scripts/verify-rls.mjs` in the same change. First users of the new tables: `v2_week_plan_exercises` → chunk 7, `v2_program_priorities` → 10, `v2_program_sets` → 11, `v2_program_superset_blocks` → 13, `v2_workout_warmup_items` → 18, `v2_program_sequence_items` → 25. (Postgres functions are not probed — the script never calls an RPC.) Not earlier: PR #6's `verify-rls-tables.test.mjs`, if it reaches master, fails when `TABLES` names a table no code uses.
- A chunk with a migration stops at a blocking DECISIONS.md entry until you say it's applied; the code that needs it merges after.
- Live verification is a hard gate where the chunk names one; probe the browser tooling first (Escalation 1). Every live query is Adam-scoped.
- A live check that writes (a throwaway program, run, session or set) needs your go-ahead first; its rows are labelled `TEST-…`, deleted in FK-safe order, and the cleanup is proven with counts against the baseline. Otherwise the check waits for your own next real session.
- Check UI at 375 px. Coach code is not touched unless G1/G2 say so; `referenceLogic.ts` and `setGroupLogic.ts` keep their existing exports byte-identical.
- Update CONTEXT.md, move what's no longer true to HISTORY.md.
