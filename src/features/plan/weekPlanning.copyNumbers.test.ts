import { describe, it, expect } from 'vitest'
import type { WeekPlanSet } from '../../types'
import { copyNumbers, type CopyField, type CopyWorkout, type SetNumbersUpdate } from './weekPlanning'
import { pe, stage, wset } from './weekPlanning.testutil'

// Chunk 42 — COPY: last week's numbers into this week (SPEC, Weeks and copying → COPY (2c); G49; G53). copyNumbers
// returns the update each this-week set would get; chunk 52's sheet turns them into one `applyOps` request and proves
// its own write. Every rule here is asserted on the updates themselves, with a fixture whose wrong reading gives a
// different update (a warmup next to working sets, a typed number next to an empty box, two slots of one workout).

const NOTHING = { targetWeight: null, targetRir: null, targetRirMax: null, repMin: null, repMax: null, isAmrap: false } as const

function workout(
  id: string,
  rows: { exercises: Array<[string, string, number]>; sets: WeekPlanSet[] },
  over: Partial<CopyWorkout> = {},
): CopyWorkout {
  return {
    id,
    workoutDayId: 'wd-pull',
    exercises: rows.exercises.map(([rowId, exerciseId, position]) => pe(rowId, exerciseId, position)),
    sets: rows.sets,
    ...over,
  }
}

const ALL: CopyField[] = ['weight', 'reps', 'rir']

// Last week's Lat Pulldown: a warmup (20 kg × 12, a legacy RIR 5), a working set (55 kg × 8–10, RIR 2), a dropset head
// (55 kg × 8–10, RIR 2) with an AMRAP drop (40 kg, RIR 0).
function lastLat(): WeekPlanSet[] {
  return [
    wset('l-w', 'pe-lat', 1, { isWarmup: true, targetWeight: 20, targetRir: 5, repMin: 12, repMax: 12 }),
    wset('l-1', 'pe-lat', 2, { targetWeight: 55, targetRir: 2, repMin: 8, repMax: 10 }),
    wset('l-d', 'pe-lat', 3, { targetWeight: 55, targetRir: 2, repMin: 8, repMax: 10, stageKind: 'dropset' }),
    stage('l-d1', 'l-d', 'pe-lat', 1, { targetWeight: 40, targetRir: 0, repMin: null, repMax: null, isAmrap: true }),
  ]
}
// This week's: the same structure, no numbers.
function emptyLat(over: Record<string, Partial<WeekPlanSet>> = {}): WeekPlanSet[] {
  return [
    wset('t-w', 'pe-lat', 1, { isWarmup: true, ...NOTHING, ...over['t-w'] }),
    wset('t-1', 'pe-lat', 2, { ...NOTHING, ...over['t-1'] }),
    wset('t-d', 'pe-lat', 3, { ...NOTHING, stageKind: 'dropset', ...over['t-d'] }),
    stage('t-d1', 't-d', 'pe-lat', 1, { ...NOTHING, ...over['t-d1'] }),
  ]
}

const lat = (sets: WeekPlanSet[]) => ({ exercises: [['pe-lat', 'lat', 0]] as Array<[string, string, number]>, sets })

const run = (
  over: { fields?: CopyField[]; overwrite?: boolean; last?: CopyWorkout[]; this?: CopyWorkout[]; workouts?: string[] } = {},
): SetNumbersUpdate[] =>
  copyNumbers({
    fields: over.fields ?? ALL,
    workouts: over.workouts ?? ['wp-2'],
    overwrite: over.overwrite ?? false,
    lastWeek: over.last ?? [workout('wp-1', lat(lastLat()))],
    thisWeek: over.this ?? [workout('wp-2', lat(emptyLat()))],
  })

const changesOf = (updates: SetNumbersUpdate[], setId: string) => updates.find((u) => u.setId === setId)?.changes

// Writes the updates into this week's sets, the way the sheet's request will, so a second copy can be run on the result.
function applied(sets: WeekPlanSet[], updates: SetNumbersUpdate[]): WeekPlanSet[] {
  return sets.map((s) => ({ ...s, ...updates.find((u) => u.setId === s.id)?.changes }))
}

