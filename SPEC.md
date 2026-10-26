# SPEC.md — Overload Planner Extension

## What this is

Overload is a strength-training PWA: programs, weekly planning, live session
logging, history. Until now it was built around one person's way of training and
planning.

**Purpose of this build:** make the app versatile and clear enough to be useful
for other lifters — people who plan with stable volume, who train in a rotation
instead of on weekdays, who plan weights ahead or never plan at all — with Poland
as the first market.

**Built in two phases from this one spec.** This was a deliberate size decision:
the list doesn't fit one build, and the spec came from one planning session.
Every item below is tagged **[P1]** or **[P2]**. Each phase gets its own
`TASKS.md`, build and review. Phase 2's `TASKS.md` is written after phase 1 has
been used in real training; anything that use reveals gets written back here
first.

**[P1.1]** marks the rules changed by SPEC change 1.1 (decided 2026-10-10,
during the phase 1 review: every edit to a running program happens in the week),
including Adam's answers to the spec gaps it raised (same day). `TASKS-1.1.md`
plans them.

**[1.2]** marks SPEC change 1.2 (decided 2026-10-12, after phase 1.1 was used in
real training by Adam and one other lifter). It is planned in its own
`TASKS-1.2.md`. Its purpose: make planning and the workout screen clear to
someone who isn't Adam. What it changes, in short:
- Plan shows plans, never what was done. What last week actually did reaches the
  next plan only on demand: a REVIEW line and a VOLUME sheet.
- A week gets planned when it starts or with PLAN FORWARD, one week at a time.
  Auto-copy takes structure, volume and set types; numbers come with COPY.
- Exercise-level changes to a running program move back out of the week, into
  one screen: CHANGE THE PROGRAM.
- One picker per thing (set type, rep target, RIR target), used everywhere.
- Programs become a tab next to Plan, with FINISH on the current program.
- The workout screen gets the log lock, delete set, unlog and set type changes,
  and loses ADD STAGE.
- Deload rules come out of programs; they live in Settings only.
- "Program" everywhere; the app never says "meso", "mesocycle" or "run".

The source of every [1.2] rule is the decisions list
(`claude/overload-1.2-decisions.md` in the project, item numbers in brackets
below, e.g. (13a)). Rules that 1.2 supersedes are removed from this file, not
kept alongside; "Superseded by 1.2" at the end of this section lists them, so
`TASKS-1.2.md` knows what is being undone.

- **Phase 1 — what a workout is:** planning, scheduling, set structures, and how
  they render on the workout screen.
- **Phase 2 — how logging feels, plus the platform:** tracked fields, logging
  mechanics, login, library, navigation, settings, Polish. [1.2] pulls four
  logging items forward (row states, the current set, the lock, delete set) and
  adds one (unlog); the rest of phase 2 is unchanged.

**This version is not doing:** anything for coaches or trainers, AI changes (Coach
stays exactly as it is), notifications, templates, cardio, progress screen
rebuild. Full list at the bottom. [1.2] is also not doing: starting a workout
without a program (front of phase 2), reordering exercises during a workout
(phase 2), RPE (phase 2), restyling screens 1.2 doesn't touch (see Design
boards).

### Superseded by 1.2

- [P1.1] "The program tab is removed … design fields stay run-wide, shown and
  edited in the week's Structure view." → design fields are edited in CHANGE THE
  PROGRAM (Rules → Programs and runs).
- [P1.1] "The planner refuses to open a run's copy." → the stepped program
  planner still refuses it; CHANGE THE PROGRAM is the screen that edits it.
- [P1.1] "Fixed for the run: the schedule … and the deload-rules override." →
  weekdays can change from next week (1e); the override no longer exists (16b).
- [P1.1] Plan's Sets / Structure views. → one week view (Screens → Plan).
- [P1.1] "Anything different from the week's source is highlighted." → kept,
  rewritten for 1.2's copy rules (Weeks and copying → Changes since the source).
  Only the REVIEW dots tried during design are gone.
- [P1.1] "Adding or removing an exercise in a week is allowed for both planning
  types." → exercise-level changes happen only in CHANGE THE PROGRAM (7b).
- [P1.1] "Any two neighbours in a week can be linked; linked exercises show as a
  superset only in weeks where they're next to each other." → linking happens in
  CHANGE THE PROGRAM.
- [P1.1] Priorities "Plan shows them view-only". → PROGRAMS shows them (PR5).
- [P1] Programs page "reached from the plan screen's header", "Active run: End
  run", "Completed runs: each with delete and its priorities pages". → the
  PROGRAMS tab (8), FINISH, and the finished program screen (PR14).
- [P1] Empty state "A week-dependent run whose weeks start empty → Copy last
  week on the empty week". → weeks never start empty.
- [P1.1] "Make this week the new default." → removed; lasting stable changes go
  through CHANGE THE PROGRAM.
- [P1] "Apply this change to planned weeks ahead." → removed.
- [P1] "A week gets planned the first time it's opened in Plan." → it gets
  planned when it starts, or with PLAN FORWARD.
- [P1] "Weights and RIR always come from last week" (auto-copy). → numbers come
  only with COPY.
- [P1] Settings "week start (copy / empty)". → removed; weeks always auto-copy.
- [P1] "Deload rules: global default in settings, override per program." →
  Settings only.
- [P1] "Copy last week" as its own action. → merged into COPY.
- [P2] "Lock: … Tapping another row makes it current." → 18a.
- [P2] "Row actions (make a dropset/stage) appear only on the current set or the
  one just logged." → the set type picker (19).
- [P2] "Unlogged sets at finish behave as they do today." → the warning comes
  back (11).
- [P2] Row states, the current set, delete set and the log lock move from phase 2
  to 1.2.

### Defaults this spec chose — confirmed by Adam, 2026-10-12

Places where the decisions list was silent and a builder would otherwise have
guessed. Each is written into the rules below as stated here.

1. **How a CHANGE THE PROGRAM save lands** in sessions already planned and not
   done (Programs and runs → How a save lands).
2. **Weekdays:** a day another workout already uses can't be picked (it says
   whose day it is); a workout needs at least one day; a week already planned
   forward takes the new days.
3. **The sequence order** stays fixed during a running program, as in 1.1.
4. **REVIEW actions** for the cases the decisions don't name (Review → Actions).
5. **Superset controls** in CHANGE THE PROGRAM: SUPERSET links an exercise with
   the one below; inside a superset card, a link toggle between two members
   splits or joins there; UNLINK splits the whole superset.
6. **Unlog edge cases:** a set with logged drops after it can't be unlogged until
   they are; unlogging never restarts the rest timer or changes the session's
   status.
7. **Defaults inside sheets, as the boards draw them:** COPY starts with every
   field and every not-done workout ticked, overwrite off; "Use for all N sets"
   starts ticked in the rep and RIR pickers.
8. **+ ADD SET** in Plan adds a Normal set with the previous set's rep target and
   no weight or RIR.
9. **+ ADD ROUND** during a workout adds a set to every member of a superset (as
   board W1 draws); a member's ⋯ adds one to that member only.
10. **"Last week" for REVIEW** is the week before the one shown (the previous
    cycle for sequence runs), never across programs; week 1 has no REVIEW.
11. **Finished program history (C1)** shows what the weeks store: exercises,
    their order, set counts and set kinds. Tempo, rest, supersets and the warmup
    routine are stored once per program, not per week, so they aren't in it.

### Answers to TASKS-1.2's spec gaps — Adam, 2026-10-13 and 2026-10-14

Each is written into the rules below as stated here.

- **G46 — How unlog is stored:** unlog deletes the set's log (its stages' logs
  first). The numbers stay in the row as a draft on that phone (Dexie, like
  warmup ticks) until the set is logged again, which writes a new log, or the
  session ends. Nothing on the server changes shape, so nothing that counts
  logged sets changes, Coach included.
- **G47 — Offline:** logging, delete set and unlog work offline and sync later
  through the sync queue. A set type change on a logged set and the edit
  panel's SAVE need a connection, as editing a logged set does today.
- **G48 — Stable weeks' legend:** "CHANGED SINCE WEEK N", the same as other
  weeks. "THIS WEEK ONLY" is only the per-exercise line.
- **G49 — Warmup rows in Plan:** no RIR target.
- **G50 — Pre-1.1 finished programs:** PR14's PRIORITIES row opens today's
  completed-run priorities page as it is, wording included. It is the one
  exception to the "program" wording sweep.
- **G51 — "Drops and stages count as":** applies to the VOLUME sheet only.
  History, Progress and the finish screen count as they do today.
- **G52 — A workout skipped as a whole** (2026-10-14): a session marked
  skipped gives no REVIEW items. A finished session with skipped sets still
  lists each of them.
- **G53 — COPY on a stable week** (2026-10-14): Weight and RIR only. The
  default owns a stable week's rep targets; they change in CHANGE THE PROGRAM.
- **G54 — Warmups and the log lock** (2026-10-14): warmups never take part.
  The current set is the first unlogged working set or stage; a warmup's LOG
  never asks.
- **G55 — The ⋯ on warmup and stage rows in Plan** (2026-10-14): a warmup
  row's ⋯ opens the set type picker with Normal and Warmup only, the rest row
  where any other set would have one, Cues and REMOVE THIS SET. Stage rows have
  no ⋯; the head's stepper changes how many there are.
- **Cues edited during a workout** (2026-10-14): change that set's cue in this
  week's plan, where cues live. Cues are never copied, so it affects this week
  only; a workout on two days that share one plan shows it on both.

---

## Design boards [1.2]

1.2 was designed before this spec was written, on a canvas of boards. The boards
that 1.2 uses are copied into the repo under `design/1.2/`: one PNG per board
(light theme), the board's source file (`.dc.html`, readable HTML with the
sample data in its script), and `design/1.2/INDEX.md` mapping board IDs to
files. Board IDs below (e.g. `PR13`) refer to that index.

