// @vitest-environment jsdom
// Chunk 61 (G47: "delete set ... work[s] offline and sync[s] later through the sync queue"; TASKS-1.2 61 Verification: "offline: the delete lands in the
// queue as `delete` items behind the row's own upsert, stages first, and the change-row insert as an upsert (the fake queue asserts order)"; the carry note
// of 57's review: "Choose the queueing order and test it"). The producers are the real ones (`useDeleteSetLog`'s offline branch, `writeSetChanges`,
// `patchSetNumbers`), driven by the real `runDelete` over what the real `deleteEffects` says, and the replay is the real `flushSyncQueue`, against a fake
// that models the tables' own refusals: 042's checks on `v2_session_set_changes` and its two partial unique indexes, the drops-first foreign key and the
// head's cascade on `v2_set_logs`. As RULES says of a queue's ordering ("proven with the earlier write failing in the pass that would send the later one"),
// the order is also run with an earlier write failing.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Session, SetLog } from '../../types'
import { card, dropLog, headLog, orderOf, rowKeyed, viewOf } from '../gym/workoutRules.testutil'

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
        }
        world.requests.push(tag)
        world.server.set(`${table}:${row.id}`, { ...(world.server.get(`${table}:${row.id}`) ?? {}), ...row })
        return { error: null }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (column: string, id: string) => {
          if (column !== 'id') throw new Error(`a queued patch filters on id only, not ${column}`)
          world.requests.push(`patch ${table}:${id} ${JSON.stringify(patch)}`)
          const row = world.server.get(`${table}:${id}`)
          if (row) world.server.set(`${table}:${id}`, { ...row, ...patch })
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
const { flushSyncQueue, MAX_SYNC_ATTEMPTS, hasQueuedWritesFor } = await import('./useSyncQueue')
const { useDeleteSetLog } = await import('../gym/useSession')
const { writeSetChanges } = await import('../gym/useSessionSetChanges')
const { patchSetNumbers } = await import('../gym/useSetNumberCorrections')
const { runDelete } = await import('../gym/setDelete')
const { deleteEffects } = await import('../gym/workoutRules')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

// Bench: 01 plain, 02 a dropset with one drop, 03 plain; all logged, 02 with its drop (set_number is the number the row shows).
const BENCH = () => card('bench', 'n d1 n')
const head1 = () => headLog('bench', 1)
const head2 = () => headLog('bench', 2, { stageKind: 'dropset' })
const drop2 = () => dropLog(head2(), 1)
const head3 = () => headLog('bench', 3)
const ALL_LOGS = () => [head1(), head2(), drop2(), head3()]

const toServerRow = (log: SetLog): Record<string, unknown> => ({ id: log.id, session_id: 's1', exercise_id: log.exerciseId, week_plan_set_id: log.weekPlanSetId, set_number: log.setNumber, parent_set_id: log.parentSetId, stage_index: log.stageIndex })
const putOnServer = (logs: SetLog[]) => logs.forEach((log) => world.server.set(`v2_set_logs:${log.id}`, toServerRow(log)))
const serverKeys = (table: string) => [...world.server.keys()].filter((k) => k.startsWith(`${table}:`)).map((k) => k.slice(table.length + 1)).sort()
const describeItem = (q: QueueItem) =>
  q.operation === 'upsert' ? `upsert ${q.table}${q.table === 'v2_session_set_changes' ? ` ${q.payload.kind} ${(q.payload.week_plan_set_id ?? q.payload.set_log_id) as string}` : `:${q.payload.id as string}`}`
  : q.operation === 'delete' ? `delete ${q.table}:${q.payload.id as string}${q.parentSetId ? ` under ${q.parentSetId}` : ''} (session ${q.sessionId})`
  : `patch ${q.table}:${q.payload.id as string} ${JSON.stringify({ set_number: q.payload.set_number })}`
const inQueueOrder = () => [...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map(describeItem)

/** DELETE of bench 02, as the screen runs it, through the real producers. */
async function deleteBench02(logs: SetLog[]) {
  const view = viewOf(orderOf([BENCH()]), logs)
  const effects = deleteEffects(rowKeyed(view, 'set:bench.2'), view)
  const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
  queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: logs, setChanges: [] } as unknown as Session)
  await act(async () => {
    await runDelete(effects, {
      deleteLog: (log) => result.current.mutateAsync({ id: log.id, parentSetId: log.parentSetId }),
      writers: {
        online: world.online,
        writeChanges: (writes) => writeSetChanges({ sessionId: 's1', userId: 'u1', writes, online: world.online }),
        patchNumbers: (patches) => patchSetNumbers({ sessionId: 's1', patches, logs, flush: world.online }),
        clearStageKind: async () => {
          throw new Error('not in this delete')
        },
      },
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
  queryClient.clear()
})

describe('DELETE of a logged set with a logged drop, offline (G47)', () => {
  it('queues, in the order it must be sent: the drop\'s delete (naming its head), the head\'s, the change row as an upsert, then the renumber as a patch; and sends nothing', async () => {
    putOnServer(ALL_LOGS())
    await deleteBench02(ALL_LOGS())
    expect(world.requests).toEqual([])
    expect(inQueueOrder()).toEqual([
      'delete v2_set_logs:log.bench.2.d1 under log.bench.2 (session s1)',
      'delete v2_set_logs:log.bench.2 (session s1)',
      'upsert v2_session_set_changes deleted bench.2',
      'patch v2_set_logs:log.bench.3 {"set_number":2}',
    ])
    // the device's own copies of the deleted logs go at once, and the screen's cache has the row and none of them
    expect(world.deviceLogDeletes).toEqual(['log.bench.2.d1', 'log.bench.2'])
    const cached = queryClient.getQueryData(['v2_session', 's1']) as Session
    expect(cached.setLogs?.map((l) => l.id)).toEqual(['log.bench.1', 'log.bench.3'])
    expect(cached.setLogs?.find((l) => l.id === 'log.bench.3')?.setNumber).toBe(2)
    expect(cached.setChanges?.map((c) => c.kind)).toEqual(['deleted'])
  })

  it('on reconnect the queue sends exactly those, in that order, and the server ends with 02 gone, its change row there and 03 renumbered', async () => {
    putOnServer(ALL_LOGS())
    await deleteBench02(ALL_LOGS())
    world.online = true
    await flushSyncQueue()
    expect(world.requests.map((r) => r.replace(/upsert v2_session_set_changes:[0-9a-f-]{36}/, 'upsert v2_session_set_changes:<id>'))).toEqual([
      'delete v2_set_logs:log.bench.2.d1',
      'delete v2_set_logs:log.bench.2',
      'upsert v2_session_set_changes:<id>',
      'patch v2_set_logs:log.bench.3 {"set_number":2}',
    ])
    expect(serverKeys('v2_set_logs')).toEqual(['log.bench.1', 'log.bench.3'])
    expect(world.server.get('v2_set_logs:log.bench.3')?.set_number).toBe(2)
    const rows = [...world.server].filter(([key]) => key.startsWith('v2_session_set_changes:')).map(([, row]) => row)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'deleted', week_plan_set_id: 'bench.2', set_log_id: null, session_id: 's1', user_id: 'u1', is_warmup: false, stage_kind: null, stage_count: 0 })
    expect(queue()).toEqual([])
    // the plan is untouched: the tables the delete reached are the session's own, never `v2_week_plan_sets` (TASKS 61: absence of any plan write except CUES)
    expect([...world.tables].sort()).toEqual(['v2_session_set_changes', 'v2_set_logs'])
  })

  it('online, the same delete is the same four requests in the same order, nothing is left in the queue, and only the logs and the change table are reached', async () => {
    putOnServer(ALL_LOGS())
    world.online = true
    await deleteBench02(ALL_LOGS())
    expect(world.requests.map((r) => r.replace(/upsert v2_session_set_changes:[0-9a-f-]{36}/, 'upsert v2_session_set_changes:<id>'))).toEqual([
      'delete v2_set_logs:log.bench.2.d1',
      'delete v2_set_logs:log.bench.2',
      'upsert v2_session_set_changes:<id>',
      'patch v2_set_logs:log.bench.3 {"set_number":2}',
    ])
    expect(queue()).toEqual([])
    expect([...world.tables].sort()).toEqual(['v2_session_set_changes', 'v2_set_logs'])
  })

  it('an unlogged planned set deleted offline is one queued upsert, no log item and no patch; on reconnect it is the only request, to the change table', async () => {
    const view = viewOf(orderOf([BENCH()]), [head1()])
    const effects = deleteEffects(rowKeyed(view, 'set:bench.3'), view)
    expect(effects.deleteOrder).toEqual([])
    await act(async () => {
      await runDelete(effects, {
        deleteLog: async () => {
          throw new Error('an open set has no log to delete')
        },
        writers: {
          online: false,
          writeChanges: (writes) => writeSetChanges({ sessionId: 's1', userId: 'u1', writes, online: false }),
          patchNumbers: async () => {
            throw new Error('no logged set follows it')
          },
          clearStageKind: async () => {
            throw new Error('not in this delete')
          },
        },
      })
    })
    expect(inQueueOrder()).toEqual(['upsert v2_session_set_changes deleted bench.3'])
    expect(world.requests).toEqual([])
    expect(await hasQueuedWritesFor('s1')).toBe(true) // a finish waits for it: the server doesn't have the session's deleted set yet
    world.online = true
    await flushSyncQueue()
    expect(await hasQueuedWritesFor('s1')).toBe(false)
    expect(world.requests).toHaveLength(1)
    expect(world.requests[0]).toMatch(/^upsert v2_session_set_changes:/)
    expect([...world.tables]).toEqual(['v2_session_set_changes'])
    expect(queue()).toEqual([])
  })

  it('a set logged and deleted before the phone reached the server never reaches it: the upserts and the deletes cancel in pairs, and the change row and the patch still go', async () => {
    // the logs were made offline: their upserts are in the queue, never sent (the server holds only what was logged before)
    putOnServer([head1(), head3()])
    for (const log of [head2(), drop2()]) {
      queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { ...toServerRow(log), user_id: 'u1' }, createdAt: `2026-10-12T18:00:0${world.nextId}Z` })
    }
    await deleteBench02(ALL_LOGS())
    world.online = true
    await flushSyncQueue()
    expect(world.requests.map((r) => r.replace(/:[0-9a-f-]{36}/, ':<id>'))).toEqual([
      'upsert v2_session_set_changes:<id>',
      'patch v2_set_logs:log.bench.3 {"set_number":2}',
    ])
    expect(serverKeys('v2_set_logs')).toEqual(['log.bench.1', 'log.bench.3'])
    expect(queue()).toEqual([])
  })

  it('an earlier write to the head that fails in the pass holds the head\'s delete behind it, while the change row and the patch (other records) still go', async () => {
    // the head's own upsert was sent once and failed (attempts 1): it is no longer "never sent", so its delete waits for it instead of cancelling against it
    putOnServer([head1(), head3()])
    queue().push({ id: world.nextId++, table: 'v2_set_logs', operation: 'upsert', payload: { ...toServerRow(head2()), user_id: 'u1' }, createdAt: '2026-10-12T18:00:01Z', attempts: 1 })
    await deleteBench02([head1(), head2(), head3()].filter((l) => l.id !== drop2().id))
    world.online = true
    world.failing.set('upsert v2_set_logs:log.bench.2', 1)
    await flushSyncQueue()
    // pass 1 (and the extra pass `flushSyncQueue` makes while items were queued meanwhile): the head's upsert failed, so its delete never ran
    expect(world.requests.some((r) => r.startsWith('delete v2_set_logs:log.bench.2'))).toBe(false)
    expect(world.requests.some((r) => r.startsWith('upsert v2_session_set_changes'))).toBe(true)
    expect(world.requests.some((r) => r.startsWith('patch v2_set_logs:log.bench.3'))).toBe(true)
    // the retry: the head's upsert lands, then its delete, in that order
    await flushSyncQueue()
    const sent = world.requests.filter((r) => r.includes('log.bench.2'))
    expect(sent).toEqual(['upsert v2_set_logs:log.bench.2', 'delete v2_set_logs:log.bench.2'])
    expect(serverKeys('v2_set_logs')).toEqual(['log.bench.1', 'log.bench.3'])
    expect(queue()).toEqual([])
  })
})

