// The world chunk 56's tests share (REVIEW's service, hooks and screens): the seed's week 2, last week of a run whose week 3 is open.
// Not a test file (Vitest's include is *.test.ts) and imported by nothing in the app.
//
// Last week, as the seed has it (TASKS 56: "last week's Monday done differently in five ways, Wednesday deload as planned, Friday skipped,
// which adds nothing, G52"):
//   MON Upper A (completed): bench 02 at 82.5 kg × 7 (weight), bench 03 at 80 × 9 (reps, outside 6–8), row 03 skipped, lateral raise 01 given
//                             a drop (a dropset made of a plain set), a third pushdown set added (20 kg × 15)  → five items
//   WED Lower A (completed): done as planned → none        FRI Upper B (skipped): logs that would be three items if it counted → none
// The typed rows are what Plan reads (`WeekPlan`, `SetLog`, `Session`); the same world as database rows is what the fake PostgREST serves,
// and `executor` stands in for 043's `v2_apply_ops` over those rows: all or none, unique decisions, the checks the week sets carry.

import type { SetLog, WeekPlan, WeekPlanSet } from '../../types'
import type { Op } from '../programs/programChange'
import { fakePostgrest, type Row, type Tables } from '../programs/fakePostgrest.testutil'
import { dropLog, row, session, setLog, weekPlan, workoutDay, wset } from './review.testutil'

export const USER = 'u-test'
export const NOW = '2026-10-19T09:00:00.000Z'

type Spec = readonly [pe: string, exerciseId: string, name: string, sets: number, kg: number, reps: readonly [number, number]]
const UPPER_A: readonly Spec[] = [
  ['pe-bench', 'e-bench', 'Barbell Bench Press', 3, 80, [6, 8]],
  ['pe-row', 'e-row', 'Seated Cable Row', 3, 60, [10, 12]],
  ['pe-lat', 'e-lat', 'Dumbbell Lateral Raise', 3, 10, [12, 15]],
  ['pe-push', 'e-push', 'Cable Triceps Pushdown', 2, 30, [10, 12]],
]
const LOWER_A: readonly Spec[] = [['pe-squat', 'e-squat', 'Back Squat', 2, 100, [5, 6]]]
const UPPER_B: readonly Spec[] = [['pe-ohp', 'e-ohp', 'Overhead Press', 3, 50, [6, 8]]]
const SPECS = { ua: UPPER_A, la: LOWER_A, ub: UPPER_B }
const NAMES = { ua: 'Upper A', la: 'Lower A', ub: 'Upper B' }
export type Key = keyof typeof SPECS

export const planId = (key: Key, week: number): string => `wp-${key}-${week}`
export const setId = (week: number, pe: string, n: number): string => `w${week}-${pe}-${n}`

export function plan(key: Key, week: number): WeekPlan {
  const specs = SPECS[key]
  const exercises = specs.map(([pe, exerciseId, name], i) => row(pe, exerciseId, i + 1, name))
  const sets: WeekPlanSet[] = specs.flatMap(([pe, , , n, kg, reps]) =>
    Array.from({ length: n }, (_, i) =>
      wset(setId(week, pe, i + 1), pe, i + 1, { weekPlanId: planId(key, week), targetWeight: kg, targetRir: 2, repMin: reps[0], repMax: reps[1] }),
    ),
  )
  return weekPlan(key, week, exercises, sets, { id: planId(key, week), workoutDay: workoutDay(`wd-${key}`, NAMES[key]) })
}

// A log "as planned": the plan's weight, the bottom of its rep range, RIR 2.
const done = (id: string, sid: string, spec: Spec, n: number, over: Partial<SetLog> = {}): SetLog =>
  setLog(id, sid, spec[1], { weekPlanSetId: setId(2, spec[0], n), setNumber: n, weight: spec[4], reps: spec[5][0], rir: 2, loggedAt: `2026-10-05T18:${String(10 + n).padStart(2, '0')}:00.000Z`, ...over })

export function lastWeekLogs(): { ua: SetLog[]; la: SetLog[]; ub: SetLog[] } {
  const [bench, row_, lat, push] = UPPER_A
  const ua = [
    done('lg-b1', 's-ua', bench, 1),
    done('lg-b2', 's-ua', bench, 2, { weight: 82.5, reps: 7 }),
    done('lg-b3', 's-ua', bench, 3, { reps: 9 }),
    done('lg-r1', 's-ua', row_, 1),
    done('lg-r2', 's-ua', row_, 2),
    done('lg-r3', 's-ua', row_, 3, { isSkipped: true, weight: null, reps: null, rir: null }),
    done('lg-l1', 's-ua', lat, 1, { stageKind: 'dropset' }),
    dropLog('lg-l1d', 's-ua', 'e-lat', 'lg-l1', 1, { weight: 8, reps: 10 }),
    done('lg-l2', 's-ua', lat, 2),
    done('lg-l3', 's-ua', lat, 3),
    done('lg-p1', 's-ua', push, 1),
    done('lg-p2', 's-ua', push, 2),
    setLog('lg-p3', 's-ua', 'e-push', { setNumber: 3, weight: 20, reps: 15, rir: 1, loggedAt: '2026-10-05T18:30:00.000Z' }),
  ]
  const la = [done('lg-q1', 's-la', LOWER_A[0], 1), done('lg-q2', 's-la', LOWER_A[0], 2)]
  const ub = UPPER_B.flatMap((s) => [1, 2, 3].map((n) => done(`lg-o${n}`, 's-ub', s, n, { weight: 55 })))
  return { ua, la, ub }
}

