// Writes to the same record keep their order (CONTEXT.md open item, found
// fixing B3). flushSyncQueue used to move past a write that failed, send the
// later writes, and retry the failed one on a later pass, where it landed on
// top of the newer write. Now a failed write holds back every later write to
// the same record (and to records that depend on it: a session's sets, a
// head's stages) until it succeeds. Other records still go. After
// MAX_SYNC_ATTEMPTS failed passes it stops retrying, stays queued, and is
// reported to the screen it belongs to; it is never dropped.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface QueueItem {
  id: number
  table: string
  operation: 'upsert'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
  gaveUp?: boolean
}

let queue: QueueItem[] = []
// The server: one row per (table, id); the last upsert wins, as in Postgres.
let server = new Map<string, Record<string, unknown>>()
// How many more times an upsert of a given payload tag fails.
let failures = new Map<string, number>()
let sent: string[] = []

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({
        toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
      }),
      toArray: async () => [...queue],
      delete: async (id: number) => {
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
      bulkUpdate: async () => {},
    },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        const tag = payload.tag as string
        const left = failures.get(tag) ?? 0
        if (left > 0) {
          failures.set(tag, left - 1)
          return { error: { message: 'Failed to fetch' } }
        }
        sent.push(tag)
        server.set(`${table}:${payload.id}`, payload)
        return { error: null }
      },
    }),
  },
}))
vi.mock('../../lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { flushSyncQueue, retrySyncFailures, MAX_SYNC_ATTEMPTS } = await import('./useSyncQueue')
const { useOfflineStore } = await import('./offlineStore')

let nextId = 1
function enqueue(table: string, payload: Record<string, unknown>) {
  const n = nextId++
  queue.push({
    id: n,
    table,
    operation: 'upsert',
    payload,
    createdAt: `2026-10-11T08:00:${String(n).padStart(2, '0')}Z`,
  })
}
const setEdit = (tag: string, weight: number, extra: Record<string, unknown> = {}) =>
  enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight, tag, ...extra })

beforeEach(() => {
  queue = []
  server = new Map()
  failures = new Map()
  sent = []
  nextId = 1
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
})

describe('flushSyncQueue — writes to the same record keep their order', () => {
  it('two edits to the same set, the first fails once: the server ends with the second edit', async () => {
    setEdit('first', 100)
    setEdit('second', 110)
    failures.set('first', 1)

    await flushSyncQueue() // the first fails; the second must wait behind it
    await flushSyncQueue() // both go, in order

    expect(server.get('v2_set_logs:l1')?.weight).toBe(110)
    expect(sent).toEqual(['first', 'second'])
    expect(queue).toEqual([])
  })

  it('a failed write does not hold back writes to other records', async () => {
    setEdit('l1-first', 100)
    enqueue('v2_set_logs', { id: 'l2', session_id: 's1', weight: 60, tag: 'l2' })
    failures.set('l1-first', 1)

    await flushSyncQueue()

    expect(sent).toEqual(['l2'])
    expect(queue.map((q) => q.payload.tag)).toEqual(['l1-first'])
  })

  it('a session whose own write failed holds back its sets, and a head holds back its stages', async () => {
    enqueue('v2_sessions', { id: 's1', status: 'in_progress', tag: 'session' })
    enqueue('v2_set_logs', { id: 'h1', session_id: 's1', tag: 'head' })
    enqueue('v2_set_logs', { id: 'st1', session_id: 's1', parent_set_id: 'h1', tag: 'stage' })
    enqueue('v2_set_logs', { id: 'o1', session_id: 's2', tag: 'other-session' })
    failures.set('session', 1)

    await flushSyncQueue()
    expect(sent).toEqual(['other-session'])

    await flushSyncQueue()
    expect(sent).toEqual(['other-session', 'session', 'head', 'stage'])
  })

  it(`after MAX_SYNC_ATTEMPTS failed passes it stops retrying, stays queued, and is reported for its session`, async () => {
    setEdit('first', 100)
    setEdit('second', 110)
    failures.set('first', 1000)

    for (let i = 0; i < MAX_SYNC_ATTEMPTS + 2; i++) await flushSyncQueue()

    // Never dropped: both still queued, in order; only MAX attempts were made.
    expect(queue.map((q) => q.payload.tag)).toEqual(['first', 'second'])
    expect(queue[0].gaveUp).toBe(true)
    expect(queue[0].attempts).toBe(MAX_SYNC_ATTEMPTS)
    expect(failures.get('first')).toBe(1000 - MAX_SYNC_ATTEMPTS)
    expect(sent).toEqual([])
    const reported = useOfflineStore.getState().syncFailures
    expect(reported.map((f) => [f.sessionId, f.recordId])).toEqual([['s1', 'l1'], ['s1', 'l1']])
    expect(useOfflineStore.getState().failedIds.has('l1')).toBe(true)
  })

  it('tapping retry sends it again, then the write behind it; the report clears', async () => {
    setEdit('first', 100)
    setEdit('second', 110)
    failures.set('first', MAX_SYNC_ATTEMPTS)
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()
    expect(queue[0].gaveUp).toBe(true)

    await retrySyncFailures()

    expect(sent).toEqual(['first', 'second'])
    expect(server.get('v2_set_logs:l1')?.weight).toBe(110)
    expect(queue).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(useOfflineStore.getState().failedIds.size).toBe(0)
  })
})
