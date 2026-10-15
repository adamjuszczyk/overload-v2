// Chunk 42 (TASKS-1.2 "Week planning and copy rules as pure functions"; SPEC.md [1.2] "Weeks and
// copying", "Targets", Defaults 7 and 8, Scheduling → Sequence ("the cycle replaces the week
// everywhere"), G48, G49).
//
// ONE module for everything Plan decides about weeks:
//   1. which weeks exist, and what each tile says ................... weekTiles
//   2. what a planned week takes from its source (the TypeScript twin of migration 044, so the
//      two can be compared by an executed fixture: scripts/plan-week-parity.mjs) ... autoCopy
//   3. how COPY matches last week's numbers, and what "overwrite" means ......... copyNumbers
//   4. when an exercise is "THIS WEEK ONLY" ................................ thisWeekOnly
//   5. the 1.2 "changes since the source" rules, on stable weeks too (G48) . changesSinceSource
//   6. what "+ ADD SET" adds (Defaults 8) ................................ addSetDefaults
//
// Pure: no Supabase, no React, no clock. Every function takes what it reads, in the app's own
// types (or a Pick of them, so a test builds only the fields a rule reads). Nothing calls it yet:
// chunk 52 uses weekTiles and copyNumbers, 53 compares autoCopy with migration 044, 54a uses
// addSetDefaults and 54b thisWeekOnly and changesSinceSource. weekDiff.ts is NOT touched: it keeps
// drawing Plan's marks until 54b replaces it with changesSinceSource, so the two coexist until then
// (this module imports nothing from it, so 54b deletes it without moving anything).
//
// A week is a "week" on a weekday run and a "cycle" on a sequence run (SPEC: the cycle replaces the
// week everywhere); nothing here tells them apart except through the slot identity, which the
// callers pass: a weekday run's workout, a sequence run's slot (workout + sequence_position).

import type { ProgramExercise, ProgramSet, WeekPlan, WeekPlanSet, PlanningType } from '../../types'
import {
  columnsToRepTarget,
  formatRepTarget,
  repTargetToColumns,
  resolveStageKind,
  type StageKind,
} from '../../lib/plannerVocabulary.js'
import { findLastUsableWeek, type PlannedWeekRecord } from './weekSources'

// ═══ 1. Which weeks exist, and what each tile says ═══════════════════════════════════════════
//
// SPEC, Plan screen → Week row: "a tile per week (cycle) from week 1 to the first unplanned one ...
// Past weeks say DONE; the current week THIS WEEK; a week planned ahead PLANNED; the first
// unplanned week NOT PLANNED (lock)." And, Weeks and copying → How far ahead: "Nothing beyond the
// first unplanned week is reachable. (Adam: 'you can't go to week 4, but after you click plan
// forward on week 3, you can go to week 4.')"

export type WeekTileState = 'done' | 'this' | 'planned' | 'not_planned'

export interface WeekTile {
  week: number
  state: WeekTileState
}

// The first week that has no planned session: the smallest week from 1 on that isn't in the list.
// (With weeks planned one at a time it is the last planned week + 1; with a gap it is the gap.)
export function firstUnplannedWeek(plannedWeeks: Iterable<number>): number {
  const planned = new Set(plannedWeeks)
  let week = 1
  while (planned.has(week)) week++
  return week
}

// `plannedWeeks`: the week numbers (cycle numbers) that have at least one planned session, in any
// order. `currentWeek`: the calendar week (the current cycle) the run is in. The tiles run from 1
// up to and including the first unplanned week, and no further, even when a later week is planned.
//   - a planned week before the current one ... 'done'   (a past week: board 1c)
//   - the current week, planned ................ 'this'
//   - a planned week after the current one ..... 'planned'
//   - an unplanned week (only ever the last tile) 'not_planned'; an unplanned current week reads so
//     too, for the moment before Plan plans it (chunk 52).
// A gap (a week nobody planned, say a calendar week the app wasn't opened in) ends the tiles at the
// gap: every planned week after it, the current one included, is out of reach until the gap is
// planned forward, as SPEC says ("Nothing beyond the first unplanned week is reachable"). What Plan
// shows when the current week is not among the tiles is chunk 52's to decide.
export function weekTiles(input: { plannedWeeks: Iterable<number>; currentWeek: number }): WeekTile[] {
  const planned = new Set(input.plannedWeeks)
  const last = firstUnplannedWeek(planned)
  const tiles: WeekTile[] = []
  for (let week = 1; week <= last; week++) {
    let state: WeekTileState
    if (!planned.has(week)) state = 'not_planned'
    else if (week < input.currentWeek) state = 'done'
    else if (week === input.currentWeek) state = 'this'
    else state = 'planned'
    tiles.push({ week, state })
  }
  return tiles
}

// ═══ 2. What a planned week takes from its source ════════════════════════════════════════════
//
// SPEC, Weeks and copying → What the auto-copy takes (2b): "structure (exercises, order, set kinds,
// stages), volume (set counts) and set types, from the source. A stable week also takes the
// default's rep targets. Weight, reps (week-dependent) and RIR are never auto-copied: they come
// with COPY. Tags and the deload flag are never copied." Source, stable: "the run's default (the
// run copy), always"; week-dependent: "the last planned normal occurrence; the existing rules for
// skipping deload and empty occurrences stay"; "Week 1 of any run starts from the program."
//
// This is the exact rule migration 044 (chunk 53) implements; autoCopy is its twin and the
// harness scripts/plan-week-parity.mjs runs both on one fixture. The one reading to know:
//   - rep targets travel with the SOURCE, not with the planning type. The program's rep targets
//     are copied wherever the source is the program (week 1 of any run; every stable week) and
//     never from a week, so a week-dependent week after week 1 gets none ("does not fall back to
//     the run copy's (week 1's) target") while week 1 of a week-dependent run keeps the program's.
//     That is what 041's 'program' branch does today and 044's stays ("unchanged for structure and
//     rep targets", TASKS 53).

