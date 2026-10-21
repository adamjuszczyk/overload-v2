import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import type { PlanningType, ScheduleType, SessionSetChange, WeekPlan, WeightUnit } from '../../types'
import { repTargetToColumns } from '../../lib/plannerVocabulary'
import { toSession } from '../gym/sessionService'
import { applyOps } from '../programs/applyOps'
import { fetchChangeProgramSource, type ChangeProgramSource } from '../programs/changeProgramService'
import { addExercise, initialDraft, swapExercise, type DraftEntry } from '../programs/changeProgramDraft'
import { planProgramChange, type DraftSet, type Op, type WeekPlanSetColumns } from '../programs/programChange'
import { queryKeysTouchedBy } from '../programs/useChangeProgram'
import { DONE_WEEK_PLANS_KEY } from './useDoneWeekPlanIds'
import {
  addedExerciseSetWrites,
  applyReviewAction,
  type ReviewAction,
  type ReviewActionResult,
  type ReviewDecisionWrite,
  type ReviewEntry,
  type ReviewProgramEdit,
  type ReviewSession,
  type ReviewSwap,
  type ReviewWrite,
} from './review'

// Chunk 56 (TASKS-1.2 "REVIEW"; SPEC [1.2] Review (13), Defaults 4 and 10): what REVIEW reads and what each action writes. Chunk 43's
// `reviewItems` and `applyReviewAction` are pure; this file is the I/O around them.
//
// READS (all paged, ordered, `.range()` until a short page: Checks that lied #31):
//   - last week's sessions, by last week's plan rows, each with its logs (`fetchSession`'s own embed and mapper, so a log carries
//     `stage_kind` and `added_place`: RULES, chunk 43 review 2 and DECISIONS 195), its swaps and all three kinds of its
//     `v2_session_set_changes` (`deleted`, `retyped`, `pending_stages`: chunk 43 review 3's mapping). Which of them are done is the
//     module's rule (G52), not the query's: a second filter here would be a second mechanism for one state.
//   - this week's decisions, by this week's plan rows.
//
// WRITES: an action is ONE `v2_apply_ops` request: the week-set writes `applyReviewAction` returns (mapped to ops), or, for ADD
// EXERCISE and SWAP FROM WEEK N, the ops chunk 45's `planProgramChange` makes for the same draft CHANGE THE PROGRAM would hold, and the
// decision row last. The function has no upsert, and an item is decided exactly once, so before it writes this reads the item's
// decision again: one that is already there means another phone (or an attempt whose reply was lost) took the item, and its writes
// landed in the same transaction as that row, so nothing more is sent. The unique key (`23505`) answers the same way for a race.

export const REVIEW_DECISIONS_KEY = 'v2_weekReviewDecisions'

const PAGE = 500
// A session arrives with its logs, changes and swaps embedded, so a page of them is smaller.
const SESSION_PAGE = 100

type SessionRow = Parameters<typeof toSession>[0] & {
  v2_session_set_changes?: ChangeRow[] | null
  v2_session_exercise_swaps?: SwapRow[] | null
}
interface ChangeRow {
  kind: string
  week_plan_set_id: string | null
  set_log_id: string | null
  is_warmup: boolean | null
  stage_kind: string | null
  stage_count: number | null
}
interface SwapRow {
  program_exercise_id: string | null
  original_exercise_id: string | null
  original_exercise_name: string
  replacement_exercise_id: string | null
  replacement_exercise_name: string
}

type StageKindName = Extract<SessionSetChange, { kind: 'pending_stages' }>['stageKind']

/** A stored change row as the module reads it. A row missing the key its kind needs is left out (the table's checks make none). */
export function toSessionSetChange(row: ChangeRow): SessionSetChange[] {
  if (row.kind === 'deleted' && row.week_plan_set_id) return [{ kind: 'deleted', weekPlanSetId: row.week_plan_set_id }]
  if (row.kind === 'retyped' && row.week_plan_set_id) {
    const stageKind = row.stage_kind as StageKindName | null
    const type = row.is_warmup ? ({ kind: 'warmup' } as const) : stageKind ? ({ kind: 'staged', stageKind, stageCount: row.stage_count ?? 0 } as const) : ({ kind: 'normal' } as const)
    return [{ kind: 'retyped', weekPlanSetId: row.week_plan_set_id, type }]
  }
  if (row.kind === 'pending_stages' && row.set_log_id && row.stage_kind) {
    return [{ kind: 'pending_stages', setLogId: row.set_log_id, stageKind: row.stage_kind as StageKindName, stageCount: row.stage_count ?? 0 }]
  }
  return []
}

