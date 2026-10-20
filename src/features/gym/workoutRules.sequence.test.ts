import { describe, expect, it } from 'vitest'
import type { SessionSetChangeType, SetLog } from '../../types'
import { currentSet, finishWarning, lockDecision, numberCorrections, type ResolvedRow } from './workoutRules'
import { Session } from './workoutRules.session.testutil'
import { addedLog, brief, card, headLog, lists, staged } from './workoutRules.testutil'

// Chunk 46, fifth and sixth attempts: DECISIONS 170 (Adam, 2026-10-18): "Set numbers are never claimed or stored per rule. Each
// set has a fixed place in the session order: planned sets by planned position, added sets by when they were added. A set's
// displayed number is its rank among the non-deleted, non-warmup working sets in that order (warmups numbered apart, as now).
// LOG stores the number the row shows; a delete or warmup switch that changes logged sets' numbers patches them, as 146 (a)
// already writes." Its verification: "a sequence test: many generated sequences of add, log, unlog, delete and warmup
// switches, asserting after every step that numbers are contiguous with no duplicates, every set's identity and order are
// unchanged, and unlog then log is an exact undo."
// DECISIONS 173 (Adam, 2026-10-19): "Warmups follow the same numbering rule as working sets … An added set's place in the
// session order is persisted when it is created … and survives reload and reopening. A set added in a reopened session comes
// after every set added earlier. No two logs ever hold one number. The sequence test's generator adds warmup steps (add, log,
// unlog, switch to and from Warmup) and a 'reopen the session' step, with the same invariants after every step, plus: no two
// logs share a number, and REVIEW sees two added warmups as two items." And 178: what the screen writes when it draws a
// reopened session, "only where they differ, so drawing the same session again writes nothing".
//
// Every step is the module's own answer applied as the card and the sync queue will (`Session`). The fixed cases are the
// fourth review's four sequences (D, W, 2D, MR), the fourth attempt's own unlog case, and DECISIONS 161's; the generated
// sequences come from a seeded generator, so a failure names its seed and its steps. Nothing a check reads is left out for
// warmups: every log's stored number, a warmup's included, is held against its row's after every step.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const

/** A card's head rows as the user reads them, each named by who it is: "P2" a planned set (its plan index), else the added set's id. */
function read(s: Session, cardKey: string): string[] {
  return s
    .rows()
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    .map((r) => `${brief(r).split(' ')[1]}=${r.added ? r.localId : `P${r.key.split('.').pop()}`}`)
}

/** The numbers the head logs hold, by who they are, a warmup's with a `w` (drops left out: they hold their head's). */
function stored(s: Session, cardKey: string): string[] {
  return s
    .rows()
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage' && r.logId !== null)
    .map((r) => {
      const log = s.server.logs.find((l) => l.id === r.logId)!
      return `${r.added ? r.localId : `P${r.key.split('.').pop()}`}:${log.isWarmup ? 'w' : ''}${log.setNumber}`
    })
}

/** Bench `spec` with 01 to `n` logged as their places; `added` sets added after them, by the ids given (A, B, …). */
function bench(spec: string, logged: number[], added: string[]): Session {
  const s = new Session([card('bench', spec)], [], logged.map((i, k) => headLog('bench', i, { number: k + 1 })))
  for (const id of added) s.add('bench', id)
  return s
}

// ─── The fourth review's four sequences (DECISIONS 170's evidence) ──────────────────────────────────

describe('the fourth review\'s sequences: a set before unlogged added sets deleted or switched, and every set stays where it is', () => {
  it('D: A logged as 04 and unlogged, B new (05); DELETE 02: A 03, B 04', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.log('added:bench:A')
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04✓=A', '05·=B'])
    s.unlog('added:bench:A')
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04·=A', '05·=B'])
    s.delete('set:bench.2')
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P3', '03·=A', '04·=B'])
    expect(stored(s, 'bench')).toEqual(['P1:1', 'P3:2'])
    // the keys did not change hands: the draft is still on A's row, B is still the new one
    expect(s.row('added:bench:A').draftKey).toMatchObject({ localId: 'A' })
    expect(s.row('added:bench:B').draftKey).toBeNull()
  })

  it('W: the same, with 02 made a Warmup: A 03, B 04 (and 02\'s log holds its W1)', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.log('added:bench:A')
    s.unlog('added:bench:A')
    s.retype('set:bench.2', WARMUP)
    expect(read(s, 'bench')).toEqual(['W1✓=P2', '01✓=P1', '02✓=P3', '03·=A', '04·=B'])
    expect(stored(s, 'bench')).toEqual(['P2:w1', 'P1:1', 'P3:2'])
  })

  it('2D: A (04) and C (05) logged and unlogged; DELETE 02: A 03, C 04', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'C'])
    s.log('added:bench:A')
    s.log('added:bench:C')
    const drafts = { A: s.unlog('added:bench:A').draft, C: s.unlog('added:bench:C').draft }
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04·=A', '05·=C'])
    s.delete('set:bench.2')
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P3', '03·=A', '04·=C'])
    // logged again in either order, each stores the number its row shows and nothing moves
    for (const [first, second] of [['A', 'C'], ['C', 'A']] as const) {
      const t = s.copy()
      t.relog(`added:bench:${first}`, drafts[first])
      expect(read(t, 'bench'), first).toEqual(first === 'A' ? ['01✓=P1', '02✓=P3', '03✓=A', '04·=C'] : ['01✓=P1', '02✓=P3', '03·=A', '04✓=C'])
      t.relog(`added:bench:${second}`, drafts[second])
      expect(read(t, 'bench'), first).toEqual(['01✓=P1', '02✓=P3', '03✓=A', '04✓=C'])
      expect(stored(t, 'bench'), first).toEqual(['P1:1', 'P3:2', 'A:3', 'C:4'])
    }
  })

  it('MR: bench `w n n`, 01–02 logged; A (03) and C (04) logged and unlogged; the open planned Warmup made Normal: A 04, C 05', () => {
    const s = bench('w n n', [2, 3], ['A', 'C'])
    expect(read(s, 'bench')).toEqual(['W1·=P1', '01✓=P2', '02✓=P3', '03·=A', '04·=C'])
    s.log('added:bench:A')
    s.log('added:bench:C')
    s.unlog('added:bench:A')
    s.unlog('added:bench:C')
    expect(read(s, 'bench')).toEqual(['W1·=P1', '01✓=P2', '02✓=P3', '03·=A', '04·=C'])
    s.retype('set:bench.1', NORMAL)
    expect(read(s, 'bench')).toEqual(['01·=P1', '02✓=P2', '03✓=P3', '04·=A', '05·=C'])
    expect(stored(s, 'bench')).toEqual(['P2:2', 'P3:3'])
  })
})

