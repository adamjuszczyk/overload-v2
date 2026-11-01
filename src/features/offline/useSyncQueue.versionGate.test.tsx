// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // the running version these tests stand on
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SetLog } from '../../types'
import { QueueServer } from './queueServer.testutil'
import { headLog, pending } from '../gym/workoutRules.testutil'
import { STATUS_ALLOWS_1_2_1, STATUS_REQUIRES_1_2_2, versionCheckAnswers, versionCheckUnread } from '../release/versionGate.testutil'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11] and Rule 5; RULES.md, Standing rules: "Queued writes across a version change"; the gap
// pre-read's 73-1, 73-2 and 73-3). "The offline queue survives the update and is sent by the new version, never by the old one": the old version never
// sends once the version check has refused it, and never before that check has answered. The check is made inside `flushSyncQueue`, from the status in
// the query cache at that moment, so EVERY way into a pass is held with it. These run the real producers and the real pass against the queue's test
// server (`queueServer.testutil.ts`, which records every request that reaches it) and the real status hook:
//   - each caller of `flushSyncQueue` (the runner, the retry from the notice and from a row, the finish, the number corrections, the change rows),
//     with the check unread and with it blocked: no request reaches the server and every write is still queued; with it ok, the control, they are sent;
//   - the runner sends when the check turns to ok, from unread or from blocked, and not otherwise;
//   - an 'ok' from before an offline stretch is not trusted after it: nothing is sent until a read made after the phone is back online answers;
//   - a status read that fails is read again every minute while the check has no answer, the phone is online and it holds writes;
//   - a pass already running stops sending once the check says blocked.

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

const world = vi.hoisted(() => ({
  online: true,
  queue: [] as unknown[],
  nextId: 1,
  clock: 0,
  status: null as unknown as { maintenance: boolean; minVersion: string; exemptUserIds: string[]; updatedAt: string },
  statusReads: 0,
  /** Holds the status read until released (a read in flight). */
  statusGate: null as Promise<void> | null,
  /** The status read fails (the server down, a network error). */
  statusFails: false,
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
      count: async () => queue().length,
      add: async (item: Omit<QueueItem, 'id'>) => void queue().push({ ...item, id: world.nextId++ }),
      delete: async (id: number) => void (world.queue = queue().filter((q) => q.id !== id)),
      update: async (id: number, patch: Partial<QueueItem>) => void (world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))),
    },
    set_logs: { where: () => ({ equals: () => ({ toArray: async () => [] }) }), delete: async () => {}, update: async () => {}, put: async () => {} },
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...args: [string]) => server.query(args[0]) } }))
vi.mock('../release/appStatusService', () => ({
  fetchAppStatus: async () => {
    world.statusReads += 1
    if (world.statusGate) await world.statusGate
    if (world.statusFails) throw new Error('Failed to fetch')
    return { ...world.status }
  },
}))

const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, hasQueuedWritesFor, retrySyncFailures, useSyncQueueRunner } = await import('./useSyncQueue')
const { useOfflineStore } = await import('./offlineStore')
const { default: SyncFailedNotice } = await import('./SyncFailedNotice')
const { SyncMark } = await import('../gym/setRowParts')
const { useCompleteSession } = await import('../gym/useSession')
const { patchSetNumbers } = await import('../gym/useSetNumberCorrections')
const { queueSetChanges } = await import('../gym/useSessionSetChanges')
const { GATE_POLL_MS } = await import('../release/useAppStatus')
const { APP_STATUS_KEY } = await import('../../lib/maintenanceRefusal')

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
const queued = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map((q) => `${q.operation} ${q.table}:${q.payload.id as string}`)
/** Time for anything that was going to happen to happen. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))))

beforeEach(() => {
  world.online = true
  world.queue = []
  world.nextId = 1
  world.clock = 0
  world.status = { ...STATUS_ALLOWS_1_2_1 }
  world.statusReads = 0
  world.statusGate = null
  world.statusFails = false
  server.reset()
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
  versionCheckUnread()
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  server.put('exercises', { id: 'bench' })
  server.put('v2_sessions', { id: 's1', status: 'in_progress' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
  queryClient.clear()
})

// ─── 73-1: every way into a pass ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// How the check stands: not read at all (the status read, if the caller starts one, is held), or read and blocked.
const CHECKS: Array<{ name: string; set: () => void; state: 'unknown' | 'blocked' }> = [
  {
    name: 'unknown (the status has not been read)',
    set: () => {
      versionCheckUnread()
      world.statusGate = new Promise<void>(() => {}) // a read that is asked for never answers
    },
    state: 'unknown',
  },
  {
    name: 'blocked (min_version 1.2.2 against the running 1.2.1)',
    set: () => {
      world.status = { ...STATUS_REQUIRES_1_2_2 }
      versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    },
    state: 'blocked',
  },
]

interface Caller {
  name: string
  /** Puts what the caller sends into the queue, and sets up its screen. */
  arrange: () => void
  /** The caller does its thing, and waits until it is done. */
  run: () => Promise<void>
  /** The items this caller leaves queued while it is held, in order. */
  heldQueue: string[]
}