- **What a board decides:** layout, order, wording and which controls are
  visible versus behind ⋯. **What this spec decides:** what every action does,
  the rules, what is stored, and every state no board draws. When a board and
  this spec disagree, this spec wins and the builder escalates the disagreement
  as a spec gap; a builder never picks one.
- **Never pixel-match.** Correct behaviour and clean code beat exact visual
  matching. Boards use the app's existing tokens (Archivo, Archivo Expanded,
  JetBrains Mono, the accent variables in `src/styles/global.css`); a board
  colour or size that has no token maps to the nearest existing one.
  - Text on the accent (DECISIONS 128 (g), 129 (d), 130 (j); Adam
    2026-10-15): a new token, `--on-accent`, in global.css for both themes, set
    to the near-black the boards draw, used wherever text sits on the accent in
    the screens 1.2 rebuilds and the shared components they use (DECISIONS 154,
    Adam 2026-10-16: Scope of the look, below).
- **Sample data is sample data.** Names, numbers and dates on boards are
  examples. "Week 2", "Push Pull Legs", "Bulk" and so on are never literals.
- **Scope of the look.** The screens 1.2 touches are rebuilt to their boards in
  full, including parts no decision changed, so a screen is never half old and
  half new: Plan (with PROGRAMS), CHANGE THE PROGRAM, the stepped program
  planner, and the workout screen. Every other screen (Today outside the workout
  itself, History, Progress, Library, Settings, sign-in, Coach) keeps its
  current code. Its only 1.2 changes are the wording sweep (Language) and the
  Settings rows listed under Screens → Settings. The canvas also draws those
  screens; those boards are not part of 1.2 and are not copied.
  - Text on the accent (DECISIONS 154, Adam 2026-10-16): Coach stays exactly as
    it is. `--on-accent` applies to the screens 1.2 rebuilds and the shared
    components they use; screens 1.2 doesn't touch keep their current code.
- **Errors (15).** Wherever an error is shown, the line under its headline is
  the real reason: the message the server or the client actually returned.
  Supabase errors aren't JavaScript `Error` objects, so the check reads their
  `message` field. "You may be offline" is shown only when that is the reason.
  Boards that still show "Check your connection and try again" for every error
  follow this rule instead.

### Board index

| Screen | Boards |
|---|---|
| Plan, week view | 1, 1a, 1b, 1c, 1d, 1e, 9, 10, 11, 12 |
| Plan sheets and pickers | 2 (COPY), 3 (VOLUME), 4 (REVIEW), 5 (set type), 6 (rep target), 7 (RIR target), 8 (cues) |
| PROGRAMS tab | PR1–PR15 (PR13/PR13b: new program; PR14: finished program) |
| CHANGE THE PROGRAM | PL1 (week-dependent), PL1b (stable), PL2–PL9 |
| Stepped program planner | PP1, PP1b, PP2, PP2b–PP2f, PP2d2, PP3, PP3b–PP3d, PP4, PP4b, PP5, PP5b, PP6 |
| Workout screen | W1–W11, W13–W19 (there is no W12), with W2b, W3b, W7a, W7b |

Known gaps between boards and this spec (the spec wins):
- PL3 (superset member ⋯) also holds the member's own REST and REST AFTER rows,
  as PL2 does, above WITHIN ROUND and AFTER ROUND. The board omits them.
- Board 3 (VOLUME) lists subgroups ("Side delts"); volume counts muscle groups
  (Volume per muscle).
- PR14's example lists a tempo change and a superset change; the history shows
  only what weeks store (Defaults, 11).
- Board 1a's legend reads "THIS WEEK ONLY"; a stable week's legend is "CHANGED
  SINCE WEEK N" like every other week's (G48).
- Boards 1 and 1c show RIR on a warmup row; warmup rows have no RIR target
  (G49).

The light-theme board is the reference; every board also has a dark version on
the canvas, which `design/1.2/` doesn't copy because the app's dark tokens
already produce it.

---

## Facts TASKS.md must verify against the real app (not decisions)

- How deload weeks are stored today (they move to per-session marking).
- The four current priority levels' stored values (mapping is decided below).
- That only one run can be active at a time (assumed unchanged).
- Today's "skip / do it the next day" behaviour for missed weekday sessions.
- [P2] Today's pre-fill source for weight and reps.
- [P2] That a session's start time is stored (clock times depend on it).
- [P2] What "archive" does to an exercise today, and that every archived
  exercise survives the move to the catalog.
- [P2] Whether seeded per-user exercises carry a reference to their seed entry,
  and which ones have user edits (renames, tags, flags).
- [P2] How Supabase links a Google identity to an existing email account — run it
  against a scratch project, don't assume.
- [P2] Why the email confirmation page shows an error after a successful
  confirmation.
- [1.2] When a week gets planned today (`v2_plan_week`, the Plan and Today
  callers) and what it copies, so the new trigger (week start or PLAN FORWARD)
  and the new copy content (structure, volume, set types) replace it without
  leaving an old caller planning weeks on open.
- [1.2] How a set's kind and stages are stored on a week set and on a logged
  set, so a set type change in Plan and during a workout (session-only) can be
  written without touching the plan.
