import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchCoachMemoryEntries,
  createCoachMemoryEntry,
  updateCoachMemoryEntry,
  deleteCoachMemoryEntry,
  restoreCoachMemoryEntry,
} from './coachMemoryService'

// TanStack Query hooks for Coach Memory (COACH-PERSONALIZATION-TASKS.md §6,
// phase 4), following useCoachNotes.ts's shape: hoisted key constant,
// `enabled: !!user`, mutation invalidates on success. No offline branch —
// Coach Memory is online-only, same as the notes list (TASKS §2.6) and
// every other Coach surface under /coach.
//
// No curation hook here — see coachMemoryService.ts's header for why
// (curation is automatic now, wired into api/coach/analyze.ts server-side,
// not a client-triggered mutation).

const COACH_MEMORY_KEY = ['v2_coachMemory']

export function useCoachMemory() {
  const { user } = useAuth()
  return useQuery({
    queryKey: COACH_MEMORY_KEY,
    queryFn: () => fetchCoachMemoryEntries(user!.id),
    enabled: !!user,
  })
}

export function useCreateCoachMemoryEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (body: string) => createCoachMemoryEntry(user!.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COACH_MEMORY_KEY }),
  })
}

export function useUpdateCoachMemoryEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => updateCoachMemoryEntry(id, user!.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COACH_MEMORY_KEY }),
  })
}

export function useDeleteCoachMemoryEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (id: string) => deleteCoachMemoryEntry(id, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COACH_MEMORY_KEY }),
  })
}

export function useRestoreCoachMemoryEntry() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (id: string) => restoreCoachMemoryEntry(id, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COACH_MEMORY_KEY }),
  })
}
