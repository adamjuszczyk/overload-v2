import { useRef, useState } from 'react'
import type { ProgramExercise, WeekPlanSet, SetLog, WeightUnit, FormRating, Exercise, ProgramSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary.js'
import type { ReferenceSession } from './sessionService'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { headsOnly } from './setGroupLogic'
import { lastTimeSession, lastTimeSetAt } from './lastTimeSet'
import { resolveRestTarget, type StageChainInput, type SupersetChainInput } from './restChain'
import { deleteEffects, lockDecision, type AddedSet, type LockDecision, type ResolvedRow, type SwapRecord } from './workoutRules'
import type { WorkoutRows } from './useWorkoutRows'
import { NeedsConnectionError, runDelete, type SessionWriters } from './setDelete'
import { deleteConfirm, loggedNumbersText, plannedNumbersText } from './setOptionsView'
import { canMove, planSkipRest, planSwap, type SkipItem } from './exerciseOptions'

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
  /** Chunk 61: what a delete writes besides the logs (its change rows, the renumber, a head's stage kind), and the run and week CUES writes to. */
  writers: SessionWriters
  /**
   * Chunk 59: the swap for today, saved: the swap's row with its record (DECISIONS 200: online, before any set is skipped), then the
   * moved sets' entries on the card the swap made. Rejects with the reason when the row isn't saved, and then nothing else is written.
   */
  onSwap: (input: SwapInput) => Promise<void>
  // A card in a swapped slot (DECISIONS 198 (a)): the replacement's card says what it was swapped from. Neither card of a swapped
  // slot offers a second swap (025's unique index refuses one).
  swappedFrom?: { exerciseName: string }
  slotSwapped?: boolean
  /** Chunk 59, a card for an exercise added today ("+ ADD EXERCISE"): drawn "ADDED TODAY", offers no swap (DECISIONS 199 (a)). */
  addedToday?: boolean
  /** Chunk 59, the card a swap moved sets from (its row has a record): it offers no + ADD SET and no "Add a set" (TASKS 59). */
  setsMoved?: boolean
  /**
   * Chunk 59, a card a swap made with a record: the plan of the card the sets came from. A moved set shows the targets it had there
   * (DECISIONS 164: "with their numbers, type, drops and targets, as W5 draws"); the log it is given is an added set's all the same.
   */
  movedFrom?: { plannedSets: readonly WeekPlanSet[]; record: SwapRecord }
  /** Chunk 59, for the swap picker: every exercise already in the workout, which the picker never lists. */
  excludeExerciseIds?: readonly string[]
}

