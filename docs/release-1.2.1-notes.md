# Overload 1.2.1 — update notes

*Draft for Adam's edit, 2026-10-31 (TASKS.md "Release", step 1; DECISIONS 265, 275). "What's new" is the 1.2.1 entry of `src/data/releaseNotes.ts`, word for word (`releaseNotes.test.ts` compares the two, so an edit is made in both); the rest of this file stays out of the app. The release date is Adam's: the entry carries `2026-11-02` with a `DATE` comment. This lists each SPEC.md [1.2.1] item against what was built on `staging`:*
- *The build: chunks 70–80 (migration 048) and the tests-owed run (#275), all merged into `staging`, 2026-10-30 to 2026-10-31.*
- *The checks: the final review on the deployed staging app (`0ea19a9`), release checklist rows RC-1 to RC-24: all PASS or proven by a chunk's review. RC-4's real flip is Adam's, and the P rows are his on production after the release.*
- *How to release: TASKS.md "Release". 1.2.1 releases the 1.2 way (a no-training window from the backup until the Vercel deploy is Ready, and the old RELOAD banner for 1.2 phones); the first release that uses maintenance mode and required updates is 1.2.2's.*

## What's new

- **Programs.**
  - Delete a saved program from YOUR PROGRAMS, beside OPEN and START. A program you are running can't be deleted: its DELETE is greyed out (FINISH IT FIRST). Its finished programs stay in History.
  - Deleting a finished program now removes it in full: its sessions and logged sets, and the Coach analyses and notes that belong to it. The confirmation counts what goes first, and its results leave History, Progress and every stat.
  - Both deletes need a connection and can't be undone.
  - A finished program opens on week 1 and shows no superset labels on its exercises.
  - A finished program's PRIORITIES are read-only: its marks, an older program's included.
- **The workout.**
  - PREVIEW SESSION looks like the workout: the same exercise headers with the LAST line, each set as an upcoming row (targets, W for warmups, ↳ for drops, cues), supersets as the workout draws them, and START SESSION pinned at the foot. The old targets panel is gone.
  - The history icon beside ⋯ is gone: the LAST line and ⋯ → HISTORY open the same sheet.
  - Once every working set and stage is logged or skipped, the rest bar says WORKOUT COMPLETE with a FINISH button. An added set brings the timer back.
  - A working set's LAST line also shows the same set from earlier this week ("MON 32.5 × 8 @ 1").
  - An open warmup is drawn like any open row, with its own ⋯: SET TYPE and DELETE SET.
  - A logged warmup has no ✕: the pen's panel has UNLOG and DELETE, and unticking one unlogs it.
  - UNLOG's note says "Unlog its drops first".
- **Planner.**
  - A superset has its own row in the planner's exercise step, with ↑ ↓ that move the whole superset. A member's ↑ ↓ move it only inside the superset.
  - TEMPO opens a picker, in the planner and in CHANGE THE PROGRAM: four boxes (DOWN · BOTTOM · UP · TOP), each 0–20 or X for as fast as you can. No more typing dashes.
  - In CHANGE THE PROGRAM, SUPERSET is offered on a superset's last member too, so a split superset can be joined again before SAVE.
- **The app.**
  - WHAT'S NEW replaces ABOUT in Settings: every release with its date and notes, newest first. A new version's notes open once, the first time you open it.
  - A maintenance screen (BACK SOON) while Overload is updated. Changes you made offline are kept and sent afterwards.
  - Old versions ask to update before they can be used (UPDATE TO CONTINUE), and unsent changes are kept and sent after the update. The RELOAD banner is gone.
- **Fixed.**
  - An UNLOG, a deleted set or a renumber made offline now reads as done at once, even when its first send failed. In 1.2 it read as undone until the next sync; nothing was lost.
  - A planned set deleted offline stays gone at once, and a LOG can't land on it.
  - A finished program's week strip no longer disappears when a week's cards are taller than the screen.
  - "N days a week" on the CURRENT PROGRAM card counts this week's weekdays, not ones that start next week.

## Rule by rule (SPEC [1.2.1])

Built = built as SPEC says and checked by the row named (the release checklist, TASKS.md "Release"; the final review's results are in HISTORY.md, "2026-10-31 before the release"). Display choices SPEC and the prototype left open were taken as built and are on Adam's vibe-check list. Items [22] and [23] are not used in SPEC.

| SPEC [1.2.1] item | Status | Checked by |
|---|---|---|
| [1] A finished program's PRIORITIES open the read-only screen; a pre-1.1 program's old marks shown through migration 033's mapping (Focus, Don't care); "No priorities were set for this program." | Built (chunk 76) | RC-12 |
| [2] Planner, step 2: a superset's own row with ↑ ↓ moving the whole superset; a member's arrows stay inside it | Built (79) | RC-17 |
| [3] The tempo picker, in the planner and in CHANGE THE PROGRAM; stored as before | Built (79) | RC-18 |
| [4] PREVIEW SESSION in the workout's design; NO SETS PLANNED; no "TARGET RIR" rows or targets panel | Built (77) | RC-13 |
| [5] No history icon; the LAST line and ⋯ → HISTORY open the same sheet | Built (78) | RC-14 |
| [6] WORKOUT COMPLETE and FINISH once every working set and stage is logged or skipped; an added set brings the timer back | Built (78) | RC-15 |
| [7] CHANGE THE PROGRAM from the viewed week | Not built: later (SPEC, "Next-version notes") | — |
| [8a] Delete a saved program: OPEN · START · DELETE, FINISH IT FIRST, the confirmation, offline DELETE off, "This program was deleted." | Built (74; migration 048) | RC-7, RC-8 |
| [8b] Full delete of a finished program, from the program and from History's filter: the counts, the Coach parts only when above 0, the whole deletion | Built (75; 048). From History's filter the app stays on History with the filter reset, where SPEC says PROGRAMS; kept as built | RC-9, RC-10 |
| [9] WHAT'S NEW in Settings; the notes open once after an update; never empty | Built (71) | RC-1 to RC-3 |
| [10] Maintenance mode: the screen, the strip on Adam's account, offline writes kept and sent after | Built (72; 048) | RC-4: the intercepted version PASS; the real flip is Adam's |
| [11] Required updates: UPDATE TO CONTINUE replaces the RELOAD banner; the offline queue survives the update | Built (73) | RC-5, RC-6 |
| [12]–[15] Open and logged warmup rows; UNLOG's note "Unlog its drops first" | Built (78) | RC-16 |
| [16] The Library keeps an exercise whose only log was tried once and deleted offline | Built (80) | RC-21 |
| [17] An offline UNLOG, delete or renumber reads as done at once; a planned set deleted offline stays gone | Built (80) | RC-22 |
| [18] SUPERSET on a superset's last member | Built (79) | RC-19, proven by chunk 79's tests |
| [19] "N days a week" counts the week in force | Built (79) | RC-20, proven by chunk 79's tests |
| [20] [24] [25] A finished program: no superset labels, the week strip stays, it opens on week 1 | Built (76) | RC-11 |
| [21] A working set's LAST line adds the same set from earlier this week | Built (78) | RC-14 ("MON …" by capture only: staging's session is a Monday) |
| Language: every new screen says "program" | Built | RC-23 (`scripts/check-wording.test.mjs`) |
| `v2_app_status`: the app reads it, no app role writes it | Built (048) | RC-24 (`verify-rls`: anon reads the row and cannot write it) |

