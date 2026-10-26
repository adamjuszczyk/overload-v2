import { describe, it, expect } from 'vitest'
import {
  addedLog,
  brief,
  card,
  draftOf,
  dropLog,
  exerciseIdOf,
  headLog,
  orderOf,
  planId,
  staged,
} from './workoutRules.testutil'
import { numberCorrections, resolveRows, type OrderExercise } from './workoutRules'
import type { SetLog } from '../../types'
import { canMove, optionsEyebrow, planSkipRest, planSwap, setName, skipDescription, skipLabel, swapNote } from './exerciseOptions'

// Chunk 59 — the exercise ⋯'s planner (TASKS-1.2 59; DECISIONS 163, 164, 179, 183, 194, 199, 200; boards W10, W11). The cards are real
// `OrderExercise`s and the rows come from the session's own rules (`resolveRows`), as the screen builds them; each test reads what the
// planner decides through those rules again (the swap's moved sets as the new card draws them, the card they left, a reload), the way
// the screen will (RULES: "A write path's output is proven through the reader that draws it").

const rowsOf = (cards: OrderExercise[], logs: SetLog[] = []) => resolveRows(orderOf(cards), logs)
const ids = (() => {
  let n = 0
  return () => `moved-${++n}`
})()

describe('planSkipRest: every open set of the card, in the order it is drawn (DECISIONS 163 (a))', () => {
  it('the open planned sets with their drops: the board W10 case, set 03 and its drop (SKIP 2 SETS), with 01 and 02 logged', () => {
    const lat = card('lat', 'n n d1')
    const rows = rowsOf([lat], [headLog('lat', 1), headLog('lat', 2)])
    const plan = planSkipRest(rows, 'lat')
    expect(plan.items.map((item) => [brief(item.head), item.skipHead, item.drops.map(brief)])).toEqual([['lat 03·', true, ['lat 03.1·']]])
    expect(plan.count).toBe(2)
    expect(skipDescription(plan)).toBe('Set 03 and its drop will be marked skipped.')
    expect(skipLabel(plan.count)).toBe('SKIP 2 SETS')
  })

  it('also its unlogged warmups and its open added sets, in the order the card draws them: warmups first, then the plan, then the added sets', () => {
    const lat = card('lat', 'w n n', { added: 2 })
    const rows = rowsOf([lat], [headLog('lat', 3, { number: 2 })])
    const plan = planSkipRest(rows, 'lat')
    expect(plan.items.map((item) => brief(item.head))).toEqual(['lat W1·', 'lat 01·', 'lat 03·', 'lat 04·'])
    expect(plan.items.map((item) => item.head.added)).toEqual([false, false, true, true])
    expect(plan.count).toBe(4)
  })

  it('a head that is logged keeps its place and its open drops are skipped; a skipped head has no drops to skip (they are dead)', () => {
    const lat = card('lat', 'd2 d1')
    const first = headLog('lat', 1, { stageKind: 'dropset' }) // a head logged as the dropset it was planned as keeps its drops to do
    const second = headLog('lat', 2, { skipped: true, stageKind: 'dropset' })
    const rows = rowsOf([lat], [first, second])
    const plan = planSkipRest(rows, 'lat')
    expect(plan.items.map((item) => [brief(item.head), item.skipHead, item.drops.length])).toEqual([['lat 01✓', false, 2]])
    expect(plan.count).toBe(2)
    expect(skipDescription(plan)).toBe('The drops of set 01 will be marked skipped.')
    expect(skipLabel(1)).toBe('SKIP 1 SET')
  })

  it('nothing is left to skip when every set is logged or skipped, a logged drop included (the ⋯ then omits the row)', () => {
    const lat = card('lat', 'd1')
    const head = headLog('lat', 1, { stageKind: 'dropset' })
    expect(planSkipRest(rowsOf([lat], [head, dropLog(head, 1)]), 'lat')).toEqual({ items: [], count: 0 })
    expect(planSkipRest(rowsOf([lat], []), 'nowhere')).toEqual({ items: [], count: 0 })
  })

  it('reads only the card it is asked for: another card of the session (a superset member, another exercise) is never in its plan', () => {
    const rows = rowsOf([card('lat', 'n n'), card('row', 'n n n')])
    expect(planSkipRest(rows, 'row').items.map((item) => brief(item.head))).toEqual(['row 01·', 'row 02·', 'row 03·'])
    expect(planSkipRest(rows, 'lat').items.map((item) => brief(item.head))).toEqual(['lat 01·', 'lat 02·'])
  })
})

