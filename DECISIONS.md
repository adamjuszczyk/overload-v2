# Overload — Decisions

## Waiting on Adam
*Rewritten at every boundary. Last: 2026-10-16, chunk 50's review (the weekday schedule in force per week): merged (#142).*
- *Chunk 50 merged. Today (the missed-session prompt, the rest-day count, "next up") and Plan's weekday chips now read the weekdays in force for each week, so a weekday change that starts next week (51b) leaves this week's days alone. No staging run has a schedule change yet, so nothing on screen changed: checked on all four accounts before and after the merge. One real schedule row changed exactly that week's screens on staging, and deleting it brought them back.*
- *The builder also changed the rest-day screen's "N of M sessions done this week", which TASKS' file list missed. It stays: without it, after a 51b change from three days to four, that week would read "0 of 4" while Today offers three sessions.*
- *Two new readings for you. 159: Coach (frozen) still expects the run's newest weekdays in every week, so the week of a 51b weekday change would never be analysed; it blocks nothing in the build, and needs your answer before the release. 160: the builder's display choices (D31).*
- *156 still waits on you and holds 51a. This merge's own deploy worked (three runs, one success), so it adds nothing to 156. The smoke passed: 51/51 and every tab; its log step is "waiting on re-seed" (138). Each list is ordered by what it blocks.*

