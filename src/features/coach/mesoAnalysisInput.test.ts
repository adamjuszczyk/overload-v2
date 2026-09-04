import { describe, it, expect } from 'vitest'
import {
  buildMesoAnalysisInput,
  DISCONTINUITY_THRESHOLD_PERCENT,
  type BuildMesoAnalysisInputArgs,
  type MesoInput,
  type MesoSetLogInput,
  type MesoSessionSummary,
  type MesoPlannedHeadCount,
  type MesoSwapRow,
} from './mesoAnalysisInput'
import type { PriorityContext } from './priorityContext'
import type { WeekRollup } from './mesoWeekRollup'

// ─── Fixture factories ──────────────────────────────────────────────────────

// 2026-01-05 is a real Monday — week boundaries land on clean, easy-to-read
// dates: week1=01-05, week2=01-12, week3=01-19, week4=01-26, week5=02-02,
// week6=02-09, week7=02-16, week8=02-23, week9=03-02.
const MESO_START = '2026-01-05'

function makeMeso(overrides: Partial<MesoInput> = {}): MesoInput {
  return { id: 'meso-1', name: 'MESO 1.0', startDate: MESO_START, endDate: null, status: 'active', ...overrides }
}

function makeSetLog(overrides: Partial<MesoSetLogInput> = {}): MesoSetLogInput {
  return {
    id: 'log-1',
    sessionId: 'session-1',
    sessionDate: '2026-01-12',
    exerciseId: 'ex1',
    weight: 100,
    reps: 8,
    rir: 2,
    isSkipped: false,
    isWarmup: false,
    parentSetId: null,
    formRating: null,
    ...overrides,
  }
}

function makeSession(overrides: Partial<MesoSessionSummary> = {}): MesoSessionSummary {
  return { id: 'session-1', date: '2026-01-12', workoutDayName: 'Push 1', ...overrides }
}

function makePriority(): PriorityContext {
  return {
    mesocycleId: 'meso-1',
    muscleGroups: {} as PriorityContext['muscleGroups'],
    muscleSubgroups: {} as PriorityContext['muscleSubgroups'],
    subgroupParent: {} as PriorityContext['subgroupParent'],
    entries: [],
    anyExplicit: false,
  }
}

function baseArgs(overrides: Partial<BuildMesoAnalysisInputArgs> = {}): BuildMesoAnalysisInputArgs {
  return {
    meso: makeMeso(),
    weekRollups: [],
    sessions: [],
    setLogs: [],
    exerciseTags: new Map(),
    plannedHeadCounts: [],
    resolvedPlanWeeks: new Set(),
    deloadWeeks: new Set(),
    plannedExerciseIdsBySession: new Map(),
    swaps: [],
    priority: makePriority(),
    phaseEntries: [],
    weightEntries: [],
    ...overrides,
  }
}

function findPoint(exercises: ReturnType<typeof buildMesoAnalysisInput>['exercises'], exerciseId: string, weekNumber: number) {
  const trajectory = exercises.find((e) => e.exerciseId === exerciseId)
  return trajectory?.points.find((p) => p.weekNumber === weekNumber)
}

// e1rm.ts's Epley formula, single eligible set, reps=10 rir=0:
// e1RM = weight * (1 + 10/30) = weight * 1.3333...
// Solved for weight given a target average: weight = target * 0.75.
function weightForE1rm(target: number): number {
  return target * 0.75
}

// ─── null e1RM ──────────────────────────────────────────────────────────────

describe('buildMesoAnalysisInput — e1rmAvg (§2.2)', () => {
  it('is null when no eligible set has a recorded RIR, never defaulted to zero or read as a decline', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession()],
        setLogs: [makeSetLog({ rir: null })], // no RIR recorded — the real, common case (Leg Press etc., §2.2)
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.e1rmAvg).toBeNull()
  })

  it('averages sessionE1rmAvg per session across the week, not a flattened set list', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1' }), makeSession({ id: 's2' })],
        setLogs: [
          makeSetLog({ id: 'l1', sessionId: 's1', weight: weightForE1rm(50), reps: 10, rir: 0 }),
          makeSetLog({ id: 'l2', sessionId: 's2', weight: weightForE1rm(60), reps: 10, rir: 0 }),
        ],
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.e1rmAvg).toBeCloseTo(55, 5)
  })
})

