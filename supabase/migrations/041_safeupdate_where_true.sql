-- Hotfix: pg-safeupdate rejects the temp-table clears in three live functions.
--
-- Production's Postgres has the pg-safeupdate extension, which rejects a DELETE
-- or UPDATE with no WHERE clause on requests that come through the API
-- ("DELETE requires a WHERE clause"). Starting a new run failed on it:
-- v2_start_run calls v2_copy_program, which clears its temp tables with a bare
-- `delete from tmp_...;`. A scan of the latest definition of every function in
-- supabase/migrations (021 reassign_exercise_history, 028 v2_start_run, 034
-- v2_copy_program, 040 v2_plan_week and v2_make_week_default) found seven bare
-- DELETEs and no bare UPDATE, all in the three functions re-created here:
--   v2_copy_program (034)        4  tmp_v2_copy_program_{wd,block,pe,ps}_map
--   v2_plan_week (040)           1  tmp_v2_plan_week_set_map
--   v2_make_week_default (040)   2  tmp_v2_make_week_default_{sessions,map}
--
-- What this file does: `create or replace function` for each, its body copied
-- verbatim from its latest migration (034, 040, 040), with exactly one change per
-- bare delete: ` where true` before the semicolon. Same signatures, security
-- invoker, search_path and grants; then the schema reload, as in 034-040.
-- Not destructive: no table, column, row, constraint or policy changes. Each
-- delete still empties the same session-local temp table it always did.
--
-- Rollback: re-run the three `create or replace function` blocks from 034 (for
-- v2_copy_program) and 040 (v2_plan_week, v2_make_week_default) in a new
-- migration; that restores the bare deletes (and the failure under safeupdate).

-- ═══ 1. v2_copy_program — 034's body, `where true` on its 4 temp-table clears ═══

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
  delete from tmp_v2_copy_program_wd_map where true;
  delete from tmp_v2_copy_program_block_map where true;
  delete from tmp_v2_copy_program_pe_map where true;
  delete from tmp_v2_copy_program_ps_map where true;

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

-- ═══ 2. v2_plan_week — 040's body, `where true` on its temp-table clear ═══

