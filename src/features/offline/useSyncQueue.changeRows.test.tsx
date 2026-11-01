// @vitest-environment jsdom
// Queue-fix 227 (DECISIONS 227; found by chunk 62's builder, executed in its review): a `pending_stages` change row names a log by `set_log_id` (042: a foreign key, ON DELETE
// CASCADE). The queue cancelled a never-sent log with its delete and left the row, let a queued delete go ahead of a row that failed in the pass, and ignored the queue when a
// log was deleted online: the row was then refused `23503` for ever (a "couldn't sync" notice RETRY cannot clear, and a finish of that session waiting for the next pass).
// These are the review's reproductions, run on the real producers (`useLogSet`'s offline branch, `queueSetChanges`, `writeSetChanges`, `patchSetNumbers`, `runDelete` over
// `deleteEffects`, `useDeleteSetLog` offline and online) and the real `flushSyncQueue`, against a fake that models the tables' own refusals: 042's checks, its two partial
// unique indexes, the `set_log_id` foreign key and its cascade, and the drops-first foreign key of `v2_set_logs`. The rules themselves, one by one and with the writes around
// them, are in `useSyncQueue.order.test.ts`; what is asserted here is that each reproduction now ends clean, and that the writes of the same session around it still go.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Session, SetLog } from '../../types'
import { versionCheckAnswers } from '../release/versionGate.testutil'
import { addedLog, card, dropLog, headLog, orderOf, pending, rowKeyed, staged, viewOf } from '../gym/workoutRules.testutil'

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
const world = vi.hoisted(() => ({
  online: false,
  queue: [] as unknown[],
  nextId: 1,
  server: new Map<string, Record<string, unknown>>(),
  requests: [] as string[],
  refused: [] as string[],
  failing: new Map<string, number>(),
  // The device's own database refusing the next removals from the queue (a full disk, a locked store).
  queueDeleteFails: 0,
}))
const queue = () => world.queue as QueueItem[]

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      // Dexie hands back copies, not the objects it stores (RULES: a fake that stands in for a store returns copies).
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
      bulkUpdate: async () => {},
    },
    set_logs: {
      delete: async () => {},
      update: async () => {},
      put: async () => {},
    },
  },
}))

