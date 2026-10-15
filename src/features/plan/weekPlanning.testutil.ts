// Builders shared by weekPlanning's tests (chunk 42): full app-typed rows with the defaults a plain
// working set has, so a test states only what its rule reads. Not a test file (Vitest's include is
// *.test.ts) and imported by nothing in the app.

import type { ProgramExercise, ProgramSet, WeekPlan, WeekPlanSet } from '../../types'

export const pe = (id: string, exerciseId: string, position: number, over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id,
  workoutDayId: 'wd-1',
  userId: 'u',
  exerciseId,
  position,
  weightUnit: null,
  exercise: {
    id: exerciseId,
    userId: 'u',
    name: exerciseId.toUpperCase(),
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
  ...over,
})

// A week plan set: a working set at 100 kg × 8, RIR 2 unless said otherwise.
export function wset(id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id,
    weekPlanId: 'wp',
    userId: 'u',
    programExerciseId,
    setNumber,
    targetRir: 2,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
    targetWeight: 100,
    repMin: 8,
    repMax: 8,
    ...over,
  }
}

export const stage = (
  id: string,
  parent: string,
  programExerciseId: string,
  stageIndex: number,
  over: Partial<WeekPlanSet> = {},
): WeekPlanSet => wset(id, programExerciseId, 1, { isDropset: true, parentWeekPlanSetId: parent, stageIndex, ...over })

// A run copy's program set: 8 reps, no weight or RIR (a program holds none).
export function pset(id: string, programExerciseId: string, position: number, over: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id,
    userId: 'u',
    programExerciseId,
    position,
    isWarmup: false,
    stageKind: null,
    stageRestSeconds: null,
    parentProgramSetId: null,
    stageIndex: 0,
    repMin: 8,
    repMax: 8,
    isAmrap: false,
    restSeconds: null,
    createdAt: '',
    ...over,
  }
}

export function plan(weekNumber: number, exercises: ProgramExercise[], sets: WeekPlanSet[], over: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`,
    userId: 'u',
    mesocycleId: 'm',
    workoutDayId: 'wd-1',
    weekNumber,
    isDeload: false,
    notes: null,
    sets,
    exercises,
    createdAt: '',
    ...over,
  }
}

// One exercise with `n` identical working sets, set ids `${pe}-1` …
export function sets(peId: string, n: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet[] {
  return Array.from({ length: n }, (_, i) => wset(`${peId}-${i + 1}`, peId, i + 1, over))
}
