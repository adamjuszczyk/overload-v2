-- supabase/seed.sql — the staging seed (synthetic; no real person's data)
--
-- Runs on the persistent Supabase branch linked to the git branch `staging`,
-- and nowhere else:
--   * Supabase never seeds production: "All other configurations, including
--     API, Auth, and seed files, are ignored by default" on a production
--     deploy, and a persistent branch is seeded only when a [remotes.<name>]
--     block in supabase/config.toml names its project ref with db.seed
--     enabled. Only [remotes.staging] does; scripts/staging-config.test.mjs
--     fails if any remote names production's ref.
--   * The guard below refuses to run on a database that holds any account
--     other than the staging test account (production holds real accounts),
--     and on one that holds production's known owner id.
--
-- Everything belongs to ONE account: staging-test@example.com (example.com
-- is reserved by IANA, so no real person can own it). Its password is never
-- in this repository: if the account doesn't exist yet the seed creates it
-- with a random password nobody knows; the password that works is set on the
-- staging branch by Adam (CONTEXT.md, "Accounts") and kept in the cloud
-- environment's secret STAGING_TEST_PASSWORD.
--
-- Dates are relative to the day the seed runs (Monday of that week = week
-- start). Supabase runs a seed file once; to re-seed (for example after the
-- active run's weeks have gone by), paste this file into the staging
-- branch's SQL editor: it deletes the test account's data and rebuilds it,
-- keeping the account and its password.
--
-- Data shapes covered (SPEC.md [P1]/[P1.1]/[1.2] and TASKS-1.2's F1–F6, G50):
--   STG Upper/Lower   saved, weekday, week-dependent, with a non-empty
--                     deload-rules override (F5); template of the ACTIVE run
--   STG Upper/Lower run  active, week 3 is the current week:
--                     week 1 all done (a skipped set, a swap, a session done
--                     on a moved day), week 2 (Wed deload, Fri skipped
--                     session), week 3 Monday in progress with logged and
--                     unlogged sets, weeks 4+ unplanned
--                     warmup sets, a superset, all four stage kinds,
--                     AMRAP, tempo, rest overrides, rest after, a lbs
--                     exercise, tags, weight and RIR targets, the warmup
--                     routine, priorities (focus / don't care)
--   STG Full Body     saved, weekday, STABLE, one workout on two weekdays
--                     (G14); its run finished (1.1-era: marks in
--                     v2_program_priorities), last week a deload
--   STG PPL           saved; its run finished BEFORE 1.1: marks only in the
--                     old v2_coach_meso_tag_priorities table (G50), plan rows
--                     with RIR only, legacy null-kind dropset logs (D30), an
--                     all-skipped session
--   STG Rotation      saved, SEQUENCE (workout and rest slots, a repeat)
--   STG Empty         saved, no workouts, no schedule (empty states)
--   STG No exercises  saved, one workout with no exercises, no schedule
-- Settings: global deload rules on (so the override and the default differ).

do $seed$
declare
  c_email   constant text := 'staging-test@example.com';
  c_new_id  constant uuid := '7e57ac00-0000-4000-8000-000000000001';
  -- Production's owner account. Its presence means this is not staging.
  c_prod_marker constant uuid := '12e79b69-9891-4f53-a7cf-650edd83659f';
  t   uuid;
  d0  date := date_trunc('week', current_date)::date;  -- this Monday
  tbl text;
  pass int;
  left_over int;
  -- exercises
  e_bench uuid; e_incline uuid; e_row uuid; e_lat_raise uuid; e_pushdown uuid;
  e_squat uuid; e_rdl uuid; e_leg_curl uuid; e_calf uuid; e_pullup uuid;
  e_ohp uuid; e_curl uuid; e_leg_press uuid; e_plank uuid; e_farmer uuid;
  e_dip uuid; e_pulldown uuid;
  -- programs and workouts
  p_ul uuid; w_ua uuid; w_la uuid; w_ub uuid;
  p_fb uuid; w_fb uuid; w_arms uuid;
  p_ppl uuid; w_push uuid; w_pull uuid; w_legs uuid;
  p_rot uuid; w_ra uuid; w_rb uuid; w_rc uuid;
  p_empty uuid; p_noex uuid;
  pe uuid; blk uuid; h uuid;
  -- runs
  m_fb uuid; m_ppl uuid; m_ul uuid; run_prog uuid;
  r record; s uuid; hl uuid;
begin
  -- ── Guard ────────────────────────────────────────────────────────────────
  if exists (select 1 from auth.users where id = c_prod_marker) then
    raise exception 'seed.sql refuses to run: this database holds production''s owner account';
  end if;
  if exists (select 1 from auth.users where email is distinct from c_email) then
    raise exception 'seed.sql refuses to run: this database holds an account other than %', c_email;
  end if;

  -- ── The staging test account ────────────────────────────────────────────
  select id into t from auth.users where email = c_email;
  if t is null then
    t := c_new_id;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token,
                            email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', t, 'authenticated', 'authenticated', c_email,
            extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt('bf')),
            now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), t, t::text,
            jsonb_build_object('sub', t::text, 'email', c_email, 'email_verified', true),
            'email', now(), now(), now());
  end if;

  -- ── Start clean: delete the account's data, keep the account ────────────
  -- Every public table with a user_id column, repeated until foreign keys
  -- stop getting in the way (cascades do most of it on the first pass).
  for pass in 1..6 loop
    left_over := 0;
    for tbl in
      select c.table_name from information_schema.columns c
      join information_schema.tables x using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'user_id' and x.table_type = 'BASE TABLE'
      order by c.table_name
    loop
      begin
        execute format('delete from public.%I where user_id = $1', tbl) using t;
      exception when foreign_key_violation then
        left_over := left_over + 1;
      end;
    end loop;
    exit when left_over = 0;
  end loop;

  -- The app's SQL functions read auth.uid(); act as the test account.
  perform set_config('request.jwt.claim.sub', t::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t::text, 'role', 'authenticated')::text, true);

  -- ── Settings ────────────────────────────────────────────────────────────
  insert into v2_user_settings (user_id, deload_rules)
  values (t, '{"sets":{"mode":"percent","value":50,"rounding":"down"},"weight":{"percent":75,"rounding":"down","step":2.5,"stepUnit":"kg"}}');

  -- ── Exercises (the account's own library) ───────────────────────────────
  insert into exercises (user_id, name, muscle_group, movement_pattern, muscle_subgroup) values
    (t, 'Barbell Bench Press', 'chest', 'horizontal_push', '{mid_chest}') returning id into e_bench;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Incline Dumbbell Press', 'chest', 'horizontal_push') returning id into e_incline;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Seated Cable Row', 'back', 'horizontal_pull') returning id into e_row;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Dumbbell Lateral Raise', 'shoulders', 'isolation') returning id into e_lat_raise;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Cable Triceps Pushdown', 'triceps', 'isolation') returning id into e_pushdown;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Back Squat', 'quads', 'squat') returning id into e_squat;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Romanian Deadlift', 'hamstrings', 'hip_hinge') returning id into e_rdl;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Lying Leg Curl', 'hamstrings', 'isolation') returning id into e_leg_curl;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Standing Calf Raise', 'calves', 'isolation') returning id into e_calf;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Pull-Up', 'back', 'vertical_pull') returning id into e_pullup;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Overhead Press', 'shoulders', 'vertical_push') returning id into e_ohp;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'EZ-Bar Curl', 'biceps', 'isolation') returning id into e_curl;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Leg Press', 'quads', 'squat') returning id into e_leg_press;
  insert into exercises (user_id, name, muscle_group) values (t, 'Plank', 'core') returning id into e_plank;
  insert into exercises (user_id, name, muscle_group) values (t, 'Farmer Carry', 'other') returning id into e_farmer;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Parallel Bar Dip', 'triceps', 'vertical_push') returning id into e_dip;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (t, 'Lat Pulldown', 'back', 'vertical_pull') returning id into e_pulldown;

  -- ── STG Upper/Lower: saved, weekday, week-dependent ─────────────────────
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type, deload_rules)
  values (t, 'STG Upper/Lower', 'saved', 'weekday', 'week_dependent',
          '{"sets":{"mode":"count","value":1,"rounding":"down"},"rir":{"delta":2}}')
  returning id into p_ul;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ul, t, 'Upper A', 1) returning id into w_ua;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ul, t, 'Lower A', 2) returning id into w_la;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ul, t, 'Upper B', 3) returning id into w_ub;
  update v2_programs set schedule = jsonb_build_object('monday', w_ua, 'wednesday', w_la, 'friday', w_ub) where id = p_ul;

  -- Upper A: bench (1 warmup + 3 working, set rest 180 s), superset row + raise, pushdown with a dropset
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, rest_seconds, rest_after_seconds)
  values (w_ua, t, e_bench, 1, 180, 240) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup, rep_min, rep_max) values (t, pe, 1, true, 10, 10);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, rest_seconds) values (t, pe, 2, 6, 8, 200);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 3, 6, 8), (t, pe, 4, 6, 8);
  insert into v2_program_superset_blocks (user_id, workout_day_id, rest_within_round_seconds, rest_after_round_seconds)
  values (t, w_ua, 0, 120) returning id into blk;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, superset_block_id) values (w_ua, t, e_row, 2, blk) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12), (t, pe, 2, 10, 12), (t, pe, 3, 10, 12);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, superset_block_id, weight_unit) values (w_ua, t, e_lat_raise, 3, blk, 'lbs') returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 12, 15), (t, pe, 2, 12, 15), (t, pe, 3, 12, 15);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ua, t, e_pushdown, 4) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, stage_kind) values (t, pe, 2, 10, 12, 'dropset') returning id into h;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (t, pe, 2, h, 1, 8, 10), (t, pe, 2, h, 2, 6, 8);
  insert into v2_workout_warmup_items (user_id, workout_day_id, position, body) values
    (t, w_ua, 1, '5 min easy row'), (t, w_ua, 2, 'Band pull-aparts x20'), (t, w_ua, 3, 'Shoulder circles');

  -- Lower A: squat (2 warmups, 3 working, last AMRAP), RDL with tempo, leg curl myo-reps, calf rest-pause
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, rest_seconds) values (w_la, t, e_squat, 1, 180) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup, rep_min, rep_max) values (t, pe, 1, true, 8, 8), (t, pe, 2, true, 5, 5);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 3, 5, 6), (t, pe, 4, 5, 6);
  insert into v2_program_sets (user_id, program_exercise_id, position, is_amrap) values (t, pe, 5, true);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, tempo) values (w_la, t, e_rdl, 2, '3-1-1-0') returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 8, 10), (t, pe, 2, 8, 10), (t, pe, 3, 8, 10);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_la, t, e_leg_curl, 3) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, stage_kind, stage_rest_seconds) values (t, pe, 1, 12, 15, 'myo_reps', 10) returning id into h;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (t, pe, 1, h, 1, 4, 5), (t, pe, 1, h, 2, 4, 5), (t, pe, 1, h, 3, 4, 5);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_la, t, e_calf, 4) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, stage_kind) values (t, pe, 2, 10, 12, 'rest_pause') returning id into h;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (t, pe, 2, h, 1, 3, 5);

  -- Upper B: pull-up cluster, OHP, curl
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ub, t, e_pullup, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, stage_kind, stage_rest_seconds) values (t, pe, 1, 3, 3, 'cluster', 20) returning id into h;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (t, pe, 1, h, 1, 3, 3), (t, pe, 1, h, 2, 3, 3);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 2, 6, 8), (t, pe, 3, 6, 8);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ub, t, e_ohp, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 6, 8), (t, pe, 2, 6, 8), (t, pe, 3, 6, 8);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ub, t, e_curl, 3) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12), (t, pe, 2, 10, 12);

  insert into v2_program_priorities (user_id, program_id, tag_type, tag_value, mark) values
    (t, p_ul, 'muscle_group', 'chest', 'focus'), (t, p_ul, 'muscle_group', 'calves', 'dont_care');

  -- ── STG Full Body: saved, weekday, stable; one workout on Tue and Thu (G14) ──
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
  values (t, 'STG Full Body', 'saved', 'weekday', 'stable') returning id into p_fb;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_fb, t, 'Full Body', 1) returning id into w_fb;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_fb, t, 'Arms', 2) returning id into w_arms;
  update v2_programs set schedule = jsonb_build_object('tuesday', w_fb, 'thursday', w_fb, 'saturday', w_arms) where id = p_fb;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_fb, t, e_leg_press, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12), (t, pe, 2, 10, 12), (t, pe, 3, 10, 12);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_fb, t, e_incline, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 8, 10), (t, pe, 2, 8, 10);
  insert into v2_program_superset_blocks (user_id, workout_day_id, rest_after_round_seconds) values (t, w_fb, 90) returning id into blk;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, superset_block_id) values (w_fb, t, e_pulldown, 3, blk) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12), (t, pe, 2, 10, 12);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, superset_block_id) values (w_fb, t, e_plank, 4, blk) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_amrap) values (t, pe, 1, true), (t, pe, 2, true);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_arms, t, e_curl, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 10, 12);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, stage_kind) values (t, pe, 2, 10, 12, 'dropset') returning id into h;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (t, pe, 2, h, 1, 8, 10);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_arms, t, e_dip, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 8, 12), (t, pe, 2, 8, 12);
  insert into v2_program_priorities (user_id, program_id, tag_type, tag_value, mark) values
    (t, p_fb, 'muscle_group', 'quads', 'focus');

  -- ── STG PPL: saved; template of the pre-1.1 finished run ────────────────
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
  values (t, 'STG PPL', 'saved', 'weekday', 'week_dependent') returning id into p_ppl;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ppl, t, 'Push', 1) returning id into w_push;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ppl, t, 'Pull', 2) returning id into w_pull;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ppl, t, 'Legs', 3) returning id into w_legs;
  update v2_programs set schedule = jsonb_build_object('monday', w_push, 'wednesday', w_pull, 'friday', w_legs) where id = p_ppl;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_push, t, e_bench, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position) values (t, pe, 1), (t, pe, 2), (t, pe, 3);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_push, t, e_pushdown, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position) values (t, pe, 1), (t, pe, 2);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_pull, t, e_row, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position) values (t, pe, 1), (t, pe, 2), (t, pe, 3);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_pull, t, e_curl, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position) values (t, pe, 1), (t, pe, 2);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_legs, t, e_squat, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position) values (t, pe, 1), (t, pe, 2), (t, pe, 3);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_legs, t, e_calf, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position) values (t, pe, 1), (t, pe, 2);

  -- ── STG Rotation: saved, sequence (A, B, rest, A, C, rest) ──────────────
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
  values (t, 'STG Rotation', 'saved', 'sequence', 'week_dependent') returning id into p_rot;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_rot, t, 'Rotation A', 1) returning id into w_ra;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_rot, t, 'Rotation B', 2) returning id into w_rb;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_rot, t, 'Rotation C', 3) returning id into w_rc;
  insert into v2_program_sequence_items (user_id, program_id, position, workout_day_id) values
    (t, p_rot, 1, w_ra), (t, p_rot, 2, w_rb), (t, p_rot, 3, null), (t, p_rot, 4, w_ra), (t, p_rot, 5, w_rc), (t, p_rot, 6, null);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ra, t, e_squat, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 5, 5), (t, pe, 2, 5, 5);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_rb, t, e_bench, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (t, pe, 1, 5, 5), (t, pe, 2, 5, 5);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_rc, t, e_farmer, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_amrap) values (t, pe, 1, true);

  -- ── Empty states ────────────────────────────────────────────────────────
  insert into v2_programs (user_id, name, kind) values (t, 'STG Empty', 'saved') returning id into p_empty;
  insert into v2_programs (user_id, name, kind) values (t, 'STG No exercises', 'saved') returning id into p_noex;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_noex, t, 'Day 1', 1);

  -- ═══ Runs ═════════════════════════════════════════════════════════════════

  -- ── Pre-1.1 finished run of STG PPL (13 to 9 weeks ago) ─────────────────
  -- Made the way migration 028 turned an old mesocycle's program into its run
  -- copy: v2_copy_program, no v2_start_run; marks only in the old table.
  run_prog := v2_copy_program(p_ppl, t, 'run', 'STG PPL');
  insert into v2_mesocycles (user_id, name, program_id, status, start_date, end_date, source_program_id)
  values (t, 'STG PPL block (pre-1.1)', run_prog, 'completed', d0 - 91, d0 - 63, p_ppl) returning id into m_ppl;
  for wk in 1..4 loop
    perform v2_plan_week(m_ppl, wk);
  end loop;
  -- Old plan rows carried RIR targets only: no rep targets, no weights.
  update v2_week_plan_sets set rep_min = null, rep_max = null, target_weight = null, target_rir = 2
  where user_id = t and week_plan_id in (select id from v2_week_plans where mesocycle_id = m_ppl);
  insert into v2_coach_meso_tag_priorities (user_id, mesocycle_id, tag_type, tag_value, priority) values
    (t, m_ppl, 'muscle_group', 'chest', 'top'), (t, m_ppl, 'muscle_group', 'back', 'high'),
    (t, m_ppl, 'muscle_group', 'calves', 'low');

  -- ── 1.1-era finished stable run of STG Full Body (5 to 3 weeks ago) ─────
  m_fb := v2_start_run(p_fb, 'STG Full Body run', d0 - 35);
  for wk in 1..3 loop
    perform v2_plan_week(m_fb, wk);
  end loop;
  update v2_week_plans set is_deload = true where mesocycle_id = m_fb and week_number = 3;

  -- ── Active week-dependent run of STG Upper/Lower (week 3 is this week) ──
  -- Starting it completes the Full Body run, as START does.
  m_ul := v2_start_run(p_ul, 'STG Upper/Lower run', d0 - 14);
  perform v2_plan_week(m_ul, 1);
  -- Week 1's targets; week 2 copies them (week-dependent).
  update v2_week_plan_sets ws set
    target_weight = case pe2.exercise_id
      when e_bench then case when ws.is_warmup then 40 else 80 end
      when e_row then 60 when e_lat_raise then 9 when e_pushdown then case when ws.stage_index > 0 then 25 - 5 * ws.stage_index else 30 end
      when e_squat then case when ws.is_warmup then 60 else 110 end
      when e_rdl then 90 when e_leg_curl then 35 when e_calf then 70
      when e_pullup then 0 when e_ohp then 50 when e_curl then 30 end,
    target_rir = case when ws.is_warmup then null when ws.stage_index > 0 then 0 else 2 end
  from v2_program_exercises pe2
  where pe2.id = ws.program_exercise_id and ws.user_id = t
    and ws.week_plan_id in (select id from v2_week_plans where mesocycle_id = m_ul and week_number = 1);
  update v2_week_plan_sets set tags = array['push here']
  where user_id = t and parent_week_plan_set_id is null and not is_warmup and set_number = 2
    and week_plan_id in (select id from v2_week_plans where mesocycle_id = m_ul and week_number = 1 and workout_day_id in
      (select id from v2_workout_days where program_id = (select program_id from v2_mesocycles where id = m_ul) and name = 'Upper A'));
  perform v2_plan_week(m_ul, 2);
  perform v2_plan_week(m_ul, 3);
  -- Week 2's Lower A is a deload session.
  update v2_week_plans set is_deload = true
  where mesocycle_id = m_ul and week_number = 2
    and workout_day_id = (select id from v2_workout_days where program_id = (select program_id from v2_mesocycles where id = m_ul) and name = 'Lower A');
  -- Week 3: a little heavier than week 2 (week-dependent weeks differ).
  update v2_week_plan_sets set target_weight = target_weight + 2.5
  where user_id = t and target_weight > 0 and not is_warmup
    and week_plan_id in (select id from v2_week_plans where mesocycle_id = m_ul and week_number = 3);

  -- ═══ Sessions and set logs ════════════════════════════════════════════════
  -- One session per planned slot and scheduled weekday (a workout on two
  -- weekdays, G14, gets two sessions on one shared plan row), dated by the
  -- run's schedule; logs follow the plan (target weight, rep_max or 8 reps,
  -- target RIR).
  for r in
    select wp.id as wp_id, wp.mesocycle_id, wp.workout_day_id, wp.week_number, wp.is_deload,
           m.start_date, wd.name as wd_name, j.k as day_name,
           array_position(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], j.k) as dow
    from v2_week_plans wp
    join v2_mesocycles m on m.id = wp.mesocycle_id
    join v2_workout_days wd on wd.id = wp.workout_day_id
    join v2_programs p on p.id = m.program_id
    cross join lateral jsonb_each_text(p.schedule) as j(k, v)
    where wp.user_id = t and j.v = wp.workout_day_id::text
    order by m.start_date, wp.week_number, 9
  loop
    declare
      sess_date date;
      sess_status text := 'completed';
      upto int := null;          -- log only the first N heads (in-progress session)
      skip_set int := null;      -- this head is logged as skipped
      moved date := null;
      logged_at timestamptz;
      head record; st record; i int := 0;
    begin
      sess_date := r.start_date + (r.week_number - 1) * 7 + r.dow - 1;

      if r.mesocycle_id = m_ul and r.week_number = 1 and r.wd_name = 'Upper B' then
        moved := sess_date + 1; skip_set := 3;            -- done on Saturday; one set skipped
      elsif r.mesocycle_id = m_ul and r.week_number = 2 and r.wd_name = 'Upper B' then
        sess_status := 'skipped';                          -- a skipped session, no logs
      elsif r.mesocycle_id = m_ul and r.week_number = 3 then
        if r.wd_name = 'Upper A' then sess_status := 'in_progress'; upto := 3;
        else continue;                                     -- not trained yet
        end if;
      elsif r.mesocycle_id = m_ppl and r.week_number = 4 and r.wd_name = 'Legs' then
        skip_set := -1;                                    -- every set skipped
      end if;

      logged_at := (coalesce(moved, sess_date) + time '18:00') at time zone 'UTC';
      insert into v2_sessions (user_id, mesocycle_id, week_plan_id, workout_day_id, date, moved_to_date,
                               status, started_at, completed_at, energy_rating, pump_rating, note)
      values (t, r.mesocycle_id, r.wp_id, r.workout_day_id, sess_date, moved, sess_status,
              case when sess_status = 'skipped' then null else logged_at end,
              case when sess_status = 'completed' then logged_at + interval '70 minutes'
                   when sess_status = 'skipped' then null end,
              case when sess_status = 'completed' then 'normal' end,
              case when sess_status = 'completed' then 'good' end,
              case when r.is_deload then 'Deload, felt fresh.' end)
      returning id into s;
      if sess_status = 'skipped' then continue; end if;

      for head in
        select ws.*, pe3.exercise_id from v2_week_plan_sets ws
        join v2_program_exercises pe3 on pe3.id = ws.program_exercise_id
        left join v2_week_plan_exercises wpe on wpe.week_plan_id = ws.week_plan_id and wpe.program_exercise_id = ws.program_exercise_id
        where ws.week_plan_id = r.wp_id and ws.parent_week_plan_set_id is null
        order by wpe.position, ws.set_number
      loop
        i := i + 1;
        exit when upto is not null and i > upto;
        logged_at := logged_at + interval '3 minutes';
        if skip_set = -1 or skip_set = i then
          insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, is_skipped, logged_at, is_warmup)
          values (t, s, head.exercise_id, head.id, head.set_number, true, logged_at, head.is_warmup);
          continue;
        end if;
        insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir,
                                 logged_at, rest_seconds, is_warmup, stage_kind, entered_unit, form_rating)
        values (t, s, head.exercise_id, head.id, head.set_number,
                coalesce(head.target_weight, 50), coalesce(head.rep_max, head.rep_min, 8),
                case when head.is_warmup then null else coalesce(head.target_rir, 2) end,
                logged_at, case when i > 1 then 150 end, head.is_warmup,
                -- pre-1.1 logs carry no stage kind (legacy dropsets read as dropset)
                case when r.mesocycle_id = m_ppl then null else head.stage_kind end,
                'kg', case when i % 3 = 0 then 'controlled' end)
        returning id into hl;
        for st in
          select * from v2_week_plan_sets where parent_week_plan_set_id = head.id order by stage_index
        loop
          logged_at := logged_at + interval '20 seconds';
          insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir,
                                   logged_at, is_dropset, parent_set_id, stage_index, entered_unit)
          values (t, s, head.exercise_id, st.id, head.set_number, coalesce(st.target_weight, head.target_weight, 40),
                  coalesce(st.rep_max, 6), 0, logged_at, true, hl, st.stage_index, 'kg');
        end loop;
      end loop;
    end;
  end loop;

  -- Pre-1.1: a legacy dropset logged before stage kinds existed (D30): a head
  -- with is_dropset and a stage whose parent has no kind.
  select s2.id into s from v2_sessions s2 where s2.mesocycle_id = m_ppl and s2.status = 'completed' order by s2.date limit 1;
  select id into hl from v2_set_logs where session_id = s and parent_set_id is null and not is_skipped order by logged_at desc limit 1;
  insert into v2_set_logs (user_id, session_id, exercise_id, set_number, weight, reps, rir, logged_at, is_dropset, parent_set_id, stage_index)
  select t, s, exercise_id, set_number, weight - 10, reps, 0, logged_at + interval '30 seconds', true, id, 1
  from v2_set_logs where id = hl;
  -- The all-skipped pre-1.1 session completes as skipped.
  update v2_sessions set status = 'skipped', completed_at = null, energy_rating = null, pump_rating = null
  where mesocycle_id = m_ppl and id in (select session_id from v2_set_logs group by session_id having bool_and(is_skipped));

  -- Week 1 Lower A of the active run: the squat swapped for leg press that day.
  select s2.id into s from v2_sessions s2 join v2_workout_days wd on wd.id = s2.workout_day_id
  where s2.mesocycle_id = m_ul and wd.name = 'Lower A' and s2.week_plan_id in
    (select id from v2_week_plans where mesocycle_id = m_ul and week_number = 1);
  insert into v2_session_exercise_swaps (user_id, session_id, program_exercise_id, original_exercise_id,
                                         original_exercise_name, replacement_exercise_id, replacement_exercise_name)
  select t, s, pe4.id, e_squat, 'Back Squat', e_leg_press, 'Leg Press'
  from v2_program_exercises pe4 join v2_workout_days wd on wd.id = pe4.workout_day_id
  where wd.program_id = (select program_id from v2_mesocycles where id = m_ul) and wd.name = 'Lower A' and pe4.exercise_id = e_squat;
  update v2_set_logs set exercise_id = e_leg_press, weight = 180
  where session_id = s and exercise_id = e_squat and not is_warmup;

  raise notice 'staging seed: % programs, % runs, % sessions, % set logs for %',
    (select count(*) from v2_programs where user_id = t), (select count(*) from v2_mesocycles where user_id = t),
    (select count(*) from v2_sessions where user_id = t), (select count(*) from v2_set_logs where user_id = t), c_email;
end
$seed$;
