// @vitest-environment jsdom
// Chunk 75 (1.2.1 item 8b; DECISIONS 249 row 22, 252, 272; pre-read 75-3, 75-4, 75-5): the phone's sync queue after a finished program is deleted whole.
//
// The delete takes the program's sessions on the server (their logs, change rows and session analyses by cascade, the program's Coach notes by the
// function's own delete). A write still queued on this phone for one of those sessions is then refused `23503` for ever, or (a queued finish, a queued
// session) creates the session again under a program that is gone. These run the REAL producers (`useCreateSession`'s offline branch, `useLogSet`,
// `useCreateCoachNote`), the REAL hooks (`useFinishedRunCounts`, `useDeleteFinishedRun`), the REAL services, the real `FullDeleteConfirm` and the real
// `flushSyncQueue`, against a server that models the keys the queued writes carry and what each delete does to a row that got there first
// (`queueServer.testutil.ts`), plus the two functions of migration 048 as the database answers them. Every case has other programs' writes in the same
// queue (RULES: "a fix that cancels, holds or drops queue items is proven with other records' writes in the same queue, and asserts they went in the same
// pass"): another finished program's session with a queued log and finish, a session of ITS that exists only in the queue, a note on its session, a
// note on no session, and the running program's log. Only the program being deleted loses anything.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { renderHook, act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueueServer } from '../offline/queueServer.testutil'
import { fakePostgrest } from './fakePostgrest.testutil'
import { versionCheckAnswers } from '../release/versionGate.testutil'

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
const world = vi.hoisted(() => ({ online: false, queue: [] as unknown[], nextId: 1, queueDeleteGoes: 0, queueDeleteFails: 0, rpcCalls: [] as Array<[string, unknown]>, idReads: 0, toArrayFails: 0 }))
const queue = () => world.queue as QueueItem[]
const server = new QueueServer()

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      // Dexie hands back copies, not the objects it stores.
      orderBy: () => ({ toArray: async () => structuredClone([...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) }),
      toArray: async () => {
        if (world.toArrayFails > 0) {
          world.toArrayFails--
          throw new Error('UnknownError')
        }
        return structuredClone([...queue()])
      },
      add: async (item: Omit<QueueItem, 'id'>) => void queue().push({ ...item, id: world.nextId++ }),
      // The device's database cutting a clean-up short: `queueDeleteGoes` removals go through, then the next `queueDeleteFails` are refused.
      delete: async (id: number) => {
        if (world.queueDeleteGoes > 0) world.queueDeleteGoes--
        else if (world.queueDeleteFails > 0) {
          world.queueDeleteFails--
          throw new Error('UnknownError')
        }
        world.queue = queue().filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => void (world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))),
    },
    // The device's own copies: `useLogSet` and `useCreateSession` write them beside the queue; a full delete does not touch them (the offline mirror is a read cache).
    set_logs: { delete: async () => {}, update: async () => {}, put: async () => {} },
    sessions: { put: async () => {} },
  },
}))

