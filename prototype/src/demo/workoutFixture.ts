// Board W1's world, as the repo's own GymSession.boards.test.tsx builds it: Pull 1, week 2, Lat Pulldown with a
// dropset, a Seated Cable Row + Face Pull superset, EZ Bar Curl with a warmup. Last week's numbers per exercise,
// and Monday's earlier-this-week session for item 21.
import { create } from 'zustand'
import type { ProgramExercise, ProgramSupersetBlock, Session, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '@app/types'
import { logOf, referenceSessionOf } from '@app/features/gym/cardHarness.testutil'

const ex = (id: string, name: string, muscleGroup: string) => ({
  id, userId: 'u1', name, muscleGroup, isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
  status: 'active' as const, sourceLibraryId: null, lostAt: null,
}) as any
const pe = (id: string, exerciseId: string, name: string, muscleGroup: string, position: number, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: ex(exerciseId, name, muscleGroup), ...extra,
})
const set = (id: string, programExerciseId: string, setNumber: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})

const peLat = pe('xe-lat', 'ex-lat', 'Lat Pulldown', 'back', 0)
const peRow = pe('xe-row', 'ex-row', 'Seated Cable Row', 'back', 1, { supersetBlockId: 'block-a' })
const peFace = pe('xe-face', 'ex-face', 'Face Pull', 'rear_delts', 2, { supersetBlockId: 'block-a' })
const peEz = pe('xe-ez', 'ex-ez', 'EZ Bar Curl', 'biceps', 3, { tempo: '3-0-1-0' } as Partial<ProgramExercise>)

export const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'rc-ul', userId: 'u1', name: 'PULL 1', position: 0, exercises: [peLat, peRow, peFace, peEz] }
export const blocks: ProgramSupersetBlock[] = [{ id: 'block-a', restAfterRoundSeconds: 90, restWithinRoundSeconds: null } as unknown as ProgramSupersetBlock]

