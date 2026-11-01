// @vitest-environment jsdom
//
// B3 (3 of 5): an online finish read only the server's copy of the session's
// logs. Sets logged offline and still waiting in the sync queue are not
// there, so the finish wrote a null or early completed_at, or even marked
// the session 'skipped' when the only sets on the server were skipped ones.
// The finish must send the queue first, and when queued writes for the
// session are still left (the flush failed) it must queue itself behind them
// instead of writing from an incomplete read.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { versionCheckAnswers } from '../release/versionGate.testutil'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

type Row = Record<string, unknown>
interface QueueItem { id: number; table: string; operation: 'upsert' | 'delete'; payload: Row; createdAt: string; attempts?: number; sessionId?: string }

const state = {
  queue: [] as QueueItem[],
  serverLogs: [] as Row[],
  sessionUpdates: [] as Row[],
  upsertFails: false,
  deleteFails: false,
  nextQueueId: 100,
}

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => [...state.queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }),
      toArray: async () => [...state.queue],
      add: async (item: Omit<QueueItem, 'id'>) => {
        state.queue.push({ ...item, id: state.nextQueueId++ } as QueueItem)
      },
      delete: async (id: number) => {
        state.queue = state.queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        state.queue = state.queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
    },
    set_logs: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
    sessions: { put: vi.fn() },
  },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let patch: Row | null = null
      let deleting = false
      let deletedId: unknown = null
      const chain: Record<string, unknown> = {
        upsert: async (payload: Row) => {
          if (state.upsertFails) return { error: { message: 'Failed to fetch' } }
          if (table === 'v2_set_logs') state.serverLogs.push(payload)
          return { error: null }
        },
        select: () => chain,
        update: (p: Row) => {
          patch = p
          return chain
        },
        delete: () => {
          deleting = true
          return chain
        },
        eq: (_column: string, value: unknown) => {
          if (deleting) deletedId = value
          return chain
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (deleting) {
            if (state.deleteFails) return Promise.resolve({ error: { message: 'Failed to fetch' } }).then(resolve, reject)
            state.serverLogs = state.serverLogs.filter((l) => l.id !== deletedId)
            return Promise.resolve({ error: null }).then(resolve, reject)
          }
          if (patch) {
            state.sessionUpdates.push(patch)
            return Promise.resolve({ error: null }).then(resolve, reject)
          }
          return Promise.resolve({ data: state.serverLogs, error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  },
}))

const { useCompleteSession } = await import('./useSession')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const queuedSet = (id: string, loggedAt: string, isSkipped: boolean): QueueItem => ({
  id: state.nextQueueId++,
  table: 'v2_set_logs',
  operation: 'upsert',
  payload: { id, session_id: 's1', logged_at: loggedAt, is_skipped: isSkipped },
  createdAt: loggedAt,
})

// The version check has answered: this version may send the queue (chunk 73).
beforeEach(() => versionCheckAnswers())

afterEach(() => {
  state.queue = []
  state.serverLogs = []
  state.sessionUpdates = []
  state.upsertFails = false
  state.deleteFails = false
  queryClient.clear()
})

describe('useCompleteSession online — queued sets are sent before the finish reads (B3)', () => {
  it('completed_at and status come from the sets that were still queued', async () => {
    // The server holds one skipped set; two real sets were logged offline and are still queued.
    state.serverLogs = [{ id: 'a', session_id: 's1', logged_at: '2026-10-11T08:00:00Z', is_skipped: true }]
    state.queue = [
      queuedSet('b', '2026-10-11T08:10:00Z', false),
      queuedSet('c', '2026-10-11T08:20:00Z', false),
    ]
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    const out = await result.current.mutateAsync({ id: 's1', note: null })

    expect(out.status).toBe('completed')
    expect(state.sessionUpdates).toHaveLength(1)
    expect(state.sessionUpdates[0].completed_at).toBe('2026-10-11T08:20:00Z')
    expect(state.queue).toEqual([])
  })

  it('when the queue can’t be sent, the finish queues behind the sets instead of writing from an incomplete read', async () => {
    state.serverLogs = [{ id: 'a', session_id: 's1', logged_at: '2026-10-11T08:00:00Z', is_skipped: true }]
    state.queue = [queuedSet('b', '2026-10-11T08:10:00Z', false)]
    state.upsertFails = true
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    await result.current.mutateAsync({ id: 's1', note: null })

    expect(state.sessionUpdates).toEqual([])
    const finish = state.queue.find((q) => q.table === 'v2_sessions')
    expect(finish).toBeTruthy()
    expect(finish!.payload.id).toBe('s1')
    expect(finish!.payload.status).toBe('completed')
  })

  it('a set deleted offline is deleted on the server before the finish reads: the finish counts what is left', async () => {
    // The server holds a skipped set and a real one; the real one was deleted offline, and its delete is queued.
    state.serverLogs = [
      { id: 'a', session_id: 's1', logged_at: '2026-10-11T08:00:00Z', is_skipped: true },
      { id: 'b', session_id: 's1', logged_at: '2026-10-11T08:10:00Z', is_skipped: false },
    ]
    state.queue = [
      { id: state.nextQueueId++, table: 'v2_set_logs', operation: 'delete', payload: { id: 'b' }, createdAt: '2026-10-11T08:20:00Z', sessionId: 's1' },
    ]
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    const out = await result.current.mutateAsync({ id: 's1', note: null })

    // Only the skipped set is left, so the session is skipped, as if the set had never been logged.
    expect(out.status).toBe('skipped')
    expect(state.sessionUpdates).toHaveLength(1)
    expect(state.sessionUpdates[0].completed_at).toBe('2026-10-11T08:00:00Z')
    expect(state.queue).toEqual([])
  })

  it('when a queued delete can’t be sent, the finish queues behind it instead of counting the set that is about to go', async () => {
    state.serverLogs = [
      { id: 'a', session_id: 's1', logged_at: '2026-10-11T08:00:00Z', is_skipped: true },
      { id: 'b', session_id: 's1', logged_at: '2026-10-11T08:10:00Z', is_skipped: false },
    ]
    state.queue = [
      { id: state.nextQueueId++, table: 'v2_set_logs', operation: 'delete', payload: { id: 'b' }, createdAt: '2026-10-11T08:20:00Z', sessionId: 's1' },
    ]
    state.deleteFails = true
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    await result.current.mutateAsync({ id: 's1', note: null })

    expect(state.sessionUpdates).toEqual([]) // nothing written from the server's incomplete picture
    expect(state.queue.map((q) => [q.table, q.operation])).toEqual([
      ['v2_set_logs', 'delete'],
      ['v2_sessions', 'upsert'],
    ])
  })

  it('with nothing queued the finish is unchanged: one read, one update', async () => {
    state.serverLogs = [{ id: 'a', session_id: 's1', logged_at: '2026-10-11T08:00:00Z', is_skipped: false }]
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    const out = await result.current.mutateAsync({ id: 's1', note: 'ok' })

    expect(out.status).toBe('completed')
    expect(state.sessionUpdates).toEqual([
      { status: 'completed', completed_at: '2026-10-11T08:00:00Z', note: 'ok', energy_rating: null, pump_rating: null },
    ])
  })
})
