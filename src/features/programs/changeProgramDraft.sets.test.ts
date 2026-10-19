import { describe, expect, it } from 'vitest'
import type { DayOfWeek } from '../../types'
import type { Op, RunChangeStatus } from './programChange'
import {
  USER,
  addExercise as addExerciseRow,
  addBlock,
  addWorkout,
  applyOpsToDb,
  cloneDb,
  deletes,
  idGen,
  inputOf,
  inserts,
  newWorld,
  planOf,
  planSession,
  runCopyOf,
  setDays,
  updates,
  weekSetOf,
  type World,
} from './programChange.testutil'
import { stableWorld, unevenStableWorld, weekDependentWorld } from './programChange.worlds.testutil'
import { planProgramChange, type DraftSet } from './programChange'
import {
  addExercise,
  addSet,
  dayToggle,
  draftContent,
  draftDiffers,
  initialDraft,
  removeExercise,
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
import { newSetAfter, repTargetOf, repText, withRepTarget, withSetType } from './changeProgramSets'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { RepTarget } from '../../lib/plannerVocabulary'

// Chunk 51b: the draft's edits of a stable run's default sets, and of the weekdays. Each edit goes through the real `planProgramChange`
// (chunk 45) on a world of rows, and what it writes is read back: the sessions that have not started take the change where they still
// match the old default, and nothing else is touched. The last test walks random sequences of edits and demands that the rows a save
// leaves, read the way the screen reads them (`draftFromRunCopy`), say what the draft said.

// Full Body (Tue, Thu: one plan row) with a warmup, a dropset and plain sets; Arms (Sat). Weeks 1-3 planned from the default.
function miniWorld(): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'fb', 'Full Body', 0)
  addWorkout(w, 'arms', 'Arms', 1)
  setDays(w, { tuesday: 'fb', thursday: 'fb', saturday: 'arms' })
  addExerciseRow(w, 'pe-leg', 'fb', 'ex-leg', 0, [{ reps: '12', warmup: true }, { reps: '10-12' }, { reps: '10-12' }])
  addExerciseRow(w, 'pe-inc', 'fb', 'ex-inc', 1, [{ reps: '8-10' }, { reps: '8-10', kind: 'dropset', stages: ['6-8'] }])
  addExerciseRow(w, 'pe-curl', 'arms', 'ex-curl', 0, [{ reps: '10-12' }])
  for (const week of [1, 2, 3]) {
    planSession(w, `p${week}-fb`, 'fb', week)
    planSession(w, `p${week}-arms`, 'arms', week)
  }
  return w
}

