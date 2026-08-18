-- Overload v3 — Coach: Daily Session Analysis, schema
-- (COACH-ANALYSIS-SPEC.md §4, COACH-ANALYSIS-TASKS.md §2-§3, step A of
-- COACH-ANALYSIS-TASKS.md §4. Reviewed and approved 2026-08-18.)
--
-- Three tables, all following the app's existing per-user RLS pattern
-- (identical policy shape to 002_v2_rls_policies.sql). No FK into
-- `exercises` — exercise identity travels inside the analysis JSON,
-- denormalised on purpose (TASKS §2, "an analysis is a permanent written
-- record of what was said at the time"). Phase and weight entries relate to
-- sessions only by date, resolved at read time — no FK, by design.

-- ─── v2_coach_session_analyses ──────────────────────────────────────────────
-- One permanent record per analyzed session. `unique (session_id)` (below,
-- §2.2) is load-bearing, not hygiene — SPEC §9 rules out regeneration, so a
-- second analysis of the same session must be impossible, not merely
-- un-offered (TASKS §5.1); it also makes the function's double-tap
-- protection race-safe for free.
--
-- FK is `on delete cascade` — a deliberate, flagged exception to SPEC §8's
-- "permanent": an analysis of a session that no longer exists is not a
-- useful permanent record (TASKS §3.1, §5.7).
--
-- `input_snapshot` — exactly what the model was shown for this row. Settled
-- at review (TASKS §5.11), reversing the plan's own first-draft default:
-- with no regeneration, an analysis whose input can't be reconstructed can't
-- be recovered by re-running it either. Always available at insert time (the
-- function builds it immediately before the API call), so `not null`.
--
-- `model` stores `response.model` (e.g. 'claude-haiku-4-5-20251001'), not
-- the request constant — the response reports what actually served the
-- request, which stays authoritative even if the request model is ever
-- changed back to an alias (TASKS §1.6).
create table v2_coach_session_analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  session_id     uuid not null references v2_sessions(id) on delete cascade,
  content        jsonb   not null,   -- CoachAnalysisContent: per-exercise comments + overall read
  input_snapshot jsonb   not null,   -- exactly what the model was shown (TASKS §5.11)
  model          text    not null,   -- response.model, e.g. 'claude-haiku-4-5-20251001' (TASKS §1.6)
  prompt_version integer not null default 1,
  input_tokens   integer,            -- null if the API omitted usage
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

-- ─── v2_coach_phase_entries ──────────────────────────────────────────────────
-- Dated cut/bulk/maintain log. No end-date column, no note field — SPEC §5
-- and §8 are explicit on both; an entry's implicit end is the next entry's
-- start date, or today if it's the current one. `unique (user_id,
-- start_date)` (below, §2.2) is what makes the implicit-end model
-- well-defined: two phases starting the same day would make "the next
-- entry's start date" ambiguous and produce a zero-length phase.
create table v2_coach_phase_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  phase      text not null check (phase in ('cut', 'bulk', 'maintain')),
  start_date date not null,
  created_at timestamptz not null default now()
);

-- ─── v2_coach_weight_entries ─────────────────────────────────────────────────
-- Dated bodyweight log, kg. `kind` distinguishes a daily weigh-in from a
-- manually-entered weekly average; weekly averages computed from dailies are
-- a read, never stored (SPEC §5/§8 — "never destroy raw data"). For a
-- 'weekly_average' row, `entry_date` is normalised to the Monday of the week
-- it represents (TASKS §5.2) — app-layer convention, not enforced here.
-- `numeric(5,2)` matches the precision convention v2_set_logs.weight already
-- uses (numeric(6,2) there; bodyweight doesn't need the extra digit).
-- `unique (user_id, entry_date, kind)` (below, §2.2) lets a daily and a
-- weekly-average entry coexist on the same date without colliding, while
-- still preventing duplicate entries of the same kind on the same date.
create table v2_coach_weight_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  weight_kg  numeric(5,2) not null check (weight_kg > 0),
  kind       text not null check (kind in ('daily', 'weekly_average')),
  created_at timestamptz not null default now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Identical policy shape to 002_v2_rls_policies.sql. Per-user, not
-- per-*allowed*-user — this is data isolation, not the feature gate. The
-- single-account gate for the Coach section lives outside the database
-- (server env var check in the API function; TASKS §1.4).

alter table v2_coach_session_analyses enable row level security;
create policy "Users access own rows" on v2_coach_session_analyses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table v2_coach_phase_entries enable row level security;
create policy "Users access own rows" on v2_coach_phase_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table v2_coach_weight_entries enable row level security;
create policy "Users access own rows" on v2_coach_weight_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- The three unique indexes are load-bearing, not hygiene — see the table
-- banners above and TASKS §5.1/§5.2.

create unique index v2_coach_analyses_session_uk on v2_coach_session_analyses(session_id);
create index        v2_coach_analyses_user_idx   on v2_coach_session_analyses(user_id, created_at desc);

create unique index v2_coach_phase_user_start_uk on v2_coach_phase_entries(user_id, start_date);
create index        v2_coach_phase_user_idx      on v2_coach_phase_entries(user_id, start_date desc);

create unique index v2_coach_weight_user_date_uk on v2_coach_weight_entries(user_id, entry_date, kind);
create index        v2_coach_weight_user_idx     on v2_coach_weight_entries(user_id, entry_date desc);
