import { format, parseISO } from 'date-fns'
import type { DayOfWeek, Exercise, Mesocycle, ProgramExercise, WeekPlan, WeekPlanSet, WeeklySchedule, WorkoutDay } from '../../types'
import { groupIntoUnits } from '../../lib/supersetGroups'
import { STAGE_KINDS, STAGE_KIND_LABELS, resolveStageKind } from '../../lib/plannerVocabulary'
import type { StageKind } from '../../lib/plannerVocabulary'
import { headsOnly } from '../gym/setGroupLogic'
import { WEEKDAYS } from './runSchedule'
import { finishedWeekCount } from './programsTabLogic'

// A finished program's week-by-week structure (chunk 66; TASKS-1.2 "A finished program"; SPEC Screens → PROGRAMS → Finished program (PR14),
// Defaults 11, Known gaps: "PR14's example lists a tempo change and a superset change; the history shows only what weeks store"; board PR14),
// pure: from the run's planned weeks to the tiles ("WK 1 … DL 7", a dot on a week whose structure changed), the list of what changed in the
// open week, and each workout's card with its exercises in order.
//
// What a week stores is what it compares (Defaults 11): which exercises, in what order, how many sets each (warmups counted apart, a staged
// set's stages never counted: RULES, stage-exclusion), and each set's kind. Tempo, rest and the warmup routine are stored once per program and
// are not here. A superset is run-wide too, so it never makes a change item; it is shown on the exercise's row (board PR14's "A1 · 3 SETS") from
// the run copy's blocks, which every week's exercise rows point at (TASKS 66: "A1/A2 for supersets as stored in `v2_week_plan_exercises` + the
// run copy's blocks").
//
// "The week before" is the nearest earlier week the run planned (a week nobody planned has no rows, so nothing to compare with: 131), and a
// workout is compared with the same workout there (the same slot, on a sequence run). An exercise is the same exercise in both weeks when it
// is the same catalogue exercise (its n-th occurrence in the workout, so two Bench Press rows pair up in order): a swap reads as the old one
// removed and the new one added.
//
// Every string is on the board except where a comment says "ours" (D31, provisional): the words of a state or a change the board doesn't draw.

// ─── What the module reads (Picks of the app's own types, so the caller's real data fits without a cast) ──────────────────

type SetLike = Pick<WeekPlanSet, 'id' | 'programExerciseId' | 'setNumber' | 'isWarmup' | 'stageKind' | 'parentWeekPlanSetId' | 'stageIndex'>
type ExerciseLike = Pick<ProgramExercise, 'id' | 'exerciseId' | 'position' | 'supersetBlockId'> & { exercise?: Pick<Exercise, 'name'> }
export type HistoryPlan = Pick<WeekPlan, 'workoutDayId' | 'weekNumber' | 'isDeload' | 'sequencePosition'> & {
  sets: readonly SetLike[]
  exercises: readonly ExerciseLike[]
}
export type HistoryWorkoutDay = Pick<WorkoutDay, 'id' | 'name' | 'position'>

export interface HistoryInput {
  plans: readonly HistoryPlan[]
  workoutDays: readonly HistoryWorkoutDay[]
  /** A weekday run's weeks, or a sequence run's cycles. */
  unit: 'week' | 'cycle'
  /**
   * A weekday run: the weekdays in force in a week (`runSchedule.ts`' `scheduleForWeek`: a run whose days were changed shows each week's
   * own). A sequence run has no weekdays; its cards say which slot they are.
   */
  scheduleFor?: (week: number) => Partial<WeeklySchedule>
}

// ─── What it gives ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HistoryChange {
  sign: '+' | '~' | '−'
  text: string
  /** The workout or workouts it happened in: "PULL 1", "PUSH 1 · PUSH 2". */
  where: string
}

export interface HistoryRow {
  key: string
  /** "01", or "—" for an exercise the week before had and this week doesn't. */
  number: string
  name: string
  meta: string
  state: 'same' | 'changed' | 'removed'
}