## Fixed from 1.2

- Fixed (DECISIONS 243, Adam 2026-10-27: "known for 1.2, fix in 1.2.1"): an UNLOG, a deleted set or a renumber made offline whose first sync attempt failed read as undone until the next sync; nothing was lost. The workout now also applies this phone's queued deletions at once (DECISIONS 269 (a)): a planned set deleted offline stays gone, a LOG can't land on it, and History and Volume never count a log the workout hides (chunk 80).
- Fixed (DECISIONS 238 (1)): the Library deleted for good an exercise whose only log had been tried once and then deleted offline, and left a "couldn't sync" notice that RETRY could not clear. The exercise is now kept (chunk 80).
- Fixed: the finished program's week strip collapsed to nothing once a week's cards were taller than the screen (confirmed on production, Adam 2026-10-29; chunk 76).
- Fixed: the CURRENT PROGRAM card's "N days a week" counted the program's newest schedule, not the weekdays in force that week (DECISIONS 190 (a); chunk 79).

## Known and left

Raised during the build and taken as built (DECISIONS 275); the ones a person can meet:
- The maintenance screen has no SIGN OUT: signing out would wipe the offline changes it promises to send (72).
- A phone left idle shows the maintenance screen within the hour; one in use shows it within a minute (72).
- UPDATE TO CONTINUE also covers the sign-in page, which has no SIGN IN on it. Unsent changes wait while the app can't read the release state, and go as soon as it can (73).
- A START list opened more than 5 minutes before another phone deleted a saved program can still start it; the program stays hidden (74; a later migration, in the next-version notes).
- When the counts for a full delete can't be read, the confirmation says "Couldn't count what goes." with DELETE off (75).
- A set-type change made offline whose first send fails still reads as undone until the next sync; UNLOG, delete and renumber are fixed. Nothing is lost, and a LOG writes the type the screen showed (80).
- An exercise added with + ADD EXERCISE has no sets, so WORKOUT COMPLETE stays until its first + ADD SET (78).
- SUPERSET on a last member that has a superset below joins the two; a stored tempo past 20 steps to 20; the CURRENT PROGRAM card shows no days until the week's schedule has been read (79).
- Carried from 1.2 and unchanged: the "Known in 1.2" lines of `docs/release-1.2-notes.md` that 1.2.1 does not fix, Coach's remaining MESO wording among them (Coach is frozen).

## Not in 1.2.1 (later)

- [7] CHANGE THE PROGRAM from the viewed week; 248, EDIT RATINGS on the finished session; the preview's extras (sets per muscle, the warmup routine); week-by-week results of a finished program (SPEC, "Next-version notes").
- Phase 2 and SPEC-1.2's "Later" list; the iPhone install guide and the unsent-changes indicator (SPEC, "Not this version").
