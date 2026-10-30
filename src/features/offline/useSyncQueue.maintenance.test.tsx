// @vitest-environment jsdom
// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]: "a queued write refused with the maintenance code stays in the queue. It is not counted as
// failed, doesn't add to the retry count, and shows no RETRY notice. It is sent when maintenance is off."; TASKS.md chunk 72, W; DECISIONS 271).
//
// The sync queue against the queue's test server (`queueServer.testutil.ts`), which refuses every write `OL001` while its `maintenance` is on, as
// migration 048's trigger does: before any row is looked at (so before a foreign key is checked, and for a delete that names no row too). The writes
// are the real producers' shapes and the pass is the real `flushSyncQueue`. What these prove:
//   - a write refused `OL001` is kept exactly as it was (no `attempts`, no `gaveUp`, `sendStarted` as the send set it), the pass ENDS there (the later
//     writes are not sent), and nothing reads it as a failure (`syncFailures`, the notice), however many passes it takes; whichever kind of write is first
//     (an upsert, a patch, a delete, a delete that names no row);
//   - every other refusal is what it was: a `23503` or a network error is a failed attempt, and the pass goes on;
//   - the pass reads the status again at once (the screen does not wait for the hour), and the pass after the status turns from on to off sends the
//     held writes, in order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueueServer } from './queueServer.testutil'

interface QueueItem {
  id: number
  table: string
  operation: 'upsert' | 'delete' | 'patch'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
  gaveUp?: boolean
  sendStarted?: boolean
  recomputeFinish?: boolean
  sessionId?: string
  parentSetId?: string
}
interface Status {
  maintenance: boolean
  minVersion: string
  exemptUserIds: string[]
  updatedAt: string
}
const ON: Status = { maintenance: true, minVersion: '1.2.1', exemptUserIds: [], updatedAt: 'now' }
const OFF: Status = { ...ON, maintenance: false }

const world = vi.hoisted(() => ({
  online: true,
  queue: [] as unknown[],
  nextId: 1,
  clock: 0,
  status: null as unknown as Status,
  statusReads: 0,
  /** Holds the status read until released (a read in flight). */
  statusGate: null as Promise<void> | null,
  afterUpsert: null as (() => void) | null,
}))
const queue = () => world.queue as QueueItem[]
const server = new QueueServer()

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: vi.fn() }) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      // Dexie hands back copies, not the objects it stores.
      orderBy: () => ({ toArray: async () => structuredClone([...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) }),
      toArray: async () => structuredClone([...queue()]),
      add: async (item: Omit<QueueItem, 'id'>) => void queue().push({ ...item, id: world.nextId++ }),
      delete: async (id: number) => void (world.queue = queue().filter((q) => q.id !== id)),
      update: async (id: number, patch: Partial<QueueItem>) => void (world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))),
    },
    set_logs: { delete: async () => {}, update: async () => {}, put: async () => {} },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: [string]) => {
      const query = server.query(args[0])
      // A test's hook into the moment right after an upsert has been answered (a refusal that is followed by a request).
      return {
        ...query,
        upsert: async (row: Record<string, unknown>) => {
          const answer = await query.upsert(row)
          const after = world.afterUpsert
          world.afterUpsert = null
          after?.()
          return answer
        },
      }
    },
  },
}))
vi.mock('../release/appStatusService', () => ({
  fetchAppStatus: async () => {
    world.statusReads += 1
    if (world.statusGate) await world.statusGate
    return { ...world.status }
  },
}))

const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, hasQueuedWritesFor, useSyncQueueRunner } = await import('./useSyncQueue')
const { useAppStatus } = await import('../release/useAppStatus')
const { APP_STATUS_KEY } = await import('../../lib/maintenanceRefusal')
const { useOfflineStore } = await import('./offlineStore')
const { default: SyncFailedNotice } = await import('./SyncFailedNotice')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

/** Queue an item as the producers do: in order, with the time they stamp it. */
function put(item: Omit<QueueItem, 'id' | 'createdAt'>): QueueItem {
  const full = { ...item, id: world.nextId++, createdAt: `2026-10-30T10:00:${String(world.clock++).padStart(2, '0')}Z` } as QueueItem
  queue().push(full)
  return full
}
const logRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'u1', session_id: 's1', exercise_id: 'bench', week_plan_set_id: null, parent_set_id: null, set_number: 1, weight: 60, reps: 8, logged_at: '2026-10-30T10:00:00Z', ...extra,
})
const upsertLog = (id: string, extra: Record<string, unknown> = {}) => put({ table: 'v2_set_logs', operation: 'upsert', payload: logRow(id, extra) })
const patchLog = (id: string, setNumber: number) => put({ table: 'v2_set_logs', operation: 'patch', payload: { id, set_number: setNumber }, sessionId: 's1' })
const deleteLog = (id: string) => put({ table: 'v2_set_logs', operation: 'delete', payload: { id }, sessionId: 's1' })

