// Chunk 58a (DECISIONS 197, Adam 2026-10-20): "First check whether the existing whole-row save can carry the set-number correction offline;
// if so, use it. Add a 'patch' queue item only if a whole-row save could overwrite something it shouldn't."
//
// The check, executed on the fake server below (which keeps PostgREST's upsert semantics: the columns the payload names are written, a
// row that isn't there is inserted):
// - a whole-row save of the corrected log brings back a log another phone deleted (a ghost row, as chunk 57's E04), and writes this
//   phone's cached weight over another phone's edit of it ("a whole-row save could overwrite something it shouldn't");
// - the patch item, `update({ set_number }).eq('id', id)`, does neither: it matches no row when the log is gone, and it names no column
//   but the number.
// Then the queue's rules for the new item, on a fake that models the server and the device's database as chunk 57's order tests do
// (RULES.md, "The sync queue's tests run on a fake that models the server"): it replays after the earlier writes to its log, also
// when the upsert fails in the pass that would send it; a log whose delete is queued is never recreated by it; a failed patch is
// kept, counted and retried; the finish and the "couldn't sync" notice see it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends

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
// The server: one row per `table:id`.
let server = new Map<string, Record<string, unknown>>()
// How many more times a request fails: an upsert by its payload tag (`tag`), a patch as `patch:<id>`.
let failures = new Map<string, number>()
// Every request that reached the server, in order.
let requests: string[] = []
// The `update(...)` arguments of every patch request, exactly as the client sent them.
let updateCalls: Array<{ patch: Record<string, unknown>; column: string; value: unknown }> = []
// The device's own copies of logs (Dexie `set_logs`), by id.
let deviceLogs = new Map<string, Record<string, unknown>>()
// The device's database failing a write: how many of that kind still succeed before the one that throws.
let writesUntilFailure = new Map<string, number>()

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
      orderBy: () => ({ toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id) }),
      toArray: async () => queue.map((q) => ({ ...q })),
      add: async (item: Omit<QueueItem, 'id'>) => {
        await ioTick()
        if (writeFails('queue.add')) throw new Error('QuotaExceededError')
        queue.push({ ...item, id: nextId++ })
      },
      delete: async (id: number) => {
        await ioTick()
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        await ioTick()
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
    },
    set_logs: {
      delete: async (id: string) => {
        await ioTick()
        deviceLogs.delete(id)
      },
      update: async (id: string, changes: Record<string, unknown>) => {
        await ioTick()
        if (writeFails('set_logs.update')) throw new Error('UnknownError')
        const row = deviceLogs.get(id)
        if (row) deviceLogs.set(id, { ...row, ...changes })
        return row ? 1 : 0
      },
    },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      // PostgREST's upsert: an insert, or on a conflicting id the columns the payload names are written, no others.
      upsert: async (payload: Record<string, unknown>) => {
        const tag = payload.tag as string
        const left = failures.get(tag) ?? 0
        if (left > 0) {
          failures.set(tag, left - 1)
          return { error: { message: 'Failed to fetch' } }
        }
        requests.push(`upsert ${tag}`)
        const key = `${table}:${payload.id}`
        server.set(key, { ...(server.get(key) ?? {}), ...payload })
        return { error: null }
      },
      // `update(patch).eq(column, value)`: the rows matching are changed; none matching is no error.
      update: (patch: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          updateCalls.push({ patch: { ...patch }, column, value })
          const id = String(value)
          const left = failures.get(`patch:${id}`) ?? 0
          if (left > 0) {
            failures.set(`patch:${id}`, left - 1)
            return { error: { message: 'Failed to fetch' } }
          }
          requests.push(`patch ${table}:${id}`)
          if (column === 'id' && server.has(`${table}:${id}`)) server.set(`${table}:${id}`, { ...server.get(`${table}:${id}`), ...patch })
          return { error: null }
        },
      }),
      delete: () => ({
        eq: async (column: string, value: string) => {
          if (column !== 'id') throw new Error(`a queued delete filters on id only, not ${column}`)
          requests.push(`delete ${table}:${value}`)
          server.delete(`${table}:${value}`)
          return { error: null }
        },
      }),
    }),
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

