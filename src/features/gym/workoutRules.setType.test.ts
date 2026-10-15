import { describe, expect, it } from 'vitest'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { SessionSetChange } from '../../types'
import {
  applySetTypeChange,
  currentSet,
  resolveRows,
  typeColumns,
  typeOfColumns,
  type ResolvedRow,
} from './workoutRules'
import { addedLog, brief, card, deepFreeze, dropLog, headLog, orderOf, staged } from './workoutRules.testutil'

// Chunk 46: a set's type changed during a workout (SPEC [1.2] "Set type during a workout (19)", 19c):
// what each case writes, as data, for chunk 62 to apply.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const

const rowOf = (rows: ResolvedRow[], key: string): ResolvedRow => {
  const found = rows.find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

describe('applySetTypeChange: a planned set that is not logged yet', () => {
  const order = orderOf([card('bench', 'n n'), card('pushdown', 'n d2')])
  const rows = resolveRows(order, [], [])

  it('made a dropset: a "retyped" change keyed by the planned set, the drop appears, nothing is patched or deleted', () => {
    const result = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: staged('dropset', 1) })
    expect(result).toEqual({
      type: staged('dropset', 1),
      changed: true,
      headPatch: null,
      stagesToAdd: [1],
      stagesToDelete: [],
      needsConfirm: false,
      confirmCount: 0,
      change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: staged('dropset', 1) },
    })
  })

  it('made a warmup or Normal: the change says so and no drop is added', () => {
    expect(applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: WARMUP })).toMatchObject({
      type: WARMUP,
      stagesToAdd: [],
      change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: WARMUP },
    })
    expect(applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: NORMAL })).toMatchObject({
      type: NORMAL,
      stagesToAdd: [],
      stagesToDelete: [],
      needsConfirm: false,
      change: { kind: 'retyped', weekPlanSetId: 'pushdown.2', type: NORMAL },
    })
  })

  it('a planned dropset with two drops given three has one more; given another kind with one, no more', () => {
    expect(applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: staged('dropset', 3) }).stagesToAdd).toEqual([3])
    const other = applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: staged('rest_pause', 1) })
    expect(other.stagesToAdd).toEqual([])
    expect(other.change).toEqual({ kind: 'retyped', weekPlanSetId: 'pushdown.2', type: staged('rest_pause', 1) })
  })

  it('picking the type the set already has changes nothing', () => {
    const same = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: NORMAL })
    expect(same).toEqual({ type: NORMAL, changed: false, headPatch: null, stagesToAdd: [], stagesToDelete: [], needsConfirm: false, confirmCount: 0 })
    expect(applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: staged('dropset', 2) }).changed).toBe(false)
  })

  it('after the change is stored the rows show it: the drops appear under the head and the plan is untouched', () => {
    const result = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: staged('dropset', 2) })
    const changes = [result.change!]
    expect(resolveRows(order, [], changes).slice(0, 4).map(brief)).toEqual(['bench 01·', 'bench 01.1·', 'bench 01.2·', 'bench 02·'])
  })
})

describe('applySetTypeChange: a set added in the session that is not logged yet', () => {
  it('has no row to write: the type is the screen\'s own state', () => {
    const rows = resolveRows(orderOf([card('bench', 'n', { added: 1 })]), [], [])
    const result = applySetTypeChange({ row: rowOf(rows, 'added:bench:1'), pick: staged('dropset', 2) })
    expect(result).toMatchObject({ type: staged('dropset', 2), changed: true, headPatch: null, stagesToAdd: [1, 2], stagesToDelete: [] })
    expect(result.change).toBeUndefined()
  })
})

