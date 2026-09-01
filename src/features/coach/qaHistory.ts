import type { QaCategory } from '../../types/index.js'

// Multi-turn cost control's pure core (QA-SIDEBAR-SPEC.md §6, TASKS §6).
// Every function here operates on whatever rows array it's given — no
// database access, no network. The one real query this closes (TASKS §6.2)
// does four jobs in one round trip; these are that same logic's four pure
// pieces, independently testable:
//
//   select turn_index, category, session_id, question, answer
//     from v2_coach_qa_exchanges
//    where user_id = ? and conversation_id = ?
//    order by turn_index desc
//    limit HISTORY_TURN_CAP
//
// Callers (api/coach/ask.ts, Phase 5) fetch at most HISTORY_TURN_CAP rows
// via that query's own `.order(...).limit(...)` — but every function below
// re-sorts and re-caps defensively rather than trusting that ordering/
// limiting already held. The cap being genuinely unforgeable (TASKS §6.2)
// should hold even against a future bug in this codebase's own fetch
// layer, not just against a malicious client.

// TASKS §6.1 item 1 / §5.5 item 4 — starting values, not tuned (TASKS §10
// A9); spec §7 explicitly defers tuning to real usage. `history_turns_sent`
// (migration 023) is what makes that tuning data-driven later.
export const HISTORY_TURN_CAP = 4
export const MAX_TURNS_PER_CONVERSATION = 20

export interface QaHistoryRow {
  turnIndex: number
  category: QaCategory
  sessionId: string | null
  question: string
  answer: string
}

export interface QaHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

function sortNewestFirst(rows: QaHistoryRow[]): QaHistoryRow[] {
  return [...rows].sort((a, b) => b.turnIndex - a.turnIndex)
}

// The newest row by turn_index, or null for a brand-new conversation
// (turn 0, no history yet).
export function newestRow(rows: QaHistoryRow[]): QaHistoryRow | null {
  if (rows.length === 0) return null
  return sortNewestFirst(rows)[0]
}

// The next turn_index to assign — 0 for a brand-new conversation, otherwise
// the newest row's turn_index + 1. turn_index is contiguous from 0 by
// construction (migration 023's unique index enforces it), so this number
// doubles as the conversation's turn count so far — exactly what
// hasReachedTurnLimit checks against (TASKS §6.2).
export function nextTurnIndex(rows: QaHistoryRow[]): number {
  const newest = newestRow(rows)
  return newest === null ? 0 : newest.turnIndex + 1
}

// True once assigning the next turn would put the conversation at or past
// MAX_TURNS_PER_CONVERSATION (TASKS §5.5 item 4) — a 409 at this point,
// never an insert attempt.
export function hasReachedTurnLimit(
  rows: QaHistoryRow[],
  maxTurns: number = MAX_TURNS_PER_CONVERSATION,
): boolean {
  return nextTurnIndex(rows) >= maxTurns
}

// The rolling window, oldest-first, as alternating user/assistant messages
// (TASKS §6.1 item 1) — capped to HISTORY_TURN_CAP here, not merely assumed
// from the caller's own LIMIT clause, so this function is itself the real
// enforcement point of "don't resend the full conversation," not just a
// formatter trusting someone else already enforced it.
export function buildHistoryMessages(
  rows: QaHistoryRow[],
  cap: number = HISTORY_TURN_CAP,
): QaHistoryMessage[] {
  const windowed = sortNewestFirst(rows).slice(0, cap).reverse()
  return windowed.flatMap((row) => [
    { role: 'user' as const, content: row.question },
    { role: 'assistant' as const, content: row.answer },
  ])
}

// SPEC §3 / TASKS §7.1 — a conversation's category, and (for in_session)
// its session id, are fixed at turn 0 and must never change turn to turn.
// Checking the newest row alone is sufficient: invariance holds inductively
// (TASKS §6.2) — if the newest row agrees with the request, every row
// before it does too, since each of those rows was itself once "the
// newest" and passed this same check.
export interface QaInvarianceViolation {
  field: 'category' | 'sessionId'
  expected: string | null
  actual: string | null
}

export function checkInvariance(
  rows: QaHistoryRow[],
  request: { category: QaCategory; sessionId: string | null },
): QaInvarianceViolation | null {
  const newest = newestRow(rows)
  if (newest === null) return null // turn 0 — nothing to be invariant with yet

  if (newest.category !== request.category) {
    return { field: 'category', expected: newest.category, actual: request.category }
  }
  if (newest.sessionId !== request.sessionId) {
    return { field: 'sessionId', expected: newest.sessionId, actual: request.sessionId }
  }
  return null
}
