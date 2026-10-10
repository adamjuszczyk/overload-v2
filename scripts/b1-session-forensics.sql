-- b1-session-forensics.sql  (paste into the Supabase SQL Editor and run)
--
-- READ-ONLY: one SELECT statement, one result table, writes nothing.
-- Every table is filtered to Adam's user_id (12e79b69-9891-4f53-a7cf-650edd83659f)
-- because the SQL Editor runs as postgres and bypasses RLS: the filter is the
-- only thing keeping other users' rows out. Only v2_ tables are read.
--
-- Why it exists (B1, 2026-10-10): Friday 2026-10-09's pull workout shows in
-- History as SKIPPED with all its numbers, and Saturday morning the app opened
-- on a second, empty, already-started session of the same workout. Friday's
-- connection at the gym was bad, so this looks for offline-queue fingerprints
-- as well as REDO SESSION. See DECISIONS.md 39 for how to read it.
--
-- One row per session dated on or after 2026-10-01, oldest first. All times
-- are UTC (the editor shows timestamptz in UTC, the UK is UTC+1 until
-- 2026-10-25). Columns:
--   status / date / moved_to_date   what History and Today read
--   started_at / completed_at       client clock (the phone) when set
--   created_at                      SERVER clock when the row was first inserted
--   server_lag_s                    created_at - started_at, seconds. About 0 for
--                                   a start made online, large = the start sat in
--                                   the offline queue and was inserted at sync time
--   logs, logs_skipped, logs_with_numbers, first_log, last_log
--                                   this session's own set_logs (logged_at = phone clock)
--   completed_minus_last_log_s      completed_at - last_log. 0 = the finish saw every
--                                   set, negative = sets arrived after the finish
--   dup_set_slots                   exercise/set slots that hold 2+ rows
--   same_workout_same_date          sessions sharing this workout and date (2+ = a duplicate)
--   s_since_prev_start / s_since_prev_completed
--                                   seconds from the previous same-workout session's
--                                   start / finish to this row's start (a REDO or a
--                                   retried start makes these small)
--   row_txid / logs_txid_min / logs_txid_max
--                                   Postgres transaction id of the LAST write to the
--                                   session row / to its set logs. Higher = later.
--                                   Only the ORDER is meaningful (they are not times)
--   reading                         plain-words flags computed from the columns above,
--                                   empty = nothing odd about that row
select
  g.date,
  g.moved_to_date,
  g.status,
  g.workout,
  g.id,
  g.week_plan_id,
  g.started_at,
  g.completed_at,
  g.created_at,
  round(extract(epoch from (g.created_at - g.started_at)))::int as server_lag_s,
  g.logs,
  g.logs_skipped,
  g.logs_with_numbers,
  g.first_log,
  g.last_log,
  round(extract(epoch from (g.completed_at - g.last_log)))::int as completed_minus_last_log_s,
  g.dup_set_slots,
  count(*) over (partition by g.workout_day_id, g.date) as same_workout_same_date,
  round(extract(epoch from (g.started_at - lag(g.started_at) over w)))::int as s_since_prev_start,
  round(extract(epoch from (g.started_at - lag(g.completed_at) over w)))::int as s_since_prev_completed,
  g.row_txid,
  g.logs_txid_min,
  g.logs_txid_max,
  array_to_string(array_remove(array[
    case when g.status = 'skipped' and g.logs_with_numbers > 0
         then 'SKIPPED_BUT_HAS_NUMBERS' end,
    case when g.status = 'skipped' and g.logs_with_numbers > 0 and g.logs_skipped > 0
         then 'some of its sets are skip rows (a finish judged from only the skipped ones?)' end,
    case when g.status = 'in_progress' and g.completed_at is not null
         then 'IN_PROGRESS_BUT_HAS_COMPLETED_AT (an old start written over a finish?)' end,
    case when g.status = 'in_progress' and g.started_at < now() - interval '6 hours'
         then 'IN_PROGRESS_FOR_HOURS' end,
    case when g.status = 'completed' and g.logs = 0
         then 'COMPLETED_BUT_EMPTY' end,
    case when g.status in ('completed', 'skipped') and g.completed_at is null and g.logs > 0
         then 'FINISHED_WITHOUT_COMPLETED_AT (finish ran before its sets were on the server?)' end,
    case when g.last_log > g.completed_at + interval '2 seconds'
         then 'SETS_NEWER_THAN_COMPLETED_AT (sets arrived after the finish)' end,
    case when g.created_at - g.started_at > interval '2 minutes'
         then 'INSERTED_LONG_AFTER_START (queued start replayed later)' end,
    case when count(*) over (partition by g.workout_day_id, g.date) > 1
         then 'SAME_WORKOUT_TWICE_ON_THIS_DATE' end,
    case when g.dup_set_slots > 0
         then 'DUPLICATE_SET_SLOTS' end
  ], null), ' | ') as reading
from (
  select
    s.id,
    s.workout_day_id,
    s.date,
    s.moved_to_date,
    s.status,
    wd.name as workout,
    s.week_plan_id,
    s.started_at,
    s.completed_at,
    s.created_at,
    count(sl.id) as logs,
    count(sl.id) filter (where sl.is_skipped) as logs_skipped,
    count(sl.id) filter (where not sl.is_skipped and sl.weight is not null) as logs_with_numbers,
    min(sl.logged_at) as first_log,
    max(sl.logged_at) as last_log,
    coalesce(max(d.dup_slots), 0) as dup_set_slots,
    s.xmin::text::bigint as row_txid,
    min(sl.xmin::text::bigint) as logs_txid_min,
    max(sl.xmin::text::bigint) as logs_txid_max
  from public.v2_sessions s
  left join public.v2_set_logs sl
    on sl.session_id = s.id
   and sl.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  left join public.v2_workout_days wd
    on wd.id = s.workout_day_id
   and wd.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  left join (
    select x.session_id, count(*) as dup_slots
    from (
      select session_id, exercise_id, set_number, parent_set_id, stage_index, is_warmup
      from public.v2_set_logs
      where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
      group by session_id, exercise_id, set_number, parent_set_id, stage_index, is_warmup
      having count(*) > 1
    ) x
    group by x.session_id
  ) d on d.session_id = s.id
  where s.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
    and s.date >= '2026-10-01'
  group by s.id, wd.name
) g
window w as (partition by g.workout_day_id order by g.started_at, g.created_at)
order by g.date, g.started_at, g.created_at