// The two functions of 048, as the database answers them: P0002 not found, OL003 not finished; the counts as History counts; the delete in the function's own order
// (the program's notes by the captured session ids, then its sessions with their cascades, then the program). `v2_sessions.mesocycle_id` is a foreign key to the
// program: a session upserted after the program is gone is refused 23503, as the real table refuses it.
function rpc(name: string, args: { p_mesocycle_id: string }) {
  world.rpcCalls.push([name, args])
  const id = args.p_mesocycle_id
  const run = server.get('v2_mesocycles', id)
  if (!run) return { data: null, error: { code: 'P0002', message: `program not found: ${id}` } }
  if (run.status !== 'completed') return { data: null, error: { code: 'OL003', message: 'only a finished program can be deleted' } }
  const sessionIds = [...server.table('v2_sessions').values()].filter((s) => s.mesocycle_id === id).map((s) => s.id as string)
  if (name === 'v2_finished_run_counts') {
    const logs = [...server.table('v2_set_logs').values()].filter((l) => sessionIds.includes(l.session_id as string))
    const notes = [...server.table('v2_coach_notes').values()].filter((n) => sessionIds.includes(n.session_id as string))
    return {
      data: [{ weeks: run.weeks ?? 0, sessions: sessionIds.length, logged_sets: logs.filter((l) => !l.is_skipped && !l.parent_set_id && !l.is_warmup).length, coach_analyses: run.analyses ?? 0, coach_notes: notes.length }],
      error: null,
    }
  }
  return (async () => {
    for (const note of [...server.table('v2_coach_notes').values()]) {
      if (sessionIds.includes(note.session_id as string)) await server.query('v2_coach_notes').delete().eq('id', note.id)
    }
    await server.query('v2_sessions').delete().eq('mesocycle_id', id)
    await server.query('v2_mesocycles').delete().eq('id', id)
    return { data: null, error: null }
  })()
}
function fromTable(table: string) {
  const base = server.query(table)
  if (table !== 'v2_sessions') return base
  return {
    ...base,
    upsert: async (row: Record<string, unknown>) => {
      const tag = `upsert v2_sessions:${row.id as string}`
      if (row.mesocycle_id != null && !server.has('v2_mesocycles', row.mesocycle_id as string)) {
        server.requests.push(`${tag} -> 23503 mesocycle_id`)
        server.refused.push(tag)
        return { error: { code: '23503', message: 'insert or update on table "v2_sessions" violates foreign key constraint "v2_sessions_mesocycle_id_fkey"', details: 'Key is not present in table "v2_mesocycles".' } }
      }
      return base.upsert(row)
    },
    // The program's session ids, as `fetchFinishedRunSessionIds` asks for them (id column, filtered, ordered, paged): the paging stand-in over the server's rows.
    select: (columns?: string, options?: { count?: string; head?: boolean }) => {
      if (columns !== 'id') return base.select(columns, options)
      world.idReads++
      return (fakePostgrest({ v2_sessions: [...server.table('v2_sessions').values()] }).client.from as (t: string) => { select: (c: string) => unknown })('v2_sessions').select('id')
    },
  }
}
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => (fromTable as (t: string) => unknown)(args[0] as string),
    rpc: async (...args: unknown[]) => rpc(args[0] as string, args[1] as { p_mesocycle_id: string }),
  },
}))

