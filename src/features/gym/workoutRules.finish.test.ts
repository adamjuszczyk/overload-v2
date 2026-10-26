import { describe, expect, it } from 'vitest'
import { addRound, finishWarning, holdsAutoFinish, resolveRows, sessionOrder } from './workoutRules'
import { addedLog, addSet, brief, card, deepFreeze, deleted, dropLog, headLog, held, orderOf, pending, retyped, staged } from './workoutRules.testutil'

// Chunk 46: finishing (SPEC [1.2] "Finishing (11, C6)": "When planned sets aren't logged it says which")
// and ADD ROUND (Supersets, Defaults 9).

const EZ = card('ez', 'w n n', { name: 'EZ Bar Curl' })
const PULL = card('pull', 'n n n n', { name: 'Lat Pulldown' })

describe('finishWarning: the planned sets still unlogged', () => {
  it('names them by exercise and number, in the board\'s words (W18: "2 planned sets aren\'t logged yet: EZ Bar Curl 01 and 02.")', () => {
    const warning = finishWarning(orderOf([EZ]), [headLog('ez', 1, { warmup: true, number: 1 })], [])!
    expect(warning.count).toBe(2)
    expect(warning.groups).toEqual([{ exerciseKey: 'ez', exerciseName: 'EZ Bar Curl', numbers: [1, 2] }])
    expect(warning.text).toBe("2 planned sets aren't logged yet: EZ Bar Curl 01 and 02.")
    expect(warning.firstKey).toBe('set:ez.2')
  })

  it('one set reads in the singular; three numbers of one exercise are a list', () => {
    const one = finishWarning(orderOf([PULL]), [headLog('pull', 1), headLog('pull', 2), headLog('pull', 3)], [])!
    expect(one.text).toBe("1 planned set isn't logged yet: Lat Pulldown 04.")
    const three = finishWarning(orderOf([PULL]), [headLog('pull', 1)], [])!
    expect(three.text).toBe("3 planned sets aren't logged yet: Lat Pulldown 02, 03 and 04.")
  })

  it('several exercises, each with its numbers, in the order of the session', () => {
    const warning = finishWarning(orderOf([EZ, PULL]), [headLog('ez', 1, { warmup: true, number: 1 }), headLog('ez', 2, { number: 1 }), headLog('pull', 1), headLog('pull', 2)], [])!
    expect(warning.count).toBe(3)
    expect(warning.text).toBe("3 planned sets aren't logged yet: EZ Bar Curl 02; Lat Pulldown 03 and 04.")
    expect(warning.firstKey).toBe('set:ez.3')
  })

  it('numbers are the ones the rows show, not the plan\'s: a warmup in the plan does not shift them', () => {
    // plan numbers: warmup 1, working 2 and 3; the screen shows 01 and 02
    const warning = finishWarning(orderOf([EZ]), [], [])!
    expect(warning.groups[0].numbers).toEqual([1, 2])
  })

  it('there is none when every planned set is logged or skipped', () => {
    expect(finishWarning(orderOf([PULL]), [headLog('pull', 1), headLog('pull', 2), headLog('pull', 3, { skipped: true }), headLog('pull', 4)], [])).toBeNull()
    expect(finishWarning(orderOf([]), [], [])).toBeNull()
  })

  it('does not list a skipped set, a deleted one, a warmup, a set added in the session, or a drop', () => {
    const pushdown = card('pushdown', 'n d2 n', { name: 'Cable Pushdown', added: 1 })
    const head = headLog('pushdown', 2, { stageKind: 'dropset', number: 1 })
    const logs = [headLog('pushdown', 1, { skipped: true }), head] // set 1 skipped, set 2 logged with its drops still open
    const warning = finishWarning(orderOf([EZ, pushdown]), [...logs, headLog('ez', 1, { warmup: true, number: 1 }), headLog('ez', 2, { number: 1 }), headLog('ez', 3, { number: 2 })], [deleted('pushdown', 3)])
    // EZ: all done (its warmup too); pushdown: set 1 skipped, set 2 logged (drops open), set 3 deleted, the added set unlogged
    expect(warning).toBeNull()
  })

  it('lists only the planned heads of what is open: a dropset counts once, whatever its drops', () => {
    const pushdown = card('pushdown', 'd2 n', { name: 'Cable Pushdown' })
    const warning = finishWarning(orderOf([pushdown]), [], [])!
    expect(warning.count).toBe(2)
    expect(warning.text).toBe("2 planned sets aren't logged yet: Cable Pushdown 01 and 02.")
  })

  it('a planned warmup that was never logged is not a planned set here, and a working set made a warmup is not either', () => {
    expect(finishWarning(orderOf([card('bench', 'w')]), [], [])).toBeNull()
    const warning = finishWarning(orderOf([card('bench', 'n n', { name: 'Bench Press' })]), [], [retyped('bench', 1, { kind: 'warmup' })])!
    expect(warning.text).toBe("1 planned set isn't logged yet: Bench Press 01.")
  })

  it('a planned set made a dropset is one set, listed once', () => {
    const warning = finishWarning(orderOf([card('bench', 'n', { name: 'Bench Press' })]), [], [retyped('bench', 1, staged('dropset', 2))])!
    expect(warning.count).toBe(1)
  })

  it('in a superset it lists each member by name with its own numbers, and GO BACK goes to the first row on screen', () => {
    const order = orderOf([card('row', 'n n n', { name: 'Seated Cable Row' }), card('lat', 'n n n', { name: 'Lateral Raise' })], [{ id: 'blk', members: ['row', 'lat'] }])
    // A1 and B1 done, B2 and A2 open…
    const warning = finishWarning(order, [headLog('row', 1), headLog('lat', 1)], [])!
    expect(warning.groups.map((g) => g.exerciseName)).toEqual(['Seated Cable Row', 'Lateral Raise'])
    expect(warning.firstKey).toBe('set:row.2')
    expect(warning.text).toBe("4 planned sets aren't logged yet: Seated Cable Row 02 and 03; Lateral Raise 02 and 03.")
  })

  it('reads the changes it is given: a deleted set is not in the order, a logged drop does not make the set open', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const warning = finishWarning(orderOf([card('bench', 'd1 n n', { name: 'Bench Press' })]), [head, dropLog(head, 1)], [deleted('bench', 2)])!
    expect(warning.groups[0].numbers).toEqual([2])
    expect(warning.count).toBe(1)
  })

  it('reads and writes nothing it is handed', () => {
    const order = orderOf([PULL])
    const logs = deepFreeze([headLog('pull', 2), headLog('pull', 1)])
    const changes = deepFreeze([deleted('pull', 4)])
    const first = finishWarning(order, logs, changes)
    expect(finishWarning(order, logs, changes)).toEqual(first)
    expect(logs.map((l) => l.id)).toEqual(['log.pull.2', 'log.pull.1'])
  })
})

