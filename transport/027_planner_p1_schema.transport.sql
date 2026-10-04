-- Overload Planner Extension, phase 1 — the data model (additive).
-- Six new tables, plus new columns on nine existing tables. No existing row
-- changes: every new column is nullable or carries a default that existing
-- rows take as-is, and every new CHECK is satisfied by those defaults/NULLs.
-- No backfill, no function, no change to any existing constraint or policy.
-- Safe with the old client still live: it never names a new column, and every
-- write shape it uses stays valid.
--
-- Not in this migration, on purpose (later chunks): dropping
-- v2_program_exercises.target_reps, relaxing v2_set_logs_check, replacing the
-- v2_week_plans unique key, v2_start_run / v2_plan_week, and the session
-- exercise-order column (phase 2).
--
-- Rollback: drop the six new tables, then the new columns (drop the tables
-- first — v2_program_exercises.superset_block_id and
-- v2_week_plan_sets.program_set_id reference them).
--
-- Conventions kept: v2_ prefix; user_id on every row with the standard
-- "for all using/with check (user_id = auth.uid())" policy; text + CHECK
-- vocabularies; stages as linked rows (parent id + stage_index).

-- ═══ New tables @@R2550x62@@
-- Created before the ALTERs below, because new columns on existing tables
-- point at v2_program_superset_blocks and v2_program_sets.

-- ─── v2_program_sequence_items @@R2500x47@@
-- The ordered cycle of a sequence program. A null workout_day_id is a rest
-- day. One workout may appear more than once, so a slot is identified by its
-- position, never by its workout.

create table v2_program_sequence_items (
  id@@R20x13@@uuid primary key default gen_random_uuid(),
  user_id@@R20x8@@uuid not null references auth.users(id) on delete cascade,
  program_id@@R20x5@@uuid not null references v2_programs(id) on delete cascade,
  position@@R20x7@@integer not null check (position >= 0),
  workout_day_id uuid references v2_workout_days(id) on delete cascade
);

alter table v2_program_sequence_items enable row level security;
create policy "Users access own rows" on v2_program_sequence_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create unique index v2_program_sequence_items_pos_uk
  on v2_program_sequence_items(program_id, position);
-- The unique index above serves program_id lookups; this one serves the
-- workout_day_id cascade.
create index v2_program_sequence_items_wday_idx
  on v2_program_sequence_items(workout_day_id);

-- ─── v2_workout_warmup_items @@R2500x49@@
-- A workout's warmup routine: free-text items in order. Ticks are not stored.

create table v2_workout_warmup_items (
  id@@R20x13@@uuid primary key default gen_random_uuid(),
  user_id@@R20x8@@uuid not null references auth.users(id) on delete cascade,
  workout_day_id uuid not null references v2_workout_days(id) on delete cascade,
  position@@R20x7@@integer not null check (position >= 0),
  body@@R20x11@@text not null check (length(btrim(body)) > 0)
);

alter table v2_workout_warmup_items enable row level security;
create policy "Users access own rows" on v2_workout_warmup_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create unique index v2_workout_warmup_items_pos_uk
  on v2_workout_warmup_items(workout_day_id, position);

-- ─── v2_program_superset_blocks @@R2500x46@@
-- Exercises pointing at the same block (v2_program_exercises.superset_block_id)
-- form one superset. Null rest overrides = the defaults owned by the app.

create table v2_program_superset_blocks (
  id@@R20x26@@uuid primary key default gen_random_uuid(),
  user_id@@R20x21@@uuid not null references auth.users(id) on delete cascade,
  workout_day_id@@R20x14@@uuid not null references v2_workout_days(id) on delete cascade,
  rest_within_round_seconds   integer check (rest_within_round_seconds >= 0),
  rest_after_round_seconds@@R20x4@@integer check (rest_after_round_seconds >= 0),
  created_at@@R20x18@@timestamptz not null default now()
);

