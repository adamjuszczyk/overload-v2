import { describe, it, expect } from 'vitest'
import {
  resolveExerciseReferenceAcrossRuns,
  resolveReachBackAcrossRuns,
} from './referenceByExercise'
import { resolveExerciseReference } from './referenceLogic'
import type { ReferenceSession } from './sessionService'
import type { SetLog } from '../../types'
import type { SetGroup } from './setGroupLogic'

// Same fixture-building convention as referenceLogic.test.ts (this file's
// frozen sibling) — kept deliberately parallel so a reviewer can compare
// the two directly. Extended with isDeload/movedToDate (chunk 23's own new,
// optional ReferenceSession fields; referenceLogic.test.ts's own
// makeSession predates both and is untouched).
function makeSession(
  sessionId: string,
  date: string,
  completedAt: string | null = null,
  mesocycleId: string | null = null,
  logs: SetGroup<SetLog>[] = [],
  isDeload = false,
  movedToDate: string | null = null,
): ReferenceSession {
  return { sessionId, date, completedAt, mesocycleId, logs, isDeload, movedToDate }
}

function makeLog(isSkipped: boolean): SetLog {
  return {
    id: 'log-' + Math.random(),
    userId: 'u1',
    sessionId: 's',
    exerciseId: 'ex1',
    weekPlanSetId: null,
    setNumber: 1,
    weight: isSkipped ? null : 100,
    reps: isSkipped ? null : 8,
    rir: isSkipped ? null : 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped,
    loggedAt: '2026-08-01T10:00:00Z',
    restSeconds: null,
    formRating: null,
  }
}

function makeGroup(isSkipped: boolean): SetGroup<SetLog> {
  return { head: makeLog(isSkipped), stages: [] }
}

// today = 2026-08-11 (Tuesday) — same date referenceLogic.test.ts itself
// uses, so these window boundaries are cross-checkable against that file's
// own comments: thisWeekStart = 2026-08-10 (Monday); prevWeek =
// [2026-08-03 (Mon), 2026-08-09 (Sun)].
const today = '2026-08-11'

describe('resolveExerciseReferenceAcrossRuns — weekday: LAST WEEK only for a normal (non-deload) match', () => {
  it('previous week, normal (non-deload) match -> LAST WEEK', () => {
    const candidates = [makeSession('s1', '2026-08-05', null, 'meso-1', [makeGroup(false)])]
    const { primary } = resolveExerciseReferenceAcrossRuns(today, 'weekday', candidates)
    expect(primary.type).toBe('last_week')
    if (primary.type === 'last_week') expect(primary.session.sessionId).toBe('s1')
  })

  it('previous week\'s ONLY match is deload -> LAST TIME from the last normal occurrence, not LAST WEEK', () => {
    // Discriminating: without the deload filter, the prevWeek candidate
    // would win as LAST WEEK (it's the most recent of the two, and it IS
    // inside the window) — the filter is what changes the outcome.
    const deloadLastWeek = makeSession('deload', '2026-08-05', null, 'meso-1', [makeGroup(false)], true)
    const normalEarlier = makeSession('normal', '2026-07-20', null, 'meso-1', [makeGroup(false)], false)
    const { primary } = resolveExerciseReferenceAcrossRuns(today, 'weekday', [deloadLastWeek, normalEarlier])
    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') {
      expect(primary.session.sessionId).toBe('normal')
      expect(primary.daysSince).toBe(22) // 2026-07-20 -> 2026-08-11
    }
  })

  it('a deload-only history (no normal occurrence anywhere) is FIRST TIME, not LAST WEEK/LAST TIME', () => {
    const onlyDeload = makeSession('deload-only', '2026-08-05', null, 'meso-1', [makeGroup(false)], true)
    const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, 'weekday', [onlyDeload])
    expect(primary).toEqual({ type: 'first_time' })
    expect(thisWeek).toEqual([])
  })

  it('done only in another workout (no prevWeek/thisWeek match, an arbitrary earlier date) -> LAST TIME', () => {
    // The resolver has no workout_day_id input at all — it is the
    // candidate QUERY (sessionService.test.referenceByExercise.ts) that no
    // longer scopes by workout day; this proves the date-fallback chain
    // still lands correctly once such a session reaches it as a candidate.
    const candidates = [makeSession('other-workout', '2026-07-21', null, 'meso-1', [makeGroup(false)])]
    const { primary } = resolveExerciseReferenceAcrossRuns(today, 'weekday', candidates)
    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') {
      expect(primary.session.sessionId).toBe('other-workout')
      expect(primary.daysSince).toBe(21)
    }
  })

  it('done only in an earlier run (different mesocycleId, no prevWeek/thisWeek match) -> LAST TIME', () => {
    const candidates = [makeSession('earlier-run', '2026-06-01', null, 'meso-0', [makeGroup(false)])]
    const { primary } = resolveExerciseReferenceAcrossRuns(today, 'weekday', candidates)
    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') expect(primary.session.sessionId).toBe('earlier-run')
  })

  it('FIRST TIME only when truly never done: zero candidates at all', () => {
    const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, 'weekday', [])
    expect(primary).toEqual({ type: 'first_time' })
    expect(thisWeek).toEqual([])
  })
})

