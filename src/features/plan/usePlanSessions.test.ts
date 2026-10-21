// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

// Chunk 54b: the run's sessions with a plan row, as the week view reads them (usePlanSessions.ts): the columns it asks for, the run's own
// rows only, a session without a plan row left out, ordered and paged under PostgREST's row cap (Checks that lied #31), mapped to what the
// chips read. (The hook is the useQuery around this; every PlanPage test mocks it.)

const calls: Array<{ method: string; args: unknown[] }> = []
let pages: Array<Array<Record<string, unknown>>> = []
let failWith: unknown = null

vi.mock('../../lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'not', 'order']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    }
    builder.range = (...args: unknown[]) => {
      calls.push({ method: 'range', args })
      const index = calls.filter((c) => c.method === 'range').length - 1
      return Promise.resolve(failWith ? { data: null, error: failWith } : { data: pages[index] ?? [], error: null })
    }
    return builder
  }
  return { supabase: { from: (table: string) => (calls.push({ method: 'from', args: [table] }), chain()) } }
})

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { fetchPlanSessions, usePlanSessions } = await import('./usePlanSessions')
const { DONE_WEEK_PLANS_KEY } = await import('./useDoneWeekPlanIds')

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `s-${String(n).padStart(4, '0')}`, week_plan_id: `wp-${n}`, workout_day_id: 'wd-1', date: '2026-10-19', moved_to_date: null, status: 'completed', ...over,
})

beforeEach(() => {
  calls.length = 0
  pages = []
  failWith = null
})

describe('fetchPlanSessions', () => {
  it('reads this run\'s sessions that have a plan row, by the columns the chips need, in an order', async () => {
    pages = [[row(1)]]
    await fetchPlanSessions('meso-9')
    expect(calls).toContainEqual({ method: 'from', args: ['v2_sessions'] })
    expect(calls).toContainEqual({ method: 'select', args: ['id, week_plan_id, workout_day_id, date, moved_to_date, status'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['mesocycle_id', 'meso-9'] })
    expect(calls).toContainEqual({ method: 'not', args: ['week_plan_id', 'is', null] })
    expect(calls).toContainEqual({ method: 'order', args: ['id'] })
  })

  it('maps a row to what the week view reads, a missing moved_to_date to null', async () => {
    pages = [[row(1, { moved_to_date: '2026-10-23', status: 'planned' }), row(2, { moved_to_date: undefined, workout_day_id: null })]]
    expect(await fetchPlanSessions('meso-1')).toEqual([
      { id: 's-0001', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-10-19', movedToDate: '2026-10-23', status: 'planned' },
      { id: 's-0002', weekPlanId: 'wp-2', workoutDayId: null, date: '2026-10-19', movedToDate: null, status: 'completed' },
    ])
  })

  it('pages: a full page asks for the next range, a short page stops, and every row comes back', async () => {
    pages = [Array.from({ length: 500 }, (_, i) => row(i)), Array.from({ length: 500 }, (_, i) => row(500 + i)), [row(1000)]]
    const all = await fetchPlanSessions('meso-1')
    expect(all).toHaveLength(1001)
    expect(calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 499], [500, 999], [1000, 1499]])
  })

  it('a failed read throws it (the page keeps its chips without states rather than drawing wrong ones)', async () => {
    failWith = new Error('boom')
    await expect(fetchPlanSessions('meso-1')).rejects.toThrow('boom')
  })

  it('the hook\'s key sits under the done list\'s prefix, so whatever refreshes that list (a start, a finish, a skip, a move) refreshes this one', async () => {
    pages = [[row(1)]]
    const client = new QueryClient()
    const { result } = renderHook(() => usePlanSessions('meso-1'), { wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children) })
    await waitFor(() => expect(result.current).toHaveLength(1))
    const byPrefix = client.getQueryCache().findAll({ queryKey: [DONE_WEEK_PLANS_KEY] })
    expect(byPrefix.map((q) => q.queryKey)).toEqual([[DONE_WEEK_PLANS_KEY, 'sessions', 'meso-1']])
  })
})