describe('applySetTypeChange: a logged head', () => {
  it('made a dropset: its log gets the kind, it has exactly one pending drop, kept as a "pending_stages" change keyed by the log', () => {
    const head = headLog('bench', 1)
    const order = orderOf([card('bench', 'n n')])
    const row = rowOf(resolveRows(order, [head], []), 'set:bench.1')
    const result = applySetTypeChange({ row, pick: staged('dropset', 1) })
    expect(result).toEqual({
      type: staged('dropset', 1),
      changed: true,
      headPatch: { isWarmup: false, stageKind: 'dropset' },
      stagesToAdd: [1],
      stagesToDelete: [],
      needsConfirm: false,
      confirmCount: 0,
      change: { kind: 'pending_stages', setLogId: 'log.bench.1', stageKind: 'dropset', stageCount: 1 },
    })
    // …and that drop is the current set (nothing earlier is open)
    const patched = { ...head, stageKind: 'dropset' as const }
    expect(brief(currentSet(order, [patched], [result.change!])!)).toBe('bench 01.1·')
  })

  it('…but not while an earlier set is unlogged: then the earlier set is current and the lock decides about the drop', () => {
    const order = orderOf([card('bench', 'n n n')])
    const head = headLog('bench', 2, { number: 1 })
    const row = rowOf(resolveRows(order, [head], []), 'set:bench.2')
    const result = applySetTypeChange({ row, pick: staged('dropset', 1) })
    const patched = { ...head, stageKind: 'dropset' as const }
    expect(currentSet(order, [patched], [result.change!])!.key).toBe('set:bench.1')
  })

  it('made Normal with two drops logged: asks first, and says which logged drops go, the last first (19c)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 1), dropLog(head, 2)]
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head, ...drops], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: NORMAL, loggedStages: drops })
    expect(result).toEqual({
      type: NORMAL,
      changed: true,
      headPatch: { isWarmup: false, stageKind: null },
      stagesToAdd: [],
      stagesToDelete: [
        { id: `${head.id}.d2`, stageIndex: 2, isSkipped: false },
        { id: `${head.id}.d1`, stageIndex: 1, isSkipped: false },
      ].map((d) => expect.objectContaining(d)),
      needsConfirm: true,
      confirmCount: 2,
    })
    expect(result.change).toBeUndefined()
  })

  it('made Normal with no drop logged yet: nothing to ask, nothing to delete', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: NORMAL, loggedStages: [] })
    expect(result).toMatchObject({ headPatch: { isWarmup: false, stageKind: null }, stagesToDelete: [], needsConfirm: false, confirmCount: 0 })
  })

  it('skipped drops go without a question: only done ones are counted', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const done = dropLog(head, 1)
    const skipped = dropLog(head, 2, { skipped: true })
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head, done, skipped], []), 'set:pushdown.1')
    const mixed = applySetTypeChange({ row, pick: NORMAL, loggedStages: [done, skipped] })
    expect(mixed.stagesToDelete).toHaveLength(2)
    expect(mixed).toMatchObject({ needsConfirm: true, confirmCount: 1 })
    const onlySkipped = applySetTypeChange({ row, pick: NORMAL, loggedStages: [skipped] })
    expect(onlySkipped).toMatchObject({ needsConfirm: false, confirmCount: 0 })
    expect(onlySkipped.stagesToDelete).toHaveLength(1)
  })

  it('made a warmup: a warmup can\'t be staged, so its drops go too; the log is patched as a warmup', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head, drop], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: WARMUP, loggedStages: [drop] })
    expect(result).toMatchObject({
      type: WARMUP,
      headPatch: { isWarmup: true, stageKind: null },
      needsConfirm: true,
      confirmCount: 1,
    })
    expect(result.stagesToDelete.map((d) => d.id)).toEqual([drop.id])
    expect(result.change).toBeUndefined()
  })

  it('another stage kind with the drops it has: the logged drops stay, the head\'s kind is patched, the change keeps the count', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd1')]), [head, drop], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: staged('rest_pause', 1), loggedStages: [drop] })
    expect(result).toMatchObject({
      headPatch: { isWarmup: false, stageKind: 'rest_pause' },
      stagesToAdd: [],
      stagesToDelete: [],
      needsConfirm: false,
      change: { kind: 'pending_stages', setLogId: head.id, stageKind: 'rest_pause', stageCount: 1 },
    })
  })

  it('more drops than it has: only the new ones are added, the change holds the total', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head, drop], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: staged('dropset', 3), loggedStages: [drop] })
    expect(result.stagesToAdd).toEqual([3])
    expect(result.change).toEqual({ kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 3 })
    expect(result.stagesToDelete).toEqual([])
  })

  it('fewer drops than are logged: the extra logged drops go, after the question', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 1), dropLog(head, 2), dropLog(head, 3)]
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd3')]), [head, ...drops], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: staged('dropset', 1), loggedStages: drops })
    expect(result.stagesToDelete.map((d) => d.id)).toEqual([`${head.id}.d3`, `${head.id}.d2`])
    expect(result).toMatchObject({ needsConfirm: true, confirmCount: 2, stagesToAdd: [] })
    expect(result.change).toEqual({ kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 })
  })

  it('takes the drops in order whatever order they come in', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 7), dropLog(head, 2)]
    const row = rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head, ...drops], []), 'set:pushdown.1')
    const result = applySetTypeChange({ row, pick: NORMAL, loggedStages: drops })
    expect(result.stagesToDelete.map((d) => d.stageIndex)).toEqual([7, 2])
  })

  it('a stale "pending_stages" row under a log made Normal changes nothing the rows show (nothing to delete for it)', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const row = rowOf(resolveRows(orderOf([card('bench', 'n')]), [head], [{ kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 2 }]), 'set:bench.1')
    expect(row.type).toEqual(staged('dropset', 2))
    const result = applySetTypeChange({ row, pick: NORMAL, loggedStages: [] })
    expect(result.headPatch).toEqual({ isWarmup: false, stageKind: null })
    expect(result.change).toBeUndefined()
    const patched = { ...head, stageKind: null }
    const stale: SessionSetChange = { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 2 }
    expect(resolveRows(orderOf([card('bench', 'n')]), [patched], [stale]).map(brief)).toEqual(['bench 01✓'])
  })
})

