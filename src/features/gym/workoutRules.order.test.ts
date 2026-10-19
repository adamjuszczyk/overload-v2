import { describe, expect, it } from 'vitest'
import {
  addedRowKey,
  memberLetter,
  plannedRowKey,
  resolveRows,
  sessionOrder,
  stageRowKey,
  type LoggedSet,
  type SetDraftKey,
} from './workoutRules'
import {
  addedLog,
  brief,
  card,
  deepFreeze,
  deleted,
  draftOf,
  dropLog,
  headLog,
  orderOf,
  pending,
  planId,
  retyped,
  staged,
} from './workoutRules.testutil'

// Chunk 46 (TASKS-1.2 "Workout logging rules as pure functions"): the session's order and its rows. Every
// expected value is written out by hand; `brief` reads a row's own fields (card, place, state), not the
// module's labels.

const rowsOf = (order: ReturnType<typeof orderOf>, logs: LoggedSet[] = [], changes: Parameters<typeof resolveRows>[2] = []) =>
  resolveRows(order, logs, changes)

describe('sessionOrder: the cards and the superset blocks', () => {
  it('keeps the cards in the order given when there is no block', () => {
    const order = sessionOrder([card('bench', 'n'), card('row', 'n'), card('pushdown', 'n')])
    expect(order.units.map((u) => (u.kind === 'single' ? u.exercise.key : u.id))).toEqual(['bench', 'row', 'pushdown'])
  })

  it('a block stands where its first member is, with its members in the block\'s own order', () => {
    // `lat` comes first in the list, `row` is the block's first member: the block still takes lat's place.
    const order = sessionOrder(
      [card('lat', 'n'), card('bench', 'n'), card('row', 'n')],
      [{ id: 'blk', members: ['row', 'lat'] }],
    )
    expect(order.units.map((u) => (u.kind === 'single' ? u.exercise.key : `${u.id}:${u.members.map((m) => m.key).join('+')}`))).toEqual([
      'blk:row+lat',
      'bench',
    ])
  })

  it('a block with fewer than two members it can find is not a block, and an unknown member is left out', () => {
    const order = sessionOrder(
      [card('bench', 'n'), card('row', 'n'), card('lat', 'n')],
      [
        { id: 'one', members: ['bench', 'ghost'] }, // only bench exists: a block of one
        { id: 'two', members: ['row', 'ghost', 'lat'] }, // ghost is left out, row and lat remain
      ],
    )
    expect(order.units.map((u) => (u.kind === 'single' ? u.exercise.key : `${u.id}:${u.members.map((m) => m.key).join('+')}`))).toEqual([
      'bench',
      'two:row+lat',
    ])
  })

  it('refuses two cards with one key and one card in two blocks (a caller bug)', () => {
    expect(() => sessionOrder([card('bench', 'n'), card('bench', 'n')])).toThrow(RangeError)
    expect(() =>
      sessionOrder(
        [card('a', 'n'), card('b', 'n'), card('c', 'n')],
        [
          { id: 'x', members: ['a', 'b'] },
          { id: 'y', members: ['b', 'c'] },
        ],
      ),
    ).toThrow(RangeError)
    expect(() => sessionOrder([card('a', 'n'), card('b', 'n')], [{ id: 'x', members: ['a', 'a', 'b'] }])).toThrow(RangeError)
  })

  it('names the members A to Z and then #27, and builds the keys rows are matched by', () => {
    expect(memberLetter(0)).toBe('A')
    expect(memberLetter(25)).toBe('Z')
    expect(memberLetter(26)).toBe('#27')
    expect(plannedRowKey('p1')).toBe('set:p1')
    expect(addedRowKey('bench', 'a2')).toBe('added:bench:a2')
    expect(stageRowKey('set:p1', 1)).toBe('set:p1:stage:1')
  })
})

