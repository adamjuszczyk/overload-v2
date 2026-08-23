import { describe, it, expect } from 'vitest'
import {
  buildWeekAnalysisInput,
  type BuildWeekAnalysisInputArgs,
  type WeekAnalysisSessionRoster,
} from './weekAnalysisInput'
import type { SessionFacts, AnalysisInputExerciseSource } from './analysisInput'
import type { PhaseEntry, WeightEntry, ExerciseTags } from '../../types'

function makeExerciseSource(overrides: Partial<AnalysisInputExerciseSource> = {}): AnalysisInputExerciseSource {
  return {
    exerciseId: 'ex1',
    exerciseName: 'Bench Press',
    currentLogs: [],
    reference: { type: 'first_time' },
    referenceLogs: null,
    isDeloadReference: null,
    secondaryCandidates: [],
    ...overrides,
  }
}

function makeSessionFacts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    session: { id: 'session-1', date: '2026-08-17', workoutDayName: 'Push 1' },
    isDeloadCurrent: false,
    exercises: [makeExerciseSource()],
    currentMesocycleId: 'meso-1',
    ...overrides,
  }
}

function makeRosterEntry(overrides: Partial<WeekAnalysisSessionRoster> = {}): WeekAnalysisSessionRoster {
  return {
    id: 'session-1',
    date: '2026-08-17',
    workoutDayName: 'Push 1',
    status: 'completed',
    isDeload: false,
    mesocycleName: 'MESO 1.0',
    weekNumber: 1,
    ...overrides,
  }
}

function makeTags(overrides: Partial<ExerciseTags> = {}): ExerciseTags {
  return {
    exerciseId: 'ex1',
    exerciseName: 'Bench Press',
    muscleGroup: 'chest',
    muscleSubgroups: ['mid_chest'],
    movementPattern: 'horizontal_push',
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

function baseArgs(overrides: Partial<BuildWeekAnalysisInputArgs> = {}): BuildWeekAnalysisInputArgs {
  return {
    week: { weekStart: '2026-08-17', weekEnd: '2026-08-23' },
    sessions: [makeRosterEntry()],
    completedSessionFacts: [makeSessionFacts()],
    tagsByExerciseId: new Map([['ex1', makeTags()]]),
    phaseEntries: [],
    weightEntries: [],
    ...overrides,
  }
}

describe('buildWeekAnalysisInput — tag bucketing wired end-to-end', () => {
  it('a multi-tagged exercise lands in every named subgroup bucket, unmodified (SPEC §4/§5)', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({ tagsByExerciseId: new Map([['ex1', makeTags({ muscleSubgroups: ['upper_chest', 'front_delt'] })]]) }),
    )
    expect(result.bySubgroup).toHaveLength(2)
    expect(result.bySubgroup.map((b) => b.key).sort()).toEqual(['subgroup:front_delt', 'subgroup:upper_chest'])
    expect(result.occurrences[0].bucketKeys).toEqual(
      expect.arrayContaining(['subgroup:upper_chest', 'subgroup:front_delt']),
    )
    expect(result.occurrences[0].muscleSubgroups).toEqual(['upper_chest', 'front_delt'])
  })

  it('a tags row with no muscle_subgroup falls back to muscleGroup, isFallback true', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({ tagsByExerciseId: new Map([['ex1', makeTags({ muscleSubgroups: null, muscleGroup: 'shoulders' })]]) }),
    )
    expect(result.bySubgroup).toEqual([
      expect.objectContaining({ key: 'subgroup:shoulders', kind: 'muscle_subgroup', isFallback: true }),
    ])
    expect(result.occurrences[0].muscleGroup).toBe('shoulders')
    expect(result.occurrences[0].muscleSubgroups).toBeNull()
  })

  it('an occurrence with no tags row at all still lands in the untagged bucket, never dropped (§7.12)', () => {
    const result = buildWeekAnalysisInput(baseArgs({ tagsByExerciseId: new Map() }))
    expect(result.occurrences).toHaveLength(1)
    expect(result.bySubgroup).toEqual([expect.objectContaining({ key: 'subgroup:untagged', isFallback: true })])
    expect(result.occurrences[0].muscleGroup).toBeNull()
    expect(result.occurrences[0].muscleSubgroups).toBeNull()
    expect(result.occurrences[0].movementPattern).toBeNull()
  })

  it('a null movement_pattern means the occurrence is absent from the pattern axis entirely (§7.9)', () => {
    const result = buildWeekAnalysisInput(baseArgs({ tagsByExerciseId: new Map([['ex1', makeTags({ movementPattern: null })]]) }))
    expect(result.byPattern).toHaveLength(0)
    expect(result.occurrences[0].bucketKeys.some((k) => k.startsWith('pattern:'))).toBe(false)
  })

  it('the same exercise trained twice this week produces two independent occurrences in the same bucket', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [makeRosterEntry({ id: 's-a', date: '2026-08-17' }), makeRosterEntry({ id: 's-b', date: '2026-08-20' })],
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1' },
            exercises: [makeExerciseSource({ exerciseId: 'bench' })],
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2' },
            exercises: [makeExerciseSource({ exerciseId: 'bench' })],
          }),
        ],
        tagsByExerciseId: new Map([['bench', makeTags({ exerciseId: 'bench' })]]),
      }),
    )
    expect(result.occurrences).toHaveLength(2)
    expect(result.occurrences.map((o) => o.occurrenceId).sort()).toEqual(['s-a:bench', 's-b:bench'])
    expect(result.bySubgroup.find((b) => b.key === 'subgroup:mid_chest')?.occurrenceIds).toEqual(['s-a:bench', 's-b:bench'])
  })

  it('occurrenceId is exactly `${sessionId}:${exerciseId}`', () => {
    const result = buildWeekAnalysisInput(baseArgs())
    expect(result.occurrences[0].occurrenceId).toBe('session-1:ex1')
  })
})

