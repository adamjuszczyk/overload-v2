# Overload — Decisions

## Waiting on Adam
*Rewritten at every boundary. Last: 2026-10-15, chunk 42 reviewed and **not merged**: everything in it passed review except one new spec gap, G56 (131), which blocks its merge and chunk 52. New: 131 (blocking), 132 (chunk 42's provisional display choices, D31). Items 82–112 are 1.1's provisional display choices (D31), each built as written unless you change it. Each list is ordered by what it blocks.*

Decisions:
- **131** — G56: after a week off, Plan can't reach the current week (weekday runs). A week in which neither Plan is opened nor a workout started is never planned, and the tiles stop at the first unplanned week, so the current week lies beyond them; SPEC also says Plan "opens on the current week". Recommended: (b) Plan always reaches the current week; a past week nobody planned shows as not planned, read-only and empty, and nothing is ever written for it. Blocks: chunk 42's merge and chunk 52, so also 43, 53, 54a, 54b, 55, 56, 65, 66, 68 and 69; 44–51b, 57–64 and 67 go on.
- **125** — the empty staging account now owns the app's 46 default exercises (the app creates them when an account with none signs in; the reviewer's sign-in did), so `staging-smoke.mjs` reads 54/55. Recommended: (a) "empty" means what a new account has after signing in; the smoke's empty-account check accepts exactly that default set (a small script change). Blocks: nothing before chunk 65; until then every smoke run shows this one expected failure.
- **127** — the 1.2 sheet frame's look where no token or board value decides it. Provisional: the scrim is black at 60 % (no scrim token; the boards draw 45 % light, 70 % dark; 60 % is the app's nearer existing value, behind the Today and workout sheets; TASKS' "look of ProgramsPage's sheet" would be 88 %, heavier than any board); the sheet is `--surface` as the boards and TASKS say (in the dark theme it stands out from the scrimmed page mainly by its border); z-index 45 (the old inline sheets draw above it). Blocks: nothing; the pickers (chunk 39) use the frame, no screen does before chunk 51a.
- **128** — the three pickers' display choices where SPEC and the boards give no value (chunk 39). Provisional: stage stepper 1–10; rest steppers 15 s a tap up to 10:00, as the app's existing rest stepper; a segment opens on the boards' examples (8, 8–10, RIR 2, 1–2); the number boxes are steppers, not inputs; "Use for all" not drawn under two sets; a kind change keeps the stage count and the rest between stages; text on the accent is `--base` (near-white on orange in the light theme, about 2.2:1; the boards draw near-black); an unbroken word of 35+ characters runs past its line. Blocks: nothing; no screen uses the pickers before 51a / 54a.
- **129** — the cues sheet's choices where SPEC and board 8 give no value (chunk 40). Provisional: "+ NEW CUE" opens an input in its place with an ADD button (no board draws it: `design/1.2/built/8-new-cue.png`); a typed cue that matches a preset or one of your own cues, ignoring case, ticks that row instead of adding a second cue that reads the same; "Use for all" counts working sets only and isn't drawn under two; text on the accent is `--base` (as 128); no length limit on a cue. Not a choice, so you see it: "Use for all" adds the ticked cues to the other working sets and removes none (TASKS' answer), so an untick changes this set only. Blocks: nothing; no screen opens the sheet before 54a / 61.
- **130** — the exercise picker's choices where the boards differ or give no value (chunk 41). Provisional: one look for every caller (W11's hairline rows and muted chips; PL4–PL6 draw cards and solid chips); the group under each name unless the caller turns it off; always the tall sheet; PP2d's list not edge to edge; a tap on the chip that is on goes back to ALL; an exercise created in the sheet counts as a tap on its row; words for states no board draws (LOADING…, COULDN'T LOAD EXERCISES and the reason, NO OTHER EXERCISES, "No exercises yet."); only the field while a new exercise saves; a 16 px name field; text on the accent `--base` (as 128 (g)); W11's line over the button doesn't break a name with no space (as 128 (i)). Blocks: nothing; no screen opens the picker before 51a / 59 / 68.
- **132** — chunk 42's display choices where SPEC gives no rule (chunk 42 not merged yet, 131). Provisional: a box that differs from its source is marked even when it is empty, so a week planned forward reads as changed in every number, with "CHANGED SINCE WEEK N", until COPY or typing fills it; an unplanned current week's tile reads NOT PLANNED; a warmup's RIR is never marked (G49); THIS WEEK ONLY counts a stage's rep target too; "last week" for the marks is the workout's last normal, non-empty week. Not choices, so you see them: week 1 of a week-dependent run keeps the program's rep targets; COPY never empties a box, writes only the ticked fields and copies each workout from its last normal week. Blocks: nothing; no screen draws them before 52 / 54b.
- **82** — which exercises count as "moved" in a reorder. Provisional: every one outside the largest groups that kept their order (two neighbours that traded places: both). Blocks: nothing.
- **83** — the same exercise twice in one workout, for highlighting. Provisional: matched in order of position. Blocks: nothing.
- **84** — how Plan knows a week started empty. Provisional: Settings → NEW WEEK STARTS is "empty" (week-dependent runs); exact would need a new column, which is yours to choose. Blocks: nothing.
- **85** — START when the program has no schedule. Provisional: disabled, with a one-line reason. Blocks: nothing.
- **86** — Plan for a run with no schedule. Provisional: "NO WORKOUTS SCHEDULED" and "Programs →". Blocks: nothing.
- **87** — the deload rules in Plan. Provisional: one read-only line under MARK WEEK AS DELOAD. Blocks: nothing.
- **90** — after START on the Programs page, the app still opens the run's priorities, now read-only. Provisional: leave it (it shows what the run copied); alternative: open Plan. Blocks: nothing.
- **91** — how marks show in Plan's priorities. Provisional: a small accent label on the row only where a mark is stored; a subgroup that only inherits its group's mark shows nothing. Blocks: nothing.
- **94** — Plan while its reads are out. Provisional: the existing spinner until the programs read (and, on a sequence run, the sequence, week plans and last event) answer; weekday runs also wait for programs now. Blocks: nothing.
- **95** — Plan when a read fails with nothing to show. Provisional: "COULDN'T LOAD PLAN" / "Check your connection and try again." (the priorities screen's error markup); nothing is planned. Blocks: nothing.
- **98** — Plan's SETS / STRUCTURE details. Provisional: opens on SETS; the choice is kept across week/workout switches, not across reloads; a STRUCTURE set row shows number, kind marker and ⋯ only; a stage row has no ⋯ in SETS; an empty workout's SETS view says "NO EXERCISES IN THIS DAY" (add from STRUCTURE). Blocks: nothing.
- **99** — "Make this week the new default": does an empty (non-deload) session count as the week's content? Provisional: no — skipped like a deload, so that workout keeps its current default (matches how copying skips empty weeks). Changes data, so say if you want the other reading; nothing has used the action yet. Blocks: nothing.
- **102** — how run-wide fields show in STRUCTURE. Provisional: tag-style chips under the exercise or set where set (`REST 2min 45s`, `TEMPO 3-1-1-0`, `UNIT LBS` only when it differs from Settings, `STAGE REST 20s`); one EVERY WEEK label over each group; exercise ⋯ order swap/move/warmups, EVERY WEEK group, UNIT, remove; the routine as a card above the exercises (text-only on a past week, absent if empty). Blocks: nothing.
- **104** — how differences show. Provisional: a changed number cell gets an accent border/muted fill; an added set marks its number and reps (weight/RIR only if last week's set at that position differs or is missing; never on week 1); an added/moved exercise's header is accent on the muted band; a removed exercise is a dim struck-through line in STRUCTURE after the exercise it followed (a swap: old directly above new); a removed working set shows in SETS with what it held, a removed warmup/stage in STRUCTURE; a changed kind puts a dot on the set's ⋯; the unit isn't compared. On a stable run, a set the default has but last week lacks gets weight/RIR marked. Blocks: nothing.
- **109** — chunk 33's wording and placement. Provisional: START disabled with "Schedule at least one workout to start" under it (planner, and the Programs sheet's START RUN; the row's START still opens the sheet); Plan: "NO WORKOUTS SCHEDULED" + "Programs →"; deload line "Deload rules (this run's | your default): …" under the deload button (also when it reads UNMARK; none on a past week); refusal "THIS PROGRAM IS A RUN'S COPY" with "← Back to programs". Blocks: nothing.
- **110** — two program-tab conveniences have no one-to-one equivalent in Plan: one-tap ALL SETS rep target, and turning an existing set into a warmup (the per-row WARMUP toggle was already dropped from the week on 2026-10-10). Both outcomes stay reachable per set (or delete + ADD WARMUP SETS), then Make default. Provisional: leave as is. Blocks: nothing.
- **112** — a finished session's rows in Plan on a shared (G14) row. Provisional: if any session on that row is completed or skipped, the row is read-only for every weekday that shares it. Behaviour only; no data. Alternative: lock only when every sharing weekday's session is done (then a finished Monday leaves Thursday editable but the shared plan changes under Monday). Blocks: nothing.

To-dos:
- **121** — Before the release: prove production's migration history with one read-only command (entry 121). When: any time before the release. Blocks: the release's migrations PR.
- **113** — live-check the fix session (this container can't reach the app). When: next gym visit. (a) Plan: finish a session, open Plan on the current week: its sets can't be edited, the line reads SESSION DONE — READ ONLY; reopen it and they can. (b) Train a few sets in airplane mode, reconnect, finish at once: the session is `completed`, not skipped, with a sensible end time. (c) Plan: after an edit that offers "apply to planned weeks ahead", tap APPLY twice fast: sets are added once. (d) Unmark a deload whose program set was deleted: sets come back. (e) answered 2026-10-14: #87's docs-only merge read "Canceled by Ignored Build Step". (f) #83: log sets with a flaky connection; a write that can't sync shows "N changes couldn't sync. Tap to retry." at the top of the workout screen, and tapping it sends them. Blocks: nothing.
- **79** — Confirm REDO SESSION is gone on a finished session's Today screen. When: after a session. Blocks: nothing.

## For the release
*Every migration `check-migration` flags during the 1.2 build, one line each (number, PR, what it flags). At the release Adam gets one blocking decision covering all of them (CONTEXT.md, "Staging and the 1.2 build").*

- **042** — chunk 36 (#95): `check-migration` exit 1 on three statements: two `ADD COLUMN` carrying a CHECK (`v2_week_plan_sets.target_rir_max`, `v2_user_settings.stage_volume_rule`: "new column carries a constraint or generated value") and `notify pgrst, 'reload schema'` ("not on the safe list"). Add-only: 3 columns, nullable or defaulted, whose checks every existing row satisfies, and 3 empty tables; no existing row changes.

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

### 132 Chunk 42's display choices where SPEC gives no rule (provisional, D31)
**Ask:** chunk 42 (not merged yet: 131) built Plan's week rules as one module, `src/features/plan/weekPlanning.ts`: the week tiles (drawn by 52), what a planned week takes from its source (044 follows it, 53), how COPY matches last week's numbers (52), "THIS WEEK ONLY" and the changes-since marks (54b), and what + ADD SET adds (54a). Five display choices had no SPEC rule; each stays as built unless you change it.
**Recommendation:** keep them; each is one condition in `weekPlanning.ts`. (a) A box that differs from its source is marked whether or not it is empty, as SPEC words it ("anything in a week that differs from its source is highlighted") and as 1.1 did. In 1.2 this shows: a week planned forward has no weights, RIR or (week-dependent) reps of its own until COPY, so each number its source has reads as changed and "CHANGED SINCE WEEK N" shows on the week until the numbers are filled. (b) A current week that isn't planned yet reads NOT PLANNED, not THIS WEEK (Plan plans it as it opens, 52). (c) A warmup's RIR is never marked: a warmup row has no RIR cell (G49), though a week from 1.1 may still hold one. (d) THIS WEEK ONLY also counts a stage whose rep target differs from the default's ("differs from the default in set count, kind, stages or rep target"). (e) "Last week" for the marks and the legend is the workout's last normal, non-empty week (deload and empty weeks passed over), as 1.1's marks had it.
**Blocks:** nothing. No screen draws the tiles before 52 or the marks before 54b.
**Options:** each as built, or: (a) a box with no value of its own is never marked (a fresh week then shows no marks until a number typed or copied differs); (b) THIS WEEK; (c) marked like the other numbers; (d) heads only; (e) the week before, literally.
**Answer:** provisional under D31 until you change it.
**Evidence:** `src/features/plan/weekPlanning.ts` and its five test files on `build/chunk-42` (`1065cbb`); (a) is pinned by the last test of `weekPlanning.changes.test.ts`, as 1.1's `weekDiff.test.ts` pinned it (`targetWeight: null` against 100 is marked). Not D31 choices, recorded so you see them (SPEC or TASKS decides each): week 1 of a week-dependent run keeps the program's rep targets (SPEC: the program set "for `week-dependent` it's week 1", and later weeks don't "fall back to the run copy's (week 1's) target"; TASKS 53 keeps 041's program branch "for structure and rep targets"); later week-dependent weeks get none, stable weeks the default's. COPY never empties a box: a box last week left empty isn't copied, even over a typed number with Overwrite on ("Copy last week's numbers"; board 2: "numbers you already typed get replaced"). COPY writes only the ticked fields (TASKS 42: "takes whatever fields the sheet offers"), so REPS without RIR can leave an AMRAP set with no RIR target: the RIR 0 default stays with Plan's rep target picker (54a), as today, and 044 gives a stable week's AMRAP sets no RIR either. COPY's "last week" is, for each workout, its last normal, non-empty week, as 1.1's copy actions had it (SPEC: "Deload sessions are never a copy source"; Deload: "skipped as a copy source"; DECISIONS 42): chunk 52 passes that to `copyNumbers`, not simply the week before.

### 131 G56: after a week off, Plan can't reach the current week (weekday runs)
**Ask:** what should Plan show when a past week was never planned? On a weekday run a week is planned only when the app plans it: Plan opening on it (chunk 52 plans only the current week) or a workout starting. A calendar week in which neither happens (a week off) is never planned. SPEC says the tiles run "from week 1 to the first unplanned one", "Nothing beyond the first unplanned week is reachable", and Plan "opens on the current week": after a week off the current week lies beyond the unplanned one, so these can't all hold. Built in chunk 42 (`weekTiles`): the tiles stop at the unplanned past week, so the current week has no tile until every missed week is planned forward.
**Recommendation:** (b): it keeps "opens on the current week", writes nothing for a week nobody trained, and the source rules already pass over a week with no plan, so the current week is planned from the last week that has one.
**Blocks:** chunk 42's merge (`build/chunk-42` at `1065cbb`; the rest of the chunk passed review) and chunk 52 (the tiles, planning on open, PLAN FORWARD); with them 43, 53, 54a, 54b, 55, 56, 65, 66, 68 and 69, which need 42 or 52. 44–51b, 57–64 and 67 go on.
**Options:**
- (a) When Plan opens it plans every week that has started and has no plan, oldest first, so no gap stays; `weekTiles` stays as built. The missed week gets the structure and no numbers (044), becomes the next week's source and COPY's "last week", and COPY then finds no numbers to copy.
- (b) The tiles run from week 1 through the current week whatever is planned, then the weeks planned ahead and the first unplanned one after the current week; a missed week's tile reads NOT PLANNED and opens read-only, empty, with no PLAN FORWARD; nothing is ever written for it. `weekTiles` changes (one rule and its tests: a builder retry, then review); how that tile looks is a display choice for 52.
- (c) As built: the tiles stop at the first unplanned week even when it is past; the current week (planned when Plan opens) can't be reached until each missed week is planned forward, one at a time, which writes past weeks with (a)'s COPY problem.
**Answer:**
**Evidence:** SPEC, Weeks and copying: "When a week (cycle) gets planned (2): when it starts, or earlier when the user taps PLAN FORWARD on it. Opening it doesn't plan it."; "How far ahead: Plan shows every week from week 1 to the last planned week, plus one more: the first week not planned yet … Nothing beyond the first unplanned week is reachable." Screens → Plan: "a tile per week (cycle) from week 1 to the first unplanned one, scrolling sideways; it opens on the current week." TASKS-1.2 chunk 42 pins planned {1,2,4} → tiles 1, 2, 3 without naming the current week (its Goal's "from 1 to `max(planned) + 1`" would give 1–5); chunk 52 plans "only the current week … when it has no rows", and Today's START and the missed-session prompt plan only the current week (F1). Nothing plans a week that starts while the app is closed, and a weekday run's week number is the calendar week since its start, so one week without Plan or a workout leaves a gap. A sequence run can't have one: a cycle only becomes past once each of its workouts is started or skipped, and starting or skipping one plans its cycle. The builder built (c), pinned it ("a current week beyond the tiles has no THIS tile": planned {1,2}, current week 6 → tiles 1, 2, 3) and raised it as a possible gap. It decides what Plan lets you reach and, under (a) and (c), what is written for past weeks, so D31 doesn't cover it. Cost: (a) and (c) change nothing in 42 (52 builds them); (b) changes `weekTiles` before 42 merges.

### 130 The exercise picker's choices where the boards differ or give no value (provisional, D31)
**Ask:** chunk 41 built the one exercise picker (boards PL4–PL6, PP2d, PP2d2, W11, W13–W15), which CHANGE THE PROGRAM (51a), the workout (59) and the stepped planner (68) will open for every swap and add. The boards draw it in three looks and leave some states undrawn; thirteen choices had no SPEC rule or single board value. Each stays as built unless you change it.
**Recommendation:** keep them; each is one value, one prop or one line in `src/components/ExercisePickerSheet.tsx`. (a) One look for every caller: W11, W13 and PP2d's hairline rows and a 44 px chip with a muted accent fill (PL4–PL6 draw bordered cards and solid chips). (b) The muscle group under each exercise's name, as PL4–PL6 draw it; the workout and the planner turn it off (W11, W13, PP2d draw the name alone). (c) Always the tall sheet (64 px below the top to the bottom edge, as PL4–PL6), so it doesn't jump when a chip changes the list; W14's question is content-sized. (d) PP2d's list is not edge to edge: the line above it is inset 16 px like every sheet's content (PP2d's rows are inset too; only that 1 px line runs to the edges). (e) A tap on the chip that is on goes back to ALL (the pickers it replaces did); a swap opens on its exercise's group, scrolled into view. (f) An exercise created in the sheet counts as a tap on its row: with a confirm it is the picked radio (W11) or asked about (W14), otherwise it is picked at once. (g) Words for states no board draws: LOADING…, COULDN'T LOAD EXERCISES with the reason, "Couldn't create the exercise." with the reason, NO OTHER EXERCISES (a swap with nothing else to swap to: the old week picker's words), "No exercises yet." (an empty library where nothing can be created); "You may be offline." only when the phone is (SPEC, Errors); no retry button on a failed load (close and reopen). (h) While a new exercise saves, the sheet shows only the field (W15's second card). (i) The name field is 16 px (the board's 15 makes iOS zoom); no length limit and no duplicate-name check (the server's message shows). (j) Text on the accent (CREATE, the confirm buttons) is `--base`, as 128 (g). (k) After an add in a list that stays open, the focus moves to the next row (else the one before, else the chip that is on). (l) A group whose exercises are all in the workout says NONE IN THIS GROUP even where creating is offered; "No forearms exercises yet." is for a group the library has nothing in. (m) W11's line over the button, which names the picked exercise, doesn't break a word with no break opportunity: a name of 35+ letters without a space runs past the sheet there, as 128 (i) records for the eyebrow and the Cues line (the rows and W14's title break it).
**Blocks:** nothing. No screen opens the picker before 51a, 59 and 68.
**Options:** each as built, or: (a) PL's look for CHANGE THE PROGRAM only (a `look` prop); (b) off by default; (c) content-sized where a board draws it so; (d) a `flush` option on `BottomSheet`; (e) a tap on the chip that is on does nothing; (f) a created exercise only selected, never picked at once; (g) other words, or a retry button; (h) the list kept under the field while saving; (i) a length limit or a duplicate check; (j) an `--on-accent` token, as 128 (g); (k) the focus back to the chips; (l) one wording for both; (m) breaking long words there too (one style), with 128 (i).
**Answer:** provisional under D31 until you change it.
**Evidence:** `src/components/ExercisePickerSheet.tsx`, `exercisePickerLogic.ts` and `BottomSheet.tsx`'s `height` and `toolbar` (#105, `64ebb52`); `design/1.2/built/{PL4,PL5,PL6,PP2d,PP2d2-*,W11,W13,W14,W15-*}.png` beside the boards (same elements, order and wording; the boards' sample chips and crops differ); (c), (e) and (k) seen in real Chromium, (m) in the reviewer's 375 px probe (644 px of text in a 341 px line). Not D31 choices, recorded so you see them: where TASKS and the boards differ, the sheet does both and each caller picks what its board draws: a swap with radio rows and a confirm (TASKS, W11) or a tap that swaps (PL4); "+ NEW [GROUP] EXERCISE" only for a caller that passes `onCreate` (W11, W15; PL4–PL6 and PP2d draw none); W14's question inside the sheet. For 59: today's swap confirm says how many remaining sets will be marked skipped; W11's line doesn't, so that count goes unless 59 puts it in the line.

### 129 The cues sheet's choices where SPEC and board 8 give no value (provisional, D31)
**Ask:** chunk 40 built the cues sheet (board 8), which Plan's set type picker (chunk 54a) and the workout's set ⋯ (chunk 61) will open. Six choices had no SPEC rule or board value; each stays as built unless you change it.
**Recommendation:** keep them; each is one value or one line in `src/components/pickers/`. (a) "+ NEW CUE" opens an input in the dashed button's place, outlined in the accent, with an ADD button (no board draws it: `design/1.2/built/8-new-cue.png`); Enter or ADD adds the cue, ticked, at the end of the list and puts the focus back on + NEW CUE; Escape closes the input only; DONE adds a cue typed and not yet added; the text is 16 px so iOS doesn't zoom. (b) A typed cue that matches a preset or one of your own cues, ignoring case, ticks that row as it is stored instead of adding a second cue: rows read with a capital first letter and a phone capitalises what is typed, so "Push here" typed would otherwise sit under the preset "Push here" as a second row that reads the same. TASKS' "`addTag` dedupes exact text" still holds for everything else. (c) "Use for all N sets" counts the exercise's working sets (the ones it writes to: never a warmup) and isn't drawn under two, as 128 (e). (d) Text on the accent (the ticks, DONE) is `--base`, as 128 (g). (e) No length limit on a typed cue (the column has none); a long unbroken cue wraps inside its row here, but runs past the set type picker's Cues line (128 (i)). (f) Your cues have no storage of their own (TASKS: "no new storage"): one typed and then unticked before DONE is gone when the sheet closes; a cue stored with a capital by the old editor (e.g. "Push here") is listed as yours beside the preset that reads the same.
**Blocks:** nothing. No screen opens the sheet before 54a (Plan) and 61 (workout).
**Options:** each as built, or: (a) another look or key behaviour; (b) exact text only (one line; "Push here" typed becomes a second cue beside the preset); (c) counting warmups, or drawing "Use for all 1 set"; (d) an `--on-accent` token, as 128 (g); (e) a maximum length; (f) merging case variants into one row.
**Answer:** provisional under D31 until you change it.
**Evidence:** `src/components/pickers/CuesSheet.tsx` and `pickerLogic.ts` (#103, `28b6d74`); `design/1.2/built/8.png` beside board 8 (same rows, order and wording), `8-new-cue.png` for (a); (b), (e) and (f) seen in the reviewer's renders and tests. Not a D31 choice, recorded so you see it: what "Use for all" writes is TASKS' answer (chunk 40: "the caller writes (`applyTagToAllHeads` …)"; 54a: "'Use for all' through `applyTagToAllHeads`"; 61: "applies to the exercise's heads"; SPEC: "fills one cue across an exercise's sets"): each cue the sheet returns is added to every working set of the exercise that week that lacks it, and no cue is taken off another set, so unticking a cue with "Use for all" ticked changes this set only. If you want every set to end up with exactly this set's cues, that changes 54a's and 61's writes, not the sheet.

### 128 The three pickers' display choices where SPEC and the boards give no value (provisional, D31)
**Ask:** chunk 39 built the set type, rep target and RIR target pickers (boards 5, 6, 7, PP3c, PP3d, W7a), which Plan, CHANGE THE PROGRAM, the stepped planner and the workout will share. Nine choices had no SPEC rule or board value; each stays as built unless you change it.
**Recommendation:** keep them; each is one value or one line in `src/components/pickers/`. (a) The stage stepper (DROPS, PAUSES, MINI-SETS, CLUSTERS) runs 1–10; SPEC gives no top end, and a larger count already stored shows as it is and can come down. (b) The rest steppers ("Rest after this set", REST BETWEEN): 15 s a tap, 10:00 at most, as the app's existing rest stepper; + on DEFAULT gives 0:15, as today; REST BETWEEN's first + goes one step past the kind's own rest (0:30 where the kind's is 0:15); − on the default does nothing; neither ever stores 0 s (only the default means no timer). (c) A segment picked with nothing to start from opens on the boards' examples: reps 8 or 8–10, RIR 2 or 1–2 (board 7's NUMBER box draws 8 above "SET RIR 2", a template leftover: 2 taken). (d) The number boxes are steppers, not inputs (the boards draw plain boxes; SPEC: "No tap-a-value shortcut"; the planner's typed rep targets are removed); FROM can't pass TO, and ends that meet set a number. (e) "Use for all N sets" isn't drawn when fewer than two sets would take it (then only the one set is set); "SET 1 REP" is singular. (f) Switching between staged kinds keeps the stage count (TASKS) and the set's rest between stages, as the old STAGE KIND chip did (it wrote the kind only); the kept rest shows under the new kind's REST BETWEEN. (g) Text on the accent (the picked segment, the footer button, the tick) is `--base`, as on every accent button in the app: dark on the accent in the dark theme, as the boards draw, but near-white on orange in the light theme (about 2.2:1; the boards draw near-black in both). (h) The FROM box's border and the picked radio are `--accent` (the boards' darker accent text has no token); REMOVE THIS SET is `--error`, lighter than the board's red in the light theme (no darker error token). (i) A word too long for its line (about 35 characters with no space or hyphen) runs past it: in an exercise name, the eyebrow's text runs under the × and off the sheet; in a cue, the Cues line runs under the chevron and the sheet's content can then be scrolled sideways. Names and cues with spaces wrap, and "Use for all" breaks such a word. The eyebrow is `BottomSheet`'s (chunk 38), the Cues line the picker's.
**Blocks:** nothing. No screen uses the pickers before 51a / 54a.
**Options:** each as built, or: (a) another top end; (b) + on DEFAULT starting from the exercise's own rest (the picker would need that value from its caller); (c) other starting numbers; (d) typed entry (a new interaction); (e) drawing "Use for all 1 set"; (f) the new kind's own rest on every kind change; (g) an `--on-accent` token in `tokens.css` (near-black on the accent in both themes, as the boards draw; a new token, yours to approve; it would fix every accent button); (i) breaking long words in the eyebrow and the Cues line (one style each).
**Answer:** provisional under D31 until you change it.
**Evidence:** `src/components/pickers/` (#101, `557e798`); `design/1.2/built/{5,6,7,PP3c,PP3d,W7a}.png` beside the boards; (g) and (i) seen at 390 and 375 px in the reviewer's renders. Not a D31 choice, recorded so you see it: REST BETWEEN in Plan (week-dependent) is drawn only for a set that names a program set of its own exercise. SPEC Rest [P1.1]: such a set's "set type picker shows no rest row and no REST BETWEEN"; TASKS F3: REST BETWEEN writes the run copy's program set "only where that program set belongs to the set's own exercise row". TASKS chunk 39's scope line ("REST BETWEEN under it except `plan-stable` and `workout`") lists the variants that never draw it and doesn't speak to that set; no board draws it. Read together, SPEC and TASKS agree, so nothing was picked.

### 127 The shared sheet frame's look where no token or board value decides it (provisional, D31)
**Ask:** chunk 38 built `BottomSheet`, the one frame of every 1.2 sheet (boards 2–8, W7, W10, W11, W13, W16, PL2–PL6, PP2c, PR8, PR13). Three display choices had no token or exact board value; each stays as built unless you change it: (a) the scrim, (b) the sheet's colour in the dark theme, (c) its layer.
**Recommendation:** keep them. (a) Black at 60 % (`rgba(0,0,0,0.6)`): no scrim token exists, and SPEC maps a board colour with no token to the nearest existing one (Design boards [1.2]); the boards draw near-black at 45 % (light) and black at 70 % (dark), the app draws 88 % near-black behind the Plan, Programs, planner and Library sheets (11 files) and 60 % black behind the Today and workout sheets (4 files), and 60 % is the nearer to both boards. (b) `--surface`, as the boards and TASKS say. (c) z-index 45: under the toast and the STAGING badge (50), above the update notice (40) and the workout bar (30).
**Blocks:** nothing. The frame is unused until chunk 39; 51a is the first screen to ship it.
**Options:** (a) 60 % (built) / 88 % (TASKS names the look of `ProgramsPage.tsx`'s sheet, which draws 88 %; heavier than any board) / a `--scrim` token in `tokens.css` with the boards' two values (a new token, yours to approve). (b) `--surface` (built) / `--surface-raised`, as the existing sheets draw. (c) 45 (built) / 50–60 like the old inline sheets.
**Answer:** provisional under D31 until you change it.
**Evidence:** `src/components/BottomSheet.tsx` (#99, `1a1f570`); `design/1.2/built/sheet-frame.png` beside `design/1.2/png/2-PlanCopySheet.png`, whose source draws `rgba(13,13,12,0.45)` light and `rgba(0,0,0,0.70)` dark. In the dark theme `--surface` (`#08080a`) is close to the scrimmed page, so the sheet shows mainly by its 1 px border, handle and content. With (c), an old inline sheet (50/60) or `ConfirmDialog` (70) open at the same time draws above a `BottomSheet`: right for a confirm opened from a sheet, wrong for a `BottomSheet` opened from an old sheet (no screen does that yet). Each is one value in the file; nothing is redone if you change it now.

### 126 Reviewer writes on staging: declined by the permission system in chunk 37's review
- What: whether reviewers' writes on staging as the staging accounts (every smoke logs one set; R2's calls in 47 and 53; the app checks from 51b) need a permission rule, after the permission system declined two of them in chunk 37's review.
- Answer: none needed, the condition (a second decline) did not occur: chunk 38's reviewer logged the smoke's set on staging (2026-10-15 00:08 UTC, bench set 3 in the in-progress session; the test account's set logs 203 → 204), which also runs chunk 37's unrun step. If a later reviewer is declined, it reopens. Full text in HISTORY.md.
- Date: 2026-10-15

### 125 The empty staging account now owns the app's 46 default exercises
**Ask:** the app inserts its 46 default exercises for any account that has none when it signs in (`useSeedDefaultExercisesIfEmpty`, mounted in `App.tsx`). Chunk 37's review signed in to the staging app as `staging-empty`, so that account now owns 46 exercises (still no program, run, session or settings row) and `staging-smoke.mjs`'s "empty: owns no exercises" fails: 54/55. For the build, should "empty" mean (a) what a new account has after its first sign-in, the default exercises included, or (b) no rows at all?
**Recommendation:** (a): every real new account has these exercises from its first sign-in, (b) can't survive the next check that signs in as it (chunks 65, 68, 69), and those checks (PR2, PR3, PR12, the New program flow; RC19, RC20, RC22, RC39) are about programs, not exercises. It takes a small change to the smoke's empty-account check (accept exactly the default set there), made by a builder in a fix PR or in the next chunk that touches the seed or smoke; your answer is the go-ahead, since it is in no chunk's scope as TASKS-1.2 stands.
**Blocks:** nothing before chunk 65. Until it's answered, every `staging-smoke.mjs` run on staging reads 54/55 with this one failure, which is not a regression.
**Options:** (a) the smoke accepts the default set on the empty account; (b) delete the empty account's exercises (as that account, with a `user_id` filter) after every check that signs in as it, and keep the check; (c) re-seed (rebuilds every account's data; the next app sign-in as the empty account creates the exercises again).
**Answer:**
**Evidence:** 2026-10-14, staging at `ac01e1a`: 22:35 UTC `staging-smoke.mjs` 55/55; 22:38–22:39 the reviewer signed in to the app (390 px, read only: Today, Settings, Plan) as the stable, sequence and empty accounts; 22:39 the smoke read 54/55, "empty: owns no exercises — 46", every other empty-account count still 0. 46 is the length of `DEFAULT_EXERCISES`. The smoke's sign-ins go through the auth API and run no app code, which is why the earlier 55/55 runs didn't see it. TASKS-1.2 (chunk 36's scope: "no programs, no runs, no exercises, no settings row") assumed an account could stay without exercises; the app seeded a new account's exercises long before 1.2. The reviewer didn't delete the rows: the permission system declined that write (126).

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
**Ask:** run, from your worktree `overload-v2-switch` on an up-to-date `master`: `npx --yes supabase@2.119.0 migration list --linked` and paste the output here. Expected: every version `000`–`041` in both the Local and Remote columns, nothing local-only.
**Recommendation:** do it once before the release's migrations PR. **When:** any time before the release. Read-only (Management API, your login).
**Blocks:** the release's migrations-first PR to master.
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

### 111 Fix session: B3 offline, Plan read-only, B6, B5, B4 merged (#72–#81)
- What: live-app fixes, no features, each its own PR with a failing test first, merged by the reviewer once green; code only, no migration, no write to existing data. B3 (offline): #72 session start sends a client id (a re-tap after a lost reply returns the row that landed); #73 one sync-queue flush at a time; #74 nine plan mutations in `useWeekPlan.ts` `networkMode: 'always'` (the eight named plus `useReorderWeekExercises`); #75 an online finish sends the queue first and queues behind unsent writes; #78 an offline finish classifies from every known log and is re-derived from the server on replay. #77 Plan: a completed or skipped session's rows are read-only (112). #79 B6: `apply()` single-flight. #80 B5: deload restore with a deleted program set (the set returns without the link; a session already left part-empty is fixed by unmarking it again). #81 B4: `ignoreCommand` compares with the last deployed commit, 166 characters (D28 updated).
- Answer: D30 parity proof for the finish changes (#75, #78): the frozen master render fixtures are untouched and `GymSession.d30`, `RestTimer.d30`, `GymSession.renderParity`, `GymSession.offline` pass unmodified; the empty-queue finish writes the same payload as master. Not changed, noted in CONTEXT.md Open items: a queue item that fails transiently is skipped and later items still replay. Not verified here: the new `ignoreCommand` on a real Vercel push (113e).
- Date: 2026-10-11

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

### 103 TASKS-1.1 chunk 31 merged: differences from the week's source highlighted (#68)
- What: chunk 31, code only. First independent review failed: an added set was "marked whole" (weight and RIR highlighted on week 1, against G34, and on stable weeks against "weights and RIR against last week"); several rules unproven (stable weights source skipping deload/empty weeks, a stage's RIR and reps, a partly-deload week). The one retry fixed and proved them; 51 earlier breaks re-run, all caught; the reviewer's own break caught.
- Answer: merged by the reviewer, `f07da39`. Provisional 104 (D31). Note: warmups are in the set position (G23 reading), so a warmup added above shifts every later set's comparison.
- Date: 2026-10-11

### 101 TASKS-1.1 chunk 30 merged: run-wide fields in Plan's STRUCTURE view (#67)
- What: chunk 30, code only. Independent review of the first push: 40 of 47 adversarial breaks caught; one regression (shared `usePrograms.ts` hooks stopped returning their invalidation promise, so the link toggle's `isPending` guard cleared early, in the planner too). The one retry fixed it and added the missing proofs (a superset member's set rests, run-wide writes on a sequence run's repeated workout, the week-cache restore); 129 breaks re-run, all caught; the reviewer's own two breaks caught.
- Answer: merged by the reviewer, `adc059f`. Provisional 102 (D31). Note for Adam: a swapped-in exercise keeps the replaced row's superset block (G35 reading), so editing that block's round rests, or linking the swapped-in exercise to a neighbour, changes the run's grouping (run-wide by SPEC).
- Date: 2026-10-11

### 100 TASKS-1.1 chunk 32's migration 040 merged (#66)
- What: `v2_program_sets.removed_at`, `v2_plan_week` skipping removed sets, `v2_make_week_default`. Builder's battery (114 verdicts, 29 break variants) re-run by the reviewer; D29 scratch-copy check re-run (no row changes); two independent reviewers with their own fixtures (correctness; safety, RLS, atomicity, concurrency) found nothing blocking. Empty sessions skipped like deload (provisional 99).
- Answer: merged by the reviewer under D29, `632959d`. Deploy succeeded (Supabase Preview); live probe 040.json and live check-embeds 30/30 pass.
- Date: 2026-10-10

### 99 Make-default: an empty normal session is skipped like a deload (deferred)
Severity: deferred
Chunk: TASKS-1.1 chunk 32 (migration 040)
**Ask:** When a stable week is made the new default and one of its workouts' sessions is normal but has no exercises, should that empty session become the workout's default (emptying it), or be skipped so the workout keeps its current default?
**Options:** (a) skip it, like a deload; in a sequence cycle take the first non-deload, non-empty occurrence; a week where every workout is skipped is refused. (b) Use it: the workout's default becomes empty (its rows soft-removed).
**Recommendation:** (a): `v2_plan_week` already skips empty occurrences as a copy source (DECISIONS 42), and (a) can't wipe a workout's default by accident.
**Blocked until answered/done:** nothing; 040 is built with (a). Flipping it is one predicate in `v2_make_week_default`, and nothing has used the action yet.
**Answer:** provisional (a), until you change it.
**Evidence:**
What happened: SPEC says "Deload sessions are excluded: their workouts keep the current default" and "this week's content becomes the run's default"; it's silent on an empty normal session. The 040 builder first read "normal" as "not deload" only, so an empty session would empty the default.
A competent default would: match the copy rule (skip empty) — doesn't apply as a silent default because it changes what's written to the run's copy.
Cost of deferral: if you choose (b), one predicate in a new migration (function replace), before or after the action is first used; defaults already made under (a) stay.

### 97 TASKS-1.1 chunk 29 merged: Plan's week in SETS / STRUCTURE views; COMPACT removed (#65)
- What: chunk 29, code only. Handlers unchanged (builder's 30-flow master/branch replay byte-identical). Independent review: scope and capabilities clean; 54 of 60 reviewer breaks caught on the first push; the tests-only retry (interrupted once by a container restart, resumed) pinned the other 6, two re-checked by the reviewer.
- Answer: merged by the reviewer, `3a94ae5`. Provisional 98 (D31). COMPACT's removal supersedes D6's compact view (entry 80).
- Date: 2026-10-10

### 96 TASKS-1.1 chunk 35 merged: a sequence run's current cycle (#64)
- What: chunk 35, code only. First review failed (a cold load could auto-plan the calendar week on a sequence run before programs loaded; COPY LAST CYCLE and per-control past-cycle gates were unproven; a failed read spun forever). The builder's one retry fixed all three; the reviewer's breaks (cold-load wait removed: 4 fail; copy gate at cycle−1: 2 fail) confirm.
- Answer: merged by the reviewer, `f5fe217`. Provisional 94, 95 (D31). Not changed (pre-existing class): an open weight editor still commits after a refetch moves the cycle past it.
- Date: 2026-10-10

### 93 TASKS-1.1 chunk 34 merged: stable weeks pair weights by set kind (039, #63)
- What: chunk 34, migration 039 only (`v2_plan_week` replaced). Passed review first time: the builder's scratch proof re-run by the reviewer, plus an independent fixture of 7 adversarial cases; 039 changed no existing row.
- Answer: merged by the reviewer under D29, `1c81818`. Deploy succeeded (Supabase Preview); live check-embeds 30/30.
- Date: 2026-10-10

### 92 TASKS-1.1 chunk 28 merged: priorities view-only in Plan (#62)
- What: chunk 28, code only. Passed review first time (reviewer re-ran every check and one break: a mark-named button beside a label fails 7 tests).
- Answer: merged by the reviewer, `0304a23`. Provisional display choices 90 and 91 (D31).
- Date: 2026-10-10

### 91 Plan's priorities: how a mark shows (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 28
**Ask:** How does a run's mark show on Plan's view-only priorities screen?
**Options:** (a) the accent mono label Plan rows use for a set's kind, on the row only where a mark is stored; a subgroup that only inherits its group's mark shows nothing (the group's label and the "X without Y" summary carry it). (b) The same, plus an "INHERITED: FOCUS" caption on inheriting subgroups.
**Recommendation:** (a): the standing UI rule says an unset feature shows nothing.
**Blocked until answered/done:** nothing; chunk 28 built (a).
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: SPEC says "Plan shows them view-only" and nothing about inherited marks; the old editor showed an INHERITED caption.
A competent default would: pick (a) and continue, which D31 says to do.
Cost of deferral: one line and its absence test.

### 90 After START, the Programs page opens the run's priorities, now read-only (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 28
**Ask:** After START on the Programs page, should the app still open `/plan/priorities` (now read-only), or open Plan?
**Options:** (a) leave it: it shows the marks the run copied. (b) Open `/plan`.
**Recommendation:** (a): it's not wrong, and changing it is outside chunk 28's scope and changes an existing test.
**Blocked until answered/done:** nothing.
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: `ProgramsPage.handleStartMeso` navigates to `/plan/priorities` after START (pinned by `ProgramsPage.test.tsx`); that screen used to be where a new run's marks were set. Found by chunk 28's builder.
A competent default would: leave it and continue (D31).
Cost of deferral: one navigate call and its test.

### 89 TASKS-1.1 chunk 27 merged: "only this week" removed (code #60, migration 038 #61)
- What: chunk 27, code first then 038 (P3). The first review failed (a stage-copy write no test pinned; a swap/reorder on a row the week no longer has stopped failing before writing); the builder's one retry fixed both.
- Answer: merged by the reviewer. Code `1f6816f`; 038 `70399ca` under D29 (check-migration exit 1, function only; replay, embeds and the scratch row check green). 038's deploy succeeded (Supabase Preview); live check-embeds 30/30. No live-app check: this container can't reach the app (31); it's in Adam's step 5 review.
- Date: 2026-10-10

### 88 G45: a set's own rest on a set with no program set of its own exercise
- What: TASKS-1.1 G45: can a set added in a week, or a set of an added or swapped-in exercise, have its own rest?
- Answer (Adam): no. "A set with no program set of its own exercise has no own rest; it uses its exercise's rest, then the global rest, as today" (option (c)). In SPEC Rest [P1.1] and TASKS-1.1 chunk 30.
- Date: 2026-10-10

### 87 Deload rules in Plan: where and how they show (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 33
**Ask:** Where next to the deload action do the rules in effect show, and in what form?
**Options:** (a) one read-only line under MARK WEEK AS DELOAD (MARK CYCLE AS DELOAD): the rules, and whether they're your default or this run's; nothing when no rules are on. (b) The same beside each session's DELOAD toggle. (c) Behind a ⋯ on the deload button.
**Recommendation:** (a): one place per week, next to the action that applies them, and an unset feature shows nothing (standing UI rule).
**Blocked until answered/done:** nothing; chunk 33 builds (a).
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: your G43 answer says "show the rules in effect read-only next to the deload action". Plan has two deload actions: MARK WEEK AS DELOAD above the panel, and a DELOAD toggle on each session.
A competent default would: pick (a) and continue, which D31 now says to do.
Cost of deferral: one line of UI and its screen test.

### 86 Plan's line for a run with no schedule (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 33
**Ask:** What does Plan show for a run with no schedule, now that one can't be set during a run?
**Options:** (a) "NO WORKOUTS SCHEDULED", then "Programs →" linking to the Programs page, the same for weekday and sequence runs. (b) Today's two messages ("NO DAYS SCHEDULED", "NO SLOTS SCHEDULED"), each with the new link.
**Recommendation:** (a): there's nothing left to set up per schedule type, so one message does.
**Blocked until answered/done:** nothing; chunk 33 builds (a).
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: your G39 answer says "an existing run with none shows a line linking to the Programs page". Only a run started before Start needed a schedule can be in this state.
A competent default would: pick (a) and continue, which D31 now says to do.
Cost of deferral: one string and its screen test.

### 85 START without a schedule: how it shows (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 33
**Ask:** How does START show that the program needs a schedule first?
**Options:** (a) START disabled, with one line under it: "Schedule at least one workout to start". (b) START enabled, and tapping it shows that message instead of starting.
**Recommendation:** (a): the reason shows before the tap, and nothing can start by accident.
**Blocked until answered/done:** nothing; chunk 33 builds (a), on the planner and on the Programs page.
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: your G39 answer says "the planner requires a schedule before Start". I read it as every START, the Programs page's included, because that page starts a run without opening the planner (TASKS-1.1 "Readings of the second answers").
A competent default would: pick (a) and continue, which D31 now says to do.
Cost of deferral: the button state, one line and their screen tests.

### 84 Highlighting: how Plan knows a week started empty (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 31
**Ask:** A week that started empty shows no highlighting (your G42 answer), but nothing records how a week started. How does Plan tell?
**Options:**
- (a) On a week-dependent run, while Settings → NEW WEEK STARTS is "empty", weeks after week 1 show no highlighting; so does a week with no source.
- (b) Only a session that's still empty shows none; once filled, it's compared with its source.
- (c) Record each week's source when it's planned (a column that `v2_plan_week` sets). Exact, but it changes data, so it's yours to choose.
**Recommendation:** (a): it matches your answer for anyone who builds weeks fresh, with no data change. It's wrong only for weeks planned before the setting was last changed.
**Blocked until answered/done:** nothing; chunk 31 builds (a).
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: `v2_plan_week` picks a week's source when it plans it (037 L325–333) but stores nothing about it, and `v2_week_plans` has no such column (001, 027, 037). A week also starts empty under "copy" when there's nothing usable to copy (DECISIONS 42).
A competent default would: pick (a) and continue, which D31 now says to do. (c) changes data, so it waits for you.
Cost of deferral: the rule in `weekDiff.ts` and one screen test.

### 83 Highlighting: the same exercise twice in one workout (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 31
**Ask:** Exercises are matched by identity (G23, G36). When a workout has the same exercise twice, which is matched with which?
**Options:** (a) In order of position: first with first, second with second. (b) By slot (the exercise's own row) first, then by identity.
**Recommendation:** (a): simplest, and the same as plain identity matching whenever an exercise appears once.
**Blocked until answered/done:** nothing; chunk 31 builds (a).
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: matching by identity is ambiguous only when an exercise repeats in one workout, such as a heavy and a light bench press.
A competent default would: pick (a) and continue, which D31 now says to do.
Cost of deferral: the matching rule in `weekDiff.ts` and its tests.

### 82 Highlighting: which exercises count as moved (provisional, D31)
Severity: deferred
Chunk: TASKS-1.1 chunk 31
**Ask:** Only the moved item is highlighted, and both when two neighbours trade places (G36). Which ones in other reorders?
**Options:** (a) Every exercise outside any of the largest groups that kept their order: one exercise moved past two others is the only one, two neighbours that traded places are both, and two such pairs are all four. (b) One per tie, chosen by a fixed rule such as the lower one.
**Recommendation:** (a): it's the general form of your "both", with no tie-break rule to explain.
**Blocked until answered/done:** nothing; chunk 31 builds (a).
**Answer:** provisional under D31: (a), until you change it.
**Evidence:**
What happened: a reorder can have more than one smallest set of "moved" exercises. Two neighbours trading places is the simplest case, and you answered it.
A competent default would: pick (a) and continue, which D31 now says to do.
Cost of deferral: the order rule in `weekDiff.ts` and its tests.

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
