-- live-counts.sql
--
-- Row counts on every Overload table that has a user_id column, each filtered
-- to Adam's user_id (12e79b69-9891-4f53-a7cf-650edd83659f). Run before and after the migration switch;
-- the two results must be identical (MIGRATION-SWITCH.md, V4). Read-only.
--
-- Windows cmd:
--   npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > counts-before.json
--
-- 27 tables: the 6 Overload v1 tables and the 21 v2_ tables that have a user_id.
-- Not counted, because they have no user_id column and so can't be filtered:
--   v2_exercise_libraries (shared curated catalog, readable by everyone - migration 019)
--   v2_exercise_library_items (shared curated catalog, readable by everyone - migration 019)
-- Not counted: Northstar / Atlas tables (ns_*, atlas_*) - standing rule, never read Northstar data.
-- Views (v2_history_session_summary, v2_exercise_set_history, v2_session_type_history) read these tables.

select table_name, rows from (
  select 'exercises' as table_name, count(*) as rows from public.exercises where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'program_exercises' as table_name, count(*) as rows from public.program_exercises where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'programs' as table_name, count(*) as rows from public.programs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'sessions' as table_name, count(*) as rows from public.sessions where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'set_logs' as table_name, count(*) as rows from public.set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_curation_runs' as table_name, count(*) as rows from public.v2_coach_curation_runs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_memory_entries' as table_name, count(*) as rows from public.v2_coach_memory_entries where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_meso_analyses' as table_name, count(*) as rows from public.v2_coach_meso_analyses where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_meso_tag_priorities' as table_name, count(*) as rows from public.v2_coach_meso_tag_priorities where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_notes' as table_name, count(*) as rows from public.v2_coach_notes where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_phase_entries' as table_name, count(*) as rows from public.v2_coach_phase_entries where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_qa_exchanges' as table_name, count(*) as rows from public.v2_coach_qa_exchanges where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_session_analyses' as table_name, count(*) as rows from public.v2_coach_session_analyses where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_week_analyses' as table_name, count(*) as rows from public.v2_coach_week_analyses where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_coach_weight_entries' as table_name, count(*) as rows from public.v2_coach_weight_entries where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_exercise_reassignments' as table_name, count(*) as rows from public.v2_exercise_reassignments where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_mesocycles' as table_name, count(*) as rows from public.v2_mesocycles where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_program_exercises' as table_name, count(*) as rows from public.v2_program_exercises where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_programs' as table_name, count(*) as rows from public.v2_programs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_session_exercise_swaps' as table_name, count(*) as rows from public.v2_session_exercise_swaps where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_sessions' as table_name, count(*) as rows from public.v2_sessions where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_set_logs' as table_name, count(*) as rows from public.v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_user_settings' as table_name, count(*) as rows from public.v2_user_settings where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_week_plan_sets' as table_name, count(*) as rows from public.v2_week_plan_sets where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_week_plans' as table_name, count(*) as rows from public.v2_week_plans where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'v2_workout_days' as table_name, count(*) as rows from public.v2_workout_days where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
  union all
  select 'workout_days' as table_name, count(*) as rows from public.workout_days where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
) counts
order by table_name;
