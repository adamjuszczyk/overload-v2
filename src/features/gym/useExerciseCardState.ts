import { useState } from 'react'
import type { ProgramExercise, WeekPlanSet, SetLog, WeightUnit, FormRating, Exercise, ProgramSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary.js'
import type { ReferenceSession } from './sessionService'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { groupSetLogs, cascadeDeleteOrder, headsOnly } from './setGroupLogic'
import { lastTimeSession, lastTimeSetAt } from './lastTimeSet'
import { resolveRestTarget, type StageChainInput, type SupersetChainInput } from './restChain'
import type { ResolvedRow } from './workoutRules'
import type { WorkoutRows } from './useWorkoutRows'

// Chunk 58a — the card's writers and what its rows need, over the session's rows (`useWorkoutRows`, chunk 46r's `resolveRows`).
// The values every write computes are the ones this file always computed (chunk 13's extraction, chunk 16's rest chain): only where
// the rows come from changed. A row names the number it shows (`row.number`), and LOG and every skip store it (DECISIONS 151,
// 170: "LOG stores the number the row shows"), never "the logged heads + 1". ExerciseCard and SupersetBlock both call this once
// per exercise.

/** What a row hands the card when it is logged or skipped: the values the row knows. The card adds which set it is. */
export interface LogParams {
  weekPlanSetId: string | null
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  isDropset: boolean
  isSkipped: boolean
  restSeconds: number | null
  setSeconds: number | null
  // What unit the user actually typed the weight in (v3 §2.4) — null means "the resolved default for this program-exercise".
  enteredUnit: WeightUnit | null
  formRating: FormRating | null
  stageKind: StageKind | null
  isWarmup?: boolean
}

export interface LogRequest extends Omit<LogParams, 'setNumber' | 'weekPlanSetId'> {
  exerciseId: string
  weekPlanSetId: string | null
  setNumber: number
  parentSetId: string | null
  stageIndex: number
  /** An added set's place, on its head log only (DECISIONS 174, 177). Absent on every other write. */
  addedPlace?: number | null
  /** The id of an added set's log, named by the card's list before the request goes out. Absent on a planned set's write. */
  id?: string
}

export interface ExerciseCardProps {
  /** The card's identity in the session's rows (`OrderExercise.key`). */
  cardKey: string
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  // Chunk 16 (SPEC "Rest") — this exercise's own v2_program_sets rows (heads and stages), pre-filtered to this exercise by the
  // caller; looked up via each WeekPlanSet's own programSetId (restChain.ts's "design fields read from the run copy").
  programSets?: ProgramSet[]
  /** The session's rows and the writers of the card's own list (`useWorkoutRows`). */
  workout: WorkoutRows
  /** The session's set logs. */
  logs: SetLog[]
  /** The exercise's reference sessions: the panel above the rows resolves them, and so does the rows' LAST line (`lastTimeSet.ts`). */
  referenceSessions: ReferenceSession[]
  referenceLoading: boolean
  referenceMesocycleId: string | null
  referenceScheduleType?: import('./referenceByExercise').ScheduleType
  referenceIsError: boolean
  referenceIsFromCache: boolean
  onRetryReference: () => void
  today: string
  onLog: (params: LogRequest) => Promise<SetLog>
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; setNumber?: number; formRating?: FormRating | null }) => void
  onDeleteSet: (id: string) => Promise<void>
  onSwap: (exercise: Exercise, programExercise: ProgramExercise) => void
  // A card in a swapped slot (DECISIONS 198 (a)): the replacement's card says what it was swapped from. Neither card of a swapped
  // slot offers a second swap (025's unique index refuses one).
  swappedFrom?: { exerciseName: string }
  slotSwapped?: boolean
}

