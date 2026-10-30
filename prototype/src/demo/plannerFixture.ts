// The planner's step 2 for a saved program, "Push Pull Legs": Pull 1 holds a three-member superset
// (Seated Cable Row + Face Pull + Rear Delt Fly) between Lat Pulldown and EZ Bar Curl, for item 2.
import { queryClient } from '@app/lib/queryClient'
import type { Program, ProgramExercise, WeeklySchedule } from '@app/types'

const U = 'proto-user'
const ex = (id: string, name: string, muscleGroup: string) => ({ id, userId: U, name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null }) as any
const pe = (day: string, id: string, name: string, group: string, position: number, extra: Partial<ProgramExercise> = {}): ProgramExercise =>
  ({ id, workoutDayId: day, userId: U, exerciseId: `ex-${id}`, position, weightUnit: null, supersetBlockId: null, exercise: ex(`ex-${id}`, name, group), ...extra }) as ProgramExercise

const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
export const plannerProgram = {
  id: 'pp-1', userId: U, name: 'Push Pull Legs', schedule: { ...NONE, monday: 'pd-push', tuesday: 'pd-pull', thursday: 'pd-legs' },
  workoutDays: [], createdAt: '', updatedAt: '', kind: 'saved', planningType: 'week_dependent', scheduleType: 'weekday',
} as unknown as Program

const days = [
  { id: 'pd-pull', name: 'Pull 1', position: 0 },
  { id: 'pd-push', name: 'Push 1', position: 1 },
  { id: 'pd-legs', name: 'Legs', position: 2 },
].map((d) => ({ ...d, programId: 'pp-1', userId: U, exercises: [] }))

const pull = [
  pe('pd-pull', 'p-lat', 'Lat Pulldown', 'back', 0, { restAfterSeconds: 180 } as any),
  pe('pd-pull', 'p-row', 'Seated Cable Row', 'back', 1, { supersetBlockId: 'pb-1', tempo: '3-1-1-0' } as any),
  pe('pd-pull', 'p-face', 'Face Pull', 'rear_delts', 2, { supersetBlockId: 'pb-1' }),
  pe('pd-pull', 'p-fly', 'Rear Delt Fly', 'rear_delts', 3, { supersetBlockId: 'pb-1' }),
  pe('pd-pull', 'p-ez', 'EZ Bar Curl', 'biceps', 4),
]
const push = [pe('pd-push', 'u-bench', 'Bench Press', 'chest', 0), pe('pd-push', 'u-ohp', 'Overhead Press', 'shoulders', 1)]
const legs = [pe('pd-legs', 'l-squat', 'Back Squat', 'quads', 0), pe('pd-legs', 'l-rdl', 'Romanian Deadlift', 'hamstrings', 1)]

export function seedPlanner() {
  queryClient.setQueryData(['v2_workoutDays', 'pp-1'], days)
  queryClient.setQueryData(['v2_programExercises', 'pd-pull'], pull.map((e) => ({ ...e })))
  queryClient.setQueryData(['v2_programExercises', 'pd-push'], push)
  queryClient.setQueryData(['v2_programExercises', 'pd-legs'], legs)
  queryClient.setQueryData(['v2_supersetBlockRests', 'pd-pull'], [{ id: 'pb-1', restAfterRoundSeconds: 120, restWithinRoundSeconds: null }])
}
