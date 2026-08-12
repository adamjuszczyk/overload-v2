// Pure e1RM + meso-window comparison (TASKS.md §2.5 / SPEC §6). RIR-adjusted
// Epley, averaged across a session's eligible main working sets, compared
// first-eligible-session vs. most-recent-eligible-session. Deliberately pure
// and separate, same precedent as setGroupLogic.ts / referenceLogic.ts — this
// is the module Section 1's Vitest argument is really about (TASKS.md §2.5).
//
// This module doesn't know what a mesocycle is — same separation
// referenceLogic.ts uses between its own date-window math (pure) and the
// workout_day_id scoping its caller does before invoking it. Whoever calls
// compareE1rmWindow decides which sessions belong to "the current meso";
// this file only ever sees an already-scoped list.

export interface E1rmSetInput {
  weight: number | null
  reps: number | null
  rir: number | null
  isSkipped: boolean
  isWarmup: boolean
  parentSetId: string | null
}

export interface E1rmSessionInput {
  sessionId: string
  date: string
  isDeload: boolean
  sets: E1rmSetInput[]
}

// firstAvg/lastAvg/deltaPercent are the whole-session-average numbers this
// module was originally built to compute (SPEC §6's original headline). As
// of the position-matched headline (2026-08-12, see CONTEXT.md), no
// production code reads any of the three anymore — ExerciseProgress.tsx
// now displays averagePositionMatchedDelta's rollup instead, and
// progressService.ts's fetchPositionMatchedHeadline reads this type only
// for its session identity (firstSessionId/firstDate/lastSessionId/
// lastDate). Kept, not removed: compareE1rmWindow's session-
// eligibility/selection logic (which two sessions are "first" and "last")
// is still exactly what the live headline relies on today, and computing
// the averages is inseparable from that selection — the eligibility
// filter itself is "has a non-null average, and isn't in a deload week", so
// a narrower version that dropped these three fields would still have to
// compute them internally to decide eligibility. Still directly tested
// (e1rm.test.ts) as part of asserting this function's own correctness,
// independent of which fields production currently reads.
export interface E1rmComparison {
  firstSessionId: string
  firstDate: string
  firstAvg: number
  lastSessionId: string
  lastDate: string
  lastAvg: number
  deltaPercent: number
}

type EligibleSet = { weight: number; reps: number; rir: number }

// Eligible set (TASKS.md §2.5): not skipped, not warmup, a head (parent_set_id
// null — a drop stage is never counted as an independent set, same
// stage-exclusion rule as everywhere else), weight/reps/rir all recorded.
// A set with no RIR recorded contributes nothing — it is not defaulted to
// rir=0. Unadjusted Epley is systematically lower than RIR-adjusted for the
// same performance (effectiveReps >= reps whenever RIR is recorded at all),
// so defaulting a missing RIR to 0 would understate that set relative to an
// honestly-recorded RIR-0 set beside it and silently change what the average
// means set to set within the same session.
function isEligibleSet(s: E1rmSetInput): s is E1rmSetInput & EligibleSet {
  return (
    !s.isSkipped &&
    !s.isWarmup &&
    s.parentSetId == null &&
    s.weight != null &&
    s.reps != null &&
    s.rir != null
  )
}

// effectiveReps = reps + rir; e1RM = weight × (1 + effectiveReps / 30)
export function calculateE1rm(set: EligibleSet): number {
  const effectiveReps = set.reps + set.rir
  return set.weight * (1 + effectiveReps / 30)
}

// Average e1RM across a session's eligible sets — every real working set
// counts, not just the top set (SPEC §6). Null when the session has none
// eligible, most commonly because no working set that day has a recorded
// RIR. compareE1rmWindow treats null as "this session doesn't exist" for the
// comparison, never as a zero.
export function sessionE1rmAvg(sets: E1rmSetInput[]): number | null {
  const eligible = sets.filter(isEligibleSet)
  if (eligible.length === 0) return null
  const total = eligible.reduce((sum, s) => sum + calculateE1rm(s), 0)
  return total / eligible.length
}

// First eligible session vs. most recent eligible session. A session drops
// out of "eligible" here for either of two independent reasons, and both are
// full exclusions rather than partial/unadjusted fallbacks (TASKS.md §2.5):
//   - sessionE1rmAvg is null (no working set that day has a recorded RIR)
//   - the session falls in a deload week (a deload baseline is artificially
//     low and would flatter the headline)
// Filtering the full list once and taking the two ends already gives the
// "fall back to the next eligible session in that direction" behaviour the
// spec asks for — no separate fallback branch needed for either reason, or
// for the two of them landing on the same session.
export function compareE1rmWindow(sessions: E1rmSessionInput[]): E1rmComparison | null {
  const eligible = sessions
    .map((s) => ({ session: s, avg: sessionE1rmAvg(s.sets) }))
    .filter(
      (s): s is { session: E1rmSessionInput; avg: number } => s.avg !== null && !s.session.isDeload,
    )
    .sort((a, b) => {
      const d = a.session.date.localeCompare(b.session.date)
      return d !== 0 ? d : a.session.sessionId.localeCompare(b.session.sessionId)
    })

  // Fewer than 2 eligible sessions — show nothing, not "+0%" (TASKS.md §2.5
  // edge-case table). This is also what an exercise with eligible sessions
  // but every one of them in a deload week collapses to, once the deload
  // filter above has run.
  if (eligible.length < 2) return null

  const first = eligible[0]
  const last = eligible[eligible.length - 1]

  return {
    firstSessionId: first.session.sessionId,
    firstDate: first.session.date,
    firstAvg: first.avg,
    lastSessionId: last.session.sessionId,
    lastDate: last.session.date,
    lastAvg: last.avg,
    deltaPercent: ((last.avg - first.avg) / first.avg) * 100,
  }
}
