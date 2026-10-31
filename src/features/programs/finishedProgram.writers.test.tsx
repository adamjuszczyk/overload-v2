// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

// Chunk 66 and chunk 75: the two hooks behind a finished program's full delete (PR15; 1.2.1 item 8b), through their REAL code on the app's own query client
// (RULES: "a screen test that must see a write's effect through the real hooks gives QueryClientProvider the app's own queryClient"). The screens mock them
// (`FinishedProgramPage.test.tsx`, `FullDeleteConfirm.test.tsx`, `HistorySessions.wording.test.tsx`); this is where their own promises are proven. Only the
// services are mocked, and the phone's queue (`finishedRunQueue.ts`, proven on its own in `finishedRun.queue.test.tsx`: it is called here, with what).
//
// `useFinishedRunCounts(id, enabled)`, what the confirmation counts with:
//   - reads nothing until it is enabled (the confirmation is open and the phone online), and then reads the counts AND the program's session ids, each with
//     the program's id, and answers only when both have;
//   - one failing read fails the whole thing, and is not asked again; closing the confirmation drops the answer (the next opening counts again);
//   - `networkMode: 'always'`: it never waits on TanStack's own idea of the connection.
//
// `useDeleteFinishedRun`, behind both entry points (DELETE THIS FINISHED PROGRAM; History's program filter):
//   - the program it is given is the program the service deletes, once, and ONLY after that has gone through does the phone's queue drop the writes of
//     each session (a delete that fails drops nothing, refreshes nothing);
//   - it refreshes what History's own session delete and the finish refresh, and Coach's lists (ten keys), and removes each deleted session's own reads;
//   - it stays pending until the lists have been read again, so PROGRAMS, which the finished page opens the moment it resolves, doesn't draw the list as
//     it was (RULES: "a write followed by a navigation returns its invalidations from `onSuccess`"); a refetch that fails doesn't turn a delete that happened
//     into a failed delete;
//   - `networkMode: 'always'` (CONTEXT.md, Offline): offline it runs and fails with the service's own error, which the confirmation shows as the real reason.

const deleteRunMock = vi.fn()
const countsMock = vi.fn()
const sessionIdsMock = vi.fn()
const dropMock = vi.fn()
vi.mock('./mesoService', () => ({
  fetchMesos: vi.fn(),
  completeMeso: vi.fn(),
  deleteFinishedRun: (...args: unknown[]) => deleteRunMock(...args),
  fetchFinishedRunCounts: (...args: unknown[]) => countsMock(...args),
  fetchFinishedRunSessionIds: (...args: unknown[]) => sessionIdsMock(...args),
}))
vi.mock('./finishedRunQueue', () => ({ dropQueuedWritesOfDeletedRun: (...args: unknown[]) => dropMock(...args) }))
vi.mock('./runService', () => ({ startRun: vi.fn() }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { useDeleteFinishedRun, useFinishedRunCounts } = await import('./useMesos')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void; promise: Promise<unknown> }
const deferred = (): Deferred => {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise }
}

const COUNTS = { weeks: 3, sessions: 9, loggedSets: 66, coachAnalyses: 3, coachNotes: 1 }

// Active queries under the keys a deleted program changes, each fetch a promise the test holds open: [0] is the first load, [1] the refetch.
const KEYS = { mesos: ['v2_mesos'], history: ['v2_history'], progress: ['v2_mesoProgress'], programs: ['v2_programs'] }
const fetches: Record<keyof typeof KEYS, Deferred[]> = { mesos: [], history: [], progress: [], programs: [] }
const names = Object.keys(KEYS) as Array<keyof typeof KEYS>
const nextFetch = (name: keyof typeof KEYS) => {
  const d = deferred()
  fetches[name].push(d)
  return d.promise
}
function mountReads() {
  return renderHook(
    () => {
      useQuery({ queryKey: KEYS.mesos, queryFn: () => nextFetch('mesos') })
      useQuery({ queryKey: KEYS.history, queryFn: () => nextFetch('history') })
      useQuery({ queryKey: KEYS.progress, queryFn: () => nextFetch('progress') })
      useQuery({ queryKey: KEYS.programs, queryFn: () => nextFetch('programs') })
    },
    { wrapper },
  )
}
async function loaded() {
  for (const name of names) await waitFor(() => expect(fetches[name]).toHaveLength(1))
  await act(async () => {
    for (const name of names) fetches[name][0].resolve([])
  })
}

