// Writes to the same record keep their order (CONTEXT.md open item, found
// fixing B3). flushSyncQueue used to move past a write that failed, send the
// later writes, and retry the failed one on a later pass, where it landed on
// top of the newer write. Now a failed write holds back every later write to
// the same record (and to records that depend on it: a session's sets, a
// head's stages) until it succeeds. Other records still go. After
// MAX_SYNC_ATTEMPTS failed passes it stops retrying, stays queued, and is
// reported to the screen it belongs to; it is never dropped.
//
// Chunk 57 (G47): a queued `delete` item is executed with the same ordering.
// The fake server below checks the call shape (`delete().eq('id', id)` and
// nothing else), cascades a head's delete to its stages and refuses a stage
// whose head it doesn't hold, so an order that would fail live fails here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

interface QueueItem {
  id: number
  table: string
  operation: 'upsert' | 'delete'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
  gaveUp?: boolean
  sendStarted?: boolean
  sessionId?: string
  parentSetId?: string
}

let queue: QueueItem[] = []
let nextId = 1
// The server: one row per (table, id); the last upsert wins, as in Postgres.
let server = new Map<string, Record<string, unknown>>()
// How many more times a request fails: an upsert by its payload tag, a delete
// as `del:<id>`.
let failures = new Map<string, number>()
// The upsert tags that reached the server, in order.
let sent: string[] = []
// Every request that reached the server, in order: `upsert <tag>` or
// `delete <table>:<id>`.
let requests: string[] = []
// Whether the queue said `sendStarted` for an upsert at the moment its request
// arrived, by tag.
let startedWhenSent = new Map<string, boolean>()
// The device's own copies of logs (Dexie `set_logs`), by id.
let deviceLogs = new Set<string>()

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({
        toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
      }),
      toArray: async () => [...queue],
      add: async (item: Omit<QueueItem, 'id'>) => {
        queue.push({ ...item, id: nextId++ })
      },
      delete: async (id: number) => {
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
      bulkUpdate: async () => {},
    },
    set_logs: {
      delete: async (id: string) => {
        deviceLogs.delete(id)
      },
    },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        const tag = payload.tag as string
        startedWhenSent.set(tag, queue.find((q) => q.payload.tag === tag)?.sendStarted === true)
        const left = failures.get(tag) ?? 0
        if (left > 0) {
          failures.set(tag, left - 1)
          return { error: { message: 'Failed to fetch' } }
        }
        // The foreign key: a stage's head must already be there.
        const head = payload.parent_set_id as string | undefined
        if (head && !server.has(`${table}:${head}`)) {
          return { error: { message: 'violates foreign key constraint', code: '23503' } }
        }
        sent.push(tag)
        requests.push(`upsert ${tag}`)
        server.set(`${table}:${payload.id}`, payload)
        return { error: null }
      },
      delete: () => ({
        eq: async (column: string, value: string) => {
          // The call shape of a queued delete: the id, and nothing else.
          if (column !== 'id') throw new Error(`a queued delete filters on id only, not ${column}`)
          const left = failures.get(`del:${value}`) ?? 0
          if (left > 0) {
            failures.set(`del:${value}`, left - 1)
            return { error: { message: 'Failed to fetch' } }
          }
          requests.push(`delete ${table}:${value}`)
          server.delete(`${table}:${value}`)
          // The cascade: a head takes its stages with it.
          for (const [key, row] of [...server]) {
            if (key.startsWith(`${table}:`) && row.parent_set_id === value) server.delete(key)
          }
          return { error: null }
        },
      }),
    }),
  },
}))
vi.mock('../../lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { flushSyncQueue, retrySyncFailures, hasQueuedWritesFor, queueSetLogDelete, MAX_SYNC_ATTEMPTS } = await import('./useSyncQueue')
const { useOfflineStore } = await import('./offlineStore')

const stamp = (n: number) => `2026-10-11T08:00:${String(n).padStart(2, '0')}Z`
function enqueue(table: string, payload: Record<string, unknown>, extra: Partial<QueueItem> = {}) {
  const n = nextId++
  queue.push({ id: n, table, operation: 'upsert', payload, createdAt: stamp(n), ...extra })
}
// A delete item as `queueSetLogDelete` queues it: the payload is only { id }.
function enqueueDelete(table: string, id: string, extra: Partial<QueueItem> = {}) {
  const n = nextId++
  queue.push({ id: n, table, operation: 'delete', payload: { id }, createdAt: stamp(n), ...extra })
}
const setEdit = (tag: string, weight: number, extra: Record<string, unknown> = {}) =>
  enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight, tag, ...extra })

