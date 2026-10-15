// Chunk 45 (TASKS-1.2 "How a CHANGE THE PROGRAM save lands, as a pure function": the second, small module).
// SPEC.md [1.2] Programs and runs → "Weekdays storage": "this week's not-done sessions keep their days; the new
// days apply from next week, including a week already planned forward. How that is stored (an effective-from
// week, or this week's sessions recorded as moves) is for TASKS to choose": TASKS-1.2's Data model chose an
// effective-from week, `v2_run_schedules` (migration 042: `(mesocycle_id, from_week)` unique, `schedule` the same
// `{ monday: workoutDayId | null, … }` shape as `v2_programs.schedule`).
//
// Two pure functions, both about WHICH weekday schedule is in force for a week:
//   - scheduleForWeek: the schedule for any week (what Today, the missed-session prompt, moving a session and Plan
//     ask, chunk 50): the row with the greatest `from_week` that is at or before the week, else the run copy's own
//     schedule (a run nobody changed the days of has no row and behaves exactly as it did before 1.2);
//   - scheduleChangeRows: what a save that changes the days writes (the rows a save needs, chunk 51b).
//
// A week is a "week" on a weekday run; a sequence run has no weekday schedule and never gets a row (nothing here
// is asked for one). No Supabase, no React, no clock: the caller passes what it read.

import type { DayOfWeek, RunSchedule, WeeklySchedule } from '../../types'

export const WEEKDAYS: readonly DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

// A stored row, as far as the resolver reads it. A full `RunSchedule` fits as it is.
export type ScheduleRow = Pick<RunSchedule, 'fromWeek' | 'schedule'>

function assertWeek(name: string, week: number): void {
  if (!Number.isInteger(week)) throw new RangeError(`${name}: the week must be a whole number (got ${week})`)
}

// The schedule in force for `week`: the row with the greatest `fromWeek` <= `week` (the rows may come in any order),
// else `runCopySchedule`, the run copy's own `v2_programs.schedule`. "<=" and not "<": a row's own week is already
// on the new days ("New days start in week 3"), and the week it says is the week it starts.
//
// The rows are what a save wrote, so they hold the history: a run that has had its days changed has a row for its
// first schedule too (`from_week` 1, scheduleChangeRows), and its run copy holds the NEWEST schedule. A week before
// every row (a week 0, which no run has) therefore reads the run copy's.
//
// The result is the row's own object (or the run copy's): callers don't change it.
export function scheduleForWeek(
  rows: readonly ScheduleRow[],
  runCopySchedule: WeeklySchedule,
  week: number,
): WeeklySchedule {
  assertWeek('scheduleForWeek', week)
  let best: ScheduleRow | null = null
  for (const row of rows) {
    if (row.fromWeek <= week && (best === null || row.fromWeek > best.fromWeek)) best = row
  }
  return best === null ? runCopySchedule : best.schedule
}

// Two schedules are the same when every weekday holds the same workout; a weekday that is missing and one that is
// null both mean "no workout" (the seed and the app write sparse maps as well as full ones).
export function sameSchedule(a: Partial<WeeklySchedule>, b: Partial<WeeklySchedule>): boolean {
  return WEEKDAYS.every((day) => (a[day] ?? null) === (b[day] ?? null))
}

// The schedule as a full seven-day map, which is what a save writes: a missing weekday written as null.
export function fullSchedule(schedule: Partial<WeeklySchedule>): WeeklySchedule {
  const out = {} as WeeklySchedule
  for (const day of WEEKDAYS) out[day] = schedule[day] ?? null
  return out
}

// One row a save writes. `existingId` is the id of a row that already holds this `fromWeek` (an upsert, as
// `unique (mesocycle_id, from_week)` allows no second one): the caller updates it; `null` means a new row.
export interface ScheduleRowWrite {
  fromWeek: number
  schedule: WeeklySchedule
  existingId: string | null
}

// What a save that changes the weekdays writes (SPEC, Weekdays storage; TASKS-1.2 Data model):
//   - the days did not change ............... nothing;
//   - the run has no row yet ................ `from_week` 1 with the OLD schedule, so that every week up to this
//     one keeps resolving to the days it had (the run copy is about to hold the new ones), and
//   - always ................................ `from_week` = currentWeek + 1 with the NEW schedule: this week's
//     sessions keep their days and the new days start next week, a week already planned forward included (its
//     plan rows are per workout, not per day, so nothing there needs a rewrite).
// A run that already has rows only gets the second one, written over the row that holds that week when a save in
// this same week already wrote it (a second change before the week is over).
//
// `oldSchedule` is the schedule the edit started from (the run copy's, as it is now) and `newSchedule` the one the
// edit ends with.
export function scheduleChangeRows(
  existingRows: ReadonlyArray<Pick<RunSchedule, 'id' | 'fromWeek' | 'schedule'>>,
  oldSchedule: Partial<WeeklySchedule>,
  newSchedule: Partial<WeeklySchedule>,
  currentWeek: number,
): ScheduleRowWrite[] {
  assertWeek('scheduleChangeRows', currentWeek)
  if (currentWeek < 1) throw new RangeError(`scheduleChangeRows: the current week must be 1 or more (got ${currentWeek})`)
  if (sameSchedule(oldSchedule, newSchedule)) return []

  const writes: ScheduleRowWrite[] = []
  if (existingRows.length === 0) {
    writes.push({ fromWeek: 1, schedule: fullSchedule(oldSchedule), existingId: null })
  }
  const nextWeek = currentWeek + 1
  const sameWeek = existingRows.find((row) => row.fromWeek === nextWeek)
  writes.push({ fromWeek: nextWeek, schedule: fullSchedule(newSchedule), existingId: sameWeek?.id ?? null })
  return writes
}
