-- Overload Planner Extension, 1.2 (TASKS-1.2.md chunk 47) — migration 043:
-- v2_apply_ops, the atomic op executor, and the swap's link column.
--
-- Two additions, and nothing else. No existing row changes: the column is
-- nullable with no default (every existing row reads NULL), and the function is
-- only created here, never called by this file.
--
-- ─── 1. v2_program_exercises.replaces_program_exercise_id ─────────────────────
-- DECISIONS 143 (Adam, 2026-10-15): a week-dependent week copied after a CHANGE
-- THE PROGRAM save follows the run copy's exercise list, and a swapped exercise
-- brings the OLD exercise's sets. A swap inserts a new run-copy row and
-- soft-removes the old one (a done session's planned sets name their exercise
-- only through the program-exercise row, so the row can't change in place), so
-- nothing says which row the new one took the place of. This column does: the
-- new row names the old one. It is NULL on every row that isn't a swap's new
-- row. If the replaced row is ever really deleted the link becomes NULL (on
-- delete set null). 044's week branch reads it (chunk 53), following the chain
-- A <- B <- C and stopping at a loop.
--
-- ─── 2. v2_apply_ops(p_ops jsonb) returns integer ─────────────────────────────
-- A save that touches many rows lands or fails as a whole (SPEC [1.2]: "SAVE
-- CHANGES writes everything at once"; REVIEW's actions write "at once"). The
-- client computes an op list (src/features/programs/programChange.ts, chunk 45,
-- is the pure function that produces it; applyOps.ts, this chunk, is the client)
-- and sends it here; this function applies it in ONE transaction, in order, on a
-- fixed list of tables, scoped to the caller. The SQL holds no planning logic.
--
--   p_ops   a JSON array of
--             { "op": "insert", "table": T, "row": { ...every column... } }
--             { "op": "update", "table": T, "id": uuid, "patch": { ...columns... } }
--             { "op": "delete", "table": T, "id": uuid }
--   returns the number of ops applied. An empty list returns 0.
--   raises  on the first op it can't apply; the whole call then rolls back, so
--           the first op's rows are not there either (a plpgsql function runs in
--           the caller's one transaction). The message says what was refused:
--             not signed in                       auth.uid() is null
--             ops must be a list                  p_ops is not a JSON array
--             op N is not an object
--             table not allowed                   a table not on the list below
--             unknown op: X                       "op" is not insert/update/delete
--             insert not allowed on T             v2_programs, v2_workout_days, v2_week_plans
--             insert needs a row                  "row" is missing or not an object
--             row names an unknown column: T.C    a key that is not a column of T
--             update needs a patch                "patch" is missing or not an object
--             patch sets a protected column       id, user_id; for v2_week_plans
--                                                 any column but deload_restore
--             patch is empty                      {}: nothing to set
--             delete not allowed on T             v2_week_plans
--             row not found: T/ID                 update/delete matched no row
--                                                 of the caller's
--           and Postgres' own error for anything a table refuses (a CHECK, a
--           foreign key, a unique index, NOT NULL).
--
-- The tables (TASKS-1.2 chunk 47, Scope; v2_week_plans by DECISIONS 142):
--   v2_program_exercises, v2_program_sets, v2_program_superset_blocks,
--   v2_workout_warmup_items, v2_workout_days, v2_programs, v2_run_schedules,
--   v2_week_plans, v2_week_plan_exercises, v2_week_plan_sets,
--   v2_week_review_decisions, v2_session_set_changes.
--
-- What each op may do:
--   insert  A full row with its own, client-generated id, so a later op in the
--           same list can reference it. The row is built by jsonb_populate_record
--           with user_id OVERWRITTEN by auth.uid(): a row naming another user's
--           id lands with the caller's. A column the row leaves out is NULL, not
--           the column's default (jsonb_populate_record's way), so a row names
--           every NOT NULL column (created_at on the tables that have one). A key
--           that isn't a column of the table raises instead of being dropped.
--           No inserts into v2_programs or v2_workout_days (a run's program and
--           workouts are made by v2_start_run), and none into v2_week_plans.
--   update  id + patch. A patch never names id or user_id. A patch names columns
--           (an unknown one raises 42703); a value is converted as the column's
--           type does (jsonb_populate_record again): a JSON null is SQL NULL, a
--           JSON array is a text[] for tags, an object stays an object for the
--           jsonb columns. v2_week_plans takes ONE column, deload_restore (a
--           CHANGE THE PROGRAM save rewrites a not-started deload session's saved
--           plan, DECISIONS 142, Adam 2026-10-15: "Migration 043's executor may
--           write v2_week_plans for that one column only, as an update only: no
--           insert or delete on v2_week_plans, no other column. A patch touching
--           any other v2_week_plans column is rejected like a protected column").
--   delete  id. A planned head's stages go with it by their foreign key, as they
--           do for a delete over PostgREST.
-- Every update and delete is `where id = … and user_id = auth.uid()`: pg-safeupdate
-- (production runs it; the replay does not) needs a WHERE, and the caller's rows
-- are the only ones it can see anyway (security invoker, so RLS applies as well).
--
-- SECURITY INVOKER with a fixed search_path, like 034-041. The table is only
-- ever taken from the list above, never from the caller's text, and is quoted
-- with %I all the same. Execute is granted to authenticated alone: anon is
-- revoked (Supabase's default privileges grant execute to anon on a new function
-- in public; 028-041 left that, and each of them takes the user from auth.uid()
-- or a parameter; this one is revoked so a signed-out call is refused at the
-- grant, not only by the first check).
--
-- Rollback: `drop function v2_apply_ops(jsonb)` in a later migration (nothing
-- else references it). The column stays (forward-only), or is dropped once no
-- bundle writes it.

-- ═══ 1. The swap's link ══════════════════════════════════════════════════════

alter table v2_program_exercises
  add column if not exists replaces_program_exercise_id uuid
    references v2_program_exercises(id) on delete set null;

-- ═══ 2. The op executor ══════════════════════════════════════════════════════

create or replace function v2_apply_ops(p_ops jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_tables constant text[] := array[
    'v2_program_exercises', 'v2_program_sets', 'v2_program_superset_blocks', 'v2_workout_warmup_items',
    'v2_workout_days', 'v2_programs', 'v2_run_schedules', 'v2_week_plans',
    'v2_week_plan_exercises', 'v2_week_plan_sets', 'v2_week_review_decisions', 'v2_session_set_changes'
  ];
  v_op     jsonb;
  v_ord    bigint;
  v_kind   text;
  v_table  text;
  v_id     uuid;
  v_row    jsonb;
  v_patch  jsonb;
  v_col    text;
  v_sets   text;
  v_count  bigint;
  v_done   integer := 0;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'ops must be a list';
  end if;

  -- In the order the list gives them: an insert can be followed by rows that
  -- reference it.
  for v_op, v_ord in
    select e.value, e.ordinality
      from jsonb_array_elements(p_ops) with ordinality as e(value, ordinality)
     order by e.ordinality
  loop
    if jsonb_typeof(v_op) <> 'object' then
      raise exception 'op % is not an object', v_ord;
    end if;
    v_kind  := v_op ->> 'op';
    v_table := v_op ->> 'table';

    if v_table is null or not (v_table = any (v_tables)) then
      raise exception 'table not allowed'
        using detail = format('op %s names %s', v_ord, coalesce(v_table, 'no table'));
    end if;

    if v_kind = 'insert' then
      if v_table in ('v2_programs', 'v2_workout_days', 'v2_week_plans') then
        raise exception 'insert not allowed on %', v_table;
      end if;
      v_row := v_op -> 'row';
      if jsonb_typeof(v_row) is distinct from 'object' then
        raise exception 'insert needs a row'
          using detail = format('op %s on %s', v_ord, v_table);
      end if;
      -- jsonb_populate_record drops a key it doesn't know without a word; a row
      -- that names a column the table hasn't got is a mistake to refuse.
      select k into v_col
        from jsonb_object_keys(v_row) as k
       where not exists (
               select 1 from pg_attribute a
                where a.attrelid = format('public.%I', v_table)::regclass
                  and a.attnum > 0 and not a.attisdropped and a.attname = k)
       order by k
       limit 1;
      if v_col is not null then
        raise exception 'row names an unknown column: %.%', v_table, v_col;
      end if;
      v_row := v_row || jsonb_build_object('user_id', v_uid);
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
        v_table, v_table
      ) using v_row;

    elsif v_kind = 'update' then
      v_id := (v_op ->> 'id')::uuid;
      v_patch := v_op -> 'patch';
      if jsonb_typeof(v_patch) is distinct from 'object' then
        raise exception 'update needs a patch'
          using detail = format('op %s on %s/%s', v_ord, v_table, v_id);
      end if;
      if v_patch ? 'id' or v_patch ? 'user_id' then
        raise exception 'patch sets a protected column';
      end if;
      -- v2_week_plans: deload_restore and nothing else (DECISIONS 142).
      if v_table = 'v2_week_plans' then
        select k into v_col from jsonb_object_keys(v_patch) as k where k <> 'deload_restore' limit 1;
        if v_col is not null then
          raise exception 'patch sets a protected column';
        end if;
      end if;
      select string_agg(format('%I = (p.r).%I', k, k), ', ' order by k)
        into v_sets
        from jsonb_object_keys(v_patch) as k;
      if v_sets is null then
        raise exception 'patch is empty'
          using detail = format('op %s on %s/%s', v_ord, v_table, v_id);
      end if;
      execute format(
        'update public.%I as t set %s from (select jsonb_populate_record(null::public.%I, $1) as r) as p'
        ' where t.id = $2 and t.user_id = $3',
        v_table, v_sets, v_table
      ) using v_patch, v_id, v_uid;
      get diagnostics v_count = row_count;
      if v_count = 0 then
        raise exception 'row not found: %/%', v_table, v_id;
      end if;

    elsif v_kind = 'delete' then
      if v_table = 'v2_week_plans' then
        raise exception 'delete not allowed on %', v_table;
      end if;
      v_id := (v_op ->> 'id')::uuid;
      execute format('delete from public.%I as t where t.id = $1 and t.user_id = $2', v_table)
        using v_id, v_uid;
      get diagnostics v_count = row_count;
      if v_count = 0 then
        raise exception 'row not found: %/%', v_table, v_id;
      end if;

    else
      raise exception 'unknown op: %', coalesce(v_kind, 'none');
    end if;

    v_done := v_done + 1;
  end loop;

  return v_done;
end
$fn$;

revoke execute on function v2_apply_ops(jsonb) from public, anon;
grant execute on function v2_apply_ops(jsonb) to authenticated;

-- Make PostgREST pick up the new column and the function.
notify pgrst, 'reload schema';
