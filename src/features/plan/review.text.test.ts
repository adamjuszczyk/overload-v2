import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { SessionSetChange, SetLog } from '../../types'
import {
  reviewItemText,
  reviewItems,
  type ReviewAddedExerciseItem,
  type ReviewAddedSetItem,
  type ReviewItem,
  type ReviewNumberItem,
  type ReviewRetypedItem,
  type ReviewSkippedItem,
  type ReviewSwappedItem,
} from './review'
import { dropLog, mirrorWeek, review, row, session, setLog, stage, swapRecord, weekPlan, workoutDay, wset } from './review.testutil'

// Chunk 43 (TASKS-1.2 "REVIEW as a pure function", scope: "Text helpers for the board's wording"): board 4's
// strings, built from item data and checked against the board's own source file, so a changed board shows
// up as a failing test. Where the board draws no such item (Skipped, a type item, an added exercise, lbs,
// a cycle) the wording is provisional under D31 and only this file holds it.

const here = dirname(fileURLToPath(import.meta.url))
const boardSource = readFileSync(join(here, '..', '..', '..', 'design', '1.2', 'source', 'PlanReview.dc.html'), 'utf8')

const ctx = { fromWeek: 2 }
const itemsOf = (groups: ReturnType<typeof review>): ReviewItem[] => groups.flatMap((g) => g.items.map((e) => e.item))

// Board 4's own sample, built as data: Tue Pull 1 (Lat Pulldown set 2 at another weight, Face Pull with a
// third set nobody planned) and Thu Push 2 (Dips swapped for Machine Dips, all 3 sets).
function boardSample() {
  const pull = weekPlan(
    'pull',
    1,
    [row('pe-lat', 'ex-lat', 1, 'Lat Pulldown'), row('pe-face', 'ex-face', 2, 'Face Pull')],
    [
      wset('ps-lat-1', 'pe-lat', 1, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2 }),
      wset('ps-lat-2', 'pe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2 }),
      wset('ps-face-1', 'pe-face', 1, { targetWeight: 15, repMin: 15, repMax: 20, targetRir: 1 }),
      wset('ps-face-2', 'pe-face', 2, { targetWeight: 15, repMin: 15, repMax: 20, targetRir: 1 }),
    ],
    { workoutDay: workoutDay('wd-pull', 'Pull 1') },
  )
  const push = weekPlan(
    'push',
    1,
    [row('pe-dips', 'ex-dips', 1, 'Dips')],
    [wset('ps-dips-1', 'pe-dips', 1), wset('ps-dips-2', 'pe-dips', 2), wset('ps-dips-3', 'pe-dips', 3)],
    { workoutDay: workoutDay('wd-push', 'Push 2') },
  )
  const pullLogs: SetLog[] = [
    setLog('lg-1', 's-pull', 'ex-lat', { weekPlanSetId: 'ps-lat-1', weight: 55, reps: 9, rir: 2, setNumber: 1 }),
    setLog('lg-2', 's-pull', 'ex-lat', { weekPlanSetId: 'ps-lat-2', weight: 57.5, reps: 11, rir: 1, setNumber: 2 }),
    setLog('lg-3', 's-pull', 'ex-face', { weekPlanSetId: 'ps-face-1', weight: 15, reps: 16, rir: 1, setNumber: 1 }),
    setLog('lg-4', 's-pull', 'ex-face', { weekPlanSetId: 'ps-face-2', weight: 15, reps: 16, rir: 1, setNumber: 2 }),
    setLog('lg-5', 's-pull', 'ex-face', { setNumber: 3, weight: 15, reps: 18, rir: 1 }),
  ]
  const pushLogs: SetLog[] = [1, 2, 3].map((n) => setLog(`lg-m${n}`, 's-push', 'ex-md', { setNumber: n }))
  return review({
    last: [pull, push],
    thisWeek: [mirrorWeek(pull), mirrorWeek(push)],
    sessions: [
      session('s-pull', pull.id, 'completed', pullLogs, { date: '2026-10-06' }), // a Tuesday
      session('s-push', push.id, 'completed', pushLogs, {
        date: '2026-10-08', // a Thursday
        swaps: [swapRecord({ programExerciseId: 'pe-dips', originalExerciseId: 'ex-dips', originalExerciseName: 'Dips', replacementExerciseId: 'ex-md', replacementExerciseName: 'Machine Dips' })],
      }),
    ],
  })
}

