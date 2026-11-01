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
//
// Chunk 80 adds three groups at the end of this file, which share the fakes above: the logs the SERVER holds that this phone has queued a delete or a patch for (DECISIONS 243: an UNLOG,
// a DELETE or a renumber offline reads as done at once), the deletion records this phone has queued (DECISIONS 269 (a), SPEC.md 1.2.1 Rules 6's third line: a planned set deleted offline stays
// hidden), and the Library's preflight (`queuedSetsNamingExercise`, DECISIONS 238 (1)), which counts the queue's logs by the rule the pass cancels pairs by.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { versionCheckAnswers } from '../release/versionGate.testutil'
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
const { flushSyncQueue, queueSetLogDelete, queueSetLogPatch, queueSetLogStageKindClear, queuedSetsNamingExercise, MAX_SYNC_ATTEMPTS } = await import('../offline/useSyncQueue')
const { useOfflineStore } = await import('../offline/offlineStore')
const { useLogSet, useActiveSession, readActiveSession } = await import('./useSession')
const { writeSetChanges } = await import('./useSessionSetChanges')
const { previewExerciseDelete, deleteExercise } = await import('../library/exerciseService')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  world.online = false
  world.queue = []
  world.nextId = 1
  server.reset()
  queryClient.clear()
  versionCheckAnswers() // the version check has answered: this version may send the queue (chunk 73)
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
    versionCheckAnswers() // and the new run's first read of the status has answered
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

// ─── Chunk 80 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const T1 = '2026-01-05T10:05:00Z'
const T2 = '2026-01-05T10:10:00Z'
const T3 = '2026-01-05T10:20:00Z'
/** A log the SERVER holds in session s1 (a full row, as the table keeps it). */
const serverLog = (id: string, extra: Record<string, unknown> = {}) =>
  server.put('v2_set_logs', {
    id, user_id: 'u1', session_id: 's1', exercise_id: 'bench', week_plan_set_id: null, set_number: 1, weight: 50, reps: 5, rir: null, note: null, is_dropset: false, parent_set_id: null,
    stage_index: 0, is_skipped: false, logged_at: T1, rest_seconds: null, ...extra,
  })
/** A change row the SERVER holds in session s1. */
const serverChange = (id: string, extra: Record<string, unknown> = {}) =>
  server.put('v2_session_set_changes', {
    id, user_id: 'u1', session_id: 's1', kind: 'retyped', week_plan_set_id: 'p1', set_log_id: null, is_warmup: true, stage_kind: null, stage_count: 0, created_at: T1, updated_at: T1, ...extra,
  })
const numbersOf = (view: ReturnType<typeof mount>) => Object.fromEntries((view.result.current.data?.setLogs ?? []).map((log) => [log.id, log.setNumber]))
/** The session's change rows as the rules read them: `<kind> <planned set or log>`. */
const changesOf = (session: { setChanges?: ReadonlyArray<{ kind: string; weekPlanSetId?: string; setLogId?: string }> } | undefined) =>
  (session?.setChanges ?? []).map((change) => `${change.kind} ${change.weekPlanSetId ?? change.setLogId ?? '?'}`)
const putExercise = (id: string) =>
  server.put('exercises', { id, user_id: 'u1', name: id, muscle_group: 'chest', is_archived: false, created_at: '2026-01-01T00:00:00Z', muscle_subgroup: null, movement_pattern: null, status: 'active', source_library_id: null, lost_at: null })