const start = (w: World): DraftState => initialDraft(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
const plan = (w: World, s: DraftState, statuses: Record<string, RunChangeStatus> = {}) => planOf(w, s.edit, { statuses })
const NOT_STARTED = {}
const WEEK_2_DONE: Record<string, RunChangeStatus> = { 'p2-fb': 'done' }

describe('the default of a stable run in the draft', () => {
  it("every kept exercise holds its default's sets as rows, in the order the default has them, with their stages", () => {
    const w = miniWorld()
    const fb = start(w).edit.workouts[0]
    expect(fb.exercises.map((e) => e.sets?.map((s) => [s.id, repText(repTargetOf(s)), s.isWarmup, s.stages.length]))).toEqual([
      [['pe-leg-s1', '12', true, 0], ['pe-leg-s2', '10–12', false, 0], ['pe-leg-s3', '10–12', false, 0]],
      [['pe-inc-s1', '8–10', false, 0], ['pe-inc-s2', '8–10', false, 1]],
    ])
  })

  it('a week-dependent run holds none', () => {
    const w = weekDependentWorld()
    for (const wk of start(w).edit.workouts) for (const e of wk.exercises) expect(e.sets).toBeUndefined()
  })

  it('a swap carries the old exercise’s sets, and saves exactly what a swap with no sets of its own saves', () => {
    const w = miniWorld()
    const s0 = start(w)
    const swapped = swapExercise(s0, 'fb', 'e:pe-inc', 'ex-new')
    const entry = swapped.edit.workouts[0].exercises[1]
    expect(entry.kind).toBe('swapped')
    expect(entry.sets).toEqual(s0.edit.workouts[0].exercises[1].sets)
    const stripped: DraftState = {
      ...swapped,
      edit: { ...swapped.edit, workouts: swapped.edit.workouts.map((wk) => ({ ...wk, exercises: wk.exercises.map((e) => (e.kind === 'swapped' ? (({ sets: _sets, ...rest }) => rest)(e) as typeof e : e)) })) },
    }
    expect(stripped.edit.workouts[0].exercises[1].sets).toBeUndefined()
    expect(plan(w, swapped).ops).toEqual(plan(w, stripped).ops)
  })

  it("an edit made after a swap changes the new exercise's sets, and a week-dependent swap carries none", () => {
    const w = miniWorld()
    const swapped = swapExercise(start(w), 'fb', 'e:pe-inc', 'ex-new')
    const edited = setSetRepTarget(swapped, 'fb', 'e:pe-inc', 0, { type: 'number', value: 5 })
    expect(edited.edit.workouts[0].exercises[1].sets?.[0]).toMatchObject({ repMin: 5, repMax: 5 })
    // the old exercise's default is untouched, the new one's rows carry the 5 (fresh rows, linked to the old ones by `source`)
    const ops = plan(w, edited).ops
    expect(inserts(ops, 'v2_program_sets').some((o) => o.row.rep_min === 5 && o.row.rep_max === 5)).toBe(true)
    const wd = weekDependentWorld()
    expect(swapExercise(start(wd), 'pull', 'e:pe-pd', 'ex-new').edit.workouts[1].exercises[0].sets).toBeUndefined()
  })
})

describe('rep targets', () => {
  it('one set: the default’s row and the matching set of each session that has not started, where it still matches the old default', () => {
    const w = miniWorld()
    const ops = plan(w, setSetRepTarget(start(w), 'fb', 'e:pe-inc', 0, { type: 'range', min: 10, max: 12 }), WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-inc-s1', { rep_min: 10, rep_max: 12, is_amrap: false }]])
    // week 2's Full Body is done: only week 3's set is written
    expect(updates(ops, 'v2_week_plan_sets').map((o) => [o.id, o.patch])).toEqual([['p3-fb-pe-inc-s1', { rep_min: 10, rep_max: 12, is_amrap: false }]])
  })

  it('a set changed for that week only is left as it is (THIS WEEK ONLY)', () => {
    const w = miniWorld()
    const thisWeekOnly = weekSetOf(w, 'p3-fb', 'pe-inc-s1')
    thisWeekOnly.rep_min = 6
    thisWeekOnly.rep_max = 8
    const ops = plan(w, setSetRepTarget(start(w), 'fb', 'e:pe-inc', 0, { type: 'range', min: 10, max: 12 }), NOT_STARTED).ops
    expect(updates(ops, 'v2_program_sets').map((o) => o.id)).toEqual(['pe-inc-s1'])
    expect(updates(ops, 'v2_week_plan_sets').map((o) => o.id)).toEqual(['p2-fb-pe-inc-s1'])
  })

  it('ALL: every head, a warmup too, and no stage', () => {
    const w = miniWorld()
    const s = setAllRepTargets(start(w), 'fb', 'e:pe-leg', { type: 'number', value: 8 })
    expect(s.edit.workouts[0].exercises[0].sets?.map((x) => repText(repTargetOf(x)))).toEqual(['8', '8', '8'])
    const inc = setAllRepTargets(start(w), 'fb', 'e:pe-inc', { type: 'amrap' })
    const sets = inc.edit.workouts[0].exercises[1].sets!
    expect(sets.map((x) => repText(repTargetOf(x)))).toEqual(['AMRAP', 'AMRAP'])
    expect(sets[1].stages.map((st) => repText(repTargetOf(st)))).toEqual(['6–8'])
    const ops = plan(w, s, NOT_STARTED).ops
    expect(updates(ops, 'v2_program_sets').map((o) => o.id).sort()).toEqual(['pe-leg-s1', 'pe-leg-s2', 'pe-leg-s3'])
  })

  it("a stage's own target: the default's stage row and the session's matching stage", () => {
    const w = miniWorld()
    const ops = plan(w, setStageRepTarget(start(w), 'fb', 'e:pe-inc', 1, 0, { type: 'amrap' }), WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-inc-s2-t1', { rep_min: null, rep_max: null, is_amrap: true }]])
    expect(updates(ops, 'v2_week_plan_sets').map((o) => o.id)).toEqual(['p3-fb-pe-inc-s2-t1'])
  })

  it("a stage's target is that stage's alone: of three stages the second one picked changes the second only, and the set keeps its own", () => {
    const w = miniWorld()
    const three = setSetType(start(w), 'fb', 'e:pe-inc', 1, { kind: 'staged', stageKind: 'dropset', stageCount: 3, stageRestSeconds: null })
    const edited = setStageRepTarget(three, 'fb', 'e:pe-inc', 1, 1, { type: 'number', value: 5 })
    const sets = edited.edit.workouts[0].exercises[1].sets!
    // stage 1 is the default's own (6–8), stages 2 and 3 are new ones with no target of their own until one is picked
    expect(sets[1].stages.map((st) => repText(repTargetOf(st)))).toEqual(['6–8', '5', '—'])
    expect(sets.map((x) => repText(repTargetOf(x)))).toEqual(['8–10', '8–10'])
  })

  it('an index that is not a set is an error, not a silent no-op', () => {
    const w = miniWorld()
    expect(() => setSetRepTarget(start(w), 'fb', 'e:pe-inc', 5, { type: 'none' })).toThrow(RangeError)
    expect(() => setStageRepTarget(start(w), 'fb', 'e:pe-inc', 0, 0, { type: 'none' })).toThrow(RangeError)
    expect(() => removeSet(start(w), 'fb', 'e:pe-inc', -1)).toThrow(RangeError)
    expect(() => setSetRepTarget(start(w), 'fb', 'e:nope', 0, { type: 'none' })).toThrow(RangeError)
  })
})

describe('the set type', () => {
  it('Normal to Dropset: the default’s set gets its kind and a stage row, and each session that has not started the same', () => {
    const w = miniWorld()
    const s = setSetType(start(w), 'fb', 'e:pe-inc', 0, { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })
    const ops = plan(w, s, WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-inc-s1', { stage_kind: 'dropset' }]])
    const newStages = inserts(ops, 'v2_program_sets')
    expect(newStages).toHaveLength(1)
    expect(newStages[0].row).toMatchObject({ parent_program_set_id: 'pe-inc-s1', stage_index: 1, rep_min: null, rep_max: null, is_amrap: false })
    expect(updates(ops, 'v2_week_plan_sets').map((o) => [o.id, o.patch])).toEqual([['p3-fb-pe-inc-s1', { stage_kind: 'dropset' }]])
    const sessionStages = inserts(ops, 'v2_week_plan_sets')
    expect(sessionStages.map((o) => o.row.week_plan_id)).toEqual(['p3-fb'])
    expect(sessionStages[0].row).toMatchObject({ parent_week_plan_set_id: 'p3-fb-pe-inc-s1', stage_index: 1, is_dropset: true })
  })

  it('a staged set made Normal: its stage row is removed from the default (soft) and from each session (deleted)', () => {
    const w = miniWorld()
    const ops = plan(w, setSetType(start(w), 'fb', 'e:pe-inc', 1, { kind: 'normal' }), WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, Object.keys(o.patch).sort()])).toEqual(
      expect.arrayContaining([
        ['pe-inc-s2', ['stage_kind']],
        ['pe-inc-s2-t1', ['removed_at']],
      ]),
    )
    expect(ops.filter((o) => o.op === 'delete').map((o) => o.id)).toEqual(['p3-fb-pe-inc-s2-t1'])
  })

  it('Warmup: the flag on the default and on each session’s set', () => {
    const w = miniWorld()
    const ops = plan(w, setSetType(start(w), 'fb', 'e:pe-inc', 0, { kind: 'warmup' }), WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-inc-s1', { is_warmup: true }]])
    expect(updates(ops, 'v2_week_plan_sets').map((o) => [o.id, o.patch])).toEqual([['p3-fb-pe-inc-s1', { is_warmup: true }]])
  })

  it('DROPS and REST BETWEEN: more stages are inserted, the rest between is the head’s own (run-wide: no session row for it)', () => {
    const w = miniWorld()
    let s = setSetType(start(w), 'fb', 'e:pe-inc', 1, { kind: 'staged', stageKind: 'dropset', stageCount: 3, stageRestSeconds: 45 })
    const ops = plan(w, s, WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-inc-s2', { stage_rest_seconds: 45 }]])
    expect(inserts(ops, 'v2_program_sets').map((o) => o.row.stage_index)).toEqual([2, 3])
    expect(inserts(ops, 'v2_week_plan_sets').map((o) => o.row.stage_index)).toEqual([2, 3])
    expect(updates(ops, 'v2_week_plan_sets')).toEqual([])
    s = setSetType(start(w), 'fb', 'e:pe-inc', 1, { kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: null })
    expect(updates(plan(w, s, NOT_STARTED).ops, 'v2_program_sets').map((o) => o.patch)).toEqual([{ stage_kind: 'rest_pause' }])
  })
})

describe('REST AFTER, "+ SET" and REMOVE THIS SET', () => {
  it('REST AFTER is run-wide: the default’s row only, no session row', () => {
    const w = miniWorld()
    const ops = plan(w, setSetRestAfter(start(w), 'fb', 'e:pe-leg', 1, 120), NOT_STARTED).ops
    expect(ops.map((o) => [o.op, o.table, 'id' in o ? o.id : '', 'patch' in o ? o.patch : null])).toEqual([['update', 'v2_program_sets', 'pe-leg-s2', { rest_seconds: 120 }]])
  })

  it('"+ SET": a new row on the default with the last set’s target and, in each session that still has the default’s count, a new set', () => {
    const w = miniWorld()
    const ops = plan(w, addSet(start(w), 'fb', 'e:pe-leg'), WEEK_2_DONE).ops
    const program = inserts(ops, 'v2_program_sets')
    expect(program).toHaveLength(1)
    expect(program[0].row).toMatchObject({ program_exercise_id: 'pe-leg', position: 4, is_warmup: false, rep_min: 10, rep_max: 12, parent_program_set_id: null })
    const session = inserts(ops, 'v2_week_plan_sets')
    expect(session.map((o) => o.row.week_plan_id)).toEqual(['p3-fb'])
    expect(session[0].row).toMatchObject({ program_exercise_id: 'pe-leg', set_number: 4, program_set_id: program[0].row.id, rep_min: 10, rep_max: 12, target_weight: null, target_rir: null })
  })

  it('a session that no longer has the default’s count takes no new set', () => {
    const w = miniWorld()
    w.db.v2_week_plan_sets.push({ ...weekSetOf(w, 'p3-fb', 'pe-leg-s3'), id: 'p3-extra', program_set_id: null, set_number: 4 })
    const ops = plan(w, addSet(start(w), 'fb', 'e:pe-leg'), NOT_STARTED).ops
    expect(inserts(ops, 'v2_week_plan_sets').map((o) => o.row.week_plan_id)).toEqual(['p2-fb'])
  })

  it('REMOVE THIS SET: the default’s row is dropped (soft) and each session that still matches loses its set', () => {
    const w = miniWorld()
    const ops = plan(w, removeSet(start(w), 'fb', 'e:pe-leg', 2), WEEK_2_DONE).ops
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, Object.keys(o.patch)])).toEqual([['pe-leg-s3', ['removed_at']]])
    expect(ops.filter((o) => o.op === 'delete').map((o) => [o.table, o.id])).toEqual([['v2_week_plan_sets', 'p3-fb-pe-leg-s3']])
  })

  it('adding a set and removing it again is no change', () => {
    const w = miniWorld()
    const s0 = start(w)
    const s = removeSet(addSet(s0, 'fb', 'e:pe-leg'), 'fb', 'e:pe-leg', 3)
    expect(draftDiffers(s, s0)).toBe(false)
    expect(plan(w, s, NOT_STARTED).ops).toEqual([])
  })

  it('a change made and put back is no change', () => {
    const w = miniWorld()
    const s0 = start(w)
    const changed = setSetRepTarget(s0, 'fb', 'e:pe-leg', 1, { type: 'number', value: 5 })
    expect(draftDiffers(changed, s0)).toBe(true)
    expect(draftDiffers(setSetRepTarget(changed, 'fb', 'e:pe-leg', 1, { type: 'range', min: 10, max: 12 }), s0)).toBe(false)
  })
})

describe('the comparison SAVE makes between two reads of the run copy', () => {
  it('does not depend on the order the superset blocks came back in (their read has no order: 51a’s review)', () => {
    const w = miniWorld()
    addBlock(w, 'blk-b', 'fb', null, 90)
    addBlock(w, 'blk-a', 'fb', null, 60)
    w.db.v2_program_exercises.find((e) => e.id === 'pe-leg')!.superset_block_id = 'blk-b'
    w.db.v2_program_exercises.find((e) => e.id === 'pe-inc')!.superset_block_id = 'blk-a'
    const copy = runCopyOf(w.db, w.programId, w.mesocycleId)
    expect(copy.blocks.map((b) => b.id)).toEqual(['blk-b', 'blk-a'])
    const forward = initialDraft(copy, 'stable')
    const reversed = initialDraft({ ...copy, blocks: [...copy.blocks].reverse() }, 'stable')
    expect(reversed.edit.blocks.map((b) => b.id)).toEqual(['blk-a', 'blk-b'])
    expect(draftContent(reversed)).toBe(draftContent(forward))
  })
})

describe('an exercise added on a stable run (DECISIONS 171)', () => {
  it('starts with no sets, "+ SET" builds its default, and SAVE writes the rows with it and lands them in every session that has not started', () => {
    const w = miniWorld()
    let s = addExercise(start(w), 'fb', 'ex-dip', 'kg')
    expect(s.edit.workouts[0].exercises[2].sets ?? []).toEqual([])
    s = addSet(s, 'fb', s.edit.workouts[0].exercises[2].key)
    s = addSet(s, 'fb', s.edit.workouts[0].exercises[2].key)
    s = setSetRepTarget(s, 'fb', s.edit.workouts[0].exercises[2].key, 1, { type: 'range', min: 10, max: 12 })
    const ops = plan(w, s, { 'p2-fb': 'in_progress' }).ops
    const exercise = inserts(ops, 'v2_program_exercises')
    expect(exercise).toHaveLength(1)
    const rows = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(rows.map((r) => [r.program_exercise_id === exercise[0].row.id, r.position, r.rep_min, r.rep_max])).toEqual([
      [true, 1, null, null],
      [true, 2, 10, 12],
    ])
    // week 2's Full Body is in progress, week 3's has not started: only week 3 gets the exercise, with both sets linked to the default's
    expect(inserts(ops, 'v2_week_plan_exercises').map((o) => o.row.week_plan_id)).toEqual(['p3-fb'])
    const sessionRows = inserts(ops, 'v2_week_plan_sets').map((o) => o.row)
    expect(sessionRows.map((r) => [r.week_plan_id, r.set_number, r.program_set_id, r.rep_min, r.rep_max])).toEqual([
      ['p3-fb', 1, rows[0].id, null, null],
      ['p3-fb', 2, rows[1].id, 10, 12],
    ])
    // and the tables take the list
    expect(() => applyOpsToDb(cloneDb(w.db), ops)).not.toThrow()
  })

  it('removing the added exercise’s sets again lands the exercise with none', () => {
    const w = miniWorld()
    let s = addExercise(start(w), 'fb', 'ex-dip', 'kg')
    const key = s.edit.workouts[0].exercises[2].key
    s = removeSet(addSet(s, 'fb', key), 'fb', key, 0)
    const ops = plan(w, s, NOT_STARTED).ops
    expect(inserts(ops, 'v2_program_sets')).toEqual([])
    expect(inserts(ops, 'v2_week_plan_sets')).toEqual([])
    expect(inserts(ops, 'v2_week_plan_exercises')).toHaveLength(2)
  })

  it('an exercise added and removed again is simply gone, whatever sets it had', () => {
    const w = miniWorld()
    const s0 = start(w)
    let s = addExercise(s0, 'fb', 'ex-dip', 'kg')
    const key = s.edit.workouts[0].exercises[2].key
    s = removeExercise(addSet(s, 'fb', key), 'fb', key)
    expect(plan(w, s, NOT_STARTED).ops).toEqual([])
  })
})

describe('the weekdays (DECISIONS 169: the edit as it stands)', () => {
  const day = (s: DraftState, id: string): DayOfWeek[] => (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).filter((d) => s.edit.schedule[d] === id)

  it('a free day is turned on and off', () => {
    const w = miniWorld()
    let s = toggleWorkoutDay(start(w), 'arms', 'friday', true)
    expect(day(s, 'arms')).toEqual(['friday', 'saturday'])
    s = toggleWorkoutDay(s, 'arms', 'saturday', true)
    expect(day(s, 'arms')).toEqual(['friday'])
  })

  it('a day another workout holds is refused, and says whose it is', () => {
    const w = miniWorld()
    const s = start(w)
    expect(dayToggle(s, 'arms', 'thursday', true)).toEqual({ ok: false, reason: 'taken', takenBy: 'fb' })
    expect(toggleWorkoutDay(s, 'arms', 'thursday', true)).toBe(s)
  })

  it('the last day of a workout can’t be turned off, unless it never had one', () => {
    const w = miniWorld()
    const s = start(w)
    expect(dayToggle(s, 'arms', 'saturday', true)).toEqual({ ok: false, reason: 'last' })
    expect(toggleWorkoutDay(s, 'arms', 'saturday', true)).toBe(s)
    const without = { ...s, edit: { ...s.edit, schedule: { ...s.edit.schedule, saturday: null } } }
    const given = toggleWorkoutDay(without, 'arms', 'friday', false)
    expect(day(given, 'arms')).toEqual(['friday'])
    expect(day(toggleWorkoutDay(given, 'arms', 'friday', false), 'arms')).toEqual([])
  })

  it('two workouts trade days in one save: a day the first leaves is free for the second, as the edit stands (not as it was saved)', () => {
    const w = miniWorld()
    let s = start(w)
    // Full Body leaves Thursday (it keeps Tuesday); Arms takes it: refused while Full Body still holds it
    expect(dayToggle(s, 'arms', 'thursday', true).ok).toBe(false)
    s = toggleWorkoutDay(s, 'fb', 'thursday', true)
    expect(dayToggle(s, 'arms', 'thursday', true).ok).toBe(true)
    s = toggleWorkoutDay(s, 'arms', 'thursday', true)
    expect(day(s, 'fb')).toEqual(['tuesday'])
    expect(day(s, 'arms')).toEqual(['thursday', 'saturday'])
    // a day freed and taken again by the first is its own again
    expect(dayToggle(s, 'fb', 'thursday', true).ok).toBe(false)
  })

  it('a workout can move to the day another had in the same save (Full Body Tuesday ↔ Arms Saturday via free days)', () => {
    const w = miniWorld()
    let s = start(w)
    s = toggleWorkoutDay(s, 'fb', 'saturday', true) // refused: Arms has it
    expect(day(s, 'fb')).toEqual(['tuesday', 'thursday'])
    s = toggleWorkoutDay(s, 'arms', 'friday', true)
    s = toggleWorkoutDay(s, 'arms', 'saturday', true)
    s = toggleWorkoutDay(s, 'fb', 'saturday', true)
    expect(day(s, 'fb')).toEqual(['tuesday', 'thursday', 'saturday'])
    expect(day(s, 'arms')).toEqual(['friday'])
  })

  it('SAVE writes the run’s first change as from_week 1 (the old days) and from_week N+1 (the new), and the run copy’s schedule', () => {
    const w = miniWorld()
    const s = toggleWorkoutDay(toggleWorkoutDay(start(w), 'fb', 'thursday', true), 'arms', 'thursday', true)
    const ops = plan(w, s, NOT_STARTED).ops
    const rows = inserts(ops, 'v2_run_schedules').map((o) => [o.row.from_week, o.row.schedule.thursday, o.row.schedule.tuesday])
    expect(rows).toEqual([
      [1, 'fb', 'fb'],
      [3, 'arms', 'fb'],
    ])
    expect(updates(ops, 'v2_programs').map((o) => o.patch)).toEqual([{ schedule: { monday: null, tuesday: 'fb', wednesday: null, thursday: 'arms', friday: null, saturday: 'arms', sunday: null } }])
    // nothing on any session: this week's sessions keep their days
    expect(ops.some((o) => o.table.startsWith('v2_week_plan'))).toBe(false)
  })

  it('a run that already has rows only gets the new one, over the row of that week when it is already there', () => {
    const w = miniWorld()
    w.db.v2_run_schedules.push({ id: 'r1', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 1, schedule: { tuesday: 'fb', thursday: 'fb', saturday: 'arms' } })
    const s = toggleWorkoutDay(start(w), 'arms', 'friday', true)
    const first = plan(w, s, NOT_STARTED).ops
    expect(inserts(first, 'v2_run_schedules').map((o) => o.row.from_week)).toEqual([3])
    expect(updates(first, 'v2_run_schedules')).toEqual([])
    w.db.v2_run_schedules.push({ id: 'r3', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 3, schedule: { tuesday: 'fb', thursday: 'fb', saturday: 'arms', monday: 'arms' } })
    const again = plan(w, s, NOT_STARTED).ops
    expect(inserts(again, 'v2_run_schedules')).toEqual([])
    expect(updates(again, 'v2_run_schedules').map((o) => [o.id, o.patch.schedule?.friday])).toEqual([['r3', 'arms']])
  })

  it('a day toggled and put back is no change, and writes nothing', () => {
    const w = miniWorld()
    const s0 = start(w)
    const s = toggleWorkoutDay(toggleWorkoutDay(s0, 'arms', 'friday', true), 'arms', 'friday', true)
    expect(draftDiffers(s, s0)).toBe(false)
    expect(plan(w, s, NOT_STARTED).ops).toEqual([])
  })

  it('a toggle changes the draft’s content (CANCEL asks, and SAVE’s changed-elsewhere check sees the days)', () => {
    const w = miniWorld()
    const s0 = start(w)
    const s = toggleWorkoutDay(s0, 'arms', 'friday', true)
    expect(draftContent(s)).not.toBe(draftContent(s0))
  })
})

// ─── Walks ──────────────────────────────────────────────────────────────────────────────────────────────────────────

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
  { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null },
  { kind: 'staged', stageKind: 'rest_pause', stageCount: 2, stageRestSeconds: 30 },
  { kind: 'staged', stageKind: 'myo_reps', stageCount: 3, stageRestSeconds: null },
  { kind: 'staged', stageKind: 'cluster', stageCount: 1, stageRestSeconds: 45 },
] as const
const TARGETS = [
  { type: 'none' },
  { type: 'amrap' },
  { type: 'number', value: 5 },
  { type: 'number', value: 12 },
  { type: 'range', min: 8, max: 10 },
  { type: 'range', min: 10, max: 15 },
] as const

