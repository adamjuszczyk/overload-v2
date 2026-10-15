import { describe, expect, it } from 'vitest'
import type { SetLog } from '../../types'
import {
  canUnlog,
  currentSet,
  finishWarning,
  resolveRows,
  unlogEffects,
  type HeldChange,
  type OrderExercise,
  type UnloggableSet,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import {
  SESSION,
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

// Chunk 46: unlog (SPEC [1.2] "Unlog (18c)", Defaults 6, G46 (a); DECISIONS 147 (b): a logged drop can be
// unlogged under the same rule as any set, and its draft is keyed by its set's key plus its drop number).
// Unlog deletes the log (a set's skipped drops first); the numbers stay as a draft on the phone, never on
// the server; a type the set was logged with and the plan doesn't have is kept as a `retyped` change.

/** One session of these cards with these logs and changes held: the row `key`, and what unlogging it does, applied. */
function unlogOn(o: { cards: OrderExercise[]; logs: SetLog[]; changes?: HeldChange[]; key: string }) {
  const order = orderOf(o.cards)
  const server = new FakeServer({ logs: o.logs, changes: o.changes ?? [] })
  const view = viewOf(order, server.logs, server.held())
  const row = rowKeyed(view, o.key)
  return {
    view,
    row,
    can: canUnlog(row, view),
    effects: () => unlogEffects(row, view),
    apply: () => {
      const effects = unlogEffects(row, view)
      server.applyUnlog(effects)
      return {
        effects,
        rows: resolveRows(order, server.logs, server.held()),
        current: currentSet(order, server.logs, server.held()),
        warning: finishWarning(order, server.logs, server.held()),
        server,
      }
    },
  }
}

describe('canUnlog: not while done drops follow the set', () => {
  it('a set with no drops can be unlogged', () => {
    expect(unlogOn({ cards: [card('bench', 'n')], logs: [headLog('bench', 1)], key: 'set:bench.1' }).can).toBe(true)
  })

  it('a set with a logged drop after it cannot — UNLOG is disabled until the drop is gone', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const cards = [card('pushdown', 'd2')]
    expect(unlogOn({ cards, logs: [head, dropLog(head, 1)], key: 'set:pushdown.1' }).can).toBe(false)
    expect(unlogOn({ cards, logs: [head, dropLog(head, 1, { skipped: true }), dropLog(head, 2)], key: 'set:pushdown.1' }).can).toBe(false)
  })

  it('drops that were skipped are not logged drops: they don\'t stop it (they are removed with the set)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const logs = [head, dropLog(head, 1, { skipped: true }), dropLog(head, 2, { skipped: true })]
    expect(unlogOn({ cards: [card('pushdown', 'd2')], logs, key: 'set:pushdown.1' }).can).toBe(true)
  })

  it('a row that is not logged has nothing to unlog', () => {
    expect(unlogOn({ cards: [card('bench', 'n n')], logs: [headLog('bench', 1)], key: 'set:bench.2' }).can).toBe(false)
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    expect(unlogOn({ cards: [card('pushdown', 'd2')], logs: [head, dropLog(head, 1)], key: 'set:pushdown.1:stage:2' }).can).toBe(false)
  })

  it('a logged drop can be unlogged unless a later drop of its set is logged (DECISIONS 147 (b))', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const cards = [card('pushdown', 'd3')]
    const all = [head, dropLog(head, 1), dropLog(head, 2), dropLog(head, 3)]
    expect(unlogOn({ cards, logs: all, key: 'set:pushdown.1:stage:1' }).can).toBe(false)
    expect(unlogOn({ cards, logs: all, key: 'set:pushdown.1:stage:2' }).can).toBe(false)
    expect(unlogOn({ cards, logs: all, key: 'set:pushdown.1:stage:3' }).can).toBe(true)
    // once the last is gone, the one before it is the last
    expect(unlogOn({ cards, logs: all.slice(0, 3), key: 'set:pushdown.1:stage:2' }).can).toBe(true)
  })

  it('a later drop that was skipped is not logged: it does not stop the drop before it', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const logs = [head, dropLog(head, 1), dropLog(head, 2, { skipped: true })]
    expect(unlogOn({ cards: [card('pushdown', 'd2')], logs, key: 'set:pushdown.1:stage:1' }).can).toBe(true)
  })

  it('only the drops of its own set count', () => {
    const a = headLog('pushdown', 1, { stageKind: 'dropset' })
    const b = headLog('pushdown', 2, { stageKind: 'dropset' })
    const logs = [a, b, dropLog(a, 1), dropLog(b, 1), dropLog(b, 2)]
    expect(unlogOn({ cards: [card('pushdown', 'd1 d2')], logs, key: 'set:pushdown.1:stage:1' }).can).toBe(true)
    expect(unlogOn({ cards: [card('pushdown', 'd1 d2')], logs, key: 'set:pushdown.2:stage:1' }).can).toBe(false)
  })
})