- [1.2] Where per-set rest and stage rest are stored today (run-wide, on the run
  copy's program sets; G45), so the week view and CHANGE THE PROGRAM write the
  same place.
- [1.2] How "unlogged" and "logged" are represented on a set log, and what
  depends on a set being logged (session status, history, "last time",
  sync queue), so unlog doesn't leave anything pointing at a log that no
  longer counts.
- [1.2] Which of Adam's programs or runs have a deload-rules override, so the
  fallback to Settings is known before it happens. Read on production, read-only,
  filtered to Adam's user id; other users' rows are never read, and the fallback
  is silent either way.
- [1.2] What the start-program path does after starting (today it opens
  priorities), so it lands on Plan instead.

---

## Objects stored

Domain level. `TASKS.md` maps these onto the existing schema.

**Program** [P1] — the reusable plan. Never changed by running it.
- name
- schedule type: `weekday` | `sequence`. [1.2] Required at creation; there is no
  default (16a).
- planning type: `stable` | `week-dependent`. [1.2] Required at creation; there
  is no default (16a).
- priorities: a list of (muscle group or subgroup, `focus` | `dont_care`).
  Anything unlisted is normal.
- workouts (below)
- for `sequence`: the ordered sequence — workout positions and rest-day
  positions, e.g. A, rest, rest, B, rest, rest, C, rest, rest
- [1.2] The stored deload-rules override is no longer read or written (16b). The
  column stays; no destructive migration. Any existing override falls back to
  Settings silently.

**Program workout** [P1]
- name
- for `weekday`: its day(s) of the week
- warmup routine: ordered checklist items (free text)
- exercises, ordered (below)

**Program exercise** [P1]
- exercise reference
- position; superset group (exercises sharing a group form one superset block)
- rest (optional), rest after this exercise (optional), tempo (optional, text in
  the form 3-1-1-0, `X` allowed)
- superset rest overrides, on the block: rest between exercises within a round,
  rest after a round
- unit preference (existing)
- sets (below)

**Program set** [P1] — for `stable` this is the volume; for `week-dependent`
it's week 1. For a stable run, the run copy's sets are the run's **default**:
every new week copies from them [1.2: and CHANGE THE PROGRAM edits them].
- kind: `working` | `warmup` | `staged`
- for `staged`: stage kind (`dropset` | `rest-pause` | `myo-reps` | `cluster`),
  its stages, and rest between stages (default: dropset none — stages run back
  to back; rest-pause, myo-reps, cluster 15 s)
- rep target, optional: a number | a range (min–max) | `AMRAP`
- rest override for the rest after this set, optional

**Run** [P1] — one run of a program (today's "mesocycle"). [1.2] The app calls it
the current program while it runs and a finished program afterwards; the word
"run" never appears in the UI.
- program reference; start; end when the user finishes it
- its own copy of the program's plan. For a stable run this copy is the run's
  default. [1.2] During a run it changes through CHANGE THE PROGRAM (Rules →
  Programs and runs).
- for `sequence`: position in the sequence, counted from the last workout done

**Week** (or **cycle**, for sequence runs) [P1] — exists once planned.
- run reference; index
- per session: exercises as planned for this week (written by the auto-copy and
  by CHANGE THE PROGRAM [1.2]), sets with weight target, rep target override, RIR
  target, tags per set
- [1.2] RIR target: a number or a range (min–max) (17). A second, additive
  column holds the range's upper end.
- per session: deload flag
- [1.2] REVIEW decisions: which of last week's differences (13) were used or
  ignored, so a decided item doesn't come back. Stored per week; `TASKS` decides
  the shape.

**Session** [existing, extended]
- [P1] deload flag; moved-to date (weekday)
- [P2] session-only exercise order
- [P2] clock start and end (end derived from the last logged set, as duration
  already is)

**Set log** [existing, extended]
- [P1] set kind and stage kind as planned
- [1.2] set kind and stage kind as done: a set type changed during the workout
  (19) is recorded on the session's set, never on the plan
- [1.2] unlogged again (18c): a logged set can return to unlogged, keeping its
  numbers. Unlog deletes the log; the numbers are kept as a draft on that phone,
  not on the server (G46).
- [1.2] an added set's place: its place among the sets added to its exercise in
  that session, from 1, in the order they were added (18b). Written when the
  added set's log is first written, kept on re-log after an unlog (the draft
  holds it until then); planned sets have none. A log with none and no planned
  set (logged before 1.2) orders by logged time, then id (DECISIONS 174).
- [1.2] only an added set's own log carries the place; its drop and stage logs
  leave it null (DECISIONS 177, Adam 2026-10-19).
- [P2] side split: when split, L and R values for every tracked field
- [P2] for bodyweight exercises: weight is signed added load (0 = bodyweight)

**Settings** [existing, extended]
- [P1] warmup display: `rows` | `tick`; default deload rules (below)
- [1.2] how drops and stages count in volume: `whole set = 1` | `each drop = 1` |
  `each drop = ½` (default `each drop = ½`) (14b)
- [1.2] "Log sets in order" (the log lock): on (default) | off (18a). Moved
  from [P2].
- [1.2] The "new week starts: copy / empty" setting is removed.
- [P2] per tracked field (RIR/RPE, form, set time, energy/pump):
  `off` | `optional` | `mandatory`; effort scale `RIR` | `RPE`; pre-fill:
  `empty` | `planned` | `planned, else last time`; app language; exercise-name
  language

**Deload rules** [P1] — [1.2] in Settings only (16b). Each rule independent and
optional:
- sets: −percentage or −number; rounding up or down; minimum 1
- weight: percentage of base; rounding up or down; precision step (e.g. 2.5 kg,
  5 kg, or lbs equivalents)
- reps: ±number
- RIR: +number

**Catalog exercise** [P2] — shared across all users.
- Polish name, English name, muscle groups/subgroups, flags: unilateral,
  bodyweight

**User exercise** [P2]
- either a catalog reference or custom
- for catalog: personal per-field edits (name, muscle tags, flags)
- for custom: name, optional second-language name, muscle tags, flags
- in library (ticked) yes/no
- exercise notes: free text (machine setup, standing cues)

---

## Rules

### Programs and runs [P1]

- A program stays exactly as it was saved. Running it never changes it, and
  starting it again later always starts from how it was saved.
- Activating a program creates a run with its own copy of the plan.
- [1.2] **Creating a program** (16a): the New program sheet asks for the name,
  the schedule type and the planning type. Neither type is preselected; CREATE
  PROGRAM stays disabled until both are chosen, and the sheet says why. Each
  option carries a one-line description (PR13, PR13b). Both can be changed later
  in the stepped program planner, as today.
- [1.2] **Changing a running program: CHANGE THE PROGRAM** (1c, 7a, 1e). One
  screen, opened from the week view's bottom button ("CHANGE THE PROGRAM FROM
  WEEK N", or "FROM CYCLE N") and from EDIT PROGRAM on the current program's card
  (7b). It edits the run's copy, never the saved program.
  - It applies to every session that isn't done yet, from the current week
    (cycle) on, including a week already planned forward, and to what later
    weeks are copied from. Done sessions keep their plan. There is no choice of
    start week.
  - It says so at the top (1d): week-dependent "Changes start in week N. Sets
    are planned in each week, in Plan."; stable "Changes start in week N. Every
    week from then on copies this." Under it: which done session keeps its plan,
    and that the saved program doesn't change.
  - **What it edits:** exercises (add, swap, remove, order by drag), supersets
    (Supersets below), the warmup routine, each exercise's rest, rest after,
    tempo and unit (behind the exercise's ⋯), workout names, and weekdays.
  - **Week-dependent:** it holds no sets. An exercise added here lands in this
    week's not-done sessions with no sets; its card says "New. It lands in week N
    with no sets; add them in Plan." Sets are planned in Plan.
  - **Stable:** it also shows the default's sets, as rows: set number (opens the
    set type picker), rep target (opens the rep target picker; ALL sets every
    set of the exercise), rest after the set, and "+ SET". A set is removed from
    the set type picker's REMOVE THIS SET (PL1b).
  - **Weekdays (1e):** each workout shows its days; the selected workout's DAYS
    card toggles weekdays and renames it. New days start next week: this week's
    sessions keep their days, and the card says so ("Was Tuesday. New days
    start in week 3. This week Pull 1 stays on Tuesday; MOVE THIS SESSION in
    Plan moves just this week."). Sequence runs have no DAYS card.
  - **Not here:** adding or removing a workout (a different set of workouts
    means a new program), the schedule type, the planning type, the sequence
    order.
  - CANCEL leaves without saving; SAVE CHANGES writes everything at once. Saving
    and failing to save follow the app's pending and error patterns (Errors).
  - "Week N" in the rule box is the week of the next session that isn't done.
  - **How a save lands** (Defaults, 1). "Not done" means not started: a session
    in progress is left exactly as it is.
    - Added exercise: appended where it was placed, in every not-done session of
      that workout. Week-dependent: no sets. Stable: the default's sets.
    - Removed exercise: removed with its planned sets from every not-done
      session (PL7).
    - Swapped exercise: the new exercise takes the old one's sets (count, kinds,
      stages, rep targets); weights, RIR and cues are cleared, since they belonged
      to a different exercise.
    - Reordered exercises: the new order applies to every not-done session.
    - Stable default sets (count, kinds, stages, rep targets): applied to a
      not-done session's sets only where that session still matches the old
      default. A set changed for that week only ("THIS WEEK ONLY") is left as it
      is. Weights, RIR and cues on sets that stay are kept.
    - Rest, tempo, unit, superset rests, superset grouping and the warmup routine
      are run-wide: one value, every not-done session.
    - Weekdays: see below.
    - A not-started session marked deload (DECISIONS 142, Adam 2026-10-15): the
      save also applies these rules to its saved pre-deload copy, so UNMARK
      restores the plan with the change in it.
  - **Weekdays storage:** this week's not-done sessions keep their days; the new
    days apply from next week, including a week already planned forward. How
    that is stored (an effective-from week, or this week's sessions recorded as
    moves) is for `TASKS` to choose and verify against Today's scheduler. A day
    another workout already uses can't be picked: the toggle is disabled and the
    card says whose day it is ("Thu is Push 2's day"). At least one day stays
    on.
    - The DAYS card (DECISIONS 169, Adam 2026-10-16) checks the edit as it
      stands, so two workouts can trade days in one save.
- [1.2] **The stepped program planner** still refuses to open a run's copy
  (PP5: "This is the current program's copy … It opens from Plan instead").
- [P1.1] **Starting a run needs a schedule:** at least one workout on a weekday
  (`weekday`), or one workout in the sequence (`sequence`). Start isn't
  possible without one.
- [1.2] **Starting** lands on Plan, week 1. The start sheet's optional name
  field defaults to the program's name. Starting while a program runs finishes
  the running one first and says so (PR9).
  - [1.2] The stepped planner's START opens the start sheet (PR8) with that
    program picked; it never ends a running program silently (Adam,
    2026-10-22, DECISIONS 214 (a)).
- [1.2] **Finishing** (8c): FINISH on the current program's card asks "Finish
  [name]? The program stays saved, so you can start it again. Every week stays
  in History." It replaces END RUN.
- **Priorities are a property of the program.**
  - They're set in the planner when the program is built, and copied to a run
    when it starts.
  - They can't be changed during a run: PROGRAMS shows them view-only (PR5).
  - [1.2] A finished program's priorities stay editable, from its PRIORITIES
    row (PR14). It shows and edits the run's own priorities (the ones copied at
    its start). A run finished before 1.1, whose marks exist only in the old
    priorities table, shows and edits that table, as today's completed-run page
    does: PRIORITIES opens that page as it is, wording included (G50). `TASKS`
    verifies which runs have which.
- **Existing programs and runs:** every program a run already points at becomes
  that run's copy (no existing ids change), and a saved program is cloned from it
  to be the reusable template.
- [P1.1] **Existing data:** rest, tempo, the warmup routine and superset
  grouping stay run-wide, so nothing is moved. The active run's priorities stay
  as they are and become read-only.

### Stepped program planner [P1]

1. **Priorities** — skippable. Muscle groups, each unfoldable to subgroups. Each
   group and subgroup is marked independently: focus, don't care, or left
   normal.
   - If a group and one of its subgroups are marked differently, the subgroup's
     mark applies to that subgroup.
   - A subgroup with no mark of its own takes its group's mark. (Chest marked
     focus covers upper chest unless upper chest is marked otherwise.)
   - The summary is phrased from the group: "chest without upper chest".
2. **Exercises and order** — exercises per workout, their order, superset
   grouping, the warmup routine checklist, and the schedule: schedule type, then
   a weekday per workout (`weekday`) or the sequence order with rest days
   (`sequence`).
3. **Volume** — `stable` or `week-dependent` (chosen at creation, changeable
   here), then plan the sets.
   - `stable`: the sets planned here are the volume for every week, and the
     program saves with them.
   - `week-dependent`: only week 1 is planned here, and the program saves with
     week 1.
   - The only required value is the number of sets per exercise. Rep targets,
     set kinds, rest and tempo are optional.
   - [1.2] REMOVE THIS SET leaves its position empty, and the set count
     stepper's + always adds after the highest position (Adam, 2026-10-22,
     DECISIONS 213 (a)).
   - Entering sets stays quick for the plain case: fill all sets of an exercise
     at once (the set count stepper and ALL), then adjust individual sets.
   - [1.2] A set's number opens the set type picker, a rep target (or ALL) opens
     the rep target picker (5d, PP3, PP3c, PP3d). The old DROPSET / REST-PAUSE /
     MYO-REPS / CLUSTER buttons, + ADD STAGE, the stage's delete icon, the
     separate STAGE REST row and typed rep targets are removed. A staged set
     shows a "DROPSET · 1 DROP" chip that also opens the picker.
   - [1.2] No deload-rules control (16b).

### Priorities migration [P1]

- Existing four levels: top → focus; low → don't care; the two middle levels
  (normal, high) → normal.
- Mapped marks go onto the active run's copy and onto the saved program cloned
  from it. Completed runs' marks stay where they are, as history.
- Run marks are stored only in the new form. Coach keeps reading the old table
  unchanged, so it sees no priorities for runs started after this build —
  accepted (Coach is out of scope and will be rebuilt).

### Weeks and copying [P1, rewritten by 1.2]

- [1.2] **When a week (cycle) gets planned (2):** when it starts, or earlier
  when the user taps PLAN FORWARD on it. Opening it doesn't plan it. Planning
  fills it from its source once; from then on it's its own week.
