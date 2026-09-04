-- Overload v3 — Coach: Mesocycle Analysis, schema
-- (MESOCYCLE-ANALYSIS-SPEC.md, MESOCYCLE-ANALYSIS-TASKS.md §4.2, as revised
-- by decision A6 at the 2026-09-04 review. One new table. No changes to any
-- existing table.)
--
-- Full parity with v2_coach_session_analyses (012) and
-- v2_coach_week_analyses (013)'s provenance fields — same
-- id/user_id/content/input_snapshot/model/prompt_version/token columns, same
-- four questions (TASKS §4.2, COACH-ANALYSIS-TASKS §3.1/§5.11).
--
-- **A6 reversed at review: the analysis must survive its mesocycle's
-- deletion, not cascade with it.** `v2_sessions.mesocycle_id` is already
-- `on delete set null` — cascading here would destroy the analysis of a
-- block while the sessions it describes survive, the record dying while its
-- subject matter lives on. `mesocycle_id` is therefore nullable with
-- `on delete set null`, not `not null` with `on delete cascade`.
--
-- **Identity travels denormalised** once the FK can go null — the same
-- convention `v2_session_exercise_swaps` (025) and
-- `v2_exercise_reassignments` (022) already apply: `meso_name`/
-- `meso_start_date`/`meso_end_date` are written at insert time from the
-- payload's own `meso` block, so a row whose `mesocycle_id` has gone null
-- still says which block it describes without depending on a join that can
-- return nothing. `meso_end_date` is the one nullable of the three,
-- deliberately: both `v2_mesocycles` completion paths write `status` and
-- `end_date` together (TASKS §4.1), so in practice it is always present —
-- but a `not null` here would turn an anomalous row into an insert failure
-- *after* generation has already been paid for, with nothing saved and no
-- way to recover the output. The other two columns cannot fail that way:
-- `v2_mesocycles.name` and `start_date` are both `not null` at source.

create table v2_coach_meso_analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  mesocycle_id    uuid references v2_mesocycles(id) on delete set null,

  meso_name       text not null,
  meso_start_date date not null,
  meso_end_date   date,

  content         jsonb   not null,   -- MesoAnalysisContent (TASKS §6)
  input_snapshot  jsonb   not null,   -- exactly what the model was shown
  model           text    not null,   -- response.model, not the request constant
  prompt_version  integer not null default 1,   -- MESO_PROMPT_VERSION, independent of daily's (7) and weekly's (3)
  input_tokens    integer,            -- null if the API omitted usage
  output_tokens   integer,
  created_at      timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Identical policy shape to 002/012/013/023/024/025. Per-user, not
-- per-*allowed*-user — data isolation, not the feature gate. The
-- single-account gate lives outside the database (COACH_USER_ID, checked in
-- the API function).

alter table v2_coach_meso_analyses enable row level security;
create policy "Users access own rows" on v2_coach_meso_analyses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Indexes ─────────────────────────────────────────────────────────────────
-- One, matching v2_coach_week_analyses_week_uk's role exactly: makes
-- regeneration structurally impossible while the meso exists (TASKS §5.2
-- step 2's idempotent existing-row check reads through this same index),
-- and stops constraining a row once `mesocycle_id` goes null — Postgres
-- treats NULLs as distinct in a unique index, so several orphaned analyses
-- can coexist under one user with this index raising no objection. That is
-- deliberate, not a gap: once a meso is deleted it can never be re-analysed
-- regardless (the endpoint resolves it by id and returns 404 first), so the
-- constraint was never protecting anything after deletion — only the live
-- case, which it still does.

create unique index v2_coach_meso_analyses_meso_uk
  on v2_coach_meso_analyses(user_id, mesocycle_id);
