import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeekPlan } from '../../types'
import { draftFromRunCopy, type Op, type ProgramEdit } from '../programs/programChange'
import {
  NOW, USER, addBlock, addExercise, addWorkout, applyOpsToDb, idGen, inserts, newWorld, planOf, planSession, runCopyOf, sessionsOf, type World,
} from '../programs/programChange.testutil'
import type { ChangeProgramSource } from '../programs/changeProgramService'
import type { DoneSet, ReviewEntry, ReviewProgramEdit } from './review'
import { row, weekPlan } from './review.testutil'
import { fakePostgrest } from '../programs/fakePostgrest.testutil'

// Chunk 56 (TASKS-1.2 "REVIEW": "ADD EXERCISE / SWAP FROM WEEK N go through `planProgramChange` (45) so they land as CHANGE THE PROGRAM
// changes"; "SWAP FROM WEEK N sends the `planProgramChange` ops (asserted equal to 45's output for that input)"; SPEC Actions: "This week gets as
// many sets as were done, with the done numbers as targets; later weeks follow the program's planning type (week-dependent copies them;
// stable adds them to the default)"). The world is chunk 45's own (`programChange.testutil.ts`), its executor refuses what the database refuses.

const h = vi.hoisted(() => ({ source: null as unknown as ChangeProgramSource, sent: [] as Op[][], reads: null as unknown as { from: (table: string) => unknown } }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    // The one read an action makes before it writes: has this item been decided already?
    from: (...args: unknown[]) => (h.reads.from as (...a: unknown[]) => unknown)(...args),
    rpc: async (_name: string, args: { p_ops: Op[] }) => {
      h.sent.push(args.p_ops)
      return { data: args.p_ops.length, error: null }
    },
  },
}))
vi.mock('../programs/changeProgramService', () => ({ fetchChangeProgramSource: async () => h.source }))

const { decideReviewItem, programEditOps } = await import('./reviewService')

const PLAN = { id: 'wp-ua-3', workoutDayId: 'wd-ua' }
const DONE: DoneSet[] = [
  { weight: 20, reps: 12, rir: null, type: { kind: 'warmup' } },
  { weight: 40, reps: 10, rir: 2, type: { kind: 'normal' } },
  { weight: 45, reps: 8, rir: 1, type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 } },
]
const ADD: ReviewProgramEdit = { type: 'add_exercise', exerciseId: 'e-fly', afterProgramExerciseId: 'pe-row', sets: DONE }
const SWAP: ReviewProgramEdit = { type: 'swap_exercise', programExerciseId: 'pe-lat', fromExerciseId: 'e-lat', toExerciseId: 'e-cable' }

// Upper A: bench, row, lateral raise and pushdown, planned in weeks 2, 3 (the week shown, current) and 4.
function world(over: Parameters<typeof newWorld>[0] = {}, blocked = false): World {
  const w = newWorld({ planningType: 'week_dependent', currentWeek: 3, ...over })
  addWorkout(w, 'wd-ua', 'Upper A', 0)
  if (blocked) addBlock(w, 'blk', 'wd-ua', null, null)
  const sets = [{ reps: '6-8' }, { reps: '6-8' }, { reps: '6-8' }]
  addExercise(w, 'pe-bench', 'wd-ua', 'e-bench', 0, sets)
  addExercise(w, 'pe-row', 'wd-ua', 'e-row', 1, sets, blocked ? { superset_block_id: 'blk' } : {})
  addExercise(w, 'pe-lat', 'wd-ua', 'e-lat', 2, sets, blocked ? { superset_block_id: 'blk' } : {})
  addExercise(w, 'pe-push', 'wd-ua', 'e-push', 3, sets)
  for (const week of [2, 3, 4]) planSession(w, `wp-ua-${week}`, 'wd-ua', week)
  return w
}
const sourceOf = (w: World, statuses: Record<string, 'done' | 'in_progress' | 'not_started'> = {}): ChangeProgramSource => ({
  runCopy: runCopyOf(w.db, w.programId, w.mesocycleId),
  exercises: [],
  sessions: sessionsOf(w.db, w.mesocycleId, statuses, 3),
  scheduleRows: [],
})
const ops = (w: World, edit: ReviewProgramEdit, statuses: Record<string, 'done' | 'in_progress' | 'not_started'> = {}) =>
  programEditOps({ edit, weekPlan: PLAN, source: sourceOf(w, statuses), planningType: w.planningType, scheduleType: 'weekday', currentWeek: 3, userId: USER, now: NOW, newId: idGen(), unit: 'kg' })
