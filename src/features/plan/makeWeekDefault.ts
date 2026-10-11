import type { ProgramExercise, ProgramSet, WeekPlan } from '../../types'
import { columnsToRepTarget, formatRepTarget, type StageKind } from '../../lib/plannerVocabulary.js'
import type { AheadGroup, ChangeRecord, DefaultRelink, DefaultSetShape, ReorderMove } from './applyAhead'

// Chunk 32 (TASKS-1.1 "Stable: Make this week the new default"; SPEC Weeks and copying
// [P1.1]): the pure half of the action. Supabase-free and React-free, so every rule
// below is tested directly; MakeWeekDefault.tsx draws the action, makeDefaultService.ts
// makes the call, and applyAhead.ts plans what the offer writes.
//
// Three things live here:
//   1. Whether a week can be made the default at all (canMakeWeekDefault), the client's
//      form of the function's own refusals.
//   2. The RPC's answer, parsed (parseMakeDefaultResult): the OLD default of every
//      workout whose default it rewrote, and the workouts it left alone.
//   3. Old default → new default as change records (diffDefault) and the offer built
//      from them (buildDefaultOffer): "Apply this change to planned weeks ahead".

// ─── 1. Can this week be made the default ─────────────────────────────────────

// A session can be the source of its workout's default when it is neither deload nor
// empty. This is v2_make_week_default's own test (migration 040: `usable = not is_deload
// and not is_empty`), kept in step with it: a session is empty when no planned set sits
// under any of its exercise rows (a set of a row the session no longer lists doesn't
// count — the function joins sets to the session's own exercise rows).
//   - deload: "Deload sessions are excluded: their workouts keep the current default";
//   - empty: the function skips it the way v2_plan_week skips an empty copy source
//     (DECISIONS 99, provisional), so one emptied session can't wipe its workout's default.
export function isDefaultSource(plan: Pick<WeekPlan, 'isDeload' | 'sets' | 'exercises'>): boolean {
  if (plan.isDeload) return false
  const rows = new Set(plan.exercises.map((e) => e.id))
  return plan.sets.some((s) => rows.has(s.programExerciseId))
}

// "It isn't offered on a week that's all deload" — and, as the function refuses it,
// not on a week whose sessions are all deload or empty either (and not on a week with
// no session planned yet). One session that can be a source is enough: the others keep
// their workouts' current default.
export function canMakeWeekDefault(plans: WeekPlan[]): boolean {
  return plans.some(isDefaultSource)
}

// ─── 2. The default, as the function reports it and as the run's copy holds it ───

// One program set of a default. Heads and stages together; a stage names its head.
export interface DefaultSet {
  id: string
  position: number
  isWarmup: boolean
  parentProgramSetId: string | null
  stageIndex: number // 0 on a head
  stageKind: StageKind | null // heads only
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
}

// One exercise row of a default, with its program sets that are part of it.
export interface DefaultExercise {
  id: string // v2_program_exercises.id
  exerciseId: string
  position: number
  sets: DefaultSet[]
}

export interface MakeDefaultWorkout {
  workoutDayId: string
  // The session that became the default, and its slot in a sequence cycle (null on a
  // weekday run).
  sourceWeekPlanId: string
  sourceSequencePosition: number | null
  // The workout's default as it was before the call.
  oldExercises: DefaultExercise[]
}

