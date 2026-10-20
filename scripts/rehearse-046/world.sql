-- rehearse-046 world (chunk 53; DECISIONS 149 (c), 196): builds a 1.1-shaped world on the replayed database, runs the REAL
-- migration 046 on it (twice), and prints ONE json line for scripts/rehearse-046.mjs to judge. Everything is rolled back.
--
-- The script puts 041's `v2_plan_week` under the name `v2_plan_week_041` (the 1.1 function: the copy that carried a week's
-- own exercise rows forward verbatim) where the marker line "V2_PLAN_WEEK_041" (below, between at-signs) stands, and the
-- migration's text where each marker line "MIGRATION" (between at-signs) stands (psql's \i reads files on the container's
-- side, so the text goes in), then runs
--   psql -v world=rand|canon|noop|seq -v seed=N -tA -f -
--
-- What 1.1 did to a week-dependent run (weekPlanService.ts; runProgramExercises.ts), written here as SQL:
--   SWAP     a week-only program-exercise row at the replaced row's position (and its superset block); the WEEK's exercise
--            row and its sets are re-pointed at it. The replaced run-copy row stays live.        swapWeekExercise
--   ADD      a week-only row, a week exercise row at the end of the week, some sets of its own.     addWeekExercise
--   REMOVE   the week's sets and exercise row are deleted; the run-copy row stays live.            removeWeekExercise
--   REORDER  the week's exercise rows trade positions; the run copy never hears of it.             reorderWeekExercises
--   (P1)     the program tab's REMOVE soft-removed a run-copy row while planned weeks kept listing it.  removeRunProgramExercise
-- and the next week was `v2_plan_week` 041's copy of the week before, rows verbatim: the carry-forward.
--
-- Worlds: noop (no edits), canon (one workout: a swap, an add, a remove and a reorder in its last week), rand (random edits,
-- weeks, deload and empty last weeks, a workout never planned, a completed older run and another user's stable run that
-- are left alone), seq (a sequence run whose repeated workout was edited differently in its two slots).
\set ON_ERROR_STOP on
begin;

-- @V2_PLAN_WEEK_041@

-- ─── 1.1's writers ────────────────────────────────────────────────────────────────────────────────────────────────
create function rh_swap(p_week uuid, p_pe uuid, p_exercise uuid) returns uuid language plpgsql as $f$
declare v_wd uuid; v_pos integer; v_block uuid; v_new uuid;
begin
  select workout_day_id, position, superset_block_id into v_wd, v_pos, v_block from v2_program_exercises where id = p_pe;
  insert into v2_program_exercises (user_id, workout_day_id, exercise_id, position, weight_unit, superset_block_id, week_only)
    values (auth.uid(), v_wd, p_exercise, v_pos, null, v_block, true) returning id into v_new;
  update v2_week_plan_exercises set program_exercise_id = v_new, carry_program_exercise_id = null
    where week_plan_id = p_week and program_exercise_id = p_pe;
  update v2_week_plan_sets set program_exercise_id = v_new where week_plan_id = p_week and program_exercise_id = p_pe;
  return v_new;
end $f$;

create function rh_add(p_week uuid, p_wd uuid, p_exercise uuid, p_position integer, p_sets integer) returns uuid language plpgsql as $f$
declare v_new uuid; i integer;
begin
  insert into v2_program_exercises (user_id, workout_day_id, exercise_id, position, week_only)
    values (auth.uid(), p_wd, p_exercise, p_position, true) returning id into v_new;
  insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (auth.uid(), p_week, v_new, p_position);
  for i in 1..p_sets loop
    insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_weight, target_rir, rep_min, rep_max)
      values (p_week, auth.uid(), v_new, i, 20, 2, 8, 12);
  end loop;
  return v_new;
end $f$;

create function rh_remove(p_week uuid, p_pe uuid) returns void language plpgsql as $f$
begin
  delete from v2_week_plan_sets where week_plan_id = p_week and program_exercise_id = p_pe;
  delete from v2_week_plan_exercises where week_plan_id = p_week and program_exercise_id = p_pe;
end $f$;

