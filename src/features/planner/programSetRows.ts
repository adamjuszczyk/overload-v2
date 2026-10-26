// What the stepped planner's step 3 decides about one exercise's set rows (TASKS-1.2 chunk 67; SPEC Stepped program planner [1.2]: "A set's
// number opens the set type picker, a rep target (or ALL) opens the rep target picker ... A staged set shows a 'DROPSET · 1 DROP' chip that
// also opens the picker"; Set types and staged sets [1.2]: "Picking a staged kind adds its first stage; a stepper sets how many. Switching
// back to Normal or Warmup removes the stages. A warmup can never be staged"; boards PP3, PP3b, PP3c, PP3d).
//
// Pure: no React, no Supabase. The pickers (chunk 39) return a value and write nothing; this is where a returned type becomes the program
// set writes, so the mapping exists once for the planner (carry note 39 and RULES, Checks that lied #15: the first writer of a picked type
// defines the mapping once). It is the program sets' twin of Plan's `planSetRows.ts` (a week set) and CHANGE THE PROGRAM's `withSetType`
// (a draft set):
//
//   - an exercise's rows, and the numbers they show ........................... programRows
//   - a head's SetType (what the picker is opened on) ......................... programSetTypeOf
//   - what picking another type writes, in the order it must be written ....... programSetTypeChange
//   - the SETS stepper's next position (213 (a)) .............................. nextProgramPosition
//
// A program set's type is stored on its head (`is_warmup`, `stage_kind`, `stage_rest_seconds`) and in the stage rows under it
// (`parent_program_set_id`, `stage_index`), never as one value, so a picked type is a list of writes. A staged head with no `stage_kind` is a
// dropset (the legacy reading, `resolveStageKind`).

import type { ProgramSet } from '../../types'
import { resolveStageKind, type StageKind } from '../../lib/plannerVocabulary.js'
import { sameSetType, type SetType } from '../../components/pickers/pickerLogic'
import { cascadeDeleteOrder, groupByParent, nextStageIndex } from '../gym/setGroupLogic'

/** A head and the stage rows under it, as step 3 draws them. */
export interface ProgramRow {
  head: ProgramSet
  /** Ordered by `stage_index`. */
  stages: ProgramSet[]
  /** The row's place among the exercise's heads, from 1: a warmup counts (board PP3 draws a warmup as 01), and so does every set after a gap. */
  number: number
  /** `01`, `02` ... */
  label: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * An exercise's rows in set order: its heads by position (two heads that share one, which the stepper could write before chunk 67,
 * order by id, so every phone numbers them the same whatever order its read came back in), each with its stages. The number a row shows
 * is its rank, never its stored position: REMOVE THIS SET leaves its position empty (DECISIONS 213 (a)), and the rows after it read one
 * lower.
 */
export function programRows(sets: readonly ProgramSet[]): ProgramRow[] {
  const groups = groupByParent(
    [...sets],
    (s) => s.id,
    (s) => s.parentProgramSetId,
    (s) => s.stageIndex,
  ).sort((a, b) => a.head.position - b.head.position || (a.head.id < b.head.id ? -1 : a.head.id > b.head.id ? 1 : 0))
  return groups.map((group, i) => ({ head: group.head, stages: group.stages, number: i + 1, label: pad(i + 1) }))
}

/**
 * The position the SETS stepper's + gives a new head: one past the highest position the exercise has (DECISIONS 213 (a), Adam, 2026-10-22:
 * "+ always adds after the highest position"). A count would repeat a position once a set before the last was removed. Stage rows share their
 * head's position, so they never raise it.
 */
export function nextProgramPosition(heads: readonly Pick<ProgramSet, 'position'>[]): number {
  return heads.reduce((max, head) => Math.max(max, head.position), 0) + 1
}

/**
 * What the set type picker is opened on. A warmup is a warmup whatever else the row holds; a head with stage rows is staged, its kind the
 * head's own (a null kind reads as a dropset) and its count the rows it has; anything else is Normal (a head whose kind is set but has no
 * stage rows is Normal: the stages are what make a set staged). `stageRestSeconds` is the rest between stages, null when the head has none
 * of its own (the kind's own default).
 */
