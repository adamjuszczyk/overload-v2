import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../../lib/supabase'
import { useMesos } from '../programs/useMesos'
import { fetchPriorityContext } from './priorityContext'
import type { PriorityContext } from './priorityContext'
import { setTagPriority, copyPrioritiesFromMeso } from './priorityService'
import type { PriorityTagType, PriorityLevel, PriorityEntry } from '../../lib/priorityTags.js'
import type { Mesocycle } from '../../types'

// TanStack hooks for Priority Context (PRIORITY-CONTEXT-TASKS.md §4.1),
// following useCoachMemory.ts's/useWeekPlan.ts's shape: a hoisted key
// function, `enabled` gated on both auth and a real id, mutations invalidate
// on success. §5.6 originally specified no optimistic update, on the
// reasoning that this data feeds an AI analysis and a chip that moved before
// the write landed could show a priority that was never stored — but A5's
// own text asked for that to be checked against real latency rather than
// assumed, and Phase 3's live check measured a real ~1.2s tap-to-visible
// round trip against production (one upsert, then a refetch after
// invalidation) — clearly perceptible, not a rounding error. useSetTagPriority
// below now takes useWeekPlan.ts's onMutate/onError/onSettled shape (the
// same pattern useUpdateSet/useSetDeload/useRemoveSet already use in this
// codebase), with a real rollback on failure — so §5.6's original worry
// (a failed write reads as a stored priority) is exactly what onError
// guards against, rather than being a reason to skip optimism altogether.

// Parameterised by meso, not a flat key — a flat key would serve one meso's
// cached priorities to another meso's screen the moment two are viewed in
// one session, the same ownership-bug class Q&A §8.3 already found once.
// useWeekPlans(mesoId, weekNumber) keys the same way for the same reason.
function key(mesocycleId: string | null) {
  return ['v2_coachMesoTagPriorities', mesocycleId] as const
}

export function usePriorityContext(mesocycleId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: key(mesocycleId),
    queryFn: () => fetchPriorityContext(supabase, user!.id, mesocycleId!),
    enabled: !!user && !!mesocycleId,
  })
}

// Applies one tap's result to an already-fetched PriorityContext, so the
// tapped chip reflects immediately rather than waiting on the upsert +
// refetch round trip (see the file header — A5, revisited against real
// latency at Phase 3's live check). Pure, so it's the same shape whether the
// tag is a group or a subgroup; the mutation below is the only caller.
//
// Exported solely so it is directly Vitest-covered, for the same reason
// selectPreviousMeso below and qaSidebarStore.ts's isStaleForSurface are:
// this function was added reactively at Phase 3 rather than in the plan, and
// onError's rollback depends on a property that is invisible at the call
// site — that this returns a NEW context and never mutates the one it was
// given, since that same object is the snapshot onMutate hands back as
// ctx.prev. It also has one genuine trap: six tag_values ('biceps',
// 'forearms', 'quads', 'hamstrings', 'glutes', 'calves') exist in BOTH
// vocabularies, so every lookup here must key on tagType as well as
// tagValue — dropping that would silently move a group's twin subgroup.
export function applyOptimisticPriority(
  context: PriorityContext,
  tagType: PriorityTagType,
  tagValue: string,
  priority: PriorityLevel,
): PriorityContext {
  const updated: PriorityEntry = { tagType, tagValue, priority, isExplicit: true, updatedAt: new Date().toISOString() }
  const entries = context.entries.map((e) => (e.tagType === tagType && e.tagValue === tagValue ? updated : e))
  return tagType === 'muscle_group'
    ? { ...context, muscleGroups: { ...context.muscleGroups, [tagValue]: updated }, entries, anyExplicit: true }
    : { ...context, muscleSubgroups: { ...context.muscleSubgroups, [tagValue]: updated }, entries, anyExplicit: true }
}

export function useSetTagPriority(mesocycleId: string) {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      tagType,
      tagValue,
      priority,
    }: {
      tagType: PriorityTagType
      tagValue: string
      priority: PriorityLevel
    }) => setTagPriority(user!.id, mesocycleId, tagType, tagValue, priority),
    onMutate: async ({ tagType, tagValue, priority }) => {
      await queryClient.cancelQueries({ queryKey: key(mesocycleId) })
      const prev = queryClient.getQueryData<PriorityContext>(key(mesocycleId))
      if (prev) {
        queryClient.setQueryData(key(mesocycleId), applyOptimisticPriority(prev, tagType, tagValue, priority))
      }
      return { prev }
    },
    // A failed write must not leave the optimistic value on screen — this is
    // exactly §5.6's original worry (a chip showing a priority that was
    // never stored), guarded against directly rather than avoided by never
    // being optimistic at all.
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key(mesocycleId), ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(mesocycleId) }),
  })
}

// Q1a's selection rule (TASKS §5.8 / §7): the user's meso with the greatest
// start_date, excluding the target, tie-broken by created_at desc.
// start_date and not created_at because it's what the planner already
// treats as a meso's position in time (ActiveMesoCard displays it,
// computeWeekNumber derives from it, MesoProgress labels mesos by it) —
// fetchMesos() happens to *order* by created_at desc, which is a
// list-ordering choice, not a statement about which block came first.
//
// Pure and exported so it's directly Vitest-covered (TASKS §6 Phase 2)
// rather than only exercised through the hook — no renderHook precedent
// exists anywhere in this codebase; every hook's real logic is tested this
// way instead (qaSidebarStore.ts's isStaleForSurface, qaCategory.ts's
// resolveQaRoute).
export function selectPreviousMeso(mesos: Mesocycle[], targetMesocycleId: string): Mesocycle | null {
  const candidates = mesos.filter((m) => m.id !== targetMesocycleId)
  if (candidates.length === 0) return null

  return candidates.reduce((best, candidate) => {
    if (candidate.startDate > best.startDate) return candidate
    if (candidate.startDate < best.startDate) return best
    return candidate.createdAt > best.createdAt ? candidate : best
  })
}

// Derived from the existing useMesos() cache — no new query, matching
// MesoProgress.tsx's own plain `mesos.find(...)` derivation style rather
// than a useMemo that isn't needed at this scale (at most a handful of
// mesos per account).
export function usePreviousMeso(mesocycleId: string | null): Mesocycle | null {
  const { data: mesos = [] } = useMesos()
  return mesocycleId ? selectPreviousMeso(mesos, mesocycleId) : null
}

export function useCopyPrioritiesFromMeso(mesocycleId: string) {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ fromMesocycleId }: { fromMesocycleId: string }) =>
      copyPrioritiesFromMeso(user!.id, fromMesocycleId, mesocycleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(mesocycleId) }),
  })
}
