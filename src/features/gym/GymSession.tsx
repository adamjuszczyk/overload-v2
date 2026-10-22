import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { ProgramExercise, WorkoutDay, WeekPlan, WeekPlanSet, SetLog, FormRating, Exercise, ProgramSet } from '../../types'
import type { ReferenceSession, ExerciseSwap } from './sessionService'
import type { ScheduleType } from './referenceByExercise'
import {
  useActiveSession,
  useLogSet,
  useUpdateSetLog,
  useDeleteSetLog,
  useExerciseReferenceSessions,
  useSessionSwaps,
  useRecordExerciseSwap,
} from './useSession'
import { useProgramExercises, useSupersetBlockRests } from '../programs/usePrograms'
// Chunk 16 (SPEC "Rest") — reused as-is, not reimplemented: the same batched-by-program-exercise-id fetch the planner's own
// StepVolume.tsx already uses (plannerService.ts's fetchProgramSets).
import { useProgramSets } from '../planner/usePlanner'
import { useExercises } from '../library/useExercises'
import { resolveReplacementExercise } from './exerciseSwapLogic'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { db } from '../../lib/db'
import { primeOfflineCache } from '../offline/offlineCache'
import { isCoachUser } from '../coach/coachGate'
import ExerciseCard from './ExerciseCard'
import SupersetBlock from './SupersetBlock'
import WarmupRoutineChecklist from './WarmupRoutineChecklist'
import SwapExerciseSheet from './SwapExerciseSheet'
import RestBar from './RestBar'
import SessionComplete from './SessionComplete'
import WorkoutSidebarSheet from './WorkoutSidebarSheet'
import { useAutoFinishSession } from './useAutoFinishSession'
import { useSessionDuration } from './useSessionDuration'
import { useScrollToCurrentSet } from './useScrollToCurrentSet'
import { useWorkoutRows, type WorkoutCard, type WorkoutRows } from './useWorkoutRows'
import { useSetNumberCorrections } from './useSetNumberCorrections'
import { formatClock, jumpLabelText } from './workoutRowView'
import WorkoutHeader, { OfflineStrip } from './WorkoutHeader'
import { headerEyebrow, setsLabel, setsProgress } from './workoutHeaderLogic'
import { effectiveDate } from './effectiveDate'
import type { LogRequest } from './useExerciseCardState'
import type { OrderSuperset } from './workoutRules'
import SyncFailedNotice from '../offline/SyncFailedNotice'

interface GymSessionProps {
  sessionId: string
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
  // Chunk 25 — the run's real schedule type, for the "Last time" reference panel and this screen's own "WEEK"/"CYCLE" header.
  // Optional, defaults to 'weekday': TodayPage.tsx's call site doesn't pass it; SequenceTodayPage.tsx is the one caller that does.
  scheduleType?: ScheduleType
}

// Renders one exercise's card. The rows' LAST line reads the exercise's reference sessions (`referenceSessions`, resolved as the panel
// above the rows resolves them: `lastTimeSet.ts`), not a query of its own.
function ExerciseSection({
  card,
  programSets,
  workout,
  logs,
  swappedFrom,
  slotSwapped,
  referenceSessions,
  referenceLoading,
  referenceMesocycleId,
  referenceScheduleType,
  referenceIsError,
  referenceIsFromCache,
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
  onSwap,
}: {
  card: WorkoutCard
  // Chunk 16 (SPEC "Rest") — this slot's own v2_program_sets rows, already filtered by the caller.
  programSets: ProgramSet[]
  workout: WorkoutRows
  logs: SetLog[]
  swappedFrom?: { exerciseName: string }
  slotSwapped?: boolean
  sessionId: string
  referenceSessions: ReferenceSession[]
  referenceLoading: boolean
  referenceMesocycleId: string | null
  referenceScheduleType: ScheduleType
  referenceIsError: boolean
  referenceIsFromCache: boolean
  onRetryReference: () => void
  today: string
  onLog: (params: LogRequest) => Promise<SetLog>
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; setNumber?: number; formRating?: FormRating | null }) => void
  onDeleteSet: (id: string) => Promise<void>
  onSwap: (exercise: Exercise, programExercise: ProgramExercise) => void
}) {
  return (
    <ExerciseCard
      cardKey={card.key}
      programExercise={card.programExercise}
      plannedSets={[...card.plannedSets]}
      programSets={programSets}
      workout={workout}
      logs={logs}
      referenceSessions={referenceSessions}
      referenceLoading={referenceLoading}
      referenceMesocycleId={referenceMesocycleId}
      referenceScheduleType={referenceScheduleType}
      referenceIsError={referenceIsError}
      referenceIsFromCache={referenceIsFromCache}
      onRetryReference={onRetryReference}
      today={today}
      onLog={onLog}
      onUpdateSet={onUpdateSet}
      onDeleteSet={onDeleteSet}
      onSwap={onSwap}
      swappedFrom={swappedFrom}
      slotSwapped={slotSwapped}
    />
  )
}