const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, hasQueuedWritesFor } = await import('../offline/useSyncQueue')
const { useOfflineStore } = await import('../offline/offlineStore')
const { useLogSet, useCreateSession } = await import('../gym/useSession')
const { useCreateCoachNote } = await import('../coach/useCoachNotes')
const { useDeleteFinishedRun, useFinishedRunCounts } = await import('./useMesos')
const { fetchFinishedRunSessionIds } = await import('./mesoService')
const { dropQueuedWritesOfDeletedRun, queuedSessionIdsOfRun, dropQueuedCoachNotesNamingSessions } = await import('./finishedRunQueue')
const { default: FullDeleteConfirm } = await import('./FullDeleteConfirm')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const describeItem = (q: QueueItem) => `${q.operation} ${q.table}:${q.payload.id as string}`
const queued = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map(describeItem)
const serverIds = (table: string) => server.ids(table)
let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  world.online = false
  world.queue = []
  world.nextId = 1
  world.queueDeleteGoes = 0
  world.queueDeleteFails = 0
  world.rpcCalls = []
  world.idReads = 0
  world.toArrayFails = 0
  server.reset()
  queryClient.clear()
  versionCheckAnswers() // the version check has answered: this version may send the queue (chunk 73)
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}) // the queue logs each failed attempt
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── The account's world ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Three programs: A (finished: the one deleted), B (finished: another one) and C (running). A holds two sessions on the server and a third that exists
// only in this phone's queue; B holds one on the server and one only in the queue.
function serverWorld() {
  server.put('exercises', { id: 'bench' })
  server.put('v2_week_plan_sets', { id: 'P' })
  server.put('v2_mesocycles', { id: 'run-A', status: 'completed', weeks: 2, analyses: 1 })
  server.put('v2_mesocycles', { id: 'run-B', status: 'completed', weeks: 5, analyses: 0 })
  server.put('v2_mesocycles', { id: 'run-C', status: 'active', weeks: 1, analyses: 0 })
  server.put('v2_sessions', { id: 'sA1', mesocycle_id: 'run-A', status: 'completed' })
  server.put('v2_sessions', { id: 'sA2', mesocycle_id: 'run-A', status: 'completed' })
  server.put('v2_sessions', { id: 'sB1', mesocycle_id: 'run-B', status: 'completed' })
  server.put('v2_sessions', { id: 'sC1', mesocycle_id: 'run-C', status: 'in_progress' })
  server.put('v2_set_logs', { id: 'lsA1', session_id: 'sA1', exercise_id: 'bench', set_number: 1, is_skipped: false, is_warmup: false, parent_set_id: null })
  server.put('v2_set_logs', { id: 'lsA2', session_id: 'sA2', exercise_id: 'bench', set_number: 1, is_skipped: false, is_warmup: false, parent_set_id: null })
  server.put('v2_set_logs', { id: 'lsA2w', session_id: 'sA2', exercise_id: 'bench', set_number: 2, is_skipped: false, is_warmup: true, parent_set_id: null })
  server.put('v2_set_logs', { id: 'lsB1', session_id: 'sB1', exercise_id: 'bench', set_number: 1, is_skipped: false, is_warmup: false, parent_set_id: null })
  server.put('v2_coach_notes', { id: 'nsA1', session_id: 'sA1' })
  server.put('v2_coach_notes', { id: 'nsB1', session_id: 'sB1' })
}

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
/** A session started offline (`useCreateSession`'s offline branch): its upsert names the program in `mesocycle_id`, and the server has never seen it. */
async function startSessionOffline(id: string, mesoId: string) {
  world.online = false
  vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(id as `${string}-${string}-${string}-${string}-${string}`)
  const hook = renderHook(() => useCreateSession(), { wrapper })
  await act(async () => {
    await hook.result.current.mutateAsync({ mesoId, weekPlanId: null, workoutDayId: 'wd-1', date: '2026-10-28' })
  })
  expect(queue().some((q) => q.table === 'v2_sessions' && q.payload.id === id && q.payload.mesocycle_id === mesoId)).toBe(true)
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
/** The finish `useCompleteSession` queues behind a session's unsent sets (shape: `queueFinish`; it carries the session's program only when the phone had the session cached). */
function finishQueued(sessionId: string) {
  queue().push({ id: world.nextId++, table: 'v2_sessions', operation: 'upsert', payload: { id: sessionId, status: 'completed', note: null }, createdAt: new Date().toISOString(), recomputeFinish: true })
}
function changeRowQueued(id: string, sessionId: string) {
  queue().push({
    id: world.nextId++, table: 'v2_session_set_changes', operation: 'upsert', createdAt: new Date().toISOString(),
    payload: { id, user_id: 'u1', session_id: sessionId, kind: 'retyped', week_plan_set_id: 'P', set_log_id: null },
  })
}
function logDeleteQueued(id: string, sessionId: string) {
  queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'delete', payload: { id }, createdAt: new Date().toISOString(), sessionId })
}

/** Every write the pass would send fails once, so each stays queued with a failed attempt: a phone that was offline, or whose sends failed, when the program was deleted. */
async function everyFirstSendFails() {
  for (const q of queue()) server.failing.set(`${q.operation} ${q.table}:${q.payload.id as string}`, 1)
  world.online = true
  await flushSyncQueue()
  server.failing.clear() // a write held behind another never reached the server, so its failure is still unspent: the next pass is a clean one
}

/** The server's side of the delete alone (the function), for the control that cleans the phone's queue some other way. */
async function deleteFinishedRunOnTheServerOnly(id: string) {
  const { supabase } = await import('../../lib/supabase')
  await supabase.rpc('v2_delete_finished_run', { p_mesocycle_id: id })
}

