-- release-046-counts.sql
--
-- READ ONLY. The before and after reading of migration 046 (149's release data migration) on production, for ADAM'S rows
-- only: every table below is filtered to his user_id (12e79b69-9891-4f53-a7cf-650edd83659f), so nothing of his friend's
-- or of anyone else's is read. It is the reading TASKS-1.2.md "Release", step 3, asks for: taken immediately before
-- step 5's merge and again right after its deploy (DECISIONS.md "For the release", 046). One SELECT: it writes nothing, makes
-- no temp table, and can be run any number of times, at any time. It reads columns that exist since migration 027, so it
-- runs the same on production's schema (000-041) and on 042-047.
--
-- How to run (the same file before and after):
--   * Supabase dashboard -> SQL editor on the production project -> paste the whole file -> Run. The result is one table.
--   * Or Windows cmd, from the repo root on an up-to-date checkout (like scripts\live-counts.sql):
--       npx --yes supabase@2.119.0 db query --linked -f scripts\release-046-counts.sql -o json > counts-046-before.json
--     and after step 5's deploy the same line ending > counts-046-after.json. Keep both files.
--
-- What it returns: one table with the columns  section | item | rows | week_only | removed | fingerprint.
--   scope        the user_id every table below is filtered to.
--   counts       one row per table 046 mentions, his rows only (rows): v2_mesocycles, v2_programs, v2_workout_days,
--                v2_program_exercises, v2_week_plans, v2_week_plan_sets, v2_week_plan_exercises.
--   fingerprint  v2_program_exercises, first all his rows, then the ones outside his active week-dependent runs: the row
--                count (rows), how many have week_only = true (week_only), how many have removed_at not null (removed), and
--                an md5. The md5 is over one text line per row, ordered by id and joined by newlines, each line
--                id|week_only|removed_at|position with removed_at in UTC to the microsecond (empty when null); no rows is
--                md5('') = d41d8cd98f00b204e9800998ecf8427e.
--   run          the same four figures for each of his ACTIVE WEEK-DEPENDENT RUNS, the only runs 046 can touch (a run with status
--                'active' whose run copy has planning type 'week_dependent', weekday or sequence), one row each, named
--                run name / schedule type / the first 8 characters of the run's id. Stable runs, finished runs and saved
--                programs have no row here; their program-exercise rows are the "outside" fingerprint row.
--   taken        when it was run (UTC). The one row that differs between two readings for no reason.
--
-- What before and after should show (046 changes only v2_program_exercises' week_only, removed_at and position, and only on
-- rows its rule names; its own header has the rule):
--   * counts: every table the same. 046 inserts and deletes nothing.
--   * fingerprint "outside his active week-dependent runs": rows, week_only, removed and md5 all the same.
--   * run rows: rows the same. week_only goes down by the hidden rows (a 1.1 swap's or add's) that the run's last planned week
--     lists; removed goes down by the removed rows that week still lists and up by the live rows it doesn't list, so the two
--     can cancel (one row brought back, another taken out: removed stays where it was); the md5 changes whenever any row of
--     that run changed its week_only, removed_at or position, which is how a cancelled count or a reorder shows.
--   * fingerprint "all his rows": the md5 differs exactly when some run row's md5 differs.
--   * A user whose runs already match their last planned week: nothing changes, every row but `taken` is identical before and
--     after.
--   Anything else (a count that moved, a changed md5 outside the runs, a run's rows that moved) is not 046: stop and ask.
--
-- Not in it: RC44's query (the sequence-run case, TASKS-1.2.md), a separate reading, and the tables 046 doesn't mention
-- (scripts/live-counts.sql counts six of these seven, not v2_week_plan_exercises, and the rest of his tables).

select q.section, q.item, q.rows, q.week_only, q.removed, q.fingerprint
  from (
    with
      his_runs as (
        select m.id as run_id,
               coalesce(m.name, 'unnamed') as run_name,
               coalesce(p.schedule_type, 'no schedule type') as schedule_type,
               p.id as program_id
          from public.v2_mesocycles m
          join public.v2_programs p
            on p.id = m.program_id
           and p.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
           and p.kind = 'run'
           and p.planning_type = 'week_dependent'
         where m.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
           and m.status = 'active'
      ),
      his_rows as (
        select e.id,
               e.week_only,
               e.removed_at,
               r.run_id,
               e.id::text
                 || '|' || coalesce(e.week_only::text, '')
                 || '|' || coalesce(to_char(e.removed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')
                 || '|' || coalesce(e.position::text, '') as line
          from public.v2_program_exercises e
          left join public.v2_workout_days wd
            on wd.id = e.workout_day_id
           and wd.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
          left join his_runs r
            on r.program_id = wd.program_id
         where e.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
      )
    select 0 as ord, 'scope' as section, 'user_id 12e79b69-9891-4f53-a7cf-650edd83659f' as item,
           null::bigint as rows, null::bigint as week_only, null::bigint as removed, null::text as fingerprint
    union all
    select 10, 'counts', 'v2_mesocycles',
           (select count(*) from public.v2_mesocycles t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 11, 'counts', 'v2_programs',
           (select count(*) from public.v2_programs t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 12, 'counts', 'v2_workout_days',
           (select count(*) from public.v2_workout_days t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 13, 'counts', 'v2_program_exercises',
           (select count(*) from public.v2_program_exercises t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 14, 'counts', 'v2_week_plans',
           (select count(*) from public.v2_week_plans t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 15, 'counts', 'v2_week_plan_sets',
           (select count(*) from public.v2_week_plan_sets t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 16, 'counts', 'v2_week_plan_exercises',
           (select count(*) from public.v2_week_plan_exercises t where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'), null, null, null
    union all
    select 20, 'fingerprint', 'v2_program_exercises: all his rows (id, week_only, removed_at, position)',
           count(*), count(*) filter (where x.week_only), count(*) filter (where x.removed_at is not null),
           md5(coalesce(string_agg(x.line, chr(10) order by x.id), ''))
      from his_rows x
    union all
    select 21, 'fingerprint', 'v2_program_exercises: rows outside his active week-dependent runs',
           count(*), count(*) filter (where x.week_only), count(*) filter (where x.removed_at is not null),
           md5(coalesce(string_agg(x.line, chr(10) order by x.id), ''))
      from his_rows x
     where x.run_id is null
    union all
    select 30, 'run', r.run_name || ' / ' || r.schedule_type || ' / ' || left(r.run_id::text, 8),
           count(x.id), count(x.id) filter (where x.week_only), count(x.id) filter (where x.removed_at is not null),
           md5(coalesce(string_agg(x.line, chr(10) order by x.id), ''))
      from his_runs r
      left join his_rows x on x.run_id = r.run_id
     group by r.run_id, r.run_name, r.schedule_type
    union all
    select 90, 'taken', 'taken_at ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), null, null, null, null
  ) q
 order by q.ord, q.item;
