// Chunk 58a, fix-forward (review 1, finding 2) — what a row's LAST line reads. TASKS 58a: "the reference's set at that position, from
// today's `ExerciseReference` data" (that panel was replaced by the header's LAST line and sheet, `lastTimeView.ts`, in chunk 58b and its
// component removed in chunk 77; they read the same reference); SPEC "Last time" reference [P1]: deload sessions never count, LAST WEEK is the
// preceding calendar week's, EARLIER THIS WEEK is apart. So the line reads the session the exercise's reference calls its
// primary one, resolved by the same functions it calls (`referenceByExercise.ts`; `hasRealLoggedSet` from the frozen
// `referenceLogic.ts`, used as it is), and not the latest completed session of the exercise (`useLastSessionLogs`), which differs
// after a deload session, when the exercise was done earlier this week, and after a session in which every set was skipped.
import { hasRealLoggedSet } from './referenceLogic'
import { resolveExerciseReferenceAcrossRuns, resolveReachBackAcrossRuns, type ScheduleType } from './referenceByExercise'
import type { ReferenceSession } from './sessionService'
import type { SetLog } from '../../types'

/**
 * The session the LAST line reads: the reference's primary session (LAST WEEK, else LAST TIME; deloads never count), or, when that
 * session holds no set that was really done (every set skipped), the session the panel reaches back to ("LAST ACTUALLY TRAINED").
 * null when there is none (FIRST TIME, or nothing on record that was done).
 */
export function lastTimeSession(today: string, scheduleType: ScheduleType, sessions: ReferenceSession[]): ReferenceSession | null {
  const { primary } = resolveExerciseReferenceAcrossRuns(today, scheduleType, sessions)
  if (primary.type === 'first_time') return null
  if (hasRealLoggedSet(primary.session)) return primary.session
  const reachedBack = resolveReachBackAcrossRuns(today, sessions)
  return reachedBack.type === 'found' ? reachedBack.session : null
}

/**
 * That session's working set at the row's place: the row's number counts its working heads (a warmup has no place, a drop is its
 * head's), the same count the rows use. null with no such set.
 */
export function lastTimeSetAt(session: ReferenceSession | null, number: number): SetLog | null {
  if (session === null) return null
  const working = session.logs.filter((group) => !group.head.isWarmup)
  return working[number - 1]?.head ?? null
}
