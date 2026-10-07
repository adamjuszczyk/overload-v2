import { describe, it, expect } from 'vitest'
import { computeExerciseSessionStats, type RawSetLogRow } from './progressService'

// Chunk 15 (SPEC "Warmup sets" — "never counted in volume, set counts").
// computeExerciseSessionStats was extracted from fetchExerciseProgress's
// own per-session loop specifically so this is testable without mocking
// Supabase (progressService.ts otherwise has none of its own unit tests —
// isStageOfSkippedHead's own header comment documents why; this is the
// same exception for the same reason: a real edge case this chunk
// introduces, worth proving directly).

function row(overrides: Partial<RawSetLogRow> = {}): RawSetLogRow {
  return {
    id: 'r1',
    session_id: 's1',
    weight: 100,
    reps: 8,
    rir: 2,
    rest_seconds: 90,
    is_skipped: false,
    is_warmup: false,
    parent_set_id: null,
    form_rating: null,
    logged_at: '2026-01-05T10:00:00Z',
    v2_sessions: { id: 's1', date: '2026-01-05', status: 'completed', mesocycle_id: 'm1', v2_week_plans: null },
    ...overrides,
  }
}

describe('computeExerciseSessionStats — warmups excluded (chunk 15)', () => {
  it('one warmup + two working heads -> setCount 2, volume excludes the warmup', () => {
    const stats = computeExerciseSessionStats([
      row({ id: 'warmup', weight: 40, reps: 10, rir: null, is_warmup: true }),
      row({ id: 'work-1', weight: 100, reps: 8, rir: 2 }),
      row({ id: 'work-2', weight: 90, reps: 10, rir: 1 }),
    ])
    expect(stats).not.toBeNull()
    expect(stats!.setCount).toBe(2)
    // 100*8 + 90*10 = 1700 — the warmup's 40*10=400 is not added.
    expect(stats!.volume).toBe(1700)
    expect(stats!.avgReps).toBe(9) // (8+10)/2, warmup's reps not in the average
    expect(stats!.topWeight).toBe(100) // not the warmup's own weight
  })

  it('a stage still counts toward volume but not setCount (unchanged by this chunk)', () => {
    const stats = computeExerciseSessionStats([
      row({ id: 'head', weight: 90, reps: 10, rir: 1 }),
      row({ id: 'stage', weight: 70, reps: 12, rir: 0, parent_set_id: 'head' }),
    ])
    expect(stats!.setCount).toBe(1)
    expect(stats!.volume).toBe(90 * 10 + 70 * 12)
  })

  it('a session with ONLY a warmup logged for this exercise -> null (no data point, no crash)', () => {
    const stats = computeExerciseSessionStats([
      row({ id: 'warmup-1', weight: 40, reps: 10, rir: null, is_warmup: true }),
      row({ id: 'warmup-2', weight: null, reps: null, rir: null, is_warmup: true }),
    ])
    expect(stats).toBeNull()
  })
})
