import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, SessionSetChangeRecord } from '../../types'
import type { ChangeWrite } from './workoutRules'

// Chunk 61 — the rows of `v2_session_set_changes` the workout writes and reads (TASKS-1.2 61; migration 042's checks: "A deleted set carries no type", "a
// stage kind and a stage count come together", one row per planned set per session, SPEC [1.2] "Offline (G47)"). The writers' stand-ins are the module
// boundary (`supabase`, the sync queue's table in `db`) so what is asserted is the row each sends, whole.
const calls = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  queue: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
  fail: null as null | { after: number; message: string },
  session: null as unknown,
  addGate: null as null | Promise<void>,
  addStarts: 0,
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>) => {
        if (calls.fail !== null && calls.upserts.length >= calls.fail.after) return { error: { message: calls.fail.message } }
        calls.upserts.push({ table, row })
        return { error: null }
      },
      select: (columns: string) => {
        calls.selects.push(columns)
        return { eq: () => ({ single: async () => ({ data: calls.session, error: null }) }) }
      },
    }),
  },
}))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      add: async (item: Record<string, unknown>) => {
        calls.addStarts += 1
        if (calls.addGate !== null) await calls.addGate
        calls.queue.push(item)
      },
    },
  },
}))

const { changeRow, toSessionSetChangeRecord, toSessionSetChangeRecords } = await import('./sessionSetChangesService')
const { changesOf, withChangeRecords, writeSetChanges } = await import('./useSessionSetChanges')
const { fetchSession } = await import('./sessionService')
const { queryClient } = await import('../../lib/queryClient')

const NOW = '2026-10-26T12:00:00.000Z'
const ctx = { userId: 'u1', sessionId: 's1', now: NOW }
const del = (weekPlanSetId: string, id: string | null = null): ChangeWrite => ({ change: { kind: 'deleted', weekPlanSetId }, id })

beforeEach(() => {
  calls.upserts = []
  calls.queue = []
  calls.selects = []
  calls.fail = null
  calls.session = null
  calls.addGate = null
  calls.addStarts = 0
  queryClient.clear()
})

