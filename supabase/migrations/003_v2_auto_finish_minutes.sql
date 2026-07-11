-- Overload v2 — auto-finish session setting
-- Nullable, not "not null": null means the feature is disabled entirely,
-- which the app-level default (5) can't represent on its own.

alter table v2_user_settings
  add column if not exists auto_finish_minutes integer default 5;
