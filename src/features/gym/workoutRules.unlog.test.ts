import { describe, expect, it } from 'vitest'
import type { SetLog } from '../../types'
import {
  canUnlog,
  currentSet,
  deleteEffects,
  finishWarning,
  lockDecision,
  resolveRows,
  unlogEffects,
  type HeldChange,
  type OrderExercise,
  type ResolvedRow,
  type SetDraftKey,
  type UnloggableSet,
  type UnlogEffects,
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

// ─── DECISIONS 151, Adam 2026-10-16 ─────────────────────────────────────────────────────────────
// "An unlogged set keeps its number and its place. Logging it again stores it with that same number, so unlog then log is
// an exact undo (SPEC 18c). No other set's number changes on unlog. The open row shows its own number (a planned set's
// position; an added set's number from its draft), never 'the next after the logged ones'."

/** What LOG writes for an open head row (chunks 58a and 63): the number the row shows, and the draft's numbers. */
function relog(server: FakeServer, row: ResolvedRow, draft: UnlogEffects['draft'], like: SetLog): SetLog {
  const log: SetLog = {
    ...like,
    id: `${like.id}.again`,
    setNumber: row.number,
    weight: draft.values.weight,
    reps: draft.values.reps,
    rir: draft.values.rir,
    formRating: draft.values.formRating,
    enteredUnit: draft.values.enteredUnit,
  }
  server.insertLog(log)
  return log
}

/** The logs as the session holds them, in the order of their numbers, without their ids: what an exact undo must restore. */
const stored = (logs: readonly SetLog[]) =>
  logs
    .map((l) => ({ weekPlanSetId: l.weekPlanSetId, setNumber: l.setNumber, weight: l.weight, reps: l.reps, rir: l.rir, isWarmup: l.isWarmup, stageKind: l.stageKind }))
    .sort((a, b) => a.setNumber - b.setNumber || String(a.weekPlanSetId).localeCompare(String(b.weekPlanSetId)))

describe('unlog keeps the set\'s number and its place; logging it again stores the same number (DECISIONS 151, SPEC 18c)', () => {
  const cards = [card('bench', 'n n n n')]
  const weights = [60, 62.5, 65]
  const logged = () => weights.map((w, i) => headLog('bench', i + 1, { weight: w, reps: 10 - i, rir: i }))

  it('bench 01–03 logged, 04 open; UNLOG on 02: it is still 02, between the logged 01 and 03, and nothing else moved', () => {
    const logs = logged()
    const { effects, apply, row } = unlogOn({ cards, logs, key: 'set:bench.2' })
    const { rows, current, warning, server } = apply()
    // the answer holds no number patches at all, and the logs that are left are the ones there were
    expect(Object.keys(effects()).sort()).toEqual(['changes', 'deleteOrder', 'draft'])
    expect(server.logs).toEqual([logs[0], logs[2]])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓', 'bench 04·'])
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4])
    // the unlogged set is the current one, and the finish warning, the lock's question and the next set all use its number
    expect(current).toMatchObject({ key: 'set:bench.2', number: 2 })
    expect(warning!.text).toBe("2 planned sets aren't logged yet: Bench 02 and 04.")
    expect(warning!.firstKey).toBe('set:bench.2')
    expect(row.number).toBe(2)
    const tapped = rows.find((r) => r.key === 'set:bench.4')!
    expect(lockDecision({ logInOrder: true, current, tapped })).toEqual({ ask: 'Log set 04 before set 02?', next: 'Bench 02', label: 'set 04' })
  })

  it('…and logging it again stores 02 with its own numbers: an exact undo', () => {
    const logs = logged()
    const { apply } = unlogOn({ cards, logs, key: 'set:bench.2' })
    const { effects, rows, server } = apply()
    relog(server, rows.find((r) => r.key === 'set:bench.2')!, effects.draft, logs[1])
    const order = orderOf(cards)
    expect(stored(server.logs)).toEqual(stored(logs))
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(currentSet(order, server.logs, server.held())!.number).toBe(4)
  })

  it('the control: logged again the way 1.1 wrote a head (the logged heads + 1) it stores a second 03 — what Adam ruled out', () => {
    const logs = logged()
    const { apply } = unlogOn({ cards, logs, key: 'set:bench.2' })
    const { effects, server } = apply()
    server.insertLog({ ...logs[1], id: 'again', setNumber: server.logs.length + 1, weight: effects.draft.values.weight, reps: effects.draft.values.reps })
    expect(server.logs.map((l) => l.setNumber).sort()).toEqual([1, 3, 3])
  })

  it('UNLOG on the last logged set (03), told apart from the middle one: it is open again at 03, the sets before it are as they were', () => {
    const logs = logged()
    const { apply } = unlogOn({ cards, logs, key: 'set:bench.3' })
    const { rows, current, warning, server } = apply()
    expect(server.logs).toEqual([logs[0], logs[1]])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04·'])
    expect(current).toMatchObject({ key: 'set:bench.3', number: 3 })
    expect(warning!.text).toBe("2 planned sets aren't logged yet: Bench 03 and 04.")
  })

  it('UNLOG on the first (01): the rest keep 02 and 03, and 01 is the current set', () => {
    const logs = logged()
    const { apply } = unlogOn({ cards, logs, key: 'set:bench.1' })
    const { rows, current, server } = apply()
    expect(server.logs).toEqual([logs[1], logs[2]])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(current!.key).toBe('set:bench.1')
  })

  it('the first, the middle and the last each: logging it again restores exactly what there was', () => {
    for (const n of [1, 2, 3]) {
      const logs = logged()
      const { apply } = unlogOn({ cards, logs, key: `set:bench.${n}` })
      const { effects, rows, server } = apply()
      relog(server, rows.find((r) => r.key === `set:bench.${n}`)!, effects.draft, logs[n - 1])
      expect(stored(server.logs), `set ${n}`).toEqual(stored(logs))
    }
  })

  it('one set after another, in any order: every open set keeps its place and logging them back in any order restores them', () => {
    const permutations = <T,>(items: T[]): T[][] =>
      items.length <= 1 ? [items] : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]))
    const four = [1, 2, 3, 4].map((n) => headLog('bench', n, { weight: 50 + n, reps: 8 }))
    const order = orderOf([card('bench', 'n n n n')])
    for (let subset = 1; subset < 16; subset++) {
      const away = [1, 2, 3, 4].filter((n) => subset & (1 << (n - 1)))
      for (const back of permutations(away)) {
        const server = new FakeServer({ logs: four })
        const drafts = new Map<number, UnlogEffects['draft']>()
        for (const n of away) {
          const view = viewOf(order, server.logs, server.held())
          const effects = unlogEffects(rowKeyed(view, `set:bench.${n}`), view)
          server.applyUnlog(effects)
          drafts.set(n, effects.draft)
          const rows = resolveRows(order, server.logs, server.held())
          expect(rows.map((r) => r.number), `unlogged ${away.join(',')} up to ${n}`).toEqual([1, 2, 3, 4])
        }
        for (const n of back) {
          const rows = resolveRows(order, server.logs, server.held())
          relog(server, rows.find((r) => r.key === `set:bench.${n}`)!, drafts.get(n)!, four[n - 1])
          expect(resolveRows(order, server.logs, server.held()).map((r) => r.number), `back ${back.join(',')} up to ${n}`).toEqual([1, 2, 3, 4])
        }
        expect(stored(server.logs), `away ${away.join(',')} back ${back.join(',')}`).toEqual(stored(four))
      }
    }
  })

  it('a set with drops: the drops and then the head are unlogged, and the head stays 02 with its drops open under it', () => {
    const head = headLog('pushdown', 2, { stageKind: 'dropset', weight: 40 })
    const d1 = dropLog(head, 1, { weight: 30 })
    const d2 = dropLog(head, 2, { weight: 20 })
    const all = [headLog('pushdown', 1), head, d1, d2, headLog('pushdown', 3)]
    const order = orderOf([card('pushdown', 'n d2 n')])
    const server = new FakeServer({ logs: all })
    for (const key of ['set:pushdown.2:stage:2', 'set:pushdown.2:stage:1', 'set:pushdown.2']) {
      const view = viewOf(order, server.logs, server.held())
      const row = rowKeyed(view, key)
      expect(canUnlog(row, view), key).toBe(true)
      server.applyUnlog(unlogEffects(row, view))
    }
    expect(server.logs.map((l) => [l.id, l.setNumber])).toEqual([['log.pushdown.1', 1], ['log.pushdown.3', 3]])
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['pushdown 01✓', 'pushdown 02·', 'pushdown 02.1·', 'pushdown 02.2·', 'pushdown 03✓'])
  })

  it('a logged warmup unlogged keeps its place among the warmups and moves no working set', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { warmup: true, number: 2 }), headLog('bench', 3, { number: 1 })]
    const { apply } = unlogOn({ cards: [card('bench', 'w w n n')], logs, key: 'set:bench.1' })
    const { rows, server } = apply()
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench W2✓', 'bench 01✓', 'bench 02·'])
    expect(server.logs.map((l) => l.setNumber)).toEqual([2, 1])
  })
})

