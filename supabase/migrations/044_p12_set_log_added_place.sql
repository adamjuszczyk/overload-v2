-- Overload Planner Extension, 1.2 (TASKS-1.2.md chunk 46m) — migration 044:
-- v2_set_logs.added_place, an added set's place in the session order.
--
-- One new column on one existing table, and nothing else. No existing row
-- changes: the column is nullable with no default (every existing row reads
-- NULL), its CHECK is satisfied by NULL, and there is no backfill, no index, no
-- function, no policy and no grant (the table's own RLS policy and grants cover
-- a new column as they cover the old ones). Safe with the current client still
-- live: it never names the column, and every write it sends stays valid (a
-- PostgREST upsert writes only the columns its payload names).
--
-- What the column means (Adam, 2026-10-19; DECISIONS 173 and 174 (a); SPEC.md,
-- Objects stored -> Set log): an added set's place among the sets added to its
-- exercise in that session, from 1, in the order they were added. It is
-- assigned once, when the added set is created (chunk 46's rule), held by the
-- card's draft until the set's log is first written, written with that log (the
-- sync queue carries it offline), and kept on a re-log after an unlog. Planned
-- sets leave it NULL. Nothing changes it afterwards: removing a set, a switch
-- to or from Warmup and renumbering never touch it, because a set's number is
-- derived from the order and not stored in it.
--
-- A log with no place and no planned set (anything logged before this file)
-- keeps the order the app gives it today: logged_at, then id. That fallback
-- lives in the reader (chunk 46's module), not here.
--
-- Nothing reads or writes the column yet. Chunk 46 reads it (the SetLog type
-- and its mappers); chunk 58a is the first to write it (LOG), then 59, 61 and
-- 63. Each starts after this file is live on staging: a named column list that
-- names a missing column fails the whole read (PostgREST 400, 42703).
--
-- Rollback: forward-only. A later migration can remove the column once no
-- bundle writes it; until then it sits unused.
--
-- Convention kept from 042: the CHECK sits on the new column itself (column
-- level, named), so the statement stays re-runnable and the constraint comes
-- and goes with the column.

alter table v2_set_logs
  add column if not exists added_place integer null
    constraint v2_set_logs_added_place_check
      check (added_place is null or added_place >= 1);

-- Make PostgREST pick up the new column.
notify pgrst, 'reload schema';
