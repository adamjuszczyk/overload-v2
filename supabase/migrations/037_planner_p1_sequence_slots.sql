-- Overload Planner Extension, phase 1 — chunk 25: sequence runs (SPEC.md
-- "Scheduling → Sequence" / TASKS.md "Chunk 25 — Sequence runs"; scratch
-- catalog R16).
--
-- Purpose: a program can run as an ordered CYCLE of workouts and rest days,
-- not tied to a weekday, with the same workout allowed to appear more than
-- once in one cycle (SPEC, G8: "A, B, A, rest"). v2_week_plans' own unique
-- key currently identifies a planned session by (mesocycle_id,
-- workout_day_id, week_number) alone — one row per workout per cycle. That
-- can't represent a workout twice in the same cycle (two occurrences would
-- collide on insert). This migration:
--   1. replaces that key with (mesocycle_id, workout_day_id, week_number,
--      sequence_position) NULLS NOT DISTINCT — R16 — so a weekday row
--      (sequence_position always null) still collides with any other null
--      row for the same (meso, workout, week), exactly as today, while a
--      sequence cycle gets one row per SLOT (sequence_position = that
--      slot's position in v2_program_sequence_items), so the same workout
--      at two different slots gets two distinct, independently-trackable
--      planned sessions.
--   2. switches v2_plan_week's conflict target to the new key and teaches
--      it a second way to discover which workout(s) to plan for a given
--      (mesocycle, week_number): a sequence program's schedule jsonb is
--      always '{}' (v2_copy_program/v2_start_run never populate it for
--      one — see 031/032's own loop comment, "chunk 25's extension point,
--      not a bug here"), so the existing weekday loop
--      (jsonb_object_keys(v_schedule)) already yields zero rows for one;
--      this migration adds the sequence-items branch alongside it rather
--      than replacing it, so a weekday run plans exactly as it always has.
--
-- sequence_position and deload_restore were both added to v2_week_plans,
-- nullable, no constraint, back in migration 027 (chunk 1) — this file adds
-- no column. v2_program_sequence_items (id, user_id, program_id, position,
-- workout_day_id) also already exists since 027, with its own unique index
-- on (program_id, position); this migration doesn't touch that table at
-- all — it is the SOURCE v2_plan_week now reads from for a sequence
-- program, unchanged in shape.
--
-- ─── Not destructive (TASKS.md) ─────────────────────────────────────────────
-- Every existing v2_week_plans row has sequence_position = null (no
-- sequence program has ever been plannable before this chunk's app code
-- ships) and stays unique under the new key for the same reason it was
-- unique under the old one: two rows can only collide on the new key if
-- they agree on all FOUR columns, and since every existing row already
-- agreed on the old THREE and carries the same (null) fourth, "unique under
-- the old key" and "unique under the new key" are the same fact for every
-- row that exists today. No row is updated, moved or deleted by this file.
--
-- ─── Statement order (load-bearing) ────────────────────────────────────────
--   1. A `do $$ … $$` block finds v2_week_plans' current unique constraint
--      on exactly (mesocycle_id, workout_day_id, week_number) BY CATALOG
--      LOOKUP (pg_constraint/pg_attribute), never a guessed name, and drops
--      it by whatever name it actually finds — raising instead of guessing
--      if it finds zero or more than one such constraint. (Scratch, this
--      database: the live name is the auto-generated
--      `v2_week_plans_mesocycle_id_workout_day_id_week_number_key`, exactly
--      as TASKS.md's own scratch note says — confirmed by this same lookup
--      query, never hard-coded into the DROP itself.)
--   2. ADD CONSTRAINT the new one, UNIQUE NULLS NOT DISTINCT on the four
--      columns (Postgres 15+; this project's target is 17.6).
--   3. CREATE OR REPLACE v2_plan_week, copied from 032's body (the current
--      live one — nothing between 032 and 036 touches this function) and
--      changed in exactly three places (search `-- [037]` below):
--        a. the function now also selects the program's own id and
--           schedule_type, not just planning_type/schedule;
--        b. the per-workout loop's SOURCE becomes a union of the existing
--           weekday derivation (now explicitly gated on
--           schedule_type = 'weekday', though it was already a no-op for a
--           sequence program before this chunk) and a new sequence-items
--           derivation (schedule_type = 'sequence': every
--           v2_program_sequence_items row with a non-null workout_day_id,
--           i.e. every slot that actually names a workout — a rest slot has
--           nothing to plan, the same way an unassigned weekday has nothing
--           to plan today), each row carrying its own sequence_position
--           (null for every weekday row, that slot's own `position` column
--           for a sequence row) — loop body UNCHANGED, written once;
--        c. both places the loop body reads or writes v2_week_plans by
--           (mesocycle_id, workout_day_id, week_number) now also carry
--           `sequence_position IS NOT DISTINCT FROM v_sequence_position`
--           (the INSERT … ON CONFLICT target, and the weight/RIR +
--           week-dependent-volume source search) — IS NOT DISTINCT FROM
--           because v_sequence_position is null for a weekday row and
--           plain `=` never matches NULL to NULL, which would otherwise
--           match every other weekday row's own history regardless of
--           workout (it wouldn't in practice, since workout_day_id already
--           narrows it, but the predicate must still read correctly on its
--           own terms — see R16 scratch, "weekday planning is unchanged").
--      Nothing else in the function changes: the 'program'/'week'/'empty'
--      source-kind decision, the program-copy and week-copy branches, the
--      stage-parent remap, and the final weight/RIR UPDATE are 032's own
--      text, untouched.
--   4. Same GRANT EXECUTE / NOTIFY PGRST as every prior v2_plan_week
--      migration (031, 032) — the signature doesn't change.
--
-- check-migration: flags this file (exit 1; run and confirmed below) — the
-- `do $$ … $$` block (not on the safe list), the ADD CONSTRAINT (a
-- constraint on an existing table is never on the safe list, even an
-- additive one — R16's own safety argument above is a judgement call the
-- generic classifier correctly doesn't make for us), and the CREATE OR
-- REPLACE FUNCTION + its GRANT EXECUTE + closing NOTIFY (none of the three
-- match any safe-list pattern — same reason 031/032/034/035 were each
-- flagged). Expected, not a sign of anything missed.
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
-- Only possible while no cycle has a repeated workout (two sequence_position
-- values sharing one (mesocycle_id, workout_day_id, week_number)) — check
-- first:
--   select mesocycle_id, workout_day_id, week_number, count(*)
--     from v2_week_plans
--    where sequence_position is not null
--    group by mesocycle_id, workout_day_id, week_number
--   having count(*) > 1;
-- A non-zero result means restoring the old 3-column key would itself
-- violate uniqueness — stop and ask before rolling back if this ever
-- returns a row. Otherwise:
--   alter table v2_week_plans drop constraint v2_week_plans_meso_wday_week_seqpos_uk;
--   alter table v2_week_plans
--     add constraint v2_week_plans_mesocycle_id_workout_day_id_week_number_key
--     unique (mesocycle_id, workout_day_id, week_number);
--   -- then re-create 032's own v2_plan_week body verbatim (see
--   -- supabase/migrations/032_planner_p1_plan_week_edits.sql), restoring
--   -- the 3-column ON CONFLICT target and the weekday-only loop.
--
-- ─── Pre-check — Adam runs this himself first, before applying ─────────────
-- Confirms the live name this migration's own do$$ block is about to find
-- and drop, and that dropping it is safe (every existing row already
-- carries sequence_position = null, so nothing could already violate the
-- new key):
--   select con.conname
--     from pg_constraint con
--    where con.conrelid = 'public.v2_week_plans'::regclass
--      and con.contype = 'u'
--      and (select array_agg(a.attname::text order by a.attname)
--             from unnest(con.conkey) as k(attnum)
--             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
--          ) = array['mesocycle_id','week_number','workout_day_id']::text[];
--   -- expect exactly one row, name v2_week_plans_mesocycle_id_workout_day_id_week_number_key
--   select count(*) from v2_week_plans where sequence_position is not null;
--   -- expect 0

-- ═══ 1. Drop the old unique constraint, by catalog lookup only ═════════════

do $$
declare
  v_old_name   text;
  v_match_count integer;
begin
  select count(*)
    into v_match_count
    from pg_constraint con
   where con.conrelid = 'public.v2_week_plans'::regclass
     and con.contype = 'u'
     and (
       select array_agg(a.attname::text order by a.attname)
         from unnest(con.conkey) as k(attnum)
         join pg_attribute a
           on a.attrelid = con.conrelid and a.attnum = k.attnum
     ) = array['mesocycle_id', 'week_number', 'workout_day_id']::text[];

  if v_match_count = 0 then
    raise exception
      '037: no unique constraint found on v2_week_plans(mesocycle_id, workout_day_id, week_number) — expected exactly one. Refusing to guess; stop and investigate.';
  elsif v_match_count > 1 then
    raise exception
      '037: % unique constraints found on v2_week_plans(mesocycle_id, workout_day_id, week_number) — expected exactly one. Refusing to guess which to drop.',
      v_match_count;
  end if;

  select con.conname
    into strict v_old_name
    from pg_constraint con
   where con.conrelid = 'public.v2_week_plans'::regclass
     and con.contype = 'u'
     and (
       select array_agg(a.attname::text order by a.attname)
         from unnest(con.conkey) as k(attnum)
         join pg_attribute a
           on a.attrelid = con.conrelid and a.attnum = k.attnum
     ) = array['mesocycle_id', 'week_number', 'workout_day_id']::text[];

  execute format('alter table v2_week_plans drop constraint %I', v_old_name);
  raise notice '037: dropped v2_week_plans'' old unique constraint %', v_old_name;
end $$;

-- ═══ 2. Add the new unique key — R16 ═══════════════════════════════════════

alter table v2_week_plans
  add constraint v2_week_plans_meso_wday_week_seqpos_uk
  unique nulls not distinct (mesocycle_id, workout_day_id, week_number, sequence_position);

-- ═══ 3. v2_plan_week — conflict target + sequence-items source ════════════
-- Copied from 032_planner_p1_plan_week_edits.sql (the current live body —
-- nothing between it and 036 touches this function). Changes marked
-- `-- [037]`; everything else is 032's own text, verbatim.

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
    delete from tmp_v2_plan_week_ex_map;

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
