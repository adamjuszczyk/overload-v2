// Chunk 77 — the world the PREVIEW SESSION tests draw: board W1's data as `GymSession.boards.test.tsx` builds it (Pull 1, week 2: Lat Pulldown with a
// dropset, a Seated Cable Row + Face Pull superset with a 1:30 round rest, EZ Bar Curl with a warmup, cues on three sets), and last week's Tuesday
// for each exercise, the way the batched reference read hands it. The plan and the reference are pure data: no mock, no hook.
import type { Exercise, ProgramExercise, ProgramSupersetBlock, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import type { ReferenceSession } from './sessionService'
import { groupSetLogs } from './setGroupLogic'

const exercise = (id: string, name: string, muscleGroup: string): Exercise => ({
  id, userId: 'u1', name, muscleGroup: muscleGroup as Exercise['muscleGroup'], isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})

export const programExercise = (id: string, exerciseId: string, name: string, muscleGroup: string, position: number, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: exercise(exerciseId, name, muscleGroup), ...extra,
})

export const plannedSet = (id: string, programExerciseId: string, setNumber: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})

export const peLat = programExercise('xe-lat', 'ex-lat', 'Lat Pulldown', 'back', 0)
export const peRow = programExercise('xe-row', 'ex-row', 'Seated Cable Row', 'back', 1, { supersetBlockId: 'block-a' })
export const peFace = programExercise('xe-face', 'ex-face', 'Face Pull', 'rear_delts', 2, { supersetBlockId: 'block-a' })
export const peEz = programExercise('xe-ez', 'ex-ez', 'EZ Bar Curl', 'biceps', 3, { tempo: '3-0-1-0' })

export const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [peLat, peRow, peFace, peEz] }
export const blocks: ProgramSupersetBlock[] = [{ id: 'block-a', restAfterRoundSeconds: 90, restWithinRoundSeconds: null }]

export const w1Plan: WeekPlan = {
  id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z',
  exercises: [peLat, peRow, peFace, peEz],
  sets: [
    plannedSet('lat-1', 'xe-lat', 1, { targetWeight: 55, repMin: 9, repMax: 9, targetRir: 2 }),
    plannedSet('lat-2', 'xe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 8, targetRir: 1 }),
    plannedSet('lat-3', 'xe-lat', 3, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1, stageKind: 'dropset', tags: ['push here'] }),
    plannedSet('lat-3-d1', 'xe-lat', 3, { isDropset: true, parentWeekPlanSetId: 'lat-3', stageIndex: 1, targetWeight: 40, isAmrap: true, targetRir: 0 }),
    plannedSet('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12, targetRir: 2 }),
    plannedSet('cab-2', 'xe-row', 2, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    plannedSet('cab-3', 'xe-row', 3, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    plannedSet('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18, targetRir: 1 }),
    plannedSet('face-2', 'xe-face', 2, { targetWeight: 17.5, repMin: 15, repMax: 20, targetRir: 1, tags: ['squeeze'] }),
    plannedSet('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    plannedSet('ez-1', 'xe-ez', 1, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
    plannedSet('ez-2', 'xe-ez', 2, { targetWeight: 30, isAmrap: true, targetRir: 0, tags: ['cue'] }),
  ],
}

/** The same exercises with no planned set at all (the week is planned but holds no sets for them). */
export const noSetsPlan: WeekPlan = { ...w1Plan, id: 'wp-empty', sets: [] }

const lastLog = (exerciseId: string, n: number, weight: number, reps: number, rir: number): SetLog => ({
  id: `last-${exerciseId}-${n}`, userId: 'u1', sessionId: 'prev', exerciseId, weekPlanSetId: null, setNumber: n, weight, reps, rir, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2025-12-30T10:00:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null,
})
const lastWeek = (exerciseId: string, rows: Array<[number, number, number, number]>): ReferenceSession => ({
  sessionId: 'prev', date: '2025-12-30', completedAt: '2025-12-30T11:00:00Z', mesocycleId: 'm1',
  logs: groupSetLogs(rows.map(([n, weight, reps, rir]) => lastLog(exerciseId, n, weight, reps, rir))),
})

/** Last week's Tuesday (2025-12-30) for each exercise, as the batched read hands it: today is Tuesday 2026-01-06, so each line reads "LAST = LAST WEEK, TUE". */
export const lastByExercise = new Map<string, ReferenceSession[]>([
  ['ex-lat', [lastWeek('ex-lat', [[1, 55, 8, 2], [2, 55, 8, 1], [3, 52.5, 10, 1]])]],
  ['ex-row', [lastWeek('ex-row', [[1, 60, 11, 2], [2, 60, 11, 2], [3, 60, 10, 2]])]],
  ['ex-face', [lastWeek('ex-face', [[1, 15, 17, 1], [2, 15, 17, 1]])]],
  ['ex-ez', [lastWeek('ex-ez', [[1, 30, 8, 1], [2, 30, 9, 0]])]],
])