describe('the other fixed cases: unlog moves nothing, and 161\'s', () => {
  it('the fourth attempt\'s case: an added set logged ahead of two newer open ones (06) and unlogged stays 06 (151)', () => {
    const s = bench('n n n', [1, 2, 3], ['X', 'Y', 'Z'])
    s.log('added:bench:Z')
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04·=X', '05·=Y', '06✓=Z'])
    s.unlog('added:bench:Z')
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04·=X', '05·=Y', '06·=Z'])
    // and a delete before them after that: each moves down one, in its place
    s.delete('set:bench.1')
    expect(read(s, 'bench')).toEqual(['01✓=P2', '02✓=P3', '03·=X', '04·=Y', '05·=Z'])
    expect(stored(s, 'bench')).toEqual(['P2:1', 'P3:2'])
  })

  it('U1 (161): A logged 04 and made a Warmup, B new; UNLOG A keeps it W1 with its key, B stays 04 and is current; logging it again restores W1', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.log('added:bench:A')
    s.retype('added:bench:A', WARMUP)
    expect(read(s, 'bench')).toEqual(['W1✓=A', '01✓=P1', '02✓=P2', '03✓=P3', '04·=B'])
    expect(stored(s, 'bench')).toEqual(['A:w1', 'P1:1', 'P2:2', 'P3:3'])
    const effects = s.unlog('added:bench:A')
    expect(read(s, 'bench')).toEqual(['W1·=A', '01✓=P1', '02✓=P2', '03✓=P3', '04·=B'])
    expect(currentSet(s.order(), s.server.logs, s.server.held())!.key).toBe('added:bench:B')
    s.relog('added:bench:A', effects.draft)
    expect(read(s, 'bench')).toEqual(['W1✓=A', '01✓=P1', '02✓=P2', '03✓=P3', '04·=B'])
    expect(stored(s, 'bench')).toEqual(['A:w1', 'P1:1', 'P2:2', 'P3:3'])
  })

  it('U2 (161): A logged 04 and made a Dropset ×1, B new (05); UNLOG A keeps 04 with its drop 04.1, B stays 05', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.log('added:bench:A')
    s.retype('added:bench:A', staged('dropset', 1))
    const before = s.rows().map(brief)
    expect(before).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 04.1·', 'bench 05·'])
    s.unlog('added:bench:A')
    expect(s.rows().map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·', 'bench 05·'])
    expect(read(s, 'bench')).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04·=A', '05·=B'])
  })

  it('the third review\'s case: two added sets open, the first made a Warmup: it is W1, not current, the lock answers LOG for both, and once both are logged the working sets read 01–04', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.retype('added:bench:A', WARMUP)
    expect(read(s, 'bench')).toEqual(['W1·=A', '01✓=P1', '02✓=P2', '03✓=P3', '04·=B'])
    const current = currentSet(s.order(), s.server.logs, s.server.held())
    expect(current!.key).toBe('added:bench:B')
    for (const key of ['added:bench:A', 'added:bench:B']) expect(lockDecision({ logInOrder: true, current, tapped: s.row(key) }), key).toBe('log')
    s.log('added:bench:B')
    s.log('added:bench:A')
    expect(read(s, 'bench')).toEqual(['W1✓=A', '01✓=P1', '02✓=P2', '03✓=P3', '04✓=B'])
    expect(stored(s, 'bench')).toEqual(['A:w1', 'P1:1', 'P2:2', 'P3:3', 'B:4'])
  })

  it('review 5\'s two bugs as one session: two added Warmups are two REVIEW items, and a set added after a reopen comes last', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.log('added:bench:A')
    s.log('added:bench:B')
    s.retype('added:bench:A', WARMUP)
    s.retype('added:bench:B', WARMUP)
    expect(stored(s, 'bench')).toEqual(['A:w1', 'B:w2', 'P1:1', 'P2:2', 'P3:3'])
    expect(s.reviewAddedSetKeys()).toEqual(['added-set:s1:ex.bench:w1', 'added-set:s1:ex.bench:w2'])
    s.add('bench', 'C')
    s.log('added:bench:C')
    expect(s.reopen()).toEqual([])
    s.add('bench', 'N')
    expect(read(s, 'bench').slice(-2)).toEqual([`04✓=${s.rows().find((r) => r.addedPlace === 3)!.localId}`, '05·=N'])
    expect(s.log('added:bench:N').setNumber).toBe(5)
    expect(s.reviewAddedSetKeys()).toEqual(['added-set:s1:ex.bench:w1', 'added-set:s1:ex.bench:w2', 'added-set:s1:ex.bench:4', 'added-set:s1:ex.bench:5'])
  })
})

// ─── The generated sequences ───────────────────────────────────────────────────────────────────

/** A seeded generator (a 32-bit linear congruential one): the same seed, the same sequence. */
function generator(seed: number) {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  return {
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number): boolean => next() < p,
    int: (n: number): number => Math.floor(next() * n),
  }
}

const WALK_BLOCKS = [{ id: 'blk', members: ['row', 'lat'] }]
/** The exercises of the session's plan, and three a swap can bring in (their logs carry `ex.<name>`). */
const PLANNED = ['bench', 'row', 'lat', 'curl'] as const
const ELSEWHERE = ['dip', 'fly', 'press'] as const

/** Logs of sets added before 1.2 (no place, no planned set: 044 came after them), numbered as 1.1 numbered them (the logged heads + 1). */
function oldLogs(key: string, count: number): SetLog[] {
  return Array.from({ length: count }, (_, i) => addedLog(key, i + 1, { number: i + 1, loggedAt: `2026-10-12T17:0${i}:00Z` }))
}

/**
 * A session of four cards: bench with two warmups and drops, a superset of two, a plain card; `added` sets added to each from
 * the start, of the types given in turn (made so right after ADD SET); with `old`, bench and curl hold sets added before 1.2.
 */