// ─── volume keeps drop stages, setsCompleted excludes them ─────────────────

describe('buildMesoAnalysisInput — volume vs setsCompleted asymmetry (§2.1)', () => {
  it('volume sums head + drop stage; setsCompleted counts the head only', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession()],
        setLogs: [
          makeSetLog({ id: 'head', weight: 100, reps: 8, parentSetId: null }),
          makeSetLog({ id: 'stage', weight: 80, reps: 6, parentSetId: 'head' }),
        ],
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.setsCompleted).toBe(1)
    expect(point?.volume).toBe(100 * 8 + 80 * 6)
  })

  it('a stage under a SKIPPED head is excluded from volume too, even with real weight/reps of its own', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession()],
        setLogs: [
          makeSetLog({ id: 'head', weight: null, reps: null, isSkipped: true, parentSetId: null }),
          // A stage can carry real values even when its parent head was skipped
          // (progressService.ts's isStageOfSkippedHead, found by adversarial
          // review) — this must not sneak into volume.
          makeSetLog({ id: 'stage', weight: 80, reps: 6, isSkipped: false, parentSetId: 'head' }),
        ],
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.setsCompleted).toBe(0)
    expect(point?.volume).toBe(0)
  })

  it('a legitimate stage under a non-skipped head IS counted in volume', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession()],
        setLogs: [
          makeSetLog({ id: 'head', weight: 100, reps: 8, isSkipped: false, parentSetId: null }),
          makeSetLog({ id: 'stage', weight: 80, reps: 6, isSkipped: false, parentSetId: 'head' }),
        ],
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.volume).toBe(100 * 8 + 80 * 6)
  })
})

// ─── setsPlanned: null vs 0 ─────────────────────────────────────────────────

describe('buildMesoAnalysisInput — setsPlanned null vs zero (§2.4)', () => {
  it('is null, not 0, when the week has no resolvable plan at all', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })], // week 2
        setLogs: [makeSetLog({ sessionId: 's1', sessionDate: '2026-01-12' })],
        resolvedPlanWeeks: new Set(), // week 2 unresolvable — no v2_week_plans row
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.setsPlanned).toBeNull()
  })

  it('is a real 0, not null, when the week has a resolvable plan but this exercise has no planned sets in it', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })], // week 2
        setLogs: [makeSetLog({ sessionId: 's1', sessionDate: '2026-01-12' })],
        resolvedPlanWeeks: new Set([2]), // week 2 resolvable...
        plannedHeadCounts: [], // ...but nothing planned for ex1 in it
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.setsPlanned).toBe(0)
  })

  it('reports the real planned head count when both plan and log exist', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })],
        setLogs: [makeSetLog({ sessionId: 's1', sessionDate: '2026-01-12' })],
        resolvedPlanWeeks: new Set([2]),
        plannedHeadCounts: [{ weekNumber: 2, exerciseId: 'ex1', headCount: 3 }],
      }),
    )
    const point = findPoint(result.exercises, 'ex1', 2)
    expect(point?.setsPlanned).toBe(3)
  })
})

// ─── deload weeks included, not excluded ───────────────────────────────────

