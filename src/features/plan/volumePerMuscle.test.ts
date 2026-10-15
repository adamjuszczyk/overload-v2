import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUSCLE_GROUPS } from '../../lib/exerciseTags'
import { DEFAULT_SETTINGS, useSettingsStore } from '../settings/settingsStore'
import type { MuscleGroup, StageVolumeRule } from '../../types'
import { formatVolumeCount, formatVolumeDelta, volumeRows, type VolumeRow, type VolumeRowsInput } from './volumePerMuscle'
import { deepFreeze, exercise, logHead, logStage, orphanDropset, session, setId, weekPlan, type PlannedExercise } from './volumePerMuscle.testutil'

// Chunk 44 (TASKS-1.2): VOLUME as a pure function. Every expected number below is
// counted by hand in the comment beside it: warmups out, a drop at the rule's value.
// The seed's own week 2 → week 3 is volumePerMuscle.seed.test.ts.

const EXERCISES = [
  exercise('bench', 'chest'),
  exercise('row', 'back'),
  exercise('lat', 'shoulders'),
  exercise('curl', 'biceps'),
  exercise('pushdown', 'triceps'),
  exercise('dip', 'triceps'),
  exercise('squat', 'quads'),
  exercise('rdl', 'hamstrings'),
  exercise('calf', 'calves'),
  exercise('plank', 'core'),
  exercise('carry', 'other'),
]

const NOTHING = { sessions: [], plan: [] }

// The call, with the parts a test doesn't care about filled in.
function volume(over: Partial<VolumeRowsInput> = {}): VolumeRow[] {
  return volumeRows({ lastWeek: NOTHING, thisWeek: [], exercises: EXERCISES, rule: 'half', ...over })
}

// A muscle's row (the test names which one it is looking at).
function rowOf(rows: VolumeRow[], muscle: MuscleGroup): VolumeRow {
  const row = rows.find((r) => r.muscle === muscle)
  if (!row) throw new Error(`no row for ${muscle}; rows are ${rows.map((r) => r.muscle).join(', ') || 'none'}`)
  return row
}

const ex = (row: string, exerciseId: string, sets: string): PlannedExercise => ({ row, exerciseId, sets })
const nSets = (n: number) => Array.from({ length: n }, () => 'n').join(' ')