export interface HistoryWorkout {
  key: string
  /** "TUESDAY", "MON · THU" or, on a sequence run, "SLOT 2"; null when the workout has no weekday in that week. */
  dayLabel: string | null
  name: string
  /** "3 CHANGES", "1 CHANGE", "NO CHANGES". */
  tag: string
  changeCount: number
  rows: HistoryRow[]
}

export interface HistoryWeek {
  week: number
  /** The tile's top line: WK, CY (a sequence run's cycle) or DL. */
  top: 'WK' | 'CY' | 'DL'
  deload: boolean
  /** The tile's dot: this week's structure differs from the week before. */
  changed: boolean
  /** "WEEK 4", "WEEK 7 · DELOAD", "CYCLE 4". */
  label: string
  /** "Started from the program", "Changed from week 3" or "Same as week 3". */
  title: string
  changes: HistoryChange[]
  /** "WEEK 4 · STRUCTURE". */
  structureLabel: string
  workouts: HistoryWorkout[]
}

export interface ProgramHistory {
  weeks: HistoryWeek[]
  /** How many of the weeks are deload weeks (every planned session of the week marked): the header's "1 deload". */
  deloads: number
}

// ─── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MINUS = '−'

const DAY_FULL: Record<DayOfWeek, string> = {
  monday: 'MONDAY',
  tuesday: 'TUESDAY',
  wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY',
  friday: 'FRIDAY',
  saturday: 'SATURDAY',
  sunday: 'SUNDAY',
}
const DAY_SHORT: Record<DayOfWeek, string> = { monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU', friday: 'FRI', saturday: 'SAT', sunday: 'SUN' }

/** One day is named in full ("TUESDAY"), several are the short names in week order ("MON · THU · FRI"), as board PR14 draws them. */
export function daysLabel(days: readonly DayOfWeek[]): string | null {
  if (days.length === 0) return null
  if (days.length === 1) return DAY_FULL[days[0]]
  return days.map((day) => DAY_SHORT[day]).join(' · ')
}

type HeadKind = 'normal' | StageKind

// "Lat Pulldown set 3 is now a dropset" (board PR14). The other kinds follow the same shape (ours: the board draws only the dropset).
const KIND_PHRASE: Record<HeadKind, string> = {
  normal: 'a normal set',
  dropset: 'a dropset',
  rest_pause: 'a rest-pause set',
  myo_reps: 'a myo-reps set',
  cluster: 'a cluster set',
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** "3 SETS · 1 DROPSET", "1 WARMUP · 2 SETS", "A1 · 3 SETS" (board PR14): the superset's place first, then the warmups, the sets, and how many of the sets are of each staged kind. */
export function exerciseMeta(shape: { superset: string | null; warmups: number; kinds: readonly HeadKind[] }): string {
  const parts: string[] = []
  if (shape.superset) parts.push(shape.superset)
  if (shape.warmups > 0) parts.push(`${shape.warmups} ${plural(shape.warmups, 'WARMUP', 'WARMUPS')}`)
  // ours: an exercise a week-dependent run added with no sets yet
  parts.push(shape.kinds.length === 0 ? 'NO SETS' : `${shape.kinds.length} ${plural(shape.kinds.length, 'SET', 'SETS')}`)
  for (const kind of STAGE_KINDS) {
    const n = shape.kinds.filter((k) => k === kind).length
    if (n === 0) continue
    // MYO-REPS is already a plural word
    const label = kind === 'myo_reps' || n === 1 ? STAGE_KIND_LABELS[kind] : `${STAGE_KIND_LABELS[kind]}S`
    parts.push(`${n} ${label}`)
  }
  return parts.join(' · ')
}

const changesTag = (n: number) => (n === 0 ? 'NO CHANGES' : `${n} ${plural(n, 'CHANGE', 'CHANGES')}`)

// ─── One planned session's structure ──────────────────────────────────────────────────────────────────────────────────────

interface ExerciseStructure {
  /** The catalogue exercise and which occurrence of it this is in the workout: the pairing key between two weeks. */
  key: string
  name: string
  /** "A1": the superset it is in (letters in the order the workout's supersets come) and its place in it; null when it is in none. */
  superset: string | null
  warmups: number
  /** The working sets' kinds, in order. A staged set's stages are not sets of their own. */
  kinds: HeadKind[]
}

function headKinds(sets: readonly SetLike[]): { warmups: number; kinds: HeadKind[] } {
  const heads = headsOnly([...sets], (set) => set.parentWeekPlanSetId).sort((a, b) => a.setNumber - b.setNumber)
  const hasStages = new Set(sets.filter((set) => set.parentWeekPlanSetId != null).map((set) => set.parentWeekPlanSetId))
  let warmups = 0
  const kinds: HeadKind[] = []
  for (const head of heads) {
    if (head.isWarmup) {
      warmups += 1
    } else if (head.stageKind != null || hasStages.has(head.id)) {
      // a head with stages and no stored kind reads as a dropset (TASKS Data models, "legacy head")
      kinds.push(resolveStageKind(head.stageKind ?? null))
    } else {
      kinds.push('normal')
    }
  }
  return { warmups, kinds }
}

const supersetLetter = (index: number) => (index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`)

function structureOf(plan: HistoryPlan): ExerciseStructure[] {
  const ordered = [...plan.exercises].sort((a, b) => a.position - b.position)
  const place = new Map<string, string>()
  let block = 0
  for (const unit of groupIntoUnits(ordered)) {
    if (unit.length < 2) continue
    const letter = supersetLetter(block++)
    unit.forEach((member, i) => place.set(member.id, `${letter}${i + 1}`))
  }
  const seen = new Map<string, number>()
  return ordered.map((exercise) => {
    const occurrence = (seen.get(exercise.exerciseId) ?? 0) + 1
    seen.set(exercise.exerciseId, occurrence)
    const { warmups, kinds } = headKinds(plan.sets.filter((set) => set.programExerciseId === exercise.id))
    return {
      key: `${exercise.exerciseId}#${occurrence}`,
      name: exercise.exercise?.name ?? 'Exercise',
      superset: place.get(exercise.id) ?? null,
      warmups,
      kinds,
    }
  })
}