const refusal = (code: string, message: string) => ({ error: { code, message } })
// 042's checks, by name, and its two partial unique indexes
function changeRowRefusal(row: Record<string, unknown>): { error: { code: string; message: string } } | null {
  const kind = row.kind as string
  const planned = row.week_plan_set_id ?? null
  const log = row.set_log_id ?? null
  if (!['deleted', 'retyped', 'pending_stages'].includes(kind)) return refusal('23514', 'v2_session_set_changes_kind_check')
  const keysOk = ((kind === 'deleted' || kind === 'retyped') && planned !== null && log === null) || (kind === 'pending_stages' && log !== null && planned === null)
  if (!keysOk) return refusal('23514', 'v2_session_set_changes_keys_check')
  if (kind === 'deleted' && (row.is_warmup || row.stage_kind != null || (row.stage_count ?? 0) !== 0)) return refusal('23514', 'v2_session_set_changes_deleted_check')
  if (row.is_warmup && row.stage_kind != null) return refusal('23514', 'v2_session_set_changes_warmup_check')
  if ((row.stage_kind != null) !== ((row.stage_count as number) > 0)) return refusal('23514', 'v2_session_set_changes_stage_pair_check')
  for (const [key, other] of world.server) {
    if (!key.startsWith('v2_session_set_changes:') || other.id === row.id || other.session_id !== row.session_id) continue
    if (planned !== null && other.week_plan_set_id === planned) return refusal('23505', 'v2_session_set_changes_plan_set_uk')
    if (log !== null && other.set_log_id === log) return refusal('23505', 'v2_session_set_changes_set_log_uk')
  }
  return null
}
const fails = (tag: string): boolean => {
  const left = world.failing.get(tag) ?? 0
  if (left <= 0) return false
  world.failing.set(tag, left - 1)
  return true
}
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>) => {
        const tag = `upsert ${table}:${row.id}`
        if (fails(tag)) return { error: { message: 'Failed to fetch' } }
        if (table === 'v2_set_logs') {
          const head = row.parent_set_id as string | undefined
          if (head && !world.server.has(`${table}:${head}`)) {
            world.refused.push(tag)
            return refusal('23503', 'v2_set_logs_parent_set_id_fkey')
          }
        }
        if (table === 'v2_session_set_changes') {
          const refused = changeRowRefusal(row)
          if (refused) return refused
          // 042: `set_log_id references v2_set_logs(id) on delete cascade`: a `pending_stages` row for a log the server doesn't hold is refused
          if (row.set_log_id && !world.server.has(`v2_set_logs:${row.set_log_id as string}`)) {
            world.refused.push(tag)
            return refusal('23503', 'v2_session_set_changes_set_log_id_fkey')
          }
        }
        world.requests.push(tag)
        world.server.set(`${table}:${row.id}`, { ...(world.server.get(`${table}:${row.id}`) ?? {}), ...row })
        return { error: null }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (column: string, id: string) => {
          if (column !== 'id') throw new Error(`a queued patch filters on id only, not ${column}`)
          if (fails(`patch ${table}:${id}`)) return { error: { message: 'Failed to fetch' } }
          world.requests.push(`patch ${table}:${id} ${JSON.stringify(Object.fromEntries(Object.entries(patch).sort(([a], [b]) => a.localeCompare(b))))}`)
          const row = world.server.get(`${table}:${id}`)
          if (row) world.server.set(`${table}:${id}`, { ...row, ...patch })
          return { error: null }
        },
      }),
      delete: () => ({
        eq: async (column: string, id: string) => {
          if (column !== 'id') throw new Error(`a delete filters on id only, not ${column}`)
          if (fails(`delete ${table}:${id}`)) return { error: { message: 'Failed to fetch' } }
          world.requests.push(`delete ${table}:${id}`)
          world.server.delete(`${table}:${id}`)
          for (const [key, row] of [...world.server]) if (key.startsWith(`${table}:`) && row.parent_set_id === id) world.server.delete(key)
          // 042: a log takes the change rows that name it with it
          if (table === 'v2_set_logs') for (const [key, row] of [...world.server]) if (key.startsWith('v2_session_set_changes:') && row.set_log_id === id) world.server.delete(key)
          return { error: null }
        },
      }),
    }),
  },
}))

const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, hasQueuedWritesFor } = await import('./useSyncQueue')
const { useOfflineStore } = await import('./offlineStore')
const { useDeleteSetLog, useLogSet } = await import('../gym/useSession')
const { writeSetChanges, queueSetChanges, changesOf } = await import('../gym/useSessionSetChanges')
const { patchSetNumbers } = await import('../gym/useSetNumberCorrections')
const { runDelete } = await import('../gym/setDelete')
const { deleteEffects } = await import('../gym/workoutRules')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const toServerRow = (log: SetLog): Record<string, unknown> => ({
  id: log.id, session_id: 's1', exercise_id: log.exerciseId, week_plan_set_id: log.weekPlanSetId, set_number: log.setNumber, parent_set_id: log.parentSetId,
  stage_index: log.stageIndex, weight: log.weight, reps: log.reps, is_warmup: log.isWarmup, is_skipped: log.isSkipped, stage_kind: log.stageKind,
})
const putOnServer = (logs: SetLog[]) => logs.forEach((log) => world.server.set(`v2_set_logs:${log.id}`, toServerRow(log)))
const describeItem = (q: QueueItem) =>
  q.operation === 'upsert' ? `upsert ${q.table}${q.table === 'v2_session_set_changes' ? ` ${q.payload.kind} ${(q.payload.week_plan_set_id ?? q.payload.set_log_id) as string}` : `:${q.payload.id as string}`}`
  : q.operation === 'delete' ? `delete ${q.table}:${q.payload.id as string}`
  : `patch ${q.table}:${q.payload.id as string}`
