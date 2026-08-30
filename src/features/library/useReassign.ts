import { useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { previewReassign, reassignExerciseHistory, reprimeAfterReassign, checkReassignBlockers } from './reassignService'

// On-demand, same reasoning as useExerciseDeletePreview/useLibraryDeletePreview
// — fired once, right before ReassignSheet.tsx's confirmation step renders.
export function useReassignPreview() {
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) => previewReassign(sourceId, targetId),
  })
}

// P3/P4 (§5.2/§6.2) — fired alongside the preview, on-demand, so the
// confirmation step can disable MERGE HISTORY with an explanation rather
// than let the RPC refuse after the tap.
export function useReassignBlockers() {
  return useMutation({ mutationFn: () => checkReassignBlockers() })
}

// §5.5 — every query key that embeds exercise identity, broad on purpose:
// a merge changes which exercise a set or a program-exercise row belongs to
// across the entire history, not just the two exercises' own rows.
const REASSIGN_INVALIDATION_KEYS: readonly string[] = [
  'exercises',
  'v2_session',
  'v2_programExercises',
  'v2_workoutDays',
  'v2_weekPlan',
  'v2_allWeekPlans',
  'v2_history',
  'v2_historyDetail',
  'v2_exerciseProgress',
  'v2_mesoProgress',
  'v2_referenceSessions',
  'v2_lastSetLogs',
  'v2_positionMatchTable',
  'v2_positionMatchedHeadline',
  'v2_sessionTypeHistory',
]

export function useReassignExerciseHistory() {
  return useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      const result = await reassignExerciseHistory(sourceId, targetId)
      await reprimeAfterReassign(sourceId, targetId)
      return result
    },
    onSuccess: () => {
      REASSIGN_INVALIDATION_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
    },
  })
}
