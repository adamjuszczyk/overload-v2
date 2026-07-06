-- Overload v2 — Row Level Security policies
-- Run after 001_v2_schema.sql.
-- exercises: RLS already enabled and configured from v1.

-- ─── Enable RLS ───────────────────────────────────────────────────────────────

alter table v2_programs          enable row level security;
alter table v2_workout_days      enable row level security;
alter table v2_program_exercises enable row level security;
alter table v2_mesocycles        enable row level security;
alter table v2_week_plans        enable row level security;
alter table v2_week_plan_sets    enable row level security;
alter table v2_sessions          enable row level security;
alter table v2_set_logs          enable row level security;
alter table v2_user_settings     enable row level security;

-- ─── Policies — users access only their own rows ──────────────────────────────

create policy "Users access own rows" on v2_programs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_workout_days
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_program_exercises
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_mesocycles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_week_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_week_plan_sets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users access own rows" on v2_set_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- v2_user_settings: user_id is the PK and the ownership column.
create policy "Users access own rows" on v2_user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
