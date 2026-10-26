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
//
// What the fakes below are built to tell apart (chunk 57's first review found
// both proofs missing; both are rules in RULES.md, Verification and process):
// - A delete waits behind an earlier write to its own row. With nothing failing
//   the queue replays in createdAt order whatever the dependency keys say, so
//   that rule is proven with the earlier write failing in the pass that would
//   send the delete ("a delete waits behind an earlier write to its own row").
// - A write that must land before a request goes out is awaited. The fake's
//   IndexedDB writes land on a later tick, as a real transaction's commit does:
//   a fake that applied a write before its first await could not tell
//   `await db.sync_queue.update(…)` from `void db.sync_queue.update(…)`. The
//   server can also hold an upsert's reply (a request in flight) or lose it, and
//   a page that dies mid-request leaves IndexedDB as it was when the request left.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

interface QueueItem {
  id: number
  table: string
  operation: 'upsert' | 'delete' | 'patch'
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
// The upserts, by tag, the server refused on a foreign key: a stage whose head it doesn't hold, a change row whose log it doesn't hold (DECISIONS 227).
let refused: string[] = []
// Whether the queue said `sendStarted` for an upsert at the moment its request
// arrived, by tag.
let startedWhenSent = new Map<string, boolean>()
// The queue as IndexedDB held it the instant an upsert's request left the
// phone, by tag: all a page that dies mid-request leaves behind.
let queueWhenSent = new Map<string, QueueItem[]>()
// The device's own copies of logs (Dexie `set_logs`), by id.
let deviceLogs = new Set<string>()
// Chunk 61's review 1 (F1): the heads whose stage kind was cleared while a drop log still stood under them. DECISIONS 147 (a) makes a head with no drop
// a normal set; a normal head with a drop log under it is the state a patch sent ahead of its drop's delete would leave on the server until the retry.
let normalHeadWithDrop: string[] = []
// The upsert tags whose reply never comes back: the row reaches the server, the
// client sees an error.
let lostReplies = new Set<string>()
// The next upsert to reach the server is held in flight (its row is on the
// server, its reply is not back) until `released` settles.
let heldReply: { arrive: () => void; released: Promise<void> } | null = null
let releaseHeldReply: (() => void) | null = null
// The device's own database failing a write (`queue.add`, `queue.update`,
// `queue.delete`): how many of that kind still succeed before the one that throws.
let writesUntilFailure = new Map<string, number>()

// A real IndexedDB transaction commits on a later tick, so every write below
// lands on one: a write the code does not wait for is not there yet when the
// next line runs.
const ioTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
function writeFails(kind: string): boolean {
  const left = writesUntilFailure.get(kind)
  if (left === undefined) return false
  if (left > 0) {
    writesUntilFailure.set(kind, left - 1)
    return false
  }
  writesUntilFailure.delete(kind)
  return true
}

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({
        toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
      }),
      toArray: async () => [...queue],
      add: async (item: Omit<QueueItem, 'id'>) => {
        await ioTick()
        if (writeFails('queue.add')) throw new Error('QuotaExceededError')
        queue.push({ ...item, id: nextId++ })
      },
      delete: async (id: number) => {
        await ioTick()
        if (writeFails('queue.delete')) throw new Error('UnknownError')
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        await ioTick()
        if (writeFails('queue.update')) throw new Error('UnknownError')
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
      bulkUpdate: async () => {},
    },
    set_logs: {
      delete: async (id: string) => {
        await ioTick()
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
        queueWhenSent.set(tag, queue.map((q) => ({ ...q })))
        startedWhenSent.set(tag, queue.find((q) => q.payload.tag === tag)?.sendStarted === true)
        const left = failures.get(tag) ?? 0
        if (left > 0) {
          failures.set(tag, left - 1)
          return { error: { message: 'Failed to fetch' } }
        }
        // The foreign key: a stage's head must already be there.
        const head = payload.parent_set_id as string | undefined
        if (head && !server.has(`${table}:${head}`)) {
          refused.push(tag)
          return { error: { message: 'violates foreign key constraint', code: '23503' } }
        }
        // 042: a change row's `set_log_id` references v2_set_logs(id) ON DELETE CASCADE, so a row that names a log the server doesn't hold is refused.
        const named = payload.set_log_id as string | undefined
        if (table === 'v2_session_set_changes' && named && !server.has(`v2_set_logs:${named}`)) {
          refused.push(tag)
          return { error: { message: 'v2_session_set_changes_set_log_id_fkey', code: '23503' } }
        }
        sent.push(tag)
        requests.push(`upsert ${tag}`)
        server.set(`${table}:${payload.id}`, payload)
        // In flight: the request is on the server and the reply is held back.
        if (heldReply) {
          const { arrive, released } = heldReply
          heldReply = null
          arrive()
          await released
        }
        // The reply never comes back, though the row is on the server.
        if (lostReplies.delete(tag)) return { error: { message: 'Failed to fetch' } }
        return { error: null }
      },
      // `update(patch).eq('id', id)`: a queued patch. The rows matching are changed; none matching is no error.
      update: (patch: Record<string, unknown>) => ({
        eq: async (column: string, value: string) => {
          if (column !== 'id') throw new Error(`a queued patch filters on id only, not ${column}`)
          const left = failures.get(`patch:${value}`) ?? 0
          if (left > 0) {
            failures.set(`patch:${value}`, left - 1)
            return { error: { message: 'Failed to fetch' } }
          }
          requests.push(`patch ${table}:${value} ${JSON.stringify(patch)}`)
          const row = server.get(`${table}:${value}`)
          if (row) {
            server.set(`${table}:${value}`, { ...row, ...patch })
            if (patch.stage_kind === null && [...server.values()].some((other) => other.parent_set_id === value)) normalHeadWithDrop.push(value)
          }
          return { error: null }
        },
      }),
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
          // 042: a log takes the change rows that name it with it.
          if (table === 'v2_set_logs') {
            for (const [key, row] of [...server]) {
              if (key.startsWith('v2_session_set_changes:') && row.set_log_id === value) server.delete(key)
            }
          }
          return { error: null }
        },
      }),
    }),
  },
}))
vi.mock('../../lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { flushSyncQueue, retrySyncFailures, hasQueuedWritesFor, queueSetLogDelete, dropQueuedWritesNamingLog, MAX_SYNC_ATTEMPTS } = await import('./useSyncQueue')
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
// A patch item as `queueSetLogPatch` / `queueSetLogStageKindClear` queue it: the payload is { id } and one column, the session beside it.
function enqueuePatch(table: string, payload: Record<string, unknown>, extra: Partial<QueueItem> = {}) {
  const n = nextId++
  queue.push({ id: n, table, operation: 'patch', payload, createdAt: stamp(n), ...extra })
}
// A queued upsert of a `pending_stages` change row, as `queueSetChange` queues it: it names its session and the log (`set_log_id`).
const enqueueRow = (rowId: string, logId: string, tag: string, extra: Partial<QueueItem> = {}, session = 's1') =>
  enqueue('v2_session_set_changes', { id: rowId, session_id: session, kind: 'pending_stages', set_log_id: logId, tag }, extra)
const setEdit = (tag: string, weight: number, extra: Record<string, unknown> = {}) =>
  enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight, tag, ...extra })

