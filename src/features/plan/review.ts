// Chunk 43 (TASKS-1.2 "REVIEW as a pure function"; SPEC.md [1.2] "Review: what went differently last
// week" (13), Defaults 4 and 10, G52, and Adam's answer to G56, DECISIONS 131) — everything board 4
// (REVIEW) decides, as one tested module: which of last week's differences from its plan are items, the
// one key each item is decided by, the board's wording for each, and the writes each action means. No
// I/O, no React, no clock: chunk 56's sheet reads last week's done sessions with their logs, swaps and
// session set changes, both weeks' plans and this week's decisions, calls `reviewItems`, and turns what
// `applyReviewAction` returns into one `v2_apply_ops` request (47). Nothing imports it until 56.
//
// ─── Which items there are (SPEC 13, TASKS 43) ───────────────────────────────────────────────────
// Only a DONE session of last week is read: `completed`. A session `skipped` as a whole gives nothing
// (G52), so do `planned` and `in_progress` ones ("While last week isn't finished, its items come from
// its done sessions only") and a workout nobody started (no session). Per planned HEAD of that session
// (stage rows are never sets of their own, CONTEXT "Stage-exclusion"; a warmup is a planned set):
// SPEC lists "Skipped" with the number items ("only where last week had a planned weight or reps") and sets
// the structural items apart as "for everyone, including people who plan no numbers", so a set the plan
// gave neither a weight nor a rep target (a number, a range or AMRAP) is no number item and no "Skipped",
// and is still a type item when its kind changed.
//   - "Skipped" (a skipped log, or a `deleted` session set change: SPEC 18b "counts as Skipped") or
//     "Not logged" (no log in a completed session);
//   - a NUMBER item: the done weight differs from the planned one (as the exercise's unit shows them: the
//     8.98 kg of a typed 19.8 lbs is the planned 9 kg); reps planned as a number and done differently; reps
//     planned as a range and done outside it; AMRAP reps never count, its weight still does. RIR is shown
//     alongside and never makes an item. A done number that was never entered (a ticked warmup's blank
//     weight and reps) is nothing to take over, so it never differs;
//   - a TYPE item ("You made set 02 a dropset"): the type the workout gave the set differs from the planned
//     type (warmup, normal, or a stage kind), or the same stage kind has more drops DONE than planned. The
//     workout's type is read from the session's change rows and the log (DECISIONS 141, Adam 2026-10-15):
//     the set's `retyped` row (keyed by the planned set, logged or not) when it has one, else its log's own
//     kind (the type as done). So a set given a stage kind it didn't have is an item whether or not its
//     drops were done (a plain set made a dropset, a dropset made rest-pause); one that keeps the planned
//     kind with its drops not done is not (a stage row is no set, and SPEC lists only "a drop or stage
//     added"); a planned staged set switched back to Normal is one (19c) when its log gave the kind up or
//     its `retyped` row says normal, and only the row can tell a kindless dropset (before 1.1, and what
//     Plan's ADD STAGE still leaves) switched to Normal from one logged as planned: both leave a null kind.
//     The stage count its USE writes is the count set in the workout: the drops done when some were, else
//     the `retyped` row's count, else the `pending_stages` row's (keyed by the logged head), else 1.
// Per exercise: a set added during the session (a log with no planned set, on an exercise of the plan)
// is an ADDED SET item, never a type item: it has no planned set, so no `retyped` row (Adam's data-model
// rule), and the stage kind it was given, drops done or not, is part of the added set (the drops done, else
// its `pending_stages` row's count, else 1); the sets of an exercise that isn't in the plan are one ADDED EXERCISE item; a
// recorded swap (`v2_session_exercise_swaps`) is one SWAPPED item, and the original's sets that the swap
// skipped (or never logged) are part of it, not "Skipped" items of their own.
//
// ─── Keys: what a decision is stored under ───────────────────────────────────────────────────────
// `itemKey` is the one function. No key holds a set log id ("a decision survives last week's set being
// unlogged and logged again"): planned set ids, exercise ids, program exercise ids, a session id and a
// position instead. TASKS names `num:<planned set id>`, `skipped:<planned set id>` and
// `type:<planned set id>`; they carry the SESSION id too here, because one plan row can stand for two
// weekdays (G14: Tuesday and Thursday share it), so two sessions of last week hold items about the same
// planned set, and a key without the session would be one decision for both (the table's unique key,
// `(week_plan_id, item_key)`, would refuse the second). The decision is stored on THIS week's plan row of
// the same workout (the same slot: the workout and, on a sequence run, its position).
//
// ─── Which week is "last week" (Defaults 10, DECISIONS 131) ──────────────────────────────────────
// The week before the one shown, whatever else is planned: the week shown is a parameter (TASKS' signature
// has none; week 1 and "the week before" need it), and only plan rows of week N − 1 are last week's, only
// those of week N this week's. After a missed week (131: "REVIEW and VOLUME treat the missed week as a week
// with nothing in it") there are none, so there is nothing, and an older week's rows passed by mistake are
// not read ("never reach back to an older week"). Week 1 has no REVIEW.
//
// ─── What each action writes (SPEC 13, "Actions") ─────────────────────────────────────────────────
// `applyReviewAction` returns the writes and the decision row. The writes name the week set's own fields
// (`targetWeight`, `repMin`, …) as `weekPlanService.updateSet` and `weekPlanning.copyNumbers` do, so
// chunk 56 maps them to ops; ids of new rows come from `newId`. The set an item is about is matched in
// THIS week by `weekPlanning.ts`'s own pairing (exercise, then position, warmups to warmups and working
// sets to working sets) on the PLANNED positions of both weeks, so a set the session deleted doesn't
// shift its neighbours. ADD EXERCISE and SWAP FROM WEEK N are returned as plain descriptions of the
// CHANGE THE PROGRAM change (`program_edit`); chunk 45's `planProgramChange` turns them into ops.
//
// What this module does not do: read Settings (the unit and the schedule's word for a week are
// parameters), know whether this week's session of a workout is already done, or write anything.

import { format, parseISO } from 'date-fns'
import type {
  ProgramExercise,
  ReviewDecision,
  Session,
  SessionSetChange,
  SessionSetChangeType,
  SetLog,
  WeekPlan,
  WeekPlanSet,
  WeekReviewDecision,
  WeightUnit,
} from '../../types'
import {
  STAGE_KIND_LABELS,
  columnsToRepTarget,
  formatRepTarget,
  repTargetToColumns,
  resolveStageKind,
  type RepTarget,
  type StageKind,
} from '../../lib/plannerVocabulary'
import { resolveWeightUnit, toDisplayWeight } from '../../lib/weightUnit'
import { pairByExercise, pairSets, weeksOfSlot } from './weekPlanning'

// ═══ The shapes it reads ════════════════════════════════════════════════════════════════════════
// Each is the fields read, picked from the app's own types: a real `WeekPlan`, `Session` and `SetLog`
// are accepted as they are (the tests build the real types).

/** A plan's exercise row: its identity, order, unit and (joined) name. A real `ProgramExercise` fits. */
export interface ReviewExerciseRow extends Pick<ProgramExercise, 'id' | 'exerciseId' | 'position'> {
  weightUnit?: WeightUnit | null
  exercise?: { name: string }
}

