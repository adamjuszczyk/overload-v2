import { useState, useEffect } from 'react'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import type { ProgramExercise, WorkoutDay, WeekPlan, WeekPlanSet, SetLog, WeightUnit, FormRating, Exercise } from '../../types'
import type { ReferenceSession, ExerciseSwap } from './sessionService'
import {
  useActiveSession,
  useLogSet,
  useLastSessionLogs,
  useUpdateSetLog,
  useDeleteSetLog,
  useExerciseReferenceSessions,
  useSessionSwaps,
  useRecordExerciseSwap,
} from './useSession'
import { useProgramExercises } from '../programs/usePrograms'
import { useExercises } from '../library/useExercises'
import { resolveReplacementExercise } from './exerciseSwapLogic'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { db } from '../../lib/db'
import { primeOfflineCache } from '../offline/offlineCache'
import { isCoachUser } from '../coach/coachGate'
import ExerciseCard from './ExerciseCard'
import SwapExerciseSheet from './SwapExerciseSheet'
import RestTimer from './RestTimer'
import { useRestTimerStore } from './restTimerStore'
import SessionComplete from './SessionComplete'
import WorkoutSidebarSheet from './WorkoutSidebarSheet'
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
  linkedExerciseIds = [],
  swappedFrom,
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
  // Position/presentation fix (2026-09-03) — for a card rendering in place
  // of a swapped-out slot, the original exercise's own logs (real sets
  // logged before the swap, plus the SKIPPED marks handleSkipExercise
  // wrote) still carry the ORIGINAL exercise's id, not this card's. Without
  // this, those rows would vanish from the planned section above (which
  // reads plannedSets — the original's plan) even though plannedSets itself
  // still expects them, and the card would wrongly look re-loggable.
  linkedExerciseIds?: string[]
  swappedFrom?: { exerciseName: string }
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
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; setNumber?: number; formRating?: FormRating | null }) => void
  onDeleteSet: (id: string) => Promise<void>
  onSwap: (exercise: Exercise, programExercise: ProgramExercise) => void
}) {
  const { data: lastLogs = [], isLoading: lastLogsLoading } = useLastSessionLogs(
    programExercise.exerciseId,
    sessionId,
  )
  const currentLogs = allCurrentLogs.filter(
    (l) => l.exerciseId === programExercise.exerciseId || linkedExerciseIds.includes(l.exerciseId),
  )

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
      swappedFrom={swappedFrom}
    />
  )
}