create function rh_reorder(p_week uuid, p_a uuid, p_b uuid) returns void language plpgsql as $f$
declare v_pa integer; v_pb integer;
begin
  select position into v_pa from v2_week_plan_exercises where week_plan_id = p_week and program_exercise_id = p_a;
  select position into v_pb from v2_week_plan_exercises where week_plan_id = p_week and program_exercise_id = p_b;
  update v2_week_plan_exercises set position = v_pb, carry_position = null where week_plan_id = p_week and program_exercise_id = p_a;
  update v2_week_plan_exercises set position = v_pa, carry_position = null where week_plan_id = p_week and program_exercise_id = p_b;
end $f$;

-- What a planned week holds, per slot, with no id of the new rows in it (so two plannings of the same week compare): its
-- exercises (program row, position) and its sets' structure (program row, set number, stage index, warmup, stage flag,
-- kind, program-set link, and the head it hangs under as (program row, set number)).
create function rh_answer(p_meso uuid, p_week integer) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
      'workout_day_id', wp.workout_day_id, 'sequence_position', wp.sequence_position,
      'exercises', (select coalesce(jsonb_agg(jsonb_build_array(x.program_exercise_id, x.position) order by x.position, x.program_exercise_id), '[]'::jsonb)
                      from v2_week_plan_exercises x where x.week_plan_id = wp.id),
      'sets', (select coalesce(jsonb_agg(jsonb_build_array(s.program_exercise_id, s.set_number, s.stage_index, s.is_warmup, s.is_dropset, s.stage_kind, s.program_set_id,
                                                          (select jsonb_build_array(h.program_exercise_id, h.set_number) from v2_week_plan_sets h where h.id = s.parent_week_plan_set_id))
                                         order by s.program_exercise_id, s.set_number, s.stage_index, s.id), '[]'::jsonb)
                 from v2_week_plan_sets s where s.week_plan_id = wp.id)
    ) order by wp.workout_day_id, wp.sequence_position nulls first), '[]'::jsonb)
  from v2_week_plans wp where wp.mesocycle_id = p_meso and wp.week_number = p_week
$f$;

-- Everything 046 reads or writes, for the script: the rows it decides from, and the rows it may change.
create function rh_snapshot() returns jsonb language sql as $f$
  select jsonb_build_object(
    'mesocycles', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'status', status, 'program_id', program_id) order by id), '[]'::jsonb) from v2_mesocycles),
    'programs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'planning_type', planning_type, 'schedule_type', schedule_type) order by id), '[]'::jsonb) from v2_programs),
    'workout_days', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'program_id', program_id) order by id), '[]'::jsonb) from v2_workout_days),
    'program_exercises', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'workout_day_id', workout_day_id, 'position', position, 'week_only', week_only, 'removed', removed_at is not null, 'removed_at', removed_at::text) order by id), '[]'::jsonb) from v2_program_exercises),
    'week_plans', (select coalesce(jsonb_agg(jsonb_build_object('id', wp.id, 'mesocycle_id', wp.mesocycle_id, 'workout_day_id', wp.workout_day_id, 'week_number', wp.week_number, 'sequence_position', wp.sequence_position, 'is_deload', wp.is_deload,
                                                               'n_sets', (select count(*) from v2_week_plan_sets s where s.week_plan_id = wp.id)) order by wp.id), '[]'::jsonb) from v2_week_plans wp),
    'week_plan_exercises', (select coalesce(jsonb_agg(jsonb_build_object('week_plan_id', week_plan_id, 'program_exercise_id', program_exercise_id, 'position', position) order by id), '[]'::jsonb) from v2_week_plan_exercises)
  )
$f$;