/** A planned set row (a head or a stage). A real `WeekPlanSet` fits. */
export type ReviewSetRow = Pick<
  WeekPlanSet,
  | 'id'
  | 'programExerciseId'
  | 'setNumber'
  | 'parentWeekPlanSetId'
  | 'stageIndex'
  | 'isWarmup'
  | 'stageKind'
  | 'targetWeight'
  | 'targetRir'
  | 'targetRirMax'
  | 'repMin'
  | 'repMax'
  | 'isAmrap'
>

/** One workout's plan in one week: its row, slot, exercises (that week's own list) and sets. A real `WeekPlan` fits. */
export interface ReviewPlan extends Pick<WeekPlan, 'id' | 'workoutDayId' | 'weekNumber'> {
  sequencePosition?: number | null
  workoutDay?: { name: string }
  exercises: readonly ReviewExerciseRow[]
  sets: readonly ReviewSetRow[]
}

/** A logged set (a head, or a stage under one). A real `SetLog` fits. */
export interface ReviewLog
  extends Pick<
    SetLog,
    'id' | 'exerciseId' | 'weekPlanSetId' | 'setNumber' | 'weight' | 'reps' | 'rir' | 'parentSetId' | 'isWarmup' | 'isSkipped' | 'loggedAt'
  > {
  stageKind?: StageKind | null
  exercise?: { name: string }
}

/** A session's recorded swap (`v2_session_exercise_swaps`). A real `ExerciseSwap` fits. */
export interface ReviewSwap {
  programExerciseId: string | null
  originalExerciseId: string | null
  originalExerciseName: string
  replacementExerciseId: string | null
  replacementExerciseName: string
}

/** A session of last week with what it recorded. A real `Session` (with `setLogs`) fits. */
export interface ReviewSession extends Pick<Session, 'id' | 'weekPlanId' | 'status' | 'date'> {
  movedToDate?: string | null
  workoutDay?: { name: string }
  setLogs?: readonly ReviewLog[]
  swaps?: readonly ReviewSwap[]
  /**
   * This session's own `v2_session_set_changes`, all three kinds: `deleted` (a planned set removed: "Skipped"),
   * `retyped` (the type the workout gave a planned set, keyed by it whether or not it was logged: it wins over
   * the log) and `pending_stages` (the drops still to do under a logged head, keyed by its log: a count).
   */
  sessionSetChanges?: readonly SessionSetChange[]
}

export interface ReviewInput {
  /** The week (cycle) shown: a whole number from 1. Last week is week − 1 and nothing else. */
  weekNumber: number
  lastWeek: { sessions: readonly ReviewSession[]; plan: readonly ReviewPlan[] }
  /** This week's plan rows (those of other weeks are not read): where a decision is stored and where an action writes. */
  thisWeek: readonly ReviewPlan[]
  /** `v2_week_review_decisions` of this week's rows: an item with one of these keys on that row is gone. */
  decisions: ReadonlyArray<Pick<WeekReviewDecision, 'weekPlanId' | 'itemKey'>>
  /** Names for exercises a plan row doesn't carry (an added exercise's logs may not be joined). */
  exercises?: ReadonlyArray<{ id: string; name: string }>
  /** Workout names, when a plan row or session carries none. */
  workouts?: ReadonlyArray<{ id: string; name: string }>
  /** Settings' unit: what a weight reads in unless its exercise has a unit of its own. Default kg. */
  weightUnit?: WeightUnit
}

// ═══ The items ═══════════════════════════════════════════════════════════════════════════════════

/** What a plan said about a set's numbers. `reps` is the rep target (number, range, AMRAP or none). */
export interface PlannedNumbers {
  weight: number | null
  reps: RepTarget
  rir: number | null
  rirMax: number | null
}

/** A set as it was done: its numbers and its type (a warmup, a plain set, or a stage kind with its drops). */
export interface DoneSet {
  weight: number | null
  reps: number | null
  rir: number | null
  type: SessionSetChangeType
}

/** The set (and exercise row) of THIS week an item's action writes to; null where this week has none. */
export interface ReviewTarget {
  programExerciseId: string | null
  setId: string | null
}

interface ItemBase {
  sessionId: string
  /** This week's plan row of the same workout: where the decision lives. */
  weekPlanId: string
}

interface PlannedSetItemBase extends ItemBase {
  /** Last week's planned set the item is about. */
  plannedSetId: string
  exerciseId: string
  exerciseName: string
  /** As the screen numbers it: its place among the exercise's planned sets of its own kind (warmups apart). */
  setNumber: number
  isWarmup: boolean
  unit: WeightUnit
  target: ReviewTarget
}

export interface ReviewNumberItem extends PlannedSetItemBase {
  kind: 'number'
  planned: PlannedNumbers
  done: DoneSet
  weightDiffers: boolean
  repsDiffer: boolean
}

export interface ReviewSkippedItem extends PlannedSetItemBase {
  kind: 'skipped'
  /** 'skipped': a skipped log, or the set was deleted during the session. 'not_logged': no log at all. */
  reason: 'skipped' | 'not_logged'
  planned: PlannedNumbers
}

export interface ReviewRetypedItem extends PlannedSetItemBase {
  kind: 'retyped'
  plannedType: SessionSetChangeType
  doneType: SessionSetChangeType
}

export interface ReviewAddedSetItem extends ItemBase {
  kind: 'added_set'
  exerciseId: string
  exerciseName: string
  /** The added set's number in the session (warmups numbered apart). */
  setNumber: number
  unit: WeightUnit
  done: DoneSet
  target: { programExerciseId: string | null }
}

export interface ReviewAddedExerciseItem extends ItemBase {
  kind: 'added_exercise'
  exerciseId: string
  exerciseName: string
  unit: WeightUnit
  /** Every set done on it, warmups first: what this week gets, as many sets with the done numbers. */
  sets: DoneSet[]
  /** The exercise of THIS week's plan it followed in the session (the one it goes after); null: it goes first. */
  after: { programExerciseId: string } | null
}

export interface ReviewSwappedItem extends ItemBase {
  kind: 'swapped'
  /** Last week's slot (its program exercise row). */
  programExerciseId: string
  originalExerciseId: string
  originalExerciseName: string
  replacementExerciseId: string
  replacementExerciseName: string
  /** Working sets done on the replacement, and working sets the original had planned. */
  doneSets: number
  plannedSets: number
  /** THIS week's row of the slot; null when this week has no such exercise any more. */
  target: { programExerciseId: string | null }
}

export type ReviewItem =
  | ReviewNumberItem
  | ReviewSkippedItem
  | ReviewRetypedItem
  | ReviewAddedSetItem
  | ReviewAddedExerciseItem
  | ReviewSwappedItem

export type ReviewItemKind = ReviewItem['kind']

/** An item with the key its decision is stored under (`itemKey(item)`, computed once). */
export interface ReviewEntry {
  key: string
  item: ReviewItem
}

/** The items of one session of last week, under its heading ("TUE · UPPER A"). */
export interface ReviewGroup {
  sessionId: string
  /** THIS week's plan row of the workout. */
  weekPlanId: string
  workoutDayId: string
  workoutName: string
  /** The day the session was for (`movedToDate` when it was moved). */
  date: string
  heading: string
  items: ReviewEntry[]
}

