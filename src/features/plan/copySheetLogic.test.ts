import { describe, it, expect } from 'vitest'
import type { WeekPlan, WeekPlanSet } from '../../types'
import { copyEyebrow, copyFieldsOffered, copyRows, copyUpdates, numbersOps, pickedWorkouts, type CopyRow } from './copySheetLogic'
import type { CopyField } from './weekPlanning'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 52 (TASKS-1.2 "Plan's header" → CopySheet; SPEC Weeks and copying [1.2] → COPY (2c); G53). What COPY's sheet decides, as pure functions:
// which week each workout copies from, what the sheet offers, who is picked, what changes and the ops that write it.

const PE_A = pe('pe-a', 'bench', 0)
const PE_B = pe('pe-b', 'row', 0, { workoutDayId: 'wd-b' })

// One workout's plan for a week: a bench set (A) or a row set (B), weight and RIR as given.
function planOf(slot: 'a' | 'b', week: number, over: Partial<WeekPlanSet> = {}, planOver: Partial<WeekPlan> = {}): WeekPlan {
  const exercise = slot === 'a' ? PE_A : PE_B
  return plan(week, [exercise], [wset(`s-${slot}-${week}`, exercise.id, 1, over)], {
    id: `wp-${slot}-${week}`,
    workoutDayId: `wd-${slot}`,
    ...planOver,
  })
}

const done = (...ids: string[]) => new Set(ids)
const label = (wp: WeekPlan) => ({ day: wp.workoutDayId === 'wd-a' ? 'MON' : 'WED', name: wp.workoutDayId === 'wd-a' ? 'Upper' : 'Lower' })

describe('copyRows — each workout copies from its own last planned normal, non-empty week', () => {
  it('skips a deload week and an empty week, per workout, and is not simply last week', () => {
    // A: week 3 was a deload, so its source is week 2. B: week 3 has no sets (an empty week), so its source is week 2 too.
    // C: nothing wrong with week 3, so its source is week 3.
    const planC = (week: number) => plan(week, [PE_A], [wset(`s-c-${week}`, 'pe-a', 1)], { id: `wp-c-${week}`, workoutDayId: 'wd-c' })
    const all = [
      planOf('a', 1), planOf('a', 2, { targetWeight: 105 }), planOf('a', 3, {}, { isDeload: true }),
      planOf('b', 1), planOf('b', 2), plan(3, [PE_B], [], { id: 'wp-b-3', workoutDayId: 'wd-b' }),
      planC(1), planC(2), planC(3),
    ]
    const thisWeek = [planOf('a', 4), planOf('b', 4), planC(4)]
    const rows = copyRows({ thisWeek, allWeekPlans: [...all, ...thisWeek], doneWeekPlanIds: done(), label: () => ({ day: '', name: '' }) })
    expect(rows.map((r) => [r.id, r.sourceWeek, r.state])).toEqual([
      ['wp-a-4', 2, 'open'],
      ['wp-b-4', 2, 'open'],
      ['wp-c-4', 3, 'open'],
    ])
    // the source is that week's plan itself: A's week 2 carries 105
    expect(rows[0].source?.id).toBe('wp-a-2')
    expect(rows[0].source?.sets[0].targetWeight).toBe(105)
  })

  it('after a week off the source is the last planned week, not the week before this one (DECISIONS 131, 132)', () => {
    // weeks 1 and 2 planned, week 3 never planned, this week is 4
    const thisWeek = [planOf('a', 4)]
    const rows = copyRows({ thisWeek, allWeekPlans: [planOf('a', 1), planOf('a', 2), ...thisWeek], doneWeekPlanIds: done(), label })
    expect(rows[0].sourceWeek).toBe(2)
    expect(rows[0].state).toBe('open')
  })

  it('a workout with no usable earlier week has no source; a done workout is done, whatever its source', () => {
    const thisWeek = [planOf('a', 2), planOf('b', 2)]
    const all = [planOf('a', 1), ...thisWeek] // B was never planned before this week
    const rows = copyRows({ thisWeek, allWeekPlans: all, doneWeekPlanIds: done('wp-a-2'), label })
    expect(rows.map((r) => [r.id, r.state, r.sourceWeek])).toEqual([
      ['wp-a-2', 'done', 1],
      ['wp-b-2', 'no_source', null],
    ])
    expect(rows[1].source).toBeNull()
  })

  it('on a sequence run each slot of a repeated workout copies from its own history (workout and sequence position)', () => {
    const slot = (position: number, week: number) =>
      plan(week, [PE_A], [wset(`s-${position}-${week}`, 'pe-a', 1)], { id: `wp-${position}-${week}`, sequencePosition: position })
    // slot 0 was planned in cycles 1 and 2; slot 2 of the same workout only in cycle 1
    const thisCycle = [slot(0, 3), slot(2, 3)]
    const all = [slot(0, 1), slot(0, 2), slot(2, 1), ...thisCycle]
    const rows = copyRows({ thisWeek: thisCycle, allWeekPlans: all, doneWeekPlanIds: done(), label: () => ({ day: '', name: '' }) })
    expect(rows.map((r) => [r.id, r.sourceWeek])).toEqual([
      ['wp-0-3', 2],
      ['wp-2-3', 1],
    ])
    expect(rows[1].source?.id).toBe('wp-2-1')
  })

  it('names each row by the caller\'s label', () => {
    const thisWeek = [planOf('a', 2)]
    const rows = copyRows({ thisWeek, allWeekPlans: [planOf('a', 1), ...thisWeek], doneWeekPlanIds: done(), label })
    expect(rows[0]).toMatchObject({ day: 'MON', name: 'Upper' })
  })
})

