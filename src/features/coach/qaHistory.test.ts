import { describe, it, expect } from 'vitest'
import {
  newestRow,
  nextTurnIndex,
  hasReachedTurnLimit,
  buildHistoryMessages,
  checkInvariance,
  HISTORY_TURN_CAP,
  MAX_TURNS_PER_CONVERSATION,
  type QaHistoryRow,
} from './qaHistory'

function makeRow(overrides: Partial<QaHistoryRow>): QaHistoryRow {
  return {
    turnIndex: 0,
    category: 'general',
    sessionId: null,
    question: 'q',
    answer: 'a',
    ...overrides,
  }
}

describe('newestRow', () => {
  it('returns null for an empty conversation (turn 0)', () => {
    expect(newestRow([])).toBeNull()
  })

  it('returns the row with the highest turnIndex, regardless of input order', () => {
    const rows = [
      makeRow({ turnIndex: 1, question: 'second' }),
      makeRow({ turnIndex: 0, question: 'first' }),
      makeRow({ turnIndex: 3, question: 'fourth' }),
      makeRow({ turnIndex: 2, question: 'third' }),
    ]
    expect(newestRow(rows)?.question).toBe('fourth')
  })

  it('does not mutate the input array', () => {
    const rows = [makeRow({ turnIndex: 1 }), makeRow({ turnIndex: 0 })]
    const copy = [...rows]
    newestRow(rows)
    expect(rows).toEqual(copy)
  })
})

describe('nextTurnIndex', () => {
  it('is 0 for a brand-new conversation', () => {
    expect(nextTurnIndex([])).toBe(0)
  })

  it('is the newest row turnIndex + 1', () => {
    const rows = [makeRow({ turnIndex: 0 }), makeRow({ turnIndex: 1 }), makeRow({ turnIndex: 2 })]
    expect(nextTurnIndex(rows)).toBe(3)
  })

  it('is correct even when the history array was truncated to HISTORY_TURN_CAP', () => {
    // A 25-turn conversation, but the DB query only ever returns the newest
    // HISTORY_TURN_CAP rows (turn_index desc, limit HISTORY_TURN_CAP) — the
    // newest row's own turnIndex is unaffected by how many rows were fetched.
    const rows = [makeRow({ turnIndex: 24 }), makeRow({ turnIndex: 23 }), makeRow({ turnIndex: 22 }), makeRow({ turnIndex: 21 })]
    expect(nextTurnIndex(rows)).toBe(25)
  })
})

describe('hasReachedTurnLimit', () => {
  it('is false well below the ceiling', () => {
    const rows = [makeRow({ turnIndex: 0 }), makeRow({ turnIndex: 1 })]
    expect(hasReachedTurnLimit(rows)).toBe(false)
  })

  it('is false one turn short of the ceiling', () => {
    // MAX_TURNS_PER_CONVERSATION turns already exist as 0..(MAX-2) would
    // mean nextTurnIndex = MAX-1, still one turn of room left.
    const rows = [makeRow({ turnIndex: MAX_TURNS_PER_CONVERSATION - 2 })]
    expect(nextTurnIndex(rows)).toBe(MAX_TURNS_PER_CONVERSATION - 1)
    expect(hasReachedTurnLimit(rows)).toBe(false)
  })

  it('is true exactly at the ceiling', () => {
    const rows = [makeRow({ turnIndex: MAX_TURNS_PER_CONVERSATION - 1 })]
    expect(nextTurnIndex(rows)).toBe(MAX_TURNS_PER_CONVERSATION)
    expect(hasReachedTurnLimit(rows)).toBe(true)
  })

  it('is true past the ceiling too', () => {
    const rows = [makeRow({ turnIndex: MAX_TURNS_PER_CONVERSATION + 5 })]
    expect(hasReachedTurnLimit(rows)).toBe(true)
  })

  it('respects a custom maxTurns override', () => {
    const rows = [makeRow({ turnIndex: 1 })]
    expect(hasReachedTurnLimit(rows, 2)).toBe(true)
    expect(hasReachedTurnLimit(rows, 3)).toBe(false)
  })
})