const NOTES = { A1: '', Q: '', B1: '', none: '' }
/** Programs A, B and C, each with writes still queued (see the top of the file). Returns the notes' ids. */
async function queuedWorld(): Promise<typeof NOTES> {
  serverWorld()
  // C, the running program, first in the queue: a write a pass can be waiting on while the delete is made
  await logOffline('sC1', 'lC1')
  // A: two sessions on the server, one only here
  await logOffline('sA1', 'lA1')
  changeRowQueued('cA1', 'sA1')
  logDeleteQueued('xA1', 'sA1')
  finishQueued('sA2')
  await startSessionOffline('sQA', 'run-A')
  await logOffline('sQA', 'lQA')
  const noteA1 = await noteOffline('on a session of A', 'sA1')
  const noteQ = await noteOffline('on the session of A only this phone has', 'sQA')
  // B: one session on the server, one only here
  await logOffline('sB1', 'lB1')
  finishQueued('sB1')
  await startSessionOffline('sQB', 'run-B')
  await logOffline('sQB', 'lQB')
  const noteB1 = await noteOffline('on a session of B', 'sB1')
  // a note on no session
  const noteNone = await noteOffline('general', null)
  await everyFirstSendFails()
  return { A1: noteA1, Q: noteQ, B1: noteB1, none: noteNone }
}

const KEPT = (notes: typeof NOTES) => [
  'upsert v2_set_logs:lB1',
  'upsert v2_sessions:sB1',
  'upsert v2_sessions:sQB',
  'upsert v2_set_logs:lQB',
  `upsert v2_coach_notes:${notes.B1}`,
  'upsert v2_set_logs:lC1',
  `upsert v2_coach_notes:${notes.none}`,
]
const sorted = (list: string[]) => [...list].sort()

async function deleteRunA(read: { ids?: string[] } = {}) {
  world.online = true
  const ids = read.ids ?? (await fetchFinishedRunSessionIds('run-A'))
  const hook = renderHook(() => useDeleteFinishedRun(), { wrapper })
  await act(async () => {
    await hook.result.current.mutateAsync({ id: 'run-A', sessionIds: ids })
  })
}
const notice = () => useOfflineStore.getState().syncFailures.length

describe('the world the cases share', () => {
  it('is what they say it is: program A\'s writes and program B\'s and C\'s all waiting, every one of them tried once', async () => {
    const notes = await queuedWorld()
    expect(sorted(queued())).toEqual(
      sorted([
        'upsert v2_set_logs:lA1', 'upsert v2_session_set_changes:cA1', 'delete v2_set_logs:xA1', 'upsert v2_sessions:sA2', 'upsert v2_sessions:sQA', 'upsert v2_set_logs:lQA',
        `upsert v2_coach_notes:${notes.A1}`, `upsert v2_coach_notes:${notes.Q}`, ...KEPT(notes),
      ]),
    )
    expect(queue().find((q) => q.table === 'v2_sessions' && q.payload.id === 'sQA')?.payload.mesocycle_id).toBe('run-A')
    expect(queue().find((q) => q.table === 'v2_sessions' && q.payload.id === 'sQB')?.payload.mesocycle_id).toBe('run-B')
    expect(await queuedSessionIdsOfRun('run-A')).toEqual(['sQA'])
    expect(await queuedSessionIdsOfRun('run-B')).toEqual(['sQB'])
    expect(await queuedSessionIdsOfRun('run-C')).toEqual([])
    expect(await queuedSessionIdsOfRun('run-nothing')).toEqual([])
  })

  it('a queued session is the program\'s only through an upsert that names the program: any other queue item of that table is not a session to drop, whatever its payload says', async () => {
    await queuedWorld()
    // the app queues no delete or patch of a session (a session is deleted online, SPEC Rules 2); a hand-built one that still names the program is no session of it
    for (const operation of ['delete', 'patch'] as const) {
      queue().push({ id: world.nextId++, table: 'v2_sessions', operation, payload: { id: `s-${operation}`, mesocycle_id: 'run-A' }, createdAt: new Date().toISOString() })
    }
    // and an upsert of another table that carries a program id is not one either
    queue().push({ id: world.nextId++, table: 'v2_coach_notes', operation: 'upsert', payload: { id: 'n-odd', mesocycle_id: 'run-A', session_id: null }, createdAt: new Date().toISOString() })

    expect(await queuedSessionIdsOfRun('run-A')).toEqual(['sQA'])
  })
})

