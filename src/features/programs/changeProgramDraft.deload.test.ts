// Chunk 51b review 1 (the review's probe P2, as a test): walks of 51b's edits on a stable run that has a session MARKED DELOAD with rules
// on (its pre-deload plan saved in `deload_restore`). For every step's list: no delete of a program or a workout, no insert into programs,
// workouts or week plans, every week-plan op an update of `deload_restore` alone (DECISIONS 142), every schedule insert a whole row from
// week 1 or from currentWeek + 1, every schedule update the schedule alone; the stand-in for migration 043 takes the list; and after the
// last save UNMARK brings the deload session back to exactly the new default's shape. The edits are the ones 51b adds (sets, kinds, rep
// targets, stages, ALL, REST AFTER, days, an added exercise with two sets, a swap), chosen at random.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import type { DayOfWeek } from '../../types'
import type { Op } from './programChange'
import { planProgramChange } from './programChange'
import {
  addExercise as addExerciseRow,
  addWorkout,
  applyOpsToDb,
  cloneDb,
  idGen,
  inputOf,
  newWorld,
  planSession,
  runCopyOf,
  setDays,
  type World,
} from './programChange.testutil'
import { markDeload, unmarkDeload } from './programChange.deload.testutil'
import {
  addExercise,
  addSet,
  initialDraft,
  removeSet,
  setAllRepTargets,
  setSetRepTarget,
  setSetRestAfter,
  setSetType,
  setStageRepTarget,
  swapExercise,
  toggleWorkoutDay,
  type DraftState,
} from './changeProgramDraft'
import { repTargetOf, repText } from './changeProgramSets'