const orderOf = (db: World['db'], workout = 'wd-ua') =>
  db.v2_program_exercises.filter((e) => e.workout_day_id === workout && !e.removed_at).sort((a, b) => a.position - b.position).map((e) => e.exercise_id)
const weekSets = (db: World['db'], planId: string, exerciseId: string) => {
  const rowId = db.v2_program_exercises.find((e) => e.exercise_id === exerciseId && !e.removed_at)!.id
  return db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId && s.program_exercise_id === rowId).sort((a, b) => a.set_number - b.set_number || a.stage_index - b.stage_index)
}

let w: World
beforeEach(() => {
  w = world()
  h.sent = []
  h.reads = fakePostgrest({ v2_week_review_decisions: [] }).client
})

describe('W: SWAP FROM WEEK N is the planner’s swap', () => {
  it('sends exactly the ops chunk 45 makes for a draft with that slot swapped, and they land', () => {
    const base: ProgramEdit = draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
    const expected = planOf(w, {
      ...base,
      workouts: base.workouts.map((wk) => ({
        ...wk,
        exercises: wk.exercises.map((e) =>
          e.kind === 'kept' && e.id === 'pe-lat'
            ? { kind: 'swapped' as const, replaces: 'pe-lat', exerciseId: 'e-cable', supersetBlockId: e.supersetBlockId, restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null }
            : e,
        ),
      })),
    }).ops
    expect(expected.length).toBeGreaterThan(0)
    expect(ops(w, SWAP)).toEqual(expected)
    const after = applyOpsToDb(w.db, ops(w, SWAP))
    expect(orderOf(after)).toEqual(['e-bench', 'e-row', 'e-cable', 'e-push'])
    const swappedRow = after.v2_program_exercises.find((e) => e.exercise_id === 'e-cable')!
    expect(swappedRow.replaces_program_exercise_id).toBe('pe-lat')
    // From week 3 on: the sessions of weeks 3 and 4 hold the new exercise's row; week 2 (before the current week) is as it was.
    expect(weekSets(after, 'wp-ua-3', 'e-cable')).toHaveLength(3)
    expect(weekSets(after, 'wp-ua-4', 'e-cable')).toHaveLength(3)
    expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'wp-ua-2' && s.program_exercise_id === 'pe-lat')).toHaveLength(3)
  })

  it('swaps the slot it names, not the first or the last (a slot in the middle of the workout)', () => {
    const at = (id: string) => orderOf(applyOpsToDb(w.db, ops(w, { ...SWAP, programExerciseId: id })))
    expect(at('pe-row')).toEqual(['e-bench', 'e-cable', 'e-lat', 'e-push'])
    expect(at('pe-push')).toEqual(['e-bench', 'e-row', 'e-lat', 'e-cable'])
  })

  it('a session in progress this week is left as it is (the planner’s rule), the week after takes the swap', () => {
    const after = applyOpsToDb(w.db, ops(w, SWAP, { 'wp-ua-3': 'in_progress' }))
    expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'wp-ua-3' && s.program_exercise_id === 'pe-lat')).toHaveLength(3)
    expect(weekSets(after, 'wp-ua-3', 'e-cable')).toHaveLength(0)
    expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'wp-ua-4' && s.program_exercise_id === 'pe-lat')).toHaveLength(0)
    expect(weekSets(after, 'wp-ua-4', 'e-cable')).toHaveLength(3)
  })

  it('says why it can not: a slot the run copy does not hold, a workout it does not hold', () => {
    expect(() => ops(w, { ...SWAP, programExerciseId: 'pe-gone' })).toThrow("That exercise isn't part of the program any more.")
    expect(() =>
      programEditOps({ edit: SWAP, weekPlan: { id: 'wp-x-3', workoutDayId: 'wd-x' }, source: sourceOf(w), planningType: w.planningType, scheduleType: 'weekday', currentWeek: 3, userId: USER, now: NOW, newId: idGen(), unit: 'kg' }),
    ).toThrow("This workout isn't part of the program.")
  })
})

