import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { currentSet, finishWarning, lockDecision, resolveRows, unlogEffects, type ResolvedRow } from './workoutRules'
import { brief, card, dropLog, headLog, orderOf, rowKeyed, staged, viewOf } from './workoutRules.testutil'

// Chunk 46 (TASKS-1.2, "Seed"): the shapes the staging checks of chunks 58a to 64 rely on, built from
// supabase/seed.sql as chunk 36 left it and counted by hand.
//
// The test account's week 3 Monday Upper A is IN PROGRESS: the seed logs the first three heads in the order
// the card list gives them (`upto := 3`): the bench warmup and bench working sets 1 and 2. Everything else
// is unlogged. The program (seed.sql, "Upper A"): bench (a warmup, then three working sets, the plan's own
// numbers 1 to 4), a superset of Seated Cable Row (A) and Lateral Raise (B), three sets each, and Cable
// Pushdown (set 2 a dropset with two drops).
//
// The screen numbers working sets without the warmup, so what TASKS 58a / 60 call "bench set 4" (the plan's
// number: the warmup is its set 1) is the row that shows "03".

const here = dirname(fileURLToPath(import.meta.url))
const seed = readFileSync(join(here, '..', '..', '..', 'supabase', 'seed.sql'), 'utf8')

const BENCH = card('bench', 'w n n n', { name: 'Bench Press' })
const ROW = card('row', 'n n n', { name: 'Seated Cable Row' })
const LAT = card('lat', 'n n n', { name: 'Lateral Raise' })
const PUSHDOWN = card('pushdown', 'n d2', { name: 'Cable Pushdown' })
const BLOCK = [{ id: 'blk', members: ['row', 'lat'] }]
const UPPER_A = orderOf([BENCH, ROW, LAT, PUSHDOWN], BLOCK)

// What the seed has logged in the in-progress session.
const SEEDED = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 }), headLog('bench', 3, { number: 2 })]