// ─── What it writes ───────────────────────────────────────────────────────────────────────────────────────────────

describe('copyNumbers — the matched set\'s weight, reps and RIR, set by set', () => {
  it('fills an empty week from last week: heads and their stages, warmups from warmups, working sets from working sets', () => {
    expect(run()).toEqual([
      // the warmup: weight and reps, never a RIR (G49)
      { weekPlanId: 'wp-2', setId: 't-w', changes: { targetWeight: 20, repMin: 12, repMax: 12, isAmrap: false } },
      { weekPlanId: 'wp-2', setId: 't-1', changes: { targetWeight: 55, repMin: 8, repMax: 10, isAmrap: false, targetRir: 2, targetRirMax: null } },
      { weekPlanId: 'wp-2', setId: 't-d', changes: { targetWeight: 55, repMin: 8, repMax: 10, isAmrap: false, targetRir: 2, targetRirMax: null } },
      // the drop takes the drop's own numbers: 40 kg, an AMRAP, RIR 0 (a 0 is a RIR, not "empty")
      { weekPlanId: 'wp-2', setId: 't-d1', changes: { targetWeight: 40, repMin: null, repMax: null, isAmrap: true, targetRir: 0, targetRirMax: null } },
    ])
  })

  it('writes only the groups the chosen fields name', () => {
    expect(run({ fields: ['weight'] }).map((u) => u.changes)).toEqual([
      { targetWeight: 20 }, { targetWeight: 55 }, { targetWeight: 55 }, { targetWeight: 40 },
    ])
    expect(changesOf(run({ fields: ['reps'] }), 't-1')).toEqual({ repMin: 8, repMax: 10, isAmrap: false })
    expect(changesOf(run({ fields: ['rir'] }), 't-1')).toEqual({ targetRir: 2, targetRirMax: null })
    expect(run({ fields: [] })).toEqual([])
  })

  it('a stable week offers Weight and RIR only (G53): with no Reps, no rep column is ever written', () => {
    const updates = run({ fields: ['weight', 'rir'] })
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) {
      expect(u.changes).not.toHaveProperty('repMin')
      expect(u.changes).not.toHaveProperty('repMax')
      expect(u.changes).not.toHaveProperty('isAmrap')
    }
  })

  it('a set whose matched numbers are already there is not returned (nothing to change); a second copy is empty', () => {
    const first = run()
    expect(first).toHaveLength(4)
    const again = run({ this: [workout('wp-2', lat(applied(emptyLat(), first)))] })
    expect(again).toEqual([])
    expect(run({ this: [workout('wp-2', lat(applied(emptyLat(), first)))], overwrite: true })).toEqual([])
  })

  it('the update names this week\'s workout row and set, not last week\'s', () => {
    const [first] = run()
    expect(first).toMatchObject({ weekPlanId: 'wp-2', setId: 't-w' })
  })
})

