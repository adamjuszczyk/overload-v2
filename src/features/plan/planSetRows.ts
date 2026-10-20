// What Plan's week view decides about one exercise's set rows (TASKS-1.2 chunk 54a; SPEC Screens → Plan screen: "Each set: number,
// weight, reps, RIR, its type tag and cues. Weight is typed; reps open the rep target picker (6); RIR opens the RIR target picker (17);
// the set's ⋯ opens the set type picker (5) with rest after this set (week-dependent), Cues and REMOVE THIS SET. A warmup row's ⋯ offers
// Normal and Warmup only; stage rows have no ⋯, the head's stepper changes how many (G55). '+ ADD SET' adds a Normal set with the
// previous set's rep target and no weight or RIR (Defaults, 8)"; boards 1, 1a, 9).
//
// Pure: no React, no Supabase. The pickers (chunk 39) and the cues sheet (chunk 40) return a value and write nothing; this is where a
// returned value becomes the week set writes, so each mapping exists once and every writer uses it (carry note 39: "No SetType <->
// storage mapping exists ... the first chunk that writes a picked type defines it once"; Checks that lied #15):
//
//   - the rows an exercise draws, and the numbers they show ...................... planRows
//   - a head's SetType (what the picker is opened on) ............................ setTypeOfRow
//   - what picking another type writes, in the order it must be written .......... planSetTypeChange
//   - what a rep target, a RIR target and a set of cues write, with "Use for all" . repTargetPatches, rirTargetPatches, cuePatches
//   - what "+ ADD SET" writes ................................................... newSetFor
//   - a set's own program set, the rest row's target (G45) ...................... ownProgramSet
//   - the SUPERSET chip's letter and the member's place .......................... supersetChips
//
// A week set's type is stored on its head (`is_warmup`, `stage_kind`) and in the stage rows under it (`parent_week_plan_set_id`,
// `stage_index`), never as one value, so a picked type is a list of writes. A staged head with no `stage_kind` is a dropset (the legacy
// reading, `resolveStageKind`).

import type { ProgramExercise, ProgramSet, WeekPlanSet } from '../../types'
import {
  STAGE_KIND_LABELS,
  applyAmrapRirDefault,
  applyTagToAllHeads,
  columnsToRepTarget,
  formatRepTarget,
  repTargetToColumns,
  resolveStageKind,
  type RepTarget,
  type StageKind,
} from '../../lib/plannerVocabulary.js'
import {
  SET_TYPE_OPTIONS,
  applyToAllTargets,
  normaliseCues,
  rirTargetToColumns,
  sameSetType,
  type RirTarget,
  type SetType,
} from '../../components/pickers/pickerLogic'
import { cascadeDeleteOrder, groupWeekPlanSets, nextStageIndex } from '../gym/setGroupLogic'
import { groupIntoUnits } from '../../lib/supersetGroups.js'
import { addSetDefaults, type NewSetDefaults } from './weekPlanning'

// ─── The write one edit makes ───────────────────────────────────────────────────────────────────

/** The columns `updateSet` writes, named only when present: a key's presence means "write this column", its absence "leave it alone". */
export interface SetChanges {
  targetRir?: number | null
  /** 042's high end of a RIR range; null on a number. Written with `targetRir`, never alone. */
  targetRirMax?: number | null
  stageKind?: StageKind | null
  isWarmup?: boolean
  targetWeight?: number | null
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  tags?: string[] | null
}

/** One `updateSet` call: which week set, which columns. */
export interface SetPatch {
  id: string
  changes: SetChanges
}

// ─── Rows ───────────────────────────────────────────────────────────────────────────────────────────

/** A head and the stage rows under it, as the exercise card draws them. */
export interface PlanRow {
  head: WeekPlanSet
  /** Ordered by `stage_index`. */
  stages: WeekPlanSet[]
  /** `01`, `02` ... for a working set; `W` for a warmup (board 1). */
  label: string
  /** The number the pickers' eyebrow names (`SET 03`): a working set's own number, a warmup's place among the exercise's warmups. */
  eyebrowNumber: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * An exercise's rows in set order: its heads by `set_number` (a tie keeps the order the rows came in), each with its stages. Working
 * sets are numbered from 1 over the working sets alone and a warmup is `W` (board 1 draws W, 01, 02), so a warmup never takes a
 * working set's number.
 */
export function planRows(sets: readonly WeekPlanSet[]): PlanRow[] {
  const groups = groupWeekPlanSets([...sets]).sort((a, b) => a.head.setNumber - b.head.setNumber)
  let working = 0
  let warmups = 0
  return groups.map((group) => {
    if (group.head.isWarmup) {
      warmups += 1
      return { head: group.head, stages: group.stages, label: 'W', eyebrowNumber: warmups }
    }
    working += 1
    return { head: group.head, stages: group.stages, label: pad(working), eyebrowNumber: working }
  })
}

// ─── + ADD SET ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The number a new head takes: one past the highest head number the exercise has. (A head count would repeat the last number
 * once a set before it was removed, since removing a set renumbers nothing.) Stage rows share their head's number and never count.
 */