const { flushSyncQueue, retrySyncFailures, hasQueuedWritesFor, queueSetLogPatch, queueSetLogStageKindClear, MAX_SYNC_ATTEMPTS } = await import('./useSyncQueue')
const { useOfflineStore } = await import('./offlineStore')

const stamp = (n: number) => `2026-10-21T08:00:${String(n).padStart(2, '0')}Z`
function enqueue(item: Omit<QueueItem, 'id' | 'createdAt'>) {
  const n = nextId++
  queue.push({ ...item, id: n, createdAt: stamp(n) })
}
const upsertLog = (tag: string, row: Record<string, unknown>) => enqueue({ table: 'v2_set_logs', operation: 'upsert', payload: { id: 'l1', session_id: 's1', tag, ...row } })
const patchLog = (id: string, setNumber: number, extra: Partial<QueueItem> = {}) =>
  enqueue({ table: 'v2_set_logs', operation: 'patch', payload: { id, set_number: setNumber }, sessionId: 's1', ...extra })
// Chunk 61's review 1 (F1): the patch item's second shape, a head whose last drop was deleted loses its stage kind.
const patchKind = (id: string, extra: Partial<QueueItem> = {}) =>
  enqueue({ table: 'v2_set_logs', operation: 'patch', payload: { id, stage_kind: null }, sessionId: 's1', ...extra })

beforeEach(() => {
  queue = []
  server = new Map()
  failures = new Map()
  requests = []
  updateCalls = []
  deviceLogs = new Map()
  writesUntilFailure = new Map()
  nextId = 1
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
})

describe('DECISIONS 197: what a whole-row save of a corrected log would overwrite, and what the patch does not', () => {
  const logOnServer = { id: 'l1', session_id: 's1', exercise_id: 'e1', set_number: 5, weight: 80, reps: 8, rir: 2 }

  it('a whole-row save brings back a log another phone deleted (the ghost row); the patch matches no row and recreates nothing', async () => {
    // this phone's cached copy of the log, corrected 5 → 4; meanwhile the other phone deleted the log
    const cached = { ...logOnServer, set_number: 4, tag: 'whole-row' }
    server = new Map()
    upsertLog('whole-row', cached)
    await flushSyncQueue()
    expect(server.has('v2_set_logs:l1')).toBe(true) // the log the user deleted is back

    server = new Map()
    queue = []
    patchLog('l1', 4)
    await flushSyncQueue()
    expect(server.has('v2_set_logs:l1')).toBe(false) // the patch changed no row, and made none
    expect(requests[requests.length - 1]).toBe('patch v2_set_logs:l1')
  })

  it('a whole-row save writes this phone\'s cached weight over another phone\'s edit; the patch writes the number and leaves the weight', async () => {
    // this phone cached the log at weight 80; the other phone has since edited it to 85
    server = new Map([['v2_set_logs:l1', { ...logOnServer, weight: 85 }]])
    upsertLog('whole-row', { ...logOnServer, set_number: 4 })
    await flushSyncQueue()
    expect(server.get('v2_set_logs:l1')).toMatchObject({ set_number: 4, weight: 80 }) // the other phone's 85 is gone

    server = new Map([['v2_set_logs:l1', { ...logOnServer, weight: 85 }]])
    queue = []
    patchLog('l1', 4)
    await flushSyncQueue()
    expect(server.get('v2_set_logs:l1')).toMatchObject({ set_number: 4, weight: 85, reps: 8, rir: 2 })
  })
})

