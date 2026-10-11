import type { ProgramExercise, ProgramSet, WeekPlan, WeekPlanSet } from '../../types'
import { groupWeekPlanSets } from '../gym/setGroupLogic'
import { columnsToRepTarget, formatRepTarget, resolveStageKind, type StageKind } from '../../lib/plannerVocabulary.js'
import { findLastUsableWeek, type PlannedWeekRecord, type PlanningType, type WeekStartSetting } from './weekSources'

// Chunk 31 (TASKS-1.1 "Differences from the week's source are highlighted"; SPEC
// Plan screen [P1.1]: "Anything different from the week's source is
// highlighted, in both views: numbers, sets, exercises, order and set kinds.").
//
// This module is PURE: given a week, the source(s) it is compared with and the
// matching rules, it returns what differs, per exercise, per set and per field.
// No Supabase, no React: PlanPage.tsx (through WeekDiffGate.tsx, which reads the
// one thing Plan doesn't already hold, the run copy's program sets) draws it.
// Nothing here is stored: a week is compared with its source AS IT IS NOW (G22).
//
// ─── Which source (chooseDiffSources) ──────────────────────────────────────────
// Two sources, because SPEC gives sets, structure and reps one place to come from
// and weights and RIR another:
//   - SHAPE (sets, structure, reps):
//       week 1 (either planning type) ......... the run's copy, as it is now
//       stable, after week 1 ................... the run's copy ("the default", G25)
//       week-dependent, after week 1 ........... last week
//     "Last week" is the last planned NORMAL, NON-EMPTY occurrence of the same
//     workout (or, on a sequence run, of the same slot): weekSources.ts's
//     findLastUsableWeek, the very search the week was planned with.
//   - NUMBERS (weights, RIR):
//       week 1 ................................. none (G34: week 1's aren't highlighted)
//       every other week ....................... last week, for both planning types (G24)
// so a stable week's reps are compared with the default and its weights with last
// week, and a week-dependent week's reps, weights and RIR all with last week.
// Reps always follow the SHAPE source: "a stable week's against the default, a
// week-dependent week's against last week, and week 1's against the run's copy".
//
// Nothing is compared (no source at all) for: a deload session (SPEC's default:
// it differs by design and is already marked); a week-dependent week after week 1
// while Settings → NEW WEEK STARTS is "empty" (provisional 84, DECISIONS: nothing
// records how a week started, so a week that started empty is a week planned
// under that setting); and a week with no last week to compare with.
//
// ─── What is compared, and what never is ───────────────────────────────────────
// Compared: an exercise (by exercise identity), its place in the order, its sets
// by position, each set's kind, and a set's weight, reps and RIR.
// Never compared: tags (never copied, so they differ by design), rest, tempo,
// superset grouping, the warmup routine (run-wide: a week and its source read the
// same values), and an exercise's weight unit (also run-wide, and a display
// preference — weights are compared as stored, in kg, so a unit never makes a
// weight differ). None of these is in the types below, so none can be compared.
//
// ─── Matching ──────────────────────────────────────────────────────────────────
// - Exercises: by exercise identity (G23, G36), not by the row that holds them. A
//   swap therefore has no counterpart on either side: the swapped-in exercise is
//   ADDED and the one it replaced is REMOVED. The same exercise twice in one
//   workout is paired in order of position, first with first (provisional 83).
// - Sets: by position (G23), chunk 20's set position: the head ordinal (the heads
//   of an exercise in set-number order, warmups included, so adding a warmup above
//   the working sets shifts every position after it), then the stage index.
//   Positions beyond the shorter side are added (week) or removed (source).
// - Order (provisional 82): among the exercises both sides have, an exercise
//   "moved" unless it is in EVERY largest group that kept its order. One exercise
//   moved past two others is the only one; two neighbours that traded places are
//   both; two such pairs are all four.

// ─── The shapes the comparison reads ──────────────────────────────────────────

// What a set row carries that is compared (a program set has no weight or RIR:
// "week plan only", so those are null on the run's copy and never compared with it).
export interface DiffNumbers {
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetWeight: number | null // kg, as stored
  targetRir: number | null
}

export interface DiffStage extends DiffNumbers {
  id: string
  stageIndex: number
}

export interface DiffHead extends DiffNumbers {
  id: string
  isWarmup: boolean
  stageKind: StageKind | null
  stages: DiffStage[]
}

export interface DiffExercise {
  id: string // the row's own id: what the caller flags it by
  exerciseId: string // the exercise itself: what exercises are matched by
  name: string // for the line a removed exercise leaves
  heads: DiffHead[] // set-number order, warmups included
}

