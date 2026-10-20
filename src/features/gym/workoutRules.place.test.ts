import { describe, expect, it } from 'vitest'
import type { SessionSetChangeType, SetLog } from '../../types'
import {
  applySetTypeChange,
  deleteEffects,
  finishWarning,
  movedSetEntries,
  nextAddedPlace,
  numberCorrections,
  resolveRows,
  unlogEffects,
  type AddedSet,
  type HeldDraft,
  type OrderExercise,
  type ResolvedRow,
  type UnlogEffects,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import { Session } from './workoutRules.session.testutil'
import { addedLog, brief, card, draftOf, dropLog, headLog, orderOf, rowKeyed, staged, viewOf } from './workoutRules.testutil'

// Chunk 46, sixth attempt: an added set's place (DECISIONS 173's second bullet, 174 (a), 177, 179; Adam 2026-10-19).
//   174: "an added set's place among the sets added to its exercise in that session, from 1, in the order they were added.
//   Written when the added set's log is first written …, kept on re-log after an unlog (the draft holds it until then).
//   Planned sets leave it null. A log with null added_place that has no planned set (anything logged before 045) orders as
//   the app orders it today (logged time, then id). That fallback is tested."
//   Its writers: "chunk 46 owns the rule (a pure function assigning the next place when an added set is created). It's
//   assigned once … No chunk ever changes it afterwards: delete, warmup switch and renumbering never touch added_place."
//   173: "A set added in a reopened session comes after every set added earlier. No two logs ever hold one number."
//   177: "Only an added set's own log carries added_place; its drop and stage logs leave it null."
//   179: "Sets moved by a swap for today count as added sets of the new exercise. Each gets its place at the swap, in their
//   order, after any sets already added to that exercise."
// Every expected value is written out by hand.

const NORMAL = { kind: 'normal' } as const
const WARMUP = { kind: 'warmup' } as const
const entry = (localId: string, place: number, logId: string | null = null, type: SessionSetChangeType = NORMAL): AddedSet => ({ localId, logId, type, place })
const threeLogged = (): SetLog[] => [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)]
/** The rule for a card alone in its session: `nextAddedPlace` over a session of that one card, for its exercise. */
const placeFor = (exercise: OrderExercise, logs: readonly SetLog[]): number => nextAddedPlace(orderOf([exercise]), exercise.exerciseId, logs)

/** A card's head rows as the user reads them, each named by who it is: "P2" a planned set, else the added set's own id. */
function read(rows: readonly ResolvedRow[], cardKey = 'bench'): string[] {
  return rows
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    .map((r) => `${brief(r).split(' ')[1]}=${r.added ? r.localId : `P${r.key.split('.').pop()}`}`)
}

// ─── The rule: a new added set's place ─────────────────────────────────────────────────────────

