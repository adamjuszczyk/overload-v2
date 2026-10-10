-- Overload Planner Extension, revision 1.1 — chunk 34: a stable week's weights
-- and RIR pair warmup to warmup and working set to working set (SPEC.md [P1.1]
-- "Weeks and copying", G44; TASKS-1.1.md chunk 34).
--
-- Purpose: SPEC says, for a stable week,
--   "Weights and RIR always come from last week, for both planning types (the
--    source of weight and RIR targets above). In a stable week they're matched
--    to last week's sets: warmups to warmups and working sets to working sets,
--    by position within each exercise."
-- v2_plan_week builds a stable week (and any week 1) from the run's copy,
-- which holds no weights, then copies target_weight / target_rir across from
-- the last planned usable week — "Stable weight/RIR mapping", written down in
-- 031's header and carried unchanged through 032, 037 and 038. That mapping
-- numbered each exercise row's heads in ONE sequence (by
-- v2_program_sets.position on the new week's side, by
-- v2_week_plan_sets.set_number on last week's side) and matched ordinal to
-- ordinal, warmups and working sets counted together. So a warmup added or
-- removed last week moved every later ordinal by one:
--   - last week has a 60 kg warmup above working sets at 100, 105 and 110, the
--     default has no warmup: the new week's working sets got 60, 100, 105;
--   - the default has a warmup, last week's was deleted: the new warmup got
--     last week's first working set's weight, each new working set the weight
--     of the next one, and the last working set none.
--
-- ─── What changes (search `-- [039]` below) ────────────────────────────────
-- The function body is 038's own text, verbatim, except in the stable
-- weight/RIR mapping (the block that follows the `-- ── Stable weight/RIR
-- mapping` heading in the 'program' branch). 037's `-- [037]` and 038's
-- `-- [038]` markers are kept exactly as they were, so the two bodies diff
-- cleanly (diff the text from `create or replace function` to the closing
-- `$$;` of each file):
--   a. new_heads and src_heads also carry the head's is_warmup flag
--      (v2_week_plan_sets.is_warmup on both sides: the new week's sets were
--      just inserted with their program set's flag, so the two agree) and
--      number the heads within (exercise row, is_warmup) instead of within
--      the exercise row alone — still by v2_program_sets.position on the new
--      week's side and by v2_week_plan_sets.set_number on last week's;
--   b. head_matches joins on all three: exercise row, is_warmup, ordinal;
--   c. the block's heading comment points here and says what the rule is.
-- Nothing else changes: stage_matches (a stage takes its weight and RIR from
-- the matched head's stage with the same stage_index — warmup-ness is decided
-- on heads only, a stage follows its head), the update, the 'program'
-- branch's exercise and set inserts, the 'week' branch (a week-dependent week
-- copies last week's sets whole, weights included), the 'empty' source, the
-- source search and its deload/empty exclusions, the sequence slots, the
-- signature, security invoker, search_path, the grant and the notify are
-- 038's.
--
-- Points SPEC leaves implicit, and what this file does with them:
--   - "Kind" means warmup (is_warmup) or not. A staged head is a working set
--     for matching; its stages ride with it.
--   - "A slot that wasn't in last week gets no weights" (TASKS-1.1 Readings):
--     unchanged, because the join still needs the same program_exercise_id on
--     both sides. Likewise an ordinal with no counterpart of its own kind (the
--     default has three working sets, last week two) keeps a null weight and
--     RIR; it never takes a neighbour's.
--   - Equal positions (two heads of one exercise and kind with the same
--     position / set_number) are numbered in whatever order Postgres returns
--     them, exactly as in 031-038; no tie-breaker is added. The app is
--     written to keep positions distinct (addWarmupSet shifts the later sets
--     down, highest number first), and numbering within a kind only shrinks
--     the places a tie can matter.
--
-- ─── Not destructive (TASKS-1.1 chunk 34) ──────────────────────────────────
-- Replaces one function. No row is inserted, updated or deleted by this file.
-- What changes is what the NEXT v2_plan_week call writes into a stable week's
-- target_weight / target_rir. Weeks already planned keep their weights.
-- Signature, security invoker, search_path and grant are 038's. No client
-- code changes: v2_plan_week is the only path that maps a stable week's
-- weights (createWeekPlan writes exercises only).
--
-- ─── Order ─────────────────────────────────────────────────────────────────
-- Starts from 038's body (P5: 038, 039 and 040 each replace v2_plan_week and
-- merge in that order).
--
-- check-migration: flags this file (exit 1) — CREATE OR REPLACE FUNCTION, its
-- GRANT EXECUTE and the closing NOTIFY match no safe-list pattern (the same
-- reason 031/032/034/035/037/038 were each flagged). Expected. D29 lets the
-- reviewer merge it (it changes no existing row; TASKS-1.1 P4, answered).
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
-- `create or replace function v2_plan_week(uuid, integer)` with 038's body
-- verbatim (supabase/migrations/038_p11_plan_week_ignore_carry.sql, from
-- `create or replace function v2_plan_week(` through its closing `$$;`), then
-- the same grant and notify. That only restores the one-sequence numbering
-- for weeks planned afterwards; no data is involved either way.

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

      -- ── Stable weight/RIR mapping (see 039's header for the rule) ─────
      -- [039] A head takes its weight and RIR from last week's head of the
      -- SAME KIND at the same position within the exercise: warmups from
      -- warmups, working sets from working sets. Heads are numbered within
      -- (exercise row, is_warmup) — by v2_program_sets.position on the new
      -- week's side, by v2_week_plan_sets.set_number on last week's — and
      -- matched on all three (exercise row, is_warmup, ordinal). 031-038
      -- numbered warmups and working sets in one sequence, so a warmup added
      -- or removed last week shifted every weight by one set. A stage still
      -- takes its weight and RIR from the matched head's stage with the same
      -- stage_index (warmup-ness is decided on heads only).
      if v_wr_week_plan_id is not null then
        with new_heads as (
          select wps.id as new_id, ps.program_exercise_id as pe_id,
                 wps.is_warmup as is_warmup,  -- [039]
                 row_number() over (partition by ps.program_exercise_id, wps.is_warmup  -- [039]
                                    order by ps.position) as ord
            from v2_week_plan_sets wps
            join v2_program_sets ps on ps.id = wps.program_set_id
           where wps.week_plan_id = v_new_plan_id and ps.parent_program_set_id is null
        ),
        src_heads as (
          select id as src_id, program_exercise_id as pe_id,
                 is_warmup,  -- [039]
                 row_number() over (partition by program_exercise_id, is_warmup  -- [039]
                                    order by set_number) as ord
            from v2_week_plan_sets
           where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
             and parent_week_plan_set_id is null
        ),
        head_matches as (
          select nh.new_id, sh.src_id
            from new_heads nh
            join src_heads sh
              on sh.pe_id = nh.pe_id and sh.is_warmup = nh.is_warmup and sh.ord = nh.ord  -- [039]
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
