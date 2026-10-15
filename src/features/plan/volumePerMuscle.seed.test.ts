import { describe, it, expect } from 'vitest'
import { addDays, format, parseISO } from 'date-fns'
import type { SessionStatus, SetLog, StageVolumeRule } from '../../types'
import { volumeRows } from './volumePerMuscle'
import { exercise, logHead, session, setId, weekPlan } from './volumePerMuscle.testutil'

// Chunk 44 (TASKS-1.2 "VOLUME as a pure function", Verification): the seed's week 2 → week 3 for the
// test account (staging-test@example.com, STG Upper/Lower: week-dependent, Mon Upper A / Wed Lower A /
// Fri Upper B), built from supabase/seed.sql as it stands after chunk 36's revision. Week 2 is last
// week for week 3 (the seed's current week):
//   Upper A, Monday, completed, done differently from its plan (the seed's five differences): bench
//     set 2 and 3 at other numbers (no change in count), seated cable row set 3 skipped, lateral raise
//     set 1 logged as a dropset with one logged drop, a pushdown head nobody planned.
//   Lower A, Wednesday, a deload session, completed as planned.
//   Upper B, Friday, skipped, no logs.
// Week 3 is planned with the same structure. Every expected number is counted by hand, in the
// comments: warmups out, a drop at the rule's value.

// ─── The queue: weekdays derived from the run's Monday, and printed ──────────────────────────────

// The seed starts the run on the Monday two weeks before its own Monday (2026-10-12): week 1 begins
// 2026-09-28, week 2 on 2026-10-05, week 3 on 2026-10-12 (CONTEXT.md, "Staging", the seed's week).
const RUN_MONDAY = parseISO('2026-09-28')
const week2 = (dayIndex: number) => addDays(RUN_MONDAY, 7 + dayIndex)
const day = (d: Date) => format(d, 'yyyy-MM-dd')

const QUEUE: Array<{ workout: string; date: Date; status: SessionStatus }> = [
  { workout: 'Upper A', date: week2(0), status: 'completed' },
  { workout: 'Lower A', date: week2(2), status: 'completed' },
  { workout: 'Upper B', date: week2(4), status: 'skipped' },
]

// ─── The seed's exercises, programs, plans ───────────────────────────────────────────────────────

const EXERCISES = [
  exercise('bench', 'chest'),
  exercise('row', 'back'),
  exercise('lat', 'shoulders'),
  exercise('pushdown', 'triceps'),
  exercise('squat', 'quads'),
  exercise('rdl', 'hamstrings'),
  exercise('curl-machine', 'hamstrings'), // Lying Leg Curl
  exercise('calf', 'calves'),
  exercise('pullup', 'back'),
  exercise('ohp', 'shoulders'),
  exercise('ez-curl', 'biceps'),
]

// Set tokens as the testutil reads them: n normal, a AMRAP, w warmup, d2 a dropset with two drops,
// m3 myo-reps with three, r1 rest-pause with one, c2 a cluster with two.
const UPPER_A = [
  { row: 'bench', exerciseId: 'bench', sets: 'w n n n' },      // 1 warmup + 3 working
  { row: 'row', exerciseId: 'row', sets: 'n n n' },             // superset A
  { row: 'lat', exerciseId: 'lat', sets: 'n n n' },             // superset B
  { row: 'pushdown', exerciseId: 'pushdown', sets: 'n d2' },    // set 2 a dropset, two drops
]
const LOWER_A = [
  { row: 'squat', exerciseId: 'squat', sets: 'w w n n a' },     // 2 warmups, 3 working, the last AMRAP
  { row: 'rdl', exerciseId: 'rdl', sets: 'n n n' },
  { row: 'curl-machine', exerciseId: 'curl-machine', sets: 'm3' }, // myo-reps, three drops
  { row: 'calf', exerciseId: 'calf', sets: 'n r1' },            // set 2 rest-pause, one drop
]
const UPPER_B = [
  { row: 'pullup', exerciseId: 'pullup', sets: 'c2 n n' },      // set 1 a cluster, two drops
  { row: 'ohp', exerciseId: 'ohp', sets: 'n n n' },
  { row: 'ez-curl', exerciseId: 'ez-curl', sets: 'n n' },
]

