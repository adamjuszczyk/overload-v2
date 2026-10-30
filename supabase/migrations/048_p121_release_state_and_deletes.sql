-- 048: Overload 1.2.1's one migration (TASKS.md chunk 70; SPEC "Objects stored" and "Rules" 2 and 3). Lifted statement
-- for statement from docs/1.2.1/048-draft.sql, which was proven on a scratch replay (docs/1.2.1/048-proof.sql); only
-- these comments differ. Add-only: it changes no existing row. One new table with one static row, one nullable column
-- with no default and no backfill, functions and triggers; the triggers refuse nothing while `maintenance` is false,
-- which is the row's default. Forward-only: a later migration can drop the triggers, the functions, the table and the
-- column once no bundle uses them. Idempotent where the platform may run a file again (if not exists, drop policy / drop
-- trigger if exists, create or replace, on conflict do nothing); a second run does not reset the row.
--
-- [10] [11] v2_app_status: one row, the app's release state. Readable by anyone (anon and authenticated), writable by
-- nobody through the API (no insert/update/delete policy, no grant). Adam changes it in the SQL editor.
create table if not exists v2_app_status (
  id              boolean primary key default true check (id),
  maintenance     boolean not null default false,
  min_version     text not null,
  exempt_user_ids uuid[] not null default '{}',
  updated_at      timestamptz not null default now()
);
alter table v2_app_status enable row level security;
drop policy if exists "Anyone reads the app status" on v2_app_status;
create policy "Anyone reads the app status" on v2_app_status for select using (true);
-- The platform's default privileges grant every API role ALL on a new table (pg_default_acl, read on the replay), and
-- with RLS on and no write policy an API write is a silent zero-row no-op. The revokes make it a refusal (42501).
revoke all on v2_app_status from public, anon, authenticated, service_role;
grant select on v2_app_status to anon, authenticated, service_role;
insert into v2_app_status (id, maintenance, min_version) values (true, false, '1.2.1') on conflict (id) do nothing;

-- The request's JWT role, read the way the hosted auth.role() reads it: the legacy per-claim setting (the replay image,
-- older PostgREST) or the claims JSON (PostgREST 12, production). Null when there is no JWT (migrations, the SQL editor).
create or replace function v2_request_role() returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

-- One check decides maintenance (SPEC Rules 3). Raises OL001 for a signed-in, non-exempt caller while maintenance is on.
create or replace function v2_assert_not_in_maintenance() returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status record;
begin
  if v2_request_role() is distinct from 'authenticated' then return; end if;
  select maintenance, exempt_user_ids into v_status from v2_app_status where id;
  if v_status.maintenance and not coalesce(auth.uid() = any (v_status.exempt_user_ids), false) then
    raise exception 'Overload is being updated. Writes are refused until maintenance is off.'
      using errcode = 'OL001', hint = 'maintenance';
  end if;
end;
$$;

-- [10] The maintenance check: one function, one statement-level BEFORE trigger on every public table that carries a
-- user_id column (the tables a signed-in user can write through RLS). It refuses only requests made with the
-- `authenticated` role (a signed-in user's JWT) while maintenance is on and the caller is not exempt. Migrations, the
-- SQL editor and the dashboard run as postgres (no JWT role) and the service role is not `authenticated`: never refused.
-- A write inside an RPC (v2_apply_ops, v2_plan_week, v2_start_run, reassign_exercise_history, the two delete functions
-- below) fires the same trigger, so every RPC that writes is covered without editing it.
create or replace function v2_refuse_during_maintenance() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform v2_assert_not_in_maintenance();
  return null;
end;
$$;

do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped)
     order by 1
  loop
    execute format('drop trigger if exists v2_maintenance_check on public.%I', r.relname);
    execute format('create trigger v2_maintenance_check before insert or update or delete on public.%I for each statement execute function v2_refuse_during_maintenance()', r.relname);
  end loop;
end $$;

-- [8a] A saved program's "deleted" mark. The row stays; no re-linking.
alter table v2_programs add column if not exists deleted_at timestamptz;

