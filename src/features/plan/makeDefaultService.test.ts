import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProgramExercise, ProgramSet } from '../../types'

// Chunk 32 — the calls around "Make this week the new default": the RPC, and the two reads
// after it (what the source sessions' planned sets name now, and the run's copy). Isolated
// from the real client and from the other services they delegate to (the run's exercise
// list has one read path: runProgramExercises.ts).

const rpcMock = vi.fn()
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args), from: (...args: unknown[]) => fromMock(...args) } }))
const fetchRunProgramExercisesMock = vi.fn()
vi.mock('../programs/runProgramExercises', () => ({
  fetchRunProgramExercises: (...args: unknown[]) => fetchRunProgramExercisesMock(...args),
}))
const fetchProgramSetsMock = vi.fn()
vi.mock('../planner/plannerService', () => ({ fetchProgramSets: (...args: unknown[]) => fetchProgramSetsMock(...args) }))

const { makeWeekDefault, fetchRunCopyDefaults, fetchSourceSetLinks } = await import('./makeDefaultService')

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
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

// A query builder that records the calls chained on it and answers when awaited.
function query(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'in', 'not']) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args])
      return chain
    }
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return { chain, calls }
}

describe('fetchSourceSetLinks — what the source sessions\' planned sets name after the call', () => {
  it('reads the planned sets of the source sessions that name a program set, in one request, by session', async () => {
    const q = query({
      data: [
        { id: 'i1', week_plan_id: 'wp-3', program_set_id: 'pi-1' },
        { id: 'i2', week_plan_id: 'wp-3', program_set_id: 'pi-2' },
        { id: 'p1', week_plan_id: 'wp-pull-3', program_set_id: 'pp-1' },
      ],
      error: null,
    })
    fromMock.mockReturnValue(q.chain)

    const result = await fetchSourceSetLinks(['wp-3', 'wp-pull-3', 'wp-empty'])

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('v2_week_plan_sets')
    expect(q.calls).toEqual([
      ['select', ['id, week_plan_id, program_set_id']],
      ['in', ['week_plan_id', ['wp-3', 'wp-pull-3', 'wp-empty']]],
      ['not', ['program_set_id', 'is', null]], // a set that names nothing is nobody's partner
    ])
    expect([...result.keys()]).toEqual(['wp-3', 'wp-pull-3', 'wp-empty'])
    expect([...result.get('wp-3')!]).toEqual([['i1', 'pi-1'], ['i2', 'pi-2']])
    expect([...result.get('wp-pull-3')!]).toEqual([['p1', 'pp-1']])
    expect(result.get('wp-empty')!.size).toBe(0) // a session with nothing linked is an empty answer, not a missing one
  })

  it('no source sessions, no request', async () => {
    expect((await fetchSourceSetLinks([])).size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('a row of another session than those asked for is ignored', async () => {
    fromMock.mockReturnValue(query({ data: [{ id: 'x', week_plan_id: 'wp-other', program_set_id: 'p' }], error: null }).chain)
    const result = await fetchSourceSetLinks(['wp-3'])
    expect([...result.keys()]).toEqual(['wp-3'])
    expect(result.get('wp-3')!.size).toBe(0)
  })

  it('a read that fails fails the call (the hook turns it into "no links": a swapped slot is then paired by ordinal)', async () => {
    fromMock.mockReturnValue(query({ data: null, error: new Error('read failed') }).chain)
    await expect(fetchSourceSetLinks(['wp-3'])).rejects.toThrow('read failed')
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