- [1.2] **How far ahead:** Plan shows every week from week 1 through the
  current week, then the weeks planned ahead and the first unplanned one after
  the current week, with "Not planned yet" and PLAN FORWARD (1b). Planning it
  forward makes the week after it reachable, so weeks can be planned ahead one
  at a time. Nothing beyond the first unplanned week after the current one is
  reachable. (Adam: "you can't go to week 4, but after you click plan forward
  on week 3, you can go to week 4.")
  - **A past week that was never planned** (the answer to DECISIONS 131, G56;
    Adam, 2026-10-15): the week tiles always reach the current week. A past
    week that was never planned shows NOT PLANNED, read-only and empty, with
    no PLAN FORWARD, and nothing is written for it. The current week copies
    from the last planned normal week, as the copy rules already say. REVIEW
    and VOLUME treat the missed week as a week with nothing in it.
- [1.2] **A planned week is never updated by later edits in an earlier week's
  view.** It was copied when it was planned and is changed in its own view.
  CHANGE THE PROGRAM is the exception: it applies to every not-done session.
- [1.2] **What the auto-copy takes (2b):** structure (exercises, order, set
  kinds, stages), volume (set counts) and set types, from the source. A stable
  week also takes the default's rep targets. Weight, reps (week-dependent) and
  RIR are never auto-copied: they come with COPY. Tags and the deload flag are
  never copied.
  - A week-dependent week's copied set has no rep target of its own and does
    **not** fall back to the run copy's (week 1's) target: its reps box is empty
    until COPY or the user fills it. A stable week's reps box shows the
    default's target as the week's own value.
  - Source, `stable`: the run's default (the run copy), always.
  - Source, `week-dependent`: the last planned normal occurrence; the existing
    rules for skipping deload and empty occurrences stay.
    After a CHANGE THE PROGRAM save (DECISIONS 143, Adam 2026-10-15), a copied
    week follows the run copy's current exercise list and order: an exercise
    still in the program brings its sets from the source session, a removed one
    is dropped, an added one arrives with no sets, and a swapped one brings the
    old exercise's sets (How a save lands → Swapped exercise).
  - Week 1 of any run starts from the program.
  - Rest, tempo, the warmup routine and superset grouping are run-wide, so
    there's nothing to copy.
- **Deload sessions are never a copy source.** A week that's partly deload still
  copies its normal sessions; its deload sessions copy from the last normal
  occurrence.
- [1.2] **COPY (2c)** — in the week's header, opens a sheet (board 2):
  - fields: Weight, Reps, RIR (any combination); on a stable week Weight and
    RIR only, since the default owns its rep targets (G53);
  - which of this week's workouts (done ones are locked and can't be picked);
  - "Overwrite what's already there": off fills empty boxes only; on replaces
    typed numbers too;
  - copies from last week's plan, matched the way stable weights were matched:
    exercise, then position, warmups to warmups and working sets to working
    sets. An RIR range copies as a range.
  - It replaces "Copy last week" and copy-week.
- [1.2] **Stable weeks (1b, 1d):** a change made in a stable week's view lasts
  that week only. Once a set in the week differs from the default in set count,
  kind, stages or rep target, its exercise shows "THIS WEEK ONLY" and a "CHANGE
  EVERY WEEK →" link (board 1a). Weight, RIR and cues never count: the default
  holds none. The link opens CHANGE THE PROGRAM unchanged, scrolled to that
  exercise; the week's change isn't carried over by itself.
- [1.2] **Week-dependent weeks (1a):** sets live in the week (count, set type,
  reps, weight, RIR). A change carries forward through the next auto-copy (what
  is copied: above).
- [1.2] **Exercises are added, removed, swapped and reordered only in CHANGE THE
  PROGRAM**; the week view has no exercise-level actions (7b). For a stable run
  that means every week from then on. A one-off exercise change for a single
  session is made during the workout (swap for today, add exercise), and reaches
  the next plan only through REVIEW (13d).
- [1.2] **Done sessions and finished weeks are locked in Plan** and show what was
  planned, never what was done (3). A session that is done shows read-only with
  a "done" state (board 11); a past week reads like board 1c.
- [1.2] **Workouts that share one plan** (one workout on several weekdays): under
  the session's name, Plan says "Shared with Thu — changes apply to both" (with
  the other day or days), so a set edit isn't a surprise. As today (#77), the
  shared plan locks for every day sharing it once one of its sessions is done;
  marking it deload marks every day sharing it (board 10); MOVE THIS SESSION
  moves only that day's session.
- [1.2] **Changes since the source** (P1.1's highlighting, kept): anything in a
  week that differs from its source is highlighted, a box only when it holds a
  value that differs from its source (an empty box is never marked, so a week
  planned forward shows no marks until numbers are typed or copied in;
  DECISIONS 132, Adam 2026-10-15), with the legend "CHANGED SINCE WEEK N"
  (boards 1, 1d, 9), on stable weeks too; "THIS WEEK ONLY" is only the
  per-exercise line (G48).
  - Week-dependent: compared with last week's plan. Stable: set counts, kinds,
    stages and rep targets compared with the default; weight and RIR compared
    with last week's plan. Week 1 is compared with nothing.
  - A stable run's past week and its finished sessions show no marks and no
    legend; week-dependent ones keep theirs (DECISIONS 207 (b), Adam
    2026-10-21: a display choice, built in his review pass after the release
    checklist).
  - Exercises are matched by identity, so a swap shows the old exercise struck
    through above the new one; sets by position. Something removed shows as a
    dim struck-through line in its place. Moved items are highlighted.
  - Cues are never highlighted. Deload sessions show no highlighting ("DELOAD
    SESSION · NO CHANGE MARKS", board 9).
  - These marks are about the plan only. What was done last week shows only in
    REVIEW and VOLUME.
- [P1.1] *Existing data:* "only this week" values already stored are ignored;
  copying uses each week's actual content.
  - Weeks 1.1 changed in the week view (DECISIONS 149, Adam 2026-10-16): as a
    release step, not during the build, one data migration at the release
    (migration 046: DECISIONS 196, Adam 2026-10-20) makes each active
    week-dependent run's program match its last planned week (exercises and
    order), so nothing the user sees changes, with one case accepted
    (DECISIONS 203, Adam 2026-10-20): on a sequence run, a repeated workout
    whose slots were edited differently in 1.1 plans the earlier slot's next
    cycle from the program, which matches the later slot's week; nothing
    stored is lost.
- The number of weeks stays open-ended, as today.

### Review: what went differently last week [1.2] (13)

- Shown only on demand. When last week differed from its plan anywhere, one line
  appears in the week view under COPY / VOLUME / WEEK: "LAST WEEK · N things went
  differently · REVIEW →". It opens one sheet listing every difference, grouped
  by workout (board 4). With nothing left to decide, the line isn't shown. Nothing
  is drawn on the set rows.
- **Number items (13c)**, only where last week had a planned weight or reps:
  - weight differs from the planned weight → item;
  - reps planned as a number, done differently → item;
  - reps planned as a range: inside the range counts as planned; outside → item;
  - reps planned as AMRAP: reps never count; weight still does;
  - a planned set skipped, or left unlogged when the session finished → item
    "Skipped" or "Not logged". A session skipped as a whole gives no items
    (G52).
  - Text: "Lat Pulldown · set 02 — did 57.5 kg × 11 (planned 55 kg × 8–10)". When
    a set has an item, RIR is shown alongside; RIR alone never makes an item
    (13b).
  - USE writes what was done into this week's matching set: the done weight
    and reps, exactly (a range becomes the number done), or, on a set planned
    AMRAP, the done weight only, so this week's set stays AMRAP (DECISIONS 137,
    Adam 2026-10-15). Matching: exercise, then position, warmups to warmups.
- **Structural items (13d)**, for everyone, including people who plan no
  numbers:
  - a set added during a session → "Face Pull · added a set — set 03, 15 kg ×
    18", ADD THIS SET or IGNORE;
  - a drop or stage added, or a set type changed (19) → "You made set 02 a
    dropset", USE or IGNORE;
    - Type changes REVIEW sees (DECISIONS 141, Adam 2026-10-15): a set given a
      stage kind whose drops or stages weren't done, and a dropset with no kind
      switched to Normal, are items too. Both are seen through the session's
      change rows, which also record a type change made on a logged set; USE
      writes the stage count set in the workout.
    - A type change made during a workout (DECISIONS 150, Adam 2026-10-15) is
      listed even when that set was then skipped or never logged, alongside its
      "Skipped" / "Not logged" item, and for everyone, also when the plan gave
      the set no weight or reps.
  - an exercise added or swapped → "Added: Cable fly, 3 sets" / "Swapped Dips →
    Machine Dips". Its action is a CHANGE THE PROGRAM change, so it applies from
    this week forward and says so.
- Every item has IGNORE. A decided item (used or ignored) disappears and doesn't
  come back.
- "Last week" means the week before the one shown, for the same workout; for
  sequence runs, the previous cycle (Defaults, 10). REVIEW appears on the current
  week and on a week planned ahead. While last week isn't finished, its items
  come from its done sessions only. Week 1 has no REVIEW; it never reaches into a
  previous program.
- **Actions** (Defaults, 4). Each writes to the week shown, at once (it isn't a
  CHANGE THE PROGRAM change unless stated). In a stable week a write is a
  this-week change, so it shows "THIS WEEK ONLY" like any other.
  - USE: writes the done weight and reps into this week's matching set, or the
    done weight only on a set planned AMRAP, which stays AMRAP (DECISIONS 137).
    With no matching set (this week has fewer), it becomes ADD THIS SET.
  - ADD THIS SET: appends a set at the end of that exercise's sets, with the done
    weight and reps as its targets and the done set's kind.
  - "You made set 02 a dropset" USE: gives this week's matching set that kind and
    stage count.
  - "Skipped" / "Not logged": REMOVE THIS SET (removes it from this week) or
    IGNORE. A planned set deleted during the session (18b) counts as Skipped.
    Matching uses the planned positions, so a deletion doesn't shift it.
  - "Added: Cable fly, 3 sets": ADD EXERCISE. It is a CHANGE THE PROGRAM change
    from this week on, placed after the exercise it followed, and says so. This
    week gets as many sets as were done, with the done numbers as targets; later
    weeks follow the program's planning type (week-dependent copies them;
    stable adds them to the default).
  - "Swapped Dips → Machine Dips": SWAP FROM WEEK N. A CHANGE THE PROGRAM swap
    from this week on (How a save lands → Swapped exercise).