function randomEdit(s: DraftState, r: () => number, step: number): DraftState {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const wk = pick(s.edit.workouts)
  const ex = wk.exercises.length > 0 ? pick(wk.exercises) : undefined
  const sets = ex?.sets ?? []
  const index = sets.length > 0 ? Math.floor(r() * sets.length) : -1
  switch (Math.floor(r() * 14)) {
    case 0:
    case 1:
      return ex ? addSet(s, wk.id, ex.key) : s
    case 2:
      return ex && index >= 0 ? removeSet(s, wk.id, ex.key, index) : s
    case 3:
    case 4:
      return ex && index >= 0 ? setSetType(s, wk.id, ex.key, index, pick(TYPES)) : s
    case 5:
    case 6:
      return ex && index >= 0 ? setSetRepTarget(s, wk.id, ex.key, index, pick(TARGETS)) : s
    case 7:
      return ex && sets[index]?.stages.length ? setStageRepTarget(s, wk.id, ex.key, index, Math.floor(r() * sets[index].stages.length), pick(TARGETS)) : s
    case 8:
      return ex && sets.length > 0 ? setAllRepTargets(s, wk.id, ex.key, pick(TARGETS)) : s
    case 9:
      return ex && index >= 0 ? setSetRestAfter(s, wk.id, ex.key, index, r() < 0.4 ? null : 15 * (1 + Math.floor(r() * 40))) : s
    case 10:
    case 11:
      return toggleWorkoutDay(s, wk.id, pick(DAYS), true)
    case 12:
      return r() < 0.5 ? addExercise(s, wk.id, `ex-add-${step}`, 'kg') : ex ? swapExercise(s, wk.id, ex.key, `ex-swap-${step}`) : s
    default:
      return ex && r() < 0.5 ? removeExercise(s, wk.id, ex.key) : s
  }
}

