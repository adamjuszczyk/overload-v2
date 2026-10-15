import { describe, it, expect } from 'vitest'
import { changeStartWeek, draftFromRunCopy, planRowStatus, type RunChangeStatus } from './programChange'
import {
  USER,
  applyOpsToDb,
  cloneDb,
  idGen,
  inputOf,
  opsOnSession,
  planOf,
  removeExerciseFrom,
  runCopyOf,
  sessionsOf,
} from './programChange.testutil'
import { sequenceWorld, stableWorld } from './programChange.worlds.testutil'
import { planProgramChange } from './programChange'

// Chunk 45 — which sessions a save reaches (SPEC [1.2] Programs and runs → Changing a running program): "It applies to
// every session that isn't done yet, from the current week (cycle) on, including a week already planned forward. Done
// sessions keep their plan." and "'Not done' means not started: a session in progress is left exactly as it is."
// Week N for the rule box is "the week of the next session that isn't done". The fixtures put the same change on
// sessions of every status and week, so a rule that reached the wrong ones changes the answer.

describe('planRowStatus — a plan row is as done as its most-done session (G14: one workout on two weekdays shares a row)', () => {
  it('no session yet, and a session moved here and not started, are not started', () => {
    expect(planRowStatus([])).toBe('not_started')
    expect(planRowStatus(['planned'])).toBe('not_started')
  })

  it('a session in progress is in progress; completed and skipped are done', () => {
    expect(planRowStatus(['in_progress'])).toBe('in_progress')
    expect(planRowStatus(['completed'])).toBe('done')
    expect(planRowStatus(['skipped'])).toBe('done')
  })

  it('the shared row of a workout on Tuesday and Thursday: Tuesday done makes it done for Thursday too (#77)', () => {
    expect(planRowStatus(['completed', 'planned'])).toBe('done')
    expect(planRowStatus(['planned', 'completed'])).toBe('done')
    expect(planRowStatus(['in_progress', 'completed'])).toBe('done') // done wins over in progress
  })

  it('in progress wins over not started', () => {
    expect(planRowStatus(['planned', 'in_progress'])).toBe('in_progress')
    expect(planRowStatus(['in_progress', 'planned'])).toBe('in_progress')
  })
})

const at = (weekNumber: number, status: RunChangeStatus) => ({ weekNumber, status })

describe('changeStartWeek — "Week N": the week of the first session that has not started', () => {
  it('the first not-started session, whichever week it is in, and not an earlier one that is done or in progress', () => {
    expect(changeStartWeek([at(2, 'done'), at(2, 'in_progress'), at(2, 'not_started'), at(3, 'not_started')], 2)).toBe(2)
    expect(changeStartWeek([at(3, 'not_started'), at(2, 'not_started')], 2)).toBe(2) // in any order
  })

  it('a session in progress is not "not done" here: the changes start where something can change', () => {
    // Week 2's only session is in progress: nothing in week 2 can take the change, so week 3's is where it starts.
    expect(changeStartWeek([at(2, 'in_progress'), at(3, 'not_started')], 2)).toBe(3)
    expect(changeStartWeek([at(2, 'done'), at(3, 'not_started')], 2)).toBe(3)
  })

  it('a week before the current one is never "the week": a session missed there does not pull N back', () => {
    expect(changeStartWeek([at(1, 'not_started'), at(2, 'done'), at(3, 'not_started')], 2)).toBe(3)
  })

  it('nothing left to start (every session from here on is done or in progress): the week after the last one there is', () => {
    expect(changeStartWeek([at(2, 'done'), at(2, 'in_progress')], 2)).toBe(3)
    expect(changeStartWeek([at(2, 'done'), at(4, 'in_progress')], 2)).toBe(5)
    expect(changeStartWeek([], 2)).toBe(3)
  })

  it('the current week must be a whole number from 1: week 1 itself is fine, on both entry points', () => {
    expect(() => changeStartWeek([], 0)).toThrow(RangeError)
    expect(() => changeStartWeek([], 2.5)).toThrow(RangeError)
    expect(changeStartWeek([], 1)).toBe(2)
    const w = stableWorld()
    const draft = draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), 'stable')
    expect(() => planOf(w, draft, { currentWeek: 0 })).toThrow(RangeError)
    expect(() => planOf(w, draft, { currentWeek: 1.5 })).toThrow(RangeError)
    expect(planOf(w, draft, { currentWeek: 1 }).ops).toEqual([])
  })
})

