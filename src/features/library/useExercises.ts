import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { MuscleGroup } from '../../types'
import {
  fetchExercises,
  createExercise,
  updateExercise,
  setExerciseArchived,
} from './exerciseService'

export function useExercises(includeArchived = false) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['exercises', includeArchived],
    queryFn: () => fetchExercises(includeArchived),
    enabled: !!user,
  })
}

export function useCreateExercise() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ name, muscleGroup }: { name: string; muscleGroup: MuscleGroup }) =>
      createExercise(user!.id, name, muscleGroup),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}

export function useUpdateExercise() {
  return useMutation({
    mutationFn: ({
      id,
      name,
      muscleGroup,
    }: {
      id: string
      name: string
      muscleGroup: MuscleGroup
    }) => updateExercise(id, name, muscleGroup),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}

export function useSetExerciseArchived() {
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      setExerciseArchived(id, archived),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}