const toSwap = (row: SwapRow): ReviewSwap => ({
  programExerciseId: row.program_exercise_id,
  originalExerciseId: row.original_exercise_id,
  originalExerciseName: row.original_exercise_name,
  replacementExerciseId: row.replacement_exercise_id,
  replacementExerciseName: row.replacement_exercise_name,
})

/** Last week's sessions (every status: the module keeps the completed ones) with their logs, swaps and set changes. */
export async function fetchReviewSessions(weekPlanIds: readonly string[]): Promise<ReviewSession[]> {
  const sessions: ReviewSession[] = []
  if (weekPlanIds.length === 0) return sessions
  for (let from = 0; ; from += SESSION_PAGE) {
    const { data, error } = await supabase
      .from('v2_sessions')
      .select('*, v2_set_logs(*, exercises(*)), v2_session_set_changes(*), v2_session_exercise_swaps(*)')
      .in('week_plan_id', [...weekPlanIds])
      .order('id')
      .range(from, from + SESSION_PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as SessionRow[]
    for (const row of rows) {
      sessions.push({
        ...toSession(row),
        swaps: (row.v2_session_exercise_swaps ?? []).map(toSwap),
        sessionSetChanges: (row.v2_session_set_changes ?? []).flatMap(toSessionSetChange),
      })
    }
    if (rows.length < SESSION_PAGE) break
  }
  return sessions
}

/** The decisions made on this week's plan rows. */
export async function fetchReviewDecisions(weekPlanIds: readonly string[]): Promise<Array<{ weekPlanId: string; itemKey: string }>> {
  const out: Array<{ weekPlanId: string; itemKey: string }> = []
  if (weekPlanIds.length === 0) return out
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('v2_week_review_decisions')
      .select('week_plan_id, item_key')
      .in('week_plan_id', [...weekPlanIds])
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<{ week_plan_id: string; item_key: string }>
    for (const row of rows) out.push({ weekPlanId: row.week_plan_id, itemKey: row.item_key })
    if (rows.length < PAGE) break
  }
  return out
}

async function decisionExists(weekPlanId: string, itemKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('v2_week_review_decisions')
    .select('id')
    .eq('week_plan_id', weekPlanId)
    .eq('item_key', itemKey)
    .range(0, 0)
  if (error) throw error
  return (data ?? []).length > 0
}

// ═══ What an action writes ═══════════════════════════════════════════════════════════════════════════════════════

/** The week-set writes `applyReviewAction` returns, as ops on `v2_week_plan_sets`. A `program_edit` is not one of them. */
export function opsOfWrites(writes: readonly ReviewWrite[], userId: string): Op[] {
  return writes.flatMap((write): Op[] => {
    switch (write.kind) {
      case 'update_set': {
        const c = write.changes
        const patch: Partial<WeekPlanSetColumns> = {}
        if (c.targetWeight !== undefined) patch.target_weight = c.targetWeight
        if (c.repMin !== undefined) patch.rep_min = c.repMin
        if (c.repMax !== undefined) patch.rep_max = c.repMax
        if (c.isAmrap !== undefined) patch.is_amrap = c.isAmrap
        if (c.isWarmup !== undefined) patch.is_warmup = c.isWarmup
        if (c.stageKind !== undefined) patch.stage_kind = c.stageKind
        return [{ op: 'update', table: 'v2_week_plan_sets', id: write.setId, patch }]
      }
      case 'insert_set': {
        const s = write.set
        return [
          {
            op: 'insert',
            table: 'v2_week_plan_sets',
            row: {
              id: s.id,
              user_id: userId,
              week_plan_id: s.weekPlanId,
              program_exercise_id: s.programExerciseId,
              set_number: s.setNumber,
              target_rir: s.targetRir,
              target_rir_max: s.targetRirMax,
              is_dropset: s.isDropset,
              parent_week_plan_set_id: s.parentWeekPlanSetId,
              stage_index: s.stageIndex,
              is_warmup: s.isWarmup,
              program_set_id: s.programSetId,
              stage_kind: s.stageKind,
              target_weight: s.targetWeight,
              rep_min: s.repMin,
              rep_max: s.repMax,
              is_amrap: s.isAmrap,
              tags: s.tags,
            },
          },
        ]
      }
      case 'delete_set':
        return [{ op: 'delete', table: 'v2_week_plan_sets', id: write.setId }]
      case 'program_edit':
        return []
    }
  })
}

