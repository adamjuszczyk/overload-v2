import { describe, expect, it } from 'vitest'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { SetLog } from '../../types'
import {
  applySetTypeChange,
  currentSet,
  resolveRows,
  typeColumns,
  typeOfColumns,
  type HeldChange,
  type OrderExercise,
  type OrderSuperset,
  type ResolvedRow,
  type SetTypeChange,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import {
  addedLog,
  brief,
  card,
  deepFreeze,
  dropLog,
  headLog,
  held,
  orderOf,
  pending,
  retyped,
  rowKeyed,
  staged,
  viewOf,
} from './workoutRules.testutil'

// Chunk 46: a set's type changed during a workout (SPEC [1.2] "Set type during a workout (19)", 19c;
// DECISIONS 141 (a): a type change on a logged planned set is also a "retyped" change; 146 (a): a set
// switched to or from Warmup renumbers the sets as a delete does): what each case writes, as data, for
// chunk 62 to apply — and applied to the stand-in for the tables, then read the way the screen will.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const

/** One session of these cards with these logs and changes held; the type of the row `key` changed to `pick`, applied. */
function changeOn(o: {
  cards: OrderExercise[]
  blocks?: OrderSuperset[]
  logs?: SetLog[]
  changes?: HeldChange[]
  key: string
  pick: SetType | { kind: 'normal' } | { kind: 'warmup' } | ReturnType<typeof staged>
}) {
  const order = orderOf(o.cards, o.blocks ?? [])
  const server = new FakeServer({ logs: o.logs ?? [], changes: o.changes ?? [] })
  const view = viewOf(order, server.logs, server.held())
  const row = rowKeyed(view, o.key)
  const effects = applySetTypeChange({ row, pick: o.pick, session: view })
  server.applySetType(effects, row)
  return {
    effects,
    server,
    order,
    row,
    rows: resolveRows(order, server.logs, server.held()),
    current: currentSet(order, server.logs, server.held()),
  }
}

const rowOf = (rows: readonly ResolvedRow[], key: string): ResolvedRow => rowKeyed({ rows }, key)

describe('applySetTypeChange: a planned set that is not logged yet', () => {
  const order = orderOf([card('bench', 'n n'), card('pushdown', 'n d2')])
  const view = viewOf(order, [])
  const rows = view.rows

  it('made a dropset: a "retyped" change keyed by the planned set, the drop appears, nothing is patched or deleted', () => {
    const result = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: staged('dropset', 1), session: view })
    expect(result).toEqual({
      type: staged('dropset', 1),
      changed: true,
      headPatch: null,
      stagesToAdd: [1],
      stagesToDelete: [],
      needsConfirm: false,
      confirmCount: 0,
      changes: [{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: staged('dropset', 1) }, id: null }],
      renumber: [],
    })
  })

  it('made a warmup or Normal: the change says so and no drop is added', () => {
    expect(applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: WARMUP, session: view })).toMatchObject({
      type: WARMUP,
      stagesToAdd: [],
      changes: [{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: WARMUP }, id: null }],
    })
    expect(applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: NORMAL, session: view })).toMatchObject({
      type: NORMAL,
      stagesToAdd: [],
      stagesToDelete: [],
      needsConfirm: false,
      changes: [{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.2', type: NORMAL }, id: null }],
    })
  })

  it('a planned dropset with two drops given three has one more; given another kind with one, no more', () => {
    expect(applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: staged('dropset', 3), session: view }).stagesToAdd).toEqual([3])
    const other = applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: staged('rest_pause', 1), session: view })
    expect(other.stagesToAdd).toEqual([])
    expect(other.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.2', type: staged('rest_pause', 1) }, id: null }])
  })

  it('picking the type the set already has changes nothing', () => {
    const same = applySetTypeChange({ row: rowOf(rows, 'set:bench.1'), pick: NORMAL, session: view })
    expect(same).toEqual({
      type: NORMAL,
      changed: false,
      headPatch: null,
      stagesToAdd: [],
      stagesToDelete: [],
      needsConfirm: false,
      confirmCount: 0,
      changes: [],
      renumber: [],
    })
    expect(applySetTypeChange({ row: rowOf(rows, 'set:pushdown.2'), pick: staged('dropset', 2), session: view }).changed).toBe(false)
  })

  it('after the change is stored the rows show it: the drops appear under the head and the plan is untouched', () => {
    const { rows: after } = changeOn({ cards: [card('bench', 'n n')], key: 'set:bench.1', pick: staged('dropset', 2) })
    expect(after.slice(0, 4).map(brief)).toEqual(['bench 01·', 'bench 01.1·', 'bench 01.2·', 'bench 02·'])
  })

  it('a set that already has a "retyped" row is written on that row\'s own id, whatever it is changed to', () => {
    const changes = [held(retyped('bench', 1, { kind: 'warmup' }), 'c1')]
    const { effects, server, rows: after } = changeOn({ cards: [card('bench', 'n n')], changes, key: 'set:bench.1', pick: staged('cluster', 2) })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: staged('cluster', 2) }, id: 'c1' }])
    expect(server.rows.map((r) => [r.id, r.kind, r.isWarmup, r.stageKind, r.stageCount])).toEqual([['c1', 'retyped', false, 'cluster', 2]])
    expect(after.map(brief)).toEqual(['bench 01·', 'bench 01.1·', 'bench 01.2·', 'bench 02·'])
  })

  it('back to the plan\'s own type is a change too: the row is written with the plan\'s type, not left saying otherwise', () => {
    const changes = [held(retyped('bench', 1, staged('dropset', 2)), 'c1')]
    const { effects, rows: after } = changeOn({ cards: [card('bench', 'n n')], changes, key: 'set:bench.1', pick: NORMAL })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: NORMAL }, id: 'c1' }])
    expect(after.map(brief)).toEqual(['bench 01·', 'bench 02·'])
  })
})

