# Overload — Exercise Library Rework — Technical Plan (v1)

*Written 2026-08-28 from EXERCISE-LIBRARY-SPEC.md, with
COACH-PERSONALIZATION-SPEC.md/TASKS.md §11.3 (the swap-exercise picker) and
COACH-WEEK-ANALYSIS-TASKS.md §2.1/§4/§7.9–§7.13 (the
`muscle_subgroup`/`movement_pattern` schema) read for the patterns this
reuses. Its own §0–§11 numbering, independent of SPEC.md's,
COACH-ANALYSIS-SPEC.md's, COACH-WEEK-ANALYSIS-SPEC.md's and
COACH-PERSONALIZATION-SPEC.md's — this is a separate initiative, not a v3
phase, and TASKS.md does not cover it.*

**Nothing in this document is built. No code was written. No migration file
was created on disk. The SQL below is plan content, in the same form
COACH-WEEK-ANALYSIS-TASKS.md §2.3 and COACH-PERSONALIZATION-TASKS.md §3
carry theirs — a proposal to review, not an applied change.**

**Revised same day (2026-08-28), documentation only, once Adam settled
§11's four open questions** — all four approved as recommended. §11 below
records each decision in place; §3.4 (a new migration, 022) and the
touch-points it requires in §5/§7/§8/§10 exist because of that revision.
Everything else in this document is unchanged from the version Adam
reviewed. No implementation followed from this revision either.

**Reading order for the six things the brief asked for:**

| Brief item | Where |
|---|---|
| 1. Schema — libraries, provenance, three-state lifecycle | §2 (reasoning), §3 (the migrations) |
| 2. A real proposal for §5's open question (retroactive provenance) | §4 |
| 3. Reassignment at the query level — tables, order, safety checks | §5 |
| 4. The §3/§6 confirmation step — what it must say and confirm | §6 |
| 5. Implementation order | §8 |
| 6. Assumptions and decisions not covered by the spec | §9 |

---

## 0. Three corrections to the spec's technical references

Recorded up front, in the same place and for the same reason
COACH-ANALYSIS-TASKS.md §0 and COACH-PERSONALIZATION-TASKS.md §1 record
theirs: the spec's product reasoning is right in all three cases, but the
technical claim attached to it doesn't survive contact with the code, and
building to the claim as written would produce the wrong thing.

### 0.1 — Reassignment is *not* "the same underlying mechanism as swap-exercise"

SPEC §5 bullet 4: *"the same underlying mechanism as swap-exercise, applied
retroactively across a whole history instead of one session."*

Swap-exercise (COACH-PERSONALIZATION-TASKS.md §11.3, shipped 2026-08-27)
re-points **nothing**. It marks the original exercise's remaining planned
sets as skipped via the existing `handleSkipExercise`, and then logs
*new* `v2_set_logs` rows under the replacement's `exercise_id`. Its own
plan explicitly lists `sessionService.ts`, `weekPlanService.ts` and every
migration as **deliberately unchanged**, because "the whole point of the
session-only, derived-from-logs design is that none of these needed to
change." There is no update statement anywhere in it to generalise.

What *is* genuinely reusable is the thing SPEC §6 actually asks for one
line later — **the picker**: `SwapExerciseSheet.tsx`'s two-step
pick-or-create-then-confirm bottom sheet, its `useCreateExercise()` reuse
for "create new", and its confirm step. §6 of this document builds
directly on that. The *write* is new work with no precedent in this repo,
which is exactly why §5 is the longest section here.

### 0.2 — `v2_week_plan_sets` does not reference an exercise, so it can't be "re-pointed"

SPEC §5 bullet 4 lists "week-plan sets" among the tables that get
re-pointed to the target's id. `v2_week_plan_sets` has no `exercise_id`
column (`001_v2_schema.sql`) — it references `program_exercise_id`, and
inherits exercise identity from there. In the normal case it therefore
follows `v2_program_exercises` automatically and needs no statement of its
own.

It needs handling in exactly one case — a **merge collision**, where the
same workout day already contains the reassignment target — and there the
correct action is the opposite of re-pointing: its rows must be moved onto
the *surviving* program-exercise row **before** the source row is deleted,
or `on delete cascade` destroys them and silently nulls the
`week_plan_set_id` of real logged sets. §5.3 step 2 covers this.

**Only two tables in the entire schema reference `exercises(id)`:**
`v2_program_exercises.exercise_id` and `v2_set_logs.exercise_id`. Verified
by grep across `supabase/migrations/*.sql`, not assumed.

### 0.3 — "Gone" is not a storable status

SPEC §5 bullet 3 asks for "a status distinguishing an exercise's three
real states: active, lost, and gone (deleted for real, zero history)."

An exercise that has been deleted for real has no row to carry a status.
Storing `'gone'` would mean keeping a tombstone row for something that by
definition has zero history and zero references — and every picker,
filter and count in the app would then need a third exclusion clause
forever, to hide rows that exist only to say they don't.

The three states are real states *of the world* and the plan models all
three. Two of them are row states (`status in ('active','lost')`); the
third is row absence. §2.3 carries the full reasoning and §7.1 the
type-layer shape that keeps all three nameable in code.

---

## 1. What already exists that this reuses — verified, not assumed

Read directly this session, not inferred from the docs:

- **`exercises` is a flat, shared table** (shared with Northstar v2 —
  CONTEXT.md "Database tables" and "Standing architectural risk"). Columns
  today: `id`, `user_id`, `name`, `muscle_group` (added in
  `001_v2_schema.sql`), `is_archived`, `created_at`, plus
  `muscle_subgroup text[]` and `movement_pattern text` (migration 013).
  **70 rows** on Adam's account, of which 2 are archived.
- **`exerciseService.ts`** already owns the whole surface this feature
  replaces: `fetchExercises`, `createExercise`, `updateExercise`,
  `setExerciseArchived`, `fetchExerciseCount`,
  `seedDefaultExercisesIfEmpty`, and `importDefaultExercises` — the
  single-button all-or-nothing download SPEC §1 exists to replace.
  `importDefaultExercises` already establishes the **case- and
  whitespace-insensitive name identity rule** (`name.trim().toLowerCase()`)
  that §4 reuses, and the `navigator.locks` double-tap guard that §8
  step 5 reuses for library download.
- **`DEFAULT_EXERCISES`** (`defaultExercises.ts`) is **46 entries**, name +
  `muscleGroup` only, no tags.
- **`SwapExerciseSheet.tsx`** is the picker pattern SPEC §6 names: filters
  `useExercises(false)` by `muscleGroup`, excludes self and archived,
  offers an inline "create new" through `useCreateExercise()` fixed to the
  same muscle group, and gates the write behind a second confirm step that
  states the side effect *and its exact count* before firing. §6 extends
  this shape rather than inventing a second one.
