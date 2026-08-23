import {
  differenceInCalendarDays,
  parseISO,
  startOfWeek,
  subWeeks,
  subDays,
  isWithinInterval,
} from 'date-fns'
import type { ReferenceSession } from './sessionService.js'

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

// Reach-back (2026-08-22 fix, CONTEXT.md): the primary chain above finds the
// nearest-in-time completed session regardless of whether anything real was
// logged in it — by design (a session whose only rows for an exercise are
// all skipped is still a legitimate LAST WEEK/LAST TIME candidate purely by
// date, TASKS.md's own "date-based session selection vs. set-level
// comparability are separate concerns" call). That's correct for what the
// primary slot means, but leaves callers with no way to find "the last time
// this exercise actually happened" once the primary lands on an all-skipped
// session — exactly the real bug this closes (2026-08-15's Legs session, all
// 10 rows is_skipped: true).
//
// Deliberately bounded to the current mesocycle only, never a previous one —
// reaching across a meso boundary would compare against a different training
// block's programming, which is a materially different claim than "last time
// you actually did this."
export type SecondaryReference =
  | { type: 'none_in_meso' } // no completed occurrence of this exercise anywhere in the current meso
  | { type: 'all_skipped_in_meso' } // occurrences exist this meso, but every one was skipped
  | { type: 'found'; session: ReferenceSession; daysSince: number }

// "Has a real (non-skipped) logged set" mirrors positionMatch.ts's own
// buildLoggedSlots filter exactly (`!group.head.isSkipped`) — a dropset's
// logged-ness is decided by its head only, same convention used everywhere
// else this distinction matters, not a new rule invented here. Exported so
// callers that don't compute a full match/positionMatch (the live gym panel,
// ExerciseReference.tsx — Coach's analysisInput.ts uses its own already-
// computed `match.plain.slotCountA === 0` check instead) can decide when to
// invoke resolveSecondaryReference without duplicating this rule.
export function hasRealLoggedSet(session: ReferenceSession): boolean {
  return session.logs.some((group) => !group.head.isSkipped)
}

// `candidates` is the same unfiltered, unsorted set the primary chain
// receives (see resolveExerciseReference's own precondition comment) — this
// function does not require the primary to have been resolved first; it is
// independently computable from the same inputs. `mesocycleId` is the
// current session's own v2_sessions.mesocycle_id — null means there is no
// "current meso" to search within, which resolves to `none_in_meso` (there
// is nothing meaningful to have attempted or skipped).
export function resolveSecondaryReference(
  today: string,
  candidates: ReferenceSession[],
  mesocycleId: string | null,
): SecondaryReference {
  if (!mesocycleId) return { type: 'none_in_meso' }

  const todayDate = parseISO(today)
  const inMeso = candidates.filter(
    (c) => c.mesocycleId === mesocycleId && parseISO(c.date) < todayDate,
  )
  if (inMeso.length === 0) return { type: 'none_in_meso' }

  const withReal = inMeso.filter(hasRealLoggedSet).sort(byMostRecent)
  if (withReal.length === 0) return { type: 'all_skipped_in_meso' }

  const session = withReal[0]
  return {
    type: 'found',
    session,
    daysSince: differenceInCalendarDays(todayDate, parseISO(session.date)),
  }
}
