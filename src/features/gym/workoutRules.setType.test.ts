import { describe, expect, it } from 'vitest'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { SetLog } from '../../types'
import {
  applySetTypeChange,
  currentSet,
  resolveRows,
  typeChangeNeedsNumbers,
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
  keepType,
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
  // an open set added in the session keeps its new type in the card or its draft, as the screen does (DECISIONS 161)
  const after = orderOf(keepType(o.cards, row, effects.type), o.blocks ?? [])
  return {
    effects,
    server,
    order: after,
    row,
    rows: resolveRows(after, server.logs, server.held()),
    current: currentSet(after, server.logs, server.held()),
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
    const result = applySetTypeChange({ row: rowOf(view.rows, 'added:bench:a1'), pick: staged('dropset', 2), session: view })
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
    const { effects, current, server } = changeOn({ cards: [card('bench', '', { added: [head] })], logs: [head], key: 'added:bench:a1', pick: staged('dropset', 1) })
    expect(effects.changes).toEqual([{ change: { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 }, id: null }])
    expect(brief(current!)).toBe('bench 01.1·')
    expect(server.held().map((c) => c.kind)).toEqual(['pending_stages'])
  })

  it('made Normal or a warmup it gets no change row at all', () => {
    const head = addedLog('bench', 1, { number: 1 })
    expect(changeOn({ cards: [card('bench', '', { added: [head] })], logs: [head], key: 'added:bench:a1', pick: WARMUP }).effects.changes).toEqual([])
  })
})