describe('copyFieldsOffered — G53: a stable week copies Weight and RIR only', () => {
  it('offers all three on a week-dependent run and no REPS on a stable one', () => {
    expect(copyFieldsOffered('week_dependent')).toEqual(['weight', 'reps', 'rir'])
    expect(copyFieldsOffered('stable')).toEqual(['weight', 'rir'])
  })
})

describe('pickedWorkouts — the one place that says who can be copied into', () => {
  const row = (id: string, state: CopyRow['state']): CopyRow => ({ id, day: '', name: id, state, sourceWeek: state === 'no_source' ? null : 1, source: null })
  it('is every ticked workout that is open, and never a done one or one with no source, whatever is ticked', () => {
    const rows = [row('open', 'open'), row('done', 'done'), row('none', 'no_source'), row('unticked', 'open')]
    expect(pickedWorkouts(rows, new Set(['open', 'done', 'none'])).map((r) => r.id)).toEqual(['open'])
  })
})

describe('copyUpdates — what changes, for the fields, workouts and overwrite chosen', () => {
  // Week 4: A's box is empty and B's holds a typed 60. Last week's sources: A week 2 at 100 kg, B week 3 at 80 kg.
  function world() {
    const thisWeek = [
      planOf('a', 4, { targetWeight: null, targetRir: null, repMin: null, repMax: null }),
      planOf('b', 4, { targetWeight: 60, targetRir: null, repMin: null, repMax: null }),
    ]
    const all = [planOf('a', 2, { targetWeight: 100, targetRir: 1, repMin: 6, repMax: 8 }), planOf('b', 3, { targetWeight: 80, targetRir: 1, repMin: 6, repMax: 8 }), ...thisWeek]
    const rows = copyRows({ thisWeek, allWeekPlans: all, doneWeekPlanIds: done(), label })
    return { thisWeek, rows }
  }
  const all3 = new Set<CopyField>(['weight', 'reps', 'rir'])

  it('overwrite off fills empty boxes only; a typed number stays (asserted on the op list)', () => {
    const { thisWeek, rows } = world()
    const updates = copyUpdates({ rows, picked: new Set(rows.map((r) => r.id)), fields: new Set<CopyField>(['weight']), overwrite: false, thisWeek })
    expect(numbersOps(updates)).toEqual([{ op: 'update', table: 'v2_week_plan_sets', id: 's-a-4', patch: { target_weight: 100 } }])
  })

  it('overwrite on replaces the typed number with the source\'s, B from its own week (80, not A\'s 100)', () => {
    const { thisWeek, rows } = world()
    const updates = copyUpdates({ rows, picked: new Set(rows.map((r) => r.id)), fields: new Set<CopyField>(['weight']), overwrite: true, thisWeek })
    expect(numbersOps(updates)).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: 's-a-4', patch: { target_weight: 100 } },
      { op: 'update', table: 'v2_week_plan_sets', id: 's-b-4', patch: { target_weight: 80 } },
    ])
  })

  it('writes only the fields ticked: weight alone leaves reps and RIR; all three write all three groups', () => {
    const { thisWeek, rows } = world()
    const picked = new Set(['wp-a-4'])
    expect(numbersOps(copyUpdates({ rows, picked, fields: new Set<CopyField>(['weight']), overwrite: false, thisWeek }))[0]).toEqual({
      op: 'update', table: 'v2_week_plan_sets', id: 's-a-4', patch: { target_weight: 100 },
    })
    expect(numbersOps(copyUpdates({ rows, picked, fields: all3, overwrite: false, thisWeek }))[0]).toEqual({
      op: 'update', table: 'v2_week_plan_sets', id: 's-a-4',
      patch: { target_weight: 100, rep_min: 6, rep_max: 8, is_amrap: false, target_rir: 1, target_rir_max: null },
    })
  })

  it('a workout that is not ticked is left alone', () => {
    const { thisWeek, rows } = world()
    const updates = copyUpdates({ rows, picked: new Set(['wp-b-4']), fields: all3, overwrite: true, thisWeek })
    expect(updates.map((u) => u.weekPlanId)).toEqual(['wp-b-4'])
  })

  it('a done workout is never copied into, even when it is in the picked set (break: the filter in pickedWorkouts)', () => {
    const thisWeek = [planOf('a', 4, { targetWeight: null }), planOf('b', 4, { targetWeight: null })]
    const all = [planOf('a', 2, { targetWeight: 100 }), planOf('b', 3, { targetWeight: 80 }), ...thisWeek]
    const rows = copyRows({ thisWeek, allWeekPlans: all, doneWeekPlanIds: done('wp-a-4'), label })
    const updates = copyUpdates({ rows, picked: new Set(['wp-a-4', 'wp-b-4']), fields: new Set<CopyField>(['weight']), overwrite: true, thisWeek })
    expect(updates.map((u) => u.setId)).toEqual(['s-b-4'])
  })

  it('a stable week\'s fields (weight and RIR) write no rep-target column even when last week\'s reps differ (G53; break: offer REPS)', () => {
    const { thisWeek, rows } = world()
    const fields = new Set(copyFieldsOffered('stable'))
    const ops = numbersOps(copyUpdates({ rows, picked: new Set(rows.map((r) => r.id)), fields, overwrite: true, thisWeek }))
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) {
      if (op.op !== 'update') throw new Error('an update was expected')
      expect(Object.keys(op.patch).sort()).toEqual(['target_rir', 'target_rir_max', 'target_weight'])
    }
  })

  it('an RIR range copies as a range, and a range replaced by a number empties its high end', () => {
    const thisWeek = [planOf('a', 4, { targetRir: 2, targetRirMax: 4 })]
    const all = [planOf('a', 3, { targetRir: 1, targetRirMax: null }), ...thisWeek]
    const rows = copyRows({ thisWeek, allWeekPlans: all, doneWeekPlanIds: done(), label })
    const ops = numbersOps(copyUpdates({ rows, picked: new Set(['wp-a-4']), fields: new Set<CopyField>(['rir']), overwrite: true, thisWeek }))
    expect(ops).toEqual([{ op: 'update', table: 'v2_week_plan_sets', id: 's-a-4', patch: { target_rir: 1, target_rir_max: null } }])
  })

  it('nothing to change is an empty list', () => {
    const thisWeek = [planOf('a', 4, { targetWeight: 100 })]
    const rows = copyRows({ thisWeek, allWeekPlans: [planOf('a', 3, { targetWeight: 100 }), ...thisWeek], doneWeekPlanIds: done(), label })
    expect(copyUpdates({ rows, picked: new Set(['wp-a-4']), fields: new Set<CopyField>(['weight']), overwrite: true, thisWeek })).toEqual([])
  })

  it('gives the same ops whatever order the weeks and sets come in', () => {
    const { thisWeek, rows } = world()
    const forward = numbersOps(copyUpdates({ rows, picked: new Set(rows.map((r) => r.id)), fields: all3, overwrite: true, thisWeek }))
    const reversedThisWeek = [...thisWeek].reverse().map((wp) => ({ ...wp, sets: [...wp.sets].reverse(), exercises: [...wp.exercises].reverse() }))
    const reversedRows = [...rows].reverse().map((r) => ({ ...r, source: r.source && { ...r.source, sets: [...r.source.sets].reverse() } }))
    const backward = numbersOps(copyUpdates({ rows: reversedRows, picked: new Set(rows.map((r) => r.id)), fields: all3, overwrite: true, thisWeek: reversedThisWeek }))
    const byId = (ops: ReturnType<typeof numbersOps>) => [...ops].sort((x, y) => ('id' in x && 'id' in y ? String(x.id).localeCompare(String(y.id)) : 0))
    expect(byId(backward)).toEqual(byId(forward))
  })
})