const inQueueOrder = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map(describeItem)
const requests = () => world.requests.map((r) => r.replace(/(upsert v2_session_set_changes):[0-9a-f-]{36}/, '$1:<id>'))
const changeRows = () => [...world.server].filter(([key]) => key.startsWith('v2_session_set_changes:')).map(([, row]) => row)
const serverLogs = () => [...world.server.keys()].filter((k) => k.startsWith('v2_set_logs:')).map((k) => k.slice('v2_set_logs:'.length)).sort()
const stuck = () => queue().filter((q) => q.table === 'v2_session_set_changes' && q.payload.kind === 'pending_stages')

let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  world.online = false
  world.queue = []
  world.nextId = 1
  world.server = new Map()
  world.requests = []
  world.refused = []
  world.failing = new Map()
  world.queueDeleteFails = 0
  queryClient.clear()
  versionCheckAnswers() // the version check has answered: this version may send the queue (chunk 73)
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}) // the queue logs each failed attempt
})

/** What the screen does for one DELETE: `deleteEffects` over the view, then `runDelete` through the real producers. */
async function runDeleteOf(key: string, logs: SetLog[], cards: ReturnType<typeof card>[]) {
  const cached = queryClient.getQueryData(['v2_session', 's1']) as Session
  const view = viewOf(orderOf(cards), logs, [...changesOf(cached)])
  const effects = deleteEffects(rowKeyed(view, key), view)
  const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
  await act(async () => {
    await runDelete(effects, {
      deleteLog: (log) => result.current.mutateAsync({ id: log.id, parentSetId: log.parentSetId }),
      writers: {
        writeChanges: (writes) => writeSetChanges({ sessionId: 's1', userId: 'u1', writes, online: world.online }),
        patchNumbers: (patches) => patchSetNumbers({ sessionId: 's1', patches, logs, flush: world.online }),
        clearStageKind: async () => {
          throw new Error('not in this sequence')
        },
      },
    })
  })
  return effects
}

const seedSession = (logs: SetLog[]) => {
  putOnServer(logs)
  world.server.set('v2_sessions:s1', { id: 's1' })
  queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: logs, setChanges: [] } as unknown as Session)
}
const logParams = (log: SetLog, extra: Record<string, unknown> = {}) => ({
  id: log.id, exerciseId: log.exerciseId, weekPlanSetId: log.weekPlanSetId, setNumber: log.setNumber, weight: 60, reps: 8, rir: null, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isSkipped: false, restSeconds: null, setSeconds: null, enteredUnit: null, formRating: null,
  stageKind: log.stageKind ?? null, ...extra,
})
/** A later LOG of the same session, offline and then sent: it must not be held behind anything the reproduction left. */
async function laterLogLands() {
  world.online = false
  const later = renderHook(() => useLogSet('s1'), { wrapper })
  await act(async () => {
    await later.result.current.mutateAsync(logParams(headLog('bench', 3), { stageKind: null }))
  })
  world.online = true
  await flushSyncQueue()
  expect(serverLogs()).toContain('log.bench.3')
  expect(queue()).toEqual([])
}

