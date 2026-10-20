import { describe, expect, it } from 'vitest'
import type { SetLog } from '../../types'
import { numberCorrections, resolveRows } from './workoutRules'
import { Session } from './workoutRules.session.testutil'
import { addedLog, brief, card, dropLog, headLog, orderOf, staged } from './workoutRules.testutil'

// Chunk 46, sixth attempt: a warmup's number (DECISIONS 173's first bullet, review 5's F1) and the stored numbers the rules
// report (DECISIONS 178).
//   173: "Warmups follow the same numbering rule as working sets: when a warmup's displayed number changes (delete, switch to
//   or from Warmup), its log's stored number is patched, so a log never keeps a number its row no longer shows."
//   178: "Chunk 46's rules report the logged sets whose stored number differs from the number their row shows; the workout
//   screen writes the corrected numbers when it draws the session's rows. It writes only where they differ, so drawing the
//   same session again writes nothing."
// Every step is the module's answer applied as the card and the queue will (`Session`); every expected value is written out.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const
const threeLogged = (): SetLog[] => [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]

/** A card's head rows as the user reads them, each named by who it is: "P2" a planned set, else the added set's own id. */
function read(s: Session, cardKey = 'bench'): string[] {
  return s
    .rows()
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    .map((r) => `${brief(r).split(' ')[1]}=${r.added ? r.localId : `P${r.key.split('.').pop()}`}`)
}

/** What each head log holds, by who it is: "A:w1" a warmup log holding 1, "P2:3" a working set's log holding 3. */
function stored(s: Session, cardKey = 'bench'): string[] {
  return s
    .rows()
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage' && r.logId !== null)
    .map((r) => {
      const log = s.server.logs.find((l) => l.id === r.logId)!
      return `${r.added ? r.localId : `P${r.key.split('.').pop()}`}:${log.isWarmup ? 'w' : ''}${log.setNumber}`
    })
}

/** Unlog `key` and log it again with its draft, and say whether every log reads back as it was (an exact undo). */
function unlogAndLog(s: Session, key: string): { before: string[]; after: string[] } {
  const before = stored(s)
  const draft = s.unlog(key).draft
  s.relog(key, draft)
  return { before, after: stored(s) }
}

// ─── F1: a warmup's log holds the number its row shows ─────────────────────────────────────────