/**
 * The one function every decision's key comes from. Never a set log id; see the header.
 *   number          num:<session>:<planned set>
 *   skipped         skipped:<session>:<planned set>
 *   retyped         type:<session>:<planned set>
 *   added set       added-set:<session>:<exercise>:<position>   (position: the set number; `w` before a warmup's)
 *   added exercise  added-ex:<session>:<exercise>
 *   swapped         swap:<session>:<program exercise (last week's slot)>
 */
export function itemKey(item: ReviewItem): string {
  switch (item.kind) {
    case 'number':
      return `num:${item.sessionId}:${item.plannedSetId}`
    case 'skipped':
      return `skipped:${item.sessionId}:${item.plannedSetId}`
    case 'retyped':
      return `type:${item.sessionId}:${item.plannedSetId}`
    case 'added_set':
      return `added-set:${item.sessionId}:${item.exerciseId}:${item.done.type.kind === 'warmup' ? 'w' : ''}${item.setNumber}`
    case 'added_exercise':
      return `added-ex:${item.sessionId}:${item.exerciseId}`
    case 'swapped':
      return `swap:${item.sessionId}:${item.programExerciseId}`
  }
}

// ─── Reading a set's plan and what was done ────────────────────────────────────────────────────

function plannedNumbers(set: ReviewSetRow): PlannedNumbers {
  return {
    weight: set.targetWeight ?? null,
    reps: columnsToRepTarget({ repMin: set.repMin ?? null, repMax: set.repMax ?? null, isAmrap: set.isAmrap ?? false }),
    rir: set.targetRir ?? null,
    rirMax: set.targetRirMax ?? null,
  }
}

// A planned head's type as Plan shows it: a warmup, a staged set (it has stage rows; a null kind reads as a
// dropset), or a plain one. A stage kind on a head without stage rows shows nowhere (`weekPlanning.kindKey`).
function plannedTypeOf(head: ReviewSetRow, stageRows: readonly ReviewSetRow[]): SessionSetChangeType {
  if (head.isWarmup) return { kind: 'warmup' }
  if (stageRows.length > 0) {
    return { kind: 'staged', stageKind: resolveStageKind(head.stageKind ?? null), stageCount: stageRows.length }
  }
  return { kind: 'normal' }
}

// The type the WORKOUT gave a set, where something recorded it; undefined where nothing says it changed
// (done as planned, or the record can't tell). A staged kind may come without a count (`stageCount: null`):
// the count is then read from the drops done and the `pending_stages` row (`doneTypeOf`).
type GivenType =
  | { kind: 'warmup' }
  | { kind: 'normal' }
  | { kind: 'staged'; stageKind: StageKind; stageCount: number | null }

// DECISIONS 141 (Adam, 2026-10-15): "Both cases are seen through the session's change rows"; SPEC Objects
// stored: the type changed during the workout "is recorded on the session's set" (the log's `is_warmup` and
// `stage_kind`). Read in this order:
//   1. The set's `retyped` row, keyed by the planned set whether or not it is logged (one per planned set per
//      session, so the latest type): that is the type the workout gave it, and it wins over the log. It is
//      the only record that tells a kindless dropset (a planned head with stage rows and no kind, which reads
//      as a dropset) switched to Normal from one logged as planned: the log's kind is null both ways.
//   2. The log: a warmup flag; a stage kind other than the one the plan holds for the set (a staged set's own,
//      a null kind reading as a dropset, or a plain set's raw head kind, which shows nowhere) is a kind it was
//      given, drops done or not; the plan's kind kept, or a null/null pair, is the set as planned.
//   3. A planned staged set whose head has a kind and whose log has none was switched back to Normal (19c;
//      TASKS 62 leaves the log's `stage_kind` null). An added set (no `planned`) has nothing to be switched from.
function givenType(
  planned: { head: ReviewSetRow; type: SessionSetChangeType } | undefined,
  log: ReviewLog,
  retyped: SessionSetChangeType | undefined,
): GivenType | undefined {
  if (retyped !== undefined) return retyped
  if (log.isWarmup) return { kind: 'warmup' }
  const logged = log.stageKind ?? null
  const held = planned === undefined ? null : planned.type.kind === 'staged' ? planned.type.stageKind : (planned.head.stageKind ?? null)
  if (logged !== null) return logged === held ? undefined : { kind: 'staged', stageKind: logged, stageCount: null }
  return planned !== undefined && planned.type.kind === 'staged' && (planned.head.stageKind ?? null) !== null ? { kind: 'normal' } : undefined
}

// A drop is done when it was logged and not skipped.
const dropsDone = (stageLogs: readonly ReviewLog[]): number => stageLogs.filter((s) => !s.isSkipped).length

// A logged head's type as it was DONE: a warmup, a staged set, or a plain one. Drops done give a staged set its
// count ("USE writes the stage count set in the workout: … the drops done when some were"); with none done, a
// stage kind the workout gave the set still makes it a staged one, with the count the `retyped` row holds, else
// the `pending_stages` row of the head (the set's total drops), else 1 (picking a staged kind adds its first
// stage). A stage kind the log merely keeps (the plan's own), with no drop done, is a plain set: a stage row is no set.
function doneTypeOf(head: ReviewLog, drops: number, given: GivenType | undefined, pending: number | undefined): SessionSetChangeType {
  if (given?.kind === 'warmup') return { kind: 'warmup' }
  if (drops > 0) {
    return { kind: 'staged', stageKind: given?.kind === 'staged' ? given.stageKind : resolveStageKind(head.stageKind ?? null), stageCount: drops }
  }
  if (given?.kind === 'staged') return { kind: 'staged', stageKind: given.stageKind, stageCount: given.stageCount ?? pending ?? 1 }
  return { kind: 'normal' }
}

// "You made set 02 a dropset": the type the workout gave differs from the planned one, or the same stage kind has
// more drops DONE than planned (`drops`, never the count set: the kind is the same and nothing more was done).
// Fewer drops than planned are not an item. A planned staged set done without its drops reads as a plain one,
// and that is an item only when the workout switched it to Normal (`given`): the log's null kind under a kindless
// planned head, with no row to say so, is a set logged as planned.
function typeChanged(planned: SessionSetChangeType, done: SessionSetChangeType, drops: number, given: GivenType | undefined): boolean {
  if (planned.kind !== done.kind) return planned.kind === 'staged' && done.kind === 'normal' ? given?.kind === 'normal' : true
  if (planned.kind === 'staged' && done.kind === 'staged') {
    return planned.stageKind !== done.stageKind || drops > planned.stageCount
  }
  return false
}

// Two stored weights (kg) are the same when they read the same in the exercise's unit: 9 kg and the 8.98 kg
// that typing the displayed 19.8 lbs stores are both 19.8 lbs, and a set done as planned is not an item.
function sameWeight(a: number, b: number, unit: WeightUnit): boolean {
  return toDisplayWeight(a, unit) === toDisplayWeight(b, unit)
}

// "Only where last week had a planned weight or reps": a rep target of any kind (a number, a range, AMRAP) is reps.
function hasPlannedNumbers(planned: PlannedNumbers): boolean {
  return planned.weight != null || planned.reps.type !== 'none'
}

// SPEC 13c. A number is only compared where the plan had one and the log has one.
function numbersDiffer(
  planned: PlannedNumbers,
  log: Pick<ReviewLog, 'weight' | 'reps'>,
  unit: WeightUnit,
): { weight: boolean; reps: boolean } {
  const weight = planned.weight != null && log.weight != null && !sameWeight(log.weight, planned.weight, unit)
  let reps = false
  if (log.reps != null) {
    if (planned.reps.type === 'number') reps = log.reps !== planned.reps.value
    else if (planned.reps.type === 'range') reps = log.reps < planned.reps.min || log.reps > planned.reps.max
    // AMRAP: "reps never count"; none: nothing was planned.
  }
  return { weight, reps }
}

