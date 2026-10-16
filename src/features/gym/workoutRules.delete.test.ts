import { describe, expect, it } from 'vitest'
import type { SetLog } from '../../types'
import {
  currentSet,
  deleteEffects,
  finishWarning,
  resolveRows,
  type DeleteEffects,
  type HeldChange,
  type OrderExercise,
  type OrderSuperset,
} from './workoutRules'
import { FakeServer, PgError } from './workoutRules.server.testutil'
import {
  addedLog,
  brief,
  card,
  deepFreeze,
  deleted,
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

// Chunk 46: DELETE (SPEC [1.2] "Delete set (18b)": "Logged and unlogged sets, this session only, never
// touches the plan. … The remaining sets renumber"; 13c: a planned set deleted during the session counts as
// Skipped; DECISIONS 147 (a): a set's last drop deleted makes it a normal set). `deleteEffects` says
// everything DELETE does, and every test below that matters APPLIES what it returns to a stand-in for the
// tables (`FakeServer`: 042's checks and unique indexes, the drops-first foreign key) and then reads the
// session the way the screen will: `resolveRows`, `currentSet`, `finishWarning` (RULES.md: "A write path's
// output is proven through the reader that draws it").

/** One session of these cards, with these logs and changes held; DELETE on the row with `key`, applied. */
function deleteOn(o: {
  cards: OrderExercise[]
  blocks?: OrderSuperset[]
  logs?: SetLog[]
  changes?: HeldChange[]
  key: string
  /** The cards after the delete, when the card's own count of added sets goes down with it. */
  cardsAfter?: OrderExercise[]
}) {
  const server = new FakeServer({ logs: o.logs ?? [], changes: o.changes ?? [] })
  const view = viewOf(orderOf(o.cards, o.blocks ?? []), server.logs, server.held())
  const effects = deleteEffects(rowKeyed(view, o.key), view)
  server.applyDelete(effects)
  const order = orderOf(o.cardsAfter ?? o.cards, o.blocks ?? [])
  return {
    effects,
    server,
    order,
    rows: resolveRows(order, server.logs, server.held()),
    current: currentSet(order, server.logs, server.held()),
    warning: finishWarning(order, server.logs, server.held()),
  }
}

// Bench with four heads. Head 3 has one drop, head 4 has two; every drop carries its head's number, as the
// app writes it.
function benchFour() {
  const heads = [1, 2, 3, 4].map((n) => headLog('bench', n, { number: n, stageKind: n >= 3 ? 'dropset' : null }))
  const drops = [dropLog(heads[2], 1), dropLog(heads[3], 1), dropLog(heads[3], 2)]
  const logs = [...heads, ...drops]
  const view = viewOf(orderOf([card('bench', 'n n d1 d2')]), logs)
  const effects = (n: number) => deleteEffects(rowKeyed(view, `set:bench.${n}`), view)
  return { heads, drops, logs, view, effects }
}

describe('deleteEffects: the order of the deletes', () => {
  it('the drops from the last, then the head (a failure partway leaves a head with fewer drops, never orphans)', () => {
    const effects = benchFour().effects(4)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.4.d2', 'log.bench.4.d1', 'log.bench.4'])
    expect(effects.stageCount).toBe(2)
  })

  it('a head with no drops is deleted alone and says no drop goes with it', () => {
    const effects = benchFour().effects(2)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.2'])
    expect(effects.stageCount).toBe(0)
  })

  it('the drops are taken in the order of their stage index whatever order the logs come in', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const logs = [dropLog(head, 5), dropLog(head, 2), head, dropLog(head, 9)]
    const view = viewOf(orderOf([card('bench', 'd3')]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).deleteOrder.map((l) => l.id)).toEqual([
      `${head.id}.d9`,
      `${head.id}.d5`,
      `${head.id}.d2`,
      head.id,
    ])
  })
})