// ─── 61's writes alone (before 62): a planned dropset head logged, one open drop deleted, then the head ─────────────────────────────────────────────────────────
describe('227 on 61’s writes: offline LOG of a planned dropset head, DELETE of one open drop, DELETE of the head', () => {
  const SPEC = () => card('bench', 'n d2 n')
  const head = () => headLog('bench', 2, { stageKind: 'dropset' })

  async function build() {
    seedSession([headLog('bench', 1)])
    const log = renderHook(() => useLogSet('s1'), { wrapper })
    await act(async () => {
      await log.result.current.mutateAsync(logParams(head()))
    })
    const logs = [headLog('bench', 1), head()]
    const first = await runDeleteOf('set:bench.2:stage:1', logs, [SPEC()])
    const second = await runDeleteOf('set:bench.2', logs, [SPEC()])
    return { first, second }
  }

  it('the queue is the review’s five writes: the log, the retyped and pending_stages rows keyed by it, its delete, the deleted row', async () => {
    const { first, second } = await build()
    expect(first.changes.map((c) => c.change.kind)).toEqual(['retyped', 'pending_stages'])
    expect(second.deleteOrder.map((l) => l.id)).toEqual(['log.bench.2'])
    expect(inQueueOrder()).toEqual([
      'upsert v2_set_logs:log.bench.2',
      'upsert v2_session_set_changes retyped bench.2',
      'upsert v2_session_set_changes pending_stages log.bench.2',
      'delete v2_set_logs:log.bench.2',
      'upsert v2_session_set_changes deleted bench.2',
    ])
  })

  it('the first pass cancels the log’s pair and the row that names it; the other rows land; nothing is refused, nothing is left, no notice, the finish does not wait', async () => {
    await build()
    world.online = true

    await flushSyncQueue()

    expect(requests()).toEqual(['upsert v2_session_set_changes:<id>', 'upsert v2_session_set_changes:<id>']) // the retyped row, then the deleted row that replaces it
    expect(world.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1']) // the log was never created
    expect(changeRows().map((r) => [r.kind, r.week_plan_set_id, r.set_log_id])).toEqual([['deleted', 'bench.2', null]])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
    await laterLogLands()
  })
})

// ─── 62: a set added in the session, given Dropset ×2, LOGGED (its log, then its pending_stages row) ────────────────────────────────────────────────────────────
describe('227 on 62’s writes: LOG of a staged added head, then DELETE of it', () => {
  const ADDED = { localId: 'a1', logId: 'log.bench.added1', type: staged('dropset', 2), place: 1 }
  const cards = () => [card('bench', 'n', { added: [ADDED] })]
  const addedHead = () => addedLog('bench', 1, { stageKind: 'dropset', place: 1 })
  const stagedLogParams = () => logParams(addedHead(), { setNumber: 2, weight: 50, addedPlace: 1 })

  /** LOG of the added head, as `logHead` sends it: the log (offline: `useLogSet`'s queue write), then its pending_stages row through the queue (not flushed). Returns the row's id. */
  async function logStagedAdded(): Promise<string> {
    seedSession([headLog('bench', 1)])
    const log = renderHook(() => useLogSet('s1'), { wrapper })
    await act(async () => {
      await log.result.current.mutateAsync(stagedLogParams())
      await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending(addedHead(), 'dropset', 2), id: null }], flush: false })
    })
    return stuck()[0].payload.id as string
  }

  it('offline DELETE of it: the pass cancels the log, its row and its delete together; nothing is sent, nothing is refused, no notice', async () => {
    await logStagedAdded()
    await runDeleteOf('added:bench:a1', [headLog('bench', 1), addedHead()], cards())
    expect(inQueueOrder()).toEqual(['upsert v2_set_logs:log.bench.added1', 'upsert v2_session_set_changes pending_stages log.bench.added1', 'delete v2_set_logs:log.bench.added1'])
    world.online = true

    await flushSyncQueue()

    expect(requests()).toEqual([])
    expect(world.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1'])
    expect(changeRows()).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
    await laterLogLands()
  })

  it('the row fails twice (a bad connection) and a QUEUED delete of its logged head goes in the second pass: the delete waits behind the row, which lands, and the delete takes it', async () => {
    const rowId = await logStagedAdded()
    world.failing.set(`upsert v2_session_set_changes:${rowId}`, 2)
    world.online = true
    await flushSyncQueue() // the log lands; the row fails
    expect(serverLogs()).toContain('log.bench.added1')
    expect(stuck()[0].attempts).toBe(1)

    world.online = false
    const del = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => {
      await del.result.current.mutateAsync({ id: 'log.bench.added1', parentSetId: null })
    })
    world.online = true
    await flushSyncQueue() // the row fails again; the delete must not go ahead of it
    expect(requests()).toEqual(['upsert v2_set_logs:log.bench.added1'])
    expect(inQueueOrder()).toEqual(['upsert v2_session_set_changes pending_stages log.bench.added1', 'delete v2_set_logs:log.bench.added1'])

    await flushSyncQueue() // the row lands, then the delete
    expect(requests()).toEqual(['upsert v2_set_logs:log.bench.added1', 'upsert v2_session_set_changes:<id>', 'delete v2_set_logs:log.bench.added1'])
    expect(world.refused).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1'])
    expect(changeRows()).toEqual([]) // the cascade took the row
    expect(queue()).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })
})

