# Overload 1.2 — update notes

*Final, 2026-10-27 (TASKS-1.2.md "Release", step 1). This lists each SPEC.md [1.2] rule against what was built on `staging`:*
- *The build: chunks 36–69 with 46m, 46r, 51a/b/c, 54a/b, 58a/b, 188f, queue-fix 227, queue-fix 230 and fix 239–242; migrations 042–047.*
- *The checks: the release checklist on staging (RC1–RC44). The 31 data rows were run and all PASS; 11 screen rows PASS by screenshot. RC42 and the other rows marked P are Adam's, on production after the release. RC44 was run by Adam on production (zero rows).*
- *How to release: `docs/release-1.2-run-sheet.md`.*

## What's new

- **Plan, rebuilt.**
  - One week view per week.
  - A week is planned when it starts, or a week ahead with PLAN FORWARD: structure, volume and set types, and no weights, reps or RIR. A stable run takes its default's rep targets.
  - Numbers come only with COPY, which has its own fields and an overwrite switch.
  - REVIEW goes through what went differently last week, and VOLUME shows last week → this week per muscle.
  - Change marks show what changed since the week the plan came from.
  - Done sessions and past weeks are read-only.
  - Rep and RIR target pickers everywhere, a RIR range ("1–2"), and one set type picker for every kind of set.
- **Programs.**
  - PLAN | PROGRAMS at the top of the Plan tab.
  - The PROGRAMS tab: the current program, your programs, finished ones.
  - CHANGE THE PROGRAM, for everything about a running program: exercises, sets, supersets, rest, tempo, the warmup routine, weekdays and the name.
  - START lands on Plan, week 1. FINISH keeps the program saved.
  - A finished program shows its dates, weeks, deloads, priorities and how its structure changed.
- **The workout.**
  - Logged, current and upcoming rows. The plan's targets sit in the boxes, with "last time" and "earlier this week".
  - A pinned rest bar.
  - The log lock ("Log sets in order").
  - A pen on a logged set opens the edit panel: its numbers, SET TYPE, UNLOG and DELETE.
  - The set type can change during a workout. Stage rows open by themselves, and + ADD ROUND adds a set to every member of a superset.
  - Swap for today moves only the remaining sets.
  - The finish warning about unlogged sets is back.
  - Logging, unlog and delete work offline.
- **Settings.** "Drops and stages count as" (default ½) and "Log sets in order" (default on). The deload rules live here only. "New week starts" is gone.
- **Words.** "Program" everywhere (never meso or mesocycle), "cues" (never tags), "change the program".

## Rule by rule (SPEC [1.2])

Built = built as SPEC says and checked by the row named. "Provisional" = SPEC left a display choice open, and the build took the provisional one (P1.2-n, TASKS-1.2) or a D31 choice (DECISIONS n). Both are accepted as built and are on Adam's review-pass list.

