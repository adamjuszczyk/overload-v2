# TASKS-1.1.md — Overload Planner Extension, revision 1.1

**Spec:** SPEC.md, the rules tagged **[P1.1]**: SPEC change 1.1 (`ac48b66`) and Adam's two rounds of answers to the gaps it raised, all 2026-10-10. This file plans those rules only; everything else stays as phase 1 built it (TASKS.md).
**Status:** draft, planning only; no application code written.
- Adam answered G16–G34 and P1, then G35–G37, G39–G44 and P4, on 2026-10-10 ("Answered gaps"). G38 became a reading.
- Rest, tempo, the warmup routine and superset grouping stay run-wide in this revision. Making them per week moved to the appendix ("Later: per-week structure").
- **Standing rule (Adam, 2026-10-10; DECISIONS D31):** a display-only edge case (what's highlighted, a label, an empty state, where a control sits) gets the simplest option consistent with SPEC. It's recorded as a provisional decision in DECISIONS.md's "Waiting on Adam", and the work continues. Only something that changes data or behaviour stops a chunk.
- No gap is open. Adam answered G45 "no" on 2026-10-10 (option (c) below). Six provisional decisions are listed below.
**Numbering** continues from TASKS.md: chunks 27–35, migrations 038–040, spec gaps from G16.
- This version's 31, 32 and 33 were the first draft's 35, 36 and 37. Chunk 30 is new. Chunks 34 (stable weight pairing, G44) and 35 (a sequence run's current cycle, G40) came with the second answers.
- The appendix keeps the first draft's chunks 30–34 as L1–L5.
**Baseline:** master `d345f5c`; migrations 001–037 live (next number 038); `npx vitest run` passes 1782 tests in 141 files there (run 2026-10-10).
**Two things the brief adds to TASKS.md's format:**
- Every rule's verification names the call site or screen-level assertion that proves it's wired, not only the pure function.
- Every chunk says what the live app shows after it merges. Nothing changes what an existing week shows until the chunk that replaces it is complete ("Live app safety").

---

## Answered last: G45

**Answer (Adam, 2026-10-10): no, option (c).** "A set with no program set of its own exercise has no own rest; it uses its exercise's rest, then the global rest, as today." Applied to SPEC Rest [P1.1] and to chunk 30. The write-up below is kept as asked.

### G45 — A set's own rest, on a set with no program set of its own exercise
- **SPEC:** a set's own rest and stage rest are run-wide and edited in Structure (Rest [P1.1], L322). "Every week" means every week that exercise slot appears in, and an exercise added or swapped in during a week carries its own values (Programs and runs [P1.1], L159–164; your G35 answer).
- **Today:** a set's own rest and stage rest live on a program set (`v2_program_sets`). The workout screen reads them only from a program set of the set's own exercise row (`useExerciseCardState.ts` L257–262, L304–306). These sets have none, so they follow their exercise's rest and can't have one of their own:
  - a set added in a week (`addSet`, `weekPlanService.ts` L387, writes no `program_set_id`);
  - every set of an exercise added in a week;
  - the sets of a swapped-in exercise. They still name the replaced row's program sets, which the screen doesn't read for the new row.
- **Your G35 answer settles the exercise-level values** (rest, rest after, tempo, unit, grouping): chunk 30 edits them on the added or swapped-in exercise's own row. A set-level rest needs a program set to live on.
- **Unsaid (it changes data):** should these sets be able to have their own rest? If yes, each gets a program set under its own exercise row, kept out of the run's default (on a stable run, a program set under one of the run copy's own exercises would otherwise join the default):
  - (a) created when the set is first given a rest. The rest then reaches that week and weeks copied from it afterwards (copies carry `program_set_id`), but not weeks already planned;
  - (b) created with the set (every ADD SET, added exercise and swap), so every copy shares it from the start;
  - (c) no: they keep following their exercise's rest, and Structure shows no set REST or STAGE REST on them.
- **Stopped:** chunk 30, for these sets only. Answered (c): they ship as today.

---

## Provisional decisions (display only, under D31)

Each is an entry in DECISIONS.md's "Waiting on Adam" and is built as written unless Adam changes it.

| DECISIONS | Question | Provisional choice | Chunk |
|---|---|---|---|
| 82 | Which exercises count as "moved", beyond two neighbours trading places (G36) | Every exercise outside any of the largest groups that kept their order. Two neighbours that trade places are then both highlighted, as you said; one exercise moved past two others is the only one | 31 |
| 83 | The same exercise twice in one workout, when exercises are matched by identity (G36) | Paired in order of position | 31 |
| 84 | How Plan knows a week started empty (G42). Nothing records it | On a week-dependent run, while Settings → NEW WEEK STARTS is "empty", weeks after week 1 show no highlighting. A week with no source shows none either. Exact alternative (a data change, so only if you want it): record each week's source when it's planned | 31 |
| 85 | How START shows that a schedule is needed (G39) | START disabled, with one line under it: "Schedule at least one workout to start". Same on the planner and the Programs page | 33 |
| 86 | Plan's line for a run with no schedule (G39) | "NO WORKOUTS SCHEDULED", then "Programs →" linking to the Programs page. One line for weekday and sequence runs | 33 |
| 87 | Where and how the deload rules show (G43) | One read-only line under MARK WEEK AS DELOAD (MARK CYCLE AS DELOAD): the rules in effect, and whether they're your default or this run's. Nothing when no rules are on (standing UI rule) | 33 |

---

## Answered gaps (Adam, 2026-10-10)

Applied to SPEC.md as [P1.1] and to the chunks below. The gaps' write-ups are in git history: G16–G34 at `efb7789`, G35–G44 at `75e3423`. The ones that fell away are in the appendix.

**First round**

| Gap | Answer | Applied in |
|---|---|---|
| — | Rest, tempo and the warmup routine stay run-wide: shown and edited in the Structure view, labelled "every week". Per-week storage is a later revision; chunks 30–34 move to the appendix; no live-data queries (F1–F6) now. | SPEC Programs and runs, Rest, Tempo, Warmup routine, Plan screen, Later; chunk 30; appendix |
| G16 | Stage and warmup numbers in Sets; adding and removing warmups and stages in Structure. | SPEC Plan screen; chunk 29 |
| G17 | Page-level actions above both views; COMPACT removed. | SPEC Plan screen; chunk 29 |
| G21 | Superset grouping run-wide, edited in Structure, labelled "every week". | SPEC Supersets, Plan screen; chunk 30 |
| G22 | Compare against the source as it is now. | SPEC Plan screen; chunk 31 |
| G23 | Removals: a dim struck-through line in place. Order: only the moved item highlighted. Each view marks only its own fields; a ⋯ shows a dot if something inside differs. Exercises matched by exercise identity; sets by position. | SPEC Plan screen; chunk 31 |
| G24 | Weights and RIR always come from last week, for both types. The default holds sets, reps and structure. Numbers are highlighted against last week. | SPEC Weeks and copying, Plan screen; chunks 31, 32 |
| G25 | The default is the run's copy. | SPEC Objects stored, Weeks and copying; chunk 32 |
| G26 | Apply ahead after making a default updates later planned weeks only where they still match the old default. | SPEC Weeks and copying; chunk 32 |
| G27 | Deload sessions excluded, and their workouts keep the current default; not offered on an all-deload week. | SPEC Weeks and copying; chunk 32 |
| G28 | The first occurrence becomes the default. | SPEC Weeks and copying; chunk 32 |
| G29 | Current and future weeks only, with a confirm step, no undo. | SPEC Weeks and copying, Plan screen; chunk 32 |
| G30 | Schedule, workouts and the deload override are fixed for the run. Exercise units move to the exercise's ⋯ in Structure. The planner refuses to open a run copy. | SPEC Programs and runs; chunks 30, 33 |
| G31 | Completed runs' priorities pages unchanged. | SPEC Programs and runs; chunk 28 |
| G34 | Week 1's weights and RIR are not highlighted. | SPEC Plan screen; chunk 31 |
| P1 | Yes, D29 covers 038/039. | chunk 27 |

**Fall away with per-week storage** (kept in the appendix): G18, G19, G20, G32, G33, and G23's per-week parts. G20's second half (what a week that started empty is compared with) came back as G42.

**Second round**

| Gap | Answer | Applied in |
|---|---|---|
| G35 | "Every week" means every week that exercise slot appears in. An added or swapped-in exercise's slot carries its own values. Linked exercises show as a superset only in weeks where they're adjacent. | SPEC Programs and runs, Supersets, Plan screen; chunk 30 (raises G45) |
| G36 | A swap shows as removed + added: the old exercise struck through, above the new one highlighted. Two neighbours that traded places: both highlighted. | SPEC Plan screen; chunk 31 (provisional 82, 83) |
| G37 | Reps: a stable week's against the default, a week-dependent week's against last week, week 1's against the run's copy (highlighted). | SPEC Plan screen; chunk 31 |
| G39 | The planner requires a schedule before Start. An existing run with none shows a line linking to the Programs page. | SPEC Programs and runs, Plan screen, Programs page, Program planner; chunk 33 (provisional 85, 86) |
| G40 | On a sequence run, the current week is the cycle containing the next due workout. | SPEC Scheduling; chunk 35, used by 32 |
| G41 | The first normal occurrence becomes the default. | SPEC Weeks and copying; chunk 32 |
| G42 | A week that started empty is compared with nothing (no highlighting). | SPEC Plan screen; chunk 31 (provisional 84) |
| G43 | A run on "use my default" following Settings is intended. Show the rules in effect read-only next to the deload action. | SPEC Deload; chunk 33 (provisional 87) |
| G44 | Fix it as its own small chunk: pair warmups with warmups and working sets with working sets, by position. | SPEC Weeks and copying; chunk 34 |
| P4 | Yes, D29 covers 039 (chunk 32's migration, now 040). | chunk 32 |
| G45 | No (c): a set with no program set of its own exercise has no own rest; it uses its exercise's rest, then the global rest, as today. | SPEC Rest; chunk 30 |

**Readings** (the six marked ✓ confirmed by Adam, 2026-10-10):
- ✓ **G26 "only where they still match the old default"** is per part: each exercise, its place in the order, each set and each rep target or kind. It isn't whole weeks.
- ✓ **G23 "sets by position"** uses chunk 20's set position (head ordinal, then stage index), warmups included. Adding a warmup set above the working sets shifts every position after it.
- ✓ **G24 "last week"** is the copy's weight source: the last planned normal, non-empty occurrence of that workout (or slot). It's used for weights, RIR and their highlighting, and for a week-dependent week's reps.
- ✓ **G17's page-level actions:** the per-session DELOAD toggle, the apply-ahead banner and COPY THIS WORKOUT sit at the top of each workout's panel, above both views. COPY WEEK, MARK WEEK AS DELOAD and MOVE THIS SESSION sit above the panel, as today.
- ✓ **No apply-ahead offer after a run-wide edit.** SPEC offers it "when a week is edited"; a run-wide edit changes the slot's own row, which every week showing it already reads.
- ✓ **An exercise's unit** is editable in Structure on both planning types, and isn't labelled "every week". Today only a stable run's program tab can change it (`StepExercises.tsx` L681).
- **Run-wide fields aren't compared** for highlighting. SPEC says so; a week and its source read the same values.
- **Week 1 is compared with the run's copy as it is now** (this was G38). A run never refers to its saved program after it starts (SPEC L154–156), and week 1 was planned from the run's copy (037 L238, L325). Your G37 answer compares week 1's reps with it.

**Readings of the second answers** (say if any is wrong):
- **G39 "the planner requires a schedule before Start"** covers every START: the planner's and the Programs page's. The Programs page starts a run without opening the planner (`ProgramsPage.tsx` L101, L330).
- **G40 "the next due workout"** is the one Today shows next: the slot after the last done or skipped workout (`resolveNextSlot`, `sequenceSchedule.ts` L86), whether it's due yet or not. A workout in progress is that slot.
- **G44, a slot that wasn't in last week** (swapped out there) gets no weights in the new stable week, as today. Weights come only from last week, which has no sets for it.
- **G35, a swapped-in exercise's own values** start as today's swap leaves them: the replaced row's grouping, and no rest, tempo or unit of its own (`resolveSwapSlot`, `weekEdits.ts` L82–89).

**Stale wording, fixed in SPEC.md** (first round):
- Objects stored → Program set: "for stable this is the volume".
- Objects stored → Run: "what the program tab shows and edits".
- Objects stored → Week: "whether each is 'only this week'".
- Supersets: grouping "changed in the program tab".
- Stepped program planner step 3: "the volume for every week".
- Navigation and settings: "folds into the plan screen as its program tab".

**Also clarified in SPEC.md, after a review of the first answers:**
- Weeks and copying: a week is planned when it's first opened "in the planner" → "in Plan". The planner never opens a week, and now refuses a run's copy.
- Adding or removing an exercise, stable: "a one-off for that week" → "…unless that week is then made the new default".

---

## Process notes

- **P1 — answered:** D29 covers 038 (it only replaces a function).
- **P3 — Order inside chunk 27.** Its code ships before its migration 038, the inverse of the standing "migration first" rule. That rule exists for code that needs the migration, and this code doesn't. Reason in the chunk; chunk 12 set the precedent.
- **P4 — answered:** D29 covers chunk 32's migration: 039 when you answered, 040 now that chunk 34's goes first. It adds a column, replaces `v2_plan_week` and adds a function. Chunk 34's 039 only replaces a function, so D29 covers it too. The reviewer merges each once `migration-replay`, `check-embeds-local.sh` and the scratch check pass.
- **P5 — Three `v2_plan_week` replacements in a row.** 038 (27), 039 (34) and 040 (32) each replace the function. Each starts from the body before it, and they merge in that order.
- **D31 — the standing rule** (Status above). The provisional decisions are in DECISIONS.md entries 82–87.

---

## Data model (1.1)

No new tables. One new column, `v2_program_sets.removed_at` (040, chunk 32); everything else maps onto the schema phase 1 left. Conventions as in TASKS.md.

| SPEC [P1.1] | Stored as |
|---|---|
| The run's default (stable) | The run's copy (G25): `v2_programs` with `kind = 'run'`, its program exercises (not `week_only`, not `removed_at`) and its program sets (not `removed_at`, from 040). That's already what `v2_plan_week` plans a stable week from (037/038). |
| Rest, tempo, the warmup routine, superset grouping, an exercise's unit | Unchanged: on the run's copy (`v2_program_exercises`, `v2_program_sets`, `v2_program_superset_blocks`, `v2_workout_warmup_items`). Chunk 30 edits them from the week. |
| Weights and RIR | Unchanged: week plan only. A new week takes them from last week, for both types. Chunk 34's 039 changes how a stable week pairs them (by set kind and position); no new column. |
| "Make this week the new default" | Migration 040 (chunk 32): `v2_make_week_default`, which rewrites the run's copy atomically, and `v2_program_sets.removed_at timestamptz` (null = part of the default), so a set the default drops is soft-removed, as a program exercise already is. |
| Highlighting | Computed in the client from the week plans Plan already loads (`useAllWeekPlans`) and the run's copy: its exercises, already loaded, and its sets, a new `useProgramSets` read (chunk 31). Compared as it is now (G22), so nothing is stored. Whether a week started empty isn't stored either (provisional 84). |
| "Only this week" | Removed. `carry_program_exercise_id` / `carry_position` stay in the schema, unread; dropping them would be destructive and buys nothing. |
| Run priorities | Storage unchanged (`v2_program_priorities` on the run's copy); the app stops writing a run's marks. |
| A sequence run's current cycle | Computed in the client from the sequence and the last done or skipped workout, as Today does (chunk 35). Nothing stored. |
| Starting a run needs a schedule | A check at each START in the client (chunk 33). No database guard: the app has no other way to start a run. |
| The deload rules shown in Plan | Resolved as deload marking already resolves them (chunk 33). Nothing stored. |

---

## Files

**New**

| Path | Chunk | What |
|---|---|---|
| `supabase/migrations/038_p11_plan_week_ignore_carry.sql` | 27 | `v2_plan_week` copies each week's actual content |
| `supabase/migrations/039_p11_stable_weight_pairing.sql` | 34 | `v2_plan_week` pairs a stable week's weights by set kind and position |
| `supabase/migrations/040_p11_make_week_default.sql` | 32 | `v2_program_sets.removed_at`; `v2_plan_week` skipping removed sets; `v2_make_week_default` |
| `scripts/probe-specs/040.json` | 32 | live probe of the new column |
| `src/features/plan/weekDiff.ts` (+ test) | 31 | what differs from the week's source |
| a schedule check (+ test), e.g. `src/features/programs/hasSchedule.ts` | 33 | shared by Plan's no-schedule line and every START |
| the last-event helper (+ test), moved out of `useSequenceScheduler.ts` | 35 | shared by Plan and Today |

**Changed most:**
- `src/features/plan/{PlanPage, weekPlanService, useWeekPlan, applyAhead, ApplyAheadOffer, PrioritiesEditor}`
- `src/features/plan/weekEdits.ts` (shrinks in 27)
- `src/lib/deloadRules.ts` (slot identity, 27)
- `src/features/planner/{StepExercises, StepVolume}`: their design-field editors shared with Plan's Structure view (30); their `onVolumeChange` props go with the program tab (33); the planner's own use unchanged
- `src/features/planner/PlannerPage.tsx` (refuses a run's copy; START needs a schedule, 33)
- `src/features/programs/ProgramsPage.tsx` (START needs a schedule, 33)
- `src/features/gym/useSequenceScheduler.ts` (its last-event step moves to the shared helper, 35)
- `src/types/index.ts`

**Removed:**
- `src/features/plan/ProgramTab.tsx` and its tests (33)
- `src/features/plan/{CompactPlanRows.tsx, compactPlanLogic.ts}` and its test (29)
- the carry helpers in `weekEdits.ts` (27)

**Never touched:** `src/features/coach/*` (`MesoPrioritiesPage` included, per G31), `api/coach/*`, the existing exports of `referenceLogic.ts` and `setGroupLogic.ts`, and the shared scripts (`check-migration`, `migration-rules`, `check-context-size`).

---

## Chunks in build order

**Order:**
- **No open gap blocks any chunk.** G45 is answered (c): chunk 30's sets with no program set of their own exercise ship as today.
- **27** and **28** can start now; 28 can go at any time.
- **34** follows 27: its 039 replaces 038's `v2_plan_week` (P5).
- **35** can go at any time, before 32.
- **29** follows 27, so there's no tick to place; **30** and **31** follow 29.
- **32** follows 29, 34 and 35: its action sits above both views, its 040 replaces 039's `v2_plan_week`, and on a sequence run it's offered from 35's current cycle.
- **33** (the program tab goes) comes last, after 28, 30 and 32.
- No stacked PRs: each chunk merges to master on its own (retro, section 3.7).

### Chunk 27 — "Only this week" is removed
**Goal:** No "only this week" tick anywhere. A swap or reorder in a week is a normal week edit. Stored "only this week" values stop affecting any copy or match.
**SPEC:** Weeks and copying [P1.1] "'Only this week' is removed" and its existing-data line; Plan screen [P1.1] "No 'only this week'".
**Scope:**
- **`PlanPage.tsx`:**
  - remove both ONLY THIS WEEK toggles (weekday branch L644–651, sequence branch L706–713);
  - remove the `onlyThisWeek` state (L146) and prop (L687, L739, L776, L790);
  - `handlePickReplacement` (L974) and `handleMoveExercise` (L1038) always record the apply-ahead change; their `if (onlyThisWeek)` dismiss branches go.
- **Services:**
  - `useSwapWeekExercise` / `useReorderWeekExercises` (`useWeekPlan.ts`) and `swapWeekExercise` (L981) / `reorderWeekExercises` (L1116) lose the parameter;
  - both write exactly what a permanent edit writes today: a swap clears `carry_program_exercise_id` and keeps `carry_position` (`weekEdits.ts` L129); a reorder clears `carry_position` and leaves `carry_program_exercise_id`. Values of the other kind stay, so 037 keeps honouring them until 038 (P3);
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
**Migration:** 038 replaces one function. **Not destructive:** no row changes, and the carry columns keep their values, unread. **Rollback:** `create or replace` with 037's `v2_plan_week` body verbatim; that only restores server-side honouring of stored values. `check-migration` exits 1 (function); D29 lets the reviewer merge it (P1, answered).
**Verification:**
- **Rule: no tick.**
  - Screen: `PlanPage` on the current week of a week-dependent weekday run and of a sequence run → `queryByText('ONLY THIS WEEK')` is null in both. It's an absence test (Checks that lied #32).
  - Break proof: put one toggle back → the test fails.
- **Rule: a swap or reorder carries forward.**
  - Screen: swap through the exercise ⋯ (`planMenus.testutil.ts`) → the mocked `swapWeekExercise` gets no `onlyThisWeek`, and the apply-ahead banner appears because a later week is planned (it was suppressed after a ticked swap). Same for MOVE UP.
  - Service: a swap's update payload clears `carry_program_exercise_id` and has no `carry_position`; a reorder's clears `carry_position` only. Break: write a ticked value → the test fails.
- **Rule: stored values are ignored by copying.**
  - Client: COPY WEEK on `PlanPage` (`copyOnePlanForward`), from a source row whose carry fields name a different slot and position → the inserted `v2_week_plan_exercises` payload has the source row's own `program_exercise_id` and `position`, and each set keeps its own `program_exercise_id`. Break: restore the `??` fallback → the test fails.
  - Server: scratch replay of 001–038, with a fixture where week 2's row is an old only-this-week swap (`carry_program_exercise_id` = the original slot) and has `carry_position` ≠ `position` → `v2_plan_week(meso, 3)`, called as the fixture user, copies the swapped-in slot at week 2's position with its sets. Break: 037's body → the result differs. Executed, not read (Checks that lied #28).
- **Rule: matches ignore stored values.**
  - Apply ahead: `PlanPage.applyAhead` screen test where a later week's row has carry = the edited row's id but a different own id → that week is skipped; a later row with the same own id matches.
  - Deload: wired at `markSessionDeload` (`weekPlanService.ts` L1593), the only caller of the mapping. Its test (`weekPlanService.deloadExerciseMapping`) gives a base row whose carry names another slot, and asserts the inserted sets take the marked week's exercise matched by own id. Break: restore `carryProgramExerciseId ?? programExerciseId` (`deloadRules.ts` L206) → the test fails. The Plan screen tests mock `useWeekPlan`, so the proof sits at this call site.
- **Boundary checks:** typecheck, test, build; `check-program-exercise-reads.mjs`; `check-embeds-local.sh`. The `!v2_week_plan_exercises_program_exercise_id_fkey` hint stays, because the carry FK column still exists.
**Would not catch:**
- An old bundle still open until it updates. It still offers the tick, and its client copy (L812–813, L882), apply-ahead (`slotIdOf`) and deload matching still read stored values. The server ignores them once 038 is live.
- Weeks already planned from a source with stored values keep what they got (existing weeks don't change).
**Live app after it:** no existing week changes; the tick is gone; the next week planned copies the week before it as it actually is.
**Done when:** the code and 038 are live, and the scratch proof shows a new week copying its source's actual content.

### Chunk 28 — Priorities are view-only in Plan
**Goal:** During a run, Plan shows the run's priorities and can't change them. They're set on saved programs in the planner and copied to a run when it starts.
**SPEC:** Programs and runs [P1.1] "Priorities are a property of the program" and its existing-data line; Plan screen [P1.1] "Priorities are shown view-only".
**Scope:**
- **`PrioritiesEditor.tsx`** (route `/plan/priorities`, opened from Plan's header button, `PlanPage.tsx` L425–436):
  - each group and subgroup shows its mark as a read-only label, and only where one is set (standing UI rule);
  - groups still unfold;
  - no `MarkSelector`, and no `useSetPriorityMark` call (L46).
- **Unchanged:**
  - the planner's `StepPriorities` (saved programs; it's then the only caller of `useSetPriorityMark`);
  - `v2_start_run` / `v2_copy_program`, which already copy marks to the run;
  - completed runs' priorities pages (`MesoPrioritiesPage`, in the frozen `src/features/coach/`; G31's answer).
- **Not added:** a database-level guard. It would be a new policy on an existing table, which is Adam's merge, and the app has no other write path to a run's marks.
**Depends on:** —
**Migration:** none.
**Verification:**
- **Rule: view-only in Plan.**
  - Screen: `PrioritiesEditor` with marks on the run copy → each mark's label shows; tapping a group expands it; no FOCUS / DON'T CARE control exists; `useSetPriorityMark`'s mutate spy is never called.
  - Break proof: restore one `MarkSelector` → the test fails.
- **Rule: set in the planner.** `StepPriorities.test.tsx` passes unmodified (the planner still writes saved programs' marks).
- **Rule: copied at start.** Wired at `ProgramsPage` START → `useStartRun` → `v2_start_run` → `v2_copy_program`'s priorities loop (034). That's unchanged code, proven on scratch in R7. `ProgramsPage.test.tsx` already asserts the RPC call.
- **Completed runs unchanged:** `check-frozen-code.mjs` passes (nothing under `src/features/coach/` moved).
- **Header link:** Plan's PRIORITIES still opens `/plan/priorities` (screen test).
**Would not catch:** a write through another path; none exists after this chunk.
**Live app after it:** the same marks, no longer editable in Plan; completed runs' pages as before.
**Done when:** live, and the run's marks can't be changed from Plan.

### Chunk 29 — Plan shows one week in two views
**Goal:** Plan's week panel has a Sets view and a Structure view, each holding the week controls SPEC gives it. Every control still does exactly what it did. COMPACT goes.
**SPEC:** Plan screen [P1.1] two views (with G16's and G17's answers); the standing UI rule.
**Scope:**
- **The switch:** a SETS / STRUCTURE switch, built from the WEEKS/PROGRAM bar's own pattern (no new visual language; Escalation 19).
- **Sets view:**
  - working set rows (number, weight, reps, RIR) with ⋯ for tags and DELETE SET, and the `+` ADD SET;
  - stage rows' numbers (weight, reps and RIR, as today: `PlanPage.tsx` L1820–1826) under their head;
  - warmup sets' numbers (weight, reps; no RIR, as today);
  - tag markers.
- **Structure view:**
  - the exercise ⋯: SWAP EXERCISE, MOVE UP/DOWN, REMOVE FROM THIS WEEK, ADD WARMUP SETS;
  - ADD EXERCISE;
  - each set's kind: a warmup set's DELETE, and a staged set's ADD STAGE, STAGE KIND and DELETE STAGE;
  - chunk 30 adds the run-wide fields.
- **Page-level actions above both views (G17).** COPY WEEK, MARK WEEK AS DELOAD and MOVE THIS SESSION stay above the workout panel. The per-session DELOAD toggle, the apply-ahead banner and COPY THIS WORKOUT (`PlanPage.tsx` L1225–1238) sit at the top of each panel, above the views.
- **COMPACT removed (G17):** delete the toggle, the `compact` state, `CompactPlanRows.tsx`, `compactPlanLogic.ts` and its test. That supersedes D6's compact view. DECISIONS entry 80 records it, and D6 stays as written (D1–D28 aren't edited).
- **Handlers move, not rewritten:** `handlePickReplacement`, `handleMoveExercise`, `handlePickAdd`, `handleConfirmRemove`, `useAddSet`, `useRemoveSet`, `useAddStage`, `useAddWarmupSet` and `useUpdateSet`, with their apply-ahead records.
- **Unchanged:** past weeks stay read-only in both views, as today. The WEEKS/PROGRAM bar stays until chunk 33; both views live inside WEEKS.
**Depends on:** 27 (no tick to place).
**Migration:** none.
**Verification** (screen level, menus opened through `planMenus.testutil.ts`):
- **Sets view:**
  - a working set row shows number, weight, reps and RIR; its ⋯ offers tags and DELETE SET, and no ADD STAGE / STAGE KIND (absence asserted);
  - `+` calls `useAddSet` with the same arguments as before;
  - a stage row's weight, reps and RIR editors call `useUpdateSet` with that stage's id;
  - a warmup set shows its numbers and no RIR stepper.
- **Structure view:**
  - each exercise-⋯ action and each kind control calls the same mutation with the same arguments as on master;
  - ADD WARMUP SETS and a warmup set's DELETE are only here (absent from Sets).
- **Page-level:** the actions, COPY THIS WORKOUT included, render above the switch's content in both views. COMPACT is absent (absence asserted).
- **The existing tests prove it:** every `PlanPage.*` screen test and `MoveSessionControl.test.tsx` passes with only "open the view" steps added. The exception is COMPACT's own assertions, which become absence checks. No expected argument changes, and the reviewer reads the test diff for that.
- **Moved controls keep their actions** (Checks that lied #29): every apply-ahead offer still fires after each edit type.
- **Render fixture:** `__fixtures__/planpage-chunk6-render.html` is re-captured, and the diff is reviewed as layout only (no value differs).
- **Width:** 375 px in a real browser with fixtures, both views, no horizontal overflow (as the UI-rule session did).
**Would not catch:** the run-wide fields (30) and highlighting (31).
**Live app after it:** the same content, split across two views, without COMPACT.
**Done when:** live, with every control from before in one view and working.

### Chunk 30 — Rest, tempo, grouping, the routine and units in the Structure view (run-wide)
**Goal:** The run-wide fields are shown and edited in the week's Structure view: rest (the exercise's rest and rest after, a set's own rest, stage rest, superset rest), tempo, superset grouping and the warmup routine, each labelled "every week", and an exercise's weight unit, in its ⋯. Each edit goes to the exercise's own row, the way the program tab edits the run copy's rows today, so it reaches every week that exercise slot appears in, from the next session load.
**SPEC:** Rest, Tempo, Supersets, Warmup routine [P1.1] ("run-wide … labelled 'every week'"); Programs and runs [P1.1] (units in the exercise's ⋯); Plan screen [P1.1] Structure view.
**Scope:**
- **Reuse the program tab's editors and their run-copy mutations.** Extract them from `StepExercises` / `StepVolume` where needed, leaving the planner's own use unchanged:
  - `RestStepper` → `useUpdateProgramExerciseRest`; `TempoEditor` → `useUpdateProgramExerciseTempo` (`normaliseTempo`; invalid → inline error, nothing written);
  - the unit chips → `useUpdateProgramExerciseWeightUnit`;
  - `SupersetLinkToggle` → `useToggleSupersetLink`; the block's WITHIN ROUND / AFTER ROUND → `useUpdateSupersetBlockRest`;
  - set REST → `useUpdateProgramSetRest`; STAGE REST → `useUpdateProgramSetStageRest`;
  - the warmup-routine editor → `useAddWarmupItem` / `useUpdateWarmupItemBody` / `useRemoveWarmupItem` / `useReorderWarmupItems`.
- **Placement, by the standing UI rule:**
  - exercise REST, REST AFTER, TEMPO and the unit in the exercise's ⋯, with a marker where set;
  - a set's own REST, and a staged head's STAGE REST, in that set's ⋯;
  - link toggles between neighbours, and a block's round rests after its last member;
  - the routine at the top of the Structure view.
  - Rest, tempo, grouping and the routine carry an "EVERY WEEK" label (existing tokens; Escalation 19 otherwise). The unit doesn't: SPEC labels only those four (L599–601; see "Readings").
- **Units on both planning types.** The program tab lets only stable runs change a unit (`StepExercises.tsx` L681, `disabled={readOnly}`, where `readOnly` is `volumeReadOnly`). In Structure it's editable on both (see "Readings").
- **Which rows it edits (G35):** each exercise's own row, which is its slot, so a change reaches every week that slot appears in:
  - the run's own exercises (rows of the run's copy), including ones "Make this week the new default" later soft-removed, in the weeks that still show them;
  - exercises added or swapped in a week: their own `week_only` rows. A swapped-in row starts with the replaced row's grouping and no rest, tempo or unit of its own, as today (see "Readings");
  - a set's own REST and STAGE REST where the week's set names a program set of its own exercise row. That's the workout screen's own lookup (`useExerciseCardState.ts` L257–262, L304–306).
  - **G45, answered (c):** sets with no such program set (sets added in a week, and the sets of added or swapped-in exercises) have no own rest. They show no set REST or STAGE REST and follow their exercise's rest, then the global rest, as today.
- **Grouping (G35):** any two neighbours in this week can be linked or unlinked; `planLinkToggle` runs over this week's order, not the run copy's. Linked exercises show as a superset only in weeks where they're next to each other. Plan and the workout screen already group consecutive members only (`groupIntoUnits`, `supersetGroups.ts` L38; `GymSession.tsx` L329), so neither display changes.
- **No apply-ahead offer:** a run-wide change already reaches every week its slot appears in.
- **The program tab keeps its editors until chunk 33.** Both edit the same rows, so they never disagree.
**Depends on:** 29.
**Migration:** none.
**Verification:**
- **Wired to the run's copy (screen):**
  - in the Structure view, REST on exercise X → `useUpdateProgramExerciseRest` gets X's run-copy row id, the same call `ProgramTab` makes. Break: pass the week row's id → the test fails.
  - The same check covers REST AFTER, TEMPO (an invalid entry writes nothing), the unit, set REST, STAGE REST, link and unlink, WITHIN / AFTER ROUND, and the routine's add, edit, remove and reorder.
- **Label:** each rest, tempo, grouping and routine control shows "EVERY WEEK"; the unit doesn't (screen).
- **Units on a week-dependent run (screen):** the unit control is enabled and calls `useUpdateProgramExerciseWeightUnit` with the run-copy row's id. Break: disable it on week-dependent runs, as the program tab does → the test fails.
- **An added or swapped-in exercise (screen):** REST on it → `useUpdateProgramExerciseRest` gets that exercise's own row id. Break: pass the run-copy row at its position → the test fails.
- **Linking across orders (screen):** linking two exercises that are neighbours in this week but not in the run's copy calls `useToggleSupersetLink` for those two rows; a later week where they aren't adjacent shows them as separate exercises.
- **G45's sets (absence, screen):** an added set's ⋯ offers no REST.
- **No offer:** no apply-ahead banner after a run-wide edit, even with later weeks planned (absence asserted).
- **Past week:** the controls are read-only.
- **The workout screen reads them:** `GymSession.restChain`, `.tempo`, `.superset` and `.warmupRoutine` already prove it reads these fields from the run's copy at session load, and pass unmodified. Chunk 30 changes only where the edit is made.
- **Width:** 375 px, Structure view with every marker set, no overflow.
**Would not catch:** nothing G45 adds: its sets have no own rest by design (c).
**Live app after it:** rest, tempo, grouping, the routine and units can be changed from the week as well as the program tab, on every exercise in the week; a week-dependent run's units can be changed for the first time. Every value and timer stays as it was.
**Done when:** live, with every design-field edit the program tab offers also working from Structure, on every exercise in the week; G45's sets show no set REST or STAGE REST.

### Chunk 31 — Differences from the week's source are highlighted
**Goal:** In both views, anything that differs from the week's source is highlighted: numbers, sets, exercises, order and set kinds. Tags never are, deload sessions show none, and run-wide fields aren't compared.
**SPEC:** Plan screen [P1.1] highlighting (with G22, G23, G24, G34, G36, G37 and G42's answers).
**Scope:**
- **A pure `weekDiff.ts`:** given a week, its sources and the matching rules, it returns flags per row and field.
- **Sources** (G22: as they are now):
  - week-dependent: `weekSources.ts`'s existing last-normal-non-empty search, for everything;
  - stable: the run's copy (G25) for sets, structure and reps (G37); last week for weights and RIR (G24);
  - week 1: the run's copy as it is now (see "Readings"), reps included (G37). Its weights and RIR aren't compared (G34);
  - a week that started empty: nothing, so nothing is highlighted (G42; how Plan knows: provisional 84).
- **Matching:** sets by position, i.e. head ordinal then stage index (chunk 20's set position), warmups included. Exercises by exercise identity (G36): a swapped-in exercise has no counterpart, so it shows as added and the one it replaced as removed. The same exercise twice in a workout: provisional 83.
- **Rendering**, with existing tokens only (Escalation 19 otherwise):
  - something added or changed: highlighted (`--accent`);
  - something removed: a dim struck-through line in its place (`--text-dim`, line-through);
  - a swap: the old exercise's struck-through line directly above the new one, highlighted (G36);
  - order: only the moved item. When two neighbours trade places, both are (G36); other ties per provisional 82.
- **Each view marks only its own fields:**
  - Sets: weight, reps and RIR, including stage and warmup numbers; working sets added or removed.
  - Structure: exercises added, removed or changed; their order; set kinds, including warmup sets and stages added or removed, and stage kind.
  - A ⋯ shows a dot when something inside it differs.
- **No flags:** deload sessions (SPEC's default), tags, and the run-wide fields.
- **Data:** Plan already loads every week of the run (`useAllWeekPlans`) and the run's exercises (`useProgramExercises`, `PlanPage.tsx` L801).
  - Comparing with the run's copy (stable weeks, and every run's week 1) also needs its sets and rep targets, which Plan doesn't load today.
  - It adds a `useProgramSets` read (`usePlanner.ts` L40, the hook `GymSession.tsx` L282 uses), skipping sets removed from the default once chunk 32's 040 is live.
  - Nothing is stored.
**Stops at:** nothing. Provisional decisions 82–84 apply.
**Depends on:** 29.
**Migration:** none.
**Verification:**
- **Pure:** `weekDiff` tests per field and rule, each with a break proof.
- **Sets view (screen):**
  - week 5 vs week 4 where set 2's weight differs → set 2's weight is highlighted and set 1's isn't;
  - a set removed in week 5 → a dim struck-through row in its place.
- **Structure view (screen):**
  - an added exercise is highlighted;
  - a changed stage kind puts a dot on that set's ⋯;
  - one exercise moved past two others → only it is highlighted; two neighbours that traded places → both;
  - a swap → the old exercise struck through, directly above the new one highlighted. Break: pair them by position as one changed row → the test fails.
- **Stable run (screen):** sets, structure and reps are compared with the run's copy, weight and RIR with last week. A rep target equal to last week's but not the default's is highlighted; the reverse isn't. Break: compare reps with last week → the test fails.
- **Week-dependent run (screen):** reps are compared with last week, like weight and RIR.
- **Week 1 (screen):** compared with the run's copy as it is now: an exercise the run's copy has and week 1 doesn't shows as a dim struck-through line, and a rep target that differs from the run's copy is highlighted. Break: compare week 1 with nothing → the test fails.
- **Started empty (screen):** with NEW WEEK STARTS set to empty, week 3 of a week-dependent run, filled by hand, shows no highlighting (provisional 84). Break: compare it with week 2 → the test fails.
- **Never highlighted (screen):** week 1's weights and RIR; any deload session; an added tag.
**Would not catch:** a week planned under the other NEW WEEK STARTS setting (provisional 84).
**Live app after it:** highlights appear on every planned week, past ones included, compared as they are now; no value changes.
**Done when:** live, with its screen tests passing.

### Chunk 32 — Stable: "Make this week the new default"
**Goal:** On a stable run, one confirmed action makes the week's sets, reps and structure the run's default (the run's copy), so every week planned after it starts from it.
- Weights and RIR keep coming from last week.
- The saved program never changes.
- If later weeks are planned, "Apply this change to planned weeks ahead" is offered, and it updates them only where they still match the old default.
**SPEC:** Weeks and copying [P1.1] "Stable programs: 'Make this week the new default'"; Plan screen [P1.1] actions.
**Scope:**
- **The action:**
  - page-level, above both views (G17);
  - shown only on a stable run, on the current and future weeks (G29; on a sequence run, the current cycle is the one with the next due workout, chunk 35), and not on a week that's all deload (G27);
  - a confirm step first, and no undo (G29).
- **Migration 040**, one file:
  1. **`alter table v2_program_sets add column removed_at timestamptz`** (null = part of the default), the same idea as `v2_program_exercises.removed_at`. A set the default drops is soft-removed, never deleted:
     - weeks already planned keep their `program_set_id` link, and with it their run-wide set rest and stage rest (a delete would null the link: 027's `on delete set null`);
     - deload snapshots still name a real row.
  2. **`create or replace function v2_plan_week`:** 039's body (chunk 34's), with the program branch skipping removed program sets. Nothing else changes.
  3. **`create function v2_make_week_default(p_mesocycle_id, p_week_number)`:** `security invoker` and atomic. It writes only the meso's run copy, never the saved program.
     - **Sessions it reads:** each workout of the week, skipping deload sessions, whose workouts keep their current default (G27). In a sequence cycle where a workout appears more than once, its first normal occurrence (G28, G41).
     - **Exercises:** the run copy's list becomes this week's.
       - Rows this week shows that were added or swapped in (`week_only`) join the default, keeping their ids (`week_only = false`).
       - Run-copy rows this week doesn't show are soft-removed (`removed_at`).
       - Positions become this week's.
       - It never changes `exercise_id` on a row: Coach reads past planned exercises through those rows.
     - **Sets:** each default exercise's program sets become this week's sets: count, kinds (warmup; staged with stages) and rep targets.
       - Where a week's set names a program set of the same exercise row, that program set is updated in place, so its own rest and stage rest stay.
       - Sets added in the week get new program sets with no rest.
       - Program sets the week no longer has are soft-removed.
       - The week's sets are then pointed (`program_set_id`) at the resulting program sets.
     - **Not written:** weights, RIR and tags (G24). Rest, tempo, grouping and the routine are run-wide and already in the copy.
     - **Returns:** the old default's content, for the apply-ahead offer.
- **Who reads removed sets:**
  - What defines the default skips them: `v2_plan_week` (above), chunk 31's comparison, and the program tab's list (`StepVolume`) until chunk 33.
  - The workout screen's rest lookup keeps them, because older weeks still point at them. `fetchProgramSets` (`plannerService.ts` L62, shared by `GymSession` and `StepVolume`) keeps returning them, and the program tab filters them out.
- **Apply ahead (G26).**
  - The client turns old default → new default into change records of the existing types: add, remove, swap and reorder exercise; add and remove set; rep target; stage kind; warmup.
  - Each is applied to a later planned week only where that week still holds the old default's part (per part; see "Readings"). That's stricter than chunk 20's value edits, which apply whatever the later value is.
  - Later weeks are pointed at the default's own rows and program sets, as the swap record's repoint already does (`repointWeekExercise`, `weekPlanService.ts` L1035), never a fresh week-only row per week. An added exercise's week row names the default's row and its sets name the default's program sets; an added set names its new program set. So later weeks get chunk 30's run-wide edits, and the next week's weight mapping finds them.
  - Deload weeks are skipped, as today.
- **Weights in the weeks that follow** come from last week by chunk 34's pairing, which this chunk doesn't change.
**Depends on:** 29, 34 (040 replaces 039's `v2_plan_week`) and 35 (the current cycle on sequence runs).
**Migration:** 040 adds a column, replaces `v2_plan_week` and adds `v2_make_week_default`.
- **Not destructive:** on deploy it changes no row (the new column is null everywhere). The reviewer merges it under D29 (P4).
- **Order:** 040 goes live before the code, which selects the new column.
- **Rollback:**
  - drop the function (the action disappears), then restore 039's `v2_plan_week`, which doesn't name the column;
  - drop the column only after that, and only while no row has `removed_at` set. Once a default has soft-removed a set, dropping the column would bring that set back into new weeks, so check first;
  - defaults already written stay (no undo, G29).
**Verification:**
- **The action (screen):**
  - it shows on a stable run's current week;
  - it's absent on a week-dependent run, on a past week and on an all-deload week (absence tests);
  - on a sequence run it's offered from chunk 35's current cycle, not the calendar week's;
  - tapping it shows the confirm step: cancel → no call; confirm → the RPC is called with (meso, week). Break: call without confirming → the test fails.
- **The function**, on scratch (replay 001–040, called as the fixture user):
  - afterwards the run's copy equals the week's sets, reps and structure for every normal session;
  - a deload session's workout keeps its old default;
  - a repeated workout takes its first normal occurrence, also when its first occurrence is deload (G41);
  - a swapped-in row joined and the replaced row is soft-removed;
  - a set's rest stayed where its program set was updated in place;
  - no `exercise_id` changed (md5 of (id, exercise_id) over every program exercise row);
  - the saved program's rows are byte-identical (md5).
- **Nothing visible changes in weeks already planned:** after the action drops a set from the default, a week planned earlier still has that set, linked, with its run-wide rest. Checked on scratch, then in `GymSession.restChain` with a fixture holding a soft-removed program set. Break: delete instead of soft-remove → the test fails.
- **Removed sets aren't the default (screen):** the program tab doesn't list a soft-removed set, while the workout screen still finds its rest. Break: drop the program tab's filter → the test fails.
- **Wired:** `v2_plan_week` for the next unplanned week then plans exactly the new default, without the removed sets, with weights and RIR from last week (scratch, called as the fixture user).
- **Apply ahead (screen + `applyAhead` tests):**
  - a later week that still matches the old default gets the change, pointed at the default's own row and program sets. Break: use `addWeekExercise` → a new week-only row → the test fails.
  - a later week whose set diverged keeps its own value. Break: apply regardless → the test fails.
- **After deploy:** `probe-live-columns.mjs` with `scripts/probe-specs/040.json` (the new column).
**Would not catch:** a week edited after it was made the default; the default is what was there when the action was confirmed.
**Live app after it:** a new action on stable runs; nothing changes until it's used.
**Done when:** live, 040 deployed, and a confirmed default is what the next planned week starts from.

### Chunk 33 — The program tab is removed
**Goal:** Plan has no program tab. What it did happens in the week (chunks 28, 30, 32) or is fixed for the run (G30), and the planner refuses to open a run's copy.
**SPEC:** Programs and runs [P1.1] (the program tab removed; fixed for the run; the planner refuses a run's copy; starting a run needs a schedule); Deload [P1.1] (the rules in effect shown); Plan screen [P1.1] "No program tab" and the no-schedule line; Programs page and Program planner [P1.1]; Navigation and settings [P1.1].
**Scope:**
- **The tab goes:** remove the WEEKS/PROGRAM bar (`PlanPage.tsx` L86–91, L480–510) and `ProgramTab.tsx` with its tests. Chunk 29's SETS / STRUCTURE switch stays.
- **Fixed for the run (G30):** no screen edits a running program's schedule (schedule type, weekdays, sequence order), its workouts, or its deload-rules override any more.
  - `StepExercises` / `StepVolume` are left serving only the planner (saved programs).
  - Their `onVolumeChange` props, which only `ProgramTab` passed, go.
- **The planner refuses a run's copy:** `PlannerPage` on a `kind = 'run'` program shows a short message and a way back to the Programs page, and renders no step. Today L171–172 render the steps with editing on.
- **Starting a run needs a schedule (G39):** every START is disabled while the program has no scheduled workout, with a line saying why (provisional 85):
  - the planner's (`PlannerPage.tsx` L109, L188);
  - the Programs page's sheet (`ProgramsPage.tsx` L101, L330), reached from a saved program's START (L292).
  - One shared check, the same one Plan's no-schedule line uses: a weekday with a workout (`weekday`), or a slot with a workout (`sequence`). Those are today's conditions (`PlanPage.tsx` L601, L622).
- **A run with no schedule (G39):** Plan's two states (`PlanPage.tsx` L601–633) become one line linking to the Programs page (provisional 86). Their links to the tab go.
- **The deload rules in effect (G43):** shown read-only next to the deload action (provisional 87). They're resolved as marking already resolves them (`resolveEffectiveDeloadRules`, `PlanPage.tsx` L184–185): the run's override, else your Settings default as it is now. The tab, which showed them (`StepVolume.tsx` L105, L143), goes.
**Depends on:** 28, 30, 32.
**Migration:** none.
**Verification:**
- **Gone (screen):**
  - no PROGRAM tab (absence asserted);
  - `/program/<run copy id>` shows the refusal and no editor. Break: render the planner → the test fails.
- **Start needs a schedule (screen):** the planner and the Programs sheet, with a program that has no scheduled workout → START is disabled, the reason line shows, and `useStartRun`'s mutate is never called. With one scheduled workout → enabled and called. Break: drop the check from the Programs sheet → the test fails.
- **No-schedule line (screen):** a run with no schedule shows the line, and its link opens the Programs page; "Set up weekly schedule" is absent.
- **Deload rules (screen):** a run with its own rules shows them as this run's. A run on the default shows the Settings rules, and follows a change to the settings store. No rules → no line (absence). Break: read only the run's override → the default case fails.
- **Nothing lost:** a capability checklist taken from the tab's code (`ProgramTab.tsx` → `StepExercises` / `StepVolume`), as chunk 26 did:
  - rest, tempo, grouping, the routine and units → Structure (chunk 30's tests);
  - stable volume → "Make this week the new default" (32);
  - priorities → view-only (28);
  - schedule, workouts and the deload override → fixed for the run (the refusal test, plus the absence of their editors anywhere in Plan); the rules in effect → shown read-only next to the deload action;
  - planning type → already fixed.
- **The planner's own tests** pass unmodified.
**Would not catch:** a capability nobody listed. The checklist starts from the tab's code, not from SPEC, to keep that small.
**Live app after it:** no program tab. Everything it did is in the week, or fixed for the run as G30 says.
**Done when:** live, and every checklist item accounted for.

### Chunk 34 — Stable weeks take last week's weights warmup to warmup, working set to working set
**Goal:** A new stable week gets each set's weight and RIR from the same kind of set at the same position in last week: warmups from warmups, working sets from working sets. A warmup added or removed last week no longer shifts every weight by one set.
**SPEC:** Weeks and copying [P1.1] "In a stable week they're matched to last week's sets: warmups to warmups and working sets to working sets, by position within each exercise" (G44).
**Scope:**
- **Migration 039: `create or replace function v2_plan_week`**, 038's body with only the stable weight/RIR mapping changed (037 L387–425, carried unchanged into 038):
  - heads are numbered within (exercise row, warmup or working): by position on the new week's side, by set number on last week's side, and matched on all three;
  - a stage takes its weight and RIR from the matched head's stage with the same stage index, as today;
  - same grant and `notify pgrst`.
- **Unchanged:** week-dependent weeks, which copy last week's sets whole, weights included; and a slot that wasn't in last week gets no weights (see "Readings").
- **No client code changes.** `v2_plan_week` is the only path that maps a stable week's weights; `createWeekPlan` (`weekPlanService.ts` L293) writes exercises only.
**Depends on:** 27 (038 is the body it starts from).
**Migration:** 039 replaces one function.
- **Not destructive:** no row changes on deploy; weeks already planned keep their weights. D29 covers it (P4).
- **Rollback:** `create or replace` with 038's body verbatim.
**Verification** (scratch: replay 001–039, `v2_plan_week` called as the fixture user):
- **The case that's wrong today:** last week has a warmup added at 60 kg above working sets at 100, 105 and 110; the default has no warmup → the new week's working sets get 100, 105 and 110. Break: 038's body → they get 60, 100 and 105 → the check fails.
- **The reverse:** the default has a warmup and last week's was deleted → the new warmup gets no weight, and the working sets get last week's three.
- **Stages:** a staged head's stages take last week's stage weights by stage index.
- **RIR** follows the same pairing as weight.
- **Wired:** Plan and Today call `planWeek` → `v2_plan_week` (`weekPlanService.ts` L564), chunk 8's wiring, unchanged. The scratch run proves the values.
- **After deploy:** the deploy run (same signature as 038) and `check-embeds` live.
**Would not catch:** weeks planned before it, which keep their weights.
**Live app after it:** stable weeks planned from now on take weights by set kind and position. Weeks already planned don't change.
**Done when:** live, and the scratch proof shows both warmup cases paired correctly.

### Chunk 35 — A sequence run's current cycle is the one with its next due workout
**Goal:** On a sequence run, Plan's current week is the cycle containing the next due workout (the one Today shows next), not the calendar week. Cycles before it are past and read-only; it and later ones can be edited.
**SPEC:** Scheduling → Sequence [P1.1] "The current cycle" (G40); Weeks and copying [P1.1] (make default: current and future weeks).
**Scope:**
- **One rule for Plan and Today.** Move the step that finds the last done or skipped workout's slot (`useSequenceScheduler.ts` L72–83) into a pure helper that both call. Plan's current cycle is then `resolveNextSlot(items, lastEvent).next.weekNumber` (`sequenceSchedule.ts` L86), whether that workout is due yet or not.
- **`PlanPage.tsx`, sequence runs only:** `currentWeek` (L122) comes from it instead of `computeWeekNumber` (L93–95), and so does the opening view (L152–154). The current-cycle marker (L464) and `isPast` (L156) follow. Weekday runs keep the calendar week.
- **New read in Plan:** `useLastDoneOrSkippedSession` (`useSession.ts` L52), Today's own hook. Plan already loads the sequence and every week plan.
- **A sequence with no workout** (`resolveNextSlot` finds none): the current cycle stays 1, and chunk 33's no-schedule line shows.
**Depends on:** nothing. It goes before 32, whose action is offered from the current cycle on.
**Migration:** none.
**Verification:**
- **Today unchanged:** `useSequenceScheduler.test.tsx`, `SequenceTodayPage.test.tsx` and `GymSession.sequenceSchedule.test.tsx` pass unmodified after the helper moves.
- **Screen (`PlanPage`, sequence run):**
  - a 9-day cycle still in progress in its second calendar week: cycle 1 opens as current and can be edited (no "PAST WEEK — READ ONLY"). Break: keep the calendar week → the banner shows → the test fails.
  - a 3-day cycle, still in the run's first calendar week: once cycle 2's last workout is done, cycle 3 opens as current, and cycles 1–2 are read-only.
- **Weekday runs:** the existing Plan tests pass unmodified.
**Would not catch:** a workout logged on another device, until Plan refetches (staleTime 5 min, as on Today).
**Live app after it:** on a sequence run, Plan's current and read-only cycles follow the sequence, as Today does. Weekday runs are unchanged.
**Done when:** live, and Plan and Today agree on the current cycle.

---

## Existing data

SPEC's "Existing data" lines, each mapped to its chunk.
1. **Stored "only this week" values are ignored; copying uses each week's actual content.**
   - Chunk 27: the code (copy, apply ahead, deload matching) and 038 (`v2_plan_week`).
   - No data changes; the carry columns keep their values, unread.
   - Rollback: 037's function body.
2. **Rest, tempo, the warmup routine and superset grouping stay run-wide, so nothing is moved.** The data move that per-week storage would need is kept in the appendix (L4).
3. **The active run's priorities stay as they are and become read-only (chunk 28); completed runs' priorities pages are unchanged (G31).** No data changes.
4. **Weeks already planned keep their weights.** Chunk 34 changes only how stable weeks planned after it pair them.
5. **A run started without a schedule keeps running.** Plan shows it the no-schedule line (chunk 33); only new starts need a schedule.

---

## Live app safety

What each chunk changes for Adam the day it merges, and why no existing week changes before the chunk that replaces it.

| Chunk | What changes | What stays the same |
|---|---|---|
| 27 | The tick is gone; the next week planned copies the current week as it is | Every existing week, which keeps the content it was planned with |
| 28 | Run priorities can't be edited in Plan | The marks shown; completed runs' pages |
| 29 | Plan's week shows in two views; COMPACT is gone | Every value and every other action, moved but not changed |
| 30 | Rest, tempo, grouping, the routine and units can be changed from the week too; a week-dependent run's units for the first time | Every value and timer (same rows, same mutations) |
| 31 | Highlights appear | Values |
| 32 | A new action on stable runs; 040's new column, null everywhere | Weeks, until someone uses it. After that, weeks already planned keep their sets and their rest: a set the default drops is soft-removed, not deleted |
| 33 | The program tab is gone; the planner refuses a run's copy; START needs a schedule; the deload rules show next to the deload action | Every capability, except what G30 fixed for the run; runs already started |
| 34 | Stable weeks planned from now on take weights by set kind and position | Every week already planned |
| 35 | On a sequence run, Plan's current and read-only cycles follow the sequence, as Today does | Weekday runs; every value |

Every chunk merges to master on its own, with no stacking. Chunk 32's 040 goes live before its code; chunk 27's code goes before its 038 (P3); 038, 039 and 040 merge in that order (P5).

---

## Consequences for Coach

1.1 changes no Coach code. Coach reads planned exercises through `v2_week_plan_sets → v2_program_exercises(exercise_id)` (`api/coach/ask.ts`, `weekBuckets.ts`) and logged rest from `v2_set_logs.rest_seconds` (`analysisInput.ts`). It reads none of the fields this revision edits differently, nor the carry columns or `v2_program_priorities`.
- **Chunk 32** rewrites the run's program exercise rows. It never changes `exercise_id` on one (its scope), so past planned exercises read the same for Coach. Flipping `week_only` and setting `removed_at` (on exercises or sets) don't change what planned sets point at.
- **Chunk 34** changes the weights written into new stable weeks. Coach reads no planned weights.
- **G31:** `MesoPrioritiesPage` stays as it is, in `src/features/coach/`.

---

## Found in passing (not part of 1.1)

- **A deload restore can fail partway.** The program tab deletes program sets (`plannerService.ts` L176, L223), and a deload snapshot can name one of them.
  - Restoring it deletes the session's sets first, then fails on the foreign key when it inserts that set (`weekPlanService.ts` L1575–1576). The session keeps only the sets restored before it, and the snapshot stays, so a retry fails the same way.
  - 1.1 adds no path to it (chunk 32 soft-removes; chunk 33 removes the tab), but snapshots taken before chunk 33 can still hit it.
  - Not planned here. A small fix: restore with `program_set_id` null when the named set no longer exists.

---

## At every chunk boundary

TASKS.md's "At every chunk boundary" list holds unchanged, plus:
- **Test what must be absent.** For each removed or "only X" rule (no tick, no COMPACT, no apply-ahead offer after a run-wide edit, no "EVERY WEEK" on the unit, no set REST on G45's sets (answered (c)), no highlighting on a week that started empty, no action on week-dependent, past or all-deload weeks, no program tab, no planner on a run's copy, no START without a schedule), assert the absence (Checks that lied #32).
- **No chunk here changes the workout screen or the rest timer.** If one turns out to, D30's proof applies.

---

## Appendix — Later: per-week structure

**Deferred by Adam, 2026-10-10.** Rest, tempo, the warmup routine and superset grouping stay run-wide in this revision. This is the first draft's plan for making them per week, kept as written (`efb7789`) so a later revision can start from it.

**Reading it:**
- Its chunk numbers are the first draft's: L1–L5 below were chunks 30–34. Its "chunk 35", "36" and "37" are today's 31, 32 and 33, and its "chunk 29" is today's 29.
- Its migration numbers (039, 040) are the first draft's; a later revision takes the next free numbers.
- G21 was answered "run-wide" for this revision; L5 is the per-week version of that question.
- Before using it, re-check it against SPEC as it stands then and against the code.
  - Rule 7's per-week text is no longer in SPEC; SPEC's Later list holds the item.
  - Chunks 27–33 will have changed the Plan screen it describes. For example, chunk 30 puts the run-wide editors in Structure.

### Gaps that fell away with it (as written)

#### G18 — Sessions and previews no week row resolves to
- **SPEC:** rest, tempo and the warmup routine are per week in a run (Rest, Tempo, Warmup routine [P1.1]).
- **When it happens.** A session started before its week was planned has no `week_plan_id` (an offline start; TASKS.md chunk 8: "that session starts without a plan, as today"). Whether a row still resolves depends on the screen:
  - Weekday Today gives an active session the current week's row for its workout even with no `week_plan_id` (`TodayPage.tsx` L88–91). Only a week with no row for that workout leaves it with none.
  - `SequenceTodayPage` matches by `week_plan_id` only (L53), so a sequence session without one gets no row.
  - Today's preview of a workout with no plan (`suggest_no_plan`) gets none (`TodayPage.tsx` L145–146; `SessionPreview` shows tempo through `PreviewExerciseCard` → `ExerciseHeader`).
- **Today:** with no row, these show the run's copy, which is also what every planned session shows.
- **Unsaid:** what they show after this:
  - the run's copy, which for a week-dependent run holds week 1's values rather than this week's;
  - their week's values once the week gets planned;
  - or nothing.
- **Stops:** chunk 31 (the read path's no-row case).

#### G19 — A week swap and the slot's rest and tempo
- **SPEC:** rule 1 puts swap and rest in the same Structure view. Nothing says what a swap does to that slot's per-week values.
- **Today:**
  - a week swap points the slot at a new week-only exercise row (`createWeekOnlyProgramExercise`) that has no rest, rest after or tempo;
  - its sets show no rest override. The moved sets' `program_set_id` still names the original slot's program sets, and the workout screen neither loads those (`GymSession.tsx` L282 fetches by the session's own exercise rows) nor looks outside the card's own (L575, L619, L645);
  - the swapped-in exercise keeps the slot's superset block.
- **After the move, by default the opposite happens.** `swapWeekExercise` updates the week row and its sets in place (`weekPlanService.ts` L998–1019; `repointWeekExercise` L1040–1052), so per-week values on them would stay. Keeping today's behaviour would take code that clears them.
- **Unsaid:** does a swapped-in exercise keep that week's rest, rest after, tempo and its sets' own rest? Or does it start without them, as today?
- **Not affected:** the mid-workout swap (rule 9: unchanged).
- **Stops:** chunk 31 (`swapWeekExercise`, `repointWeekExercise`).

#### G20 — Weeks that start empty
- **SPEC (Weeks and copying, L210–212; Settings, L622):** the setting "NEW WEEK STARTS: copy / empty" stays. Rule 2 doesn't mention it, and rule 9 keeps "the copy-source rules".
- **With "empty":** a new week-dependent week gets no exercises or sets, so it has no rest or tempo to carry.
- **Unsaid:**
  - Does an empty week also start with no warmup routine, or with one from somewhere (its source, or the program)?
  - What is it highlighted against? Its source is still the last normal occurrence, so everything would read as removed (G23).
- **Stops:** chunk 33 (an empty week's routine) and chunk 35 (its highlighting).

#### G23 — How differences without a row of their own show
- **SPEC:** rule 3 highlights "sets, exercises, order, … warmup routine items".
- **Unsaid:**
  - **(a) Removals.** How is something the source has and this week doesn't shown? A removed exercise, set, stage or routine item has no row to highlight.
  - **(b) Order.** Which rows count as moved when one moves? An insert shifts every row after it.
  - **(c) "In both views".** Does each view mark only differences in what it shows, or also ones that live in the other view? When a differing value sits behind ⋯ (the standing UI rule), is the ⋯ marked?
  - **(d) Which source row a row is compared with.** Matching exercises by their row (`program_exercise_id`, as copying and apply-ahead do) would show a week swap as one exercise removed and another added, because a swap makes a new row (G19). Matching sets by position would show every set after an added warmup set as changed.
- **Stops:** chunk 35.
- **In this revision:** its non-per-week parts were answered ("Answered gaps"); it's kept here for the per-week parts.

#### G32 — Stable runs between the data move and "Make this week the new default"
- **SPEC:** Programs and runs [P1.1] (L152–156): design fields are edited in the week's Structure view, and stable volume changes through "Make this week the new default" (L231–238).
- **The problem:** once chunk 33 moves rest, tempo and the routine into the weeks, the program tab no longer reaches planned weeks. Chunk 36, the stable route for a permanent change, waits on G24–G29. Something has to hold for stable runs in between, or stable runs have to wait.
- **Options I see (not choosing):**
  - (a) the program tab keeps editing the run's copy for stable runs, offering "Apply this change to planned weeks ahead" for planned weeks (SPEC's route before [P1.1]), until chunk 36;
  - (b) the program tab hides them for stable runs too: per-week changes only, with no permanent route until chunk 36;
  - (c) chunk 33 moves only week-dependent runs, and stable runs keep today's run-wide values until chunk 36 ships.
- **Live relevance:** F1 (is any active run stable?).
- **Stops:** chunk 32 (the program tab on a stable run) and chunk 33 (whether stable runs move now).

#### G33 — Applying a routine edit ahead: which item is "the same"?
- **SPEC:** "Apply this change to planned weeks ahead … Applies only the change just made; leaves everything else in those weeks alone" (L228–230).
- **Today (chunk 20):** a set's value edit is applied to the matching set (same slot, same exercise, same set position) whatever that set's current value. A routine item has no slot or exercise, only a position and its text.
- **Unsaid:** when an item is edited, added, removed or moved, how is a later week's "same item" found?
  - (a) by position;
  - (b) by its text;
  - (c) only when the later week's whole routine equals this week's before the edit.
- **Stops:** chunk 32 (the routine's apply-ahead).

### Facts to check in the live data (first draft)

All are read-only, Adam-scoped, and run by Adam (this container can't sign in). Results from the main account say nothing about the second account (Checks that lied #26), so run them on both. Each answer becomes an expected number or a fixture.

| # | Fact | Used by |
|---|---|---|
| F1 | Active run(s) per account, and each run copy's `planning_type` and `schedule_type` | G32's live relevance, 33's fixtures |
| F2 | `v2_user_settings.week_start` (copy or empty) | G20's live relevance |
| F3 | What the data move touches: planned rows of active runs; their week exercises and sets; non-null rest, rest after, tempo, set rest and stage rest on the run copies; warmup items per workout | 33's expected counts |
| F4 | Planned sets whose `program_set_id` names a program set of a different program exercise (the swap case, which the move leaves null) | 33's parity |
| F5 | Week exercise rows in active runs with a non-null `carry_program_exercise_id` or `carry_position` | 27 (what stops being honoured) |
| F6 | Sessions of the active run with no `week_plan_id` | G18's live relevance |

### Device update before the data move (first draft's P2)

- **P2 — Device update before the data move.** Before 040 merges (chunk 33's preconditions):
  - every device takes chunk 32's update banner, including the second account's devices;
  - no session is in progress (warmup ticks).
  - After 040 deploys, reload the app on each device. A to-do for Adam at that boundary.

### Per-week data model (first draft)

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

### Existing data — the data move (first draft)

- **Today's run-wide rest, tempo and warmup routine are written into every week already planned in each active run, and become the run's default.** This is the data move.
   - **Rows:** every `v2_week_plans` row of each active run, all users, not yet per-week.
   - **Values:**
     - exercise rest, rest after and tempo from the run-copy row the week row points at;
     - set rest (and a head's stage rest) from the program set its `program_set_id` names, only within its own slot, else null (the workout screen's rule today; F4 counts the null cases);
     - warmup items copied from the workout;
     - then the session's switch set.
   - **Where it runs:** migration 040, chunk 33, after chunks 30–32 are live and on every device, with no session in progress (P2).
   - **Stable runs:** whether they move in 040 or wait for chunk 36 is G32.
   - **Proven by:** the parity query (0 differences, scratch then live) and Adam's before/after counts.
   - **Rollback:** switch the sessions back (one `update`), and the run copy is read again exactly as before.
   - **"Become the run's default":** nothing to write; the run copy holds them already (G25).
   - **Not moved:** completed runs (SPEC says active runs; nothing displays their values).
   - **Superset rest (and grouping, G21):** chunk 34's own move, the same way.

### Chunks (first draft's 30–34)

#### L1 (first draft's chunk 30) — Schema: rest, tempo and the warmup routine per week (additive)
**Goal:** Add the columns and table chunks 31–33 need, changing nothing the app does.
**Scope:** migration 039, per "Data model (1.1)":
- **`v2_week_plans`:** `structure_per_week boolean not null default false`.
- **`v2_week_plan_exercises`:** `rest_seconds integer check (rest_seconds >= 0)`, `rest_after_seconds integer check (rest_after_seconds >= 0)`, `tempo text check (char_length(tempo) <= 20)`.
- **`v2_week_plan_sets`:** `rest_seconds integer check (rest_seconds >= 0)` and `stage_rest_seconds integer check (stage_rest_seconds >= 0)`, plus `check (parent_week_plan_set_id is null or stage_rest_seconds is null)`.
- **New table `v2_week_plan_warmup_items`:** RLS, policy, unique `(week_plan_id, position)`.
- **`notify pgrst`.**
- **Also:** `scripts/live-counts.sql` gains the new table, so 040's before/after counts include it.
- **Not included:** no superset storage (G21); no `src/` change.
**Depends on:** 27's 038 merged first (migration numbering; see Order).
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

#### L2 (first draft's chunk 31) — The week's rest, tempo and routine: read path, copies, deload (inert until chunk 33)
**Goal:** Wherever a session is marked `structure_per_week`, every reader and every write path uses that session's own rest, tempo and routine. Wherever it isn't, they behave exactly as today. No row is marked until chunk 33, so nothing visible changes.
**SPEC:** Rest, Tempo, Warmup routine [P1.1] ("per week … copied by the source rule"); Weeks and copying [P1.1] source rule (for these fields).
**Scope:**
- **Read path** (the read rule above):
  - `weekPlanService.ts`: `toProgramExerciseFromWeekPlanExercise` (L207) takes rest, rest after and tempo from the week row on a per-week plan; `toSet` (L164) carries `restSeconds` and `stageRestSeconds`; the week-plan selects add the new columns and `structure_per_week` (`WeekPlan.structurePerWeek`).
  - Workout screen: `useExerciseCardState.ts` `setOverrideFor` (L257–262) and `setOverrideForStageRest` (L304–306) read the planned set's own values on a per-week plan, else today's `programSetById` lookup. Exercise rest, rest after and tempo already flow through `pe` (`GymSession.tsx` L197–198 → `ExerciseHeader` L51–56) and change with the mapper.
  - Warmup routine: `WarmupRoutineChecklist` (L41) reads `weekWarmupRoutineService` items on a per-week plan, else the workout's items.
  - Today's preview: `SessionPreview` (L32–33) → `PreviewExerciseCard` (L47) → `ExerciseHeader` shows tempo from the same mapped exercises, so it follows the mapper.
  - Offline: `primeOfflineCache` stores a fixed field list (`offlineCache.ts` L67–77), which gains `structurePerWeek`. The cached exercises carry their resolved rest, rest after and tempo, because the mapper resolves them. GymSession's offline fallback reads only those exercises (L255–257). Week warmup items are an online read, like the workout's today.
  - Sessions and previews no week row resolves to: **stop at G18.**
- **Write paths carry the values** (only on per-week rows):
  - COPY WEEK / COPY THIS WORKOUT (`copyOnePlanForward`, L718). COPY fills a row `v2_plan_week` already made (L728–747), so the destination usually exists.
    - Write what the source shows: its own values and items when it's per-week, else (a straggler) the run-copy values by the read rule.
    - The destination is per-week exactly when it already is or its source is. Before chunk 33 neither is, so nothing is written and the copy reads the run copy, just as its source does.
    - The destination's items are replaced (delete, then insert) before exercises and sets are copied. The copy isn't atomic (L767, L773), so a failure leaves a week with no exercises, which "Copy last week" retries.
  - `createWeekPlan` (L293; `useAddSet` / `useAddWarmupSet` call it when a workout has no row yet, `useWeekPlan.ts` L244–247, L275–278) is replaced by planning the week (`planWeekThenFindId`, which `MissedSessionPrompt` already uses). Then one path creates rows and marks them consistently.
    - This path runs only when Plan's own plan-on-view call hasn't landed.
    - Behaviour change, stated: it now plans the week from its source, which is what SPEC's "planned the first time it's opened" asks. The direct insert made one row with the run copy's exercises and no sets.
  - `reassign_exercise_history` (021, server-side; the Library's reassignment) repoints planned sets and deletes the old program exercise, whose program sets cascade. Today the moved sets lose their override. Once values sit on the sets they stay with them, which follows from rule 7. Reassignment has never run on real data (CONTEXT).
  - `addWeekExercise` (L1062), `addSet` (L387), `addStage` (L462), `addWarmupSet` (L414): null values. Today an added exercise or set has no rest or tempo.
  - `swapWeekExercise` (L981) / `repointWeekExercise` (L1035): **stop at G19.**
  - `reorderWeekExercises` (L1116): values stay on their rows.
- **Deload:**
  - Each calculated set gets the base set's rest and stage rest as the base shows them: its own values when the base row is per-week, else by the read rule. On a per-week marked row they're written into the columns, never left to resolve through `program_set_id`.
  - The fields travel the whole chain:
    - `toSourceSet` (`weekPlanService.ts` L1327);
    - `DeloadSourceSet` / `DeloadCalculatedSet` (`deloadRules.ts` L310, L335);
    - `insertCalculatedPlanSets` (L1389);
    - `DeloadSnapshotSourceRow` (L551) and the snapshot mapping (`weekPlanService.ts` L1462–1478).
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
- **Preview:** in `SessionPreview` (Today), the header shows the week's tempo on a marked plan and the run copy's on an unmarked one; the no-plan case per G18.
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
- **Offline:** in `GymSession.offline`, a per-week session rendered offline from the Dexie-cached exercises shows the week's tempo and times the exercise's last set with the week's rest after. Break: cache unresolved exercises → the test fails.
- **Boundary checks:** `verify-rls-tables.test.mjs` passes with the new table in `TABLES`; `check-program-exercise-reads.mjs` exits 0; `check-frozen-code.mjs`; typecheck, test, build.
**Would not catch:** real data; nothing here runs live until 33 marks rows. Superset rest (34).
**Live app after it:** unchanged; no session is per-week yet.
**Done when:** merged and deployed; every test above passes, with its break proof recorded.

#### L3 (first draft's chunk 32) — The week's rest, tempo and routine: Structure editors, apply ahead, the program tab (inert until chunk 33)
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
  - A later week whose row isn't per-week is skipped for these record types, because nothing reads its values yet.
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
**Would not catch:**
- Real data, as in 31.
- `PlannerPage` opened on a run copy by URL (nothing links to it) still edits the run copy's rest, tempo and routine. After chunk 33 that reaches only weeks planned from the run copy (G30, chunk 37).
**Live app after it:** unchanged.
**Done when:** merged, deployed, and on every device (P2: each device takes the update banner before chunk 33 merges).

#### L4 (first draft's chunk 33) — The data move: every planned week gets its own rest, tempo and routine
**Goal:** Every week already planned in each active run gets today's run-wide rest, tempo and warmup routine as its own. Every week planned from now on copies them from its source. Nothing visible changes on the day it ships.
**SPEC:** Programs and runs [P1.1] Existing data ("written into every week already planned in each active run … They also become the run's default"); Weeks and copying [P1.1] source rule; Rest, Tempo, Warmup routine [P1.1].
**Scope:** migration 040, one transaction, in this order:
1. **The move.** For every `v2_week_plans` row whose meso is `active` and whose `structure_per_week` is false, for every user (migrations run outside RLS; that's Adam's two accounts):
   - each `v2_week_plan_exercises` row gets `rest_seconds`, `rest_after_seconds` and `tempo` from the `v2_program_exercises` row its `program_exercise_id` names. For a week-only slot that's the slot's own row, null today.
   - each `v2_week_plan_sets` row gets `rest_seconds`, and a head also gets `stage_rest_seconds`, from the program set its `program_set_id` names, **only where that program set belongs to the same program exercise as the planned set** (`ps.program_exercise_id = wps.program_exercise_id`), else null. The screen reads stage rest through heads only (`useExerciseCardState.ts` L278, L299), and 039's check forbids it on stage rows. That's exactly what the workout screen resolves today: it searches only its own card's program sets (`GymSession.tsx` L575, L619, L645 → `useExerciseCardState.ts` L257–262, L304–306), so a swapped set shows no override.
   - warmup items: a copy of the row's workout's `v2_workout_warmup_items`, same positions and text.
   - `structure_per_week` set to true.
2. **`v2_plan_week`** (`create or replace`, from 038's body):
   - A new row is per-week and copies rest, tempo and the routine from its source:
     - program source (week 1, stable) → the run copy, by the rules of step 1;
     - week source (week-dependent) → the source row's own values and items; if the source row isn't per-week, step 1's rules, which is what that source shows;
     - empty start → **stop at G20** (the routine).
   - Weights and RIR stay as today (G24 belongs to chunk 36).
   - Rows of the requested week that still aren't per-week, because an old bundle wrote them, get step 1 on the call. It's idempotent, and its item insert skips conflicts (`on conflict do nothing`), so it can never make planning fail.
3. **Grant and notify.**
- **"They also become the run's default":** nothing to write. The run's copy already holds them, and it's the stable source today (G25 asks whether it's also "the default").
- **Superset rest and grouping:** chunk 34 (G21).
**Stops at:** G20 (an empty-started week's routine) and G32 (whether stable runs move now).
**Depends on:** 32 on every device (P2); 038 (the function body it starts from). Through 29 and 32, the data move also waits on G16 and G17, though both are layout questions.
**Preconditions:**
- Every device on chunk 32's bundle. An older bundle still edits the run copy's rest in the program tab, and marked rows no longer read that.
- No session in progress when 040 merges. Warmup ticks are kept per session and keyed by item id (`WarmupRoutineChecklist.tsx` L69), and the moved items get new ids, so an open session would lose its ticks.
- After it deploys, reload the app on each device. The query cache keeps data 5 minutes and doesn't refetch on focus (`queryClient.ts`), so an open Plan would keep showing the old state until then.
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
- **Callers:** every `v2_plan_week` caller is unchanged:
  - `PlanPage`'s plan-on-view effect (L221–227);
  - `useSetWeekDeload` (`useWeekPlan.ts` L206);
  - `planWeekThenFindId`, used by `MissedSessionPrompt` and by Today's and `SequenceTodayPage`'s start (and, from chunk 31, by ADD SET's no-row case).
- **Screen:** 31's and 32's screen tests re-run, unmodified, on marked fixtures.
- **Live after deploy:**
  - Adam's counts: `v2_week_plan_warmup_items` goes 0 → F3's expected number, and every other table is unchanged.
  - Parity: 0.
  - `probe-live-columns.mjs` with `040.json`.
  - At his next session: the rest timer targets, tempo and warmup checklist are what they were.
**Would not catch:**
- A device still on a pre-32 bundle (hence P2).
- Ticks lost in a session open during the merge. Parity compares items' text and position, not tick state, so the precondition covers it.
- A mismatch between the parity query's rule and the screen's. Both implement the read rule; chunk 31's screen tests on marked fixtures are what tie the screen to the columns.
- Completed runs: not moved, and nothing shows their rest, tempo or routine.
- Sessions with no week plan (G18).
**Live app after it:** it looks the same. From now on rest, tempo and the routine are changed per week in the Structure view and carried forward by copying.
**Done when:** 040 is live, the counts and parity are as expected, and a week planned after it carries its source's values.

#### L5 (first draft's chunk 34) — Superset grouping and superset rest per week — stops at G21
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
