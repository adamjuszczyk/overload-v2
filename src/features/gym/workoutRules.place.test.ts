import { describe, expect, it } from 'vitest'
import type { SessionSetChangeType, SetLog } from '../../types'
import {
  applySetTypeChange,
  deleteEffects,
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

/** A card's head rows as the user reads them, each named by who it is: "P2" a planned set, else the added set's own id. */
function read(rows: readonly ResolvedRow[], cardKey = 'bench'): string[] {
  return rows
    .filter((r) => r.exerciseKey === cardKey && r.kind !== 'stage')
    .map((r) => `${brief(r).split(' ')[1]}=${r.added ? r.localId : `P${r.key.split('.').pop()}`}`)
}

// ─── The rule: a new added set's place ─────────────────────────────────────────────────────────

describe('nextAddedPlace: 1 + the highest place the card knows (DECISIONS 174)', () => {
  it('1 for the first set added to a card, then 1 + the highest: the list\'s, the logs\'', () => {
    expect(nextAddedPlace(card('bench', 'n n n'), threeLogged())).toBe(1)
    const one = card('bench', 'n n n', { added: [entry('a1', 1)] })
    expect(nextAddedPlace(one, threeLogged())).toBe(2)
    // a1 logged with its place, a2 open at 2
    const two = card('bench', 'n n n', { added: [entry('a1', 1, 'log.bench.added1'), entry('a2', 2)] })
    expect(nextAddedPlace(two, [...threeLogged(), addedLog('bench', 1, { number: 4, place: 1 })])).toBe(3)
  })

  it('after a delete: the next place is past every place given, not the count of the sets left (break: the list\'s length)', () => {
    // A, B, C added (1, 2, 3); B deleted: its entry goes. By count the next would be 3, C's place: two sets in one place.
    const left = card('bench', 'n', { added: [entry('A', 1), entry('C', 3)] })
    expect(nextAddedPlace(left, [headLog('bench', 1)])).toBe(4)
    const withD = { ...left, added: [...left.added!, entry('D', nextAddedPlace(left, [headLog('bench', 1)]))] }
    expect(read(resolveRows(orderOf([withD]), [headLog('bench', 1)]))).toEqual(['01✓=P1', '02·=A', '03·=C', '04·=D'])
  })

  it('reads the logs and the drafts too: a reopened session (no list) and a reload (no list, a draft)', () => {
    // no list at all, the logs of two added sets at 1 and 2 (another phone, or the session reopened)
    expect(nextAddedPlace(card('bench', 'n n n'), [...threeLogged(), addedLog('bench', 1, { number: 4, place: 1 }), addedLog('bench', 2, { number: 5, place: 2 })])).toBe(3)
    // no list, a draft at 5 (its set was unlogged and the list lost)
    const drafted = card('bench', 'n n n', { drafts: [draftOf({ sessionId: 's1', localId: 'gone', exerciseId: 'ex.bench', position: 4 }, NORMAL, 5)] })
    expect(nextAddedPlace(drafted, threeLogged())).toBe(6)
  })

  it('only the card\'s own added sets count: not another exercise\'s, not a planned set\'s log, and not a drop\'s log (177: the place is read from the head log only)', () => {
    const head = addedLog('bench', 1, { number: 4, place: 2 })
    // no writer puts a place on these logs; they carry one here so that reading them would show
    const strays: SetLog[] = [
      { ...dropLog(head, 1), addedPlace: 9 },
      { ...headLog('bench', 1), addedPlace: 8 },
      addedLog('row', 1, { place: 7 }),
    ]
    expect(nextAddedPlace(card('bench', 'n n n', { added: [entry('a1', 2, head.id)] }), [...threeLogged(), head, ...strays])).toBe(3)
  })

  it('refuses a list entry or a draft that has no place (a set with none would be drawn in a place nobody gave it), and a log the column would refuse', () => {
    const noPlace = { ...card('bench', 'n'), added: [{ localId: 'a1', logId: null, type: NORMAL } as unknown as AddedSet] }
    expect(() => nextAddedPlace(noPlace, [])).toThrow(TypeError)
    expect(() => resolveRows(orderOf([noPlace]), [])).toThrow(TypeError)
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const badPlace = { ...card('bench', 'n'), added: [entry('a1', bad)] }
      expect(() => resolveRows(orderOf([badPlace]), []), String(bad)).toThrow(TypeError)
    }
    const key = { sessionId: 's1', localId: 'gone', exerciseId: 'ex.bench', position: 2 }
    const draftNoPlace = { ...card('bench', 'n'), drafts: [{ key, values: { type: NORMAL } } as unknown as HeldDraft] }
    expect(() => resolveRows(orderOf([draftNoPlace]), [])).toThrow(TypeError)
    expect(() => nextAddedPlace(draftNoPlace, [])).toThrow(TypeError)
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
    const draftOk: HeldDraft = { key, values: { type: NORMAL, place: null } }
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
    expect(nextAddedPlace(card('bench', 'n'), [headLog('bench', 1), ...old])).toBe(1)
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

  it('reported (DECISIONS asks): a set logged before 044 that is unlogged and logged again comes back after the card\'s other sets logged before 044', () => {
    // 1.2 can't keep its place: its order is its log's time, a new log has a new time, and it has no place to write
    const older = [addedLog('bench', 1, { number: 2, loggedAt: at(10) }), addedLog('bench', 2, { number: 3, loggedAt: at(11) }), addedLog('bench', 3, { number: 4, loggedAt: at(12) })]
    const server = new FakeServer({ logs: [headLog('bench', 1), ...older] })
    let cards: OrderExercise[] = [card('bench', 'n')]
    const view = viewOf(orderOf(cards), server.logs, server.held())
    expect(read(view.rows)).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added2', '04✓=log.bench.added3'])
    const middle = rowKeyed(view, 'added:bench:log.bench.added2')
    const unlog = unlogEffects(middle, view)
    expect(unlog.draft.values).toMatchObject({ place: null })
    server.applyUnlog(unlog)
    cards = [{ ...cards[0], drafts: [unlog.draft as HeldDraft] }]
    // its draft has no place either: drawn after the logs it was logged among
    expect(read(resolveRows(orderOf(cards), server.logs, server.held()))).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added3', '04·=log.bench.added2'])
    server.insertLog({ ...older[1], id: 'again', setNumber: 4, loggedAt: at(40), addedPlace: null })
    expect(read(resolveRows(orderOf([card('bench', 'n')]), server.logs, server.held()))).toEqual(['01✓=P1', '02✓=log.bench.added1', '03✓=log.bench.added3', '04✓=again'])
  })
})

// ─── 179: the sets a swap for today moves ──────────────────────────────────────────────────────

describe('the sets a swap for today moves are added sets of the new exercise (DECISIONS 179)', () => {
  // the new exercise already has an added set open (place 1) and one logged (place 2)
  const target = () => card('dip', '', { added: [entry('d1', 1), entry('d2', 2, 'log.dip.added2')] })
  const targetLogs = (): SetLog[] => [addedLog('dip', 2, { number: 2, place: 2 })]
  const moved = [
    { localId: 'm1', type: NORMAL },
    { localId: 'm2', type: staged('dropset', 1) },
    { localId: 'm3', type: NORMAL },
  ]

  it('each gets its place at the swap, in the order they stood, after the sets already added to that exercise', () => {
    const entries = movedSetEntries(target(), targetLogs(), moved)
    expect(entries).toEqual([
      { localId: 'm1', logId: null, type: NORMAL, place: 3 },
      { localId: 'm2', logId: null, type: staged('dropset', 1), place: 4 },
      { localId: 'm3', logId: null, type: NORMAL, place: 5 },
    ])
    // appended to the new card's list, they are drawn after its own added sets, in their order
    const card2 = { ...target(), added: [...target().added!, ...entries] }
    const rows = resolveRows(orderOf([card2]), targetLogs())
    expect(rows.map(brief)).toEqual(['dip 01·', 'dip 02✓', 'dip 03·', 'dip 04·', 'dip 04.1·', 'dip 05·'])
    expect(rows.filter((r) => r.kind !== 'stage').map((r) => r.localId)).toEqual(['d1', 'd2', 'm1', 'm2', 'm3'])
    // …and the rule counts them: the next set added to the new exercise comes after them (break: they are left out)
    expect(nextAddedPlace(card2, targetLogs())).toBe(6)
  })

  it('on a new exercise with no added set they start at 1', () => {
    expect(movedSetEntries(card('dip', ''), [], moved).map((e) => e.place)).toEqual([1, 2, 3])
  })

  it('refuses a set the new card already lists, and a set with no type', () => {
    expect(() => movedSetEntries(target(), targetLogs(), [{ localId: 'd1', type: NORMAL }])).toThrow(RangeError)
    expect(() => movedSetEntries(target(), targetLogs(), [{ localId: 'm1', type: NORMAL }, { localId: 'm1', type: NORMAL }])).toThrow(RangeError)
    expect(() => movedSetEntries(target(), targetLogs(), [{ localId: 'm1' } as unknown as AddedSet])).toThrow(TypeError)
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