describe('addRound: one set for every member of the superset (Defaults 9)', () => {
  const row = card('row', 'n n n', { name: 'Seated Cable Row' })
  const lat = card('lat', 'n n', { name: 'Lateral Raise' })
  const order = orderOf([row, lat], [{ id: 'blk', members: ['row', 'lat'] }])

  it('a 3 and 2 superset adds one to each: the 4th set of A and the 3rd of B, each the first set added to its member (place 1)', () => {
    const rows = resolveRows(order, [], [])
    expect(addRound(order, rows, 'blk', [])).toEqual([
      { exerciseKey: 'row', exerciseId: 'ex.row', position: 4, place: 1 },
      { exerciseKey: 'lat', exerciseId: 'ex.lat', position: 3, place: 1 },
    ])
  })

  it('applied as the card does (a new entry on each member\'s list, at the place returned), the rounds are A1 B1 A2 B2 A3 B3 A4, and each new set has the number returned', () => {
    const answer = addRound(order, resolveRows(order, [], []), 'blk', [])
    let cards = [row, lat]
    answer.forEach((a, i) => (cards = addSet(cards, a.exerciseKey, `round${i}`, a.place)))
    const rows = resolveRows(sessionOrder(cards, [{ id: 'blk', members: ['row', 'lat'] }]), [], [])
    expect(rows.map(brief)).toEqual(['row A1·', 'lat B1·', 'row A2·', 'lat B2·', 'row A3·', 'lat B3·', 'row A4·'])
    expect(answer.map((_, i) => rows.find((r) => r.localId === `round${i}`)!.number)).toEqual(answer.map((a) => a.position))
    expect(answer.map((_, i) => rows.find((r) => r.localId === `round${i}`)!.addedPlace)).toEqual([1, 1])
  })

  it('each member\'s place is its own next one (DECISIONS 174): A has two added sets (one logged, one open), B one logged before the list began', () => {
    const members = [
      card('row', 'n n', { name: 'Seated Cable Row', added: [addedLog('row', 1, { number: 3, place: 1 }), { kind: 'normal' }] }),
      card('lat', 'n n', { name: 'Lateral Raise' }),
    ]
    const blockOrder = sessionOrder(members, [{ id: 'blk', members: ['row', 'lat'] }])
    const logs = [addedLog('row', 1, { number: 3, place: 1 }), addedLog('lat', 1, { number: 3, place: 4 })]
    const rows = resolveRows(blockOrder, logs, [])
    expect(addRound(blockOrder, rows, 'blk', logs).map((r) => [r.exerciseKey, r.position, r.place])).toEqual([
      ['row', 5, 3],
      ['lat', 4, 5],
    ])
  })

  it('counts the sets the members have now: added ones in, deleted ones and warmups out', () => {
    const members = [card('row', 'w n n n', { name: 'Seated Cable Row', added: 1 }), card('lat', 'n n', { name: 'Lateral Raise' })]
    const blockOrder = sessionOrder(members, [{ id: 'blk', members: ['row', 'lat'] }])
    const rows = resolveRows(blockOrder, [], [deleted('row', 2)])
    // row: 3 planned working − 1 deleted + 1 added = 3 sets; lat: 2
    expect(addRound(blockOrder, rows, 'blk', []).map((r) => r.position)).toEqual([4, 3])
  })

  it('a member with no sets gets its first', () => {
    const empty = sessionOrder([card('row', 'n'), card('lat', 'n')], [{ id: 'blk', members: ['row', 'lat'] }])
    const rows = resolveRows(empty, [], [deleted('lat', 1)])
    expect(addRound(empty, rows, 'blk', []).map((r) => r.position)).toEqual([2, 1])
  })

  it('three members, in block order', () => {
    const three = sessionOrder([card('a', 'n n'), card('b', 'n'), card('c', 'n n n')], [{ id: 'x', members: ['c', 'a', 'b'] }])
    expect(addRound(three, resolveRows(three, [], []), 'x', []).map((r) => [r.exerciseKey, r.position])).toEqual([['c', 4], ['a', 3], ['b', 2]])
  })

  it('names no block it cannot find', () => {
    expect(() => addRound(order, resolveRows(order, [], []), 'nope', [])).toThrow(RangeError)
    // a plain card is not a block
    const plain = sessionOrder([card('bench', 'n')])
    expect(() => addRound(plain, resolveRows(plain, [], []), 'bench', [])).toThrow(RangeError)
  })
})