/** The queue as stored, in order, as a short description: `upsert v2_set_logs:l1`. */
const queued = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map((q) => `${q.operation} ${q.table}:${q.payload.id as string}`)

beforeEach(() => {
  world.online = true
  world.queue = []
  world.nextId = 1
  world.clock = 0
  world.status = OFF
  world.statusReads = 0
  world.statusGate = null
  world.afterUpsert = null
  server.reset()
  queryClient.clear()
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  vi.spyOn(console, 'error').mockImplementation(() => {}) // the queue logs each failed attempt (and says nothing of a held one: asserted below)
  // The account's world on the server: an exercise, a session in progress, two logs the patch and the delete name.
  server.put('exercises', { id: 'bench' })
  server.put('v2_sessions', { id: 's1', status: 'in_progress' })
  server.put('v2_set_logs', logRow('l2', { set_number: 2 }))
  server.put('v2_set_logs', logRow('l3', { set_number: 3 }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the test server refuses as migration 048 does', () => {
  it('a write is refused OL001 before its foreign key is looked at, a delete that names no row is refused too, and a read never is', async () => {
    server.maintenance = true
    // a log naming a session the server does not hold: with maintenance off this is 23503 (the control), with it on the trigger fires first
    const query = server.query('v2_set_logs')
    expect(await query.upsert(logRow('x1', { session_id: 'no-such-session' }))).toEqual({
      error: { code: 'OL001', message: 'Overload is being updated. Writes are refused until maintenance is off.', details: null, hint: 'maintenance' },
    })
    expect(server.refused, 'no foreign key was checked').toEqual([])
    expect((await query.update({ set_number: 9 }).eq('id', 'l2')).error).toMatchObject({ code: 'OL001' })
    expect((await query.delete().eq('id', 'no-such-log')).error).toMatchObject({ code: 'OL001' })
    expect(server.requests).toEqual(['upsert v2_set_logs:x1 -> OL001', 'patch v2_set_logs:l2 -> OL001', 'delete v2_set_logs:no-such-log -> OL001'])
    expect(server.get('v2_set_logs', 'l2')!.set_number).toBe(2)
    expect((await server.query('v2_set_logs').select('*').eq('id', 'l2')).error).toBeNull()

    server.maintenance = false
    expect(await query.upsert(logRow('x1', { session_id: 'no-such-session' }))).toMatchObject({ error: { code: '23503' } })
    expect(server.refused).toEqual(['upsert v2_set_logs:x1'])
  })
})

describe('W: a write refused OL001 stays in the queue, uncounted, and the pass ends there', () => {
  // The first write in the queue is each kind in turn (the pre-read, 72-5), and a delete that names no row too: the first is the one that is
  // refused, and the other two are not sent. Each write is on a record of its own, so nothing but the pass's ending holds the later ones back.
  const SHAPES: Array<{ name: string; arrange: () => string; sendStarted: boolean; deleted: string }> = [
    { name: 'an upsert first, then a patch and a delete', arrange: () => (upsertLog('l1'), patchLog('l2', 5), deleteLog('l3'), 'upsert v2_set_logs:l1'), sendStarted: true, deleted: 'l3' },
    { name: 'a patch first, then an upsert and a delete', arrange: () => (patchLog('l2', 5), upsertLog('l1'), deleteLog('l3'), 'patch v2_set_logs:l2'), sendStarted: false, deleted: 'l3' },
    { name: 'a delete first, then an upsert and a patch', arrange: () => (deleteLog('l3'), upsertLog('l1'), patchLog('l2', 5), 'delete v2_set_logs:l3'), sendStarted: false, deleted: 'l3' },
    { name: 'a delete that names no row first (the server holds nothing to delete), then an upsert and a patch', arrange: () => (deleteLog('gone'), upsertLog('l1'), patchLog('l2', 5), 'delete v2_set_logs:gone'), sendStarted: false, deleted: 'gone' },
  ]

  for (const shape of SHAPES) {
    it(`${shape.name}: one request, refused; kept as it was; the others not sent`, async () => {
      const first = shape.arrange()
      const before = structuredClone(queue())
      server.maintenance = true

      await flushSyncQueue()

      expect(server.requests, 'exactly one request reached the server, and it was refused').toEqual([`${first} -> OL001`])
      expect(queued(), 'nothing left the queue, and nothing was added').toEqual(before.map((q) => `${q.operation} ${q.table}:${q.payload.id as string}`))
      for (const item of queue()) {
        expect(item.attempts, `${item.operation} ${item.payload.id as string}: attempts`).toBeUndefined()
        expect(item.gaveUp, `${item.operation} ${item.payload.id as string}: gaveUp`).toBeUndefined()
      }
      // `sendStarted` is as the send set it: an upsert is marked before its request goes out, a patch or a delete never is
      const heldItem = [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      expect(heldItem.sendStarted === true).toBe(shape.sendStarted)
      // the payloads are untouched, and so is the server
      expect(queue().map((q) => q.payload)).toEqual(before.map((q) => q.payload))
      expect(server.get('v2_set_logs', 'l2')!.set_number).toBe(2)
      expect(server.has('v2_set_logs', 'l3')).toBe(true)
      expect(server.has('v2_set_logs', 'l1')).toBe(false)
      // it is a write that still has to be sent, for the finish and the screens that look
      expect(await hasQueuedWritesFor('s1')).toBe(true)
    })

    it(`${shape.name}: then maintenance is off, and the next pass sends all three, in order`, async () => {
      shape.arrange()
      server.maintenance = true
      await flushSyncQueue()
      const expected = queued()
      server.maintenance = false
      server.requests.length = 0

      await flushSyncQueue()

      expect(server.requests.length, 'one request per write').toBe(3)
      expect(queue(), 'the queue is empty').toEqual([])
      // in the order they were queued
      expect(server.requests.map((r) => r.split(' -> ')[0].replace(/ \{.*\}$/, ''))).toEqual(expected)
      expect(server.has('v2_set_logs', 'l1')).toBe(true)
      expect(server.get('v2_set_logs', 'l2')!.set_number).toBe(5)
      expect(server.has('v2_set_logs', shape.deleted)).toBe(false)
      expect(server.has('v2_set_logs', 'l3')).toBe(shape.deleted !== 'l3')
    })
  }

  it('however many passes it takes: six refused passes (more than MAX_SYNC_ATTEMPTS) leave no failure and no notice, one request each, and the write is still there', async () => {
    upsertLog('l1')
    patchLog('l2', 5)
    deleteLog('l3')
    server.maintenance = true
    for (let pass = 1; pass <= 6; pass += 1) {
      await flushSyncQueue()
      expect(server.requests.length, `pass ${pass}`).toBe(pass)
    }
    expect(server.maintenanceRefused).toEqual(Array(6).fill('upsert v2_set_logs:l1'))
    const first = queue().find((q) => q.payload.id === 'l1')!
    expect(first.attempts).toBeUndefined()
    expect(first.gaveUp).toBeUndefined()
    expect(useOfflineStore.getState().syncFailures, 'failuresOf reads no failure').toEqual([])
    expect(useOfflineStore.getState().failedIds.size).toBe(0)
    // and the notice on the workout (and on every screen that draws it) draws nothing
    const { container } = render(<SyncFailedNotice sessionId="s1" variant="strip" />)
    expect(container.innerHTML).toBe('')
    expect(console.error, 'a held write is not logged as a failed attempt').not.toHaveBeenCalled()
  })

  it('control: a 23503 still counts as a failed attempt, and the pass goes on to the writes that are not held behind it', async () => {
    const failing = upsertLog('l1', { session_id: 'no-such-session' }) // refused 23503: the session is not on the server
    patchLog('l2', 5)
    deleteLog('l3')
    await flushSyncQueue()
    expect(queue().find((q) => q.id === failing.id)!.attempts).toBe(1)
    expect(server.refused).toEqual(['upsert v2_set_logs:l1'])
    expect(server.requests).toEqual(['upsert v2_set_logs:l1 -> 23503 session_id', expect.stringContaining('patch v2_set_logs:l2'), 'delete v2_set_logs:l3 -> 1 row'])
    expect(console.error).toHaveBeenCalled()
    // the same write during maintenance is not a failed attempt at all: the trigger fires before the key is checked
    server.requests.length = 0
    server.maintenance = true
    await flushSyncQueue()
    expect(server.requests).toEqual(['upsert v2_set_logs:l1 -> OL001'])
    expect(queue().find((q) => q.id === failing.id)!.attempts, 'still the one attempt it had').toBe(1)
    expect(server.refused, 'no foreign key was checked').toEqual(['upsert v2_set_logs:l1'])
  })

  it('control: a network error counts an attempt, and the pass sends the independent writes after it (the contrast with a refusal that ends the pass)', async () => {
    const failing = upsertLog('l1')
    patchLog('l2', 5)
    deleteLog('l3')
    server.failing.set('upsert v2_set_logs:l1', 1)
    await flushSyncQueue()
    expect(queue().find((q) => q.id === failing.id)!.attempts).toBe(1)
    expect(server.requests.length, 'the upsert failed, the patch and the delete went').toBe(3)
    expect(queued()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('the second refusal in one pass cannot happen: a refused first write means the later ones are never sent, even when a later one names another table', async () => {
    deleteLog('l3')
    put({ table: 'v2_coach_notes', operation: 'upsert', payload: { id: 'n1', user_id: 'u1', session_id: null, body: 'a note' } })
    put({ table: 'v2_session_set_changes', operation: 'upsert', payload: { id: 'c1', user_id: 'u1', session_id: 's1', kind: 'retyped', week_plan_set_id: null, set_log_id: null } })
    server.maintenance = true
    await flushSyncQueue()
    expect(server.requests).toEqual(['delete v2_set_logs:l3 -> OL001'])
    expect(queued().length).toBe(3)
  })

  it('a refusal during the recovery send ends the pass too: a log refused on its removed planned set (23503) and then refused for maintenance is kept, uncounted', async () => {
    const held = upsertLog('l1', { week_plan_set_id: 'removed-on-plan' })
    patchLog('l2', 5)
    // the first request is refused on its planned set (a foreign key, while maintenance is off); maintenance turns on right after, so the request the
    // recovery sends again, with no planned set, arrives during it
    world.afterUpsert = () => void (server.maintenance = true)
    await flushSyncQueue()
    expect(server.requests).toEqual(['upsert v2_set_logs:l1 -> 23503 week_plan_set_id', 'upsert v2_set_logs:l1 -> OL001'])
    const item = queue().find((q) => q.id === held.id)!
    expect(item.payload.week_plan_set_id, 'the row waits as the recovery made it: with no planned set').toBeNull()
    expect(item.attempts, 'not a failed attempt').toBeUndefined()
    expect(item.gaveUp).toBeUndefined()
    expect(queued()).toEqual(['upsert v2_set_logs:l1', 'patch v2_set_logs:l2'])
    expect(server.requests.some((r) => r.startsWith('patch')), 'the pass ended').toBe(false)
  })
})

describe('W: the status is read again at once (DECISIONS 271), in the queue\'s catch', () => {
  it('a pass the database refuses for maintenance reads the flag again at once: the screen does not wait for the hour', async () => {
    const status = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(status.result.current.data?.maintenance).toBe(false)) // the read at start
    expect(world.statusReads).toBe(1)

    // maintenance goes on while this phone is open on its workout; the next write it sends is refused
    world.status = ON
    server.maintenance = true
    upsertLog('l1')
    await flushSyncQueue()

    await waitFor(() => expect(status.result.current.data?.maintenance).toBe(true))
    expect(world.statusReads, 'one read, made by the refusal').toBe(2)
  })

  it('control: a pass with nothing refused, and one that fails any other way, reads nothing', async () => {
    const status = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(world.statusReads).toBe(1))
    upsertLog('l1')
    await flushSyncQueue() // goes through
    upsertLog('l4', { session_id: 'no-such-session' })
    await flushSyncQueue() // 23503
    server.failing.set('upsert v2_set_logs:l5', 1)
    upsertLog('l5')
    await flushSyncQueue() // a network error
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(world.statusReads).toBe(1)
    expect(status.result.current.data?.maintenance).toBe(false)
  })
})

describe('W: the pass after the status turns from maintenance to off sends the held writes (useSyncQueueRunner)', () => {
  it('on, then off: the held writes go, in order, by the pass the change starts', async () => {
    world.status = ON
    server.maintenance = true
    upsertLog('l1')
    patchLog('l2', 5)
    deleteLog('l3')

    renderHook(() => useSyncQueueRunner(), { wrapper }) // starts online: its first pass is the one at mount
    await waitFor(() => expect(server.requests).toEqual(['upsert v2_set_logs:l1 -> OL001']))
    await waitFor(() => expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ maintenance: true }))
    expect(queued().length).toBe(3)

    // maintenance ends; the next read of the status says so
    server.maintenance = false
    world.status = OFF
    server.requests.length = 0
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })
    })

    await waitFor(() => expect(queue()).toEqual([]))
    expect(server.requests.map((r) => r.split(' ')[0] + ' ' + r.split(' ')[1])).toEqual(['upsert v2_set_logs:l1', 'patch v2_set_logs:l2', 'delete v2_set_logs:l3'])
    expect(server.maintenanceRefused.length, 'the one refusal at mount').toBe(1)
  })

  it('control: no change flushes nothing: off then off, off then on, and on then on (a read that finds it still on) send nothing', async () => {
    world.status = OFF
    renderHook(() => useSyncQueueRunner(), { wrapper }) // an empty queue: the pass at mount sends nothing
    await waitFor(() => expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ maintenance: false }))
    upsertLog('l1') // queued after the pass at mount, during the quiet
    server.maintenance = true // a write now would be refused: any pass shows as a request
    const reread = (status: Status) =>
      act(async () => {
        world.status = status
        await queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })
      })

    await reread(OFF) // off → off
    await reread(ON) // off → on
    await reread(ON) // on → on
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.requests, 'no pass was started by a status read that did not turn maintenance off').toEqual([])
  })

  it('the flag the phone last knew is not erased by a stretch with no answer at all (the status gone from the cache, the next read slow): the answer that follows is "off", and the held writes go', async () => {
    world.status = ON
    server.maintenance = true
    upsertLog('l1')
    patchLog('l2', 5)
    const view = renderHook(() => useSyncQueueRunner(), { wrapper })
    await waitFor(() => expect(server.requests).toEqual(['upsert v2_set_logs:l1 -> OL001']))
    await waitFor(() => expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ maintenance: true }))

    // no answer: what an account change does to the cache, and the read that follows is in flight when maintenance ends
    let answer!: () => void
    world.statusGate = new Promise<void>((resolve) => (answer = resolve))
    await act(async () => {
      queryClient.removeQueries({ queryKey: APP_STATUS_KEY })
      view.rerender() // the hook builds its query again, which reads
    })
    await waitFor(() => expect(world.statusReads).toBeGreaterThanOrEqual(2))
    expect(queryClient.getQueryData(APP_STATUS_KEY), 'no answer meanwhile').toBeUndefined()
    server.maintenance = false
    world.status = OFF
    server.requests.length = 0
    answer()

    await waitFor(() => expect(queue()).toEqual([]))
    expect(server.has('v2_set_logs', 'l1')).toBe(true)
    expect(server.get('v2_set_logs', 'l2')!.set_number).toBe(5)
  })

  it('the phone going offline while it is on is not "off": nothing is sent, and when the answer after reconnecting is "off" the held writes go', async () => {
    world.status = ON
    server.maintenance = true
    upsertLog('l1')
    patchLog('l2', 5)
    const view = renderHook(() => useSyncQueueRunner(), { wrapper })
    await waitFor(() => expect(server.requests).toEqual(['upsert v2_set_logs:l1 -> OL001']))
    await waitFor(() => expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ maintenance: true }))

    world.online = false // offline: the app has no answer (undefined), which is not "off"
    view.rerender()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.requests.length, 'offline sends nothing').toBe(1)

    // reconnecting: the pass at the reconnect meets the database still in maintenance, and the read that answers it is in flight; when it answers
    // "off", the flag the phone last knew was "on" (the stretch without an answer did not erase it), so the pass that follows sends the queue
    let answer!: () => void
    world.statusGate = new Promise<void>((resolve) => (answer = resolve))
    world.online = true
    view.rerender()
    await waitFor(() => expect(server.requests.length).toBe(2)) // the reconnect's pass: refused again, one request
    server.maintenance = false
    world.status = OFF
    answer()
    await waitFor(() => expect(queue()).toEqual([]))
    expect(server.has('v2_set_logs', 'l1')).toBe(true)
    expect(server.get('v2_set_logs', 'l2')!.set_number).toBe(5)
  })
})