describe('a warmup\'s log holds the number its row shows, through every switch and delete (DECISIONS 173; review 5\'s F1)', () => {
  it('two added sets logged as 04 and 05, then made Warmups: W1 and W2, their logs hold 1 and 2, and REVIEW sees two items (w1, w2)', () => {
    const s = new Session([card('bench', 'n n n')], [], threeLogged())
    s.add('bench', 'A')
    s.add('bench', 'B')
    s.log('added:bench:A')
    s.log('added:bench:B')
    expect(stored(s)).toEqual(['P1:1', 'P2:2', 'P3:3', 'A:4', 'B:5'])
    s.retype('added:bench:A', WARMUP)
    expect(read(s)).toEqual(['W1✓=A', '01✓=P1', '02✓=P2', '03✓=P3', '04✓=B'])
    expect(stored(s)).toEqual(['A:w1', 'P1:1', 'P2:2', 'P3:3', 'B:4'])
    s.retype('added:bench:B', WARMUP)
    expect(read(s)).toEqual(['W1✓=A', 'W2✓=B', '01✓=P1', '02✓=P2', '03✓=P3'])
    expect(stored(s)).toEqual(['A:w1', 'B:w2', 'P1:1', 'P2:2', 'P3:3'])
    // REVIEW keys an added set by its stored number: two warmups, two items (the fifth attempt's logs held 4 and 4: one item)
    expect(s.reviewAddedSetKeys()).toEqual(['added-set:s1:ex.bench:w1', 'added-set:s1:ex.bench:w2'])
  })

  it('unlog then log of a set made a Warmup stores the number it shows (W1 → 1): an exact undo', () => {
    const s = new Session([card('bench', 'n n n')], [], threeLogged())
    s.add('bench', 'A')
    s.log('added:bench:A')
    s.retype('added:bench:A', WARMUP)
    expect(read(s)).toEqual(['W1✓=A', '01✓=P1', '02✓=P2', '03✓=P3'])
    const { before, after } = unlogAndLog(s, 'added:bench:A')
    expect(before).toEqual(['A:w1', 'P1:1', 'P2:2', 'P3:3'])
    expect(after).toEqual(before)
  })

  it('bench `w n n n` all logged, 01 made a Warmup: it shows W2 and its log holds 2, beside W1 holding 1; unlog and log store 2', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 }), headLog('bench', 3, { number: 2 }), headLog('bench', 4, { number: 3 })]
    const s = new Session([card('bench', 'w n n n')], [], logs)
    const effects = s.retype('set:bench.2', WARMUP)
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.bench.3', setNumber: 1 },
      { id: 'log.bench.4', setNumber: 2 },
    ])
    expect(read(s)).toEqual(['W1✓=P1', 'W2✓=P2', '01✓=P3', '02✓=P4'])
    expect(stored(s)).toEqual(['P1:w1', 'P2:w2', 'P3:1', 'P4:2'])
    const { before, after } = unlogAndLog(s, 'set:bench.2')
    expect(after).toEqual(before)
  })

  it('bench `w w n n` all logged, W1 made Normal: the other warmup shows W1 and its log holds 1', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { warmup: true, number: 2 }), headLog('bench', 3, { number: 1 }), headLog('bench', 4, { number: 2 })]
    const s = new Session([card('bench', 'w w n n')], [], logs)
    const effects = s.retype('set:bench.1', NORMAL)
    expect(effects.renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.4', setNumber: 3 },
    ])
    expect(read(s)).toEqual(['W1✓=P2', '01✓=P1', '02✓=P3', '03✓=P4'])
    expect(stored(s)).toEqual(['P2:w1', 'P1:1', 'P3:2', 'P4:3'])
  })

  it('a warmup deleted: the warmups after it move up, their logs with them; a working set deleted moves no warmup', () => {
    const logs = [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { warmup: true, number: 2 }), headLog('bench', 3, { warmup: true, number: 3 }), headLog('bench', 4, { number: 1 })]
    const s = new Session([card('bench', 'w w w n')], [], logs)
    s.delete('set:bench.1')
    expect(stored(s)).toEqual(['P2:w1', 'P3:w2', 'P4:1'])
    s.delete('set:bench.4')
    expect(stored(s)).toEqual(['P2:w1', 'P3:w2'])
  })

  it('an open set switched to Warmup before logged warmups moves them up one, and back again; nothing of its own to write', () => {
    // bench `n w`: the warmup (set 2) is logged as W1; set 1, open, made a Warmup comes before it: W1, and the logged one W2
    const s = new Session([card('bench', 'n w')], [], [headLog('bench', 2, { warmup: true, number: 1 })])
    expect(s.retype('set:bench.1', WARMUP).renumber).toEqual([{ id: 'log.bench.2', setNumber: 2 }])
    expect(read(s)).toEqual(['W1·=P1', 'W2✓=P2'])
    expect(s.retype('set:bench.1', NORMAL).renumber).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
    expect(read(s)).toEqual(['W1✓=P2', '01·=P1'])
  })
})

// ─── 178: the stored numbers the rules report ──────────────────────────────────────────────────

