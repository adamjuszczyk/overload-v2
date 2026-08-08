-- Overload v3 — History views (TASKS.md §2.6, Phase 3.4 item 19)
--
-- Numbering note: this was originally planned as 008_v3_history_views.sql,
-- but 008 was pulled forward during Phase 3.3 to ship the reference-panel
-- index a phase early (see 008_v3_reference_panel_index.sql's own header).
-- TASKS.md §2.3/§2.6/§2.8/§3/§4 were renumbered the same session so the plan
-- and this migrations/ folder agree: history views is 009, the contract
-- migration (FK CASCADE) is 010.
--
-- Index note: TASKS.md §2.6 originally had this file also create
-- v2_sessions_user_day_date_idx. That index now lives in
-- 008_v3_reference_panel_index.sql instead (created ahead of schedule so
-- Phase 3.3's session-first query wasn't unindexed for a full phase) and is
-- confirmed live via pg_indexes as of that migration's application. TASKS.md
-- §2.6's text is explicit that it is deliberately NOT repeated here — so its
-- absence from this file is intentional, not an oversight.
--
-- security_invoker requires Postgres 15+ (older versions run the view as its
-- owner and silently bypass RLS for every user). Confirmed live before
-- writing this migration: this project runs Postgres 17.6.1.141.
-- The service layer (historyService.ts) keeps an explicit
-- .eq('user_id', userId) filter as defence-in-depth alongside
-- security_invoker, per §2.6's own risk section and the same reasoning as
-- AUDIT S1 for the exercises table.

-- ── Replaces the set-log join in fetchHistorySessions ───────────────────────
create or replace view v2_history_session_summary
with (security_invoker = true) as
select s.id, s.user_id, s.date, s.status, s.note,
       s.started_at, s.completed_at,
       s.workout_day_id, wd.name as workout_day_name,
       s.mesocycle_id,   m.name  as mesocycle_name,
       -- stage-exclusion rule (§2.1): drop stages are not independent sets.
       -- Without this a 3-stage dropset reports as 3 sets instead of 1.
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null
       ) as set_count,
       coalesce(
         array_agg(distinct e.muscle_group)
           filter (where not sl.is_skipped and e.muscle_group is not null),
         '{}'
       ) as muscle_groups
  from v2_sessions s
  left join v2_workout_days wd on wd.id = s.workout_day_id
  left join v2_mesocycles   m  on m.id  = s.mesocycle_id
  left join v2_set_logs     sl on sl.session_id = s.id
  left join exercises       e  on e.id  = sl.exercise_id
 group by s.id, wd.name, m.name;

-- ── SPEC §7: "Exercise, all time" — chart + per-set table ────────────────────
create or replace view v2_exercise_set_history
with (security_invoker = true) as
select sl.id, sl.user_id, sl.exercise_id, sl.session_id,
       s.date, s.mesocycle_id, m.name as mesocycle_name,
       wp.week_number, coalesce(wp.is_deload, false) as is_deload,
       sl.set_number, sl.stage_index, sl.parent_set_id,
       sl.weight, sl.reps, sl.rir, sl.rest_seconds, sl.set_seconds,
       sl.is_warmup, sl.is_skipped
  from v2_set_logs sl
  join v2_sessions   s  on s.id  = sl.session_id and s.status = 'completed'
  left join v2_mesocycles m on m.id = s.mesocycle_id
  left join v2_week_plans wp on wp.id = s.week_plan_id;

-- ── SPEC §7: "Session type, all time" — chart + per-occurrence table ─────────
create or replace view v2_session_type_history
with (security_invoker = true) as
select s.id as session_id, s.user_id, s.workout_day_id, s.date,
       s.mesocycle_id, wp.week_number, coalesce(wp.is_deload, false) as is_deload,
       extract(epoch from (s.completed_at - s.started_at))::int as duration_seconds,
       -- Volume is the deliberate exception to the stage-exclusion rule (§2.1):
       -- a drop stage is real work performed, so it counts toward volume.
       sum(sl.weight * sl.reps)
         filter (where not sl.is_skipped and not sl.is_warmup) as total_volume,
       -- avg RIR and set_count exclude stages. A stage is taken near failure,
       -- so including them makes avg RIR a function of how many dropsets were
       -- programmed rather than how hard the working sets were.
       avg(sl.rir) filter (
         where not sl.is_skipped and sl.rir is not null and sl.parent_set_id is null
       ) as avg_rir,
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null
       ) as set_count
  from v2_sessions s
  left join v2_week_plans wp on wp.id = s.week_plan_id
  left join v2_set_logs   sl on sl.session_id = s.id
 where s.status = 'completed'
 group by s.id, wp.week_number, wp.is_deload;

grant select on v2_history_session_summary,
                v2_exercise_set_history,
                v2_session_type_history
  to authenticated;

-- PostgREST caches the schema; without this the new views 404 from the
-- client until the cache reloads on its own (same class of surprise as the
-- pre-migration auto_finish_minutes 400 — see CONTEXT.md's 2026-07 notes).
notify pgrst, 'reload schema';