describe('a log the server holds, with a delete or a renumber of it queued on this phone, reads as deleted or renumbered at once (DECISIONS 243)', () => {
  it('an UNLOG or DELETE offline whose first send fails: the log is gone from the read that follows the pass, the queue is as the pass left it, and the other write of the queue still goes', async () => {
    serverLog('S1', { week_plan_set_id: 'p1', set_number: 1, logged_at: T1 })
    serverLog('S2', { week_plan_set_id: 'p2', set_number: 2, logged_at: T2 })
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    expect(idsOf(view)).toEqual(['S1', 'S2'])
    await logOffline('s1', 'M', { weekPlanSetId: 'p9', setNumber: 3 }) // another write of the same queue: it goes in the same pass
    await act(async () => void (await queueSetLogDelete({ id: 'S1', sessionId: 's1' })))
    world.online = true
    server.failing.set('delete v2_set_logs:S1', 1)
    await pass()
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['M', 'S1', 'S2']) // M went; the server still holds S1
    expect(queued()).toEqual(['delete v2_set_logs:S1 attempts=1'])
    expect(idsOf(view)).toEqual(['S2', 'M']) // S1 is gone at once; M is the server's own row now

    await pass() // the next pass deletes it
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['M', 'S2'])
    expect(queued()).toEqual([])
    expect(idsOf(view)).toEqual(['S2', 'M'])
  })

  it('a renumber queued for a log the server holds is the number the read draws; a renumber that went through is the server\'s own', async () => {
    serverLog('S1', { week_plan_set_id: 'p1', set_number: 1, logged_at: T1 })
    serverLog('S2', { week_plan_set_id: 'p2', set_number: 2, logged_at: T2 })
    serverLog('S3', { week_plan_set_id: 'p9', set_number: 3, logged_at: T3 })
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await act(async () => {
      await queueSetLogDelete({ id: 'S1', sessionId: 's1' }) // DELETE of set 1: the sets after it are renumbered
      expect(await queueSetLogPatch({ id: 'S2', sessionId: 's1' }, 1)).toBe(true)
      expect(await queueSetLogPatch({ id: 'S3', sessionId: 's1' }, 2)).toBe(true)
    })
    world.online = true
    server.failing.set('delete v2_set_logs:S1', 1)
    server.failing.set('patch v2_set_logs:S2', 1)
    await pass()
    await settle()
    expect(server.get('v2_set_logs', 'S2')).toMatchObject({ set_number: 2 }) // its patch failed once
    expect(server.get('v2_set_logs', 'S3')).toMatchObject({ set_number: 2 }) // its patch went
    expect(queued()).toEqual(['delete v2_set_logs:S1 attempts=1', 'patch v2_set_logs:S2 attempts=1'])
    expect(idsOf(view)).toEqual(['S2', 'S3'])
    expect(numbersOf(view)).toEqual({ S2: 1, S3: 2 }) // S2 the queued number, S3 the server's

    await pass()
    await settle()
    expect(queued()).toEqual([])
    expect(numbersOf(view)).toEqual({ S2: 1, S3: 2 })
  })

  it('a head that lost its last drop offline (the drop\'s delete queued, the head\'s stage-kind patch behind it) reads as a normal set without the drop', async () => {
    serverLog('H', { week_plan_set_id: 'p1', set_number: 1, stage_kind: 'dropset', logged_at: T1 })
    serverLog('D', { week_plan_set_id: null, parent_set_id: 'H', stage_index: 1, set_number: 1, logged_at: T2 })
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    expect(logOf(view, 'H')?.stageKind).toBe('dropset')
    await act(async () => {
      await queueSetLogDelete({ id: 'D', sessionId: 's1', parentSetId: 'H' })
      await queueSetLogStageKindClear({ id: 'H', sessionId: 's1' })
    })
    world.online = true
    server.failing.set('delete v2_set_logs:D', 1)
    await pass()
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['D', 'H']) // nothing went: the drop's delete failed once and the head's patch waits behind it
    expect(queued()).toEqual(['delete v2_set_logs:D attempts=1', 'patch v2_set_logs:H'])
    expect(idsOf(view)).toEqual(['H'])
    expect(logOf(view, 'H')?.stageKind).toBeNull()

    await pass()
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['H'])
    expect(server.get('v2_set_logs', 'H')).toMatchObject({ stage_kind: null })
    expect(queued()).toEqual([])
    expect(logOf(view, 'H')?.stageKind).toBeNull()
  })

  it('an UNLOG and a re-LOG of one set offline: the log the server holds is gone, the new one is there once', async () => {
    serverLog('S1', { week_plan_set_id: 'p1', set_number: 1, logged_at: T1 })
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await act(async () => void (await queueSetLogDelete({ id: 'S1', sessionId: 's1' })))
    await logOffline('s1', 'R1', { weekPlanSetId: 'p1' })
    world.online = true
    server.failing.set('delete v2_set_logs:S1', 1)
    server.failing.set('upsert v2_set_logs:R1', 1)
    await pass()
    await settle()
    expect(queued()).toEqual(['delete v2_set_logs:S1 attempts=1', 'upsert v2_set_logs:R1 attempts=1'])
    expect(idsOf(view)).toEqual(['R1']) // the upsert's row only
    expect(logOf(view, 'R1')).toMatchObject({ weekPlanSetId: 'p1' })

    await pass()
    await settle()
    expect(server.ids('v2_set_logs')).toEqual(['R1'])
    expect(queued()).toEqual([])
    expect(idsOf(view)).toEqual(['R1'])
  })

  it('the merge keeps the logs in loggedAt order: a queued log between two the server holds, the one before it deleted, the one after it renumbered', async () => {
    serverLog('S1', { week_plan_set_id: 'p1', set_number: 1, logged_at: T1 })
    serverLog('S2', { week_plan_set_id: 'p2', set_number: 2, logged_at: T2 })
    serverLog('S3', { week_plan_set_id: 'p9', set_number: 3, logged_at: T3 })
    // a log queued on this phone that the server has not seen, logged between S2 and S3
    queue().push({
      id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', createdAt: new Date().toISOString(),
      payload: { id: 'Q', user_id: 'u1', session_id: 's1', exercise_id: 'bench', week_plan_set_id: null, set_number: 4, weight: 40, reps: 5, logged_at: '2026-01-05T10:15:00Z' },
    })
    await queueSetLogDelete({ id: 'S2', sessionId: 's1' })
    expect(await queueSetLogPatch({ id: 'S3', sessionId: 's1' }, 2)).toBe(true)
    const before = queued()
    const session = await readActiveSession('s1')
    expect(session.setLogs?.map((log) => log.id)).toEqual(['S1', 'Q', 'S3'])
    expect(session.setLogs?.map((log) => log.setNumber)).toEqual([1, 4, 2])
    expect(queued()).toEqual(before) // the read drops, holds and sends nothing
  })
})

