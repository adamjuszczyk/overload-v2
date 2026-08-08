import {
  differenceInCalendarDays,
  parseISO,
  startOfWeek,
  subWeeks,
  subDays,
  isWithinInterval,
} from 'date-fns'
import type { ReferenceSession } from './sessionService'

// Two-slot resolution (v3 TASKS.md §2.3). FIX 14 made meso weeks
// Monday-anchored calendar weeks, so "the immediately preceding meso week"
// is exactly "the previous Monday-anchored calendar week" — a pure date
// range, no meso join, no meso-start arithmetic. The old RECENT_DAYS /
// ABSENCE_DAYS constants and the occurrenceCount input they supported are
// gone — superseded by this exact boundary, not kept as a fallback.

export type PrimarySlot =
  | { type: 'first_time' }
  | { type: 'last_week'; session: ReferenceSession }
  | { type: 'last_time'; session: ReferenceSession; daysSince: number }

export interface ThisWeekOccurrence {
  session: ReferenceSession
  daysSince: number
}

export interface ReferenceState {
  primary: PrimarySlot
  // Additive, may be empty — one entry per occurrence in the current week,
  // never a single collapsed value (TASKS.md §4 item 16).
  thisWeek: ThisWeekOccurrence[]
}

// Most-recent-first comparator. `date` (calendar day) is the primary key —
// but AUDIT A3 confirms there's no DB uniqueness constraint on
// (user_id, date), and AUDIT E8 documents same-day multi-workout as a real,
// not hypothetical, scenario. Without a tiebreaker, two same-date sessions
// resolve "most recent" by array input order alone — non-deterministic from
// this function's own point of view (found via adversarial review). Break
// ties by completedAt (true completion time) when both are known, then by
// sessionId purely so the result is at least deterministic rather than
// order-dependent when completedAt is unavailable on legacy/edge-case rows.
function byMostRecent(a: ReferenceSession, b: ReferenceSession): number {
  const dateCmp = b.date.localeCompare(a.date)
  if (dateCmp !== 0) return dateCmp
  if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt)
  return b.sessionId.localeCompare(a.sessionId)
}

// `sessions` must already be scoped to the same workout_day_id and
// status = 'completed' (the session-first query in sessionService.ts
// guarantees this) but is otherwise unfiltered and unsorted — every date
// boundary below is computed and applied here, so the boundary math itself
// is directly testable without needing a caller to pre-filter anything.
export function resolveExerciseReference(today: string, sessions: ReferenceSession[]): ReferenceState {
  const todayDate = parseISO(today)
  const thisWeekStart = startOfWeek(todayDate, { weekStartsOn: 1 })
  const prevWeekStart = subWeeks(thisWeekStart, 1)
  const prevWeekEnd = subDays(thisWeekStart, 1)

  // A future-dated or same-day-as-today row should never reach this
  // function in practice (the current session is always 'in_progress',
  // excluded upstream by both status and id) — filtered here anyway so the
  // boundary math doesn't depend on the caller getting that right.
  const past = sessions.filter((s) => parseISO(s.date) < todayDate)

  const lastWeekCandidates = past
    .filter((s) => isWithinInterval(parseISO(s.date), { start: prevWeekStart, end: prevWeekEnd }))
    .sort(byMostRecent)

  const thisWeek: ThisWeekOccurrence[] = past
    .filter((s) => parseISO(s.date) >= thisWeekStart)
    .sort(byMostRecent)
    .map((session) => ({
      session,
      daysSince: differenceInCalendarDays(todayDate, parseISO(session.date)),
    }))

  if (lastWeekCandidates.length > 0) {
    return { primary: { type: 'last_week', session: lastWeekCandidates[0] }, thisWeek }
  }

  const mostRecent = [...past].sort(byMostRecent)[0]
  if (mostRecent) {
    return {
      primary: {
        type: 'last_time',
        session: mostRecent,
        daysSince: differenceInCalendarDays(todayDate, parseISO(mostRecent.date)),
      },
      thisWeek,
    }
  }

  return { primary: { type: 'first_time' }, thisWeek }
}