describe('numberCorrections: the logged sets whose stored number differs from their row\'s (DECISIONS 178)', () => {
  /** Adam's shape: Bench 01–03 logged; A and B added and logged as 04 and 05; A unlogged. */
  function adamsShape(): Session {
    const s = new Session([card('bench', 'n n n')], [], threeLogged())
    s.add('bench', 'A')
    s.add('bench', 'B')
    s.log('added:bench:A')
    s.log('added:bench:B')
    s.unlog('added:bench:A')
    return s
  }

  it('Adam\'s shape: A unlogged and gone with the session\'s end, B is listed (stored 5, shown 4), and nothing else', () => {
    const s = adamsShape()
    // while the session runs every stored number is its row's: nothing to report
    expect(read(s)).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04·=A', '05✓=B'])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    // the session ends (A's draft and the card's list end with it) and is reopened: the screen draws it and writes this
    const bLog = s.server.logs.find((l) => l.addedPlace === 2)!
    const corrections = s.reopen()
    expect(corrections).toEqual([{ id: bLog.id, setNumber: 4 }])
    expect(read(s)).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', `04✓=${bLog.id}`])
    // drawn again: nothing (the screen writes only where they differ)
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    expect(stored(s)).toEqual(['P1:1', 'P2:2', 'P3:3', `${bLog.id}:4`])
  })

  it('every log on a row: a skipped set\'s, a drop\'s (its head\'s number) and a warmup\'s; in the order of the rows', () => {
    // as a reopened session can leave them: A (place 1, a Warmup) and B (place 2, a dropset with its drop) are gone with the
    // session's end and C, D are drawn up one in their lists
    const c = addedLog('bench', 3, { number: 2, warmup: true, place: 3 })
    const d = addedLog('bench', 4, { number: 5, place: 4, stageKind: 'dropset' })
    const logs = [headLog('bench', 1), headLog('bench', 2, { skipped: true, number: 3 }), headLog('bench', 3), c, d, dropLog(d, 1)]
    const order = orderOf([card('bench', 'n n n')])
    expect(resolveRows(order, logs).map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02×', 'bench 03✓', 'bench 04✓', 'bench 04.1✓'])
    expect(numberCorrections(order, logs)).toEqual([
      { id: c.id, setNumber: 1 },
      { id: 'log.bench.2', setNumber: 2 },
      { id: d.id, setNumber: 4 },
      { id: `${d.id}.d1`, setNumber: 4 },
    ])
  })

  it('1.1\'s logs, numbered in the order they were logged, are reported at the number their row shows', () => {
    // set 3 logged first (1), then set 1 (2): the rows read them in the plan's order
    const logs = [headLog('bench', 3, { number: 1 }), headLog('bench', 1, { number: 2 })]
    expect(numberCorrections(orderOf([card('bench', 'n n n')]), logs)).toEqual([
      { id: 'log.bench.1', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 3 },
    ])
  })

  it('empty when every stored number is its row\'s, whatever the session holds (absence)', () => {
    const s = adamsShape()
    s.retype('added:bench:B', WARMUP)
    s.delete('set:bench.2')
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    expect(numberCorrections(orderOf([card('bench', 'w n d1')]), [headLog('bench', 1, { warmup: true, number: 1 }), headLog('bench', 2, { number: 1 })])).toEqual([])
  })

  it('a reopened session with a never-logged added Warmup before a logged one: the logged one is corrected to W1, and the working sets are left alone', () => {
    const s = new Session([card('bench', 'n n')], [], [headLog('bench', 1), headLog('bench', 2)])
    s.add('bench', 'A')
    s.retype('added:bench:A', WARMUP)
    s.add('bench', 'B')
    s.retype('added:bench:B', WARMUP)
    s.log('added:bench:B')
    s.add('bench', 'C')
    s.log('added:bench:C')
    s.retype('added:bench:B', staged('dropset', 1))
    s.retype('added:bench:B', WARMUP)
    expect(read(s)).toEqual(['W1·=A', 'W2✓=B', '01✓=P1', '02✓=P2', '03✓=C'])
    expect(stored(s)).toEqual(['B:w2', 'P1:1', 'P2:2', 'C:3'])
    const bLog = s.server.logs.find((l) => l.addedPlace === 2)!
    expect(s.reopen()).toEqual([{ id: bLog.id, setNumber: 1 }])
    expect(stored(s)).toEqual([`${bLog.id}:w1`, 'P1:1', 'P2:2', `${s.server.logs.find((l) => l.addedPlace === 3)!.id}:3`])
  })

  it('185 (c): two phones on one session, one holding an open added set the other can\'t see (G46): the phone that holds it corrects none of the logs after it, the other corrects each once, and once the set is logged or deleted neither writes again (break: report a log after an open added set)', () => {
    // phone 1 adds A and B and logs B as 03 (A open, 02); phone 2 holds no list and no draft, so it draws B as 02
    const s = new Session([card('bench', 'n')], [], [headLog('bench', 1)])
    s.add('bench', 'A')
    s.add('bench', 'B')
    s.log('added:bench:B')
    expect(read(s)).toEqual(['01✓=P1', '02·=A', '03✓=B'])
    const bLog = s.server.logs.find((l) => l.addedPlace === 2)!
    const phone2 = orderOf([card('bench', 'n')])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    expect(numberCorrections(phone2, s.server.logs, s.server.held())).toEqual([{ id: bLog.id, setNumber: 2 }])
    // each phone draws at every refetch: phone 2 writes B once, phone 1 never; no stored number changes more than once
    const writes: Array<[number, number]> = []
    const numbers: number[] = []
    for (let round = 0; round < 4; round++) {
      const one = numberCorrections(s.order(), s.server.logs, s.server.held())
      s.server.applyCorrections(one)
      const two = numberCorrections(phone2, s.server.logs, s.server.held())
      s.server.applyCorrections(two)
      writes.push([one.length, two.length])
      numbers.push(s.server.logs.find((l) => l.id === bLog.id)!.setNumber)
    }
    expect(writes).toEqual([[0, 1], [0, 0], [0, 0], [0, 0]])
    expect(numbers).toEqual([2, 2, 2, 2])
    // A logged on phone 1 stores its row's 02 beside B's 2 until phone 1's next draw (the refetch after its LOG) writes B's 3,
    // once; then both phones draw the same rows and neither writes
    const logged = s.copy()
    logged.log('added:bench:A')
    expect(numberCorrections(phone2, logged.server.logs, logged.server.held())).toEqual([{ id: bLog.id, setNumber: 3 }])
    expect(logged.draw()).toEqual([{ id: bLog.id, setNumber: 3 }])
    expect(numberCorrections(logged.order(), logged.server.logs, logged.server.held())).toEqual([])
    expect(numberCorrections(phone2, logged.server.logs, logged.server.held())).toEqual([])
    // A deleted on phone 1 instead: B is 02 on both phones, as phone 2 wrote it
    const deleted = s.copy()
    expect(deleted.delete('added:bench:A').renumber).toEqual([])
    expect(numberCorrections(deleted.order(), deleted.server.logs, deleted.server.held())).toEqual([])
    expect(numberCorrections(phone2, deleted.server.logs, deleted.server.held())).toEqual([])
  })

  it('185 (c) with a swap (183 (a): one list for the two cards): a log on the swap\'s card after an open set added to the card it replaced is left on the phone that holds that set, and corrected once on the other (break: leave out only the logs on the open set\'s own card)', () => {
    const s = new Session([card('lat', 'n n')], [], [headLog('lat', 1)])
    const m = s.swap('lat', 'machine')
    const moved = s.log(s.rows().find((r) => r.exerciseKey === m)!.key)
    expect(moved.setNumber).toBe(2)
    // a set added to the original card after the swap is one of its sets, after the gap the moved set left (46r's Q1): the swap's
    // card reads on after it, on this phone
    s.add('lat', 'N')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 03·', `${m} 03✓`])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    // phone 2 holds no list: it draws the moved set from its log, as 02, which is what it stores
    const phone2 = orderOf(s.cards.map((c) => ({ ...c, added: [] })))
    expect(resolveRows(phone2, s.server.logs, s.server.held()).map(brief)).toEqual(['lat 01✓', `${m} 02✓`])
    expect(numberCorrections(phone2, s.server.logs, s.server.held())).toEqual([])
    // logged, N is on both phones: phone 1 corrects the moved set to 03, once
    s.log('added:lat:N')
    expect(s.draw()).toEqual([{ id: moved.id, setNumber: 3 }])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
  })

  it('185 (c) for a Warmup: an open added Warmup is a set only its phone holds too, so that phone corrects no warmup after it and the other corrects each once (break: an open Warmup not taken for one)', () => {
    const s = new Session([card('bench', 'n')], [], [headLog('bench', 1)])
    s.add('bench', 'A')
    s.retype('added:bench:A', WARMUP)
    s.add('bench', 'B')
    s.retype('added:bench:B', WARMUP)
    s.log('added:bench:B')
    expect(read(s)).toEqual(['W1·=A', 'W2✓=B', '01✓=P1'])
    const bLog = s.server.logs.find((l) => l.addedPlace === 2)!
    const phone2 = orderOf([card('bench', 'n')])
    const writes: Array<[number, number]> = []
    for (let round = 0; round < 3; round++) {
      const one = numberCorrections(s.order(), s.server.logs, s.server.held())
      s.server.applyCorrections(one)
      const two = numberCorrections(phone2, s.server.logs, s.server.held())
      s.server.applyCorrections(two)
      writes.push([one.length, two.length])
    }
    expect(writes).toEqual([[0, 1], [0, 0], [0, 0]])
    expect(s.server.logs.find((l) => l.id === bLog.id)!.setNumber).toBe(1)
  })

  it('185 (c): only the logs after the open added set are left: one before it, or on another card, is corrected as 178 says (break: leave out a log that doesn\'t come after one)', () => {
    const b = addedLog('bench', 2, { number: 9, place: 2 })
    const logs = [headLog('bench', 1), headLog('bench', 2, { number: 5 }), b, headLog('curl', 1, { number: 4 })]
    const order = orderOf([card('bench', 'n n', { added: [{ kind: 'normal' }, b] }), card('curl', 'n n')])
    expect(resolveRows(order, logs).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04✓', 'curl 01✓', 'curl 02·'])
    expect(numberCorrections(order, logs)).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: 'log.curl.1', setNumber: 1 },
    ])
    // the open set logged: B after it is corrected too
    const a = addedLog('bench', 1, { number: 3, place: 1 })
    const both = orderOf([card('bench', 'n n', { added: [a, b] }), card('curl', 'n n')])
    expect(numberCorrections(both, [...logs, a])).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: b.id, setNumber: 4 },
      { id: 'log.curl.1', setNumber: 1 },
    ])
  })
})
