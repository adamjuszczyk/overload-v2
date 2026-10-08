import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { ReferenceSession } from './sessionService.js'
import { resolveExerciseReference, hasRealLoggedSet, type ReferenceState } from './referenceLogic.js'

// Chunk 23 — "Last time" matches by exercise (SPEC.md "'Last time'
// reference"). Pure, new, beside referenceLogic.ts — that file's existing
// exports stay byte-identical (Coach's analysisInput.ts imports them;
// check-frozen-code.mjs enforces it), so the new cross-run rules this
// chunk adds (deload exclusion, schedule-type branching, the reach-back
// crossing run boundaries) live here instead, as new functions, never as
// edits to referenceLogic.ts itself.
//
// `sessions` on every exported function below is the cross-run candidate
// set for ONE exercise — every completed session of the user where this
// exercise was logged, any run, any workout (fetchReferenceSessionsByExercise,
// sessionService.ts), OR the narrower per-workout-day offline Dexie
// fallback (useSession.ts's fetchReferenceSessionsFromCache, unchanged —
// see ExerciseReference.tsx's own comment on why that's fine per the
// brief's "online-only is fine" allowance). Either way, every function here
// is independently correct given whatever list it's handed — it does not
// assume the caller already filtered deload sessions out (see
// excludeDeload below), only that `sessions` all share one exercise id.

export type ScheduleType = 'weekday' | 'sequence'

// Duplicated from referenceLogic.ts's own private (non-exported, frozen)
// byMostRecent — same tie-break, same reasoning (AUDIT A3/E8: no DB
// uniqueness on (user_id, date), same-day multi-workout is real): `date`
// first, then completedAt, then sessionId purely for determinism. Can't be
// imported (it isn't exported, and adding an export would itself be a
// frozen-file change check-frozen-code.mjs would catch) — this is a new,
// separate module, so a small, well-understood duplication is the honest
// choice rather than reaching into referenceLogic.ts's internals.
function byMostRecent(a: ReferenceSession, b: ReferenceSession): number {
  const dateCmp = b.date.localeCompare(a.date)
  if (dateCmp !== 0) return dateCmp
  if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt)
  return b.sessionId.localeCompare(a.sessionId)
}

// SPEC "Elapsed time counts from moved_to_date when set, else the session
// date" — applied once, up front, by substituting the session's own
// `date` field: every date-based rule below (which Monday-anchored week a
// session falls in, days-since-today) then reads `date` as usual and gets
// the right answer for free, the same way historyService.ts already shows
// "the day a session was actually done" everywhere else in this app.
// "Move this session" is constrained to the session's own week (SPEC —
// chunk 24), so this substitution never moves a session across a week
// boundary; it only changes which day inside that week it's measured from.
function withEffectiveDate(session: ReferenceSession): ReferenceSession {
  const effective = session.movedToDate ?? session.date
  return effective === session.date ? session : { ...session, date: effective }
}

// SPEC "Deload sessions never count" — fetchReferenceSessionsByExercise
// (sessionService.ts) already excludes a deload session from the Map it
// builds, before this ever runs; this is a second, independent filter at
// the layer that actually matches (Lessons: "prove every rule at the layer
// that applies it"), provable with a fixture the service was never
// involved in building at all (referenceByExercise.test.ts).
function excludeDeload(sessions: ReferenceSession[]): ReferenceSession[] {
  return sessions.filter((s) => !s.isDeload)
}

