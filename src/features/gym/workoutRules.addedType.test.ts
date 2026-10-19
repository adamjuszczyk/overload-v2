import { describe, expect, it } from 'vitest'
import {
  addRound,
  applySetTypeChange,
  canUnlog,
  currentSet,
  deleteEffects,
  finishWarning,
  lockDecision,
  resolveRows,
  typeColumns,
  unlogEffects,
  type AddedSet,
  type AddedSetDraft,
  type AddedSetKey,
  type HeldDraft,
  type OrderExercise,
  type ResolvedRow,
  type UnlogEffects,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import {
  addedLog,
  brief,
  card,
  deepFreeze,
  deletedAdded,
  draftOf,
  headLog,
  keepType,
  loggedAdded,
  orderOf,
  pending,
  rowKeyed,
  staged,
  unloggedAdded,
  viewOf,
} from './workoutRules.testutil'

// Chunk 46: DECISIONS 161 (Adam, 2026-10-16): "go ahead with chunk 46's fourth attempt, with (b)(i): an added set's draft also
// keeps its type, so an unlog is undone exactly and nothing moves; 46's rules see every added set's type", with DECISIONS 170
// (Adam, 2026-10-18): "Each set has a fixed place in the session order: planned sets by planned position, added sets by when
// they were added."
//
// A set added in the session (ADD SET, ADD ROUND) is an entry of the card's list (`OrderExercise.added`), in the order the sets
// were added, with the type the card keeps for it; its draft holds the type once it is unlogged. Every fixture here has the same
// sets twice, once with an added Warmup and once with an added working set in the same place, so a rule that cannot tell them
// apart fails one of the pair. Expected values are written out by hand.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const
const SESSION = 's1'

/** The key of the draft the added set `localId` of `bench` leaves when it is unlogged showing `position`. */
const key = (position: number, localId = 'a1'): AddedSetKey => ({ sessionId: SESSION, localId, exerciseId: 'ex.bench', position })

/** The head rows (not their drops) as the screen keys and numbers them: what must not move on an unlog. */
const placesOf = (rows: readonly ResolvedRow[]) => rows.filter((r) => r.kind !== 'stage').map((r) => [r.key, r.kind, r.number, r.type] as const)

/** Bench 01–03 logged. */
const threeLogged = () => [1, 2, 3].map((i) => headLog('bench', i))

const rowsOf = (cards: OrderExercise[], logs = threeLogged(), changes: Parameters<typeof resolveRows>[2] = []) => resolveRows(orderOf(cards), logs, changes)

/** The draft an unlog of an added set answers: its type is in the values (DECISIONS 161). */
function addedDraft(effects: UnlogEffects): { key: AddedSetKey; values: AddedSetDraft } {
  const { key, values } = effects.draft
  if (!('localId' in key) || 'drop' in key || !('type' in values)) throw new Error('that is not the draft of an added set')
  return { key, values }
}

describe('the rows see an open added set\'s type (DECISIONS 161): an added Warmup is no working row', () => {
  it('two new added sets, the first a Warmup: it is W1 and never the current set; the second is 04 and is current', () => {
    const cards = [card('bench', 'n n n', { added: [WARMUP, NORMAL] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(rows[0]).toMatchObject({ key: 'added:bench:a1', kind: 'warmup', type: WARMUP, state: 'unlogged', added: true, localId: 'a1', draftKey: null })
    expect(rows[4]).toMatchObject({ key: 'added:bench:a2', kind: 'working', type: NORMAL, number: 4, localId: 'a2' })
    expect(currentSet(orderOf(cards), threeLogged())!.key).toBe('added:bench:a2')
  })

  it('…and with the types the other way round the first is the working set 04 and current, the second the Warmup', () => {
    const cards = [card('bench', 'n n n', { added: [NORMAL, WARMUP] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(rows[0]).toMatchObject({ key: 'added:bench:a2', kind: 'warmup' })
    expect(rows[4]).toMatchObject({ key: 'added:bench:a1', kind: 'working', number: 4 })
    expect(currentSet(orderOf(cards), threeLogged())!.key).toBe('added:bench:a1')
  })

  it('the lock never asks about a Warmup and never because of one: LOG on the second added set is not "before set 04"', () => {
    // review 3's executed case: the first added set made a Warmup, LOG on the second asked "Log set 05 before set 04?"
    const cards = [card('bench', 'n n n', { added: [WARMUP, NORMAL] })]
    const rows = rowsOf(cards)
    const current = currentSet(orderOf(cards), threeLogged())
    expect(lockDecision({ logInOrder: true, current, tapped: rows[4] })).toBe('log')
    expect(lockDecision({ logInOrder: true, current, tapped: rows[0] })).toBe('log')
    // three added sets, a working one before the Warmup and one after it: only the one after it asks, and not about the Warmup
    const three = [card('bench', 'n n n', { added: [NORMAL, WARMUP, NORMAL] })]
    const threeRows = rowsOf(three)
    expect(threeRows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    const currentThree = currentSet(orderOf(three), threeLogged())
    expect(currentThree!.key).toBe('added:bench:a1')
    expect(lockDecision({ logInOrder: true, current: currentThree, tapped: threeRows[5] })).toEqual({ ask: 'Log set 05 before set 04?', next: 'Bench 04', label: 'set 05' })
    expect(lockDecision({ logInOrder: true, current: currentThree, tapped: threeRows[0] })).toBe('log')
  })

  it('a Warmup is the only open row: nothing is current, and nothing is left to log in order', () => {
    const cards = [card('bench', 'n n n', { added: [WARMUP] })]
    expect(currentSet(orderOf(cards), threeLogged())).toBeNull()
    expect(rowsOf(cards).map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
  })

  it('an open added dropset has its drops as open rows after it, and the head is current', () => {
    const cards = [card('bench', 'n n n', { added: [staged('dropset', 2)] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·', 'bench 04.2·'])
    expect(rows[3]).toMatchObject({ key: 'added:bench:a1', type: staged('dropset', 2), stageKind: 'dropset' })
    expect(rows.slice(4).map((r) => [r.kind, r.headKey, r.stageNumber, r.state, r.localId])).toEqual([
      ['stage', 'added:bench:a1', 1, 'unlogged', null],
      ['stage', 'added:bench:a1', 2, 'unlogged', null],
    ])
    expect(currentSet(orderOf(cards), threeLogged())!.key).toBe('added:bench:a1')
    // and a Normal set in the same place has none
    expect(rowsOf([card('bench', 'n n n', { added: [NORMAL] })]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
  })

  it('a listed set kept as a draft has the type the card keeps for it, and its row names the draft; a draft no listed set has brings its own type', () => {
    const logs = threeLogged()
    const listed = (type: typeof WARMUP | typeof NORMAL) => [card('bench', 'n n n', { added: [type, NORMAL], drafts: [draftOf(key(4), type)] })]
    const warm = rowsOf(listed(WARMUP), logs)
    expect(warm.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(warm[0]).toMatchObject({ key: 'added:bench:a1', kind: 'warmup', draftKey: key(4) })
    expect(warm[4]).toMatchObject({ key: 'added:bench:a2', kind: 'working', draftKey: null, number: 4 })
    expect(currentSet(orderOf(listed(WARMUP)), logs)!.key).toBe('added:bench:a2')
    const working = rowsOf(listed(NORMAL), logs)
    expect(working.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    expect(working[3]).toMatchObject({ key: 'added:bench:a1', draftKey: key(4) })
    // after a reload the card lists nothing: the draft is a set of its own, with the type it holds
    const reloaded = (type: typeof WARMUP | typeof NORMAL) => rowsOf([card('bench', 'n n n', { drafts: [draftOf(key(4), type)] })], logs)
    expect(reloaded(WARMUP).map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
    expect(reloaded(NORMAL).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(rowsOf([card('bench', 'n n n', { drafts: [draftOf(key(4), staged('rest_pause', 1))] })], logs).map(brief)).toEqual([
      'bench 01✓',
      'bench 02✓',
      'bench 03✓',
      'bench 04·',
      'bench 04.1·',
    ])
  })

  it('for a listed set the card\'s type is the one read, also while its draft still says another (the card is the live state; the draft is for a reload)', () => {
    const lagging = [card('bench', 'n n n', { added: [WARMUP, NORMAL], drafts: [draftOf(key(4), NORMAL)] })]
    expect(rowsOf(lagging).map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const otherWay = [card('bench', 'n n n', { added: [NORMAL, NORMAL], drafts: [draftOf(key(4), WARMUP)] })]
    expect(rowsOf(otherWay).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
  })

  it('the type and the key belong to the set, not to a number: logging the second added set first moves neither', () => {
    // two new added sets, the first a Warmup; the screen logs the second one (as 04) and its entry names the log
    const before = [card('bench', 'n n n', { added: [WARMUP, NORMAL] })]
    const second = rowKeyed({ rows: rowsOf(before) }, 'added:bench:a2')
    const log = addedLog('bench', 2, { number: second.number })
    const cards = loggedAdded(before, second, log.id)
    expect(cards[0].added).toEqual([
      { localId: 'a1', logId: null, type: WARMUP, place: 1 },
      { localId: 'a2', logId: log.id, type: NORMAL, place: 2 },
    ])
    const rows = rowsOf(cards, [...threeLogged(), log])
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
    expect(rows[0]).toMatchObject({ key: 'added:bench:a1', kind: 'warmup' })
    expect(rows[4]).toMatchObject({ key: 'added:bench:a2', logId: log.id })
    // …and with the types the other way round, logging the first one leaves the second one\'s Warmup alone
    const swapped = [card('bench', 'n n n', { added: [NORMAL, WARMUP] })]
    const first = rowKeyed({ rows: rowsOf(swapped) }, 'added:bench:a1')
    expect(first.kind).toBe('working')
    const firstLog = addedLog('bench', 1, { number: first.number })
    const after = rowsOf(loggedAdded(swapped, first, firstLog.id), [...threeLogged(), firstLog])
    expect(after.filter((r) => r.kind === 'warmup').map((r) => r.key)).toEqual(['added:bench:a2'])
  })

  it('an added exercise\'s sets (no planned set at all) read the same way', () => {
    const cards = [card('pushdown', '', { added: [NORMAL, WARMUP] })]
    expect(resolveRows(orderOf(cards), []).map(brief)).toEqual(['pushdown W1·', 'pushdown 01·'])
  })

  it('a card\'s warmups come before its working sets in a superset block, and an added Warmup is not one of the rounds', () => {
    const cards = [card('row', 'n n', { added: [WARMUP] }), card('lat', 'n n')]
    const rows = resolveRows(orderOf(cards, [{ id: 'blk', members: ['row', 'lat'] }]), [])
    expect(rows.map(brief)).toEqual(['row W1·', 'row A1·', 'lat B1·', 'row A2·', 'lat B2·'])
    expect(currentSet(orderOf(cards, [{ id: 'blk', members: ['row', 'lat'] }]), [])!.key).toBe('set:row.1')
  })
})

describe('where the added sets sit: in the order they were added, which no log, draft or number changes (DECISIONS 170)', () => {
  it('an added set logged ahead of two newer open ones and unlogged comes back at its own number (the fourth attempt\'s executed case)', () => {
    // three sets added: the first two are open (04, 05), the third was logged ahead of them (the lock off), as 06
    const log = addedLog('bench', 3, { number: 6 })
    const cards = [card('bench', 'n n n', { added: [NORMAL, NORMAL, log] })]
    const logged = viewOf(orderOf(cards), [...threeLogged(), log])
    expect(logged.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·', 'bench 06✓'])
    const third = rowKeyed(logged, 'added:bench:a3')
    const unlog = unlogEffects(third, logged)
    expect(unlog.draft.key).toEqual(key(6, 'a3'))
    const kept = unloggedAdded(cards, third, unlog.draft)
    const rows = rowsOf(kept)
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·', 'bench 06·'])
    expect(rows.slice(3).map((r) => [r.key, r.number, r.draftKey?.position ?? null])).toEqual([
      ['added:bench:a1', 4, null],
      ['added:bench:a2', 5, null],
      ['added:bench:a3', 6, 6],
    ])
    expect(currentSet(orderOf(kept), threeLogged())!.key).toBe('added:bench:a1')
  })

  it('a Warmup added between two logged sets, never logged, made Normal: it takes its place before the later one, which moves up one (the fourth attempt\'s reading 3)', () => {
    // bench 01 logged; a1 logged as 02; a2 added as a Warmup; a3 added and logged as 03; a2 made Normal
    const a1 = addedLog('bench', 1, { number: 2 })
    const a3 = addedLog('bench', 3, { number: 3 })
    const server = new FakeServer({ logs: [headLog('bench', 1), a1, a3] })
    const cards = [card('bench', 'n', { added: [a1, WARMUP, a3] })]
    const view = viewOf(orderOf(cards), server.logs)
    expect(view.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
    const w = rowKeyed(view, 'added:bench:a2')
    const result = applySetTypeChange({ row: w, pick: NORMAL, session: view })
    expect(result.renumber).toEqual([{ id: a3.id, setNumber: 4 }])
    server.applySetType(result, w)
    const after = rowsOf(keepType(cards, w, result.type), server.logs)
    expect(after.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·', 'bench 04✓'])
    expect(after.map((r) => r.key)).toEqual(['set:bench.1', 'added:bench:a1', 'added:bench:a2', 'added:bench:a3'])
    expect(server.logs.map((l) => [l.id, l.setNumber])).toEqual([
      ['log.bench.1', 1],
      [a1.id, 2],
      [a3.id, 4],
    ])
  })

  it('two added Warmups: unlogging either moves neither, and each keeps its W number and its key (the fourth attempt\'s reading 4)', () => {
    // a1 and a2 were logged as 04 and 05 and both made Warmups (each kept the number it had: 4, and 4 again once a1 had left)
    const w1 = addedLog('bench', 1, { number: 4, warmup: true })
    const w2 = addedLog('bench', 2, { number: 4, warmup: true })
    for (const unlogged of ['a1', 'a2']) {
      const cards = [card('bench', 'n n n', { added: [{ localId: 'a1', logId: w1.id, type: WARMUP }, { localId: 'a2', logId: w2.id, type: WARMUP }] })]
      const server = new FakeServer({ logs: [...threeLogged(), w1, w2] })
      const before = viewOf(orderOf(cards), server.logs)
      expect(before.rows.map(brief)).toEqual(['bench W1✓', 'bench W2✓', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
      expect(before.rows.slice(0, 2).map((r) => r.key)).toEqual(['added:bench:a1', 'added:bench:a2'])
      const row = rowKeyed(before, `added:bench:${unlogged}`)
      const unlog = unlogEffects(row, before)
      server.applyUnlog(unlog)
      const after = viewOf(orderOf(unloggedAdded(cards, row, unlog.draft)), server.logs)
      expect(placesOf(after.rows), unlogged).toEqual(placesOf(before.rows))
      expect(rowKeyed(after, `added:bench:${unlogged}`), unlogged).toMatchObject({ state: 'unlogged', kind: 'warmup', number: unlogged === 'a1' ? 1 : 2 })
    }
  })

  it('a Warmup and a working set that hold one stored number: the card\'s order decides, whichever was logged first, and unlogging moves no key', () => {
    // the Warmup left the working numbers at 4 and the set after it closed the gap; both read 4 in the logs
    const warmLog = addedLog('bench', 1, { number: 4, warmup: true })
    const workLog = addedLog('bench', 2, { number: 4 })
    for (const logs of [[...threeLogged(), warmLog, workLog], [...threeLogged(), workLog, warmLog]]) {
      const cards = [card('bench', 'n n n', { added: [{ localId: 'a1', logId: warmLog.id, type: WARMUP }, workLog] })]
      const view = viewOf(orderOf(cards), logs)
      expect(view.rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
      expect(view.rows[0]).toMatchObject({ key: 'added:bench:a1', logId: warmLog.id, planIndex: 4 })
      expect(view.rows[4]).toMatchObject({ key: 'added:bench:a2', logId: workLog.id, planIndex: 5 })
      const unlog = unlogEffects(view.rows[0], view)
      const server = new FakeServer({ logs })
      server.applyUnlog(unlog)
      const after = viewOf(orderOf(unloggedAdded(cards, view.rows[0], unlog.draft)), server.logs)
      expect(placesOf(after.rows)).toEqual(placesOf(view.rows))
    }
  })
})

describe('what the card or a draft must say is refused when it is wrong', () => {
  it('an entry of the card\'s list without its type is refused at run time (a caller that skips the type would read Normal)', () => {
    const noType = { localId: 'a1', logId: null } as unknown as AddedSet
    const bogus = { localId: 'a1', logId: null, type: { kind: 'bogus' } } as unknown as AddedSet
    for (const entry of [noType, bogus]) expect(() => rowsOf([card('bench', 'n n n', { added: [entry] })])).toThrow(TypeError)
    // a logged entry is held to it as well: the card keeps every added set's type (the logs and the card can lag a render)
    const log = addedLog('bench', 1, { number: 4 })
    expect(() => rowsOf([card('bench', 'n n n', { added: [{ ...noType, logId: log.id }] })], [...threeLogged(), log])).toThrow(TypeError)
    expect(rowsOf([card('bench', 'n n n', { added: [NORMAL] })]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
  })

  it('a draft of an added set without its type is refused at run time, listed or not (161: the draft keeps the type)', () => {
    const noValues = { key: key(4) } as unknown as HeldDraft
    const emptyValues = { key: key(4), values: {} } as unknown as HeldDraft
    for (const draft of [noValues, emptyValues]) {
      expect(() => rowsOf([card('bench', 'n n n', { added: [NORMAL], drafts: [draft] })])).toThrow(TypeError)
      expect(() => rowsOf([card('bench', 'n n n', { drafts: [draft] })])).toThrow(TypeError)
    }
  })

  it('…and under tsc (these lines fail `npm run typecheck` if a type becomes optional)', () => {
    // Each literal holds everything else its type asks for (the place too, DECISIONS 174), so each line fails for the one
    // property it names and for nothing else.
    // @ts-expect-error an entry of the card's list must say its set's type
    const noType: AddedSet = { localId: 'a1', logId: null, place: 1 }
    // @ts-expect-error nor may it leave out whether it is logged
    const noLog: AddedSet = { localId: 'a1', type: NORMAL, place: 1 }
    // @ts-expect-error a draft of a set added in the session must say its type
    const draftNoType: HeldDraft = { key: key(4), values: { place: 4 } }
    // @ts-expect-error nor may it leave `values` out
    const draftNoValues: HeldDraft = { key: key(4) }
    // @ts-expect-error what unlogging an added set answers carries the type in its values
    const noTypeAnswered: UnlogEffects['draft'] = { key: key(4), values: { weight: 1, reps: 1, rir: null, formRating: null, enteredUnit: null, place: 4 } }
    // a planned set's draft and a drop's need no type, and the type may be any of the three kinds
    const planned: HeldDraft = { key: { sessionId: SESSION, weekPlanSetId: 'bench.1' } }
    const drop: HeldDraft = { key: { ...key(4), drop: 1 } }
    const kinds: AddedSet[] = [NORMAL, WARMUP, staged('myo_reps', 3)].map((type, i) => ({ localId: `a${i}`, logId: null, type, place: i + 1 }))
    expect([noType, noLog, draftNoType, draftNoValues, noTypeAnswered, planned, drop, kinds].length).toBe(8)
  })

  it('a type that is not one is refused: a staged set has at least one drop, in the card and in a draft', () => {
    expect(() => rowsOf([card('bench', 'n n n', { added: [staged('dropset', 0)] })])).toThrow(RangeError)
    expect(() => rowsOf([card('bench', 'n n n', { drafts: [draftOf(key(4), staged('dropset', 0))] })])).toThrow(RangeError)
    expect(() => rowsOf([card('bench', 'n n n', { added: [staged('dropset', 1.5)] })])).toThrow(RangeError)
  })

  it('what it is given is not changed, and the rows do not share a type object with the card or a draft', () => {
    const listedType = staged('dropset', 2)
    const draftType = staged('cluster', 1)
    const cards = deepFreeze([card('bench', 'n n n', { added: [listedType], drafts: [draftOf(key(5, 'gone'), draftType)] })])
    const first = rowsOf(cards)
    expect(rowsOf(cards)).toEqual(first)
    const listed = first.find((r) => r.localId === 'a1')!
    const drafted = first.find((r) => r.localId === 'gone')!
    expect(listed.type).toEqual(listedType)
    expect(drafted.type).toEqual(draftType)
    expect(listed.type).not.toBe(listedType)
    expect(drafted.type).not.toBe(draftType)
  })
})

describe('applySetTypeChange on an open added set renumbers the logged sets after it, as for a planned set (146 (a), 161)', () => {
  /** The same position three ways: an open set X between the logged 01 and 03. */
  const placements = {
    planned: { cards: () => [card('bench', 'n n n')], logs: () => [headLog('bench', 1), headLog('bench', 3, { number: 3 })], x: 'set:bench.2', after: 'log.bench.3' },
    drafted: {
      cards: () => [card('bench', 'n', { added: [NORMAL, addedLog('bench', 2, { number: 3 })], drafts: [draftOf(key(2), NORMAL)] })],
      logs: () => [headLog('bench', 1), addedLog('bench', 2, { number: 3 })],
      x: 'added:bench:a1',
      after: 'log.bench.added2',
    },
    new: {
      cards: () => [card('bench', 'n', { added: [NORMAL, addedLog('bench', 2, { number: 3 })] })],
      logs: () => [headLog('bench', 1), addedLog('bench', 2, { number: 3 })],
      x: 'added:bench:a1',
      after: 'log.bench.added2',
    },
  } as const

  for (const [name, p] of Object.entries(placements)) {
    it(`${name}: made a Warmup the logged 03 closes the gap to 02; made Normal again it is 02 and the logged set is 03`, () => {
      const cards = p.cards()
      const server = new FakeServer({ logs: p.logs() })
      const view = viewOf(orderOf(cards), server.logs, server.held())
      expect(view.rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓'])
      const x = rowKeyed(view, p.x)
      const toWarmup = applySetTypeChange({ row: x, pick: WARMUP, session: view })
      expect(toWarmup.renumber).toEqual([{ id: p.after, setNumber: 2 }])
      expect(toWarmup.headPatch).toBeNull()
      expect(toWarmup.changes.map((w) => w.change.kind)).toEqual(name === 'planned' ? ['retyped'] : [])
      server.applySetType(toWarmup, x)
      const warm = keepType(cards, x, toWarmup.type)
      const warmView = viewOf(orderOf(warm), server.logs, server.held())
      expect(warmView.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
      expect(currentSet(orderOf(warm), server.logs, server.held())).toBeNull()
      // back to Normal: it takes its place again and the logged set moves up one (a set never logged too: the card keeps its place)
      const wRow = rowKeyed(warmView, p.x)
      const toNormal = applySetTypeChange({ row: wRow, pick: NORMAL, session: warmView })
      expect(toNormal.renumber).toEqual([{ id: p.after, setNumber: 3 }])
      server.applySetType(toNormal, wRow)
      const back = keepType(warm, wRow, toNormal.type)
      expect(rowsOf(back, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓'])
      expect(rowsOf(back, server.logs, server.held()).map((r) => r.key)).toEqual(view.rows.map((r) => r.key))
      expect(currentSet(orderOf(back), server.logs, server.held())!.number).toBe(2)
    })
  }

  it('two new sets, the first made a Warmup and back: every set is where it was (nothing logged after it, nothing to move)', () => {
    const cards = [card('bench', 'n n', { added: 2 })]
    const logs = [headLog('bench', 1)]
    const view = viewOf(orderOf(cards), logs)
    expect(view.rows.map((r) => [r.key, r.number])).toEqual([['set:bench.1', 1], ['set:bench.2', 2], ['added:bench:a1', 3], ['added:bench:a2', 4]])
    const first = rowKeyed(view, 'added:bench:a1')
    const toWarmup = applySetTypeChange({ row: first, pick: WARMUP, session: view })
    expect(toWarmup.renumber).toEqual([])
    const warm = keepType(cards, first, toWarmup.type)
    const warmView = viewOf(orderOf(warm), logs)
    expect(warmView.rows.map((r) => [r.key, r.kind === 'warmup' ? 'W' : r.number])).toEqual([['added:bench:a1', 'W'], ['set:bench.1', 1], ['set:bench.2', 2], ['added:bench:a2', 3]])
    const toNormal = applySetTypeChange({ row: rowKeyed(warmView, 'added:bench:a1'), pick: NORMAL, session: warmView })
    expect(toNormal.renumber).toEqual([])
    const back = viewOf(orderOf(keepType(warm, rowKeyed(warmView, 'added:bench:a1'), toNormal.type)), logs)
    expect(back.rows.map((r) => [r.key, r.number])).toEqual([['set:bench.1', 1], ['set:bench.2', 2], ['added:bench:a1', 3], ['added:bench:a2', 4]])
  })

  it('bench 01–03 logged, two new sets open, the first made a Warmup: nothing to renumber, the second is current without asking, and once both are logged the working sets read 1 to 4', () => {
    const cards = [card('bench', 'n n n', { added: 2 })]
    const server = new FakeServer({ logs: threeLogged() })
    const view = viewOf(orderOf(cards), server.logs, server.held())
    expect(view.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    const first = rowKeyed(view, 'added:bench:a1')
    const result = applySetTypeChange({ row: first, pick: WARMUP, session: view })
    expect(result).toMatchObject({ type: WARMUP, changed: true, headPatch: null, changes: [], renumber: [], stagesToAdd: [], stagesToDelete: [] })
    const warm = keepType(cards, first, result.type)
    const rows = rowsOf(warm, server.logs)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const second = rows[4]
    expect(lockDecision({ logInOrder: true, current: currentSet(orderOf(warm), server.logs), tapped: second })).toBe('log')
    // LOG stores the number each row shows: the second 04, the Warmup its place W1
    const secondLog = addedLog('bench', 2, { number: second.number })
    server.insertLog(secondLog)
    const afterSecond = loggedAdded(warm, second, secondLog.id)
    const warmRow = rowsOf(afterSecond, server.logs)[0]
    expect(warmRow).toMatchObject({ kind: 'warmup', state: 'unlogged', number: 1, key: 'added:bench:a1' })
    const warmLog = addedLog('bench', 1, { number: warmRow.number, warmup: true })
    server.insertLog(warmLog)
    const done = rowsOf(loggedAdded(afterSecond, warmRow, warmLog.id), server.logs)
    expect(done.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
    expect(done.filter((r) => r.kind === 'working').map((r) => r.number)).toEqual([1, 2, 3, 4])
  })

  it('a switch between working types, or to a staged one, renumbers nothing and writes no change row for an added set', () => {
    const later = addedLog('bench', 2, { number: 3 })
    const cards = [card('bench', 'n', { added: [NORMAL, later] })]
    const logs = [headLog('bench', 1), later]
    const view = viewOf(orderOf(cards), logs)
    const x = rowKeyed(view, 'added:bench:a1')
    const dropset = applySetTypeChange({ row: x, pick: staged('dropset', 2), session: view })
    expect(dropset).toMatchObject({ type: staged('dropset', 2), changed: true, headPatch: null, stagesToAdd: [1, 2], stagesToDelete: [], needsConfirm: false, changes: [], renumber: [] })
    const kept = keepType(cards, x, dropset.type)
    expect(rowsOf(kept, logs).map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 02.1·', 'bench 02.2·', 'bench 03✓'])
    const stagedView = viewOf(orderOf(kept), logs)
    const back = applySetTypeChange({ row: rowKeyed(stagedView, 'added:bench:a1'), pick: NORMAL, session: stagedView })
    expect(back).toMatchObject({ type: NORMAL, headPatch: null, stagesToAdd: [], stagesToDelete: [], needsConfirm: false, changes: [], renumber: [] })
    // from a staged type to Warmup leaves the working numbers, from Warmup to a staged one joins them
    const toWarmup = applySetTypeChange({ row: rowKeyed(stagedView, 'added:bench:a1'), pick: WARMUP, session: stagedView })
    expect(toWarmup.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 2 }])
    const warmView = viewOf(orderOf(keepType(cards, x, WARMUP)), [headLog('bench', 1), addedLog('bench', 2, { number: 2 })])
    const fromWarmup = applySetTypeChange({ row: rowKeyed(warmView, 'added:bench:a1'), pick: staged('dropset', 1), session: warmView })
    expect(fromWarmup.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 3 }])
  })
})

describe('DELETE of an open added set: a Warmup holds no working number to close, a working set does', () => {
  it('the same place, once as a Warmup and once as a working set: the logged set after it moves only for the working one', () => {
    // bench 01 logged; the first added set is open; the second is logged
    const warm = viewOf(orderOf([card('bench', 'n', { added: [WARMUP, addedLog('bench', 2, { number: 2 })] })]), [headLog('bench', 1), addedLog('bench', 2, { number: 2 })])
    expect(warm.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
    expect(deleteEffects(rowKeyed(warm, 'added:bench:a1'), warm)).toMatchObject({ deleteOrder: [], stageCount: 0, renumber: [], changes: [], headPatch: null, type: null })
    const working = viewOf(orderOf([card('bench', 'n', { added: [NORMAL, addedLog('bench', 2, { number: 3 })] })]), [headLog('bench', 1), addedLog('bench', 2, { number: 3 })])
    expect(working.rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓'])
    expect(deleteEffects(rowKeyed(working, 'added:bench:a1'), working)).toMatchObject({ deleteOrder: [], renumber: [{ id: 'log.bench.added2', setNumber: 2 }], changes: [] })
    // applied, with the card taking the set off its list: the rows read 01 02, and the logged set is stored as 02
    const server = new FakeServer({ logs: working.logs })
    server.applyDelete(deleteEffects(rowKeyed(working, 'added:bench:a1'), working))
    const cardsAfter = deletedAdded([card('bench', 'n', { added: [NORMAL, addedLog('bench', 2, { number: 3 })] })], rowKeyed(working, 'added:bench:a1'))
    expect(resolveRows(orderOf(cardsAfter), server.logs).map(brief)).toEqual(['bench 01✓', 'bench 02✓'])
    expect(server.logs.map((l) => l.setNumber)).toEqual([1, 2])
  })

  it('a drop of an open added dropset: the set keeps one drop fewer as its type, and nothing is renumbered', () => {
    const cards = [card('bench', 'n n n', { added: [staged('dropset', 2)] })]
    const view = viewOf(orderOf(cards), threeLogged())
    const drop = rowKeyed(view, 'added:bench:a1:stage:2')
    const effects = deleteEffects(drop, view)
    expect(effects).toMatchObject({ deleteOrder: [], renumber: [], changes: [], headPatch: null, type: staged('dropset', 1) })
    const kept = keepType(cards, rowKeyed(view, 'added:bench:a1'), effects.type!)
    expect(rowsOf(kept).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·'])
  })
})

describe('addRound counts working rows only: an open added Warmup is not one', () => {
  it('a member with an added Warmup gets position 3 and one with an added working set 4', () => {
    const block = [{ id: 'blk', members: ['row', 'lat'] }]
    const position = (type: typeof WARMUP | typeof NORMAL) => {
      const order = orderOf([card('row', 'n n', { added: [type] }), card('lat', 'n n')], block)
      return addRound(order, resolveRows(order, []), 'blk', []).map((p) => [p.exerciseKey, p.position])
    }
    expect(position(WARMUP)).toEqual([['row', 3], ['lat', 3]])
    expect(position(NORMAL)).toEqual([['row', 4], ['lat', 3]])
  })
})

describe('the finish warning lists planned sets only, whatever the added sets are', () => {
  it('open added sets of every type are not listed', () => {
    const cards = [card('bench', 'n n', { added: [WARMUP, NORMAL, staged('dropset', 1)] })]
    const warning = finishWarning(orderOf(cards), [headLog('bench', 1)])
    expect(warning).toMatchObject({ count: 1, text: "1 planned set isn't logged yet: Bench 02." })
    expect(finishWarning(orderOf([card('bench', 'n', { added: [WARMUP, NORMAL, staged('dropset', 1)] })]), [headLog('bench', 1)])).toBeNull()
  })
})

// ─── Unlog: the draft holds the type, so an unlog is undone exactly and nothing moves ────────────

describe('unlog of an added set keeps its type in the draft (DECISIONS 161)', () => {
  it('an added Warmup unlogged comes back a Warmup, the open set after it keeps its number, and logging it again restores it', () => {
    // review 3's F2: bench 01–03 logged, added A logged as 04 and made a Warmup, added B open
    const aLog = addedLog('bench', 1, { number: 4 })
    let cards = [card('bench', 'n n n', { added: [aLog, NORMAL] })]
    const server = new FakeServer({ logs: [...threeLogged(), aLog] })
    const start = viewOf(orderOf(cards), server.logs, server.held())
    expect(start.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 05·'])
    const a = rowKeyed(start, 'added:bench:a1')
    const toWarmup = applySetTypeChange({ row: a, pick: WARMUP, session: start })
    // its own log takes its W number (173); B is open, so no other log moves
    expect(toWarmup).toMatchObject({ headPatch: { isWarmup: true, stageKind: null }, renumber: [{ id: aLog.id, setNumber: 1 }], changes: [] })
    server.applySetType(toWarmup, a)
    expect(server.logs.find((l) => l.id === aLog.id)).toMatchObject({ setNumber: 1, isWarmup: true })
    cards = keepType(cards, a, toWarmup.type)
    const before = viewOf(orderOf(cards), server.logs, server.held())
    expect(before.rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const warmRow = rowKeyed(before, 'added:bench:a1')
    expect(warmRow).toMatchObject({ kind: 'warmup', state: 'logged' })

    // UNLOG: the draft holds the type, and the number the row shows
    const unlog = unlogEffects(warmRow, before)
    expect(unlog.deleteOrder.map((l) => l.id)).toEqual([aLog.id])
    expect(addedDraft(unlog).key).toEqual(key(1, 'a1'))
    expect(addedDraft(unlog).values).toMatchObject({ weight: 50, reps: 10, type: WARMUP })
    expect(unlog.changes).toEqual([])
    server.applyUnlog(unlog)
    const kept = unloggedAdded(cards, warmRow, unlog.draft)
    const after = viewOf(orderOf(kept), server.logs, server.held())
    expect(after.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    // nothing moved: the same keys, kinds, numbers and types (only the set\'s own state and log differ)
    expect(placesOf(after.rows)).toEqual(placesOf(before.rows))
    expect(rowKeyed(after, 'added:bench:a1')).toMatchObject({ state: 'unlogged', logId: null, draftKey: key(1, 'a1'), kind: 'warmup' })
    expect(currentSet(orderOf(kept), server.logs)!.key).toBe('added:bench:a2')

    // logging it again with the type and the number the row shows restores it
    const columns = typeColumns(addedDraft(unlog).values.type)
    const again = { ...addedLog('bench', 1, { number: rowKeyed(after, 'added:bench:a1').number, warmup: columns.isWarmup }), id: 'log.again' }
    server.insertLog(again)
    const restored = rowsOf(loggedAdded(kept, rowKeyed(after, 'added:bench:a1'), again.id), server.logs, server.held())
    expect(restored.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(placesOf(restored)).toEqual(placesOf(before.rows))
  })

  it('the control, the review\'s F2: the same set kept as Normal is a working set again, and the open set after it moves from 04 to 05', () => {
    const cards = [card('bench', 'n n n', { added: [NORMAL, NORMAL], drafts: [draftOf(key(4), NORMAL)] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    expect(rows.filter((r) => r.added).map((r) => [r.key, r.draftKey?.position ?? null, r.number])).toEqual([['added:bench:a1', 4, 4], ['added:bench:a2', null, 5]])
  })

  it('an added dropset unlogged comes back a dropset with its drops, and logging it again with its pending row restores the rows', () => {
    const headA = addedLog('bench', 1, { number: 4, stageKind: 'dropset' })
    const server = new FakeServer({ logs: [...threeLogged(), headA], changes: [{ ...pending(headA, 'dropset', 2), id: 'p1' }] })
    const cards = [card('bench', 'n n n', { added: [{ localId: 'a1', logId: headA.id, type: staged('dropset', 2) }, NORMAL] })]
    const before = viewOf(orderOf(cards), server.logs, server.held())
    expect(before.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 04.1·', 'bench 04.2·', 'bench 05·'])
    const head = rowKeyed(before, 'added:bench:a1')
    expect(canUnlog(head, before)).toBe(true)
    const unlog = unlogEffects(head, before)
    expect(addedDraft(unlog).values.type).toEqual(staged('dropset', 2))
    expect(unlog.changes).toEqual([])
    server.applyUnlog(unlog) // the log goes, and its pending row with it
    expect(server.held()).toEqual([])
    const kept = unloggedAdded(cards, head, unlog.draft)
    const after = viewOf(orderOf(kept), server.logs, server.held())
    expect(after.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·', 'bench 04.2·', 'bench 05·'])
    expect(placesOf(after.rows)).toEqual(placesOf(before.rows))
    // log it again: the log with the draft's kind and the pending row with the draft's drop count
    const type = addedDraft(unlog).values.type
    expect(type.kind).toBe('staged')
    const again = { ...addedLog('bench', 1, { number: rowKeyed(after, 'added:bench:a1').number, stageKind: typeColumns(type).stageKind }), id: 'log.again' }
    server.insertLog(again)
    server.upsertChange({ change: pending(again, typeColumns(type).stageKind!, typeColumns(type).stageCount), id: null })
    const restored = viewOf(orderOf(loggedAdded(kept, rowKeyed(after, 'added:bench:a1'), again.id)), server.logs, server.held())
    expect(restored.rows.map(brief)).toEqual(before.rows.map(brief))
    expect(placesOf(restored.rows)).toEqual(placesOf(before.rows))
  })

  it('a set that is logged as a Warmup right away and unlogged comes back the same, its draft keyed by the number it shows', () => {
    // bench 01–03 logged, a new Warmup logged as W1 (stored 1), a new working set open (04)
    const cards = [card('bench', 'n n n', { added: [WARMUP, NORMAL] })]
    const warm = rowsOf(cards)[0]
    const warmLog = addedLog('bench', 1, { number: warm.number, warmup: true })
    const afterLog = loggedAdded(cards, warm, warmLog.id)
    const logs = [...threeLogged(), warmLog]
    const before = viewOf(orderOf(afterLog), logs)
    expect(before.rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const unlog = unlogEffects(rowKeyed(before, 'added:bench:a1'), before)
    expect(unlog.draft.key).toEqual(key(1, 'a1'))
    expect(addedDraft(unlog).values.type).toEqual(WARMUP)
    const server = new FakeServer({ logs })
    server.applyUnlog(unlog)
    const after = viewOf(orderOf(unloggedAdded(afterLog, rowKeyed(before, 'added:bench:a1'), unlog.draft)), server.logs)
    expect(after.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(placesOf(after.rows)).toEqual(placesOf(before.rows))
  })

  it('a set the card does not list (its log only: a reload) is keyed by its log\'s id, and comes back by its draft', () => {
    const log = addedLog('bench', 1, { number: 4, warmup: true })
    const view = viewOf(orderOf([card('bench', 'n n n')]), [...threeLogged(), log])
    expect(view.rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
    const unlog = unlogEffects(rowKeyed(view, `added:bench:${log.id}`), view)
    expect(unlog.draft.key).toEqual(key(1, log.id))
    const server = new FakeServer({ logs: view.logs })
    server.applyUnlog(unlog)
    const after = viewOf(orderOf([card('bench', 'n n n', { drafts: [unlog.draft] })]), server.logs)
    expect(placesOf(after.rows)).toEqual(placesOf(view.rows))
  })

  it('a planned set\'s draft holds no type (its retyped row does), and neither does a drop\'s', () => {
    const planned = headLog('bench', 1)
    const plannedView = viewOf(orderOf([card('bench', 'n')]), [planned])
    const plannedUnlog = unlogEffects(rowKeyed(plannedView, 'set:bench.1'), plannedView)
    expect(Object.keys(plannedUnlog.draft.values).sort()).toEqual(['enteredUnit', 'formRating', 'reps', 'rir', 'weight'])
    expect('type' in plannedUnlog.draft.values).toBe(false)
    const head = addedLog('bench', 1, { number: 1, stageKind: 'dropset' })
    const logs: ReturnType<typeof addedLog>[] = [head, { ...addedLog('bench', 1, { number: 1 }), id: 'drop1', parentSetId: head.id, isDropset: true, stageIndex: 1 }]
    const view = viewOf(orderOf([card('bench', '', { added: [{ localId: 'a1', logId: head.id, type: staged('dropset', 1) }] })]), logs, [{ ...pending(head, 'dropset', 1), id: 'p1' }])
    const dropUnlog = unlogEffects(rowKeyed(view, 'added:bench:a1:stage:1'), view)
    expect(dropUnlog.draft.key).toEqual({ sessionId: SESSION, localId: 'a1', exerciseId: 'ex.bench', position: 1, drop: 1 })
    expect('type' in dropUnlog.draft.values).toBe(false)
  })

  it('every kind of type survives an unlog: a table over Normal, Warmup and each staged kind', () => {
    const types = [NORMAL, WARMUP, staged('dropset', 1), staged('rest_pause', 2), staged('myo_reps', 3), staged('cluster', 2)] as const
    for (const type of types) {
      const columns = typeColumns(type)
      const head = addedLog('bench', 1, { number: 4, warmup: columns.isWarmup, stageKind: columns.stageKind })
      const changes = type.kind === 'staged' ? [{ ...pending(head, type.stageKind, type.stageCount), id: 'p1' }] : []
      const server = new FakeServer({ logs: [...threeLogged(), head], changes })
      const cards = [card('bench', 'n n n', { added: [{ localId: 'a1', logId: head.id, type }] })]
      const before = viewOf(orderOf(cards), server.logs, server.held())
      const row = rowKeyed(before, 'added:bench:a1')
      const unlog = unlogEffects(row, before)
      expect(addedDraft(unlog).values.type, JSON.stringify(type)).toEqual(type)
      server.applyUnlog(unlog)
      const after = viewOf(orderOf(unloggedAdded(cards, row, unlog.draft)), server.logs, server.held())
      expect(rowKeyed(after, 'added:bench:a1'), JSON.stringify(type)).toMatchObject({ state: 'unlogged', logId: null, type })
      expect(placesOf(after.rows), JSON.stringify(type)).toEqual(placesOf(before.rows))
      expect(after.rows.filter((r) => r.kind === 'stage').map((r) => r.state), JSON.stringify(type)).toEqual(
        Array.from({ length: type.kind === 'staged' ? type.stageCount : 0 }, () => 'unlogged'),
      )
    }
  })
})
