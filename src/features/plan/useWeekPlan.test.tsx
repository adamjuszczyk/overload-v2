// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

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
// Chunk 19 — useUpdateSet's own networkMode: 'always' proof below, same
// injection seam as planWeek's.
const updateSetMock = vi.fn()
// Chunk 22 — useSetWeekDeload/useSetDeload's own executor collaborators
// (weekPlanService.ts), replacing chunk 21's plain setDeload/setWeekDeload
// now that marking can calculate: markSessionDeload/unmarkSessionDeload
// (per-session) and markWeekDeload/unmarkWeekDeload (the week shortcut,
// "once per row" — reviewer's note 6) are each mocked as one spy per
// direction, so a test can assert exactly which one ran and with what
// arguments (userId, weekPlanId/mesoId+weekNumber, the resolved rules
// object) without a real Supabase round trip.
const markSessionDeloadMock = vi.fn()
const unmarkSessionDeloadMock = vi.fn()
const markWeekDeloadMock = vi.fn()
const unmarkWeekDeloadMock = vi.fn()
vi.mock('./weekPlanService', () => ({
  planWeek: (...args: unknown[]) => planWeekMock(...args),
  updateSet: (...args: unknown[]) => updateSetMock(...args),
  markSessionDeload: (...args: unknown[]) => markSessionDeloadMock(...args),
  unmarkSessionDeload: (...args: unknown[]) => unmarkSessionDeloadMock(...args),
  markWeekDeload: (...args: unknown[]) => markWeekDeloadMock(...args),
  unmarkWeekDeload: (...args: unknown[]) => unmarkWeekDeloadMock(...args),
}))
// useSetDeload/useSetWeekDeload now read the current user (chunk 22 — the
// executor needs it to attribute inserted rows), same fixed-user mock
// convention every other PlanPage-adjacent test file already uses.
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { usePlanWeek, planWeekThenFindId, useUpdateSet, useSetDeload, useSetWeekDeload } = await import('./useWeekPlan')

afterEach(() => {
  // onlineManager is a module-level singleton shared by every test in this
  // process — leaving it false would silently break unrelated suites.
  onlineManager.setOnline(true)
  planWeekMock.mockReset()
  updateSetMock.mockReset()
  markSessionDeloadMock.mockReset()
  unmarkSessionDeloadMock.mockReset()
  markWeekDeloadMock.mockReset()
  unmarkWeekDeloadMock.mockReset()
  // The imported queryClient is ALSO a module-level singleton (see the
  // cache-scope tests below) — clear it so no test's seeded cache data
  // leaks into the next.
  queryClient.clear()
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient()
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function weekKey(mesoId: string, weekNumber: number) {
  return ['v2_weekPlans', mesoId, weekNumber] as const
}

function fakePlan(id: string, weekNumber: number, isDeload: boolean) {
  return {
    id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber,
    isDeload, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
  }
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

// Chunk 19 (reviewer's note: "Every write uses networkMode: 'always'") —
// useUpdateSet now also carries the week's weight/rep-target/tags edits;
// same regression shape and same proof as usePlanWeek's own block above.
describe('useUpdateSet — networkMode: always (chunk 19)', () => {
  it('never pauses, online or offline — the mutation always attempts the call', async () => {
    updateSetMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpdateSet('meso-1', 1), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ id: 'set-1', changes: { targetWeight: 100 } })
    })

    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(updateSetMock).toHaveBeenCalledWith('set-1', { targetWeight: 100 })
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

// Chunk 21, review fix — the first review's break (PlanPage.tsx's call site
// changed to `useSetWeekDeload(mesoId, viewWeek + 1)`) passed every test
// because nothing exercised the REAL hook at all; PlanPage's own tests mock
// `./useWeekPlan` entirely. This closes that gap at the hook's own layer:
// the real useSetWeekDeload, only its Supabase-touching collaborators
// mocked — same seam as usePlanWeek/useUpdateSet above. Chunk 22 extends
// these same tests for the new `rules` argument and the markWeekDeload/
// unmarkWeekDeload split (replacing chunk 21's own plain setWeekDeload).
const SOME_RULES = { sets: { mode: 'percent' as const, value: 50, rounding: 'down' as const } }

describe('useSetWeekDeload — plans the week first, then writes it; optimistic, scoped to one week (chunk 21/22)', () => {
  it('marking calls planWeek(mesoId, weekNumber) and THEN markWeekDeload(userId, mesoId, weekNumber, rules) — never the other order, never skipping planWeek', async () => {
    const calls: Array<{ fn: string; args: unknown[] }> = []
    planWeekMock.mockImplementation(async (...args: unknown[]) => {
      calls.push({ fn: 'planWeek', args })
      return 0
    })
    markWeekDeloadMock.mockImplementation(async (...args: unknown[]) => {
      calls.push({ fn: 'markWeekDeload', args })
      return { anyAlreadyStarted: false }
    })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: true, rules: SOME_RULES })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(calls).toEqual([
      { fn: 'planWeek', args: ['meso-1', 3] },
      { fn: 'markWeekDeload', args: ['user-1', 'meso-1', 3, SOME_RULES] },
    ])
    expect(unmarkWeekDeloadMock).not.toHaveBeenCalled()
  })

  it('unmarking calls unmarkWeekDeload(userId, mesoId, weekNumber) — never markWeekDeload', async () => {
    planWeekMock.mockResolvedValue(0)
    unmarkWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: false })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: false, rules: SOME_RULES })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(unmarkWeekDeloadMock).toHaveBeenCalledWith('user-1', 'meso-1', 3)
    expect(markWeekDeloadMock).not.toHaveBeenCalled()
  })

  it('a null rules object (no rules on) reaches markWeekDeload unchanged — the hook never substitutes or re-resolves it', async () => {
    planWeekMock.mockResolvedValue(0)
    markWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: false })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: true, rules: null })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(markWeekDeloadMock).toHaveBeenCalledWith('user-1', 'meso-1', 3, null)
  })

  it('the mutation\'s own resolved value carries whether any row hit the started guard, for the caller\'s own onSuccess notice', async () => {
    planWeekMock.mockResolvedValue(0)
    markWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: true })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    let seen: unknown
    act(() => {
      result.current.mutate({ isDeload: true, rules: SOME_RULES }, { onSuccess: (r) => { seen = r } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen).toEqual({ anyAlreadyStarted: true })
  })

  it('the optimistic patch touches only this week\'s own cache entry — a sibling week is untouched', async () => {
    // useSetWeekDeload (like every sibling mutation in this file)
    // read/writes the imported `queryClient` SINGLETON directly
    // (useWeekPlan.ts's own module-level import), never whatever client a
    // test's own `QueryClientProvider` carries — so the cache under test
    // has to be that same singleton, not a fresh local `QueryClient`.
    queryClient.clear()
    const thisWeek = [fakePlan('wp-3', 3, false)]
    const otherWeek = [fakePlan('wp-4', 4, false)]
    queryClient.setQueryData(weekKey('meso-1', 3), thisWeek)
    queryClient.setQueryData(weekKey('meso-1', 4), otherWeek)
    planWeekMock.mockResolvedValue(0)
    markWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: false })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: true, rules: null })
    })

    // The optimistic patch lands in onMutate, ahead of the (mocked) network
    // calls settling.
    await waitFor(() => {
      expect(queryClient.getQueryData(weekKey('meso-1', 3))).toEqual([fakePlan('wp-3', 3, true)])
    })
    expect(queryClient.getQueryData(weekKey('meso-1', 4))).toEqual(otherWeek) // never touched, throughout

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(weekKey('meso-1', 4))).toEqual(otherWeek) // still untouched after settling
  })

  it('rolls back this week\'s own cache entry to what it was before, when the write fails', async () => {
    queryClient.clear()
    const original = [fakePlan('wp-3', 3, false)]
    queryClient.setQueryData(weekKey('meso-1', 3), original)
    planWeekMock.mockResolvedValue(0)
    markWeekDeloadMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: true, rules: null })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(queryClient.getQueryData(weekKey('meso-1', 3))).toEqual(original)
  })
})