const plansOfWeek = (week: 2 | 3) => [
  weekPlan(`w${week}-ua`, UPPER_A, { weekNumber: week }),
  weekPlan(`w${week}-la`, LOWER_A, { weekNumber: week, isDeload: week === 2 }), // week 2's Lower A is the deload session
  weekPlan(`w${week}-ub`, UPPER_B, { weekNumber: week }),
]

// What a session logged for one exercise, against that exercise's planned heads (counted in order, the
// way the workout screen numbers them): w a warmup done, n a set done, x a set skipped, d<k> a set done as a
// staged head with k drops logged, +n a set nobody planned.
function logged(sessionId: string, planId: string, row: string, exerciseId: string, spec: string): SetLog[] {
  let planned = 0
  return spec.split(' ').flatMap((token, i) => {
    const id = `${sessionId}-${row}-${i}`
    if (token === '+n') return logHead(id, sessionId, exerciseId)
    planned += 1
    const against = setId(planId, row, planned)
    if (token === 'w') return logHead(id, sessionId, exerciseId, { planned: against, warmup: true })
    if (token === 'n') return logHead(id, sessionId, exerciseId, { planned: against })
    if (token === 'x') return logHead(id, sessionId, exerciseId, { planned: against, skipped: true })
    if (/^d\d$/.test(token)) return logHead(id, sessionId, exerciseId, { planned: against, drops: Number(token[1]) })
    throw new Error(`unknown log token "${token}"`)
  })
}

const upperALogs = [
  ...logged('sua', 'w2-ua', 'bench', 'bench', 'w n n n'),       // sets 2 and 3 at other numbers: still 3 working sets
  ...logged('sua', 'w2-ua', 'row', 'row', 'n n x'),             // row set 3 skipped
  ...logged('sua', 'w2-ua', 'lat', 'lat', 'd1 n n'),            // lateral raise set 1 a dropset, one drop logged
  ...logged('sua', 'w2-ua', 'pushdown', 'pushdown', 'n d2 +n'), // set 2 with its two drops, then a pushdown head nobody planned
]
const lowerALogs = [
  ...logged('sla', 'w2-la', 'squat', 'squat', 'w w n n n'),
  ...logged('sla', 'w2-la', 'rdl', 'rdl', 'n n n'),
  ...logged('sla', 'w2-la', 'curl-machine', 'curl-machine', 'd3'),
  ...logged('sla', 'w2-la', 'calf', 'calf', 'n d1'),
]

function seedWeek2To3(rule: StageVolumeRule) {
  const [ua, la, ub] = QUEUE
  return volumeRows({
    lastWeek: {
      sessions: [
        session('sua', 'w2-ua', ua.status, upperALogs, { date: day(ua.date) }),
        session('sla', 'w2-la', la.status, lowerALogs, { date: day(la.date) }),
        session('sub', 'w2-ub', ub.status, [], { date: day(ub.date) }),
      ],
      plan: plansOfWeek(2),
    },
    thisWeek: plansOfWeek(3),
    exercises: EXERCISES,
    rule,
  })
}

type Expected = Array<[muscle: string, last: number, thisWeek: number, delta: number, note: string | undefined]>
const table = (rule: StageVolumeRule) => seedWeek2To3(rule).map((r): Expected[number] => [r.muscle, r.last, r.this, r.delta, r.note])

