// Chunk 58b — what the workout screen's header says (boards W1, W4, W6): "WEEK 2 · TUESDAY", "DELOAD · WEEK 2 · TUESDAY" or
// "CYCLE 3 · SLOT 2" over the workout's name, and "6 OF 15 SETS" under the clock. Pure: GymSession hands it what it already has.
import { format, parseISO } from 'date-fns'
import type { ScheduleType } from './referenceByExercise'
import type { ResolvedRow } from './workoutRules'

/**
 * The header's top line (board W4). A weekday run names the week and the weekday the workout is on (a moved session: the day it was
 * moved to, as Plan and "last time" read it); a sequence run names the cycle and the slot, counted from 1 as Plan's `SLOT n` is. A
 * deload session says so first. A part that isn't known yet (the session still loading: no date; a plan row missing: no slot) is left
 * out rather than guessed.
 */
export function headerEyebrow(input: {
  scheduleType: ScheduleType
  weekNumber: number
  isDeload: boolean
  /** The session's effective date (`effectiveDate`), or null while the session is loading. */
  date: string | null
  /** The 1-based slot of a sequence run's session, or null when its plan row is unknown. */
  slot: number | null
}): string {
  const { scheduleType, weekNumber, isDeload, date, slot } = input
  const parts: string[] = []
  if (isDeload) parts.push('DELOAD')
  if (scheduleType === 'sequence') {
    parts.push(`CYCLE ${weekNumber}`)
    if (slot !== null) parts.push(`SLOT ${slot}`)
  } else {
    parts.push(`WEEK ${weekNumber}`)
    if (date !== null) parts.push(format(parseISO(date), 'EEEE').toUpperCase())
  }
  return parts.join(' · ')
}

/**
 * "N OF M SETS" (TASKS 58b): the working heads and stages the screen draws, planned and added, against those logged. Warmups are out of
 * both numbers (SPEC Warmup sets: "never counted in set counts"). A skipped set stays in M (it was planned) and is not in N (it was
 * not done). Counted over the same rows the screen draws (`resolveRows`), so the header, the current set and the finish warning
 * cannot disagree; on any session whose logs all have rows N is `countCompletedSets(logs).total`.
 */
export function setsProgress(rows: ReadonlyArray<Pick<ResolvedRow, 'kind' | 'state'>>): { done: number; total: number } {
  const sets = rows.filter((row) => row.kind !== 'warmup')
  return { done: sets.filter((row) => row.state === 'logged').length, total: sets.length }
}

export function setsLabel({ done, total }: { done: number; total: number }): string {
  return `${done} OF ${total} SETS`
}