describe('applySetTypeChange: a set added in the session that is not logged yet', () => {
  it('has no row to write: the type is the screen\'s own state (an added set never gets a "retyped" row)', () => {
    const view = viewOf(orderOf([card('bench', 'n', { added: 1 })]), [])
    const result = applySetTypeChange({ row: rowOf(view.rows, 'added:bench:1'), pick: staged('dropset', 2), session: view })
    expect(result).toMatchObject({ type: staged('dropset', 2), changed: true, headPatch: null, stagesToAdd: [1, 2], stagesToDelete: [] })
    expect(result.changes).toEqual([])
    expect(result.renumber).toEqual([])
  })
})

describe('applySetTypeChange: a logged head', () => {
  it('made a dropset: its log gets the kind, it has exactly one pending drop, and the planned set and the log each get a change row', () => {
    const head = headLog('bench', 1)
    const cards = [card('bench', 'n n')]
    const { effects, server, current } = changeOn({ cards, logs: [head], key: 'set:bench.1', pick: staged('dropset', 1) })
    expect(effects).toEqual({
      type: staged('dropset', 1),
      changed: true,
      headPatch: { isWarmup: false, stageKind: 'dropset' },
      stagesToAdd: [1],
      stagesToDelete: [],
      needsConfirm: false,
      confirmCount: 0,
      changes: [
        { change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: staged('dropset', 1) }, id: null },
        { change: { kind: 'pending_stages', setLogId: 'log.bench.1', stageKind: 'dropset', stageCount: 1 }, id: null },
      ],
      renumber: [],
    })
    // …applied, that drop is the current set (nothing earlier is open)
    expect(brief(current!)).toBe('bench 01.1·')
    expect(server.held().map((c) => c.kind)).toEqual(['retyped', 'pending_stages'])
  })

  it('…but not while an earlier set is unlogged: then the earlier set is current and the lock decides about the drop', () => {
    const head = headLog('bench', 2, { number: 1 })
    const { current } = changeOn({ cards: [card('bench', 'n n n')], logs: [head], key: 'set:bench.2', pick: staged('dropset', 1) })
    expect(current!.key).toBe('set:bench.1')
  })

  it('made Normal with two drops logged: asks first, says which logged drops go (the last first), and the planned set is "retyped" Normal (19c)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 1), dropLog(head, 2)]
    const { effects, rows } = changeOn({ cards: [card('pushdown', 'd2')], logs: [head, ...drops], key: 'set:pushdown.1', pick: NORMAL })
    expect(effects).toEqual({
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
      changes: [{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: NORMAL }, id: null }],
      renumber: [],
    })
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
  })

  it('made Normal with no drop logged yet: nothing to ask, nothing to delete', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const { effects } = changeOn({ cards: [card('pushdown', 'd2')], logs: [head], key: 'set:pushdown.1', pick: NORMAL })
    expect(effects).toMatchObject({ headPatch: { isWarmup: false, stageKind: null }, stagesToDelete: [], needsConfirm: false, confirmCount: 0 })
  })

  it('skipped drops go without a question: only done ones are counted', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const done = dropLog(head, 1)
    const skipped = dropLog(head, 2, { skipped: true })
    const cards = [card('pushdown', 'd2')]
    const mixed = changeOn({ cards, logs: [head, done, skipped], key: 'set:pushdown.1', pick: NORMAL }).effects
    expect(mixed.stagesToDelete).toHaveLength(2)
    expect(mixed).toMatchObject({ needsConfirm: true, confirmCount: 1 })
    const onlySkipped = changeOn({ cards, logs: [head, skipped], key: 'set:pushdown.1', pick: NORMAL }).effects
    expect(onlySkipped).toMatchObject({ needsConfirm: false, confirmCount: 0 })
    expect(onlySkipped.stagesToDelete).toHaveLength(1)
  })

  it('made a warmup: a warmup can\'t be staged, so its drops go too; the log is patched as a warmup and the set is "retyped" a warmup', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const { effects, rows } = changeOn({ cards: [card('pushdown', 'd2')], logs: [head, drop], key: 'set:pushdown.1', pick: WARMUP })
    expect(effects).toMatchObject({
      type: WARMUP,
      headPatch: { isWarmup: true, stageKind: null },
      needsConfirm: true,
      confirmCount: 1,
      changes: [{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: WARMUP }, id: null }],
    })
    expect(effects.stagesToDelete.map((d) => d.id)).toEqual([drop.id])
    expect(rows.map(brief)).toEqual(['pushdown W1✓'])
  })

  it('another stage kind with the drops it has: the logged drops stay, the head\'s kind is patched, both change rows keep the count', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const { effects, rows } = changeOn({ cards: [card('pushdown', 'd1')], logs: [head, drop], key: 'set:pushdown.1', pick: staged('rest_pause', 1) })
    expect(effects).toMatchObject({
      headPatch: { isWarmup: false, stageKind: 'rest_pause' },
      stagesToAdd: [],
      stagesToDelete: [],
      needsConfirm: false,
      changes: [
        { change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: staged('rest_pause', 1) }, id: null },
        { change: { kind: 'pending_stages', setLogId: head.id, stageKind: 'rest_pause', stageCount: 1 }, id: null },
      ],
    })
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
  })

  it('more drops than it has: only the new ones are added, both change rows hold the total', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const { effects, rows } = changeOn({ cards: [card('pushdown', 'd2')], logs: [head, drop], key: 'set:pushdown.1', pick: staged('dropset', 3) })
    expect(effects.stagesToAdd).toEqual([3])
    expect(effects.changes.map((w) => w.change)).toEqual([
      { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: staged('dropset', 3) },
      { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 3 },
    ])
    expect(effects.stagesToDelete).toEqual([])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2·', 'pushdown 01.3·'])
  })

  it('fewer drops than are logged: the extra logged drops go, after the question', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 1), dropLog(head, 2), dropLog(head, 3)]
    const { effects, rows } = changeOn({ cards: [card('pushdown', 'd3')], logs: [head, ...drops], key: 'set:pushdown.1', pick: staged('dropset', 1) })
    expect(effects.stagesToDelete.map((d) => d.id)).toEqual([`${head.id}.d3`, `${head.id}.d2`])
    expect(effects).toMatchObject({ needsConfirm: true, confirmCount: 2, stagesToAdd: [] })
    expect(effects.changes.map((w) => w.change)).toEqual([
      { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: staged('dropset', 1) },
      { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 },
    ])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
  })

  it('takes the drops in order whatever order they come in', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 7), dropLog(head, 2)]
    const { effects } = changeOn({ cards: [card('pushdown', 'd2')], logs: [head, ...drops], key: 'set:pushdown.1', pick: NORMAL })
    expect(effects.stagesToDelete.map((d) => d.stageIndex)).toEqual([7, 2])
  })

  it('a stale "pending_stages" row under a log made Normal changes nothing the rows show (it is not read)', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const changes = [held(pending(head, 'dropset', 2), 'c9')]
    const { effects, row, rows } = changeOn({ cards: [card('bench', 'n')], logs: [head], changes, key: 'set:bench.1', pick: NORMAL })
    expect(row.type).toEqual(staged('dropset', 2))
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null })
    expect(effects.changes.map((w) => w.change.kind)).toEqual(['retyped'])
    expect(rows.map(brief)).toEqual(['bench 01✓'])
  })

  it('a planned set that already holds a "retyped" row and a "pending_stages" row writes both on their own ids', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const changes = [held(retyped('pushdown', 1, staged('dropset', 2)), 'c1'), held(pending(head, 'dropset', 2), 'c2')]
    const { effects, server } = changeOn({ cards: [card('pushdown', 'n')], logs: [head], changes, key: 'set:pushdown.1', pick: staged('rest_pause', 4) })
    expect(effects.changes.map((w) => w.id)).toEqual(['c1', 'c2'])
    expect(server.rows.map((r) => [r.id, r.kind, r.stageKind, r.stageCount])).toEqual([
      ['c1', 'retyped', 'rest_pause', 4],
      ['c2', 'pending_stages', 'rest_pause', 4],
    ])
  })

  it('a stale "pending_stages" row under the log is replaced on its own id when the set is made a dropset again', () => {
    const head = headLog('bench', 1)
    const changes = [held(pending(head, 'cluster', 2), 'c5')]
    const { effects, server } = changeOn({ cards: [card('bench', 'n')], logs: [head], changes, key: 'set:bench.1', pick: staged('dropset', 1) })
    expect(effects.changes.map((w) => [w.change.kind, w.id])).toEqual([
      ['retyped', null],
      ['pending_stages', 'c5'],
    ])
    expect(server.rows.map((r) => [r.id, r.kind, r.stageKind])).toEqual([
      ['c5', 'pending_stages', 'dropset'],
      ['chg.new.1', 'retyped', 'dropset'],
    ])
  })

  it('each log\'s "pending_stages" row is replaced under its own id', () => {
    const a = headLog('bench', 1, { stageKind: 'dropset' })
    const b = headLog('bench', 2, { stageKind: 'dropset' })
    const changes = [held(pending(a, 'dropset', 1), 'ca'), held(pending(b, 'dropset', 1), 'cb')]
    const cards = [card('bench', 'n n')]
    const pendingId = (key: string) =>
      changeOn({ cards, logs: [a, b], changes, key, pick: staged('dropset', 2) }).effects.changes.find((w) => w.change.kind === 'pending_stages')!.id
    expect(pendingId('set:bench.1')).toBe('ca')
    expect(pendingId('set:bench.2')).toBe('cb')
  })

  it('a logged planned set that holds a "retyped" row and no "pending_stages" row writes its pending row as a new one', () => {
    const changes = [held(retyped('bench', 1, NORMAL), 'c1')]
    const { effects } = changeOn({ cards: [card('bench', 'n')], logs: [headLog('bench', 1)], changes, key: 'set:bench.1', pick: staged('dropset', 2) })
    expect(effects.changes.map((w) => [w.change.kind, w.id])).toEqual([
      ['retyped', 'c1'],
      ['pending_stages', null],
    ])
  })

  it('a pre-1.1 dropset (no kind on its head) logged as planned and made Normal reads Normal: the "retyped" Normal row is what says so', () => {
    const { effects, rows } = changeOn({ cards: [card('pushdown', 'l1')], logs: [headLog('pushdown', 1)], key: 'set:pushdown.1', pick: NORMAL })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: NORMAL }, id: null }])
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
  })

  it('a logged set\'s type change is a "retyped" change for the planned set whether or not the set was retyped before (141 (a))', () => {
    const head = headLog('bench', 1)
    const withNone = changeOn({ cards: [card('bench', 'n')], logs: [head], key: 'set:bench.1', pick: WARMUP }).effects
    expect(withNone.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: WARMUP }, id: null }])
    const before = [held(retyped('bench', 1, staged('dropset', 1)), 'c1')]
    const withRow = changeOn({ cards: [card('bench', 'n')], logs: [headLog('bench', 1, { stageKind: 'dropset' })], changes: before, key: 'set:bench.1', pick: WARMUP }).effects
    expect(withRow.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: WARMUP }, id: 'c1' }])
  })
})

