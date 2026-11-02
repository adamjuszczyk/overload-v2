# NEXT.md — Overload's next-version notes
*Opened at the 1.2.1 close, 2026-11-02 (BUILD.md 2.2, step 6). The next brief starts from this file. Later items are notes, never a spec.*

## Planned, not built

**Release mechanics from 1.2.2**
- 1.2.2 is the first release under BUILD.md step 5 in full: maintenance on after the backup, then off with `min_version` raised to `1.2.2` after the smoke (run sheet "From 1.2.2"; TASKS "From 1.2.2")
- Every release raises `min_version` and writes its WHAT'S NEW entry before the checklist (SPEC Rules 4; run sheet "From 1.2.2")
- The first real maintenance flip on production, with a non-exempt second account watching (RC-4's real flip; DECISIONS 276)
- The update gate on real installed phones: Adam's Android at 1.2.2, the friend's iPhone the risk (TASKS "assumptions" 2)
- During maintenance an exempt account gets the new code only by reopening the app (HISTORY "2026-10-31 chunk 73", observation)
- A re-runnable proof script for 048's functions, skipped in 1.2.1 (DECISIONS "Tests owed", 70)

**Data and queue**
- `v2_start_run` ignores `deleted_at`: a stale START list can start a deleted saved program (DECISIONS 275, 74; release notes: Known and left)
- Apply every queued change row in the workout's read, not only `deleted` ones (DECISIONS 275, 80; release notes: Known and left)
- What queue-fix 230 left: another phone's delete, a queued session start naming a deleted workout day or run, writes stuck before 1.2 (DECISIONS 238 (2)–(4); release notes: Known and left, carried from 1.2)
- Two direct workout writes (`writeSetChanges`, the CUES write) don't re-read the release state on `OL001` (DECISIONS 275, 72 B)
- After a full delete, the phone's offline copy of the deleted sessions is not cleared (DECISIONS 275, 75)
- The Library's delete preflight can count one log twice in its confirm number (HISTORY "2026-10-31 chunk 80", reading)

**Screens**
- [7] CHANGE THE PROGRAM from the viewed week (SPEC Next-version notes; DECISIONS 1.2.1 list, Adam's 7th vibe-check item)
- EDIT RATINGS (energy, pump) on the finished session, no reopen (DECISIONS 248; SPEC Next-version notes; SPEC-1.2 phase 2)
- PREVIEW SESSION extras: sets per muscle, the warmup routine (SPEC Next-version notes)
- Week-by-week results of a finished program: planned next to logged (SPEC Next-version notes)
- The finished program's header says "4 weeks · 1 deload" where its week strip shows 3 (HISTORY "2026-10-31 before the release", final review; named for the next version in CONTEXT at the release)
- The Library's exercise-delete confirm still names a deleted program among those using the exercise (HISTORY "2026-10-30 chunk 74", observation)
- `ExerciseHeader` has no wrap guard on an 80-letter exercise name at 375 px (HISTORY "2026-10-31 LIGHT batch 2", observation)
- Today reads "TODAY — DONE" for a second run started the same day a first run's session was completed (HISTORY "2026-10-31 chunk 75", observation; not investigated)
- The rest timer surviving UPDATE's reload (DECISIONS 258; SPEC [11])
- CHANGE THE PROGRAM's CANCEL did not leave `/plan/change` on staging (HISTORY "2026-10-30 LIGHT batch 1", observed, not investigated)
- The iPhone install guide (SPEC Not this version; release notes: Not in 1.2.1)
- The unsent-changes indicator (SPEC Not this version; release notes: Not in 1.2.1)

**Known and left in 1.2.1** (taken as built; release notes: Known and left; DECISIONS 275)
- The maintenance screen has no SIGN OUT (72)
- An idle phone shows the maintenance screen within the hour, one in use within a minute (72)
- UPDATE TO CONTINUE also covers the sign-in page, with no SIGN IN; unsent changes wait while the release state can't be read (73)
- A failed count read shows "Couldn't count what goes." with DELETE off (75)
- A set-type change made offline whose first send fails reads undone until the next sync (80; the "apply every queued change row" item above)
- An exercise added with + ADD EXERCISE keeps WORKOUT COMPLETE up until its first + ADD SET (78)
- SUPERSET on a last member with a superset below joins the two; a stored tempo past 20 steps to 20; the CURRENT PROGRAM card shows no days until the week's schedule is read (79)
- History's full delete stays on History with the filter reset, where SPEC [8b] says back to PROGRAMS (final review; release notes: Rule by rule [8b])
- The start sheet and deleted programs: see `v2_start_run` above (74)

**Older lists** (not being done, CONTEXT; kept so they stay visible; detail under "Older lists still open")
- Phase 2: every [P2] item of SPEC-1.2 (SPEC-1.2; SPEC Not this version)
- SPEC-1.2's "Later (next-version notes)" list, 23 items (SPEC-1.2 "Later")
- The "Known in 1.2" lines 1.2.1 doesn't fix (release-1.2 notes: Known in 1.2; release notes: Known and left)
- No change marks on a stable run's past week or finished sessions, agreed and never built (DECISIONS 207 (b))

## Notes from real use
*Adam's, after 1.2.1 on production. Empty at the close.*

## Vibe-check dislikes
None (1.2.1's vibe check, DECISIONS 276: all 11 stops liked).

## The items, with what was worked out

### Release mechanics from 1.2.2
Source: `docs/release-1.2.1-run-sheet.md` "From 1.2.2"; TASKS.md "From 1.2.2"; SPEC Rules 4; DECISIONS 270, 271, 275 (72 C), 276 · What's known:
- After the backup: `update v2_app_status set maintenance = true, updated_at = now() where id;`. Then the migrations PR, the release PR, the smoke as the exempt account, then `update v2_app_status set maintenance = false, min_version = '1.2.2', updated_at = now() where id;`.
- A phone shows the screen the next time it reads the flag: on opening, on return to the foreground, at once after a refused write, otherwise within the hour. Don't promise "within a minute".
- Adam's account is exempt on production since the 1.2.1 run sheet's step 4e; it shows the strip. Signed out, the screen offers SIGN IN.
- RC-4's real flip was never done on production (1.2.1 kept `maintenance` false). Adam's vibe check (276) was confused by the delay and didn't check a second account.
- The update gate (`registration.update()`, then a reload once the new worker is active) is proven in desktop Chromium only. Adam's Android is the first real test (a P row); on the friend's iPhone, installed-PWA updates are known to lag, and TRY AGAIN is the fallback. The queue is never sent by the old version.
- From 1.2.2 an exempt account gets new code during maintenance only by reopening the app (chunk 73 observation).
- The optional 048 proof: a `scripts/` re-runnable proof like `apply-ops-proof.mjs` for 043 (the builder's proof2 S1–S6 and its 31-break runner, now only in the build's scratchpad). Lets a later migration re-prove 048's functions.

### `v2_start_run` and `deleted_at`
Source: DECISIONS 275 (74); HISTORY "2026-10-30 chunk 74"; release notes: Known and left · What's known: `v2_start_run` (migration 028) checks only `kind = 'saved'`. So a START sheet older than its 5-minute stale time (another phone deleted the program), or a race, starts a run from a deleted program. The run works; the program stays hidden. It was left because SPEC 1.2.1 changed none of the five existing functions. Named fix: a later migration.

### Apply every queued change row
Source: DECISIONS 275 (80), 269; HISTORY "2026-10-31 chunk 80"; release notes: Known and left · What's known: chunk 80's third line (`withQueuedDeletions` in `useSession.ts`, through `withChangeRecords`) applies only queued `deleted` change rows. A `retyped` or `pending_stages` row queued offline whose first send fails reads as undone until the next pass. This was 1.2's behaviour. A LOG then writes the type the screen showed, the workout and History agree, and no log is hidden but counted. Named as "apply-all".

### What queue-fix 230 left
Source: DECISIONS 238 (2)–(4); release-1.2 notes: Known in 1.2 · What's known:
- (2) Another phone's delete: phone A is never told when phone B deletes a session or log A's queue names. A's log is then refused for ever, or an upsert whose reply was lost brings back a log B deleted. 1.1 has this too. The planned-set case heals at A's flush. A flush-time rule that drops a write on a refusal read from an error was not taken without Adam's word.
- (3) A queued `v2_sessions` upsert is refused for ever once a workout day or run it names is deleted before it lands (the 001 keys are ON DELETE SET NULL). By reading only. Option 238 (c) was to resend such a row with that column null.
- (4) A write stuck on a phone before the release stays until sign-out. The fix prevents these; it doesn't repair them.

### Small queue and delete leftovers
Source: DECISIONS 275 (72 B, 75); HISTORY "2026-10-31 chunk 80" · What's known: `writeSetChanges` (`useSessionSetChanges.ts`) and `writeCuePatches` (`SetCuesSheet.tsx`) don't re-read `['v2_appStatus']` on `OL001`; one line each if wanted. After a full delete the phone's offline copy of the deleted sessions isn't cleared; its one reader never matches them. The Library's preflight can count one log twice when the server holds it and its upsert and delete are still queued; this affects only the confirm's number, and the outcome is right.

### [7] CHANGE THE PROGRAM from the viewed week
Source: SPEC Next-version notes; DECISIONS 1.2.1 list (Adam, 2026-10-27: "CHANGE THE PROGRAM from the week being viewed, not only the current week"), 247 (b); SPEC-1.2 Later (per-week rest, tempo, warmup routine, supersets) · What's known:
- Rest, tempo, unit, supersets and the warmup routine are stored once per run, so they can't start at a later week without per-week storage. TASKS-1.1.md's appendix keeps a plan for per-week storage.
- A new week takes its exercise list from the run copy (045), so the weeks between now and the start week would have to be planned first, or they'd pick up the change.
- Weekdays already have a from-week (`v2_run_schedules`).
- 247 (b)'s rule-box line ("weeks 4–5 are planned and change too") belongs with it.

### EDIT RATINGS on the finished session (248)
Source: DECISIONS 248; SPEC Next-version notes; SPEC-1.2 "Finished session [P2]" · What's known: today the only way to change energy or pump after finishing is CONTINUE SESSION. A reopened session finishes through W19 with its ratings already filled in, and nothing is written wrong. 1.1 had no ratings-only edit either. SPEC-1.2 [P2]: "Edit button for energy, pump and notes that does not reopen the session; workout time stays intact." The option offered: EDIT RATINGS beside EDIT NOTE on the finished-session screen (`CompletedTodayScreen.tsx`). SPEC-1.2's tracked fields [P2] also send a missing mandatory rating to "the finished-session edit".

### PREVIEW SESSION extras
Source: SPEC Next-version notes · What's known: sets per muscle, and the warmup routine. 1.2.1's preview deliberately added no new content.

### Week-by-week results of a finished program
Source: SPEC Next-version notes · What's known: planned next to logged, per exercise: "the numbers half" of the finished program (Adam, 2026-10-11). Not discussed for scope, only noted.

### The finished program's week count
Source: HISTORY "2026-10-31 before the release" (final review); CONTEXT's release-time "Waiting on Adam" line (now in HISTORY "2026-11-02 the 1.2.1 close") · What's known: on the seed's STG Full Body run the header says "4 weeks · 1 deload" (1.2's calendar count, P1.2-4) where the strip shows 3 weeks.

### The Library's exercise-delete confirm
Source: HISTORY "2026-10-30 chunk 74" · What's known: it still lists a deleted saved program among the programs using the exercise. Display only, and not in SPEC 1.2.1's picker list (Facts to verify 1).

### `ExerciseHeader` wrap guard
Source: HISTORY "2026-10-31 LIGHT batch 2" · What's known: an outside-scope observation: an 80-letter exercise name at 375 px has no wrap guard.

### Today reads DONE for a second run started the same day
Source: HISTORY "2026-10-31 chunk 75" · What's known: on staging-empty, a second run started the same day a first run's session was completed opened Today as "TODAY — DONE" with its workout NOT STARTED. Not chunk 75's, and not investigated.

### The rest timer across UPDATE's reload
Source: DECISIONS 258; SPEC [11] · What's known: `restTimerStore` is in memory. After the reload the session, its logged rows, the drafts and the added sets come back. The running rest timer and numbers typed but not logged are lost, as after the old RELOAD. Option (b), persisting the rest timer, was not taken for 1.2.1.

### CHANGE THE PROGRAM's CANCEL
Source: HISTORY "2026-10-30 LIGHT batch 1" (smoke on staging) · What's known: CANCEL did not leave `/plan/change`, perhaps because of a discard confirm. Observed, not investigated, and not 71's or 79's.

### iPhone install guide; unsent-changes indicator
Source: SPEC Not this version ("starter features, a later build"); release notes: Not in 1.2.1 · What's known: nothing beyond the names. 1.2.1's maintenance and update screens already count unsent changes for their one line.

### WORKOUT COMPLETE after + ADD EXERCISE
Source: DECISIONS 275 (78); release notes: Known and left · What's known: an exercise added with + ADD EXERCISE has no sets, so WORKOUT COMPLETE stays until its first + ADD SET. The alternative would be a new small rule.

## Older lists still open
*CONTEXT: Phase 2 and SPEC-1.2's "Later" list are not being done. Listed here with their source, not dropped.*

**Phase 2** (SPEC-1.2, items marked [P2])
- Tracked fields: RIR/RPE, form rating, set time and energy/pump, each off / optional / mandatory; RIR vs RPE as a display setting (also the RPE display of a RIR range, release-1.2 notes "Not built")
- Pre-fill as grey suggestions: planned, else last time (also DECISIONS 162: "Pre-fill from last time stays phase 2")
- "Set added · Undo"; reorder this session; unilateral split sides; bodyweight as signed added load
- Finished session: the ratings and notes edit (above, 248) and clock times
- Exercise notes: per exercise and per user, kept across programs
- Login: Google sign-in for new accounts, account linking, password reset fixed
- Library: one shared catalog plus custom exercises, with personal edits (may be partly met by the earlier exercise-library work; check)
- Polish and English UI, with exercise names in both
- Bottom bar Today, Plan, History, Library, Settings, with Progress and Coach inside History; Settings grouped

**SPEC-1.2 "Later (next-version notes)"**
- Anything coach- or trainer-related; sharing a plan
- Plan, workout and skeleton templates
- Cardio sessions and timed holds
- Weight targets as a percentage of 1RM/e1RM
- Which gym a session was in
- Pain/discomfort flags
- Partials, negatives, forced reps
- Form rating improvement (bar path, depth, tempo)
- Weight log for all users
- Progress screen rebuild
- Double progression (rep-range trigger options, weight step per exercise, suggest, don't write)
- Open-ended sets: a total-reps target, and sets until a set falls short
- Calendar view and plan history
- Run length and scheduled deloads ("every Nth week")
- Two or more workouts on the same weekday
- Custom home screen (reminders)
- New-user guide; a short skippable first-run tutorial
- Per-week rest, tempo, warmup routine and superset grouping (with [7] above)
- History highlights what was done differently from the plan
- Further CHANGE THE PROGRAM improvements
- Restyling the screens 1.2 didn't touch; deleting or rebuilding the AI/Coach features (Coach is frozen); a REVIEW threshold for RIR

**Known in 1.2, still so** (release-1.2 notes "Known in 1.2"; carried by the 1.2.1 notes)
- A sequence run's repeated workout edited differently per slot plans the earlier slot from the program (DECISIONS 203)
- Coach may skip the week a run's weekdays change (DECISIONS 159)
- Coach's MESO / mesocycle wording in five places, and MESOCYCLE NOT FOUND on a pre-1.1 priorities page (G50; DECISIONS 154, 236; Coach frozen)
- A session moved to a day and not done there isn't listed as missed (DECISIONS 244: "leave as is")
- Library, History and Today keep 1.1's error handling: no reason line, or drawn empty (RC40)

**Agreed, never built**
- No change marks or legend on a stable run's past week or its finished sessions. One condition in `WeekView.tsx`, held for Adam's review pass and not found in the code (DECISIONS 207 (b))

**Elsewhere**
- Coach-era open items and the older still-open list: CONTEXT "Open items and known issues" (HISTORY "2026-10-11 docs prune", "2026-10-15 chunk 40 review")
