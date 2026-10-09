-- Overload Planner Extension, phase 1 — chunk 24: backfill the one legacy
-- session created by the old "DO IT NOW" shape (SPEC.md "Scheduling [P1]
-- (weekday)" — "The one existing session created by the old 'Do it now'
-- (dated 2026-08-29, done 2026-08-30) gets its moved-to date filled in, so
-- History shows the day it was actually done."; TASKS.md "Live (L4): one
-- existing session was done on a later day than its date (dated
-- 2026-08-29, started 2026-08-30, completed) — the old DO IT NOW shape.").
--
-- Purpose: chunk 24 makes History show moved_to_date (when set) instead of
-- the plain `date` column, so a session is shown on the day it was
-- actually done rather than the day it was originally scheduled for. L4 is
-- the one session that predates chunk 24's own "Do it now" (now a move to
-- today, setting moved_to_date on insert) — it was missed on Saturday
-- 2026-08-29, done the next day, Sunday 2026-08-30, by the OLD DO IT NOW
-- shape, which only ever wrote `date` = the missed day and never recorded
-- the day it was actually trained. Without this backfill, chunk 24's own
-- History change would newly show this one row on 2026-08-29 (still
-- correct by `date`, but not "the day it was actually done" — every other
-- row this chunk's code touches going forward gets moved_to_date set at
-- write time; this one row is the sole pre-existing exception).
--
-- Selected by CRITERIA, never a guessed id (TASKS.md: "selected by user_id
-- = Adam, date = 2026-08-29, moved_to_date is null, completed, and
-- started_at on 2026-08-30 — never by a guessed id; run the same select
-- first and record that it returns exactly one row"):
--   user_id      = '12e79b69-9891-4f53-a7cf-650edd83659f'  (Adam)
--   date         = '2026-08-29'
--   moved_to_date is null
--   status       = 'completed'
--   started_at   on 2026-08-30 (UTC calendar date — v2_sessions.started_at
--                is timestamptz; bounded as a half-open range rather than a
--                cast/truncate, so the comparison stays index-friendly)
--
-- Not destructive: fills v2_sessions.moved_to_date (added by migration 027,
-- chunk 1 — null on every row until this file runs) on exactly one row and
-- changes no other column, no other row. Idempotent: once applied, that
-- row's moved_to_date is no longer null, so the same five-criteria select
-- finds zero rows on a re-run. The do $$ … $$ block below tells that
-- apart from a real problem:
--   - exactly one row matches the five criteria above -> update it, done.
--   - zero rows match -> this must mean "already applied" (this
--     migration's whole purpose is the one known L4 row, so "there was
--     never a row" is not an expected outcome here): a second select, same
--     five criteria but moved_to_date = '2026-08-30' instead of `is null`,
--     must then find exactly that one row, already in the applied state.
--     If it doesn't (0 or 2+), raise — something is wrong, don't guess.
--   - two or more rows match the five criteria -> raise. The criteria
--     aren't narrowing to one specific row the way L4 is understood to be.
-- Both runs are proven on scratch before this is ever run live (see this
-- chunk's report): a fixture with the matching row plus five near-misses
-- (another user, another date, already moved, not completed, started on
-- another day) proves the select narrows to exactly one row; running this
-- file twice proves the second run changes nothing and raises nothing.
--
-- Pre-check — Adam runs this SELECT himself first, before applying, and
-- confirms it returns exactly one row (same five criteria the block below
-- uses):
--   select id, user_id, date, moved_to_date, status, started_at
--     from v2_sessions
--    where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
--      and date = '2026-08-29'
--      and moved_to_date is null
--      and status = 'completed'
--      and started_at >= '2026-08-30 00:00:00+00'
--      and started_at <  '2026-08-31 00:00:00+00';
--
-- Rollback (by hand — this file does not run it): sets that one row's
-- moved_to_date back to null. The date predicate alone no longer narrows
-- to it after this migration has run, so moved_to_date = '2026-08-30' is
-- added to the same five criteria in place of `is null`:
--   update v2_sessions
--      set moved_to_date = null
--    where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
--      and date = '2026-08-29'
--      and moved_to_date = '2026-08-30'
--      and status = 'completed'
--      and started_at >= '2026-08-30 00:00:00+00'
--      and started_at <  '2026-08-31 00:00:00+00';
--
-- check-migration: exit 1 — an UPDATE on an existing table is not on its
-- safe list (migration-rules.mjs's classifier recognises CREATE TABLE/
-- INDEX/TYPE, COMMENT, ALTER TABLE ADD COLUMN, CREATE POLICY and GRANT as
-- safe; a `do $$ … $$` block matches none of those patterns and falls
-- through to "not on the safe list", the same bucket a bare UPDATE would
-- land in). Expected, not a sign of anything missed — this file writes to
-- a row that already exists, which is exactly what the safe list excludes
-- by design. No `notify pgrst, 'reload schema'` — no schema change at all
-- (no new table, column, index, view or function; a plain UPDATE of
-- existing data on an already-live column), so PostgREST's schema cache
-- has nothing new to pick up.

do $$
declare
  match_count int;
  already_applied_count int;
begin
  select count(*) into match_count
    from v2_sessions
   where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
     and date = '2026-08-29'
     and moved_to_date is null
     and status = 'completed'
     and started_at >= '2026-08-30 00:00:00+00'
     and started_at <  '2026-08-31 00:00:00+00';

  if match_count = 1 then
    update v2_sessions
       set moved_to_date = '2026-08-30'
     where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
       and date = '2026-08-29'
       and moved_to_date is null
       and status = 'completed'
       and started_at >= '2026-08-30 00:00:00+00'
       and started_at <  '2026-08-31 00:00:00+00';

  elsif match_count = 0 then
    select count(*) into already_applied_count
      from v2_sessions
     where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
       and date = '2026-08-29'
       and moved_to_date = '2026-08-30'
       and status = 'completed'
       and started_at >= '2026-08-30 00:00:00+00'
       and started_at <  '2026-08-31 00:00:00+00';

    if already_applied_count <> 1 then
      raise exception
        'v2_sessions legacy L4 backfill: expected either one matching row or one already-applied row (Adam, 2026-08-29 -> 2026-08-30); found % matching, % already applied',
        match_count, already_applied_count;
    end if;
    -- else: already applied on a prior run — treated as success, nothing to do.

  else
    raise exception
      'v2_sessions legacy L4 backfill: expected exactly one matching row (Adam, date 2026-08-29, completed, started 2026-08-30); found %',
      match_count;
  end if;
end $$;