describe('applySetTypeChange: what it refuses', () => {
  const view = viewOf(orderOf([card('pushdown', 'n d1')]), [])

  it('a drop has no type of its own, and a skipped set has none to change', () => {
    expect(() => applySetTypeChange({ row: rowOf(view.rows, 'set:pushdown.2:stage:1'), pick: NORMAL, session: view })).toThrow(RangeError)
    const skippedView = viewOf(orderOf([card('bench', 'n')]), [headLog('bench', 1, { skipped: true })])
    expect(() => applySetTypeChange({ row: rowOf(skippedView.rows, 'set:bench.1'), pick: staged('dropset', 1), session: skippedView })).toThrow(RangeError)
  })

  it('a staged type has at least one drop, a whole number of them', () => {
    expect(() => applySetTypeChange({ row: rowOf(view.rows, 'set:pushdown.1'), pick: staged('dropset', 0), session: view })).toThrow(RangeError)
    expect(() => applySetTypeChange({ row: rowOf(view.rows, 'set:pushdown.1'), pick: staged('dropset', 1.5), session: view })).toThrow(RangeError)
  })

  it('a logged row without its log, or whose log the session does not hold, is a caller bug', () => {
    const logged = viewOf(orderOf([card('bench', 'n')]), [headLog('bench', 1)])
    const row = rowOf(logged.rows, 'set:bench.1')
    expect(() => applySetTypeChange({ row: { ...row, logId: null }, pick: staged('dropset', 1), session: logged })).toThrow(RangeError)
    expect(() => applySetTypeChange({ row, pick: staged('dropset', 1), session: { ...logged, logs: [] } })).toThrow(RangeError)
  })
})

