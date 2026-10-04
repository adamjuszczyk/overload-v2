-- 000 — Overload v1 baseline
--
-- What Overload v1 created on this Supabase project before migration 001 ran:
-- six tables, their keys, indexes, row-level security and grants. v1's own
-- migrations were never in this repo, and 001 begins "Run … after 001/002 from
-- v1 have been applied", so without this file a from-scratch replay (the
-- migration-replay check) can't build the schema.
--
-- Production: this file is marked applied in supabase_migrations.schema_migrations
-- (`supabase migration repair --status applied 000`) and never runs there.
--
-- Derived from the live schema dump of 2026-10-04 (`supabase db dump`, project
-- on supabase/postgres 17.6.1.155), minus everything 001–026 add:
--   - exercises.muscle_subgroup, .movement_pattern and their two CHECKs (013);
--   - exercises.status, .source_library_id, .lost_at, their two CHECKs and the
--     FK to v2_exercise_libraries (019).
-- exercises.muscle_group stays: it is v1's (4th column, NOT NULL, indexed by
-- v1's exercises_user_muscle_idx); 001's `add column if not exists` was a no-op.
-- Northstar / Atlas tables (ns_*, atlas_*) share this project but are not
-- Overload's and are left out on purpose (MIGRATION-SWITCH.md, C2).
--
-- Proven by replaying this file then 001–026 on an empty supabase/postgres and
-- comparing with the live schema (scripts/compare-schema.mjs). Never edit it:
-- it is applied history.

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table public.exercises (
  id           uuid        not null default gen_random_uuid(),
  user_id      uuid        not null,
  name         text        not null,
  muscle_group text        not null,
  is_archived  boolean     not null default false,
  created_at   timestamptz not null default now(),
  constraint exercises_pkey primary key (id),
  constraint exercises_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.programs (
  id         uuid        not null default gen_random_uuid(),
  user_id    uuid        not null,
  name       text        not null,
  is_active  boolean     not null default false,
  schedule   jsonb       not null default '{}'::jsonb,
  started_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programs_pkey primary key (id),
  constraint programs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.workout_days (
  id         uuid    not null default gen_random_uuid(),
  program_id uuid    not null,
  user_id    uuid    not null,
  name       text    not null,
  position   integer not null,
  constraint workout_days_pkey primary key (id),
  constraint workout_days_program_id_fkey foreign key (program_id) references public.programs(id) on delete cascade,
  constraint workout_days_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.program_exercises (
  id             uuid    not null default gen_random_uuid(),
  workout_day_id uuid    not null,
  user_id        uuid    not null,
  exercise_id    uuid    not null,
  position       integer not null,
  target_sets    integer not null,
  target_reps    integer not null,
  target_rir     integer,
  constraint program_exercises_pkey primary key (id),
  constraint program_exercises_exercise_id_fkey foreign key (exercise_id) references public.exercises(id),
  constraint program_exercises_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint program_exercises_workout_day_id_fkey foreign key (workout_day_id) references public.workout_days(id) on delete cascade
);

create table public.sessions (
  id             uuid        not null default gen_random_uuid(),
  user_id        uuid        not null,
  program_id     uuid,
  workout_day_id uuid,
  date           date        not null,
  status         text        not null,
  note           text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint sessions_pkey primary key (id),
  constraint sessions_program_id_fkey foreign key (program_id) references public.programs(id) on delete set null,
  constraint sessions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint sessions_workout_day_id_fkey foreign key (workout_day_id) references public.workout_days(id) on delete set null
);

create table public.set_logs (
  id           uuid         not null default gen_random_uuid(),
  user_id      uuid         not null,
  session_id   uuid         not null,
  exercise_id  uuid         not null,
  set_number   integer      not null,
  weight       numeric(6,2) not null,
  reps         integer      not null,
  rir          integer,
  note         text,
  logged_at    timestamptz  not null,
  rest_seconds integer,
  constraint set_logs_pkey primary key (id),
  constraint set_logs_exercise_id_fkey foreign key (exercise_id) references public.exercises(id),
  constraint set_logs_session_id_fkey foreign key (session_id) references public.sessions(id) on delete cascade,
  constraint set_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

create index exercises_user_id_idx           on public.exercises         using btree (user_id);
create index exercises_user_muscle_idx       on public.exercises         using btree (user_id, muscle_group);
create index programs_user_id_idx            on public.programs          using btree (user_id);
create index programs_user_active_idx        on public.programs          using btree (user_id, is_active);
create index workout_days_program_id_idx     on public.workout_days      using btree (program_id);
create index program_exercises_wday_id_idx   on public.program_exercises using btree (workout_day_id);
create index sessions_user_date_idx          on public.sessions          using btree (user_id, date);
create index sessions_user_status_idx        on public.sessions          using btree (user_id, status);
create index sessions_workout_day_id_idx     on public.sessions          using btree (workout_day_id);
create index set_logs_exercise_session_idx   on public.set_logs          using btree (exercise_id, session_id);
create index set_logs_session_id_idx         on public.set_logs          using btree (session_id);
create index set_logs_user_exercise_time_idx on public.set_logs          using btree (user_id, exercise_id, logged_at desc);

-- ─── Row-level security ──────────────────────────────────────────────────────

alter table public.exercises         enable row level security;
alter table public.programs          enable row level security;
alter table public.workout_days      enable row level security;
alter table public.program_exercises enable row level security;
alter table public.sessions          enable row level security;
alter table public.set_logs          enable row level security;

create policy "Users access own rows" on public.exercises
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users access own rows" on public.programs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users access own rows" on public.workout_days
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users access own rows" on public.program_exercises
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users access own rows" on public.sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users access own rows" on public.set_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- As live. Supabase's default privileges grant the same on a normal project;
-- spelled out so the file doesn't depend on them.

grant all on table public.exercises         to anon, authenticated, service_role;
grant all on table public.programs          to anon, authenticated, service_role;
grant all on table public.workout_days      to anon, authenticated, service_role;
grant all on table public.program_exercises to anon, authenticated, service_role;
grant all on table public.sessions          to anon, authenticated, service_role;
grant all on table public.set_logs          to anon, authenticated, service_role;