export function sessions(over: { ua?: 'completed' | 'in_progress'; ub?: 'skipped' | 'completed' } = {}) {
  const logs = lastWeekLogs()
  return [
    session('s-ua', planId('ua', 2), over.ua ?? 'completed', logs.ua, { date: '2026-10-05', workoutDayId: 'wd-ua' }),
    session('s-la', planId('la', 2), 'completed', logs.la, { date: '2026-10-07', workoutDayId: 'wd-la' }),
    session('s-ub', planId('ub', 2), over.ub ?? 'skipped', logs.ub, { date: '2026-10-09', workoutDayId: 'wd-ub' }),
  ]
}

// ─── The same world as database rows ───────────────────────────────────────────────────────────────────────────

const setRow = (s: WeekPlanSet): Row => ({
  id: s.id, user_id: USER, week_plan_id: s.weekPlanId, program_exercise_id: s.programExerciseId, set_number: s.setNumber,
  target_rir: s.targetRir ?? null, target_rir_max: s.targetRirMax ?? null, is_dropset: s.isDropset, parent_week_plan_set_id: s.parentWeekPlanSetId ?? null,
  stage_index: s.stageIndex, is_warmup: s.isWarmup, program_set_id: s.programSetId ?? null, stage_kind: s.stageKind ?? null,
  target_weight: s.targetWeight ?? null, rep_min: s.repMin ?? null, rep_max: s.repMax ?? null, is_amrap: s.isAmrap ?? false, tags: s.tags ?? null,
})

const logRow = (l: SetLog): Row => ({
  id: l.id, user_id: USER, session_id: l.sessionId, exercise_id: l.exerciseId, week_plan_set_id: l.weekPlanSetId, set_number: l.setNumber, weight: l.weight,
  reps: l.reps, rir: l.rir, note: null, is_dropset: l.isDropset, parent_set_id: l.parentSetId, stage_index: l.stageIndex, is_warmup: l.isWarmup,
  set_seconds: null, entered_unit: null, is_skipped: l.isSkipped, logged_at: l.loggedAt, rest_seconds: null, form_rating: null,
  stage_kind: l.stageKind ?? null, added_place: l.addedPlace ?? null,
})

export function worldTables(opts: { ua?: 'completed' | 'in_progress'; ub?: 'skipped' | 'completed' } = {}): Tables {
  const all = sessions(opts)
  const plans = (['ua', 'la', 'ub'] as const).flatMap((k) => [plan(k, 2), plan(k, 3)])
  const names = new Set(all.flatMap((s) => (s.setLogs ?? []).map((l) => l.exerciseId)))
  return {
    v2_sessions: all.map((s) => ({
      id: s.id, user_id: USER, mesocycle_id: 'meso', week_plan_id: s.weekPlanId, workout_day_id: s.workoutDayId, date: s.date, status: s.status, note: null,
      started_at: null, completed_at: null, created_at: '2026-10-05T00:00:00.000Z', moved_to_date: null,
    })),
    v2_set_logs: all.flatMap((s) => (s.setLogs ?? []).map(logRow)),
    exercises: [...names].map((id) => ({ id, user_id: USER, name: id.replace('e-', ''), muscle_group: 'chest', is_archived: false, created_at: '', muscle_subgroup: null, movement_pattern: null, status: 'active', source_library_id: null, lost_at: null })),
    v2_session_set_changes: [],
    v2_session_exercise_swaps: [],
    v2_week_review_decisions: [],
    v2_week_plans: plans.map((p) => ({ id: p.id, user_id: USER, week_number: p.weekNumber })),
    v2_week_plan_sets: plans.flatMap((p) => p.sets.map(setRow)),
  }
}

// ─── 043's `v2_apply_ops`, over those rows ───────────────────────────────────────────────────────────────────

export interface ExecutorError { code: string; message: string }
const refusal = (code: string, message: string): ExecutorError => ({ code, message })

const SET_COLUMNS = ['week_plan_id', 'program_exercise_id', 'set_number', 'target_rir', 'target_rir_max', 'is_dropset', 'parent_week_plan_set_id', 'stage_index', 'is_warmup', 'program_set_id', 'stage_kind', 'target_weight', 'rep_min', 'rep_max', 'is_amrap', 'tags']
const DECISION_COLUMNS = ['week_plan_id', 'item_key', 'decision', 'created_at']