// Holds the next upsert that reaches the server in flight: `arrived` settles when
// its request is on the server, and its reply comes back only after `release()`.
function holdNextReply() {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  releaseHeldReply = release
  const arrived = new Promise<void>((arrive) => {
    heldReply = { arrive, released }
  })
  return { arrived, release }
}

beforeEach(() => {
  queue = []
  server = new Map()
  failures = new Map()
  sent = []
  requests = []
  refused = []
  startedWhenSent = new Map()
  queueWhenSent = new Map()
  deviceLogs = new Set()
  normalHeadWithDrop = []
  lostReplies = new Set()
  heldReply = null
  releaseHeldReply = null
  writesUntilFailure = new Map()
  nextId = 1
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
})

afterEach(() => {
  // A test that failed while a request was held must not leave the pass (and the
  // lock around it) stuck for the tests after it.
  releaseHeldReply?.()
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

  // The session's own write is fine here, so only the head can hold the stage back
  // (in the test above the session's failure holds it too).
  it('a head whose own write failed holds back its stages: held, not tried', async () => {
    enqueue('v2_set_logs', { id: 'h1', session_id: 's1', tag: 'head' })
    enqueue('v2_set_logs', { id: 'st1', session_id: 's1', parent_set_id: 'h1', tag: 'stage' })
    failures.set('head', 1)

    await flushSyncQueue()
    expect(queue.map((q) => [q.payload.tag, q.attempts])).toEqual([['head', 1], ['stage', undefined]]) // no attempt recorded for the stage

    await flushSyncQueue()
    expect(sent).toEqual(['head', 'stage'])
    expect(queue).toEqual([])
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

  // The pair's two queue rows go one at a time, the upsert first. A pass that dies
  // between them (the database fails, the page is killed) must leave the pair or
  // the delete alone, never the upsert alone: its delete would be gone, and the
  // next pass would send it, creating the row the user deleted.
  it.each([
    [0, ['upsert', 'delete']],
    [1, ['delete']],
  ])('a pass that dies after removing %i of a cancelled pair’s two items leaves no ghost row', async (removed, left) => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    writesUntilFailure.set('queue.delete', removed) // the database fails on the next removal after `removed` of them

    await flushSyncQueue().catch(() => {}) // the pass dies half way, before anything is sent
    expect(requests).toEqual([])
    expect(queue.map((q) => q.operation)).toEqual(left)

    await flushSyncQueue() // the next pass

    expect(server.has('v2_set_logs:l1')).toBe(false) // no ghost row
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

    // The fake's write lands on a later tick (`ioTick`), so the queue says so when
    // the request arrives only if the code waited for the write: `void` for
    // `await` fails here.
    expect(startedWhenSent.get('first')).toBe(true)
    expect(queue[0].sendStarted).toBe(true)
  })

  it('an upsert whose marker cannot be written is not sent: it counts as a failed attempt and goes on the next pass', async () => {
    setEdit('first', 100)
    writesUntilFailure.set('queue.update', 0) // the marker write fails

    await flushSyncQueue()

    expect(requests).toEqual([]) // the request waits for the marker
    expect(queue.map((q) => [q.attempts, q.sendStarted])).toEqual([[1, undefined]])

    await flushSyncQueue()

    expect(requests).toEqual(['upsert first'])
    expect(startedWhenSent.get('first')).toBe(true)
    expect(queue).toEqual([])
  })

  it('a write that gave up under an older build counts as sent after a retry: its delete goes after it', async () => {
    // Given up before this build existed: attempts at the limit, gaveUp, no sendStarted.
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, { attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await retrySyncFailures()

    expect(requests).toEqual(['upsert log', 'delete v2_set_logs:l1'])
    expect(queue).toEqual([])
  })

  it('a retry marks as sent only the writes it resets: the never-sent pair of another row still cancels', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'stuck' }, { attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    enqueue('v2_set_logs', { id: 'l2', session_id: 's1', weight: 60, tag: 'never' })
    enqueueDelete('v2_set_logs', 'l2', { sessionId: 's1' })

    await retrySyncFailures()

    expect(requests).toEqual(['upsert stuck']) // l2 never left the device, and the retry did not send it
    expect(server.has('v2_set_logs:l2')).toBe(false)
    expect(queue).toEqual([])
  })
})

// With nothing failing the queue replays in createdAt order, so "the upsert, then
// its delete" holds whatever the dependency keys say. Every test here has the
// earlier write to the row failing, or held, in the pass that would send the
// delete: a delete that no longer waited behind it goes out first, deletes a row
// that isn't there yet, and the upsert's retry then creates it (a ghost row).
describe('flushSyncQueue — a delete waits behind an earlier write to its own row (G47)', () => {
  it.each([
    ['it failed once', { attempts: 1 }],
    ['its send started', { sendStarted: true }],
  ])('an upsert that may be on the server (%s) fails again in the pass that would send its delete: the delete is held, then goes after it', async (_why, marker) => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, marker)
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('log', 1)

    await flushSyncQueue() // the upsert fails; its delete must not go ahead of it
    expect(requests).toEqual([])
    expect(queue.map((q) => `${q.operation} ${q.payload.tag ?? q.payload.id}`)).toEqual(['upsert log', 'delete l1'])

    await flushSyncQueue() // the upsert goes, then the delete
    expect(requests).toEqual(['upsert log', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false) // no ghost row
    expect(queue).toEqual([])
  })

  it('an upsert held back by its session’s failed write holds its delete too', async () => {
    enqueue('v2_sessions', { id: 's1', status: 'completed', tag: 'session' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, { attempts: 1 })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('session', 1)

    await flushSyncQueue() // the session fails; the log waits behind it, and its delete behind the log
    expect(requests).toEqual([])
    expect(queue).toHaveLength(3)

    await flushSyncQueue()
    expect(requests).toEqual(['upsert session', 'upsert log', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
    expect(queue).toEqual([])
  })

  it('an upsert that gave up holds its delete and is reported with it; retry sends the upsert, then the delete', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' }, { attempts: 1 })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('log', MAX_SYNC_ATTEMPTS - 1) // it failed once already: this many more failures and it gives up

    await flushSyncQueue()
    expect(useOfflineStore.getState().syncFailures).toEqual([]) // failed again, not given up yet: nothing is reported
    for (let i = 1; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()

    expect(queue[0].gaveUp).toBe(true)
    expect(requests).toEqual([]) // the delete never went ahead of it
    expect(useOfflineStore.getState().syncFailures).toEqual([
      { queueId: 1, table: 'v2_set_logs', recordId: 'l1', sessionId: 's1' },
      { queueId: 2, table: 'v2_set_logs', recordId: 'l1', sessionId: 's1' },
    ])

    await retrySyncFailures()

    expect(requests).toEqual(['upsert log', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
    expect(queue).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
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

  // A head with several stages waits for every one of them: the one whose delete
  // fails may be the first or the last that was queued.
  it.each([
    ['first', 'st2', 'st1'],
    ['second', 'st1', 'st2'],
  ])('with two stages, behind the %s one’s delete when that one fails (the other has gone)', async (_which, failing, other) => {
    server.set('v2_set_logs:st2', { id: 'st2', parent_set_id: 'h1' })
    enqueueDelete('v2_set_logs', 'st2', { sessionId: 's1', parentSetId: 'h1' })
    enqueueDelete('v2_set_logs', 'st1', { sessionId: 's1', parentSetId: 'h1' })
    enqueueDelete('v2_set_logs', 'h1', { sessionId: 's1' })
    failures.set(`del:${failing}`, 1)

    await flushSyncQueue()
    expect(requests).toEqual([`delete v2_set_logs:${other}`]) // the head did not go ahead of the stage that failed
    expect(queue.map((q) => q.payload.id)).toEqual([failing, 'h1'])

    await flushSyncQueue()
    expect(requests).toEqual([`delete v2_set_logs:${other}`, `delete v2_set_logs:${failing}`, 'delete v2_set_logs:h1'])
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

// Chunk 61's review 1 (F1; SPEC G47: delete set works offline; DECISIONS 147 (a): the last drop deleted makes the head a normal set). The head's log loses its
// stage kind through 58a's patch item, `{ id, stage_kind: null }`, queued after the drop's delete. Like a head's own delete, it must not go ahead of the
// writes to its drops: sent when the drop's delete failed in the pass, it would leave the server a normal head with a drop log under it until the retry
// (`normalHeadWithDrop`). With nothing failing the queue replays in `createdAt` order whatever the dependency keys say (RULES: "A queue's ordering rule is
// proven with the earlier write failing in the pass that would send the later one"), so every hold below fails the earlier write in the pass.
describe('flushSyncQueue — a head’s stage-kind patch waits for its drops (G47; 61’s review 1, F1)', () => {
  const kind = (id = 'h1', extra: Partial<QueueItem> = {}) => enqueuePatch('v2_set_logs', { id, stage_kind: null }, { sessionId: 's1', ...extra })
  beforeEach(() => {
    // A dropset head and its one drop are on the server already.
    server.set('v2_set_logs:h1', { id: 'h1', stage_kind: 'dropset', weight: 80 })
    server.set('v2_set_logs:d1', { id: 'd1', parent_set_id: 'h1' })
  })

  it('with nothing failing: the drop’s delete, then the head’s patch; the server ends with a normal head and no drop, and was never in between', async () => {
    enqueueDelete('v2_set_logs', 'd1', { sessionId: 's1', parentSetId: 'h1' })
    kind()
    await flushSyncQueue()
    expect(requests).toEqual(['delete v2_set_logs:d1', 'patch v2_set_logs:h1 {"stage_kind":null}'])
    expect(server.get('v2_set_logs:h1')).toEqual({ id: 'h1', stage_kind: null, weight: 80 })
    expect(server.has('v2_set_logs:d1')).toBe(false)
    expect(normalHeadWithDrop).toEqual([])
    expect(queue).toEqual([])
  })

  it('behind the drop’s delete when that delete fails in the pass that would send the patch: the patch is held, and the retry sends both in order', async () => {
    enqueueDelete('v2_set_logs', 'd1', { sessionId: 's1', parentSetId: 'h1' })
    kind()
    failures.set('del:d1', 1)

    await flushSyncQueue()
    expect(requests).toEqual([]) // the patch did not go ahead of the drop's delete
    expect(server.get('v2_set_logs:h1')).toMatchObject({ stage_kind: 'dropset' })
    expect(normalHeadWithDrop).toEqual([])
    expect(queue.map((q) => q.operation)).toEqual(['delete', 'patch'])

    await flushSyncQueue()
    expect(requests).toEqual(['delete v2_set_logs:d1', 'patch v2_set_logs:h1 {"stage_kind":null}'])
    expect(normalHeadWithDrop).toEqual([])
    expect(queue).toEqual([])
  })

  it.each([
    ['first', 'd2', 'd1'],
    ['second', 'd1', 'd2'],
  ])('with two drops deleted, behind the %s one’s delete when that one fails (the other has gone)', async (_which, failing, other) => {
    server.set('v2_set_logs:d2', { id: 'd2', parent_set_id: 'h1' })
    enqueueDelete('v2_set_logs', 'd2', { sessionId: 's1', parentSetId: 'h1' })
    enqueueDelete('v2_set_logs', 'd1', { sessionId: 's1', parentSetId: 'h1' })
    kind()
    failures.set(`del:${failing}`, 1)

    await flushSyncQueue()
    expect(requests).toEqual([`delete v2_set_logs:${other}`])
    expect(normalHeadWithDrop).toEqual([])

    await flushSyncQueue()
    expect(requests).toEqual([`delete v2_set_logs:${other}`, `delete v2_set_logs:${failing}`, 'patch v2_set_logs:h1 {"stage_kind":null}'])
    expect(normalHeadWithDrop).toEqual([])
    expect(queue).toEqual([])
  })

  it('behind a drop’s upsert that failed (the drop is still to be created under the head)', async () => {
    enqueue('v2_set_logs', { id: 'd2', session_id: 's1', parent_set_id: 'h1', tag: 'drop' }, { attempts: 1 })
    kind()
    failures.set('drop', 1)

    await flushSyncQueue()
    expect(requests).toEqual([])
    expect(queue).toHaveLength(2)

    await flushSyncQueue()
    expect(requests).toEqual(['upsert drop', 'patch v2_set_logs:h1 {"stage_kind":null}'])
  })

  it('and is reported with a drop delete that gave up, both under their session; retry sends them in order', async () => {
    enqueueDelete('v2_set_logs', 'd1', { sessionId: 's1', parentSetId: 'h1' })
    kind()
    failures.set('del:d1', MAX_SYNC_ATTEMPTS)

    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()

    expect(requests).toEqual([])
    expect(useOfflineStore.getState().syncFailures.map((f) => [f.recordId, f.sessionId])).toEqual([['d1', 's1'], ['h1', 's1']])

    await retrySyncFailures()

    expect(requests).toEqual(['delete v2_set_logs:d1', 'patch v2_set_logs:h1 {"stage_kind":null}'])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(queue).toEqual([])
  })

  it('but not behind the failed delete of a drop of another head', async () => {
    server.set('v2_set_logs:h9', { id: 'h9', stage_kind: 'dropset' })
    server.set('v2_set_logs:d9', { id: 'd9', parent_set_id: 'h9' })
    enqueueDelete('v2_set_logs', 'd9', { sessionId: 's1', parentSetId: 'h9' })
    kind('h1')
    failures.set('del:d9', 1)

    await flushSyncQueue()

    expect(requests).toEqual(['patch v2_set_logs:h1 {"stage_kind":null}'])
    expect(queue.map((q) => q.payload.id)).toEqual(['d9'])
  })

  it('behind the head’s own earlier write, too: an upsert of the head that fails in the pass holds the patch (a patch first would match no row, and the upsert would then leave the kind)', async () => {
    server.delete('v2_set_logs:h1')
    server.delete('v2_set_logs:d1')
    enqueue('v2_set_logs', { id: 'h1', session_id: 's1', stage_kind: 'dropset', tag: 'head' })
    kind()
    failures.set('head', 1)

    await flushSyncQueue()
    expect(requests).toEqual([])

    await flushSyncQueue()
    expect(requests).toEqual(['upsert head', 'patch v2_set_logs:h1 {"stage_kind":null}'])
    expect(server.get('v2_set_logs:h1')).toMatchObject({ stage_kind: null })
  })

  // The control for "the hold is the stage-kind patch's alone": a head's number patch (58a's shape) is a different column and has never waited for its drops.
  it('a head’s number patch is not held behind its drops’ failed delete', async () => {
    enqueueDelete('v2_set_logs', 'd1', { sessionId: 's1', parentSetId: 'h1' })
    enqueuePatch('v2_set_logs', { id: 'h1', set_number: 2 }, { sessionId: 's1' })
    failures.set('del:d1', 1)

    await flushSyncQueue()

    expect(requests).toEqual(['patch v2_set_logs:h1 {"set_number":2}'])
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

    expect(queue).toStrictEqual([
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

  it('the delete is queued before the device copy goes: if the queue write fails the copy stays (a stale copy, never a delete that was lost)', async () => {
    deviceLogs = new Set(['l1'])
    writesUntilFailure.set('queue.add', 0) // the next queue write fails

    await expect(queueSetLogDelete({ id: 'l1', sessionId: 's1' })).rejects.toThrow('QuotaExceededError')

    expect(queue).toEqual([])
    expect([...deviceLogs]).toEqual(['l1'])
  })
})

// A delete queued while its upsert's request is out (a slow send, and the user
// deletes the set they have just logged): the pass that sent the upsert decided
// what to cancel before the request left, and only a pass sends, so the delete is
// never cancelled against a request already out. It goes after it, and the row
// ends absent whether the reply comes back or is lost.
describe('flushSyncQueue — a delete queued while its upsert is in flight (G47)', () => {
  beforeEach(() => {
    // Queue stamps are the time of the call; the other items here are 08:00.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T09:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['the reply comes back', false, ['upsert log', 'delete v2_set_logs:l1']],
    ['the reply is lost (the row is on the server, the client sees an error)', true, ['upsert log', 'upsert log', 'delete v2_set_logs:l1']],
  ])('%s: the delete is sent after the upsert, and the row ends absent', async (_why, lose, expected) => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    if (lose) lostReplies.add('log')
    const { arrived, release } = holdNextReply()

    const pass = flushSyncQueue()
    try {
      await arrived // the request is on the server; its reply is not back
      expect(server.has('v2_set_logs:l1')).toBe(true)
      expect(startedWhenSent.get('log')).toBe(true) // the queue already said so when the request left
      await queueSetLogDelete({ id: 'l1', sessionId: 's1' }) // the user deletes the set meanwhile
      flushSyncQueue() // shares the running pass and asks for one more once it ends
    } finally {
      release()
      await pass // however the test went, the pass ends before the next test starts
    }

    expect(requests).toEqual(expected)
    expect(server.has('v2_set_logs:l1')).toBe(false) // no ghost row
    expect(queue).toEqual([])
  })

  // A pair is cancelled only at the start of a pass, from the queue that pass reads.
  // Cancelled when the delete is queued instead, a pass already running would still
  // hold the upsert in its snapshot and send it, with the delete gone: a ghost row.
  it('queued while the pass is busy with another row: the pass sends the upsert it already holds, then the next pass the delete', async () => {
    enqueue('v2_set_logs', { id: 'l2', session_id: 's1', weight: 60, tag: 'other' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    const { arrived, release } = holdNextReply() // the first request, l2's, is held in flight

    const pass = flushSyncQueue()
    try {
      await arrived // the pass has read the queue: l2's upsert is out, l1's waits in its snapshot
      await queueSetLogDelete({ id: 'l1', sessionId: 's1' }) // the user deletes the set l1 meanwhile
      flushSyncQueue() // one more pass once this one ends
    } finally {
      release()
      await pass
    }

    expect(requests).toEqual(['upsert other', 'upsert log', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false) // no ghost row
    expect(queue).toEqual([])
  })

  it('the page dies while the request is out: a delete queued after the reload goes after the upsert, and the row ends absent', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log' })
    lostReplies.add('log')

    await flushSyncQueue() // the request reaches the server; the page dies before it hears back
    expect(server.has('v2_set_logs:l1')).toBe(true)
    // A dead page writes nothing more: IndexedDB holds what it held when the
    // request left. (The control is the page dying before it leaves: "a delete
    // whose upsert never left the device sends nothing".)
    queue = queueWhenSent.get('log')!

    await queueSetLogDelete({ id: 'l1', sessionId: 's1' }) // after the reload the user deletes the set
    await flushSyncQueue()

    expect(requests).toEqual(['upsert log', 'upsert log', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false) // no ghost row
    expect(queue).toEqual([])
  })
})

// DECISIONS 227 (queue-fix-227). A change row that names a log (`pending_stages`: `set_log_id`, 042's foreign key, ON DELETE CASCADE) hangs under that log as a stage hangs
// under its head. The fake above refuses a row whose log it doesn't hold (`refused`) and cascades a log's delete to the rows that name it, so an order or a cancel that
// would leave a row refused for ever on the real server fails here. Three rules: (i) a log's never-sent pair cancels with the rows that name it; (ii) a log's delete waits
// behind the writes to its rows, and a row behind the writes to its log; (iii) an online delete of a log drops the rows still queued for it. And the other half of each,
// which Adam made the condition of the fix ("never drop or block a user's other queued writes"): every test that cancels, holds or drops one log's rows has another log's,
// another session's and the session's own writes in the same queue and says they went.
describe('flushSyncQueue — a log’s never-sent pair cancels with the change rows that name it (227 (i))', () => {
  it('the log, its row and its delete leave the queue: nothing is sent, nothing is refused, no notice', async () => {
    useOfflineStore.getState().addPending('l1')
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' })
    enqueueRow('r1', 'l1', 'row1')
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await flushSyncQueue()

    expect(requests).toEqual([])
    expect(refused).toEqual([])
    expect(queue).toEqual([])
    expect(server.size).toBe(0)
    expect(useOfflineStore.getState().pendingIds.has('l1')).toBe(false)
    expect(useOfflineStore.getState().syncFailures).toEqual([])
  })

  it('only the rows that name that log: another log’s row, another session’s log and row, a `retyped` row and the session’s finish go in the same pass', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' })
    enqueueRow('r1', 'l1', 'row1')
    enqueue('v2_set_logs', { id: 'l2', session_id: 's1', weight: 60, tag: 'log2' })
    enqueueRow('r2', 'l2', 'row2')
    enqueue('v2_set_logs', { id: 'l3', session_id: 's2', weight: 40, tag: 'log3' })
    enqueueRow('r3', 'l3', 'row3', {}, 's2')
    enqueue('v2_session_set_changes', { id: 'r4', session_id: 's1', kind: 'retyped', week_plan_set_id: 'p1', set_log_id: null, tag: 'retyped' })
    enqueue('v2_sessions', { id: 's1', status: 'completed', tag: 'finish' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await flushSyncQueue()

    expect(requests).toEqual(['upsert log2', 'upsert row2', 'upsert log3', 'upsert row3', 'upsert retyped', 'upsert finish'])
    expect(refused).toEqual([])
    expect(queue).toEqual([])
    expect([...server.keys()].sort()).toEqual(
      ['v2_session_set_changes:r2', 'v2_session_set_changes:r3', 'v2_session_set_changes:r4', 'v2_sessions:s1', 'v2_set_logs:l2', 'v2_set_logs:l3'],
    )
  })

  it.each([
    ['it failed in an earlier pass', { attempts: 2 }],
    ['its send started', { sendStarted: true }],
  ])('a row that was tried (%s) still leaves with the log it names: the server never held the log, so it never held the row', async (_why, marker) => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' })
    enqueueRow('r1', 'l1', 'row1', marker)
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await flushSyncQueue()

    expect(requests).toEqual([])
    expect(refused).toEqual([])
    expect(queue).toEqual([])
  })

  it('a log that may be on the server (it failed once) keeps its row and its delete: sent in order, and the cascade takes the row', async () => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' }, { attempts: 1 })
    enqueueRow('r1', 'l1', 'row1')
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })

    await flushSyncQueue()

    expect(requests).toEqual(['upsert log1', 'upsert row1', 'delete v2_set_logs:l1'])
    expect(refused).toEqual([])
    expect(server.size).toBe(0)
    expect(queue).toEqual([])
  })

  // The three queue rows go one at a time. A pass that dies between them (the database fails, the page is killed) must leave what the next pass can still cancel or
  // send harmlessly: never the row alone with its log's upsert gone (the next pass would send it, refused for ever), and never the log's upsert without its delete.
  it.each([
    [0, ['upsert v2_set_logs', 'upsert v2_session_set_changes', 'delete v2_set_logs']],
    [1, ['upsert v2_set_logs', 'delete v2_set_logs']],
    [2, ['delete v2_set_logs']],
  ])('a pass that dies after removing %i of a cancelled log’s three items leaves no row refused for ever', async (removed, left) => {
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' })
    enqueueRow('r1', 'l1', 'row1')
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    writesUntilFailure.set('queue.delete', removed) // the database fails on the next removal after `removed` of them

    await flushSyncQueue().catch(() => {}) // the pass dies half way, before anything is sent
    expect(requests).toEqual([])
    expect(queue.map((q) => `${q.operation} ${q.table}`)).toEqual(left)

    await flushSyncQueue() // the next pass

    expect(refused).toEqual([])
    expect(server.size).toBe(0)
    expect(queue).toEqual([])
  })
})

describe('flushSyncQueue — a log’s delete waits behind the change rows that name it, and a row behind its log (227 (ii))', () => {
  beforeEach(() => {
    // The log is on the server already.
    server.set('v2_set_logs:l1', { id: 'l1' })
  })

  it('the delete waits behind the row: the row fails in the pass that would send the delete; the next pass sends the row, then the delete', async () => {
    enqueueRow('r1', 'l1', 'row1')
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('row1', 1)

    await flushSyncQueue()
    expect(requests).toEqual([]) // the delete did not go ahead of the row
    expect(queue).toHaveLength(2)

    await flushSyncQueue()
    expect(requests).toEqual(['upsert row1', 'delete v2_set_logs:l1'])
    expect(refused).toEqual([])
    expect(server.size).toBe(0) // the delete took the row
    expect(queue).toEqual([])
  })

  it('but not behind the failed row of another log: its own delete, its own row, another session’s log and the finish go in the same pass', async () => {
    server.set('v2_set_logs:l2', { id: 'l2' })
    server.set('v2_set_logs:l9', { id: 'l9' })
    enqueueRow('r9', 'l9', 'row9')
    enqueueDelete('v2_set_logs', 'l9', { sessionId: 's1' })
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    enqueueRow('r2', 'l2', 'row2')
    enqueue('v2_set_logs', { id: 'l4', session_id: 's2', weight: 50, tag: 'log4' })
    enqueue('v2_sessions', { id: 's1', status: 'completed', tag: 'finish' })
    failures.set('row9', 1)

    await flushSyncQueue()

    expect(requests).toEqual(['delete v2_set_logs:l1', 'upsert row2', 'upsert log4', 'upsert finish'])
    expect(queue.map((q) => q.payload.id)).toEqual(['r9', 'l9']) // the failed row, and the one delete that waits for it
  })

  it('a head’s stage-kind patch is not held behind a failed row that names it: only a delete waits for rows', async () => {
    enqueueRow('r1', 'l1', 'row1')
    enqueuePatch('v2_set_logs', { id: 'l1', stage_kind: null }, { sessionId: 's1' })
    failures.set('row1', 1)

    await flushSyncQueue()

    expect(requests).toEqual(['patch v2_set_logs:l1 {"stage_kind":null}'])
    expect(queue.map((q) => q.payload.id)).toEqual(['r1'])
  })

  it('a row waits behind its log’s upsert: held, not tried, while that upsert fails; then the log, then the row. Another log’s pair goes through', async () => {
    server.delete('v2_set_logs:l1')
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' }, { attempts: 1 })
    enqueueRow('r1', 'l1', 'row1')
    enqueue('v2_set_logs', { id: 'l2', session_id: 's1', weight: 60, tag: 'log2' })
    enqueueRow('r2', 'l2', 'row2')
    failures.set('log1', 1)

    await flushSyncQueue()
    expect(requests).toEqual(['upsert log2', 'upsert row2'])
    expect(queueWhenSent.has('row1')).toBe(false) // never tried, so never refused
    expect(refused).toEqual([])
    expect(queue.find((q) => q.payload.id === 'r1')?.attempts).toBeUndefined()

    await flushSyncQueue()
    expect(requests).toEqual(['upsert log2', 'upsert row2', 'upsert log1', 'upsert row1'])
    expect(refused).toEqual([])
    expect(queue).toEqual([])
  })

  it('and is reported with a log upsert that gave up, both under their session; retry sends them in order', async () => {
    server.delete('v2_set_logs:l1')
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' })
    enqueueRow('r1', 'l1', 'row1')
    failures.set('log1', MAX_SYNC_ATTEMPTS)

    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()

    expect(requests).toEqual([])
    expect(refused).toEqual([])
    expect(useOfflineStore.getState().syncFailures.map((f) => [f.recordId, f.sessionId])).toEqual([['l1', 's1'], ['r1', 's1']])

    await retrySyncFailures()

    expect(requests).toEqual(['upsert log1', 'upsert row1'])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(queue).toEqual([])
  })

  it('and a delete is reported with a row that gave up, both under their session; retry sends the row, then the delete', async () => {
    enqueueRow('r1', 'l1', 'row1')
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    failures.set('row1', MAX_SYNC_ATTEMPTS)

    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()

    expect(requests).toEqual([])
    expect(useOfflineStore.getState().syncFailures.map((f) => [f.recordId, f.sessionId])).toEqual([['r1', 's1'], ['l1', 's1']])

    await retrySyncFailures()

    expect(requests).toEqual(['upsert row1', 'delete v2_set_logs:l1'])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(queue).toEqual([])
  })
})

describe('dropQueuedWritesNamingLog — an online delete of a log drops the change rows still queued for it (227 (iii))', () => {
  it('drops the upserts of the rows that name the log, and nothing else', async () => {
    useOfflineStore.getState().addPending('r1')
    enqueueRow('r1', 'l1', 'row1', { attempts: 1 })
    enqueueRow('r1', 'l1', 'row1b') // a second queued write of the same row
    enqueueRow('r2', 'l2', 'row2') // another log of the same session
    enqueueRow('r3', 'l3', 'row3', {}, 's2') // another session
    enqueue('v2_session_set_changes', { id: 'r4', session_id: 's1', kind: 'retyped', week_plan_set_id: 'p1', set_log_id: null, tag: 'retyped' })
    enqueue('v2_set_logs', { id: 'l1', session_id: 's1', weight: 100, tag: 'log1' }) // the log's own upsert is not a row that names it
    enqueue('v2_set_logs', { id: 'l5', session_id: 's1', parent_set_id: 'l1', weight: 80, tag: 'stage' }) // nor is a stage under it (a log write)
    enqueue('v2_sessions', { id: 's1', status: 'completed', tag: 'finish' })

    expect(await dropQueuedWritesNamingLog('l1')).toBe(2)

    expect(queue.map((q) => q.payload.tag)).toEqual(['row2', 'row3', 'retyped', 'log1', 'stage', 'finish'])
    expect(useOfflineStore.getState().pendingIds.has('r1')).toBe(false)
  })

  it('a delete or a patch of a log, queued, is not a row that names it', async () => {
    enqueueDelete('v2_set_logs', 'l1', { sessionId: 's1' })
    enqueuePatch('v2_set_logs', { id: 'l1', set_number: 2 }, { sessionId: 's1' })
    enqueueRow('r1', 'l1', 'row1')

    expect(await dropQueuedWritesNamingLog('l1')).toBe(1)

    expect(queue.map((q) => q.operation)).toEqual(['delete', 'patch'])
  })

  it('names nothing: the queue is left as it was', async () => {
    enqueueRow('r2', 'l2', 'row2')
    enqueue('v2_sessions', { id: 's1', status: 'completed', tag: 'finish' })

    expect(await dropQueuedWritesNamingLog('l1')).toBe(0)

    expect(queue.map((q) => q.payload.tag)).toEqual(['row2', 'finish'])
  })

  it('the “couldn’t sync” notice is made again from what is left: a row that had given up is gone from it, another log’s stays', async () => {
    enqueueRow('r1', 'l1', 'row1')
    enqueueRow('r2', 'l2', 'row2')
    failures.set('row1', MAX_SYNC_ATTEMPTS)
    failures.set('row2', MAX_SYNC_ATTEMPTS)
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()
    expect(useOfflineStore.getState().syncFailures.map((f) => f.recordId)).toEqual(['r1', 'r2'])

    await dropQueuedWritesNamingLog('l1')

    expect(useOfflineStore.getState().syncFailures.map((f) => f.recordId)).toEqual(['r2'])
    expect(useOfflineStore.getState().failedIds.has('r1')).toBe(false)
  })

  it('a write to the queue that fails is thrown (the caller decides what a failed cleanup means), after the rows it had removed are gone', async () => {
    enqueueRow('r1', 'l1', 'row1')
    enqueueRow('r1', 'l1', 'row1b')
    writesUntilFailure.set('queue.delete', 1)

    await expect(dropQueuedWritesNamingLog('l1')).rejects.toThrow('UnknownError')

    expect(queue.map((q) => q.payload.tag)).toEqual(['row1b'])
  })
})