export type AutoCopySource =
  | { kind: 'program' } // the run copy: the program's own exercises and sets, read as they are now
  | { kind: 'week'; weekNumber: number } // that slot's last planned normal, non-empty occurrence
  | { kind: 'empty' } // week-dependent, after week 1, and nothing usable to copy: an empty week

// Which source a week is planned from. `priorWeeks` are the planned occurrences of this ONE slot
// (the same workout; on a sequence run the same slot): weekSources.ts's search, kept. There is no
// "week start" setting any more (1.2 removes it), so an empty source only ever means "nothing
// usable to copy".
export function chooseAutoCopySource(input: {
  planningType: PlanningType
  weekNumber: number
  priorWeeks: PlannedWeekRecord[]
}): AutoCopySource {
  const { planningType, weekNumber, priorWeeks } = input
  // 041 raises for a week below 1; a pure function that decides a source has no answer either.
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    throw new RangeError(`chooseAutoCopySource: week number must be an integer >= 1 (got ${weekNumber})`)
  }
  if (weekNumber === 1 || planningType === 'stable') return { kind: 'program' }
  const last = findLastUsableWeek(priorWeeks, weekNumber)
  return last === null ? { kind: 'empty' } : { kind: 'week', weekNumber: last }
}

// A planned occurrence's weeks as weekSources.ts's search reads them: "empty" is "no set rows"
// (DECISIONS 42; the exercise list doesn't count).
export function plannedWeekRecords(
  weeks: ReadonlyArray<{ weekNumber: number; isDeload: boolean; sets: readonly unknown[] }>,
): PlannedWeekRecord[] {
  return weeks.map((wp) => ({ weekNumber: wp.weekNumber, isDeload: wp.isDeload, isEmpty: wp.sets.length === 0 }))
}

// One slot's planned weeks: the same workout, and on a sequence run the same slot (a repeated
// workout's two slots are two histories — "a slot's source is the same slot's last normal
// occurrence"). A weekday row's sequence position is null.
export function weeksOfSlot<T extends Pick<WeekPlan, 'workoutDayId' | 'sequencePosition'>>(
  all: readonly T[],
  workoutDayId: string,
  sequencePosition: number | null,
): T[] {
  return all.filter((wp) => wp.workoutDayId === workoutDayId && (wp.sequencePosition ?? null) === sequencePosition)
}

// The run copy of one workout as autoCopy and the comparison with "the default" read it: its
// exercises (a week-only slot or a removed exercise is not part of it) and its program sets (one
// with `removed_at` set, which migration 040 soft-removes from the default, is not either). Rows
// may carry the two exercise flags; the app's ProgramExercise type doesn't, so they're optional.
export interface RunCopyExercise extends Pick<ProgramExercise, 'id' | 'exerciseId' | 'position'> {
  exercise?: { name: string }
  weekOnly?: boolean
  removedAt?: string | null
}
export type RunCopySet = Pick<
  ProgramSet,
  | 'id'
  | 'programExerciseId'
  | 'position'
  | 'isWarmup'
  | 'stageKind'
  | 'parentProgramSetId'
  | 'stageIndex'
  | 'repMin'
  | 'repMax'
  | 'isAmrap'
  | 'removedAt'
>
export interface RunCopy {
  exercises: readonly RunCopyExercise[]
  sets: readonly RunCopySet[]
}

function liveRunCopy(runCopy: RunCopy): { exercises: RunCopyExercise[]; sets: RunCopySet[] } {
  // Array.prototype.sort is stable: rows with equal positions keep the order they came in.
  const exercises = runCopy.exercises.filter((e) => !e.weekOnly && !e.removedAt).sort((a, b) => a.position - b.position)
  const ids = new Set(exercises.map((e) => e.id))
  const sets = runCopy.sets.filter((ps) => ids.has(ps.programExerciseId) && !ps.removedAt)
  return { exercises, sets }
}

// A planned week's rows, as a copy reads them: its exercise list (this week's own order) and sets.
export interface PlannedWeekRows {
  weekNumber: number
  isDeload: boolean
  exercises: ReadonlyArray<Pick<ProgramExercise, 'id' | 'position'>>
  sets: ReadonlyArray<
    Pick<
      WeekPlanSet,
      | 'id'
      | 'programExerciseId'
      | 'setNumber'
      | 'isDropset'
      | 'parentWeekPlanSetId'
      | 'stageIndex'
      | 'isWarmup'
      | 'stageKind'
      | 'programSetId'
    >
  >
}

export interface AutoCopiedExercise {
  programExerciseId: string
  position: number
}

// A set row a new week gets. `sourceId` is the row it is copied from (a program set's id from the
// program, a week set's id from a week) and `parentSourceId` its head's, so a caller can give the
// new rows their own ids and keep the stages attached. The number columns are `null` by type: no
// weight, no RIR (either end), no tags, ever (a copy never carries them).
export interface AutoCopiedSet {
  sourceId: string
  parentSourceId: string | null
  programExerciseId: string
  setNumber: number
  isDropset: boolean
  isWarmup: boolean
  stageKind: StageKind | null
  stageIndex: number
  programSetId: string | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetWeight: null
  targetRir: null
  targetRirMax: null
  tags: null
}

export interface AutoCopyResult {
  source: AutoCopySource
  exercises: AutoCopiedExercise[]
  sets: AutoCopiedSet[]
}

// What a new week of one slot gets: the source, then its exercises and sets with no numbers.
//   - `runCopy`: the slot's workout in the run copy (a stable week and week 1 read it);
//   - `priorWeeks`: the slot's earlier planned weeks with their rows (a week-dependent week reads
//     the last usable one).
export function autoCopy(input: {
  planningType: PlanningType
  weekNumber: number
  runCopy: RunCopy
  priorWeeks: readonly PlannedWeekRows[]
}): AutoCopyResult {
  const source = chooseAutoCopySource({
    planningType: input.planningType,
    weekNumber: input.weekNumber,
    priorWeeks: plannedWeekRecords(input.priorWeeks),
  })
  if (source.kind === 'empty') return { source, exercises: [], sets: [] }
  if (source.kind === 'program') return { source, ...copyFromRunCopy(input.runCopy) }
  const from = input.priorWeeks.find((w) => w.weekNumber === source.weekNumber)
  if (!from) throw new Error(`autoCopy: week ${source.weekNumber} was chosen as the source but isn't among priorWeeks`)
  return { source, ...copyFromWeek(from) }
}