export function nextSetNumber(heads: readonly Pick<WeekPlanSet, 'setNumber'>[]): number {
  return heads.reduce((max, head) => Math.max(max, head.setNumber), 0) + 1
}

/** What "+ ADD SET" writes (SPEC Defaults 8): the next head number and a Normal set with the last head's rep target, no weight, no RIR. */
export function newSetFor(rows: readonly PlanRow[]): { setNumber: number; defaults: NewSetDefaults } {
  const heads = rows.map((row) => row.head)
  const last = heads.reduce<WeekPlanSet | null>((found, head) => (found === null || head.setNumber >= found.setNumber ? head : found), null)
  return { setNumber: nextSetNumber(heads), defaults: addSetDefaults(last) }
}

// ─── The set's type ─────────────────────────────────────────────────────────────────────────────────

/** A week set's own program set (G45): only a set that names a program set of its OWN exercise row has a rest of its own. */
export function ownProgramSet(set: Pick<WeekPlanSet, 'programSetId' | 'programExerciseId'>, programSetById: ReadonlyMap<string, ProgramSet>): ProgramSet | null {
  if (!set.programSetId) return null
  const programSet = programSetById.get(set.programSetId)
  if (!programSet) return null
  return programSet.programExerciseId === set.programExerciseId ? programSet : null
}

/**
 * What the set type picker is opened on. A warmup is a warmup whatever else the row holds; a head with stage rows is staged, its kind the
 * head's own (a null kind reads as a dropset) and its count the rows it has; anything else is Normal (a head whose kind is set but has no
 * stage rows is Normal: the stages are what make a set staged). `stageRestSeconds` is the rest between stages, stored on the set's own
 * program set, and null when the set has none of its own (the kind's own default).
 */
export function setTypeOfRow(row: PlanRow, programSet: ProgramSet | null): SetType {
  if (row.head.isWarmup) return { kind: 'warmup' }
  if (row.stages.length > 0) {
    return { kind: 'staged', stageKind: resolveStageKind(row.head.stageKind ?? null), stageCount: row.stages.length, stageRestSeconds: programSet?.stageRestSeconds ?? null }
  }
  return { kind: 'normal' }
}

/** The head columns a type change writes. */
type HeadChanges = Pick<SetChanges, 'isWarmup' | 'stageKind'>

/** One write of a type change. Applied in list order, each after the one before has been answered. */
export type SetTypeOp =
  | { kind: 'removeStage'; id: string }
  | { kind: 'updateHead'; id: string; changes: HeadChanges }
  | { kind: 'addStage'; weekPlanId: string; programExerciseId: string; parentId: string; setNumber: number; stageIndex: number }

export interface SetTypeChange {
  ops: SetTypeOp[]
  /** REST BETWEEN moved: the set's own program set gets this stage rest (null: the kind's own). Present only when the set has one. */
  stageRest?: { programSetId: string; stageRestSeconds: number | null }
}

/**
 * What picking `next` on the set type picker writes (SPEC "Set types and staged sets [1.2]": "Picking a staged kind adds its first stage; a
 * stepper sets how many. Switching back to Normal or Warmup removes the stages. A warmup can never be staged"; TASKS 54a: "Warmup on a staged
 * head removes the stages first").
 *
 *   - To Normal or Warmup: every stage row goes first (highest stage index first), then the head is written: `is_warmup` for the switch
 *     and a null `stage_kind` where the head carried one. Only the columns that change are named.
 *   - To a staged kind: the head's kind is written first when it changes (a plain set always writes it: picking Dropset writes
 *     `stage_kind: 'dropset'`), then stage rows are removed (the last ones, highest index first) or added (one past the highest index
 *     each) until the count is the picked one. A new stage starts empty, as ADD STAGE's did.
 *   - REST BETWEEN is the program set's, not the week's: it comes back as `stageRest`, and only for a set that has a program set of its
 *     own (the picker draws the row only then).
 *
 * The same type, or a type that differs in nothing a week writes, is no change.
 */
