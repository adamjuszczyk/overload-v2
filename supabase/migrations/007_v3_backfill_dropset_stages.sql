-- Overload v3 — dropset stage backfill (migrate)
-- See TASKS.md §2.1. Three steps, meant to be run as separate statements/
-- selections in the Supabase SQL Editor — NOT as one "run whole file" click.
--
-- Why parent_set_id can't just be read: AUDIT M5 means it is NULL on every
-- row ever written. Grouping must be inferred from ordering: a run of
-- is_dropset = true rows belongs to the nearest preceding is_dropset = false
-- row within the same (session_id, exercise_id).

-- ============================================================================
-- STEP 1 — AUDIT (read-only). Run this first and read the output. Do not
-- proceed to Step 2 on a non-zero count without a decision.
-- ============================================================================

-- (a) Orphan drops: a dropset-flagged row with no preceding main set in its
--     exercise. The inference rule has no answer for these.
with ordered as (
  select id, session_id, exercise_id, is_dropset,
         count(*) filter (where not is_dropset) over (
           partition by session_id, exercise_id
           order by set_number, logged_at
           rows between unbounded preceding and current row
         ) as group_no
  from v2_set_logs
)
select count(*) as orphan_drop_count from ordered where is_dropset and group_no = 0;

-- (b) Ambiguous ordering: duplicate set_numbers within an exercise. AUDIT A3
--     notes there is no uniqueness constraint, and M3 describes plan-side
--     numbering collisions after deletions — so this is not hypothetical.
select session_id, exercise_id, set_number, count(*)
from v2_set_logs group by 1,2,3 having count(*) > 1;

-- (c) Scope check: how much data is actually affected.
select count(*) filter (where is_dropset) as drop_rows,
       count(distinct session_id) filter (where is_dropset) as sessions_touched
from v2_set_logs;

-- ============================================================================
-- STEP 2 — BACKFILL (destructive). DO NOT RUN until Step 1's output has been
-- reviewed by a human and a decision made on orphans/duplicates (TASKS.md
-- §5.5). NOT executed during the 2026-08-05 Phase 3.0 session — see
-- CONTEXT.md's "Active work" section before assuming this has run.
-- ============================================================================

-- Log side.
with ordered as (
  select id, session_id, exercise_id, set_number, logged_at,
         count(*) filter (where not is_dropset) over (
           partition by session_id, exercise_id
           order by set_number, logged_at
           rows between unbounded preceding and current row
         ) as group_no
  from v2_set_logs
),
grouped as (
  select o.id,
         first_value(o.id) over w as head_id,
         row_number()      over w - 1 as stage_index
  from ordered o
  where o.group_no > 0
  window w as (partition by o.session_id, o.exercise_id, o.group_no
               order by o.set_number, o.logged_at)
)
update v2_set_logs sl
   set parent_set_id = g.head_id,
       stage_index   = g.stage_index
  from grouped g
 where sl.id = g.id
   and g.stage_index > 0;   -- heads keep parent_set_id NULL, stage_index 0

-- Plan side. Identical shape, partitioned by week_plan_id + program_exercise_id,
-- writing parent_week_plan_set_id (TASKS.md §2.1, "Step 2 — backfill").
with ordered as (
  select id, week_plan_id, program_exercise_id, set_number,
         count(*) filter (where not is_dropset) over (
           partition by week_plan_id, program_exercise_id
           order by set_number
           rows between unbounded preceding and current row
         ) as group_no
  from v2_week_plan_sets
),
grouped as (
  select o.id,
         first_value(o.id) over w as head_id,
         row_number()      over w - 1 as stage_index
  from ordered o
  where o.group_no > 0
  window w as (partition by o.week_plan_id, o.program_exercise_id, o.group_no
               order by o.set_number)
)
update v2_week_plan_sets wps
   set parent_week_plan_set_id = g.head_id,
       stage_index             = g.stage_index
  from grouped g
 where wps.id = g.id
   and g.stage_index > 0;

-- ============================================================================
-- STEP 3 — VERIFY. Run after Step 2. (a) should be unchanged from Step 1 (the
-- backfill does not touch orphans). The other two confirm every stage row has
-- a head and no head has a parent.
-- ============================================================================

-- Re-run Step 1(a) here and compare to the pre-backfill count.

select count(*) from v2_set_logs where is_dropset and parent_set_id is null;          -- = orphan count from Step 1(a)
select count(*) from v2_set_logs where not is_dropset and parent_set_id is not null;  -- must be 0