// Heads before stages, then by the position (set number) and stage index: 041's own `order by`.
function copyOrder<T>(
  rows: readonly T[],
  isStage: (r: T) => boolean,
  position: (r: T) => number,
  stageIndex: (r: T) => number,
): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(isStage(a)) - Number(isStage(b)) || position(a) - position(b) || stageIndex(a) - stageIndex(b),
  )
}

// 041's 'program' branch (044 keeps it for structure and rep targets): the run copy's current
// exercises in program order and its live program sets, each set's rep target as the program has
// it, `set_number` := the program set's position, `is_dropset` := it is a stage row.
function copyFromRunCopy(runCopy: RunCopy): { exercises: AutoCopiedExercise[]; sets: AutoCopiedSet[] } {
  const live = liveRunCopy(runCopy)
  const taken = new Set(live.sets.map((ps) => ps.id))
  const sets = copyOrder(
    live.sets,
    (ps) => ps.parentProgramSetId != null,
    (ps) => ps.position,
    (ps) => ps.stageIndex,
  ).map(
    (ps): AutoCopiedSet => ({
      sourceId: ps.id,
      // A stage whose head isn't in the copy loses its link (the SQL's map has no entry for it).
      parentSourceId: ps.parentProgramSetId != null && taken.has(ps.parentProgramSetId) ? ps.parentProgramSetId : null,
      programExerciseId: ps.programExerciseId,
      setNumber: ps.position,
      isDropset: ps.parentProgramSetId != null,
      isWarmup: ps.isWarmup,
      stageKind: ps.stageKind,
      stageIndex: ps.stageIndex,
      programSetId: ps.id,
      repMin: ps.repMin,
      repMax: ps.repMax,
      isAmrap: ps.isAmrap,
      targetWeight: null,
      targetRir: null,
      targetRirMax: null,
      tags: null,
    }),
  )
  return { exercises: live.exercises.map((e) => ({ programExerciseId: e.id, position: e.position })), sets }
}

// 041's 'week' branch with 044's change: every structure column rides along from the source week
// (kind, stages, counts, `program_set_id`, `is_dropset`, `set_number`) and every number is dropped:
// no weight, no RIR (either end), no rep target (`rep_min` / `rep_max` null, `is_amrap` false), no
// tags. The source week's own exercise list and order are kept as they are.
function copyFromWeek(week: PlannedWeekRows): { exercises: AutoCopiedExercise[]; sets: AutoCopiedSet[] } {
  const seen = new Set<string>()
  const exercises: AutoCopiedExercise[] = []
  for (const e of [...week.exercises].sort((a, b) => a.position - b.position)) {
    if (seen.has(e.id)) continue // 041: `on conflict (week_plan_id, program_exercise_id) do nothing`
    seen.add(e.id)
    exercises.push({ programExerciseId: e.id, position: e.position })
  }
  const taken = new Set(week.sets.map((s) => s.id))
  const sets = copyOrder(
    week.sets,
    (s) => s.parentWeekPlanSetId != null,
    (s) => s.setNumber,
    (s) => s.stageIndex,
  ).map(
    (s): AutoCopiedSet => ({
      sourceId: s.id,
      parentSourceId: s.parentWeekPlanSetId != null && taken.has(s.parentWeekPlanSetId) ? s.parentWeekPlanSetId : null,
      programExerciseId: s.programExerciseId,
      setNumber: s.setNumber,
      isDropset: s.isDropset,
      isWarmup: s.isWarmup,
      stageKind: s.stageKind ?? null,
      stageIndex: s.stageIndex,
      programSetId: s.programSetId ?? null,
      repMin: null,
      repMax: null,
      isAmrap: false,
      targetWeight: null,
      targetRir: null,
      targetRirMax: null,
      tags: null,
    }),
  )
  return { exercises, sets }
}

// ═══ 3. COPY: last week's numbers into this week ═════════════════════════════════════════════
//
// SPEC, Weeks and copying → COPY (2c): "fields: Weight, Reps, RIR (any combination); on a stable
// week Weight and RIR only, since the default owns its rep targets (G53); which of this week's
// workouts (done ones are locked and can't be picked); 'Overwrite what's already there': off fills
// empty boxes only; on replaces typed numbers too; copies from last week's plan, matched the way
// stable weights were matched: exercise, then position, warmups to warmups and working sets to
// working sets. An RIR range copies as a range." Defaults 7: "COPY starts with every field and
// every not-done workout ticked, overwrite off" (the sheet's; nothing here has a default).
//
// What it decides, beyond SPEC's words (each is a test):
//   - a box last week left empty is never copied: nothing replaces a typed number with nothing
//     (overwrite replaces typed numbers with last week's numbers, where last week has one);
//   - the three number groups are written as a unit: reps = (repMin, repMax, isAmrap), RIR =
//     (targetRir, targetRirMax), so a number can't leave a stale range end or a stray AMRAP flag;
//   - an update that would change nothing isn't returned;
//   - RIR is never written to a warmup (G49), whatever the fields; a warmup pairs only with a
//     warmup, so it never takes a working set's weight either;
//   - exercises are matched by exercise identity (the exercise itself, not the row that holds it
//     this week), the same exercise twice in one workout first with first (provisional 83); a
//     workout is matched by its slot (workout, and on a sequence run its sequence position);
//   - stages follow their head: a stage takes its numbers from the matched head's stage with the
//     same stage index.
// The caller decides which week is "last week" and which workouts are in `workouts` (done ones are
// never in it).