describe('a planned set deleted offline stays deleted in the workout\'s read (DECISIONS 269 (a); SPEC.md 1.2.1 Rules 6, third line)', () => {
  it('the deletion record is queued and its first send fails: the read after the pass still has the set deleted and the queue is as it was; the server\'s row says the same once it lands', async () => {
    const view = mount('s1')
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    await logOffline('s1', 'M', { weekPlanSetId: 'p2', setNumber: 2 }) // another write of the same queue
    await act(async () => {
      await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'p1' }, id: null }], online: false })
    })
    const rowId = queue().find((item) => item.table === 'v2_session_set_changes')!.payload.id as string
    await settle() // TanStack tells its observers on a later tick
    expect(changesOf(view.result.current.data)).toEqual(['deleted p1']) // the card's own copy, held at once

    world.online = true
    server.failing.set(`upsert v2_session_set_changes:${rowId}`, 1)
    await pass()
    await settle()
    expect(server.ids('v2_session_set_changes')).toEqual([]) // the row has not reached the server
    expect(server.ids('v2_set_logs')).toEqual(['M'])
    expect(queued()).toEqual([`upsert v2_session_set_changes:${rowId} attempts=1`])
    expect(changesOf(view.result.current.data)).toEqual(['deleted p1']) // and the read that followed the pass did not bring the set back as an open row

    await pass()
    await settle()
    expect(server.get('v2_session_set_changes', rowId)).toMatchObject({ kind: 'deleted', week_plan_set_id: 'p1' })
    expect(queued()).toEqual([])
    expect(changesOf(view.result.current.data)).toEqual(['deleted p1'])
  })

  it('a deletion record replaces the row the server holds for that planned set, by id (the same row written again) and by planned set (another id), as withChangeRecords matches them', async () => {
    serverChange('R1', { week_plan_set_id: 'p1', kind: 'retyped', is_warmup: true })
    serverChange('R2', { week_plan_set_id: 'p2', kind: 'retyped', is_warmup: true })
    expect(changesOf(await readActiveSession('s1'))).toEqual(['retyped p1', 'retyped p2'])
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'p1' }, id: 'R1' }], online: false }) // the writer's rule: the held row's id
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'p2' }, id: null }], online: false }) // a new id for a planned set a row is held for
    const before = queued()
    const session = await readActiveSession('s1')
    expect(changesOf(session)).toEqual(['deleted p1', 'deleted p2'])
    expect(session.setChanges?.find((change) => 'weekPlanSetId' in change && change.weekPlanSetId === 'p1')?.id).toBe('R1')
    expect(queued()).toEqual(before) // nothing in the queue changed
  })

  it('only this session\'s deletion records are applied: another session\'s record for the same planned set, a queued retyped row and a pending_stages row are not', async () => {
    await writeSetChanges({ sessionId: 's2', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'p1' }, id: null }], online: false }) // another session's
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'retyped', weekPlanSetId: 'p2', type: { kind: 'warmup' } }, id: null }], online: false })
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'pending_stages', setLogId: 'L1', stageKind: 'dropset', stageCount: 2 }, id: null }], online: false })
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'p9' }, id: null }], online: false })
    const before = queued()
    expect(before).toHaveLength(4)
    expect(changesOf(await readActiveSession('s1'))).toEqual(['deleted p9'])
    expect(changesOf(await readActiveSession('s2'))).toEqual(['deleted p1'])
    expect(queued()).toEqual(before)
  })
})

