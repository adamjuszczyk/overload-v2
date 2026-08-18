import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchPhaseEntries,
  createPhaseEntry,
  updatePhaseEntry,
  deletePhaseEntry,
  fetchWeightEntries,
  createWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
} from './coachContextService'
import type { TrainingPhase, WeightEntryKind } from '../../types'

// TanStack Query hooks for the Context tab (COACH-ANALYSIS-TASKS.md §4 step
// C), following useHistory.ts's shape: hoisted key constants, `enabled:
// !!user`, mutations import the singleton queryClient directly and
// invalidate on success — no optimistic updates.

const PHASE_ENTRIES_KEY = ['v2_coachPhaseEntries']
const WEIGHT_ENTRIES_KEY = ['v2_coachWeightEntries']

// ─── Phase entries ────────────────────────────────────────────────────────────

export function usePhaseEntries() {
  const { user } = useAuth()
  return useQuery({
    queryKey: PHASE_ENTRIES_KEY,
    queryFn: () => fetchPhaseEntries(user!.id),
    enabled: !!user,
  })
}

export function useCreatePhaseEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ phase, startDate }: { phase: TrainingPhase; startDate: string }) =>
      createPhaseEntry(user!.id, phase, startDate),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PHASE_ENTRIES_KEY }),
  })
}

export function useUpdatePhaseEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ id, phase, startDate }: { id: string; phase: TrainingPhase; startDate: string }) =>
      updatePhaseEntry(id, user!.id, { phase, startDate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PHASE_ENTRIES_KEY }),
  })
}

export function useDeletePhaseEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (id: string) => deletePhaseEntry(id, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PHASE_ENTRIES_KEY }),
  })
}

// ─── Weight entries ───────────────────────────────────────────────────────────

export function useWeightEntries() {
  const { user } = useAuth()
  return useQuery({
    queryKey: WEIGHT_ENTRIES_KEY,
    queryFn: () => fetchWeightEntries(user!.id),
    enabled: !!user,
  })
}

export function useCreateWeightEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      weightKg,
      kind,
      entryDate,
    }: {
      weightKg: number
      kind: WeightEntryKind
      entryDate: string
    }) => createWeightEntry(user!.id, weightKg, kind, entryDate),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WEIGHT_ENTRIES_KEY }),
  })
}

export function useUpdateWeightEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      id,
      weightKg,
      kind,
      entryDate,
    }: {
      id: string
      weightKg: number
      kind: WeightEntryKind
      entryDate: string
    }) => updateWeightEntry(id, user!.id, { weightKg, kind, entryDate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WEIGHT_ENTRIES_KEY }),
  })
}

export function useDeleteWeightEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (id: string) => deleteWeightEntry(id, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WEIGHT_ENTRIES_KEY }),
  })
}
