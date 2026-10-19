import { describe, expect, it } from 'vitest'
import { currentSet, lockDecision, resolveRows, rowLabel, type LoggedSet, type ResolvedRow } from './workoutRules'
import { addedLog, brief, card, deleted, dropLog, headLog, orderOf, pending, retyped, staged } from './workoutRules.testutil'

// Chunk 46: the current set (SPEC [1.2] "Current set = the first unlogged working set or stage in the
// session's order"; G54) and the log lock (18a, board W7b).

// Upper A in the seed's shape: bench with a warmup, a superset of two exercises, a pushdown with a dropset.
const BENCH = card('bench', 'w n n n', { name: 'Bench Press' })
const ROW = card('row', 'n n n', { name: 'Seated Cable Row' })
const LAT = card('lat', 'n n n', { name: 'Lateral Raise' })
const PUSHDOWN = card('pushdown', 'n d2', { name: 'Cable Pushdown' })
const BLOCK = { id: 'blk', members: ['row', 'lat'] }
const UPPER_A = () => orderOf([BENCH, ROW, LAT, PUSHDOWN], [BLOCK])

const current = (order: ReturnType<typeof orderOf>, logs: LoggedSet[] = [], changes: Parameters<typeof currentSet>[2] = []) =>
  currentSet(order, logs, changes)

// What the bench logs look like when its warmup and the first n working sets are done.
const benchDone = (working: number): LoggedSet[] => [
  headLog('bench', 1, { warmup: true, number: 1 }),
  ...[2, 3, 4].slice(0, working).map((index, i) => headLog('bench', index, { number: i + 1 })),
]