// What a draft says about the default's sets and the days, without ids or keys: the reading the screen would make of the rows.
function semantic(s: DraftState, exerciseOfRow: (rowId: string) => string) {
  return {
    schedule: s.edit.schedule,
    workouts: s.edit.workouts.map((w) => ({
      id: w.id,
      exercises: w.exercises.map((e) => ({
        exercise: e.kind === 'kept' ? exerciseOfRow(e.id) : e.exerciseId,
        sets: (e.sets ?? []).map((x) => ({
          warmup: x.isWarmup,
          kind: x.stages.length > 0 ? (x.stageKind ?? 'dropset') : null,
          reps: repText(repTargetOf(x)),
          rest: x.restSeconds,
          stageRest: x.stages.length > 0 ? x.stageRestSeconds : null,
          stages: x.stages.map((st) => repText(repTargetOf(st))),
        })),
      })),
    })),
  }
}

type Shape = { kind: string | null; warmup: boolean; reps: string; stages: string[] }
type Db = ReturnType<typeof cloneDb>
const repsOf = (r: { rep_min: number | null; rep_max: number | null; is_amrap: boolean }) =>
  repText(repTargetOf({ repMin: r.rep_min, repMax: r.rep_max, isAmrap: r.is_amrap }))

// The default of a workout as the rows hold it: its live exercises in order, each with its heads and their stages.
function defaultShape(db: Db, workoutId: string) {
  const live = db.v2_program_exercises.filter((e) => e.workout_day_id === workoutId && !e.week_only && !e.removed_at).sort((a, b) => a.position - b.position)
  return {
    exercises: live.map((e) => {
      const rows = db.v2_program_sets.filter((x) => x.program_exercise_id === e.id && !x.removed_at)
      const heads = rows.filter((x) => x.parent_program_set_id === null).sort((a, b) => a.position - b.position)
      return {
        exercise: e.exercise_id,
        sets: heads.map(
          (h): Shape => {
            const stages = rows.filter((x) => x.parent_program_set_id === h.id).sort((a, b) => a.stage_index - b.stage_index)
            return { warmup: h.is_warmup, kind: stages.length > 0 ? (h.stage_kind ?? 'dropset') : null, reps: repsOf(h), stages: stages.map(repsOf) }
          },
        ),
      }
    }),
  }
}