describe('buildHistoryMessages', () => {
  it('returns an empty array for a brand-new conversation', () => {
    expect(buildHistoryMessages([])).toEqual([])
  })

  it('orders oldest-first as alternating user/assistant messages', () => {
    const rows = [
      makeRow({ turnIndex: 1, question: 'q1', answer: 'a1' }),
      makeRow({ turnIndex: 0, question: 'q0', answer: 'a0' }),
    ]
    expect(buildHistoryMessages(rows)).toEqual([
      { role: 'user', content: 'q0' },
      { role: 'assistant', content: 'a0' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ])
  })

  it('caps to HISTORY_TURN_CAP even when given more rows than that', () => {
    const rows = Array.from({ length: HISTORY_TURN_CAP + 3 }, (_, i) =>
      makeRow({ turnIndex: i, question: `q${i}`, answer: `a${i}` }),
    )
    const messages = buildHistoryMessages(rows)
    expect(messages).toHaveLength(HISTORY_TURN_CAP * 2)
    // The kept turns are the most recent HISTORY_TURN_CAP, still oldest-first.
    const keptTurns = Array.from({ length: HISTORY_TURN_CAP }, (_, i) => i + 3)
    expect(messages.map((m) => m.content)).toEqual(
      keptTurns.flatMap((t) => [`q${t}`, `a${t}`]),
    )
  })

  it('is itself the enforcement point of the cap, not just a formatter — this is the property TASKS §6.1 relies on for flat per-turn cost', () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeRow({ turnIndex: i }))
    expect(buildHistoryMessages(rows).length).toBeLessThanOrEqual(HISTORY_TURN_CAP * 2)
  })

  it('respects a custom cap override', () => {
    const rows = Array.from({ length: 6 }, (_, i) => makeRow({ turnIndex: i, question: `q${i}`, answer: `a${i}` }))
    expect(buildHistoryMessages(rows, 2)).toEqual([
      { role: 'user', content: 'q4' },
      { role: 'assistant', content: 'a4' },
      { role: 'user', content: 'q5' },
      { role: 'assistant', content: 'a5' },
    ])
  })
})

describe('checkInvariance', () => {
  it('returns null for a brand-new conversation (turn 0) — nothing to be invariant with yet', () => {
    expect(checkInvariance([], { category: 'planning', sessionId: null })).toBeNull()
  })

  it('returns null when category and sessionId both match the newest row', () => {
    const rows = [makeRow({ turnIndex: 0, category: 'in_session', sessionId: 's1' })]
    expect(checkInvariance(rows, { category: 'in_session', sessionId: 's1' })).toBeNull()
  })

  it('flags a category mismatch', () => {
    const rows = [makeRow({ turnIndex: 0, category: 'planning', sessionId: null })]
    expect(checkInvariance(rows, { category: 'general', sessionId: null })).toEqual({
      field: 'category',
      expected: 'planning',
      actual: 'general',
    })
  })

  it('flags a sessionId mismatch on an otherwise-matching category', () => {
    const rows = [makeRow({ turnIndex: 0, category: 'in_session', sessionId: 'session-a' })]
    expect(checkInvariance(rows, { category: 'in_session', sessionId: 'session-b' })).toEqual({
      field: 'sessionId',
      expected: 'session-a',
      actual: 'session-b',
    })
  })

  it('checks category before sessionId when both differ', () => {
    const rows = [makeRow({ turnIndex: 0, category: 'planning', sessionId: null })]
    const violation = checkInvariance(rows, { category: 'in_session', sessionId: 'session-a' })
    expect(violation?.field).toBe('category')
  })

  it('checks the newest row only, not every row in history', () => {
    // turnIndex 0's category is stored as 'general' here purely to prove
    // the function never inspects it — real data can never actually reach
    // this shape, since invariance is enforced turn by turn as each row is
    // written (TASKS §6.2's "holds inductively" argument). What matters is
    // that only the newest row (turnIndex 1) is compared against the
    // request, whatever an older row happens to contain.
    const rows = [
      makeRow({ turnIndex: 0, category: 'general', sessionId: null }),
      makeRow({ turnIndex: 1, category: 'planning', sessionId: null }),
    ]
    expect(checkInvariance(rows, { category: 'planning', sessionId: null })).toBeNull()
  })
})
