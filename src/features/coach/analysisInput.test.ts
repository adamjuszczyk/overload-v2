import { describe, it, expect } from 'vitest'
import { buildAnalysisInput, type AnalysisInputExerciseSource, type BuildAnalysisInputArgs } from './analysisInput'
import type { SetLog, PhaseEntry, WeightEntry } from '../../types'
import type { PrimarySlot } from '../gym/referenceLogic'

function makeSetLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 's1',
    userId: 'u1',
    sessionId: 'session-current',
    exerciseId: 'ex1',
    weekPlanSetId: null,
    setNumber: 1,
    weight: 100,
    reps: 8,
    rir: 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-08-18T10:00:00Z',
    restSeconds: null,
    ...overrides,
  }
}

function makePhaseEntry(overrides: Partial<PhaseEntry> = {}): PhaseEntry {
  return {
    id: 'p1',
    userId: 'u1',
    phase: 'bulk',
    startDate: '2026-08-04',
    createdAt: '2026-08-04T00:00:00Z',
    ...overrides,
  }
}

function makeWeightEntry(overrides: Partial<WeightEntry> = {}): WeightEntry {
  return {
    id: 'w1',
    userId: 'u1',
    entryDate: '2026-08-17',
    weightKg: 82,
    kind: 'daily',
    createdAt: '2026-08-17T00:00:00Z',
    ...overrides,
  }
}

function makeExerciseSource(overrides: Partial<AnalysisInputExerciseSource> = {}): AnalysisInputExerciseSource {
  return {
    exerciseId: 'ex1',
    exerciseName: 'Bench Press',
    currentLogs: [makeSetLog()],
    reference: { type: 'first_time' },
    referenceLogs: null,
    isDeloadReference: null,
    ...overrides,
  }
}

function baseArgs(overrides: Partial<BuildAnalysisInputArgs> = {}): BuildAnalysisInputArgs {
  return {
    session: { id: 'session-current', date: '2026-08-18', workoutDayName: 'Push 1' },
    isDeloadCurrent: false,
    exercises: [makeExerciseSource()],
    phaseEntries: [],
    weightEntries: [],
    ...overrides,
  }
}

describe('buildAnalysisInput — reference labelling (§5.5)', () => {
  it('first_time: no match, no reference session, isDeloadReference is null', () => {
    const result = buildAnalysisInput(baseArgs())
    expect(result.exercises[0].reference).toEqual({ kind: 'first_time' })
    expect(result.exercises[0].match).toBeNull()
    expect(result.exercises[0].isDeloadReference).toBeNull()
  })

  it('last_week: labelled with the reference session, match computed from both logs', () => {
    const reference: PrimarySlot = {
      type: 'last_week',
      session: { sessionId: 'session-ref', date: '2026-08-11', completedAt: null, logs: [] },
    }
    const args = baseArgs({
      exercises: [
        makeExerciseSource({
          reference,
          referenceLogs: [makeSetLog({ id: 'r1', sessionId: 'session-ref', weight: 95, loggedAt: '2026-08-11T10:00:00Z' })],
          isDeloadReference: false,
        }),
      ],
    })
    const result = buildAnalysisInput(args)
    expect(result.exercises[0].reference).toEqual({
      kind: 'last_week',
      sessionId: 'session-ref',
      date: '2026-08-11',
    })
    expect(result.exercises[0].isDeloadReference).toBe(false)
    expect(result.exercises[0].match).not.toBeNull()
    expect(result.exercises[0].match!.plain.slots[0].head.a.weight).toBe(95)
    expect(result.exercises[0].match!.plain.slots[0].head.b.weight).toBe(100)
  })

  it('last_time: carries daysSince, distinguishing a gap from a clean weekly comparison', () => {
    const reference: PrimarySlot = {
      type: 'last_time',
      session: { sessionId: 'session-ref', date: '2026-07-14', completedAt: null, logs: [] },
      daysSince: 35,
    }
    const args = baseArgs({
      exercises: [
        makeExerciseSource({
          reference,
          referenceLogs: [makeSetLog({ id: 'r1', sessionId: 'session-ref' })],
          isDeloadReference: true,
        }),
      ],
    })
    const result = buildAnalysisInput(args)
    expect(result.exercises[0].reference).toEqual({
      kind: 'last_time',
      sessionId: 'session-ref',
      date: '2026-07-14',
      daysSince: 35,
    })
    expect(result.exercises[0].isDeloadReference).toBe(true)
    expect(result.exercises[0].match).not.toBeNull()
  })

  it('isDeloadReference is forced null for first_time even if the source data claims otherwise', () => {
    const args = baseArgs({
      exercises: [makeExerciseSource({ reference: { type: 'first_time' }, isDeloadReference: true })],
    })
    const result = buildAnalysisInput(args)
    expect(result.exercises[0].isDeloadReference).toBeNull()
  })
})

