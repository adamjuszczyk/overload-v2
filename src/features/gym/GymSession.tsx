import { useState, useEffect } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ProgramExercise, WorkoutDay, WeekPlan, WeekPlanSet, SetLog, WeightUnit, FormRating, Exercise } from '../../types'
import type { ReferenceSession } from './sessionService'
import {
  useActiveSession,
  useLogSet,
  useLastSessionLogs,
  useUpdateSetLog,
  useDeleteSetLog,
  useExerciseReferenceSessions,
} from './useSession'
import { useProgramExercises } from '../programs/usePrograms'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { db } from '../../lib/db'
import { primeOfflineCache } from '../offline/offlineCache'
import { isCoachUser } from '../coach/coachGate'
import ExerciseCard from './ExerciseCard'
import RestTimer from './RestTimer'
import { useRestTimerStore } from './restTimerStore'
import SessionComplete from './SessionComplete'
import WorkoutNotesSheet from './WorkoutNotesSheet'
import { useAutoFinishSession } from './useAutoFinishSession'
import { useSessionDuration } from './useSessionDuration'
import { useScrollToCurrentSet } from './useScrollToCurrentSet'
import { formatRestTime } from '../../lib/formatRestTime'

interface GymSessionProps {
  sessionId: string
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
}

// Wrapper that loads per-exercise history and renders ExerciseCard.
// Must be its own component so useLastSessionLogs can be called unconditionally.
function ExerciseSection({
  programExercise,
  plannedSets,
  allCurrentLogs,
  sessionId,
  referenceSessions,
  referenceLoading,
  referenceMesocycleId,
  referenceIsError,
  referenceIsFromCache,
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
  onSwap,
}: {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  allCurrentLogs: SetLog[]
  sessionId: string
  referenceSessions: ReferenceSession[]
  referenceLoading: boolean
  referenceMesocycleId: string | null
  referenceIsError: boolean
  referenceIsFromCache: boolean
  onRetryReference: () => void
  today: string
  onLog: (params: {
    exerciseId: string
    weekPlanSetId: string | null
    setNumber: number
    weight: number | null
    reps: number | null
    rir: number | null
    isDropset: boolean
    isSkipped: boolean
    restSeconds: number | null
    setSeconds: number | null
    enteredUnit: WeightUnit | null
    parentSetId: string | null
    stageIndex: number
    formRating: FormRating | null
  }) => Promise<SetLog>
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; note?: string | null; setNumber?: number; formRating?: FormRating | null }) => void
  onDeleteSet: (id: string) => Promise<void>
  onSwap: (exercise: Exercise) => void
}) {
  const { data: lastLogs = [], isLoading: lastLogsLoading } = useLastSessionLogs(
    programExercise.exerciseId,
    sessionId,
  )
  const currentLogs = allCurrentLogs.filter((l) => l.exerciseId === programExercise.exerciseId)

  return (
    <ExerciseCard
      programExercise={programExercise}
      plannedSets={plannedSets}
      currentLogs={currentLogs}
      lastLogs={lastLogs}
      lastLogsLoading={lastLogsLoading}
      referenceSessions={referenceSessions}
      referenceLoading={referenceLoading}
      referenceMesocycleId={referenceMesocycleId}
      referenceIsError={referenceIsError}
      referenceIsFromCache={referenceIsFromCache}
      onRetryReference={onRetryReference}
      today={today}
      onLog={onLog}
      onUpdateSet={onUpdateSet}
      onDeleteSet={onDeleteSet}
      onSwap={onSwap}
    />
  )
}

