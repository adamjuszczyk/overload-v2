import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { WeeklySchedule, DayOfWeek, WeightUnit, ProgramExercise } from '../../types'
import {
  fetchPrograms,
  fetchSavedPrograms,
  createProgram,
  updateProgramName,
  updateSchedule,
  fetchWorkoutDays,
  createWorkoutDay,
  updateWorkoutDayName,
  deleteWorkoutDay,
  fetchProgramExercises,
  addProgramExercise,
  updateProgramExerciseReps,
  updateProgramExerciseWeightUnit,
  deleteProgramExercise,
  reorderProgramExercises,
} from './programService'

// ─── Programs ─────────────────────────────────────────────────────────────────

export function usePrograms() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_programs'],
    queryFn: fetchPrograms,
    enabled: !!user,
  })
}

// Program lists only (chunk 6) — ProgramPage's "My Programs" and its Start
// Mesocycle picker. Query key is ['v2_programs', 'saved'], a child of
// ['v2_programs'] by TanStack Query's own prefix-matching, so every existing
// invalidation of the broad key (useCreateProgram, useUpdateProgramName,
// useUpdateSchedule, useDeleteWorkoutDay, useStartRun below) already
// invalidates this one too — nothing else needed to keep it in step.
export function useSavedPrograms() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_programs', 'saved'],
    queryFn: fetchSavedPrograms,
    enabled: !!user,
  })
}

export function useCreateProgram() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (name: string) => createProgram(user!.id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2_programs'] }),
  })
}

export function useUpdateProgramName() {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateProgramName(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2_programs'] }),
  })
}

export function useUpdateSchedule(programId: string) {
  return useMutation({
    mutationFn: (schedule: WeeklySchedule) => updateSchedule(programId, schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2_programs'] }),
  })
}

// ─── Workout Days ─────────────────────────────────────────────────────────────

export function useWorkoutDays(programId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_workoutDays', programId],
    queryFn: () => fetchWorkoutDays(programId),
    enabled: !!user && !!programId,
  })
}

export function useCreateWorkoutDay(programId: string) {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ name, position }: { name: string; position: number }) =>
      createWorkoutDay(user!.id, programId, name, position),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_workoutDays', programId] }),
  })
}

export function useUpdateWorkoutDayName(programId: string) {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateWorkoutDayName(id, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_workoutDays', programId] }),
  })
}

export function useDeleteWorkoutDay(programId: string) {
  return useMutation({
    mutationFn: async ({ id, schedule }: { id: string; schedule: WeeklySchedule }) => {
      await deleteWorkoutDay(id)
      // Remove deleted day from the schedule JSONB
      const cleaned = { ...schedule } as WeeklySchedule
      for (const dow of Object.keys(cleaned) as DayOfWeek[]) {
        if (cleaned[dow] === id) cleaned[dow] = null
      }
      await updateSchedule(programId, cleaned)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2_workoutDays', programId] })
      queryClient.invalidateQueries({ queryKey: ['v2_programs'] })
    },
  })
}

// ─── Program Exercises ────────────────────────────────────────────────────────

export function useProgramExercises(workoutDayId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_programExercises', workoutDayId],
    queryFn: () => fetchProgramExercises(workoutDayId),
    enabled: !!user && !!workoutDayId,
  })
}

export function useAddProgramExercise(workoutDayId: string) {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      exerciseId,
      position,
      weightUnit,
    }: {
      exerciseId: string
      position: number
      // Resolved literal from the global default at add-time (TASKS.md §4
      // item 28) — the caller resolves this, not this hook, since the
      // resolution itself reads the Settings store.
      weightUnit: WeightUnit
    }) => addProgramExercise(user!.id, workoutDayId, exerciseId, position, weightUnit),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_programExercises', workoutDayId] }),
  })
}

export function useUpdateProgramExerciseReps(workoutDayId: string) {
  return useMutation({
    mutationFn: ({ id, targetReps }: { id: string; targetReps: number | null }) =>
      updateProgramExerciseReps(id, targetReps),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_programExercises', workoutDayId] }),
  })
}

// Optimistic with real rollback — unlike handleRepsStepper's ad-hoc pattern,
// a failed/offline weight-unit PATCH must not leave the picker showing a
// selection that was never actually persisted (found via adversarial
// review: this mutation has no offline queue, so a failed write with no
// rollback could sit uncorrected for the full 5-minute staleTime).
export function useUpdateProgramExerciseWeightUnit(workoutDayId: string) {
  const qk = ['v2_programExercises', workoutDayId] as const
  return useMutation({
    mutationFn: ({ id, weightUnit }: { id: string; weightUnit: WeightUnit | null }) =>
      updateProgramExerciseWeightUnit(id, weightUnit),
    onMutate: async ({ id, weightUnit }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData<ProgramExercise[]>(qk)
      queryClient.setQueryData(qk, (old: ProgramExercise[] | undefined) =>
        old?.map((e) => (e.id === id ? { ...e, weightUnit } : e)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk, ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useDeleteProgramExercise(workoutDayId: string) {
  return useMutation({
    mutationFn: (id: string) => deleteProgramExercise(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_programExercises', workoutDayId] }),
  })
}

export function useReorderProgramExercises(workoutDayId: string) {
  return useMutation({
    mutationFn: (updates: { id: string; position: number }[]) =>
      reorderProgramExercises(workoutDayId, updates),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_programExercises', workoutDayId] }),
  })
}
