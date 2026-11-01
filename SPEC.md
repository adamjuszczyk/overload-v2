# Overload 1.2.1 — SPEC

Specced 2026-10-29/30 in Claude Chat, BUILD.md v2 step 1. The first build on BUILD.md v2, and its Bootstrap build.
Verdict list confirmed by Adam 2026-10-30. The prototype is in `prototype/`. It is the reference for layout, order and
wording. This file decides behaviour and wins any disagreement with it.

Numbers in brackets (`[8]`) are the brief's item numbers, used everywhere in this build: TASKS, DECISIONS, LEARNINGS.

---

## Purpose

Overload is a strength-training PWA used by Adam and one friend. 1.2 shipped on 2026-10-28.

1.2.1 does four things:
- fixes what Adam's vibe check and the 1.2 review pass found;
- adds deleting programs;
- fixes a 1.2 layout bug found while speccing;
- builds the release features (What's new, maintenance mode, required updates), so that later releases can follow
  BUILD.md in full.

This purpose is the reason for every item below unless an item says otherwise.

### Not this version

- Phase 2 and everything "later". They are in the next-version notes (below), never in this build.
- The iPhone install guide and the unsent-changes indicator (starter features, a later build).
- A full design system. 1.2.1 uses `src/styles/tokens.css` and the existing shared components (`ConfirmDialog`,
  `BottomSheet`, the pickers). New screens use tokens only.
- Coach stays exactly as it is (frozen).
- 1.2.1 itself releases the 1.2 way, since it ships maintenance mode and required updates: a no-training window from the
  backup until the Vercel deploy is Ready, and the old RELOAD banner for 1.2 phones. Release work from 1.2.2 on follows
  BUILD.md step 5 in full.

---

## Objects stored

### New

**`v2_app_status`**: one row, the app's release state.

| Field | Type | Meaning |
|---|---|---|
| `id` | `boolean` primary key, always `true` | Exactly one row. |
| `maintenance` | `boolean`, default `false` | On: the maintenance screen shows and the database refuses writes (rules [10]). |
| `min_version` | `text`, not null | The oldest app version allowed to run, e.g. `1.2.1` (rules [11]). |
| `exempt_user_ids` | `uuid[]`, default `{}` | Accounts that keep working during maintenance. Adam's, set by him on production (Facts to verify). Staging: the test account. |
| `updated_at` | `timestamptz` | |

- Readable by anyone, including before sign-in: the anon role can select it.
- Writable by nobody through the API. Adam changes it in the SQL editor, from the release checklist page.

**Release notes**: not stored in the database. They ship inside the app as a data file, one entry per version:
version, date, and groups of short lines. Each version carries its own notes, which therefore always match the code
running and work offline. The data file is the source of truth; the longer notes file under `docs/` is written from it
(Adam, 2026-10-30, TASKS question 16). 1.2's entry is the "What's new" section of `docs/release-1.2-notes.md`, word for word. The
rule-by-rule table under it is left out.

**On the phone**: `lastSeenNotesVersion`, the newest version whose notes this phone has shown. It's kept where the app
keeps other per-phone settings (TASKS chooses), never in a table.

### Changed

**`v2_programs.deleted_at`** (`timestamptz`, null) [8a]. Set when a saved program is deleted. The row stays.
- No re-linking: runs' `source_program_id` and their copies' `source_workout_day_id` stay as they are, so the "all
  time" history of a workout still joins across runs.

**The app's version**: `1.2.1`, set in one place (`package.json`'s `version`) and read from there by the app. Today it
is `0.1.0` and unused.

### New database functions

**`v2_delete_saved_program(program_id)`** [8a]
- Sets `deleted_at`.
- Refused unless the program is the caller's own, is of kind `saved`, and no run with `source_program_id` = it is
  `active`. The refusal is enforced here, not only in the app.