describe('currentSet: the first unlogged working set or drop', () => {
  it('with nothing logged it is the first working set, not the unlogged warmup before it (G54, warmups as rows)', () => {
    const rows = resolveRows(UPPER_A(), [], [])
    expect(brief(rows[0])).toBe('bench W1·')
    expect(brief(current(UPPER_A())!)).toBe('bench 01·')
  })

  it('the same when the warmup has been ticked off (G54, warmups as a tick list): it is the first working set either way', () => {
    expect(brief(current(UPPER_A(), [headLog('bench', 1, { warmup: true, number: 1 })])!)).toBe('bench 01·')
  })

  it('moves down the card as sets are logged, then into the superset, then the next card', () => {
    expect(brief(current(UPPER_A(), benchDone(2))!)).toBe('bench 03·')
    expect(brief(current(UPPER_A(), benchDone(3))!)).toBe('row A1·')
    const allBlock = [headLog('row', 1), headLog('lat', 1), headLog('row', 2), headLog('lat', 2), headLog('row', 3), headLog('lat', 3)]
    expect(brief(current(UPPER_A(), [...benchDone(3), ...allBlock])!)).toBe('pushdown 01·')
  })

  it('zigzags through a superset\'s rounds: A1 logged makes B1 the current set, B1 logged makes A2', () => {
    expect(brief(current(UPPER_A(), [...benchDone(3), headLog('row', 1)])!)).toBe('lat B1·')
    expect(brief(current(UPPER_A(), [...benchDone(3), headLog('row', 1), headLog('lat', 1)])!)).toBe('row A2·')
  })

  it('a skipped set is settled: the set after it is current, and a skipped set never is', () => {
    const logs = [...benchDone(1), headLog('bench', 3, { skipped: true, number: 2 })]
    expect(brief(current(UPPER_A(), logs)!)).toBe('bench 03·')
    expect(current(orderOf([card('bench', 'n')]), [headLog('bench', 1, { skipped: true })])).toBeNull()
  })

  it('is null when everything is logged, and for a session with no sets', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2)]
    expect(current(orderOf([card('bench', 'n n')]), logs)).toBeNull()
    expect(current(orderOf([]))).toBeNull()
  })

  it('a drop is current once the row before it is logged, and the head is current before that', () => {
    const order = orderOf([card('pushdown', 'n d2')])
    const first = headLog('pushdown', 1)
    expect(brief(current(order, [first])!)).toBe('pushdown 02·') // the head of set 2
    const head = headLog('pushdown', 2, { stageKind: 'dropset' })
    expect(brief(current(order, [first, head])!)).toBe('pushdown 02.1·')
    expect(brief(current(order, [first, head, dropLog(head, 1)])!)).toBe('pushdown 02.2·')
    expect(current(order, [first, head, dropLog(head, 1), dropLog(head, 2)])).toBeNull()
  })

  it('the drops of a skipped head are dead: they are never current', () => {
    const head = headLog('pushdown', 1, { skipped: true, stageKind: 'dropset' })
    expect(current(orderOf([card('pushdown', 'd2')]), [head])).toBeNull()
  })

  it('a planned set the session deleted is not a candidate', () => {
    const order = orderOf([card('bench', 'n n n')])
    const row = current(order, [headLog('bench', 1)], [deleted('bench', 2)])!
    expect(row.key).toBe('set:bench.3')
    expect(brief(row)).toBe('bench 02·')
  })

  it('a drop added under a logged set is the current set (SPEC 19) — the head\'s own next row, before the next set', () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const row = current(orderOf([card('bench', 'n n')]), [head], [pending(head, 'dropset', 1)])!
    expect(brief(row)).toBe('bench 01.1·')
  })

  it('…unless an earlier set is still unlogged: then that set is, and logging the drop follows the lock', () => {
    // set 2 was logged out of order and made a dropset; set 1 is still open
    const head = headLog('bench', 2, { stageKind: 'dropset', number: 1 })
    const row = current(orderOf([card('bench', 'n n n')]), [head], [pending(head, 'dropset', 1)])!
    expect(row.key).toBe('set:bench.1')
  })

  it('a set made a dropset before it is logged: the head first, then the drops the change counts', () => {
    const order = orderOf([card('bench', 'n n')])
    const change = retyped('bench', 1, staged('dropset', 2))
    expect(brief(current(order, [], [change])!)).toBe('bench 01·')
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    expect(brief(current(order, [head], [change])!)).toBe('bench 01.1·')
    expect(brief(current(order, [head, dropLog(head, 1)], [change])!)).toBe('bench 01.2·')
    expect(brief(current(order, [head, dropLog(head, 1), dropLog(head, 2)], [change])!)).toBe('bench 02·')
  })

  it('a set made a warmup is no longer a candidate (it never was current as a warmup)', () => {
    const row = current(orderOf([card('bench', 'n n')]), [], [retyped('bench', 1, { kind: 'warmup' })])!
    expect(row.key).toBe('set:bench.2')
  })

  it('a set added in the session is current when it is the first one open', () => {
    const order = orderOf([card('bench', 'n', { added: 1 })])
    expect(brief(current(order, [headLog('bench', 1)])!)).toBe('bench 02·')
    expect(current(order, [headLog('bench', 1)])!.added).toBe(true)
    // once it is logged the card's entry names its log, and nothing is left
    const log = addedLog('bench', 1, { number: 2 })
    expect(current(orderOf([card('bench', 'n', { added: [log] })]), [headLog('bench', 1), log])).toBeNull()
  })

  it('goes card by card in the order given, a block standing where its first member is', () => {
    const order = orderOf([PUSHDOWN, BENCH, ROW, LAT], [BLOCK])
    expect(brief(current(order)!)).toBe('pushdown 01·')
    expect(brief(current(order, [headLog('pushdown', 1), headLog('pushdown', 2, { stageKind: 'dropset' })])!)).toBe('pushdown 02.1·')
  })

  it('is the first row of resolveRows that is still to do — the one list the screen draws', () => {
    const logs = [...benchDone(3), headLog('row', 1)]
    const rows = resolveRows(UPPER_A(), logs, [])
    const first = rows.find((r) => r.kind !== 'warmup' && r.state === 'unlogged')
    expect(current(UPPER_A(), logs)).toEqual(first)
  })
})

// ─── The log lock ────────────────────────────────────────────────────────────────────────────────

