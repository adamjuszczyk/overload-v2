import { describe, expect, it } from 'vitest'
import type { SessionSetChangeType, SetLog } from '../../types'
import { currentSet, finishWarning, lockDecision, type ResolvedRow } from './workoutRules'
import { Session } from './workoutRules.session.testutil'
import { brief, card, headLog, staged } from './workoutRules.testutil'

// Chunk 46, fifth attempt: DECISIONS 170 (Adam, 2026-10-18): "Set numbers are never claimed or stored per rule. Each set has a
// fixed place in the session order: planned sets by planned position, added sets by when they were added. A set's displayed
// number is its rank among the non-deleted, non-warmup working sets in that order (warmups numbered apart, as now). LOG stores
// the number the row shows; a delete or warmup switch that changes logged sets' numbers patches them, as 146 (a) already
// writes." Its verification: "a sequence test: many generated sequences of add, log, unlog, delete and warmup switches,
// asserting after every step that numbers are contiguous with no duplicates, every set's identity and order are unchanged,
// and unlog then log is an exact undo."
//
// Every step is the module's own answer applied as the card and the sync queue will (`Session`). The fixed cases are the
// fourth review's four sequences (D, W, 2D, MR), the fourth attempt's own unlog case, and DECISIONS 161's; the generated
// sequences come from a seeded generator, so a failure names its seed and its steps.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const

/** A card's head rows as the user reads them, each named by who it is: "P2" a planned set (its plan index), else the added set's id. */
function read(s: Session, cardKey: string): string[] {
  return s
    .rows()
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    .map((r) => `${brief(r).split(' ')[1]}=${r.added ? r.localId : `P${r.key.split('.').pop()}`}`)
}

