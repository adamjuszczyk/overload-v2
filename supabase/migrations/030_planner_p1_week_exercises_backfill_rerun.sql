-- Overload Planner Extension, phase 1 — re-run of the v2_week_plan_exercises
-- backfill, after chunk 7's code deployed (chunk 7 follow-up to 029;
-- TASKS.md "Each planned session owns its exercise list").
--
-- Why this exists: 029 backfilled v2_week_plan_exercises for every week plan
-- that existed when 029 went live. From chunk 7's code on, every path that
-- creates a v2_week_plans row also writes its exercise rows (ADD SET, COPY
-- WEEK, COPY THIS WORKOUT — weekPlanService.ts); before that code deployed,
-- nothing did. Here a migration's production deploy is its own step, always
-- before the code that needs it (CONTEXT.md "Migration flow"), so there is
-- a real gap between 029 going live and chunk 7's code going live. A week
-- plan the OLD client created inside that gap has no exercise rows, and
-- chunk 7's screens (GymSession, PlanPage, SessionPreview, …) now read the
-- week's own list — such a plan would render empty. 029's own header
-- already calls for the fix: "Adam re-runs the backfill … right after the
-- code deploys, and records 'rows inserted' (expected 0)." Migrations here
-- are never applied by hand — "Never apply a migration by hand: the next
-- deploy would run it again" (CONTEXT.md) — so that re-run has to be a
-- migration file of its own, merged right after chunk 7's code: this file.
--
-- No-op when nothing was missed: the DO block below is 029's own backfill,
-- unchanged (same candidate query — every v2_week_plans row crossed with
-- its workout's v2_program_exercises — same
-- INSERT … ON CONFLICT (week_plan_id, program_exercise_id) DO NOTHING
-- RETURNING id). The unique index from 027 is what makes that idempotent:
-- a candidate whose row already exists — because 029 already covered it, or
-- because chunk 7's own code wrote it when the plan was created — is
-- skipped, not duplicated. Only a week plan created by the old client
-- inside the gap produces real inserts. Running this file's own DO block a
-- second time (the same statement, not the whole file) again inserts 0 —
-- verified in this chunk's scratch run (see its report).
--
-- Rollback: this file creates no new object, so it has none of its own. It
-- inserts into the existing v2_week_plan_exercises (027) and records each
-- row it actually inserts in the existing
-- v2_week_plan_exercises_backfill_manifest (029 — not recreated here), the
-- same table and the same shape 029's own re-run writes. So 029's documented
-- by-hand rollback —
--   delete from v2_week_plan_exercises
--     where id in (select week_plan_exercise_id from v2_week_plan_exercises_backfill_manifest);
--   drop table v2_week_plan_exercises_backfill_manifest;
-- — deletes this file's rows too, along with 029's: both sit in the one
-- manifest table, and a backfilled row is a backfilled row regardless of
-- which run of the backfill wrote it.
--
-- check-migration: flags the DO block below ("not on the safe list" —
-- plpgsql bodies are opaque to its statement classifier, same as 029 and
-- 028's transition block) and the closing `notify` statement (same reason —
-- it matches no safe-list pattern either). Expected, not a sign of a
-- data-changing migration: every statement here either inserts a row
-- already covered by 029's own rollback above, or only reloads PostgREST's
-- schema cache.

do $$
declare
  v_candidate   record;
  v_new_id      uuid;
  v_inserted    integer := 0;
begin
  for v_candidate in
    select wp.user_id as user_id,
           wp.id as week_plan_id,
           pe.id as program_exercise_id,
           pe.position as position
      from v2_week_plans wp
      join v2_program_exercises pe on pe.workout_day_id = wp.workout_day_id
     order by wp.id, pe.position
  loop
    v_new_id := null;

    insert into v2_week_plan_exercises (user_id, week_plan_id, program_exercise_id, position)
    values (v_candidate.user_id, v_candidate.week_plan_id, v_candidate.program_exercise_id, v_candidate.position)
    on conflict (week_plan_id, program_exercise_id) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      insert into v2_week_plan_exercises_backfill_manifest (user_id, week_plan_exercise_id)
      values (v_candidate.user_id, v_new_id);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  raise notice 'v2_week_plan_exercises backfill re-run: % row(s) inserted', v_inserted;
end;
$$;

-- Make PostgREST pick up any schema change (none expected from this file;
-- kept for parity with every other migration that writes through this
-- table, and harmless if there is nothing new to pick up).
notify pgrst, 'reload schema';
