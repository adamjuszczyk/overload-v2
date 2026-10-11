// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { ProgramExercise, WeekPlan } from '../../types'

// Chunk 30 (TASKS-1.1 "Rest, tempo, grouping, the routine and units in the Structure view (run-wide)").
// A week's exercise list is a JOIN over the program-exercise rows, so a week plan the app has already read
// holds its own copy of an exercise's rest, tempo, unit and block. Until this chunk only the planner and the
// program tab edited those fields, and neither shows a week; Plan's STRUCTURE view does. So the shared hooks
// that write them also put the new value into the week caches (optimistic, put back on failure) and mark
// them stale when the write settles — or the control that was just tapped would keep showing the old value
// for up to the query client's 5 minutes, and a stepper tapped three times would write 15 s three times.
// (That a write stays pending until those caches have refetched is usePrograms.pending.test.tsx's.)
//
// The fixture is a swap: the Row (pe-r) was the run's exercise at position 1 and is still in the run's copy
// and in week 1; from week 2 the Incline Press (pe-s, a week_only row of its own) sits at position 1 instead.
// A patch for pe-s that matched by position, not by id, would land on the Row — in the run's copy, in week 1's
// cache and in the meso's history — and the tests below look for exactly that.
//
// The services are mocked (no Supabase); the query client is the app's own singleton, which is the one the
// hooks write the cache through.

