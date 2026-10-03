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

- **Phase 1 — what a workout is:** planning, scheduling, set structures, and how
  they render on the workout screen.
- **Phase 2 — how logging feels, plus the platform:** tracked fields, logging
  mechanics, login, library, navigation, settings, Polish.

**This version is not doing:** anything for coaches or trainers, AI changes (Coach
stays exactly as it is), notifications, templates, cardio, progress screen
rebuild. Full list at the bottom.

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

---

## Objects stored

Domain level. `TASKS.md` maps these onto the existing schema.

**Program** [P1] — the reusable plan. Never changed by running it.
- name
- schedule type: `weekday` | `sequence`
- planning type: `stable` | `week-dependent`
- priorities: a list of (muscle group or subgroup, `focus` | `dont_care`).
  Anything unlisted is normal.
- workouts (below)
- for `sequence`: the ordered sequence — workout positions and rest-day
  positions, e.g. A, rest, rest, B, rest, rest, C, rest, rest

**Program workout** [P1]
- name
- for `weekday`: its day of the week
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
it's week 1.
- kind: `working` | `warmup` | `staged`
- for `staged`: stage kind (`dropset` | `rest-pause` | `myo-reps` | `cluster`),
  its stages, and rest between stages (default: dropset none — stages run back
  to back; rest-pause, myo-reps, cluster 15 s)
- rep target, optional: a number | a range (min–max) | `AMRAP`
- rest override for the rest after this set, optional

