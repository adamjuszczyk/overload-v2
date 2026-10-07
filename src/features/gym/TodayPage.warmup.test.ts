import { describe, it, expect } from 'vitest'
import { countCompletedSets } from './TodayPage'
import type { SetLog } from '../../types'

// Chunk 15 (SPEC "Warmup sets" — "never counted in ... set counts"):
// CompletedTodayScreen's own "Today's completed count" — countCompletedSets
// extracted specifically so this is directly testable (see its own comment
// in TodayPage.tsx).

function log(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'l', userId: 'u1', sessionId: 's1', exerciseId: 'e1', weekPlanSetId: null,
    setNumber: 1, weight: 100, reps: 8, rir: 2, note: null, isDropset: false,
    parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null,
    isSkipped: false, loggedAt: '2026-01-05T10:00:00Z', restSeconds: null, formRating: null,
    ...overrides,
  }
}

describe('countCompletedSets — warmups excluded (chunk 15)', () => {
  it('two logged working sets, one skipped, one warmup -> total 2, skipped 1', () => {
    const { total, skipped } = countCompletedSets([
      log({ id: '1' }),
      log({ id: '2' }),
      log({ id: '3', isSkipped: true, weight: null, reps: null }),
      log({ id: '4', isWarmup: true, weight: 40, reps: 10 }),
    ])
    expect(total).toBe(2)
    expect(skipped).toBe(1)
  })

  it('every log a warmup -> both counts zero', () => {
    const { total, skipped } = countCompletedSets([
      log({ id: '1', isWarmup: true }),
      log({ id: '2', isWarmup: true, isSkipped: true, weight: null, reps: null }),
    ])
    expect(total).toBe(0)
    expect(skipped).toBe(0)
  })

  it('no logs at all -> both zero', () => {
    expect(countCompletedSets([])).toEqual({ total: 0, skipped: 0 })
  })
})
