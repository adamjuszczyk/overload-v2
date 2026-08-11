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
  importDefaultExercises,
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

// Explicit Library-screen action (SPEC §9 / post-launch fix, 2026-08-10) —
// distinct from the fresh-account auto-seed above: reachable on any account
// at any time, diffs against what's already there instead of only firing
// once on an empty library.
export function useImportDefaultExercises() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: () => importDefaultExercises(user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}