describe('deleteEffects: the sets after it close the gap', () => {
  it('deleting head 02 of 04 renumbers 03 to 02 and 04 to 03, and their drops with them (F4)', () => {
    expect(benchFour().effects(2).renumber).toEqual([
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.3.d1', setNumber: 2 },
      { id: 'log.bench.4', setNumber: 3 },
      { id: 'log.bench.4.d1', setNumber: 3 },
      { id: 'log.bench.4.d2', setNumber: 3 },
    ])
  })

  it('the head deleted is not renumbered, nor are the sets before it; deleting the last renumbers nothing', () => {
    const { effects } = benchFour()
    expect(effects(4).renumber).toEqual([])
    const first = effects(1).renumber
    expect(first.map((r) => r.id)).not.toContain('log.bench.1')
    expect(first.filter((r) => r.id.startsWith('log.bench.2'))).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
  })

  it('moves each logged set after it down by one, not to the next number: an open set between them holds its place (DECISIONS 151)', () => {
    // 01, 02 and 05 are logged, 03 and 04 are open: 02 is deleted, so 03 and 04 become 02 and 03 and 05 becomes 04
    const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 5)]
    const view = viewOf(orderOf([card('bench', 'n n n n n')]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.2'), view).renumber).toEqual([{ id: 'log.bench.5', setNumber: 4 }])
    const { rows } = deleteOn({ cards: [card('bench', 'n n n n n')], logs, key: 'set:bench.2' })
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03·', 'bench 04✓'])
  })

  it('a later head\'s stale drop is put right with its head: the drop says 9, its head goes from 4 to 3, so the drop is written 3', () => {
    const gone = headLog('bench', 1, { number: 2 })
    const a = headLog('bench', 2, { number: 3 })
    const b = headLog('bench', 3, { number: 4, stageKind: 'dropset' })
    const stale = dropLog(b, 1, { number: 9 })
    const view = viewOf(orderOf([card('bench', 'n n n')]), [gone, a, b, stale])
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 3 },
      { id: stale.id, setNumber: 3 },
    ])
  })

  it('a drop that already carries its head\'s new number is not written again', () => {
    const gone = headLog('bench', 1, { number: 1 })
    const next = headLog('bench', 2, { number: 2, stageKind: 'dropset' })
    const drop = dropLog(next, 1, { number: 1 }) // already says 1, what its head is about to become
    const view = viewOf(orderOf([card('bench', 'n n')]), [gone, next, drop])
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
  })

  it('takes the sets after it in the order of their numbers, whatever order they are given in', () => {
    const heads = [1, 2, 3, 4].map((n) => headLog('bench', n, { number: n })).reverse()
    const view = viewOf(orderOf([card('bench', 'n n n n')]), heads)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.4', setNumber: 3 },
    ])
  })

  it('only the same exercise\'s sets are renumbered', () => {
    const logs = [
      headLog('bench', 1, { number: 1 }),
      headLog('bench', 2, { number: 2 }),
      headLog('row', 1, { number: 5 }),
      headLog('row', 2, { number: 6 }),
    ]
    const view = viewOf(orderOf([card('bench', 'n n'), card('row', 'n n')]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
  })

  it('a skipped set is renumbered like any other (it has a number)', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2, { skipped: true }), headLog('bench', 3)]
    const view = viewOf(orderOf([card('bench', 'n n n')]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
    ])
  })

  it('a set added in the session is a head like any other', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), addedLog('bench', 1, { number: 3 })]
    const view = viewOf(orderOf([card('bench', 'n n', { added: 1 })]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.added1', setNumber: 2 },
    ])
  })
})