describe('volumeRows — what a set counts as', () => {
  it('a normal working set counts 1, and so does an AMRAP set', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'n a n')])
    expect(rowOf(volume({ thisWeek: [plan] }), 'chest').this).toBe(3) // 1 + 1 + 1
  })

  it('a warmup never counts, planned or logged', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'w w n')])
    expect(rowOf(volume({ thisWeek: [plan] }), 'chest').this).toBe(1) // the working set only
    const logs = [
      ...logHead('l1', 's1', 'bench', { planned: setId('p', 'r1', 1), warmup: true }),
      ...logHead('l2', 's1', 'bench', { planned: setId('p', 'r1', 2), warmup: true }),
      ...logHead('l3', 's1', 'bench', { planned: setId('p', 'r1', 3) }),
    ]
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p', 'completed', logs)], plan: [plan] } })
    expect(rowOf(rows, 'chest').last).toBe(1)
  })

  describe('a staged set counts 1 + its drops × the rule: whole 0, each 1, half ½ (SPEC 14, 14b)', () => {
    const KINDS: Array<[string, string]> = [['d', 'dropset'], ['m', 'myo-reps'], ['r', 'rest-pause'], ['c', 'cluster']]
    const EXPECTED = (drops: number): Record<StageVolumeRule, number> => ({ whole: 1, each: 1 + drops, half: 1 + drops / 2 })

    for (const [letter, kind] of KINDS) {
      for (const drops of [1, 2, 3]) {
        const want = EXPECTED(drops)
        it(`a ${kind} head with ${drops} drop${drops === 1 ? '' : 's'}: whole ${want.whole}, each ${want.each}, half ${want.half}`, () => {
          const plan = weekPlan('p', [ex('r1', 'bench', `${letter}${drops}`)])
          const logs = logHead('l1', 's1', 'bench', { planned: setId('p', 'r1', 1), drops })
          const past = { sessions: [session('s1', 'p', 'completed', logs)], plan: [plan] }
          for (const rule of ['whole', 'each', 'half'] as const) {
            const rows = volume({ thisWeek: [plan], lastWeek: past, rule })
            expect(rowOf(rows, 'chest').this, `planned, rule ${rule}`).toBe(want[rule])
            expect(rowOf(rows, 'chest').last, `logged, rule ${rule}`).toBe(want[rule])
          }
        })
      }
    }

    it('a head and its drops among other sets: n d2 n', () => {
      const plan = weekPlan('p', [ex('r1', 'bench', 'n d2 n')])
      const at = (rule: StageVolumeRule) => rowOf(volume({ thisWeek: [plan], rule }), 'chest').this
      expect([at('whole'), at('half'), at('each')]).toEqual([3, 4, 5]) // 1 + 1 + 1, 1 + 2 + 1, 1 + 3 + 1
    })

    it('a head with no stage kind (a legacy dropset, D30) counts its drops like any staged set', () => {
      const plan = weekPlan('p', [ex('r1', 'bench', 'd2')])
      plan.sets[0] = { ...plan.sets[0], stageKind: null }
      expect(rowOf(volume({ thisWeek: [plan] }), 'chest').this).toBe(2) // 1 + 2 × ½
    })

    it('a warmup is never staged: stray stage rows under a warmup head count nothing, and the head none', () => {
      const plan = weekPlan('p', [ex('r1', 'bench', 'w')])
      plan.sets.push({ ...plan.sets[0], id: 'p:r1:1.1', parentWeekPlanSetId: plan.sets[0].id, stageIndex: 1, isWarmup: false })
      expect(volume({ thisWeek: [plan], rule: 'each' })).toEqual([])
      const logs = [...logHead('l1', 's1', 'bench', { warmup: true }), logStage('l1.1', 's1', 'bench', 'l1')]
      expect(volume({ lastWeek: { sessions: [session('s1', 'p', 'completed', logs)], plan: [] }, rule: 'each' })).toEqual([])
    })

    it('an orphan dropset (a dropset row with no parent) is a set of its own and counts 1', () => {
      const logs = [...logHead('l1', 's1', 'bench'), orphanDropset('l2', 's1', 'bench')]
      const rows = volume({ lastWeek: { sessions: [session('s1', 'p', 'completed', logs)], plan: [] }, rule: 'each' })
      expect(rowOf(rows, 'chest').last).toBe(2) // 1 + 1, however the rule counts drops
    })

    it('a logged stage under a skipped head counts nothing, whatever it carries', () => {
      const logs = [...logHead('l1', 's1', 'bench', { skipped: true }), logStage('l1.1', 's1', 'bench', 'l1'), ...logHead('l2', 's1', 'bench')]
      const rows = volume({ lastWeek: { sessions: [session('s1', 'p', 'completed', logs)], plan: [] }, rule: 'each' })
      expect(rowOf(rows, 'chest').last).toBe(1) // the second head only
    })

    it('a skipped stage under a done head counts nothing; its done sibling does', () => {
      const logs = logHead('l1', 's1', 'bench', { drops: 2, stageSkipped: [false, true] })
      const rows = volume({ lastWeek: { sessions: [session('s1', 'p', 'completed', logs)], plan: [] }, rule: 'each' })
      expect(rowOf(rows, 'chest').last).toBe(2) // 1 + 1 (one drop done)
    })
  })
})

