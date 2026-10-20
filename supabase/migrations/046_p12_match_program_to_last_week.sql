-- Overload Planner Extension, 1.2 (TASKS-1.2.md chunk 53) — migration 046:
-- 149's release data migration. It CHANGES EXISTING ROWS, so it is not add-only; read all of this before it runs
-- anywhere that holds real data.
--
-- ─── What it does (Adam, 2026-10-16, DECISIONS 149 (c); numbered 046 by Adam, 2026-10-20, DECISIONS 196) ───────────
-- "One data migration at the release makes each active week-dependent run's program match its last planned week
-- (exercises and order), so nothing the user sees changes."
--
-- Why it is needed. Until 1.1 a week-dependent run's weeks were the plan: the week view could SWAP, ADD, REMOVE and
-- REORDER an exercise in one week, and the next week was copied from that week's own rows, so the change carried
-- forward (041's 'week' branch copies the source week verbatim). The run's program (the run copy) never heard about
-- it: a swap or an add made a hidden `week_only` row, a remove deleted the week's rows and left the run copy's row
-- live, a reorder changed the week's positions only. 1.2's `v2_plan_week` (045, DECISIONS 143) takes a week's exercise
-- list and order from the run copy and its sets from the source week, so on such a run the first copy after the release
-- would bring a removed exercise back with no sets, drop a swapped-in one, and put the order back. This file makes the
-- run copy say what the last planned week says, so 045's copy gives that week's exercises in that week's order.
--
-- The rule, for every ACTIVE week-dependent run (a `v2_mesocycles` row with status 'active' whose run copy,
-- `v2_programs.kind = 'run'`, has planning_type 'week_dependent'; stable runs, sequence-or-weekday alike, completed runs
-- and saved programs are not touched), for each of its workouts:
--   * Its LAST PLANNED WEEK is the week 045 would copy from: the workout's latest planned week that is not a deload
--     session and has at least one set (DECISIONS 42, the same search `v2_plan_week` makes). On a sequence run a workout
--     can sit in several slots: the latest cycle decides and, inside it, the later slot (149's option (c): one slot's
--     week decides). A workout with no such week is left as it is.
--   * Each exercise that week lists, of this workout's own program-exercise rows, becomes part of the program: not
--     week-only (a 1.1 swap's or add's hidden row is promoted), not removed (a row removed in the program but still
--     planned is brought back), and at the position the week gives it (the week view's order).
--   * Each live exercise (not week-only, not removed) the week does not list is removed from the program, softly
--     (`removed_at = now()`, the way the run copy has always removed a row, so every planned week keeps its rows): a
--     1.1 REMOVE, or the replaced side of a 1.1 swap.
--   * Nothing else changes: not a week plan, a week's exercise or set, a program set, a session, a log, another
--     workout, another user. A week-only row the last week does not list stays hidden; a removed row it does not list
--     stays removed.
-- The only columns it writes are v2_program_exercises.week_only, .removed_at and .position, and only on rows that
-- differ, so it is idempotent: run again it changes 0 rows.
--
-- The result, proven on a replay of 1.1-shaped worlds (scripts/rehearse-046.mjs): after this file, 045's copy of the
-- next week from that last planned week lists the same exercises, with the same positions, and the same sets, as
-- 041's copy of it (the 1.1 behaviour), so a week planned after the release is the week the user would have got.
--
-- ─── When it may run ──────────────────────────────────────────────────────────────────────────────────────────────────
-- ONLY on data last changed by 1.1 or earlier: it makes the program match the last planned week, so on a run that a 1.2
-- CHANGE THE PROGRAM save has changed it would undo that save for a workout whose last planned session is done or
-- started (a save never touches such a session). The release applies it before the 1.2 app is live (TASKS-1.2 Release),
-- when no run has been saved; staging's runs were checked read-only before it was written and already match.
-- It is NOT applied to production during the build, and it is blocking at the release: the manual backup first, then
-- Adam's decision, with before/after counts of every table it mentions (scoped to his user_id) and a fingerprint, as
-- scripts/rehearse-046.mjs prints them (DECISIONS "For the release"). `check-migration` flags it.
--
-- Production runs pg-safeupdate: every UPDATE below has a WHERE clause. The file runs in one transaction, as the role
-- that applies migrations (RLS does not apply); it reads and writes only through the tables named here.
--
-- Rollback: the manual backup taken before it (TASKS-1.2 Release, step 3). There is no inverse migration: the three
-- columns it writes are not stored anywhere else, which is why it is a blocking decision.

do $$
declare
  v_runs      integer;
  v_workouts  integer;
  v_promoted  integer;
  v_revived   integer;
  v_moved     integer;
  v_removed   integer;
  v_updated   integer;
begin
  -- The workouts of every active week-dependent run copy, each with its last planned week. (`if not exists` and the
  -- clear, the pattern of 041's temp tables: the file also runs twice in one transaction in its replay proof.)
  create temp table if not exists tmp_046_last_week (
    workout_day_id uuid primary key,
    week_plan_id   uuid not null
  ) on commit drop;
  delete from tmp_046_last_week where true;
  insert into tmp_046_last_week (workout_day_id, week_plan_id)
  select distinct on (wp.workout_day_id) wp.workout_day_id, wp.id
    from v2_week_plans wp
    join v2_mesocycles m on m.id = wp.mesocycle_id and m.status = 'active'
    join v2_programs p on p.id = m.program_id and p.kind = 'run' and p.planning_type = 'week_dependent'
    join v2_workout_days wd on wd.id = wp.workout_day_id and wd.program_id = p.id
   where wp.is_deload = false
     and exists (select 1 from v2_week_plan_sets s where s.week_plan_id = wp.id)
   order by wp.workout_day_id, wp.week_number desc, wp.sequence_position desc nulls last, wp.id;

  -- What each of those weeks lists, of its own workout's program-exercise rows (a row of another workout is not this
  -- workout's to match), and where.
  create temp table if not exists tmp_046_listed (
    workout_day_id      uuid    not null,
    program_exercise_id uuid    not null,
    position            integer not null,
    primary key (workout_day_id, program_exercise_id)
  ) on commit drop;
  delete from tmp_046_listed where true;
  insert into tmp_046_listed (workout_day_id, program_exercise_id, position)
  select lw.workout_day_id, x.program_exercise_id, x.position
    from tmp_046_last_week lw
    join v2_week_plan_exercises x on x.week_plan_id = lw.week_plan_id
    join v2_program_exercises pe on pe.id = x.program_exercise_id and pe.workout_day_id = lw.workout_day_id;

  select count(distinct m.id) into v_runs
    from v2_mesocycles m
    join v2_programs p on p.id = m.program_id and p.kind = 'run' and p.planning_type = 'week_dependent'
   where m.status = 'active';
  select count(*) into v_workouts from tmp_046_last_week;

  -- What will change, counted before it does (a row can be in more than one count).
  select count(*) filter (where pe.week_only),
         count(*) filter (where pe.removed_at is not null),
         count(*) filter (where pe.position is distinct from l.position)
    into v_promoted, v_revived, v_moved
    from v2_program_exercises pe
    join tmp_046_listed l on l.program_exercise_id = pe.id
   where pe.week_only or pe.removed_at is not null or pe.position is distinct from l.position;

  -- 1. An exercise the last planned week lists is part of the program, in the week's place.
  update v2_program_exercises pe
     set week_only = false,
         removed_at = null,
         position = l.position
    from tmp_046_listed l
   where pe.id = l.program_exercise_id
     and (pe.week_only or pe.removed_at is not null or pe.position is distinct from l.position);
  get diagnostics v_updated = row_count;

  -- 2. A live exercise of those workouts that the week does not list was taken out of the week: it leaves the program.
  update v2_program_exercises pe
     set removed_at = now()
   where pe.week_only = false
     and pe.removed_at is null
     and pe.workout_day_id in (select lw.workout_day_id from tmp_046_last_week lw)
     and not exists (select 1 from tmp_046_listed l where l.program_exercise_id = pe.id);
  get diagnostics v_removed = row_count;

  -- The counts say what it did (the second run's must all be 0); "written" is the first update's own row count, "taken out"
  -- the second's: a row written without a change would show there.
  raise notice '046: % active week-dependent run(s), % workout(s) with a last planned week: % made part of the program, % brought back, % moved (% row(s) written), % taken out',
    v_runs, v_workouts, v_promoted, v_revived, v_moved, v_updated, v_removed;
end
$$;