describe('buildWeekAnalysisInput — session roster (§7.8)', () => {
  it('a skipped session appears in the roster but contributes zero occurrences', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', status: 'completed' }),
          makeRosterEntry({ id: 's-b', date: '2026-08-18', status: 'skipped' }),
        ],
        completedSessionFacts: [makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1' } })],
      }),
    )
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions.find((s) => s.id === 's-b')?.status).toBe('skipped')
    expect(result.occurrences.every((o) => o.sessionId === 's-a')).toBe(true)
  })

  it('a week spanning a meso boundary preserves each session\'s own mesocycle/week-number distinctly', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', mesocycleName: 'MESO 1.0', weekNumber: 8 }),
          makeRosterEntry({ id: 's-b', date: '2026-08-20', mesocycleName: 'MESO 2.0', weekNumber: 1 }),
        ],
        completedSessionFacts: [
          makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1' } }),
          makeSessionFacts({ session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 1' } }),
        ],
      }),
    )
    expect(result.sessions).toEqual([
      expect.objectContaining({ id: 's-a', mesocycleName: 'MESO 1.0', weekNumber: 8 }),
      expect.objectContaining({ id: 's-b', mesocycleName: 'MESO 2.0', weekNumber: 1 }),
    ])
  })

  it('isDeloadCurrent is carried from each occurrence\'s own session, never mixed across sessions', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', isDeload: true }),
          makeRosterEntry({ id: 's-b', date: '2026-08-20', isDeload: false }),
        ],
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1' },
            isDeloadCurrent: true,
            exercises: [makeExerciseSource({ exerciseId: 'ex-a' })],
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2' },
            isDeloadCurrent: false,
            exercises: [makeExerciseSource({ exerciseId: 'ex-b' })],
          }),
        ],
        tagsByExerciseId: new Map([
          ['ex-a', makeTags({ exerciseId: 'ex-a' })],
          ['ex-b', makeTags({ exerciseId: 'ex-b' })],
        ]),
      }),
    )
    expect(result.occurrences.find((o) => o.sessionId === 's-a')?.isDeloadCurrent).toBe(true)
    expect(result.occurrences.find((o) => o.sessionId === 's-b')?.isDeloadCurrent).toBe(false)
  })
})

describe('buildWeekAnalysisInput — phase/weight resolved once for the week (§3.2)', () => {
  it("resolves as of the week's LAST session date, not today and not the first session's date", () => {
    // A phase starting 2026-08-21 is after the first (and only completed)
    // session (2026-08-17) but on-or-before the week's actual last session
    // (2026-08-22, skipped). If this resolved against the first session's
    // date, or against "today", p-late would not yet be in effect.
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', status: 'completed' }),
          makeRosterEntry({ id: 's-b', date: '2026-08-22', status: 'skipped' }),
        ],
        completedSessionFacts: [makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1' } })],
        phaseEntries: [
          makePhaseEntry({ id: 'p-early', phase: 'cut', startDate: '2026-01-01' }),
          makePhaseEntry({ id: 'p-late', phase: 'bulk', startDate: '2026-08-21' }),
        ],
        weightEntries: [
          makeWeightEntry({ id: 'w-early', entryDate: '2026-08-10', weightKg: 80 }),
          makeWeightEntry({ id: 'w-late', entryDate: '2026-08-22', weightKg: 82 }),
        ],
      }),
    )
    expect(result.phase.current).toMatchObject({ id: 'p-late', phase: 'bulk' })
    // recentWeightTrend's window ends at-or-before asOf's own week — asOf
    // 2026-08-22 falls in the week starting 2026-08-17, so w-late (same
    // week) is included; confirms the trend wasn't cut off at the first
    // session's earlier date either.
    expect(result.weightTrend.some((w) => w.averageKg === 82)).toBe(true)
  })

  it('an empty session roster falls back to weekEnd for the as-of date (defensive — resolveWeek never calls a week with none of these complete)', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({ sessions: [], completedSessionFacts: [], phaseEntries: [makePhaseEntry({ id: 'p1', startDate: '2026-08-01' })] }),
    )
    expect(result.occurrences).toHaveLength(0)
    expect(result.phase.current).toMatchObject({ id: 'p1' })
  })
})