describe('the seed\'s week 3 Monday Upper A, in progress', () => {
  it('still logs the first three heads and nothing more (the shape these tests mirror)', () => {
    expect(seed).toContain("if r.wd_name = 'Upper A' then sess_status := 'in_progress'; upto := 3;")
    expect(seed).toContain('insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup, rep_min, rep_max) values (t, pe, 1, true, 10, 10);')
  })

  it('the rows: three logged on the bench, the rest open, in the order the screen draws them', () => {
    expect(resolveRows(UPPER_A, SEEDED, []).map(brief)).toEqual([
      'bench W1✓',
      'bench 01✓',
      'bench 02✓',
      'bench 03·',
      'row A1·',
      'lat B1·',
      'row A2·',
      'lat B2·',
      'row A3·',
      'lat B3·',
      'pushdown 01·',
      'pushdown 02·',
      'pushdown 02.1·',
      'pushdown 02.2·',
    ])
  })

  it('the current set is the bench\'s last working set — the plan\'s set 4, shown as 03', () => {
    const current = currentSet(UPPER_A, SEEDED, [])!
    expect(current.key).toBe('set:bench.4')
    expect(brief(current)).toBe('bench 03·')
  })

  it('LOG on the superset\'s A1 asks (lock on), and the question names the set as the screen shows it', () => {
    const rows = resolveRows(UPPER_A, SEEDED, [])
    const decision = lockDecision({ logInOrder: true, current: currentSet(UPPER_A, SEEDED, []), tapped: rows.find((r) => r.key === 'set:row.1')! })
    expect(decision).toEqual({ ask: 'Log A1 before set 03?', next: 'Bench Press 03', label: 'A1' })
    // with the lock off, or on the current set itself, it logs at once
    expect(lockDecision({ logInOrder: false, current: currentSet(UPPER_A, SEEDED, []), tapped: rows.find((r) => r.key === 'set:row.1')! })).toBe('log')
    expect(lockDecision({ logInOrder: true, current: currentSet(UPPER_A, SEEDED, []), tapped: rows.find((r) => r.key === 'set:bench.4')! })).toBe('log')
  })

  it('after the bench set 03 the current set walks the superset in zigzag order, then the pushdown, head and drops', () => {
    const logs = [...SEEDED]
    const walk: string[] = []
    let guard = 0
    let next = currentSet(UPPER_A, logs, [])
    // log whatever is current, one row at a time, the way a lifter works through the screen
    while (next && guard++ < 30) {
      walk.push(brief(next))
      if (next.kind === 'stage') {
        const head = logs.find((l) => l.id === `log.${next!.headKey!.replace('set:', '')}`)!
        logs.push(dropLog(head, next.stageNumber!))
      } else {
        const planned = next.weekPlanSetId!
        const [key, index] = [planned.slice(0, planned.lastIndexOf('.')), Number(planned.slice(planned.lastIndexOf('.') + 1))]
        logs.push(headLog(key, index, { number: next.number, stageKind: next.type?.kind === 'staged' ? next.type.stageKind : null }))
      }
      next = currentSet(UPPER_A, logs, [])
    }
    expect(walk).toEqual([
      'bench 03·',
      'row A1·',
      'lat B1·',
      'row A2·',
      'lat B2·',
      'row A3·',
      'lat B3·',
      'pushdown 01·',
      'pushdown 02·',
      'pushdown 02.1·',
      'pushdown 02.2·',
    ])
    expect(currentSet(UPPER_A, logs, [])).toBeNull()
    expect(finishWarning(UPPER_A, logs, [])).toBeNull()
  })

  it('FINISH now would name nine planned sets, exercise by exercise (the numbers the rows show)', () => {
    const warning = finishWarning(UPPER_A, SEEDED, [])!
    expect(warning.count).toBe(9)
    expect(warning.text).toBe(
      "9 planned sets aren't logged yet: Bench Press 03; Seated Cable Row 01, 02 and 03; Lateral Raise 01, 02 and 03; Cable Pushdown 01 and 02.",
    )
    expect(warning.firstKey).toBe('set:bench.4')
  })
})

describe('the seed\'s week 2 Upper A, done differently from its plan', () => {
  // Lateral raise set 1 was made a dropset in the session and one drop was logged under it, with no planned
  // drop behind it; seated cable row set 3 was skipped. Everything else as planned.
  it('a head made a dropset with one drop logged reads as a staged set, and unlogging it keeps that type', () => {
    const head = headLog('lat', 1, { stageKind: 'dropset' })
    const drop = { ...dropLog(head, 1), weekPlanSetId: null }
    const logs = [head, headLog('lat', 2), headLog('lat', 3)]
    const rows = resolveRows(orderOf([LAT]), [...logs, drop], [])
    expect(rows.map(brief)).toEqual(['lat 01✓', 'lat 01.1✓', 'lat 02✓', 'lat 03✓'])
    expect(rows[0]).toMatchObject({ type: staged('dropset', 1), plannedType: { kind: 'normal' } })

    // a logged drop follows: it has to go first
    const view = viewOf(orderOf([LAT]), [...logs, drop])
    expect(() => unlogEffects(rowKeyed(view, 'set:lat.1'), view)).toThrow(RangeError)
  })

  it('a skipped set is settled; nothing in a finished session is left to do', () => {
    const row = [headLog('row', 1), headLog('row', 2), headLog('row', 3, { skipped: true })]
    const lat = [headLog('lat', 1), headLog('lat', 2), headLog('lat', 3)]
    const order = orderOf([ROW, LAT], BLOCK)
    expect(currentSet(order, [...row, ...lat], [])).toBeNull()
    expect(finishWarning(order, [...row, ...lat], [])).toBeNull()
    const rows: ResolvedRow[] = resolveRows(order, [...row, ...lat], [])
    expect(rows.filter((r) => r.state === 'skipped').map(brief)).toEqual(['row A3×'])
  })
})
