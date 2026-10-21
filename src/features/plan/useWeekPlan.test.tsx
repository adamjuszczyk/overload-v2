// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { WeekPlan } from '../../types'
import type { SetTypeOp } from './planSetRows'

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
// Chunk 31 — useRemoveSet's executor.
const removeSetMock = vi.fn()
// Chunk 54a — "+ ADD SET" and a set type change: useAddSet's and useChangeSetType's executors.
const addSetMock = vi.fn()
const applySetTypeOpsMock = vi.fn()
vi.mock('./weekPlanService', () => ({
  removeSet: (...args: unknown[]) => removeSetMock(...args),
  addSet: (...args: unknown[]) => addSetMock(...args),
  applySetTypeOps: (...args: unknown[]) => applySetTypeOpsMock(...args),
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

const { usePlanWeek, planWeekThenFindId, useUpdateSet, useRemoveSet, useAddSet, useChangeSetType, useSetDeload, useSetWeekDeload } = await import('./useWeekPlan')

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
  removeSetMock.mockReset()
  addSetMock.mockReset()
  applySetTypeOpsMock.mockReset()
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

// Chunk 31 (SPEC Plan screen [P1.1]: "A week is compared with its source as it is now"). Plan reads a
// week's source from the meso-wide list (useAllWeekPlans), so an edit that changes a set's numbers or
// removes a set must refresh that list, or a later week would be compared with the content from before
// the edit until the list went stale (5 minutes) — but only when a later week is planned: the list is the
// whole meso, and nothing reads the change otherwise (a week planned later is planned from the server's copy,
// and planning it refreshes the list).
describe('useUpdateSet / useRemoveSet — refresh the meso-wide list a later week is compared with (chunk 31)', () => {
  const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
  const allKey = (mesoId: string) => ['v2_allWeekPlans', mesoId]
  // The meso-wide list as Plan holds it: weeks 4 and 5 planned.
  const seedList = (mesoId = 'meso-1') =>
    queryClient.setQueryData(allKey(mesoId), [fakePlan('wp-4', 4, false), fakePlan('wp-5', 5, false)])
  // A failing assertion must not leave its spy behind to be counted by the next test.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('an edit of a set\'s numbers in a week that has a later planned week invalidates this week\'s list and the meso-wide one', async () => {
    updateSetMock.mockResolvedValue(undefined)
    seedList()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateSet('meso-1', 4), { wrapper })

    act(() => {
      result.current.mutate({ id: 'set-1', changes: { targetWeight: 100 } })
    })

    await waitFor(() => expect(invalidatedKeys(spy)).toContainEqual(allKey('meso-1')))
    expect(invalidatedKeys(spy)).toContainEqual(weekKey('meso-1', 4))
    spy.mockRestore()
  })

  it('so does a failed one (the list is refreshed whichever way the edit ends)', async () => {
    updateSetMock.mockRejectedValue(new Error('nope'))
    seedList()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateSet('meso-1', 4), { wrapper })

    act(() => {
      result.current.mutate({ id: 'set-1', changes: { targetRir: 1 } })
    })

    await waitFor(() => expect(invalidatedKeys(spy)).toContainEqual(allKey('meso-1')))
    spy.mockRestore()
  })

  it('removing a set invalidates this week\'s list and the meso-wide one when a later week is planned', async () => {
    removeSetMock.mockResolvedValue(undefined)
    seedList()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useRemoveSet('meso-1', 4), { wrapper })

    act(() => {
      result.current.mutate('set-1')
    })

    await waitFor(() => expect(invalidatedKeys(spy)).toContainEqual(allKey('meso-1')))
    expect(invalidatedKeys(spy)).toContainEqual(weekKey('meso-1', 4))
    expect(removeSetMock).toHaveBeenCalledWith('set-1')
    spy.mockRestore()
  })

  it('the latest planned week has no week compared with it: its edits refresh only its own list (the whole-meso list is not refetched on every tap)', async () => {
    updateSetMock.mockResolvedValue(undefined)
    removeSetMock.mockResolvedValue(undefined)
    seedList()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const update = renderHook(() => useUpdateSet('meso-1', 5), { wrapper })
    const remove = renderHook(() => useRemoveSet('meso-1', 5), { wrapper })

    act(() => {
      update.result.current.mutate({ id: 'set-1', changes: { targetWeight: 100 } })
      remove.result.current.mutate('set-2')
    })

    await waitFor(() => expect(invalidatedKeys(spy).filter((k) => k.join() === weekKey('meso-1', 5).join())).toHaveLength(2))
    expect(invalidatedKeys(spy)).not.toContainEqual(allKey('meso-1'))
    spy.mockRestore()
  })

  it('the list invalidated is the meso\'s own, not another meso\'s', async () => {
    updateSetMock.mockResolvedValue(undefined)
    seedList('meso-7')
    queryClient.setQueryData(allKey('meso-1'), [fakePlan('wp-9', 9, false)])
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateSet('meso-7', 2), { wrapper })

    act(() => {
      result.current.mutate({ id: 'set-1', changes: { targetWeight: 50 } })
    })

    await waitFor(() => expect(invalidatedKeys(spy)).toContainEqual(allKey('meso-7')))
    expect(invalidatedKeys(spy)).not.toContainEqual(allKey('meso-1'))
    spy.mockRestore()
  })

  // Chunk 54a: a type change adds and removes stage rows, so it changes what a later week is compared with like any other edit of the week's sets.
  it('a set type change refreshes this week and the meso-wide list when a later week is planned, and only its own list when it is the latest week', async () => {
    applySetTypeOpsMock.mockResolvedValue(undefined)
    seedList()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const earlier = renderHook(() => useChangeSetType('meso-1', 4), { wrapper })

    act(() => {
      earlier.result.current.mutate({ ops: [{ kind: 'removeStage', id: 'stage-1' }] })
    })
    await waitFor(() => expect(invalidatedKeys(spy)).toContainEqual(allKey('meso-1')))
    expect(invalidatedKeys(spy)).toContainEqual(weekKey('meso-1', 4))

    spy.mockClear()
    const latest = renderHook(() => useChangeSetType('meso-1', 5), { wrapper })
    act(() => {
      latest.result.current.mutate({ ops: [{ kind: 'removeStage', id: 'stage-1' }] })
    })
    await waitFor(() => expect(invalidatedKeys(spy)).toContainEqual(weekKey('meso-1', 5)))
    expect(invalidatedKeys(spy)).not.toContainEqual(allKey('meso-1'))
    spy.mockRestore()
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

  // Chunk 25 review fix 2 (DECISIONS 73 option a) — the 7th `sequencePosition`
  // argument's own matching (the one site SequenceTodayPage.tsx's Start/
  // Train anyway/Skip and PlanPage.tsx's "COPY THIS WORKOUT" all funnel
  // through): every test above omits it, so none of them ever exercised
  // `(p.sequencePosition ?? null) === sequencePosition` with a real,
  // non-null value — closing that gap directly, at this function's own
  // pure layer, with two rows sharing one workoutDayId at different slots.
  describe('slot identity — sequencePosition picks the right row among several sharing one workoutDayId (chunk 25, R16)', () => {
    it('sequencePosition = 2 finds the position-2 row, never the position-0 row', async () => {
      const planWeek = fakePlanWeek(() => Promise.resolve(1))
      const fetchPlans = vi.fn().mockResolvedValue([
        { id: 'wp-slot0', workoutDayId: 'wd-a', sequencePosition: 0 },
        { id: 'wp-slot2', workoutDayId: 'wd-a', sequencePosition: 2 },
      ])

      const id = await planWeekThenFindId('meso-1', 2, 'wd-a', 'fallback-id', planWeek, fetchPlans, 2)

      expect(id).toBe('wp-slot2')
    })

    it('sequencePosition = 0 finds the position-0 row, never the position-2 row', async () => {
      const planWeek = fakePlanWeek(() => Promise.resolve(1))
      const fetchPlans = vi.fn().mockResolvedValue([
        { id: 'wp-slot0', workoutDayId: 'wd-a', sequencePosition: 0 },
        { id: 'wp-slot2', workoutDayId: 'wd-a', sequencePosition: 2 },
      ])

      const id = await planWeekThenFindId('meso-1', 2, 'wd-a', 'fallback-id', planWeek, fetchPlans, 0)

      expect(id).toBe('wp-slot0')
    })

    it('omitting sequencePosition (every weekday caller) still matches a plain, position-less row — unchanged', async () => {
      const planWeek = fakePlanWeek(() => Promise.resolve(1))
      const fetchPlans = vi.fn().mockResolvedValue([{ id: 'wp-weekday', workoutDayId: 'wd-target' }])

      const id = await planWeekThenFindId('meso-1', 2, 'wd-target', 'fallback-id', planWeek, fetchPlans)

      expect(id).toBe('wp-weekday')
    })
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

describe('useSetWeekDeload — writes the mark without planning the week; optimistic, scoped to one week (chunk 21/22, 52)', () => {
  // Chunk 52 (SPEC Weeks and copying [1.2]: "Opening it doesn't plan it"; TASKS 52: "WEEK ⋯ marks the week through useSetWeekDeload
  // without planning (absence of planWeek in the call)"): the hook used to call planWeek(mesoId, weekNumber) before marking, which planned
  // any week it was asked about. WEEK ⋯ exists only on a planned week, so nothing is planned here, mark or unmark.
  it('marking calls markWeekDeload(userId, mesoId, weekNumber, rules) and never planWeek', async () => {
    markWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: false })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: true, rules: SOME_RULES })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(markWeekDeloadMock).toHaveBeenCalledTimes(1)
    expect(markWeekDeloadMock).toHaveBeenCalledWith('user-1', 'meso-1', 3, SOME_RULES)
    expect(planWeekMock).not.toHaveBeenCalled()
    expect(unmarkWeekDeloadMock).not.toHaveBeenCalled()
  })

  it('unmarking never plans the week either', async () => {
    unmarkWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: false })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: false, rules: SOME_RULES })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(planWeekMock).not.toHaveBeenCalled()
  })

  it('unmarking calls unmarkWeekDeload(userId, mesoId, weekNumber) — never markWeekDeload', async () => {
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
    markWeekDeloadMock.mockResolvedValue({ anyAlreadyStarted: false })

    const { result } = renderHook(() => useSetWeekDeload('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ isDeload: true, rules: null })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(markWeekDeloadMock).toHaveBeenCalledWith('user-1', 'meso-1', 3, null)
  })

  it('the mutation\'s own resolved value carries whether any row hit the started guard, for the caller\'s own onSuccess notice', async () => {
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

// Chunk 54a — "+ ADD SET": the week plan row is given (a week is planned before it is shown), and the write is what the screen named.
describe('useAddSet — adds the set the screen described, to the plan row it was given (chunk 54a)', () => {
  const defaults = { isWarmup: false, stageKind: null, repMin: 8, repMax: 10, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null } as const

  it('calls addSet(userId, weekPlanId, programExerciseId, setNumber, defaults) and makes no week plan of its own', async () => {
    addSetMock.mockResolvedValue({ id: 'new' })
    const { result } = renderHook(() => useAddSet('meso-1', 3), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ weekPlanId: 'wp-1', programExerciseId: 'pe-1', setNumber: 4, defaults })
    })

    expect(addSetMock).toHaveBeenCalledTimes(1)
    expect(addSetMock.mock.calls[0]).toEqual(['user-1', 'wp-1', 'pe-1', 4, defaults])
  })

  it('refreshes this week and the meso-wide list once it has landed, and never pauses offline (networkMode always)', async () => {
    addSetMock.mockResolvedValue({ id: 'new' })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useAddSet('meso-1', 3), { wrapper })
    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ weekPlanId: 'wp-1', programExerciseId: 'pe-1', setNumber: 4, defaults })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([weekKey('meso-1', 3), ['v2_allWeekPlans', 'meso-1']])
    invalidate.mockRestore()
  })
})