/** The numbers the logs hold, by who they are (warmups and drops left out). */
function stored(s: Session, cardKey: string): string[] {
  return s
    .rows()
    .filter((r) => r.exerciseKey === cardKey && r.kind === 'working' && r.logId !== null)
    .map((r) => `${r.added ? r.localId : `P${r.key.split('.').pop()}`}:${s.server.logs.find((l) => l.id === r.logId)!.setNumber}`)
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

  it('W: the same, with 02 made a Warmup: A 03, B 04', () => {
    const s = bench('n n n', [1, 2, 3], ['A', 'B'])
    s.log('added:bench:A')
    s.unlog('added:bench:A')
    s.retype('set:bench.2', WARMUP)
    expect(read(s, 'bench')).toEqual(['W1✓=P2', '01✓=P1', '02✓=P3', '03·=A', '04·=B'])
    expect(stored(s, 'bench')).toEqual(['P1:1', 'P3:2'])
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
    const effects = s.unlog('added:bench:A')
    expect(read(s, 'bench')).toEqual(['W1·=A', '01✓=P1', '02✓=P2', '03✓=P3', '04·=B'])
    expect(currentSet(s.order(), s.server.logs, s.server.held())!.key).toBe('added:bench:B')
    s.relog('added:bench:A', effects.draft)
    expect(read(s, 'bench')).toEqual(['W1✓=A', '01✓=P1', '02✓=P2', '03✓=P3', '04·=B'])
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
    expect(stored(s, 'bench')).toEqual(['P1:1', 'P2:2', 'P3:3', 'B:4'])
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
const ADDABLE = ['bench', 'row', 'lat', 'curl'] as const

/**
 * A session of four cards: bench with two warmups and drops, a superset of two, a plain card; `added` sets added to each from
 * the start, of the types given in turn (made so right after ADD SET).
 */
function startOf(added: readonly SessionSetChangeType[]): Session {
  const s = new Session([card('bench', 'w w d2 n n d1'), card('row', 'n d1 n'), card('lat', 'n d1 n'), card('curl', 'n n n')], WALK_BLOCKS)
  for (const key of ADDABLE) {
    added.forEach((type, i) => {
      const rowKey = s.add(key, `${key}${i + 1}`)
      if (type.kind !== 'normal') s.retype(rowKey, type)
    })
  }
  return s
}

type Mode = 'mixed' | 'added' | 'warmups'
const START: Record<Mode, readonly SessionSetChangeType[]> = { mixed: [], added: [NORMAL, NORMAL, NORMAL], warmups: [WARMUP, NORMAL, WARMUP] }

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
}

/** What the user reads off a row, and which set it is: compared before and after a step that must move nothing. */
const reading = (r: ResolvedRow) => [r.key, r.kind, r.number, r.type, r.stageNumber, r.state] as const

/** The stored logs without what a new log can't keep (its id, when it was logged) and a warmup's number, which nothing keeps (as now). */
function storedLogs(logs: readonly SetLog[], rows: readonly ResolvedRow[]) {
  const whose = (id: string | null) => rows.find((r) => r.logId === id)?.key ?? id
  return logs
    .map((l) => JSON.stringify({ ...l, id: whose(l.id), parentSetId: whose(l.parentSetId), loggedAt: null, setNumber: l.isWarmup ? null : l.setNumber }))
    .sort()
}

/**
 * What must hold after every step (DECISIONS 170's three, and the rules around them). `s.places` is the sequence's own record
 * of where each set is; the module never sees it.
 */
function check(s: Session, label: string): void {
  const rows = s.rows()
  expect(new Set(rows.map((r) => r.key)).size, `${label}: row keys are unique`).toBe(rows.length)
  for (const [cardKey, places] of s.places) {
    const heads = rows.filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    // every set's identity and order are unchanged: the sets are the ones the session holds, in their places
    expect([...heads].sort((a, b) => a.planIndex - b.planIndex).map((r) => r.key), `${label}: the sets of ${cardKey} in their places`).toEqual(places)
    // …and drawn in that order: the card's warmups, then its working sets
    const kinds = new Map(heads.map((r) => [r.key, r.kind]))
    expect(heads.map((r) => r.key), `${label}: ${cardKey} drawn in order`).toEqual([...places.filter((k) => kinds.get(k) === 'warmup'), ...places.filter((k) => kinds.get(k) === 'working')])
    // numbers are contiguous with no duplicates: the working sets read 1 to n, the warmups 1 to m
    const working = heads.filter((r) => r.kind === 'working')
    const warmups = heads.filter((r) => r.kind === 'warmup')
    expect(working.map((r) => r.number), `${label}: the working sets of ${cardKey}`).toEqual(working.map((_, i) => i + 1))
    expect(warmups.map((r) => r.number), `${label}: the warmups of ${cardKey}`).toEqual(warmups.map((_, i) => i + 1))
    // LOG stores the number the row shows, and every writer that moves numbers keeps it so: a logged working set and its drops
    for (const r of rows.filter((x) => x.exerciseKey === cardKey && x.logId !== null)) {
      const log = s.server.logs.find((l) => l.id === r.logId)!
      if (r.kind === 'working' || (r.kind === 'stage' && kinds.get(r.headKey!) === 'working')) {
        expect(log.setNumber, `${label}: ${r.key} shows ${r.number} and its log holds ${log.setNumber}`).toBe(r.number)
      }
    }
    // an open added set's row names its own draft, never another set's
    for (const r of heads) if (r.draftKey !== null) expect(r.draftKey.localId, `${label}: ${r.key}'s draft`).toBe(r.localId)
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

/** After `row` (a set) in its card, the open added sets: how many, and whether one of them keeps a draft. */
function openAddedAfter(rows: readonly ResolvedRow[], row: ResolvedRow) {
  const after = rows.filter((r) => r.exerciseKey === row.exerciseKey && r.kind !== 'stage' && r.added && r.state === 'unlogged' && r.planIndex > row.planIndex)
  return { count: after.length, drafted: after.some((r) => r.draftKey !== null) }
}

/**
 * UNLOG on the row `key`, checked as 170 asks: the unlog itself moves nothing (every row reads as it did, the set itself open
 * again), and on a copy, logging it again with its draft is an exact undo (the rows, the stored logs, the change rows).
 */
function unlogExactly(s: Session, key: string, label: string): void {
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
    // the draft holds the type (161), and the card keeps the same one
    expect('type' in effects.draft.values && effects.draft.values.type, `${label}: the draft of ${key}`).toEqual(set.type)
    expect(s.cardOf(key).added!.find((a) => a.localId === set.localId)!.type, `${label}: the card's type for ${key}`).toEqual(set.type)
  }
  // logging it again on a copy restores what was there
  const t = s.copy()
  t.relog(key, effects.draft)
  const relogged = t.rows()
  expect(relogged.map(reading), `${label}: unlog and log of ${key} gives back the rows`).toEqual(before.map(reading))
  expect(storedLogs(t.server.logs, relogged), `${label}: unlog and log of ${key} gives back the stored sets`).toEqual(storedLogs(logsBefore, before))
  const kept = (changes: ReturnType<Session['server']['held']>) => changes.filter((c) => c.kind !== 'pending_stages')
  expect(kept(t.server.held()), `${label}: unlog and log of ${key} leaves the change rows`).toEqual(kept(changesBefore))
  reached.exactUndo++
}

type Op = 'add' | 'log' | 'logNext' | 'warmup' | 'type' | 'delete' | 'unlogSet' | 'unlogDrop'

const OPS: Record<Mode, readonly Op[]> = {
  mixed: ['add', 'add', 'log', 'log', 'log', 'logNext', 'logNext', 'warmup', 'warmup', 'warmup', 'type', 'type', 'delete', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogDrop'],
  added: ['add', 'add', 'log', 'log', 'log', 'log', 'logNext', 'warmup', 'warmup', 'warmup', 'warmup', 'warmup', 'warmup', 'type', 'type', 'type', 'delete', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogDrop'],
  warmups: ['add', 'log', 'log', 'log', 'log', 'warmup', 'warmup', 'warmup', 'warmup', 'delete', 'delete', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet'],
}

/** One generated sequence: `steps` steps from the seed, each checked. Returns what it did. */
function sequence(seed: number, steps: number, mode: Mode): string[] {
  const g = generator(seed)
  const s = startOf(START[mode])
  const trace: string[] = [`seed ${seed} (${mode})`]
  const label = (step: number) => `seed ${seed} (${mode}), step ${step}\n${trace.join('\n')}`
  check(s, label(0))
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
    if (op === 'add') {
      const key = g.pick(ADDABLE)
      trace.push(`add ${s.add(key)}`)
    } else if ((op === 'log' || op === 'logNext') && loggable.length > 0) {
      const row = op === 'logNext' ? loggable[0] : g.pick(loggable)
      const empty = row.kind === 'warmup' && g.chance(0.5)
      s.log(row.key, empty ? { weight: null, reps: null, rir: null } : nextValues())
      trace.push(`log ${row.key}${empty ? ' (empty)' : ''}`)
    } else if (op === 'warmup' && heads.length > 0) {
      // the switch to or from Warmup, on any set: an added one as often as not, and an open added Warmup back to working often
      const openAddedWarmups = heads.filter((r) => r.added && r.kind === 'warmup' && r.logId === null)
      const pool =
        mode !== 'mixed' && openAddedWarmups.length > 0 && g.chance(0.3) ? openAddedWarmups : mode !== 'mixed' && g.chance(0.5) ? heads.filter((r) => r.added) : heads
      if (pool.length === 0) continue
      const row = g.pick(pool)
      const pick: SessionSetChangeType = row.kind === 'warmup' ? (g.chance(0.8) ? NORMAL : staged('dropset', 1)) : WARMUP
      const shape = openAddedAfter(rows, row)
      if (shape.count >= 2) reached.switchBeforeTwoOpenAdded++
      if (shape.drafted) reached.switchBeforeUnloggedAdded++
      if (row.added && row.kind === 'warmup' && row.logId === null && rows.some((r) => r.exerciseKey === row.exerciseKey && r.kind === 'working' && r.logId !== null && r.planIndex > row.planIndex)) {
        reached.addedWarmupMadeWorkingBeforeLogged++
      }
      s.retype(row.key, pick)
      trace.push(`${pick.kind === 'warmup' ? 'warmup' : 'from-warmup'} ${row.key}${pick.kind === 'staged' ? ' (a dropset)' : ''}`)
    } else if (op === 'type' && heads.length > 0) {
      const pool = mode !== 'mixed' && g.chance(0.7) ? heads.filter((r) => r.added) : heads
      if (pool.length === 0) continue
      const row = g.pick(pool)
      const pick = g.pick([NORMAL, staged('dropset', g.chance(0.5) ? 1 : 2), staged('rest_pause', 2), staged('cluster', 1), WARMUP] as const)
      s.retype(row.key, pick)
      trace.push(`type ${row.key} ${JSON.stringify(pick)}`)
    } else if (op === 'delete' && rows.length > 0) {
      // a set more often than a drop, and one with open added sets after it as often as the session has one
      const before = rows.filter((r) => r.kind !== 'stage' && openAddedAfter(rows, r).count > 0)
      const row = before.length > 0 && g.chance(0.6) ? g.pick(before) : g.pick(rows)
      if (row.kind === 'working') {
        const shape = openAddedAfter(rows, row)
        if (shape.count >= 2) reached.deleteBeforeTwoOpenAdded++
        if (shape.drafted) reached.deleteBeforeUnloggedAdded++
      }
      s.delete(row.key)
      trace.push(`delete ${row.key}`)
    } else if (op === 'unlogSet') {
      const every = rows.filter((r) => r.kind !== 'stage' && r.state === 'logged' && s.canUnlog(r.key))
      const pool = mode !== 'mixed' && every.some((r) => r.added) && g.chance(0.8) ? every.filter((r) => r.added) : every
      if (pool.length === 0) continue
      const row = g.pick(pool)
      if (row.added && row.kind === 'warmup') reached.unlogAddedWarmup++
      if (row.added && row.type?.kind === 'staged') reached.unlogAddedStaged++
      if (row.added && rows.some((r) => r.exerciseKey === row.exerciseKey && r.added && r.state === 'unlogged' && r.kind !== 'stage' && r.planIndex < row.planIndex)) reached.unlogWithOpenAddedBefore++
      if (row.added && row.kind === 'warmup' && rows.some((r) => r.exerciseKey === row.exerciseKey && r.added && r.kind === 'warmup' && r.key !== row.key)) reached.unlogWithAnotherAddedWarmup++
      trace.push(`unlog ${row.key}`)
      unlogExactly(s, row.key, label(step))
    } else if (op === 'unlogDrop') {
      const drops = rows.filter((r) => r.kind === 'stage' && r.state === 'logged' && s.canUnlog(r.key))
      if (drops.length === 0) continue
      const row = g.pick(drops)
      trace.push(`unlog ${row.key}`)
      s.unlog(row.key)
    } else continue
    check(s, label(step))
  }
  return trace
}

describe('generated sequences of add, log, unlog, delete and Warmup switches (DECISIONS 170)', () => {
  // Each of these runs thousands of checked steps: they are given a minute.
  const LONG = { timeout: 60_000 }

  it('cards that start with their plan: after every step the numbers read 1 to n, every set is where it was, and every unlog is undone exactly', LONG, () => {
    let steps = 0
    for (let seed = 1; seed <= 250; seed++) steps += sequence(seed, 24, 'mixed').length - 1
    expect(steps).toBeGreaterThan(4000)
  })

  it('…with three sets added to every card from the start, whose types are switched, logged out of order, unlogged and deleted around', LONG, () => {
    let steps = 0
    for (const key of Object.keys(reached) as Array<keyof typeof reached>) reached[key] = 0
    for (let seed = 1001; seed <= 1300; seed++) steps += sequence(seed, 28, 'added').length - 1
    // …and with two of the three made Warmups as soon as they were added
    for (let seed = 2001; seed <= 2200; seed++) steps += sequence(seed, 28, 'warmups').length - 1
    expect(steps).toBeGreaterThan(10000)
    // the sequences got to every case the fourth review's sequences are made of, and DECISIONS 161's
    expect(Object.entries(reached).filter(([, count]) => count <= 30), `the cases barely reached (${JSON.stringify(reached)})`).toEqual([])
  })

  it('every kind of step happens, and the same seed gives the same sequence', LONG, () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) for (const step of sequence(seed, 24, 'mixed').slice(1)) kinds.add(step.split(' ')[0])
    expect([...kinds].sort()).toEqual(['add', 'delete', 'from-warmup', 'log', 'type', 'unlog', 'warmup'])
    expect(sequence(77, 24, 'added')).toEqual(sequence(77, 24, 'added'))
  })
})
