import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProgramExercise, ProgramSet } from '../../types'

// Chunk 32 — the two calls around "Make this week the new default": the RPC, and the read
// of the run's copy afterwards. Isolated from the real client and from the other services
// they delegate to (the run's exercise list has one read path: runProgramExercises.ts).

const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))
const fetchRunProgramExercisesMock = vi.fn()
vi.mock('../programs/runProgramExercises', () => ({
  fetchRunProgramExercises: (...args: unknown[]) => fetchRunProgramExercisesMock(...args),
}))
const fetchProgramSetsMock = vi.fn()
vi.mock('../planner/plannerService', () => ({ fetchProgramSets: (...args: unknown[]) => fetchProgramSetsMock(...args) }))

const { makeWeekDefault, fetchRunCopyDefaults } = await import('./makeDefaultService')

beforeEach(() => {
  rpcMock.mockReset()
  fetchRunProgramExercisesMock.mockReset()
  fetchProgramSetsMock.mockReset()
})

describe('makeWeekDefault', () => {
  it('calls v2_make_week_default with the run and the week, and nothing else', async () => {
    rpcMock.mockResolvedValue({ data: { mesocycle_id: 'meso-1', week_number: 3, workouts: [], skipped: [] }, error: null })
    await makeWeekDefault('meso-1', 3)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_make_week_default', { p_mesocycle_id: 'meso-1', p_week_number: 3 })
  })

  it('answers with the old default of each rewritten workout, parsed', async () => {
    rpcMock.mockResolvedValue({
      data: {
        mesocycle_id: 'meso-1',
        week_number: 3,
        workouts: [{ workout_day_id: 'wd-1', source: { week_plan_id: 'wp-3', sequence_position: null }, old_default: { exercises: [{ id: 'pe-1', exercise_id: 'ex-1', position: 0, sets: [] }] } }],
        skipped: [{ workout_day_id: 'wd-2', reason: 'deload' }],
      },
      error: null,
    })
    const result = await makeWeekDefault('meso-1', 3)
    expect(result.workouts).toEqual([{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-3', sourceSequencePosition: null, oldExercises: [{ id: 'pe-1', exerciseId: 'ex-1', position: 0, sets: [] }] }])
    expect(result.skipped).toEqual([{ workoutDayId: 'wd-2', reason: 'deload' }])
  })

  it('an error from the function is thrown as it came (it is atomic: nothing was written)', async () => {
    const error = new Error('v2_make_week_default: every session of week 3 of mesocycle m is deload or empty; there is nothing to make the default')
    rpcMock.mockResolvedValue({ data: null, error })
    await expect(makeWeekDefault('meso-1', 3)).rejects.toBe(error)
  })
})

describe('fetchRunCopyDefaults — the new default, read from the run\'s copy', () => {
  const pe = (id: string, workoutDayId: string, position: number): ProgramExercise => ({ id, workoutDayId, userId: 'u', exerciseId: `ex-${id}`, position, weightUnit: null })
  const ps = (id: string, programExerciseId: string, overrides: Partial<ProgramSet> = {}): ProgramSet => ({
    id, userId: 'u', programExerciseId, position: 1, isWarmup: false, stageKind: null, stageRestSeconds: null, parentProgramSetId: null, stageIndex: 0,
    repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '', ...overrides,
  })

  it('reads each workout\'s current exercises through the one read path, and all their program sets in one request', async () => {
    fetchRunProgramExercisesMock.mockImplementation(async (workoutDayId: string) =>
      workoutDayId === 'wd-1' ? [pe('pe-1', 'wd-1', 0), pe('pe-2', 'wd-1', 1)] : [pe('pe-3', 'wd-2', 0)],
    )
    fetchProgramSetsMock.mockResolvedValue([ps('a', 'pe-1'), ps('b', 'pe-2'), ps('c', 'pe-3')])

    const result = await fetchRunCopyDefaults(['wd-1', 'wd-2'])

    expect(fetchRunProgramExercisesMock.mock.calls.map((c) => c[0])).toEqual(['wd-1', 'wd-2'])
    expect(fetchProgramSetsMock).toHaveBeenCalledTimes(1)
    expect(fetchProgramSetsMock).toHaveBeenCalledWith(['pe-1', 'pe-2', 'pe-3'])
    expect([...result.keys()]).toEqual(['wd-1', 'wd-2'])
    expect(result.get('wd-1')!.map((e) => [e.id, e.sets.map((s) => s.id)])).toEqual([['pe-1', ['a']], ['pe-2', ['b']]])
    expect(result.get('wd-2')!.map((e) => [e.id, e.sets.map((s) => s.id)])).toEqual([['pe-3', ['c']]])
  })

  it('leaves out a program set the default dropped (removedAt): the read returns it for the workout screen, the default must not', async () => {
    fetchRunProgramExercisesMock.mockResolvedValue([pe('pe-1', 'wd-1', 0)])
    fetchProgramSetsMock.mockResolvedValue([ps('kept', 'pe-1'), ps('dropped', 'pe-1', { removedAt: '2026-10-11T10:00:00Z' })])
    const result = await fetchRunCopyDefaults(['wd-1'])
    expect(result.get('wd-1')![0].sets.map((s) => s.id)).toEqual(['kept'])
  })

  it('a workout with no exercises is an empty default', async () => {
    fetchRunProgramExercisesMock.mockResolvedValue([])
    fetchProgramSetsMock.mockResolvedValue([])
    expect((await fetchRunCopyDefaults(['wd-1'])).get('wd-1')).toEqual([])
  })

  it('a read that fails fails the whole call (the hook turns it into "no offer")', async () => {
    fetchRunProgramExercisesMock.mockRejectedValue(new Error('read failed'))
    await expect(fetchRunCopyDefaults(['wd-1'])).rejects.toThrow('read failed')
  })
})