/** The decision row (an insert row names every NOT NULL column: `created_at` too, 043). */
export function decisionOp(decision: ReviewDecisionWrite, userId: string, id: string, now: string): Op {
  return {
    op: 'insert',
    table: 'v2_week_review_decisions',
    row: { id, user_id: userId, week_plan_id: decision.weekPlanId, item_key: decision.itemKey, decision: decision.decision, created_at: now },
  }
}

// The new exercise goes after the one it followed, or first; one inside a superset goes after the whole block (a block's members are
// neighbours, which `planProgramChange` demands; the same rule as CHANGE THE PROGRAM's UNDO, 191).
function placeAfter(entries: readonly DraftEntry[], added: DraftEntry, afterRowId: string | null): DraftEntry[] {
  const rest = entries.filter((e) => e !== added)
  if (afterRowId === null) return [added, ...rest]
  const i = rest.findIndex((e) => e.kind === 'kept' && e.id === afterRowId)
  if (i < 0) return [...rest, added]
  const block = rest[i].supersetBlockId
  let at = i
  if (block !== null) rest.forEach((e, j) => (e.supersetBlockId === block ? (at = Math.max(at, j)) : undefined))
  return [...rest.slice(0, at + 1), added, ...rest.slice(at + 1)]
}

// A stable run's default holds a set's kind, its drops and its rep target, never a weight: the done sets as the default's new rows.
function defaultSetsOf(edit: Extract<ReviewProgramEdit, { type: 'add_exercise' }>): DraftSet[] {
  return edit.sets.map((done) => {
    const columns = repTargetToColumns(done.reps !== null ? { type: 'number', value: done.reps } : { type: 'none' })
    return {
      id: null,
      isWarmup: done.type.kind === 'warmup',
      stageKind: done.type.kind === 'staged' ? done.type.stageKind : null,
      repMin: columns.repMin,
      repMax: columns.repMax,
      isAmrap: columns.isAmrap,
      restSeconds: null,
      stageRestSeconds: null,
      stages: done.type.kind === 'staged' ? Array.from({ length: done.type.stageCount }, () => ({ id: null, repMin: null, repMax: null, isAmrap: false })) : [],
    }
  })
}

export interface ProgramEditArgs {
  edit: ReviewProgramEdit
  /** This week's plan row of the item. */
  weekPlan: Pick<WeekPlan, 'id' | 'workoutDayId'>
  source: ChangeProgramSource
  planningType: PlanningType
  scheduleType: ScheduleType
  currentWeek: number
  userId: string
  now: string
  newId: () => string
  /** An added exercise's unit, written as a resolved literal at creation (RULES: a program exercise's unit). */
  unit: WeightUnit
}

/**
 * ADD EXERCISE and SWAP FROM WEEK N as CHANGE THE PROGRAM changes (SPEC 13d): the ops `planProgramChange` makes for the draft the run
 * copy would hold with that one edit, from the current week on. An added exercise also takes this week's sets, "as many sets as were
 * done, with the done numbers as targets" (SPEC Actions): a week-dependent run holds no default sets, so they are inserted here; a stable
 * run's default takes them (its new rows come with the save) and the weights go into this week's rows. A session that has started or is
 * done is left as it is by the planner, so it gets no exercise row and none of these.
 */
