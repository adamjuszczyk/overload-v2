// @vitest-environment jsdom
// Queue-fix 230 (DECISIONS 230, Adam 2026-10-27: "(a)"; found by queue-fix 227's builder and review, executed on master's own code: the cases that exist in 1.1 are in the
// update notes): a record the user deletes ONLINE while a write that names it still waits in the sync queue.
//   (i)   a log deleted online (DELETE, a dropset's delete, UNLOG) whose own first send had failed: its queued upsert created it again at the next pass;
//   (ii)  a session deleted in History: the queued logs, change rows and finish that name it were refused `23503` for ever (the server's cascade took theirs);
//   (iii) a planned set removed on Plan: the queued log that names it was refused `23503` for ever and never reached the server (the server keeps a log that got there first,
//         with no planned set), and a queued change row that names it the same;
//   and the Library's delete of an exercise whose only sets are still queued.
// These run on the real producers (`useLogSet`'s offline branch, `useCreateCoachNote`, `queueSetLogPatch`, `useDeleteSetLog`, `useDeleteSession`, Plan's `removeSet`, the Library's
// `deleteExercise`) and the real `flushSyncQueue`, against a server that models the keys the writes carry and what each delete does to a row that got there first
// (`queueServer.testutil.ts`). Every case has the writes of other records in the same queue, and asserts they went in the same pass and that only the writes naming the deleted
// record were dropped.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueueServer } from './queueServer.testutil'
import { card, headLog, orderOf, rowKeyed, viewOf } from '../gym/workoutRules.testutil'

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
const world = vi.hoisted(() => ({ online: false, queue: [] as unknown[], nextId: 1, queueDeleteFails: 0, deviceDeleted: [] as string[] }))
const queue = () => world.queue as QueueItem[]
const server = new QueueServer()

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      // Dexie hands back copies, not the objects it stores.
      orderBy: () => ({ toArray: async () => structuredClone([...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) }),
      toArray: async () => structuredClone([...queue()]),
      add: async (item: Omit<QueueItem, 'id'>) => void queue().push({ ...item, id: world.nextId++ }),
      delete: async (id: number) => {
        if (world.queueDeleteFails > 0) {
          world.queueDeleteFails--
          throw new Error('UnknownError')
        }
        world.queue = queue().filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => void (world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))),
    },
    // The device's own copies of logs: `delete` is noted so a test can say which copies went.
    set_logs: { delete: async (id: string) => void world.deviceDeleted.push(id), update: async () => {}, put: async () => {} },
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => server.query(table) } }))

const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, retrySyncFailures, hasQueuedWritesFor, queueSetLogPatch } = await import('./useSyncQueue')
const { useOfflineStore } = await import('./offlineStore')
const { useDeleteSetLog, useLogSet } = await import('../gym/useSession')
const { useDeleteSession } = await import('../history/useHistory')
const { useCreateCoachNote } = await import('../coach/useCoachNotes')
const { removeSet } = await import('../plan/weekPlanService')
const { previewExerciseDelete, deleteExercise } = await import('../library/exerciseService')
const { unlogEffects } = await import('../gym/workoutRules')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const describeItem = (q: QueueItem) => `${q.operation} ${q.table}:${q.payload.id as string}`
const queued = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map(describeItem)
const serverLogs = () => server.ids('v2_set_logs')
let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  world.online = false
  world.queue = []
  world.nextId = 1
  world.queueDeleteFails = 0
  world.deviceDeleted = []
  server.reset()
  queryClient.clear()
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}) // the queue logs each failed attempt
  // The account's world on the server: one exercise, two sessions in progress.
  server.put('exercises', { id: 'bench' })
  server.put('v2_sessions', { id: 's1', status: 'in_progress' })
  server.put('v2_sessions', { id: 's2', status: 'in_progress' })
})

