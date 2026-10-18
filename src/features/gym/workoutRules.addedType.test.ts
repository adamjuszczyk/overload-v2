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
  type AddedSetDraft,
  type AddedSetKey,
  type HeldDraft,
  type OrderExercise,
  type ResolvedRow,
  type UnlogEffects,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import { addedLog, brief, card, deepFreeze, draftOf, dropOpenAdded, headLog, keepType, orderOf, pending, rowKeyed, staged, viewOf } from './workoutRules.testutil'

// Chunk 46, fourth attempt: DECISIONS 161 (Adam, 2026-10-16): "go ahead with chunk 46's fourth attempt, with (b)(i): an added set's
// draft also keeps its type, so an unlog is undone exactly and nothing moves; 46's rules see every added set's type."
//
// Every fixture here has the same sets twice, once with an added Warmup and once with an added working set in the same place,
// so a rule that cannot tell them apart fails one of the pair. A set added in the session (ADD SET, ADD ROUND) is "new" until it
// is logged; the card keeps its type in `addedTypes` (its row's `addedIndex`), or its draft does once it was logged and
// unlogged. Expected values are written out by hand.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const
const SESSION = 's1'

/** The key of the draft an added set of `bench` leaves when it is unlogged at `position`. */
const key = (position: number, n = 1): AddedSetKey => ({ sessionId: SESSION, localId: `log.bench.added${n}`, exerciseId: 'ex.bench', position })

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
    const cards = [card('bench', 'n n n', { added: 2, types: [WARMUP, NORMAL] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(rows[0]).toMatchObject({ key: 'added:bench:1', kind: 'warmup', type: WARMUP, state: 'unlogged', added: true, addedIndex: 0, draftPosition: null })
    expect(rows[4]).toMatchObject({ key: 'added:bench:2', kind: 'working', type: NORMAL, number: 4, addedIndex: 1 })
    expect(currentSet(orderOf(cards), threeLogged())!.key).toBe('added:bench:2')
  })

  it('…and with the types the other way round the first is the working set 04 and current, the second the Warmup', () => {
    const cards = [card('bench', 'n n n', { added: 2, types: [NORMAL, WARMUP] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(rows[0]).toMatchObject({ key: 'added:bench:2', kind: 'warmup', addedIndex: 1 })
    expect(rows[4]).toMatchObject({ key: 'added:bench:1', kind: 'working', number: 4, addedIndex: 0 })
    expect(currentSet(orderOf(cards), threeLogged())!.key).toBe('added:bench:1')
  })

  it('no types handed over reads every new added set as Normal (ADD SET\'s default), a missing entry too, an extra one is ignored', () => {
    expect(rowsOf([card('bench', 'n n n', { added: 2 })]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    expect(rowsOf([card('bench', 'n n n', { added: 2, types: [WARMUP] })]).map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(rowsOf([card('bench', 'n n n', { added: 1, types: [NORMAL, WARMUP] })]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
  })

  it('the lock never asks about a Warmup and never because of one: LOG on the second added set is not "before set 04"', () => {
    // the review\'s executed case: the first added set made a Warmup, LOG on the second asked "Log set 05 before set 04?"
    const cards = [card('bench', 'n n n', { added: 2, types: [WARMUP, NORMAL] })]
    const rows = rowsOf(cards)
    const current = currentSet(orderOf(cards), threeLogged())
    expect(lockDecision({ logInOrder: true, current, tapped: rows[4] })).toBe('log')
    expect(lockDecision({ logInOrder: true, current, tapped: rows[0] })).toBe('log')
    // three added sets, a working one before the Warmup and one after it: only the one after it asks, and not about the Warmup
    const three = [card('bench', 'n n n', { added: 3, types: [NORMAL, WARMUP, NORMAL] })]
    const threeRows = rowsOf(three)
    expect(threeRows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    const currentThree = currentSet(orderOf(three), threeLogged())
    expect(currentThree!.key).toBe('added:bench:1')
    expect(lockDecision({ logInOrder: true, current: currentThree, tapped: threeRows[5] })).toEqual({ ask: 'Log set 05 before set 04?', next: 'Bench 04', label: 'set 05' })
    expect(lockDecision({ logInOrder: true, current: currentThree, tapped: threeRows[0] })).toBe('log')
  })

  it('a Warmup is the only open row: nothing is current, and nothing is left to log in order', () => {
    const cards = [card('bench', 'n n n', { added: 1, types: [WARMUP] })]
    expect(currentSet(orderOf(cards), threeLogged())).toBeNull()
    expect(rowsOf(cards).map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓'])
  })

  it('an open added dropset has its drops as open rows after it, and the head is current', () => {
    const cards = [card('bench', 'n n n', { added: 1, types: [staged('dropset', 2)] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·', 'bench 04.2·'])
    expect(rows[3]).toMatchObject({ key: 'added:bench:1', type: staged('dropset', 2), stageKind: 'dropset' })
    expect(rows.slice(4).map((r) => [r.kind, r.headKey, r.stageNumber, r.state])).toEqual([
      ['stage', 'added:bench:1', 1, 'unlogged'],
      ['stage', 'added:bench:1', 2, 'unlogged'],
    ])
    expect(currentSet(orderOf(cards), threeLogged())!.key).toBe('added:bench:1')
    // and a Normal set in the same place has none
    expect(rowsOf([card('bench', 'n n n', { added: 1, types: [NORMAL] })]).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
  })

  it('a draft holds the type of the set it keeps: a Warmup draft is a Warmup row, a Normal one the working set', () => {
    const logs = threeLogged()
    const withDraft = (type: Parameters<typeof draftOf>[1]) => [card('bench', 'n n n', { added: 2, drafts: [draftOf(key(4), type)], types: [NORMAL] })]
    const warm = rowsOf(withDraft(WARMUP), logs)
    expect(warm.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(warm[0]).toMatchObject({ key: 'added:bench:1', kind: 'warmup', draftPosition: 4, addedIndex: null })
    expect(warm[4]).toMatchObject({ key: 'added:bench:2', kind: 'working', draftPosition: null, addedIndex: 0, number: 4 })
    expect(currentSet(orderOf(withDraft(WARMUP)), logs)!.key).toBe('added:bench:2')
    const working = rowsOf(withDraft(NORMAL), logs)
    expect(working.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    expect(working[3]).toMatchObject({ key: 'added:bench:1', draftPosition: 4 })
    expect(currentSet(orderOf(withDraft(NORMAL)), logs)!.key).toBe('added:bench:1')
    // a drafted dropset has its drops
    expect(rowsOf(withDraft(staged('rest_pause', 1)), logs).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·', 'bench 05·'])
  })

  it('the type belongs to the set, not to its row key or its number: it stays with the set when the other is logged first', () => {
    // two new added sets, the first a Warmup; the screen logs the second one (as 04) and drops its entry
    const before = [card('bench', 'n n n', { added: 2, types: [WARMUP, NORMAL] })]
    const second = rowKeyed({ rows: rowsOf(before) }, 'added:bench:2')
    const cards = dropOpenAdded(before, second)
    expect(cards[0].addedTypes).toEqual([WARMUP])
    const logs = [...threeLogged(), addedLog('bench', 1, { number: second.number })]
    const rows = rowsOf(cards, logs)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
    // the Warmup is still the first new set (index 0) although its row key is now the second added row's
    expect(rows[0]).toMatchObject({ key: 'added:bench:2', kind: 'warmup', addedIndex: 0 })
    expect(rows[4]).toMatchObject({ key: 'added:bench:1', logId: 'log.bench.added1' })
    // …and with the types the other way round, logging the first one leaves the second one\'s Warmup alone
    const swapped = [card('bench', 'n n n', { added: 2, types: [NORMAL, WARMUP] })]
    const first = rowKeyed({ rows: rowsOf(swapped) }, 'added:bench:1')
    expect(first.kind).toBe('working')
    const after = rowsOf(dropOpenAdded(swapped, first), [...threeLogged(), addedLog('bench', 1, { number: first.number })])
    expect(after.filter((r) => r.kind === 'warmup').map((r) => [r.key, r.addedIndex])).toEqual([['added:bench:2', 0]])
  })

  it('an added exercise\'s sets (no planned set at all) read the same way', () => {
    const cards = [card('pushdown', '', { added: 2, types: [NORMAL, WARMUP] })]
    expect(resolveRows(orderOf(cards), []).map(brief)).toEqual(['pushdown W1·', 'pushdown 01·'])
  })

  it('a card\'s warmups come before its working sets in a superset block, and an added Warmup is not one of the rounds', () => {
    const cards = [card('row', 'n n', { added: 1, types: [WARMUP] }), card('lat', 'n n')]
    const rows = resolveRows(orderOf(cards, [{ id: 'blk', members: ['row', 'lat'] }]), [])
    expect(rows.map(brief)).toEqual(['row W1·', 'row A1·', 'lat B1·', 'row A2·', 'lat B2·'])
    expect(currentSet(orderOf(cards, [{ id: 'blk', members: ['row', 'lat'] }]), [])!.key).toBe('set:row.1')
  })
})

describe('what the card or a draft must say is refused when it is wrong', () => {
  it('a draft of an added set without its type is refused at run time (a caller that skips the type would read Normal)', () => {
    const noValues = { key: key(4) } as unknown as HeldDraft
    const emptyValues = { key: key(4), values: {} } as unknown as HeldDraft
    for (const draft of [noValues, emptyValues]) {
      expect(() => rowsOf([card('bench', 'n n n', { added: 1, drafts: [draft] })])).toThrow(TypeError)
    }
  })

  it('…and under tsc (this line fails `npm run typecheck` if the type becomes optional)', () => {
    // @ts-expect-error a draft of a set added in the session must say its type
    const noType: HeldDraft = { key: key(4), values: {} }
    // @ts-expect-error nor may it leave `values` out
    const noValues: HeldDraft = { key: key(4) }
    // @ts-expect-error what unlogging an added set answers carries the type in its values
    const noTypeAnswered: UnlogEffects['draft'] = { key: key(4), values: { weight: 1, reps: 1, rir: null, formRating: null, enteredUnit: null } }
    // a planned set's draft and a drop's need no type, and the type of an added set's draft may be any of the three kinds
    const planned: HeldDraft = { key: { sessionId: SESSION, weekPlanSetId: 'bench.1' } }
    const drop: HeldDraft = { key: { ...key(4), drop: 1 } }
    const kinds: HeldDraft[] = [draftOf(key(4), NORMAL), draftOf(key(4), WARMUP), draftOf(key(4), staged('myo_reps', 3))]
    expect([noType, noValues, noTypeAnswered, planned, drop, kinds].length).toBe(6)
  })

  it('a type that is not one is refused: a staged set has at least one drop, in the card and in a draft', () => {
    expect(() => rowsOf([card('bench', 'n n n', { added: 1, types: [staged('dropset', 0)] })])).toThrow(RangeError)
    expect(() => rowsOf([card('bench', 'n n n', { added: 1, drafts: [draftOf(key(4), staged('dropset', 0))] })])).toThrow(RangeError)
    expect(() => rowsOf([card('bench', 'n n n', { added: 1, types: [staged('dropset', 1.5)] })])).toThrow(RangeError)
    expect(() => rowsOf([card('bench', 'n n n', { added: 1, types: [{ kind: 'bogus' } as never] })])).toThrow(TypeError)
  })

  it('what it is given is not changed, and the rows do not share a type object with the card', () => {
    const draftType = staged('dropset', 2)
    const newType = staged('cluster', 1)
    const cards = deepFreeze([card('bench', 'n n n', { added: 2, drafts: [draftOf(key(4), draftType)], types: [newType] })])
    const first = rowsOf(cards)
    expect(rowsOf(cards)).toEqual(first)
    const drafted = first.find((r) => r.draftPosition === 4)!
    const fresh = first.find((r) => r.addedIndex === 0)!
    expect(drafted.type).toEqual(draftType)
    expect(fresh.type).toEqual(newType)
    expect(drafted.type).not.toBe(draftType)
    expect(fresh.type).not.toBe(newType)
  })
})

describe('applySetTypeChange on an open added set renumbers the logged sets after it, as for a planned set (146 (a), 161)', () => {
  /** The same position three ways: an open set X between the logged 01 and 03. Returns the cards, the logs and X\'s key. */
  const placements = {
    planned: { cards: () => [card('bench', 'n n n')], logs: () => [headLog('bench', 1), headLog('bench', 3, { number: 3 })], x: 'set:bench.2', after: 'log.bench.3' },
    drafted: {
      cards: () => [card('bench', 'n', { added: 2, drafts: [draftOf(key(2), NORMAL)] })],
      logs: () => [headLog('bench', 1), addedLog('bench', 2, { number: 3 })],
      x: 'added:bench:1',
      after: 'log.bench.added2',
    },
    new: { cards: () => [card('bench', 'n', { added: 2 })], logs: () => [headLog('bench', 1), addedLog('bench', 2, { number: 3 })], x: 'added:bench:1', after: 'log.bench.added2' },
  } as const

  for (const [name, p] of Object.entries(placements)) {
    it(`${name}: made a Warmup the logged 03 closes the gap to 02${name === 'new' ? '' : '; made Normal again it is 02 and the logged set is 03'}`, () => {
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
      // a set that was never logged has no recorded place to come back to (the next test); the others take it again
      if (name === 'new') return
      // back to Normal: it takes its place again and the logged set moves up one
      const wRow = warmView.rows.find((r) => r.kind === 'warmup')!
      const toNormal = applySetTypeChange({ row: wRow, pick: NORMAL, session: warmView })
      expect(toNormal.renumber).toEqual([{ id: p.after, setNumber: 3 }])
      server.applySetType(toNormal, wRow)
      const back = keepType(warm, wRow, toNormal.type)
      expect(rowsOf(back, server.logs, server.held()).map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓'])
      expect(currentSet(orderOf(back), server.logs, server.held())!.number).toBe(2)
    })
  }

  it('a new Warmup made Normal when a set was logged after it: it joins after the logged one (the order the sets were added in is not recorded)', () => {
    // bench 01 logged; the first new set is a Warmup; the second was added and logged as 02; the Warmup is made Normal
    const cards = [card('bench', 'n', { added: 2, types: [WARMUP] })]
    const logs = [headLog('bench', 1), addedLog('bench', 1, { number: 2 })]
    const view = viewOf(orderOf(cards), logs)
    expect(view.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
    const w = view.rows[0]
    const result = applySetTypeChange({ row: w, pick: NORMAL, session: view })
    expect(result.renumber).toEqual([])
    expect(rowsOf(keepType(cards, w, result.type), logs).map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03·'])
  })

  it('two new sets, the first made a Warmup and back: every set is where it was (nothing logged after it, nothing to move)', () => {
    const cards = [card('bench', 'n n', { added: 2 })]
    const logs = [headLog('bench', 1)]
    const view = viewOf(orderOf(cards), logs)
    expect(view.rows.map((r) => [r.key, r.number])).toEqual([['set:bench.1', 1], ['set:bench.2', 2], ['added:bench:1', 3], ['added:bench:2', 4]])
    const first = rowKeyed(view, 'added:bench:1')
    const toWarmup = applySetTypeChange({ row: first, pick: WARMUP, session: view })
    expect(toWarmup.renumber).toEqual([])
    const warm = keepType(cards, first, toWarmup.type)
    const warmView = viewOf(orderOf(warm), logs)
    expect(warmView.rows.map((r) => [r.key, r.kind === 'warmup' ? 'W' : r.number])).toEqual([['added:bench:1', 'W'], ['set:bench.1', 1], ['set:bench.2', 2], ['added:bench:2', 3]])
    const toNormal = applySetTypeChange({ row: rowKeyed(warmView, 'added:bench:1'), pick: NORMAL, session: warmView })
    expect(toNormal.renumber).toEqual([])
    const back = viewOf(orderOf(keepType(warm, rowKeyed(warmView, 'added:bench:1'), toNormal.type)), logs)
    expect(back.rows.map((r) => [r.key, r.number])).toEqual([['set:bench.1', 1], ['set:bench.2', 2], ['added:bench:1', 3], ['added:bench:2', 4]])
  })

  it('bench 01–03 logged, two new sets open, the first made a Warmup: nothing to renumber, the second is current without asking, and once both are logged the working sets read 1 to 4', () => {
    const cards = [card('bench', 'n n n', { added: 2 })]
    const server = new FakeServer({ logs: threeLogged() })
    const view = viewOf(orderOf(cards), server.logs, server.held())
    expect(view.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    const first = rowKeyed(view, 'added:bench:1')
    const result = applySetTypeChange({ row: first, pick: WARMUP, session: view })
    expect(result).toMatchObject({ type: WARMUP, changed: true, headPatch: null, changes: [], renumber: [], stagesToAdd: [], stagesToDelete: [] })
    const warm = keepType(cards, first, result.type)
    const rows = rowsOf(warm, server.logs)
    expect(rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const second = rows[4]
    expect(lockDecision({ logInOrder: true, current: currentSet(orderOf(warm), server.logs), tapped: second })).toBe('log')
    // LOG stores the number each row shows: the second 04, the Warmup its place W1
    server.insertLog(addedLog('bench', 2, { number: second.number }))
    const afterSecond = dropOpenAdded(warm, second)
    const warmRow = rowsOf(afterSecond, server.logs)[0]
    expect(warmRow).toMatchObject({ kind: 'warmup', state: 'unlogged', number: 1 })
    server.insertLog(addedLog('bench', 1, { number: warmRow.number, warmup: true }))
    const done = rowsOf(dropOpenAdded(afterSecond, warmRow), server.logs)
    expect(done.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓'])
    expect(done.filter((r) => r.kind === 'working').map((r) => r.number)).toEqual([1, 2, 3, 4])
  })

  it('a switch between working types, or to a staged one, renumbers nothing and writes no change row for an added set', () => {
    const cards = [card('bench', 'n', { added: 2, drafts: [draftOf(key(2), NORMAL)] })]
    const logs = [headLog('bench', 1), addedLog('bench', 2, { number: 3 })]
    const view = viewOf(orderOf(cards), logs)
    const x = rowKeyed(view, 'added:bench:1')
    const dropset = applySetTypeChange({ row: x, pick: staged('dropset', 2), session: view })
    expect(dropset).toMatchObject({ type: staged('dropset', 2), changed: true, headPatch: null, stagesToAdd: [1, 2], stagesToDelete: [], needsConfirm: false, changes: [], renumber: [] })
    const kept = keepType(cards, x, dropset.type)
    expect(rowsOf(kept, logs).map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 02.1·', 'bench 02.2·', 'bench 03✓'])
    const stagedView = viewOf(orderOf(kept), logs)
    const back = applySetTypeChange({ row: rowKeyed(stagedView, 'added:bench:1'), pick: NORMAL, session: stagedView })
    expect(back).toMatchObject({ type: NORMAL, headPatch: null, stagesToAdd: [], stagesToDelete: [], needsConfirm: false, changes: [], renumber: [] })
    // from a staged type to Warmup leaves the working numbers, from Warmup to a staged one joins them
    const toWarmup = applySetTypeChange({ row: rowKeyed(stagedView, 'added:bench:1'), pick: WARMUP, session: stagedView })
    expect(toWarmup.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 2 }])
    const warmView = viewOf(orderOf(keepType(cards, x, WARMUP)), [headLog('bench', 1), addedLog('bench', 2, { number: 2 })])
    const fromWarmup = applySetTypeChange({ row: rowKeyed(warmView, 'added:bench:1'), pick: staged('dropset', 1), session: warmView })
    expect(fromWarmup.renumber).toEqual([{ id: 'log.bench.added2', setNumber: 3 }])
  })
})

describe('DELETE of an open added set: a Warmup holds no working number to close, a working set does', () => {
  it('the same place, once as a Warmup and once as a working set: the logged set after it moves only for the working one', () => {
    // bench 01 logged; the first added set is open; the second is logged
    const warm = viewOf(orderOf([card('bench', 'n', { added: 2, drafts: [draftOf(key(2), WARMUP)] })]), [headLog('bench', 1), addedLog('bench', 2, { number: 2 })])
    expect(warm.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓'])
    expect(deleteEffects(rowKeyed(warm, 'added:bench:1'), warm)).toMatchObject({ deleteOrder: [], stageCount: 0, renumber: [], changes: [], headPatch: null, type: null })
    const working = viewOf(orderOf([card('bench', 'n', { added: 2, drafts: [draftOf(key(2), NORMAL)] })]), [headLog('bench', 1), addedLog('bench', 2, { number: 3 })])
    expect(working.rows.map(brief)).toEqual(['bench 01✓', 'bench 02·', 'bench 03✓'])
    expect(deleteEffects(rowKeyed(working, 'added:bench:1'), working)).toMatchObject({ deleteOrder: [], renumber: [{ id: 'log.bench.added2', setNumber: 2 }], changes: [] })
  })

  it('a drop of an open added dropset: the set keeps one drop fewer as its type, and nothing is renumbered', () => {
    const cards = [card('bench', 'n n n', { added: 1, types: [staged('dropset', 2)] })]
    const view = viewOf(orderOf(cards), threeLogged())
    const drop = rowKeyed(view, 'added:bench:1:stage:2')
    expect(deleteEffects(drop, view)).toMatchObject({ deleteOrder: [], renumber: [], changes: [], headPatch: null, type: staged('dropset', 1) })
  })
})

describe('addRound counts working rows only: an open added Warmup is not one', () => {
  it('a member with an added Warmup gets position 3 and one with an added working set 4', () => {
    const block = [{ id: 'blk', members: ['row', 'lat'] }]
    const position = (type: typeof WARMUP | typeof NORMAL) => {
      const order = orderOf([card('row', 'n n', { added: 1, types: [type] }), card('lat', 'n n')], block)
      return addRound(order, resolveRows(order, []), 'blk').map((p) => [p.exerciseKey, p.position])
    }
    expect(position(WARMUP)).toEqual([['row', 3], ['lat', 3]])
    expect(position(NORMAL)).toEqual([['row', 4], ['lat', 3]])
  })
})

describe('the finish warning lists planned sets only, whatever the added sets are', () => {
  it('open added sets of every type are not listed', () => {
    const cards = [card('bench', 'n n', { added: 3, types: [WARMUP, NORMAL, staged('dropset', 1)] })]
    const warning = finishWarning(orderOf(cards), [headLog('bench', 1)])
    expect(warning).toMatchObject({ count: 1, text: "1 planned set isn't logged yet: Bench 02." })
    expect(finishWarning(orderOf([card('bench', 'n', { added: 3, types: [WARMUP, NORMAL, staged('dropset', 1)] })]), [headLog('bench', 1)])).toBeNull()
  })
})

// ─── Unlog: the draft holds the type, so an unlog is undone exactly and nothing moves ────────────

/** The head rows (not their drops) as the screen keys and numbers them: what must not move on an unlog. */
const placesOf = (rows: readonly ResolvedRow[]) => rows.filter((r) => r.kind !== 'stage').map((r) => [r.key, r.kind, r.number, r.type] as const)

describe('unlog of an added set keeps its type in the draft (DECISIONS 161)', () => {
  it('an added Warmup unlogged comes back a Warmup, the open set after it keeps its number, and logging it again restores it', () => {
    // the review\'s F2: bench 01–03 logged, added A logged as 04 and made a Warmup, added B open
    const cards = [card('bench', 'n n n', { added: 2 })]
    const server = new FakeServer({ logs: [...threeLogged(), addedLog('bench', 1, { number: 4 })] })
    const start = viewOf(orderOf(cards), server.logs, server.held())
    expect(start.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 05·'])
    const a = rowKeyed(start, 'added:bench:1')
    const toWarmup = applySetTypeChange({ row: a, pick: WARMUP, session: start })
    expect(toWarmup).toMatchObject({ headPatch: { isWarmup: true, stageKind: null }, renumber: [], changes: [] })
    server.applySetType(toWarmup, a)
    const before = viewOf(orderOf(cards), server.logs, server.held())
    expect(before.rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const warmRow = rowKeyed(before, 'added:bench:1')
    expect(warmRow).toMatchObject({ kind: 'warmup', state: 'logged' })

    // UNLOG: the draft holds the type
    const unlog = unlogEffects(warmRow, { ...before, logs: server.logs })
    expect(unlog.deleteOrder.map((l) => l.id)).toEqual(['log.bench.added1'])
    expect(addedDraft(unlog).key).toEqual({ sessionId: SESSION, localId: 'log.bench.added1', exerciseId: 'ex.bench', position: 4 })
    expect(addedDraft(unlog).values).toMatchObject({ weight: 50, reps: 10, type: WARMUP })
    expect(unlog.changes).toEqual([])
    server.applyUnlog(unlog)
    const kept = [{ ...cards[0], drafts: [unlog.draft] }]
    const after = viewOf(orderOf(kept), server.logs, server.held())
    expect(after.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    // nothing moved: the same keys, kinds, numbers and types (only the set\'s own state and log differ)
    expect(placesOf(after.rows)).toEqual(placesOf(before.rows))
    expect(rowKeyed(after, 'added:bench:1')).toMatchObject({ state: 'unlogged', logId: null, draftPosition: 4, kind: 'warmup' })
    expect(currentSet(orderOf(kept), server.logs)!.key).toBe('added:bench:2')

    // logging it again with the type and the number the row shows restores it
    const columns = typeColumns(addedDraft(unlog).values.type)
    server.insertLog(addedLog('bench', 1, { number: rowKeyed(after, 'added:bench:1').number, warmup: columns.isWarmup }))
    const restored = rowsOf(dropOpenAdded(kept, rowKeyed(after, 'added:bench:1')), server.logs, server.held())
    expect(restored.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(placesOf(restored)).toEqual(placesOf(before.rows))
  })

  it('the control, the review\'s F2: the same draft with a Normal type brings the set back a working set, and the open set after it moves from 04 to 05', () => {
    const cards = [card('bench', 'n n n', { added: 2, drafts: [draftOf(key(4), NORMAL)] })]
    const rows = rowsOf(cards)
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 05·'])
    expect(rows.filter((r) => r.added).map((r) => [r.key, r.draftPosition, r.number])).toEqual([['added:bench:1', 4, 4], ['added:bench:2', null, 5]])
  })

  it('an added dropset unlogged comes back a dropset with its drops, and logging it again with its pending row restores the rows', () => {
    const headA = addedLog('bench', 1, { number: 4, stageKind: 'dropset' })
    const server = new FakeServer({ logs: [...threeLogged(), headA], changes: [{ ...pending(headA, 'dropset', 2), id: 'p1' }] })
    const cards = [card('bench', 'n n n', { added: 2 })]
    const before = viewOf(orderOf(cards), server.logs, server.held())
    expect(before.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04✓', 'bench 04.1·', 'bench 04.2·', 'bench 05·'])
    const head = rowKeyed(before, 'added:bench:1')
    expect(canUnlog(head, before)).toBe(true)
    const unlog = unlogEffects(head, { ...before, logs: server.logs })
    expect(addedDraft(unlog).values.type).toEqual(staged('dropset', 2))
    expect(unlog.changes).toEqual([])
    server.applyUnlog(unlog) // the log goes, and its pending row with it
    expect(server.held()).toEqual([])
    const kept = [{ ...cards[0], drafts: [unlog.draft] }]
    const after = viewOf(orderOf(kept), server.logs, server.held())
    expect(after.rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·', 'bench 04.1·', 'bench 04.2·', 'bench 05·'])
    expect(placesOf(after.rows)).toEqual(placesOf(before.rows))
    // log it again: the log with the draft's kind and the pending row with the draft's drop count
    const type = addedDraft(unlog).values.type
    expect(type.kind).toBe('staged')
    const again = addedLog('bench', 1, { number: rowKeyed(after, 'added:bench:1').number, stageKind: typeColumns(type).stageKind })
    server.insertLog(again)
    server.upsertChange({ change: pending(again, typeColumns(type).stageKind!, typeColumns(type).stageCount), id: null })
    const restored = viewOf(orderOf(dropOpenAdded(kept, rowKeyed(after, 'added:bench:1'))), server.logs, server.held())
    expect(restored.rows.map(brief)).toEqual(before.rows.map(brief))
    expect(placesOf(restored.rows)).toEqual(placesOf(before.rows))
  })

  it('a set that is logged as a Warmup right away and unlogged comes back the same, keyed by the number it was logged with', () => {
    // bench 01–03 logged, a new Warmup logged as W1 (stored 1), a new working set open (04)
    const cards = [card('bench', 'n n n', { added: 2, types: [WARMUP, NORMAL] })]
    const warm = rowsOf(cards)[0]
    const warmLog = addedLog('bench', 1, { number: warm.number, warmup: true })
    const afterLog = dropOpenAdded(cards, warm)
    const logs = [...threeLogged(), warmLog]
    const before = viewOf(orderOf(afterLog), logs)
    expect(before.rows.map(brief)).toEqual(['bench W1✓', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    const unlog = unlogEffects(rowKeyed(before, 'added:bench:1'), before)
    expect(unlog.draft.key).toMatchObject({ localId: warmLog.id, position: 1 })
    expect(addedDraft(unlog).values.type).toEqual(WARMUP)
    const server = new FakeServer({ logs })
    server.applyUnlog(unlog)
    const after = viewOf(orderOf([{ ...afterLog[0], drafts: [unlog.draft] }]), server.logs)
    expect(after.rows.map(brief)).toEqual(['bench W1·', 'bench 01✓', 'bench 02✓', 'bench 03✓', 'bench 04·'])
    expect(placesOf(after.rows)).toEqual(placesOf(before.rows))
  })

  it('a planned set\'s draft holds no type (its retyped row does), and neither does a drop\'s', () => {
    const planned = headLog('bench', 1)
    const plannedView = viewOf(orderOf([card('bench', 'n')]), [planned])
    const plannedUnlog = unlogEffects(rowKeyed(plannedView, 'set:bench.1'), plannedView)
    expect(Object.keys(plannedUnlog.draft.values).sort()).toEqual(['enteredUnit', 'formRating', 'reps', 'rir', 'weight'])
    expect('type' in plannedUnlog.draft.values).toBe(false)
    const head = addedLog('bench', 1, { number: 1, stageKind: 'dropset' })
    const logs: ReturnType<typeof addedLog>[] = [head, { ...addedLog('bench', 1, { number: 1 }), id: 'drop1', parentSetId: head.id, isDropset: true, stageIndex: 1 }]
    const view = viewOf(orderOf([card('bench', '', { added: 1 })]), logs, [{ ...pending(head, 'dropset', 1), id: 'p1' }])
    const dropUnlog = unlogEffects(rowKeyed(view, 'added:bench:1:stage:1'), view)
    expect(dropUnlog.draft.key).toMatchObject({ localId: head.id, drop: 1 })
    expect('type' in dropUnlog.draft.values).toBe(false)
  })

  it('every kind of type survives an unlog: a table over Normal, Warmup and each staged kind', () => {
    const types = [NORMAL, WARMUP, staged('dropset', 1), staged('rest_pause', 2), staged('myo_reps', 3), staged('cluster', 2)] as const
    for (const type of types) {
      const columns = typeColumns(type)
      const head = addedLog('bench', 1, { number: 4, warmup: columns.isWarmup, stageKind: columns.stageKind })
      const changes = type.kind === 'staged' ? [{ ...pending(head, type.stageKind, type.stageCount), id: 'p1' }] : []
      const server = new FakeServer({ logs: [...threeLogged(), head], changes })
      const cards = [card('bench', 'n n n', { added: 1 })]
      const before = viewOf(orderOf(cards), server.logs, server.held())
      const unlog = unlogEffects(rowKeyed(before, 'added:bench:1'), before)
      expect(addedDraft(unlog).values.type, JSON.stringify(type)).toEqual(type)
      server.applyUnlog(unlog)
      const after = viewOf(orderOf([{ ...cards[0], drafts: [unlog.draft] }]), server.logs, server.held())
      expect(rowKeyed(after, 'added:bench:1'), JSON.stringify(type)).toMatchObject({ state: 'unlogged', logId: null, type })
      expect(placesOf(after.rows), JSON.stringify(type)).toEqual(placesOf(before.rows))
      expect(after.rows.filter((r) => r.kind === 'stage').map((r) => r.state), JSON.stringify(type)).toEqual(
        Array.from({ length: type.kind === 'staged' ? type.stageCount : 0 }, () => 'unlogged'),
      )
    }
  })
})