export function programEditOps(args: ProgramEditArgs): Op[] {
  const { edit, weekPlan, source, planningType, newId } = args
  let state = initialDraft(source.runCopy, planningType)
  const workout = state.edit.workouts.find((w) => w.id === weekPlan.workoutDayId)
  if (!workout) throw new Error("This workout isn't part of the program.")

  if (edit.type === 'swap_exercise') {
    const slot = workout.exercises.find((e) => e.kind === 'kept' && e.id === edit.programExerciseId)
    if (!slot) throw new Error("That exercise isn't part of the program any more.")
    state = swapExercise(state, workout.id, slot.key, edit.toExerciseId)
  } else {
    state = addExercise(state, workout.id, edit.exerciseId, args.unit)
    const list = state.edit.workouts.find((w) => w.id === workout.id)!.exercises
    const added = list[list.length - 1]
    const entry: DraftEntry = planningType === 'stable' ? { ...added, sets: defaultSetsOf(edit) } : added
    state = {
      ...state,
      edit: {
        ...state.edit,
        workouts: state.edit.workouts.map((w) => (w.id === workout.id ? { ...w, exercises: placeAfter(w.exercises.map((e) => (e === added ? entry : e)), entry, edit.afterProgramExerciseId) } : w)),
      },
    }
  }

  const ops = planProgramChange({
    userId: args.userId,
    now: args.now,
    newId,
    planningType,
    scheduleType: args.scheduleType,
    currentWeek: args.currentWeek,
    runCopy: args.source.runCopy,
    scheduleRows: args.source.scheduleRows,
    sessions: args.source.sessions,
    edit: state.edit,
  }).ops
  if (edit.type === 'swap_exercise') return ops

  // This week's row of the new exercise: the planner gave it one only if this week's session hasn't started.
  const row = ops.find((op) => op.op === 'insert' && op.table === 'v2_week_plan_exercises' && op.row.week_plan_id === weekPlan.id)
  const rowId = row && row.op === 'insert' && row.table === 'v2_week_plan_exercises' ? row.row.program_exercise_id : null
  if (rowId === null) return ops
  if (planningType === 'week_dependent') {
    return [...ops, ...opsOfWrites(addedExerciseSetWrites(weekPlan.id, rowId, edit.sets, newId), args.userId)]
  }
  // Stable: this week's rows came with the default, in its order; they take the done weights.
  const setNumberOf = (op: Op): number => (op.op === 'insert' && op.table === 'v2_week_plan_sets' ? op.row.set_number : 0)
  const headAt = ops
    .map((op, i) => ({ op, i }))
    .filter(({ op }) => op.op === 'insert' && op.table === 'v2_week_plan_sets' && op.row.week_plan_id === weekPlan.id && op.row.program_exercise_id === rowId && op.row.parent_week_plan_set_id === null)
    .sort((x, y) => setNumberOf(x.op) - setNumberOf(y.op))
    .map(({ i }) => i)
  return ops.map((op, i) => {
    const k = headAt.indexOf(i)
    if (k < 0 || op.op !== 'insert' || op.table !== 'v2_week_plan_sets') return op
    return { ...op, row: { ...op.row, target_weight: edit.sets[k]?.weight ?? null } }
  })
}

// ═══ Deciding an item ════════════════════════════════════════════════════════════════════════════════════════════

export interface DecideArgs {
  userId: string
  entry: ReviewEntry
  action: ReviewAction
  /** The item's plan row of this week, as Plan holds it now. */
  weekPlan: WeekPlan
  program: { mesoId: string; programId: string; planningType: PlanningType; scheduleType: ScheduleType; currentWeek: number }
  /** Settings' unit: an added exercise's, when the item names none. */
  weightUnit?: WeightUnit
  newId?: () => string
  now?: () => string
}

export type DecideOutcome = 'applied' | 'already_decided'

const isDecisionConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505' && String((error as { message?: unknown }).message ?? '').includes('v2_week_review_decisions_item_uk')

async function refresh(ops: readonly Op[]): Promise<void> {
  const keys = [...queryKeysTouchedBy(ops), [REVIEW_DECISIONS_KEY], [DONE_WEEK_PLANS_KEY]]
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/** One action on one item, written at once: the item's writes and its decision row in one request. */
export async function decideReviewItem(args: DecideArgs): Promise<DecideOutcome> {
  const { entry, action, weekPlan, userId } = args
  const newId = args.newId ?? (() => crypto.randomUUID())
  const now = (args.now ?? (() => new Date().toISOString()))()

  if (await decisionExists(entry.item.weekPlanId, entry.key)) {
    await refresh([])
    return 'already_decided'
  }

  const result: ReviewActionResult = applyReviewAction(entry.item, action, weekPlan, newId)
  const edit = result.writes.find((w): w is Extract<ReviewWrite, { kind: 'program_edit' }> => w.kind === 'program_edit')
  const ops: Op[] = []
  if (edit) {
    const source = await fetchChangeProgramSource({ mesoId: args.program.mesoId, programId: args.program.programId, planningType: args.program.planningType, currentWeek: args.program.currentWeek })
    ops.push(
      ...programEditOps({
        edit: edit.edit,
        weekPlan,
        source,
        planningType: args.program.planningType,
        scheduleType: args.program.scheduleType,
        currentWeek: args.program.currentWeek,
        userId,
        now,
        newId,
        unit: entry.item.kind === 'added_exercise' ? entry.item.unit : (args.weightUnit ?? 'kg'),
      }),
    )
  }
  ops.push(...opsOfWrites(result.writes, userId), decisionOp(result.decision, userId, newId(), now))

  try {
    await applyOps(ops)
  } catch (error) {
    if (!isDecisionConflict(error)) throw error
    await refresh([])
    return 'already_decided'
  }
  await refresh(ops)
  return 'applied'
}
