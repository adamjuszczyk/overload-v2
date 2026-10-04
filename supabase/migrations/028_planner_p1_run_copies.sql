-- Overload Planner Extension, phase 1 — a run owns a copy of its program
-- (chunk 6: TASKS.md "A run owns a copy of its program" / SPEC.md "Programs
-- and runs and runs").
--
-- Two new functions (CREATE FUNCTION is not on check-migration's safe list —
-- flagged, this merge is Adam's) plus a one-time data transition that
-- rewrites existing v2_programs / v2_mesocycles / v2_workout_days rows (also
-- flagged: several top-level UPDATEs — there is no UPDATE on the safe list
-- at all, so every one of them is flagged individually).
--
-- ─── v2_copy_program(p_source_program_id, p_user_id, p_new_kind, p_new_name) ──
-- The shared deep-copy helper both v2_start_run (below) and this file's own
-- transition use — see "The transition" below for why the transition cannot
-- call v2_start_run itself. SECURITY INVOKER, but every statement inside it
-- filters explicitly by the p_user_id argument (never auth.uid()), not RLS
-- alone: called from v2_start_run it runs as the authenticated caller (RLS
-- applies too; the explicit filter is defence-in-depth, matching 021's
-- reassign_exercise_history posture); called from this file's transition DO
-- block it runs as the migration role, which owns every table and so
-- bypasses RLS entirely — there the explicit filter is the ONLY thing
-- scoping it to the right user's rows. Mechanical only: no business rule
-- (e.g. "source must be kind = 'saved'") lives here, since the two callers
-- need different rules (v2_start_run refuses a non-saved source; the
-- transition's source is, at the moment it is copied, still kind = 'saved' —
-- the flip to 'run' happens after, in this same file, below).
--
-- Builds the copy inside four session-scoped temp tables that map each
-- copied row's old id to its new one (workout days, superset blocks,
-- program exercises, program sets) — needed because none of those four
-- tables carries a lineage column back to the row it was copied from (unlike
-- v2_workout_days.source_workout_day_id, which already does, and is used
-- directly instead of a fifth map). Session-scoped and ON COMMIT DROP: safe
-- both for a single v2_start_run call (its own implicit transaction) and for
-- this file's transition, which calls the helper many times inside one
-- transaction (cleared at the top of every call, dropped once at commit).
--
-- ─── v2_start_run(p_program_id, p_name, p_start_date) returns uuid ────────────
-- (the new mesocycle id). SECURITY INVOKER (RLS applies; precedent: 021's
-- reassign_exercise_history). Runs in one transaction under a per-user
-- advisory lock (pg_advisory_xact_lock, keyed on auth.uid()) that closes the
-- race TASKS.md documents in today's app-layer completeAllActiveMesos +
-- createMeso (two requests, no transaction — scratch R8 proves two
-- concurrent starts leave two active runs without the lock, exactly one with
-- it). Refuses a program that isn't the caller's kind = 'saved' program
-- (RLS already hides another user's program entirely; the kind check is the
-- extra refusal for the caller's own non-saved — i.e. already a run's copy —
-- programs). Completes every active mesocycle of the caller first,
-- end_date = p_start_date rather than a freshly-read current_date: mirrors
-- completeAllActiveMesos's end_date = "today" exactly, since the app's one
-- call site (useCreateMeso) always computes p_start_date as today and passes
-- that same value as both the old mesos' end and the new one's start — using
-- the parameter keeps that boundary consistent even if a future caller ever
-- backdates p_start_date, instead of silently reading a different "now" than
-- the one the new run actually starts on. Then deep-copies the saved program
-- (v2_copy_program) and inserts the new mesocycle with program_id = the
-- copy, source_program_id = the saved program.
--
-- ─── v2_run_transition_manifest ───────────────────────────────────────────────
-- Standard RLS (for all using/with check (user_id = auth.uid())). Records,
-- for every (saved → run) transition this file makes, which new program is
-- the clone of which original — the only way a rollback can find the clones
-- afterwards (their ids are freshly generated; nothing else names them). Not
-- read by the app, so it does not go into verify-rls.mjs's TABLES.
--
-- ─── The transition (SPEC "Programs and runs": "every program a run already
-- points at becomes that run's copy (no existing ids change), and a saved
-- program is cloned from it to be the reusable template") ──────────────────
-- For each program any v2_mesocycles.program_id references (live: 3 — L5;
-- scratch R6: 3, one per meso-using program, one more program untouched):
--   1. v2_copy_program(...) clones it (kind = 'saved') — a full deep copy,
--      field-by-field identical to the original except id/kind/lineage.
--   2. The clone's own workouts, as v2_copy_program always records lineage,
--      point source_workout_day_id at the ORIGINAL's matching workout (copy
--      → source) — backwards from what a saved template should carry, so:
--   3. uses that reverse pointer as the join key to set the ORIGINAL's own
--      workouts' source_workout_day_id at the CLONE's matching workout
--      (lineage now reads run → saved, exactly as for a run started from
--      here on), and
--   4. clears source_workout_day_id back off the clone's workouts — a saved
--      program is the origin, not a copy of anything, so it carries no
--      lineage of its own.
--   5. The original's kind flips to 'run' — no id changes anywhere above
--      this line; it keeps being exactly the row every existing session,
--      week plan and log already points at.
--   6. Every mesocycle that pointed at the original gets source_program_id =
--      the clone.
-- A program no mesocycle uses is never touched (it never appears in the set
-- above) — stays kind = 'saved', byte-identical, same id.
--
-- Because this rewrite runs over every user's data in one migration, in a
-- context with no authenticated caller, auth.uid() is NULL throughout it —
-- it cannot call v2_start_run (which requires one, and would also wrongly
-- complete/create mesocycles as a side effect of a function meant for a
-- single user's own "start a run" action). It calls v2_copy_program
-- directly instead, once per affected program, passing that program's own
-- user_id explicitly — the first of the two options TASKS.md allows
-- ("factor the deep copy into a helper both can use, or write the
-- transition explicitly"); this file does the former.
--
-- ─── Rollback (by hand — this file does not run it) ───────────────────────────
-- Undoes the TRANSITION only. A run genuinely started through v2_start_run
-- after this migration deployed is real user data, not part of this, and is
-- not touched by any of the following:
--   1. delete from v2_programs where id in
--        (select clone_program_id from v2_run_transition_manifest);
--      -- cascades the clone's own workouts / exercises / sets / blocks /
--      -- sequence items / warmup items / priorities, and auto-nulls every
--      -- mesocycle's source_program_id that pointed at it (027's
--      -- v2_mesocycles.source_program_id is on delete set null).
--   2. update v2_programs set kind = 'saved'
--        where id in (select original_program_id from v2_run_transition_manifest);
--   3. update v2_workout_days set source_workout_day_id = null
--        where program_id in (select original_program_id from v2_run_transition_manifest);
--   4. delete from v2_run_transition_manifest;
-- Dropping v2_start_run / v2_copy_program / v2_run_transition_manifest
-- themselves (drop function v2_start_run(uuid,text,date); drop function
-- v2_copy_program(uuid,uuid,text,text); drop table v2_run_transition_manifest;)
-- only makes sense before any real run has ever been started through them —
-- after that it would strand real mesocycles whose program_id /
-- source_program_id this build is the only thing that ever set.

-- ═══ v2_run_transition_manifest ════════════════════════════════════════════

create table v2_run_transition_manifest (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  original_program_id  uuid not null references v2_programs(id) on delete cascade,
  clone_program_id     uuid not null references v2_programs(id) on delete cascade,
  created_at           timestamptz not null default now()
);

alter table v2_run_transition_manifest enable row level security;
create policy "Users access own rows" on v2_run_transition_manifest
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index v2_run_transition_manifest_original_idx
  on v2_run_transition_manifest(original_program_id);
create index v2_run_transition_manifest_clone_idx
  on v2_run_transition_manifest(clone_program_id);

-- ═══ v2_copy_program — shared deep-copy helper ═════════════════════════════

create or replace function v2_copy_program(
  p_source_program_id uuid,
  p_user_id            uuid,
  p_new_kind           text,
  p_new_name           text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src_program       v2_programs%rowtype;
  v_new_program_id    uuid := gen_random_uuid();

  v_wd                v2_workout_days%rowtype;
  v_new_wd_id         uuid;
  v_block             v2_program_superset_blocks%rowtype;
  v_new_block_id      uuid;
  v_pe                v2_program_exercises%rowtype;
  v_new_pe_id         uuid;
  v_ps                v2_program_sets%rowtype;
  v_new_ps_id         uuid;
  v_seq               v2_program_sequence_items%rowtype;
  v_wi                v2_workout_warmup_items%rowtype;
  v_pr                v2_program_priorities%rowtype;

  v_new_schedule      jsonb := '{}'::jsonb;
  v_dow               text;
begin
  select * into v_src_program
    from v2_programs
   where id = p_source_program_id and user_id = p_user_id;
  if not found then
    raise exception 'v2_copy_program: source program % not found for user %', p_source_program_id, p_user_id;
  end if;

  -- Scratch id maps for this call. Session-scoped (not transaction-scoped),
  -- so a call made later in the SAME transaction (the transition's loop)
  -- reuses the already-created table rather than failing on a duplicate
  -- CREATE — cleared explicitly below instead, and dropped for good at
  -- COMMIT (ON COMMIT DROP), whether that commit is this function's own
  -- caller's single-statement transaction or the migration's.
  create temp table if not exists tmp_v2_copy_program_wd_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table if not exists tmp_v2_copy_program_block_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table if not exists tmp_v2_copy_program_pe_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table if not exists tmp_v2_copy_program_ps_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;
  delete from tmp_v2_copy_program_wd_map;
  delete from tmp_v2_copy_program_block_map;
  delete from tmp_v2_copy_program_pe_map;
  delete from tmp_v2_copy_program_ps_map;

  -- The program row itself. schedule starts '{}' and is remapped to the
  -- copy's own workout ids once they exist, at the end of this function.
  insert into v2_programs (id, user_id, name, schedule, kind, schedule_type, planning_type, deload_rules)
  values (
    v_new_program_id, p_user_id, coalesce(p_new_name, v_src_program.name), '{}'::jsonb,
    p_new_kind, v_src_program.schedule_type, v_src_program.planning_type, v_src_program.deload_rules
  );

  -- Workouts — source_workout_day_id always records copy → source, the
  -- standing meaning of that column (027). ordered by position so the copy
  -- keeps the source's order (not load-bearing for correctness, only for a
  -- stable, readable result).
  for v_wd in
    select * from v2_workout_days
     where program_id = p_source_program_id and user_id = p_user_id
     order by position
  loop
    v_new_wd_id := gen_random_uuid();
    insert into v2_workout_days (id, program_id, user_id, name, position, source_workout_day_id)
    values (v_new_wd_id, v_new_program_id, p_user_id, v_wd.name, v_wd.position, v_wd.id);
    insert into tmp_v2_copy_program_wd_map (old_id, new_id) values (v_wd.id, v_new_wd_id);
  end loop;

  -- Superset blocks (need the workout map above).
  for v_block in
    select b.* from v2_program_superset_blocks b
    join v2_workout_days wd on wd.id = b.workout_day_id
    where wd.program_id = p_source_program_id and b.user_id = p_user_id
  loop
    v_new_block_id := gen_random_uuid();
    insert into v2_program_superset_blocks
      (id, user_id, workout_day_id, rest_within_round_seconds, rest_after_round_seconds)
    select v_new_block_id, p_user_id, m.new_id, v_block.rest_within_round_seconds, v_block.rest_after_round_seconds
    from tmp_v2_copy_program_wd_map m where m.old_id = v_block.workout_day_id;
    insert into tmp_v2_copy_program_block_map (old_id, new_id) values (v_block.id, v_new_block_id);
  end loop;

  -- Program exercises (need the workout map and the block map). Copies
  -- target_reps, weight_unit and the design fields (rest_seconds,
  -- rest_after_seconds, tempo) verbatim, and week_only/removed_at verbatim
  -- too — "run copies only" columns that should read false/null on any real
  -- saved-program source, but a true field-by-field copy (never a forced
  -- reset) is what R6 requires of the transition's clone.
  for v_pe in
    select pe.* from v2_program_exercises pe
    join v2_workout_days wd on wd.id = pe.workout_day_id
    where wd.program_id = p_source_program_id and pe.user_id = p_user_id
    order by pe.position
  loop
    v_new_pe_id := gen_random_uuid();
    insert into v2_program_exercises (
      id, workout_day_id, user_id, exercise_id, position, target_reps, weight_unit,
      superset_block_id, rest_seconds, rest_after_seconds, tempo, week_only, removed_at
    )
    select
      v_new_pe_id, wdm.new_id, p_user_id, v_pe.exercise_id, v_pe.position, v_pe.target_reps, v_pe.weight_unit,
      bm.new_id, v_pe.rest_seconds, v_pe.rest_after_seconds, v_pe.tempo, v_pe.week_only, v_pe.removed_at
    from tmp_v2_copy_program_wd_map wdm
    left join tmp_v2_copy_program_block_map bm on bm.old_id = v_pe.superset_block_id
    where wdm.old_id = v_pe.workout_day_id;
    insert into tmp_v2_copy_program_pe_map (old_id, new_id) values (v_pe.id, v_new_pe_id);
  end loop;

  -- Program sets — heads (parent_program_set_id is null) before stages, so
  -- a stage's parent is already in the map when the stage itself is copied.
  -- "false" (not a stage) sorts before "true" in Postgres's default boolean
  -- ordering, which is all the order by below relies on; position/stage_index
  -- after that are cosmetic (R6 compares the copy field-by-field, not by
  -- re-derived order).
  for v_ps in
    select ps.* from v2_program_sets ps
    join v2_program_exercises pe on pe.id = ps.program_exercise_id
    join v2_workout_days wd on wd.id = pe.workout_day_id
    where wd.program_id = p_source_program_id and ps.user_id = p_user_id
    order by (ps.parent_program_set_id is not null), ps.position, ps.stage_index
  loop
    v_new_ps_id := gen_random_uuid();
    insert into v2_program_sets (
      id, user_id, program_exercise_id, position, is_warmup, stage_kind, stage_rest_seconds,
      parent_program_set_id, stage_index, rep_min, rep_max, is_amrap, rest_seconds
    )
    select
      v_new_ps_id, p_user_id, pem.new_id, v_ps.position, v_ps.is_warmup, v_ps.stage_kind, v_ps.stage_rest_seconds,
      psm.new_id, v_ps.stage_index, v_ps.rep_min, v_ps.rep_max, v_ps.is_amrap, v_ps.rest_seconds
    from tmp_v2_copy_program_pe_map pem
    left join tmp_v2_copy_program_ps_map psm on psm.old_id = v_ps.parent_program_set_id
    where pem.old_id = v_ps.program_exercise_id;
    insert into tmp_v2_copy_program_ps_map (old_id, new_id) values (v_ps.id, v_new_ps_id);
  end loop;

  -- Sequence items — position is the slot identity (SPEC: one workout may
  -- appear more than once), workout_day_id null = a rest day and stays null
  -- (the scalar subquery below returns null both when there is no match and
  -- when v_seq.workout_day_id itself is null).
  for v_seq in
    select * from v2_program_sequence_items
     where program_id = p_source_program_id and user_id = p_user_id
     order by position
  loop
    insert into v2_program_sequence_items (id, user_id, program_id, position, workout_day_id)
    values (
      gen_random_uuid(), p_user_id, v_new_program_id, v_seq.position,
      (select new_id from tmp_v2_copy_program_wd_map where old_id = v_seq.workout_day_id)
    );
  end loop;

  -- Warmup items.
  for v_wi in
    select wi.* from v2_workout_warmup_items wi
    join v2_workout_days wd on wd.id = wi.workout_day_id
    where wd.program_id = p_source_program_id and wi.user_id = p_user_id
    order by wi.position
  loop
    insert into v2_workout_warmup_items (id, user_id, workout_day_id, position, body)
    select gen_random_uuid(), p_user_id, m.new_id, v_wi.position, v_wi.body
    from tmp_v2_copy_program_wd_map m where m.old_id = v_wi.workout_day_id;
  end loop;

  -- Priority marks.
  for v_pr in
    select * from v2_program_priorities where program_id = p_source_program_id and user_id = p_user_id
  loop
    insert into v2_program_priorities (id, user_id, program_id, tag_type, tag_value, mark)
    values (gen_random_uuid(), p_user_id, v_new_program_id, v_pr.tag_type, v_pr.tag_value, v_pr.mark);
  end loop;

  -- schedule jsonb, remapped to the copy's own workout ids. jsonb_object_keys
  -- of '{}' yields no rows, so a sequence program (empty schedule) leaves
  -- v_new_schedule at '{}' — unchanged from the init above.
  for v_dow in select jsonb_object_keys(v_src_program.schedule)
  loop
    v_new_schedule := v_new_schedule || jsonb_build_object(
      v_dow,
      (select new_id from tmp_v2_copy_program_wd_map
        where old_id = (v_src_program.schedule ->> v_dow)::uuid)
    );
  end loop;
  update v2_programs set schedule = v_new_schedule where id = v_new_program_id;

  return v_new_program_id;
end;
$$;

grant execute on function v2_copy_program(uuid, uuid, text, text) to authenticated;

-- ═══ v2_start_run ═══════════════════════════════════════════════════════════

create or replace function v2_start_run(
  p_program_id   uuid,
  p_name         text,
  p_start_date   date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id         uuid := auth.uid();
  v_kind            text;
  v_new_program_id  uuid;
  v_meso_id         uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'v2_start_run: no authenticated user';
  end if;

  -- Per-user advisory lock for the whole transaction, taken before any read
  -- of mesocycle state — the one thing that makes R8's concurrent-start race
  -- impossible instead of merely unlikely. Released automatically at
  -- transaction end (pg_advisory_xact_lock; cannot be released early).
  -- hashtextextended turns the uuid into the bigint key the lock function
  -- needs; a 64-bit hash makes a collision between two different users'
  -- locks negligible (harmless even then — it would only make two different
  -- users' starts serialize against each other, never corrupt anything).
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select kind into v_kind from v2_programs where id = p_program_id and user_id = v_user_id;
  if not found then
    raise exception 'v2_start_run: program % not found for user %', p_program_id, v_user_id;
  end if;
  if v_kind <> 'saved' then
    raise exception 'v2_start_run: program % is not a saved program (kind=%)', p_program_id, v_kind;
  end if;

  -- Completes every active run of the caller's — mirrors
  -- completeAllActiveMesos (mesoService.ts) exactly: status = 'completed',
  -- end_date = "today". end_date = p_start_date rather than a freshly-read
  -- current_date: the app's one call site (useCreateMeso) always computes
  -- p_start_date as today and uses that same value for both ends of the
  -- boundary, so this keeps that identical instead of reading a second,
  -- possibly-later "now" inside the function.
  update v2_mesocycles
     set status = 'completed', end_date = p_start_date
   where user_id = v_user_id and status = 'active';

  -- p_new_name omitted (null): the copy keeps the saved program's own name —
  -- p_name below is the new MESOCYCLE's name, a different thing (ProgramPage
  -- already lets these differ: an optional custom meso name over a program
  -- picked from a list).
  v_new_program_id := v2_copy_program(p_program_id, v_user_id, 'run');

  insert into v2_mesocycles (id, user_id, name, program_id, source_program_id, status, start_date, end_date)
  values (v_meso_id, v_user_id, p_name, v_new_program_id, p_program_id, 'active', p_start_date, null);

  return v_meso_id;
end;
$$;

grant execute on function v2_start_run(uuid, text, date) to authenticated;

-- ═══ The transition ═════════════════════════════════════════════════════════
-- See the file header for the full explanation. Runs once, now, over every
-- user's existing data.

do $$
declare
  v_row       record;
  v_clone_id  uuid;
begin
  -- Step 1: clone every program any mesocycle points at (kind = 'saved' on
  -- the clone — the new reusable template) and record the manifest row.
  for v_row in
    select p.id as program_id, p.user_id as user_id
      from v2_programs p
     where p.id in (select distinct program_id from v2_mesocycles)
  loop
    v_clone_id := v2_copy_program(v_row.program_id, v_row.user_id, 'saved');
    insert into v2_run_transition_manifest (user_id, original_program_id, clone_program_id)
    values (v_row.user_id, v_row.program_id, v_clone_id);
  end loop;
end;
$$;

-- Step 2: point the original's (now the run's copy) workouts at the clone's
-- matching workout, joining on the clone's own (reverse, copy -> original)
-- lineage that v2_copy_program just wrote — must run before step 3 clears it.
-- A plain comma-join in FROM, not JOIN ... ON: the target table of an
-- UPDATE ... FROM cannot be referenced from inside a JOIN's ON clause (only
-- from WHERE, against the FROM-list's full cross product), so the
-- clone_wd.source_workout_day_id = orig.id correlation has to live in WHERE.
update v2_workout_days orig
   set source_workout_day_id = clone_wd.id
  from v2_run_transition_manifest m, v2_workout_days clone_wd
 where clone_wd.program_id = m.clone_program_id
   and clone_wd.source_workout_day_id = orig.id
   and orig.program_id = m.original_program_id;

-- Step 3: a saved program (the clone) carries no lineage of its own.
update v2_workout_days
   set source_workout_day_id = null
 where program_id in (select clone_program_id from v2_run_transition_manifest);

-- Step 4: the original becomes the run's copy. No id changes — every
-- session, week plan and log that already points at this program_id keeps
-- pointing at the exact same row.
update v2_programs
   set kind = 'run'
 where id in (select original_program_id from v2_run_transition_manifest);

-- Step 5: every mesocycle that used the original now also names the clone as
-- the saved program it started from.
update v2_mesocycles m
   set source_program_id = man.clone_program_id
  from v2_run_transition_manifest man
 where m.program_id = man.original_program_id;

-- Make PostgREST pick up the new function and table.
notify pgrst, 'reload schema';
