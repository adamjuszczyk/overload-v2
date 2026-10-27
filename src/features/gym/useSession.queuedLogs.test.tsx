// @vitest-environment jsdom
// DECISIONS 239 (queue-fix 230's review, executed on staging; RC37 of the release checklist; older than 1.2): a set logged OFFLINE whose first send fails read as not logged once
// the session was read again, and LOG pressed on it wrote it a second time. `flushOnce` ends every pass by reading the session again (`invalidateQueries(['v2_session'])`), and
// `fetchSession` reads the server alone: the log, still queued on this phone, was drawn open (empty boxes, LOG, the current set), also after a reload. The workout's read of its
// session (`useActiveSession`, `readActiveSession`) now also draws the set logs this phone has queued and not yet sent.
//
// These run on the real producers (`useLogSet`'s offline branch, `queueSetLogDelete`, `queueSetLogPatch`), the real `flushSyncQueue` and the real `useActiveSession` / `fetchSession`
// mapper, against the queue-fix 230 server (`queueServer.testutil.ts`: it keeps the rows, refuses a row naming a parent it does not hold, fails a request as many times as a test says, and
// answers the session read with its logs embedded). The device's database applies a write on a later tick and returns copies (chunk 57's fakes). Every case has another log of the same
// queue, and the queue is the same after the read as before it: a read drops, holds and sends nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueueServer } from '../offline/queueServer.testutil'

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
const world = vi.hoisted(() => ({ online: false, queue: [] as unknown[], nextId: 1 }))
const queue = () => world.queue as QueueItem[]
const server = new QueueServer()
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      // Dexie hands back copies, not the objects it stores, and a write lands on a later tick (RULES.md, chunk 57's review).
      orderBy: () => ({
        toArray: async () => {
          await tick()
          return structuredClone([...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id))
        },
      }),
      toArray: async () => structuredClone([...queue()]),
      add: async (item: Omit<QueueItem, 'id'>) => {
        await tick()
        queue().push({ ...structuredClone(item), id: world.nextId++ })
      },
      delete: async (id: number) => {
        await tick()
        world.queue = queue().filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        await tick()
        world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
    },
    set_logs: { put: async () => {}, update: async () => 1, delete: async () => {} },
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => server.query(table) } }))

const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, queueSetLogDelete, queueSetLogPatch, MAX_SYNC_ATTEMPTS } = await import('../offline/useSyncQueue')
const { useOfflineStore } = await import('../offline/offlineStore')
const { useLogSet, useActiveSession, readActiveSession } = await import('./useSession')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  world.online = false
  world.queue = []
  world.nextId = 1
  server.reset()
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}) // the queue logs each failed attempt
  // The account's world on the server: one exercise (a full row, so a log the server returns carries it joined), two sessions in progress.
  server.put('exercises', {
    id: 'bench', user_id: 'u1', name: 'Bench Press', muscle_group: 'chest', is_archived: false, created_at: '2026-01-01T00:00:00Z', muscle_subgroup: null,
    movement_pattern: null, status: 'active', source_library_id: null, lost_at: null,
  })
  for (const id of ['p1', 'p2', 'p9']) server.put('v2_week_plan_sets', { id }) // the planned sets the logs name (a log naming one the server lacks is refused 23503)
  for (const id of ['s1', 's2']) {
    server.put('v2_sessions', {
      id, user_id: 'u1', mesocycle_id: null, week_plan_id: null, workout_day_id: null, date: '2026-10-26', status: 'in_progress', note: null, started_at: '2026-10-26T18:00:00Z',
      completed_at: null, created_at: '2026-10-26T18:00:00Z', moved_to_date: null,
    })
  }
})
afterEach(() => {
  cleanup()
  errorLog.mockRestore()
})