export type CopyField = 'weight' | 'reps' | 'rir'

export type CopySet = Pick<
  WeekPlanSet,
  | 'id'
  | 'programExerciseId'
  | 'setNumber'
  | 'parentWeekPlanSetId'
  | 'stageIndex'
  | 'isWarmup'
  | 'targetWeight'
  | 'targetRir'
  | 'targetRirMax'
  | 'repMin'
  | 'repMax'
  | 'isAmrap'
>

// One workout's plan in a week: the row's id, its slot, its exercises (this week's own list) and sets.
export interface CopyWorkout extends Pick<WeekPlan, 'id' | 'workoutDayId'> {
  sequencePosition?: number | null
  exercises: ReadonlyArray<Pick<ProgramExercise, 'id' | 'exerciseId' | 'position'>>
  sets: readonly CopySet[]
}

// What a copy writes into one set. Only the groups the chosen fields name are present.
export interface SetNumbersChanges {
  targetWeight?: number
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  targetRir?: number
  targetRirMax?: number | null
}

export interface SetNumbersUpdate {
  weekPlanId: string // the this-week workout the set belongs to
  setId: string
  changes: SetNumbersChanges
}

type NumbersLike = Pick<
  CopySet,
  'targetWeight' | 'targetRir' | 'targetRirMax' | 'repMin' | 'repMax' | 'isAmrap'
>

function repTargetOf(s: Pick<NumbersLike, 'repMin' | 'repMax' | 'isAmrap'>) {
  return columnsToRepTarget({ repMin: s.repMin ?? null, repMax: s.repMax ?? null, isAmrap: s.isAmrap ?? false })
}

function sameSlot(a: Pick<CopyWorkout, 'workoutDayId' | 'sequencePosition'>, b: typeof a): boolean {
  return a.workoutDayId === b.workoutDayId && (a.sequencePosition ?? null) === (b.sequencePosition ?? null)
}

// The nth occurrence of an exercise this week with the nth of it last week (provisional 83); an
// exercise last week doesn't have is left alone. Rows in position order on both sides.
type ExerciseSlot = Pick<ProgramExercise, 'id' | 'exerciseId' | 'position'>

function pairByExercise(
  thisWeek: readonly ExerciseSlot[],
  lastWeek: readonly ExerciseSlot[],
): Array<[ExerciseSlot, ExerciseSlot]> {
  const queues = new Map<string, ExerciseSlot[]>()
  for (const l of [...lastWeek].sort((a, b) => a.position - b.position)) {
    const q = queues.get(l.exerciseId)
    if (q) q.push(l)
    else queues.set(l.exerciseId, [l])
  }
  const pairs: Array<[ExerciseSlot, ExerciseSlot]> = []
  for (const t of [...thisWeek].sort((a, b) => a.position - b.position)) {
    const counterpart = queues.get(t.exerciseId)?.shift()
    if (counterpart) pairs.push([t, counterpart])
  }
  return pairs
}

// This week's set rows of one exercise row paired with last week's: heads by (is_warmup, ordinal
// among those), 039's rule, then each head's stages by stage index.
function pairSets(thisSets: readonly CopySet[], lastSets: readonly CopySet[]): Array<[CopySet, CopySet]> {
  const heads = (sets: readonly CopySet[], warmup: boolean) =>
    sets
      .filter((s) => s.parentWeekPlanSetId == null && s.isWarmup === warmup)
      .sort((a, b) => a.setNumber - b.setNumber)
  const stagesOf = (sets: readonly CopySet[], head: CopySet) => sets.filter((s) => s.parentWeekPlanSetId === head.id)
  const pairs: Array<[CopySet, CopySet]> = []
  for (const warmup of [true, false]) {
    const mine = heads(thisSets, warmup)
    const theirs = heads(lastSets, warmup)
    mine.forEach((t, i) => {
      const l = theirs[i]
      if (!l) return
      pairs.push([t, l])
      const lastStages = stagesOf(lastSets, l)
      for (const stage of stagesOf(thisSets, t)) {
        const counterpart = lastStages.find((x) => x.stageIndex === stage.stageIndex)
        if (counterpart) pairs.push([stage, counterpart])
      }
    })
  }
  return pairs
}

function copiedNumbers(t: CopySet, l: CopySet, fields: ReadonlySet<CopyField>, overwrite: boolean): SetNumbersChanges {
  const changes: SetNumbersChanges = {}

  if (fields.has('weight') && l.targetWeight != null && (overwrite || t.targetWeight == null)) {
    if (l.targetWeight !== t.targetWeight) changes.targetWeight = l.targetWeight
  }

  if (fields.has('reps')) {
    const from = repTargetOf(l)
    const to = repTargetOf(t)
    // "Empty" is no rep target at all; an AMRAP is a target.
    if (from.type !== 'none' && (overwrite || to.type === 'none') && formatRepTarget(from) !== formatRepTarget(to)) {
      Object.assign(changes, repTargetToColumns(from))
    }
  }

  // G49: a warmup row has no RIR target, so none is ever written to one.
  if (fields.has('rir') && !t.isWarmup && l.targetRir != null && (overwrite || t.targetRir == null)) {
    const lastMax = l.targetRirMax ?? null
    if (l.targetRir !== t.targetRir || lastMax !== (t.targetRirMax ?? null)) {
      changes.targetRir = l.targetRir
      changes.targetRirMax = lastMax
    }
  }

  return changes
}