describe('buildAnalysisInput — session-level fields', () => {
  it('passes through session id/date/workoutDayName and isDeloadCurrent verbatim', () => {
    const result = buildAnalysisInput(
      baseArgs({
        session: { id: 'session-current', date: '2026-08-18', workoutDayName: 'Pull 2' },
        isDeloadCurrent: true,
      }),
    )
    expect(result.session).toEqual({ id: 'session-current', date: '2026-08-18', workoutDayName: 'Pull 2' })
    expect(result.isDeloadCurrent).toBe(true)
  })

  it('workoutDayName can be null (no workout day on the session)', () => {
    const result = buildAnalysisInput(
      baseArgs({ session: { id: 'session-current', date: '2026-08-18', workoutDayName: null } }),
    )
    expect(result.session.workoutDayName).toBeNull()
  })

  it('does not include a session note field at all — SPEC §8/§9 excludes it from v1 reasoning inputs', () => {
    const result = buildAnalysisInput(baseArgs())
    expect('note' in result.session).toBe(false)
  })

  it('processes multiple exercises independently, each keeping its own reference kind', () => {
    const args = baseArgs({
      exercises: [
        makeExerciseSource({ exerciseId: 'ex1', exerciseName: 'Bench Press', reference: { type: 'first_time' } }),
        makeExerciseSource({
          exerciseId: 'ex2',
          exerciseName: 'Squat',
          currentLogs: [makeSetLog({ exerciseId: 'ex2' })],
          reference: {
            type: 'last_week',
            session: { sessionId: 'session-ref2', date: '2026-08-11', completedAt: null, logs: [] },
          },
          referenceLogs: [makeSetLog({ id: 'r2', exerciseId: 'ex2', sessionId: 'session-ref2' })],
        }),
      ],
    })
    const result = buildAnalysisInput(args)
    expect(result.exercises).toHaveLength(2)
    expect(result.exercises[0].reference.kind).toBe('first_time')
    expect(result.exercises[1].reference.kind).toBe('last_week')
  })
})

describe('buildAnalysisInput — phase and weight context resolve as of the session date (§5.4)', () => {
  it("resolves phase as of the session's date, not a later phase entry", () => {
    // Session is 2026-08-05, one day into a bulk that started 2026-08-04.
    // A later maintain phase (started 2026-08-15, after the session) must
    // not be what "current" resolves to.
    const args = baseArgs({
      session: { id: 'session-current', date: '2026-08-05', workoutDayName: null },
      phaseEntries: [
        makePhaseEntry({ id: 'cut', phase: 'cut', startDate: '2026-06-23' }),
        makePhaseEntry({ id: 'bulk', phase: 'bulk', startDate: '2026-08-04' }),
        makePhaseEntry({ id: 'maintain', phase: 'maintain', startDate: '2026-08-15' }),
      ],
    })
    const result = buildAnalysisInput(args)
    expect(result.phase.current).toMatchObject({ id: 'bulk', phase: 'bulk', durationDays: 1 })
    expect(result.phase.previous).toMatchObject({ id: 'cut', phase: 'cut', durationDays: 42 })
  })

  it("resolves weight trend as of the session's date, excluding weeks after it", () => {
    const args = baseArgs({
      session: { id: 'session-current', date: '2026-08-05', workoutDayName: null },
      weightEntries: [
        makeWeightEntry({ id: 'w1', entryDate: '2026-08-03', weightKg: 82 }), // week of Aug 3 — before session
        makeWeightEntry({ id: 'w2', entryDate: '2026-08-20', weightKg: 79 }), // week of Aug 17 — after session
      ],
    })
    const result = buildAnalysisInput(args)
    const weeks = result.weightTrend.map((w) => w.weekStart)
    expect(weeks).toContain('2026-08-03')
    expect(weeks).not.toContain('2026-08-17')
  })

  it('weightTrend entries carry source and dailyCount so the model can tell a stated figure from an inferred one', () => {
    const args = baseArgs({
      session: { id: 'session-current', date: '2026-08-18', workoutDayName: null },
      weightEntries: [
        makeWeightEntry({ id: 'w1', entryDate: '2026-08-17', weightKg: 81, kind: 'weekly_average' }),
        makeWeightEntry({ id: 'w2', entryDate: '2026-08-10', weightKg: 80, kind: 'daily' }),
        makeWeightEntry({ id: 'w3', entryDate: '2026-08-12', weightKg: 82, kind: 'daily' }),
      ],
    })
    const result = buildAnalysisInput(args)
    const manualWeek = result.weightTrend.find((w) => w.weekStart === '2026-08-17')
    const dailyWeek = result.weightTrend.find((w) => w.weekStart === '2026-08-10')
    expect(manualWeek).toMatchObject({ source: 'manual', dailyCount: 0, averageKg: 81 })
    expect(dailyWeek).toMatchObject({ source: 'daily', dailyCount: 2, averageKg: 81 })
  })

  it('no phase entries and no weight entries resolve to empty/null, not an error', () => {
    const result = buildAnalysisInput(baseArgs({ phaseEntries: [], weightEntries: [] }))
    expect(result.phase).toEqual({ current: null, previous: null })
    expect(result.weightTrend).toEqual([])
  })
})
