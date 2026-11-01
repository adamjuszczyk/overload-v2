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
--     other than the five staging accounts (production holds real accounts),
--     and on one that holds production's known owner id.
--
-- Five synthetic accounts (example.com is reserved by IANA, so no real person
-- can own any of them):
--   staging-test@example.com      the test account: owns most of what is below.
--     Its password is never in this repository: if the account doesn't exist
--     yet the seed creates it with a random password nobody knows; the
--     password that works is set on the staging branch by Adam (CONTEXT.md,
--     "Accounts") and kept in the cloud environment's secret
--     STAGING_TEST_PASSWORD. Since 1.2.1 (migration 048) it is the one
--     account exempt from maintenance (v2_app_status.exempt_user_ids): one
--     flip of maintenance on staging shows the strip on it and the screen on
--     staging-stable, which is not exempt.
--   staging-other@example.com     never signs in (random password nobody
--     knows): owns a small program, run, session, logs, a note and a mark, so
--     verify-rls run as the test account has foreign rows it must not see
--     (DECISIONS 118).
--   staging-stable@example.com    (TASKS-1.2 chunk 36) its own STG Full Body,
--     started as an active STABLE run: week 1 done, week 2 (this week)
--     planned, nothing done in it.
--   staging-sequence@example.com  its own STG Rotation, started as an active
--     SEQUENCE run: cycle 1 done, cycle 2 planned and current, Rotation A next
--     due. Cycle 2 also carries the edits 1.1 let a user make in the week view
--     (the 1.1-shaped run migration 046 is rehearsed on: see "STG Rotation run,
--     cycle 2" below).
--   staging-empty@example.com     the account and nothing else (no programs,
--     runs, exercises or settings row).
--   The three newer accounts sign in with the test account's password: when
--   one is created, its password hash is copied from the test account's row
--   (so STAGING_TEST_PASSWORD signs in to all four). On a database with no
--   test account yet they get the same random password, and Adam sets it in
--   the dashboard as he did for the test account. An existing account is
--   never touched.
--
-- Dates are relative to the day the seed runs (Monday of that week = week
-- start). Supabase runs a seed file once; to re-seed (for example after the
-- active run's weeks have gone by, or after this file changes), paste it into
-- the staging branch's SQL editor: it deletes all five accounts' data and
-- rebuilds it, keeping the accounts and their passwords.
--
-- Data shapes covered (SPEC.md [P1]/[P1.1]/[1.2] and TASKS-1.2's F1–F6, G50):
--   STG Upper/Lower   saved, weekday, week-dependent, with a non-empty
--                     deload-rules override (F5); template of the ACTIVE run
--   STG Upper/Lower run  active, week 3 is the current week:
--                     week 1 all done (a skipped set, a swap, a session done
--                     on a moved day), week 2 (Mon Upper A done differently
--                     from its plan, see below; Wed deload; Fri skipped
--                     session), week 3 Monday in progress with logged and
--                     unlogged sets, weeks 4+ unplanned
--                     warmup sets, a superset, all four stage kinds,
--                     AMRAP, tempo, rest overrides, rest after, a lbs
--                     exercise, tags, weight and RIR targets, the warmup
--                     routine, priorities (focus / don't care)
--   Week 2 Upper A    (REVIEW's and VOLUME's last week) five differences from
--                     its plan: bench working set 2 logged 82.5 kg x 7
--                     (planned 80 kg, 6-8 reps), bench working set 3 logged
--                     80 kg x 5 (below the range), seated cable row set 3
--                     skipped, lateral raise set 1 logged as a dropset with one
--                     logged drop, a cable pushdown head logged with no planned
--                     set behind it (20 kg x 15). Everything else as planned.
--                     Sets are numbered the way the workout screen numbers
--                     them: 1-based per exercise, warmups apart.
--   STG Full Body     saved, weekday, STABLE, one workout on two weekdays
--                     (G14); its run finished (1.1-era: marks in
--                     v2_program_priorities), last week a deload. Also owned
--                     by staging-stable, as an active run. Since 1.2.1 the
--                     finished run also carries five Coach rows for the full
--                     delete's counts (v2_finished_run_counts reads 3 analyses
--                     and 1 note on it): a note and a session analysis on its
--                     first session, a program analysis, a weekly analysis
--                     naming only its sessions of week 1, and a control weekly
--                     analysis naming its last session and the active run's
--                     first (a mixed week: the full delete leaves it, and the
--                     count leaves it out). See "Coach rows on the finished
--                     run" below.
--   STG PPL           saved; its run finished BEFORE 1.1: marks only in the
--                     old v2_coach_meso_tag_priorities table (G50), plan rows
--                     with RIR only, legacy null-kind dropset logs (D30), an
--                     all-skipped session
--   STG Rotation      saved, SEQUENCE (workout and rest slots, a repeat).
--                     Also owned by staging-sequence, as an active run.
--   STG Rotation run, cycle 2 (staging-sequence)   1.1-shaped (TASKS-1.2 chunk
--                     53; DECISIONS 149 (c), 196): a run that 1.1 changed in the
--                     week view, which migration 046 reconciles (it makes each
--                     active week-dependent run's program match its last planned
--                     week). Written the way 1.1 wrote it (weekPlanService.ts,
--                     runProgramExercises.ts), in the week that is each
--                     workout's last planned one:
--                       Rotation A, slot 4  SWAP Back Squat for Leg Press: the
--                                           week lists a week-only Leg Press and
--                                           the run copy still lists the squat
--                       Rotation B          the program tab's REMOVE of Bench
--                                           Press (soft-removed; the week still
--                                           lists it) and an added Barbell Row
--                       Rotation C          an added Dumbbell Curl, REORDERed
--                                           above Farmer Carry
--                     Rotation A's slot 1 is left as planned (a repeated
--                     workout edited in one of its slots). The run copy's
--                     program and these weeks disagree until 046 has run; a
--                     re-seed makes the shape again, and 046 is not re-run by a
--                     seed (it runs once, at a deploy), see the block's comment.
--   STG Empty         saved, no workouts, no schedule (empty states)
--   STG No exercises  saved, one workout with no exercises, no schedule
-- Settings: global deload rules on (so the override and the default differ),
-- on the test account and on staging-stable.
--
-- Numbers in later weeks: since migration 045, v2_plan_week plans a week-
-- dependent week from the week before with its structure and none of its
-- numbers (SPEC [1.2], "What the auto-copy takes": weight, RIR, reps and AMRAP
-- come with COPY in the app). The seed copies them itself where a later week
-- needs them (STG Upper/Lower's weeks 2 and 3, STG Rotation's cycle 2), set by
-- set from the week before (the same planned set's weight, RIR, rep targets and
-- AMRAP; the same planned set is the same exercise row, set number, stage and
-- warmup flag), so the world is the same whichever version of v2_plan_week the
-- database has. Each copy is checked right after it (DECISIONS 219: on staging
-- weeks 2 and 3 came out without their numbers, nothing said so, and the logs
-- took their 50 kg fallback): a planned set that found no source set, or differs
-- from it, stops the seed with an error that names the counts, and nothing is
-- seeded.

-- ── Privileges a new branch lacks ───────────────────────────────────────────
-- Supabase creates a branch "without default privileges on the public
-- schema" (Supabase docs, Working with branches). Production has the
-- platform's defaults, read from production's image (supabase/postgres
-- 17.6.1.155, pg_default_acl): role postgres's new tables, sequences and
-- functions in public are granted to anon, authenticated and service_role.
-- The migrations rely on that (only 000 grants explicitly, and none revoke a table's privileges
-- before 048's v2_app_status; see the block after the grants),
-- so without this the app's tables answer 42501 on staging (seen 2026-10-14:
-- v2_programs denied to anon and authenticated). RLS still decides which
-- rows anyone sees. This file runs on the staging branch only, so production
-- is untouched; the default privileges also cover tables later migrations
-- create on staging.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- 1.2.1 (migration 048): v2_app_status is read by anyone and written by nobody through the API, and its revokes say so. The blanket
-- grants above hand the API roles ALL on it again. RLS alone would still stop every write, but silently (an update or a delete matches
-- no row and answers 200 / 204; production answers 42501), so its grants are put back as the migration made them. A branch that has
-- not applied 048 has no such table. (The functions 048's revokes closed to anon are open again here too: each refuses an anon caller
-- itself, with auth.uid() null, so only the answer differs from production's.)
do $grants$
begin
  if to_regclass('public.v2_app_status') is not null then
    revoke all on public.v2_app_status from public, anon, authenticated, service_role;
    grant select on public.v2_app_status to anon, authenticated, service_role;
  end if;
end
$grants$;

do $seed$
declare
  c_email   constant text := 'staging-test@example.com';
  c_new_id  constant uuid := '7e57ac00-0000-4000-8000-000000000001';
  c_other_email constant text := 'staging-other@example.com';
  c_other_id    constant uuid := '7e57ac00-0000-4000-8000-000000000002';
  c_stable_email constant text := 'staging-stable@example.com';
  c_stable_id    constant uuid := '7e57ac00-0000-4000-8000-000000000003';
  c_seq_email    constant text := 'staging-sequence@example.com';
  c_seq_id       constant uuid := '7e57ac00-0000-4000-8000-000000000004';
  c_empty_email  constant text := 'staging-empty@example.com';
  c_empty_id     constant uuid := '7e57ac00-0000-4000-8000-000000000005';
  -- Production's owner account. Its presence means this is not staging.
  c_prod_marker constant uuid := '12e79b69-9891-4f53-a7cf-650edd83659f';
  t   uuid;
  o   uuid;   -- the other account
  u_stable uuid;  -- staging-stable
  u_seq    uuid;  -- staging-sequence
  u_empty  uuid;  -- staging-empty
  acct record;
  d0  date := date_trunc('week', current_date)::date;  -- this Monday
  d_today date := current_date;                        -- the seed's day
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
  -- staging-stable: its own STG Full Body, active stable run
  se_leg_press uuid; se_incline uuid; se_pulldown uuid; se_plank uuid; se_curl uuid; se_dip uuid;
  sp_fb uuid; sw_fb uuid; sw_arms uuid; m_st uuid;
  -- staging-sequence: its own STG Rotation, active sequence run
  qe_squat uuid; qe_bench uuid; qe_farmer uuid;
  qe_leg_press uuid; qe_row uuid; qe_curl uuid;   -- the 1.1-shaped cycle 2's swapped-in and added exercises
  qp_rot uuid; qw_ra uuid; qw_rb uuid; qw_rc uuid; m_q uuid;
  -- the check after each numbers copy (weeks 2-3 of STG Upper/Lower, cycle 2 of STG Rotation)
  cp_total int; cp_found int; cp_differ int; cp_weights int; cp_reps int; cp_by_pset int;
  -- the Coach rows on the finished STG Full Body run (1.2.1): its first and last sessions, the active run's first, week 1's Monday,
  -- and the two weekly analyses' rosters
  cf_first uuid; cf_last uuid; cf_ul uuid; cf_ws date; cf_ul_ws date; cf_run jsonb; cf_mixed jsonb;
begin
  -- ── Guard ────────────────────────────────────────────────────────────────
  if exists (select 1 from auth.users where id = c_prod_marker) then
    raise exception 'seed.sql refuses to run: this database holds production''s owner account';
  end if;
  if exists (select 1 from auth.users
             where email is null
                or email not in (c_email, c_other_email, c_stable_email, c_seq_email, c_empty_email)) then
    raise exception 'seed.sql refuses to run: this database holds an account other than the five staging accounts (%, %, %, %, %)',
      c_email, c_other_email, c_stable_email, c_seq_email, c_empty_email;
  end if;

  -- ── The five staging accounts (each created only if missing) ────────────
  -- The test account is created first. The stable, sequence and empty accounts
  -- take a copy of its password hash, so one password signs in to all four
  -- accounts that sign in (staging-other keeps a hash nobody knows).
  for acct in
    select * from (values (1, c_email, c_new_id), (2, c_other_email, c_other_id), (3, c_stable_email, c_stable_id),
                          (4, c_seq_email, c_seq_id), (5, c_empty_email, c_empty_id)) as a(ord, email, id)
    order by ord
  loop
    if not exists (select 1 from auth.users where email = acct.email) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at, confirmation_token, recovery_token,
                              email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', acct.id, 'authenticated', 'authenticated', acct.email,
              case when acct.ord >= 3
                   then (select u.encrypted_password from auth.users u where u.email = c_email)
                   else extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt('bf')) end,
              now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), acct.id, acct.id::text,
              jsonb_build_object('sub', acct.id::text, 'email', acct.email, 'email_verified', true),
              'email', now(), now(), now());
    end if;
  end loop;
  select id into t from auth.users where email = c_email;
  select id into o from auth.users where email = c_other_email;
  select id into u_stable from auth.users where email = c_stable_email;
  select id into u_seq from auth.users where email = c_seq_email;
  select id into u_empty from auth.users where email = c_empty_email;

  -- ── Start clean: delete all five accounts' data, keep the accounts ──────
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
        execute format('delete from public.%I where user_id = any($1)', tbl) using array[t, o, u_stable, u_seq, u_empty];
      exception when foreign_key_violation then
        left_over := left_over + 1;
      end;
    end loop;
    exit when left_over = 0;
  end loop;

  -- ── The other account: a little of everything, for RLS checks ──────────
  -- The app's SQL functions read auth.uid(); act as the other account first.
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', o::text, 'role', 'authenticated')::text, true);
  insert into v2_user_settings (user_id) values (o);
  insert into exercises (user_id, name, muscle_group) values (o, 'Other Goblet Squat', 'quads') returning id into e_squat;
  insert into exercises (user_id, name, muscle_group) values (o, 'Other Push-Up', 'chest') returning id into e_bench;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
  values (o, 'OTHER Program', 'saved', 'weekday', 'week_dependent') returning id into p_ul;
  insert into v2_workout_days (program_id, user_id, name, position) values (p_ul, o, 'Other Day', 1) returning id into w_ua;
  update v2_programs set schedule = jsonb_build_object('tuesday', w_ua) where id = p_ul;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ua, o, e_squat, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (o, pe, 1, 8, 10), (o, pe, 2, 8, 10);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (w_ua, o, e_bench, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_amrap) values (o, pe, 1, true);
  insert into v2_program_priorities (user_id, program_id, tag_type, tag_value, mark) values (o, p_ul, 'muscle_group', 'quads', 'focus');
  m_ul := v2_start_run(p_ul, 'OTHER run', d0 - 7);
  perform v2_plan_week(m_ul, 1);
  insert into v2_coach_meso_tag_priorities (user_id, mesocycle_id, tag_type, tag_value, priority) values (o, m_ul, 'muscle_group', 'quads', 'high');
  insert into v2_sessions (user_id, mesocycle_id, week_plan_id, workout_day_id, date, status, started_at, completed_at)
  select o, m_ul, wp.id, wp.workout_day_id, d0 - 6, 'completed', (d0 - 6 + time '18:00') at time zone 'UTC', (d0 - 6 + time '19:00') at time zone 'UTC'
  from v2_week_plans wp where wp.mesocycle_id = m_ul returning id into s;
  insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir, logged_at)
  select o, s, pe5.exercise_id, ws.id, ws.set_number, 20, 10, 2, (d0 - 6 + time '18:10') at time zone 'UTC'
  from v2_week_plan_sets ws join v2_program_exercises pe5 on pe5.id = ws.program_exercise_id
  where ws.week_plan_id = (select week_plan_id from v2_sessions where id = s);
  insert into v2_coach_notes (user_id, body, session_id) values (o, 'Other account note (synthetic).', s);
  m_ul := null; p_ul := null; w_ua := null; e_squat := null; e_bench := null; s := null;

  -- Now act as the test account for everything below.
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
  -- Weeks 2 and 3 copy the week before: v2_plan_week gives them its structure (since
  -- migration 045 no number), so each planned set takes the numbers of the same planned
  -- set a week earlier, week 2 from week 1 and then week 3 from week 2. With
  -- 041's v2_plan_week these columns are already equal and the update changes nothing.
  -- "The same planned set" is the same exercise row, set number, stage and warmup flag:
  -- structure only, so the copy does not depend on how a planning function links its rows.
  for wk in 2..3 loop
    update v2_week_plan_sets ws set
      target_weight = src.target_weight, target_rir = src.target_rir,
      rep_min = src.rep_min, rep_max = src.rep_max, is_amrap = src.is_amrap
    from v2_week_plans wp
    join v2_week_plans swp on swp.mesocycle_id = wp.mesocycle_id and swp.workout_day_id = wp.workout_day_id
                          and swp.sequence_position is not distinct from wp.sequence_position
                          and swp.week_number = wp.week_number - 1
    join v2_week_plan_sets src on src.week_plan_id = swp.id
    where wp.mesocycle_id = m_ul and wp.week_number = wk
      and ws.week_plan_id = wp.id
      and ws.program_exercise_id = src.program_exercise_id and ws.set_number = src.set_number
      and ws.stage_index = src.stage_index and ws.is_warmup = src.is_warmup;
  end loop;
  -- The copy is checked, in a loop of its own so that it cannot share a mistake with the copy
  -- (DECISIONS 219: on staging weeks 2 and 3 came out without their numbers, nothing said so, and
  -- the logs below took their 50 kg fallback). Every planned set of weeks 2 and 3 must have found
  -- its source set a week earlier and equal it in the five columns, and the source week must hold
  -- weights and rep targets (else "equal" could mean "both empty"). If not, the seed stops and
  -- rolls everything back.
  for wk in 2..3 loop
    select count(*), count(src.id),
           count(*) filter (where src.id is not null and (ws.target_weight is distinct from src.target_weight
             or ws.target_rir is distinct from src.target_rir or ws.rep_min is distinct from src.rep_min
             or ws.rep_max is distinct from src.rep_max or ws.is_amrap is distinct from src.is_amrap)),
           count(src.target_weight), count(src.rep_min),
           count(*) filter (where exists (select 1 from v2_week_plan_sets s1
                                           where s1.week_plan_id = swp.id and s1.program_set_id = ws.program_set_id))
      into cp_total, cp_found, cp_differ, cp_weights, cp_reps, cp_by_pset
      from v2_week_plan_sets ws
      join v2_week_plans wp on wp.id = ws.week_plan_id
      left join v2_week_plans swp on swp.mesocycle_id = wp.mesocycle_id and swp.workout_day_id = wp.workout_day_id
                                 and swp.sequence_position is not distinct from wp.sequence_position
                                 and swp.week_number = wp.week_number - 1
      left join v2_week_plan_sets src on src.week_plan_id = swp.id
                                     and src.program_exercise_id = ws.program_exercise_id and src.set_number = ws.set_number
                                     and src.stage_index = ws.stage_index and src.is_warmup = ws.is_warmup
     where wp.mesocycle_id = m_ul and wp.week_number = wk;
    if cp_found <> cp_total or cp_differ <> 0 or cp_weights = 0 or cp_reps = 0 then
      raise exception 'seed.sql stopped and rolled everything back: week % of STG Upper/Lower run did not take its numbers from week %. % planned sets, % found their source set (% by program_set_id), % differ from it, the source week holds % weights and % rep targets.',
        wk, wk - 1, cp_total, cp_found, cp_by_pset, cp_differ, cp_weights, cp_reps;
    end if;
  end loop;
  -- Week 2's Lower A is a deload session.
  update v2_week_plans set is_deload = true
  where mesocycle_id = m_ul and week_number = 2
    and workout_day_id = (select id from v2_workout_days where program_id = (select program_id from v2_mesocycles where id = m_ul) and name = 'Lower A');
  -- Week 3: a little heavier than week 2 (week-dependent weeks differ).
  update v2_week_plan_sets set target_weight = target_weight + 2.5
  where user_id = t and target_weight > 0 and not is_warmup
    and week_plan_id in (select id from v2_week_plans where mesocycle_id = m_ul and week_number = 3);

  -- ═══ staging-stable: its own STG Full Body, an active STABLE run ═════════
  -- Started 7 days before this Monday: week 1 (last week) is done, week 2 is
  -- this week, planned and not started, with no this-week-only change (a
  -- reviewer makes those in the app). The same program as the test account's
  -- STG Full Body, on this account's own exercises. The sessions and logs of
  -- week 1 come from the loop below.
  perform set_config('request.jwt.claim.sub', u_stable::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_stable::text, 'role', 'authenticated')::text, true);
  insert into v2_user_settings (user_id, deload_rules)
  values (u_stable, '{"sets":{"mode":"percent","value":50,"rounding":"down"},"weight":{"percent":75,"rounding":"down","step":2.5,"stepUnit":"kg"}}');
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_stable, 'Leg Press', 'quads', 'squat') returning id into se_leg_press;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_stable, 'Incline Dumbbell Press', 'chest', 'horizontal_push') returning id into se_incline;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_stable, 'Lat Pulldown', 'back', 'vertical_pull') returning id into se_pulldown;
  insert into exercises (user_id, name, muscle_group) values (u_stable, 'Plank', 'core') returning id into se_plank;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_stable, 'EZ-Bar Curl', 'biceps', 'isolation') returning id into se_curl;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_stable, 'Parallel Bar Dip', 'triceps', 'vertical_push') returning id into se_dip;

  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
  values (u_stable, 'STG Full Body', 'saved', 'weekday', 'stable') returning id into sp_fb;
  insert into v2_workout_days (program_id, user_id, name, position) values (sp_fb, u_stable, 'Full Body', 1) returning id into sw_fb;
  insert into v2_workout_days (program_id, user_id, name, position) values (sp_fb, u_stable, 'Arms', 2) returning id into sw_arms;
  update v2_programs set schedule = jsonb_build_object('tuesday', sw_fb, 'thursday', sw_fb, 'saturday', sw_arms) where id = sp_fb;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (sw_fb, u_stable, se_leg_press, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_stable, pe, 1, 10, 12), (u_stable, pe, 2, 10, 12), (u_stable, pe, 3, 10, 12);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (sw_fb, u_stable, se_incline, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_stable, pe, 1, 8, 10), (u_stable, pe, 2, 8, 10);
  insert into v2_program_superset_blocks (user_id, workout_day_id, rest_after_round_seconds) values (u_stable, sw_fb, 90) returning id into blk;
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, superset_block_id) values (sw_fb, u_stable, se_pulldown, 3, blk) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_stable, pe, 1, 10, 12), (u_stable, pe, 2, 10, 12);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position, superset_block_id) values (sw_fb, u_stable, se_plank, 4, blk) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_amrap) values (u_stable, pe, 1, true), (u_stable, pe, 2, true);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (sw_arms, u_stable, se_curl, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_stable, pe, 1, 10, 12);
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, stage_kind) values (u_stable, pe, 2, 10, 12, 'dropset') returning id into h;
  insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, rep_min, rep_max) values (u_stable, pe, 2, h, 1, 8, 10);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (sw_arms, u_stable, se_dip, 2) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_stable, pe, 1, 8, 12), (u_stable, pe, 2, 8, 12);
  insert into v2_program_priorities (user_id, program_id, tag_type, tag_value, mark) values
    (u_stable, sp_fb, 'muscle_group', 'quads', 'focus');

  m_st := v2_start_run(sp_fb, 'STG Full Body run', d0 - 7);
  perform v2_plan_week(m_st, 1);
  perform v2_plan_week(m_st, 2);

  -- ═══ staging-sequence: its own STG Rotation, an active SEQUENCE run ═══════
  -- A, B, rest, A, C, rest. Cycle 1's four workouts are done (the A repeat
  -- included), on the six days before the day the seed runs: A six days ago, B
  -- five, rest, A three, C two days ago, rest yesterday. So cycle 2 is the
  -- current cycle (it holds the next due workout), planned and not started,
  -- and Rotation A is due today. The sessions and logs come from the loop
  -- below.
  perform set_config('request.jwt.claim.sub', u_seq::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_seq::text, 'role', 'authenticated')::text, true);
  insert into exercises (user_id, name, muscle_group, muscle_subgroup, movement_pattern)
  values (u_seq, 'Barbell Bench Press', 'chest', '{mid_chest}', 'horizontal_push') returning id into qe_bench;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_seq, 'Back Squat', 'quads', 'squat') returning id into qe_squat;
  insert into exercises (user_id, name, muscle_group) values (u_seq, 'Farmer Carry', 'other') returning id into qe_farmer;
  -- Not in the program: the 1.1-shaped cycle 2 (below) swaps the first in and adds the other two.
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_seq, 'Leg Press', 'quads', 'squat') returning id into qe_leg_press;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_seq, 'Barbell Row', 'back', 'horizontal_pull') returning id into qe_row;
  insert into exercises (user_id, name, muscle_group, movement_pattern) values (u_seq, 'Dumbbell Curl', 'biceps', 'isolation') returning id into qe_curl;

  insert into v2_programs (user_id, name, kind, schedule_type, planning_type)
  values (u_seq, 'STG Rotation', 'saved', 'sequence', 'week_dependent') returning id into qp_rot;
  insert into v2_workout_days (program_id, user_id, name, position) values (qp_rot, u_seq, 'Rotation A', 1) returning id into qw_ra;
  insert into v2_workout_days (program_id, user_id, name, position) values (qp_rot, u_seq, 'Rotation B', 2) returning id into qw_rb;
  insert into v2_workout_days (program_id, user_id, name, position) values (qp_rot, u_seq, 'Rotation C', 3) returning id into qw_rc;
  insert into v2_program_sequence_items (user_id, program_id, position, workout_day_id) values
    (u_seq, qp_rot, 1, qw_ra), (u_seq, qp_rot, 2, qw_rb), (u_seq, qp_rot, 3, null), (u_seq, qp_rot, 4, qw_ra), (u_seq, qp_rot, 5, qw_rc), (u_seq, qp_rot, 6, null);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (qw_ra, u_seq, qe_squat, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_seq, pe, 1, 5, 5), (u_seq, pe, 2, 5, 5);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (qw_rb, u_seq, qe_bench, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (u_seq, pe, 1, 5, 5), (u_seq, pe, 2, 5, 5);
  insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (qw_rc, u_seq, qe_farmer, 1) returning id into pe;
  insert into v2_program_sets (user_id, program_exercise_id, position, is_amrap) values (u_seq, pe, 1, true);

  m_q := v2_start_run(qp_rot, 'STG Rotation run', d_today - 6);
  perform v2_plan_week(m_q, 1);
  perform v2_plan_week(m_q, 2);
  -- Cycle 2 copies cycle 1 (see "Numbers in later weeks" in the header): each planned set
  -- takes the numbers of the same planned set of the same slot a cycle earlier (the same
  -- exercise row, set number, stage and warmup flag), and the copy is checked as above.
  update v2_week_plan_sets ws set
    target_weight = src.target_weight, target_rir = src.target_rir,
    rep_min = src.rep_min, rep_max = src.rep_max, is_amrap = src.is_amrap
  from v2_week_plans wp
  join v2_week_plans swp on swp.mesocycle_id = wp.mesocycle_id and swp.workout_day_id = wp.workout_day_id
                        and swp.sequence_position is not distinct from wp.sequence_position
                        and swp.week_number = wp.week_number - 1
  join v2_week_plan_sets src on src.week_plan_id = swp.id
  where wp.mesocycle_id = m_q and wp.week_number = 2
    and ws.week_plan_id = wp.id
    and ws.program_exercise_id = src.program_exercise_id and ws.set_number = src.set_number
    and ws.stage_index = src.stage_index and ws.is_warmup = src.is_warmup;
  select count(*), count(src.id),
         count(*) filter (where src.id is not null and (ws.target_weight is distinct from src.target_weight
           or ws.target_rir is distinct from src.target_rir or ws.rep_min is distinct from src.rep_min
           or ws.rep_max is distinct from src.rep_max or ws.is_amrap is distinct from src.is_amrap)),
         count(src.target_weight), count(src.rep_min),
         count(*) filter (where exists (select 1 from v2_week_plan_sets s1
                                         where s1.week_plan_id = swp.id and s1.program_set_id = ws.program_set_id))
    into cp_total, cp_found, cp_differ, cp_weights, cp_reps, cp_by_pset
    from v2_week_plan_sets ws
    join v2_week_plans wp on wp.id = ws.week_plan_id
    left join v2_week_plans swp on swp.mesocycle_id = wp.mesocycle_id and swp.workout_day_id = wp.workout_day_id
                               and swp.sequence_position is not distinct from wp.sequence_position
                               and swp.week_number = wp.week_number - 1
    left join v2_week_plan_sets src on src.week_plan_id = swp.id
                                   and src.program_exercise_id = ws.program_exercise_id and src.set_number = ws.set_number
                                   and src.stage_index = ws.stage_index and src.is_warmup = ws.is_warmup
   where wp.mesocycle_id = m_q and wp.week_number = 2;
  -- (STG Rotation's cycle 1 has rep targets and an AMRAP, and no weight.)
  if cp_found <> cp_total or cp_differ <> 0 or cp_reps = 0 then
    raise exception 'seed.sql stopped and rolled everything back: cycle 2 of STG Rotation run did not take its numbers from cycle 1. % planned sets, % found their source set (% by program_set_id), % differ from it, the source cycle holds % rep targets.',
      cp_total, cp_found, cp_by_pset, cp_differ, cp_reps;
  end if;

  -- ── STG Rotation run, cycle 2: the edits 1.1 let a user make (the 1.1-shaped run) ─────
  -- TASKS-1.2 chunk 53; DECISIONS 149 (c) and 196. Migration 046 is the release's data
  -- migration: it makes each active week-dependent run's program match its last planned week
  -- (the exercises it lists and their order), so that nothing the user sees changes when 1.2's
  -- v2_plan_week plans the next week from the program. It is rehearsed on a run 1.1 changed in
  -- the week view, and this is that run. What 1.1 wrote, as it wrote it (weekPlanService.ts:
  -- swapWeekExercise, addWeekExercise, reorderWeekExercises; runProgramExercises.ts:
  -- removeRunProgramExercise), in cycle 2, the last planned week of every workout here:
  --   Rotation A, slot 4  SWAP Back Squat for Leg Press: a week-only Leg Press at the squat's
  --                       place; the slot's exercise row and its sets point at it. The run
  --                       copy still lists the squat. (Slot 1 stays as planned: a repeated
  --                       workout edited in one of its slots; the later slot is the last week.)
  --   Rotation B          the program tab's REMOVE of Bench Press (soft: removed_at; planned
  --                       weeks keep their rows, so cycle 2 still lists it) and an ADD of
  --                       Barbell Row after it (a week-only row, two sets).
  --   Rotation C          an ADD of Dumbbell Curl after Farmer Carry (a week-only row, two
  --                       sets), then a REORDER putting the curl first (the two week rows
  --                       trade positions; the run copy never hears of it).
  -- Before 046 the run copy's program and these weeks disagree. After it, A lists Leg Press and
  -- not the squat, B lists Bench Press (brought back) and then Barbell Row, and C lists the curl
  -- and then the carry. A seed does not run 046: a migration runs at a deploy, a seed after one.
  -- Seeded before the deploy that applies 045 and 046, this shape is there for the deploy to
  -- reconcile (`node scripts/rehearse-046.mjs --staging --out FILE` reads it before the merge,
  -- `--compare FILE` after). Seeded once 046 is live, it stays as it is until 046's text is run
  -- by hand in the SQL editor (it changes nothing that already matches, and runs twice safely).
  declare
    q_a_wp uuid; q_a_pe uuid; q_a_new uuid;   -- Rotation A, slot 4: its plan row, the squat's run-copy row, the swapped-in row
    q_b_wp uuid; q_b_pe uuid; q_b_new uuid;   -- Rotation B: its plan row, Bench Press's run-copy row, the added row
    q_c_wp uuid; q_c_pe uuid; q_c_new uuid;   -- Rotation C: its plan row, Farmer Carry's run-copy row, the added row
  begin
    select wp.id, (select x.program_exercise_id from v2_week_plan_exercises x where x.week_plan_id = wp.id)
      into q_a_wp, q_a_pe
      from v2_week_plans wp join v2_workout_days wd on wd.id = wp.workout_day_id
     where wp.mesocycle_id = m_q and wp.week_number = 2 and wp.sequence_position = 4 and wd.name = 'Rotation A';
    select wp.id, (select x.program_exercise_id from v2_week_plan_exercises x where x.week_plan_id = wp.id)
      into q_b_wp, q_b_pe
      from v2_week_plans wp join v2_workout_days wd on wd.id = wp.workout_day_id
     where wp.mesocycle_id = m_q and wp.week_number = 2 and wd.name = 'Rotation B';
    select wp.id, (select x.program_exercise_id from v2_week_plan_exercises x where x.week_plan_id = wp.id)
      into q_c_wp, q_c_pe
      from v2_week_plans wp join v2_workout_days wd on wd.id = wp.workout_day_id
     where wp.mesocycle_id = m_q and wp.week_number = 2 and wd.name = 'Rotation C';

    -- Rotation A, slot 4: SWAP. The replacement is a week-only program row at the replaced row's
    -- place (and block, if any, never its unit); the week's row and its sets are pointed at it.
    insert into v2_program_exercises (user_id, workout_day_id, exercise_id, position, weight_unit, superset_block_id, week_only)
    select u_seq, pe.workout_day_id, qe_leg_press, pe.position, null, pe.superset_block_id, true
    from v2_program_exercises pe where pe.id = q_a_pe
    returning id into q_a_new;
    update v2_week_plan_exercises set program_exercise_id = q_a_new, carry_program_exercise_id = null
    where week_plan_id = q_a_wp and program_exercise_id = q_a_pe;
    update v2_week_plan_sets set program_exercise_id = q_a_new
    where week_plan_id = q_a_wp and program_exercise_id = q_a_pe;

    -- Rotation B: the program tab's REMOVE (soft) of Bench Press, then ADD Barbell Row in the week.
    update v2_program_exercises set removed_at = now() where id = q_b_pe;
    insert into v2_program_exercises (user_id, workout_day_id, exercise_id, position, week_only)
    select u_seq, pe.workout_day_id, qe_row, 2, true from v2_program_exercises pe where pe.id = q_b_pe
    returning id into q_b_new;
    insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (u_seq, q_b_wp, q_b_new, 2);
    insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, rep_min, rep_max)
    values (q_b_wp, u_seq, q_b_new, 1, 8, 10), (q_b_wp, u_seq, q_b_new, 2, 8, 10);

    -- Rotation C: ADD Dumbbell Curl, then REORDER (the two week rows trade positions).
    insert into v2_program_exercises (user_id, workout_day_id, exercise_id, position, week_only)
    select u_seq, pe.workout_day_id, qe_curl, 2, true from v2_program_exercises pe where pe.id = q_c_pe
    returning id into q_c_new;
    insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position) values (u_seq, q_c_wp, q_c_new, 2);
    insert into v2_week_plan_sets (week_plan_id, user_id, program_exercise_id, set_number, rep_min, rep_max)
    values (q_c_wp, u_seq, q_c_new, 1, 10, 12), (q_c_wp, u_seq, q_c_new, 2, 10, 12);
    update v2_week_plan_exercises set position = 2, carry_position = null where week_plan_id = q_c_wp and program_exercise_id = q_c_pe;
    update v2_week_plan_exercises set position = 1, carry_position = null where week_plan_id = q_c_wp and program_exercise_id = q_c_new;
  end;

  -- staging-empty owns nothing: no programs, runs, exercises or settings row.

  -- ═══ Sessions and set logs ════════════════════════════════════════════════
  -- One session per planned slot and scheduled weekday (a workout on two
  -- weekdays, G14, gets two sessions on one shared plan row), dated by the
  -- run's schedule; logs follow the plan (target weight, rep_max or 8 reps,
  -- target RIR). A sequence run has no weekdays: its sessions are the four
  -- workouts of cycle 1, dated back from the seed's day.
  for r in
    select * from (
      -- weekday runs (the test account's and staging-stable's): one row per
      -- planned workout and scheduled weekday
      select wp.id as wp_id, wp.user_id as uid, wp.mesocycle_id, wp.workout_day_id, wp.week_number, wp.is_deload,
             m.start_date, wd.name as wd_name,
             array_position(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], j.k) as dow,
             m.start_date + (wp.week_number - 1) * 7
               + array_position(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], j.k) - 1 as sess_date,
             wp.sequence_position as seq_pos
      from v2_week_plans wp
      join v2_mesocycles m on m.id = wp.mesocycle_id
      join v2_workout_days wd on wd.id = wp.workout_day_id
      join v2_programs p on p.id = m.program_id
      cross join lateral jsonb_each_text(p.schedule) as j(k, v)
      where wp.user_id in (t, u_stable) and j.v = wp.workout_day_id::text
      union all
      -- staging-sequence's run: cycle 1's four workouts (slots 1, 2, 4, 5), the
      -- rests (slots 3 and 6) are the days between; cycle 2 has no sessions
      select wp.id, wp.user_id, wp.mesocycle_id, wp.workout_day_id, wp.week_number, wp.is_deload,
             m.start_date, wd.name, 0,
             d_today - case wp.sequence_position when 1 then 6 when 2 then 5 when 4 then 3 when 5 then 2 end,
             wp.sequence_position
      from v2_week_plans wp
      join v2_mesocycles m on m.id = wp.mesocycle_id
      join v2_workout_days wd on wd.id = wp.workout_day_id
      where wp.mesocycle_id = m_q and wp.week_number = 1
    ) x
    order by x.start_date, x.week_number, x.dow, x.seq_pos
  loop
    declare
      sess_date date;
      sess_status text := 'completed';
      upto int := null;          -- log only the first N heads (in-progress session)
      skip_set int := null;      -- this head is logged as skipped
      moved date := null;
      diffs boolean := false;    -- the test account's week 2 Upper A: five differences from its plan
      logged_at timestamptz;
      head record; st record; i int := 0;
      n int;                     -- the log's set_number, as the app numbers it
      lw numeric; lr int; lk text;  -- the head log's weight, reps and stage kind
    begin
      sess_date := r.sess_date;

      if r.mesocycle_id = m_ul and r.week_number = 1 and r.wd_name = 'Upper B' then
        moved := sess_date + 1; skip_set := 3;            -- done on Saturday; one set skipped
      elsif r.mesocycle_id = m_ul and r.week_number = 2 and r.wd_name = 'Upper B' then
        sess_status := 'skipped';                          -- a skipped session, no logs
      elsif r.mesocycle_id = m_ul and r.week_number = 2 and r.wd_name = 'Upper A' then
        diffs := true;                                     -- done differently from its plan (below)
      elsif r.mesocycle_id = m_ul and r.week_number = 3 then
        if r.wd_name = 'Upper A' then sess_status := 'in_progress'; upto := 3;
        else continue;                                     -- not trained yet
        end if;
      elsif r.mesocycle_id = m_ppl and r.week_number = 4 and r.wd_name = 'Legs' then
        skip_set := -1;                                    -- every set skipped
      elsif r.mesocycle_id = m_st and r.week_number = 2 then
        continue;                                          -- staging-stable's current week: nothing done yet
      end if;

      logged_at := (coalesce(moved, sess_date) + time '18:00') at time zone 'UTC';
      insert into v2_sessions (user_id, mesocycle_id, week_plan_id, workout_day_id, date, moved_to_date,
                               status, started_at, completed_at, energy_rating, pump_rating, note)
      values (r.uid, r.mesocycle_id, r.wp_id, r.workout_day_id, sess_date, moved, sess_status,
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
        -- The app numbers a log 1-based per exercise within the session,
        -- warmups and working sets separately (useExerciseCardState.ts),
        -- not by the plan's set_number.
        select count(*) + 1 into n from v2_set_logs
        where session_id = s and exercise_id = head.exercise_id and is_warmup = head.is_warmup and parent_set_id is null;
        -- The head log is the plan, except in the test account's week 2 Upper A
        -- (REVIEW's and VOLUME's last week). Its differences, by the set number
        -- the workout screen shows (warmups apart):
        --   bench set 2   82.5 kg x 7   (planned 80 kg, 6-8 reps: the weight differs)
        --   bench set 3   80 kg x 5     (reps below the 6-8 range)
        --   cable row 3   skipped
        --   lateral raise set 1   logged as a dropset, with one drop (below)
        --   cable pushdown   a third head nobody planned (after this loop)
        -- Lower A (the deload) and Upper B (skipped) stay as planned.
        if diffs and head.exercise_id = e_row and n = 3 then
          insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, is_skipped, logged_at, is_warmup)
          values (r.uid, s, head.exercise_id, head.id, n, true, logged_at, head.is_warmup);
          continue;
        end if;
        if skip_set = -1 or skip_set = i then
          insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, is_skipped, logged_at, is_warmup)
          values (r.uid, s, head.exercise_id, head.id, n, true, logged_at, head.is_warmup);
          continue;
        end if;
        lw := coalesce(head.target_weight, 50);
        lr := coalesce(head.rep_max, head.rep_min, 8);
        -- pre-1.1 logs carry no stage kind (legacy dropsets read as dropset)
        lk := case when r.mesocycle_id = m_ppl then null else head.stage_kind end;
        if diffs and not head.is_warmup then
          if head.exercise_id = e_bench and n = 2 then lw := 82.5; lr := 7;
          elsif head.exercise_id = e_bench and n = 3 then lr := 5;
          elsif head.exercise_id = e_lat_raise and n = 1 then lk := 'dropset';
          end if;
        end if;
        insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir,
                                 logged_at, rest_seconds, is_warmup, stage_kind, entered_unit, form_rating)
        values (r.uid, s, head.exercise_id, head.id, n,
                lw, lr,
                case when head.is_warmup then null else coalesce(head.target_rir, 2) end,
                logged_at, case when i > 1 then 150 end, head.is_warmup,
                lk,
                -- a warmup log carries no unit or form rating (SetRow.tsx)
                case when head.is_warmup then null else 'kg' end,
                case when i % 3 = 0 and not head.is_warmup then 'controlled' end)
        returning id into hl;
        for st in
          select * from v2_week_plan_sets where parent_week_plan_set_id = head.id order by stage_index
        loop
          logged_at := logged_at + interval '20 seconds';
          insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir,
                                   logged_at, is_dropset, parent_set_id, stage_index, entered_unit)
          values (r.uid, s, head.exercise_id, st.id, n, coalesce(st.target_weight, head.target_weight, 40),
                  coalesce(st.rep_max, 6), 0, logged_at, true, hl, st.stage_index, 'kg');
        end loop;
        if diffs and head.exercise_id = e_lat_raise and n = 1 and not head.is_warmup then
          -- Set 1 was made a dropset during the session and one drop was logged:
          -- the way the app writes it, a stage log under the head with no
          -- planned stage behind it.
          logged_at := logged_at + interval '20 seconds';
          insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir,
                                   logged_at, is_dropset, parent_set_id, stage_index, entered_unit)
          values (r.uid, s, head.exercise_id, null, n, lw - 2, 10, 0, logged_at, true, hl, 1, 'kg');
        end if;
      end loop;

      if diffs then
        -- A cable pushdown set nobody planned: the exercise's third head, logged
        -- with no planned set behind it (week_plan_set_id null), 20 kg x 15.
        logged_at := logged_at + interval '3 minutes';
        insert into v2_set_logs (user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir,
                                 logged_at, rest_seconds, entered_unit)
        select r.uid, s, e_pushdown, null,
               (select count(*) + 1 from v2_set_logs
                where session_id = s and exercise_id = e_pushdown and not is_warmup and parent_set_id is null),
               20, 15, 2, logged_at, 150, 'kg';
      end if;
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

  -- ── Coach rows on the finished run (1.2.1, chunk 70; the full delete [8b], DECISIONS 249 rows 10 and 13-15) ────────────
  -- The test account owned no Coach rows, so the confirmation's Coach lines and the delete's explicit deletes had nothing to
  -- count or remove. Written the way the app writes them: `content` is empty (nothing reads it here), and a weekly analysis's
  -- input_snapshot carries the session roster weekAnalysisInput.ts builds (`sessions[].id`, beside `week` and `occurrences`).
  -- The run is finished and stays so: chunk 75 counts it as this account and deletes only its own throwaway runs, on
  -- staging-empty. The five rows, on STG Full Body's run:
  --   a note and a session analysis on its first session; a program analysis of the run;
  --   a weekly analysis of week 1 naming only the run's sessions of that week (the full delete removes it);
  --   a control weekly analysis naming the run's last session and the active run's first (it stays, and the count leaves it
  --   out). The seed's two runs never share a calendar week, so the control's mixed week is synthetic; it sits under the
  --   Monday of the active run's first week.
  perform set_config('request.jwt.claim.sub', t::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t::text, 'role', 'authenticated')::text, true);
  select id into cf_first from v2_sessions where mesocycle_id = m_fb order by date, id limit 1;
  select id into cf_last from v2_sessions where mesocycle_id = m_fb order by date desc, id desc limit 1;
  select id into cf_ul from v2_sessions where mesocycle_id = m_ul order by date, id limit 1;
  select start_date into cf_ws from v2_mesocycles where id = m_fb;   -- a Monday: the run's week 1
  select start_date into cf_ul_ws from v2_mesocycles where id = m_ul;   -- a Monday: the active run's week 1
  select jsonb_agg(roster.item order by roster.date, roster.id) filter (where roster.mesocycle_id = m_fb and roster.date >= cf_ws and roster.date < cf_ws + 7),
         jsonb_agg(roster.item order by roster.date, roster.id) filter (where roster.id in (cf_last, cf_ul))
    into cf_run, cf_mixed
    from (select s2.id, s2.date, s2.mesocycle_id,
                 jsonb_build_object('id', s2.id, 'date', s2.date, 'dayOfWeek', lower(to_char(s2.date, 'FMDay')),
                                    'workoutDayName', wd.name, 'status', s2.status, 'isDeload', wp.is_deload,
                                    'mesocycleName', mz.name, 'weekNumber', wp.week_number,
                                    'energyRating', s2.energy_rating, 'pumpRating', s2.pump_rating) as item
            from v2_sessions s2
            left join v2_workout_days wd on wd.id = s2.workout_day_id
            left join v2_week_plans wp on wp.id = s2.week_plan_id
            left join v2_mesocycles mz on mz.id = s2.mesocycle_id
           where s2.user_id = t) roster;
  -- Refuse an empty roster (DECISIONS 219's lesson): a weekly analysis with no sessions is not one the full delete finds, and
  -- "both empty" would read as a pass.
  if cf_first is null or cf_last is null or cf_ul is null or cf_ws is null or cf_ul_ws is null
     or coalesce(jsonb_array_length(cf_run), 0) = 0 or coalesce(jsonb_array_length(cf_mixed), 0) <> 2 then
    raise exception 'seed.sql stopped and rolled everything back: the Coach rows on STG Full Body''s finished run found no sessions to name (first %, last %, active run''s first %, week 1 starts %, week 1 roster %, mixed roster %).',
      cf_first, cf_last, cf_ul, cf_ws, coalesce(jsonb_array_length(cf_run), 0), coalesce(jsonb_array_length(cf_mixed), 0);
  end if;
  insert into v2_coach_notes (user_id, body, session_id)
  values (t, 'Leg press felt heavy today (synthetic note for the full delete''s check).', cf_first);
  insert into v2_coach_session_analyses (user_id, session_id, content, input_snapshot, model)
  values (t, cf_first, '{}', '{}', 'seed');
  insert into v2_coach_meso_analyses (user_id, mesocycle_id, meso_name, meso_start_date, meso_end_date, content, input_snapshot, model)
  select t, mf.id, mf.name, mf.start_date, mf.end_date, '{}', '{}', 'seed' from v2_mesocycles mf where mf.id = m_fb;
  insert into v2_coach_week_analyses (user_id, week_start, content, input_snapshot, model) values
    (t, cf_ws, '{}',
     jsonb_build_object('week', jsonb_build_object('weekStart', cf_ws, 'weekEnd', cf_ws + 6), 'sessions', cf_run, 'occurrences', '[]'::jsonb), 'seed'),
    (t, cf_ul_ws, '{}',
     jsonb_build_object('week', jsonb_build_object('weekStart', cf_ul_ws, 'weekEnd', cf_ul_ws + 6), 'sessions', cf_mixed, 'occurrences', '[]'::jsonb), 'seed');

  -- ── Maintenance (1.2.1, migration 048): the test account is exempt ────────────────────────────────────────────────────
  -- The staging accounts' ids predate the seed on staging, so the exempt id is read by email (t, above). One flip of maintenance
  -- on staging then shows the strip on this account and the screen on staging-stable. Only exempt_user_ids is set: Adam's flip
  -- (maintenance, min_version) is left as it is. The seed also runs on a branch that has not applied 048 yet, which has no such
  -- table. A re-seed while maintenance is ON is refused (OL001) at the seed's first write as the other account: turn it off first.
  if to_regclass('public.v2_app_status') is not null then
    update v2_app_status set exempt_user_ids = array[t], updated_at = now() where id;
  end if;

  raise notice 'staging seed: % programs, % runs, % sessions, % set logs for %; % set logs for %',
    (select count(*) from v2_programs where user_id = t), (select count(*) from v2_mesocycles where user_id = t),
    (select count(*) from v2_sessions where user_id = t), (select count(*) from v2_set_logs where user_id = t), c_email,
    (select count(*) from v2_set_logs where user_id = o), c_other_email;
  raise notice 'staging seed: % (% sessions, % set logs, run %), % (% sessions, % set logs, run %), % (% program rows)',
    c_stable_email, (select count(*) from v2_sessions where user_id = u_stable), (select count(*) from v2_set_logs where user_id = u_stable),
    (select status || ' ' || start_date from v2_mesocycles where id = m_st),
    c_seq_email, (select count(*) from v2_sessions where user_id = u_seq), (select count(*) from v2_set_logs where user_id = u_seq),
    (select status || ' ' || start_date from v2_mesocycles where id = m_q),
    c_empty_email, (select count(*) from v2_programs where user_id = u_empty);
  raise notice 'staging seed: % has a 1.1-shaped cycle 2 for migration 046 (% week-only program row(s), % soft-removed)',
    c_seq_email, (select count(*) from v2_program_exercises where user_id = u_seq and week_only),
    (select count(*) from v2_program_exercises where user_id = u_seq and removed_at is not null);
end
$seed$;

notify pgrst, 'reload schema';

-- Whoever changes this seed changes the version below, so a wrong seed shows in the result pane the moment it runs.
select 'overload seed 2026-10-30 chunk 70' as seed_version;
