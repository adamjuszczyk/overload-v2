import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { fetchHistorySessions, fetchHistoryDetail, deleteSession } from './historyService'

const HISTORY_KEY = ['v2_history']

export function useHistorySessions() {
  const { user } = useAuth()
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => fetchHistorySessions(user!.id),
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
    },
  })
}
