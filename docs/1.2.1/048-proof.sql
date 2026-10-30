-- Proof of the 048 draft on the scratch replay. Runs as supabase_admin (safeupdate loaded), builds a fixture as two
-- signed-in users through RLS, exercises every function and the maintenance trigger, prints what happened, rolls back.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
load 'safeupdate';
begin;

-- Canary: pg-safeupdate is loaded (a bare UPDATE must be refused).
do $$ begin
  begin
    execute 'update v2_programs set name = name';
    raise exception 'CANARY FAILED: safeupdate did not refuse a bare update';
  exception when others then
    if sqlerrm like 'CANARY%' then raise; end if;
    raise notice 'canary ok: % / %', sqlstate, sqlerrm;
  end;
end $$;

-- Two users.
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');

-- Helper: sign in as a user (the image's auth.uid()/auth.role() read these two settings).
\set u1 '''11111111-1111-4111-8111-111111111111'''
\set u2 '''22222222-2222-4222-8222-222222222222'''

-- ─── Fixture as U1 ─────────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into exercises (id, user_id, name, muscle_group) values ('e1000000-0000-4000-8000-000000000001', :u1, 'Bench Press', 'chest');
-- The saved program SP, its day and exercise.
insert into v2_programs (id, user_id, name, kind) values ('a0000000-0000-4000-8000-00000000000a', :u1, 'SP saved', 'saved');
insert into v2_workout_days (id, program_id, user_id, name, position) values ('d0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', :u1, 'Push', 0);
insert into v2_program_exercises (id, workout_day_id, user_id, exercise_id, position) values ('f0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', :u1, 'e1000000-0000-4000-8000-000000000001', 0);
-- The finished run M on its copy RP.
insert into v2_programs (id, user_id, name, kind) values ('b0000000-0000-4000-8000-00000000000b', :u1, 'SP run copy', 'run');
insert into v2_workout_days (id, program_id, user_id, name, position) values ('d0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', :u1, 'Push', 0);
insert into v2_program_exercises (id, workout_day_id, user_id, exercise_id, position) values ('f0000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000b', :u1, 'e1000000-0000-4000-8000-000000000001', 0);
insert into v2_mesocycles (id, user_id, name, program_id, source_program_id, status, start_date, end_date)
  values ('c0000000-0000-4000-8000-00000000000c', :u1, 'M finished', 'b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', 'completed', '2026-09-07', '2026-09-20');
insert into v2_week_plans (id, user_id, mesocycle_id, workout_day_id, week_number) values
  ('e0000000-0000-4000-8000-000000000001', :u1, 'c0000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-00000000000b', 1),
  ('e0000000-0000-4000-8000-000000000002', :u1, 'c0000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-00000000000b', 2);
insert into v2_week_plan_sets (id, week_plan_id, user_id, program_exercise_id, set_number) values
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000001', :u1, 'f0000000-0000-4000-8000-00000000000b', 1),
  ('e0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000002', :u1, 'f0000000-0000-4000-8000-00000000000b', 1);
insert into v2_sessions (id, user_id, date, status, mesocycle_id, week_plan_id, workout_day_id) values
  ('50000000-0000-4000-8000-000000000001', :u1, '2026-09-08', 'completed', 'c0000000-0000-4000-8000-00000000000c', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000b'),
  ('50000000-0000-4000-8000-000000000002', :u1, '2026-09-15', 'completed', 'c0000000-0000-4000-8000-00000000000c', 'e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000b');
-- S1: a warmup, a skipped set, a working head with one drop stage. S2: two working heads.
insert into v2_set_logs (id, user_id, session_id, exercise_id, set_number, weight, reps, is_warmup, is_skipped, logged_at) values
  ('60000000-0000-4000-8000-000000000001', :u1, '50000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 0, 40, 10, true, false, '2026-09-08 10:00+00'),
  ('60000000-0000-4000-8000-000000000002', :u1, '50000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, null, null, false, true, '2026-09-08 10:05+00'),
  ('60000000-0000-4000-8000-000000000003', :u1, '50000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 2, 80, 8, false, false, '2026-09-08 10:10+00'),
  ('60000000-0000-4000-8000-000000000005', :u1, '50000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 1, 82.5, 8, false, false, '2026-09-15 10:00+00'),
  ('60000000-0000-4000-8000-000000000006', :u1, '50000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 2, 82.5, 7, false, false, '2026-09-15 10:05+00');
insert into v2_set_logs (id, user_id, session_id, exercise_id, set_number, weight, reps, parent_set_id, stage_index, logged_at) values
  ('60000000-0000-4000-8000-000000000004', :u1, '50000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 2, 60, 6, '60000000-0000-4000-8000-000000000003', 1, '2026-09-08 10:11+00');
-- Coach rows. N1 on S1 goes; N2 (no session) stays. A1 on S1 goes. MA1 on M goes; MA2 on M2 stays.
insert into v2_coach_notes (id, user_id, body, session_id) values
  ('70000000-0000-4000-8000-000000000001', :u1, 'felt strong', '50000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', :u1, 'general note', null);
insert into v2_coach_session_analyses (id, user_id, session_id, content, input_snapshot, model) values
  ('80000000-0000-4000-8000-000000000001', :u1, '50000000-0000-4000-8000-000000000001', '{}', '{}', 'test');
-- A second run M2 (active) on its own copy RP2, from the same saved program SP.
insert into v2_programs (id, user_id, name, kind) values ('b0000000-0000-4000-8000-00000000000d', :u1, 'SP run copy 2', 'run');
insert into v2_workout_days (id, program_id, user_id, name, position) values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000000d', :u1, 'Push', 0);
insert into v2_mesocycles (id, user_id, name, program_id, source_program_id, status, start_date)
  values ('c0000000-0000-4000-8000-00000000000d', :u1, 'M2 active', 'b0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 'active', '2026-10-26');
insert into v2_sessions (id, user_id, date, status, mesocycle_id, workout_day_id) values
  ('50000000-0000-4000-8000-000000000003', :u1, '2026-10-27', 'completed', 'c0000000-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-00000000000d');
insert into v2_coach_meso_analyses (id, user_id, mesocycle_id, meso_name, meso_start_date, content, input_snapshot, model) values
  ('90000000-0000-4000-8000-000000000001', :u1, 'c0000000-0000-4000-8000-00000000000c', 'M finished', '2026-09-07', '{}', '{}', 'test'),
  ('90000000-0000-4000-8000-000000000002', :u1, 'c0000000-0000-4000-8000-00000000000d', 'M2 active', '2026-10-26', '{}', '{}', 'test');
-- Weekly analyses in the real builder's shape (weekAnalysisInput.ts: input_snapshot.sessions[].id).
-- WA1 holds only M's sessions: goes. WA2 holds one of M's and one of M2's: stays. WA3 holds none: stays. WA4 has no sessions key: stays.
insert into v2_coach_week_analyses (id, user_id, week_start, content, input_snapshot, model) values
  ('a1000000-0000-4000-8000-000000000001', :u1, '2026-09-07', '{}', '{"sessions":[{"id":"50000000-0000-4000-8000-000000000001","date":"2026-09-08","status":"completed"},{"id":"50000000-0000-4000-8000-000000000002","date":"2026-09-15","status":"completed"}],"occurrences":[]}', 'test'),
  ('a1000000-0000-4000-8000-000000000002', :u1, '2026-09-14', '{}', '{"sessions":[{"id":"50000000-0000-4000-8000-000000000002","date":"2026-09-15","status":"completed"},{"id":"50000000-0000-4000-8000-000000000003","date":"2026-10-27","status":"completed"}]}', 'test'),
  ('a1000000-0000-4000-8000-000000000003', :u1, '2026-09-21', '{}', '{"sessions":[]}', 'test'),
  ('a1000000-0000-4000-8000-000000000004', :u1, '2026-09-28', '{}', '{"note":"no sessions key"}', 'test');
-- Two finished runs sharing one copy (the guard): M3 and M4 on RP3.
insert into v2_programs (id, user_id, name, kind) values ('b0000000-0000-4000-8000-00000000000e', :u1, 'shared copy', 'run');
insert into v2_mesocycles (id, user_id, name, program_id, status, start_date, end_date) values
  ('c0000000-0000-4000-8000-00000000000e', :u1, 'M3', 'b0000000-0000-4000-8000-00000000000e', 'completed', '2026-08-03', '2026-08-16'),
  ('c0000000-0000-4000-8000-00000000000f', :u1, 'M4', 'b0000000-0000-4000-8000-00000000000e', 'completed', '2026-08-17', '2026-08-30');
-- So that v2_plan_week(M2, 1) has something to write: RP2 schedules its day on Monday with one exercise and one set.
update v2_programs set schedule = '{"monday": "d0000000-0000-4000-8000-00000000000d"}' where id = 'b0000000-0000-4000-8000-00000000000d';
insert into v2_program_exercises (id, workout_day_id, user_id, exercise_id, position) values ('f0000000-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-00000000000d', :u1, 'e1000000-0000-4000-8000-000000000001', 0);
insert into v2_program_sets (user_id, program_exercise_id, position) values (:u1, 'f0000000-0000-4000-8000-00000000000d', 1);
-- So that reassign_exercise_history(E1, E2) reaches its first write: E1 lost, E2 active.
insert into exercises (id, user_id, name, muscle_group) values ('e1000000-0000-4000-8000-000000000002', :u1, 'Incline Press', 'chest');
update exercises set status = 'lost', lost_at = now() where id = 'e1000000-0000-4000-8000-000000000001';
reset role;

-- ─── U2's control rows ────────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', :u2, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
insert into v2_programs (id, user_id, name, kind) values ('a0000000-0000-4000-8000-0000000000bb', :u2, 'U2 saved', 'saved');
insert into v2_sessions (id, user_id, date, status) values ('50000000-0000-4000-8000-0000000000bb', :u2, '2026-09-08', 'completed');
insert into v2_coach_notes (id, user_id, body) values ('70000000-0000-4000-8000-0000000000bb', :u2, 'u2 note');
reset role;

\echo === fixture counts (all users) ===
select 'programs=' || (select count(*) from v2_programs) || ' days=' || (select count(*) from v2_workout_days) || ' pex=' || (select count(*) from v2_program_exercises)
  || ' runs=' || (select count(*) from v2_mesocycles) || ' weeks=' || (select count(*) from v2_week_plans) || ' plansets=' || (select count(*) from v2_week_plan_sets)
  || ' sessions=' || (select count(*) from v2_sessions) || ' logs=' || (select count(*) from v2_set_logs) || ' notes=' || (select count(*) from v2_coach_notes)
  || ' sa=' || (select count(*) from v2_coach_session_analyses) || ' ma=' || (select count(*) from v2_coach_meso_analyses) || ' wa=' || (select count(*) from v2_coach_week_analyses);

\echo === triggers named v2_maintenance_check ===
select count(*) from pg_trigger where tgname = 'v2_maintenance_check' and not tgisinternal;
\echo === grants on v2_app_status after the revokes (expect select only for the API roles) ===
select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'v2_app_status' group by grantee order by 1;

\echo === 1. counts as U1 (expect weeks=2 sessions=2 logged_sets=3 coach_analyses=3 coach_notes=1) ===
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select * from v2_finished_run_counts('c0000000-0000-4000-8000-00000000000c');
\echo === 2. counts of an active run (expect OL003) ===
do $$ begin perform v2_finished_run_counts('c0000000-0000-4000-8000-00000000000d'); raise notice 'NOT REFUSED'; exception when others then raise notice 'refused: % %', sqlstate, sqlerrm; end $$;
reset role;
\echo === 3. counts as U2 of the other users run (expect P0002) ===
select set_config('request.jwt.claim.sub', :u2, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin perform v2_finished_run_counts('c0000000-0000-4000-8000-00000000000c'); raise notice 'NOT REFUSED'; exception when others then raise notice 'refused: % %', sqlstate, sqlerrm; end $$;
\echo === 4. delete as U2 of the other users run (expect P0002, nothing changes) ===
do $$ begin perform v2_delete_finished_run('c0000000-0000-4000-8000-00000000000c'); raise notice 'NOT REFUSED'; exception when others then raise notice 'refused: % %', sqlstate, sqlerrm; end $$;
reset role;
select 'sessions still ' || (select count(*) from v2_sessions);

\echo === 5. maintenance ON: U1 (not exempt) refused with OL001 on a plain insert, on each RPC; postgres passes; exempt U1 passes; U2 still refused ===
update v2_app_status set maintenance = true where id;
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin insert into v2_coach_notes (user_id, body) values (auth.uid(), 'during maintenance'); raise notice 'NOT REFUSED (insert)'; exception when others then raise notice 'insert: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin update v2_programs set name = 'x' where id = 'a0000000-0000-4000-8000-00000000000a'; raise notice 'NOT REFUSED (update)'; exception when others then raise notice 'update: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin delete from v2_coach_notes where id = '70000000-0000-4000-8000-000000000002'; raise notice 'NOT REFUSED (delete)'; exception when others then raise notice 'delete: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform v2_delete_saved_program('a0000000-0000-4000-8000-00000000000a'); raise notice 'NOT REFUSED (v2_delete_saved_program)'; exception when others then raise notice 'v2_delete_saved_program: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform v2_delete_finished_run('c0000000-0000-4000-8000-00000000000c'); raise notice 'NOT REFUSED (v2_delete_finished_run)'; exception when others then raise notice 'v2_delete_finished_run: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform v2_start_run('a0000000-0000-4000-8000-00000000000a', 'new run', current_date); raise notice 'NOT REFUSED (v2_start_run)'; exception when others then raise notice 'v2_start_run: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform v2_plan_week('c0000000-0000-4000-8000-00000000000d', 1); raise notice 'NOT REFUSED (v2_plan_week)'; exception when others then raise notice 'v2_plan_week: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform v2_apply_ops('[{"op":"update","table":"v2_program_exercises","id":"f0000000-0000-4000-8000-00000000000a","patch":{"position":1}}]'::jsonb); raise notice 'NOT REFUSED (v2_apply_ops)'; exception when others then raise notice 'v2_apply_ops: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform reassign_exercise_history('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002'); raise notice 'NOT REFUSED (reassign_exercise_history)'; exception when others then raise notice 'reassign_exercise_history: % %', sqlstate, left(sqlerrm, 40); end $$;
do $$ begin perform v2_make_week_default('c0000000-0000-4000-8000-00000000000d', 1); raise notice 'NOT REFUSED (v2_make_week_default)'; exception when others then raise notice 'v2_make_week_default: % %', sqlstate, left(sqlerrm, 40); end $$;
\echo --- a read during maintenance is fine (expect 1) ---
select count(*) from v2_programs where id = 'a0000000-0000-4000-8000-00000000000a';
\echo --- the API cannot write v2_app_status (expect 42501) ---
do $$ begin update v2_app_status set maintenance = false where id; raise notice 'NOT REFUSED (app_status update)'; exception when others then raise notice 'app_status update: % %', sqlstate, left(sqlerrm, 40); end $$;
reset role;
\echo --- postgres (no JWT role) writes during maintenance (expect 1 row) ---
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true);
with w as (update v2_programs set updated_at = now() where id = 'a0000000-0000-4000-8000-00000000000a' returning 1) select count(*) from w;
\echo --- service_role claim writes during maintenance (expect ok) ---
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $$ begin update v2_programs set updated_at = now() where id = 'a0000000-0000-4000-8000-00000000000a'; raise notice 'service_role: ok'; exception when others then raise notice 'service_role: % %', sqlstate, left(sqlerrm, 40); end $$;
reset role;
\echo --- exempt U1 passes; U2 still refused ---
update v2_app_status set exempt_user_ids = array[:u1::uuid] where id;
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin insert into v2_coach_notes (user_id, body) values (auth.uid(), 'exempt during maintenance'); raise notice 'exempt insert: ok'; exception when others then raise notice 'exempt insert: % %', sqlstate, left(sqlerrm, 40); end $$;
reset role;
select set_config('request.jwt.claim.sub', :u2, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin insert into v2_coach_notes (user_id, body) values (auth.uid(), 'u2 during maintenance'); raise notice 'NOT REFUSED (u2)'; exception when others then raise notice 'u2 insert: % %', sqlstate, left(sqlerrm, 40); end $$;
reset role;
\echo --- anon can read the status (expect 1 row) and cannot write it (expect 42501) ---
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
select count(*) from v2_app_status;
do $$ begin update v2_app_status set maintenance = false where id; raise notice 'NOT REFUSED (anon)'; exception when others then raise notice 'anon update: % %', sqlstate, left(sqlerrm, 40); end $$;
reset role;
update v2_app_status set maintenance = false, exempt_user_ids = '{}' where id;
delete from v2_coach_notes where body = 'exempt during maintenance';

\echo === 6. the full delete as U1 ===
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select v2_delete_finished_run('c0000000-0000-4000-8000-00000000000c');
reset role;
\echo --- after (expect: run M gone, copy RP gone, its day and exercise gone, weeks 2 to 0, plansets 2 to 0, sessions 4 to 2 (M2 and U2 keep theirs), logs 6 to 0, notes 3 to 2 (N1 gone), sa 1 to 0, ma 2 to 1 (MA2 stays), wa 4 to 3 (WA1 gone), SP and M2 untouched, U2 untouched) ---
select 'programs=' || (select count(*) from v2_programs) || ' days=' || (select count(*) from v2_workout_days) || ' pex=' || (select count(*) from v2_program_exercises)
  || ' runs=' || (select count(*) from v2_mesocycles) || ' weeks=' || (select count(*) from v2_week_plans) || ' plansets=' || (select count(*) from v2_week_plan_sets)
  || ' sessions=' || (select count(*) from v2_sessions) || ' logs=' || (select count(*) from v2_set_logs) || ' notes=' || (select count(*) from v2_coach_notes)
  || ' sa=' || (select count(*) from v2_coach_session_analyses) || ' ma=' || (select count(*) from v2_coach_meso_analyses) || ' wa=' || (select count(*) from v2_coach_week_analyses);
select 'M gone=' || (not exists (select 1 from v2_mesocycles where id = 'c0000000-0000-4000-8000-00000000000c'))
  || ' RP gone=' || (not exists (select 1 from v2_programs where id = 'b0000000-0000-4000-8000-00000000000b'))
  || ' SP stays=' || (exists (select 1 from v2_programs where id = 'a0000000-0000-4000-8000-00000000000a'))
  || ' M2 stays=' || (exists (select 1 from v2_mesocycles where id = 'c0000000-0000-4000-8000-00000000000d'))
  || ' N2 stays=' || (exists (select 1 from v2_coach_notes where id = '70000000-0000-4000-8000-000000000002'))
  || ' WA2 stays=' || (exists (select 1 from v2_coach_week_analyses where id = 'a1000000-0000-4000-8000-000000000002'))
  || ' WA1 gone=' || (not exists (select 1 from v2_coach_week_analyses where id = 'a1000000-0000-4000-8000-000000000001'))
  || ' MA2 stays=' || (exists (select 1 from v2_coach_meso_analyses where id = '90000000-0000-4000-8000-000000000002'))
  || ' U2 rows=' || (select count(*) from v2_sessions where user_id = :u2::uuid) || '/' || (select count(*) from v2_coach_notes where user_id = :u2::uuid);
\echo --- the history view no longer lists S1/S2 (expect 0) ---
select count(*) from v2_history_session_summary where id in ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002');

\echo === 7. saved-program delete: refused while M2 is active (OL002); allowed once M2 is completed; idempotent; refused for U2 (P0002); refused on a run copy ===
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin perform v2_delete_saved_program('a0000000-0000-4000-8000-00000000000a'); raise notice 'NOT REFUSED (active run)'; exception when others then raise notice 'active run: % %', sqlstate, left(sqlerrm, 60); end $$;
update v2_mesocycles set status = 'completed', end_date = current_date where id = 'c0000000-0000-4000-8000-00000000000d';
select v2_delete_saved_program('a0000000-0000-4000-8000-00000000000a');
select 'deleted_at set=' || (deleted_at is not null) || ' kind=' || kind || ' source link kept=' || (select count(*) from v2_mesocycles where source_program_id = 'a0000000-0000-4000-8000-00000000000a') from v2_programs where id = 'a0000000-0000-4000-8000-00000000000a';
select pg_sleep(0.01);
select v2_delete_saved_program('a0000000-0000-4000-8000-00000000000a');
select 'second call keeps the first mark=' || (deleted_at < now()) from v2_programs where id = 'a0000000-0000-4000-8000-00000000000a';
do $$ begin perform v2_delete_saved_program('b0000000-0000-4000-8000-00000000000d'); raise notice 'NOT REFUSED (run copy)'; exception when others then raise notice 'run copy: % %', sqlstate, left(sqlerrm, 60); end $$;
reset role;
select set_config('request.jwt.claim.sub', :u2, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$ begin perform v2_delete_saved_program('a0000000-0000-4000-8000-00000000000a'); raise notice 'NOT REFUSED (U2)'; exception when others then raise notice 'U2: % %', sqlstate, left(sqlerrm, 60); end $$;
reset role;

\echo === 8. a copy shared by two finished runs: deleting M3 keeps the copy, deleting M4 removes it ===
select set_config('request.jwt.claim.sub', :u1, true), set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select v2_delete_finished_run('c0000000-0000-4000-8000-00000000000e');
select 'after M3: copy stays=' || (exists (select 1 from v2_programs where id = 'b0000000-0000-4000-8000-00000000000e'));
select v2_delete_finished_run('c0000000-0000-4000-8000-00000000000f');
select 'after M4: copy gone=' || (not exists (select 1 from v2_programs where id = 'b0000000-0000-4000-8000-00000000000e'));
reset role;

\echo === 9. check-migration-style grep of the draft: update/delete/drop/alter type outside function bodies ===
rollback;