// ─── Overwrite ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('copyNumbers — "Overwrite what\'s already there": off fills empty boxes only; on replaces typed numbers too', () => {
  const typed = { 't-1': { targetWeight: 60, targetRir: 3, repMin: 6, repMax: 6 } } // a typed set; the rest stay empty

  it('off: a typed 60 kg, 6 reps and RIR 3 are left alone, an empty box is filled', () => {
    const updates = run({ overwrite: false, this: [workout('wp-2', lat(emptyLat(typed)))] })
    expect(changesOf(updates, 't-1')).toBeUndefined()
    expect(changesOf(updates, 't-d')).toEqual({ targetWeight: 55, repMin: 8, repMax: 10, isAmrap: false, targetRir: 2, targetRirMax: null })
  })

  it('off fills each box on its own: a typed weight stays while the empty reps and RIR beside it are filled', () => {
    const updates = run({ overwrite: false, this: [workout('wp-2', lat(emptyLat({ 't-1': { targetWeight: 60 } })))] })
    expect(changesOf(updates, 't-1')).toEqual({ repMin: 8, repMax: 10, isAmrap: false, targetRir: 2, targetRirMax: null })
  })

  it('on: the typed numbers are replaced with last week\'s', () => {
    const updates = run({ overwrite: true, this: [workout('wp-2', lat(emptyLat(typed)))] })
    expect(changesOf(updates, 't-1')).toEqual({ targetWeight: 55, repMin: 8, repMax: 10, isAmrap: false, targetRir: 2, targetRirMax: null })
  })

  it('a typed 0 is a value, not an empty box: off leaves it, on replaces it', () => {
    const zero = { 't-1': { targetWeight: 0, targetRir: 0 } }
    expect(changesOf(run({ fields: ['weight', 'rir'], this: [workout('wp-2', lat(emptyLat(zero)))] }), 't-1')).toBeUndefined()
    expect(changesOf(run({ fields: ['weight', 'rir'], overwrite: true, this: [workout('wp-2', lat(emptyLat(zero)))] }), 't-1')).toEqual({
      targetWeight: 55,
      targetRir: 2,
      targetRirMax: null,
    })
  })

  it('a 0 kg last week is copied (a value) into an empty box', () => {
    const last = lastLat().map((s) => (s.id === 'l-1' ? { ...s, targetWeight: 0 } : s))
    expect(changesOf(run({ fields: ['weight'], last: [workout('wp-1', lat(last))] }), 't-1')).toEqual({ targetWeight: 0 })
  })

  it('a box last week left empty is never copied, even over a typed number with overwrite on', () => {
    const last = lastLat().map((s) => (s.id === 'l-1' ? { ...s, targetWeight: null, targetRir: null, repMin: null, repMax: null } : s))
    const updates = run({ overwrite: true, last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat(emptyLat(typed)))] })
    expect(changesOf(updates, 't-1')).toBeUndefined()
  })
})

