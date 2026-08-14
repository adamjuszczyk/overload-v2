import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import {
  fetchExerciseProgress,
  fetchMesoWeeklyProgress,
  fetchPositionMatchedHeadline,
  fetchPositionMatchTable,
} from './progressService'
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

// History's position-matched table (see progressService.ts's
// fetchPositionMatchTable). Keyed on the resolved session id list itself,
// not just exerciseId — same reasoning as usePositionMatchedHeadline's pair
// key, one level up at N sessions instead of 2: it should only refetch when
// *which* sessions are in scope actually changes (e.g. the meso filter), not
// on every unrelated re-render of the caller.
//
// Found by adversarial review: ExerciseHistoryView.tsx's LOAD MORE grows the
// session list (and therefore this query's key) on every click, which without
// placeholderData would blank the fully-rendered table back to a loading
// spinner on every tap, not just append the newly revealed sessions —
// exactly the "matches EVERY SET's old useInfiniteQuery-style pagination"
// behavior this feature was built to provide, but wasn't actually giving.
// keepPreviousData keeps the last successful (smaller) table on screen while
// the larger one loads in the background; it does not by itself avoid
// re-fetching already-seen sessions — see fetchSessionsBatched
// (progressService.ts) for the per-session cache that fixes that half.
export function usePositionMatchTable(
  exerciseId: string | null,
  sessions: { sessionId: string; date: string }[] | null,
) {
  return useQuery({
    queryKey: ['v2_positionMatchTable', exerciseId, sessions?.map((s) => s.sessionId).join(',')],
    queryFn: () => fetchPositionMatchTable(exerciseId!, sessions!),
    enabled: !!exerciseId && !!sessions && sessions.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
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
