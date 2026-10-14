-- Overload Planner Extension, 1.2 (TASKS-1.2.md chunk 36) — the schema 1.2
-- needs (additive).
-- Three new columns on two existing tables and three new, empty tables. No
-- existing row changes: every new column is nullable or carries a default that
-- existing rows take as-is, every new CHECK is satisfied by those
-- defaults/NULLs, and the new tables start empty. No backfill, no function, no
-- change to any existing constraint, policy or index. Safe with the current
-- client still live: it never names a new column or table, and every write
-- shape it uses stays valid (its full-row settings upsert omits the two new
-- settings columns, so the stored values stay).
--
-- Nothing reads or writes any of this yet. Later chunks do, each after this
-- file is live on staging: the RIR range (the week view's pickers, 54a; the
-- deload rule, 48; COPY, 52), the REVIEW decisions (56), the session-only set
-- changes (61-63), the per-week schedule history (45, 50, 51b), the two
-- Settings rows (49).
--
-- Rollback: forward-only. A later migration can drop the three tables and the
-- three columns once no bundle writes them; until then they sit unused. Drop
-- the tables first (v2_session_set_changes points at v2_week_plan_sets,
-- v2_set_logs and v2_sessions), then the columns.
--
-- Conventions kept: v2_ prefix; user_id on every row with the standard
-- "for all using/with check (user_id = auth.uid())" policy; text + CHECK
-- vocabularies; explicit grants on the new tables (000 does the same: a new
-- Supabase branch has no default privileges on public, so a table without
-- them answers 42501 to everyone until the platform defaults are restored).

-- ═══ New columns on existing tables ══════════════════════════════════════════
-- One ALTER per table. Every CHECK is on the new column itself (column-level,
-- so `add column if not exists` keeps the statement re-runnable) and is
-- satisfied by that column's default or NULL, so no existing row is affected.

-- ─── v2_week_plan_sets ───────────────────────────────────────────────────────
-- RIR target as a number or a range (SPEC [1.2] 17). target_rir stays the
-- number / the range's low end; this column holds the range's high end. A
-- number is target_rir_max null. A range needs a low end.
alter table v2_week_plan_sets
  add column if not exists target_rir_max integer
    constraint v2_week_plan_sets_target_rir_max_check
      check (target_rir_max is null or (target_rir is not null and target_rir_max >= target_rir));

-- ─── v2_user_settings ────────────────────────────────────────────────────────
-- stage_volume_rule: how drops and stages count in the VOLUME sheet (SPEC [1.2]
-- 14b; G51: that sheet only). whole = the set counts 1; each = every drop
-- counts 1; half = every drop counts one half. log_in_order: the log lock
-- (SPEC [1.2] 18a). The old client's full-row upsert never names these, so on
-- conflict it leaves them as they are.
alter table v2_user_settings
  add column if not exists stage_volume_rule text not null default 'half'
    constraint v2_user_settings_stage_volume_rule_check
      check (stage_volume_rule in ('whole', 'each', 'half')),
  add column if not exists log_in_order boolean not null default true;

-- ═══ New tables ══════════════════════════════════════════════════════════════

-- ─── v2_week_review_decisions ────────────────────────────────────────────────
-- Which of last week's differences (REVIEW, SPEC [1.2] 13) were used or
-- ignored, so a decided item never comes back. week_plan_id is the shown
-- week's own session row (REVIEW items are grouped by workout, and this week
-- is always planned when REVIEW shows). item_key is deterministic, built by
-- one function in review.ts over a union of item kinds, and is never a set log
-- id: an added set is keyed by session, exercise and position, so a decision
-- survives last week's set being unlogged and logged again.

create table v2_week_review_decisions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  week_plan_id  uuid not null references v2_week_plans(id) on delete cascade,
  item_key      text not null,
  decision      text not null
    constraint v2_week_review_decisions_decision_check
      check (decision in ('used', 'ignored')),
  created_at    timestamptz not null default now(),
  constraint v2_week_review_decisions_item_uk unique (week_plan_id, item_key)
);

alter table v2_week_review_decisions enable row level security;
create policy "Users access own rows" on v2_week_review_decisions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on table v2_week_review_decisions to anon, authenticated, service_role;