describe('resolveExerciseReferenceAcrossRuns — moved_to_date decides elapsed time, and which week a session lands in', () => {
  it('daysSince is measured from movedToDate, not the raw session date, when both land in the same (LAST TIME) bucket', () => {
    // Raw date (2026-07-01, 41 days back) and movedToDate (2026-07-25, 17
    // days back) are both well outside prevWeek — isolates "which date is
    // daysSince computed from" from "which week bucket this lands in".
    const moved = makeSession('moved', '2026-07-01', null, 'meso-1', [makeGroup(false)], false, '2026-07-25')
    const { primary } = resolveExerciseReferenceAcrossRuns(today, 'weekday', [moved])
    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') expect(primary.daysSince).toBe(17)
  })

  it('a session moved INTO the preceding week is matched as LAST WEEK even though its raw date is 3+ weeks back', () => {
    // Raw date 2026-07-01 is nowhere near prevWeek on its own (would be
    // LAST TIME) — movedToDate 2026-08-05 is squarely inside
    // [2026-08-03, 2026-08-09]. If the substitution weren't applied this
    // would resolve to LAST_TIME with daysSince ~41, not LAST_WEEK.
    const moved = makeSession('moved-into-last-week', '2026-07-01', null, 'meso-1', [makeGroup(false)], false, '2026-08-05')
    const { primary } = resolveExerciseReferenceAcrossRuns(today, 'weekday', [moved])
    expect(primary.type).toBe('last_week')
    if (primary.type === 'last_week') expect(primary.session.sessionId).toBe('moved-into-last-week')
  })

  it('the reach-back also measures elapsed time from movedToDate', () => {
    const skippedRecent = makeSession('recent-skipped', '2026-08-09', null, 'meso-1', [makeGroup(true)])
    const movedReal = makeSession('moved-real', '2026-06-01', null, 'meso-1', [makeGroup(false)], false, '2026-07-28')
    const result = resolveReachBackAcrossRuns(today, [skippedRecent, movedReal])
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.session.sessionId).toBe('moved-real')
      expect(result.daysSince).toBe(14) // 2026-07-28 -> 2026-08-11, not 2026-06-01's 71
    }
  })
})

describe('resolveExerciseReferenceAcrossRuns — sequence: always LAST TIME, never LAST WEEK, EARLIER THIS WEEK always hidden', () => {
  it('a match inside the preceding week is still LAST TIME (+ elapsed), never LAST WEEK', () => {
    const candidates = [makeSession('s1', '2026-08-05', null, 'meso-1', [makeGroup(false)])]
    const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, 'sequence', candidates)
    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') {
      expect(primary.session.sessionId).toBe('s1')
      expect(primary.daysSince).toBe(6) // 2026-08-05 -> 2026-08-11
    }
    expect(thisWeek).toEqual([])
  })

  it('a match from THIS week is still LAST TIME, and thisWeek stays empty — same data shows up in thisWeek on the weekday branch', () => {
    const candidates = [makeSession('s1', '2026-08-10', null, 'meso-1', [makeGroup(false)])]

    const weekday = resolveExerciseReferenceAcrossRuns(today, 'weekday', candidates)
    expect(weekday.primary.type).toBe('last_time')
    expect(weekday.thisWeek).toHaveLength(1) // weekday's own EARLIER THIS WEEK slot is populated

    const sequence = resolveExerciseReferenceAcrossRuns(today, 'sequence', candidates)
    expect(sequence.primary.type).toBe('last_time')
    if (sequence.primary.type === 'last_time') expect(sequence.primary.session.sessionId).toBe('s1')
    expect(sequence.thisWeek).toEqual([]) // hidden on the sequence branch, same underlying session
  })

  it('a deload-only match is FIRST TIME, same deload rule as the weekday branch', () => {
    const onlyDeload = makeSession('deload-only', '2026-08-05', null, 'meso-1', [makeGroup(false)], true)
    const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, 'sequence', [onlyDeload])
    expect(primary).toEqual({ type: 'first_time' })
    expect(thisWeek).toEqual([])
  })

  it('FIRST TIME only when truly never done: zero candidates at all', () => {
    const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, 'sequence', [])
    expect(primary).toEqual({ type: 'first_time' })
    expect(thisWeek).toEqual([])
  })
})