describe('deleteEffects: what renumbers nothing', () => {
  it('a warmup — it is not numbered with the working sets — and the warmups when a working set goes', () => {
    const logs = [
      headLog('bench', 1, { warmup: true, number: 1 }),
      headLog('bench', 2, { warmup: true, number: 2 }),
      headLog('bench', 3, { number: 1 }),
      headLog('bench', 4, { number: 2 }),
    ]
    const view = viewOf(orderOf([card('bench', 'w w n n')]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([])
    expect(deleteEffects(rowKeyed(view, 'set:bench.3'), view).renumber).toEqual([{ id: 'log.bench.4', setNumber: 1 }])
  })

  it('a drop deleted on its own: just that log (its number is its head\'s, and the sets after the head keep theirs)', () => {
    const { view, drops } = benchFour()
    const effects = deleteEffects(rowKeyed(view, 'set:bench.3:stage:1'), view)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([drops[0].id])
    expect(effects.renumber).toEqual([])
    expect(effects.stageCount).toBe(0)
  })

  it('reads and writes nothing it is handed, and answers the same with its inputs the other way round', () => {
    const { logs } = benchFour()
    const order = orderOf([card('bench', 'n n d1 d2')])
    const changes = [held(retyped('bench', 2, staged('dropset', 1)), 'c1')]
    const view = deepFreeze(viewOf(order, logs, changes))
    const first = deleteEffects(rowKeyed(view, 'set:bench.2'), view)
    expect(deleteEffects(rowKeyed(view, 'set:bench.2'), view)).toEqual(first)
    const turned = viewOf(order, [...logs].reverse(), [...changes].reverse())
    const again = deleteEffects(rowKeyed(turned, 'set:bench.2'), { ...turned, rows: [...turned.rows].reverse() })
    expect(again).toEqual(first)
    expect(view.logs.map((l) => l.id)).toEqual(logs.map((l) => l.id))
  })
})

describe('DELETE on a logged planned set: it never comes back as an open row (SPEC 18b, 13c)', () => {
  const cards = [card('bench', 'n n n n')]
  const logs = [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]

  it('before: 01 02 03 logged and 04 is the current set', () => {
    const order = orderOf(cards)
    expect(resolveRows(order, logs).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(currentSet(order, logs)!.number).toBe(4)
  })

  it('returns the log delete, the renumbering and a "deleted" change for the planned set', () => {
    const { effects } = deleteOn({ cards, logs, key: 'set:bench.2' })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.2'])
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: null }])
    expect(effects.headPatch).toBeNull()
    expect(effects.type).toBeNull()
  })

  it('applied, the rows read 01 02 logged and 03 open, the deleted set is nowhere, 03 is the current set and the finish warning is one set', () => {
    const { rows, current, warning, server } = deleteOn({ cards, logs, key: 'set:bench.2' })
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.3', 'set:bench.4'])
    expect(current!.key).toBe('set:bench.4')
    expect(current!.number).toBe(3)
    expect(warning!.text).toBe("1 planned set isn't logged yet: Bench 03.")
    expect(server.held()).toEqual([{ kind: 'deleted', weekPlanSetId: 'bench.2', id: 'chg.new.1' }])
  })

  it('the control: with the change left out the set is an open row again, the current set and in the warning (the failure found in the first review of chunk 46)', () => {
    const server = new FakeServer({ logs })
    const view = viewOf(orderOf(cards), server.logs, [])
    const effects = deleteEffects(rowKeyed(view, 'set:bench.2'), view)
    server.applyDelete({ ...effects, changes: [] })
    const order = orderOf(cards)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 03·', 'bench 02✓', 'bench 04·'])
    expect(currentSet(order, server.logs, server.held())!.weekPlanSetId).toBe('bench.2')
    expect(finishWarning(order, server.logs, server.held())!.text).toBe("2 planned sets aren't logged yet: Bench 03 and 04.")
  })

  it('deleting the first, a middle and the last logged set each leave the rest in order', () => {
    const all = [1, 2, 3, 4].map((n) => headLog('bench', n))
    for (const [n, left] of [
      [1, ['set:bench.2', 'set:bench.3', 'set:bench.4']],
      [3, ['set:bench.1', 'set:bench.2', 'set:bench.4']],
      [4, ['set:bench.1', 'set:bench.2', 'set:bench.3']],
    ] as const) {
      const { rows, current, warning } = deleteOn({ cards: [card('bench', 'n n n n')], logs: all, key: `set:bench.${n}` })
      expect(rows.map((r) => r.key)).toEqual(left)
      expect(rows.map((r) => r.number)).toEqual([1, 2, 3])
      expect(rows.every((r) => r.state === 'logged')).toBe(true)
      expect(current).toBeNull()
      expect(warning).toBeNull()
    }
  })

  it('a logged head with logged drops: the drops go first, the later head and its drop renumber, and none of it comes back', () => {
    const { heads, logs: all, drops } = benchFour()
    const { effects, rows, server } = deleteOn({ cards: [card('bench', 'n n d1 d2')], logs: all, key: 'set:bench.3' })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([drops[0].id, heads[2].id])
    expect(effects.stageCount).toBe(1)
    expect(effects.renumber).toEqual([
      { id: 'log.bench.4', setNumber: 3 },
      { id: 'log.bench.4.d1', setNumber: 3 },
      { id: 'log.bench.4.d2', setNumber: 3 },
    ])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 03.1✓', 'bench 03.2✓'])
    // the planned set is gone with its planned drop
    expect(rows.map((r) => r.key)).not.toContain('set:bench.3')
    expect(server.logs.map((l) => l.id)).not.toContain('log.bench.3')
  })

  it('a skipped set is deleted like a logged one and does not come back', () => {
    const logs3 = [headLog('bench', 1), headLog('bench', 2, { skipped: true }), headLog('bench', 3)]
    const { effects, rows, warning } = deleteOn({ cards: [card('bench', 'n n n n')], logs: logs3, key: 'set:bench.2' })
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: null }])
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(warning!.text).toBe("1 planned set isn't logged yet: Bench 03.")
  })

  it('a logged warmup is deleted too: no working set renumbers, the other warmup moves up, and it does not come back', () => {
    const logs2 = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { warmup: true, number: 2 }), headLog('bench', 3, { number: 1 })]
    const { effects, rows, current } = deleteOn({ cards: [card('bench', 'w w n n')], logs: logs2, key: 'set:bench.1' })
    expect(effects.renumber).toEqual([])
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: null }])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02·'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.2', 'set:bench.3', 'set:bench.4'])
    expect(current!.key).toBe('set:bench.4')
  })

  it('in a superset the rounds are formed again from the sets that are left', () => {
    const cardsBlock = [card('row', 'n n n'), card('lat', 'n n n')]
    const blocks = [{ id: 'blk', members: ['row', 'lat'] }]
    const logs1 = [headLog('row', 1), headLog('lat', 1)]
    const before = resolveRows(orderOf(cardsBlock, blocks), logs1).map(brief)
    expect(before).toEqual(['row A1✓', 'lat B1✓', 'row A2·', 'lat B2·', 'row A3·', 'lat B3·'])
    const { effects, rows } = deleteOn({ cards: cardsBlock, blocks, logs: logs1, key: 'set:row.1' })
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'row.1' }, id: null }])
    expect(rows.map(brief)).toEqual(['row A1·', 'lat B1✓', 'row A2·', 'lat B2·', 'lat B3·'])
    expect(rows.map((r) => r.key)).toEqual(['set:row.2', 'set:lat.1', 'set:row.3', 'set:lat.2', 'set:lat.3'])
  })
})

describe('DELETE on a planned set that is not logged yet: the same change, no log to delete', () => {
  it('writes only the "deleted" change; the rows after it renumber and the plan is untouched', () => {
    const cards = [card('bench', 'n n n')]
    const { effects, rows, current, warning } = deleteOn({ cards, logs: [headLog('bench', 1)], key: 'set:bench.2' })
    expect(effects.deleteOrder).toEqual([])
    expect(effects.renumber).toEqual([])
    expect(effects.stageCount).toBe(0)
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: null }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.3'])
    expect(current!.key).toBe('set:bench.3')
    expect(warning!.text).toBe("1 planned set isn't logged yet: Bench 02.")
  })

  it('a planned dropset takes its planned drops with it', () => {
    const { rows } = deleteOn({ cards: [card('pushdown', 'n d2')], key: 'set:pushdown.2' })
    expect(rows.map(brief)).toEqual(['pushdown 01·'])
  })

  it('an unlogged planned warmup', () => {
    const { effects, rows } = deleteOn({ cards: [card('bench', 'w w n')], key: 'set:bench.1' })
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: null }])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01·'])
  })
})

