// Chunk 64 — the session the finish tests run over (`GymSession.finish.test.tsx`, `GymSession.autoFinishMoved.test.tsx`): Pull 1 on Tuesday of week 2, EZ Bar Curl (a warmup, then 01
// and 02) and Lat Pulldown (01 to 04), and the swap row that moves Lat Pulldown's open sets to Machine Pulldown (board W5).
import type { Exercise, ProgramExercise, SessionSetChangeRecord, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import type { ExerciseSwap } from './sessionService'

// ─── The session ───────────────────────────────────────────────────────────────────────────────────
// Pull 1 on Tuesday of week 2: EZ Bar Curl (a warmup, then 01 and 02) and Lat Pulldown (01 to 04).
export const exercise = (id: string, name: string): Exercise => ({
  id, userId: 'u1', name, muscleGroup: 'back', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
export const programExercise = (id: string, exerciseId: string, name: string, position: number): ProgramExercise => ({ id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: exercise(exerciseId, name) })
export const PE_EZ = programExercise('xe-ez', 'ex-ez', 'EZ Bar Curl', 0)
export const PE_LAT = programExercise('xe-lat', 'ex-lat', 'Lat Pulldown', 1)
export const planned = (id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, targetWeight: 55, repMin: 8, repMax: 8, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...over,
})
export const SETS = [
  planned('ez-w1', 'xe-ez', 1, { isWarmup: true }), planned('ez-1', 'xe-ez', 2), planned('ez-2', 'xe-ez', 3),
  planned('lat-1', 'xe-lat', 1), planned('lat-2', 'xe-lat', 2), planned('lat-3', 'xe-lat', 3), planned('lat-4', 'xe-lat', 4),
]
export const weekPlan = (over: Partial<WeekPlan> = {}): WeekPlan => ({
  id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises: [PE_EZ, PE_LAT], sets: SETS, ...over,
})
export const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'Pull 1', position: 0, exercises: [] }
export const log = (id: string, weekPlanSetId: string | null, setNumber: number, exerciseId: string, over: Partial<SetLog> = {}): SetLog => ({
  id, userId: 'u1', sessionId: 'session-1', exerciseId, weekPlanSetId, setNumber, weight: 55, reps: 8, rir: 1, note: null, isDropset: false, parentSetId: null, stageIndex: 0,
  isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false, loggedAt: '2026-01-06T09:30:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})
export const skipped = (l: SetLog): SetLog => ({ ...l, isSkipped: true, weight: null, reps: null })
export const EZ_DONE = [log('l-ezw', 'ez-w1', 1, 'ex-ez', { isWarmup: true }), log('l-ez1', 'ez-1', 1, 'ex-ez'), log('l-ez2', 'ez-2', 2, 'ex-ez')]
export const LAT_1_2 = [log('l-lat1', 'lat-1', 1, 'ex-lat'), log('l-lat2', 'lat-2', 2, 'ex-lat')]
export const LAT_ALL = [...LAT_1_2, log('l-lat3', 'lat-3', 3, 'ex-lat'), log('l-lat4', 'lat-4', 4, 'ex-lat')]
export const deletedChange = (weekPlanSetId: string): SessionSetChangeRecord => ({
  id: 'chg-1', userId: 'u1', sessionId: 'session-1', createdAt: '2026-01-06T09:00:00Z', updatedAt: '2026-01-06T09:00:00Z', kind: 'deleted', weekPlanSetId,
})
export const NORMAL = { kind: 'normal' } as const

/** The swap row a swap for today saves (migration 047): Lat Pulldown's card to Machine Pulldown, with the record of which sets moved. */
export const swapRow = (moved: ExerciseSwap['movedSets']): ExerciseSwap => ({
  id: 'swap-1', sessionId: 'session-1', programExerciseId: 'xe-lat', originalExerciseId: 'ex-lat', originalExerciseName: 'Lat Pulldown', replacementExerciseId: 'ex-machine',
  replacementExerciseName: 'Machine Pulldown', createdAt: '2026-01-06T09:40:00Z', movedSets: moved,
})