export default function GymSession({ sessionId, workoutDay, weekPlan, weekNumber, today }: GymSessionProps) {
  const [showComplete, setShowComplete] = useState(false)
  const [showNotesSheet, setShowNotesSheet] = useState(false)
  const [cachedExercises, setCachedExercises] = useState<ProgramExercise[]>([])
  // Swap exercise for this session only (SPEC v1.1 "Part C") — exercises
  // just chosen via a swap, before any set has been logged for them yet.
  // Seeded here so the new exercise's card appears the instant a swap is
  // confirmed; once at least one set is actually logged for it, the derived
  // list below (from allCurrentLogs) picks it up too, so it survives a
  // refresh the same way an "extra set" (ADD SET) already does — no new
  // table, no new persisted flag, same "derive extra-ness from what's
  // actually logged" precedent SetGroup's weekPlanSetId-null sets already
  // established one level down.
  const [pendingSwapExercises, setPendingSwapExercises] = useState<Exercise[]>([])

  const { user } = useAuth()
  const isOnline = useOnlineStatus()

  const { data: session } = useActiveSession(sessionId)
  const { data: programExercises = [] } = useProgramExercises(workoutDay.id)
  const logSet = useLogSet(sessionId)
  const updateSetLog = useUpdateSetLog(sessionId)
  const deleteSetLog = useDeleteSetLog(sessionId)

  useAutoFinishSession(session, weekPlan)
  const duration = useSessionDuration(session)

  // Prime the Dexie cache once exercises are loaded and we're online
  useEffect(() => {
    if (!isOnline || !user || programExercises.length === 0) return
    primeOfflineCache({ userId: user.id, sessionId, workoutDay, weekPlan, programExercises }).catch(
      () => {}, // non-critical — best effort
    )
  }, [isOnline, user?.id, sessionId, workoutDay.id, programExercises.length])

  // When offline and Supabase returns nothing, fall back to Dexie
  useEffect(() => {
    if (isOnline || programExercises.length > 0) return
    db.workout_days.get(workoutDay.id).then((cached) => {
      if (cached?.exercises) setCachedExercises(cached.exercises as ProgramExercise[])
    })
  }, [isOnline, programExercises.length, workoutDay.id])

  const allCurrentLogs = session?.setLogs ?? []
  const activeExercises = programExercises.length > 0 ? programExercises : cachedExercises
  const sortedExercises = [...activeExercises].sort((a, b) => a.position - b.position)

  // Extra, unplanned exercises added via swap (SPEC v1.1 "Part C") — the
  // exercise-level equivalent of an "extra set": never written to
  // v2_program_exercises, so next week's plan is untouched by construction
  // (weekPlanService.ts's copy-forward only ever reads v2_week_plans/
  // v2_week_plan_sets, never v2_set_logs). Union of "chosen this session,
  // not logged yet" (pendingSwapExercises) and "already has at least one
  // real log this session" (derived from allCurrentLogs, keyed by
  // exerciseId so a page refresh recovers it without pendingSwapExercises)
  // — deduplicated by exercise id, since the same exercise naturally moves
  // from the first bucket into the second the moment its first set lands.
  const templateExerciseIds = new Set(sortedExercises.map((pe) => pe.exerciseId))
  const extraExerciseById = new Map<string, Exercise>()
  for (const ex of pendingSwapExercises) extraExerciseById.set(ex.id, ex)
  for (const log of allCurrentLogs) {
    if (log.exercise && !templateExerciseIds.has(log.exerciseId) && !extraExerciseById.has(log.exerciseId)) {
      extraExerciseById.set(log.exerciseId, log.exercise)
    }
  }
  const extraExercises = [...extraExerciseById.values()]

  const { containerRef: exercisesContainerRef, direction: scrollToCurrentSetDirection, scrollToCurrentSet } =
    useScrollToCurrentSet()

  // Session-first, batched once for every exercise in this workout day (v3
  // §2.3) — not one query per exercise card. Must run unconditionally (this
  // is a hook), so it's placed before the showComplete early return below,
  // fed by activeExercises so it also works from the offline-cached
  // exercise list. Extra (swapped-in) exercise ids are included too, so a
  // real prior occurrence of one still resolves a real reference instead of
  // silently falling back to first_time just because the id was never
  // asked about.
  const {
    data: referenceSessionsByExercise,
    isLoading: referenceLoading,
    isError: referenceIsError,
    isFromCache: referenceIsFromCache,
    retry: retryReference,
  } = useExerciseReferenceSessions(
    workoutDay.id,
    [...activeExercises.map((pe) => pe.exerciseId), ...extraExercises.map((ex) => ex.id)],
    sessionId,
  )

  if (showComplete) {
    return <SessionComplete sessionId={sessionId} onBack={() => setShowComplete(false)} />
  }

  // Shared by every ExerciseSection below, template and extra alike — same
  // mutations, same session, only which exercise differs.
  function handleLog(params: Omit<Parameters<typeof logSet.mutateAsync>[0], 'note'>) {
    // Phase 3.1 retires AUDIT M5's inference heuristic on this write path:
    // ExerciseCard/SetGroup's ADD STAGE tap already knows which head it
    // belongs to and passes parentSetId (and stageIndex) directly — no more
    // guessing from ordering. See CONTEXT.md's "ADD STAGE / inference-
    // heuristic limitation" note for why this was inference-only before
    // this phase. 007's historical backfill keeps using inference — it has
    // no other option for data written before this shipped.
    //
    // mutateAsync (not mutate) so ExerciseCard can await the resulting real
    // id — needed both for "skip whole exercise" to chain a head's real id
    // into its stages' parentSetId, and to anchor the inline rest timer
    // (SPEC §4.3) to the specific row that was just logged.
    return logSet.mutateAsync({ ...params, note: null }).then((log) => {
      useRestTimerStore.getState().setAnchor(log.id)
      return log
    })
  }
  function handleUpdateSet(id: string, changes: Parameters<typeof updateSetLog.mutate>[0]['changes']) {
    updateSetLog.mutate({ id, changes })
  }
  function handleDeleteSet(id: string) {
    return deleteSetLog.mutateAsync(id)
  }
  // Swap exercise for this session only (SPEC v1.1 "Part C") — the original
  // exercise's card has already skipped its own remaining sets by the time
  // this fires (ExerciseCard.tsx's handleConfirmSwap does that first); this
  // just registers the chosen replacement so it renders as an extra card
  // below. Guards against double-registering the same exercise id (e.g. two
  // different template exercises swapped to the same replacement).
  function handleSwap(exercise: Exercise) {
    setPendingSwapExercises((prev) => (prev.some((e) => e.id === exercise.id) ? prev : [...prev, exercise]))
  }

  return (
    <div className="pb-24">
      {/* Session header */}
      <div className="px-4 pt-8 pb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-xs font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {weekPlan?.isDeload ? 'DELOAD · ' : ''}WEEK {weekNumber}
          </p>
          <h1
            className="text-3xl font-black tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {workoutDay.name}
          </h1>
          <p
            className="mt-1 text-xs font-bold tracking-widest"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          >
            IN PROGRESS
          </p>
          <p
            className="mt-1 text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {formatRestTime(duration)}
          </p>
        </div>

        {/* "Notes for the coach" has no meaning without a coach — the one
            new coachGate.ts call site this initiative adds (SPEC §7,
            TASKS §2.9). Everything else Coach-related on this screen
            (form/energy/pump ratings) is ungated, first-class training
            data like RIR. */}
        {isCoachUser(user?.id) && (
          <button
            onClick={() => setShowNotesSheet(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest"
            style={{
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            NOTES
          </button>
        )}
      </div>

      {/* Rest timer */}
      <RestTimer />

      {/* Exercise cards */}
      <div className="px-4 space-y-4" ref={exercisesContainerRef}>
        {sortedExercises.map((pe) => {
          const plannedSets = (weekPlan?.sets ?? [])
            .filter((s) => s.programExerciseId === pe.id)
            .sort((a, b) => a.setNumber - b.setNumber)

          return (
            <ExerciseSection
              key={pe.id}
              programExercise={pe}
              plannedSets={plannedSets}
              allCurrentLogs={allCurrentLogs}
              sessionId={sessionId}
              referenceSessions={referenceSessionsByExercise.get(pe.exerciseId) ?? []}
              referenceLoading={referenceLoading}
              referenceMesocycleId={session?.mesocycleId ?? null}
              referenceIsError={referenceIsError}
              referenceIsFromCache={referenceIsFromCache}
              onRetryReference={retryReference}
              today={today}
              onLog={handleLog}
              onUpdateSet={handleUpdateSet}
              onDeleteSet={handleDeleteSet}
              onSwap={handleSwap}
            />
          )
        })}

        {/* Extra, unplanned exercises added via swap this session (SPEC
            v1.1 "Part C") — same synthetic-ProgramExercise-plus-empty-plan
            composition as any exercise with no plan attached; nothing in
            ExerciseCard/SetGroup needs to know this one didn't come from
            the day's template. */}
        {extraExercises.map((ex, i) => {
          const syntheticProgramExercise: ProgramExercise = {
            id: `extra-${ex.id}`,
            workoutDayId: workoutDay.id,
            userId: user?.id ?? '',
            exerciseId: ex.id,
            exercise: ex,
            position: sortedExercises.length + i,
            targetReps: null,
            weightUnit: null,
          }
          return (
            <ExerciseSection
              key={syntheticProgramExercise.id}
              programExercise={syntheticProgramExercise}
              plannedSets={[]}
              allCurrentLogs={allCurrentLogs}
              sessionId={sessionId}
              referenceSessions={referenceSessionsByExercise.get(ex.id) ?? []}
              referenceLoading={referenceLoading}
              referenceMesocycleId={session?.mesocycleId ?? null}
              referenceIsError={referenceIsError}
              referenceIsFromCache={referenceIsFromCache}
              onRetryReference={retryReference}
              today={today}
              onLog={handleLog}
              onUpdateSet={handleUpdateSet}
              onDeleteSet={handleDeleteSet}
              onSwap={handleSwap}
            />
          )
        })}
      </div>

      {/* Finish session */}
      <div className="px-4 mt-6">
        <button
          onClick={() => setShowComplete(true)}
          className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
          style={{
            border: '2px solid var(--border-strong)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          FINISH SESSION
        </button>
      </div>

      {/* Jump to the first unlogged set once it's scrolled out of view
          (post-launch fix, 2026-08-10) — e.g. after checking a reference
          panel or an earlier set further up the session. Arrow direction
          matches which way the set actually is (post-launch fix,
          2026-08-14) — up when it's scrolled above the viewport, down when
          below — instead of always pointing down regardless. */}
      {scrollToCurrentSetDirection && (
        <button
          onClick={scrollToCurrentSet}
          className="fixed left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full font-bold text-xs tracking-widest"
          style={{
            bottom: 'calc(96px + env(safe-area-inset-bottom))',
            padding: '10px 18px',
            backgroundColor: 'var(--accent)',
            color: 'var(--base)',
            fontFamily: 'var(--font-mono)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
            zIndex: 30,
          }}
        >
          {scrollToCurrentSetDirection === 'up' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          CURRENT SET
        </button>
      )}

      {showNotesSheet && (
        <WorkoutNotesSheet sessionId={sessionId} onClose={() => setShowNotesSheet(false)} />
      )}
    </div>
  )
}
