# Overload — Decisions

## Waiting on Adam
*Rewritten at every boundary. Last: 2026-10-26, chunk 68's review (merged, #212).*
- *Chunk 68 (the stepped planner's steps 1–2, confirms and states) is merged; light under the 1.2 cost rule, so its staging steps are the release checklist's (RC18). One new entry, which doesn't block: 224 (its display choices, accepted as built). Tests owed: two (below).*

What blocks, in order:
1. **121** (a to-do, below): the release's migrations PR waits for it.
Nothing else blocks a chunk or the release.

Decisions that block a chunk: none.

Decisions (none blocks; for Adam's review pass after the release checklist):
- **224** — chunk 68's display choices (D31), (a)–(k): the first workout open and one card at a time (a), one exercise open with the arrows on the open member (b), a held day dimmed but tappable (c), START off until the runs are read (d), a failed add's line over the screen (e), subgroup names in sentence case (f), warmup items unnumbered (h); the boards' "Check your connection" lines follow SPEC Errors (15). Recommended: accept all, as built. Blocks: nothing.
- **223** — chunk 67's display choices (D31), (a)–(l): one workout open at a time (a), exercises start closed (b), "NO EXERCISES YET" (d), a row numbered by its rank with a warmup counted (e), ALL's eyebrow "SET 01" (f), the 132 px REST AFTER column (g), the staged chip in the accent on `--accent-muted` (k), taps on the type picker ignored while a change is read back (l). Recommended: accept all, as built. Blocks: nothing.
- **222** — on a card that starts with an open warmup, the warmup row keeps 58a's accent W and filled LOG while working set 01 has the current set's accent frame (G54), so two rows read as primary; board W2b draws the warmup in the frame. Recommended: (b), draw an open warmup like any other open row (one condition in `SetRowWarmup.tsx`). Blocks: nothing (display).
- **221** — chunk 60's display choices (D31), (a)–(i): "SET 04" naming outside a superset, the other open rows as W1 draws them (outlined LOG, compact CUE), the question asked after the row checks its numbers, START SET on the current row only, CANCEL keeping the typed numbers, every open row's ⋮ with SKIP THIS SET before 61 (SPEC C9), a drop out of order asking with 46r's words. Recommended: accept all, as built. Blocks: nothing.
- **220** — chunk 59's display choices (D31), (a)–(k): the skip line's words beyond W10's one case (a superset member's sets named 01, 02, 03 beside rows A1–A3), SKIP N SETS counting drops, the swap line's plural and empty case, the skip row's inline confirm, the card's SWAPPED FROM and ADDED TODAY on its muscle line, the pickers' words and exclusions, the real reason under "Couldn't swap.". Recommended: accept all, as built. Blocks: nothing.
- **218** — board W1's row caption with the earlier-this-week numbers ("MON 17.5 × 15 @ 1" beside LAST) is in neither 58a's nor 58b's scope and isn't built; SPEC's "those too (W16, W17)" is met by the sheet and the card line's "· ALSO MON". Recommended: (a), add it (one span in the row's LAST line from the sessions the line already reads). Blocks: nothing (display).
- **217** — chunk 58b's display choices (D31), (a)–(m), including N OF M SETS counted over the rows the screen draws (a), the weekday of a moved session's new day (b), the failed row keeping its pen (e) and the history icon opening the sheet, with FULL HISTORY one tap further (h). Recommended: accept all, as built. Blocks: nothing.
- **216** — answered on 2026-10-22: for your review pass. Chunk 58a's display choices (D31), (a)–(l). Recommended: accept all, as built.
- **215** — answered on 2026-10-22: for your review pass. The Library's EDIT TAGS and UNTAGGED name muscle tags; chunk 69's wording test allowlists them. Recommended: (a), keep them.
- **212** — answered on 2026-10-21: keep as built. A workout whose session this week is already done gets no REVIEW items. On your review-pass list.
- **211** — chunk 56's display choices and readings on REVIEW (D31), (a)–(m), including ADD EXERCISE on a stable run (h), each press reading the item's decision again first (k) and two sets added in one place sharing one item (m). Recommended: accept all, as built. Blocks: nothing.
- **210** — answered on 2026-10-21: keep as built. VOLUME's "—" is drawn only for a week with no planned set and no session. On your review-pass list.
- **209** — chunk 55's display choices and readings on the VOLUME sheet (D31), (a)–(k), including this week read from the open week's own query (i) and a read paused offline shown as failed (d). Recommended: accept all, as built. Blocks: nothing.
- **208** — answered on 2026-10-21: keep as built. A MARK leaves a session that an UNMARK cut off part way as it is (it keeps its saved copy and its flag). On your review-pass list.
- **207** — answered (b) on 2026-10-21: a stable run's past week and its finished sessions show no change marks and no legend; week-dependent ones keep theirs. A display choice, built in your review pass (one condition in `WeekView.tsx`), not now.
- **206** — chunk 54b's display choices and readings on Plan's week view (D31), (a)–(m), including no mark on a session in progress (a) and board 9's "DELOAD SESSION · NO CHANGE MARKS" read as the frame's caption, not drawn text (e). Recommended: accept all, as built. Blocks: nothing.
- **205** — chunk 54a's display choices and readings on Plan's week view (D31), (a)–(n), including the strict weight parsing that follows board 9's "5o" (m). Recommended: accept all, as built. Blocks: nothing.
- **193** — a finished program's rows show superset labels (A1, A2) from the run's last grouping, where SPEC Defaults 11 says supersets aren't in the history. Recommended: (a), leave them out (one line). Blocks: nothing (display).
- **192** — chunk 66's display choices and readings on the finished program (D31), (a)–(h), including deload weeks compared literally (d). Recommended: accept all, as built. Blocks: nothing.
- **190** — the CURRENT PROGRAM card's "N days a week" counts the run copy's newest weekdays, so after a weekday change that starts next week it shows next week's count this week. Recommended: (a), count the week's days in force, as Today and Plan do since chunk 50. Blocks: nothing (display; the release checklist's PR1 check reads it).
- **189** — chunk 65's display choices on the PROGRAMS tab (D31), (a)–(l). Recommended: accept all, as built. Blocks: nothing.

To-dos:
- **121** — Before the release: prove production's migration history. The command (given to you on 2026-10-21): in your `overload-v2-switch` worktree, on an up-to-date master, check that `supabase\.temp\project-ref` holds production's ref, then run `npx --yes supabase@2.119.0 migration list --linked`. Expected: `000`–`041` in both the Local and Remote columns, 42 rows, nothing on one side only. Paste the output; 121 stays open until then. Blocks: the release's migrations PR.
- **113** — live-check the fix session (this container can't reach the app). When: next gym visit. (a) Plan: finish a session, open Plan on the current week: its sets can't be edited, the line reads SESSION DONE — READ ONLY; reopen it and they can. (b) Train a few sets in airplane mode, reconnect, finish at once: the session is `completed`, not skipped, with a sensible end time. (c) Plan: after an edit that offers "apply to planned weeks ahead", tap APPLY twice fast: sets are added once. (d) Unmark a deload whose program set was deleted: sets come back. (e) answered 2026-10-14: #87's docs-only merge read "Canceled by Ignored Build Step". (f) #83: log sets with a flaky connection; a write that can't sync shows "N changes couldn't sync. Tap to retry." at the top of the workout screen, and tapping it sends them. Blocks: nothing.
- **79** — Confirm REDO SESSION is gone on a finished session's Today screen. When: after a session. Blocks: nothing.

## For the release
*Every migration `check-migration` flags during the 1.2 build, one line each (number, PR, what it flags). At the release Adam gets one blocking decision covering all of them (CONTEXT.md, "Staging and the 1.2 build").*

- **042** — chunk 36 (#95): `check-migration` exit 1 on three statements: two `ADD COLUMN` carrying a CHECK (`v2_week_plan_sets.target_rir_max`, `v2_user_settings.stage_volume_rule`: "new column carries a constraint or generated value") and `notify pgrst, 'reload schema'` ("not on the safe list"). Add-only: 3 columns, nullable or defaulted, whose checks every existing row satisfies, and 3 empty tables; no existing row changes.
- **043** — chunk 47 (#137): `check-migration` exit 1 on five statements:
  - `alter table v2_program_exercises add column if not exists replaces_program_exercise_id uuid references v2_program_exercises(id) on delete set null` ("foreign key action can change existing rows later");
  - `create or replace function v2_apply_ops`, `revoke execute`, `grant execute`, `notify pgrst` (each "not on the safe list").

  Add-only: one nullable column with no default (every existing row reads NULL) and a function nothing calls until 51a; no existing row changes. The reviewer's grep outside the function body found no update, delete, insert, drop, default or NOT NULL; its one hit is the key's own `on delete set null`. Its own staging deploy failed at the config step, a config-sync failure only, and the next push's deploy applied it (156, answered; verified live 2026-10-16).
- **044** — chunk 46m (#158): `check-migration` exit 1 on two statements, as for 042 and 043:
  - `alter table v2_set_logs add column if not exists added_place integer null constraint v2_set_logs_added_place_check check (added_place is null or added_place >= 1)` ("new column carries a constraint or generated value");
  - `notify pgrst, 'reload schema'` ("not on the safe list").

  Add-only: one nullable column with no default and no backfill, so every existing row reads NULL, which the check accepts. No existing row changes: on the reviewer's replay with the real seed, all 42 tables were identical before and after and 236 of 236 set logs read NULL, while a control that changed one row read different. It goes in the migrations-first PR with 042 and 043 (Adam's words, DECISIONS 174 (a)).
- **045** — chunk 53 (#183): `v2_plan_week` with the 1.2 copy rules. `check-migration` exit 1 on three statements, each "not on the safe list": `create or replace function v2_plan_week(…)`, `grant execute on function v2_plan_week(uuid, integer) to authenticated` and `notify pgrst, 'reload schema'`. A function only: `compare-schema.mjs` on replay snapshots before and after it finds 2 differences, both the function's body; no row changes; the rollback is 041's block verbatim (its md5 proven in the review). Live on staging since #183's deploy (R2: PLAN FORWARD planned the test account's week 4 and the stable account's week 3 with structure and no numbers). From step 5's deploy to step 6, 1.1's app plans its weeks through it (structure, no numbers: Release, step 4).
- **046** — chunk 53 (#183): 149's data migration, which changes rows (DECISIONS 149 (c), Adam 2026-10-16; numbered 046 by Adam, 2026-10-20, DECISIONS 196). It reaches production only through Release step 5, after the manual backup and Adam's yes. `check-migration` exit 1 on one statement, "not on the safe list": its `do $$ … $$` block (the scan names the block, not the two `update v2_program_exercises` inside it). **Blocking**, and the decision names this: it changes existing rows of every user's active week-dependent runs on production, Adam's friend's included (the run copies' `week_only`, `removed_at` and `position`, only on rows that differ; a second run changes 0). Where it goes (Adam, 2026-10-20, DECISIONS 202): in step 5's migrations PR (042–047), which merges only after the manual backup and Adam's explicit yes on 046; the merge is the consent. Before the yes, scoped to his `user_id`: RC44's read-only count of his runs that hit 203's sequence-run case, and the before counts and fingerprint (Release, step 3). Owed before the release: a read-only SQL file for that production reading, scoped to his id (the staging tool, `rehearse-046.mjs --staging`, refuses production). Rehearsed on 183 replayed 1.1-shaped worlds, on the branch's seed and on staging through #183's deploy (after Adam's re-seed from the branch's seed, 204 (a)): `rehearse-046.mjs --staging` read 7 changes on 6 rows on staging-sequence before the merge (0 on the test and stable accounts), and after the deploy `--compare` found exactly those and nothing else, with a second run changing nothing. Rollback: the backup.
- **047** — chunk 59 (#206, `3d2c7fa`): `v2_session_exercise_swaps.moved_sets`, the swap's record of which sets moved (Adam's answer to 46r's Q5, DECISIONS 183; numbered 047 by Adam, 2026-10-20, DECISIONS 196). `check-migration` exit 1 on one statement, `notify pgrst, 'reload schema'` ("not on the safe list"); the column statement is not flagged. Add-only: one nullable `jsonb` column with no default, no backfill, no check, index, policy or grant; the review's grep of the file without comments finds no update, delete, drop, insert or default. On the review's replay in staging's order (000–046, the seed, 046 pasted), every one of the 42 tables read the same before and after (the new column left out) and the seed's one swap row read NULL, while a copy with a default, one with a backfill and one that writes a set log each failed. Live on staging since #206's deploy: the column probe reads `200 []`, and the seed's swap row reads `moved_sets` null. It goes in step 5's migrations PR with 042–046.
- Update notes: Coach may skip analysing the one week in which a run's weekdays change (DECISIONS 159, Adam 2026-10-16).
- Update notes: on a sequence run, a repeated workout whose slots were edited differently in 1.1's week view plans the earlier slot's next cycle from the program, which matches the later slot's week; nothing stored is lost (DECISIONS 203, Adam 2026-10-20).
- **188f** — chunk 188f (#190, `e33ea04`), Adam 2026-10-20 (DECISIONS 188 (a)): `markSessionDeload` leaves a session that already holds a saved copy as it is. It fixes a bug that is live in production since phase 1 (a week mark cut off part way and pressed again loses a session's saved plan), so it ships with the release; no migration, no stored row changes.
- Update notes: fixed, a bug live since phase 1: a week marked as deload again after a mark that stopped part way (a dropped connection, the app closed) saved a marked session's deloaded sets over its plan, so UNMARK brought back the deload and not the plan (chunk 188f; DECISIONS 188 (a)).

## Tests owed
*Every missing-proof failure the reviewer merges (behaviour verified right, a test missing), one line each: chunk, PR, the test missing. One tests-only builder run before the release checklist adds them all, the way 176 does (RULES.md, "The 1.2 tests-owed rule").*

- **46r** (#177): a card a swap made that is drawn *before* the card it replaced (a layout W5 doesn't draw) keeps its own numbering, so the replaced card's logged sets keep theirs. The test pins `numberedHeads`' rule that a swap's card continues its slot only when it is drawn after the card it replaced (`src/features/gym/workoutRules.ts`). The break it must catch is the review's R4, that condition dropped. Executed (probe P7): Lat Pulldown 01✓ 02✓ then read 02✓ 03✓ under the swap card's 01, and the module's 478 tests all pass.
- **54a** (#186): Plan's weight box on an lbs exercise keeps the stored kg when the shown value is typed again (`resolveEditedWeightKg` in `PlanSetRow.tsx`): 9 kg shows as 19.8 lbs, and 19.8 typed again must write nothing, while 20 writes 9.07 kg. The break it must catch is the review's R54-W1, `const kg = toStorageWeight(parsed, unit)` for every edit, which passed all 521 writer tests. The probe in `<scratchpad>/build/r54a/probe/zzReview54a.probe.test.tsx` passes on the branch and fails under the break.
- **54a** (#186): Enter in Plan's weight box commits the typed weight without a blur first (`PlanSetRow.tsx`'s `onKeyDown`). The break it must catch is the review's R54-W3, the Enter handler removed, which passed all 521 writer tests. Same probe file.
- **54a** (#186): a RIR range that differs from the set's only in its high end is written: a set at RIR 1–3 picked to 1–2 writes `{ targetRir: 1, targetRirMax: 2 }` (`rirTargetPatches` in `planSetRows.ts`). The break it must catch is the review's R54-I1, the "already holds the target" check comparing the low end only, which passed all 521 writer tests. Same probe file.
- **54b** (#188): a stage the default dropped (`removed_at` on a stage program set) is not part of the default, for the marks and for THIS WEEK ONLY (`programHeads` in `src/features/plan/weekPlanning.ts`, chunk 42's, read by `changesSinceSource` and `thisWeekOnly`). 54b removed `weekDiff.test.ts`, whose "a removed stage, and the stages of a removed head, are not part of it either" pinned this for 1.1's module; 42's tests drop only a removed head. The break it must catch is the review's R11, the stages taken from every set instead of the live ones (`stages: sets` for `stages: live`), which passed all 206 tests of the week rules and the week view's files.
- **56** (#194): an item in a group whose plan row isn't this week's first is written to its own plan row. The sheet takes the row by the group's `weekPlanId` (`decide` in `src/features/plan/ReviewSheet.tsx`). The break it must catch is the review's M1, `args.thisWeek[0]` for every item, which passed all 37 tests of `ReviewSheet.test.tsx` and `PlanPage.review.test.tsx`: every item they press is in the first row's group. Under the break the press fails on `applyReviewAction`'s plan-row check, so nothing lands on the wrong row, but no test pins the sheet's choice. The probe `<scratchpad>/build/r56/probe/zzReview56.probe.test.tsx` (P1: Friday's Upper B completed, so a second group) passes on the branch and fails under the break.
- **56** (#194): an item decided on another phone since the list was read goes when it is pressed, and nothing is sent. The already-decided branch reads the decisions again (`refresh([])` in `decideReviewItem`, `src/features/plan/reviewService.ts`). The break it must catch is the review's M12, that refresh dropped: the item stays on the screen with its buttons back on. It passed all 42 tests of `reviewService.test.ts` and `ReviewSheet.test.tsx`, which assert `'already_decided'` and no write, never the screen. Same probe, P2.
- **56** (#194): the same for a race past that read, a `23505` on `v2_week_review_decisions_item_uk`: the item goes, with no error. The break it must catch is the review's M13, the refresh after the conflict dropped, which passed the same 42 tests. Same probe, P3 (the request meets the race and the row lands).
- 58a's W1 fixture test (#199) is done in 58b (#201): `GymSession.boards.test.tsx` feeds `useExerciseReferenceSessions` and asserts W1's LAST lines; the review's break O1 (the rows draw no LAST line) fails 5 tests. 58b owes none.
- **59** (#206): a moved dropset's drops show the targets of their own planned drops on the swap's card (`targetsOf`'s stage branch, `src/features/gym/useExerciseCardState.ts`). The break it must catch is the review's M1, that branch returning nothing, which passed all 27 tests of `GymSession.swap.test.tsx` and `GymSession.boards59.test.tsx`. Behaviour verified right: the committed W5 picture draws the moved drop "40 kg @ RIR 0" under AFTER SET 03, and on staging the dip card's drops read the pushdown's (22.5 kg × 8–10 @ RIR 0, 17.5 kg × 6–8 @ RIR 0). In the same run, plan the W5 fixture's drop as board W5 draws it, 40 kg × AMRAP (`set-3-drop` in `GymSession.boards59.test.tsx` has no `isAmrap`, so the picture reads "40 kg @ RIR 0"), and re-capture `w5.html` and the pictures that share its session (W5, W10, W11, W14).

- **60** (#208): LOG on an unlocked drop that isn't the current set asks first, at the screen (`beforeLog={guard}` on every `SetRowCurrent` in `src/features/gym/WorkoutRow.tsx`, a drop row's included): with the lock on and a drop of an earlier set open, LOG on a later set's drop or a drop out of order opens the question with 46r's words ("Log set 03 drop 1 before set 02?") and writes nothing until it is confirmed. The break it must catch is the review's R1, `beforeLog={isStage ? undefined : guard}`, which passed all 13 tests of `GymSession.logLock.test.tsx`. Behaviour verified right by the code (one `guard` for every open row) and by 46r's own `lockDecision` tests of a drop (`workoutRules.current.test.ts`).
- **67** (#210): none. The review re-ran 28 of the builder's 49 breaks and 3 of its own (M3, the DROPS stepper's − removing the lowest stages; M4, Normal on a warmup keeping the flag; M5, REST BETWEEN never written): all caught.
- **68** (#212): the add sheet writes to the workout whose card opened it. `AddExerciseSheet` in `src/features/planner/StepExercises.tsx` builds `useAddProgramExercise(workoutDay.id)`, and the hook's argument is the row's `workout_day_id`. Every StepExercises test mocks the hook and ignores its argument. The break it must catch is the review's R1, `useAddProgramExercise(workoutDay.programId)`, which passed all 97 tests of `StepExercises.test.tsx`, `StepExercises.sequence.test.tsx` and `PlannerPage.boards.test.tsx`. The test records the argument (RULES, 54b's mock rule) and presses + ADD EXERCISE on the second of two unlike workouts. Behaviour verified right by reading the code: the sheet gets the card's own `workoutDay`.
- **68** (#212): a subgroup that inherits its group's mark shows no mark of its own, and tapping that mark writes it (FOCUS on a subgroup with "INHERITED: FOCUS" writes `{ tagType: 'muscle_subgroup', mark: 'focus' }`, never `null`). `MarkSegment`'s `value` is `sub.ownMark` in `src/features/planner/StepPriorities.tsx`. The break it must catch is the review's R4, `value={sub.effectiveMark}`: the tap would then read as turning the mark off and write `null`. It passed all 16 tests of `StepPriorities.test.tsx`. Behaviour verified right by reading the code (as on staging before the chunk).

## Format for all new entries

Every entry opens with the ask and a recommendation; evidence comes after it, short.

```
### [n] [One-line summary]
**Ask:** [the question or task, in plain words]
**Recommendation:** [mine, and why in one line] — for a to-do: **When:** [e.g. now, before the release]
**Blocks:** [what stops until it's answered or done; "nothing" if nothing]
**Options:** [each option, one line] — decisions only
**Answer:** [Adam's]
**Evidence:** [what happened and why this isn't a default anyone competent would just take; for deferred decisions, what gets redone if the answer goes against the provisional path]
```

Blocking vs deferred: an entry is blocking when continuing means guessing at something expensive to undo; otherwise it is deferred and the work continues on the recommendation. Entries written before 2026-10-14 keep the older layout (Severity, Chunk, Ask, Options, Recommendation, …, Evidence); it carries the same information.

When an entry is answered or done, it shrinks to three lines (what, answer, date) and its full text moves to HISTORY.md. Superseded procedures go straight to HISTORY.md, never kept inline. "Waiting on Adam" is rewritten at every boundary; if both lists are empty it says "Nothing."

## Open

### 156 Migration 043's staging deploy failed at the config step; the next push's deploy applied it (chunk 47)
- What: chunk 47's merge (#137, `5762d4a`, 2026-10-16) had one `Supabase Preview` run, which failed in four seconds at the config step ("Failed to update config for branch: staging"), so 043 didn't apply; the next push's deploy (#138, `43f1fc8`) succeeded and applied it, and R2 passed. A failed staging deploy is blocking until Adam has read it, so it held the chunks that need 043, 51a first.
- Answer: (Adam, 2026-10-16: config-sync failure only, 043 verified live) "the failed run on 5762d4a says "Failed to update config for branch: staging" — the config sync step, not the migration step. Later deploys succeeded (chunk 49's), and a successful deploy applies pending migrations." Verified on staging as he asked, signed in as the test account (chunk 50's review, finished after a restart): `v2_apply_ops([])` → 0; one update-and-revert list on week 3 Upper A set 1 (`target_weight` 11.5 → 14 → 11.5) → 2, its `select=*` row (18 columns) the same before and after; `probe-live-columns.mjs` 043 green (the column `200`, the control `400 42703`); sign-ups off (`signup_disabled`), and `staging-smoke.mjs` 51/51. The migration history (`supabase_migrations.schema_migrations`) isn't readable from here: PostgREST answers `406 PGRST106`. Every push since the failed run deployed (three runs, one success), chunk 49's included. Nothing waits on it now. Full text in HISTORY.md.
- Date: 2026-10-16

### 157 043 accepts a delete of a run's workout or program; TASKS says "only an update is allowed" (chunk 47)
- What: whether `v2_apply_ops` (043) may delete a run's `v2_programs` or `v2_workout_days` row, where TASKS 47 says "only an update is allowed"; as built (#137) it refuses an insert into either and accepts a delete.
- Answer: (Adam, 2026-10-16) "(c). Narrow the app's op type so v2_programs and v2_workout_days allow update only, no delete, with a test. No migration." Built in d31b (#162, `bc2de7c`): `DeletableTable` leaves out both tables, with `@ts-expect-error` tests and the test stand-in refusing the same deletes; 043 is unchanged. Full text in HISTORY.md.
- Date: 2026-10-16

### 158 Chunk 49's display choices where SPEC and TASKS give no layout (provisional, D31)
- What: chunk 49's display choices for Settings' two [1.2] rows (no board): (a) "Log sets in order" in a WORKOUT section after REST TIMER; (b) its label in sentence case; (c) TASKS' explanation lines under the rows; (d) each chip on two lines at phone widths; (e) chunk 60's lock line names the setting as SPEC does, "LOG SETS IN ORDER".
- Answer: (Adam, 2026-10-16) "all accepted, including (e)." All five stay as built; (e) is chunk 60's to build. Full text in HISTORY.md.
- Date: 2026-10-16

### 159 Coach's weekly analysis reads the run's newest weekdays for every week (chunk 50, for 51b; Coach is frozen)
- What: whether Coach's weekly analysis resolves each week through the run's schedule rows (a Coach change, the freeze's base moved), or keeps expecting the run's newest weekdays in every week, so that after a 51b weekday change the week of the change is never complete and never analysed.
- Answer: (Adam, 2026-10-16) "no Coach change. Coach stays exactly as it is; it may skip analysing the one week in which weekdays change. Note it in the update notes." Written into "For the release" as an update note; no SPEC line (no SPEC rule covers Coach's weeks). Full text in HISTORY.md.
- Date: 2026-10-16

### 160 Chunk 50's display choices (provisional, D31)
- What: chunk 50's two display choices (D31): (a) Today and Plan stay on their spinner until a weekday run's schedule rows have loaded, and a failed read keeps it there; (b) in Plan, stepping to a week where the selected weekday has no workout selects that week's first day.
- Answer: (Adam, 2026-10-16) "(a) and (b) accepted." They stay as built (#142). Full text in HISTORY.md.
- Date: 2026-10-16

### 161 An added set's type during a workout: the rules can't see it before it is logged, and UNLOG loses it (chunk 46)
- What: an added set's type during a workout (chunk 46): its rules can't see the type before the set is logged (one made a Warmup is still the current set, and leaves a gap in the numbers once logged), and an added set logged, made a Warmup and unlogged comes back a working set and moves the open set after it.
- Answer: (Adam, 2026-10-16) "go ahead with chunk 46's fourth attempt, with (b)(i): an added set's draft also keeps its type, so an unlog is undone exactly and nothing moves; 46's rules see every added set's type." Chunk 46 goes to a fourth attempt. Full text in HISTORY.md.
- Date: 2026-10-16

### 162 What LOG writes from a row nobody typed into: the plan's targets or last time's numbers (pre-read, chunk 58a)
- What: what LOG writes from a row nobody typed into (chunk 58a): the plan's targets (SPEC C3), or last time's numbers as today.
- Answer: (Adam, 2026-10-16) "(a). An untouched row's values are the plan's targets; a range or AMRAP is a placeholder, so LOG needs reps typed; with no planned weight the weight box is empty and LOG needs it. Last time's numbers show only on the row's LAST line. (Pre-fill from last time stays phase 2.)" Full text in HISTORY.md.
- Date: 2026-10-16

### 163 "Skip the rest of this exercise": also its open added sets and its unlogged warmups? (pre-read, chunk 59)
- What: whether "Skip the rest of this exercise" (chunk 59) also skips the exercise's open added sets and its unlogged planned warmups; today it skips neither.
- Answer: (Adam, 2026-10-16) "(a). Skip the rest of this exercise also skips its open added sets and its unlogged warmups." Full text in HISTORY.md.
- Date: 2026-10-16

### 164 What a swap for today moves to the new exercise (pre-read, chunk 59)
- What: what a swap for today moves to the new exercise (chunk 59): the original's open sets as board W5 draws them, or as many plain sets as the original planned, numbered from 01 (today).
- Answer: (Adam, 2026-10-16) "(a). A swap for today moves the original's open sets to the new exercise with their numbers, type, drops and targets, as W5 draws." Full text in HISTORY.md.
- Date: 2026-10-16

### 165 CUES on a set that has no planned set (pre-read, chunk 61)
- What: what CUES does on a set with no planned set (chunk 61): a set added in the workout, or moved to a swapped-in exercise.
- Answer: (Adam, 2026-10-16) "(a). No CUES row in the ⋯ of a set with no planned set." Full text in HISTORY.md.
- Date: 2026-10-16

### 166 Auto-finish once a planned set is deleted or retyped during the workout (pre-read, chunk 61)
- What: whether auto-finish (chunk 61) waits for a log on every planned set id, so that a planned set deleted or retyped in the workout means it never finishes, or for what the workout's rows say is left.
- Answer: (Adam, 2026-10-16) "(a). Auto-finish waits for what the workout's rows say is left (the same view as the finish warning)." Full text in HISTORY.md.
- Date: 2026-10-16

### 167 The DROPS stepper on a logged set, below the drops already logged (pre-read, chunk 62)
- What: whether the DROPS stepper on a logged set (chunk 62) can go below the drops already logged; chunk 46 asks 19c's question and deletes the extra logged drops.
- Answer: (Adam, 2026-10-16) "(a), as 46 built: the stepper can go below the logged drops, and deleting a logged drop asks first (19c)." Full text in HISTORY.md.
- Date: 2026-10-16

### 168 Offline: a set not logged yet switched to or from Warmup when logged sets after it move (pre-read, chunk 62)
- What: offline, a set not logged yet switched to or from Warmup when logged sets after it move (chunk 62): queued like a delete's renumber, or "Requires a connection".
- Answer: (Adam, 2026-10-16) "(a). The switch and the renumbering of later logged sets queue offline, like a delete." Full text in HISTORY.md.
- Date: 2026-10-16

### 169 CHANGE THE PROGRAM's DAYS card: "a day another workout already uses", as saved or as edited? (pre-read, chunk 51b)
- What: whether the DAYS card's "a day another workout already uses" (chunk 51b) means the saved schedule or the edit as it stands; with the saved one, two workouts can't trade days in one save.
- Answer: (Adam, 2026-10-16) "(a). The DAYS card checks the edit as it stands, so two workouts can trade days in one save." Full text in HISTORY.md.
- Date: 2026-10-16

### 170 An unlogged added set's place after an earlier set is deleted or switched to or from Warmup (chunk 46)
- What: whether an unlogged added set keeps its place, after an earlier set is deleted or switched to or from Warmup, ahead of an open added set after it; chunk 46's fourth attempt gave the later one its place (a behaviour bug; the third attempt got it right), and Adam's rule for that attempt was no retry.
- Answer: "allow chunk 46's fifth attempt, done this way (Adam, 2026-10-18):
  - Set numbers are never claimed or stored per rule. Each set has a fixed place in the session order: planned sets by planned position, added sets by when they were added. A set's displayed number is its rank among the non-deleted, non-warmup working sets in that order (warmups numbered apart, as now). LOG stores the number the row shows; a delete or warmup switch that changes logged sets' numbers patches them, as 146 (a) already writes. This satisfies 146, 151 and 161 as answered; no new decision.
  - Start from attempt 3's delete and warmup behaviour, which the reviewer confirmed correct.
  - Verification adds a sequence test: many generated sequences of add, log, unlog, delete and warmup switches, asserting after every step that numbers are contiguous with no duplicates, every set's identity and order are unchanged, and unlog then log is an exact undo. Break proof: reintroduce attempt 4's "draft claims its number" and the test fails.
  - This attempt's builder runs on Opus (the process allows it after two behaviour failures)."

  Written into SPEC.md (Logging mechanics → Delete set (18b)). Built in chunk 46's fifth attempt (`d09a241`) and reviewed on 2026-10-19. It is right for the working sets, and the named break fails the sequence test. Not merged, on 173. Full text in HISTORY.md.
- Date: 2026-10-18

### 171 An exercise added on a stable run in chunk 51a lands with no sets until 51b (chunk 51a)
- What: chunk 51a's builder asked about an exercise added on a stable run. SPEC gives it the default's sets, but 51a draws no set rows on a stable run (51b's), so until 51b it lands in the not-done sessions with none.
- Answer: (Adam, 2026-10-19) "not a spec gap. SPEC says an exercise added on a stable run gets the default's sets; until 51b builds the default's set rows, staging shows it with none. That's an accepted interim between 51a and 51b. The reviewer checks that 51b's scope covers adding the default's sets for an added exercise, and adds it to 51b's scope if it doesn't." Checked in chunk 51a's review: 51b's scope named the default's set rows "per exercise" and "+ SET", but neither it nor its verification or staging list named an added exercise, so all three do now (TASKS-1.2, chunk 51b). `planProgramChange` already lands an added entry's sets on a stable run (chunk 45). No SPEC line: SPEC already says it.
- Date: 2026-10-19

### 172 Chunk 51a's display choices on CHANGE THE PROGRAM (provisional, D31)
- What: twelve display choices of chunk 51a's CHANGE THE PROGRAM, (a)–(l), that no board or SPEC sentence settles, or where the screen differs from a board's drawing (recommended: accept all).
- Answer: (Adam, 2026-10-19) "I meant the item about Plan's "CHANGE THE PROGRAM FROM WEEK N" button naming a different week than the screen's rule box when the week's last open session is in progress — whichever letter that is in the entry. The button follows the screen. The other eleven are accepted." That item is the entry's (j) (his earlier "(l)" was the letter he gave; (l) as listed, a superset's within-round rest stored as 0 reading 0:00, is among the eleven accepted, and so are (a)–(i), (k)). Built in d31b (#162, `bc2de7c`): the button names the same week as the screen's rule box, read through the screen's own statuses (a session in progress is left as it is, so changes start the week after). Full text in HISTORY.md.
- Date: 2026-10-19

### 173 Chunk 46's fifth attempt: a warmup log's number, and a set added in a reopened session (chunk 46)
- What: chunk 46's fifth attempt built 170 right for the working sets, with two behaviour bugs left: a warmup's log kept a number it no longer showed (two added Warmups could be one REVIEW item; unlog then log wasn't exact), and a set added while the card's list doesn't name the earlier added sets (a reopened session, another phone) was drawn before them, so two logs could hold one number.
- Answer: (Adam, 2026-10-19) "(a), a sixth attempt of chunk 46, Opus builder, with:
  - Warmups follow the same numbering rule as working sets: when a warmup's displayed number changes (delete, switch to or from Warmup), its log's stored number is patched, so a log never keeps a number its row no longer shows.
  - An added set's place in the session order is persisted when it is created (from its log once logged, from its draft before that) and survives reload and reopening. A set added in a reopened session comes after every set added earlier. No two logs ever hold one number.
  - The sequence test's generator adds warmup steps (add, log, unlog, switch to and from Warmup) and a "reopen the session" step, with the same invariants after every step, plus: no two logs share a number, and REVIEW sees two added warmups as two items. Break proofs for both bugs.
  - If this attempt fails review on behaviour again, don't retry: stop 46 and write it up for Adam as a chunk to redraw."
  The sixth attempt stopped before building: the second bullet needs a stored place, so chunk 46m (migration 044, `v2_set_logs.added_place`, 174) is built first. Full text in HISTORY.md.
- Date: 2026-10-19

### 174 An added set's place across a reopen needs a column (chunk 46's sixth attempt, for 173)
- What: chunk 46's sixth attempt stopped before building (`<scratchpad>/build/chunk-46-builder-6.md`, section 3). After 173's first bullet a warmup's log holds its W number, and then no column of `v2_set_logs` says where an added Warmup stands among the working added sets after a reopen (executed: two histories store the same rows and need opposite orders). The builder's options: (a) a column, `v2_set_logs.added_place integer null`, no default (recommended); (b) no migration, the log's id made in time order when the set is added; (c) a fixed rule instead of a place for that one shape; (d) the phone keeps the card's list past the session's end.
- Answer: (Adam, 2026-10-19) (a), word for word:
  - Migration 045, its own small chunk "46m", built and merged into staging before 46's sixth attempt: `alter table v2_set_logs add column if not exists added_place integer null` with check (added_place is null or added_place >= 1). No default, no backfill, no existing row touched. The builder prints the grep proving no update/delete/drop/alter type. check-migration must pass as additive; the usual staging steps: Supabase deploy read, probe-live-columns green for the new column, verify-rls unchanged. Add 045 to "For the release" with 042–044 (the migrations-first PR).
  - Meaning: an added set's place among the sets added to its exercise in that session, from 1, in the order they were added. Written when the added set's log is first written (the sync queue carries it offline), kept on re-log after an unlog (the draft holds it until then). Planned sets leave it null.
  - A log with null added_place that has no planned set (anything logged before 045) orders as the app orders it today (logged time, then id). That fallback is tested.
  - Record it in SPEC.md's Objects stored → Set log as one [1.2] line, and in TASKS-1.2's Data model and Migration summary.
  - Then chunk 46's sixth attempt uses it, as 173 says. The same rule applies: one more behaviour failure means stop and write 46 up for a redraw.
  Numbering (Adam, 2026-10-19): "Migration numbers: (a). Chunk 46m's added_place is 044; chunk 53's v2_plan_week becomes 045. Renumber TASKS-1.2 (Data model, Migration summary, chunk 53, Release, "For the release") and every other mention, docs only, in the same commit as 46m's scope note." So the migration is 044, not the 045 of his first words. Written into SPEC.md (Objects stored → Set log) and TASKS-1.2 (chunk 46m, the Data model and the Migration summary), and 044 into DECISIONS "For the release", in #153. Full text in HISTORY.md.
  Writers (Adam, 2026-10-19, fourth batch), word for word: "added_place writers: chunk 46 owns the rule (a pure function assigning the next place when an added set is created). It's assigned once, when an added set is created: + ADD ROUND and any add-set path in 58a, and "Add a set" in the exercise ⋯ (59). The draft holds it until the first log. It's written to the log by whichever chunk writes that set's log: LOG (58a), including the offline queue payload; re-log after unlog keeps the draft's value (63). No chunk ever changes it afterwards: delete, warmup switch and renumbering never touch added_place, because numbers are derived from the order, not stored in it. If TASKS puts any of those paths in a different chunk, follow TASKS and list the final mapping in 46m's scope note." The final mapping is in TASKS-1.2's chunk 46m since #155: every path sits in the chunk he named. Chunk 46m merged on 2026-10-19 (#158), and 044 is live on staging.
- Date: 2026-10-19

### 175 Chunk 51b's display choices on CHANGE THE PROGRAM's DAYS card and set rows (provisional, D31)
- What: chunk 51b's twelve display choices on CHANGE THE PROGRAM's DAYS card and a stable run's set rows, (a)–(l), that no board or SPEC sentence settles, or where the screen differs from a board's drawing (recommended: accept all).
- Answer: (Adam, 2026-10-19) "accepted as built (display only, D31; anything wrong comes up in my review on staging)." Full text in HISTORY.md.
- Date: 2026-10-19

### 176 51a's exercise-level writers on CHANGE THE PROGRAM are tested on the first workout only: a tests-only follow-up? (chunk 51b's retry)
- What: whether a tests-only follow-up may prove 51a's exercise-level writers on CHANGE THE PROGRAM on a workout that isn't the first (each is only ever tested on the first; recommended: yes, after d31b).
- Answer: (Adam, 2026-10-19) "yes, queue those tests as one builder run in tonight's order, after 46's review." Full text in HISTORY.md. Built: chunk 176 (#172, 2026-10-20), tests only; its builder's finding is 191.
- Date: 2026-10-19

### 177 Do the drop and stage logs of an added set also carry `added_place`? (pre-read, chunk 46)
- What: whether the drop and stage logs of an added set also carry `added_place`.
- Answer: (Adam, 2026-10-19) "no. Only an added set's own log carries added_place; its drop and stage logs leave it null."
- Date: 2026-10-19

### 178 An added set left unlogged when the session ends: what patches the logged sets after it? (pre-read, chunk 46)
- What: what patches the logged sets after an added set is left unlogged when the session ends.
- Answer: (Adam, 2026-10-19) "(a), with limits. Chunk 46's rules report the logged sets whose stored number differs from the number their row shows; the workout screen writes the corrected numbers when it draws the session's rows. It writes only where they differ, so drawing the same session again writes nothing. It writes only from the workout screen for an in-progress or reopened session, never from History, Plan or any read-only view. Offline, the writes queue like a delete's. Tests: a session ended with an unlogged added set, reopened, gets one correction write; a second draw gets none (break-proven both ways)."
- Date: 2026-10-19

### 179 The sets a swap for today moves: added sets with a place, or none? (pre-read, chunk 46)
- What: whether the sets a swap for today moves are added sets with a place.
- Answer: (Adam, 2026-10-19) "yes. Sets moved by a swap for today count as added sets of the new exercise. Each gets its place at the swap, in their order, after any sets already added to that exercise; chunk 59 writes it."
- Date: 2026-10-19

### 180 155 (a)'s cases outside Adam's words: an AMRAP set, and a number changed before the switch (d31b)
- What: two cases of 155 (a) that Adam's words don't cover, as d31b built them: an AMRAP set switched to NUMBER or RANGE starts from the examples (8, 8–10), and the value carried is the target the sheet opened with, not a number stepped or typed before the switch (recommended: keep both).
- Answer: (Adam, 2026-10-19) "180, 181: accepted as built." Full text in HISTORY.md.
- Date: 2026-10-19

### 181 d31b's display choice: the bottom bar's install strip (provisional, D31)
- What: d31b's one display choice: the bottom bar's INSTALL strip back on `--base` with the update notice, as before #135 (recommended: accept).
- Answer: (Adam, 2026-10-19) "180, 181: accepted as built." Full text in HISTORY.md.
- Date: 2026-10-19

### 182 Chunk 46 stopped after its sixth attempt: how to redraw it (chunk 46)
- What: chunk 46 stopped after its sixth attempt (Adam's rule: no retry after another behaviour failure); how to redraw it (a narrow redraw on the sixth attempt; a full redraw from a table; merge the sixth attempt as it stands).
- Answer: (Adam, 2026-10-20) "(a). Redraw 46 as one small chunk on the sixth attempt's module, changing only what 183–185 decide. Opus builder. If it fails review on behaviour, don't retry: write up which requirement to simplify instead (a rare case may display imperfectly, but no data may be lost or written wrong)." Option (a), as the entry words it: "A narrow redraw on the sixth attempt (`build/chunk-46` at `65dd197`, recommended): after 183–185, one chunk changes the swap's numbers (183), the unlog of a set added before 1.2 (184) and, if 185 says so, the correction report; reviewed as any chunk, under the same rule." Queued as chunk 46r (TASKS-1.2). Full text in HISTORY.md.
- Date: 2026-10-20

### 183 The numbers of the sets a swap for today moves, beyond W5's case (for 46's redraw and 59)
- What: the numbers of the sets a swap for today moves, beyond W5's case, and what the original card shows for them (recommended: one numbering for the exercise's place in the session).
- Answer: (Adam, 2026-10-20) "(a). One numbering for the exercise's place in the session, covering moved and added sets." Option (a), as the entry words it: "One numbering for the exercise's place in the session (recommended): the original card's sets that didn't move, then the moved sets in the order they stood, then any set added to the new card, each numbered by its rank in that list. W5: Lat Pulldown 01, 02; Machine Pulldown 03; + ADD SET there, 04. In the first case above the original reads 01, 02 (its logged 03 becomes 02) and the new card 03, 04. The original card draws no row for a set that moved, so the swap has to record which sets moved (59)." Full text in HISTORY.md.
- Answer, follow-ups (Adam, 2026-10-20): "A swap into an exercise that already has added sets: the moved sets come after them. A swap never renumbers sets that are already logged." "The same exercise on two cards in one session: each card is numbered on its own, as today's display does."
- Answer, 46r's Q1 and Q5 (Adam, 2026-10-20): Q1, no: "A swap never changes the number of a set that's already logged, on either card. If moving open sets leaves a gap on the original card, the gap shows; that's accepted (rare, and no stored data is wrong)." So the original's logged sets keep their numbers (01, 03 with the gap), replacing the option's "its logged 03 becomes 02". Q5, (a): the record of which sets moved is a nullable jsonb column on the swap's row (`v2_session_exercise_swaps`), built in chunk 59, which becomes a migration chunk and runs alone; stored explicitly, never inferred from the logs.
- Date: 2026-10-20

### 184 A set added before 1.2, unlogged and logged again under 1.2: it can't come back in its place (for 63, and 46's redraw)
- What: a set added before 1.2, unlogged and logged again under 1.2, can't come back in its place (recommended: the unlog moves nothing; the re-log may).
- Answer: (Adam, 2026-10-20) "(b). The unlog moves nothing; the re-log may." Option (b), as the entry words it: "The draft keeps the log's time, so the unlog moves nothing (46); the re-log writes the time it happens, so the set moves to after the other old added sets then (recommended)." Full text in HISTORY.md.
- Date: 2026-10-20

### 185 Two phones on one session: 178's corrections go back and forth (for 58a)
- What: two phones on one session correct each other's stored numbers back and forth while one holds a set added and not logged yet (recommended: never correct a log after a set only that phone holds).
- Answer: (Adam, 2026-10-20) "(c). A phone never corrects a stored number after a set only it holds." Option (c), as the entry words it: "Never correct a log that comes after an open added set on its card (recommended); every other correction as 178 says." Full text in HISTORY.md.
- Date: 2026-10-20

### 186 Chunk 52's display choices on Plan's header (provisional, D31)
- What: chunk 52's eight display choices (a)–(h) on Plan's header (D31; recommended: accept all).
- Answer: (Adam, 2026-10-20) "all accepted." Every display choice (a)–(h) stays as built. Full text in HISTORY.md.
- Date: 2026-10-20

### 187 WEEK ⋯'s row names the other direction while a mark or unmark is out (chunk 52; display)
- What: WEEK ⋯'s row reads UNMARKING… while a mark is out and MARKING… while an unmark is (display; recommended: fix in 54a).
- Answer: (Adam, 2026-10-20) "(a), fixed in 54a with a test through the real hook." Option (a), as the entry words it: "in 54a, as recommended", the recommendation being: "the row's pending label takes its direction from the request itself (the mutation's own `isDeload`), not from whether the week reads as marked, with a test through the real `useSetWeekDeload` that holds the request in flight (the review's probe A is one). Display only: nothing written differs, and the row is disabled while the write is out." Full text in HISTORY.md. Built in chunk 54a (#186, `449b5ca`): `WeekMenuSheet` takes `pendingDeload`, the request's own `isDeload`; `PlanPage.weekMenu.pendingLabel.test.tsx` holds the request in flight through the real `useSetWeekDeload`.
- Date: 2026-10-20

### 188 A week deload mark that stops part way leaves the week half marked, and marking it again loses a session's saved plan (older than 1.2; found in chunk 52's review)
- What: a week deload mark that stops part way leaves the week half marked, and marking it again saves a marked session's deloaded sets over its plan (older than 1.2; in production since phase 1).
- Answer: (Adam, 2026-10-20) "(a). markSessionDeload leaves a session that already holds a saved copy as it is. Its own small chunk before the release, with a test for the interrupted-then-repeated mark; not inside 54a." Option (a), as the entry words it: "the guard in `markSessionDeload`, as recommended", the recommendation being: "`markSessionDeload` leaves a session that already holds a saved pre-deload copy as it is (its flag set, nothing recalculated or saved again), so marking a half-marked week again only finishes the mark. A small behaviour fix with a test of the sequence below … it changes no stored row." Queued as chunk 188f (TASKS-1.2); built there (#190, `e33ea04`, 2026-10-21). A session that an UNMARK cut off part way: 208. Full text in HISTORY.md.
- Date: 2026-10-20

### 189 Chunk 65's display choices on the PROGRAMS tab (provisional, D31; accepted as built)
**Ask:** chunk 65's display choices, where SPEC and the boards give no single answer, are accepted as built. They are listed here for Adam's review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. None changes a stored value or what a write sends; each is a word, an order, an entry or a state's drawing, and cheap to change.
**Blocks:** nothing.
**Options:** (a)–(l) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-65-builder-1.md`, "For the reviewer"), held against SPEC Programs and runs [1.2], Screens → PROGRAMS and the boards in the review:
- (a) PR10's failure is the board's banner over the scrim, where TASKS says "toast". It reads "Couldn't start [name]." with the real reason under it, and stays until the next START or until the sheet closes.
- (b) A FINISHED row's dates take the board's en dash ("SEP 14 – OCT 4, 2026"). Every YOUR PROGRAMS row says "N DAYS A WEEK", where the board's second row says "4 DAYS".
- (c) DON'T CARE lists its groups in the planner's order ("Forearms, calves"); the board has "Calves, forearms".
- (d) The boards' `accentText` (a darker accent in light) has no app token, so the RUNNING tag and the picked radio rows draw `var(--accent)`.
- (e) PR12 (the start sheet with nothing to start, and CREATE PROGRAM) appears only when the saved list empties under an open sheet. PR3 has NEW PROGRAM and no START, so TASKS 65's staging step "START shows PR12" can't run on the empty account. Tests and a fixture cover PR12.
- (f) CREATE also needs a name ("Name the program to create it."), as the old page did; SPEC names only the two types. On staging, PR13b's CREATE turns on once a name is typed.
- (g) PRIORITIES' back arrow ("Back to Programs") goes to `/program` with `replace`, not back in the history to Plan's week.
- (h) A read that failed with nothing to show is "COULDN'T LOAD PROGRAMS" and the real reason, never an empty state. A failed CREATE says "Couldn't create the program." with the reason (no board draws one).
- (i) The FOCUS and DON'T CARE rows are drawn only for a mark that is set (an unset feature shows nothing), where the boards always draw both. So a run with no marks has no way into PR5 from the card.
- (j) A sequence run's week chip waits for the cycle (CYCLE n) and is left out until it is known. The types line waits for the run's own program.
- (k) PR3 is for an account with no saved, running or finished program. Otherwise YOUR PROGRAMS just has nothing under its label.
- (l) Smaller choices:
  - FINISH doesn't open the start sheet afterwards (END RUN did).
  - The PLAN lock's bubble also closes on a tap elsewhere.
  - START is off while the picked program's workouts are being read.
  - A FINISHED row is two lines: the name, then the dates and weeks.

### 190 The current program's "N days a week" counts the run copy's newest weekdays, not the week in force (chunk 65; display)
**Ask:** the CURRENT PROGRAM card says "Weekdays · stable · N days a week". Should N count this week's days in force (`scheduleForWeek`, as Today, Plan and the rest-day count do since chunk 50), or the run copy's own `schedule`, as built?
**Recommendation:** (a), this week's days in force. A CHANGE THE PROGRAM DAYS change (51b) can start next week. Once one is saved, the run copy's `schedule` holds next week's days, so the card shows next week's count during this week, the same shape as the rest-day count chunk 50 fixed. The fix is a one-line display change with no write. YOUR PROGRAMS rows are saved programs and stay as built.
**Blocks:** nothing in the build: it is display only and cheap to change. The release checklist's PR1 card check reads it.
**Options:** (a) the week in force (recommended); (b) the run copy's newest days, as built; (c) no count on a run whose days change.
**Answer:**
**Evidence:** `programTypesLine` (`src/features/programs/programsTabLogic.ts`) counts `Object.values(program.schedule)` for the run's own program. TASKS 65 says "(P1.2-4's counting for days)", but P1.2-4 is the rule for a finished program's N weeks, so neither SPEC nor TASKS says which days count. `runScheduleReads.static.test.ts` scans only `features/gym` and `features/plan`, so it can't see this read in `features/programs` (chunk 65's review).

### 191 UNDO on CHANGE THE PROGRAM can put an exercise back inside another superset, and the draft then can't be saved (merged 51a; found by chunk 176's builder)
- What: 51a's UNDO put a removed exercise back at the index it stood at, even where a superset stands now, so the draft held an exercise between two members of a superset and SAVE refused it with nothing on the screen to say why (recipe 1, Push: Bench Press, the Overhead Press + Lateral Raise superset, Triceps Pushdown; REMOVE Bench Press, REMOVE Triceps Pushdown, UNDO both in that order. Recipe 2, Legs: REMOVE Romanian Deadlift, SUPERSET on Back Squat, UNDO). Recommended: (a), the exercise lands just before or just after the block, never inside it.
- Answer: (Adam, 2026-10-20) "write it up as a small DATA fix chunk, placed before 54a". Built as (a) in chunk 51c (#179, `33f721d`): an exercise whose place falls strictly inside a superset goes after it, and a superset's member still goes next to its others. Left as built (SPEC is silent; TASKS 51c's "Would not catch"): an UNDO out of stack order can land one place off where the exercise stood, never inside a superset (Legs: REMOVE Back Squat, REMOVE Romanian Deadlift, UNDO both in that order: Romanian Deadlift comes back above Back Squat); the cards show it before SAVE. Full text in HISTORY.md, where its recipe 1 named the pair wrongly (Lateral Raise + Triceps Pushdown).
- Date: 2026-10-20

### 192 Chunk 66's display choices and readings on a finished program (provisional, D31; accepted as built)
**Ask:** where SPEC and the boards give no single answer, chunk 66's choices on the finished program screen (PR14, PR15) are accepted as built. They are listed here for Adam's review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. Each is a word, an order, a state's drawing, or what a tile's dot means. None changes a stored value or what a write sends, and each is cheap to change. The superset labels are a separate entry, 193.
**Blocks:** nothing.
**Options:** (a)–(h) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-66-builder-1.md`, section 3), held in the review against SPEC (Defaults 11, Known gaps, Programs and runs [1.2], Screens → PROGRAMS) and boards PR14 and PR15:
- (a) **SPEC over the board, not a choice.** PR14's change list has "Face Pull added, in a superset with Seated Cable Row" and "Romanian Deadlift tempo 3-1-1-0", and a row reads "3 SETS · TEMPO 3-1-1-0". SPEC's Known gaps: "PR14's example lists a tempo change and a superset change; the history shows only what weeks store (Defaults, 11)". So no tempo is shown anywhere, and the item reads "Face Pull added".
- (b) **One card per workout, in the program's order, each with its rows.** The board's last card groups the unchanged workouts as "MON · THU · FRI / Push 1, Push 2, Pull 2 / NO CHANGES", with no rows. TASKS: "the week's structure cards per workout".
- (c) **What "the week before" is.** It is the nearest earlier week the run planned. Only planned weeks get a tile, so a week nobody planned has none. The header's "N weeks" (P1.2-4: calendar weeks) can then be more than the number of tiles.
- (d) **Deload weeks.**
  - A deload week is one whose every planned session is marked (Plan's `weekIsFullyDeload`). A half-marked week reads WK and isn't counted. "1 deload" is left out when there is none.
  - A deload week is compared literally with the week before. With the deload rules on, a deload halves its sets, so it and the week after it both read as changed ("~ … 4 → 2 sets"); the board draws DL 7 with no dot. Using the week before the deload as the base for the week after it would be a one-line change in `buildProgramHistory`.
- (e) **Where PRIORITIES leads.**
  - Marks in neither table: the editor (SPEC: a finished program's priorities "stay editable").
  - Marks in both tables: the new table's editor (the 1.1 migration mapped an active run's old marks onto it).
  - The row's second line ("Focus: chest, back · Don't care: calves") is drawn only for marks in the new table; the old page shows its own. The row is only its label when nothing is marked.
  - Until the marks are read, the row is drawn but isn't a link. A failed read says "Couldn't load priorities."
- (f) **A sequence run.** The tiles are cycles (CY), and the cards say SLOT n (position + 1, as Plan). The header still counts calendar weeks.
- (g) **States and words no board draws:**
  - "COULDN'T LOAD THIS PROGRAM" with the real reason;
  - "COULDN'T FIND THIS PROGRAM" for an unknown id or a running program;
  - "NO WEEKS WERE PLANNED" (DELETE still offered);
  - a failed delete: "Couldn't delete [name]." with the reason, inside the confirm;
  - "NO SETS";
  - "set 3 is now a rest-pause set / myo-reps set / cluster set / normal set";
  - "X: 0 → 2 warmup sets";
  - "X moved before Y" or "moved to the end" (two neighbours swapped make exactly one item).
- (h) **Smaller choices:**
  - It opens on the first week whose structure changed, else week 1 (the board opens on a changed week).
  - The legend, and a changed week's dot, are drawn only when some week changed.
  - The chips' and the changed rows' accent text is `var(--accent)`; there is no `accentText` token, as in 189 (d).
  - In the confirm, DELETE is `ConfirmDialog`'s solid danger button, where the board tints it.
  - Both back arrows use `replace` (as 65's priorities screen does).
  - The PLAN tab is lit on `/program/finished/*`, as PR14 draws it.
- **Outside the screen (Escalation 13, read in the review and accepted):**
  - `useDeleteMeso` now has `networkMode: 'always'` and returns its invalidations. Both apply to its other caller too, History's meso filter (`HistorySessions.tsx`).
  - Offline, History's CONFIRM DELETE used to wait on DELETING… until the phone was back online, and then delete. Now it fails at once, and the confirm returns to CONFIRM DELETE with no message, because History passes no `onError`. Nothing is written wrong. History's tests pass.
  - `StepPriorities` takes `showOptionalNote` (default true, so the planner is unchanged); the finished editor passes false.
  - `deleteMeso` still deletes only the `v2_mesocycles` row, for a completed run only. The run copy's program and its marks stay, and History still needs the program's workout days.

### 193 Superset labels (A1, A2) on a finished program's week rows: SPEC Defaults 11 says supersets aren't in the history; TASKS 66 and board PR14 draw them (chunk 66)
**Ask:** should a finished program's structure rows show a superset's place ("A1 · 3 SETS", as built), or leave supersets out of the history entirely?
**Recommendation:** (a), leave them out, as SPEC says. A superset is stored once per run, on the run copy's program exercises (`superset_block_id`), not per week. So the label drawn on every week is the run's last grouping, and it can show a superset in weeks before it was made. For example, two exercises in the program from week 1 and linked by CHANGE THE PROGRAM in week 5 read A1 and A2 from week 1 on. The change is one line (`superset: null` from `structureOf` in `programHistory.ts`) and two test expectations. It can go in Adam's review pass with the D31 list (192).
**Blocks:** nothing. It is display only: no count changes, and nothing is written.
**Options:** (a) no superset labels on the rows (SPEC Defaults 11; recommended); (b) labels from the run copy's blocks, as built (TASKS 66: "A1/A2 for supersets as stored in `v2_week_plan_exercises` + the run copy's blocks"; the board's rows).
**Answer:**
**Evidence:**
- **SPEC.** Defaults 11 (confirmed by Adam on 2026-10-12): "Finished program history (C1) shows what the weeks store: exercises, their order, set counts and set kinds. Tempo, rest, supersets and the warmup routine are stored once per program, not per week, so they aren't in it."
- **TASKS and the board.** TASKS 66's scope asks for A1/A2 "as stored in `v2_week_plan_exercises`", but that table stores no grouping: only `v2_program_exercises.superset_block_id` does (027). TASKS' own absence test covers only the change list ("tempo and supersets never appear in the change list"). Board PR14 draws "A1 · 3 SETS" and "A2 · 2 SETS".
- **Which document wins.** TASKS' header says SPEC "decides behaviour and wins a disagreement", and SPEC says boards decide wording and "this spec wins". So the docs lean to (a). The builder followed TASKS and the board and escalated, as it should have. Whether a label is behaviour or wording reads both ways (Escalation 9), and it changes no number and no write, so it is listed here rather than sent back.
- **As built.**
  - A label is drawn only when both members are in that week (a one-member block is unlabelled: break H14).
  - The superset never makes a change item (break H4).
  - In week 4 of the board's world, Seated Cable Row reads "A1 · 3 SETS" without the changed highlight, where the board highlights it.

### 194 Chunk 46r's readings where 183 (a), its follow-ups, Q1, 184 (b) and 185 (c) give no single answer (accepted as built; none loses or wrongly writes data)
- What: chunk 46r's readings where Adam's words give no single answer, (a)–(f): a set added to the original card after its swap; one swap per card; where moved sets go when their exercise is already on a card; which card draws a set no list places; an open set added before 1.2 at a swap; two phones adding at once, then a swap. Each needs a second phone, a reload, a set added before 1.2 or a layout W5 doesn't draw, and in none is data lost or written wrong. Four of them are for 58a and 59 to build as recommended, and TASKS 59 was amended in 46r's review (the swap's skip carries `is_warmup` and an added set's place; a card of its own; one swap per card; an open set added before 1.2 stays on its card).
- Answer: (Adam, 2026-10-20) "194 accepted as listed (D31)." and "59's tightened scope agreed." So 58a and 59 build (a), (b), (c) and (e) as recommended, and TASKS 59's amended scope stands. Full text in HISTORY.md.
- Date: 2026-10-20

### 195 For 56: REVIEW keys an added set by its exercise and number, and two added sets of one exercise can now share a number (two cards)
- What: REVIEW keeps one item per key and keys an added set by session, exercise and number (`itemKey`, `review.ts`; 136). Since 183's follow-up ("each card is numbered on its own") and Q1's gaps, two added sets of one exercise can show one number on two cards, so REVIEW would show one item for two sets (recommended: (a), key an added set by its exercise and its place, `added_place` (174); a set logged before 044 keeps today's key by number).
- Answer: (Adam, 2026-10-20) "195 agreed for chunk 56." Option (a), written into TASKS 56's Scope and Verification; built in chunk 56 (#194, `dbfa314`). Full text in HISTORY.md.
- Date: 2026-10-20

### 196 Migration numbers after 045: 149's release data migration and chunk 59's swap column both had 046
- What: chunk 53 numbered 149's release data migration after 045 (so 046), and Adam's answer to 46r's Q5 gave 046 to chunk 59's swap column ("Waiting on Adam", 2026-10-20: the migration number clash; recommended: 149's file 046, 59's column 047).
- Answer: (Adam, 2026-10-20) "Migration numbers: 046 = 149's release data migration (chunk 53), 047 = swap moved-sets column (chunk 59). Record in DECISIONS.md and update SPEC, TASKS-1.2.md and any reference to "046 in chunk 59" or the release check range (now 042–047) in the next reviewer's docs PR." Written into SPEC.md (Weeks and copying, [P1.1] Existing data), TASKS-1.2.md (the numbering note, Process notes, Data model and its Migration summary, the order notes, chunks 53 and 59, Release steps 2, 3 and 5), CONTEXT.md and "For the release". 046 changes existing rows and stays out of step 5's add-only PR, which holds 047: so chunk 53 writes into Release where 046 goes for production to apply it in order (placement since: 202, step 5's PR).
- Date: 2026-10-20

### 197 An offline number patch has no queue item, and 58a writes the first one (pre-read, chunk 58a)
- What: how a `set_number` correction (178, and 61's and 62's renumbering) goes out offline, when the queue sends only whole-row upserts and deletes and `useUpdateSetLog` never queues (recommended: (a), a patch item on the queue).
- Answer: (Adam, 2026-10-20) "Agreed, with a condition. First check whether the existing whole-row save can carry the set-number correction offline; if so, use it. Add a "patch" queue item only if a whole-row save could overwrite something it shouldn't. Either way 58a is a DATA chunk (full review, break-prove the offline path)." Written into TASKS-1.2.md (58a). Full text in HISTORY.md.
- Date: 2026-10-20

### 198 A swap with no record (every swap before 047): how the workout draws it (pre-read, chunk 58a)
- What: 46r draws a swap from the record 047 stores, and a swap row from before it has none (recommended: (a), two cards as W5 lays them out, no sets moved, the replacement numbered on its own as 1.1 stored it).
- Answer: (Adam, 2026-10-20) "198, 200, 201: build as recommended." So (a). Written into TASKS-1.2.md (58a, 59). Full text in HISTORY.md.
- Date: 2026-10-20

### 199 Which cards offer "Swap for today": a second swap of a slot meets 025's unique index, and an added exercise's card lives on one phone (pre-read, chunk 59)
- What: a record that names the card a swap made, or an ADDED TODAY card, can leave a session another phone can't draw (recommended: (a), offer it only on a planned slot's card that no swap has touched, as today).
- Answer: (Adam, 2026-10-20) "Agreed: offer a swap only where today's app already offers it. Add to SPEC's swap section." So (a). Written into SPEC.md (Swap during a workout) and TASKS-1.2.md (59). Full text in HISTORY.md.
- Date: 2026-10-20

### 200 A swap's writes in order: today it skips the original's sets before it records the swap (pre-read, chunk 59)
- What: a swap refused or made offline leaves the original's open sets skipped with no swap row (recommended: (a), the swap's row with its record first, online, then the skips through the queue).
- Answer: (Adam, 2026-10-20) "198, 200, 201: build as recommended. 200 goes into SPEC: the swap row is saved before any set is skipped." So (a). Written into SPEC.md (Swap during a workout) and TASKS-1.2.md (59). Full text in HISTORY.md.
- Date: 2026-10-20

### 201 The finish warning, and auto-finish with it, don't see a swap's moved sets (pre-read, chunk 64)
- What: a set a swap moved is an added set of the new exercise (179), so 46r's `finishWarning` never lists it and auto-finish can complete the session with it open (recommended: (a), list a moved set whose record names a planned set).
- Answer: (Adam, 2026-10-20) "198, 200, 201: build as recommended." So (a). Written into TASKS-1.2.md (64). Full text in HISTORY.md.
- Date: 2026-10-20

### 202 Where 046 goes in the release: it changes rows, and step 5's add-only PR held 047 (chunk 53)
- What: once 047 is applied a deploy can never apply 046 (`check-migration-order.mjs`: a number at or below the last applied one stops the deploy), so 046 had to go before 047, after the backup and Adam's decision, and before the 1.2 app is live. The builder's options: (A) 046 joins step 5's PR (042–047); (B) three PRs, 046 alone; (C) swap the numbers 046 and 047.
- Answer: (Adam, 2026-10-20) "Option A: 046 joins step 5's migrations PR (042–047). It merges only after the manual backup and my explicit yes on 046; the merge is the consent. Update the build-process release steps and the check-migration range to match." Written into TASKS-1.2.md (the numbering note, Process notes, Data model and its Migration summary, File structure, chunk 53's Migration, Release steps 2 to 5), CONTEXT.md and "For the release".
- Date: 2026-10-20

### 203 A repeated workout edited differently in its sequence slots: 046 makes the program match the later slot (chunk 53)
- What: on a sequence run with a workout in two slots, 046 matches the program to the latest cycle's later slot (149's option (c): one slot's week decides), so the earlier slot's next cycle is planned from the program where 1.1 copied that slot's own week: the seed's Rotation A slot 1, cycle 3, gets Leg Press with no sets where 1.1 gave Back Squat with 2 (38 of the builder's 183 replay worlds). Keeping it would mean writing `replaces_program_exercise_id` on 1.1's week-only rows, guessing which row each one replaced.
- Answer: (Adam, 2026-10-20) "Option (a): accept the sequence-run case; 046 stays as built, with no swap-link guessing. Correct 149's SPEC line to describe the case (a repeated workout whose slots were edited differently in 1.1 plans the earlier slot's next cycle from the program; nothing stored is lost), and put it in the update notes. Add a release-checklist row: a read-only count of my runs (user 12e79b69-9891-4f53-a7cf-650edd83659f only) that hit this case, reported before my yes on 046." Written into SPEC.md (Weeks and copying → [P1.1] Existing data), "For the release" (an update-notes line and 046's line) and TASKS-1.2.md (RC44 and its query; Release step 3).
- Date: 2026-10-20

### 204 Staging was re-seeded with staging's seed.sql, not build/chunk-53's, so 046's staging rehearsal had no 1.1-shaped run (chunk 53; merge held)
- What: Adam's re-seed of 2026-10-20 (about 20:35 UTC) ran staging's own seed.sql, so `rehearse-046.mjs --staging` read 0 changes on staging-sequence where 046's rule says 7 on 6, and 53's merge was held (recommended: (a), a re-seed from build/chunk-53's `supabase/seed.sql`).
- Answer: (Adam, 2026-10-20) "204: re-seeded from build/chunk-53's seed.sql (option a)." Done about 21:53 UTC; the rehearsal then read 7 changes on 6 rows, 53 merged (#183) and staging showed exactly those after the deploy. Full text in HISTORY.md.
- Date: 2026-10-20

### 205 Chunk 54a's display choices and readings on Plan's week view (provisional, D31; accepted as built)
**Ask:** chunk 54a's choices where SPEC, TASKS and boards 1, 1a and 9 give no single answer are accepted as built. They are listed here for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. (a)–(i) and (n) are display; (j)–(m) are readings the review held against SPEC's and the boards' words, and none writes anything wrong or loses data.
**Blocks:** nothing.
**Options:** (a)–(n) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-54a-builder-1.md`, section 3), held against SPEC Screens → Plan screen, Targets, Set types and Warmup sets [1.2] and the boards in the review.
- (a) A warmup's picker eyebrow names its place among the exercise's warmups (`SET 01` for the first); a working set's names its place among the working sets.
- (b) The weight box is 16 px while it is typed in (the board draws 15 px; below 16 px iOS zooms the page).
- (c) The kind chip over a staged head (`DROPSET · 1 DROP`) is a button that opens the same picker as the row's ⋯.
- (d) A workout with no plan row this week draws its exercises from the run's copy, with no "+" and nothing pressable.
- (e) The old dim line for a removed working set (`RemovedSetRow`) keeps its 1.1 layout until 54b; it isn't aligned to the new row grid.
- (f) P1.2-11 as built: until 54b the old set-level marks stay on the new rows (the weight, reps and RIR cells, an added working set's number, a removed working set's dim line), as TASKS 54a's Scope says ("the old marks render on the new rows through the same `CHANGED_CELL` class until then"). The exercise-level and STRUCTURE marks went with that view. P1.2-11 itself reads "no change marks for one chunk".
- (g) A past week's rows keep their boxed cells, disabled, with no ⋯ and no "+": board 1c's flat rows are 54b's (read-only weeks).
- (h) Rows are numbered by their place among the working sets (board 1's W, 01, 02), so board 9's NOTHING SET, a lone set, reads 01 where the board draws 04.
- (i) The 1a picture (`design/1.2/built/1a.png`) is byte-identical to 1's: a stable week's cards and rows draw as a week-dependent week's do until 54b adds THIS WEEK ONLY and the legend.
- (j) Switching a set to Warmup leaves its stored RIR target: the row draws no RIR (G49), and the value shows again if the set is made Normal. 1.1's warmup toggle wrote the same (`is_warmup` alone).
- (k) A set type change is several writes, each sent after the one before is answered; the first refusal stops the rest, and the week is read again however it ends. Stages come off before a head becomes Normal or Warmup, and a head's kind is written before its stages are added. REMOVE THIS SET sends one delete per row, the stages (highest index) first, then the head, without waiting between them; the stages' foreign key cascades from the head either way. "+" waits while an add or a removal is out. A change cut short is proven on the stateful stand-in (`db.refuse`) to leave no warmup with stages, no stages under the wrong kind and no stages without a head.
- (l) Boards 1 and 1c draw RIR on a warmup row: built as SPEC's known gap says (G49: no RIR cell on a warmup row).
- (m) A weight is digits with at most one `.` or `,`: "5o", "12abc", "1e3" and a minus get "Enter a valid weight" and write nothing. That is board 9's own NOT A NUMBER example ("5o"); 1.1's editor (`parseFloat`) wrote 5, 12 and 1000. TASKS' "`WeightTargetEditor`'s behaviour kept" names kg stored, blank clears and "Enter a valid weight", which all stand.
- (n) The set type picker's rest rows ("Rest after this set", REST BETWEEN) appear once the sheet has read the exercise's program sets: on staging 0.5 to 3 s after a sheet first opens, and at once afterwards (the read is kept). The rest of the sheet draws at once.

### 206 Chunk 54b's display choices and readings on Plan's week view (provisional, D31; accepted as built)
**Ask:** chunk 54b's choices where SPEC, TASKS and boards 1, 1a, 1c, 1d, 9, 10 and 11 give no single answer are accepted as built. They are listed here for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. (a)–(i) are display; (j)–(m) are readings the review held against SPEC's and the boards' words, and none writes anything.
**Blocks:** nothing.
**Options:** (a)–(m) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-54b-builder-1.md`, section 3), held against SPEC Screens → Plan screen, Weeks and copying [1.2] and the boards in the review.
- (a) A session that is only in progress has no mark on its chip or in its header; ✓ is a done session's (boards 1, 1d, 10; SPEC: "done (read-only, board 11)"). TASKS 54b's staging line read "MON ✓ UPPER A (in progress)"; its wording is fixed.
- (b) The header's eyebrow names the week or cycle only when the open one isn't the current one ("THURSDAY · WEEK 1", board 10). Board 1c draws "TUESDAY" alone on a past week, so the two boards disagree; the menu's eyebrow always names it ("SLOT 3 · CYCLE 3").
- (c) A shared plan locked by another day's done session says READ ONLY in that day's header, with no ⋯. DONE is shown only on the day whose own session is done. A past week's session that was never started says nothing in its header; the week's lock line says it.
- (d) The legend is left out on a stable week with no usable last week (nothing to name). VOLUME and REVIEW are 55's and 56's.
- (e) Board 9's "DELOAD SESSION · NO CHANGE MARKS" (SPEC, Changes since the source; TASKS 54b's Scope) is read as the frame's caption, not as text the screen draws. On the board it is the 10 px mono caption above the sample block, styled like the board's other frame captions ("CHANGES SINCE WEEK 1", "ADDING A SET", "EXERCISE IN LBS"), as are board 10's ("ONE PLAN ON TWO WEEKDAYS", "OFFLINE"). A deload session draws no marks and no THIS WEEK ONLY; that is tested and break-proven. Drawing the line is one line in `SessionCard.tsx`.
- (f) The shared line sits under the session's name in its header (SPEC), not on the chip.
- (g) A removed exercise is a dashed card where it was, captioned "REMOVED SINCE WEEK N" (CYCLE on a sequence run). Where only the default is the source, the caption is "REMOVED THIS WEEK".
- (h) A rest slot is dimmed and opens nothing. The ⋯ is absent on a finished session, in a past week and on a locked plan.
- (i) A read-only row (a past week, a done session) is flat text, as boards 1c and 11 draw it, and a changed value on it is the accent text alone.
- (j) Board 1 marks the weight of a stage added with its set. Chunk 42's `changesSinceSource` doesn't: a stage new under a set that last week also had is the structure's to mark, so its number and reps are marked and its numbers are not. Built as the module does.
- (k) Board 11 draws "✓ DONE" only, so 1.1's "SESSION DONE — READ ONLY" line is gone. TASKS 54b's verification named `SESSION DONE`; its wording is fixed. DECISIONS 113 (a), a production check on 1.1's app, still names the old line.
- (l) THIS WEEK ONLY is not drawn in a past week, where CHANGE EVERY WEEK → would lead to a screen that changes later weeks only, or on a deload session, whose sets are calculated and would all differ from the default.
- (m) `MoveSessionControl` still reads its own day's session (`useSessionsInRange`) beside `usePlanSessions`: two reads of overlapping data, left so the move row's behaviour and tests stay put.

### 207 Past weeks keep their change marks, compared as they are now: a stable run's done week can be marked against a default changed later (chunk 54b)
- What: whether a stable run's past week, or a finished session, still shows change marks compared with the default as it is today.
- Answer: (Adam, 2026-10-21) "207: (b) accepted (no change marks on a stable run's past week or a finished session); record it as a display choice for my review pass." Option (b): "A stable run's past week and its finished sessions show no marks and no legend. Week-dependent ones keep theirs. This is one condition in `WeekView.tsx`." Built in his review pass after the release checklist, not now; SPEC's line is under "Changes since the source". Full text in HISTORY.md.
- Date: 2026-10-21

### 208 A session an UNMARK cut off part way keeps its saved copy and its flag; marking the week again leaves it marked but not deloaded (chunk 188f)
- What: whether a MARK on a session that an UNMARK cut off part way (it holds its saved copy and its deload flag) deloads it or leaves it as it is.
- Answer: (Adam, 2026-10-21) "212, 210, 208: keep as built; listed for my review pass." Option (a), as built: a session that holds a saved copy is left as it is (SPEC's "leaves it as it is"); UNMARK, then MARK, deloads it. Still on his review-pass list. Full text in HISTORY.md.
- Date: 2026-10-21

### 209 Chunk 55's display choices and readings on the VOLUME sheet (provisional, D31; accepted as built)
**Ask:** chunk 55's choices where SPEC, TASKS and board 3 give no single answer are accepted as built. They are listed here for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups). The one that touches what a column shows, P1.2-2's empty last week, has its own entry: 210.
**Recommendation:** accept all. (a)–(h) are display; (i)–(k) are readings the review held against SPEC's and TASKS' words, and none writes anything.
**Blocks:** nothing.
**Options:** (a)–(k) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-55-builder-1.md`, section 3), held against SPEC Volume per muscle [1.2] (14), Settings (14b), G51 and board 3 in the review. The sheet's numbers for the test account's week 3 were read live, read-only, in the review and equal an independent count row by row (TASKS 55's Staging list, corrected there).
- (a) Rows read `Chest` … `Hamstrings`, `Other` (the board's own words, sentence case; its subgroup rows are sample data, SPEC). The change chip is `--accent-muted` with `--accent` text (a tint isn't the accent: RULES), where the board's text is a darker accent in the light theme.
- (b) An empty last week (P1.2-2) shows "—" in last week's column, with no chip and no note: 210 says which weeks are empty.
- (c) Loading is the page's spinner under the column heads. A failed read is "Couldn't load last week." ("last cycle" on a sequence run), the real reason (SPEC Errors (15)) and TRY AGAIN; a failed read again after an answer keeps drawing the answer.
- (d) A read paused offline (TanStack waits for the network) reads as failed, with "You may be offline.", not as a spinner that never ends.
- (e) Two weeks with nothing planned read "Nothing is planned in either week." above the footer.
- (f) Every open reads last week's sessions again (`staleTime` 0; the cached answer shows meanwhile), and the read's key sits under the done list's, so a start, finish, skip or move refreshes it.
- (g) Where a log and a plan row name one exercise, the read's muscle group wins: Plan's joined copy can be minutes old.
- (h) The footer keeps the board's words ("Week N−1 counts the sets you actually did. …", the rule's own fraction) whether last week is over or still running; while it runs, a workout not done yet counts its plan (133), which the footer doesn't say.
- (i) This week's rows come from the open week's own query, not from `useAllWeekPlans` as TASKS 55's Scope says: the every-week list is read again after an edit only when a later week is planned, so right after + ADD SET it would show the week before the edit (RULES; break P03, re-run in the review). Last week's rows come from the list (week N−1). TASKS' Scope notes it.
- (j) The read names its columns (TASKS: `v2_sessions(*, v2_set_logs(*))`) and adds each log's `exercises(id, muscle_group)` (archived exercises too) and each session's `v2_session_set_changes(kind, week_plan_set_id)`, of which only `deleted` rows are kept, the only kind volume reads (chunk 44's carry note). That makes 55 the first app use of `v2_session_set_changes`, moved from `TABLES_AHEAD_OF_THE_APP` to `TABLES` in `verify-rls.mjs` (RULES: a first use by embed moves the name; both lists are probed the same way). `check-embeds-local.sh` resolves the new embed (29 of 29, the builder).
- (k) A session with no plan row (an offline start "without a plan") belongs to no week Plan draws and isn't read: the read is by last week's plan rows, as TASKS says.

### 210 VOLUME's empty last week (P1.2-2): a week with no plan sets and no session, not every week with no session (chunk 55)
- What: which weeks VOLUME's "—" for an empty last week (P1.2-2) is drawn for.
- Answer: (Adam, 2026-10-21) "212, 210, 208: keep as built; listed for my review pass." Option (a), as built: "—" only for a week with no planned set and no session; a planned week with no session shows its plan while it runs, and 0 with the "YOU PLANNED … DID 0" notes once it has ended (SPEC 14, 133). Still on his review-pass list. Full text in HISTORY.md.
- Date: 2026-10-21

### 211 Chunk 56's display choices and readings on REVIEW (provisional, D31; accepted as built)
**Ask:** chunk 56's choices where SPEC, TASKS and boards 1 and 4 give no single answer are accepted as built. They are listed here for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups). The one that changes which items are offered, a workout whose session this week is done, has its own entry: 212.
**Recommendation:** accept all. (a)–(g) are display; (h)–(m) are readings the review held against SPEC's and TASKS' words, and none writes anything wrong.
**Blocks:** nothing.
**Options:** (a)–(m) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-56-builder-1.md`, section 3), held against SPEC Review [1.2] (13), Defaults 4 and 10, G52 and How a save lands, and boards 1 and 4, in the review (`<scratchpad>/build/chunk-56-review-1.md`).
- (a) A read that failed, or that TanStack paused offline, draws no line; the sheet, if open, says "Couldn't load last week." with the real reason.
- (b) The pressed button reads USING…, ADDING…, REMOVING…, SWAPPING… or IGNORING… while its request is out; every button is off meanwhile.
- (c) With every item decided the sheet stays open, reading "Nothing left to decide." under "LAST WEEK · 0 THINGS", until it is closed; the line is gone.
- (d) A sequence run says LAST CYCLE and "last cycle".
- (e) A failed action keeps its item, with "Couldn't take this over." ("Couldn't ignore this." for IGNORE) over the real reason.
- (f) The line is board 1's: raised background, strong border, the caption and text on the left, "REVIEW →" in the accent on the right.
- (g) The board's negative margin on the explanation line is dropped (the sheet's first child clipped it).
- (h) ADD EXERCISE on a stable run: the done sets become the default's new sets (kind, drops, the done reps as the rep target; no weight, which the default never holds), and this week's rows take the done weights. On a week-dependent run REVIEW inserts this week's rows itself; a week already planned gets the exercise with no sets (How a save lands: "Week-dependent: no sets"), and a week planned later copies it from the week before. A session started or done gets no row ("a session in progress is left exactly as it is").
- (i) ADD EXERCISE goes after the exercise it followed in this week's plan, after the whole superset when that one is in one (191's rule), first when it followed nothing, and last when the run copy no longer holds the one it followed.
- (j) SWAP FROM WEEK N's N, and "from week N on", is CHANGE THE PROGRAM's button's week (`changeStartWeek`, the first session not started); the change itself runs with Plan's current week, as 51a's SAVE does. The two differ only when the current week's sessions are all done.
- (k) Each press reads the item's decision again first: one already there (another phone, or a reply lost after its transaction landed) sends nothing, and the item goes. A race past that read is the unique key's `23505` on `v2_week_review_decisions_item_uk`, read as decided; any other refusal shows as the item's error. One extra read per press.
- (l) A per-set action uses this week's plan as Plan holds it when pressed, not a fresh read: after a set was added to the same exercise on another phone, ADD THIS SET's new set can take a number a set already holds. One phone can't do it (every button is off while a request is out). CHANGE THE PROGRAM's two actions read the run copy fresh.
- (m) Two added sets in one place share one key, so they are one item, and deciding it decides both. A place repeats only when two phones add a set to one exercise at the same moment (46r's tie, 194); 195 (a) was asked about two cards, and keying by a log id instead is what 136 rules out.

### 212 A workout whose session this week is already done gets no REVIEW items (chunk 56; SPEC is silent)
- What: whether REVIEW still offers last week's differences for a workout whose session this week is already done (completed or skipped).
- Answer: (Adam, 2026-10-21) "212, 210, 208: keep as built; listed for my review pass." Option (a), as built: no items for such a workout (Plan locks a done session); its differences come back a week on. Still on his review-pass list. Full text in HISTORY.md.
- Date: 2026-10-21

### 213 REMOVE THIS SET in the stepped planner on a set that isn't the last, then + on SETS: two sets share one position (pre-read, chunk 67)
- What: step 3's REMOVE THIS SET on a set that isn't the exercise's last leaves its position empty, and the SETS stepper's + then added a set at a position another set holds (`setExerciseSetCount` appends from the count + 1; no unique key refuses it).
- Answer: (Adam, 2026-10-22) "213: agreed: + always adds after the highest position. Add to SPEC." Option (a): the gap stays, and + adds after the highest position (one line in `setExerciseSetCount`, built in chunk 67). SPEC: Stepped program planner, step 3; TASKS 67 amended. Full text in HISTORY.md.
- Date: 2026-10-22

### 214 The planner's START: start at once, as board PP5b draws, or open the start sheet (PR8), as TASKS 68's staging line says (pre-read, chunk 68)
- What: whether the stepped planner's START starts the run at once (today, saying nothing when another program is running) or opens the start sheet (PR8).
- Answer: (Adam, 2026-10-22) "214: agreed: the planner's START opens the start sheet; it never ends a running program silently. Add to SPEC." Option (a): START opens PR8 (`StartProgramSheet`) with this program picked; PR9's line and PR10's failure come with the sheet; PP5b's STARTING… and "Couldn't start this program." aren't drawn. SPEC: Programs and runs, Starting; TASKS 68 amended (its Scope and Staging lines agree). Full text in HISTORY.md.
- Date: 2026-10-22

### 215 The Library's "EDIT TAGS" and "UNTAGGED" name muscle tags, not cues: allowlisted or reworded? (pre-read, chunk 69)
**Ask:** chunk 69's `check-wording.test.mjs` fails on any user-visible "tag" outside Coach. The Library shows two: the EDIT TAGS view switch (`LibraryPage.tsx`) and UNTAGGED (`ExerciseTagList.tsx`). Both are about an exercise's muscle tags (SPEC Library: "muscle tags"), not the set tags that SPEC renames to cues. Should they stay, or be reworded?
**Recommendation:** (a). SPEC's "Tags are 'cues'" is about a set's tags, and calling muscle tags cues would be wrong. Apart from that sweep, the Library's look and wording are outside 1.2.
**Blocks:** nothing. 69 builds on (a), which is one allowlist entry documented in the script. (b) changes two strings.
**Options:**
- (a) Keep both, and name them in the script's allowlist as the Library's muscle tags.
- (b) Reword both without "tag" (for example EDIT MUSCLES and NO MUSCLE), and keep the script strict.
- (c) Use "cues" there too (EDIT CUES, NO CUES).
**Answer:** (Adam, 2026-10-22) "215, 216: for my review pass." Kept as recommended until then: (a).
**Evidence:** the sweep's own list (TASKS 69 Scope) names "tag" only in Plan, the workout and the planner, while its test greps every `.tsx` and `.ts` file under `src/` except Coach's. A grep on staging `30a7c42` finds these two and no other user-visible "tag" outside Coach. `STAGE` (`SetRow.tsx`) contains the letters but isn't the word, so the test matches whole words (TASKS 69, amended).

### 216 Chunk 58a's display choices on the workout's rows and rest bar (provisional, D31; accepted as built)
**Ask:** chunk 58a's choices where SPEC, TASKS and boards W1–W4 give no single answer, or where a board and SPEC differ, are accepted as built. They are listed for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups). The two things 58a's review found (a number patch that keeps failing is queued again on every refresh; the LAST line's source) are not choices: they went to a fix-forward builder run (`<scratchpad>/build/chunk-58a-review-1.md`), merged as #199 (`457acf1`); (k) and (l) are that run's choices.
**Recommendation:** accept all. (a)–(i) are display; (j) is the app's unit convention applied to the plan's weight.
**Blocks:** nothing.
**Options:** (a)–(j) below, each accepted or changed by letter.
**Answer:** (Adam, 2026-10-22) "215, 216: for my review pass." Accepted as built until then.
**Evidence:** from the builder's report (section 3) and the review's staging steps on `3081f46`, held against SPEC Logging mechanics [1.2] (Row states, C3, C5, C8), Supersets [1.2] and boards W1–W4.
- (a) An upcoming row shows its targets only ("32.5 kg × 10–12 @ RIR 2"), as SPEC's Row states say, where W1, W2 and W3b draw open boxes in every unlogged row; only the current set has LOG until chunk 60 makes every row typable (18a). On staging Today draws one LOG button.
- (b) W3b's "···" boxes while last time loads aren't drawn: the LAST line reads "LOADING LAST TIME…", and the boxes hold the plan's targets (empty on an added set), as 162 (a) says.
- (c) MEASURE SET TIME (W2): the ⋮ stays on every current row; before START SET the RIR box is left out (RIR comes after the set, and the row then fits 375 px); tapping the TIMING box brings every box back with the clock running; W2's dim "0"s in an empty LOG row aren't drawn.
- (d) A staged head's chip ("DROPSET · 2 DROPS") shows only while stages are still to come; logged drops carry their own kind word (DROP, REST-PAUSE, MYO-REPS, CLUSTER), as W3's last frame.
- (e) Kept as today until 59, 61 and 62, though not on the boards: "mark as dropset" and ADD STAGE, SKIP REST OF EXERCISE per card, a superset member's ADD SET and SKIP beside + ADD ROUND, the pen's inline edit with DELETE inside, FORM and SKIP THIS SET under ⋮, the unit label that flips one set's unit, and a warmup row's ✕.
- (f) The reps and RIR boxes are text boxes with a number keypad (`inputMode="numeric"`), not number inputs, whose spin buttons clipped "8–10" in desktop Chromium; the reps box is 56 px for five-character hints ("10–12", "AMRAP"), else 52.
- (g) Auto-finish's notice stays today's toast ("Session completed automatically", above the nav for 3 s) where W4's "FINISHED AUTOMATICALLY" frame draws a pill with a tick, "SESSION COMPLETED AUTOMATICALLY", in the rest bar's place: when auto-finish fires the session is finished and the workout is gone, and the toast is the app's one notice. Changing it would give the toast that look for this one message.
- (h) The LAST line shows last time's set in the unit it was logged in, with no unit word (W1 draws none): on staging the lateral raise, an lbs exercise, reads "LAST 9 × 15 @ 2" beside its 25.4 lbs box, because week 2's set was logged in kg.
- (i) The bar with no rest running and the current set out of view draws only the jump button (W4's "CURRENT SET BELOW · REST TIMER OFF"), and the button names a superset member by its label ("↓ B3") and any other set as "SET 03".
- (j) An untouched planned weight on an lbs exercise is stored as the shown lbs converted: on staging the lateral raise's 03, planned 11.5 kg and shown 25.4 lbs, was stored as 11.52 kg. That is the convention for any weight typed in lbs (RULES, chunk 43), and REVIEW compares as shown, so no item comes of it. The alternative stores the plan's kg while the box still shows it (`resolveEditedWeightKg`).
- (k) (the fix-forward, #199) The LAST line's failed state (the reference could not be read) is drawn on the current row only, as board W2 draws it under the open row, so a card does not stack one per upcoming row; it says W2's "COULDN'T LOAD LAST WEEK" with RETRY even when the line would have read a LAST TIME session, and its RETRY asks the reference again, as the panel's own RETRY does (both show while it is failed). Loading ("LOADING LAST TIME…", W3b) stays on the current and upcoming rows.
- (l) (the fix-forward, #199) After a last session in which every set was skipped, the LAST line reads the session the panel reaches back to ("LAST ACTUALLY TRAINED"), by the panel's own rule (`ExerciseReference.tsx`: the reach-back when the primary session holds no really-done set, `resolveReachBackAcrossRuns`, crossing runs, deloads out). The reviewer's reading: SPEC's "Last time" reference makes the reach-back part of the reference ("shown when the matched session's sets were all skipped"), and TASKS 58a says the line reads "today's `ExerciseReference` data", so the line and the panel agree; with nothing really done on record the line is empty.

### 217 Chunk 58b's display choices on the workout's header, "last time" and the offline states (provisional, D31; accepted as built)
**Ask:** chunk 58b's choices where SPEC, TASKS and boards W1, W4, W6, W16 and W17 give no single answer are accepted as built and listed for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. Each is display, or the reading of a board where it draws no state; none changes what is counted or written.
**Blocks:** nothing.
**Options:** (a)–(m) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-58b-builder-1.md`, section 3) and the review's reading of the dumps against the boards, on `61c8e50`, merged as #201.
- (a) N OF M SETS counts the rows the screen draws (`resolveRows`): M is every working head and drop, planned and added, warmups out; a skipped set stays in M and isn't in N. TASKS names `countCompletedSets`, which counts logs by the same warmup rule; N equals it on every fixture, and counting rows keeps N at most M and the header in step with the current set and the finish warning. On staging: "2 OF 13 SETS" with two working sets and a warmup logged.
- (b) The eyebrow's weekday is the session's effective date's (a moved session reads the day it was moved to, as Plan and "last time" do); no weekday while the session loads; a sequence slot counts from 1, as Plan's SLOT n does, and is left out when the plan row is missing.
- (c) The COACH button (Adam only) stays at the header's right, above the clock.
- (d) The couldn't-sync strip is the workout's own; Coach, History's session detail and the finished screen keep the notice's button (screens 1.2 doesn't rebuild keep their code).
- (e) A failed row keeps its pen, where W6 draws none (SPEC 18d: "A logged row shows a pen next to its tick"; the row's edit and delete would be unreachable otherwise); its status wraps under the numbers at 375 px.
- (f) The card line where no board draws the state: "FIRST TIME"; "LAST = ···" while loading; "COULDN'T LOAD LAST TIME" + RETRY; "LAST = SKIPPED EVERY TIME"; after a reach-back the line names the session the rows read ("LAST = 21 DAYS AGO"), not the skipped one; several days earlier this week: "· ALSO MON, TUE".
- (g) In the sheet, "Deload sessions are left out." and FULL HISTORY show in every state; OFFLINE · CACHED takes the first panel's day line (the board's offline frame).
- (h) The history icon opens the sheet (TASKS); `/exercise/:id` is FULL HISTORY, one tap further. Today's preview keeps the icon that goes there.
- (i) The panels' day line is the weekday and date only ("TUE 30 DEC"), where W17 draws the workout too ("PULL 1 · TUE 6 OCT"): the reference sessions don't carry the workout's name, and adding it is a read change (its embed and the offline cache).
- (j) W17's "ALL SKIPPED · NOTHING EARLIER" ("Nothing on record to compare against.") is mapped but can't be reached: an all-skipped session is itself one on record, so the reach-back returns `none_found` only when there is no earlier session at all. The board's other frame, "Skipped every time on record.", is built and captured.
- (k) The clock is m:ss with minutes past 59 ("48:12"; on staging's seeded session, started three days before, "3755:28"); the boards draw only times under an hour.
- (l) TASKS 58b's words that no longer fit: `exercisereference-lastweek-parity.html` and its test stay, because Today's session preview still draws `ExerciseReference` (now in `NOT_REBUILT`, its DROP badge back on `--base`, 154); the sheet's states are asserted in `lastTimeView.test.ts` and `LastTimeSheet.test.tsx`. And N comes from the rows, (a).
- (m) Not 58b's, seen in its pictures: the card header prints a muscle group's stored name ("REAR_DELTS"), where the boards say "REAR DELTS"; `ExerciseHeader.tsx` also serves Today's preview, so it is left for chunk 59's cards.

### 218 Board W1's row caption with the earlier-this-week numbers ("MON 17.5 × 15 @ 1" beside LAST) is not built (chunk 58b)
**Ask:** board W1 draws, on a row whose exercise was already done earlier this week, that set beside last week's: "LAST 15 × 17 @ 1" and "MON 17.5 × 15 @ 1". Neither 58a nor 58b built it. Should the row show it?
**Recommendation:** (a), in your review pass: one more span in the row's LAST line, from the earlier-this-week sessions `lastTimeView` already reads, at the row's place, warmups out; no new read, and a test with a break per pattern.
**Blocks:** nothing (display). SPEC's rule is met without it: the sheet's EARLIER THIS WEEK panel and the card line's "· ALSO MON" carry those numbers.
**Options:**
- (a) Add it to the row's LAST line.
- (b) Leave it out: the card line and the sheet carry it.
**Answer:**
**Evidence:** SPEC Logging mechanics [1.2], What a row shows (C4): "Each exercise shows last week's numbers and, when the exercise was already done earlier this week, those too (W16, W17)": it names the sheet's boards, not W1, and 162's "Last time's numbers show only on the row's LAST line" doesn't say which. TASKS 58a's Scope gives W1 its rows, and its fix-forward (#199) made the LAST line read the reference's primary session only; TASKS 58b's Scope lists the header, the strips, the line, W16 and W17, not W1's rows. Board W1 (`design/1.2/source/Workout.dc.html`, row B2: `also: '17.5 × 15 @ 1', alsoDay: 'MON'`) draws the caption. So it is a board element inside neither chunk's scope, and not a behaviour gap.

### 219 The re-seed of 2026-10-22 left the test account's weeks 2 and 3 without planned numbers (chunk 58b's review)
- What: after the re-seed of 2026-10-22, the first with 045 live, no planned set of the test account's weeks 2 and 3 had a weight, so `staging-smoke.mjs` read 50/51 and the staging steps that read the seed's numbers (59–64, the release checklist) waited.
- Answer: (Adam, 2026-10-26) "219: yes to (a), with diagnosis first." Seed fix 219 (#204, `508d5dd`): SEED-ONLY, the seed now copies weeks 2–3 by structure. His two read-only SELECTs (staging SQL editor, 2026-10-26, before the re-seed): `md5,length` → `4fd860804f9b9c4d07061065a7a45bb7,18581` (one md5 column shown, both being named "md5": it is `md5(prosrc)`, equal to the replay's, with the length, so staging's `v2_plan_week` body is the repo's 045: no drift); `week_number,sets,with_weight,matchable` → `1,39,39,0`, `2,39,0,39`, `3,39,0,39` (weeks 2–3 all linked to week 1 by `program_set_id`, so the old seed's copy could have matched: the cause on 2026-10-22 stays unconfirmed, the text that ran or its order, not the function; the new seed stops with a rollback if a copy writes nothing). Re-seeded 2026-10-26 with 046 pasted; chunk 59's review read weeks 1–3 numbered and the smoke 51/51. Closed. Full text in HISTORY.md.
- Date: 2026-10-26

### 220 Chunk 59's display choices on the exercise ⋯, the swap and the add (provisional, D31; accepted as built)
**Ask:** chunk 59's choices where SPEC, TASKS and boards W5, W10, W11 and W14 give no single answer are accepted as built and listed for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. Each is display (words, layout, which rows a sheet draws); none changes what is counted or written.
**Blocks:** nothing.
**Options:** (a)–(k) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-59-builder-1.md`, section 3), the review's reading of the dumps and pictures against the boards, and the real screens on staging (`3d2c7fa`, as the test account).
- (a) The skip line beyond W10's one case ("Set 03 and its drop will be marked skipped."): "Set 03 will…", "Set 03 and its 2 drops will…", "Sets 02 and 03 and their drops will…" (also when only one of them has drops: on staging the pushdown read "Sets 01 and 02 and their drops will be marked skipped."), and "The drop of set 03 will…" for a drop under a logged set. A warmup is named W1. A superset member's sets are named by number: on staging Seated Cable Row read "Sets 01, 02 and 03 will be marked skipped." beside its rows A1–A3.
- (b) SKIP N SETS counts every skip written, a drop included (the board's SKIP 2 SETS is set 03 and its drop).
- (c) The swap line's plural and empty case: "The 2 sets left move to Parallel Bar Dip. Next week's plan stays the same." (staging); with nothing open, "No set is left to move. X takes the place of this exercise today. Next week's plan stays the same."; before a pick, the plan's half alone.
- (d) The skip row is closed until it is tapped, and W10's expanded frame (CANCEL, SKIP 2 SETS) opens under it; the button reads SKIPPING… while the skips are written, and the sheet closes when they are.
- (e) The sheet's rows are 60 px targets; "Exercise history" closes the ⋯ and opens the card's last-time sheet (W16), the one its history icon opens.
- (f) The eyebrow counts the card's working sets logged over all it draws ("BACK · 2 OF 3 SETS DONE"): a drop is never a set of its own, a skipped set is not done, warmups are out; with no working set it is the muscle group alone.
- (g) The card's muscle line says what the swap or the add made it ("TRICEPS · SWAPPED FROM CABLE TRICEPS PUSHDOWN", "OTHER · ADDED TODAY", as W5), where the swap's name had a line of its own with an icon; the group is worded as the boards word it (REAR DELTS, 217 (m)). The ⋯ sits right of the history icon, which grows to 36 px beside it.
- (h) The pickers: the swap's "CABLE TRICEPS PUSHDOWN · TODAY ONLY" over "Swap for what?", opening on the replaced exercise's group; the add's "UPPER A · TODAY" over "Add an exercise"; both leave out every exercise already in the workout, a swap's replacement included. A refused swap shows "Couldn't swap." with the reason under the line over the button (offline on staging: "TypeError: Failed to fetch", the client's own message; "You may be offline." only when the error carries none). An add writes nothing, so its "Couldn't add the exercise." can't really show.
- (i) A card for an exercise added in the workout reads ADDED TODAY, also when its logs bring it back after a reload, and so does a pre-025 swap's replacement drawn as an extra card.
- (j) A set added to the swap's card after the swap (+ ADD SET there) shows no targets; the moved sets show the ones they had (164).
- (k) After a swap, the card the sets left keeps its header and LAST line with an empty body when nothing on it was logged (staging: Cable Triceps Pushdown).

### 221 Chunk 60's display choices on the log lock and the open rows (provisional, D31; accepted as built)
**Ask:** chunk 60's choices where SPEC, TASKS and boards W1 and W7b give no single answer are accepted as built and listed for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. Each is display or follows a SPEC line already there; none changes what is counted or written (a LOG, confirmed or not, stores the row's number, 151/170, break-proven).
**Blocks:** nothing.
**Options:** (a)–(i) below, each accepted or changed by letter.
**Answer:**
**Evidence:** from the builder's report (`<scratchpad>/build/chunk-60-builder-1.md`, section 3) and the review's reading of the code, the dumps and the W7b picture against the board (#208, `2fd23fa`).
- (a) A row that isn't in a superset is named "SET 04" in the sheet's eyebrow and on its button ("LAT PULLDOWN · SET 04", "LOG SET 04"), as 46r's `rowLabel` names it in the title ("Log set 04 before set 02?").
- (b) The line under the sheet's title keeps the sheet frame's 16 px rhythm (the board pulls it up 4 px).
- (c) The other open rows are drawn as board W1 draws them: the current row's boxes with no frame, a muted number, LOG outlined by an inset 1 px line (the same size as the filled one), and the cue as its compact CUE mark only.
- (d) The question is asked after the row has checked its numbers: a LOG missing reps shows the row's own "Enter weight and reps, or skip the set from ⋮." first and no question.
- (e) START SET (measure set time) is on the current row only (one set timer per screen); another open row logs with no set time.
- (f) The question is the row's own sheet: CANCEL, ×, a tap on the scrim and Escape leave the typed numbers and a running set timer as they were.
- (g) Every open row now has 58a's ⋮ with FORM and SKIP THIS SET (kept until 61), so SKIP THIS SET is reachable on any open row before 61, as SPEC C9 has the set's ⋯ "for upcoming and current sets"; a skip is not asked about (the lock is about LOG) and stores the row's number.
- (h) LOG on an unlocked drop that isn't the current set asks with 46r's words ("Log set 03 drop 1 before set 02?"); no board draws it (its screen test is owed: Tests owed, 60).
- (i) ADD STAGE and "mark as dropset" (an ad-hoc stage under a logged head) are not asked about, as today, until 62 replaces them with the set type picker.

### 222 An unlogged warmup row keeps 58a's accent (filled LOG, accent W) beside the current set's accent frame (chunk 60)
**Ask:** on a card that starts with an open warmup, should the warmup row still look primary (58a's accent W and filled LOG) while the accent frame sits on working set 01, the current set?
**Recommendation:** (b): draw an open warmup like any other open row (muted W, outlined LOG), so the screen has one primary row, the current set (G54: a warmup never takes part in the current set). One condition in `SetRowWarmup.tsx`; for your display pass, not now.
**Blocks:** nothing (display; which row is current and what LOG does are right and tested).
**Options:** (a) as built: the warmup keeps 58a's accent W and filled LOG, so two rows read as primary; (b) an open warmup is styled as a non-current open row; (c) the warmup just before the current set in its card keeps the accent, as board W2b ("WARMUPS AS ROWS") draws the first unlogged warmup in the accent frame.
**Answer:**
**Evidence:** board W2b draws the first unlogged warmup in the accent frame and working set 01 plain; SPEC Current set and G54 say a warmup never takes part, so 60 gives the accent frame and `data-current-set` to working set 01 (SPEC decides behaviour). `SetRowWarmup` (58a) is untouched. Board W1 draws the curl's warmup LOG outlined when it isn't the next row, which fits (b) or (c). The builder's report, 3(a), third point.

### 223 Chunk 67's display choices on the stepped planner's step 3 (provisional, D31; accepted as built)
**Ask:** chunk 67's choices where SPEC, TASKS and boards PP3, PP3b, PP3c, PP3d and PP6 give no single answer are accepted as built and listed for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. Each is display, or follows a line of TASKS 67 or SPEC that is already there. None changes what is counted or written: the writes are the existing `plannerService` functions in the order the table allows, and they are break-proven.
**Blocks:** nothing.
**Options:** (a)–(l) below, each accepted or changed by letter.
**Answer:**
**Evidence:** taken from the builder's report (`<scratchpad>/build/chunk-67-builder-1.md`, section 3) and from the review's reading of the code and of the PP3, PP3b and PP6 dumps against the boards (#210).
- (a) One workout is open at a time, the first by default. Tapping a closed card opens it and closes the other. The open card has no collapse control (PP3 draws none).
- (b) Exercises start closed. An exercise with no sets has no chevron (PP3: Dips).
- (c) The whole closed card is the tap target. The board draws only the chevron as the button.
- (d) A workout with no exercises opens to "NO EXERCISES YET". No board draws this, and the old step drew nothing for it.
- (e) A row's number is its rank among all of the exercise's heads, a warmup included (PP3's "01 12 WARMUP"; Plan numbers a warmup W). The picker's eyebrow uses the same number. After REMOVE THIS SET the rows that follow read one lower, and their stored positions keep the gap (213 (a)).
- (f) ALL's picker eyebrow reads "SET 01", as CHANGE THE PROGRAM's does. No board draws it.
- (g) The REST AFTER column is 132 px wide where the board has 150, so a warmup's chip fits beside its target at 375 px.
- (h) A stage row has no rest stepper, because the board draws none.
- (i) REST AFTER's + is disabled at ten minutes. The old stepper wrote 600 again.
- (j) Accessible labels: "Set 01: type", "Set 04 type: dropset, 1 drop", "Rep target for set 01", "Rep target for the dropset stage" (with " 2" and so on when there are several stages), "Rest after set 01", "Less / More rest after set 01", "Show / Hide set targets for X", "Show editor for X", "Fewer / More sets for X".
- (k) The staged chip and a changed REST AFTER draw their text in `var(--accent)` on `--accent-muted`. The board's darker accent-text token doesn't exist in the app. Text on a solid accent is still `--on-accent`.
- (l) Taps on the set type picker while a change is still being read back are ignored, not queued. The picker shows what the database holds.
- Readings held against SPEC and TASKS (none is a gap):
  - A warmup row offers all six types, because TASKS 67 has a staged kind on a warmup write `is_warmup: false` first. Plan's warmup row (G55) offers only Normal and Warmup.
  - The DROPS stepper's − removes the stage with the highest index, as Plan's does (54a).
  - Picking Normal on a plain set that still holds a stale `stage_kind` or `stage_rest_seconds` writes nothing. Picking Warmup clears those columns first.
  - Picking Dropset on a plain set writes `stage_kind: 'dropset'`, where the old ADD STAGE left it null.
  - REST BETWEEN is written by the ordered executor, `updateProgramSetStageRest` inside `applyProgramSetTypeOps`, so a pick and a rest change share one in-flight guard.

### 224 Chunk 68's display choices on the stepped planner's steps 1–2, its confirms and states (provisional, D31; accepted as built)
**Ask:** chunk 68's choices where SPEC, TASKS and boards PP1–PP2f and PP4–PP6 give no single answer are accepted as built and listed for your review pass after the release checklist (the 1.2 cost rule: listed, no follow-ups).
**Recommendation:** accept all. Each one is display, or follows a line of TASKS 68 or SPEC that is already there. None changes what is written. Every write is the hook and the arguments it was before the chunk. START goes through chunk 65's start sheet (214 (a)). The writes are break-proven (the review re-ran 40 of the builder's writer breaks, all caught).
**Blocks:** nothing.
**Options:** (a)–(k) below, each accepted or changed by letter.
**Answer:**
**Evidence:** taken from the builder's report (`<scratchpad>/build/chunk-68-builder-1.md`, section 3) and from the review's reading of the code and of the PP5 and PR8 dumps (#212).
- (a) The first workout is open to begin with, and one card is open at a time. A workout just added opens. This is the same choice as 223 (a) for step 3, except that PP2 draws a collapse control on the open card, so step 2 has one.
- (b) One exercise is open at a time. Its move arrows are on whichever member is open, and the write moves the whole superset as before (the old row showed the arrows on a superset's first member only). A block's SUPERSET REST is in the open member's panel (it was one row after the block's last member).
- (c) A day another workout holds is drawn dimmed, as the board draws it, and stays tappable. The write is unchanged: it takes the day from the other workout.
- (d) START is off while the runs have not been read, and says nothing. The sheet must know whether a program is running before START PROGRAM can be tapped (214: it never ends one silently). The sheet's list is the saved programs (`usePrograms` filtered to `kind = 'saved'`).
- (e) A failed add of an exercise is a line over the screen with the real reason ("Couldn't add <name>."), because PP2d draws none.
- (f) Subgroup names are in sentence case, as PP1 draws them (the app's labels are capitals; group names stay in capitals).
- (g) Text on the muted accent is `--accent`, because no darker "accent text" token exists. This covers the chosen FOCUS / DON'T CARE, a set REST or TEMPO, and the G14 button.
- (h) Warmup items lose their "01" numbers (the board draws none).
- (i) A mark that did not save keeps its error line until the next tap (it was a toast).
- (j) The slot sheet's eyebrow is the added slot's number for Add and the changed slot's number for Change.
- (k) A shut exercise row shows only REST, REST AFTER and TEMPO (the board's marks). A unit the exercise sets shows only inside the open row.
- Boards against SPEC (SPEC wins, as TASKS says, and SPEC already says so: no SPEC change):
  - PP5's "Couldn't load priorities" draws "Check your connection and try again.". PP5b and PP4b draw "Failed to fetch — you may be offline". Built as SPEC Errors (15) requires: the message the server or the client actually returned, and "You may be offline." only when the phone is offline and there is no message.
  - PP2f draws a warmup item being edited while the add field is open, and the two can't both happen: a tap from one to the other settles the first. It is drawn as two pictures, PP2f-edit and PP2f-add.
  - PP4 draws the danger confirm as a pale-red button. The shared `ConfirmDialog` draws it solid, as 189 and 192 accepted for PR6 and PR15.
- Layout the tests don't pin: the content area's padding is 20 px on step 1 and 16 px on the other steps (the builder's X9 survived; display only, so no test is owed).

### 155 The display follow-up's own display choices (provisional, D31)
- What: three display choices of the display follow-up (#135) with no exact word from Adam: (a) a picker switched to a segment the set doesn't have starts from the boards' examples (12 → RANGE 8–10, 6–9 → NUMBER 8); (b) the typed boxes (a number past the bounds held to the nearest one, an emptied box back to its number); (c) the cues sheet's rows keep wrapping a long cue.
- Answer: (Adam, 2026-10-16) "(a) changed: a picker switched to a segment the set doesn't have carries the set's own value over: NUMBER n → RANGE n–(n+2); RANGE a–b → NUMBER a. The boards' examples are used only when the set has no target at all. (b) and (c) accepted." So (a) changes, built in d31b (#162, `bc2de7c`); its AMRAP case and "the set's own value" are 180; (b) and (c) stand. No SPEC rule says what a picker's segment switch starts from, so (a) has no SPEC line (as 128's starting target). Full text in HISTORY.md.
- Date: 2026-10-16

### 154 Text on the accent in Coach, which is frozen: included or not? (the display follow-up)
- What: whether frozen Coach's 15 places with text on the accent (still `--base`) take `--on-accent`, and whether "wherever" also covers the screens 1.2 doesn't rebuild, which the display follow-up (#135) converted.
- Answer: (Adam, 2026-10-16) "no. Coach stays exactly as it is. --on-accent applies to the screens 1.2 rebuilds and the shared components they use; screens 1.2 doesn't touch keep their current code." Written into SPEC.md (Design boards → Scope of the look). Built in d31b (#162, `bc2de7c`): the 26 places on the screens 1.2 doesn't rebuild are back on `--base`, each as before #135, and Coach is untouched. Full text in HISTORY.md.
- Date: 2026-10-16

### 153 Chunk 43's fourth attempt: which of a set's two REVIEW items comes first (provisional, D31)
- What: the order of a set's two REVIEW items when its type was changed during the workout and it was then skipped or never logged (150 (b)); as built (#130), "Skipped" / "Not logged" first and the type item right after it.
- Answer: (Adam, 2026-10-16) "accepted." It stays as built. Full text in HISTORY.md.
- Date: 2026-10-16

### 151 UNLOG of a set that isn't the last one logged: what happens to the set numbers (chunk 46)
- What: what UNLOG does to the set numbers when the set isn't the last one logged; as chunk 46's second attempt built it, an open set showed the next number after the logged ones, so unlogging 02 of 01–03 showed two rows numbered 03 and logging it again stored a second set 3.
- Answer: (Adam, 2026-10-16) "not (a). An unlogged set keeps its number and its place. Logging it again stores it with that same number, so unlog then log is an exact undo (SPEC 18c). No other set's number changes on unlog. The open row shows its own number (a planned set's position; an added set's number from its draft), never "the next after the logged ones"." Written into SPEC.md (Logging mechanics → Unlog (18c)) and TASKS-1.2.md (chunks 46 and 63, the Data model's unlog row). Chunk 46 goes to its third attempt with it; chunk 63 writes it. Full text in HISTORY.md.
- Date: 2026-10-16

### 152 A warmup logged with no weight or reps, made a working set during the workout (chunk 46, for 62)
- What: what happens when a warmup logged with no weight or reps is made a working set during the workout, which 035's `v2_set_logs_check` refuses without both numbers (`23514`, executed).
- Answer: (Adam, 2026-10-16) "(a). Making a numberless logged warmup a working set asks for weight and reps in the panel first; type and numbers are saved in one write." Written into SPEC.md (Logging mechanics → Set type during a workout (19)) and TASKS-1.2.md (chunk 62's Scope and Verification). Chunk 46 is unchanged by it (only (c) changed the module). Full text in HISTORY.md.
- Date: 2026-10-16

### 150 A set whose type was changed during a workout and then skipped or never logged: a REVIEW item? (chunk 43)
- What: whether REVIEW also lists a type change made during a workout on a set that was then skipped or never logged, beside its "Skipped" / "Not logged"; as chunk 43's third attempt built it (`a62a20b`), it didn't, and a set the plan gave no weight or reps got no item at all.
- Answer: (Adam, 2026-10-15) "(b). A type change made during a workout is listed in REVIEW even when that set was then skipped or never logged, alongside its "Skipped" / "Not logged" item, and for everyone (13d) — also when the plan gave the set no weight or reps. Chunk 43's fourth attempt builds it; allowed." Written into SPEC.md (Review → Structural items) and TASKS-1.2.md (chunk 43's Scope; the Data model's session-change row). As (b) said, the item comes from the set's `retyped` row and its USE gives this week's matching set that type; a set deleted afterwards stays "Skipped" only (Adam's change-row rule: a later delete turns the row into `deleted`). Full text in HISTORY.md. Built: chunk 43, #130 (`95bbe46`), 2026-10-15; which of the set's two items comes first is 153 (D31).
- Date: 2026-10-15

### 149 Weeks a week-dependent run changed in 1.1's week view, and 143's copy (chunk 45)
- What: what the first copy under 143's rule (045, chunk 53, numbered 044 until 2026-10-19; production at the release) takes from a week a week-dependent run changed in 1.1's week view (a week-only exercise, an exercise removed from the week, a changed order), while the run's program never changed; as built, it follows the program's list and order.
- Answer: (Adam, 2026-10-16) "(c), as a release step, not during the build. One data migration at the release makes each active week-dependent run's program match its last planned week (exercises and order), so nothing the user sees changes. It touches existing rows, so: it's written and tested in chunk 53's scope as its own migration file, rehearsed on staging against a seeded 1.1-shaped run (add that shape to the seed if missing), with before/after counts and a fingerprint, and listed under "For the release" as a blocking decision with the manual backup before it. Chunk 53 is unblocked on that basis." Written into SPEC.md (Weeks and copying → [P1.1] Existing data), TASKS-1.2.md (chunk 53's Scope, Migration and Verification; Release, step 3) and "For the release". Full text in HISTORY.md.
- Date: 2026-10-16

### 146 Set numbers after a logged set is switched to or from Warmup (chunk 46)
- What: what a logged set switched to or from Warmup during a workout does to the working sets' numbers; as chunk 46 built it nothing was renumbered, so two rows could show the same number (executed probe).
- Answer: (Adam, 2026-10-15) "(a). A set switched to or from Warmup during a workout renumbers the sets as a delete does: the sets after it close the gap or move up one; chunk 62 writes it." Written into SPEC.md (Logging mechanics → Set type during a workout). Chunk 46 goes back to its builder with it, 147 and its behaviour finding. Full text in HISTORY.md.
- Date: 2026-10-15

### 147 A drop on its own during a workout: deleting a set's last drop, and unlogging a drop (chunk 46)
- What: (a) whether deleting a set's last drop on its own (board W8) makes the set a normal set; (b) whether a logged drop can be unlogged (SPEC 18c), and what its kept draft is keyed by.
- Answer: (Adam, 2026-10-15) "(a) yes, deleting a set's last drop makes it a normal set. (b) yes, a logged drop can be unlogged, under the same rule as any set: not while a later drop or stage of that set is logged. Its draft is keyed by its set's key plus its drop number." Written into SPEC.md (Logging mechanics → Delete set). Chunk 46 goes back to its builder with it, 146 and its behaviour finding; (a) is what chunk 61 writes, (b) what chunk 63 writes. Full text in HISTORY.md.
- Date: 2026-10-15

### 148 Chunk 46's display choices where SPEC and the boards give no wording (provisional, D31)
- What: the words of the log lock's question for a drop and of the finish warning for one set, one exercise's numbers and several exercises, which no board or SPEC gives (chunk 46, for 60 and 64).
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." No change below it names 148. Full text in HISTORY.md.
- Date: 2026-10-15

### 145 Split CONTEXT.md: the rules into RULES.md
- What: whether to move CONTEXT.md's two rule sections into a file of their own: rules are never pruned, and CONTEXT.md stood at 69.7 KB of its 75 KB ceiling with little left to prune that wasn't a rule (asked by the coordinator).
- Answer: (Adam, 2026-10-15) "yes, split it." Done: #117 (the two sections byte for byte; CONTEXT.md 71.3 → 34.0 KB; `check-context-size.mjs` unchanged) and #120 (`4fdcf69`, merged by the coordinator on your instruction: `.claude/agents/builder.md` step 1 reads RULES.md right after CONTEXT.md). Full text in HISTORY.md.
- Date: 2026-10-15

### 142 A CHANGE THE PROGRAM save on a session marked deload (chunk 45)
- What: what a CHANGE THE PROGRAM save does to a not-started session marked deload, whose saved pre-deload copy (`v2_week_plans.deload_restore`) UNMARK puts back whole; as chunk 45 built it, the save left that copy as it was, so unmarking brought back the sets of exercises the session no longer had.
- Answer: (Adam, 2026-10-15) "(a), narrowed. A CHANGE THE PROGRAM save also applies its landing rules to the saved pre-deload copy of a not-started deload session, so UNMARK restores the plan with the change in it. Migration 043's executor may write v2_week_plans for that one column only, as an update only: no insert or delete on v2_week_plans, no other column. A patch touching any other v2_week_plans column is rejected like a protected column, with a test." Written into SPEC.md (Programs and runs → How a save lands). Chunk 45 goes back to its builder with it (not a review failure); 043's one-column update is chunk 47's. Full text in HISTORY.md. Built: chunk 45, #125 (`ab1fc08`), 2026-10-15; 043's side (the SQL refusal and its test) is chunk 47's.
- Date: 2026-10-15

### 143 After a change, what a week-dependent workout's next week is copied from (chunk 45)
- What: how a CHANGE THE PROGRAM save reaches a week-dependent workout's later weeks when the session they copy from is already done or started; as chunk 45 built it, next week brought back a removed exercise, missed an added one and undid a swap.
- Answer: (Adam, 2026-10-15) "(a). A week-dependent week copied after a save follows the run copy's current exercise list and order: an exercise still in the program brings its sets from the source session as the copy rules say; a removed one is dropped; an added one arrives with no sets; a swapped one brings the old exercise's sets (count, kinds, stages, rep targets — as SPEC's swap rule). The link is the run copy's program exercise row: if the week's exercises already point at it and a swap updates that row in place, use that; add a stored link only if a swap deletes and re-inserts the row, and say which it was in the chunk report. Copying also goes in programChange/weekPlanning tests and in 044's [now 045's] rules, each with a break-proven test." Written into SPEC.md (Weeks and copying → Source, `week-dependent`). Chunk 45 goes back to its builder with it (not a review failure); 045's rules are chunk 53's. Full text in HISTORY.md. Built: chunk 45, #125 (`ab1fc08`), except the swapped case. Which it was: a swap inserts a new program-exercise row and soft-removes the old one (it deletes nothing and updates nothing in place), so the link is stored, in a new column, `v2_program_exercises.replaces_program_exercise_id`, that 043 adds (chunk 47), where the swapped case lands. Weeks that 1.1 changed in the week view: 149.
- Date: 2026-10-15

### 144 Chunk 45's display choices where SPEC and board PL1 give no wording (provisional, D31)
- What: CHANGE THE PROGRAM's texts board PL1 doesn't draw (chunk 45, for 51a and 51b): a sequence run says cycle; several done sessions in one sentence; a session in progress; a workout with no day before; "Week N" with nothing left to start.
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." No change below it names 144. Full text in HISTORY.md.
- Date: 2026-10-15

### 141 Which type changes made during a workout REVIEW lists (chunk 43)
- What: whether REVIEW lists (a) a set retyped during a workout to a stage kind whose drops or stages weren't then done, and what stage count its USE writes, and (b) a dropset whose head has no kind switched to Normal; as chunk 43 built it, neither was an item (its second review found (a) as a behaviour bug).
- Answer: (Adam, 2026-10-15) "(a) as recommended. Both cases are seen through the session's change rows; USE writes the stage count set in the workout; chunk 62 also writes a 'retyped' change row (keyed by week_plan_set_id) when a logged set's type changes. Chunk 43 may have its third builder attempt." Written into SPEC.md (Review → Structural items) and, after Adam's third batch (2026-10-15; the chunk 43 reviewer's note), into TASKS-1.2.md (chunk 43's and chunk 62's Scope, the Data model's session-change row). 042's `v2_session_set_changes` holds such a row as it stands (every insert and update executed on a scratch replay, 2026-10-15). Full text in HISTORY.md. Built: chunk 43, #130 (`95bbe46`), 2026-10-15.
- Date: 2026-10-15

### 140 Two builders at once
- What: whether the coordinator may run two chunk builders side by side in the 1.2 build.
- Answer: (Adam, 2026-10-15) yes, under these rules: only when TASKS-1.2's order notes allow both chunks now (their dependencies are merged) and the two share no files; at most one of the two has a staging check beyond the smoke; never while a migration chunk is unmerged, and never two migration chunks at once; each builder on its own branch off the current staging; reviews and merges stay one at a time, in TASKS order; the second chunk is rebased on staging after the first merges, and its reviewer re-runs every script on the rebased branch before merging; if a rebase conflicts, the chunk goes back to its builder with the conflict stated, which doesn't count as a failure. In CONTEXT.md ("Where chunks go") with the pairs that ran side by side; the first: 44's builder retry (main checkout) and 45 (a worktree), from 2026-10-15. 44 merged first (#113), so 45's reviewer rebases 45 on staging and re-runs every script on it before merging.
- Date: 2026-10-15

### 139 Chunk 43's display choices where SPEC and board 4 give no wording (provisional, D31)
- What: the wording of the REVIEW items board 4 doesn't draw (chunk 43, for 56): "Skipped" / "Not logged", type items, added sets, added exercises and swaps, units and RIR, the order of items and groups.
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." No change below it names 139. Full text in HISTORY.md. Built: chunk 43, #130 (`95bbe46`), 2026-10-15.
- Date: 2026-10-15

### 138 Re-seed staging on Monday 2026-10-19 (to-do)
- What: Adam's re-seed of staging on Monday 2026-10-19 (`supabase/seed.sql` pasted into the staging branch's SQL editor); until it, a staging check that needed open sets in the seed's in-progress session and found none was recorded "waiting on re-seed".
- Answer: done (Adam, 2026-10-19): "reseeded." Verified by effect in chunk 51a's review (2026-10-19): the test account's week 3 is the week of Monday 2026-10-19 (Monday's Upper A in progress, Wednesday's Lower A and Friday's Upper B not started, 9 LOG buttons on Today), and `staging-smoke.mjs` reads 50/51, its one failure the empty account's exercises: none until its first app sign-in creates the defaults (125). The checks waiting on it ran the same day. The smoke's log step, waiting since the display follow-up's review (chunks 47, 49 and 50 found no LOG button), ran on the deployed `0f9e281`: LOG on week 3 Upper A's bench set 3 (prefilled 80 kg × 5) took the test account's set logs 203 → 204, read back as the test account. After 51a's merge its own smoke logged Seated Cable Row set 1 (60 × 12): 204 → 205. Full text in HISTORY.md.
- Date: 2026-10-19

### 137 USE on a set planned AMRAP: does this week's set stay AMRAP? (chunk 43)
- What: whether REVIEW's USE on a set planned AMRAP whose weight differed writes the weight only, so this week's set stays AMRAP (as built), or the reps done too, so the set becomes a number.
- Answer: (Adam, 2026-10-15) "(a). Keep AMRAP; USE on a planned AMRAP set writes the weight only." Written into SPEC.md (Review → Number items); chunk 43 keeps it as built. Then (Adam, 2026-10-15, his third batch) "The two SPEC sentences narrowed by 137 (a) and 132: yes, reword them to state the answers, in the same docs-only way as 135." Done: SPEC.md's 13c and Actions USE sentences state it, in place of the line under 13c's USE, and so does chunk 43's Scope in TASKS-1.2.md. Full text in HISTORY.md. Built: chunk 43, #130 (`95bbe46`), 2026-10-15.
- Date: 2026-10-15

### 136 REVIEW item keys: may a key carry the session id? (chunk 43)
- What: TASKS 43 names the decision keys of three item kinds by last week's planned set (`num:` / `skipped:` / `type:<planned set id>`); chunk 43's builder put the session id in all six kinds, so the two sessions of a plan row that two weekdays share (G14) are decided apart; the key is stored in `v2_week_review_decisions` (`unique (week_plan_id, item_key)`).
- Answer: (Adam, 2026-10-15) "keys must never contain a set log id, and an added set is keyed by session, exercise and position. A session id in a key is expected and stable; it is not a break of the key shape." Chunk 43's keys stand: no key holds a set log id (asserted over every item of its fixtures), and an added set is `added-set:<session>:<exercise>:<position>`. Full text in HISTORY.md. Built: chunk 43, #130 (`95bbe46`), 2026-10-15.
- Date: 2026-10-15

### 135 SPEC and TASKS-1.2 lines written before 131's answer: amend them to defer to 131?
- What: whether to amend the five SPEC.md sentences and six TASKS-1.2.md places that, written before Adam's answer to 131, said otherwise for a past week nobody planned.
- Answer: (Adam, 2026-10-15) "yes. Change the 5 SPEC.md sentences and the 6 places in TASKS-1.2.md so they state what 131 decided rather than what it overrides. One docs-only commit by the next reviewer, no builder." Done: #111 (`0e8f25d`), chunk 43's reviewer. Full text in HISTORY.md.
- Date: 2026-10-15

### 134 Chunk 44's display choices where SPEC gives no rule (provisional, D31)
- What: VOLUME's two display choices (chunk 44, for 55): (a) a muscle gets a row only when it has sets somewhere, in the app's muscle-group order with Other last; (b) half a set on its own reads "½".
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." No change below it names 134. Full text in HISTORY.md.
- Date: 2026-10-15

### 133 VOLUME: what a missed workout of a week that is over counts (chunk 44)
- What: what VOLUME counts, once last week is over, for one of its workouts never done and never marked skipped (no session, a moved `planned` one, an `in_progress` one never finished); chunk 44 built "a session not done counts its plan" for every week.
- Answer: (Adam, 2026-10-15) "once the week has ended, a workout that was never done counts 0, the same as a skipped one. While the week is still running, a not-done workout counts its plan (SPEC: "sessions not done yet count their plan"). VOLUME shows what was actually done, consistent with 131 (a missed week is empty)." Built in chunk 44 (#113, `472fdb0`): `volumeRows` takes `lastWeek.ended`, required, which chunk 55 passes (true when Plan shows the current week or cycle, false on one planned ahead); a workout started and never finished counts the sets it logged, as (b) said. Written into SPEC.md (Volume per muscle (14)) and TASKS-1.2.md (chunk 55's scope). Full text in HISTORY.md.
- Date: 2026-10-15

### 132 Chunk 42's display choices where SPEC gives no rule (provisional, D31)
- What: five display choices in Plan's week rules (chunk 42, merged #109): (a) a box that differs from its source marked even when it is empty; (b) an unplanned current week's tile; (c) a warmup's RIR never marked; (d) THIS WEEK ONLY counting a stage's rep target; (e) "last week" for the marks.
- Answer: (Adam, 2026-10-15) "132 — accepted except: an empty box is never marked as changed. Only a value that is present and differs from its source is marked. A week planned forward therefore shows no marks until numbers are typed or copied in." So (a) changes (`changesSinceSource` in `weekPlanning.ts`, in the display follow-up); (b)–(e) stand. Then (Adam, 2026-10-15, his third batch) "The two SPEC sentences narrowed by 137 (a) and 132: yes, reword them to state the answers, in the same docs-only way as 135." Done: SPEC.md's "Changes since the source" states it. Full text in HISTORY.md.
- Date: 2026-10-15

### 131 G56: after a week off, Plan can't reach the current week (weekday runs)
- What: what Plan shows when a past week of a weekday run was never planned (neither Plan opened nor a workout started that week): SPEC's tiles stopped at the first unplanned week, so after a week off the current week, where Plan opens, lay beyond them; chunk 42's `weekTiles` stopped there.
- Answer: (b) (Adam, 2026-10-15): "The week tiles always reach the current week. A past week that was never planned shows NOT PLANNED, read-only and empty, with no PLAN FORWARD, and nothing is written for it. The current week copies from the last planned normal week, as the copy rules already say. REVIEW and VOLUME treat the missed week as a week with nothing in it." Written into SPEC.md (Weeks and copying → How far ahead); built in chunk 42 (#109, `d602dbc`, after a builder retry of `weekTiles`); the lines written before it that say otherwise: 135. Full text in HISTORY.md.
- Date: 2026-10-15

### 130 The exercise picker's choices where the boards differ or give no value (provisional, D31)
- What: thirteen choices in the one exercise picker (chunk 41, for 51a, 59 and 68), from (a) one look for every caller to (j) text on the accent `--base` and (m) a name with no space running past W11's line.
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." "128, 129, 130 — text on the accent: not --base. Use the near-black the boards draw (the app's text token that matches it), in both themes, wherever text sits on the accent colour." "128, 130 — an unbroken long word wraps inside its box (overflow-wrap: anywhere); nothing runs past its line." So (j) and (m) change (the display follow-up); the rest stands. Then (Adam, 2026-10-15, his third batch) "Text on the accent: add a new token --on-accent in global.css for both themes, set to the near-black the boards draw, and use it wherever text sits on the accent." Full text in HISTORY.md.
- Date: 2026-10-15

### 129 The cues sheet's choices where SPEC and board 8 give no value (provisional, D31)
- What: six choices in the cues sheet (chunk 40, for 54a and 61): (a) + NEW CUE's input; (b) a typed cue that matches one ticks it; (c) "Use for all" counts working sets; (d) text on the accent `--base`; (e) no length limit; (f) your cues have no storage of their own.
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." "128, 129, 130 — text on the accent: not --base. Use the near-black the boards draw (the app's text token that matches it), in both themes, wherever text sits on the accent colour." So (d) changes (the display follow-up); the rest stands. Then (Adam, 2026-10-15, his third batch) "Text on the accent: add a new token --on-accent in global.css for both themes, set to the near-black the boards draw, and use it wherever text sits on the accent." Full text in HISTORY.md.
- Date: 2026-10-15

### 128 The three pickers' display choices where SPEC and the boards give no value (provisional, D31)
- What: nine choices in the set type, rep target and RIR target pickers (chunk 39, for the screens from 51a and 54a on): (a) the stage stepper runs 1–10; (b) the rest steppers go 15 s a tap up to 10:00; (c) a segment picked with nothing to start from opens on the boards' examples; (d) the number boxes are steppers, not inputs; (e) "Use for all" isn't drawn under two sets; (f) a kind change keeps the stage count and the rest between stages; (g) text on the accent is `--base`; (h) the FROM box's border and the picked radio are `--accent`, REMOVE THIS SET `--error`; (i) a word too long for its line runs past it.
- Answer: (Adam, 2026-10-15) "128, 129, 130 — text on the accent: not --base. Use the near-black the boards draw (the app's text token that matches it), in both themes, wherever text sits on the accent colour." "128, 130 — an unbroken long word wraps inside its box (overflow-wrap: anywhere); nothing runs past its line." "128 — the number boxes in the rep and RIR pickers are inputs you can type into, with ± steppers beside them (decisions 6 and 17a: choose, then type). Same bounds as built." Then (Adam, 2026-10-15, his third batch) "128, the rest: accepted as built, except: a picker opens on the set's current target. The boards' example values (8, 8–10, RIR 2, 1–2) are only the starting point when you switch to a segment the set doesn't already have; nothing is pre-filled for a set that has no target until you pick a segment." "Text on the accent: add a new token --on-accent in global.css for both themes, set to the near-black the boards draw, and use it wherever text sits on the accent." So (d), (g) and (i) change and (c) is narrowed to his words, in the display follow-up; (a), (b), (e), (f) and (h) stand. The token is in SPEC.md (Design boards → Never pixel-match); no SPEC rule says what a picker opens on, so that change has no SPEC line. Which file holds the token's value, (g): (Adam, 2026-10-16) "accepted (tokens.css for the value, global.css for the mapping)." As built in the display follow-up (#135). Full text in HISTORY.md.
- Date: 2026-10-15; (g): 2026-10-16

### 127 The shared sheet frame's look where no token or board value decides it (provisional, D31)
- What: the look of `BottomSheet` (chunk 38) where no token or board value decides it: (a) the scrim black at 60 %, (b) the sheet `--surface` in the dark theme, (c) z-index 45.
- Answer: (Adam, 2026-10-15) "Accepted as built: 127, 129, 130, 134, 139, 144, 148, except the changes below." No change below it names 127. Full text in HISTORY.md.
- Date: 2026-10-15

### 126 Reviewer writes on staging: declined by the permission system in chunk 37's review
- What: whether reviewers' writes on staging as the staging accounts (every smoke logs one set; R2's calls in 47 and 53; the app checks from 51b) need a permission rule, after the permission system declined two of them in chunk 37's review.
- Answer: none needed, the condition (a second decline) did not occur: chunk 38's reviewer logged the smoke's set on staging (2026-10-15 00:08 UTC, bench set 3 in the in-progress session; the test account's set logs 203 → 204), which also runs chunk 37's unrun step. If a later reviewer is declined, it reopens. Full text in HISTORY.md.
- Date: 2026-10-15

### 125 The empty staging account now owns the app's 46 default exercises
- What: whether "empty" on staging means what a new account has after its first sign-in (the app's 46 default exercises) or no rows at all; `staging-smoke.mjs` reads 54/55 since chunk 37's review.
- Answer: (Adam, 2026-10-15) "accept them. The app creates the 46 default exercises when a new account first signs in; that is real behaviour. "Empty" means no programs, runs or sessions; the smoke asserts exactly that, and that the account's exercises are the defaults." Done in chunk 44's review (its docs PR; a verification-script change made by the reviewer): the smoke's empty account owns no programs, runs or sessions and exactly the app's `DEFAULT_EXERCISES`, read from the app's source, proven by `staging-smoke.test.mjs` and on staging (a throwaway exercise that isn't a default failed exactly that check; removed); 51/51 on staging. (Adam, 2026-10-19) "Smoke: since the re-seed, the empty account has no exercises until its first sign-in (125). The smoke accepts either no exercises or exactly the defaults; fix that check so it reads 51/51." Done in chunk 51b's second review (its docs PR; a verification-script change made by the reviewer): the check is now "no exercises, or exactly the app's defaults", and anything between fails; `staging-smoke.test.mjs` has both cases and four breaks (each caught, a comment-only control not); 51/51 on staging, and a throwaway exercise that is not a default, on an account with none, failed exactly that check (removed). TASKS-1.2's Seed table says so. Full text in HISTORY.md.
- Date: 2026-10-15; 2026-10-19

### 124 Re-seed staging after chunk 36
- What: run `supabase/seed.sql` (as on `staging` since #95) once more in the staging branch's SQL editor, so the stable, sequence and empty accounts and week 2 Upper A's differences exist on staging.
- Answer: done (Adam, said in the coordinator's session 2026-10-14). Verified by effect: `staging-smoke.mjs` 55/55 on staging (the coordinator at `f24a561`; chunk 37's reviewer at 22:35 UTC, before any app sign-in) and the four accounts sign in, through the API and the app; chunk 36's last staging step is run. Full text in HISTORY.md.
- Date: 2026-10-14

### 123 Postgres version: staging branch vs production
- What: the Postgres version of the staging branch and of production.
- Answer: both Postgres 17 (production 17.6, staging 17.11): same major version, minor releases only. Accepted, closed (Adam).
- Date: 2026-10-14

### 122 Rotate the Vercel bypass secret
- What: rotate the Protection Bypass for Automation secret, printed into the setup session's log by a Playwright error.
- Answer: done (Adam); the new secret is in this environment's `VERCEL_AUTOMATION_BYPASS_SECRET`.
- Date: 2026-10-14

### 121 Before the release: prove production's migration history
**Ask:** in your worktree `overload-v2-switch`, on an up-to-date `master`, check that `supabase\.temp\project-ref` holds production's ref, then run `npx --yes supabase@2.119.0 migration list --linked` (a Windows cmd line, read-only) and paste the output here. Expected: versions `000`–`041` in both the Local and Remote columns, 42 rows, nothing on one side only.
**Recommendation:** do it once before the release's migrations PR. **When:** any time before the release. Read-only (Management API, your login).
**Blocks:** the release's migrations-first PR to master.
**Answer:** (Adam, 2026-10-21) "121: give me the exact read-only command to prove production's migration history, as a Windows cmd line, and what output to expect. I'll run it myself." The coordinator gave him the command above on 2026-10-21; 121 stays open until he pastes its output.
**Evidence:** the project moved to the "business" org and its GitHub integration was reconnected on 2026-10-14. The docs-only merge #87 (`a3ffbe8`) produced a production deploy: one `Supabase Preview` run `success` in 4 s (10:57:55–10:57:59 UTC), two more left `in_progress` (the pattern seen since 027, Checks that lied #24), no output text. So a merge to master does run a deploy and it didn't fail; a full re-apply would have failed at once (`000` creates `public.exercises` with no `if not exists`). What GitHub can't show is that the history is intact: a partly lost history could re-run an idempotent file (e.g. 041's `create or replace`) silently. The deploy log (Dashboard → Branches → the production branch → #87's run) or `migration list` shows it; this environment can reach neither (supabase.com and api.supabase.com are blocked; no CLI link here by design).

### 120 Models for the 1.2 reviewer and builders
- What: which models run the 1.2 reviewer (coordinator and batch reviewers) and the builders.
- Answer: Adam's choice, recorded in the 1.2 build-process file in the project (models and effort for the coordinator, batch reviewers and builders). Nothing to do at setup.
- Date: 2026-10-14

### 119 Which database Vercel Preview deployments use
- What: whether every Vercel Preview deployment, not only `staging`'s, uses the staging database.
- Answer: yes, every preview deployment uses the staging database (116 (g)).
- Date: 2026-10-14

### 118 A second synthetic account on staging for verify-rls
- What: a second synthetic account so verify-rls's foreign-row probe can catch a leak on staging.
- Answer: yes, in the seed: `staging-other@example.com` (random password nobody knows) owns a program, run, session, logs, a note and a mark. On the local stack verify-rls passes, and with RLS off on `v2_programs` it reports both probes as LEAK.
- Date: 2026-10-14

### 117 How the reviewer's browser reaches the staging app
- What: the route past Vercel's login for the reviewer's browser on staging.
- Answer: (a) Protection Bypass for Automation; the secret goes in this environment's `VERCEL_AUTOMATION_BYPASS_SECRET` (116 (e), (i)).
- Date: 2026-10-14

### 116 Set up staging in the dashboards (Adam's list)
- What: the dashboard steps (a)–(k) for staging: the persistent Supabase branch, sign-ups off, the test account, this environment's secrets and allowlist, Vercel env vars (all preview branches) and domain, the bypass secret, the `staging` ruleset (no bypass actor).
- Answer: done by Adam 2026-10-14; (k): `[remotes.staging]` (#90, fixed in #91), seed numbering (#92); staging verified end to end (CONTEXT.md, "Staging verification"); open: 122, 123.
- Date: 2026-10-14
### 115 Hotfix: starting a run fails in production (pg-safeupdate) — merge 041 (#85)
- What: 041 re-creates `v2_copy_program`, `v2_plan_week`, `v2_make_week_default` with ` where true` on 7 bare temp-table deletes that pg-safeupdate rejected.
- Answer: merged by Adam (#85, `6e5f654`); `Supabase Preview` success on the merge commit (2026-10-12). Full text in HISTORY.md.
- Date: 2026-10-12

### 114 Sync queue: writes to the same record keep their order (#83)
- What: the open item from the fix session. A failed queued write no longer lets later writes to the same record overtake it: it holds back every later write to that record until it succeeds; a set log is also held behind its session row and a stage behind its head (they would only fail on the foreign key); other records still go. Retry limit 5 failed passes (was 3; one attempt per flush pass: reconnect, app start, finish, retry tap). After that the write stops retrying but stays queued (`gaveUp`, never deleted, was dropped before) and `SyncFailedNotice` shows "N changes couldn't sync. Tap to retry." on its session's workout, finished and History screens, `/coach` for a note with no session; reloaded on app start.
- Answer: merged by the reviewer, migration-replay green; no migration, no data change. Test that failed on master: two edits to the same set, the first fails once, the server ends with the second. D30: the notice renders nothing without failures; frozen fixtures untouched, D30 tests unmodified and passing. Live check: 113 (f).
- Date: 2026-10-11

### 112 A finished session's rows in Plan on a shared (G14) row (provisional)
- What: when a finished session's rows lock in Plan on a plan row two weekdays share (#77); provisional: if any session on that row is completed or skipped, the row is read-only for every weekday that shares it.
- Answer: (Adam, 2026-10-15) "Accepted as they stand in 1.2: 82, 83, 85, 86, 112." Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 111 Fix session: B3 offline, Plan read-only, B6, B5, B4 merged (#72–#81)
- What: live-app fixes, no features, each its own PR with a failing test first, merged by the reviewer once green; code only, no migration, no write to existing data. B3 (offline): #72 session start sends a client id (a re-tap after a lost reply returns the row that landed); #73 one sync-queue flush at a time; #74 nine plan mutations in `useWeekPlan.ts` `networkMode: 'always'` (the eight named plus `useReorderWeekExercises`); #75 an online finish sends the queue first and queues behind unsent writes; #78 an offline finish classifies from every known log and is re-derived from the server on replay. #77 Plan: a completed or skipped session's rows are read-only (112). #79 B6: `apply()` single-flight. #80 B5: deload restore with a deleted program set (the set returns without the link; a session already left part-empty is fixed by unmarking it again). #81 B4: `ignoreCommand` compares with the last deployed commit, 166 characters (D28 updated).
- Answer: D30 parity proof for the finish changes (#75, #78): the frozen master render fixtures are untouched and `GymSession.d30`, `RestTimer.d30`, `GymSession.renderParity`, `GymSession.offline` pass unmodified; the empty-queue finish writes the same payload as master. Not changed, noted in CONTEXT.md Open items: a queue item that fails transiently is skipped and later items still replay. Not verified here: the new `ignoreCommand` on a real Vercel push (113e).
- Date: 2026-10-11

### 110 Two program-tab conveniences with no one-to-one equivalent in Plan (provisional, D31)
- What: the one-tap ALL SETS rep target and turning an existing set into a warmup, after the program tab's removal (chunk 33); provisional: leave as is (both reachable per set, then Make default).
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 110 (the shared pickers' "Use for all" and Warmup type replace it)." Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 109 Chunk 33's wording and placement (provisional, D31)
- What: chunk 33's wording and placement: START disabled with its line under it; Plan's "NO WORKOUTS SCHEDULED" + "Programs →"; the deload line under the deload button; the refusal "THIS PROGRAM IS A RUN'S COPY".
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 109 (PR11, PP5, board 1e), …" Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 108 TASKS-1.1 chunk 33 merged: the program tab is removed (#70)
- What: chunk 33, code only. Passed review first time: reviewer's checks green; independent review (own worktree) caught all 14 adversarial breaks and confirmed every data-changing capability of the old tab is reachable (Structure, Make default) or fixed for the run per SPEC, and that dropping StepVolume's removedAt filter is safe (only the planner mounts it; it refuses run copies; only `v2_make_week_default` writes `removed_at`, to run copies). Planner tests changed only where the chunk removes or requires behaviour.
- Answer: merged by Adam (`a75d681`), all checks green. Provisional 109, 110 (D31). Pre-existing, not changed: an override of `{}` (CUSTOM with every rule off) reads as null on the client, so Plan's line, marking and the planner treat it as "use my default"; Plan's no-schedule line doesn't wait for the sequence read (can flash briefly, as on master).
- Date: 2026-10-11

### 107 TASKS-1.1 chunk 32's code merged without the apply-ahead offer (#69)
- What: chunk 32's code. Review history: first push failed (false swap; warmup/working mix-up); retry fixed them but a behaviour bug remained (a set could become warmup and staged) → blocking 105; Adam allowed one final round; that round failed again (duplicate stage_index; stale stage kind) → shipped per 105 option (b) without the offer (known gap 106). The shipped code: the action, confirm, RPC, refresh, toasts, StepVolume's removedAt filter; `applyAhead.ts`, `useWeekPlan.ts`, `weekPlanService.ts`, `ApplyAheadOffer.tsx` byte-identical to master. Absence test (real hooks and banner) proves no write to any other week; gating/confirm/error/networkMode/filter break-proven; reviewer's own break caught.
- Answer: merged by the reviewer, `243410a`. Display choices (provisional, D31): labels MAKE THIS WEEK/CYCLE THE NEW DEFAULT; confirm "Make week N the new default?" / MAKE DEFAULT; toast "Week N is now the default." (+ a note when deload or empty sessions kept their default).
- Date: 2026-10-11

### 106 Known gap: no "Apply this change to planned weeks ahead" after "Make this week the new default" (chunk 32)
- What: SPEC (Weeks and copying [P1.1]) says making the default "then offers the existing Apply this change to planned weeks ahead … only where they still match the old default". Chunk 32 ships without that offer, per Adam's answer to 105: the fix round (933f2a1) passed its own claims but the independent review found two more wrong writes (two stages added under one head in one apply could share a stage_index; a stage added to a stageless head that still stores an old stage kind kept that kind instead of the new default's). Later weeks already planned keep their content; weeks planned afterwards start from the new default.
- Answer: shipped without the offer (Adam, 2026-10-11, option b of 105). The removed mapping is recoverable from `build/chunk-32` at `933f2a1` (diffDefault, pointed ops, exact-link swap pairing, whole-head-kind gates) for a later revision; the two findings above are what it still needs.
- Date: 2026-10-11

### 105 Chunk 32's code failed review twice: apply-ahead can write a set that is both warmup and staged
Severity: blocking
Chunk: TASKS-1.1 chunk 32 (code; branch `build/chunk-32` at `066a261`, not merged; migration 040 is merged and live and unaffected)
**Ask:** Allow one more fix round for chunk 32's code (a behaviour fix plus its proofs), or decide otherwise?
**Options:**
(a) One more round by the same builder, scoped to the bug below: treat a head's kind as ONE part (working / warmup / staged + resolved stage kind). A `warmup`, `stageKind` or `addStage` record applies to a later week only where that head's whole kind still equals the old default's; compare stage kinds resolved (null = dropset) everywhere; pair a swapped slot's sets by the exact pre-call links (source set → old program set → new program set) instead of ordinal within kind. Then the reviewer re-verifies as before.
(b) Ship chunk 32 without the apply-ahead offer after making the default (the action alone; later planned weeks stay as they are and pick the default up only when re-planned). Deviates from SPEC ("it then offers the existing Apply this change to planned weeks ahead"), so it's yours to accept.
(c) Merge as is. Not recommended: it can write invalid data to planned weeks.
**Recommendation:** (a). The fix is local (three record branches in `applyAhead.ts` plus the swapped-slot pairing in `makeWeekDefault.ts`), the rest of the chunk passed two independent reviews, and (b) drops a SPEC behaviour.
**Blocked until answered/done:** chunk 32's code merge, and chunk 33 (it removes the program tab, whose stable-volume editing chunk 32 replaces).
**Answer:** (Adam, 2026-10-11) (a): one more fix round by the same builder, as described. If that round fails again for any reason, ship chunk 32 without the apply-ahead offer after "Make this week the new default" (option b), note it in DECISIONS as a known gap, and continue with chunk 33. Don't come back to Adam for this chunk again.
**Evidence:**
What happened:
- First review (two independent lenses) failed the first push on two data bugs: a "remove the last exercise, add one" read as a swap (moving the removed exercise's weights onto the new one in later weeks), and a swapped slot's sets paired across warmup/working. Plus smaller gaps. The builder's one retry fixed all of them; the reviewer's own break (position-only swap pairing) fails 8 tests; the independent retry pass confirmed every retry claim (13 of 14 breaks caught, the 14th equivalent).
- The same pass found a bug the first review missed (present since the first push): the `warmup`, `stageKind` and `addStage` records each check only the field they write. Scratch cases: (1) old default makes head h a warmup; a later week had turned h into a dropset with its own stage → it gets `isWarmup: true` (a warmup with a dropset kind and a stage). (2) old default stages h as a dropset; a later week had made h a warmup → it gets `stageKind: 'dropset'` plus a stage under the warmup. (3) old default adds a stage to a dropset; a later week changed h to myo_reps, or to a warmup → a stage is added under it. The app never otherwise allows a set that is both warmup and staged (`updateSet` notes PlanPage never offers WARMUP on a staged head).
- Minor, same pass: `stageKind` compares raw kinds while `removeStage` treats null as dropset, so half a head's change can apply; a swapped slot that deleted a middle set pairs later weeks' sets by order, moving rep targets (and so the weights shown against them) onto neighbouring sets; a swap that was then moved is read as removal + addition (deliberate, documented).
A competent default would: send it back for another fix — doesn't apply because your rule says a second failure that is a behaviour bug escalates as blocking.
Cost of deferral: n/a (blocking). Nothing is live: the action isn't on master, so no planned week has been written by it.

### 104 How differences from the week's source show (provisional, D31)
- What: how Plan's highlighting draws a difference from the week's source (chunk 31): changed cells, added sets, added, moved and removed exercises, removed sets, a changed kind.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 98, 99, 102, 104 (Sets/Structure views, Make default and their highlighting removed; 1.2's change marks replace 104), …" Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 103 TASKS-1.1 chunk 31 merged: differences from the week's source highlighted (#68)
- What: chunk 31, code only. First independent review failed: an added set was "marked whole" (weight and RIR highlighted on week 1, against G34, and on stable weeks against "weights and RIR against last week"); several rules unproven (stable weights source skipping deload/empty weeks, a stage's RIR and reps, a partly-deload week). The one retry fixed and proved them; 51 earlier breaks re-run, all caught; the reviewer's own break caught.
- Answer: merged by the reviewer, `f07da39`. Provisional 104 (D31). Note: warmups are in the set position (G23 reading), so a warmup added above shifts every later set's comparison.
- Date: 2026-10-11

### 102 How run-wide fields show in STRUCTURE (provisional, D31)
- What: how run-wide fields (rest, tempo, unit, stage rest, the warmup routine) show in Plan's STRUCTURE view (chunk 30).
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 98, 99, 102, 104 (Sets/Structure views, Make default and their highlighting removed; 1.2's change marks replace 104), …" Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 101 TASKS-1.1 chunk 30 merged: run-wide fields in Plan's STRUCTURE view (#67)
- What: chunk 30, code only. Independent review of the first push: 40 of 47 adversarial breaks caught; one regression (shared `usePrograms.ts` hooks stopped returning their invalidation promise, so the link toggle's `isPending` guard cleared early, in the planner too). The one retry fixed it and added the missing proofs (a superset member's set rests, run-wide writes on a sequence run's repeated workout, the week-cache restore); 129 breaks re-run, all caught; the reviewer's own two breaks caught.
- Answer: merged by the reviewer, `adc059f`. Provisional 102 (D31). Note for Adam: a swapped-in exercise keeps the replaced row's superset block (G35 reading), so editing that block's round rests, or linking the swapped-in exercise to a neighbour, changes the run's grouping (run-wide by SPEC).
- Date: 2026-10-11

### 100 TASKS-1.1 chunk 32's migration 040 merged (#66)
- What: `v2_program_sets.removed_at`, `v2_plan_week` skipping removed sets, `v2_make_week_default`. Builder's battery (114 verdicts, 29 break variants) re-run by the reviewer; D29 scratch-copy check re-run (no row changes); two independent reviewers with their own fixtures (correctness; safety, RLS, atomicity, concurrency) found nothing blocking. Empty sessions skipped like deload (provisional 99).
- Answer: merged by the reviewer under D29, `632959d`. Deploy succeeded (Supabase Preview); live probe 040.json and live check-embeds 30/30 pass.
- Date: 2026-10-10

### 99 Make-default: an empty normal session is skipped like a deload (deferred)
- What: whether "Make this week the new default" (migration 040) takes a normal session with no exercises as its workout's default or skips it like a deload; provisional (a): skipped.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 98, 99, 102, 104 (Sets/Structure views, Make default and their highlighting removed; 1.2's change marks replace 104), …" Full text in HISTORY.md.
- Date: 2026-10-15

### 98 Plan's SETS / STRUCTURE details (provisional, D31)
- What: Plan's SETS / STRUCTURE details (chunk 29): which view it opens on, what is kept across switches, what a row shows.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 98, 99, 102, 104 (Sets/Structure views, Make default and their highlighting removed; 1.2's change marks replace 104), …" Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 97 TASKS-1.1 chunk 29 merged: Plan's week in SETS / STRUCTURE views; COMPACT removed (#65)
- What: chunk 29, code only. Handlers unchanged (builder's 30-flow master/branch replay byte-identical). Independent review: scope and capabilities clean; 54 of 60 reviewer breaks caught on the first push; the tests-only retry (interrupted once by a container restart, resumed) pinned the other 6, two re-checked by the reviewer.
- Answer: merged by the reviewer, `3a94ae5`. Provisional 98 (D31). COMPACT's removal supersedes D6's compact view (entry 80).
- Date: 2026-10-10

### 96 TASKS-1.1 chunk 35 merged: a sequence run's current cycle (#64)
- What: chunk 35, code only. First review failed (a cold load could auto-plan the calendar week on a sequence run before programs loaded; COPY LAST CYCLE and per-control past-cycle gates were unproven; a failed read spun forever). The builder's one retry fixed all three; the reviewer's breaks (cold-load wait removed: 4 fail; copy gate at cycle−1: 2 fail) confirm.
- Answer: merged by the reviewer, `f5fe217`. Provisional 94, 95 (D31). Not changed (pre-existing class): an open weight editor still commits after a refetch moves the cycle past it.
- Date: 2026-10-10

### 95 Plan when a read fails with nothing to show (provisional, D31)
- What: what Plan shows when a read fails with nothing to show (chunk 35); provisional: "COULDN'T LOAD PLAN" / "Check your connection and try again.", and nothing is planned.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 94 and 95 (board 12 and the Errors rule), …" Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 94 Plan while its reads are out (provisional, D31)
- What: what Plan shows while its reads are out (chunk 35); provisional: the existing spinner until the reads it needs answer.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 94 and 95 (board 12 and the Errors rule), …" Its only text was its "Waiting on Adam" line, now in HISTORY.md.
- Date: 2026-10-15

### 93 TASKS-1.1 chunk 34 merged: stable weeks pair weights by set kind (039, #63)
- What: chunk 34, migration 039 only (`v2_plan_week` replaced). Passed review first time: the builder's scratch proof re-run by the reviewer, plus an independent fixture of 7 adversarial cases; 039 changed no existing row.
- Answer: merged by the reviewer under D29, `1c81818`. Deploy succeeded (Supabase Preview); live check-embeds 30/30.
- Date: 2026-10-10

### 92 TASKS-1.1 chunk 28 merged: priorities view-only in Plan (#62)
- What: chunk 28, code only. Passed review first time (reviewer re-ran every check and one break: a mark-named button beside a label fails 7 tests).
- Answer: merged by the reviewer, `0304a23`. Provisional display choices 90 and 91 (D31).
- Date: 2026-10-10

### 91 Plan's priorities: how a mark shows (provisional, D31)
- What: how a run's mark shows on Plan's view-only priorities screen (chunk 28); provisional (a): the accent label on the row only where a mark is stored, nothing on a subgroup that only inherits it.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 91 (PR5), …" Full text in HISTORY.md.
- Date: 2026-10-15

### 90 After START, the Programs page opens the run's priorities, now read-only (provisional, D31)
- What: whether START on the Programs page should still open the run's priorities, now read-only (chunk 28), or open Plan; provisional (a): leave it.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 90 (START lands on Plan, B9), …" Full text in HISTORY.md.
- Date: 2026-10-15

### 89 TASKS-1.1 chunk 27 merged: "only this week" removed (code #60, migration 038 #61)
- What: chunk 27, code first then 038 (P3). The first review failed (a stage-copy write no test pinned; a swap/reorder on a row the week no longer has stopped failing before writing); the builder's one retry fixed both.
- Answer: merged by the reviewer. Code `1f6816f`; 038 `70399ca` under D29 (check-migration exit 1, function only; replay, embeds and the scratch row check green). 038's deploy succeeded (Supabase Preview); live check-embeds 30/30. No live-app check: this container can't reach the app (31); it's in Adam's step 5 review.
- Date: 2026-10-10

### 88 G45: a set's own rest on a set with no program set of its own exercise
- What: TASKS-1.1 G45: can a set added in a week, or a set of an added or swapped-in exercise, have its own rest?
- Answer (Adam): no. "A set with no program set of its own exercise has no own rest; it uses its exercise's rest, then the global rest, as today" (option (c)). In SPEC Rest [P1.1] and TASKS-1.1 chunk 30.
- Date: 2026-10-10

### 87 Deload rules in Plan: where and how they show (provisional, D31)
- What: where and in what form Plan shows the deload rules in effect (chunk 33); provisional (a): one read-only line under MARK WEEK AS DELOAD.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): … 87 (board 1e), …" Full text in HISTORY.md.
- Date: 2026-10-15

### 86 Plan's line for a run with no schedule (provisional, D31)
- What: what Plan shows for a run with no schedule (chunk 33); provisional (a): "NO WORKOUTS SCHEDULED", then "Programs →", the same for weekday and sequence runs.
- Answer: (Adam, 2026-10-15) "Accepted as they stand in 1.2: 82, 83, 85, 86, 112." Full text in HISTORY.md.
- Date: 2026-10-15

### 85 START without a schedule: how it shows (provisional, D31)
- What: how START shows that a program needs a schedule first (chunk 33); provisional (a): START disabled, with "Schedule at least one workout to start" under it.
- Answer: (Adam, 2026-10-15) "Accepted as they stand in 1.2: 82, 83, 85, 86, 112." Full text in HISTORY.md.
- Date: 2026-10-15

### 84 Highlighting: how Plan knows a week started empty (provisional, D31)
- What: how Plan tells that a week started empty, which shows no highlighting (chunk 31, G42); provisional (a): Settings → NEW WEEK STARTS "empty" (week-dependent runs) decides it.
- Answer: (Adam, 2026-10-15) "Closed as superseded by 1.2 (the screens or settings they describe are removed or rebuilt to boards): 84 (weeks never start empty), …" Full text in HISTORY.md.
- Date: 2026-10-15

### 83 Highlighting: the same exercise twice in one workout (provisional, D31)
- What: which is matched with which when a workout has the same exercise twice, for highlighting (chunk 31); provisional (a): in order of position.
- Answer: (Adam, 2026-10-15) "Accepted as they stand in 1.2: 82, 83, 85, 86, 112." Full text in HISTORY.md.
- Date: 2026-10-15

### 82 Highlighting: which exercises count as moved (provisional, D31)
- What: which exercises a reorder highlights as moved (chunk 31, G36); provisional (a): every exercise outside the largest groups that kept their order (two neighbours that traded places: both).
- Answer: (Adam, 2026-10-15) "Accepted as they stand in 1.2: 82, 83, 85, 86, 112." Full text in HISTORY.md.
- Date: 2026-10-15

### 81 SPEC change 1.1: Adam's answers to G35–G44 and P4, and a standing rule for display-only edge cases
- What: TASKS-1.1's gaps G35–G37 and G39–G44 (G38 was a reading), and P4: does D29 cover chunk 32's migration?
- Answer (Adam):
  - G35–G44 and P4 (yes) are answered in TASKS-1.1 "Answered gaps" (second round) and SPEC.md [P1.1]. G44 becomes chunk 34 and G40 chunk 35; the six readings he was shown are confirmed.
  - Standing rule (D31): a display-only edge case gets the simplest option consistent with SPEC, recorded as a provisional decision, and work continues. Only data or behaviour stops a chunk. Entries 82–87 are the first.
  - Open after the answers: G45 (it changes data), in TASKS-1.1.
- Date: 2026-10-10

### 80 SPEC change 1.1: Adam's answers to TASKS-1.1's gaps G16–G34 and P1
- What: The spec gaps TASKS-1.1 raised against SPEC change 1.1 (G16–G34), and P1: does D29 cover 1.1's function-only migrations?
- Answer (Adam):
  - Rest, tempo, the warmup routine and superset grouping stay run-wide, edited in the week's Structure view and labelled "every week". Per-week storage is a later revision (TASKS-1.1's appendix).
  - G16, G17, G21–G31, G34 and P1 (yes) are answered in TASKS-1.1 "Answered gaps" and SPEC.md [P1.1]. G18–G20, G32 and G33 fell away.
  - COMPACT is removed, which supersedes D6's compact view once TASKS-1.1 chunk 29 ships.
  - G35–G37, G39–G44 and P4 followed; Adam answered them in entry 81. G38 became a reading.
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
**Answer:** `vercel.json` `ignoreCommand` skips the production build when a push changes only `.md` files since the last deployed commit. Currently `test -n "$VERCEL_GIT_PREVIOUS_SHA" && git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ':(exclude)*.md'` (166 characters; B4, 2026-10-11, DECISIONS 111). Before that, `git diff --quiet HEAD^ HEAD -- . ':(exclude)*.md'` (2026-09-29) skipped a push whose last commit was docs-only even when earlier commits changed code; the per-file version before it exceeded Vercel's 256-character limit.

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

**D31 · Display-only edge cases are decided provisionally.** *(Adam, 2026-10-10)*
**Answer:** For a display-only edge case (what's highlighted, a label, an empty state, where a control sits), take the simplest option consistent with SPEC, record it as a provisional decision in "Waiting on Adam" (Decisions), and continue. Stop only for something that changes data or behaviour.
