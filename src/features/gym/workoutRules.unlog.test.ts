import { describe, expect, it } from 'vitest'
import type { SessionSetChange, SetLog } from '../../types'
import { canUnlog, resolveRows, unlogEffects, type ResolvedRow } from './workoutRules'
import { groupSetLogs } from './setGroupLogic'
import { SESSION, addedLog, card, deepFreeze, dropLog, headLog, orderOf, pending, retyped, staged } from './workoutRules.testutil'

// Chunk 46: unlog (SPEC [1.2] "Unlog (18c)", Defaults 6, G46 (a)). Unlog deletes the set's log (its
// stages' logs first); the numbers stay as a draft on the phone, never on the server; a type the set was
// logged with and the plan doesn't have is kept as a `retyped` change.

const rowOf = (rows: ResolvedRow[], key: string): ResolvedRow => {
  const found = rows.find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

// A session of one card with these logs and changes: the row of `rowKey` and the group of the log behind it.
function situation(o: { spec: string; key: string; logs: SetLog[]; rowKey: string; changes?: SessionSetChange[]; added?: number }) {
  const rows = resolveRows(orderOf([card(o.key, o.spec, { added: o.added ?? 0 })]), o.logs, o.changes ?? [])
  const row = rowOf(rows, o.rowKey)
  const group = groupSetLogs(o.logs).find((g) => g.head.id === row.logId)!
  return { row, group }
}

describe('canUnlog: not while done drops follow the set', () => {
  it('a set with no drops can be unlogged', () => {
    expect(canUnlog({ head: headLog('bench', 1), stages: [] })).toBe(true)
  })

  it('a set with a logged drop after it cannot — UNLOG is disabled until the drop is gone', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    expect(canUnlog({ head, stages: [dropLog(head, 1)] })).toBe(false)
    expect(canUnlog({ head, stages: [dropLog(head, 1, { skipped: true }), dropLog(head, 2)] })).toBe(false)
  })

  it('drops that were skipped are not logged drops: they don\'t stop it (they are removed with the set)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    expect(canUnlog({ head, stages: [dropLog(head, 1, { skipped: true }), dropLog(head, 2, { skipped: true })] })).toBe(true)
  })
})

describe('unlogEffects: the log goes, the numbers stay as a draft', () => {
  it('deletes the head and keeps its weight, reps, RIR, form rating and unit as the draft, keyed by the planned set', () => {
    const head: SetLog = { ...headLog('bench', 3, { number: 2, weight: 80, reps: 8, rir: 2 }), formRating: 'controlled', enteredUnit: 'lbs' }
    const { row, group } = situation({ spec: 'n n n', key: 'bench', logs: [head], rowKey: 'set:bench.3' })
    const effects = unlogEffects(group, row)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([head.id])
    expect(effects.draft).toEqual({
      key: { sessionId: SESSION, weekPlanSetId: 'bench.3' },
      values: { weight: 80, reps: 8, rir: 2, formRating: 'controlled', enteredUnit: 'lbs' },
    })
    // a set logged as planned adds no change, and nothing else is in the answer: no rest, no session
    expect(Object.keys(effects).sort()).toEqual(['deleteOrder', 'draft'])
  })

  it('keeps empty numbers as they are (a warmup has no RIR; null stays null)', () => {
    const head = headLog('bench', 1, { warmup: true, number: 1, weight: 20, reps: null, rir: null })
    const { row, group } = situation({ spec: 'w n', key: 'bench', logs: [head], rowKey: 'set:bench.1' })
    expect(unlogEffects(group, row).draft.values).toEqual({ weight: 20, reps: null, rir: null, formRating: null, enteredUnit: null })
  })

  it('an added set is keyed by its local id with its exercise and position, never by a planned set', () => {
    const head = addedLog('bench', 1, { number: 3 })
    const { row, group } = situation({ spec: 'n n', key: 'bench', logs: [headLog('bench', 1), headLog('bench', 2), head], rowKey: 'added:bench:1', added: 1 })
    const effects = unlogEffects(group, row)
    expect(effects.draft.key).toEqual({ sessionId: SESSION, localId: head.id, exerciseId: 'ex.bench', position: 3 })
    expect('weekPlanSetId' in effects.draft.key).toBe(false)
    expect(effects.change).toBeUndefined()
  })

  it('deletes skipped drops first, from the last, then the head', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 1, { skipped: true }), dropLog(head, 2, { skipped: true })]
    const { row, group } = situation({ spec: 'd2', key: 'pushdown', logs: [head, ...drops], rowKey: 'set:pushdown.1' })
    expect(unlogEffects(group, row).deleteOrder.map((l) => l.id)).toEqual([`${head.id}.d2`, `${head.id}.d1`, head.id])
  })

  it('refuses a set with logged drops after it', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const { row, group } = situation({ spec: 'd2', key: 'pushdown', logs: [head, dropLog(head, 1)], rowKey: 'set:pushdown.1' })
    expect(() => unlogEffects(group, row)).toThrow(RangeError)
  })

  it('refuses a drop: unlog is for a set, and what a drop\'s draft is keyed by is not defined (SPEC is silent)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const row = { weekPlanSetId: null, type: null, plannedType: null, retyped: false }
    expect(() => unlogEffects({ head: drop, stages: [] }, row)).toThrow(RangeError)
  })
})