export interface MakeDefaultResult {
  mesocycleId: string
  weekNumber: number
  workouts: MakeDefaultWorkout[]
  // Workouts whose default was not touched: every session of theirs this week is deload
  // ('deload') or deload/empty mixed ('empty').
  skipped: { workoutDayId: string; reason: 'deload' | 'empty' }[]
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const STAGE_KIND_VALUES: readonly string[] = ['dropset', 'rest_pause', 'myo_reps', 'cluster']

function parseSet(raw: unknown): DefaultSet | null {
  if (!isObject(raw) || !str(raw.id)) return null
  return {
    id: str(raw.id),
    position: num(raw.position),
    isWarmup: raw.is_warmup === true,
    parentProgramSetId: typeof raw.parent_program_set_id === 'string' ? raw.parent_program_set_id : null,
    stageIndex: num(raw.stage_index),
    stageKind: typeof raw.stage_kind === 'string' && STAGE_KIND_VALUES.includes(raw.stage_kind) ? (raw.stage_kind as StageKind) : null,
    repMin: numOrNull(raw.rep_min),
    repMax: numOrNull(raw.rep_max),
    isAmrap: raw.is_amrap === true,
  }
}

function parseExercise(raw: unknown): DefaultExercise | null {
  if (!isObject(raw) || !str(raw.id)) return null
  const sets = Array.isArray(raw.sets) ? raw.sets.map(parseSet).filter((s): s is DefaultSet => s !== null) : []
  return { id: str(raw.id), exerciseId: str(raw.exercise_id), position: num(raw.position), sets }
}

// The function's jsonb (migration 040's header documents the shape), as camelCase
// values. Read leniently: the default has been written by the time this runs, so an
// answer that can't be read must not look like a failed call; it reads as "nothing to
// offer" (no workouts), and the caller shows nothing wrong.
export function parseMakeDefaultResult(json: unknown): MakeDefaultResult {
  const root = isObject(json) ? json : {}
  const workouts: MakeDefaultWorkout[] = []
  for (const raw of Array.isArray(root.workouts) ? root.workouts : []) {
    if (!isObject(raw) || !str(raw.workout_day_id)) continue
    const source = isObject(raw.source) ? raw.source : {}
    const oldDefault = isObject(raw.old_default) ? raw.old_default : {}
    workouts.push({
      workoutDayId: str(raw.workout_day_id),
      sourceWeekPlanId: str(source.week_plan_id),
      sourceSequencePosition: numOrNull(source.sequence_position),
      oldExercises: (Array.isArray(oldDefault.exercises) ? oldDefault.exercises : [])
        .map(parseExercise)
        .filter((e): e is DefaultExercise => e !== null),
    })
  }
  const skipped: MakeDefaultResult['skipped'] = []
  for (const raw of Array.isArray(root.skipped) ? root.skipped : []) {
    if (!isObject(raw) || !str(raw.workout_day_id)) continue
    skipped.push({ workoutDayId: str(raw.workout_day_id), reason: raw.reason === 'deload' ? 'deload' : 'empty' })
  }
  return { mesocycleId: str(root.mesocycle_id), weekNumber: num(root.week_number), workouts, skipped }
}

// The run's copy of one workout as it is after the call (the NEW default): its current
// exercise rows (not week-only, not removed: fetchRunProgramExercises) with the program
// sets that are part of the default — a set with removed_at set was dropped from it
// (fetchProgramSets keeps returning those, the workout screen finds rest through them).
// Heads and stages both; warmups are heads like any other.
export function toDefaultExercises(exercises: ProgramExercise[], programSets: ProgramSet[]): DefaultExercise[] {
  const live = programSets.filter((ps) => !ps.removedAt)
  return exercises.map((pe) => ({
    id: pe.id,
    exerciseId: pe.exerciseId,
    position: pe.position,
    sets: live
      .filter((ps) => ps.programExerciseId === pe.id)
      .map((ps) => ({
        id: ps.id,
        position: ps.position,
        isWarmup: ps.isWarmup,
        parentProgramSetId: ps.parentProgramSetId,
        stageIndex: ps.stageIndex,
        stageKind: ps.stageKind,
        repMin: ps.repMin,
        repMax: ps.repMax,
        isAmrap: ps.isAmrap,
      })),
  }))
}

// ─── 3. Old default → new default, as change records ──────────────────────────

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
type Positioned = { position: number; id: string }
const byPositionThenId = (a: Positioned, b: Positioned) => a.position - b.position || compareIds(a.id, b.id)

// Heads in the order the default holds them, warmups included (the order the sets show
// in: a warmup sits above the working sets), each with its stages in stage order.
function headsOf(sets: DefaultSet[]): DefaultSet[] {
  return sets.filter((s) => s.parentProgramSetId == null).sort(byPositionThenId)
}
function stagesOf(sets: DefaultSet[], headId: string): DefaultSet[] {
  return sets.filter((s) => s.parentProgramSetId === headId).sort((a, b) => a.stageIndex - b.stageIndex || compareIds(a.id, b.id))
}

const repOf = (s: DefaultSet) => ({ repMin: s.repMin, repMax: s.repMax, isAmrap: s.isAmrap })
// Rep targets are compared as a row shows them (8 to 8 is "8"), as Plan's highlighting does.
const repKey = (s: DefaultSet) => formatRepTarget(columnsToRepTarget(repOf(s)))
// A warmup is never staged: its program set carries no stage kind (the function writes none).
const kindOf = (s: DefaultSet): StageKind | null => (s.isWarmup ? null : s.stageKind)

// The program set as a week row is written from it. `programExerciseId` is the row the
// set belongs to in the NEW default (a swapped-in row's, for a swapped slot).
function toShape(set: DefaultSet, all: DefaultSet[], programExerciseId: string): DefaultSetShape {
  return {
    programSetId: set.id,
    programExerciseId,
    position: set.position,
    isWarmup: set.isWarmup,
    stageKind: kindOf(set),
    ...repOf(set),
    stageIndex: set.parentProgramSetId == null ? 0 : set.stageIndex,
    stages: set.parentProgramSetId == null ? stagesOf(all, set.id).map((st) => toShape(st, all, programExerciseId)) : [],
  }
}

type Pairing = 'id' | 'ordinal'

// A slot's sets, old default → new default. `slot` is the row the later week holds (the
// OLD default's row); `targetRowId` the row the new sets belong to — the same row for a
// kept exercise, the swapped-in row for a swapped one.
//   - Kept exercise ('id'): a set is the same set when it is the same program set. The
//     function updates a program set IN PLACE when the source week's set named it, so a
//     set that merely changed (its rep target, its kind) keeps its id.
//   - Swapped exercise ('ordinal'): the swapped-in row has program sets of its own (new
//     ids), made from the source week's sets, which moved with the swap in their order.
//     The nth head of the old row stands for the nth head of the new one, and a head's
//     stages likewise.
// Position within the exercise is not a part: a week keeps its own set numbers, and an
// added set goes where the week's own rows say (applyAhead.ts).
function diffSets(
  slot: { slotId: string; exerciseId: string },
  targetRowId: string,
  oldSets: DefaultSet[],
  newSets: DefaultSet[],
  pairing: Pairing,
): { records: ChangeRecord[]; relink: DefaultRelink[] } {
  const oldHeads = headsOf(oldSets)
  const newHeads = headsOf(newSets)
  const pairedHead = new Map<string, DefaultSet>() // old head id → new head
  if (pairing === 'id') {
    for (const p of oldHeads) {
      const q = newHeads.find((h) => h.id === p.id)
      if (q) pairedHead.set(p.id, q)
    }
  } else {
    oldHeads.forEach((p, i) => {
      if (i < newHeads.length) pairedHead.set(p.id, newHeads[i])
    })
  }
  const pairedNewHeads = new Set([...pairedHead.values()].map((q) => q.id))

  const removals: ChangeRecord[] = []
  const updates: ChangeRecord[] = []
  const additions: ChangeRecord[] = []
  const relink: DefaultRelink[] = []
  const { slotId, exerciseId } = slot

  oldHeads.forEach((p, i) => {
    const headOrdinal = i + 1
    const q = pairedHead.get(p.id)
    if (!q) {
      // The head is gone from the default, and its stages with it (the week set's stages
      // are deleted with it).
      removals.push({ editType: 'removeHeadSet', slotId, exerciseId, headOrdinal, defaultSet: { programSetId: p.id } })
      return
    }
    if (pairing === 'ordinal') relink.push({ from: p.id, to: q.id })

    const setPosition = { headOrdinal, stageIndex: null }
    if (repKey(p) !== repKey(q)) {
      updates.push({ editType: 'repTarget', slotId, exerciseId, setPosition, oldValue: repOf(p), newValue: repOf(q), defaultSet: { programSetId: p.id } })
    }
    if (p.isWarmup !== q.isWarmup) {
      updates.push({ editType: 'warmup', slotId, exerciseId, setPosition, oldValue: p.isWarmup, newValue: q.isWarmup, defaultSet: { programSetId: p.id } })
    }
    if (kindOf(p) !== kindOf(q)) {
      updates.push({ editType: 'stageKind', slotId, exerciseId, setPosition, oldValue: kindOf(p), newValue: kindOf(q), defaultSet: { programSetId: p.id } })
    }

    // The head's stages.
    const oldStages = stagesOf(oldSets, p.id)
    const newStages = stagesOf(newSets, q.id)
    const pairedStage = new Map<string, DefaultSet>() // old stage id → new stage
    if (pairing === 'id') {
      for (const s of oldStages) {
        const t = newStages.find((x) => x.id === s.id)
        if (t) pairedStage.set(s.id, t)
      }
    } else {
      oldStages.forEach((s, k) => {
        if (k < newStages.length) pairedStage.set(s.id, newStages[k])
      })
    }
    const pairedNewStages = new Set([...pairedStage.values()].map((t) => t.id))
    for (const s of oldStages) {
      const t = pairedStage.get(s.id)
      const stagePosition = { headOrdinal, stageIndex: s.stageIndex }
      if (!t) {
        removals.push({ editType: 'removeStage', slotId, exerciseId, setPosition: stagePosition, defaultSet: { programSetId: s.id } })
        continue
      }
      if (pairing === 'ordinal') relink.push({ from: s.id, to: t.id })
      if (repKey(s) !== repKey(t)) {
        updates.push({ editType: 'repTarget', slotId, exerciseId, setPosition: stagePosition, oldValue: repOf(s), newValue: repOf(t), defaultSet: { programSetId: s.id } })
      }
    }
    for (const t of newStages) {
      if (pairedNewStages.has(t.id)) continue
      additions.push({
        editType: 'addStage',
        slotId,
        exerciseId,
        headOrdinal,
        headProgramSetId: p.id,
        defaultSet: toShape(t, newSets, targetRowId),
      })
    }
  })

  for (const q of newHeads) {
    if (pairedNewHeads.has(q.id)) continue
    additions.push({
      editType: q.isWarmup ? 'addWarmupSet' : 'addSet',
      slotId,
      exerciseId,
      defaultSet: toShape(q, newSets, targetRowId),
    })
  }

  return { records: [...removals, ...updates, ...additions], relink }
}

// A swap is a removed row and an added row at the same position (the source week's
// swap puts the replacement at the replaced row's place). Anything else that left or
// joined the default is a removal or an addition by itself. A swap that also moved is
// both of those: the function can't tell it from a removal and an addition.
function pairSwaps(removed: DefaultExercise[], added: DefaultExercise[]) {
  const used = new Set<string>()
  const swaps: { old: DefaultExercise; neu: DefaultExercise }[] = []
  const removedOnly: DefaultExercise[] = []
  for (const r of removed) {
    const a = added.find((x) => !used.has(x.id) && x.position === r.position)
    if (a) {
      used.add(a.id)
      swaps.push({ old: r, neu: a })
    } else {
      removedOnly.push(r)
    }
  }
  return { swaps, removedOnly, addedOnly: added.filter((x) => !used.has(x.id)) }
}

// The moves that put the kept exercises where the new default has them, split into
// independent parts: moves that trade or hand on places (one's new position is another's
// old one) are one part, because applying half of them leaves two exercises in one place.
function reorderRecords(kept: { old: DefaultExercise; neu: DefaultExercise }[]): ChangeRecord[] {
  const moves: ReorderMove[] = kept
    .filter(({ old, neu }) => old.position !== neu.position)
    .map(({ old, neu }) => ({ slotId: old.id, oldPosition: old.position, newPosition: neu.position }))
    .sort((a, b) => a.oldPosition - b.oldPosition || compareIds(a.slotId, b.slotId))
  if (moves.length === 0) return []

  // Union-find over positions: a move joins its old and its new position.
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    const p = parent.get(x)
    if (p === undefined || p === x) return x
    const root = find(p)
    parent.set(x, root)
    return root
  }
  for (const m of moves) {
    for (const pos of [m.oldPosition, m.newPosition]) if (!parent.has(pos)) parent.set(pos, pos)
    parent.set(find(m.oldPosition), find(m.newPosition))
  }
  const parts = new Map<number, ReorderMove[]>()
  for (const m of moves) {
    const root = find(m.oldPosition)
    parts.set(root, [...(parts.get(root) ?? []), m])
  }
  return [...parts.values()].map((part) => ({ editType: 'reorderExercise' as const, moves: part }))
}

