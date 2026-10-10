# TASKS-1.1.md — Overload Planner Extension, revision 1.1

**Spec:** SPEC.md, the rules tagged **[P1.1]** (SPEC change 1.1, decided 2026-10-10 during the phase 1 review, applied to SPEC.md in `ac48b66`). This file plans those rules only; everything else stays as phase 1 built it (TASKS.md).
**Status:** draft, written 2026-10-10 in a planning-only session. No application code was written. Nineteen spec gaps (G16–G34) are open; every chunk that needs one stops there and picks no answer.
**Numbering** continues from TASKS.md so references never collide: chunks 27–37, migrations from 038, spec gaps from G16 (phase 1 used G1–G15).
**Baseline:** master `d345f5c`; migrations 001–037 live (next number 038); `npx vitest run` passes 1782 tests in 141 files there (run in this session).
**Two things the brief adds to TASKS.md's format:**
- Every rule's verification names the call site or screen-level assertion that proves it's wired, not only the pure function.
- Every chunk says what the live app shows after it merges. Nothing changes what an existing week shows until the chunk that replaces it is complete ("Live app safety").

---

## Spec gaps

I read all of SPEC.md after the [P1.1] edit for statements the change contradicts or leaves unsaid that a chunk needs. Each gap gives the SPEC text (line numbers are SPEC.md at `ac48b66`), what the change says, what's unsaid, today's behaviour where it helps (as context, not a recommendation), and the chunks that stop there. None is answered here.

| Gap | In short | Chunks that stop there |
|---|---|---|
| G16 | Stage rows' numbers and warmup sets: Sets view or Structure view? | 29 |
| G17 | COMPACT and the page-level actions in a two-view Plan | 29 (36 for its action's place) |
| G18 | Sessions with no week plan: whose rest, tempo and routine? | 31 |
| G19 | A week swap: does the slot keep its rest and tempo? | 31 |
| G20 | Weeks that start empty: routine and highlighting | 33, 35 |
| G21 | Superset grouping: per week or per run? | 34 (35, 37 in part) |
| G22 | Highlighting compares with the source as it is now, or as it was? | 35 |
| G23 | How removals, order changes and hidden values show, and how a row finds its source row | 35 |
| G24 | Stable runs: weights and RIR from the default or from last week? | 36 (35 in part) |
| G25 | Is "the run's default" the run's copy? | 36 (35 in part) |
| G26 | After "Make this week the new default": what does apply-ahead apply? | 36 |
| G27 | Making a week with deload sessions the default | 36 |
| G28 | Making a cycle the default when a workout appears twice | 36 |
| G29 | How "Make this week the new default" is offered: past weeks, a confirm step, an undo | 36 |
| G30 | Program-tab edits the change gives no home (schedule, workouts, units, deload override) | 37 |
| G31 | Do completed runs' priorities pages become read-only? | 28 (its completed-runs part) |
| G32 | Stable runs between the data move and "Make this week the new default": how is a permanent rest, tempo or routine change made? | 32, 33 |
| G33 | Applying a routine edit ahead: how is "the same item" found in later weeks? | 32 |
| G34 | Numbers with nothing to compare against: week 1's weights and RIR (and stable weeks', per G24) | 35 |

### G16 — Stage rows' numbers and warmup sets: which view?
- **SPEC (Plan screen, L543–555):** Sets = "the number of sets, weight, reps and RIR per set, and tags"; Structure = "set kinds (warmup, staged sets and their stages)".
- **Also SPEC:** a stage row has its own weight and reps ("each as a row with weight and reps", Planned staged sets render). A warmup set has weight and reps targets and no RIR.
- **Settled by rule 1:** adding, removing and kinding stages belongs to Structure ("staged sets and their stages").
- **Unsaid:**
  - Are a stage's numbers edited in Sets (with the other numbers) or in Structure (with its stages)?
  - Do warmup sets appear in Sets with their numbers?
  - Does "the number of sets" (Sets) cover adding and deleting warmup sets, or is that Structure's "set kinds (warmup …)"?
- **Today:** one row layout holds all of it. The set's ⋯ has ADD STAGE, STAGE KIND, tags and DELETE SET; the exercise's ⋯ has ADD WARMUP SETS.
- **Stops:** chunk 29 (where a stage's numbers, warmup sets, ADD WARMUP SETS and a warmup set's DELETE go).

### G17 — COMPACT and the page-level actions in a two-view Plan
- **SPEC:** rule 1 says what each view holds and nothing about Plan's other controls.
- **Unsaid:**
  - Where the page-local COMPACT toggle goes (it collapses plain set rows, read-only; DECISIONS D6): Sets view, both views, or gone?
  - Where the page-level actions sit: COPY WEEK, MARK WEEK AS DELOAD, the per-session DELOAD toggle, MOVE THIS SESSION, the apply-ahead banner, and the new "Make this week the new default". Above both views as now, or inside one?
- **Stops:** chunk 29, and chunk 36 for its own action's place.

