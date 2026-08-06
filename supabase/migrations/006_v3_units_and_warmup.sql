-- Overload v3 — per-program-exercise weight unit + warmup flag (expand)
-- Run in Supabase SQL Editor. Safe with the old client still live.
-- See TASKS.md §2.4 and §2.5.

-- ── Weight unit (§2.4) ───────────────────────────────────────────────────────
-- NULL = inherit the global Settings unit. Nullable is load-bearing: a
-- `not null default 'kg'` would freeze every existing row at kg and stop it
-- following a later change to the global setting.
alter table v2_program_exercises
  add column if not exists weight_unit text
    check (weight_unit is null or weight_unit in ('kg','lbs'));

-- The rarely-used logging-time override (SPEC §8.1). Records what the user
-- actually typed; `weight` stays canonical kg. NULL = entered in the resolved
-- default for that program-exercise.
alter table v2_set_logs
  add column if not exists entered_unit text
    check (entered_unit is null or entered_unit in ('kg','lbs'));

-- ── Warmup flag (§2.5) ───────────────────────────────────────────────────────
-- Warmup sets are deferred (SPEC §8.3, no UI yet) — this only reserves the
-- column so e1RM/volume aggregates are written against the real predicate
-- from day one instead of a rewrite later. TASKS.md §5.4 flags this as a
-- judgement call rather than something SPEC.md required; still open as of
-- the 2026-08-05 planning session. Included here because it is what the
-- plan's own migration file (006) specifies — see CONTEXT.md for the note
-- back to the user on this.
alter table v2_week_plan_sets add column if not exists is_warmup boolean not null default false;
alter table v2_set_logs       add column if not exists is_warmup boolean not null default false;