describe('W: ADD EXERCISE on a week-dependent run', () => {
  it('adds the exercise after the one it followed, from this week on, and gives this week as many sets as were done with the done numbers', () => {
    const after = applyOpsToDb(w.db, ops(w, ADD))
    expect(orderOf(after)).toEqual(['e-bench', 'e-row', 'e-fly', 'e-lat', 'e-push'])
    const mine = weekSets(after, 'wp-ua-3', 'e-fly')
    const heads = mine.filter((s) => s.parent_week_plan_set_id === null)
    expect(heads.map((s) => [s.set_number, s.target_weight, s.rep_min, s.rep_max, s.is_warmup, s.stage_kind])).toEqual([
      [1, 20, 12, 12, true, null],
      [2, 40, 10, 10, false, null],
      [3, 45, 8, 8, false, 'dropset'],
    ])
    const stages = mine.filter((s) => s.parent_week_plan_set_id !== null)
    expect(stages.map((s) => [s.parent_week_plan_set_id, s.stage_index, s.is_dropset])).toEqual([[heads[2].id, 1, true], [heads[2].id, 2, true]])
    // Later weeks follow the planning type: a week-dependent run copies this week's sets when it plans them, and a week already planned gets the row with none.
    expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'wp-ua-4' && e.program_exercise_id === heads[0].program_exercise_id)).toHaveLength(1)
    expect(weekSets(after, 'wp-ua-4', 'e-fly')).toHaveLength(0)
    expect(weekSets(after, 'wp-ua-2', 'e-fly')).toHaveLength(0)
  })

  it('sends the planner’s ops first and this week’s sets after them (the foreign keys hold in that order)', () => {
    const list = ops(w, ADD)
    const mine = inserts(list, 'v2_week_plan_sets')
    expect(mine).toHaveLength(5)
    const exerciseInsert = list.findIndex((o) => o.op === 'insert' && o.table === 'v2_program_exercises')
    expect(exerciseInsert).toBeGreaterThanOrEqual(0)
    expect(list.findIndex((o) => o.op === 'insert' && o.table === 'v2_week_plan_sets')).toBeGreaterThan(exerciseInsert)
    expect(mine.every((o) => o.row.week_plan_id === 'wp-ua-3' && o.row.user_id === USER)).toBe(true)
  })

  it('places a new exercise after the whole superset when the one it followed is inside one, and first when it followed none', () => {
    const blocked = world({}, true)
    expect(orderOf(applyOpsToDb(blocked.db, ops(blocked, ADD)))).toEqual(['e-bench', 'e-row', 'e-lat', 'e-fly', 'e-push'])
    expect(orderOf(applyOpsToDb(w.db, ops(w, { ...ADD, afterProgramExerciseId: null })))).toEqual(['e-fly', 'e-bench', 'e-row', 'e-lat', 'e-push'])
    expect(orderOf(applyOpsToDb(w.db, ops(w, { ...ADD, afterProgramExerciseId: 'pe-gone' })))).toEqual(['e-bench', 'e-row', 'e-lat', 'e-push', 'e-fly'])
  })

  it('a session in progress this week takes no sets (the planner leaves it), the week after still gets the exercise', () => {
    const list = ops(w, ADD, { 'wp-ua-3': 'in_progress' })
    expect(inserts(list, 'v2_week_plan_sets')).toHaveLength(0)
    const after = applyOpsToDb(w.db, list)
    expect(weekSets(after, 'wp-ua-3', 'e-fly')).toHaveLength(0)
    expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'wp-ua-4' && e.program_exercise_id !== 'pe-lat' && !['pe-bench', 'pe-row', 'pe-push'].includes(e.program_exercise_id))).toHaveLength(1)
  })
})

