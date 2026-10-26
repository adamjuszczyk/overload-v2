// @vitest-environment jsdom
// Chunk 62 (G47: "A set type change on a logged set ... need[s] a connection"; DECISIONS 168 (a): "the switch and the renumbering of later logged sets queue offline, like
// a delete"; TASKS-1.2 62 Verification: "offline, Warmup on an open set with a logged set after it queues the change row and that set's number patch (168 (a); the fake
// queue asserts both)", the swapped dropset's `pending_stages` row "online and through the queue"). The producers are the real ones (`writeSetChanges`, `queueSetChanges`,
// `patchSetNumbers`, `updateSetLog`, `useLogSet`'s offline branch, `useDeleteSetLog`), driven by the real `runTypeChange` over what the real `applySetTypeChange` says, and
// the replay is the real `flushSyncQueue`, against a fake that models the tables' own refusals: 042's checks and indexes, the `set_log_id` foreign key of a `pending_stages`
// row, the drops-first foreign key of `v2_set_logs` and 035's `v2_set_logs_check`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Session, SetLog } from '../../types'
import { card, dropLog, headLog, orderOf, pending, rowKeyed, staged, viewOf } from '../gym/workoutRules.testutil'

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
  tables: new Set<string>(),
  failing: new Map<string, number>(),
  deviceLogDeletes: [] as string[],
  // Chunk 61's review 1 (F1): heads whose stage kind was cleared while a drop log still stood under them (DECISIONS 147 (a): a head with no drop is a normal set).
  normalHeadWithDrop: [] as string[],
}))
const queue = () => world.queue as QueueItem[]

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id) }),
      toArray: async () => [...queue()],
      add: async (item: Omit<QueueItem, 'id'>) => void queue().push({ ...item, id: world.nextId++ }),
      delete: async (id: number) => void (world.queue = queue().filter((q) => q.id !== id)),
      update: async (id: number, patch: Partial<QueueItem>) => void (world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))),
      bulkUpdate: async () => {},
    },
    set_logs: {
      delete: async (id: string) => void world.deviceLogDeletes.push(id),
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
    from: (table: string) => {
      world.tables.add(table)
      return {
      upsert: async (row: Record<string, unknown>) => {
        const tag = `upsert ${table}:${row.id}`
        if (fails(tag)) return { error: { message: 'Failed to fetch' } }
        if (table === 'v2_set_logs') {
          const head = row.parent_set_id as string | undefined
          if (head && !world.server.has(`${table}:${head}`)) return refusal('23503', 'violates foreign key constraint')
        }
        if (table === 'v2_session_set_changes') {
          const refused = changeRowRefusal(row)
          if (refused) return refused
          // `set_log_id references v2_set_logs(id)`: a `pending_stages` row for a log the server doesn't hold yet is refused
          if (row.set_log_id && !world.server.has(`v2_set_logs:${row.set_log_id as string}`)) return refusal('23503', 'v2_session_set_changes_set_log_id_fkey')
        }
        world.requests.push(tag)
        world.server.set(`${table}:${row.id}`, { ...(world.server.get(`${table}:${row.id}`) ?? {}), ...row })
        return { error: null }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (column: string, id: string) => {
          if (column !== 'id') throw new Error(`a queued patch filters on id only, not ${column}`)
          if (fails(`patch ${table}:${id}`)) return { error: { message: 'Failed to fetch' } }
          // (keys sorted: their order is the service's, not what the test is about)
          world.requests.push(`patch ${table}:${id} ${JSON.stringify(Object.fromEntries(Object.entries(patch).sort(([a], [b]) => a.localeCompare(b))))}`)
          const row = world.server.get(`${table}:${id}`)
          if (row) {
            const next = { ...row, ...patch }
            // 035's `v2_set_logs_check`: a working set (not skipped, not a warmup) has a weight and reps
            if (table === 'v2_set_logs' && !next.is_skipped && !next.is_warmup && (next.weight == null || next.reps == null)) return refusal('23514', 'v2_set_logs_check')
            world.server.set(`${table}:${id}`, next)
            if (patch.stage_kind === null && [...world.server.values()].some((other) => other.parent_set_id === id)) world.normalHeadWithDrop.push(id)
          }
          return { error: null }
        },
      }),
      delete: () => ({
        eq: async (column: string, id: string) => {
          if (column !== 'id') throw new Error(`a queued delete filters on id only, not ${column}`)
          if (fails(`delete ${table}:${id}`)) return { error: { message: 'Failed to fetch' } }
          world.requests.push(`delete ${table}:${id}`)
          world.server.delete(`${table}:${id}`)
          for (const [key, row] of [...world.server]) if (key.startsWith(`${table}:`) && row.parent_set_id === id) world.server.delete(key)
          return { error: null }
        },
      }),
      }
    },
  },
}))


