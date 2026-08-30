import { describe, it, expect } from 'vitest'
import {
  buildWeekAnalysisInput,
  type BuildWeekAnalysisInputArgs,
  type WeekAnalysisSessionRoster,
  type WeekAnalysisNote,
} from './weekAnalysisInput'
import type { SessionFacts, AnalysisInputExerciseSource } from './analysisInput'
import type { PhaseEntry, WeightEntry, ExerciseTags, SetLog } from '../../types'
import type { PrimarySlot } from '../gym/referenceLogic'

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
    session: { id: 'session-1', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
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
    energyRating: null,
    pumpRating: null,
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
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
            exercises: [makeExerciseSource({ exerciseId: 'bench' })],
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2', energyRating: null, pumpRating: null },
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
        completedSessionFacts: [makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null } })],
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
          makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null } }),
          makeSessionFacts({ session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 1', energyRating: null, pumpRating: null } }),
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
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
            isDeloadCurrent: true,
            exercises: [makeExerciseSource({ exerciseId: 'ex-a' })],
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2', energyRating: null, pumpRating: null },
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
        completedSessionFacts: [makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null } })],
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

// ─── Coach Personalization wiring into Weekly Analysis ─────────────────────
// Superseding suite: this used to confirm energyRating/pumpRating were
// ABSENT from the weekly payload (§7.10's deliberate scope cut, TASKS.md).
// That is no longer true by design — the sessions roster now carries real
// per-session energy/pump ratings, memory/notes reach the payload, and
// weekly averages are computed. formRating's own "reaches match by
// construction" behaviour is unchanged from before and re-confirmed below.
function makeSetLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'log-1',
    userId: 'u1',
    sessionId: 's-a',
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
    loggedAt: '2026-08-17T10:00:00Z',
    restSeconds: null,
    formRating: null,
    ...overrides,
  }
}

describe('buildWeekAnalysisInput — Coach Personalization: formRating reaches match by construction', () => {
  it('formRating reaches the weekly match via the same buildExercise the daily path uses', () => {
    const reference: PrimarySlot = {
      type: 'last_week',
      session: { sessionId: 'session-ref', date: '2026-08-10', completedAt: null, mesocycleId: 'meso-1', logs: [] },
    }
    const result = buildWeekAnalysisInput(
      baseArgs({
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
            exercises: [
              makeExerciseSource({
                reference,
                referenceLogs: [makeSetLog({ id: 'r1', sessionId: 'session-ref', formRating: 'rushed' })],
                currentLogs: [makeSetLog({ id: 'c1', sessionId: 's-a', formRating: 'extra_controlled' })],
              }),
            ],
          }),
        ],
      }),
    )

    const occ = result.occurrences[0]
    expect(occ.match).not.toBeNull()
    expect(occ.match!.plain.slots[0].head.a.formRating).toBe('rushed')
    expect(occ.match!.plain.slots[0].head.b.formRating).toBe('extra_controlled')
  })
})

describe('buildWeekAnalysisInput — Coach Personalization: per-session energy/pump ratings', () => {
  it('sessions[].energyRating/pumpRating come from the session roster the fetch layer resolves, not from SessionFacts.session', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [makeRosterEntry({ id: 's-a', date: '2026-08-17', energyRating: 'high', pumpRating: 'good' })],
        // SessionFacts.session carries its OWN energyRating/pumpRating (read
        // by assembleSessionFacts for the daily path's own purposes) — left
        // null here on purpose, to prove the roster is what actually reaches
        // the output, not a spread of this object.
        completedSessionFacts: [
          makeSessionFacts({ session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null } }),
        ],
      }),
    )
    expect(result.sessions[0]).toMatchObject({ energyRating: 'high', pumpRating: 'good' })
  })

  // No separate "a skipped session is never rated" test here: `sessions` is
  // a literal, untransformed passthrough of `args.sessions` (`sessions:
  // args.sessions` in buildWeekAnalysisInput's return statement) — the
  // pure builder has no logic that could enforce or violate that invariant,
  // so a test supplying a skipped roster entry with energyRating/pumpRating
  // already null would only be echoing its own fixture back. The real
  // invariant (a skipped session's v2_sessions row has both columns NULL,
  // since it never reached the completion screen) is a fact about the data,
  // enforced by assembleWeekAnalysisInput's fetch layer reading real DB
  // rows, not by anything testable here with constructed fixtures.
})