export function copyNumbers(input: {
  fields: Iterable<CopyField>
  workouts: Iterable<string> // the ids of this week's workouts (week plan rows) to copy into
  overwrite: boolean
  lastWeek: readonly CopyWorkout[]
  thisWeek: readonly CopyWorkout[]
}): SetNumbersUpdate[] {
  const fields = new Set(input.fields)
  const chosen = new Set(input.workouts)
  const updates: SetNumbersUpdate[] = []

  for (const workout of input.thisWeek) {
    if (!chosen.has(workout.id)) continue
    const last = input.lastWeek.find((w) => sameSlot(w, workout))
    if (!last) continue

    for (const [mine, theirs] of pairByExercise(workout.exercises, last.exercises)) {
      const thisSets = workout.sets.filter((s) => s.programExerciseId === mine.id)
      const lastSets = last.sets.filter((s) => s.programExerciseId === theirs.id)
      for (const [t, l] of pairSets(thisSets, lastSets)) {
        const changes = copiedNumbers(t, l, fields, input.overwrite)
        if (Object.keys(changes).length > 0) updates.push({ weekPlanId: workout.id, setId: t.id, changes })
      }
    }
  }
  return updates
}

// ═══ 4. "THIS WEEK ONLY" ═════════════════════════════════════════════════════════════════════
//
// SPEC, Weeks and copying → Stable weeks: "Once a set in the week differs from the default in set
// count, kind, stages or rep target, its exercise shows 'THIS WEEK ONLY' ... Weight, RIR and cues
// never count: the default holds none."

// A set row as the comparisons read it: a head and its stages, the numbers a row carries.
export interface ChangeNumbers {
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetWeight: number | null // kg, as stored
  targetRir: number | null
  targetRirMax: number | null // the range's high end
}

export interface ChangeStage extends ChangeNumbers {
  id: string
  stageIndex: number
}

export interface ChangeHead extends ChangeNumbers {
  id: string
  isWarmup: boolean
  stageKind: StageKind | null
  stages: ChangeStage[]
}

type NumbersFields = {
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  targetWeight?: number | null
  targetRir?: number | null
  targetRirMax?: number | null
}

function numbersOf(s: NumbersFields): ChangeNumbers {
  return {
    repMin: s.repMin ?? null,
    repMax: s.repMax ?? null,
    isAmrap: s.isAmrap ?? false,
    targetWeight: s.targetWeight ?? null,
    targetRir: s.targetRir ?? null,
    targetRirMax: s.targetRirMax ?? null,
  }
}

type WeekSetRow = Pick<
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

// One exercise's week sets as heads (set-number order, warmups included) with their stages (stage
// order): grouped and ranked the way Plan draws them, so "set 2" here is the set that shows as 02.
function weekHeads(sets: readonly WeekSetRow[]): ChangeHead[] {
  const stagesByParent = new Map<string, WeekSetRow[]>()
  const heads: WeekSetRow[] = []
  for (const s of sets) {
    if (s.parentWeekPlanSetId == null) heads.push(s)
    else {
      const list = stagesByParent.get(s.parentWeekPlanSetId)
      if (list) list.push(s)
      else stagesByParent.set(s.parentWeekPlanSetId, [s])
    }
  }
  return heads
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((head) => ({
      id: head.id,
      isWarmup: head.isWarmup,
      stageKind: head.stageKind ?? null,
      ...numbersOf(head),
      stages: (stagesByParent.get(head.id) ?? [])
        .sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0))
        .map((stage) => ({ id: stage.id, stageIndex: stage.stageIndex ?? 0, ...numbersOf(stage) })),
    }))
}

// One exercise's program sets (the default's) as heads in position order with their stages. A set
// the default dropped (`removedAt`) isn't in the default. A program set holds no weight or RIR.
function programHeads(sets: readonly RunCopySet[]): ChangeHead[] {
  const live = sets.filter((ps) => !ps.removedAt)
  return live
    .filter((ps) => ps.parentProgramSetId == null)
    .sort((a, b) => a.position - b.position)
    .map((head) => ({
      id: head.id,
      isWarmup: head.isWarmup,
      stageKind: head.stageKind,
      ...numbersOf({ repMin: head.repMin, repMax: head.repMax, isAmrap: head.isAmrap }),
      stages: live
        .filter((ps) => ps.parentProgramSetId === head.id)
        .sort((a, b) => a.stageIndex - b.stageIndex)
        .map((stage) => ({
          id: stage.id,
          stageIndex: stage.stageIndex,
          ...numbersOf({ repMin: stage.repMin, repMax: stage.repMax, isAmrap: stage.isAmrap }),
        })),
    }))
}

// Rep targets are compared as the row shows them (8 to 8 is "8"), so a mark is always a
// difference the user can see.
function repsKey(n: Pick<ChangeNumbers, 'repMin' | 'repMax' | 'isAmrap'>): string {
  return formatRepTarget(columnsToRepTarget({ repMin: n.repMin, repMax: n.repMax, isAmrap: n.isAmrap }))
}

// A head's kind as its row shows it: WARMUP, a staged set's kind (a null kind on a head that has
// stages reads as a dropset), or nothing. A stage kind on a head without stages shows nowhere, so
// it isn't a difference.
function kindKey(head: ChangeHead): string {
  if (head.isWarmup) return 'warmup'
  if (head.stages.length > 0) return `staged:${resolveStageKind(head.stageKind)}`
  return 'working'
}

// What a head is as the default can hold it: kind, rep target, and each stage's index and rep target.
function shapeKey(head: ChangeHead): string {
  return [kindKey(head), repsKey(head), ...head.stages.map((st) => `${st.stageIndex}:${repsKey(st)}`)].join('|')
}

// True when this week's sets of ONE exercise differ from the default's for that exercise in set
// count, kind, stages or rep target (heads and stages alike, matched by position: the head ordinal
// in set-number order, warmups included, then the stage index). Weight, RIR and cues never count.
export function thisWeekOnly(
  exerciseSets: readonly WeekSetRow[],
  defaultSets: readonly RunCopySet[],
): boolean {
  const week = weekHeads(exerciseSets)
  const base = programHeads(defaultSets)
  if (week.length !== base.length) return true
  return week.some((head, i) => shapeKey(head) !== shapeKey(base[i]))
}