describe('the row a change is written as', () => {
  it('`deleted`: the planned set, no log, and no type at all (a deleted row that holds one is refused: 042\'s `deleted_check`)', () => {
    expect(changeRow(del('wps-1'), ctx, () => 'new-id')).toEqual({
      id: 'new-id',
      user_id: 'u1',
      session_id: 's1',
      kind: 'deleted',
      week_plan_set_id: 'wps-1',
      set_log_id: null,
      is_warmup: false,
      stage_kind: null,
      stage_count: 0,
      updated_at: NOW,
      created_at: NOW,
    })
  })

  it('a write that replaces a `retyped` row carries that row\'s id and names every type column: ONE write turns it into `deleted` and clears the type', () => {
    const row = changeRow(del('wps-1', 'chg-9'), ctx, () => 'never-used')
    expect(row).toMatchObject({ id: 'chg-9', kind: 'deleted', is_warmup: false, stage_kind: null, stage_count: 0, set_log_id: null })
    expect('created_at' in row).toBe(false) // an existing row keeps its own
    for (const column of ['is_warmup', 'stage_kind', 'stage_count']) expect(column in row).toBe(true) // each named, so each is written
  })

  it('a row with no stored row to replace gets a new id each time asked', () => {
    let n = 0
    const next = () => `id-${++n}`
    expect([changeRow(del('wps-1'), ctx, next).id, changeRow(del('wps-1'), ctx, next).id]).toEqual(['id-1', 'id-2'])
  })

  it('`retyped`: a warmup sets the flag and no stage kind; a staged type has its kind and its count; Normal has neither', () => {
    const retyped = (type: Extract<ChangeWrite['change'], { kind: 'retyped' }>['type']) => changeRow({ change: { kind: 'retyped', weekPlanSetId: 'wps-1', type }, id: null }, ctx, () => 'x')
    expect(retyped({ kind: 'warmup' })).toMatchObject({ kind: 'retyped', is_warmup: true, stage_kind: null, stage_count: 0 })
    expect(retyped({ kind: 'staged', stageKind: 'dropset', stageCount: 2 })).toMatchObject({ is_warmup: false, stage_kind: 'dropset', stage_count: 2 })
    expect(retyped({ kind: 'normal' })).toMatchObject({ is_warmup: false, stage_kind: null, stage_count: 0 })
  })

  it('`pending_stages`: keyed by the log, with no planned set (042\'s `keys_check`), and its kind and total count', () => {
    expect(changeRow({ change: { kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 1 }, id: 'chg-2' }, ctx, () => 'x')).toMatchObject({
      id: 'chg-2', kind: 'pending_stages', set_log_id: 'log-1', week_plan_set_id: null, is_warmup: false, stage_kind: 'dropset', stage_count: 1,
    })
  })

  it('every row reads back as the change it was written from, with its row id (the rows round trip)', () => {
    const writes: ChangeWrite[] = [
      del('wps-1'),
      { change: { kind: 'retyped', weekPlanSetId: 'wps-2', type: { kind: 'staged', stageKind: 'rest_pause', stageCount: 3 } }, id: null },
      { change: { kind: 'retyped', weekPlanSetId: 'wps-3', type: { kind: 'warmup' } }, id: null },
      { change: { kind: 'retyped', weekPlanSetId: 'wps-4', type: { kind: 'normal' } }, id: null },
      { change: { kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 2 }, id: null },
    ]
    for (const write of writes) {
      const row = changeRow(write, ctx, () => 'row-x')
      expect(toSessionSetChangeRecord({ created_at: NOW, ...row } as never)).toMatchObject({ ...write.change, id: 'row-x', userId: 'u1', sessionId: 's1' })
    }
  })

  it('a stored row that lacks the key its kind needs is left out', () => {
    const base = { id: 'r', user_id: 'u', session_id: 's', created_at: NOW, updated_at: NOW }
    expect(toSessionSetChangeRecords([{ ...base, kind: 'deleted', week_plan_set_id: null, set_log_id: null }, { ...base, kind: 'pending_stages', week_plan_set_id: null, set_log_id: 'l', stage_kind: null }, { ...base, kind: 'other', week_plan_set_id: 'w', set_log_id: null }])).toEqual([])
    expect(toSessionSetChangeRecords(null)).toEqual([])
  })
})

