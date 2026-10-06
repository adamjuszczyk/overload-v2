-- Overload Planner Extension, phase 1 — remove suggested reps from the
-- schema (chunk 12: TASKS.md "Remove suggested reps from the schema" /
-- SPEC.md "Removals" — "Suggested reps per program exercise are replaced by
-- per-set rep targets. Removing the old field changes stored data →
-- blocking decision at build time").
--
-- Destructive — drops v2_program_exercises.target_reps, which has data.
-- Adam merges this file himself after running scripts/live-counts.sql
-- before and after (CONTEXT.md: chunks 6, 12, 24 need live before/after
-- counts unless he waives them). Precondition: no device may still run a
-- bundle older than chunk 11 — the old client's programService.ts
-- (addProgramExercise) still inserts target_reps and would start failing
-- with 42703 the moment the column is gone, so every device must have
-- accepted the update banner first. This check would not catch a device
-- left open somewhere — hence the precondition is a human one, not a code
-- one (TASKS.md "Chunk 12" — "Would not catch").
--
-- Decision (Adam, 2026-10-05, TASKS.md "Chunk 12"): (b) — convert into rep
-- targets on the active run's unlogged planned working sets that have none,
-- with the backup table as planned (options were (a) discard after backup,
-- (b) convert, (c) other). Live (L8): 26 of 82 program exercises have a
-- value; after chunk 6's transition the saved clones carry copies too, so
-- the backup holds the originals' 26 plus the clones' copies (expected 52).
--
-- ─── Statement order (load-bearing) ────────────────────────────────────────
--   1. v2_target_reps_backup — one row per v2_program_exercises row whose
--      target_reps is not null, EVERY user (not just Adam): user_id,
--      program_exercise_id, target_reps, converted_week_plan_set_ids uuid[]
--      (starts '{}', filled by step 2). Standard RLS; the app never reads
--      this table, so it is deliberately NOT added to verify-rls.mjs's
--      TABLES (CONTEXT.md's rule there is "a table the app reads or
--      writes" — this one, nothing does).
--   2. Conversion (decision (b)), active mesocycles only. A loop, not a
--      bare UPDATE ... FROM a read-only CTE repeated twice: the
--      qualifying-rows query itself tests "rep_min is null and rep_max is
--      null", which the very update it drives then changes — two sibling
--      statements each re-deriving "qualifying" from scratch would see
--      zero rows the second time around (CONTEXT.md: "sibling
--      data-modifying CTEs... a sibling's write is invisible to an UPDATE",
--      same precedent as 021 step 2a). The single cursor query below
--      snapshots every qualifying row ONCE, before either write in the loop
--      body runs, so this doesn't apply here — same shape as 029/030/033's
--      own backfill/mapping loops.
--   3. v2_copy_program replaced, identical to 028's body minus target_reps
--      (the insert's own column list, the matching select value, and the
--      one explanatory comment naming it) — so v2_start_run keeps working
--      after step 4 drops the column. Diffed mechanically against 028's
--      CREATE OR REPLACE statement (removing exactly those three spans):
--      that is the only difference, confirmed line-for-line.
--   4. alter table v2_program_exercises drop column target_reps.
--   5. notify pgrst, 'reload schema'.
--
-- check-migration: flags this file (exit 1, as TASKS.md expects for a
-- drop) — every statement below except the backup table's own CREATE
-- TABLE/policy/index and its population INSERT (a brand-new, still-empty
-- table in this same file — the safe list's "insert into a table created
-- earlier in this batch" case, same as 029/030/033's own manifest-table
-- inserts). The DO block (opaque to the statement classifier, same as
-- every other DO block in this repo's migrations), the CREATE OR REPLACE
-- FUNCTION (CREATE FUNCTION is never on the safe list — 028's own header),
-- and the DROP COLUMN (only ADD COLUMN is safe on a table that already has
-- rows) are all expected flags, not a sign of anything missed — this merge
-- is Adam's regardless, both for those flags and because it changes
-- existing data.
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
--   1. alter table v2_program_exercises add column target_reps integer;
--   2. update v2_program_exercises pe
--         set target_reps = b.target_reps
--        from v2_target_reps_backup b
--       where b.program_exercise_id = pe.id;
--   3. update v2_week_plan_sets
--         set rep_min = null, rep_max = null
--       where id in (
--         select unnest(b.converted_week_plan_set_ids)
--           from v2_target_reps_backup b
--       );
--   4. Re-run 028_planner_p1_run_copies.sql's own `create or replace
--      function v2_copy_program(...)` statement verbatim — that file is
--      never edited (migrations are forward-only), so its text in this repo
--      is still exactly what was live before this migration; don't retype
--      it by hand.
-- v2_target_reps_backup itself is left in place (not dropped) — it is the
-- thing steps 2-3 read from, and keeping it afterward is harmless (standard
-- RLS; the app never reads it either way, same as before the rollback).
-- Steps 2 and 3 can run in either order relative to each other, only after
-- step 1; step 4 is independent of all three. Proved on scratch (replay to
-- 033, fixture, this file, then the four statements above): every table's
-- row count and column-level per-row fingerprint afterward is identical to
-- its value from before this file ran, and every converted set reads back
-- rep_min/rep_max null again.
--
-- No other existing row changes anywhere in the schema, in any table this
-- file doesn't name above — checked column-level, every table, on scratch.

-- ═══ 1. v2_target_reps_backup ════════════════════════════════════════════

create table v2_target_reps_backup (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  program_exercise_id         uuid not null references v2_program_exercises(id) on delete cascade,
  target_reps                 integer not null,
  converted_week_plan_set_ids uuid[] not null default '{}',
  created_at                  timestamptz not null default now()
);

alter table v2_target_reps_backup enable row level security;
create policy "Users access own rows" on v2_target_reps_backup
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "One row per program exercise" (TASKS.md) — also what step 2's own
-- `update ... where program_exercise_id = ...` below relies on to land on a
-- single row.
create unique index v2_target_reps_backup_program_exercise_uk
  on v2_target_reps_backup(program_exercise_id);

insert into v2_target_reps_backup (user_id, program_exercise_id, target_reps)
select user_id, id, target_reps
  from v2_program_exercises
 where target_reps is not null;

-- ═══ 2. Conversion (decision (b)) — active mesocycles only ═════════════════
-- Every condition below is required (TASKS.md "Chunk 12" / this chunk's
-- brief): a v2_week_plan_sets row of one of the active meso's own week
-- plans; a head (parent_week_plan_set_id is null) and a working set
-- (is_warmup = false); no rep target yet (rep_min/rep_max both null and
-- is_amrap false); unlogged (no v2_set_logs row names it); and its own
-- program exercise's target_reps is not null. is_amrap is left untouched —
-- already false, or the row would not have qualified.

do $$
declare
  v_candidate record;
begin
  for v_candidate in
    select wps.id as week_plan_set_id,
           wps.program_exercise_id as program_exercise_id,
           pe.target_reps as target_reps
      from v2_week_plan_sets wps
      join v2_week_plans wp on wp.id = wps.week_plan_id
      join v2_mesocycles m on m.id = wp.mesocycle_id
      join v2_program_exercises pe on pe.id = wps.program_exercise_id
     where m.status = 'active'
       and wps.parent_week_plan_set_id is null
       and wps.is_warmup = false
       and wps.rep_min is null
       and wps.rep_max is null
       and wps.is_amrap = false
       and pe.target_reps is not null
       and not exists (
             select 1 from v2_set_logs sl where sl.week_plan_set_id = wps.id
           )
     order by wps.user_id, wp.mesocycle_id, wp.week_number, wps.program_exercise_id, wps.id
  loop
    update v2_week_plan_sets
       set rep_min = v_candidate.target_reps,
           rep_max = v_candidate.target_reps
     where id = v_candidate.week_plan_set_id;

    update v2_target_reps_backup
       set converted_week_plan_set_ids = converted_week_plan_set_ids || v_candidate.week_plan_set_id
     where program_exercise_id = v_candidate.program_exercise_id;
  end loop;
end;
$$;

-- ═══ 3. v2_copy_program — identical to 028's body minus target_reps ═══════

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
  -- weight_unit and the design fields (rest_seconds,
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
      id, workout_day_id, user_id, exercise_id, position, weight_unit,
      superset_block_id, rest_seconds, rest_after_seconds, tempo, week_only, removed_at
    )
    select
      v_new_pe_id, wdm.new_id, p_user_id, v_pe.exercise_id, v_pe.position, v_pe.weight_unit,
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

-- ═══ 4. Drop the column ═════════════════════════════════════════════════

alter table v2_program_exercises drop column target_reps;

-- ═══ 5. Schema reload ═══════════════════════════════════════════════════

notify pgrst, 'reload schema';