describe('after the delete, the queue holds nothing of the program\'s and everything else', () => {
  it('the writes of every session read from the server leave, and the ones of the other programs stay and go in the same pass', async () => {
    const notes = await queuedWorld()

    await deleteRunA()

    expect(world.rpcCalls).toEqual([['v2_delete_finished_run', { p_mesocycle_id: 'run-A' }]])
    // sA1's log, change row, queued log delete; sA2's finish; the notes on both leave. B's and C's stay.
    expect(sorted(queued())).toEqual(sorted(KEPT(notes)))
    await flushSyncQueue()

    // B and C landed in this pass; nothing of A came back or was refused
    expect(serverIds('v2_set_logs')).toEqual(['lB1', 'lC1', 'lQB', 'lsB1'])
    expect(serverIds('v2_sessions')).toEqual(['sB1', 'sC1', 'sQB'])
    expect(server.has('v2_sessions', 'sA1')).toBe(false)
    expect(server.has('v2_sessions', 'sA2')).toBe(false) // the finish did not bring the session back
    expect(serverIds('v2_mesocycles')).toEqual(['run-B', 'run-C'])
    expect(serverIds('v2_coach_notes')).toEqual(sorted(['nsB1', notes.B1, notes.none]))
    expect(server.get('v2_coach_notes', notes.B1)?.session_id).toBe('sB1') // B's note keeps its session
    expect(server.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
    expect(await hasQueuedWritesFor('sA1')).toBe(false)
    expect(await hasQueuedWritesFor('sB1')).toBe(false)
  })

  it('the first session alone, or the last alone, is not enough: every session of the program is dealt with (a program of one, two and five sessions)', async () => {
    for (const extra of [0, 1, 4]) {
      world.queue = []
      world.nextId = 1
      server.reset()
      const notes = await queuedWorld()
      for (let i = 0; i < extra; i++) {
        server.put('v2_sessions', { id: `sX${i}`, mesocycle_id: 'run-A', status: 'completed' })
        queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', createdAt: new Date().toISOString(), payload: { id: `lX${i}`, user_id: 'u1', session_id: `sX${i}`, exercise_id: 'bench', set_number: 1 }, attempts: 1 })
      }
      await deleteRunA()
      expect(sorted(queued()), `${extra} more sessions`).toEqual(sorted(KEPT(notes)))
      await flushSyncQueue()
      expect(server.refused, `${extra} more sessions`).toEqual([])
      expect(queue(), `${extra} more sessions`).toEqual([])
    }
  })

  it('a session of the program that exists only in this queue is dropped with its writes; another program\'s queue-only session stays and lands', async () => {
    const notes = await queuedWorld()
    expect(queued()).toContain('upsert v2_sessions:sQA')

    await deleteRunA()

    expect(queued()).not.toContain('upsert v2_sessions:sQA')
    expect(queued()).not.toContain('upsert v2_set_logs:lQA')
    expect(queued()).toContain('upsert v2_sessions:sQB') // B's: its mesocycle_id is another program
    expect(queued()).toContain('upsert v2_set_logs:lQB')
    await flushSyncQueue()

    expect(server.has('v2_sessions', 'sQA')).toBe(false)
    expect(server.has('v2_sessions', 'sQB')).toBe(true)
    expect(server.has('v2_set_logs', 'lQA')).toBe(false)
    expect(server.has('v2_set_logs', 'lQB')).toBe(true)
    expect(server.refused).toEqual([]) // a queued session of a deleted program would be refused 23503 for ever
    expect(queue()).toEqual([])
    expect(notice()).toBe(0)
    void notes
  })

  it('the control: History\'s one-session drop given only the server\'s two ids leaves the queue-only session and its log queued, and they are refused for ever', async () => {
    await queuedWorld()
    world.online = true
    const { dropQueuedWritesNamingSession } = await import('../offline/useSyncQueue')
    await act(async () => {
      for (const id of ['sA1', 'sA2']) await dropQueuedWritesNamingSession(id)
      await deleteFinishedRunOnTheServerOnly('run-A')
    })

    expect(queued()).toContain('upsert v2_sessions:sQA')
    expect(queued()).toContain('upsert v2_set_logs:lQA')
    await flushSyncQueue()
    expect(server.refused).toContain('upsert v2_sessions:sQA')
    expect(queued()).toContain('upsert v2_sessions:sQA') // refused again at every pass: nothing makes it succeed
    expect(queued()).toContain('upsert v2_set_logs:lQA')
    expect(server.has('v2_sessions', 'sQA')).toBe(false)
  })
})

describe('a Coach note queued offline on one of the program\'s sessions is dropped, not kept unlinked (DECISIONS 272; 249 row 14: the program\'s notes go)', () => {
  it('the notes on the server\'s sessions and on the queue-only one leave the queue; B\'s note and the note on no session stay and land', async () => {
    const notes = await queuedWorld()
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.A1}`)
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.Q}`)

    await deleteRunA()

    expect(queued()).not.toContain(`upsert v2_coach_notes:${notes.A1}`)
    expect(queued()).not.toContain(`upsert v2_coach_notes:${notes.Q}`)
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.B1}`)
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.none}`)
    expect(queue().find((q) => q.payload.id === notes.B1)?.payload.session_id).toBe('sB1') // another program's note keeps its session
    await flushSyncQueue()

    expect(server.has('v2_coach_notes', notes.A1)).toBe(false)
    expect(server.has('v2_coach_notes', notes.Q)).toBe(false)
    expect(server.has('v2_coach_notes', 'nsA1')).toBe(false) // the server's own note on a session of A went with the function
    expect(server.has('v2_coach_notes', 'nsB1')).toBe(true)
    expect(server.get('v2_coach_notes', notes.none)?.session_id).toBeNull()
    expect(server.refused).toEqual([])
  })

  it('a note that had given up leaves the "couldn\'t sync" notice and its SYNC marker with it; another note\'s notice stays', async () => {
    const notes = await queuedWorld()
    world.queue = queue().map((q) => (q.payload.id === notes.A1 || q.payload.id === notes.B1 ? { ...q, attempts: 5, gaveUp: true } : q))
    const queueIdOf = (id: string) => queue().find((q) => q.payload.id === id)!.id
    useOfflineStore.getState().setSyncFailures([
      { queueId: queueIdOf(notes.A1), table: 'v2_coach_notes', recordId: notes.A1, sessionId: 'sA1' },
      { queueId: queueIdOf(notes.B1), table: 'v2_coach_notes', recordId: notes.B1, sessionId: 'sB1' },
    ])
    useOfflineStore.setState({ pendingIds: new Set([notes.A1, notes.B1]) })
    expect(notice()).toBe(2)

    await dropQueuedCoachNotesNamingSessions(['sA1'])

    expect(notice()).toBe(1)
    expect(useOfflineStore.getState().failedIds.has(notes.A1)).toBe(false)
    expect(useOfflineStore.getState().failedIds.has(notes.B1)).toBe(true) // B's note is still stuck, and still says so
    expect(useOfflineStore.getState().pendingIds.has(notes.A1)).toBe(false)
    expect(useOfflineStore.getState().pendingIds.has(notes.B1)).toBe(true)
    expect(queued()).not.toContain(`upsert v2_coach_notes:${notes.A1}`)
  })

  it('dropQueuedCoachNotesNamingSessions removes only the notes that name one of the sessions it is given, and tells how many', async () => {
    const notes = await queuedWorld()
    expect(await dropQueuedCoachNotesNamingSessions(['sA1'])).toBe(1)
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.Q}`)
    expect(await dropQueuedCoachNotesNamingSessions([])).toBe(0)
    expect(await dropQueuedCoachNotesNamingSessions(['sB1', 'sQA'])).toBe(2)
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.none}`)
    expect(queued().filter((q) => q.includes('v2_coach_notes'))).toEqual([`upsert v2_coach_notes:${notes.none}`])
  })
})