describe('buildMesoAnalysisInput — deload weeks stay in the trajectory (§2.2)', () => {
  it('a deload week still gets a real e1rmAvg point, with isDeload true — never excluded like compareE1rmWindow does', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' }), makeSession({ id: 's2', date: '2026-01-19' })],
        setLogs: [
          makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', weight: weightForE1rm(50), reps: 10, rir: 0 }),
          makeSetLog({ id: 'l2', sessionId: 's2', sessionDate: '2026-01-19', weight: weightForE1rm(30), reps: 10, rir: 0 }),
        ],
        deloadWeeks: new Set([3]), // week 3 (2026-01-19) is a flagged deload week
      }),
    )
    const deloadPoint = findPoint(result.exercises, 'ex1', 3)
    expect(deloadPoint?.isDeload).toBe(true)
    expect(deloadPoint?.e1rmAvg).toBeCloseTo(30, 5)
    // present in points at all — not filtered out for being a deload week
    expect(result.exercises[0].points.map((p) => p.weekNumber)).toEqual([2, 3])
  })
})

// ─── top-level weeks densification, including an empty mid-block week ─────

describe('buildMesoAnalysisInput — meso-wide weeks densification (§2.3)', () => {
  it('fills a genuinely untrained mid-block week as zeroed, not absent, and starts at week 1', () => {
    const rollupWeek2: WeekRollup = {
      weekNumber: 2,
      totalSets: 12,
      avgRir: 2,
      avgReps: 8,
      avgDurationSeconds: 3600,
      avgFormRating: null,
      avgEnergyRating: null,
      avgPumpRating: null,
      isDeload: false,
    }
    const rollupWeek4: WeekRollup = { ...rollupWeek2, weekNumber: 4, totalSets: 15 }

    const result = buildMesoAnalysisInput(
      baseArgs({
        weekRollups: [rollupWeek2, rollupWeek4],
        sessions: [makeSession({ id: 's1', date: '2026-01-12' }), makeSession({ id: 's2', date: '2026-01-26' })],
        deloadWeeks: new Set(),
      }),
    )

    expect(result.weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4])

    const week1 = result.weeks.find((w) => w.weekNumber === 1)!
    expect(week1.sessionsInWeek).toBe(0)
    expect(week1.totalSets).toBe(0)
    expect(week1.isDeload).toBe(false)

    const week3 = result.weeks.find((w) => w.weekNumber === 3)!
    expect(week3.sessionsInWeek).toBe(0)
    expect(week3.totalSets).toBe(0)

    const week2 = result.weeks.find((w) => w.weekNumber === 2)!
    expect(week2.sessionsInWeek).toBe(1)
    expect(week2.totalSets).toBe(12)

    const week4 = result.weeks.find((w) => w.weekNumber === 4)!
    expect(week4.totalSets).toBe(15)
  })

  it('an empty meso (no sessions, no rollups) produces an empty weeks array, not a phantom week 1', () => {
    const result = buildMesoAnalysisInput(baseArgs())
    expect(result.weeks).toEqual([])
    expect(result.meso.weekCount).toBe(0)
  })
})

// ─── §3.3 Case A — linked swaps read as fact ───────────────────────────────

describe('buildMesoAnalysisInput — swaps, Case A (§3.3)', () => {
  it('a structural swap row is read verbatim, with weekNumber computed from its session date', () => {
    const swap: MesoSwapRow = {
      sessionId: 'session-swap',
      sessionDate: '2026-01-19', // week 3
      originalExerciseId: 'ex-chest',
      originalExerciseName: 'Chest Press',
      replacementExerciseId: 'ex-smith',
      replacementExerciseName: 'Incline Smith Press',
    }
    const result = buildMesoAnalysisInput(baseArgs({ swaps: [swap] }))
    expect(result.swaps).toEqual([{ ...swap, weekNumber: 3 }])
  })
})

// ─── §3.3 Case B — unlinked candidates, never a claimed pairing ────────────

