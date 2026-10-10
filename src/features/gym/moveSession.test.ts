import { describe, it, expect } from 'vitest'
import { isSameCalendarWeek, datesForWeekOf, movableDatesForWeekOf, dateForDow, resolveMove } from './moveSession'

// Week of 2026-08-24 (Monday) .. 2026-08-30 (Sunday) — hand-verified via
// `date -d 2026-08-24 +%A` etc. (same convention as MissedSessionPrompt.
// test.tsx's own header), not derived from the same formula under test.
const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const FRI = '2026-08-28'
const SAT = '2026-08-29'
const SUN = '2026-08-30'
const NEXT_MON = '2026-08-31'

describe('isSameCalendarWeek', () => {
  it('every day Mon-Sun of one calendar week is "the same week" as every other', () => {
    for (const a of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      for (const b of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
        expect(isSameCalendarWeek(a, b)).toBe(true)
      }
    }
  })

  it('the following Monday is a different week', () => {
    expect(isSameCalendarWeek(SUN, NEXT_MON)).toBe(false)
    expect(isSameCalendarWeek(MON, NEXT_MON)).toBe(false)
  })
})

describe('datesForWeekOf', () => {
  it('returns all 7 dates of the week, Monday first, regardless of which day anchors it', () => {
    const expected = [MON, TUE, WED, THU, FRI, SAT, SUN]
    expect(datesForWeekOf(MON)).toEqual(expected)
    expect(datesForWeekOf(THU)).toEqual(expected)
    expect(datesForWeekOf(SUN)).toEqual(expected)
  })
})

describe('dateForDow — the inverse of the house week-number formula', () => {
  it('a meso starting on a Monday: week 1 dates match the plain calendar week', () => {
    expect(dateForDow(MON, 1, 'monday')).toBe(MON)
    expect(dateForDow(MON, 1, 'friday')).toBe(FRI)
    expect(dateForDow(MON, 1, 'sunday')).toBe(SUN)
  })

  it('week 2 is 7 days after week 1, same weekday', () => {
    expect(dateForDow(MON, 2, 'monday')).toBe(NEXT_MON)
    expect(dateForDow(MON, 2, 'friday')).toBe('2026-09-04')
  })

  it('a meso starting mid-week still anchors weeks to the Monday containing that start date', () => {
    // Meso starts Wednesday 2026-08-26 — its own "week 1" is still the
    // Monday-anchored week containing it (Mon 08-24..Sun 08-30), same as
    // the house formula's own differenceInCalendarWeeks(…, {weekStartsOn:1})
    // would compute for any date in that window.
    expect(dateForDow(WED, 1, 'monday')).toBe(MON)
    expect(dateForDow(WED, 1, 'wednesday')).toBe(WED)
  })
})

describe('resolveMove', () => {
  it('move Mon -> Fri: a same-week move resolves to "set"', () => {
    expect(resolveMove(MON, FRI, MON)).toEqual({ kind: 'set', movedToDate: FRI })
  })

  it('swapping two days is two independent moves, each its own "set"', () => {
    // Monday's session -> Friday
    expect(resolveMove(MON, FRI, MON)).toEqual({ kind: 'set', movedToDate: FRI })
    // Friday's session -> Monday (a different session, same calendar week)
    expect(resolveMove(FRI, MON, MON)).toEqual({ kind: 'set', movedToDate: MON })
  })

  it('a target in a different calendar week is invalid', () => {
    expect(resolveMove(MON, NEXT_MON, MON)).toEqual({ kind: 'invalid_cross_week' })
    expect(resolveMove(SUN, NEXT_MON, MON)).toEqual({ kind: 'invalid_cross_week' })
  })

  it('moving back to its own original day clears it (same result whether or not it was ever moved first)', () => {
    expect(resolveMove(MON, MON, MON)).toEqual({ kind: 'clear' })
  })
})

// B2 (2026-10-10): "Move this session" offered days that had already passed
// (today, Saturday, could be moved to Thursday). Week of 2026-10-05 (Monday)
// .. 2026-10-11 (Sunday) — hand-verified with `date -d`, as above.
describe('moving never targets a day that has already passed', () => {
  const W_MON = '2026-10-05'
  const W_THU = '2026-10-08'
  const W_FRI = '2026-10-09'
  const W_SAT = '2026-10-10'
  const W_SUN = '2026-10-11'

  it('movableDatesForWeekOf on Saturday offers only Saturday and Sunday', () => {
    expect(movableDatesForWeekOf(W_SAT, W_SAT)).toEqual([W_SAT, W_SUN])
  })

  it('movableDatesForWeekOf on Monday offers the whole week', () => {
    expect(movableDatesForWeekOf(W_MON, W_MON)).toEqual(datesForWeekOf(W_MON))
  })

  it('anchors on the session\'s own week, not on today: a past week offers nothing', () => {
    expect(movableDatesForWeekOf('2026-09-28', W_SAT)).toEqual([])
  })

  it('resolveMove: today\'s session (Saturday) -> Thursday is refused as in the past', () => {
    expect(resolveMove(W_SAT, W_THU, W_SAT)).toEqual({ kind: 'invalid_past' })
  })

  it('resolveMove: yesterday is refused too; today and tomorrow are fine', () => {
    expect(resolveMove(W_SAT, W_FRI, W_SAT)).toEqual({ kind: 'invalid_past' })
    expect(resolveMove(W_SAT, W_SUN, W_SAT)).toEqual({ kind: 'set', movedToDate: W_SUN })
    expect(resolveMove(W_FRI, W_SAT, W_SAT)).toEqual({ kind: 'set', movedToDate: W_SAT })
  })

  it('resolveMove: "moving back" to a past original day is refused (nothing to go back to)', () => {
    expect(resolveMove(W_THU, W_THU, W_SAT)).toEqual({ kind: 'invalid_past' })
  })

  it('resolveMove: a cross-week target is still reported as cross-week, not past', () => {
    expect(resolveMove(W_SAT, '2026-10-12', W_SAT)).toEqual({ kind: 'invalid_cross_week' })
  })
})