describe('a delete that did not happen drops nothing', () => {
  it('a delete the server refuses (the program is not finished: OL003) leaves every queued write where it was', async () => {
    const notes = await queuedWorld()
    server.put('v2_mesocycles', { id: 'run-A', status: 'active' })
    const before = queued()
    world.online = true
    const ids = await fetchFinishedRunSessionIds('run-A')
    const hook = renderHook(() => useDeleteFinishedRun(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync({ id: 'run-A', sessionIds: ids })).rejects.toEqual({ code: 'OL003', message: 'only a finished program can be deleted' })
    })

    expect(queued()).toEqual(before)
    expect(queued()).toContain(`upsert v2_coach_notes:${notes.A1}`) // still on its session
    expect(queue().find((q) => q.payload.id === notes.A1)?.payload.session_id).toBe('sA1')
  })

  it('a program that is not there (P0002) drops nothing either', async () => {
    await queuedWorld()
    const before = queued()
    world.online = true
    const hook = renderHook(() => useDeleteFinishedRun(), { wrapper })
    await act(async () => {
      await expect(hook.result.current.mutateAsync({ id: 'run-nothing', sessionIds: ['sA1'] })).rejects.toMatchObject({ code: 'P0002' })
    })
    expect(queued()).toEqual(before)
  })
})