describe('which sessions a save reaches — removing Incline Dumbbell Press from Full Body (stable run, current week 2)', () => {
  const world = stableWorld()
  const edit = removeExerciseFrom(draftFromRunCopy(runCopyOf(world.db, world.programId, world.mesocycleId), 'stable'), 'fb', 'pe-inc')
  // Full Body: week 1 (done, and before the current week), week 2 (the plan row Tuesday and Thursday share), week 3.
  const reached = (statuses: Record<string, RunChangeStatus>, fromWeek = 2) => {
    const { ops, summary } = planOf(world, edit, { statuses, fromWeek })
    const touched = (['p1-fb', 'p2-fb', 'p3-fb', 'p1-arms', 'p2-arms', 'p3-arms'] as const).filter((id) => opsOnSession(world.db, ops, id).length > 0)
    return { touched, summary }
  }

  it('every session that has not started, this week and a week planned forward, and no other workout\'s', () => {
    expect(reached({}).touched).toEqual(['p2-fb', 'p3-fb'])
  })

  it('a done session keeps its plan: week 2\'s row is left out, week 3 takes it', () => {
    const { touched, summary } = reached({ 'p2-fb': 'done' })
    expect(touched).toEqual(['p3-fb'])
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p3-fb'])
    expect(summary.keptSessions).toEqual([{ weekPlanId: 'p2-fb', weekNumber: 2, workoutDayId: 'fb', sequencePosition: null, status: 'done' }])
  })

  it('a session in progress is left exactly as it is', () => {
    const { touched, summary } = reached({ 'p2-fb': 'in_progress' })
    expect(touched).toEqual(['p3-fb'])
    expect(summary.keptSessions.map((k) => [k.weekPlanId, k.status])).toEqual([['p2-fb', 'in_progress']])
  })

  it('a week before the current one is never touched, even when it is passed in and has not started', () => {
    // The screen passes the current week on; a caller that passes week 1 too (not started, say a week nobody trained)
    // must not have it changed: "from the current week (cycle) on".
    const { touched } = reached({}, 1)
    expect(touched).toEqual(['p2-fb', 'p3-fb'])
  })

  it('every session done or in progress: no op on any of them, and the run copy still takes the change', () => {
    const { ops, summary } = planOf(world, edit, { statuses: { 'p2-fb': 'done', 'p3-fb': 'in_progress' } })
    expect(ops.filter((o) => o.table === 'v2_week_plan_exercises' || o.table === 'v2_week_plan_sets')).toEqual([])
    expect(ops.some((o) => o.op === 'update' && o.table === 'v2_program_exercises' && o.id === 'pe-inc')).toBe(true)
    expect(summary.changedSessions).toEqual([])
  })

  it('the rows of the sessions it leaves are byte for byte what they were after the ops are applied', () => {
    const statuses: Record<string, RunChangeStatus> = { 'p2-fb': 'in_progress' }
    const { ops } = planOf(world, edit, { statuses })
    const after = applyOpsToDb(world.db, ops)
    for (const planId of ['p1-fb', 'p2-fb', 'p1-arms', 'p2-arms', 'p3-arms']) {
      expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === planId)).toEqual(world.db.v2_week_plan_exercises.filter((e) => e.week_plan_id === planId))
      expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === planId)).toEqual(world.db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId))
    }
    expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'p3-fb').map((e) => e.program_exercise_id)).not.toContain('pe-inc')
  })
})