const failedRetry = () => {
  upsertLog('l1')
  world.queue = queue().map((q) => ({ ...q, attempts: 5, gaveUp: true, sendStarted: true }))
  useOfflineStore.setState({ syncFailures: [{ queueId: 1, table: 'v2_set_logs', recordId: 'l1', sessionId: 's1' }], failedIds: new Set(['l1']) })
}

const CALLERS: Caller[] = [
  {
    name: 'the runner, at mount',
    arrange: () => void upsertLog('l1'),
    run: async () => {
      renderHook(() => useSyncQueueRunner(), { wrapper })
      await settle()
    },
    heldQueue: ['upsert v2_set_logs:l1'],
  },
  {
    name: 'flushSyncQueue itself',
    arrange: () => void upsertLog('l1'),
    run: async () => {
      await flushSyncQueue()
    },
    heldQueue: ['upsert v2_set_logs:l1'],
  },
  {
    name: "retrySyncFailures, the notice's RETRY (SyncFailedNotice)",
    arrange: failedRetry,
    run: async () => {
      render(<SyncFailedNotice sessionId="s1" variant="strip" />)
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'RETRY' })))
      await settle()
    },
    heldQueue: ['upsert v2_set_logs:l1'],
  },
  {
    name: "retrySyncFailures, a logged row's ONLY ON THIS PHONE · RETRY (SyncMark in setRowParts)",
    arrange: failedRetry,
    run: async () => {
      render(<SyncMark logId="l1" />)
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: /ONLY ON THIS PHONE/ })))
      await settle()
    },
    heldQueue: ['upsert v2_set_logs:l1'],
  },
  {
    name: 'the finish (useCompleteSession, online): it queues behind the session\'s writes it could not send',
    arrange: () => void upsertLog('l1'),
    run: async () => {
      const { result } = renderHook(() => useCompleteSession(), { wrapper })
      await act(async () => void (await result.current.mutateAsync({ id: 's1', note: null })))
    },
    heldQueue: ['upsert v2_set_logs:l1', 'upsert v2_sessions:s1'],
  },
  {
    name: 'the number corrections (patchSetNumbers, flush on)',
    arrange: () => server.put('v2_set_logs', logRow('l2', { set_number: 2 })),
    run: async () => {
      await act(async () => void (await patchSetNumbers({ sessionId: 's1', patches: [{ id: 'l2', setNumber: 5 }], logs: [{ id: 'l2', parentSetId: null }], flush: true })))
    },
    heldQueue: ['patch v2_set_logs:l2'],
  },
  {
    name: 'the change rows (queueSetChanges, flush on)',
    arrange: () => server.put('v2_set_logs', logRow(headLog('bench', 1).id)),
    run: async () => {
      await act(async () => void (await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending(headLog('bench', 1) as SetLog, 'dropset', 1), id: null }], flush: true })))
    },
    heldQueue: ['upsert v2_session_set_changes:<id>'],
  },
]

const requestsOf = () => server.requests.map((r) => r.split(' -> ')[0])

