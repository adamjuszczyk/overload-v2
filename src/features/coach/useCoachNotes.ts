import { useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { db } from '../../lib/db'
import {
  fetchCoachNotes,
  createCoachNote,
  updateCoachNote,
  deleteCoachNote,
} from './coachNotesService'
import type { CoachNote } from '../../types'

// TanStack Query hooks for Coach Notes (COACH-PERSONALIZATION-TASKS.md §6
// step 13), following useCoachContext.ts's shape for the read/update/delete
// hooks: hoisted key constant, `enabled: !!user`, invalidate on success.
//
// useCreateCoachNote is the one exception — it needs to work while offline
// (the sidebar's whole reason for existing, TASKS §2.4/§2.6), so it follows
// useSession.ts's useLogSet pattern instead: a shared ref carries the same
// id from the optimistic onMutate entry into whichever branch actually
// writes it (Dexie + sync_queue offline, a real insert online), so the
// final result reconciles into the cache by id rather than needing a
// second lookup.

const COACH_NOTES_KEY = ['v2_coachNotes']

export function useCoachNotes() {
  const { user } = useAuth()
  return useQuery({
    queryKey: COACH_NOTES_KEY,
    queryFn: () => fetchCoachNotes(user!.id),
    enabled: !!user,
  })
}

export function useCreateCoachNote() {
  const { user } = useAuth()
  const isOnline = useOnlineStatus()
  const tempIdRef = useRef<string | null>(null)

  return useMutation({
    networkMode: 'always',

    mutationFn: async (params: { body: string; sessionId: string | null }) => {
      const id = tempIdRef.current ?? crypto.randomUUID()

      if (!isOnline) {
        const createdAt = new Date().toISOString()

        await db.sync_queue.add({
          table: 'v2_coach_notes',
          operation: 'upsert',
          payload: {
            id,
            user_id: user!.id,
            body: params.body,
            session_id: params.sessionId,
            created_at: createdAt,
          },
          createdAt,
        })

        return {
          id,
          userId: user!.id,
          body: params.body,
          sessionId: params.sessionId,
          curatedAt: null,
          createdAt,
        } satisfies CoachNote
      }

      return createCoachNote(user!.id, params.body, params.sessionId, id)
    },

    onMutate: async (params) => {
      const tempId = crypto.randomUUID()
      tempIdRef.current = tempId

      await queryClient.cancelQueries({ queryKey: COACH_NOTES_KEY })
      const prev = queryClient.getQueryData<CoachNote[]>(COACH_NOTES_KEY)

      const optimisticNote: CoachNote = {
        id: tempId,
        userId: user!.id,
        body: params.body,
        sessionId: params.sessionId,
        curatedAt: null,
        createdAt: new Date().toISOString(),
      }
      queryClient.setQueryData<CoachNote[]>(COACH_NOTES_KEY, (old) => [
        optimisticNote,
        ...(old ?? []),
      ])

      return { prev }
    },

    onError: (_err, _params, ctx) => {
      tempIdRef.current = null
      queryClient.setQueryData(COACH_NOTES_KEY, ctx?.prev)
    },

    onSuccess: (note) => {
      tempIdRef.current = null
      queryClient.setQueryData<CoachNote[]>(COACH_NOTES_KEY, (old) =>
        old ? old.map((n) => (n.id === note.id ? note : n)) : [note],
      )
    },
  })
}

export function useUpdateCoachNote() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => updateCoachNote(id, user!.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COACH_NOTES_KEY }),
  })
}

export function useDeleteCoachNote() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (id: string) => deleteCoachNote(id, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COACH_NOTES_KEY }),
  })
}
