import { describe, it, expect } from 'vitest'
import { draftFromRunCopy, type ProgramEdit, type RunChangeStatus } from './programChange'
import {
  type Db,
  type World,
  addExercise,
  addExerciseTo,
  addWorkout,
  applyOpsToDb,
  editSetsOf,
  inserts,
  moveExercise,
  newSet,
  newWorld,
  planOf,
  planSession,
  removeExerciseFrom,
  runCopyOf,
  setDays,
  swapExerciseIn,
} from './programChange.testutil'
import { autoCopy, weeksOfSlot, type PlannedWeekRows, type RunCopy } from '../plan/weekPlanning'

// DECISIONS 143 (Adam, 2026-10-15), end to end: a save, then the copy of the next week, over the tables the save left.
//
// Pull has a done session in week 2 and no session after it (week 3 isn't planned yet), so the save changes no session of
// Pull at all: "the save can change nothing that next week's Pull will be copied from". Next week's Pull is copied from
// that done session. The save changes the program four ways:
//   Lat Pulldown ... SWAPPED for Cable Row         → week 3 has Cable Row with Lat Pulldown's sets
//   Face Pull ...... REMOVED                       → week 3 has no Face Pull
//   Seated Row ..... kept                          → week 3 has its sets from week 2
//   EZ Curl ........ ADDED                         → week 3 has it, with no sets
// The week-dependent rule (weekPlanning.ts autoCopy) is unit-tested in weekPlanning.autoCopy.followsRunCopy.test.ts; this
// file runs it on the rows planProgramChange's ops leave.

function pullWorld(): World {
  const w = newWorld({ planningType: 'week_dependent', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'push', 'Push', 0)
  addWorkout(w, 'pull', 'Pull', 1)
  setDays(w, { monday: 'push', tuesday: 'pull' })
  addExercise(w, 'pe-bench', 'push', 'ex-bench', 0, [{ reps: '6-8' }, { reps: '6-8' }])
  addExercise(w, 'pe-pd', 'pull', 'ex-pd', 0, [{ reps: '12', warmup: true }, { reps: '8-10' }, { reps: '8-10', kind: 'dropset', stages: ['amrap'] }])
  addExercise(w, 'pe-face', 'pull', 'ex-face', 1, [{ reps: '15-20' }, { reps: '15-20' }])
  addExercise(w, 'pe-seat', 'pull', 'ex-seat', 2, [{ reps: '10-12' }, { reps: '10-12' }, { reps: '10-12' }])
  // week 2 is planned for both workouts; week 3 for Push only (Pull's week 3 is what gets copied)
  planSession(w, 'p2-push', 'push', 2)
  planSession(w, 'p2-pull', 'pull', 2)
  planSession(w, 'p3-push', 'push', 3)
  return w
}

const draftOf = (w: World): ProgramEdit => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)

const saveOf = (w: World, edit: ProgramEdit, statuses: Record<string, RunChangeStatus> = { 'p2-pull': 'done' }) => {
  const plan = planOf(w, edit, { statuses })
  return { ...plan, after: applyOpsToDb(w.db, plan.ops) }
}

// The run copy of one workout as autoCopy reads it: every row of it (the removed ones too), each with the row it replaced.
function runCopyOfWorkout(db: Db, w: World, workoutId: string): RunCopy {
  const rc = runCopyOf(db, w.programId, w.mesocycleId)
  const rows = db.v2_program_exercises.filter((e) => e.workout_day_id === workoutId)
  const ids = new Set(rows.map((e) => e.id))
  return {
    exercises: rows.map((e) => ({
      id: e.id,
      exerciseId: e.exercise_id,
      position: e.position,
      weekOnly: e.week_only,
      removedAt: e.removed_at,
      replacesProgramExerciseId: e.replaces_program_exercise_id,
    })),
    sets: rc.sets.filter((s) => ids.has(s.programExerciseId)),
  }
}

