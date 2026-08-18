import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchAnalyzableSessions,
  fetchCoachAnalyses,
  fetchCoachAnalysisDetail,
  analyzeSession,
} from './coachService'

// TanStack Query hooks for the Analysis tab (COACH-ANALYSIS-TASKS.md §4 step
// F), following useCoachContext.ts's/useHistory.ts's shape: hoisted key
// constants, `enabled: !!user`, mutation invalidates on success.

const ANALYZABLE_SESSIONS_KEY = ['v2_coachAnalyzableSessions']
const COACH_ANALYSES_KEY = ['v2_coachAnalyses']

export function useAnalyzableSessions() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ANALYZABLE_SESSIONS_KEY,
    queryFn: () => fetchAnalyzableSessions(user!.id),
    enabled: !!user,
  })
}

export function useCoachAnalyses() {
  const { user } = useAuth()
  return useQuery({
    queryKey: COACH_ANALYSES_KEY,
    queryFn: () => fetchCoachAnalyses(user!.id),
    enabled: !!user,
  })
}

export function useCoachAnalysisDetail(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_coachAnalysisDetail', id],
    queryFn: () => fetchCoachAnalysisDetail(id!, user!.id),
    enabled: !!user && !!id,
  })
}

// A generation is a real 10–25s wait (TASKS §1.6) — callers key their
// in-flight UI off `variables` (the sessionId just passed to `mutate`)
// rather than separate local state, since only one analysis can run at a
// time from this tab.
export function useAnalyzeSession() {
  return useMutation({
    mutationFn: (sessionId: string) => analyzeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ANALYZABLE_SESSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: COACH_ANALYSES_KEY })
    },
  })
}