// ─── What changed between two weeks of one workout ────────────────────────────────────────────────────────────────────────

interface Change {
  sign: HistoryChange['sign']
  text: string
  /** The exercise the change is about, in the open week (not for a removal). */
  key: string | null
}

/**
 * The longest run of exercises both orders keep, so what moved is what isn't in it. When two runs are equally long the one that keeps the
 * old order's earlier exercise wins, so [A, B] → [B, A] says B moved before A (and never that A moved to the end).
 */
function keptInOrder(before: readonly string[], after: readonly string[]): Set<string> {
  const n = before.length
  const m = after.length
  const length: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      length[i][j] = before[i] === after[j] ? length[i + 1][j + 1] + 1 : Math.max(length[i + 1][j], length[i][j + 1])
    }
  }
  const kept = new Set<string>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      kept.add(before[i])
      i++
      j++
    } else if (length[i + 1][j] > length[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return kept
}

// One workout's changes in the order board PR14 lists them: what was added, then what changed (an exercise's set count, its warmups, its set
// kinds, then what moved), then what was removed; each in the order of the exercises.
function changesBetween(before: readonly ExerciseStructure[], now: readonly ExerciseStructure[]): { changes: Change[]; removed: ExerciseStructure[] } {
  const added: Change[] = []
  const changed: Change[] = []
  const was = new Map(before.map((exercise) => [exercise.key, exercise]))
  const is = new Map(now.map((exercise) => [exercise.key, exercise]))

  for (const exercise of now) {
    const old = was.get(exercise.key)
    if (!old) {
      added.push({ sign: '+', text: `${exercise.name} added`, key: exercise.key })
      continue
    }
    if (old.kinds.length !== exercise.kinds.length) {
      changed.push({ sign: '~', text: `${exercise.name}: ${old.kinds.length} → ${exercise.kinds.length} ${plural(exercise.kinds.length, 'set', 'sets')}`, key: exercise.key })
    }
    if (old.warmups !== exercise.warmups) {
      // ours: the board draws no warmup change
      changed.push({ sign: '~', text: `${exercise.name}: ${old.warmups} → ${exercise.warmups} ${plural(exercise.warmups, 'warmup set', 'warmup sets')}`, key: exercise.key })
    }
    for (let i = 0; i < Math.min(old.kinds.length, exercise.kinds.length); i++) {
      if (old.kinds[i] !== exercise.kinds[i]) {
        changed.push({ sign: '~', text: `${exercise.name} set ${i + 1} is now ${KIND_PHRASE[exercise.kinds[i]]}`, key: exercise.key })
      }
    }
  }

  // Order: among the exercises both weeks have, whatever isn't in the longest run they keep in order has moved (board PR14: "Leg Extension moved
  // before Back Squat"). It is named with the exercise now right after it.
  const common = (list: readonly ExerciseStructure[], other: Map<string, ExerciseStructure>) => list.filter((exercise) => other.has(exercise.key)).map((exercise) => exercise.key)
  const kept = keptInOrder(common(before, is), common(now, was))
  now.forEach((exercise, index) => {
    if (!was.has(exercise.key) || kept.has(exercise.key)) return
    const next = now[index + 1]
    changed.push({ sign: '~', text: next ? `${exercise.name} moved before ${next.name}` : `${exercise.name} moved to the end`, key: exercise.key })
  })

  const removed = before.filter((exercise) => !is.has(exercise.key))
  return { changes: [...added, ...changed, ...removed.map((exercise): Change => ({ sign: MINUS, text: `${exercise.name} removed`, key: null }))], removed }
}

// ─── The history ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const slotKey = (plan: Pick<HistoryPlan, 'workoutDayId' | 'sequencePosition'>) => (plan.sequencePosition != null ? `slot-${plan.sequencePosition}` : `workout-${plan.workoutDayId}`)

export function buildProgramHistory(input: HistoryInput): ProgramHistory {
  const dayOf = new Map(input.workoutDays.map((day) => [day.id, day]))
  const weekNumbers = [...new Set(input.plans.map((plan) => plan.weekNumber))].sort((a, b) => a - b)
  const plansOf = new Map<number, Map<string, HistoryPlan>>()
  for (const plan of input.plans) {
    const week = plansOf.get(plan.weekNumber) ?? new Map<string, HistoryPlan>()
    if (!week.has(slotKey(plan))) week.set(slotKey(plan), plan)
    plansOf.set(plan.weekNumber, week)
  }
  const unitWord = input.unit === 'cycle' ? 'cycle' : 'week'

  const weeks: HistoryWeek[] = weekNumbers.map((week, index) => {
    const before = index > 0 ? weekNumbers[index - 1] : null
    const plans = [...plansOf.get(week)!.values()].sort((a, b) => {
      const place = (plan: HistoryPlan) => plan.sequencePosition ?? dayOf.get(plan.workoutDayId)?.position ?? Number.MAX_SAFE_INTEGER
      return place(a) - place(b)
    })
    const schedule = input.unit === 'week' ? input.scheduleFor?.(week) : undefined

    const merged = new Map<string, { sign: HistoryChange['sign']; text: string; where: string[] }>()
    const workouts: HistoryWorkout[] = plans.map((plan) => {
      const name = dayOf.get(plan.workoutDayId)?.name ?? 'Workout'
      const now = structureOf(plan)
      const previousPlan = before === null ? undefined : plansOf.get(before)?.get(slotKey(plan))
      const { changes, removed } = previousPlan ? changesBetween(structureOf(previousPlan), now) : { changes: [] as Change[], removed: [] as ExerciseStructure[] }
      const hot = new Set(changes.map((change) => change.key))

      for (const change of changes) {
        const id = `${change.sign}\u0000${change.text}`
        const entry = merged.get(id) ?? { sign: change.sign, text: change.text, where: [] }
        if (!entry.where.includes(name.toUpperCase())) entry.where.push(name.toUpperCase())
        merged.set(id, entry)
      }

      const rows: HistoryRow[] = now.map((exercise, i) => ({
        key: exercise.key,
        number: String(i + 1).padStart(2, '0'),
        name: exercise.name,
        meta: exerciseMeta(exercise),
        state: hot.has(exercise.key) ? 'changed' : 'same',
      }))
      for (const exercise of removed) rows.push({ key: `removed-${exercise.key}`, number: '—', name: exercise.name, meta: 'REMOVED', state: 'removed' })

      const days =
        input.unit === 'cycle'
          ? `SLOT ${(plan.sequencePosition ?? 0) + 1}`
          : daysLabel(WEEKDAYS.filter((day) => schedule?.[day] === plan.workoutDayId))
      return { key: slotKey(plan), dayLabel: days, name, tag: changesTag(changes.length), changeCount: changes.length, rows }
    })

    const weekChanges: HistoryChange[] = [...merged.values()].map((entry) => ({ sign: entry.sign, text: entry.text, where: entry.where.join(' · ') }))
    const deload = plans.length > 0 && plans.every((plan) => plan.isDeload)
    return {
      week,
      top: deload ? 'DL' : input.unit === 'cycle' ? 'CY' : 'WK',
      deload,
      changed: workouts.some((workout) => workout.changeCount > 0),
      label: `${unitWord.toUpperCase()} ${week}${deload ? ' · DELOAD' : ''}`,
      title: before === null ? 'Started from the program' : `${weekChanges.length > 0 ? 'Changed from' : 'Same as'} ${unitWord} ${before}`,
      changes: weekChanges,
      structureLabel: `${unitWord.toUpperCase()} ${week} · STRUCTURE`,
      workouts,
    }
  })

  return { weeks, deloads: weeks.filter((week) => week.deload).length }
}

/**
 * The week the screen opens on (ours, D31): the first whose structure changed, which is the board's picture (it opens on a changed week), else
 * the first week; null when the run planned none.
 */
export function openingWeek(history: ProgramHistory): number | null {
  return (history.weeks.find((week) => week.changed) ?? history.weeks[0])?.week ?? null
}

// ─── The header and the delete confirm ────────────────────────────────────────────────────────────────────────────────────

/**
 * "Jul 5 → Sep 12, 2026 · 10 weeks · 1 deload" (board PR14; P1.2-4: the weeks are calendar weeks from the start date to the end date, as the
 * PROGRAMS tab's FINISHED row counts them). The year is said once when both dates are in it. Ours: the deload part is left out when there is
 * none (an unset feature shows nothing), and a run with no end date says only when it started.
 */
export function finishedHeaderLine(run: Pick<Mesocycle, 'startDate' | 'endDate'>, deloads: number): string {
  const start = parseISO(run.startDate)
  const parts: string[] = []
  if (run.endDate) {
    const end = parseISO(run.endDate)
    const startText = start.getFullYear() === end.getFullYear() ? format(start, 'MMM d') : format(start, 'MMM d, yyyy')
    const weeks = finishedWeekCount({ startDate: run.startDate, endDate: run.endDate })
    parts.push(`${startText} → ${format(end, 'MMM d, yyyy')}`, `${weeks} ${plural(weeks, 'week', 'weeks')}`)
  } else {
    parts.push(format(start, 'MMM d, yyyy'))
  }
  if (deloads > 0) parts.push(`${deloads} ${plural(deloads, 'deload', 'deloads')}`)
  return parts.join(' · ')
}

/** PR15's title. */
export const DELETE_FINISHED_TITLE = 'Delete this finished program?'

/** PR15's body: "Cut PPL, Jul 5 – Sep 12. Its weekly plan is deleted. Its sessions stay in History, and the saved program isn't touched. This can't be undone." */
export function deleteFinishedBody(run: Pick<Mesocycle, 'name' | 'startDate' | 'endDate'>): string {
  const start = format(parseISO(run.startDate), 'MMM d')
  const dates = run.endDate ? `${start} – ${format(parseISO(run.endDate), 'MMM d')}` : start
  return `${run.name}, ${dates}. Its weekly plan is deleted. Its sessions stay in History, and the saved program isn't touched. This can't be undone.`
}
