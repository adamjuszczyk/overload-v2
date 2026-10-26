import { describe, expect, it } from 'vitest'
import { finishWarning, holdsAutoFinish } from './workoutRules'
import { Session } from './workoutRules.session.testutil'
import { brief, card, headLog, staged } from './workoutRules.testutil'

// Chunk 64, DECISIONS 201 (a) (Adam, 2026-10-20: "198, 200, 201: build as recommended"): "a set a swap moved is an added set of the new exercise (179), so 46r's `finishWarning`
// never lists it and auto-finish can complete the session with it open" — so the warning also lists a set on a swap's card whose record names a planned set
// (`from.weekPlanSetId`), under the new card's name and the number its row shows ("Machine Pulldown 03"); a set added in the workout, or moved from an added set, stays unlisted.
// The sessions are driven the way 59 makes a swap (the harness's `swap`), and the warning is read the way the finish screen reads it.

const LAT = card('lat', 'n n n n', { name: 'Lat Pulldown' })
const world = (cards = [LAT], logged: number[] = [1, 2]) => new Session(cards, [], logged.map((i) => headLog('lat', i)))
const warn = (s: Session) => finishWarning(s.order(), s.server.logs, s.server.held())
const open = (s: Session, cardKey: string) => s.rows().filter((r) => r.exerciseKey === cardKey && r.state === 'unlogged')

describe('finishWarning: the planned sets a swap for today moved (DECISIONS 201 (a))', () => {
  it('W5: Lat Pulldown 01 and 02 logged, its 03 and 04 moved to Machine Pulldown and left open: "2 planned sets aren\'t logged yet: Machine Pulldown 03 and 04." (break: leave a moved planned set out of the warning)', () => {
    const s = world()
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03·`, `${m} 04·`])
    const warning = warn(s)!
    expect(warning.text).toBe("2 planned sets aren't logged yet: Machine Pulldown 03 and 04.")
    expect(warning.count).toBe(2)
    expect(warning.groups).toEqual([{ exerciseKey: m, exerciseName: 'Machine Pulldown', numbers: [3, 4] }])
    // GO BACK goes to the first of them: the moved row, not a row of the card the sets left
    expect(warning.firstKey).toBe(open(s, m)[0].key)
    // the moved sets are added sets of the new card in the rows (179), with the planned set named by the record only
    expect(open(s, m).map((r) => [r.weekPlanSetId, r.added])).toEqual([[null, true], [null, true]])
    expect(s.card(m).swappedFrom!.moved.map((x) => x.from)).toEqual([{ weekPlanSetId: 'lat.3' }, { weekPlanSetId: 'lat.4' }])
  })

  it('beside a set that stayed open on another card: each under its own name, in the session\'s order, the moved ones after', () => {
    const ez = card('ez', 'w n', { name: 'EZ Bar Curl' })
    const s = new Session([ez, LAT], [], [headLog('ez', 1, { warmup: true, number: 1 }), headLog('lat', 1), headLog('lat', 2)])
    const m = s.swap('lat', 'Machine Pulldown')
    const warning = warn(s)!
    expect(warning.text).toBe("3 planned sets aren't logged yet: EZ Bar Curl 01; Machine Pulldown 03 and 04.")
    expect(warning.groups.map((g) => g.exerciseKey)).toEqual(['ez', m])
    expect(warning.firstKey).toBe('set:ez.2')
  })

  it('a moved planned set that is logged, or skipped, is not listed; unlogged again it is listed again', () => {
    const s = world()
    const m = s.swap('lat', 'Machine Pulldown')
    const [first, second] = open(s, m)
    s.log(first.key)
    expect(warn(s)!.text).toBe("1 planned set isn't logged yet: Machine Pulldown 04.")
    s.log(second.key, undefined, { isSkipped: true, weight: null, reps: null })
    expect(warn(s)).toBeNull()
    s.unlog(first.key)
    expect(warn(s)!.text).toBe("1 planned set isn't logged yet: Machine Pulldown 03.")
  })

  it('a set added to the new card by hand is not listed (absence: it has no plan behind it, and no record names it)', () => {
    const s = world()
    const m = s.swap('lat', 'Machine Pulldown')
    const added = s.add(m)
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03·`, `${m} 04·`, `${m} 05·`])
    expect(s.row(added).added).toBe(true)
    const warning = warn(s)!
    expect(warning.count).toBe(2)
    expect(warning.text).toBe("2 planned sets aren't logged yet: Machine Pulldown 03 and 04.")
  })

  it('a set added in the workout and never swapped, and every planned set done: nothing is listed (absence)', () => {
    const s = world(undefined, [1, 2, 3, 4])
    s.add('lat')
    expect(warn(s)).toBeNull()
  })

  it('a set moved from an ADDED set is not listed (absence): the record names an added place, not a planned set', () => {
    const s = world(undefined, [1, 2, 3, 4])
    s.add('lat')
    const m = s.swap('lat', 'Machine Pulldown')
    expect(open(s, m).map((r) => r.added)).toEqual([true])
    expect(s.card(m).swappedFrom!.moved.map((x) => x.from)).toEqual([{ addedPlace: 1 }])
    expect(warn(s)).toBeNull()
  })

  it('a planned set and an added set moved together: only the planned one is listed, under the number its row shows', () => {
    const s = world(undefined, [1, 2, 3])
    s.add('lat') // the open planned 04, then the added set
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', 'lat 03✓', `${m} 04·`, `${m} 05·`])
    const warning = warn(s)!
    expect(warning.text).toBe("1 planned set isn't logged yet: Machine Pulldown 04.")
    expect(warning.firstKey).toBe(open(s, m)[0].key)
  })

  it('auto-finish asks the same question: the warning is not empty, so nothing is "left" for it to skip past (`nothingLeft` reads it)', () => {
    const s = world()
    s.swap('lat', 'Machine Pulldown')
    expect(warn(s)).not.toBeNull()
    // the open rows here are the moved working sets, which are the warning's: `holdsAutoFinish` has no drop and no warmup to add (a moved set's drops and warmups are below)
    expect(s.rows().some(holdsAutoFinish)).toBe(false)
  })
})

