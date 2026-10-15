import { describe, it, expect } from 'vitest'
import { addDays, format, parseISO } from 'date-fns'
import type { ProgramExercise, SessionSetChange, SessionStatus, SetLog, WeekPlan, WeekPlanSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary'
import { applyReviewAction, reviewItemText, reviewItems, type ReviewGroup, type ReviewItem } from './review'
import { applyWrites, dropLog, row, session, setLog, stage, swapRecord, weekPlan, workoutDay, wset } from './review.testutil'

// Chunk 43 (TASKS-1.2 "REVIEW as a pure function", Verification): "The seed's week 2 Upper A is the
// fixture's shape: the test asserts exactly its five items (bench 02 weight, bench 03 reps, row 03
// skipped, lateral raise 01 type, pushdown added set) and nothing from Lower A (deload, as planned)."
// Built from supabase/seed.sql as it stands after chunk 36's revision: the test account's STG
// Upper/Lower run (week-dependent, Mon Upper A / Wed Lower A / Fri Upper B), its plans for weeks 1–3
// (week 1's targets copied to week 2, week 3 a little heavier) and the logs the seed's loop writes.

// ─── The queue: weekdays derived from the run's Monday, and printed ──────────────────────────────

// The seed starts the run on the Monday two weeks before its own Monday (2026-10-12): week 1 begins
// 2026-09-28, week 2 on 2026-10-05, week 3 on 2026-10-12 (CONTEXT.md, "Staging", the seed's week).
const RUN_MONDAY = parseISO('2026-09-28')
const weekDay = (week: number, dayIndex: number) => addDays(RUN_MONDAY, 7 * (week - 1) + dayIndex)
const day = (d: Date) => format(d, 'yyyy-MM-dd')

const QUEUE_WEEK_2: Array<{ key: 'ua' | 'la' | 'ub'; workout: string; date: Date; status: SessionStatus }> = [
  { key: 'ua', workout: 'Upper A', date: weekDay(2, 0), status: 'completed' },
  { key: 'la', workout: 'Lower A', date: weekDay(2, 2), status: 'completed' }, // the deload session, done as planned
  { key: 'ub', workout: 'Upper B', date: weekDay(2, 4), status: 'skipped' },
]

// ─── The seed's programs ─────────────────────────────────────────────────────────────────────────

interface Spec {
  w?: boolean // a warmup
  reps?: [number, number]
  amrap?: boolean
  kind?: StageKind
  stages?: Array<[number, number]>
}
interface ExerciseSpec {
  pe: string
  exerciseId: string
  name: string
  lbs?: boolean
  sets: Spec[]
}
const x3 = (reps: [number, number]): Spec[] => [{ reps }, { reps }, { reps }]

const UPPER_A: ExerciseSpec[] = [
  { pe: 'pe-bench', exerciseId: 'e-bench', name: 'Barbell Bench Press', sets: [{ w: true, reps: [10, 10] }, { reps: [6, 8] }, { reps: [6, 8] }, { reps: [6, 8] }] },
  { pe: 'pe-row', exerciseId: 'e-row', name: 'Seated Cable Row', sets: x3([10, 12]) }, // superset A
  { pe: 'pe-lat', exerciseId: 'e-lat', name: 'Dumbbell Lateral Raise', lbs: true, sets: x3([12, 15]) }, // superset B
  { pe: 'pe-push', exerciseId: 'e-push', name: 'Cable Triceps Pushdown', sets: [{ reps: [10, 12] }, { reps: [10, 12], kind: 'dropset', stages: [[8, 10], [6, 8]] }] },
]
const LOWER_A: ExerciseSpec[] = [
  { pe: 'pe-squat', exerciseId: 'e-squat', name: 'Back Squat', sets: [{ w: true, reps: [8, 8] }, { w: true, reps: [5, 5] }, { reps: [5, 6] }, { reps: [5, 6] }, { amrap: true }] },
  { pe: 'pe-rdl', exerciseId: 'e-rdl', name: 'Romanian Deadlift', sets: x3([8, 10]) },
  { pe: 'pe-curl', exerciseId: 'e-curl', name: 'Lying Leg Curl', sets: [{ reps: [12, 15], kind: 'myo_reps', stages: [[4, 5], [4, 5], [4, 5]] }] },
  { pe: 'pe-calf', exerciseId: 'e-calf', name: 'Standing Calf Raise', sets: [{ reps: [10, 12] }, { reps: [10, 12], kind: 'rest_pause', stages: [[3, 5]] }] },
]
const UPPER_B: ExerciseSpec[] = [
  { pe: 'pe-pullup', exerciseId: 'e-pullup', name: 'Pull-Up', sets: [{ reps: [3, 3], kind: 'cluster', stages: [[3, 3], [3, 3]] }, { reps: [6, 8] }, { reps: [6, 8] }] },
  { pe: 'pe-ohp', exerciseId: 'e-ohp', name: 'Overhead Press', sets: x3([6, 8]) },
  { pe: 'pe-ezcurl', exerciseId: 'e-ezcurl', name: 'EZ-Bar Curl', sets: [{ reps: [10, 12] }, { reps: [10, 12] }] },
]
const WORKOUTS = { ua: UPPER_A, la: LOWER_A, ub: UPPER_B }
const WORKOUT_NAMES = { ua: 'Upper A', la: 'Lower A', ub: 'Upper B' }

// Week 1's targets, as the seed's update writes them; week 2 copies them, week 3 adds 2.5 kg to every
// weight above 0 that isn't a warmup's.
function targetWeight(exerciseId: string, warmup: boolean, stageIndex: number): number {
  switch (exerciseId) {
    case 'e-bench': return warmup ? 40 : 80
    case 'e-row': return 60
    case 'e-lat': return 9
    case 'e-push': return stageIndex > 0 ? 25 - 5 * stageIndex : 30
    case 'e-squat': return warmup ? 60 : 110
    case 'e-rdl': return 90
    case 'e-curl': return 35
    case 'e-calf': return 70
    case 'e-pullup': return 0
    case 'e-ohp': return 50
    default: return 30
  }
}

const planOf = (key: 'ua' | 'la' | 'ub', week: number): WeekPlan => {
  const exercises: ProgramExercise[] = WORKOUTS[key].map((e, i) => {
    const base = row(e.pe, e.exerciseId, i + 1, e.name)
    return e.lbs ? { ...base, weightUnit: 'lbs' } : base
  })
  const sets: WeekPlanSet[] = []
  for (const e of WORKOUTS[key]) {
    e.sets.forEach((spec, i) => {
      const position = i + 1
      const id = `w${week}-${key}-${e.pe}-${position}`
      const heavier = (kg: number, warmup: boolean) => (week >= 3 && kg > 0 && !warmup ? kg + 2.5 : kg)
      sets.push(
        wset(id, e.pe, position, {
          isWarmup: !!spec.w,
          stageKind: spec.kind ?? null,
          targetWeight: heavier(targetWeight(e.exerciseId, !!spec.w, 0), !!spec.w),
          targetRir: spec.w ? null : 2,
          repMin: spec.amrap ? null : spec.reps![0],
          repMax: spec.amrap ? null : spec.reps![1],
          isAmrap: !!spec.amrap,
        }),
      )
      ;(spec.stages ?? []).forEach((reps, k) => {
        sets.push(
          stage(`${id}-s${k + 1}`, id, e.pe, k + 1, {
            setNumber: position,
            targetWeight: heavier(targetWeight(e.exerciseId, false, k + 1), false),
            targetRir: 0,
            repMin: reps[0],
            repMax: reps[1],
          }),
        )
      })
    })
  }
  return weekPlan(key, week, exercises, sets, { workoutDay: workoutDay(`wd-${key}`, WORKOUT_NAMES[key]) })
}

// The logs the seed's loop writes for one done session, head by head in plan order (the app numbers a log
// 1-based per exercise, warmups and working sets apart): the plan as done, except what `diffs` and
// `skipHead` change. `diffs` is the test account's week 2 Upper A; `skipHead` is the nth head of the
// session logged as skipped (week 1's Upper B: the third).
function seedLogs(plan: WeekPlan, sessionId: string, opts: { diffs?: boolean; skipHead?: number; relabel?: { from: string; to: string } } = {}): SetLog[] {
  const logs: SetLog[] = []
  let i = 0
  let clock = Date.parse(`${format(parseISO('2026-10-05'), 'yyyy-MM-dd')}T18:00:00.000Z`)
  const tick = (seconds: number) => new Date((clock += seconds * 1000)).toISOString()
  for (const pe of plan.exercises) {
    const exerciseId = pe.exerciseId
    const rowSets = plan.sets.filter((s) => s.programExerciseId === pe.id)
    for (const head of rowSets.filter((s) => s.parentWeekPlanSetId === null).sort((a, b) => a.setNumber - b.setNumber)) {
      i += 1
      const n = logs.filter((l) => l.exerciseId === exerciseId && l.isWarmup === head.isWarmup && l.parentSetId === null).length + 1
      if ((opts.diffs && exerciseId === 'e-row' && n === 3) || opts.skipHead === i) {
        logs.push(setLog(`${sessionId}-${head.id}`, sessionId, exerciseId, { weekPlanSetId: head.id, setNumber: n, isSkipped: true, weight: null, reps: null, rir: null, isWarmup: head.isWarmup, loggedAt: tick(180) }))
        continue
      }
      let weight = head.targetWeight ?? 50
      let reps = head.repMax ?? head.repMin ?? 8
      let kind: StageKind | null = head.stageKind ?? null
      if (opts.diffs && !head.isWarmup) {
        if (exerciseId === 'e-bench' && n === 2) { weight = 82.5; reps = 7 }
        else if (exerciseId === 'e-bench' && n === 3) reps = 5
        else if (exerciseId === 'e-lat' && n === 1) kind = 'dropset'
      }
      const headLog = setLog(`${sessionId}-${head.id}`, sessionId, exerciseId, {
        weekPlanSetId: head.id,
        setNumber: n,
        weight,
        reps,
        rir: head.isWarmup ? null : (head.targetRir ?? 2),
        isWarmup: head.isWarmup,
        stageKind: kind,
        loggedAt: tick(180),
      })
      logs.push(headLog)
      for (const st of rowSets.filter((s) => s.parentWeekPlanSetId === head.id).sort((a, b) => a.stageIndex - b.stageIndex)) {
        logs.push(dropLog(`${sessionId}-${st.id}`, sessionId, exerciseId, headLog.id, st.stageIndex, { weekPlanSetId: st.id, setNumber: n, weight: st.targetWeight ?? head.targetWeight ?? 40, reps: st.repMax ?? 6, loggedAt: tick(20) }))
      }
      if (opts.diffs && exerciseId === 'e-lat' && n === 1 && !head.isWarmup) {
        // made a dropset during the session and one drop logged: a stage log with no planned stage behind it
        logs.push(dropLog(`${sessionId}-lat-extra-drop`, sessionId, exerciseId, headLog.id, 1, { weekPlanSetId: null, setNumber: n, weight: weight - 2, reps: 10, loggedAt: tick(20) }))
      }
    }
  }
  if (opts.diffs) {
    // a pushdown head nobody planned: the exercise's third head, 20 kg × 15
    const heads = logs.filter((l) => l.exerciseId === 'e-push' && !l.isWarmup && l.parentSetId === null).length
    logs.push(setLog(`${sessionId}-pushdown-extra`, sessionId, 'e-push', { weekPlanSetId: null, setNumber: heads + 1, weight: 20, reps: 15, rir: 2, loggedAt: tick(180) }))
  }
  if (opts.relabel) {
    // week 1's Lower A: the seed relabels the squat's working-set logs as leg press, keeping their planned sets
    return logs.map((l) => (l.exerciseId === opts.relabel!.from && !l.isWarmup ? { ...l, exerciseId: opts.relabel!.to, weight: 180 } : l))
  }
  return logs
}

// ─── Week 2 → week 3: the five items ─────────────────────────────────────────────────────────────

const week2 = { ua: planOf('ua', 2), la: planOf('la', 2), ub: planOf('ub', 2) }
const week3 = { ua: planOf('ua', 3), la: planOf('la', 3), ub: planOf('ub', 3) }
const sessionsOfWeek2 = (changes: SessionSetChange[] = []) => [
  session('s2-ua', week2.ua.id, 'completed', seedLogs(week2.ua, 's2-ua', { diffs: true }), { date: day(QUEUE_WEEK_2[0].date), workoutDayId: 'wd-ua', sessionSetChanges: changes }),
  session('s2-la', week2.la.id, 'completed', seedLogs(week2.la, 's2-la'), { date: day(QUEUE_WEEK_2[1].date), workoutDayId: 'wd-la' }),
  session('s2-ub', week2.ub.id, 'skipped', [], { date: day(QUEUE_WEEK_2[2].date), workoutDayId: 'wd-ub' }),
]
const listWeek3 = (decisions: Array<{ weekPlanId: string; itemKey: string }> = [], changes: SessionSetChange[] = []): ReviewGroup[] =>
  reviewItems({
    weekNumber: 3,
    lastWeek: { sessions: sessionsOfWeek2(changes), plan: [week2.ua, week2.la, week2.ub] },
    thisWeek: [week3.ua, week3.la, week3.ub],
    decisions,
  })
const flat = (groups: ReviewGroup[]): ReviewItem[] => groups.flatMap((g) => g.items.map((e) => e.item))
const ids = () => {
  let n = 0
  return () => `new-${++n}`
}

describe('the seed\'s week 2 → week 3 (the test account), REVIEW on week 3', () => {
  it('the queue: Monday Upper A done, Wednesday Lower A done (a deload), Friday Upper B skipped, on the weekdays the seed makes them', () => {
    const queue = QUEUE_WEEK_2.map((q) => `${format(q.date, 'EEEE')} ${day(q.date)} ${q.workout} ${q.status}`)
    expect(queue).toEqual([
      'Monday 2026-10-05 Upper A completed',
      'Wednesday 2026-10-07 Lower A completed',
      'Friday 2026-10-09 Upper B skipped',
    ])
    expect(format(weekDay(3, 0), 'EEEE yyyy-MM-dd')).toBe('Monday 2026-10-12') // week 3, the seed's current week
    console.info(`queue (week 2 → week 3): ${queue.join(' | ')}`)
  })

  it('lists exactly the five items of Upper A, in the workout\'s order, and nothing from Lower A (as planned) or Upper B (skipped)', () => {
    const groups = listWeek3()
    expect(groups.map((g) => [g.heading, g.items.length])).toEqual([['MON · UPPER A', 5]])
    const texts = flat(groups).map((item) => {
      const t = reviewItemText(item, { fromWeek: 3 })
      return [item.kind, t.eyebrow, t.headline, t.detail, t.action]
    })
    expect(texts).toEqual([
      ['number', 'BARBELL BENCH PRESS · SET 02', 'Did 82.5 kg × 7', 'planned 80 kg × 6–8 · RIR 2', 'USE 82.5 × 7'],
      ['number', 'BARBELL BENCH PRESS · SET 03', 'Did 80 kg × 5', 'planned 80 kg × 6–8 · RIR 2', 'USE 80 × 5'],
      ['skipped', 'SEATED CABLE ROW · SET 03', 'Skipped', 'planned 60 kg × 10–12 · RIR 2', 'REMOVE THIS SET'],
      ['retyped', 'DUMBBELL LATERAL RAISE · SET 01', 'You made set 01 a dropset', '1 drop', 'USE'],
      ['added_set', 'CABLE TRICEPS PUSHDOWN · ADDED A SET', 'Set 03 · 20 kg × 15', 'RIR 2', 'ADD THIS SET'],
    ])
  })

  it('the change rows chunk 62 writes for that lateral raise (a retyped row for the logged planned set, a pending-stages row for its head) leave the five items as they are', () => {
    // DECISIONS 141: the set was made a dropset after it was logged, so the workout left both rows; the log, its one
    // drop and the rows all say the same thing and make ONE type item, and the drop done decides the count (1, not 3)
    const rows: SessionSetChange[] = [
      { kind: 'retyped', weekPlanSetId: 'w2-ua-pe-lat-1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 3 } },
      { kind: 'pending_stages', setLogId: 's2-ua-w2-ua-pe-lat-1', stageKind: 'dropset', stageCount: 3 },
    ]
    const text = (groups: ReviewGroup[]) => flat(groups).map((item) => [item.kind, reviewItemText(item, { fromWeek: 3 })])
    expect(text(listWeek3([], rows))).toEqual(text(listWeek3()))
    expect(flat(listWeek3([], rows)).map((i) => i.kind)).toEqual(['number', 'number', 'skipped', 'retyped', 'added_set'])
  })

  it('DECISIONS 150: a type the workout gave the skipped Seated Cable Row set 03 (chunk 62\'s `retyped` row) is a sixth item beside its "Skipped"; the skipped Upper B gives none however many rows it has', () => {
    const rowSet3: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'w2-ua-pe-row-3', type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 } }
    const groups = listWeek3([], [rowSet3])
    expect(groups.map((g) => [g.heading, g.items.length])).toEqual([['MON · UPPER A', 6]])
    // the workout's order: the row's two items after bench, before the lateral raise; "Skipped" first, then the type
    expect(flat(groups).map((item) => {
      const t = reviewItemText(item, { fromWeek: 3 })
      return [item.kind, t.eyebrow, t.headline, t.detail, t.action]
    })).toEqual([
      ['number', 'BARBELL BENCH PRESS · SET 02', 'Did 82.5 kg × 7', 'planned 80 kg × 6–8 · RIR 2', 'USE 82.5 × 7'],
      ['number', 'BARBELL BENCH PRESS · SET 03', 'Did 80 kg × 5', 'planned 80 kg × 6–8 · RIR 2', 'USE 80 × 5'],
      ['skipped', 'SEATED CABLE ROW · SET 03', 'Skipped', 'planned 60 kg × 10–12 · RIR 2', 'REMOVE THIS SET'],
      ['retyped', 'SEATED CABLE ROW · SET 03', 'You made set 03 a dropset', '2 drops', 'USE'],
      ['retyped', 'DUMBBELL LATERAL RAISE · SET 01', 'You made set 01 a dropset', '1 drop', 'USE'],
      ['added_set', 'CABLE TRICEPS PUSHDOWN · ADDED A SET', 'Set 03 · 20 kg × 15', 'RIR 2', 'ADD THIS SET'],
    ])
    expect(groups.flatMap((g) => g.items.map((e) => e.key)).slice(2, 4)).toEqual(['skipped:s2-ua:w2-ua-pe-row-3', 'type:s2-ua:w2-ua-pe-row-3'])
    // USE on it types week 3's row set 3 (its own id, not week 2's) as a dropset of two drops
    const typeItem = flat(groups)[3]
    const used = applyWrites(week3.ua, applyReviewAction(typeItem, 'use', week3.ua, ids()).writes)
    expect(used.sets.find((s) => s.id === 'w3-ua-pe-row-3')).toMatchObject({ stageKind: 'dropset' })
    expect(used.sets.filter((s) => s.parentWeekPlanSetId === 'w3-ua-pe-row-3').map((s) => s.stageIndex)).toEqual([1, 2])
    // Friday's Upper B was skipped as a whole (G52): a row on its first set adds nothing
    const upperBRow: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'w2-ub-pe-pullup-1', type: { kind: 'normal' } }
    const withUpperBRow = sessionsOfWeek2().map((s) => (s.id === 's2-ub' ? { ...s, sessionSetChanges: [upperBRow] } : s))
    const upperB = reviewItems({ weekNumber: 3, lastWeek: { sessions: withUpperBRow, plan: [week2.ua, week2.la, week2.ub] }, thisWeek: [week3.ua, week3.la, week3.ub], decisions: [] })
    expect(upperB.map((g) => [g.heading, g.items.length])).toEqual([['MON · UPPER A', 5]])
    // the control: finished instead of skipped, the same row is the pull-up's type item (the status is the only difference)
    const finished = sessionsOfWeek2().map((s) => (s.id === 's2-ub' ? { ...s, status: 'completed' as const, sessionSetChanges: [upperBRow] } : s))
    const control = reviewItems({ weekNumber: 3, lastWeek: { sessions: finished, plan: [week2.ua, week2.la, week2.ub] }, thisWeek: [week3.ua, week3.la, week3.ub], decisions: [] })
    expect(control.find((g) => g.heading.startsWith('FRI'))?.items.map((e) => e.key)).toContain('type:s2-ub:w2-ub-pe-pullup-1')
  })

  it('the five keys, none of them a set log id', () => {
    const groups = listWeek3()
    const keys = groups.flatMap((g) => g.items.map((e) => e.key))
    expect(keys).toEqual([
      'num:s2-ua:w2-ua-pe-bench-3',
      'num:s2-ua:w2-ua-pe-bench-4',
      'skipped:s2-ua:w2-ua-pe-row-3',
      'type:s2-ua:w2-ua-pe-lat-1',
      'added-set:s2-ua:e-push:3',
    ])
    const logIds = sessionsOfWeek2().flatMap((s) => (s.setLogs ?? []).map((l) => l.id))
    for (const key of keys) for (const logId of logIds) expect(key.includes(logId), `${key} holds ${logId}`).toBe(false)
  })

  it('each item points at its set of week 3: the matching planned position, in week 3\'s own rows', () => {
    const targets = flat(listWeek3()).map((i) => ('target' in i ? i.target : null))
    expect(targets).toEqual([
      { programExerciseId: 'pe-bench', setId: 'w3-ua-pe-bench-3' },
      { programExerciseId: 'pe-bench', setId: 'w3-ua-pe-bench-4' },
      { programExerciseId: 'pe-row', setId: 'w3-ua-pe-row-3' },
      { programExerciseId: 'pe-lat', setId: 'w3-ua-pe-lat-1' },
      { programExerciseId: 'pe-push' },
    ])
  })

  it('"the line says 5 things"; deciding one leaves 4; deciding all leaves none and the line is gone', () => {
    const decide = (keys: string[]) => keys.map((itemKey) => ({ weekPlanId: week3.ua.id, itemKey }))
    const all = listWeek3().flatMap((g) => g.items.map((e) => e.key))
    expect(all).toHaveLength(5)
    expect(flat(listWeek3(decide(all.slice(0, 1))))).toHaveLength(4)
    expect(listWeek3(decide(all))).toEqual([])
  })

  it('the actions, on the seed\'s week 3: USE 82.5 × 7 into bench 02; ADD THIS SET appends the third pushdown head; the type USE adds one drop; REMOVE takes row 03 out', () => {
    const [bench2, , row3, lat1, pushdown] = flat(listWeek3())
    const act = (item: ReviewItem, action: 'use' | 'add_set' | 'remove_set', plan: WeekPlan) => applyReviewAction(item, action, plan, ids())
    const setsOf = (plan: WeekPlan, pe: string) => plan.sets.filter((s) => s.programExerciseId === pe && s.parentWeekPlanSetId === null).sort((a, b) => a.setNumber - b.setNumber)

    // USE: week 3's bench working set 2 (set number 3, after the warmup) ends at 82.5 × 7 (it was 82.5 × 6–8)
    const used = applyWrites(week3.ua, act(bench2, 'use', week3.ua).writes)
    const benchSet2 = setsOf(used, 'pe-bench')[2]
    expect([benchSet2.id, benchSet2.targetWeight, benchSet2.repMin, benchSet2.repMax]).toEqual(['w3-ua-pe-bench-3', 82.5, 7, 7])
    expect(setsOf(used, 'pe-bench')[3]).toEqual(setsOf(week3.ua, 'pe-bench')[3]) // set 3 untouched

    // ADD THIS SET: the pushdown gets a third head, 20 kg × 15, after its two
    const added = applyWrites(week3.ua, act(pushdown, 'add_set', week3.ua).writes)
    const pushHeads = setsOf(added, 'pe-push')
    expect(pushHeads.map((s) => [s.setNumber, s.targetWeight, s.repMin, s.repMax, s.stageKind])).toEqual([
      [1, 32.5, 10, 12, null], // week 3 is 2.5 kg heavier than week 2
      [2, 32.5, 10, 12, 'dropset'],
      [3, 20, 15, 15, null],
    ])

    // the type USE: week 3's lateral raise set 1 becomes a dropset with one drop
    const retyped = applyWrites(week3.ua, act(lat1, 'use', week3.ua).writes)
    const lat = retyped.sets.filter((s) => s.programExerciseId === 'pe-lat')
    expect(lat.find((s) => s.id === 'w3-ua-pe-lat-1')).toMatchObject({ stageKind: 'dropset' })
    expect(lat.filter((s) => s.parentWeekPlanSetId === 'w3-ua-pe-lat-1').map((s) => [s.stageIndex, s.isDropset])).toEqual([[1, true]])

    // REMOVE THIS SET: row set 3 leaves week 3
    const removed = applyWrites(week3.ua, act(row3, 'remove_set', week3.ua).writes)
    expect(setsOf(removed, 'pe-row').map((s) => s.id)).toEqual(['w3-ua-pe-row-1', 'w3-ua-pe-row-2'])
  })

  it('a deload session done as planned has no items (Lower A), and a skipped one none (Upper B): the fixture tells them from Upper A', () => {
    const groups = reviewItems({
      weekNumber: 3,
      lastWeek: { sessions: sessionsOfWeek2().filter((s) => s.id !== 's2-ua'), plan: [week2.ua, week2.la, week2.ub] },
      thisWeek: [week3.ua, week3.la, week3.ub],
      decisions: [],
    })
    expect(groups).toEqual([])
  })
})

