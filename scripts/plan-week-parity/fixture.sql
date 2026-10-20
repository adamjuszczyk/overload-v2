-- plan-week-parity fixture (chunk 42; TASKS-1.2 F1-a / F1-b, extended; chunk 53 adds scenarios f-k and z): builds one
-- throwaway user's program on the replayed database, starts a run, plans weeks with the migrations' own v2_plan_week,
-- and prints ONE json line: the run copy's rows and the slot's earlier weeks (what the rule reads), and the target week
-- the SQL planned (what the rule decides). scripts/plan-week-parity.mjs runs autoCopy on the input and compares it with
-- the output.
--
-- Run as `postgres` that creates the user, then as the signed-in `authenticated` user (jwt claims set), sequential
-- statements in one DO block, everything rolled back at the end: no row of the fixture survives.
--   psql -v scenario=a|b|c|d|e|f|g|h|i|j|k|z -v seed=0 -tA -f fixture.sql
-- Scenarios (the target week is the one v2_plan_week plans last):
--   a  week-dependent, week 2 from week 1                       (TASKS F1-a)
--   b  stable, week 2 from the run copy; the run copy has a removed program set, a week-only exercise and a removed
--      exercise that week 2 must not take                       (TASKS F1-b, extended)
--   c  as a, but the user's `week_start` setting is 'empty'     (041 gives an empty week; 1.2 has no such setting)
--   d  week-dependent, week 4 with week 2 a deload session of another shape and week 3 empty (the skip rules)
--   e  week-dependent, week 1                                   (week 1 starts from the program, rep targets kept)
--   f  week-dependent, week 4 after a week off: weeks 1 and 2 planned and different, week 3 never planned (DECISIONS
--      131; the source is week 2, not "the week before")
--   g  week-dependent, week 3 after a CHANGE THE PROGRAM save that came after week 2 was planned (DECISIONS 143): Face
--      Pull removed, EZ-Bar Curl swapped for Hammer Curl through the stored link, Cable Row added, Lat Pulldown kept,
--      and a 1.1 week-only Dip that week 2 lists
--   h  as g, the odd rows: a swap of a swap, two rows that replaced one, a live row the source lists that also names
--      a listed row as replaced, week-only rows (kept, numbered after the last, and removed), a row of another workout
--      the source lists, and a link that leaves the workout (the walk ends there)
--   i  a SEQUENCE run, cycle 3 slot 3 of a workout that sits in slots 1 and 3, cycle 2 planned for slot 1 only: each slot
--      copies its own history, not the workout's latest week of whichever slot
--   j  rows whose `replaces` links loop (A <- B <- A, a row that replaces itself, a row that replaces a loop): the walk
--      ends, and the new rows arrive with no sets
--   k  week-dependent, week 3 with nothing usable to copy (week 1 a deload session, week 2 empty): the week is planned
--      empty, whatever the run copy lists
--   z  a random world from `seed` (the run copy's flags, positions with ties and links, 1-3 earlier weeks with gaps,
--      deload flags and empty weeks, a random subset of rows listed): the harness runs it for seeds 1..N (--fuzz N)
\set ON_ERROR_STOP on
begin;

select gen_random_uuid() as uid \gset
insert into auth.users (id, email) values (:'uid', 'plan-week-parity@example.invalid');
select set_config('request.jwt.claim.sub', :'uid', true) \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \gset
select set_config('fx.scenario', :'scenario', true) \gset
select set_config('fx.seed', :'seed', true) \gset
set local role authenticated;
-- A looping walk must end in an error, not hang the run (the replay's `authenticated` role has no statement timeout of
-- its own once `set role` is used).
select set_config('statement_timeout', '20s', true) \gset

