// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { MakeDefaultResult } from './makeWeekDefault'

// Chunk 32 — the mutation behind "Make this week the new default" (useMakeWeekDefault.ts):
// networkMode 'always' (offline it fails, it does not hang), what it calls (the one RPC and
// nothing else), and what a success invalidates (everything that shows the run's copy or a
// week plan).

const makeWeekDefaultMock = vi.fn()
// The service's only export is the call itself: the hook has nothing else to reach (a
// factory mock throws for any other name it asks for).
vi.mock('./makeDefaultService', () => ({
  makeWeekDefault: (...args: unknown[]) => makeWeekDefaultMock(...args),
}))

const { useMakeWeekDefault } = await import('./useMakeWeekDefault')

afterEach(() => {
  onlineManager.setOnline(true)
  makeWeekDefaultMock.mockReset()
  queryClient.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const result = (skipped: MakeDefaultResult['skipped'] = []): MakeDefaultResult => ({ mesocycleId: 'meso-1', weekNumber: 3, skipped })

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey)

describe('useMakeWeekDefault — networkMode: always', () => {
  it('never pauses, online or offline — the mutation attempts the call', async () => {
    makeWeekDefaultMock.mockResolvedValue(result())
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      hook.current.mutate({ weekNumber: 3 })
    })

    // With the default networkMode ('online') this would be paused until back online: the
    // confirm dialog would sit on "…" forever. Break: drop `networkMode: 'always'` -> it hangs.
    await waitFor(() => expect(hook.current.isPaused).toBe(false))
    await waitFor(() => expect(hook.current.isSuccess).toBe(true))
    expect(makeWeekDefaultMock).toHaveBeenCalledWith('meso-1', 3)
  })

  it('settles as an error (not a hang) when the call rejects while offline', async () => {
    makeWeekDefaultMock.mockRejectedValue(new Error('network unavailable'))
    onlineManager.setOnline(false)
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })
    await expect(hook.current.mutateAsync({ weekNumber: 3 })).rejects.toThrow('network unavailable')
  })
})

describe('useMakeWeekDefault — the call', () => {
  it('calls the function with the run and the week, and returns its answer as it is', async () => {
    const answer = result([{ workoutDayId: 'wd-2', reason: 'deload' }])
    makeWeekDefaultMock.mockResolvedValue(answer)
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    let outcome: unknown
    await act(async () => {
      outcome = await hook.current.mutateAsync({ weekNumber: 3 })
    })

    expect(makeWeekDefaultMock).toHaveBeenCalledTimes(1)
    expect(makeWeekDefaultMock).toHaveBeenCalledWith('meso-1', 3)
    expect(outcome).toBe(answer)
  })

  it('an error of the call is the mutation\'s error; nothing else runs: no invalidation', async () => {
    const error = new Error('v2_make_week_default: mesocycle m is not a stable run (planning type week_dependent)')
    makeWeekDefaultMock.mockRejectedValue(error)
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    await act(async () => {
      await expect(hook.current.mutateAsync({ weekNumber: 3 })).rejects.toBe(error)
    })

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useMakeWeekDefault — what a success makes stale', () => {
  it('invalidates the run copy\'s exercise rows, every program-set read, and every cached week plan', async () => {
    makeWeekDefaultMock.mockResolvedValue(result())
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    await act(async () => {
      await hook.current.mutateAsync({ weekNumber: 3 })
    })

    const keys = invalidatedKeys(spy).map((k) => k.join('/'))
    expect(keys).toEqual(expect.arrayContaining([
      'v2_programExercises', // the program tab's list, Plan's comparison with the copy
      'v2_programSets', // the program tab's list (StepVolume), Plan's STRUCTURE view, the workout screen
      'v2_weekPlans', // the week on screen
      'v2_allWeekPlans', // the meso-wide list every comparison reads
      'v2_weekPlan', // one planned session (the workout screen)
    ]))
  })

  it('the mutation stays pending until those caches have refetched', async () => {
    makeWeekDefaultMock.mockResolvedValue(result())
    let finishRefetch!: () => void
    const refetch = new Promise<void>((resolve) => {
      finishRefetch = resolve
    })
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(refetch)
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    act(() => {
      hook.current.mutate({ weekNumber: 3 })
    })
    await waitFor(() => expect(makeWeekDefaultMock).toHaveBeenCalled())
    // The call has answered, but the refetch has not: still pending.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hook.current.isPending).toBe(true)

    await act(async () => {
      finishRefetch()
    })
    await waitFor(() => expect(hook.current.isSuccess).toBe(true))
  })
})