// ─── Week 1 → week 2 ─────────────────────────────────────────────────────────────────────────────

describe('the seed\'s week 1 → week 2 (REVIEW on week 2)', () => {
  const week1 = { ua: planOf('ua', 1), la: planOf('la', 1), ub: planOf('ub', 1) }
  const sessionsOfWeek1 = () => [
    session('s1-ua', week1.ua.id, 'completed', seedLogs(week1.ua, 's1-ua'), { date: day(weekDay(1, 0)), workoutDayId: 'wd-ua' }),
    session('s1-la', week1.la.id, 'completed', seedLogs(week1.la, 's1-la', { relabel: { from: 'e-squat', to: 'e-legpress' } }), {
      date: day(weekDay(1, 2)),
      workoutDayId: 'wd-la',
      // the seed's swap row: the squat swapped for leg press that day
      swaps: [swapRecord({ programExerciseId: 'pe-squat', originalExerciseId: 'e-squat', originalExerciseName: 'Back Squat', replacementExerciseId: 'e-legpress', replacementExerciseName: 'Leg Press' })],
    }),
    // done on Saturday (moved from Friday), the third head skipped
    session('s1-ub', week1.ub.id, 'completed', seedLogs(week1.ub, 's1-ub', { skipHead: 3 }), { date: day(weekDay(1, 4)), movedToDate: day(weekDay(1, 5)), workoutDayId: 'wd-ub' }),
  ]

  it('the queue: Monday Upper A, Wednesday Lower A (the squat swapped), Friday Upper B done on Saturday', () => {
    const sessions = sessionsOfWeek1().map((s) => `${format(parseISO(s.movedToDate ?? s.date), 'EEEE')} ${s.workoutDay?.name ?? s.workoutDayId}`)
    expect(sessions).toEqual(['Monday wd-ua', 'Wednesday wd-la', 'Saturday wd-ub'])
  })

  it('lists the swap (Lower A) and the skipped set (Upper B, under the day it was done); Upper A, done as planned, gives none', () => {
    const groups = reviewItems({
      weekNumber: 2,
      lastWeek: { sessions: sessionsOfWeek1(), plan: [week1.ua, week1.la, week1.ub] },
      thisWeek: [week2.ua, week2.la, week2.ub],
      decisions: [],
    })
    expect(groups.map((g) => [g.heading, g.items.map((e) => e.item.kind)])).toEqual([
      ['WED · LOWER A', ['swapped']],
      ['SAT · UPPER B', ['skipped']],
    ])
    const [swap, skipped] = flat(groups)
    expect(reviewItemText(swap, { fromWeek: 2 })).toMatchObject({ headline: 'Back Squat → Leg Press', detail: 'for all 3 sets', action: 'SWAP FROM WEEK 2' })
    expect(reviewItemText(skipped, { fromWeek: 2 })).toMatchObject({ eyebrow: 'PULL-UP · SET 03', headline: 'Skipped' })
  })
})