describe('volumeRows — this week is its plan', () => {
  it('counts each exercise\'s sets under its own muscle group', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'w n n n'), ex('r2', 'row', 'n n'), ex('r3', 'pushdown', 'n d1')])
    const rows = volume({ thisWeek: [plan] })
    expect(rows.map((r) => [r.muscle, r.this])).toEqual([['chest', 3], ['back', 2], ['triceps', 2.5]]) // 3; 2; 1 + (1 + ½)
  })

  it('adds up every workout of the week', () => {
    const a = weekPlan('a', [ex('a1', 'bench', 'n n'), ex('a2', 'row', 'n')])
    const b = weekPlan('b', [ex('b1', 'bench', 'n n n')])
    const rows = volume({ thisWeek: [a, b] })
    expect(rowOf(rows, 'chest').this).toBe(5)
    expect(rowOf(rows, 'back').this).toBe(1)
  })

  it('reads nothing but the plan: what last week\'s sessions did does not move it', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'n n n')])
    const logs = [...logHead('l1', 's1', 'bench'), ...logHead('l2', 's1', 'bench'), ...logHead('l3', 's1', 'bench'), ...logHead('l4', 's1', 'bench')]
    const rows = volume({ thisWeek: [plan], lastWeek: { sessions: [session('s1', 'last', 'completed', logs)], plan: [] } })
    expect(rowOf(rows, 'chest').this).toBe(3)
    expect(rowOf(rows, 'chest').last).toBe(4)
  })

  it('a deload plan counts the sets it has', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'n')], { isDeload: true })
    expect(rowOf(volume({ thisWeek: [plan] }), 'chest').this).toBe(1)
  })

  it('a week with no sets at all has no rows', () => {
    expect(volume({ thisWeek: [weekPlan('p', [ex('r1', 'bench', '')])] })).toEqual([])
    expect(volume()).toEqual([])
  })

  it('a planned set whose exercise is not in its plan\'s own list is not part of the week Plan draws', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'n n'), ex('gone', 'row', 'n n n')])
    plan.exercises = plan.exercises.filter((e) => e.id !== 'gone')
    expect(volume({ thisWeek: [plan] }).map((r) => [r.muscle, r.this])).toEqual([['chest', 2]])
  })

  it('a planned set finds its exercise through its plan\'s own exercise list, not through a record joined onto the set', () => {
    // This week's list says the row is the bench; the join on each set (the plan builder's) still says it is the row.
    const plan = weekPlan('p', [ex('r1', 'bench', 'n n')])
    plan.sets = plan.sets.map((s) => ({
      ...s,
      programExercise: { id: 'r1', workoutDayId: 'wd-p', userId: 'u1', exerciseId: 'row', position: 0, weightUnit: null },
    }))
    expect(volume({ thisWeek: [plan] }).map((r) => [r.muscle, r.this])).toEqual([['chest', 2]])
  })

  it('a plan row listed twice counts twice: each entry is one occurrence', () => {
    const plan = weekPlan('p', [ex('r1', 'bench', 'n n n')])
    expect(rowOf(volume({ thisWeek: [plan, plan] }), 'chest').this).toBe(6)
  })

  describe('one workout on several weekdays shares one plan row (G14)', () => {
    it('counts the row once per weekday it covers', () => {
      const shared = weekPlan('p', [ex('r1', 'bench', 'n n n')], { occurrences: 2 })
      expect(rowOf(volume({ thisWeek: [shared] }), 'chest').this).toBe(6)
    })

    it('counts it once when it covers one (the default)', () => {
      const plan = weekPlan('p', [ex('r1', 'bench', 'n n n')])
      expect(rowOf(volume({ thisWeek: [plan] }), 'chest').this).toBe(3)
    })

    it('counts a drop in each occurrence', () => {
      const shared = weekPlan('p', [ex('r1', 'bench', 'd2')], { occurrences: 3 })
      expect(rowOf(volume({ thisWeek: [shared] }), 'chest').this).toBe(6) // 3 × (1 + 2 × ½)
    })
  })
})

