// The world the VOLUME sheet's tests draw (chunk 55): the seed's week 2 → week 3 for the test account, as chunk 44's `volumePerMuscle.seed.test.ts`
// counts it, built as the sheet is handed it: week plans whose rows carry their joined exercise (as `useAllWeekPlans` and `useWeekPlans`
// return them), and last week's sessions with their logs in `useVolumeSessions`'s shape. Not a test file (Vitest's include is *.test.ts).
//
//   Upper A, Monday, completed, done differently from its plan: bench set 2 and 3 at other numbers (no change in count), seated cable row
//     set 3 skipped, lateral raise set 1 logged as a dropset with one logged drop, a pushdown head nobody planned.
//   Lower A, Wednesday, a deload session, completed as planned.
//   Upper B, Friday, skipped, no logs.
// Week 3 is planned with the same structure. Every number the tests expect is written out by hand where it is used.

import type { MuscleGroup, SessionStatus, SetLog, WeekPlan } from '../../types'
import type { VolumeSessionRead, VolumeSessionsRead } from './useVolumeSessions'
import { logHead, setId, weekPlan, type PlannedExercise } from './volumePerMuscle.testutil'

export const GROUP_OF: Record<string, MuscleGroup> = {
  bench: 'chest', row: 'back', lat: 'shoulders', pushdown: 'triceps', squat: 'quads', rdl: 'hamstrings', 'curl-machine': 'hamstrings',
  calf: 'calves', pullup: 'back', ohp: 'shoulders', 'ez-curl': 'biceps',
}

// Set tokens as the testutil reads them: n normal, a AMRAP, w warmup, d2 a dropset with two drops, m3 myo-reps with three, r1 rest-pause
// with one, c2 a cluster with two.
const row = (exerciseId: string, sets: string): PlannedExercise => ({ row: exerciseId, exerciseId, sets, joinedGroup: GROUP_OF[exerciseId] })
export const UPPER_A = [row('bench', 'w n n n'), row('row', 'n n n'), row('lat', 'n n n'), row('pushdown', 'n d2')]
export const LOWER_A = [row('squat', 'w w n n a'), row('rdl', 'n n n'), row('curl-machine', 'm3'), row('calf', 'n r1')]
export const UPPER_B = [row('pullup', 'c2 n n'), row('ohp', 'n n n'), row('ez-curl', 'n n')]

/** A week of the seed's run as Plan's queries return it: three plan rows, week 2's Lower A the deload session. */
export function seededWeek(week: 2 | 3): WeekPlan[] {
  return [
    weekPlan(`w${week}-ua`, UPPER_A, { weekNumber: week }),
    weekPlan(`w${week}-la`, LOWER_A, { weekNumber: week, isDeload: week === 2 }),
    weekPlan(`w${week}-ub`, UPPER_B, { weekNumber: week }),
  ]
}

// What a session logged for one exercise, against that exercise's planned heads (counted in order): w a warmup done, n a set done, x a set
// skipped, d<k> a set done as a staged head with k drops logged, +n a set nobody planned.
function logged(sessionId: string, planId: string, exerciseId: string, spec: string): SetLog[] {
  let planned = 0
  return spec.split(' ').flatMap((token, i) => {
    const id = `${sessionId}-${exerciseId}-${i}`
    if (token === '+n') return logHead(id, sessionId, exerciseId)
    planned += 1
    const against = setId(planId, exerciseId, planned)
    if (token === 'w') return logHead(id, sessionId, exerciseId, { planned: against, warmup: true })
    if (token === 'n') return logHead(id, sessionId, exerciseId, { planned: against })
    if (token === 'x') return logHead(id, sessionId, exerciseId, { planned: against, skipped: true })
    if (/^d\d$/.test(token)) return logHead(id, sessionId, exerciseId, { planned: against, drops: Number(token[1]) })
    throw new Error(`unknown log token "${token}"`)
  })
}

export const UPPER_A_LOGS: SetLog[] = [
  ...logged('sua', 'w2-ua', 'bench', 'w n n n'),
  ...logged('sua', 'w2-ua', 'row', 'n n x'),
  ...logged('sua', 'w2-ua', 'lat', 'd1 n n'),
  ...logged('sua', 'w2-ua', 'pushdown', 'n d2 +n'),
]
export const LOWER_A_LOGS: SetLog[] = [
  ...logged('sla', 'w2-la', 'squat', 'w w n n n'),
  ...logged('sla', 'w2-la', 'rdl', 'n n n'),
  ...logged('sla', 'w2-la', 'curl-machine', 'd3'),
  ...logged('sla', 'w2-la', 'calf', 'n d1'),
]

/** A session of last week in the shape `useVolumeSessions` returns. */
export function sessionRead(planId: string, status: SessionStatus, logs: SetLog[] = [], deleted: string[] = []): VolumeSessionRead {
  return {
    weekPlanId: planId,
    status,
    setLogs: logs,
    sessionSetChanges: deleted.map((weekPlanSetId) => ({ kind: 'deleted' as const, weekPlanSetId })),
  }
}

/** The read a sheet gets for the given sessions: the exercises its logs name, with their muscle groups. */
export function readOf(sessions: VolumeSessionRead[]): VolumeSessionsRead {
  const ids = [...new Set(sessions.flatMap((s) => s.setLogs.map((l) => l.exerciseId)))]
  return { sessions, exercises: ids.map((id) => ({ id, muscleGroup: GROUP_OF[id] ?? 'other' })) }
}

/** The seed's own week 2: Upper A and Lower A completed, Upper B skipped. */
export const seededRead = (): VolumeSessionsRead =>
  readOf([sessionRead('w2-ua', 'completed', UPPER_A_LOGS), sessionRead('w2-la', 'completed', LOWER_A_LOGS), sessionRead('w2-ub', 'skipped')])
