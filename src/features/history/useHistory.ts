import { useQuery, useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchHistorySessions,
  fetchHistoryDetail,
  deleteSession,
  fetchWorkoutDayName,
  fetchSessionTypeHistory,
} from './historyService'

const HISTORY_KEY = ['v2_history']

export function useHistorySessions() {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: HISTORY_KEY,
    queryFn: ({ pageParam }) => fetchHistorySessions(user!.id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  })
}

export function useHistoryDetail(sessionId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_historyDetail', sessionId],
    queryFn: () => fetchHistoryDetail(sessionId!),
    enabled: !!user && !!sessionId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useDeleteSession() {
  return useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
      queryClient.removeQueries({ queryKey: ['v2_historyDetail', id] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
      queryClient.invalidateQueries({ queryKey: ['v2_exerciseProgress'] })
      queryClient.invalidateQueries({ queryKey: ['v2_mesoProgress'] })
      // Same gap as useCompleteSession's onSuccess (useSession.ts) — deleting
      // a session can change which two sessions getExerciseE1rmComparison
      // resolves, and even when it doesn't, this cache entry has no other
      // invalidation path. Same fix, same reasoning.
      queryClient.invalidateQueries({ queryKey: ['v2_positionMatchedHeadline'] })
      queryClient.invalidateQueries({ queryKey: ['v2_positionMatchTable'] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessionTypeHistory'] })
    },
  })
}

// ─── Session type, all time ─────────────────────────────────────────────────

export function useSessionTypeHistory(workoutDayId: string | null) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: ['v2_sessionTypeHistory', workoutDayId],
    queryFn: ({ pageParam }) => fetchSessionTypeHistory(user!.id, workoutDayId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!user && !!workoutDayId,
    staleTime: 2 * 60 * 1000,
  })
}

export function useWorkoutDayName(workoutDayId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_workoutDayName', workoutDayId],
    queryFn: () => fetchWorkoutDayName(user!.id, workoutDayId!),
    enabled: !!user && !!workoutDayId,
    staleTime: 10 * 60 * 1000,
  })
}