const logParams = (id: string, extra: Record<string, unknown> = {}) => ({
  id, exerciseId: 'bench', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null, isDropset: false, parentSetId: null, stageIndex: 0,
  isSkipped: false, restSeconds: null, setSeconds: null, enteredUnit: null, formRating: null, stageKind: null, ...extra,
})
/** LOG with the phone offline: `useLogSet`'s offline branch queues the log's upsert. */
async function logOffline(sessionId: string, id: string, extra: Record<string, unknown> = {}) {
  world.online = false
  const hook = renderHook(() => useLogSet(sessionId), { wrapper })
  await act(async () => {
    await hook.result.current.mutateAsync(logParams(id, extra))
  })
}
/** A coach note written offline (`useCreateCoachNote`'s offline branch); the note's id is its queue item's. */
async function noteOffline(body: string, sessionId: string | null): Promise<string> {
  world.online = false
  const hook = renderHook(() => useCreateCoachNote(), { wrapper })
  let id = ''
  await act(async () => {
    id = (await hook.result.current.mutateAsync({ body, sessionId })).id
  })
  return id
}
/** The finish `useCompleteSession` queues behind a session's unsent sets (shape: `queueFinish`). */
async function finishQueued(sessionId: string) {
  queue().push({ id: world.nextId++, table: 'v2_sessions', operation: 'upsert', payload: { id: sessionId, status: 'completed', note: null }, createdAt: new Date().toISOString(), recomputeFinish: true })
}
/** A change row queued by 61/62 (`queueSetChange`): its payload names the session and, by kind, a planned set or a log. */
async function changeRowQueued(id: string, sessionId: string, names: { weekPlanSetId?: string; setLogId?: string }) {
  const kind = names.setLogId ? 'pending_stages' : 'retyped'
  queue().push({
    id: world.nextId++, table: 'v2_session_set_changes', operation: 'upsert', createdAt: new Date().toISOString(),
    payload: { id, user_id: 'u1', session_id: sessionId, kind, week_plan_set_id: names.weekPlanSetId ?? null, set_log_id: names.setLogId ?? null },
  })
}
/** What the screen does for DELETE and UNLOG of a log, online: the request, then (once it has gone through) the cleanup. */
async function deleteLogOnline(sessionId: string, id: string, parentSetId: string | null = null) {
  world.online = true
  const hook = renderHook(() => useDeleteSetLog(sessionId), { wrapper })
  await act(async () => {
    await hook.result.current.mutateAsync({ id, parentSetId })
  })
}
async function deleteSessionInHistory(id: string) {
  world.online = true
  const hook = renderHook(() => useDeleteSession(), { wrapper })
  await act(async () => {
    await hook.result.current.mutateAsync(id)
  })
}
const failFirstSend = (...tags: string[]) => tags.forEach((tag) => server.failing.set(tag, 1))
/** The phone is online again and one pass runs: every send in `failFirstSend` fails, so what it names is still queued afterwards. */
async function reconnectPass() {
  world.online = true
  await flushSyncQueue()
}
const notice = () => useOfflineStore.getState().syncFailures.length

