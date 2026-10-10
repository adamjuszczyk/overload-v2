-- Overload Planner Extension, revision 1.1 — chunk 27: "Only this week" is
-- removed (SPEC.md [P1.1] "Weeks and copying"; TASKS-1.1.md chunk 27).
--
-- Purpose: v2_plan_week plans a week-dependent week from its source (the last
-- planned normal, non-empty occurrence of the same workout or slot). Its
-- week-to-week branch has copied each source exercise row as
--   coalesce(carry_program_exercise_id, program_exercise_id)   at
--   coalesce(carry_position, position)
-- and has mapped each copied set's program_exercise_id through a temp table
-- (tmp_v2_plan_week_ex_map) built from that same mapping — migrations 032
-- (chunk 9) and 037 (chunk 25). The two carry columns were filled only by the
-- "only this week" tick on a swap or reorder, so copying forward reverted
-- that one-off change. The tick is gone from the app (chunk 27's code, which
-- ships BEFORE this file — see "Order" below), and SPEC says:
--   "'Only this week' is removed. A one-off change is made in the session
--    itself (the mid-workout swap), or changed back the following week.
--    Existing data (default): 'only this week' values already stored are
--    ignored from now on. Copying uses each week's actual content."
-- So the week branch now reads program_exercise_id and position as they are,
-- and a copied set keeps its own program_exercise_id. The carry columns stay
-- in v2_week_plan_exercises with whatever they hold, unread (dropping them
-- would be destructive and buys nothing — TASKS-1.1 "Data model").
--
-- ─── What changes (search `-- [038]` below) ────────────────────────────────
-- The function body is 037's own text, verbatim, except in the places below.
-- 037's `-- [037]` markers are kept exactly as they were, so the two bodies
-- diff cleanly (diff the text from `create or replace function` to the
-- closing `$$;` of each file):
--   a. the week branch's exercise loop selects program_exercise_id and
--      position as they are — no coalesce with carry_program_exercise_id /
--      carry_position (037 L437–438), and the `carry_program_exercise_id`
--      alias the loop used for the value to insert is gone with it;
--   b. tmp_v2_plan_week_ex_map goes: its create, its per-workout delete and
--      its inserts (037 L259–260, L290, L446–448), the remap of each copied
--      set's program_exercise_id through it (037 L474–479), and the
--      v_mapped_pe_id variable that held the result (037 L222) — a copied set
--      inserts v_ps.program_exercise_id.
-- Nothing else changes: the 'program' branch (week 1 and stable), the 'empty'
-- source, the source search and its deload/empty exclusions, the stage-parent
-- remap (tmp_v2_plan_week_set_map), the stable weight/RIR mapping and the
-- signature are 037's. Honouring the carry columns when copying a week is the
-- only behaviour removed.
--
-- ─── Not destructive (TASKS-1.1 chunk 27) ──────────────────────────────────
-- Replaces one function. No row is inserted, updated or deleted by this file,
-- and the carry columns keep their values. What changes is what the NEXT
-- v2_plan_week call copies: a week planned from a source row that stores a
-- carry value now gets that row's own exercise and position. Weeks already
-- planned keep what they got.
--
-- ─── Order (P3) ────────────────────────────────────────────────────────────
-- The code that removes the tick merges first and this file second — the
-- inverse of the standing "migration first" rule, which exists for code that
-- needs its migration; this code does not. In the window between the two,
-- server-side planning still honours values ticked before the code update,
-- which is what the tick promised when it was used. Migration first would
-- have ignored ticks the old screen was still offering.
--
-- check-migration: flags this file (exit 1) — CREATE OR REPLACE FUNCTION, its
-- GRANT EXECUTE and the closing NOTIFY match no safe-list pattern (the same
-- reason 031/032/034/035/037 were each flagged). Expected. D29 lets the
-- reviewer merge it (it changes no existing row; TASKS-1.1 P1, answered).
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
-- `create or replace function v2_plan_week(uuid, integer)` with 037's body
-- verbatim (supabase/migrations/037_planner_p1_sequence_slots.sql, from
-- `create or replace function v2_plan_week(` through its closing `$$;`), then
-- the same grant and notify. That only restores server-side honouring of
-- stored carry values; no data is involved either way.

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
  v_week_start           text;
  v_workout_day_id       uuid;
  v_sequence_position    integer;       -- [037] slot id for a sequence row; always null for weekday
  v_new_plan_id          uuid;
  v_planned_count        integer := 0;

  v_source_kind          text;   -- 'program' | 'week' | 'empty'
  v_wr_week_plan_id      uuid;   -- last planned USABLE (not deload, not empty) week's plan id, or null

  v_pe                   record;
  v_ps                   record;
  v_new_set_id           uuid;
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

  select week_start into v_week_start from v2_user_settings where user_id = v_user_id;
  if v_week_start is null then
    v_week_start := 'copy'; -- no settings row yet: the column default (027, SPEC G4)
  end if;

  -- Scratch id map for this function, session-scoped (ON COMMIT DROP),
  -- cleared at the start of each workout:
  --   tmp_v2_plan_week_set_map — stage -> head reattachment within ONE
  --     workout's copy (either branch below), as in 031.
  -- [038] There is no second map any more: 037 also had
  -- tmp_v2_plan_week_ex_map (the source week's carry-forward
  -- program_exercise_id mapping). A copied set now keeps its own
  -- program_exercise_id.
  create temp table if not exists tmp_v2_plan_week_set_map
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
    delete from tmp_v2_plan_week_set_map;

    v_new_plan_id := null;
    insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, sequence_position, is_deload)
    values (v_user_id, p_mesocycle_id, v_workout_day_id, p_week_number, v_sequence_position, false)  -- [037] + sequence_position
    on conflict (mesocycle_id, workout_day_id, week_number, sequence_position) do nothing  -- [037] 4-column target, R16
    returning id into v_new_plan_id;

    if v_new_plan_id is null then
      continue; -- already planned — by an earlier call, or by the caller that won the race (R10)
    end if;
    v_planned_count := v_planned_count + 1;

    -- The weight/RIR source — and, for a week-dependent week beyond week 1,
    -- the volume source too (SPEC: "Deload sessions are never a copy
    -- source"; DECISIONS 42 (b): skip an empty occurrence the same as a
    -- deload one, for both searches alike). One search, reused for both
    -- purposes. "Empty" := zero v2_week_plan_sets rows (DECISIONS 42's
    -- definition, used exactly this way in weekSources.ts's isEmpty flag
    -- too) — the `not exists` below is the SQL form of that same check.
    -- [037] `sequence_position is not distinct from v_sequence_position`:
    -- a slot's own history search, same slot identity R16 gives every
    -- planned row (workout_day_id alone is ambiguous once a workout can
    -- occupy two slots in one cycle — "copying is per slot: a slot's
    -- source is the same slot's last normal occurrence", TASKS.md). Always
    -- true for a weekday row (both sides null) — unchanged search there.
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
    elsif v_week_start = 'empty' then
      v_source_kind := 'empty';
    elsif v_wr_week_plan_id is not null then
      v_source_kind := 'week';
    else
      v_source_kind := 'empty'; -- week-dependent, copy requested, but nothing usable to copy (DECISIONS 42)
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
      -- keeps it). target_weight/target_rir start null here and are filled
      -- below when a weight/RIR source exists. Joined through
      -- v2_program_exercises with the SAME week_only/removed_at exclusion
      -- as the exercise loop above, so a set under an excluded exercise is
      -- never copied either.
      for v_ps in
        select ps.id, ps.program_exercise_id, ps.position, ps.is_warmup, ps.stage_kind,
               ps.parent_program_set_id, ps.stage_index, ps.rep_min, ps.rep_max, ps.is_amrap
          from v2_program_sets ps
          join v2_program_exercises pe on pe.id = ps.program_exercise_id
         where pe.workout_day_id = v_workout_day_id and ps.user_id = v_user_id
           and pe.week_only = false and pe.removed_at is null
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

      -- ── Stable weight/RIR mapping (see 031's header for the rule) ─────
      if v_wr_week_plan_id is not null then
        with new_heads as (
          select wps.id as new_id, ps.program_exercise_id as pe_id,
                 row_number() over (partition by ps.program_exercise_id order by ps.position) as ord
            from v2_week_plan_sets wps
            join v2_program_sets ps on ps.id = wps.program_set_id
           where wps.week_plan_id = v_new_plan_id and ps.parent_program_set_id is null
        ),
        src_heads as (
          select id as src_id, program_exercise_id as pe_id,
                 row_number() over (partition by program_exercise_id order by set_number) as ord
            from v2_week_plan_sets
           where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
             and parent_week_plan_set_id is null
        ),
        head_matches as (
          select nh.new_id, sh.src_id
            from new_heads nh join src_heads sh on sh.pe_id = nh.pe_id and sh.ord = nh.ord
        ),
        stage_matches as (
          select ns.id as new_id, ss.id as src_id
            from v2_week_plan_sets ns
            join head_matches hm on hm.new_id = ns.parent_week_plan_set_id
            join v2_week_plan_sets ss
              on ss.parent_week_plan_set_id = hm.src_id and ss.stage_index = ns.stage_index
           where ns.week_plan_id = v_new_plan_id
             and ss.week_plan_id = v_wr_week_plan_id and ss.user_id = v_user_id
        ),
        all_matches as (
          select * from head_matches union all select * from stage_matches
        )
        update v2_week_plan_sets wps
           set target_weight = src.target_weight,
               target_rir    = src.target_rir
          from all_matches am
          join v2_week_plan_sets src on src.id = am.src_id
         where wps.id = am.new_id;
      end if;

    elsif v_source_kind = 'week' then
      -- ── Week-to-week copy: exercises, each source row as it is ────────
      -- [038] Every one of the source week's exercise rows is copied with its
      -- OWN program_exercise_id and position. 037 (and 032 before it)
      -- selected coalesce(carry_program_exercise_id, program_exercise_id) and
      -- coalesce(carry_position, position) here, which is how an old "only
      -- this week" swap or reorder reverted on the next copy. Those stored
      -- values are ignored now (SPEC [P1.1]: "'only this week' values
      -- already stored are ignored from now on. Copying uses each week's
      -- actual content."); the carry columns are neither read nor written.
      for v_pe in
        select program_exercise_id, position
          from v2_week_plan_exercises
         where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
      loop
        insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
        values (v_user_id, v_new_plan_id, v_pe.program_exercise_id, v_pe.position)
        on conflict (week_plan_id, program_exercise_id) do nothing;
      end loop;

      -- ── Sets: a direct old-id → new-id remap of the source week's own
      -- sets — identical in spirit to weekPlanService.ts's
      -- copySetsWithGrouping, which the manual copy actions use client
      -- side. Every column (including program_set_id, so the workout
      -- screen's later lookup of design fields keeps working, and
      -- target_weight/target_rir, which this branch therefore needs no
      -- separate mapping step for) is carried through verbatim except
      -- tags (never copied — not selected, not inserted) and is_deload
      -- (a week_plans-level column, not touched here).
      -- [038] program_exercise_id is carried through verbatim as well: 037
      -- (chunk 9) mapped it through tmp_v2_plan_week_ex_map, which is gone,
      -- so a copied set keeps its own program_exercise_id — the same
      -- exercise row the loop above copies.
      for v_ps in
        select id, program_exercise_id, set_number, target_rir, is_dropset,
               parent_week_plan_set_id, stage_index, is_warmup, program_set_id,
               stage_kind, target_weight, rep_min, rep_max, is_amrap
          from v2_week_plan_sets
         where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
         order by (parent_week_plan_set_id is not null), set_number, stage_index
      loop
        insert into v2_week_plan_sets (
          week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset,
          parent_week_plan_set_id, stage_index, is_warmup, program_set_id, stage_kind,
          target_weight, rep_min, rep_max, is_amrap
        )
        values (
          v_new_plan_id, v_user_id, v_ps.program_exercise_id, v_ps.set_number, v_ps.target_rir,
          v_ps.is_dropset,
          (select new_id from tmp_v2_plan_week_set_map where old_id = v_ps.parent_week_plan_set_id),
          v_ps.stage_index, v_ps.is_warmup, v_ps.program_set_id, v_ps.stage_kind,
          v_ps.target_weight, v_ps.rep_min, v_ps.rep_max, v_ps.is_amrap
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

-- Make PostgREST pick up the (unchanged) function signature.
notify pgrst, 'reload schema';