export function programSetTypeOf(row: Pick<ProgramRow, 'head' | 'stages'>): SetType {
  if (row.head.isWarmup) return { kind: 'warmup' }
  if (row.stages.length > 0) {
    return { kind: 'staged', stageKind: resolveStageKind(row.head.stageKind), stageCount: row.stages.length, stageRestSeconds: row.head.stageRestSeconds }
  }
  return { kind: 'normal' }
}

/** One write of a type change. Applied in list order, each after the one before has been answered (`applyProgramSetTypeOps`). */
export type ProgramSetTypeOp =
  | { kind: 'removeStage'; id: string }
  | { kind: 'isWarmup'; id: string; isWarmup: boolean }
  | { kind: 'stageKind'; id: string; stageKind: StageKind | null }
  | { kind: 'stageRest'; id: string; stageRestSeconds: number | null }
  | { kind: 'addStage'; programExerciseId: string; parentId: string; position: number; stageIndex: number }

/**
 * What picking `next` on the set type picker writes. The database refuses a warmup that has a stage kind or a stage (`v2_program_sets_warmup_check`)
 * and a stage row that has a kind, a rest or the warmup flag (`v2_program_sets_stage_row_check`), so the order is the rule:
 *
 *   - To Normal or Warmup: every stage row goes first (highest stage index first, so a stopped change leaves a head with fewer stages, never
 *     orphans), then the head's stage kind and the rest between stages are cleared where it holds one (a Normal or Warmup set leaves neither
 *     behind, as CHANGE THE PROGRAM's `withSetType` does), and only then is the head written as a warmup (`updateProgramSetIsWarmup(true)`).
 *     Normal from a warmup writes `is_warmup: false` last.
 *   - To a staged kind: a warmup head is made a working set first (`updateProgramSetIsWarmup(false)`), then the head's kind is written when it
 *     changes (a plain set always writes it: picking Dropset writes `stage_kind: 'dropset'`), then stage rows are removed (the last ones, highest
 *     index first) or added (one past the highest index each, at the head's position) until the count is the picked one, and the rest between
 *     stages last. A new stage starts with no rep target, as the old ADD STAGE's did.
 *
 * The same type, or a type that differs in nothing stored, is no change (an empty list).
 */
export function programSetTypeChange(row: Pick<ProgramRow, 'head' | 'stages'>, next: SetType): ProgramSetTypeOp[] {
  const current = programSetTypeOf(row)
  if (sameSetType(current, next)) return []

  const { head, stages } = row
  const ops: ProgramSetTypeOp[] = []
  const stagesLastFirst = cascadeDeleteOrder({ head, stages }, (s) => s.stageIndex).slice(0, -1)
  const headRest = head.stageRestSeconds ?? null

  if (next.kind !== 'staged') {
    for (const stage of stagesLastFirst) ops.push({ kind: 'removeStage', id: stage.id })
    if ((head.stageKind ?? null) !== null) ops.push({ kind: 'stageKind', id: head.id, stageKind: null })
    if (headRest !== null) ops.push({ kind: 'stageRest', id: head.id, stageRestSeconds: null })
    const toWarmup = next.kind === 'warmup'
    if (head.isWarmup !== toWarmup) ops.push({ kind: 'isWarmup', id: head.id, isWarmup: toWarmup })
    return ops
  }

  if (head.isWarmup) ops.push({ kind: 'isWarmup', id: head.id, isWarmup: false })
  if (current.kind !== 'staged' || current.stageKind !== next.stageKind) ops.push({ kind: 'stageKind', id: head.id, stageKind: next.stageKind })

  const have = stages.length
  if (next.stageCount < have) {
    for (const stage of stagesLastFirst.slice(0, have - next.stageCount)) ops.push({ kind: 'removeStage', id: stage.id })
  } else {
    const first = nextStageIndex({ head, stages }, (s) => s.stageIndex)
    for (let i = 0; i < next.stageCount - have; i++) {
      ops.push({ kind: 'addStage', programExerciseId: head.programExerciseId, parentId: head.id, position: head.position, stageIndex: first + i })
    }
  }

  if (next.stageRestSeconds !== headRest) ops.push({ kind: 'stageRest', id: head.id, stageRestSeconds: next.stageRestSeconds })
  return ops
}