function startOf(added: readonly SessionSetChangeType[], old = false): Session {
  const logs = old ? [...oldLogs('bench', 3), ...oldLogs('curl', 2)] : []
  const s = new Session([card('bench', 'w w d2 n n d1'), card('row', 'n d1 n'), card('lat', 'n d1 n'), card('curl', 'n n n')], WALK_BLOCKS, logs)
  for (const key of PLANNED) {
    added.forEach((type, i) => {
      const rowKey = s.add(key, `${key}${i + 1}`)
      if (type.kind !== 'normal') s.retype(rowKey, type)
    })
  }
  return s
}

type Mode = 'mixed' | 'added' | 'warmups' | 'phones' | 'staged' | 'swaps' | 'old'
const START: Record<Mode, readonly SessionSetChangeType[]> = {
  mixed: [],
  added: [NORMAL, NORMAL, NORMAL],
  warmups: [WARMUP, NORMAL, WARMUP],
  phones: [NORMAL, WARMUP],
  staged: [staged('dropset', 1), WARMUP, NORMAL],
  swaps: [NORMAL, WARMUP],
  old: [NORMAL],
}

/** How often the sequences reached each case (a sequence test that never gets there proves nothing about it). */
const reached = {
  deleteBeforeTwoOpenAdded: 0,
  switchBeforeTwoOpenAdded: 0,
  deleteBeforeUnloggedAdded: 0,
  switchBeforeUnloggedAdded: 0,
  unlogWithOpenAddedBefore: 0,
  unlogAddedWarmup: 0,
  unlogAddedStaged: 0,
  unlogWithAnotherAddedWarmup: 0,
  addedWarmupMadeWorkingBeforeLogged: 0,
  exactUndo: 0,
  // the sixth attempt's (173, 178)
  warmupLogMoved: 0,
  twoLoggedAddedWarmups: 0,
  reopenWithLoggedAdded: 0,
  correctionsWritten: 0,
  addAfterReopen: 0,
  unlogNotListed: 0,
  logDraftNotListed: 0,
  unlogPlannedWarmup: 0,
  // 46r's (183, 184, 185)
  swapOpenBeforeLogged: 0,
  swapIntoExerciseWithAdded: 0,
  swapIntoSessionExercise: 0,
  swapBackToOriginal: 0,
  swapIntoSameCardAgain: 0,
  editOnSwappedCard: 0,
  editBeforeSwappedCard: 0,
  logOnSwappedCard: 0,
  dropStateAfterSwap: 0,
  unlogOld: 0,
  relogOld: 0,
  leftAfterOpenAdded: 0,
}

/** What the user reads off a row, and which set it is: compared before and after a step that must move nothing. */
const reading = (r: ResolvedRow) => [r.key, r.kind, r.number, r.type, r.stageNumber, r.state] as const

/** The stored logs without what a new log can't keep (its id, when it was logged): every other column, a warmup's number and the place included. */
function storedLogs(logs: readonly SetLog[], rows: readonly ResolvedRow[]) {
  const whose = (id: string | null) => rows.find((r) => r.logId === id)?.key ?? id
  return logs.map((l) => JSON.stringify({ ...l, id: whose(l.id), parentSetId: whose(l.parentSetId), loggedAt: null })).sort()
}

/** Each row's place in its slot by the sequence's own record (a drop has its set's): the slot's cards' places, card by card. */
function slotPlaces(s: Session): Map<string, { slot: string; at: number }> {
  const at = new Map<string, { slot: string; at: number }>()
  for (const slot of new Set(s.slotOf.values())) s.slotCards(slot).flatMap((k) => s.places.get(k)!).forEach((key, i) => at.set(key, { slot, at: i }))
  return at
}

/** Is `row` after a set added in the session and still open, in its slot (by the sequence's record)? Such a set is only on this phone (185 (c)). */
function afterOpenAdded(s: Session, rows: readonly ResolvedRow[], row: ResolvedRow): boolean {
  const at = slotPlaces(s)
  const mine = at.get(row.headKey ?? row.key)!
  return rows.some((o) => o.added && o.kind !== 'stage' && o.state === 'unlogged' && at.get(o.key)?.slot === mine.slot && at.get(o.key)!.at < mine.at)
}

/** The logs on rows whose stored number is not their row's. */
function differing(s: Session): Set<string> {
  return new Set(s.rows().filter((r) => r.logId !== null && s.server.logs.find((l) => l.id === r.logId)!.setNumber !== r.number).map((r) => r.logId!))
}

/**
 * The screen draws after the step (58a writes 46's corrections, 178 and 185 (c)). Before it, a log may hold a number its row no
 * longer shows only if it already did (`stale`) or the step itself moves numbers no writer patches (`allowed`: + ADD SET before
 * logged sets of its slot, a swap, a set added before 1.2 logged again, 184 (b)); a writer that renumbers leaves no log wrong.
 * After it, a log still wrong comes after a set added and still open in its slot, which only this phone holds (185 (c)). Returns
 * the logs left wrong.
 */
function drawAfter(s: Session, label: string, stale: ReadonlySet<string>, allowed: ReadonlySet<string> = new Set()): Set<string> {
  for (const id of differing(s)) expect(stale.has(id) || allowed.has(id), `${label}: the step left the number of ${id} wrong`).toBe(true)
  s.draw()
  const left = differing(s)
  const rows = s.rows()
  for (const id of left) expect(afterOpenAdded(s, rows, rows.find((r) => r.logId === id)!), `${label}: the draw left ${id} wrong with no open added set before it`).toBe(true)
  if (left.size > 0) reached.leftAfterOpenAdded++
  return left
}

/**
 * What must hold after every step (DECISIONS 170's three, 173's two, 178's, 183's, 185's and the rules around them).
 * `s.places`, `s.slotOf` and `s.old` are the sequence's own record of where each set is; the module never sees them. `stale`:
 * the logs the last draw left wrong, after a set only this phone holds (185 (c)).
 */