-- Counts of the tables 046 mentions, and a hash of every column of them that 046 must not write (for v2_program_exercises:
-- everything but week_only, removed_at and position), so "nothing else changed" is a comparison, not a reading.
create function rh_fingerprint() returns jsonb language sql as $f$
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'v2_mesocycles', (select count(*) from v2_mesocycles), 'v2_programs', (select count(*) from v2_programs),
      'v2_workout_days', (select count(*) from v2_workout_days), 'v2_program_exercises', (select count(*) from v2_program_exercises),
      'v2_week_plans', (select count(*) from v2_week_plans), 'v2_week_plan_exercises', (select count(*) from v2_week_plan_exercises),
      'v2_week_plan_sets', (select count(*) from v2_week_plan_sets), 'v2_program_sets', (select count(*) from v2_program_sets),
      'v2_sessions', (select count(*) from v2_sessions), 'v2_set_logs', (select count(*) from v2_set_logs)),
    'hashes', jsonb_build_object(
      'v2_mesocycles', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_mesocycles t),
      'v2_programs', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_programs t),
      'v2_workout_days', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_workout_days t),
      'v2_program_exercises_other_columns', (select md5(coalesce(jsonb_agg(to_jsonb(t) - 'week_only' - 'removed_at' - 'position' order by t.id)::text, '')) from v2_program_exercises t),
      'v2_week_plans', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_week_plans t),
      'v2_week_plan_exercises', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_week_plan_exercises t),
      'v2_week_plan_sets', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_week_plan_sets t),
      'v2_program_sets', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_program_sets t),
      'v2_sessions', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_sessions t),
      'v2_set_logs', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '')) from v2_set_logs t))
  )
$f$;

select gen_random_uuid() as uid \gset
select gen_random_uuid() as uid2 \gset
insert into auth.users (id, email) values (:'uid', 'rehearse-046-a@example.invalid'), (:'uid2', 'rehearse-046-b@example.invalid');
select set_config('rh.world', :'world', true) \gset
select set_config('rh.seed', :'seed', true) \gset
select set_config('rh.uid2', :'uid2', true) \gset
select set_config('statement_timeout', '60s', true) \gset

-- ─── user B: a stable run with a 1.1-looking mismatch, which 046 must leave alone ────────────────────────────────────
select set_config('request.jwt.claim.sub', :'uid2', true) \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid2', 'role', 'authenticated')::text, true) \gset
set local role authenticated;
do $other$
declare v_uid uuid := auth.uid(); v_ex uuid; v_prog uuid; v_wd uuid; v_pe uuid; v_meso uuid; v_run_wd uuid; v_wp uuid;
begin
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'B1', 'back') returning id into v_ex;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type) values (v_uid, 'B program', 'saved', 'weekday', 'stable') returning id into v_prog;
  insert into v2_workout_days (program_id, user_id, name, position) values (v_prog, v_uid, 'B day', 1) returning id into v_wd;
  update v2_programs set schedule = jsonb_build_object('tuesday', v_wd) where id = v_prog;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_wd, v_uid, v_ex, 1) returning id into v_pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_pe, 1, 8, 10);
  v_meso := v2_start_run(v_prog, 'B run', date '2026-10-12');
  perform v2_plan_week(v_meso, 1);
  select id into v_run_wd from v2_workout_days where program_id = (select program_id from v2_mesocycles where id = v_meso);
  select id into v_wp from v2_week_plans where mesocycle_id = v_meso;
  -- the week lists a week-only extra and not the program's own row: a mismatch 046 would fix on a week-dependent run
  insert into v2_program_exercises (user_id, workout_day_id, exercise_id, position, week_only) values (v_uid, v_run_wd, v_ex, 2, true) returning id into v_pe;
  delete from v2_week_plan_exercises where week_plan_id = v_wp;
  insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (v_uid, v_wp, v_pe, 1);
end
$other$;
reset role;

-- ─── user A: the world ───────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', :'uid', true) \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \gset
set local role authenticated;
do $build$
declare
  v_world    text    := current_setting('rh.world');
  v_seed     integer := current_setting('rh.seed')::integer;
  v_uid      uuid    := auth.uid();
  v_sequence boolean := v_world = 'seq';
  v_rand     boolean := v_world in ('rand', 'seq');
  v_ex       uuid[]  := '{}';
  v_id       uuid;
  v_prog uuid; v_prog0 uuid; v_wd uuid[]; v_w uuid; v_pe uuid; v_head uuid; v_meso uuid; v_meso0 uuid;
  v_nw integer; v_nex integer; v_k integer; v_week integer; v_i integer; v_j integer; v_n integer; v_op integer; v_nops integer;
  v_plan record; v_list uuid[]; v_a uuid; v_b uuid; v_pos integer;
  v_roll double precision;
  v_noedit boolean;
