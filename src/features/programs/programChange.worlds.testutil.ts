// The worlds chunk 45's tests run on (rows as the tables hold them; programChange.testutil.ts builds and executes them).
// Not a test file and imported by nothing in the app.
//
//   stableWorld ........ the seed's staging-stable run: STG Full Body (Full Body on Tuesday and Thursday, one plan row
//                        for both: G14; Arms on Saturday), a stable run in week 2, weeks 1-3 planned. Week 1 is done in
//                        the tests that say so.
//   weekDependentWorld . TASKS-1.2's F1-a shape: Push (Monday), Pull (Tuesday: a warmup, a working set, a dropset head
//                        with an AMRAP drop; Face Pull x2) and Legs (Thursday), a week-dependent run in week 2, weeks 2
//                        and 3 planned. Each workout is one plan row, so "Monday done, Tuesday in progress, Thursday
//                        not started" is three plan rows with three statuses.
//   sequenceWorld ...... a stable SEQUENCE run, slots A, A, B, A in a cycle: one workout in three slots with three
//                        statuses in cycle 2 (TASKS 45's "Monday done, Tuesday in progress, Thursday not started" as
//                        sessions of ONE workout), cycle 3 planned forward.
//   unevenStableWorld .. (chunk 51b's retry) a stable weekday run for the tests of WHICH set an edit lands on: two workouts
//                        (Full Body on Tuesday and Thursday, one plan row; Arms on Saturday), each with two exercises of
//                        THREE sets, and no two sets alike in a column a set edit writes (rep target, rest after, kind,
//                        stages), so an edit that lands on another set, another exercise or the other workout shows in
//                        what it writes. Weeks 1-3 planned from the default, the run in week 2.
//   unevenWorkoutsWorld  (DECISIONS 176's tests-only follow-up) four workouts, each unlike the others, for the tests of WHICH
//                        workout an exercise-level edit of CHANGE THE PROGRAM lands on (UNEVEN_WORKOUTS says what is in them): a
//                        different number of exercises, a superset of two or three members in a different place, a routine of two
//                        to four items, and no two exercises alike in a column an exercise edit writes (rest, rest after, tempo,
//                        unit), so an edit that lands on another workout, another exercise or another place is a different list
//                        of ops. A weekday run on Monday, Tuesday, Thursday and Saturday (or a sequence run with one slot each),
//                        weeks 2 and 3 (cycles 2 and 3) planned, the run in week 2.

import type { PlanningType, ScheduleType, WeightUnit } from '../../types'
import {
  type World,
  addBlock,
  addExercise,
  addRoutine,
  addWorkout,
  newWorld,
  planSession,
  setDays,
} from './programChange.testutil'

export function stableWorld(): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'fb', 'Full Body', 0)
  addWorkout(w, 'arms', 'Arms', 1)
  setDays(w, { tuesday: 'fb', thursday: 'fb', saturday: 'arms' })
  addExercise(w, 'pe-leg', 'fb', 'ex-leg', 0, [{ reps: '10-12' }, { reps: '10-12' }, { reps: '10-12' }])
  addExercise(w, 'pe-inc', 'fb', 'ex-inc', 1, [{ reps: '8-10' }, { reps: '8-10' }])
  addBlock(w, 'blk', 'fb', null, 90)
  addExercise(w, 'pe-lat', 'fb', 'ex-lat', 2, [{ reps: '10-12' }, { reps: '10-12' }], { superset_block_id: 'blk' })
  addExercise(w, 'pe-plank', 'fb', 'ex-plank', 3, [{ reps: 'amrap' }, { reps: 'amrap' }], { superset_block_id: 'blk' })
  addExercise(w, 'pe-curl', 'arms', 'ex-curl', 0, [{ reps: '10-12' }, { reps: '10-12', kind: 'dropset', stages: ['8-10'] }])
  addExercise(w, 'pe-dip', 'arms', 'ex-dip', 1, [{ reps: '8-12' }, { reps: '8-12' }])
  addRoutine(w, 'fb', ['Band pull-aparts', 'Dead hang'])
  for (const week of [1, 2, 3]) {
    planSession(w, `p${week}-fb`, 'fb', week)
    planSession(w, `p${week}-arms`, 'arms', week)
  }
  return w
}

