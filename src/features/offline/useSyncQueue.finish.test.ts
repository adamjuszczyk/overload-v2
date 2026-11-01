// B3 (2 of 5), the replay half: a finish queued offline re-derives its status
// and completed_at from the server's logs once the sets queued before it have
// been sent. The device that queued it may not have seen the whole session
// (sets logged online earlier, an app restart that emptied the query cache).
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends

interface QueueItem {
  id: number
  table: string
  operation: 'upsert'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
  recomputeFinish?: boolean
}
let queue: QueueItem[] = []
let serverLogs: Array<{ session_id: string; logged_at: string; is_skipped: boolean }> = []
const sessionUpserts: Array<Record<string, unknown>> = []
let logReadFails = false

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }),
      delete: async (id: number) => {
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
    },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let sessionId: string | null = null
      const chain: Record<string, unknown> = {
        upsert: async (payload: Record<string, unknown>) => {
          if (table === 'v2_set_logs') {
            serverLogs.push({
              session_id: payload.session_id as string,
              logged_at: payload.logged_at as string,
              is_skipped: payload.is_skipped as boolean,
            })
          } else sessionUpserts.push(payload)
          return { error: null }
        },
        select: () => chain,
        eq: (_col: string, val: string) => {
          sessionId = val
          return chain
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(
            logReadFails
              ? { data: null, error: { message: 'Failed to fetch' } }
              : { data: serverLogs.filter((l) => l.session_id === sessionId), error: null },
          ).then(resolve, reject),
      }
      return chain
    },
  },
}))
vi.mock('../../lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
// Chunk 73: the version check is not what this file looks at (useSyncQueue.versionGate.test.tsx is); the queue here sends as it always did.
vi.mock('../release/versionGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../release/versionGate')>()),
  readVersionGate: () => 'ok' as const,
  useVersionGate: () => 'ok' as const,
}))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { flushSyncQueue } = await import('./useSyncQueue')

const setItem = (n: number, loggedAt: string, isSkipped: boolean): QueueItem => ({
  id: n, table: 'v2_set_logs', operation: 'upsert',
  payload: { id: `l${n}`, session_id: 's1', logged_at: loggedAt, is_skipped: isSkipped },
  createdAt: loggedAt,
})
const finishItem = (n: number, payload: Record<string, unknown>, recomputeFinish: boolean | undefined): QueueItem => ({
  id: n, table: 'v2_sessions', operation: 'upsert',
  payload: { id: 's1', status: 'skipped', completed_at: '2026-10-11T08:00:00Z', ...payload },
  createdAt: '2026-10-11T09:00:00Z',
  recomputeFinish,
})

beforeEach(() => {
  queue = []
  serverLogs = []
  sessionUpserts.length = 0
  logReadFails = false
})

describe('flushSyncQueue — a queued finish is derived from the server’s logs (B3)', () => {
  it('real sets already on the server plus a skipped one queued: completed, at the latest set', async () => {
    serverLogs = [
      { session_id: 's1', logged_at: '2026-10-11T08:10:00Z', is_skipped: false },
      { session_id: 's1', logged_at: '2026-10-11T08:20:00Z', is_skipped: false },
    ]
    queue = [setItem(1, '2026-10-11T08:30:00Z', true), finishItem(2, {}, true)]

    await flushSyncQueue()

    expect(sessionUpserts).toHaveLength(1)
    expect(sessionUpserts[0].status).toBe('completed')
    expect(sessionUpserts[0].completed_at).toBe('2026-10-11T08:30:00Z')
    expect('recomputeFinish' in sessionUpserts[0]).toBe(false)
  })

  it('every set on the server skipped: skipped', async () => {
    queue = [setItem(1, '2026-10-11T08:30:00Z', true), finishItem(2, { status: 'completed' }, true)]
    await flushSyncQueue()
    expect(sessionUpserts[0].status).toBe('skipped')
  })

  it('no logs at all: completed with a null completed_at, like the online finish', async () => {
    queue = [finishItem(1, {}, true)]
    await flushSyncQueue()
    expect(sessionUpserts[0].status).toBe('completed')
    expect(sessionUpserts[0].completed_at).toBeNull()
  })

  it('an item queued before this shipped (no flag) is sent exactly as queued', async () => {
    serverLogs = [{ session_id: 's1', logged_at: '2026-10-11T08:10:00Z', is_skipped: false }]
    queue = [finishItem(1, {}, undefined)]
    await flushSyncQueue()
    expect(sessionUpserts[0]).toEqual({ id: 's1', status: 'skipped', completed_at: '2026-10-11T08:00:00Z' })
  })

  it('if the server’s logs can’t be read, the finish is not sent from a guess; it stays queued', async () => {
    logReadFails = true
    queue = [finishItem(1, {}, true)]
    await flushSyncQueue()
    expect(sessionUpserts).toEqual([])
    expect(queue).toHaveLength(1)
    expect(queue[0].attempts).toBe(1)
  })
})
