-- Overload v3 — session-scoped exercise swap, structural link.
-- One new table. No changes to any existing table.
--
-- Swap-exercise (built 2026-08-27, SwapExerciseSheet.tsx/ExerciseCard.tsx)
-- has never written a link between the original exercise slot and its
-- replacement anywhere — confirmed by reading the real swap code and every
-- migration, not assumed (CONTEXT.md, "2026-08-31 session... Part 3"). Daily
-- analysis therefore reads a real swap as two disconnected facts: the
-- original exercise skipped, the replacement added and unplanned — a real,
-- confirmed instance of this happened 2026-09-03 (Chest Press -> Smith
-- Press). This table is the minimal structural fact assembleAnalysisInput
-- needs to state the substitution explicitly instead of leaving the model to
-- infer it from two unrelated exercises in the same session.
--
-- One row per swap *event*, not per set log — a swap can be confirmed before
-- any replacement set is logged (ExerciseCard.tsx's handleConfirmSwap skips
-- the original's remaining sets first, unconditionally, then hands the
-- replacement up), so tying this fact to set_logs would leave it
-- unreconstructable until the first replacement set actually lands. Scoped
-- to session_id, not just exercise_id — the same program_exercise slot
-- recurs every time its workout day comes around, and a swap made in one
-- session must never apply to any other.
--
-- original_exercise_id/name and replacement_exercise_id/name are both kept
-- as plain (non-cascading-delete) facts rather than relying solely on a join
-- through v2_program_exercises or exercises — same "identity travels
-- denormalised" reasoning v2_exercise_reassignments (022) and
-- v2_coach_session_analyses already apply: this row must stay
-- self-describing even if the exercise library changes later. Both keep an
-- FK for referential integrity (a swap can only ever name real exercises),
-- but ON DELETE SET NULL rather than CASCADE — deleting an exercise later
-- must not silently erase the historical fact that a swap happened.
--
-- program_exercise_id is the UI's own notion of "slot" (GymSession.tsx sorts
-- and renders v2_program_exercises rows by position) — kept so the live
-- session screen can look a swap up by the exact slot it replaces and render
-- the replacement in that slot's position instead of appending it, without
-- re-deriving the slot from exercise_id (which is not guaranteed unique
-- within a workout day). ON DELETE SET NULL: the workout day template can
-- change after the session that swapped in it, and this row must survive
-- that unchanged everywhere else.

create table v2_session_exercise_swaps (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  session_id                 uuid not null references v2_sessions(id) on delete cascade,
  program_exercise_id        uuid references v2_program_exercises(id) on delete set null,

  original_exercise_id       uuid references exercises(id) on delete set null,
  original_exercise_name     text not null,
  replacement_exercise_id    uuid references exercises(id) on delete set null,
  replacement_exercise_name  text not null,

  created_at                 timestamptz not null default now()
);

alter table v2_session_exercise_swaps enable row level security;
create policy "Users access own rows" on v2_session_exercise_swaps
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Primary access pattern for both callers: GymSession.tsx reconstructing the
-- live screen on load/refresh, and assembleAnalysisInput building the daily
-- payload — both look up "every swap for this session," never by id.
create index v2_session_exercise_swaps_session_idx
  on v2_session_exercise_swaps(session_id);

-- The app only ever offers the swap icon on an un-swapped slot (no re-swap
-- affordance once a replacement is showing), so a second row for the same
-- (session, slot) should never happen in normal use — this guards against a
-- double-tap or retry producing two conflicting swap facts for one slot.
-- Partial (program_exercise_id is not null) because Postgres treats NULLs as
-- distinct in a unique index, and a slot whose program_exercise_id has since
-- gone NULL (the workout day exercise was deleted) must not block a future
-- row that also happens to resolve to NULL.
create unique index v2_session_exercise_swaps_slot_uk
  on v2_session_exercise_swaps(session_id, program_exercise_id)
  where program_exercise_id is not null;