// ─── Matching ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('copyNumbers — matched the way stable weights were: exercise, then position, warmups to warmups, working sets to working sets', () => {
  it('a warmup never takes a working set\'s weight: last week had no warmup, so this week\'s has no counterpart, and each working set meets its own', () => {
    const last = [wset('l-1', 'pe-lat', 1, { targetWeight: 55 }), wset('l-2', 'pe-lat', 2, { targetWeight: 60 })]
    const mine = [
      wset('t-w', 'pe-lat', 1, { isWarmup: true, ...NOTHING }),
      wset('t-1', 'pe-lat', 2, NOTHING),
      wset('t-2', 'pe-lat', 3, NOTHING),
    ]
    const updates = run({ fields: ['weight'], last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat(mine))] })
    expect(changesOf(updates, 't-w')).toBeUndefined() // not 55
    expect(changesOf(updates, 't-1')).toEqual({ targetWeight: 55 })
    expect(changesOf(updates, 't-2')).toEqual({ targetWeight: 60 })
  })

  it('a warmup last week had and this week doesn\'t is not a reason for a working set to take its weight', () => {
    const last = [
      wset('l-w', 'pe-lat', 1, { isWarmup: true, targetWeight: 20 }),
      wset('l-1', 'pe-lat', 2, { targetWeight: 55 }),
    ]
    const mine = [wset('t-1', 'pe-lat', 1, NOTHING)]
    const updates = run({ fields: ['weight'], last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat(mine))] })
    expect(updates).toEqual([{ weekPlanId: 'wp-2', setId: 't-1', changes: { targetWeight: 55 } }])
  })

  it('sets are paired by position within their kind in set-number order, however the rows come in on either side', () => {
    const last = [wset('l-2', 'pe-lat', 2, { targetWeight: 60 }), wset('l-1', 'pe-lat', 1, { targetWeight: 55 })] // last week's rows reversed
    const mine = [wset('t-1', 'pe-lat', 1, NOTHING), wset('t-2', 'pe-lat', 2, NOTHING)] // this week's in order
    const updates = run({ fields: ['weight'], last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat(mine))] })
    expect(changesOf(updates, 't-1')).toEqual({ targetWeight: 55 })
    expect(changesOf(updates, 't-2')).toEqual({ targetWeight: 60 })
  })

  it('a set this week has and last week doesn\'t gets nothing; a set only last week had changes nothing', () => {
    const last = [wset('l-1', 'pe-lat', 1, { targetWeight: 55 }), wset('l-2', 'pe-lat', 2, { targetWeight: 60 }), wset('l-3', 'pe-lat', 3, { targetWeight: 65 })]
    const fewer = run({ fields: ['weight'], last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat([wset('t-1', 'pe-lat', 1, NOTHING)]))] })
    expect(fewer).toEqual([{ weekPlanId: 'wp-2', setId: 't-1', changes: { targetWeight: 55 } }])
    const more = run({
      fields: ['weight'],
      last: [workout('wp-1', lat([wset('l-1', 'pe-lat', 1, { targetWeight: 55 })]))],
      this: [workout('wp-2', lat([wset('t-1', 'pe-lat', 1, NOTHING), wset('t-2', 'pe-lat', 2, NOTHING)]))],
    })
    expect(more).toEqual([{ weekPlanId: 'wp-2', setId: 't-1', changes: { targetWeight: 55 } }])
  })

  it('a stage takes its numbers from the matched head\'s stage with the same stage index; a stage with no counterpart gets nothing', () => {
    const last = [
      wset('l-d', 'pe-lat', 1, { stageKind: 'dropset' }),
      stage('l-d1', 'l-d', 'pe-lat', 1, { targetWeight: 50 }),
      stage('l-d3', 'l-d', 'pe-lat', 3, { targetWeight: 30 }),
    ]
    const mine = [
      wset('t-d', 'pe-lat', 1, { stageKind: 'dropset', ...NOTHING }),
      stage('t-d1', 't-d', 'pe-lat', 1, NOTHING),
      stage('t-d2', 't-d', 'pe-lat', 2, NOTHING),
      stage('t-d3', 't-d', 'pe-lat', 3, NOTHING),
    ]
    const updates = run({ fields: ['weight'], last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat(mine))] })
    expect(changesOf(updates, 't-d1')).toEqual({ targetWeight: 50 })
    expect(changesOf(updates, 't-d2')).toBeUndefined() // last week's head has no stage 2
    expect(changesOf(updates, 't-d3')).toEqual({ targetWeight: 30 })
  })

  it('a stage never takes a weight from a different head\'s stage with the same index', () => {
    const last = [
      wset('l-a', 'pe-lat', 1, { stageKind: 'dropset' }),
      stage('l-a1', 'l-a', 'pe-lat', 1, { targetWeight: 50 }),
      wset('l-b', 'pe-lat', 2, { stageKind: 'dropset' }),
      stage('l-b1', 'l-b', 'pe-lat', 1, { targetWeight: 80 }),
    ]
    const mine = [
      wset('t-a', 'pe-lat', 1, { stageKind: 'dropset', ...NOTHING }),
      stage('t-a1', 't-a', 'pe-lat', 1, NOTHING),
      wset('t-b', 'pe-lat', 2, { stageKind: 'dropset', ...NOTHING }),
      stage('t-b1', 't-b', 'pe-lat', 1, NOTHING),
    ]
    const updates = run({ fields: ['weight'], last: [workout('wp-1', lat(last))], this: [workout('wp-2', lat(mine))] })
    expect(changesOf(updates, 't-a1')).toEqual({ targetWeight: 50 })
    expect(changesOf(updates, 't-b1')).toEqual({ targetWeight: 80 })
  })

  it('exercises are matched by exercise, not by the row that holds them: a row swapped back is still its exercise', () => {
    const last = workout('wp-1', {
      exercises: [['old-row', 'lat', 0]],
      sets: [wset('l-1', 'old-row', 1, { targetWeight: 55 })],
    })
    const mine = workout('wp-2', {
      exercises: [['new-row', 'lat', 0]], // a different program-exercise row, the same exercise
      sets: [wset('t-1', 'new-row', 1, NOTHING)],
    })
    expect(run({ fields: ['weight'], last: [last], this: [mine] })).toEqual([{ weekPlanId: 'wp-2', setId: 't-1', changes: { targetWeight: 55 } }])
  })

  it('a different exercise at the same place gets nothing: a swap copies no numbers across exercises', () => {
    const last = workout('wp-1', { exercises: [['r1', 'row', 0]], sets: [wset('l-1', 'r1', 1, { targetWeight: 55 })] })
    const mine = workout('wp-2', { exercises: [['r2', 'curl', 0]], sets: [wset('t-1', 'r2', 1, NOTHING)] })
    expect(run({ fields: ALL, last: [last], this: [mine] })).toEqual([])
  })

  it('the same exercise twice in one workout is paired in order of position, first with first (provisional 83)', () => {
    const last = workout('wp-1', {
      exercises: [['l-a', 'bench', 0], ['l-b', 'bench', 1]],
      sets: [wset('l-a1', 'l-a', 1, { targetWeight: 100 }), wset('l-b1', 'l-b', 1, { targetWeight: 60 })],
    })
    const mine = workout('wp-2', {
      exercises: [['t-b', 'bench', 1], ['t-a', 'bench', 0]], // listed out of order on purpose
      sets: [wset('t-a1', 't-a', 1, NOTHING), wset('t-b1', 't-b', 1, NOTHING)],
    })
    const updates = run({ fields: ['weight'], last: [last], this: [mine] })
    expect(changesOf(updates, 't-a1')).toEqual({ targetWeight: 100 })
    expect(changesOf(updates, 't-b1')).toEqual({ targetWeight: 60 })
  })

  it('an exercise this week has and last week hasn\'t (added in CHANGE THE PROGRAM) gets nothing', () => {
    const last = workout('wp-1', lat(lastLat()))
    const mine = workout('wp-2', {
      exercises: [['pe-lat', 'lat', 0], ['pe-new', 'new', 1]],
      sets: [...emptyLat(), wset('t-n', 'pe-new', 1, NOTHING)],
    })
    expect(changesOf(run({ last: [last], this: [mine] }), 't-n')).toBeUndefined()
  })
})

