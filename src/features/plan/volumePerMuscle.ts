// Chunk 44 (TASKS-1.2 "VOLUME as a pure function"; SPEC [1.2] "Volume per muscle"
// (14), Settings (14b), "Warmup sets" ("Never counted in volume"), "Volume
// [P1/P2]", G51) — everything board 3 (the VOLUME sheet) decides, as one tested
// function: every muscle as "last week → this week", the change, and the note
// where last week's actual differed from its plan. No I/O, no React: chunk 55's
// sheet fetches the plans, last week's sessions with their logs and changes, the
// exercises and the Settings rule, and calls `volumeRows`.
//
// ─── What a set counts as ──────────────────────────────────────────────────────
// - A warmup never counts (SPEC "Warmup sets"), planned or logged.
// - A normal working set counts 1; so does an AMRAP set (SPEC: "counts as a normal
//   working set everywhere").
// - A staged set (a dropset, rest-pause, myo-reps or cluster head with its stage
//   rows) counts 1 + its drops × the rule (SPEC 14, 14b: "the same rule for
//   dropsets, rest-pause, myo and cluster"): `whole` 0 (the whole set is 1),
//   `each` 1, `half` ½ (the default). Volume is the one place stages count
//   (CONTEXT, "Stage-exclusion"); they are found through `setGroupLogic.ts`'s
//   `groupByParent`, never ad hoc. An orphan dropset (a dropset row with no parent)
//   is an independent head and counts 1, as everywhere else.
// - A logged stage under a skipped head counts nothing (the head's group is out:
//   `progressService.ts`'s isStageOfSkippedHead rule, the same one every volume
//   reader keeps); a skipped stage under a done head counts nothing either.
//
// ─── Which sets are counted ────────────────────────────────────────────────────
// - THIS week: its plan. Only the plan, whatever the week's sessions have done.
// - LAST week (SPEC: "what was actually done"): a DONE session (status `completed`
//   or `skipped`, the two states Plan calls DONE and SKIPPED) counts its done sets:
//   its logs, added sets in (a log with no planned set behind it), skipped ones out,
//   and a planned set the session deleted (a `deleted` change, TASKS 44) out. A
//   session skipped as a whole has no done sets, so it counts 0. A session NOT done
//   yet (`planned`, `in_progress`, or none created for its plan) counts its plan,
//   whatever it has logged so far (SPEC: "sessions not done yet count their plan").
//   The module doesn't know today's date, so it can't tell a session still to come
//   from one missed in a week that is over: a workout that was never started and
//   never marked skipped has no session and counts its plan too. A caller that
//   wants a missed workout to count 0 passes it as a `skipped` session.
// - "What you planned" for the note is last week's plan, every row of it, whatever
//   its sessions did.
//
// ─── One workout on several weekdays (G14) ────────────────────────────────────
// One plan row can stand for several sessions in a week: a workout on Tuesday and
// Thursday shares one plan row, and gets one session per weekday (CONTEXT, "One
// workout on several weekdays exists"). `VolumePlan.occurrences` says how many
// (default 1; the caller reads it off the schedule in force that week; a row
// listed twice is two). This week's plan counts once per occurrence. Last week,
// every session linked to the plan row is one occurrence by itself; an occurrence
// with no session yet counts the plan; a row with more sessions than `occurrences`
// says is counted for the sessions it has.
//
// ─── Which row a set belongs to ───────────────────────────────────────────────
// A muscle GROUP (not a subgroup: SPEC's known gap with board 3's sample rows),
// taken from `exercises` alone — the exercise's `muscleGroup`, `other` when it has
// none (`toMuscleGroup`), when the group isn't one of the twelve, or when the
// exercise isn't in `exercises` at all (a set done is a set counted). A planned set
// finds its exercise through the plan's own exercise list (its program exercise
// row), a log through its `exerciseId`, so a swap done in a session counts for the
// exercise actually done. A planned set whose exercise isn't in its plan's list isn't
// part of the week Plan draws and isn't counted. A muscle gets a row when either
// week, or last week's plan, has volume in it (D31: a muscle with nothing to say
// shows nothing); rows run in `MUSCLE_GROUPS` order, `other` last.
//
// ─── What this module never does ──────────────────────────────────────────────
// It never reads Settings: the rule is a parameter (G51: "Drops and stages count
// as" applies to the VOLUME sheet only; History, Progress and the finish screen
// count as they do today). Nothing but the VOLUME sheet imports it (a test reads
// the source and fails on any other importer).