describe('a logged set switched to or from Warmup renumbers the sets as a delete does (DECISIONS 146 (a))', () => {
  it('working set 02 of 01–03 made a warmup: its own log takes its W number (173), 03 closes the gap, and the open set after it is 03', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    const { effects, rows, current, server } = changeOn({ cards: [card('bench', 'n n n n')], logs, key: 'set:bench.2', pick: WARMUP })
    expect(effects.headPatch).toEqual({ isWarmup: true, stageKind: null })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
    ])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(current!.key).toBe('set:bench.4')
    expect(current!.number).toBe(3)
    // every log holds the number its row shows, the warmup's W1 included
    expect(server.logs.map((l) => [l.id, l.setNumber, l.isWarmup])).toEqual([
      ['log.bench.1', 1, false],
      ['log.bench.2', 1, true],
      ['log.bench.3', 2, false],
    ])
  })

  it('the control: without the numbers the rows still read 01 02 03 (a row shows its rank), but History holds 1 and 3 where the rows show 01 and 02 (the failure found in the first review of chunk 46)', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    const order = orderOf([card('bench', 'n n n n')])
    const server = new FakeServer({ logs })
    const view = viewOf(order, server.logs, [])
    const row = rowKeyed(view, 'set:bench.2')
    server.applySetType({ ...applySetTypeChange({ row, pick: WARMUP, session: view }), renumber: [] }, row)
    const rows = resolveRows(order, server.logs, server.held())
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(server.logs.filter((l) => !l.isWarmup).map((l) => l.setNumber)).toEqual([1, 3])
    expect(rows.filter((r) => r.kind === 'working' && r.logId !== null).map((r) => r.number)).toEqual([1, 2])
  })

  it('a logged warmup made Normal takes its place first among the working sets and the ones after it move up one', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'w n n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null })
    expect(effects.renumber).toEqual([{ id: 'log.bench.2', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
  })

  it('the control: without the numbers two logs hold 1 where the rows show 01 and 02 (the failure found in the first review of chunk 46)', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })]
    const order = orderOf([card('bench', 'w n n')])
    const server = new FakeServer({ logs })
    const view = viewOf(order, server.logs, [])
    const row = rowKeyed(view, 'set:bench.1')
    server.applySetType({ ...applySetTypeChange({ row, pick: NORMAL, session: view }), renumber: [] }, row)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(server.logs.map((l) => l.setNumber)).toEqual([1, 1])
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
    // in between, the warmup's log holds its W number (173)
    expect(server.logs.find((l) => l.id === 'log.bench.2')).toMatchObject({ setNumber: 1, isWarmup: true })
    const viewMid = viewOf(order, server.logs, server.held())
    const back = rowKeyed(viewMid, 'set:bench.2')
    const effects = applySetTypeChange({ row: back, pick: NORMAL, session: viewMid })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
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

  it('a set that is not logged yet has no number of its own to change; it moves the logged sets after it only (DECISIONS 151)', () => {
    // nothing logged after it: nothing to write, the open sets follow by themselves
    const logs = [headLog('bench', 1)]
    const toWarmup = changeOn({ cards: [card('bench', 'n n n')], logs, key: 'set:bench.2', pick: WARMUP })
    expect(toWarmup.effects.renumber).toEqual([])
    expect(toWarmup.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02·'])
    const fromWarmup = changeOn({ cards: [card('bench', 'w n n')], logs: [headLog('bench', 2, { number: 1 })], key: 'set:bench.1', pick: NORMAL })
    expect(fromWarmup.effects.renumber).toEqual([{ id: 'log.bench.2', setNumber: 2 }])
    expect(fromWarmup.rows.map(brief)).toEqual(['bench 01·', 'bench 02✓', 'bench 03·'])
    const numbers = fromWarmup.rows.map((r) => r.number)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('02 open between the logged 01 and 03, made a warmup: the logged 03 closes the gap and the open set after it is 03', () => {
    const logs = [headLog('bench', 1), headLog('bench', 3)]
    const { effects, rows, current } = changeOn({ cards: [card('bench', 'n n n n')], logs, key: 'set:bench.2', pick: WARMUP })
    expect(effects.headPatch).toBeNull()
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.2', type: { kind: 'warmup' } }, id: null }])
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(current!.key).toBe('set:bench.4')
  })

  it('the control: without the numbers the logged set keeps 3 in the log where its row shows 02', () => {
    const order = orderOf([card('bench', 'n n n n')])
    const server = new FakeServer({ logs: [headLog('bench', 1), headLog('bench', 3)] })
    const view = viewOf(order, server.logs, [])
    const row = rowKeyed(view, 'set:bench.2')
    server.applySetType({ ...applySetTypeChange({ row, pick: WARMUP, session: view }), renumber: [] }, row)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(server.logs.map((l) => l.setNumber)).toEqual([1, 3])
  })

  it('an open warmup made Normal, with logged sets after it: it joins at its place and they move up one', () => {
    const logs = [headLog('bench', 2, { number: 1 }), headLog('bench', 3, { number: 2 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'w n n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.headPatch).toBeNull()
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02✓', 'bench 03✓'])
  })

  it('an open warmup made Normal that comes after an open working set takes its place after it: only the logged sets past that move', () => {
    // set 1 is open (and stays 01), the warmup (plan set 2) becomes the second working set, set 4 was logged as 03 and is now 04
    const logs = [headLog('bench', 4, { number: 3 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'n w n n')], logs, key: 'set:bench.2', pick: NORMAL })
    expect(effects.renumber).toEqual([{ id: 'log.bench.4', setNumber: 4 }])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·', 'bench 03·', 'bench 04✓'])
  })

  it('an open warmup made Normal between two logged sets: the one before it keeps its number, the one after it moves up (NS08)', () => {
    // the plan is 'n w n': set 1 is logged as 01, the warmup (set 2) is open, set 3 is logged as 02
    const logs = [headLog('bench', 1), headLog('bench', 3, { number: 2 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'n w n')], logs, key: 'set:bench.2', pick: NORMAL })
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 3 }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓'])
  })

  it('an open set added in the session made a Warmup closes the gap like a planned one: the logged set after it moves down (146 (a), 161)', () => {
    // bench 01 is logged, the first added set is open (kept as a draft, at 02), the second added set is logged as 03
    const logs = [headLog('bench', 1), addedLog('bench', 2, { number: 3 })]
    const draft = { sessionId: 's1', localId: 'a1', exerciseId: 'ex.bench', position: 2 } as const
    const cards = [card('bench', 'n', { added: [NORMAL, logs[1]], drafts: [draft] })]
    const { effects, row, rows, current } = changeOn({ cards, logs, key: 'added:bench:a1', pick: WARMUP })
    expect(row).toMatchObject({ state: 'unlogged', kind: 'working', number: 2, draftKey: draft })
    expect(effects.type).toEqual(WARMUP)
    expect(effects.changed).toBe(true)
    expect(effects.headPatch).toBeNull()
    expect(effects.changes).toEqual([]) // an added set never gets a change row (Adam's change-row rule)
    expect(effects.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 2 }])
    // the rows with the type kept: the warmup is no working row (the hole the review found is closed), and nothing is current
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
    expect(current).toBeNull()
    // …and the control, a planned set in the same place, gives the same patches
    const planned = changeOn({ cards: [card('bench', 'n n n')], logs: [headLog('bench', 1), headLog('bench', 3, { number: 3 })], key: 'set:bench.2', pick: WARMUP })
    expect(planned.effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(planned.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
  })

  it('switching between two working types, or two staged ones, renumbers nothing', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
    expect(changeOn({ cards: [card('bench', 'n n n')], logs, key: 'set:bench.1', pick: staged('dropset', 1) }).effects.renumber).toEqual([])
    expect(changeOn({ cards: [card('bench', 'w n n')], logs: [headLog('bench', 1, { warmup: true, number: 1 })], key: 'set:bench.1', pick: WARMUP }).effects.changed).toBe(false)
    // …even where stored numbers are stale (1.1 numbered sets in the order they were logged): a type change that moves no set
    // between the lists writes no number, logged or open; the draw's corrections fix stale ones (178) (break: any type change
    // renumbers)
    const stale = [headLog('bench', 3, { number: 1 }), headLog('bench', 1, { number: 2 })]
    expect(changeOn({ cards: [card('bench', 'n n n')], logs: stale, key: 'set:bench.1', pick: staged('dropset', 1) }).effects.renumber).toEqual([])
    expect(changeOn({ cards: [card('bench', 'n n n')], logs: stale, key: 'set:bench.2', pick: staged('dropset', 1) }).effects.renumber).toEqual([])
  })

  it('a set added in the session and logged: made a warmup it stays a row, as a warmup with its W number on its log (173), and the added sets after it close the gap', () => {
    const logs = [headLog('bench', 1), addedLog('bench', 1, { number: 2 }), addedLog('bench', 2, { number: 3 })]
    const cards = [card('bench', 'n', { added: [logs[1], logs[2]] })]
    const { effects, rows, server } = changeOn({ cards, logs, key: 'added:bench:a1', pick: WARMUP })
    expect(effects.changes).toEqual([])
    expect(effects.renumber).toEqual([
      { id: 'log.bench.added1', setNumber: 1 },
      { id: 'log.bench.added2', setNumber: 2 },
    ])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓'])
    expect(rows[0].key).toBe('added:bench:a1')
    expect(rows.map((r) => r.logId)).toEqual(['log.bench.added1', 'log.bench.1', 'log.bench.added2'])
    // and back to Normal: it is the second working set again, the other added set the third
    const order = orderOf(cards)
    const view = viewOf(order, server.logs, server.held())
    const back = rowKeyed(view, 'added:bench:a1')
    const undone = applySetTypeChange({ row: back, pick: NORMAL, session: view })
    expect(undone.renumber).toEqual([
      { id: 'log.bench.added1', setNumber: 2 },
      { id: 'log.bench.added2', setNumber: 3 },
    ])
    server.applySetType(undone, back)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓'])
  })

  it('an open working set before it keeps its place: the set joins after it, and the logged one after that moves up (DECISIONS 151)', () => {
    // the plan is 'n w n': set 1 is open, the warmup (set 2) is logged, set 3 is logged as the second working set
    const logs = [headLog('bench', 2, { warmup: true, number: 1 }), headLog('bench', 3, { number: 2 })]
    const { effects, rows } = changeOn({ cards: [card('bench', 'n w n')], logs, key: 'set:bench.2', pick: NORMAL })
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02✓', 'bench 03✓'])
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
    expect(effects.renumber).toEqual([
      { id: 'log.row.2', setNumber: 1 },
      { id: 'log.row.3', setNumber: 2 },
    ])
    expect(rows.map(brief)).toEqual(['row W1✓', 'row A1✓', 'lat B1✓', 'row A2✓', 'lat B2✓', 'lat B3✓'])
  })

  it('sets logged out of order: coming in it takes its place by the plan\'s order, every log is written the number its row shows, and nothing collides', () => {
    // set 4 was logged first (number 1), set 3 second (number 2), as 1.1 numbered them; the warmup, planned first, is made Normal
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 4, { number: 1 }), headLog('bench', 3, { number: 2 })]
    const { effects, rows, server } = changeOn({ cards: [card('bench', 'w n n n')], logs, key: 'set:bench.1', pick: NORMAL })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.3', setNumber: 3 },
      { id: 'log.bench.4', setNumber: 4 },
    ])
    expect(server.logs.map((l) => [l.id, l.setNumber])).toEqual([
      ['log.bench.1', 1],
      ['log.bench.4', 4],
      ['log.bench.3', 3],
    ])
    const logged = rows.filter((r) => r.state === 'logged').map((r) => r.number)
    expect(new Set(logged).size).toBe(logged.length)
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'set:bench.3', 'set:bench.4'])
  })

  it('an open set\'s switch is the same with the logs and rows the other way round', () => {
    const logs = [headLog('bench', 3, { number: 2 }), headLog('bench', 4, { number: 3 }), headLog('bench', 1)]
    const order = orderOf([card('bench', 'n w n n')])
    const view = viewOf(order, logs)
    const forward = applySetTypeChange({ row: rowKeyed(view, 'set:bench.2'), pick: NORMAL, session: view })
    const turned = applySetTypeChange({ row: rowKeyed(view, 'set:bench.2'), pick: NORMAL, session: { ...view, logs: [...logs].reverse(), rows: [...view.rows].reverse() } })
    expect(forward.renumber).toEqual([
      { id: 'log.bench.3', setNumber: 3 },
      { id: 'log.bench.4', setNumber: 4 },
    ])
    expect(turned).toEqual(forward)
    const toWarmup = applySetTypeChange({ row: rowKeyed(view, 'set:bench.1'), pick: WARMUP, session: view })
    expect(applySetTypeChange({ row: rowKeyed(view, 'set:bench.1'), pick: WARMUP, session: { ...view, logs: [...logs].reverse() } })).toEqual(toWarmup)
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

// X21 (chunk 46's second review): where a warmup made Normal lands among the working numbers counts every working set
// before it in the plan, whatever its state — a skipped set has a number, and since DECISIONS 151 so does an open one.
describe('a working set made a warmup and then Normal again is back where it was, whatever comes before it (X21, DECISIONS 151)', () => {
  /** The set `key` made a warmup and then Normal again, each applied to the stand-in; the logs and the rows at each stage. */
  function roundTrip(o: { cards: OrderExercise[]; logs: SetLog[]; key: string }) {
    const order = orderOf(o.cards)
    const server = new FakeServer({ logs: o.logs })
    const numbers = () => server.logs.map((l) => [l.id, l.setNumber, l.isWarmup] as const)
    const start = { logs: numbers(), rows: resolveRows(order, server.logs, server.held()).map(brief) }
    const first = viewOf(order, server.logs, server.held())
    const toWarmup = rowKeyed(first, o.key)
    const out = applySetTypeChange({ row: toWarmup, pick: WARMUP, session: first })
    server.applySetType(out, toWarmup)
    const middle = { logs: numbers(), rows: resolveRows(order, server.logs, server.held()).map(brief), renumber: out.renumber }
    const second = viewOf(order, server.logs, server.held())
    const back = rowKeyed(second, o.key)
    const undo = applySetTypeChange({ row: back, pick: NORMAL, session: second })
    server.applySetType(undo, back)
    return { start, middle, end: { logs: numbers(), rows: resolveRows(order, server.logs, server.held()).map(brief), renumber: undo.renumber } }
  }

  it('01 skipped, 02 and 03 logged; 02 made a warmup and back: every set gets its number back and the skipped 01 stays first', () => {
    const logs = [headLog('bench', 1, { skipped: true }), headLog('bench', 2), headLog('bench', 3)]
    const { start, middle, end } = roundTrip({ cards: [card('bench', 'n n n')], logs, key: 'set:bench.2' })
    expect(start.rows).toEqual(['bench 01×', 'bench 02✓', 'bench 03✓'])
    expect(middle.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
    ])
    expect(middle.rows).toEqual(['bench W1✓', 'bench 01×', 'bench 02✓'])
    // in between, every log holds what its row shows: the warmup W1, the skipped 01, the logged 02 (173)
    expect(middle.logs).toEqual([
      ['log.bench.1', 1, false],
      ['log.bench.2', 1, true],
      ['log.bench.3', 2, false],
    ])
    expect(end.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
    expect(end.logs).toEqual(start.logs)
    expect(end.rows).toEqual(start.rows)
  })

  it('01 open, 02 and 03 logged (01 was unlogged); 02 made a warmup and back: it comes back as 02, after the open 01', () => {
    const logs = [headLog('bench', 2), headLog('bench', 3)]
    const { start, middle, end } = roundTrip({ cards: [card('bench', 'n n n')], logs, key: 'set:bench.2' })
    expect(start.rows).toEqual(['bench 01·', 'bench 02✓', 'bench 03✓'])
    expect(middle.rows).toEqual(['bench W1✓', 'bench 01·', 'bench 02✓'])
    expect(middle.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
    ])
    expect(end.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
    expect(end.logs).toEqual(start.logs)
    expect(end.rows).toEqual(start.rows)
  })

  it('any one of four sets, logged or open, with the others logged, skipped or open: each switch keeps the numbers 1 to 3 in order, and back is where it was', () => {
    const states = ['logged', 'skipped', 'open'] as const
    for (let target = 1; target <= 4; target++) {
      for (const own of ['logged', 'open'] as const) {
        for (let combo = 0; combo < 3 ** 3; combo++) {
          const others = [0, 1, 2].map((i) => states[Math.floor(combo / 3 ** i) % 3])
          const here = [...others.slice(0, target - 1), own, ...others.slice(target - 1)] as Array<(typeof states)[number]>
          const logs = here.flatMap((state, i) => (state === 'open' ? [] : [headLog('bench', i + 1, { skipped: state === 'skipped' })]))
          const title = `${here.join(' ')}, set ${target} to Warmup and back`
          const { start, middle, end } = roundTrip({ cards: [card('bench', 'n n n n')], logs, key: `set:bench.${target}` })
          expect(end.logs, title).toEqual(start.logs)
          expect(end.rows, title).toEqual(start.rows)
          // while it is a warmup the three working sets read 01 to 03, each logged one stored as that
          const workingNumbers = middle.rows.filter((r) => !r.includes(' W')).map((r) => Number(r.split(' ')[1].slice(0, 2)))
          expect(workingNumbers, title).toEqual([1, 2, 3])
          const storedWorking = middle.logs.filter(([, , warmup]) => !warmup).map(([, n]) => n).sort()
          const expectedStored = here.flatMap((state, i) => (i === target - 1 || state === 'open' ? [] : [i + 1 - (i + 1 > target ? 1 : 0)]))
          expect(storedWorking, title).toEqual(expectedStored.sort())
        }
      }
    }
  })

  it('the same for each state the set before it can be in, and for the set being first, middle or last of four', () => {
    const states = ['logged', 'skipped', 'open'] as const
    for (const before of states) {
      for (const key of ['set:bench.2', 'set:bench.3', 'set:bench.4']) {
        const at = Number(key.slice(-1))
        // set 1 is in `before`'s state; the others are logged except 03, which is open when it is not the one switched
        const logs = [
          ...(before === 'open' ? [] : [headLog('bench', 1, { skipped: before === 'skipped' })]),
          headLog('bench', 2),
          ...(at === 3 ? [headLog('bench', 3)] : []),
          headLog('bench', 4),
        ]
        const { start, end } = roundTrip({ cards: [card('bench', 'n n n n')], logs, key })
        expect(end.logs, `${before} before ${key}`).toEqual(start.logs)
        expect(end.rows, `${before} before ${key}`).toEqual(start.rows)
        const numbers = end.rows.map((r) => r.slice(-4, -1))
        expect(new Set(numbers).size, `${before} before ${key}`).toBe(numbers.length)
      }
    }
  })
})

// DECISIONS 152 (a), Adam 2026-10-16: "Making a numberless logged warmup a working set asks for weight and reps in the panel
// first; type and numbers are saved in one write." The table refuses a working set without both (035's
// `v2_set_logs_check`); the stand-in models that check, so a patch that leaves the numbers out is refused here too.
describe('a warmup logged with no weight or reps, made a working set (DECISIONS 152)', () => {
  const noNumbers = (o: { weight?: number | null; reps?: number | null } = {}) =>
    headLog('bench', 1, { warmup: true, number: 1, weight: o.weight === undefined ? null : o.weight, reps: o.reps === undefined ? null : o.reps })
  const cards = [card('bench', 'w n')]
  const on = (log: SetLog, pick: Parameters<typeof changeOn>[0]['pick'], numbers?: { weight: number; reps: number }) => {
    const order = orderOf(cards)
    const server = new FakeServer({ logs: [log] })
    const view = viewOf(order, server.logs, server.held())
    const row = rowKeyed(view, 'set:bench.1')
    return { server, order, row, view, needs: typeChangeNeedsNumbers({ row, pick: pick as never, session: view }), run: () => applySetTypeChange({ row, pick: pick as never, session: view, numbers }) }
  }

  it('is a case that needs numbers: the panel is told before it saves, for Normal and for a staged type', () => {
    expect(on(noNumbers(), NORMAL).needs).toBe(true)
    expect(on(noNumbers(), staged('dropset', 2)).needs).toBe(true)
    expect(on(noNumbers(), staged('myo_reps', 1)).needs).toBe(true)
  })

  it('either number missing is enough: weight but no reps, and reps but no weight', () => {
    expect(on(noNumbers({ weight: 20 }), NORMAL).needs).toBe(true)
    expect(on(noNumbers({ reps: 12 }), NORMAL).needs).toBe(true)
  })

  it('refuses to answer without them: the patch the table would refuse is never returned', () => {
    expect(() => on(noNumbers(), NORMAL).run()).toThrow(RangeError)
    expect(() => on(noNumbers(), NORMAL).run()).toThrow(/weight or reps/)
    expect(() => on(noNumbers({ weight: 20 }), NORMAL).run()).toThrow(RangeError)
  })

  it('with the numbers typed in the panel, one patch carries the type and both numbers, and the table takes it', () => {
    const { run, server, order, row } = on(noNumbers(), NORMAL, { weight: 62.5, reps: 8 })
    const effects = run()
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null, weight: 62.5, reps: 8 })
    server.applySetType(effects, row)
    expect(server.logs.map((l) => [l.isWarmup, l.weight, l.reps])).toEqual([[false, 62.5, 8]])
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02·'])
  })

  it('a staged type carries them too, and a log that had one of the numbers takes both from the panel', () => {
    const dropset = on(noNumbers({ weight: 20 }), staged('dropset', 1), { weight: 25, reps: 10 })
    const effects = dropset.run()
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: 'dropset', weight: 25, reps: 10 })
    dropset.server.applySetType(effects, dropset.row)
    expect(dropset.server.logs.map((l) => [l.weight, l.reps, l.stageKind])).toEqual([[25, 10, 'dropset']])
  })

  it('the control: the patch without the numbers is refused by the stand-in, as the real table refuses it (23514, v2_set_logs_check)', () => {
    const { server, row } = on(noNumbers(), NORMAL)
    expect(() => server.patchLog(row.logId!, { isWarmup: false, stageKind: null })).toThrow(/23514.*v2_set_logs_check/)
    expect(() => server.patchLog(row.logId!, { isWarmup: false, stageKind: null, weight: 60 })).toThrow(/v2_set_logs_check/)
    expect(() => new FakeServer({ logs: [headLog('bench', 1, { weight: null })] })).toThrow(/v2_set_logs_check/)
  })

  it('needs nothing from a warmup that holds both numbers, from a working set, from a skipped one or from one to do', () => {
    const withNumbers = on(headLog('bench', 1, { warmup: true, number: 1, weight: 20, reps: 12 }), NORMAL)
    expect(withNumbers.needs).toBe(false)
    expect(withNumbers.run().headPatch).toEqual({ isWarmup: false, stageKind: null })
    expect(Object.keys(withNumbers.run().headPatch!).sort()).toEqual(['isWarmup', 'stageKind'])
    // a working set made a warmup: always accepted
    const working = rowKeyed(viewOf(orderOf([card('bench', 'n')]), [headLog('bench', 1)]), 'set:bench.1')
    const logged = viewOf(orderOf([card('bench', 'n')]), [headLog('bench', 1)])
    expect(typeChangeNeedsNumbers({ row: working, pick: WARMUP, session: logged })).toBe(false)
    expect(typeChangeNeedsNumbers({ row: working, pick: NORMAL, session: logged })).toBe(false)
    // a warmup that is still to do has no log to hold numbers
    const open = viewOf(orderOf(cards), [])
    expect(typeChangeNeedsNumbers({ row: rowKeyed(open, 'set:bench.1'), pick: NORMAL, session: open })).toBe(false)
    // staying a warmup is no change at all
    expect(on(noNumbers(), WARMUP).needs).toBe(false)
    expect(on(noNumbers(), WARMUP).run().changed).toBe(false)
  })

  it('asks nothing of a working set, a drop or a set that is skipped, whatever its log holds (NZ07)', () => {
    // a log the table would refuse (a working set with no weight): the rule is about warmups, so it still asks nothing
    const odd = headLog('bench', 1, { weight: null })
    const view = viewOf(orderOf([card('bench', 'n d1')]), [odd])
    expect(typeChangeNeedsNumbers({ row: rowKeyed(view, 'set:bench.1'), pick: NORMAL, session: view })).toBe(false)
    expect(typeChangeNeedsNumbers({ row: rowKeyed(view, 'set:bench.1'), pick: staged('dropset', 1), session: view })).toBe(false)
    // a drop has no type of its own
    expect(typeChangeNeedsNumbers({ row: rowKeyed(viewOf(orderOf([card('bench', 'd1')]), []), 'set:bench.1:stage:1'), pick: NORMAL, session: view })).toBe(false)
    // a skipped warmup has no type to change
    const skipped = viewOf(orderOf([card('bench', 'w n')]), [headLog('bench', 1, { warmup: true, skipped: true })])
    expect(typeChangeNeedsNumbers({ row: rowKeyed(skipped, 'set:bench.1'), pick: NORMAL, session: skipped })).toBe(false)
  })

  it('numbers handed over when none are needed are not written: the patch is the type alone', () => {
    const effects = on(headLog('bench', 1, { warmup: true, number: 1, weight: 20, reps: 12 }), NORMAL, { weight: 99, reps: 99 }).run()
    expect(effects.headPatch).toEqual({ isWarmup: false, stageKind: null })
  })

  it('numbers that are not numbers are refused, and reps are whole', () => {
    expect(() => on(noNumbers(), NORMAL, { weight: Number.NaN, reps: 8 }).run()).toThrow(RangeError)
    expect(() => on(noNumbers(), NORMAL, { weight: 60, reps: Number.NaN }).run()).toThrow(RangeError)
    expect(() => on(noNumbers(), NORMAL, { weight: 60, reps: 8.5 }).run()).toThrow(RangeError)
    expect(() => on(noNumbers(), NORMAL, { weight: Number.POSITIVE_INFINITY, reps: 8 }).run()).toThrow(RangeError)
    // a negative weight is an assisted set's added load: not refused here
    expect(() => on(noNumbers(), NORMAL, { weight: -10, reps: 8 }).run()).not.toThrow()
  })

  it('an added set logged as a warmup with no numbers is the same case', () => {
    const log = addedLog('bench', 1, { warmup: true, number: 1, weight: null, reps: null })
    const order = orderOf([card('bench', '', { added: [log] })])
    const view = viewOf(order, [log])
    const row = rowKeyed(view, 'added:bench:a1')
    expect(typeChangeNeedsNumbers({ row, pick: NORMAL, session: view })).toBe(true)
    expect(() => applySetTypeChange({ row, pick: NORMAL, session: view })).toThrow(RangeError)
    expect(applySetTypeChange({ row, pick: NORMAL, session: view, numbers: { weight: 40, reps: 5 } }).headPatch).toEqual({ isWarmup: false, stageKind: null, weight: 40, reps: 5 })
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
      { cards: [card('bench', '', { added: [addedLog('bench', 1)] })], logs: [addedLog('bench', 1)], key: 'added:bench:a1', pick: staged('rest_pause', 1) },
      { cards: [card('bench', '', { added: [WARMUP, addedLog('bench', 2, { number: 1 })] })], logs: [addedLog('bench', 2, { number: 1 })], key: 'added:bench:a1', pick: NORMAL },
    ]
    for (const c of all) expect(() => changeOn(c)).not.toThrow()
  })
})