describe('volumeRows — last week is what was actually done', () => {
  const PLAN4 = () => weekPlan('p1', [ex('r1', 'bench', 'w n n n n')]) // four working sets planned
  const planned = (n: number) => setId('p1', 'r1', n)

  it('a done session counts the sets it logged, not its plan', () => {
    const logs = [
      ...logHead('l0', 's1', 'bench', { planned: planned(1), warmup: true }),
      ...logHead('l1', 's1', 'bench', { planned: planned(2) }),
      ...logHead('l2', 's1', 'bench', { planned: planned(3) }),
    ] // two of the four working sets were done
    const row = rowOf(volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [PLAN4()] } }), 'chest')
    expect(row.last).toBe(2)
    expect(row.note).toBe('YOU PLANNED 4 LAST WEEK · DID 2')
  })

  it('a skipped set is out', () => {
    const logs = [
      ...logHead('l1', 's1', 'bench', { planned: planned(2) }),
      ...logHead('l2', 's1', 'bench', { planned: planned(3), skipped: true }),
      ...logHead('l3', 's1', 'bench', { planned: planned(4) }),
      ...logHead('l4', 's1', 'bench', { planned: planned(5) }),
    ]
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [PLAN4()] } })
    expect(rowOf(rows, 'chest').last).toBe(3)
  })

  it('an added set (a log no planned set stands behind) is in', () => {
    const logs = [
      ...[2, 3, 4, 5].flatMap((n) => logHead(`l${n}`, 's1', 'bench', { planned: planned(n) })),
      ...logHead('extra', 's1', 'bench'),
    ]
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [PLAN4()] } })
    expect(rowOf(rows, 'chest').last).toBe(5)
    expect(rowOf(rows, 'chest').note).toBe('YOU PLANNED 4 LAST WEEK · DID 5')
  })

  it('a drop added to a set during the session counts at the rule\'s value', () => {
    // A plain planned set, logged as a dropset with one drop (the seed's lateral raise).
    const plan = weekPlan('p1', [ex('r1', 'bench', 'n n')])
    const logs = [...logHead('l1', 's1', 'bench', { planned: planned(1), drops: 1 }), ...logHead('l2', 's1', 'bench', { planned: planned(2) })]
    const at = (rule: StageVolumeRule) => rowOf(volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [plan] }, rule }), 'chest').last
    expect([at('whole'), at('half'), at('each')]).toEqual([2, 2.5, 3])
  })

  it('a session skipped as a whole counts 0 (all its sets are skipped), and its plan is still what was planned', () => {
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'skipped')], plan: [PLAN4()] } })
    expect(rowOf(rows, 'chest')).toEqual({ muscle: 'chest', last: 0, this: 0, delta: 0, note: 'YOU PLANNED 4 LAST WEEK · DID 0' })
  })

  it('an all-skipped session (status skipped, every log skipped) counts 0 too', () => {
    const logs = [2, 3, 4, 5].flatMap((n) => logHead(`l${n}`, 's1', 'bench', { planned: planned(n), skipped: true }))
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'skipped', logs)], plan: [PLAN4()] } })
    expect(rowOf(rows, 'chest').last).toBe(0)
  })

  describe('a session not done yet counts its plan, whatever it has logged', () => {
    it('in progress', () => {
      const logs = logHead('l1', 's1', 'bench', { planned: planned(2) }) // one set logged so far
      const row = rowOf(volume({ lastWeek: { sessions: [session('s1', 'p1', 'in_progress', logs)], plan: [PLAN4()] } }), 'chest')
      expect(row.last).toBe(4)
      expect(row.note).toBeUndefined()
    })

    it('planned (moved, not started)', () => {
      expect(rowOf(volume({ lastWeek: { sessions: [session('s1', 'p1', 'planned')], plan: [PLAN4()] } }), 'chest').last).toBe(4)
    })

    it('no session created for its plan yet', () => {
      expect(rowOf(volume({ lastWeek: { sessions: [], plan: [PLAN4()] } }), 'chest').last).toBe(4)
    })

    it('mixed: Monday done, Wednesday in progress, Friday not started', () => {
      const mon = weekPlan('mon', [ex('m1', 'bench', 'n n n')])
      const wed = weekPlan('wed', [ex('w1', 'row', 'n n')])
      const fri = weekPlan('fri', [ex('f1', 'lat', 'n n n n')])
      const logs = [...logHead('l1', 's1', 'bench', { planned: setId('mon', 'm1', 1) })] // Monday did one of three
      const rows = volume({
        lastWeek: {
          sessions: [session('s1', 'mon', 'completed', logs), session('s2', 'wed', 'in_progress', logHead('l2', 's2', 'row'))],
          plan: [mon, wed, fri],
        },
      })
      expect(rows.map((r) => [r.muscle, r.last])).toEqual([['chest', 1], ['back', 2], ['shoulders', 4]])
    })
  })

  describe('a planned set the session deleted (a `deleted` change) is out', () => {
    it('even when a stale log of it is still there, and so are its drops', () => {
      const plan = weekPlan('p1', [ex('r1', 'bench', 'n n d1 n')]) // heads 1..4, the third has a drop
      const logs = [
        ...logHead('l1', 's1', 'bench', { planned: planned(1) }),
        ...logHead('l2', 's1', 'bench', { planned: planned(2) }),
        ...logHead('l3', 's1', 'bench', { planned: planned(3), drops: 1 }),
        ...logHead('l4', 's1', 'bench', { planned: planned(4) }),
      ]
      const changes = [{ kind: 'deleted' as const, weekPlanSetId: planned(3) }]
      const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs, { changes })], plan: [plan] } })
      expect(rowOf(rows, 'chest').last).toBe(3) // 1 + 1 + 1: not the head, not its drop
    })

    it('only the change of its own session applies (two sessions on one shared plan row)', () => {
      const shared = weekPlan('p1', [ex('r1', 'bench', 'n n n')], { occurrences: 2 })
      const all = (sessionId: string) => [1, 2, 3].flatMap((n) => logHead(`${sessionId}-l${n}`, sessionId, 'bench', { planned: setId('p1', 'r1', n) }))
      const tuesday = session('tue', 'p1', 'completed', all('tue'), { changes: [{ kind: 'deleted', weekPlanSetId: setId('p1', 'r1', 2) }] })
      const thursday = session('thu', 'p1', 'completed', all('thu'))
      const row = rowOf(volume({ lastWeek: { sessions: [tuesday, thursday], plan: [shared] } }), 'chest')
      expect(row.last).toBe(5) // Tuesday 2, Thursday 3
      expect(row.note).toBe('YOU PLANNED 6 LAST WEEK · DID 5')
    })

    it('a change of another kind takes nothing out', () => {
      const plan = weekPlan('p1', [ex('r1', 'bench', 'n n')])
      const logs = [1, 2].flatMap((n) => logHead(`l${n}`, 's1', 'bench', { planned: planned(n) }))
      const changes = [{ kind: 'retyped' as const, weekPlanSetId: planned(1), type: { kind: 'warmup' as const } }]
      const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs, { changes })], plan: [plan] } })
      expect(rowOf(rows, 'chest').last).toBe(2)
    })
  })

  it('a swap done in the session counts for the exercise actually done', () => {
    const plan = weekPlan('p1', [ex('r1', 'bench', 'n n n')])
    const logs = [1, 2, 3].flatMap((n) => logHead(`l${n}`, 's1', 'dip', { planned: planned(n) }))
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [plan] } })
    expect(rowOf(rows, 'triceps')).toMatchObject({ last: 3, note: 'YOU PLANNED 0 LAST WEEK · DID 3' })
    expect(rowOf(rows, 'chest')).toMatchObject({ last: 0, note: 'YOU PLANNED 3 LAST WEEK · DID 0' })
  })

  describe('one workout on two weekdays shares one plan row (G14)', () => {
    const shared = () => weekPlan('p1', [ex('r1', 'bench', 'n n n')], { occurrences: 2 })
    const logsOf = (sessionId: string, n: number) => Array.from({ length: n }, (_, i) => logHead(`${sessionId}-${i}`, sessionId, 'bench', { planned: setId('p1', 'r1', i + 1) })).flat()

    it('both sessions done: each counts what it did; the plan counts twice', () => {
      const rows = volume({ lastWeek: { sessions: [session('tue', 'p1', 'completed', logsOf('tue', 3)), session('thu', 'p1', 'completed', logsOf('thu', 2))], plan: [shared()] } })
      expect(rowOf(rows, 'chest')).toMatchObject({ last: 5, note: 'YOU PLANNED 6 LAST WEEK · DID 5' })
    })

    it('Thursday not created yet: it counts its plan', () => {
      const rows = volume({ lastWeek: { sessions: [session('tue', 'p1', 'completed', logsOf('tue', 2))], plan: [shared()] } })
      expect(rowOf(rows, 'chest')).toMatchObject({ last: 5, note: 'YOU PLANNED 6 LAST WEEK · DID 5' }) // 2 done + 3 planned
    })

    it('Thursday in progress: it counts its plan, not its logs', () => {
      const rows = volume({ lastWeek: { sessions: [session('tue', 'p1', 'completed', logsOf('tue', 2)), session('thu', 'p1', 'in_progress', logsOf('thu', 1))], plan: [shared()] } })
      expect(rowOf(rows, 'chest').last).toBe(5)
    })

    it('with no count given, the sessions it has are its weekdays', () => {
      const plan = weekPlan('p1', [ex('r1', 'bench', 'n n n')]) // occurrences left out
      const rows = volume({ lastWeek: { sessions: [session('tue', 'p1', 'completed', logsOf('tue', 3)), session('thu', 'p1', 'completed', logsOf('thu', 3))], plan: [plan] } })
      expect(rowOf(rows, 'chest')).toMatchObject({ last: 6 })
      expect(rowOf(rows, 'chest').note).toBeUndefined() // 6 planned, 6 done
    })

    it('a plain workout: one session, one plan, once', () => {
      const plan = weekPlan('p1', [ex('r1', 'bench', 'n n n')])
      const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logsOf('s1', 3))], plan: [plan] } })
      expect(rowOf(rows, 'chest')).toMatchObject({ last: 3 })
      expect(rowOf(rows, 'chest').note).toBeUndefined()
    })
  })

  it('a done session whose plan row is not among last week\'s plans still counts what it did, and nothing was planned for it', () => {
    const logs = [1, 2].flatMap((n) => logHead(`l${n}`, 's1', 'bench'))
    const rows = volume({ lastWeek: { sessions: [session('s1', 'gone', 'completed', logs)], plan: [] } })
    expect(rowOf(rows, 'chest')).toMatchObject({ last: 2, note: 'YOU PLANNED 0 LAST WEEK · DID 2' })
  })

  it('a session that is not done, with no plan row at all or one that is not among last week\'s plans, counts nothing', () => {
    expect(volume({ lastWeek: { sessions: [session('s1', null, 'in_progress', logHead('l1', 's1', 'bench'))], plan: [] } })).toEqual([])
    expect(volume({ lastWeek: { sessions: [session('s1', 'gone', 'in_progress', logHead('l1', 's1', 'bench'))], plan: [] } })).toEqual([])
  })

  it('a plan row listed twice is two occurrences: both count their plan when neither has a session', () => {
    const plan = weekPlan('p1', [ex('r1', 'bench', 'n n n')])
    expect(rowOf(volume({ lastWeek: { sessions: [], plan: [plan, plan] } }), 'chest')).toEqual({ muscle: 'chest', last: 6, this: 0, delta: -6 })
  })

  it('what was planned is last week\'s plan, whatever this week holds', () => {
    const logs = [2, 3, 4].flatMap((n) => logHead(`l${n}`, 's1', 'bench', { planned: planned(n) }))
    const rows = volume({
      lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [PLAN4()] },
      thisWeek: [weekPlan('q1', [ex('q', 'bench', 'n n')])],
    })
    expect(rowOf(rows, 'chest')).toEqual({ muscle: 'chest', last: 3, this: 2, delta: -1, note: 'YOU PLANNED 4 LAST WEEK · DID 3' })
  })
})