describe('resolveRows: the order of the rows', () => {
  it('a card draws its warmups first, then each working set followed by its drops', () => {
    const order = orderOf([card('bench', 'w n n n'), card('pushdown', 'n d2')])
    expect(rowsOf(order).map(brief)).toEqual([
      'bench W1·',
      'bench 01·',
      'bench 02·',
      'bench 03·',
      'pushdown 01·',
      'pushdown 02·',
      'pushdown 02.1·',
      'pushdown 02.2·',
    ])
  })

  it('a superset zigzags through its rounds: A1 B1 A2 B2 A3 B3, each cell named by member letter and round', () => {
    const order = orderOf([card('row', 'n n n'), card('lat', 'n n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    const rows = rowsOf(order)
    expect(rows.map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'lat B2·', 'row A3·', 'lat B3·'])
    expect(rows.map((r) => r.block?.id)).toEqual(Array(6).fill('blk'))
  })

  it('three members: A1 B1 C1 A2 B2 C2', () => {
    const order = orderOf(
      [card('a', 'n n'), card('b', 'n n'), card('c', 'n n')],
      [{ id: 'blk', members: ['a', 'b', 'c'] }],
    )
    expect(rowsOf(order).map(brief)).toEqual(['a A1·', 'b B1·', 'c C1·', 'a A2·', 'b B2·', 'c C2·'])
  })

  it('unequal counts stay in the block: 4 sets of A and 3 of B make 4 rounds, round 4 holds only A', () => {
    const order = orderOf([card('row', 'n n n n'), card('lat', 'n n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    expect(rowsOf(order).map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'lat B2·', 'row A3·', 'lat B3·', 'row A4·'])
  })

  it('the drops of a superset member follow their head inside its round', () => {
    const order = orderOf([card('row', 'n d1'), card('lat', 'n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    expect(rowsOf(order).map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'row A2.1·', 'lat B2·'])
    expect(rowsOf(order).find((r) => r.kind === 'stage')?.block).toEqual({ id: 'blk', letter: 'A', round: 2 })
  })

  it('a block sits among the plain cards where it belongs, and its members\' warmups come before round 1, member by member', () => {
    const order = orderOf(
      [card('bench', 'n'), card('row', 'w n n'), card('lat', 'w w n n'), card('pushdown', 'n')],
      [{ id: 'blk', members: ['row', 'lat'] }],
    )
    expect(rowsOf(order).map(brief)).toEqual([
      'bench 01·',
      'row W1·',
      'lat W1·',
      'lat W2·',
      'row A1·',
      'lat B1·',
      'row A2·',
      'lat B2·',
      'pushdown 01·',
    ])
    // a warmup is not in any round
    expect(rowsOf(order).filter((r) => r.kind === 'warmup').every((r) => r.block === null)).toBe(true)
  })
})

// DECISIONS 170 (Adam, 2026-10-18): "A set's displayed number is its rank among the non-deleted, non-warmup working sets in
// that order (warmups numbered apart, as now)." The number a log holds is never read for it.
describe('resolveRows: what a row shows as its number (its rank, DECISIONS 170)', () => {
  it('every working set shows its rank among the working sets, logged or open, and a warmup its rank among the warmups', () => {
    // The plan numbers the warmup 1 and the working sets 2, 3, 4; the screen shows 01, 02, 03.
    const order = orderOf([card('bench', 'w n n n')])
    const logs = [headLog('bench', 1, { number: 1, warmup: true }), headLog('bench', 2, { number: 1 }), headLog('bench', 3, { number: 2 })]
    const rows = rowsOf(order, logs)
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(rows.map((r) => r.number)).toEqual([1, 1, 2, 3])
  })

  it('logs numbered in the order they were logged (1.1\'s rule) read in the plan\'s order: a row shows its rank, not the number its log holds', () => {
    // set 3 was logged first and stored as 1 (1.1's "the logged heads + 1"): it is the third set, 03, and the open ones keep theirs
    const order = orderOf([card('bench', 'n n n n')])
    const rows = rowsOf(order, [headLog('bench', 3, { number: 1 })])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·', 'bench 03✓', 'bench 04·'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'set:bench.3', 'set:bench.4'])
  })

  it('a stored number that is out of range or held twice changes nothing on screen: no two rows alike, no gap', () => {
    // two logs that both say 7, and one that says 0: the rows read 01 to 04 in the plan's order
    const order = orderOf([card('bench', 'n n n n')])
    const rows = rowsOf(order, [headLog('bench', 1, { number: 7 }), headLog('bench', 2, { number: 7 }), headLog('bench', 4, { number: 0 })])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04✓'])
  })

  it('a skipped set counts like a logged one for the numbers (it is a set that is not deleted)', () => {
    const order = orderOf([card('bench', 'n n n')])
    const rows = rowsOf(order, [headLog('bench', 1, { skipped: true })])
    expect(rows.map(brief)).toEqual(['bench 01×', 'bench 02·', 'bench 03·'])
  })

  it('only the exercise\'s own sets move its numbers', () => {
    const order = orderOf([card('bench', 'n n'), card('row', 'n n')])
    const rows = rowsOf(order, [headLog('row', 1), headLog('row', 2)])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·', 'row 01✓', 'row 02✓'])
  })

  it('a drop shows its head\'s number and the warmups are numbered among themselves', () => {
    const order = orderOf([card('pushdown', 'w w n d2')])
    const rows = rowsOf(order)
    expect(rows.map((r) => r.number)).toEqual([1, 2, 1, 2, 2, 2])
    expect(rows.map(brief)).toEqual(['pushdown W1·', 'pushdown W2·', 'pushdown 01·', 'pushdown 02·', 'pushdown 02.1·', 'pushdown 02.2·'])
  })
})

// DECISIONS 151 (Adam, 2026-10-16): "An unlogged set keeps its number and its place. Logging it again stores it with that
// same number, so unlog then log is an exact undo (SPEC 18c). No other set's number changes on unlog. The open row shows
// its own number (a planned set's position; an added set's number from its draft), never 'the next after the logged ones'."
describe('resolveRows: an open set keeps its number and its place (DECISIONS 151)', () => {
  const cards = [card('bench', 'n n n n')]
  const plan = orderOf(cards)

  it('bench 01–03 logged, 02 unlogged: it is still 02, between the logged 01 and 03, and 04 is still 04', () => {
    const rows = rowsOf(plan, [headLog('bench', 1), headLog('bench', 3)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓', 'bench 04·'])
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'set:bench.3', 'set:bench.4'])
  })

  it('the last one logged, unlogged: nothing changes for the others, and the middle one is told apart from it', () => {
    const last = rowsOf(plan, [headLog('bench', 1), headLog('bench', 2)])
    expect(last.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04·'])
    const first = rowsOf(plan, [headLog('bench', 2), headLog('bench', 3)])
    expect(first.map(brief)).toEqual(['bench 01·', 'bench 02✓', 'bench 03✓', 'bench 04·'])
  })

  it('every way of having some of five planned sets logged, each with the number of its place: every open row reads its own position', () => {
    const five = orderOf([card('bench', 'n n n n n')])
    for (let logged = 0; logged < 32; logged++) {
      const logs = [1, 2, 3, 4, 5].filter((n) => logged & (1 << (n - 1))).map((n) => headLog('bench', n))
      const rows = rowsOf(five, logs)
      expect(rows.map((r) => r.number), `logged ${logged.toString(2).padStart(5, '0')}`).toEqual([1, 2, 3, 4, 5])
      expect(rows.map((r) => r.state), `logged ${logged.toString(2).padStart(5, '0')}`).toEqual([1, 2, 3, 4, 5].map((n) => (logged & (1 << (n - 1)) ? 'logged' : 'unlogged')))
    }
  })

  it('every way that five planned sets can be logged, skipped or open, each holding the number of its place: every row reads its position', () => {
    const states = ['logged', 'skipped', 'open'] as const
    const five = orderOf([card('bench', 'n n n n n')])
    for (let combo = 0; combo < 3 ** 5; combo++) {
      const here = [0, 1, 2, 3, 4].map((i) => states[Math.floor(combo / 3 ** i) % 3])
      const logs = here.flatMap((state, i) => (state === 'open' ? [] : [headLog('bench', i + 1, { skipped: state === 'skipped' })]))
      const rows = rowsOf(five, logs)
      expect(rows.map((r) => r.number), here.join(' ')).toEqual([1, 2, 3, 4, 5])
      expect(rows.map((r) => (r.state === 'unlogged' ? 'open' : r.state)), here.join(' ')).toEqual(here)
    }
  })

  it('a skipped set in the middle holds its number and the open ones keep theirs', () => {
    const rows = rowsOf(plan, [headLog('bench', 2, { skipped: true }), headLog('bench', 4)])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02×', 'bench 03·', 'bench 04✓'])
  })

  it('a warmup in the plan and a deleted set do not move an open set\'s place', () => {
    const rows = rowsOf(orderOf([card('bench', 'w n n n n')]), [headLog('bench', 2, { number: 1 }), headLog('bench', 4, { number: 3 })], [deleted('bench', 5)])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02·', 'bench 03✓'])
  })

  it('sets logged out of order with the number of their place each keep it (the lock off)', () => {
    const rows = rowsOf(plan, [headLog('bench', 3), headLog('bench', 1)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓', 'bench 04·'])
  })

  it('the open set of a dropset keeps its place too, and its drops carry its number', () => {
    const head = headLog('pushdown', 3, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'n n d1 n')]), [headLog('pushdown', 1), head, dropLog(head, 1)])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 02·', 'pushdown 03✓', 'pushdown 03.1✓', 'pushdown 04·'])
    const open = rowsOf(orderOf([card('pushdown', 'n d1 n')]), [headLog('pushdown', 3)])
    expect(open.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·', 'pushdown 02.1·', 'pushdown 03✓'])
  })

  it('in a superset each member keeps its own places: unlog A2 and it is still A2 with the number 02', () => {
    const order = orderOf([card('row', 'n n n'), card('lat', 'n n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    const logs = [headLog('row', 1), headLog('lat', 1), headLog('lat', 2), headLog('row', 3), headLog('lat', 3)]
    const rows = rowsOf(order, logs)
    expect(rows.map(brief)).toEqual(['row A1✓', 'lat B1✓', 'row A2·', 'lat B2✓', 'row A3✓', 'lat B3✓'])
    expect(rows.find((r) => r.key === 'set:row.2')!.number).toBe(2)
  })
})

// DECISIONS 170: "added sets by when they were added". The card hands its added sets over in that order (`OrderExercise.added`),
// and that order is their place: no log, draft or number moves one. An unlogged one keeps its number and its place (151).
describe('resolveRows: the sets added in the session keep the order they were added in (DECISIONS 170, 151)', () => {
  // two planned sets (01, 02) and three added ones (03, 04, 05); the middle one was logged and unlogged again
  const planned = [headLog('bench', 1), headLog('bench', 2)]
  const added = (n: number) => addedLog('bench', n - 2, { number: n })
  const key = (position: number, localId = 'a2'): SetDraftKey => ({ sessionId: 's1', localId, exerciseId: 'ex.bench', position })
  const three = (middle: Parameters<typeof card>[2] = {}) => orderOf([card('bench', 'n n', { added: [added(3), { kind: 'normal' }, added(5)], ...middle })])

  it('the middle added set unlogged is between its neighbours at its own number, and its row names its draft', () => {
    const rows = rowsOf(three({ drafts: [key(4)] }), [...planned, added(3), added(5)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'added:bench:a1', 'added:bench:a2', 'added:bench:a3'])
    expect(rows[3]).toMatchObject({ added: true, state: 'unlogged', logId: null, localId: 'a2', draftKey: key(4) })
    expect(rows.filter((r) => r !== rows[3]).map((r) => r.draftKey)).toEqual([null, null, null, null])
    expect(rows.map((r) => r.localId)).toEqual([null, null, 'a1', 'a2', 'a3'])
  })

  it('without its draft (the phone lost it) it is the same set in the same place: the order is the card\'s, not the draft\'s', () => {
    const rows = rowsOf(three(), [...planned, added(3), added(5)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows[3]).toMatchObject({ key: 'added:bench:a2', state: 'unlogged', draftKey: null })
  })

  it('a draft\'s number is never read for the row\'s: one that says 9, or 3, or the number a logged set holds, changes nothing', () => {
    for (const position of [9, 3, 5, 1]) {
      const rows = rowsOf(three({ drafts: [key(position)] }), [...planned, added(3), added(5)])
      expect(rows.map(brief), `a draft at ${position}`).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05✓'])
      expect(rows[3].draftKey, `a draft at ${position}`).toEqual(key(position))
    }
  })

  it('a new set logged ahead of an older one (the lock off): each stays where it was added, and the logged one stores the number its row shows', () => {
    const twoNew = orderOf([card('bench', 'n n', { added: 2 })])
    const before = rowsOf(twoNew, planned)
    expect(before.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04·'])
    // the second is logged as 04: the card's entry names the log, and the rows are 03 open, 04 logged, the keys as they were
    const logged = orderOf([card('bench', 'n n', { added: [{ kind: 'normal' }, addedLog('bench', 2, { number: before[3].number })] })])
    const rows = rowsOf(logged, [...planned, addedLog('bench', 2, { number: 4 })])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04✓'])
    expect(rows.map((r) => r.key)).toEqual(before.map((r) => r.key))
    expect(rows[3].logId).toBe('log.bench.added2')
  })

  it('logs that hold their numbers the other way round are still drawn in the card\'s order, each at its rank', () => {
    // the card added a1 then a2; the logs say 5 and 4: a1 is 03 and a2 04 all the same
    const order = orderOf([card('bench', 'n n', { added: [addedLog('bench', 1, { number: 5 }), addedLog('bench', 2, { number: 4 })] })])
    const rows = rowsOf(order, [...planned, addedLog('bench', 2, { number: 4 }), addedLog('bench', 1, { number: 5 })])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
    expect(rows.slice(2).map((r) => [r.key, r.logId])).toEqual([
      ['added:bench:a1', 'log.bench.added1'],
      ['added:bench:a2', 'log.bench.added2'],
    ])
  })

  it('the order the list comes in is the order of the sets; the order of the logs and the drafts is not', () => {
    const logs = [...planned, added(3), added(5)]
    const drafts = [key(4), { sessionId: 's1', localId: 'row.x', exerciseId: 'ex.row', position: 1 }]
    const rows = rowsOf(three({ drafts }), logs)
    const turned = rowsOf(three({ drafts: [...drafts].reverse() }), [...logs].reverse())
    expect(turned).toEqual(rows)
    // and the list the other way round is the sets the other way round
    const reversed = orderOf([card('bench', 'n n', { added: [{ localId: 'a3', logId: added(5).id, type: { kind: 'normal' } }, { localId: 'a2', logId: null, type: { kind: 'normal' } }, { localId: 'a1', logId: added(3).id, type: { kind: 'normal' } }] })])
    expect(rowsOf(reversed, logs).slice(2).map((r) => [r.key, r.number])).toEqual([
      ['added:bench:a3', 3],
      ['added:bench:a2', 4],
      ['added:bench:a1', 5],
    ])
  })

  it('a draft that is not an added set\'s of this card is not read: another exercise\'s, a planned set\'s and a drop\'s', () => {
    const others: SetDraftKey[] = [
      { sessionId: 's1', localId: 'a2', exerciseId: 'ex.row', position: 4 },
      { sessionId: 's1', weekPlanSetId: 'bench.2' },
      { sessionId: 's1', localId: 'a2', exerciseId: 'ex.bench', position: 4, drop: 1 },
      { sessionId: 's1', weekPlanSetId: 'bench.1', drop: 2 },
    ]
    const withOthers = rowsOf(three({ drafts: others }), [...planned, added(3), added(5)])
    const without = rowsOf(three(), [...planned, added(3), added(5)])
    expect(withOthers).toEqual(without)
    expect(withOthers.map((r) => r.draftKey)).toEqual([null, null, null, null, null])
  })

  it('an open planned set and an open added one: each at its rank, the planned set first', () => {
    const rows = rowsOf(three({ drafts: [key(4)] }), [headLog('bench', 1), added(3), added(5)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows.filter((r) => r.state === 'unlogged').map((r) => [r.key, r.added, r.draftKey?.localId ?? null])).toEqual([
      ['set:bench.2', false, null],
      ['added:bench:a2', true, 'a2'],
    ])
  })

  it('an entry whose log is not among the logs (the logs and the card lag one another for a render) is an open set with its type', () => {
    const order = orderOf([card('bench', 'n n', { added: [{ localId: 'a1', logId: 'log.not.yet', type: { kind: 'warmup' } }, { kind: 'normal' }] })])
    const rows = rowsOf(order, planned)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03·'])
    expect(rows[0]).toMatchObject({ key: 'added:bench:a1', state: 'unlogged', logId: null })
  })
})

describe('resolveRows: added sets the card does not list (a reload, a reopened session)', () => {
  const planned = [headLog('bench', 1), headLog('bench', 2)]

  it('a log of an added set that no entry names comes after the listed sets, keyed by its log; several in the order of their numbers', () => {
    const order = orderOf([card('bench', 'n n', { added: 1 })])
    const rows = rowsOf(order, [...planned, addedLog('bench', 3, { number: 6 }), addedLog('bench', 2, { number: 4 })])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04✓', 'bench 05✓'])
    expect(rows.slice(2).map((r) => [r.key, r.localId, r.logId])).toEqual([
      ['added:bench:a1', 'a1', null],
      ['added:bench:log.bench.added2', 'log.bench.added2', 'log.bench.added2'],
      ['added:bench:log.bench.added3', 'log.bench.added3', 'log.bench.added3'],
    ])
  })

  it('a card with no list at all draws every added log after its planned sets (a session reopened after it was finished)', () => {
    const rows = rowsOf(orderOf([card('bench', 'n n')]), [...planned, addedLog('bench', 1, { number: 3 }), addedLog('bench', 2, { number: 4, warmup: true })])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
  })

  it('a draft that no listed set has is a set of its own with its draft\'s type, between the unlisted logs by its number', () => {
    const drafts = [draftOf({ sessionId: 's1', localId: 'gone.1', exerciseId: 'ex.bench', position: 4 }, { kind: 'warmup' }), draftOf({ sessionId: 's1', localId: 'gone.2', exerciseId: 'ex.bench', position: 4 }, { kind: 'normal' })]
    const rows = rowsOf(orderOf([card('bench', 'n n', { drafts })]), [...planned, addedLog('bench', 1, { number: 3 }), addedLog('bench', 3, { number: 5 })])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05✓'])
    expect(rows.map((r) => r.localId)).toEqual(['gone.1', null, null, 'log.bench.added1', 'gone.2', 'log.bench.added3'])
    expect(rows[4].draftKey).toEqual(drafts[1].key)
  })

  it('a log whose id is a listed set\'s own id is that set\'s: it is not drawn twice while an unlog has not reached the logs', () => {
    const log = addedLog('bench', 1, { number: 3 })
    const order = orderOf([card('bench', 'n n', { added: [{ localId: log.id, logId: null, type: { kind: 'normal' } }] })])
    const rows = rowsOf(order, [...planned, log])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
  })

  it('a draft whose set\'s log is still among the logs is not drawn twice either', () => {
    const log = addedLog('bench', 1, { number: 3 })
    const drafts = [draftOf({ sessionId: 's1', localId: log.id, exerciseId: 'ex.bench', position: 3 }, { kind: 'normal' })]
    expect(rowsOf(orderOf([card('bench', 'n n', { drafts })]), [...planned, log]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓'])
  })
})

describe('resolveRows: what the card\'s list may not say (a caller bug, refused)', () => {
  const planned = [headLog('bench', 1)]

  it('one set listed twice, two sets naming one log, a log that is not a set added to this card, two drafts of one set', () => {
    const twice = card('bench', 'n', { added: [{ localId: 'a1', logId: null, type: { kind: 'normal' } }, { localId: 'a1', logId: null, type: { kind: 'normal' } }] })
    expect(() => rowsOf(orderOf([twice]), planned)).toThrow(RangeError)
    const oneLog = card('bench', 'n', { added: [{ localId: 'a1', logId: 'log.bench.added1', type: { kind: 'normal' } }, { localId: 'a2', logId: 'log.bench.added1', type: { kind: 'normal' } }] })
    expect(() => rowsOf(orderOf([oneLog]), [...planned, addedLog('bench', 1, { number: 2 })])).toThrow(RangeError)
    const plannedLog = card('bench', 'n', { added: [{ localId: 'a1', logId: 'log.bench.1', type: { kind: 'normal' } }] })
    expect(() => rowsOf(orderOf([plannedLog]), planned)).toThrow(RangeError)
    const otherCard = card('bench', 'n', { added: [{ localId: 'a1', logId: 'log.row.added1', type: { kind: 'normal' } }] })
    expect(() => rowsOf(orderOf([otherCard, card('row', 'n')]), [...planned, addedLog('row', 1)])).toThrow(RangeError)
    const draft = { sessionId: 's1', localId: 'a1', exerciseId: 'ex.bench', position: 2 }
    expect(() => rowsOf(orderOf([card('bench', 'n', { added: 1, drafts: [draft, { ...draft, position: 3 }] })]), planned)).toThrow(RangeError)
  })

  it('the control: the same lists, each set once and each log once, are drawn', () => {
    const ok = card('bench', 'n', { added: [{ localId: 'a1', logId: 'log.bench.added1', type: { kind: 'normal' } }, { localId: 'a2', logId: null, type: { kind: 'normal' } }] })
    expect(rowsOf(orderOf([ok]), [...planned, addedLog('bench', 1, { number: 2 })]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
  })
})

describe('resolveRows: logged, skipped and unlogged', () => {
  it('a head is logged by its planned set\'s id, whatever order the logs come in, and a skipped log is settled', () => {
    const order = orderOf([card('bench', 'n n n')])
    const rows = rowsOf(order, [headLog('bench', 3), headLog('bench', 1, { skipped: true })])
    expect(rows.map((r) => r.state)).toEqual(['skipped', 'unlogged', 'logged'])
    expect(rows.map((r) => r.logId)).toEqual(['log.bench.1', null, 'log.bench.3'])
  })

  it('two logs of one planned set: the first is the set\'s log, as the card\'s own lookup finds it, and the second is no set (it moves no number)', () => {
    const first = headLog('bench', 1, { number: 1 })
    const second = { ...headLog('bench', 1, { number: 2 }), id: 'log.bench.1.again' }
    const rows = rowsOf(orderOf([card('bench', 'n n')]), [first, second])
    expect(rows[0].logId).toBe('log.bench.1')
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02·'])
  })

  it('the n-th logged drop is drop n, whatever stage indexes the logs carry and whatever order they come in', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const order = orderOf([card('pushdown', 'd2')])
    const rows = rowsOf(order, [dropLog(head, 9), head, dropLog(head, 5)])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2✓'])
    expect(rows.slice(1).map((r) => r.logId)).toEqual([`${head.id}.d5`, `${head.id}.d9`])
  })

  it('a head with one of two planned drops logged has the second still to do', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'd2')]), [head, dropLog(head, 1)])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓', 'pushdown 01.2·'])
  })

  it('a skipped head\'s drops are dead: nothing is left to log under it', () => {
    const head = headLog('pushdown', 1, { skipped: true, stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'd2')]), [head])
    expect(rows.map(brief)).toEqual(['pushdown 01×'])
  })

  it('a skipped head with skipped drops keeps those rows (board W3b: a skipped set and its drop)', () => {
    const head = headLog('pushdown', 1, { skipped: true, stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'd2')]), [head, dropLog(head, 1, { skipped: true }), dropLog(head, 2, { skipped: true })])
    expect(rows.map(brief)).toEqual(['pushdown 01×', 'pushdown 01.1×', 'pushdown 01.2×'])
  })

  it('identifies a drop by the head and its place: keys, head key and stage number', () => {
    const rows = rowsOf(orderOf([card('pushdown', 'd1')]))
    expect(rows.map((r) => r.key)).toEqual([plannedRowKey(planId('pushdown', 1)), stageRowKey(plannedRowKey(planId('pushdown', 1)), 1)])
    expect(rows[1]).toMatchObject({ kind: 'stage', headKey: 'set:pushdown.1', stageNumber: 1, weekPlanSetId: null, type: null, plannedType: null, retyped: false })
  })
})

describe('resolveRows: a warmup is never staged', () => {
  it('stage rows left under a warmup head are not rows, and the warmup is a warmup', () => {
    const bench = card('bench', 'w n')
    const stray = { ...bench.plannedSets[0], id: 'bench.1.1', parentWeekPlanSetId: 'bench.1', stageIndex: 1, isWarmup: false }
    const rows = resolveRows(sessionOrder([{ ...bench, plannedSets: [...bench.plannedSets, stray] }]), [], [])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01·'])
    expect(rows[0].type).toEqual({ kind: 'warmup' })
  })
})

describe('resolveRows: sets the session deleted (kind "deleted")', () => {
  it('a deleted planned set is not in the order, nor are its drops, and the rows after it renumber', () => {
    const order = orderOf([card('pushdown', 'n d2 n')])
    const rows = rowsOf(order, [], [deleted('pushdown', 2)])
    expect(rows.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·'])
    expect(rows.map((r) => r.key)).toEqual(['set:pushdown.1', 'set:pushdown.3'])
  })

  it('a deleted warmup is gone too', () => {
    const rows = rowsOf(orderOf([card('bench', 'w w n')]), [], [deleted('bench', 1)])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01·'])
    expect(rows[0].key).toBe('set:bench.2')
  })

  it('a superset forms its rounds again from the sets that are left: delete A2 and A3 becomes round 2, before B2', () => {
    const order = orderOf([card('row', 'n n n'), card('lat', 'n n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    const rows = rowsOf(order, [], [deleted('row', 2)])
    expect(rows.map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'lat B2·', 'lat B3·'])
    // the row now in round 2 is the plan's third set
    expect(rows[2].key).toBe('set:row.3')
  })

  it('a change for another set of the plan leaves this one alone', () => {
    const rows = rowsOf(orderOf([card('bench', 'n n')]), [], [deleted('row', 1)])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·'])
  })
})

describe('resolveRows: sets the session retyped (kind "retyped")', () => {
  it('a plain set made a dropset with two drops has two drop rows after it', () => {
    const rows = rowsOf(orderOf([card('pushdown', 'n n')]), [], [retyped('pushdown', 1, staged('dropset', 2))])
    expect(rows.map(brief)).toEqual(['pushdown 01·', 'pushdown 01.1·', 'pushdown 01.2·', 'pushdown 02·'])
    expect(rows[0]).toMatchObject({ type: staged('dropset', 2), plannedType: { kind: 'normal' }, retyped: true, stageKind: 'dropset' })
    expect(rows[1].stageKind).toBe('dropset')
  })

  it('a planned dropset made Normal has no drops, and made another kind has the change\'s count in place of the plan\'s', () => {
    const toNormal = rowsOf(orderOf([card('pushdown', 'n d2')]), [], [retyped('pushdown', 2, { kind: 'normal' })])
    expect(toNormal.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·'])

    const toRestPause = rowsOf(orderOf([card('pushdown', 'n d2')]), [], [retyped('pushdown', 2, staged('rest_pause', 1))])
    expect(toRestPause.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·', 'pushdown 02.1·'])
    expect(toRestPause[2].stageKind).toBe('rest_pause')
    expect(toRestPause[1].plannedType).toEqual(staged('dropset', 2))
  })

  it('a working set made a warmup leaves the working sets: it is a warmup row and the others renumber', () => {
    const rows = rowsOf(orderOf([card('bench', 'n n n')]), [], [retyped('bench', 2, { kind: 'warmup' })])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01·', 'bench 02·'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.2', 'set:bench.1', 'set:bench.3'])
    expect(rows[0].kind).toBe('warmup')
  })

  it('a warmup made Normal joins the working sets at its place in the plan', () => {
    const rows = rowsOf(orderOf([card('bench', 'w n')]), [], [retyped('bench', 1, { kind: 'normal' })])
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·'])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2'])
  })

  it('in a superset a set made a warmup leaves the rounds, which are formed again', () => {
    const order = orderOf([card('row', 'n n n'), card('lat', 'n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    const rows = rowsOf(order, [], [retyped('row', 2, { kind: 'warmup' })])
    expect(rows.map(brief)).toEqual(['row W1·', 'row A1·', 'lat B1·', 'row A2·', 'lat B2·'])
  })
})

describe('resolveRows: drops still to log under a logged head (kind "pending_stages")', () => {
  it('a logged plain set given a drop has that drop after it', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('bench', 'n n')]), [head], [pending(head, 'dropset', 1)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 01.1·', 'bench 02·'])
    expect(rows[0].type).toEqual(staged('dropset', 1))
  })

  it('the change\'s count is the head\'s total: three drops with one logged leave two to do', () => {
    const head = headLog('bench', 1, { stageKind: 'rest_pause' })
    const rows = rowsOf(orderOf([card('bench', 'n')]), [head, dropLog(head, 1)], [pending(head, 'rest_pause', 3)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 01.1✓', 'bench 01.2·', 'bench 01.3·'])
  })

  it('a change that is stale — the log was made Normal or Warmup since, or is of another kind — is not read', () => {
    const normal = headLog('bench', 1)
    expect(rowsOf(orderOf([card('bench', 'n')]), [normal], [pending(normal, 'dropset', 2)]).map(brief)).toEqual(['bench 01✓'])
    const warmup = headLog('bench', 1, { warmup: true })
    expect(rowsOf(orderOf([card('bench', 'n')]), [warmup], [pending(warmup, 'dropset', 2)]).map(brief)).toEqual(['bench W1✓'])
    const dropset = headLog('bench', 1, { stageKind: 'dropset' })
    const other = rowsOf(orderOf([card('bench', 'n')]), [dropset], [pending(dropset, 'rest_pause', 2)])
    expect(other.map(brief)).toEqual(['bench 01✓'])
    // a dropset kind with no drop anywhere is still a plain set, not a staged one with no drops
    expect(other[0].type).toEqual({ kind: 'normal' })
  })

  it('a change keyed by another log changes nothing here', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const other = headLog('bench', 2, { stageKind: 'dropset' })
    expect(rowsOf(orderOf([card('bench', 'n n')]), [head], [pending(other, 'dropset', 2)]).map(brief)).toEqual(['bench 01✓', 'bench 02·'])
  })
})

describe('resolveRows: a logged set takes its type from its log', () => {
  it('a planned dropset logged as a dropset keeps the plan\'s drops; made Normal since, it has none although the plan holds them', () => {
    const asPlanned = headLog('pushdown', 1, { stageKind: 'dropset' })
    expect(rowsOf(orderOf([card('pushdown', 'd2')]), [asPlanned]).map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·'])

    const toNormal = headLog('pushdown', 1) // stage_kind null: the log says Normal
    const rows = rowsOf(orderOf([card('pushdown', 'd2')]), [toNormal])
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
    expect(rows[0]).toMatchObject({ type: { kind: 'normal' }, plannedType: staged('dropset', 2) })
  })

  it('a pre-1.1 dropset — no stage kind on the head, a drop planned — is still a dropset when it is logged as planned', () => {
    const head = headLog('pushdown', 1) // legacy logs carry no stage kind either
    const rows = rowsOf(orderOf([card('pushdown', 'l1')]), [head])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·'])
    expect(rows[0]).toMatchObject({ type: staged('dropset', 1), plannedType: staged('dropset', 1) })
    expect(rows[1].stageKind).toBe('dropset')
  })

  it('a head with logged drops and none planned (the seed\'s lateral raise made a dropset in the session) reads as a dropset with them', () => {
    const head = headLog('lat', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('lat', 'n n')]), [head, dropLog(head, 1)])
    expect(rows.map(brief)).toEqual(['lat 01✓', 'lat 01.1✓', 'lat 02·'])
    expect(rows[0]).toMatchObject({ type: staged('dropset', 1), plannedType: { kind: 'normal' } })
  })

  it('drops logged under a head whose log has no stage kind read as a dropset\'s too (data from before stage kinds)', () => {
    const head = headLog('lat', 1)
    const rows = rowsOf(orderOf([card('lat', 'n')]), [head, dropLog(head, 1)])
    expect(rows.map(brief)).toEqual(['lat 01✓', 'lat 01.1✓'])
    expect(rows[0].type).toEqual(staged('dropset', 1))
  })

  it('a set retyped before it was logged keeps the change\'s drop count once logged', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'n')]), [head], [retyped('pushdown', 1, staged('dropset', 2))])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·'])
  })

  it('a planned working set whose log says warmup is a warmup row, and the working sets after it do not shift', () => {
    const rows = rowsOf(orderOf([card('bench', 'n n')]), [headLog('bench', 1, { warmup: true, number: 1 })])
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01·'])
    expect(rows[0].kind).toBe('warmup')
  })
})

describe('resolveRows: the place of a set in the plan (what places a set among the working numbers)', () => {
  it('counts the exercise\'s sets in the plan\'s order, warmups and drops included in their head\'s place; added sets come after', () => {
    const rows = rowsOf(orderOf([card('bench', 'w n d1 n', { added: 2 }), card('row', 'n')]))
    expect(rows.map((r) => [r.key, r.planIndex])).toEqual([
      ['set:bench.1', 1],
      ['set:bench.2', 2],
      ['set:bench.3', 3],
      ['set:bench.3:stage:1', 3],
      ['set:bench.4', 4],
      ['added:bench:a1', 5],
      ['added:bench:a2', 6],
      ['set:row.1', 1],
    ])
  })

  it('a set switched to or from Warmup keeps its place in the plan (the rows move, its place does not)', () => {
    const plain = rowsOf(orderOf([card('bench', 'w n n')]))
    const switched = rowsOf(orderOf([card('bench', 'w n n')]), [], [retyped('bench', 1, { kind: 'normal' }), retyped('bench', 3, { kind: 'warmup' })])
    const place = (rows: typeof plain) => Object.fromEntries(rows.map((r) => [r.key, r.planIndex]))
    expect(place(switched)).toEqual(place(plain))
    expect(switched.map((r) => r.key)).toEqual(['set:bench.3', 'set:bench.1', 'set:bench.2'])
  })

  it('increases along the plan whatever order the plan comes in', () => {
    const exercise = card('bench', 'n n n n')
    const rows = resolveRows(sessionOrder([{ ...exercise, plannedSets: [...exercise.plannedSets].reverse() }]), [], [])
    expect(rows.map((r) => r.planIndex)).toEqual([1, 2, 3, 4])
  })
})

describe('resolveRows: a log with no stage kind (a pre-1.1 dropset, or a set made Normal)', () => {
  it('a "retyped" Normal row settles a pre-1.1 dropset the way the log alone cannot: it is plain now (141 (b), 147 (a))', () => {
    const head = headLog('pushdown', 1)
    const rows = rowsOf(orderOf([card('pushdown', 'l1')]), [head], [retyped('pushdown', 1, { kind: 'normal' })])
    expect(rows.map(brief)).toEqual(['pushdown 01✓'])
    expect(rows[0]).toMatchObject({ type: { kind: 'normal' }, plannedType: staged('dropset', 1), retyped: true })
    // with no row it is still the dropset it was logged as
    expect(rowsOf(orderOf([card('pushdown', 'l1')]), [head]).map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·'])
  })

  it('…but a drop that is logged is never hidden: the drops are still there', () => {
    const head = headLog('pushdown', 1)
    const rows = rowsOf(orderOf([card('pushdown', 'l1')]), [head, dropLog(head, 1)], [retyped('pushdown', 1, { kind: 'normal' })])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
  })

  it('…and it settles nothing for a log that carries a stage kind: the log is the kind, a Normal row is not read', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'd2')]), [head], [retyped('pushdown', 1, { kind: 'normal' })])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·'])
  })

  it('the plan\'s drops are not taken for a log of another kind: a planned dropset logged as rest-pause, with no row for its drops, reads plain', () => {
    const head = headLog('pushdown', 1, { stageKind: 'rest_pause' })
    expect(rowsOf(orderOf([card('pushdown', 'd2')]), [head]).map(brief)).toEqual(['pushdown 01✓'])
  })

  it('a "retyped" row that says a staged type does not make a kindless log staged on its own', () => {
    const head = headLog('pushdown', 1)
    expect(rowsOf(orderOf([card('pushdown', 'n')]), [head], [retyped('pushdown', 1, staged('dropset', 2))]).map(brief)).toEqual(['pushdown 01✓'])
  })

  it('a pre-1.1 dropset\'s drop count is the "pending_stages" row\'s when there is one, else the "retyped" row\'s, else the plan\'s', () => {
    const head = headLog('pushdown', 1)
    const cards = [card('pushdown', 'l2')]
    expect(rowsOf(orderOf(cards), [head]).map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·'])
    expect(rowsOf(orderOf(cards), [head], [retyped('pushdown', 1, staged('dropset', 1))]).map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·'])
    const both = [retyped('pushdown', 1, staged('dropset', 1)), pending(head, 'dropset', 3)]
    expect(rowsOf(orderOf(cards), [head], both).map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·', 'pushdown 01.3·'])
  })

  it('a pre-1.1 dropset with one of its two drops logged and the count lowered to one reads one drop, logged', () => {
    const head = headLog('pushdown', 1)
    const rows = rowsOf(orderOf([card('pushdown', 'l2')]), [head, dropLog(head, 1)], [pending(head, 'dropset', 1)])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1✓'])
  })

  it('a stale "pending_stages" row under a plain log does not make it a dropset', () => {
    const head = headLog('bench', 1)
    expect(rowsOf(orderOf([card('bench', 'n')]), [head], [pending(head, 'dropset', 2)]).map(brief)).toEqual(['bench 01✓'])
  })
})

describe('resolveRows: a "retyped" row takes a drop count only from a change that names the log\'s own stage kind (X5)', () => {
  it('a logged rest-pause head whose "retyped" row says a dropset of three, with no "pending_stages" row: no drops from that row', () => {
    const head = headLog('bench', 1, { stageKind: 'rest_pause' })
    const rows = rowsOf(orderOf([card('bench', 'n')]), [head], [retyped('bench', 1, staged('dropset', 3))])
    expect(rows.map(brief)).toEqual(['bench 01✓'])
    expect(rows[0].type).toEqual({ kind: 'normal' })
  })

  it('the control: a "retyped" row of the same kind gives its count', () => {
    const head = headLog('bench', 1, { stageKind: 'rest_pause' })
    const rows = rowsOf(orderOf([card('bench', 'n')]), [head], [retyped('bench', 1, staged('rest_pause', 3))])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 01.1·', 'bench 01.2·', 'bench 01.3·'])
    expect(rows[0].type).toEqual(staged('rest_pause', 3))
  })

  it('a mismatched row does not hide the plan\'s own drops either: the plan\'s count of the log\'s kind still stands', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('pushdown', 'd2')]), [head], [retyped('pushdown', 1, staged('rest_pause', 5))])
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·'])
  })
})

describe('resolveRows: which change speaks last, and what order the plan comes in', () => {
  it('a change on the log, made after the set was logged, wins over the one made on the plan before', () => {
    // retyped to a dropset with two drops before it was logged; after it was logged, made a dropset with three
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const rows = resolveRows(
      orderOf([card('pushdown', 'n')]),
      [head],
      [retyped('pushdown', 1, staged('dropset', 2)), pending(head, 'dropset', 3)],
    )
    expect(rows.map(brief)).toEqual(['pushdown 01✓', 'pushdown 01.1·', 'pushdown 01.2·', 'pushdown 01.3·'])
  })

  it('a plan that comes in any order is read in the order of its set numbers, a head\'s drops by their stage index', () => {
    const exercise = card('pushdown', 'n d2 n')
    const shuffled = { ...exercise, plannedSets: [...exercise.plannedSets].reverse() }
    const rows = resolveRows(sessionOrder([shuffled]), [], [])
    // the numbers are dynamic (they follow the order logged, not the plan's), so which set is which is read off the keys
    expect(rows.map((r) => r.key)).toEqual([
      'set:pushdown.1',
      'set:pushdown.2',
      'set:pushdown.2:stage:1',
      'set:pushdown.2:stage:2',
      'set:pushdown.3',
    ])
    expect(rows.map(brief)).toEqual(['pushdown 01·', 'pushdown 02·', 'pushdown 02.1·', 'pushdown 02.2·', 'pushdown 03·'])
  })

  it('a plain set has no stage kind and a staged one has its kind, on the head and on each drop', () => {
    const rows = resolveRows(orderOf([card('pushdown', 'n m2')]), [], [])
    expect(rows.map((r) => r.stageKind)).toEqual([null, 'myo_reps', 'myo_reps', 'myo_reps'])
  })
})

describe('resolveRows: sets added in the session', () => {
  it('come after the planned sets, whether or not they are logged', () => {
    const rows = rowsOf(orderOf([card('bench', 'n n', { added: 2 })]))
    expect(rows.map(brief)).toEqual(['bench 01·', 'bench 02·', 'bench 03·', 'bench 04·'])
    expect(rows.map((r) => r.added)).toEqual([false, false, true, true])
    expect(rows.map((r) => r.key)).toEqual(['set:bench.1', 'set:bench.2', 'added:bench:a1', 'added:bench:a2'])
    expect(rows[2].weekPlanSetId).toBeNull()
    expect(rows.map((r) => r.retyped)).toEqual([false, false, false, false])
  })

  it('each listed set is drawn with the log its entry names, whatever order the logs come in', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), addedLog('bench', 2, { number: 4 }), addedLog('bench', 1, { number: 3 })]
    const rows = rowsOf(orderOf([card('bench', 'n n', { added: [logs[3], logs[2], { kind: 'normal' }] })]), logs)
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 05·'])
    expect(rows[2].logId).toBe('log.bench.added1')
    expect(rows[3].logId).toBe('log.bench.added2')
  })

  it('an added log of a warmup is a warmup row in its place (146: any set can be switched to Warmup), numbered among the warmups', () => {
    const logs = [headLog('bench', 1), addedLog('bench', 1, { number: 2 }), addedLog('bench', 2, { number: 3 }), addedLog('bench', 3, { warmup: true, number: 4 })]
    const rows = rowsOf(orderOf([card('bench', 'n', { added: [logs[1], logs[3], logs[2]] })]), logs)
    expect(rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
    expect(rows.map((r) => r.added)).toEqual([true, false, true, true])
    // the warmup is the card's second added set: it sits between the other two in the card's order (`planIndex`), drawn with the warmups
    expect(rows[0]).toMatchObject({ kind: 'warmup', key: 'added:bench:a2', type: { kind: 'warmup' }, planIndex: 3 })
    expect(rows.slice(2).map((r) => [r.key, r.planIndex])).toEqual([
      ['added:bench:a1', 2],
      ['added:bench:a3', 4],
    ])
  })

  it('a set added to one exercise is not a row of another', () => {
    const log = addedLog('row', 1, { number: 2 })
    const rows = rowsOf(orderOf([card('bench', 'n'), card('row', 'n', { added: [log] })]), [log])
    // row's planned set is open and keeps its place, 01, before the added set, 02; bench is not moved by it
    expect(rows.map(brief)).toEqual(['bench 01·', 'row 01·', 'row 02✓'])
    expect(rows.filter((r) => r.added).map((r) => r.exerciseKey)).toEqual(['row'])
  })

  it('an added set made a dropset in the session has its drop', () => {
    const head = addedLog('bench', 1, { stageKind: 'dropset' })
    const rows = rowsOf(orderOf([card('bench', '', { added: [head] })]), [head], [pending(head, 'dropset', 1)])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 01.1·'])
  })

  it('in a superset an added set takes the next round that member has, or opens a trailing one', () => {
    const order = orderOf([card('row', 'n n', { added: 1 }), card('lat', 'n n')], [{ id: 'blk', members: ['row', 'lat'] }])
    expect(rowsOf(order).map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'lat B2·', 'row A3·'])
  })
})