function plannedWeekRows(db: Db, planId: string): PlannedWeekRows {
  const plan = db.v2_week_plans.find((p) => p.id === planId)!
  return {
    weekNumber: plan.week_number,
    isDeload: plan.is_deload,
    exercises: db.v2_week_plan_exercises.filter((e) => e.week_plan_id === planId).map((e) => ({ id: e.program_exercise_id, position: e.position })),
    sets: db.v2_week_plan_sets
      .filter((s) => s.week_plan_id === planId)
      .map((s) => ({
        id: s.id,
        programExerciseId: s.program_exercise_id,
        setNumber: s.set_number,
        isDropset: s.is_dropset,
        parentWeekPlanSetId: s.parent_week_plan_set_id,
        stageIndex: s.stage_index,
        isWarmup: s.is_warmup,
        stageKind: s.stage_kind,
        programSetId: s.program_set_id,
      })),
  }
}

// Week 3's Pull, copied from week 2's.
function weekThree(db: Db, w: World) {
  return autoCopy({ planningType: 'week_dependent', weekNumber: 3, runCopy: runCopyOfWorkout(db, w, 'pull'), priorWeeks: [plannedWeekRows(db, 'p2-pull')] })
}

const headsOf = (r: ReturnType<typeof weekThree>, programExerciseId: string) => r.sets.filter((s) => s.programExerciseId === programExerciseId && s.parentSourceId === null)

