-- Overload v3 — Coach Personalization phase 4: Coach Memory + curation runs.
-- Two new tables. v2_coach_memory_entries is the curated, standing store the
-- daily analysis prompt reads in full (phase 5); v2_coach_notes (016) is
-- never rewritten by curation, only its curated_at watermark advances
-- (TASKS.md §9.1/§9.2). v2_coach_curation_runs is provenance for a process
-- that mutates a store instead of appending a permanent record — the one
-- table this plan adds that COACH-PERSONALIZATION-SPEC.md does not itself
-- name (TASKS.md §7.6).

create table v2_coach_memory_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  source     text not null check (source in ('curation', 'manual')),
  -- Soft expiry, not delete: curation "lets something expire" (SPEC §4),
  -- not deletes it — an expired entry stays visible/restorable. The user's
  -- own delete is a real, separate, hard delete (TASKS §9.4) — there is
  -- deliberately no 'deleted' value here.
  status     text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2_coach_curation_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  input_snapshot jsonb   not null,   -- exactly what the model was shown (CurationInput)
  decisions      jsonb   not null,   -- exactly what it returned, unfiltered (CurationDecision[])
  applied        jsonb   not null,   -- what code actually did with it, after id validation (CurationApplied)
  model          text    not null,   -- response.model, not the request constant
  prompt_version integer not null default 1,
  input_tokens   integer,
  output_tokens  integer,
  note_count     integer not null,
  created_at     timestamptz not null default now()
);

alter table v2_coach_memory_entries enable row level security;
create policy "Users access own rows" on v2_coach_memory_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table v2_coach_curation_runs enable row level security;
create policy "Users access own rows" on v2_coach_curation_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Coach Memory's own view (list, active by default) plus the payload
-- curation reads (status = 'active', oldest first, §5.3 step 5).
create index v2_coach_memory_entries_user_idx
  on v2_coach_memory_entries(user_id, status, created_at);

-- The run history list, newest first.
create index v2_coach_curation_runs_user_idx
  on v2_coach_curation_runs(user_id, created_at desc);
