// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import { format, getDay } from 'date-fns'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

// Chunk 65: the three writers the PROGRAMS tab calls, through their REAL hooks on the app's own query client (RULES: "a screen test that must
// see a write's effect through the real hooks gives QueryClientProvider the app's own queryClient"). The screens mock these hooks; this is
// where what they promise is proven.
//
//   - START (`useStartRun`): the run is written once, with today's date; the mutation then stays pending until the run list AND the programs
//     have been read again, whichever answers last, so Plan, which both START buttons navigate to the moment it resolves, opens on the new
//     run and not on the list as it was before (a stale list reads "no program running" for a moment). A refetch that fails doesn't fail
//     a start that happened.
//   - FINISH (`useCompleteMeso`): the same wait on the run list.
//   - CREATE PROGRAM (`useCreateProgram`): the user, the name and BOTH types reach the service, as chosen.
//   - All three are `networkMode: 'always'` (CONTEXT.md, Offline: every write mutation is): offline they run and fail with the service's own
//     error, which the sheets show as the real reason (SPEC Errors (15)); with the default they would pause for ever behind STARTING….
//   - DELETE (`useDeleteSavedProgram`, chunk 74): the id reaches the service once; the mutation stays pending until BOTH program lists have been
//     read again — ['v2_programs'] and the ['v2_programs', 'saved'] YOUR PROGRAMS reads, which the first reaches by TanStack's prefix matching —
//     and re-reads nothing else; never paused offline; a failed delete re-reads nothing.
//
// Nothing about the cache or the invalidation is mocked: only the services.

const startRunMock = vi.fn()
const completeMesoMock = vi.fn()
const createProgramMock = vi.fn()
const deleteSavedProgramMock = vi.fn()
vi.mock('./runService', () => ({ startRun: (...args: unknown[]) => startRunMock(...args) }))
vi.mock('./mesoService', () => ({
  fetchMesos: vi.fn(),
  completeMeso: (...args: unknown[]) => completeMesoMock(...args),
  // the full delete's three requests (chunk 75): `useMesos` imports them, this file never calls them (`finishedProgram.writers.test.tsx` does)
  deleteFinishedRun: vi.fn(),
  fetchFinishedRunCounts: vi.fn(),
  fetchFinishedRunSessionIds: vi.fn(),
}))
vi.mock('./finishedRunQueue', () => ({ dropQueuedWritesOfDeletedRun: vi.fn() }))
vi.mock('./programService', () => ({
  createProgram: (...args: unknown[]) => createProgramMock(...args),
  deleteSavedProgram: (...args: unknown[]) => deleteSavedProgramMock(...args),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { useStartRun, useCompleteMeso } = await import('./useMesos')
const { useCreateProgram, useDeleteSavedProgram } = await import('./usePrograms')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void; promise: Promise<unknown> }
const deferred = (): Deferred => {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise }
}

// Two active queries under the keys the writers invalidate, each fetch a promise the test holds open: [0] is the first load, [1] the refetch.
const MESOS = ['v2_mesos']
const PROGRAMS = ['v2_programs']
const PROGRAMS_SAVED = ['v2_programs', 'saved']
const fetches: Record<string, Deferred[]> = { mesos: [], programs: [], saved: [] }
const nextFetch = (name: 'mesos' | 'programs' | 'saved') => {
  const d = deferred()
  fetches[name].push(d)
  return d.promise
}

function mountReads() {
  return renderHook(
    () => {
      useQuery({ queryKey: MESOS, queryFn: () => nextFetch('mesos') })
      useQuery({ queryKey: PROGRAMS, queryFn: () => nextFetch('programs') })
    },
    { wrapper },
  )
}

async function loaded() {
  await waitFor(() => expect(fetches.mesos).toHaveLength(1))
  await waitFor(() => expect(fetches.programs).toHaveLength(1))
  await act(async () => {
    fetches.mesos[0].resolve([])
    fetches.programs[0].resolve([])
  })
}

// The same two reads plus YOUR PROGRAMS' own (chunk 74): the third key is a child of the second, which is what DELETE's one invalidation has to reach.
function mountReadsWithSaved() {
  return renderHook(
    () => {
      useQuery({ queryKey: MESOS, queryFn: () => nextFetch('mesos') })
      useQuery({ queryKey: PROGRAMS, queryFn: () => nextFetch('programs') })
      useQuery({ queryKey: PROGRAMS_SAVED, queryFn: () => nextFetch('saved') })
    },
    { wrapper },
  )
}

async function loadedWithSaved() {
  await waitFor(() => expect(fetches.mesos).toHaveLength(1))
  await waitFor(() => expect(fetches.programs).toHaveLength(1))
  await waitFor(() => expect(fetches.saved).toHaveLength(1))
  await act(async () => {
    fetches.mesos[0].resolve([])
    fetches.programs[0].resolve([])
    fetches.saved[0].resolve([])
  })
}

beforeEach(() => {
  fetches.mesos = []
  fetches.programs = []
  fetches.saved = []
})
afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  vi.useRealTimers()
  startRunMock.mockReset()
  completeMesoMock.mockReset()
  createProgramMock.mockReset()
  deleteSavedProgramMock.mockReset()
  queryClient.clear()
})