describe('the Library\'s preflight counts a log the next pass will send and leaves out only a pair the pass cancels (DECISIONS 238 (1))', () => {
  it('at the Library: an exercise whose only log was tried once and deleted offline is kept as lost, not deleted for good, and the log still lands', async () => {
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    world.online = true
    server.failing.set('upsert v2_set_logs:L1', 1)
    await pass() // L1's first send fails (one attempt)
    world.online = false
    await queueSetLogDelete({ id: 'L1', sessionId: 's1' }) // UNLOG, offline
    expect(await previewExerciseDelete('bench')).toMatchObject({ outcome: 'lost', setCount: 1 })
    expect(await deleteExercise('bench')).toBe('lost')
    expect(server.get('exercises', 'bench')).toMatchObject({ status: 'lost' })

    world.online = true
    await pass()
    expect(server.refused).toEqual([]) // the exercise is still there: neither the log nor its delete is refused 23503 for ever
    expect(server.ids('v2_set_logs')).toEqual([])
    expect(queued()).toEqual([])
  })

  it('at the Library: an exercise whose only log was logged and deleted before any send has no history: the pass cancels the pair, so the exercise is deleted for good', async () => {
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    await queueSetLogDelete({ id: 'L1', sessionId: 's1' })
    expect(await previewExerciseDelete('bench')).toEqual({ outcome: 'gone', setCount: 0, programNames: [] })
    world.online = true
    await pass()
    expect(server.requests.filter((r) => r.includes('v2_set_logs:L1'))).toEqual([]) // never sent
    expect(queued()).toEqual([])
  })

  it('AP1: a log whose upsert was tried once and failed, then deleted offline, is counted: the next pass sends it first and its delete after it', async () => {
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1' })
    await logOffline('s1', 'M', { weekPlanSetId: 'p2', setNumber: 2 }) // another log of the same exercise, with no delete
    world.online = true
    server.failing.set('upsert v2_set_logs:L1', 1)
    await pass() // L1's first send fails (marked as started, one attempt); M goes
    expect(queued()).toEqual(['upsert v2_set_logs:L1 attempts=1'])
    expect(queue()[0].sendStarted).toBe(true)
    world.online = false
    await queueSetLogDelete({ id: 'L1', sessionId: 's1' }) // UNLOG, offline
    expect(await queuedSetsNamingExercise('bench')).toBe(1)

    world.online = true
    await pass()
    expect(server.requests.filter((r) => r.includes('v2_set_logs:L1'))).toEqual(['upsert v2_set_logs:L1 -> network error', 'upsert v2_set_logs:L1 -> ok', 'delete v2_set_logs:L1 -> 1 row'])
    expect(server.ids('v2_set_logs')).toEqual(['M'])
    expect(await queuedSetsNamingExercise('bench')).toBe(0)
  })

  it('AP2: a log never sent, renumbered and then deleted offline, is counted: its upsert, then the renumber, then the delete are sent', async () => {
    await logOffline('s1', 'L1', { weekPlanSetId: 'p1', setNumber: 3 })
    expect(await queueSetLogPatch({ id: 'L1', sessionId: 's1' }, 2)).toBe(true)
    await queueSetLogDelete({ id: 'L1', sessionId: 's1' })
    expect(queued()).toEqual(['upsert v2_set_logs:L1', 'patch v2_set_logs:L1', 'delete v2_set_logs:L1'])
    expect(await queuedSetsNamingExercise('bench')).toBe(1)

    world.online = true
    await pass()
    expect(server.requests.filter((r) => r.includes('v2_set_logs:L1'))).toEqual(['upsert v2_set_logs:L1 -> ok', 'patch v2_set_logs:L1 {"set_number":2} -> 1 row', 'delete v2_set_logs:L1 -> 1 row'])
  })

  it('a never-sent pair (the upsert and its delete, nothing started or failed) is not counted and the pass sends neither; the other logs of the queue are counted, by exercise', async () => {
    putExercise('squat')
    await logOffline('s1', 'P1', { weekPlanSetId: 'p1' }) // bench, deleted before it was ever sent
    await queueSetLogDelete({ id: 'P1', sessionId: 's1' })
    await logOffline('s1', 'M', { weekPlanSetId: 'p2', setNumber: 2 }) // bench, no delete
    await logOffline('s1', 'Q', { exerciseId: 'squat' }) // another exercise
    expect(await queuedSetsNamingExercise('bench')).toBe(1)
    expect(await queuedSetsNamingExercise('squat')).toBe(1)
    expect(await queuedSetsNamingExercise('deadlift')).toBe(0)

    world.online = true
    await pass()
    expect(server.requests.filter((r) => r.includes('P1'))).toEqual([])
    expect(server.ids('v2_set_logs')).toEqual(['M', 'Q'])
  })

  it('the preflight and the pass read one rule: for each shape of a log\'s queued writes it counts the log exactly when the pass does not cancel it', async () => {
    let at = 0
    const stamp = () => new Date(Date.UTC(2026, 9, 26, 19, 0, 0, at++)).toISOString()
    const row = (id: string) => ({ id, user_id: 'u1', session_id: 's1', exercise_id: `x-${id}`, week_plan_set_id: null, set_number: 1, weight: 40, reps: 5, logged_at: '2026-01-05T10:30:00Z' })
    const upsert = (id: string, marks: Partial<QueueItem> = {}) => void queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', payload: row(id), createdAt: stamp(), ...marks })
    const patch = (id: string, changes: Record<string, unknown>) =>
      void queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'patch', payload: { id, ...changes }, createdAt: stamp(), sessionId: 's1' })
    const remove = (id: string) => void queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'delete', payload: { id }, createdAt: stamp(), sessionId: 's1' })
    // Each shape is one log with an exercise of its own: [its id, whether the pass sends it, how its writes sit in the queue].
    const shapes: Array<[string, boolean, () => void]> = [
      ['pair', false, () => { upsert('pair'); remove('pair') }],
      ['twice', false, () => { upsert('twice'); upsert('twice'); remove('twice') }],
      ['ap1', true, () => { upsert('ap1', { sendStarted: true, attempts: 1 }); remove('ap1') }],
      ['lost', true, () => { upsert('lost', { sendStarted: true }); remove('lost') }],
      ['ap2', true, () => { upsert('ap2'); patch('ap2', { set_number: 2 }); remove('ap2') }],
      ['kind', true, () => { upsert('kind'); patch('kind', { stage_kind: null }); remove('kind') }],
      ['gaveup', true, () => { upsert('gaveup', { sendStarted: true, attempts: MAX_SYNC_ATTEMPTS, gaveUp: true }); remove('gaveup') }],
      ['plain', true, () => upsert('plain')],
      ['late', true, () => { remove('late'); upsert('late') }],
      ['only', false, () => remove('only')],
    ]
    for (const [id, , build] of shapes) {
      putExercise(`x-${id}`)
      build()
    }
    const counted = await Promise.all(shapes.map(async ([id]) => (await queuedSetsNamingExercise(`x-${id}`)) === 1))
    expect(counted).toEqual(shapes.map(([, sent]) => sent)) // the table above

    world.online = true
    await pass()
    // A log reaches the server when the pass sent its upsert, or when its upsert waits in the queue (a write that gave up waits for RETRY).
    const reaches = (id: string) => server.requests.some((r) => r.startsWith(`upsert v2_set_logs:${id} `)) || queue().some((item) => item.operation === 'upsert' && item.payload.id === id)
    expect(shapes.map(([id]) => reaches(id))).toEqual(counted) // counted exactly when the pass does not cancel it
    expect(server.requests.filter((r) => r.includes('v2_set_logs:pair') || r.includes('v2_set_logs:twice'))).toEqual([]) // the two cancelled pairs: nothing was sent
  })
})