// A planned session as the rows hold it, in the same shape.
function sessionShape(db: Db, planId: string) {
  const list = db.v2_week_plan_exercises.filter((x) => x.week_plan_id === planId).sort((a, b) => a.position - b.position)
  return {
    exercises: list.map((x) => {
      const row = db.v2_program_exercises.find((e) => e.id === x.program_exercise_id)!
      const rows = db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId && s.program_exercise_id === row.id)
      const heads = rows.filter((s) => s.parent_week_plan_set_id === null).sort((a, b) => a.set_number - b.set_number)
      return {
        exercise: row.exercise_id,
        sets: heads.map(
          (h): Shape => {
            const stages = rows.filter((s) => s.parent_week_plan_set_id === h.id).sort((a, b) => a.stage_index - b.stage_index)
            return { warmup: h.is_warmup, kind: stages.length > 0 ? (h.stage_kind ?? 'dropset') : null, reps: repsOf(h), stages: stages.map(repsOf) }
          },
        ),
      }
    }),
  }
}

describe('random walks on a stable run', () => {
  it('every state of 100 walks of 25 edits is a draft the planner accepts and the tables take, and the rows a save leaves read back as the draft', () => {
    const w = miniWorld()
    const exerciseOfRow = (id: string) => w.db.v2_program_exercises.find((e) => e.id === id)!.exercise_id
    for (let walk = 0; walk < 100; walk++) {
      const r = rng(walk + 101)
      let s = start(w)
      for (let step = 0; step < 25; step++) {
        s = randomEdit(s, r, step)
        let ops: Op[] = []
        try {
          ops = planProgramChange({ ...inputOf(w, s.edit, { statuses: { 'p2-fb': 'done' } }), newId: idGen(`w${walk}s${step}-`) }).ops
          applyOpsToDb(cloneDb(w.db), ops)
        } catch (e) {
          throw new Error(`walk ${walk}, step ${step}: ${(e as Error).message}`)
        }
      }
      // the rows after the last save, read the way the screen reads the run copy
      const ops = planProgramChange({ ...inputOf(w, s.edit, { statuses: { 'p2-fb': 'done' } }), newId: idGen(`w${walk}-`) }).ops
      const after = applyOpsToDb(cloneDb(w.db), ops)
      const reread = initialDraft(runCopyOf(after, w.programId, w.mesocycleId), 'stable')
      const expected = semantic(s, exerciseOfRow)
      const exerciseOfAfter = (id: string) => after.v2_program_exercises.find((e) => e.id === id)!.exercise_id
      expect({ walk, ...semantic(reread, exerciseOfAfter) }).toEqual({ walk, ...expected })
      // and week 3, which has not started and was copied from the default, holds the new default exactly: the same exercises in the same
      // order, each with the default's sets (shapes only: week 3 keeps its weights)
      for (const [plan, workout] of [['p3-fb', 'fb'], ['p3-arms', 'arms']] as const) {
        expect({ walk, plan, ...sessionShape(after, plan) }).toEqual({ walk, plan, ...defaultShape(after, workout) })
      }
    }
  })
})