describe('a week-dependent week copied after a save follows the run copy\'s list (DECISIONS 143)', () => {
  const edit = (w: World) => {
    let d = draftOf(w)
    d = swapExerciseIn(d, 'pull', 'pe-pd', 'ex-cable') // → a new row at the old row's place
    d = removeExerciseFrom(d, 'pull', 'pe-face')
    d = addExerciseTo(d, 'pull', { exerciseId: 'ex-curl' })
    return d
  }

  it('the save changes no session of Pull: its only session is done, so next week is where the change has to arrive', () => {
    const w = pullWorld()
    const { ops, summary } = saveOf(w, edit(w), { 'p2-pull': 'done', 'p2-push': 'done' })
    expect(summary.changedSessions).toEqual([]) // Push has no change, and Pull has no session left to start
    expect(summary.keptSessions.map((k) => [k.weekPlanId, k.status])).toEqual([['p2-pull', 'done']])
    expect(ops.some((o) => 'row' in o && (o.row as { week_plan_id?: string }).week_plan_id?.endsWith('-pull'))).toBe(false)
    expect(summary.startWeek).toBe(3) // Push's week 3 is the next session to start
  })

  it('the swap\'s new row names the row it replaced; the added row and every kept row name none', () => {
    const w = pullWorld()
    const { ops } = saveOf(w, edit(w))
    const rows = inserts(ops, 'v2_program_exercises').map((o) => [o.row.exercise_id, o.row.replaces_program_exercise_id])
    expect(rows).toEqual([['ex-cable', 'pe-pd'], ['ex-curl', null]])
  })

  it('removed: next week\'s Pull has no Face Pull and none of its sets', () => {
    const w = pullWorld()
    const { after } = saveOf(w, edit(w))
    const r = weekThree(after, w)
    expect(r.exercises.map((e) => e.programExerciseId)).not.toContain('pe-face')
    expect(r.sets.some((s) => s.programExerciseId === 'pe-face')).toBe(false)
  })

  it('kept: Seated Row is there with the three sets week 2 had, as week 2 has them (week 2\'s fourth set, added in Plan, comes along)', () => {
    const w = pullWorld()
    // week 2's Seated Row was changed in Plan after it was planned: a fourth set. The program says three.
    const extra = { ...w.db.v2_week_plan_sets.find((s) => s.id === 'p2-pull-pe-seat-s3')!, id: 'p2-pull-seat-extra', set_number: 4, program_set_id: null }
    w.db.v2_week_plan_sets.push(extra)
    const { after } = saveOf(w, edit(w))
    const r = weekThree(after, w)
    expect(headsOf(r, 'pe-seat').map((s) => [s.sourceId, s.setNumber])).toEqual([
      ['p2-pull-pe-seat-s1', 1],
      ['p2-pull-pe-seat-s2', 2],
      ['p2-pull-pe-seat-s3', 3],
      ['p2-pull-seat-extra', 4],
    ])
  })

  it('added: EZ Curl is listed, in the run copy\'s place, with no sets', () => {
    const w = pullWorld()
    const { ops, after } = saveOf(w, edit(w))
    const curl = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-curl')!.row
    const r = weekThree(after, w)
    expect(r.exercises).toContainEqual({ programExerciseId: curl.id, position: curl.position })
    expect(r.sets.some((s) => s.programExerciseId === curl.id)).toBe(false)
  })

  it('swapped: Cable Row takes Lat Pulldown\'s sets — a warmup, a working set, a dropset head and its drop — and Lat Pulldown is gone (the swap\'s new row names the row it replaced)', () => {
    const w = pullWorld()
    const d = edit(w)
    const { ops, after } = saveOf(w, d)
    const cable = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-cable')!.row
    const r = weekThree(after, w)
    expect(r.sets.filter((s) => s.programExerciseId === cable.id).map((s) => [s.sourceId, s.setNumber, s.stageIndex, s.isWarmup, s.stageKind, s.isDropset])).toEqual([
      ['p2-pull-pe-pd-s1', 1, 0, true, null, false],
      ['p2-pull-pe-pd-s2', 2, 0, false, null, false],
      ['p2-pull-pe-pd-s3', 3, 0, false, 'dropset', false],
      ['p2-pull-pe-pd-s3-t1', 3, 1, false, null, true],
    ])
    expect(r.exercises.map((e) => e.programExerciseId)).not.toContain('pe-pd')
    expect(r.sets.every((s) => s.programExerciseId !== 'pe-pd')).toBe(true)
    for (const s of r.sets) expect([s.targetWeight, s.targetRir, s.tags, s.repMin, s.repMax, s.isAmrap]).toEqual([null, null, null, null, null, false])
  })

  it('the whole week at once, in the run copy\'s order: Cable Row where Lat Pulldown was, Seated Row, EZ Curl last', () => {
    const w = pullWorld()
    const d = edit(w)
    const { ops, after } = saveOf(w, d)
    const r = weekThree(after, w)
    const idOf = (exerciseId: string) => inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === exerciseId)!.row.id
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual([idOf('ex-cable'), 'pe-seat', idOf('ex-curl')])
  })

  it('a reorder reaches next week too: Seated Row moved above Lat Pulldown in the program is above it in the copy', () => {
    const w = pullWorld()
    const { after } = saveOf(w, moveExercise(draftOf(w), 'pull', 2, 0))
    const r = weekThree(after, w)
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual(['pe-seat', 'pe-pd', 'pe-face'])
  })

  it('the same when the session is in progress, not done: the save leaves it alone too', () => {
    const w = pullWorld()
    const d = edit(w)
    const { after, summary } = saveOf(w, d, { 'p2-pull': 'in_progress' })
    expect(summary.keptSessions.map((k) => [k.weekPlanId, k.status])).toEqual([['p2-pull', 'in_progress']])
    const r = weekThree(after, w)
    expect(r.exercises).toHaveLength(3)
    expect(r.exercises.map((e) => e.programExerciseId)).not.toContain('pe-face')
  })

  it('the done session itself is exactly as it was: its Lat Pulldown and Face Pull are still on it', () => {
    const w = pullWorld()
    const { after } = saveOf(w, edit(w))
    expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'p2-pull')).toEqual(w.db.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'p2-pull'))
    expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'p2-pull')).toEqual(w.db.v2_week_plan_sets.filter((s) => s.week_plan_id === 'p2-pull'))
  })

  it('where a session could be changed the copy agrees with it: week 3 changed by the save, week 4 copied from it, is week 3\'s list', () => {
    const w = pullWorld()
    planSession(w, 'p3-pull', 'pull', 3) // week 3 is planned and not started: the save changes it
    const d = edit(w)
    const { after, summary } = saveOf(w, d)
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p3-pull'])
    const fromThree = autoCopy({ planningType: 'week_dependent', weekNumber: 4, runCopy: runCopyOfWorkout(after, w, 'pull'), priorWeeks: [plannedWeekRows(after, 'p2-pull'), plannedWeekRows(after, 'p3-pull')] })
    const fromTwo = autoCopy({ planningType: 'week_dependent', weekNumber: 4, runCopy: runCopyOfWorkout(after, w, 'pull'), priorWeeks: [plannedWeekRows(after, 'p2-pull')] })
    expect(fromThree.source).toEqual({ kind: 'week', weekNumber: 3 })
    expect(fromTwo.source).toEqual({ kind: 'week', weekNumber: 2 })
    expect(fromThree.exercises).toEqual(fromTwo.exercises)
    const shape = (r: typeof fromTwo) => r.exercises.map((e) => [e.programExerciseId, r.sets.filter((s) => s.programExerciseId === e.programExerciseId).map((s) => [s.setNumber, s.stageIndex, s.isWarmup, s.stageKind])])
    expect(shape(fromThree)).toEqual(shape(fromTwo))
  })
})

