import { describe, it, expect } from 'vitest'
import { isSameCalendarWeek, datesForWeekOf, dateForDow, resolveMove } from './moveSession'

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
    expect(resolveMove(MON, FRI)).toEqual({ kind: 'set', movedToDate: FRI })
  })

  it('swapping two days is two independent moves, each its own "set"', () => {
    // Monday's session -> Friday
    expect(resolveMove(MON, FRI)).toEqual({ kind: 'set', movedToDate: FRI })
    // Friday's session -> Monday (a different session, same calendar week)
    expect(resolveMove(FRI, MON)).toEqual({ kind: 'set', movedToDate: MON })
  })

  it('a target in a different calendar week is invalid', () => {
    expect(resolveMove(MON, NEXT_MON)).toEqual({ kind: 'invalid_cross_week' })
    expect(resolveMove(SUN, NEXT_MON)).toEqual({ kind: 'invalid_cross_week' })
  })

  it('moving back to its own original day clears it (same result whether or not it was ever moved first)', () => {
    expect(resolveMove(MON, MON)).toEqual({ kind: 'clear' })
  })
})
