import { describe, it, expect } from 'vitest'
import type { WeeklySchedule } from '../../types'
import { fullSchedule, sameSchedule, scheduleChangeRows, scheduleForWeek } from './runSchedule'

// Chunk 45 — which weekday schedule is in force for a week (SPEC [1.2] Programs and runs → Weekdays storage; TASKS-1.2's
// Data model: `v2_run_schedules`, "the row with the greatest from_week <= week, else the run copy's"). The fixtures give
// the run copy a schedule that differs from every row's, so a resolver that reads the wrong source gives a different
// answer than the right one.

const days = (over: Partial<WeeklySchedule>): WeeklySchedule => ({
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
  ...over,
})

const TUESDAY = days({ tuesday: 'pull' }) // the days before the first change
const WEDNESDAY = days({ wednesday: 'pull' }) // from week 3
const FRIDAY = days({ friday: 'pull' }) // from week 6
const RUN_COPY = days({ saturday: 'pull' }) // what the run copy holds: nobody's rows say this

const row = (fromWeek: number, schedule: WeeklySchedule, id = `r${fromWeek}`) => ({ id, fromWeek, schedule })

describe('scheduleForWeek — the row with the greatest from_week at or before the week', () => {
  const rows = [row(1, TUESDAY), row(3, WEDNESDAY), row(6, FRIDAY)]

  it('a week before the next row reads the row before it, and the row\'s own week reads that row', () => {
    expect(scheduleForWeek(rows, RUN_COPY, 1)).toBe(TUESDAY)
    expect(scheduleForWeek(rows, RUN_COPY, 2)).toBe(TUESDAY)
    expect(scheduleForWeek(rows, RUN_COPY, 3)).toBe(WEDNESDAY) // "<=": week 3 is the week the new days start
    expect(scheduleForWeek(rows, RUN_COPY, 5)).toBe(WEDNESDAY)
    expect(scheduleForWeek(rows, RUN_COPY, 6)).toBe(FRIDAY)
    expect(scheduleForWeek(rows, RUN_COPY, 40)).toBe(FRIDAY)
  })

  it('the rows may come in any order', () => {
    const shuffled = [row(6, FRIDAY), row(1, TUESDAY), row(3, WEDNESDAY)]
    for (const week of [1, 2, 3, 4, 5, 6, 7]) {
      expect(scheduleForWeek(shuffled, RUN_COPY, week)).toBe(scheduleForWeek(rows, RUN_COPY, week))
    }
  })

  it('a run with no rows reads the run copy, in every week', () => {
    for (const week of [1, 2, 9]) expect(scheduleForWeek([], RUN_COPY, week)).toBe(RUN_COPY)
  })

  it('a week before every row (one no run has) reads the run copy', () => {
    expect(scheduleForWeek([row(3, WEDNESDAY)], RUN_COPY, 2)).toBe(RUN_COPY)
    expect(scheduleForWeek(rows, RUN_COPY, 0)).toBe(RUN_COPY)
  })

  it('the run copy is the answer only when no row applies: the rows are the history, the run copy the newest', () => {
    // A row exists for week 1, so week 1 and 2 read it, not the run copy that already holds the newest days.
    expect(scheduleForWeek([row(1, TUESDAY), row(3, WEDNESDAY)], WEDNESDAY, 2)).toBe(TUESDAY)
  })

  it('a week that is not a whole number is refused', () => {
    expect(() => scheduleForWeek(rows, RUN_COPY, 2.5)).toThrow(RangeError)
    expect(() => scheduleForWeek(rows, RUN_COPY, Number.NaN)).toThrow(RangeError)
  })
})