export function useExerciseCardState({
  cardKey,
  programExercise,
  plannedSets: allPlannedSets,
  programSets = [],
  workout,
  logs,
  referenceSessions,
  referenceLoading,
  referenceIsError,
  referenceScheduleType = 'weekday',
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
  onSwap,
}: ExerciseCardProps) {
  const startedAt = useRestTimerStore((s) => s.startedAt)
  // Chunk 16 (SPEC "Rest") — level 4, the global rest setting; always a real number (settingsStore's own default), never null.
  const globalRestSeconds = useSettingsStore((s) => s.targetRestSeconds)
  const { unit: resolvedWeightUnit } = useWeightDisplay(programExercise.weightUnit)

  const cardRows = workout.rows.filter((row) => row.exerciseKey === cardKey)
  const logById = new Map(logs.map((log) => [log.id, log]))
  const plannedById = new Map(allPlannedSets.map((set) => [set.id, set]))
  // The LAST line reads what the reference panel calls its primary session (finding 2 of 58a's review 1: not the latest completed
  // session), once the reference has loaded; while it loads or has failed the line says so instead (boards W3b, W2).
  const lastSession = referenceLoading || referenceIsError ? null : lastTimeSession(today, referenceScheduleType, referenceSessions)

  // Heads currently mid-cascade-delete — guards handleDeleteHead against a second concurrent invocation for the same head.
  const [deletingHeadIds, setDeletingHeadIds] = useState<Set<string>>(new Set())
  const [isSkippingExercise, setIsSkippingExercise] = useState(false)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  const [showSwapSheet, setShowSwapSheet] = useState(false)

  // ─── Rest chain (chunk 16 — SPEC "Rest") ─────────────────────────────────────────────────────────
  const programSetById = new Map(programSets.map((set) => [set.id, set]))
  // "On an exercise's last set" (SPEC level 2) — the last PLANNED working head, by position. An added set is never "the exercise's
  // last set" for this purpose (rest-after is a planning-time concept).
  const plannedHeads = headsOnly(
    allPlannedSets.filter((set) => !set.isWarmup),
    (set) => set.parentWeekPlanSetId,
  ).sort((a, b) => a.setNumber - b.setNumber)
  const lastPlannedHeadId = plannedHeads[plannedHeads.length - 1]?.id ?? null
  const isLastPlannedSet = (planned: WeekPlanSet | null): boolean => planned != null && planned.id === lastPlannedHeadId

  const setOverrideFor = (planned: WeekPlanSet | null | undefined): number | null => {
    const programSetId = planned?.programSetId
    return programSetId ? (programSetById.get(programSetId)?.restSeconds ?? null) : null
  }
  const setOverrideForStageRest = (planned: WeekPlanSet | null | undefined): number | null => {
    const programSetId = planned?.programSetId
    return programSetId ? (programSetById.get(programSetId)?.stageRestSeconds ?? null) : null
  }
  /** A planned head's drops, in order (the plan's: a stage is never its own top-level set). */
  const plannedStagesOf = (headId: string): WeekPlanSet[] =>
    allPlannedSets.filter((set) => set.parentWeekPlanSetId === headId).sort((a, b) => a.stageIndex - b.stageIndex)

  // Staged-set context for a HEAD being logged — the head's own explicit stage_kind (restChain.ts's header: a null/legacy kind is NOT
  // promoted to 'dropset' here, unlike resolveStageKind's display-only use elsewhere — D30 safety) and whether it has planned stages.
  function stageContextForHead(planned: WeekPlanSet | null): StageChainInput | null {
    if (!planned) return null
    const kind = planned.stageKind ?? null
    if (kind == null) return null
    return { kind, hasNextStage: plannedStagesOf(planned.id).length > 0, stageRestSecondsOverride: setOverrideForStageRest(planned) }
  }
  // Staged-set context for a STAGE being logged — the kind lives on the head; hasNextStage is false once stageIndex (the one just
  // about to be logged) reaches the planned stage count (the group's last configured stage falls through to the normal chain).
  function stageContextForStage(headPlanned: WeekPlanSet | null, stageIndex: number): StageChainInput | null {
    const kind = headPlanned?.stageKind ?? null
    if (kind == null || headPlanned == null) return null
    return { kind, hasNextStage: stageIndex < plannedStagesOf(headPlanned.id).length, stageRestSecondsOverride: setOverrideForStageRest(headPlanned) }
  }

  // Resolves the chain (restChain.ts) and applies it to the shared store: a real target starts a fresh rest period at that value;
  // null ("no timer") stops any period in progress instead of starting one.
  function applyRestChain(partial: {
    setOverrideSeconds: number | null
    isLastSetOfExercise: boolean
    stage: StageChainInput | null
    superset: SupersetChainInput | null
  }) {
    const target = resolveRestTarget({
      ...partial,
      exerciseRestSeconds: programExercise.restSeconds ?? null,
      exerciseRestAfterSeconds: programExercise.restAfterSeconds ?? null,
      globalRestSeconds,
    })
    if (target == null) useRestTimerStore.getState().stop()
    else useRestTimerStore.getState().startRest(target)
  }

  function currentRestElapsed() {
    return startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null
  }

  // ─── What a row stands for ───────────────────────────────────────────────────────────────────────
  const headOf = (row: ResolvedRow): ResolvedRow | undefined => (row.kind === 'stage' ? cardRows.find((r) => r.key === row.headKey) : row)
  /** The planned set behind a row: a head's own, a drop's planned stage; null for an added set and for a drop the plan doesn't have. */
  function plannedOf(row: ResolvedRow): WeekPlanSet | null {
    if (row.kind === 'stage') {
      const head = headOf(row)
      return head?.weekPlanSetId ? (plannedStagesOf(head.weekPlanSetId)[row.stageNumber! - 1] ?? null) : null
    }
    return row.weekPlanSetId ? (plannedById.get(row.weekPlanSetId) ?? null) : null
  }
  const logOf = (row: ResolvedRow): SetLog | null => (row.logId ? (logById.get(row.logId) ?? null) : null)
  /** Last time's set at the row's place, warmups out — only a working head has one (the LAST line). */
  const lastFor = (row: ResolvedRow): SetLog | null => (row.kind === 'working' ? lastTimeSetAt(lastSession, row.number) : null)

  // ─── Writers ─────────────────────────────────────────────────────────────────────────────────────
  // LOG or SKIP of a head (a planned working set, or an added one): the number is the row's.
  async function logHead(row: ResolvedRow, params: LogParams, supersetContext?: SupersetChainInput): Promise<SetLog> {
    const planned = plannedOf(row)
    const restElapsed = currentRestElapsed()
    applyRestChain({
      setOverrideSeconds: setOverrideFor(planned),
      isLastSetOfExercise: isLastPlannedSet(planned),
      stage: stageContextForHead(planned),
      superset: supersetContext ?? null,
    })
    // An added set names its log before the request goes out (DECISIONS 174: its list entry carries the log's id), and its log
    // carries its place. A planned set's payload names neither, so it is what it was before this chunk.
    const logId = row.added && row.localId !== null ? crypto.randomUUID() : null
    if (logId !== null && row.localId !== null) workout.linkLog(cardKey, row.localId, logId)
    const { weekPlanSetId: _plannedId, setNumber: _number, ...rest } = params
    return onLog({
      ...rest,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      // A non-null setSeconds means the row's Start Set flow already froze the honest rest value at the moment Start Set was tapped.
      restSeconds: params.setSeconds != null ? params.restSeconds : restElapsed,
      parentSetId: null,
      stageIndex: 0,
      // "As planned" (TASKS.md "Logging"): the row's own planned set; an added set has none.
      stageKind: planned?.stageKind ?? null,
      ...(logId !== null ? { id: logId, addedPlace: row.addedPlace } : {}),
    })
  }

  // LOG or SKIP of a drop: it belongs to its head's log (parentSetId), carries no place (DECISIONS 177) and shows its head's number.
  async function logStage(row: ResolvedRow, params: LogParams, supersetContext?: SupersetChainInput): Promise<SetLog> {
    const head = headOf(row)
    const headLog = head ? logOf(head) : null
    if (head === undefined || headLog === null) throw new RangeError(`the drop ${row.key} has no logged head`)
    const stageIndex = logs.filter((log) => log.parentSetId === headLog.id).reduce((max, log) => Math.max(max, log.stageIndex), 0) + 1
    return writeStage(head, headLog, stageIndex, plannedOf(row), row.number, params, supersetContext)
  }

  // ADD STAGE / "mark as dropset" (stay until chunk 62): a drop nobody planned, under a logged head.
  async function logAdHocStage(headRow: ResolvedRow, params: LogParams, supersetContext?: SupersetChainInput): Promise<SetLog> {
    const headLog = logOf(headRow)
    if (headLog === null) throw new RangeError(`the set ${headRow.key} is not logged`)
    const stageIndex = logs.filter((log) => log.parentSetId === headLog.id).reduce((max, log) => Math.max(max, log.stageIndex), 0) + 1
    return writeStage(headRow, headLog, stageIndex, null, headRow.number, params, supersetContext)
  }

  async function writeStage(
    head: ResolvedRow,
    headLog: SetLog,
    stageIndex: number,
    stagePlanned: WeekPlanSet | null,
    number: number,
    params: LogParams,
    supersetContext?: SupersetChainInput,
  ): Promise<SetLog> {
    const restElapsed = currentRestElapsed()
    const headPlanned = head.weekPlanSetId ? (plannedById.get(head.weekPlanSetId) ?? null) : null
    applyRestChain({
      setOverrideSeconds: setOverrideFor(stagePlanned),
      isLastSetOfExercise: isLastPlannedSet(headPlanned), // stages are never independent sets
      stage: stageContextForStage(headPlanned, stageIndex),
      superset: supersetContext ?? null,
    })
    const { weekPlanSetId: _plannedId, setNumber: _number, ...rest } = params
    return onLog({
      ...rest,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: stagePlanned?.id ?? null,
      setNumber: number,
      restSeconds: params.setSeconds != null ? params.restSeconds : restElapsed,
      parentSetId: headLog.id,
      stageIndex,
      stageKind: null, // a stage's own stage_kind is always null (the DB's own check)
    })
  }

  // A warmup's LOG (SPEC "Warmup sets"): level 1 of the chain only (never "the exercise's last set", never staged, never in a round).
  async function logWarmup(row: ResolvedRow, params: LogParams): Promise<SetLog> {
    const planned = plannedOf(row)
    applyRestChain({ setOverrideSeconds: setOverrideFor(planned), isLastSetOfExercise: false, stage: null, superset: null })
    const { weekPlanSetId: _plannedId, setNumber: _number, ...rest } = params
    return onLog({
      ...rest,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      parentSetId: null,
      stageIndex: 0,
      isWarmup: true,
    })
  }

  // Client-side cascade guard (TASKS.md §2.1): deletes stage rows first, in descending stage_index order, then the head last — stages-first
  // fails into a head with fewer stages, which is visible, harmless, and re-deletable. The renumber below sends only `setNumber`, not
  // the head's captured weight/reps/rir/note, so it can't clobber a concurrent edit.
  async function handleDeleteHead(headRow: ResolvedRow) {
    const headLog = logOf(headRow)
    if (headLog === null || deletingHeadIds.has(headLog.id)) return // nothing to delete, or already in progress
    const group = { head: headLog, stages: logs.filter((log) => log.parentSetId === headLog.id) }
    setDeletingHeadIds((prev) => new Set(prev).add(headLog.id))
    // The screen's number corrections wait for the whole cascade, renumber included (`workout.track`).
    await workout.track(
      (async () => {
        try {
          for (const log of cascadeDeleteOrder(group, (l) => l.stageIndex)) await onDeleteSet(log.id)
        } catch (err) {
          // Fails safe: whatever didn't get deleted stays put, and no renumbering happens for a delete that didn't complete.
          console.error('Failed to delete set group', err)
          return
        } finally {
          setDeletingHeadIds((prev) => {
            const next = new Set(prev)
            next.delete(headLog.id)
            return next
          })
        }
        // Scoped to the deleted head's own exerciseId: setNumber is per-exercise.
        groupSetLogs(logs.filter((log) => !log.isWarmup && log.exerciseId === headLog.exerciseId))
          .filter((g) => g.head.id !== headLog.id && g.head.setNumber > headLog.setNumber)
          .sort((a, b) => a.head.setNumber - b.head.setNumber)
          .forEach((g, i) => onUpdateSet(g.head.id, { setNumber: headLog.setNumber + i }))
      })(),
    )
  }

  // A lone stage has no descendants — a plain delete is safe, no cascade, no renumbering.
  function handleDeleteStage(stageRow: ResolvedRow) {
    if (stageRow.logId === null) return
    onDeleteSet(stageRow.logId).catch((err) => console.error('Failed to delete stage', err))
  }

  // Skip the rest of the exercise: every open PLANNED working set — heads and the drops under them (SPEC §4.3). Added sets and
  // warmups are left (chunk 59 extends it, DECISIONS 163). Sequential and awaited: a drop needs its head's real id. Each skip stores
  // the number its row shows.
  const openPlanned = cardRows.filter((row) => row.state === 'unlogged' && row.kind !== 'warmup' && !row.added)
  const skipParams = (planned: WeekPlanSet | null): LogParams => ({
    weekPlanSetId: planned?.id ?? null,
    setNumber: 0,
    weight: null,
    reps: null,
    rir: null,
    isDropset: false,
    isSkipped: true,
    restSeconds: null,
    setSeconds: null,
    enteredUnit: null,
    formRating: null,
    stageKind: planned?.stageKind ?? null,
  })
  async function handleSkipExercise() {
    for (const head of cardRows.filter((row) => row.kind === 'working' && !row.added)) {
      const headLog = head.state === 'unlogged' ? await logHead(head, skipParams(plannedOf(head))) : logOf(head)
      if (headLog === null) continue
      let stageIndex = logs.filter((log) => log.parentSetId === headLog.id).reduce((max, log) => Math.max(max, log.stageIndex), 0)
      for (const drop of cardRows.filter((row) => row.kind === 'stage' && row.headKey === head.key && row.state === 'unlogged')) {
        stageIndex += 1
        // A drop of a planned head: its own planned stage, a stage_kind of null (the DB's own check), skipped.
        await writeStage(head, headLog, stageIndex, plannedOf(drop), drop.number, { ...skipParams(plannedOf(drop)), isDropset: true, stageKind: null })
      }
    }
  }

  // Swap: skip whatever's left of the original exercise, then hand the chosen replacement up to GymSession. Sequential and awaited so
  // a skip failure doesn't still register the swap as if it had gone through.
  async function handleConfirmSwap(newExercise: Exercise) {
    setShowSwapSheet(false)
    setIsSkippingExercise(true)
    try {
      await handleSkipExercise()
      onSwap(newExercise, programExercise)
    } catch (err) {
      console.error('Failed to swap exercise', err)
    } finally {
      setIsSkippingExercise(false)
    }
  }

  async function handleConfirmSkip() {
    setShowSkipConfirm(false)
    setIsSkippingExercise(true)
    try {
      await handleSkipExercise()
    } catch (err) {
      console.error('Failed to skip exercise', err)
    } finally {
      setIsSkippingExercise(false)
    }
  }

  return {
    resolvedWeightUnit,
    lastLoading: referenceLoading,
    lastFailed: referenceIsError,
    retryLast: onRetryReference,
    logs,
    onUpdateSet,
    onDeleteSet,
    cardRows,
    deletingHeadIds,
    isSkippingExercise,
    showSkipConfirm,
    setShowSkipConfirm,
    showSwapSheet,
    setShowSwapSheet,
    plannedOf,
    logOf,
    lastFor,
    hasUnfinishedPlannedWork: openPlanned.length > 0,
    remainingPlannedCount: openPlanned.length,
    currentRestElapsed,
    logHead,
    logStage,
    logAdHocStage,
    logWarmup,
    handleDeleteHead,
    handleDeleteStage,
    handleSkipExercise,
    handleConfirmSkip,
    handleConfirmSwap,
    handleAddSet: () => workout.addSet(cardKey),
  }
}

export type ExerciseCardState = ReturnType<typeof useExerciseCardState>