// DECISIONS 151: an unlogged set keeps its place, so a logged set can come after an open one (unlog 02 of 01 to 03), and
// SPEC 18b's "the remaining sets renumber" has to reach it when the open set is deleted: its stored number is the one
// that would otherwise stay one too high, and History would keep a hole.
describe('DELETE on an open set with logged sets after it (DECISIONS 151, SPEC 18b)', () => {
  const cards = [card('bench', 'n n n n')]

  it('02 open between the logged 01 and 03: deleting it moves 03 down to 02, and 04 is 03', () => {
    const logs = [headLog('bench', 1), headLog('bench', 3)]
    const { effects, rows, server, current, warning } = deleteOn({ cards, logs, key: 'set:bench.2' })
    expect(effects.deleteOrder).toEqual([])
    expect(effects.renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: null }])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(server.logs.map((l) => l.setNumber).sort()).toEqual([1, 2])
    expect(current!.key).toBe('set:bench.4')
    expect(warning!.text).toBe("1 planned set isn't logged yet: Bench 03.")
  })

  it('the control: without the renumbering the logged 03 keeps its number, the open set after it reads 02 and History keeps a hole', () => {
    const server = new FakeServer({ logs: [headLog('bench', 1), headLog('bench', 3)] })
    const view = viewOf(orderOf(cards), server.logs, [])
    const effects = deleteEffects(rowKeyed(view, 'set:bench.2'), view)
    server.applyDelete({ ...effects, renumber: [] })
    expect(resolveRows(orderOf(cards), server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 03✓', 'bench 02·'])
  })

  it('every logged set after it moves, each down by one, with its drops; the sets before it, and an open one after, do not', () => {
    const three = headLog('bench', 3, { stageKind: 'dropset' })
    const five = headLog('bench', 5)
    const logs = [headLog('bench', 1), three, dropLog(three, 1), five]
    const { effects, rows } = deleteOn({ cards: [card('bench', 'n n d1 n n')], logs, key: 'set:bench.2' })
    expect(effects.renumber).toEqual([
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.3.d1', setNumber: 2 },
      { id: 'log.bench.5', setNumber: 4 },
    ])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 02.1✓', 'bench 03·', 'bench 04✓'])
  })

  it('an open set with no logged set after it renumbers nothing (as before)', () => {
    const { effects } = deleteOn({ cards, logs: [headLog('bench', 1), headLog('bench', 2)], key: 'set:bench.4' })
    expect(effects.renumber).toEqual([])
    const first = deleteOn({ cards, logs: [], key: 'set:bench.1' })
    expect(first.effects.renumber).toEqual([])
  })

  it('the number it leaves is the one it shows, not its place in the plan: with a warmup first, 02 open between 01 and 03 logged', () => {
    // the plan is 'w n n n' (the warmup is its set 1), so the open working set 02 is the plan's set 3
    const logs = [headLog('bench', 2, { number: 1 }), headLog('bench', 4, { number: 3 })]
    const { effects, rows } = deleteOn({ cards: [card('bench', 'w n n n')], logs, key: 'set:bench.3' })
    expect(effects.renumber).toEqual([{ id: 'log.bench.4', setNumber: 2 }])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
  })

  it('the answer is the same with the logs the other way round', () => {
    const three = headLog('bench', 3, { stageKind: 'dropset' })
    const logs = [headLog('bench', 1), three, dropLog(three, 1), headLog('bench', 5)]
    const order = orderOf([card('bench', 'n n d1 n n')])
    const forward = viewOf(order, logs)
    const turned = viewOf(order, [...logs].reverse())
    expect(deleteEffects(rowKeyed(turned, 'set:bench.2'), turned)).toEqual(deleteEffects(rowKeyed(forward, 'set:bench.2'), forward))
  })

  it('an open warmup is not one of the working numbers: deleting it moves nothing', () => {
    const logs = [headLog('bench', 2, { number: 1 }), headLog('bench', 3, { number: 2 })]
    const { effects, rows } = deleteOn({ cards: [card('bench', 'w n n')], logs, key: 'set:bench.1' })
    expect(effects.renumber).toEqual([])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓'])
  })

  it('an open set of another exercise moves nothing here', () => {
    const logs = [headLog('row', 2, { number: 2 }), headLog('bench', 3)]
    const view = viewOf(orderOf([card('bench', 'n n n'), card('row', 'n n n')]), logs)
    expect(deleteEffects(rowKeyed(view, 'set:bench.1'), view).renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
  })

  it('an added set that is open (its draft kept) is deleted like any: the logged added sets after it close the gap', () => {
    const draft = { sessionId: 's1', localId: 'log.bench.added1', exerciseId: 'ex.bench', position: 3 } as const
    const withDraft = [card('bench', 'n n', { added: 3, drafts: [draft] })]
    const logs = [headLog('bench', 1), headLog('bench', 2), addedLog('bench', 2, { number: 4 }), addedLog('bench', 3, { number: 5 })]
    const { effects, rows, server } = deleteOn({ cards: withDraft, logs, key: 'added:bench:1', cardsAfter: [card('bench', 'n n', { added: 2 })] })
    expect(effects.changes).toEqual([])
    expect(effects.renumber).toEqual([
      { id: 'log.bench.added2', setNumber: 3 },
      { id: 'log.bench.added3', setNumber: 4 },
    ])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
    expect(server.logs.map((l) => l.setNumber).sort()).toEqual([1, 2, 3, 4])
  })

  it('a fresh added slot (ADD SET, never logged) goes with nothing to move', () => {
    const { effects } = deleteOn({ cards: [card('bench', 'n n', { added: 1 })], logs: [headLog('bench', 1), headLog('bench', 2)], key: 'added:bench:1', cardsAfter: [card('bench', 'n n')] })
    expect(effects.renumber).toEqual([])
  })
})

describe('DELETE turns the set\'s "retyped" row into "deleted": the same row, its type cleared (Adam\'s rule)', () => {
  it('an unlogged set retyped to a warmup: the write carries the row\'s own id and clears the warmup flag', () => {
    const changes = [held(retyped('bench', 1, { kind: 'warmup' }), 'c1')]
    const { effects, server, rows } = deleteOn({ cards: [card('bench', 'n n')], changes, key: 'set:bench.1' })
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: 'c1' }])
    expect(server.rows).toEqual([
      { id: 'c1', kind: 'deleted', weekPlanSetId: 'bench.1', setLogId: null, isWarmup: false, stageKind: null, stageCount: 0 },
    ])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.2'])
  })

  it('an unlogged set retyped to a dropset: the stage kind and count are cleared in the same write', () => {
    const changes = [held(retyped('bench', 2, staged('rest_pause', 3)), 'c7')]
    const { server } = deleteOn({ cards: [card('bench', 'n n')], changes, key: 'set:bench.2' })
    expect(server.rows).toEqual([
      { id: 'c7', kind: 'deleted', weekPlanSetId: 'bench.2', setLogId: null, isWarmup: false, stageKind: null, stageCount: 0 },
    ])
  })

  it('a logged set that was retyped: the "deleted" row takes the "retyped" row\'s id, and the "pending_stages" row goes with the log', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const changes = [held(retyped('bench', 1, staged('dropset', 2)), 'c1'), held(pending(head, 'dropset', 2), 'c2')]
    const { effects, server, rows } = deleteOn({ cards: [card('bench', 'n n')], logs: [head, drop], changes, key: 'set:bench.1' })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([drop.id, head.id])
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: 'c1' }])
    expect(server.rows.map((r) => [r.id, r.kind])).toEqual([['c1', 'deleted']])
    expect(rows.map(brief)).toEqual(['bench 01·'])
  })

  it('the control: the table refuses a second row for the set under a new id, and a kind-only update of a row that holds a type', () => {
    const changes = [held(retyped('bench', 1, { kind: 'warmup' }), 'c1')]
    const noId = new FakeServer({ logs: [], changes })
    expect(() => noId.upsertChange({ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: null })).toThrow(PgError)
    expect(() => noId.upsertChange({ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: null })).toThrow(/23505/)
    const partial = new FakeServer({ logs: [], changes })
    expect(() => partial.updateChange('c1', { kind: 'deleted' })).toThrow(/23514.*deleted_check/)
  })

  it('the screen\'s copy of the change rows may still hold the "pending_stages" row of a log that is gone: the rows read the same', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const stale = held(pending(head, 'dropset', 2), 'c2')
    const cards = [card('pushdown', 'n n')]
    const { server } = deleteOn({ cards, logs: [head, dropLog(head, 1), dropLog(head, 2)], changes: [stale], key: 'set:pushdown.1' })
    const order = orderOf(cards)
    const fresh = resolveRows(order, server.logs, server.held()).map(brief)
    expect(resolveRows(order, server.logs, [stale, ...server.held()]).map(brief)).toEqual(fresh)
    expect(fresh).toEqual(['pushdown 01·'])
  })

  it('a second tap on a delete whose "deleted" row is already held writes that same row, not another', () => {
    const cards = [card('bench', 'n n n')]
    const fresh = viewOf(orderOf(cards), [], []) // the screen has not drawn the delete yet
    const view = { ...fresh, changes: [held(deleted('bench', 2), 'c1')] }
    expect(deleteEffects(rowKeyed(view, 'set:bench.2'), view).changes).toEqual([
      { change: { kind: 'deleted', weekPlanSetId: 'bench.2' }, id: 'c1' },
    ])
  })

  it('a set that has no row yet gets a new one (no id), and another set\'s row is left alone', () => {
    const changes = [held(retyped('bench', 2, { kind: 'warmup' }), 'c2')]
    const { effects, server } = deleteOn({ cards: [card('bench', 'n n n')], changes, key: 'set:bench.1' })
    expect(effects.changes).toEqual([{ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: null }])
    expect(server.rows.map((r) => [r.id, r.kind, r.weekPlanSetId])).toEqual([
      ['c2', 'retyped', 'bench.2'],
      ['chg.new.1', 'deleted', 'bench.1'],
    ])
  })
})