// ─── Reading a session ─────────────────────────────────────────────────────────────────────────

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? -Infinity : t
}

// The log standing for a planned head: a done one if there is one, the latest if there are several.
function headLogOf(logs: readonly ReviewLog[] | undefined): ReviewLog | undefined {
  if (!logs || logs.length === 0) return undefined
  const done = logs.filter((l) => !l.isSkipped)
  const pool = done.length > 0 ? done : logs
  return pool.reduce((best, l) => (time(l.loggedAt) >= time(best.loggedAt) ? l : best))
}

interface Context {
  decided: Set<string>
  exerciseNames: Map<string, string>
  workoutNames: Map<string, string>
  weightUnit: WeightUnit
}

function doneSetOf(head: ReviewLog, type: SessionSetChangeType): DoneSet {
  return { weight: head.weight ?? null, reps: head.reps ?? null, rir: head.rir ?? null, type }
}

// Every item of one done session of last week, in the order the workout was laid out: each exercise's
// swap, its planned sets in set order, its added sets; then the exercises added during the session.
function sessionItems(session: ReviewSession, lastPlan: ReviewPlan, thisPlan: ReviewPlan, ctx: Context): ReviewItem[] {
  const items: ReviewItem[] = []
  const sessionId = session.id
  const weekPlanId = thisPlan.id

  const logs = session.setLogs ?? []
  const headLogs: ReviewLog[] = []
  const stageLogsOf = new Map<string, ReviewLog[]>()
  const logsOfPlannedSet = new Map<string, ReviewLog[]>()
  const logNames = new Map<string, string>()
  for (const log of logs) {
    if (log.exercise?.name) logNames.set(log.exerciseId, log.exercise.name)
    if (log.parentSetId != null) {
      pushTo(stageLogsOf, log.parentSetId, log)
      continue
    }
    headLogs.push(log)
    if (log.weekPlanSetId != null) pushTo(logsOfPlannedSet, log.weekPlanSetId, log)
  }

  // The session's change rows (042), each kind by its own key: a planned set deleted (before it was logged, or
  // after: a stale log of it is not read), the type the workout gave a planned set (the row is keyed by it
  // whether or not it was logged), and the drops still to do under a logged head (the set's total, keyed by its log).
  const deleted = new Set<string>()
  const retypedOf = new Map<string, SessionSetChangeType>()
  const pendingDropsOf = new Map<string, number>()
  for (const change of session.sessionSetChanges ?? []) {
    switch (change.kind) {
      case 'deleted':
        deleted.add(change.weekPlanSetId)
        break
      case 'retyped':
        retypedOf.set(change.weekPlanSetId, change.type)
        break
      case 'pending_stages':
        pendingDropsOf.set(change.setLogId, change.stageCount)
        break
    }
  }
  // A set nobody planned has no plan to differ from, and so no `retyped` row: its stage kind is the kind it was
  // given, and its type is shown with the added set (REVIEW lists it as an added set, never as a type change).
  const addedDoneSet = (head: ReviewLog): DoneSet =>
    doneSetOf(head, doneTypeOf(head, dropsDone(stageLogsOf.get(head.id) ?? []), givenType(undefined, head, undefined), pendingDropsOf.get(head.id)))

  const exerciseRows = [...lastPlan.exercises].sort((a, b) => a.position - b.position)
  const planNames = new Map<string, string>()
  for (const row of exerciseRows) if (row.exercise?.name && !planNames.has(row.exerciseId)) planNames.set(row.exerciseId, row.exercise.name)
  const nameOf = (exerciseId: string): string =>
    planNames.get(exerciseId) ?? ctx.exerciseNames.get(exerciseId) ?? logNames.get(exerciseId) ?? ''
  const unitOf = (row: ReviewExerciseRow | undefined): WeightUnit => resolveWeightUnit(row?.weightUnit, ctx.weightUnit)

  // This week's row for each of last week's: the same pairing COPY uses (exercise, nth with nth).
  const thisRowOfLast = new Map<string, string>()
  for (const [thisRow, lastRow] of pairByExercise(thisPlan.exercises, lastPlan.exercises)) thisRowOfLast.set(lastRow.id, thisRow.id)
  const firstRowOfExercise = new Map<string, ReviewExerciseRow>()
  for (const row of exerciseRows) if (!firstRowOfExercise.has(row.exerciseId)) firstRowOfExercise.set(row.exerciseId, row)
  const thisRowOfExercise = (exerciseId: string): string | null => {
    const row = firstRowOfExercise.get(exerciseId)
    return row ? (thisRowOfLast.get(row.id) ?? null) : null
  }

  // Swaps: one item each for a slot of the plan (only the plan's own rows are looked up); the replacement's own logs belong to it.
  const swapBySlot = new Map<string, ReviewSwap>()
  const replacementIds = new Set<string>()
  for (const swap of session.swaps ?? []) {
    if (swap.replacementExerciseId != null) replacementIds.add(swap.replacementExerciseId)
    if (swap.programExerciseId != null && !swapBySlot.has(swap.programExerciseId)) swapBySlot.set(swap.programExerciseId, swap)
  }
  const planExerciseIds = new Set(exerciseRows.map((r) => r.exerciseId))

  for (const row of exerciseRows) {
    const exerciseName = nameOf(row.exerciseId)
    const unit = unitOf(row)

    const swap = swapBySlot.get(row.id)
    if (swap && swap.originalExerciseId != null && swap.replacementExerciseId != null) {
      const isWorkingHead = (s: ReviewSetRow) => s.parentWeekPlanSetId == null && !s.isWarmup
      items.push({
        kind: 'swapped',
        sessionId,
        weekPlanId,
        programExerciseId: row.id,
        originalExerciseId: swap.originalExerciseId,
        originalExerciseName: swap.originalExerciseName,
        replacementExerciseId: swap.replacementExerciseId,
        replacementExerciseName: swap.replacementExerciseName,
        doneSets: headLogs.filter((l) => l.exerciseId === swap.replacementExerciseId && !l.isWarmup && !l.isSkipped).length,
        plannedSets: lastPlan.sets.filter((s) => s.programExerciseId === row.id && isWorkingHead(s)).length,
        target: { programExerciseId: thisRowOfLast.get(row.id) ?? null },
      })
    }
    const swapped = swapBySlot.has(row.id)

    const rowSets = lastPlan.sets.filter((s) => s.programExerciseId === row.id)
    const plannedHeads = rowSets.filter((s) => s.parentWeekPlanSetId == null).sort((a, b) => a.setNumber - b.setNumber)
    const stageRowsOf = (head: ReviewSetRow) => rowSets.filter((s) => s.parentWeekPlanSetId === head.id)

    // This week's counterpart of each planned set, on the planned positions of both weeks.
    const thisRowId = thisRowOfLast.get(row.id) ?? null
    const matched = new Map<string, string>()
    if (thisRowId !== null) {
      for (const [thisSet, lastSet] of pairSets(thisPlan.sets.filter((s) => s.programExerciseId === thisRowId), rowSets)) {
        matched.set(lastSet.id, thisSet.id)
      }
    }

    let warmups = 0
    let working = 0
    for (const head of plannedHeads) {
      const setNumber = head.isWarmup ? ++warmups : ++working
      const planned = plannedNumbers(head)
      const common = {
        sessionId,
        weekPlanId,
        plannedSetId: head.id,
        exerciseId: row.exerciseId,
        exerciseName,
        setNumber,
        isWarmup: head.isWarmup,
        unit,
        target: { programExerciseId: thisRowId, setId: matched.get(head.id) ?? null },
      }

      const log = headLogOf(logsOfPlannedSet.get(head.id))
      // A set the session deleted is Skipped whatever a stale log says; no log in a finished session is
      // Not logged. On a swapped slot the original's remaining sets are the swap's (it skips them), and a
      // set the plan gave no numbers is no Skipped item (SPEC lists it with the number items).
      if (deleted.has(head.id) || log === undefined || log.isSkipped) {
        if (!swapped && hasPlannedNumbers(planned)) {
          items.push({ kind: 'skipped', ...common, reason: deleted.has(head.id) || log !== undefined ? 'skipped' : 'not_logged', planned })
        }
        continue
      }
      // A log of another exercise (the seed relabels a swap's logs, keeping the planned set) is no comparison.
      if (log.exerciseId !== row.exerciseId) continue

      const plannedType = plannedTypeOf(head, stageRowsOf(head))
      const drops = dropsDone(stageLogsOf.get(log.id) ?? [])
      const given = givenType({ head, type: plannedType }, log, retypedOf.get(head.id))
      const done = doneSetOf(log, doneTypeOf(log, drops, given, pendingDropsOf.get(log.id)))
      const differs = numbersDiffer(planned, log, unit)
      if (differs.weight || differs.reps) {
        items.push({ kind: 'number', ...common, planned, done, weightDiffers: differs.weight, repsDiffer: differs.reps })
      }
      if (typeChanged(plannedType, done.type, drops, given)) {
        items.push({ kind: 'retyped', ...common, plannedType, doneType: done.type })
      }
    }

    // Sets added during the session to an exercise of the plan (a log with no planned set).
    const added = headLogs
      .filter(
        (l) =>
          l.weekPlanSetId == null &&
          !l.isSkipped &&
          l.exerciseId === row.exerciseId &&
          firstRowOfExercise.get(row.exerciseId) === row &&
          !replacementIds.has(l.exerciseId),
      )
      .sort((a, b) => Number(b.isWarmup) - Number(a.isWarmup) || a.setNumber - b.setNumber || time(a.loggedAt) - time(b.loggedAt))
    for (const log of added) {
      items.push({
        kind: 'added_set',
        sessionId,
        weekPlanId,
        exerciseId: row.exerciseId,
        exerciseName,
        setNumber: log.setNumber,
        unit,
        done: addedDoneSet(log),
        target: { programExerciseId: thisRowId },
      })
    }
  }

  // Exercises added during the session: their logs have no planned set and no place in the plan.
  const addedByExercise = new Map<string, ReviewLog[]>()
  for (const log of headLogs) {
    if (log.weekPlanSetId != null || log.isSkipped) continue
    if (planExerciseIds.has(log.exerciseId) || replacementIds.has(log.exerciseId)) continue
    pushTo(addedByExercise, log.exerciseId, log)
  }
  const addedExercises = [...addedByExercise.entries()]
    .map(([exerciseId, list]) => ({ exerciseId, list, first: Math.min(...list.map((l) => time(l.loggedAt))) }))
    .sort((a, b) => a.first - b.first || (a.exerciseId < b.exerciseId ? -1 : 1))
  for (const { exerciseId, list, first } of addedExercises) {
    const sets = [...list]
      .sort((a, b) => Number(b.isWarmup) - Number(a.isWarmup) || a.setNumber - b.setNumber || time(a.loggedAt) - time(b.loggedAt))
      .map(addedDoneSet)
    items.push({
      kind: 'added_exercise',
      sessionId,
      weekPlanId,
      exerciseId,
      exerciseName: nameOf(exerciseId),
      unit: ctx.weightUnit,
      sets,
      after: followedExercise(exerciseId, first, logs, planExerciseIds, thisRowOfExercise),
    })
  }

  return items
}

