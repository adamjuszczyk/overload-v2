-- Overload Planner Extension, phase 1 — warmup sets (chunk 15: TASKS.md
-- "Chunk 15 — Warmup sets" / SPEC.md "Warmup sets" — "Never counted in
-- volume, set counts, or 'last time' matching").
--
-- Flagged migration under DECISIONS D29 (CONTEXT.md "Flagged migrations the
-- reviewer may merge"): changes no existing row — only relaxes a constraint
-- (so the only new rows it lets through are ones the OLD constraint
-- rejected) and replaces two views. Live (L7, TASKS.md "scratch R11, R12;
-- live L7"): the set-log check is named v2_set_logs_check, as in 001 —
-- confirmed again here by replay (pg_get_constraintdef on the replayed
-- schema through 034: `CHECK (((is_skipped = true) OR ((weight IS NOT
-- NULL) AND (reps IS NOT NULL))))`, byte-equivalent to 001's own text,
-- parenthesised by Postgres) — and 0 warmup logs / 0 warmup planned sets
-- exist, so relaxing the check changes no current row and the rollback
-- below stays available until the first numberless warmup is logged.
--
-- ─── Statement order (load-bearing) ────────────────────────────────────────
--   1. v2_set_logs_check — drop, then add back under the SAME name with the
--      relaxed condition, both in this one file (Supabase applies a
--      migration file inside one transaction — replay-migrations.sh's own
--      --single-transaction, matching how Supabase itself deploys a file —
--      so no explicit BEGIN/COMMIT is needed for "one transaction" here).
--   2. v2_history_session_summary and v2_session_type_history — each
--      redefined with `and not sl.is_warmup` added to its set_count filter,
--      nothing else changed. Bodies below are 009's / 011's own text
--      (the last `create or replace` for each — grepped across every
--      migration: only 009 and 011 ever mention either view name) —
--      confirmed identical to the LIVE replayed definition via
--      `pg_get_viewdef('<view>'::regclass, true)` on a replay through 034,
--      not retyped from memory or assumed from the file. v2_history_
--      session_summary's own set_count was last (and first) defined in 009
--      and has never been touched since; v2_session_type_history's was
--      redefined once since, in 011 (the skipped-head stage fix to
--      total_volume, which this migration does not touch). security_invoker
--      = true and `grant select ... to authenticated` are carried through
--      unchanged on both (confirmed live: pg_class.reloptions reads
--      {security_invoker=true} for both before this file runs).
--   3. notify pgrst, 'reload schema' — same reload 009/011 already document
--      needing.
--
-- check-migration: flags this file (exit 1) — the DROP CONSTRAINT (only ADD
-- is on the safe list) and both CREATE OR REPLACE VIEW statements (a view
-- redefinition is never on the safe list either, same as 011's own
-- expectation). Expected, not a sign of anything missed: DECISIONS D29 is
-- exactly the flagged-migration path this merges under, once
-- migration-replay, check-embeds-local.sh and the reviewer's scratch-copy
-- check (every existing table's row count and column-level fingerprint
-- unchanged) all pass — this file adds no table, column, row or index, and
-- the two rewritten views return identical output for every existing row
-- (proved on scratch, scratch R11/R12 below): the only behaviour that can
-- differ is a WARMUP row, and none exists yet (L7).
--
-- ─── Rollback (by hand — this file does not run it) ────────────────────────
-- Only possible while no numberless warmup has been logged — check first:
--   select count(*) from v2_set_logs
--    where is_warmup and (weight is null or reps is null);
-- A non-zero count means a numberless warmup already exists under the
-- relaxed check and restoring 001's constraint would fail (or, worse,
-- silently pass if such a row happens not to violate it); stop and ask
-- before rolling back if this is ever non-zero.
--   1. alter table v2_set_logs drop constraint v2_set_logs_check;
--      alter table v2_set_logs add constraint v2_set_logs_check
--        check (is_skipped = true or (weight is not null and reps is not null));
--   2. Re-run 009_v3_history_views.sql's own
--      `create or replace view v2_history_session_summary ...` statement
--      verbatim (that file is never edited — migrations are forward-only —
--      so its text in this repo is still exactly what was live before this
--      migration; don't retype it by hand).
--   3. Re-run 011_v3_fix_skipped_head_stage_volume.sql's own
--      `create or replace view v2_session_type_history ...` statement
--      verbatim, same reasoning.
--   4. notify pgrst, 'reload schema';
--
-- No other existing row changes anywhere in the schema — checked column-level,
-- every table, on scratch (scratch R11/R12, this chunk's own report).

-- ═══ 1. Relax v2_set_logs_check ═════════════════════════════════════════

alter table v2_set_logs drop constraint v2_set_logs_check;

alter table v2_set_logs add constraint v2_set_logs_check
  check (is_skipped or is_warmup or (weight is not null and reps is not null));

-- ═══ 2. v2_history_session_summary — set_count excludes warmups ═══════════
-- Only change from 009's own body: `and not sl.is_warmup` added to the
-- set_count filter. Every other expression, column, join and GROUP BY is
-- 009's text unchanged.

create or replace view v2_history_session_summary
with (security_invoker = true) as
select s.id, s.user_id, s.date, s.status, s.note,
       s.started_at, s.completed_at,
       s.workout_day_id, wd.name as workout_day_name,
       s.mesocycle_id,   m.name  as mesocycle_name,
       -- stage-exclusion rule (§2.1): drop stages are not independent sets.
       -- Without this a 3-stage dropset reports as 3 sets instead of 1.
       -- Chunk 15 (SPEC "Warmup sets"): a warmup is never counted in set
       -- counts either — `and not sl.is_warmup` added, nothing else here
       -- changed.
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null and not sl.is_warmup
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

-- ═══ 3. v2_session_type_history — set_count excludes warmups ══════════════
-- Only change from 011's own body (which itself only touched total_volume,
-- already excluding is_warmup since 009): `and not sl.is_warmup` added to
-- the set_count filter. total_volume's existing warmup exclusion, avg_rir
-- and every join/column/WHERE/GROUP BY stay exactly as 011 left them.

create or replace view v2_session_type_history
with (security_invoker = true) as
select s.id as session_id, s.user_id, s.workout_day_id, s.date,
       s.mesocycle_id, wp.week_number, coalesce(wp.is_deload, false) as is_deload,
       extract(epoch from (s.completed_at - s.started_at))::int as duration_seconds,
       -- Volume is the deliberate exception to the stage-exclusion rule (§2.1):
       -- a drop stage is real work performed, so it counts toward volume —
       -- unless its own head was skipped, in which case the whole group
       -- (head + stages) represents nothing performed, same rule
       -- buildLoggedSlots (positionMatch.ts) already applies client-side.
       -- Warmups are the one thing volume itself already excludes (SPEC
       -- "Warmup sets": "never counted in volume") — unchanged by this file.
       sum(sl.weight * sl.reps)
         filter (
           where not sl.is_skipped and not sl.is_warmup
             and not coalesce(sl_parent.is_skipped, false)
         ) as total_volume,
       -- avg RIR and set_count exclude stages. A stage is taken near failure,
       -- so including them makes avg RIR a function of how many dropsets were
       -- programmed rather than how hard the working sets were.
       avg(sl.rir) filter (
         where not sl.is_skipped and sl.rir is not null and sl.parent_set_id is null
       ) as avg_rir,
       -- Chunk 15 (SPEC "Warmup sets"): set_count excludes warmups too —
       -- `and not sl.is_warmup` added, nothing else in this file changed.
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null and not sl.is_warmup
       ) as set_count
  from v2_sessions s
  left join v2_week_plans wp on wp.id = s.week_plan_id
  left join v2_set_logs   sl on sl.session_id = s.id
  left join v2_set_logs   sl_parent on sl_parent.id = sl.parent_set_id
 where s.status = 'completed'
 group by s.id, wp.week_number, wp.is_deload;

grant select on v2_history_session_summary, v2_session_type_history to authenticated;

-- Same PostgREST schema-cache reload 009/011 already document needing.
notify pgrst, 'reload schema';