const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue } = await import('./useSyncQueue')
const { useDeleteSetLog, useLogSet } = await import('../gym/useSession')
const { writeSetChanges, queueSetChanges } = await import('../gym/useSessionSetChanges')
const { patchSetNumbers } = await import('../gym/useSetNumberCorrections')
const { runTypeChange } = await import('../gym/setTypeChange')
const { applySetTypeChange, typeChangeNeedsNumbers } = await import('../gym/workoutRules')
const { updateSetLog } = await import('../gym/sessionService')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const toServerRow = (log: SetLog): Record<string, unknown> => ({
  id: log.id, session_id: 's1', exercise_id: log.exerciseId, week_plan_set_id: log.weekPlanSetId, set_number: log.setNumber, parent_set_id: log.parentSetId,
  stage_index: log.stageIndex, weight: log.weight, reps: log.reps, is_warmup: log.isWarmup, is_skipped: log.isSkipped, stage_kind: log.stageKind,
})
const putOnServer = (logs: SetLog[]) => logs.forEach((log) => world.server.set(`v2_set_logs:${log.id}`, toServerRow(log)))
const describeItem = (q: QueueItem) =>
  q.operation === 'upsert' ? `upsert ${q.table}${q.table === 'v2_session_set_changes' ? ` ${q.payload.kind} ${(q.payload.week_plan_set_id ?? q.payload.set_log_id) as string}` : `:${q.payload.id as string}`}`
  : q.operation === 'delete' ? `delete ${q.table}:${q.payload.id as string}`
  : `patch ${q.table}:${q.payload.id as string} ${JSON.stringify(Object.fromEntries(Object.entries(q.payload).filter(([key]) => key !== 'id')))}`
const inQueueOrder = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map(describeItem)
const requests = () => world.requests.map((r) => r.replace(/(upsert v2_session_set_changes):[0-9a-f-]{36}/, '$1:<id>'))
const changeRows = () => [...world.server].filter(([key]) => key.startsWith('v2_session_set_changes:')).map(([, row]) => row)

const BENCH = () => card('bench', 'n n n')

/** SET TYPE on the bench row `key`, as the card runs it: `applySetTypeChange`, then `runTypeChange` through the real producers. */
async function retype(
  key: string,
  pick: Parameters<typeof applySetTypeChange>[0]['pick'],
  logs: SetLog[],
  opts: { numbers?: { weight: number; reps: number }; order?: ReturnType<typeof BENCH>[] } = {},
) {
  const view = viewOf(orderOf(opts.order ?? [BENCH()]), logs)
  const row = rowKeyed(view, key)
  const needs = typeChangeNeedsNumbers({ row, pick, session: view })
  const effects = applySetTypeChange({ row, pick, session: view, ...(needs ? { numbers: opts.numbers } : {}) })
  const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
  queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: logs, setChanges: [] } as unknown as Session)
  await act(async () => {
    await runTypeChange(row, effects, {
      writers: {
        online: world.online,
        writeChanges: (writes) => writeSetChanges({ sessionId: 's1', userId: 'u1', writes, online: world.online }),
        patchNumbers: (patches) => patchSetNumbers({ sessionId: 's1', patches, logs, flush: world.online }),
        patchLog: (id, changes) => updateSetLog(id, changes),
      },
      deleteLog: (log) => result.current.mutateAsync({ id: log.id, parentSetId: log.parentSetId }),
      keepAddedType: () => {},
    })
  })
  return effects
}

