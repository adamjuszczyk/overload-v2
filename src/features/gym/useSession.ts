import { useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { db } from '../../lib/db'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useOfflineStore } from '../offline/offlineStore'
import type { Session, SetLog } from '../../types'
import {
  fetchSessionsInRange,
  fetchSession,
  createSession,
  completeSession,
  reopenSession,
  skipSession,
  skipMissedSession,
  logSet,
  fetchLastSessionLogs,
} from './sessionService'

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useSessionsInRange(startDate: string, endDate: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_sessions', startDate, endDate],
    queryFn: () => fetchSessionsInRange(startDate, endDate),
    enabled: !!user && !!startDate && !!endDate,
  })
}

export function useActiveSession(sessionId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_session', sessionId],
    queryFn: () => fetchSession(sessionId!),
    enabled: !!user && !!sessionId,
    staleTime: 0,
  })
}

export function useLastSessionLogs(exerciseId: string, currentSessionId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_lastSetLogs', exerciseId, currentSessionId],
    queryFn: async () => {
      try {
        const logs = await fetchLastSessionLogs(user!.id, exerciseId, currentSessionId)
        // Cache in Dexie so offline sessions can pre-fill weights
        await Promise.all(
          logs.map((log) =>
            db.set_logs.put({
              id: log.id,
              sessionId: log.sessionId,
              exerciseId: log.exerciseId,
              weekPlanSetId: log.weekPlanSetId,
              setNumber: log.setNumber,
              weight: log.weight,
              reps: log.reps,
              rir: log.rir,
              note: log.note,
              isDropset: log.isDropset,
              parentSetId: log.parentSetId,
              isSkipped: log.isSkipped,
              loggedAt: log.loggedAt,
              restSeconds: log.restSeconds,
            }),
          ),
        )
        return logs
      } catch {
        // Offline fallback — return most recent cached logs for this exercise
        const cached = await db.set_logs
          .where('exerciseId')
          .equals(exerciseId)
          .sortBy('loggedAt')

        if (!cached.length) return []
        // Most recent session (last item after ascending sort)
        const lastSessionId = cached[cached.length - 1].sessionId
        return cached
          .filter((l) => l.sessionId === lastSessionId && l.sessionId !== (currentSessionId ?? ''))
          .map(
            (l): SetLog => ({
              id: l.id,
              userId: user!.id,
              sessionId: l.sessionId,
              exerciseId: l.exerciseId,
              weekPlanSetId: l.weekPlanSetId,
              setNumber: l.setNumber,
              weight: l.weight,
              reps: l.reps,
              rir: l.rir,
              note: l.note,
              isDropset: l.isDropset,
              parentSetId: l.parentSetId,
              isSkipped: l.isSkipped,
              loggedAt: l.loggedAt,
              restSeconds: l.restSeconds,
            }),
          )
      }
    },
    enabled: !!user && !!exerciseId,
    staleTime: Infinity,
    networkMode: 'offlineFirst',
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSession() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      mesoId,
      weekPlanId,
      workoutDayId,
      date,
    }: {
      mesoId: string
      weekPlanId: string | null
      workoutDayId: string
      date: string
    }) => createSession(user!.id, mesoId, weekPlanId, workoutDayId, date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
  })
}

export function useCompleteSession() {
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) =>
      completeSession(id, note),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['v2_session', id] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
  })
}

export function useReopenSession() {
  return useMutation({
    mutationFn: (id: string) => reopenSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['v2_session', id] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
  })
}

export function useSkipSession() {
  return useMutation({
    mutationFn: (id: string) => skipSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2_sessions'] }),
  })
}

export function useSkipMissedSession() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      mesoId,
      weekPlanId,
      workoutDayId,
      date,
      existingSessionId,
    }: {
      mesoId: string
      weekPlanId: string | null
      workoutDayId: string
      date: string
      existingSessionId: string | null
    }) => skipMissedSession(user!.id, mesoId, weekPlanId, workoutDayId, date, existingSessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2_sessions'] }),
  })
}