export function planSetTypeChange(row: PlanRow, next: SetType, programSet: ProgramSet | null): SetTypeChange {
  const current = setTypeOfRow(row, programSet)
  if (sameSetType(current, next)) return { ops: [] }

  const { head, stages } = row
  const ops: SetTypeOp[] = []
  const stagesLastFirst = cascadeDeleteOrder({ head, stages }, (s) => s.stageIndex).slice(0, -1)

  if (next.kind !== 'staged') {
    for (const stage of stagesLastFirst) ops.push({ kind: 'removeStage', id: stage.id })
    const headChanges: HeadChanges = {}
    const toWarmup = next.kind === 'warmup'
    if (head.isWarmup !== toWarmup) headChanges.isWarmup = toWarmup
    if ((head.stageKind ?? null) !== null) headChanges.stageKind = null
    if (Object.keys(headChanges).length > 0) ops.push({ kind: 'updateHead', id: head.id, changes: headChanges })
    return { ops }
  }

  const headChanges: HeadChanges = {}
  if (head.isWarmup) headChanges.isWarmup = false
  if (current.kind !== 'staged' || current.stageKind !== next.stageKind) headChanges.stageKind = next.stageKind
  if (Object.keys(headChanges).length > 0) ops.push({ kind: 'updateHead', id: head.id, changes: headChanges })

  const have = stages.length
  if (next.stageCount < have) {
    for (const stage of stagesLastFirst.slice(0, have - next.stageCount)) ops.push({ kind: 'removeStage', id: stage.id })
  } else {
    const first = nextStageIndex({ head, stages }, (s) => s.stageIndex)
    for (let i = 0; i < next.stageCount - have; i++) {
      ops.push({ kind: 'addStage', weekPlanId: head.weekPlanId, programExerciseId: head.programExerciseId, parentId: head.id, setNumber: head.setNumber, stageIndex: first + i })
    }
  }

  const change: SetTypeChange = { ops }
  const wasRest = current.kind === 'staged' ? current.stageRestSeconds : null
  if (programSet && next.stageRestSeconds !== wasRest) change.stageRest = { programSetId: programSet.id, stageRestSeconds: next.stageRestSeconds }
  return change
}

/** The rows REMOVE THIS SET takes, in the order they are removed: the stages, highest stage index first, then the head (setGroupLogic.ts's cascade order). */
export function removalOrder(row: PlanRow): string[] {
  return cascadeDeleteOrder({ head: row.head, stages: row.stages }, (s) => s.stageIndex).map((s) => s.id)
}

/** `DROPSET · 1 DROP`, `REST-PAUSE · 2 PAUSES`, `MYO-REPS · 3 MINI-SETS`, `CLUSTER · 1 CLUSTER` (board 1's kind chip, over a staged head). */
export function kindChipText(kind: StageKind, count: number): string {
  const plural = SET_TYPE_OPTIONS.find((option) => option.id === kind)?.stageLabel ?? 'STAGES'
  const noun = count === 1 ? plural.slice(0, -1) : plural
  return `${STAGE_KIND_LABELS[kind]} · ${count} ${noun}`
}

// ─── Reps, RIR, cues: "Use for all" ─────────────────────────────────────────────────────────────

const repTargetOfSet = (set: Pick<WeekPlanSet, 'repMin' | 'repMax' | 'isAmrap'>): RepTarget =>
  columnsToRepTarget({ repMin: set.repMin ?? null, repMax: set.repMax ?? null, isAmrap: set.isAmrap ?? false })

/**
 * The writes a rep target makes. One set (the head or the stage the box is on), or, with "Use for all", every head of the exercise
 * (a warmup too; a stage is never one, so a stage row's picker has no "Use for all"). A set that already has the target is not
 * written. A set that turns AMRAP with no RIR gets RIR 0 in the same write (SPEC "AMRAP: its RIR defaults to 0"); a warmup has no
 * RIR target (G49), so it never gets that default. Writes only the rep columns (and that default): the weight and the week's other
 * numbers are the set's own.
 */