describe('nextAddedPlace: 1 + the highest place the card knows (DECISIONS 174)', () => {
  it('1 for the first set added to a card, then 1 + the highest: the list\'s, the logs\'', () => {
    expect(placeFor(card('bench', 'n n n'), threeLogged())).toBe(1)
    const one = card('bench', 'n n n', { added: [entry('a1', 1)] })
    expect(placeFor(one, threeLogged())).toBe(2)
    // a1 logged with its place, a2 open at 2
    const two = card('bench', 'n n n', { added: [entry('a1', 1, 'log.bench.added1'), entry('a2', 2)] })
    expect(placeFor(two, [...threeLogged(), addedLog('bench', 1, { number: 4, place: 1 })])).toBe(3)
  })

  it('after a delete: the next place is past every place given, not the count of the sets left (break: the list\'s length)', () => {
    // A, B, C added (1, 2, 3); B deleted: its entry goes. By count the next would be 3, C's place: two sets in one place.
    const left = card('bench', 'n', { added: [entry('A', 1), entry('C', 3)] })
    expect(placeFor(left, [headLog('bench', 1)])).toBe(4)
    const withD = { ...left, added: [...left.added!, entry('D', placeFor(left, [headLog('bench', 1)]))] }
    expect(read(resolveRows(orderOf([withD]), [headLog('bench', 1)]))).toEqual(['01✓=P1', '02·=A', '03·=C', '04·=D'])
  })

  it('reads the logs and the drafts too: a reopened session (no list) and a reload (no list, a draft)', () => {
    // no list at all, the logs of two added sets at 1 and 2 (another phone, or the session reopened)
    expect(placeFor(card('bench', 'n n n'), [...threeLogged(), addedLog('bench', 1, { number: 4, place: 1 }), addedLog('bench', 2, { number: 5, place: 2 })])).toBe(3)
    // no list, a draft at 5 (its set was unlogged and the list lost)
    const drafted = card('bench', 'n n n', { drafts: [draftOf({ sessionId: 's1', localId: 'gone', exerciseId: 'ex.bench', position: 4 }, NORMAL, 5)] })
    expect(placeFor(drafted, threeLogged())).toBe(6)
  })

  it('only the card\'s own added sets count: not another exercise\'s, not a planned set\'s log, and not a drop\'s log (177: the place is read from the head log only)', () => {
    const head = addedLog('bench', 1, { number: 4, place: 2 })
    // no writer puts a place on these logs; they carry one here so that reading them would show
    const strays: SetLog[] = [
      { ...dropLog(head, 1), addedPlace: 9 },
      { ...headLog('bench', 1), addedPlace: 8 },
      addedLog('row', 1, { place: 7 }),
    ]
    expect(placeFor(card('bench', 'n n n', { added: [entry('a1', 2, head.id)] }), [...threeLogged(), head, ...strays])).toBe(3)
  })

  it('refuses a list entry or a draft that has no place (a set with none would be drawn in a place nobody gave it), and a log the column would refuse', () => {
    const noPlace = { ...card('bench', 'n'), added: [{ localId: 'a1', logId: null, type: NORMAL } as unknown as AddedSet] }
    expect(() => placeFor(noPlace, [])).toThrow(TypeError)
    expect(() => resolveRows(orderOf([noPlace]), [])).toThrow(TypeError)
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const badPlace = { ...card('bench', 'n'), added: [entry('a1', bad)] }
      expect(() => resolveRows(orderOf([badPlace]), []), String(bad)).toThrow(TypeError)
    }
    const key = { sessionId: 's1', localId: 'gone', exerciseId: 'ex.bench', position: 2 }
    const draftNoPlace = { ...card('bench', 'n'), drafts: [{ key, values: { type: NORMAL } } as unknown as HeldDraft] }
    expect(() => resolveRows(orderOf([draftNoPlace]), [])).toThrow(TypeError)
    expect(() => placeFor(draftNoPlace, [])).toThrow(TypeError)
    // a draft's place may be null: the set was logged before 044 and had none
    const draftNull = { ...card('bench', 'n'), drafts: [draftOf(key, NORMAL, null)] }
    expect(resolveRows(orderOf([draftNull]), []).map((r) => r.addedPlace)).toEqual([null, null])
    expect(() => resolveRows(orderOf([card('bench', 'n')]), [addedLog('bench', 1, { place: 0 })])).toThrow(TypeError)
  })

  it('…and under tsc (these lines fail `npm run typecheck` if a place becomes optional)', () => {
    const key = { sessionId: 's1', localId: 'a1', exerciseId: 'ex.bench', position: 4 }
    // @ts-expect-error an entry of the card's list must say its set's place
    const noPlace: AddedSet = { localId: 'a1', logId: null, type: NORMAL }
    // @ts-expect-error a draft of a set added in the session must say its place (null for one logged before 044)
    const draftNoPlace: HeldDraft = { key, values: { type: NORMAL } }
    // @ts-expect-error what unlogging an added set answers carries the place in its values
    const noPlaceAnswered: UnlogEffects['draft'] = { key, values: { weight: 1, reps: 1, rir: null, formRating: null, enteredUnit: null, type: NORMAL } }
    // the control: each with its place
    const ok: AddedSet = { localId: 'a1', logId: null, type: NORMAL, place: 1 }
    const draftOk: HeldDraft = { key, values: { type: NORMAL, place: null, loggedAt: '2026-10-12T18:10:00Z' } }
    expect([noPlace, draftNoPlace, noPlaceAnswered, ok, draftOk].length).toBe(5)
  })
})

// ─── The order: by place, whichever record holds it ────────────────────────────────────────────