describe('which sessions a save reaches — one workout in three slots of a stable sequence run (cycle 2: done, in progress, not started)', () => {
  const world = sequenceWorld()
  const edit = removeExerciseFrom(draftFromRunCopy(runCopyOf(world.db, world.programId, world.mesocycleId), 'stable'), 'a', 'pe-row')
  // Rotation A is in slots 0, 1 and 3; Rotation B in slot 2. Cycle 2 is current.
  const statuses: Record<string, RunChangeStatus> = { 'c2-s0': 'done', 'c2-s1': 'in_progress' }

  it('removing an exercise deletes it from the slot not started and the cycle planned forward, and from nothing else', () => {
    const { ops, summary } = planOf(world, edit, { statuses })
    const touched = ['c2-s0', 'c2-s1', 'c2-s2', 'c2-s3', 'c3-s0', 'c3-s1', 'c3-s2', 'c3-s3'].filter((id) => opsOnSession(world.db, ops, id).length > 0)
    expect(touched).toEqual(['c2-s3', 'c3-s0', 'c3-s1', 'c3-s3']) // not the done slot, not the one in progress, not Rotation B's
    expect(summary.keptSessions.map((k) => `${k.weekPlanId}:${k.status}`)).toEqual(['c2-s0:done', 'c2-s1:in_progress'])
  })

  it('a slot is its own session: the same workout\'s other slots are not "the same row"', () => {
    const { summary } = planOf(world, edit, { statuses })
    expect(summary.changedSessions.map((s) => [s.weekNumber, s.sequencePosition])).toEqual([
      [2, 3],
      [3, 0],
      [3, 1],
      [3, 3],
    ])
  })

  it('a sequence run\'s week is its cycle: "Week N" counts cycles', () => {
    expect(planOf(world, edit, { statuses }).summary.startWeek).toBe(2) // slot 3 of cycle 2 has not started
    expect(planOf(world, edit, { statuses: { 'c2-s0': 'done', 'c2-s1': 'done', 'c2-s2': 'done', 'c2-s3': 'in_progress' } }).summary.startWeek).toBe(3)
  })
})

describe('the summary', () => {
  it('names the week the changes start, the sessions that changed, and the ones left as they are', () => {
    const world = stableWorld()
    const edit = removeExerciseFrom(draftFromRunCopy(runCopyOf(world.db, world.programId, world.mesocycleId), 'stable'), 'fb', 'pe-inc')
    const { summary } = planOf(world, edit, { statuses: { 'p2-fb': 'done' } })
    expect(summary.startWeek).toBe(2) // the Arms session of week 2 has not started: that is where something can change
    expect(summary.scheduleStartWeek).toBeNull()
    expect(summary.setsLeftAlone).toBe(0)
  })

  it('a session of a workout this save does not touch is neither changed nor kept: it is not mentioned', () => {
    const world = stableWorld()
    const edit = removeExerciseFrom(draftFromRunCopy(runCopyOf(world.db, world.programId, world.mesocycleId), 'stable'), 'fb', 'pe-inc')
    const { summary } = planOf(world, edit, { statuses: { 'p2-arms': 'done' } })
    expect(summary.keptSessions).toEqual([])
    expect(summary.changedSessions.map((s) => s.workoutDayId)).toEqual(['fb', 'fb'])
  })
})

describe('the input is never changed', () => {
  it('an input of frozen objects is accepted, and the same input gives the same answer twice', () => {
    const world = stableWorld()
    const edit = removeExerciseFrom(draftFromRunCopy(runCopyOf(world.db, world.programId, world.mesocycleId), 'stable'), 'fb', 'pe-inc')
    const frozen = JSON.parse(JSON.stringify(inputOf(world, edit, { statuses: { 'p2-fb': 'in_progress' } }))) as ReturnType<typeof inputOf>
    const deep = (v: unknown): void => {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v)
        Object.values(v as Record<string, unknown>).forEach(deep)
      }
    }
    deep(frozen)
    const input = { ...frozen, newId: idGen() }
    const first = planProgramChange(input)
    const second = planProgramChange({ ...input, newId: idGen() })
    expect(second).toEqual(first)
    expect(sessionsOf(cloneDb(world.db), world.mesocycleId)).toEqual(sessionsOf(world.db, world.mesocycleId))
    void USER
  })
})