import type {
  MuscleGroup,
  ProgramExercise,
  SessionSetChange,
  SessionStatus,
  SetLog,
  StageVolumeRule,
  WeekPlanSet,
} from '../../types'
import { MUSCLE_GROUPS } from '../../lib/exerciseTags'
import { toMuscleGroup } from '../../lib/muscleGroup'
import { groupByParent } from '../gym/setGroupLogic'

// ─── The shapes it reads ───────────────────────────────────────────────────────
// Each is the fields read, picked from the app's own types: a real `WeekPlan`,
// `Session` (+ its changes) and `Exercise` are accepted as they are.

/** An exercise and its muscle group (`Exercise` fits; a missing group reads as `other`). */
export interface VolumeExercise {
  id: string
  muscleGroup: MuscleGroup | null | undefined
}

/** A week's plan for one workout: this week's own exercise list and its sets. */
export interface VolumePlan {
  id: string
  /** This week's exercise rows: how a planned set finds its exercise (`programExerciseId` → `exerciseId`). */
  exercises: Array<Pick<ProgramExercise, 'id' | 'exerciseId'>>
  sets: Array<Pick<WeekPlanSet, 'id' | 'programExerciseId' | 'parentWeekPlanSetId' | 'isWarmup'>>
  /**
   * How many sessions this plan row stands for in the week (default 1): a workout on two
   * weekdays that share one plan row (G14) is 2. See the header.
   */
  occurrences?: number
}

/** A session of last week with its logs and its set changes. */
export interface VolumeSession {
  /** The plan row it was planned from; null when it had none. */
  weekPlanId: string | null
  status: SessionStatus
  setLogs?: Array<Pick<SetLog, 'id' | 'exerciseId' | 'weekPlanSetId' | 'parentSetId' | 'isWarmup' | 'isSkipped'>>
  /** This session's own `v2_session_set_changes` (a `deleted` one takes its planned set out). */
  sessionSetChanges?: SessionSetChange[]
}

export interface VolumeRowsInput {
  lastWeek: { sessions: VolumeSession[]; plan: VolumePlan[] }
  /** This week's plan rows. */
  thisWeek: VolumePlan[]
  exercises: VolumeExercise[]
  /** Settings → "Drops and stages count as" (`stageVolumeRule`); the caller reads it, this module never does. */
  rule: StageVolumeRule
}

export interface VolumeRow {
  muscle: MuscleGroup
  /** What was done last week (sets, in halves). */
  last: number
  /** What this week's plan holds. */
  this: number
  /** `this` − `last`. */
  delta: number
  /** "YOU PLANNED 4 LAST WEEK · DID 10": only where `last` differs from last week's plan. */
  note?: string
}

// ─── Counting ──────────────────────────────────────────────────────────────────

// What each drop (stage row) adds to its head's 1 (SPEC 14b).
const DROP_COUNT: Record<StageVolumeRule, number> = { whole: 0, each: 1, half: 0.5 }

type Tally = Map<MuscleGroup, number>

function addTo(tally: Tally, muscle: MuscleGroup, sets: number): void {
  tally.set(muscle, (tally.get(muscle) ?? 0) + sets)
}

function addTally(into: Tally, from: Tally, times = 1): void {
  for (const [muscle, sets] of from) addTo(into, muscle, sets * times)
}

// A plan row's own sets: every working head once, plus its drops.
function planTally(plan: VolumePlan, drop: number, muscleOf: (exerciseId: string) => MuscleGroup): Tally {
  const exerciseOfRow = new Map(plan.exercises.map((e) => [e.id, e.exerciseId]))
  const tally: Tally = new Map()
  for (const { head, stages } of groupByParent(plan.sets, (s) => s.id, (s) => s.parentWeekPlanSetId, () => 0)) {
    if (head.isWarmup) continue
    const exerciseId = exerciseOfRow.get(head.programExerciseId)
    if (exerciseId === undefined) continue
    addTo(tally, muscleOf(exerciseId), 1 + stages.length * drop)
  }
  return tally
}