alter table v2_program_superset_blocks enable row level security;
create policy "Users access own rows" on v2_program_superset_blocks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index v2_program_superset_blocks_wday_idx
  on v2_program_superset_blocks(workout_day_id);

-- ─── v2_program_sets @@R2500x57@@
-- The program's own sets: the volume of every week for a stable program, week
-- 1's for a week-dependent one. Set kind is not a column: warmup = is_warmup;
-- staged = a head with stage_kind plus stage rows linked by
-- parent_program_set_id + stage_index; working = neither.
-- A stage shares its head's position, so position is not unique.
--
-- Rep target: a number is min = max; a range is min < max; AMRAP is the flag
-- with no numbers; none is all empty.

create table v2_program_sets (
  id@@R20x22@@uuid primary key default gen_random_uuid(),
  user_id@@R20x17@@uuid not null references auth.users(id) on delete cascade,
  program_exercise_id@@R20x5@@uuid not null references v2_program_exercises(id) on delete cascade,
  position@@R20x16@@integer not null check (position > 0),
  is_warmup@@R20x15@@boolean not null default false,

  -- Heads only.
  stage_kind@@R20x14@@text check (stage_kind in ('dropset', 'rest_pause', 'myo_reps', 'cluster')),
  stage_rest_seconds@@R20x6@@integer check (stage_rest_seconds >= 0),

  -- Stages. Cascade, matching v2_week_plan_sets (004): an orphaned stage would
  -- be indistinguishable from a working set.
  parent_program_set_id   uuid references v2_program_sets(id) on delete cascade,
  stage_index@@R20x13@@integer not null default 0,

  rep_min@@R20x17@@integer check (rep_min > 0),
  rep_max@@R20x17@@integer,
  is_amrap@@R20x16@@boolean not null default false,
  rest_seconds@@R20x12@@integer check (rest_seconds >= 0),

  created_at@@R20x14@@timestamptz not null default now(),

  constraint v2_program_sets_rep_max_check
@@R20x4@@check (rep_max is null or (rep_min is not null and rep_max >= rep_min)),
  constraint v2_program_sets_amrap_check
@@R20x4@@check (not is_amrap or (rep_min is null and rep_max is null)),
  -- stage_index = 0 exactly when there is no parent.
  constraint v2_program_sets_stage_index_check
@@R20x4@@check ((parent_program_set_id is null and stage_index = 0)
@@R20x8@@or (parent_program_set_id is not null and stage_index > 0)),
  -- A stage carries no kind, stage rest or warmup flag of its own.
  constraint v2_program_sets_stage_row_check
@@R20x4@@check (parent_program_set_id is null
@@R20x8@@or (stage_kind is null and stage_rest_seconds is null and not is_warmup)),
  -- A warmup is never staged.
  constraint v2_program_sets_warmup_check
@@R20x4@@check (not is_warmup or (stage_kind is null and parent_program_set_id is null))
);

alter table v2_program_sets enable row level security;
create policy "Users access own rows" on v2_program_sets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index v2_program_sets_prog_ex_idx
  on v2_program_sets(program_exercise_id, position);
create index v2_program_sets_parent_idx
  on v2_program_sets(parent_program_set_id);