**`v2_finished_run_counts(mesocycle_id)`** [8b], read-only. Returns what a full delete would remove:
- weeks;
- sessions;
- logged sets (History's count: a head row, not skipped, not a warmup; Adam, 2026-10-30, TASKS question 3);
- Coach analyses: session analyses (DECISIONS 249 row 10), the program analysis (row 13), and weekly analyses of weeks
  that held only this run's sessions (row 15);
- Coach notes (row 14).

The same refusals as the delete apply.

**`v2_delete_finished_run(mesocycle_id)`** [8b]: one transaction, in DECISIONS 249's order.
1. The run's sessions. Their logs, swaps, change rows and session analyses go by cascade.
2. The explicit deletes of rows 13, 14 and 15. Row 15 is found by value: every session id in its `input_snapshot` is
   one of the run's.
3. The run. Its weeks, plan, review decisions, run schedules and old priority marks go by cascade.
4. Its copy program and everything under it. The copy can't go first: `v2_mesocycles.program_id` is no action.

It goes: 249 rows 1–15 and 22. It stays: rows 16–21, unchanged. Refused unless the run is the caller's own and
`completed`.

**Maintenance check** [10]
- A check on every table a signed-in user can write, and inside every RPC that writes, refuses the write while
  `maintenance` is on and the caller isn't in `exempt_user_ids`.
- It refuses with its own error code, so the app can tell this refusal from any other.
- Only signed-in users' requests are refused. Migrations, the dashboard and the SQL editor are never refused.
- How (Adam, 2026-10-30, TASKS questions 4 and 15): one statement-level trigger on every public table with a `user_id`
  column (40 at 1.2's schema, `exercises` included) fires inside every RPC's writes, so every RPC is covered without
  being edited; the two new delete functions check at their top as well. The five existing functions are not changed.

---

## Screens

Every screen below is in the prototype. Open DEMO (the tab on the right edge) for its states. Words here only for what
the prototype can't show.

### Settings · WHAT'S NEW [9]
Prototype: "Settings · WHAT'S NEW", "Release notes", "After an update".
- Settings' ABOUT section becomes WHAT'S NEW. It has one row per release, newest first: version, date, and THIS
  VERSION on the running one. A row opens that release's notes.
- The build hash and time stay, in small text under the list.
- **Shown once:** the first time a version runs on a phone, its notes open as a sheet over the screen the app opened on,
  with GOT IT, over the first signed-in screen and never over the login page (Adam, 2026-10-30, TASKS question 7).
  This happens when the running version is newer than `lastSeenNotesVersion`, or when there is no mark at
  all (so every phone sees 1.2.1's notes once). Closing the sheet any way sets the mark.
- Never empty: 1.2 is seeded.

### Maintenance [10]
Prototype: "Maintenance".
- **Every account except the exempt ones** gets a full screen, nav included: "MAINTENANCE / BACK SOON / Overload is
  being updated. It opens again by itself when that's done."
  - When the phone has unsent offline changes, it adds: "Changes you made offline are kept and sent then."
- **The app checks the flag** at start, when it comes back to the foreground, every hour, and every minute while the
  screen is showing. When maintenance is off, the app opens where it was.
- **An exempt account** (Adam) uses the app as normal, with a strip on top: "MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE
  THE APP". It's styled as the old RELOAD banner was.
- **Offline writes during maintenance:** a queued write refused with the maintenance code stays in the queue. It is not
  counted as failed, doesn't add to the retry count, and shows no RETRY notice. It is sent when maintenance is off.
- **Offline**, the app can't read the flag and works as usual.
- **Signed out**, maintenance shows the same screen (there is no account to exempt); signing in still works, and an
  exempt account then gets the strip (Adam, 2026-10-30, TASKS question 6).
- **On staging** nobody but Adam can write `v2_app_status`: the reviewer proves the refusal on a replay and the screens
  on the staging app with the status request intercepted; one real flip by Adam is on his review-pass list, and the seed
  exempts the test account only (Adam, 2026-10-30, TASKS question 5).

### Update to continue [11]
Prototype: "Update to continue".
- **When it shows:** when the running version is older than `min_version`. It's a full screen, nav included: "UPDATE /
  UPDATE TO CONTINUE / This is 1.2.0. Overload needs 1.2.1 or newer." with an UPDATE button.
  - With unsent changes, it adds: "Unsent changes are kept and sent after the update."
- **UPDATE** gets the new version and reloads: UPDATING…, then the new version opens and shows its notes once [9].
  If that fails: "Couldn't update. Check your connection and try again.", and the button reads TRY AGAIN. "Fails" means
  offline, an update check refused, or no new version installed within 20 seconds; the reload waits for a write in
  flight, as the old RELOAD did (Adam, 2026-10-30, TASKS question 8).
- **It shows whatever the user is doing,** a workout included. After the update the workout reopens on its logged rows,
  the kept numbers of its unlogged sets and its added sets; the running rest timer and numbers typed but not logged are
  lost, as after the old RELOAD (Adam, 2026-10-30, TASKS question 9; Facts to verify 4). An old app must never keep
  writing into a newer database.
- **Checked** at the same moments as maintenance. Offline the app can't read `min_version` and keeps working. Once it's
  online, it's gated.
- **The offline queue survives the update** and is sent by the new version, never by the old one.
- **It replaces the RELOAD banner** (`PwaUpdateNotice`), which is removed. The new code still installs in the background
  as today. The screen only decides whether the old one may still be used.

### Programs · YOUR PROGRAMS: delete a saved program [8a]
Prototype: "Programs · YOUR PROGRAMS".
- Each row's foot gets a third button: OPEN · START · DELETE.
- On the running program's row, DELETE is greyed out, with "FINISH IT FIRST" under it.
- **Confirmation:** "Delete [name]?", "It leaves YOUR PROGRAMS. Its finished programs stay in History." (Adam,
  2026-10-30, TASKS question 2: the UI never says "run"), CANCEL and a red DELETE.
- **Offline**, the confirmation says "You're offline. Deleting needs a connection." and DELETE is off.
- There is no undo.
- A deleted program opened by its address (the planner's `/program/:programId`, which reads by id) is refused like a
  run's copy: "This program was deleted." (Adam, 2026-10-30, TASKS question 11).
- **After a delete:** YOUR PROGRAMS and every saved-program picker leave marked programs out (Facts to verify lists
  them).
- Empty state: "No programs yet", unchanged.

### Finished program: full delete [8b]
Prototype: "Finished program".
- Both DELETE THIS FINISHED PROGRAM and History's program-filter delete open the same confirmation.
- **The confirmation:**
  - Title: "Delete [name]?"
  - While the counts load: "Counting what goes…", with DELETE off.
  - Then: "Deletes its [N weeks]: [N sessions] and [N logged sets][, plus N Coach analyses][ and N Coach notes]. Its
    results leave History, Progress and every stat. This can't be undone."
  - Each Coach part shows only when its count is above 0. Singular and plural follow the counts.
  - "N logged sets" counts as History does: a set's head row, not skipped, not a warmup; drop stages are never counted
    (Adam, 2026-10-30, TASKS question 3). "Coach analyses" are the session analyses of its sessions, its program analysis
    and the weekly analyses of weeks that held only its sessions; "Coach notes" are the notes on its sessions.
  - CANCEL and a red DELETE.
- **Offline:** "You're offline. Deleting needs a connection." and DELETE is off. The counts aren't read.
- **On success,** the phone:
  - drops the queued writes naming each of the run's sessions (`dropQueuedWritesNamingSession`);
  - refreshes History, exercise progress, program progress and Coach's lists;
  - goes back to PROGRAMS.
- **A failed delete** shows "Couldn't delete [name]." with the reason, inside the confirmation, as today.
- **A run started by mistake:** FINISH, then DELETE. There's no direct discard.

### Finished program [24] [25] [20]
Prototype: "Finished program".
- **[24]** The week strip (WK1…WKn) never shrinks. Today it collapses to nothing once a week's cards are taller than the
  screen. Confirmed on production by Adam, 2026-10-29.
- **[25]** It opens on week 1, not on the first week whose structure changed.
- **[20]** Its exercise rows show no superset labels (DECISIONS 193 (a)): `superset: null` from `structureOf`.

### Finished program · PRIORITIES, read-only [1]
Prototype: "Finished program · PRIORITIES".
- **Every finished program's PRIORITIES row** opens the same read-only screen as the running program's (board PR5):
  - the run's name over PRIORITIES;
  - groups with their marks;
  - tap a group to unfold its subgroups;
  - nothing on it writes.
- **A pre-1.1 run** (no marks in `v2_program_priorities`, some in `v2_coach_meso_tag_priorities`) shows its old marks
  through migration 033's mapping: top → Focus, low → Don't care; high and normal show nothing. The finished program's
  header line reads them the same way ("Focus: quads · Don't care: calves").
- Coach's old page (`/meso/:id/priorities`, `MesoPrioritiesPage`) stays in the code, untouched, and nothing links to it.
- The finished-program editor (`FinishedProgramPriorities` over `StepPriorities`) is replaced by the read-only screen.
- Empty: "No priorities were set for this program."

### PREVIEW SESSION [4]
Prototype: "PREVIEW SESSION", with "1.2 today" there for comparison.
- **What it's for:** the preview matches the workout screen's design. It adds no new content.
- **Header:** back, "[eyebrow as the workout writes it] · PREVIEW", the workout's name.
- **Each exercise** has the workout's header (`WorkoutExerciseHeader`): name, muscle, tempo, and the LAST line, which
  opens the last-time sheet.
- **Each set** is drawn as an upcoming row, read-only: label, targets ("01  55 kg × 9 @ RIR 2"), W for warmups, ↳ for
  drops under their head, the stage chip ("DROPSET · 1 DROP"), and cues under the row.
- **Supersets** are drawn as the workout draws them: the link line with the round rest, lettered members with their
  headers, then ROUND 1 (A1, B1), ROUND 2…
- **START SESSION** is pinned at the foot.
- **Removed:** the old targets panel (its "planned RIR" line), the old last-time panel, the "TARGET RIR n" rows and the
  history icon.
- Empty states: an exercise with no sets shows "NO SETS PLANNED"; a workout with no exercises shows "No exercises in
  this workout yet."

### Workout [5] [6] [12]–[15] [21]
Prototype: "Workout". It's the real workout screen on board W1's data.
- **[5]** The history icon beside ⋯ is removed from every exercise header. The LAST line and ⋯ → HISTORY open the same
  sheet.
- **[6]** Once every working set and stage is logged or skipped, the rest bar shows WORKOUT COMPLETE and a FINISH button
  (which opens the finish screen) instead of the rest timer and the jump button.
  - Open warmups don't count. Added sets do. A workout with no working set or stage at all keeps the usual bar (Adam,
    2026-10-30, TASKS question 10).
  - The rest keeps being timed underneath. An added set or exercise brings the bar back, showing the rest since the last
    set, and the next log records it.
  - FINISH SESSION at the foot of the list stays.
- **[12]** An open warmup row is drawn like any open row that isn't the current set: muted W, outlined LOG (DECISIONS
  222 (b)).
- **[13]** An open warmup row in rows mode gets the set's ⋯, with SET TYPE and DELETE SET (228 (a)).
- **[14]** UNLOG's disabled note says "Unlog its drops first" (232 (a)).
- **[15]** A logged warmup has no ✕ in rows mode; the pen's panel has UNLOG and DELETE. In tick mode the untick is an
  unlog, with no confirm (233 (a)).
- **[21]** A working row's LAST line adds the same set from the most recent earlier session this week:
  "LAST 30 × 8 @ 1   MON 32.5 × 8 @ 1" (218 (a), board W1). It reads from the sessions `lastTimeView` already reads,
  at the row's set number, warmups out. There's no new read.

### Planner, step 2 [2] [3]
Prototype: "Planner · 2 EXERCISES".
- **[2] A superset** gets its own row above its first member: link icon, "SUPERSET A · 3 EXERCISES", ↑ ↓. These move
  the whole superset as one block, as the member arrows do today.
  - A member's ↑ ↓ now move it past the member next to it, inside the superset only. They're greyed out at the
    superset's edges.
  - Single exercises are unchanged.
- **[3] The TEMPO row** opens the tempo picker instead of a text box. See Tempo picker.

### Tempo picker [3]
Prototype: "Planner · 2 EXERCISES" → "Tempo picker".
- **The sheet** is the rep and RIR pickers' (boards 6 and 7): eyebrow is the exercise's name, the title "Tempo", NONE |
  SET.
- **With SET:** four boxes, DOWN · BOTTOM · UP · TOP, each with − and + under it, and one line: "Seconds per phase. X
  is as fast as you can."
- **A box** takes 0–20 or X, typed or stepped. − below 0 gives X; + from X gives 0.
- The footer says what it will set: "SET TEMPO 3-1-X-0", or "SET NO TEMPO".
- Stored exactly as today: `normaliseTempo`, 4 fields.
- **Used in two places:** the planner's TEMPO row, and CHANGE THE PROGRAM's exercise sheet (not drawn in the
  prototype: the same picker replaces its TEMPO text box and its refusal line).

### CHANGE THE PROGRAM [18] (not drawn)
- **[18] SUPERSET** is offered on a superset's last member too, linking the exercise below into that superset
  (DECISIONS 246 (a)). With it, a superset split inside the card can be joined again before SAVE.
- Tempo uses the tempo picker [3]. Nothing else changes.

### PROGRAMS · CURRENT PROGRAM card [19] (not drawn)
- "N days a week" counts the days of the week in force (`scheduleForWeek`, as Today and Plan do), not the run copy's
  newest schedule (DECISIONS 190 (a)).

---

## Rules

1. **Guiding rule** (BUILD.md): the simplest behaviour that never loses or wrongly writes data, even if a rare case
   displays imperfectly.
2. **Deletes need a connection.** Both deletes [8] are online-only and are never queued.
3. **One check decides maintenance,** in the database. The screen is only how a person learns about it.
4. **Required updates:** every release raises `min_version`, including one that changes nothing incompatible.
5. **Queued writes across a version change.** Queued writes are sent by the version that's running. A release that
   changes the shape of anything the queue writes also converts the queued writes of the old shape. This goes into
   RULES.md as a standing rule (done 2026-10-30: RULES.md, "Standing rules").
6. **Queue fixes [16] [17]**, as decided:
   - DECISIONS 238 (1): the one-line change in the Library's preflight, a small DATA chunk;
   - 243: the two lines in `withQueuedSetLogs`.
   - [17], a third line (Adam, 2026-10-30, DECISIONS 269 (a)): the workout's read also applies this phone's queued deletion records (`v2_session_set_changes` upserts, matched as `withChangeRecords` matches them), read-only: nothing in the queue changes. So a planned set deleted offline stays gone at once, and a LOG can't land on it: the set stays hidden, and History and Volume never count a log the workout hides.
7. **Display only:** items 1, 2, 4, 5, 6, 12–15, 18–21, 24 and 25 write nothing new. Items 1 and 15 write less than
   today (no priority edits; an untick unlogs instead of deleting).

---

## Facts to verify

Unknowns about the existing app. These are not choices: TASKS checks each one and writes down what it found.

1. **Every saved-program picker** that must leave out marked programs [8a]. Known so far: YOUR PROGRAMS
   (`useSavedPrograms`), START's program list (`StartProgramSheet`). Check every read of `v2_programs` with `kind =
   'saved'`, including `usePrograms()` callers that filter saved programs themselves.
2. **Every table a signed-in user writes, and every RPC that writes,** so that the maintenance check covers them all.
   Includes Coach's tables (Coach's code isn't touched; during maintenance its writes are refused like any other) and
   writes from `api/` functions using the service role.
3. **The offline queue (Dexie) survives the reload an update does,** and sends from the new version.
4. **A workout in progress reopens where it was** after UPDATE's reload: drafts, added sets, rest timer.
5. **How the app learns its own version:** `package.json` into the build, beside `__BUILD_HASH__`.
6. **Adam's production user id** for `exempt_user_ids`. Adam sets it on the checklist page; agents never write
   production.
7. **DECISIONS 249's row 15 query** (weekly analyses found by value) against the real `input_snapshot` shape, on staging.
8. **Where the "planned RIR" line [4] came from** (`PlanTargetsPanel`), and whether anything else uses `PlanTargetsPanel`
   or `ExerciseReference` once the preview stops using them. If nothing does, they go.

## Left untouched

- **Coach**, all of it, including `MesoPrioritiesPage`, which is no longer linked [1]. Coach analyses and notes deleted by
  [8b] are data, not code.
- **CHANGE THE PROGRAM**, apart from [18] and the tempo picker [3]: its drag reorder, DAYS card, rule box and save.
  Item 7 (changing from the viewed week) is later.
- **History** apart from its program-filter delete [8b]. **Plan**, **Progress**, **Library**: unchanged.
- **Logging, unlog and delete rules** in the workout apart from [13] and [15]. Warmups still never take part in the
  current set.
- **The finished-session screen:** no ratings-only edit (248, later).

---

## Next-version notes (later)

These go into the next-version notes at setup, with their detail. They are not built.

- **[7] CHANGE THE PROGRAM from the viewed week.** Worked out so far:
  - rest, tempo, unit, supersets and the warmup routine are stored once per run, so they can't start at a later week
    without per-week storage;
  - a new week takes its exercise list from the run copy (045), so the weeks between now and the start week would have
    to be planned first, or they'd pick up the change;
  - weekdays already have a from-week (`v2_run_schedules`);
  - 247 (b)'s rule-box line ("weeks 4–5 are planned and change too") belongs with it.
- **248:** EDIT RATINGS on the finished session, no reopen (SPEC phase 2).
- **Preview extras:** sets per muscle, the warmup routine.
- **Week-by-week results of a finished program:** planned next to logged per exercise ("the numbers half" of the
  finished program, Adam 2026-10-11). Not discussed for scope, only noted.
