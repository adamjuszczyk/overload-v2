-- Overload Planner Extension, phase 1 — priority marks: map the existing
-- four-level priorities onto the new form (chunk 10: TASKS.md "Priorities:
-- focus / don't care" / SPEC.md "Priorities migration").
--
-- Inserts into v2_program_priorities (027) only, plus this file's own new
-- manifest table. No existing row in any table is changed — the old
-- v2_coach_meso_tag_priorities (024) is read, never written. Not
-- destructive: check-migration flags this file (the DO block and the
-- closing notify match no safe-list pattern, same reason 028/029/030's own
-- DO blocks and notifies are flagged — see each of their headers), same as
-- "insert into an existing table" would on its own; expected, not a sign of
-- a data-changing migration — every statement here either creates a new,
-- currently-empty object, or inserts a row that cannot collide with one any
-- other code path has ever written (v2_program_priorities' only writers
-- before this chunk's code deploys are v2_copy_program's own priority-row
-- copy loop (028) and, from here on, this file).
--
-- ─── The mapping (SPEC "Priorities migration") ─────────────────────────────
-- For every row of v2_coach_meso_tag_priorities whose mesocycle is
-- currently status = 'active' (every user's active run — not Adam-specific;
-- the join below carries no user_id literal):
--   top  -> focus
--   low  -> dont_care
--   normal, high -> no row (SPEC's "two middle levels")
-- Each mapped mark is inserted twice: once at v2_mesocycles.program_id (the
-- active run's own copy of its program) and, when the meso has one (null
-- for a run that predates 028's transition and hasn't been through
-- v2_start_run since — "a meso with no source_program_id... without
-- error"), again at v2_mesocycles.source_program_id (the saved program
-- cloned from it, 028's transition / v2_start_run). A user with no active
-- run contributes zero rows to the join, not an error.
--
-- Idempotent: on conflict (user_id, program_id, tag_type, tag_value) do
-- nothing — the same unique index 027 already gives v2_program_priorities.
-- A second run (e.g. Adam's own re-run right after the code deploys,
-- mirroring 029/030's "Adam re-runs the backfill" posture, in case the old
-- client wrote a new top/low row in the gap between this migration going
-- live and chunk 10's code deploying — CONTEXT.md's migration-first-then-
-- code-after order) finds every row already present and inserts 0.
--
-- Manifest (v2_program_priorities_mapping_manifest) records the id of every
-- v2_program_priorities row THIS RUN of the DO block actually inserted (via
-- `returning id into v_new_id`, null exactly when ON CONFLICT DO NOTHING
-- skipped a candidate) — the same "RETURNING + null check" shape 029/030
-- use for the same reason: a re-query of "every row that matches the
-- mapping's shape" would also catch a real focus/dont_care mark the new
-- editor (PrioritiesEditor.tsx) writes after deploy, and so would not be
-- safe for a rollback to delete. Standard RLS.
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
--   delete from v2_program_priorities
--     where id in (select priority_id from v2_program_priorities_mapping_manifest);
--   drop table v2_program_priorities_mapping_manifest;
-- Removes only rows THIS migration (across every run of it) inserted — a
-- mark the new editor writes after deploy is never in the manifest and so
-- is never touched either way. Safe at any time: this file never updates or
-- deletes an existing row anywhere, so re-pointing nothing is ever required
-- the way a replaced function would need it.

-- ═══ v2_program_priorities_mapping_manifest ═════════════════════════════════

create table v2_program_priorities_mapping_manifest (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  priority_id  uuid not null references v2_program_priorities(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table v2_program_priorities_mapping_manifest enable row level security;
create policy "Users access own rows" on v2_program_priorities_mapping_manifest
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index v2_program_priorities_mapping_manifest_priority_idx
  on v2_program_priorities_mapping_manifest(priority_id);

-- ═══ The mapping ═════════════════════════════════════════════════════════════

do $$
declare
  v_candidate   record;
  v_new_id      uuid;
  v_mark        text;
begin
  for v_candidate in
    select t.user_id        as user_id,
           t.tag_type       as tag_type,
           t.tag_value      as tag_value,
           t.priority       as priority,
           m.id             as mesocycle_id,
           m.program_id     as run_program_id,
           m.source_program_id as saved_program_id
      from v2_coach_meso_tag_priorities t
      join v2_mesocycles m on m.id = t.mesocycle_id and m.user_id = t.user_id
     where m.status = 'active'
       and t.priority in ('top', 'low')
     order by t.user_id, m.id, t.tag_type, t.tag_value
  loop
    v_mark := case v_candidate.priority when 'top' then 'focus' when 'low' then 'dont_care' end;

    -- The active run's own copy — v2_mesocycles.program_id, always present.
    v_new_id := null;
    insert into v2_program_priorities (user_id, program_id, tag_type, tag_value, mark)
    values (v_candidate.user_id, v_candidate.run_program_id, v_candidate.tag_type, v_candidate.tag_value, v_mark)
    on conflict (user_id, program_id, tag_type, tag_value) do nothing
    returning id into v_new_id;
    if v_new_id is not null then
      insert into v2_program_priorities_mapping_manifest (user_id, priority_id)
      values (v_candidate.user_id, v_new_id);
    end if;

    -- The saved program cloned from it — v2_mesocycles.source_program_id.
    -- Skipped, not erred, when null (see header).
    if v_candidate.saved_program_id is not null then
      v_new_id := null;
      insert into v2_program_priorities (user_id, program_id, tag_type, tag_value, mark)
      values (v_candidate.user_id, v_candidate.saved_program_id, v_candidate.tag_type, v_candidate.tag_value, v_mark)
      on conflict (user_id, program_id, tag_type, tag_value) do nothing
      returning id into v_new_id;
      if v_new_id is not null then
        insert into v2_program_priorities_mapping_manifest (user_id, priority_id)
        values (v_candidate.user_id, v_new_id);
      end if;
    end if;
  end loop;
end;
$$;

-- Make PostgREST pick up the new table (kept for parity with every other
-- migration that writes through this table, same posture as 030's own
-- trailing notify — harmless if there is nothing new for it to pick up).
notify pgrst, 'reload schema';