describe('DELETE on a set added in the session: no change row (it has no planned set)', () => {
  it('a logged added set: the log goes, the added sets after it renumber, and the card lowers its count of added sets', () => {
    const logs3 = [headLog('bench', 1), addedLog('bench', 1, { number: 2 }), addedLog('bench', 2, { number: 3 })]
    const { effects, rows } = deleteOn({
      cards: [card('bench', 'n', { added: 2 })],
      cardsAfter: [card('bench', 'n', { added: 1 })],
      logs: logs3,
      key: 'added:bench:1',
    })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.added1'])
    expect(effects.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 2 }])
    expect(effects.changes).toEqual([])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓'])
  })

  it('an added set not logged yet: nothing to write at all (the card\'s own state)', () => {
    const { effects, rows } = deleteOn({
      cards: [card('bench', 'n', { added: 1 })],
      cardsAfter: [card('bench', 'n', { added: 0 })],
      key: 'added:bench:1',
    })
    expect(effects).toEqual({ deleteOrder: [], stageCount: 0, renumber: [], changes: [], headPatch: null, type: null })
    expect(rows.map(brief)).toEqual(['bench 01·'])
  })

  it('an added dropset: its drop goes first and its "pending_stages" row goes with the log', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 2 })
    const drop = dropLog(head, 1)
    const changes = [held(pending(head, 'dropset', 2), 'c1')]
    const { effects, server, rows } = deleteOn({
      cards: [card('bench', 'n', { added: 1 })],
      cardsAfter: [card('bench', 'n', { added: 0 })],
      logs: [headLog('bench', 1), head, drop],
      changes,
      key: 'added:bench:1',
    })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([drop.id, head.id])
    expect(effects.changes).toEqual([])
    expect(server.rows).toEqual([])
    expect(rows.map(brief)).toEqual(['bench 01✓'])
  })
})

