import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchCoachMemoryEntries,
  createCoachMemoryEntry,
  updateCoachMemoryEntry,
  deleteCoachMemoryEntry,
  restoreCoachMemoryEntry,
  curateMemory,
} from './coachMemoryService'

// TanStack Query hooks for Coach Memory (COACH-PERSONALIZATION-TASKS.md §6,
// phase 4), following useCoachNotes.ts's shape: hoisted key constant,
// `enabled: !!user`, mutation invalidates on success. No offline branch —
// Coach Memory is online-only, same as the notes list (TASKS §2.6) and
// every other Coach surface under /coach.
//
// useCurateMemory also invalidates the notes key: a successful run advances
// curated_at on every note it read, which changes useCoachNotes()'s data
// (and, via its curatedAt field, the "N NEW NOTES" count CoachMemory.tsx
// derives from it) even though it never touched v2_coach_notes through this
// client.

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

const COACH_NOTES_KEY = ['v2_coachNotes']

export function useCurateMemory() {
  return useMutation({
    mutationFn: curateMemory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COACH_MEMORY_KEY })
      queryClient.invalidateQueries({ queryKey: COACH_NOTES_KEY })
    },
  })
}
