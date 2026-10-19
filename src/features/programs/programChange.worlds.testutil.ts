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