type NumbersFields = {
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  targetWeight?: number | null
  targetRir?: number | null
}

function numbersOf(s: NumbersFields): DiffNumbers {
  return {
    repMin: s.repMin ?? null,
    repMax: s.repMax ?? null,
    isAmrap: s.isAmrap ?? false,
    targetWeight: s.targetWeight ?? null,
    targetRir: s.targetRir ?? null,
  }
}

// A week's exercises (in the week's own order) with their sets, grouped and ranked
// exactly as Plan draws them (PlanPage's ExerciseSection: groupWeekPlanSets, heads
// in set-number order), so "set 2" here is the set that shows as 02.
export function weekToDiffExercises(exercises: ProgramExercise[], sets: WeekPlanSet[]): DiffExercise[] {
  return exercises.map((pe) => {
    const groups = groupWeekPlanSets(sets.filter((s) => s.programExerciseId === pe.id)).sort(
      (a, b) => a.head.setNumber - b.head.setNumber,
    )
    return {
      id: pe.id,
      exerciseId: pe.exerciseId,
      name: pe.exercise?.name ?? '',
      heads: groups.map(({ head, stages }) => ({
        id: head.id,
        isWarmup: head.isWarmup,
        stageKind: head.stageKind ?? null,
        ...numbersOf(head),
        stages: stages.map((stage) => ({ id: stage.id, stageIndex: stage.stageIndex, ...numbersOf(stage) })),
      })),
    }
  })
}

// The run's copy of a workout as it is now (G25): its exercises, as the caller
// reads them (a run's current list: not `week_only`, not `removed_at`, in program
// order) and their program sets, WITHOUT any set that has `removed_at` set (since
// 040, a set "Make this week the new default" dropped stays in the table so weeks
// planned earlier keep their link, but it is no longer part of the default). The
// fetch keeps returning those sets (the workout screen finds a planned set's rest
// through them), so it is filtered here, in the comparison.
export function runCopyToDiffExercises(exercises: ProgramExercise[], programSets: ProgramSet[]): DiffExercise[] {
  const live = programSets.filter((ps) => !ps.removedAt)
  return exercises.map((pe) => {
    const own = live.filter((ps) => ps.programExerciseId === pe.id)
    const heads = own.filter((ps) => ps.parentProgramSetId == null).sort((a, b) => a.position - b.position)
    return {
      id: pe.id,
      exerciseId: pe.exerciseId,
      name: pe.exercise?.name ?? '',
      heads: heads.map((head) => ({
        id: head.id,
        isWarmup: head.isWarmup,
        stageKind: head.stageKind,
        ...numbersOf({ repMin: head.repMin, repMax: head.repMax, isAmrap: head.isAmrap }),
        stages: own
          .filter((ps) => ps.parentProgramSetId === head.id)
          .sort((a, b) => a.stageIndex - b.stageIndex)
          .map((stage) => ({
            id: stage.id,
            stageIndex: stage.stageIndex,
            ...numbersOf({ repMin: stage.repMin, repMax: stage.repMax, isAmrap: stage.isAmrap }),
          })),
      })),
    }
  })
}

// ─── Which source ──────────────────────────────────────────────────────────────

export type ShapeSource = { kind: 'runCopy' } | { kind: 'week'; weekNumber: number } | { kind: 'none' }
export type NumbersSource = { kind: 'week'; weekNumber: number } | { kind: 'none' }

export interface DiffSourceChoice {
  shape: ShapeSource
  numbers: NumbersSource
}

const NO_SOURCE: DiffSourceChoice = { shape: { kind: 'none' }, numbers: { kind: 'none' } }

export function chooseDiffSources(input: {
  planningType: PlanningType
  weekNumber: number
  weekStart: WeekStartSetting
  isDeload: boolean
  // This workout's (this slot's) other planned weeks: the shape weekSources.ts's
  // search reads.
  priorWeeks: PlannedWeekRecord[]
}): DiffSourceChoice {
  const { planningType, weekNumber, weekStart, isDeload, priorWeeks } = input
  if (isDeload) return NO_SOURCE
  // Week 1 is compared with the run's copy as it is now, reps included (G37); its
  // weights and RIR aren't compared (G34).
  if (weekNumber === 1) return { shape: { kind: 'runCopy' }, numbers: { kind: 'none' } }

  const last = findLastUsableWeek(priorWeeks, weekNumber)
  const numbers: NumbersSource = last === null ? { kind: 'none' } : { kind: 'week', weekNumber: last }
  // A stable week's sets, structure and reps are the default's (G24, G37); its
  // weights and RIR are last week's.
  if (planningType === 'stable') return { shape: { kind: 'runCopy' }, numbers }

  // A week-dependent week: everything is last week's, unless the week started
  // empty (provisional 84) or there is no last week.
  if (weekStart === 'empty' || last === null) return NO_SOURCE
  return { shape: { kind: 'week', weekNumber: last }, numbers }
}