do $fx$
declare
  v_scenario text    := current_setting('fx.scenario');
  v_seed     integer := current_setting('fx.seed')::integer;
  v_sequence boolean := v_scenario = 'i';
  v_planning text    := case when v_scenario = 'b' then 'stable' else 'week_dependent' end;
  v_target   integer := case v_scenario when 'd' then 4 when 'e' then 1 when 'f' then 4 when 'g' then 3 when 'h' then 3 when 'i' then 3 when 'j' then 3 when 'k' then 3 else 2 end;
  v_slot     integer := case when v_scenario = 'i' then 3 end;   -- a sequence run: the slot under test
  v_uid      uuid    := auth.uid();
  v_ex_lat uuid; v_ex_face uuid; v_ex_curl uuid; v_ex_dip uuid; v_ex_ham uuid; v_ex_row uuid; v_ex_fly uuid; v_ex_x uuid;
  v_prog uuid; v_wd uuid; v_pe_lat uuid; v_pe_face uuid; v_head uuid;
  v_meso uuid; v_run_prog uuid; v_run_wd uuid; v_other_wd uuid;
  v_rpe_lat uuid; v_rpe_face uuid; v_rpe_curl uuid; v_rpe_dip uuid;
  v_rpe_ham uuid; v_rpe_row uuid; v_rpe_fly uuid; v_rpe_keep uuid; v_rpe_wo1 uuid; v_rpe_wo2 uuid; v_rpe_gone uuid; v_rpe_ghost uuid;
  v_rpe_a uuid; v_rpe_b uuid; v_rpe_c uuid; v_rpe_x uuid;
  v_wp1 uuid; v_wp2 uuid; v_target_plan uuid;
  v_planned integer;
  v_run_ex jsonb; v_run_sets jsonb; v_prior jsonb; v_out_ex jsonb; v_out_sets jsonb; v_out_deload boolean;
  -- scenario z
  v_rows uuid[] := '{}'; v_row uuid; v_i integer; v_k integer; v_n integer; v_roll double precision;
  v_week integer; v_weeks integer; v_wpz uuid; v_heads integer; v_stages integer; v_sn integer; v_kind text; v_hd uuid;
  v_deload boolean; v_empty boolean; v_forced uuid[] := '{}'; v_hidden uuid[] := '{}'; v_zero boolean;
  -- the checks after the week is planned
  v_again integer; v_md5_a text; v_md5_b text; v_stranger text; v_anon text; v_plans_before integer; v_plans_after integer;