function world(): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'fb', 'Full Body', 0)
  addWorkout(w, 'arms', 'Arms', 1)
  setDays(w, { tuesday: 'fb', thursday: 'fb', saturday: 'arms' })
  // set 2 and set 3 differ, so which one is removed shows
  addExerciseRow(w, 'pe-leg', 'fb', 'ex-leg', 0, [{ reps: '12', warmup: true }, { reps: '10-12' }, { reps: '6-8', rest: 150 }])
  addExerciseRow(w, 'pe-inc', 'fb', 'ex-inc', 1, [{ reps: '8-10' }, { reps: '8-10', kind: 'dropset', stages: ['6-8'] }])
  addExerciseRow(w, 'pe-curl', 'arms', 'ex-curl', 0, [{ reps: '10-12' }, { reps: '12-15' }])
  for (const week of [1, 2, 3]) {
    planSession(w, `p${week}-fb`, 'fb', week, { weights: 50 })
    planSession(w, `p${week}-arms`, 'arms', week, { weights: 20 })
  }
  return w
}
const start = (w: World): DraftState => initialDraft(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
const repsOf = (r: { rep_min: number | null; rep_max: number | null; is_amrap: boolean }) => repText(repTargetOf({ repMin: r.rep_min, repMax: r.rep_max, isAmrap: r.is_amrap }))

type Db = World['db']
function defaultShape(db: Db, workoutId: string) {
  const live = db.v2_program_exercises.filter((e) => e.workout_day_id === workoutId && !e.week_only && !e.removed_at).sort((a, b) => a.position - b.position)
  return live.map((e) => {
    const rows = db.v2_program_sets.filter((x) => x.program_exercise_id === e.id && !x.removed_at)
    const heads = rows.filter((x) => x.parent_program_set_id === null).sort((a, b) => a.position - b.position)
    return {
      exercise: e.exercise_id,
      sets: heads.map((h) => ({ warmup: h.is_warmup, kind: rows.some((x) => x.parent_program_set_id === h.id) ? (h.stage_kind ?? 'dropset') : null, reps: repsOf(h), stages: rows.filter((x) => x.parent_program_set_id === h.id).sort((a, b) => a.stage_index - b.stage_index).map(repsOf) })),
    }
  })
}
function sessionShape(db: Db, planId: string) {
  const list = db.v2_week_plan_exercises.filter((x) => x.week_plan_id === planId).sort((a, b) => a.position - b.position)
  return list.map((x) => {
    const row = db.v2_program_exercises.find((e) => e.id === x.program_exercise_id)!
    const rows = db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId && s.program_exercise_id === row.id)
    const heads = rows.filter((s) => s.parent_week_plan_set_id === null).sort((a, b) => a.set_number - b.set_number)
    return {
      exercise: row.exercise_id,
      sets: heads.map((h) => ({ warmup: h.is_warmup, kind: rows.some((s) => s.parent_week_plan_set_id === h.id) ? (h.stage_kind ?? 'dropset') : null, reps: repsOf(h), stages: rows.filter((s) => s.parent_week_plan_set_id === h.id).sort((a, b) => a.stage_index - b.stage_index).map(repsOf) })),
    }
  })
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const DAYS: readonly DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const TYPES = [
  { kind: 'normal' },
  { kind: 'warmup' },
  { kind: 'staged', stageKind: 'dropset', stageCount: 2, stageRestSeconds: null },
  { kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: 20 },
  { kind: 'staged', stageKind: 'cluster', stageCount: 3, stageRestSeconds: 30 },
] as const
const TARGETS = [{ type: 'none' }, { type: 'amrap' }, { type: 'number', value: 6 }, { type: 'range', min: 8, max: 12 }, { type: 'range', min: 15, max: 20 }] as const

function edit(s: DraftState, r: () => number, step: number): DraftState {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const wk = pick(s.edit.workouts)
  const ex = wk.exercises.length ? pick(wk.exercises) : undefined
  const sets = ex?.sets ?? []
  const i = sets.length ? Math.floor(r() * sets.length) : -1
  switch (Math.floor(r() * 12)) {
    case 0:
      return ex ? addSet(s, wk.id, ex.key) : s
    case 1:
      return ex && i >= 0 ? removeSet(s, wk.id, ex.key, i) : s
    case 2:
      return ex && i >= 0 ? setSetType(s, wk.id, ex.key, i, pick(TYPES)) : s
    case 3:
      return ex && i >= 0 ? setSetRepTarget(s, wk.id, ex.key, i, pick(TARGETS)) : s
    case 4:
      return ex && sets[i]?.stages.length ? setStageRepTarget(s, wk.id, ex.key, i, Math.floor(r() * sets[i].stages.length), pick(TARGETS)) : s
    case 5:
      return ex && sets.length ? setAllRepTargets(s, wk.id, ex.key, pick(TARGETS)) : s
    case 6:
      return ex && i >= 0 ? setSetRestAfter(s, wk.id, ex.key, i, r() < 0.3 ? null : 15 * (1 + Math.floor(r() * 20))) : s
    case 7:
    case 8:
      return toggleWorkoutDay(s, wk.id, pick(DAYS), true)
    case 9: {
      const added = addExercise(s, wk.id, `ex-add-${step}`, 'kg')
      const list = added.edit.workouts.find((x) => x.id === wk.id)!.exercises
      const key = list[list.length - 1].key
      return addSet(addSet(added, wk.id, key), wk.id, key)
    }
    case 10:
      return ex ? swapExercise(s, wk.id, ex.key, `ex-swap-${step}`) : s
    default:
      return s
  }
}

function forbidden(ops: readonly Op[], currentWeek: number): string[] {
  const bad: string[] = []
  for (const o of ops) {
    // the op types already refuse these tables (157 (c)); this checks the runtime lists all the same, so the table is read as plain text
    const table: string = o.table
    if (o.op === 'delete' && (table === 'v2_programs' || table === 'v2_workout_days' || table === 'v2_week_plans')) bad.push(`delete ${table}`)
    if (o.op === 'insert' && (table === 'v2_programs' || table === 'v2_workout_days' || table === 'v2_week_plans')) bad.push(`insert ${table}`)
    if (o.table === 'v2_week_plans' && !(o.op === 'update' && Object.keys(o.patch).join() === 'deload_restore')) bad.push(`week plan ${o.op} ${JSON.stringify('patch' in o ? Object.keys(o.patch) : '')}`)
    if (o.table === 'v2_run_schedules' && o.op === 'insert') {
      const row = o.row as Record<string, unknown>
      for (const c of ['id', 'user_id', 'mesocycle_id', 'from_week', 'schedule', 'created_at']) if (row[c] == null) bad.push(`schedule insert without ${c}`)
      if (row.from_week !== 1 && row.from_week !== currentWeek + 1) bad.push(`schedule insert from_week ${String(row.from_week)}`)
    }
    if (o.table === 'v2_run_schedules' && o.op === 'update' && Object.keys(o.patch).join() !== 'schedule') bad.push(`schedule update ${Object.keys(o.patch).join()}`)
    if (o.table === 'v2_run_schedules' && o.op === 'delete') bad.push('schedule delete')
    if (o.table === 'v2_programs' && o.op === 'update' && Object.keys(o.patch).join() !== 'schedule') bad.push(`program update ${Object.keys(o.patch).join()}`)
  }
  return bad
}

describe('walks of 51b’s edits on a run with a session marked deload: no forbidden op, and UNMARK restores the new default (review 1, P2)', () => {
  it('60 walks of 15 edits', async () => {
    let checkedRestores = 0
    let deloadUpdates = 0
    let scheduleInserts = 0
    for (let walk = 0; walk < 60; walk++) {
      const w = world()
      await markDeload(w.db, 'p3-fb')
      expect(w.db.v2_week_plans.find((p) => p.id === 'p3-fb')!.deload_restore).not.toBeNull()
      const r = rng(walk + 5101)
      let s = start(w)
      let last: Op[] = []
      for (let step = 0; step < 15; step++) {
        s = edit(s, r, step)
        const ops = planProgramChange({ ...inputOf(w, s.edit, { statuses: { 'p2-fb': 'done' } }), newId: idGen(`w${walk}s${step}-`) }).ops
        const bad = forbidden(ops, 2)
        expect({ walk, step, bad }).toEqual({ walk, step, bad: [] })
        applyOpsToDb(cloneDb(w.db), ops)
        last = ops
      }
      deloadUpdates += last.filter((o) => o.table === 'v2_week_plans').length
      scheduleInserts += last.filter((o) => o.table === 'v2_run_schedules' && o.op === 'insert').length
      const after = applyOpsToDb(cloneDb(w.db), last)
      // UNMARK the deload session: its plan comes back as the new default says (the session was a copy of the default)
      await unmarkDeload(after, 'p3-fb')
      expect({ walk, shape: sessionShape(after, 'p3-fb') }).toEqual({ walk, shape: defaultShape(after, 'fb') })
      checkedRestores++
    }
    // the walks reached what they are for: a deload copy rewritten and a schedule row inserted in many of them
    expect(checkedRestores).toBe(60)
    expect(deloadUpdates).toBeGreaterThan(10)
    expect(scheduleInserts).toBeGreaterThan(10)
  })
})