describe('buildMesoAnalysisInput — unlinkedSwapCandidates, Case B (§3.3)', () => {
  it('flags a session with BOTH an abandoned planned exercise AND an unplanned logged exercise', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })],
        plannedExerciseIdsBySession: new Map([['s1', new Set(['ex-planned'])]]),
        setLogs: [
          // planned exercise, all skipped — abandoned
          makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-planned', weight: null, reps: null, isSkipped: true }),
          // unplanned exercise, really logged
          makeSetLog({ id: 'l2', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-unplanned', weight: 50, reps: 10 }),
        ],
      }),
    )
    expect(result.unlinkedSwapCandidates).toEqual([
      {
        sessionId: 's1',
        sessionDate: '2026-01-12',
        weekNumber: 2,
        abandonedExerciseIds: ['ex-planned'],
        unplannedExerciseIds: ['ex-unplanned'],
      },
    ])
  })

  it('a plain skip — an abandoned exercise with no unplanned counterpart — is NOT a candidate', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })],
        plannedExerciseIdsBySession: new Map([['s1', new Set(['ex-planned'])]]),
        setLogs: [makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-planned', weight: null, reps: null, isSkipped: true })],
      }),
    )
    expect(result.unlinkedSwapCandidates).toEqual([])
  })

  it('never claims a pairing — both exercise lists are raw, unpaired co-occurrence, not a single linked fact', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })],
        plannedExerciseIdsBySession: new Map([['s1', new Set(['ex-a', 'ex-b'])]]),
        setLogs: [
          makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-a', weight: null, reps: null, isSkipped: true }),
          makeSetLog({ id: 'l2', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-b', weight: null, reps: null, isSkipped: true }),
          makeSetLog({ id: 'l3', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-c', weight: 50, reps: 10 }),
        ],
      }),
    )
    // Two abandoned, one unplanned — the raw co-occurrence, no 1:1 pairing asserted.
    expect(result.unlinkedSwapCandidates).toEqual([
      {
        sessionId: 's1',
        sessionDate: '2026-01-12',
        weekNumber: 2,
        abandonedExerciseIds: ['ex-a', 'ex-b'],
        unplannedExerciseIds: ['ex-c'],
      },
    ])
  })

  it('a session already covered by a Case A structural swap is excluded from Case B candidates', () => {
    const result = buildMesoAnalysisInput(
      baseArgs({
        sessions: [makeSession({ id: 's1', date: '2026-01-12' })],
        plannedExerciseIdsBySession: new Map([['s1', new Set(['ex-a'])]]),
        setLogs: [
          makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-a', weight: null, reps: null, isSkipped: true }),
          makeSetLog({ id: 'l2', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex-b', weight: 50, reps: 10 }),
        ],
        swaps: [
          {
            sessionId: 's1',
            sessionDate: '2026-01-12',
            originalExerciseId: 'ex-a',
            originalExerciseName: 'A',
            replacementExerciseId: 'ex-b',
            replacementExerciseName: 'B',
          },
        ],
      }),
    )
    expect(result.unlinkedSwapCandidates).toEqual([])
    expect(result.swaps).toHaveLength(1)
  })
})

// ─── §3.3 Case C — discontinuityFlag at the 25% threshold ──────────────────

