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
