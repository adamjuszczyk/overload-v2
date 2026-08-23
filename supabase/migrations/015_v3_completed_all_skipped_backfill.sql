-- Overload v3 — reclassify all-skipped "completed" sessions as "skipped"
-- (data backfill, no schema change). See CONTEXT.md, 2026-08-22 session
-- (fix: session-skip reclassification + reach-back + coachPrompt.ts v3).
--
-- Real bug this closes: 2026-08-15's Legs session landed as status
-- 'completed' with all 10 of its v2_set_logs rows is_skipped = true (every
-- set, every exercise, individually skipped rather than the session being
-- skip-marked). resolveExerciseReference then correctly (by its own
-- date-based rules) treated it as a legitimate LAST WEEK candidate, and the
-- next real Daily Session Analysis read "was not logged last week" for
-- exercises that were logged, just skipped. The completion write path
-- (sessionService.ts's completeSession, useSession.ts's useCompleteSession
-- offline branch) now checks this at write time via
-- sessionCompletion.ts's shouldClassifyAsSkipped and writes 'skipped'
-- instead — this migration is the one-time catch-up for rows written before
-- that fix.
--
-- Executed for real via the app's own authenticated REST session this
-- session (no SQL Editor access available) — this file documents the
-- equivalent SQL for the record and for any future environment where the
-- SQL Editor is the actual execution path. Result actually applied and
-- independently verified via a fresh re-query (not trusted from a
-- "Success" response alone): exactly one row matched
-- (f4b02764-8240-4af7-aef2-50113cce0fe4, 2026-08-15, LEGS) out of 32
-- completed sessions checked; re-running the discovery query after the
-- update returned zero remaining matches.

-- ============================================================================
-- STEP 1 — AUDIT (read-only). Run first; the count should be small (this
-- account: exactly 1, out of 32 completed sessions).
-- ============================================================================

select s.id, s.date, s.workout_day_id
from v2_sessions s
where s.status = 'completed'
  and exists (select 1 from v2_set_logs l where l.session_id = s.id)
  and not exists (
    select 1 from v2_set_logs l where l.session_id = s.id and l.is_skipped = false
  );

-- ============================================================================
-- STEP 2 — BACKFILL. Same predicate as Step 1 — only sessions with at least
-- one v2_set_logs row, all of them is_skipped. A session with zero logged
-- sets is a different, pre-existing case (FINISH SESSION has no gate
-- requiring anything be logged) and is deliberately not touched here.
-- ============================================================================

update v2_sessions s
set status = 'skipped'
where s.status = 'completed'
  and exists (select 1 from v2_set_logs l where l.session_id = s.id)
  and not exists (
    select 1 from v2_set_logs l where l.session_id = s.id and l.is_skipped = false
  );

-- ============================================================================
-- STEP 3 — VERIFY. Re-run Step 1's query — it must return zero rows.
-- ============================================================================

select s.id, s.date, s.workout_day_id
from v2_sessions s
where s.status = 'completed'
  and exists (select 1 from v2_set_logs l where l.session_id = s.id)
  and not exists (
    select 1 from v2_set_logs l where l.session_id = s.id and l.is_skipped = false
  );