// ─── Which workouts ───────────────────────────────────────────────────────────────────────────────────────────────

describe('copyNumbers — only the workouts asked for, each from its own slot of last week', () => {
  it('writes into the listed workouts only: a workout left out (a done one is never in the list) is untouched', () => {
    const mon = workout('wp-mon', lat(emptyLat()), { workoutDayId: 'wd-push' })
    const tue = workout('wp-tue', lat(emptyLat().map((s) => ({ ...s, id: s.id.replace('t-', 'u-'), parentWeekPlanSetId: s.parentWeekPlanSetId?.replace('t-', 'u-') ?? null }))), { workoutDayId: 'wd-pull' })
    const last = [
      workout('wp-1a', lat(lastLat()), { workoutDayId: 'wd-push' }),
      workout('wp-1b', lat(lastLat()), { workoutDayId: 'wd-pull' }),
    ]
    const only = run({ workouts: ['wp-tue'], last, this: [mon, tue] })
    expect(only.length).toBeGreaterThan(0)
    expect(only.every((u) => u.weekPlanId === 'wp-tue')).toBe(true)
    expect(run({ workouts: [], last, this: [mon, tue] })).toEqual([])
    expect(new Set(run({ workouts: ['wp-mon', 'wp-tue'], last, this: [mon, tue] }).map((u) => u.weekPlanId))).toEqual(new Set(['wp-mon', 'wp-tue']))
  })

  it('a workout is matched to last week\'s plan of the same workout, not the same position in the list', () => {
    const lastPush = workout('wp-1a', lat([wset('l-1', 'pe-lat', 1, { targetWeight: 55 })]), { workoutDayId: 'wd-push' })
    const lastPull = workout('wp-1b', lat([wset('l-1', 'pe-lat', 1, { targetWeight: 99 })]), { workoutDayId: 'wd-pull' })
    const mine = workout('wp-2', lat([wset('t-1', 'pe-lat', 1, NOTHING)]), { workoutDayId: 'wd-pull' })
    expect(run({ fields: ['weight'], last: [lastPush, lastPull], this: [mine] })).toEqual([
      { weekPlanId: 'wp-2', setId: 't-1', changes: { targetWeight: 99 } },
    ])
  })

  it('a workout with no plan last week (a new one) gets nothing', () => {
    const mine = workout('wp-2', lat(emptyLat()), { workoutDayId: 'wd-new' })
    expect(run({ last: [workout('wp-1', lat(lastLat()))], this: [mine] })).toEqual([])
  })

  it('on a sequence run a slot copies from the same slot of the last cycle: the repeated workout has two sets of numbers', () => {
    const slot = (id: string, position: number, weight: number) =>
      workout(id, lat([wset(`${id}-1`, 'pe-lat', 1, { targetWeight: weight })]), { workoutDayId: 'wd-A', sequencePosition: position })
    const empty = (id: string, position: number) =>
      workout(id, lat([wset(`${id}-1`, 'pe-lat', 1, NOTHING)]), { workoutDayId: 'wd-A', sequencePosition: position })
    const updates = run({
      fields: ['weight'],
      workouts: ['c2-slot1', 'c2-slot4'],
      last: [slot('c1-slot1', 1, 55), slot('c1-slot4', 4, 62.5)],
      this: [empty('c2-slot1', 1), empty('c2-slot4', 4)],
    })
    expect(changesOf(updates, 'c2-slot1-1')).toEqual({ targetWeight: 55 })
    expect(changesOf(updates, 'c2-slot4-1')).toEqual({ targetWeight: 62.5 })
  })
})