// A done session's own sets: the logs that were really done.
function doneTally(session: VolumeSession, drop: number, muscleOf: (exerciseId: string) => MuscleGroup): Tally {
  const deleted = new Set<string>()
  for (const change of session.sessionSetChanges ?? []) {
    if (change.kind === 'deleted') deleted.add(change.weekPlanSetId)
  }
  const tally: Tally = new Map()
  for (const { head, stages } of groupByParent(session.setLogs ?? [], (l) => l.id, (l) => l.parentSetId, () => 0)) {
    if (head.isWarmup || head.isSkipped) continue
    if (head.weekPlanSetId !== null && deleted.has(head.weekPlanSetId)) continue
    addTo(tally, muscleOf(head.exerciseId), 1 + stages.filter((s) => !s.isSkipped).length * drop)
  }
  return tally
}

// A session that is over: counted by what it did, not by its plan.
const isDone = (status: SessionStatus): boolean => status === 'completed' || status === 'skipped'

function groupOf(raw: string | null | undefined): MuscleGroup {
  const group = toMuscleGroup(raw)
  return MUSCLE_GROUPS.includes(group) ? group : 'other'
}

/**
 * Board 3's rows. One per muscle group with volume in either week (or last week's plan),
 * in `MUSCLE_GROUPS` order, `other` last.
 */
export function volumeRows({ lastWeek, thisWeek, exercises, rule }: VolumeRowsInput): VolumeRow[] {
  const drop = DROP_COUNT[rule]
  if (drop === undefined) throw new RangeError(`unknown stage volume rule: ${String(rule)}`)

  const muscleByExercise = new Map(exercises.map((e) => [e.id, groupOf(e.muscleGroup)]))
  const muscleOf = (exerciseId: string): MuscleGroup => muscleByExercise.get(exerciseId) ?? 'other'

  // This week: its plan, once per occurrence.
  const next: Tally = new Map()
  for (const plan of thisWeek) addTally(next, planTally(plan, drop, muscleOf), plan.occurrences ?? 1)

  // Last week: what was planned, and what was done.
  const planOf = new Map<string, Tally>()
  const occurrences = new Map<string, number>()
  for (const plan of lastWeek.plan) {
    if (!planOf.has(plan.id)) planOf.set(plan.id, planTally(plan, drop, muscleOf))
    occurrences.set(plan.id, (occurrences.get(plan.id) ?? 0) + (plan.occurrences ?? 1))
  }
  const sessionsOf = new Map<string, number>()
  const did: Tally = new Map()
  for (const session of lastWeek.sessions) {
    if (session.weekPlanId !== null) sessionsOf.set(session.weekPlanId, (sessionsOf.get(session.weekPlanId) ?? 0) + 1)
    if (isDone(session.status)) addTally(did, doneTally(session, drop, muscleOf))
    else if (session.weekPlanId !== null && planOf.has(session.weekPlanId)) addTally(did, planOf.get(session.weekPlanId)!)
  }
  const planned: Tally = new Map()
  for (const [planId, tally] of planOf) {
    const sessions = sessionsOf.get(planId) ?? 0
    const times = Math.max(occurrences.get(planId)!, sessions)
    addTally(planned, tally, times)
    addTally(did, tally, times - sessions) // an occurrence with no session yet counts its plan
  }

  const rows: VolumeRow[] = []
  for (const muscle of MUSCLE_GROUPS) {
    const last = did.get(muscle) ?? 0
    const lastPlanned = planned.get(muscle) ?? 0
    const thisWeekSets = next.get(muscle) ?? 0
    if (last === 0 && lastPlanned === 0 && thisWeekSets === 0) continue
    const row: VolumeRow = { muscle, last, this: thisWeekSets, delta: thisWeekSets - last }
    if (last !== lastPlanned) {
      row.note = `YOU PLANNED ${formatVolumeCount(lastPlanned)} LAST WEEK · DID ${formatVolumeCount(last)}`
    }
    rows.push(row)
  }
  return rows
}

// ─── Formatting (board 3) ──────────────────────────────────────────────────────

/** A count as the board writes it: `10`, `5½` (the board's own `fmt`), and `½` for a half on its own. */
export function formatVolumeCount(count: number): string {
  if (count % 1 !== 0.5) return String(count)
  const whole = Math.floor(count)
  return whole === 0 ? '½' : `${whole}½`
}

/** The change chip: `+1`, `−6` (U+2212, as the board), `+½`; nothing when it didn't change. */
export function formatVolumeDelta(delta: number): string {
  if (delta === 0) return ''
  return `${delta > 0 ? '+' : '−'}${formatVolumeCount(Math.abs(delta))}`
}