create or replace function v2_plan_week(
  p_mesocycle_id uuid,
  p_week_number  integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id              uuid := auth.uid();
  v_program_id           uuid;          -- [037] needed for the sequence-items source
  v_planning_type        text;
  v_schedule             jsonb;
  v_schedule_type        text;          -- [037] 'weekday' | 'sequence'
  v_week_start           text;
  v_workout_day_id       uuid;
  v_sequence_position    integer;       -- [037] slot id for a sequence row; always null for weekday
  v_new_plan_id          uuid;
  v_planned_count        integer := 0;

  v_source_kind          text;   -- 'program' | 'week' | 'empty'
  v_wr_week_plan_id      uuid;   -- last planned USABLE (not deload, not empty) week's plan id, or null

  v_pe                   record;
  v_ps                   record;
  v_new_set_id           uuid;
begin
  if v_user_id is null then
    raise exception 'v2_plan_week: no authenticated user';
  end if;
  if p_week_number < 1 then
    raise exception 'v2_plan_week: week_number must be >= 1 (got %)', p_week_number;
  end if;

  -- RLS already hides another user's mesocycle entirely; the explicit
  -- user_id filter is defence in depth (same posture as v2_copy_program).
  -- A cross-user call finds no row here and raises below — the RLS proof
  -- this chunk's scratch run exercises.
  select p.id, p.planning_type, p.schedule, p.schedule_type  -- [037] + id, schedule_type
    into v_program_id, v_planning_type, v_schedule, v_schedule_type
    from v2_mesocycles m
    join v2_programs p on p.id = m.program_id and p.user_id = v_user_id
   where m.id = p_mesocycle_id and m.user_id = v_user_id;
  if not found then
    raise exception 'v2_plan_week: mesocycle % not found for user %', p_mesocycle_id, v_user_id;
  end if;

  select week_start into v_week_start from v2_user_settings where user_id = v_user_id;
  if v_week_start is null then
    v_week_start := 'copy'; -- no settings row yet: the column default (027, SPEC G4)
  end if;

  -- Scratch id map for this function, session-scoped (ON COMMIT DROP),
  -- cleared at the start of each workout:
  --   tmp_v2_plan_week_set_map — stage -> head reattachment within ONE
  --     workout's copy (either branch below), as in 031.
  -- [038] There is no second map any more: 037 also had
  -- tmp_v2_plan_week_ex_map (the source week's carry-forward
  -- program_exercise_id mapping). A copied set now keeps its own
  -- program_exercise_id.
  create temp table if not exists tmp_v2_plan_week_set_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;

  -- [037] Every (workout_day_id, sequence_position) slot this run's
  -- schedule names — a union of the two schedule types, one written once so
  -- the loop body below (unchanged since 031) runs for either shape:
  --   - weekday: the existing distinct-workout derivation from the
  --     schedule jsonb, now gated on schedule_type = 'weekday' explicitly
  --     (it was already a no-op for a sequence program before this chunk —
  --     a sequence program's schedule is always '{}', 031/032's own header
  --     — this gate just makes that explicit rather than incidental);
  --     sequence_position is always null here, exactly as before.
  --   - sequence: every v2_program_sequence_items row with a non-null
  --     workout_day_id (a null one is a rest slot — nothing to plan, same
  --     treatment a weekday's unassigned day already gets), carrying that
  --     slot's own `position` as sequence_position. A workout appearing
  --     twice (two rows, two positions) yields two loop iterations, two
  --     distinct inserts below (R16 — "one row per slot").
  for v_workout_day_id, v_sequence_position in
    select wd_id, seq_pos from (
      select (v_schedule ->> key)::uuid as wd_id, null::integer as seq_pos
        from jsonb_object_keys(v_schedule) as key
       where v_schedule_type = 'weekday' and v_schedule ->> key is not null
      union all
      select workout_day_id as wd_id, position as seq_pos
        from v2_program_sequence_items
       where v_schedule_type = 'sequence' and user_id = v_user_id and program_id = v_program_id
         and workout_day_id is not null
    ) as slots
  loop
    delete from tmp_v2_plan_week_set_map where true;

    v_new_plan_id := null;
    insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
    values (v_user_id, p_mesocycle_id, v_workout_day_id, p_week_number, v_sequence_position, false)  -- [037] + sequence_position
    on conflict (mesocycle_id, workout_day_id, week_number, sequence_position) do nothing  -- [037] 4-column target, R16
    returning id into v_new_plan_id;

    if v_new_plan_id is null then
      continue; -- already planned — by an earlier call, or by the caller that won the race (R10)
    end if;
    v_planned_count := v_planned_count + 1;

    -- The weight/RIR source — and, for a week-dependent week beyond week 1,
    -- the volume source too (SPEC: "Deload sessions are never a copy
    -- source"; DECISIONS 42 (b): skip an empty occurrence the same as a
    -- deload one, for both searches alike). One search, reused for both
    -- purposes. "Empty" := zero v2_week_plan_sets rows (DECISIONS 42's
    -- definition, used exactly this way in weekSources.ts's isEmpty flag
    -- too) — the `not exists` below is the SQL form of that same check.
    -- [037] `sequence_position is not distinct from v_sequence_position`:
    -- a slot's own history search, same slot identity R16 gives every
    -- planned row (workout_day_id alone is ambiguous once a workout can
    -- occupy two slots in one cycle — "copying is per slot: a slot's
    -- source is the same slot's last normal occurrence", TASKS.md). Always
    -- true for a weekday row (both sides null) — unchanged search there.
    select wp.id into v_wr_week_plan_id
      from v2_week_plans wp
     where wp.mesocycle_id = p_mesocycle_id and wp.workout_day_id = v_workout_day_id
       and wp.user_id = v_user_id and wp.week_number < p_week_number and wp.is_deload = false
       and wp.sequence_position is not distinct from v_sequence_position  -- [037]
       and exists (select 1 from v2_week_plan_sets s where s.week_plan_id = wp.id and s.user_id = v_user_id)
     order by wp.week_number desc
     limit 1;

    if p_week_number = 1 or v_planning_type = 'stable' then
      v_source_kind := 'program';
    elsif v_week_start = 'empty' then
      v_source_kind := 'empty';
    elsif v_wr_week_plan_id is not null then
      v_source_kind := 'week';
    else
      v_source_kind := 'empty'; -- week-dependent, copy requested, but nothing usable to copy (DECISIONS 42)
    end if;

    if v_source_kind = 'program' then
      -- ── Exercises: the run copy's CURRENT list, in program order —
      -- chunk 9: excluding week-only slots and removed exercises (see header
      -- "Change 1"). Neither can exist on any program before chunk 9's own
      -- code starts setting them, so this is a no-op everywhere it was
      -- already a no-op, and correct everywhere it now isn't.
      for v_pe in
        select id, position from v2_program_exercises
         where workout_day_id = v_workout_day_id and user_id = v_user_id
           and week_only = false and removed_at is null
         order by position
      loop
        insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
        values (v_user_id, v_new_plan_id, v_pe.id, v_pe.position);
      end loop;

      -- ── Sets: the run copy's own v2_program_sets — heads before stages,
      -- so a stage's parent is already in the map (same ordering as
      -- v2_copy_program). set_number := the row's own `position` (see
      -- header "set_number convention"); is_dropset := true for a stage
      -- row, false for a head, regardless of stage_kind — the existing,
      -- unchanged convention (weekPlanService.ts's addStage; chunk 14
      -- keeps it). target_weight/target_rir start null here and are filled
      -- below when a weight/RIR source exists. Joined through
      -- v2_program_exercises with the SAME week_only/removed_at exclusion
      -- as the exercise loop above, so a set under an excluded exercise is
      -- never copied either.
      -- [040] A program set with removed_at set was dropped from the default
      -- by v2_make_week_default and is skipped as well (a stage is only ever
      -- removed together with its head, so none is left without one).
      for v_ps in
        select ps.id, ps.program_exercise_id, ps.position, ps.is_warmup, ps.stage_kind,
               ps.parent_program_set_id, ps.stage_index, ps.rep_min, ps.rep_max, ps.is_amrap
          from v2_program_sets ps
          join v2_program_exercises pe on pe.id = ps.program_exercise_id
         where pe.workout_day_id = v_workout_day_id and ps.user_id = v_user_id
           and pe.week_only = false and pe.removed_at is null
           and ps.removed_at is null  -- [040]
         order by (ps.parent_program_set_id is not null), ps.position, ps.stage_index
      loop
        insert into v2_week_plan_sets (
          week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset,
          parent_week_plan_set_id, stage_index, is_warmup, program_set_id, stage_kind,
          target_weight, rep_min, rep_max, is_amrap
        )
        values (
          v_new_plan_id, v_user_id, v_ps.program_exercise_id, v_ps.position, null,
          v_ps.parent_program_set_id is not null,
          (select new_id from tmp_v2_plan_week_set_map where old_id = v_ps.parent_program_set_id),
          v_ps.stage_index, v_ps.is_warmup, v_ps.id, v_ps.stage_kind,
          null, v_ps.rep_min, v_ps.rep_max, v_ps.is_amrap
        )
        returning id into v_new_set_id;
        insert into tmp_v2_plan_week_set_map (old_id, new_id) values (v_ps.id, v_new_set_id);
      end loop;

      -- ── Stable weight/RIR mapping (see 039's header for the rule) ─────
      -- [039] A head takes its weight and RIR from last week's head of the
      -- SAME KIND at the same position within the exercise: warmups from
      -- warmups, working sets from working sets. Heads are numbered within
      -- (exercise row, is_warmup) — by v2_program_sets.position on the new
      -- week's side, by v2_week_plan_sets.set_number on last week's — and
      -- matched on all three (exercise row, is_warmup, ordinal). 031-038
      -- numbered warmups and working sets in one sequence, so a warmup added
      -- or removed last week shifted every weight by one set. A stage still
      -- takes its weight and RIR from the matched head's stage with the same
      -- stage_index (warmup-ness is decided on heads only).
      if v_wr_week_plan_id is not null then
        with new_heads as (
          select wps.id as new_id, ps.program_exercise_id as pe_id,
                 wps.is_warmup as is_warmup,  -- [039]
                 row_number() over (partition by ps.program_exercise_id, wps.is_warmup  -- [039]
                                    order by ps.position) as ord
            from v2_week_plan_sets wps
            join v2_program_sets ps on ps.id = wps.program_set_id
           where wps.week_plan_id = v_new_plan_id and ps.parent_program_set_id is null
        ),
        src_heads as (
          select id as src_id, program_exercise_id as pe_id,
                 is_warmup,  -- [039]
                 row_number() over (partition by program_exercise_id, is_warmup  -- [039]
                                    order by set_number) as ord
            from v2_week_plan_sets
           where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
             and parent_week_plan_set_id is null
        ),
        head_matches as (
          select nh.new_id, sh.src_id
            from new_heads nh
            join src_heads sh
              on sh.pe_id = nh.pe_id and sh.is_warmup = nh.is_warmup and sh.ord = nh.ord  -- [039]
        ),
        stage_matches as (
          select ns.id as new_id, ss.id as src_id
            from v2_week_plan_sets ns
            join head_matches hm on hm.new_id = ns.parent_week_plan_set_id
            join v2_week_plan_sets ss
              on ss.parent_week_plan_set_id = hm.src_id and ss.stage_index = ns.stage_index
           where ns.week_plan_id = v_new_plan_id
             and ss.week_plan_id = v_wr_week_plan_id and ss.user_id = v_user_id
        ),
        all_matches as (
          select * from head_matches union all select * from stage_matches
        )
        update v2_week_plan_sets wps
           set target_weight = src.target_weight,
               target_rir    = src.target_rir
          from all_matches am
          join v2_week_plan_sets src on src.id = am.src_id
         where wps.id = am.new_id;
      end if;

    elsif v_source_kind = 'week' then
      -- ── Week-to-week copy: exercises, each source row as it is ────────
      -- [038] Every one of the source week's exercise rows is copied with its
      -- OWN program_exercise_id and position. 037 (and 032 before it)
      -- selected coalesce(carry_program_exercise_id, program_exercise_id) and
      -- coalesce(carry_position, position) here, which is how an old "only
      -- this week" swap or reorder reverted on the next copy. Those stored
      -- values are ignored now (SPEC [P1.1]: "'only this week' values
      -- already stored are ignored from now on. Copying uses each week's
      -- actual content."); the carry columns are neither read nor written.
      for v_pe in
        select program_exercise_id, position
          from v2_week_plan_exercises
         where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
      loop
        insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
        values (v_user_id, v_new_plan_id, v_pe.program_exercise_id, v_pe.position)
        on conflict (week_plan_id, program_exercise_id) do nothing;
      end loop;

      -- ── Sets: a direct old-id → new-id remap of the source week's own
      -- sets — identical in spirit to weekPlanService.ts's
      -- copySetsWithGrouping, which the manual copy actions use client
      -- side. Every column (including program_set_id, so the workout
      -- screen's later lookup of design fields keeps working, and
      -- target_weight/target_rir, which this branch therefore needs no
      -- separate mapping step for) is carried through verbatim except
      -- tags (never copied — not selected, not inserted) and is_deload
      -- (a week_plans-level column, not touched here).
      -- [038] program_exercise_id is carried through verbatim as well: 037
      -- (chunk 9) mapped it through tmp_v2_plan_week_ex_map, which is gone,
      -- so a copied set keeps its own program_exercise_id — the same
      -- exercise row the loop above copies.
      for v_ps in
        select id, program_exercise_id, set_number, target_rir, is_dropset,
               parent_week_plan_set_id, stage_index, is_warmup, program_set_id,
               stage_kind, target_weight, rep_min, rep_max, is_amrap
          from v2_week_plan_sets
         where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
         order by (parent_week_plan_set_id is not null), set_number, stage_index
      loop
        insert into v2_week_plan_sets (
          week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset,
          parent_week_plan_set_id, stage_index, is_warmup, program_set_id, stage_kind,
          target_weight, rep_min, rep_max, is_amrap
        )
        values (
          v_new_plan_id, v_user_id, v_ps.program_exercise_id, v_ps.set_number, v_ps.target_rir,
          v_ps.is_dropset,
          (select new_id from tmp_v2_plan_week_set_map where old_id = v_ps.parent_week_plan_set_id),
          v_ps.stage_index, v_ps.is_warmup, v_ps.program_set_id, v_ps.stage_kind,
          v_ps.target_weight, v_ps.rep_min, v_ps.rep_max, v_ps.is_amrap
        )
        returning id into v_new_set_id;
        insert into tmp_v2_plan_week_set_map (old_id, new_id) values (v_ps.id, v_new_set_id);
      end loop;
    end if;
    -- else 'empty': the row now exists with zero exercises and zero sets —
    -- the empty-state "Copy last week" (PlanPage.tsx) recognises this.
  end loop;

  return v_planned_count;
end;
$$;
grant execute on function v2_plan_week(uuid, integer) to authenticated;

-- ═══ 3. v2_make_week_default — 040's body, `where true` on its 2 temp-table clears ═══

create or replace function v2_make_week_default(
  p_mesocycle_id uuid,
  p_week_number  integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_now            timestamptz := now();
  v_program_id     uuid;          -- the run's own copy (v2_mesocycles.program_id), never the saved program
  v_kind           text;
  v_planning_type  text;

  v_sessions       integer;       -- sessions planned in this week
  v_usable         integer;       -- ... of which can be a source: neither deload nor empty

  v_src            record;        -- one workout's source session (its first usable occurrence)
  v_w              record;        -- one planned set of that session
  v_ps_id          uuid;          -- the program set a planned set ends up on
  v_parent_ps_id   uuid;          -- ... for a stage: its head's program set

  v_old_exercises  jsonb;
  v_workouts       jsonb := '[]'::jsonb;
  v_skipped        jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'v2_make_week_default: no authenticated user';
  end if;
  if p_week_number < 1 then
    raise exception 'v2_make_week_default: week_number must be >= 1 (got %)', p_week_number;
  end if;

  -- One make-default at a time per user (and not alongside v2_start_run, which
  -- takes the same key): a second call that started while the first was still
  -- open would read the old default (the first call's writes are not visible
  -- yet) and hand it back as its own "old default". Released at transaction end.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  -- RLS already hides another user's mesocycle entirely; the explicit user_id
  -- filters are defence in depth (same posture as v2_plan_week). A cross-user
  -- call finds no row here and raises before anything is read or written.
  select p.id, p.kind, p.planning_type
    into v_program_id, v_kind, v_planning_type
    from v2_mesocycles m
    join v2_programs p on p.id = m.program_id and p.user_id = v_user_id
   where m.id = p_mesocycle_id and m.user_id = v_user_id;
  if not found then
    raise exception 'v2_make_week_default: mesocycle % not found for user %', p_mesocycle_id, v_user_id;
  end if;
  if v_kind <> 'run' then
    raise exception 'v2_make_week_default: mesocycle % does not point at a run copy (program kind %)', p_mesocycle_id, v_kind;
  end if;
  if v_planning_type <> 'stable' then
    raise exception 'v2_make_week_default: mesocycle % is not a stable run (planning type %)', p_mesocycle_id, v_planning_type;
  end if;

  -- Scratch tables for this function, session-scoped (ON COMMIT DROP):
  --   tmp_v2_make_week_default_sessions — this week's planned sessions of the run, classified once (below)
  --   tmp_v2_make_week_default_map      — planned set -> the program set it ends up on, cleared at the start
  --                                       of each workout; both columns unique: a program set is claimed by
  --                                       at most one planned set
  create temp table if not exists tmp_v2_make_week_default_sessions
    (week_plan_id uuid primary key, workout_day_id uuid not null, sequence_position integer,
     wd_position integer not null, is_deload boolean not null, is_empty boolean not null, usable boolean not null)
    on commit drop;
  create temp table if not exists tmp_v2_make_week_default_map
    (week_set_id uuid primary key, program_set_id uuid not null unique) on commit drop;
  delete from tmp_v2_make_week_default_sessions where true;

  -- WHICH SESSIONS CAN BE A SOURCE — decided here and nowhere else. A session is usable when it is neither
  -- deload nor empty:
  --   - deload: SPEC, "Deload sessions are excluded: their workouts keep the current default";
  --   - empty (`is_empty`): no planned set under any of the session's exercises — no exercises at all, or
  --     exercises whose sets were all deleted. SPEC is silent; this is v2_plan_week's own copy-source rule
  --     (DECISIONS 42(b): skip deload AND empty occurrences), and it keeps one emptied session from wiping
  --     its workout's default. To make "deload only" the rule, make `is_empty` constant false (replace its
  --     `not exists (...)` with `false`); nothing else reads emptiness.
  insert into tmp_v2_make_week_default_sessions
    (week_plan_id, workout_day_id, sequence_position, wd_position, is_deload, is_empty, usable)
  select c.id, c.workout_day_id, c.sequence_position, c.wd_position, c.is_deload, c.is_empty,
         (not c.is_deload and not c.is_empty)
    from (
      select wp.id, wp.workout_day_id, wp.sequence_position, wd.position as wd_position, wp.is_deload,
             not exists (select 1 from v2_week_plan_sets s
                           join v2_week_plan_exercises e
                             on e.week_plan_id = s.week_plan_id and e.program_exercise_id = s.program_exercise_id
                          where s.week_plan_id = wp.id and s.user_id = v_user_id) as is_empty
        from v2_week_plans wp
        join v2_workout_days wd on wd.id = wp.workout_day_id and wd.program_id = v_program_id
       where wp.mesocycle_id = p_mesocycle_id and wp.week_number = p_week_number and wp.user_id = v_user_id
    ) c;

  select count(*), count(*) filter (where usable)
    into v_sessions, v_usable
    from tmp_v2_make_week_default_sessions;
  if v_sessions = 0 then
    raise exception 'v2_make_week_default: week % of mesocycle % is not planned', p_week_number, p_mesocycle_id;
  end if;
  if v_usable = 0 then
    raise exception 'v2_make_week_default: every session of week % of mesocycle % is deload or empty; there is nothing to make the default', p_week_number, p_mesocycle_id;
  end if;

  -- Workouts with no usable session this week keep their default (SPEC: "Deload sessions are excluded: their
  -- workouts keep the current default"; an empty session is not a source either). They are listed in the
  -- result so the caller knows they were not touched. Reason 'deload' when every session of the workout this
  -- week is deload, otherwise 'empty' (all its sessions empty, or a mix of deload and empty).
  select coalesce(jsonb_agg(jsonb_build_object('workout_day_id', t.workout_day_id,
                                               'reason', case when t.all_deload then 'deload' else 'empty' end)
                            order by t.wd_position, t.workout_day_id), '[]'::jsonb)
    into v_skipped
    from (
      select u.workout_day_id, min(u.wd_position) as wd_position, bool_and(u.is_deload) as all_deload
        from tmp_v2_make_week_default_sessions u
       group by u.workout_day_id
      having not bool_or(u.usable)
    ) t;

  -- The source of each remaining workout: its first USABLE occurrence in the week. A weekday run has one
  -- session per workout, so this is that session. A sequence cycle can hold a workout in several slots: the
  -- lowest sequence_position among its usable sessions wins (SPEC: "its first normal occurrence becomes the
  -- default" — also when its first occurrence is deload (G41), and when it is empty).
  for v_src in
    select s.workout_day_id, s.week_plan_id, s.sequence_position
      from (
        select distinct on (u.workout_day_id) u.workout_day_id, u.week_plan_id, u.sequence_position, u.wd_position
          from tmp_v2_make_week_default_sessions u
         where u.usable
         order by u.workout_day_id, u.sequence_position nulls first, u.week_plan_id
      ) s
     order by s.wd_position, s.workout_day_id
  loop
    delete from tmp_v2_make_week_default_map where true;

    -- ── The old default, as the caller needs it for "Apply this change to
    -- planned weeks ahead": this workout's default exercises (not week-only,
    -- not removed) with their program sets (not removed), exactly as they are
    -- before any write below.
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id', pe.id,
               'exercise_id', pe.exercise_id,
               'position', pe.position,
               'week_only', pe.week_only,
               'removed', pe.removed_at is not null,
               'sets', (
                 select coalesce(jsonb_agg(
                          jsonb_build_object(
                            'id', ps.id,
                            'position', ps.position,
                            'is_warmup', ps.is_warmup,
                            'parent_program_set_id', ps.parent_program_set_id,
                            'stage_index', ps.stage_index,
                            'stage_kind', ps.stage_kind,
                            'rep_min', ps.rep_min,
                            'rep_max', ps.rep_max,
                            'is_amrap', ps.is_amrap)
                          order by (ps.parent_program_set_id is not null), ps.position, ps.stage_index, ps.id
                        ), '[]'::jsonb)
                   from v2_program_sets ps
                  where ps.program_exercise_id = pe.id and ps.user_id = v_user_id and ps.removed_at is null)
             )
             order by pe.position, pe.id
           ), '[]'::jsonb)
      into v_old_exercises
      from v2_program_exercises pe
     where pe.workout_day_id = v_src.workout_day_id and pe.user_id = v_user_id
       and pe.week_only = false and pe.removed_at is null;

    -- ── Exercises: the run copy's list becomes this week's.
    -- 1. Default rows this week does not show are soft-removed (never
    --    deleted: planned weeks keep their rows, and a delete would cascade
    --    into their planned sets). Rows already removed keep their timestamp;
    --    week-only rows of other weeks are not part of the default and are
    --    left alone.
    update v2_program_exercises pe
       set removed_at = v_now
     where pe.workout_day_id = v_src.workout_day_id and pe.user_id = v_user_id
       and pe.week_only = false and pe.removed_at is null
       and not exists (select 1 from v2_week_plan_exercises wpe
                        where wpe.week_plan_id = v_src.week_plan_id and wpe.program_exercise_id = pe.id);
    -- 2. Every row this week shows is part of the default, with this week's
    --    position: a week-only row (added or swapped in) joins keeping its id,
    --    and a row that was removed from the default earlier but is still
    --    shown here comes back. exercise_id is never written.
    update v2_program_exercises pe
       set week_only = false, removed_at = null, position = wpe.position
      from v2_week_plan_exercises wpe
     where wpe.week_plan_id = v_src.week_plan_id and wpe.user_id = v_user_id
       and pe.id = wpe.program_exercise_id
       and pe.workout_day_id = v_src.workout_day_id and pe.user_id = v_user_id;

    -- ── Sets: each shown exercise's program sets become this week's sets.
    -- A planned set that names a program set of its OWN exercise row (and of
    -- its own kind: head or stage) updates that program set in place, so the
    -- program set's rest_seconds and stage_rest_seconds stay. Every other
    -- planned set (added in the week, or a swapped-in row's sets, which still
    -- name the replaced row's program sets) gets a new program set with no
    -- rest. Heads first, so a stage can find its head's program set.
    for v_w in
      select wps.id, wps.program_exercise_id, wps.set_number, wps.is_warmup, wps.stage_kind,
             wps.rep_min, wps.rep_max, wps.is_amrap, wps.program_set_id
        from v2_week_plan_sets wps
        join v2_week_plan_exercises wpe
          on wpe.week_plan_id = wps.week_plan_id and wpe.program_exercise_id = wps.program_exercise_id
        join v2_program_exercises pe
          on pe.id = wps.program_exercise_id and pe.workout_day_id = v_src.workout_day_id
       where wps.week_plan_id = v_src.week_plan_id and wps.user_id = v_user_id
         and wps.parent_week_plan_set_id is null
       order by wps.program_exercise_id, wps.set_number, wps.id
    loop
      v_ps_id := null;
      if v_w.program_set_id is not null then
        select ps.id into v_ps_id
          from v2_program_sets ps
         where ps.id = v_w.program_set_id and ps.user_id = v_user_id
           and ps.program_exercise_id = v_w.program_exercise_id
           and ps.parent_program_set_id is null
           and not exists (select 1 from tmp_v2_make_week_default_map m where m.program_set_id = ps.id);
      end if;
      if v_ps_id is not null then
        -- A warmup is never staged (v2_program_sets_warmup_check), so a
        -- planned warmup that still carries a stage kind gives the program
        -- set none.
        update v2_program_sets
           set position = v_w.set_number, is_warmup = v_w.is_warmup,
               stage_kind = case when v_w.is_warmup then null else v_w.stage_kind end,
               rep_min = v_w.rep_min, rep_max = v_w.rep_max, is_amrap = v_w.is_amrap,
               removed_at = null
         where id = v_ps_id;
      else
        insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup, stage_kind,
                                     rep_min, rep_max, is_amrap)
        values (v_user_id, v_w.program_exercise_id, v_w.set_number, v_w.is_warmup,
                case when v_w.is_warmup then null else v_w.stage_kind end,
                v_w.rep_min, v_w.rep_max, v_w.is_amrap)
        returning id into v_ps_id;
      end if;
      insert into tmp_v2_make_week_default_map (week_set_id, program_set_id) values (v_w.id, v_ps_id);
    end loop;

    for v_w in
      select wps.id, wps.program_exercise_id, wps.stage_index, wps.rep_min, wps.rep_max, wps.is_amrap,
             wps.program_set_id, wps.parent_week_plan_set_id
        from v2_week_plan_sets wps
        join v2_week_plan_exercises wpe
          on wpe.week_plan_id = wps.week_plan_id and wpe.program_exercise_id = wps.program_exercise_id
        join v2_program_exercises pe
          on pe.id = wps.program_exercise_id and pe.workout_day_id = v_src.workout_day_id
       where wps.week_plan_id = v_src.week_plan_id and wps.user_id = v_user_id
         and wps.parent_week_plan_set_id is not null
       order by wps.program_exercise_id, wps.set_number, wps.stage_index, wps.id
    loop
      -- The stage's head must be a head of this session under the SAME exercise row.
      select m.program_set_id into v_parent_ps_id
        from tmp_v2_make_week_default_map m
        join v2_week_plan_sets ph on ph.id = m.week_set_id
       where m.week_set_id = v_w.parent_week_plan_set_id
         and ph.program_exercise_id = v_w.program_exercise_id;
      if v_parent_ps_id is null then
        raise exception 'v2_make_week_default: planned stage % has no head set under its own exercise in this session', v_w.id;
      end if;

      v_ps_id := null;
      if v_w.program_set_id is not null then
        select ps.id into v_ps_id
          from v2_program_sets ps
         where ps.id = v_w.program_set_id and ps.user_id = v_user_id
           and ps.program_exercise_id = v_w.program_exercise_id
           and ps.parent_program_set_id = v_parent_ps_id
           and not exists (select 1 from tmp_v2_make_week_default_map m where m.program_set_id = ps.id);
      end if;
      -- A stage shares its head's position (027).
      if v_ps_id is not null then
        update v2_program_sets
           set position = (select hp.position from v2_program_sets hp where hp.id = v_parent_ps_id),
               stage_index = v_w.stage_index,
               rep_min = v_w.rep_min, rep_max = v_w.rep_max, is_amrap = v_w.is_amrap,
               removed_at = null
         where id = v_ps_id;
      else
        insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup,
                                     parent_program_set_id, stage_index, rep_min, rep_max, is_amrap)
        values (v_user_id, v_w.program_exercise_id,
                (select hp.position from v2_program_sets hp where hp.id = v_parent_ps_id), false,
                v_parent_ps_id, v_w.stage_index, v_w.rep_min, v_w.rep_max, v_w.is_amrap)
        returning id into v_ps_id;
      end if;
      insert into tmp_v2_make_week_default_map (week_set_id, program_set_id) values (v_w.id, v_ps_id);
    end loop;

    -- Program sets of the shown exercises that no planned set of this week
    -- names any more: soft-removed (never deleted — weeks planned earlier keep
    -- pointing at them for their run-wide rest). A stage goes with its head:
    -- nothing in this week names a stage whose head it dropped.
    update v2_program_sets ps
       set removed_at = v_now
      from v2_program_exercises pe
     where ps.program_exercise_id = pe.id and pe.workout_day_id = v_src.workout_day_id
       and exists (select 1 from v2_week_plan_exercises wpe
                    where wpe.week_plan_id = v_src.week_plan_id and wpe.program_exercise_id = pe.id)
       and ps.user_id = v_user_id and ps.removed_at is null
       and not exists (select 1 from tmp_v2_make_week_default_map m where m.program_set_id = ps.id);

    -- Point this week's sets at the resulting program sets. Weights, RIR and
    -- tags are not touched.
    update v2_week_plan_sets wps
       set program_set_id = m.program_set_id
      from tmp_v2_make_week_default_map m
     where wps.id = m.week_set_id and wps.program_set_id is distinct from m.program_set_id;

    v_workouts := v_workouts || jsonb_build_array(jsonb_build_object(
      'workout_day_id', v_src.workout_day_id,
      'source', jsonb_build_object('week_plan_id', v_src.week_plan_id,
                                   'sequence_position', v_src.sequence_position),
      'old_default', jsonb_build_object('exercises', v_old_exercises)
    ));
  end loop;

  return jsonb_build_object(
    'mesocycle_id', p_mesocycle_id,
    'week_number', p_week_number,
    'workouts', v_workouts,
    'skipped', v_skipped
  );
end;
$$;

grant execute on function v2_make_week_default(uuid, integer) to authenticated;

-- Signatures are unchanged; reload so PostgREST's cache matches.
notify pgrst, 'reload schema';