begin
  -- ── the saved program: Pull 1 (Tuesdays, or a two-slot sequence) ───────────────────────────────────────────────
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Lat Pulldown', 'back') returning id into v_ex_lat;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Face Pull', 'shoulders') returning id into v_ex_face;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'EZ-Bar Curl', 'biceps') returning id into v_ex_curl;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Parallel Bar Dip', 'triceps') returning id into v_ex_dip;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Hammer Curl', 'biceps') returning id into v_ex_ham;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Cable Row', 'back') returning id into v_ex_row;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Cable Fly', 'chest') returning id into v_ex_fly;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Shrug', 'traps') returning id into v_ex_x;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
    values (v_uid, 'F1 program', 'saved', case when v_sequence then 'sequence' else 'weekday' end, v_planning) returning id into v_prog;
  insert into v2_workout_days (program_id, user_id, name, position) values (v_prog, v_uid, 'Pull 1', 1) returning id into v_wd;
  if v_sequence then
    -- Pull 1, a rest day, Pull 1 again: the workout sits in slots 1 and 3 (a null workout is a rest slot)
    insert into v2_program_sequence_items (user_id, program_id, position, workout_day_id)
      values (v_uid, v_prog, 1, v_wd), (v_uid, v_prog, 2, null), (v_uid, v_prog, 3, v_wd);
  else
    update v2_programs set schedule = jsonb_build_object('tuesday', v_wd) where id = v_prog;
  end if;
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
  if v_scenario in ('g', 'h') then
    -- EZ-Bar Curl is in the run copy from the start: two working sets and a rest-pause head with its pause
    insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_run_wd, v_uid, v_ex_curl, 3) returning id into v_rpe_curl;
    insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_rpe_curl, 1, 10, 12), (v_uid, v_rpe_curl, 2, 10, 12);
    insert into v2_program_sets (user_id, program_exercise_id, position, stage_kind, rep_min, rep_max) values (v_uid, v_rpe_curl, 3, 'rest_pause', 8, 10) returning id into v_head;
    insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (v_uid, v_rpe_curl, 3, v_head, 1, 4, 6);
  end if;

  if v_scenario = 'z' then
    -- ═══ a random world ═══════════════════════════════════════════════════════════════════════════════════════
    perform setseed((v_seed % 1000) / 1000.0);
    -- The run copy's rows: Lat Pulldown and Face Pull, 2-6 more, then each one's flags, position and link.
    v_rows := array[v_rpe_lat, v_rpe_face];
    v_n := 3 + floor(random() * 4)::integer;
    for v_i in 1..v_n loop
      insert into exercises (user_id, name, muscle_group) values (v_uid, 'Z' || v_i, 'back') returning id into v_ex_x;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_run_wd, v_uid, v_ex_x, 0) returning id into v_row;
      v_rows := v_rows || v_row;
    end loop;
    foreach v_row in array v_rows loop
      v_roll := random();
      update v2_program_exercises set
        position = floor(random() * 7)::integer,                       -- ties are likely: the (position, id) order decides
        week_only = (v_roll >= 0.70 and v_roll < 0.95),
        removed_at = case when (v_roll >= 0.50 and v_roll < 0.70) or (v_roll >= 0.88 and v_roll < 0.95) then now() end,
        replaces_program_exercise_id = case when random() < 0.45 then v_rows[1 + floor(random() * array_length(v_rows, 1))::integer] end
      where id = v_row;
    end loop;
    -- Now and then a swap story, so the cases that need several rows to line up are reached often enough: the third row is
    -- removed and always listed, the fourth was swapped in for it and removed again, the fifth took the fourth's place
    -- (live, position 2: a chain of two links reaches the listed row) and the sixth, when there is one, replaced the
    -- third too (a rival, later by position). The fourth to sixth are never listed by a source week.
    if random() < 0.55 then
      update v2_program_exercises set removed_at = now(), week_only = false, replaces_program_exercise_id = null where id = v_rows[3];
      update v2_program_exercises set removed_at = now(), week_only = false, replaces_program_exercise_id = v_rows[3] where id = v_rows[4];
      update v2_program_exercises set removed_at = null, week_only = false, replaces_program_exercise_id = v_rows[4], position = 2 where id = v_rows[5];
      v_forced := array[v_rows[3]];
      v_hidden := array[v_rows[4], v_rows[5]];
      if array_length(v_rows, 1) >= 6 and random() < 0.7 then
        update v2_program_exercises set removed_at = null, week_only = false, replaces_program_exercise_id = v_rows[3], position = 4 where id = v_rows[6];
        v_hidden := v_hidden || v_rows[6];
      end if;
    end if;
    -- A row of another workout of the run (a source week may list it: a row the run copy doesn't know)
    insert into v2_workout_days (program_id, user_id, name, position) values (v_run_prog, v_uid, 'Other day', 2) returning id into v_other_wd;
    insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_other_wd, v_uid, v_ex_dip, 1) returning id into v_rpe_ghost;
    -- 1-3 earlier weeks, with gaps; a deload flag and an empty week now and then; a random subset of the rows listed
    v_weeks := 1 + floor(random() * 3)::integer;
    v_week := 0;
    for v_k in 1..v_weeks loop
      v_week := v_week + 1 + (case when random() < 0.25 then 1 else 0 end);
      v_deload := random() < 0.15;
      v_empty := random() < 0.10;
      insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
        values (v_uid, v_meso, v_run_wd, v_week, null, v_deload) returning id into v_wpz;
      foreach v_row in array (v_rows || v_rpe_ghost) loop
        if v_row = any (v_forced) or (not v_row = any (v_hidden) and random() < (case when v_row = v_rpe_ghost then 0.10 else 0.62 end)) then
          insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
            values (v_uid, v_wpz, v_row, floor(random() * 9)::integer);
          if not v_empty and random() < 0.85 then
            v_heads := 1 + floor(random() * 3)::integer;
            v_zero := random() < 0.25;
            for v_sn in 1..v_heads loop
              v_roll := random();
              v_kind := case when v_roll >= 0.70 then (array['dropset', 'rest_pause', 'myo_reps', 'cluster'])[1 + floor(random() * 4)::integer] end;
              insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset, stage_index,
                                             is_warmup, stage_kind, target_weight, rep_min, rep_max, is_amrap, tags)
                values (v_wpz, v_uid, v_row, v_sn, floor(random() * 4)::integer, false, 0,
                        v_roll < 0.15, v_kind, round((random() * 100)::numeric, 2),
                        case when v_roll between 0.15 and 0.30 then null else 6 + floor(random() * 4)::integer end,
                        case when v_roll between 0.15 and 0.30 then null else 10 + floor(random() * 4)::integer end,
                        v_roll between 0.15 and 0.30,
                        case when random() < 0.3 then array['push here'] end)
                returning id into v_hd;
              if v_kind is not null then
                v_stages := 1 + floor(random() * 2)::integer;
                for v_i in 1..v_stages loop
                  insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset, parent_week_plan_set_id,
                                                 stage_index, is_warmup, target_weight, rep_min, rep_max)
                    -- a stage of the first head sometimes carries set number 0 (a stage left behind when its head was
                    -- renumbered): it sorts before its head, so only "heads before stages" keeps the parent link
                    values (v_wpz, v_uid, v_row, case when v_sn = 1 and v_zero then 0 else v_sn end, 0, true, v_hd, v_i, false, round((random() * 60)::numeric, 2), 6, 8);
                end loop;
              end if;
            end loop;
          end if;
        end if;
      end loop;
    end loop;
    -- the target: the next week, or one after a week nobody planned
    v_target := v_week + 1 + (case when random() < 0.20 then 1 else 0 end);
  else
    -- ═══ week 1, planned by v2_plan_week and then filled in by the user ═════════════════════════════════════════
    if v_target > 1 then
      perform v2_plan_week(v_meso, 1);
      -- the warmup (weight and a legacy RIR), the working set (RIR range 1-2, reps changed to 9-11, a cue), the dropset
      -- head and its drop (40 kg, RIR 0, AMRAP from the program), Face Pull's two sets, and an extra Face Pull set
      for v_wp1 in select id from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 1 loop
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
        if v_scenario in ('g', 'h') then
          update v2_week_plan_sets set target_weight = 30, target_rir = 2 where week_plan_id = v_wp1 and program_exercise_id = v_rpe_curl;
        end if;
      end loop;
    end if;

    -- ═══ what happens between week 1 and the target week ═══════════════════════════════════════════════════════
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
    elsif v_scenario = 'f' then
      -- a week off (DECISIONS 131): week 2 is planned and given a shape of its own (Lat Pulldown loses its working set 2
      -- and gains a fourth, Face Pull loses a set, numbers of its own); week 3 is never planned; the target is week 4
      perform v2_plan_week(v_meso, 2);
      select id into v_wp2 from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 2;
      delete from v2_week_plan_sets where week_plan_id = v_wp2 and program_exercise_id = v_rpe_lat and set_number = 2 and parent_week_plan_set_id is null;
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_weight, target_rir, rep_min, rep_max)
        values (v_wp2, v_uid, v_rpe_lat, 4, 60, 1, 6, 8);
      delete from v2_week_plan_sets where week_plan_id = v_wp2 and program_exercise_id = v_rpe_face and set_number = 2;
      update v2_week_plan_sets set target_weight = 57.5, target_rir = 2, rep_min = 8, rep_max = 10
        where week_plan_id = v_wp2 and program_exercise_id = v_rpe_lat and set_number = 3 and parent_week_plan_set_id is null;
    elsif v_scenario = 'g' then
      -- week 2 is planned, the user types numbers into it, and a 1.1 week-level ADD puts a week-only Dip in it (a
      -- program-exercise row hidden from the program, listed by this week only, at position 9)
      perform v2_plan_week(v_meso, 2);
      select id into v_wp2 from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 2;
      update v2_week_plan_sets set target_weight = 50, target_rir = 2, rep_min = 8, rep_max = 10, tags = array['maintain strength']
        where week_plan_id = v_wp2 and not is_warmup and not is_amrap and parent_week_plan_set_id is null;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, week_only)
        values (v_run_wd, v_uid, v_ex_dip, 5, true) returning id into v_rpe_dip;
      insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (v_uid, v_wp2, v_rpe_dip, 9);
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_weight, target_rir, rep_min, rep_max)
        values (v_wp2, v_uid, v_rpe_dip, 1, 0, 2, 8, 12);
      -- the save, after week 2 (week 2 is done or in progress, so a save never touches it):
      update v2_program_exercises set removed_at = now() where id = v_rpe_face;                       -- Face Pull removed
      update v2_program_exercises set removed_at = now() where id = v_rpe_curl;                       -- EZ-Bar Curl swapped out ...
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id)
        values (v_run_wd, v_uid, v_ex_ham, 3, v_rpe_curl) returning id into v_rpe_ham;               -- ... for Hammer Curl, where it was
      insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_rpe_ham, 1, 12, 15), (v_uid, v_rpe_ham, 2, 12, 15);
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_run_wd, v_uid, v_ex_row, 4) returning id into v_rpe_row; -- Cable Row added
      insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_rpe_row, 1, 10, 12);
    elsif v_scenario = 'h' then
      -- the odd rows. Run copy: Lat Pulldown and Face Pull live; EZ-Bar Curl removed (swapped out); Hammer Curl removed,
      -- replacing EZ-Bar Curl (a second swap); Cable Row live, replacing Hammer Curl (so a chain of two links reaches
      -- EZ-Bar Curl); Cable Fly live, replacing EZ-Bar Curl too (it comes later by position, so Cable Row has the
      -- sets); Shrug live and listed by week 2 with sets of its own, although it names EZ-Bar Curl as the row it
      -- replaced; two week-only slots week 2 lists (positions 7 and 8) and a removed one it lists; a row of another workout.
      update v2_program_exercises set removed_at = now(), position = 3 where id = v_rpe_curl;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, removed_at, replaces_program_exercise_id)
        values (v_run_wd, v_uid, v_ex_ham, 3, now(), v_rpe_curl) returning id into v_rpe_ham;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id)
        values (v_run_wd, v_uid, v_ex_row, 3, v_rpe_ham) returning id into v_rpe_row;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id)
        values (v_run_wd, v_uid, v_ex_fly, 4, v_rpe_curl) returning id into v_rpe_fly;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id)
        values (v_run_wd, v_uid, v_ex_x, 5, v_rpe_curl) returning id into v_rpe_keep;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, week_only) values (v_run_wd, v_uid, v_ex_dip, 6, true) returning id into v_rpe_wo1;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, week_only) values (v_run_wd, v_uid, v_ex_dip, 7, true) returning id into v_rpe_wo2;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, week_only, removed_at) values (v_run_wd, v_uid, v_ex_dip, 8, true, now()) returning id into v_rpe_gone;
      insert into v2_workout_days (program_id, user_id, name, position) values (v_run_prog, v_uid, 'Other day', 2) returning id into v_other_wd;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_other_wd, v_uid, v_ex_dip, 1) returning id into v_rpe_ghost;
      -- a link that leaves the workout: Shoulder Press (position 0, so it is met first) replaces a second row of the other
      -- workout (week 2 doesn't list it), which replaces EZ-Bar Curl. The walk goes through the rows of THIS workout only,
      -- so it ends at the other workout's row and Shoulder Press arrives with no sets (EZ-Bar Curl's go to Cable Row).
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id)
        values (v_other_wd, v_uid, v_ex_fly, 2, v_rpe_curl) returning id into v_rpe_c;
      insert into exercises (user_id, name, muscle_group) values (v_uid, 'Shoulder Press', 'shoulders') returning id into v_ex_x;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id)
        values (v_run_wd, v_uid, v_ex_x, 0, v_rpe_c) returning id into v_rpe_x;
      -- week 2, built by hand: it lists Lat Pulldown, Face Pull, EZ-Bar Curl, Shrug, the three week-only slots and the
      -- other workout's row; it does not list Hammer Curl, Cable Row or Cable Fly
      insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
        values (v_uid, v_meso, v_run_wd, 2, null, false) returning id into v_wp2;
      insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values
        (v_uid, v_wp2, v_rpe_lat, 0), (v_uid, v_wp2, v_rpe_face, 1), (v_uid, v_wp2, v_rpe_curl, 2), (v_uid, v_wp2, v_rpe_keep, 3),
        (v_uid, v_wp2, v_rpe_wo2, 7), (v_uid, v_wp2, v_rpe_wo1, 8), (v_uid, v_wp2, v_rpe_gone, 9), (v_uid, v_wp2, v_rpe_ghost, 10);
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, is_warmup, target_weight, target_rir, rep_min, rep_max) values
        (v_wp2, v_uid, v_rpe_lat, 1, true, 20, 5, 12, 12), (v_wp2, v_uid, v_rpe_lat, 2, false, 55, 1, 9, 11),
        (v_wp2, v_uid, v_rpe_face, 1, false, 15, 1, 15, 20),
        (v_wp2, v_uid, v_rpe_curl, 1, false, 30, 2, 10, 12), (v_wp2, v_uid, v_rpe_curl, 2, false, 30, 2, 10, 12),
        (v_wp2, v_uid, v_rpe_keep, 1, false, 70, 2, 10, 12), (v_wp2, v_uid, v_rpe_keep, 2, false, 70, 2, 10, 12),
        (v_wp2, v_uid, v_rpe_wo2, 1, false, 0, 2, 8, 12), (v_wp2, v_uid, v_rpe_wo1, 1, false, 0, 2, 8, 12),
        (v_wp2, v_uid, v_rpe_gone, 1, false, 0, 2, 8, 12), (v_wp2, v_uid, v_rpe_ghost, 1, false, 0, 2, 8, 12);
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, stage_kind, target_weight, target_rir, rep_min, rep_max)
        values (v_wp2, v_uid, v_rpe_curl, 3, 'rest_pause', 30, 1, 8, 10) returning id into v_head;
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, is_dropset, parent_week_plan_set_id, stage_index, target_weight, target_rir, rep_min, rep_max)
        values (v_wp2, v_uid, v_rpe_curl, 3, true, v_head, 1, 30, 0, 4, 6);
    elsif v_scenario = 'i' then
      -- a sequence run: cycle 1's slot 3 differs from slot 1 (Face Pull has one set, Lat Pulldown's working set is
      -- heavier); cycle 2 exists for slot 1 only (a lone Lat Pulldown set), so a copy that read the wrong slot's
      -- history, or the workout's latest week whichever slot it was, shows. The target is cycle 3, slots 1 and 3.
      select id into v_wp2 from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 1 and sequence_position = 3;
      delete from v2_week_plan_sets where week_plan_id = v_wp2 and program_exercise_id = v_rpe_face and set_number = 2;
      update v2_week_plan_sets set target_weight = 62.5 where week_plan_id = v_wp2 and program_exercise_id = v_rpe_lat and set_number = 2;
      insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
        values (v_uid, v_meso, v_run_wd, 2, 1, false) returning id into v_wp2;
      insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (v_uid, v_wp2, v_rpe_lat, 1);
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_weight, target_rir, rep_min, rep_max)
        values (v_wp2, v_uid, v_rpe_lat, 1, 70, 1, 5, 5);
    elsif v_scenario = 'k' then
      -- nothing usable to copy (DECISIONS 42): week 1 is a deload session, week 2 a planned row with no sets, so week 3
      -- is planned empty, whatever the run copy lists
      update v2_week_plans set is_deload = true where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = 1;
      insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
        values (v_uid, v_meso, v_run_wd, 2, null, false);
    elsif v_scenario = 'j' then
      -- links that loop: A replaces B and B replaces A (both live, neither listed), C replaces itself, X replaces A (a
      -- chain that runs into a loop it is not part of). Week 2 lists Lat Pulldown only.
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_run_wd, v_uid, v_ex_ham, 4) returning id into v_rpe_a;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id) values (v_run_wd, v_uid, v_ex_row, 5, v_rpe_a) returning id into v_rpe_b;
      update v2_program_exercises set replaces_program_exercise_id = v_rpe_b where id = v_rpe_a;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_run_wd, v_uid, v_ex_fly, 6) returning id into v_rpe_c;
      update v2_program_exercises set replaces_program_exercise_id = v_rpe_c where id = v_rpe_c;
      insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, replaces_program_exercise_id) values (v_run_wd, v_uid, v_ex_x, 7, v_rpe_a) returning id into v_rpe_x;
      insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
        values (v_uid, v_meso, v_run_wd, 2, null, false) returning id into v_wp2;
      insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (v_uid, v_wp2, v_rpe_lat, 0);
      insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, target_weight, target_rir, rep_min, rep_max)
        values (v_wp2, v_uid, v_rpe_lat, 1, 55, 1, 9, 11), (v_wp2, v_uid, v_rpe_lat, 2, 55, 1, 9, 11);
    end if;
  end if;

  -- ── the rule's input, read before the week is planned ───────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object('id', pe.id, 'exercise_id', pe.exercise_id, 'exercise_name', e.name,
                                               'position', pe.position, 'week_only', pe.week_only, 'removed_at', pe.removed_at,
                                               'replaces_program_exercise_id', pe.replaces_program_exercise_id)
                            order by pe.position, pe.id), '[]'::jsonb)
    into v_run_ex
    from v2_program_exercises pe join exercises e on e.id = pe.exercise_id
   where pe.workout_day_id = v_run_wd;
  select coalesce(jsonb_agg(to_jsonb(ps) order by ps.position, ps.stage_index, ps.id), '[]'::jsonb)
    into v_run_sets
    from v2_program_sets ps
   where ps.program_exercise_id in (select id from v2_program_exercises where workout_day_id = v_run_wd);
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_number', wp.week_number, 'is_deload', wp.is_deload,
           'exercises', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.program_exercise_id), '[]'::jsonb) from v2_week_plan_exercises x where x.week_plan_id = wp.id),
           'sets',      (select coalesce(jsonb_agg(to_jsonb(s) order by s.set_number, s.stage_index, s.id), '[]'::jsonb) from v2_week_plan_sets s where s.week_plan_id = wp.id)
         ) order by wp.week_number), '[]'::jsonb)
    into v_prior
    from v2_week_plans wp
   where wp.mesocycle_id = v_meso and wp.workout_day_id = v_run_wd and wp.week_number < v_target
     and wp.sequence_position is not distinct from v_slot;

  -- ── the week under test, planned by the migrations' own function ────────────────────────────────────────────────
  v_planned := v2_plan_week(v_meso, v_target);
  select id, is_deload into v_target_plan, v_out_deload
    from v2_week_plans where mesocycle_id = v_meso and workout_day_id = v_run_wd and week_number = v_target
     and sequence_position is not distinct from v_slot;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.program_exercise_id), '[]'::jsonb) into v_out_ex from v2_week_plan_exercises x where x.week_plan_id = v_target_plan;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.set_number, s.stage_index, s.id), '[]'::jsonb) into v_out_sets from v2_week_plan_sets s where s.week_plan_id = v_target_plan;

  -- ── a second call changes nothing, and nobody else can plan this run ─────────────────────────────────────────────
  -- Idempotent per slot: the second call plans no slot, and the slot just planned holds the same rows (the comparison is
  -- the md5 of the week's own rows, with their ids: a re-copy would replace them).
  v_md5_a := md5(coalesce((select string_agg(x.id::text || x.program_exercise_id::text || x.position, ',' order by x.id) from v2_week_plan_exercises x where x.week_plan_id = v_target_plan), '')
              || '|' || coalesce((select string_agg(s.id::text || s.program_exercise_id::text || s.set_number || s.stage_index || coalesce(s.parent_week_plan_set_id::text, ''), ',' order by s.id) from v2_week_plan_sets s where s.week_plan_id = v_target_plan), ''));
  v_again := v2_plan_week(v_meso, v_target);
  v_md5_b := md5(coalesce((select string_agg(x.id::text || x.program_exercise_id::text || x.position, ',' order by x.id) from v2_week_plan_exercises x where x.week_plan_id = v_target_plan), '')
              || '|' || coalesce((select string_agg(s.id::text || s.program_exercise_id::text || s.set_number || s.stage_index || coalesce(s.parent_week_plan_set_id::text, ''), ',' order by s.id) from v2_week_plan_sets s where s.week_plan_id = v_target_plan), ''));
  select count(*) into v_plans_before from v2_week_plans where mesocycle_id = v_meso;
  -- Another account is told no such run exists (RLS hides it; the function's own predicate says the same), and a call
  -- with no one signed in is refused; neither plans anything.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform v2_plan_week(v_meso, v_target + 1);
    v_stranger := 'NOT REFUSED';
  exception when others then
    v_stranger := sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    perform v2_plan_week(v_meso, v_target + 1);
    v_anon := 'NOT REFUSED';
  exception when others then
    v_anon := sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select count(*) into v_plans_after from v2_week_plans where mesocycle_id = v_meso;

  perform set_config('fx.result', jsonb_build_object(
    'scenario', v_scenario,
    'seed', v_seed,
    'second_call', v_again,
    'md5_before', v_md5_a,
    'md5_after', v_md5_b,
    'stranger', v_stranger,
    'anonymous', v_anon,
    'plans_before_refusals', v_plans_before,
    'plans_after_refusals', v_plans_after,
    'planning_type', v_planning,
    'week_start', coalesce((select week_start from v2_user_settings where user_id = v_uid), 'copy'),
    'week_number', v_target,
    'slot', v_slot,
    'planned', v_planned,
    'run_copy', jsonb_build_object('exercises', v_run_ex, 'sets', v_run_sets),
    'prior_weeks', v_prior,
    'output', jsonb_build_object('is_deload', v_out_deload, 'exercises', v_out_ex, 'sets', v_out_sets)
  )::text, true);
end
$fx$;

select current_setting('fx.result');
rollback;