describe('a clean-up the phone\'s own database refuses is logged and does not fail the delete that was done', () => {
  it('the first removal is refused: the delete resolves, the failure is logged, and the sessions\' writes after it still leave', async () => {
    const notes = await queuedWorld()
    world.queueDeleteFails = 1 // the first removal from the queue (the notes go first)

    await deleteRunA() // resolves: the request went through

    expect(errorLog).toHaveBeenCalledWith('[sync] could not drop the queued notes of a deleted program', expect.any(Error))
    expect(world.rpcCalls).toHaveLength(1)
    // the refused removal left its note; every other write of the program left, and B's and C's stayed
    expect(queued()).not.toContain('upsert v2_set_logs:lA1')
    expect(queued()).not.toContain('upsert v2_sessions:sQA')
    expect(queued()).toContain('upsert v2_coach_notes:' + notes.A1)
    expect(queued()).toContain('upsert v2_set_logs:lB1')
  })

  it('the queue cannot be read for the sessions only it knows: logged, the delete still resolves, and every session the server listed is still dealt with', async () => {
    const notes = await queuedWorld()
    world.toArrayFails = 1 // the first read of the queue is the queue-only session read

    await deleteRunA()

    expect(errorLog).toHaveBeenCalledWith('[sync] could not read the sessions of a deleted program from the queue', expect.any(Error))
    expect(world.rpcCalls).toHaveLength(1)
    // the server's two sessions are cleaned (their writes and their notes); the one only the queue knew stays, as it would have before this existed
    expect(queued()).not.toContain('upsert v2_set_logs:lA1')
    expect(queued()).not.toContain('upsert v2_sessions:sA2')
    expect(queued()).not.toContain(`upsert v2_coach_notes:${notes.A1}`)
    expect(queued()).toContain('upsert v2_sessions:sQA')
    expect(queued()).toContain('upsert v2_set_logs:lB1')
  })

  it('a session\'s own drop refused: that one is logged and the next session is still dealt with', async () => {
    await queuedWorld()
    world.queueDeleteGoes = 2 // both notes of A go; the next removal (the first session's own writes) is refused once
    world.queueDeleteFails = 1

    await deleteRunA()

    expect(errorLog).toHaveBeenCalledWith('[sync] could not drop the queued writes of a deleted program', expect.any(Error))
    // the first session's drop (sA1) was refused at its first removal: its writes stay, as they would have before this clean-up existed
    expect(queued()).toContain('upsert v2_set_logs:lA1')
    // the other two sessions of A (sA2, and sQA that only the queue knew) are gone entirely: one refusal does not stop the next session
    expect(queued()).not.toContain('upsert v2_sessions:sA2')
    expect(queued()).not.toContain('upsert v2_sessions:sQA')
    expect(queued()).not.toContain('upsert v2_set_logs:lQA')
    // and B's and C's are untouched
    expect(queued()).toContain('upsert v2_set_logs:lB1')
    expect(queued()).toContain('upsert v2_set_logs:lC1')
  })
})