/** What a swap for today hands the screen once its sets are chosen (the screen saves the row, then lists the entries). */
export interface SwapInput {
  programExercise: ProgramExercise
  exercise: Exercise
  record: SwapRecord
  entries: AddedSet[]
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
  writers,
  onSwap,
  swappedFrom,
  slotSwapped,
  addedToday,
  setsMoved,
  movedFrom,
}: ExerciseCardProps) {
  const startedAt = useRestTimerStore((s) => s.startedAt)
  // Chunk 16 (SPEC "Rest") — level 4, the global rest setting; always a real number (settingsStore's own default), never null.
  const globalRestSeconds = useSettingsStore((s) => s.targetRestSeconds)
  // Chunk 60 (SPEC [1.2] "Log lock (18a)"): Settings' "Log sets in order", read where LOG is decided, never defaulted here.
  const logInOrder = useSettingsStore((s) => s.logInOrder)
  const { unit: resolvedWeightUnit } = useWeightDisplay(programExercise.weightUnit)

  const cardRows = workout.rows.filter((row) => row.exerciseKey === cardKey)
  const logById = new Map(logs.map((log) => [log.id, log]))
  const plannedById = new Map(allPlannedSets.map((set) => [set.id, set]))
  // The LAST line reads what the reference panel calls its primary session (finding 2 of 58a's review 1: not the latest completed
  // session), once the reference has loaded; while it loads or has failed the line says so instead (boards W3b, W2).
  const lastSession = referenceLoading || referenceIsError ? null : lastTimeSession(today, referenceScheduleType, referenceSessions)

  const [isSkippingExercise, setIsSkippingExercise] = useState(false)
  const [showSwapSheet, setShowSwapSheet] = useState(false)
  // W9, asked of one row (chunk 61): kept here, with the words it was asked with, because the row it names leaves the screen as soon as its delete
  // starts (its change row is held), and a confirm that lived in that row would go with it, with the reason a delete failed.
  const [confirmDelete, setConfirmDelete] = useState<{ row: ResolvedRow; eyebrow: string; title: string; body: string } | null>(null)

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
  // Chunk 59: a staged ADDED set (a dropset a swap moved here) has no planned set to read its stages from: its row's type says them.
  function stageContextForAddedHead(row: ResolvedRow): StageChainInput | null {
    return row.type?.kind === 'staged' ? { kind: row.type.stageKind, hasNextStage: row.type.stageCount > 0, stageRestSecondsOverride: null } : null
  }
  function stageContextForAddedStage(head: ResolvedRow, stageIndex: number): StageChainInput | null {
    return head.type?.kind === 'staged' ? { kind: head.type.stageKind, hasNextStage: stageIndex < head.type.stageCount, stageRestSecondsOverride: null } : null
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
  // Chunk 59: a set a swap moved here is an added set of this card (its log names no planned set), and it shows the targets it had on
  // the card it left: the plan's set that the swap's record names for its place (DECISIONS 164, W5). Never the identity a log is written with.
  const movedPlannedById = new Map((movedFrom?.plannedSets ?? []).map((set) => [set.id, set]))
  const movedOriginOf = (row: ResolvedRow): WeekPlanSet | null => {
    if (movedFrom === undefined || !row.added || row.addedPlace === null) return null
    const moved = movedFrom.record.moved.find((m) => m.place === row.addedPlace)
    return moved !== undefined && 'weekPlanSetId' in moved.from ? (movedPlannedById.get(moved.from.weekPlanSetId) ?? null) : null
  }
  /** The planned set whose targets a row shows: its own, or for a moved set the one it was (and for its drops, that set's drops). */
  function targetsOf(row: ResolvedRow): WeekPlanSet | null {
    if (movedFrom !== undefined) {
      const head = headOf(row)
      const origin = head === undefined ? null : movedOriginOf(head)
      if (origin !== null) {
        if (row.kind !== 'stage') return origin
        return movedFrom.plannedSets.filter((set) => set.parentWeekPlanSetId === origin.id).sort((a, b) => a.stageIndex - b.stageIndex)[row.stageNumber! - 1] ?? null
      }
    }
    return plannedOf(row)
  }
  const logOf = (row: ResolvedRow): SetLog | null => (row.logId ? (logById.get(row.logId) ?? null) : null)
  /** Last time's set at the row's place, warmups out — only a working head has one (the LAST line). */
  const lastFor = (row: ResolvedRow): SetLog | null => (row.kind === 'working' ? lastTimeSetAt(lastSession, row.number) : null)

  // The log lock (SPEC [1.2] "Log lock (18a)", G54; chunk 60): what LOG on `row` does, by 46r's `lockDecision` over the session's current set
  // (`workout.current`, the first unlogged working set or drop over every card) and Settings' "Log sets in order". 'log' writes at once (the
  // current row, every row with the lock off, every warmup); otherwise it is the question to ask first. It decides and writes nothing: the row asks
  // and then calls the writer below for its own row, so a LOG that is confirmed is the unchanged write path.
  const lockFor = (row: ResolvedRow): LockDecision => lockDecision({ logInOrder, current: workout.current, tapped: row })

  // ─── Writers ─────────────────────────────────────────────────────────────────────────────────────
  // LOG or SKIP of a head (a planned working set, or an added one): the number is the row's.
  async function logHead(row: ResolvedRow, params: LogParams, supersetContext?: SupersetChainInput): Promise<SetLog> {
    const planned = plannedOf(row)
    const restElapsed = currentRestElapsed()
    applyRestChain({
      setOverrideSeconds: setOverrideFor(planned),
      isLastSetOfExercise: isLastPlannedSet(planned),
      stage: row.added ? stageContextForAddedHead(row) : stageContextForHead(planned),
      superset: supersetContext ?? null,
    })
    // An added set names its log before the request goes out (DECISIONS 174: its list entry carries the log's id), and its log
    // carries its place. A planned set's payload names neither, so it is what it was before this chunk.
    const logId = row.added && row.localId !== null ? crypto.randomUUID() : null
    if (logId !== null && row.localId !== null) {
      workout.linkLog(cardKey, row.localId, logId)
      // A dropset a swap moved here keeps its drops on this phone once its head is logged (no change row yet: chunk 62's).
      if (row.type?.kind === 'staged' && !params.isSkipped) workout.holdStages(logId, row.type.stageKind, row.type.stageCount)
    }
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
      // "As planned" (TASKS.md "Logging"): the row's own planned set; an added set has none, and keeps the kind of the type it was moved with.
      stageKind: row.added ? (row.stageKind ?? null) : (planned?.stageKind ?? null),
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
      stage: head.added ? stageContextForAddedStage(head, stageIndex) : stageContextForStage(headPlanned, stageIndex),
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
  // Chunk 59: a warmup a swap moved here is an added set like any other, so its log names itself and carries its place.
  async function logWarmup(row: ResolvedRow, params: LogParams): Promise<SetLog> {
    const planned = plannedOf(row)
    applyRestChain({ setOverrideSeconds: setOverrideFor(planned), isLastSetOfExercise: false, stage: null, superset: null })
    const logId = row.added && row.localId !== null ? crypto.randomUUID() : null
    if (logId !== null && row.localId !== null) workout.linkLog(cardKey, row.localId, logId)
    const { weekPlanSetId: _plannedId, setNumber: _number, ...rest } = params
    return onLog({
      ...rest,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      parentSetId: null,
      stageIndex: 0,
      isWarmup: true,
      ...(logId !== null ? { id: logId, addedPlace: row.addedPlace } : {}),
    })
  }

  // ─── DELETE (chunk 61; boards W7, W8, W9, W2b; SPEC [1.2] "Delete set (18b)") ────────────────────────────────────────────────────
  // `deleteEffects` (46r) says everything a delete does, for a logged set, an open one, a skipped one and a drop alike; `runDelete` sends it in its
  // order (setDelete.ts). The card adds what only it knows: what it draws from the first tap, and its own list of the sets added in the session.
  //   - The change rows are held (`workout.holdChanges`) from before the first request until they are in the session's cache, so a planned set
  //     whose log has gone and whose change row has not landed yet is never drawn as an open row.
  //   - A set added in the session leaves the card's list, logged or not, before its logs go (DECISIONS 170: "DELETE: the entry goes"): an entry
  //     left naming a log that is gone would be drawn as an open set. A drop deleted on its own gives its set the type it has afterwards, as the
  //     card keeps it (161).
  //   - `workout.track` holds the screen's own number corrections back until the whole delete, its renumber included, is done.
  // Rejects with the reason when something wasn't written (the confirm says so); a delete that needs a connection and has none writes nothing.
  async function handleDeleteRow(row: ResolvedRow): Promise<void> {
    const effects = deleteEffects(row, { rows: workout.rows, logs, changes: workout.changes })
    if (effects.headPatch !== null && !writers.online) throw new NeedsConnectionError()
    const head = headOf(row)
    const release = effects.changes.length > 0 ? workout.holdChanges(effects.changes.map((write) => write.change)) : null
    if (row.kind !== 'stage') {
      if (row.added && row.localId !== null) workout.removeAdded(cardKey, row.localId)
    } else if (effects.type !== null && head !== undefined && head.added && head.localId !== null) {
      workout.setAddedType(cardKey, head.localId, effects.type)
    }
    try {
      await workout.track(runDelete(effects, { deleteLog: (log) => onDeleteSet(log.id), writers }))
    } finally {
      release?.()
    }
  }

  /** DELETE in a row's ⋯ or edit panel: W9, with the numbers the row has now (a delete in progress changes what the row can say). */
  function askDelete(row: ResolvedRow) {
    const log = logOf(row)
    const numbers = log !== null ? loggedNumbersText(log, resolvedWeightUnit) : plannedNumbersText(targetsOf(row), resolvedWeightUnit)
    setConfirmDelete({ row, ...deleteConfirm(row, numbers) })
  }

  /** The CUES row of a set's ⋯ and the sheet it opens (board W7 → 8): only a planned working set has one (DECISIONS 165 (a): none for a set with no planned set). */
  function cuesOf(row: ResolvedRow): { planned: WeekPlanSet; heads: WeekPlanSet[] } | null {
    if (row.kind !== 'working' || row.weekPlanSetId === null) return null
    const planned = plannedById.get(row.weekPlanSetId)
    if (planned === undefined) return null
    // "Use for all" applies to the exercise's working heads that this workout still has (a deleted set is not counted, and is not written to).
    const heads = cardRows.flatMap((r) => (r.kind === 'working' && r.weekPlanSetId !== null ? [plannedById.get(r.weekPlanSetId)].filter((set): set is WeekPlanSet => set !== undefined) : []))
    return { planned, heads }
  }

  // ─── The exercise ⋯ (chunk 59; boards W10, W11) ──────────────────────────────────────────────────
  // Skip the rest of the exercise (DECISIONS 163 (a)): every open set of the card (`planSkipRest`): the planned working sets with their
  // drops as before, and now its open added sets and its unlogged warmups too, each skip carrying its `is_warmup` and, for an added set,
  // its place (a head log of an added set carries it, `logHead`). Sequential and awaited: a drop needs its head's real id. Each skip
  // stores the number its row shows. A skip of a warmup starts no rest.
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
  async function skipWarmup(row: ResolvedRow): Promise<SetLog> {
    const planned = plannedOf(row)
    const logId = row.added && row.localId !== null ? crypto.randomUUID() : null
    if (logId !== null && row.localId !== null) workout.linkLog(cardKey, row.localId, logId)
    const { weekPlanSetId: _plannedId, setNumber: _number, ...rest } = skipParams(planned)
    return onLog({
      ...rest,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      parentSetId: null,
      stageIndex: 0,
      stageKind: null,
      isWarmup: true,
      ...(logId !== null ? { id: logId, addedPlace: row.addedPlace } : {}),
    })
  }
  async function skipItems(items: readonly SkipItem[]) {
    for (const { head, skipHead, drops } of items) {
      const headLog = skipHead ? (head.kind === 'warmup' ? await skipWarmup(head) : await logHead(head, skipParams(plannedOf(head)))) : logOf(head)
      if (headLog === null) continue
      let stageIndex = logs.filter((log) => log.parentSetId === headLog.id).reduce((max, log) => Math.max(max, log.stageIndex), 0)
      for (const drop of drops) {
        stageIndex += 1
        // A drop of a planned head: its own planned stage, a stage_kind of null (the DB's own check), skipped.
        await writeStage(head, headLog, stageIndex, plannedOf(drop), drop.number, { ...skipParams(plannedOf(drop)), isDropset: true, stageKind: null })
      }
    }
  }

  const skipPlan = planSkipRest(workout.rows, cardKey)
  /** How many open sets a swap for today would move (a set added before 1.2 has no place to be named by and stays). */
  const swapMoves = skipPlan.items.filter((item) => item.skipHead && canMove(item.head)).length

  async function handleConfirmSkip() {
    setIsSkippingExercise(true)
    try {
      await skipItems(skipPlan.items)
    } catch (err) {
      console.error('Failed to skip exercise', err)
    } finally {
      setIsSkippingExercise(false)
    }
  }

  // Swap for today (DECISIONS 164, 179, 183, 199, 200). The swap's row with its record is saved FIRST, online (`onSwap`): a row that
  // can't be saved leaves every set as it was and skips none, and the real reason is shown. Then the moved sets are skipped on this
  // card, one skip each through the queue (an offline skip queues like any log).
  const [swapError, setSwapError] = useState<unknown>(null)
  const swapInFlight = useRef(false)
  async function handleConfirmSwap(newExercise: Exercise): Promise<void> {
    if (swapInFlight.current) return
    swapInFlight.current = true
    setSwapError(null)
    setIsSkippingExercise(true)
    try {
      let plan: ReturnType<typeof planSwap>
      try {
        plan = planSwap({
          order: workout.order,
          rows: workout.rows,
          logs,
          cardKey,
          target: { exerciseId: newExercise.id, name: newExercise.name },
          newId: () => crypto.randomUUID(),
        })
        await onSwap({ programExercise, exercise: newExercise, record: plan.record, entries: plan.entries })
      } catch (err) {
        setSwapError(err)
        return
      }
      setShowSwapSheet(false)
      try {
        await skipItems(plan.skip.items)
      } catch (err) {
        console.error('Failed to skip the sets a swap moved', err)
      }
    } finally {
      swapInFlight.current = false
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
    isSkippingExercise,
    showSwapSheet,
    setShowSwapSheet,
    swapError,
    clearSwapError: () => setSwapError(null),
    plannedOf,
    targetsOf,
    logOf,
    lastFor,
    skipPlan,
    swapMoves,
    /** "Swap for today" is offered only where today's app offers it: a planned slot's card no swap has touched (DECISIONS 199 (a)). */
    canSwap: swappedFrom === undefined && slotSwapped !== true && addedToday !== true,
    /** + ADD SET and "Add a set" are not offered on the card a swap moved sets from (TASKS 59). */
    canAddSet: setsMoved !== true,
    currentRestElapsed,
    lockFor,
    logHead,
    logStage,
    logAdHocStage,
    logWarmup,
    handleDeleteRow,
    confirmDelete,
    askDelete,
    closeDeleteConfirm: () => setConfirmDelete(null),
    cuesOf,
    writers,
    handleConfirmSkip,
    handleConfirmSwap,
    handleAddSet: () => workout.addSet(cardKey),
  }
}

export type ExerciseCardState = ReturnType<typeof useExerciseCardState>