// ─── Warmups and RIR ──────────────────────────────────────────────────────────────────────────────────────────────

describe('copyNumbers — RIR: never on a warmup (G49), and a range copies as a range', () => {
  it('RIR is never written to a warmup, even when last week\'s matched warmup carries one', () => {
    const updates = run({ fields: ['rir'] })
    expect(changesOf(updates, 't-w')).toBeUndefined() // last week's warmup has RIR 5
    expect(changesOf(updates, 't-1')).toEqual({ targetRir: 2, targetRirMax: null })
    // With every field ticked the warmup still takes weight and reps, and no RIR.
    expect(changesOf(run(), 't-w')).not.toHaveProperty('targetRir')
    expect(changesOf(run(), 't-w')).not.toHaveProperty('targetRirMax')
    expect(changesOf(run({ overwrite: true }), 't-w')).not.toHaveProperty('targetRir')
  })

  it('a RIR range copies both ends, as a range', () => {
    const last = lastLat().map((s) => (s.id === 'l-1' ? { ...s, targetRir: 1, targetRirMax: 2 } : s))
    expect(changesOf(run({ fields: ['rir'], last: [workout('wp-1', lat(last))] }), 't-1')).toEqual({ targetRir: 1, targetRirMax: 2 })
  })

  it('a RIR number over a typed range replaces both ends (the old high end must not survive), a range over a number sets both', () => {
    const typedRange = emptyLat({ 't-1': { targetRir: 1, targetRirMax: 3 } })
    expect(changesOf(run({ fields: ['rir'], overwrite: true, this: [workout('wp-2', lat(typedRange))] }), 't-1')).toEqual({
      targetRir: 2,
      targetRirMax: null,
    })
    const lastRange = lastLat().map((s) => (s.id === 'l-1' ? { ...s, targetRir: 1, targetRirMax: 2 } : s))
    const typedNumber = emptyLat({ 't-1': { targetRir: 3 } })
    expect(
      changesOf(run({ fields: ['rir'], overwrite: true, last: [workout('wp-1', lat(lastRange))], this: [workout('wp-2', lat(typedNumber))] }), 't-1'),
    ).toEqual({ targetRir: 1, targetRirMax: 2 })
  })

  it('RIR 0 is a RIR: it is copied', () => {
    const last = lastLat().map((s) => (s.id === 'l-1' ? { ...s, targetRir: 0 } : s))
    expect(changesOf(run({ fields: ['rir'], last: [workout('wp-1', lat(last))] }), 't-1')).toEqual({ targetRir: 0, targetRirMax: null })
  })

  it('a range that is the same on both ends is not an update', () => {
    const both = (rir: Partial<WeekPlanSet>) => [wset('x-1', 'pe-lat', 1, { ...rir })]
    const updates = run({
      fields: ['rir'],
      overwrite: true,
      last: [workout('wp-1', lat(both({ targetRir: 1, targetRirMax: 2 })))],
      this: [workout('wp-2', lat(both({ targetRir: 1, targetRirMax: 2 })))],
    })
    expect(updates).toEqual([])
  })
})

