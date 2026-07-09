import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { ReferenceSession } from './sessionService'

// Still counts as "last week" for display purposes — allows a couple of
// days of schedule slack either side of an exact 7-day cadence.
const RECENT_DAYS = 10
// Beyond this, a weekly LAST WEEK/LAST TIME split stops being meaningful —
// always fall back to a single LAST TIME panel with a relative time.
const ABSENCE_DAYS = 28

export type ReferenceState =
  | { type: 'first_time' }
  | { type: 'last_week'; session: ReferenceSession }
  | { type: 'last_time'; session: ReferenceSession; daysSince: number }
  | { type: 'both'; lastWeek: ReferenceSession; lastTime: ReferenceSession; daysSince: number }

// occurrenceCount: how many times this exercise appears across the active
// program's workout days. sameSlot: most recent completed session for this
// exercise on the SAME workout day as the current session. anySlot: most
// recent completed session for this exercise on ANY workout day.
export function resolveExerciseReference(
  today: string,
  occurrenceCount: number,
  sameSlot: ReferenceSession | null,
  anySlot: ReferenceSession | null,
): ReferenceState {
  if (!anySlot) return { type: 'first_time' }

  const daysSinceAny = differenceInCalendarDays(parseISO(today), parseISO(anySlot.date))

  if (daysSinceAny > ABSENCE_DAYS) {
    return { type: 'last_time', session: anySlot, daysSince: daysSinceAny }
  }

  if (occurrenceCount < 2) {
    return daysSinceAny <= RECENT_DAYS
      ? { type: 'last_week', session: anySlot }
      : { type: 'last_time', session: anySlot, daysSince: daysSinceAny }
  }

  if (sameSlot) {
    const daysSinceSame = differenceInCalendarDays(parseISO(today), parseISO(sameSlot.date))
    if (daysSinceSame <= RECENT_DAYS) {
      return { type: 'both', lastWeek: sameSlot, lastTime: anySlot, daysSince: daysSinceAny }
    }
  }

  return { type: 'last_time', session: anySlot, daysSince: daysSinceAny }
}
