import type { ProgramExercise, ProgramSet, WeekPlan } from '../../types'
import { columnsToRepTarget, formatRepTarget, resolveStageKind, type StageKind } from '../../lib/plannerVocabulary.js'
import { headKindOf, type AheadGroup, type ChangeRecord, type DefaultRelink, type DefaultSetKey, type DefaultSetShape, type HeadKind, type ReorderMove } from './applyAhead'

// Chunk 32 (TASKS-1.1 "Stable: Make this week the new default"; SPEC Weeks and copying
// [P1.1]): the pure half of the action. Supabase-free and React-free, so every rule
// below is tested directly; MakeWeekDefault.tsx draws the action, makeDefaultService.ts
// makes the call, and applyAhead.ts plans what the offer writes.
//
// Four things live here:
//   1. Whether a week can be made the default at all (canMakeWeekDefault), the client's
//      form of the function's own refusals.
//   2. The RPC's answer, parsed (parseMakeDefaultResult): the OLD default of every
//      workout whose default it rewrote, and the workouts it left alone.
//   3. What the source week showed BEFORE the call, which is the only trace of a swap
//      (sourceLinksOf), and, with what it shows after it, the exact old program set →
//      new program set of every set that moved with a swap (sourceSetLinksOf, chainOf).
//   4. Old default → new default as change records (diffDefault) and the offer built
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

// ─── 3. What the source week showed before the call: the evidence of a swap ───

// A swap in the source week moves the replaced row's sets to the swapped-in row with their
// `program_set_id` unchanged (weekPlanService.ts swapWeekExercise), so the swapped-in row's
// planned sets still NAME the replaced row's program sets. An exercise added by hand has
// sets that name nothing. That link is the only trace of a swap in what the function
// answers (the old default's rows say what left and what joined, not whether one replaced
// the other), and the call erases it from the week: it points every planned set of the
// source week at the program set it ends up on. So it is read from the week as Plan holds
// it BEFORE the call (MakeWeekDefault.tsx does, on confirm).
// Per exercise row the session lists: the program sets its planned sets named.
export type SourceLinks = ReadonlyMap<string, ReadonlySet<string>>

export function sourceLinksOf(plan: Pick<WeekPlan, 'exercises' | 'sets'>): SourceLinks {
  // The function only reads sets under rows the session lists.
  const rows = new Set(plan.exercises.map((e) => e.id))
  const links = new Map<string, Set<string>>()
  for (const s of plan.sets) {
    if (!s.programSetId || !rows.has(s.programExerciseId)) continue
    const named = links.get(s.programExerciseId) ?? new Set<string>()
    named.add(s.programSetId)
    links.set(s.programExerciseId, named)
  }
  return links
}

// The same, per planned set: the program set each planned set (head or stage) of the
// session named, by the planned set's id. Read before the call; after it the SAME planned
// set names the program set it ended up on. A swapped-in row's set that moved from one to
// another is an exact pair, old program set → new program set (chainOf), which is how a
// swapped slot's sets are paired: by what the source week did with each of them, not by
// where they sit.
export type SourceSetLinks = ReadonlyMap<string, string>

export function sourceSetLinksOf(plan: Pick<WeekPlan, 'exercises' | 'sets'>): SourceSetLinks {
  // The function only reads sets under rows the session lists.
  const rows = new Set(plan.exercises.map((e) => e.id))
  const links = new Map<string, string>()
  for (const s of plan.sets) {
    if (s.programSetId && rows.has(s.programExerciseId)) links.set(s.id, s.programSetId)
  }
  return links
}

// Old program set → new program set, from one session read before the call and after it.
// A planned set that names the same program set after as before (a kept row's: the call
// updates its program set in place) is no pair, and a planned set with no link before (an
// exercise or set added in the source week) is nobody's partner. If two planned sets
// named one old program set and ended on different new ones (a hand-made duplicate), that
// old set has no exact partner and is left out: a pair that is not exact is no pair.
export function chainOf(before: SourceSetLinks, after: SourceSetLinks): ReadonlyMap<string, string> {
  const chain = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [setId, from] of before) {
    const to = after.get(setId)
    if (!to || to === from) continue
    const seen = chain.get(from)
    if (seen !== undefined && seen !== to) ambiguous.add(from)
    chain.set(from, to)
  }
  for (const from of ambiguous) chain.delete(from)
  return chain
}