// ─── 227 (iii): the log is deleted ONLINE (a direct request) while its row is queued ────────────────────────────────────────────────────────────────────────────
describe('227 (iii): DELETE online of a log whose change row is still queued', () => {
  const addedHead = (n: number) => addedLog('bench', n, { stageKind: 'dropset', place: n })

  /** LOG offline of two staged added heads (a1, a2), each with its pending_stages row queued behind it, then one pass with both rows failing once. */
  async function twoRowsQueued() {
    seedSession([headLog('bench', 1)])
    const log = renderHook(() => useLogSet('s1'), { wrapper })
    for (const n of [1, 2]) {
      await act(async () => {
        await log.result.current.mutateAsync(logParams(addedHead(n), { id: `log.bench.added${n}`, setNumber: n + 1, weight: 50, addedPlace: n }))
        await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending(addedHead(n), 'dropset', 2), id: null }], flush: false })
      })
    }
    const rows = stuck().map((q) => q.payload.id as string)
    for (const id of rows) world.failing.set(`upsert v2_session_set_changes:${id}`, 1)
    world.online = true
    await flushSyncQueue() // both logs land, both rows fail once
    expect(serverLogs()).toEqual(['log.bench.1', 'log.bench.added1', 'log.bench.added2'])
    expect(stuck().map((q) => [q.payload.set_log_id, q.attempts])).toEqual([['log.bench.added1', 1], ['log.bench.added2', 1]])
    return rows
  }
  async function deleteOnline(id: string) {
    const del = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => {
      await del.result.current.mutateAsync({ id, parentSetId: null })
    })
  }

  it('once the request has gone through, the row of that log leaves the queue and only that one: the other log’s row is sent by the next pass', async () => {
    await twoRowsQueued()

    await deleteOnline('log.bench.added1')
    expect(world.requests[world.requests.length - 1]).toBe('delete v2_set_logs:log.bench.added1') // the request went first
    expect(stuck().map((q) => q.payload.set_log_id)).toEqual(['log.bench.added2'])

    await flushSyncQueue()

    expect(world.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1', 'log.bench.added2'])
    expect(changeRows().map((r) => r.set_log_id)).toEqual(['log.bench.added2'])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })

  it('a row that had given up (the notice is showing) is dropped with its log, and the notice goes', async () => {
    seedSession([headLog('bench', 1)])
    const log = renderHook(() => useLogSet('s1'), { wrapper })
    await act(async () => {
      await log.result.current.mutateAsync(logParams(addedHead(1), { id: 'log.bench.added1', setNumber: 2, weight: 50, addedPlace: 1 }))
      await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending(addedHead(1), 'dropset', 2), id: null }], flush: false })
    })
    world.failing.set(`upsert v2_session_set_changes:${stuck()[0].payload.id as string}`, 5)
    world.online = true
    for (let pass = 1; pass <= 5; pass++) await flushSyncQueue()
    expect(useOfflineStore.getState().syncFailures.map((f) => f.table)).toEqual(['v2_session_set_changes'])

    await deleteOnline('log.bench.added1')

    expect(queue()).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })

  it('1.1’s shape: a stage logged offline under a head the server holds, its first send failed; the head is deleted online (the drop first, the head last): the stage’s queued upsert goes with it', async () => {
    const head = headLog('bench', 2, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    seedSession([headLog('bench', 1), head])
    const log = renderHook(() => useLogSet('s1'), { wrapper })
    await act(async () => {
      await log.result.current.mutateAsync(logParams(drop, { parentSetId: head.id, stageIndex: 1, isDropset: true }))
    })
    world.failing.set(`upsert v2_set_logs:${drop.id}`, 1)
    world.online = true
    await flushSyncQueue() // the reconnect flush: the stage's first send fails
    expect(queue().map((q) => [q.payload.id, q.attempts])).toEqual([[drop.id, 1]])

    await deleteOnline(drop.id)
    await deleteOnline(head.id)
    expect(queue()).toEqual([])
    await flushSyncQueue()

    expect(world.refused).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1'])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })

  it('a delete that fails leaves the rows (and the log) in place: nothing is dropped before the request has gone through', async () => {
    await twoRowsQueued()
    world.failing.set('delete v2_set_logs:log.bench.added1', 1)

    const del = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => {
      await expect(del.result.current.mutateAsync({ id: 'log.bench.added1', parentSetId: null })).rejects.toBeTruthy()
    })

    expect(stuck().map((q) => q.payload.set_log_id)).toEqual(['log.bench.added1', 'log.bench.added2'])
    expect(serverLogs()).toContain('log.bench.added1')
    await flushSyncQueue()
    expect(changeRows().map((r) => r.set_log_id)).toEqual(['log.bench.added1', 'log.bench.added2'])
    expect(world.refused).toEqual([])
  })

  it('a cleanup the device’s database refuses is logged and does not fail the delete that has been done: the log stays gone from the screen', async () => {
    await twoRowsQueued()
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [headLog('bench', 1), addedHead(1), addedHead(2)], setChanges: [] } as unknown as Session)
    world.queueDeleteFails = 1

    await deleteOnline('log.bench.added1') // resolves: the request went through

    expect(serverLogs()).toEqual(['log.bench.1', 'log.bench.added2'])
    const cached = queryClient.getQueryData(['v2_session', 's1']) as Session
    expect(cached.setLogs?.map((l) => l.id)).toEqual(['log.bench.1', 'log.bench.added2']) // not put back by a failed mutation
    expect(errorLog).toHaveBeenCalledWith('[sync] could not drop the queued rows of a deleted log', expect.any(Error))
    expect(stuck().map((q) => q.payload.set_log_id)).toEqual(['log.bench.added1', 'log.bench.added2']) // nothing was dropped: today’s behaviour, no worse
  })

  it('offline, a delete queues its item and drops nothing: the rows are the queue’s to cancel or send, in the pass', async () => {
    await twoRowsQueued()
    world.online = false

    await deleteOnline('log.bench.added1')

    expect(inQueueOrder()).toEqual([
      'upsert v2_session_set_changes pending_stages log.bench.added1',
      'upsert v2_session_set_changes pending_stages log.bench.added2',
      'delete v2_set_logs:log.bench.added1',
    ])
    world.online = true
    await flushSyncQueue() // the row failed once and the log is on the server: both go, then the delete takes the first row; the second row lands
    expect(world.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(changeRows().map((r) => r.set_log_id)).toEqual(['log.bench.added2'])
  })
})

