-- Overload Planner Extension, phase 1 — edit a week's exercises (chunk 9:
-- TASKS.md "Edit a week's exercises" / SPEC.md "Weeks and copying").
--
-- One function, replaced in place: `create or replace function v2_plan_week`,
-- copied verbatim from 031_planner_p1_plan_week.sql and changed in exactly
-- the two places chunk 9 needs. 031 is applied in production and is never
-- edited — this file is the forward-fix. No new table, no new column, no
-- change to any existing row, constraint or policy — **not destructive**.
--
-- check-migration: flags the CREATE OR REPLACE FUNCTION (not on the safe
-- list, same as 031/028's functions) and the closing `notify` (same reason
-- as 029/030/031 — it matches no safe-list pattern either). Expected: this
-- migration's only effect is swapping one function's body for another;
-- nothing calls v2_plan_week differently until the code in this chunk
-- deploys, and the scratch column-level before/after check below proves no
-- existing row changes.
--
-- Same signature, same `security invoker`/`set search_path`, same grant,
-- same closing notify as 031 — only the function body changes:
--
-- ─── Change 1 — the program-copy branch now excludes week-only/removed rows
-- (`v_source_kind = 'program'`: stable's every week, and week 1 of either
-- planning type, SPEC "the run's copy, always" / "week 1 from the run
-- copy"). Before this chunk, `week_only`/`removed_at` didn't exist as
-- *reachable* states (027 added the columns, but nothing before chunk 9 ever
-- set either one), so the old, unfiltered read of v2_program_exercises /
-- v2_program_sets was equivalent to a filtered one. Chunk 9 is what starts
-- setting them (a week-only slot from a swap/add; removed_at from a
-- run-copy removal), so a fresh "from program" week must now skip:
--   - v2_program_exercises rows with week_only = true (TASKS.md: "A week-only
--     slot created by a swap... hidden from the program tab" — and
--     symmetrically, out of any FRESH week's volume: a week-only slot is
--     this run's week-specific state, not part of "the program" a stable
--     week or week 1 copies from) or removed_at is not null (TASKS.md:
--     "removed from the run's program" — a stable week or week 1 must not
--     resurrect it);
--   - and, by extension, their v2_program_sets (a set whose head exercise is
--     excluded has nothing to copy either — the join below naturally drops
--     them by filtering the v2_program_exercises side of the join, same as
--     v2_copy_program's own join shape).
-- The week-copy branch (week-dependent, week > 1) is untouched by this rule
-- on purpose: it carries forward whatever the source week actually had,
-- week-only rows included — that is the whole point of a week-only slot
-- existing (TASKS.md: week-dependent add/swap "carries forward through
-- copying unless 'only this week' is ticked"). Only a FRESH read of the
-- program's own baseline state needs the exclusion.
--
-- ─── Change 2 — the week-copy branch now maps each copied SET's
-- program_exercise_id through the source week's own carry mapping, the same
-- way its EXERCISE rows already do (031's own header, "Exercise identity,
-- within this chunk's boundary", flagged this as chunk 9's to revisit: carry
-- forward used to carry a set's program_exercise_id through untranslated,
-- which was equivalent to mapping it only because carry_program_exercise_id
-- was always null before this chunk). The scenario this fixes: an
-- "only-this-week" swap in week N points that week's v2_week_plan_exercises
-- row at the week-only replacement slot (program_exercise_id = the
-- replacement) while recording the PRE-swap slot in carry_program_exercise_id
-- (what copying forward uses) — and "its planned sets move with it"
-- (TASKS.md's swap rule), so week N's OWN v2_week_plan_sets rows for that
-- exercise also carry program_exercise_id = the replacement, same as the
-- exercise row, by the time they're copied forward. Without this change,
-- copying week N forward used to carry those SETS' program_exercise_id
-- through unchanged (the replacement's week-only id) while the EXERCISE row
-- correctly reverted to the original slot (the carry mapping) — leaving the
-- new week with an exercise row for the ORIGINAL slot but sets pointing at a
-- program_exercise_id no v2_week_plan_exercises row in that week names,
-- breaking the "planned sets keep linking by (week_plan_id,
-- program_exercise_id)" invariant 027 establishes. Now: a scratch id→id map
-- is built from the source week's own v2_week_plan_exercises rows (key =
-- that row's CURRENT program_exercise_id, the same identity its own sets
-- point at; value = coalesce(carry_program_exercise_id, program_exercise_id),
-- exactly what the exercise-row copy above already carries forward), and
-- every copied set's program_exercise_id is looked up through it — falling
-- back to the set's own program_exercise_id on no match (defensive only: by
-- the unique-key invariant every set's program_exercise_id has a matching
-- v2_week_plan_exercises row in the same week, so the fallback is never
-- actually exercised on a well-formed week, the same posture 031's existing
-- stage-parent lookups already take with their own `(select ... )` subqueries).
-- A week with no swap at all (every row's carry_program_exercise_id is null)
-- maps every id to itself, so this is a no-op for every week before chunk 9
-- and for every ordinary (non-swapped) exercise after it — unchanged
-- behaviour, just no longer silently wrong for the one case that needed it.
-- The weight/RIR source rule (deload and empty skipped, DECISIONS 42 (b)) is
-- unchanged — this touches only which program_exercise_id a copied set
-- carries, never which week is chosen as a source or which weight/RIR value
-- it carries.
--
-- Not changed by this migration, on purpose: "only this week" never applies
-- to add/remove (DECISIONS 48 (a); SPEC line 212 names swap and reorder
-- only) — week-dependent adds and removes already carry forward (or don't)
-- purely by whether the row exists in the source week being copied, with no
-- carry_* involved; a stable run's week edits are one-offs already, because
-- its weeks always come from the 'program' branch above, which never reads
-- v2_week_plan_exercises/v2_week_plan_sets at all. Neither needs a schema or
-- function change here.
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
--   Re-create 031's body:
--   create or replace function v2_plan_week(p_mesocycle_id uuid, p_week_number integer)
--   returns integer language plpgsql security invoker set search_path = public
--   as $$ ... $$;  -- 031_planner_p1_plan_week.sql's own function body, verbatim.
-- Safe at any time: this function only ever INSERTs new rows it creates
-- itself; re-pointing it at 031's body leaves every row either version ever
-- wrote exactly as it is.

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
  v_planning_type        text;
  v_schedule             jsonb;
  v_week_start           text;
  v_workout_day_id       uuid;
  v_new_plan_id          uuid;
  v_planned_count        integer := 0;

  v_source_kind          text;   -- 'program' | 'week' | 'empty'
  v_wr_week_plan_id      uuid;   -- last planned USABLE (not deload, not empty) week's plan id, or null

  v_pe                   record;
  v_ps                   record;
  v_new_set_id           uuid;
  v_mapped_pe_id         uuid;
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
  select p.planning_type, p.schedule
    into v_planning_type, v_schedule
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

  -- Scratch id maps for this function, both session-scoped (ON COMMIT DROP),
  -- cleared at the start of each workout:
  --   tmp_v2_plan_week_set_map — stage -> head reattachment within ONE
  --     workout's copy (either branch below), as in 031.
  --   tmp_v2_plan_week_ex_map — chunk 9: the source week's own
  --     (current program_exercise_id) -> (carry-forward program_exercise_id)
  --     mapping, built once per workout from v2_week_plan_exercises, and
  --     consulted when copying that same week's SETS (see header "Change 2").
  create temp table if not exists tmp_v2_plan_week_set_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table if not exists tmp_v2_plan_week_ex_map
    (program_exercise_id uuid primary key, carry_program_exercise_id uuid not null) on commit drop;

  -- Every distinct workout this run's weekly schedule names. A sequence
  -- program's schedule is '{}' (see header), so this loop runs zero times
  -- for one — chunk 25's extension point, not a bug here.
  for v_workout_day_id in
    select distinct (v_schedule ->> key)::uuid
      from jsonb_object_keys(v_schedule) as key
     where v_schedule ->> key is not null
  loop
    delete from tmp_v2_plan_week_set_map;
    delete from tmp_v2_plan_week_ex_map;

    v_new_plan_id := null;
    insert into v2_week_plans (user_id, mesocycle_id, workout_day_id, week_number, is_deload)
    values (v_user_id, p_mesocycle_id, v_workout_day_id, p_week_number, false)
    on conflict (mesocycle_id, workout_day_id, week_number) do nothing
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
    select wp.id into v_wr_week_plan_id
      from v2_week_plans wp
     where wp.mesocycle_id = p_mesocycle_id and wp.workout_day_id = v_workout_day_id
       and wp.user_id = v_user_id and wp.week_number < p_week_number and wp.is_deload = false
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
      -- ── Week-to-week copy: exercises, honouring carry fields ──────────
      -- Chunk 9: also records, for every one of the source week's own
      -- exercise rows, (its CURRENT program_exercise_id) -> (what copying
      -- forward uses) — the exact same coalesce this loop already applies
      -- to build the new week's exercise rows, kept here as a lookup table
      -- so the sets loop below can apply the identical mapping to each
      -- set's program_exercise_id (header "Change 2").
      for v_pe in
        select program_exercise_id,
               coalesce(carry_program_exercise_id, program_exercise_id) as carry_program_exercise_id,
               coalesce(carry_position, position) as position
          from v2_week_plan_exercises
         where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
      loop
        insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
        values (v_user_id, v_new_plan_id, v_pe.carry_program_exercise_id, v_pe.position)
        on conflict (week_plan_id, program_exercise_id) do nothing;

        insert into tmp_v2_plan_week_ex_map (program_exercise_id, carry_program_exercise_id)
        values (v_pe.program_exercise_id, v_pe.carry_program_exercise_id)
        on conflict (program_exercise_id) do nothing;
      end loop;

      -- ── Sets: a direct old-id → new-id remap of the source week's own
      -- sets — identical in spirit to weekPlanService.ts's
      -- copySetsWithGrouping, which the manual copy actions use client
      -- side. Every column (including program_set_id, so the workout
      -- screen's later lookup of design fields keeps working, and
      -- target_weight/target_rir, which this branch therefore needs no
      -- separate mapping step for) is carried through verbatim except
      -- tags (never copied — not selected, not inserted), is_deload
      -- (a week_plans-level column, not touched here), and
      -- program_exercise_id, which chunk 9 now maps through
      -- tmp_v2_plan_week_ex_map (built just above from this SAME source
      -- week) instead of carrying through unmapped — falling back to the
      -- set's own program_exercise_id only on no match (defensive; see
      -- header "Change 2" for why that fallback is never actually hit on
      -- a well-formed week).
      for v_ps in
        select id, program_exercise_id, set_number, target_rir, is_dropset,
               parent_week_plan_set_id, stage_index, is_warmup, program_set_id,
               stage_kind, target_weight, rep_min, rep_max, is_amrap
          from v2_week_plan_sets
         where week_plan_id = v_wr_week_plan_id and user_id = v_user_id
         order by (parent_week_plan_set_id is not null), set_number, stage_index
      loop
        select coalesce(
                 (select carry_program_exercise_id from tmp_v2_plan_week_ex_map
                   where program_exercise_id = v_ps.program_exercise_id),
                 v_ps.program_exercise_id
               )
          into v_mapped_pe_id;

        insert into v2_week_plan_sets (
          week_plan_id, user_id, program_exercise_id, set_number, target_rir, is_dropset,
          parent_week_plan_set_id, stage_index, is_warmup, program_set_id, stage_kind,
          target_weight, rep_min, rep_max, is_amrap
        )
        values (
          v_new_plan_id, v_user_id, v_mapped_pe_id, v_ps.set_number, v_ps.target_rir,
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
