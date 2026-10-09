// @vitest-environment jsdom
//
// Review fix (chunk 24): every write mutation in this file uses
// networkMode: 'always' (CONTEXT.md) — useMoveSession/useClearMovedSession/
// useStartMovedSession didn't. Proven the same way useWeekPlan.test.tsx's
// own chunk 8 "offline start" regression is proven: onlineManager.
// setOnline(false) simulates TanStack's OWN view of connectivity — a
// different signal from this app's useOnlineStatus (navigator.onLine) —
// and a mutation fired while TanStack thinks it's offline must still
// attempt (or fail fast), never pause indefinitely (the "STARTING…" hang).
//
// Also proves the second review fix: useStartMovedSession now works
// offline through the existing sync queue, same tier as useCreateSession/
// useSkipSession — a moved-here `planned` row can be started exactly like
// a freshly-created one, the one asymmetry the review flagged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { Session } from '../../types'

let isOnlineFlag = true
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => isOnlineFlag }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const syncQueueAdd = vi.fn().mockResolvedValue(undefined)
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: { add: (...args: unknown[]) => syncQueueAdd(...args) },
    sessions: { put: vi.fn().mockResolvedValue(undefined) },
  },
}))

const { useMoveSession, useClearMovedSession, useStartMovedSession } = await import('./useSession')

// Same chainable stand-in as sessionService.moveSession.test.ts's own
// makeChain — sessionService.ts's real functions run underneath these
// hooks (only supabase/db are mocked), so the online path is the real
// moveSessionTo/clearMovedSession/startMovedSession.
function makeChain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

// findCachedSession/cachedSessionToDbRow (useSession.ts) read the real,
// imported `queryClient` singleton directly, not a context-resolved one —
// so the wrapper has to provide that SAME instance for cache seeding to be
// visible to the hook under test.
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  onlineManager.setOnline(true)
  isOnlineFlag = true
  fromMock.mockReset()
  syncQueueAdd.mockClear()
  queryClient.clear()
})

describe('useMoveSession / useClearMovedSession / useStartMovedSession — networkMode: always', () => {
  it('useMoveSession never pauses, even when TanStack thinks it is offline', async () => {
    const findChain = makeChain({ data: null, error: null })
    const insertChain = makeChain({
      data: {
        id: 's1', user_id: 'user-1', mesocycle_id: 'm1', week_plan_id: null,
        workout_day_id: 'wd-1', date: '2026-08-24', status: 'planned', note: null,
        started_at: null, completed_at: null, created_at: '2026-08-24T00:00:00Z',
        moved_to_date: '2026-08-28',
      },
      error: null,
    })
    fromMock.mockReturnValueOnce(findChain).mockReturnValueOnce(insertChain)

    onlineManager.setOnline(false)
    const { result } = renderHook(() => useMoveSession(), { wrapper })

    act(() => {
      result.current.mutate({
        mesoId: 'm1', weekPlanId: null, workoutDayId: 'wd-1', date: '2026-08-24', targetDate: '2026-08-28',
      })
    })

    // With the default networkMode ('online'), this would become true and
    // stay true until back online — mutate would never settle.
    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('useClearMovedSession never pauses, even when TanStack thinks it is offline', async () => {
    const findChain = makeChain({ data: { id: 's1' }, error: null })
    const deleteChain = makeChain({ data: null, error: null })
    fromMock.mockReturnValueOnce(findChain).mockReturnValueOnce(deleteChain)

    onlineManager.setOnline(false)
    const { result } = renderHook(() => useClearMovedSession(), { wrapper })

    act(() => {
      result.current.mutate({ workoutDayId: 'wd-1', date: '2026-08-24' })
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('useStartMovedSession (online branch) never pauses, even when TanStack thinks it is offline', async () => {
    fromMock.mockReturnValue(makeChain({ data: { started_at: '2026-08-24T12:00:00Z' }, error: null }))

    onlineManager.setOnline(false)
    const { result } = renderHook(() => useStartMovedSession(), { wrapper })

    act(() => {
      result.current.mutate('session-1')
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

function cachedPlannedSession(): Session {
  return {
    id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1',
    workoutDayId: 'wd-1', date: '2026-08-24', status: 'planned', note: null,
    startedAt: null, completedAt: null, createdAt: '2026-08-24T00:00:00Z',
    energyRating: null, pumpRating: null, movedToDate: '2026-08-28',
  }
}

describe('useStartMovedSession — offline (review fix): starts through the existing sync queue', () => {
  it('queues an upsert (status in_progress, a fresh started_at) instead of calling the online path, and never queues a second session row', async () => {
    isOnlineFlag = false
    // Seeded the same way the real app would have it cached — TodayPage's
    // own due-today entry comes from useSessionsInRange, keyed
    // ['v2_sessions', startDate, endDate]; findCachedSession matches on
    // the ['v2_sessions'] prefix regardless of the trailing key parts.
    queryClient.setQueryData(['v2_sessions', '2026-08-24', '2026-08-24'], [cachedPlannedSession()])

    const { result } = renderHook(() => useStartMovedSession(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('session-1')
    })

    expect(fromMock).not.toHaveBeenCalled()
    expect(syncQueueAdd).toHaveBeenCalledTimes(1)
    expect(syncQueueAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'v2_sessions',
        operation: 'upsert',
        payload: expect.objectContaining({
          id: 'session-1',
          user_id: 'user-1',
          workout_day_id: 'wd-1',
          date: '2026-08-24',
          // The cached row's own moved_to_date must survive the
          // reconstruction (cachedSessionToDbRow) — this is the one row
          // for this slot; starting it must never create a second.
          moved_to_date: '2026-08-28',
          status: 'in_progress',
          started_at: expect.any(String),
        }),
      }),
    )
  })

  it('settles (does not hang) even while offline', async () => {
    isOnlineFlag = false
    queryClient.setQueryData(['v2_sessions', '2026-08-24', '2026-08-24'], [cachedPlannedSession()])

    const { result } = renderHook(() => useStartMovedSession(), { wrapper })

    act(() => {
      result.current.mutate('session-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