describe('buildWeekAnalysisInput — weekly averages', () => {
  it('avgFormRating averages only head, non-skipped, real-weight/reps sets — drop stages and skipped sets excluded (mirrors progressService.ts\'s fetchMesoWeeklyProgress)', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
            exercises: [
              makeExerciseSource({
                exerciseId: 'ex1',
                currentLogs: [
                  makeSetLog({ id: 'c1', formRating: 'controlled' }), // head, valid -> counts (3)
                  makeSetLog({ id: 'c2', formRating: 'extra_controlled' }), // head, valid -> counts (4)
                  makeSetLog({ id: 'c3', formRating: 'rushed', parentSetId: 'c1', stageIndex: 1 }), // dropset stage -> excluded
                  makeSetLog({ id: 'c4', formRating: 'rushed', isSkipped: true, weight: null, reps: null }), // skipped -> excluded
                ],
              }),
            ],
          }),
        ],
      }),
    )
    // (3 + 4) / 2 = 3.5
    expect(result.avgFormRating).toEqual({ mean: 3.5, scaleMax: 4, count: 2 })
  })

  it('avgFormRating combines sets from every session and every exercise in the week, not just the first of each', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
            exercises: [
              makeExerciseSource({ exerciseId: 'ex1', currentLogs: [makeSetLog({ id: 'c1', formRating: 'rushed' })] }), // 1
              makeExerciseSource({ exerciseId: 'ex2', currentLogs: [makeSetLog({ id: 'c2', formRating: 'normal' })] }), // 2
            ],
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2', energyRating: null, pumpRating: null },
            exercises: [makeExerciseSource({ exerciseId: 'ex1', currentLogs: [makeSetLog({ id: 'c3', formRating: 'extra_controlled' })] })], // 4
          }),
        ],
        tagsByExerciseId: new Map([
          ['ex1', makeTags({ exerciseId: 'ex1' })],
          ['ex2', makeTags({ exerciseId: 'ex2' })],
        ]),
      }),
    )
    // (1 + 2 + 4) / 3 = 2.333... — a regression that only flattened the
    // first session's exercises, or the first exercise per session, would
    // instead land on 1, 1.5, or 2.5 here.
    expect(result.avgFormRating).toEqual({ mean: (1 + 2 + 4) / 3, scaleMax: 4, count: 3 })
  })

  it('avgEnergyRating/avgPumpRating average one rating per completed session', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', energyRating: 'high', pumpRating: 'good' }), // 4, 3
          makeRosterEntry({ id: 's-b', date: '2026-08-20', energyRating: 'low', pumpRating: 'none' }), // 2, 1
        ],
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2', energyRating: null, pumpRating: null },
            exercises: [],
          }),
        ],
      }),
    )
    // energy: (4+2)/2 = 3; pump: (3+1)/2 = 2
    expect(result.avgEnergyRating).toEqual({ mean: 3, scaleMax: 5, count: 2 })
    expect(result.avgPumpRating).toEqual({ mean: 2, scaleMax: 4, count: 2 })
  })

  it('a skipped session is excluded by its own status, not merely by averageRating\'s null-filter — a rated-but-skipped fixture proves the status filter itself', () => {
    // Real v2_sessions rows never carry a rating on a skipped session (it
    // never reached the completion screen), so averageRating's own
    // null-filter alone would happen to produce the right answer against
    // any real row. Constructing a skipped session that DOES carry a
    // rating (impossible in production, but type-valid — WeekAnalysisSessionRoster
    // doesn't forbid it) is the only way to prove buildWeekAnalysisInput's
    // own `completedSessions = args.sessions.filter(s => s.status ===
    // 'completed')` line (not just averageRating's incidental null-filter)
    // is what does the excluding — removing that filter and relying on
    // averageRating alone would silently pass every other test in this
    // block.
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', status: 'completed', energyRating: 'high', pumpRating: 'good' }), // 4, 3
          makeRosterEntry({ id: 's-b', date: '2026-08-20', status: 'skipped', energyRating: 'high', pumpRating: 'good' }), // would also be 4, 3 if wrongly included
        ],
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
          }),
        ],
      }),
    )
    expect(result.avgEnergyRating).toEqual({ mean: 4, scaleMax: 5, count: 1 })
    expect(result.avgPumpRating).toEqual({ mean: 3, scaleMax: 4, count: 1 })
  })

  it('a rated "none" counts toward the average; an unrated null does not (TASKS §7.3)', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        sessions: [
          makeRosterEntry({ id: 's-a', date: '2026-08-17', energyRating: 'none', pumpRating: 'none' }),
          makeRosterEntry({ id: 's-b', date: '2026-08-20', energyRating: null, pumpRating: null }),
        ],
        completedSessionFacts: [
          makeSessionFacts({
            session: { id: 's-a', date: '2026-08-17', workoutDayName: 'Push 1', energyRating: null, pumpRating: null },
          }),
          makeSessionFacts({
            session: { id: 's-b', date: '2026-08-20', workoutDayName: 'Push 2', energyRating: null, pumpRating: null },
            exercises: [],
          }),
        ],
      }),
    )
    expect(result.avgEnergyRating).toEqual({ mean: 1, scaleMax: 5, count: 1 })
    expect(result.avgPumpRating).toEqual({ mean: 1, scaleMax: 4, count: 1 })
  })

  it('nothing rated this week — all three averages are null, not zero', () => {
    const result = buildWeekAnalysisInput(baseArgs())
    expect(result.avgFormRating).toBeNull()
    expect(result.avgEnergyRating).toBeNull()
    expect(result.avgPumpRating).toBeNull()
  })

  it('real sets logged but none form-rated — avgFormRating is still null, not zero', () => {
    const result = buildWeekAnalysisInput(
      baseArgs({
        completedSessionFacts: [
          makeSessionFacts({
            exercises: [makeExerciseSource({ currentLogs: [makeSetLog({ id: 'c1', formRating: null })] })],
          }),
        ],
      }),
    )
    expect(result.avgFormRating).toBeNull()
  })
})