Decisions:
- **151** — what UNLOG does to the set numbers (chunk 46). A logged set shows the number it was logged with, and an open set shows the next number after the logged ones. So unlogging a set that isn't the last one logged leaves two rows with one number. With bench 01–03 logged, UNLOG on 02 shows 01, an open 03, 03, 04. Logging it again stores a second set 3, which History shows. SPEC 18c says only "with its numbers kept" and "logging again undoes it". Recommended: (a), as a delete does: the logged sets after it move down one, and logging it again gives it the next number (it can come back as 03). Blocks: chunk 46's merge, and so 58a–64; 63 writes it. Nothing before 58a.
- **149** — weeks a week-dependent run changed in 1.1's week view (chunk 45). In 1.1 such a run's exercise changes lived in its weeks: SWAP or ADD made a week-only exercise, REMOVE took one out of that week, and the run's program never changed (the program tab went in 1.1; Make default is stable-only). From 044 on (chunk 53; production at the release), 143's copy follows the program's list. So the first copy from such a week brings back an exercise removed in 1.1 (with no sets) and takes the program's order. The week-only exercises stay in every later week, and nothing in 1.2 can remove them (executed probe). Held against [P1.1]'s "Existing data" line, as you asked, it isn't fully answered: "copying uses each week's actual content" keeps a week-only exercise, as built, but for an exercise 1.1 removed from a week while the program still lists it, and for a week whose order 1.1 changed, the line gives the week's content and 143's line the program's list, and neither says which wins; nor does the line say how a week-only exercise is ever removed. Recommended: (c) once, at the release, make each active week-dependent run's program match its last planned week, so nothing you see changes. Blocks: chunk 53 and the release; nothing before 53.
- **152** — a warmup logged with no weight or reps, made a working set during the workout (chunk 46, for 62). SPEC lets a warmup be logged without numbers, and its edit panel has SET TYPE. The database refuses a working set without both numbers (executed: `23514`). Recommended: (a), ask for the numbers first: the working type is saved together with the weight and reps typed in the panel, in one write. Blocks: chunk 62; chunk 46 only if answered (c), where the switch makes it a set still to do.
- **159** — Coach's weekly analysis after a weekday change (chunk 50, for 51b; Coach is frozen). Since chunk 50, Today and Plan read each week's own weekdays. From 51b, a weekday change starts next week, and the run copy then holds the new days. Coach's week resolution still reads the run copy for every week (your D15: "derived from `program.schedule`"). Executed: after a week-2 save that also puts Arms on Friday from week 3, Today offers week 2 Tue, Thu and Sat, while Coach expects Friday too. So with every session done, that week is never complete and never analysed. Recommended: (a), Coach resolves each week through the same schedule rows (a Coach change, with the freeze's base moved). Blocks: nothing in the build (Coach runs for your account only, which isn't on staging); answer before the release.
- **157** — a delete op on a run's workout or program (chunk 47). For `v2_programs` and `v2_workout_days`, TASKS says "only an update is allowed — no inserts of those". As built, the executor refuses the inserts and accepts a delete, the reading chunk 45's merged op type took. Executed: a delete of a run's workout removes every week plan of that workout (its sessions and logs stay); a delete of the run's program is refused by its run. No 1.2 screen sends either, and the API already lets you make the same delete. Recommended: (a), keep it as built; (c) narrows the app's op type with no migration; (b) refuses it in SQL with a later migration. Blocks: nothing.
- **154** — text on the accent in Coach, which is frozen (the display follow-up). Your answer puts `--on-accent` "wherever text sits on the accent".
  - Coach draws such text in 15 places (9 files), still `--base`: near-white on the accent in the light theme.
  - Coach is frozen (Escalation 16), so no Coach line changes without you.
  - Recommended: (a) include it: the 15 colour values and nothing else in Coach, with the freeze's base moved to that commit, so the whole app reads the same.
  - Also read from your words: "wherever" covers the screens 1.2 doesn't rebuild (Today, History, Progress, Library, Settings, sign-in), though SPEC's "Scope of the look" keeps their code. Say so if you meant the 1.2 screens only.
  - Blocks: nothing. The follow-up merged without Coach (#135). (a) is a small change of its own: the 15 colour values, the freeze's base moved, and the Coach exception in `textOnAccent.static.test.ts` deleted.
- **128 (g)** — where the new `--on-accent` token goes. Your answer says "in global.css for both themes", and SPEC calls global.css the home of the accent variables, but the app declares every colour value, for both themes, in `src/styles/tokens.css`; global.css only maps them to Tailwind classes and has no theme blocks. The display follow-up built it as recommended: the value in tokens.css (both theme blocks) and its Tailwind mapping in global.css, as `--accent` itself is done. Blocks: nothing. It is display only (D31): it stays so unless you move it.
- **155** — the display follow-up's own display choices (D31), each as built (#135) unless you change it:
  - (a) A picker switched to a segment the set doesn't have starts from the boards' examples: 12 → RANGE gives 8–10, and 6–9 → NUMBER gives 8. The set's own segment keeps its numbers, so 6–9 → NUMBER → RANGE is 6–9 again. That is your words read literally; the first attempt carried the set's number over instead (12–14).
  - (b) The typed boxes: a number past the bounds is held to the nearest one when the box is left (150 reps → 100), and an emptied box goes back to its number.
  - (c) The cues sheet's rows keep wrapping a long cue as built.
  - Blocks: nothing.
- **153** — the order of a set's two REVIEW items (chunk 43, for 56; display only). With your 150 (b), a set whose type you change during a workout and then skip or never log gives two items. As built, "Skipped" / "Not logged" comes first and the type item right after it, the order a done set's number item and type item already have (139, accepted). Blocks: nothing. It is display only (D31): as built unless you change it.
- **158** — chunk 49's display choices (D31), each as built (#140) unless you change it. Settings has no board; SPEC's "keeps its current look" and TASKS' words decided the rest:
  - (a) "Log sets in order" is in a section of its own titled WORKOUT, right after REST TIMER (the page has no WORKOUT group; TASKS: "in WORKOUT (next to the rest timer rows)").
  - (b) The toggle reads "Log sets in order" in sentence case, as SPEC spells it and like the page's other toggles; the chip row's label is in capitals like its neighbours.
  - (c) The two explanation lines are TASKS' words, in small muted text under their rows.
  - (d) At phone widths each chip takes two lines ("WHOLE SET =" over "1"); nothing is clipped.
  - (e) For chunk 60: board W7b's question ends `TURN OFF "LOG IN ORDER" IN SETTINGS`, but SPEC calls the setting "Log sets in order" three times, once about that very line. SPEC wins over a board, so 60's line names the row as it reads.
  - Blocks: nothing.
- **160** — chunk 50's display choices (D31), each as built (#142) unless you change it:
  - (a) Until a weekday run's schedule rows have loaded, Today and Plan show their existing spinner, and a failed read keeps it there, as Today already does when its other reads fail (a workout in progress included). Falling back to the run copy's days could show next week's days in this week.
  - (b) In Plan, stepping to a week where the selected weekday has no workout selects that week's first day (the existing rule, now reachable).
  - Blocks: nothing.

To-dos:
- **156** — read the log of 043's failed staging deploy (chunk 47).
  - The `Supabase Preview` run on the merge (#137, `5762d4a`, 2026-10-16 07:10 UTC) failed in four seconds at the config step: "Failed to update config for branch: staging". 043 didn't apply.
  - The next push's run (#138, `43f1fc8`, 07:26 UTC) succeeded and applied it: the column probe is green, and R2 passed as the test account.
  - When: now. Please read the Branches log for the failed run, and say "go on" (or what to fix).
  - Blocks: until you have read it, the chunks that need 043 (51a first; then 52's COPY, 56, 61 and 53). Not 49 or 50.
- **138** — your re-seed on Monday 2026-10-19: paste `supabase/seed.sql` into the staging branch's SQL editor and say "re-seeded". When: Monday 2026-10-19 (the seed's dates are relative to the day it runs). Blocks: nothing stops (your rule, 2026-10-15): until then a staging check that needs open sets in the seed's in-progress session and finds none is recorded "waiting on re-seed" in 138 and runs after the re-seed. The in-progress session has no open set left: the display follow-up's smoke logged its last one, the second drop of Cable Triceps Pushdown set 2 (set logs 213 → 214). So every smoke's log step is "waiting on re-seed" until then (chunk 47's, 49's and 50's smokes found Today with no LOG button); the seed's week 3 ends Sunday 2026-10-18.
- **121** — Before the release: prove production's migration history with one read-only command (entry 121). When: any time before the release. Blocks: the release's migrations PR.
- **113** — live-check the fix session (this container can't reach the app). When: next gym visit. (a) Plan: finish a session, open Plan on the current week: its sets can't be edited, the line reads SESSION DONE — READ ONLY; reopen it and they can. (b) Train a few sets in airplane mode, reconnect, finish at once: the session is `completed`, not skipped, with a sensible end time. (c) Plan: after an edit that offers "apply to planned weeks ahead", tap APPLY twice fast: sets are added once. (d) Unmark a deload whose program set was deleted: sets come back. (e) answered 2026-10-14: #87's docs-only merge read "Canceled by Ignored Build Step". (f) #83: log sets with a flaky connection; a write that can't sync shows "N changes couldn't sync. Tap to retry." at the top of the workout screen, and tapping it sends them. Blocks: nothing.
- **79** — Confirm REDO SESSION is gone on a finished session's Today screen. When: after a session. Blocks: nothing.

## For the release
*Every migration `check-migration` flags during the 1.2 build, one line each (number, PR, what it flags). At the release Adam gets one blocking decision covering all of them (CONTEXT.md, "Staging and the 1.2 build").*

- **042** — chunk 36 (#95): `check-migration` exit 1 on three statements: two `ADD COLUMN` carrying a CHECK (`v2_week_plan_sets.target_rir_max`, `v2_user_settings.stage_volume_rule`: "new column carries a constraint or generated value") and `notify pgrst, 'reload schema'` ("not on the safe list"). Add-only: 3 columns, nullable or defaulted, whose checks every existing row satisfies, and 3 empty tables; no existing row changes.
- **043** — chunk 47 (#137): `check-migration` exit 1 on five statements:
  - `alter table v2_program_exercises add column if not exists replaces_program_exercise_id uuid references v2_program_exercises(id) on delete set null` ("foreign key action can change existing rows later");
  - `create or replace function v2_apply_ops`, `revoke execute`, `grant execute`, `notify pgrst` (each "not on the safe list").

  Add-only: one nullable column with no default (every existing row reads NULL) and a function nothing calls until 51a; no existing row changes. The reviewer's grep outside the function body found no update, delete, insert, drop, default or NOT NULL; its one hit is the key's own `on delete set null`. Its own staging deploy failed at the config step, and the next push's deploy applied it (156).

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

### 156 Migration 043's staging deploy failed at the config step; the next push's deploy applied it (chunk 47; to-do, blocking)
**Ask:** Chunk 47 merged into `staging` as #137 (`5762d4a`) at 07:10 UTC on 2026-10-16. The `Supabase Preview` run on that commit failed in four seconds with "Failed to update config for branch: staging", and migration 043 did not apply. The next push to `staging` was this review's docs merge (#138, `43f1fc8`, 07:25 UTC). Its run succeeded and applied 043, and chunk 47's staging steps then passed. A failed staging deploy is blocking until you have read the Branches log (CONTEXT.md, Repo facts). Please read the log for the failed run (Dashboard → Branches → staging, 07:10 UTC) and say "go on", or what to fix.
**Recommendation:** "go on", unless the log names something in the repo. The failed step applies `supabase/config.toml` to the branch, before any migration runs. That file hasn't changed since #91 (2026-10-14), and the same file deployed 16 minutes later. So it looks like a passing fault on Supabase's side; only the log can say. — **When:** now.
**Blocks:**
- Until you have read it, the chunks that need 043 live: 51a first (its SAVE is the first caller), then 52's COPY, 56, 61, and 53 (044 reads the link column).
- Not 49 or 50, which don't touch 043.
- Nothing is left to run for chunk 47: its staging steps passed after the second deploy.

**Evidence:**
- **The failed run.** `gh api …/check-runs/116857241099`: app `supabase`, 07:10:05 → 07:10:09, `failure`, summary "Failed to update config for branch: staging". Read with `?filter=all`, it is the only run on `5762d4a`. A deploy that works shows three runs (two left `in_progress`, one `success`), as on `43f1fc8`, `e5b90ce` and 042's `8aeff32`.
- **The earlier runs.** The 13 staging pushes before it (`5ff951d` to `e5b90ce`) and 042's own merge (`8aeff32`, 2026-10-14) all show `success`. No earlier "Failed to update config" is recorded anywhere.
- **043 didn't apply on the failed run.** Before and after it, `probe-live-columns 043` answered the column with `400 42703`, and `rpc/v2_apply_ops` answered `404 PGRST202`, signed out and signed in.
- **The next run applied it.** `43f1fc8`'s run 116862656011 succeeded (07:26:07 → 07:26:14). At 07:26:36 the probe was green (the column `200 []`, the control `400 42703`), and the live embed check resolved 30 of 30.
- **R2 on staging**, signed in as `staging-test`, under staging's pg-safeupdate:
  - `[]` → `0`.
  - An update of a week 3 Upper A set's `target_weight` (11.5 → 14), then a second update back → `2`; the set reads 11.5 before and after.
  - A list whose op 2 names a `v2_set_logs` row → `P0001 "table not allowed"`, details "op 2 names v2_set_logs"; op 1's 14 is absent.
  - Signed out → HTTP 401 `42501`, "permission denied for function v2_apply_ops".
  - `select=*` on `v2_program_exercises` carries the column on all 49 rows.
- **The app.** The Vercel staging deploy is BUILD `5762d4a`, stylesheet unchanged. `staging-smoke.mjs` passed 51/51 and the browser smoke opened every tab with no error text, both before and after 043 applied.
- **The chunk itself passed review on the real image before the merge.** That covered the replay, the embeds, the reviewer's own 29-case SQL proof and its 11 breaks, and every script. Long form: HISTORY.md, "2026-10-16 chunk 47 review" and its follow-up.

### 157 043 accepts a delete of a run's workout or program; TASKS says "only an update is allowed" (chunk 47)
**Ask:** TASKS-1.2 chunk 47's Scope says, inside its insert clause: "(and, for `v2_programs` / `v2_workout_days`, only an update is allowed — no inserts of those)". As built (#137), `v2_apply_ops` refuses an insert into either table and accepts a delete of a row of either. That is the reading chunk 45's merged op type took: `DeletableTable` is every listed table but `v2_week_plans`, and CONTEXT.md says 47 is written against it. Read literally, "only an update" refuses the delete too. Which did you mean?
**Recommendation:** (a), keep it as built. No 1.2 chunk builds such an op: SPEC's CHANGE THE PROGRAM never adds or removes a workout, and chunk 66's DELETE goes through `useDeleteMeso`. Row-level security already lets the signed-in user make the same delete through the REST API, so the executor adds no capability; (b) would cost a migration for an op nobody sends.
**Blocks:** nothing. (b) or (c) can be done any time before the release.
**Options:**
- (a) As built: a delete is allowed on both tables, as on every listed table except `v2_week_plans`.
- (b) Update only, as the words say: a later migration replaces the function with two more refusals (`delete not allowed on v2_programs` / `v2_workout_days`), and `DeletableTable` drops both tables.
- (c) Refused in TypeScript only: `DeletableTable` drops both tables, so no op list the app builds can hold such a delete. No migration.

**Answer:**
**Evidence:** executed on a replay of 000–043 (`supabase/postgres:17.6.1.155`), as the signed-in role, rolled back (the reviewer's case R24):
- A delete op on a run's `v2_workout_days` row is accepted, and it cascades through every week plan of that workout: the fixture's week plans went from 2 to 0 and their sets from 3 to 0. The session stays, with `week_plan_id` NULL, and keeps its log.
- On the run's `v2_programs` row the delete is refused by `v2_mesocycles_program_id_fkey` (`23503`). On a saved program it would land.
- The builder asserts the delete on purpose (its scenario D05), but did not list it among its judgement calls.
- The function's other departures from TASKS' words are the four judgement calls the builder listed (the revoke from anon, the input refusals, NULL rather than the default, the committed proof), all accepted in the review. Long form: HISTORY.md, "2026-10-16 chunk 47 review".

### 158 Chunk 49's display choices where SPEC and TASKS give no layout (provisional, D31)
**Ask:** Chunk 49 added Settings' two [1.2] rows. Settings has no board: SPEC says it "keeps its current look", and TASKS gives the words. These choices were the builder's, under D31. Each stays as built (#140) unless you change it:
- (a) Where "Log sets in order" sits. TASKS says "in WORKOUT (next to the rest timer rows)", but the page has no WORKOUT group: SPEC's grouping into Workout, Planning, Language and Appearance is [P2]. As built, it is a section of its own titled WORKOUT, right after REST TIMER and before SET TIMING. The alternative would be a row inside the REST TIMER card.
- (b) The toggle's label is "Log sets in order", in sentence case. That is SPEC's spelling and matches the page's other toggles ("Show rest timer"); TASKS writes it in capitals. The chip row's label is in capitals, "DROPS AND STAGES COUNT AS", like the page's other chip labels.
- (c) The two explanation lines are TASKS' words verbatim: "Off: LOG never asks." and "For Plan's VOLUME sheet. History and Progress count as before." Each is in small muted body text under its row.
- (d) At phone widths each of the three chips takes two lines ("WHOLE SET =" over "1", at 390, 375 and 320 px). Nothing is clipped or overflows. A non-breaking space before the number would keep "= 1" together.
- (e) For chunk 60: board W7b's lock question ends `DON'T WANT THIS QUESTION? TURN OFF "LOG IN ORDER" IN SETTINGS.` SPEC names the setting "Log sets in order" three times: under Settings, under Screens → Settings, and in the sentence about this very line ("a line saying the lock can be turned off in Settings ("Log sets in order", W7b)"). SPEC wins over a board ("Design boards [1.2]"), so 60's line names the row as it reads: "LOG SETS IN ORDER".

**Recommendation:** keep all five as built. (a) to (d) keep the page's look with the least new layout; (e) is SPEC's own wording.
**Blocks:** nothing. Each is a short change; (e) is chunk 60's to build.
**Options:** for each, as built or the alternative named.
**Answer:**
**Evidence:** the deployed screen, read by the reviewer as the test account on staging after the merge: the two rows where (a) says, the selected chip's text in `--on-accent` in both themes, no overflow at 390, 375 and 320 px, and both values persisting through a reload. Long form: HISTORY.md, "2026-10-16 chunk 49 review".

### 159 Coach's weekly analysis reads the run's newest weekdays for every week (chunk 50, for 51b; Coach is frozen)
**Ask:** From chunk 51b, CHANGE THE PROGRAM can change a run's weekdays. The new days start next week, stored as `v2_run_schedules` rows, and the run copy's `schedule` holds the new days (chunk 45's writer). Since chunk 50, Today, Plan and the missed-session prompt read each week's own days. Coach doesn't: `weekResolution.ts` takes a week's expected sessions from the run copy's `program.schedule`, for every week (your D15: "By plan resolution derived from `program.schedule`"). Should Coach read the days in force for the week, as Today does? Coach is frozen (Escalation 16), so either way it is your call.
**Recommendation:** (a). D15 chose `program.schedule` because it is what Today prompts about. The file's own header: "a date the scheduler never prompts about can't be skip-marked through any existing UI, so using the weekly-plan layer instead would risk a permanently unanalyzable week". Since 50, Today prompts by the week's own days, so (a) keeps D15's reason.
**Blocks:** nothing in the build: Coach runs for your account only, which isn't on staging. Answer before the release, which brings 51b's weekday change to production.
**Options:**
- (a) Coach resolves each week through `scheduleForWeek` over the run's rows and the run copy, in its week resolution and in its Q&A context. This is a Coach change: its server-side reads add `v2_run_schedules`, and `check-frozen-code.mjs`'s base moves to it.
- (b) As built: Coach expects the run's newest days in every week. After a change that adds or moves a day, the week of the change expects a day Today never offered in it. So that week is never complete and never analysed, and the same goes for an earlier week not yet analysed. Q&A's "this week" lists the new days. A day taken off is simply not expected.

**Answer:**
**Evidence:**
- Read in the frozen code: `resolveWeek` reads `program.schedule[dow]` for each date of the week, and `isComplete` needs every expected date completed or skipped. `coachWeekService.ts` lists only complete weeks, `api/coach/analyze-week.ts` refuses an incomplete one, and `qaContext.ts` hands Q&A this week's and next week's expected sessions.
- Executed in chunk 50's review: chunk 45's `planProgramChange` (what 51b's SAVE calls) was applied to the G14 world in week 2, with Arms also on Friday from week 3. It writes rows `from_week` 1 (Tue, Thu, Sat) and `from_week` 3 (Friday added), and puts all four days in the run copy. Today's scheduler then offers week 2 Tue, Thu and Sat, with no Friday. With those three sessions done, `resolveWeek` for week 2 expects Tue, Thu, Fri and Sat, so `isComplete` is false. Against the run copy before the save (the control), the same sessions are complete.
- Nothing differs until a run has a schedule row: none exists on staging, and no screen writes one until 51b. Flagged by chunk 50's builder (its report, section 3, item 5).

### 160 Chunk 50's display choices (provisional, D31)
**Ask:** Chunk 50 reads each week's weekdays from the run's schedule rows. Two things it shows have no word in SPEC or TASKS. The builder chose them under D31, and each stays as built (#142) unless you change it:
- (a) Until a weekday run's schedule rows have loaded, Today and Plan show their existing spinner (a sequence run waits for nothing). If the read fails, they stay on it, as Today already does when its other reads fail (programs, sessions, week plans), a workout in progress included. Plan has no load error for this read: board 12's "COULDN'T LOAD PLAN" with the real message is chunk 52's. The alternative, falling back to the run copy's days, would show next week's days in a week that had others once 51b writes rows.
- (b) In Plan, stepping to a week where the selected weekday has no workout selects that week's first day. That is the page's existing rule, now reachable: Friday selected in week 3, then back to a week 2 without a Friday.

**Recommendation:** keep both. (a) never shows a wrong day, and (b) is the page's existing rule.
**Blocks:** nothing.
**Options:** for each, as built or the alternative named.
**Answer:**
**Evidence:** nothing is written either way: the scheduler only reads, and Plan's plan-the-week effect doesn't wait for the rows. On staging no run has rows, and every read answered `200` with none. A failed read was not reproduced live; the hooks' tests hold Today and Plan on the spinner while the rows are `undefined`, which is what a failed first read leaves. The builder's report, section 3, item 3; long form: HISTORY.md, "2026-10-16 chunk 50 review".

### 155 The display follow-up's own display choices (provisional, D31)
**Ask:** the display follow-up built your changes to 128, 129, 130 and 132 (#135). Three things it needed have no exact word from you. Each stays as described here unless you change it.
**Recommendation:** keep them. Each is a few lines in `src/components/pickers/`.
- (a) **Starting numbers on a segment switch.** Your words: "The boards' example values (8, 8–10, RIR 2, 1–2) are only the starting point when you switch to a segment the set doesn't already have". Read literally:
  - a set at 12 reps switched to RANGE starts at 8–10;
  - a set at 6–9 switched to NUMBER starts at 8;
  - each segment keeps its own numbers while the sheet is open, so 6–9 → NUMBER → RANGE is 6–9 again.

  The first attempt carried the set's number over instead (12 → 12–14, 6–9 → 6), and lost the range on the way back (6–9 → NUMBER → RANGE gave 6–8). The review sent it back, and the second attempt built the literal reading (#135).
- (b) **The typed boxes.**
  - Digits only, at most three, with the number pad.
  - The number is selected when a box takes focus, and Enter leaves the box.
  - A number typed past the bounds is held to the nearest one the box can take when the box is left or the sheet is confirmed: 150 reps → 100, 0 → 1, RIR 21 → 20, a FROM typed past TO → TO. Ends that meet are a number, as before.
  - An emptied box goes back to its number, and the footer button always says what it will set.
  - Escape in a box closes the sheet, as it does anywhere in it.
- (c) **The cues sheet's rows (129)** keep wrapping a long cue as built (`overflow-wrap: break-word`), since your long-word answer named 128 and 130. An 80-letter cue wraps inside its row at 375 px.

**Blocks:** nothing. No screen uses the pickers before 51a / 54a.
**Options:**
- (a) as described, or the set's own number carried into its other segment (12 → 12–14), as the first attempt had it;
- (b) as built, or a typed number past the bounds refused instead of held at the bound;
- (c) as built, or `anywhere` there too.

**Answer:**
**Evidence:** the display follow-up's first review (`<scratchpad>/build/chunk-d31-review-1.md`), on `build/chunk-d31` at `b32dfbe`:
- (a) was run in real Chromium on the built pickers.
- (b): the builder's 35 real-Chromium checks were re-run and passed 35/35.
- (c): the 375 px sheet check passes on a cues fixture with an 80-letter cue, and its control (the wrap removed) fails.

Its second review, on `7d1367b` (merged as #135, `a97eb8c`):
- (a) in real Chromium on the built pickers: 12 → RANGE gives 8–10, and 6–9 → NUMBER gives 8. 6–9 → NUMBER → RANGE gives 6–9 back, and confirming it sets 6–9. Of 19 checks, the first attempt's carry-over fails 3 and "RANGE restarts from the example" fails 7.
- (b): the builder's 48 real-Chromium checks pass 48/48.

### 154 Text on the accent in Coach, which is frozen: included or not? (the display follow-up)
**Ask:** your answer puts the new `--on-accent` "wherever text sits on the accent". Coach draws text on the accent in 15 places in 9 files (its buttons and picked tabs), still in `--base`: near-white on the accent in the light theme, as the rest of the app did. Coach has been frozen since `e747183` (Escalation 16; `check-frozen-code.mjs` fails on any change under `src/features/coach/`), so those 15 can't change without your word. Is Coach included?
**Recommendation:** (a) include it: the 15 colour values and nothing else in Coach, with the freeze's base moved to that commit, so the whole app reads the same. It is display only.
**Blocks:** nothing. The display follow-up merged without Coach (#135). (a) is a small change of its own: the 15 colour values, the freeze's base moved, and the Coach exception in `textOnAccent.static.test.ts` deleted.
**Options:**
- (a) include Coach, as above;
- (b) leave Coach on `--base` until Coach is next opened.

**Answer:**
**Evidence:** the display follow-up's first review scanned every accent background in `src` and found 94:
- the 1.2 sheets' 7 already use the token;
- 6 hold nothing to read (dots, a bar, two toggle tracks);
- 15 are Coach: `CoachMemory.tsx` ×3, `CoachMesoAnalysisTab.tsx`, `CoachPage.tsx`, `CoachSessionAnalysisTab.tsx`, `CoachWeekAnalysisTab.tsx`, `PhaseLog.tsx` ×3, `PrioritySelector.tsx`, `QaComposer.tsx`, `WeightLog.tsx` ×3;
- the other 64 (39 files) went to `--on-accent` in the follow-up's second attempt (#135).

Those 64 include the screens 1.2 doesn't rebuild (Today outside the workout, History, Progress, Library, Settings, sign-in, the update notice). SPEC's "Scope of the look" keeps their code, but 128 (g)'s option, which you took, said the token "would fix every accent button", and your words are "wherever". If you meant the 1.2 screens only, say so, and a small change puts those screens' places back on `--base`.

### 153 Chunk 43's fourth attempt: which of a set's two REVIEW items comes first (provisional, D31)
**Ask:** your 150 (b) gives a set two REVIEW items when its type was changed during the workout and it was then skipped or never logged: its "Skipped" / "Not logged" and its type item ("You made set 03 a dropset"). Board 4 draws no such pair, and SPEC doesn't say which comes first. As built, "Skipped" / "Not logged" comes first and the type item right after it. That is the order a done set's two items already have: its number item, then its type item, 13c's items before 13d's. It stays as built unless you change it.
**Recommendation:** keep it: it is the order 139 accepted for a set that was done, and one statement in `sessionItems`.
**Blocks:** nothing. No screen draws REVIEW before chunk 56.
**Options:** as built ("Skipped" / "Not logged" first, then the type item), or the type item first.
**Answer:**
**Evidence:** `sessionItems` in `src/features/plan/review.ts`, on staging since #130 (`95bbe46`). The seed test lists "SEATED CABLE ROW · SET 03 · Skipped" and then "You made set 03 a dropset · 2 drops", and the builder's break S20 (the type item first) fails 11 tests. The builder's other readings aren't D31 choices. They're recorded so you see them, and SPEC or your answers decide each:
- On a slot swapped during the workout, the swap item stands for the original's remaining sets in place of their "Skipped" items, as before (139). A set retyped before the swap keeps its type item: the swap item carries no type, and 19 says next week sees a type change only through REVIEW.
- The same stage kind with another count, on a set not done, is no item. As on a set that was done, only drops done beyond the plan count, and a set not done has none; 150's evidence asked you to say so if you read a count as a type change.
- The type is read from the set's `retyped` row alone (150 (b)'s words). A skipped log's own kind and a `pending_stages` row (a count) are not read.
- A session skipped as a whole still gives nothing (G52: "a session marked skipped gives no REVIEW items").
- A set deleted afterwards is "Skipped" only (your change-row rule: its row becomes `deleted`).

### 151 UNLOG of a set that isn't the last one logged: what happens to the set numbers (chunk 46)
**Ask:** During a workout a logged set can be unlogged (SPEC 18c). Its log is deleted, and its weight, reps and RIR stay on the phone as a draft. A logged set shows the number it was logged with, and an open set shows the next number after the logged ones. So unlogging a set that isn't the last one logged leaves a hole in the logged numbers, and two rows show the same number. With bench 01–03 logged and 04 open, UNLOG on 02 shows 01 ✓, 03 (the unlogged set, open), 03 ✓, 04. The finish warning then says "Bench 03 and 04", and the lock asks "Log set 04 before set 03?". Logging it again stores a second set 3, so History shows sets 1, 3 and 3. SPEC 18c says only that the set "goes back to unlogged with its numbers kept" and that "logging again undoes it". What should unlog do to the set numbers?
**Recommendation:** (a), the rule that a delete (18b) and a switch to or from Warmup (146 (a)) already follow. The logged sets after it close the gap at once, and logging it again gives it the next number. No two rows or logs then share a number, and History has no hole. The set's own number can change: unlog 02 of 01–03 and log it again, and it is 03 (the old 03 became 02). Chunk 46 returns the number patches with the unlog (heads and their drops). Chunk 63 writes them with the delete, offline too, as chunk 61 does for delete.
**Blocks:** chunk 46's merge, and so 58a, 58b and 59–64, which draw from it and write what it returns; 63 writes the answer. As built, after its own unlog the module's own rows show two sets with one number, and every option but (c) changes the module. Nothing before 58a waits: 47–57 don't use it.
**Options:**
- (a) As recommended: the logged sets after it move down one; logging it again gives it the next number.
- (b) The set keeps its number. The draft also keeps the number it was logged with, the open row shows it, and LOG writes it again, so logging again restores exactly what was there. The other sets don't move. A set logged while it is unlogged takes the number after the highest one in use. If it is still unlogged when the session ends, its number is missing in History.
- (c) As built: nothing renumbers. While the set is unlogged two rows show one number, and logging it again stores a duplicate number. Not recommended.
**Answer:**
**Evidence:** Executed through the module's own outputs in chunk 46's second review, on `5b09cec` squashed onto staging `4e7205b`:
- `unlogEffects` on 02 returns the log's delete and the draft, nothing else.
- Applied, `resolveRows` reads `01✓ 03· 03✓ 04·`, and the current set is the unlogged 02, shown as 03.
- Logged again the way chunk 58a keeps writing a head (`totalLoggedHeads + 1`; TASKS 58a, "Writes unchanged"), the stored numbers are 1, 3, 3.
- Unlogging the last logged set leaves no hole.

Why SPEC doesn't settle it:
- SPEC 18b's "The remaining sets renumber" is about delete.
- 146 (a) answered the Warmup switch only (RULES.md: an answer covers the cases its question held).
- G46's draft (TASKS 63) holds weight, reps, RIR, form and unit, and no set number.

It is the defect 146 was asked about (two rows with one number), here for unlog. The builder raised it (its report, A8) and built nothing for it. Redone if the answer is (b): the draft's shape and how the rows number a set with a draft (46), and what LOG writes (63).

### 152 A warmup logged with no weight or reps, made a working set during the workout (chunk 46, for 62)
**Ask:** SPEC lets a warmup be logged with no weight and no reps (Warmup sets: "weight and reps, both optional"). Its boxes may be left empty, and a warmup ticked off in the tick list has none. A logged set's type can be changed from its edit panel (SPEC 19; board W2b's EDITING A WARMUP has a SET TYPE row). The database refuses a working set without both numbers (`v2_set_logs_check`: `is_skipped or is_warmup or (weight is not null and reps is not null)`). So making such a warmup Normal, or a staged set, fails. What should happen?
**Recommendation:** (a), ask for the numbers first. A working type on such a warmup is saved together with the weight and reps typed in its edit panel, in one write. If a box is empty, SAVE says "Enter weight and reps." and sends nothing. Nothing is refused and nothing done is lost.
**Blocks:** chunk 62 (SET TYPE on a logged set). It blocks chunk 46's merge only under (c). Under (a), (b) and (d), the type patch chunk 46 returns stands: 62 sends the numbers with it, or doesn't offer the pick. Under (c), `applySetTypeChange` returns a delete for such a warmup instead of a patch.
**Options:**
- (a) As recommended: the numbers first, saved with the type in one write.
- (b) Not offered: for a logged warmup with no weight or reps, SET TYPE offers Warmup only (as G55 limits Plan's picker) until its numbers are saved.
- (c) The switch makes it a set still to do. Its warmup log is deleted (it holds nothing), and the set becomes an open working set of the picked type (its `retyped` row), current or upcoming like any open set.
- (d) As built: the write is refused and the error shows; the set stays a warmup.
**Answer:**
**Evidence:** Executed on a replay of migrations 000–042 (`supabase/postgres:17.6.1.155`), rolled back:
- A warmup was logged with weight and reps null, as `SetRow.tsx` writes an empty box ("an empty field is simply null").
- The patch chunk 46 returns for Normal (`is_warmup false, stage_kind null`) was refused: `23514 v2_set_logs_check`. The patch for Dropset was refused the same way.
- The control, a warmup logged 20 × 12, was accepted.
- The builder's walk, replayed on the real tables with warmups logged without numbers: 35 of 2230 writes refused, all by this check. With numbers, none of 4334.

Chunk 46's rules read no weight or reps, and their stand-in doesn't model this check, so their own tests can't see it. TASKS 62 patches `is_warmup`, `stage_kind` and `stage_index` only. The builder raised it (its report, A9).

### 150 A set whose type was changed during a workout and then skipped or never logged: a REVIEW item? (chunk 43)
- What: whether REVIEW also lists a type change made during a workout on a set that was then skipped or never logged, beside its "Skipped" / "Not logged"; as chunk 43's third attempt built it (`a62a20b`), it didn't, and a set the plan gave no weight or reps got no item at all.
- Answer: (Adam, 2026-10-15) "(b). A type change made during a workout is listed in REVIEW even when that set was then skipped or never logged, alongside its "Skipped" / "Not logged" item, and for everyone (13d) — also when the plan gave the set no weight or reps. Chunk 43's fourth attempt builds it; allowed." Written into SPEC.md (Review → Structural items) and TASKS-1.2.md (chunk 43's Scope; the Data model's session-change row). As (b) said, the item comes from the set's `retyped` row and its USE gives this week's matching set that type; a set deleted afterwards stays "Skipped" only (Adam's change-row rule: a later delete turns the row into `deleted`). Full text in HISTORY.md. Built: chunk 43, #130 (`95bbe46`), 2026-10-15; which of the set's two items comes first is 153 (D31).
- Date: 2026-10-15

### 149 Weeks a week-dependent run changed in 1.1's week view, and 143's copy (chunk 45)
**Ask:** In 1.1 the week view was where a week-dependent run's exercises changed. SWAP or ADD made a "week-only" exercise in that week, REMOVE took one out of that week, and the next week copied the week as it was, so the change carried on. The run's program (its copy) never changed: the program tab went in 1.1, and "Make this week the new default" is for stable runs only. 1.2 has no exercise actions in the week view: exercises change only in CHANGE THE PROGRAM, which edits the program. Your answer to 143 makes a copied week follow the program's list. When 044 brings that rule in (chunk 53 on staging; production at the release), what should the first copy from a week like that take?
**Recommendation:** (c): once, at the release, make each active week-dependent run's program match its last planned week (each workout's latest planned normal week, the one its next week is copied from). A week-only exercise joins the program, an exercise that week doesn't have leaves it (soft-removed, as everywhere), and the program takes that week's order. Your next week then looks exactly as 1.1 would have made it, and CHANGE THE PROGRAM shows what you are actually doing, so from then on every exercise can be swapped, removed or reordered. Under (a) or (b) the first 1.2 week of such a run changes by itself.
**Blocks:** chunk 53 (044 runs the copy rule; under (b) its twin changes with it; under (c) chunk 53 or the release plan carries the one-time step) and the release. Not chunks 47–52: none of them runs the copy rule, and no option changes what a CHANGE THE PROGRAM save writes. Staging has no such week (the seed plans every week with `v2_plan_week`), so only production's runs are affected: yours and your friend's, if a week-dependent run changed exercises during 1.1.
**Options:**
- (a) As built (chunk 45's copy rule, which 044 will follow): the program's list and order. An exercise removed in 1.1 for that week comes back with no sets. A week-only exercise stays after the program's exercises, with its sets, and stays in every later week: nothing in 1.2 lists it, so it can never be removed.
- (b) The program's list only: a week-only exercise isn't copied (its sets stay in the weeks that have them), and an exercise removed in 1.1 for that week comes back with no sets. Every exercise of a later week can then be changed in CHANGE THE PROGRAM; a week-only exercise you still want is added there once, with no sets.
- (c) As recommended: once, at the release, the program is made to match the last planned week. It changes existing rows on production (the run copies' `v2_program_exercises`: `week_only`, `removed_at`, `position`), so it runs with live counts before and after, like any migration that changes data. On a sequence run whose repeated workout differs between its slots, one slot's week (the last) decides.
**Answer:** Not yet: Adam will answer it directly. At his instruction (2026-10-15) it was held against SPEC's [P1.1] *Existing data* line ("only this week" values already stored are ignored; copying uses each week's actual content), to be closed if that line fully answers it. It doesn't. Its first half doesn't reach these weeks: the stored "only this week" values are P1's tick in the unread `carry_*` columns, while 1.1's week-only rows are part of a week's content. Its second half keeps a 1.1 week-only exercise in the copy, as built. The case it doesn't cover is an exercise 1.1 removed from a week while the program still lists it, or a week whose order 1.1 changed. There the line gives the week's content: the exercise stays out, and the week's order stays. 143's line gives the program's list: the exercise comes back with no sets, in the program's order. 143's line is written for a copy after a CHANGE THE PROGRAM save; as built, chunk 45 applies it to every copy. Neither line says which wins. Nor does the line say how a week-only exercise, once copied, is ever removed: nothing in 1.2 lists it.
**Evidence:** What 1.1 stored: the week view's SWAP and ADD call `createWeekOnlyProgramExercise` (`week_only = true`, `runProgramExercises.ts`), and REMOVE deletes the week's rows. 041's week branch copies the source week's own rows (SPEC [P1.1]: "copying uses each week's actual content"). The program tab was removed in 1.1 (DECISIONS 108), and 040's header says "Week-dependent programs don't have this action". CHANGE THE PROGRAM's draft (`draftFromRunCopy`) lists only the program's live rows, and a draft that names a week-only row is refused. The reviewer's executed probe (chunk 45's second review): a Pull whose done week 2 had a 1.1 swap (Lat Pulldown → week-only Machine Row), a removal (Face Pull) and an add (week-only Curl), and no save since. As built, week 3 gets Lat Pulldown ×0, Face Pull ×0, Seated Row ×2, Machine Row ×2, Curl ×1; 041 today gives Seated Row ×2, Machine Row ×2, Curl ×1. After a save that removes Lat Pulldown and Face Pull, the two week-only rows are still copied. Two of SPEC's sentences meet here: 143's "a copied week follows the run copy's current exercise list and order" and [P1.1]'s "copying uses each week's actual content". The builder raised it (its report, 3.B) and kept week-only rows under [P1.1]; the review found that nothing in 1.2 can remove them. Cost: (a) nothing; (b) a few lines of `copyFromWeek` and their tests, in chunk 53 with 044; (c) a one-time data step at the release (designed in chunk 53), with live counts.

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
- Answer: (Adam, 2026-10-15) "(a). A week-dependent week copied after a save follows the run copy's current exercise list and order: an exercise still in the program brings its sets from the source session as the copy rules say; a removed one is dropped; an added one arrives with no sets; a swapped one brings the old exercise's sets (count, kinds, stages, rep targets — as SPEC's swap rule). The link is the run copy's program exercise row: if the week's exercises already point at it and a swap updates that row in place, use that; add a stored link only if a swap deletes and re-inserts the row, and say which it was in the chunk report. Copying also goes in programChange/weekPlanning tests and in 044's rules, each with a break-proven test." Written into SPEC.md (Weeks and copying → Source, `week-dependent`). Chunk 45 goes back to its builder with it (not a review failure); 044's rules are chunk 53's. Full text in HISTORY.md. Built: chunk 45, #125 (`ab1fc08`), except the swapped case. Which it was: a swap inserts a new program-exercise row and soft-removes the old one (it deletes nothing and updates nothing in place), so the link is stored, in a new column, `v2_program_exercises.replaces_program_exercise_id`, that 043 adds (chunk 47), where the swapped case lands. Weeks that 1.1 changed in the week view: 149.
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
**Ask:** paste `supabase/seed.sql` (as on `staging` then) into the staging branch's SQL editor on Monday 2026-10-19, and say "re-seeded".
**Recommendation:** as you planned (2026-10-15). — **When:** Monday 2026-10-19, not earlier: the seed's dates are relative to the day it runs, so a re-seed in the week of Monday 2026-10-12 would put the test account's week 3 in that week again.
**Blocks:** nothing stops for it (your rule, 2026-10-15; CONTEXT.md, "Waiting on re-seed"): until then, a chunk's staging check that needs open sets in the seed's in-progress session and finds none is recorded here as "waiting on re-seed", the chunk still merges if everything else passed, and the check runs after the re-seed. Waiting on re-seed so far: every smoke's "log one set" since the display follow-up's review (its smoke logged the session's last open set); chunk 47's smoke (2026-10-16) found Today with no LOG button, and so did chunk 49's and chunk 50's (2026-10-16; the account's set logs still 214).
**Answer:**
**Evidence:** every merge's smoke logs one set in the in-progress session (week 3 Monday Upper A). Chunk 57's review (2026-10-16) logged the first drop of Cable Triceps Pushdown set 2 (typed 22.5 kg × 8 with the browser offline, then synced on reconnect; set logs 212 → 213, read back as the test account), which opened its second drop. Today now shows 1 LOG button, that drop's, with empty boxes: type the plan's 17.5 kg × 6 before LOG (RULES.md: a row with no prefill; its target is 6–8 reps). It is the session's last open set (Today showed one LOG button before that log and one after it), so the smoke after the next one finds none and is "waiting on re-seed". Since your re-seed of 2026-10-14 (124) the test account's week 3 is Monday 2026-10-12 to Sunday 2026-10-18; from Monday 2026-10-19 it is past, and the checks TASKS-1.2 writes for "week 3 current" read a week later until the re-seed (TASKS-1.2, "Seed").

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
- Answer: (Adam, 2026-10-15) "128, 129, 130 — text on the accent: not --base. Use the near-black the boards draw (the app's text token that matches it), in both themes, wherever text sits on the accent colour." "128, 130 — an unbroken long word wraps inside its box (overflow-wrap: anywhere); nothing runs past its line." "128 — the number boxes in the rep and RIR pickers are inputs you can type into, with ± steppers beside them (decisions 6 and 17a: choose, then type). Same bounds as built." Then (Adam, 2026-10-15, his third batch) "128, the rest: accepted as built, except: a picker opens on the set's current target. The boards' example values (8, 8–10, RIR 2, 1–2) are only the starting point when you switch to a segment the set doesn't already have; nothing is pre-filled for a set that has no target until you pick a segment." "Text on the accent: add a new token --on-accent in global.css for both themes, set to the near-black the boards draw, and use it wherever text sits on the accent." So (d), (g) and (i) change and (c) is narrowed to his words, in the display follow-up; (a), (b), (e), (f) and (h) stand. The token is in SPEC.md (Design boards → Never pixel-match); no SPEC rule says what a picker opens on, so that change has no SPEC line. Which file holds the token's value: "Waiting on Adam" (the app's colour values are in tokens.css). Full text in HISTORY.md.
- Date: 2026-10-15

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