// ═══ 5. Changes since the source ═════════════════════════════════════════════════════════════
//
// SPEC, Weeks and copying → Changes since the source: "anything in a week that differs from its
// source is highlighted, with the legend 'CHANGED SINCE WEEK N' (boards 1, 1d, 9), on stable weeks
// too; 'THIS WEEK ONLY' is only the per-exercise line (G48).
//   - Week-dependent: compared with last week's plan. Stable: set counts, kinds, stages and rep
//     targets compared with the default; weight and RIR compared with last week's plan. Week 1 is
//     compared with nothing.
//   - Exercises are matched by identity, so a swap shows the old exercise struck through above the
//     new one; sets by position. Something removed shows as a dim struck-through line in its
//     place. Moved items are highlighted.
//   - Cues are never highlighted. Deload sessions show no highlighting ('DELOAD SESSION · NO
//     CHANGE MARKS', board 9).
//   - These marks are about the plan only."
//
// This is weekDiff.ts's comparison (chunk 31: provisional 82 for what counts as moved, 83 for the
// same exercise twice) with 1.2's sources. What 1.2 changes, each pinned by a test:
//   - week 1 is compared with nothing (1.1 compared its reps with the run's copy, G37);
//   - there is no "week start" setting: a week-dependent week with no usable last week has nothing
//     to compare with, as before;
//   - a RIR range is compared on both ends;
//   - a warmup row has no RIR target (G49): its RIR is never a mark.
// Unchanged from 1.1 and worth knowing: a box that differs from the source is a change whether or
// not it is empty, so a week planned forward before COPY (no weight, RIR or reps of its own) marks
// every number its source has. SPEC says "anything that differs"; D31 provisional, see the report.

export type ChangeShapeSource = { kind: 'default' } | { kind: 'week'; weekNumber: number } | { kind: 'none' }
export type ChangeNumbersSource = { kind: 'week'; weekNumber: number } | { kind: 'none' }

export interface ChangeSourceChoice {
  shape: ChangeShapeSource // sets, structure and reps
  numbers: ChangeNumbersSource // weight and RIR
}

const NO_SOURCE: ChangeSourceChoice = { shape: { kind: 'none' }, numbers: { kind: 'none' } }

// Which sources a week is compared with. Two, because SPEC gives sets, structure and reps one place
// to come from and weights and RIR another. Reps always follow the shape source, an added set's
// reps included.
//   - a deload session, and week 1 ........... nothing
//   - stable, after week 1 ................... the default for shape; last week for numbers
//   - week-dependent, after week 1 ........... last week for both; nothing with no last week
// "Last week" is the last planned NORMAL, NON-EMPTY occurrence of this slot: weekSources.ts's
// findLastUsableWeek, the very search the week was planned with.
export function chooseChangeSources(input: {
  planningType: PlanningType
  weekNumber: number
  isDeload: boolean
  priorWeeks: PlannedWeekRecord[]
}): ChangeSourceChoice {
  const { planningType, weekNumber, isDeload, priorWeeks } = input
  if (isDeload || weekNumber === 1) return NO_SOURCE
  const last = findLastUsableWeek(priorWeeks, weekNumber)
  const numbers: ChangeNumbersSource = last === null ? { kind: 'none' } : { kind: 'week', weekNumber: last }
  if (planningType === 'stable') return { shape: { kind: 'default' }, numbers }
  if (last === null) return NO_SOURCE
  return { shape: { kind: 'week', weekNumber: last }, numbers }
}

// Whether the choice reads the run copy, so a caller reads it only then.
export function needsRunCopy(choice: ChangeSourceChoice): boolean {
  return choice.shape.kind === 'default'
}

export interface ChangeExercise {
  id: string // the row's own id: what the caller flags it by
  exerciseId: string // the exercise itself: what exercises are matched by
  name: string // for the line a removed exercise leaves
  heads: ChangeHead[] // set-number order, warmups included
}

type ExerciseRow = Pick<ProgramExercise, 'id' | 'exerciseId' | 'position'> & { exercise?: { name: string } }

function weekExercises(exercises: readonly ExerciseRow[], sets: readonly WeekSetRow[]): ChangeExercise[] {
  return [...exercises]
    .sort((a, b) => a.position - b.position)
    .map((pe) => ({
      id: pe.id,
      exerciseId: pe.exerciseId,
      name: pe.exercise?.name ?? '',
      heads: weekHeads(sets.filter((s) => s.programExerciseId === pe.id)),
    }))
}

function defaultExercises(runCopy: RunCopy): ChangeExercise[] {
  const live = liveRunCopy(runCopy)
  return live.exercises.map((pe) => ({
    id: pe.id,
    exerciseId: pe.exerciseId,
    name: pe.exercise?.name ?? '',
    heads: programHeads(live.sets.filter((ps) => ps.programExerciseId === pe.id)),
  }))
}

// What differs about one set row (a head or a stage) of the week.
export interface SetChange {
  // No counterpart in the shape source: the set (a stage) is new. A set under a new set is new too.
  // This says nothing about weight and RIR: those follow the numbers source alone (a new set's can
  // equal last week's).
  added: boolean
  weight: boolean
  reps: boolean
  rir: boolean
  // A head whose kind differs from its counterpart's: warmup, working, or staged (with the stage kind).
  kind: boolean
}

// A row the source has and the week doesn't: what it held, for the dim line that stands in its place.
export interface RemovedSet {
  ordinal: number // its position: a head's head ordinal; a stage's head's
  stageIndex: number | null // null for a head
  isWarmup: boolean // heads
  numbers: ChangeNumbers
}

export interface ExerciseChanges {
  // The exercise has no counterpart in the shape source: added (nothing inside it is compared).
  added: boolean
  // It is in the source but not in the same place in the order.
  moved: boolean
  // By the week's set id, heads and stages.
  sets: Map<string, SetChange>
  // Trailing heads the source has and the week hasn't (sets match by position, so what's missing is
  // always at the end), in position order.
  removedHeads: RemovedSet[]
  // Stages the source's head has and the week's counterpart doesn't, by the week head's id, in stage order.
  removedStages: Map<string, RemovedSet[]>
}