describe('the change row, against the table\'s own refusals', () => {
  const sessionRow = (over: Record<string, unknown>) => ({ id: 'chg-1', user_id: 'u1', session_id: 's1', kind: 'deleted', week_plan_set_id: 'bench.2', set_log_id: null, is_warmup: false, stage_kind: null, stage_count: 0, ...over })

  it('the stand-in can refuse (the control): a `deleted` row that holds a stage kind is refused (23514), and a second row for one planned set under another id (23505)', async () => {
    const { upsertSetChange } = await import('../gym/sessionSetChangesService')
    await expect(upsertSetChange(sessionRow({ stage_kind: 'dropset', stage_count: 1 }))).rejects.toMatchObject({ code: '23514', message: 'v2_session_set_changes_deleted_check' })
    await upsertSetChange(sessionRow({ kind: 'retyped', is_warmup: true }))
    await expect(upsertSetChange(sessionRow({ id: 'chg-2' }))).rejects.toMatchObject({ code: '23505', message: 'v2_session_set_changes_plan_set_uk' })
  })

  it('a planned set the session already retyped: the `deleted` write carries the held row\'s id and is ONE accepted write that clears its type', async () => {
    const { upsertSetChange } = await import('../gym/sessionSetChangesService')
    await upsertSetChange(sessionRow({ id: 'chg-7', kind: 'retyped', stage_kind: 'dropset', stage_count: 2 }))
    putOnServer(ALL_LOGS())
    const view = viewOf(orderOf([BENCH()]), ALL_LOGS(), [{ kind: 'retyped', weekPlanSetId: 'bench.2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 }, id: 'chg-7' }])
    const effects = deleteEffects(rowKeyed(view, 'set:bench.2'), view)
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: 'chg-7' }])
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: effects.changes, online: true })
    expect(world.server.get('v2_session_set_changes:chg-7')).toMatchObject({ kind: 'deleted', is_warmup: false, stage_kind: null, stage_count: 0 })
    expect(serverKeys('v2_session_set_changes')).toEqual(['chg-7']) // replaced, not added
  })

  it('offline, the same replacement is a queued upsert that carries the held row\'s id and is accepted on reconnect; a new id would be refused', async () => {
    const { upsertSetChange } = await import('../gym/sessionSetChangesService')
    await upsertSetChange(sessionRow({ id: 'chg-7', kind: 'retyped', is_warmup: true }))
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: 'chg-7' }], online: false })
    expect(queue()[0].payload).toMatchObject({ id: 'chg-7', kind: 'deleted', is_warmup: false })
    world.online = true
    await flushSyncQueue()
    expect(world.server.get('v2_session_set_changes:chg-7')).toMatchObject({ kind: 'deleted', is_warmup: false })
    expect(queue()).toEqual([])
    // the break: the same write with a row of its own is refused again and again, and ends as a write that stopped retrying
    world.server = new Map([['v2_session_set_changes:chg-7', sessionRow({ id: 'chg-7', kind: 'retyped', is_warmup: true })]])
    await writeSetChanges({ sessionId: 's1', userId: 'u1', writes: [{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: null }], online: false })
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await flushSyncQueue()
    expect(queue()).toHaveLength(1)
    expect(queue()[0]).toMatchObject({ gaveUp: true })
    expect(serverKeys('v2_session_set_changes')).toEqual(['chg-7'])
  })
})

