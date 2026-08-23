import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchAnalyzableWeeks,
  fetchCoachWeekAnalyses,
  fetchCoachWeekAnalysisDetail,
  analyzeWeek,
} from './coachWeekService'

// TanStack Query hooks for the Week sub-tab (COACH-WEEK-ANALYSIS-TASKS.md §4
// step 8b), following useCoachAnalysis.ts's shape exactly: hoisted key
// constants, `enabled: !!user`, mutation invalidates on success.

const ANALYZABLE_WEEKS_KEY = ['v2_coachAnalyzableWeeks']
const COACH_WEEK_ANALYSES_KEY = ['v2_coachWeekAnalyses']

export function useAnalyzableWeeks() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ANALYZABLE_WEEKS_KEY,
    queryFn: () => fetchAnalyzableWeeks(user!.id),
    enabled: !!user,
  })
}

export function useCoachWeekAnalyses() {
  const { user } = useAuth()
  return useQuery({
    queryKey: COACH_WEEK_ANALYSES_KEY,
    queryFn: () => fetchCoachWeekAnalyses(user!.id),
    enabled: !!user,
  })
}

export function useCoachWeekAnalysisDetail(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_coachWeekAnalysisDetail', id],
    queryFn: () => fetchCoachWeekAnalysisDetail(id!, user!.id),
    enabled: !!user && !!id,
  })
}

// A generation is a real, longer wait than daily's (step 6: 21.3s real —
// thinner margin against the 60s cap, TASKS §7.17) — callers key their
// in-flight UI off `variables` (the weekStart just passed to `mutate`)
// rather than separate local state, same convention useAnalyzeSession uses.
export function useAnalyzeWeek() {
  return useMutation({
    mutationFn: (weekStart: string) => analyzeWeek(weekStart),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ANALYZABLE_WEEKS_KEY })
      queryClient.invalidateQueries({ queryKey: COACH_WEEK_ANALYSES_KEY })
    },
  })
}