describe('W: ADD EXERCISE on a stable run', () => {
  beforeEach(() => {
    w = world({ planningType: 'stable' })
  })

  it('adds the done sets to the default (kinds, drops, rep targets), and this week’s rows take the done weights', () => {
    const after = applyOpsToDb(w.db, ops(w, ADD))
    const fly = after.v2_program_exercises.find((e) => e.exercise_id === 'e-fly')!
    const defaults = after.v2_program_sets.filter((s) => s.program_exercise_id === fly.id && s.parent_program_set_id === null).sort((a, b) => a.position - b.position)
    expect(defaults.map((s) => [s.is_warmup, s.stage_kind, s.rep_min, s.rep_max])).toEqual([[true, null, 12, 12], [false, null, 10, 10], [false, 'dropset', 8, 8]])
    expect(after.v2_program_sets.filter((s) => s.program_exercise_id === fly.id && s.parent_program_set_id !== null)).toHaveLength(2)
    const heads = (planId: string) => weekSets(after, planId, 'e-fly').filter((s) => s.parent_week_plan_set_id === null)
    expect(heads('wp-ua-3').map((s) => [s.set_number, s.target_weight, s.rep_min, s.program_set_id !== null])).toEqual([[1, 20, 12, true], [2, 40, 10, true], [3, 45, 8, true]])
    // The default holds no weight: the weeks after get its sets with none.
    expect(heads('wp-ua-4').map((s) => [s.target_weight, s.rep_min])).toEqual([[null, 12], [null, 10], [null, 8]])
  })
})

describe('W: through the service, with the decision row last in the same request', () => {
  const planRow: WeekPlan = { ...weekPlan('ua', 3, [row('pe-lat', 'e-lat', 3, 'Dumbbell Lateral Raise'), row('pe-row', 'e-row', 2, 'Seated Cable Row')], []), id: 'wp-ua-3', workoutDayId: 'wd-ua' }
  const swapEntry: ReviewEntry = {
    key: 'swap:s-ua:pe-lat',
    item: { kind: 'swapped', sessionId: 's-ua', weekPlanId: 'wp-ua-3', programExerciseId: 'pe-lat', originalExerciseId: 'e-lat', originalExerciseName: 'Lateral Raise', replacementExerciseId: 'e-cable', replacementExerciseName: 'Cable Lateral Raise', doneSets: 3, plannedSets: 3, target: { programExerciseId: 'pe-lat' } },
  }
  const addEntry: ReviewEntry = {
    key: 'added-ex:s-ua:e-fly',
    item: { kind: 'added_exercise', sessionId: 's-ua', weekPlanId: 'wp-ua-3', exerciseId: 'e-fly', exerciseName: 'Cable Fly', unit: 'kg', sets: DONE, after: { programExerciseId: 'pe-row' } },
  }
  const run = (entry: ReviewEntry, action: 'swap' | 'add_exercise') => {
    h.source = sourceOf(w)
    return decideReviewItem({
      userId: USER, entry, action, weekPlan: planRow, newId: idGen(), now: () => NOW,
      program: { mesoId: w.mesocycleId, programId: w.programId, planningType: w.planningType, scheduleType: 'weekday', currentWeek: 3 },
    })
  }
  const decision = (key: string) => ({ op: 'insert', table: 'v2_week_review_decisions', row: expect.objectContaining({ week_plan_id: 'wp-ua-3', item_key: key, decision: 'used', user_id: USER, created_at: NOW }) })

  it('SWAP: one request, the planner’s ops and then the decision', async () => {
    await run(swapEntry, 'swap')
    expect(h.sent).toHaveLength(1)
    const [list] = h.sent
    expect(list.slice(0, -1)).toEqual(ops(w, SWAP))
    expect(list[list.length - 1]).toMatchObject(decision('swap:s-ua:pe-lat'))
  })

  it('ADD EXERCISE: one request, the planner’s ops, this week’s sets and then the decision; the item’s own unit is the new row’s', async () => {
    await run({ ...addEntry, item: { ...(addEntry.item as Extract<ReviewEntry['item'], { kind: 'added_exercise' }>), unit: 'lbs' } }, 'add_exercise')
    const [list] = h.sent
    const planned = list.slice(0, -1)
    expect(inserts(planned, 'v2_week_plan_sets')).toHaveLength(5)
    expect(inserts(planned, 'v2_program_exercises')[0].row.weight_unit).toBe('lbs')
    expect(list[list.length - 1]).toMatchObject(decision('added-ex:s-ua:e-fly'))
  })

  it('a swap whose slot this week no longer has only leaves its decision (no program change is sent)', async () => {
    const gone: ReviewEntry = { ...swapEntry, item: { ...(swapEntry.item as Extract<ReviewEntry['item'], { kind: 'swapped' }>), target: { programExerciseId: null } } }
    await run(gone, 'swap')
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toHaveLength(1)
    expect(h.sent[0][0]).toMatchObject(decision('swap:s-ua:pe-lat'))
  })
})