beforeEach(() => {
  for (const name of names) fetches[name] = []
  deleteRunMock.mockReset()
  countsMock.mockReset()
  sessionIdsMock.mockReset()
  dropMock.mockReset()
  dropMock.mockImplementation(async (_id: string, ids: readonly string[]) => [...ids])
})
afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
  queryClient.clear()
})

const settled = (promise: Promise<unknown>) => {
  const state = { done: false, error: undefined as unknown }
  promise.then(() => { state.done = true }, (error) => { state.done = true; state.error = error })
  return state
}
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('COUNT — useFinishedRunCounts(id, enabled)', () => {
  beforeEach(() => {
    countsMock.mockResolvedValue(COUNTS)
    sessionIdsMock.mockResolvedValue(['s-1', 's-2'])
  })

  it('reads nothing while it is not enabled, however long it waits (the confirmation is closed, or the phone is offline)', async () => {
    const { result } = renderHook(() => useFinishedRunCounts('meso-4', false), { wrapper })
    await tick()
    await tick()
    expect(countsMock).not.toHaveBeenCalled()
    expect(sessionIdsMock).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('once enabled it reads the counts and the session ids, each with the program\'s id, once, and answers both', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useFinishedRunCounts('meso-4', enabled), { wrapper, initialProps: { enabled: false } })
    await tick()
    expect(countsMock).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(countsMock).toHaveBeenCalledTimes(1)
    expect(countsMock).toHaveBeenCalledWith('meso-4')
    expect(sessionIdsMock).toHaveBeenCalledTimes(1)
    expect(sessionIdsMock).toHaveBeenCalledWith('meso-4')
    expect(result.current.data).toEqual({ counts: COUNTS, sessionIds: ['s-1', 's-2'] })
  })

  it('answers only when BOTH reads have: the counts in hand with the ids still out is not an answer', async () => {
    const ids = deferred()
    sessionIdsMock.mockReturnValue(ids.promise)
    const { result } = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })

    await waitFor(() => expect(countsMock).toHaveBeenCalledTimes(1))
    await tick()
    expect(result.current.data).toBeUndefined()
    expect(result.current.isSuccess).toBe(false)

    await act(async () => { ids.resolve(['s-1']) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.sessionIds).toEqual(['s-1'])
  })

  it('either read failing fails it, with that read\'s own error, and neither is asked again', async () => {
    countsMock.mockRejectedValue({ code: 'OL003', message: 'only a finished program can be deleted' })
    const first = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })
    await waitFor(() => expect(first.result.current.isError).toBe(true))
    expect(first.result.current.error).toEqual({ code: 'OL003', message: 'only a finished program can be deleted' })
    expect(first.result.current.data).toBeUndefined()
    first.unmount()
    queryClient.clear()

    countsMock.mockResolvedValue(COUNTS)
    sessionIdsMock.mockRejectedValue({ message: 'JWT expired' })
    countsMock.mockClear()
    sessionIdsMock.mockClear()
    const second = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })
    await waitFor(() => expect(second.result.current.isError).toBe(true))
    expect(second.result.current.error).toEqual({ message: 'JWT expired' })
    expect(second.result.current.data).toBeUndefined()
    // not retried into a better answer: the app's client retries a failed read once, this one must not
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)) })
    expect(countsMock).toHaveBeenCalledTimes(1)
    expect(sessionIdsMock).toHaveBeenCalledTimes(1)
  })

  it('is not kept: the confirmation closed and opened again counts again, and does not name the old count meanwhile', async () => {
    const first = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    first.unmount()
    await tick() // gcTime 0: the answer is collected on the next tick
    expect(queryClient.getQueryCache().findAll({ queryKey: ['v2_finishedRunCounts'] })).toHaveLength(0)

    countsMock.mockResolvedValue({ ...COUNTS, sessions: 10 })
    const held = deferred()
    sessionIdsMock.mockReturnValue(held.promise)
    const second = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })
    await tick()
    expect(countsMock).toHaveBeenCalledTimes(2)
    expect(second.result.current.data).toBeUndefined()
    await act(async () => { held.resolve(['s-1', 's-2', 's-3']) })
    await waitFor(() => expect(second.result.current.data?.counts.sessions).toBe(10))
  })

  it('never waits on TanStack\'s idea of the connection (networkMode always): it runs when it is enabled, and a failure is the real reason', async () => {
    onlineManager.setOnline(false)
    countsMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.fetchStatus).not.toBe('paused')
    expect(result.current.error).toEqual({ message: 'Failed to fetch' })
    expect(countsMock).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE — useDeleteFinishedRun', () => {
  it('deletes the program it is given, once, and hands the phone\'s queue the same id and the session ids it was given', async () => {
    deleteRunMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1', 's-2'] })
    })

    expect(deleteRunMock).toHaveBeenCalledTimes(1)
    expect(deleteRunMock).toHaveBeenCalledWith('meso-4')
    expect(dropMock).toHaveBeenCalledTimes(1)
    expect(dropMock).toHaveBeenCalledWith('meso-4', ['s-1', 's-2'])
  })

  it('the queue is dropped only after the request has gone through, never before and never when it fails', async () => {
    const request = deferred()
    deleteRunMock.mockReturnValue(request.promise)
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    let outcome!: ReturnType<typeof settled>
    await act(async () => {
      outcome = settled(result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1'] }))
    })
    await tick()
    expect(deleteRunMock).toHaveBeenCalledTimes(1)
    expect(dropMock).not.toHaveBeenCalled() // the request is still out
    await act(async () => { request.reject({ code: 'OL003', message: 'only a finished program can be deleted' }) })
    await waitFor(() => expect(outcome.done).toBe(true))
    expect(outcome.error).toEqual({ code: 'OL003', message: 'only a finished program can be deleted' })
    expect(dropMock).not.toHaveBeenCalled() // and it failed
  })

  it('a failed delete invalidates nothing and removes nothing: no list is read again for a delete that did not happen', async () => {
    deleteRunMock.mockRejectedValue(new Error('permission denied for function v2_delete_finished_run'))
    mountReads()
    await loaded()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const remove = vi.spyOn(queryClient, 'removeQueries')
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1'] }).catch(() => undefined)
    })
    await tick()

    expect(invalidate).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    for (const name of names) expect(fetches[name]).toHaveLength(1)
  })

  it('refreshes exactly what History\'s session delete and the finish refresh, then Coach\'s ten lists, and nothing else', async () => {
    deleteRunMock.mockResolvedValue(undefined)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1', 's-2'] })
    })

    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey)
    expect(keys).toEqual([
      ['v2_mesos'],
      ['v2_history'],
      ['v2_sessions'],
      ['v2_doneWeekPlanIds'],
      ['v2_sessionTypeHistory'],
      ['v2_referenceSessions'],
      ['v2_lastDoneOrSkippedSession'],
      ['v2_exerciseProgress'],
      ['v2_mesoProgress'],
      ['v2_positionMatchedHeadline'],
      ['v2_positionMatchTable'],
      ['v2_programs'],
      ['v2_coachNotes'],
      ['v2_coachAnalyzableSessions'],
      ['v2_coachAnalyses'],
      ['v2_coachAnalysisDetail'],
      ['v2_coachAnalyzableWeeks'],
      ['v2_coachWeekAnalyses'],
      ['v2_coachWeekAnalysisDetail'],
      ['v2_coachAnalyzableMesos'],
      ['v2_coachMesoAnalyses'],
      ['v2_coachMesoAnalysisDetail'],
    ])
  })

  it('removes each deleted session\'s own reads, for every session the queue clean-up dealt with — the server\'s and the ones only the queue knew', async () => {
    deleteRunMock.mockResolvedValue(undefined)
    dropMock.mockResolvedValue(['s-1', 's-2', 's-queued'])
    const remove = vi.spyOn(queryClient, 'removeQueries')
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1', 's-2'] })
    })

    const keys = remove.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey)
    for (const id of ['s-1', 's-2', 's-queued']) {
      expect(keys).toContainEqual(['v2_historyDetail', id])
      expect(keys).toContainEqual(['v2_session', id])
      expect(keys).toContainEqual(['v2_sessionSwaps', id])
    }
    expect(keys).toHaveLength(9)
  })

  it('a cached History detail of a deleted session is gone from the cache, another session\'s stays', async () => {
    deleteRunMock.mockResolvedValue(undefined)
    queryClient.setQueryData(['v2_historyDetail', 's-1'], { id: 's-1' })
    queryClient.setQueryData(['v2_historyDetail', 's-other'], { id: 's-other' })
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1'] })
    })

    expect(queryClient.getQueryData(['v2_historyDetail', 's-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['v2_historyDetail', 's-other'])).toEqual({ id: 's-other' })
  })

  it('stays pending until the program list and the lists a deleted program changes have all been read again, whichever answers last', async () => {
    for (const lastToAnswer of names) {
      for (const name of names) fetches[name] = []
      queryClient.clear()
      deleteRunMock.mockResolvedValue(undefined)
      const reads = mountReads()
      await loaded()
      const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

      let outcome!: ReturnType<typeof settled>
      await act(async () => {
        outcome = settled(result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1'] }))
      })
      for (const name of names) await waitFor(() => expect(fetches[name]).toHaveLength(2))
      await tick()
      expect(outcome.done, `${lastToAnswer} last: still waiting on all four`).toBe(false)
      expect(result.current.isPending).toBe(true)

      for (const name of names.filter((n) => n !== lastToAnswer)) {
        await act(async () => {
          fetches[name][1].resolve([])
        })
      }
      await tick()
      expect(outcome.done, `${lastToAnswer} hasn't answered: still pending`).toBe(false)

      await act(async () => {
        fetches[lastToAnswer][1].resolve([])
      })
      await waitFor(() => expect(outcome.done).toBe(true))
      expect(result.current.isSuccess).toBe(true)
      reads.unmount()
    }
  })

  it('a refetch that fails after the delete has happened does not turn it into a failed delete', async () => {
    deleteRunMock.mockResolvedValue(undefined)
    mountReads()
    await loaded()
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    let outcome!: ReturnType<typeof settled>
    await act(async () => {
      outcome = settled(result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1'] }))
    })
    for (const name of names) await waitFor(() => expect(fetches[name]).toHaveLength(2))
    await act(async () => {
      for (const name of names) fetches[name][1].reject(new Error('refetch failed'))
      // the queries' own retry (one, in the app's client) asks again: let those fail too
      await new Promise((resolve) => setTimeout(resolve, 1200))
      for (const name of names) for (const f of fetches[name]) f.reject(new Error('refetch failed'))
    })
    await waitFor(() => expect(outcome.done).toBe(true))
    expect(outcome.error).toBeUndefined()
    expect(result.current.isSuccess).toBe(true)
  })

  it('never pauses when TanStack thinks it is offline: it runs, and a failure keeps the service\'s own error (the real reason, SPEC Errors 15)', async () => {
    deleteRunMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ id: 'meso-4', sessionIds: [] })
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(deleteRunMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toEqual({ message: 'Failed to fetch' })
    expect(dropMock).not.toHaveBeenCalled()
  })

  it('the counts of the program being deleted are left alone: the confirmation is still on them when the delete lands', async () => {
    deleteRunMock.mockResolvedValue(undefined)
    countsMock.mockResolvedValue(COUNTS)
    sessionIdsMock.mockResolvedValue(['s-1'])
    const read = renderHook(() => useFinishedRunCounts('meso-4', true), { wrapper })
    await waitFor(() => expect(read.result.current.isSuccess).toBe(true))
    const { result } = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'meso-4', sessionIds: ['s-1'] })
    })
    await tick()

    expect(countsMock).toHaveBeenCalledTimes(1) // not asked again about a program that is gone
    expect(read.result.current.data?.counts).toEqual(COUNTS)
  })
})