// A sequence run repeats one workout in several slots: one run copy, one history per slot (weeksOfSlot: "a slot's source is
// the same slot's last normal occurrence"). After a save every slot of the workout takes the run copy's list, and each takes
// its sets from its OWN last cycle.
describe('on a week-dependent sequence run every slot follows the one run copy, from its own last cycle (DECISIONS 143)', () => {
  // Rotation A is in slots 0 and 1 (Rotation B in slot 2); cycle 2 is planned for all three. In cycle 2 slot 0's Squat was given
  // four sets in Plan and slot 1's kept its two: the two slots hold two different histories of one exercise.
  function rotationWorld(): World {
    const w = newWorld({ planningType: 'week_dependent', scheduleType: 'sequence', currentWeek: 2 })
    addWorkout(w, 'a', 'Rotation A', 0)
    addWorkout(w, 'b', 'Rotation B', 1)
    addExercise(w, 'pe-squat', 'a', 'ex-squat', 0, [{ reps: '5' }, { reps: '5' }])
    addExercise(w, 'pe-row', 'a', 'ex-row', 1, [{ reps: '8' }, { reps: '8' }])
    addExercise(w, 'pe-bench', 'b', 'ex-bench', 0, [{ reps: '5' }, { reps: '5' }])
    planSession(w, 'c2-s0', 'a', 2, { sequencePosition: 0 })
    planSession(w, 'c2-s1', 'a', 2, { sequencePosition: 1 })
    planSession(w, 'c2-s2', 'b', 2, { sequencePosition: 2 })
    const second = w.db.v2_week_plan_sets.find((s) => s.id === 'c2-s0-pe-squat-s2')!
    for (const n of [3, 4]) w.db.v2_week_plan_sets.push({ ...second, id: `c2-s0-squat-extra-${n}`, set_number: n, program_set_id: null })
    return w
  }
  const editA = (w: World) => addExerciseTo(removeExerciseFrom(draftOf(w), 'a', 'pe-row'), 'a', { exerciseId: 'ex-curl' })

  // What the app does for one slot of Rotation A in cycle 3 (PlanPage's slotWeeks): the slot's own earlier weeks, and the one run copy.
  function cycleThree(db: Db, w: World, slot: number) {
    const all = db.v2_week_plans.map((p) => ({ id: p.id, workoutDayId: p.workout_day_id, sequencePosition: p.sequence_position }))
    const priorWeeks = weeksOfSlot(all, 'a', slot).map((p) => plannedWeekRows(db, p.id))
    return autoCopy({ planningType: 'week_dependent', weekNumber: 3, runCopy: runCopyOfWorkout(db, w, 'a'), priorWeeks })
  }
  const heads = (r: ReturnType<typeof cycleThree>, programExerciseId: string) => r.sets.filter((s) => s.programExerciseId === programExerciseId && s.parentSourceId === null)

  it('both slots are done: each has the run copy\'s list (Squat, the added Curl, no Row), and Squat has the sets of its own slot', () => {
    const w = rotationWorld()
    const { ops, after, summary } = saveOf(w, editA(w), { 'c2-s0': 'done', 'c2-s1': 'done', 'c2-s2': 'done' })
    expect(summary.changedSessions).toEqual([]) // the save changes no session: next cycle is where it has to arrive
    const curl = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-curl')!.row.id
    const slot0 = cycleThree(after, w, 0)
    const slot1 = cycleThree(after, w, 1)
    for (const r of [slot0, slot1]) {
      expect(r.source).toEqual({ kind: 'week', weekNumber: 2 })
      expect(r.exercises.map((e) => e.programExerciseId)).toEqual(['pe-squat', curl])
      expect(r.sets.some((s) => s.programExerciseId === 'pe-row')).toBe(false)
      expect(r.sets.some((s) => s.programExerciseId === curl)).toBe(false)
    }
    expect(heads(slot0, 'pe-squat').map((s) => s.sourceId)).toEqual(['c2-s0-pe-squat-s1', 'c2-s0-pe-squat-s2', 'c2-s0-squat-extra-3', 'c2-s0-squat-extra-4']) // slot 0's four
    expect(heads(slot1, 'pe-squat').map((s) => s.sourceId)).toEqual(['c2-s1-pe-squat-s1', 'c2-s1-pe-squat-s2']) // slot 1's two, not slot 0's four
  })

  it('slot 1 is not started, so the save changes its cycle-2 session: its copy and the copy of the slot the save left alone have the same list', () => {
    const w = rotationWorld()
    const { ops, after, summary } = saveOf(w, editA(w), { 'c2-s0': 'done', 'c2-s1': 'not_started', 'c2-s2': 'done' })
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['c2-s1'])
    const curl = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-curl')!.row.id
    const slot0 = cycleThree(after, w, 0)
    const slot1 = cycleThree(after, w, 1)
    expect(slot0.exercises).toEqual(slot1.exercises)
    expect(slot1.exercises.map((e) => e.programExerciseId)).toEqual(['pe-squat', curl])
    expect(heads(slot0, 'pe-squat')).toHaveLength(4)
    expect(heads(slot1, 'pe-squat')).toHaveLength(2)
  })
})