describe('volumeRows — the rows', () => {
  it('run in MuscleGroup order with other last, whatever order the exercises were planned in', () => {
    const all: Array<[string, MuscleGroup]> = MUSCLE_GROUPS.map((g) => [`e-${g}`, g])
    const exercises = all.map(([id, g]) => exercise(id, g))
    const reversed = [...all].reverse().map(([id], i) => ex(`r${i}`, id, 'n'))
    const rows = volume({ exercises, thisWeek: [weekPlan('p', reversed)] })
    expect(rows.map((r) => r.muscle)).toEqual([...MUSCLE_GROUPS])
    expect(rows[rows.length - 1].muscle).toBe('other')
    expect(MUSCLE_GROUPS).toEqual(['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'other'])
  })

  it('a muscle gets a row when either week has volume in it, and no row when neither has', () => {
    const rows = volume({
      lastWeek: { sessions: [], plan: [weekPlan('l', [ex('l1', 'row', 'n n n')])] },
      thisWeek: [weekPlan('t', [ex('t1', 'bench', 'n n')])],
    })
    expect(rows.map((r) => [r.muscle, r.last, r.this])).toEqual([['chest', 0, 2], ['back', 3, 0]])
  })

  it('a muscle that was planned last week and nothing was done has a row, with its note, though both weeks read 0', () => {
    const rows = volume({ lastWeek: { sessions: [session('s1', 'l', 'skipped')], plan: [weekPlan('l', [ex('l1', 'row', 'n n n n')])] } })
    expect(rows).toEqual([{ muscle: 'back', last: 0, this: 0, delta: 0, note: 'YOU PLANNED 4 LAST WEEK · DID 0' }])
  })

  it('the change is this week minus last week, in halves too', () => {
    const rows = volume({
      lastWeek: {
        sessions: [],
        plan: [weekPlan('l', [
          ex('a', 'bench', nSets(9)),    // chest 9
          ex('b', 'row', nSets(10)),     // back 10
          ex('c', 'curl', 'n n n n d1'), // biceps 4 + 1½ = 5½
          ex('d', 'pushdown', nSets(5)), // triceps 5
        ])],
      },
      thisWeek: [weekPlan('t', [
        ex('a', 'bench', nSets(10)),     // 10
        ex('b', 'row', nSets(4)),        // 4
        ex('c', 'curl', 'n n n n d1'),   // 5½
        ex('d', 'pushdown', 'n n n n d1'), // 5½
      ])],
    })
    expect(rows.map((r) => [r.muscle, r.last, r.this, r.delta])).toEqual([
      ['chest', 9, 10, 1],
      ['back', 10, 4, -6],
      ['biceps', 5.5, 5.5, 0],
      ['triceps', 5, 5.5, 0.5],
    ])
  })

  describe('the muscle is the exercise\'s own `muscle_group`, from `exercises` alone', () => {
    it('not the group a plan\'s joined exercise record carries, and not the one on a log\'s joined record', () => {
      // The plan's joined record says bench is "back"; a log's says row is "biceps". Both are stale joins.
      const plan = weekPlan('p', [{ row: 'r1', exerciseId: 'bench', sets: 'n n', joinedGroup: 'back' }])
      const logs = logHead('l1', 's1', 'row', { joinedGroup: 'biceps' })
      const rows = volume({ thisWeek: [plan], lastWeek: { sessions: [session('s1', 'x', 'completed', logs)], plan: [] } })
      expect(rows.map((r) => [r.muscle, r.last, r.this])).toEqual([['chest', 0, 2], ['back', 1, 0]])
    })

    it('a null group is other (muscleGroup.ts)', () => {
      const exercises = [exercise('mystery', null)]
      const rows = volume({ exercises, thisWeek: [weekPlan('p', [ex('r1', 'mystery', 'n n')])] })
      expect(rows.map((r) => [r.muscle, r.this])).toEqual([['other', 2]])
    })

    it('a group that is not one of the twelve is other', () => {
      const exercises = [exercise('odd', 'full_body' as MuscleGroup)]
      const rows = volume({ exercises, thisWeek: [weekPlan('p', [ex('r1', 'odd', 'n')])] })
      expect(rows.map((r) => [r.muscle, r.this])).toEqual([['other', 1]])
    })

    it('an exercise that is not in `exercises` is other: a set done is a set counted', () => {
      const plan = weekPlan('p', [ex('r1', 'unlisted', 'n n')])
      const logs = logHead('l1', 's1', 'unlisted-too')
      const rows = volume({ thisWeek: [plan], lastWeek: { sessions: [session('s1', 'x', 'completed', logs)], plan: [] } })
      expect(rows.map((r) => [r.muscle, r.last, r.this])).toEqual([['other', 1, 2]])
    })

    it('subgroups are not rows: an exercise with subgroups still counts under its group', () => {
      const exercises = [{ ...exercise('incline', 'chest'), muscleSubgroups: ['upper_chest', 'front_delt'] }]
      const rows = volume({ exercises, thisWeek: [weekPlan('p', [ex('r1', 'incline', 'n n')])] })
      expect(rows.map((r) => [r.muscle, r.this])).toEqual([['chest', 2]])
    })
  })

  describe('the rule is the caller\'s', () => {
    const plan = weekPlan('p', [ex('r1', 'pushdown', 'n d2')])
    const triceps = (rule: StageVolumeRule) => rowOf(volume({ thisWeek: [plan], rule }), 'triceps').this

    it('whole, each and half give three different counts for the same plan', () => {
      expect([triceps('whole'), triceps('each'), triceps('half')]).toEqual([2, 4, 3]) // 1 + 1, 1 + 3, 1 + 2
    })

    it('Settings is not read: the store holds one rule, the call passes another, the call wins', () => {
      useSettingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, stageVolumeRule: 'whole' })
      try {
        expect(triceps('each')).toBe(4)
        expect(triceps('half')).toBe(3)
      } finally {
        useSettingsStore.getState().hydrate({ ...DEFAULT_SETTINGS })
      }
    })

    it('an unknown rule is refused, not counted as NaN', () => {
      expect(() => volume({ thisWeek: [plan], rule: 'third' as StageVolumeRule })).toThrow(/unknown stage volume rule: third/)
    })
  })
})