// An exercise the source has and the week doesn't: where its dim line goes.
export interface RemovedExercise {
  exerciseId: string
  name: string
  // The week's exercise (its row id) the line comes right after: the nearest exercise before it in
  // the source that the week still has. null: at the top.
  after: string | null
}

export interface WeekChanges {
  // The week the legend names ("CHANGED SINCE WEEK N"): the numbers source's, else the shape
  // source's; null when the only source is the default (a stable week with no usable last week).
  sourceWeek: number | null
  // By the week's exercise row id: one entry per exercise of the week.
  exercises: Map<string, ExerciseChanges>
  // In the source's order.
  removedExercises: RemovedExercise[]
}

function newSetChange(): SetChange {
  return { added: false, weight: false, reps: false, rir: false, kind: false }
}

function setChangeOf(ex: ExerciseChanges, id: string): SetChange {
  let d = ex.sets.get(id)
  if (!d) {
    d = newSetChange()
    ex.sets.set(id, d)
  }
  return d
}

// A RIR target is one value or a range: the two ends are compared.
function rirDiffers(a: ChangeNumbers, b: ChangeNumbers): boolean {
  return a.targetRir !== b.targetRir || a.targetRirMax !== b.targetRirMax
}

// Exercises by exercise identity; the nth occurrence with the nth (provisional 83).
function pairExercises(week: ChangeExercise[], source: ChangeExercise[]): { sourceOf: number[]; unmatched: number[] } {
  const queues = new Map<string, number[]>()
  source.forEach((s, i) => {
    const q = queues.get(s.exerciseId)
    if (q) q.push(i)
    else queues.set(s.exerciseId, [i])
  })
  const taken = new Set<number>()
  const sourceOf = week.map((w) => {
    const j = queues.get(w.exerciseId)?.shift()
    if (j === undefined) return -1
    taken.add(j)
    return j
  })
  return { sourceOf, unmatched: source.map((_, i) => i).filter((i) => !taken.has(i)) }
}

// Which of a sequence (the source index of each exercise both sides have, in the week's order)
// moved: all but those in EVERY longest increasing run (provisional 82). An entry is in some longest
// run when the longest run ending at it and the longest starting at it add up to the overall
// length; it is in every one when it is the only such entry at its place in the run. One exercise
// moved past two others is the only one; two neighbours that traded places are both; two such
// pairs are all four.
export function movedEntries(order: number[]): boolean[] {
  const n = order.length
  const endsAt = new Array<number>(n).fill(1)
  const startsAt = new Array<number>(n).fill(1)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) if (order[j] < order[i]) endsAt[i] = Math.max(endsAt[i], endsAt[j] + 1)
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = n - 1; j > i; j--) if (order[j] > order[i]) startsAt[i] = Math.max(startsAt[i], startsAt[j] + 1)
  }
  const longest = Math.max(0, ...endsAt)
  const inSome = (i: number) => endsAt[i] + startsAt[i] - 1 === longest
  const perPlace = new Map<number, number>()
  for (let i = 0; i < n; i++) if (inSome(i)) perPlace.set(endsAt[i], (perPlace.get(endsAt[i]) ?? 0) + 1)
  return order.map((_, i) => !(inSome(i) && perPlace.get(endsAt[i]) === 1))
}

function emptyExerciseChanges(): ExerciseChanges {
  return { added: false, moved: false, sets: new Map(), removedHeads: [], removedStages: new Map() }
}

// Sets, structure and reps of one exercise both sides have.
function compareShape(week: ChangeExercise, source: ChangeExercise, out: ExerciseChanges): void {
  const count = Math.max(week.heads.length, source.heads.length)
  for (let p = 0; p < count; p++) {
    const w = week.heads[p]
    const s = source.heads[p]
    if (w && s) {
      const d = setChangeOf(out, w.id)
      d.reps = repsKey(w) !== repsKey(s)
      d.kind = kindKey(w) !== kindKey(s)
      for (const stage of w.stages) {
        const counterpart = s.stages.find((x) => x.stageIndex === stage.stageIndex)
        const sd = setChangeOf(out, stage.id)
        if (counterpart) sd.reps = repsKey(stage) !== repsKey(counterpart)
        else sd.added = true
      }
      const gone = s.stages.filter((x) => !w.stages.some((st) => st.stageIndex === x.stageIndex))
      if (gone.length > 0) {
        out.removedStages.set(
          w.id,
          gone.map((x) => ({ ordinal: p + 1, stageIndex: x.stageIndex, isWarmup: false, numbers: numbersOf(x) })),
        )
      }
    } else if (w) {
      setChangeOf(out, w.id).added = true
      for (const stage of w.stages) setChangeOf(out, stage.id).added = true
    } else if (s) {
      out.removedHeads.push({ ordinal: p + 1, stageIndex: null, isWarmup: s.isWarmup, numbers: numbersOf(s) })
    }
  }
}

// Weights and RIR of one exercise both sources have, set by set against the set at the same
// position of the NUMBERS source — whatever the shape source says about that set: a set the default
// lacks is not thereby a different weight (it is the shape's to say it is new), and one the default
// has but last week lacks is compared with last week.
//   - a counterpart: the number differs, or it doesn't (a RIR range on both ends);
//   - a working set with no counterpart at its position (last week has no such set) is new against
//     last week, so its weight and RIR differ from it; so do its stages';
//   - a warmup or a stage with no counterpart is a new set kind, which the structure marks (a
//     warmup's or a stage's own newness is not the numbers'), so its numbers are left alone;
//   - a warmup row has no RIR target (G49), so its RIR is never a difference.
function compareNumbers(week: ChangeExercise, source: ChangeExercise, out: ExerciseChanges): void {
  week.heads.forEach((w, p) => {
    const s = source.heads[p]
    const d = setChangeOf(out, w.id)
    const newAgainstSource = !s && !w.isWarmup
    if (s) {
      d.weight = w.targetWeight !== s.targetWeight
      d.rir = !w.isWarmup && rirDiffers(w, s)
    } else if (newAgainstSource) {
      d.weight = true
      d.rir = true
    }
    for (const stage of w.stages) {
      const counterpart = s?.stages.find((x) => x.stageIndex === stage.stageIndex)
      if (counterpart) {
        const sd = setChangeOf(out, stage.id)
        sd.weight = stage.targetWeight !== counterpart.targetWeight
        sd.rir = rirDiffers(stage, counterpart)
      } else if (newAgainstSource) {
        const sd = setChangeOf(out, stage.id)
        sd.weight = true
        sd.rir = true
      }
    }
  })
}