// Chunk 54a — a set type change from the set type picker: the ordered writes of planSetRows.ts's plan, one mutation, read again at the end.
describe('useChangeSetType — one change, in the order it was planned, the week read again however it ends (chunk 54a)', () => {
  const ops: SetTypeOp[] = [
    { kind: 'removeStage', id: 'stage-2' },
    { kind: 'removeStage', id: 'stage-1' },
    { kind: 'updateHead', id: 'head', changes: { isWarmup: true, stageKind: null } },
  ]

  it('hands the list to applySetTypeOps with the signed-in user, unchanged and in order', async () => {
    applySetTypeOpsMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useChangeSetType('meso-1', 3), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ ops })
    })

    expect(applySetTypeOpsMock).toHaveBeenCalledTimes(1)
    expect(applySetTypeOpsMock.mock.calls[0]).toEqual(['user-1', ops])
  })

  it('reads this week again after it succeeds, and after it fails too (a part-done change leaves rows the screen must show as they are)', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    applySetTypeOpsMock.mockResolvedValueOnce(undefined)
    const ok = renderHook(() => useChangeSetType('meso-1', 3), { wrapper })
    await act(async () => {
      await ok.result.current.mutateAsync({ ops })
    })
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(weekKey('meso-1', 3))

    invalidate.mockClear()
    applySetTypeOpsMock.mockRejectedValueOnce(new Error('refused'))
    const failing = renderHook(() => useChangeSetType('meso-1', 3), { wrapper })
    await act(async () => {
      await failing.result.current.mutateAsync({ ops }).catch(() => undefined)
    })
    await waitFor(() => expect(failing.result.current.isError).toBe(true))
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(weekKey('meso-1', 3))
    invalidate.mockRestore()
  })

  it('does not pause offline (networkMode always), and patches nothing into the cache first', async () => {
    applySetTypeOpsMock.mockResolvedValue(undefined)
    queryClient.setQueryData(weekKey('meso-1', 3), [fakePlan('wp-1', 3, false)])
    const before = JSON.stringify(queryClient.getQueryData(weekKey('meso-1', 3)))
    const { result } = renderHook(() => useChangeSetType('meso-1', 3), { wrapper })
    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate({ ops })
    })
    expect(JSON.stringify(queryClient.getQueryData(weekKey('meso-1', 3)))).toBe(before)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