describe('volumeRows — a pure function', () => {
  it('changes nothing it is given: every input frozen, and the same answer twice', () => {
    const plan = weekPlan('p1', [ex('r1', 'bench', 'w n d2'), ex('r2', 'row', 'n n')], { occurrences: 2 })
    const logs = [
      ...logHead('l1', 's1', 'bench', { planned: setId('p1', 'r1', 2) }),
      ...logHead('l2', 's1', 'bench', { planned: setId('p1', 'r1', 3), drops: 2 }),
      ...logHead('l3', 's1', 'row'),
    ]
    const changes = [{ kind: 'deleted' as const, weekPlanSetId: setId('p1', 'r2', 2) }]
    const input = deepFreeze({
      lastWeek: { sessions: [session('s1', 'p1', 'completed', logs, { changes }), session('s2', 'p1', 'in_progress')], plan: [plan] },
      thisWeek: [plan],
      exercises: EXERCISES,
      rule: 'half' as const,
    })
    const first = volumeRows(input)
    expect(first.length).toBeGreaterThan(0)
    expect(volumeRows(input)).toEqual(first)
  })
})

describe('volumeRows — the note', () => {
  const plan = () => weekPlan('p1', [ex('r1', 'bench', 'n n n n')])
  const done = (n: number, extra: Parameters<typeof logHead>[3] = {}) => Array.from({ length: n }, (_, i) => logHead(`l${i}`, 's1', 'bench', { planned: setId('p1', 'r1', i + 1), ...extra })).flat()

  it('reads "YOU PLANNED 4 LAST WEEK · DID 10" where last week\'s actual differs from its plan (board 3)', () => {
    const logs = [...done(4), ...Array.from({ length: 6 }, (_, i) => logHead(`x${i}`, 's1', 'bench')).flat()] // 4 planned + 6 added
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [plan()] } })
    expect(rowOf(rows, 'chest').note).toBe('YOU PLANNED 4 LAST WEEK · DID 10')
  })

  it('writes halves as the board does', () => {
    const logs = logHead('l1', 's1', 'bench', { planned: setId('p1', 'r1', 1), drops: 1 }) // 1½
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [plan()] } })
    expect(rowOf(rows, 'chest').note).toBe('YOU PLANNED 4 LAST WEEK · DID 1½')
  })

  it('is absent when what was done equals what was planned, and the row has no note key at all', () => {
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', done(4))], plan: [plan()] } })
    expect(rowOf(rows, 'chest').last).toBe(4)
    expect('note' in rowOf(rows, 'chest')).toBe(false)
  })

  it('is absent when the difference cancels inside one muscle (a set skipped, a set added)', () => {
    const logs = [...done(3), ...logHead('extra', 's1', 'bench')]
    const rows = volume({ lastWeek: { sessions: [session('s1', 'p1', 'completed', logs)], plan: [plan()] } })
    expect(rowOf(rows, 'chest').last).toBe(4)
    expect(rowOf(rows, 'chest').note).toBeUndefined()
  })

  it('is absent for a muscle that only this week has', () => {
    const rows = volume({ thisWeek: [plan()] })
    expect(rowOf(rows, 'chest')).toEqual({ muscle: 'chest', last: 0, this: 4, delta: 4 })
  })
})

