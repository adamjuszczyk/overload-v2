-- Overload — Exercise Library Rework, exercise-history reassignment function
-- (EXERCISE-LIBRARY-SPEC.md §3/§5, EXERCISE-LIBRARY-TASKS.md §5, §8 step 8.
-- 022 is the last applied migration — this function's last statement
-- writes to v2_exercise_reassignments, so that table has to exist first.)
--
-- The repo's first .rpc() call (TASKS §2.5) — reassignment touches two
-- tables plus a delete and must be all-or-nothing; supabase-js has no
-- multi-statement transaction, and a dropped connection between two
-- sequential client calls has no undo. SECURITY INVOKER (the default, and
-- deliberately NOT SECURITY DEFINER) so RLS on exercises/
-- v2_program_exercises/v2_week_plan_sets/v2_set_logs applies to the caller
-- exactly as it does from the client; every statement additionally carries
-- an explicit user_id = auth.uid() predicate as defence-in-depth on top,
-- matching 009_v3_history_views.sql's security_invoker + historyService.ts
-- posture. search_path is pinned so an unqualified identifier here always
-- resolves against public, never whatever search_path a future caller has
-- set.

create or replace function reassign_exercise_history(p_source uuid, p_target uuid)
returns table (
  set_logs_moved           integer,
  program_exercises_moved  integer,
  program_exercises_merged integer,
  plan_sets_moved          integer,
  source_deleted           boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source_status text;
  v_target_status text;
  v_source_name   text;
  v_target_name   text;

  v_set_logs_moved           integer := 0;
  v_program_exercises_moved  integer := 0;
  v_program_exercises_merged integer := 0;
  v_plan_sets_moved          integer := 0;
  v_source_deleted           boolean := false;

  v_remaining_set_logs          integer;
  v_remaining_program_exercises integer;
  v_max_set_number              integer;

  rec_pe   record;   -- a colliding (source, target) v2_program_exercises pair, §5.3 step 2b
  rec_wp   record;   -- one week_plan_id under a colliding pair, §5.3 step 2b
  rec_sess record;   -- a session logging both source and target, §5.3 step 3
begin
  -- ── Step 1 — lock and validate (§5.3 step 1) ───────────────────────────
  -- FOR UPDATE here is load-bearing, not hygiene: inserting a v2_set_logs
  -- row takes a FOR KEY SHARE lock on the referenced exercises row to
  -- satisfy the FK, and FOR KEY SHARE conflicts with FOR UPDATE. Holding
  -- FOR UPDATE on the source row for this function's whole duration means
  -- no new set log can be created against the exercise being merged while
  -- it runs — what makes step 5's "zero remaining rows" check a guarantee,
  -- not a snapshot a second device can invalidate a millisecond later.
  if p_source = p_target then
    raise exception 'reassign_exercise_history: source and target must be different exercises';
  end if;

  select status, name into v_source_status, v_source_name
    from exercises where id = p_source and user_id = auth.uid() for update;
  if not found then
    raise exception 'reassign_exercise_history: source exercise % not found', p_source;
  end if;
  if v_source_status <> 'lost' then
    raise exception 'reassign_exercise_history: source exercise % is not lost (status=%)', p_source, v_source_status;
  end if;

  select status, name into v_target_status, v_target_name
    from exercises where id = p_target and user_id = auth.uid() for update;
  if not found then
    raise exception 'reassign_exercise_history: target exercise % not found', p_target;
  end if;
  if v_target_status <> 'active' then
    raise exception 'reassign_exercise_history: target exercise % is not active (status=%)', p_target, v_target_status;
  end if;

  -- ── Step 2a — v2_program_exercises, plain re-point (§5.3 step 2a) ───────
  -- Every source row whose workout day has no row for the target yet.
  -- v2_week_plan_sets follows automatically (§0.2 — it keys on
  -- program_exercise_id, which doesn't change here).
  with moved as (
    update v2_program_exercises
       set exercise_id = p_target
     where exercise_id = p_source
       and user_id = auth.uid()
       and workout_day_id not in (
         select workout_day_id from v2_program_exercises
          where exercise_id = p_target and user_id = auth.uid()
       )
     returning 1
  )
  select count(*) into v_program_exercises_moved from moved;

  -- ── Step 2b — v2_program_exercises, merge collisions (§5.3 step 2b) ─────
  -- Same workout_day_id already lists the target: re-pointing in place
  -- would list one exercise twice. Per colliding pair, move the source's
  -- planned sets onto the surviving row FIRST, then delete the source row —
  -- reversing that order would let ON DELETE CASCADE destroy unlogged
  -- planned sets and ON DELETE SET NULL silently unlink real logged sets
  -- from them.
  for rec_pe in
    select spe.id as source_pe_id, tpe.id as target_pe_id
      from v2_program_exercises spe
      join v2_program_exercises tpe
        on tpe.workout_day_id = spe.workout_day_id
       and tpe.exercise_id = p_target
       and tpe.user_id = auth.uid()
     where spe.exercise_id = p_source
       and spe.user_id = auth.uid()
  loop
    for rec_wp in
      select distinct week_plan_id
        from v2_week_plan_sets
       where program_exercise_id = rec_pe.source_pe_id
         and user_id = auth.uid()
    loop
      select coalesce(max(set_number), 0) into v_max_set_number
        from v2_week_plan_sets
       where program_exercise_id = rec_pe.target_pe_id
         and week_plan_id = rec_wp.week_plan_id
         and user_id = auth.uid();

      -- Renumber heads to continue after the survivor's max, preserving
      -- relative order; stages then mirror their (already renumbered)
      -- head's new number — a stage carries the same set_number as its
      -- head (ExerciseCard.tsx:211), so these two updates must run in this
      -- order, not the other way round.
      with head_renumber as (
        select id, v_max_set_number + row_number() over (order by set_number) as new_number
          from v2_week_plan_sets
         where program_exercise_id = rec_pe.source_pe_id
           and week_plan_id = rec_wp.week_plan_id
           and parent_week_plan_set_id is null
           and user_id = auth.uid()
      )
      update v2_week_plan_sets wps
         set set_number = hr.new_number
        from head_renumber hr
       where wps.id = hr.id;

      update v2_week_plan_sets stage
         set set_number = head.set_number
        from v2_week_plan_sets head
       where stage.parent_week_plan_set_id = head.id
         and stage.program_exercise_id = rec_pe.source_pe_id
         and stage.week_plan_id = rec_wp.week_plan_id
         and stage.user_id = auth.uid()
         and head.user_id = auth.uid();

      with repointed as (
        update v2_week_plan_sets
           set program_exercise_id = rec_pe.target_pe_id
         where program_exercise_id = rec_pe.source_pe_id
           and week_plan_id = rec_wp.week_plan_id
           and user_id = auth.uid()
         returning 1
      )
      select v_plan_sets_moved + count(*) into v_plan_sets_moved from repointed;
    end loop;

    v_program_exercises_merged := v_program_exercises_merged + 1;

    delete from v2_program_exercises
     where id = rec_pe.source_pe_id and user_id = auth.uid();
  end loop;

  -- ── Step 3 — v2_set_logs, renumber before re-pointing (§5.3 step 3) ─────
  -- set_number is 1-based per exercise per session; nothing in the schema
  -- stops two set #1s existing under one exercise once both are merged
  -- (§1). Renumber only the sessions where a collision actually exists —
  -- the swap-exercise case, and the single most likely reassignment this
  -- app will ever see (§5.3).
  for rec_sess in
    select session_id from v2_set_logs
     where exercise_id = p_source and user_id = auth.uid()
    intersect
    select session_id from v2_set_logs
     where exercise_id = p_target and user_id = auth.uid()
  loop
    select coalesce(max(set_number), 0) into v_max_set_number
      from v2_set_logs
     where exercise_id = p_target
       and session_id = rec_sess.session_id
       and user_id = auth.uid();

    with head_renumber as (
      select id, v_max_set_number + row_number() over (order by set_number, logged_at) as new_number
        from v2_set_logs
       where exercise_id = p_source
         and session_id = rec_sess.session_id
         and parent_set_id is null
         and user_id = auth.uid()
    )
    update v2_set_logs sl
       set set_number = hr.new_number
      from head_renumber hr
     where sl.id = hr.id;

    update v2_set_logs stage
       set set_number = head.set_number
      from v2_set_logs head
     where stage.parent_set_id = head.id
       and stage.exercise_id = p_source
       and stage.session_id = rec_sess.session_id
       and stage.user_id = auth.uid()
       and head.user_id = auth.uid();
  end loop;

  with repointed as (
    update v2_set_logs
       set exercise_id = p_target
     where exercise_id = p_source and user_id = auth.uid()
     returning 1
  )
  select count(*) into v_set_logs_moved from repointed;

  -- ── Step 5 — clean up the source row (§5.3 step 5) ─────────────────────
  -- Every reassignment moves the source's ENTIRE history in one
  -- transaction (§5.4), so this should always be zero/zero here. Checked
  -- anyway, under the same step-1 lock, rather than assumed: failing loudly
  -- on the should-be-unreachable branch beats deleting a row that still
  -- owns history.
  select count(*) into v_remaining_set_logs
    from v2_set_logs where exercise_id = p_source and user_id = auth.uid();
  select count(*) into v_remaining_program_exercises
    from v2_program_exercises where exercise_id = p_source and user_id = auth.uid();

  if v_remaining_set_logs = 0 and v_remaining_program_exercises = 0 then
    delete from exercises where id = p_source and user_id = auth.uid();
    v_source_deleted := true;
  else
    v_source_deleted := false;
  end if;

  -- ── Step 6 — write the audit row (§5.3 step 6, §3.4) ────────────────────
  -- Unconditional, including on the should-be-unreachable branch above —
  -- exactly the case a written record is most useful for. Both names were
  -- captured in step 1, before the source row could be deleted here.
  insert into v2_exercise_reassignments (
    user_id, source_exercise_id, source_exercise_name,
    target_exercise_id, target_exercise_name,
    set_logs_moved, program_exercises_moved, program_exercises_merged,
    plan_sets_moved, source_deleted
  ) values (
    auth.uid(), p_source, v_source_name,
    p_target, v_target_name,
    v_set_logs_moved, v_program_exercises_moved, v_program_exercises_merged,
    v_plan_sets_moved, v_source_deleted
  );

  return query select
    v_set_logs_moved, v_program_exercises_moved, v_program_exercises_merged,
    v_plan_sets_moved, v_source_deleted;
end;
$$;

-- PostgREST's authenticated role calls this via supabase.rpc(); explicit
-- grant since this is the repo's first function and nothing in this schema
-- establishes whether default privileges already cover it.
grant execute on function reassign_exercise_history(uuid, uuid) to authenticated;
