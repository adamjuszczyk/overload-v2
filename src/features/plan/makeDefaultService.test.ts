import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 32 — the call "Make this week the new default" makes: the RPC. Isolated from the
// real client.

const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))

const { makeWeekDefault } = await import('./makeDefaultService')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('makeWeekDefault', () => {
  it('calls v2_make_week_default with the run and the week, and nothing else', async () => {
    rpcMock.mockResolvedValue({ data: { mesocycle_id: 'meso-1', week_number: 3, workouts: [], skipped: [] }, error: null })
    await makeWeekDefault('meso-1', 3)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_make_week_default', { p_mesocycle_id: 'meso-1', p_week_number: 3 })
  })

  it('answers with the workouts it left alone, parsed', async () => {
    rpcMock.mockResolvedValue({
      data: {
        mesocycle_id: 'meso-1',
        week_number: 3,
        workouts: [{ workout_day_id: 'wd-1', source: { week_plan_id: 'wp-3', sequence_position: null }, old_default: { exercises: [] } }],
        skipped: [{ workout_day_id: 'wd-2', reason: 'deload' }],
      },
      error: null,
    })
    const result = await makeWeekDefault('meso-1', 3)
    expect(result.skipped).toEqual([{ workoutDayId: 'wd-2', reason: 'deload' }])
  })

  it('an error from the function is thrown as it came (it is atomic: nothing was written)', async () => {
    const error = new Error('v2_make_week_default: every session of week 3 of mesocycle m is deload or empty; there is nothing to make the default')
    rpcMock.mockResolvedValue({ data: null, error })
    await expect(makeWeekDefault('meso-1', 3)).rejects.toBe(error)
  })
})