beforeEach(() => {
  world.online = false
  world.queue = []
  world.nextId = 1
  world.server = new Map()
  world.requests = []
  world.tables = new Set()
  world.failing = new Map()
  world.deviceLogDeletes = []
  world.normalHeadWithDrop = []
  queryClient.clear()
})

describe('Warmup on an open planned set with a logged set after it, offline (168 (a))', () => {
  it('queues the `retyped` row as an upsert and the later sets\' numbers as patches, in that order, and sends nothing', async () => {
    const logs = [headLog('bench', 2), headLog('bench', 3)]
    putOnServer(logs)
    await retype('set:bench.1', { kind: 'warmup' }, logs)
    expect(world.requests).toEqual([])
    expect(inQueueOrder()).toEqual([
      'upsert v2_session_set_changes retyped bench.1',
      'patch v2_set_logs:log.bench.2 {"set_number":1}',
      'patch v2_set_logs:log.bench.3 {"set_number":2}',
    ])
    const cached = queryClient.getQueryData(['v2_session', 's1']) as Session
    expect(cached.setChanges?.map((c) => c.kind)).toEqual(['retyped']) // the screen draws it at once
    expect(cached.setLogs?.map((l) => l.setNumber)).toEqual([1, 2])
  })

  it('on reconnect the queue sends exactly those, in that order: the server ends with a warmup row for the planned set (no stage kind, count 0) and the two logs renumbered', async () => {
    const logs = [headLog('bench', 2), headLog('bench', 3)]
    putOnServer(logs)
    await retype('set:bench.1', { kind: 'warmup' }, logs)
    world.online = true
    await flushSyncQueue()
    expect(requests()).toEqual(['upsert v2_session_set_changes:<id>', 'patch v2_set_logs:log.bench.2 {"set_number":1}', 'patch v2_set_logs:log.bench.3 {"set_number":2}'])
    expect(changeRows()).toHaveLength(1)
    expect(changeRows()[0]).toMatchObject({ kind: 'retyped', week_plan_set_id: 'bench.1', set_log_id: null, session_id: 's1', user_id: 'u1', is_warmup: true, stage_kind: null, stage_count: 0 })
    expect(world.server.get('v2_set_logs:log.bench.2')?.set_number).toBe(1)
    expect(world.server.get('v2_set_logs:log.bench.3')?.set_number).toBe(2)
    expect(queue()).toEqual([])
    expect([...world.tables].sort()).toEqual(['v2_session_set_changes', 'v2_set_logs']) // the plan is not reached
  })

  it('Dropset on an open planned set offline is the one queued row and nothing else; online it is the same one request', async () => {
    await retype('set:bench.2', staged('dropset', 2), [headLog('bench', 1)])
    expect(inQueueOrder()).toEqual(['upsert v2_session_set_changes retyped bench.2'])
    world.queue = []
    world.online = true
    await retype('set:bench.2', staged('dropset', 2), [headLog('bench', 1)])
    expect(requests()).toEqual(['upsert v2_session_set_changes:<id>'])
    expect(changeRows()[0]).toMatchObject({ kind: 'retyped', week_plan_set_id: 'bench.2', is_warmup: false, stage_kind: 'dropset', stage_count: 2 })
    expect(queue()).toEqual([])
  })
})

describe('a logged set\'s type change needs a connection (G47): offline it is refused before anything is queued or sent', () => {
  it('Dropset on a logged set offline throws the connection reason and queues nothing', async () => {
    const logs = [headLog('bench', 1)]
    putOnServer(logs)
    await expect(retype('set:bench.1', staged('dropset', 1), logs)).rejects.toThrow('Requires a connection')
    expect(queue()).toEqual([])
    expect(world.requests).toEqual([])
  })
})