// The comparison itself, on the two sources already read: `shape` for sets, structure and reps,
// `numbers` for weight and RIR (either may be null: nothing to compare with).
function compareWeek(
  week: ChangeExercise[],
  sources: { shape: ChangeExercise[] | null; numbers: ChangeExercise[] | null },
): { exercises: Map<string, ExerciseChanges>; removedExercises: RemovedExercise[] } {
  const exercises = new Map<string, ExerciseChanges>(week.map((w) => [w.id, emptyExerciseChanges()]))
  const removedExercises: RemovedExercise[] = []

  if (sources.shape) {
    const { sourceOf, unmatched } = pairExercises(week, sources.shape)

    // Order: only among the exercises both sides have.
    const both = week.map((_, i) => i).filter((i) => sourceOf[i] >= 0)
    const moved = movedEntries(both.map((i) => sourceOf[i]))
    both.forEach((i, k) => {
      exercises.get(week[i].id)!.moved = moved[k]
    })

    week.forEach((w, i) => {
      const out = exercises.get(w.id)!
      if (sourceOf[i] < 0) out.added = true
      else compareShape(w, sources.shape![sourceOf[i]], out)
    })

    // A removed exercise's line goes right after the nearest exercise before it in the source that
    // the week still has (a swap: the old one directly above the new one), or at the top.
    const weekIdOfSource = new Map<number, string>()
    week.forEach((w, i) => {
      if (sourceOf[i] >= 0) weekIdOfSource.set(sourceOf[i], w.id)
    })
    for (const j of unmatched) {
      let after: string | null = null
      for (let i = j - 1; i >= 0; i--) {
        const id = weekIdOfSource.get(i)
        if (id !== undefined) {
          after = id
          break
        }
      }
      removedExercises.push({ exerciseId: sources.shape[j].exerciseId, name: sources.shape[j].name, after })
    }
  }

  if (sources.numbers) {
    const { sourceOf } = pairExercises(week, sources.numbers)
    week.forEach((w, i) => {
      if (sourceOf[i] >= 0) compareNumbers(w, sources.numbers![sourceOf[i]], exercises.get(w.id)!)
    })
  }

  return { exercises, removedExercises }
}

export interface ChangesSinceSourceInput {
  planningType: PlanningType
  weekNumber: number
  // The viewed week's session: whether it is a deload session, its exercises (this week's own
  // order) and its sets.
  week: {
    isDeload: boolean
    exercises: readonly ExerciseRow[]
    sets: readonly WeekSetRow[]
  }
  // The planned weeks of this workout's slot (weeksOfSlot); the viewed week may be among them (the
  // search only ever returns a week before it).
  slotWeeks: ReadonlyArray<
    Pick<WeekPlan, 'weekNumber' | 'isDeload'> & { exercises: readonly ExerciseRow[]; sets: readonly WeekSetRow[] }
  >
  // The run's copy of this workout as it is now; null while it hasn't been read. Only a stable
  // week reads it (needsRunCopy).
  runCopy: RunCopy | null
}

// What differs in the viewed week from its source, or null when nothing is compared: a deload
// session, week 1, a week with no source, and (while the run copy isn't read yet) a stable week.
export function changesSinceSource(input: ChangesSinceSourceInput): WeekChanges | null {
  const { week, slotWeeks, runCopy } = input
  const choice = chooseChangeSources({
    planningType: input.planningType,
    weekNumber: input.weekNumber,
    isDeload: week.isDeload,
    priorWeeks: plannedWeekRecords(slotWeeks),
  })

  const weekOf = (n: number): ChangeExercise[] | null => {
    const found = slotWeeks.find((wp) => wp.weekNumber === n)
    return found ? weekExercises(found.exercises, found.sets) : null
  }

  let shape: ChangeExercise[] | null = null
  if (choice.shape.kind === 'default') {
    if (!runCopy) return null
    shape = defaultExercises(runCopy)
  } else if (choice.shape.kind === 'week') {
    shape = weekOf(choice.shape.weekNumber)
  }
  const numbers = choice.numbers.kind === 'week' ? weekOf(choice.numbers.weekNumber) : null
  if (!shape && !numbers) return null

  const compared = compareWeek(weekExercises(week.exercises, week.sets), { shape, numbers })
  const sourceWeek =
    choice.numbers.kind === 'week' ? choice.numbers.weekNumber : choice.shape.kind === 'week' ? choice.shape.weekNumber : null
  return { sourceWeek, ...compared }
}

// ═══ 6. "+ ADD SET" ══════════════════════════════════════════════════════════════════════════
//
// SPEC, Defaults 8 and Plan screen: "+ ADD SET in Plan adds a Normal set with the previous set's
// rep target and no weight or RIR." The caller passes the exercise's last head (a staged head's
// own rep target, not its last stage's); with no set to follow, the new set has no rep target.

export interface NewSetDefaults {
  isWarmup: false
  stageKind: null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetWeight: null
  targetRir: null
  targetRirMax: null
}

export function addSetDefaults(
  previousSet: Pick<WeekPlanSet, 'repMin' | 'repMax' | 'isAmrap'> | null | undefined,
): NewSetDefaults {
  const target = previousSet ? repTargetOf(previousSet) : ({ type: 'none' } as const)
  return {
    isWarmup: false,
    stageKind: null,
    ...repTargetToColumns(target),
    targetWeight: null,
    targetRir: null,
    targetRirMax: null,
  }
}