function check(s: Session, label: string, stale: ReadonlySet<string>): void {
  const rows = s.rows()
  expect(new Set(rows.map((r) => r.key)).size, `${label}: row keys are unique`).toBe(rows.length)
  for (const [cardKey, places] of s.places) {
    const heads = rows.filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    // every set's identity and order are unchanged: the sets are the ones the session holds, in their places
    expect([...heads].sort((a, b) => a.planIndex - b.planIndex).map((r) => r.key), `${label}: the sets of ${cardKey} in their places`).toEqual(places)
    // …and drawn in that order: the card's warmups, then its working sets
    const kinds = new Map(heads.map((r) => [r.key, r.kind]))
    expect(heads.map((r) => r.key), `${label}: ${cardKey} drawn in order`).toEqual([...places.filter((k) => kinds.get(k) === 'warmup'), ...places.filter((k) => kinds.get(k) === 'working')])
    // an open added set's row names its own draft, never another set's
    for (const r of heads) if (r.draftKey !== null) expect(r.draftKey.localId, `${label}: ${r.key}'s draft`).toBe(r.localId)
    // …and every set is drawn with its own log: a planned set's is its planned set's, an added set's the one its card's entry
    // names, and a set the card doesn't list is keyed by its log (or is its draft's)
    const entries = new Map((s.cards.find((c) => c.key === cardKey)?.added ?? []).map((a) => [a.localId, a]))
    for (const r of heads) {
      if (r.added && entries.has(r.localId!)) expect(entries.get(r.localId!)!.logId, `${label}: ${r.key} is drawn with its own log`).toBe(r.logId)
      else if (r.added) expect(r.logId === null ? r.draftKey?.localId : r.logId, `${label}: ${r.key}, listed nowhere, is its log's or its draft's`).toBe(r.localId)
      else if (r.logId !== null) expect(s.server.logs.find((l) => l.id === r.logId)!.weekPlanSetId, `${label}: ${r.key}'s log`).toBe(r.weekPlanSetId)
    }
    // an added set's log holds its place (174), a planned set's and a drop's none (177); a set added before 1.2 none (184)
    for (const r of rows.filter((x) => x.exerciseKey === cardKey && x.logId !== null)) {
      const log = s.server.logs.find((l) => l.id === r.logId)!
      expect(log.addedPlace ?? null, `${label}: ${r.key}'s log's place`).toBe(r.added && r.kind !== 'stage' ? r.addedPlace : null)
    }
    const old = s.old.get(cardKey)!
    expect([...heads].sort((a, b) => a.planIndex - b.planIndex).filter((r) => r.added && r.addedPlace === null).map((r) => r.key), `${label}: ${cardKey}'s sets added before 1.2, in the order they were logged`).toEqual(old)
    if (heads.filter((r) => r.added && r.kind === 'warmup' && r.state === 'logged').length >= 2) reached.twoLoggedAddedWarmups++
  }
  // every slot is one numbering (183 (a)): a card a swap made with the card it replaced, every other card on its own (183's
  // follow-up: each card numbered on its own)
  for (const slot of new Set(s.slotOf.values())) {
    const cards = s.slotCards(slot)
    const heads = rows.filter((r) => cards.includes(r.exerciseKey) && r.kind !== 'stage').sort((a, b) => a.planIndex - b.planIndex)
    expect(heads.map((r) => r.key), `${label}: the slot of ${slot} in its order`).toEqual(cards.flatMap((k) => s.places.get(k)!))
    for (const r of rows.filter((x) => cards.includes(x.exerciseKey))) expect(r.slotKey, `${label}: ${r.key}'s slot`).toBe(slot)
    // numbers are contiguous with no duplicates: the working sets read 1 to n, the warmups 1 to m
    const working = heads.filter((r) => r.kind === 'working')
    const warmups = heads.filter((r) => r.kind === 'warmup')
    expect(working.map((r) => r.number), `${label}: the working sets of ${slot}'s slot`).toEqual(working.map((_, i) => i + 1))
    expect(warmups.map((r) => r.number), `${label}: the warmups of ${slot}'s slot`).toEqual(warmups.map((_, i) => i + 1))
    // LOG stores the number the row shows, and every writer that moves numbers keeps it so: every log on a row, a warmup's,
    // a working set's and a drop's (173), but one the last draw left after a set only this phone holds (185 (c))
    for (const r of rows.filter((x) => cards.includes(x.exerciseKey) && x.logId !== null)) {
      const log = s.server.logs.find((l) => l.id === r.logId)!
      if (stale.has(log.id)) continue
      expect(log.setNumber, `${label}: ${r.key} shows ${r.number} and its log holds ${log.setNumber}`).toBe(r.number)
    }
    // no two logs share a number: of the slot's working sets' head logs, and of its warmups' (W1 and 01 are told apart, as REVIEW does)
    for (const list of [working, warmups]) {
      const numbers = list.filter((r) => r.logId !== null && !stale.has(r.logId)).map((r) => s.server.logs.find((l) => l.id === r.logId)!.setNumber)
      expect(new Set(numbers).size, `${label}: two logs of ${slot}'s slot hold one number (${numbers.join(', ')})`).toBe(numbers.length)
    }
  }
  // 178 and 185 (c): the screen drawing the session now writes nothing
  expect(numberCorrections(s.order(), s.server.logs, s.server.held()), `${label}: a draw now writes nothing`).toEqual([])
  // REVIEW (the one other reader of a log's number) sees each logged added set as an item of its own: two added Warmups are two.
  // It keys an item by exercise and number and keeps one item per key, so two cards of one exercise, each numbered on its own
  // (183's follow-up), can hold two sets it reads as one: compared as sets of keys (the slots' "no two logs share a number" above
  // is what holds within a card)
  if (stale.size === 0) {
    const want = rows
      .filter((r) => r.added && r.kind !== 'stage' && r.state === 'logged')
      .map((r) => `added-set:s1:${r.exerciseId}:${r.kind === 'warmup' ? 'w' : ''}${r.number}`)
    expect([...new Set(s.reviewAddedSetKeys())].sort(), `${label}: REVIEW's items for the added sets`).toEqual([...new Set(want)].sort())
  }
  // a deleted set stays deleted
  for (const change of s.server.held()) {
    if (change.kind === 'deleted') expect(rows.map((r) => r.key), `${label}: ${change.weekPlanSetId} is deleted`).not.toContain(`set:${change.weekPlanSetId}`)
  }
  // G54: a warmup is never the current set, and with the lock on its LOG never asks
  const current = currentSet(s.order(), s.server.logs, s.server.held())
  expect(current, `${label}: the current set is the first open row that is no warmup`).toEqual(rows.find((r) => r.kind !== 'warmup' && r.state === 'unlogged') ?? null)
  for (const r of rows) if (r.kind === 'warmup') expect(lockDecision({ logInOrder: true, current, tapped: r }), `${label}: LOG on ${r.key}`).toBe('log')
  // the finish warning lists the open planned sets with the numbers their rows show
  const warning = finishWarning(s.order(), s.server.logs, s.server.held())
  const openPlanned = rows.filter((r) => r.kind === 'working' && r.state === 'unlogged' && r.weekPlanSetId !== null)
  expect(warning?.count ?? 0, `${label}: the finish warning`).toBe(openPlanned.length)
}