### Volume per muscle [1.2] (14)

- A VOLUME button in the week's header opens a sheet (board 3): every muscle as
  "last week → this week", changes highlighted, and a note where last week's
  actual differed from its plan ("YOU PLANNED 4 LAST WEEK · DID 10"). Nothing on
  the week itself; the button has no mark.
- Last week's number is what was actually done: done sessions count their done
  sets (added sets in, skipped ones out); sessions not done yet count their plan.
  This week's is its plan.
  - **A workout of last week that was never done** (the answer to DECISIONS
    133; Adam, 2026-10-15): "once the week has ended, a workout that was never
    done counts 0, the same as a skipped one. While the week is still running, a
    not-done workout counts its plan. VOLUME shows what was actually done,
    consistent with 131 (a missed week is empty)." So once last week has ended
    (Plan on the current week), a workout started and never finished counts the
    sets it logged, and its plan still counts in "YOU PLANNED …", so the note
    shows what was missed; while it is still running (Plan on a week planned
    ahead), "not done yet" counts the plan.
- Rows are muscle groups (each exercise has one). Exercises with no muscle group
  count in the existing "Other" group. Board 3's subgroup rows are sample data.
- Warmups don't count. Drops and stages count per the Settings rule (14b),
  default ½ per drop, the same rule for dropsets, rest-pause, myo and cluster.
  The rule applies to this sheet only; History, Progress and the finish screen
  count as they do today (G51).

### Targets [P1]

- **Weight targets:** per set, in the week plan only. Never in the program.
- **Rep targets:** per set, in the program. A number, a range, or AMRAP.
  Optional. The week plan can override a set's rep target for that week.
  [1.2] Entered through the rep target picker everywhere (6): NONE / NUMBER /
  RANGE / AMRAP, then the numbers; "Use for all N sets of [exercise]" applies it
  to every set of that exercise (board 6).
- **RIR targets:** per set, in the week plan only. Optional. Stored as one value
  [1.2: or a range]; shown as RPE when the RPE setting is on [P2] (RPE ≈ 10 −
  RIR, half-points allowed).
  - [1.2] **RIR range (17):** entered through the RIR target picker (board 7):
    NONE (clears it), NUMBER or RANGE, then the numbers, and "Use for all N sets
    of [exercise]", as in the rep target picker. "Use for all" starts ticked in
    both pickers. No tap-a-value shortcut; values go well beyond 5. During the workout RIR is still logged as one number, and a range
    shows as the dim placeholder "1–2". The deload RIR rule shifts both ends,
    with a floor of 0; a range whose ends meet becomes a number.
- **AMRAP:** counts as a normal working set everywhere. Its RIR defaults to 0
  (RPE 10), editable.
- A set without a target shows no target.

### Tags [P1] — called **cues** in the UI [1.2]

- Per set, several allowed, in the week plan. Preset list ("push here", "maintain
  strength", "focus on execution", "push back") plus custom text.
- "Apply to all sets" fills one cue across an exercise's sets.
- Shown on the set's row during the workout. Never tracked. Never copied.
- [1.2] Reached from the set type picker's Cues row in Plan (board 5 → 8), and
  from the set's ⋯ during a workout (W7). A cue edited during a workout changes
  that set in this week's plan; a workout on days that share one plan shows it
  on both.
  - A set with no planned set (DECISIONS 165, Adam 2026-10-16): no CUES row in
    its ⋯.

### Tempo [P1]

- Per exercise, in the program. Shown next to the exercise during the workout.
  Not tracked.
- In a run, tempo is run-wide. [1.2] Edited in CHANGE THE PROGRAM (exercise ⋯,
  PL2). Per-week tempo is a later revision.

### Rest [P1]

- Timer value, most specific first:
  1. the set's own rest override
  2. on an exercise's last set: the exercise's "rest after"
  3. the exercise's rest
  4. the global rest setting
- Supersets: no timer between exercises within a round by default; the block's
  rest after each round. Both overridable per superset.
  - With no superset override, the rest after a round is the normal chain of
    the exercise that ends the round.
  - An exercise's "rest after" never fires inside a round; it applies only
    after the block's final round.
  - A set's own explicit rest override wins over "no timer within a round".
- Staged sets: the staged set's own rest between stages (dropset: no timer;
  rest-pause, myo-reps, cluster: 15 s by default).
- Warmup sets follow the same chain.
- In a run, rest is run-wide. [1.2] Where each one is edited:
  - exercise rest and rest after: the exercise's ⋯ in CHANGE THE PROGRAM (PL2);
  - superset rests (within a round, after a round): any member's ⋯ (PL3), which
    says they change the whole superset; a member's own rest and rest after stay
    in its ⋯ as today;
  - a set's own rest: week-dependent, the "Rest after this set" row in Plan's set
    type picker (board 5, "Every week from now on"); stable, the REST AFTER
    column in CHANGE THE PROGRAM's set rows (PL1b). Both write the same
    run-wide value on the run copy's matching set, so it applies to every
    not-done session. A week set matches its run-copy set by position within
    its exercise, warmups and working sets counted separately (G45's existing
    matching). A stable week's set type picker has no rest row.
  - rest between stages: the set type picker's REST BETWEEN, under the stage
    count, in Plan for week-dependent programs, in the stepped program planner
    and in CHANGE THE PROGRAM. A stable week's picker shows the stage count
    but no REST BETWEEN; a staged set made for one stable week only uses its
    kind's default stage rest. Never during a workout.
  - [P1.1] A set with no program set of its own exercise (a set added in a
    week; the sets of an exercise added or swapped in during a week) has no own
    rest: it uses its exercise's rest, then the global rest, as today (G45). Its
    set type picker shows no rest row and no REST BETWEEN; if it's staged, it
    uses its kind's default stage rest.

### Supersets [P1]

- Any number of exercises.
- Shown as a block of rounds: round 1 = A1, B1, C1; round 2 = A2, B2, C2; …
- Unequal set counts are allowed. A round can have an empty slot; leftover sets
  stay inside the block (4 sets of A, 3 of B → 4 rounds, round 4 has only A).
- The current set zigzags through rounds: A1 → B1 → A2 → B2 …
- Every reorder (program, CHANGE THE PROGRAM, [P2] session) moves a superset as
  one block.
- Superset grouping is run-wide. [1.2] In a running program it's changed in
  CHANGE THE PROGRAM, applying to not-done sessions. Today's abilities all stay
  (Defaults, 5):
  - SUPERSET on an exercise's card links it with the exercise below; below a
    superset, it joins that superset;
  - inside a superset card, a link toggle between two members splits the
    superset there or joins it again (not drawn on PL1; it sits between the
    members, as today's per-gap toggle does);
  - UNLINK on the header splits the whole superset into single exercises.
- [1.2] **Looks the same in CHANGE THE PROGRAM as in the workout (12):** one card
  for the superset, a header with its round rest and UNLINK, each member with its
  letter (A, B, …), its own ⋯, SWAP and REMOVE; stable set rows are labelled A1,
  A2, B1 …
- [1.2] During a workout, "+ ADD ROUND" adds a set to every member (Defaults, 9); a member's ⋯
  has "Add a set" for that member only (W10).
- "Last time" stays per exercise.

### Warmup sets [P1]

- A set kind. [1.2] Made with the set type picker (Warmup); there's no separate
  "add warmup sets" action (5a).
- Never counted in volume, set counts, or "last time" matching.
- Logged values: weight and reps, both optional; plus a rest timer. Nothing else.
- [1.2] A warmup row in Plan has no RIR target (G49).
- Display setting: `rows` (default; numbers optional) or `tick` (tick-off only).
- [P2] Mandatory fields never apply to warmup sets.
- Coach stays untouched, so its own summaries will count logged warmups as
  working sets — accepted.

### Warmup routine [P1]

- Per workout, in the program: a checklist shown at the top of the session.
- Items are ticked off; nothing else is logged.
- In a run, the routine is run-wide. [1.2] Edited in CHANGE THE PROGRAM.

### Set types and staged sets [P1, 1.2]

- The dropset machinery generalised. Stage kinds: dropset, rest-pause, myo-reps,
  cluster.
- Dropset: as today. Other kinds: each stage's weight carries over from the
  previous stage by default instead of being dropped.
- Stages are never counted as separate sets, except in volume (14b).
- Deleting a staged set's head deletes its stages (existing rule).
- [1.2] **One set type picker (5)** for every kind of set: Normal, Warmup,
  Dropset, Rest-pause, Myo-reps, Cluster, each with a one-line description
  (board 5). Picking a staged kind adds its first stage; a stepper (DROPS /
  PAUSES / MINI-SETS / CLUSTERS) sets how many. Switching back to Normal or
  Warmup removes the stages. A warmup can never be staged.
  - It's the same component in Plan (the set's ⋯: type, rest after this set,
    Cues, REMOVE THIS SET), in the stepped program planner and CHANGE THE
    PROGRAM (type, REMOVE THIS SET), and in the workout (type only; W7a).
  - It is built once and reused; so are the rep target and RIR target pickers.
    Screens never re-implement them.

### Planned staged sets render (fix) [P1]

- A staged set planned in the week plan or program shows every stage on the
  workout screen from the start, each as a row with weight and reps, each locked
  until the stage before it is logged.
- Verification must load a planned dropset into a real session and confirm the
  stage rows render. Checking stored data alone doesn't catch this regression.

### Deload [P1]

- A deload is a property of a session. "Mark this week as deload" marks every
  session in that week; a 3-day deload is three sessions marked individually.
- With no rules switched on, marking only changes how the session is treated
  (skipped as a copy source and as "last time"). Its contents are planned by
  hand.