describe('unlogEffects: the log goes, the numbers stay as a draft', () => {
  it('deletes the head and keeps its weight, reps, RIR, form rating and unit as the draft, keyed by the planned set', () => {
    const head: SetLog = { ...headLog('bench', 3, { number: 2, weight: 80, reps: 8, rir: 2 }), formRating: 'controlled', enteredUnit: 'lbs' }
    const { effects } = unlogOn({ cards: [card('bench', 'n n n')], logs: [head], key: 'set:bench.3' })
    const result = effects()
    expect(result.deleteOrder.map((l) => l.id)).toEqual([head.id])
    expect(result.draft).toEqual({
      key: { sessionId: SESSION, weekPlanSetId: 'bench.3' },
      values: { weight: 80, reps: 8, rir: 2, formRating: 'controlled', enteredUnit: 'lbs' },
    })
    // a set logged as planned adds no change, and nothing else is in the answer: no rest, no session
    expect(result.changes).toEqual([])
    expect(Object.keys(result).sort()).toEqual(['changes', 'deleteOrder', 'draft'])
  })

  it('keeps empty numbers as they are (a warmup has no RIR; null stays null)', () => {
    const head = headLog('bench', 1, { warmup: true, number: 1, weight: 20, reps: null, rir: null })
    const { effects } = unlogOn({ cards: [card('bench', 'w n')], logs: [head], key: 'set:bench.1' })
    expect(effects().draft.values).toEqual({ weight: 20, reps: null, rir: null, formRating: null, enteredUnit: null })
  })

  it('an added set is keyed by its local id with its exercise and position, never by a planned set', () => {
    const head = addedLog('bench', 1, { number: 3 })
    const { effects } = unlogOn({
      cards: [card('bench', 'n n', { added: 1 })],
      logs: [headLog('bench', 1), headLog('bench', 2), head],
      key: 'added:bench:1',
    })
    const result = effects()
    expect(result.draft.key).toEqual({ sessionId: SESSION, localId: head.id, exerciseId: 'ex.bench', position: 3 })
    expect('weekPlanSetId' in result.draft.key).toBe(false)
    expect(result.changes).toEqual([])
  })

  it('deletes skipped drops first, from the last, then the head', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drops = [dropLog(head, 1, { skipped: true }), dropLog(head, 2, { skipped: true })]
    const { effects } = unlogOn({ cards: [card('pushdown', 'd2')], logs: [head, ...drops], key: 'set:pushdown.1' })
    expect(effects().deleteOrder.map((l) => l.id)).toEqual([`${head.id}.d2`, `${head.id}.d1`, head.id])
  })

  it('refuses a set with logged drops after it, a row with no log, and a log the session does not hold', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const { effects, view, row } = unlogOn({ cards: [card('pushdown', 'd2')], logs: [head, dropLog(head, 1)], key: 'set:pushdown.1' })
    expect(() => effects()).toThrow(RangeError)
    expect(() => effects()).toThrow(/logged drops after it/)
    expect(() => unlogEffects({ ...row, logId: null }, view)).toThrow(RangeError)
    expect(() => unlogEffects({ ...row, logId: 'log.nowhere' }, view)).toThrow(RangeError)
  })

  it('applied, the set is open again and current (nothing earlier open), and its numbers are in the draft', () => {
    const { apply } = unlogOn({
      cards: [card('bench', 'n n')],
      logs: [headLog('bench', 1, { weight: 60, reps: 10 })],
      key: 'set:bench.1',
    })
    const { rows, current, effects, server } = apply()
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·'])
    expect(current!.key).toBe('set:bench.1')
    expect(effects.draft.values.weight).toBe(60)
    expect(server.logs).toEqual([])
  })
})