// ─── 63: UNLOG deletes a log that a change row can name (the third way to reach 227, chunk 62's review) ─────────────────────────────────────────────
// Chunk 63's unlog sends `unlogEffects`' change rows (`writeSetChanges`) and then deletes its logs one by one through `useDeleteSetLog`, stages first: the writes DELETE makes to the
// queue, with no `deleted` row. These are the 62 review's probes P1 (offline, the pair never sent), P2 (the row failing twice, a queued delete in the second pass) and P3
// (online) with UNLOG in place of DELETE (DECISIONS 227's evidence): no row is left refused and the queue is empty after the passes.
const { unlogEffects } = await import('../gym/workoutRules')

describe('227 on 63’s writes: LOG of a staged added head, then UNLOG of it', () => {
  const ADDED = { localId: 'a1', logId: 'log.bench.added1', type: staged('dropset', 2), place: 1 }
  const cards = () => [card('bench', 'n', { added: [ADDED] })]
  const addedHead = () => addedLog('bench', 1, { stageKind: 'dropset', place: 1 })
  const stagedLogParams = () => logParams(addedHead(), { setNumber: 2, weight: 50, addedPlace: 1 })

  async function logStagedAdded(): Promise<string> {
    seedSession([headLog('bench', 1)])
    const log = renderHook(() => useLogSet('s1'), { wrapper })
    await act(async () => {
      await log.result.current.mutateAsync(stagedLogParams())
      await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending(addedHead(), 'dropset', 2), id: null }], flush: false })
    })
    return stuck()[0].payload.id as string
  }

  /** What the card does for one UNLOG: `unlogEffects` over the view, its change rows, then its logs through `useDeleteSetLog` (`handleUnlogRow`). */
  async function runUnlogOf(key: string, logs: SetLog[], cardList: ReturnType<typeof card>[]) {
    const cached = queryClient.getQueryData(['v2_session', 's1']) as Session
    const view = viewOf(orderOf(cardList), logs, [...changesOf(cached)])
    const effects = unlogEffects(rowKeyed(view, key), view as Parameters<typeof unlogEffects>[1])
    const del = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => {
      if (effects.changes.length > 0) await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: effects.changes, online: world.online })
      for (const log of effects.deleteOrder) await del.result.current.mutateAsync({ id: log.id, parentSetId: log.parentSetId })
    })
    return effects
  }

  it('P1, offline: the pass cancels the log, its row and its delete together; nothing is sent, nothing is refused, no notice, and a later log of the session still goes', async () => {
    await logStagedAdded()
    const effects = await runUnlogOf('added:bench:a1', [headLog('bench', 1), addedHead()], cards())
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.added1'])
    expect(inQueueOrder()).toEqual(['upsert v2_set_logs:log.bench.added1', 'upsert v2_session_set_changes pending_stages log.bench.added1', 'delete v2_set_logs:log.bench.added1'])
    world.online = true

    await flushSyncQueue()

    expect(requests()).toEqual([])
    expect(world.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1'])
    expect(changeRows()).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
    await laterLogLands()
  })

  it('P2, the row fails twice and a QUEUED unlog of its logged head goes in the second pass: the delete waits behind the row, which lands, and the delete takes it', async () => {
    const rowId = await logStagedAdded()
    world.failing.set(`upsert v2_session_set_changes:${rowId}`, 2)
    world.online = true
    await flushSyncQueue() // the log lands; the row fails
    expect(serverLogs()).toContain('log.bench.added1')
    expect(stuck()[0].attempts).toBe(1)

    world.online = false
    await runUnlogOf('added:bench:a1', [headLog('bench', 1), addedHead()], cards())
    world.online = true
    await flushSyncQueue() // the row fails again; the delete must not go ahead of it
    expect(requests()).toEqual(['upsert v2_set_logs:log.bench.added1'])
    expect(inQueueOrder()).toEqual(['upsert v2_session_set_changes pending_stages log.bench.added1', 'delete v2_set_logs:log.bench.added1'])

    await flushSyncQueue() // the row lands, then the delete
    expect(requests()).toEqual(['upsert v2_set_logs:log.bench.added1', 'upsert v2_session_set_changes:<id>', 'delete v2_set_logs:log.bench.added1'])
    expect(world.refused).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1'])
    expect(changeRows()).toEqual([]) // the cascade took the row
    expect(queue()).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })

  it('P3, online: the request goes first, then the row still queued for that log leaves the queue; the next pass sends nothing refused', async () => {
    const rowId = await logStagedAdded()
    world.failing.set(`upsert v2_session_set_changes:${rowId}`, 1)
    world.online = true
    await flushSyncQueue() // the log lands, the row fails once
    expect(stuck().map((q) => q.payload.set_log_id)).toEqual(['log.bench.added1'])

    await runUnlogOf('added:bench:a1', [headLog('bench', 1), addedHead()], cards())
    expect(world.requests[world.requests.length - 1]).toBe('delete v2_set_logs:log.bench.added1')
    expect(stuck()).toEqual([])

    await flushSyncQueue()

    expect(world.refused).toEqual([])
    expect(queue()).toEqual([])
    expect(serverLogs()).toEqual(['log.bench.1'])
    expect(changeRows()).toEqual([])
    expect(useOfflineStore.getState().syncFailures).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(false)
  })
})