describe('formatVolumeCount and formatVolumeDelta (board 3)', () => {
  it('writes whole counts plainly and halves as ½', () => {
    expect([0, 2, 10, 5.5, 0.5, 10.5].map(formatVolumeCount)).toEqual(['0', '2', '10', '5½', '½', '10½'])
  })

  it('writes the change with + or − (U+2212, as the board) and nothing for no change', () => {
    expect([1, -6, 0, 0.5, -0.5, -1.5, 2.5].map(formatVolumeDelta)).toEqual(['+1', '−6', '', '+½', '−½', '−1½', '+2½'])
    expect(formatVolumeDelta(-6).charCodeAt(0)).toBe(0x2212)
  })
})

describe('G51 — the rule is this sheet\'s only', () => {
  const SRC = fileURLToPath(new URL('../../', import.meta.url))
  const MODULE = fileURLToPath(new URL('./volumePerMuscle.ts', import.meta.url))
  // Every non-test source file under src/ (the same reading runFixedForTheRun.static.test.ts takes).
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.tsx?$/.test(name)
      return isSource ? [path] : []
    })
  }
  // `from '…/volumePerMuscle'` and `import('…/volumePerMuscle')`, with or without an extension.
  const IMPORTS_THE_MODULE = /(?:from|import)\s*\(?\s*['"][^'"]*\/volumePerMuscle(?:\.[jt]s)?['"]/

  it('the pattern finds an importer when there is one (this very test file)', () => {
    expect(IMPORTS_THE_MODULE.test(readFileSync(fileURLToPath(import.meta.url), 'utf8'))).toBe(true)
    expect(IMPORTS_THE_MODULE.test(`const v = await import('../plan/volumePerMuscle.js')`)).toBe(true)
  })

  it('only the VOLUME sheet (chunk 55) imports the module: History, Progress and the finish screen count as they do today', () => {
    const importers = sourceFiles(SRC)
      .filter((path) => path !== MODULE && IMPORTS_THE_MODULE.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).split(sep).join('/'))
      .sort()
    const ALLOWED = ['features/plan/VolumeSheet.tsx'] // chunk 55; a new importer is added here on purpose
    expect(importers.filter((path) => !ALLOWED.includes(path))).toEqual([])
  })

  it('the module reads no Settings: it imports nothing from settings, and the rule only arrives as a parameter', () => {
    const text = readFileSync(MODULE, 'utf8')
    const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(3) // the scan sees the imports at all
    expect(specifiers.filter((s) => /settings/i.test(s))).toEqual([])
    expect(text).not.toMatch(/useSettingsStore|settingsStore|getSettings|fetchSettings/)
  })
})