- **`ExerciseForm.tsx`** is the existing create/edit sheet — name input
  plus a 3-column muscle-group grid. It has no tag fields at all, which is
  the gap SPEC §1's second paragraph names, and which
  COACH-WEEK-ANALYSIS-TASKS.md §7.11 explicitly deferred ("no in-app
  tagging UI, and no change to `Exercise` / `exerciseService.ts` /
  Library"). This plan is where that deferral gets closed.
- **`v2_set_logs` has no unique constraint on `(session_id, exercise_id,
  set_number)`** — 007's audit found 0 duplicates in practice, but nothing
  in the schema prevents them. Load-bearing for §5.3 step 3.
- **A dropset stage carries the *same* `set_number` as its head**
  (`ExerciseCard.tsx:211`, `setNumber: headLog.setNumber`). So `set_number`
  is a total order over **groups**, not rows, and any renumbering must move
  a head and its stages together. Also load-bearing for §5.3 step 3.
- **The Dexie offline cache mirrors exercise identity in three places**
  (`db.ts`): `db.exercises` (its own table, indexed on `muscleGroup`),
  `db.set_logs.exerciseId` (an index), and `db.workout_days.exercises` (a
  serialised `ProgramExercise[]` blob with joined exercise data). All three
  go stale on a merge — §5.5.
- **`db.sync_queue` can hold a `v2_set_logs` upsert carrying a literal
  `exercise_id`** (`useSession.ts:692`). Replaying one after its exercise
  has been hard-deleted violates the FK, and `useSyncQueue.ts`
  dead-letters after 3 attempts — **silently discarding a real logged
  set**. This is the same class of hazard migration 010 was deliberately
  ordered last for ("must not run until the queue is confirmed empty"), and
  §5.2 reuses that gate.
- **The three history views** (`009_v3_history_views.sql`) join
  `exercises` live on `sl.exercise_id`. They are derived — they follow a
  merge automatically and need no migration.
- **No `.rpc(` call exists anywhere in `src/` or `api/`.** A Postgres
  function is a new pattern for this repo; §5.1 justifies introducing one
  rather than treating it as free.
- **The batch-classification review gate** (COACH-WEEK-ANALYSIS-TASKS.md
  §4.2, `COACH-EXERCISE-TAGS.md`, migration 014) is the established shape
  for a one-time, ~70-row, judgment-requiring data pass in this repo:
  propose to a reviewable markdown file → Adam reviews → a *separate*
  migration writes the approved values, keyed on `id` with the name in a
  trailing comment. §4 reuses it exactly.

---

## 2. Tech approach, with reasoning per choice

### 2.1 `v2_exercise_libraries` — a global catalog, and the first non-per-user table in this schema

SPEC §3: libraries are *"global, shared, curated catalogs… not personal or
per-user."* Every existing `v2_` table is per-user with the identical RLS
policy (`for all using (user_id = auth.uid()) with check (user_id =
auth.uid())`). This one genuinely isn't, and pretending otherwise would
mean duplicating the same catalog row per account.

| Option | Verdict |
|---|---|
| **Global table, read-only to the app** | **Chosen.** `user_id`-less, RLS enabled with a `for select using (true)` policy and **no insert/update/delete policy at all** — so the app can read every library and cannot write one. Content arrives through migrations and the SQL Editor, which is exactly how SPEC §7 describes it ("content comes later", curated). |
| Per-user copies of each library | Rejected. Turns a curated catalog into user data, and makes "add a new library" a backfill across every account. |
| No table — hardcode libraries in TS like `DEFAULT_EXERCISES` | Rejected, but it is the closest call here. It would work for v1 and needs no migration. It fails on provenance: `exercises.source_library_id` needs a stable, referenceable key, and a TS constant gives you a string to hand-maintain instead of an FK. It also makes adding a library a redeploy rather than an insert. |

`slug text unique not null` alongside `name` because code needs to name one
specific library (`'legacy-default'`, §4) without hardcoding a uuid.

`is_listed boolean not null default true` because the legacy library
(§4) must exist as a provenance target but must **not** appear in the
download list — it has no catalog content to preview and nothing to
download. Deriving that from `slug = 'legacy-default'` would work today
and rot the moment a second unlisted library exists (a staged, unreleased
one, say). One boolean, one meaning.

### 2.2 `v2_exercise_library_items` — created empty, on purpose

SPEC §7 puts library *content* out of scope: *"this version is UI and logic
only, content comes later."* That is a statement about **rows**, not about
schema. Preview and download are the two things §8's success criteria
require to actually work, and neither is implementable against a table that
doesn't exist — you would be building a UI with no shape to render and a
download with nothing to insert from, then guessing at both later.

So: **the table ships in v1 with zero rows.** Every library previews as
empty, every download inserts nothing and reports "0 added", and the day
content arrives it is an `INSERT`, not a migration plus a rewrite of the
download path. §8 step 5's verification is explicitly written to be run
against a throwaway seeded library so that "download works" is proven for
real rather than proven vacuously against an empty table.

**Library items carry tags** (`muscle_subgroup`, `movement_pattern`), not
just name and muscle group. This is the point at which
COACH-WEEK-ANALYSIS-SPEC.md §9's deferred question — *"how do newly
downloaded exercises get tagged"*, which CONTEXT.md's "Standing future
work" entry flags as the specific place this feature interacts with the
tagging pass — gets a real answer instead of another deferral: **a
downloaded exercise arrives pre-tagged, copied from its library item.**
Hand-created exercises still fall back to `muscle_group` exactly as before,
and §2.6's tag-editing screen is where either gets corrected.

`unique (library_id, lower(btrim(name)))` — the same case- and
whitespace-insensitive identity rule `importDefaultExercises` already
applies, enforced here rather than left to whoever writes the content
migration.

### 2.3 The lifecycle: `status` on `exercises`, two stored values, three real states

**`status text not null default 'active' check (status in
('active','lost'))`** on `exercises`.

This **deliberately diverges from migration 013's precedent** for this same
shared table (nullable, no default, no `NOT NULL`), and the divergence
needs stating rather than sliding past:

- For `muscle_subgroup`, `NULL` is a **genuinely distinct third state** —
  "untagged" — with its own defined behaviour (fall back to
  `muscle_group`). 013's `CHECK` exists precisely to keep `NULL` the *only*
  representation of it (COACH-WEEK-ANALYSIS-TASKS.md §2.1: "this leaves
  exactly ONE representation of untagged, so the fallback is one branch
  instead of two").
- For `status` there is no third row state. Every row that exists is
  active or lost. A nullable `status` would make `NULL` a **synonym** for
  `'active'`, and every picker query in the app — `fetchExercises`,
  `ExercisePicker.tsx` (×2), `SwapExerciseSheet.tsx`, and the tag screen —
  would have to spell `.or('status.is.null,status.eq.active')` forever.
  That is the two-representations problem 013's own reasoning exists to
  avoid, arrived at from the other direction.

So the *principle* is the same one; applying it here produces `not null
default 'active'` rather than `null`. The blast radius on the shared table
stays acceptable: `add column … not null default` is metadata-only on
Postgres 11+ (this project runs 17.6.1.141, confirmed in
`009_v3_history_views.sql`'s header), no rewrite, no trigger; Northstar's
inserts omit the column and get `'active'`, which is the semantically
correct value for an exercise Northstar created; a `select *` → re-upsert
round-trip carries it through unchanged. §9.8 records the residual
cross-app assumption, which is the same one
COACH-WEEK-ANALYSIS-TASKS.md §7.13 already accepted and cannot be verified
from inside this repo.

**`lost_at timestamptz`, nullable** — set when a row becomes `lost`,
cleared if it is ever restored. Orders the Lost Exercises list and makes
"when did this history get orphaned" answerable. Nullable with no default
is correct here because `NULL` *is* a distinct state (never lost), unlike
`status`.

**No `lost_reason` column.** Considered and rejected: the only thing it
would say that `source_library_id` doesn't is manual-vs-library-delete, and
the Lost list can render "from Dumbbell Exercises" from provenance alone.
One less column on a shared table.

**`status` and `is_archived` stay orthogonal, and `is_archived` is not
touched.** They overlap in the UI ("not offered in the picker") but not in
meaning: archived is a reversible user preference on an exercise you still
own, lost is a specific queue awaiting reassignment. `is_archived` is also
a v1 column this repo did not add and Northstar may read. **Rule:
`status = 'lost'` excludes a row from every selectable list regardless of
`is_archived`; `is_archived` keeps its exact current behaviour for
`status = 'active'` rows.** §11 open question 3 asks whether archive should
eventually be retired in favour of this, which is a product call, not a
technical one.

### 2.4 `source_library_id` — the provenance link, on the exercise row

**`source_library_id uuid references v2_exercise_libraries(id) on delete
restrict`**, nullable. `NULL` means "not from a library" — created by hand,
via `ExerciseForm.tsx` or `SwapExerciseSheet.tsx`'s inline create.

Here `NULL` *is* a real distinct state, so this one takes 013's nullable
shape, not §2.3's.

`on delete restrict`, not `set null` or `cascade`: libraries are curated
and never user-deletable (§9.1), so a delete should never happen — and if
one ever is attempted, failing loudly is better than silently erasing the
provenance of every exercise that came from it. `restrict` makes the
attempt a visible error instead of a quiet data loss.

Alternative considered and rejected: a `v2_exercise_provenance` side table
keyed on `exercise_id`, so the shared `exercises` table takes no new
columns at all. It is the lower-cross-app-risk option and worth naming for
that reason. Rejected because `status` has to be on the row (it gates the
hot path — every picker query in the app), so the side table would only
move *one* of the two columns while adding a join, and "no provenance row"
reintroduces exactly the NULL-vs-absent ambiguity §2.3 spends its budget
eliminating.

### 2.5 Reassignment runs as one Postgres function, not a sequence of client calls

Full detail in §5. The headline decision: this introduces the repo's first
`.rpc()` call, and that is justified rather than incidental.

- Reassignment touches **two tables plus a delete** and must be
  all-or-nothing. A partial merge is worse than no merge: it is precisely
  the "fabricates continuity across your entire training history" outcome
  SPEC §3 warns about, *plus* an inconsistent database.
- `supabase-js` has no multi-statement transaction. Three sequential
  client calls with a dropped connection between calls 2 and 3 is a
  realistic failure on a phone in a gym, and there is no undo.
- `SECURITY INVOKER` (the default — **not** `SECURITY DEFINER`) so RLS
  still applies exactly as it does to the client, with explicit
  `user_id = auth.uid()` predicates as defence-in-depth on top, matching
  every other query in this repo.

### 2.6 Tag editing extends `ExerciseForm.tsx`; the list mode is a new screen

SPEC §3 wants both a single scrollable list with inline editing *and* a
per-exercise detail view, user's choice.

- The **per-exercise view** is `ExerciseForm.tsx` plus two controls: a
  multi-select chip grid for `muscle_subgroup` and a single-select grid for
  `movement_pattern`. Its muscle-group grid is already exactly this
  interaction; the subgroup grid is the same component with
  multi-selection, and the pattern grid is the same component with a
  7-value vocabulary.
- The **list mode** is a new `ExerciseTagList.tsx` — one row per exercise,
  tags editable in place. Not a variant of `ExerciseList.tsx`: that
  component is a display list with archive/edit affordances, and bolting a
  second editing mode into it would make it own two unrelated jobs.
- **The vocabulary moves out of the migration and into a pure module.**
  `muscle_subgroup`'s 22 values currently exist only as prose in
  COACH-WEEK-ANALYSIS-TASKS.md §4.3 and as literals inside migration 014,
  because §7.11 deliberately kept them out of the app. A UI that offers
  them needs them in code: `src/lib/exerciseTags.ts`, exporting the
  subgroup vocabulary grouped by muscle group (for a sensibly-ordered
  grid), the seven `movement_pattern` values, and display labels.
  **§7.10's asymmetry survives intact** — the pattern vocabulary stays
  DB-enforced by 013's `CHECK` *and* is now mirrored in TS; the subgroup
  vocabulary stays app-layer-only, and this module becomes its single
  source of truth rather than a second copy of one. Real Vitest coverage,
  same precedent as `ratingScales.ts`.
- **`updateExercise` must not silently blank tags.** It currently takes
  `(id, name, muscleGroup)` and writes exactly those. Extending it to
  accept optional tag fields means an existing caller that omits them must
  leave them untouched, not write `null`. Called out because it is a
  one-line mistake with a silent, data-destroying outcome, on a column
  whose only other writer was a hand-reviewed migration.

---

## 3. Migrations

Four, in order. `018` is the last applied. Numbering follows the existing
convention (`NNN_v3_<group>_<what>.sql`).

Four rather than one, deliberately — the opposite call to
COACH-WEEK-ANALYSIS-TASKS.md §2's "one migration, not two", and for a
reason that doesn't apply there: **020 cannot be written until Adam has
reviewed §4's proposal**, exactly as migration 014 could not be written
until `COACH-EXERCISE-TAGS.md` was approved. **021 is a function whose
body will very likely change during §8's own testing**; keeping it separate
means re-applying it is a `create or replace`, not a re-run of schema DDL.
**022 (§3.4, added 2026-08-28 once §11.2's audit-row question was decided)
is schema 021's function writes to** — it has to exist before 021 does,
and keeping it separate from 019 means it can be reviewed on its own
narrower merits (an audit table's shape is a much smaller decision than
the whole feature's schema) rather than buried inside the first migration.

### 3.1 Migration 019 — `019_v3_exercise_libraries.sql`

```sql
-- Overload — Exercise Library Rework, schema
-- (EXERCISE-LIBRARY-SPEC.md §5, EXERCISE-LIBRARY-TASKS.md §2/§3.1.
-- 018 is the last applied migration.)
--
-- Two new tables and three additive columns on the shared `exercises`
-- table. Nothing existing is modified or removed. Library *content* is
-- deliberately not seeded here (SPEC §7) — v2_exercise_library_items
-- ships empty and is filled by a later, separate content migration.
-- The retroactive provenance UPDATE for the existing 70 rows is
-- migration 020, separate by design: it can't be written until §4's
-- proposal has been reviewed (same gate as 013 → 014).

-- ─── v2_exercise_libraries ───────────────────────────────────────────────
-- The first table in this schema with no user_id, on purpose: SPEC §3's
-- libraries are global curated catalogs, not per-user data. RLS is enabled
-- with a read-only policy and NO write policy, so the app can list and
-- preview every library and cannot create, edit or delete one. Content
-- arrives through migrations / the SQL Editor.

create table v2_exercise_libraries (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,   -- stable code-facing key, e.g. 'legacy-default'
  name        text not null,          -- display name, e.g. 'Dumbbell Exercises'
  description text,
  -- false hides a library from the downloadable list without deleting it.
  -- The legacy provenance library (020) is the first user: it must exist
  -- as an FK target and must never be offered for preview or download.
  is_listed   boolean not null default true,
  position    integer not null default 0,   -- display order in the library list
  created_at  timestamptz not null default now()
);

alter table v2_exercise_libraries enable row level security;

-- Read-only to every authenticated user. Deliberately NOT the
-- `for all using (user_id = auth.uid())` shape every other v2_ table
-- uses — this table has no user_id and no app-side writer.
create policy "Anyone can read libraries" on v2_exercise_libraries
  for select using (true);

-- ─── v2_exercise_library_items ───────────────────────────────────────────
-- The catalog itself: what a library contains, before anyone downloads it.
-- Ships EMPTY in v1 (SPEC §7 — "content comes later"). Preview reads this
-- table; download copies rows out of it into `exercises`.
--
-- Items carry tags, not just name + muscle group. This is what answers
-- COACH-WEEK-ANALYSIS-SPEC.md §9's deferred "how do newly downloaded
-- exercises get tagged": a downloaded exercise arrives pre-tagged.
-- movement_pattern repeats 013's exact CHECK — same closed vocabulary,
-- enforced in both places it can be written.

create table v2_exercise_library_items (
  id               uuid primary key default gen_random_uuid(),
  library_id       uuid not null references v2_exercise_libraries(id) on delete cascade,
  name             text not null,
  muscle_group     text not null,
  muscle_subgroup  text[],
  movement_pattern text,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  constraint v2_exercise_library_items_pattern_chk
    check (movement_pattern is null or movement_pattern in (
      'horizontal_push', 'vertical_push',
      'horizontal_pull', 'vertical_pull',
      'hip_hinge', 'squat', 'isolation'
    )),
  -- Same load-bearing shape as 013's constraint on exercises: exactly one
  -- representation of "untagged" (NULL), and no null array elements.
  constraint v2_exercise_library_items_subgroup_chk
    check (
      muscle_subgroup is null or (
        cardinality(muscle_subgroup) > 0
        and array_position(muscle_subgroup, null) is null
      )
    )
);

alter table v2_exercise_library_items enable row level security;
create policy "Anyone can read library items" on v2_exercise_library_items
  for select using (true);

-- Case/whitespace-insensitive uniqueness within a library — the same
-- identity rule importDefaultExercises() already applies when diffing
-- against a user's existing list, enforced here so a content migration
-- can't introduce a duplicate the download path would then have to
-- silently swallow.
create unique index v2_exercise_library_items_name_uk
  on v2_exercise_library_items(library_id, lower(btrim(name)));

create index v2_exercise_library_items_library_idx
  on v2_exercise_library_items(library_id, position);

-- ─── exercises — three additive columns ──────────────────────────────────
-- `exercises` is shared with Northstar v2 (CONTEXT.md, "Standing
-- architectural risk"). Two of the three take the same minimal-blast-radius
-- form muscle_group / muscle_subgroup / movement_pattern were added in:
-- nullable, no default, no NOT NULL, no trigger.
--
-- `status` deliberately does NOT (TASKS §2.3): unlike muscle_subgroup,
-- NULL here would be a synonym for 'active' rather than a distinct third
-- state, which would force every picker query in the app to spell
-- `status is null or status = 'active'` forever. `add column ... not null
-- default` is metadata-only on PG11+ (this project runs 17.6.1.141), so
-- this is not a table rewrite. Northstar's inserts omit the column and
-- get 'active', which is the correct value for a row Northstar created.
--
-- 'gone' is NOT a stored value (TASKS §0.3): a hard-deleted exercise has
-- no row to carry a status. Two row states, three real world states.

alter table exercises
  add column if not exists status            text not null default 'active',
  add column if not exists source_library_id uuid,
  add column if not exists lost_at           timestamptz;

alter table exercises
  add constraint exercises_status_chk
  check (status in ('active', 'lost'));

-- on delete restrict, not set null/cascade: libraries are curated and
-- never user-deletable (TASKS §9.1). If one is ever deleted anyway,
-- failing loudly beats silently erasing the provenance of every exercise
-- that came from it.
alter table exercises
  add constraint exercises_source_library_fk
  foreign key (source_library_id)
  references v2_exercise_libraries(id) on delete restrict;

-- A lost row must record when it was lost, and an active row must not
-- claim to have been. Keeps the Lost list's ordering column honest rather
-- than optional.
alter table exercises
  add constraint exercises_lost_at_chk
  check ((status = 'lost') = (lost_at is not null));

-- No new index on exercises. The table is 70 rows for this account; every
-- read already goes through RLS's user_id predicate and v1's existing
-- indexes. Adding a partial index to a shared table for a list that will
-- never exceed single digits is change without benefit.
```

**Verification, before anything is built on it** — held to the same
standard as every prior migration here (COACH-WEEK-ANALYSIS-TASKS.md §2.4,
COACH-PERSONALIZATION-TASKS.md §3.1), which means proving constraints by
*violating* them, not reading them off the DDL:

1. `information_schema.columns` for all three new `exercises` columns and
   both new tables — types, nullability, and `status`'s `'active'::text`
   default confirmed exactly as written.
2. `select count(*) from exercises where status = 'active' and user_id =
   '12e79b69-…'` → **70**, and `where status <> 'active'` → **0**. The
   default landed on every existing row and nothing else changed.
3. `select count(*) from exercises where source_library_id is not null` →
   **0** and `where lost_at is not null` → **0**. 019 establishes no
   provenance; that is 020's job alone.
4. `pg_indexes` on both new tables — exactly the pkeys plus the two named
   indexes.
5. `pg_class.relrowsecurity` + `pg_policies` on both new tables: RLS on,
   exactly one `SELECT` policy each, **and no INSERT/UPDATE/DELETE policy**
   — the read-only property is the load-bearing half here.
6. Prove the read-only property for real, not from the policy list: an
   `insert` into `v2_exercise_libraries` through a **PostgREST request with
   the anon key** (not the SQL Editor, which bypasses RLS entirely) must be
   rejected, and a `select` through the same path must succeed.
7. All three new `CHECK`s proven by attempting to violate them, each
   scoped to Adam's own `user_id` per the standing rule: `status =
   'bogus'` → `23514`; `status = 'lost'` with `lost_at` null → `23514`;
   `status = 'active'` with `lost_at` set → `23514`. Zero rows written by
   any of them.
8. `exercises_source_library_fk` proven by attempting to set a random uuid
   → `23503`.
9. Row counts on `exercises` (70), `v2_program_exercises` and
   `v2_set_logs` matched against a baseline taken immediately before
   applying — nothing touched.

### 3.2 Migration 020 — `020_v3_exercise_legacy_provenance.sql`

**Written and applied, 2026-08-29 — see CONTEXT.md's dated session entry
for the full account.** Generated directly from
`EXERCISE-LIBRARY-PROVENANCE.md` as reviewed and approved by Adam (no
corrections), not from §4's classification rule restated in prose. One
`insert` creating the `legacy-default` library row (unlisted), one keyed
`update … from (values …)` over the 46 approved legacy ids — same shape
as migration 014, name in a trailing comment per row. All five of §4.5's
checks passed against production. Shape and content as originally
proposed: §4.

### 3.3 Migration 021 — `021_v3_reassign_exercise_fn.sql`

The reassignment function. Body and reasoning: §5.

### 3.4 Migration 022 — `022_v3_exercise_reassignments.sql`

**Decided, 2026-08-28 (§11.2)** — an audit table for the reassignment
function to write to, approved as recommended. Rationale in full at §11.2;
the schema:

```sql
-- Overload — Exercise Library Rework, reassignment audit log
-- (EXERCISE-LIBRARY-TASKS.md §5, §11.2. 021 is the last applied migration.)
--
-- Written once, by reassign_exercise_history() (021), as the last
-- statement inside the same transaction as the merge itself — never
-- edited or deleted by the app afterward. This does not make a
-- reassignment reversible (§5.6); it makes an incorrect one diagnosable,
-- which is currently impossible once the source row is gone. Same
-- reasoning v2_coach_curation_runs was added for (COACH-PERSONALIZATION-
-- TASKS.md §7.6 — "provenance for a process that mutates a standing store
-- instead of appending a permanent record").
--
-- Both exercise identities are snapshotted as plain text, not read back
-- through a join, for two different reasons per side:
--   * source_exercise_id carries no FK at all, because the row it names
--     is deleted by this same function moments after this insert runs —
--     an FK here would be violated by the very operation that writes it.
--   * target_exercise_id keeps an FK for convenience (the common case:
--     "what does this used to be called, and where did it go") but ON
--     DELETE SET NULL, because a target can itself become a reassignment
--     source in some later merge and get deleted in turn. Either way the
--     *_name columns keep this row self-describing forever, the same
--     "identity travels denormalised" reasoning v2_coach_session_analyses
--     already applies to exercise names inside its content JSON
--     (COACH-ANALYSIS-TASKS.md §2, cited in TASKS §5.3's own table).

create table v2_exercise_reassignments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  source_exercise_id    uuid not null,   -- no FK — this row is deleted in the same transaction
  source_exercise_name  text not null,
  target_exercise_id    uuid references exercises(id) on delete set null,
  target_exercise_name  text not null,
  set_logs_moved        integer not null,
  program_exercises_moved  integer not null,   -- §5.3 step 2a
  program_exercises_merged integer not null,   -- §5.3 step 2b
  plan_sets_moved        integer not null,     -- §5.3 step 2b
  source_deleted         boolean not null,     -- §5.3 step 5 — false only on the
                                                -- should-be-unreachable branch
  created_at              timestamptz not null default now()
);

alter table v2_exercise_reassignments enable row level security;
create policy "Users access own rows" on v2_exercise_reassignments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Same shape as v2_coach_curation_runs' own list index — no view exists
-- yet to read this in v1 (§11.2's recommendation was for the row to exist
-- and be diagnosable via direct query, not for a list screen), but the
-- index is one line and matches this schema's standing convention for
-- every append-only log table.
create index v2_exercise_reassignments_user_created_idx
  on v2_exercise_reassignments(user_id, created_at desc);
```

**Verification, before the reassignment function that writes to it ships:**
`information_schema.columns` (13 columns, correct types/nullability);
`pg_indexes` (pkey plus the one named index); `pg_class.relrowsecurity` +
`pg_policies` (RLS on, one policy); the FK on `target_exercise_id` proven
via `on delete set null` the same way migration 017's note FK was proven
(create a throwaway target exercise, insert a throwaway reassignment row
referencing it, delete the target, confirm the row survives with
`target_exercise_id` now null and `target_exercise_name` intact, clean up
both). No row is expected to exist after 022 alone — it is written only by
021's function, never by this migration.

---

## 4. The retroactive-provenance question — a real proposal

SPEC §5's one explicitly open question:

> *your current 70 exercises predate any concept of library provenance —
> there's no record of which of them came from the original seed list. For
> the old all-in-one default library to be deletable the way this feature
> describes, something needs to retroactively establish that link.*

### 4.1 The proposal

**Create one synthetic, unlisted library (`slug = 'legacy-default'`, name
"Original Default List") and attach to it exactly those existing exercises
whose name matches a `DEFAULT_EXERCISES` entry under the same case- and
whitespace-insensitive rule `importDefaultExercises` already uses. Every
other existing exercise stays `source_library_id = NULL` — hand-created,
which is what it is. The match list goes through the same review gate
`COACH-EXERCISE-TAGS.md` established, then migration 020 writes the
approved ids.**

### 4.2 The real number, computed rather than assumed

**Run twice now, against two different sources, with identical results.**
First against the 70 live names as captured in migration 014's per-row
comments (last session, 2026-08-28). Then, this session (2026-08-29),
**directly against the live `exercises` table in production** — the SQL
Editor, scoped `where user_id = '12e79b69-…'`, no code and nothing written
(TASKS §8 step 1; full account in CONTEXT.md's 2026-08-29 diagnostic
session entry). The headline number is unchanged, confirmed by direct
production query rather than trusted from a static comment:

| | Count |
|---|---|
| Live exercises on the account | **70** |
| `DEFAULT_EXERCISES` entries | **46** |
| Live names matching a default name exactly | **46** — all of them |
| Live names with no default match (hand-added) | **24** |
| Default names with no live row | **0** |
| Ambiguous / near-miss matches needing judgment | **0** |

The split is **46 legacy / 24 hand-created**, and it is unusually clean:
every default name is present verbatim, and nothing in the hand-added 24 is
a near-collision. The closest pairs are genuinely different exercises
(`Squat` vs `Back Squat`/`Front Squat`; `Cable Row` vs `Seated Cable Row`;
`Incline Dumbell Press` vs `Incline Dumbbell Bench Press`) — distinct
movements or distinct equipment, all four correctly landing on the
hand-added side.

**Correction (2026-08-29): four archived rows, not two.** Last session's
write-up, working only from migration 014's comments (which flag "(archived)"
based on the two rows that were already archived when 014 was *written*,
2026-08-20), reported "both archived rows." The live table shows **four** —
`Incline Dumbbell Bench Press`, `Leg Curl`, `Seated Calf Raise`, `Standing
Calf Raise` — the other two archived sometime after 014 shipped. All four
still match default names (the 46/24 split itself is unaffected — this was
always a undercount in the *write-up*, not a wrong classification), and all
four are still headed to Legacy. One genuinely satisfying pattern, not a
loose end: **each of the four has a near-collision counterpart among the 24
hand-added, active exercises** — `Incline Dumbell Press`, `Seated Leg Curl`,
`Seated Machine Calf Raise`, `Standing Machine Calf Raise` respectively.
Read together, this looks like exactly what it would look like if Adam
archived each generic imported default in favour of the more specific
variant he actually trains — not an anomaly needing further explanation.
One of the four (`Incline Dumbbell Bench Press` / `Incline Dumbell Press`)
*is* the near-collision §4.2's original table already listed — now with an
explanation attached rather than just a "distinct equipment" note. The
other three (`Leg Curl`/`Seated Leg Curl`, `Seated Calf Raise`/`Seated
Machine Calf Raise`, `Standing Calf Raise`/`Standing Machine Calf Raise`)
are new to this session, bringing the account's total near-collision count
to seven, not four. All seven still land correctly: the archived generic
sits in Legacy, the specific active one sits in hand-created. Archived means "not
offered in the picker", not "not from the seed" — the same reading
COACH-WEEK-ANALYSIS-TASKS.md §4.2 step 1 already applied when it tagged
archived rows too, and still the right one for all four.

### 4.3 Why name-matching, and what it is actually claiming

The alternatives, and why each loses:

| Option | Verdict |
|---|---|
| **Name-match against `DEFAULT_EXERCISES`, reviewed** | **Chosen.** Reconstructs the link using the *same identity rule the import path itself uses* — `importDefaultExercises` already treats a name match as "already present in this account's library" and skips it. So this labels as legacy exactly the set the seeding code itself considers the same exercises. Consistency with shipped behaviour, not a fresh heuristic. |
| Attach all 70 | Rejected. Makes "delete the legacy library" destroy 24 hand-created exercises — the exact failure the provenance concept exists to prevent. |
| Attach none, leave every row `NULL` | Rejected. The old default library then isn't deletable, which is the specific thing SPEC §5 says provenance has to make possible. |
| `created_at` clustering as the primary rule | Rejected as primary, **adopted as a cross-check** (§4.4) — and the cross-check was actually run, 2026-08-29, against production; see below for what it found, which is not quite what this row originally predicted. It fails as the primary rule regardless of what the real data shows, because a hand-added exercise created seconds after any bulk batch is indistinguishable from it by time alone. |
| Ask Adam to classify all 70 by hand | Rejected. 70 binary decisions where 46 are unambiguous is a worse use of review attention than 70 pre-filled rows to scan — which is exactly the trade `COACH-EXERCISE-TAGS.md` already made and which worked (approved as-is, zero corrections). |

**What the claim actually is, stated plainly so the review can test it:**
this does not assert that each of those 46 rows was *literally inserted by
the seed function*. It asserts that each one is name-identical to a default
entry and would therefore be treated as the same exercise by every existing
code path. If Adam hand-created "Deadlift" before the seed ever ran, this
labels it legacy — and the practical consequence is that deleting the
legacy library would put it (with its history) into Lost Exercises rather
than leaving it alone. That is a recoverable outcome with an explicit
confirmation in front of it (§6), not a destructive one, which is what
makes the heuristic acceptable rather than merely convenient.

**What the cross-check actually found (2026-08-29), against real production
`created_at` values — reported as run, not as originally predicted:**

This table's own row above already flagged the risk in the abstract
("`importDefaultExercises` can create a *second* legitimate batch later") —
the live data confirms that is exactly what happened, not a hypothetical:

- **42 of the 46 legacy-matched rows share one identical timestamp down to
  the microsecond** (`2026-08-12 01:26:26.632424+00`, confirmed via
  `count(distinct created_at) = 1` over that group) — the unmistakable
  signature of one bulk `INSERT` statement (`now()` is evaluated once per
  statement in Postgres), not 42 rows added one at a time.
- **The other 4 (`Dips`, `Barbell Row`, `Leg Press`, `Leg Extension`) carry
  distinct, individually-stamped timestamps from 2026-07-03**, interleaved
  in the same few-minute windows as several of the 24 hand-added rows —
  indistinguishable from them by insertion pattern alone.
- The account's **entire creation history has exactly two shapes**: 27
  individually-stamped rows across 2026-07-03/07-05 (23 hand-added + these
  4 legacy-name matches, all one at a time, presumably via ADD EXERCISE),
  then one 42-row bulk batch on 2026-08-12. There was never a 46-row batch —
  **the "seed" this account actually saw was `importDefaultExercises()`
  (the manual Library-screen button, shipped 2026-08-10) run once on
  2026-08-12, not the automatic fresh-account `seedDefaultExercisesIfEmpty()`**,
  and it correctly inserted only the 42 defaults not already present by
  name, skipping the 4 Adam had already hand-typed days earlier — 46 − 4 =
  42, exactly. Self-consistent, not a loose end.

**Net effect on the classification: none.** The 46/24 split is unchanged
and the name-match rule was never resting on this cross-check — it was
always primary for exactly the reason this section gives. What changes is
narrower: the cross-check corroborates 42 of the 46 with an independent,
strong signal (a real batch fingerprint, just five weeks later than
assumed and via a different code path than "the seed"), and gives **no**
corroboration one way or the other for the remaining 4 — for those, the
name match is the only evidence, exactly as this section already argued
should be sufficient on its own. §4.4 step 2/3 below are corrected to
describe what the review file should actually say about this, rather than
what was predicted before it was checked.

### 4.4 The review gate — the shape 014 established

1. **Generate `EXERCISE-LIBRARY-PROVENANCE.md`** by reading production
   `exercises` directly (not `defaultExercises.ts` — same reasoning as
   COACH-WEEK-ANALYSIS-TASKS.md §4.2: names must come from the database),
   scoped `where user_id = '12e79b69-…'` per the standing rule. One row per
   exercise: `id`, exact name, `muscle_group`, `created_at`, `is_archived`,
   proposed classification (`legacy` / `hand-created`), and the matched
   default name where there is one.
2. **Include the `created_at` cross-check in the file itself, with the real
   shape now known (§4.3)** — one 42-row batch at `2026-08-12 01:26:26`
   (microsecond-identical, the real `importDefaultExercises()` run), plus
   27 individually-timestamped rows from 2026-07-03/07-05 that are a mix
   of 4 legacy-matches and all 23 of the non-outlier hand-added rows. State
   plainly, for each of the 4 legacy rows outside the Aug-12 batch, that the
   cross-check provides no corroboration either way — the classification
   for those 4 rests on the name match alone, same as §4.3 already argues
   it can.
3. **Flag ⚠ on any row where the two signals disagree**, on all four
   archived rows (not two — corrected 2026-08-29, §4.2), and on the seven
   near-collision pairs now identified (the four in §4.2's original table —
   one of which is also an archived/active pair — plus the three newly
   found archived/active pairs) — the same ⚠-flagging convention
   `COACH-EXERCISE-TAGS.md` used, so the review has somewhere specific to
   look rather than 70 undifferentiated lines.
4. **Adam reviews and corrects.** Nothing is written until then.
5. **Migration 020** writes the approved result: one `insert` for the
   library row, one keyed `update … from (values …)` over the approved
   ids, **keyed on `id` with the name in a trailing comment per row** —
   byte-for-byte the shape of migration 014, chosen there for the same
   reason (exact, and immune to this library's real typos).

### 4.5 Migration 020's verification

1. `select count(*) from exercises where source_library_id = (select id
   from v2_exercise_libraries where slug = 'legacy-default') and user_id =
   '12e79b69-…'` → the **exact** approved count (expected 46), compared
   against the `VALUES` list length — the count, not "no error", the same
   check 014 ran.
2. `select count(*) from exercises where source_library_id is null and
   user_id = '12e79b69-…'` → **24**. The two must sum to 70.
3. `select count(*) from v2_exercise_libraries where is_listed` → **0**.
   The legacy library must not be offered for download. This is the check
   that prevents the worst 020 outcome: a "download" button next to a
   library with no content, whose only real function is to be deleted.
4. `select id, name from exercises where user_id = '…' and status <>
   'active'` → **empty**. 020 establishes provenance only; it moves nothing
   into Lost.
5. Row count on `exercises` still **70**, and a spot-check that
   `muscle_group` / `muscle_subgroup` / `movement_pattern` are unchanged on
   a sample of updated rows — 020 writes one column and must prove it
   didn't clip a neighbour.

---

## 5. Reassignment at the query level

The section the brief asked for in most detail, and the one with the most
that can go silently wrong.

### 5.1 Where it runs

**One `plpgsql` function, `reassign_exercise_history(p_source uuid, p_target
uuid)`, called via `supabase.rpc()`.** Reasoning in §2.5; the mechanics
that matter:

- **`SECURITY INVOKER`** (the default — must not be `SECURITY DEFINER`).
  RLS on `exercises`, `v2_program_exercises`, `v2_week_plan_sets` and
  `v2_set_logs` applies to the caller exactly as it does from the client,
  and every statement additionally carries an explicit `user_id =
  auth.uid()` predicate as defence-in-depth. Two independent barriers, the
  same posture `009_v3_history_views.sql` took with `security_invoker` plus
  `historyService.ts`'s explicit filter.
- **Returns a row of counts** (`set_logs_moved`, `program_exercises_moved`,
  `program_exercises_merged`, `plan_sets_moved`, `source_deleted`) so the
  UI reports what actually happened rather than "done".
- **Writes one row to `v2_exercise_reassignments`** (migration 022,
  §3.4 — decided 2026-08-28, §11.2) as its last statement, inside the same
  transaction as everything else — see §5.3 step 6.
- **Raises rather than returning a partial result** on any precondition
  failure, so the whole thing rolls back. A function body is a single
  implicit transaction.

### 5.2 Preflight — checked on the client, before the confirmation sheet opens

These are cheap, and each one is here because it prevents a specific,
non-hypothetical loss:

| # | Check | Why |
|---|---|---|
| **P1** | Source exists, `status = 'lost'`, `user_id = me` | Reassignment is only ever offered from Lost Exercises. Re-checked inside the function too — the client check is for the UI, not for safety. |
| **P2** | Target exists, `status = 'active'`, `id <> source` | Merging into another lost exercise, or into itself, is never meaningful. |
| **P3** | **`db.sync_queue` is empty** (Dexie, client-side only) | A queued `v2_set_logs` upsert carries a literal `exercise_id` (`useSession.ts:692`). Replayed after the source row is hard-deleted, it violates the FK; `useSyncQueue.ts` retries 3× and then **dead-letters, discarding a real logged set permanently**. This is migration 010's exact hazard and reuses its exact gate. Blocks with "you have unsynced sets — reconnect and let them sync first", not a warning. |
| **P4** | No session with `status = 'in_progress'` for this user | A live session can be logging under either exercise while the merge runs. §5.3 step 1's row lock closes the window inside the transaction, but a session that is mid-workout should not be silently renumbered underneath the lifter. |
| **P5** | Counts, for the confirmation copy | §6 needs real numbers, not "some sets". |

P3 and P4 are **blocking**, not advisory. Both have a clear user action
attached, and both describe a state that resolves on its own within
minutes.

### 5.3 The order of operations, and what each step is guarding

Every statement is scoped `user_id = auth.uid()` in addition to RLS; the
predicates are elided below only where noted.

**Step 1 — lock and validate.**

```sql
select id, status into strict … from exercises
 where id in (p_source, p_target) and user_id = auth.uid()
 for update;
```

Assert: both rows found, source `'lost'`, target `'active'`, source ≠
target. Raise otherwise.

The `for update` is **load-bearing, not hygiene**. An `INSERT` into
`v2_set_logs` takes a `FOR KEY SHARE` lock on the referenced `exercises`
row to satisfy the FK, and `FOR KEY SHARE` conflicts with `FOR UPDATE`. So
holding `FOR UPDATE` on the source row for the duration of the function
means **no new set log can be created against the exercise being merged
while the merge runs** — which is what makes step 5's "zero remaining
rows" check a guarantee rather than a snapshot that a second device can
invalidate a millisecond later.

**Step 2 — `v2_program_exercises`, split into the plain case and the
collision case.**

Two sub-cases, and getting the collision case wrong is the single most
destructive mistake available in this whole feature:

*2a — plain re-point.* For each source `v2_program_exercises` row whose
`workout_day_id` has **no** row for the target:

```sql
update v2_program_exercises
   set exercise_id = p_target
 where exercise_id = p_source and user_id = auth.uid()
   and workout_day_id not in (
     select workout_day_id from v2_program_exercises
      where exercise_id = p_target and user_id = auth.uid()
   );
```

Its `v2_week_plan_sets` follow automatically — they key on
`program_exercise_id`, which didn't change (§0.2). Its
`v2_set_logs.week_plan_set_id` links are likewise untouched.

*2b — collision.* Where the same `workout_day_id` already contains the
target, updating in place would leave the day listing the same exercise
twice, in two positions, with two independent planned-set lists. The source
row has to go — but **deleting it first destroys data**: `v2_week_plan_sets
.program_exercise_id` is `on delete cascade`, so every planned set under it
vanishes, and `v2_set_logs.week_plan_set_id` is `on delete set null`, so
every real logged set that pointed at those planned sets is silently
unlinked from its target. Logged history survives, but the planned-vs-actual
linkage — the thing `ExerciseCard.tsx`'s identity matching and
`PlanTargetsPanel` are built on — is gone, with no error anywhere.

Correct order, per colliding pair:

1. Move the source row's `v2_week_plan_sets` onto the surviving row,
   renumbering `set_number` to continue after the survivor's max **within
   each `week_plan_id`** (`set_number` is 1-based per exercise per plan).
   Dropset grouping is by `parent_week_plan_set_id`, so the group structure
   is unaffected by renumbering — but a stage mirrors its head's number, so
   heads and their stages move together (§1, `ExerciseCard.tsx:211`).
2. **Then** delete the source `v2_program_exercises` row. The cascade now
   finds nothing to cascade, and no `week_plan_set_id` is ever nulled.
3. Leave `position` alone. The surviving row keeps its own slot; the day
   simply has one fewer exercise.

**Step 3 — `v2_set_logs`, renumber before re-pointing.**

The step that looks like one `UPDATE` and isn't:

```sql
update v2_set_logs set exercise_id = p_target
 where exercise_id = p_source and user_id = auth.uid();   -- NOT sufficient alone
```

`set_number` is 1-based **per exercise per session**. If any session
contains logs for *both* the source and the target, this produces two set
#1s, two set #2s, and so on, under one exercise in one session. Nothing in
the schema stops it — there is no unique constraint on `(session_id,
exercise_id, set_number)` (§1). What breaks downstream is quiet and
plausible-looking: `groupSetLogs` still groups correctly (it groups by
parent id), but every consumer that sorts or numbers by `set_number` —
`ExerciseCard.tsx`'s display numbering, `positionMatch.ts`'s slot-by-slot
comparison, `historyService.ts`'s ordering, `fetchExerciseSetHistory`'s
total-order requirement that `historyPagination.ts` depends on — gets a
non-deterministic order between the tied rows.

**And this collision is not exotic — the swap-exercise feature makes it the
expected case.** A swap logs the replacement as an extra exercise *in the
same session* as the original (COACH-PERSONALIZATION-TASKS.md §11.3). The
real 2026-08-27 PUSH-2 session is exactly this shape: Chest Press and its
substitute both logged. Reassigning one onto the other — the single most
likely reassignment Adam will ever perform — hits this on the first try.

So, in order:

1. For each session containing **both** source and target logs, compute
   `max(set_number)` over the target's rows in that session.
2. Renumber the source's rows in that session to continue from there,
   **preserving relative order** (`order by set_number, logged_at`) and
   **moving each head and its stages to the same new number**, since a
   stage mirrors its head's `set_number`.
3. Only then `update … set exercise_id = p_target`.

Sessions containing only the source's logs need no renumbering — their
numbering is already valid under the new exercise id.

`parent_set_id`, `stage_index`, `is_warmup`, `week_plan_set_id`,
`form_rating`, `logged_at` and every other column are untouched. The merge
changes which exercise a set belongs to and, where it must, its position
within that session — nothing about the set itself.

**Step 4 — nothing else in the database is touched, and that is a
decision.**

| Table | Action | Why |
|---|---|---|
| `v2_week_plan_sets` | Only in step 2b | No `exercise_id` column (§0.2). |
| `v2_coach_session_analyses` `.content` / `.input_snapshot` | **Untouched** | Frozen provenance. Exercise identity is denormalised into the JSON *specifically so a later rename or archive cannot silently rewrite a permanent written record* (COACH-ANALYSIS-TASKS.md §2). A merge is a bigger rewrite than a rename, and the same reasoning applies with more force. Same asymmetry `prompt_version` and migration 014's tag note already carry. |
| `v2_coach_week_analyses` | **Untouched** | Same, and it has no FK by design (COACH-WEEK-ANALYSIS-TASKS.md §7.7). |
| `v2_coach_notes.body`, `v2_coach_memory_entries.body` | **Untouched** | Free prose that may name the old exercise. Find-and-replacing a lifter's own words to chase a merge is a silent edit of their record — the failure mode this app refuses everywhere else. |
| `v2_history_session_summary`, `v2_exercise_set_history`, `v2_session_type_history` | **Untouched** | Views. They join `exercises` live and follow automatically. |

The consequence, stated rather than buried: **an analysis generated before
a merge keeps describing the pre-merge world.** That is correct — it is
what was true when it was written — but it means a merge introduces a
permanent, visible discontinuity between old analyses and current history.
Worth one line in the confirmation (§6).

**Step 5 — clean up the source row.**

SPEC §3: *"Once a lost exercise's history is fully reassigned (zero
remaining logged sets), it becomes eligible for real deletion the same way
any zero-history exercise is, and gets cleaned up automatically rather than
needing a second explicit delete."*

Re-check, inside the same transaction and under the step-1 lock:

```sql
select count(*) from v2_set_logs
 where exercise_id = p_source and user_id = auth.uid();          -- must be 0
select count(*) from v2_program_exercises
 where exercise_id = p_source and user_id = auth.uid();          -- must be 0
```

Both zero → `delete from exercises where id = p_source and user_id =
auth.uid()`, and return `source_deleted = true`. Either non-zero → leave
the row `lost`, return `source_deleted = false`, and let the UI say so
plainly. Under step 1's lock this second branch should be unreachable;
it exists because "should be unreachable" is not the same as "is", and the
alternative is deleting a row that still owns history.

**Step 6 — write the audit row.**

`v2_exercise_reassignments` (migration 022, §3.4) — decided 2026-08-28,
§11.2. Both names are captured in step 1, before the source row can be
deleted by step 5, and both are written as plain text — `source_exercise_id`
is stored with no FK for exactly that reason (§3.4's header comment). One
insert, using the same counts the function is about to return, so the
persisted record and what the UI shows can never drift apart:

```sql
insert into v2_exercise_reassignments (
  user_id, source_exercise_id, source_exercise_name,
  target_exercise_id, target_exercise_name,
  set_logs_moved, program_exercises_moved, program_exercises_merged,
  plan_sets_moved, source_deleted
) values (
  auth.uid(), p_source, v_source_name,
  p_target, v_target_name,
  v_set_logs_moved, v_program_exercises_moved, v_program_exercises_merged,
  v_plan_sets_moved, v_source_deleted
);
```

Written unconditionally — including on the should-be-unreachable
`source_deleted = false` branch, which is exactly the case where a written
record is most useful, since it's the one where something didn't go as
expected.

### 5.4 What a *partial* reassignment does not mean

SPEC §3 phrases cleanup as conditional on "zero remaining logged sets",
which reads as though a reassignment might move only some of them.

**It never does.** One reassignment moves *all* of the source's logged sets
in one transaction, so the count is always zero afterwards and cleanup
always fires. The conditional in the spec is a safety property, not a
workflow: it is the guard that makes the automatic delete safe, not a
description of a partial mode. There is no per-set or per-session
reassignment in v1, and §9.5 records that as a deliberate scope decision
rather than an omission.

### 5.5 Client-side, after the RPC returns

Not optional, and not obvious — three of these are stale caches that would
otherwise show the pre-merge world until an unrelated event happened to
clear them:

1. **Invalidate the TanStack Query keys that embed exercise identity:**
   `['exercises']` (all variants), `['v2_session']`, `['v2_programExercises']`,
   `['v2_workoutDays']`, `['v2_weekPlan']`, `['v2_allWeekPlans']`,
   `['v2_history']`, `['v2_historyDetail']`, `['v2_exerciseProgress']`,
   `['v2_mesoProgress']`, `['v2_referenceSessions']`, `['v2_lastSetLogs']`,
   `['v2_positionMatchTable']`, `['v2_positionMatchedHeadline']`,
   `['v2_sessionTypeHistory']`. Broad on purpose — a merge changes exercise
   identity across the entire history, so anything holding a set log or a
   program exercise is stale.
2. **Clear and re-prime the three Dexie caches that mirror exercise
   identity** (§1): `db.exercises`, `db.set_logs` (its `exerciseId` index
   and column), and `db.workout_days` (the serialised `exercises` blob,
   which embeds joined exercise objects and would otherwise render a
   deleted exercise's name offline). The existing `offlineCache.ts` priming
   path is the right tool; this is a re-prime, not a new mechanism.
3. **No Dexie version bump.** No index or table changes — only row content.

### 5.6 What this does *not* protect against

Stated rather than implied, in the same spirit as
`seedDefaultExercisesIfEmpty`'s own comment about its residual race:

- **A second device offline at merge time.** P3 only sees *this* browser's
  `sync_queue`. A phone that logged sets offline against the source
  exercise and syncs afterwards will fail its FK and dead-letter, exactly
  as described in P3 — the check narrows the window to one device, it does
  not close it. Accepted, and the same limitation migration 010's own
  queue-empty check already documented for itself.
- **Reassignment is irreversible.** There is no undo, no audit row, and no
  record of which sets came from where afterwards. §11 open question 2 asks
  whether a `v2_exercise_reassignments` provenance row is worth it —
  cheap to add, and the one thing that would make an incorrect merge
  diagnosable after the fact.

---

## 6. The confirmation step

SPEC §3: *"The confirmation step must say plainly what's about to happen —
history merging, treated as one continuous exercise going forward — before
it executes."* SPEC §6: *"Destructive-adjacent actions get real
confirmation, not a casual tap."*

### 6.1 What it must actually say

Six things, and the reason each one is non-negotiable:

1. **Both names, in the direction of the merge.** "Chest Press → Incline
   Smith Press", not "merge these". Direction is the whole decision, and it
   is not recoverable from a symmetric phrasing.
2. **The real count of sets being moved, and the number of sessions they
   span.** Real numbers, from P5, not "all history". "184 sets across 23
   sessions" is the difference between a considered tap and a reflexive
   one, and it is also the reader's only chance to notice that the number
   is far larger or smaller than they expected — the cheapest available
   detector of a wrong-exercise mistake.
3. **The date range.** "From 2026-02-14 to 2026-08-21." A merge that
   reaches back further than the lifter remembers training that movement is
   a wrong-source signal.
4. **That it is permanent and cannot be undone.** Explicitly, in those
   words. SPEC §3 calls it "permanent and irreversible"; the confirmation
   should not soften that.
5. **What "one continuous exercise" actually means going forward**, in
   concrete terms rather than as a phrase: progress charts, e1RM
   comparisons and the reference panel will treat every one of those sets
   as the target exercise, so the two histories become one line.
6. **That the source exercise will then be deleted**, since §5.3 step 5
   fires automatically and the lifter should not discover that afterwards.

Plus, where they apply:

7. **The template consequence, when there is one.** If step 2 will merge
   program-exercise rows, say which workout days are affected and that the
   day will list one exercise where it lists two now. This is the only part
   of a reassignment that changes *future* training rather than past
   records, and it is invisible from the Lost Exercises screen.
8. **The renumbering note, when a session contains both.** If any session
   has logs for both exercises (§5.3 step 3 — the swap-exercise case, i.e.
   the likely case), say so: "3 sessions contain both exercises; their sets
   will be combined in the order they were logged."
9. **The frozen-analysis note** (§5.3 step 4) — one line, only when the
   account has coach analyses that reference the source exercise: existing
   written analyses keep describing it under its old name.

### 6.2 What it must confirm — the interaction

- **Two steps, not one**, reusing `SwapExerciseSheet.tsx`'s exact
  pick-then-confirm shape: choosing a target in the picker must not
  execute. That component already made this call for a strictly *less*
  consequential action ("a real, if easily-undone, side effect worth a
  plain confirmation step") — an irreversible history merge cannot be
  offered on weaker terms than a skip that can be undone by tapping a set.
- **The confirm control is not the primary-styled default.** Everywhere
  else in this app the accent-coloured button on the right is the safe,
  expected action. Here it isn't. Recommendation: the confirm action reads
  `MERGE HISTORY` (not `CONFIRM`, which describes the tap rather than the
  consequence), styled with `--error` rather than `--accent`, with the
  cancel path keeping the neutral treatment.
- **Deliberate friction beyond a tap.** SPEC §3's "not a casual tap" and
  §6's "real confirmation" are asking for more than a second screen. The
  proportionate mechanism, given the target is chosen from a list and a
  mis-tap selects a *plausible* neighbour: **require typing the target
  exercise's name to enable the confirm control.** It forces the reader to
  look at which exercise they picked, which is the exact error this whole
  section exists to catch, and it is a known pattern (GitHub's repository
  delete). **Decided, 2026-08-28 (§11.1)** — the one place in this plan
  where a UX call was made rather than derived, and Adam approved it as
  proposed over the lighter held-press/plain-second-tap alternatives.
- **The blocking preflights surface here, not as a failure after the
  tap.** P3 (unsynced sets) and P4 (session in progress) disable the
  confirm control with their own explanation, so the sheet never presents a
  button that is going to refuse.
- **Both counts come from the same query the RPC will re-derive**, so the
  number shown and the number moved cannot disagree. If they do — a set
  logged between preview and confirm, which P4 makes unlikely and the step-1
  lock makes harmless — the RPC's returned counts are what the success
  message reports, not the preview's.

### 6.3 The delete confirmations, which are a different and lighter thing

Two other confirmations exist in this feature and should **not** borrow
this weight:

- **Deleting a zero-history exercise** — permanent, but there is nothing to
  lose. A standard confirm, one step.
- **Deleting a library** — needs its own preflight breakdown ("12
  exercises: 4 deleted permanently, 8 moved to Lost Exercises") because the
  split is the whole point and is not predictable from the outside. Still
  one step: nothing is destroyed that has history, which is exactly what
  makes it a lighter action than the merge.

---

## 7. Data models

### 7.1 The lifecycle in TypeScript

```
ExerciseStatus = 'active' | 'lost'          // the two stored values
ExerciseLifecycle = ExerciseStatus | 'gone' // all three real states, §0.3
```

`'gone'` is a value the *type* layer can name — for a delete-preview
result, a confirmation payload, an optimistic update — and that the
*column* never holds. Keeping the two types separate is what stops
`'gone'` from leaking into a `where status = …` clause.

### 7.2 Types added

- `Exercise` gains `status: ExerciseStatus`, `sourceLibraryId: string |
  null`, `lostAt: string | null`. `toExercise()` in `exerciseService.ts`
  maps them; `status` coerces a missing value to `'active'` for the same
  reason `toMuscleGroup` coerces null to `'other'` — a row cached by an
  older client, not a real third state.
- `ExerciseLibrary` — `{ id, slug, name, description, isListed, position }`.
- `ExerciseLibraryItem` — `{ id, libraryId, name, muscleGroup,
  muscleSubgroup, movementPattern, position }`.
- `MuscleSubgroup` and `MovementPattern` string-union types in
  `src/lib/exerciseTags.ts` (§2.6), which becomes the single app-side
  source of truth for both vocabularies.
- `ReassignPreview` — `{ setCount, sessionCount, firstDate, lastDate,
  affectedWorkoutDays: string[], overlappingSessionCount,
  frozenAnalysisCount }`. Exactly the fields §6.1 requires, so a missing
  confirmation line is a type error rather than an omission.
- `ReassignResult` — the RPC's return row (§5.1).
- **No TS type for `v2_exercise_reassignments`.** Decided 2026-08-28
  (§11.2) as an audit row written server-side by the RPC function itself,
  not a client insert — nothing in the app ever constructs one. No list UI
  reads the table in v1 either (§3.4), so there is no read-side shape to
  name yet. Add one the day a screen is built to browse it, not before.

### 7.3 `CachedExercise` (Dexie)

Gains `status` and `sourceLibraryId` as **plain fields, not indexes** — the
same no-version-bump precedent `stageIndex`/`isWarmup`/`setSeconds`/
`enteredUnit`/`formRating` already set in `db.ts`. Rows cached before this
ships carry `undefined`; readers treat that as `'active'`/`null`, the same
rule that file already documents for those fields.

---

## 8. Implementation order

Ten steps. Each verified before the next depends on it — the same
discipline every phase in this repo has used.

**1. Read-only diagnostic against production. No code. Done, 2026-08-29 —
see CONTEXT.md's dated session entry for the full account.** Confirmed the
70/46/24 split directly against the live table (unchanged from what
migration 014's comments predicted); found **two more archived rows than
previously recorded** (four, not two — §4.2, corrected in place) and ran
the real `created_at` clustering cross-check (§4.3 — the actual shape,
one 42-row bulk batch on 2026-08-12 plus 4 individually-dated legacy
matches, differs from what was assumed but changes nothing about the
classification); confirmed no pre-existing `status`-like column on
`exercises` (exactly 8 columns today: `id`, `user_id`, `name`,
`muscle_group`, `is_archived`, `created_at`, `muscle_subgroup`,
`movement_pattern` — migration 019 is clear to add `status`,
`source_library_id`, `lost_at` with no collision). Every query scoped
`user_id = '12e79b69-…'` per the standing rule. Nothing written to
production.

**Two follow-up checks, closed out 2026-08-29 (continued session) before
019 was applied — see CONTEXT.md's dated entry.** (a) The seven
near-collision pairs' claimed active counterparts: all four archived-row
pairs confirmed by direct query — each archived row's counterpart exists
and is genuinely non-archived. (b) The clustering cross-check's unnamed
"23 of the 24" outlier: it's **`Incline Smith Press`**
(`2026-07-05 17:15:15.294376+00`) — the only hand-added row not inside
either of 2026-07-03's two tight insertion windows (13:49–13:51 and
21:22–21:26, the latter also holding all 4 individually-stamped legacy
matches); it sits alone, two days later. Both checks corroborate the
existing narrative rather than correcting it.

**2. Migration 019, applied and verified. Done, 2026-08-29 — see
CONTEXT.md's dated session entry for the full account.** All nine of
§3.1's checks passed against production: schema/defaults exactly as
written; `status='active'` on all 70 rows and 0 elsewhere;
`source_library_id`/`lost_at` both null on all 70; indexes and RLS/policy
shape on both new tables exact; the anon-key write-rejection test proved
read-only for real (PostgREST `select` → 200, `insert` → 401/`42501`, not
just read off `pg_policies`); all three `CHECK`s and the FK each proven by
a real violation (`23514` ×3, `23503` ×1), zero rows written by any of
them; `exercises`/`v2_program_exercises`/`v2_set_logs` row counts (70/26/
476) unchanged from the pre-migration baseline.

**3. `EXERCISE-LIBRARY-PROVENANCE.md` generated, reviewed, approved (no
corrections), and migration 020 applied and verified. Done, 2026-08-29 —
see CONTEXT.md's dated session entries for the full account.** The
review file: all 70 rows, read directly from production, grouped by
`muscle_group` per §4.4's shape — 46 `legacy` / 24 `hand-created`, 0
ambiguous, 4 archived, 7 near-collision pairs flagged ⚠, 0 signal
disagreements, cell-by-cell diffed against the live query result after
writing (0 mismatches). Adam reviewed and approved it as-is — the 46/24
split, all four archived-row near-collisions, and the insertion-history
breakdown were independently re-verified row-by-row against the
document's own tables before approval. Migration 020 was then generated
from that approved file (not the classification rule restated in prose)
and applied: all five of §4.5's checks passed — `legacy` count exactly
46, `hand-created` (`source_library_id is null`) exactly 24, `is_listed`
count 0, `status <> 'active'` count 0, `exercises` row count still 70
with a 5-row spot-check confirming `muscle_group`/`muscle_subgroup`/
`movement_pattern` untouched.

**4. `src/lib/exerciseTags.ts` + Vitest. Done, 2026-08-29 — see CONTEXT.md's
dated session entry for the full account.** Pure, no React, no Supabase —
the same precedent as `setGroupLogic.ts` / `e1rm.ts` / `ratingScales.ts`.
Exports `MOVEMENT_PATTERNS`/`MOVEMENT_PATTERN_LABELS` (7 values, reusing
the existing `MovementPattern` type from `types/index.ts` rather than
redefining it) and `MUSCLE_SUBGROUP_GROUPS`/`MUSCLE_SUBGROUPS`/
`MUSCLE_SUBGROUP_LABELS` (22 values grouped into §4.3's six categories),
plus `muscleSubgroupLabel()` for the one case `MuscleSubgroup`'s
deliberate string-not-union looseness requires a safe fallback lookup.
The one test that matters — the seven `movement_pattern` values in TS
match 013's `CHECK` exactly, read from the migration file directly, not
retyped from memory — passes, along with 16 other real Vitest cases (no
duplicates, complete label coverage, the muscle_subgroup grouping matches
§4.3 verbatim, cross-checked against every value migration 014 actually
applied, the unknown-tag fallback degrades instead of throwing). 17/17
new tests pass, 270/270 full suite, both `tsconfig.app.json` and
`tsconfig.api.json` typecheck clean. Step 5 (tag editing UI) intentionally
not started.

**5. Tag editing. Done, 2026-08-29 — see CONTEXT.md's dated session entry
for the full account.** `ExerciseForm.tsx` extended (per-exercise view,
its own muscle-group grid refactored onto the same new shared component
rather than left as a second copy), `ExerciseTagList.tsx` new (list view,
accordion rows, auto-save per tap), a mode toggle on `LibraryPage.tsx`,
`updateExercise`/`useUpdateExercise` extended with the don't-blank-on-omit
rule (§2.6) — live-verified against real production data in both
directions (a subgroup-only edit left the pattern untouched and vice
versa, each confirmed after a genuine full page reload, not just client
cache). **Deliberately first among the UI work**: it is the only part
with no destructive path, it exercises the new vocabulary module against
real data, and it independently closes COACH-WEEK-ANALYSIS-TASKS.md
§7.11's deferral — so it has standalone value even if everything after it
slips.
**Coverage gap closed 2026-08-29 (continued session), before step 6
started** — this step shipped with zero automated tests despite the
don't-blank-on-omit rule's own "one-line mistake with a silent,
data-destroying outcome" framing. `exerciseService.test.ts` (new, mocks
the Supabase client for the first time in this suite) now covers both
directions of the omit-vs-explicit-null contract for `updateExercise`,
plus `createExercise`'s contrasting no-such-distinction behaviour; light
`@testing-library/react` component tests (`jsdom`/`@testing-library/react`
added as dev dependencies, the suite's first) cover `TagChipGrid.tsx`'s
single-/multi-select rendering, that `MuscleSubgroupPicker.tsx` renders
`exerciseTags.ts`'s six categories and 22 tags directly rather than a
hardcoded copy, and that `ExerciseTagList.tsx` auto-saves on a single tap
with no confirm step. See CONTEXT.md's dated session entry.

**6. The library list, preview, and download. Done, 2026-08-29 — see
CONTEXT.md's dated session entry for the full account.** `libraryService.ts`
+ `useLibraries.ts` + `LibraryCatalog.tsx` built; the single Download button
on `LibraryPage.tsx` replaced with a "Libraries" entry point opening the new
catalog sheet. Download reuses `exerciseService.ts`'s name-diff rule and
`navigator.locks` guard for real — both were extracted into shared helpers
(`diffNewByName` in `exerciseService.ts`, `withUserLock` in the new
`src/lib/locks.ts`) rather than copied a second/third time, and
`importDefaultExercises`/`useImportDefaultExercises` (the function this new
flow replaces — SPEC §1's "single button") were deleted rather than left
unreachable. Each download sets `source_library_id` and copies
`muscle_subgroup`/`movement_pattern` across from the library item.
**Verified against a throwaway seeded library** — a temporary, `is_listed`
library plus 4 `v2_exercise_library_items` rows (inserted via the Supabase
SQL Editor, since neither table has an app-side write policy), downloaded
for real through the live dev-server UI against production, confirmed
correct `source_library_id` and copied tags on the resulting `exercises`
rows via a direct SQL join, then the downloaded exercises, the temporary
items, and the temporary library all deleted — `exercises` row count
verified back at 70 afterward. Proving download works against an empty
table would have proven nothing (§2.2). Every mutating step scoped to
Adam's own `user_id`.
**Not done, not asked for:** step 7 (delete + Lost Exercises) not started,
per explicit instruction to stop after step 6.

**7. Delete + Lost Exercises, without reassignment. Done, 2026-08-29 — see
CONTEXT.md's dated session entry for the full account.** The three-state
transition and its preflight (zero-history → hard delete; has-history →
`lost`) **in both directions — including restore (§9.4/§11.4, decided
in scope)**, the Lost Exercises list (with its restore action), and
library delete's split preview. Reassignment is deliberately *not* in this
step: the state machine and the "never destroy history" property are worth
proving on their own, before the one irreversible operation in the feature
is layered on top.
**Found and closed during implementation**: `v2_program_exercises.exercise_id`/
`v2_set_logs.exercise_id` both reference `exercises(id)` with no `ON
DELETE` clause (plain `NO ACTION`, `001_v2_schema.sql`), so a zero-history
exercise still listed in any program's template would make a naive hard
delete fail on the FK. `deleteExercise()`'s hard-delete branch clears
referencing `v2_program_exercises` rows first (§9.3's "blocking the delete
was rejected" reasoning, generalized past its literal reassignment
context); the lost branch deliberately leaves them dangling, matching
§9.3's own "a lost exercise [can have] template rows" reading, so
reassignment's §5.3 step 2 still has real work to do when it eventually
runs. Verified live against a temp exercise deliberately left in a temp
program template — confirmed gone with no FK error, both rows.
**Verified against three constructed throwaway cases** (zero-history
delete while still in a program; has-history delete then restore, history
byte-identical throughout; library-delete split preview against a mixed
temp library) — all against production, none against Adam's real
exercises, all cleaned up and confirmed back to the 70-row baseline
afterward.

**8. Migrations 021 + 022, and reassignment. Done, 2026-08-29 — see
CONTEXT.md's dated session entry for the full account.** The function
(§5.3), `reassignService.ts`, the preview query, cache invalidation and
Dexie re-prime (§5.5) all built. §3.4's audit table (022) applied ahead of
021 as planned, since 021's function body writes to it in step 6.
**Verified against constructed throwaway data only, never against real
history**: two temporary exercises, a temporary program/workout day
containing both (the §5.3 step 2b merge collision) with a planned dropset
under the source and a plain planned set under the target, and a session
logging both (the §5.3 step 3 swap-exercise set_logs collision) — called
through the real deployed RPC via the dev app's own authenticated session
(anon key + the real access token, not the SQL Editor, which has no
`auth.uid()`). Every property verified by direct query: `set_number`
unique per head in both `v2_set_logs` and `v2_week_plan_sets` (a stage
correctly sharing its head's number is not a violation), `parent_set_id`/
`stage_index` and `parent_week_plan_set_id`/`stage_index` preserved
unchanged on both dropset stages, `week_plan_set_id` links preserved,
automatic source-row deletion (`source_deleted = true`), and a matching
`v2_exercise_reassignments` audit row with the right names and counts.
Cleaned up completely afterward, including the audit row — every touched
table back at the exact pre-test baseline. One correction found in this
document during verification: §3.4's own checklist says 13 columns; the
table as specified (here and in the migration) has 12 — an off-by-one in
this prose, not in the schema. Also closed, on top of what this step
originally scoped: step 7's own two gaps (zero test coverage on the
delete/restore/preview logic, and a delete confirm dialog that didn't
disclose the hard-delete path's program-reference clearing) — see
CONTEXT.md for both.
**Not done, not asked for:** the real-data run mentioned below (against
Adam's actual exercise history) — that still needs its own explicit
go-ahead, separately, once Adam has reviewed this step's throwaway
verification.

**9. The confirmation sheet. Done, 2026-08-29 — see CONTEXT.md's dated
session entry for the full account.** `ReassignSheet.tsx` (new) — the
picker reuses `SwapExerciseSheet.tsx`'s pick-or-create shape but, per
§9.6, offers every active exercise (same-muscle-group first) rather than
filtering to one group; the confirm step renders all nine §6.1 items plus
the §9.6 cross-group note, every number sourced from `previewReassign()`'s
real result. `MERGE HISTORY` (`--error`, not `--accent`) stays disabled
until the typed text exactly equals the target's name — case- and
whitespace-sensitive (§6.2/§11.1). **P3/P4 (§5.2) built here for the first
time** — `checkReassignBlockers()` (new) checks `db.sync_queue.count()`
and a live `v2_sessions` `in_progress` count, disabling the control with
its own explanation rather than letting the RPC refuse after the tap.
`LostExercises.tsx` gets the Reassign entry point.
**Verified against constructed throwaway data, never against Adam's real
history**: two throwaway exercises, a program/workout-day collision (§5.3
step 2b) and two sessions — one source-only, one with both exercises
logged (§5.3 step 3's renumbering case) — run through the real deployed
RPC via the actual dev app UI end to end (sign-in, Library → Lost
Exercises → Reassign → pick → typed-name gate proven live via
`button.disabled` → MERGE HISTORY), not a script. Confirmed by direct SQL
afterward: `set_number` unique (`1,2`, not `1,1`) in the shared session,
the collision resolved to one `v2_program_exercises` row, automatic source
deletion, and a matching `v2_exercise_reassignments` audit row. One real
bug found live and fixed: the affected-workout-days/overlapping-session
lines had a hardcoded plural verb, wrong on the (most common) singular
case. Cleaned up completely; every touched count back at its exact
pre-test baseline. `tsconfig.app.json`/`tsconfig.api.json` both clean;
329/329 Vitest passing (21 new cases across three files).
**Not done, not asked for:** step 10 (build, full adversarial review,
deploy) not started, per explicit instruction to stop after step 9.

**10. Verification, adversarial review, deploy, CONTEXT.md.** Typecheck
(both `tsconfig.app.json` and `tsconfig.api.json`), full Vitest, `npm run
build`, live browser verification per CONTEXT.md's hard gate, then an
adversarial review of the diff before anything ships. The dimensions worth
naming for that review, because they are where this feature's real risk
sits: **data loss on the delete/merge paths**, **the collision cases in
§5.3 steps 2b and 3**, **cache staleness after a merge** (§5.5), and
**the confirmation's accuracy** (does every number it shows come from the
same source the RPC acts on).

---

## 9. Assumptions and decisions the spec doesn't cover

### 9.1 "Delete a library" means "delete the exercises I got from it", never the catalog

SPEC §8 lists "preview, download, and delete, per library". Since libraries
are global and shared (§3), a user deleting the global catalog row would
delete it for everyone. Read as: delete *my copies* of that library's
exercises. The catalog row is untouched and the library remains
downloadable afterwards. This is why `v2_exercise_libraries` has no write
policy at all (§3.1) — the app is structurally incapable of the other
reading.

### 9.2 A library delete acts on `source_library_id`, and inherits every per-exercise rule

It is a bulk version of the single delete, not a separate mechanism: each
affected exercise independently either hard-deletes (zero history) or moves
to `lost`. The preview must show the split *before* confirming (§6.3),
because it is not predictable from outside.

**An exercise whose provenance was later overwritten is not caught.** If
Adam edits a downloaded exercise heavily, it keeps its `source_library_id`
and a library delete will still act on it. Correct — provenance records
where it came from, not how much it has changed since — but worth stating,
because the alternative (drop provenance on edit) is a plausible-sounding
rule that would quietly make libraries undeletable.

### 9.3 Deleting an exercise that is still in a program is allowed, with its consequences shown

The alternative — block the delete while any `v2_program_exercises` row
references it — is simpler and was seriously considered, since it would
mean a lost exercise never has template rows and §5.3 step 2 could be
deleted entirely. Rejected because it makes removing an old exercise from
an old, completed program impossible without first editing that program,
and because SPEC §5 explicitly says program exercises get re-pointed.

Instead: **allowed, with the affected workout days named in the
confirmation** (§6.1 item 7). Removing a program exercise removes the
exercise from the *template*; the week-plan sets under it cascade away, and
the logged history is exactly what Lost Exercises preserves.

### 9.4 An exercise can be restored from Lost without reassignment

Not in the spec, and a one-line addition: `status` back to `'active'`,
`lost_at` back to `null`. Without it, an accidental delete of a
20-session exercise has exactly one exit — an irreversible merge onto
something else. Including it makes the *reversible* mistake reversible and
leaves the confirmation weight where it belongs, on the merge. **Decided,
2026-08-28 (§11.4) — included in v1 scope**, on top of what §8's
implementation order already lists.

### 9.5 There is no partial reassignment in v1

One reassignment moves the source's entire history (§5.4). No per-set,
per-session, or per-date-range mode. Splitting one exercise's history
across two targets is a real scenario (a name reused for two different
movements over time) and a genuinely different feature — it needs
selection UI, and it breaks the automatic-cleanup rule that makes this
version's flow simple. Deferred, not overlooked.

### 9.6 Reassignment does not require matching muscle groups

`SwapExerciseSheet.tsx` filters candidates to the same `muscleGroup`,
because a same-session substitution is nearly always same-muscle. A merge
is not: a renamed or re-equipped exercise can legitimately have been filed
under a different group. The picker therefore offers **all** active
exercises, with same-muscle-group ones surfaced first, and a cross-group
target adds a line to the confirmation rather than being blocked.

### 9.7 Downloading does not re-tag or overwrite an existing exercise

If a library item's name matches an exercise the user already has, it is
skipped — the exact rule `importDefaultExercises` already applies — even if
the existing row is untagged and the library item has tags. Overwriting
would silently discard hand-made corrections, which is the one thing §2.6's
whole tag-editing screen exists to make possible. The skip is reported in
the download's toast, as it already is today.

### 9.8 The cross-app assumption on `exercises` is inherited, not resolved

Adding three columns to a table Northstar v2 also writes is the same
cross-app change COACH-WEEK-ANALYSIS-TASKS.md §7.13 accepted for migration
013, with one difference worth naming: `status` is `NOT NULL DEFAULT`,
where 013's columns were purely nullable. The assessment: metadata-only on
PG11+, Northstar's inserts get the correct value automatically, a
`select *` → re-upsert round-trip is harmless, and a generated-types file
in that repo goes stale at build time rather than breaking at runtime.
**This is an assumption, not a verified fact** — Northstar's source is not
in this repo and was not read. It also adds one genuinely new coupling:
`exercises.source_library_id` is the first FK from the shared table into a
`v2_`-namespaced one, which means `v2_exercise_libraries` can no longer be
dropped without considering `exercises`. Recorded against CONTEXT.md's
"Standing architectural risk" entry rather than resolved here.

### 9.9 This feature is ungated, and needs no `coachGate.ts` call

SPEC §2/§4 are explicit, and the reasoning matches
COACH-PERSONALIZATION-SPEC.md §7's gating principle exactly: does this have
standalone value to an account that will never have Coach access? Library
management and tag editing both do. **No `coachGate.ts` call site is added
anywhere.** Worth stating because tags were introduced by a Coach feature
and the instinct to gate them is available but wrong.

### 9.10 Tag edits apply prospectively only

Editing `muscle_subgroup`/`movement_pattern` does not retroactively change
any existing `v2_coach_week_analyses` row — its `input_snapshot` is frozen
with whatever tag was live at generation time. Unchanged from migration
014's own note; restated because a tag-editing UI makes the asymmetry
reachable in one tap for the first time, where before it required a
hand-written migration.

---

## 10. New files, at a glance

```
supabase/migrations/019_v3_exercise_libraries.sql
supabase/migrations/020_v3_exercise_legacy_provenance.sql   (after review)
supabase/migrations/022_v3_exercise_reassignments.sql       (applied before 021 — see §3)
supabase/migrations/021_v3_reassign_exercise_fn.sql

EXERCISE-LIBRARY-PROVENANCE.md          (the §4.4 review artefact)

src/lib/exerciseTags.ts                 + exerciseTags.test.ts
src/features/library/libraryService.ts
src/features/library/useLibraries.ts
src/features/library/LibraryCatalog.tsx        (list + preview + download)
src/features/library/LibraryPreview.tsx
src/features/library/ExerciseTagList.tsx       (list-mode tag editing)
src/features/library/LostExercises.tsx
src/features/library/ReassignSheet.tsx         (picker + §6 confirmation)
src/features/library/reassignService.ts
```

**Modified:** `exerciseService.ts` (status/provenance on read; delete;
lost/restore; the tag-safe `updateExercise`), `useExercises.ts` (the
matching hooks), `LibraryPage.tsx` (the single Download button is replaced;
list/detail mode toggle; a Lost Exercises entry point), `ExerciseForm.tsx`
(tag fields), `types/index.ts`, `db.ts` (two plain fields on
`CachedExercise`, no version bump), `offlineCache.ts` (re-prime after a
merge).

**Deliberately unchanged:** `SwapExerciseSheet.tsx`, `setGroupLogic.ts`,
`positionMatch.ts`, `e1rm.ts`, `referenceLogic.ts`, every `api/coach/*`
function, and all three history views. Reassignment changes which exercise
a set belongs to, not the shape of a set — nothing that reasons about sets
needs to know it happened.

---

## 11. Decisions — locked in 2026-08-28

Four questions this plan raised without resolving. All four settled the
same day, all four approved exactly as recommended, with no changes to
what was proposed. Recorded here in the same form they were asked, each
now marked with its outcome and what changes as a result; kept as its own
section (rather than folded silently into §§2/6/9 and deleted) so the
record of *what was asked and decided*, not just the final shape, survives
in the document — the same reasoning COACH-PERSONALIZATION-SPEC.md §11
keeps a dated "what changed" section instead of quietly rewriting §4/§6 in
place.

### 11.1 The reassignment confirmation's friction level — **decided: type-the-name, as proposed**

Was: type-the-target-name to enable the confirm control, versus the
lighter held-press or plain-second-tap alternatives (§6.2). **Approved as
proposed.** §6.2 is updated in place to state this as decided rather than
as the one open UX call in the plan. No further change needed elsewhere —
§6.2's mechanism description was already written to the approved shape.

### 11.2 An audit row for reassignment — **decided: yes, migration 022**

Was: whether a `v2_exercise_reassignments` table (source/target identity,
counts moved, timestamp) is worth a fourth migration's scope to make an
incorrect merge diagnosable after the fact, given the precedent
`v2_coach_curation_runs` already set for exactly this kind of provenance
(COACH-PERSONALIZATION-TASKS.md §7.6). **Approved as proposed.**

This is the one decision with real follow-on work in this document, since
approving it means the table has to actually be specified, not just
agreed to in principle:

- **§3.4** — the new migration, in full, with its own verification block.
- **§5.1 / §5.3 step 6** — the reassignment function writes one row to it,
  as its last statement, inside the same transaction as the merge —
  including on the should-be-unreachable `source_deleted = false` branch,
  which is exactly the case a written record is most useful for.
- **§7.2** — explicitly **no** TypeScript type yet: the row is written
  server-side by the function itself, and no v1 screen reads the table
  back. A type gets added the day a screen is built to browse it.
- **§8 step 8** — the throwaway-data verification pass now also asserts a
  matching audit row (right counts, right names, `source_deleted = true`)
  before real data is touched.
- **§10** — 022 added to the new-files list, applied ahead of 021 since
  021's body writes to it.

Deliberately **not** added: a list screen to browse past reassignments.
Approved scope was the row existing and being queryable directly, not a
UI for it — the same distinction `v2_coach_curation_runs` itself draws
(a real permanent record, with its own "Update Memory" UI-visibility
decided separately and later).

### 11.3 Whether `is_archived` survives alongside `status` — **decided: yes, no consolidation in v1**

Was: whether archive and Lost, now overlapping in the UI, should be
consolidated into one concept given the shared column's blast radius, or
left orthogonal as originally designed (§2.3). **Approved as proposed —
kept orthogonal, nothing consolidated.** This is the one decision that
requires no document changes elsewhere: §2.3's design already implements
orthogonality (`is_archived` untouched; `status = 'lost'` excludes a row
from every selectable list regardless of `is_archived`'s value), and §11.3
now records that this was reviewed and confirmed rather than merely
assumed by the plan that proposed it. The three-state filtering logic
(`active`, `active + archived`, `lost`) §11's original phrasing flagged as
a cost stands as designed, not as an open trade-off — a future
consolidation, if it ever happens, is a separate product decision against
a shipped feature, not a precondition for shipping this one.

### 11.4 Restore-from-Lost — **decided: included in v1**

Was: whether §9.4's one-line addition (an exercise can move back from
`lost` to `active` with no reassignment, clearing `lost_at`) ships as part
of v1 despite sitting outside the spec's four stated success criteria.
**Approved as proposed — included.** §9.4 is updated in place to record
this as decided rather than as a recommendation awaiting a yes. §8's
implementation order already scoped restore alongside delete/Lost in step
7 (the state-machine step, built before reassignment); no reordering
needed, since that step already covered both directions of the
active/lost transition — it now also has explicit standing to do so.

---

*This document is the technical plan for EXERCISE-LIBRARY-SPEC.md v1.
Nothing in it is built. Awaiting review.*
