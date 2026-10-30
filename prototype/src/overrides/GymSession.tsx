import { useState, useEffect, useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import type { ProgramExercise, WorkoutDay, WeekPlan, WeekPlanSet, SetLog, FormRating, Exercise, ProgramSet } from '@app/types'
import type { ReferenceSession, ExerciseSwap } from '@app/features/gym/sessionService'
import type { ScheduleType } from '@app/features/gym/referenceByExercise'
import {
  useActiveSession,
  useLogSet,
  useUpdateSetLog,
  useDeleteSetLog,
  useExerciseReferenceSessions,
  useSessionSwaps,
  useRecordExerciseSwap,
} from '@app/features/gym/useSession'
import { useProgramExercises, useSupersetBlockRests } from '@app/features/programs/usePrograms'
// Chunk 16 (SPEC "Rest") — reused as-is, not reimplemented: the same batched-by-program-exercise-id fetch the planner's own
// StepVolume.tsx already uses (plannerService.ts's fetchProgramSets).
import { useProgramSets } from '@app/features/planner/usePlanner'
import { useExercises } from '@app/features/library/useExercises'
import { resolveReplacementExercise } from '@app/features/gym/exerciseSwapLogic'
import { useAuth } from '@app/features/auth/useAuth'
import { useOnlineStatus } from '@app/hooks/useOnlineStatus'
import { db } from '@app/lib/db'
import { primeOfflineCache } from '@app/features/offline/offlineCache'
import { isCoachUser } from '@app/features/coach/coachGate'
import ExerciseCard from '@app/features/gym/ExerciseCard'
import SupersetBlock from '@app/features/gym/SupersetBlock'
import WarmupRoutineChecklist from '@app/features/gym/WarmupRoutineChecklist'
import ExercisePickerSheet from '@app/components/ExercisePickerSheet'
import { ErrorLine } from '@app/features/gym/cardOptions'
import RestBar from '@app/features/gym/RestBar'
import FinishScreen from '@app/features/gym/FinishScreen'
import WorkoutSidebarSheet from '@app/features/gym/WorkoutSidebarSheet'
import { useAutoFinishSession } from '@app/features/gym/useAutoFinishSession'
import { useSessionDuration } from '@app/features/gym/useSessionDuration'
import { useScrollToCurrentSet } from '@app/features/gym/useScrollToCurrentSet'
import { readScrollTop, scrollToRowKey, writeScrollTop } from '@app/features/gym/scrollArea'
import { useWorkoutRows, type WorkoutCard, type WorkoutRows } from '@app/features/gym/useWorkoutRows'
import { dexieDraftStore } from '@app/features/gym/sessionDrafts'
import { patchSetNumbers, useSetNumberCorrections } from '@app/features/gym/useSetNumberCorrections'
import { changesOf, queueSetChanges, writeSetChanges } from '@app/features/gym/useSessionSetChanges'
import type { SessionWriters } from '@app/features/gym/setDelete'
import { clearStageKind } from '@app/features/gym/clearStageKind'
import { formatClock, jumpLabelText } from '@app/features/gym/workoutRowView'
import WorkoutHeader, { OfflineStrip } from '@app/features/gym/WorkoutHeader'
import { headerEyebrow, setsLabel, setsProgress } from '@app/features/gym/workoutHeaderLogic'
import { effectiveDate } from '@app/features/gym/effectiveDate'
import type { ExerciseCardProps, LogRequest, SwapInput } from '@app/features/gym/useExerciseCardState'
import type { OrderSuperset } from '@app/features/gym/workoutRules'
import SyncFailedNotice from '@app/features/offline/SyncFailedNotice'

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
  addedToday,
  setsMoved,
  movedFrom,
  excludeExerciseIds,
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
  writers,
  onSwap,
}: {
  card: WorkoutCard
  // Chunk 16 (SPEC "Rest") — this slot's own v2_program_sets rows, already filtered by the caller.
  programSets: ProgramSet[]
  workout: WorkoutRows
  logs: SetLog[]
  swappedFrom?: { exerciseName: string }
  slotSwapped?: boolean
  addedToday?: boolean
  setsMoved?: boolean
  movedFrom?: ExerciseCardProps['movedFrom']
  excludeExerciseIds: readonly string[]
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
  writers: SessionWriters
  onSwap: (input: SwapInput) => Promise<void>
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
      writers={writers}
      onSwap={onSwap}
      swappedFrom={swappedFrom}
      slotSwapped={slotSwapped}
      addedToday={addedToday}
      setsMoved={setsMoved}
      movedFrom={movedFrom}
      excludeExerciseIds={excludeExerciseIds}
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
  const [addExerciseError, setAddExerciseError] = useState<unknown>(null)

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
  const recordOf = (swap: ExerciseSwap, pe: ProgramExercise) => (swap.movedSets != null && swap.movedSets.fromKey === pe.id ? swap.movedSets : null)
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
      // A swap saved with its record (migration 047) puts the moved sets on this card: the record names the card they left by its key, the
      // program exercise's id on every phone. A row with no record (every swap before 047), or a record naming another card, is drawn as
      // before 1.2 draws it (DECISIONS 198 (a)): two cards, nothing moved, nothing inferred.
      const record = recordOf(swap, unit.pe)
      cards.push({
        key: replacementKey(unit.pe),
        programExercise: { ...unit.pe, exerciseId: replacement.id, exercise: replacement },
        plannedSets: [],
        ...(record !== null ? { swappedFrom: record } : {}),
      })
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

  // The session's change rows (chunk 61) are read with it: a planned set deleted in the session is a row here, and is out of the order.
  // Chunk 63 (G46 (a)): the card's list of the sets added in the session and the drafts of the sets that were unlogged are kept on the phone and read back here after a reload.
  const draftStore = useMemo(() => dexieDraftStore(sessionId), [sessionId])
  const workout = useWorkoutRows({ cards, blocks, logs: allCurrentLogs, changes: changesOf(session), store: draftStore, persist: session?.status === 'in_progress' })
  // DECISIONS 178, 185 (c), 197: the screen writes the corrected numbers of an in-progress session's logged sets, and only there. Not before the phone's own list has been read:
  // an open added set only that list names would otherwise be missing from the picture the corrections are worked out from.
  useSetNumberCorrections({
    sessionId,
    enabled: session?.status === 'in_progress' && workout.hydrated,
    corrections: workout.corrections,
    logs: allCurrentLogs,
    busy: workout.busy,
  })
  // DECISIONS 166 (a): auto-finish waits for what the workout's rows say is left: the finish warning's planned working sets AND the open drops of
  // planned sets and open planned warmups it leaves out (`nothingLeft`, 61's review 1, F2), so a planned set deleted during the workout no
  // longer keeps the session from finishing, and an open planned drop or warmup still does. A set a swap moved from a planned set counts as
  // planned (201 (a): its open drops and a moved planned warmup hold it too; 64's review 1, F1).
  useAutoFinishSession(session, weekPlan, workout.nothingLeft)

  const { containerRef: exercisesContainerRef, direction: scrollToCurrentSetDirection, scrollToCurrentSet } = useScrollToCurrentSet()

  // FINISH SESSION swaps the workout for the finish screen (chunk 64: the cards unmount, this component and its hooks stay). The scroller goes to the top for the
  // new screen, and the two ways back leave it where SPEC 11 says: BACK TO SESSION "closes it where it was", GO BACK scrolls to the first unlogged planned set.
  const scrollBack = useRef<{ rowKey: string | null; top: number } | null>(null)
  function openFinish() {
    scrollBack.current = { rowKey: null, top: readScrollTop() }
    setShowComplete(true)
  }
  function closeFinish(rowKey: string | null) {
    scrollBack.current = { rowKey, top: scrollBack.current?.top ?? 0 }
    setShowComplete(false)
  }
  useEffect(() => {
    if (showComplete) {
      writeScrollTop(0)
      return
    }
    const back = scrollBack.current
    if (back === null) return
    scrollBack.current = null
    if (back.rowKey === null || !scrollToRowKey(back.rowKey)) writeScrollTop(back.top)
  }, [showComplete])

  // The workout header's first line, which the finish screen opens with too, the clock after it (board W18: "WEEK 2 · TUESDAY · 52:40").
  const headerParts = {
    scheduleType,
    weekNumber,
    isDeload: weekPlan?.isDeload === true,
    date: session ? effectiveDate(session) : null,
    slot: weekPlan ? (weekPlan.sequencePosition ?? 0) + 1 : null,
  }

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
    return (
      <FinishScreen
        sessionId={sessionId}
        eyebrow={`${headerEyebrow(headerParts)} · ${formatClock(duration)}`}
        workoutName={workoutDay.name}
        warning={workout.finish}
        onBack={() => closeFinish(null)}
        onGoBack={(rowKey) => closeFinish(rowKey)}
      />
    )
  }

  // Shared by every card below, template and extra alike — same mutations, same session, only which exercise differs. mutateAsync
  // (not mutate) so a skip of a whole exercise can chain a head's real id into its stages' parentSetId.
  function handleLog(params: LogRequest) {
    return logSet.mutateAsync({ ...params, note: null })
  }
  function handleUpdateSet(id: string, changes: Parameters<typeof updateSetLog.mutate>[0]['changes']) {
    updateSetLog.mutate({ id, changes })
  }
  // One log (the card deletes a set's logs one by one, the drops first). Offline the delete is queued (G47); a drop's names its head, which the queue
  // needs so that the head's own delete waits for it.
  function handleDeleteSet(id: string) {
    return deleteSetLog.mutateAsync({ id, parentSetId: allCurrentLogs.find((log) => log.id === id)?.parentSetId ?? null })
  }
  // What a delete or a type change writes besides the logs (chunks 61 and 62), and the run and week CUES writes to.
  const writers: SessionWriters = {
    mesocycleId: session?.mesocycleId ?? null,
    weekNumber,
    isCycle: scheduleType === 'sequence',
    online: isOnline,
    writeChanges: (writes) => writeSetChanges({ sessionId, userId: user!.id, writes, online: isOnline }),
    patchNumbers: (patches) => patchSetNumbers({ sessionId, patches, logs: allCurrentLogs, flush: isOnline }),
    clearStageKind: (logId) =>
      clearStageKind({ sessionId, logId, online: isOnline, update: (id) => updateSetLog.mutateAsync({ id, changes: { stageKind: null } }) }),
    // Chunk 62: a logged set's type is one awaited request on its log, online only (G47: the card refuses it offline, `runTypeChange`); the rows LOG
    // writes for a staged added set go through the queue and are sent at once when the phone is online (`queueSetChanges`).
    patchLog: (id, changes) => updateSetLog.mutateAsync({ id, changes }),
    queueChanges: (writes) => queueSetChanges({ sessionId, userId: user!.id, writes, flush: isOnline }),
  }
  // Swap exercise for this session only (SPEC v1.1 "Part C"), chunk 59: the swap's row is saved FIRST, with the record of which sets moved
  // (migration 047; DECISIONS 200 (a): "the swap row is saved before any set is skipped"), and it fails with the real reason when it can't
  // be: offline, or refused. The card skips the moved sets only after this has resolved. The record's sets are listed on the card the swap
  // makes before the request goes out (drawn only once that card exists, so a swap that isn't saved shows nothing) and taken back when
  // the request fails. The row records the structural link (migration 025) and reaches Coach's daily analysis as an explicit fact.
  async function handleSwap({ programExercise, exercise, record, entries }: SwapInput) {
    const original = programExercise.exercise
    if (!original) throw new Error('This exercise has not loaded yet.')
    const key = replacementKey(programExercise)
    workout.addEntries(key, entries)
    try {
      await recordSwap.mutateAsync({ programExerciseId: programExercise.id, originalExercise: original, replacementExercise: exercise, movedSets: record })
    } catch (err) {
      workout.removeEntries(key)
      throw err
    }
  }
  // Add exercise mid-workout — no original exercise, no swap row, no write to v2_program_exercises/v2_week_plan_sets: purely local state
  // that adds one more card to extraExercises above. A failure shows its real reason in W14's confirm ("Couldn't add the exercise.").
  function handleAddExercise(exercise: Exercise) {
    try {
      const id = exercise.id
      setAddedExercises((prev) => (prev.some((ex) => ex.id === id) ? prev : [...prev, exercise]))
      setAddExerciseError(null)
      setShowAddExerciseSheet(false)
    } catch (err) {
      setAddExerciseError(err)
    }
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
    writers,
    onSwap: handleSwap,
    excludeExerciseIds: activeExerciseIds,
  }
  const programSetsOf = (pe: ProgramExercise) => allProgramSets.filter((ps) => ps.programExerciseId === pe.id)
  let blockLetterIndex = 0

  return (
    <div className="pb-6">
      {/* The header (chunk 58b, boards W1, W4): the week and weekday (DELOAD first on a deload session) or the cycle and slot, the workout's
          name, the clock and "N OF M SETS"; under it the offline strip (W6) while the phone has no network, and the strip for the writes
          that couldn't sync (W4). "Notes for the coach" has no meaning without a coach: the one new coachGate.ts call site this initiative adds. */}
      <WorkoutHeader
        eyebrow={headerEyebrow(headerParts)}
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
                <ExerciseSection
                  card={card}
                  programSets={programSetsOf(pe)}
                  slotSwapped
                  setsMoved={recordOf(swap, pe) !== null}
                  referenceSessions={reference(pe.exerciseId)}
                  {...shared}
                />
                <ExerciseSection
                  card={replacementCard}
                  programSets={[]}
                  swappedFrom={{ exerciseName: swap.originalExerciseName }}
                  slotSwapped
                  movedFrom={replacementCard.swappedFrom === undefined ? undefined : { plannedSets: plannedSetsOf(pe), record: replacementCard.swappedFrom }}
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
          return <ExerciseSection key={card.key} card={card} programSets={[]} addedToday referenceSessions={reference(ex.id)} {...shared} />
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
          onClick={openFinish}
          className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
          style={{ border: '2px solid var(--border-strong)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          FINISH SESSION
        </button>
      </div>

      {/* The rest timer and the jump to the current set, pinned at the bottom of the screen (chunk 58a; boards W1, W4). */}
      <RestBar jump={{ direction: scrollToCurrentSetDirection, label: workout.current ? jumpLabelText(workout.current) : null, onJump: scrollToCurrentSet }} complete={workout.current === null ? { onFinish: openFinish } : null} />

      {showSidebarSheet && <WorkoutSidebarSheet sessionId={sessionId} onClose={() => setShowSidebarSheet(false)} />}

      {showAddExerciseSheet && (
        <ExercisePickerSheet
          mode="add"
          eyebrow={`${workoutDay.name.toUpperCase()} · TODAY`}
          title="Add an exercise"
          exclude={activeExerciseIds}
          showGroup={false}
          onCreate={() => {}}
          confirmLabel="ADD EXERCISE"
          confirmNote={() => (
            <>
              <span style={{ display: 'block' }}>Only today's session changes; the plan stays the same.</span>
              {addExerciseError !== null && <ErrorLine headline="Couldn't add the exercise." error={addExerciseError} />}
            </>
          )}
          onPick={handleAddExercise}
          onClose={() => {
            setAddExerciseError(null)
            setShowAddExerciseSheet(false)
          }}
        />
      )}
    </div>
  )
}

// SUPERSET A, B, … in the order the blocks are drawn.
function blockLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`
}
