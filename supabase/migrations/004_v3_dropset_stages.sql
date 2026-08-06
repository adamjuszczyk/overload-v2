-- Overload v3 — dropset restructure (expand)
-- Run in Supabase SQL Editor. Safe with the old client still live: nullable/
-- defaulted columns only, no backfill, no constraint tightening.
-- See TASKS.md §2.1.

-- ── Plan side ────────────────────────────────────────────────────────────────
-- A planned set becomes a group: one head row plus ordered stage rows.
-- CASCADE, not SET NULL: an orphaned stage would be indistinguishable from a
-- main working set and would silently enter e1RM and volume as a top set.
alter table v2_week_plan_sets
  add column if not exists parent_week_plan_set_id uuid
    references v2_week_plan_sets(id) on delete cascade,
  add column if not exists stage_index integer not null default 0;

-- ── Log side ─────────────────────────────────────────────────────────────────
-- parent_set_id already exists but is universally NULL (AUDIT M5). Only the
-- ordering column is new here; the FK behaviour is changed in 009 (contract).
alter table v2_set_logs
  add column if not exists stage_index integer not null default 0;

create index if not exists v2_week_plan_sets_parent_idx
  on v2_week_plan_sets(parent_week_plan_set_id);
-- v2_set_logs_parent_set_idx already exists from 001.
