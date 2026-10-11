// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const calls: Array<{ method: string; args: unknown[] }> = []
let pages: Array<Array<{ id: string; week_plan_id: string }>> = []

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'not', 'order']) {
        chain[m] = (...args: unknown[]) => {
          calls.push({ method: m, args })
          return chain
        }
      }
      chain.range = async (...args: unknown[]) => {
        calls.push({ method: 'range', args })
        return { data: pages.shift() ?? [], error: null }
      }
      return chain
    },
  },
}))

// The finish sends the sync queue first (B3); nothing is queued here.
vi.mock('../offline/useSyncQueue', () => ({
  flushSyncQueue: async () => {},
  hasQueuedWritesFor: async () => false,
}))

const completeSessionMock = vi.fn().mockResolvedValue({ status: 'completed' })
const reopenSessionMock = vi.fn().mockResolvedValue({ startedAt: null })
const skipSessionMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../gym/sessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gym/sessionService')>()),
  completeSession: (...a: unknown[]) => completeSessionMock(...a),
  reopenSession: (...a: unknown[]) => reopenSessionMock(...a),
  skipSession: (...a: unknown[]) => skipSessionMock(...a),
}))

const { fetchDoneWeekPlanIds, DONE_WEEK_PLANS_KEY } = await import('./useDoneWeekPlanIds')
const { useCompleteSession, useReopenSession, useSkipSession } = await import('../gym/useSession')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  calls.length = 0
  pages = []
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('fetchDoneWeekPlanIds', () => {
  it('asks for this run’s completed and skipped sessions that have a week plan, and de-duplicates', async () => {
    pages = [[
      { id: 's1', week_plan_id: 'wp-1' },
      { id: 's2', week_plan_id: 'wp-1' },
      { id: 's3', week_plan_id: 'wp-2' },
    ]]
    const ids = await fetchDoneWeekPlanIds('meso-1')
    expect(ids.sort()).toEqual(['wp-1', 'wp-2'])
    expect(calls).toContainEqual({ method: 'eq', args: ['mesocycle_id', 'meso-1'] })
    expect(calls).toContainEqual({ method: 'in', args: ['status', ['completed', 'skipped']] })
    expect(calls).toContainEqual({ method: 'not', args: ['week_plan_id', 'is', null] })
  })

  it('pages until a short page, so a run past PostgREST’s row cap isn’t cut off', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, week_plan_id: `wp-${i}` }))
    pages = [full, [{ id: 'z', week_plan_id: 'wp-last' }]]
    const ids = await fetchDoneWeekPlanIds('meso-1')
    expect(ids).toHaveLength(501)
    expect(ids).toContain('wp-last')
    expect(calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 499], [500, 999]])
  })
})

describe('a session finishing, reopening or skipping refreshes the done list Plan reads', () => {
  for (const [name, run] of [
    ['complete', async () => { const { result } = renderHook(() => useCompleteSession(), { wrapper }); await result.current.mutateAsync({ id: 's1', note: null }) }],
    ['reopen', async () => { const { result } = renderHook(() => useReopenSession(), { wrapper }); await result.current.mutateAsync('s1') }],
    ['skip', async () => { const { result } = renderHook(() => useSkipSession(), { wrapper }); await result.current.mutateAsync('s1') }],
  ] as const) {
    it(name, async () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries')
      await run()
      expect(spy).toHaveBeenCalledWith({ queryKey: [DONE_WEEK_PLANS_KEY] })
    })
  }
})
