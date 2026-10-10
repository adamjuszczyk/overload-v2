# Overload — Decisions

## Waiting on Adam
*Rewritten at every chunk boundary. Last: 2026-10-10, after the B1/B2 fixes and the docs merge; header updated the same day by the SPEC change 1.1 planning session. Phase 1 is closed out (chunks 1–26 merged and live, migrations through 037); nothing is being built. SPEC change 1.1 is planned in TASKS-1.1.md (chunks 27–33, not started). Adam answered G16–G34 and P1 (entry 80); the open gaps G35–G39 wait on Adam there, and aren't repeated here. The step 5 review is Adam's, against a checklist generated from SPEC.md (skip the [P1.1] rules, which aren't built).*

To-dos:
- **79** — confirm REDO SESSION is gone on a finished session's Today screen, after today's session. When: after today's session. Blocks: nothing. (The Move check and the Legs-row question are answered.)

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

### 80 SPEC change 1.1: Adam's answers to TASKS-1.1's gaps G16–G34 and P1
- What: The spec gaps TASKS-1.1 raised against SPEC change 1.1 (G16–G34), and P1: does D29 cover 1.1's function-only migrations?
- Answer (Adam):
  - Rest, tempo, the warmup routine and superset grouping stay run-wide, edited in the week's Structure view and labelled "every week". Per-week storage is a later revision (TASKS-1.1's appendix).
  - G16, G17, G21–G31, G34 and P1 (yes) are answered in TASKS-1.1 "Answered gaps" and SPEC.md [P1.1]. G18–G20, G32 and G33 fell away.
  - COMPACT is removed, which supersedes D6's compact view once TASKS-1.1 chunk 29 ships.
  - The answers raised G35–G39, open in TASKS-1.1.
- Date: 2026-10-10

### 79 After B1/B2: live check of REDO's removal
Severity: deferred
Chunk: none (bug fixes, 2026-10-10)
**Ask:** After the update banner, on a finished session's Today screen, check there is no REDO SESSION (only CONTINUE SESSION and the note editor). The Move check and the Legs-row question are answered (below).
**When:** after today's session, when you see the finished screen.
**Blocked until answered/done:** nothing.
**Answer:** (Adam, 2026-10-10) Move this session on a Saturday session offers only SAT and SUN, **confirmed live**. The 2026-10-10 LEGS row (`5eb82bfe-5099-42d0-b4d4-d9fdbffea39f`, `planned`, moved to 2026-10-08, the B2 repro) was removed by Adam moving it back to Saturday in the app *before* he ran the cleanup block, and Today shows Legs today. That accounts for the count: 9 sessions in the earlier output, minus the Legs row the move-back deleted, minus the empty twin the cleanup deleted, is the 7 it returned. REDO: **to be confirmed** after today's session.
**Evidence:**
What happened: the B1 cleanup (entry 78) returned `friday_status` completed, `friday_sets` 11, `twin_rows_left` 0, `sessions_since_oct1` 7, where I expected 8. The block itself could only delete the twin; Adam's account of the earlier move-back explains the other row (his statement, matching the arithmetic; I did not see the Legs row's deletion).
A competent default would: close the entry once Move was confirmed — doesn't apply because: the REDO check is the one that matters for B1 and cannot be done until a session is finished.
Cost of deferral: none.

### 78 B1: a finished session read SKIPPED with its numbers, plus an empty in-progress twin
- What: Friday 2026-10-09's PULL 2 (11 numbered sets) was `skipped` and an empty second PULL 2 started 34 minutes after its last set. Adam's query output ruled out a classifying finish, the missed-session prompt, a retried start and offline replay; what remains is REDO SESSION → CONFIRM (read from code, not observed; who tapped is unknown). Full text, query results and the guarded cleanup: HISTORY.md, 2026-10-10.
- Answer: Remove REDO SESSION (Adam, 2026-10-10): merged as #55 `a94e838`, test first. Cleanup run by Adam the same day: Friday's session back to `completed` with its 11 sets, the empty twin deleted. The offline gaps found on the way (no client id on an online start, an offline finish judged from Dexie's partial copy, a finish before queued sets sync, unguarded overlapping queue flushes) are read from code, not shown to have happened, and not fixed.
- Date: 2026-10-10