let clock = 0
const logParams = (id: string, extra: Record<string, unknown> = {}) => ({
  id, exerciseId: 'bench', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null, isDropset: false, parentSetId: null, stageIndex: 0,
  isSkipped: false, restSeconds: null, setSeconds: null, enteredUnit: null, formRating: null, stageKind: null, ...extra,
})
/** LOG with the phone offline: `useLogSet`'s offline branch queues the log's upsert (and the screen's copy gets it at once, `onMutate`). Each log is logged a moment after the one before. */
async function logOffline(sessionId: string, id: string, extra: Record<string, unknown> = {}) {
  world.online = false
  const hook = renderHook(() => useLogSet(sessionId), { wrapper })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3 + (clock++ % 2)))
    await hook.result.current.mutateAsync(logParams(id, extra))
  })
  hook.unmount()
}
const mount = (sessionId: string) => renderHook(() => useActiveSession(sessionId), { wrapper })
const idsOf = (view: ReturnType<typeof mount>) => (view.result.current.data?.setLogs ?? []).map((log) => log.id)
const logOf = (view: ReturnType<typeof mount>, id: string) => view.result.current.data?.setLogs?.find((log) => log.id === id)
const queued = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map((q) => `${q.operation} ${q.table}:${q.payload.id as string}${q.attempts ? ` attempts=${q.attempts}` : ''}`)
const pass = () => act(async () => void (await flushSyncQueue()))
/** The reads that come after a pass (the invalidation), settled. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await tick()
  })
}

describe('a set logged offline whose first send fails is still in the session the screen reads (DECISIONS 239)', () => {
  it('after the pass that failed it, after the pass that sent it, and with another log of the same queue landing in the first: the queue is the same after every read', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1', setNumber: 1 })
    await logOffline('s1', 'M', { weekPlanSetId: 'p2', setNumber: 2 })
    expect(idsOf(view)).toEqual(['L1', 'M']) // the offline LOG's own copy on the screen

    world.online = true
    server.failing.set('upsert v2_set_logs:L1', 1) // the reconnect pass's first send of L1 fails; the session's reads go through
    const before = queued()
    await pass()
    await settle()
    // The pass sent M and not L1; the session was read again after it (the server holds M only).
    expect(server.ids('v2_set_logs')).toEqual(['M'])
    expect(server.requests.filter((r) => r.startsWith('select v2_sessions:s1')).length).toBeGreaterThan(0)
    expect(idsOf(view)).toEqual(['L1', 'M']) // L1 is still a logged set on the screen: once, in its place
    expect(logOf(view, 'L1')).toMatchObject({ weekPlanSetId: 'p1', setNumber: 1, weight: 60, reps: 8, exerciseId: 'bench', sessionId: 's1' })
    expect(logOf(view, 'M')?.exercise?.name).toBe('Bench Press') // M is the server's own row (the exercise joined)
    expect(logOf(view, 'L1')?.exercise).toBeUndefined() // L1 is the queue's: the server has never seen it
    // marked SYNC, as the offline LOG drew it: pending for L1 only
    expect([...useOfflineStore.getState().pendingIds]).toEqual(['L1'])
    // the read changed nothing in the queue: the failed upsert is still there, once, with its one failed attempt
    expect(queued()).toEqual(['upsert v2_set_logs:L1 attempts=1'])
    expect(before).toEqual(['upsert v2_set_logs:L1', 'upsert v2_set_logs:M'])

    await pass() // the next pass sends L1
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['L1', 'M'])
    expect(queued()).toEqual([])
    expect(idsOf(view)).toEqual(['L1', 'M']) // still once each
    expect(logOf(view, 'L1')?.exercise?.name).toBe('Bench Press') // now the server's own row
    expect(useOfflineStore.getState().pendingIds.size).toBe(0)
    expect(server.refused).toEqual([])
  })

  it('when the phone reconnects the session is read at once (TanStack), before any send: the log made offline does not leave the screen', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    await logOffline('s1', 'M', { weekPlanSetId: 'p2', setNumber: 2 })
    world.online = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['v2_session', 's1'] })
    })
    await settle() // TanStack tells its observers on a later tick
    expect(server.ids('v2_set_logs')).toEqual([]) // nothing was sent
    expect(idsOf(view)).toEqual(['L1', 'M'])
    expect(queued()).toEqual(['upsert v2_set_logs:L1', 'upsert v2_set_logs:M'])
  })

  it('a reload (the page\'s memory gone, the queue kept) reads the session with the log in it, also while every pass fails: it stays drawn, marked as one that could not sync', async () => {
    const first = mount('s1')
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    world.online = true
    server.failing.set('upsert v2_set_logs:L1', MAX_SYNC_ATTEMPTS + 2)
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i += 1) await pass()
    await settle()
    expect(queue()[0]).toMatchObject({ attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })
    expect(useOfflineStore.getState().failedIds.has('L1')).toBe(true)
    first.unmount()
    queryClient.clear() // the reload
    useOfflineStore.setState({ pendingIds: new Set(['L1']) }) // what `useSyncQueueInit` restores from the queue
    const reloaded = mount('s1')
    await waitFor(() => expect(reloaded.result.current.data).toBeDefined())
    expect(server.ids('v2_set_logs')).toEqual([])
    expect(idsOf(reloaded)).toEqual(['L1'])
    expect(queued()).toEqual([`upsert v2_set_logs:L1 attempts=${MAX_SYNC_ATTEMPTS}`])
  })

  it('with the session\'s reads failing too the screen keeps the log it had (RC37\'s other shape); it is not a case the merge is needed for', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    world.online = true
    server.failing.set('upsert v2_set_logs:L1', 1)
    server.failing.set('select v2_sessions:s1', 3)
    await pass()
    await settle()
    expect(idsOf(view)).toEqual(['L1'])
  })

  it('an ADDED set (RC37\'s shape: no planned set, a place among the sets added to its exercise) keeps its place and its type while it is only in the queue', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'A1', { weekPlanSetId: null, setNumber: 8, addedPlace: 6, weight: 34.5, reps: 6, stageKind: 'dropset' })
    world.online = true
    server.failing.set('upsert v2_set_logs:A1', 1)
    await pass()
    await settle()
    expect(server.ids('v2_set_logs')).toEqual([])
    expect(logOf(view, 'A1')).toMatchObject({ weekPlanSetId: null, setNumber: 8, addedPlace: 6, weight: 34.5, reps: 6, stageKind: 'dropset', isWarmup: false, isDropset: false })
    await pass()
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['A1']) // once
    expect(server.get('v2_set_logs', 'A1')).toMatchObject({ added_place: 6 })
    expect(idsOf(view)).toEqual(['A1'])
  })

  it('a log the server already holds is not added a second time: the server\'s row is the one drawn (a reply lost on a locked phone leaves the upsert queued)', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    server.put('v2_set_logs', { ...(queue()[0].payload as Record<string, unknown>), weight: 61 }) // the server got it, the reply was lost
    queue()[0].sendStarted = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['v2_session', 's1'] })
    })
    await settle() // TanStack tells its observers on a later tick
    expect(idsOf(view)).toEqual(['L1'])
    expect(logOf(view, 'L1')?.weight).toBe(61) // the server's copy wins
    expect(logOf(view, 'L1')?.exercise?.name).toBe('Bench Press')
  })

  it('a log with its own delete queued (UNLOG or DELETE offline, the pair not yet cancelled by a pass) is not drawn; the other logs still are', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    await logOffline('s1', 'M', { weekPlanSetId: 'p2', setNumber: 2 })
    await act(async () => {
      await queueSetLogDelete({ id: 'L1', sessionId: 's1' })
      await queryClient.refetchQueries({ queryKey: ['v2_session', 's1'] })
    })
    await settle()
    expect(idsOf(view)).toEqual(['M'])
    expect(queued()).toEqual(['upsert v2_set_logs:L1', 'upsert v2_set_logs:M', 'delete v2_set_logs:L1'])
  })

  it('a renumber queued for the log (a patch behind its upsert) is the number the screen reads', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1', setNumber: 3 })
    await act(async () => {
      expect(await queueSetLogPatch({ id: 'L1', sessionId: 's1' }, 2)).toBe(true)
      await queryClient.refetchQueries({ queryKey: ['v2_session', 's1'] })
    })
    await settle()
    expect(logOf(view, 'L1')?.setNumber).toBe(2)
    expect(queue().map((q) => q.operation)).toEqual(['upsert', 'patch'])
  })

  it('only this session\'s logs are drawn, and an item of the queue that is not a log of the shape the screen draws never stops the read', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    await logOffline('s2', 'X', { weekPlanSetId: 'p9' }) // another session's, in the same queue
    queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'bad', session_id: 's1' }, createdAt: new Date().toISOString() }) // damaged: no time, no exercise
    queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'bad2', session_id: 's1', user_id: 'u1', exercise_id: 'bench', set_number: 1 }, createdAt: new Date().toISOString() }) // no logged_at
    queue().push({ id: world.nextId++, table: 'v2_coach_notes', operation: 'upsert', payload: { id: 'n1', session_id: 's1', body: 'x' }, createdAt: new Date().toISOString() }) // not a log
    // a log with only the columns a log cannot be drawn without (an older producer's, say), two of the others held as `undefined` (a structured clone keeps them): drawn, with the nullable columns null and the flags off
    queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'sparse', session_id: 's1', user_id: 'u1', exercise_id: 'bench', set_number: 4, logged_at: '2026-10-26T18:30:00Z', weight: undefined, note: undefined }, createdAt: new Date().toISOString() })
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['v2_session', 's1'] })
    })
    await settle() // TanStack tells its observers on a later tick
    expect(view.result.current.isError).toBe(false)
    expect(idsOf(view).sort()).toEqual(['L1', 'sparse'])
    expect(logOf(view, 'sparse')).toMatchObject({
      weight: null, reps: null, rir: null, note: null, weekPlanSetId: null, parentSetId: null, restSeconds: null, isDropset: false, isSkipped: false,
    })
    const other = mount('s2')
    await waitFor(() => expect(other.result.current.data).toBeDefined())
    expect(idsOf(other)).toEqual(['X'])
  })

  it('the queue is read before the server is asked: a pass that sends the log and clears it while the request is out cannot leave it in neither', async () => {
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    world.online = true
    // The reply is the server as it was when the request arrived (no L1); the pass that sends L1 lands before the reply does.
    server.onSessionRead = async () => {
      server.onSessionRead = null
      await flushSyncQueue()
    }
    const session = await readActiveSession('s1')
    expect(server.ids('v2_set_logs')).toEqual(['L1'])
    expect(queued()).toEqual([])
    expect(session.setLogs?.map((log) => log.id)).toEqual(['L1'])
  })

  it('a queue that can\'t be read leaves the server\'s answer as it was: the read of the session does not fail because of the phone\'s database', async () => {
    server.put('v2_set_logs', { id: 'S', user_id: 'u1', session_id: 's1', exercise_id: 'bench', week_plan_set_id: null, set_number: 1, weight: 50, reps: 5, logged_at: '2026-10-26T18:05:00Z', is_skipped: false, is_dropset: false })
    const { db } = await import('../../lib/db')
    const spy = vi.spyOn(db.sync_queue, 'orderBy').mockImplementation(() => {
      throw new Error('UnknownError')
    })
    try {
      const session = await readActiveSession('s1')
      expect(session.setLogs?.map((log) => log.id)).toEqual(['S'])
    } finally {
      spy.mockRestore()
    }
  })
})