describe('numbersOps — the columns a copy writes, and only those', () => {
  it('maps every field of a change to its column and leaves a key the change lacks out', () => {
    const ops = numbersOps([
      { weekPlanId: 'wp', setId: 's1', changes: { targetWeight: 82.5, repMin: 8, repMax: 10, isAmrap: false, targetRir: 1, targetRirMax: 2 } },
      { weekPlanId: 'wp', setId: 's2', changes: { targetWeight: 60 } },
    ])
    expect(ops).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: 's1', patch: { target_weight: 82.5, rep_min: 8, rep_max: 10, is_amrap: false, target_rir: 1, target_rir_max: 2 } },
      { op: 'update', table: 'v2_week_plan_sets', id: 's2', patch: { target_weight: 60 } },
    ])
  })

  it('keeps a null (an emptied box) and never writes an undefined', () => {
    const [op] = numbersOps([{ weekPlanId: 'wp', setId: 's', changes: { targetRirMax: null, repMin: undefined, targetWeight: 50 } }])
    if (op.op !== 'update') throw new Error('an update was expected')
    expect(op.patch).toEqual({ target_rir_max: null, target_weight: 50 })
    expect('rep_min' in op.patch).toBe(false)
  })
})

describe('copyEyebrow — board 2: "WEEK 2 · FROM WEEK 1\'S PLAN"', () => {
  const rows = (...sources: Array<number | null | 'done'>): CopyRow[] =>
    sources.map((s, i) => ({
      id: `r${i}`, day: '', name: '',
      state: s === 'done' ? 'done' : s === null ? 'no_source' : 'open',
      sourceWeek: s === 'done' ? 3 : s,
      source: null,
    }))

  it('names the one week the numbers come from', () => {
    expect(copyEyebrow({ unit: 'WEEK', week: 2, rows: rows(1, 1) })).toBe("WEEK 2 · FROM WEEK 1'S PLAN")
    expect(copyEyebrow({ unit: 'CYCLE', week: 3, rows: rows(2) })).toBe("CYCLE 3 · FROM CYCLE 2'S PLAN")
  })

  it('names the weeks when workouts copy from different ones, up to three, else "earlier weeks"', () => {
    expect(copyEyebrow({ unit: 'WEEK', week: 4, rows: rows(2, 3, 3) })).toBe('WEEK 4 · FROM WEEKS 2 AND 3')
    expect(copyEyebrow({ unit: 'WEEK', week: 6, rows: rows(1, 3, 5) })).toBe('WEEK 6 · FROM WEEKS 1, 3 AND 5')
    expect(copyEyebrow({ unit: 'WEEK', week: 9, rows: rows(1, 3, 5, 7) })).toBe('WEEK 9 · FROM EARLIER WEEKS')
  })

  it('leaves out a done workout and one with no source; with none left it names only the week', () => {
    expect(copyEyebrow({ unit: 'WEEK', week: 4, rows: rows(2, 'done', null) })).toBe("WEEK 4 · FROM WEEK 2'S PLAN")
    expect(copyEyebrow({ unit: 'WEEK', week: 4, rows: rows('done', null) })).toBe('WEEK 4')
  })
})