describe('`useDeleteSetLog`', () => {
  it('online it is the request it always was: one delete, nothing queued, and the session is read again', async () => {
    world.online = true
    putOnServer(ALL_LOGS())
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: ALL_LOGS() } as unknown as Session)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => void (await result.current.mutateAsync({ id: 'log.bench.3', parentSetId: null })))
    expect(world.requests).toEqual(['delete v2_set_logs:log.bench.3'])
    expect(queue()).toEqual([])
    expect(invalidate).toHaveBeenCalled()
    invalidate.mockRestore()
  })

  it('offline it settles even when TanStack itself thinks the phone is offline (`networkMode: always`: a paused mutation would never answer, and the delete would hang)', async () => {
    onlineManager.setOnline(false)
    try {
      queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: ALL_LOGS() } as unknown as Session)
      const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
      await act(async () => void (await result.current.mutateAsync({ id: 'log.bench.3', parentSetId: null })))
      expect(queue()).toHaveLength(1)
    } finally {
      onlineManager.setOnline(true)
    }
  }, 3000)

  it('a delete the server refuses rejects with the reason and puts the log back in the screen\'s copy of the session', async () => {
    world.online = true
    putOnServer(ALL_LOGS())
    world.failing.set('delete v2_set_logs:log.bench.3', 1)
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: ALL_LOGS() } as unknown as Session)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'log.bench.3', parentSetId: null })).rejects.toMatchObject({ message: 'Failed to fetch' })
    })
    expect((queryClient.getQueryData(['v2_session', 's1']) as Session).setLogs?.map((l) => l.id)).toContain('log.bench.3')
    invalidate.mockRestore()
  })

  it('offline it queues a `delete` item with its session (and its head, for a drop), takes the log out of the screen\'s cache, sends nothing and does not read the session', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: ALL_LOGS() } as unknown as Session)
    const { result } = renderHook(() => useDeleteSetLog('s1'), { wrapper })
    await act(async () => void (await result.current.mutateAsync({ id: 'log.bench.2.d1', parentSetId: 'log.bench.2' })))
    expect(queue()).toHaveLength(1)
    expect(queue()[0]).toMatchObject({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'log.bench.2.d1' }, sessionId: 's1', parentSetId: 'log.bench.2' })
    expect(world.requests).toEqual([])
    expect((queryClient.getQueryData(['v2_session', 's1']) as Session).setLogs?.map((l) => l.id)).toEqual(['log.bench.1', 'log.bench.2', 'log.bench.3'])
    expect(invalidate).not.toHaveBeenCalled()
    invalidate.mockRestore()
  })
})