describe('73-1: every caller of flushSyncQueue is held while the check has not answered and while it says blocked', () => {
  for (const caller of CALLERS) {
    for (const check of CHECKS) {
      it(`${caller.name}, check ${check.name}: no request reaches the server, and every write is still queued`, async () => {
        caller.arrange()
        check.set()
        expect(['unknown', 'blocked']).toContain(check.state)
        await caller.run()
        expect(server.requests, 'nothing was sent').toEqual([])
        expect(queued().map((q) => q.replace(/:[0-9a-f-]{36}$/, ':<id>'))).toEqual(caller.heldQueue)
        expect(server.has('v2_set_logs', 'l1')).toBe(false)
        expect(server.get('v2_set_logs', 'l2')?.set_number ?? 2).toBe(2)
      })
    }

    it(`${caller.name}, check ok (the control): the same call sends`, async () => {
      caller.arrange()
      versionCheckAnswers(STATUS_ALLOWS_1_2_1)
      await caller.run()
      expect(server.requests.length, `requests: ${server.requests.join(' | ')}`).toBeGreaterThan(0)
      expect(server.requests.every((r) => !r.includes('OL001') && !r.includes('network error') && !r.includes('23503'))).toBe(true)
      await waitFor(() => expect(queue()).toEqual([]))
    })
  }

  it('a held call returns at once and resolved, never rejected, never waiting on anything (the finish awaits it)', async () => {
    upsertLog('l1')
    versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    await expect(flushSyncQueue()).resolves.toBeUndefined()
    await expect(retrySyncFailures()).resolves.toBeUndefined()
    expect(await hasQueuedWritesFor('s1'), 'the finish then finds the session\'s writes still queued').toBe(true)
  })

  it('a held call touches nothing: a never-sent pair is not cancelled, the "couldn\'t sync" state is not rewritten, the session is not read again', async () => {
    // The queue is what the new version will find (it may have to convert it: SPEC Rule 5), so a call that is held leaves it exactly as it is.
    upsertLog('l1') // never sent...
    put({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'l1' }, sessionId: 's1' }) // ...and its delete: a pass would cancel the pair
    useOfflineStore.setState({ syncFailures: [{ queueId: 99, table: 'v2_set_logs', recordId: 'x', sessionId: 's1' }], failedIds: new Set(['x']) })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    await flushSyncQueue()
    expect(queued()).toEqual(['upsert v2_set_logs:l1', 'delete v2_set_logs:l1'])
    expect(useOfflineStore.getState().syncFailures, 'a pass recomputes this from the queue').toHaveLength(1)
    expect(invalidate, 'a pass ends by reading the session again').not.toHaveBeenCalled()

    // the control: with the check ok the same call is a pass, and it cancels the pair (nothing is sent: the row never reached the server)
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    await flushSyncQueue()
    expect(queue()).toEqual([])
    expect(server.requests).toEqual([])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['v2_session'] })
  })

  it('a held retry still gives the writes that stopped retrying a fresh set of attempts (it is what the person asked for), sends nothing, and the pass after the check turns ok sends them', async () => {
    failedRetry()
    versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    await retrySyncFailures()
    expect(server.requests).toEqual([])
    expect(queue()).toHaveLength(1)
    expect(queue()[0]).toMatchObject({ attempts: 0, gaveUp: false, sendStarted: true })

    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    await flushSyncQueue()
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
    expect(queue()).toEqual([])
  })

  it('the finish, check ok: the log is sent, then the session is completed on the server (the path the held finish does not take)', async () => {
    upsertLog('l1')
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    const { result } = renderHook(() => useCompleteSession(), { wrapper })
    await act(async () => void (await result.current.mutateAsync({ id: 's1', note: null })))
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1', expect.stringMatching(/^patch v2_sessions:s1/)])
    expect(queue()).toEqual([])
  })

  it('the held finish is the queued one: the session\'s completion is a write behind the log, flagged for the new version to derive it from the server', async () => {
    upsertLog('l1')
    versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    const { result } = renderHook(() => useCompleteSession(), { wrapper })
    await act(async () => void (await result.current.mutateAsync({ id: 's1', note: null })))
    expect(queued(), 'the finish waits behind the log it could not send').toEqual(['upsert v2_set_logs:l1', 'upsert v2_sessions:s1'])
    const finish = queue().find((q) => q.table === 'v2_sessions')!
    expect(finish.operation).toBe('upsert')
    expect(finish.recomputeFinish).toBe(true)
    expect(server.requests).toEqual([])
  })
})

// ─── The runner: it sends when the check turns to ok ────────────────────────────────────────────────────────────────────────────────────────────