- With rules on, a deload session is pre-calculated from the **last normal week**:
  its planned sets, and the weights actually logged in it (planned weight where
  nothing was logged).
- Rules are independent and each optional. Global default when rules are turned
  on: sets −50%, everything else unchanged. [1.2] Settings only; programs have
  no override (16b).
- A run uses the Settings rules as they are at the time. Plan shows them,
  read-only, in WEEK ⋯ ("Deload rules (from Settings)", board 1e).
- Rounding is part of the rules: sets round down or up, never below 1; weight
  rounds down or up to a chosen precision step. Defaults: sets round down;
  weight rounds down to 2.5 kg.
- Deloads are marked manually only. Scheduled deloads are `later`.
- Unmarking a session whose sets the rules calculated restores what was planned
  before it was marked.
- [1.2] Marking a session that already holds a saved copy of its plan
  (DECISIONS 188 (a), Adam 2026-10-20): leaves it as it is, with nothing
  recalculated or saved again, so marking a half-marked week again only
  finishes the mark and unmarking still restores the plan.
- Reps rule: on a range it shifts both ends; on AMRAP it does nothing. [1.2] RIR
  rule: a range shifts both ends, floor 0.
- Sets rule: removes the last working sets. A staged set counts as one set.
  Warmup sets are never touched.
- If the workout didn't happen in the last normal week (moved away, skipped),
  the base is its last normal occurrence.
- Any deload session can still be edited by hand afterwards.
- [1.2] Where: session deload in the session's ⋯, week deload in WEEK ⋯ (C2).

### Scheduling [P1]

**Weekday**
- Workouts are tied to days of the week (as today). [1.2] Changed during a run
  only in CHANGE THE PROGRAM, from next week (1e).
- **Move this session to another day, this week only.** A missed workout done at
  the end of the week = one move; swapping two days = two moves. [1.2] In Plan
  it's in the session's ⋯ (C2), for any session of the current week.
- Moving a session onto a day that already has one leaves both on that day,
  shown as a list. Sessions per day are therefore not limited to one.
- Planning two workouts on the same weekday in the program is `later`.
- **Missed-session prompt:** stays, but only for missed days of the current
  week. Its "Do it now" becomes a move to today (History shows the day it was
  actually done). "Mark skipped" stays.

**Sequence**
- An ordered list of workouts and rest days, not tied to dates.
- The cycle replaces the week everywhere the week is used (week plan, copying,
  week-dependent volume, deload shortcut, labels, [1.2] PLAN FORWARD, COPY,
  REVIEW, VOLUME).
- Rest days count from the last workout done. Do A Monday with two rests planned
  → B is due Thursday.
- The sequence only moves forward when a workout is done. Not training on a due
  day misses nothing; that workout stays next and everything after it shifts.
- On a rest day, **"Train anyway"** starts the next workout; the remaining rest
  days before it disappear.
- **Skip** drops a workout entirely; the sequence moves to the next one, which
  is due the same day.
- A workout may appear more than once in a sequence (e.g. A, B, A, rest).
- The current cycle is the one containing the next due workout. Cycles before
  it are past.

### "Last time" reference [P1]

- Deload sessions never count.
- Crosses run boundaries.
- **Weekday:** LAST WEEK only when the match is from the immediately preceding,
  non-deload week. Otherwise LAST TIME + elapsed time. FIRST TIME only when the
  exercise has truly never been done.
- **Sequence:** always LAST TIME + elapsed time. EARLIER THIS WEEK is hidden.
- Matches by exercise; reordering never affects it.
- If last week's match was a deload session, the reference is LAST TIME from
  the last normal occurrence.
- The reach-back (shown when the matched session's sets were all skipped)
  crosses run boundaries too.

### Volume [P1/P2]

- Warmup sets: never counted.
- Staged-set stages: count in volume only, [1.2] per the Settings rule (14b) in
  the VOLUME sheet; everywhere else as today (G51).
- [P2] Unilateral: weight × the sum of both sides' reps; still one set.
- [P2] Bodyweight: added load only (pure bodyweight contributes 0).

### Tracked fields [P2]

- Weight and reps are the set itself; always tracked.
- RIR/RPE, form rating, set time, energy/pump: each `off` / `optional` /
  `mandatory`, in settings, applying to every exercise.
- Form is off by default for new users.
- Mandatory set field: Log is disabled until it's filled. Never applies to
  warmup sets.
- Mandatory session field (energy/pump) missing at finish: the finished session
  shows a "fill in" marker that leads to the finished-session edit.
- Any field switched on appears on the current row itself — never under "more".
  "More" keeps only rare actions (split sides).
- RIR vs RPE is a display setting over one stored value; switching converts the
  whole history's display. [1.2] A RIR range converts both ends (RIR 1–2 → RPE
  8–9).

### Logging mechanics [P2; parts pulled into 1.2]

