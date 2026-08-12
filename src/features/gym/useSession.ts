import { useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { db } from '../../lib/db'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useOfflineStore } from '../offline/offlineStore'
import type { Session, SetLog, WeightUnit } from '../../types'
import {
  fetchSessionsInRange,
  fetchSession,
  createSession,
  completeSession,
  reopenSession,
  updateSessionNote,
  skipSession,
  skipMissedSession,
  logSet,
  updateSetLog,
  deleteSetLog,
  fetchLastSessionLogs,
  fetchReferenceSessions,
  type ReferenceSession,
} from './sessionService'
import { groupSetLogs } from './setGroupLogic'
import { deriveCompletedAt } from './sessionCompletion'

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
        // Cache in Dexie so offline sessions can pre-fill weights.
        // fetchLastSessionLogs only ever returns logs from a completed session.
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
              stageIndex: log.stageIndex,
              isWarmup: log.isWarmup,
              setSeconds: log.setSeconds,
              enteredUnit: log.enteredUnit,
              isSkipped: log.isSkipped,
              loggedAt: log.loggedAt,
              restSeconds: log.restSeconds,
              sessionStatus: 'completed',
            }),
          ),
        )
        return logs
      } catch {
        // Offline fallback — most recent COMPLETED session that isn't the
        // one currently being logged into (excluded before picking "most
        // recent", not after — a same-session in-progress log would
        // otherwise win on loggedAt and then get filtered to nothing).
        const cached = await db.set_logs
          .where('exerciseId')
          .equals(exerciseId)
          .sortBy('loggedAt')

        const eligible = cached.filter(
          (l) => l.sessionStatus === 'completed' && l.sessionId !== (currentSessionId ?? ''),
        )
        if (!eligible.length) return []

        const lastSessionId = eligible[eligible.length - 1].sessionId
        return eligible
          .filter((l) => l.sessionId === lastSessionId)
          .sort((a, b) => a.setNumber - b.setNumber)
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
              stageIndex: l.stageIndex ?? 0,
              isWarmup: l.isWarmup ?? false,
              setSeconds: l.setSeconds ?? null,
              enteredUnit: (l.enteredUnit ?? null) as SetLog['enteredUnit'],
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

// Session-first, batched across every exercise in a workout day (v3 §2.3) —
// one call per GymSession/SessionPreview, not one per exercise card. Feeds
// the two-slot reference resolver (referenceLogic.ts): callers slice the
// returned map per exerciseId and pass that exercise's ReferenceSession[]
// straight into ExerciseReference.
export function useExerciseReferenceSessions(
  workoutDayId: string,
  exerciseIds: string[],
  currentSessionId: string | null,
): { data: Map<string, ReferenceSession[]>; isLoading: boolean } {
  const { user } = useAuth()
  const exerciseIdsKey = [...exerciseIds].sort().join(',')

  const query = useQuery({
    queryKey: ['v2_referenceSessions', workoutDayId, exerciseIdsKey, currentSessionId],
    queryFn: async () => {
      try {
        return await fetchReferenceSessions(user!.id, workoutDayId, exerciseIds, currentSessionId)
      } catch {
        // Offline fallback — same shape, sourced from Dexie (populated by
        // primeOfflineCache's session-first cache write) instead of
        // Supabase. `workoutDayId` isn't its own Dexie index, so narrow via
        // the indexed `status` field first, then filter — cheap at this
        // app's single-user scale.
        const completedCached = await db.sessions.where('status').equals('completed').toArray()
        const eligible = completedCached.filter(
          (s) => s.workoutDayId === workoutDayId && s.id !== (currentSessionId ?? ''),
        )
        if (eligible.length === 0) return new Map<string, ReferenceSession[]>()

        const sessionIds = new Set(eligible.map((s) => s.id))
        const dateBySessionId = new Map(eligible.map((s) => [s.id, s.date]))
        const completedAtBySessionId = new Map(eligible.map((s) => [s.id, s.completedAt]))

        const cachedLogs = await db.set_logs.where('exerciseId').anyOf(exerciseIds).toArray()

        const byExercise = new Map<string, Map<string, SetLog[]>>()
        for (const l of cachedLogs) {
          if (!sessionIds.has(l.sessionId)) continue
          const setLog: SetLog = {
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
            stageIndex: l.stageIndex ?? 0,
            isWarmup: l.isWarmup ?? false,
            setSeconds: l.setSeconds ?? null,
            enteredUnit: (l.enteredUnit ?? null) as SetLog['enteredUnit'],
            isSkipped: l.isSkipped,
            loggedAt: l.loggedAt,
            restSeconds: l.restSeconds,
          }
          let bySession = byExercise.get(l.exerciseId)
          if (!bySession) {
            bySession = new Map()
            byExercise.set(l.exerciseId, bySession)
          }
          const list = bySession.get(l.sessionId)
          if (list) list.push(setLog)
          else bySession.set(l.sessionId, [setLog])
        }

        const result = new Map<string, ReferenceSession[]>()
        for (const [exerciseId, bySession] of byExercise) {
          const refSessions: ReferenceSession[] = [...bySession.entries()]
            .map(([sessionId, logs]) => ({
              sessionId,
              date: dateBySessionId.get(sessionId)!,
              completedAt: completedAtBySessionId.get(sessionId) ?? null,
              logs: groupSetLogs([...logs].sort((a, b) => a.setNumber - b.setNumber)),
            }))
            .sort((a, b) => b.date.localeCompare(a.date))
          result.set(exerciseId, refSessions)
        }
        return result
      }
    },
    // No staleTime override, unlike the sibling useLastSessionLogs — this
    // inherits the app-wide 5-minute default (queryClient.ts) so a session
    // completing elsewhere is reflected within a bounded window even without
    // every possible mutation explicitly invalidating this key. See
    // useCompleteSession's onSuccess below for the one mutation that also
    // invalidates it directly, for the common case (completing a session,
    // then immediately re-previewing the same workout day).
    enabled: !!user && !!workoutDayId && exerciseIds.length > 0,
    networkMode: 'offlineFirst',
  })

  return { data: query.data ?? new Map(), isLoading: query.isLoading }
}

// ─── Mutations ────────────────────────────────────────────────────────────────

// Finds a session already sitting in the TanStack cache — used to reconstruct
// a well-formed offline upsert row even when we only have an id + a status
// change (completing/skipping a session that may itself still be unsynced).
function findCachedSession(id: string): Session | undefined {
  const single = queryClient.getQueryData<Session>(['v2_session', id])
  if (single) return single
  return queryClient
    .getQueriesData<Session[]>({ queryKey: ['v2_sessions'] })
    .flatMap(([, data]) => data ?? [])
    .find((s) => s.id === id)
}

function cachedSessionToDbRow(cached: Session) {
  return {
    user_id: cached.userId,
    mesocycle_id: cached.mesocycleId,
    week_plan_id: cached.weekPlanId,
    workout_day_id: cached.workoutDayId,
    date: cached.date,
    started_at: cached.startedAt,
    created_at: cached.createdAt,
  }
}

export function useCreateSession() {
  const { user } = useAuth()
  const isOnline = useOnlineStatus()
  const addPending = useOfflineStore((s) => s.addPending)

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({
      mesoId,
      weekPlanId,
      workoutDayId,
      date,
    }: {
      mesoId: string
      weekPlanId: string | null
      workoutDayId: string
      date: string
    }) => {
      if (!isOnline) {
        const id = crypto.randomUUID()
        const startedAt = new Date().toISOString()
        const session: Session = {
          id,
          userId: user!.id,
          mesocycleId: mesoId,
          weekPlanId,
          workoutDayId,
          date,
          status: 'in_progress',
          note: null,
          startedAt,
          completedAt: null,
          createdAt: startedAt,
          setLogs: [],
        }

        await db.sessions.put({
          id,
          userId: user!.id,
          date,
          status: 'in_progress',
          mesocycleId: mesoId,
          weekPlanId,
          workoutDayId,
          note: null,
          startedAt,
          completedAt: null,
        })

        await db.sync_queue.add({
          table: 'v2_sessions',
          operation: 'upsert',
          payload: {
            id,
            user_id: user!.id,
            mesocycle_id: mesoId,
            week_plan_id: weekPlanId,
            workout_day_id: workoutDayId,
            date,
            status: 'in_progress',
            started_at: startedAt,
          },
          createdAt: startedAt,
        })

        addPending(id)
        return session
      }

      return createSession(user!.id, mesoId, weekPlanId, workoutDayId, date)
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['v2_session', session.id], session)
      queryClient.setQueriesData(
        { queryKey: ['v2_sessions'] },
        (old: Session[] | undefined) => (old ? [...old, session] : old),
      )
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
  })
}