describe('DELETE on a drop on its own (board W8): the set has one drop fewer and it does not come back', () => {
  it('a logged drop 2 of 2 on a planned dropset: its log goes, the set\'s change rows say one drop, and the rows end at drop 1', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const d1 = dropLog(head, 1)
    const d2 = dropLog(head, 2)
    const cards = [card('pushdown', 'd2')]
    const view = viewOf(orderOf(cards), [head, d1, d2])
    expect(view.rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2✓'])
    const { effects, rows, current, warning } = deleteOn({ cards, logs: [head, d1, d2], key: 'set:pushdown.1:stage:2' })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([d2.id])
    expect(effects.stageCount).toBe(0)
    expect(effects.renumber).toEqual([])
    expect(effects.type).toEqual(staged('dropset', 1))
    expect(effects.headPatch).toBeNull()
    expect(effects.changes).toEqual([
      { change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: staged('dropset', 1) }, id: null },
      { change: { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 }, id: null },
    ])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
    expect(current).toBeNull()
    expect(warning).toBeNull()
  })

  it('the control: with the count left out the deleted drop is an open drop again and the current set (the failure found in the first review of chunk 46)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const logs3 = [head, dropLog(head, 1), dropLog(head, 2)]
    const cards = [card('pushdown', 'd2')]
    const server = new FakeServer({ logs: logs3 })
    const view = viewOf(orderOf(cards), server.logs, [])
    server.applyDelete({ ...deleteEffects(rowKeyed(view, 'set:pushdown.1:stage:2'), view), changes: [] })
    const order = orderOf(cards)
    expect(resolveRows(order, server.logs, server.held()).map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2·'])
    expect(currentSet(order, server.logs, server.held())!.key).toBe('set:pushdown.1:stage:2')
  })

  it('a logged drop 1 of 3: "drop 2 becomes drop 1" — the drops left are the first two, and they are the logged ones', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const logs3 = [head, dropLog(head, 1), dropLog(head, 2), dropLog(head, 3)]
    const { effects, rows } = deleteOn({ cards: [card('pushdown', 'd3')], logs: logs3, key: 'set:pushdown.1:stage:1' })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([`${head.id}.d1`])
    expect(effects.type).toEqual(staged('dropset', 2))
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2✓'])
    expect(rows.slice(1).map((r) => r.logId)).toEqual([`${head.id}.d2`, `${head.id}.d3`])
  })

  it('an open drop under a logged set: nothing to delete, the count goes down by one', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const { effects, rows, current } = deleteOn({
      cards: [card('pushdown', 'd2')],
      logs: [head, dropLog(head, 1)],
      key: 'set:pushdown.1:stage:2',
    })
    expect(effects.deleteOrder).toEqual([])
    expect(effects.type).toEqual(staged('dropset', 1))
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
    expect(current).toBeNull()
  })

  it('a skipped drop is deleted like a logged one', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const { effects, rows } = deleteOn({
      cards: [card('pushdown', 'd2')],
      logs: [head, dropLog(head, 1), dropLog(head, 2, { skipped: true })],
      key: 'set:pushdown.1:stage:2',
    })
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([`${head.id}.d2`])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
  })

  it('an open drop under an open planned set: the set\'s "retyped" row has one drop fewer, nothing is logged', () => {
    const { effects, rows, server } = deleteOn({ cards: [card('pushdown', 'n d2')], key: 'set:pushdown.2:stage:1' })
    expect(effects.deleteOrder).toEqual([])
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.2', type: staged('dropset', 1) }, id: null }])
    expect(rows.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·', 'pushdown 02.1·'])
    expect(server.held().map((c) => c.kind)).toEqual(['retyped'])
  })

  it('an open set given a stage kind in the workout, one of its drops deleted: its "retyped" row, on its own id, has one drop fewer', () => {
    const changes = [held(retyped('pushdown', 1, staged('rest_pause', 3)), 'c1')]
    const { effects, rows } = deleteOn({ cards: [card('pushdown', 'n')], changes, key: 'set:pushdown.1:stage:3' })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: staged('rest_pause', 2) }, id: 'c1' }])
    expect(rows.map(brief)).toEqual(['pushdown 01·', 'pushdown 01.1·', 'pushdown 01.2·'])
  })

  it('a logged planned set that holds both change rows: each is replaced on its own id', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const changes = [held(retyped('pushdown', 1, staged('dropset', 3)), 'c1'), held(pending(head, 'dropset', 3), 'c2')]
    const { effects, server, rows } = deleteOn({
      cards: [card('pushdown', 'n')],
      logs: [head, dropLog(head, 1), dropLog(head, 2), dropLog(head, 3)],
      changes,
      key: 'set:pushdown.1:stage:3',
    })
    expect(effects.changes.map((w) => w.id)).toEqual(['c1', 'c2'])
    expect(server.rows.map((r) => [r.id, r.kind, r.stageCount])).toEqual([
      ['c1', 'retyped', 2],
      ['c2', 'pending_stages', 2],
    ])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2✓'])
  })

  it('a set the plan never made a dropset, made one in the workout and given a drop that is now deleted: the set is Normal again', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const changes = [held(retyped('pushdown', 1, staged('dropset', 1)), 'c1'), held(pending(head, 'dropset', 1), 'c2')]
    const { effects, server, rows } = deleteOn({
      cards: [card('pushdown', 'n')],
      logs: [head, dropLog(head, 1)],
      changes,
      key: 'set:pushdown.1:stage:1',
    })
    expect(effects.type).toEqual({ kind: 'normal' })
    expect(effects.headPatch).toEqual({ id: head.id, stageKind: null })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: { kind: 'normal' } }, id: 'c1' }])
    expect(server.logs.find((l) => l.id === head.id)!.stageKind).toBeNull()
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
  })

  it('an added set\'s drop: the count lives on its "pending_stages" row alone, under the row\'s own id', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 2 })
    const changes = [held(pending(head, 'dropset', 2), 'c1')]
    const { effects, server, rows } = deleteOn({
      cards: [card('bench', 'n', { added: 1 })],
      logs: [headLog('bench', 1), head, dropLog(head, 1), dropLog(head, 2)],
      changes,
      key: 'added:bench:1:stage:2',
    })
    expect(effects.changes).toEqual([{ change: { kind: 'pending_stages', setLogId: head.id, stageKind: 'dropset', stageCount: 1 }, id: 'c1' }])
    expect(server.rows.map((r) => [r.id, r.stageCount])).toEqual([['c1', 1]])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 02.1✓'])
  })

  it('a drop of a superset member: the round it sits in keeps its place', () => {
    const cardsBlock = [card('row', 'n d2'), card('lat', 'n n')]
    const blocks = [{ id: 'blk', members: ['row', 'lat'] }]
    const { rows } = deleteOn({ cards: cardsBlock, blocks, key: 'set:row.2:stage:2' })
    expect(rows.map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'row A2.1·', 'lat B2·'])
  })

  it('refuses a drop whose set is not staged, and reads nothing it is not given', () => {
    const view = viewOf(orderOf([card('pushdown', 'n d1')]), [])
    const drop = rowKeyed(view, 'set:pushdown.2:stage:1')
    expect(() => deleteEffects(drop, { ...view, rows: view.rows.filter((r) => r.key !== 'set:pushdown.2') })).toThrow(RangeError)
    const asNormal = view.rows.map((r) => (r.key === 'set:pushdown.2' ? { ...r, type: { kind: 'normal' } as const } : r))
    expect(() => deleteEffects(drop, { ...view, rows: asNormal })).toThrow(RangeError)
  })
})

