-- Overload v3 — Coach Personalization phase 3: raw note capture.
-- One new table. Coach Notes is the UNFILTERED input Coach Memory is later
-- built from (SPEC §4) — deliberately not the same thing as Memory, which
-- arrives in 018.

create table v2_coach_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  -- Sidebar-sourced notes carry the session they were written during;
  -- general notes from the Context tab carry null (SPEC §5).
  -- SET NULL, not CASCADE: a note outlives the session it was typed in —
  -- see TASKS.md §2.5. Deliberate divergence from v2_coach_session_analyses'
  -- rule.
  session_id uuid references v2_sessions(id) on delete set null,
  -- Curation watermark (phase 4, landing here on purpose — TASKS.md §9.1).
  -- null = this note has never been through a curation run.
  curated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table v2_coach_notes enable row level security;
create policy "Users access own rows" on v2_coach_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The Context tab's list, newest first.
create index v2_coach_notes_user_idx on v2_coach_notes(user_id, created_at desc);
-- The curation input query: "every note this user has not been curated yet".
-- Partial, because the uncurated set is the only thing ever queried this way
-- and it shrinks to near-zero after each run.
create index v2_coach_notes_uncurated_idx
  on v2_coach_notes(user_id, created_at)
  where curated_at is null;
-- The sidebar's "notes written during this session" list.
create index v2_coach_notes_session_idx on v2_coach_notes(session_id)
  where session_id is not null;
