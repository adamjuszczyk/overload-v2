import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { fetchProgramPriorities, setPriorityMark } from './programPrioritiesService'
import type { PriorityMark, PriorityMarkTagType, StoredMark } from '../../lib/priorityMarks.js'

// TanStack hooks for v2_program_priorities (chunk 10), following
// usePriorityContext.ts's shape: a hoisted key function, `enabled` gated on
// both auth and a real id, an optimistic update with a real rollback on
// error (usePriorityContext.ts's own header explains why this feature
// needs one — Phase 3's live check measured a real ~1.2s tap-to-visible
// round trip against production for the same kind of chip tap; the lesson
// carries over unchanged to this new table). Priorities are online-only
// (CONTEXT.md), so this never goes through the offline sync queue
// (useSyncQueue) — same posture as priorityService.ts's own mutations.

// Parameterised by program, not a flat key — a flat key would serve one
// program's cached marks to another program's screen the moment two are
// read in one session (usePriorityContext.ts's own key() carries the same
// reasoning for mesocycleId).
function key(programId: string) {
  return ['v2_programPriorities', programId] as const
}

export function useProgramPriorities(programId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: key(programId ?? ''),
    queryFn: () => fetchProgramPriorities(programId!),
    enabled: !!user && !!programId,
  })
}

// Applies one tap's result to an already-fetched sparse row set, so the
// tapped chip reflects immediately rather than waiting on the write +
// refetch round trip. Pure and exported for the same reason
// usePriorityContext.ts's applyOptimisticPriority is: it's the one place
// the rollback in onError below depends on returning a NEW array rather
// than mutating the one it was given (that same array is the snapshot
// onMutate hands back as ctx.prev).
export function applyOptimisticMark(
  rows: StoredMark[],
  tagType: PriorityMarkTagType,
  tagValue: string,
  mark: PriorityMark | null,
): StoredMark[] {
  const without = rows.filter((r) => !(r.tagType === tagType && r.tagValue === tagValue))
  if (mark === null) return without
  return [...without, { tagType, tagValue, mark, updatedAt: new Date().toISOString() }]
}

export function useSetPriorityMark(programId: string) {
  const { user } = useAuth()
  const qk = key(programId)
  return useMutation({
    // CONTEXT.md: "all write mutations use networkMode: 'always'" — under
    // the default 'online', TanStack Query pauses an offline mutation
    // indefinitely instead of running it, so a tap made offline would just
    // hang (usePlanWeek's own header documents the same failure mode).
    // 'always' attempts the call regardless of connectivity, so an offline
    // tap fails fast with a normal network error — this feature is
    // online-only already, so there is no offline fallback to preserve,
    // only a hang to avoid.
    networkMode: 'always',
    mutationFn: ({
      tagType,
      tagValue,
      mark,
    }: {
      tagType: PriorityMarkTagType
      tagValue: string
      mark: PriorityMark | null
    }) => setPriorityMark(user!.id, programId, tagType, tagValue, mark),
    onMutate: async ({ tagType, tagValue, mark }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData<StoredMark[]>(qk)
      if (prev) {
        queryClient.setQueryData(qk, applyOptimisticMark(prev, tagType, tagValue, mark))
      }
      return { prev }
    },
    // A failed write must not leave the optimistic value on screen — a chip
    // showing a mark that was never stored.
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk, ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}
