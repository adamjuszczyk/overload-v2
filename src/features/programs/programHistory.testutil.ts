// Builders shared by the finished program's tests (chunk 66): planned sessions as the real app types, and the board's own world. Not a test file
// (Vitest's include is *.test.ts) and imported by nothing in the app.

import type { WeekPlan, WeekPlanSet, WeeklySchedule } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary'
import { pe, plan, stage, wset } from '../plan/weekPlanning.testutil'

export const NAMES: Record<string, string> = {
  lat: 'Lat Pulldown',
  row: 'Seated Cable Row',
  face: 'Face Pull',
  curl: 'EZ Bar Curl',
  sap: 'Straight-Arm Pulldown',
  squat: 'Back Squat',
  rdl: 'Romanian Deadlift',
  ext: 'Leg Extension',
  calf: 'Standing Calf Raise',
  incline: 'Incline Dumbbell Press',
  bench: 'Bench Press',
}

export interface Spec {
  /** The catalogue exercise (a key of NAMES). */
  ex: string
  sets?: number
  warmups?: number
  /** Working set n (1-based) is a staged head of this kind, with one stage row; `null` is a staged head with no stored kind (a legacy dropset). */
  staged?: Record<number, StageKind | null>
  block?: string | null
  tempo?: string | null
  /** A second row of the same catalogue exercise in the workout needs its own program-exercise id. */
  rowId?: string
}

/** One planned session: the program-exercise ids are the workout's own, the same in every week (a run copy's rows). */
export function session(week: number, workoutDayId: string, specs: Spec[], over: Partial<WeekPlan> = {}): WeekPlan {
  const exercises = specs.map((spec, i) => {
    const row = pe(spec.rowId ?? `${workoutDayId}-${spec.ex}`, spec.ex, i, { workoutDayId, supersetBlockId: spec.block ?? null, tempo: spec.tempo ?? null })
    return { ...row, exercise: { ...row.exercise!, name: NAMES[spec.ex] } }
  })
  const sets: WeekPlanSet[] = []
  specs.forEach((spec, i) => {
    const peId = exercises[i].id
    const warmups = spec.warmups ?? 0
    for (let w = 1; w <= warmups; w++) sets.push(wset(`${peId}-w${w}`, peId, w, { isWarmup: true }))
    for (let n = 1; n <= (spec.sets ?? 3); n++) {
      const kind = spec.staged && n in spec.staged ? spec.staged[n] : undefined
      const id = `${peId}-s${n}`
      sets.push(wset(id, peId, warmups + n, kind === undefined ? {} : { stageKind: kind }))
      if (kind !== undefined) sets.push(stage(`${id}-d1`, id, peId, 1, { setNumber: warmups + n }))
    }
  })
  return plan(week, exercises, sets, { id: `wp-${workoutDayId}-${week}`, workoutDayId, ...over })
}

export const DAYS = [
  { id: 'pull-1', name: 'Pull 1', position: 1 },
  { id: 'legs', name: 'Legs', position: 4 },
  { id: 'push-1', name: 'Push 1', position: 0 },
  { id: 'push-2', name: 'Push 2', position: 2 },
]
export const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
export const SCHEDULE: WeeklySchedule = { ...NO_DAYS, monday: 'push-1', tuesday: 'pull-1', thursday: 'push-2', saturday: 'legs' }

export const PULL: Spec[] = [{ ex: 'lat' }, { ex: 'row' }, { ex: 'curl', warmups: 1, sets: 2 }, { ex: 'sap', sets: 2 }]
export const LEGS: Spec[] = [{ ex: 'squat', warmups: 1 }, { ex: 'rdl' }, { ex: 'ext' }, { ex: 'calf', sets: 2 }]

/**
 * Board PR14's run, "Cut PPL", Mon 2026-07-06 to Sun 2026-09-13: ten weeks, week 7 the deload; Push 1 and Push 2 both go from 3 to 4 sets of
 * Incline Dumbbell Press in week 3; in week 4 Pull 1 makes Lat Pulldown's set 3 a dropset, adds Face Pull in a superset with Seated Cable Row
 * and drops Straight-Arm Pulldown; Legs reorders in week 8 (Leg Extension before Back Squat). Tempo changes nothing a week stores.
 */
export function cutPplPlans(): WeekPlan[] {
  const plans: WeekPlan[] = []
  for (let n = 1; n <= 10; n++) {
    const incline: Spec[] = [{ ex: 'incline', sets: n >= 3 ? 4 : 3 }]
    const pull: Spec[] =
      n >= 4
        ? [{ ex: 'lat', staged: { 3: 'dropset' } }, { ex: 'row', block: 'b1' }, { ex: 'face', sets: 2, block: 'b1' }, PULL[2]]
        : PULL
    const legs: Spec[] = n >= 8 ? [LEGS[2], LEGS[0], LEGS[1], LEGS[3]] : LEGS
    const over = { isDeload: n === 7 }
    plans.push(session(n, 'push-1', incline, over), session(n, 'push-2', incline, over), session(n, 'pull-1', pull, over), session(n, 'legs', legs, over))
  }
  return plans
}