// ─── (i) a log deleted online while its own first send is queued ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('230 (i): a set deleted online after its first send failed does not come back', () => {
  async function bystanders() {
    await logOffline('s1', 'M', { setNumber: 2 }) // another log of the same session
    await logOffline('s2', 'N') // a log of another session
    const note = await noteOffline('tough one', null) // a coach note
    await queueSetLogPatch({ id: 'M', sessionId: 's1' }, 3) // a renumber of the other log
    await finishQueued('s1') // the session's finish
    return note
  }

  it('DELETE: the log’s upsert leaves the queue with the delete, every other write of the same queue stays and goes in the next pass; the set does not come back', async () => {
    await logOffline('s1', 'L')
    const note = await bystanders()
    failFirstSend('upsert v2_set_logs:L', 'upsert v2_set_logs:M', 'upsert v2_set_logs:N', `upsert v2_coach_notes:${note}`)
    await reconnectPass()
    expect(queued()).toEqual(['upsert v2_set_logs:L', 'upsert v2_set_logs:M', 'upsert v2_set_logs:N', `upsert v2_coach_notes:${note}`, 'patch v2_set_logs:M'])

    await deleteLogOnline('s1', 'L')

    expect(server.requests[server.requests.length - 1]).toBe('delete v2_set_logs:L -> 0 rows') // the server held nothing: its first send failed
    expect(world.deviceDeleted).toEqual(['L']) // and the device’s own copy of the log goes, as an offline delete removes it
    expect(queued()).toEqual(['upsert v2_set_logs:M', 'upsert v2_set_logs:N', `upsert v2_coach_notes:${note}`, 'patch v2_set_logs:M']) // only L’s own write went
    await flushSyncQueue()

    expect(serverLogs()).toEqual(['M', 'N']) // L did not come back; M and N landed in this pass
    expect(server.get('v2_set_logs', 'M')?.set_number).toBe(3) // the renumber went after M’s upsert
    expect(server.ids('v2_coach_notes')).toEqual([note])
    expect(server.requests.filter((r) => r.includes('v2_set_logs:L') && r.includes('upsert'))).toEqual(['upsert v2_set_logs:L -> network error'])
    expect(server.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })

  it('a dropset (the drop first, the head last): neither comes back, the other log of the session lands', async () => {
    await logOffline('s1', 'H', { stageKind: 'dropset' })
    await logOffline('s1', 'S', { parentSetId: 'H', stageIndex: 1, isDropset: true })
    await logOffline('s1', 'M', { setNumber: 2 })
    failFirstSend('upsert v2_set_logs:H', 'upsert v2_set_logs:M')
    await reconnectPass()
    expect(queued()).toEqual(['upsert v2_set_logs:H', 'upsert v2_set_logs:S', 'upsert v2_set_logs:M'])

    await deleteLogOnline('s1', 'S', 'H')
    await deleteLogOnline('s1', 'H')
    expect(queued()).toEqual(['upsert v2_set_logs:M'])
    await flushSyncQueue()

    expect(serverLogs()).toEqual(['M'])
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
  })

  it('UNLOG (chunk 63) deletes through the same hook: an unlogged set whose log is still queued does not come back logged at the next pass', async () => {
    server.put('v2_week_plan_sets', { id: 'bench.1' })
    server.put('v2_week_plan_sets', { id: 'bench.2' })
    const logs = [headLog('bench', 1), headLog('bench', 2)]
    await logOffline('s1', 'log.bench.1', { weekPlanSetId: 'bench.1' })
    await logOffline('s1', 'log.bench.2', { weekPlanSetId: 'bench.2', setNumber: 2 })
    failFirstSend('upsert v2_set_logs:log.bench.1', 'upsert v2_set_logs:log.bench.2')
    await reconnectPass()
    const view = viewOf(orderOf([card('bench', 'n n')]), logs, [])
    const effects = unlogEffects(rowKeyed(view, 'set:bench.2'), view as Parameters<typeof unlogEffects>[1])
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.2'])

    for (const log of effects.deleteOrder) await deleteLogOnline('s1', log.id, log.parentSetId)
    await flushSyncQueue()

    expect(serverLogs()).toEqual(['log.bench.1']) // the unlogged set 02 is open again, not logged
    expect(server.refused).toEqual([])
    expect(queue()).toEqual([])
  })

  it('a delete the server refuses drops nothing: the log is still on the screen’s phone and goes at the next pass', async () => {
    await logOffline('s1', 'L')
    failFirstSend('upsert v2_set_logs:L', 'delete v2_set_logs:L')
    await reconnectPass()

    world.online = true
    const hook = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => {
      await expect(hook.result.current.mutateAsync({ id: 'L', parentSetId: null })).rejects.toBeTruthy()
    })
    expect(queued()).toEqual(['upsert v2_set_logs:L'])

    await flushSyncQueue()
    expect(serverLogs()).toEqual(['L'])
  })

  it('a pass already running when the delete is made does not send the log it had read: the cleanup removed it from the queue, not from that pass’s list', async () => {
    await logOffline('s1', 'X') // first in the queue: its request is the one the pass is waiting on
    await logOffline('s1', 'L')
    await logOffline('s1', 'M', { setNumber: 2 })
    const inFlight = server.hold('upsert v2_set_logs:X')
    world.online = true
    const pass = flushSyncQueue()
    await inFlight.reached

    await deleteLogOnline('s1', 'L') // the pass holds L’s upsert in the list it read
    inFlight.release()
    await pass

    expect(serverLogs()).toEqual(['M', 'X']) // L never sent; M, behind it in the same pass, was
    expect(server.requests.some((r) => r.startsWith('upsert v2_set_logs:L'))).toBe(false)
    expect(queue()).toEqual([])
  })

  it('a cleanup the phone’s own database refuses is logged and does not fail the delete that was done (no worse than before the fix)', async () => {
    await logOffline('s1', 'L')
    failFirstSend('upsert v2_set_logs:L')
    await reconnectPass()
    world.queueDeleteFails = 1

    await deleteLogOnline('s1', 'L') // resolves: the request went through

    expect(errorLog).toHaveBeenCalledWith('[sync] could not drop the queued rows of a deleted log', expect.any(Error))
  })
})

