// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

// Chunk 52 (TASKS-1.2 "Plan's header" → PlanForwardCard; SPEC Weeks and copying [1.2]; P1.2-10). The two hooks behind PLAN FORWARD's
// card. usePlanForward plans the one week it is given through `planWeek` (the v2_plan_week RPC) and settles only when the week's own plans
// and the run's whole list have been read again; defaultHasSets / useDefaultHasSets say whether a stable run's default holds a set at all.
// The screen-level proofs (which week the card names, what the tiles do after) are PlanPage.planning.test.tsx's.

const planWeekMock = vi.fn()
const fetchProgramExercisesMock = vi.fn()
const fetchProgramSetsMock = vi.fn()
vi.mock('./weekPlanService', () => ({ planWeek: (...args: unknown[]) => planWeekMock(...args) }))
vi.mock('../programs/programService', () => ({ fetchProgramExercises: (...args: unknown[]) => fetchProgramExercisesMock(...args) }))
vi.mock('../planner/plannerService', () => ({ fetchProgramSets: (...args: unknown[]) => fetchProgramSetsMock(...args) }))
const auth = vi.hoisted(() => ({ user: { id: 'user-1' } as { id: string } | null }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }))

const { usePlanForward, useDefaultHasSets, defaultHasSets } = await import('./usePlanForward')

afterEach(() => {
  onlineManager.setOnline(true)
  planWeekMock.mockReset()
  fetchProgramExercisesMock.mockReset()
  fetchProgramSetsMock.mockReset()
  auth.user = { id: 'user-1' }
  queryClient.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('usePlanForward', () => {
  it('plans the week it is given, for the run it was made for: one call, planWeek(mesoId, week)', async () => {
    planWeekMock.mockResolvedValue(2)
    const { result } = renderHook(() => usePlanForward('meso-7'), { wrapper })
    let planned = 0
    await act(async () => {
      planned = await result.current.mutateAsync(5)
    })
    expect(planWeekMock).toHaveBeenCalledTimes(1)
    expect(planWeekMock).toHaveBeenCalledWith('meso-7', 5)
    expect(planned).toBe(2)
  })

  it('reads the lists again before it settles: the week\'s own plans and the whole run\'s, and no other week\'s', async () => {
    planWeekMock.mockResolvedValue(2)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePlanForward('meso-7'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(5)
    })
    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(keys).toEqual([['v2_weekPlans', 'meso-7', 5], ['v2_allWeekPlans', 'meso-7']])
  })

  it('does not settle until those reads are done (the card must not stay over a week that has just been planned)', async () => {
    planWeekMock.mockResolvedValue(1)
    const releases: Array<() => void> = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)))
    const { result } = renderHook(() => usePlanForward('meso-7'), { wrapper })
    act(() => {
      result.current.mutate(3)
    })
    await waitFor(() => expect(planWeekMock).toHaveBeenCalled())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(result.current.isPending).toBe(true) // planned, but the lists are still being read
    await act(async () => {
      releases.forEach((release) => release())
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a failure is the mutation\'s error, as it came, and nothing is read again', async () => {
    planWeekMock.mockRejectedValue({ message: 'v2_plan_week: week 5 would skip a week', code: 'P0001' })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePlanForward('meso-7'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(5)).rejects.toEqual({ message: 'v2_plan_week: week 5 would skip a week', code: 'P0001' })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toEqual({ message: 'v2_plan_week: week 5 would skip a week', code: 'P0001' })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('offline it still attempts the call and fails fast, instead of pausing on PLANNING… for good (networkMode always)', async () => {
    onlineManager.setOnline(false)
    planWeekMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => usePlanForward('meso-7'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(3)).rejects.toThrow('Failed to fetch')
    })
    expect(planWeekMock).toHaveBeenCalledTimes(1)
  })
})

describe('defaultHasSets (P1.2-10)', () => {
  it('is true when any set is still in the default, false for none, and a set the default dropped does not count', () => {
    expect(defaultHasSets([])).toBe(false)
    expect(defaultHasSets([{ removedAt: null }])).toBe(true)
    expect(defaultHasSets([{ removedAt: undefined }])).toBe(true)
    expect(defaultHasSets([{ removedAt: '2026-10-01T00:00:00Z' }])).toBe(false)
    expect(defaultHasSets([{ removedAt: '2026-10-01T00:00:00Z' }, { removedAt: null }])).toBe(true)
  })
})

describe('useDefaultHasSets', () => {
  it('reads the program exercises of each workout, then their sets, once, and answers whether any set is live', async () => {
    fetchProgramExercisesMock.mockImplementation(async (workoutDayId: string) => [{ id: `pe-${workoutDayId}-1` }, { id: `pe-${workoutDayId}-2` }])
    fetchProgramSetsMock.mockResolvedValue([{ removedAt: '2026-10-01T00:00:00Z' }, { removedAt: null }])
    const { result } = renderHook(() => useDefaultHasSets(['wd-pull', 'wd-push', 'wd-pull'], true), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(true))
    expect(fetchProgramExercisesMock.mock.calls.map((call) => call[0]).sort()).toEqual(['wd-pull', 'wd-push']) // a workout twice is asked once
    expect(fetchProgramSetsMock).toHaveBeenCalledTimes(1)
    expect(fetchProgramSetsMock).toHaveBeenCalledWith(['pe-wd-pull-1', 'pe-wd-pull-2', 'pe-wd-push-1', 'pe-wd-push-2'])
  })

  it('a default whose every set was dropped (or that has none) answers false', async () => {
    fetchProgramExercisesMock.mockResolvedValue([{ id: 'pe-1' }])
    fetchProgramSetsMock.mockResolvedValue([{ removedAt: '2026-10-01T00:00:00Z' }])
    const { result } = renderHook(() => useDefaultHasSets(['wd-push'], true), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(false))
  })

  it('reads nothing unless it is asked to (a week-dependent run), when no one is signed in, or when the week has no workout', async () => {
    renderHook(() => useDefaultHasSets(['wd-push'], false), { wrapper })
    auth.user = null
    renderHook(() => useDefaultHasSets(['wd-push'], true), { wrapper })
    auth.user = { id: 'user-1' }
    renderHook(() => useDefaultHasSets([], true), { wrapper })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(fetchProgramExercisesMock).not.toHaveBeenCalled()
    expect(fetchProgramSetsMock).not.toHaveBeenCalled()
  })

  it('its key sits under the program sets\' prefix, so a planner write or a CHANGE THE PROGRAM save (which invalidate v2_programSets) refreshes it', async () => {
    fetchProgramExercisesMock.mockResolvedValue([{ id: 'pe-1' }])
    fetchProgramSetsMock.mockResolvedValue([{ removedAt: null }])
    const { result } = renderHook(() => useDefaultHasSets(['wd-push'], true), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(true))
    expect(queryClient.getQueryCache().findAll({ queryKey: ['v2_programSets'] })).toHaveLength(1)

    fetchProgramSetsMock.mockResolvedValue([])
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2_programSets'] })
    })
    await waitFor(() => expect(result.current.data).toBe(false))
  })
})
