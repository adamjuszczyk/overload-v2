// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

// Chunk 66: the write behind DELETE THIS FINISHED PROGRAM (PR15), through its REAL hook on the app's own query client (RULES: "a screen test that
// must see a write's effect through the real hooks gives QueryClientProvider the app's own queryClient"). The screen mocks `useDeleteMeso`
// (`FinishedProgramPage.test.tsx`: what it asks, with which id, when, and what it does with the answer); this is where the hook's own promises are
// proven. It has a second caller, History's meso filter, and both depend on the same three things:
//   - the run it is given is the run the service deletes;
//   - it stays pending until the run list (and the other lists a deleted run changes) has been read again, so the screen it opens, PROGRAMS, doesn't
//     draw the list as it was, with the deleted run still under FINISHED (RULES: "a write followed by a navigation returns its invalidations from
//     `onSuccess`"); a refetch that fails doesn't turn a delete that happened into a failed delete;
//   - `networkMode: 'always'` (CONTEXT.md, Offline): offline it runs and fails with the service's own error, which the confirm shows as the real
//     reason (SPEC Errors (15)); with the default it would pause for ever behind DELETING….
// Nothing about the cache or the invalidation is mocked: only the service.

const deleteMesoMock = vi.fn()
vi.mock('./mesoService', () => ({
  fetchMesos: vi.fn(),
  completeMeso: vi.fn(),
  deleteMeso: (...args: unknown[]) => deleteMesoMock(...args),
}))
vi.mock('./runService', () => ({ startRun: vi.fn() }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { useDeleteMeso } = await import('./useMesos')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void; promise: Promise<unknown> }
const deferred = (): Deferred => {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise }
}

// Active queries under the keys a deleted run changes, each fetch a promise the test holds open: [0] is the first load, [1] the refetch.
const KEYS = { mesos: ['v2_mesos'], history: ['v2_history'], progress: ['v2_mesoProgress'] }
const fetches: Record<keyof typeof KEYS, Deferred[]> = { mesos: [], history: [], progress: [] }
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
    },
    { wrapper },
  )
}
async function loaded() {
  for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) await waitFor(() => expect(fetches[name]).toHaveLength(1))
  await act(async () => {
    for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) fetches[name][0].resolve([])
  })
}

beforeEach(() => {
  for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) fetches[name] = []
})
afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  deleteMesoMock.mockReset()
  queryClient.clear()
})

const settled = (promise: Promise<unknown>) => {
  const state = { done: false, error: undefined as unknown }
  promise.then(() => { state.done = true }, (error) => { state.done = true; state.error = error })
  return state
}
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('DELETE — useDeleteMeso', () => {
  it('deletes the run it is given, once', async () => {
    deleteMesoMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteMeso(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('meso-4')
    })

    expect(deleteMesoMock).toHaveBeenCalledTimes(1)
    expect(deleteMesoMock).toHaveBeenCalledWith('meso-4')
  })

  it('stays pending until the run list and the lists a deleted run changes have all been read again, whichever answers last', async () => {
    for (const lastToAnswer of ['mesos', 'history', 'progress'] as const) {
      for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) fetches[name] = []
      queryClient.clear()
      deleteMesoMock.mockResolvedValue(undefined)
      const reads = mountReads()
      await loaded()
      const { result } = renderHook(() => useDeleteMeso(), { wrapper })

      let outcome!: ReturnType<typeof settled>
      await act(async () => {
        outcome = settled(result.current.mutateAsync('meso-4'))
      })
      for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) await waitFor(() => expect(fetches[name]).toHaveLength(2))
      await tick()
      expect(outcome.done, `${lastToAnswer} last: still waiting on all three`).toBe(false)
      expect(result.current.isPending).toBe(true)

      for (const name of (Object.keys(KEYS) as Array<keyof typeof KEYS>).filter((n) => n !== lastToAnswer)) {
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
    deleteMesoMock.mockResolvedValue(undefined)
    mountReads()
    await loaded()
    const { result } = renderHook(() => useDeleteMeso(), { wrapper })

    let outcome!: ReturnType<typeof settled>
    await act(async () => {
      outcome = settled(result.current.mutateAsync('meso-4'))
    })
    for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) await waitFor(() => expect(fetches[name]).toHaveLength(2))
    await act(async () => {
      for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) fetches[name][1].reject(new Error('refetch failed'))
      // the queries' own retry (one, in the app's client) asks again: let those fail too
      await new Promise((resolve) => setTimeout(resolve, 1200))
      for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) for (const f of fetches[name]) f.reject(new Error('refetch failed'))
    })
    await waitFor(() => expect(outcome.done).toBe(true))
    expect(outcome.error).toBeUndefined()
    expect(result.current.isSuccess).toBe(true)
  })

  it('never pauses when TanStack thinks it is offline: it runs, and a failure keeps the service\'s own error (the real reason, SPEC Errors 15)', async () => {
    deleteMesoMock.mockRejectedValue({ message: 'Failed to fetch' })
    const { result } = renderHook(() => useDeleteMeso(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate('meso-4')
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(deleteMesoMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toEqual({ message: 'Failed to fetch' })
  })

  it('a failed delete invalidates nothing: no list is read again for a delete that did not happen', async () => {
    deleteMesoMock.mockRejectedValue(new Error('permission denied for table v2_mesocycles'))
    mountReads()
    await loaded()
    const { result } = renderHook(() => useDeleteMeso(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('meso-4').catch(() => undefined)
    })
    await tick()

    for (const name of Object.keys(KEYS) as Array<keyof typeof KEYS>) expect(fetches[name]).toHaveLength(1)
  })
})
