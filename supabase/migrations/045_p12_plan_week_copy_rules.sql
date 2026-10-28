-- Overload Planner Extension, 1.2 (TASKS-1.2.md chunk 53) — migration 045:
-- v2_plan_week with the 1.2 copy rules.
--
-- One function re-created, and nothing else. No table, column, row, constraint,
-- policy or grant changes: `create or replace function` keeps the signature, the
-- owner and the grants, and a week that is already planned keeps every row it
-- holds (the function never touches one: a slot that has a plan row is skipped).
--
-- The starting point is 041's body (the latest, with `where true` on its
-- temp-table clear). What changes, and the SPEC rule behind each change (SPEC.md,
-- Weeks and copying -> "What the auto-copy takes (2b)"):
--
--   1. The `week_start` setting is not read. 1.2 removes "new week starts: copy /
--      empty" (SPEC, Objects stored -> Settings). A week-dependent week beyond
--      week 1 is planned from the slot's last usable week, and is empty only when
--      there is no usable week at all ("nothing usable to copy", DECISIONS 42).
--      The column stays, unread and no longer written (chunk 49).
--
--   2. The 'program' branch (week 1 of any run; every week of a stable run) keeps
--      its structure and its rep targets, and loses 041's weight and RIR mapping
--      (the block that filled `target_weight` / `target_rir` from the last usable
--      week). SPEC: "Weight, reps (week-dependent) and RIR are never auto-copied:
--      they come with COPY." A stable week still takes the default's rep targets.
--
--   3. The 'week' branch copies the structure of the source week and no number.
--      Every column that says what the set IS rides along (`is_warmup`,
--      `stage_kind`, the parent link, remapped, `stage_index`, `program_set_id`,
--      `is_dropset`, `set_number`); `target_weight`, `target_rir`,
--      `target_rir_max`, `rep_min`, `rep_max` and `tags` are NULL and `is_amrap`
--      is false. AMRAP is a rep target, so it is not copied (SPEC, Targets).
--      "A week-dependent week's copied set has no rep target of its own and does
--      not fall back to the run copy's (week 1's) target". `is_deload` is false
--      as before.
--
--   4. DECISIONS 143 (Adam, 2026-10-15): the 'week' branch takes its EXERCISE LIST
--      AND ORDER from the run copy and its SETS from the source week. Why: the
--      week a new week is copied from is the workout's last planned normal week,
--      and a CHANGE THE PROGRAM save never touches a session that is done or in
--      progress, so without this a removed exercise came back, an added one was
--      missing and a swap was undone. Each live exercise of the run copy's
--      workout (`week_only = false and removed_at is null`) is one of:
--        kept ....... the source week lists it: it brings that week's sets;
--        swapped .... the source week doesn't list it, but it replaced an exercise
--                     the source week does (v2_program_exercises.
--                     replaces_program_exercise_id, 043, followed through swaps of
--                     swaps and stopping at a loop): it brings that exercise's
--                     sets, pointed at it. An exercise's sets go to one row only: a
--                     live row the source week lists keeps its own, and of two
--                     rows that replaced the same one the first by position wins;
--        added ...... otherwise it arrives with no sets.
--      An exercise the source week lists whose run-copy row is removed, and that no
--      swap took the place of, is left out with its sets. Two kinds of source row
--      the run copy doesn't list as live stay exactly as the source week has them:
--      a week-only slot that wasn't removed (a 1.1 week-level add or swap carried
--      forward: "copying uses each week's actual content") and a row of another
--      workout or one the run copy doesn't know. They follow the run copy's rows,
--      numbered from the run copy's last position + 1 in the source week's own
--      order. The release's data migration (046, DECISIONS 149 (c)) makes the run
--      copy match the last planned week, so for a run 1.1 changed in the week view
--      nothing the user sees changes.
--      Ties are ordered, so the result never depends on the order rows come in:
--      the run copy's live rows by (position, id), the source week's by (position,
--      program_exercise_id), its sets by (heads first, set_number, stage_index, id).
--      The TypeScript twin is autoCopy / copyFromWeek (src/features/plan/
--      weekPlanning.ts, chunk 42), whose tests are the specification:
--      `node scripts/plan-week-parity.mjs` runs both on one fixture and compares
--      them row for row (TASKS-1.2 "Checks that lied" #28).
--
-- Unchanged: the slot loop (weekday rows from the run copy's schedule, sequence
-- rows from v2_program_sequence_items), the plan row's `on conflict ... do nothing`
-- (idempotent per slot, R10), the source search (the slot's latest earlier week
-- that isn't a deload session and has at least one set; DECISIONS 42, so a week
-- nobody planned is simply not there: the week planned after a week off copies the
-- last planned normal week, DECISIONS 131), security invoker, the search_path, the
-- grant, and `where true` on every temp-table clear (production runs pg-safeupdate,
-- which rejects a bare DELETE or UPDATE inside a function too; replay doesn't load
-- it, so this is proven separately, as the signed-in role with safeupdate loaded).
--
-- Not destructive. Rollback: `create or replace function v2_plan_week` with 041's
-- body verbatim (supabase/migrations/041_safeupdate_where_true.sql, the block
-- between "2. v2_plan_week" and "3. v2_make_week_default"), in a later migration.
-- `check-migration` flags "function": the reviewer merges into staging and logs it
-- under "For the release".

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
  v_workout_day_id       uuid;
  v_sequence_position    integer;       -- [037] slot id for a sequence row; always null for weekday
  v_new_plan_id          uuid;
  v_planned_count        integer := 0;

  v_source_kind          text;   -- 'program' | 'week' | 'empty'
  v_wr_week_plan_id      uuid;   -- last planned USABLE (not deload, not empty) week's plan id, or null

  v_pe                   record;
  v_ps                   record;
  v_new_set_id           uuid;

  v_walked               uuid[]; -- [045] the exercise rows one replaces-chain has passed through
  v_link                 uuid;   -- [045] the row a swapped-in exercise took the place of, one step at a time
  v_next                 integer; -- [045] the next position for a source row the run copy doesn't list as live
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

  -- [045] 041 read the user's `week_start` setting here. 1.2 removes the setting
  -- (SPEC, Objects stored -> Settings): nothing reads it, so it cannot change
  -- what a week gets.

  -- Scratch id maps for this function, session-scoped (ON COMMIT DROP),
  -- cleared at the start of each workout:
  --   tmp_v2_plan_week_set_map — stage -> head reattachment within ONE
  --     workout's copy (either branch below), as in 031.
  --   tmp_v2_plan_week_exercise_map — [045] the 'week' branch: the source week's
  --     program exercise -> the run-copy row its sets are copied under (itself,
  --     or the swapped-in row that took its place). The source week's rows that
  --     are copied are exactly the ones in this map.
  -- [038] There was a second map in 037 — tmp_v2_plan_week_ex_map, the source
  -- week's carry-forward program_exercise_id mapping — and 038 removed it. This
  -- is a different map, with a different name.
  create temp table if not exists tmp_v2_plan_week_set_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table if not exists tmp_v2_plan_week_exercise_map
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
    delete from tmp_v2_plan_week_exercise_map where true;

    v_new_plan_id := null;
    insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
    values (v_user_id, p_mesocycle_id, v_workout_day_id, p_week_number, v_sequence_position, false)  -- [037] + sequence_position
    on conflict (mesocycle_id, workout_day_id, week_number, sequence_position) do nothing  -- [037] 4-column target, R16
    returning id into v_new_plan_id;

    if v_new_plan_id is null then
      continue; -- already planned — by an earlier call, or by the caller that won the race (R10)
    end if;
    v_planned_count := v_planned_count + 1;

    -- The source of a week-dependent week beyond week 1 (SPEC: "Deload sessions
    -- are never a copy source"; DECISIONS 42 (b): skip an empty occurrence the
    -- same as a deload one). "Empty" := zero v2_week_plan_sets rows (DECISIONS
    -- 42's definition, used exactly this way in weekSources.ts's isEmpty flag
    -- too) — the `not exists` below is the SQL form of that same check.
    -- [037] `sequence_position is not distinct from v_sequence_position`:
    -- a slot's own history search, same slot identity R16 gives every
    -- planned row (workout_day_id alone is ambiguous once a workout can
    -- occupy two slots in one cycle — "copying is per slot: a slot's
    -- source is the same slot's last normal occurrence", TASKS.md). Always
    -- true for a weekday row (both sides null) — unchanged search there.
    -- [045] Only the 'week' branch reads it now (041 also mapped weights and
    -- RIR from it in the 'program' branch). A week nobody planned isn't a row,
    -- so it can't be the source: the week planned after a week off copies the
    -- last planned normal week, whatever its number (DECISIONS 131).
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
    elsif v_wr_week_plan_id is not null then   -- [045] 041 also asked for week_start = 'empty' here
      v_source_kind := 'week';
    else
      v_source_kind := 'empty'; -- week-dependent, nothing usable to copy (DECISIONS 42)
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
      -- keeps it). target_weight/target_rir stay null: [045] a new week gets
      -- no number, so 041's weight/RIR mapping from the last usable week is
      -- gone. The rep targets are the program set's own. Joined through
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

    elsif v_source_kind = 'week' then
      -- ── Week-to-week copy [045]: the exercise list is the run copy's, the sets
      -- are the source week's (DECISIONS 143; see the header, change 4).
      --
      -- [038] A copied set keeps its own program_exercise_id and the carry columns
      -- are neither read nor written (SPEC [P1.1]: "'only this week' values
      -- already stored are ignored from now on. Copying uses each week's actual
      -- content."): kept.

      -- (a) A live run-copy row the source week lists is kept: it brings its own
      -- sets. The map is source row -> the row its sets go under.
      insert into tmp_v2_plan_week_exercise_map (old_id, new_id)
      select pe.id, pe.id
        from v2_program_exercises pe
       where pe.workout_day_id = v_workout_day_id and pe.user_id = v_user_id
         and pe.week_only = false and pe.removed_at is null
         and exists (select 1 from v2_week_plan_exercises x
                      where x.week_plan_id = v_wr_week_plan_id and x.user_id = v_user_id
                        and x.program_exercise_id = pe.id);

      -- (b) A live row the source week doesn't list may have replaced one it does:
      -- it takes that exercise's sets. The chain of `replaces_program_exercise_id`
      -- is followed from the new row (a swap of a swap included) to the nearest
      -- row the source week lists. The walk stops at a loop and at a link to no
      -- row of this workout (v_walked holds the rows passed; a row that replaces
      -- itself, or A replaces B replaces A, ends it). The sets go to one row
      -- only: a source row already in the map (a live row the source week lists,
      -- or one an earlier swapped-in row took) is not taken again, so of two rows
      -- that replaced the same one the first by (position, id) has its sets.
      for v_pe in
        select pe.id, pe.replaces_program_exercise_id as replaces
          from v2_program_exercises pe
         where pe.workout_day_id = v_workout_day_id and pe.user_id = v_user_id
           and pe.week_only = false and pe.removed_at is null
           and not exists (select 1 from v2_week_plan_exercises x
                            where x.week_plan_id = v_wr_week_plan_id and x.user_id = v_user_id
                              and x.program_exercise_id = pe.id)
         order by pe.position, pe.id
      loop
        v_walked := array[v_pe.id];
        v_link := v_pe.replaces;
        while v_link is not null and not (v_link = any (v_walked)) loop
          if exists (select 1 from v2_week_plan_exercises x
                      where x.week_plan_id = v_wr_week_plan_id and x.user_id = v_user_id
                        and x.program_exercise_id = v_link) then
            if not exists (select 1 from tmp_v2_plan_week_exercise_map m where m.old_id = v_link) then
              insert into tmp_v2_plan_week_exercise_map (old_id, new_id) values (v_link, v_pe.id);
            end if;
            exit;
          end if;
          v_walked := v_walked || v_link;
          v_link := null;
          select pe2.replaces_program_exercise_id into v_link
            from v2_program_exercises pe2
           where pe2.id = v_walked[array_upper(v_walked, 1)]
             and pe2.workout_day_id = v_workout_day_id and pe2.user_id = v_user_id;
        end loop;
      end loop;

      -- (c) The new week's exercises: every live row of the run copy, in the run
      -- copy's order with its own position.
      insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
      select v_user_id, v_new_plan_id, pe.id, pe.position
        from v2_program_exercises pe
       where pe.workout_day_id = v_workout_day_id and pe.user_id = v_user_id
         and pe.week_only = false and pe.removed_at is null
       order by pe.position, pe.id;

      -- (d) Then the source week's rows the run copy doesn't list as live and
      -- hasn't spoken for, as the source week has them: a week-only slot that
      -- wasn't removed, and a row of another workout or one the run copy doesn't
      -- know. A row the run copy lists as removed (week-only or not) is gone.
      -- Numbered after the run copy's last position, in the source week's order.
      select greatest(0, coalesce(max(pe.position) + 1, 0)) into v_next
        from v2_program_exercises pe
       where pe.workout_day_id = v_workout_day_id and pe.user_id = v_user_id
         and pe.week_only = false and pe.removed_at is null;
      for v_pe in
        select x.program_exercise_id as id
          from v2_week_plan_exercises x
         where x.week_plan_id = v_wr_week_plan_id and x.user_id = v_user_id
         order by x.position, x.program_exercise_id
      loop
        continue when exists (select 1 from tmp_v2_plan_week_exercise_map m where m.old_id = v_pe.id);
        continue when exists (select 1 from v2_program_exercises pe
                               where pe.id = v_pe.id and pe.workout_day_id = v_workout_day_id
                                 and pe.user_id = v_user_id and pe.removed_at is not null);
        insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
        values (v_user_id, v_new_plan_id, v_pe.id, v_next);
        v_next := v_next + 1;
        insert into tmp_v2_plan_week_exercise_map (old_id, new_id) values (v_pe.id, v_pe.id);
      end loop;

      -- ── Sets: the source week's own, of the exercises in the map, under the
      -- row the map says (itself, or the swapped-in row), by a direct old-id ->
      -- new-id remap — identical in spirit to weekPlanService.ts's
      -- copySetsWithGrouping. The structure columns ride along (set_number,
      -- is_dropset, stage_index, is_warmup, program_set_id so the workout
      -- screen's later lookup of design fields keeps working, stage_kind), and
      -- the parent link is remapped; a stage whose head isn't copied has none.
      -- [045] Every number is left out of the insert: target_weight, target_rir,
      -- target_rir_max, rep_min, rep_max and tags are NULL, is_amrap is false
      -- (a rep target, so AMRAP isn't copied either). is_deload (a week_plans
      -- column) isn't touched. Heads before stages, so a stage's parent is
      -- already in the map; ties are ordered by id.
      for v_ps in
        select s.id, em.new_id as program_exercise_id, s.set_number, s.is_dropset,
               s.parent_week_plan_set_id, s.stage_index, s.is_warmup, s.program_set_id, s.stage_kind
          from v2_week_plan_sets s
          join tmp_v2_plan_week_exercise_map em on em.old_id = s.program_exercise_id
         where s.week_plan_id = v_wr_week_plan_id and s.user_id = v_user_id
         order by (s.parent_week_plan_set_id is not null), s.set_number, s.stage_index, s.id
      loop
        insert into v2_week_plan_sets (
          week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset,
          parent_week_plan_set_id, stage_index, is_warmup, program_set_id, stage_kind,
          target_weight, rep_min, rep_max, is_amrap
        )
        values (
          v_new_plan_id, v_user_id, v_ps.program_exercise_id, v_ps.set_number, null,
          v_ps.is_dropset,
          (select new_id from tmp_v2_plan_week_set_map where old_id = v_ps.parent_week_plan_set_id),
          v_ps.stage_index, v_ps.is_warmup, v_ps.program_set_id, v_ps.stage_kind,
          null, null, null, false
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

-- Make PostgREST pick up the re-created function.
notify pgrst, 'reload schema';