export function useCompleteSession() {
  const isOnline = useOnlineStatus()
  const addPending = useOfflineStore((s) => s.addPending)

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, note }: { id: string; note: string | null }) => {
      if (!isOnline) {
        // completed_at derived the same way the online path derives it
        // (deriveCompletedAt, sessionCompletion.ts) — from this session's
        // own cached set_logs, not wall-clock time. Real, confirmed gap in
        // this specific path (not silently assumed correct): the Dexie
        // set_logs cache only ever gets rows written to it by useLogSet's
        // *offline* branch — the online branch (the common case) never
        // writes to Dexie at all, and primeOfflineCache explicitly excludes
        // the current session (.neq('id', sessionId), it's priming the
        // *reference* cache for other sessions). So a session logged partly
        // or fully online, then completed offline with zero further offline
        // logs, has nothing here to derive from and correctly falls back to
        // null ("unavailable") rather than a wrong value — never
        // re-introduces the original inflated-duration bug, but is a real,
        // narrower fix than the online path gets. See CONTEXT.md.
        // createdAt (the sync_queue item's own timestamp, used for FIFO
        // replay ordering in useSyncQueue.ts) is deliberately real wall-clock
        // time regardless — it answers "when was this queued", a different
        // question from "what should this session's completed_at be", and
        // must never be null the way completedAt now legitimately can be.
        const now = new Date().toISOString()
        const cachedLogs = await db.set_logs.where('sessionId').equals(id).toArray()
        const completedAt = deriveCompletedAt(cachedLogs.map((l) => ({ loggedAt: l.loggedAt })))
        const cached = findCachedSession(id)
        await db.sync_queue.add({
          table: 'v2_sessions',
          operation: 'upsert',
          payload: {
            id,
            ...(cached ? cachedSessionToDbRow(cached) : {}),
            status: 'completed',
            completed_at: completedAt,
            note,
          },
          createdAt: now,
        })
        addPending(id)
        return
      }
      return completeSession(id, note)
    },
    onSuccess: (_, { id }) => {
      queryClient.setQueryData(['v2_session', id], (old: Session | undefined) =>
        old ? { ...old, status: 'completed' as const } : old,
      )
      queryClient.setQueriesData(
        { queryKey: ['v2_sessions'] },
        (old: Session[] | undefined) =>
          old?.map((s) => (s.id === id ? { ...s, status: 'completed' as const } : s)),
      )
      queryClient.invalidateQueries({ queryKey: ['v2_session', id] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
      // Completing a session changes history and progress data too — without
      // this those screens keep showing pre-completion state until refetched
      // for an unrelated reason.
      queryClient.invalidateQueries({ queryKey: ['v2_history'] })
      queryClient.invalidateQueries({ queryKey: ['v2_exerciseProgress'] })
      queryClient.invalidateQueries({ queryKey: ['v2_mesoProgress'] })
      // Found by adversarial review (2026-08-12): the position-matched
      // headline is keyed on the *resolved* session pair
      // (['v2_positionMatchedHeadline', exerciseId, firstSessionId,
      // lastSessionId]), which stays identical when a session is reopened,
      // edited, and re-completed without changing which two sessions get
      // picked — so without this it kept serving the pre-edit percentage
      // for up to staleTime even though v2_exerciseProgress (the chart,
      // the last-5-sessions list) had already refreshed correctly above.
      queryClient.invalidateQueries({ queryKey: ['v2_positionMatchedHeadline'] })
      // And the reference panel — SessionPreview always queries this with
      // currentSessionId=null, so its cache key doesn't change between
      // visits to the same workout day; without this, completing a session
      // and immediately re-previewing that same workout day could still show
      // the pre-completion LAST WEEK/THIS WEEK/LAST TIME state (found via
      // adversarial review, Phase 3.3).
      queryClient.invalidateQueries({ queryKey: ['v2_referenceSessions'] })
    },
  })
}