describe('the sheet\'s words (boards W10 and W11; the cases no board draws are provisional, D31)', () => {
  const planFor = (spec: string, logged: number[] = [], extra: Partial<Parameters<typeof card>[2]> = {}) => {
    const lat = card('lat', spec, extra)
    return planSkipRest(rowsOf([lat], logged.map((i) => headLog('lat', i))), 'lat')
  }
  it('names the sets and counts the writes', () => {
    expect(skipDescription(planFor('n n n', [1, 2]))).toBe('Set 03 will be marked skipped.')
    expect(skipDescription(planFor('n n d2', [1, 2]))).toBe('Set 03 and its 2 drops will be marked skipped.')
    expect(skipDescription(planFor('n n n', [1]))).toBe('Sets 02 and 03 will be marked skipped.')
    expect(skipDescription(planFor('n n n n', [1]))).toBe('Sets 02, 03 and 04 will be marked skipped.')
    expect(skipDescription(planFor('n d1 d1', [1]))).toBe('Sets 02 and 03 and their drops will be marked skipped.')
    expect(skipDescription(planFor('w n'))).toBe('Sets W1 and 01 will be marked skipped.')
    expect(skipLabel(1)).toBe('SKIP 1 SET')
    expect(skipLabel(4)).toBe('SKIP 4 SETS')
    expect(planFor('n d1 d1', [1]).count).toBe(4)
  })
  it('a set is named as its row is: a working set 03, a warmup W1', () => {
    const rows = rowsOf([card('lat', 'w n')])
    expect(rows.map(setName)).toEqual(['W1', '01'])
  })
  it('the eyebrow counts the card\'s working sets logged over all it draws, a drop never a set of its own: "BACK · 2 OF 3 SETS DONE"', () => {
    const lat = card('lat', 'n n d1')
    const rows = rowsOf([lat], [headLog('lat', 1), headLog('lat', 2)])
    expect(optionsEyebrow(rows, 'lat', 'back')).toBe('BACK · 2 OF 3 SETS DONE')
    // a skipped set is drawn but not done; a warmup is never counted
    const skippedOne = rowsOf([card('lat', 'w n n')], [headLog('lat', 2, { skipped: true }), headLog('lat', 3, { number: 2 }), headLog('lat', 1, { warmup: true, number: 1 })])
    expect(optionsEyebrow(skippedOne, 'lat', 'back')).toBe('BACK · 1 OF 2 SETS DONE')
    // the muscle group as the boards word it, from a stored name; no set at all: the group alone; no group: the count alone
    expect(optionsEyebrow(rowsOf([card('lat', 'n')]), 'lat', 'rear_delts')).toBe('REAR DELTS · 0 OF 1 SETS DONE')
    expect(optionsEyebrow([], 'lat', 'chest')).toBe('CHEST')
    expect(optionsEyebrow(rowsOf([card('lat', 'n')]), 'lat', null)).toBe('0 OF 1 SETS DONE')
  })
  it('W11\'s line over the button: the set left moves to the picked exercise; before a pick the plan\'s half alone', () => {
    expect(swapNote(1, 'Machine Pulldown')).toBe("The set left moves to Machine Pulldown. Next week's plan stays the same.")
    expect(swapNote(1, null)).toBe("Next week's plan stays the same.")
    expect(swapNote(3, 'Machine Pulldown')).toBe("The 3 sets left move to Machine Pulldown. Next week's plan stays the same.")
    expect(swapNote(0, 'Machine Pulldown')).toBe("No set is left to move. Machine Pulldown takes the place of this exercise today. Next week's plan stays the same.")
  })
})

