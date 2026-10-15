-- plan-week-parity fixture (chunk 42; TASKS-1.2 F1-a / F1-b, extended): builds one throwaway user's program on the
-- replayed database, starts a run, plans weeks with the migrations' own v2_plan_week, and prints ONE json line:
-- the run copy's rows and the slot's earlier weeks (what the rule reads), and the target week the SQL planned
-- (what the rule decides). scripts/plan-week-parity.mjs runs autoCopy on the input and compares it with the output.
--
-- Run as `postgres` that creates the user, then as the signed-in `authenticated` user (jwt claims set), sequential
-- statements in one DO block, everything rolled back at the end: no row of the fixture survives.
--   psql -v scenario=a|b|c|d|e -tA -f fixture.sql
-- Scenarios (the target week is the one v2_plan_week plans last):
--   a  week-dependent, week 2 from week 1                       (TASKS F1-a)
--   b  stable, week 2 from the run copy; the run copy has a removed program set, a week-only exercise and a removed
--      exercise that week 2 must not take                       (TASKS F1-b, extended)
--   c  as a, but the user's `week_start` setting is 'empty'     (041 gives an empty week; 1.2 has no such setting)
--   d  week-dependent, week 4 with week 2 a deload session of another shape and week 3 empty (the skip rules)
--   e  week-dependent, week 1                                   (week 1 starts from the program, rep targets kept)
\set ON_ERROR_STOP on
begin;

select gen_random_uuid() as uid \gset
insert into auth.users (id, email) values (:'uid', 'plan-week-parity@example.invalid');
select set_config('request.jwt.claim.sub', :'uid', true) \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \gset
select set_config('fx.scenario', :'scenario', true) \gset
set local role authenticated;

do $fx$
declare
  v_scenario text    := current_setting('fx.scenario');
  v_planning text    := case when v_scenario = 'b' then 'stable' else 'week_dependent' end;
  v_target   integer := case v_scenario when 'd' then 4 when 'e' then 1 else 2 end;
  v_uid      uuid    := auth.uid();
  v_ex_lat uuid; v_ex_face uuid; v_ex_curl uuid; v_ex_dip uuid;
  v_prog uuid; v_wd uuid; v_pe_lat uuid; v_pe_face uuid; v_head uuid;
  v_meso uuid; v_run_prog uuid; v_run_wd uuid; v_rpe_lat uuid; v_rpe_face uuid; v_rpe_curl uuid; v_rpe_dip uuid;
  v_wp1 uuid; v_wp2 uuid; v_target_plan uuid;
  v_planned integer;
  v_run_ex jsonb; v_run_sets jsonb; v_prior jsonb; v_out_ex jsonb; v_out_sets jsonb; v_out_deload boolean;