describe('the patch item on the queue', () => {
  it('is one request, `update({ set_number }).eq(\'id\', id)`, and writes no other column', async () => {
    server = new Map([['v2_set_logs:l1', { id: 'l1', set_number: 5, weight: 80 }]])
    patchLog('l1', 3)
    await flushSyncQueue()
    expect(updateCalls).toEqual([{ patch: { set_number: 3 }, column: 'id', value: 'l1' }])
    expect(server.get('v2_set_logs:l1')).toEqual({ id: 'l1', set_number: 3, weight: 80 })
    expect(queue).toEqual([])
  })

  it('refuses a patch that names anything but the number, and sends nothing', async () => {
    enqueue({ table: 'v2_set_logs', operation: 'patch', payload: { id: 'l1', set_number: 3, weight: 1 }, sessionId: 's1' })
    server = new Map([['v2_set_logs:l1', { id: 'l1', set_number: 5, weight: 80 }]])
    await flushSyncQueue()
    expect(requests).toEqual([])
    expect(updateCalls).toEqual([])
    expect(queue[0].attempts).toBe(1) // a failed attempt, kept
  })

  it('replays after the earlier write to its own log, in order: the upsert, then the number', async () => {
    upsertLog('created', { set_number: 5, weight: 80, reps: 8 })
    patchLog('l1', 4)
    await flushSyncQueue()
    expect(requests).toEqual(['upsert created', 'patch v2_set_logs:l1'])
    expect(server.get('v2_set_logs:l1')).toMatchObject({ set_number: 4, weight: 80 })
  })

  it('waits for its log\'s upsert when that upsert fails in the pass that would send it: the server ends on the patched number (a patch sent first would match no row and the old number would land after it)', async () => {
    upsertLog('created', { set_number: 5, weight: 80, reps: 8 })
    patchLog('l1', 4)
    failures.set('created', 1)
    await flushSyncQueue() // the upsert fails; the patch must not go ahead of it
    expect(requests).toEqual([])
    expect(queue.map((q) => q.operation)).toEqual(['upsert', 'patch'])
    await flushSyncQueue() // both go, in order
    expect(requests).toEqual(['upsert created', 'patch v2_set_logs:l1'])
    expect(server.get('v2_set_logs:l1')).toMatchObject({ set_number: 4 })
  })

  it('a patch to another log is not held back by a failed upsert of this one', async () => {
    upsertLog('created', { set_number: 5, weight: 80, reps: 8 })
    enqueue({ table: 'v2_set_logs', operation: 'patch', payload: { id: 'l2', set_number: 2 }, sessionId: 's1' })
    server = new Map([['v2_set_logs:l2', { id: 'l2', set_number: 3 }]])
    failures.set('created', 1)
    await flushSyncQueue()
    expect(requests).toEqual(['patch v2_set_logs:l2'])
  })

  it('a log whose delete is queued is never recreated by a patch before it: the pair goes in order and the server ends without the row', async () => {
    server = new Map([['v2_set_logs:l1', { id: 'l1', set_number: 5 }]])
    patchLog('l1', 4)
    enqueue({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'l1' }, sessionId: 's1' })
    await flushSyncQueue()
    expect(requests).toEqual(['patch v2_set_logs:l1', 'delete v2_set_logs:l1'])
    expect(server.has('v2_set_logs:l1')).toBe(false)
  })

  it('a log created and deleted before the phone reached the server leaves a server that never held it, with the patch between them sent in order', async () => {
    upsertLog('created', { set_number: 5, weight: 80, reps: 8 })
    patchLog('l1', 4)
    enqueue({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'l1' }, sessionId: 's1' })
    await flushSyncQueue()
    expect(server.has('v2_set_logs:l1')).toBe(false)
    expect(requests).toEqual(['upsert created', 'patch v2_set_logs:l1', 'delete v2_set_logs:l1'])
  })

  it('a failed patch stays queued with its attempt counted, is sent again on the next pass, and is dropped only once it is on the server', async () => {
    server = new Map([['v2_set_logs:l1', { id: 'l1', set_number: 5 }]])
    patchLog('l1', 4)
    failures.set('patch:l1', 1)
    await flushSyncQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].attempts).toBe(1)
    expect(server.get('v2_set_logs:l1')?.set_number).toBe(5)
    await flushSyncQueue()
    expect(queue).toEqual([])
    expect(server.get('v2_set_logs:l1')?.set_number).toBe(4)
  })

  it('after MAX_SYNC_ATTEMPTS failed passes it stops retrying, is reported to its session, and a retry sends it', async () => {
    server = new Map([['v2_set_logs:l1', { id: 'l1', set_number: 5 }]])
    patchLog('l1', 4)
    failures.set('patch:l1', MAX_SYNC_ATTEMPTS)
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()
    expect(queue[0]).toMatchObject({ attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    expect(useOfflineStore.getState().syncFailures).toEqual([{ queueId: queue[0].id, table: 'v2_set_logs', recordId: 'l1', sessionId: 's1' }])
    await retrySyncFailures()
    expect(queue).toEqual([])
    expect(server.get('v2_set_logs:l1')?.set_number).toBe(4)
  })

  it('the finish waits for it: hasQueuedWritesFor names the session while a patch of one of its logs is queued, and no other session', async () => {
    patchLog('l1', 4)
    expect(await hasQueuedWritesFor('s1')).toBe(true)
    expect(await hasQueuedWritesFor('s2')).toBe(false)
  })

  it('a head\'s delete waits behind a queued patch of one of its stages, as behind the stage\'s upsert (the client deletes the stages first)', async () => {
    server = new Map([
      ['v2_set_logs:h1', { id: 'h1', set_number: 5 }],
      ['v2_set_logs:st1', { id: 'st1', set_number: 5, parent_set_id: 'h1' }],
    ])
    patchLog('st1', 4, { parentSetId: 'h1' })
    enqueue({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'h1' }, sessionId: 's1' })
    failures.set('patch:st1', 1)
    await flushSyncQueue() // the stage's patch fails; the head's delete must wait
    expect(requests).toEqual([])
    expect(queue.map((q) => q.operation)).toEqual(['patch', 'delete'])
    await flushSyncQueue()
    expect(requests).toEqual(['patch v2_set_logs:st1', 'delete v2_set_logs:h1'])
  })
})