describe('copyNumbers — reps: a number, a range or AMRAP copies as the target it is, whole', () => {
  const lastWith = (rep: Partial<WeekPlanSet>) => [workout('wp-1', lat([wset('l-1', 'pe-lat', 1, rep)]))]
  const mineWith = (rep: Partial<WeekPlanSet>) => [workout('wp-2', lat([wset('t-1', 'pe-lat', 1, { ...NOTHING, ...rep })]))]

  it('a number, a range and AMRAP', () => {
    const copied = (rep: Partial<WeekPlanSet>) => changesOf(run({ fields: ['reps'], last: lastWith(rep), this: mineWith({}) }), 't-1')
    expect(copied({ repMin: 12, repMax: 12 })).toEqual({ repMin: 12, repMax: 12, isAmrap: false })
    expect(copied({ repMin: 8, repMax: 10 })).toEqual({ repMin: 8, repMax: 10, isAmrap: false })
    expect(copied({ repMin: null, repMax: null, isAmrap: true })).toEqual({ repMin: null, repMax: null, isAmrap: true })
  })

  it('an AMRAP carries no numbers even if the row has stray ones', () => {
    const updates = run({ fields: ['reps'], last: lastWith({ repMin: 6, repMax: 8, isAmrap: true }), this: mineWith({}) })
    expect(changesOf(updates, 't-1')).toEqual({ repMin: null, repMax: null, isAmrap: true })
  })

  it('an AMRAP over a typed number (overwrite on) clears the numbers; a number over an AMRAP clears the flag', () => {
    expect(
      changesOf(run({ fields: ['reps'], overwrite: true, last: lastWith({ repMin: null, repMax: null, isAmrap: true }), this: mineWith({ repMin: 8, repMax: 10 }) }), 't-1'),
    ).toEqual({ repMin: null, repMax: null, isAmrap: true })
    expect(
      changesOf(run({ fields: ['reps'], overwrite: true, last: lastWith({ repMin: 8, repMax: 10 }), this: mineWith({ repMin: null, repMax: null, isAmrap: true }) }), 't-1'),
    ).toEqual({ repMin: 8, repMax: 10, isAmrap: false })
  })

  it('off: a typed AMRAP counts as a typed target and stays; no rep target is an empty box', () => {
    expect(
      changesOf(run({ fields: ['reps'], last: lastWith({ repMin: 8, repMax: 10 }), this: mineWith({ repMin: null, repMax: null, isAmrap: true }) }), 't-1'),
    ).toBeUndefined()
    expect(changesOf(run({ fields: ['reps'], last: lastWith({ repMin: 8, repMax: 10 }), this: mineWith({}) }), 't-1')).toEqual({ repMin: 8, repMax: 10, isAmrap: false })
  })

  it('last week with no rep target copies nothing, over a typed target or not', () => {
    const noTarget = { repMin: null, repMax: null, isAmrap: false }
    expect(run({ fields: ['reps'], overwrite: true, last: lastWith(noTarget), this: mineWith({ repMin: 8, repMax: 10 }) })).toEqual([])
  })

  it('8 to 8 is 8: a target that shows the same is not an update', () => {
    expect(run({ fields: ['reps'], overwrite: true, last: lastWith({ repMin: 8, repMax: 8 }), this: mineWith({ repMin: 8, repMax: 8 }) })).toEqual([])
  })
})