describe('the seed\'s week 2 → week 3 (the test account), counted by hand', () => {
  it('the queue: Monday Upper A done, Wednesday Lower A done, Friday Upper B skipped, on the weekdays the seed makes them', () => {
    const queue = QUEUE.map((q) => `${format(q.date, 'EEEE')} ${day(q.date)} ${q.workout} ${q.status}`)
    expect(queue).toEqual([
      'Monday 2026-10-05 Upper A completed',
      'Wednesday 2026-10-07 Lower A completed',
      'Friday 2026-10-09 Upper B skipped',
    ])
    expect(format(addDays(RUN_MONDAY, 14), 'EEEE yyyy-MM-dd')).toBe('Monday 2026-10-12') // week 3, the seed's current week
  })

  // Week 3 (the plan), each workout, by muscle — with k = what one drop counts:
  //   Upper A  chest 3 (bench; the warmup is out); back 3 (row); shoulders 3 (lateral raise); triceps 1 + (1 + 2k) = 2 + 2k
  //   Lower A  quads 3 (squat; two warmups out, the AMRAP in); hamstrings 3 + (1 + 3k) = 4 + 3k; calves 1 + (1 + k) = 2 + k
  //   Upper B  back (1 + 2k) + 2 = 3 + 2k; shoulders 3 (overhead press); biceps 2
  //   so this week: chest 3, back 6 + 2k, shoulders 6, biceps 2, triceps 2 + 2k, quads 3, hamstrings 4 + 3k, calves 2 + k
  // Week 2 (what was done): Upper A: chest 3; back 2 (row set 3 skipped); shoulders 3 + k (lateral raise set 1 and its
  //   drop, sets 2 and 3); triceps 1 + (1 + 2k) + 1 = 3 + 2k (the pushdown head nobody planned is in);
  //   Lower A as planned: quads 3, hamstrings 4 + 3k, calves 2 + k; Upper B skipped: nothing.
  // What was planned for week 2 is week 3's structure again.

  it('default rule, each drop = ½: triceps planned 3, did 4 (TASKS-1.2 says 2 → 3, which is the whole-set count)', () => {
    expect(table('half')).toEqual([
      ['chest', 3, 3, 0, undefined],
      ['back', 2, 7, 5, 'YOU PLANNED 7 LAST WEEK · DID 2'],            // row 3 skipped, Upper B skipped: 3 + 4 planned, 2 done
      ['shoulders', 3.5, 6, 2.5, 'YOU PLANNED 6 LAST WEEK · DID 3½'],  // overhead press skipped (3); lateral raise set 1 + ½
      ['biceps', 0, 2, 2, 'YOU PLANNED 2 LAST WEEK · DID 0'],          // Upper B skipped
      ['triceps', 4, 3, -1, 'YOU PLANNED 3 LAST WEEK · DID 4'],        // 1 + 2 + 1 done against 1 + 2
      ['quads', 3, 3, 0, undefined],
      ['hamstrings', 5.5, 5.5, 0, undefined],                          // 3 + (1 + 1½)
      ['calves', 2.5, 2.5, 0, undefined],                              // 1 + (1 + ½)
    ])
  })

  it('whole set = 1: the drops count nothing; triceps planned 2, did 3 (TASKS-1.2\'s numbers)', () => {
    expect(table('whole')).toEqual([
      ['chest', 3, 3, 0, undefined],
      ['back', 2, 6, 4, 'YOU PLANNED 6 LAST WEEK · DID 2'],
      ['shoulders', 3, 6, 3, 'YOU PLANNED 6 LAST WEEK · DID 3'],
      ['biceps', 0, 2, 2, 'YOU PLANNED 2 LAST WEEK · DID 0'],
      ['triceps', 3, 2, -1, 'YOU PLANNED 2 LAST WEEK · DID 3'],
      ['quads', 3, 3, 0, undefined],
      ['hamstrings', 4, 4, 0, undefined],
      ['calves', 2, 2, 0, undefined],
    ])
  })

  it('each drop = 1', () => {
    expect(table('each')).toEqual([
      ['chest', 3, 3, 0, undefined],
      ['back', 2, 8, 6, 'YOU PLANNED 8 LAST WEEK · DID 2'],
      ['shoulders', 4, 6, 2, 'YOU PLANNED 6 LAST WEEK · DID 4'],
      ['biceps', 0, 2, 2, 'YOU PLANNED 2 LAST WEEK · DID 0'],
      ['triceps', 5, 4, -1, 'YOU PLANNED 4 LAST WEEK · DID 5'],
      ['quads', 3, 3, 0, undefined],
      ['hamstrings', 7, 7, 0, undefined],
      ['calves', 3, 3, 0, undefined],
    ])
  })

  it('switching from ½ to each drop = 1 changes back, shoulders, triceps, hamstrings and calves — not chest, biceps or quads', () => {
    const half = table('half')
    const each = table('each')
    const changed = half.filter((row, i) => JSON.stringify(row) !== JSON.stringify(each[i])).map((row) => row[0])
    expect(changed).toEqual(['back', 'shoulders', 'triceps', 'hamstrings', 'calves'])
  })
})