begin
  -- ── the saved program: Pull 1 on Tuesdays ───────────────────────────────────────────────────────────────────
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Lat Pulldown', 'back') returning id into v_ex_lat;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Face Pull', 'shoulders') returning id into v_ex_face;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'EZ-Bar Curl', 'biceps') returning id into v_ex_curl;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Parallel Bar Dip', 'triceps') returning id into v_ex_dip;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
    values (v_uid, 'F1 program', 'saved', 'weekday', v_planning) returning id into v_prog;
  insert into v2_workout_days (program_id, user_id, name, position) values (v_prog, v_uid, 'Pull 1', 1) returning id into v_wd;
  update v2_programs set schedule = jsonb_build_object('tuesday', v_wd) where id = v_prog;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_wd, v_uid, v_ex_lat, 1) returning id into v_pe_lat;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_wd, v_uid, v_ex_face, 2) returning id into v_pe_face;
  -- Lat Pulldown: a warmup (12), a working set (8-10, rest 150 s), a dropset head (8-10) with an AMRAP drop
  insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup, rep_min, rep_max) values (v_uid, v_pe_lat, 1, true, 12, 12);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, rest_seconds) values (v_uid, v_pe_lat, 2, 8, 10, 150);
  insert into v2_program_sets (user_id, program_exercise_id, position, stage_kind, rep_min, rep_max) values (v_uid, v_pe_lat, 3, 'dropset', 8, 10) returning id into v_head;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, is_amrap) values (v_uid, v_pe_lat, 3, v_head, 1, true);
  if v_scenario = 'b' then  -- a fourth working set, which the run copy drops after week 1
    insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_pe_lat, 4, 12, 15);
  end if;
  -- Face Pull x2 (15-20)
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_pe_face, 1, 15, 20), (v_uid, v_pe_face, 2, 15, 20);

  -- ── the run, started through v2_start_run ───────────────────────────────────────────────────────────────────
  v_meso := v2_start_run(v_prog, 'F1 run', date '2026-10-12');
  select program_id into v_run_prog from v2_mesocycles where id = v_meso;
  select id into v_run_wd from v2_workout_days where program_id = v_run_prog;
  select id into v_rpe_lat from v2_program_exercises where workout_day_id = v_run_wd and exercise_id = v_ex_lat;
  select id into v_rpe_face from v2_program_exercises where workout_day_id = v_run_wd and exercise_id = v_ex_face;
  if v_scenario = 'c' then
    insert into v2_user_settings (user_id, week_start) values (v_uid, 'empty');
  end if;

  -- ── week 1, planned by v2_plan_week and then filled in by the user ──────────────────────────────────────────────
  if v_target > 1 then
    perform v2_plan_week(v_meso, 1);
    select id into v_wp1 from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 1;
    -- the warmup (weight and a legacy RIR), the working set (RIR range 1-2, reps changed to 9-11, a cue), the dropset
    -- head and its drop (40 kg, RIR 0, AMRAP from the program), Face Pull's two sets, and an extra Face Pull set
    update v2_week_plan_sets set target_weight = 20, target_rir = 5
      where week_plan_id = v_wp1 and program_exercise_id = v_rpe_lat and set_number = 1 and parent_week_plan_set_id is null;
    update v2_week_plan_sets set target_weight = 55, target_rir = 1, target_rir_max = 2, rep_min = 9, rep_max = 11, tags = array['push here']
      where week_plan_id = v_wp1 and program_exercise_id = v_rpe_lat and set_number = 2 and parent_week_plan_set_id is null;
    update v2_week_plan_sets set target_weight = 55, target_rir = 2
      where week_plan_id = v_wp1 and program_exercise_id = v_rpe_lat and set_number = 3 and parent_week_plan_set_id is null;
    update v2_week_plan_sets set target_weight = 40, target_rir = 0
      where week_plan_id = v_wp1 and program_exercise_id = v_rpe_lat and set_number = 3 and parent_week_plan_set_id is not null;
    update v2_week_plan_sets set target_weight = 50, target_rir = 3
      where week_plan_id = v_wp1 and program_exercise_id = v_rpe_lat and set_number = 4 and parent_week_plan_set_id is null;
    update v2_week_plan_sets set target_weight = 15, target_rir = 1
      where week_plan_id = v_wp1 and program_exercise_id = v_rpe_face;
    insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_weight, target_rir, rep_min, rep_max)
      values (v_wp1, v_uid, v_rpe_face, 3, 12.5, 1, 15, 20);
  end if;

  -- ── what happens between week 1 and the target week ─────────────────────────────────────────────────────────────
  if v_scenario = 'b' then
    -- the run copy changes (CHANGE THE PROGRAM, 1.2): a program set dropped, a week-only exercise and a removed one
    update v2_program_sets set removed_at = now() where program_exercise_id = v_rpe_lat and position = 4;
    insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, week_only)
      values (v_run_wd, v_uid, v_ex_curl, 3, true) returning id into v_rpe_curl;
    insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_rpe_curl, 1, 10, 12);
    insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, removed_at)
      values (v_run_wd, v_uid, v_ex_dip, 4, now()) returning id into v_rpe_dip;
    insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_rpe_dip, 1, 8, 12);
  elsif v_scenario = 'd' then
    -- week 2: planned, then a deload session of another shape (its extra Face Pull set and the drop gone, lighter);
    -- week 3: a planned row with no sets at all
    perform v2_plan_week(v_meso, 2);
    select id into v_wp2 from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 2;
    update v2_week_plans set is_deload = true where id = v_wp2;
    delete from v2_week_plan_sets where week_plan_id = v_wp2 and program_exercise_id = v_rpe_face and set_number = 3;
    delete from v2_week_plan_sets where week_plan_id = v_wp2 and program_exercise_id = v_rpe_lat and parent_week_plan_set_id is not null;
    update v2_week_plan_sets set target_weight = target_weight * 0.6 where week_plan_id = v_wp2 and target_weight is not null;
    insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
      values (v_uid, v_meso, v_run_wd, 3, null, false);
  end if;

  -- ── the rule's input, read before the week is planned ───────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object('id', pe.id, 'exercise_id', pe.exercise_id, 'exercise_name', e.name,
                                               'position', pe.position, 'week_only', pe.week_only, 'removed_at', pe.removed_at)
                            order by pe.position), '[]'::jsonb)
    into v_run_ex
    from v2_program_exercises pe join exercises e on e.id = pe.exercise_id
   where pe.workout_day_id = v_run_wd;
  select coalesce(jsonb_agg(to_jsonb(ps) order by ps.position, ps.stage_index), '[]'::jsonb)
    into v_run_sets
    from v2_program_sets ps
   where ps.program_exercise_id in (select id from v2_program_exercises where workout_day_id = v_run_wd);
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_number', wp.week_number, 'is_deload', wp.is_deload,
           'exercises', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position), '[]'::jsonb) from v2_week_plan_exercises x where x.week_plan_id = wp.id),
           'sets',      (select coalesce(jsonb_agg(to_jsonb(s) order by s.set_number, s.stage_index), '[]'::jsonb) from v2_week_plan_sets s where s.week_plan_id = wp.id)
         ) order by wp.week_number), '[]'::jsonb)
    into v_prior
    from v2_week_plans wp
   where wp.mesocycle_id = v_meso and wp.workout_day_id = v_run_wd and wp.week_number < v_target;

  -- ── the week under test, planned by the migrations' own function ────────────────────────────────────────────────
  v_planned := v2_plan_week(v_meso, v_target);
  select id, is_deload into v_target_plan, v_out_deload
    from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = v_target;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.position), '[]'::jsonb) into v_out_ex from v2_week_plan_exercises x where x.week_plan_id = v_target_plan;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.set_number, s.stage_index), '[]'::jsonb) into v_out_sets from v2_week_plan_sets s where s.week_plan_id = v_target_plan;

  perform set_config('fx.result', jsonb_build_object(
    'scenario', v_scenario,
    'planning_type', v_planning,
    'week_start', coalesce((select week_start from v2_user_settings where user_id = v_uid), 'copy'),
    'week_number', v_target,
    'planned', v_planned,
    'run_copy', jsonb_build_object('exercises', v_run_ex, 'sets', v_run_sets),
    'prior_weeks', v_prior,
    'output', jsonb_build_object('is_deload', v_out_deload, 'exercises', v_out_ex, 'sets', v_out_sets)
  )::text, true);
end
$fx$;

select current_setting('fx.result');
rollback;