// "Placed after the exercise it followed": the planned exercise (of THIS week's plan) whose set was logged
// last before the added exercise's first one. An exercise this week no longer has is passed over for the one
// before it; nothing before it at all, and it goes first.
function followedExercise(
  exerciseId: string,
  firstLoggedAt: number,
  logs: readonly ReviewLog[],
  planExerciseIds: ReadonlySet<string>,
  thisRowOfExercise: (exerciseId: string) => string | null,
): { programExerciseId: string } | null {
  const before = logs
    .filter((l) => l.exerciseId !== exerciseId && !l.isSkipped && planExerciseIds.has(l.exerciseId) && time(l.loggedAt) < firstLoggedAt)
    .sort((a, b) => time(b.loggedAt) - time(a.loggedAt))
  for (const log of before) {
    const row = thisRowOfExercise(log.exerciseId)
    if (row !== null) return { programExerciseId: row }
  }
  return null
}

function weekdayOf(date: string): string {
  try {
    return format(parseISO(date), 'EEE').toUpperCase()
  } catch {
    return ''
  }
}

/**
 * REVIEW's items for the week shown, grouped by the workout (session) of last week they come from, in the
 * order of last week's days. Only items still to decide: a decided one (a decision on this week's row of
 * the workout with its key) is gone and never comes back. No items for week 1, none when last week has no
 * plan (a missed week, DECISIONS 131), none from a session that isn't completed.
 */
export function reviewItems(input: ReviewInput): ReviewGroup[] {
  const { weekNumber } = input
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    throw new RangeError(`reviewItems: the week shown must be an integer >= 1 (got ${weekNumber})`)
  }
  // Week 1 has no REVIEW, and "last week" is the week before the one shown: nothing older is ever read.
  if (weekNumber === 1) return []
  const lastPlans = new Map(input.lastWeek.plan.filter((p) => p.weekNumber === weekNumber - 1).map((p) => [p.id, p]))
  if (lastPlans.size === 0) return []
  // The same for this week: only the rows of the week shown are where a decision is stored or a write goes.
  const thisPlans = input.thisWeek.filter((p) => p.weekNumber === weekNumber)

  const ctx: Context = {
    decided: new Set(input.decisions.map((d) => `${d.weekPlanId}\u0000${d.itemKey}`)),
    exerciseNames: new Map((input.exercises ?? []).map((e) => [e.id, e.name])),
    workoutNames: new Map((input.workouts ?? []).map((w) => [w.id, w.name])),
    weightUnit: input.weightUnit ?? 'kg',
  }

  const found: Array<{ order: string; group: ReviewGroup }> = []
  for (const session of input.lastWeek.sessions) {
    if (session.status !== 'completed' || session.weekPlanId == null) continue
    const lastPlan = lastPlans.get(session.weekPlanId)
    if (!lastPlan) continue
    // The same workout this week (its slot): no counterpart, nowhere to store a decision or write.
    const thisPlan = weeksOfSlot(thisPlans, lastPlan.workoutDayId, lastPlan.sequencePosition ?? null)[0]
    if (!thisPlan) continue

    const seen = new Set<string>()
    const entries: ReviewEntry[] = []
    for (const item of sessionItems(session, lastPlan, thisPlan, ctx)) {
      const key = itemKey(item)
      if (seen.has(key) || ctx.decided.has(`${thisPlan.id}\u0000${key}`)) continue
      seen.add(key)
      entries.push({ key, item })
    }
    if (entries.length === 0) continue

    const date = session.movedToDate ?? session.date
    const workoutName =
      lastPlan.workoutDay?.name ?? ctx.workoutNames.get(lastPlan.workoutDayId) ?? session.workoutDay?.name ?? thisPlan.workoutDay?.name ?? ''
    found.push({
      order: `${date}\u0000${session.id}`,
      group: {
        sessionId: session.id,
        weekPlanId: thisPlan.id,
        workoutDayId: lastPlan.workoutDayId,
        workoutName,
        date,
        heading: [weekdayOf(date), workoutName.toUpperCase()].filter((part) => part !== '').join(' · '),
        items: entries,
      },
    })
  }
  // The order of last week's days (a session moved to another day is where it was done), then a stable tie-break.
  found.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  return found.map((f) => f.group)
}