const settled = (promise: Promise<unknown>) => {
  const state = { done: false, error: undefined as unknown }
  promise.then(() => { state.done = true }, (error) => { state.done = true; state.error = error })
  return state
}
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('START — useStartRun', () => {
  it('writes the run once, with the program, the name and today\'s date (a Wednesday here: the date is printed)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0, 0))
    expect(format(new Date(), 'yyyy-MM-dd EEEE')).toBe('2026-10-21 Wednesday')
    expect(getDay(new Date())).toBe(3)
    startRunMock.mockResolvedValue('meso-new')
    const { result } = renderHook(() => useStartRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'My Block', programId: 'prog-7' })
    })

    expect(startRunMock).toHaveBeenCalledTimes(1)
    expect(startRunMock).toHaveBeenCalledWith('prog-7', 'My Block', '2026-10-21')
  })

  it('stays pending until the run list and the programs have both been read again, whichever answers last', async () => {
    for (const lastToAnswer of ['mesos', 'programs'] as const) {
      fetches.mesos = []
      fetches.programs = []
      queryClient.clear()
      startRunMock.mockResolvedValue('meso-new')
      const reads = mountReads()
      await loaded()
      const { result } = renderHook(() => useStartRun(), { wrapper })

      let outcome!: ReturnType<typeof settled>
      await act(async () => {
        outcome = settled(result.current.mutateAsync({ name: 'X', programId: 'prog-1' }))
      })
      await waitFor(() => expect(fetches.mesos).toHaveLength(2))
      await waitFor(() => expect(fetches.programs).toHaveLength(2))
      await tick()
      expect(outcome.done, `${lastToAnswer} last: still waiting on both`).toBe(false)
      expect(result.current.isPending).toBe(true)

      const first = lastToAnswer === 'mesos' ? 'programs' : 'mesos'
      await act(async () => {
        fetches[first][1].resolve([])
      })
      await tick()
      expect(outcome.done, `${first} answered, ${lastToAnswer} hasn't: still pending`).toBe(false)

      await act(async () => {
        fetches[lastToAnswer][1].resolve([])
      })
      await waitFor(() => expect(outcome.done).toBe(true))
      expect(result.current.isSuccess).toBe(true)
      reads.unmount()
    }
  })

  it('a refetch that fails after the start has happened does not turn it into a failed start', async () => {
    startRunMock.mockResolvedValue('meso-new')
    mountReads()
    await loaded()
    const { result } = renderHook(() => useStartRun(), { wrapper })

    let outcome!: ReturnType<typeof settled>
    await act(async () => {
      outcome = settled(result.current.mutateAsync({ name: 'X', programId: 'prog-1' }))
    })
    await waitFor(() => expect(fetches.mesos).toHaveLength(2))
    await waitFor(() => expect(fetches.programs).toHaveLength(2))
    await act(async () => {
      fetches.mesos[1].reject(new Error('refetch failed'))
      fetches.programs[1].reject(new Error('refetch failed'))
      // the queries' own retry (one, in the app's client) asks again: let those fail too
      await new Promise((resolve) => setTimeout(resolve, 1200))
      for (const f of [...fetches.mesos, ...fetches.programs]) f.reject(new Error('refetch failed'))
    })
    await waitFor(() => expect(outcome.done).toBe(true))
    expect(outcome.error).toBeUndefined()
    expect(result.current.isSuccess).toBe(true)
  })

  it('never pauses when TanStack thinks it is offline: it runs, and a failure keeps the service\'s own error (the real reason, SPEC Errors 15)', async () => {
    startRunMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useStartRun(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ name: 'X', programId: 'prog-1' })
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(startRunMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toEqual({ message: 'Failed to fetch' })
  })

  it('a failed start invalidates nothing: no list is read again for a start that did not happen', async () => {
    startRunMock.mockRejectedValue(new Error('v2_start_run: program is not a saved program'))
    mountReads()
    await loaded()
    const { result } = renderHook(() => useStartRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'X', programId: 'prog-1' }).catch(() => undefined)
    })
    await tick()

    expect(fetches.mesos).toHaveLength(1)
    expect(fetches.programs).toHaveLength(1)
  })
})

