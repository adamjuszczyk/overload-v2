-- Overload v3 — Priority Context: per-mesocycle, per-tag training priority.
-- One new table. No changes to any existing table.
-- PRIORITY-CONTEXT-SPEC.md §4, as revised per-mesocycle — see
-- PRIORITY-CONTEXT-TASKS.md §0.3 for the deliberate divergence from the
-- spec's global-row wording. Adam-set only: nothing in this feature or any
-- consumer writes here from a model (SPEC §2).

create table v2_coach_meso_tag_priorities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  -- Priority is scoped to one training block. Cascade, matching
  -- v2_week_plans and deliberately not v2_sessions' set-null: this is
  -- planning intent, not history, and is meaningless without its meso
  -- (TASKS §2.2).
  mesocycle_id uuid not null references v2_mesocycles(id) on delete cascade,

  -- Which vocabulary tag_value belongs to (SPEC §4).
  tag_type     text not null check (tag_type in ('muscle_group', 'muscle_subgroup')),

  -- A value from src/lib/exerciseTags.ts (subgroups) or the MuscleGroup type
  -- (groups). Deliberately NOT CHECK-constrained — the same asymmetry
  -- migrations 013 vs 014 established and exerciseTags.ts documents, so the
  -- vocabulary stays owned by one module instead of half-copied into DDL.
  -- TASKS §2.3.
  tag_value    text not null check (length(btrim(tag_value)) > 0),

  -- SPEC §2's four levels. 'normal' is a real value, not an unset state —
  -- absence of a row is what means "not set for this meso" (TASKS §2.4), and
  -- the two stay distinguishable via isExplicit downstream.
  priority     text not null default 'normal'
                 check (priority in ('low', 'normal', 'high', 'top')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table v2_coach_meso_tag_priorities enable row level security;
create policy "Users access own rows" on v2_coach_meso_tag_priorities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One row per (user, meso, tag_type, tag_value). This is the upsert target,
-- not just an integrity guard (TASKS §2.6). user_id leads rather than
-- mesocycle_id so the index also serves any future "all of this user's
-- priority rows" read without a second index.
create unique index v2_coach_meso_tag_priorities_tag_uk
  on v2_coach_meso_tag_priorities(user_id, mesocycle_id, tag_type, tag_value);
