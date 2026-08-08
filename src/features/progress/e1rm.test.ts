import { describe, it, expect } from 'vitest'
import {
  calculateE1rm,
  sessionE1rmAvg,
  compareE1rmWindow,
  type E1rmSetInput,
  type E1rmSessionInput,
} from './e1rm'

function makeSet(overrides: Partial<E1rmSetInput> = {}): E1rmSetInput {
  return {
    weight: 100,
    reps: 8,
    rir: 2,
    isSkipped: false,
    isWarmup: false,
    parentSetId: null,
    ...overrides,
  }
}

function makeSession(overrides: Partial<E1rmSessionInput> = {}): E1rmSessionInput {
  return {
    sessionId: 'sess',
    date: '2026-01-01',
    isDeload: false,
    sets: [makeSet()],
    ...overrides,
  }
}

describe('calculateE1rm', () => {
  it('applies effectiveReps = reps + rir, e1RM = weight × (1 + effectiveReps / 30)', () => {
    expect(calculateE1rm({ weight: 100, reps: 8, rir: 2 })).toBeCloseTo(133.333, 2)
  })

  it('with rir=0 matches plain Epley', () => {
    expect(calculateE1rm({ weight: 100, reps: 10, rir: 0 })).toBeCloseTo(133.333, 2)
  })
})

describe('sessionE1rmAvg', () => {
  it('averages e1RM across every eligible set, not just the top one', () => {
    const sets = [
      makeSet({ weight: 100, reps: 8, rir: 2 }), // 133.333
      makeSet({ weight: 90, reps: 8, rir: 2 }), // 120
    ]
    expect(sessionE1rmAvg(sets)).toBeCloseTo((133.333 + 120) / 2, 1)
  })

  // Edge case (TASKS.md §2.5 table, row 2): "Some sets in a session have
  // RIR, some don't" → average the ones that do, not `?? 0`.
  it('skips a set with no RIR recorded — does not default to rir=0', () => {
    const withRir = makeSet({ weight: 100, reps: 8, rir: 2 }) // 133.333
    // If this were defaulted to rir=0 it would contribute
    // 200 * (1 + 8/30) = 253.33 and drag the average well above 133.333.
    const noRir = makeSet({ weight: 200, reps: 8, rir: null })
    expect(sessionE1rmAvg([withRir, noRir])).toBeCloseTo(133.333, 1)
  })

  it('excludes skipped sets', () => {
    const real = makeSet({ weight: 100, reps: 8, rir: 2 })
    const skipped = makeSet({ isSkipped: true, weight: null, reps: null, rir: null })
    expect(sessionE1rmAvg([real, skipped])).toBeCloseTo(133.333, 1)
  })

  it('excludes warmup sets', () => {
    const real = makeSet({ weight: 100, reps: 8, rir: 2 })
    const warmup = makeSet({ isWarmup: true, weight: 40, reps: 10, rir: 5 })
    expect(sessionE1rmAvg([real, warmup])).toBeCloseTo(133.333, 1)
  })

  it('excludes drop stages (parentSetId set) — a stage is not an independent set', () => {
    const head = makeSet({ weight: 100, reps: 8, rir: 2 })
    const stage = makeSet({ parentSetId: 'head-id', weight: 60, reps: 12, rir: 0 })
    expect(sessionE1rmAvg([head, stage])).toBeCloseTo(133.333, 1)
  })

  // Edge case (row 3): "No set in a session has RIR" → the session as a
  // whole contributes nothing (compareE1rmWindow reads this as "excluded",
  // not as an unadjusted 0).
  it('is null for a session with zero eligible sets', () => {
    expect(sessionE1rmAvg([makeSet({ rir: null })])).toBeNull()
  })

  it('is null for an empty set list', () => {
    expect(sessionE1rmAvg([])).toBeNull()
  })
})