export function useReopenSession() {
  return useMutation({
    mutationFn: (id: string) => reopenSession(id),
    // Patches the cache with the real new startedAt immediately, same
    // pattern as useCompleteSession above — without this (found by
    // adversarial review), GymSession reads this exact query key
    // (staleTime 0, but still cache-first on mount) straight into
    // useSessionDuration with no freshness/status guard, so it could render
    // at least one frame — longer on a slow connection — showing the stale
    // pre-reopen session (old startedAt, status 'completed'), flashing the
    // same large bogus duration this whole fix exists to eliminate.
    onSuccess: ({ startedAt }, id) => {
      queryClient.setQueryData(['v2_session', id], (old: Session | undefined) =>
        old ? { ...old, status: 'in_progress' as const, completedAt: null, startedAt } : old,
      )
      queryClient.setQueriesData(
        { queryKey: ['v2_sessions'] },
        (old: Session[] | undefined) =>
          old?.map((s) =>
            s.id === id ? { ...s, status: 'in_progress' as const, completedAt: null, startedAt } : s,
          ),
      )
      queryClient.invalidateQueries({ queryKey: ['v2_session', id] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
  })
}

// Patches the note directly — the completed-state Today screen's "edit note"
// action (SPEC §4.3). Deliberately does not reopen the session or go through
// useCompleteSession; status is untouched. Online-only for now, same as
// useUpdateSetLog (a per-field edit, not a session status transition — those
// are the mutations that get full offline sync_queue support).
export function useUpdateSessionNote() {
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) => updateSessionNote(id, note),
    onMutate: async ({ id, note }) => {
      const qk = ['v2_session', id] as const
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: Session | undefined) => (old ? { ...old, note } : old))
      queryClient.setQueriesData(
        { queryKey: ['v2_sessions'] },
        (old: Session[] | undefined) => old?.map((s) => (s.id === id ? { ...s, note } : s)),
      )
      return { prev }
    },
    onError: (_, { id }, ctx) => queryClient.setQueryData(['v2_session', id], ctx?.prev),
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['v2_session', id] })
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
  })
}

