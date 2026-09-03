import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../../lib/supabase'
import { useMesos } from '../programs/useMesos'
import { fetchPriorityContext } from './priorityContext'
import { setTagPriority, copyPrioritiesFromMeso } from './priorityService'
import type { PriorityTagType, PriorityLevel } from '../../lib/priorityTags.js'
import type { Mesocycle } from '../../types'

// TanStack hooks for Priority Context (PRIORITY-CONTEXT-TASKS.md §4.1),
// following useCoachMemory.ts's/useWeekPlan.ts's shape: a hoisted key
// function, `enabled` gated on both auth and a real id, mutations invalidate
// on success, no optimistic updates (TASKS §5.6 — this data is read by an AI
// analysis, so a chip that moves before the write lands could show a
// priority that was never stored).

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(mesocycleId) }),
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
