-- Overload Planner Extension, 1.2 (TASKS-1.2.md chunk 59) — migration 047:
-- v2_session_exercise_swaps.moved_sets, the swap's record of which sets moved.
--
-- One new column on one existing table, and nothing else. No existing row
-- changes: the column is nullable with no default (every existing swap row
-- reads NULL), and there is no check, no backfill, no index, no function, no
-- policy and no grant (the table's own RLS policy "Users access own rows" and
-- its grants cover a new column as they cover the old ones). Safe with the
-- current client still live: it never names the column, and every write it
-- sends stays valid (an insert writes only the columns its payload names).
--
-- What the column means (Adam, 2026-10-20; DECISIONS 183, 46r's Q5 (a) and 196;
-- SPEC.md, Logging mechanics, "Swap during a workout (C7)"): a swap for today
-- moves the original exercise's open sets to the replacement as added sets of
-- it (DECISIONS 164, 179), and the original card draws no row for a set that
-- moved ("the swap has to record which sets moved"). The record is stored
-- explicitly, here, with the swap's own row, and never inferred from the logs.
-- The app writes it with the swap, before any set is skipped (DECISIONS 200):
--
--   { "fromKey": <the card the sets moved from, as every phone builds its key>,
--     "moved": [ { "from": { "weekPlanSetId": <uuid> } | { "addedPlace": <int> },
--                  "place": <int> } , ... ] }
--
-- `fromKey` is the program exercise's id of the swapped slot, `moved` names each
-- set in the order it stood (a planned set by its id, a set added in the
-- session by its place on the original exercise) with the place it took among
-- the sets added to the replacement (chunk 46r's `SwapRecord`, which reads it
-- back). The shape is the app's to keep; the column holds any JSON the app
-- writes, and a reader that finds anything else treats the swap as one with no
-- record.
--
-- A swap row with no record (every swap before this file, and any a bundle
-- older than chunk 59 writes) reads NULL and is drawn as before 1.2 draws it:
-- two cards, no set moved (DECISIONS 198).
--
-- Nothing reads or writes the column yet. Chunk 59's bundle is the only writer,
-- and it starts after this file is live: a write that names a missing column
-- fails (PostgREST 400 / PGRST204), as a named column list does (42703).
--
-- Rollback: forward-only. A later migration can remove the column once no
-- bundle writes it; until then it sits unused.

alter table v2_session_exercise_swaps
  add column if not exists moved_sets jsonb null;

-- Make PostgREST pick up the new column.
notify pgrst, 'reload schema';
