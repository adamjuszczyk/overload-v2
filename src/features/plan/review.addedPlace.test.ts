import { describe, it, expect } from 'vitest'
import { applyReviewAction, itemKey, reviewItemText, type ReviewAddedSetItem } from './review'
import { keysOf, oneExerciseWeek, review, session, setLog } from './review.testutil'

// Chunk 56 (TASKS-1.2 "REVIEW", DECISIONS 195 (a); Adam, 2026-10-20: "195 agreed for chunk 56"): REVIEW keys an added set by its exercise and
// its place (`added_place`, 174), not by its number. Since 183's follow-up ("each card is numbered on its own") and Q1's gaps, two added sets
// of one exercise can show one number on two cards (the 46r review's probe P6: two Lat Pulldown added logs stored 3, at places 1 and 2), and
// a key made of the number is one decision for two sets. A set logged before 044 has no place and keeps today's key, by number.

const last = oneExerciseWeek('a', 1, 1)
const planned = setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' })
const thisWeekId = `${last.id}@2`

const entriesFor = (logs: ReturnType<typeof setLog>[]) =>
  review({ last: [last], sessions: [session('s1', last.id, 'completed', [planned, ...logs])] }).flatMap((g) => g.items)
const itemsFor = (logs: ReturnType<typeof setLog>[]) => entriesFor(logs).map((e) => e.item)
// The keys the list holds, each equal to what `itemKey` says of its item.
const keysFor = (logs: ReturnType<typeof setLog>[]) =>
  entriesFor(logs).map((e) => {
    expect(e.key).toBe(itemKey(e.item))
    return e.key
  })

describe('an added set is keyed by its place (DECISIONS 195 (a))', () => {
  const twoCards = [
    setLog('lg-x1', 's1', 'ex-1', { setNumber: 3, addedPlace: 1, weight: 20, reps: 15, loggedAt: '2026-10-05T18:10:00.000Z' }),
    setLog('lg-x2', 's1', 'ex-1', { setNumber: 3, addedPlace: 2, weight: 25, reps: 12, loggedAt: '2026-10-05T18:20:00.000Z' }),
  ]

  it('W: two added sets of one exercise that share a number on two cards are two items with two keys', () => {
    const entries = itemsFor(twoCards)
    expect(entries.map((e) => e.kind)).toEqual(['added_set', 'added_set'])
    expect(keysFor(twoCards)).toEqual(['added-set:s1:ex-1:p1', 'added-set:s1:ex-1:p2'])
    // Both read "set 03" and still are two things to decide: what they carry apart is the weight and reps.
    const texts = entries.map((e) => reviewItemText(e, { fromWeek: 2 }))
    expect(texts.map((t) => t.headline)).toEqual(['Set 03 · 20 kg × 15', 'Set 03 · 25 kg × 12'])
  })

  it('W: deciding one of the two leaves the other, and the line counts one', () => {
    const decided = [{ weekPlanId: thisWeekId, itemKey: 'added-set:s1:ex-1:p1' }]
    const left = review({ last: [last], sessions: [session('s1', last.id, 'completed', [planned, ...twoCards])], decisions: decided })
    expect(keysOf(left)).toEqual(['added-set:s1:ex-1:p2'])
  })

  it('the decision row an action leaves carries the place key, so it is the one that hides the item', () => {
    const [first] = itemsFor(twoCards) as ReviewAddedSetItem[]
    expect(first.place).toBe(1)
    const result = applyReviewAction(first, 'add_set', { ...last, id: first.weekPlanId, weekNumber: 2 })
    expect(result.decision).toEqual({ weekPlanId: thisWeekId, itemKey: 'added-set:s1:ex-1:p1', decision: 'used' })
  })

  it('W: a set logged before 044 (no place) keeps its key by number; two of them stay two items', () => {
    const before044 = [
      setLog('lg-o1', 's1', 'ex-1', { setNumber: 2, weight: 20, reps: 15, loggedAt: '2026-10-05T18:10:00.000Z' }),
      setLog('lg-o2', 's1', 'ex-1', { setNumber: 3, weight: 20, reps: 15, loggedAt: '2026-10-05T18:20:00.000Z' }),
    ]
    expect(keysFor(before044)).toEqual(['added-set:s1:ex-1:2', 'added-set:s1:ex-1:3'])
    // An explicit null reads the same as an absent place.
    const nulls = before044.map((l) => ({ ...l, addedPlace: null }))
    expect(keysFor(nulls)).toEqual(['added-set:s1:ex-1:2', 'added-set:s1:ex-1:3'])
  })

  it('a place and a number never name the same key: set number 1 before 044 and the set at place 1 are two items', () => {
    const mixed = [
      setLog('lg-o1', 's1', 'ex-1', { setNumber: 1, weight: 20, reps: 15, loggedAt: '2026-10-05T18:10:00.000Z' }),
      setLog('lg-p1', 's1', 'ex-1', { setNumber: 1, addedPlace: 1, weight: 25, reps: 12, loggedAt: '2026-10-05T18:20:00.000Z' }),
    ]
    expect(keysFor(mixed).sort()).toEqual(['added-set:s1:ex-1:1', 'added-set:s1:ex-1:p1'])
  })

  it('an added warmup with a place is keyed by it too, and the same place in another session is another key', () => {
    const warm = setLog('lg-w', 's1', 'ex-1', { setNumber: 1, addedPlace: 1, isWarmup: true, weight: null, reps: null, loggedAt: '2026-10-05T18:10:00.000Z' })
    expect(keysFor([warm])).toEqual(['added-set:s1:ex-1:p1'])
    const other = review({
      last: [last],
      sessions: [
        session('s1', last.id, 'completed', [planned, twoCards[0]]),
        session('s2', last.id, 'completed', [setLog('lg-2', 's2', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' }), { ...twoCards[0], id: 'lg-y', sessionId: 's2' }], { date: '2026-10-07' }),
      ],
    })
    expect(keysOf(other)).toEqual(['added-set:s1:ex-1:p1', 'added-set:s2:ex-1:p1'])
  })
})