// Chunk 54a — the RIR picker's range: the optimistic patch carries the high end with the low end.
describe('useUpdateSet — a RIR range is patched into the cache with both ends (chunk 54a)', () => {
  const planWithSet = (): WeekPlan => ({
    ...fakePlan('wp-1', 3, false),
    sets: [{
      id: 'set-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 3, targetRirMax: null,
      isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
    }],
  })

  it('writes { targetRir: 1, targetRirMax: 2 } and shows 1 and 2 in the week\'s cache while the write is out', async () => {
    let release!: () => void
    updateSetMock.mockImplementation(() => new Promise<void>((r) => (release = r)))
    queryClient.setQueryData(weekKey('meso-1', 3), [planWithSet()])
    const { result } = renderHook(() => useUpdateSet('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ id: 'set-1', changes: { targetRir: 1, targetRirMax: 2 } })
    })
    await waitFor(() => expect(updateSetMock).toHaveBeenCalledWith('set-1', { targetRir: 1, targetRirMax: 2 }))
    const set = (queryClient.getQueryData(weekKey('meso-1', 3)) as WeekPlan[])[0].sets[0]
    expect([set.targetRir, set.targetRirMax]).toEqual([1, 2])
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a change that names only the low end leaves a range\'s high end in the cache alone', async () => {
    let release!: () => void
    updateSetMock.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const plan = planWithSet()
    plan.sets[0] = { ...plan.sets[0], targetRir: 1, targetRirMax: 2 }
    queryClient.setQueryData(weekKey('meso-1', 3), [plan])
    const { result } = renderHook(() => useUpdateSet('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ id: 'set-1', changes: { targetWeight: 80 } })
    })
    await waitFor(() => expect(updateSetMock).toHaveBeenCalled())
    const set = (queryClient.getQueryData(weekKey('meso-1', 3)) as WeekPlan[])[0].sets[0]
    expect([set.targetRir, set.targetRirMax, set.targetWeight]).toEqual([1, 2, 80])
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

// Chunk 54a — what the week's cache holds while a set write is out, and after a refused one: the optimistic patch carries every column a picker or
// a cell writes, a removal takes the row out at once, and a refused write puts the cache back as it was.
describe('useUpdateSet / useRemoveSet — the cache while a write is out, and after a refused one (chunk 54a)', () => {
  const setRow = (id: string, setNumber: number) => ({
    id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber, targetRir: 3, targetRirMax: null as number | null,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: 60 as number | null, repMin: 8, repMax: 12,
    isAmrap: false, tags: null as string[] | null, stageKind: null as string | null,
  })
  const seed = () => queryClient.setQueryData(weekKey('meso-1', 3), [{ ...fakePlan('wp-1', 3, false), sets: [setRow('set-1', 1), setRow('set-2', 2)] }])
  const setsNow = () => (queryClient.getQueryData(weekKey('meso-1', 3)) as WeekPlan[])[0].sets

  it('an update patches every column it names into the set it names, and only that set, while the write is out', async () => {
    let release!: () => void
    updateSetMock.mockImplementation(() => new Promise<void>((r) => (release = r)))
    seed()
    const { result } = renderHook(() => useUpdateSet('meso-1', 3), { wrapper })
    const changes = { targetRir: 1, targetRirMax: 2, stageKind: 'cluster' as const, isWarmup: true, targetWeight: 80, repMin: 4, repMax: 6, isAmrap: true, tags: ['push here'] }
    act(() => {
      result.current.mutate({ id: 'set-1', changes })
    })
    await waitFor(() => expect(updateSetMock).toHaveBeenCalledWith('set-1', changes))

    expect(setsNow()[0]).toMatchObject(changes)
    expect(setsNow()[1]).toEqual(setRow('set-2', 2))
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a refused update puts the cache back as it was', async () => {
    updateSetMock.mockRejectedValue(new Error('refused'))
    seed()
    const before = JSON.stringify(queryClient.getQueryData(weekKey('meso-1', 3)))
    const { result } = renderHook(() => useUpdateSet('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate({ id: 'set-1', changes: { repMin: 4, repMax: 6 } })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(JSON.stringify(queryClient.getQueryData(weekKey('meso-1', 3)))).toBe(before)
  })

  it('a removal takes the set out of the week at once, while the write is out, and no other', async () => {
    let release!: () => void
    removeSetMock.mockImplementation(() => new Promise<void>((r) => (release = r)))
    seed()
    const { result } = renderHook(() => useRemoveSet('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate('set-1')
    })
    await waitFor(() => expect(removeSetMock).toHaveBeenCalledWith('set-1'))

    expect(setsNow().map((s) => s.id)).toEqual(['set-2'])
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a refused removal puts the set back', async () => {
    removeSetMock.mockRejectedValue(new Error('refused'))
    seed()
    const before = JSON.stringify(queryClient.getQueryData(weekKey('meso-1', 3)))
    const { result } = renderHook(() => useRemoveSet('meso-1', 3), { wrapper })
    act(() => {
      result.current.mutate('set-1')
    })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(JSON.stringify(queryClient.getQueryData(weekKey('meso-1', 3)))).toBe(before)
  })
})