describe('the picker\'s type goes in without a cast and comes out as what a session stores', () => {
  it('a SetType (with the rest between its stages) is accepted; the rest is not part of what is written', () => {
    const pick: SetType = { kind: 'staged', stageKind: 'myo_reps', stageCount: 2, stageRestSeconds: 20 }
    const view = viewOf(orderOf([card('bench', 'n')]), [])
    const result = applySetTypeChange({ row: rowOf(view.rows, 'set:bench.1'), pick, session: view })
    expect(result.type).toEqual({ kind: 'staged', stageKind: 'myo_reps', stageCount: 2 })
    expect(result.changes).toEqual([
      { change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'staged', stageKind: 'myo_reps', stageCount: 2 } }, id: null },
    ])
  })

  it('a warmup is never given stages, even when the value carries them', () => {
    const view = viewOf(orderOf([card('bench', 'n')]), [])
    const sloppy = { kind: 'warmup', stageKind: 'dropset', stageCount: 2 } as unknown as SetType
    const result = applySetTypeChange({ row: rowOf(view.rows, 'set:bench.1'), pick: sloppy, session: view })
    expect(result.type).toEqual(WARMUP)
    expect(result.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: WARMUP }, id: null }])
  })

  it('reads and writes nothing it is handed, and answers the same with its lists the other way round', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 2), dropLog(head, 1)]
    const changes = [held(retyped('pushdown', 1, staged('dropset', 2)), 'c1'), held(pending(head, 'dropset', 2), 'c2')]
    const view = deepFreeze(viewOf(orderOf([card('pushdown', 'd2')]), [head, ...drops], changes))
    const row = rowOf(view.rows, 'set:pushdown.1')
    const first = applySetTypeChange({ row, pick: NORMAL, session: view })
    expect(applySetTypeChange({ row, pick: NORMAL, session: view })).toEqual(first)
    expect(drops.map((d) => d.stageIndex)).toEqual([2, 1])
    const turned = viewOf(orderOf([card('pushdown', 'd2')]), [...view.logs].reverse(), [...changes].reverse())
    const again = applySetTypeChange({ row, pick: NORMAL, session: { ...turned, rows: [...turned.rows].reverse() } })
    expect(again).toEqual(first)
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
  it('a logged added dropset with its pending drop is current at the drop, and has no "retyped" row', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 1 })
    const { effects, current, server } = changeOn({ cards: [card('bench', '', { added: 1 })], logs: [head], key: 'added:bench:1', pick: staged('dropset', 1) })
    expect(effects.changes).toEqual([{ change: { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 }, id: null }])
    expect(brief(current!)).toBe('bench 01.1·')
    expect(server.held().map((c) => c.kind)).toEqual(['pending_stages'])
  })

  it('made Normal or a warmup it gets no change row at all', () => {
    const head = addedLog('bench', 1, { number: 1 })
    expect(changeOn({ cards: [card('bench', '', { added: 1 })], logs: [head], key: 'added:bench:1', pick: WARMUP }).effects.changes).toEqual([])
  })
})