describe('compareE1rmWindow — edge cases (TASKS.md §2.5 table)', () => {
  // Row 1: "Fewer than 2 eligible sessions in the meso" → nothing, not "+0%".
  it('is null for fewer than 2 eligible sessions', () => {
    expect(compareE1rmWindow([])).toBeNull()
    expect(compareE1rmWindow([makeSession({ sessionId: 's1' })])).toBeNull()
  })

  // Row 2, at the window level: a mixed-RIR session still participates,
  // using only its RIR-recorded sets.
  it('uses a session with a partial RIR mix, averaging only the recorded sets', () => {
    const first = makeSession({
      sessionId: 's1',
      date: '2026-01-01',
      sets: [makeSet({ weight: 100, reps: 8, rir: 2 })],
    })
    const last = makeSession({
      sessionId: 's2',
      date: '2026-01-08',
      sets: [
        makeSet({ weight: 110, reps: 8, rir: 2 }),
        makeSet({ weight: 999, reps: 8, rir: null }),
      ],
    })
    const result = compareE1rmWindow([first, last])
    expect(result).not.toBeNull()
    expect(result!.lastAvg).toBeCloseTo(calculateE1rm({ weight: 110, reps: 8, rir: 2 }), 1)
  })

  // Row 3: "No set in a session has RIR" → session excluded, falls back to
  // the next eligible session in that direction — not used unadjusted.
  it('excludes a session with no RIR recorded anywhere and falls back to the next eligible session', () => {
    const first = makeSession({ sessionId: 's1', date: '2026-01-01', sets: [makeSet({ weight: 100, rir: 2 })] })
    const noRirMiddle = makeSession({
      sessionId: 's2',
      date: '2026-01-08',
      sets: [makeSet({ weight: 500, rir: null })],
    })
    const last = makeSession({ sessionId: 's3', date: '2026-01-15', sets: [makeSet({ weight: 120, rir: 2 })] })

    const result = compareE1rmWindow([first, noRirMiddle, last])
    expect(result).not.toBeNull()
    expect(result!.firstSessionId).toBe('s1')
    expect(result!.lastSessionId).toBe('s3')
  })

  it('falls to null when excluding the no-RIR session leaves fewer than 2 eligible', () => {
    const eligible = makeSession({ sessionId: 's1', date: '2026-01-01', sets: [makeSet({ rir: 2 })] })
    const noRir = makeSession({ sessionId: 's2', date: '2026-01-08', sets: [makeSet({ rir: null })] })
    expect(compareE1rmWindow([eligible, noRir])).toBeNull()
  })

  // Row 4: "First and/or last eligible session is a deload week" → excluded
  // from both endpoints, falls back to the nearest non-deload eligible one.
  it('excludes deload weeks from both endpoints and falls back to the nearest non-deload eligible session', () => {
    const deloadFirst = makeSession({
      sessionId: 's0',
      date: '2025-12-25',
      isDeload: true,
      sets: [makeSet({ weight: 50, rir: 2 })],
    })
    const first = makeSession({ sessionId: 's1', date: '2026-01-01', sets: [makeSet({ weight: 100, rir: 2 })] })
    const last = makeSession({ sessionId: 's2', date: '2026-01-15', sets: [makeSet({ weight: 120, rir: 2 })] })
    const deloadLast = makeSession({
      sessionId: 's3',
      date: '2026-01-22',
      isDeload: true,
      sets: [makeSet({ weight: 200, rir: 2 })],
    })

    const result = compareE1rmWindow([deloadFirst, first, last, deloadLast])
    expect(result).not.toBeNull()
    expect(result!.firstSessionId).toBe('s1')
    expect(result!.lastSessionId).toBe('s2')
  })

  // Row 5: "Exercise has eligible sessions but all in deload weeks" → nothing.
  it('is null when every eligible session falls in a deload week', () => {
    const d1 = makeSession({ sessionId: 's1', date: '2026-01-01', isDeload: true, sets: [makeSet({ rir: 2 })] })
    const d2 = makeSession({ sessionId: 's2', date: '2026-01-08', isDeload: true, sets: [makeSet({ rir: 2 })] })
    expect(compareE1rmWindow([d1, d2])).toBeNull()
  })

  it('computes deltaPercent as (lastAvg - firstAvg) / firstAvg × 100', () => {
    const first = makeSession({
      sessionId: 's1',
      date: '2026-01-01',
      sets: [makeSet({ weight: 100, reps: 8, rir: 2 })],
    })
    const last = makeSession({
      sessionId: 's2',
      date: '2026-02-01',
      sets: [makeSet({ weight: 110, reps: 8, rir: 2 })],
    })
    const result = compareE1rmWindow([first, last])!
    const firstAvg = calculateE1rm({ weight: 100, reps: 8, rir: 2 })
    const lastAvg = calculateE1rm({ weight: 110, reps: 8, rir: 2 })
    expect(result.deltaPercent).toBeCloseTo(((lastAvg - firstAvg) / firstAvg) * 100, 5)
  })

  it('compares first vs. most recent, ignoring sessions in between', () => {
    const first = makeSession({ sessionId: 's1', date: '2026-01-01', sets: [makeSet({ weight: 100, rir: 2 })] })
    const middle = makeSession({ sessionId: 's2', date: '2026-01-08', sets: [makeSet({ weight: 999, rir: 2 })] })
    const last = makeSession({ sessionId: 's3', date: '2026-01-15', sets: [makeSet({ weight: 120, rir: 2 })] })
    const result = compareE1rmWindow([first, middle, last])!
    expect(result.firstSessionId).toBe('s1')
    expect(result.lastSessionId).toBe('s3')
  })
})