describe('a week-dependent run takes the day toggles too', () => {
  it('Tuesday’s Pull moves to Wednesday: the same rows, and no session row', () => {
    const w = weekDependentWorld()
    let s = initialDraft(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
    s = toggleWorkoutDay(toggleWorkoutDay(s, 'pull', 'wednesday', true), 'pull', 'tuesday', true)
    const ops = planOf(w, s.edit).ops
    expect(inserts(ops, 'v2_run_schedules').map((o) => [o.row.from_week, o.row.schedule.wednesday ?? null])).toEqual([
      [1, null],
      [3, 'pull'],
    ])
    expect(ops.some((o) => o.table.startsWith('v2_week_plan'))).toBe(false)
  })

  it('and the stable world’s Full Body keeps Tuesday and Thursday when it takes Wednesday', () => {
    const w = stableWorld()
    const s = toggleWorkoutDay(initialDraft(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType), 'fb', 'wednesday', true)
    expect(Object.entries(s.edit.schedule).filter(([, v]) => v === 'fb').map(([d]) => d)).toEqual(['tuesday', 'wednesday', 'thursday'])
  })
})

// ─── Which set, in which exercise, of which workout (chunk 51b review 1) ─────────────────────────────────────────────────
// The first version of these tests ran every set edit on Full Body (the first workout) and every REMOVE THIS SET on the last set of an
// exercise, so six writers could pick the wrong set or the wrong workout and still pass (RULES.md, "A writer that takes an item's place
// and a selected container"). The fixture here has two workouts with two exercises of three sets each and no two sets alike, and each
// edit is run on the first, a middle and the last set of each exercise of each workout. What it should have done is written beside it by
// plain array operations on a copy of the draft (`expectedAfter`): the walk at the end does the same on random sequences.

interface Place {
  workoutId: string
  key: string
  row: string
  name: string
}
const PLACES: readonly Place[] = [
  { workoutId: 'fb', key: 'e:pe-leg', row: 'pe-leg', name: 'Full Body, Leg Press' },
  { workoutId: 'fb', key: 'e:pe-inc', row: 'pe-inc', name: 'Full Body, Incline Press' },
  { workoutId: 'arms', key: 'e:pe-curl', row: 'pe-curl', name: 'Arms, Cable Curl' },
  { workoutId: 'arms', key: 'e:pe-dip', row: 'pe-dip', name: 'Arms, Dip' },
]
const POSITIONS = [0, 1, 2] as const
const entryOf = (s: DraftState, t: Place) => s.edit.workouts.find((x) => x.id === t.workoutId)!.exercises.find((e) => e.key === t.key)!
const setsOfTarget = (s: DraftState, t: Place): readonly DraftSet[] => entryOf(s, t).sets ?? []

// The draft the edit should leave: a copy of `before` in which the named exercise's sets went through `change`, plain arrays and indexes.
function expectedAfter(before: DraftState, t: Place, change: (sets: DraftSet[]) => DraftSet[]): DraftState {
  const copy = structuredClone(before)
  const entry = entryOf(copy, t)
  entry.sets = change([...(entry.sets ?? [])])
  return copy
}
const at = (sets: DraftSet[], i: number, fn: (s: DraftSet) => DraftSet): DraftSet[] => sets.map((s, j) => (j === i ? fn(s) : s))

// Distinct answers, so that the answer of one place can't be taken for another's.
const STAGED_TYPES: readonly SetType[] = [
  { kind: 'staged', stageKind: 'dropset', stageCount: 2, stageRestSeconds: null },
  { kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: 20 },
  { kind: 'warmup' },
  { kind: 'staged', stageKind: 'cluster', stageCount: 3, stageRestSeconds: 30 },
  { kind: 'normal' },
]
const REP_ANSWERS: readonly RepTarget[] = [
  { type: 'number', value: 6 },
  { type: 'range', min: 5, max: 7 },
  { type: 'amrap' },
  { type: 'none' },
  { type: 'range', min: 12, max: 15 },
  { type: 'number', value: 20 },
]

describe('a set edit changes the set it names, in the exercise and the workout it names, and nothing else (review 1)', () => {
  const w = unevenStableWorld()
  const base = start(w)

  it('the fixture: two workouts, two exercises each, three sets each, and no two sets of an exercise alike', () => {
    expect(base.edit.workouts.map((x) => x.id)).toEqual(['fb', 'arms'])
    for (const t of PLACES) {
      const sets = setsOfTarget(base, t)
      expect(sets.map((s) => s.id)).toEqual([1, 2, 3].map((n) => `${t.row}-s${n}`))
      const shapes = sets.map((s) => JSON.stringify([s.repMin, s.repMax, s.isAmrap, s.restSeconds, s.stages.length, s.stageKind]))
      expect(new Set(shapes).size).toBe(3)
    }
  })

  it('REMOVE THIS SET: the set at that place goes, whether it is the first, a middle one or the last', () => {
    for (const t of PLACES) {
      for (const i of POSITIONS) {
        const after = removeSet(base, t.workoutId, t.key, i)
        const left = setsOfTarget(after, t).map((s) => s.id)
        expect({ t: t.name, i, left }).toEqual({ t: t.name, i, left: [1, 2, 3].map((n) => `${t.row}-s${n}`).filter((_, j) => j !== i) })
        expect({ t: t.name, i, after }).toEqual({ t: t.name, i, after: expectedAfter(base, t, (sets) => [...sets.slice(0, i), ...sets.slice(i + 1)]) })
      }
    }
  })

  it('"+ SET": a Normal set after the exercise’s last set, with that set’s rep target (a staged last set gives its own)', () => {
    for (const t of PLACES) {
      const after = addSet(base, t.workoutId, t.key)
      expect({ t: t.name, after }).toEqual({ t: t.name, after: expectedAfter(base, t, (sets) => [...sets, newSetAfter(sets[sets.length - 1])]) })
      const sets = setsOfTarget(after, t)
      expect({ t: t.name, text: repText(repTargetOf(sets[3])) }).toEqual({ t: t.name, text: repText(repTargetOf(sets[2])) })
    }
    // the last set of Dip is a staged one at 5: the new set has its 5, not its stage's 3
    expect(repText(repTargetOf(setsOfTarget(addSet(base, 'arms', 'e:pe-dip'), PLACES[3])[3]))).toBe('5')
  })

  it('the set type: the set at that place takes the answer, a different one for every place', () => {
    PLACES.forEach((t, n) => {
      for (const i of POSITIONS) {
        const type = STAGED_TYPES[(n * 3 + i) % STAGED_TYPES.length]
        const after = setSetType(base, t.workoutId, t.key, i, type)
        expect({ t: t.name, i, after }).toEqual({ t: t.name, i, after: expectedAfter(base, t, (sets) => at(sets, i, (s) => withSetType(s, type))) })
      }
    })
  })

  it('a rep target: the set at that place takes the answer, a different one for every place, and its stages keep theirs', () => {
    PLACES.forEach((t, n) => {
      for (const i of POSITIONS) {
        const target = REP_ANSWERS[(n * 3 + i) % REP_ANSWERS.length]
        const after = setSetRepTarget(base, t.workoutId, t.key, i, target)
        expect({ t: t.name, i, after }).toEqual({ t: t.name, i, after: expectedAfter(base, t, (sets) => at(sets, i, (s) => withRepTarget(s, target))) })
      }
    })
  })

  it('a stage’s rep target: the stage at that place of the set at that place, of three stages each', () => {
    PLACES.forEach((t, n) => {
      for (const i of POSITIONS) {
        // the set at `i` is made a staged one with three stages (it may have had none or one), so every place of a stage can be named
        const staged = setSetType(base, t.workoutId, t.key, i, { kind: 'staged', stageKind: 'dropset', stageCount: 3, stageRestSeconds: null })
        for (const stage of POSITIONS) {
          const target = REP_ANSWERS[(n + i + stage) % REP_ANSWERS.length]
          const after = setStageRepTarget(staged, t.workoutId, t.key, i, stage, target)
          const want = expectedAfter(staged, t, (sets) => at(sets, i, (s) => ({ ...s, stages: s.stages.map((g, k) => (k === stage ? withRepTarget(g, target) : g)) })))
          expect({ t: t.name, i, stage, after }).toEqual({ t: t.name, i, stage, after: want })
        }
      }
    })
  })

  it('a stage’s rep target on a set that has stages of its own, not the last set: Incline Press set 02 and the other places', () => {
    const t = PLACES[1]
    expect(setsOfTarget(base, t)[1].stages).toHaveLength(1)
    const after = setStageRepTarget(base, t.workoutId, t.key, 1, 0, { type: 'amrap' })
    expect(after).toEqual(expectedAfter(base, t, (sets) => at(sets, 1, (s) => ({ ...s, stages: [{ ...s.stages[0], repMin: null, repMax: null, isAmrap: true }] }))))
    // the last set's stage (Dip's set 03) is the other end
    const dip = PLACES[3]
    const last = setStageRepTarget(base, dip.workoutId, dip.key, 2, 0, { type: 'number', value: 9 })
    expect(last).toEqual(expectedAfter(base, dip, (sets) => at(sets, 2, (s) => ({ ...s, stages: [{ ...s.stages[0], repMin: 9, repMax: 9, isAmrap: false }] }))))
  })

  it('ALL: every set of the exercise named, a warmup too, and no stage; no other exercise', () => {
    PLACES.forEach((t, n) => {
      const target = REP_ANSWERS[n % REP_ANSWERS.length]
      const after = setAllRepTargets(base, t.workoutId, t.key, target)
      expect({ t: t.name, after }).toEqual({ t: t.name, after: expectedAfter(base, t, (sets) => sets.map((s) => withRepTarget(s, target))) })
    })
  })

  it('REST AFTER: the set at that place takes the seconds and a null puts it back on the chain', () => {
    PLACES.forEach((t, n) => {
      for (const i of POSITIONS) {
        const seconds = 30 + 15 * (n * 3 + i)
        const after = setSetRestAfter(base, t.workoutId, t.key, i, seconds)
        expect({ t: t.name, i, after }).toEqual({ t: t.name, i, after: expectedAfter(base, t, (sets) => at(sets, i, (s) => ({ ...s, restSeconds: seconds }))) })
        const cleared = setSetRestAfter(after, t.workoutId, t.key, i, null)
        expect({ t: t.name, i, cleared }).toEqual({ t: t.name, i, cleared: expectedAfter(base, t, (sets) => at(sets, i, (s) => ({ ...s, restSeconds: null }))) })
      }
    })
  })

  it('an edit names an exercise of the workout it names: the other workout’s exercise with that key is not found', () => {
    expect(() => addSet(base, 'arms', 'e:pe-leg')).toThrow(RangeError)
    expect(() => removeSet(base, 'fb', 'e:pe-dip', 0)).toThrow(RangeError)
    expect(() => setSetRestAfter(base, 'fb', 'e:pe-curl', 0, 15)).toThrow(RangeError)
    expect(() => setAllRepTargets(base, 'nobody', 'e:pe-leg', { type: 'none' })).toThrow(RangeError)
  })
})

describe('REMOVE THIS SET through the planner and the tables: the set named goes from the default and from each session that still matches, the others stay (review 1, P1)', () => {
  const FIRST_EXERCISE = [PLACES[0], PLACES[2]] as const
  const PLACE_NAME = ['first', 'middle', 'last'] as const
  it.each(FIRST_EXERCISE.flatMap((t) => POSITIONS.map((i) => ({ name: t.name, t, i, title: PLACE_NAME[i] }))))('$name: the $title set of three', ({ t, i }) => {
    const world = unevenStableWorld()
    const before = start(world)
    const gone = `${t.row}-s${i + 1}`
    const ops = plan(world, removeSet(before, t.workoutId, t.key, i), NOT_STARTED).ops
    // the default: exactly that row, soft-removed
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, Object.keys(o.patch)])).toEqual([[gone, ['removed_at']]])
    // the sessions: weeks 2 and 3 of the workout lose exactly that program set's row, nothing else
    expect(deletes(ops, 'v2_week_plan_sets').map((o) => o.id).sort()).toEqual([`p2-${t.workoutId}-${gone}`, `p3-${t.workoutId}-${gone}`].sort())
    expect(ops.filter((o) => o.op === 'insert')).toEqual([])
    const after = applyOpsToDb(cloneDb(world.db), ops)
    // the default: the row is removed and the others are live
    const live = after.v2_program_sets.filter((r) => r.program_exercise_id === t.row && r.parent_program_set_id === null && !r.removed_at).map((r) => r.id)
    expect(live).toEqual([1, 2, 3].map((n) => `${t.row}-s${n}`).filter((id) => id !== gone))
    // the sessions that matched: the same, and the places the others held are kept (chunk 45's placeInOrder leaves a gap, as 1.1's Plan delete does)
    for (const plan3 of [`p2-${t.workoutId}`, `p3-${t.workoutId}`]) {
      const rows = after.v2_week_plan_sets.filter((r) => r.week_plan_id === plan3 && r.program_exercise_id === t.row).sort((a, b) => a.set_number - b.set_number)
      expect(rows.map((r) => [r.set_number, r.program_set_id])).toEqual([1, 2, 3].filter((n) => n !== i + 1).map((n) => [n, `${t.row}-s${n}`]))
    }
    // what the screen would read back is the draft: the remaining sets, in order
    const reread = initialDraft(runCopyOf(after, world.programId, world.mesocycleId), 'stable')
    expect(setsOfTarget(reread, t).map((s) => s.id)).toEqual([1, 2, 3].map((n) => `${t.row}-s${n}`).filter((id) => id !== gone))
    // every other exercise of the run, and the other workout's sessions, are exactly as they were
    for (const other of PLACES.filter((x) => x.row !== t.row)) expect(setsOfTarget(reread, other)).toEqual(setsOfTarget(before, other))
    const otherPlan = t.workoutId === 'fb' ? 'arms' : 'fb'
    for (const p of [1, 2, 3]) expect(after.v2_week_plan_sets.filter((r) => r.week_plan_id === `p${p}-${otherPlan}`)).toEqual(world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === `p${p}-${otherPlan}`))
    // a done week is not written: the first week's rows are all still there
    expect(after.v2_week_plan_sets.filter((r) => r.week_plan_id === `p1-${t.workoutId}` && r.program_exercise_id === t.row)).toHaveLength(3)
  })
})