describe('the added sets in their places, whichever record holds the place (DECISIONS 170, 174)', () => {
  it('the card\'s entries, the logs it doesn\'t list and the drafts no listed set has are one order: by place, then by their own id', () => {
    const cards = [
      card('bench', 'n n', {
        added: [entry('e4', 4), entry('e1', 1, 'log.bench.added1')],
        drafts: [draftOf({ sessionId: 's1', localId: 'd3', exerciseId: 'ex.bench', position: 9 }, NORMAL, 3)],
      }),
    ]
    const logs = [headLog('bench', 1), headLog('bench', 2), addedLog('bench', 1, { number: 3, place: 1 }), addedLog('bench', 5, { number: 4, place: 5 }), addedLog('bench', 2, { number: 9, place: 2 })]
    const rows = resolveRows(orderOf(cards), logs)
    expect(read(rows)).toEqual(['01✓=P1', '02✓=P2', '03✓=e1', '04✓=log.bench.added2', '05·=d3', '06·=e4', '07✓=log.bench.added5'])
    expect(rows.map((r) => r.addedPlace)).toEqual([null, null, 1, 2, 3, 4, 5])
    // two sets in one place (two phones adding at once), neither logged: by their own id
    const tie = [card('bench', 'n', { added: [entry('zz', 1), entry('aa', 1)] })]
    expect(read(resolveRows(orderOf(tie), [headLog('bench', 1)]))).toEqual(['01✓=P1', '02·=aa', '03·=zz'])
  })

  it('two phones that each added a set at place 1: once both are logged, both phones draw them in one order (by log id), so their draws never correct each other back and forth (178)', () => {
    // phone 1 added "p1" and logged it (log.b, 02); phone 2, which saw no place, added "p2" at place 1 too and logged it (log.a, 02)
    const fromPhone1 = { ...addedLog('bench', 1, { number: 2, place: 1 }), id: 'log.b' }
    const fromPhone2 = { ...addedLog('bench', 2, { number: 2, place: 1 }), id: 'log.a' }
    const logs = [headLog('bench', 1), fromPhone1, fromPhone2]
    const phone1 = orderOf([card('bench', 'n', { added: [entry('p1', 1, 'log.b')] })])
    const phone2 = orderOf([card('bench', 'n', { added: [entry('p2', 1, 'log.a')] })])
    const ids = (order: ReturnType<typeof orderOf>) => resolveRows(order, logs).filter((r) => r.added).map((r) => r.logId)
    expect(ids(phone1)).toEqual(['log.a', 'log.b'])
    expect(ids(phone2)).toEqual(['log.a', 'log.b'])
    // phone 1 draws and writes its corrections; phone 2 then has none to write: the two agree
    const corrections = numberCorrections(phone1, logs)
    expect(corrections).toEqual([{ id: 'log.b', setNumber: 3 }])
    const after = logs.map((l) => (l.id === 'log.b' ? { ...l, setNumber: 3 } : l))
    expect(numberCorrections(phone2, after)).toEqual([])
    expect(numberCorrections(phone1, after)).toEqual([])
  })

  it('F2 (review 5\'s probe): a session reopened with two added sets logged as 04 and 05, + ADD SET and LOG: A 04, B 05, N 06, stored 4, 5 and 6, three REVIEW items', () => {
    const s = new Session([card('bench', 'n n n')], [], [...threeLogged(), addedLog('bench', 1, { number: 4, place: 1 }), addedLog('bench', 2, { number: 5, place: 2 })])
    // the card lists nothing: the session was reopened (its list ended with it), or this is another phone
    expect(read(s.rows())).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04✓=log.bench.added1', '05✓=log.bench.added2'])
    const n = s.add('bench', 'N')
    expect(s.row(n).addedPlace).toBe(3)
    expect(read(s.rows())).toEqual(['01✓=P1', '02✓=P2', '03✓=P3', '04✓=log.bench.added1', '05✓=log.bench.added2', '06·=N'])
    const log = s.log(n)
    expect([log.setNumber, log.addedPlace]).toEqual([6, 3])
    expect(s.server.logs.filter((l) => l.weekPlanSetId === null).map((l) => [l.setNumber, l.addedPlace])).toEqual([
      [4, 1],
      [5, 2],
      [6, 3],
    ])
    expect(s.reviewAddedSetKeys()).toEqual(['added-set:s1:ex.bench:4', 'added-set:s1:ex.bench:5', 'added-set:s1:ex.bench:6'])
    // the control, the card that took A and B into its list first, gives the same
    const t = new Session([card('bench', 'n n n', { added: [addedLog('bench', 1, { number: 4, place: 1 }), addedLog('bench', 2, { number: 5, place: 2 })] })], [], [...threeLogged(), addedLog('bench', 1, { number: 4, place: 1 }), addedLog('bench', 2, { number: 5, place: 2 })])
    t.add('bench', 'N')
    expect(t.log('added:bench:N').setNumber).toBe(6)
  })

  it('the two histories that store the same rows but for the place (builder 6\'s probe): after a reopen each comes back in the order it was added', () => {
    // H1: A then B added; LOG A (04), LOG B (05); A made a Warmup. H2: X then Y added; LOG Y (05), LOG X (04); Y made a Warmup.
    const h1 = new Session([card('bench', 'n n n')], [], threeLogged())
    h1.add('bench', 'A')
    h1.add('bench', 'B')
    h1.log('added:bench:A')
    h1.log('added:bench:B')
    h1.retype('added:bench:A', WARMUP)
    const h2 = new Session([card('bench', 'n n n')], [], threeLogged())
    h2.add('bench', 'X')
    h2.add('bench', 'Y')
    h2.log('added:bench:Y')
    h2.log('added:bench:X')
    h2.retype('added:bench:Y', WARMUP)
    // the rows a log holds: the same in both but for the place (and the ids)
    const shape = (s: Session) => s.server.logs.filter((l) => l.weekPlanSetId === null).map((l) => [l.isWarmup, l.setNumber, l.addedPlace]).sort()
    expect(shape(h1)).toEqual([
      [false, 4, 2],
      [true, 1, 1],
    ])
    expect(shape(h2)).toEqual([
      [false, 4, 1],
      [true, 1, 2],
    ])
    for (const s of [h1, h2]) expect(s.reopen()).toEqual([])
    // made Normal again after the reopen, each set is back where it was added
    const warmup = (s: Session) => s.rows().find((r) => r.added && r.kind === 'warmup')!.key
    h1.retype(warmup(h1), NORMAL)
    h2.retype(warmup(h2), NORMAL)
    const who = (s: Session) => s.rows().filter((r) => r.added).map((r) => [r.number, r.addedPlace])
    expect(who(h1)).toEqual([
      [4, 1],
      [5, 2],
    ])
    expect(who(h2)).toEqual([
      [4, 1],
      [5, 2],
    ])
    // H1's 04 is A (logged first), H2's 04 is X (logged second): the place, not the time or the number, decides
    expect(h1.server.logs.find((l) => l.addedPlace === 1)!.setNumber).toBe(4)
    expect(h2.server.logs.find((l) => l.addedPlace === 1)!.setNumber).toBe(4)
  })
})

// ─── Logged before 044: no place ───────────────────────────────────────────────────────────────