function applyOne(tables: Tables, op: Op): void {
  const t = op.table as string
  const list = (tables[t] ??= [])
  if (op.op === 'insert') {
    const r: Record<string, unknown> = { ...(op.row as Record<string, unknown>), user_id: USER }
    if (typeof r.id !== 'string') throw refusal('23502', `null value in column "id" of relation "${t}" violates not-null constraint`)
    if (list.some((x) => x.id === r.id)) throw refusal('23505', `duplicate key value violates unique constraint "${t}_pkey"`)
    const columns = t === 'v2_week_plan_sets' ? SET_COLUMNS : t === 'v2_week_review_decisions' ? DECISION_COLUMNS : null
    if (columns) {
      for (const c of columns) if (r[c] === undefined) throw refusal('23502', `null value in column "${c}" of relation "${t}" violates not-null constraint`)
      for (const c of Object.keys(r)) if (c !== 'id' && c !== 'user_id' && !columns.includes(c)) throw refusal('42703', `row names an unknown column: ${t}.${c}`)
      if (!(tables.v2_week_plans ?? []).some((p) => p.id === r.week_plan_id)) throw refusal('23503', `insert on "${t}" violates foreign key constraint: week plan ${String(r.week_plan_id)}`)
    }
    if (t === 'v2_week_plan_sets') {
      if (r.parent_week_plan_set_id && !list.some((x) => x.id === r.parent_week_plan_set_id)) throw refusal('23503', 'insert on "v2_week_plan_sets" violates foreign key constraint: parent')
      if (typeof r.target_weight === 'number' && r.target_weight < 0) throw refusal('23514', 'new row violates check constraint "v2_week_plan_sets_target_weight_check"')
      if (typeof r.rep_min === 'number' && r.rep_min <= 0) throw refusal('23514', 'new row violates check constraint "v2_week_plan_sets_rep_min_check"')
    }
    if (t === 'v2_week_review_decisions' && list.some((x) => x.week_plan_id === r.week_plan_id && x.item_key === r.item_key)) {
      throw refusal('23505', 'duplicate key value violates unique constraint "v2_week_review_decisions_item_uk"')
    }
    list.push(r)
  } else if (op.op === 'update') {
    const target = list.find((x) => x.id === op.id)
    if (!target) throw refusal('P0001', `row not found: ${t}/${op.id}`)
    const patch = op.patch as Record<string, unknown>
    if ('id' in patch || 'user_id' in patch) throw refusal('P0001', 'patch sets a protected column')
    if (t === 'v2_week_plan_sets') for (const c of Object.keys(patch)) if (!SET_COLUMNS.includes(c)) throw refusal('P0001', `patch names an unknown column: ${c}`)
    Object.assign(target, patch)
  } else {
    const at = list.findIndex((x) => x.id === op.id)
    if (at < 0) throw refusal('P0001', `row not found: ${t}/${op.id}`)
    list.splice(at, 1)
    if (t === 'v2_week_plan_sets') tables[t] = list.filter((x) => x.parent_week_plan_set_id !== op.id) // the foreign key's cascade
  }
}

export interface World {
  tables: Tables
  /** `supabase` for the code under test: the fake PostgREST's reads and `rpc('v2_apply_ops')` over the same rows. */
  client: { from: ReturnType<typeof fakePostgrest>['client']['from']; rpc: (name: string, args: { p_ops: Op[] }) => Promise<{ data: number | null; error: ExecutorError | null }> }
  fake: ReturnType<typeof fakePostgrest>
  /** Every op list sent, in order (the ones that failed too). */
  sent: Op[][]
  /** Hold the next request until `release()`; resolves to the function that lets it go. */
  holdNext: () => () => void
  /** Make the next request fail with this refusal (nothing is written). */
  refuseNext: (error: ExecutorError) => void
}

export function makeWorld(opts: Parameters<typeof worldTables>[0] = {}): World {
  const tables = worldTables(opts)
  const fake = fakePostgrest(tables)
  const sent: Op[][] = []
  let hold: Promise<void> | null = null
  let refusal_: ExecutorError | null = null
  const rpc = async (name: string, args: { p_ops: Op[] }) => {
    if (name !== 'v2_apply_ops') throw new Error(`unexpected rpc ${name}`)
    sent.push(args.p_ops)
    if (hold) await hold
    hold = null
    if (refusal_) {
      const error = refusal_
      refusal_ = null
      return { data: null, error }
    }
    const copy = structuredClone(tables)
    try {
      for (const op of args.p_ops) applyOne(copy, op)
    } catch (error) {
      return { data: null, error: error as ExecutorError }
    }
    Object.assign(tables, copy)
    return { data: args.p_ops.length, error: null }
  }
  return {
    tables,
    client: { from: fake.client.from, rpc },
    fake,
    sent,
    holdNext: () => {
      let release = () => {}
      hold = new Promise<void>((resolve) => (release = resolve))
      return release
    },
    refuseNext: (error) => void (refusal_ = error),
  }
}
