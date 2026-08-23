-- Overload v3 — Coach: Weekly Analysis, schema
-- (COACH-WEEK-ANALYSIS-SPEC.md §4, COACH-WEEK-ANALYSIS-TASKS.md §2, step 2 of
-- §6. 012 is the last applied migration.)
--
-- Two additive columns on the shared `exercises` table and one new table.
-- Nothing existing is modified or removed. The reviewed tag *values* are
-- migration 014, deliberately separate — they can't be written until the
-- batch classification pass has been reviewed and corrected (TASKS §4).

-- ─── exercises — two new tag columns ─────────────────────────────────────────
-- `exercises` is shared with Northstar v2. Same minimal-blast-radius form
-- `muscle_group` itself was added in 001_v2_schema.sql: nullable, no
-- default, no NOT NULL, no trigger. Nothing outside this feature writes them.

alter table exercises
  add column if not exists muscle_subgroup  text[],
  add column if not exists movement_pattern text;

-- Seven values, exactly as COACH-WEEK-ANALYSIS-SPEC.md §4 enumerates them.
-- Single-value by design, unlike muscle_subgroup.
alter table exercises
  add constraint exercises_movement_pattern_chk
  check (movement_pattern is null or movement_pattern in (
    'horizontal_push', 'vertical_push',
    'horizontal_pull', 'vertical_pull',
    'hip_hinge', 'squat', 'isolation'
  ));

-- Load-bearing, not hygiene: the bucketing rule is "no muscle_subgroup ->
-- fall back to muscle_group" (SPEC §5). This leaves exactly ONE representation
-- of untagged (NULL), so the fallback is one branch instead of two. The
-- null-element half stops a {side_delt,NULL} array producing a bucket labelled
-- `null`. No CHECK on the vocabulary itself — deliberately open, TASKS §7.10.
alter table exercises
  add constraint exercises_muscle_subgroup_chk
  check (
    muscle_subgroup is null or (
      cardinality(muscle_subgroup) > 0
      and array_position(muscle_subgroup, null) is null
    )
  );

-- ─── v2_coach_week_analyses ──────────────────────────────────────────────────
-- One permanent row per resolved week. Full parity with
-- v2_coach_session_analyses' provenance fields (content / input_snapshot /
-- model / prompt_version / token counts) — same four questions, same reasoning
-- as COACH-ANALYSIS-TASKS §3.1/§5.11.
--
-- `week_start` is the Monday of the week, Monday-anchored per this app's
-- standing rule (weightLogic.ts's weekKey; CONTEXT.md "Key architectural
-- rules"). `unique (user_id, week_start)` (below) makes regeneration
-- structurally impossible, per SPEC §4.
--
-- The isodow CHECK is what makes "one row per week" actually true: without it,
-- 2026-08-17 and 2026-08-18 are two distinct rows describing the same seven
-- days, and SPEC §9 provides no delete control to clean that up.
--
-- No FK and therefore no cascade — a week is not a row, so there is nothing to
-- cascade from. A weekly analysis outlives deletion of the sessions it
-- describes; deliberate, see TASKS §7.7.
create table v2_coach_week_analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  week_start     date    not null check (extract(isodow from week_start) = 1),
  content        jsonb   not null,   -- CoachWeekAnalysisContent (TASKS §3.2)
  input_snapshot jsonb   not null,   -- exactly what the model was shown
  model          text    not null,   -- response.model, not the request constant
  prompt_version integer not null default 1,   -- WEEK_PROMPT_VERSION, independent of daily's
  input_tokens   integer,            -- null if the API omitted usage
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Identical policy shape to 002_v2_rls_policies.sql and 012. Per-user, not
-- per-*allowed*-user — data isolation, not the feature gate. The single-account
-- gate lives outside the database (COACH_USER_ID, checked in the API function).

alter table v2_coach_week_analyses enable row level security;
create policy "Users access own rows" on v2_coach_week_analyses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Indexes ─────────────────────────────────────────────────────────────────
-- Two total, not three: the unique index already serves the list query's
-- `order by week_start desc` as a backward index scan, so a separate
-- (user_id, week_start desc) index would be dead weight — unlike the daily
-- table, where the unique index is on (session_id) alone and the list orders by
-- created_at. No GIN index on exercises.muscle_subgroup: bucketing happens in
-- code, so no query ever filters by tag in SQL.

create unique index v2_coach_week_analyses_week_uk
  on v2_coach_week_analyses(user_id, week_start);