// ─── (ii) a session deleted in History while writes naming it are queued ───────────────────────────────────────────────────────────────────────────────────────────
describe('230 (ii): a session deleted in History takes the queued writes that name it, and nothing else', () => {
  async function build() {
    server.put('v2_sessions', { id: 's3', status: 'completed' })
    server.put('v2_week_plan_sets', { id: 'P3' })
    await logOffline('s3', 'L3')
    await changeRowQueued('C3', 's3', { weekPlanSetId: 'P3' })
    await finishQueued('s3')
    const note3 = await noteOffline('felt strong', 's3') // names the session: ON DELETE SET NULL, so it is kept
    queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'delete', payload: { id: 'X3' }, createdAt: new Date().toISOString(), sessionId: 's3' }) // a queued delete of a log of it
    await logOffline('s2', 'L9') // another session
    const noteNone = await noteOffline('general', null)
    const noteOther = await noteOffline('other session', 's2')
    queue().push({ id: world.nextId++, table: 'v2_sessions', operation: 'upsert', payload: { id: 's2', status: 'completed', note: null }, createdAt: new Date().toISOString(), recomputeFinish: true })
    // (note3 is not in the list: it names s3, whose finish fails first in this pass, so the pass holds the note behind it and never sends it)
    failFirstSend('upsert v2_set_logs:L3', 'upsert v2_session_set_changes:C3', 'upsert v2_sessions:s3', 'delete v2_set_logs:X3',
      'upsert v2_set_logs:L9', `upsert v2_coach_notes:${noteNone}`, `upsert v2_coach_notes:${noteOther}`, 'upsert v2_sessions:s2')
    await reconnectPass()
    return { note3, noteNone, noteOther }
  }

  it('the session’s logs, change rows, finish and queued log deletes leave; its note stays with no session; another session’s, another note, the rest stay and go in the same pass', async () => {
    const { note3, noteNone, noteOther } = await build()
    expect(queued()).toEqual([
      'upsert v2_set_logs:L3', 'upsert v2_session_set_changes:C3', 'upsert v2_sessions:s3', `upsert v2_coach_notes:${note3}`, 'delete v2_set_logs:X3',
      'upsert v2_set_logs:L9', `upsert v2_coach_notes:${noteNone}`, `upsert v2_coach_notes:${noteOther}`, 'upsert v2_sessions:s2',
    ])

    await deleteSessionInHistory('s3')

    expect(queued()).toEqual([`upsert v2_coach_notes:${note3}`, 'upsert v2_set_logs:L9', `upsert v2_coach_notes:${noteNone}`, `upsert v2_coach_notes:${noteOther}`, 'upsert v2_sessions:s2'])
    expect(queue().find((q) => q.payload.id === note3)?.payload.session_id).toBeNull()
    expect(queue().find((q) => q.payload.id === noteOther)?.payload.session_id).toBe('s2') // another session’s note keeps its session
    await flushSyncQueue()

    expect(server.has('v2_sessions', 's3')).toBe(false) // the finish did not bring the session back
    expect(server.ids('v2_coach_notes')).toEqual([note3, noteNone, noteOther].sort())
    expect(server.get('v2_coach_notes', note3)?.session_id).toBeNull()
    expect(server.get('v2_coach_notes', noteOther)?.session_id).toBe('s2')
    expect(serverLogs()).toEqual(['L9'])
    expect(server.get('v2_sessions', 's2')?.status).toBe('completed') // the other session’s finish landed in this pass
    expect(server.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
    expect(await hasQueuedWritesFor('s3')).toBe(false)
  })

  it('a delete the server refuses drops nothing', async () => {
    await build()
    const before = queued()
    server.failing.set('delete v2_sessions:s3', 1)
    world.online = true
    const hook = renderHook(() => useDeleteSession(), { wrapper })
    await act(async () => {
      await expect(hook.result.current.mutateAsync('s3')).rejects.toBeTruthy()
    })
    expect(queued()).toEqual(before)
    expect(server.has('v2_sessions', 's3')).toBe(true)
  })

  it('the “couldn’t sync” notice is made again: a log that had given up is gone from it, another session’s stays', async () => {
    server.put('v2_sessions', { id: 's3', status: 'completed' })
    await logOffline('s3', 'L3')
    await logOffline('s2', 'L9')
    server.failing.set('upsert v2_set_logs:L3', 5)
    server.failing.set('upsert v2_set_logs:L9', 5)
    world.online = true
    for (let pass = 1; pass <= 5; pass++) await flushSyncQueue()
    expect(useOfflineStore.getState().syncFailures.map((f) => f.recordId).sort()).toEqual(['L3', 'L9'])

    await deleteSessionInHistory('s3')

    expect(useOfflineStore.getState().syncFailures.map((f) => f.recordId)).toEqual(['L9'])
    expect(await hasQueuedWritesFor('s3')).toBe(false)
  })
})