describe('REMOVE THIS SET on a middle set with a warmup in front (review 1, P1)', () => {
  // the warmup is place 0 of the heads, "02" the working set at place 1; sets 2 and 3 differ, so which one is removed shows
  function warmupFirstWorld(): World {
    const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
    addWorkout(w, 'fb', 'Full Body', 0)
    addWorkout(w, 'arms', 'Arms', 1)
    setDays(w, { tuesday: 'fb', thursday: 'fb', saturday: 'arms' })
    addExerciseRow(w, 'pe-leg', 'fb', 'ex-leg', 0, [{ reps: '12', warmup: true }, { reps: '10-12' }, { reps: '6-8', rest: 150 }])
    addExerciseRow(w, 'pe-inc', 'fb', 'ex-inc', 1, [{ reps: '8-10' }, { reps: '8-10', kind: 'dropset', stages: ['6-8'] }])
    for (const week of [1, 2, 3]) {
      planSession(w, `p${week}-fb`, 'fb', week)
      planSession(w, `p${week}-arms`, 'arms', week)
    }
    return w
  }

  it('removing Leg Press set 02 (place 1 of the heads) drops 02 and keeps the warmup and 03, in the draft, the default and each matching session', () => {
    const w = warmupFirstWorld()
    const s = removeSet(start(w), 'fb', 'e:pe-leg', 1)
    const leg = s.edit.workouts[0].exercises[0].sets!
    expect(leg.map((x) => x.id)).toEqual(['pe-leg-s1', 'pe-leg-s3'])
    const ops = planProgramChange({ ...inputOf(w, s.edit, { statuses: { 'p2-fb': 'done' } }), newId: idGen('p1-') }).ops
    const after = applyOpsToDb(cloneDb(w.db), ops)
    expect(after.v2_program_sets.find((r) => r.id === 'pe-leg-s2')!.removed_at).not.toBeNull()
    expect(after.v2_program_sets.find((r) => r.id === 'pe-leg-s3')!.removed_at).toBeNull()
    expect(after.v2_program_sets.find((r) => r.id === 'pe-leg-s3')!.position).toBe(3) // a removal leaves a gap (chunk 45's placeInOrder), as 1.1's removeSet does
    // week 3 (not started) lost its set 02 and kept the warmup and 03; week 2 (done) is untouched
    const week3 = after.v2_week_plan_sets.filter((r) => r.week_plan_id === 'p3-fb' && r.program_exercise_id === 'pe-leg').sort((a, b) => a.set_number - b.set_number)
    expect(week3.map((r) => [r.set_number, r.program_set_id, r.is_warmup, repText(repTargetOf({ repMin: r.rep_min, repMax: r.rep_max, isAmrap: r.is_amrap }))])).toEqual([
      [1, 'pe-leg-s1', true, '12'],
      [3, 'pe-leg-s3', false, '6–8'],
    ])
    expect(after.v2_week_plan_sets.filter((r) => r.week_plan_id === 'p2-fb' && r.program_exercise_id === 'pe-leg').map((r) => r.program_set_id).sort()).toEqual(['pe-leg-s1', 'pe-leg-s2', 'pe-leg-s3'])
    // read back as the screen reads the run copy
    const back = initialDraft(runCopyOf(after, w.programId, w.mesocycleId), 'stable').edit.workouts[0].exercises[0].sets!
    expect(back.map((x) => [x.id, repText(repTargetOf(x)), x.restSeconds])).toEqual([
      ['pe-leg-s1', '12', null],
      ['pe-leg-s3', '6–8', 150],
    ])
  })
})