describe('an added set unlogged keeps its number from its draft, and its place among the added sets (DECISIONS 151)', () => {
  const planned = [headLog('bench', 1, { weight: 50 }), headLog('bench', 2, { weight: 52 })]
  const added = (k: number) => addedLog('bench', k, { number: 2 + k, weight: 60 + k, reps: 12 - k })
  const all = [...planned, added(1), added(2), added(3)]
  const cardWith = (drafts: SetDraftKey[]) => card('bench', 'n n', { added: 3, drafts })

  /** Unlog the added set `k` (the screen then keeps the draft's key beside the card). */
  function unlogAdded(k: number, logs: SetLog[] = all) {
    const server = new FakeServer({ logs })
    const order0 = orderOf([cardWith([])])
    const view = viewOf(order0, server.logs, server.held())
    const row = rowKeyed(view, `added:bench:${k}`)
    const effects = unlogEffects(row, view)
    server.applyUnlog(effects)
    return { server, effects, drafts: [effects.draft.key] as SetDraftKey[] }
  }

  it('the middle added set (04): its draft is keyed by its number, and with it the set is still 04, between 03 and 05', () => {
    const { server, effects, drafts } = unlogAdded(2)
    expect(effects.draft.key).toEqual({ sessionId: SESSION, localId: 'log.bench.added2', exerciseId: 'ex.bench', position: 4 })
    const order = orderOf([cardWith(drafts)])
    const rows = resolveRows(order, server.logs, server.held())
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'added:bench:1', 'added:bench:2', 'added:bench:3'])
    expect(currentSet(order, server.logs, server.held())).toMatchObject({ key: 'added:bench:2', number: 4, draftPosition: 4 })
    // logging it again stores 04 and the draft is cleared: an exact undo
    const row = rows[3]
    relog(server, row, effects.draft, all[3])
    expect(stored(server.logs)).toEqual(stored(all))
    expect(resolveRows(orderOf([cardWith([])]), server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 05✓'])
  })

  it('the last added set (05), told apart from the middle one: it is the last row, at its number, with or without its draft', () => {
    const { server, drafts } = unlogAdded(3)
    for (const kept of [drafts, [] as SetDraftKey[]]) {
      expect(resolveRows(orderOf([cardWith(kept)]), server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 05·'])
    }
  })

  it('the first added set (03): it stays ahead of the added sets after it, at its number', () => {
    const { server, drafts } = unlogAdded(1)
    expect(resolveRows(orderOf([cardWith(drafts)]), server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04✓', 'bench 05✓'])
  })

  it('the control: without the draft (another phone, G46) the set is a new slot that takes the number that is free — the same place, with no draft to give back', () => {
    const { server } = unlogAdded(2)
    const rows = resolveRows(orderOf([cardWith([])]), server.logs, server.held())
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows.map((r) => r.draftPosition)).toEqual([null, null, null, null, null])
  })

  it('a planned set and an added set unlogged together are told apart: the planned one by its position, the added one by its draft', () => {
    const addedAfterThree = (k: number) => addedLog('bench', k, { number: 3 + k, weight: 60 + k, reps: 12 - k })
    const server = new FakeServer({ logs: [...planned, headLog('bench', 3, { weight: 54 }), addedAfterThree(1), addedAfterThree(2)] })
    const before = orderOf([card('bench', 'n n n', { added: 2 })])
    const view = viewOf(before, server.logs, server.held())
    const plannedRow = rowKeyed(view, 'set:bench.2')
    const addedRow = rowKeyed(view, 'added:bench:1')
    const plannedEffects = unlogEffects(plannedRow, view)
    const addedEffects = unlogEffects(addedRow, view)
    server.applyUnlog(plannedEffects)
    server.applyUnlog({ ...addedEffects, changes: [] })
    expect(plannedEffects.draft.key).toEqual({ sessionId: SESSION, weekPlanSetId: 'bench.2' })
    expect(addedEffects.draft.key).toMatchObject({ localId: 'log.bench.added1', position: 4 })
    const rows = resolveRows(orderOf([card('bench', 'n n n', { added: 2, drafts: [addedEffects.draft.key] })]), server.logs, server.held())
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows.filter((r) => r.state === 'unlogged').map((r) => [r.key, r.added, r.draftPosition])).toEqual([
      ['set:bench.2', false, null],
      ['added:bench:1', true, 4],
    ])
  })

  it('every way of unlogging some of five sets, planned and added, and logging them back in any of three orders, is an exact undo', () => {
    const logs = [...planned, added(1), added(2), added(3)]
    for (let subset = 1; subset < 32; subset++) {
      const away = [1, 2, 3, 4, 5].filter((n) => subset & (1 << (n - 1)))
      const keyOf = (n: number) => (n <= 2 ? `set:bench.${n}` : `added:bench:${n - 2}`)
      for (const back of [away, [...away].reverse(), [...away.slice(1), ...away.slice(0, 1)]]) {
        const server = new FakeServer({ logs })
        const draftOf = new Map<number, UnlogEffects['draft']>()
        let drafts: SetDraftKey[] = []
        const rowsNow = () => resolveRows(orderOf([cardWith(drafts)]), server.logs, server.held())
        for (const n of away) {
          const view = viewOf(orderOf([cardWith(drafts)]), server.logs, server.held())
          const effects = unlogEffects(rowKeyed(view, keyOf(n)), view)
          server.applyUnlog(effects)
          draftOf.set(n, effects.draft)
          if (n > 2) drafts = [...drafts, effects.draft.key]
          expect(rowsNow().map((r) => r.number), `away ${away} up to ${n}`).toEqual([1, 2, 3, 4, 5])
        }
        for (const n of back) {
          const row = rowsNow().find((r) => r.key === keyOf(n))!
          expect(row.number, `back ${back} at ${n}`).toBe(n)
          relog(server, row, draftOf.get(n)!, logs[n - 1])
          if (n > 2) drafts = drafts.filter((d) => !('position' in d) || d.position !== row.draftPosition)
          expect(rowsNow().map((r) => r.number), `back ${back} up to ${n}`).toEqual([1, 2, 3, 4, 5])
        }
        expect(stored(server.logs), `away ${away} back ${back}`).toEqual(stored(logs))
        expect(rowsNow().map((r) => r.state)).toEqual(Array(5).fill('logged'))
      }
    }
  })
})

describe('a drop\'s draft key is its number under the set, not its stored stage index (Y19, chunk 46\'s second review)', () => {
  it('three drops all logged, drop 1 deleted: the drop now read as drop 2 (stored stage index 3) is keyed drop: 2, and the open drop 2 is the one that finds it', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const logs = [head, dropLog(head, 1, { weight: 40 }), dropLog(head, 2, { weight: 35 }), dropLog(head, 3, { weight: 30 })]
    const order = orderOf([card('pushdown', 'd3')])
    const server = new FakeServer({ logs, changes: [] })
    // DELETE on drop 1 (board W8): its log goes and the set has two drops. The two logs left are read by count, as drops 1 and 2,
    // although the table holds them as stage indexes 2 and 3
    const first = viewOf(order, server.logs, server.held())
    server.applyDelete(deleteEffects(rowKeyed(first, 'set:pushdown.1:stage:1'), first))
    expect(server.logs.filter((l) => l.parentSetId === head.id).map((l) => l.stageIndex)).toEqual([2, 3])
    const after = viewOf(order, server.logs, server.held())
    expect(after.rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2✓'])
    const drop2 = rowKeyed(after, 'set:pushdown.1:stage:2')
    expect(drop2).toMatchObject({ stageNumber: 2, logId: `${head.id}.d3` })
    expect(canUnlog(drop2, after)).toBe(true)
    const effects = unlogEffects(drop2, after)
    expect(effects.deleteOrder.map((l) => [l.id, l.stageIndex])).toEqual([[`${head.id}.d3`, 3]])
    expect(effects.draft.key).toEqual({ sessionId: SESSION, weekPlanSetId: 'pushdown.1', drop: 2 })
    // applied, it is the open drop 2 and the draft keyed drop 2 is the one it is given back
    server.applyUnlog(effects)
    const open = resolveRows(order, server.logs, server.held())
    expect(open.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2·'])
    expect(currentSet(order, server.logs, server.held())).toMatchObject({ key: 'set:pushdown.1:stage:2', stageNumber: 2 })
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