### 77 Chunk 25 live check: a throwaway sequence run on your second account (Adam's steps)
- What: Chunk 25: the throwaway sequence run on your second account (`live-checks/chunk25-sequence-run.md`); send the three count rows.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 76 Merge migration 037 (#51): sequence slots
- What: Merge migration 037 (#51): sequence slots (R16's unique key; `v2_plan_week` per slot), after the pre-check.
- Answer: Merged by Adam as #51 `26b0595`; deploy success; the code (#52) followed.
- Date: 2026-10-09

### 75 verify-rls: how to stop the false alarm from 74
- What: Fix the verify-rls false alarm from 74: empty the test account (a), or flag only rows the test account doesn't own (b).
- Answer: (b). Done: #53 `e8e0d00` (server-side head counts, total and foreign).
- Date: 2026-10-09

### 74 verify-rls found 46 `exercises` rows visible to the no-data test account
- What: verify-rls found 46 `exercises` rows visible to the no-data test account.
- Answer: Not a leak: the test account owns exactly those 46 of 335 rows; the owner-only policy works. Follow-up 75.
- Date: 2026-10-09

### 73 Chunk 25 failed review twice — one more test-only retry, or merge?
- What: Chunk 25 failed review twice: one more tests-only retry, or merge; and where the throwaway sequence run happens.
- Answer: (a), on the second account. The retry passed and chunk 25 merged.
- Date: 2026-10-09

### 72 Chunk 26 live check: navigation (Adam's steps)
- What: Chunk 26 app steps: no PROGRAM tab; Plan's header icon opens Programs; open in planner, priorities and delete reachable; START/END RUN present; old /program link works.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 71 Chunk 24 live check: move a session, several a day (Adam's steps)
- What: Chunk 24 app steps: the 29 Aug session shows 30 Aug in History; move a session and back; two sessions on one day; current-week-only missed prompt, DO IT NOW; no MOVE on started sessions.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 70 Merge migration 036 (#48): the legacy session's moved-to date
- What: Merge migration 036 (#48): the legacy session's moved-to date, after the pre-check.
- Answer: Merged by Adam as #48 `19cf372`; deploy success 08:58 UTC.
- Date: 2026-10-09

### 69 Chunk 23 live check: "last time" by exercise (Adam's steps)
- What: Chunk 23 app steps: LAST WEEK unchanged for same-workout last week; LAST TIME + days for another workout or an earlier run; FIRST TIME only if never done; deload sessions never shown.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 68 Chunk 22 live check: deload rules (Adam's steps)
- What: Chunk 22 app steps: switch deload rules on; mark a session → halved sets, 75% of last time's lifted weight; edit one, unmark → originals back; program CUSTOM override wins; a started session is flag-only; switch rules off after if wanted.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 67 Chunk 22 failed review twice — one more test-only retry, or merge?
- What: Chunk 22 failed review twice: one more tests-only retry, or merge?
- Answer: (a); the retry passed and chunk 22 merged.
- Date: 2026-10-08

### 66 Chunk 21 live check: deload per session (Adam's steps)
- What: Chunk 21 app steps: mark a week deload, unmark one session, DELOAD labels on Today/preview/workout, next week copies from the last normal one; unmark afterwards.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 65 Chunk 20 live check: apply this change to planned weeks ahead (Adam's steps)
- What: Chunk 20 app steps: a weight change applied ahead lands only on that set; swap ahead then a follow-up weight change both land; no offer after only-this-week; ignoring leaves later weeks alone.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 64 Chunk 20 failed review twice — merge, or one more test-only retry?
- What: Chunk 20 failed review twice: merge, or one more tests-only retry?
- Answer: (a); the retry passed and chunk 20 merged.
- Date: 2026-10-08

### 63 Chunk 19 live check: week targets and tags (Adam's steps)
- What: Chunk 19 app steps: weight, rep override and tags on a set; apply-to-all; AMRAP → RIR 0; shown in the session; next week carries weight and RIR, not tags; say if the busier Plan rows should collapse.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 62 Go-ahead to run verify-rls.mjs (five tables added since its last run)
- What: Go-ahead to run `verify-rls.mjs` once (five tables added since its last run).
- Answer: Yes (Adam). Run on master `f0bc7c6`: 59 pass, 1 flagged (`exercises`) → 74, not a leak; the check made owner-aware (75, #53). Done.
- Date: 2026-10-09

### 61 Chunk 18 live check: warmup routine (Adam's steps)
- What: Chunk 18 app steps: add/edit/reorder/delete warmup routine items; the checklist at the top of the session in order; a tick survives a reload; no items = unchanged.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 60 Chunk 17 live check: tempo (Adam's steps)
- What: Chunk 17 app steps: enter a tempo (x → X), invalid refused, blank clears; it shows beside the exercise name in the session; exercises without one unchanged.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 59 Chunk 16 live check: the rest chain (Adam's steps)
- What: Chunk 16 app steps: exercise REST / REST AFTER and one set's own REST show as the timer targets; nothing set = your Settings rest; a never-kinded dropset keeps its timer, an explicitly picked DROPSET has none; superset: no timer inside a round.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 58 Chunk 15 live check: warmup sets (Adam's steps)
- What: Chunk 15 app steps: plan a warmup; log, edit, delete; TICK mode; not counted in History, volume or Progress.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 57 Chunk 14 live check: staged sets in all four kinds (Adam's steps)
- What: Chunk 14 app steps: plan a rest-pause with 2 stages; all rows visible and locked in turn; carried weight; counts as 1 set; dropsets unchanged.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 56 Chunk 13 live check: supersets (Adam's steps)
- What: Chunk 13 app steps: link two exercises; rounds A1, B1, A2…; per-member prefill, swap, skip, ADD SET; block moves as one.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 55 Chunk 11 live check: the stepped planner (Adam's steps)
- What: Chunk 11 app steps: the planner opens and saves unchanged; a test program with 8–12 entered once per exercise; NO SETS YET on existing programs; G14 prompt; program tab read-only volume.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 54 Merge migration 034 (drop suggested reps: backup, convert into rep targets, drop the column)
- What: Merge migration 034 (#35): back up suggested reps, convert them into rep targets on the active run's unlogged planned sets, drop the column; Adam's before (B1–B3) and after (A1–A4) queries and counts files.
- Answer: Merged by Adam as `a76b146` (2026-10-06 18:27 UTC) without the before queries; the after queries won't be run. **Before/after checks not run.** The reviewer's deploy and probe evidence stands: deploy success 18:28 UTC; `select=target_reps` → 42703; backup table present; embeds 27/27 live.
- Date: 2026-10-09

### 53 Chunk 10 live check: priorities in the new form (Adam's steps)
- What: Chunk 10 app steps: Plan → PRIORITIES shows your mapped marks (1+2 focus, 4+5 don't care); summary wording; set/clear persists; completed runs keep the old page.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 52 Planner: what does "number of sets is required" block, for programs that have none yet?
- What: What "number of sets is required" blocks, for programs with no per-set rows yet (Adam's 3 existing ones).
- Answer: (a) nothing is blocked; exercises without a set count are flagged — as built in chunk 11.
- Date: 2026-10-09

### 51 Chunk 9 live check: editing a week's exercises (Adam's steps)
- What: Chunk 9 app steps: only-this-week swap reverts next week; permanent swap and add carry; remove stays removed; only-this-week reorder reverts; program tab read-only for volume.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 47 Chunk 8 live check: weeks plan themselves (Adam's steps)
- What: Chunk 8 app steps: a new week plans itself once; first session plans its week; NEW WEEK STARTS = EMPTY; deload and empty weeks aren't copy sources.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 46 Chunk 7 live check: each week's exercise list shows as before (Adam's steps)
- What: Chunk 7 app check: Plan and the workout screen show the same exercises in the same order, online and offline.
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

### 39 Chunk 5 live check: "Session type, all time" unchanged on today's data (Adam's steps)
- What: Chunk 5 live check: one SQL query (step 1 rewritten for chunk 6: run workouts all linked, saved ones none), then two or three workouts' all-time history pages unchanged (sessions are logged on run workouts, so each page still lists exactly what it did).
- Answer: Superseded by the step 5 review (Adam's, against a checklist generated from SPEC.md). **Folded into the review, not passed.**
- Date: 2026-10-09

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

### 41 Merge migration 029, the chunk 7 code, and follow-up 030
- What: Merge 029 (#24), the chunk 7 code (#25) and 030 (#26), in order.
- Answer: (a), merged by Adam 2026-10-05, each after the reviewer confirmed the previous deploy: 029 `61b2670` (probe 3/3), #25 `55bed82` (Vercel success), 030 `34c5887`. Parity query 0 rows. App check → entry 46.
- Date: 2026-10-05

### 45 Merge migration 031 (weeks plan themselves) and the chunk 8 code
- What: Merge 031 (#27) and the chunk 8 code (#28).
- Answer: (a), merged by Adam 2026-10-05: 031 `c128d00` (anon RPC refused by the function), #28 `071151b` (Vercel success 18:57 UTC). App steps → entry 47.
- Date: 2026-10-05

### 48 Should adding or removing an exercise in a week also offer "only this week"?
- What: SPEC line 212 (tick on swap and reorder) vs line 224 (add/remove "unless only this week").
- Answer: (a) swap and reorder only; week-dependent adds and removes always carry forward. SPEC line 224 fixed to match.
- Date: 2026-10-05

### 49 Chunk 12: what happens to existing suggested-reps values
- What: SPEC's blocking decision for chunk 12 (drop `target_reps`), asked early.
- Answer: (b) convert into rep targets on the active run's unlogged planned working sets that have none, with the backup table as planned. Recorded in TASKS.md chunk 12. The merge and live counts stay Adam's.
- Date: 2026-10-05

### 50 Chunk 25: throwaway sequence test run
- What: Go-ahead for chunk 25's live check, which writes a throwaway run.
- Answer: Yes. Label it `TEST-…`, and prove the cleanup by counts against the baseline.
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

**D29 · Flagged migrations the reviewer may merge (phase 1).** *(Adam, 2026-10-05)*
**Answer:** For the rest of phase 1 the reviewer may merge a migration `check-migration` flags if it changes no existing row and all three checks pass: `migration-replay`, `check-embeds-local.sh`, and the reviewer's scratch-copy check (existing rows' counts and fingerprints unchanged).
- Allowed: it only adds tables, columns, indexes or rows, replaces a function or view, or relaxes a constraint. That covers 032, chunk 10's and chunk 15's.
- Still Adam's: 12, 24 and 25.
- Order unchanged: migration first, then the code after a green deploy.

**D30 · Workout screen unchanged for plain sessions.** *(Adam, 2026-10-05)*
**Answer:** Every chunk that touches the workout screen or the rest timer (13–16 and any other) proves before merging that a session with none of the new features behaves exactly as before: plain sets, an existing dropset, no supersets, warmups, tags, tempo or rest overrides. It must render, log and time rests the same.
- Proof 1: a jsdom snapshot of the full session screen, taken on master before the chunk and compared with the chunk's branch.
- Proof 2: a test that logs a set and checks the row written.
- Any difference that isn't a new feature blocks the merge.