/** After `row` (a set) in its slot, the open added sets: how many, and whether one of them keeps a draft. */
function openAddedAfter(rows: readonly ResolvedRow[], row: ResolvedRow) {
  const after = rows.filter((r) => r.slotKey === row.slotKey && r.kind !== 'stage' && r.added && r.state === 'unlogged' && r.planIndex > row.planIndex)
  return { count: after.length, drafted: after.some((r) => r.draftKey !== null) }
}

/** The logs of the sets of `cardKey` added before 1.2 (no place): what a re-log of one of them may move (184 (b)). */
function oldLogIds(s: Session, cardKey: string): Set<string> {
  return new Set(s.rows().filter((r) => r.exerciseKey === cardKey && r.added && r.addedPlace === null && r.logId !== null).flatMap((r) => [r.logId!, ...s.server.logs.filter((l) => l.parentSetId === r.logId).map((l) => l.id)]))
}

/**
 * UNLOG on the row `key`, checked as 170 asks: the unlog itself moves nothing (every row reads as it did, the set itself open
 * again), and on a copy, logging it again with its draft is an exact undo (the rows, the stored logs, a warmup's number and an
 * added set's place included, the change rows). A set added before 1.2 is the exception 184 (b) makes: its unlog moves nothing,
 * and logging it again moves it to after the card's other sets added before 1.2 (the copy's record says where), the draw then
 * writing the numbers it moved.
 */
function unlogExactly(s: Session, key: string, label: string, stale: ReadonlySet<string>): void {
  const before = s.rows()
  const logsBefore = s.server.logs.map((l) => ({ ...l }))
  const changesBefore = s.server.held()
  const set = before.find((r) => r.key === key)!
  const effects = s.unlog(key)
  expect(Object.keys(effects).sort(), `${label}: an unlog holds no number patch`).toEqual(['changes', 'deleteOrder', 'draft'])
  const after = s.rows()
  // nothing moves: every row reads the same, but the set itself, which is open again with its number and its type
  expect(after.map(reading), `${label}: the unlog of ${key} moves nothing`).toEqual(
    before.map((r) => (r.key === key ? ([r.key, r.kind, r.number, r.type, r.stageNumber, 'unlogged'] as const) : reading(r))),
  )
  if (set.added && set.kind !== 'stage') {
    // the draft holds the type (161), the place (174) and the log's time (184), and the card keeps the same (a set it didn't
    // list is taken in; one added before 1.2 has its draft alone)
    expect('type' in effects.draft.values && effects.draft.values.type, `${label}: the draft of ${key}`).toEqual(set.type)
    expect('place' in effects.draft.values && effects.draft.values.place, `${label}: the draft's place for ${key}`).toBe(set.addedPlace)
    const log = logsBefore.find((l) => l.id === set.logId)!
    expect('loggedAt' in effects.draft.values && effects.draft.values.loggedAt, `${label}: the draft's time for ${key}`).toBe(log.loggedAt)
    if (set.addedPlace !== null) expect(s.cardOf(key).added!.find((a) => a.localId === set.localId), `${label}: the card's entry for ${key}`).toMatchObject({ type: set.type, place: set.addedPlace, logId: null })
  }
  // logging it again on a copy restores what was there
  const t = s.copy()
  if (set.added && set.kind !== 'stage' && set.addedPlace === null) {
    reached.relogOld++
    t.relog(key, effects.draft)
    const left = drawAfter(t, `${label} (logged again)`, stale, oldLogIds(t, set.exerciseKey))
    check(t, `${label} (logged again)`, left)
    return
  }
  t.relog(key, effects.draft)
  const relogged = t.rows()
  expect(relogged.map(reading), `${label}: unlog and log of ${key} gives back the rows`).toEqual(before.map(reading))
  // a set the last draw left with a number its row doesn't show (185 (c)) is logged again with the number it shows
  const want = logsBefore.map((l) => (l.id === set.logId && stale.has(l.id) ? { ...l, setNumber: set.number } : l))
  expect(storedLogs(t.server.logs, relogged), `${label}: unlog and log of ${key} gives back the stored sets`).toEqual(storedLogs(want, before))
  const kept = (changes: ReturnType<Session['server']['held']>) => changes.filter((c) => c.kind !== 'pending_stages')
  expect(kept(t.server.held()), `${label}: unlog and log of ${key} leaves the change rows`).toEqual(kept(changesBefore))
  reached.exactUndo++
}

/**
 * A reopen or a reload (the phone's state for the session goes, all of it or the list alone), checked as 178 asks: the draw's
 * corrections write only logs whose stored number differs from their row's, and each to that number; the sets left are the ones
 * the sequence's own record keeps, in their places. Returns the logs the draw left wrong (185 (c)).
 */
function dropState(s: Session, how: 'reopen' | 'reload', label: string): Set<string> {
  const loggedAdded = s.rows().some((r) => r.added && r.kind !== 'stage' && r.logId !== null)
  if (how === 'reopen' && loggedAdded) reached.reopenWithLoggedAdded++
  if (s.cards.some((c) => c.swappedFrom !== undefined && s.rows().some((r) => r.exerciseKey === c.key && r.logId !== null))) reached.dropStateAfterSwap++
  const corrections = how === 'reopen' ? s.reopen() : s.reload()
  for (const c of s.lastCorrections) expect(c.was, `${label}: the correction of ${c.id} writes only where the numbers differ`).not.toBe(c.setNumber)
  if (corrections.length > 0) reached.correctionsWritten++
  // and no card lists anything now: every added set is its log's or its draft's
  for (const c of s.cards) expect(c.added ?? [], `${label}: ${c.key}'s list after a ${how}`).toEqual([])
  const left = differing(s)
  const rows = s.rows()
  for (const id of left) expect(afterOpenAdded(s, rows, rows.find((r) => r.logId === id)!), `${label}: the ${how}'s draw left ${id} wrong with no open added set before it`).toBe(true)
  return left
}

type Op = 'add' | 'addWarmup' | 'log' | 'logNext' | 'logWarmup' | 'warmup' | 'type' | 'delete' | 'unlogSet' | 'unlogWarmup' | 'unlogDrop' | 'reopen' | 'reload' | 'swap'