describe('a pure function changes nothing it is given', () => {
  it('reads frozen inputs and answers the same twice, leaving the logs, the plan and the card\'s list in the order they came', () => {
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const draft: SetDraftKey = { sessionId: 's1', localId: 'a2', exerciseId: 'ex.pushdown', position: 4 }
    const exercises = deepFreeze([
      card('pushdown', 'n d2', { added: [{ kind: 'normal' }, { kind: 'warmup' }], drafts: [draft, { ...draft, localId: 'gone', position: 3 }] }),
      card('row', 'n n'),
      card('lat', 'n n'),
    ])
    const supersets = deepFreeze([{ id: 'blk', members: ['row', 'lat'] }])
    const logs = deepFreeze([dropLog(head, 2), head, headLog('row', 1)])
    const changes = deepFreeze([deleted('row', 2), pending(head, 'dropset', 3)])
    const order = sessionOrder(exercises, supersets)
    const first = resolveRows(order, logs, changes)
    const second = resolveRows(order, logs, changes)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(5)
    expect(logs.map((l) => l.id)).toEqual([`${head.id}.d2`, head.id, 'log.row.1'])
    expect(exercises[0].plannedSets.map((s) => s.id)).toEqual(['pushdown.1', 'pushdown.2', 'pushdown.2.1', 'pushdown.2.2'])
    expect(exercises[0].added!.map((a) => a.localId)).toEqual(['a1', 'a2'])
    expect(exercises[0].drafts!.map((d) => ('position' in d.key ? d.key.position : null))).toEqual([4, 3])
    // the listed sets in the card's order, then the draft no listed set has
    expect(first.filter((r) => r.added).map((r) => [r.localId, r.kind])).toEqual([
      ['a2', 'warmup'],
      ['a1', 'working'],
      ['gone', 'working'],
    ])
  })
})
