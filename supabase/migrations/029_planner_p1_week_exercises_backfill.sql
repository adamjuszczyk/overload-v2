-- Overload Planner Extension, phase 1 — backfill v2_week_plan_exercises
-- (chunk 7: TASKS.md "Each planned session owns its exercise list").
--
-- Inserts into the new table only (027 created v2_week_plan_exercises; this
-- file never alters an existing column or constraint). Existing rows in
-- every other table are unchanged. For every existing v2_week_plans row,
-- writes its exercise list = that workout's program exercises, in program
-- order (position) — the exact shape createWeekPlan / copyOnePlanForward
-- (weekPlanService.ts, this chunk's code) write for a week plan created
-- from here on, so a row backfilled here and a row created after deploy end
-- up in the identical shape: user_id from the week plan, program_exercise_id,
-- position, carry_program_exercise_id/carry_position left at their column
-- default (null) — "copying forward uses program_exercise_id/position
-- verbatim" (027's own column comments), which is exactly true of every row
-- here since nothing before chunk 9 ever sets carry_*.
--
-- 028's run transition (already applied on this branch, build/chunk-6) never
-- changes a v2_programs/v2_workout_days/v2_program_exercises id in place —
-- its header spells this out (steps 2-5): the ORIGINAL program keeps its own
-- id and flips kind to 'run'; the id-changing work only ever lands on a
-- freshly generated CLONE, which becomes the new kind='saved' template and
-- is never pointed at by any existing v2_week_plans/v2_sessions/v2_set_logs
-- row. So for every meso 028 touched, v2_program_exercises.workout_day_id
-- still resolves, for each existing v2_week_plans.workout_day_id, to that
-- SAME run copy's own exercises — the ones every existing session/plan
-- screen already renders today — never the clone's. Confirmed by reading
-- 028's transition end to end (no UPDATE there ever rewrites
-- v2_workout_days.id, v2_program_exercises.id or v2_week_plans.workout_day_id)
-- and by scratch run R5 (chunk7-brief.md): the backfilled count matches
-- Σ(program exercises of each plan's workout) exactly, for an active run in
-- 028's post-transition shape.
--
-- check-migration: flags this file's one DO block below ("not on the safe
-- list" — plpgsql bodies are opaque to its statement classifier, same as
-- 028's own transition block) — expected, not a sign of a data-changing
-- migration. Every statement outside that block only creates new,
-- currently-empty objects (the manifest table, its policy, its index),
-- which the safe list already allows.
--
-- Idempotent: the unique index on (week_plan_id, program_exercise_id) (027)
-- means a second run finds every row already present and inserts 0 — needed
-- because the old client can still create a v2_week_plans row between this
-- migration's apply and the code's deploy (CONTEXT.md's merge rule: the
-- migration merges and deploys first, the code after). Adam re-runs the
-- backfill (the "═══ The backfill ═══" DO block below, copied into the SQL
-- editor on its own — verified standalone-idempotent in this chunk's
-- scratch run, see its report) right after the code deploys, and records
-- "rows inserted" (expected 0). NOT "re-run this whole file": the manifest
-- table's plain `create table` (no IF NOT EXISTS, deliberately — a second
-- one existing would itself be a bug worth seeing) makes the file as a
-- whole a one-time apply, same as every other migration; only the backfill
-- statement itself is the idempotent part meant to be re-run by hand.
--
-- Manifest (v2_week_plan_exercises_backfill_manifest) records the id of
-- every row THIS RUN of the DO block actually inserted (via
-- `returning id into v_new_id`, which is null when ON CONFLICT DO NOTHING
-- skips a candidate) — not a re-query of "every row that matches the
-- backfill's shape", which would also catch real rows the new app code
-- writes later (ADD SET / COPY WEEK / COPY THIS WORKOUT, or the workout
-- editor's add/reorder sync — all added by this same chunk's code) the next
-- time this file is re-run, and so is the only safe way to let a rollback
-- delete exactly this migration's own rows on every run, including Adam's
-- post-deploy re-run. Standard RLS; not read by the app, so it stays out of
-- verify-rls.mjs's TABLES (CONTEXT.md's rule there is "a table the APP reads
-- or writes").
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
--   delete from v2_week_plan_exercises
--     where id in (select week_plan_exercise_id from v2_week_plan_exercises_backfill_manifest);
--   drop table v2_week_plan_exercises_backfill_manifest;
-- Only removes rows THIS migration (across every run of it) inserted — a row
-- written by the app since (the new code's own writes, or a plan created by
-- the old client in the apply/deploy gap and then backfilled by Adam's
-- re-run — that re-run's own inserts ARE this migration's rows, and so are
-- correctly in the manifest and correctly rolled back too) is handled
-- correctly either way: app-written rows are never in the manifest and so
-- are never touched; re-run-backfilled rows are real manifest entries from
-- this same migration and are rolled back along with the first run's.

-- ═══ v2_week_plan_exercises_backfill_manifest ═══════════════════════════════

create table v2_week_plan_exercises_backfill_manifest (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  week_plan_exercise_id   uuid not null references v2_week_plan_exercises(id) on delete cascade,
  created_at              timestamptz not null default now()
);

alter table v2_week_plan_exercises_backfill_manifest enable row level security;
create policy "Users access own rows" on v2_week_plan_exercises_backfill_manifest
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index v2_week_plan_exercises_backfill_manifest_wpe_idx
  on v2_week_plan_exercises_backfill_manifest(week_plan_exercise_id);

-- ═══ The backfill ════════════════════════════════════════════════════════════
-- One row per (week plan, program exercise) candidate — every existing
-- v2_week_plans row crossed with its own workout day's v2_program_exercises,
-- in that workout's position order. ON CONFLICT DO NOTHING is what makes a
-- second run safe (idempotent); RETURNING id INTO + the null check is what
-- makes the manifest exact on every run, including a second one (see the
-- file header above).

do $$
declare
  v_candidate   record;
  v_new_id      uuid;
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
    end if;
  end loop;
end;
$$;

-- Make PostgREST pick up the new table.
notify pgrst, 'reload schema';