export function useSkipSession() {
  const isOnline = useOnlineStatus()
  const addPending = useOfflineStore((s) => s.addPending)

  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      if (!isOnline) {
        const cached = findCachedSession(id)
        const now = new Date().toISOString()
        await db.sync_queue.add({
          table: 'v2_sessions',
          operation: 'upsert',
          payload: {
            id,
            ...(cached ? cachedSessionToDbRow(cached) : {}),
            status: 'skipped',
          },
          createdAt: now,
        })
        addPending(id)
        return
      }
      return skipSession(id)
    },
    onSuccess: (_, id) => {
      queryClient.setQueryData(['v2_session', id], (old: Session | undefined) =>
        old ? { ...old, status: 'skipped' as const } : old,
      )
      queryClient.setQueriesData(
        { queryKey: ['v2_sessions'] },
        (old: Session[] | undefined) =>
          old?.map((s) => (s.id === id ? { ...s, status: 'skipped' as const } : s)),
      )
      queryClient.invalidateQueries({ queryKey: ['v2_sessions'] })
    },
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
      stageIndex: number
      isSkipped: boolean
      restSeconds: number | null
      setSeconds: number | null
      enteredUnit: WeightUnit | null
    }) => {
      // Same id for the optimistic entry (set in onMutate, which always runs
      // before this) and whatever actually gets written — online or
      // offline. Phase 3.1's ADD STAGE passes a head's id directly as the
      // next stage's parentSetId (setGroupLogic.ts) the moment the head
      // renders as logged, which can be before its own insert has actually
      // round-tripped. If the online insert let Postgres assign its own id
      // (the pre-3.1 behaviour), a stage logged in that window would carry
      // a parentSetId that never matches any real row — found via
      // independent review. Fixing the id at onMutate time and using it for
      // the real write too (both branches) makes it correct from the first
      // render, not just eventually consistent.
      const id = offlineTempIdRef.current ?? crypto.randomUUID()

      if (!isOnline) {
        // Plain UUID — v2_set_logs.id is a Postgres uuid column, so no prefix.
        // "Pending" state is tracked separately via useOfflineStore.pendingIds.
        const tempId = id
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
          stageIndex: params.stageIndex,
          isWarmup: false,
          setSeconds: params.setSeconds,
          enteredUnit: params.enteredUnit,
          isSkipped: params.isSkipped,
          loggedAt,
          restSeconds: params.restSeconds,
          // The session currently being logged into is always in progress —
          // must not be mistaken for a completed "last session" reference.
          sessionStatus: 'in_progress',
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
            stage_index: params.stageIndex,
            is_skipped: params.isSkipped,
            logged_at: loggedAt,
            rest_seconds: params.restSeconds,
            set_seconds: params.setSeconds,
            entered_unit: params.enteredUnit,
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
          stageIndex: params.stageIndex,
          isWarmup: false,
          setSeconds: params.setSeconds,
          enteredUnit: params.enteredUnit,
          isSkipped: params.isSkipped,
          loggedAt,
          restSeconds: params.restSeconds,
        } satisfies SetLog
      }

      return logSet({ id, userId: user!.id, sessionId, ...params })
    },

    onMutate: async (params) => {
      // Set before the first await — this hook instance is shared across
      // every exercise in the session, so offlineTempIdRef is a single ref
      // multiple in-flight mutations could otherwise race on. Assigning it
      // synchronously, before yielding to cancelQueries, narrows that
      // window as far as this function can on its own.
      const tempId = crypto.randomUUID()
      offlineTempIdRef.current = tempId

      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)

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
        stageIndex: params.stageIndex,
        isWarmup: false,
        setSeconds: params.setSeconds,
        enteredUnit: params.enteredUnit,
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