describe('sameSchedule and fullSchedule', () => {
  it('a missing weekday and a null one are the same: the seed writes sparse maps, the app full ones', () => {
    expect(sameSchedule({ tuesday: 'a' }, days({ tuesday: 'a' }))).toBe(true)
    expect(sameSchedule({ tuesday: 'a', friday: null }, { tuesday: 'a' })).toBe(true)
  })

  it('a different workout on a weekday, or a day added or dropped, is a different schedule', () => {
    expect(sameSchedule(days({ tuesday: 'a' }), days({ tuesday: 'b' }))).toBe(false)
    expect(sameSchedule(days({ tuesday: 'a' }), days({ tuesday: 'a', thursday: 'a' }))).toBe(false)
    expect(sameSchedule(days({ tuesday: 'a', thursday: 'a' }), days({ tuesday: 'a' }))).toBe(false)
  })

  it('fullSchedule writes all seven weekdays, a missing one as null', () => {
    expect(fullSchedule({ tuesday: 'a' })).toEqual(days({ tuesday: 'a' }))
    expect(Object.keys(fullSchedule({}))).toHaveLength(7)
  })
})

describe('scheduleChangeRows — what a save that changes the days writes', () => {
  it('a run with no rows: from_week 1 with the OLD schedule, and from_week current + 1 with the NEW one', () => {
    expect(scheduleChangeRows([], TUESDAY, WEDNESDAY, 2)).toEqual([
      { fromWeek: 1, schedule: TUESDAY, existingId: null },
      { fromWeek: 3, schedule: WEDNESDAY, existingId: null },
    ])
  })

  it('a run that has rows: only the new one (the history is already there)', () => {
    expect(scheduleChangeRows([row(1, TUESDAY)], WEDNESDAY, FRIDAY, 4)).toEqual([{ fromWeek: 5, schedule: FRIDAY, existingId: null }])
  })

  it('a second change in the same week writes over the row the first one made, by its id', () => {
    const existing = [row(1, TUESDAY, 'first'), row(3, WEDNESDAY, 'second')]
    expect(scheduleChangeRows(existing, WEDNESDAY, FRIDAY, 2)).toEqual([{ fromWeek: 3, schedule: FRIDAY, existingId: 'second' }])
  })

  it('the week is the current week + 1, not the current week and not the first week after the last row', () => {
    expect(scheduleChangeRows([], TUESDAY, WEDNESDAY, 7).map((r) => r.fromWeek)).toEqual([1, 8])
    expect(scheduleChangeRows([row(1, TUESDAY), row(3, WEDNESDAY)], WEDNESDAY, FRIDAY, 7).map((r) => r.fromWeek)).toEqual([8])
  })

  it('the same days write nothing, however the maps are spelt', () => {
    expect(scheduleChangeRows([], TUESDAY, TUESDAY, 2)).toEqual([])
    expect(scheduleChangeRows([], { tuesday: 'pull' }, TUESDAY, 2)).toEqual([])
  })

  it('every schedule written is a full seven-day map', () => {
    const [first, second] = scheduleChangeRows([], { tuesday: 'pull' }, { wednesday: 'pull' }, 2)
    expect(Object.keys(first.schedule)).toHaveLength(7)
    expect(Object.keys(second.schedule)).toHaveLength(7)
  })

  it('the current week must be a whole number from 1', () => {
    expect(() => scheduleChangeRows([], TUESDAY, WEDNESDAY, 0)).toThrow(RangeError)
    expect(() => scheduleChangeRows([], TUESDAY, WEDNESDAY, 1.5)).toThrow(RangeError)
  })

  it('week 1 is a week like any other: the old days stay as week 1\'s and the new ones start in week 2', () => {
    expect(scheduleChangeRows([], TUESDAY, WEDNESDAY, 1)).toEqual([
      { fromWeek: 1, schedule: TUESDAY, existingId: null },
      { fromWeek: 2, schedule: WEDNESDAY, existingId: null },
    ])
  })

  it('written and then resolved: this week and the weeks before keep the old days, the weeks from next week on the new ones', () => {
    const writes = scheduleChangeRows([], TUESDAY, WEDNESDAY, 2)
    const stored = writes.map((w, i) => ({ id: `w${i}`, fromWeek: w.fromWeek, schedule: w.schedule }))
    // the run copy holds the NEWEST schedule, as a save writes it
    for (const week of [1, 2]) expect(sameSchedule(scheduleForWeek(stored, WEDNESDAY, week), TUESDAY)).toBe(true)
    for (const week of [3, 4, 20]) expect(sameSchedule(scheduleForWeek(stored, WEDNESDAY, week), WEDNESDAY)).toBe(true)
  })
})