describe('queueSetLogPatch', () => {
  it('queues the item with the session beside it (a stage names its head too) and changes the device\'s own copy of the log', async () => {
    deviceLogs = new Map([['l1', { id: 'l1', setNumber: 5, weight: 80 }]])
    await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)
    await queueSetLogPatch({ id: 'st1', sessionId: 's1', parentSetId: 'h1' }, 4)
    expect(queue.map(({ table, operation, payload, sessionId, parentSetId }) => ({ table, operation, payload, sessionId, parentSetId }))).toEqual([
      { table: 'v2_set_logs', operation: 'patch', payload: { id: 'l1', set_number: 4 }, sessionId: 's1', parentSetId: undefined },
      { table: 'v2_set_logs', operation: 'patch', payload: { id: 'st1', set_number: 4 }, sessionId: 's1', parentSetId: 'h1' },
    ])
    expect(deviceLogs.get('l1')).toEqual({ id: 'l1', setNumber: 4, weight: 80 })
  })

  // Review 1 of 58a, finding 1: the session is read again after every pass, and a pass whose request failed while the phone reads as
  // online brings the old number back, so the screen lists the same correction again. Each such draw used to queue it again.
  it('queues a log\'s patch once: the same number again adds no item (and says so), however often it is asked for', async () => {
    deviceLogs = new Map([['l1', { id: 'l1', setNumber: 5 }]])
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(true)
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(false)
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(false)
    expect(queue.map((q) => q.payload)).toEqual([{ id: 'l1', set_number: 4 }])
  })

  it('counts a patch that is waiting, failing or has given up as queued (it is still the log\'s last write)', async () => {
    server = new Map([['v2_set_logs:l1', { id: 'l1', set_number: 5 }]])
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(true)
    failures.set('patch:l1', MAX_SYNC_ATTEMPTS)
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) {
      await flushSyncQueue()
      expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(false)
    }
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(false)
    expect(queue).toHaveLength(1)
  })

  it('only the log\'s LAST queued write counts: another number queued after it, or a whole-row save after it, means the same number is queued again', async () => {
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 5)).toBe(true)
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 6)).toBe(true)
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 5)).toBe(true) // the server would end on 6
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 5)).toBe(false)
    expect(queue.map((q) => q.payload.set_number)).toEqual([5, 6, 5])

    expect(await queueSetLogPatch({ id: 'l2', sessionId: 's1' }, 4)).toBe(true)
    queue.push({ id: nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'l2', session_id: 's1', set_number: 9, tag: 'again' }, createdAt: new Date(Date.now() + 60_000).toISOString() })
    expect(await queueSetLogPatch({ id: 'l2', sessionId: 's1' }, 4)).toBe(true) // the re-logged row would end on 9
    expect(queue.filter((q) => q.payload.id === 'l2').map((q) => q.operation)).toEqual(['patch', 'upsert', 'patch'])

    // "last" is the queue's own replay order (`createdAt`, then the id), not the order the items were added in
    expect(await queueSetLogPatch({ id: 'l3', sessionId: 's1' }, 4)).toBe(true)
    queue.push({ id: nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'l3', session_id: 's1', set_number: 9, tag: 'earlier' }, createdAt: '2000-01-01T00:00:00.000Z' })
    expect(await queueSetLogPatch({ id: 'l3', sessionId: 's1' }, 4)).toBe(false) // the upsert replays first; the patch is the last write
  })

  it('is a log\'s own: the same number for another log, or another table\'s row with the log\'s id, is not a patch already queued', async () => {
    expect(await queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).toBe(true)
    expect(await queueSetLogPatch({ id: 'l2', sessionId: 's1' }, 4)).toBe(true)
    queue = [{ id: nextId++, table: 'v2_sessions', operation: 'patch', payload: { id: 'l3', set_number: 4 }, createdAt: new Date().toISOString() }]
    expect(await queueSetLogPatch({ id: 'l3', sessionId: 's1' }, 4)).toBe(true)
    expect(queue).toHaveLength(2)
  })

  it('queues first: a queue that can\'t take the item leaves the device\'s copy alone (never a number changed with its patch lost)', async () => {
    deviceLogs = new Map([['l1', { id: 'l1', setNumber: 5 }]])
    writesUntilFailure.set('queue.add', 0)
    await expect(queueSetLogPatch({ id: 'l1', sessionId: 's1' }, 4)).rejects.toThrow('QuotaExceededError')
    expect(queue).toEqual([])
    expect(deviceLogs.get('l1')).toEqual({ id: 'l1', setNumber: 5 })
  })
})