**Run** [P1] — one run of a program (today's "mesocycle").
- program reference; start; end when the user ends it
- its own copy of the program's plan (what the program tab shows and edits)
- for `sequence`: position in the sequence, counted from the last workout done

**Week** (or **cycle**, for sequence runs) [P1] — exists once planned.
- run reference; index
- per session: exercises as planned for this week (including one-week swaps and
  reorders and whether each is "only this week"), sets with weight target, rep
  target override, RIR target, tags per set
- per session: deload flag

**Session** [existing, extended]
- [P1] deload flag; moved-to date (weekday); session-only exercise order
- [P2] clock start and end (end derived from the last logged set, as duration
  already is)

**Set log** [existing, extended]
- [P1] set kind and stage kind as planned
- [P2] side split: when split, L and R values for every tracked field
- [P2] for bodyweight exercises: weight is signed added load (0 = bodyweight)

**Settings** [existing, extended]
- [P1] warmup display: `rows` | `tick`; default deload rules (below)
- [P2] per tracked field (RIR/RPE, form, set time, energy/pump):
  `off` | `optional` | `mandatory`; effort scale `RIR` | `RPE`; pre-fill:
  `empty` | `planned` | `planned, else last time`; set lock on/off; app
  language; exercise-name language

**Deload rules** [P1] — global default in settings, override per program. Each
rule independent and optional:
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
- Activating a program creates a run with its own copy of the plan. The program
  tab inside the plan screen shows and edits that copy — never the saved
  program.
- What the program tab can edit mid-run:
  - **Design fields** — rest, rest after, tempo, warmup routine, priorities,
    superset rest, stage rest. They exist only in the run's copy. Editable for
    both planning types; apply to this run from the next session on.
  - **Volume** — the exercise list and the sets.
    - `stable`: editable; weeks not yet planned pick it up, and "Apply this
      change to planned weeks ahead" covers planned ones.
    - `week-dependent`: read-only, shown as week 1's reference. Permanent volume
      changes are made in a week and carry forward through copying.
- Priorities live on the program and can be changed per run in the plan screen
  (as today).

### Stepped program planner [P1]

1. **Priorities** — skippable. Muscle groups, each unfoldable to subgroups. Each
   group and subgroup is marked independently: focus, don't care, or left
   normal.
   - If a group and one of its subgroups are marked differently, the subgroup's
     mark applies to that subgroup.
   - The summary is phrased from the group: "chest without upper chest".
2. **Exercises and order** — exercises per workout, their order, superset
   grouping, the warmup routine checklist, and the schedule: schedule type, then
   a weekday per workout (`weekday`) or the sequence order with rest days
   (`sequence`).
3. **Volume** — choose `stable` or `week-dependent`, then plan the sets.
   - `stable`: the sets planned here are the volume for every week, and the
     program saves with them.
   - `week-dependent`: only week 1 is planned here, and the program saves with
     week 1.
   - The only required value is the number of sets per exercise. Rep targets,
     set kinds, rest and tempo are optional.
   - Entering sets stays quick for the plain case: fill all sets of an exercise
     at once, then adjust individual sets.

### Priorities migration [P1]

- Existing four levels: top → focus; low → don't care; the two middle levels →
  normal.

### Weeks and copying [P1]

- A week (cycle) gets planned the first time it's opened in the planner, or when
  it starts, whichever is first. At that moment it's filled from its source, and
  from then on it's its own week.
- **Source of a new week's volume:** `stable` → the run's copy, always.
  `week-dependent` → the last planned week ("copy last week" is the default;
  a setting lets weeks start empty instead — default for new users: copy).
- **Source of weight and RIR targets:** the last planned week, for both types.
- **Tags are never copied.**
- **Deload sessions are never a copy source.** A week that's partly deload still
  copies its normal sessions; its deload sessions copy from the last normal
  occurrence.
- **"Only this week"** — a tick on swap and reorder actions in the week plan, off
  by default, `week-dependent` only. When ticked, that change is not copied
  forward. (For `stable`, every week edit is a one-off already, because new
  weeks come from the run's copy.)
- **"Apply this change to planned weeks ahead"** — offered when a week is edited
  and later weeks are already planned. Applies only the change just made; leaves
  everything else in those weeks alone. Both planning types.
- **Stable, permanent mid-run change:** edit the program tab. Weeks not yet
  planned pick it up; "Apply this change to planned weeks ahead" covers planned
  ones.
- The number of weeks stays open-ended, as today.
- "Copy last week" stays as a manual action.

### Targets [P1]

- **Weight targets:** per set, in the week plan only. Never in the program.
- **Rep targets:** per set, in the program. A number, a range, or AMRAP.
  Optional. The week plan can override a set's rep target for that week.
- **RIR targets:** per set, in the week plan only. Optional. Stored as one value;
  shown as RPE when the RPE setting is on [P2] (RPE ≈ 10 − RIR, half-points
  allowed).
- **AMRAP:** counts as a normal working set everywhere. Its RIR defaults to 0
  (RPE 10), editable.
- A set without a target shows no target.

### Tags [P1]

- Per set, in the week plan. Preset list ("push here", "maintain strength",
  "focus on execution", "push back") plus custom text.
- "Apply to all sets" fills one tag across an exercise's sets.
- Shown on the set's row during the workout. Never tracked. Never copied.

### Tempo [P1]

- Per exercise, in the program. Shown next to the exercise during the workout.
  Not tracked.

### Rest [P1]

- Timer value, most specific first:
  1. the set's own rest override
  2. on an exercise's last set: the exercise's "rest after"
  3. the exercise's rest
  4. the global rest setting
- Supersets: no timer between exercises within a round by default; the block's
  rest after each round. Both overridable per superset.
- Staged sets: the staged set's own rest between stages (dropset: no timer;
  rest-pause, myo-reps, cluster: 15 s by default).
- Warmup sets follow the same chain.

### Supersets [P1]

- Any number of exercises.
- Shown as a block of rounds: round 1 = A1, B1, C1; round 2 = A2, B2, C2; …
- Unequal set counts are allowed. A round can have an empty slot; leftover sets
  stay inside the block (4 sets of A, 3 of B → 4 rounds, round 4 has only A).
- The current set zigzags through rounds: A1 → B1 → A2 → B2 …
- Every reorder (program, week plan, session) moves a superset as one block.
- "Last time" stays per exercise.

### Warmup sets [P1]

- A set kind, planned in step 3. Exercises that don't need warmups simply have
  none.
- Never counted in volume, set counts, or "last time" matching.
- Logged values: weight and reps, both optional; plus a rest timer. Nothing else.
- Display setting: `rows` (default; numbers optional) or `tick` (tick-off only).
- [P2] Mandatory fields never apply to warmup sets.

### Warmup routine [P1]

- Per workout, in the program: a checklist shown at the top of the session.
- Items are ticked off; nothing else is logged.

### Staged sets [P1]

- The dropset machinery generalised. Stage kinds: dropset, rest-pause, myo-reps,
  cluster.
- Dropset: as today. Other kinds: each stage's weight carries over from the
  previous stage by default instead of being dropped.
- Stages are never counted as separate sets, except in volume (existing rule).
- Deleting a staged set's head deletes its stages (existing rule).

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
  on: sets −50%, everything else unchanged. A program can override.
- Rounding is part of the rules (global default, per-program override): sets
  round down or up, never below 1; weight rounds down or up to a chosen
  precision step. Defaults: sets round down; weight rounds down to 2.5 kg.
- Deloads are marked manually only. Scheduled deloads are `later`.
- Any deload session can still be edited by hand afterwards.

### Scheduling [P1]

**Weekday**
- Workouts are tied to days of the week (as today).
- **Move this session to another day, this week only.** A missed workout done at
  the end of the week = one move; swapping two days = two moves. Today's "do it
  the next day" is the simplest case of the same action.
- Moving a session onto a day that already has one leaves both on that day,
  shown as a list. Sessions per day are therefore not limited to one.
- Planning two workouts on the same weekday in the program is `later`.

**Sequence**
- An ordered list of workouts and rest days, not tied to dates.
- The cycle replaces the week everywhere the week is used (week plan, copying,
  week-dependent volume, deload shortcut, labels).
- Rest days count from the last workout done. Do A Monday with two rests planned
  → B is due Thursday.
- The sequence only moves forward when a workout is done. Not training on a due
  day misses nothing; that workout stays next and everything after it shifts.
- On a rest day, **"Train anyway"** starts the next workout; the remaining rest
  days before it disappear.
- **Skip** drops a workout entirely; the sequence moves to the next one.

### "Last time" reference [P1]

- Deload sessions never count.
- Crosses run boundaries.
- **Weekday:** LAST WEEK only when the match is from the immediately preceding,
  non-deload week. Otherwise LAST TIME + elapsed time. FIRST TIME only when the
  exercise has truly never been done.
- **Sequence:** always LAST TIME + elapsed time. EARLIER THIS WEEK is hidden.
- Matches by exercise; reordering never affects it.

### Volume [P1/P2]

- Warmup sets: never counted.
- Staged-set stages: count in volume only.
- [P2] Unilateral: weight × the sum of both sides' reps; still one set.
- [P2] Bodyweight: added load only (pure bodyweight contributes 0). Permanent
  rule — body weight varies too much day to day to be meaningful.

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
  whole history's display.

### Logging mechanics [P2]

- **Row states:** logged → compact read-only line (weight × reps, plus RIR/form
  if tracked), Edit opens it; current → every field switched on, plus Log;
  upcoming → targets only.
- **Current set** = the first unlogged set in the session's displayed order.
- **Lock:** Log works only on the current set. Tapping another row makes it
  current (deliberate two-step). Setting to turn the lock off; on by default.
- Row actions (make a dropset/stage) appear only on the current set or the one
  just logged. "Add set" stays once, at the end of the exercise.
- **"Set added · Undo"** after adding a set.
- **Delete set:** behind a row menu, with a confirmation step. Logged and
  unlogged sets, this session only, never touches the plan.
- Unlogged sets at finish behave as they do today.
- **Pre-fill:** values shown as grey suggestions, visibly different from typed
  values. Log accepts them as they are. Source: planned, otherwise last time.
  Setting: empty / planned / planned, else last time (default).
- **Reorder this session:** move exercises up or down; supersets move as one
  block; partly-done exercises can move. Session only. Current set and "scroll
  to current" follow the new order. History shows the order as performed.
- **Unilateral split:** a set is one row by default; "split sides" turns every
  tracked field on that set into L and R values. Mandatory applies to both sides.
- **Bodyweight:** weight entered as signed added load; shown as "BW", "BW +10",
  "BW −20". "Last time" compares added load.

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

### Language [P2]

- Polish and English UI, every screen except Coach. Follows the device; override
  in settings. Polish date formats.
- Translated: UI text, muscle groups, preset tags, set-kind names. Never
  translated: anything a user typed.
- Exercise names: every catalog exercise has both names. Exercise-name language
  is its own setting (defaults to the app language). Search always matches both.
  Custom exercises: one name, optional second.
- The Polish exercise-name list is a deliverable Adam reviews before it's loaded.
- Build order: the translation setup comes first in phase 2, so every new string
  in phase 2 is translatable from day one. The full translation pass comes last.

### Navigation and settings

- [P1] The program screen folds into the plan screen as its program tab.
- [P2] Bottom bar: Today, Plan, History, Library, Settings. Progress and Coach
  become tabs inside History; Coach is otherwise untouched.
- [P2] Settings grouped: Workout (logging and tracking), Planning (deload
  defaults, week start), Language, Appearance.

### Removals [P1]

- The note section shown when editing a logged set is removed.
- Suggested reps per program exercise are replaced by per-set rep targets.
  Removing the old field changes stored data → blocking decision at build time.

---

## Screens

### Plan screen [P1]

- **Program tab:** the run's copy of the plan — priorities, workouts, exercises,
  order, sets, targets, rest, tempo, warmup routine. Edits change this run only,
  as limited in Rules → Programs and runs (volume read-only for week-dependent).
- **Weeks (cycles):** week switcher, open-ended. Each session shows its exercises
  and sets with weight, rep and RIR targets and tags.
  - Actions: edit any value; swap or reorder exercises (with "only this week"
    for week-dependent); mark session or week as deload; copy last week; "Apply
    this change to planned weeks ahead" after an edit when later weeks are
    planned.
  - Deload sessions are visibly marked.
- **Empty states:** no active run → "Start a program", leading to the planner.
  A week-dependent run whose weeks start empty → "Copy last week" on the empty
  week.

### Program planner [P1]

- Three steps as in Rules. Back and forward between steps; priorities skippable.
- Saving stores the program as it is; activating creates a run.
- **Empty state:** a new workout with no exercises → "Add an exercise".

### Today / workout screen [P1 rendering; P2 logging mechanics]

- [P1] Warmup routine checklist at the top. Supersets as blocks of rounds. Warmup
  sets per the display setting. Staged sets with locked stage rows. Tags on set
  rows. Tempo next to the exercise. Rest timer per the rest chain. "Last time"
  per the rules.
- [P1] Sequence run, rest day: shows the next workout and "Train anyway".
- [P1] Weekday run: "Move this session" action.
- [P2] Row states, lock, pre-fill, tracked fields on the row, undo, delete set,
  reorder this session, split sides, bodyweight entry, exercise notes.
- [P1] Several sessions on one day are listed; each opens on its own.
- **Empty state:** no session today → the next scheduled session and when it's
  due; on a sequence rest day, "Train anyway".

### Finished session [P2]

- Summary, clock times, edit for energy/pump/notes, "fill in" marker when a
  mandatory rating is missing.

### History [P2 for the tab change]

- Gains Progress and Coach as tabs. Session list shows clock times.

### Library [P2]

- The user's library (ticked + custom), searchable in both languages; catalog
  browsing with tick/untick. Exercise page: names, muscle tags, flags (editable
  as personal edits), notes, remove/delete/merge.
- **Empty states:** new user with nothing ticked → "Browse the catalog". Library
  or picker search with no match → "Create '…'".

### Sign-in [P2]

- "Continue with Google"; "Sign in with email" for existing accounts; password
  reset. No signup form.

### Settings [P1 additions; P2 regroup]

- [P1] Warmup display; default deload rules; week start (copy / empty).
- [P2] Grouped as above, with tracked-field switches, effort scale, pre-fill,
  set lock, both language settings.

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
  missing the bottom of the range
- Open-ended sets: total-reps target (a coached lifter had 40 total reps, 2 min
  rest between sets) and sets until a set falls short (Adam's own plan) — one
  structure with two stop conditions
- Calendar view and plan history (planned side of past runs)
- Run length (fixed-length runs) and scheduled deloads ("every Nth week")
- Planning two or more workouts on the same weekday
- Custom home screen (reminders, e.g. to plan next week)
- New-user guide

## Not this build (context only)

- Platform for personal trainers and their trainees; later for companies
  managing trainers
- Expanding and improving AI features
- Notifications