// The chain of every session of the made week (by the session's id), from what Plan held
// before the call and what the database holds after it. A session that could not be read
// after gets an empty chain: its swapped slots are paired by the fallback.
export function chainsOf(
  before: ReadonlyMap<string, SourceSetLinks>,
  after: ReadonlyMap<string, SourceSetLinks>,
): Map<string, ReadonlyMap<string, string>> {
  return new Map([...before].map(([planId, b]) => [planId, chainOf(b, after.get(planId) ?? new Map<string, string>())]))
}

// ─── 4. Old default → new default, as change records ──────────────────────────

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
// set belongs to in the NEW default (a swapped-in row's, for a swapped slot). A warmup is
// never staged (the app gives it no stage controls and offers WARMUP on no staged head), so
// a warmup's stage rows, which only a default made of such a set could hold, are not carried:
// nothing written from a default is both a warmup and staged.
function toShape(set: DefaultSet, all: DefaultSet[], programExerciseId: string): DefaultSetShape {
  return {
    programSetId: set.id,
    programExerciseId,
    position: set.position,
    isWarmup: set.isWarmup,
    stageKind: kindOf(set),
    ...repOf(set),
    stageIndex: set.parentProgramSetId == null ? 0 : set.stageIndex,
    stages: set.parentProgramSetId == null && !set.isWarmup ? stagesOf(all, set.id).map((st) => toShape(st, all, programExerciseId)) : [],
  }
}

type Pairing = 'id' | 'chain' | 'ordinal'

