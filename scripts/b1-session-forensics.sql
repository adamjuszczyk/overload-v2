-- b1-session-forensics.sql
--
-- READ-ONLY. One SELECT, every table filtered to Adam's user_id
-- (12e79b69-9891-4f53-a7cf-650edd83659f). Writes nothing.
--
-- Why it exists (B1, 2026-10-10): Friday 2026-10-09's pull workout shows in
-- History as SKIPPED with all its numbers, and Saturday morning the app
-- opened on a second, empty, already-started session of the same workout.
-- From the dev environment the data can't be read (anon key + RLS: a
-- filtered select returns [], which looks the same as "no rows"), so this
-- is for Adam to run. The cause is not settled until its output is read;
-- see DECISIONS.md 39 for what each result means.
--
-- Windows cmd (same shape as live-counts.sql):
--   npx --yes supabase@2.119.0 db query --linked -f scripts\b1-session-forensics.sql -o json > b1.json
--
-- One row per session dated on or after 2026-10-01 (the week of the incident
-- plus the week before), oldest first. Columns that matter:
--   status / date / moved_to_date   what History and Today read
--   created_at / started_at / completed_at
--                                   when each row was made / started / finished
--   logs, logs_skipped, logs_with_numbers, first_log, last_log
--                                   this session's own set_logs
--   skipped_with_numbers            TRUE = status 'skipped' but at least one
--                                   non-skipped set is logged (the corruption)
--   same_workout_same_date          sessions sharing this workout and date
--                                   (2+ = a duplicate)
--   gap_since_prev_completed        for a row, seconds between the previous
--                                   same-workout session's completed_at and this
--                                   row's created_at (a REDO makes this small,
--                                   seconds to minutes)
select
  s.id,
  s.date,
  s.moved_to_date,
  s.status,
  wd.name as workout,
  s.week_plan_id,
  s.created_at,
  s.started_at,
  s.completed_at,
  count(sl.id) as logs,
  count(sl.id) filter (where sl.is_skipped) as logs_skipped,
  count(sl.id) filter (where not sl.is_skipped and sl.weight is not null) as logs_with_numbers,
  min(sl.logged_at) as first_log,
  max(sl.logged_at) as last_log,
  (s.status = 'skipped' and count(sl.id) filter (where not sl.is_skipped) > 0) as skipped_with_numbers,
  count(*) over (partition by s.workout_day_id, s.date) as same_workout_same_date,
  extract(epoch from (
    s.created_at - lag(s.completed_at) over (partition by s.workout_day_id order by s.created_at)
  ))::int as gap_since_prev_completed
from public.v2_sessions s
left join public.v2_set_logs sl
  on sl.session_id = s.id
 and sl.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
left join public.v2_workout_days wd
  on wd.id = s.workout_day_id
 and wd.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
where s.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  and s.date >= '2026-10-01'
group by s.id, wd.name
order by s.date, s.created_at;
