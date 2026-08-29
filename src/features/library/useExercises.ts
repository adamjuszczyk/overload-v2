import { useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { MuscleGroup } from '../../types'
import {
  fetchExercises,
  createExercise,
  updateExercise,
  setExerciseArchived,
  fetchExerciseCount,
  seedDefaultExercisesIfEmpty,
  type ExerciseTagFields,
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
    mutationFn: ({
      name,
      muscleGroup,
      tags,
    }: {
      name: string
      muscleGroup: MuscleGroup
      tags?: ExerciseTagFields
    }) => createExercise(user!.id, name, muscleGroup, tags),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}

export function useUpdateExercise() {
  return useMutation({
    mutationFn: ({
      id,
      name,
      muscleGroup,
      tags,
    }: {
      id: string
      name: string
      muscleGroup: MuscleGroup
      tags?: ExerciseTagFields
    }) => updateExercise(id, name, muscleGroup, tags),
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

// Fresh-account seed (SPEC §9). Mount once near the app root so it fires
// regardless of which tab a brand-new account lands on first — not just
// Library, since ExercisePicker also needs a non-empty list.
export function useSeedDefaultExercisesIfEmpty() {
  const { user } = useAuth()
  const attempted = useRef(false)

  const { data: count } = useQuery({
    queryKey: ['exercises', 'count'],
    queryFn: fetchExerciseCount,
    enabled: !!user,
  })

  const seed = useMutation({
    mutationFn: () => seedDefaultExercisesIfEmpty(user!.id),
    // Bounded retry so one transient failure (network blip, momentary RLS
    // hiccup) doesn't permanently strand a fresh account at zero exercises
    // for the rest of the session — attempted.current below only guards
    // against re-firing while count still reads 0, not against retrying
    // this single call, which TanStack Query's own backoff already covers.
    retry: 3,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })

  useEffect(() => {
    if (attempted.current || count !== 0 || seed.isPending) return
    attempted.current = true
    seed.mutate()
  }, [count, seed])
}
