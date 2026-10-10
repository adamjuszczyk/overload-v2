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
const week = (id: string, weekNumber: number, exercises: ProgramExercise[]): WeekPlan => ({
  id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null,
  sets: [], exercises, createdAt: '',
})

const WEEK_KEY = ['v2_weekPlans', 'meso-1', 2] as const
const OTHER_WEEK_KEY = ['v2_weekPlans', 'meso-1', 3] as const
const ALL_KEY = ['v2_allWeekPlans', 'meso-1'] as const
const RUN_COPY_KEY = ['v2_programExercises', 'wd-1'] as const

// Week 2 and week 3 both show the run copy's pe-1 and the week_only pe-s (a swapped-in row, which the run
// copy's own list does not hold).
function seed() {
  const week2 = week('wp-2', 2, [exercise('pe-1', { restSeconds: 90 }), exercise('pe-s', { position: 1 })])
  const week3 = week('wp-3', 3, [exercise('pe-1', { restSeconds: 90 }), exercise('pe-s', { position: 1 })])
  queryClient.setQueryData(WEEK_KEY, [week2])
  queryClient.setQueryData(OTHER_WEEK_KEY, [week3])
  queryClient.setQueryData(ALL_KEY, [week2, week3])
  queryClient.setQueryData(RUN_COPY_KEY, [exercise('pe-1', { restSeconds: 90 })])
  return { week2, week3 }
}
const rowOf = (key: readonly unknown[], planIndex: number, id: string) =>
  queryClient.getQueryData<WeekPlan[]>(key)![planIndex].exercises.find((e) => e.id === id)!

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
    await waitFor(() => expect(rowOf(WEEK_KEY, 0, 'pe-s').restSeconds).toBe(15))

    // Optimistic, before the write has answered: the week on screen, the other week, and the meso's history.
    expect(rowOf(OTHER_WEEK_KEY, 0, 'pe-s').restSeconds).toBe(15)
    expect(rowOf(ALL_KEY, 0, 'pe-s').restSeconds).toBe(15)
    expect(rowOf(ALL_KEY, 1, 'pe-s').restSeconds).toBe(15)
    // The other row of the week is untouched, and so are the row's other fields.
    expect(rowOf(WEEK_KEY, 0, 'pe-1').restSeconds).toBe(90)
    expect(rowOf(WEEK_KEY, 0, 'pe-s').restAfterSeconds).toBeNull()
    // The run copy's own list never held the week_only row, and still doesn't.
    expect(queryClient.getQueryData<ProgramExercise[]>(RUN_COPY_KEY)!.map((e) => e.id)).toEqual(['pe-1'])
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
    await waitFor(() => expect(rowOf(WEEK_KEY, 0, 'pe-1').restAfterSeconds).toBe(120))
    expect(queryClient.getQueryData<ProgramExercise[]>(RUN_COPY_KEY)![0].restAfterSeconds).toBe(120)
    expect(rowOf(OTHER_WEEK_KEY, 0, 'pe-1').restAfterSeconds).toBe(120)
    expect(rowOf(WEEK_KEY, 0, 'pe-1').restSeconds).toBe(90) // the other field of the same change is left alone
    expect(rowOf(WEEK_KEY, 0, 'pe-s').restAfterSeconds).toBeNull()
    write.resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a failed write puts every cache back as it was', async () => {
    const before = seed()
    const write = deferred()
    updateRestMock.mockReturnValue(write.promise)
    const { result } = renderHook(() => useUpdateProgramExerciseRest('wd-1'), { wrapper })

    act(() => { result.current.mutate({ id: 'pe-1', changes: { restSeconds: 150 } }) })
    await waitFor(() => expect(rowOf(WEEK_KEY, 0, 'pe-1').restSeconds).toBe(150))
    write.reject(new Error('offline'))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(queryClient.getQueryData(WEEK_KEY)).toEqual([before.week2])
    expect(queryClient.getQueryData(OTHER_WEEK_KEY)).toEqual([before.week3])
    expect(queryClient.getQueryData(ALL_KEY)).toEqual([before.week2, before.week3])
    expect(queryClient.getQueryData<ProgramExercise[]>(RUN_COPY_KEY)![0].restSeconds).toBe(90)
    // ... and they are still marked stale, so the next read is the server's.
    expect(invalidated).toEqual(expect.arrayContaining([['v2_weekPlans'], ['v2_allWeekPlans']]))
  })

  it('TEMPO and the UNIT are patched the same way (the unit is what a set\'s weight is shown in)', async () => {
    seed()
    updateTempoMock.mockResolvedValue(undefined)
    updateUnitMock.mockResolvedValue(undefined)
    const tempo = renderHook(() => useUpdateProgramExerciseTempo('wd-1'), { wrapper })
    const unit = renderHook(() => useUpdateProgramExerciseWeightUnit('wd-1'), { wrapper })

    await act(async () => { tempo.result.current.mutate({ id: 'pe-s', tempo: '3-1-X-0' }) })
    await waitFor(() => expect(tempo.result.current.isSuccess).toBe(true))
    expect(rowOf(WEEK_KEY, 0, 'pe-s').tempo).toBe('3-1-X-0')
    expect(rowOf(WEEK_KEY, 0, 'pe-1').tempo).toBeNull()
    expect(updateTempoMock).toHaveBeenCalledWith('pe-s', '3-1-X-0')

    await act(async () => { unit.result.current.mutate({ id: 'pe-1', weightUnit: 'lbs' }) })
    await waitFor(() => expect(unit.result.current.isSuccess).toBe(true))
    expect(rowOf(WEEK_KEY, 0, 'pe-1').weightUnit).toBe('lbs')
    expect(rowOf(ALL_KEY, 1, 'pe-1').weightUnit).toBe('lbs')
    expect(rowOf(WEEK_KEY, 0, 'pe-s').weightUnit).toBeNull()
    expect(updateUnitMock).toHaveBeenCalledWith('pe-1', 'lbs')
  })

  it('a failed TEMPO or UNIT write restores the week caches too', async () => {
    const before = seed()
    updateTempoMock.mockRejectedValue(new Error('offline'))
    updateUnitMock.mockRejectedValue(new Error('offline'))
    const tempo = renderHook(() => useUpdateProgramExerciseTempo('wd-1'), { wrapper })
    const unit = renderHook(() => useUpdateProgramExerciseWeightUnit('wd-1'), { wrapper })

    await act(async () => { tempo.result.current.mutate({ id: 'pe-1', tempo: '2-0-2-0' }) })
    await waitFor(() => expect(tempo.result.current.isError).toBe(true))
    await act(async () => { unit.result.current.mutate({ id: 'pe-1', weightUnit: 'kg' }) })
    await waitFor(() => expect(unit.result.current.isError).toBe(true))

    expect(queryClient.getQueryData(WEEK_KEY)).toEqual([before.week2])
    expect(queryClient.getQueryData(ALL_KEY)).toEqual([before.week2, before.week3])
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
    await waitFor(() => expect(rowOf(WEEK_KEY, 0, 'pe-s').restSeconds).toBe(15))
    stale.resolve()
    await inFlight
    expect(rowOf(WEEK_KEY, 0, 'pe-s').restSeconds).toBe(15)

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
    expect(rowOf(WEEK_KEY, 0, 'pe-1').supersetBlockId).toBeNull()
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
