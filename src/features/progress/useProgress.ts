import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchExerciseProgress, fetchMesoWeeklyProgress, fetchPositionMatchedHeadline } from './progressService'
import type { E1rmComparison } from './e1rm'

export function useExerciseProgress(exerciseId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_exerciseProgress', exerciseId],
    queryFn: () => fetchExerciseProgress(user!.id, exerciseId!),
    enabled: !!user && !!exerciseId,
    staleTime: 5 * 60 * 1000,
  })
}

// Position-matched headline (see progressService.ts's fetchPositionMatchedHeadline
// for why this is a second network read rather than reusing useExerciseProgress's
// data). Keyed on the resolved session pair, not on exerciseId alone — the pair is
// already the output of getExerciseE1rmComparison, so this only refetches when
// *which* two sessions get compared actually changes, not on every unrelated
// re-render of the caller.
export function usePositionMatchedHeadline(
  exerciseId: string | null,
  sessionPair: E1rmComparison | null,
) {
  return useQuery({
    queryKey: ['v2_positionMatchedHeadline', exerciseId, sessionPair?.firstSessionId, sessionPair?.lastSessionId],
    queryFn: () => fetchPositionMatchedHeadline(exerciseId!, sessionPair!),
    enabled: !!exerciseId && !!sessionPair,
    staleTime: 5 * 60 * 1000,
  })
}

export function useMesoWeeklyProgress(
  mesoId: string | null,
  mesoStartDate: string | null,
) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_mesoProgress', mesoId],
    queryFn: () => fetchMesoWeeklyProgress(user!.id, mesoId!, mesoStartDate!),
    enabled: !!user && !!mesoId && !!mesoStartDate,
    staleTime: 5 * 60 * 1000,
  })
}