describe('applySetTypeChange: what it refuses', () => {
  const rows = resolveRows(orderOf([card('pushdown', 'n d1')]), [], [])

  it('a drop has no type of its own, and a skipped set has none to change', () => {
    expect(() => applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2:stage:1'), pick: NORMAL })).toThrow(RangeError)
    const skipped = rowOf(resolveRows(orderOf([card('bench', 'n')]), [headLog('bench', 1, { skipped: true })], []), 'set:bench.1')
    expect(() => applySetTypeChange({ row: skipped, pick: staged('dropset', 1) })).toThrow(RangeError)
  })

  it('a staged type has at least one drop, a whole number of them', () => {
    expect(() => applySetTypeChange({ row: rowOf(rows, 'set:pushdown.1'), pick: staged('dropset', 0) })).toThrow(RangeError)
    expect(() => applySetTypeChange({ row: rowOf(rows, 'set:pushdown.1'), pick: staged('dropset', 1.5) })).toThrow(RangeError)
  })

  it('a logged row without its log is a caller bug', () => {
    const broken = { ...rowOf(resolveRows(orderOf([card('bench', 'n')]), [headLog('bench', 1)], []), 'set:bench.1'), logId: null }
    expect(() => applySetTypeChange({ row: broken, pick: staged('dropset', 1) })).toThrow(RangeError)
  })
})

describe('the picker\'s type goes in without a cast and comes out as what a session stores', () => {
  it('a SetType (with the rest between its stages) is accepted; the rest is not part of what is written', () => {
    const pick: SetType = { kind: 'staged', stageKind: 'myo_reps', stageCount: 2, stageRestSeconds: 20 }
    const rows = resolveRows(orderOf([card('bench', 'n')]), [], [])
    const result = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick })
    expect(result.type).toEqual({ kind: 'staged', stageKind: 'myo_reps', stageCount: 2 })
    expect(result.change).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'staged', stageKind: 'myo_reps', stageCount: 2 } })
  })

  it('a warmup is never given stages, even when the value carries them', () => {
    const rows = resolveRows(orderOf([card('bench', 'n')]), [], [])
    const sloppy = { kind: 'warmup', stageKind: 'dropset', stageCount: 2 } as unknown as SetType
    const result = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: sloppy })
    expect(result.type).toEqual(WARMUP)
    expect(result.change).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', type: WARMUP })
  })

  it('reads and writes nothing it is handed', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = deepFreeze([dropLog(head, 2), dropLog(head, 1)])
    const row = deepFreeze(rowOf(resolveRows(orderOf([card('pushdown', 'd2')]), [head, ...drops], []), 'set:pushdown.1'))
    const first = applySetTypeChange({ row, pick: NORMAL, loggedStages: drops })
    expect(applySetTypeChange({ row, pick: NORMAL, loggedStages: drops })).toEqual(first)
    expect(drops.map((d) => d.stageIndex)).toEqual([2, 1])
  })
})

describe('typeColumns / typeOfColumns: the one mapping between a type and the columns that store it', () => {
  it('writes is_warmup, stage_kind and the drop count a change row holds', () => {
    expect(typeColumns(NORMAL)).toEqual({ isWarmup: false, stageKind: null, stageCount: 0 })
    expect(typeColumns(WARMUP)).toEqual({ isWarmup: true, stageKind: null, stageCount: 0 })
    expect(typeColumns(staged('cluster', 3))).toEqual({ isWarmup: false, stageKind: 'cluster', stageCount: 3 })
  })

  it('reads them back, and refuses what the table refuses: a warmup is not staged, a stage kind needs its count', () => {
    for (const type of [NORMAL, WARMUP, staged('dropset', 1), staged('rest_pause', 4), staged('myo_reps', 2), staged('cluster', 3)]) {
      expect(typeOfColumns(typeColumns(type))).toEqual(type)
    }
    expect(typeOfColumns({ isWarmup: true, stageKind: 'dropset', stageCount: 2 })).toEqual(WARMUP)
    expect(typeOfColumns({ isWarmup: false, stageKind: 'dropset', stageCount: 0 })).toEqual(NORMAL)
    expect(typeOfColumns({ isWarmup: false, stageKind: null, stageCount: 2 })).toEqual(NORMAL)
  })
})

describe('an added set that is logged keeps what it was made', () => {
  it('a logged added dropset with its pending drop is current at the drop', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 1 })
    const order = orderOf([card('bench', '', { added: 1 })])
    const row = rowOf(resolveRows(order, [head], []), 'added:bench:1')
    const result = applySetTypeChange({ row, pick: staged('dropset', 1) })
    expect(result.change).toEqual({ kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 })
    expect(brief(currentSet(order, [head], [result.change!])!)).toBe('bench 01.1·')
  })
})
