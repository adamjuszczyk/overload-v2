-- Overload v3 — fix: total_volume counted a stage even when its head was
-- skipped (found by adversarial review, 2026-08-13/14 follow-up to the
-- position-matched multi-session table session).
--
-- 009's total_volume filter checked only the STAGE row's own is_skipped/
-- is_warmup — never its parent's. A stage's own is_skipped is always false
-- in every real case observed (SKIP only fires on an unlogged row, before a
-- stage could ever be attached to it), so a stage can carry real weight/reps
-- of its own while its head (parent_set_id) is the one marked skipped —
-- real account instance: session 67ebb796-49b9-4041-9310-34a3573b798b
-- (2026-07-16), a 5kg×8 stage attached to a skipped set 4. That stage's
-- 40kg·reps was silently counted into that day's PUSH 2 total_volume.
--
-- avg_rir and set_count already exclude every stage outright (parent_set_id
-- is null in both filters) so they were never affected — only total_volume,
-- which deliberately keeps stages (a stage is real work performed, SPEC
-- §2.1's stage-exclusion rule's one exception), needed the added check.
--
-- volume is never stored (SPEC/CONTEXT.md: "duration is computed at read
-- time, never stored" — same is true here, total_volume is a live SUM, not
-- a column) — so redefining the view is the complete fix. No backfill: the
-- next read of this view for any past session already reflects the
-- corrected total, nothing to migrate.
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
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null
       ) as set_count
  from v2_sessions s
  left join v2_week_plans wp on wp.id = s.week_plan_id
  left join v2_set_logs   sl on sl.session_id = s.id
  left join v2_set_logs   sl_parent on sl_parent.id = sl.parent_set_id
 where s.status = 'completed'
 group by s.id, wp.week_number, wp.is_deload;

grant select on v2_session_type_history to authenticated;

-- Same PostgREST schema-cache reload 009 already documents needing.
notify pgrst, 'reload schema';
