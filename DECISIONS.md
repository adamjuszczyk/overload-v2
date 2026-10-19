# Overload — Decisions

## Waiting on Adam
*Rewritten at every boundary. Last: 2026-10-19, Adam's answers to 172, 173 and 174 written in (docs only).*
- *173 and 174 are answered: chunk 46m (migration 044, `v2_set_logs.added_place`: one nullable column, no default, no row touched) goes first, merged and live on staging; then chunk 46's sixth attempt, on Opus, uses it. One more behaviour failure stops 46 for a redraw (your words).*
- *`v2_plan_week` is now migration 045 (chunk 53), as you numbered it; 044 is in "For the release" with 042 and 043.*
- *172: the other eleven display choices are accepted, (l) included; (j), Plan's "CHANGE THE PROGRAM FROM WEEK N" button, follows the screen's rule box and goes to the second display follow-up (d31b).*
- *The smoke fix (your third bullet: the empty account may have no exercises or exactly the defaults) is pending; chunk 51b's next reviewer makes it, so the smoke reads 51/51.*
- *What follows: 51b's tests-only retry, 46m, then 46's sixth attempt; d31b; then 52 onward; 58a–64 once 46 merges.*

Decisions:

To-dos:
- **121** — Before the release: prove production's migration history with one read-only command (entry 121). When: any time before the release. Blocks: the release's migrations PR.
- **113** — live-check the fix session (this container can't reach the app). When: next gym visit. (a) Plan: finish a session, open Plan on the current week: its sets can't be edited, the line reads SESSION DONE — READ ONLY; reopen it and they can. (b) Train a few sets in airplane mode, reconnect, finish at once: the session is `completed`, not skipped, with a sensible end time. (c) Plan: after an edit that offers "apply to planned weeks ahead", tap APPLY twice fast: sets are added once. (d) Unmark a deload whose program set was deleted: sets come back. (e) answered 2026-10-14: #87's docs-only merge read "Canceled by Ignored Build Step". (f) #83: log sets with a flaky connection; a write that can't sync shows "N changes couldn't sync. Tap to retry." at the top of the workout screen, and tapping it sends them. Blocks: nothing.
- **79** — Confirm REDO SESSION is gone on a finished session's Today screen. When: after a session. Blocks: nothing.

## For the release
*Every migration `check-migration` flags during the 1.2 build, one line each (number, PR, what it flags). At the release Adam gets one blocking decision covering all of them (CONTEXT.md, "Staging and the 1.2 build").*

- **042** — chunk 36 (#95): `check-migration` exit 1 on three statements: two `ADD COLUMN` carrying a CHECK (`v2_week_plan_sets.target_rir_max`, `v2_user_settings.stage_volume_rule`: "new column carries a constraint or generated value") and `notify pgrst, 'reload schema'` ("not on the safe list"). Add-only: 3 columns, nullable or defaulted, whose checks every existing row satisfies, and 3 empty tables; no existing row changes.
- **043** — chunk 47 (#137): `check-migration` exit 1 on five statements:
  - `alter table v2_program_exercises add column if not exists replaces_program_exercise_id uuid references v2_program_exercises(id) on delete set null` ("foreign key action can change existing rows later");
  - `create or replace function v2_apply_ops`, `revoke execute`, `grant execute`, `notify pgrst` (each "not on the safe list").

  Add-only: one nullable column with no default (every existing row reads NULL) and a function nothing calls until 51a; no existing row changes. The reviewer's grep outside the function body found no update, delete, insert, drop, default or NOT NULL; its one hit is the key's own `on delete set null`. Its own staging deploy failed at the config step, a config-sync failure only, and the next push's deploy applied it (156, answered; verified live 2026-10-16).
- **044** — chunk 46m, not built yet: `v2_set_logs.added_place integer null` with `check (added_place is null or added_place >= 1)`; no default, no backfill, no existing row touched (DECISIONS 174 (a), Adam 2026-10-19). It goes in the migrations-first PR with 042 and 043 (Adam's words). `check-migration` must pass as additive; if it flags the check, as it flagged 042's, the flag is recorded here at 46m's merge.
- **045** — chunk 53, not built yet: `v2_plan_week` with the 1.2 copy rules (numbered 044 until Adam's numbering answer (a), 2026-10-19). `check-migration` will flag "function"; recorded here at 53's merge.
- **149's data migration** — chunk 53, its number assigned there, after 045 (DECISIONS 149 (c), Adam 2026-10-16): makes each active week-dependent run's program match its last planned week (exercises and order), so nothing the user sees changes. It touches existing rows (the run copies' `v2_program_exercises`: `week_only`, `removed_at`, `position`), so it is **blocking**: the manual backup first (TASKS-1.2 Release, step 3), then Adam's decision, with before/after counts and a fingerprint as in its staging rehearsal. Not applied to production during the build.
- Update notes: Coach may skip analysing the one week in which a run's weekdays change (DECISIONS 159, Adam 2026-10-16).

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
- Answer: (Adam, 2026-10-16) "(c). Narrow the app's op type so v2_programs and v2_workout_days allow update only, no delete, with a test. No migration." Queued for the second display follow-up (d31b). Full text in HISTORY.md.
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
- Answer: (Adam, 2026-10-19) "I meant the item about Plan's "CHANGE THE PROGRAM FROM WEEK N" button naming a different week than the screen's rule box when the week's last open session is in progress — whichever letter that is in the entry. The button follows the screen. The other eleven are accepted." That item is the entry's (j) (his earlier "(l)" was the letter he gave; (l) as listed, a superset's within-round rest stored as 0 reading 0:00, is among the eleven accepted, and so are (a)–(i), (k)). The button fix goes to the second display follow-up, d31b (CONTEXT.md, "Where the build is"): the button names the same week as the screen's rule box (a session in progress is left as it is, so changes start the week after). Full text in HISTORY.md.
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
- Date: 2026-10-19

### 155 The display follow-up's own display choices (provisional, D31)
- What: three display choices of the display follow-up (#135) with no exact word from Adam: (a) a picker switched to a segment the set doesn't have starts from the boards' examples (12 → RANGE 8–10, 6–9 → NUMBER 8); (b) the typed boxes (a number past the bounds held to the nearest one, an emptied box back to its number); (c) the cues sheet's rows keep wrapping a long cue.
- Answer: (Adam, 2026-10-16) "(a) changed: a picker switched to a segment the set doesn't have carries the set's own value over: NUMBER n → RANGE n–(n+2); RANGE a–b → NUMBER a. The boards' examples are used only when the set has no target at all. (b) and (c) accepted." So (a) changes, in the second display follow-up (d31b); (b) and (c) stand. No SPEC rule says what a picker's segment switch starts from, so (a) has no SPEC line (as 128's starting target). Full text in HISTORY.md.
- Date: 2026-10-16

### 154 Text on the accent in Coach, which is frozen: included or not? (the display follow-up)
- What: whether frozen Coach's 15 places with text on the accent (still `--base`) take `--on-accent`, and whether "wherever" also covers the screens 1.2 doesn't rebuild, which the display follow-up (#135) converted.
- Answer: (Adam, 2026-10-16) "no. Coach stays exactly as it is. --on-accent applies to the screens 1.2 rebuilds and the shared components they use; screens 1.2 doesn't touch keep their current code." Written into SPEC.md (Design boards → Scope of the look). The second display follow-up (d31b) takes `--on-accent` back off the screens 1.2 doesn't rebuild and their non-shared components; Coach is untouched. Full text in HISTORY.md.
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
- Answer: (Adam, 2026-10-15) "accept them. The app creates the 46 default exercises when a new account first signs in; that is real behaviour. "Empty" means no programs, runs or sessions; the smoke asserts exactly that, and that the account's exercises are the defaults." Done in chunk 44's review (its docs PR; a verification-script change made by the reviewer): the smoke's empty account owns no programs, runs or sessions and exactly the app's `DEFAULT_EXERCISES`, read from the app's source, proven by `staging-smoke.test.mjs` and on staging (a throwaway exercise that isn't a default failed exactly that check; removed); 51/51 on staging. TASKS-1.2's Seed table says so. Full text in HISTORY.md.
- Date: 2026-10-15

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