// ─── Chunk 61's review 1, F1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// SPEC G47: delete set "work[s] offline and sync[s] later through the sync queue"; DECISIONS 147 (a): deleting a set's last drop makes it a normal set, so
// a logged head's log loses its stage kind. DECISIONS 197's condition ("a patch queue item only if a whole-row save could overwrite something it
// shouldn't") holds for `stage_kind` exactly as for `set_number`, so the patch item takes one more shape: `{ id, stage_kind: null }`, only that
// column and only null, sent as `update({ stage_kind: null }).eq('id', id)`. The ordering rules for it (held behind the drops' writes) are
// `useSyncQueue.order.test.ts`; the delete as the screen runs it, on the real producers, is `useSyncQueue.setDelete.test.tsx`.
describe('the patch item\'s second shape: a head loses its stage kind (61\'s review 1, F1)', () => {
  const head = { id: 'h1', session_id: 's1', exercise_id: 'e1', set_number: 3, weight: 80, reps: 8, rir: 2, stage_kind: 'dropset' }

  it('is one request, `update({ stage_kind: null }).eq(\'id\', id)`, and writes no other column: the head keeps its weight, reps and number', async () => {
    server = new Map([['v2_set_logs:h1', { ...head }]])
    patchKind('h1')
    await flushSyncQueue()
    expect(updateCalls).toEqual([{ patch: { stage_kind: null }, column: 'id', value: 'h1' }])
    expect(server.get('v2_set_logs:h1')).toEqual({ ...head, stage_kind: null })
    expect(queue).toEqual([])
  })

  it('is not a whole-row save (DECISIONS 197\'s condition): a whole-row save of the head brings back a head another phone deleted and writes this phone\'s weight over another phone\'s edit; the patch does neither', async () => {
    // this phone cached the head at weight 80 with its kind cleared; the other phone has since edited it to 85
    server = new Map([['v2_set_logs:h1', { ...head, weight: 85 }]])
    upsertLog('whole-row', { ...head, id: 'h1', stage_kind: null })
    await flushSyncQueue()
    expect(server.get('v2_set_logs:h1')).toMatchObject({ stage_kind: null, weight: 80 }) // the other phone's 85 is gone

    // the other phone deleted the head meanwhile
    server = new Map()
    queue = []
    upsertLog('whole-row', { ...head, id: 'h1', stage_kind: null })
    await flushSyncQueue()
    expect(server.has('v2_set_logs:h1')).toBe(true) // the head the user deleted is back

    server = new Map([['v2_set_logs:h1', { ...head, weight: 85 }]])
    queue = []
    patchKind('h1')
    await flushSyncQueue()
    expect(server.get('v2_set_logs:h1')).toMatchObject({ stage_kind: null, weight: 85, reps: 8, rir: 2, set_number: 3 })

    server = new Map()
    queue = []
    patchKind('h1')
    await flushSyncQueue()
    expect(server.has('v2_set_logs:h1')).toBe(false) // a head another phone deleted matches no row: no error, and nothing is brought back
    expect(queue).toEqual([])
  })

  it.each([
    ['another column beside the kind', { id: 'h1', stage_kind: null, weight: 1 }],
    ['the number beside the kind', { id: 'h1', stage_kind: null, set_number: 3 }],
    ['a kind that is not null', { id: 'h1', stage_kind: 'dropset' }],
    ['a kind that is undefined', { id: 'h1', stage_kind: undefined }],
    ['another column alone', { id: 'h1', weight: 1 }],
    ['a number that is not a number', { id: 'h1', set_number: '3' }],
    ['a number that is undefined', { id: 'h1', set_number: undefined }],
    ['no column at all', { id: 'h1' }],
    ['no id', { stage_kind: null }],
    ['an id that is not a string, beside the kind', { id: 7, stage_kind: null }],
    ['an id that is not a string, beside a number', { id: null, set_number: 3 }],
    ['a whole row', { ...head, stage_kind: null }],
  ])('refuses a patch that carries %s, and sends nothing', async (_what, payload) => {
    server = new Map([['v2_set_logs:h1', { ...head }]])
    enqueue({ table: 'v2_set_logs', operation: 'patch', payload: payload as Record<string, unknown>, sessionId: 's1' })
    await flushSyncQueue()
    expect(requests).toEqual([])
    expect(updateCalls).toEqual([])
    expect(server.get('v2_set_logs:h1')).toEqual(head)
    expect(queue[0].attempts).toBe(1) // a failed attempt, kept
  })

  it('replays after the earlier write to its own log, in order: the head\'s upsert, then the kind; also when the upsert fails in the pass that would send it (a patch sent first would match no row and the upsert would then leave the kind)', async () => {
    upsertLog('created', { id: 'h1', stage_kind: 'dropset', weight: 80 })
    patchKind('h1')
    failures.set('created', 1)
    await flushSyncQueue() // the upsert fails; the patch must not go ahead of it
    expect(requests).toEqual([])
    expect(queue.map((q) => q.operation)).toEqual(['upsert', 'patch'])
    await flushSyncQueue()
    expect(requests).toEqual(['upsert created', 'patch v2_set_logs:h1'])
    expect(server.get('v2_set_logs:h1')).toMatchObject({ stage_kind: null, weight: 80 })
  })

  it('a head logged offline, cleared and deleted before the phone reached the server: the three go in order, the server ends without it and nothing is left failing', async () => {
    upsertLog('created', { id: 'h1', stage_kind: 'dropset', weight: 80 })
    patchKind('h1')
    enqueue({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'h1' }, sessionId: 's1' })
    await flushSyncQueue()
    expect(requests).toEqual(['upsert created', 'patch v2_set_logs:h1', 'delete v2_set_logs:h1'])
    expect(server.has('v2_set_logs:h1')).toBe(false)
    expect(queue).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
  })

  it('a failed kind patch stays queued, is counted and sent again; after MAX_SYNC_ATTEMPTS it is reported to its session and a retry sends it', async () => {
    server = new Map([['v2_set_logs:h1', { ...head }]])
    patchKind('h1')
    failures.set('patch:h1', MAX_SYNC_ATTEMPTS)
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()
    expect(queue[0]).toMatchObject({ attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    expect(useOfflineStore.getState().syncFailures).toEqual([{ queueId: queue[0].id, table: 'v2_set_logs', recordId: 'h1', sessionId: 's1' }])
    await retrySyncFailures()
    expect(queue).toEqual([])
    expect(server.get('v2_set_logs:h1')?.stage_kind).toBeNull()
  })

  it('the finish waits for it: hasQueuedWritesFor names the session while the kind patch is queued, and no other session', async () => {
    patchKind('h1')
    expect(await hasQueuedWritesFor('s1')).toBe(true)
    expect(await hasQueuedWritesFor('s2')).toBe(false)
  })
})

describe('queueSetLogStageKindClear (61\'s review 1, F1)', () => {
  it('queues the item with the session beside it, the payload `{ id, stage_kind: null }` and nothing else, and changes the device\'s own copy of the log', async () => {
    deviceLogs = new Map([['h1', { id: 'h1', stageKind: 'dropset', weight: 80 }]])
    await queueSetLogStageKindClear({ id: 'h1', sessionId: 's1' })
    expect(queue.map(({ table, operation, payload, sessionId, parentSetId }) => ({ table, operation, payload, sessionId, parentSetId }))).toEqual([
      { table: 'v2_set_logs', operation: 'patch', payload: { id: 'h1', stage_kind: null }, sessionId: 's1', parentSetId: undefined },
    ])
    expect(deviceLogs.get('h1')).toEqual({ id: 'h1', stageKind: null, weight: 80 })
  })

  it('queues first: a queue that can\'t take the item leaves the device\'s copy alone (never a kind cleared with its patch lost)', async () => {
    deviceLogs = new Map([['h1', { id: 'h1', stageKind: 'dropset' }]])
    writesUntilFailure.set('queue.add', 0)
    await expect(queueSetLogStageKindClear({ id: 'h1', sessionId: 's1' })).rejects.toThrow('QuotaExceededError')
    expect(queue).toEqual([])
    expect(deviceLogs.get('h1')).toEqual({ id: 'h1', stageKind: 'dropset' })
  })

  it('does not disturb the number patch\'s own once-only rule: a number patch queued after a kind patch is queued, and the same number again is not', async () => {
    await queueSetLogStageKindClear({ id: 'h1', sessionId: 's1' })
    expect(await queueSetLogPatch({ id: 'h1', sessionId: 's1' }, 2)).toBe(true)
    expect(await queueSetLogPatch({ id: 'h1', sessionId: 's1' }, 2)).toBe(false)
    expect(queue.map((q) => q.payload)).toEqual([{ id: 'h1', stage_kind: null }, { id: 'h1', set_number: 2 }])
  })
})
