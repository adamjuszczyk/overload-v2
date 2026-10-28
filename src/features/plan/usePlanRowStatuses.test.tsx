// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import { fakePostgrest, type FakePostgrest, type Row } from '../programs/fakePostgrest.testutil'
import type { Session } from '../../types'

// The statuses behind the "CHANGE THE PROGRAM FROM WEEK N" button (DECISIONS 172 (j), Adam, 2026-10-19: "The button follows the
// screen."). The hook is the screen's own read (`fetchPlanRowStatuses`), so these tests prove what the button's reading takes from
// the rows: a session of another run, one with no plan row, one that is only planned, and a row with a session in progress and one
// done. The rest of the chain is held where it lives: `changeProgramService.test.ts` reads the same function against the world's
// rows, and PlanPage.changeProgramButton.screenRule.test.tsx holds the button against the screen's rule box.

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
const h = vi.hoisted(() => ({ client: null as unknown, signedIn: true }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: h.signedIn ? { id: 'user-1' } : null }) }))

// (Spread arguments, not a named table: scripts/verify-rls-tables.test.mjs lists the calls of the table reader that name their table by a variable.)
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: [string]) => (h.client as FakePostgrest['client']).from(...args) },
}))
// A start sends the sync queue first only when it is offline; nothing is queued here.
vi.mock('../offline/useSyncQueue', () => ({
  flushSyncQueue: async () => {},
  hasQueuedWritesFor: async () => false,
}))
const createSessionMock = vi.fn()
vi.mock('../gym/sessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gym/sessionService')>()),
  createSession: (...a: unknown[]) => createSessionMock(...a),
}))

const { usePlanRowStatuses } = await import('./usePlanRowStatuses')
const { DONE_WEEK_PLANS_KEY } = await import('./useDoneWeekPlanIds')
const { useCreateSession } = await import('../gym/useSession')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const MESO = 'meso-1'
const row = (id: string, mesoId: string, planId: string | null, status: string): Row => ({ id, user_id: 'user-1', mesocycle_id: mesoId, week_plan_id: planId, status })

let fake: FakePostgrest
function serve(sessions: Row[]) {
  fake = fakePostgrest({ v2_sessions: sessions })
  h.client = fake.client
}

beforeEach(() => {
  h.signedIn = true
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false } })
})
afterEach(() => {
  queryClient.clear()
  createSessionMock.mockReset()
  vi.restoreAllMocks()
})

describe('usePlanRowStatuses: the screen’s statuses of the run’s plan rows', () => {
  it('done, skipped and in progress sessions give their plan row a status; done wins on a row that has both; a row with nothing else is not in the map', async () => {
    serve([
      row('s1', MESO, 'plan-completed', 'completed'),
      row('s2', MESO, 'plan-skipped', 'skipped'),
      row('s3', MESO, 'plan-in-progress', 'in_progress'),
      row('s4', MESO, 'plan-planned', 'planned'), // moved here, not started
      row('s5', MESO, 'plan-both', 'in_progress'),
      row('s6', MESO, 'plan-both', 'completed'), // a shared G14 row: one weekday done, the other started
      row('s7', MESO, null, 'in_progress'), // a session with no plan row
      row('s8', 'meso-other', 'plan-elsewhere', 'in_progress'), // another run's
      row('s9', 'meso-other', 'plan-completed', 'completed'), // another run's session on a row id of this run's: never read
    ])
    const { result } = renderHook(() => usePlanRowStatuses(MESO), { wrapper })
    await waitFor(() => expect(result.current.size).toBeGreaterThan(0))
    expect(Object.fromEntries(result.current)).toEqual({
      'plan-completed': 'done',
      'plan-skipped': 'done',
      'plan-in-progress': 'in_progress',
      'plan-both': 'done',
    })
  })

  it('asks for this run’s sessions only, and for completed, skipped and in progress ones', async () => {
    serve([row('s1', MESO, 'plan-a', 'in_progress')])
    const { result } = renderHook(() => usePlanRowStatuses(MESO), { wrapper })
    await waitFor(() => expect(result.current.get('plan-a')).toBe('in_progress'))
    const [request] = fake.to('v2_sessions')
    expect(request.filters).toContainEqual({ op: 'eq', column: 'mesocycle_id', value: MESO })
    expect(request.filters).toContainEqual({ op: 'in', column: 'status', value: ['completed', 'skipped', 'in_progress'] })
    expect(request.filters).toContainEqual({ op: 'not-is', column: 'week_plan_id', value: null })
  })

  it('reads nothing without a run, and answers an empty map', async () => {
    serve([row('s1', MESO, 'plan-a', 'in_progress')])
    const { result } = renderHook(() => usePlanRowStatuses(undefined), { wrapper })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(result.current.size).toBe(0)
    expect(fake.requests).toEqual([])
  })

  it('reads nothing when nobody is signed in', async () => {
    h.signedIn = false
    serve([row('s1', MESO, 'plan-a', 'in_progress')])
    const { result } = renderHook(() => usePlanRowStatuses(MESO), { wrapper })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(result.current.size).toBe(0)
    expect(fake.requests).toEqual([])
  })

  it('is empty while it loads, and the same empty map each time (nothing downstream re-runs for a new one)', async () => {
    serve([])
    const { result, rerender } = renderHook(() => usePlanRowStatuses(MESO), { wrapper })
    const first = result.current
    expect(first.size).toBe(0)
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('what refreshes the done list refreshes the statuses too', () => {
  it('invalidating the done list’s key (what starting, finishing, reopening, skipping and moving a session do) re-reads them', async () => {
    serve([])
    const { result } = renderHook(() => usePlanRowStatuses(MESO), { wrapper })
    await waitFor(() => expect(fake.to('v2_sessions').length).toBe(1))
    expect(result.current.size).toBe(0)
    serve([row('s1', MESO, 'plan-a', 'in_progress')])
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [DONE_WEEK_PLANS_KEY] })
    })
    await waitFor(() => expect(result.current.get('plan-a')).toBe('in_progress'))
  })

  it('starting a session moves its plan row to in progress: the start refreshes the statuses Plan holds', async () => {
    serve([])
    createSessionMock.mockImplementation(async (userId: string, mesoId: string, weekPlanId: string | null, workoutDayId: string, date: string, _moved: unknown, id: string) => {
      // the start has landed in the table by the time the hook invalidates
      serve([row(id, mesoId, weekPlanId, 'in_progress')])
      return { id, userId, mesocycleId: mesoId, weekPlanId, workoutDayId, date, status: 'in_progress', setLogs: [] } as unknown as Session
    })
    const { result } = renderHook(() => ({ statuses: usePlanRowStatuses(MESO), create: useCreateSession() }), { wrapper })
    await waitFor(() => expect(fake.to('v2_sessions').length).toBe(1))
    expect(result.current.statuses.size).toBe(0)
    await act(async () => {
      await result.current.create.mutateAsync({ mesoId: MESO, weekPlanId: 'plan-a', workoutDayId: 'wd-1', date: '2026-10-19' })
    })
    await waitFor(() => expect(result.current.statuses.get('plan-a')).toBe('in_progress'))
  })
})