const rowOf = (rows: ResolvedRow[], key: string): ResolvedRow => {
  const found = rows.find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

describe('lockDecision: LOG on a row (SPEC 18a, G54)', () => {
  // Lat Pulldown sets 1 and 2 are done, so its set 03 is current, and the superset after it is untouched.
  const LAT_PULLDOWN = card('latpull', 'n n n', { name: 'Lat Pulldown' })
  const order = orderOf([LAT_PULLDOWN, ROW, LAT], [BLOCK])
  const logs = [headLog('latpull', 1), headLog('latpull', 2)]
  const rows = resolveRows(order, logs, [])
  const now = currentSet(order, logs, [])

  it('with the lock off every LOG logs', () => {
    expect(lockDecision({ logInOrder: false, current: now, tapped: rowOf(rows, 'set:row.2') })).toBe('log')
    expect(lockDecision({ logInOrder: false, current: now, tapped: now! })).toBe('log')
  })

  it('on the current set LOG logs straight away', () => {
    expect(brief(now!)).toBe('latpull 03·')
    expect(lockDecision({ logInOrder: true, current: now, tapped: now! })).toBe('log')
  })

  it('on any other row it asks, naming the row and the set that is next (board W7b: "Log A2 before set 03?")', () => {
    const decision = lockDecision({ logInOrder: true, current: now, tapped: rowOf(rows, 'set:row.2') })
    expect(decision).toEqual({ ask: 'Log A2 before set 03?', next: 'Lat Pulldown 03', label: 'A2' })
  })

  it('names each row by what it is: a plain row "set 05", a superset member by letter and round, a drop by its head', () => {
    const plain = card('bench', 'n n n n n', { name: 'Bench Press' })
    const plainOrder = orderOf([plain])
    const plainRows = resolveRows(plainOrder, [headLog('bench', 1), headLog('bench', 2)], [])
    const cur = currentSet(plainOrder, [headLog('bench', 1), headLog('bench', 2)], [])
    expect(lockDecision({ logInOrder: true, current: cur, tapped: rowOf(plainRows, 'set:bench.5') })).toEqual({
      ask: 'Log set 05 before set 03?',
      next: 'Bench Press 03',
      label: 'set 05',
    })

    // current is the first drop of a dropset; tapped is the next card's first set
    const dropOrder = orderOf([card('pushdown', 'd2', { name: 'Cable Pushdown' }), card('curl', 'n', { name: 'EZ Bar Curl' })])
    const head = headLog('pushdown', 1, { stageKind: 'dropset' })
    const dropRows = resolveRows(dropOrder, [head], [])
    const dropNow = currentSet(dropOrder, [head], [])
    expect(brief(dropNow!)).toBe('pushdown 01.1·')
    expect(lockDecision({ logInOrder: true, current: dropNow, tapped: rowOf(dropRows, 'set:curl.1') })).toEqual({
      ask: 'Log set 01 before set 01 drop 1?',
      next: 'Cable Pushdown 01 drop 1',
      label: 'set 01',
    })
  })

  it('names the members of a superset: LOG on B2 while B1 is current asks "Log B2 before B1?"', () => {
    const blockOrder = orderOf([ROW, LAT], [BLOCK])
    const done = [headLog('row', 1)]
    const blockRows = resolveRows(blockOrder, done, [])
    const cur = currentSet(blockOrder, done, [])
    expect(brief(cur!)).toBe('lat B1·')
    expect(lockDecision({ logInOrder: true, current: cur, tapped: rowOf(blockRows, 'set:lat.2') })).toEqual({
      ask: 'Log B2 before B1?',
      next: 'Lateral Raise 01',
      label: 'B2',
    })
  })

  it('a warmup\'s LOG never asks, whatever is current (G54)', () => {
    const benchOrder = orderOf([BENCH, ROW], [])
    const benchRows = resolveRows(benchOrder, [], [])
    const cur = currentSet(benchOrder, [], [])
    const warmup = benchRows.find((r) => r.kind === 'warmup')!
    expect(lockDecision({ logInOrder: true, current: cur, tapped: warmup })).toBe('log')
    // and a working set 1 while the warmup is unlogged is the current set, so it logs too
    expect(lockDecision({ logInOrder: true, current: cur, tapped: cur! })).toBe('log')
    // a row further down still asks
    expect(lockDecision({ logInOrder: true, current: cur, tapped: rowOf(benchRows, 'set:row.1') })).toEqual({
      ask: 'Log set 01 before set 01?',
      next: 'Bench Press 01',
      label: 'set 01',
    })
  })

  it('logs when no set is open (even for a row that reads unlogged), and when the row tapped is not one still to do', () => {
    expect(lockDecision({ logInOrder: true, current: null, tapped: rowOf(rows, 'set:row.1') })).toBe('log')
    const only = orderOf([card('bench', 'n n')])
    const done = [headLog('bench', 1), headLog('bench', 2)]
    const onlyRows = resolveRows(only, done, [])
    expect(lockDecision({ logInOrder: true, current: null, tapped: onlyRows[0] })).toBe('log')
    expect(lockDecision({ logInOrder: true, current: now, tapped: rowOf(rows, 'set:latpull.1') })).toBe('log')
  })

  it('rowLabel names a drop by its head and its place, "drop" for a dropset and "stage" for the other kinds', () => {
    const dropRows = resolveRows(orderOf([card('pushdown', 'd1 r1')]), [], [])
    expect(dropRows.filter((r) => r.kind === 'stage').map(rowLabel)).toEqual(['set 01 drop 1', 'set 02 stage 1'])
    // a superset member's drop is named by its round
    const blockRows = resolveRows(orderOf([card('row', 'd1'), card('lat', 'n')], [BLOCK]), [], [])
    expect(blockRows.filter((r) => r.kind === 'stage').map(rowLabel)).toEqual(['A1 drop 1'])
  })

  it('rowLabel names a warmup "warmup" (it is never asked about)', () => {
    const warmup = resolveRows(orderOf([BENCH]), [], []).find((r) => r.kind === 'warmup')!
    expect(rowLabel(warmup)).toBe('warmup')
  })
})
