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
  fetchLostExercises,
  previewExerciseDelete,
  deleteExercise,
  restoreExercise,
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

// Lost Exercises (§8 step 7) — a dedicated list, not a filtered view of
// useExercises(): fetchExercises() always excludes status = 'lost' (§2.3),
// so this is the only place those rows are ever read back.
export function useLostExercises() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['exercises', 'lost'],
    queryFn: fetchLostExercises,
    enabled: !!user,
  })
}

// An on-demand preview, not a cached query — fired once, right before a
// confirm dialog opens, so useMutation's isPending/data shape fits better
// here than useQuery's background-refetch one.
export function useExerciseDeletePreview() {
  return useMutation({ mutationFn: (id: string) => previewExerciseDelete(id) })
}

// Invalidating the whole ['exercises'] key (not just ['exercises', false])
// refreshes both the active list and the Lost list in one go — exactly the
// two lists a delete moves a row between.
export function useDeleteExercise() {
  return useMutation({
    mutationFn: (id: string) => deleteExercise(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}

export function useRestoreExercise() {
  return useMutation({
    mutationFn: (id: string) => restoreExercise(id),
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