describe('a logged set\'s type change online: the log\'s patch first, then the rows, then the numbers (one request each)', () => {
  it('Dropset on a logged planned set: the patch of its two type columns, the `retyped` row, the `pending_stages` row keyed by the log; the plan is not reached', async () => {
    const logs = [headLog('bench', 1), headLog('bench', 2)]
    putOnServer(logs)
    world.online = true
    await retype('set:bench.2', staged('dropset', 2), logs)
    expect(requests()).toEqual(['patch v2_set_logs:log.bench.2 {"is_warmup":false,"stage_kind":"dropset"}', 'upsert v2_session_set_changes:<id>', 'upsert v2_session_set_changes:<id>'])
    expect(world.server.get('v2_set_logs:log.bench.2')).toMatchObject({ is_warmup: false, stage_kind: 'dropset' })
    const rows = changeRows()
    expect(rows.find((r) => r.kind === 'retyped')).toMatchObject({ week_plan_set_id: 'bench.2', set_log_id: null, stage_kind: 'dropset', stage_count: 2, is_warmup: false })
    expect(rows.find((r) => r.kind === 'pending_stages')).toMatchObject({ set_log_id: 'log.bench.2', week_plan_set_id: null, stage_kind: 'dropset', stage_count: 2, is_warmup: false })
    expect(queue()).toEqual([])
    expect([...world.tables].sort()).toEqual(['v2_session_set_changes', 'v2_set_logs'])
  })

  it('Normal on a dropset with a logged drop: the log patch, the drop\'s delete, the Normal row; the drop is gone from the server', async () => {
    const head = headLog('bench', 2, { stageKind: 'dropset' })
    const logs = [headLog('bench', 1), head, dropLog(head, 1)]
    putOnServer(logs)
    world.online = true
    await retype('set:bench.2', { kind: 'normal' }, logs, { order: [card('bench', 'n d1 n')] })
    expect(requests()).toEqual(['patch v2_set_logs:log.bench.2 {"is_warmup":false,"stage_kind":null}', 'delete v2_set_logs:log.bench.2.d1', 'upsert v2_session_set_changes:<id>'])
    expect(world.server.has('v2_set_logs:log.bench.2.d1')).toBe(false)
    expect(world.server.get('v2_set_logs:log.bench.2')).toMatchObject({ stage_kind: null })
    expect(changeRows()[0]).toMatchObject({ kind: 'retyped', week_plan_set_id: 'bench.2', stage_kind: null, stage_count: 0, is_warmup: false })
  })

  it('Warmup on the logged 02 of 01–03: the log patch, the row, then the renumber (03 to 2, 02\'s own log to its warmup number)', async () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    putOnServer(logs)
    world.online = true
    await retype('set:bench.2', { kind: 'warmup' }, logs)
    expect(requests()).toEqual([
      'patch v2_set_logs:log.bench.2 {"is_warmup":true,"stage_kind":null}',
      'upsert v2_session_set_changes:<id>',
      'patch v2_set_logs:log.bench.2 {"set_number":1}',
      'patch v2_set_logs:log.bench.3 {"set_number":2}',
    ])
    expect(world.server.get('v2_set_logs:log.bench.3')?.set_number).toBe(2)
    expect(world.server.get('v2_set_logs:log.bench.2')).toMatchObject({ is_warmup: true, set_number: 1 })
  })
})

describe('a warmup logged with no weight or reps made a working set (DECISIONS 152): the table refuses the type alone, so the type and the numbers are one request', () => {
  const numberless = () => headLog('bench', 1, { warmup: true, weight: null, reps: null })

  it('the control: the type alone is refused by the table (23514 v2_set_logs_check) and nothing is written', async () => {
    putOnServer([numberless()])
    world.online = true
    await expect(updateSetLog('log.bench.1', { isWarmup: false, stageKind: null })).rejects.toMatchObject({ code: '23514' })
    expect(world.server.get('v2_set_logs:log.bench.1')).toMatchObject({ is_warmup: true, weight: null, reps: null })
  })

  it('the card\'s write is one patch holding the type and both numbers: accepted, and the log ends as a working set with them', async () => {
    const logs = [numberless()]
    putOnServer(logs)
    world.online = true
    const effects = await retype('set:bench.1', { kind: 'normal' }, logs, { numbers: { weight: 40, reps: 6 }, order: [card('bench', 'w')] })
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null, weight: 40, reps: 6 })
    expect(requests()[0]).toBe('patch v2_set_logs:log.bench.1 {"is_warmup":false,"reps":6,"stage_kind":null,"weight":40}')
    expect(world.server.get('v2_set_logs:log.bench.1')).toMatchObject({ is_warmup: false, weight: 40, reps: 6 })
  })
})