// Chunk 61's review 1, F2. DECISIONS 166 (a), the option Adam took: "Auto-finish waits until no row of `resolveRows` is open. That covers working sets, drops and
// planned warmups, with deleted sets out and retyped drops in. A set added in the session and never logged doesn't hold it, as today." `finishWarning` (above) lists
// the planned working sets only, so `holdsAutoFinish` is what it leaves out: the screen asks both (`useWorkoutRows.nothingLeft`).
describe('holdsAutoFinish: the open rows besides the planned working sets that keep auto-finish waiting (DECISIONS 166 (a); 61\'s review 1, F2)', () => {
  const holding = (cards: ReturnType<typeof card>[], logs: ReturnType<typeof headLog>[], changes: Parameters<typeof resolveRows>[2] = []) =>
    resolveRows(orderOf(cards), logs, changes).filter(holdsAutoFinish).map(brief)
  const BENCH = card('bench', 'n d2 n', { name: 'Bench Press' })
  const dropsetHead = () => headLog('bench', 2, { stageKind: 'dropset' })
  const heads = () => [headLog('bench', 1), dropsetHead(), headLog('bench', 3)]

  it('an open drop of a planned dropset holds it, one row per drop (the warning, which lists working sets, is empty)', () => {
    expect(finishWarning(orderOf([BENCH]), heads(), [])).toBeNull()
    expect(holding([BENCH], heads())).toEqual(['bench 02.1·', 'bench 02.2·'])
  })

  it('a logged or skipped drop is settled: only the drop still open holds it', () => {
    expect(holding([BENCH], [...heads(), dropLog(dropsetHead(), 1)])).toEqual(['bench 02.2·'])
    expect(holding([BENCH], [...heads(), dropLog(dropsetHead(), 1), dropLog(dropsetHead(), 2, { skipped: true })])).toEqual([])
  })

  it('a planned dropset not logged yet has open drops too (its head is the warning\'s)', () => {
    expect(holding([BENCH], [headLog('bench', 1), headLog('bench', 3)])).toEqual(['bench 02.1·', 'bench 02.2·'])
  })

  it('a skipped head\'s drops are dead (the rows leave them out), and a deleted set\'s drops go with it: neither holds it', () => {
    expect(holding([BENCH], [headLog('bench', 1), headLog('bench', 2, { skipped: true }), headLog('bench', 3)])).toEqual([])
    expect(holding([BENCH], [headLog('bench', 1), headLog('bench', 3)], [deleted('bench', 2)])).toEqual([])
  })

  it('a planned set retyped to a dropset has its new drops in, open ones hold it; one retyped away from a dropset has none', () => {
    const plain = card('bench', 'n n n', { name: 'Bench Press' })
    expect(holding([plain], heads(), [retyped('bench', 2, staged('dropset', 2))])).toEqual(['bench 02.1·', 'bench 02.2·'])
    expect(holding([BENCH], [headLog('bench', 1), headLog('bench', 3)], [retyped('bench', 2, { kind: 'normal' })])).toEqual([]) // not logged yet: Normal, so no drops
  })

  it('an open planned warmup holds it; a logged or skipped one does not', () => {
    const ez = card('ez', 'w w n', { name: 'EZ Bar Curl' })
    expect(holding([ez], [headLog('ez', 3, { number: 1 })])).toEqual(['ez W1·', 'ez W2·'])
    expect(holding([ez], [headLog('ez', 1, { warmup: true, number: 1 }), headLog('ez', 2, { warmup: true, skipped: true, number: 2 }), headLog('ez', 3, { number: 1 })])).toEqual([])
  })

  it('a planned set switched to a warmup is a planned warmup, and holds it while it is open', () => {
    expect(holding([card('bench', 'n n', { name: 'Bench Press' })], [headLog('bench', 2, { number: 1 })], [retyped('bench', 1, { kind: 'warmup' })])).toEqual(['bench W1·'])
  })

  it('a set added in the session never holds it, nor do its drops or its warmup, logged or not (166 (a): "as today")', () => {
    expect(holding([card('bench', 'n', { added: 1 })], [headLog('bench', 1)])).toEqual([])
    const added = addedLog('bench', 1, { stageKind: 'dropset', number: 2 })
    expect(holding([card('bench', 'n', { added: [added] })], [headLog('bench', 1), added], [held(pending(added, 'dropset', 2), 'c1')])).toEqual([])
    expect(holding([card('bench', 'n', { added: [{ kind: 'warmup' }] })], [headLog('bench', 1)])).toEqual([])
  })

  it('a planned working set is the warning\'s, not this one\'s (so the screen asks both)', () => {
    const open = card('bench', 'n n', { name: 'Bench Press' })
    expect(holding([open], [])).toEqual([])
    expect(finishWarning(orderOf([open]), [], [])).not.toBeNull()
  })
})