// A slot's sets, old default → new default. `slot` is the row the later week holds (the
// OLD default's row); `targetRowId` the row the new sets belong to — the same row for a
// kept exercise, the swapped-in row for a swapped one.
//   - Kept exercise ('id'): a set is the same set when it is the same program set. The
//     function updates a program set IN PLACE when the source week's set named it, so a
//     set that merely changed (its rep target, its kind) keeps its id.
//   - Swapped exercise: the swapped-in row has program sets of its own (new ids), made
//     from the source week's sets, which moved with the swap. Two ways to pair them:
//       'chain': by identity. Each planned set of the source week named an old program set
//         before the call and names a new one after it (chainOf), so old → new is exact:
//         a set the source week deleted has no partner and is a removal, a set it added
//         has none and is an addition, exactly as in a kept slot. Used wherever the chain
//         could be read for the slot.
//       'ordinal': only where it could not (the source week was not re-read after the
//         call): by ordinal WITHIN KIND, the nth warmup of the old row for the nth warmup
//         of the new one and the nth working set for the nth working set (G44's rule, the
//         one weights are paired by), a head's stages by stage index. A guess at identity,
//         which is wrong when the source week deleted a set before the last one.
// Position within the exercise is not a part: a week keeps its own set numbers, and an
// added set goes where the week's own rows say (applyAhead.ts).
function diffSets(
  slot: { slotId: string; exerciseId: string },
  targetRowId: string,
  oldSets: DefaultSet[],
  newSets: DefaultSet[],
  pairing: Pairing,
  chain?: ReadonlyMap<string, string>,
): { records: ChangeRecord[]; relink: DefaultRelink[] } {
  const oldHeads = headsOf(oldSets)
  const newHeads = headsOf(newSets)
  const pairedHead = new Map<string, DefaultSet>() // old head id → new head
  if (pairing === 'id') {
    for (const p of oldHeads) {
      const q = newHeads.find((h) => h.id === p.id)
      if (q) pairedHead.set(p.id, q)
    }
  } else if (pairing === 'chain') {
    for (const p of oldHeads) {
      const to = chain?.get(p.id)
      const q = to === undefined ? undefined : newHeads.find((h) => h.id === to)
      if (q) pairedHead.set(p.id, q)
    }
  } else {
    for (const warmup of [true, false]) {
      const olds = oldHeads.filter((h) => h.isWarmup === warmup)
      const news = newHeads.filter((h) => h.isWarmup === warmup)
      olds.forEach((p, i) => {
        if (i < news.length) pairedHead.set(p.id, news[i])
      })
    }
  }
  const pairedNewHeads = new Set([...pairedHead.values()].map((q) => q.id))

  const removals: ChangeRecord[] = []
  const updates: ChangeRecord[] = []
  const additions: ChangeRecord[] = []
  const relink: DefaultRelink[] = []
  const { slotId, exerciseId } = slot
  // How a record names the old default's program set it is about. For a swapped slot it
  // also names the swapped-in row, which a week that took the swap already holds. The
  // kind records also name the old head's WHOLE kind (applyAhead.ts headKindOf), and a
  // warmup the old head's stages.
  const keyOf = (programSetId: string, extra: { headKind?: HeadKind; oldStageIds?: string[] } = {}): DefaultSetKey => ({
    programSetId,
    ...(pairing !== 'id' ? { swappedInto: targetRowId } : {}),
    ...extra,
  })
  const oldHeadIds = oldHeads.map((h) => h.id)

  oldHeads.forEach((p, i) => {
    const headOrdinal = i + 1
    const q = pairedHead.get(p.id)
    if (!q) {
      // The head is gone from the default, and its stages with it (the week set's stages
      // are deleted with it).
      removals.push({ editType: 'removeHeadSet', slotId, exerciseId, headOrdinal, defaultSet: keyOf(p.id) })
      return
    }
    if (pairing !== 'id') relink.push({ from: p.id, to: q.id })

    // The head's stages: the same program set for a kept exercise, the one the source
    // week's stage moved to for a swapped one (the stage index where there is no chain).
    const oldStages = stagesOf(oldSets, p.id)
    // (A warmup has no stages in the app, so none that a default holds under one are carried
    // either: every stage of the old head then goes, and none is added under the warmup.)
    const newStages = q.isWarmup ? [] : stagesOf(newSets, q.id)
    // The head's kind is ONE part: what the old head was as a whole (a warmup, a plain
    // working set, or staged with its resolved kind), which a later week must still be for
    // any kind record to apply to it. Taken from the stages the OLD default has.
    const oldKind = headKindOf(p, oldStages.length > 0)
    const newStaged = !q.isWarmup && newStages.length > 0

    const setPosition = { headOrdinal, stageIndex: null }
    if (repKey(p) !== repKey(q)) {
      updates.push({ editType: 'repTarget', slotId, exerciseId, setPosition, oldValue: repOf(p), newValue: repOf(q), defaultSet: keyOf(p.id) })
    }
    if (p.isWarmup !== q.isWarmup) {
      updates.push({
        editType: 'warmup', slotId, exerciseId, setPosition, oldValue: p.isWarmup, newValue: q.isWarmup,
        defaultSet: keyOf(p.id, { headKind: oldKind, oldStageIds: oldStages.map((x) => x.id) }),
      })
    }
    // A stage kind is only a part of a head that is staged afterwards, and a different one
    // only where the RESOLVED kinds differ: a null kind on a head with stages reads as a
    // dropset, so null → 'dropset' changes nothing and writes nothing. (A head that is a
    // plain working set or a warmup afterwards has no kind that shows anywhere.)
    if (newStaged && resolveStageKind(p.stageKind) !== resolveStageKind(q.stageKind)) {
      updates.push({
        editType: 'stageKind', slotId, exerciseId, setPosition, oldValue: kindOf(p), newValue: kindOf(q),
        defaultSet: keyOf(p.id, { headKind: oldKind }),
      })
    }

    const pairedStage = new Map<string, DefaultSet>() // old stage id → new stage
    for (const s of oldStages) {
      const t = newStages.find((x) =>
        pairing === 'id' ? x.id === s.id : pairing === 'chain' ? chain?.get(s.id) === x.id : x.stageIndex === s.stageIndex,
      )
      if (t) pairedStage.set(s.id, t)
    }
    const pairedNewStages = new Set([...pairedStage.values()].map((t) => t.id))
    for (const s of oldStages) {
      const t = pairedStage.get(s.id)
      const stagePosition = { headOrdinal, stageIndex: s.stageIndex }
      if (!t) {
        // The head's old whole kind goes with it: a week that changed the head's kind
        // itself has stages of its own, and keeps them (applyAhead.ts).
        removals.push({ editType: 'removeStage', slotId, exerciseId, setPosition: stagePosition, defaultSet: keyOf(s.id, { headKind: oldKind }) })
        continue
      }
      if (pairing !== 'id') relink.push({ from: s.id, to: t.id })
      if (repKey(s) !== repKey(t)) {
        updates.push({ editType: 'repTarget', slotId, exerciseId, setPosition: stagePosition, oldValue: repOf(s), newValue: repOf(t), defaultSet: keyOf(s.id) })
      }
    }
    for (const t of newStages) {
      if (pairedNewStages.has(t.id)) continue
      // The head is found in a later week by its OLD program set `p.id` — also for a
      // swapped slot, whose week's head still names the replaced row's program set until
      // the swap record re-links it (a record is matched against the week as it is, not as
      // the records before it leave it).
      additions.push({
        editType: 'addStage',
        slotId,
        exerciseId,
        headOrdinal,
        headProgramSetId: p.id,
        defaultSet: toShape(t, newSets, targetRowId),
        oldSetIds: oldStages.map((x) => x.id),
        headKind: oldKind,
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
      oldSetIds: oldHeadIds,
    })
  }

  return { records: [...removals, ...updates, ...additions], relink }
}

// A swap is a removed row R and an added row N where the source week SHOWED a swap: N's
// planned sets, in that week, named R's program sets (SourceLinks above), and N sits at R's
// place (the source week's swap puts the replacement where the replaced row was).
// Position alone is never enough: removing the last exercise and adding another puts the
// new row at the removed row's position, and reading that as a swap would repoint a later
// week's removed row at an exercise that was merely added, with the removed row's sets and
// their weights. Without the evidence (`links` absent: the source week was not at hand, or
// N's sets name nothing, or name more than one removed row) it is a removal and an
// addition, never a swap. A swap that was moved afterwards is the same: re-pointing a row
// cannot also carry its place.
function pairSwaps(removed: DefaultExercise[], added: DefaultExercise[], links: SourceLinks | undefined) {
  const used = new Set<string>()
  const swaps: { old: DefaultExercise; neu: DefaultExercise }[] = []
  for (const n of added) {
    const named = links?.get(n.id)
    if (!named || named.size === 0) continue
    const candidates = removed.filter((r) => !used.has(r.id) && r.position === n.position && r.sets.some((s) => named.has(s.id)))
    if (candidates.length !== 1) continue
    used.add(candidates[0].id)
    swaps.push({ old: candidates[0], neu: n })
  }
  const swappedOld = new Set(swaps.map((s) => s.old.id))
  const swappedNew = new Set(swaps.map((s) => s.neu.id))
  return {
    swaps,
    removedOnly: removed.filter((r) => !swappedOld.has(r.id)),
    addedOnly: added.filter((a) => !swappedNew.has(a.id)),
  }
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
//   swapExercise       a row replaced by one the source week showed as a swap (the later
//                      week's row and its sets are re-pointed at the swapped-in row and
//                      its program sets, warmups with warmups and working sets with
//                      working sets)
//   <set-level>        removeHeadSet / removeStage / repTarget / warmup / stageKind for a
//                      set that changed or left; addSet / addWarmupSet / addStage for one
//                      that joined, each naming its new program set
//   reorderExercise    kept rows whose place changed
//   addExercise        a row that joined, with the program sets it brought
// In that order, so a week's ops are written removals first, additions last. Every part
// is its own record: a later week takes the ones whose old part it still holds
// (applyAhead.ts planApplyAheadGroups).
// `sourceLinks`: what the source week's rows named before the call (sourceLinksOf), the
// evidence a row replaced another. Without it nothing is a swap.
// `chain`: old program set → new program set of the sets that moved in the source week
// (chainOf). A swapped slot's sets are paired by it; where it reaches none of the slot's
// sets (it could not be read) they are paired by ordinal within kind instead.
export function diffDefault(
  workoutDayId: string,
  oldExercises: DefaultExercise[],
  newExercises: DefaultExercise[],
  sourceLinks?: SourceLinks,
  chain?: ReadonlyMap<string, string>,
): AheadGroup {
  const oldRows = [...oldExercises].sort(byPositionThenId)
  const newRows = [...newExercises].sort(byPositionThenId)
  const newById = new Map(newRows.map((e) => [e.id, e]))
  const oldIds = new Set(oldRows.map((e) => e.id))

  const kept = oldRows.filter((o) => newById.has(o.id)).map((o) => ({ old: o, neu: newById.get(o.id)! }))
  const removed = oldRows.filter((o) => !newById.has(o.id))
  const added = newRows.filter((n) => !oldIds.has(n.id))
  const { swaps, removedOnly, addedOnly } = pairSwaps(removed, added, sourceLinks)

  const removals: ChangeRecord[] = removedOnly.map((o) => ({ editType: 'removeExercise', slotId: o.id, exerciseId: o.exerciseId }))

  const swapRecords: ChangeRecord[] = []
  const setRecords: ChangeRecord[] = []
  // The chain is used for a swapped slot where it reaches the slot: at least one of the old
  // row's sets has a partner among the new row's. Otherwise it was not read (or the source
  // session's sets could not be re-read after the call) and the slot falls back to ordinal.
  const chainReaches = (old: DefaultExercise, neu: DefaultExercise) =>
    !!chain &&
    old.sets.some((o) => {
      const to = chain.get(o.id)
      return to !== undefined && neu.sets.some((n) => n.id === to)
    })
  // Set-level records of kept and of swapped slots, in the old default's order.
  const slots = [
    ...kept.map((k) => ({ old: k.old, neu: k.neu, pairing: 'id' as Pairing })),
    ...swaps.map((s) => ({ old: s.old, neu: s.neu, pairing: (chainReaches(s.old, s.neu) ? 'chain' : 'ordinal') as Pairing })),
  ].sort((a, b) => byPositionThenId(a.old, b.old))
  for (const slot of slots) {
    const { records, relink } = diffSets({ slotId: slot.old.id, exerciseId: slot.old.exerciseId }, slot.neu.id, slot.old.sets, slot.neu.sets, slot.pairing, chain)
    if (slot.pairing !== 'id') {
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
// `sourceLinks`: per planned session of the made week (by its id), what its rows named
// before the call (sourceLinksOf). The session each workout's default came from is the one
// the function names (`sourceWeekPlanId`); when it is not in the map, that workout's
// swaps cannot be told from a removal and an addition, and are not offered as swaps.
// `chains`: the same sessions' chains (chainsOf: old program set → new program set of the
// sets that moved, from what Plan held before the call and what the database holds after
// it). Without a session's chain its swapped slots are paired by ordinal within kind.
export function buildDefaultOffer(
  result: MakeDefaultResult,
  newDefaults: ReadonlyMap<string, DefaultExercise[]>,
  allWeekPlans: WeekPlan[],
  sourceLinks?: ReadonlyMap<string, SourceLinks>,
  chains?: ReadonlyMap<string, ReadonlyMap<string, string>>,
): DefaultOffer | null {
  const groups: AheadGroup[] = []
  const weeks: WeekPlan[] = []
  for (const workout of result.workouts) {
    const later = laterSessionsOf(allWeekPlans, workout.workoutDayId, result.weekNumber)
    if (later.length === 0) continue
    const next = newDefaults.get(workout.workoutDayId)
    if (!next) continue
    const group = diffDefault(workout.workoutDayId, workout.oldExercises, next, sourceLinks?.get(workout.sourceWeekPlanId), chains?.get(workout.sourceWeekPlanId))
    if (group.changes.length === 0) continue
    groups.push(group)
    weeks.push(...later)
  }
  if (groups.length === 0) return null
  return { groups, weeks, weekCount: new Set(weeks.map((w) => w.weekNumber)).size }
}