// Chunk 22 — useSetDeload's own argument wiring, same posture as
// useSetWeekDeload's block above: the real hook, only markSessionDeload/
// unmarkSessionDeload mocked.
describe('useSetDeload — marks/unmarks exactly the one session it was given (chunk 22)', () => {
  it('marking calls markSessionDeload(userId, weekPlanId, rules) — never unmarkSessionDeload', async () => {
    markSessionDeloadMock.mockResolvedValue('calculated')

    const { result } = renderHook(() => useSetDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ weekPlanId: 'wp-session', isDeload: true, rules: SOME_RULES })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(markSessionDeloadMock).toHaveBeenCalledWith('user-1', 'wp-session', SOME_RULES)
    expect(unmarkSessionDeloadMock).not.toHaveBeenCalled()
  })

  it('unmarking calls unmarkSessionDeload(userId, weekPlanId) — never markSessionDeload, and never even reads `rules`', async () => {
    unmarkSessionDeloadMock.mockResolvedValue('restored')

    const { result } = renderHook(() => useSetDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ weekPlanId: 'wp-session', isDeload: false, rules: SOME_RULES })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(unmarkSessionDeloadMock).toHaveBeenCalledWith('user-1', 'wp-session')
    expect(markSessionDeloadMock).not.toHaveBeenCalled()
  })

  it('targets the exact weekPlanId it is given, never a different one (break proof: a wrong id must fail this test)', async () => {
    markSessionDeloadMock.mockResolvedValue('calculated')
    const { result } = renderHook(() => useSetDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ weekPlanId: 'wp-correct', isDeload: true, rules: null })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(markSessionDeloadMock).toHaveBeenCalledWith('user-1', 'wp-correct', null)
    expect(markSessionDeloadMock).not.toHaveBeenCalledWith('user-1', 'wp-wrong', null)
  })

  it('the mutation resolves with the executor\'s own outcome, for the caller\'s onSuccess notice', async () => {
    markSessionDeloadMock.mockResolvedValue('alreadyStarted')
    const { result } = renderHook(() => useSetDeload('meso-1', 3), { wrapper })
    let seen: unknown
    act(() => {
      result.current.mutate({ weekPlanId: 'wp-session', isDeload: true, rules: null }, { onSuccess: (r) => { seen = r } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen).toBe('alreadyStarted')
  })
})