describe('a pass already running when the delete is made does not send what the clean-up removed', () => {
  it('the pass holds A\'s writes in the list it read; the clean-up removed them from the queue and the pass skips them', async () => {
    const notes = await queuedWorld()
    // the pass is waiting on C's log, the first write in the queue; A's writes are all behind it in the list the pass has read
    const inFlight = server.hold('upsert v2_set_logs:lC1')
    world.online = true
    const pass = flushSyncQueue()
    await inFlight.reached

    await deleteRunA() // the clean-up runs while the pass holds A's remaining writes
    inFlight.release()
    await pass

    expect(server.has('v2_sessions', 'sA2')).toBe(false) // the finish in the pass's list was skipped
    expect(server.has('v2_sessions', 'sQA')).toBe(false)
    expect(server.has('v2_set_logs', 'lQA')).toBe(false)
    expect(server.has('v2_sessions', 'sQB')).toBe(true) // B's went in the same pass
    expect(server.has('v2_set_logs', 'lB1')).toBe(true)
    expect(server.has('v2_set_logs', 'lC1')).toBe(true)
    expect(serverIds('v2_coach_notes')).toContain(notes.B1)
    expect(notice()).toBe(0)
    expect(queue()).toEqual([])
  })
})

describe('through the confirmation: the counts and the ids are read when it opens, DELETE sends them, and the phone is cleaned', () => {
  const ui = (onDeleted = vi.fn()) =>
    render(
      <QueryClientProvider client={queryClient}>
        <FullDeleteConfirm run={{ id: 'run-A', name: 'Cut PPL' }} onCancel={vi.fn()} onDeleted={onDeleted} />
      </QueryClientProvider>,
    )

  it('counting, then the counts of the database (2 weeks | 2 sessions | 2 logged sets: a warmup and a skipped set are not counted | 1 analysis | 1 note), DELETE: the program goes whole and the queue is clean', async () => {
    const notes = await queuedWorld()
    world.online = true
    const onDeleted = vi.fn()
    ui(onDeleted)

    expect(screen.getByText('Counting what goes…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement).disabled).toBe(true)
    // the server holds sA1 (1 log), sA2 (1 log and a warmup), the note nsA1; the program has 1 Coach analysis
    expect(await screen.findByText(/^Deletes its 2 weeks: 2 sessions and 2 logged sets, plus 1 Coach analysis and 1 Coach note\./)).toBeTruthy()
    const button = screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(world.rpcCalls.map(([name]) => name)).toEqual(['v2_finished_run_counts'])
    expect(world.idReads).toBe(1) // the session ids were read with the counts: once, in the same query

    fireEvent.click(button)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(world.rpcCalls).toEqual([
      ['v2_finished_run_counts', { p_mesocycle_id: 'run-A' }],
      ['v2_delete_finished_run', { p_mesocycle_id: 'run-A' }],
    ])
    expect(sorted(queued())).toEqual(sorted(KEPT(notes)))
    await flushSyncQueue()
    expect(server.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(serverIds('v2_mesocycles')).toEqual(['run-B', 'run-C'])
  })

  it('offline it says so, DELETE is off, and neither the counts nor the ids are asked for', async () => {
    await queuedWorld()
    world.online = false
    world.rpcCalls = []
    world.idReads = 0
    ui()

    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect((screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(world.rpcCalls).toEqual([])
    expect(world.idReads).toBe(0)
  })
})

describe('the hook given the counts\' own read', () => {
  it('useFinishedRunCounts reads the same session ids the drop is given: the program\'s sessions on the server, not the queue-only one', async () => {
    await queuedWorld()
    world.online = true
    const { result } = renderHook(() => useFinishedRunCounts('run-A', true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect([...result.current.data!.sessionIds].sort()).toEqual(['sA1', 'sA2'])
    expect(result.current.data!.counts).toEqual({ weeks: 2, sessions: 2, loggedSets: 2, coachAnalyses: 1, coachNotes: 1 })
    expect(await dropQueuedWritesOfDeletedRun('run-A', result.current.data!.sessionIds)).toEqual(expect.arrayContaining(['sA1', 'sA2', 'sQA']))
  })
})