// Whether the choice reads the run's copy (its exercises and program sets).
export function needsRunCopy(choice: DiffSourceChoice): boolean {
  return choice.shape.kind === 'runCopy'
}

// One slot's planned weeks: the same workout, and on a sequence run the same slot
// (a repeated workout's two slots are two histories — "a slot's source is the same
// slot's last normal occurrence"). A weekday row's sequence position is null.
export function weeksOfSlot(all: WeekPlan[], workoutDayId: string, sequencePosition: number | null): WeekPlan[] {
  return all.filter((wp) => wp.workoutDayId === workoutDayId && (wp.sequencePosition ?? null) === sequencePosition)
}

export function plannedWeekRecords(weeks: WeekPlan[]): PlannedWeekRecord[] {
  return weeks.map((wp) => ({ weekNumber: wp.weekNumber, isDeload: wp.isDeload, isEmpty: wp.sets.length === 0 }))
}

// ─── What differs ──────────────────────────────────────────────────────────────

// What differs about one set row (a head or a stage) of the week.
export interface SetDiff {
  // No counterpart in the shape source: the set (a stage) is new. A set under a new
  // set is new too.
  added: boolean
  weight: boolean
  reps: boolean
  rir: boolean
  // A head whose kind differs from its counterpart's: warmup, working, or staged
  // (with the stage kind).
  kind: boolean
}

// A row the source has and the week doesn't: what it held, for the dim line that
// stands in its place.
export interface RemovedSet {
  ordinal: number // its position: a head's head ordinal; a stage's head's
  stageIndex: number | null // null for a head
  isWarmup: boolean // heads
  numbers: DiffNumbers
}

export interface ExerciseDiff {
  // The exercise has no counterpart in the shape source: added (nothing inside it is
  // compared).
  added: boolean
  // It is in the source but not in the same place in the order.
  moved: boolean
  // By the week's set id, heads and stages.
  sets: Map<string, SetDiff>
  // Trailing heads the source has and the week hasn't (sets match by position, so
  // what's missing is always at the end), in position order.
  removedHeads: RemovedSet[]
  // Stages the source's head has and the week's counterpart doesn't, by the week
  // head's id, in stage order.
  removedStages: Map<string, RemovedSet[]>
}

// An exercise the source has and the week doesn't: where its dim line goes.
export interface RemovedExercise {
  exerciseId: string
  name: string
  // The week's exercise (its row id) the line comes right after: the nearest
  // exercise before it in the source that the week still has. null: at the top.
  after: string | null
}

export interface WeekDiff {
  // By the week's exercise row id: one entry per exercise of the week.
  exercises: Map<string, ExerciseDiff>
  // In the source's order.
  removedExercises: RemovedExercise[]
}

function newSetDiff(): SetDiff {
  return { added: false, weight: false, reps: false, rir: false, kind: false }
}

function setDiffOf(ex: ExerciseDiff, id: string): SetDiff {
  let d = ex.sets.get(id)
  if (!d) {
    d = newSetDiff()
    ex.sets.set(id, d)
  }
  return d
}

// Rep targets are compared as the row shows them (8 to 8 is "8"), so a highlight is
// always a difference the user can see.
function repsKey(n: DiffNumbers): string {
  return formatRepTarget(columnsToRepTarget({ repMin: n.repMin, repMax: n.repMax, isAmrap: n.isAmrap }))
}

// A head's kind as its row shows it: WARMUP, a staged set's kind (a null kind on a
// head that has stages reads as a dropset), or nothing. A stage kind on a head
// without stages shows nowhere, so it isn't a difference.
function kindKey(head: DiffHead): string {
  if (head.isWarmup) return 'warmup'
  if (head.stages.length > 0) return `staged:${resolveStageKind(head.stageKind)}`
  return 'working'
}