describe('unlogEffects on a drop (DECISIONS 147 (b)): its own log goes, its draft is keyed by its set\'s key plus its number', () => {
  const head = headLog('pushdown', 1, { stageKind: 'dropset' })
  const d1: SetLog = { ...dropLog(head, 1, { weight: 40, reps: 8, rir: 1 }), formRating: 'controlled', enteredUnit: 'kg' }
  const d2 = dropLog(head, 2, { weight: 30, reps: 10, rir: 0 })
  const cards = [card('pushdown', 'd2')]

  it('deletes that drop alone — the set and the other drop stay logged — and keeps its numbers under (planned set, drop number)', () => {
    const { effects } = unlogOn({ cards, logs: [head, d1, d2], key: 'set:pushdown.1:stage:2' })
    const result = effects()
    expect(result.deleteOrder.map((l) => l.id)).toEqual([d2.id])
    expect(result.draft).toEqual({
      key: { sessionId: SESSION, weekPlanSetId: 'pushdown.1', drop: 2 },
      values: { weight: 30, reps: 10, rir: 0, formRating: null, enteredUnit: null },
    })
    expect(result.changes).toEqual([])
    expect(Object.keys(result).sort()).toEqual(['changes', 'deleteOrder', 'draft'])
  })

  it('applied: the head and the first drop stay logged, the drop is open again and is the current set', () => {
    const { apply } = unlogOn({ cards, logs: [head, d1, d2], key: 'set:pushdown.1:stage:2' })
    const { rows, current, warning } = apply()
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2·'])
    expect(current!.key).toBe('set:pushdown.1:stage:2')
    expect(warning).toBeNull() // an unlogged drop of a logged set is not a planned set
  })

  it('the first of two cannot be unlogged while the second is logged; once the second is gone it can', () => {
    const first = unlogOn({ cards, logs: [head, d1, d2], key: 'set:pushdown.1:stage:1' })
    expect(first.can).toBe(false)
    expect(() => first.effects()).toThrow(RangeError)
    expect(() => first.effects()).toThrow(/later drop logged/)
    const second = unlogOn({ cards, logs: [head, d1], key: 'set:pushdown.1:stage:1' })
    expect(second.effects().draft.key).toEqual({ sessionId: SESSION, weekPlanSetId: 'pushdown.1', drop: 1 })
    expect(second.effects().draft.values).toEqual({ weight: 40, reps: 8, rir: 1, formRating: 'controlled', enteredUnit: 'kg' })
  })

  it('each drop has a key of its own, and the set\'s own key is not a drop\'s', () => {
    const logsAll = [head, dropLog(head, 1), dropLog(head, 2)]
    const key = (k: string) => unlogOn({ cards, logs: logsAll.filter((l) => !(k.endsWith(':1') && l.stageIndex === 2)), key: k }).effects().draft.key
    expect(key('set:pushdown.1:stage:1')).toEqual({ sessionId: SESSION, weekPlanSetId: 'pushdown.1', drop: 1 })
    expect(key('set:pushdown.1:stage:2')).toEqual({ sessionId: SESSION, weekPlanSetId: 'pushdown.1', drop: 2 })
  })

  it('a later drop that was skipped goes with it, last first (left behind it would read as drop 1: drops are read by count)', () => {
    const skipped = dropLog(head, 2, { skipped: true })
    const { effects, apply } = unlogOn({ cards, logs: [head, d1, skipped], key: 'set:pushdown.1:stage:1' })
    expect(effects().deleteOrder.map((l) => l.id)).toEqual([skipped.id, d1.id])
    const { rows } = apply()
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·'])
  })

  it('every skipped drop after it goes, the last first', () => {
    const logs = [head, dropLog(head, 1), dropLog(head, 2, { skipped: true }), dropLog(head, 3, { skipped: true })]
    const { effects } = unlogOn({ cards: [card('pushdown', 'd3')], logs, key: 'set:pushdown.1:stage:1' })
    expect(effects().deleteOrder.map((l) => l.id)).toEqual([`${head.id}.d3`, `${head.id}.d2`, `${head.id}.d1`])
  })

  it('a skipped drop before it stays where it is', () => {
    const skipped = dropLog(head, 1, { skipped: true })
    const { effects, apply } = unlogOn({ cards, logs: [head, skipped, d2], key: 'set:pushdown.1:stage:2' })
    expect(effects().deleteOrder.map((l) => l.id)).toEqual([d2.id])
    expect(apply().rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1×', 'pushdown 01.2·'])
  })

  it('a drop of an added set is keyed by the added set\'s key (its log\'s id, exercise and position) plus its number', () => {
    const addedHead = addedLog('bench', 1, { stageKind: 'dropset', number: 2 })
    const drop = dropLog(addedHead, 1, { weight: 25, reps: 12, rir: 2 })
    const changes = [held(pending(addedHead, 'dropset', 1), 'c1')]
    const { effects, apply } = unlogOn({
      cards: [card('bench', 'n', { added: 1 })],
      logs: [headLog('bench', 1), addedHead, drop],
      changes,
      key: 'added:bench:1:stage:1',
    })
    expect(effects().draft).toEqual({
      key: { sessionId: SESSION, localId: addedHead.id, exerciseId: 'ex.bench', position: 2, drop: 1 },
      values: { weight: 25, reps: 12, rir: 2, formRating: null, enteredUnit: null },
    })
    expect(apply().rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 02.1·'])
  })

  it('a drop whose set is not among the session\'s logs is a caller bug', () => {
    const { view, row } = unlogOn({ cards, logs: [head, d1], key: 'set:pushdown.1:stage:1' })
    const lonely = { ...view, logs: [d1] as UnloggableSet[] }
    expect(() => unlogEffects(row, lonely)).toThrow(RangeError)
    expect(() => unlogEffects(row, { ...view, logs: view.logs as UnloggableSet[], rows: [row] })).toThrow(RangeError)
  })
})

describe('unlogEffects: a type the set was logged with survives', () => {
  it('a plain planned set logged as a dropset with its drop still to do keeps "retyped: dropset, 1 drop" (nothing on the plan)', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const { row, effects } = unlogOn({ cards: [card('bench', 'n n')], logs: [head], changes: [held(pending(head, 'dropset', 1), 'c1')], key: 'set:bench.1' })
    expect(row.type).toEqual(staged('dropset', 1))
    expect(effects().changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } }, id: null }])
  })

  it('a planned dropset logged as planned adds no change', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    expect(unlogOn({ cards: [card('pushdown', 'd2')], logs: [head], key: 'set:pushdown.1' }).effects().changes).toEqual([])
  })

  it('a planned dropset made Normal before it is unlogged keeps "retyped: normal"', () => {
    const head = headLog('pushdown', 1) // the log says Normal
    expect(unlogOn({ cards: [card('pushdown', 'd2')], logs: [head], key: 'set:pushdown.1' }).effects().changes).toEqual([
      { change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: { kind: 'normal' } }, id: null },
    ])
  })

  it('a working set made a warmup keeps that', () => {
    const head = headLog('bench', 1, { warmup: true, number: 1 })
    expect(unlogOn({ cards: [card('bench', 'n')], logs: [head], key: 'set:bench.1' }).effects().changes).toEqual([
      { change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'warmup' } }, id: null },
    ])
  })

  it('a set retyped before it was logged and now back to the plan\'s type overwrites the stale change with the plan\'s, on its own id', () => {
    const head = headLog('bench', 1) // Normal, as planned, but a "retyped" row from before still says dropset
    const { row, effects, apply } = unlogOn({
      cards: [card('bench', 'n')],
      logs: [head],
      changes: [held(retyped('bench', 1, staged('dropset', 1)), 'c1')],
      key: 'set:bench.1',
    })
    expect(row.retyped).toBe(true)
    expect(effects().changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'normal' } }, id: 'c1' }])
    expect(apply().rows.map(brief)).toEqual(['bench 01·'])
  })

  it('a set whose retype is already on its row writes that row again on its own id (the table refuses a second row)', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const changes = [held(retyped('bench', 1, staged('dropset', 2)), 'c1'), held(pending(head, 'dropset', 2), 'c2')]
    const { effects, apply } = unlogOn({ cards: [card('bench', 'n')], logs: [head], changes, key: 'set:bench.1' })
    expect(effects().changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: staged('dropset', 2) }, id: 'c1' }])
    const { rows, server } = apply()
    // the log and its "pending_stages" row are gone, the type is kept on the planned set's row, and the set reads as it did
    expect(server.rows.map((r) => [r.id, r.kind])).toEqual([['c1', 'retyped']])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 01.1·', 'bench 01.2·'])
  })

  it('a row with no planned set never gets a change, whatever it says (a change is keyed by the planned set)', () => {
    const head = addedLog('bench', 1, { number: 1 })
    const { row, view } = unlogOn({ cards: [card('bench', '', { added: 1 })], logs: [head], key: 'added:bench:1' })
    const doctored = { ...row, type: staged('dropset', 1), plannedType: { kind: 'normal' } as const, retyped: true }
    expect(unlogEffects(doctored, view).changes).toEqual([])
  })

  it('an added set made a dropset has no planned set to key a change on', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 1 })
    const { effects } = unlogOn({
      cards: [card('bench', '', { added: 1 })],
      logs: [head],
      changes: [held(pending(head, 'dropset', 1), 'c1')],
      key: 'added:bench:1',
    })
    expect(effects().changes).toEqual([])
  })
})

describe('unlogEffects reads nothing it is not given', () => {
  it('frozen session, the same answer twice, and the same with its lists the other way round', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const changes = [held(pending(head, 'dropset', 1), 'c1'), held(retyped('bench', 1, staged('dropset', 1)), 'c2')]
    const { view, row } = unlogOn({ cards: [card('bench', 'n')], logs: [head], changes, key: 'set:bench.1' })
    const frozen = deepFreeze({ ...view, rows: [...view.rows], logs: [...view.logs] as UnloggableSet[], changes: [...changes] })
    const first = unlogEffects(row, frozen)
    expect(unlogEffects(row, frozen)).toEqual(first)
    const turned = { ...view, rows: [...view.rows].reverse(), logs: [...view.logs].reverse() as UnloggableSet[], changes: [...changes].reverse() }
    expect(unlogEffects(row, turned)).toEqual(first)
  })
})