export function weekDependentWorld(): World {
  const w = newWorld({ planningType: 'week_dependent', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'push', 'Push', 0)
  addWorkout(w, 'pull', 'Pull', 1)
  addWorkout(w, 'legs', 'Legs', 2)
  setDays(w, { monday: 'push', tuesday: 'pull', thursday: 'legs' })
  addExercise(w, 'pe-bench', 'push', 'ex-bench', 0, [{ reps: '6-8' }, { reps: '6-8' }, { reps: '6-8' }])
  addExercise(w, 'pe-pd', 'pull', 'ex-pd', 0, [
    { reps: '12', warmup: true },
    { reps: '8-10' },
    { reps: '8-10', kind: 'dropset', stages: ['amrap'] },
  ])
  addExercise(w, 'pe-face', 'pull', 'ex-face', 1, [{ reps: '15-20' }, { reps: '15-20' }])
  addExercise(w, 'pe-squat', 'legs', 'ex-squat', 0, [{ reps: '5' }, { reps: '5' }, { reps: '5' }])
  addRoutine(w, 'pull', ['Band pull-aparts'])
  for (const week of [2, 3]) {
    planSession(w, `p${week}-push`, 'push', week)
    planSession(w, `p${week}-pull`, 'pull', week)
    planSession(w, `p${week}-legs`, 'legs', week)
  }
  return w
}

export function sequenceWorld(): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'sequence', currentWeek: 2 })
  addWorkout(w, 'a', 'Rotation A', 0)
  addWorkout(w, 'b', 'Rotation B', 1)
  addExercise(w, 'pe-squat', 'a', 'ex-squat', 0, [{ reps: '5' }, { reps: '5' }])
  addExercise(w, 'pe-row', 'a', 'ex-row', 1, [{ reps: '8' }, { reps: '8' }])
  addExercise(w, 'pe-bench', 'b', 'ex-bench', 0, [{ reps: '5' }, { reps: '5' }])
  // slots 0 and 1 and 3 are Rotation A, slot 2 is Rotation B; cycles 2 and 3
  for (const cycle of [2, 3]) {
    planSession(w, `c${cycle}-s0`, 'a', cycle, { sequencePosition: 0 })
    planSession(w, `c${cycle}-s1`, 'a', cycle, { sequencePosition: 1 })
    planSession(w, `c${cycle}-s2`, 'b', cycle, { sequencePosition: 2 })
    planSession(w, `c${cycle}-s3`, 'a', cycle, { sequencePosition: 3 })
  }
  return w
}

export function unevenStableWorld(): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'fb', 'Full Body', 0)
  addWorkout(w, 'arms', 'Arms', 1)
  setDays(w, { tuesday: 'fb', thursday: 'fb', saturday: 'arms' })
  addExercise(w, 'pe-leg', 'fb', 'ex-leg', 0, [{ reps: '12-15' }, { reps: '10-12' }, { reps: '6-8', rest: 150 }])
  addExercise(w, 'pe-inc', 'fb', 'ex-inc', 1, [{ reps: '8-10' }, { reps: '8-10', kind: 'dropset', stages: ['6-8'] }, { reps: 'amrap', rest: 90 }])
  addExercise(w, 'pe-curl', 'arms', 'ex-curl', 0, [{ reps: '15' }, { reps: '10-12', rest: 60 }, { reps: '8' }])
  addExercise(w, 'pe-dip', 'arms', 'ex-dip', 1, [{ reps: '8-12' }, { reps: '' }, { reps: '5', kind: 'rest_pause', stages: ['3'], stageRest: 20 }])
  for (const week of [1, 2, 3]) {
    planSession(w, `p${week}-fb`, 'fb', week)
    planSession(w, `p${week}-arms`, 'arms', week)
  }
  return w
}

// ─── unevenWorkoutsWorld ───────────────────────────────────────────────────────────────────────────────────────────────

export interface UnevenExercise {
  row: string // the run copy's program-exercise row
  exerciseId: string // the catalogue exercise
  name: string
  sets: readonly string[] // rep targets of its default sets
  rest: number | null
  restAfter: number | null
  tempo: string | null
  unit: WeightUnit | null
  block?: string // the workout's superset block, when it is a member
}
export interface UnevenWorkout {
  id: string
  name: string
  day: string // the weekday of a weekday run
  exercises: readonly UnevenExercise[]
  block: { id: string; within: number | null; after: number | null }
  routine: readonly string[]
}

const ue = (row: string, exerciseId: string, name: string, sets: readonly string[], rest: number | null, restAfter: number | null, tempo: string | null, unit: WeightUnit | null, block?: string): UnevenExercise => ({
  row,
  exerciseId,
  name,
  sets,
  rest,
  restAfter,
  tempo,
  unit,
  ...(block ? { block } : {}),
})