describe('DELETE of a set\'s last drop makes it a normal set (DECISIONS 147 (a))', () => {
  it('a logged planned dropset: its log loses its kind and the planned set gets a "retyped" Normal row', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    const { effects, server, rows, current } = deleteOn({ cards: [card('pushdown', 'd1')], logs: [head, drop], key: 'set:pushdown.1:stage:1' })
    expect(effects.type).toEqual({ kind: 'normal' })
    expect(effects.headPatch).toEqual({ id: head.id, stageKind: null })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: { kind: 'normal' } }, id: null }])
    expect(server.rows.map((r) => [r.kind, r.isWarmup, r.stageKind, r.stageCount])).toEqual([['retyped', false, null, 0]])
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
    expect(rows[0].type).toEqual({ kind: 'normal' })
    expect(current).toBeNull()
  })

  it('a logged set whose "pending_stages" row held its drop: no row is written for a Normal set (042 refuses a kind without a count)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'rest_pause' })
    const changes = [held(retyped('pushdown', 1, staged('rest_pause', 1)), 'c1'), held(pending(head, 'rest_pause', 1), 'c2')]
    const { effects, rows } = deleteOn({ cards: [card('pushdown', 'n')], logs: [head, dropLog(head, 1)], changes, key: 'set:pushdown.1:stage:1' })
    expect(effects.changes.map((w) => w.change.kind)).toEqual(['retyped'])
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
  })

  it('a pre-1.1 dropset (no kind on its head, a drop planned) with its drop logged: the "retyped" Normal row is what says it is plain now', () => {
    const head = headLog('pushdown', 1) // a kindless head logs null
    const drop = dropLog(head, 1)
    const cards = [card('pushdown', 'l1')]
    expect(viewOf(orderOf(cards), [head, drop]).rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
    const { effects, rows, current, server } = deleteOn({ cards, logs: [head, drop], key: 'set:pushdown.1:stage:1' })
    expect(effects.headPatch).toBeNull() // its log has no kind to lose
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.1', type: { kind: 'normal' } }, id: null }])
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
    expect(current).toBeNull()
    expect(server.logs.map((l) => l.id)).toEqual([head.id])
  })

  it('the same pre-1.1 dropset with its drop still to log: the open drop deleted, the set is plain', () => {
    const head = headLog('pushdown', 1)
    const { rows, current } = deleteOn({ cards: [card('pushdown', 'l1')], logs: [head], key: 'set:pushdown.1:stage:1' })
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
    expect(current).toBeNull()
  })

  it('a planned dropset not logged yet gets a "retyped" Normal row (a set not logged yet gets a normal change)', () => {
    const { effects, rows, current } = deleteOn({ cards: [card('pushdown', 'n d1')], key: 'set:pushdown.2:stage:1' })
    expect(effects.changes).toEqual([{ change: { kind: 'retyped', weekPlanSetId: 'pushdown.2', type: { kind: 'normal' } }, id: null }])
    expect(effects.headPatch).toBeNull()
    expect(rows.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·'])
    expect(current!.key).toBe('set:pushdown.1')
  })

  it('a pre-1.1 dropset not logged yet: Normal through the same row', () => {
    const { rows } = deleteOn({ cards: [card('pushdown', 'l1')], key: 'set:pushdown.1:stage:1' })
    expect(rows.map(brief)).toEqual(['pushdown 01·'])
  })

  it('an added logged dropset: its log loses its kind and no "retyped" row is written (it has no planned set)', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset', number: 1 })
    const drop = dropLog(head, 1)
    const changes = [held(pending(head, 'dropset', 1), 'c1')]
    const { effects, server, rows } = deleteOn({
      cards: [card('bench', '', { added: 1 })],
      logs: [head, drop],
      changes,
      key: 'added:bench:1:stage:1',
    })
    expect(effects.headPatch).toEqual({ id: head.id, stageKind: null })
    expect(effects.changes).toEqual([])
    expect(effects.type).toEqual({ kind: 'normal' })
    expect(server.rows.map((r) => r.kind)).toEqual(['pending_stages']) // left as it was: a Normal log does not read it
    expect(rows.map(brief)).toEqual(['bench 01✓'])
  })

  it('an added set not logged yet has no row to write: the effect says its new type for the card\'s own state', () => {
    const view = viewOf(orderOf([card('bench', '', { added: 1 })]), [])
    const row = { ...rowKeyed(view, 'added:bench:1'), type: staged('dropset', 1) }
    const drop = { ...row, key: 'added:bench:1:stage:1', kind: 'stage' as const, type: null, headKey: row.key, stageNumber: 1 }
    const effects = deleteEffects(drop, { ...view, rows: [row, drop] })
    expect(effects).toEqual({ deleteOrder: [], stageCount: 0, renumber: [], changes: [], headPatch: null, type: { kind: 'normal' } })
  })
})