- [1.2] **Row states:** logged → compact read-only line with a tick and a pen;
  current → every field, plus LOG, in the accent frame; upcoming → the same
  fields and LOG, which can be typed into (Log lock (18a): "every row can be
  typed into"), with no frame and an outlined LOG (W1, W2). Pulled from [P2].
  (Wording fixed 2026-10-26, chunk 60's review: "upcoming → targets only" was
  stale against the Log lock rule and board W1.)
- [1.2] **What a row shows (C3, C4):** the reps box shows the plan's rep target
  (number, range or AMRAP); the weight box is empty when the plan has none;
  planned RIR is a dim placeholder (a range shows as "1–2"); RIR is on every
  working row. Each exercise shows last week's numbers and, when the exercise
  was already done earlier this week, those too (W16, W17).
  - What LOG takes untouched (DECISIONS 162, Adam 2026-10-16): an untouched row's
    values are the plan's targets; a range or AMRAP is a placeholder, so LOG needs
    reps typed; with no planned weight the weight box is empty and LOG needs it.
    Last time's numbers show only on the row's LAST line. (Pre-fill from last
    time stays phase 2.)
- [1.2] **Rest timer (C5):** no inline rest under the last logged set; the rest
  timer is the pinned bar (W1, W4). Today's inline timer goes.
- [1.2] **Current set** = the first unlogged working set or stage in the
  session's order. Warmup sets never take part in the current set or the lock;
  a warmup's LOG never asks (G54).
- [1.2] **Log lock (18a):** every row can be typed into. With the lock on, only
  the current set's LOG logs straight away; LOG on any other row asks first:
  "Log A2 before set 03?" with LOG A2 / CANCEL, and a line saying the lock can
  be turned off in Settings ("Log sets in order", W7b). With the lock off,
  every LOG logs. On by default.
- [1.2] **A logged row shows a pen next to its tick (18d).** Tapping the row
  opens its edit panel: the numbers, a SET TYPE row, then UNLOG / DELETE and
  CANCEL / SAVE (W2, W2b).
- [1.2] **Unlog (18c):** the set goes back to unlogged with its numbers kept. No
  confirm; logging again undoes it. A set with logged drops or stages after it
  can't be unlogged until they are (UNLOG is disabled and says so). Unlogging
  never restarts the rest timer and never changes the session's status; in a
  reopened session it works the same (Defaults, 6). Unlog deletes the set's log
  (its stages' logs first); its numbers stay in the row as a draft on that
  phone until it is logged again (a new log) or the session ends (G46).
  - Set numbers on unlog (DECISIONS 151, Adam 2026-10-16): an unlogged set
    keeps its number and its place. Logging it again stores it with that same
    number, so unlog then log is an exact undo. No other set's number changes
    on unlog. The open row shows its own number (a planned set's position; an
    added set's number from its draft), never "the next after the logged ones".
  - [1.2] A set added before 1.2 (DECISIONS 184 (b), Adam 2026-10-20): its
    unlog moves nothing (the draft keeps the log's time and is drawn in its
    place); logging it again writes the time it happens, so it moves to after
    the other sets added before 1.2 then. Not an exact undo, for these sets
    only.
  - An added set's type on unlog (DECISIONS 161, Adam 2026-10-16): an added
    set's draft also keeps its type, so an unlog is undone exactly and nothing
    moves; the workout rules see every added set's type.
- [1.2] **Delete set (18b):** with a confirmation (W9). An unlogged set's DELETE
  is in its ⋯ (W7); a logged set's is in its edit panel. Logged and unlogged
  sets, this session only, never touches the plan. Deleting a staged set's head
  deletes its stages, and the confirm says so. The remaining sets renumber.
  - Set numbers (DECISIONS 170, Adam 2026-10-18): set numbers are never
    claimed or stored per rule. Each set has a fixed place in the session
    order: planned sets by planned position, added sets by when they were
    added. A set's displayed number is its rank among the non-deleted,
    non-warmup working sets in that order (warmups numbered apart). LOG stores
    the number the row shows; a delete or a switch to or from Warmup (146)
    that changes logged sets' numbers patches them, as 146 (a) writes.
  - [1.2] A stored number that differs from its row's (DECISIONS 178, Adam
    2026-10-19): when the workout screen draws a session's rows, it writes the
    shown number over a logged set's stored one, only where they differ, so
    drawing the same session again writes nothing. It does this only from the
    workout screen for an in-progress or reopened session, never from History,
    Plan or any read-only view; offline the writes queue like a delete's.
  - [1.2] Two phones on one session (DECISIONS 185 (c), Adam 2026-10-20): a
    phone never corrects a stored number after a set only it holds. It never
    corrects a log that comes after an open added set on its card; every
    other correction is as 178 says.
  - A drop on its own (DECISIONS 147, Adam 2026-10-15): deleting a set's last
    drop makes it a normal set. A logged drop can be unlogged under the same
    rule as any set: not while a later drop or stage of that set is logged. Its
    draft is keyed by its set's key plus its drop number.
- [1.2] **Offline (G47):** logging, delete set and unlog work offline and sync
  later through the sync queue. A set type change on a logged set and the edit
  panel's SAVE need a connection, as editing a logged set does today; offline
  they say so (W6, Errors).
  - A set not logged yet switched to or from Warmup (DECISIONS 168, Adam
    2026-10-16): the switch and the renumbering of later logged sets queue
    offline, like a delete.
- [1.2] **Set type during a workout (19):** through the set's ⋯ for upcoming and
  current sets, through the edit panel for a logged set (W7a). Session-only;
  next week sees it only through REVIEW (13d). Making a logged set a dropset adds
  its first drop under it; that drop is the current set unless an earlier set
  is still unlogged, in which case logging it follows the lock. Switching a set
  back to Normal when some of its drops are already logged asks before deleting
  them (19c). ADD STAGE, "Mark as dropset" and "+ DROP OR STAGE" are removed.
  - A set switched to or from Warmup (DECISIONS 146, Adam 2026-10-15)
    renumbers the sets as a delete does: the sets after it close the gap or
    move up one.
  - A numberless logged warmup (DECISIONS 152, Adam 2026-10-16): making it a
    working set asks for weight and reps in the panel first; type and numbers
    are saved in one write.
  - The DROPS stepper on a logged set (DECISIONS 167, Adam 2026-10-16) can go
    below the drops already logged; deleting a logged drop asks first (19c).
- [1.2] **Stage rows** open by themselves once the row before them is logged
  (C8).
- [1.2] **The set's ⋯ during a workout (C9):** SET TYPE, CUES, FORM, a per-set
  unit override, SKIP THIS SET and DELETE (W7). FORM and SKIP THIS SET are
  today's, unchanged.
  - Skip the rest of this exercise (DECISIONS 163, Adam 2026-10-16) also skips
    its open added sets and its unlogged warmups.
- [1.2] **Swap during a workout (C7):** moves only the remaining sets; next
  week's plan stays the same (W10, W11).
  - What a swap for today moves (DECISIONS 164, Adam 2026-10-16): the
    original's open sets move to the new exercise with their numbers, type,
    drops and targets, as W5 draws.
  - [1.2] The moved sets are added sets (DECISIONS 179, Adam 2026-10-19): they
    count as added sets of the new exercise. Each gets its place at the swap,
    in the order they stood, after any sets already added to that exercise.
  - [1.2] The numbers of the moved sets (DECISIONS 183 (a), Adam 2026-10-20):
    one numbering for the exercise's place in the session, covering moved and
    added sets: the original card's sets that didn't move, then the moved sets
    in the order they stood, then any set added to the new card, each
    numbered by its rank in that list. W5: Lat Pulldown 01, 02; Machine
    Pulldown 03; + ADD SET there, 04. The original card draws no row for a
    set that moved.
  - [1.2] (DECISIONS 183, Adam 2026-10-20) A swap into an exercise that
    already has added sets: the moved sets come after them. A swap never
    renumbers sets that are already logged. The same exercise on two cards in
    one session: each card is numbered on its own, as today's display does.
  - [1.2] (46r's Q1, Adam 2026-10-20) A swap never changes the number of a set
    that's already logged, on either card. If moving open sets leaves a gap on
    the original card, the gap shows; that's accepted (rare, and no stored data
    is wrong).
  - [1.2] Where a swap is offered (DECISIONS 199, Adam 2026-10-20): only where
    today's app offers it, on a planned exercise that no swap has touched;
    never on the card a swap made or on an exercise added today.
  - [1.2] The swap row is saved before any set is skipped (DECISIONS 200, Adam
    2026-10-20): a swap that can't be saved skips nothing.
- [1.2] **Finishing (11, C6):** the finish screen (W18) shows the session's
  tiles, energy, pump and note, and COMPLETE. When planned sets aren't logged it
  says which ("2 planned sets aren't logged yet: EZ Bar Curl 01 and 02.") with
  GO BACK, which closes the finish screen and scrolls to the first of them.
  BACK TO SESSION closes it where it was. A reopened session finishes through
  W19.
  - Auto-finish (DECISIONS 166, Adam 2026-10-16) waits for what the workout's
    rows say is left (the same view as the finish warning).
- [P2] **"Set added · Undo"** after adding a set.
- [P2] **Pre-fill:** values shown as grey suggestions, visibly different from
  typed values. Log accepts them as they are. Source: planned, otherwise last
  time. Setting: empty / planned / planned, else last time (default).
- [P2] **Reorder this session:** move exercises up or down; supersets move as one
  block; partly-done exercises can move. Session only. Current set and "scroll
  to current" follow the new order. History shows the order as performed. Once
  it exists, decide whether a reordered session produces a REVIEW item.
- [P2] **Unilateral split:** a set is one row by default; "split sides" turns
  every tracked field on that set into L and R values. Mandatory applies to both
  sides.
- [P2] **Bodyweight:** weight entered as signed added load; shown as "BW", "BW
  +10", "BW −20". "Last time" compares added load.

### Finished session [P2]

- Edit button for energy, pump and notes that does not reopen the session;
  workout time stays intact.
- Shows clock times (e.g. 19:00–21:32). Session history shows them too.

### Exercise notes [P2]

- Per exercise, per user, persistent across programs: machine setup and standing
  cues.
- Editable from the workout screen and the exercise's library page. The program
  planner shows them read-only.

### Login [P2]

- New accounts: Google sign-in only. Email signup removed.
- Existing email accounts: email + password sign-in stays.
- Signing in with Google on the same address as an existing account links them
  automatically (existing accounts were all verified).
- Password reset works end to end (fix, with the confirmation-page error).
- Repo fact for `CONTEXT.md`: new test accounts are created in the Supabase
  dashboard, since email signup no longer exists.

### Library [P2]

- One shared catalog. A user's library = catalog exercises they've ticked + their
  custom ones.
- Users can edit catalog exercises for themselves (name, muscle tags, flags).
  Edited fields stay as edited; unedited fields update when the catalog improves.
- **Picker** (program planner, mid-workout add and swap): searches the user's
  library first, then the catalog. Adding a catalog exercise ticks it into the
  library automatically. Not found → "Create '…'" as a custom exercise on the
  spot.
- **Remove from library:** hides it from pickers and the library list; history
  stays; can be added back. Unticking a catalog exercise is this action; today's
  archive becomes this action.
- **Delete:** only for exercises with no logged data.
- **Merge into another exercise:** moves all history onto the target; the merged
  exercise disappears. Replaces "lost exercises".
- The downloadable-libraries feature is retired.
- Migration: each user's seeded copies are connected to their catalog entries;
  any existing user edits carry over as personal edits. Changes stored data →
  blocking decision at build time.

### Language [P2; 1.2 wording]

- [P2] Polish and English UI, every screen except Coach. Follows the device;
  override in settings. Polish date formats.
- [P2] Translated: UI text, muscle groups, preset tags, set-kind names. Never
  translated: anything a user typed.
- [P2] Exercise names: every catalog exercise has both names. Exercise-name
  language is its own setting (defaults to the app language). Search always
  matches both. Custom exercises: one name, optional second.
- [P2] The Polish exercise-name list is a deliverable Adam reviews before it's
  loaded.
- [P2] Build order: the translation setup comes first in phase 2, so every new
  string in phase 2 is translatable from day one. The full translation pass comes
  last.
- [1.2] **"Program" everywhere (C12).** The UI never says "meso", "mesocycle" or
  "run". The running copy is the "current program"; finished ones are
  "finished programs", listed as "[name] · [dates] · [N] weeks". "Cycle" stays
  only for sequence programs. Internal names (tables, code, routes) don't
  change. This is a text change on every screen, including the ones whose look
  1.2 doesn't touch (Today, History, Progress, Settings): "NO MESO", "ALL
  MESOS", "DELETE MESO", "MESO OVERVIEW", "Search sessions or mesos…", and the
  like. The one exception is a pre-1.1 finished program's priorities page, which
  opens as it is (G50).
- [1.2] **Tags are "cues"** in the UI.
- [1.2] The planner screen and its button say "change the program", never
  "change the plan".
- [1.2] **Screens explain themselves:** each rule a person meets is stated in
  place, in one short line (the CHANGE THE PROGRAM rule box, "THIS WEEK ONLY",
  the dimmed PLAN tab, "Changes this workout only", the lock line). A first-run
  tutorial is `later`.

### Navigation and settings

- [1.2] **PLAN | PROGRAMS (8).** The Plan tab has two tabs at the top. Tapping
  Plan in the nav opens straight into the week. With no program running it opens
  on PROGRAMS; PLAN shows a lock, and tapping it shows "Start a program to plan
  your weeks." (PR2). The Plan header's calendar icon is removed.
- [P2] Bottom bar: Today, Plan, History, Library, Settings. Progress and Coach
  become tabs inside History; Coach is otherwise untouched. [1.2] Until then the
  nav shows 6 tabs, plus COACH as a 7th for Adam's account only, as today
  (Nav.tsx, `isCoachUser`) (C11). The workout screen's COACH button and its
  NOTES / ASK sheet stay exactly as today, for Adam's account only.
- [P2] Settings grouped: Workout (logging and tracking), Planning (deload
  rules, how drops count in volume), Language, Appearance.

### Removals [P1, 1.2]

- The note section shown when editing a logged set is removed.
- Suggested reps per program exercise are replaced by per-set rep targets.
  Removing the old field changes stored data → blocking decision at build time.
- [1.2] Removed from the UI: Plan's Sets / Structure views and their
  highlighting; MAKE THIS WEEK THE NEW DEFAULT; the "apply this change to planned
  weeks ahead" banner; Copy last week and copy-week as their own actions; the
  per-program deload-rules control; the "new week starts" setting; ADD STAGE,
  "Mark as dropset" and "+ DROP OR STAGE" in the workout; ADD WARMUP SETS; the
  Plan header's Programs icon; END RUN; the "applies from" week picker.
  Nothing stored is dropped: the deload override column stays unread.

---

## Screens

Boards are named by ID (Design boards). What follows is behaviour and states;
layout and wording come from the boards.

### Plan screen [P1, rebuilt by 1.2]

- **Header (1, 8a):** PLAN | PROGRAMS tabs, then "[PROGRAM] · CURRENT PROGRAM".
- **Week row:** a tile per week (cycle) from week 1 through the current week,
  then the weeks planned ahead and the first unplanned one after the current
  week, scrolling sideways; it opens on the current week. Past weeks say DONE,
  or NOT PLANNED for a week nobody planned (131); the current week THIS WEEK; a
  week planned ahead PLANNED; the first unplanned week after the current one
  NOT PLANNED (lock). Tapping that tile opens it with PLAN FORWARD (1b): "Takes
  week 2's sets and set types. Numbers come with COPY." (stable: "the default's
  sets, set types and rep targets").
- **Under the header:** COPY (2c, board 2), VOLUME (14, board 3), WEEK ⋯ (week
  deload, the deload-rules line; board 1e). Then the REVIEW line when there is
  one (13, board 4).
- **Each session:** its name, day and states (board 10): done (read-only, board
  11), deload, moved, shared ("Shared with Thu — changes apply to both"). Its ⋯
  holds session deload and MOVE THIS SESSION (C2).
- **Each exercise:** name and muscle, no ⋯ (7b). Each set: number, weight, reps,
  RIR, its type tag and cues. Weight is typed; reps open the rep target picker
  (6); RIR opens the RIR target picker (17); the set's ⋯ opens the set type
  picker (5) with rest after this set (week-dependent), Cues and REMOVE THIS SET.
  A warmup row's ⋯ offers Normal and Warmup only; stage rows have no ⋯, the
  head's stepper changes how many (G55).
  "+ ADD SET" adds a Normal set with the previous set's rep target and no weight
  or RIR (Defaults, 8). Cell and row states, including the "changed since"
  marks: board 9.
- **Stable weeks:** board 1a — "THIS WEEK ONLY" and "CHANGE EVERY WEEK →" once a
  set differs from the default.
- **Sequence runs:** board 1d — cycles and slots instead of weeks and days.
- **Bottom:** "CHANGE THE PROGRAM FROM WEEK N" (or CYCLE N).
- **Locked:** past weeks (board 1c) and done sessions (board 11) are read-only
  and show the plan. A past week has no COPY / VOLUME / WEEK row and no CHANGE
  THE PROGRAM button; its sessions show DONE or SKIPPED.
- **Loading and errors:** board 12, with the Errors rule.
- **Empty states:** no program running → Plan opens on PROGRAMS (PR2). A week
  ahead not planned → NOT PLANNED with PLAN FORWARD. A program with no schedule
  (started before Start needed one) → a line linking to PROGRAMS.

### PROGRAMS [P1, rebuilt by 1.2]

- **PR1:** CURRENT PROGRAM card (name, week, start date, types, FOCUS / DON'T
  CARE → PR5, EDIT PROGRAM → CHANGE THE PROGRAM, FINISH → PR6/PR7), then YOUR
  PROGRAMS (each: types, OPEN → the stepped program planner, START → PR8/PR9;
  the running one has a RUNNING tag; "+ NEW PROGRAM" → PR13), then FINISHED (→
  PR14).
- **No program running:** PR2 (the PLAN tab's lock line). **No programs at
  all:** PR3, which says in one line what a program is. **Loading:** PR4.
- **Start:** PR8 (sheet), PR9 (one is running), PR10 (failed, real reason),
  PR11 (no schedule), PR12 (no programs). After starting: Plan, week 1.
- **New program:** PR13 (nothing chosen, CREATE disabled), PR13b (both chosen).
  Creating opens the stepped program planner.
- **Finished program:** PR14 — dates, weeks, deloads, a PRIORITIES row (editable;
  Programs and runs → Priorities), the week-by-week structure history with
  changes highlighted (C1): exercises, their order, set counts and set kinds,
  each week against the week before (Defaults, 11). A week marked with a dot
  changed; tapping a week shows what changed and its structure,
  and DELETE THIS FINISHED PROGRAM → PR15 ("Its weekly plan is deleted. Its
  sessions stay in History, and the saved program isn't touched.").

### CHANGE THE PROGRAM [1.2]

- PL1 (week-dependent), PL1b (stable). Rules: Programs and runs.
- Exercise ⋯: PL2 (rest, rest after, tempo, unit); superset member ⋯: PL3.
- Swap and add: PL4, PL5, PL6. Remove: PL7 (exercise), PL8 (warmup item).
  Warmup routine and rest field states: PL9.

### Stepped program planner [P1]

- Three steps as in Rules (PP1, PP2, PP3). Back and forward between steps;
  priorities skippable. PP1b (one workout on several weekdays), PP2b (sequence),
  PP2c (add workout, slots), PP2d/PP2d2 (add exercise, empty), PP2e/PP2f (editing in place),
  PP3b (stable volume), PP3c/PP3d (pickers), PP4/PP4b (confirms), PP5/PP5b
  (states), PP6 (empty states).
- Saving stores the program as it is; activating creates a run. Activating needs
  a schedule.

### Workout screen [P1 rendering; 1.2 logging; P2 the rest]

- [P1] Warmup routine checklist at the top. Supersets as blocks of rounds. Warmup
  sets per the display setting. Staged sets with locked stage rows. Cues on set
  rows. Tempo next to the exercise. Rest timer per the rest chain. "Last time"
  per the rules.
- [1.2] Boards: W1 (in progress), W2/W2b (row states, editing a logged set), W3/W3b
  (stage rows, added and skipped sets), W4 (header, rest, jump), W5 (swapped and
  added exercises), W6 (offline, sync failed), W7/W7a/W7b (set ⋯, set type, log
  out of order), W8 (sheet states), W9 (delete set), W10 (exercise ⋯: swap for
  today, skip the rest, add a set, history), W11, W13–W15 (swap, add, confirm,
  picker states), W16/W17 ("last time"), W18/W19 (finish, reopened).
- [1.2] Logging mechanics as in Rules: lock, pen and edit panel, unlog, delete
  set, set type, unlogged warning.
- [1.2] Swap and add exercise errors show the real reason (Errors).
- [1.2] COACH button: as today, Adam only.
- [P1] Weekday run: "Move this session" action. Sequence rest day: the next
  workout and "Train anyway". Several sessions on one day are listed; each opens
  on its own.
- [P2] pre-fill, tracked fields on the row, undo, reorder this session, split
  sides, bodyweight entry, exercise notes.

### Today [P1]

- Its look is unchanged by 1.2 apart from wording (Language). Its data path
  changes: it no longer plans weeks on open (Weeks and copying), and it finds
  sessions by the weekdays in force that week (CHANGE THE PROGRAM → Weekdays
  storage). **Empty state:** no session
  today → the next scheduled session and when it's due; on a sequence rest day,
  "Train anyway".

### Finished session [P2]

- Summary, clock times, edit for energy/pump/notes, "fill in" marker when a
  mandatory rating is missing.

### History [P2 for the tab change]

- Gains Progress and Coach as tabs. Session list shows clock times. [1.2] Wording
  only.

### Library [P2]

- The user's library (ticked + custom), searchable in both languages; catalog
  browsing with tick/untick. Exercise page: names, muscle tags, flags (editable
  as personal edits), notes, remove/delete/merge.
- **Empty states:** new user with nothing ticked → "Browse the catalog". Library
  or picker search with no match → "Create '…'".

### Sign-in [P2]

- "Continue with Google"; "Sign in with email" for existing accounts; password
  reset. No signup form.

### Settings [P1 additions; 1.2 rows; P2 regroup]

- [P1] Warmup display; default deload rules.
- [1.2] Keeps its current look. Adds two rows: "Drops and stages count as" (whole
  set = 1 / each drop = 1 / each drop = ½, default ½; the VOLUME sheet only,
  G51) and "Log sets in order"
  (on by default; off means LOG never asks). Removes "New week starts"; users
  who had it on "empty" get auto-copy, with no message.
- [P2] Grouped as above, with tracked-field switches, effort scale, pre-fill,
  both language settings.

---

## Later (next-version notes)

- Anything coach- or trainer-related; sharing a plan (first thing the trainer
  version builds on)
- Plan templates, workout templates, skeleton templates
- Cardio sessions and timed holds
- Weight targets as a percentage of 1RM/e1RM
- Which gym a session was in
- Pain/discomfort flags
- Partials, negatives, forced reps
- Form rating improvement — form = bar path + depth + tempo
- Weight log for all users
- Progress screen rebuild
- Double progression: applies to rep ranges; trigger options (all sets / first
  set / N sets at the top of the range); whether RIR must match; weight step per
  exercise with a global default; suggest, don't write; optional reverse when
  missing the bottom of the range. Covers "you hit the top of the rep range".
- Open-ended sets: total-reps target (a coached lifter had 40 total reps, 2 min
  rest between sets) and sets until a set falls short (Adam's own plan) — one
  structure with two stop conditions
- Calendar view and plan history (planned side of past runs)
- Run length (fixed-length runs) and scheduled deloads ("every Nth week")
- Planning two or more workouts on the same weekday
- Custom home screen (reminders, e.g. to plan next week)
- New-user guide; [1.2] a short, skippable first-run tutorial (Plan vs Programs
  and the rest), once there are real outside users
- Per-week rest, tempo, warmup routine and superset grouping (SPEC change 1.1's
  rule 7, deferred on 2026-10-10; TASKS-1.1.md's appendix keeps its plan)
- [1.2] History highlights what was done differently from the plan (History /
  Progress rebuild)
- [1.2] Further CHANGE THE PROGRAM improvements, once Adam has used the new
  design (9)
- [1.2] Restyling the screens 1.2 doesn't touch to the canvas
- [1.2] Deleting or rebuilding the AI/Coach features
- [1.2] A REVIEW threshold for RIR ("2 or more off"), if real use asks for it

## Not this build (context only)

- Platform for personal trainers and their trainees; later for companies
  managing trainers
- Expanding and improving AI features
- Notifications