describe('a log with no place and no planned set (logged before 044) orders as the app did: logged time, then id (DECISIONS 174)', () => {
  const at = (minute: number) => `2026-10-12T18:${String(minute).padStart(2, '0')}:00Z`

  it('by the time it was logged, whatever number it holds and whatever order the logs come in; the same time, by id', () => {
    const logs = [
      headLog('bench', 1),
      addedLog('bench', 1, { number: 5, loggedAt: at(20) }),
      addedLog('bench', 2, { number: 3, loggedAt: at(10) }),
      addedLog('bench', 4, { number: 2, loggedAt: at(30) }),
      addedLog('bench', 3, { number: 9, loggedAt: at(30) }),
    ]
    const want = ['01✓=P1', '02✓=log.bench.added2', '03✓=log.bench.added1', '04✓=log.bench.added3', '05✓=log.bench.added4']
    expect(read(resolveRows(orderOf([card('bench', 'n')]), logs))).toEqual(want)
    expect(read(resolveRows(orderOf([card('bench', 'n')]), [...logs].reverse()))).toEqual(want)
    // the server's own timestamps (PostgREST's timestamptz: microseconds and an offset) read the same way: 18:10:00.5Z first
    const pg = [addedLog('bench', 1, { loggedAt: '2026-10-12T18:20:00.123456+00:00' }), addedLog('bench', 2, { loggedAt: '2026-10-12T20:10:00.5+02:00' })]
    expect(read(resolveRows(orderOf([card('bench', 'n')]), [headLog('bench', 1), ...pg]))).toEqual(['01✓=P1', '02✓=log.bench.added2', '03✓=log.bench.added1'])
  })

  it('before every set that has a place: those were added later, by 1.2 (173: a set added in a reopened session comes after every earlier one)', () => {
    const old = [addedLog('bench', 1, { number: 2, loggedAt: at(10) }), addedLog('bench', 2, { number: 3, loggedAt: at(11) })]
    const cards = [card('bench', 'n', { added: [entry('new', 1)] })]
    expect(read(resolveRows(orderOf(cards), [headLog('bench', 1), ...old]))).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added2', '04·=new'])
    // and the rule gives a new set 1 there: no log of those two has a place to count
    expect(placeFor(card('bench', 'n'), [headLog('bench', 1), ...old])).toBe(1)
  })

  it('a log without the key at all (every SetLog built before chunk 46) is one with null (break: only `=== null` counts as no place)', () => {
    const absent = addedLog('bench', 1, { number: 2, loggedAt: at(10) })
    expect('addedPlace' in absent).toBe(false)
    const withNull = addedLog('bench', 2, { number: 3, loggedAt: at(11), place: null })
    const cards = [card('bench', 'n', { added: [entry('new', 1)] })]
    const rows = resolveRows(orderOf(cards), [headLog('bench', 1), withNull, absent])
    expect(read(rows)).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added2', '04·=new'])
    expect(rows.map((r) => r.addedPlace)).toEqual([null, null, null, 1])
  })

  it('177: a drop or stage log (null place, no planned set) is never taken for a set logged before 044, nor for an added set: it is its head\'s drop', () => {
    const head = addedLog('bench', 1, { number: 2, place: 1, stageKind: 'dropset' })
    const drop = dropLog(head, 1)
    expect([drop.weekPlanSetId, drop.addedPlace ?? null]).toEqual([null, null])
    const cards = [card('bench', 'n', { added: [entry('a1', 1, head.id, staged('dropset', 1))] })]
    const rows = resolveRows(orderOf(cards), [headLog('bench', 1), head, drop])
    expect(rows.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 02.1✓'])
    expect(rows.filter((r) => r.added && r.kind !== 'stage').map((r) => r.key)).toEqual(['added:bench:a1'])
    expect(rows[2]).toMatchObject({ kind: 'stage', headKey: 'added:bench:a1', addedPlace: null })
    // the same with no list (a reopened session): still one added set, its drop under it
    const reopened = resolveRows(orderOf([card('bench', 'n')]), [headLog('bench', 1), head, drop])
    expect(reopened.map(brief)).toEqual(['bench 01✓', 'bench 02✓', 'bench 02.1✓'])
  })

  it('184 (b): a set logged before 044 and unlogged keeps its log\'s time in its draft and is drawn in its place, so the unlog moves nothing; logged again (63 writes the time it happens) it moves to after the others, and the draw writes the numbers that moved', () => {
    const older = [addedLog('bench', 1, { number: 2, loggedAt: at(10) }), addedLog('bench', 2, { number: 3, loggedAt: at(11) }), addedLog('bench', 3, { number: 4, loggedAt: at(12) })]
    const server = new FakeServer({ logs: [headLog('bench', 1), ...older] })
    let cards: OrderExercise[] = [card('bench', 'n')]
    const view = viewOf(orderOf(cards), server.logs, server.held())
    expect(read(view.rows)).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added2', '04✓=log.bench.added3'])
    const middle = rowKeyed(view, 'added:bench:log.bench.added2')
    const unlog = unlogEffects(middle, view)
    expect(unlog.draft.values).toMatchObject({ place: null, loggedAt: at(11) })
    server.applyUnlog(unlog)
    cards = [{ ...cards[0], drafts: [unlog.draft as HeldDraft] }]
    // drawn in its place: every other row reads as it did (break: draw the draft after the others, the sixth attempt's order)
    const open = resolveRows(orderOf(cards), server.logs, server.held())
    expect(read(open)).toEqual(['01✓=P1', '02✓=log.bench.added1', '03·=log.bench.added2', '04✓=log.bench.added3'])
    const others = (rows: readonly ResolvedRow[]) => rows.filter((r) => r.key !== middle.key).map((r) => [r.key, r.number, r.state])
    expect(others(open)).toEqual(others(view.rows))
    expect(numberCorrections(orderOf(cards), server.logs, server.held())).toEqual([])
    // logged again: no place, and the time it happens, so after the other sets logged before 044; the draw then writes 3 and 4
    server.insertLog({ ...older[1], id: 'again', setNumber: 3, loggedAt: at(40), addedPlace: null })
    const relogged = orderOf([card('bench', 'n')])
    expect(read(resolveRows(relogged, server.logs, server.held()))).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added3', '04✓=again'])
    expect(numberCorrections(relogged, server.logs, server.held())).toEqual([
      { id: 'log.bench.added3', setNumber: 3 },
      { id: 'again', setNumber: 4 },
    ])
  })

  it('184 (b): such drafts and logs are one order by time, whatever order they come in; the draft of one with no time is refused (it would be drawn where nobody put it), and under tsc', () => {
    const logs = [headLog('bench', 1), addedLog('bench', 1, { number: 2, loggedAt: at(10) }), addedLog('bench', 3, { number: 4, loggedAt: at(12) })]
    const key = (localId: string, position: number) => ({ sessionId: 's1', localId, exerciseId: 'ex.bench', position })
    const drafts = [draftOf(key('log.bench.added4', 5), NORMAL, null, at(13)), draftOf(key('log.bench.added2', 3), WARMUP, null, at(11))]
    const want = ['W1·=log.bench.added2', '01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added3', '04·=log.bench.added4']
    for (const list of [drafts, [...drafts].reverse()]) expect(read(resolveRows(orderOf([card('bench', 'n', { drafts: list })]), [...logs].reverse()))).toEqual(want)
    const noTime = { key: key('log.bench.added2', 3), values: { type: NORMAL, place: null } } as unknown as HeldDraft
    expect(() => resolveRows(orderOf([card('bench', 'n', { drafts: [noTime] })]), logs)).toThrow(TypeError)
    expect(() => nextAddedPlace(orderOf([card('bench', 'n', { drafts: [noTime] })]), 'ex.bench', logs)).toThrow(TypeError)
    // a draft with a place is drawn by its place: its time is not read
    const placed = { key: key('p1', 2), values: { type: NORMAL, place: 1, loggedAt: 'not a time' } } as HeldDraft
    expect(read(resolveRows(orderOf([card('bench', 'n', { drafts: [placed] })]), [headLog('bench', 1)]))).toEqual(['01✓=P1', '02·=p1'])
    // @ts-expect-error a draft of a set added in the session keeps its log's time (184 (b))
    const draftNoTime: HeldDraft = { key: key('a', 2), values: { type: NORMAL, place: null } }
    // @ts-expect-error what unlogging an added set answers carries the time in its values
    const noTimeAnswered: UnlogEffects['draft'] = { key: key('a', 2), values: { weight: 1, reps: 1, rir: null, formRating: null, enteredUnit: null, type: NORMAL, place: null } }
    expect([draftNoTime, noTimeAnswered].length).toBe(2)
  })
})

// ─── 179 and 183: the sets a swap for today moves ──────────────────────────────────────────────

describe('a swap for today: the moved sets are added sets of the new exercise, numbered in one list with the card they left (DECISIONS 179, 183 (a) and its follow-ups)', () => {
  // The swap as 59 makes it (the session driver's `swap`): the open sets of a card move to a card of their own for the new
  // exercise, drawn after it; today's swap skips them on the old card; the new card lists them and keeps the swap's record.
  const lat = (spec: string, logged: number[], more: OrderExercise[] = []) => new Session([card('lat', spec), ...more], [], logged.map((i) => headLog('lat', i)))

  it('W5: Lat Pulldown 01 and 02 logged and its 03 (a dropset) moved to Machine Pulldown: Lat Pulldown 01, 02; Machine Pulldown 03 with its drop; + ADD SET there, 04 (break: number the new card alone, 01)', () => {
    const s = lat('n n d1', [1, 2])
    const m = s.swap('lat', 'machine')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03·`, `${m} 03.1·`])
    // the original card draws no row for the set that moved, though the swap skipped it there (break: draw it there too)
    expect(s.server.logs.find((l) => l.weekPlanSetId === 'lat.3')).toMatchObject({ isSkipped: true })
    expect(s.rows().filter((r) => r.exerciseKey === 'lat').map((r) => r.key)).toEqual(['set:lat.1', 'set:lat.2'])
    expect(finishWarning(s.order(), s.server.logs, s.server.held())).toBeNull()
    // LOG stores the number its row shows, the place the swap gave it and its type
    const moved = s.rows().find((r) => r.exerciseKey === m && r.kind === 'working')!
    expect([moved.type, moved.slotKey, moved.addedPlace]).toEqual([staged('dropset', 1), 'lat', 1])
    const log = s.log(moved.key)
    expect([log.setNumber, log.addedPlace, log.exerciseId, log.stageKind]).toEqual([3, 1, 'ex.machine', 'dropset'])
    const added = s.add(m)
    expect([brief(s.row(added)), s.row(added).addedPlace]).toEqual([`${m} 04·`, 2])
    // reopened (no list): the moved set is drawn on the new card in its place, and the draw writes nothing
    expect(s.reopen()).toEqual([])
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03✓`, `${m} 03.1·`])
  })

  it('183\'s first case: Lat Pulldown 01 logged, 02 open, 03 logged, 04 open, the swap moving 02 and 04: Lat Pulldown 01, 02 (its logged 03 becomes 02) and the new card 03, 04; the draw writes 03\'s number', () => {
    const s = lat('n n n n', [1, 3])
    const m = s.swap('lat', 'machine')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03·`, `${m} 04·`])
    expect(s.rows().map((r) => r.key).slice(0, 2)).toEqual(['set:lat.1', 'set:lat.3'])
    // in the order they stood, each with the place it took (179)
    expect(s.rows().slice(2).map((r) => r.addedPlace)).toEqual([1, 2])
    expect(s.card(m).swappedFrom).toEqual({ fromKey: 'lat', moved: [{ from: { weekPlanSetId: 'lat.2' }, place: 1 }, { from: { weekPlanSetId: 'lat.4' }, place: 2 }] })
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([{ id: 'log.lat.3', setNumber: 2 }])
    s.draw()
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    expect(s.rows().slice(2).map((r) => s.log(r.key).setNumber)).toEqual([3, 4])
  })

  it('a delete or a Warmup switch on either card renumbers both, as on any card (break: renumber one card only)', () => {
    const s = lat('n n n n', [1, 3])
    const m = s.swap('lat', 'machine')
    s.draw()
    const first = s.rows().find((r) => r.exerciseKey === m)!
    const firstLog = s.log(first.key)
    // DELETE lat's 01: its 03 (now 02) and the new card's logged 03 each move down one
    const effects = s.delete('set:lat.1')
    expect(effects.renumber).toEqual([
      { id: 'log.lat.3', setNumber: 1 },
      { id: firstLog.id, setNumber: 2 },
    ])
    expect(s.rows().map(brief)).toEqual(['lat 01✓', `${m} 02✓`, `${m} 03·`])
    // lat's last set made a Warmup: the new card's logged set takes 01
    const switched = s.retype('set:lat.3', WARMUP)
    expect(switched.renumber).toEqual([{ id: firstLog.id, setNumber: 1 }])
    expect(s.rows().map(brief)).toEqual(['lat W1✓', `${m} 01✓`, `${m} 02·`])
    // and on the new card: its logged set made a Warmup is W2 (after lat's W1), its open one 01
    expect(s.retype(first.key, WARMUP).renumber).toEqual([{ id: firstLog.id, setNumber: 2 }])
    expect(s.rows().map(brief)).toEqual(['lat W1✓', `${m} W2✓`, `${m} 01·`])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
  })

  it('183\'s follow-up: a swap into a card that already has added sets puts the moved sets after them, and no logged set is renumbered (break: put them before; restart the places at 1)', () => {
    // a second swap from the same card into the card the first one made
    const s = lat('n n n', [1])
    const m = s.swap('lat', 'machine')
    const kept = s.log(s.rows().find((r) => r.exerciseKey === m)!.key)
    const later = s.add(m)
    expect(s.rows().map(brief)).toEqual(['lat 01✓', `${m} 02✓`, `${m} 03·`, `${m} 04·`])
    // a set added to the original card after the swap is one of its sets that didn't move: the new card's sets come after it
    s.add('lat', 'N')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02·', `${m} 03✓`, `${m} 04·`, `${m} 05·`])
    expect(s.swap('lat', 'machine')).toBe(m)
    const rows = s.rows()
    expect(rows.map(brief)).toEqual(['lat 01✓', `${m} 02✓`, `${m} 03·`, `${m} 04·`, `${m} 05·`])
    // the moved set came after the new card's earlier sets, the one added after the first swap included
    expect(rows.filter((r) => r.exerciseKey === m).map((r) => r.addedPlace)).toEqual([1, 2, 3, 4])
    expect(rows.find((r) => r.addedPlace === 3)!.key).toBe(later)
    expect(s.server.logs.find((l) => l.id === kept.id)!.setNumber).toBe(2)
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    expect(s.card(m).swappedFrom!.moved.map((x) => x.place)).toEqual([1, 2, 4])
  })

  it('183\'s follow-ups: a swap into an exercise that has a card of its own with added sets: the moved sets\' places come after its added sets, the swap\'s card reads on from the card it replaced, and the exercise\'s own card is numbered on its own and keeps its sets (break: number the two cards of one exercise as one list)', () => {
    const dip = card('dip', '', { added: [addedLog('dip', 1, { number: 1, place: 1 }), { kind: 'normal' }] })
    const s = lat('n n n', [1, 2], [dip])
    s.server.insertLog(addedLog('dip', 1, { number: 1, place: 1 }))
    const m = s.swap('lat', 'dip')
    let rows = s.rows()
    expect(rows.map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03·`, 'dip 01✓', 'dip 02·'])
    expect(rows.find((r) => r.exerciseKey === m)!.addedPlace).toBe(3)
    const moved = s.log(rows.find((r) => r.exerciseKey === m)!.key)
    expect([moved.setNumber, moved.addedPlace]).toEqual([3, 3])
    rows = s.rows()
    expect(rows.map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03✓`, 'dip 01✓', 'dip 02·'])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
    // with no list (a reopened session): each set is still drawn on its own card, the moved one by the swap's record
    expect(s.reopen()).toEqual([])
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03✓`, 'dip 01✓'])
    // and a set added now takes a place after every place the exercise has given, on either card
    expect(nextAddedPlace(s.order(), 'ex.dip', s.server.logs)).toBe(4)
  })

  it('…the record\'s places count when nothing else holds them: reloaded before the moved set is logged, a set added to the exercise\'s own card takes the next place and stays on that card (break: the rule ignores the record)', () => {
    const dip = card('dip', '', { added: [addedLog('dip', 1, { number: 1, place: 1 })] })
    const s = lat('n n n', [1, 2], [dip])
    s.server.insertLog(addedLog('dip', 1, { number: 1, place: 1 }))
    const m = s.swap('lat', 'dip')
    s.reload()
    // the moved set had neither a log nor a draft: it is gone with the list, but its place is the swap's
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', 'dip 01✓'])
    const added = s.add('dip', 'X')
    expect([s.row(added).addedPlace, s.row(added).exerciseKey]).toEqual([3, 'dip'])
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', 'dip 01✓', 'dip 02·'])
    void m
  })

  it('183\'s follow-up: a swap into a card that held sets of its own before (an exercise added in the session): the moved sets come after its sets, and it keeps its own numbering, so no logged set of it is renumbered (break: it reads on from the card the sets left)', () => {
    // the screen may move the sets into the exercise's own card instead of a new one: the record on that card
    const own = addedLog('dip', 1, { number: 1, place: 1 })
    const s = lat('n n n', [1, 2], [card('dip', '', { added: [own] })])
    s.server.insertLog(own)
    const rows = s.rows()
    const moves = movedSetEntries(s.order(), s.server.logs, { exerciseId: 'ex.dip', name: 'Dip' }, [{ row: rows.find((r) => r.key === 'set:lat.3')!, localId: 'm' }])
    expect(moves.entries.map((e) => e.place)).toEqual([2])
    s.cards = s.cards.map((c) => (c.key === 'dip' ? { ...c, added: [...c.added!, ...moves.entries], swappedFrom: moves.record } : c))
    const after = s.rows()
    expect(after.map(brief)).toEqual(['lat 01✓', 'lat 02✓', 'dip 01✓', 'dip 02·'])
    expect(after.filter((r) => r.exerciseKey === 'dip').map((r) => r.slotKey)).toEqual(['dip', 'dip'])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
  })

  it('…and so does a card of the plan that a swap brought sets into: its planned sets, then the moved sets, numbered on its own (break: it reads on from the card the sets left)', () => {
    const s = lat('n n n', [1, 2], [card('press', 'n n')])
    s.server.insertLog(headLog('press', 1))
    const moves = movedSetEntries(s.order(), s.server.logs, { exerciseId: 'ex.press', name: 'Press' }, [{ row: s.row('set:lat.3'), localId: 'm' }])
    s.cards = s.cards.map((c) => (c.key === 'press' ? { ...c, added: moves.entries, swappedFrom: moves.record } : c))
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', 'press 01✓', 'press 02·', 'press 03·'])
    expect(numberCorrections(s.order(), s.server.logs, s.server.held())).toEqual([])
  })

  it('the rule reads every card of the exercise and every place a swap\'s record names: a set moved away with nothing else holding its place, and two cards of one exercise each holding open sets (break: the record\'s moved-away places, or the other card, left out)', () => {
    // an added set of lat moved away; the card dropped it from its list and the swap wrote no skip: only the record names place 1
    const lat1: OrderExercise = { ...card('lat', 'n'), added: [] }
    const made: OrderExercise = { ...card('machine', ''), added: [{ localId: 'm', logId: null, type: NORMAL, place: 1 }], swappedFrom: { fromKey: 'lat', moved: [{ from: { addedPlace: 1 }, place: 1 }] } }
    const order = orderOf([lat1, made])
    expect(nextAddedPlace(order, 'ex.lat', [])).toBe(2)
    // a set added to lat now is drawn there (place 1 would be taken for the set that moved, and drawn nowhere)
    const withNew = orderOf([{ ...lat1, added: [{ localId: 'n', logId: null, type: NORMAL, place: nextAddedPlace(order, 'ex.lat', []) }] }, made])
    expect(resolveRows(withNew, []).map(brief)).toEqual(['lat 01·', 'lat 02·', 'machine 03·'])
    // two cards of dip, each with open sets: a set added to either takes a place after both cards' places
    const own: OrderExercise = { ...card('dip', ''), added: [{ localId: 'd1', logId: null, type: NORMAL, place: 1 }, { localId: 'd4', logId: null, type: NORMAL, place: 4 }] }
    const swapped: OrderExercise = { ...card('dipswap', ''), exerciseId: 'ex.dip', added: [{ localId: 'm3', logId: null, type: NORMAL, place: 3 }], swappedFrom: { fromKey: 'lat', moved: [{ from: { weekPlanSetId: 'lat.1' }, place: 3 }] } }
    expect(nextAddedPlace(orderOf([card('lat', 'n'), swapped, own]), 'ex.dip', [])).toBe(5)
    expect(nextAddedPlace(orderOf([card('lat', 'n'), own, swapped]), 'ex.dip', [])).toBe(5)
  })

  it('183\'s follow-up: one exercise on two cards that no swap joins is numbered on each card on its own; a set of it that no list or record places is drawn on its first card (a reading: the words don\'t say which card)', () => {
    const second = { ...card('pressb', 'n n'), exerciseId: 'ex.press', name: 'Press again' }
    const a1 = addedLog('press', 1, { number: 3, place: 1 })
    const b1 = { ...addedLog('press', 2, { number: 3, place: 2 }) }
    const listed = orderOf([card('press', 'n n', { added: [a1] }), { ...second, added: [{ localId: 'b1', logId: b1.id, type: NORMAL, place: 2 }] }])
    const logs = [headLog('press', 1), { ...headLog('pressb', 1), exerciseId: 'ex.press' }, a1, b1]
    expect(resolveRows(listed, logs).map(brief)).toEqual(['press 01✓', 'press 02·', 'press 03✓', 'pressb 01✓', 'pressb 02·', 'pressb 03✓'])
    expect(resolveRows(listed, logs).map((r) => r.slotKey)).toEqual(['press', 'press', 'press', 'pressb', 'pressb', 'pressb'])
    expect(numberCorrections(listed, logs)).toEqual([])
    const unlisted = orderOf([card('press', 'n n'), second])
    expect(resolveRows(unlisted, logs).map(brief)).toEqual(['press 01✓', 'press 02·', 'press 03✓', 'press 04✓', 'pressb 01✓', 'pressb 02·'])
    expect(() => resolveRows(orderOf([card('press', 'n n', { added: [a1] }), { ...second, added: [{ localId: 'x', logId: a1.id, type: NORMAL, place: 1 }] }]), logs)).toThrow(RangeError)
  })

  it('refuses a swap of a set that isn\'t open, of two cards\' sets, of a set added before 044 (no place to name it by), a set the new exercise\'s cards already list, and a record that names no other card', () => {
    const s = lat('n n n', [1], [card('dip', '', { added: [{ kind: 'normal' }] })])
    const rows = s.rows()
    const move = (picked: ResolvedRow[], ids = picked.map((_, i) => `m${i}`)) => () => movedSetEntries(s.order(), s.server.logs, { exerciseId: 'ex.machine', name: 'Machine' }, picked.map((row, i) => ({ row, localId: ids[i] })))
    expect(move([rows[0]])).toThrow(RangeError)
    expect(move([rows[1], rows.find((r) => r.exerciseKey === 'dip')!])).toThrow(RangeError)
    expect(move([rows[1], rows[2]], ['m', 'm'])).toThrow(RangeError)
    expect(() => movedSetEntries(s.order(), s.server.logs, { exerciseId: 'ex.dip', name: 'Dip' }, [{ row: rows[1], localId: 'a1' }])).toThrow(RangeError)
    const old = resolveRows(orderOf([card('lat', 'n', { drafts: [draftOf({ sessionId: 's1', localId: 'o', exerciseId: 'ex.lat', position: 2 }, NORMAL, null)] })]), [])
    expect(() => movedSetEntries(orderOf([card('lat', 'n')]), [], { exerciseId: 'ex.machine', name: 'Machine' }, [{ row: old[1], localId: 'm' }])).toThrow(RangeError)
    // given in another order, the moved sets keep the order they stood in
    const twice = movedSetEntries(s.order(), s.server.logs, { exerciseId: 'ex.machine', name: 'Machine' }, [{ row: rows[2], localId: 'y' }, { row: rows[1], localId: 'x' }])
    expect(twice.entries.map((e) => [e.localId, e.place])).toEqual([['x', 1], ['y', 2]])
    const orphan = { ...card('machine', ''), swappedFrom: { fromKey: 'nowhere', moved: [] } }
    expect(() => orderOf([card('lat', 'n'), orphan])).toThrow(RangeError)
    expect(() => orderOf([{ ...card('lat', 'n'), swappedFrom: { fromKey: 'lat', moved: [] } }])).toThrow(RangeError)
  })
})