describe('buildMesoAnalysisInput — discontinuityFlag, Case C (§3.3/A5), against real week-9 Chest Press data', () => {
  // The exact figures from MESOCYCLE-ANALYSIS-TASKS.md §0.4's table: weeks
  // 2-8 stable (49.5, 48.5, 48.1, 46.8, 48.5, 47.6, 49.9), week 9 collapses
  // to 31.6 — a real silent equipment substitution logged under the
  // original exercise's id, not an actual training outcome.
  const WEEKLY_E1RM_TARGETS: [date: string, target: number][] = [
    ['2026-01-12', 49.5], // week 2
    ['2026-01-19', 48.5], // week 3
    ['2026-01-26', 48.1], // week 4
    ['2026-02-02', 46.8], // week 5
    ['2026-02-09', 48.5], // week 6
    ['2026-02-16', 47.6], // week 7
    ['2026-02-23', 49.9], // week 8
    ['2026-03-02', 31.6], // week 9 — the artifact
  ]

  function buildChestPressArgs(): BuildMesoAnalysisInputArgs {
    const sessions = WEEKLY_E1RM_TARGETS.map(([date], i) => makeSession({ id: `s${i}`, date }))
    const setLogs = WEEKLY_E1RM_TARGETS.map(([date, target], i) =>
      makeSetLog({
        id: `l${i}`,
        sessionId: `s${i}`,
        sessionDate: date,
        exerciseId: 'chest-press',
        weight: weightForE1rm(target),
        reps: 10,
        rir: 0,
      }),
    )
    // Sets completed exactly as planned every week (1 planned, 1 done) —
    // so an incomplete session never "explains away" the week-9 anomaly.
    const resolvedPlanWeeks = new Set(WEEKLY_E1RM_TARGETS.map((_, i) => i + 2))
    const plannedHeadCounts: MesoPlannedHeadCount[] = WEEKLY_E1RM_TARGETS.map((_, i) => ({
      weekNumber: i + 2,
      exerciseId: 'chest-press',
      headCount: 1,
    }))
    return baseArgs({ sessions, setLogs, resolvedPlanWeeks, plannedHeadCounts })
  }

  it('trips at week 9 (−34.8% against the trailing median, exceeding the 25% threshold)', () => {
    const result = buildMesoAnalysisInput(buildChestPressArgs())
    const week9 = findPoint(result.exercises, 'chest-press', 9)
    expect(week9?.e1rmAvg).toBeCloseTo(31.6, 1)
    expect(week9?.discontinuityFlag).toBe(true)
  })

  it('does not trip on any of the ordinary week-to-week noise in weeks 2-8', () => {
    const result = buildMesoAnalysisInput(buildChestPressArgs())
    const earlyWeeks = result.exercises[0].points.filter((p) => p.weekNumber <= 8)
    expect(earlyWeeks.every((p) => p.discontinuityFlag === false)).toBe(true)
  })

  it('does not trip on a deload week even if its e1RM legitimately dips hard', () => {
    const args = baseArgs({
      sessions: [makeSession({ id: 's1', date: '2026-01-12' }), makeSession({ id: 's2', date: '2026-01-19' })],
      setLogs: [
        makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex1', weight: weightForE1rm(50), reps: 10, rir: 0 }),
        makeSetLog({ id: 'l2', sessionId: 's2', sessionDate: '2026-01-19', exerciseId: 'ex1', weight: weightForE1rm(30), reps: 10, rir: 0 }),
      ],
      deloadWeeks: new Set([3]),
    })
    const result = buildMesoAnalysisInput(args)
    const week3 = findPoint(result.exercises, 'ex1', 3)
    expect(week3?.isDeload).toBe(true)
    expect(week3?.discontinuityFlag).toBe(false) // a 40% dip, but explained by the deload flag
  })

  it('does not trip when the week is genuinely incomplete against its own plan', () => {
    const args = baseArgs({
      sessions: [makeSession({ id: 's1', date: '2026-01-12' }), makeSession({ id: 's2', date: '2026-01-19' })],
      setLogs: [
        makeSetLog({ id: 'l1', sessionId: 's1', sessionDate: '2026-01-12', exerciseId: 'ex1', weight: weightForE1rm(50), reps: 10, rir: 0 }),
        makeSetLog({ id: 'l2', sessionId: 's2', sessionDate: '2026-01-19', exerciseId: 'ex1', weight: weightForE1rm(30), reps: 10, rir: 0 }),
      ],
      resolvedPlanWeeks: new Set([2, 3]),
      plannedHeadCounts: [
        { weekNumber: 2, exerciseId: 'ex1', headCount: 1 },
        { weekNumber: 3, exerciseId: 'ex1', headCount: 3 }, // 3 planned, only 1 completed
      ],
    })
    const result = buildMesoAnalysisInput(args)
    const week3 = findPoint(result.exercises, 'ex1', 3)
    expect(week3?.setsCompleted).toBeLessThan(week3?.setsPlanned ?? 0)
    expect(week3?.discontinuityFlag).toBe(false)
  })

  it('the threshold constant is the recommended conservative 25% (A5)', () => {
    expect(DISCONTINUITY_THRESHOLD_PERCENT).toBe(25)
  })
})