begin
  perform setseed((v_seed % 1000) / 1000.0);
  v_noedit := v_world = 'rand' and random() < 0.12;
  for v_i in 1..16 loop
    insert into exercises (user_id, name, muscle_group) values (v_uid, 'X' || v_i, 'back') returning id into v_id;
    v_ex := v_ex || v_id;
  end loop;

  -- An older run of its own, completed when the real one starts: its run copy keeps the 1.1 mismatches 046 would fix on an
  -- active one (rand worlds only).
  if v_world = 'rand' then
    insert into v2_programs (user_id, name, kind, schedule_type, planning_type) values (v_uid, 'Old program', 'saved', 'weekday', 'week_dependent') returning id into v_prog0;
    insert into v2_workout_days (program_id, user_id, name, position) values (v_prog0, v_uid, 'Old day', 1) returning id into v_w;
    update v2_programs set schedule = jsonb_build_object('monday', v_w) where id = v_prog0;
    for v_i in 1..3 loop
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_w, v_uid, v_ex[v_i], v_i) returning id into v_pe;
      insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_pe, 1, 8, 10), (v_uid, v_pe, 2, 8, 10);
    end loop;
    v_meso0 := v2_start_run(v_prog0, 'Old run', date '2026-09-07');
    perform v2_plan_week_041(v_meso0, 1);
    select id, workout_day_id into v_pe, v_w from v2_week_plans where mesocycle_id = v_meso0 limit 1;   -- the old run copy's own workout
    select program_exercise_id into v_a from v2_week_plan_exercises where week_plan_id = v_pe order by position limit 1;
    perform rh_swap(v_pe, v_a, v_ex[10]);
    perform rh_add(v_pe, v_w, v_ex[11], 9, 2);
  end if;

  -- The saved program: one or two workouts (a sequence run: A, B, rest, A, C), 3-5 exercises each
  v_nw := case when v_world = 'seq' then 3 when v_world = 'canon' or v_world = 'noop' then 1 else 1 + floor(random() * 2)::integer end;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
    values (v_uid, 'Program', 'saved', case when v_sequence then 'sequence' else 'weekday' end, 'week_dependent') returning id into v_prog;
  v_wd := '{}';
  for v_i in 1..v_nw loop
    insert into v2_workout_days (program_id, user_id, name, position) values (v_prog, v_uid, 'Day ' || v_i, v_i) returning id into v_w;
    v_wd := v_wd || v_w;
    v_nex := case when v_world = 'canon' then 5 else 3 + floor(random() * 3)::integer end;
    for v_j in 1..v_nex loop
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_w, v_uid, v_ex[((v_i - 1) * 5 + v_j - 1) % 9 + 1], v_j) returning id into v_pe;
      insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_pe, 1, 8, 10), (v_uid, v_pe, 2, 8, 10);
      if v_j = 2 and v_world <> 'noop' then
        insert into v2_program_sets (user_id, program_exercise_id, position, stage_kind, rep_min, rep_max) values (v_uid, v_pe, 3, 'dropset', 8, 10) returning id into v_head;
        insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (v_uid, v_pe, 3, v_head, 1, 6, 8);
      end if;
    end loop;
  end loop;
  if v_sequence then
    -- Day 1 twice (slots 1 and 4), Day 2 once, Day 3 once, two rest slots
    insert into v2_program_sequence_items (user_id, program_id, position, workout_day_id)
      values (v_uid, v_prog, 1, v_wd[1]), (v_uid, v_prog, 2, v_wd[2]), (v_uid, v_prog, 3, null), (v_uid, v_prog, 4, v_wd[1]), (v_uid, v_prog, 5, v_wd[3]), (v_uid, v_prog, 6, null);
  elsif v_nw = 1 then
    update v2_programs set schedule = jsonb_build_object('tuesday', v_wd[1]) where id = v_prog;
  else
    update v2_programs set schedule = jsonb_build_object('tuesday', v_wd[1], 'thursday', v_wd[2]) where id = v_prog;
  end if;
  v_meso := v2_start_run(v_prog, 'Run', date '2026-10-12');
  -- the run copy's own workouts (starting a run copies the program: new ids), in the program's order
  select array_agg(id order by position) into v_wd from v2_workout_days where program_id = (select program_id from v2_mesocycles where id = v_meso);

  -- The weeks: each planned the 1.1 way (041's copy of the week before), the user's numbers typed in, and 1.1's week-view
  -- edits made in it before the next one is planned. The last planned week keeps its edits.
  v_k := case when v_world = 'canon' then 2 when v_world = 'noop' then 2 else 2 + floor(random() * 3)::integer end;
  for v_week in 1..v_k loop
    perform v2_plan_week_041(v_meso, v_week);
    update v2_week_plan_sets set target_weight = 40 + v_week, target_rir = 2
      where week_plan_id in (select id from v2_week_plans where mesocycle_id = v_meso and week_number = v_week) and not is_warmup;
    if v_world = 'noop' then continue; end if;
    for v_plan in select id, workout_day_id from v2_week_plans where mesocycle_id = v_meso and week_number = v_week order by workout_day_id, sequence_position loop
      if v_world = 'canon' then
        continue when v_week < v_k;
        select array_agg(program_exercise_id order by position) into v_list from v2_week_plan_exercises where week_plan_id = v_plan.id;
        perform rh_swap(v_plan.id, v_list[3], v_ex[12]);                    -- SWAP the third
        perform rh_add(v_plan.id, v_plan.workout_day_id, v_ex[13], 9, 2);   -- ADD one at the end
        perform rh_remove(v_plan.id, v_list[2]);                            -- REMOVE the second
        perform rh_reorder(v_plan.id, v_list[1], v_list[5]);                -- REORDER the first and the fifth
        continue;
      end if;
      v_nops := case when v_noedit then 0 else floor(random() * 4)::integer end;   -- 0 to 3 edits of this workout's week; some runs are never edited
      for v_j in 1..v_nops loop
        select array_agg(program_exercise_id order by position, program_exercise_id) into v_list from v2_week_plan_exercises where week_plan_id = v_plan.id;
        continue when v_list is null;
        v_op := floor(random() * 5)::integer;
        v_a := v_list[1 + floor(random() * array_length(v_list, 1))::integer];
        if v_op = 0 then
          perform rh_swap(v_plan.id, v_a, v_ex[1 + floor(random() * 16)::integer]);
        elsif v_op = 1 then
          select coalesce(max(position), 0) + 1 into v_pos from v2_week_plan_exercises where week_plan_id = v_plan.id;
          perform rh_add(v_plan.id, v_plan.workout_day_id, v_ex[1 + floor(random() * 16)::integer], v_pos, 1 + floor(random() * 3)::integer);
        elsif v_op = 2 and array_length(v_list, 1) > 1 then
          perform rh_remove(v_plan.id, v_a);
        elsif v_op = 3 and array_length(v_list, 1) > 1 then
          v_b := v_list[1 + floor(random() * array_length(v_list, 1))::integer];
          if v_b <> v_a then perform rh_reorder(v_plan.id, v_a, v_b); end if;
        elsif v_op = 4 then
          -- (P1) removed in the program, still planned. A fixed old stamp, not now(): the migration stamps what it removes with
          -- now() too, and a stamp it wrongly rewrote on a row already removed would read the same inside one transaction.
          update v2_program_exercises set removed_at = timestamptz '2026-10-08 12:00:00+00' where id = v_a and not week_only;
        end if;
      end loop;
      if v_week = v_k and random() < 0.3 then
        -- the last week lists a row of ANOTHER workout, last (not something 1.1 wrote; 046 must not touch another workout's row)
        select pe.id into v_b from v2_program_exercises pe where pe.workout_day_id <> v_plan.workout_day_id
          and pe.workout_day_id in (select id from v2_workout_days where program_id = (select program_id from v2_mesocycles where id = v_meso))
          and not exists (select 1 from v2_week_plan_exercises x where x.week_plan_id = v_plan.id and x.program_exercise_id = pe.id) limit 1;
        if v_b is not null then
          insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (v_uid, v_plan.id, v_b, 20);
        end if;
      end if;
    end loop;
  end loop;

  if v_rand then
    -- the last week of the first workout sometimes a deload session, or emptied; the second workout sometimes never planned
    for v_plan in select id, workout_day_id, week_number from v2_week_plans where mesocycle_id = v_meso and week_number = v_k and workout_day_id = v_wd[1] order by sequence_position loop
      v_roll := random();
      if v_roll < 0.15 then
        update v2_week_plans set is_deload = true where id = v_plan.id;
      elsif v_roll < 0.25 then
        delete from v2_week_plan_sets where week_plan_id = v_plan.id;
      end if;
    end loop;
    if v_nw >= 2 and not v_sequence and random() < 0.4 then
      delete from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_wd[2];
    end if;
  end if;

  -- a done session with two logs (the first workout's week 1), so sessions and logs are in the fingerprints
  select id into v_id from v2_week_plans where mesocycle_id = v_meso and week_number = 1 and workout_day_id = v_wd[1] order by sequence_position limit 1;
  if v_id is not null then
    insert into v2_sessions (user_id, mesocycle_id, week_plan_id, workout_day_id, date, status, started_at, completed_at)
      values (v_uid, v_meso, v_id, v_wd[1], date '2026-10-13', 'completed', now(), now()) returning id into v_pe;
    insert into v2_set_logs (user_id, session_id, exercise_id, set_number, weight, reps, rir, logged_at)
      values (v_uid, v_pe, v_ex[1], 1, 40, 8, 2, now()), (v_uid, v_pe, v_ex[1], 2, 40, 8, 2, now());
  end if;
  perform set_config('rh.meso', v_meso::text, true);
  perform set_config('rh.k', v_k::text, true);
end
$build$;

-- 1.1's answer: the next week planned by 041's function, read, and rolled back (the exception undoes the planning; the
-- variable keeps what was read)
do $a041$
declare v_meso uuid := current_setting('rh.meso')::uuid; v_k integer := current_setting('rh.k')::integer; v_answer jsonb;
begin
  begin
    perform v2_plan_week_041(v_meso, v_k + 1);
    v_answer := rh_answer(v_meso, v_k + 1);
    raise exception 'rehearse-046: roll back';
  exception when others then
    if sqlerrm <> 'rehearse-046: roll back' then raise; end if;
  end;
  perform set_config('rh.answer041', v_answer::text, true);
end
$a041$;
reset role;

select set_config('rh.snapshot', rh_snapshot()::text, true) \gset
select set_config('rh.fingerprint0', rh_fingerprint()::text, true) \gset

-- ─── the migration, as the role that applies migrations ──────────────────────────────────────────────────────────────
-- @MIGRATION@
select set_config('rh.snapshot1', rh_snapshot()::text, true) \gset
select set_config('rh.fingerprint1', rh_fingerprint()::text, true) \gset
-- @MIGRATION@
select set_config('rh.snapshot2', rh_snapshot()::text, true) \gset
select set_config('rh.fingerprint2', rh_fingerprint()::text, true) \gset

-- 045's answer for the same next week, after 046 (read as user A, then rolled back)
select set_config('request.jwt.claim.sub', :'uid', true) \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \gset
set local role authenticated;
do $a045$
declare v_meso uuid := current_setting('rh.meso')::uuid; v_k integer := current_setting('rh.k')::integer; v_answer jsonb;
begin
  begin
    perform v2_plan_week(v_meso, v_k + 1);
    v_answer := rh_answer(v_meso, v_k + 1);
    raise exception 'rehearse-046: roll back';
  exception when others then
    if sqlerrm <> 'rehearse-046: roll back' then raise; end if;
  end;
  perform set_config('rh.answer045', v_answer::text, true);
end
$a045$;
reset role;

select jsonb_build_object(
  'world', current_setting('rh.world'), 'seed', current_setting('rh.seed')::integer, 'k', current_setting('rh.k')::integer,
  'user_id', :'uid',
  'snapshot', current_setting('rh.snapshot')::jsonb, 'snapshot_after', current_setting('rh.snapshot1')::jsonb, 'snapshot_after_twice', current_setting('rh.snapshot2')::jsonb,
  'fingerprint_before', current_setting('rh.fingerprint0')::jsonb, 'fingerprint_after', current_setting('rh.fingerprint1')::jsonb, 'fingerprint_after_twice', current_setting('rh.fingerprint2')::jsonb,
  'answer_041', current_setting('rh.answer041')::jsonb, 'answer_045_after_046', current_setting('rh.answer045')::jsonb
)::text;
rollback;
