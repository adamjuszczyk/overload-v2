// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { WeekPlan, ProgramExercise, WeekPlanSet } from '../../types'
import type { AheadGroup, ChangeRecord, DefaultSetShape } from './applyAhead'

// Chunk 32 — the executor of "Apply this change to planned weeks ahead" after "Make this
// week the new default" (useWeekPlan.ts useApplyAhead): the per-part groups it plans and
// runs, what each new op calls in weekPlanService.ts, how it counts, and what a failure
// part-way leaves refreshed. The service is mocked at its boundary: these are the calls that
// would reach the database.

const calls: { fn: string; args: unknown[] }[] = []
const failOn: { fn: string | null } = { fn: null }
function record(fn: string) {
  return async (...args: unknown[]) => {
    calls.push({ fn, args })
    if (failOn.fn === fn) throw new Error(`${fn} failed`)
  }
}
vi.mock('./weekPlanService', () => ({
  fetchWeekPlans: vi.fn(),
  fetchAllWeekPlansForMeso: vi.fn(),
  fetchWeekPlanById: vi.fn(),
  createWeekPlan: vi.fn(),
  markSessionDeload: vi.fn(),
  unmarkSessionDeload: vi.fn(),
  markWeekDeload: vi.fn(),
  unmarkWeekDeload: vi.fn(),
  copyFromPreviousWeek: vi.fn(),
  copyWorkoutFromPreviousWeek: vi.fn(),
  planWeek: vi.fn(),
  swapWeekExercise: vi.fn(),
  addSet: record('addSet'),
  addWarmupSet: record('addWarmupSet'),
  addStage: record('addStage'),
  updateSet: record('updateSet'),
  removeSet: record('removeSet'),
  repointWeekExercise: record('repointWeekExercise'),
  addWeekExercise: record('addWeekExercise'),
  addPointedExercise: record('addPointedExercise'),
  addPointedSet: record('addPointedSet'),
  addPointedStage: record('addPointedStage'),
  removeWeekExercise: record('removeWeekExercise'),
  reorderWeekExercises: record('reorderWeekExercises'),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { useApplyAhead, ApplyAheadError } = await import('./useWeekPlan')

afterEach(() => {
  calls.length = 0
  failOn.fn = null
  queryClient.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const pe = (id: string, overrides: Partial<ProgramExercise> = {}): ProgramExercise => ({ id, workoutDayId: 'wd-1', userId: 'u', exerciseId: `ex-${id}`, position: 0, weightUnit: null, ...overrides })
const set = (id: string, programExerciseId: string, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-x', userId: 'u', programExerciseId, setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...overrides,
})
const week = (weekNumber: number, exercises: ProgramExercise[], sets: WeekPlanSet[], overrides: Partial<WeekPlan> = {}): WeekPlan => ({
  id: `wp-${weekNumber}`, userId: 'u', mesocycleId: 'm', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null, exercises, sets, createdAt: '', ...overrides,
})
const shape = (programSetId: string, programExerciseId: string, overrides: Partial<DefaultSetShape> = {}): DefaultSetShape => ({
  programSetId, programExerciseId, position: 1, isWarmup: false, stageKind: null, repMin: null, repMax: null, isAmrap: false, stageIndex: 0, stages: [], ...overrides,
})

const invalidated = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey.join('/'))

describe('useApplyAhead with per-part groups', () => {
  const added = { programExerciseId: 'pe-new', position: 2, sets: [shape('q1', 'pe-new', { position: 1, repMin: 12, repMax: 15 })] }
  const groups: AheadGroup[] = [{
    workoutDayId: 'wd-1',
    changes: [
      { editType: 'removeHeadSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2, defaultSet: { programSetId: 'a2' } },
      { editType: 'repTarget', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null }, oldValue: { repMin: 8, repMax: 10, isAmrap: false }, newValue: { repMin: 6, repMax: 8, isAmrap: false }, defaultSet: { programSetId: 'a1' } },
      { editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new', defaultRow: added },
    ],
  }]
  const changes = groups.flatMap((g) => g.changes)
  const holding = (n: number) => week(n, [pe('pe-1')], [set(`s1-${n}`, 'pe-1', { programSetId: 'a1', repMin: 8, repMax: 10 }), set(`s2-${n}`, 'pe-1', { setNumber: 2, programSetId: 'a2' })])

  it('runs each part a later week holds, in record order, week by week, and counts weeks', async () => {
    const { result } = renderHook(() => useApplyAhead('meso-1'), { wrapper })
    let out!: Awaited<ReturnType<typeof result.current.mutateAsync>>
    await act(async () => {
      out = await result.current.mutateAsync({ changes, weeks: [holding(4), holding(5)], groups })
    })

    expect(calls.map((c) => [c.fn, c.args[0] ?? null])).toEqual([
      ['removeSet', 's2-4'], ['updateSet', 's1-4'], ['addPointedExercise', expect.objectContaining({ weekPlanId: 'wp-4' })],
      ['removeSet', 's2-5'], ['updateSet', 's1-5'], ['addPointedExercise', expect.objectContaining({ weekPlanId: 'wp-5' })],
    ])
    expect(calls.find((c) => c.fn === 'updateSet')!.args).toEqual(['s1-4', { repMin: 6, repMax: 8, isAmrap: false }])
    expect(calls.find((c) => c.fn === 'addPointedExercise')!.args[0]).toEqual({ userId: 'user-1', weekPlanId: 'wp-4', programExerciseId: 'pe-new', position: 2, sets: added.sets })
    expect(calls.some((c) => c.fn === 'addWeekExercise')).toBe(false) // never a fresh week-only row
    expect(out.summary).toEqual({ total: 2, applied: 2, skippedDeload: 0, skippedStructural: 0 })
    expect(out.writtenWeekNumbers).toEqual([4, 5])
  })

  it('a deload week and a week that holds none of the parts are not written; each counts as what it is', async () => {
    const none = week(6, [pe('pe-9', { exerciseId: 'ex-new' })], []) // the new exercise is in it already by hand; nothing else matches
    const { result } = renderHook(() => useApplyAhead('meso-1'), { wrapper })
    let out!: Awaited<ReturnType<typeof result.current.mutateAsync>>
    await act(async () => {
      out = await result.current.mutateAsync({ changes, weeks: [holding(4), { ...holding(5), isDeload: true }, none], groups })
    })
    expect(new Set(calls.map((c) => (c.fn === 'addPointedExercise' ? (c.args[0] as { weekPlanId: string }).weekPlanId : (c.args[0] as string).split('-').pop())))).toEqual(new Set(['wp-4', '4']))
    expect(out.summary).toEqual({ total: 3, applied: 1, skippedDeload: 1, skippedStructural: 1 })
    expect(out.writtenWeekNumbers).toEqual([4])
  })

  it('refreshes the weeks it wrote and the meso-wide list', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useApplyAhead('meso-1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ changes, weeks: [holding(4), holding(5)], groups })
    })
    expect(invalidated(spy)).toEqual(expect.arrayContaining(['v2_weekPlans/meso-1/4', 'v2_weekPlans/meso-1/5', 'v2_allWeekPlans/meso-1']))
  })

  it('a write that fails stops there: the weeks written so far, and the week that failed part-way, are refreshed', async () => {
    failOn.fn = 'updateSet'
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useApplyAhead('meso-1'), { wrapper })
    let error: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({ changes, weeks: [holding(4), holding(5)], groups })
      } catch (e) {
        error = e
      }
    })
    expect(error).toBeInstanceOf(ApplyAheadError)
    const err = error as InstanceType<typeof ApplyAheadError>
    expect(err.message).toBe('updateSet failed')
    expect(err.writtenWeekNumbers).toEqual([]) // week 4 stopped at its second op: not "written"...
    expect(err.failedWeekNumber).toBe(4) // ...but it is not untouched either (its removal went through)
    expect(err.summary).toEqual({ total: 2, applied: 2, skippedDeload: 0, skippedStructural: 0 })
    expect(calls.map((c) => c.fn)).toEqual(['removeSet', 'updateSet']) // nothing after the failure, week 5 untouched
    expect(invalidated(spy)).toEqual(expect.arrayContaining(['v2_weekPlans/meso-1/4', 'v2_allWeekPlans/meso-1']))
    expect(invalidated(spy)).not.toContain('v2_weekPlans/meso-1/5')
  })
})

