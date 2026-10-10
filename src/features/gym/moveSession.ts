// Chunk 24 (SPEC "Weekday" — "Move this session to another day, this week
// only") — pure date/week logic for moving a session, kept separate from
// the DB write (sessionService.ts's moveSession) and the screen layer
// (MoveSessionSheet.tsx/TodayPage.tsx/PlanPage.tsx), per the Lessons'
// three-layer proof ("pure scheduler tests; service tests asserting the
// exact write; screen-layer tests asserting what each button hands to its
// hook").
//
// "This week" is always the Monday-anchored calendar week containing the
// session's own ORIGINAL `date` column — never its current moved_to_date
// (TASKS.md: "the week a session belongs to still comes from date"), so a
// session moved more than once always validates against the same week, no
// matter how many times it's re-moved.

import { startOfWeek, addDays, parseISO, format, isEqual } from 'date-fns'
import type { DayOfWeek } from '../../types'

export const DAYS_ORDER: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

function mondayOf(isoDate: string): Date {
  return startOfWeek(parseISO(isoDate), { weekStartsOn: 1 })
}

// Same "Monday-anchored calendar week" house formula as CONTEXT.md's own
// `differenceInCalendarWeeks(date, mesoStartDate, { weekStartsOn: 1 })` —
// two dates share a week exactly when their own Mondays coincide.
export function isSameCalendarWeek(a: string, b: string): boolean {
  return isEqual(mondayOf(a), mondayOf(b))
}

// The 7 ISO dates (Monday first) of the calendar week containing anchorDate
// — feeds the day-chip picker (MoveSessionSheet.tsx) and Plan's own
// per-selected-day date resolution (dateForDow below shares the same
// Monday anchor, just walked from a mesocycle's start date instead of an
// arbitrary date already known to be in the target week).
export function datesForWeekOf(anchorDate: string): string[] {
  const monday = mondayOf(anchorDate)
  return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
}

// The calendar date of weekday `dow` in week `weekNumber` of a mesocycle
// starting `mesoStartDate` — the inverse of the house formula
// (`differenceInCalendarWeeks(date, mesoStartDate, { weekStartsOn: 1 }) + 1`
// computes weekNumber FROM a date; this computes a date FROM weekNumber).
// Needed by PlanPage.tsx (via MoveSessionControl) to know which real
// calendar date the currently-VIEWED (week, workout day) pair actually is,
// since Plan — unlike Today — doesn't already have "today" as its anchor.
export function dateForDow(mesoStartDate: string, weekNumber: number, dow: DayOfWeek): string {
  const mesoMonday = startOfWeek(parseISO(mesoStartDate), { weekStartsOn: 1 })
  const weekMonday = addDays(mesoMonday, (weekNumber - 1) * 7)
  return format(addDays(weekMonday, DAYS_ORDER.indexOf(dow)), 'yyyy-MM-dd')
}

// The days of `anchorDate`'s calendar week that a session can still be moved
// to: `today` and later (ISO 'yyyy-MM-dd' strings compare like dates). A day
// that has already passed is never offered — moving a session onto it would
// file training under a day nobody can still train on (B2, 2026-10-10: the
// sheet offered Thursday for Saturday's session). The week is anchored on
// the session's own ORIGINAL date, never on today, so a session from a
// week that is entirely behind us gets an empty list rather than next
// week's days.
export function movableDatesForWeekOf(anchorDate: string, today: string): string[] {
  return datesForWeekOf(anchorDate).filter((d) => d >= today)
}

// What moving `originalDate` (a session's own, unchanging `date` column) to
// `targetDate` (the candidate new moved_to_date) resolves to, given `today`:
//   - 'invalid_cross_week': SPEC's own hard limit — moving across a week
//     boundary is never offered via the UI (the day-chip picker only ever
//     offers movableDatesForWeekOf(originalDate, today)), but the pure rule
//     is proven independently here (Lessons: "prove every rule at the layer
//     that applies it") rather than trusted to the UI alone.
//   - 'invalid_past': `targetDate` is before `today` (B2). Checked after the
//     cross-week rule, and before 'clear': "moving back" to an original day
//     that has already passed is a move onto a past day like any other.
//   - 'clear': targetDate is the session's own original day — "moving back
//     to its own day" (TASKS.md's session data model table). The caller
//     (sessionService.ts's moveSession) deletes the row if it only ever
//     existed to carry this move (always true today — see that function's
//     own header for why), or would clear moved_to_date on a row that also
//     carries other state (no such row exists yet, but the rule is named
//     here regardless, for whichever layer ends up enforcing it).
//   - 'set': the real move — moved_to_date becomes targetDate.
export type MoveResolution =
  | { kind: 'invalid_cross_week' }
  | { kind: 'invalid_past' }
  | { kind: 'clear' }
  | { kind: 'set'; movedToDate: string }

export function resolveMove(originalDate: string, targetDate: string, today: string): MoveResolution {
  if (targetDate !== originalDate && !isSameCalendarWeek(originalDate, targetDate)) {
    return { kind: 'invalid_cross_week' }
  }
  if (targetDate < today) return { kind: 'invalid_past' }
  if (targetDate === originalDate) return { kind: 'clear' }
  return { kind: 'set', movedToDate: targetDate }
}