// ─── A walk against a plain model ────────────────────────────────────────────────────────────────────────────────────────
// The walk above ("random walks on a stable run") keeps its expectation in the draft the edits made, so it proves the planner and the
// tables and not which set an edit picked. This one builds its expectation beside every step with plain array operations and compares
// the whole draft after the step: a set edit that lands on another set, another exercise or the other workout fails at once.

interface Step {
  next: DraftState
  want: DraftState
  what: string
  kind: string
  place: string
}

function modelEdit(s: DraftState, r: () => number, step: number): Step {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const workout = pick(s.edit.workouts)
  const entry = pick(workout.exercises)
  const t: Place = { workoutId: workout.id, key: entry.key, row: '', name: `${workout.id}/${entry.key}` }
  const sets = [...(entry.sets ?? [])]
  const i = sets.length > 0 ? Math.floor(r() * sets.length) : -1
  const done = (kind: string, place: number | null, what: string, next: DraftState, want: DraftState): Step => ({ kind, place: `${t.name}#${place ?? '-'}`, what, next, want })
  switch (Math.floor(r() * 8)) {
    case 0:
      return done('add', null, `+ SET on ${t.name}`, addSet(s, t.workoutId, t.key), expectedAfter(s, t, (xs) => [...xs, newSetAfter(xs[xs.length - 1])]))
    case 1:
      if (i < 0) break
      return done('remove', i, `remove ${i} of ${t.name}`, removeSet(s, t.workoutId, t.key, i), expectedAfter(s, t, (xs) => [...xs.slice(0, i), ...xs.slice(i + 1)]))
    case 2: {
      if (i < 0) break
      const type = pick(STAGED_TYPES)
      return done('type', i, `type ${JSON.stringify(type)} on ${i} of ${t.name}`, setSetType(s, t.workoutId, t.key, i, type), expectedAfter(s, t, (xs) => at(xs, i, (x) => withSetType(x, type))))
    }
    case 3: {
      if (i < 0) break
      const target = pick(REP_ANSWERS)
      return done('reps', i, `reps ${JSON.stringify(target)} on ${i} of ${t.name}`, setSetRepTarget(s, t.workoutId, t.key, i, target), expectedAfter(s, t, (xs) => at(xs, i, (x) => withRepTarget(x, target))))
    }
    case 4: {
      if (i < 0 || sets[i].stages.length === 0) break
      const stage = Math.floor(r() * sets[i].stages.length)
      const target = pick(REP_ANSWERS)
      return done(
        `stage ${stage}`,
        i,
        `stage ${stage} ${JSON.stringify(target)} on ${i} of ${t.name}`,
        setStageRepTarget(s, t.workoutId, t.key, i, stage, target),
        expectedAfter(s, t, (xs) => at(xs, i, (x) => ({ ...x, stages: x.stages.map((g, k) => (k === stage ? withRepTarget(g, target) : g)) }))),
      )
    }
    case 5: {
      if (sets.length === 0) break
      const target = pick(REP_ANSWERS)
      return done('all', null, `ALL ${JSON.stringify(target)} on ${t.name}`, setAllRepTargets(s, t.workoutId, t.key, target), expectedAfter(s, t, (xs) => xs.map((x) => withRepTarget(x, target))))
    }
    case 6: {
      if (i < 0) break
      const seconds = r() < 0.3 ? null : 15 * (1 + Math.floor(r() * 40))
      return done('rest', i, `rest ${String(seconds)} on ${i} of ${t.name}`, setSetRestAfter(s, t.workoutId, t.key, i, seconds), expectedAfter(s, t, (xs) => at(xs, i, (x) => ({ ...x, restSeconds: seconds }))))
    }
    default:
      break
  }
  // a step that changes the exercises themselves, so that the walk also edits added entries (they hold no sets until "+ SET")
  if (step % 7 === 3) {
    const next = addExercise(s, workout.id, `ex-add-${step}`, 'kg')
    return done('exercise', null, `add an exercise to ${workout.id}`, next, structuredClone(next))
  }
  return done('nothing', null, 'nothing', s, s)
}

describe('a walk of set edits against a plain model: after every step the draft is the model’s (review 1)', () => {
  it('300 walks of 25 steps over both workouts, every exercise and every place', () => {
    const w = unevenStableWorld()
    const seen = new Set<string>()
    const kinds = new Map<string, number>()
    for (let walk = 0; walk < 300; walk++) {
      const r = rng(walk + 7001)
      let s = start(w)
      for (let step = 0; step < 25; step++) {
        const { next, want, what, kind, place } = modelEdit(s, r, step)
        expect({ walk, step, what, state: next }).toEqual({ walk, step, what, state: want })
        s = next
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
        seen.add(`${kind} ${place}`)
      }
    }
    // the walk reached what it is for: every kind of edit many times, and each of them at every place of every original exercise
    for (const kind of ['add', 'remove', 'type', 'reps', 'stage 0', 'all', 'rest']) expect({ kind, n: (kinds.get(kind) ?? 0) > 100 }).toEqual({ kind, n: true })
    for (const t of PLACES) {
      for (const i of POSITIONS) for (const kind of ['remove', 'type', 'reps', 'rest']) expect({ combo: `${kind} ${t.name}#${i}`, seen: seen.has(`${kind} ${t.workoutId}/${t.key}#${i}`) }).toEqual({ combo: `${kind} ${t.name}#${i}`, seen: true })
      for (const kind of ['add', 'all']) expect({ combo: `${kind} ${t.name}`, seen: seen.has(`${kind} ${t.workoutId}/${t.key}#-`) }).toEqual({ combo: `${kind} ${t.name}`, seen: true })
    }
  })
})