describe('the runner sends when the check turns to ok, from unread or from blocked, and not otherwise', () => {
  it('unread at mount: the pass at mount is held; when the status answers ok the queue is sent, once', async () => {
    upsertLog('l1')
    upsertLog('l2')
    let answer!: () => void
    world.statusGate = new Promise<void>((resolve) => (answer = resolve))
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await settle()
    expect(server.requests, 'unread: nothing is sent').toEqual([])
    expect(world.statusReads).toBe(1)

    answer()
    await waitFor(() => expect(queue()).toEqual([]))
    expect(requestsOf(), 'each write once, in order').toEqual(['upsert v2_set_logs:l1', 'upsert v2_set_logs:l2'])
  })

  it('unread at mount, and the status answers blocked: nothing is ever sent', async () => {
    upsertLog('l1')
    world.status = { ...STATUS_REQUIRES_1_2_2 }
    let answer!: () => void
    world.statusGate = new Promise<void>((resolve) => (answer = resolve))
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await settle()
    answer()
    await settle()
    expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ minVersion: '1.2.2' })
    expect(server.requests).toEqual([])
    expect(queued()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('blocked, then min_version goes back down (a read finds it ok): the queue is sent by the pass that follows', async () => {
    upsertLog('l1')
    world.status = { ...STATUS_REQUIRES_1_2_2 }
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await waitFor(() => expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ minVersion: '1.2.2' }))
    await settle()
    expect(server.requests).toEqual([])

    world.status = { ...STATUS_ALLOWS_1_2_1 }
    await act(async () => void (await queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })))
    await waitFor(() => expect(queue()).toEqual([]))
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('ok at mount: the pass at mount sends, and a later read that is ok again sends nothing more', async () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    upsertLog('l1')
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await waitFor(() => expect(queue()).toEqual([]))
    upsertLog('l2') // queued after the pass; only a pass sends it
    await act(async () => void (await queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })))
    await settle()
    expect(requestsOf(), 'a read that finds the same answer starts no pass').toEqual(['upsert v2_set_logs:l1'])
    expect(queued()).toEqual(['upsert v2_set_logs:l2'])
  })
})

// ─── 73-2: an 'ok' from before an offline stretch ────────────────────────────────────────────────────────────────────────────────────────────────