beforeEach(() => {
  queue = []
  server = new Map()
  failures = new Map()
  sent = []
  requests = []
  startedWhenSent = new Map()
  deviceLogs = new Set()
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

describe('flushSyncQueue — delete items (G47)', () => {
  it.each([
    ['it failed once', { attempts: 1 }],
    ['its send started', { sendStarted: true }],
  ])('an upsert that may be on the server (%s), then a delete of the same row: replayed in that order, the row ends absent', async (_why, marker) => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, marker)
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await flushSyncQueue()

    expect(requests).toEqual(['upsert log', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
    expect(queue).toEqual([])
  })

  it('a delete whose upsert never left the device sends nothing and leaves the queue empty', async () => {
    useOfflineStore.getState().addPending('l1')
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    // The control: the pass does run, and sends what is not cancelled.
    enqueue('v2_set_logs', { id: 'l2', session_id: 's1', weight: 60, tag: 'other' })

    await flushSyncQueue()

    expect(requests).toEqual(['upsert other'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
    expect(queue).toEqual([])
    expect(useOfflineStore.getState().pendingIds.has('l1')).toBe(false)
  })

  it('a pair cancels even while its session is not on the server yet, and never goes after it', async () => {
    enqueue('v2_sessions', { id: 's1', status: 'in_progress', tag: 'session' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('session', 1)

    await flushSyncQueue() // the session fails; the pair is gone before anything is sent
    expect(queue.map((q) => q.payload.tag)).toEqual(['session'])

    await flushSyncQueue()
    expect(requests).toEqual(['upsert session'])
    expect(queue).toEqual([])
  })

  it('with any earlier write that may be on the server, the delete is sent after them all', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'first' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 110, tag: 'second' }, { attempts: 1 })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await flushSyncQueue()

    expect(requests).toEqual(['upsert first', 'upsert second', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
  })

  it('only the writes before the delete cancel with it: a later write to the row still goes', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 90, tag: 'again' })

    await flushSyncQueue()

    expect(requests).toEqual(['upsert again'])
    expect(server.get('v2_set_logs:l1')?.weight).toBe(90)
    expect(queue).toEqual([])
  })

  it('a failed delete holds back the later writes to the row, and is retried', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, { attempts: 1 })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 90, tag: 'again' })
    failures.set('del:l1', 1)

    await flushSyncQueue() // the log goes, the delete fails, 'again' waits behind it
    expect(requests).toEqual(['upsert log'])
    expect(queue.map((q) => `${q.operation} ${q.payload.tag ?? q.payload.id}`)).toEqual(['delete l1', 'upsert again'])
    expect(queue[0].attempts).toBe(1)

    await flushSyncQueue() // the delete is retried, then the later write
    expect(requests).toEqual(['upsert log', 'delete v2_set_logs:l1', 'upsert again'])
    expect(server.get('v2_set_logs:l1')?.weight).toBe(90)
    expect(queue).toEqual([])
  })

  it('a delete that keeps failing stops retrying, stays queued and is reported for its session; retry sends it', async () => {
    server.set('v2_set_logs:l1', { id: 'l1' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('del:l1', MAX_SYNC_ATTEMPTS)

    for (let i = 0; i < MAX_SYNC_ATTEMPTS + 1; i++) await flushSyncQueue()

    expect(queue).toHaveLength(1)
    expect(queue[0].gaveUp).toBe(true)
    expect(queue[0].attempts).toBe(MAX_SYNC_ATTEMPTS)
    expect(requests).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([{ queueId: 1, table: 'v2_set_logs', recordId: 'l1', sessionId: 's1' }])

    await retrySyncFailures()

    expect(requests).toEqual(['delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
    expect(queue).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
  })

  it('a queued delete that names no row is never sent', async () => {
    queue.push({ id: nextId++, table: 'v2_set_logs', operation: 'delete', payload: {}, createdAt: stamp(1) })

    await flushSyncQueue()

    expect(requests).toEqual([])
    expect(queue).toHaveLength(1)
    expect(queue[0].attempts).toBe(1)
  })

  it('an upsert is marked as sent before its request goes out, and stays marked when it fails', async () => {
    setEdit('first', 100)
    failures.set('first', 1)

    await flushSyncQueue()

    expect(startedWhenSent.get('first')).toBe(true) // the queue said so when the request arrived
    expect(queue[0].sendStarted).toBe(true)
  })

  it('a write that gave up under an older build counts as sent after a retry: its delete goes after it', async () => {
    // Given up before this build existed: attempts at the limit, gaveUp, no sendStarted.
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, { attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await retrySyncFailures()

    expect(requests).toEqual(['upsert log', 'delete v2_set_logs:l1'])
    expect(queue).toEqual([])
  })
})

describe('flushSyncQueue — a head’s delete waits for its stages (G47)', () => {
  beforeEach(() => {
    // The head and one stage are on the server already.
    server.set('v2_set_logs:h1', { id: 'h1' })
    server.set('v2_set_logs:st1', { id: 'st1', parent_set_id: 'h1' })
  })

  it('behind a stage delete that failed', async () => {
    enqueueDelete('v2_set_logs', 'st1', { sessionId: 's1', parentSetId: 'h1' })
    enqueueDelete('v2_set_logs', 'h1', { sessionId: 's1' })
    failures.set('del:st1', 1)

    await flushSyncQueue()
    expect(requests).toEqual([]) // the head did not go ahead of its stage
    expect(queue).toHaveLength(2)

    await flushSyncQueue()
    expect(requests).toEqual(['delete v2_set_logs:st1', 'delete v2_set_logs:h1'])
    expect(server.size).toBe(0)
    expect(queue).toEqual([])
  })

  it('behind a stage upsert that failed (it would only fail on the foreign key once the head is gone)', async () => {
    enqueue('v2_set_logs', { id: 'st2', session_id: 's1', parent_set_id: 'h1', tag: 'stage' }, { attempts: 1 })
    enqueueDelete('v2_set_logs', 'h1', { sessionId: 's1' })
    failures.set('stage', 1)

    await flushSyncQueue()
    expect(requests).toEqual([])
    expect(queue).toHaveLength(2)

    await flushSyncQueue()
    expect(requests).toEqual(['upsert stage', 'delete v2_set_logs:h1'])
    expect(server.size).toBe(0) // the head's delete took both stages
    expect(queue).toEqual([])
  })

  it('and is reported with a stage delete that gave up, both under their session; retry sends them in order', async () => {
    enqueueDelete('v2_set_logs', 'st1', { sessionId: 's1', parentSetId: 'h1' })
    enqueueDelete('v2_set_logs', 'h1', { sessionId: 's1' })
    failures.set('del:st1', MAX_SYNC_ATTEMPTS)

    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()

    expect(requests).toEqual([])
    expect(useOfflineStore.getState().syncFailures.map((f) => [f.recordId, f.sessionId])).toEqual([['st1', 's1'], ['h1', 's1']])

    await retrySyncFailures()

    expect(requests).toEqual(['delete v2_set_logs:st1', 'delete v2_set_logs:h1'])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(queue).toEqual([])
  })

  it('but not behind the failed delete of a stage of another head', async () => {
    server.set('v2_set_logs:h9', { id: 'h9' })
    server.set('v2_set_logs:st9', { id: 'st9', parent_set_id: 'h9' })
    enqueueDelete('v2_set_logs', 'st9', { sessionId: 's1', parentSetId: 'h9' })
    enqueueDelete('v2_set_logs', 'h1', { sessionId: 's1' })
    failures.set('del:st9', 1)

    await flushSyncQueue()

    expect(requests).toEqual(['delete v2_set_logs:h1'])
    expect(queue.map((q) => q.payload.id)).toEqual(['st9'])
  })
})

describe('hasQueuedWritesFor — a queued delete counts (G47)', () => {
  it('is true for the session a queued delete belongs to, not for another, and false for an empty queue', async () => {
    expect(await hasQueuedWritesFor('s1')).toBe(false)

    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    expect(await hasQueuedWritesFor('s1')).toBe(true)
    expect(await hasQueuedWritesFor('s2')).toBe(false)
  })

  it('still counts a session’s set log and the session row itself, as before', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', tag: 'log' })
    enqueue('v2_sessions', { id: 's2', status: 'in_progress', tag: 'session' })

    expect(await hasQueuedWritesFor('s1')).toBe(true)
    expect(await hasQueuedWritesFor('s2')).toBe(true)
    expect(await hasQueuedWritesFor('s3')).toBe(false)
  })
})

describe('queueSetLogDelete (G47; chunks 61 and 63 call it)', () => {
  beforeEach(() => {
    // Queue stamps are the time of the call; the other items here are 08:00.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T09:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues a delete carrying only { id } and the table, removes the device copy of that log, and sends the id only', async () => {
    deviceLogs = new Set(['l1', 'l2'])
    server.set('v2_set_logs:l1', { id: 'l1' })

    await queueSetLogDelete({ id: 'l1', sessionId: 's1' })

    expect(queue).toEqual([
      { id: 1, table: 'v2_set_logs', operation: 'delete', payload: { id: 'l1' }, createdAt: '2026-10-11T09:00:00.000Z', sessionId: 's1' },
    ])
    expect([...deviceLogs]).toEqual(['l2'])

    await flushSyncQueue() // the fake throws on any filter but the id

    expect(requests).toEqual(['delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
  })

  it('stages first, the head last, each stage naming its head: replayed in that order', async () => {
    for (const id of ['h1', 'st1', 'st2']) {
      deviceLogs.add(id)
      server.set(`v2_set_logs:${id}`, id === 'h1' ? { id } : { id, parent_set_id: 'h1' })
    }

    await queueSetLogDelete({ id: 'st2', sessionId: 's1', parentSetId: 'h1' })
    await queueSetLogDelete({ id: 'st1', sessionId: 's1', parentSetId: 'h1' })
    await queueSetLogDelete({ id: 'h1', sessionId: 's1' })

    expect(queue.map((q) => [q.payload.id, q.parentSetId])).toEqual([['st2', 'h1'], ['st1', 'h1'], ['h1', undefined]])
    expect(deviceLogs.size).toBe(0)

    await flushSyncQueue()

    expect(requests).toEqual(['delete v2_set_logs:st2', 'delete v2_set_logs:st1', 'delete v2_set_logs:h1'])
    expect(server.size).toBe(0)
  })

  it('a log logged offline and deleted before it was ever sent never reaches the server', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    deviceLogs.add('l1')

    await queueSetLogDelete({ id: 'l1', sessionId: 's1' })
    await flushSyncQueue()

    expect(requests).toEqual([])
    expect(queue).toEqual([])
    expect(deviceLogs.size).toBe(0)
  })
})