describe('LOG of a set added in the session and given a staged type: its `pending_stages` row is queued after its log, online or not (DECISIONS 161; TASKS 62: "online and through the queue")', () => {
  const params = (id: string) => ({
    id, exerciseId: 'ex.bench', weekPlanSetId: null, setNumber: 1, weight: 50, reps: 8, rir: null, note: null, isDropset: false, parentSetId: null, stageIndex: 0,
    isSkipped: false, restSeconds: null, setSeconds: null, enteredUnit: null, formRating: null, stageKind: 'dropset' as const, addedPlace: 1,
  })
  const logAddedDropset = async (id: string, flush: boolean) => {
    const { result } = renderHook(() => useLogSet('s1'), { wrapper })
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [], setChanges: [] } as unknown as Session)
    await act(async () => {
      await result.current.mutateAsync(params(id))
      await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending({ id } as SetLog, 'dropset', 2), id: null }], flush })
    })
  }

  it('offline: the log\'s upsert, then the row\'s, in that order; nothing is sent', async () => {
    await logAddedDropset('added-1', false)
    expect(inQueueOrder()).toEqual(['upsert v2_set_logs:added-1', 'upsert v2_session_set_changes pending_stages added-1'])
    expect(world.requests).toEqual([])
    const cached = queryClient.getQueryData(['v2_session', 's1']) as Session
    expect(cached.setChanges?.map((c) => c.kind)).toEqual(['pending_stages']) // the drops are drawn at once
  })

  it('on reconnect the log lands first and the row after it: the server holds a dropset head with its two pending drops', async () => {
    await logAddedDropset('added-1', false)
    world.online = true
    await flushSyncQueue()
    expect(requests()).toEqual(['upsert v2_set_logs:added-1', 'upsert v2_session_set_changes:<id>'])
    expect(world.server.get('v2_set_logs:added-1')).toMatchObject({ stage_kind: 'dropset' })
    expect(changeRows()[0]).toMatchObject({ kind: 'pending_stages', set_log_id: 'added-1', week_plan_set_id: null, stage_kind: 'dropset', stage_count: 2, is_warmup: false, user_id: 'u1', session_id: 's1' })
    expect(queue()).toEqual([])
  })

  it('the log\'s upsert failing in the first pass: the row is refused (no log yet: 23503), both stay queued, and the next pass lands both, log first', async () => {
    await logAddedDropset('added-1', false)
    world.failing.set('upsert v2_set_logs:added-1', 1)
    world.online = true
    await flushSyncQueue()
    expect(world.server.has('v2_set_logs:added-1')).toBe(false)
    expect(changeRows()).toEqual([])
    expect(queue()).toHaveLength(2)
    await flushSyncQueue()
    expect(requests()).toEqual(['upsert v2_set_logs:added-1', 'upsert v2_session_set_changes:<id>'])
    expect(queue()).toEqual([])
  })

  it('online it is sent at once, as one request to the change table, and the queue is empty', async () => {
    world.online = true
    putOnServer([headLog('bench', 1)])
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [], setChanges: [] } as unknown as Session)
    await act(async () => {
      await queueSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: pending(headLog('bench', 1), 'dropset', 1), id: null }], flush: true })
    })
    expect(requests()).toEqual(['upsert v2_session_set_changes:<id>'])
    expect(queue()).toEqual([])
    expect(((queryClient.getQueryData(['v2_session', 's1']) as Session).setChanges ?? []).map((c) => c.kind)).toEqual(['pending_stages'])
  })
})