-- The unique key above already serves week_plan_id lookups and the cascade;
-- the plain index is the one the chunk's scope lists.
create index v2_week_review_decisions_week_plan_idx
  on v2_week_review_decisions(week_plan_id);

-- ─── v2_session_set_changes ──────────────────────────────────────────────────
-- A set changed or removed during a workout, recorded on the session and never
-- on the plan (SPEC [1.2] "Set log": "recorded on the session's set, never on
-- the plan"; delete set: "this session only"). A logged set carries its change
-- on its own v2_set_logs row; this table holds what has no log row to live on.
-- One row per changed set, of one of three kinds:
--   deleted         a planned set removed before it was logged
--   retyped         a planned set given another type before it was logged:
--                   warmup, a stage kind with its count, or normal
--   pending_stages  a logged head whose pending drops still need their count
-- The keys and flags each kind may carry are checked below, so a row that
-- means nothing cannot be written. Rows die with the session.

create table v2_session_set_changes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid not null references v2_sessions(id) on delete cascade,
  kind              text not null
    constraint v2_session_set_changes_kind_check
      check (kind in ('deleted', 'retyped', 'pending_stages')),
  -- deleted / retyped: the planned set. Gone with the plan row.
  week_plan_set_id  uuid references v2_week_plan_sets(id) on delete cascade,
  -- pending_stages: the logged head. Gone with the log.
  set_log_id        uuid references v2_set_logs(id) on delete cascade,
  is_warmup         boolean not null default false,
  stage_kind        text
    constraint v2_session_set_changes_stage_kind_check
      check (stage_kind in ('dropset', 'rest_pause', 'myo_reps', 'cluster')),
  stage_count       integer not null default 0
    constraint v2_session_set_changes_stage_count_check
      check (stage_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- deleted / retyped name a planned set and no log; pending_stages names a
  -- log and no planned set.
  constraint v2_session_set_changes_keys_check
    check ((kind in ('deleted', 'retyped') and week_plan_set_id is not null and set_log_id is null)
        or (kind = 'pending_stages' and set_log_id is not null and week_plan_set_id is null)),
  -- A deleted set carries no type.
  constraint v2_session_set_changes_deleted_check
    check (kind <> 'deleted' or (not is_warmup and stage_kind is null and stage_count = 0)),
  -- A warmup is never staged.
  constraint v2_session_set_changes_warmup_check
    check (not (is_warmup and stage_kind is not null)),
  -- A stage kind and a stage count come together.
  constraint v2_session_set_changes_stage_pair_check
    check ((stage_kind is not null) = (stage_count > 0))
);

alter table v2_session_set_changes enable row level security;
create policy "Users access own rows" on v2_session_set_changes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on table v2_session_set_changes to anon, authenticated, service_role;

-- All of a session's changes in one read; and one change per planned set / per
-- logged head per session (the partial uniques are the upsert targets).
create index v2_session_set_changes_session_idx
  on v2_session_set_changes(session_id);
create unique index v2_session_set_changes_plan_set_uk
  on v2_session_set_changes(session_id, week_plan_set_id)
  where week_plan_set_id is not null;
create unique index v2_session_set_changes_set_log_uk
  on v2_session_set_changes(session_id, set_log_id)
  where set_log_id is not null;

-- ─── v2_run_schedules ────────────────────────────────────────────────────────
-- A run's weekday schedule history (SPEC [1.2] "Weekdays storage"): this
-- week's sessions keep their days and the new days apply from next week. The
-- schedule in force for a week is the row with the greatest from_week <= that
-- week, else the run copy's own v2_programs.schedule. Same
-- {monday: workoutDayId | null, ...} shape as v2_programs.schedule. Weekday
-- runs only; a sequence run never gets a row.

create table v2_run_schedules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  mesocycle_id  uuid not null references v2_mesocycles(id) on delete cascade,
  from_week     integer not null
    constraint v2_run_schedules_from_week_check
      check (from_week >= 1),
  schedule      jsonb not null,
  created_at    timestamptz not null default now(),
  constraint v2_run_schedules_week_uk unique (mesocycle_id, from_week)
);

alter table v2_run_schedules enable row level security;
create policy "Users access own rows" on v2_run_schedules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on table v2_run_schedules to anon, authenticated, service_role;

-- Make PostgREST pick up the new tables and columns.
notify pgrst, 'reload schema';