describe('the session\'s rows in its cache', () => {
  const record = (change: SessionSetChangeRecord): SessionSetChangeRecord => change
  const base = { userId: 'u1', sessionId: 's1', createdAt: NOW, updatedAt: NOW }
  const session = (setChanges?: SessionSetChangeRecord[]): Session => ({ id: 's1', setChanges }) as unknown as Session

  it('a `deleted` row replaces the planned set\'s `retyped` row, a `pending_stages` row the log\'s, and the same id its own; others stay', () => {
    const retyped = record({ ...base, id: 'a', kind: 'retyped', weekPlanSetId: 'wps-1', type: { kind: 'warmup' } })
    const other = record({ ...base, id: 'b', kind: 'deleted', weekPlanSetId: 'wps-2' })
    const pending = record({ ...base, id: 'c', kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 2 })
    const next = withChangeRecords(session([retyped, other, pending]), [
      record({ ...base, id: 'a', kind: 'deleted', weekPlanSetId: 'wps-1' }),
      record({ ...base, id: 'd', kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 1 }),
    ])
    expect(next?.setChanges?.map((c) => [c.id, c.kind])).toEqual([['b', 'deleted'], ['a', 'deleted'], ['d', 'pending_stages']])
  })

  it('each key replaces on its own: another id for the same planned set (042: one row per planned set, `plan_set_uk`) and the same id for other keys (a row is its id first)', () => {
    const stored = record({ ...base, id: 'a', kind: 'retyped', weekPlanSetId: 'wps-1', type: { kind: 'warmup' } })
    const byPlannedSet = withChangeRecords(session([stored]), [record({ ...base, id: 'z', kind: 'deleted', weekPlanSetId: 'wps-1' })])
    expect(byPlannedSet?.setChanges?.map((c) => [c.id, c.kind])).toEqual([['z', 'deleted']])
    const byId = withChangeRecords(session([stored]), [record({ ...base, id: 'a', kind: 'deleted', weekPlanSetId: 'wps-9' })])
    expect(byId?.setChanges?.map((c) => [c.id, c.kind])).toEqual([['a', 'deleted']])
    // the control: a row for another planned set is left alone
    const other = withChangeRecords(session([stored]), [record({ ...base, id: 'y', kind: 'deleted', weekPlanSetId: 'wps-2' })])
    expect(other?.setChanges?.map((c) => c.id)).toEqual(['a', 'y'])
  })

  it('nothing happens to a session that is not in the cache, and a session with no rows yet gets them', () => {
    expect(withChangeRecords(undefined, [])).toBeUndefined()
    expect(withChangeRecords(session(), [record({ ...base, id: 'a', kind: 'deleted', weekPlanSetId: 'wps-1' })])?.setChanges).toHaveLength(1)
  })

  it('`changesOf` is the session\'s rows, and none (one list, not a new one each time) when it has none', () => {
    expect(changesOf(undefined)).toBe(changesOf(session()))
    const rows = [record({ ...base, id: 'a', kind: 'deleted', weekPlanSetId: 'wps-1' })]
    expect(changesOf(session(rows))).toBe(rows)
  })
})