const updateRestMock = vi.fn()
const updateTempoMock = vi.fn()
const updateUnitMock = vi.fn()
const createBlockMock = vi.fn()
const setBlockMock = vi.fn()
vi.mock('./programService', () => ({
  updateProgramExerciseRest: (...args: unknown[]) => updateRestMock(...args),
  updateProgramExerciseTempo: (...args: unknown[]) => updateTempoMock(...args),
  updateProgramExerciseWeightUnit: (...args: unknown[]) => updateUnitMock(...args),
  createSupersetBlock: (...args: unknown[]) => createBlockMock(...args),
  setSupersetBlockForExercises: (...args: unknown[]) => setBlockMock(...args),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const {
  useUpdateProgramExerciseRest,
  useUpdateProgramExerciseTempo,
  useUpdateProgramExerciseWeightUnit,
  useToggleSupersetLink,
} = await import('./usePrograms')

const exercise = (id: string, over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'user-1', exerciseId: `ex-${id}`, position: 0, weightUnit: null,
  restSeconds: null, restAfterSeconds: null, tempo: null, supersetBlockId: null, ...over,
})
// The replaced row, with every design field set so that a patch that lands on it shows.
const replaced = (): ProgramExercise => exercise('pe-r', { position: 1, restSeconds: 45, restAfterSeconds: 30, tempo: '2-0-2-0', weightUnit: 'kg' })
const week = (id: string, weekNumber: number, exercises: ProgramExercise[]): WeekPlan => ({
  id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null,
  sets: [], exercises, createdAt: '',
})

const WEEK1_KEY = ['v2_weekPlans', 'meso-1', 1] as const
const WEEK_KEY = ['v2_weekPlans', 'meso-1', 2] as const
const OTHER_WEEK_KEY = ['v2_weekPlans', 'meso-1', 3] as const
const ALL_KEY = ['v2_allWeekPlans', 'meso-1'] as const
const RUN_COPY_KEY = ['v2_programExercises', 'wd-1'] as const

// Week 1 still has the replaced Row (pe-r) at position 1; weeks 2 and 3 have the week_only pe-s there. The run
// copy's own list holds pe-1 and the Row, and never pe-s.
function seed() {
  const week1 = week('wp-1', 1, [exercise('pe-1', { restSeconds: 90 }), replaced()])
  const week2 = week('wp-2', 2, [exercise('pe-1', { restSeconds: 90 }), exercise('pe-s', { position: 1 })])
  const week3 = week('wp-3', 3, [exercise('pe-1', { restSeconds: 90 }), exercise('pe-s', { position: 1 })])
  queryClient.setQueryData(WEEK1_KEY, [week1])
  queryClient.setQueryData(WEEK_KEY, [week2])
  queryClient.setQueryData(OTHER_WEEK_KEY, [week3])
  queryClient.setQueryData(ALL_KEY, [week1, week2, week3])
  queryClient.setQueryData(RUN_COPY_KEY, [exercise('pe-1', { restSeconds: 90 }), replaced()])
  return { week1, week2, week3 }
}
const rowOf = (key: readonly unknown[], planId: string, id: string) =>
  queryClient.getQueryData<WeekPlan[]>(key)!.find((wp) => wp.id === planId)!.exercises.find((e) => e.id === id)!
const runCopyRow = (id: string) => queryClient.getQueryData<ProgramExercise[]>(RUN_COPY_KEY)!.find((e) => e.id === id)

// The Row is in the run's copy, in week 1's cache and in the meso's history, at the position pe-s has in
// weeks 2 and 3: an edit of pe-s must not reach it in any of them.
function expectReplacedRowUntouched() {
  expect(rowOf(WEEK1_KEY, 'wp-1', 'pe-r')).toEqual(replaced())
  expect(rowOf(ALL_KEY, 'wp-1', 'pe-r')).toEqual(replaced())
  expect(runCopyRow('pe-r')).toEqual(replaced())
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

let invalidated: unknown[][]
beforeEach(() => {
  invalidated = []
  const real = queryClient.invalidateQueries.bind(queryClient)
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push([...(((filters as { queryKey?: readonly unknown[] })?.queryKey) ?? [])])
    return real(filters)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const m of [updateRestMock, updateTempoMock, updateUnitMock, createBlockMock, setBlockMock]) m.mockReset()
  queryClient.clear()
})

const deferred = () => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('the design-field hooks keep Plan\'s week caches in step', () => {
  it('REST: the new value is in every cached week at once — a week_only row too, which the run copy\'s list never holds — and nothing else changes', async () => {
    seed()
    const write = deferred()
    updateRestMock.mockReturnValue(write.promise)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })

    act(() => { result.current.mutate({ id: 'pe-s', changes: { restSeconds: 15 } }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').restSeconds).toBe(15))

    // Optimistic, before the write has answered: the week on screen, the other week, and the meso's history.
    expect(rowOf(OTHER_WEEK_KEY, 'wp-3', 'pe-s').restSeconds).toBe(15)
    expect(rowOf(ALL_KEY, 'wp-2', 'pe-s').restSeconds).toBe(15)
    expect(rowOf(ALL_KEY, 'wp-3', 'pe-s').restSeconds).toBe(15)
    // The other row of the week is untouched, and so are the row's other fields.
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').restSeconds).toBe(90)
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').restAfterSeconds).toBeNull()
    // The run copy's own list never held the week_only row, and still doesn't — and the Row it holds at
    // pe-s's position, in it and in week 1, is not pe-s and is left alone.
    expect(queryClient.getQueryData<ProgramExercise[]>(RUN_COPY_KEY)!.map((e) => e.id)).toEqual(['pe-1', 'pe-r'])
    expectReplacedRowUntouched()
    expect(updateRestMock).toHaveBeenCalledWith('pe-s', { restSeconds: 15 })

    write.resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Settled: every week cache is marked stale, as is the one planned session the workout screen reads.
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans'], ['v2_weekPlan'], [...RUN_COPY_KEY]]))
  })

  it('REST on a run-copy row patches the run copy\'s list and every week that shows it', async () => {
    seed()
    const write = deferred()
    updateRestMock.mockReturnValue(write.promise)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })

    act(() => { result.current.mutate({ id: 'pe-1', changes: { restAfterSeconds: 120 } }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').restAfterSeconds).toBe(120))
    expect(runCopyRow('pe-1')!.restAfterSeconds).toBe(120)
    expect(rowOf(OTHER_WEEK_KEY, 'wp-3', 'pe-1').restAfterSeconds).toBe(120)
    expect(rowOf(WEEK1_KEY, 'wp-1', 'pe-1').restAfterSeconds).toBe(120) // week 1 shows pe-1 too
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').restSeconds).toBe(90) // the other field of the same change is left alone
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').restAfterSeconds).toBeNull()
    expectReplacedRowUntouched()
    write.resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a failed write puts every cache back as it was', async () => {
    const before = seed()
    const write = deferred()
    updateRestMock.mockReturnValue(write.promise)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })

    act(() => { result.current.mutate({ id: 'pe-1', changes: { restSeconds: 150 } }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').restSeconds).toBe(150))
    write.reject(new Error('offline'))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(queryClient.getQueryData(WEEK1_KEY)).toEqual([before.week1])
    expect(queryClient.getQueryData(WEEK_KEY)).toEqual([before.week2])
    expect(queryClient.getQueryData(OTHER_WEEK_KEY)).toEqual([before.week3])
    expect(queryClient.getQueryData(ALL_KEY)).toEqual([before.week1, before.week2, before.week3])
    expect(runCopyRow('pe-1')!.restSeconds).toBe(90)
    // ... and they are still marked stale, so the next read is the server's.
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans']]))
  })

  // Another edit's optimistic patch may be sitting in a cache entry this write never touched (a week of some
  // other workout, say). Putting that entry back from this write's snapshot would wipe the other edit's value
  // off the screen until its own refetch landed.
  it('a failed write puts back only the entries it patched: an entry the row was never in keeps what another edit put there meanwhile', async () => {
    const before = seed()
    // Week 4 of another workout, and another meso's history: cached, and neither holds pe-1.
    const OTHER_WORKOUT_WEEK_KEY = ['v2_weekPlans', 'meso-1', 4] as const
    const OTHER_MESO_KEY = ['v2_allWeekPlans', 'meso-2'] as const
    queryClient.setQueryData(OTHER_WORKOUT_WEEK_KEY, [week('wp-4', 4, [exercise('pe-x')])])
    queryClient.setQueryData(OTHER_MESO_KEY, [week('wp-9', 1, [exercise('pe-y')])])

    const write = deferred()
    updateRestMock.mockReturnValue(write.promise)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })
    act(() => { result.current.mutate({ id: 'pe-1', changes: { restSeconds: 150 } }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').restSeconds).toBe(150))

    // Meanwhile another edit's patch lands on both of those entries ...
    const editedWeek4 = [week('wp-4', 4, [exercise('pe-x', { restSeconds: 33 })])]
    const editedOtherMeso = [week('wp-9', 1, [exercise('pe-y', { tempo: '4-0-1-0' })])]
    queryClient.setQueryData(OTHER_WORKOUT_WEEK_KEY, editedWeek4)
    queryClient.setQueryData(OTHER_MESO_KEY, editedOtherMeso)

    // ... and this write fails.
    write.reject(new Error('offline'))
    await waitFor(() => expect(result.current.isError).toBe(true))

    // The entries that held pe-1 are back as they were; the two that never did are as the other edit left them.
    expect(queryClient.getQueryData(WEEK_KEY)).toEqual([before.week2])
    expect(queryClient.getQueryData(ALL_KEY)).toEqual([before.week1, before.week2, before.week3])
    expect(queryClient.getQueryData(OTHER_WORKOUT_WEEK_KEY)).toEqual(editedWeek4)
    expect(queryClient.getQueryData(OTHER_MESO_KEY)).toEqual(editedOtherMeso)
  })

  it('TEMPO and the UNIT are patched the same way (the unit is what a set\'s weight is shown in)', async () => {
    seed()
    updateTempoMock.mockResolvedValue(undefined)
    updateUnitMock.mockResolvedValue(undefined)
    const tempo = renderHook(() => useUpdateProgramExerciseTempo('wd-1'), { wrapper })
    const unit = renderHook(() => useUpdateProgramExerciseWeightUnit('wd-1'), { wrapper })

    await act(async () => { tempo.result.current.mutate({ id: 'pe-s', tempo: '3-1-X-0' }) })
    await waitFor(() => expect(tempo.result.current.isSuccess).toBe(true))
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').tempo).toBe('3-1-X-0')
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').tempo).toBeNull()
    expect(updateTempoMock).toHaveBeenCalledWith('pe-s', '3-1-X-0')
    expectReplacedRowUntouched()
    // Settled: the TEMPO write marks every week cache stale too (this hook's own call, not the REST one's).
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans'], ['v2_weekPlan'], [...RUN_COPY_KEY]]))
    invalidated.length = 0

    await act(async () => { unit.result.current.mutate({ id: 'pe-1', weightUnit: 'lbs' }) })
    await waitFor(() => expect(unit.result.current.isSuccess).toBe(true))
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').weightUnit).toBe('lbs')
    expect(rowOf(ALL_KEY, 'wp-3', 'pe-1').weightUnit).toBe('lbs')
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').weightUnit).toBeNull()
    expect(updateUnitMock).toHaveBeenCalledWith('pe-1', 'lbs')
    // ... and so does the UNIT write.
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans'], ['v2_weekPlan'], [...RUN_COPY_KEY]]))

    // The unit of the swapped-in row is its own too, and the Row at its position keeps its kg.
    await act(async () => { unit.result.current.mutate({ id: 'pe-s', weightUnit: 'lbs' }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').weightUnit).toBe('lbs'))
    expect(rowOf(OTHER_WEEK_KEY, 'wp-3', 'pe-s').weightUnit).toBe('lbs')
    expectReplacedRowUntouched()
  })

  it('a failed TEMPO or UNIT write restores the week caches too', async () => {
    const before = seed()
    updateTempoMock.mockRejectedValue(new Error('offline'))
    updateUnitMock.mockRejectedValue(new Error('offline'))
    const tempo = renderHook(() => useUpdateProgramExerciseTempo('wd-1'), { wrapper })
    const unit = renderHook(() => useUpdateProgramExerciseWeightUnit('wd-1'), { wrapper })

    await act(async () => { tempo.result.current.mutate({ id: 'pe-1', tempo: '2-0-2-0' }) })
    await waitFor(() => expect(tempo.result.current.isError).toBe(true))
    expect(queryClient.getQueryData(WEEK_KEY)).toEqual([before.week2])
    expect(queryClient.getQueryData(ALL_KEY)).toEqual([before.week1, before.week2, before.week3])
    // ... and the week caches are marked stale, so the next read is the server's (a failed write settles too).
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans'], ['v2_weekPlan']]))
    invalidated.length = 0

    await act(async () => { unit.result.current.mutate({ id: 'pe-1', weightUnit: 'kg' }) })
    await waitFor(() => expect(unit.result.current.isError).toBe(true))
    expect(queryClient.getQueryData(WEEK_KEY)).toEqual([before.week2])
    expect(queryClient.getQueryData(ALL_KEY)).toEqual([before.week1, before.week2, before.week3])
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans'], ['v2_weekPlan']]))
  })

  // A refetch of the week that was already in flight when the stepper was tapped would land AFTER the patch and
  // put the old value back (the control would jump back, and the next tap would compute from it).
  it('a fetch of a week already in flight is cancelled, so its old answer cannot land on top of the new value', async () => {
    seed()
    const stale = deferred()
    const staleWeek = week('wp-2', 2, [exercise('pe-1', { restSeconds: 90 }), exercise('pe-s', { position: 1 })])
    // The fetch starts before the tap and answers (with what the server held before it) after it.
    const inFlight = queryClient.fetchQuery({ queryKey: WEEK_KEY, staleTime: 0, queryFn: async () => { await stale.promise; return [staleWeek] } }).catch(() => undefined)
    const write = deferred()
    updateRestMock.mockReturnValue(write.promise)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })

    act(() => { result.current.mutate({ id: 'pe-s', changes: { restSeconds: 15 } }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').restSeconds).toBe(15))
    stale.resolve()
    await inFlight
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-s').restSeconds).toBe(15)

    write.resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a week cache that is not loaded is left alone: nothing is created, nothing throws', async () => {
    queryClient.setQueryData(RUN_COPY_KEY, [exercise('pe-1')])
    updateRestMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })

    await act(async () => { result.current.mutate({ id: 'pe-1', changes: { restSeconds: 15 } }) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(WEEK_KEY)).toBeUndefined()
    expect(queryClient.getQueryData(ALL_KEY)).toBeUndefined()
  })

  it('LINK / UNLINK marks the week caches stale once it succeeds (the block id is the server\'s to hand out, so it is not guessed)', async () => {
    const before = seed()
    createBlockMock.mockResolvedValue('blk-new')
    setBlockMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useToggleSupersetLink('wd-1'), { wrapper })

    await act(async () => { result.current.mutate([{ ids: ['pe-1', 'pe-s'], blockId: null, needsNewBlock: true }]) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(createBlockMock).toHaveBeenCalledWith('user-1', 'wd-1')
    expect(setBlockMock).toHaveBeenCalledWith(['pe-1', 'pe-s'], 'blk-new')
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans'], ['v2_weekPlan'], [...RUN_COPY_KEY]]))
    // (Marked stale, not rewritten: the cached copies still hold what they held until the refetch lands.)
    expect(rowOf(WEEK_KEY, 'wp-2', 'pe-1').supersetBlockId).toBeNull()
    expect(before.week2.exercises[0].supersetBlockId).toBeNull()
  })

  it('and a failed link refreshes nothing (it wrote nothing)', async () => {
    seed()
    createBlockMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useToggleSupersetLink('wd-1'), { wrapper })

    await act(async () => { result.current.mutate([{ ids: ['pe-1', 'pe-s'], blockId: null, needsNewBlock: true }]) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidated.filter((key) => key[0] === 'v2_weekPlans')).toEqual([])
  })
})