describe('useApplyAhead — what each new op calls', () => {
  async function run(change: ChangeRecord, w: WeekPlan, groupMode = true) {
    const { result } = renderHook(() => useApplyAhead('meso-1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(groupMode ? { changes: [change], weeks: [w], groups: [{ workoutDayId: 'wd-1', changes: [change] }] } : { changes: [change], weeks: [w] })
    })
  }

  it('a swap from a default repoints the row and re-links its sets', async () => {
    await run(
      { editType: 'swapExercise', slotId: 'pe-old', exerciseId: 'ex-pe-old', newExerciseId: 'ex-new', resultingProgramExerciseId: 'pe-new', relink: [{ from: 'a1', to: 'q1' }] },
      week(4, [pe('pe-old')], [set('s1', 'pe-old', { programSetId: 'a1' })]),
    )
    expect(calls).toEqual([{ fn: 'repointWeekExercise', args: ['wp-4', 'pe-old', 'pe-new', [{ weekSetId: 's1', programSetId: 'q1' }]] }])
  })

  it('a hand swap calls it with the three arguments it always had', async () => {
    await run(
      { editType: 'swapExercise', slotId: 'pe-old', exerciseId: 'ex-pe-old', newExerciseId: 'ex-new', resultingProgramExerciseId: 'pe-new' },
      week(4, [pe('pe-old')], []),
      false,
    )
    expect(calls).toEqual([{ fn: 'repointWeekExercise', args: ['wp-4', 'pe-old', 'pe-new'] }])
  })

  it('a set from a default is written by addPointedSet with the shape, a stage by addPointedStage under the week\'s head', async () => {
    const working = shape('q', 'pe-1', { position: 3, repMin: 5, repMax: 5 })
    await run({ editType: 'addSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', defaultSet: working }, week(4, [pe('pe-1')], []))
    expect(calls).toEqual([{ fn: 'addPointedSet', args: ['user-1', 'wp-4', 'pe-1', working] }])

    calls.length = 0
    const stage = shape('n1', 'pe-1', { stageIndex: 2 })
    await run(
      { editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 1, headProgramSetId: 'a1', defaultSet: stage },
      week(4, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1' })]),
    )
    expect(calls).toEqual([{ fn: 'addPointedStage', args: ['user-1', 'wp-4', 'pe-1', 'h', 2, stage] }])
  })

  it('a bundle (a hand edit) is planned and counted exactly as before: no groups, sessions counted', async () => {
    const { result } = renderHook(() => useApplyAhead('meso-1'), { wrapper })
    let out!: Awaited<ReturnType<typeof result.current.mutateAsync>>
    const change: ChangeRecord = { editType: 'removeExercise', slotId: 'pe-1', exerciseId: 'ex-pe-1' }
    await act(async () => {
      out = await result.current.mutateAsync({ changes: [change], weeks: [week(4, [pe('pe-1')], []), week(4, [pe('pe-2')], [], { id: 'wp-4b', workoutDayId: 'wd-2' })] })
    })
    // Two sessions of the same week are two weeks here (the bundle counts rows), as before this chunk.
    expect(out.summary).toEqual({ total: 2, applied: 1, skippedDeload: 0, skippedStructural: 1 })
    expect(calls).toEqual([{ fn: 'removeWeekExercise', args: ['wp-4', 'pe-1'] }])
  })
})
