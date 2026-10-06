import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { ProgramSet, WeeklySchedule, DayOfWeek, WorkoutDay } from '../../types'
import type { RepTarget, StageKind } from '../../lib/plannerVocabulary.js'
import { updateSchedule } from '../programs/programService'
import {
  fetchProgramSets,
  setExerciseSetCount,
  updateProgramSetRepTarget,
  setRepTargetForAllSets,
  updateProgramSetStageKind,
  addProgramSetStage,
  removeProgramSet,
  assignWorkoutWeekday,
  splitSharedWeekdayWorkouts,
  type SharedWeekdayGroup,
} from './plannerService'

// Chunk 11 — TanStack hooks over plannerService.ts, following
// useProgramPriorities.ts's own shape (hoisted key function, `enabled`
// gated on auth + real input, networkMode: 'always' on every new write
// mutation here per CONTEXT.md — this file's own first users of
// v2_program_sets have no offline queue, same posture as useProgramPriorities
// and useWeekPlan's own newer mutations).

const SETS_KEY_PREFIX = 'v2_programSets'

function setsKey(programExerciseIds: readonly string[]) {
  return [SETS_KEY_PREFIX, [...programExerciseIds].sort().join(',')] as const
}

// Scoped to one workout's own exercises at a time (StepVolume.tsx calls this
// once per workout, not once per exercise) — a flat key would serve one
// workout's cached sets to another the moment two are read in one session,
// the same reasoning useProgramPriorities.ts's own key() gives for programId.
export function useProgramSets(programExerciseIds: readonly string[]) {
  const { user } = useAuth()
  const ids = [...programExerciseIds].sort()
  return useQuery({
    queryKey: setsKey(ids),
    queryFn: () => fetchProgramSets(ids),
    enabled: !!user && ids.length > 0,
  })
}

// Every programExerciseIds combination gets its own cache entry (see
// setsKey above), so a precise invalidation would need the same ids the
// write touched; invalidating the whole prefix instead (TanStack Query's
// default prefix match) just refetches every currently-mounted sets query,
// cheap at this scale (a handful of exercises per workout).
function invalidateProgramSets() {
  queryClient.invalidateQueries({ queryKey: [SETS_KEY_PREFIX] })
}

export function useSetExerciseSetCount() {
  const { user } = useAuth()
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      programExerciseId,
      currentHeads,
      count,
    }: {
      programExerciseId: string
      currentHeads: ProgramSet[]
      count: number
    }) => setExerciseSetCount(user!.id, programExerciseId, currentHeads, count),
    onSuccess: invalidateProgramSets,
  })
}

export function useUpdateSetRepTarget() {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, target }: { id: string; target: RepTarget }) => updateProgramSetRepTarget(id, target),
    onSuccess: invalidateProgramSets,
  })
}

// Chunk 14 — StepVolume.tsx's STAGE KIND chip row (same affordance
// PlanPage.tsx's own week-plan chips use, one layer up — SPEC "Staged
// sets").
export function useUpdateProgramSetStageKind() {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, stageKind }: { id: string; stageKind: StageKind | null }) =>
      updateProgramSetStageKind(id, stageKind),
    onSuccess: invalidateProgramSets,
  })
}

// StepVolume.tsx's own ADD STAGE — parentId given directly, same posture
// as useAddStage (PlanPage.tsx's week-plan equivalent, useWeekPlan.ts).
export function useAddProgramSetStage() {
  const { user } = useAuth()
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      programExerciseId,
      parentId,
      position,
      stageIndex,
    }: {
      programExerciseId: string
      parentId: string
      position: number
      stageIndex: number
    }) => addProgramSetStage(user!.id, programExerciseId, parentId, position, stageIndex),
    onSuccess: invalidateProgramSets,
  })
}

// One row at a time — StepVolume.tsx's per-stage remove button. (The SETS
// stepper's own bulk head-shrink path, useSetExerciseSetCount above, stays
// its own thing — this is only ever a single stage id.)
export function useRemoveProgramSetStage() {
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string) => removeProgramSet(id),
    onSuccess: invalidateProgramSets,
  })
}

// Review fix — "fill all sets of an exercise at once" (SPEC.md step 3),
// the exercise-level control beside the SETS stepper (StepVolume.tsx's
// ExerciseTargetRow). One mutation, one write, covering every head id given.
export function useSetRepTargetForAllSets() {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ headIds, target }: { headIds: string[]; target: RepTarget }) =>
      setRepTargetForAllSets(headIds, target),
    onSuccess: invalidateProgramSets,
  })
}

// Step 2's weekday-per-workout control (StepExercises.tsx). Wraps the pure
// assignWorkoutWeekday + the existing updateSchedule write (programService.ts
// — the same function useUpdateSchedule already calls; this hook exists
// because the *input* here is a workout + a target day, not a whole
// pre-built schedule object).
export function useAssignWorkoutWeekday(programId: string) {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      schedule,
      workoutDayId,
      dow,
    }: {
      schedule: WeeklySchedule
      workoutDayId: string
      dow: DayOfWeek | null
    }) => updateSchedule(programId, assignWorkoutWeekday(schedule, workoutDayId, dow)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2_programs'] }),
  })
}

// The G14 prompt's "give each weekday its own workout" choice — only after
// an explicit confirm (PlannerPage.tsx). Invalidates both the program
// (schedule changed) and this program's workout days (new rows appeared).
export function useSplitSharedWeekdayWorkouts(programId: string) {
  const { user } = useAuth()
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      schedule,
      workoutDays,
      groups,
    }: {
      schedule: WeeklySchedule
      workoutDays: WorkoutDay[]
      groups: SharedWeekdayGroup[]
    }) =>
      splitSharedWeekdayWorkouts(user!.id, workoutDays, schedule, groups).then((nextSchedule) =>
        updateSchedule(programId, nextSchedule),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2_programs'] })
      queryClient.invalidateQueries({ queryKey: ['v2_workoutDays', programId] })
    },
  })
}

export { headSets, hasNoSets, detectSharedWeekdayWorkouts, summarizeRepTargets } from './plannerService'
export type { SharedWeekdayGroup } from './plannerService'
