import { describe, expect, it } from 'vitest'
import { finishWarning, holdsAutoFinish } from './workoutRules'
import { Session } from './workoutRules.session.testutil'
import { brief, card, headLog } from './workoutRules.testutil'

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
    // what the warning leaves out is still `holdsAutoFinish`'s: a moved set's drops and warmups are rows of an added set, which don't hold it (a reading, chunk 64's report)
    expect(s.rows().some(holdsAutoFinish)).toBe(false)
  })
})
