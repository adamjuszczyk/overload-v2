-- Overload v3 — AI Q&A Sidebar: the permanent exchange log.
-- One new table. No changes to any existing table.
-- QA-SIDEBAR-SPEC.md §5. Advisory only: nothing in this feature writes
-- anywhere else (QA-SIDEBAR-TASKS.md §1.3).

create table v2_coach_qa_exchanges (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,

  -- Grouping key for one continuous chat (SPEC §5). Client-minted uuid, no
  -- conversations table by design — TASKS §2.2.
  conversation_id    uuid not null,
  -- 0-based position within the conversation. Server-assigned from the
  -- conversation's own max, never client-supplied — TASKS §6.2.
  turn_index         integer not null check (turn_index >= 0),

  -- SPEC §3's four categories. Decided by the originating UI, never by the
  -- model (TASKS §7). Invariant within one conversation_id (TASKS §7.1),
  -- enforced server-side.
  category           text not null check (category in
                       ('in_session','general','planning','app_mechanics')),

  question           text not null check (length(btrim(question)) > 0),
  answer             text not null check (length(btrim(answer)) > 0),
  -- Exactly what the model was shown for this exchange (SPEC §5), same role
  -- input_snapshot plays on both analysis tables.
  context_snapshot   jsonb not null,

  -- In-session conversations are linked to the workout session (SPEC §5).
  -- SET NULL, not CASCADE: an exchange outlives the session it was asked
  -- during, same rule as v2_coach_notes and a deliberate divergence from
  -- v2_coach_session_analyses — TASKS §2.3.
  session_id         uuid references v2_sessions(id) on delete set null,

  -- Provenance, identical shape to migrations 012/013/018.
  model              text not null,
  prompt_version     integer not null default 1,
  input_tokens       integer,
  output_tokens      integer,
  -- How many prior turns were actually resent on this call, so the multi-turn
  -- cost cap is auditable from data — TASKS §6.2.
  history_turns_sent integer not null check (history_turns_sent >= 0),

  created_at         timestamptz not null default now()
);

alter table v2_coach_qa_exchanges enable row level security;

-- Deliberate divergence from the standing `for all` policy: no update and no
-- delete policy exists, which makes SPEC §5's "permanent, not deletable"
-- structural rather than merely un-offered — TASKS §2.4.
create policy "Users read own rows" on v2_coach_qa_exchanges
  for select using (user_id = auth.uid());
create policy "Users insert own rows" on v2_coach_qa_exchanges
  for insert with check (user_id = auth.uid());

-- One row per turn, and the index the history-window read uses (TASKS §6.2).
-- user_id-scoped rather than (conversation_id, turn_index) so a client-minted
-- conversation_id can never collide across accounts.
create unique index v2_coach_qa_exchanges_turn_uk
  on v2_coach_qa_exchanges(user_id, conversation_id, turn_index);

-- Read-back by recency across all conversations (TASKS §11).
create index v2_coach_qa_exchanges_user_idx
  on v2_coach_qa_exchanges(user_id, created_at desc);

-- "Everything asked during this session", the one query the in-workout surface
-- needs that the turn index does not serve. Partial, because a non-in_session
-- exchange always has a null session_id.
create index v2_coach_qa_exchanges_session_idx
  on v2_coach_qa_exchanges(session_id)
  where session_id is not null;