describe('FINISH — useCompleteMeso', () => {
  it('finishes the run it is given, and stays pending until the run list has been read again', async () => {
    completeMesoMock.mockResolvedValue(undefined)
    mountReads()
    await loaded()
    const { result } = renderHook(() => useCompleteMeso(), { wrapper })

    let outcome!: ReturnType<typeof settled>
    await act(async () => {
      outcome = settled(result.current.mutateAsync('meso-4'))
    })
    expect(completeMesoMock).toHaveBeenCalledTimes(1)
    expect(completeMesoMock).toHaveBeenCalledWith('meso-4')
    await waitFor(() => expect(fetches.mesos).toHaveLength(2))
    await tick()
    expect(outcome.done).toBe(false)
    expect(result.current.isPending).toBe(true)

    await act(async () => {
      fetches.mesos[1].resolve([])
    })
    await waitFor(() => expect(outcome.done).toBe(true))
    expect(result.current.isSuccess).toBe(true)
  })

  it('never pauses when TanStack thinks it is offline', async () => {
    completeMesoMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useCompleteMeso(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate('meso-4')
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(completeMesoMock).toHaveBeenCalledTimes(1)
  })
})

describe('CREATE PROGRAM — useCreateProgram', () => {
  it.each([
    ['sequence', 'stable'],
    ['weekday', 'week_dependent'],
  ] as const)('hands the service the signed-in user, the name and both types as chosen (%s + %s), and returns the program it made', async (scheduleType, planningType) => {
    createProgramMock.mockResolvedValue({ id: 'prog-new', name: 'Block' })
    const { result } = renderHook(() => useCreateProgram(), { wrapper })

    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync({ name: 'Block', scheduleType, planningType })
    })

    expect(createProgramMock).toHaveBeenCalledTimes(1)
    expect(createProgramMock).toHaveBeenCalledWith('user-1', 'Block', { scheduleType, planningType })
    expect(created).toEqual({ id: 'prog-new', name: 'Block' })
  })

  it('refreshes the programs, which is where the new one shows (YOUR PROGRAMS)', async () => {
    createProgramMock.mockResolvedValue({ id: 'prog-new', name: 'Block' })
    mountReads()
    await loaded()
    const { result } = renderHook(() => useCreateProgram(), { wrapper })

    await act(async () => {
      void result.current.mutateAsync({ name: 'Block', scheduleType: 'weekday', planningType: 'stable' })
    })

    await waitFor(() => expect(fetches.programs).toHaveLength(2))
    expect(fetches.mesos).toHaveLength(1)
  })

  it('never pauses when TanStack thinks it is offline', async () => {
    createProgramMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useCreateProgram(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ name: 'Block', scheduleType: 'weekday', planningType: 'stable' })
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(createProgramMock).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE — useDeleteSavedProgram (chunk 74)', () => {
  it('hands the service the id it is given, once', async () => {
    deleteSavedProgramMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteSavedProgram(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('prog-3')
    })

    expect(deleteSavedProgramMock).toHaveBeenCalledTimes(1)
    expect(deleteSavedProgramMock).toHaveBeenCalledWith('prog-3')
  })

  it('stays pending until the program list AND the saved list (YOUR PROGRAMS\' own key, a child of the first) have been read again, whichever answers last; nothing else is read again', async () => {
    for (const lastToAnswer of ['programs', 'saved'] as const) {
      fetches.mesos = []
      fetches.programs = []
      fetches.saved = []
      queryClient.clear()
      deleteSavedProgramMock.mockResolvedValue(undefined)
      const reads = mountReadsWithSaved()
      await loadedWithSaved()
      const { result } = renderHook(() => useDeleteSavedProgram(), { wrapper })

      let outcome!: ReturnType<typeof settled>
      await act(async () => {
        outcome = settled(result.current.mutateAsync('prog-1'))
      })
      await waitFor(() => expect(fetches.programs).toHaveLength(2))
      await waitFor(() => expect(fetches.saved).toHaveLength(2))
      await tick()
      expect(outcome.done, `${lastToAnswer} last: still waiting on both`).toBe(false)
      expect(result.current.isPending).toBe(true)

      const first = lastToAnswer === 'programs' ? 'saved' : 'programs'
      await act(async () => {
        fetches[first][1].resolve([])
      })
      await tick()
      expect(outcome.done, `${first} answered, ${lastToAnswer} hasn't: still pending`).toBe(false)

      await act(async () => {
        fetches[lastToAnswer][1].resolve([])
      })
      await waitFor(() => expect(outcome.done).toBe(true))
      expect(result.current.isSuccess).toBe(true)
      // a delete changes no run: the run list is not read again
      expect(fetches.mesos).toHaveLength(1)
      reads.unmount()
    }
  })

  it('a refetch that fails after the delete has happened does not turn it into a failed delete', async () => {
    deleteSavedProgramMock.mockResolvedValue(undefined)
    mountReadsWithSaved()
    await loadedWithSaved()
    const { result } = renderHook(() => useDeleteSavedProgram(), { wrapper })

    let outcome!: ReturnType<typeof settled>
    await act(async () => {
      outcome = settled(result.current.mutateAsync('prog-1'))
    })
    await waitFor(() => expect(fetches.programs).toHaveLength(2))
    await waitFor(() => expect(fetches.saved).toHaveLength(2))
    await act(async () => {
      fetches.programs[1].reject(new Error('refetch failed'))
      fetches.saved[1].reject(new Error('refetch failed'))
      // the queries' own retry (one, in the app's client) asks again: let those fail too
      await new Promise((resolve) => setTimeout(resolve, 1200))
      for (const f of [...fetches.programs, ...fetches.saved]) f.reject(new Error('refetch failed'))
    })
    await waitFor(() => expect(outcome.done).toBe(true))
    expect(outcome.error).toBeUndefined()
    expect(result.current.isSuccess).toBe(true)
  })

  it('never pauses when TanStack thinks it is offline: it runs, and a failure keeps the service\'s own error (the real reason, SPEC Errors 15)', async () => {
    deleteSavedProgramMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useDeleteSavedProgram(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate('prog-1')
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(deleteSavedProgramMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toEqual({ message: 'Failed to fetch' })
  })

  it('a refused delete (the database said OL002) invalidates nothing: no list is read again for a delete that did not happen, and the error keeps its code', async () => {
    const refusal = { code: 'OL002', message: 'a program with a running program cannot be deleted: finish it first' }
    deleteSavedProgramMock.mockRejectedValue(refusal)
    mountReadsWithSaved()
    await loadedWithSaved()
    const { result } = renderHook(() => useDeleteSavedProgram(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('prog-1').catch(() => undefined)
    })
    await tick()

    expect(result.current.error).toBe(refusal)
    expect(fetches.mesos).toHaveLength(1)
    expect(fetches.programs).toHaveLength(1)
    expect(fetches.saved).toHaveLength(1)
  })
})