// Primary slot, cross-run (SPEC "Matching: by exercise_id across all
// completed sessions of the user, every run and every workout", "Crosses
// run boundaries").
//
// Weekday branch: the frozen fallback chain (referenceLogic.ts's
// resolveExerciseReference) is reused wholesale, unchanged — it has always
// been pure date-window math with no notion of workout/run identity at all
// (CONTEXT.md FIX 14: meso weeks are plain Monday-anchored calendar
// weeks), so "LAST WEEK only when the match is from the immediately
// preceding week, otherwise LAST TIME + elapsed, FIRST TIME only when
// truly never done" already crosses run boundaries by construction once
// it's fed a cross-run candidate list. "If last week's match was a deload
// session, use LAST TIME from the last normal occurrence" falls out the
// same way: every candidate reaching it here is already deload-free
// (excludeDeload below), so there is no deload session left for it to
// select as LAST WEEK in the first place — it simply finds whatever
// non-deload match exists, or falls through.
//
// Sequence branch (SPEC "Sequence: always LAST TIME + elapsed time.
// EARLIER THIS WEEK is hidden"): never LAST_WEEK (a Monday-anchored
// "preceding week" has no meaning for a schedule with no fixed weekdays),
// and `thisWeek` is always `[]`. Built and tested here per the brief
// ("Sequence runs arrive in chunk 25; build the branch now and test it
// with a fixture") — not reachable from today's live UI, since
// v2_programs.schedule_type is 'weekday' on every program that exists or
// can be created today (see ExerciseReference.tsx's own comment on why its
// call site passes the literal 'weekday').
export function resolveExerciseReferenceAcrossRuns(
  today: string,
  scheduleType: ScheduleType,
  sessions: ReferenceSession[],
): ReferenceState {
  const candidates = excludeDeload(sessions).map(withEffectiveDate)

  if (scheduleType === 'sequence') {
    const todayDate = parseISO(today)
    const past = candidates.filter((s) => parseISO(s.date) < todayDate)
    const mostRecent = [...past].sort(byMostRecent)[0]
    if (!mostRecent) return { primary: { type: 'first_time' }, thisWeek: [] }
    return {
      primary: {
        type: 'last_time',
        session: mostRecent,
        daysSince: differenceInCalendarDays(todayDate, parseISO(mostRecent.date)),
      },
      thisWeek: [],
    }
  }

  return resolveExerciseReference(today, candidates)
}

// Reach-back, cross-run (SPEC "The reach-back (shown when the matched
// session's sets were all skipped) crosses run boundaries too" — unlike
// referenceLogic.ts's own resolveSecondaryReference, which SPEC/CONTEXT
// deliberately bound to the current mesocycle only, for Coach). No
// mesocycleId parameter at all: there is no meso boundary left to respect,
// so every non-deload, non-warmup candidate across every run is in play —
// find the most recent one with a real (non-skipped) logged set.
//
// Variant names deliberately don't say "meso" (resolveSecondaryReference's
// `none_in_meso`/`all_skipped_in_meso` do, correctly, for ITS bounded
// scope) — this one isn't bounded, so ExerciseReference.tsx's labels for
// these states drop the "this meso" wording too (see its own comment).
export type CrossRunReachBack =
  | { type: 'none_found' } // no completed, non-deload, non-warmup occurrence of this exercise anywhere
  | { type: 'all_skipped' } // occurrences exist, but every one was skipped (no real set, ever)
  | { type: 'found'; session: ReferenceSession; daysSince: number }

export function resolveReachBackAcrossRuns(today: string, sessions: ReferenceSession[]): CrossRunReachBack {
  const candidates = excludeDeload(sessions).map(withEffectiveDate)
  const todayDate = parseISO(today)
  const past = candidates.filter((s) => parseISO(s.date) < todayDate)
  if (past.length === 0) return { type: 'none_found' }

  // hasRealLoggedSet is referenceLogic.ts's own existing export (frozen,
  // unchanged) — "has a real (non-skipped) logged set", the same rule
  // positionMatch.ts's buildLoggedSlots already applies. Warmup logs never
  // reach `.logs` at all (filtered at the query layer, same convention
  // fetchReferenceSessions/fetchReferenceSessionsByExercise both use), so a
  // session where only warmups were logged for this exercise has
  // `logs: []` and is already excluded here the same way an all-skipped
  // one is — no separate warmup check needed at this layer.
  const withReal = past.filter(hasRealLoggedSet).sort(byMostRecent)
  if (withReal.length === 0) return { type: 'all_skipped' }

  const session = withReal[0]
  return {
    type: 'found',
    session,
    daysSince: differenceInCalendarDays(todayDate, parseISO(session.date)),
  }
}
