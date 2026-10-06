import { describe, it, expect, vi } from 'vitest'

// Chunk 15 (SPEC "Warmup sets" — "never counted in ... set counts"):
// fetchHistoryDetail's own client-side setCount (the one place this screen
// computes it instead of reading a 035-redefined view — see that
// function's own comment) must exclude a warmup the same way the view
// does. Same mocking precedent as historyService.test.ts's own makeChain.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { fetchHistoryDetail } = await import('./historyService')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
  }
  return chain
}

describe('fetchHistoryDetail — setCount excludes warmups (chunk 15)', () => {
  it('two working heads + one warmup head + one dropset stage -> setCount 2', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: {
          id: 'session-1',
          date: '2026-01-05',
          status: 'completed',
          note: null,
          started_at: '2026-01-05T10:00:00Z',
          completed_at: '2026-01-05T11:00:00Z',
          workout_day_id: null,
          mesocycle_id: null,
          energy_rating: null,
          pump_rating: null,
          v2_mesocycles: null,
          v2_set_logs: [
            { id: 'warmup-1', exercise_id: 'ex-1', set_number: 1, weight: 40, reps: 10, rir: null, rest_seconds: null, is_skipped: false, is_dropset: false, parent_set_id: null, stage_index: 0, logged_at: '2026-01-05T10:00:00Z', form_rating: null, is_warmup: true, exercises: { id: 'ex-1', name: 'Bench', muscle_group: 'chest' } },
            { id: 'work-1', exercise_id: 'ex-1', set_number: 1, weight: 100, reps: 8, rir: 2, rest_seconds: null, is_skipped: false, is_dropset: false, parent_set_id: null, stage_index: 0, logged_at: '2026-01-05T10:05:00Z', form_rating: null, is_warmup: false, exercises: { id: 'ex-1', name: 'Bench', muscle_group: 'chest' } },
            { id: 'work-2', exercise_id: 'ex-1', set_number: 2, weight: 90, reps: 10, rir: 1, rest_seconds: null, is_skipped: false, is_dropset: false, parent_set_id: null, stage_index: 0, logged_at: '2026-01-05T10:10:00Z', form_rating: null, is_warmup: false, exercises: { id: 'ex-1', name: 'Bench', muscle_group: 'chest' } },
            { id: 'stage-1', exercise_id: 'ex-1', set_number: 2, weight: 70, reps: 12, rir: 0, rest_seconds: null, is_skipped: false, is_dropset: true, parent_set_id: 'work-2', stage_index: 1, logged_at: '2026-01-05T10:11:00Z', form_rating: null, is_warmup: false, exercises: { id: 'ex-1', name: 'Bench', muscle_group: 'chest' } },
          ],
        },
        error: null,
      }),
    )

    const detail = await fetchHistoryDetail('session-1')

    // Not 4 (every row) and not 3 (stage already excluded, warmup not):
    // exactly the two real working heads.
    expect(detail.setCount).toBe(2)
    // Sanity: the warmup row is still present in the per-exercise groups
    // (it isn't hidden from the breakdown, only from the headline count),
    // and carries isWarmup through for SessionDetail.tsx's own label.
    const warmupRow = detail.exerciseGroups[0].sets.find((g) => g.head.id === 'warmup-1')
    expect(warmupRow?.head.isWarmup).toBe(true)
  })
})
