import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { WeeklySchedule, DayOfWeek } from '../../types'
import {
  fetchPrograms,
  createProgram,
  updateProgramName,
  updateSchedule,
  fetchWorkoutDays,
  createWorkoutDay,
  updateWorkoutDayName,
  deleteWorkoutDay,
  fetchProgramExercises,
  fetchAllProgramExercisesForDays,
  addProgramExercise,
  updateProgramExerciseReps,
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

// Every exercise across every workout day of a program — used to count how
// many times a given exercise recurs in the schedule (drives the smart
// last-session reference: one panel vs LAST WEEK + LAST TIME side by side).
export function useAllProgramExercises(workoutDayIds: string[]) {
  const { user } = useAuth()
  const key = [...workoutDayIds].sort().join(',')
  return useQuery({
    queryKey: ['v2_allProgramExercises', key],
    queryFn: () => fetchAllProgramExercisesForDays(workoutDayIds),
    enabled: !!user && workoutDayIds.length > 0,
  })
}

// exerciseId -> number of times it appears across the program's workout days.
export function useExerciseOccurrenceCounts(programId: string): Map<string, number> {
  const { data: workoutDays = [] } = useWorkoutDays(programId)
  const { data: allProgramExercises = [] } = useAllProgramExercises(workoutDays.map((wd) => wd.id))

  const counts = new Map<string, number>()
  for (const pe of allProgramExercises) {
    counts.set(pe.exerciseId, (counts.get(pe.exerciseId) ?? 0) + 1)
  }
  return counts
}

export function useAddProgramExercise(workoutDayId: string) {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ exerciseId, position }: { exerciseId: string; position: number }) =>
      addProgramExercise(user!.id, workoutDayId, exerciseId, position),
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
      reorderProgramExercises(updates),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['v2_programExercises', workoutDayId] }),
  })
}