### G18 — Sessions with no week plan
- **SPEC:** rest, tempo and the warmup routine are per week in a run (Rest, Tempo, Warmup routine [P1.1]).
- **Also:** a session started before its week was planned has no week. That's an offline start; TASKS.md chunk 8 says "that session starts without a plan, as today".
- **Today:** such a session shows the run's copy, which is also what every planned session shows.
- **Unsaid:** what it shows after this. The options are the run's copy (which, for a week-dependent run, holds week 1's values rather than this week's), its week's values once the week gets planned, or nothing.
- **Stops:** chunk 31 (the read path's no-week case).

### G19 — A week swap and the slot's rest and tempo
- **SPEC:** rule 1 puts swap and rest in the same Structure view. Nothing says what a swap does to that slot's per-week values.
- **Today:**
  - a week swap points the slot at a new week-only exercise row (`createWeekOnlyProgramExercise`) that has no rest, rest after or tempo;
  - its sets show no rest override, because the workout screen looks overrides up among the swapped-in slot's own program sets (`GymSession.tsx` L575) while the moved sets' `program_set_id` still names the original slot's;
  - the swapped-in exercise keeps the slot's superset block.
- **Unsaid:** does a swapped-in exercise keep that week's rest, rest after, tempo and its sets' own rest? Or does it start without them, as today?
- **Not affected:** the mid-workout swap (rule 9: unchanged).
- **Stops:** chunk 31 (`swapWeekExercise`, `repointWeekExercise`).

### G20 — Weeks that start empty
- **SPEC (Weeks and copying, L210–212; Settings, L622):** the setting "NEW WEEK STARTS: copy / empty" stays. Rule 2 doesn't mention it, and rule 9 keeps "the copy-source rules".
- **With "empty":** a new week-dependent week gets no exercises or sets, so it has no rest or tempo to carry.
- **Unsaid:**
  - Does an empty week also start with no warmup routine, or with one from somewhere (its source, or the program)?
  - What is it highlighted against? Its source is still the last normal occurrence, so everything would read as removed (G23).
- **Stops:** chunk 33 (an empty week's routine) and chunk 35 (its highlighting).

### G21 — Superset grouping: per week, or per run?
- **SPEC (Supersets, L303–305; not in a section the change names, so unedited):** "Superset grouping is a design field: in a running program it's changed in the program tab, for both planning types, applying from the next session."
- **The change:**
  - removes the program tab (rule 6);
  - lists "superset grouping" in the week's Structure view (rule 1) and "groupings" among highlighted differences (rule 3);
  - but rules 6 and 7 and "Existing data" name only rest, tempo and the warmup routine as per week.
- **Unsaid:** is grouping per week, or run-wide and edited from the week? Per week means copied by the source rule, highlighted, included in "Make this week the new default", and written into planned weeks by the data move.
- **Note:** superset rest is per week either way (Rest [P1.1]), but how it's stored depends on the answer.
- **Stops:** chunk 34 entirely. Chunk 35 stops for groupings. Chunk 37 stops for grouping's home if it's run-wide.

### G22 — What a week is compared against for highlighting
- **SPEC (Plan screen, L556):** "Anything different from the week's source is highlighted."
- **Unsaid:** the source as it is now, or as it was when the week was planned?
- **If "as it is now":**
  - editing week 4 after week 5 was planned changes week 5's highlights;
  - after "Make this week the new default", every planned stable week is compared with the new default;
  - week 1's source ("the program") must still exist as it was, but the saved program can be edited in the planner during the run, and the run's copy may since have been made the default (G25).
- **If "as it was when planned":** every week needs its source's content stored when it's planned. Weeks planned before this ships have none, so what are they compared with?
- **Stops:** chunk 35.

### G23 — How differences without a row of their own show
- **SPEC:** rule 3 highlights "sets, exercises, order, … warmup routine items".
- **Unsaid:**
  - **(a) Removals.** How is something the source has and this week doesn't shown? A removed exercise, set, stage or routine item has no row to highlight.
  - **(b) Order.** Which rows count as moved when one moves? An insert shifts every row after it.
  - **(c) "In both views".** Does each view mark only differences in what it shows, or also ones that live in the other view? When a differing value sits behind ⋯ (the standing UI rule), is the ⋯ marked?
  - **(d) Which source row a row is compared with.** Matching exercises by their row (`program_exercise_id`, as copying and apply-ahead do) would show a week swap as one exercise removed and another added, because a swap makes a new row (G19). Matching sets by position would show every set after an added warmup set as changed.
- **Stops:** chunk 35.

### G24 — Stable runs: where weights and RIR come from
- **SPEC (Weeks and copying, L213; unchanged, and rule 9 keeps "the copy-source rules"):** "Source of weight and RIR targets: the last planned week, for both types."
- **SPEC (Targets, L247, L250):** weight and RIR targets live "in the week plan only. Never in the program."
- **The change:**
  - rule 2 (L214–219): a new week "copies everything from [its source] except tags and the deload flag", and a stable week's source is "the run's default";
  - rule 4 (L232): "this week's content (everything except tags) becomes the run's default".
- **Today:**
  - a stable week takes its sets from the run's copy and its weights and RIR from the last usable week (037's `'program'` branch plus its weight/RIR mapping);
  - the run's copy has no weight or RIR columns.
- **Unsaid:** for a stable run, does a new week take weights and RIR from the default, or from the last planned week as today?
  - From the default: "Make this week the new default" stores them, and new weeks repeat those numbers until the next one.
  - From the last planned week: the default holds no numbers. Then what are a stable week's numbers highlighted against?
- **Stops:** chunk 36, and chunk 35 for numbers in stable weeks.

### G25 — Is "the run's default" the run's copy?
- **SPEC (Weeks and copying, L210, unchanged):** "Source of a new week's volume: `stable` → the run's copy, always."
- **SPEC (Objects stored → Run, L96):** "its own copy of the program's plan (what the program tab shows and edits)".
- **The change:** rules 2 and 4 call the stable source "the run's default", and "Week 1 of any run starts from the program".
- **Unsaid:** are these the same thing? If so, "Make this week the new default" rewrites the run's copy, and week 1's "program" is the copy as it was at the start (G22). If not, the default is kept separately and the run's copy stays as it was copied.
- **Stops:** chunk 36 (where the default is written), and chunk 35 for what stable weeks and week 1 are compared with. Chunks 31–33 don't stop: they keep the run's copy as the stable source, which is what L210 says today.

### G26 — After "Make this week the new default", what does "Apply this change to planned weeks ahead" apply?
- **SPEC:** rule 4: it "offers the existing 'Apply this change to planned weeks ahead'". That action "applies only the change just made; leaves everything else in those weeks alone" (L228–230). Today it applies one edit record.
- **The problem:** making a week the default can change many things at once.
- **Unsaid:** which of these does it do?
  - apply the difference between the old default and this week, each part only where a later week still matches (skipping where it differs, as chunk 20 does);
  - replace the later weeks with the new default;
  - something else.
- **Stops:** chunk 36.

### G27 — Making a week with deload sessions the default
- **SPEC:** rule 4 makes "this week's content" the default. Deload sessions "differ by design" (rule 3's default) and are never a copy source (L221–223).
- **Unsaid:**
  - In a partly deload week, does a deload session's content become its workout's default, or does that workout keep its current default?
  - Is the action offered on a week that is all deload?
- **Stops:** chunk 36.

### G28 — Making a cycle the default when a workout appears twice
- **SPEC:** a sequence may repeat a workout ("A, B, A, rest", L398).
- **Also:** copying is per slot (TASKS.md chunk 25), but the run's copy holds one plan per workout.
- **Unsaid:** when the cycle's two A's differ, which becomes A's default? Or is the default per slot?
- **Stops:** chunk 36 (stable sequence runs only).

### G29 — How "Make this week the new default" is offered
- **SPEC:** rule 4: "One action per week".
- **Today:** Plan shows past weeks read-only ("PAST WEEK — READ ONLY").
- **Unsaid:**
  - Is the action offered on a past week (e.g. making last week, as trained, the default), or only on the current and later weeks?
  - It replaces the run's default, and nothing keeps the previous one. Is there a confirm step, or an undo?
- **Stops:** chunk 36.

### G30 — What the program tab edits that the change gives no home
- **SPEC:** rule 6: "Everything it did now happens in the week: design fields … stable volume …".
- **Today:** the tab also edits the run's copy, through the planner's own components (`ProgramTab.tsx` → `StepExercises` / `StepVolume`):
  - **(a) The schedule:** WEEKDAY/SEQUENCE, a weekday per workout, and the sequence order with rest days. It's never read-only, for both planning types. Plan's empty states "Set up weekly schedule →" and "Set up the sequence →" open the tab (`PlanPage.tsx` L610–632). SPEC (Navigation, L521, unedited) still says "The program screen folds into the plan screen as its program tab."
  - **(b) Workouts:** add, rename, delete (stable runs only).
  - **(c) An exercise's weight unit:** INHERIT/KG/LBS (stable runs only; the workout screen keeps its per-log toggle).
  - **(d) The run's deload-rules override:** USE MY DEFAULT / CUSTOM, both planning types (Objects stored, L124: "global default in settings, override per program").
- **Why it's a gap:** a week can hold none of these.
- **Unsaid, for each:** where it's edited during a run, or whether it's fixed when the run starts (as priorities now are, rule 8).
- **Stops:** chunk 37.

### G31 — Do completed runs' priorities pages become read-only too?
- **SPEC:** Existing data (L168): "Existing run priorities stay as they are and become read-only." Programs page (L576): "Completed runs: each with delete and its priorities pages."
- **Today:**
  - a completed run's four-level marks (the old table Coach reads) are editable on `MesoPrioritiesPage`;
  - that page lives in `src/features/coach/`, which is frozen (`check-frozen-code.mjs`), so changing it is Escalation 16;
  - Plan doesn't link the active run to that page (only completed runs are linked), though its URL takes any run id.
- **Unsaid:** does "read-only" cover these pages, or only the active run's marks in Plan (rule 8: "They can't be changed during a run")?
- **Stops:** chunk 28 does the active run and stops here for completed runs.

### G32 — Stable runs between the data move and "Make this week the new default"
- **SPEC:** Programs and runs [P1.1] (L152–156): design fields are edited in the week's Structure view, and stable volume changes through "Make this week the new default" (L231–238).
- **The problem:** once chunk 33 moves rest, tempo and the routine into the weeks, the program tab no longer reaches planned weeks. Chunk 36, the stable route for a permanent change, waits on G24–G29. Something has to hold for stable runs in between, or stable runs have to wait.
- **Options I see (not choosing):**
  - (a) the program tab keeps editing the run's copy for stable runs, offering "Apply this change to planned weeks ahead" for planned weeks (SPEC's route before [P1.1]), until chunk 36;
  - (b) the program tab hides them for stable runs too: per-week changes only, with no permanent route until chunk 36;
  - (c) chunk 33 moves only week-dependent runs, and stable runs keep today's run-wide values until chunk 36 ships.
- **Live relevance:** F1 (is any active run stable?).
- **Stops:** chunk 32 (the program tab on a stable run) and chunk 33 (whether stable runs move now).

### G33 — Applying a routine edit ahead: which item is "the same"?
- **SPEC:** "Apply this change to planned weeks ahead … Applies only the change just made; leaves everything else in those weeks alone" (L228–230).
- **Today (chunk 20):** a set's value edit is applied to the matching set (same slot, same exercise, same set position) whatever that set's current value. A routine item has no slot or exercise, only a position and its text.
- **Unsaid:** when an item is edited, added, removed or moved, how is a later week's "same item" found?
  - (a) by position;
  - (b) by its text;
  - (c) only when the later week's whole routine equals this week's before the edit.
- **Stops:** chunk 32 (the routine's apply-ahead).

### G34 — Numbers with nothing to compare against
- **SPEC:** rule 3 highlights "numbers" that differ from the week's source (L556–558). Week 1 "starts from the program" (L219), and weight and RIR targets are "in the week plan only. Never in the program" (L247, L250).
- **The problem:** week 1's weights and RIR have no source value, for both planning types. A stable week's don't either, if the default holds no numbers (G24).
- **Unsaid:** are those numbers highlighted, left unmarked, or compared with something else? (Rep targets are in the program, so week 1's reps do have a source.)
- **Stops:** chunk 35 (numbers).

### Stale wording outside the named sections (no chunk needs an answer; left as is)
The change doesn't name these sections, so I didn't edit them. Each now reads wrong or incomplete; say if they should be edited.
- Objects stored → Run (L96): "(what the program tab shows and edits)".
- Objects stored → Week (L99–104): "whether each is 'only this week'"; the list doesn't include rest, tempo or the warmup routine.
- Navigation and settings (L521): "[P1] The program screen folds into the plan screen as its program tab." (also G30)
- Supersets (L303–305): see G21.
- Stepped program planner, step 3 (L186–187): "the sets planned here are the volume for every week". A stable run's volume can now change mid-run through "Make this week the new default". The planner shows the same sentence (`StepVolume.tsx`); rule 9 keeps the planner unchanged.
- Objects stored → Program set (L85–86): "for `stable` this is the volume". It's the same issue as step 3 above.
- What this is (L16): "Every item below is tagged [P1] or [P2]". I added a one-line [P1.1] legend right after it.

**Where I placed rules (so the SPEC edit can be checked against the change).**
- The legend is the only edit outside the sections the change names.
- I read "Rest, tempo and warmup routine: 'design fields' set per run" as naming SPEC's Rest, Tempo and Warmup routine sections, so each gained one [P1.1] bullet.
- The change names "Screens: Plan screen → Program tab". Rules 1 and 3 and the edited Actions line went into that section's "Weeks (cycles)" bullet, since Plan has no other place for them.
- SPEC L210–213 (stable source "the run's copy"; weights and RIR "from the last planned week") sit unchanged right above rule 2. They're the open G24 and G25, not edits.

---

## Process notes (not spec gaps)

- **P1 — Who merges 1.1's migrations?** DECISIONS D29 let the reviewer merge flagged migrations that change no existing row "for the rest of phase 1". Does it cover 1.1? That would cover 038 and 039 (function and additive-schema only). 040 changes existing rows, so it's Adam's either way.
- **P2 — Device update before the data move.** Every device must take chunk 32's update banner before 040 merges (chunk 33's precondition), including the second account's devices. A to-do for Adam at that boundary.
- **P3 — Order inside chunk 27.** Its code ships before its migration 038, the inverse of the standing "migration first" rule. That rule exists for code that needs the migration, and this code doesn't. Reason in the chunk; chunk 12 set the precedent.

---

## Facts to check in the live data (before chunk 31)

All are read-only, Adam-scoped, and run by Adam (this container can't sign in). Results from the main account say nothing about the second account (Checks that lied #26), so run them on both. Each answer becomes an expected number or a fixture.

| # | Fact | Used by |
|---|---|---|
| F1 | Active run(s) per account, and each run copy's `planning_type` and `schedule_type` | G32's live relevance, 33's fixtures |
| F2 | `v2_user_settings.week_start` (copy or empty) | G20's live relevance |
| F3 | What the data move touches: planned rows of active runs; their week exercises and sets; non-null rest, rest after, tempo, set rest and stage rest on the run copies; warmup items per workout | 33's expected counts |
| F4 | Planned sets whose `program_set_id` names a program set of a different program exercise (the swap case, which the move leaves null) | 33's parity |
| F5 | Week exercise rows in active runs with a non-null `carry_program_exercise_id` or `carry_position` | 27 (what stops being honoured) |
| F6 | Sessions of the active run with no `week_plan_id` | G18's live relevance |

---

## Data model (1.1)

SPEC's [P1.1] objects mapped onto the schema. Conventions as in TASKS.md: `v2_` prefix, `user_id` on every row with the standard `for all using/with check (user_id = auth.uid())` RLS, kg, stages as linked rows.

| SPEC [P1.1] | Stored as |
|---|---|
| A planned session's own rest, rest after, tempo (per exercise) | `v2_week_plan_exercises.rest_seconds`, `.rest_after_seconds`, `.tempo` — new (039), same definitions 027 gave `v2_program_exercises` |
| A planned set's own rest; a staged head's stage rest | `v2_week_plan_sets.rest_seconds`, `.stage_rest_seconds` — new (039); a stage row carries no stage rest (027's rule for program sets) |
| A planned session's warmup routine | `v2_week_plan_warmup_items` — new (039): `id, user_id, week_plan_id → v2_week_plans (cascade), position int ≥ 0, body text non-blank`, unique `(week_plan_id, position)`; the shape of `v2_workout_warmup_items` |
| Whether a session's rest, tempo and routine are its own yet | `v2_week_plans.structure_per_week boolean not null default false` — new (039). False means read them from the run's copy, exactly as today. Chunk 33 sets it on every planned session of each active run; from then on `v2_plan_week` sets it on every new one |
| Superset grouping and superset rest per week | open — G21 (chunk 34) |
| The run's default (stable source) | the run's copy, which is what the stable source is today (SPEC L210). Whether rule 4's "default" is this same thing is G25 |
| "Only this week" | removed. `carry_program_exercise_id` / `carry_position` stay in the schema, unread; dropping them would be destructive and buys nothing |
| Run priorities | storage unchanged (`v2_program_priorities` on the run's copy); the app no longer writes a run's marks |
| `v2_week_plan_sets.program_set_id` | kept; per-week sessions stop reading rest through it |

**The read rule** (chunk 31; one rule, applied at each reader). A planned session's rest, rest after, tempo, set rest, stage rest and warmup routine come from its own week rows when `structure_per_week` is true. Otherwise they come from the run's copy exactly as today: the exercise row its week row points at; the program set its `program_set_id` names, only among its own card's program sets; and the workout's warmup items.

**Why a per-session switch and not a one-step change.** Migrations deploy on merge to master. An older bundle stays open on a device until its update banner is taken. A one-step switch would let either side see half-moved data. The switch keeps every session showing exactly what it shows today until its own rows hold the same values, and it lets a straggler row from an old bundle fall back safely. The same order made chunk 12 ship code before its column drop.

---

## Files

**New**
| Path | Chunk | What |
|---|---|---|
| `supabase/migrations/038_p11_plan_week_ignore_carry.sql` | 27 | `v2_plan_week` copies each week's actual content |
| `supabase/migrations/039_p11_week_structure_schema.sql` | 30 | per-week columns, `v2_week_plan_warmup_items`, `structure_per_week` |
| `scripts/probe-specs/039.json`, `040.json` | 30, 33 | live column probes |
| `src/features/plan/weekWarmupRoutineService.ts` (+ test) | 31 | only reader and writer of `v2_week_plan_warmup_items`; same reorder and re-pack rules as `warmupRoutineService.ts` |
| `supabase/migrations/040_p11_week_structure_move.sql` | 33 | the data move and `v2_plan_week` copying per-week values |
| `scripts/structure-parity.sql` | 33 | read-only, Adam-scoped: per planned exercise, set and session, today's resolved value vs the moved one; expects 0 differences |
| `src/features/plan/weekDiff.ts` (+ test) | 35 | what differs from the week's source |

**Changed most:**
- `src/features/plan/{PlanPage, weekPlanService, useWeekPlan, applyAhead, ApplyAheadOffer, PrioritiesEditor, ProgramTab}`
- `src/features/plan/weekEdits.ts` (shrinks in 27)
- `src/lib/deloadRules.ts`
- `src/features/gym/{GymSession, useExerciseCardState, WarmupRoutineChecklist}`
- `src/features/planner/{StepExercises, StepVolume}` (one prop to hide moved fields; the planner's own use unchanged)
- `src/types/index.ts`
- `scripts/verify-rls.mjs` (`TABLES`, chunk 31)
- `scripts/live-counts.sql` (the new table, chunk 30)

**Removed:** `src/features/plan/ProgramTab.tsx` and its tests (chunk 37); the carry helpers in `weekEdits.ts` (chunk 27).

**Never touched:** `src/features/coach/*`, `api/coach/*`, the existing exports of `referenceLogic.ts` and `setGroupLogic.ts`, and the shared scripts (`check-migration`, `migration-rules`, `check-context-size`).

---

## Chunks in build order

**Order:**
- Three small chunks need no answer and can go first, in any order: 27 (no "only this week"), 28 (priorities view-only) and 30 (additive schema).
- Then the two-view Plan (29). It stops at G16 and G17; those are layout questions, but through 32 they also hold up the data move (33).
- Then rest, tempo and the routine per week, in the expand–move pattern: code that's inert until data says otherwise (31, 32), then the data move that switches it on (33).
- Supersets (34), highlighting (35) and "Make this week the new default" (36) build on that.
- The program tab goes last (37), once everything it does has a home.
- No stacked PRs: each chunk merges to master on its own (retro, section 3.7).

### Chunk 27 — "Only this week" is removed
**Goal:** No "only this week" tick anywhere. A swap or reorder in a week is a normal week edit. Stored "only this week" values stop affecting any copy or match.
**SPEC:** Weeks and copying [P1.1] "'Only this week' is removed" and its existing-data line; Plan screen [P1.1] "No 'only this week'".
**Scope:**
- **`PlanPage.tsx`:**
  - remove both ONLY THIS WEEK toggles (weekday branch L644–651, sequence branch L706–713);
  - remove the `onlyThisWeek` state (L146) and prop (L687, L739, L776, L790);
  - `handlePickReplacement` (L974) and `handleMoveExercise` (L1048) always record the apply-ahead change; their `if (onlyThisWeek)` dismiss branches go.
- **Services:**
  - `useSwapWeekExercise` / `useReorderWeekExercises` (`useWeekPlan.ts`) and `swapWeekExercise` (L981) / `reorderWeekExercises` (L1116) lose the parameter;
  - both write `carry_program_exercise_id` / `carry_position` = null, which is what a permanent edit writes today, so an edited row sheds any stale value;
  - `fetchCurrentCarry` (L951) and `weekEdits.ts`'s `resolveSwapCarry` / `resolveReorderCarry` go, with their tests.
- **Copy and match identity = the row's own values:**
  - `copyExercisesForward` (L803) and `copySetsWithGrouping` (L874) use `program_exercise_id` and `position` only;
  - `applyAhead.ts` `slotIdOf` (L215) returns the row's own id;
  - `deloadRules.ts`'s slot identity (L206) the same;
  - `carryProgramExerciseId` / `carryPosition` leave `src/types/index.ts` and the mappers.
- **Migration 038:** `create or replace function v2_plan_week`, 037's body with the week branch reading `program_exercise_id` and `position` directly.
  - No `coalesce` with the carry columns (037 L437–438).
  - `tmp_v2_plan_week_ex_map` and the set remap through it go (L446–447, L475); a copied set keeps its own `program_exercise_id`.
  - Same grant and `notify pgrst`.
**Depends on:** —
**Order (P3):** code first, then 038.
- The code doesn't need 038.
- In the window between them, server-side planning still honours values ticked before the update, which is what the tick promised when it was used.
- Migration first would instead ignore ticks the old screen was still offering.
**Migration:** 038 replaces one function. **Not destructive:** no row changes, and the carry columns keep their values, unread. **Rollback:** `create or replace` with 037's `v2_plan_week` body verbatim; that only restores server-side honouring of stored values. `check-migration` exits 1 (function), so it merges per P1.
**Verification:**
- **Rule: no tick.**
  - Screen: `PlanPage` on the current week of a week-dependent weekday run and of a sequence run → `queryByText('ONLY THIS WEEK')` is null in both. It's an absence test (Checks that lied #32).
  - Break proof: put one toggle back → the test fails.
- **Rule: a swap or reorder carries forward.**
  - Screen: swap through the exercise ⋯ (`planMenus.testutil.ts`) → the mocked `swapWeekExercise` gets no `onlyThisWeek`, and the apply-ahead banner appears because a later week is planned (it was suppressed after a ticked swap). Same for MOVE UP.
  - Service: the update payloads carry `carry_program_exercise_id: null` / `carry_position: null`. Break: write the old value → the test fails.
- **Rule: stored values are ignored by copying.**
  - Client: COPY WEEK on `PlanPage` (`copyOnePlanForward`), from a source row whose carry fields name a different slot and position → the inserted `v2_week_plan_exercises` payload has the source row's own `program_exercise_id` and `position`, and each set keeps its own `program_exercise_id`. Break: restore the `??` fallback → the test fails.
  - Server: scratch replay of 001–038, with a fixture where week 2's row is an old only-this-week swap (`carry_program_exercise_id` = the original slot) and has `carry_position` ≠ `position` → `v2_plan_week(meso, 3)`, called as the fixture user, copies the swapped-in slot at week 2's position with its sets. Break: 037's body → the result differs. Executed, not read (Checks that lied #28).
- **Rule: matches ignore stored values.**
  - Apply ahead: `PlanPage.applyAhead` screen test where a later week's row has carry = the edited row's id but a different own id → that week is skipped; a later row with the same own id matches.
  - Deload: wired at `markSessionDeload` (`weekPlanService.ts` L1593), the only caller of the mapping. Its test (`weekPlanService.deloadExerciseMapping`) gives a base row whose carry names another slot, and asserts the inserted sets take the marked week's exercise matched by own id. Break: restore `carryProgramExerciseId ?? programExerciseId` (`deloadRules.ts` L206) → the test fails. The Plan screen tests mock `useWeekPlan`, so the proof sits at this call site.
- **Boundary checks:** typecheck, test, build; `check-program-exercise-reads.mjs`; `check-embeds-local.sh`. The `!v2_week_plan_exercises_program_exercise_id_fkey` hint stays, because the carry FK column still exists.
**Would not catch:**
- An old bundle still showing the tick until it updates; its ticks write values nothing reads once 038 is live.
- Weeks already planned from a source with stored values keep what they got (existing weeks don't change).
**Live app after it:** no existing week changes; the tick is gone; the next week planned copies the week before it as it actually is.
**Done when:** the code and 038 are live, and the scratch proof shows a new week copying its source's actual content.

### Chunk 28 — Priorities are view-only in Plan
**Goal:** During a run, Plan shows the run's priorities and can't change them. They're set on saved programs in the planner and copied to a run when it starts.
**SPEC:** Programs and runs [P1.1] "Priorities are a property of the program"; Existing data "Existing run priorities … become read-only"; Plan screen [P1.1] "Priorities are shown view-only".
**Scope:**
- **`PrioritiesEditor.tsx`** (route `/plan/priorities`, opened from Plan's header button, `PlanPage.tsx` L425–436):
  - each group and subgroup shows its mark as a read-only label, and only where one is set (standing UI rule);
  - groups still unfold;
  - no `MarkSelector`, and no `useSetPriorityMark` call (L44).
- **Unchanged:** the planner's `StepPriorities` (saved programs), and `v2_start_run` / `v2_copy_program`, which already copy marks to the run.
- **Not added:** a database-level guard. It would be a new policy on an existing table, which is Adam's merge, and the app has no other write path to a run's marks.
**Stops at:** G31 for completed runs' pages; this chunk changes only the active run's screen.
**Depends on:** —
**Migration:** none.
**Verification:**
- **Rule: view-only in Plan.**
  - Screen: `PrioritiesEditor` with marks on the run copy → each mark's label shows; tapping a group expands it; no FOCUS / DON'T CARE control exists; `useSetPriorityMark`'s mutate spy is never called.
  - Break proof: restore one `MarkSelector` → the test fails.
- **Rule: set in the planner.** `StepPriorities.test.tsx` passes unmodified (the planner still writes saved programs' marks).
- **Rule: copied at start.** Wired at `ProgramsPage` START → `useStartRun` → `v2_start_run` → `v2_copy_program`'s priorities loop (034). That's unchanged code, proven on scratch in R7. `ProgramsPage.test.tsx` already asserts the RPC call.
- **Header link:** Plan's PRIORITIES still opens `/plan/priorities` (screen test).
**Would not catch:** a write through another path; none exists after this chunk. A grep shows `setPriorityMark` callers: planner only.
**Live app after it:** the same marks, no longer editable in Plan.
**Done when:** live, and the run's marks can't be changed from Plan.

### Chunk 29 — Plan shows one week in two views
**Goal:** Plan's week panel has a Sets view and a Structure view, each holding the week controls SPEC gives it. Every control still does exactly what it did.
**SPEC:** Plan screen [P1.1] two views; the standing UI rule.
**Scope:**
- A SETS / STRUCTURE switch, built from the WEEKS/PROGRAM bar's own pattern (no new visual language; Escalation 19).
- **Sets view:** working set rows (number, weight, reps, RIR) with ⋯ for tags and DELETE SET; the `+` ADD SET; tag markers.
- **Structure view:**
  - the exercise ⋯: SWAP EXERCISE, MOVE UP/DOWN, REMOVE FROM THIS WEEK;
  - ADD EXERCISE;
  - each staged set's controls: ADD STAGE, STAGE KIND, DELETE STAGE (rule 1: "staged sets and their stages").
- **Pending G16:** where a stage's numbers go, where warmup sets show, and where ADD WARMUP SETS and a warmup set's DELETE go.
- Later chunks add rest, tempo and the routine (32) and grouping (34) to Structure.
- **Handlers move, not rewritten:** `handlePickReplacement`, `handleMoveExercise`, `handlePickAdd`, `handleConfirmRemove`, `useAddSet`, `useRemoveSet`, `useAddStage`, `useAddWarmupSet` and `useUpdateSet`, with their apply-ahead records.
- Past weeks: both views read-only, as today.
- The WEEKS/PROGRAM bar stays until chunk 37; both views live inside WEEKS.
**Stops at:** G16 (a stage's numbers and warmup sets) and G17 (COMPACT and the page-level actions).
**Depends on:** 27 (no tick to place).
**Migration:** none.
**Verification** (screen level, menus opened through `planMenus.testutil.ts`):
- **Sets view:** a set row shows number, weight, reps and RIR; its ⋯ offers tags and DELETE SET and no ADD STAGE / STAGE KIND (absence asserted); `+` calls `useAddSet` with the same arguments as before.
- **Structure view:** each exercise-⋯ action and each kind control calls the same mutation with the same arguments as on master.
- **The existing tests prove it:** every `PlanPage.*` screen test and `MoveSessionControl.test.tsx` passes with only "open the view" steps added; no expected argument changes, and the reviewer reads the test diff for that.
- **Moved controls keep their actions** (Checks that lied #29): every apply-ahead offer still fires after each edit type.
- **Render fixture:** `__fixtures__/planpage-chunk6-render.html` is re-captured, and the diff is reviewed as layout only (no value differs).
- **Width:** 375 px in a real browser with fixtures, both views, no horizontal overflow (as the UI-rule session did).
**Would not catch:** the per-week fields (31–33), grouping (34), highlighting (35).
**Live app after it:** the same content, split across two views.
**Done when:** live, with every control from before in one view and working.

### Chunk 30 — Schema: rest, tempo and the warmup routine per week (additive)
**Goal:** Add the columns and table chunks 31–33 need, changing nothing the app does.
**Scope:** migration 039, per "Data model (1.1)":
- **`v2_week_plans`:** `structure_per_week boolean not null default false`.
- **`v2_week_plan_exercises`:** `rest_seconds integer check (rest_seconds >= 0)`, `rest_after_seconds integer check (rest_after_seconds >= 0)`, `tempo text check (char_length(tempo) <= 20)`.
- **`v2_week_plan_sets`:** `rest_seconds integer check (rest_seconds >= 0)` and `stage_rest_seconds integer check (stage_rest_seconds >= 0)`, plus `check (parent_week_plan_set_id is null or stage_rest_seconds is null)`.
- **New table `v2_week_plan_warmup_items`:** RLS, policy, unique `(week_plan_id, position)`.
- **`notify pgrst`.**
- **Also:** `scripts/live-counts.sql` gains the new table, so 040's before/after counts include it.
- **Not included:** no superset storage (G21); no `src/` change.
**Depends on:** —
**Migration:** additive. **Not destructive:** existing rows get `false` or null; no row changes. **Rollback:** drop the table, then the columns.
- `check-migration` exits 1 on the CHECKs on new columns (their defaults satisfy them; R4 precedent) and on the notify.
- Merge after `migration-replay`, `check-embeds-local.sh` (one new FK, to `v2_week_plans`; no table pair gains a second FK) and the scratch count/fingerprint check (per P1).
- `v2_week_plan_warmup_items` joins verify-rls `TABLES` in chunk 31, its first user; `verify-rls-tables.test.mjs` fails on an unused table.
**Verification:**
- Replay of 001–039.
- Scratch constraint probes: a negative rest → 23514; a stage row with stage rest → 23514; a blank item → 23514; a duplicate position → 23505.
- Today's client write shapes into week plans, week exercises and week sets still succeed (R2-style).
- After deploy: `probe-live-columns.mjs` with `039.json` (each new column `200 []`, the control `400 / 42703`, the new table 0 rows to anon), and `check-embeds.mjs` live.
**Would not catch:** whether the shapes suit the feature; chunks 31–33 prove the parts they use.
**Live app after it:** unchanged.
**Done when:** 039 is live and the probes answer as expected.

### Chunk 31 — The week's rest, tempo and routine: read path, copies, deload (inert until chunk 33)
**Goal:** Wherever a session is marked `structure_per_week`, every reader and every write path uses that session's own rest, tempo and routine. Wherever it isn't, they behave exactly as today. No row is marked until chunk 33, so nothing visible changes.
**SPEC:** Rest, Tempo, Warmup routine [P1.1] ("per week … copied by the source rule"); Weeks and copying [P1.1] source rule (for these fields).
**Scope:**
- **Read path** (the read rule above):
  - `weekPlanService.ts`: `toProgramExerciseFromWeekPlanExercise` (L207) takes rest, rest after and tempo from the week row on a per-week plan; `toSet` (L164) carries `restSeconds` and `stageRestSeconds`; the week-plan selects add the new columns and `structure_per_week` (`WeekPlan.structurePerWeek`).
  - Workout screen: `useExerciseCardState.ts` `setOverrideFor` (L257–262) and `setOverrideForStageRest` (L304–306) read the planned set's own values on a per-week plan, else today's `programSetById` lookup. Exercise rest, rest after and tempo already flow through `pe` (`GymSession.tsx` L197–198 → `ExerciseHeader` L51–56) and change with the mapper.
  - Warmup routine: `WarmupRoutineChecklist` (L41) reads `weekWarmupRoutineService` items on a per-week plan, else the workout's items.
  - Offline: the new fields ride on the cached week plan (`primeOfflineCache` already stores its sets and exercises). Week warmup items are an online read, like the workout's today.
  - Sessions with no week plan: **stop at G18.**
- **Write paths carry the values** (only on per-week rows):
  - COPY WEEK / COPY THIS WORKOUT (`copyOnePlanForward`, L718): write what the source shows. That's its own values and items when it's per-week, else (a straggler) the run-copy values by the read rule. The destination is per-week exactly when it already is or its source is. Before chunk 33 neither is, so nothing is written and the copy reads the run copy, just as its source does.
  - `createWeekPlan` (L293; used by `useAddSet` / `useAddWarmupSet` when a workout has no row yet): creates an unmarked row, which reads the run copy (what it shows today); `v2_plan_week` moves it on its next call (chunk 33).
  - `addWeekExercise` (L1062), `addSet` (L387), `addStage` (L462), `addWarmupSet` (L414): null values. Today an added exercise or set has no rest or tempo.
  - `swapWeekExercise` (L981) / `repointWeekExercise` (L1035): **stop at G19.**
  - `reorderWeekExercises` (L1116): values stay on their rows.
- **Deload:**
  - `insertCalculatedPlanSets` (L1389) gives each calculated set its base set's own rest and stage rest when the base row is per-week, else today's values through `program_set_id`.
  - The restore snapshot (`DeloadRestoreEntry`, `deloadRules.ts` L530) gains `restSeconds` and `stageRestSeconds`.
  - `insertRestoredPlanSets` (L1498) writes them back. A snapshot taken before 1.1 (no such fields) restores each set's values by the read rule, through its `programSetId` and only within its own slot. That's what the set showed when it was snapshotted.
- **`weekWarmupRoutineService.ts`:** add, edit, remove, reorder (two-phase offset reorder under the unique index; re-pack on remove), the same algorithm as `warmupRoutineService.ts`. Its edit UI is chunk 32.
- **verify-rls:** `v2_week_plan_warmup_items` joins `TABLES` in `scripts/verify-rls.mjs`.
**Stops at:** G18 (sessions with no week plan) and G19 (a week swap's values).
**Depends on:** 30 (the selects name the new columns, so 039 must be live first).
**Migration:** none.
**Verification** (fixtures where the week's value and the run copy's differ, so a test can tell the two sources apart; retro section 2.12):
- **Unchanged while unmarked** (D30): `GymSession.d30.test.tsx`'s snapshot equals master's; `PlanPage.renderParity` is equal; `GymSession.restChain`, `.tempo` and `.warmupRoutine` pass unmodified on their existing (unmarked) fixtures.
- **Set rest from the week:** in `GymSession.restChain`, a per-week session's set 2 has `rest_seconds` 75 while its program set says 120; log set 2 → `useRestTimerStore.getState().targetSeconds` is 75. Break: per-week rows read `programSetById` → 120 → the test fails.
- **Stage rest from the week:** a rest-pause head with week stage rest 20 vs program set 30 → after logging the head, the target is 20.
- **Exercise rest and rest after from the week:** on the exercise's last set, the target is the week's rest after (180, vs the run copy's 120).
- **Fallback:** the same fixtures with `structure_per_week` false give 120, 30 and the run copy's rest after. Break: always read the week → the test fails.
- **Tempo:** in `GymSession.tempo`, `ExerciseHeader` shows the week's `2-0-2-0`, not the run copy's `3-1-1-0`; unmarked → `3-1-1-0`.
- **Routine:** in `GymSession.warmupRoutine`, the checklist lists the week's items in order; unmarked → the workout's.
- **Copies:**
  - COPY WEEK from a per-week source on `PlanPage` → the inserted exercise and set payloads carry the source's values, the destination row is per-week, and the items are copied in order.
  - From an unmarked source into an unmarked destination (everything before chunk 33) → nothing written, and the copy reads the run copy.
  - From an unmarked (straggler) source into a per-week destination → the run-copy values by the read rule, including null for a swapped set.
  - Break: drop the values → the test fails.
- **Deload:**
  - Call sites: `markSessionDeload` → `applyCalculatedDeloadMark` → `insertCalculatedPlanSets`, and `unmarkSessionDeload` → `applyDeloadRestore` → `insertRestoredPlanSets` (service tests that record payloads).
  - Marking with rules on a per-week session → the calculated sets carry the base's set rest and stage rest. SPEC L350–351: a deload session is "pre-calculated from the last normal week: its planned sets".
  - Unmarking restores the pre-mark values.
  - Restoring a pre-1.1 snapshot into a per-week row takes values by the read rule. Break: write null → the test fails.
  - Screen: in `GymSession.deload`, logging a calculated set of a per-week deload session starts the base set's rest.
- **Offline:** in `GymSession.offline`, a per-week session rendered offline from the Dexie-cached week plan times set 2 with the week's 75, not the run copy's 120. Break: drop the fields from the cached plan → the test fails.
- **Boundary checks:** `verify-rls-tables.test.mjs` passes with the new table in `TABLES`; `check-program-exercise-reads.mjs` exits 0; `check-frozen-code.mjs`; typecheck, test, build.
**Would not catch:** real data; nothing here runs live until 33 marks rows. Superset rest (34).
**Live app after it:** unchanged; no session is per-week yet.
**Done when:** merged and deployed; every test above passes, with its break proof recorded.

### Chunk 32 — The week's rest, tempo and routine: Structure editors, apply ahead, the program tab (inert until chunk 33)
**Goal:** On a per-week session, rest, tempo and the routine are edited in the week's Structure view, and the edit can be applied to planned weeks ahead. The program tab stops offering what has moved to the week. Still nothing visible until chunk 33.
**SPEC:** Programs and runs [P1.1] ("design fields (rest, tempo, warmup routine): in the week's Structure view"); Plan screen [P1.1] Structure view; Rest, Tempo, Warmup routine [P1.1].
**Scope:**
- **Structure view editors**, per-week sessions only, built from `StepExercises`' existing `RestStepper` / `TempoEditor` and its warmup-routine editor pattern (Escalation 19 otherwise). Each is placed by the standing UI rule: behind ⋯, with a marker only where a value is set.
  - In the exercise's ⋯: REST, REST AFTER, TEMPO (validated by `normaliseTempo`; invalid → inline error, nothing written).
  - In a set's ⋯: its own REST; a staged head's STAGE REST.
  - In Structure, per workout: the warmup routine (add, edit text, remove, reorder).
  - New `weekPlanService` / `weekWarmupRoutineService` mutations, all `networkMode: 'always'`. Past weeks are read-only as today.
- **Apply ahead for each new edit type** (CONTEXT rule: extend `applyAhead.ts`, its tests and a screen-layer record test):
  - Exercise rest, rest after, tempo: match by slot + exercise and apply whatever the later value is — chunk 20's existing rule for value edits (`applyAhead.ts` L352–374).
  - Set rest, stage rest: the same, plus the set position.
  - The routine: **stop at G33** (how a later week's "same item" is found).
  - Deload sessions are skipped, as today.
- **The program tab while the active run's sessions are per-week** (until chunk 37 removes it). One prop to `StepExercises` / `StepVolume`; the planner's own use is unchanged.
  - **Week-dependent run:** the exercise REST / REST AFTER / TEMPO, set REST, STAGE REST and routine editors are hidden behind the existing note pattern ("EDIT IT IN A WEEK").
  - **Stable run:** **stop at G32** (how a permanent rest, tempo or routine change is made until chunk 36; F1 says whether any active run is stable).
  - Superset grouping and block rests stay where they are (G21).
**Stops at:** G32 (the program tab on a stable run) and G33 (the routine's apply-ahead).
**Depends on:** 29 (Structure view), 31.
**Migration:** none.
**Verification:**
- **Editors (screen):**
  - `PlanPage` Structure view on a per-week week 5: REST on exercise X → the service receives week 5's week-exercise row id and `rest_seconds`, and no other week's.
  - The apply-ahead banner offers it when week 6 is planned; applying it writes week 6's matching row only, and a non-matching week is skipped.
  - Same for REST AFTER, TEMPO, set REST, STAGE REST, and the routine's add, edit, remove and reorder (its apply-ahead per G33's answer).
  - On an unmarked week the editors are absent (absence asserted).
  - Break: write to the run copy → the test fails.
- **Apply ahead:** `applyAhead.test.ts` covers each new record type, including its skip cases. One `PlanPage` record test per type checks the record the screen builds (CONTEXT rule).
- **Program tab:**
  - `ProgramTab.test.tsx`: on a week-dependent run with per-week sessions, the moved editors are absent (break: show them → the test fails).
  - A stable run per G32's answer.
  - The planner (`PlannerPage` and `StepExercises` tests) is unchanged.
- **Width:** 375 px in a real browser, Structure view with every marker set, no overflow.
**Would not catch:** real data, as in 31.
**Live app after it:** unchanged.
**Done when:** merged, deployed, and on every device (P2: each device takes the update banner before chunk 33 merges).

### Chunk 33 — The data move: every planned week gets its own rest, tempo and routine
**Goal:** Every week already planned in each active run gets today's run-wide rest, tempo and warmup routine as its own. Every week planned from now on copies them from its source. Nothing visible changes on the day it ships.
**SPEC:** Programs and runs [P1.1] Existing data ("written into every week already planned in each active run … They also become the run's default"); Weeks and copying [P1.1] source rule; Rest, Tempo, Warmup routine [P1.1].
**Scope:** migration 040, one transaction, in this order:
1. **The move.** For every `v2_week_plans` row whose meso is `active` and whose `structure_per_week` is false, for every user (migrations run outside RLS; that's Adam's two accounts):
   - each `v2_week_plan_exercises` row gets `rest_seconds`, `rest_after_seconds` and `tempo` from the `v2_program_exercises` row its `program_exercise_id` names. For a week-only slot that's the slot's own row, null today.
   - each `v2_week_plan_sets` row gets `rest_seconds` and `stage_rest_seconds` from the program set its `program_set_id` names, **only where that program set belongs to the same program exercise as the planned set** (`ps.program_exercise_id = wps.program_exercise_id`), else null. That's exactly what the workout screen resolves today: it searches only its own card's program sets (`GymSession.tsx` L575, L619, L645 → `useExerciseCardState.ts` L257–262, L304–306), so a swapped set shows no override.
   - warmup items: a copy of the row's workout's `v2_workout_warmup_items`, same positions and text.
   - `structure_per_week` set to true.
2. **`v2_plan_week`** (`create or replace`, from 038's body):
   - A new row is per-week and copies rest, tempo and the routine from its source:
     - program source (week 1, stable) → the run copy, by the rules of step 1;
     - week source (week-dependent) → the source row's own values and items; if the source row isn't per-week, step 1's rules, which is what that source shows;
     - empty start → **stop at G20** (the routine).
   - Weights and RIR stay as today (G24 belongs to chunk 36).
   - Rows of the requested week that still aren't per-week, because an old bundle wrote them, get step 1 on the call. It's idempotent.
3. **Grant and notify.**
- **"They also become the run's default":** nothing to write. The run's copy already holds them, and it's the stable source today (G25 asks whether it's also "the default").
- **Superset rest and grouping:** chunk 34 (G21).
**Stops at:** G20 (an empty-started week's routine) and G32 (whether stable runs move now).
**Depends on:** 32 on every device (P2); 038 (the function body it starts from). Through 29 and 32, the data move also waits on G16 and G17, though both are layout questions.
**Preconditions:**
- Every device on chunk 32's bundle. An older bundle still edits the run copy's rest in the program tab, and marked rows no longer read that.
- No session in progress when 040 merges. Warmup ticks are kept per session and keyed by item id (`WarmupRoutineChecklist.tsx` L69), and the moved items get new ids, so an open session would lose its ticks.
**Migration:** 040. **Not destructive:** it fills new, null columns on existing rows, inserts week warmup items and sets a flag; it overwrites and deletes nothing.
- It changes existing rows, so it's Adam's merge (D29 covers only migrations that change no row).
- Adam records before/after counts with `scripts/live-counts.sql` (standing rule for data-changing migrations).
- `check-migration` exits 1.
**Rollback:**
- `update v2_week_plans set structure_per_week = false` on active runs' rows switches every session back to reading the run copy, which shows exactly what it showed before 040.
- Then delete the copied week warmup items and null the new columns if wanted, and restore 038's `v2_plan_week`.
- Per-week edits made after 040 are dropped by a rollback; that's stated in the merge card.
**Verification:**
- **Scratch:** replay 001–040 on fixtures with values that differ (run copy: rest 120, rest after 180, tempo `3-1-1-0`, set rest 75, stage rest 20, three routine items). Week rows:
  - a plain week;
  - a week with a week swap (sets whose `program_set_id` names the original slot's sets → moved as null);
  - a week-only added exercise;
  - a G14 shared row;
  - a sequence cycle with a repeated workout (two rows, each with its own items);
  - a deload session with calculated sets;
  - a completed run's rows (untouched: still false).
- **Parity:** `scripts/structure-parity.sql` (read-only) computes, for every planned exercise, set and session, the value today's read rule resolves and the moved value, and returns the number of differences: 0. It's run on scratch first, then by Adam on live (Adam-scoped) after deploy. It's executed, not read (Checks that lied #28). It answers the brief's "nothing visible changes" directly.
- **`v2_plan_week` on scratch, called as the fixture user** (R10 style):
  - a new week-dependent week copies its source row's edited values;
  - a stable week copies the run copy's;
  - a second call plans 0 and moves 0;
  - a straggler row inserted unmarked after the move is moved on the next call.
- **Callers:** `v2_plan_week`'s call sites are unchanged: `PlanPage`'s plan-on-view effect (L221–227) and Today's start.
- **Screen:** 31's and 32's screen tests re-run, unmodified, on marked fixtures.
- **Live after deploy:**
  - Adam's counts: `v2_week_plan_warmup_items` goes 0 → F3's expected number, and every other table is unchanged.
  - Parity: 0.
  - `probe-live-columns.mjs` with `040.json`.
  - At his next session: the rest timer targets, tempo and warmup checklist are what they were.
**Would not catch:**
- A device still on a pre-32 bundle (hence P2).
- Ticks lost in a session open during the merge. Parity compares items' text and position, not tick state, so the precondition covers it.
- Completed runs: not moved, and nothing shows their rest, tempo or routine.
- Sessions with no week plan (G18).
**Live app after it:** it looks the same. From now on rest, tempo and the routine are changed per week in the Structure view and carried forward by copying.
**Done when:** 040 is live, the counts and parity are as expected, and a week planned after it carries its source's values.

### Chunk 34 — Superset grouping and superset rest per week — stops at G21
**Goal (as far as SPEC says):** superset rest is per week (Rest [P1.1]), and grouping is edited in the week's Structure view (Plan screen [P1.1]). Whether grouping itself is per week is G21.
**Stops at:** G21. The storage, the move and the workout screen's block source all depend on it.
**What it holds either way:**
- **The pattern of 30–33:** additive schema, inert code behind its own per-session switch, a data move that writes today's blocks and block rests into every planned week of active runs (parity-checked), and `v2_plan_week` copying them.
- **The workout screen's block source switched at its call sites:** `GymSession.tsx`'s `renderUnits` (L329) and `supersetBlockRestById` (L283–284), with fixtures where week and run copy differ.
- **The Structure view:** link/unlink and WITHIN ROUND / AFTER ROUND.
- **Apply ahead** for each new record type.
- **The program tab:** its grouping and block-rest editors follow G21's answer, and G32's for stable runs.
- **D30.**
**Migration:** additive schema, not destructive. Then a data move that fills new columns or rows only: Adam's merge, with counts and its own parity query. Rollback by the switch, as in 33.
**Depends on:** 33.
**Would not catch:** what G21 leaves open; written once it's answered.
**Live app after it:** superset blocks and their rests look the same on the day the move ships (parity 0); from then on they're edited as G21 decides.
**Done when:** G21 is answered, the chunk is written out in full, and its move is live with parity 0.

### Chunk 35 — Differences from the week's source are highlighted — stops at G22, G23 and G34
**Goal:** In both views, anything that differs from the week's source is highlighted. Tags never are. Deload sessions show none (SPEC's default).
**SPEC:** Plan screen [P1.1] highlighting.
**Fixed parts:**
- **A pure `weekDiff.ts`** that takes a week and its source's content and returns flags per row and field: exercises, order, sets, set kinds, weight, reps, RIR, rest, tempo and routine items (groupings per G21).
- **The week-dependent source:** `weekSources.ts`'s existing last-normal-non-empty search, which is SPEC's rule 2 ("the last planned normal occurrence").
- **Rendering:** with existing tokens only (`--accent` / `--accent-muted`, as the selected chips use). A new visual is Escalation 19.
- **No flags:** deload sessions and tags.
**Stops at:**
- G22 (what the week is compared against: its source now or as planned, and week 1's program).
- G23 (removals, order, cross-view and ⋯ markers, and how a row finds its source row).
- G34 (numbers with nothing to compare against).
- Parts: G24 and G25 (what stable weeks are compared with), G20 (empty weeks), G21 (groupings).
**Verification (fixed parts):**
- **Pure:** `weekDiff` tests per field.
- **Screen, Sets view:** week 5's set 2 weight differs from week 4's → set 2's weight is highlighted, set 1's isn't.
- **Screen, Structure view:** rest, tempo and routine differences are highlighted.
- **Never highlighted:** an added tag; any deload session.
- **Break proofs:** compare against the wrong week → the test fails.
**Migration:** none expected. G22's answer may add one, if the source is kept as it was when planned.
**Would not catch:** finalised once G22, G23 and G34 are answered.
**Live app after it:** highlights appear, including on weeks planned before it ships (whatever G22 decides for them); no value changes.
**Depends on:** 29, 33 (34 for groupings).
**Done when:** the gaps are answered, the chunk is written out in full, and its screen tests pass live.

### Chunk 36 — Stable: "Make this week the new default" — stops at G24–G29
**Goal:** On a stable run, one action makes the week's content (everything except tags) the run's default, so every week planned after it starts from it. The saved program never changes. Then apply-ahead is offered for planned weeks.
**SPEC:** Weeks and copying [P1.1] "Stable programs: 'Make this week the new default'".
**Fixed parts:**
- **Where it shows:** offered only on stable runs (absence asserted on a week-dependent run); its place per G17.
- **Atomic:** a Postgres function, like `v2_plan_week`, in a new migration. A new function, not destructive.
- **Writes only the run's rows.** The saved program stays byte-identical (md5 of its rows before and after, as chunk 11 checked).
- **Never changes `exercise_id` on a program exercise row that planned sets point at, whatever G25 decides.** Coach reads past planned exercises through those rows.
- **Wired:** the next `v2_plan_week` for a stable week starts from it (scratch, plus a screen test on the action).
- **Ends** whatever G32 put in place for stable runs.
**Stops at:**
- G24 (weights and RIR), G25 (where the default is written, and so how swapped, added and removed exercises become part of it), G26 (what apply-ahead applies).
- G27 (deload sessions), G28 (a repeated workout in a cycle), G29 (past weeks, confirm, undo).
**Migration:** a new function, not destructive. Rollback: drop it, which removes the action. A default it already wrote stays as written; whether one can be undone is G29.
**Would not catch:** finalised with the answers. At least: a default made from a week that was then edited (the default is what was there when the action ran).
**Live app after it:** a new action on stable runs; weeks change only when it's used.
**Depends on:** 33 (34).
**Done when:** the gaps are answered, the chunk is written out in full, and a week made the default is what the next week starts from, live.

### Chunk 37 — The program tab is removed — stops at G30
**Goal:** Plan has no program tab, and nothing it did is lost.
**SPEC:** Programs and runs [P1.1] "The program tab is removed from Plan"; Plan screen [P1.1] "No program tab".
**Fixed parts:**
- Remove PROGRAM from the WEEKS/PROGRAM bar (`PlanPage.tsx` L86–91, L480–510), and `ProgramTab.tsx` with its tests.
- `StepExercises` / `StepVolume` stay for the planner, unchanged; the planner's tests pass unmodified.
- Plan's empty states that open the tab get the target G30(a) gives them.
**Stops at:** G30 (a) schedule, (b) workouts, (c) units, (d) deload override; and G21 if grouping stays run-wide.
**Verification (fixed parts):**
- An absence test for the tab.
- A capability checklist like chunk 26's: each control the tab had (G30's list, plus grouping) is reachable where the answers put it, or is gone on purpose. Each has a screen-level test.
**Migration:** none expected; G30's answers may add one (e.g. if the schedule becomes editable somewhere new).
**Would not catch:** a capability nobody listed. The checklist starts from the tab's code (`ProgramTab.tsx` → `StepExercises` / `StepVolume`), not from SPEC.
**Live app after it:** no program tab. Everything it did is where G30's answers put it, or is fixed for the run.
**Depends on:** 33, 34, 36.
**Done when:** live, with every item on the checklist accounted for.

---

## Existing data

SPEC's three "Existing data (default)" lines, each mapped to its chunk.

1. **Stored "only this week" values are ignored; copying uses each week's actual content.**
   - Chunk 27: the code (copy, apply ahead and deload matching) and 038 (`v2_plan_week`).
   - No data changes. The carry columns keep their values, unread. F5 counts them.
   - Rollback: 037's function body.
2. **Today's run-wide rest, tempo and warmup routine are written into every week already planned in each active run, and become the run's default.** This is the data move.
   - **Rows:** every `v2_week_plans` row of each active run, all users, not yet per-week.
   - **Values:**
     - exercise rest, rest after and tempo from the run-copy row the week row points at;
     - set rest and stage rest from the program set its `program_set_id` names, only within its own slot, else null (the workout screen's rule today; F4 counts the null cases);
     - warmup items copied from the workout;
     - then the session's switch set.
   - **Where it runs:** migration 040, chunk 33, after chunks 30–32 are live and on every device.
   - **Proven by:** the parity query (0 differences, scratch then live) and Adam's before/after counts.
   - **Rollback:** switch the sessions back (one `update`), and the run copy is read again exactly as before.
   - **"Become the run's default":** nothing to write; the run copy holds them already (G25).
   - **Not moved:** completed runs (SPEC says active runs; nothing displays their values).
   - **Superset rest (and grouping, G21):** chunk 34's own move, the same way.
3. **Existing run priorities stay as they are and become read-only.**
   - Chunk 28: no data change; the active run's screen becomes read-only.
   - Completed runs' four-level pages: G31.

---

## Live app safety

What each chunk changes for Adam the day it merges, and why no existing week changes before the chunk that replaces it.

| Chunk | What changes | What stays the same |
|---|---|---|
| 27 | The tick is gone; the next week planned copies the current week as it is | Every existing week, which keeps the content it was planned with |
| 28 | Run priorities can't be edited in Plan | The marks shown |
| 29 | Plan's week is shown in two views | Every value and every action, moved but not changed |
| 30 | Nothing (schema only) | Everything |
| 31, 32 | Nothing until 33: every reader keeps reading the run copy | Everything |
| 33 | Rest, tempo and the routine become per week | Every value shown (parity 0) |
| 34 | Superset rest and grouping per G21 (same pattern) | Every value shown (its own parity) |
| 35 | Highlights appear | Values |
| 36 | A new action on stable runs | Weeks until someone uses it |
| 37 | The program tab is gone | Every capability, per G30's answers |

Every chunk merges to master on its own, with no stacking. Each migration goes live before code that needs it, except where a chunk says code goes first and why (27, 33).

---

## Consequences for Coach

1.1 changes no Coach code. Coach reads planned exercises through `v2_week_plan_sets → v2_program_exercises(exercise_id)` (`api/coach/ask.ts`, `weekBuckets.ts`) and logged rest from `v2_set_logs.rest_seconds` (`analysisInput.ts`). It reads none of the moved fields, the carry columns, or `v2_program_priorities`.
- **Chunks 27–35:** nothing Coach reads changes.
- **Chunk 36:** it writes the run's program exercise rows, so it must never rewrite `exercise_id` on a row planned sets point at (its scope says so). Otherwise past planned exercises would change for Coach.
- **G31:** `MesoPrioritiesPage` sits in `src/features/coach/`; changing it is Escalation 16.

---

## At every chunk boundary

TASKS.md's "At every chunk boundary" list holds unchanged, plus:
- **D30 proof** (master snapshot vs branch, plus a set-logging test) for every chunk that touches the workout screen or the rest timer: 31, 33, 34.
- **verify-rls:** `v2_week_plan_warmup_items` in `TABLES` from chunk 31 on; each run still needs Adam's go-ahead.
- **Data-changing migrations** (040, 34's move): Adam's before/after counts plus the parity query. Additive or function-only ones (038, 039): replay, embeds and the scratch fingerprint.
- **Test what must be absent.** For a removed or "only X" rule (no tick, no editors on unmarked weeks, no action on week-dependent runs), assert the absence (Checks that lied #32).