describe('planSwap: the open sets move to the new exercise, in the order they stood, each with the place it takes (DECISIONS 164, 179, 183)', () => {
  const swapOf = (cards: OrderExercise[], logs: SetLog[], target = 'machine') =>
    planSwap({ order: orderOf(cards), rows: rowsOf(cards, logs), logs, cardKey: 'lat', target: { exerciseId: exerciseIdOf(target), name: 'Machine' }, newId: ids })

  it('183\'s case as Adam answered Q1: 01 logged, 02 open, 03 logged, 04 open: 02 and 04 move, places 1 and 2, named by their planned ids', () => {
    const logs = [headLog('lat', 1), headLog('lat', 3)]
    const plan = swapOf([card('lat', 'n n n n')], logs)
    expect(plan.record).toEqual({ fromKey: 'lat', moved: [{ from: { weekPlanSetId: planId('lat', 2) }, place: 1 }, { from: { weekPlanSetId: planId('lat', 4) }, place: 2 }] })
    expect(plan.entries.map((e) => [e.place, e.type.kind, e.logId])).toEqual([[1, 'normal', null], [2, 'normal', null]])
    expect(plan.moved.map((m) => [brief(m.row), m.localId === plan.entries[plan.moved.indexOf(m)].localId])).toEqual([['lat 02·', true], ['lat 04·', true]])
    expect(plan.skip.items.map((i) => brief(i.head))).toEqual(['lat 02·', 'lat 04·'])
    expect(plan.skip.count).toBe(2)
  })

  it('each moved set keeps its type: a dropset moves with its drops, a warmup as a warmup (the drops are skipped with their head on the card they leave)', () => {
    const plan = swapOf([card('lat', 'w n d2')], [])
    expect(plan.entries.map((e) => e.type)).toEqual([{ kind: 'warmup' }, { kind: 'normal' }, staged('dropset', 2)])
    expect(plan.record.moved.map((m) => m.place)).toEqual([1, 2, 3])
    expect(plan.skip.items.map((i) => [brief(i.head), i.drops.length])).toEqual([['lat W1·', 0], ['lat 01·', 0], ['lat 02·', 2]])
    expect(plan.skip.count).toBe(5)
  })

  it('sets added in the session move too, named by their place on the card they leave; planned sets first, in their order', () => {
    const plan = swapOf([card('lat', 'n n', { added: 2 })], [headLog('lat', 1)])
    expect(plan.record.moved).toEqual([
      { from: { weekPlanSetId: planId('lat', 2) }, place: 1 },
      { from: { addedPlace: 1 }, place: 2 },
      { from: { addedPlace: 2 }, place: 3 },
    ])
  })

  it('DECISIONS 179: after any sets already added to that exercise, on whichever card (break: restart at 1 over an exercise that has an added set)', () => {
    const lat = card('lat', 'n n n')
    const machine = card('machine', '', { added: 2 }) // two sets already added to the new exercise, places 1 and 2
    const plan = swapOf([lat, machine], [], 'machine')
    expect(plan.entries.map((e) => e.place)).toEqual([3, 4, 5])
    expect(plan.record.moved.map((m) => m.place)).toEqual([3, 4, 5])
    // a logged one counts as well (its log's place), though the card's list is gone
    const planWithLog = swapOf([lat, card('machine', '')], [{ ...addedLog('machine', 1, { place: 1 }) }, { ...addedLog('machine', 2, { place: 2 }) }], 'machine')
    expect(planWithLog.entries.map((e) => e.place)).toEqual([3, 4, 5])
  })

  it('nothing open to move: the record still names the card the swap leaves, with no set (the swap row says the swap happened)', () => {
    const logs = [headLog('lat', 1), headLog('lat', 2)]
    const plan = swapOf([card('lat', 'n n')], logs)
    expect(plan.record).toEqual({ fromKey: 'lat', moved: [] })
    expect(plan.entries).toEqual([])
    expect(plan.skip).toEqual({ items: [], count: 0 })
  })

  it('a logged set never moves, and the open drops of a logged head are skipped where they are (nothing of it moves)', () => {
    const head = headLog('lat', 1, { stageKind: 'dropset' })
    const plan = swapOf([card('lat', 'd2 n')], [head])
    expect(plan.moved.map((m) => brief(m.row))).toEqual(['lat 02·'])
    expect(plan.skip.items.map((i) => [brief(i.head), i.skipHead, i.drops.length])).toEqual([['lat 01✓', false, 2], ['lat 02·', true, 0]])
    expect(plan.skip.count).toBe(3)
    expect(plan.record.moved).toEqual([{ from: { weekPlanSetId: planId('lat', 2) }, place: 1 }])
  })

  it('a set added before 1.2 (no place) has nothing to be named by and stays on its card, open: neither moved nor skipped (TASKS 59)', () => {
    const old = { localId: 'old', logId: null, type: { kind: 'normal' as const }, place: 1 }
    const key = { sessionId: 's1', localId: 'old', exerciseId: exerciseIdOf('lat'), position: 2 }
    const lat = card('lat', 'n', { drafts: [draftOf(key, { kind: 'normal' }, null, '2026-10-12T17:00:00Z')] })
    const rows = rowsOf([lat])
    const oldRow = rows.find((r) => r.added)!
    expect(oldRow.addedPlace).toBeNull()
    expect(canMove(oldRow)).toBe(false)
    const plan = swapOf([lat], [])
    expect(plan.moved.map((m) => brief(m.row))).toEqual(['lat 01·'])
    expect(plan.skip.items.map((i) => brief(i.head))).toEqual(['lat 01·'])
    void old
  })

  it('the same plan whichever way the plan\'s sets and the logs are listed (a pure planner is run on every input reversed)', () => {
    const logs = [headLog('lat', 1), headLog('lat', 3)]
    const forward = card('lat', 'n n n n w')
    const reversed: OrderExercise = { ...forward, plannedSets: [...forward.plannedSets].reverse() }
    const a = swapOf([forward], logs)
    const b = swapOf([reversed], [...logs].reverse())
    expect(b.record).toEqual(a.record)
    expect(b.entries.map((e) => [e.place, e.type])).toEqual(a.entries.map((e) => [e.place, e.type]))
    expect(b.skip.items.map((i) => brief(i.head))).toEqual(a.skip.items.map((i) => brief(i.head)))
  })

  it('through the rules that draw it: the moved sets are the new card\'s, numbered on after the card they left, whose logged sets keep their numbers (Q1) — also after a reload', () => {
    const logs = [headLog('lat', 1), headLog('lat', 3)]
    const lat = card('lat', 'n n n n')
    const plan = swapOf([lat], logs)
    const machine: OrderExercise = { key: 'machine', exerciseId: exerciseIdOf('machine'), name: 'Machine', plannedSets: [], added: plan.entries, swappedFrom: plan.record }
    // the swap's skips: a skipped log of each moved planned set, with the number its row showed
    const skips: SetLog[] = plan.skip.items.map(({ head }, i) => ({ ...headLog('lat', Number(head.weekPlanSetId!.split('.')[1]), { skipped: true, number: head.number }), id: `skip.${i}` }))
    const after = resolveRows(orderOf([lat, machine]), [...logs, ...skips])
    expect(after.map(brief)).toEqual(['lat 01✓', 'lat 03✓', 'machine 03·', 'machine 04·'])
    expect(after.map((r) => r.addedPlace)).toEqual([null, null, 1, 2])
    expect(numberCorrections(orderOf([lat, machine]), [...logs, ...skips])).toEqual([])
    // the card's list gone (a reload): the original still draws no row for what moved and its logged sets keep their numbers
    const reloaded = resolveRows(orderOf([lat, { ...machine, added: [] }]), [...logs, ...skips])
    expect(reloaded.map(brief)).toEqual(['lat 01✓', 'lat 03✓'])
    expect(numberCorrections(orderOf([lat, { ...machine, added: [] }]), [...logs, ...skips])).toEqual([])
  })
})