// Push: four exercises, a pair in the middle. Pull: five, a trio first. Legs: four, a pair last. Arms: five, a pair second.
export const UNEVEN_WORKOUTS: readonly UnevenWorkout[] = [
  {
    id: 'push',
    name: 'Push',
    day: 'monday',
    exercises: [
      ue('pe-bench', 'ex-bench', 'Bench Press', ['6-8', '6-8', '6-8'], 150, null, null, null),
      ue('pe-ohp', 'ex-ohp', 'Overhead Press', ['8-10', '8-10'], 105, 30, '3-0-1-0', 'lbs', 'blk-push'),
      ue('pe-lateral', 'ex-lateral', 'Lateral Raise', ['12-15', '12-15'], null, null, null, 'kg', 'blk-push'),
      ue('pe-pushdown', 'ex-pushdown', 'Triceps Pushdown', ['10-12', '10-12'], 75, 45, null, null),
    ],
    block: { id: 'blk-push', within: 15, after: 90 },
    routine: ['Arm circles, 30 s', 'Band dislocates, 10', 'Push-up plus, 8'],
  },
  {
    id: 'pull',
    name: 'Pull',
    day: 'tuesday',
    exercises: [
      ue('pe-row', 'ex-row', 'Barbell Row', ['8-10', '8-10', '8-10'], 135, null, '2-1-1-0', null, 'blk-pull'),
      ue('pe-pd', 'ex-pd', 'Lat Pulldown', ['10-12', '10-12'], null, 60, null, 'lbs', 'blk-pull'),
      ue('pe-face', 'ex-face', 'Face Pull', ['15-20', '15-20'], 45, null, null, null, 'blk-pull'),
      ue('pe-bcurl', 'ex-bcurl', 'Biceps Curl', ['10-12', '10-12'], 90, 15, '4-0-1-0', 'kg'),
      ue('pe-shrug', 'ex-shrug', 'Shrug', ['12-15', '12-15'], null, null, null, null),
    ],
    block: { id: 'blk-pull', within: null, after: 120 },
    routine: ['Dead hang, 30 s', 'Scap pull-ups, 8'],
  },
  {
    id: 'legs',
    name: 'Legs',
    day: 'thursday',
    exercises: [
      ue('pe-squat', 'ex-squat', 'Back Squat', ['5', '5', '5'], 180, 60, null, null),
      ue('pe-rdl', 'ex-rdl', 'Romanian Deadlift', ['8-10', '8-10'], 120, null, '3-1-1-0', 'kg'),
      ue('pe-lcurl', 'ex-lcurl', 'Leg Curl', ['10-12', '10-12'], null, 30, null, null, 'blk-legs'),
      ue('pe-calf', 'ex-calf', 'Calf Raise', ['12-15', '12-15'], 60, null, null, 'lbs', 'blk-legs'),
    ],
    block: { id: 'blk-legs', within: 30, after: null },
    routine: ['Bike, 5 min', 'Bodyweight squat, 10', 'Hip airplanes, 6', 'Glute bridge, 12'],
  },
  {
    id: 'arms',
    name: 'Arms',
    day: 'saturday',
    exercises: [
      ue('pe-curl', 'ex-curl', 'Cable Curl', ['10-12', '10-12'], 90, 15, null, null),
      ue('pe-hammer', 'ex-hammer', 'Hammer Curl', ['10-12', '10-12'], null, null, '3-0-1-1', 'lbs', 'blk-arms'),
      ue('pe-dip', 'ex-dip', 'Dip', ['8-12', '8-12'], 75, 30, null, null, 'blk-arms'),
      ue('pe-skull', 'ex-skull', 'Skull Crusher', ['10-12', '10-12'], 120, null, null, 'kg'),
      ue('pe-wrist', 'ex-wrist', 'Wrist Curl', ['15-20', '15-20'], 45, 60, '2-0-2-0', null),
    ],
    block: { id: 'blk-arms', within: 30, after: 60 },
    routine: ['Band curls, 15', 'Triceps stretch, 20 s', 'Wrist circles, 10'],
  },
]

/**
 * Four workouts that no edit can mistake for each other. A weekday run puts them on Monday, Tuesday, Thursday and Saturday; a
 * sequence run gives each one slot of the cycle. Weeks (cycles) 2 and 3 are planned from the run copy, the run is in week 2.
 */
export function unevenWorkoutsWorld(planningType: PlanningType = 'week_dependent', scheduleType: ScheduleType = 'weekday'): World {
  const w = newWorld({ planningType, scheduleType, currentWeek: 2 })
  UNEVEN_WORKOUTS.forEach((wk, i) => addWorkout(w, wk.id, wk.name, i))
  if (scheduleType === 'weekday') setDays(w, Object.fromEntries(UNEVEN_WORKOUTS.map((wk) => [wk.day, wk.id])))
  for (const wk of UNEVEN_WORKOUTS) {
    addBlock(w, wk.block.id, wk.id, wk.block.within, wk.block.after)
    wk.exercises.forEach((x, position) => {
      addExercise(
        w,
        x.row,
        wk.id,
        x.exerciseId,
        position,
        x.sets.map((reps) => ({ reps })),
        { rest_seconds: x.rest, rest_after_seconds: x.restAfter, tempo: x.tempo, weight_unit: x.unit, superset_block_id: x.block ?? null },
      )
    })
    addRoutine(w, wk.id, [...wk.routine])
  }
  for (const week of [2, 3]) {
    UNEVEN_WORKOUTS.forEach((wk, slot) => planSession(w, `p${week}-${wk.id}`, wk.id, week, scheduleType === 'sequence' ? { sequencePosition: slot } : {}))
  }
  return w
}