export default function GymSession({ sessionId, workoutDay, weekPlan, weekNumber, today, scheduleType = 'weekday' }: GymSessionProps) {
  const [showComplete, setShowComplete] = useState(false)
  const [showSidebarSheet, setShowSidebarSheet] = useState(false)
  const [cachedExercises, setCachedExercises] = useState<ProgramExercise[]>([])
  // Add exercise mid-workout (2026-09-13) — a genuinely new, unplanned exercise the user chose via "+ ADD EXERCISE" below, no
  // original exercise involved and nothing skipped/abandoned. Session-local only: once its first set is logged, the log-driven
  // detection below picks up the same exercise id and keeps rendering its card even across a refresh.
  const [addedExercises, setAddedExercises] = useState<Exercise[]>([])
  const [showAddExerciseSheet, setShowAddExerciseSheet] = useState(false)

  const { user } = useAuth()
  const isOnline = useOnlineStatus()

  const { data: session } = useActiveSession(sessionId)
  // Chunk 7 — the week's own v2_week_plan_exercises list when a week plan exists for this session (weekPlan.exercises); the program's
  // own exercises directly otherwise. fallbackProgramExercises keeps its own identity below (the priming effect and the
  // offline-cache-for-this-workout-day branch both key off the PROGRAM's own list).
  const { data: fallbackProgramExercises = [] } = useProgramExercises(workoutDay.id)
  const programExercises = weekPlan?.exercises ?? fallbackProgramExercises
  // Swap exercise for this session only (SPEC v1.1 "Part C") — the structural link (migration 025) between a swapped-out slot and its
  // replacement, read here so a swap survives a refresh even before the replacement's first set has logged.
  const { data: sessionSwaps = [] } = useSessionSwaps(sessionId)
  const recordSwap = useRecordExerciseSwap(sessionId)
  // Full exercise objects, including archived ones: a swap's replacement can only be rendered as a real card via lookup.
  const { data: allExercises = [] } = useExercises(true)
  const logSet = useLogSet(sessionId)
  const updateSetLog = useUpdateSetLog(sessionId)
  const deleteSetLog = useDeleteSetLog(sessionId)

  useAutoFinishSession(session, weekPlan)
  const duration = useSessionDuration(session)

  // Prime the Dexie cache once exercises are loaded and we're online. Keyed off fallbackProgramExercises (the PROGRAM's own list),
  // not the week-preferring `programExercises` above — db.workout_days is cached by workoutDayId alone, with no week number.
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

  // When offline and Supabase returns nothing, fall back to Dexie — the cached week plan's own exercise list first, the cached workout
  // day's program exercises otherwise.
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

  // Chunk 16 (SPEC "Rest") — this session's own v2_program_sets (per-set rest override, per-staged-head stage rest) and this workout's
  // own superset blocks (rest within/after round), each batched once per screen.
  const { data: allProgramSets = [] } = useProgramSets(sortedExercises.map((pe) => pe.id))
  const { data: supersetBlockRests = [] } = useSupersetBlockRests(workoutDay.id)
  const supersetBlockRestById = new Map(supersetBlockRests.map((b) => [b.id, b]))

  const swapByProgramExerciseId = new Map<string, ExerciseSwap>()
  for (const swap of sessionSwaps) {
    if (swap.programExerciseId) swapByProgramExerciseId.set(swap.programExerciseId, swap)
  }

  // Chunk 13 (SPEC "Supersets [P1]") — group CONSECUTIVE sortedExercises sharing one non-null supersetBlockId (2+ of them) into a
  // SupersetBlock; everything else is a single card. A member with a confirmed session swap never joins a block's round grid: its slot
  // is drawn as its own cards (the original, then the replacement: DECISIONS 198 (a)).
  type RenderUnit = { kind: 'single'; pe: ProgramExercise } | { kind: 'block'; blockId: string; members: ProgramExercise[] }

  const renderUnits: RenderUnit[] = []
  for (let i = 0; i < sortedExercises.length; ) {
    const pe = sortedExercises[i]
    const blockId = pe.supersetBlockId ?? null
    if (blockId == null || swapByProgramExerciseId.has(pe.id)) {
      renderUnits.push({ kind: 'single', pe })
      i += 1
      continue
    }
    const members = [pe]
    let j = i + 1
    while (j < sortedExercises.length && sortedExercises[j].supersetBlockId === blockId && !swapByProgramExerciseId.has(sortedExercises[j].id)) {
      members.push(sortedExercises[j])
      j += 1
    }
    if (members.length < 2) {
      renderUnits.push({ kind: 'single', pe })
      i += 1
      continue
    }
    renderUnits.push({ kind: 'block', blockId, members })
    i = j
  }

  // Extra, unplanned exercise cards — no plan slot. Two sources feed this same list, deduped by exercise id:
  // 1. Legacy fallback: a swap confirmed before migration 025 has real logs for its replacement but no v2_session_exercise_swaps row;
  //    its own card after the template (discovered from real logs, so it only appears once a set has been logged).
  // 2. This session's own "+ ADD EXERCISE" additions (addedExercises state above) — appears immediately on pick.
  const templateExerciseIds = new Set(sortedExercises.map((pe) => pe.exerciseId))
  const recordedReplacementIds = new Set(sessionSwaps.map((s) => s.replacementExerciseId).filter((id): id is string => id != null))
  const extraExerciseById = new Map<string, Exercise>()
  for (const log of allCurrentLogs) {
    if (log.exercise && !templateExerciseIds.has(log.exerciseId) && !recordedReplacementIds.has(log.exerciseId) && !extraExerciseById.has(log.exerciseId)) {
      extraExerciseById.set(log.exerciseId, log.exercise)
    }
  }
  for (const ex of addedExercises) {
    if (!extraExerciseById.has(ex.id)) extraExerciseById.set(ex.id, ex)
  }
  const extraExercises = [...extraExerciseById.values()]

  // ─── The cards, in the order the screen draws them (chunk 58a) ────────────────────────────────────────────────────────────────
  // One list for the session's rules (`useWorkoutRows`): the plan's cards, a swapped slot as two (the original, then the replacement
  // on a card of its own: DECISIONS 198 (a), W5), the extra cards last. A card's key is the same on every phone and after a reload.
  const plannedSetsOf = (pe: ProgramExercise): WeekPlanSet[] => (weekPlan?.sets ?? []).filter((s) => s.programExerciseId === pe.id).sort((a, b) => a.setNumber - b.setNumber)
  const replacementKey = (pe: ProgramExercise) => `${pe.id}:replacement`
  const cards: WorkoutCard[] = []
  const blocks: OrderSuperset[] = []
  for (const unit of renderUnits) {
    if (unit.kind === 'block') {
      blocks.push({ id: unit.blockId, members: unit.members.map((pe) => pe.id) })
      for (const pe of unit.members) cards.push({ key: pe.id, programExercise: pe, plannedSets: plannedSetsOf(pe) })
      continue
    }
    cards.push({ key: unit.pe.id, programExercise: unit.pe, plannedSets: plannedSetsOf(unit.pe) })
    const swap = swapByProgramExerciseId.get(unit.pe.id)
    if (swap) {
      const replacement = resolveReplacementExercise(swap, allExercises)
      cards.push({ key: replacementKey(unit.pe), programExercise: { ...unit.pe, exerciseId: replacement.id, exercise: replacement }, plannedSets: [] })
    }
  }
  extraExercises.forEach((ex, i) => {
    const synthetic: ProgramExercise = {
      id: `extra-${ex.id}`,
      workoutDayId: workoutDay.id,
      userId: user?.id ?? '',
      exerciseId: ex.id,
      exercise: ex,
      position: sortedExercises.length + i,
      weightUnit: null,
    }
    cards.push({ key: synthetic.id, programExercise: synthetic, plannedSets: [] })
  })
  const cardByKey = new Map(cards.map((card) => [card.key, card]))

  const workout = useWorkoutRows({ cards, blocks, logs: allCurrentLogs })
  // DECISIONS 178, 185 (c), 197: the screen writes the corrected numbers of an in-progress session's logged sets, and only there.
  useSetNumberCorrections({
    sessionId,
    enabled: session?.status === 'in_progress',
    corrections: workout.corrections,
    logs: allCurrentLogs,
    busy: workout.busy,
  })

  const { containerRef: exercisesContainerRef, direction: scrollToCurrentSetDirection, scrollToCurrentSet } = useScrollToCurrentSet()

  // Session-first, batched once for every exercise in this workout day (v3 §2.3) — not one query per exercise card. Swap replacements
  // (recorded and legacy) are included too, so a real prior occurrence of one still resolves a real reference.
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

  // Exercises already active as a card in this session — excluded from the "+ ADD EXERCISE" picker's candidates.
  const activeExerciseIds = [
    ...activeExercises.map((pe) => pe.exerciseId),
    ...[...swapByProgramExerciseId.values()].map((s) => resolveReplacementExercise(s, allExercises).id),
    ...extraExercises.map((ex) => ex.id),
  ]

  if (showComplete) {
    return <SessionComplete sessionId={sessionId} onBack={() => setShowComplete(false)} />
  }

  // Shared by every card below, template and extra alike — same mutations, same session, only which exercise differs. mutateAsync
  // (not mutate) so a skip of a whole exercise can chain a head's real id into its stages' parentSetId.
  function handleLog(params: LogRequest) {
    return logSet.mutateAsync({ ...params, note: null })
  }
  function handleUpdateSet(id: string, changes: Parameters<typeof updateSetLog.mutate>[0]['changes']) {
    updateSetLog.mutate({ id, changes })
  }
  function handleDeleteSet(id: string) {
    return deleteSetLog.mutateAsync(id)
  }
  // Swap exercise for this session only (SPEC v1.1 "Part C") — the original exercise's card has already skipped its own remaining sets by
  // the time this fires; this records the structural link (migration 025) and reaches Coach's daily analysis as an explicit fact.
  function handleSwap(exercise: Exercise, programExercise: ProgramExercise) {
    if (!programExercise.exercise) return
    recordSwap.mutate({ programExerciseId: programExercise.id, originalExercise: programExercise.exercise, replacementExercise: exercise })
  }
  // Add exercise mid-workout — no original exercise, no swap row, no write to v2_program_exercises/v2_week_plan_sets: purely local state
  // that adds one more card to extraExercises above.
  function handleAddExercise(exercise: Exercise) {
    setAddedExercises((prev) => (prev.some((ex) => ex.id === exercise.id) ? prev : [...prev, exercise]))
    setShowAddExerciseSheet(false)
  }

  const reference = (exerciseId: string) => referenceSessionsByExercise.get(exerciseId) ?? []
  const shared = {
    workout,
    logs: allCurrentLogs,
    sessionId,
    referenceLoading,
    referenceMesocycleId: session?.mesocycleId ?? null,
    referenceScheduleType: scheduleType,
    referenceIsError,
    referenceIsFromCache,
    onRetryReference: retryReference,
    today,
    onLog: handleLog,
    onUpdateSet: handleUpdateSet,
    onDeleteSet: handleDeleteSet,
    onSwap: handleSwap,
  }
  const programSetsOf = (pe: ProgramExercise) => allProgramSets.filter((ps) => ps.programExerciseId === pe.id)
  let blockLetterIndex = 0

  return (
    <div className="pb-6">
      {/* The header (chunk 58b, boards W1, W4): the week and weekday (DELOAD first on a deload session) or the cycle and slot, the workout's
          name, the clock and "N OF M SETS"; under it the offline strip (W6) while the phone has no network, and the strip for the writes
          that couldn't sync (W4). "Notes for the coach" has no meaning without a coach: the one new coachGate.ts call site this initiative adds. */}
      <WorkoutHeader
        eyebrow={headerEyebrow({
          scheduleType,
          weekNumber,
          isDeload: weekPlan?.isDeload === true,
          date: session ? effectiveDate(session) : null,
          slot: weekPlan ? (weekPlan.sequencePosition ?? 0) + 1 : null,
        })}
        name={workoutDay.name}
        clock={formatClock(duration)}
        progress={setsLabel(setsProgress(workout.rows))}
        action={
          isCoachUser(user?.id) ? (
            <button
              onClick={() => setShowSidebarSheet(true)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
            >
              COACH
            </button>
          ) : undefined
        }
      />
      {!isOnline && <OfflineStrip />}
      <SyncFailedNotice sessionId={sessionId} variant="strip" />
      <div style={{ height: 14 }} />

      {/* Warmup routine checklist (chunk 18 — SPEC.md "Warmup routine") — above the first card or superset block. */}
      <WarmupRoutineChecklist sessionId={sessionId} workoutDayId={workoutDay.id} />

      {/* Exercise cards */}
      <div className="px-4 space-y-4" ref={exercisesContainerRef}>
        {renderUnits.map((unit) => {
          if (unit.kind === 'block') {
            return (
              <SupersetBlock
                // Includes every member's OWN id, not just the block id and count: a same-count membership change (reordered, or one
                // exercise replaced by another) still remounts a fresh instance, since SupersetBlock's one-hook-call-per-member
                // pattern binds each hook's own state to its POSITION in the member list.
                key={`block-${unit.blockId}-${unit.members.map((pe) => pe.id).join('.')}`}
                blockId={unit.blockId}
                letter={blockLetter(blockLetterIndex++)}
                members={unit.members.map((pe) => ({
                  cardKey: pe.id,
                  programExercise: pe,
                  plannedSets: plannedSetsOf(pe),
                  referenceSessions: reference(pe.exerciseId),
                  // Chunk 16 (SPEC "Rest") — same "already filtered by the caller" convention as plannedSets.
                  programSets: programSetsOf(pe),
                }))}
                // Chunk 16 — this block's own two rest fields; null when the block row can't be found (defensive).
                blockRest={supersetBlockRestById.get(unit.blockId) ?? null}
                {...shared}
              />
            )
          }
          const pe = unit.pe
          const card = cardByKey.get(pe.id)!
          const swap = swapByProgramExerciseId.get(pe.id)
          if (swap) {
            const replacementCard = cardByKey.get(replacementKey(pe))!
            return (
              <div key={`${pe.id}-swapped-${swap.id}`} className="space-y-4">
                <ExerciseSection card={card} programSets={programSetsOf(pe)} slotSwapped referenceSessions={reference(pe.exerciseId)} {...shared} />
                <ExerciseSection
                  card={replacementCard}
                  programSets={[]}
                  swappedFrom={{ exerciseName: swap.originalExerciseName }}
                  slotSwapped
                  referenceSessions={reference(replacementCard.programExercise.exerciseId)}
                  {...shared}
                />
              </div>
            )
          }
          return <ExerciseSection key={pe.id} card={card} programSets={programSetsOf(pe)} referenceSessions={reference(pe.exerciseId)} {...shared} />
        })}

        {/* Extra, unplanned exercise cards — legacy pre-migration-025 swaps and this session's own "+ ADD EXERCISE" additions alike. */}
        {extraExercises.map((ex) => {
          const card = cardByKey.get(`extra-${ex.id}`)!
          return <ExerciseSection key={card.key} card={card} programSets={[]} referenceSessions={reference(ex.id)} {...shared} />
        })}
      </div>

      {/* Add exercise mid-workout — a genuinely new, unplanned exercise, no swap and no original exercise involved. */}
      <div className="px-4 mt-4">
        <button
          onClick={() => setShowAddExerciseSheet(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl text-xs font-bold tracking-widest"
          style={{ minHeight: 48, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          <Plus size={13} />
          ADD EXERCISE
        </button>
      </div>

      {/* Finish session */}
      <div className="px-4 mt-6 mb-4">
        <button
          onClick={() => setShowComplete(true)}
          className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
          style={{ border: '2px solid var(--border-strong)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          FINISH SESSION
        </button>
      </div>

      {/* The rest timer and the jump to the current set, pinned at the bottom of the screen (chunk 58a; boards W1, W4). */}
      <RestBar jump={{ direction: scrollToCurrentSetDirection, label: workout.current ? jumpLabelText(workout.current) : null, onJump: scrollToCurrentSet }} />

      {showSidebarSheet && <WorkoutSidebarSheet sessionId={sessionId} onClose={() => setShowSidebarSheet(false)} />}

      {showAddExerciseSheet && (
        <SwapExerciseSheet mode="add" excludeExerciseIds={activeExerciseIds} onConfirm={handleAddExercise} onClose={() => setShowAddExerciseSheet(false)} />
      )}
    </div>
  )
}

// SUPERSET A, B, … in the order the blocks are drawn.
function blockLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`
}
