// Programs hooks for the prototype. Reads come from the query cache (seeded by demo/seed.ts and demo/plannerFixture.ts
// under the real keys); writes change the cache, so the planner can be played with. Everything else is the real module.
export * from '@app/features/programs/usePrograms'
import { useSyncExternalStore } from 'react'
import { queryClient } from '@app/lib/queryClient'
import { blocks } from '../../demo/workoutFixture'
import type { ProgramExercise } from '@app/types'

// Reads the cache entry directly and re-renders whenever the cache changes (a disabled query doesn't re-render on setQueryData here).
const subscribe = (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange)
const read = <T,>(key: unknown[], fallback?: T) => {
  const data = useSyncExternalStore(subscribe, () => queryClient.getQueryData<T>(key))
  return { data: data ?? fallback, isLoading: false, isError: false, error: null }
}
const noop = () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false })

export function useWorkoutDays(programId: string) { return read(['v2_workoutDays', programId]) }
export function useProgramExercises(workoutDayId: string) { return read<ProgramExercise[]>(['v2_programExercises', workoutDayId]) }
export function useSupersetBlockRests(workoutDayId: string) { return read(['v2_supersetBlockRests', workoutDayId], workoutDayId === 'wd-1' ? blocks : []) }
export function useWarmupRoutineItems(workoutDayId: string) { return read(['v2_warmupRoutineItems', workoutDayId], []) }
export function useSequenceItems(programId: string) { return read(['v2_sequenceItems', programId], []) }

export function useToggleSupersetLink(workoutDayId: string) {
  return {
    isPending: false,
    mutateAsync: async () => {},
    mutate: (plans: { ids: string[]; blockId: string | null; needsNewBlock?: boolean }[]) => {
      const key = ['v2_programExercises', workoutDayId]
      let list = queryClient.getQueryData<ProgramExercise[]>(key) ?? []
      for (const plan of plans) {
        const id = plan.needsNewBlock ? `block-${Math.random().toString(36).slice(2, 7)}` : plan.blockId
        list = list.map((e) => (plan.ids.includes(e.id) ? { ...e, supersetBlockId: id } : e))
      }
      queryClient.setQueryData(key, list)
    },
  }
}
export function useUpdateProgramExerciseTempo(workoutDayId: string) {
  return { ...noop(), mutate: ({ id, tempo }: { id: string; tempo: string | null }) => queryClient.setQueryData<ProgramExercise[]>(['v2_programExercises', workoutDayId], (l) => (l ?? []).map((e) => (e.id === id ? ({ ...e, tempo } as ProgramExercise) : e))) }
}
export const useCreateWorkoutDay = noop, useUpdateWorkoutDayName = noop, useDeleteWorkoutDay = noop, useAddProgramExercise = noop,
  useUpdateProgramExerciseWeightUnit = noop, useUpdateProgramExerciseRest = noop, useDeleteProgramExercise = noop,
  useReorderProgramExercises = noop, useUpdateSupersetBlockRest = noop, useAddWarmupItem = noop, useUpdateWarmupItemBody = noop,
  useRemoveWarmupItem = noop, useReorderWarmupItems = noop, useAddSequenceItem = noop, useUpdateSequenceItemWorkout = noop,
  useRemoveSequenceItem = noop, useReorderSequenceItems = noop, useUpdateScheduleType = noop, useUpdateProgramName = noop