// ─── (iii) a planned set removed on Plan while the logged set that names it is queued ──────────────────────────────────────────────────────────────────────────────
describe('230 (iii): a planned set removed on Plan: its logged set is sent with no planned set, its change row is dropped', () => {
  async function build() {
    server.put('v2_week_plan_sets', { id: 'P5' })
    server.put('v2_week_plan_sets', { id: 'P6' })
    await logOffline('s1', 'L5', { weekPlanSetId: 'P5' })
    await logOffline('s1', 'L6', { weekPlanSetId: 'P6', setNumber: 2 })
    await logOffline('s1', 'M', { setNumber: 3 })
    await changeRowQueued('C5', 's1', { weekPlanSetId: 'P5' })
    await changeRowQueued('C6', 's1', { weekPlanSetId: 'P6' })
    const note = await noteOffline('a note', null)
    failFirstSend('upsert v2_set_logs:L5', 'upsert v2_set_logs:L6', 'upsert v2_set_logs:M', 'upsert v2_session_set_changes:C5', 'upsert v2_session_set_changes:C6', `upsert v2_coach_notes:${note}`)
    await reconnectPass()
    return note
  }

  it('the log lands with week_plan_set_id null (as the server leaves a log that got there first), its change row goes, every other write goes in the same pass', async () => {
    const note = await build()
    expect(queue().length).toBe(6)
    await removeSet('P5') // Plan’s removal of the planned set: a direct request, the queue is not looked at

    await flushSyncQueue()

    expect(serverLogs()).toEqual(['L5', 'L6', 'M'])
    expect(server.get('v2_set_logs', 'L5')?.week_plan_set_id).toBeNull() // it reached the server, with no planned set
    expect(server.get('v2_set_logs', 'L6')?.week_plan_set_id).toBe('P6') // a log of a planned set that is still there keeps it
    expect(server.ids('v2_session_set_changes')).toEqual(['C6']) // C5 went with its planned set (042: cascade); C6 landed
    expect(server.ids('v2_coach_notes')).toEqual([note])
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })

  it('the request that sends it again fails: the queue keeps the log with no planned set, so the next pass sends it at once', async () => {
    await build()
    await removeSet('P5')
    server.failing.set('upsert v2_set_logs:L5', 1) // the refusal comes first (the planned set is gone); the connection then drops on the resend

    await flushSyncQueue()
    expect(queue().map((q) => [q.payload.id, q.payload.week_plan_set_id, q.attempts])).toEqual([['L5', null, 2]]) // everything else went in this pass; L5 counts as a failed attempt

    await flushSyncQueue()
    expect(server.get('v2_set_logs', 'L5')?.week_plan_set_id).toBeNull()
    expect(server.requests[server.requests.length - 1]).toBe('upsert v2_set_logs:L5 -> ok') // sent as it was kept, with no second refusal
    expect(queue()).toEqual([])
  })

  it('a log that gave up on this refusal before the fix was in (the notice is showing) goes when the user taps RETRY', async () => {
    server.put('v2_week_plan_sets', { id: 'P5' })
    await logOffline('s1', 'L5', { weekPlanSetId: 'P5' })
    server.failing.set('upsert v2_set_logs:L5', 1)
    await reconnectPass()
    await removeSet('P5')
    queue()[0].attempts = 5 // five refusals, as an older build left it
    queue()[0].gaveUp = true
    queue()[0].sendStarted = true
    await flushSyncQueue()
    expect(queue().length).toBe(1) // it gave up: not tried on its own any more

    await retrySyncFailures()

    expect(server.get('v2_set_logs', 'L5')?.week_plan_set_id).toBeNull()
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
  })

  it('any other refusal is a failed attempt as before: a log whose exercise is gone keeps its planned set, is not resent, and is counted', async () => {
    server.put('v2_week_plan_sets', { id: 'P5' })
    await logOffline('s1', 'LE', { weekPlanSetId: 'P5', exerciseId: 'gone' })

    await reconnectPass()

    expect(server.requests).toEqual(['upsert v2_set_logs:LE -> 23503 exercise_id'])
    expect(queue().map((q) => [q.payload.week_plan_set_id, q.attempts])).toEqual([['P5', 1]])
  })

  it('a change row refused on another key (its log is not on the server) is held as before, not dropped', async () => {
    await changeRowQueued('CX', 's1', { setLogId: 'nowhere' })
    queue()[0].attempts = 1 // it has been sent once: it is not a log’s never-sent write

    await reconnectPass()

    expect(queue().map((q) => [q.payload.id, q.attempts])).toEqual([['CX', 2]])
    expect(server.refused).toEqual(['upsert v2_session_set_changes:CX'])
  })
})

