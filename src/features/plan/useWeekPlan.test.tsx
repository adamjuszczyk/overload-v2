// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Chunk 8, review fix #1 ("Offline start regression") — usePlanWeek had no
// networkMode, so it used TanStack's default 'online': offline, the
// mutation PAUSES rather than running, and mutateAsync never settles.
// TodayPage.tsx/MissedSessionPrompt.tsx await it before createSession, so
// START SESSION/DO IT NOW hung on "STARTING…" offline — a real regression,
// since TASKS.md says a week started offline just starts without a plan,
// as today, and useSession.ts's write mutations all already carry
// networkMode: 'always' for exactly this reason (see its useDeleteSetLog).
//
// planWeek (weekPlanService.ts) is mocked so no real network/Supabase call
// is ever attempted; fetchWeekPlans is injected directly into
// planWeekThenFindId's own seam, so this file needs no module mock for it.

const planWeekMock = vi.fn()
vi.mock('./weekPlanService', () => ({
  planWeek: (...args: unknown[]) => planWeekMock(...args),
}))

const { usePlanWeek, planWeekThenFindId } = await import('./useWeekPlan')

afterEach(() => {
  // onlineManager is a module-level singleton shared by every test in this
  // process — leaving it false would silently break unrelated suites.
  onlineManager.setOnline(true)
  planWeekMock.mockReset()
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient()
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('usePlanWeek — networkMode: always', () => {
  it('never pauses, online or offline — the mutation always attempts the call', async () => {
    planWeekMock.mockResolvedValue(1)
    const { result } = renderHook(() => usePlanWeek(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ mesoId: 'm1', weekNumber: 2 })
    })

    // With the default networkMode ('online'), this would become true and
    // stay true until back online — mutateAsync would never settle. This
    // is the exact regression review point #1 describes.
    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(planWeekMock).toHaveBeenCalledWith('m1', 2)
  })

  it('settles as an error (not a hang) when the underlying call rejects while offline', async () => {
    planWeekMock.mockRejectedValue(new Error('network unavailable'))
    onlineManager.setOnline(false)
    const { result } = renderHook(() => usePlanWeek(), { wrapper })

    await expect(result.current.mutateAsync({ mesoId: 'm1', weekNumber: 2 })).rejects.toThrow(
      'network unavailable',
    )
  })
})

describe('planWeekThenFindId — best-effort: never blocks or fails the start', () => {
  function fakePlanWeek(impl: () => Promise<number>) {
    return { mutateAsync: vi.fn(impl) }
  }

  it('on success, returns the newly planned week\'s own plan id for this workout', async () => {
    const planWeek = fakePlanWeek(() => Promise.resolve(1))
    const fetchPlans = vi.fn().mockResolvedValue([
      { id: 'wp-other', workoutDayId: 'wd-other' },
      { id: 'wp-target', workoutDayId: 'wd-target' },
    ])

    const id = await planWeekThenFindId('meso-1', 2, 'wd-target', 'fallback-id', planWeek, fetchPlans)

    expect(id).toBe('wp-target')
    expect(planWeek.mutateAsync).toHaveBeenCalledWith({ mesoId: 'meso-1', weekNumber: 2 })
  })

  it('falls back when the plan call itself rejects (e.g. offline)', async () => {
    const planWeek = fakePlanWeek(() => Promise.reject(new Error('offline')))
    const fetchPlans = vi.fn()

    const id = await planWeekThenFindId('meso-1', 2, 'wd-target', 'fallback-id', planWeek, fetchPlans)

    expect(id).toBe('fallback-id')
    expect(fetchPlans).not.toHaveBeenCalled() // never reached — the plan call failed first
  })

  it('falls back when the re-read rejects, even though planning itself succeeded', async () => {
    const planWeek = fakePlanWeek(() => Promise.resolve(1))
    const fetchPlans = vi.fn().mockRejectedValue(new Error('offline on the re-read'))

    const id = await planWeekThenFindId('meso-1', 2, 'wd-target', 'fallback-id', planWeek, fetchPlans)

    expect(id).toBe('fallback-id')
  })

  it('falls back when planning succeeded but this workout has no row yet (defensive — should not happen)', async () => {
    const planWeek = fakePlanWeek(() => Promise.resolve(1))
    const fetchPlans = vi.fn().mockResolvedValue([{ id: 'wp-other', workoutDayId: 'wd-other' }])

    const id = await planWeekThenFindId('meso-1', 2, 'wd-target', 'fallback-id', planWeek, fetchPlans)

    expect(id).toBe('fallback-id')
  })

  it('a null fallback stays null on failure (a genuinely plan-less start, same as today)', async () => {
    const planWeek = fakePlanWeek(() => Promise.reject(new Error('offline')))
    const id = await planWeekThenFindId('meso-1', 2, 'wd-target', null, planWeek, vi.fn())
    expect(id).toBeNull()
  })
})