export function useLogSet(sessionId: string) {
  const { user } = useAuth()
  const isOnline = useOnlineStatus()
  const addPending = useOfflineStore((s) => s.addPending)
  const qk = ['v2_session', sessionId] as const

  // Shared tempId so onMutate and mutationFn produce the same offline ID
  const offlineTempIdRef = useRef<string | null>(null)

  return useMutation({
    networkMode: 'always',

    mutationFn: async (params: {
      exerciseId: string
      weekPlanSetId: string | null
      setNumber: number
      weight: number | null
      reps: number | null
      rir: number | null
      note: string | null
      isDropset: boolean
      parentSetId: string | null
      isSkipped: boolean
      restSeconds: number | null
    }) => {
      if (!isOnline) {
        const tempId = offlineTempIdRef.current ?? `temp_${crypto.randomUUID()}`
        const loggedAt = new Date().toISOString()

        await db.set_logs.put({
          id: tempId,
          sessionId,
          exerciseId: params.exerciseId,
          weekPlanSetId: params.weekPlanSetId,
          setNumber: params.setNumber,
          weight: params.weight,
          reps: params.reps,
          rir: params.rir,
          note: params.note,
          isDropset: params.isDropset,
          parentSetId: params.parentSetId,
          isSkipped: params.isSkipped,
          loggedAt,
          restSeconds: params.restSeconds,
        })

        await db.sync_queue.add({
          table: 'v2_set_logs',
          operation: 'upsert',
          payload: {
            id: tempId,
            user_id: user!.id,
            session_id: sessionId,
            exercise_id: params.exerciseId,
            week_plan_set_id: params.weekPlanSetId,
            set_number: params.setNumber,
            weight: params.weight,
            reps: params.reps,
            rir: params.rir,
            note: params.note,
            is_dropset: params.isDropset,
            parent_set_id: params.parentSetId,
            is_skipped: params.isSkipped,
            logged_at: loggedAt,
            rest_seconds: params.restSeconds,
          },
          createdAt: loggedAt,
        })

        addPending(tempId)

        return {
          id: tempId,
          userId: user!.id,
          sessionId,
          exerciseId: params.exerciseId,
          weekPlanSetId: params.weekPlanSetId,
          setNumber: params.setNumber,
          weight: params.weight,
          reps: params.reps,
          rir: params.rir,
          note: params.note,
          isDropset: params.isDropset,
          parentSetId: params.parentSetId,
          isSkipped: params.isSkipped,
          loggedAt,
          restSeconds: params.restSeconds,
        } satisfies SetLog
      }

      return logSet({ userId: user!.id, sessionId, ...params })
    },

    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)

      const tempId = `temp_${crypto.randomUUID()}`
      offlineTempIdRef.current = tempId

      const optimisticLog: SetLog = {
        id: tempId,
        userId: user!.id,
        sessionId,
        exerciseId: params.exerciseId,
        weekPlanSetId: params.weekPlanSetId,
        setNumber: params.setNumber,
        weight: params.weight,
        reps: params.reps,
        rir: params.rir,
        note: params.note,
        isDropset: params.isDropset,
        parentSetId: params.parentSetId,
        isSkipped: params.isSkipped,
        loggedAt: new Date().toISOString(),
        restSeconds: params.restSeconds,
      }

      queryClient.setQueryData(qk, (old: Session | undefined) => {
        if (!old) return old
        return { ...old, setLogs: [...(old.setLogs ?? []), optimisticLog] }
      })

      return { prev }
    },

    onError: (_, __, ctx) => {
      queryClient.setQueryData(qk, ctx?.prev)
      offlineTempIdRef.current = null
    },

    onSettled: () => {
      offlineTempIdRef.current = null
      // Only invalidate (re-fetch from Supabase) when online
      if (isOnline) queryClient.invalidateQueries({ queryKey: qk })
    },
  })
}
