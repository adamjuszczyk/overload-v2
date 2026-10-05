-- Overload Planner Extension, phase 1 — weeks plan themselves, from the
-- right source (chunk 8: TASKS.md "Weeks plan themselves, from the right
-- source" / SPEC.md "Weeks and copying").
--
-- One new function. No new table, no new column, no change to any existing
-- row, constraint or policy — **not destructive**. Rollback: drop function
-- v2_plan_week(uuid, integer);
--
-- check-migration: flags the CREATE FUNCTION (not on the safe list, same as
-- 028's v2_start_run/v2_copy_program) and the closing `notify` (same reason
-- as 029/030 — it matches no safe-list pattern either). Expected: this
-- migration's only effect is adding a function nothing calls until the
-- code in this chunk deploys.
--
-- ─── v2_plan_week(p_mesocycle_id, p_week_number) returns integer ───────────
-- SECURITY INVOKER (RLS applies; precedent: v2_start_run/v2_copy_program),
-- an explicit `user_id = v_user_id` filter on every read in addition to RLS
-- (defence in depth, same posture as 028's v2_copy_program — RLS alone
-- already makes a cross-user call see nothing, since v2_mesocycles/
-- v2_programs/v2_program_exercises/v2_program_sets/v2_week_plans/
-- v2_week_plan_exercises/v2_week_plan_sets all carry the standard
-- "for all using/with check (user_id = auth.uid())" policy). A call against
-- another user's mesocycle id finds no row and raises — this is what the
-- chunk's RLS scratch check (R10's companion) exercises.
--
-- **Atomic and idempotent (TASKS.md; scratch R10):** the whole call runs in
-- the caller's own transaction (an ordinary plpgsql function body — no
-- explicit BEGIN, same as v2_start_run), so a failure partway rolls back
-- everything this call did; the NEXT call (idempotent) retries cleanly.
-- Per workout, the only thing that decides "did I just create this
-- session" is `insert into v2_week_plans (...) on conflict
-- (mesocycle_id, workout_day_id, week_number) do nothing returning id` —
-- the unique key from migration 001, unchanged by this chunk. Two
-- concurrent callers planning the same week: Postgres serialises the two
-- conflicting inserts (the second waits on the first's commit/rollback,
-- standard read-committed behaviour), so exactly one of them gets a real
-- `id` back and copies into it; the other sees `on conflict do nothing`
-- skip with no returned id and moves on to the next workout without
-- touching this one. No advisory lock is used here (unlike v2_start_run,
-- whose race has no natural unique key to lean on) — the unique key alone
-- is sufficient and is literally what TASKS.md's scope line names as the
-- mechanism.
--
-- **Every distinct workout of the run's weekly schedule**
-- (v2_programs.schedule, a dow → workout_day_id jsonb map) gets its own
-- v2_week_plans row for this week, created if missing. A sequence
-- program's schedule is always '{}' (v2_copy_program's own comment: "a
-- sequence program (empty schedule) leaves v_new_schedule at '{}'"), so
-- this loop naturally plans nothing for one — chunk 25 is what extends
-- this function to sequence slots (TASKS.md "Would not catch"), not this
-- migration. A week "exists once planned" the moment its rows exist
-- (TASKS.md's own words), regardless of whether there was anything to fill
-- them with — so the row is always inserted first, and what (if anything)
-- gets copied into it is decided after.
--
-- **Sources, per SPEC "Weeks and copying" — kept identical to
-- src/features/plan/weekSources.ts's resolveWeekSources (chunk 8's
-- scratch report proves both agree on one fixture):**
--   - Volume: `stable` → the run's own copy (v2_program_exercises +
--     v2_program_sets of this workout, read fresh at plan time — so a
--     stable program edited between two weeks being planned gives the
--     later week the NEW sets, never a stale snapshot), always, for every
--     week including week 1. `week_dependent` week 1 → the same run copy
--     (SPEC: "week 1 from the run copy"). `week_dependent` week > 1 → the
--     workout's last planned NON-DELOAD occurrence (its own
--     v2_week_plan_exercises, honouring carry_program_exercise_id/
--     carry_position, and its own v2_week_plan_sets, copied by a direct
--     old-id → new-id remap — the same approach weekPlanService.ts's
--     copySetsWithGrouping/copyExercisesForward already use client-side
--     for the manual copy actions), found by walking week_number back from
--     p_week_number − 1, skipping any week whose session for THIS workout
--     was deload (SPEC: "Deload sessions are never a copy source. A week
--     that's partly deload still copies its normal sessions; its deload
--     sessions copy from the last normal occurrence.") — or empty, when
--     v2_user_settings.week_start = 'empty' (SPEC: the setting governs
--     whether an unplanned week-dependent week fills automatically at
--     all), or when no non-deload occurrence exists yet (nothing to copy,
--     so empty by elimination — SPEC names exactly two sources for a
--     week-dependent week beyond week 1, "the last planned [non-deload]
--     week" or empty; with neither available the only one left is empty).
--     "Empty" means exactly that: no v2_week_plan_exercises, no
--     v2_week_plan_sets — the row exists (so the week is "planned") but
--     carries nothing, which is what lets the empty-state "Copy last week"
--     (PlanPage.tsx) recognise it and offer the manual action.
--   - Weight and RIR targets: the last planned NON-DELOAD week, for BOTH
--     planning types (SPEC: "the last planned week, for both types") — the
--     exact same backward, deload-skipping search as the volume search
--     above (computed once per workout, reused for both). For a
--     week-to-week volume copy this falls out for free: a week's own
--     v2_week_plan_sets rows already carry their own target_weight/
--     target_rir, copied verbatim along with everything else. For a
--     `stable`/week-1 volume copy (fresh rows from v2_program_sets, which
--     has no weight/RIR columns at all — "week plan only, never in the
--     program") there is nothing to carry by row identity, so this
--     function MAPS the newly-created run-copy sets onto the last planned
--     week's own sets and copies target_weight/target_rir across — see
--     "Stable weight/RIR mapping" below. Week 1 has no earlier planned
--     week, so this search finds nothing and every set's weight/RIR stays
--     null, for both planning types alike.
--   - Tags: never copied, either way (SPEC: "Tags are never copied") — no
--     code here ever reads or writes v2_week_plan_sets.tags.
--   - is_deload: never copied (SPEC/TASKS.md "Found in the code", fact 1) —
--     every v2_week_plans row this function inserts is created with
--     is_deload = false, regardless of its source's own flag.
--
-- **Stable weight/RIR mapping (the rule, written down once, here):** a
-- freshly copied-from-program head is matched to the last planned week's
-- own head by (program_exercise_id, that head's 1-based ordinal among the
-- CURRENT program's own heads for that exercise, ordered by
-- v2_program_sets.position) against (that same program_exercise_id, the
-- source week's own head's 1-based ordinal among ITS heads for that
-- exercise, ordered by v2_week_plan_sets.set_number) — i.e. "set position
-- among heads", counted independently on each side and matched by
-- position, not by any stored id (the two sides are different tables with
-- unrelated ids). A stage is matched through its own (already-matched)
-- head plus stage_index. Conservative by construction: an ordinal with no
-- counterpart on the other side (the program gained or lost a set, or a
-- whole exercise, since the source week was planned) simply has no row in
-- the join and so is left with target_weight/target_rir both null — never
-- guessed, never misattributed to a different set. This is the one piece
-- of this function with no TS equivalent: weekSources.ts only decides
-- WHICH occurrence/kind of source to use (see the header comment there),
-- never how to map sets within one — no client caller ever performs a
-- program → fresh-set copy (the manual COPY WEEK/COPY THIS WORKOUT actions
-- only ever copy week-to-week, where a straight id remap already carries
-- weight/RIR for free — see weekPlanService.ts's copyOneWorkoutFromHistory).
--
-- **set_number convention, defined here:** v2_program_sets has no
-- "set_number" of its own, only `position` (> 0, a head's own ordinal
-- among that exercise's sets; a stage shares its head's position — 027's
-- own column comment). Nothing before this chunk has ever copied a program
-- set into a week plan, so this migration is what defines the mapping:
-- a copied set's v2_week_plan_sets.set_number := that set's own
-- v2_program_sets.position, for both heads and stages alike (a stage's
-- `position` already equals its head's, by 027's invariant, so no
-- separate "remember the current head" bookkeeping is needed — each row's
-- own `position` is read directly, regardless of loop order).
--
-- **Exercise identity, within this chunk's boundary:** program_exercise_id
-- is carried through untranslated on every copied SET (both branches),
-- exactly like weekPlanService.ts's existing copySetsWithGrouping already
-- does. This only matters once a week's own v2_week_plan_exercises row can
-- carry a *different* identity than the set rows that belong to it — i.e.
-- once carry_program_exercise_id is ever non-null — and nothing before
-- chunk 9 ever writes a non-null carry_program_exercise_id (027's own
-- comment on that column). So for every row this function or its callers
-- will ever see before chunk 9, `coalesce(carry_program_exercise_id,
-- program_exercise_id) = program_exercise_id` identically, and carrying a
-- set's program_exercise_id through unmapped is exactly equivalent to
-- mapping it. Chunk 9 ("Edit a week's exercises") is where this needs
-- revisiting, not this one.
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
--   drop function v2_plan_week(uuid, integer);
-- Safe at any time: this function only ever INSERTs new rows (week plans,
-- their exercises, their sets) it creates itself; dropping it leaves every
-- row it already wrote exactly as it is — nothing here is a stored
-- procedure other code depends on existing.

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
  v_wr_week_plan_id      uuid;   -- last planned non-deload week's plan id for this workout, or null

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

  -- Scratch id map for stage → head reattachment within ONE workout's copy
  -- (either branch below). Session-scoped, ON COMMIT DROP, cleared at the
  -- start of each workout — same pattern as v2_copy_program's own temp
  -- tables (028), one level simpler (a single map; this function never
  -- needs the workout/block/exercise maps v2_copy_program needs, since it
  -- never copies a whole program, only one workout's own sets at a time).
  create temp table if not exists tmp_v2_plan_week_set_map
    (old_id uuid primary key, new_id uuid not null) on commit drop;

  -- Every distinct workout this run's weekly schedule names. A sequence
  -- program's schedule is '{}' (see header), so this loop runs zero times
  -- for one — chunk 25's extension point, not a bug here.
  for v_workout_day_id in
    select distinct (v_schedule ->> key)::uuid
      from jsonb_object_keys(v_schedule) as key
     where v_schedule ->> key is not null
  loop
    delete from tmp_v2_plan_week_set_map;

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
    -- source"). One search, reused for both purposes.
    select id into v_wr_week_plan_id
      from v2_week_plans
     where mesocycle_id = p_mesocycle_id and workout_day_id = v_workout_day_id
       and user_id = v_user_id and week_number < p_week_number and is_deload = false
     order by week_number desc
     limit 1;

    if p_week_number = 1 or v_planning_type = 'stable' then
      v_source_kind := 'program';
    elsif v_week_start = 'empty' then
      v_source_kind := 'empty';
    elsif v_wr_week_plan_id is not null then
      v_source_kind := 'week';
    else
      v_source_kind := 'empty'; -- week-dependent, copy requested, but nothing non-deload to copy
    end if;

    if v_source_kind = 'program' then
      -- ── Exercises: the run copy's CURRENT list, in program order ──────
      for v_pe in
        select id, position from v2_program_exercises
         where workout_day_id = v_workout_day_id and user_id = v_user_id
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
      -- below when a weight/RIR source exists.
      for v_ps in
        select ps.id, ps.program_exercise_id, ps.position, ps.is_warmup, ps.stage_kind,
               ps.parent_program_set_id, ps.stage_index, ps.rep_min, ps.rep_max, ps.is_amrap
          from v2_program_sets ps
          join v2_program_exercises pe on pe.id = ps.program_exercise_id
         where pe.workout_day_id = v_workout_day_id and ps.user_id = v_user_id
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

      -- ── Stable weight/RIR mapping (see header for the rule) ───────────
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
      for v_pe in
        select coalesce(carry_program_exercise_id, program_exercise_id) as program_exercise_id,
               coalesce(carry_position, position) as position
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

-- Make PostgREST pick up the new function.
notify pgrst, 'reload schema';
