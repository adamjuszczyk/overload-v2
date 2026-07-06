import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchExerciseProgress, fetchMesoWeeklyProgress } from './progressService'

export function useExerciseProgress(exerciseId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_exerciseProgress', exerciseId],
    queryFn: () => fetchExerciseProgress(user!.id, exerciseId!),
    enabled: !!user && !!exerciseId,
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