export function repTargetPatches(input: { set: WeekPlanSet; heads: readonly WeekPlanSet[]; target: RepTarget; applyToAll: boolean }): SetPatch[] {
  const { set, heads, target, applyToAll } = input
  const wanted =
    applyToAll && set.parentWeekPlanSetId == null
      ? applyToAllTargets(heads.map((h) => ({ id: h.id, isWarmup: h.isWarmup })), target, 'reps').map((t) => t.id)
      : [set.id]
  const byId = new Map<string, WeekPlanSet>([...heads, set].map((s) => [s.id, s]))
  const patches: SetPatch[] = []
  for (const id of wanted) {
    const row = byId.get(id)
    if (!row) continue
    if (formatRepTarget(repTargetOfSet(row)) === formatRepTarget(target)) continue
    patches.push({ id, changes: row.isWarmup ? repTargetToColumns(target) : applyAmrapRirDefault(target, row.targetRir) })
  }
  return patches
}

/**
 * The writes a RIR target makes: `target_rir` and `target_rir_max` together (a number writes the high end null, none writes both null,
 * a range both ends), to one set, or with "Use for all" to every working head of the exercise (a warmup has no RIR target: G49; the
 * picker's own list skips it). A set that already holds the target is not written.
 */
export function rirTargetPatches(input: { set: WeekPlanSet; heads: readonly WeekPlanSet[]; target: RirTarget; applyToAll: boolean }): SetPatch[] {
  const { set, heads, target, applyToAll } = input
  const columns = rirTargetToColumns(target)
  const wanted =
    applyToAll && set.parentWeekPlanSetId == null
      ? applyToAllTargets(heads.map((h) => ({ id: h.id, isWarmup: h.isWarmup })), columns, 'rir').map((t) => t.id)
      : [set.id]
  const byId = new Map<string, WeekPlanSet>([...heads, set].map((s) => [s.id, s]))
  const patches: SetPatch[] = []
  for (const id of wanted) {
    const row = byId.get(id)
    if (!row) continue
    if ((row.targetRir ?? null) === columns.targetRir && (row.targetRirMax ?? null) === columns.targetRirMax) continue
    patches.push({ id, changes: { targetRir: columns.targetRir, targetRirMax: columns.targetRirMax } })
  }
  return patches
}

const sameList = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) => {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((value, i) => value === y[i])
}

/**
 * The writes a set of cues makes: the set's own tags are what the sheet returned (none is null, stored as null), written when they
 * differ from what the set has; with "Use for all", every other working head of the exercise also gets each cue it lacks
 * (`applyTagToAllHeads`: never a warmup, never a stage, never a removal). Each head is one write that carries all its cues: the cues
 * are folded in one after another over each head's own tags, so two cues never write the same row twice from the same old list.
 */
export function cuePatches(input: { set: WeekPlanSet; heads: readonly WeekPlanSet[]; cues: readonly string[]; applyToAll: boolean }): SetPatch[] {
  const { set, heads, applyToAll } = input
  const own = normaliseCues(input.cues)
  const patches: SetPatch[] = []
  if (!sameList(set.tags, own)) patches.push({ id: set.id, changes: { tags: own.length === 0 ? null : own } })
  if (!applyToAll || set.parentWeekPlanSetId != null) return patches

  let local = heads.map((h) => ({ id: h.id, tags: h.id === set.id ? own : (h.tags ?? null), isWarmup: h.isWarmup }))
  const touched = new Map<string, string[]>()
  for (const cue of own) {
    for (const update of applyTagToAllHeads(local, cue)) {
      local = local.map((l) => (l.id === update.id ? { ...l, tags: update.tags } : l))
      touched.set(update.id, update.tags)
    }
  }
  for (const head of heads) {
    const tags = touched.get(head.id)
    if (tags && head.id !== set.id) patches.push({ id: head.id, changes: { tags } })
  }
  return patches
}

// ─── Supersets ──────────────────────────────────────────────────────────────────────────────────────

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * The SUPERSET chip's letter and place (board 1: `SUPERSET A · 1`, `SUPERSET A · 2`). A superset is a run of two or more exercises in
 * the week's own order that share a block; its letter is its place among the week's supersets (A, B, ...), as CHANGE THE PROGRAM
 * letters them, and the number is the member's place in it from 1. An exercise in no superset has no entry.
 */
export function supersetChips(exercises: readonly ProgramExercise[]): Map<string, { letter: string; member: number }> {
  const chips = new Map<string, { letter: string; member: number }>()
  let block = 0
  for (const unit of groupIntoUnits([...exercises])) {
    if (unit.length < 2) continue
    const letter = block < LETTERS.length ? LETTERS[block] : `#${block + 1}`
    block += 1
    unit.forEach((member, index) => chips.set(member.id, { letter, member: index + 1 }))
  }
  return chips
}