create or replace function v2_delete_saved_program(p_program_id uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_program v2_programs%rowtype;
begin
  perform v2_assert_not_in_maintenance();
  select * into v_program from v2_programs where id = p_program_id and user_id = auth.uid();
  if not found then raise exception 'program not found: %', p_program_id using errcode = 'P0002'; end if;
  if v_program.kind <> 'saved' then raise exception 'not a saved program: %', p_program_id; end if;
  if exists (select 1 from v2_mesocycles m where m.source_program_id = p_program_id and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'a program with a running program cannot be deleted: finish it first' using errcode = 'OL002';
  end if;
  update v2_programs set deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where id = p_program_id and user_id = auth.uid();
end;
$$;
revoke execute on function v2_delete_saved_program(uuid) from public, anon;
grant execute on function v2_delete_saved_program(uuid) to authenticated;

-- [8b] What a full delete removes, and the full delete itself (DECISIONS 249 rows 1–15 and 22).
-- The run's session ids are captured FIRST: v2_coach_notes.session_id is `on delete set null`, so a note can only be
-- found before its session is deleted; the weekly analyses are found by value in input_snapshot->'sessions'.
-- v2_finished_run_sessions is internal (the app never calls it) and no grant line names it. It is not locked away from the API roles
-- on purpose: both callers below are security invoker, so a revoke from `authenticated` makes them fail 42501 (proven on the replay).
-- It returns only the caller's own session ids (RLS and `user_id = auth.uid()`), an empty array for anon.
create or replace function v2_finished_run_sessions(p_mesocycle_id uuid) returns uuid[]
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[]) from v2_sessions s where s.mesocycle_id = p_mesocycle_id and s.user_id = auth.uid();
$$;

create or replace function v2_finished_run_counts(p_mesocycle_id uuid)
returns table (weeks integer, sessions integer, logged_sets integer, coach_analyses integer, coach_notes integer)
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_run v2_mesocycles%rowtype;
  v_sessions uuid[];
begin
  select * into v_run from v2_mesocycles where id = p_mesocycle_id and user_id = auth.uid();
  if not found then raise exception 'program not found: %', p_mesocycle_id using errcode = 'P0002'; end if;
  if v_run.status <> 'completed' then raise exception 'only a finished program can be deleted' using errcode = 'OL003'; end if;
  v_sessions := v2_finished_run_sessions(p_mesocycle_id);
  return query
    select
      (select count(distinct wp.week_number)::integer from v2_week_plans wp where wp.mesocycle_id = p_mesocycle_id and wp.user_id = auth.uid()),
      coalesce(array_length(v_sessions, 1), 0),
      (select count(*)::integer from v2_set_logs l where l.session_id = any (v_sessions) and not l.is_skipped and l.parent_set_id is null and not l.is_warmup),
      (select count(*)::integer from v2_coach_session_analyses a where a.session_id = any (v_sessions))
        + (select count(*)::integer from v2_coach_meso_analyses a where a.mesocycle_id = p_mesocycle_id and a.user_id = auth.uid())
        + (select count(*)::integer from v2_coach_week_analyses w
            where w.user_id = auth.uid()
              and jsonb_typeof(w.input_snapshot -> 'sessions') = 'array'
              and jsonb_array_length(w.input_snapshot -> 'sessions') > 0
              and not exists (select 1 from jsonb_array_elements(w.input_snapshot -> 'sessions') s
                               where (s ->> 'id') is null or (s ->> 'id')::uuid <> all (v_sessions))),
      (select count(*)::integer from v2_coach_notes n where n.session_id = any (v_sessions) and n.user_id = auth.uid());
end;
$$;
revoke execute on function v2_finished_run_counts(uuid) from public, anon;
grant execute on function v2_finished_run_counts(uuid) to authenticated;

create or replace function v2_delete_finished_run(p_mesocycle_id uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run v2_mesocycles%rowtype;
  v_copy v2_programs%rowtype;
  v_sessions uuid[];
begin
  perform v2_assert_not_in_maintenance();
  select * into v_run from v2_mesocycles where id = p_mesocycle_id and user_id = auth.uid();
  if not found then raise exception 'program not found: %', p_mesocycle_id using errcode = 'P0002'; end if;
  if v_run.status <> 'completed' then raise exception 'only a finished program can be deleted' using errcode = 'OL003'; end if;
  v_sessions := v2_finished_run_sessions(p_mesocycle_id);
  select * into v_copy from v2_programs where id = v_run.program_id and user_id = auth.uid();

  -- 2. The explicit deletes (rows 13, 14, 15), on the captured session ids.
  delete from v2_coach_notes n where n.session_id = any (v_sessions) and n.user_id = auth.uid();
  delete from v2_coach_meso_analyses a where a.mesocycle_id = p_mesocycle_id and a.user_id = auth.uid();
  delete from v2_coach_week_analyses w
   where w.user_id = auth.uid()
     and jsonb_typeof(w.input_snapshot -> 'sessions') = 'array'
     and jsonb_array_length(w.input_snapshot -> 'sessions') > 0
     and not exists (select 1 from jsonb_array_elements(w.input_snapshot -> 'sessions') s
                      where (s ->> 'id') is null or (s ->> 'id')::uuid <> all (v_sessions));
  -- 1. The run's sessions: logs, swaps, change rows and session analyses go by cascade.
  delete from v2_sessions s where s.mesocycle_id = p_mesocycle_id and s.user_id = auth.uid();
  -- 3. The run: its weeks, plan, review decisions, run schedules and old priority marks go by cascade.
  delete from v2_mesocycles m where m.id = p_mesocycle_id and m.user_id = auth.uid();
  -- 4. Its copy program, only when it is a run copy that nothing else names (a saved program is never deleted here).
  if v_copy.id is not null and v_copy.kind = 'run'
     and not exists (select 1 from v2_mesocycles m where m.program_id = v_copy.id)
     and not exists (select 1 from v2_week_plans wp join v2_workout_days d on d.id = wp.workout_day_id where d.program_id = v_copy.id)
     and not exists (select 1 from v2_sessions s join v2_workout_days d on d.id = s.workout_day_id where d.program_id = v_copy.id)
  then
    delete from v2_programs p where p.id = v_copy.id and p.user_id = auth.uid();
  end if;
end;
$$;
revoke execute on function v2_delete_finished_run(uuid) from public, anon;
grant execute on function v2_delete_finished_run(uuid) to authenticated;

notify pgrst, 'reload schema';