describe('board 4 (REVIEW), built from data', () => {
  const groups = boardSample()
  const [lat, face, swap] = itemsOf(groups)

  it('the sample has the board\'s three items under the board\'s two headings', () => {
    expect(groups.map((g) => [g.heading, g.items.length])).toEqual([
      ['TUE · PULL 1', 2],
      ['THU · PUSH 2', 1],
    ])
    expect([lat.kind, face.kind, swap.kind]).toEqual(['number', 'added_set', 'swapped'])
  })

  it('the number item: eyebrow, headline, the plan with its RIR, and the button', () => {
    expect(reviewItemText(lat, ctx)).toEqual({
      eyebrow: 'LAT PULLDOWN · SET 02',
      headline: 'Did 57.5 kg × 11',
      detail: 'planned 55 kg × 8–10 · RIR 2 → did RIR 1',
      note: null,
      action: 'USE 57.5 × 11',
    })
  })

  it('the added set: eyebrow, "Set 03 · 15 kg × 18", its RIR, ADD THIS SET', () => {
    expect(reviewItemText(face, ctx)).toEqual({
      eyebrow: 'FACE PULL · ADDED A SET',
      headline: 'Set 03 · 15 kg × 18',
      detail: 'RIR 1',
      note: null,
      action: 'ADD THIS SET',
    })
  })

  it('the swap: the exercises, "for all 3 sets", the line about the plan, and the button naming the week', () => {
    expect(reviewItemText(swap, ctx)).toEqual({
      eyebrow: 'SWAPPED AN EXERCISE',
      headline: 'Dips → Machine Dips',
      detail: 'for all 3 sets',
      note: 'Swapping changes the plan from week 2 on.',
      action: 'SWAP FROM WEEK 2',
    })
  })

  it('every string above is in the board\'s own source, character for character', () => {
    const strings = [
      'TUE · PULL 1',
      'THU · PUSH 2',
      'LAT PULLDOWN · SET 02',
      'Did 57.5 kg × 11',
      'planned 55 kg × 8–10 · RIR 2 → did RIR 1',
      'USE 57.5 × 11',
      'FACE PULL · ADDED A SET',
      'Set 03 · 15 kg × 18',
      'RIR 1',
      'ADD THIS SET',
      'SWAPPED AN EXERCISE',
      'Dips → Machine Dips',
      'for all 3 sets',
      'Swapping changes the plan from week 2 on.',
      'SWAP FROM WEEK 2',
    ]
    for (const text of strings) expect(boardSource, text).toContain(text)
    // and what the module builds is exactly those strings, not close to them
    const built = [groups[0].heading, groups[1].heading, ...itemsOf(groups).flatMap((i) => Object.values(reviewItemText(i, ctx)).filter((v): v is string => v !== null))]
    for (const text of strings) expect(built, text).toContain(text)
  })
})