type SetLogChanges = {
  weight?: number | null
  reps?: number | null
  rir?: number | null
  note?: string | null
  setNumber?: number
}

export function useUpdateSetLog(sessionId: string) {
  const qk = ['v2_session', sessionId] as const

  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: SetLogChanges }) =>
      updateSetLog(id, changes),
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: Session | undefined) => {
        if (!old) return old
        return {
          ...old,
          setLogs: old.setLogs?.map((l) => (l.id === id ? { ...l, ...changes } : l)),
        }
      })
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useDeleteSetLog(sessionId: string) {
  const qk = ['v2_session', sessionId] as const

  return useMutation({
    // The cascade guard (ExerciseCard.tsx's handleDeleteHead) sequentially
    // awaits mutateAsync per row and relies on a stalled delete rejecting
    // (its catch block is how a partial cascade fails safe). Under the
    // default networkMode 'online', TanStack Query pauses an offline
    // mutation indefinitely instead of running it — the promise would never
    // settle, and the cascade would hang forever rather than fail safely.
    // 'always' makes it attempt the request regardless of connectivity, so
    // a real offline attempt fails fast with a normal network error instead.
    networkMode: 'always',
    mutationFn: (id: string) => deleteSetLog(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: Session | undefined) => {
        if (!old) return old
        return { ...old, setLogs: old.setLogs?.filter((l) => l.id !== id) }
      })
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}