describe('73-2: ok → offline → a write is queued → min_version is raised → back online: nothing is sent until a read made after the return answers', () => {
  async function offlineStretch() {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    const view = renderHook(() => useSyncQueueRunner(), { wrapper })
    await waitFor(() => expect(world.statusReads).toBe(1)) // the read at start: ok
    await settle()
    act(() => onlineManager.setOnline(false))
    world.online = false
    view.rerender()
    upsertLog('l1') // logged offline
    world.status = { ...STATUS_REQUIRES_1_2_2 } // a release raised min_version while the phone was away
    let answer!: () => void
    world.statusGate = new Promise<void>((resolve) => (answer = resolve)) // the read after the return takes a moment
    return { view, answer: () => answer() }
  }

  it('the stale ok is not enough: the return starts a pass, the pass is held, and the read that answers blocked keeps it held', async () => {
    const { view, answer } = await offlineStretch()
    expect(queryClient.getQueryData(APP_STATUS_KEY), 'the cache still holds the old ok').toMatchObject({ minVersion: '1.2.1' })

    act(() => onlineManager.setOnline(true))
    world.online = true
    view.rerender() // the runner's pass at the return
    await settle()
    expect(server.requests, 'the old ok predates the return: no request while the fresh read is out').toEqual([])
    expect(world.statusReads, 'the fresh read was asked for').toBeGreaterThanOrEqual(2)

    answer()
    await waitFor(() => expect(queryClient.getQueryData(APP_STATUS_KEY)).toMatchObject({ minVersion: '1.2.2' }))
    await settle()
    expect(server.requests, 'the fresh read says blocked: still nothing').toEqual([])
    expect(queued()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('control: the same stretch with a release that did not raise min_version sends the write once the fresh read answers ok', async () => {
    const { view, answer } = await offlineStretch()
    world.status = { ...STATUS_ALLOWS_1_2_1 }
    act(() => onlineManager.setOnline(true))
    world.online = true
    view.rerender()
    await settle()
    expect(server.requests, 'held until the fresh read answers').toEqual([])
    answer()
    await waitFor(() => expect(queue()).toEqual([]))
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('an app opened offline (TanStack was never told it was offline) reads the status itself when the phone returns, without waiting for the minute', async () => {
    world.online = false
    world.statusFails = true // opened offline: the read cannot reach the server
    upsertLog('l1')
    const view = renderHook(() => useSyncQueueRunner(), { wrapper })
    await settle()
    expect(world.statusReads).toBeGreaterThanOrEqual(1)
    expect(server.requests).toEqual([])
    const readsBefore = world.statusReads

    world.statusFails = false
    world.online = true // the window's `online` event reaches the hook; TanStack, which never saw the phone go offline, does nothing
    view.rerender()
    await waitFor(() => expect(queue()).toEqual([]))
    expect(world.statusReads, 'one more read, asked for by the runner at the return').toBe(readsBefore + 1)
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
  })
})

// ─── 73-3: a status read that fails ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('73-3: with no answer, online and writes queued, the status is read again every minute', () => {
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('a read that fails holds the queue; the minute read finds the server back and the queue is sent, a minute after the failure rather than an hour', async () => {
    vi.useFakeTimers()
    world.statusFails = true
    upsertLog('l1')
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await advance(0)
    expect(world.statusReads, 'the read at start failed').toBe(1)
    expect(server.requests).toEqual([])

    world.statusFails = false
    await advance(GATE_POLL_MS - 1)
    expect(world.statusReads, 'not before the minute').toBe(1)
    await advance(1)
    expect(world.statusReads, 'the minute read').toBe(2)
    await advance(0)
    expect(queue(), 'it answered ok: the queue went').toEqual([])
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('and again the minute after, for as long as it keeps failing', async () => {
    vi.useFakeTimers()
    world.statusFails = true
    upsertLog('l1')
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await advance(0)
    await advance(GATE_POLL_MS * 3)
    expect(world.statusReads).toBe(4)
    expect(queued()).toEqual(['upsert v2_set_logs:l1'])
  })

  it('control: an empty queue has nothing to hold, so the minute reads nothing (the hourly read is the status hook\'s)', async () => {
    vi.useFakeTimers()
    world.statusFails = true
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await advance(0)
    await advance(GATE_POLL_MS * 5)
    expect(world.statusReads).toBe(1)
  })

  it('control: offline, nothing is read (and the phone cannot)', async () => {
    vi.useFakeTimers()
    world.online = false
    world.statusFails = true
    upsertLog('l1')
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await advance(0)
    const reads = world.statusReads
    await advance(GATE_POLL_MS * 5)
    expect(world.statusReads).toBe(reads)
  })

  it('control: once the check has answered ok the minute stops: no read, however long the queue is held for another reason', async () => {
    vi.useFakeTimers()
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    server.maintenance = true // every write is refused OL001, so the queue stays
    upsertLog('l1')
    renderHook(() => useSyncQueueRunner(), { wrapper })
    await advance(0)
    const reads = world.statusReads
    await advance(GATE_POLL_MS * 5)
    expect(world.statusReads, 'the status hook reads at the hour, not by the minute').toBe(reads)
  })
})

// ─── A pass that has begun ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a pass already running stops sending once the check says blocked', () => {
  it('the request in flight finishes; the writes after it are not sent and stay queued', async () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    upsertLog('l1')
    upsertLog('l2')
    upsertLog('l3')
    const held = server.hold('upsert v2_set_logs:l1')
    const pass = flushSyncQueue()
    await held.reached
    // the read that finds min_version raised lands while the first request is out
    act(() => void queryClient.setQueryData(APP_STATUS_KEY, STATUS_REQUIRES_1_2_2))
    held.release()
    await pass

    expect(requestsOf(), 'only the one that was already on its way').toEqual(['upsert v2_set_logs:l1'])
    expect(queued()).toEqual(['upsert v2_set_logs:l2', 'upsert v2_set_logs:l3'])
  })

  it('a pass asked for while one runs is not started once the check says blocked', async () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    upsertLog('l1')
    const held = server.hold('upsert v2_set_logs:l1')
    const first = flushSyncQueue()
    await held.reached
    upsertLog('l2') // queued meanwhile
    const second = flushSyncQueue() // joins the running pass and asks for one more
    act(() => void queryClient.setQueryData(APP_STATUS_KEY, STATUS_REQUIRES_1_2_2))
    held.release()
    await Promise.all([first, second])
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
    expect(queued()).toEqual(['upsert v2_set_logs:l2'])
  })

  it('and that pass does not even begin: it would cancel a never-sent pair queued meanwhile, which a held call leaves alone', async () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    upsertLog('l1')
    const held = server.hold('upsert v2_set_logs:l1')
    const first = flushSyncQueue()
    await held.reached
    upsertLog('l2') // queued meanwhile, with its delete: only a pass cancels the pair
    put({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'l2' }, sessionId: 's1' })
    const second = flushSyncQueue()
    act(() => void queryClient.setQueryData(APP_STATUS_KEY, STATUS_REQUIRES_1_2_2))
    held.release()
    await Promise.all([first, second])
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1'])
    expect(queued()).toEqual(['upsert v2_set_logs:l2', 'delete v2_set_logs:l2'])
  })

  it('control: with the answer still ok the same two calls send both, in two passes', async () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    upsertLog('l1')
    const held = server.hold('upsert v2_set_logs:l1')
    const first = flushSyncQueue()
    await held.reached
    upsertLog('l2')
    const second = flushSyncQueue()
    held.release()
    await Promise.all([first, second])
    expect(requestsOf()).toEqual(['upsert v2_set_logs:l1', 'upsert v2_set_logs:l2'])
    expect(queue()).toEqual([])
  })
})