// One workout's old default → its new one, as records of the existing types (G26):
//   removeExercise     a row that left the default
//   swapExercise       a row replaced by one at the same place (the later week's row and
//                      its sets are re-pointed at the swapped-in row and its program sets)
//   <set-level>        removeHeadSet / removeStage / repTarget / warmup / stageKind for a
//                      set that changed or left; addSet / addWarmupSet / addStage for one
//                      that joined, each naming its new program set
//   reorderExercise    kept rows whose place changed
//   addExercise        a row that joined, with the program sets it brought
// In that order, so a week's ops are written removals first, additions last. Every part
// is its own record: a later week takes the ones whose old part it still holds
// (applyAhead.ts planApplyAheadGroups).
export function diffDefault(workoutDayId: string, oldExercises: DefaultExercise[], newExercises: DefaultExercise[]): AheadGroup {
  const oldRows = [...oldExercises].sort(byPositionThenId)
  const newRows = [...newExercises].sort(byPositionThenId)
  const newById = new Map(newRows.map((e) => [e.id, e]))
  const oldIds = new Set(oldRows.map((e) => e.id))

  const kept = oldRows.filter((o) => newById.has(o.id)).map((o) => ({ old: o, neu: newById.get(o.id)! }))
  const removed = oldRows.filter((o) => !newById.has(o.id))
  const added = newRows.filter((n) => !oldIds.has(n.id))
  const { swaps, removedOnly, addedOnly } = pairSwaps(removed, added)

  const removals: ChangeRecord[] = removedOnly.map((o) => ({ editType: 'removeExercise', slotId: o.id, exerciseId: o.exerciseId }))

  const swapRecords: ChangeRecord[] = []
  const setRecords: ChangeRecord[] = []
  // Set-level records of kept and of swapped slots, in the old default's order.
  const slots = [
    ...kept.map((k) => ({ old: k.old, neu: k.neu, pairing: 'id' as Pairing })),
    ...swaps.map((s) => ({ old: s.old, neu: s.neu, pairing: 'ordinal' as Pairing })),
  ].sort((a, b) => byPositionThenId(a.old, b.old))
  for (const slot of slots) {
    const { records, relink } = diffSets({ slotId: slot.old.id, exerciseId: slot.old.exerciseId }, slot.neu.id, slot.old.sets, slot.neu.sets, slot.pairing)
    if (slot.pairing === 'ordinal') {
      swapRecords.push({
        editType: 'swapExercise',
        slotId: slot.old.id,
        exerciseId: slot.old.exerciseId,
        newExerciseId: slot.neu.exerciseId,
        resultingProgramExerciseId: slot.neu.id,
        relink,
      })
    }
    setRecords.push(...records)
  }

  const additions: ChangeRecord[] = addedOnly.map((n) => ({
    editType: 'addExercise',
    workoutDayId,
    exerciseId: n.exerciseId,
    defaultRow: {
      programExerciseId: n.id,
      position: n.position,
      sets: headsOf(n.sets).map((h) => toShape(h, n.sets, n.id)),
    },
  }))

  return { workoutDayId, changes: [...removals, ...swapRecords, ...setRecords, ...reorderRecords(kept), ...additions] }
}