describe('a stable run needs no link: its weeks copy the run copy, which the save changed', () => {
  function stablePull(): World {
    const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
    addWorkout(w, 'pull', 'Pull', 0)
    setDays(w, { tuesday: 'pull' })
    addExercise(w, 'pe-pd', 'pull', 'ex-pd', 0, [{ reps: '12', warmup: true }, { reps: '8-10' }, { reps: '8-10', kind: 'dropset', stages: ['amrap'] }])
    addExercise(w, 'pe-face', 'pull', 'ex-face', 1, [{ reps: '15-20' }, { reps: '15-20' }])
    planSession(w, 'p2-pull', 'pull', 2)
    return w
  }

  it('removed is gone, added has the default\'s sets, swapped has the old exercise\'s sets (the new row\'s own copies of them)', () => {
    const w = stablePull()
    let d = draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), 'stable')
    d = swapExerciseIn(d, 'pull', 'pe-pd', 'ex-cable')
    d = removeExerciseFrom(d, 'pull', 'pe-face')
    d = addExerciseTo(d, 'pull', { exerciseId: 'ex-curl', sets: [newSet('10-12'), newSet('10-12')] })
    const { ops, after } = saveOf(w, d, { 'p2-pull': 'done' })
    const cable = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-cable')!.row.id
    const curl = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-curl')!.row.id
    const r = autoCopy({ planningType: 'stable', weekNumber: 3, runCopy: runCopyOfWorkout(after, w, 'pull'), priorWeeks: [plannedWeekRows(after, 'p2-pull')] })
    expect(r.source).toEqual({ kind: 'program' })
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual([cable, curl])
    expect(r.sets.filter((s) => s.programExerciseId === cable).map((s) => [s.setNumber, s.stageIndex, s.isWarmup, s.stageKind, s.isDropset])).toEqual([
      [1, 0, true, null, false],
      [2, 0, false, null, false],
      [3, 0, false, 'dropset', false],
      [3, 1, false, null, true],
    ])
    expect(r.sets.filter((s) => s.programExerciseId === curl && s.parentSourceId === null).map((s) => [s.repMin, s.repMax])).toEqual([[10, 12], [10, 12]])
    expect(r.sets.some((s) => s.programExerciseId === 'pe-face' || s.programExerciseId === 'pe-pd')).toBe(false)
  })

  it('a stable default\'s set count change reaches the copy', () => {
    const w = stablePull()
    const d = editSetsOf(draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), 'stable'), 'pull', 'pe-face', (sets) => sets.slice(0, 1))
    const { after } = saveOf(w, d, { 'p2-pull': 'done' })
    const r = autoCopy({ planningType: 'stable', weekNumber: 3, runCopy: runCopyOfWorkout(after, w, 'pull'), priorWeeks: [plannedWeekRows(after, 'p2-pull')] })
    expect(r.sets.filter((s) => s.programExerciseId === 'pe-face')).toHaveLength(1)
  })
})
