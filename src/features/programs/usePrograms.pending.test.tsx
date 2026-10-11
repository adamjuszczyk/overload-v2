// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { ProgramExercise, WeekPlan } from '../../types'

// Chunk 30 (retry). A mutation awaits what its onSettled / onSuccess returns, so on master a link, a REST,
// a TEMPO or a unit write stayed `isPending` until the run copy's list had refetched
// (`onSuccess: () => queryClient.invalidateQueries(...)`). Link toggles are disabled while a link is
// pending (`disabled={toggleLink.isPending}`: the planner's, the program tab's and the STRUCTURE view's),
// so that wait is what keeps a second tap from planning off rows the first one has already changed.
//
// Chunk 30 made these hooks refresh Plan's week caches too, and wrote that as a block body that returned
// nothing: `isPending` cleared the moment the database write finished, while the caches still held the old
// superset blocks. These tests run the REAL hooks on the app's real query client with ACTIVE queries on the
// run copy and on every week cache, hold each refetch open, and check the mutation is still pending until
// every one of them has answered — whichever answers last (a hook that waited for all but one is as wrong
// as one that waited for none). Nothing about the cache or the invalidation is mocked: only the writes.

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

const exercise = (id: string, position: number): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'user-1', exerciseId: `ex-${id}`, position, weightUnit: null,
  restSeconds: null, restAfterSeconds: null, tempo: null, supersetBlockId: null,
})
const weekPlan: WeekPlan = {
  id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null,
  sets: [], exercises: [exercise('pe-1', 0), exercise('pe-2', 1)], createdAt: '',
}

// The four caches a write refreshes, with what each holds once loaded.
const CACHES = {
  'the run copy': { key: ['v2_programExercises', 'wd-1'], data: [exercise('pe-1', 0), exercise('pe-2', 1)] },
  'the week on screen': { key: ['v2_weekPlans', 'meso-1', 2], data: [weekPlan] },
  'the meso\'s history': { key: ['v2_allWeekPlans', 'meso-1'], data: [weekPlan] },
  'the planned session': { key: ['v2_weekPlan', 'wp-2'], data: weekPlan },
} as const
type CacheName = keyof typeof CACHES
const CACHE_NAMES = Object.keys(CACHES) as CacheName[]

type Deferred = { resolve: (value: unknown) => void; promise: Promise<unknown> }
const deferred = (): Deferred => {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((res) => { resolve = res })
  return { resolve, promise }
}

// Every fetch of a cache is a promise the test holds open and answers by hand: [0] is the first load,
// [1] the refetch the write asks for.
let fetches: Record<CacheName, Deferred[]>
function useHeldQuery(name: CacheName) {
  return useQuery({
    queryKey: CACHES[name].key,
    queryFn: () => {
      const next = deferred()
      fetches[name].push(next)
      return next.promise
    },
    staleTime: Infinity,
    retry: false,
  })
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

type Mutation = { mutate: (vars: never) => void; isPending: boolean; isError: boolean; isSuccess: boolean }

// A hook under test, mounted next to an ACTIVE query on each of the four caches, all loaded.
async function mount(useHook: () => unknown) {
  fetches = { 'the run copy': [], 'the week on screen': [], 'the meso\'s history': [], 'the planned session': [] }
  const rendered = renderHook(
    () => {
      useHeldQuery('the run copy')
      useHeldQuery('the week on screen')
      useHeldQuery('the meso\'s history')
      useHeldQuery('the planned session')
      return useHook() as Mutation
    },
    { wrapper },
  )
  await waitFor(() => expect(CACHE_NAMES.every((name) => fetches[name].length === 1)).toBe(true))
  await act(async () => { for (const name of CACHE_NAMES) fetches[name][0].resolve(CACHES[name].data) })
  await waitFor(() => expect(CACHE_NAMES.every((name) => queryClient.getQueryData(CACHES[name].key) !== undefined)).toBe(true))
  return rendered
}

const refetchesStarted = () => CACHE_NAMES.every((name) => fetches[name].length === 2)

// The query client passes a change on to React on a timer of its own, so "the mutation is still pending" is
// only proven once those timers have had their turn: without the wait, a mutation that had already finished
// would still read as pending here and the test would pass for the wrong reason.
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })

afterEach(() => {
  cleanup()
  for (const m of [updateRestMock, updateTempoMock, updateUnitMock, createBlockMock, setBlockMock]) m.mockReset()
  queryClient.clear()
})

// Each hook, a write that goes through (or fails), and the call that must have happened.
const HOOKS: Record<string, { use: () => unknown; vars: unknown; write: ReturnType<typeof vi.fn>; arrange: (fails: boolean) => void }> = {
  REST: {
    use: () => useUpdateProgramExerciseRest('wd-1'), vars: { id: 'pe-1', changes: { restSeconds: 120 } }, write: updateRestMock,
    arrange: (fails) => (fails ? updateRestMock.mockRejectedValue(new Error('offline')) : updateRestMock.mockResolvedValue(undefined)),
  },
  TEMPO: {
    use: () => useUpdateProgramExerciseTempo('wd-1'), vars: { id: 'pe-1', tempo: '3-1-1-0' }, write: updateTempoMock,
    arrange: (fails) => (fails ? updateTempoMock.mockRejectedValue(new Error('offline')) : updateTempoMock.mockResolvedValue(undefined)),
  },
  UNIT: {
    use: () => useUpdateProgramExerciseWeightUnit('wd-1'), vars: { id: 'pe-1', weightUnit: 'lbs' }, write: updateUnitMock,
    arrange: (fails) => (fails ? updateUnitMock.mockRejectedValue(new Error('offline')) : updateUnitMock.mockResolvedValue(undefined)),
  },
  LINK: {
    use: () => useToggleSupersetLink('wd-1'), vars: [{ ids: ['pe-1', 'pe-2'], blockId: null, needsNewBlock: true }], write: setBlockMock,
    arrange: () => { createBlockMock.mockResolvedValue('blk-new'); setBlockMock.mockResolvedValue(undefined) },
  },
}

describe('a run-wide write stays pending until the run copy and every week cache have refetched (what disables the link toggles)', () => {
  const CASES = Object.keys(HOOKS).flatMap((hook) => CACHE_NAMES.map((last) => [hook, last] as const))

  it.each(CASES)('%s: pending until the refetches have answered, %s answering last', async (hook, last) => {
    const { write, arrange, use, vars } = HOOKS[hook]
    arrange(false)
    const { result } = await mount(use)

    act(() => { result.current.mutate(vars as never) })
    // The write is done once every cache has been asked again (a write that has not answered asks for nothing) ...
    await waitFor(() => expect(refetchesStarted()).toBe(true))
    expect(write).toHaveBeenCalledTimes(1)
    // ... and the mutation is still pending: the caches hold the rows from before it.
    await settle()
    expect(result.current.isPending).toBe(true)

    const others = CACHE_NAMES.filter((name) => name !== last)
    for (const name of others) {
      await act(async () => { fetches[name][1].resolve(CACHES[name].data) })
      await settle()
      expect(result.current.isPending, `${hook} stopped waiting once ${name} had answered, with ${last} still out`).toBe(true)
    }
    await act(async () => { fetches[last][1].resolve(CACHES[last].data) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isPending).toBe(false)
  })

  // A failed write settles too (master's onSettled ran either way): the old values go back, the caches
  // are asked again, and the mutation is over only when they have answered.
  it.each(['REST', 'TEMPO', 'UNIT'])('%s: a write that fails waits for the refetches before it is over', async (hook) => {
    const { write, arrange, use, vars } = HOOKS[hook]
    arrange(true)
    const { result } = await mount(use)

    act(() => { result.current.mutate(vars as never) })
    await waitFor(() => expect(refetchesStarted()).toBe(true))
    expect(write).toHaveBeenCalledTimes(1)
    await settle()
    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)

    for (const name of CACHE_NAMES) {
      expect(result.current.isPending, `${hook} stopped waiting before ${name} had answered`).toBe(true)
      await act(async () => { fetches[name][1].resolve(CACHES[name].data) })
      await settle()
    }
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isPending).toBe(false)
  })

  it('LINK: a link that fails refetches nothing, and is over at once (as on master: its onSuccess never ran)', async () => {
    createBlockMock.mockRejectedValue(new Error('offline'))
    const { result } = await mount(HOOKS.LINK.use)

    act(() => { result.current.mutate(HOOKS.LINK.vars as never) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isPending).toBe(false)
    expect(CACHE_NAMES.every((name) => fetches[name].length === 1)).toBe(true)
  })
})