// ─── A place is never changed ──────────────────────────────────────────────────────────────────

describe('no rule changes a place: delete, a Warmup switch, a type change, the renumbering and the corrections carry numbers only (DECISIONS 174)', () => {
  it('every log keeps its place through each of them, and no patch they answer names a place (absence)', () => {
    const logs = [
      ...threeLogged(),
      addedLog('bench', 1, { number: 4, place: 1 }),
      addedLog('bench', 2, { number: 5, place: 2 }),
      addedLog('bench', 3, { number: 6, place: 3, stageKind: 'dropset' }),
    ]
    const cards = [card('bench', 'n n n', { added: [logs[3], logs[4], { localId: 'a3', logId: logs[5].id, type: staged('dropset', 1), place: 3 }] })]
    const order = orderOf(cards)
    const server = new FakeServer({ logs: [...logs, dropLog(logs[5], 1)] })
    const places = () => server.logs.map((l) => [l.id, l.addedPlace ?? null])
    const before = places()
    const patchesSeen: object[] = []
    const step = (key: string, what: 'delete' | 'warmup' | 'normal' | 'staged') => {
      const view = viewOf(order, server.logs, server.held())
      const row = rowKeyed(view, key)
      if (what === 'delete') {
        const effects = deleteEffects(row, view)
        patchesSeen.push(...effects.renumber, ...(effects.headPatch ? [effects.headPatch] : []))
        server.applyDelete(effects)
      } else {
        const pick = what === 'warmup' ? WARMUP : what === 'normal' ? NORMAL : staged('dropset', 2)
        const effects = applySetTypeChange({ row, pick, session: view })
        patchesSeen.push(...effects.renumber, ...(effects.headPatch ? [effects.headPatch] : []))
        server.applySetType(effects, row)
      }
    }
    step('added:bench:a1', 'warmup') // the added set at 1 made a Warmup: the ones after it move down
    step('set:bench.2', 'delete') // a planned set before them deleted
    step('added:bench:a1', 'normal') // and back
    step('added:bench:a2', 'staged')
    // the session with a stale stored number: the corrections carry numbers only
    server.patchLog('log.bench.added2', { setNumber: 9 })
    const corrections = numberCorrections(order, server.logs, server.held())
    expect(corrections.length).toBeGreaterThan(0)
    patchesSeen.push(...corrections)
    server.applyCorrections(corrections)
    expect(patchesSeen.length).toBeGreaterThan(4)
    for (const patch of patchesSeen) expect(Object.keys(patch).sort(), JSON.stringify(patch)).not.toContain('addedPlace')
    // planned set 2 is gone (deleted); every other log has the place it had
    expect(places()).toEqual(before.filter(([id]) => id !== 'log.bench.2'))
  })
})