// ─── the Library's delete of an exercise whose only sets are still queued ─────────────────────────────────────────────────────────────────────────────────────────────
describe('230, the Library: an exercise with a log still queued is kept, so the log lands', () => {
  it('previewExerciseDelete counts the queued log: outcome lost; deleteExercise keeps the exercise; the next pass sends the log', async () => {
    server.put('exercises', { id: 'curl' })
    await logOffline('s1', 'LC', { exerciseId: 'curl' })
    failFirstSend('upsert v2_set_logs:LC')
    await reconnectPass()

    expect(await previewExerciseDelete('curl')).toMatchObject({ outcome: 'lost', setCount: 1 })
    expect(await deleteExercise('curl')).toBe('lost')
    await flushSyncQueue()

    expect(server.get('exercises', 'curl')?.status).toBe('lost') // kept, not deleted: the exercise row is there for the log to name
    expect(serverLogs()).toEqual(['LC'])
    expect(queue()).toEqual([])
  })

  it('a log queued together with its own delete never reaches the server, and another exercise’s queued log is not this one’s: nothing counts', async () => {
    server.put('exercises', { id: 'curl' })
    await logOffline('s1', 'LC', { exerciseId: 'curl' })
    queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'delete', payload: { id: 'LC' }, createdAt: new Date().toISOString(), sessionId: 's1' })
    await logOffline('s1', 'LB') // bench

    expect(await previewExerciseDelete('curl')).toMatchObject({ outcome: 'gone', setCount: 0 })
  })
})
