-- Overload v3 — set timing (optional Start Set flow) (expand)
-- Run in Supabase SQL Editor. Safe with the old client still live.
-- See TASKS.md §2.2.

-- Duration of the set itself, in seconds. NULL = not measured (the toggle was
-- off, or the row predates the feature). This NULL is also the discriminator
-- that lets set-duration charts skip sessions without the data, per SPEC §4.2.
alter table v2_set_logs
  add column if not exists set_seconds integer;

-- Global setting, per SPEC §4.2 — not per-session, not per-exercise.
alter table v2_user_settings
  add column if not exists measure_set_time boolean not null default false;