describe('resolveExerciseReferenceAcrossRuns — parity with the frozen resolveExerciseReference for a plain, non-deload, no-move weekday case', () => {
  it('produces exactly the same ReferenceState as calling resolveExerciseReference directly (master\'s own behaviour) when nothing new applies', () => {
    // "A plain weekday session whose exercises were last done last week, in
    // the same workout, non-deload" (this chunk's D30-adjacent parity
    // rule) — isDeload/movedToDate both absent, exactly the shape every
    // session predating this chunk has. excludeDeload/withEffectiveDate
    // are then no-ops, so this call is provably a pure passthrough to the
    // UNCHANGED (check-frozen-code.mjs-enforced) resolveExerciseReference —
    // the live panel's output for this exact, common case cannot have
    // changed.
    const candidates = [
      makeSession('last-week', '2026-08-05', '2026-08-05T18:00:00Z', 'meso-1', [makeGroup(false)]),
      makeSession('earlier-this-week', '2026-08-10', null, 'meso-1', [makeGroup(false)]),
    ]
    const viaNew = resolveExerciseReferenceAcrossRuns(today, 'weekday', candidates)
    const viaMaster = resolveExerciseReference(today, candidates)
    expect(viaNew).toEqual(viaMaster)
    // Sanity — not a vacuous comparison of two empty results.
    expect(viaNew.primary.type).toBe('last_week')
    expect(viaNew.thisWeek).toHaveLength(1)
  })
})

describe('resolveReachBackAcrossRuns — cross-run reach-back (SPEC: "crosses run boundaries too")', () => {
  it('finds a real set in an earlier run when the most recent occurrence (a different run) was all skipped', () => {
    const recentSkippedOtherRun = makeSession('recent-skipped', '2026-08-08', null, 'meso-2', [makeGroup(true)])
    const earlierRunReal = makeSession('earlier-run-real', '2026-07-01', null, 'meso-1', [makeGroup(false)])
    const result = resolveReachBackAcrossRuns(today, [recentSkippedOtherRun, earlierRunReal])
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.session.sessionId).toBe('earlier-run-real')
      expect(result.daysSince).toBe(41) // 2026-07-01 -> 2026-08-11
    }
  })

  it('warmups ignored: a session with nothing but warmups for this exercise (logs: []) is treated the same as all-skipped', () => {
    // Warmup exclusion happens upstream, at the query layer (a warmup log
    // never reaches `.logs` at all — sessionService.ts's
    // fetchReferenceSessionsByExercise/fetchReferenceSessions both drop it
    // before a ReferenceSession is built) — this is what that looks like
    // once it reaches this function: an empty logs array, same as
    // hasRealLoggedSet already treats an all-skipped session.
    const warmupOnly: ReferenceSession = makeSession('warmup-only', '2026-08-08', null, 'meso-1', [])
    const earlierReal = makeSession('earlier-real', '2026-07-01', null, 'meso-1', [makeGroup(false)])
    const result = resolveReachBackAcrossRuns(today, [warmupOnly, earlierReal])
    expect(result.type).toBe('found')
    if (result.type === 'found') expect(result.session.sessionId).toBe('earlier-real')
  })

  it('all_skipped: every occurrence across every run was skipped', () => {
    const candidates = [
      makeSession('s1', '2026-08-08', null, 'meso-2', [makeGroup(true)]),
      makeSession('s2', '2026-07-01', null, 'meso-1', [makeGroup(true)]),
    ]
    expect(resolveReachBackAcrossRuns(today, candidates)).toEqual({ type: 'all_skipped' })
  })

  it('none_found: zero candidates at all', () => {
    expect(resolveReachBackAcrossRuns(today, [])).toEqual({ type: 'none_found' })
  })

  it('excludes a deload session even when it is the most recent real-set occurrence (defensive — the service layer already excludes it too)', () => {
    const recentDeloadReal = makeSession('recent-deload', '2026-08-08', null, 'meso-1', [makeGroup(false)], true)
    const earlierNormalReal = makeSession('earlier-normal', '2026-07-01', null, 'meso-1', [makeGroup(false)], false)
    const result = resolveReachBackAcrossRuns(today, [recentDeloadReal, earlierNormalReal])
    expect(result.type).toBe('found')
    if (result.type === 'found') expect(result.session.sessionId).toBe('earlier-normal')
  })

  it('a deload-only set of occurrences is all_skipped-equivalent: none_found (every occurrence is excluded, not "all skipped")', () => {
    const onlyDeload = makeSession('deload-only', '2026-07-01', null, 'meso-1', [makeGroup(false)], true)
    expect(resolveReachBackAcrossRuns(today, [onlyDeload])).toEqual({ type: 'none_found' })
  })
})