// Exercises by exercise identity; the nth occurrence with the nth (provisional 83).
function pairExercises(week: DiffExercise[], source: DiffExercise[]): { sourceOf: number[]; unmatched: number[] } {
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

// Which of a sequence (the source index of each exercise both sides have, in the
// week's order) moved: all but those in EVERY longest increasing run (provisional
// 82). An entry is in some longest run when the longest run ending at it and the
// longest starting at it add up to the overall length; it is in every one when it
// is the only such entry at its place in the run.
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

function emptyExerciseDiff(): ExerciseDiff {
  return { added: false, moved: false, sets: new Map(), removedHeads: [], removedStages: new Map() }
}

// Sets, structure and reps of one exercise both sides have.
function compareShape(week: DiffExercise, source: DiffExercise, out: ExerciseDiff): void {
  const count = Math.max(week.heads.length, source.heads.length)
  for (let p = 0; p < count; p++) {
    const w = week.heads[p]
    const s = source.heads[p]
    if (w && s) {
      const d = setDiffOf(out, w.id)
      d.reps = repsKey(w) !== repsKey(s)
      d.kind = kindKey(w) !== kindKey(s)
      for (const stage of w.stages) {
        const counterpart = s.stages.find((x) => x.stageIndex === stage.stageIndex)
        const sd = setDiffOf(out, stage.id)
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
      setDiffOf(out, w.id).added = true
      for (const stage of w.stages) setDiffOf(out, stage.id).added = true
    } else if (s) {
      out.removedHeads.push({ ordinal: p + 1, stageIndex: null, isWarmup: s.isWarmup, numbers: numbersOf(s) })
    }
  }
}

// Weights and RIR of one exercise both sides have: set by set where the other side
// has the set; a set it doesn't have is not compared (it is added or removed, and
// that is the shape's to say).
function compareNumbers(week: DiffExercise, source: DiffExercise, out: ExerciseDiff): void {
  const count = Math.min(week.heads.length, source.heads.length)
  for (let p = 0; p < count; p++) {
    const w = week.heads[p]
    const s = source.heads[p]
    const d = setDiffOf(out, w.id)
    d.weight = w.targetWeight !== s.targetWeight
    d.rir = w.targetRir !== s.targetRir
    for (const stage of w.stages) {
      const counterpart = s.stages.find((x) => x.stageIndex === stage.stageIndex)
      if (!counterpart) continue
      const sd = setDiffOf(out, stage.id)
      sd.weight = stage.targetWeight !== counterpart.targetWeight
      sd.rir = stage.targetRir !== counterpart.targetRir
    }
  }
}

export function diffWeek(
  week: DiffExercise[],
  sources: { shape: DiffExercise[] | null; numbers: DiffExercise[] | null },
): WeekDiff {
  const exercises = new Map<string, ExerciseDiff>(week.map((w) => [w.id, emptyExerciseDiff()]))
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

    // A removed exercise's line goes right after the nearest exercise before it in
    // the source that the week still has (a swap: the old one directly above the new
    // one), or at the top.
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

// ─── The whole decision ────────────────────────────────────────────────────────

export interface WeekDiffInput {
  planningType: PlanningType
  weekStart: WeekStartSetting
  weekNumber: number
  // The viewed week's session: its exercises in this week's order, and its sets.
  week: { isDeload: boolean; exercises: ProgramExercise[]; sets: WeekPlanSet[] }
  // The planned weeks of this workout's slot (weeksOfSlot); the viewed week may be
  // among them.
  slotWeeks: WeekPlan[]
  // The run's copy of this workout as it is now; null while it hasn't been read.
  runCopy: { exercises: ProgramExercise[]; programSets: ProgramSet[] } | null
}

// What differs, or null when nothing is compared: a deload session, a week with no
// source, and (while the run's copy isn't read yet) a week that needs it.
export function computeWeekDiff(input: WeekDiffInput): WeekDiff | null {
  const { planningType, weekStart, weekNumber, week, slotWeeks, runCopy } = input
  const choice = chooseDiffSources({
    planningType,
    weekNumber,
    weekStart,
    isDeload: week.isDeload,
    priorWeeks: plannedWeekRecords(slotWeeks),
  })

  // The search only ever returns a week before the viewed one, so the viewed week
  // itself (it is in slotWeeks too) is never its own source.
  const weekOf = (n: number): DiffExercise[] | null => {
    const found = slotWeeks.find((wp) => wp.weekNumber === n)
    return found ? weekToDiffExercises(found.exercises, found.sets) : null
  }

  let shape: DiffExercise[] | null = null
  if (choice.shape.kind === 'runCopy') {
    if (!runCopy) return null
    shape = runCopyToDiffExercises(runCopy.exercises, runCopy.programSets)
  } else if (choice.shape.kind === 'week') {
    shape = weekOf(choice.shape.weekNumber)
  }
  const numbers = choice.numbers.kind === 'week' ? weekOf(choice.numbers.weekNumber) : null
  if (!shape && !numbers) return null

  return diffWeek(weekToDiffExercises(week.exercises, week.sets), { shape, numbers })
}
