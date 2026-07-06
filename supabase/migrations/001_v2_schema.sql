-- Overload v2 — schema migration
-- Run in Supabase SQL Editor after 001/002 from v1 have been applied.
-- All v2 tables use the v2_ prefix to coexist with v1 tables on the same project.

-- ─── exercises — add muscle_group column ───────────────────────────────────
-- v2 reuses the existing exercise library. Only this column is new.

alter table exercises
  add column if not exists muscle_group text;

-- ─── v2_programs ──────────────────────────────────────────────────────────────
-- Simpler than v1: no is_active, no target_sets/target_rir at the program level.

create table v2_programs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  schedule   jsonb not null default '{}',  -- { "monday": workout_day_id | null, ... }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── v2_workout_days ──────────────────────────────────────────────────────────

create table v2_workout_days (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references v2_programs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  position   integer not null  -- 0-based ordering within program
);

-- ─── v2_program_exercises ─────────────────────────────────────────────────────
-- No target_sets or target_rir — those belong to the weekly plan.
-- target_reps is optional and is a suggestion only, never enforced.

create table v2_program_exercises (
  id             uuid primary key default gen_random_uuid(),
  workout_day_id uuid not null references v2_workout_days(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  exercise_id    uuid not null references exercises(id),
  position       integer not null,    -- 0-based ordering within the day
  target_reps    integer              -- nullable: suggestion only
);

-- ─── v2_mesocycles ────────────────────────────────────────────────────────────
-- One active meso at a time — enforced at the application layer.

create table v2_mesocycles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  program_id uuid not null references v2_programs(id),
  status     text not null default 'active',  -- 'active' | 'completed'
  start_date date not null,
  end_date   date,                            -- set when meso is marked complete
  created_at timestamptz not null default now()
);

-- ─── v2_week_plans ────────────────────────────────────────────────────────────
-- One row per workout day per week of a meso.
-- is_deload applies to the whole week-session, not individual sets.

create table v2_week_plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  mesocycle_id   uuid not null references v2_mesocycles(id) on delete cascade,
  workout_day_id uuid not null references v2_workout_days(id) on delete cascade,
  week_number    integer not null,   -- 1-based week within the meso
  is_deload      boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (mesocycle_id, workout_day_id, week_number)
);

-- ─── v2_week_plan_sets ────────────────────────────────────────────────────────
-- One row per planned set per exercise within a week plan.
-- References program_exercise_id to inherit exercise identity and ordering.
-- ON DELETE CASCADE: removing a program exercise clears its planned sets.

create table v2_week_plan_sets (
  id                  uuid primary key default gen_random_uuid(),
  week_plan_id        uuid not null references v2_week_plans(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  program_exercise_id uuid not null references v2_program_exercises(id) on delete cascade,
  set_number          integer not null,   -- 1-based, per exercise within this plan
  target_rir          integer,            -- nullable: some sets may have no RIR target
  is_dropset          boolean not null default false
);

-- ─── v2_sessions ──────────────────────────────────────────────────────────────
-- Actual gym session. week_plan_id is nullable — valid to start without a plan.

create table v2_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  mesocycle_id   uuid references v2_mesocycles(id) on delete set null,
  week_plan_id   uuid references v2_week_plans(id) on delete set null,
  workout_day_id uuid references v2_workout_days(id) on delete set null,
  date           date not null,          -- the date this session is *for*
  status         text not null,          -- 'planned' | 'in_progress' | 'completed' | 'skipped'
  note           text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- ─── v2_set_logs ──────────────────────────────────────────────────────────────
-- weight and reps are nullable to support skipped sets.
-- check constraint ensures they are non-null unless the set is skipped.
-- parent_set_id links a dropset row back to the main set it follows.

create table v2_set_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid not null references v2_sessions(id) on delete cascade,
  exercise_id       uuid not null references exercises(id),
  week_plan_set_id  uuid references v2_week_plan_sets(id) on delete set null,
  set_number        integer not null,      -- 1-based, per exercise within this session
  weight            numeric(6,2),          -- kg; null only when is_skipped = true
  reps              integer,               -- null only when is_skipped = true
  rir               integer,
  note              text,
  is_dropset        boolean not null default false,
  parent_set_id     uuid references v2_set_logs(id) on delete set null,
  is_skipped        boolean not null default false,
  logged_at         timestamptz not null,
  rest_seconds      integer,               -- computed on client, stored for history
  check (is_skipped = true or (weight is not null and reps is not null))
);

-- ─── v2_user_settings ─────────────────────────────────────────────────────────
-- One row per user, upserted on save. Stored in Supabase so settings persist
-- across devices (accent colour affects CSS custom property on load).

create table v2_user_settings (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  theme                 text not null default 'dark',       -- 'dark' | 'light'
  accent_colour         text not null default '#FF8C42',    -- applied to --accent
  rest_timer_enabled    boolean not null default true,
  buzz_on_rest_complete boolean not null default false,
  target_rest_seconds   integer not null default 120,
  weight_unit           text not null default 'kg',         -- 'kg' | 'lbs'
  updated_at            timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- exercises: indexes already exist from v1.

create index v2_programs_user_id_idx          on v2_programs(user_id);

create index v2_workout_days_program_id_idx   on v2_workout_days(program_id);

create index v2_program_exercises_wday_idx    on v2_program_exercises(workout_day_id);

create index v2_mesocycles_user_status_idx    on v2_mesocycles(user_id, status);

create index v2_week_plans_meso_id_idx        on v2_week_plans(mesocycle_id);
create index v2_week_plans_meso_week_idx      on v2_week_plans(mesocycle_id, week_number);

create index v2_week_plan_sets_plan_id_idx    on v2_week_plan_sets(week_plan_id);
create index v2_week_plan_sets_prog_ex_idx    on v2_week_plan_sets(program_exercise_id);

create index v2_sessions_user_date_idx        on v2_sessions(user_id, date);
create index v2_sessions_user_status_idx      on v2_sessions(user_id, status);
create index v2_sessions_meso_id_idx          on v2_sessions(mesocycle_id);
create index v2_sessions_week_plan_id_idx     on v2_sessions(week_plan_id);

create index v2_set_logs_session_id_idx       on v2_set_logs(session_id);
create index v2_set_logs_exercise_session_idx on v2_set_logs(exercise_id, session_id);
create index v2_set_logs_user_ex_time_idx     on v2_set_logs(user_id, exercise_id, logged_at desc);
create index v2_set_logs_parent_set_idx       on v2_set_logs(parent_set_id);