| SPEC [1.2] rule | Status | Checked by |
|---|---|---|
| Schedule type and planning type required when a program is created (Objects stored; Creating a program, 16a) | Built | RC19 |
| The stored deload-rules override is no longer read or written; deload rules in Settings only (16b) | Built (the column stays, unread) | RC24; `programDeloadOverrideUnused.static.test.ts` |
| A run is called a program in the app (C12) | Built | RC39 |
| CHANGE THE PROGRAM (1c, 7a, 1e): the rule box, exercises, sets, supersets, rest, tempo, warmup routine, weekdays, rename, CANCEL / SAVE CHANGES; a save lands on sessions not done | Built; display choices 172, 175 accepted; 245–247 (vibe check) none blocks | RC15, RC16, RC17 |
| The stepped planner still refuses a run's copy; its START opens the start sheet (PR8) | Built | RC18 |
| The planner's sets: REMOVE THIS SET leaves its place empty, a set's number opens the set type picker, a rep target the rep picker; no deload-rules control | Built; provisional P1.2-8, 223, 224 (1.2.1 list) | RC13, RC18 |
| Starting lands on Plan week 1; the name defaults to the program's; starting while one runs finishes it and says so | Built | RC20 |
| Finishing (8c): FINISH on the current program's card, the confirm; the program stays saved | Built | RC21 |
| A finished program's priorities stay editable (G50) | Built (Adam's 1.2.1 item: make them read-only) | RC23 |
| When a week gets planned (2): when it starts, or with PLAN FORWARD; browsing never plans | Built (migration 045) | RC1, RC2 |
| How far ahead: week 1 through the first unplanned week after the current one | Built; provisional P1.2-6 | RC1 |
| A planned week is never updated by a later edit of an earlier week | Built | RC5 |
| What the auto-copy takes (2b): structure, volume and set types, no weights / reps / RIR (stable: the default's rep targets) | Built; provisional P1.2-10 | RC2 |
| COPY (2c): fields, done workouts locked, overwrite off fills empty boxes only, on replaces; a range copies as a range | Built; provisional P1.2-1 | RC3 |
| Stable weeks (1b, 1d): a change lasts that week; THIS WEEK ONLY / CHANGE EVERY WEEK → | Built | RC4 |
| Week-dependent weeks (1a): a change carries forward through the next PLAN FORWARD | Built | RC5 |
| Exercises are added, removed, swapped and reordered only in CHANGE THE PROGRAM (7b) | Built | RC6 |
| Done sessions and finished weeks locked in Plan, showing the plan | Built | RC7 |
| Workouts that share one plan: "Shared with Thu — changes apply to both"; a deload marks every sharing day | Built; provisional P1.2-7 | RC8 |
| Changes since the source (G48): week-dependent vs last week; stable vs the default and last week; week 1 and deload sessions unmarked | Built; display choices 205, 206; 207 (b) is Adam's answer for his review pass (no marks on a stable run's past week), not built yet | RC9 |
| Existing data: migration 046 makes each active week-dependent run's program match its last planned week | Built (step 5; DECISIONS 149 (c), 202, 203) | rehearsed on staging; RC44 |
| Review (13): the line and the sheet; USE / ADD THIS SET / REMOVE THIS SET / SWAP FROM WEEK N / ADD EXERCISE / IGNORE; decided items gone for good; nothing on week 1; a sequence run's groups headed with their slot ("SLOT 2 · ROTATION A") | Built; provisional P1.2-1, P1.2-3; display choices 211, 212 | RC10, RC26 |
| Volume per muscle (14): last week → this week, "YOU PLANNED … DID …", the Settings rule, nothing written to the week | Built; provisional P1.2-1, P1.2-2; display choices 209, 210 | RC11 |
| Targets (6, 17): the rep target picker everywhere in Plan (NONE / NUMBER / RANGE / AMRAP, "Use for all"); the RIR target picker with a range, shown "1–2" in the workout | Built (migration 042) | RC12 |
| A RIR range converts both ends to RPE | Not built: there is no RPE setting (phase 2), so nothing converts | — |
| Tags are called cues; reached from the set type picker's Cues row in Plan and the set's ⋯ in the workout; never copied | Built | RC14, RC39 |
| Tempo is edited in CHANGE THE PROGRAM (exercise ⋯) | Built (Adam's 1.2.1 item: a tempo input like the rep and RIR boxes) | chunk 51a's and 51b's tests; no RC row names it |
| Rest: exercise rest and rest after in CHANGE THE PROGRAM's ⋯, superset rests in a member's ⋯, a set's own rest in Plan's picker (week-dependent) or REST AFTER (stable), REST BETWEEN | Built | RC15 |
| Supersets: changed in CHANGE THE PROGRAM; look the same as in the workout (12); + ADD ROUND adds to every member, a member's ⋯ to that member | Built; 246: a superset can't take the exercise below it in CHANGE THE PROGRAM (recommended for 1.2.1) | RC16, RC34 |
| Warmup sets: a set type (the picker); no RIR target on a warmup row (G49); the warmup routine edited in CHANGE THE PROGRAM | Built | RC12, RC13, RC16 |
| One set type picker (5) in Plan, CHANGE THE PROGRAM, the planner and the workout; a warmup can't be staged | Built | RC13 |
| Deload: Settings only; the WEEK ⋯ rule line; session deload in the session's ⋯, week deload in WEEK ⋯ (C2); the RIR rule on a range | Built | RC24 |
| Deload: marking a session that already holds a saved copy keeps the copy | Built (188f: a phase-1 bug fixed, below) | 188f's review; RC24 |
| Weekdays change during a run, from next week (1e); a day another workout uses can't be picked; one day stays on | Built; provisional P1.2-9; 245 (several days per workout) none blocks | RC17 |
| MOVE THIS SESSION in the session's ⋯: the current week, today and later days | Built (241 fixed, below; 244 left as is) | RC25 |
| Sequence runs: cycles and slots everywhere; no DAYS card, no MOVE | Built | RC26 |
| Drops and stages count in volume per the Settings rule (14b) | Built (migration 042) | RC11, RC38 |
| Workout row states (logged / current / upcoming) and what a row shows (C3, C4) | Built; display choices 216, 217; board W1's row caption with the earlier-this-week numbers not built (218, below) | RC27 |
| Rest timer (C5): the bar pinned, no inline timer, the jump button | Built | RC28 |
| The current set: the first unlogged working set or stage | Built | RC27, RC29 |
| Log lock (18a; G54): asks out of order with the setting on, never with it off; CANCEL logs nothing; warmups never ask | Built (migration 042); display choices 221 | RC29 |
| The pen and the edit panel (18d) | Built | RC30 |
| Unlog (18c; G46): numbers kept on that phone, disabled while drops are logged, no rest restart | Built (migration 044); display choices 231; 232, 233 on the 1.2.1 list | RC31 |
| Delete set (18b): confirm, this session only, stages with the head, renumbering | Built; display choices 225 | RC32 |
| Offline (G47): logging, delete set and unlog work offline and sync | Built (239 fixed, below; 243 known, below) | RC31, RC32, RC33, RC37 |
| Set type during a workout (19): from the ⋯ or the edit panel; this session only; asks before deleting logged drops; a logged set's change needs a connection | Built (migration 042); display choices 229 | RC33 |
| Stage rows open by themselves once the row before is logged | Built | RC34 |
| The set's ⋯ during a workout (C9) | Built; 228 (no ⋯ on an open warmup row) on the 1.2.1 list | RC14, RC33 |
| Swap during a workout (C7): moves only the remaining sets, keeps the numbers (179, 183, 199, 200); errors show the real reason | Built (migration 047); display choices 220 | RC35 |
| Finishing a workout (11, C6): W18's tiles, the unlogged-sets warning with GO BACK, COMPLETE, a reopened session (W19) | Built; display choices 235 | RC36 |
| "Program" everywhere (C12), "cues", "change the program" | Built; known exceptions below (Coach, the pre-1.1 priorities page; the Library's EDIT TAGS and UNTAGGED: 215) | RC39; `scripts/check-wording.test.mjs` |
| Screens explain themselves: each rule a person meets is stated where they meet it | Built | RC16 (the rule box), RC22, RC24 (the WEEK ⋯ line) |
| PLAN \| PROGRAMS (8); no program → PROGRAMS with PLAN locked | Built (P1.2-12 was an interim state only) | RC22 |
| Navigation: 6 tabs; COACH as the 7th and its sidebar as today, Adam only (C11) | Built | RC43 (staging); RC42, RC43 on production (P) |
| The Plan screen (boards 1–9), PROGRAMS (PR1–PR15), the workout (W1–W19) | Built; provisional P1.2-4, P1.2-5; display choices 186 (accepted), 189, 190, 192, 193 (P1.2-11 was an interim state only) | RC1–RC43 |
| Errors (15): every error line shows the real reason; "You may be offline" only offline | Built on the screens 1.2 rebuilds; Library, History and Today keep 1.1's code | RC40 |
| Settings keeps its look and adds two rows; no "New week starts" | Built | RC38 |
| Removals [1.2] | Built: every item gone (below) | RC41; the bundle check below |

## Superseded by 1.2 and the Removals, checked line by line

Each removed label was searched for in the 1.2 build's bundle (staging's code, `6bfe372`). The labels are 1.1's own, read from master's `SetGroup.tsx`, `PlanPage.tsx`, `ProgramsPage.tsx` and `SettingsPage.tsx`. Each one: 0 hits. The controls were found: PLAN FORWARD, CHANGE THE PROGRAM, DROPS AND STAGES COUNT AS, Log sets in order.

- Plan's Sets / Structure views and their highlighting → one week view. Gone: the view labels (bundle, 0); RC41. The highlighting is kept, rewritten as change marks (RC9). The REVIEW dots tried during design never shipped.
- Design fields edited in the Structure view → CHANGE THE PROGRAM (RC16). The planner still refuses a run's copy (RC18).
- "Fixed for the run: the schedule … and the deload-rules override" → weekdays change from next week (RC17). The override is unread: the static test; no control anywhere (RC24).
- Adding or removing an exercise in a week, and linking neighbours there → only in CHANGE THE PROGRAM (RC6, RC16).
- Priorities shown view-only in Plan → PROGRAMS shows them (RC22).
- The Programs page reached from Plan's header, "End run", completed runs → the PROGRAMS tab, FINISH, the finished program screen. "END RUN" is gone (bundle, 0); RC21–RC23, RC41.
- An empty week offering "Copy last week", and "Copy last week" as its own action → weeks never start empty (RC2); COPY (RC3). "copy last week" is gone (bundle, 0).
- MAKE THIS WEEK THE NEW DEFAULT → removed (bundle, 0; RC41).
- "Apply this change to planned weeks ahead" → removed (bundle, 0; RC41).
- A week planned the first time it is opened → planned when it starts, or with PLAN FORWARD (RC1: browsing never plans).
- Weights and RIR always from last week → numbers only with COPY (RC2, RC3).
- The "week start (copy / empty)" setting → removed. "NEW WEEK STARTS" is gone (bundle, 0; RC38).
- The per-program deload-rules control → Settings only (RC24).
- Lock: "tapping another row makes it current" → the log lock, 18a (RC29).
- ADD STAGE, "Mark as dropset" and "+ DROP OR STAGE" in the workout → the set type picker (19). All three are gone (bundle, 0; RC33, RC41).
- ADD WARMUP SETS → a warmup is a set type. Gone (bundle, 0).
- The Plan header's Programs icon → the PROGRAMS tab (RC41).
- The "applies from" week picker → gone (bundle, 0).
- The note section when editing a logged set → gone (RC41: no note in the edit panel).
- Unlogged sets at finish "as today" → the warning is back (RC36).
- Row states, the current set, delete set and the log lock, moved from phase 2 → built (RC27, RC29, RC32).

## Data migration 046 (step 5; Adam's yes)

046 changes existing rows of every user's active week-dependent runs on production, Adam's friend's included. In each, it sets the program's `week_only`, `removed_at` and `position` to match the run's last planned week, and only on rows that differ. Nothing anyone sees in their weeks changes, except the case Adam accepted (DECISIONS 203, below); RC44 found that case on none of his runs. A second run changes nothing.

It was rehearsed on 183 replayed 1.1-shaped worlds and on staging: 7 changes on 6 rows of staging-sequence, and nothing else. The production reading before and after, Adam's rows only, is `scripts/release-046-counts.sql`. Rollback: the backup taken right before.

## Fixed from 1.1

- Fixed, a bug live since phase 1: a week marked as deload again after a mark that stopped part way (a dropped connection, the app closed) saved a marked session's deloaded sets over its plan, so UNMARK brought back the deload and not the plan (chunk 188f; DECISIONS 188 (a)).
- Fixed, a bug live since phase 1: a set logged offline under a dropset whose first send failed, then the dropset deleted, left a "couldn't sync" notice that could not be cleared (queue-fix 227; DECISIONS 227).
- Fixed, a bug live since phase 1: a set deleted while its first sync attempt was failing came back at the next sync (queue-fix 230; DECISIONS 230).
- Fixed, a bug live since phase 1: a session deleted in History while one of its sets, or a note on it, was waiting to sync left a "couldn't sync" notice that could not be cleared, and a finish still waiting to sync brought the deleted session back (queue-fix 230; DECISIONS 230).
- Fixed, a bug live since phase 1: a planned set removed on Plan while a set logged under it was waiting to sync left the same notice, and the logged set never reached the server; it now syncs without its planned set, as a set that synced first always did (queue-fix 230; DECISIONS 230).
- Fixed, a bug live since phase 1: an exercise deleted in the Library whose only sets were waiting to sync was deleted for good and left the same notice; it is now kept, as an exercise with history is, and its sets sync (queue-fix 230; DECISIONS 230).
- Fixed, a bug live since phase 1: a set logged offline whose first sync attempt failed could read as not logged once the workout was read again, and logging it again saved it twice (fix 239–242; DECISIONS 239).
- Fixed, a bug live since phase 1: a session moved in Plan to a day before its own (Wednesday's workout to Tuesday) didn't show on Today until it was moved back (fix 239–242; DECISIONS 241).
- Fixed, a defect in the deload calculation since phase 1: a deload week could take an exercise's weight from another exercise's log on the same planned set, for example a squat at 75% of a leg press weight. Plainly: 1.1's own flows could not reach it. Since 2026-09-04 its swaps log the replacement's sets with no planned set, so only logs written before that fix, or changed outside the app (the staging seed's are), have that shape (fix 239–242; DECISIONS 240).

## Known in 1.2

- Known in 1.2, fixed in 1.2.1: an UNLOG, a deleted set or a renumber made offline whose first sync attempt fails reads as undone until the next sync; nothing is lost (DECISIONS 243, Adam 2026-10-27).
- On a sequence run, a repeated workout whose slots were edited differently in 1.1's week view plans the earlier slot's next cycle from the program, which matches the later slot's week; nothing stored is lost (DECISIONS 203, Adam 2026-10-20).
- Coach may skip analysing the one week in which a run's weekdays change (DECISIONS 159, Adam 2026-10-16).
- Coach (your account only) still says MESO and mesocycle in five places (its MESO tab, two empty-state lines, NO MESO on the week and session analyses), and a pre-1.1 program's priorities page says MESOCYCLE NOT FOUND (G50); every other screen says "program" (chunk 69; DECISIONS 154, 236).
- A session moved to a day and not done there is not listed as missed afterwards; as in 1.1 (DECISIONS 244, Adam: "leave as is").
- What queue-fix 230 leaves, (1)–(4): known, as built; (1) is on the 1.2.1 list (DECISIONS 238).
- Library, History and Today keep 1.1's error handling: a refused read shows no reason line, or is drawn empty (RC40; outside the screens 1.2 rebuilds).

## Not built, and why

- Board W1's row caption with the earlier-this-week numbers ("MON 17.5 × 15 @ 1" beside LAST). It was in neither 58a's nor 58b's scope, and SPEC's "those too (W16, W17)" is met by the sheet and the card line's "· ALSO MON". Recommended: add it; on Adam's review-pass list (DECISIONS 218).
- No change marks on a stable run's past week or its finished sessions. That is Adam's answer, (b), to be built in his review pass (one condition in `WeekView.tsx`), not before the release (DECISIONS 207).
- The RPE display of a RIR range: there is no RPE setting (phase 2).
- SPEC "Later", not 1.2:
  - a first-run tutorial;
  - History's highlights of what was done differently;
  - further CHANGE THE PROGRAM improvements;
  - restyling the screens 1.2 doesn't touch;
  - changes to Coach;
  - a REVIEW threshold for RIR.

## The 1.2.1 list

DECISIONS.md "1.2.1 list": 220–238 and 243, all as built in 1.2 unless Adam flags one in his screen-row check, with each item's 1.2.1 change named there. Adam's seven items from his vibe check (2026-10-27), word for word:
- finished-program priorities must be read-only (and the pre-1.1 priorities page differs)
- superset exercise reorder when creating
- tempo input like reps/RIR (no typing dashes)
- PREVIEW SESSION redesign (old design, and its planned line shows weight/reps/RIR under a "planned RIR" label)
- remove the duplicate history button (the LAST line already opens it)
- rest bar shows the workout is complete once all sets are logged or skipped
- CHANGE THE PROGRAM from the week being viewed, not only the current week.

## Waiting on Adam, carried

- **The release itself** (blocks it): `docs/release-1.2-run-sheet.md`:
  - the backup, the before counts, his yes on 046 (merging the migrations PR #240) and step 5's checks;
  - the after counts, then step 6 (the release PR #241, as a merge commit), the smoke test and the 30 P rows.
- **The four vibe-check items** (none blocks): 245, 246 (recommended for 1.2.1), 247 and 248.
- **For his review pass on staging** (none blocks): 189, 190, 192, 193, 205–212, 215–218 (DECISIONS "Waiting on Adam").
- **To-dos:** 113 and 79.