// ═══ The board's wording ═════════════════════════════════════════════════════════════════════════
// Board 4 (`design/1.2/source/PlanReview.dc.html`): the strings below are its own, built from an item's
// data; `review.text.test.ts` reads the board file and checks each one against it.

export interface ReviewTextContext {
  /** The week "SWAP FROM WEEK N" names: CHANGE THE PROGRAM's week (the next session not done), as chunk 45 gives it. */
  fromWeek: number
  /** A sequence run says cycle where a weekday run says week (SPEC Language). */
  period?: 'week' | 'cycle'
}

export interface ReviewItemText {
  /** The small line over the item: "LAT PULLDOWN · SET 02". */
  eyebrow: string
  /** "Did 57.5 kg × 11". */
  headline: string
  /** "planned 55 kg × 8–10 · RIR 2 → did RIR 1"; null where there is nothing to add. */
  detail: string | null
  /** A line under it ("Swapping changes the plan from week 2 on."); null where the board has none. */
  note: string | null
  /** The button that takes it over: "USE 57.5 × 11", "ADD THIS SET", "SWAP FROM WEEK 2". */
  action: string
}

const two = (n: number): string => String(n).padStart(2, '0')

function weightText(kg: number, unit: WeightUnit): string {
  return `${toDisplayWeight(kg, unit)} ${unit}`
}

const rirText = (rir: number, rirMax: number | null): string => `RIR ${rirMax != null && rirMax !== rir ? `${rir}–${rirMax}` : rir}`

function plannedText(planned: PlannedNumbers, unit: WeightUnit): string | null {
  const weight = planned.weight != null ? weightText(planned.weight, unit) : null
  const reps = planned.reps.type !== 'none' ? formatRepTarget(planned.reps) : null
  if (weight !== null && reps !== null) return `planned ${weight} × ${reps}`
  if (weight !== null) return `planned ${weight}`
  if (reps !== null) return `planned ${reps} reps`
  return null
}