const OPS: Record<Mode, readonly Op[]> = {
  mixed: ['add', 'add', 'addWarmup', 'log', 'log', 'log', 'logNext', 'logNext', 'logWarmup', 'warmup', 'warmup', 'warmup', 'type', 'type', 'delete', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogWarmup', 'unlogDrop', 'reopen', 'reload', 'swap'],
  added: ['add', 'add', 'addWarmup', 'log', 'log', 'log', 'log', 'logNext', 'logWarmup', 'warmup', 'warmup', 'warmup', 'warmup', 'warmup', 'warmup', 'type', 'type', 'type', 'delete', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogWarmup', 'unlogDrop', 'reopen', 'reload'],
  warmups: ['add', 'addWarmup', 'addWarmup', 'log', 'log', 'log', 'logWarmup', 'logWarmup', 'warmup', 'warmup', 'warmup', 'warmup', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogWarmup', 'unlogWarmup', 'reopen', 'reload'],
  phones: ['add', 'add', 'addWarmup', 'log', 'log', 'log', 'logWarmup', 'warmup', 'warmup', 'type', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogWarmup', 'reopen', 'reopen', 'reload', 'reload'],
  staged: ['add', 'addWarmup', 'log', 'log', 'log', 'log', 'logWarmup', 'warmup', 'warmup', 'warmup', 'type', 'type', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogWarmup', 'unlogDrop', 'reopen', 'reload'],
  swaps: ['add', 'add', 'addWarmup', 'log', 'log', 'log', 'log', 'logNext', 'warmup', 'warmup', 'type', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogWarmup', 'reopen', 'reload', 'swap', 'swap', 'swap', 'swap'],
  old: ['add', 'log', 'log', 'log', 'logNext', 'warmup', 'type', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'reopen', 'reload', 'swap'],
}

/** The exercise a card's logs carry, as the name a swap takes (`ex.<name>`). */
const nameOf = (exerciseId: string): string => exerciseId.replace(/^ex\./, '')

/** One generated sequence: `steps` steps from the seed, each checked. Returns what it did. */
function sequence(seed: number, steps: number, mode: Mode): string[] {
  const g = generator(seed)
  const s = startOf(START[mode], mode === 'old')
  const trace: string[] = [`seed ${seed} (${mode})`]
  const label = (step: number) => `seed ${seed} (${mode}), step ${step}\n${trace.join('\n')}`
  // the screen draws the session when it opens it: 1.1's numbers on the sets added before 1.2 are corrected (178)
  let stale = drawAfter(s, label(0), new Set(), new Set([...oldLogIds(s, 'bench'), ...oldLogIds(s, 'curl')]))
  check(s, label(0), stale)
  let values = 0
  const nextValues = () => {
    values++
    return { weight: 40 + (values % 13) * 2.5, reps: 5 + (values % 7), rir: values % 4 }
  }
  for (let step = 1; step <= steps; step++) {
    const rows = s.rows()
    const op = g.pick(OPS[mode])
    const heads = rows.filter((r) => r.kind !== 'stage' && r.state !== 'skipped')
    // an open row that can be logged now: a set, or a drop whose set is logged
    const loggable = rows.filter((r) => r.state === 'unlogged' && (r.kind !== 'stage' || rows.some((h) => h.key === r.headKey && h.logId !== null)))
    const swapped = (key: string) => s.card(key).swappedFrom !== undefined
    const before = (r: ResolvedRow) => rows.some((x) => x.slotKey === r.slotKey && x.exerciseKey !== r.exerciseKey && x.planIndex > r.planIndex && x.logId !== null)
    let allowed = new Set<string>()
    if (op === 'add' || op === 'addWarmup') {
      const key = g.pick(s.cards.map((c) => c.key))
      if (rows.some((r) => r.exerciseKey === key && r.added && r.kind !== 'stage' && r.logId !== null && !lists(s.cards, r))) reached.addAfterReopen++
      const rowKey = s.add(key)
      // + ADD SET writes nothing: the logged sets after it in its slot (a card a swap made, after the card it replaced) show one more
      const at = s.rows().find((r) => r.key === rowKey)!
      allowed = new Set(s.rows().filter((r) => r.slotKey === at.slotKey && r.planIndex > at.planIndex && r.logId !== null).map((r) => r.logId!))
      // there is no "add a warmup" action (SPEC 5a): ADD SET, then SET TYPE → Warmup
      if (op === 'addWarmup') s.retype(rowKey, WARMUP)
      trace.push(`${op === 'add' ? 'add' : 'add-warmup'} ${rowKey}`)
    } else if ((op === 'log' || op === 'logNext' || op === 'logWarmup') && loggable.length > 0) {
      const pool = op === 'logWarmup' ? loggable.filter((r) => r.kind === 'warmup') : loggable
      if (pool.length === 0) continue
      // after a reload, the sets only a draft holds are logged often (the card takes each in first), and so are a swap's
      const draftOnly = pool.filter((r) => r.added && r.kind !== 'stage' && r.draftKey !== null && !lists(s.cards, r))
      const onSwapped = pool.filter((r) => swapped(r.exerciseKey))
      const row = op === 'logNext' ? pool[0] : draftOnly.length > 0 && g.chance(0.6) ? g.pick(draftOnly) : onSwapped.length > 0 && g.chance(0.5) ? g.pick(onSwapped) : g.pick(pool)
      if (row.added && row.kind !== 'stage' && !lists(s.cards, row)) reached.logDraftNotListed++
      if (swapped(row.exerciseKey)) reached.logOnSwappedCard++
      if (row.added && row.kind !== 'stage' && row.addedPlace === null) allowed = oldLogIds(s, row.exerciseKey)
      const empty = row.kind === 'warmup' && g.chance(0.5)
      const log = s.log(row.key, empty ? { weight: null, reps: null, rir: null } : nextValues())
      if (row.added && row.kind !== 'stage' && row.addedPlace === null) allowed = new Set([...allowed, log.id])
      trace.push(`log ${row.key}${empty ? ' (empty)' : ''}`)
    } else if (op === 'warmup' && heads.length > 0) {
      // the switch to or from Warmup, on any set: an added one as often as not, and an open added Warmup back to working often
      const openAddedWarmups = heads.filter((r) => r.added && r.kind === 'warmup' && r.logId === null)
      // …and one before a logged working set of its card as often as the session has one
      const beforeLogged = openAddedWarmups.filter((r) => rows.some((x) => x.exerciseKey === r.exerciseKey && x.kind === 'working' && x.logId !== null && x.planIndex > r.planIndex))
      const pool =
        mode !== 'mixed' && beforeLogged.length > 0 && g.chance(0.7)
          ? beforeLogged
          : mode !== 'mixed' && openAddedWarmups.length > 0 && g.chance(0.3)
            ? openAddedWarmups
            : mode !== 'mixed' && g.chance(0.5)
              ? heads.filter((r) => r.added)
              : heads
      if (pool.length === 0) continue
      const row = g.pick(pool)
      const pick: SessionSetChangeType = row.kind === 'warmup' ? (g.chance(0.8) ? NORMAL : staged('dropset', 1)) : WARMUP
      const shape = openAddedAfter(rows, row)
      if (shape.count >= 2) reached.switchBeforeTwoOpenAdded++
      if (shape.drafted) reached.switchBeforeUnloggedAdded++
      if (row.added && row.kind === 'warmup' && row.logId === null && rows.some((r) => r.exerciseKey === row.exerciseKey && r.kind === 'working' && r.logId !== null && r.planIndex > row.planIndex)) {
        reached.addedWarmupMadeWorkingBeforeLogged++
      }
      if (swapped(row.exerciseKey)) reached.editOnSwappedCard++
      if (before(row)) reached.editBeforeSwappedCard++
      const effects = s.retype(row.key, pick)
      if (effects.renumber.some((p) => s.server.logs.find((l) => l.id === p.id)?.isWarmup)) reached.warmupLogMoved++
      trace.push(`${pick.kind === 'warmup' ? 'warmup' : 'from-warmup'} ${row.key}${pick.kind === 'staged' ? ' (a dropset)' : ''}`)
    } else if (op === 'type' && heads.length > 0) {
      const pool = mode !== 'mixed' && g.chance(0.7) ? heads.filter((r) => r.added) : heads
      if (pool.length === 0) continue
      const row = g.pick(pool)
      const pick = g.pick([NORMAL, staged('dropset', g.chance(0.5) ? 1 : 2), staged('rest_pause', 2), staged('cluster', 1), WARMUP] as const)
      const effects = s.retype(row.key, pick)
      if (effects.renumber.some((p) => s.server.logs.find((l) => l.id === p.id)?.isWarmup)) reached.warmupLogMoved++
      trace.push(`type ${row.key} ${JSON.stringify(pick)}`)
    } else if (op === 'delete' && rows.length > 0) {
      // a set more often than a drop, and one with open added sets after it as often as the session has one, and one before a
      // card a swap made, or on one, as often as the session has one
      const opened = rows.filter((r) => r.kind !== 'stage' && openAddedAfter(rows, r).count > 0)
      const aroundSwap = rows.filter((r) => r.kind !== 'stage' && (swapped(r.exerciseKey) || before(r)))
      const row = aroundSwap.length > 0 && g.chance(0.4) ? g.pick(aroundSwap) : opened.length > 0 && g.chance(0.6) ? g.pick(opened) : g.pick(rows)
      if (row.kind === 'working') {
        const shape = openAddedAfter(rows, row)
        if (shape.count >= 2) reached.deleteBeforeTwoOpenAdded++
        if (shape.drafted) reached.deleteBeforeUnloggedAdded++
      }
      if (swapped(row.exerciseKey)) reached.editOnSwappedCard++
      if (before(row)) reached.editBeforeSwappedCard++
      const effects = s.delete(row.key)
      if (effects.renumber.some((p) => s.server.logs.find((l) => l.id === p.id)?.isWarmup)) reached.warmupLogMoved++
      trace.push(`delete ${row.key}`)
    } else if (op === 'unlogSet' || op === 'unlogWarmup') {
      const every = rows.filter((r) => r.kind !== 'stage' && r.state === 'logged' && s.canUnlog(r.key) && (op === 'unlogSet' || r.kind === 'warmup'))
      const oldOnes = every.filter((r) => r.added && r.addedPlace === null)
      const pool = mode === 'old' && oldOnes.length > 0 && g.chance(0.6) ? oldOnes : mode !== 'mixed' && every.some((r) => r.added) && g.chance(0.8) ? every.filter((r) => r.added) : every
      if (pool.length === 0) continue
      // a staged added set as often as the session has one (161: its draft brings its drops back)
      const stagedAdded = pool.filter((r) => r.added && r.type?.kind === 'staged')
      const row = stagedAdded.length > 0 && g.chance(0.8) ? g.pick(stagedAdded) : g.pick(pool)
      if (row.added && row.kind === 'warmup') reached.unlogAddedWarmup++
      if (!row.added && row.kind === 'warmup') reached.unlogPlannedWarmup++
      if (row.added && row.type?.kind === 'staged') reached.unlogAddedStaged++
      if (row.added && !lists(s.cards, row)) reached.unlogNotListed++
      if (row.added && row.addedPlace === null) reached.unlogOld++
      if (row.added && rows.some((r) => r.exerciseKey === row.exerciseKey && r.added && r.state === 'unlogged' && r.kind !== 'stage' && r.planIndex < row.planIndex)) reached.unlogWithOpenAddedBefore++
      if (row.added && row.kind === 'warmup' && rows.some((r) => r.exerciseKey === row.exerciseKey && r.added && r.kind === 'warmup' && r.key !== row.key)) reached.unlogWithAnotherAddedWarmup++
      trace.push(`unlog ${row.key}`)
      unlogExactly(s, row.key, label(step), stale)
    } else if (op === 'unlogDrop') {
      const drops = rows.filter((r) => r.kind === 'stage' && r.state === 'logged' && s.canUnlog(r.key))
      if (drops.length === 0) continue
      const row = g.pick(drops)
      trace.push(`unlog ${row.key}`)
      s.unlog(row.key)
    } else if (op === 'reopen' || op === 'reload') {
      trace.push(op)
      stale = dropState(s, op, label(step))
      check(s, label(step), stale)
      continue
    } else if (op === 'swap') {
      // a card with an open set (but none added before 1.2: the record can't name it) swapped for today
      const open = (key: string) => rows.filter((r) => r.exerciseKey === key && r.kind !== 'stage' && r.state === 'unlogged')
      const from = s.cards.filter((c) => open(c.key).length > 0 && !open(c.key).some((r) => r.added && r.addedPlace === null))
      if (from.length === 0) continue
      const card_ = g.pick(from)
      // to a new exercise, one the session already has, or the exercise its slot began with again
      const root = s.card(s.slotOf.get(card_.key)!)
      const others = [...new Set(s.cards.map((c) => c.exerciseId))].filter((id) => id !== card_.exerciseId)
      const pool = [
        ...ELSEWHERE.map((n) => `ex.${n}`),
        ...others,
        ...(root.exerciseId !== card_.exerciseId ? [root.exerciseId, root.exerciseId] : []),
      ].filter((id) => id !== card_.exerciseId)
      // …and, from a card a swap already moved sets from, into the card it made as often as not (183's follow-up)
      const madeBefore = s.cards.filter((c) => c.swappedFrom?.fromKey === card_.key).map((c) => c.exerciseId)
      const to = madeBefore.length > 0 && g.chance(0.5) ? g.pick(madeBefore) : g.pick(pool)
      const theOpen = open(card_.key)
      if (theOpen.some((r) => rows.some((x) => x.exerciseKey === card_.key && x.logId !== null && x.planIndex > r.planIndex))) reached.swapOpenBeforeLogged++
      if (rows.some((r) => r.exerciseId === to && r.added && r.kind !== 'stage')) reached.swapIntoExerciseWithAdded++
      if (s.cards.some((c) => c.exerciseId === to && s.slotOf.get(c.key) !== s.slotOf.get(card_.key))) reached.swapIntoSessionExercise++
      if (to === root.exerciseId && root.key !== card_.key) reached.swapBackToOriginal++
      if (s.cards.some((c) => c.swappedFrom?.fromKey === card_.key && c.exerciseId === to)) reached.swapIntoSameCardAgain++
      const slot = s.slotOf.get(card_.key)!
      const logsBefore = new Map(s.server.logs.map((l) => [l.id, l.setNumber]))
      const shownBefore = new Map(rows.filter((r) => r.logId !== null).map((r) => [r.logId!, r.number]))
      const madeKey = s.swap(card_.key, nameOf(to))
      // the open sets left their card and moved, each with its type; no logged set outside the slot shows another number
      const after = s.rows()
      for (const r of theOpen) expect(after.some((x) => x.key === r.key), `${label(step)}: ${r.key} moved, and its card draws no row for it`).toBe(false)
      const movedKeys = s.card(madeKey).added!.slice(-theOpen.length).map((e) => `added:${madeKey}:${e.localId}`)
      expect(movedKeys.map((k) => after.find((x) => x.key === k)?.type), `${label(step)}: the moved sets keep their types`).toEqual([...theOpen].sort((a, b) => a.planIndex - b.planIndex).map((r) => r.type))
      for (const r of after) {
        if (r.logId === null || s.slotOf.get(r.exerciseKey) === slot || !shownBefore.has(r.logId)) continue
        expect(r.number, `${label(step)}: the swap renumbered ${r.key}, outside its slot`).toBe(shownBefore.get(r.logId))
      }
      allowed = new Set(after.filter((r) => r.slotKey === slot && r.logId !== null && logsBefore.get(r.logId) !== r.number).map((r) => r.logId!))
      trace.push(`swap ${card_.key} ${nameOf(to)} -> ${madeKey}`)
    } else continue
    stale = drawAfter(s, label(step), stale, allowed)
    check(s, label(step), stale)
  }
  return trace
}

describe('generated sequences of add, log, unlog, delete, Warmup switches, reopens, reloads and swaps (DECISIONS 170, 173, 178, 183, 184, 185)', () => {
  // Each of these runs thousands of checked steps: they are given a few minutes.
  const LONG = { timeout: 600_000 }

  it('cards that start with their plan: after every step the numbers read 1 to n in each slot, every set is where it was, every log holds its row\'s number, and every unlog is undone exactly', LONG, () => {
    let steps = 0
    for (let seed = 1; seed <= 250; seed++) steps += sequence(seed, 24, 'mixed').length - 1
    expect(steps).toBeGreaterThan(4000)
  })

  it('…with sets added to every card from the start (some made Warmups), switched, logged out of order, unlogged, deleted around, swapped, the session reopened and reloaded, and sets added before 1.2', LONG, () => {
    let steps = 0
    for (const key of Object.keys(reached) as Array<keyof typeof reached>) reached[key] = 0
    for (let seed = 1001; seed <= 1300; seed++) steps += sequence(seed, 28, 'added').length - 1
    // …with two of the three made Warmups as soon as they were added
    for (let seed = 2001; seed <= 2200; seed++) steps += sequence(seed, 28, 'warmups').length - 1
    // …with the phone's state dropped often (a reopen: the list and the drafts; a reload: the list)
    for (let seed = 3001; seed <= 3200; seed++) steps += sequence(seed, 28, 'phones').length - 1
    // …and with the first set added to each card a dropset, then a Warmup and a working set
    for (let seed = 4001; seed <= 4150; seed++) steps += sequence(seed, 28, 'staged').length - 1
    // …with swaps for today often: to a new exercise, to one the session has, back to the slot's own, into a card again (183)
    for (let seed = 5001; seed <= 5250; seed++) steps += sequence(seed, 30, 'swaps').length - 1
    // …and with sets added before 1.2 on two cards, unlogged and logged again often (184)
    for (let seed = 6001; seed <= 6200; seed++) steps += sequence(seed, 28, 'old').length - 1
    expect(steps).toBeGreaterThan(25000)
    // the sequences got to every case the fourth review's sequences are made of, DECISIONS 161's, 173's, 178's and 183–185's
    expect(Object.entries(reached).filter(([, count]) => count <= 30), `the cases barely reached (${JSON.stringify(reached)})`).toEqual([])
  })

  it('every kind of step happens, and the same seed gives the same sequence', LONG, () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 80; seed++) for (const step of sequence(seed, 24, 'mixed').slice(1)) kinds.add(step.split(' ')[0])
    expect([...kinds].sort()).toEqual(['add', 'add-warmup', 'delete', 'from-warmup', 'log', 'reload', 'reopen', 'swap', 'type', 'unlog', 'warmup'])
    expect(sequence(77, 24, 'added')).toEqual(sequence(77, 24, 'added'))
    expect(sequence(3077, 28, 'phones')).toEqual(sequence(3077, 28, 'phones'))
    expect(sequence(5077, 30, 'swaps')).toEqual(sequence(5077, 30, 'swaps'))
  })
})