// Chunk 64's review 1, F1. DECISIONS 166 (a): "Auto-finish waits until no row of `resolveRows` is open. That covers working sets, drops and planned warmups … A set added in the session and
// never logged doesn't hold it". A set a swap moved from a planned set is still the session's planned work (201 (a)) though its row is an added one (179), so its open drops (the head
// logged on the swap's card) and a moved planned warmup hold auto-finish as the same sets unmoved do; a set moved from an ADDED set, its drops and an added warmup still don't. The question
// is asked the way the screen asks it (`useWorkoutRows.nothingLeft`: the warning is empty and no row holds it); the real hook is `GymSession.autoFinishMoved.test.tsx`'s.
describe('holdsAutoFinish: the open drops and warmups of a set a swap moved (DECISIONS 166 (a) with 201 (a); 64\'s review 1, F1)', () => {
  const nothingLeft = (s: Session) => warn(s) === null && !s.rows().some(holdsAutoFinish)
  const holding = (s: Session) => s.rows().filter(holdsAutoFinish).map(brief)
  const openHead = (s: Session, cardKey: string) => s.rows().find((r) => r.exerciseKey === cardKey && r.kind !== 'stage' && r.state === 'unlogged')!
  const shape = (s: Session) => s.rows().filter((r) => r.state === 'unlogged').map((r) => [r.kind, r.added, r.weekPlanSetId, r.movedFromPlan])
  const dropset = () => new Session([card('lat', 'n d1', { name: 'Lat Pulldown' })], [], [headLog('lat', 1)])

  it('the control: the same planned dropset NOT moved, its head logged and its drop open, holds it until the drop is logged', () => {
    const s = dropset()
    s.log(openHead(s, 'lat').key)
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', 'lat 02.1·'])
    expect(shape(s)).toEqual([['stage', false, null, false]])
    expect(warn(s)).toBeNull()
    expect(holding(s)).toEqual(['lat 02.1·'])
    expect(nothingLeft(s)).toBe(false)
    s.log(open(s, 'lat')[0].key)
    expect(nothingLeft(s)).toBe(true)
  })

  it('a planned dropset a swap moved, its head logged on the swap\'s card, its drop open: it waits for the drop, and finishes once it is logged or skipped (breaks: skip moved planned rows; skip their drops)', () => {
    const s = dropset()
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', `${m} 02·`, `${m} 02.1·`])
    expect(nothingLeft(s)).toBe(false) // the moved head is open: the warning's
    s.log(openHead(s, m).key)
    expect(s.rows().map(brief)).toEqual(['lat 01✓', `${m} 02✓`, `${m} 02.1·`])
    // the open row is a drop of an added row (179) that the swap's record names a planned set for
    expect(s.card(m).swappedFrom!.moved.map((x) => x.from)).toEqual([{ weekPlanSetId: 'lat.2' }])
    expect(shape(s)).toEqual([['stage', true, null, true]])
    expect(warn(s)).toBeNull() // the warning lists working sets only (148)
    expect(holding(s)).toEqual([`${m} 02.1·`])
    expect(nothingLeft(s)).toBe(false)
    const logged = s.copy()
    logged.log(open(logged, m)[0].key)
    expect(nothingLeft(logged)).toBe(true)
    const settled = s.copy()
    settled.log(open(settled, m)[0].key, undefined, { isSkipped: true, weight: null, reps: null })
    expect(nothingLeft(settled)).toBe(true)
  })

  it('a planned warmup a swap moved, open, with every working set logged: it waits for the warmup, and finishes once it is logged or skipped (breaks: skip moved planned rows; skip their warmups)', () => {
    const s = new Session([card('lat', 'n w n', { name: 'Lat Pulldown' })], [], [headLog('lat', 1)])
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.rows().map(brief)).toEqual(['lat 01✓', `${m} W1·`, `${m} 02·`])
    s.log(s.rows().find((r) => r.exerciseKey === m && r.kind === 'working' && r.state === 'unlogged')!.key) // the working set; the warmup stays open
    expect(s.rows().map(brief)).toEqual(['lat 01✓', `${m} W1·`, `${m} 02✓`])
    expect(s.card(m).swappedFrom!.moved.map((x) => x.from)).toEqual([{ weekPlanSetId: 'lat.2' }, { weekPlanSetId: 'lat.3' }])
    expect(shape(s)).toEqual([['warmup', true, null, true]])
    expect(warn(s)).toBeNull()
    expect(holding(s)).toEqual([`${m} W1·`])
    expect(nothingLeft(s)).toBe(false)
    const logged = s.copy()
    logged.log(open(logged, m)[0].key)
    expect(nothingLeft(logged)).toBe(true)
    const settled = s.copy()
    settled.log(open(settled, m)[0].key, undefined, { isSkipped: true, weight: null, reps: null })
    expect(nothingLeft(settled)).toBe(true)
  })

  it('the control: a dropset ADDED in the session and moved, its head logged on the swap\'s card, its drop open, does not hold it (absence: 166 (a), "a set added in the session … doesn\'t hold it")', () => {
    const s = new Session([card('lat', 'n n', { name: 'Lat Pulldown' })], [], [headLog('lat', 1), headLog('lat', 2)])
    s.retype(s.add('lat'), staged('dropset', 1))
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.card(m).swappedFrom!.moved.map((x) => x.from)).toEqual([{ addedPlace: 1 }])
    s.log(openHead(s, m).key)
    expect(s.rows().map(brief)).toEqual(['lat 01✓', 'lat 02✓', `${m} 03✓`, `${m} 03.1·`])
    expect(shape(s)).toEqual([['stage', true, null, false]])
    expect(holding(s)).toEqual([])
    expect(nothingLeft(s)).toBe(true)
  })

  it('the control: a warmup ADDED in the session and moved, open, does not hold it either (absence)', () => {
    const s = new Session([card('lat', 'n n', { name: 'Lat Pulldown' })], [], [headLog('lat', 1), headLog('lat', 2)])
    s.retype(s.add('lat'), { kind: 'warmup' })
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.card(m).swappedFrom!.moved.map((x) => x.from)).toEqual([{ addedPlace: 1 }])
    expect(shape(s)).toEqual([['warmup', true, null, false]])
    expect(holding(s)).toEqual([])
    expect(nothingLeft(s)).toBe(true)
  })

  it('a planned set and an added set moved together: the flag is the planned one\'s, with its drop; the added one and the rows left on the old card have none', () => {
    const s = new Session([card('lat', 'n n d1', { name: 'Lat Pulldown' })], [], [headLog('lat', 1)])
    s.add('lat')
    const m = s.swap('lat', 'Machine Pulldown')
    expect(s.rows().map((r) => [brief(r), r.movedFromPlan])).toEqual([
      ['lat 01✓', false],
      [`${m} 02·`, true],
      [`${m} 03·`, true],
      [`${m} 03.1·`, true],
      [`${m} 04·`, false],
    ])
  })

  it('a moved planned set stays planned when its type changes: switched to Warmup it is a moved planned warmup (it holds it); a moved warmup switched to Normal is a moved working set (the warning lists it)', () => {
    const a = new Session([card('lat', 'n n', { name: 'Lat Pulldown' })], [], [headLog('lat', 1)])
    const ma = a.swap('lat', 'Machine Pulldown')
    a.retype(openHead(a, ma).key, { kind: 'warmup' })
    expect(a.rows().map(brief)).toEqual(['lat 01✓', `${ma} W1·`])
    expect(warn(a)).toBeNull()
    expect(holding(a)).toEqual([`${ma} W1·`])
    expect(nothingLeft(a)).toBe(false)

    const b = new Session([card('lat', 'w n', { name: 'Lat Pulldown' })], [], [])
    const mb = b.swap('lat', 'Machine Pulldown')
    expect(b.rows().map(brief)).toEqual([`${mb} W1·`, `${mb} 01·`])
    b.retype(b.rows()[0].key, { kind: 'normal' })
    expect(b.rows().map(brief)).toEqual([`${mb} 01·`, `${mb} 02·`])
    expect(warn(b)!.count).toBe(2)
    expect(holding(b)).toEqual([])
  })
})