describe('the wording where the board draws no such item (provisional, D31)', () => {
  const one = <T extends ReviewItem>(planned: Parameters<typeof wset>[3], log: Partial<SetLog> | null, name = 'Bench Press', unit?: 'lbs'): T => {
    const rowOf = unit ? { ...row('pe-1', 'ex-1', 1, name), weightUnit: unit } : row('pe-1', 'ex-1', 1, name)
    const last = weekPlan('a', 1, [rowOf], [wset('ps-1', 'pe-1', 1, planned), wset('ps-2', 'pe-1', 2, planned)])
    const logs = log === null ? [] : [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', ...log })]
    const found = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))
    return found[0] as T
  }

  it('Skipped and Not logged: the plan\'s numbers and the button that removes the set', () => {
    const skipped = one<ReviewSkippedItem>({ targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }, { isSkipped: true, weight: null, reps: null })
    expect(reviewItemText(skipped, ctx)).toEqual({
      eyebrow: 'BENCH PRESS · SET 01',
      headline: 'Skipped',
      detail: 'planned 60 kg × 10–12 · RIR 2',
      note: null,
      action: 'REMOVE THIS SET',
    })
    const unlogged = one<ReviewSkippedItem>({ targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }, null)
    expect(reviewItemText(unlogged, ctx).headline).toBe('Not logged')
  })

  it('a skipped set that somehow has no planned numbers has no plan line (an item for it is never listed)', () => {
    const base = one<ReviewSkippedItem>({ targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }, { isSkipped: true, weight: null, reps: null })
    const nothing: ReviewSkippedItem = { ...base, planned: { weight: null, reps: { type: 'none' }, rir: null, rirMax: null } }
    expect(reviewItemText(nothing, ctx)).toMatchObject({ headline: 'Skipped', detail: null })
  })

  it('a number item: only the numbers the plan had; a RIR range; the RIR the plan expected when it was met', () => {
    const repsOnly = one<ReviewNumberItem>({ targetWeight: null, repMin: 8, repMax: 8, targetRir: null }, { weight: 60, reps: 12, rir: 3 })
    expect(reviewItemText(repsOnly, ctx)).toMatchObject({ headline: 'Did 60 kg × 12', detail: 'planned 8 reps · did RIR 3', action: 'USE 60 × 12' })
    const range = one<ReviewNumberItem>({ targetWeight: 100, repMin: 8, repMax: 8, targetRir: 1, targetRirMax: 2 }, { weight: 100, reps: 10, rir: 2 })
    expect(reviewItemText(range, ctx).detail).toBe('planned 100 kg × 8 · RIR 1–2') // 2 is inside 1–2: the plan
    const outside = one<ReviewNumberItem>({ targetWeight: 100, repMin: 8, repMax: 8, targetRir: 1, targetRirMax: 2 }, { weight: 100, reps: 10, rir: 0 })
    expect(reviewItemText(outside, ctx).detail).toBe('planned 100 kg × 8 · RIR 1–2 → did RIR 0')
  })

  it('the button offers only what the plan can hold: 0 reps are not offered, nor a weight below 0, nor, with neither, anything', () => {
    const failed = one<ReviewNumberItem>({ targetWeight: 80, repMin: 8, repMax: 8, targetRir: 2 }, { weight: 85, reps: 0, rir: 0 })
    expect(reviewItemText(failed, ctx)).toMatchObject({ headline: 'Did 85 kg × 0', action: 'USE 85 kg' })
    const negative = one<ReviewNumberItem>({ targetWeight: 0, repMin: 8, repMax: 8, targetRir: 2 }, { weight: -20, reps: 10, rir: 2 })
    expect(reviewItemText(negative, ctx)).toMatchObject({ headline: 'Did -20 kg × 10', action: 'USE 10 reps' })
    const neither = one<ReviewNumberItem>({ targetWeight: 0, repMin: 8, repMax: 8, targetRir: 2 }, { weight: -20, reps: 0, rir: 2 })
    expect(reviewItemText(neither, ctx)).toMatchObject({ headline: 'Did -20 kg × 0', action: 'USE' })
  })

  it('AMRAP: the button takes the weight only', () => {
    const amrap = one<ReviewNumberItem>({ targetWeight: 100, repMin: null, repMax: null, isAmrap: true, targetRir: 0 }, { weight: 105, reps: 14, rir: 0 })
    expect(reviewItemText(amrap, ctx)).toMatchObject({ headline: 'Did 105 kg × 14', detail: 'planned 100 kg × AMRAP · RIR 0', action: 'USE 105 kg' })
  })

  it('a weight in lbs reads in lbs (the exercise\'s own unit)', () => {
    const lbs = one<ReviewNumberItem>({ targetWeight: 9, repMin: 12, repMax: 15, targetRir: 2 }, { weight: 10, reps: 15, rir: 2 }, 'Dumbbell Lateral Raise', 'lbs')
    expect(reviewItemText(lbs, ctx)).toMatchObject({
      eyebrow: 'DUMBBELL LATERAL RAISE · SET 01',
      headline: 'Did 22 lbs × 15',
      detail: 'planned 19.8 lbs × 12–15 · RIR 2',
      action: 'USE 22 × 15',
    })
  })

  it('a type item: "You made set 01 a dropset", with its drops; more drops of the same kind; the other kinds and a warmup', () => {
    const typed = (planned: ReturnType<typeof wset>[], logs: SetLog[]) => {
      const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], planned)
      return itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })).filter((i) => i.kind === 'retyped')[0] as ReviewRetypedItem
    }
    const dropset = typed([wset('ps-1', 'pe-1', 1)], [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'dropset' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)])
    expect(reviewItemText(dropset, ctx)).toEqual({
      eyebrow: 'LATERAL RAISE · SET 01',
      headline: 'You made set 01 a dropset',
      detail: '1 drop',
      note: null,
      action: 'USE',
    })
    const more = typed(
      [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)],
      [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'dropset' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1), dropLog('lg-d2', 's1', 'ex-1', 'lg-1', 2), dropLog('lg-d3', 's1', 'ex-1', 'lg-1', 3)],
    )
    expect(reviewItemText(more, ctx)).toMatchObject({ headline: 'You added 2 drops to set 01', detail: '3 drops' })
    const pause = typed([wset('ps-1', 'pe-1', 1)], [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'rest_pause' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)])
    expect(reviewItemText(pause, ctx).headline).toBe('You made set 01 a rest-pause set')
    const mini = typed([wset('ps-1', 'pe-1', 1)], [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'myo_reps' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1), dropLog('lg-d2', 's1', 'ex-1', 'lg-1', 2)])
    expect(reviewItemText(mini, ctx)).toMatchObject({ headline: 'You made set 01 a myo-reps set', detail: '2 mini-sets' })
    const warm = typed([wset('ps-1', 'pe-1', 1)], [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', isWarmup: true })])
    expect(reviewItemText(warm, ctx)).toMatchObject({ headline: 'You made set 01 a warmup', detail: null })
    const plain = typed([wset('ps-1', 'pe-1', 1, { isWarmup: true, targetRir: null })], [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1' })])
    expect(reviewItemText(plain, ctx)).toMatchObject({ eyebrow: 'LATERAL RAISE · WARMUP 01', headline: 'You made warmup 01 a normal set' })
  })

  it('an added dropset, and an added warmup, say what they were', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Pushdown')], [wset('ps-1', 'pe-1', 1)])
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1' }),
      setLog('lg-x', 's1', 'ex-1', { setNumber: 2, weight: 20, reps: 15, rir: 2, stageKind: 'dropset' }),
      dropLog('lg-xd', 's1', 'ex-1', 'lg-x', 1),
      setLog('lg-w', 's1', 'ex-1', { setNumber: 1, isWarmup: true, weight: 10, reps: null, rir: null }),
    ]
    const found = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })) as ReviewAddedSetItem[]
    expect(found.map((i) => reviewItemText(i, ctx))).toEqual([
      { eyebrow: 'PUSHDOWN · ADDED A SET', headline: 'Warmup 01 · 10 kg', detail: null, note: null, action: 'ADD THIS SET' },
      { eyebrow: 'PUSHDOWN · ADDED A SET', headline: 'Set 02 · 20 kg × 15', detail: 'dropset, 1 drop · RIR 2', note: null, action: 'ADD THIS SET' },
    ])
  })

  it('an added set with only some numbers: reps alone, a weight alone, none', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Pushdown')], [wset('ps-1', 'pe-1', 1)])
    const added = (n: number, over: Partial<SetLog>) => setLog(`lg-${n}`, 's1', 'ex-1', { setNumber: n, rir: null, ...over })
    const logs = [setLog('lg-0', 's1', 'ex-1', { weekPlanSetId: 'ps-1' }), added(2, { weight: null, reps: 12 }), added(3, { weight: 20, reps: null }), added(4, { weight: null, reps: null })]
    const found = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })) as ReviewAddedSetItem[]
    expect(found.map((i) => reviewItemText(i, ctx).headline)).toEqual(['Set 02 · 12 reps', 'Set 03 · 20 kg', 'Set 04 · —'])
  })

  it('a number item whose weight was never entered offers its reps', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Bench Press')], [wset('ps-w', 'pe-1', 1, { isWarmup: true, targetWeight: 40, repMin: 10, repMax: 10, targetRir: null })])
    const logs = [setLog('lg-w', 's1', 'ex-1', { weekPlanSetId: 'ps-w', isWarmup: true, weight: null, reps: 8, rir: null })]
    const item = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))[0] as ReviewNumberItem
    expect(reviewItemText(item, ctx)).toMatchObject({ eyebrow: 'BENCH PRESS · WARMUP 01', headline: 'Did 8 reps', detail: 'planned 40 kg × 10', action: 'USE 8 reps' })
  })

  it('a staged set switched back to Normal reads as a new type: "You made set 01 a normal set", no drops under it', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)])
    const logs = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: null })]
    const item = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))[0] as ReviewRetypedItem
    expect(item.kind).toBe('retyped')
    expect(reviewItemText(item, ctx)).toEqual({
      eyebrow: 'LATERAL RAISE · SET 01',
      headline: 'You made set 01 a normal set',
      detail: null,
      note: null,
      action: 'USE',
    })
  })

  // DECISIONS 141: the same board 4 wording, from a type the workout gave a set whose drops were not done (no new string)
  it('a type given with no drop done reads as the type, with the count the item carries: from the log alone one drop, from a change row its count', () => {
    const typed = (planned: ReturnType<typeof wset>[], logs: SetLog[], changes: SessionSetChange[] = []) => {
      const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], planned)
      return itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs, { sessionSetChanges: changes })] })).filter((i) => i.kind === 'retyped')[0] as ReviewRetypedItem
    }
    const dropset = [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)]
    const restPauseLog = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'rest_pause' })]
    expect(reviewItemText(typed(dropset, restPauseLog), ctx)).toEqual({
      eyebrow: 'LATERAL RAISE · SET 01',
      headline: 'You made set 01 a rest-pause set',
      detail: '1 pause',
      note: null,
      action: 'USE',
    })
    const three: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'ps-1', type: { kind: 'staged', stageKind: 'rest_pause', stageCount: 3 } }
    expect(reviewItemText(typed(dropset, restPauseLog, [three]), ctx)).toMatchObject({ headline: 'You made set 01 a rest-pause set', detail: '3 pauses' })
    const asDropset = typed([wset('ps-1', 'pe-1', 1)], [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'dropset' })], [{ kind: 'pending_stages', setLogId: 'lg-1', stageKind: 'dropset', stageCount: 2 }])
    expect(reviewItemText(asDropset, ctx)).toMatchObject({ headline: 'You made set 01 a dropset', detail: '2 drops' })
  })

  it('a kindless dropset switched to Normal reads as "a normal set", like any dropset switched back', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], [wset('ps-1', 'pe-1', 1, { stageKind: null }), stage('ps-s1', 'ps-1', 'pe-1', 1)])
    const logs = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: null })]
    const toNormal: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'ps-1', type: { kind: 'normal' } }
    const item = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs, { sessionSetChanges: [toNormal] })] }))[0] as ReviewRetypedItem
    expect(reviewItemText(item, ctx)).toEqual({ eyebrow: 'LATERAL RAISE · SET 01', headline: 'You made set 01 a normal set', detail: null, note: null, action: 'USE' })
  })

  it('a staged set made another kind, or made a warmup, reads as a new type, not as added drops', () => {
    const typed = (planned: ReturnType<typeof wset>[], logs: SetLog[]) => {
      const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], planned)
      return itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })).filter((i) => i.kind === 'retyped')[0] as ReviewRetypedItem
    }
    const planned = [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)]
    const restPause = typed(planned, [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'rest_pause' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1), dropLog('lg-d2', 's1', 'ex-1', 'lg-1', 2)])
    expect(reviewItemText(restPause, ctx)).toMatchObject({ headline: 'You made set 01 a rest-pause set', detail: '2 pauses' })
    const warmup = typed(planned, [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', isWarmup: true })])
    expect(reviewItemText(warmup, ctx)).toMatchObject({ headline: 'You made set 01 a warmup', detail: null })
  })

  it('an added exercise: its name, the working sets done, and the line about the plan', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Bench Press')], [wset('ps-1', 'pe-1', 1)])
    const fly = (n: number, over: Partial<SetLog> = {}) => setLog(`lg-f${n}`, 's1', 'ex-fly', { setNumber: n, ...over })
    const logs = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1' }), fly(1, { isWarmup: true }), fly(1), fly(2), fly(3)]
    const found = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)], extra: { exercises: [{ id: 'ex-fly', name: 'Cable Fly' }] } }))
    const item = found[0] as ReviewAddedExerciseItem
    expect(reviewItemText(item, ctx)).toEqual({
      eyebrow: 'ADDED AN EXERCISE',
      headline: 'Cable Fly',
      detail: '3 sets', // the warmup is no set
      note: 'Adding it changes the plan from week 2 on.',
      action: 'ADD EXERCISE',
    })
    const one = reviewItems({
      weekNumber: 2,
      lastWeek: { sessions: [session('s1', last.id, 'completed', [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1' }), fly(1)])], plan: [last] },
      thisWeek: [mirrorWeek(last)],
      decisions: [],
      exercises: [{ id: 'ex-fly', name: 'Cable Fly' }],
    })[0].items[0].item
    expect(reviewItemText(one, ctx).detail).toBe('1 set')
  })

  it('a swap that covered some of the sets says how many; a sequence run says cycle', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Dips')], [wset('ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2), wset('ps-3', 'pe-1', 3)])
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', setNumber: 1 }),
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', isSkipped: true, weight: null, reps: null }),
      setLog('lg-3', 's1', 'ex-1', { weekPlanSetId: 'ps-3', isSkipped: true, weight: null, reps: null }),
      setLog('lg-m1', 's1', 'ex-md', { setNumber: 1 }),
      setLog('lg-m2', 's1', 'ex-md', { setNumber: 2 }),
    ]
    const swaps = [swapRecord({ programExerciseId: 'pe-1', originalExerciseName: 'Dips', replacementExerciseId: 'ex-md', replacementExerciseName: 'Machine Dips' })]
    const found = itemsOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs, { swaps })] }))
    const item = found[0] as ReviewSwappedItem
    expect(item.kind).toBe('swapped')
    expect(reviewItemText(item, { fromWeek: 4, period: 'cycle' })).toMatchObject({
      detail: 'for 2 of 3 sets',
      note: 'Swapping changes the plan from cycle 4 on.',
      action: 'SWAP FROM CYCLE 4',
    })
  })
})