export default function GymSession({ sessionId, workoutDay, weekPlan, weekNumber, today }: GymSessionProps) {
  const [showComplete, setShowComplete] = useState(false)
  const [showSidebarSheet, setShowSidebarSheet] = useState(false)
  const [cachedExercises, setCachedExercises] = useState<ProgramExercise[]>([])
  // Add exercise mid-workout (2026-09-13) — a genuinely new, unplanned
  // exercise the user chose via "+ ADD EXERCISE" below, no original exercise
  // involved and nothing skipped/abandoned (so Mesocycle Analysis's Case B
  // swap-candidate detection, which requires an abandoned planned exercise,
  // structurally can't fire off this — see mesoAnalysisInput.ts §3.3).
  // Session-local only, same as the legacy-swap source folded into
  // extraExercises below: once its first set is logged, the log-driven
  // detection there picks up the same exercise id and keeps rendering its
  // card even across a refresh — this state only has to carry an
  // added-but-not-yet-logged card.
  const [addedExercises, setAddedExercises] = useState<Exercise[]>([])
  const [showAddExerciseSheet, setShowAddExerciseSheet] = useState(false)

  const { user } = useAuth()
  const isOnline = useOnlineStatus()

  const { data: session } = useActiveSession(sessionId)
  // Chunk 7 (TASKS.md "Each planned session owns its exercise list") — the
  // week's own v2_week_plan_exercises list when a week plan exists for this
  // session (weekPlan.exercises); the program's own exercises directly
  // otherwise (no week plan — same source this screen always read before
  // this chunk). fallbackProgramExercises keeps its own name/identity below
  // (the priming effect and the offline-cache-for-this-workout-day branch
  // both still key off the PROGRAM's own list, never the week-preferring
  // one — see each effect's own comment).
  const { data: fallbackProgramExercises = [] } = useProgramExercises(workoutDay.id)
  const programExercises = weekPlan?.exercises ?? fallbackProgramExercises
  // Swap exercise for this session only (SPEC v1.1 "Part C") — the
  // structural link (migration 025, 2026-09-03) between a swapped-out slot
  // and its replacement. Read here (not derived from local state) so a
  // swap survives a refresh even before the replacement's first set has
  // actually logged — useRecordExerciseSwap's onMutate below writes an
  // optimistic row straight into this same query's cache, so the instant
  // a swap is confirmed it's already reflected here too, no separate
  // "pending" bucket needed.
  const { data: sessionSwaps = [] } = useSessionSwaps(sessionId)
  const recordSwap = useRecordExerciseSwap(sessionId)
  // Full exercise objects, including archived ones — a swap's replacement
  // can only be rendered as a real ExerciseCard (muscle group, weight unit,
  // history link all come from here) via lookup, since migration 025 only
  // denormalises id/name onto the swap row itself, not the whole Exercise.
  // includeArchived so a since-archived replacement still resolves, since
  // this is display of what happened, not a fresh pick.
  const { data: allExercises = [] } = useExercises(true)
  const logSet = useLogSet(sessionId)
  const updateSetLog = useUpdateSetLog(sessionId)
  const deleteSetLog = useDeleteSetLog(sessionId)

  useAutoFinishSession(session, weekPlan)
  const duration = useSessionDuration(session)

  // Prime the Dexie cache once exercises are loaded and we're online. Keyed
  // off fallbackProgramExercises (the PROGRAM's own list), not the
  // week-preferring `programExercises` above — db.workout_days is cached by
  // workoutDayId alone, with no week number, so caching the week's own list
  // there would leak one week's exercises into every other week's offline
  // fallback. primeOfflineCache separately caches weekPlan.exercises onto
  // the week-scoped cache entry (db.week_plans, offlineCache.ts) when a
  // week plan exists — this gating condition and dependency array are
  // otherwise unchanged from before this chunk (fallbackProgramExercises
  // ≡ the pre-chunk-7 `programExercises`).
  useEffect(() => {
    if (!isOnline || !user || fallbackProgramExercises.length === 0) return
    primeOfflineCache({
      userId: user.id,
      sessionId,
      workoutDay,
      weekPlan,
      programExercises: fallbackProgramExercises,
    }).catch(() => {}) // non-critical — best effort
  }, [isOnline, user?.id, sessionId, workoutDay.id, fallbackProgramExercises.length])

  // When offline and Supabase returns nothing, fall back to Dexie — the
  // cached week plan's own exercise list first (same week-preferring order
  // as the online branch above), the cached workout day's program
  // exercises otherwise (no week plan, or nothing cached for it yet).
  useEffect(() => {
    if (isOnline || programExercises.length > 0) return
    const fromWorkoutDayCache = () =>
      db.workout_days.get(workoutDay.id).then((cached) => {
        if (cached?.exercises) setCachedExercises(cached.exercises as ProgramExercise[])
      })
    if (weekPlan) {
      db.week_plans.get(weekPlan.id).then((cachedPlan) => {
        const cachedPlanExercises = cachedPlan?.exercises as ProgramExercise[] | undefined
        if (cachedPlanExercises && cachedPlanExercises.length > 0) setCachedExercises(cachedPlanExercises)
        else fromWorkoutDayCache()
      })
      return
    }
    fromWorkoutDayCache()
  }, [isOnline, programExercises.length, workoutDay.id, weekPlan?.id])

  const allCurrentLogs = session?.setLogs ?? []
  const activeExercises = programExercises.length > 0 ? programExercises : cachedExercises
  const sortedExercises = [...activeExercises].sort((a, b) => a.position - b.position)

  // Swap exercise for this session only (SPEC v1.1 "Part C") — position/
  // presentation fix, 2026-09-03. Keyed by program_exercise_id (the "slot"
  // GymSession itself renders one card per) so the replacement can render
  // in the original's own position below instead of appended after every
  // other exercise, as one merged card instead of two separate visible
  // entries (ExerciseCard.tsx's swappedFrom prop) — see migration 025's own
  // header for the full reasoning.
  const swapByProgramExerciseId = new Map<string, ExerciseSwap>()
  for (const swap of sessionSwaps) {
    if (swap.programExerciseId) swapByProgramExerciseId.set(swap.programExerciseId, swap)
  }

  // Extra, unplanned exercise cards — no plan slot, rendered with
  // plannedSets: []. Two sources feed this same list, deduped by exercise
  // id since both render identically:
  //
  // 1. Legacy fallback: a swap confirmed before migration 025 existed (e.g.
  //    the real 2026-08-27 and 2026-09-03 sessions) has real logs for its
  //    replacement exercise but no v2_session_exercise_swaps row to key the
  //    merged-card rendering off. Rendered the old way — its own card,
  //    appended after the template — purely so reopening one of those
  //    specific sessions still shows the replacement at all; every swap from
  //    here forward goes through the recorded, position-correct path above
  //    instead. Discovered from real logs (log.exercise), so it only ever
  //    appears once at least one set has actually been logged.
  // 2. This session's own "+ ADD EXERCISE" additions (addedExercises state
  //    above) — appears immediately on pick, before any set is logged.
  const templateExerciseIds = new Set(sortedExercises.map((pe) => pe.exerciseId))
  const recordedReplacementIds = new Set(
    sessionSwaps.map((s) => s.replacementExerciseId).filter((id): id is string => id != null),
  )
  const extraExerciseById = new Map<string, Exercise>()
  for (const log of allCurrentLogs) {
    if (
      log.exercise &&
      !templateExerciseIds.has(log.exerciseId) &&
      !recordedReplacementIds.has(log.exerciseId) &&
      !extraExerciseById.has(log.exerciseId)
    ) {
      extraExerciseById.set(log.exerciseId, log.exercise)
    }
  }
  for (const ex of addedExercises) {
    if (!extraExerciseById.has(ex.id)) extraExerciseById.set(ex.id, ex)
  }
  const extraExercises = [...extraExerciseById.values()]

  const { containerRef: exercisesContainerRef, direction: scrollToCurrentSetDirection, scrollToCurrentSet } =
    useScrollToCurrentSet()

  // Session-first, batched once for every exercise in this workout day (v3
  // §2.3) — not one query per exercise card. Must run unconditionally (this
  // is a hook), so it's placed before the showComplete early return below,
  // fed by activeExercises so it also works from the offline-cached
  // exercise list. Swap replacements (recorded and legacy) are included
  // too, so a real prior occurrence of one still resolves a real reference
  // instead of silently falling back to first_time just because the id was
  // never asked about.
  const {
    data: referenceSessionsByExercise,
    isLoading: referenceLoading,
    isError: referenceIsError,
    isFromCache: referenceIsFromCache,
    retry: retryReference,
  } = useExerciseReferenceSessions(
    workoutDay.id,
    [
      ...activeExercises.map((pe) => pe.exerciseId),
      ...[...swapByProgramExerciseId.values()].map((s) => resolveReplacementExercise(s, allExercises).id),
      ...extraExercises.map((ex) => ex.id),
    ],
    sessionId,
  )

  // Exercises already active as a card in this session — excluded from the
  // "+ ADD EXERCISE" picker's candidates so picking one can never produce a
  // second card for the same exercise identity.
  const activeExerciseIds = [
    ...activeExercises.map((pe) => pe.exerciseId),
    ...[...swapByProgramExerciseId.values()].map((s) => resolveReplacementExercise(s, allExercises).id),
    ...extraExercises.map((ex) => ex.id),
  ]

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
  // records the structural link (migration 025), which both drives the
  // merged-card rendering below and reaches Coach's daily analysis
  // (analysisInput.ts) as an explicit fact instead of two disconnected
  // exercises. programExercise.exercise is always populated for a real card
  // (the join that produces it never omits it in practice) — guarded
  // defensively anyway since the type itself allows undefined.
  function handleSwap(exercise: Exercise, programExercise: ProgramExercise) {
    if (!programExercise.exercise) return
    recordSwap.mutate({
      programExerciseId: programExercise.id,
      originalExercise: programExercise.exercise,
      replacementExercise: exercise,
    })
  }

  // Add exercise mid-workout — no original exercise, no swap row, no write
  // to v2_program_exercises/v2_week_plan_sets: purely local state that adds
  // one more card to extraExercises above, same rendering as any other
  // unplanned exercise. Deduped defensively even though the picker already
  // excludes activeExerciseIds — this only guards against the same id being
  // added twice in the (currently unreachable) case of a stale picker state.
  function handleAddExercise(exercise: Exercise) {
    setAddedExercises((prev) => (prev.some((ex) => ex.id === exercise.id) ? prev : [...prev, exercise]))
    setShowAddExerciseSheet(false)
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
            data like RIR. Label changed from NOTES to COACH (QA-SIDEBAR-
            TASKS.md §8.1) now that this button opens a two-tab sheet
            (NOTES | ASK) rather than notes alone. */}
        {isCoachUser(user?.id) && (
          <button
            onClick={() => setShowSidebarSheet(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest"
            style={{
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            COACH
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

          // Position/presentation fix (2026-09-03): a swapped slot renders
          // ONE merged card, in this exact position, for the replacement —
          // not the original's own card plus a second one appended at the
          // end. plannedSets stays the original's (already fully resolved
          // by the time a swap is recorded — handleConfirmSwap skips it
          // first) so the planned section still shows that real history;
          // linkedExerciseIds pulls those rows into this card instead of
          // the (no-longer-rendered) original one.
          const swap = swapByProgramExerciseId.get(pe.id)
          if (swap) {
            const replacement = resolveReplacementExercise(swap, allExercises)
            const mergedProgramExercise: ProgramExercise = { ...pe, exerciseId: replacement.id, exercise: replacement }
            return (
              <ExerciseSection
                key={`${pe.id}-swapped-${swap.id}`}
                programExercise={mergedProgramExercise}
                plannedSets={plannedSets}
                allCurrentLogs={allCurrentLogs}
                linkedExerciseIds={swap.originalExerciseId ? [swap.originalExerciseId] : []}
                swappedFrom={{ exerciseName: swap.originalExerciseName }}
                sessionId={sessionId}
                referenceSessions={referenceSessionsByExercise.get(replacement.id) ?? []}
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
          }

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

        {/* Extra, unplanned exercise cards — legacy pre-migration-025 swaps
            and this session's own "+ ADD EXERCISE" additions alike. See
            extraExercises' own comment above for both sources. */}
        {extraExercises.map((ex, i) => {
          const syntheticProgramExercise: ProgramExercise = {
            id: `extra-${ex.id}`,
            workoutDayId: workoutDay.id,
            userId: user?.id ?? '',
            exerciseId: ex.id,
            exercise: ex,
            position: sortedExercises.length + i,
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

      {/* Add exercise mid-workout — a genuinely new, unplanned exercise,
          no swap and no original exercise involved. Reuses SwapExerciseSheet
          in 'add' mode (see that file's own comment on mode) rather than a
          second picker. */}
      <div className="px-4 mt-4">
        <button
          onClick={() => setShowAddExerciseSheet(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl text-xs font-bold tracking-widest"
          style={{
            minHeight: 48,
            border: '1px dashed var(--border)',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <Plus size={13} />
          ADD EXERCISE
        </button>
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

      {showSidebarSheet && (
        <WorkoutSidebarSheet sessionId={sessionId} onClose={() => setShowSidebarSheet(false)} />
      )}

      {showAddExerciseSheet && (
        <SwapExerciseSheet
          mode="add"
          excludeExerciseIds={activeExerciseIds}
          onConfirm={handleAddExercise}
          onClose={() => setShowAddExerciseSheet(false)}
        />
      )}
    </div>
  )
}