describe('a logged set switched to or from Warmup renumbers the sets as a delete does (DECISIONS 146 (a))', () => {
  it('working set 02 of 01–03 made a warmup: 03 closes the gap, and the open set after it is 03', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    const { effects, rows, current } = changeOn({ cards: [card('bench', 'n n n n')], logs, key: 'set:bench.2', pick: WARMUP })
    expect(effects.headPatch).toEqual({ isWarmup: true, stageKind: null })
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(current!.key).toBe('set:bench.4')
    expect(current!.number).toBe(3)
  })

  it('the control: without the numbers two rows read 03 (the failure found in the first review of chunk 46)', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    const order = orderOf([card('bench', 'n n n n')])
    const server = new FakeServer({ logs })
    const view = viewOf(order, server.logs, [])
    const row = rowKeyed(view, 'set:bench.2')
    server.applySetType({ ...applySetTypeChange({ row, pick: WARMUP, session: view }), renumber: [] }, row)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 03✓', 'bench 03·'])
  })

  it('a logged warmup made Normal takes its place first among the working sets and the ones after it move up one', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'w n n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null })
    expect(effects.renumber).toEqual([{ id: 'log.bench.2', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
  })

  it('the control: without the numbers two rows read 01 (the failure found in the first review of chunk 46)', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })]
    const order = orderOf([card('bench', 'w n n')])
    const server = new FakeServer({ logs })
    const view = viewOf(order, server.logs, [])
    const row = rowKeyed(view, 'set:bench.1')
    server.applySetType({ ...applySetTypeChange({ row, pick: NORMAL, session: view }), renumber: [] }, row)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 01✓', 'bench 03·'])
  })

  it('the second of two warmups made Normal is the first working set: its own number and the others\' change', () => {
    const logs = [
      headLog('bench', 1, { warmup: true, number: 1 }),
      headLog('bench', 2, { warmup: true, number: 2 }),
      headLog('bench', 3, { number: 1 }),
      headLog('bench', 4, { number: 2 }),
    ]
    const { effects, rows } = changeOn({ cards: [card('bench', 'w w n n')], logs, key: 'set:bench.2', pick: NORMAL })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.4', setNumber: 3 },
    ])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'set:bench.3', 'set:bench.4'])
  })

  it('a working set made a warmup and then made Normal again gets its number back and the others theirs', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    const cards = [card('bench', 'n n n n')]
    const order = orderOf(cards)
    const server = new FakeServer({ logs })
    const toWarmup = rowKeyed(viewOf(order, server.logs, server.held()), 'set:bench.2')
    server.applySetType(applySetTypeChange({ row: toWarmup, pick: WARMUP, session: viewOf(order, server.logs, server.held()) }), toWarmup)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    const viewMid = viewOf(order, server.logs, server.held())
    const back = rowKeyed(viewMid, 'set:bench.2')
    const effects = applySetTypeChange({ row: back, pick: NORMAL, session: viewMid })
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 3 }])
    server.applySetType(effects, back)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(server.logs.map((l) => [l.id, l.setNumber, l.isWarmup])).toEqual([
      ['log.bench.1', 1, false],
      ['log.bench.2', 2, false],
      ['log.bench.3', 3, false],
    ])
  })

  it('the drops of the sets after it take the new number with them', () => {
    const one = headLog('bench', 1)
    const two = headLog('bench', 2)
    const three = headLog('bench', 3, { stageKind: 'dropset' })
    const logs = [one, two, three, dropLog(three, 1)]
    const { effects, rows } = changeOn({ cards: [card('bench', 'n n d1')], logs, key: 'set:bench.1', pick: WARMUP })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.3.d1', setNumber: 2 },
    ])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 02.1✓'])
  })

  it('a staged set made a warmup: its drops are deleted and it leaves the working sets, the ones after it closing the gap', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const logs = [head, dropLog(head, 1), headLog('bench', 2, { number: 2 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'd1 n')], logs, key: 'set:bench.1', pick: WARMUP })
    expect(effects.stagesToDelete).toHaveLength(1)
    expect(effects.renumber).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓'])
  })

  it('a warmup made a dropset joins the working sets too, with its pending drop', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })]
    const { effects, rows, current } = changeOn({ cards: [card('bench', 'w n n')], logs, key: 'set:bench.1', pick: staged('dropset', 1) })
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: 'dropset' })
    expect(effects.renumber).toEqual([{ id: 'log.bench.2', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 01.1·', 'bench 02✓', 'bench 03·'])
    expect(current!.key).toBe('set:bench.1:stage:1')
  })

  it('a set that is not logged yet has no number to change: its number follows the logged sets', () => {
    const logs = [headLog('bench', 1)]
    const toWarmup = changeOn({ cards: [card('bench', 'n n n')], logs, key: 'set:bench.2', pick: WARMUP })
    expect(toWarmup.effects.renumber).toEqual([])
    expect(toWarmup.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02·'])
    const fromWarmup = changeOn({ cards: [card('bench', 'w n n')], logs: [headLog('bench', 2, { number: 1 })], key: 'set:bench.1', pick: NORMAL })
    expect(fromWarmup.effects.renumber).toEqual([])
    const numbers = fromWarmup.rows.map((r) => r.number)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('switching between two working types, or two staged ones, renumbers nothing', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    expect(changeOn({ cards: [card('bench', 'n n n')], logs, key: 'set:bench.1', pick: staged('dropset', 1) }).effects.renumber).toEqual([])
    expect(changeOn({ cards: [card('bench', 'w n n')], logs: [headLog('bench', 1, { warmup: true, number: 1 })], key: 'set:bench.1', pick: WARMUP }).effects.changed).toBe(false)
  })

  it('a set added in the session and logged: made a warmup it stays a row, as a warmup, and the added sets after it close the gap', () => {
    const logs = [headLog('bench', 1), addedLog('bench', 1, { number: 2 }), addedLog('bench', 2, { number: 3 })]
    const cards = [card('bench', 'n', { added: 2 })]
    const { effects, rows, server } = changeOn({ cards, logs, key: 'added:bench:1', pick: WARMUP })
    expect(effects.changes).toEqual([])
    expect(effects.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓'])
    expect(rows[0].key).toBe('added:bench:1')
    expect(rows.map((r) => r.logId)).toEqual(['log.bench.added1', 'log.bench.1', 'log.bench.added2'])
    // and back to Normal: it is the second working set again, the other added set the third
    const order = orderOf(cards)
    const view = viewOf(order, server.logs, server.held())
    const back = rowKeyed(view, 'added:bench:1')
    const undone = applySetTypeChange({ row: back, pick: NORMAL, session: view })
    expect(undone.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 3 }])
    server.applySetType(undone, back)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓'])
  })

  it('an open working set before it takes no number: it joins after the logged sets that come before it in the plan', () => {
    const logs = [headLog('bench', 2, { warmup: true, number: 1 }), headLog('bench', 3, { number: 1 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'n w n')], logs, key: 'set:bench.2', pick: NORMAL })
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench 03·', 'bench 01✓', 'bench 02✓'])
  })

  it('only its own exercise\'s sets are counted and moved', () => {
    const logs = [headLog('lat', 1), headLog('lat', 2), headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })]
    const { effects } = changeOn({ cards: [card('lat', 'n n'), card('bench', 'w n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.renumber).toEqual([{ id: 'log.bench.2', setNumber: 2 }])
  })

  it('from Warmup, the drops of the sets that move up take the new number too', () => {
    const two = headLog('bench', 2, { number: 1 })
    const three = headLog('bench', 3, { stageKind: 'dropset', number: 2 })
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), two, three, dropLog(three, 1)]
    const { effects, rows } = changeOn({ cards: [card('bench', 'w n d1')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
      { id: 'log.bench.3.d1', setNumber: 3 },
    ])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 03.1✓'])
  })

  it('a warmup with a drop logged under it (stray data) made a dropset: the drop stays and takes the new number with it', () => {
    const warm = headLog('bench', 1, { warmup: true, number: 2 })
    const logs = [warm, dropLog(warm, 1, { number: 2 }), headLog('bench', 2, { number: 1 })]
    const { effects } = changeOn({ cards: [card('bench', 'w n')], logs, key: 'set:bench.1', pick: staged('dropset', 1) })
    expect(effects.stagesToDelete).toEqual([])
    expect(effects.renumber).toEqual([
      { id: 'log.bench.1', setNumber: 1 },
      { id: 'log.bench.1.d1', setNumber: 1 },
      { id: 'log.bench.2', setNumber: 2 },
    ])
  })

  it('…made Normal, that drop is deleted and is not given a number first', () => {
    const warm = headLog('bench', 1, { warmup: true, number: 2 })
    const logs = [warm, dropLog(warm, 1, { number: 2 }), headLog('bench', 2, { number: 1 })]
    const { effects } = changeOn({ cards: [card('bench', 'w n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.stagesToDelete.map((d) => d.id)).toEqual(['log.bench.1.d1'])
    expect(effects.renumber).toEqual([
      { id: 'log.bench.1', setNumber: 1 },
      { id: 'log.bench.2', setNumber: 2 },
    ])
  })

  it('in a superset the set leaves its member\'s sets only, and the rounds are formed again', () => {
    const cardsBlock = [card('row', 'n n n'), card('lat', 'n n n')]
    const blocks = [{ id: 'blk', members: ['row', 'lat'] }]
    const logs = [1, 2, 3].flatMap((n) => [headLog('row', n), headLog('lat', n)])
    const { effects, rows } = changeOn({ cards: cardsBlock, blocks, logs, key: 'set:row.2', pick: WARMUP })
    expect(effects.renumber).toEqual([{ id: 'log.row.3', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['row W1✓', 'row A1✓', 'lat B1✓', 'row A2✓', 'lat B2✓', 'lat B3✓'])
  })

  it('sets logged out of order: coming in it takes its place by the plan\'s order and nothing collides', () => {
    // set 4 was logged first (number 1), set 3 second (number 2); the warmup, planned first, is made Normal
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 4, { number: 1 }), headLog('bench', 3, { number: 2 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'w n n n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.4', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
    const logged = rows.filter((r) => r.state === 'logged').map((r) => r.number)
    expect(new Set(logged).size).toBe(logged.length)
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'set:bench.3', 'set:bench.4'])
  })

  it('is the same with the logs and rows the other way round', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { warmup: true, number: 2 }), headLog('bench', 3, { number: 1 }), headLog('bench', 4, { number: 2 })]
    const order = orderOf([card('bench', 'w w n n')])
    const view = viewOf(order, logs)
    const forward = applySetTypeChange({ row: rowKeyed(view, 'set:bench.2'), pick: NORMAL, session: view })
    const turned: SetTypeChange = applySetTypeChange({
      row: rowKeyed(view, 'set:bench.2'),
      pick: NORMAL,
      session: { ...view, logs: [...logs].reverse(), rows: [...view.rows].reverse() },
    })
    expect(turned).toEqual(forward)
  })
})

describe('what the tables accept', () => {
  it('every kind of type change applies cleanly to the stand-in (a refusal would throw)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const all: Array<Parameters<typeof changeOn>[0]> = [
      { cards: [card('bench', 'n')], key: 'set:bench.1', pick: WARMUP },
      { cards: [card('bench', 'n')], key: 'set:bench.1', pick: staged('cluster', 3) },
      { cards: [card('bench', 'n')], logs: [headLog('bench', 1)], key: 'set:bench.1', pick: staged('myo_reps', 2) },
      { cards: [card('pushdown', 'd2')], logs: [head, dropLog(head, 1)], key: 'set:pushdown.1', pick: NORMAL },
      { cards: [card('pushdown', 'd2')], logs: [head], changes: [held(pending(head, 'dropset', 2), 'c1')], key: 'set:pushdown.1', pick: WARMUP },
      { cards: [card('bench', '', { added: 1 })], logs: [addedLog('bench', 1)], key: 'added:bench:1', pick: staged('rest_pause', 1) },
    ]
    for (const c of all) expect(() => changeOn(c)).not.toThrow()
  })
})