export const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'u1', mesocycleId: 'm-active', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z',
  exercises: [peLat, peRow, peFace, peEz],
  sets: [
    set('lat-1', 'xe-lat', 1, { targetWeight: 55, repMin: 9, repMax: 9, targetRir: 2 }),
    set('lat-2', 'xe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 8, targetRir: 1 }),
    set('lat-3', 'xe-lat', 3, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1, stageKind: 'dropset', tags: ['push here'] }),
    set('lat-3-d1', 'xe-lat', 3, { isDropset: true, parentWeekPlanSetId: 'lat-3', stageIndex: 1, targetWeight: 40, isAmrap: true, targetRir: 0 }),
    set('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12, targetRir: 2 }),
    set('cab-2', 'xe-row', 2, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    set('cab-3', 'xe-row', 3, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    set('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18, targetRir: 1 }),
    set('face-2', 'xe-face', 2, { targetWeight: 17.5, repMin: 15, repMax: 20, targetRir: 1, tags: ['squeeze'] }),
    set('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    set('ez-1', 'xe-ez', 1, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
    set('ez-2', 'xe-ez', 2, { targetWeight: 30, isAmrap: true, targetRir: 0, tags: ['cue'] }),
  ] as WeekPlanSet[],
}

const W1_LOGS: SetLog[] = [
  logOf({ id: 'l-lat-1', exerciseId: 'ex-lat', weekPlanSetId: 'lat-1', setNumber: 1, weight: 55, reps: 9, rir: 2 }),
  logOf({ id: 'l-lat-2', exerciseId: 'ex-lat', weekPlanSetId: 'lat-2', setNumber: 2, weight: 55, reps: 8, rir: 1 }),
  logOf({ id: 'l-cab-1', exerciseId: 'ex-row', weekPlanSetId: 'cab-1', setNumber: 1, weight: 60, reps: 12, rir: 2 }),
  logOf({ id: 'l-face-1', exerciseId: 'ex-face', weekPlanSetId: 'face-1', setNumber: 1, weight: 15, reps: 18, rir: 1 }),
]

// Every planned set logged as planned, except the curl's AMRAP set, skipped: the workout complete (item 6).
const ALL_DONE: SetLog[] = weekPlan.sets.map((s, i) =>
  logOf({
    id: `done-${s.id}`, exerciseId: weekPlan.exercises.find((e) => e.id === s.programExerciseId)!.exerciseId, weekPlanSetId: s.id, setNumber: s.setNumber,
    weight: (s as any).targetWeight ?? null, reps: (s as any).repMax ?? 10, rir: s.targetRir, isWarmup: s.isWarmup, isDropset: s.isDropset,
    parentSetId: s.parentWeekPlanSetId ? `done-${s.parentWeekPlanSetId}` : null, stageIndex: s.stageIndex, isSkipped: s.id === 'ez-2',
    loggedAt: new Date(Date.UTC(2026, 0, 6, 9, 15 + i)).toISOString(),
  }),
)

// An open warmup first: EZ Bar Curl's card with its warmup unlogged (items 12, 13).
const WARMUP_OPEN: SetLog[] = W1_LOGS.concat([
  logOf({ id: 'l-lat-3', exerciseId: 'ex-lat', weekPlanSetId: 'lat-3', setNumber: 3, weight: 52.5, reps: 9, rir: 1, stageKind: 'dropset' as any }),
  logOf({ id: 'l-lat-3d', exerciseId: 'ex-lat', weekPlanSetId: 'lat-3-d1', setNumber: 3, weight: 40, reps: 12, rir: 0, isDropset: true, parentSetId: 'l-lat-3', stageIndex: 1 }),
  logOf({ id: 'l-cab-2', exerciseId: 'ex-row', weekPlanSetId: 'cab-2', setNumber: 2, weight: 60, reps: 11, rir: 1 }),
  logOf({ id: 'l-face-2', exerciseId: 'ex-face', weekPlanSetId: 'face-2', setNumber: 2, weight: 17.5, reps: 16, rir: 1 }),
  logOf({ id: 'l-cab-3', exerciseId: 'ex-row', weekPlanSetId: 'cab-3', setNumber: 3, weight: 60, reps: 10, rir: 1 }),
])

export const WORKOUT_STATES = { fresh: [] as SetLog[], w1: W1_LOGS, warmupOpen: WARMUP_OPEN, allDone: ALL_DONE } as const
export type WorkoutState = keyof typeof WORKOUT_STATES

const baseSession = (logs: SetLog[]): Session => ({
  id: 'session-1', userId: 'u1', mesocycleId: 'm-active', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
  date: '2026-01-06', status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z',
  setLogs: logs, energyRating: null, pumpRating: null,
} as Session)

// The session the fake hooks read and write: LOG, UNLOG and DELETE change it, so the prototype can be played through.
export const useWorkoutSession = create<{ session: Session; reset: (state: WorkoutState) => void }>((set) => ({
  session: baseSession(W1_LOGS),
  reset: (state) => set({ session: baseSession(WORKOUT_STATES[state].map((l) => ({ ...l }))) }),
}))

const last = (exerciseId: string, rows: Array<[number, number, number, number]>): SetLog[] =>
  rows.map(([n, weight, reps, rir]) => logOf({ id: `last-${exerciseId}-${n}`, sessionId: 'prev', exerciseId, setNumber: n, weight, reps, rir }))
const lastByExercise: Record<string, SetLog[]> = {
  'ex-lat': last('ex-lat', [[1, 55, 8, 2], [2, 55, 8, 1], [3, 52.5, 10, 1]]),
  'ex-row': last('ex-row', [[1, 60, 11, 2], [2, 60, 11, 2], [3, 60, 10, 2]]),
  'ex-face': last('ex-face', [[1, 15, 17, 1], [2, 15, 17, 1]]),
  'ex-ez': last('ex-ez', [[1, 30, 8, 1], [2, 30, 9, 0]]),
}
// Monday's session this week (item 21): the curl was done then too.
const mondayCurl = [logOf({ id: 'mon-ez-1', sessionId: 'mon', exerciseId: 'ex-ez', setNumber: 1, weight: 32.5, reps: 8, rir: 1 }), logOf({ id: 'mon-ez-2', sessionId: 'mon', exerciseId: 'ex-ez', setNumber: 2, weight: 32.5, reps: 7, rir: 0 })]

export const referenceSessions = new Map(
  Object.entries(lastByExercise).map(([exerciseId, logs]) => [
    exerciseId,
    exerciseId === 'ex-ez'
      ? [referenceSessionOf('mon', '2026-01-05', mondayCurl, { mesocycleId: 'm-active' }), referenceSessionOf('prev', '2025-12-30', logs, { mesocycleId: 'm-active' })]
      : [referenceSessionOf('prev', '2025-12-30', logs, { mesocycleId: 'm-active' })],
  ]),
)

export const weekPlanNoSets: WeekPlan = { ...weekPlan, id: 'wp-empty', sets: [] }
