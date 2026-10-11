// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { MakeDefaultResult } from './makeWeekDefault'

// Chunk 32 — the mutation behind "Make this week the new default" (useMakeWeekDefault.ts):
// networkMode 'always' (offline it fails, it does not hang), what a success invalidates
// (everything that shows the run's copy or a week plan), and the second read being best
// effort (the default is written; no undo): the new default and what the source sessions' planned
// sets name now (`sourceAfter`) are each read on their own, and one that fails is null.

const makeWeekDefaultMock = vi.fn()
const fetchRunCopyDefaultsMock = vi.fn()
const fetchSourceSetLinksMock = vi.fn()
vi.mock('./makeDefaultService', () => ({
  makeWeekDefault: (...args: unknown[]) => makeWeekDefaultMock(...args),
  fetchRunCopyDefaults: (...args: unknown[]) => fetchRunCopyDefaultsMock(...args),
  fetchSourceSetLinks: (...args: unknown[]) => fetchSourceSetLinksMock(...args),
}))

const { useMakeWeekDefault } = await import('./useMakeWeekDefault')

afterEach(() => {
  onlineManager.setOnline(true)
  makeWeekDefaultMock.mockReset()
  fetchRunCopyDefaultsMock.mockReset()
  fetchSourceSetLinksMock.mockReset()
  queryClient.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const result = (workoutDayIds: string[]): MakeDefaultResult => ({
  mesocycleId: 'meso-1',
  weekNumber: 3,
  skipped: [],
  workouts: workoutDayIds.map((id) => ({ workoutDayId: id, sourceWeekPlanId: `wp-${id}`, sourceSequencePosition: null, oldExercises: [] })),
})

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey)

describe('useMakeWeekDefault — networkMode: always', () => {
  it('never pauses, online or offline — the mutation attempts the call', async () => {
    makeWeekDefaultMock.mockResolvedValue(result([]))
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

describe('useMakeWeekDefault — the call, then the new default and what the source sessions name now', () => {
  it('calls the function with the run and the week, then reads the new default of exactly the workouts it rewrote, and the links of exactly the source sessions', async () => {
    const answer = result(['wd-1', 'wd-2'])
    makeWeekDefaultMock.mockResolvedValue(answer)
    const defaults = new Map([['wd-1', []], ['wd-2', []]])
    fetchRunCopyDefaultsMock.mockResolvedValue(defaults)
    const links = new Map([['wp-wd-1', new Map([['i1', 'pi-1']])], ['wp-wd-2', new Map<string, string>()]])
    fetchSourceSetLinksMock.mockResolvedValue(links)
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    let outcome: unknown
    await act(async () => {
      outcome = await hook.current.mutateAsync({ weekNumber: 3 })
    })

    expect(makeWeekDefaultMock).toHaveBeenCalledWith('meso-1', 3)
    expect(fetchRunCopyDefaultsMock).toHaveBeenCalledWith(['wd-1', 'wd-2'])
    // C: which program set each planned set of the source sessions ended up on, per source session. Break: do not
    // read them (or read the wrong sessions) -> a swapped slot is always paired by ordinal.
    expect(fetchSourceSetLinksMock).toHaveBeenCalledWith(['wp-wd-1', 'wp-wd-2'])
    expect(outcome).toEqual({ result: answer, newDefaults: defaults, sourceAfter: links })
  })

  it('an error of the call is the mutation\'s error; nothing else runs: no read, no invalidation', async () => {
    const error = new Error('v2_make_week_default: mesocycle m is not a stable run (planning type week_dependent)')
    makeWeekDefaultMock.mockRejectedValue(error)
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    await act(async () => {
      await expect(hook.current.mutateAsync({ weekNumber: 3 })).rejects.toBe(error)
    })

    expect(fetchRunCopyDefaultsMock).not.toHaveBeenCalled()
    expect(fetchSourceSetLinksMock).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('a read of the new default that fails is not a failed action: the default is written, so the outcome has no new default (no offer) and the caches are still refreshed', async () => {
    makeWeekDefaultMock.mockResolvedValue(result(['wd-1']))
    fetchRunCopyDefaultsMock.mockRejectedValue(new Error('read failed'))
    fetchSourceSetLinksMock.mockResolvedValue(new Map())
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    let outcome: { newDefaults: unknown } | undefined
    await act(async () => {
      outcome = (await hook.current.mutateAsync({ weekNumber: 3 })) as { newDefaults: unknown }
    })

    expect(outcome!.newDefaults).toBeNull()
    expect(invalidatedKeys(spy)).toContainEqual(['v2_programSets'])
  })

  // The same for the links: the default is written, so a read of the source sessions that fails is not a failed
  // action. The outcome then has none, and a swapped slot's sets are paired by ordinal within kind instead (the new
  // default is still offered). Break: let that read's error through -> the mutation fails after the default is written.
  it('a read of the source sessions\' links that fails is not a failed action either: no links, the new default kept', async () => {
    const defaults = new Map([['wd-1', []]])
    makeWeekDefaultMock.mockResolvedValue(result(['wd-1']))
    fetchRunCopyDefaultsMock.mockResolvedValue(defaults)
    fetchSourceSetLinksMock.mockRejectedValue(new Error('read failed'))
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })

    let outcome: { newDefaults: unknown; sourceAfter: unknown } | undefined
    await act(async () => {
      outcome = (await hook.current.mutateAsync({ weekNumber: 3 })) as { newDefaults: unknown; sourceAfter: unknown }
    })

    expect(outcome!.sourceAfter).toBeNull()
    expect(outcome!.newDefaults).toBe(defaults)
    expect(invalidatedKeys(spy)).toContainEqual(['v2_programSets'])
  })

  it('an answer with no workouts reads nothing', async () => {
    makeWeekDefaultMock.mockResolvedValue(result([]))
    const { result: hook } = renderHook(() => useMakeWeekDefault('meso-1'), { wrapper })
    await act(async () => {
      await hook.current.mutateAsync({ weekNumber: 3 })
    })
    expect(fetchRunCopyDefaultsMock).not.toHaveBeenCalled()
    expect(fetchSourceSetLinksMock).not.toHaveBeenCalled()
  })
})

describe('useMakeWeekDefault — what a success makes stale', () => {
  it('invalidates the run copy\'s exercise rows, every program-set read, and every cached week plan', async () => {
    makeWeekDefaultMock.mockResolvedValue(result(['wd-1']))
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map())
    fetchSourceSetLinksMock.mockResolvedValue(new Map())
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
      'v2_allWeekPlans', // the meso-wide list every comparison and the offer read
      'v2_weekPlan', // one planned session (the workout screen)
    ]))
  })

  it('the mutation stays pending until those caches have refetched (the offer is built from what the screen then shows)', async () => {
    makeWeekDefaultMock.mockResolvedValue(result([]))
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