describe('unlogEffects: a type the set was logged with survives', () => {
  it('a plain planned set logged as a dropset with its drop still to do keeps "retyped: dropset, 1 drop" (nothing on the plan)', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const { row, group } = situation({ spec: 'n n', key: 'bench', logs: [head], changes: [pending(head, 'dropset', 1)], rowKey: 'set:bench.1' })
    expect(row.type).toEqual(staged('dropset', 1))
    expect(unlogEffects(group, row).change).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } })
  })

  it('a planned dropset logged as planned adds no change', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const { row, group } = situation({ spec: 'd2', key: 'pushdown', logs: [head], rowKey: 'set:pushdown.1' })
    expect(unlogEffects(group, row).change).toBeUndefined()
  })

  it('a planned dropset made Normal before it is unlogged keeps "retyped: normal"', () => {
    const head = headLog('pushdown', 1) // the log says Normal
    const { row, group } = situation({ spec: 'd2', key: 'pushdown', logs: [head], rowKey: 'set:pushdown.1' })
    expect(unlogEffects(group, row).change).toEqual({ kind: 'retyped', weekPlanSetId: 'pushdown.1', type: { kind: 'normal' } })
  })

  it('a working set made a warmup keeps that', () => {
    const head = headLog('bench', 1, { warmup: true, number: 1 })
    const { row, group } = situation({ spec: 'n', key: 'bench', logs: [head], rowKey: 'set:bench.1' })
    expect(unlogEffects(group, row).change).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'warmup' } })
  })

  it('a set retyped before it was logged and now back to the plan\'s type overwrites the stale change with the plan\'s', () => {
    const head = headLog('bench', 1) // Normal, as planned, but a "retyped" row from before still says dropset
    const { row, group } = situation({ spec: 'n', key: 'bench', logs: [head], changes: [retyped('bench', 1, staged('dropset', 1))], rowKey: 'set:bench.1' })
    expect(row.retyped).toBe(true)
    expect(unlogEffects(group, row).change).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'normal' } })
  })

  it('a row with no planned set never gets a change, whatever it says (a change is keyed by the planned set)', () => {
    const head = addedLog('bench', 1, { number: 1 })
    const row = { weekPlanSetId: null, type: staged('dropset', 1), plannedType: { kind: 'normal' } as const, retyped: true }
    expect(unlogEffects({ head, stages: [] }, row).change).toBeUndefined()
  })

  it('an added set made a dropset has no planned set to key a change on', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 1 })
    const { row, group } = situation({ spec: '', key: 'bench', logs: [head], changes: [pending(head, 'dropset', 1)], rowKey: 'added:bench:1', added: 1 })
    expect(unlogEffects(group, row).change).toBeUndefined()
  })
})

describe('unlogEffects reads nothing it is not given', () => {
  it('frozen group and row, the same answer twice', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const { row, group } = situation({ spec: 'n', key: 'bench', logs: [head], changes: [pending(head, 'dropset', 1)], rowKey: 'set:bench.1' })
    const frozenRow = deepFreeze({ ...row })
    const frozenGroup = deepFreeze({ head: { ...group.head }, stages: [] as SetLog[] })
    expect(unlogEffects(frozenGroup, frozenRow)).toEqual(unlogEffects(frozenGroup, frozenRow))
  })
})