describe('the writes are accepted by the tables they go to', () => {
  it('every kind of DELETE applies cleanly to the stand-in (a refusal would throw)', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const cases: Array<{ cards: OrderExercise[]; logs: SetLog[]; changes: HeldChange[]; key: string }> = [
      { cards: [card('bench', 'n n')], logs: [headLog('bench', 1)], changes: [], key: 'set:bench.1' },
      { cards: [card('bench', 'n n')], logs: [], changes: [held(retyped('bench', 1, { kind: 'warmup' }), 'c1')], key: 'set:bench.1' },
      { cards: [card('pushdown', 'd2')], logs: [head, dropLog(head, 1)], changes: [], key: 'set:pushdown.1:stage:2' },
      { cards: [card('pushdown', 'd1')], logs: [head, dropLog(head, 1)], changes: [held(pending(head, 'dropset', 1), 'c1')], key: 'set:pushdown.1:stage:1' },
    ]
    for (const c of cases) expect(() => deleteOn(c)).not.toThrow()
  })
})

// The same deletes with the plan, logs and changes given the other way round must give the same answer.
describe('the answer does not depend on the order the session\'s lists come in', () => {
  it('logs and changes reversed give the same effects', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const logs3 = [head, dropLog(head, 1), dropLog(head, 2), headLog('bench', 1), headLog('bench', 2)]
    const changes = [held(retyped('pushdown', 1, staged('dropset', 2)), 'c1'), held(pending(head, 'dropset', 2), 'c2'), held(deleted('bench', 3), 'c3')]
    const order = orderOf([card('pushdown', 'n'), card('bench', 'n n n')])
    const run = (l: SetLog[], c: HeldChange[], key: string): DeleteEffects => {
      const view = viewOf(order, l, c)
      return deleteEffects(rowKeyed(view, key), view)
    }
    for (const key of ['set:pushdown.1:stage:2', 'set:pushdown.1', 'set:bench.1']) {
      const forward = run(logs3, changes, key)
      const backward = run([...logs3].reverse(), [...changes].reverse(), key)
      expect(backward.changes).toEqual(forward.changes)
      expect(backward.deleteOrder.map((l) => l.id)).toEqual(forward.deleteOrder.map((l) => l.id))
      expect(backward.renumber).toEqual(forward.renumber)
      expect(backward.headPatch).toEqual(forward.headPatch)
      expect(backward.type).toEqual(forward.type)
    }
  })
})