describe('writeSetChanges', () => {
  const seed = () => queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [], setChanges: [] } as unknown as Session)
  const cached = () => (queryClient.getQueryData(['v2_session', 's1']) as Session).setChanges ?? []
  const clock = () => NOW
  const spyInvalidate = () => vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)

  it('online: one upsert of `v2_session_set_changes` per row, in the order given, each in the cache once it is sent, and the session read again at the end', async () => {
    seed()
    const invalidate = spyInvalidate()
    await writeSetChanges({
      sessionId: 's1',
      userId: 'u1',
      online: true,
      now: clock,
      writes: [del('wps-1'), { change: { kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 1 }, id: null }],
    })
    expect(calls.upserts.map((u) => [u.table, u.row.kind, u.row.week_plan_set_id ?? u.row.set_log_id])).toEqual([
      ['v2_session_set_changes', 'deleted', 'wps-1'],
      ['v2_session_set_changes', 'pending_stages', 'log-1'],
    ])
    expect(calls.queue).toEqual([]) // online nothing is queued
    expect(cached().map((c) => c.kind)).toEqual(['deleted', 'pending_stages'])
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['v2_session', 's1'] })
    invalidate.mockRestore()
  })

  it('online, the first refusal stops the rest and is thrown; the rows that were sent are in the cache and the others are not', async () => {
    seed()
    const invalidate = spyInvalidate()
    calls.fail = { after: 1, message: 'duplicate key value violates unique constraint' }
    await expect(
      writeSetChanges({ sessionId: 's1', userId: 'u1', online: true, now: clock, writes: [del('wps-1'), del('wps-2'), del('wps-3')] }),
    ).rejects.toMatchObject({ message: 'duplicate key value violates unique constraint' })
    expect(calls.upserts.map((u) => u.row.week_plan_set_id)).toEqual(['wps-1'])
    expect(cached().map((c) => (c as { weekPlanSetId: string }).weekPlanSetId)).toEqual(['wps-1'])
    invalidate.mockRestore()
  })

  it('offline: each row is a queued upsert of the same row, sent to nothing, in the order given, with the session in its payload; the cache holds it and the session is not read again', async () => {
    seed()
    const invalidate = spyInvalidate()
    await writeSetChanges({ sessionId: 's1', userId: 'u1', online: false, now: clock, writes: [del('wps-1', 'chg-9'), del('wps-2')] })
    expect(calls.upserts).toEqual([]) // offline nothing is sent
    expect(calls.queue).toHaveLength(2)
    expect(calls.queue[0]).toMatchObject({ table: 'v2_session_set_changes', operation: 'upsert', createdAt: NOW, payload: { id: 'chg-9', kind: 'deleted', week_plan_set_id: 'wps-1', session_id: 's1', user_id: 'u1' } })
    expect(calls.queue[1]).toMatchObject({ payload: { kind: 'deleted', week_plan_set_id: 'wps-2' } })
    expect((calls.queue[1].payload as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/)
    expect(cached().map((c) => c.id)[0]).toBe('chg-9')
    expect(invalidate).not.toHaveBeenCalled()
    invalidate.mockRestore()
  })

  const later = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

  it('offline, a row is in the queue before the next row starts and before the cache holds it; the call resolves only when the last is queued', async () => {
    seed()
    let release!: () => void
    calls.addGate = new Promise<void>((resolve) => (release = resolve))
    let done = false
    const pending = writeSetChanges({ sessionId: 's1', userId: 'u1', online: false, now: clock, writes: [del('wps-1'), del('wps-2')] }).then(() => void (done = true))
    await later()
    expect(calls.addStarts).toBe(1) // the second row has not started: the first is not queued yet
    expect(cached()).toEqual([]) // and the screen is not shown a row that is not queued
    expect(done).toBe(false)
    release()
    await pending
    expect(calls.queue).toHaveLength(2)
    expect(cached()).toHaveLength(2)
  })

  it('the row goes into the cache only after the reads in flight have been stopped', async () => {
    seed()
    let stopped!: () => void
    const cancel = vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(new Promise<void>((resolve) => (stopped = resolve)))
    const pending = writeSetChanges({ sessionId: 's1', userId: 'u1', online: false, now: clock, writes: [del('wps-1')] })
    await later()
    expect(cached()).toEqual([])
    stopped()
    await pending
    expect(cached()).toHaveLength(1)
    cancel.mockRestore()
  })

  it('no rows, no read: online with nothing to write the session is not read again', async () => {
    seed()
    const invalidate = spyInvalidate()
    await writeSetChanges({ sessionId: 's1', userId: 'u1', online: true, now: clock, writes: [] })
    expect(invalidate).not.toHaveBeenCalled()
    expect(calls.upserts).toEqual([])
    invalidate.mockRestore()
  })

  it('a session read that left before the row was written can\'t take it away: reads in flight are stopped first', async () => {
    seed()
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    await writeSetChanges({ sessionId: 's1', userId: 'u1', online: false, now: clock, writes: [del('wps-1')] })
    expect(cancel).toHaveBeenCalledWith({ queryKey: ['v2_session', 's1'] })
    cancel.mockRestore()
  })
})

describe('the session is read with its change rows', () => {
  it('`fetchSession` asks for them with the logs, and maps them onto `setChanges`', async () => {
    calls.session = {
      id: 's1', user_id: 'u1', mesocycle_id: 'm1', week_plan_id: 'wp-1', workout_day_id: 'wd-1', date: '2026-10-26', status: 'in_progress', note: null,
      started_at: null, completed_at: null, created_at: NOW, moved_to_date: null, v2_set_logs: [],
      v2_session_set_changes: [{ id: 'r1', user_id: 'u1', session_id: 's1', kind: 'deleted', week_plan_set_id: 'wps-1', set_log_id: null, is_warmup: false, stage_kind: null, stage_count: 0, created_at: NOW, updated_at: NOW }],
    }
    const session = await fetchSession('s1')
    expect(calls.selects).toEqual(['*, v2_set_logs(*, exercises(*)), v2_session_set_changes(*)'])
    expect(session.setChanges).toEqual([{ id: 'r1', userId: 'u1', sessionId: 's1', createdAt: NOW, updatedAt: NOW, kind: 'deleted', weekPlanSetId: 'wps-1' }])
  })
})