describe('buildWeekAnalysisInput — memory', () => {
  it('memory passes through unchanged, oldest to newest', () => {
    const result = buildWeekAnalysisInput(baseArgs({ memory: ['old standing caution', 'newer standing caution'] }))
    expect(result.memory).toEqual(['old standing caution', 'newer standing caution'])
  })

  it('memory defaults to [], not undefined, when the fetch layer sent none', () => {
    const result = buildWeekAnalysisInput(baseArgs())
    expect(result.memory).toEqual([])
  })
})

describe('buildWeekAnalysisInput — week-spanning notes', () => {
  it('each note carries its own sessionDate/workoutDayName so a note from any day in the week is correctly dated, not generic', () => {
    const notes: WeekAnalysisNote[] = [
      { body: 'chest press machine broken, switched to low incline smith', sessionDate: '2026-08-20', workoutDayName: 'Push 2' },
      { body: 'felt strong today', sessionDate: '2026-08-17', workoutDayName: 'Push 1' },
    ]
    const result = buildWeekAnalysisInput(baseArgs({ notes }))
    expect(result.notes).toEqual(notes)
    // The real-world case this exists for: two notes from different days in
    // the same week stay distinguishable by date, so a note like the real
    // Aug 27 chest-press substitution ties to its own day's occurrences
    // rather than reading as undated context for the whole week.
    expect(result.notes![0].sessionDate).not.toBe(result.notes![1].sessionDate)
  })

  it('notes defaults to [], not undefined, when the fetch layer sent none', () => {
    const result = buildWeekAnalysisInput(baseArgs())
    expect(result.notes).toEqual([])
  })
})