// ─── The offer: what to apply, and to which later weeks ───────────────────────

export interface DefaultOffer {
  groups: AheadGroup[] // one per workout that has something to apply
  weeks: WeekPlan[] // the later planned sessions of those workouts
  weekCount: number // ... in weeks (cycles) — what the offer says
}

// The later planned weeks of a rewritten workout: its sessions in weeks after the one
// made the default (on a sequence run, every slot of the workout in later cycles — a
// default belongs to the workout, not to a slot). Weeks before and the week itself are
// not "ahead". The cycle's OTHER occurrences of the workout are not later weeks and are
// left as planned.
export function laterSessionsOf(allWeekPlans: WeekPlan[], workoutDayId: string, weekNumber: number): WeekPlan[] {
  return allWeekPlans
    .filter((w) => w.workoutDayId === workoutDayId && w.weekNumber > weekNumber)
    .sort((a, b) => a.weekNumber - b.weekNumber || (a.sequencePosition ?? 0) - (b.sequencePosition ?? 0))
}

// null when there is nothing to offer: no later week of a rewritten workout is planned
// ("the offer shows only when later weeks are planned"), or the new default is what the
// old one was. A workout whose new default couldn't be read is left out.
export function buildDefaultOffer(
  result: MakeDefaultResult,
  newDefaults: ReadonlyMap<string, DefaultExercise[]>,
  allWeekPlans: WeekPlan[],
): DefaultOffer | null {
  const groups: AheadGroup[] = []
  const weeks: WeekPlan[] = []
  for (const workout of result.workouts) {
    const later = laterSessionsOf(allWeekPlans, workout.workoutDayId, result.weekNumber)
    if (later.length === 0) continue
    const next = newDefaults.get(workout.workoutDayId)
    if (!next) continue
    const group = diffDefault(workout.workoutDayId, workout.oldExercises, next)
    if (group.changes.length === 0) continue
    groups.push(group)
    weeks.push(...later)
  }
  if (groups.length === 0) return null
  return { groups, weeks, weekCount: new Set(weeks.map((w) => w.weekNumber)).size }
}