// "planned 55 kg × 8–10 · RIR 2 → did RIR 1": the plan's numbers, then its RIR and what the RIR was where it
// differs. A done RIR inside a planned range is the plan. Null where the plan had nothing to say.
function planLine(planned: PlannedNumbers, doneRir: number | null, unit: WeightUnit): string | null {
  const numbers = plannedText(planned, unit)
  const parts = numbers === null ? [] : [numbers]
  const within = (rir: number) => planned.rir !== null && rir >= planned.rir && rir <= (planned.rirMax ?? planned.rir)
  if (planned.rir !== null) {
    const plannedRir = rirText(planned.rir, planned.rirMax)
    parts.push(doneRir !== null && !within(doneRir) ? `${plannedRir} → did RIR ${doneRir}` : plannedRir)
  } else if (doneRir !== null) {
    parts.push(`did RIR ${doneRir}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function setLabel(setNumber: number, isWarmup: boolean): string {
  return `${isWarmup ? 'warmup' : 'set'} ${two(setNumber)}`
}

function stageNoun(stageKind: StageKind, count: number): string {
  const noun = { dropset: 'drop', rest_pause: 'pause', myo_reps: 'mini-set', cluster: 'cluster' }[stageKind]
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

const stageKindName = (stageKind: StageKind): string => STAGE_KIND_LABELS[stageKind].toLowerCase()

/** "a dropset", "a rest-pause set", "a warmup", "a normal set". */
function typePhrase(type: SessionSetChangeType): string {
  if (type.kind === 'warmup') return 'a warmup'
  if (type.kind === 'normal') return 'a normal set'
  return type.stageKind === 'dropset' ? 'a dropset' : `a ${stageKindName(type.stageKind)} set`
}

/** What an added staged set was: "dropset, 2 drops". */
function stagedDetail(type: Extract<SessionSetChangeType, { kind: 'staged' }>): string {
  return `${stageKindName(type.stageKind)}, ${stageNoun(type.stageKind, type.stageCount)}`
}

function doneNumbers(done: Pick<DoneSet, 'weight' | 'reps'>, unit: WeightUnit): string {
  const weight = done.weight != null ? weightText(done.weight, unit) : null
  const reps = done.reps != null ? String(done.reps) : null
  if (weight !== null && reps !== null) return `${weight} × ${reps}`
  return weight ?? (reps !== null ? `${reps} reps` : '—')
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// What the plan can hold as a target: `v2_week_plan_sets` checks `target_weight >= 0` and `rep_min > 0`, while a log
// takes any number typed. A weight below 0 and 0 reps (a failed attempt) were done and are no target: an action
// leaves that number out and writes the rest (a write the table refuses would fail the whole request).
const targetWeightOf = (weight: number | null): number | null => (weight !== null && weight >= 0 ? weight : null)
const targetRepsOf = (reps: number | null): number | null => (reps !== null && reps >= 1 ? reps : null)

/**
 * What a USE on a number item shows and writes: the done weight and, unless AMRAP was planned, the done reps. A set
 * planned AMRAP keeps AMRAP and takes the weight only (DECISIONS 137 (a), Adam 2026-10-15: "Keep AMRAP; USE on a
 * planned AMRAP set writes the weight only"), because its reps "never count".
 */
function numbersToTake(item: ReviewNumberItem): { weight: number | null; reps: number | null } {
  return {
    weight: targetWeightOf(item.done.weight),
    reps: item.planned.reps.type === 'amrap' ? null : targetRepsOf(item.done.reps),
  }
}

export function reviewItemText(item: ReviewItem, ctx: ReviewTextContext): ReviewItemText {
  const period = ctx.period ?? 'week'
  switch (item.kind) {
    case 'number': {
      const use = numbersToTake(item)
      const button =
        use.weight !== null && use.reps !== null
          ? `USE ${toDisplayWeight(use.weight, item.unit)} × ${use.reps}`
          : use.weight !== null
            ? `USE ${weightText(use.weight, item.unit)}`
            : use.reps !== null
              ? `USE ${use.reps} reps`
              : 'USE'
      return {
        eyebrow: `${item.exerciseName} · ${setLabel(item.setNumber, item.isWarmup)}`.toUpperCase(),
        headline: `Did ${doneNumbers(item.done, item.unit)}`,
        detail: planLine(item.planned, item.done.rir, item.unit),
        note: null,
        action: button,
      }
    }
    case 'skipped':
      return {
        eyebrow: `${item.exerciseName} · ${setLabel(item.setNumber, item.isWarmup)}`.toUpperCase(),
        headline: item.reason === 'skipped' ? 'Skipped' : 'Not logged',
        detail: planLine(item.planned, null, item.unit),
        note: null,
        action: 'REMOVE THIS SET',
      }
    case 'retyped': {
      const label = setLabel(item.setNumber, item.isWarmup)
      const { plannedType, doneType } = item
      // The same stage kind with more drops: "You added a drop to set 02"; any other change is a new type.
      const headline =
        plannedType.kind === 'staged' && doneType.kind === 'staged' && plannedType.stageKind === doneType.stageKind
          ? `You added ${stageNoun(doneType.stageKind, doneType.stageCount - plannedType.stageCount)} to ${label}`
          : `You made ${label} ${typePhrase(doneType)}`
      return {
        eyebrow: `${item.exerciseName} · ${setLabel(item.setNumber, item.isWarmup)}`.toUpperCase(),
        headline,
        detail: item.doneType.kind === 'staged' ? stageNoun(item.doneType.stageKind, item.doneType.stageCount) : null,
        note: null,
        action: 'USE',
      }
    }
    case 'added_set': {
      const warmup = item.done.type.kind === 'warmup'
      // A warmup says so in its label ("Warmup 01"); a staged set says its kind and drops.
      const detail = [item.done.type.kind === 'staged' ? stagedDetail(item.done.type) : null, item.done.rir !== null ? `RIR ${item.done.rir}` : null]
        .filter((part): part is string => part !== null)
        .join(' · ')
      return {
        eyebrow: `${item.exerciseName} · ADDED A SET`.toUpperCase(),
        headline: `${sentence(setLabel(item.setNumber, warmup))} · ${doneNumbers(item.done, item.unit)}`,
        detail: detail === '' ? null : detail,
        note: null,
        action: 'ADD THIS SET',
      }
    }
    case 'added_exercise': {
      const count = item.sets.filter((s) => s.type.kind !== 'warmup').length
      return {
        eyebrow: 'ADDED AN EXERCISE',
        headline: item.exerciseName,
        detail: `${count} ${count === 1 ? 'set' : 'sets'}`,
        note: `Adding it changes the plan from ${period} ${ctx.fromWeek} on.`,
        action: 'ADD EXERCISE',
      }
    }
    case 'swapped': {
      const detail =
        item.doneSets >= item.plannedSets
          ? `for all ${item.doneSets} ${item.doneSets === 1 ? 'set' : 'sets'}`
          : `for ${item.doneSets} of ${item.plannedSets} sets`
      return {
        eyebrow: 'SWAPPED AN EXERCISE',
        headline: `${item.originalExerciseName} → ${item.replacementExerciseName}`,
        detail,
        note: `Swapping changes the plan from ${period} ${ctx.fromWeek} on.`,
        action: `SWAP FROM ${period.toUpperCase()} ${ctx.fromWeek}`,
      }
    }
  }
}

// ═══ What an action writes ═══════════════════════════════════════════════════════════════════════

/** The action each item's button names (IGNORE is every item's other one). */
export type ReviewAction = 'use' | 'add_set' | 'remove_set' | 'add_exercise' | 'swap' | 'ignore'

/** The one action besides IGNORE an item offers. */
export function primaryAction(item: ReviewItem): Exclude<ReviewAction, 'ignore'> {
  switch (item.kind) {
    case 'number':
    case 'retyped':
      return 'use'
    case 'skipped':
      return 'remove_set'
    case 'added_set':
      return 'add_set'
    case 'added_exercise':
      return 'add_exercise'
    case 'swapped':
      return 'swap'
  }
}

/** What an update writes to a week set: the set's own field names, only those that change. */
export interface ReviewSetChanges {
  targetWeight?: number | null
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  isWarmup?: boolean
  stageKind?: StageKind | null
}

/** A week set to insert (a head or a stage), every column the row needs, no weight/RIR/tags beyond what is said. */
export interface ReviewNewSet {
  id: string
  weekPlanId: string
  programExerciseId: string
  setNumber: number
  parentWeekPlanSetId: string | null
  stageIndex: number
  isDropset: boolean
  isWarmup: boolean
  stageKind: StageKind | null
  targetWeight: number | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetRir: null
  targetRirMax: null
  tags: null
  programSetId: null
}

/**
 * ADD EXERCISE and SWAP FROM WEEK N as CHANGE THE PROGRAM changes (SPEC 13d: "a CHANGE THE PROGRAM change from
 * this week on"). Chunk 45's `planProgramChange` takes them; they carry what SPEC names and nothing it doesn't.
 */
export type ReviewProgramEdit =
  | {
      type: 'add_exercise'
      exerciseId: string
      /** THIS week's program exercise row it goes after (null: first). */
      afterProgramExerciseId: string | null
      /** This week gets as many sets as were done, with the done numbers as targets (those the plan can hold). */
      sets: DoneSet[]
    }
  | {
      type: 'swap_exercise'
      /** THIS week's program exercise row of the slot. */
      programExerciseId: string
      fromExerciseId: string
      toExerciseId: string
    }

export type ReviewWrite =
  | { kind: 'update_set'; weekPlanId: string; setId: string; changes: ReviewSetChanges }
  | { kind: 'insert_set'; set: ReviewNewSet }
  | { kind: 'delete_set'; weekPlanId: string; setId: string }
  | { kind: 'program_edit'; edit: ReviewProgramEdit }

/** The `v2_week_review_decisions` row an action leaves: used for a USE-like action, ignored for IGNORE. */
export interface ReviewDecisionWrite {
  weekPlanId: string
  itemKey: string
  decision: ReviewDecision
}

export interface ReviewActionResult {
  decision: ReviewDecisionWrite
  writes: ReviewWrite[]
}

const defaultNewId = (): string => crypto.randomUUID()

function headOf(plan: ReviewPlan, setId: string | null): ReviewSetRow | undefined {
  return setId === null ? undefined : plan.sets.find((s) => s.id === setId && s.parentWeekPlanSetId == null)
}

// A new head and its stage rows (a head never has stage numbers of its own): the done numbers as targets, the
// done kind. Appended at the end of the exercise's sets in THIS week.
function addSetWrites(programExerciseId: string | null, plan: ReviewPlan, done: DoneSet, newId: () => string): ReviewWrite[] {
  if (programExerciseId === null || !plan.exercises.some((e) => e.id === programExerciseId)) return []
  const heads = plan.sets.filter((s) => s.programExerciseId === programExerciseId && s.parentWeekPlanSetId == null)
  const setNumber = heads.reduce((most, s) => Math.max(most, s.setNumber), 0) + 1
  const doneReps = targetRepsOf(done.reps)
  const reps = repTargetToColumns(doneReps !== null ? { type: 'number', value: doneReps } : { type: 'none' })
  const headId = newId()
  const writes: ReviewWrite[] = [
    {
      kind: 'insert_set',
      set: {
        id: headId,
        weekPlanId: plan.id,
        programExerciseId,
        setNumber,
        parentWeekPlanSetId: null,
        stageIndex: 0,
        isDropset: false,
        isWarmup: done.type.kind === 'warmup',
        stageKind: done.type.kind === 'staged' ? done.type.stageKind : null,
        targetWeight: targetWeightOf(done.weight),
        repMin: reps.repMin,
        repMax: reps.repMax,
        isAmrap: reps.isAmrap,
        targetRir: null,
        targetRirMax: null,
        tags: null,
        programSetId: null,
      },
    },
  ]
  if (done.type.kind === 'staged') {
    for (let stageIndex = 1; stageIndex <= done.type.stageCount; stageIndex++) {
      writes.push(stageWrite(plan.id, programExerciseId, headId, setNumber, stageIndex, newId))
    }
  }
  return writes
}

function stageWrite(weekPlanId: string, programExerciseId: string, headId: string, setNumber: number, stageIndex: number, newId: () => string): ReviewWrite {
  return {
    kind: 'insert_set',
    set: {
      id: newId(),
      weekPlanId,
      programExerciseId,
      setNumber,
      parentWeekPlanSetId: headId,
      stageIndex,
      isDropset: true,
      isWarmup: false,
      stageKind: null,
      targetWeight: null,
      repMin: null,
      repMax: null,
      isAmrap: false,
      targetRir: null,
      targetRirMax: null,
      tags: null,
      programSetId: null,
    },
  }
}

// USE on a number item: the done weight and (unless AMRAP was planned) the done reps as the number, into this
// week's matching set; only what changes is written. With no matching set it is ADD THIS SET.
function useNumbersWrites(item: ReviewNumberItem, plan: ReviewPlan, newId: () => string): ReviewWrite[] {
  const head = headOf(plan, item.target.setId)
  if (!head) return addSetWrites(item.target.programExerciseId, plan, item.done, newId)
  const use = numbersToTake(item)
  const changes: ReviewSetChanges = {}
  if (use.weight !== null && (head.targetWeight == null || !sameWeight(head.targetWeight, use.weight, item.unit))) changes.targetWeight = use.weight
  if (use.reps !== null) {
    const reps = repTargetToColumns({ type: 'number', value: use.reps })
    if ((head.repMin ?? null) !== reps.repMin || (head.repMax ?? null) !== reps.repMax || (head.isAmrap ?? false) !== reps.isAmrap) {
      changes.repMin = reps.repMin
      changes.repMax = reps.repMax
      changes.isAmrap = reps.isAmrap
    }
  }
  return Object.keys(changes).length > 0 ? [{ kind: 'update_set', weekPlanId: plan.id, setId: head.id, changes }] : []
}

// USE on a type item: this week's matching set takes the kind and the number of drops; the rows a kind
// doesn't have are removed (SPEC "Switching back to Normal or Warmup removes the stages"), highest first.
function useTypeWrites(item: ReviewRetypedItem, plan: ReviewPlan, newId: () => string): ReviewWrite[] {
  const head = headOf(plan, item.target.setId)
  if (!head) return []
  const type = item.doneType
  const stages = plan.sets.filter((s) => s.parentWeekPlanSetId === head.id).sort((a, b) => a.stageIndex - b.stageIndex)
  const wanted = type.kind === 'staged' ? type.stageCount : 0
  const writes: ReviewWrite[] = []

  const isWarmup = type.kind === 'warmup'
  const stageKind = type.kind === 'staged' ? type.stageKind : null
  const storedKind = head.stageKind ?? null
  // The kind the set has now, as Plan shows it (a kindless head with stages reads as a dropset). A kind is written
  // only when the row's own column changes: a kindless dropset made Normal is already null there, and USE only
  // takes its stage rows away.
  const currentKind = stages.length > 0 ? resolveStageKind(storedKind) : storedKind
  const changes: ReviewSetChanges = {}
  if (head.isWarmup !== isWarmup) changes.isWarmup = isWarmup
  if (currentKind !== stageKind && storedKind !== stageKind) changes.stageKind = stageKind
  if (Object.keys(changes).length > 0) writes.push({ kind: 'update_set', weekPlanId: plan.id, setId: head.id, changes })

  for (let i = stages.length; i > wanted; i--) writes.push({ kind: 'delete_set', weekPlanId: plan.id, setId: stages[i - 1].id })
  for (let stageIndex = stages.length + 1; stageIndex <= wanted; stageIndex++) {
    writes.push(stageWrite(plan.id, head.programExerciseId, head.id, head.setNumber, stageIndex, newId))
  }
  return writes
}

/**
 * The writes an action on an item means, and the decision row it leaves (every action leaves one: IGNORE
 * `ignored`, the rest `used`). `thisWeekPlan` is the plan row the item belongs to, as it is now: nothing is
 * written for a set or exercise it no longer has.
 *   USE (number)        the done weight and reps into this week's matching set (a range becomes the number
 *                       done; AMRAP keeps its target); no matching set: ADD THIS SET
 *   USE (type)          that set takes the kind and its number of drops
 *   ADD THIS SET        a new set at the end of the exercise's sets with the done weight and reps and kind
 *   REMOVE THIS SET     this week's matching set is deleted (its stages go with it)
 *   ADD EXERCISE, SWAP  a CHANGE THE PROGRAM change (`program_edit`), applied from this week on
 */
export function applyReviewAction(
  item: ReviewItem,
  action: ReviewAction,
  thisWeekPlan: ReviewPlan,
  newId: () => string = defaultNewId,
): ReviewActionResult {
  if (thisWeekPlan.id !== item.weekPlanId) {
    throw new Error(`applyReviewAction: the item belongs to plan row ${item.weekPlanId}, not ${thisWeekPlan.id}`)
  }
  const key = itemKey(item)
  if (action === 'ignore') {
    return { decision: { weekPlanId: item.weekPlanId, itemKey: key, decision: 'ignored' }, writes: [] }
  }
  if (action !== primaryAction(item)) {
    throw new Error(`applyReviewAction: "${action}" is not an action of a ${item.kind} item`)
  }

  let writes: ReviewWrite[] = []
  switch (item.kind) {
    case 'number':
      writes = useNumbersWrites(item, thisWeekPlan, newId)
      break
    case 'retyped':
      writes = useTypeWrites(item, thisWeekPlan, newId)
      break
    case 'skipped': {
      const head = headOf(thisWeekPlan, item.target.setId)
      if (head) writes = [{ kind: 'delete_set', weekPlanId: thisWeekPlan.id, setId: head.id }]
      break
    }
    case 'added_set':
      writes = addSetWrites(item.target.programExerciseId, thisWeekPlan, item.done, newId)
      break
    case 'added_exercise':
      writes = [
        {
          kind: 'program_edit',
          edit: {
            type: 'add_exercise',
            exerciseId: item.exerciseId,
            afterProgramExerciseId: item.after?.programExerciseId ?? null,
            sets: item.sets.map((set) => ({ ...set, weight: targetWeightOf(set.weight), reps: targetRepsOf(set.reps) })),
          },
        },
      ]
      break
    case 'swapped': {
      const slot = item.target.programExerciseId
      if (slot !== null && thisWeekPlan.exercises.some((e) => e.id === slot)) {
        writes = [
          {
            kind: 'program_edit',
            edit: { type: 'swap_exercise', programExerciseId: slot, fromExerciseId: item.originalExerciseId, toExerciseId: item.replacementExerciseId },
          },
        ]
      }
      break
    }
  }
  return { decision: { weekPlanId: item.weekPlanId, itemKey: key, decision: 'used' }, writes }
}
