-- Overload — Exercise Library Rework, reassignment audit log
-- (EXERCISE-LIBRARY-TASKS.md §5, §11.2. 021 is the last applied migration —
-- this one is applied BEFORE 021, since 021's function body writes to it.)
--
-- Written once, by reassign_exercise_history() (021), as the last
-- statement inside the same transaction as the merge itself — never
-- edited or deleted by the app afterward. This does not make a
-- reassignment reversible (§5.6); it makes an incorrect one diagnosable,
-- which is currently impossible once the source row is gone. Same
-- reasoning v2_coach_curation_runs was added for (COACH-PERSONALIZATION-
-- TASKS.md §7.6 — "provenance for a process that mutates a standing store
-- instead of appending a permanent record").
--
-- Both exercise identities are snapshotted as plain text, not read back
-- through a join, for two different reasons per side:
--   * source_exercise_id carries no FK at all, because the row it names
--     is deleted by this same function moments after this insert runs —
--     an FK here would be violated by the very operation that writes it.
--   * target_exercise_id keeps an FK for convenience (the common case:
--     "what does this used to be called, and where did it go") but ON
--     DELETE SET NULL, because a target can itself become a reassignment
--     source in some later merge and get deleted in turn. Either way the
--     *_name columns keep this row self-describing forever, the same
--     "identity travels denormalised" reasoning v2_coach_session_analyses
--     already applies to exercise names inside its content JSON
--     (COACH-ANALYSIS-TASKS.md §2, cited in TASKS §5.3's own table).

create table v2_exercise_reassignments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  source_exercise_id    uuid not null,   -- no FK — this row is deleted in the same transaction
  source_exercise_name  text not null,
  target_exercise_id    uuid references exercises(id) on delete set null,
  target_exercise_name  text not null,
  set_logs_moved        integer not null,
  program_exercises_moved  integer not null,   -- §5.3 step 2a
  program_exercises_merged integer not null,   -- §5.3 step 2b
  plan_sets_moved        integer not null,     -- §5.3 step 2b
  source_deleted         boolean not null,     -- §5.3 step 5 — false only on the
                                                -- should-be-unreachable branch
  created_at              timestamptz not null default now()
);

alter table v2_exercise_reassignments enable row level security;
create policy "Users access own rows" on v2_exercise_reassignments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Same shape as v2_coach_curation_runs' own list index — no view exists
-- yet to read this in v1 (§11.2's recommendation was for the row to exist
-- and be diagnosable via direct query, not for a list screen), but the
-- index is one line and matches this schema's standing convention for
-- every append-only log table.
create index v2_exercise_reassignments_user_created_idx
  on v2_exercise_reassignments(user_id, created_at desc);