-- ─── v2_program_priorities @@R2500x51@@
-- Training-priority marks per program (saved programs and runs' copies). No
-- row = normal. tag_value's vocabulary stays owned by priorityTags.ts /
-- exerciseTags.ts, as in 024. The old v2_coach_meso_tag_priorities is left
-- untouched as completed runs' history.

create table v2_program_priorities (
  id@@R20x10@@uuid primary key default gen_random_uuid(),
  user_id@@R20x5@@uuid not null references auth.users(id) on delete cascade,
  program_id  uuid not null references v2_programs(id) on delete cascade,
  tag_type@@R20x4@@text not null check (tag_type in ('muscle_group', 'muscle_subgroup')),
  tag_value   text not null check (length(btrim(tag_value)) > 0),
  mark@@R20x8@@text not null check (mark in ('focus', 'dont_care')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table v2_program_priorities enable row level security;
create policy "Users access own rows" on v2_program_priorities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The upsert target. user_id leads, as in 024, so it also serves "all of this
-- user's marks"; program_id gets its own index for the cascade.
create unique index v2_program_priorities_tag_uk
  on v2_program_priorities(user_id, program_id, tag_type, tag_value);
create index v2_program_priorities_program_idx
  on v2_program_priorities(program_id);

-- ─── v2_week_plan_exercises @@R2500x50@@
-- The exercises as planned for one week-plan row. Planned sets keep linking by
-- (week_plan_id, program_exercise_id), so the unique key below is what keeps
-- that link unambiguous.

create table v2_week_plan_exercises (
  id@@R20x26@@uuid primary key default gen_random_uuid(),
  user_id@@R20x21@@uuid not null references auth.users(id) on delete cascade,
  week_plan_id@@R20x16@@uuid not null references v2_week_plans(id) on delete cascade,
  program_exercise_id@@R20x9@@uuid not null references v2_program_exercises(id) on delete cascade,
  position@@R20x20@@integer not null check (position >= 0),

  -- What copying forward uses; null = program_exercise_id / position.
  carry_program_exercise_id   uuid references v2_program_exercises(id) on delete set null,
  carry_position@@R20x14@@integer,

  created_at@@R20x18@@timestamptz not null default now()
);

alter table v2_week_plan_exercises enable row level security;
create policy "Users access own rows" on v2_week_plan_exercises
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create unique index v2_week_plan_exercises_plan_ex_uk
  on v2_week_plan_exercises(week_plan_id, program_exercise_id);
create index v2_week_plan_exercises_prog_ex_idx
  on v2_week_plan_exercises(program_exercise_id);
create index v2_week_plan_exercises_carry_idx
  on v2_week_plan_exercises(carry_program_exercise_id);

-- ═══ New columns on existing tables @@R2550x42@@
-- One ALTER per table. Every CHECK is on the new column itself (column-level,
-- so `add column if not exists` keeps the statement re-runnable) and is
-- satisfied by that column's default or NULL, so no existing row is affected.
-- A CHECK like `>= 0` passes NULL, so nullable columns stay nullable.

-- ─── v2_programs @@R2500x61@@
-- Existing programs become saved / weekday / week-dependent: exactly how they
-- behave today (weeks hold the sets; you copy forward).
alter table v2_programs
  add column if not exists kind text not null default 'saved'
@@R20x4@@check (kind in ('saved', 'run')),
  add column if not exists schedule_type text not null default 'weekday'
@@R20x4@@check (schedule_type in ('weekday', 'sequence')),
  add column if not exists planning_type text not null default 'week_dependent'
@@R20x4@@check (planning_type in ('stable', 'week_dependent')),
  -- Null = use the global default (v2_user_settings.deload_rules); an object =
  -- this program's override. Shape validated in app code.
  add column if not exists deload_rules jsonb;

-- ─── v2_workout_days @@R2500x57@@
-- On a run's copy: the saved program's workout it came from.
alter table v2_workout_days
  add column if not exists source_workout_day_id uuid
@@R20x4@@references v2_workout_days(id) on delete set null;

create index if not exists v2_workout_days_source_idx
  on v2_workout_days(source_workout_day_id);

-- ─── v2_mesocycles @@R2500x59@@
-- program_id stays the run's own copy; this is the saved program it started from.
alter table v2_mesocycles
  add column if not exists source_program_id uuid
@@R20x4@@references v2_programs(id) on delete set null;

create index if not exists v2_mesocycles_source_program_idx
  on v2_mesocycles(source_program_id);

-- ─── v2_program_exercises @@R2500x52@@
-- target_reps stays for now (dropped in a later chunk).
alter table v2_program_exercises
  add column if not exists superset_block_id uuid
@@R20x4@@references v2_program_superset_blocks(id) on delete set null,
  add column if not exists rest_seconds integer
@@R20x4@@check (rest_seconds >= 0),
  add column if not exists rest_after_seconds integer
@@R20x4@@check (rest_after_seconds >= 0),
  -- Format (four fields, digits or X) is validated in app code.
  add column if not exists tempo text
@@R20x4@@check (char_length(tempo) <= 20),
  -- Run copies only: a slot created by a week edit, hidden from the program tab.
  add column if not exists week_only boolean not null default false,
  -- Run copies only: removed from the run's program; planned weeks keep their rows.
  add column if not exists removed_at timestamptz;

create index if not exists v2_program_exercises_block_idx
  on v2_program_exercises(superset_block_id);

-- ─── v2_week_plans @@R2500x59@@
-- Plain nullable columns, no constraint.
alter table v2_week_plans
  -- Sequence runs: which slot of the cycle this planned session is (week_number
  -- is the cycle index). Null for weekday runs.
  add column if not exists sequence_position integer,
  -- The planned sets as they were before deload rules recalculated them, so
  -- unmarking the deload restores them.
  add column if not exists deload_restore jsonb;

-- ─── v2_week_plan_sets @@R2500x55@@
-- Rep-target columns mirror v2_program_sets; copied from the source set when
-- the week is planned, and editing them is the week's override.
alter table v2_week_plan_sets
  add column if not exists program_set_id uuid
@@R20x4@@references v2_program_sets(id) on delete set null,
  -- Heads only.
  add column if not exists stage_kind text
@@R20x4@@check (stage_kind in ('dropset', 'rest_pause', 'myo_reps', 'cluster'))
@@R20x4@@constraint v2_week_plan_sets_stage_row_check
@@R20x6@@check (parent_week_plan_set_id is null or stage_kind is null),
  -- kg; week plan only, never in the program.
  add column if not exists target_weight numeric(6,2)
@@R20x4@@check (target_weight >= 0),
  add column if not exists rep_min integer
@@R20x4@@check (rep_min > 0),
  add column if not exists rep_max integer
@@R20x4@@constraint v2_week_plan_sets_rep_max_check
@@R20x6@@check (rep_max is null or (rep_min is not null and rep_max >= rep_min)),
  add column if not exists is_amrap boolean not null default false
@@R20x4@@constraint v2_week_plan_sets_amrap_check
@@R20x6@@check (not is_amrap or (rep_min is null and rep_max is null)),
  -- Never copied forward; several per set allowed.
  add column if not exists tags text[];

create index if not exists v2_week_plan_sets_program_set_idx
  on v2_week_plan_sets(program_set_id);

-- ─── v2_sessions @@R2500x61@@
-- Weekday runs: the day the session was moved to. `date` keeps meaning "the
-- date this session is for".
alter table v2_sessions
  add column if not exists moved_to_date date;

-- ─── v2_set_logs @@R2500x61@@
-- On a staged head, "as planned".
alter table v2_set_logs
  add column if not exists stage_kind text
@@R20x4@@check (stage_kind in ('dropset', 'rest_pause', 'myo_reps', 'cluster'))
@@R20x4@@constraint v2_set_logs_stage_row_check
@@R20x6@@check (parent_set_id is null or stage_kind is null);

-- ─── v2_user_settings @@R2500x56@@
-- The old client's full-row upsert never names these, so on conflict it leaves
-- them as they are.
alter table v2_user_settings
  add column if not exists warmup_display text not null default 'rows'
@@R20x4@@check (warmup_display in ('rows', 'tick')),
  -- Null = no rules switched on. Shape validated in app code.
  add column if not exists deload_rules jsonb,
  -- How a new week starts: copy the previous one, or empty. Copy for new and
  -- existing users.
  add column if not exists week_start text not null default 'copy'
@@R20x4@@check (week_start in ('copy', 'empty'));

-- Make PostgREST pick up the new tables and columns.
notify pgrst, 'reload schema';
