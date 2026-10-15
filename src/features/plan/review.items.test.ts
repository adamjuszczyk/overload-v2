import { describe, it, expect } from 'vitest'
import type { SetLog, WeekPlanSet } from '../../types'
import {
  itemKey,
  reviewItems,
  type ReviewAddedExerciseItem,
  type ReviewAddedSetItem,
  type ReviewItem,
  type ReviewNumberItem,
  type ReviewRetypedItem,
  type ReviewSkippedItem,
  type ReviewSwappedItem,
} from './review'
import {
  deepFreeze,
  dropLog,
  kinds,
  keysOf,
  mirrorWeek,
  oneExerciseWeek,
  review,
  row,
  session,
  setLog,
  stage,
  swapRecord,
  weekPlan,
  workoutDay,
  wset,
} from './review.testutil'

// Chunk 43 (TASKS-1.2 "REVIEW as a pure function", Verification): REVIEW's items, rule by rule, each with
// the data that tells the right source from the wrong one (the log against the plan, last week's plan row
// against this week's, this week's number against last week's). Fixtures are built from the app's real
// types. The seed's own week (the five items TASKS names) is review.seed.test.ts.

const items = (groups: ReturnType<typeof review>): ReviewItem[] => groups.flatMap((g) => g.items.map((e) => e.item))
const only = <T extends ReviewItem>(groups: ReturnType<typeof review>): T => {
  const all = items(groups)
  expect(all).toHaveLength(1)
  return all[0] as T
}

// One exercise, `n` working sets planned with `planned` fields (100 kg × 8, RIR 2 unless said), and one
// completed session whose logs are `logs` (log ids `lg-…`, never a planned set's).
function oneSet(planned: Partial<WeekPlanSet>, log: Partial<SetLog> | null, n = 1) {
  const last = oneExerciseWeek('a', 1, n, planned)
  const logs = log === null ? [] : [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', ...log })]
  return review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })
}

describe('number items: weight and reps against the plan (13c)', () => {
  it('a set done as planned is not an item', () => {
    expect(oneSet({ targetWeight: 80, repMin: 6, repMax: 8 }, { weight: 80, reps: 7, rir: 2 })).toEqual([])
  })

  it('a weight that differs from the planned weight is an item, with both numbers', () => {
    const item = only<ReviewNumberItem>(oneSet({ targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2 }, { weight: 57.5, reps: 9, rir: 1 }))
    expect(item.kind).toBe('number')
    expect(item).toMatchObject({
      plannedSetId: 'ps-pe-1-1',
      weightDiffers: true,
      repsDiffer: false,
      planned: { weight: 55, reps: { type: 'range', min: 8, max: 10 }, rir: 2 },
      done: { weight: 57.5, reps: 9, rir: 1 },
    })
  })

  it('reps planned as a number: done differently is an item, done as planned is not', () => {
    const different = only<ReviewNumberItem>(oneSet({ targetWeight: 100, repMin: 8, repMax: 8 }, { weight: 100, reps: 9 }))
    expect(different).toMatchObject({ weightDiffers: false, repsDiffer: true })
    expect(oneSet({ targetWeight: 100, repMin: 8, repMax: 8 }, { weight: 100, reps: 8 })).toEqual([])
  })

  it('reps planned as a range: inside it counts as planned (both ends), outside is an item (below and above)', () => {
    const planned = { targetWeight: 80, repMin: 6, repMax: 8 }
    expect(oneSet(planned, { weight: 80, reps: 6 })).toEqual([])
    expect(oneSet(planned, { weight: 80, reps: 7 })).toEqual([])
    expect(oneSet(planned, { weight: 80, reps: 8 })).toEqual([])
    expect(only<ReviewNumberItem>(oneSet(planned, { weight: 80, reps: 5 }))).toMatchObject({ repsDiffer: true, weightDiffers: false })
    expect(only<ReviewNumberItem>(oneSet(planned, { weight: 80, reps: 9 }))).toMatchObject({ repsDiffer: true, weightDiffers: false })
  })

  it('reps planned as AMRAP never count, whatever was done; the weight still does', () => {
    const amrap = { targetWeight: 100, repMin: null, repMax: null, isAmrap: true }
    expect(oneSet(amrap, { weight: 100, reps: 1 })).toEqual([])
    expect(oneSet(amrap, { weight: 100, reps: 30 })).toEqual([])
    expect(only<ReviewNumberItem>(oneSet(amrap, { weight: 105, reps: 12 }))).toMatchObject({ weightDiffers: true, repsDiffer: false })
  })

  it('only where the plan had a weight or reps: no planned weight, no weight item; no rep target, no reps item', () => {
    expect(oneSet({ targetWeight: null, repMin: 8, repMax: 8 }, { weight: 60, reps: 8 })).toEqual([])
    expect(oneSet({ targetWeight: 100, repMin: null, repMax: null, isAmrap: false }, { weight: 100, reps: 3 })).toEqual([])
    expect(oneSet({ targetWeight: null, repMin: null, repMax: null, isAmrap: false }, { weight: 60, reps: 3 })).toEqual([])
    // half a range (a minimum alone, a maximum alone) is no rep target either: the app's own reading, `columnsToRepTarget`
    expect(oneSet({ targetWeight: 100, repMin: 8, repMax: null, isAmrap: false }, { weight: 100, reps: 3 })).toEqual([])
    expect(oneSet({ targetWeight: 100, repMin: null, repMax: 10, isAmrap: false }, { weight: 100, reps: 12 })).toEqual([])
    // the number the plan did have still counts when the other is missing
    expect(only<ReviewNumberItem>(oneSet({ targetWeight: null, repMin: 8, repMax: 8 }, { weight: 60, reps: 12 }))).toMatchObject({ repsDiffer: true })
  })

  it('RIR alone never makes an item', () => {
    expect(oneSet({ targetWeight: 80, repMin: 6, repMax: 8, targetRir: 2 }, { weight: 80, reps: 7, rir: 0 })).toEqual([])
    expect(oneSet({ targetWeight: 80, repMin: 6, repMax: 8, targetRir: null }, { weight: 80, reps: 7, rir: 4 })).toEqual([])
  })

  it('a done number that was never entered is nothing to take over (a ticked warmup has no weight or reps)', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Bench Press')], [wset('ps-w', 'pe-1', 1, { isWarmup: true, targetWeight: 40, repMin: 10, repMax: 10, targetRir: null })])
    const ticked = setLog('lg-w', 's1', 'ex-1', { weekPlanSetId: 'ps-w', isWarmup: true, weight: null, reps: null, rir: null })
    expect(review({ last: [last], sessions: [session('s1', last.id, 'completed', [ticked])] })).toEqual([])
  })

  it('a warmup is a planned set: done at another weight it is an item, numbered apart from the working sets', () => {
    const last = weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Bench Press')],
      [wset('ps-w', 'pe-1', 1, { isWarmup: true, targetWeight: 40, repMin: 10, repMax: 10, targetRir: null }), wset('ps-1', 'pe-1', 2, { targetWeight: 80 })],
    )
    const logs = [
      setLog('lg-w', 's1', 'ex-1', { weekPlanSetId: 'ps-w', isWarmup: true, weight: 50, reps: 10, rir: null }),
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 80, reps: 8 }),
    ]
    const item = only<ReviewNumberItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))
    expect(item).toMatchObject({ plannedSetId: 'ps-w', isWarmup: true, setNumber: 1, weightDiffers: true })
  })

  it('the set number is the planned working set, warmups apart', () => {
    const last = weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Bench Press')],
      [
        wset('ps-w', 'pe-1', 1, { isWarmup: true, targetWeight: 40, repMin: 10, repMax: 10, targetRir: null }),
        wset('ps-1', 'pe-1', 2, { targetWeight: 80 }),
        wset('ps-2', 'pe-1', 3, { targetWeight: 80 }),
      ],
    )
    const logs = [
      setLog('lg-w', 's1', 'ex-1', { weekPlanSetId: 'ps-w', isWarmup: true, weight: 40, reps: 10, rir: null }),
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', setNumber: 1, weight: 80 }),
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', setNumber: 2, weight: 85 }),
    ]
    const item = only<ReviewNumberItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))
    expect(item).toMatchObject({ plannedSetId: 'ps-2', setNumber: 2, isWarmup: false })
  })

  it('a drop is no set of its own: a drop done at other numbers than its stage row makes no item', () => {
    const last = weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Pushdown')],
      [
        wset('ps-h', 'pe-1', 1, { stageKind: 'dropset', targetWeight: 30, repMin: 10, repMax: 12 }),
        stage('ps-s1', 'ps-h', 'pe-1', 1, { targetWeight: 20, repMin: 8, repMax: 10, targetRir: 0 }),
      ],
    )
    const logs = [
      setLog('lg-h', 's1', 'ex-1', { weekPlanSetId: 'ps-h', stageKind: 'dropset', weight: 30, reps: 12 }),
      dropLog('lg-d1', 's1', 'ex-1', 'lg-h', 1, { weekPlanSetId: 'ps-s1', weight: 5, reps: 40 }),
    ]
    expect(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })).toEqual([])
  })
})

describe('Skipped and Not logged (13c, 18b, G52)', () => {
  it('SPEC lists "Skipped" with the number items: a set the plan gave no weight and no rep target is none, skipped, unlogged or deleted', () => {
    const nothing = { targetWeight: null, repMin: null, repMax: null, isAmrap: false }
    expect(oneSet(nothing, { isSkipped: true, weight: null, reps: null })).toEqual([])
    expect(oneSet(nothing, null)).toEqual([])
    const last = oneExerciseWeek('a', 1, 1, nothing)
    const deleted = session('s1', last.id, 'completed', [], { sessionSetChanges: [{ kind: 'deleted', weekPlanSetId: 'ps-pe-1-1' }] })
    expect(review({ last: [last], sessions: [deleted] })).toEqual([])
  })

  it('a weight alone, or a rep target of any kind (AMRAP too), is enough for "Skipped"', () => {
    const skipped = { isSkipped: true, weight: null, reps: null }
    expect(kinds(oneSet({ targetWeight: 60, repMin: null, repMax: null, isAmrap: false }, skipped))).toEqual(['skipped'])
    expect(kinds(oneSet({ targetWeight: null, repMin: 8, repMax: 8, isAmrap: false }, skipped))).toEqual(['skipped'])
    expect(kinds(oneSet({ targetWeight: null, repMin: 8, repMax: 10, isAmrap: false }, skipped))).toEqual(['skipped'])
    expect(kinds(oneSet({ targetWeight: null, repMin: null, repMax: null, isAmrap: true }, skipped))).toEqual(['skipped'])
  })

  it('the structural items are for everyone: with no numbers planned a changed type and an added set are still items', () => {
    const nothing = { targetWeight: null, repMin: null, repMax: null, isAmrap: false, targetRir: null }
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], [wset('ps-1', 'pe-1', 1, nothing), wset('ps-2', 'pe-1', 2, nothing)])
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', stageKind: 'dropset' }),
      dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1),
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', isSkipped: true, weight: null, reps: null }), // no "Skipped": nothing planned
      setLog('lg-x', 's1', 'ex-1', { setNumber: 3 }),
    ]
    expect(kinds(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))).toEqual(['retyped', 'added_set'])
  })

  it('a planned set whose log is skipped is "Skipped"', () => {
    const item = only<ReviewSkippedItem>(oneSet({ targetWeight: 60, repMin: 10, repMax: 12 }, { isSkipped: true, weight: null, reps: null, rir: null }))
    expect(item).toMatchObject({ kind: 'skipped', reason: 'skipped', plannedSetId: 'ps-pe-1-1', setNumber: 1 })
  })

  it('two logs of one planned set: the done one stands for it, the latest of several', () => {
    const last = oneExerciseWeek('a', 1, 1, { targetWeight: 80, repMin: 8, repMax: 8 })
    const skipped = setLog('lg-s', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', isSkipped: true, weight: null, reps: null, loggedAt: '2026-10-05T18:30:00.000Z' })
    const early = setLog('lg-a', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 90, loggedAt: '2026-10-05T18:00:00.000Z' })
    const late = setLog('lg-b', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 85, loggedAt: '2026-10-05T18:10:00.000Z' })
    const found = review({ last: [last], sessions: [session('s1', last.id, 'completed', [skipped, early, late])] })
    expect(only<ReviewNumberItem>(found).done.weight).toBe(85)
  })

  it('a planned set with no log in a completed session is "Not logged"', () => {
    const item = only<ReviewSkippedItem>(oneSet({}, null))
    expect(item).toMatchObject({ kind: 'skipped', reason: 'not_logged' })
  })

  it('a planned set with a deleted session set change is "Skipped", even when a stale log of it is still there', () => {
    const last = oneExerciseWeek('a', 1, 2)
    const logs = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' })]
    const deleted = session('s1', last.id, 'completed', logs, { sessionSetChanges: [{ kind: 'deleted', weekPlanSetId: 'ps-pe-1-2' }, { kind: 'deleted', weekPlanSetId: 'ps-pe-1-1' }] })
    const found = items(review({ last: [last], sessions: [deleted] })) as ReviewSkippedItem[]
    expect(found.map((i) => [i.plannedSetId, i.reason])).toEqual([
      ['ps-pe-1-1', 'skipped'],
      ['ps-pe-1-2', 'skipped'],
    ])
  })

  it('a change of another kind takes nothing out: a retyped or pending-stages change gives no item of its own', () => {
    const last = oneExerciseWeek('a', 1, 1)
    const logs = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' })]
    const changes = session('s1', last.id, 'completed', logs, {
      sessionSetChanges: [
        { kind: 'retyped', weekPlanSetId: 'ps-pe-1-1', type: { kind: 'warmup' } },
        { kind: 'pending_stages', setLogId: 'lg-1', stageKind: 'dropset', stageCount: 2 },
      ],
    })
    expect(review({ last: [last], sessions: [changes] })).toEqual([])
  })

  it('a session in progress gives nothing: not a difference, not a skipped set, not an unlogged one', () => {
    const last = oneExerciseWeek('a', 1, 3, { targetWeight: 80 })
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 90 }), // differs
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-2', isSkipped: true, weight: null, reps: null }), // skipped
      // set 3 not logged yet
    ]
    expect(review({ last: [last], sessions: [session('s1', last.id, 'in_progress', logs)] })).toEqual([])
    // the same logs in a completed session are all three
    expect(kinds(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))).toEqual(['number', 'skipped', 'skipped'])
  })

  it('a session planned but not started gives nothing, nor does a workout with no session at all', () => {
    const last = oneExerciseWeek('a', 1, 2)
    expect(review({ last: [last], sessions: [session('s1', last.id, 'planned', [])] })).toEqual([])
    expect(review({ last: [last], sessions: [] })).toEqual([])
  })

  it('G52: a session skipped as a whole gives no items, three planned sets or not; a completed one with a skipped set gives exactly that one', () => {
    const last = oneExerciseWeek('a', 1, 3)
    expect(review({ last: [last], sessions: [session('s1', last.id, 'skipped', [])] })).toEqual([])
    const skippedSets = [1, 2, 3].map((n) => setLog(`lg-${n}`, 's1', 'ex-1', { weekPlanSetId: `ps-pe-1-${n}`, isSkipped: true, weight: null, reps: null }))
    expect(review({ last: [last], sessions: [session('s1', last.id, 'skipped', skippedSets)] })).toEqual([])

    const oneSkipped = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' }),
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-2', isSkipped: true, weight: null, reps: null }),
      setLog('lg-3', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-3' }),
    ]
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', oneSkipped)] }))
    expect(found.map((i) => i.kind)).toEqual(['skipped'])
    expect((found[0] as ReviewSkippedItem).plannedSetId).toBe('ps-pe-1-2')
  })

  it('a skipped head gives one item: a logged drop under it is no set of its own', () => {
    const last = weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Pushdown')],
      [wset('ps-h', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-h', 'pe-1', 1)],
    )
    const logs = [
      setLog('lg-h', 's1', 'ex-1', { weekPlanSetId: 'ps-h', isSkipped: true, weight: null, reps: null }),
      dropLog('lg-d1', 's1', 'ex-1', 'lg-h', 1, { weekPlanSetId: 'ps-s1', isSkipped: true, weight: null, reps: null }),
    ]
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))
    expect(found.map((i) => i.kind)).toEqual(['skipped'])
  })

  it('matching uses the planned positions: a deleted set does not shift its neighbours', () => {
    // Planned sets 1–3; set 2 was deleted during the session, so the workout renumbered the log of set 3
    // to "set 2". Set 3's item is still planned set 3 (named "set 03", matched with this week's set 3).
    const last = oneExerciseWeek('a', 1, 3, { targetWeight: 80, repMin: 8, repMax: 8 })
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', setNumber: 1, weight: 80 }),
      setLog('lg-3', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-3', setNumber: 2, weight: 85 }),
    ]
    const s = session('s1', last.id, 'completed', logs, { sessionSetChanges: [{ kind: 'deleted', weekPlanSetId: 'ps-pe-1-2' }] })
    const found = items(review({ last: [last], sessions: [s] }))
    expect(found.map((i) => i.kind)).toEqual(['skipped', 'number'])
    const [skipped, number] = found as [ReviewSkippedItem, ReviewNumberItem]
    expect(skipped).toMatchObject({ plannedSetId: 'ps-pe-1-2', setNumber: 2, target: { setId: 'ps-pe-1-2@2' } })
    expect(number).toMatchObject({ plannedSetId: 'ps-pe-1-3', setNumber: 3, target: { setId: 'ps-pe-1-3@2' } })
  })
})

describe('type items: "You made set 02 a dropset" (13d, 19)', () => {
  const retyped = (planned: WeekPlanSet[], logs: SetLog[]) => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], planned)
    return review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })
  }
  const head = (over: Partial<SetLog> = {}) => setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 100, reps: 8, ...over })

  it('a plain planned set done as a dropset with one logged drop is a type item (the seed\'s lateral raise)', () => {
    const found = only<ReviewRetypedItem>(
      retyped([wset('ps-1', 'pe-1', 1)], [head({ stageKind: 'dropset' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1, { weight: 90, reps: 10 })]),
    )
    expect(found).toMatchObject({
      kind: 'retyped',
      plannedSetId: 'ps-1',
      setNumber: 1,
      plannedType: { kind: 'normal' },
      doneType: { kind: 'staged', stageKind: 'dropset', stageCount: 1 },
    })
  })

  it('a kind change is an item: normal to warmup, warmup to normal, and one stage kind to another', () => {
    expect(only<ReviewRetypedItem>(retyped([wset('ps-1', 'pe-1', 1)], [head({ isWarmup: true })]))).toMatchObject({
      plannedType: { kind: 'normal' },
      doneType: { kind: 'warmup' },
    })
    expect(only<ReviewRetypedItem>(retyped([wset('ps-1', 'pe-1', 1, { isWarmup: true, targetRir: null })], [head({ isWarmup: false })]))).toMatchObject({
      plannedType: { kind: 'warmup' },
      doneType: { kind: 'normal' },
    })
    const planned = [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)]
    const done = [head({ stageKind: 'rest_pause' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)]
    expect(only<ReviewRetypedItem>(retyped(planned, done))).toMatchObject({
      plannedType: { kind: 'staged', stageKind: 'dropset', stageCount: 1 },
      doneType: { kind: 'staged', stageKind: 'rest_pause', stageCount: 1 },
    })
  })

  it('the same stage kind with more drops done than planned is an item; the same number, or fewer, is not', () => {
    const planned = [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1), stage('ps-s2', 'ps-1', 'pe-1', 2)]
    const drops = (n: number) => [head({ stageKind: 'dropset' }), ...Array.from({ length: n }, (_, i) => dropLog(`lg-d${i + 1}`, 's1', 'ex-1', 'lg-1', i + 1))]
    expect(only<ReviewRetypedItem>(retyped(planned, drops(3)))).toMatchObject({ doneType: { kind: 'staged', stageKind: 'dropset', stageCount: 3 } })
    expect(retyped(planned, drops(2))).toEqual([])
    expect(retyped(planned, drops(1))).toEqual([])
  })

  it('a planned staged set done plain is no item: its drops were not done, and a stage row is no set', () => {
    const planned = [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)]
    expect(retyped(planned, [head({ stageKind: 'dropset' })])).toEqual([])
    expect(retyped(planned, [head({ stageKind: 'dropset' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1, { isSkipped: true, weight: null, reps: null })])).toEqual([])
  })

  it('a skipped drop is not done: it does not make a plain set a staged one', () => {
    const skippedDrop = dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1, { isSkipped: true, weight: null, reps: null })
    expect(retyped([wset('ps-1', 'pe-1', 1)], [head({ stageKind: 'dropset' }), skippedDrop])).toEqual([])
  })

  it('a planned dropset whose head has no stage kind (before 1.1) is read as a dropset', () => {
    const planned = [wset('ps-1', 'pe-1', 1, { stageKind: null }), stage('ps-s1', 'ps-1', 'pe-1', 1)]
    const asPlanned = [head({ stageKind: null }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)]
    expect(retyped(planned, asPlanned)).toEqual([])
    const asRestPause = [head({ stageKind: 'rest_pause' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)]
    expect(only<ReviewRetypedItem>(retyped(planned, asRestPause))).toMatchObject({ plannedType: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } })
  })

  it('a number item and a type item for the same set are two items with their own keys', () => {
    const found = retyped(
      [wset('ps-1', 'pe-1', 1, { targetWeight: 80, repMin: 8, repMax: 8 })],
      [head({ weight: 90, reps: 8, stageKind: 'dropset' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)],
    )
    expect(kinds(found)).toEqual(['number', 'retyped'])
    expect(keysOf(found)).toEqual(['num:s1:ps-1', 'type:s1:ps-1'])
  })
})

describe('structural items: added sets, added exercises, swaps (13d)', () => {
  const week = () =>
    weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Lat Pulldown'), row('pe-2', 'ex-2', 2, 'Face Pull'), row('pe-3', 'ex-3', 3, 'Seated Row')],
      [
        wset('ps-1-1', 'pe-1', 1),
        wset('ps-2-1', 'pe-2', 1),
        wset('ps-2-2', 'pe-2', 2),
        wset('ps-3-1', 'pe-3', 1),
      ],
    )
  const planned = (n: number, exerciseId: string, set: string, at: string, over: Partial<SetLog> = {}) =>
    setLog(`lg-${exerciseId}-${n}`, 's1', exerciseId, { weekPlanSetId: set, setNumber: n, loggedAt: at, ...over })
  const asPlanned = [
    planned(1, 'ex-1', 'ps-1-1', '2026-10-06T18:00:00.000Z'),
    planned(1, 'ex-2', 'ps-2-1', '2026-10-06T18:10:00.000Z'),
    planned(2, 'ex-2', 'ps-2-2', '2026-10-06T18:15:00.000Z'),
    planned(1, 'ex-3', 'ps-3-1', '2026-10-06T18:30:00.000Z'),
  ]

  it('a set with no planned set behind it, on an exercise of the plan, is an added set: its number, numbers and kind', () => {
    const last = week()
    const extra = setLog('lg-x', 's1', 'ex-2', { setNumber: 3, weight: 15, reps: 18, rir: 1, loggedAt: '2026-10-06T18:20:00.000Z' })
    const found = only<ReviewAddedSetItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, extra])] }))
    expect(found).toMatchObject({
      kind: 'added_set',
      exerciseId: 'ex-2',
      exerciseName: 'Face Pull',
      setNumber: 3,
      done: { weight: 15, reps: 18, rir: 1, type: { kind: 'normal' } },
      target: { programExerciseId: 'pe-2' },
    })
  })

  it('an added set that is a dropset says so, with its drops; an added warmup is a warmup', () => {
    const last = week()
    const head = setLog('lg-x', 's1', 'ex-2', { setNumber: 3, weight: 15, reps: 18, stageKind: 'dropset', loggedAt: '2026-10-06T18:20:00.000Z' })
    const drop = dropLog('lg-xd', 's1', 'ex-2', 'lg-x', 1, { weight: 10, reps: 12 })
    const warm = setLog('lg-w', 's1', 'ex-2', { setNumber: 1, isWarmup: true, weight: 5, reps: 10, rir: null, loggedAt: '2026-10-06T18:05:00.000Z' })
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, head, drop, warm])] })) as ReviewAddedSetItem[]
    expect(found.map((i) => [i.setNumber, i.done.type])).toEqual([
      [1, { kind: 'warmup' }],
      [3, { kind: 'staged', stageKind: 'dropset', stageCount: 1 }],
    ])
    // a warmup and a working set can share a number: the keys stay apart
    expect(keysOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, head, drop, warm])] }))).toEqual([
      'added-set:s1:ex-2:w1',
      'added-set:s1:ex-2:3',
    ])
  })

  it('a skipped added set is nothing, and so is a drop with no head of its own in the session', () => {
    const last = week()
    const skipped = setLog('lg-x', 's1', 'ex-2', { setNumber: 3, isSkipped: true, weight: null, reps: null })
    expect(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, skipped])] })).toEqual([])
  })

  it('an exercise that is not in the plan is ONE added exercise, with every set done on it, warmups first', () => {
    const last = week()
    const fly = (n: number, at: string, over: Partial<SetLog> = {}) => setLog(`lg-fly-${n}`, 's1', 'ex-fly', { setNumber: n, weight: 20, reps: 12, loggedAt: at, ...over })
    const logs = [
      ...asPlanned,
      fly(1, '2026-10-06T18:45:00.000Z'),
      fly(2, '2026-10-06T18:40:00.000Z', { weight: 22.5 }), // numbered after set 1 though logged before it: the number decides
      fly(1, '2026-10-06T18:50:00.000Z', { id: 'lg-fly-w', isWarmup: true, weight: 5, rir: null }), // a warmup logged last still comes first
      fly(3, '2026-10-06T18:55:00.000Z', { id: 'lg-fly-3b', weight: 30 }),
      fly(3, '2026-10-06T18:52:00.000Z', { id: 'lg-fly-3a', weight: 27.5 }), // two logs of one number: the earlier first
    ]
    const found = only<ReviewAddedExerciseItem>(
      review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)], extra: { exercises: [{ id: 'ex-fly', name: 'Cable Fly' }] } }),
    )
    expect(found).toMatchObject({ kind: 'added_exercise', exerciseId: 'ex-fly', exerciseName: 'Cable Fly' })
    expect(found.sets.map((s) => [s.type.kind, s.weight])).toEqual([
      ['warmup', 5],
      ['normal', 20],
      ['normal', 22.5],
      ['normal', 27.5],
      ['normal', 30],
    ])
  })

  it('an added exercise goes after the exercise it followed: the planned one logged last before it, in this week\'s plan', () => {
    const last = week()
    const fly = setLog('lg-fly', 's1', 'ex-fly', { loggedAt: '2026-10-06T18:20:00.000Z' }) // between Face Pull and Seated Row
    const after = only<ReviewAddedExerciseItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, fly])] })).after
    expect(after).toEqual({ programExerciseId: 'pe-2' })

    const first = setLog('lg-fly', 's1', 'ex-fly', { loggedAt: '2026-10-06T17:00:00.000Z' }) // before anything planned
    expect(only<ReviewAddedExerciseItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, first])] })).after).toBeNull()

    // what it followed was a skipped set: not an exercise done before it
    const skipped = setLog('lg-sk', 's1', 'ex-3', { weekPlanSetId: 'ps-3-1', isSkipped: true, weight: null, reps: null, loggedAt: '2026-10-06T18:19:00.000Z' })
    const logs = [asPlanned[0], asPlanned[1], asPlanned[2], skipped, fly]
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))
    expect(found.map((i) => i.kind)).toEqual(['skipped', 'added_exercise'])
    expect((found[1] as ReviewAddedExerciseItem).after).toEqual({ programExerciseId: 'pe-2' })
  })

  it('the exercise it followed is passed over for the one before it when this week no longer has it', () => {
    const last = week()
    const thisWeek = mirrorWeek(last, { exercises: last.exercises.filter((e) => e.id !== 'pe-2'), sets: mirrorWeek(last).sets.filter((s) => s.programExerciseId !== 'pe-2') })
    const fly = setLog('lg-fly', 's1', 'ex-fly', { loggedAt: '2026-10-06T18:20:00.000Z' })
    const found = only<ReviewAddedExerciseItem>(review({ last: [last], thisWeek: [thisWeek], sessions: [session('s1', last.id, 'completed', [...asPlanned, fly])] }))
    expect(found.after).toEqual({ programExerciseId: 'pe-1' })
  })

  it('a recorded swap is ONE item (the slot, both names, the sets done on the replacement); its logs are not an added exercise', () => {
    const last = week()
    const swapped = [
      setLog('lg-r1', 's1', 'ex-rep', { setNumber: 1, loggedAt: '2026-10-06T18:01:00.000Z' }),
      setLog('lg-r2', 's1', 'ex-rep', { setNumber: 2, loggedAt: '2026-10-06T18:02:00.000Z' }),
      ...asPlanned.slice(1),
    ]
    const s = session('s1', last.id, 'completed', swapped, {
      swaps: [swapRecord({ programExerciseId: 'pe-1', originalExerciseId: 'ex-1', originalExerciseName: 'Lat Pulldown', replacementExerciseId: 'ex-rep', replacementExerciseName: 'Wide Pulldown' })],
    })
    const found = only<ReviewSwappedItem>(review({ last: [last], sessions: [s] }))
    expect(found).toMatchObject({
      kind: 'swapped',
      programExerciseId: 'pe-1',
      originalExerciseName: 'Lat Pulldown',
      replacementExerciseName: 'Wide Pulldown',
      doneSets: 2,
      plannedSets: 1,
      target: { programExerciseId: 'pe-1' },
    })
  })

  it('the original\'s sets that the swap skipped, or never logged, are the swap\'s: no "Skipped" items for them; sets done before it still count', () => {
    const last = oneExerciseWeek('a', 1, 3, { targetWeight: 80, repMin: 8, repMax: 8 }, { name: 'Dips' })
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 90, reps: 8 }), // done as the original, before the swap: a number item
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-2', isSkipped: true, weight: null, reps: null }), // skipped by the swap
      // set 3 never logged
      setLog('lg-m1', 's1', 'ex-md', { setNumber: 1 }),
      setLog('lg-m2', 's1', 'ex-md', { setNumber: 2 }),
    ]
    const s = session('s1', last.id, 'completed', logs, { swaps: [swapRecord({ programExerciseId: 'pe-1', originalExerciseName: 'Dips', replacementExerciseId: 'ex-md', replacementExerciseName: 'Machine Dips' })] })
    expect(kinds(review({ last: [last], sessions: [s] }))).toEqual(['swapped', 'number'])
  })

  it('the sets done on the replacement are its working sets: a warmup and a skipped set are not counted', () => {
    const last = week()
    const logs = [
      setLog('lg-rw', 's1', 'ex-rep', { setNumber: 1, isWarmup: true, weight: 10, rir: null }),
      setLog('lg-r1', 's1', 'ex-rep', { setNumber: 1 }),
      setLog('lg-r2', 's1', 'ex-rep', { setNumber: 2 }),
      setLog('lg-r3', 's1', 'ex-rep', { setNumber: 3, isSkipped: true, weight: null, reps: null }),
      ...asPlanned.slice(1),
    ]
    const swaps = [swapRecord({ programExerciseId: 'pe-1', originalExerciseId: 'ex-1', replacementExerciseId: 'ex-rep' })]
    expect(only<ReviewSwappedItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs, { swaps })] })).doneSets).toBe(2)
  })

  it('a swap\'s replacement that is also an exercise of the plan: its logs with no planned set belong to the swap, not to the exercise as added sets', () => {
    const last = week()
    const logs = [
      asPlanned[1],
      asPlanned[2],
      asPlanned[3],
      setLog('lg-r', 's1', 'ex-2', { setNumber: 3, loggedAt: '2026-10-06T18:05:00.000Z' }), // the swap's set, on an exercise the plan also has
    ]
    const swaps = [swapRecord({ programExerciseId: 'pe-1', originalExerciseId: 'ex-1', replacementExerciseId: 'ex-2' })]
    expect(kinds(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs, { swaps })] }))).toEqual(['swapped'])
  })

  it('a skipped set of an exercise that is not in the plan is not an added exercise, and a set done with no weight keeps no weight', () => {
    const last = week()
    const skipped = setLog('lg-sk', 's1', 'ex-fly', { isSkipped: true, weight: null, reps: null })
    expect(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, skipped])] })).toEqual([])
    // a warmup ticked with no numbers, on an exercise that is not in the plan: the added exercise's set has none
    const ticked = setLog('lg-w', 's1', 'ex-fly', { isWarmup: true, weight: null, reps: null, rir: null })
    const found = only<ReviewAddedExerciseItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, ticked])] }))
    expect(found.sets).toEqual([{ weight: null, reps: null, rir: null, type: { kind: 'warmup' } }])
  })

  it('added exercises come in the order they were first logged, a tie by id; the anchor is the exercise logged last before the FIRST set of it', () => {
    const last = week()
    const logs = [
      ...asPlanned,
      setLog('lg-b1', 's1', 'ex-b', { loggedAt: '2026-10-06T18:20:00.000Z' }),
      setLog('lg-a1', 's1', 'ex-a', { loggedAt: '2026-10-06T18:40:00.000Z' }),
      setLog('lg-d1', 's1', 'ex-d', { loggedAt: '2026-10-06T18:50:00.000Z' }),
      setLog('lg-c1', 's1', 'ex-c', { loggedAt: '2026-10-06T18:50:00.000Z' }),
    ]
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] })) as ReviewAddedExerciseItem[]
    expect(found.map((i) => i.exerciseId)).toEqual(['ex-b', 'ex-a', 'ex-c', 'ex-d'])

    // Face Pull (ex-2) was logged between the added fly's two sets: the fly followed Lat Pulldown (ex-1), where it began
    const twoSets = [
      asPlanned[0],
      setLog('lg-f1', 's1', 'ex-fly', { setNumber: 1, loggedAt: '2026-10-06T18:05:00.000Z' }),
      ...asPlanned.slice(1),
      setLog('lg-f2', 's1', 'ex-fly', { setNumber: 2, loggedAt: '2026-10-06T18:45:00.000Z' }),
    ]
    expect(only<ReviewAddedExerciseItem>(review({ last: [last], sessions: [session('s1', last.id, 'completed', twoSets)] })).after).toEqual({ programExerciseId: 'pe-1' })
  })

  it('added sets: warmups first, then by number; of two logs that number one set the same way, the earlier stands', () => {
    const last = week()
    const at = (minute: number) => `2026-10-06T18:${String(minute).padStart(2, '0')}:00.000Z`
    const added = [
      setLog('lg-x3', 's1', 'ex-2', { setNumber: 3, weight: 30, loggedAt: at(20) }),
      setLog('lg-w5', 's1', 'ex-2', { setNumber: 5, isWarmup: true, weight: 7, rir: null, loggedAt: at(22) }), // a warmup numbered after the working sets
      setLog('lg-w1', 's1', 'ex-2', { setNumber: 1, isWarmup: true, weight: 5, rir: null, loggedAt: at(25) }),
      setLog('lg-x4b', 's1', 'ex-2', { setNumber: 4, weight: 99, loggedAt: at(35) }), // the same set number as the one below, later
      setLog('lg-x4a', 's1', 'ex-2', { setNumber: 4, weight: 40, loggedAt: at(30) }),
    ]
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, ...added])] })) as ReviewAddedSetItem[]
    expect(found.map((i) => [i.done.type.kind === 'warmup' ? 'w' : '', i.setNumber, i.done.weight])).toEqual([
      ['w', 1, 5],
      ['w', 5, 7],
      ['', 3, 30],
      ['', 4, 40],
    ])
  })

  it('a swap of a slot the plan does not have, or one with an exercise gone, is no item', () => {
    const last = week()
    const base = (swap: ReturnType<typeof swapRecord>) => review({ last: [last], sessions: [session('s1', last.id, 'completed', asPlanned, { swaps: [swap] })] })
    expect(base(swapRecord({ programExerciseId: 'pe-gone' }))).toEqual([])
    expect(base(swapRecord({ programExerciseId: null }))).toEqual([])
    expect(base(swapRecord({ programExerciseId: 'pe-1', replacementExerciseId: null }))).toEqual([])
  })

  it('a log whose planned set is not in last week\'s plan is neither an added set nor an added exercise', () => {
    const last = week()
    const stray = setLog('lg-x', 's1', 'ex-2', { weekPlanSetId: 'ps-not-in-this-plan', setNumber: 3 })
    expect(review({ last: [last], sessions: [session('s1', last.id, 'completed', [...asPlanned, stray])] })).toEqual([])
  })
})

describe('which week, which workout, which session', () => {
  const last = () => oneExerciseWeek('a', 1, 1, { targetWeight: 80 })
  const different = (plan = last()) => [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: plan.sets[0].id, weight: 90 })]

  it('week 1 has no REVIEW, whatever it is given', () => {
    const w1 = oneExerciseWeek('a', 1, 1, { targetWeight: 80 })
    const w0 = oneExerciseWeek('a', 0, 1, { targetWeight: 80 })
    const sessions = [session('s1', w0.id, 'completed', different(w0))]
    // a "last week" shaped like week 0 and a week 1 shown: nothing
    expect(reviewItems({ weekNumber: 1, lastWeek: { sessions, plan: [w0] }, thisWeek: [w1], decisions: [] })).toEqual([])
  })

  it('the week shown must be a whole number from 1', () => {
    const base = { lastWeek: { sessions: [], plan: [] }, thisWeek: [], decisions: [] }
    for (const weekNumber of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => reviewItems({ weekNumber, ...base })).toThrow(RangeError)
      expect(() => reviewItems({ weekNumber, ...base })).toThrow(/integer >= 1/)
    }
  })

  it('DECISIONS 131: after a missed week nothing is listed; the week before it is never reached back to', () => {
    // Weeks 1 and 2 were done; week 3 was never planned; the week shown is 4. Last week is week 3: no rows.
    const w2 = oneExerciseWeek('a', 2, 1, { targetWeight: 80 })
    const w4 = mirrorWeek(w2, { id: 'wp-a-4', weekNumber: 4 })
    const done = [session('s2', w2.id, 'completed', different(w2))]
    // the caller passes week 3 as it is: a week with nothing in it
    expect(reviewItems({ weekNumber: 4, lastWeek: { sessions: [], plan: [] }, thisWeek: [w4], decisions: [] })).toEqual([])
    // and if week 2's rows are handed over by mistake, they are not last week's
    expect(reviewItems({ weekNumber: 4, lastWeek: { sessions: done, plan: [w2] }, thisWeek: [w4], decisions: [] })).toEqual([])
    // while week 3 is week 2's own "this week": the same rows ARE last week's
    const w3 = mirrorWeek(w2)
    expect(kinds(reviewItems({ weekNumber: 3, lastWeek: { sessions: done, plan: [w2] }, thisWeek: [w3], decisions: [] }))).toEqual(['number'])
  })

  it('only week N − 1\'s rows are read when older ones come along', () => {
    const w1 = oneExerciseWeek('a', 1, 1, { targetWeight: 80 })
    const w2 = mirrorWeek(w1)
    const w3 = mirrorWeek(w2)
    const sessions = [session('s1', w1.id, 'completed', different(w1)), session('s2', w2.id, 'completed', [setLog('lg-2', 's2', 'ex-1', { weekPlanSetId: w2.sets[0].id, weight: 70 })])]
    const found = reviewItems({ weekNumber: 3, lastWeek: { sessions, plan: [w1, w2] }, thisWeek: [w3], decisions: [] })
    expect(found.map((g) => g.sessionId)).toEqual(['s2'])
  })

  it('only the rows of the week shown are this week\'s: an older week\'s row of the same workout is never the one a decision goes on', () => {
    const w1 = last()
    const w2 = mirrorWeek(w1)
    const w0 = oneExerciseWeek('a', 0, 1, { targetWeight: 80 }) // an older row of the same workout, listed first
    const found = review({ last: [w1], thisWeek: [w0, w2], sessions: [session('s1', w1.id, 'completed', different(w1))] })
    expect(found.map((g) => g.weekPlanId)).toEqual([w2.id])
    expect(review({ last: [w1], thisWeek: [w0], sessions: [session('s1', w1.id, 'completed', different(w1))] })).toEqual([])
  })

  it('a workout this week does not have gives nothing: no row to decide on or write to', () => {
    const w1 = last()
    const other = oneExerciseWeek('b', 2, 1)
    expect(review({ last: [w1], thisWeek: [other], sessions: [session('s1', w1.id, 'completed', different(w1))] })).toEqual([])
  })

  it('a sequence run: a workout in two slots is two histories, each paired with its own slot this week', () => {
    // Rotation A, rest, A again: the same workout (wd-a) at sequence positions 0 and 3. Each slot's session
    // belongs to its own plan row, and its items go to that slot's row this week.
    const slot = (position: number) =>
      weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Bench Press')], [wset(`ps-p${position}`, 'pe-1', 1, { targetWeight: 80 })], { id: `wp-a-1-p${position}`, sequencePosition: position })
    const [first, second] = [slot(0), slot(3)]
    const thisWeek = [mirrorWeek(second), mirrorWeek(first)] // the order must not matter
    const sessions = [
      session('s-first', first.id, 'completed', [setLog('lg-1', 's-first', 'ex-1', { weekPlanSetId: 'ps-p0', weight: 90 })], { date: '2026-10-05' }),
      session('s-second', second.id, 'completed', [setLog('lg-2', 's-second', 'ex-1', { weekPlanSetId: 'ps-p3', weight: 95 })], { date: '2026-10-08' }),
    ]
    const groups = reviewItems({ weekNumber: 2, lastWeek: { sessions, plan: [first, second] }, thisWeek, decisions: [] })
    expect(groups.map((g) => [g.sessionId, g.weekPlanId])).toEqual([
      ['s-first', `${first.id}@2`],
      ['s-second', `${second.id}@2`],
    ])
    expect((groups[0].items[0].item as ReviewNumberItem).target.setId).toBe('ps-p0@2')
    expect((groups[1].items[0].item as ReviewNumberItem).target.setId).toBe('ps-p3@2')
  })

  it('G14: one workout on two weekdays shares one plan row; each session\'s items are its own, keyed and decided apart', () => {
    const shared = oneExerciseWeek('fb', 1, 1, { targetWeight: 80 })
    const tue = session('s-tue', shared.id, 'completed', [setLog('lg-t', 's-tue', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 82.5 })], { date: '2026-10-06' })
    const thu = session('s-thu', shared.id, 'completed', [setLog('lg-h', 's-thu', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 85 })], { date: '2026-10-08' })
    const groups = review({ last: [shared], sessions: [thu, tue], extra: { workouts: [{ id: 'wd-fb', name: 'Full Body' }] } })
    expect(groups.map((g) => g.heading)).toEqual(['TUE · FULL BODY', 'THU · FULL BODY'])
    expect(groups.map((g) => g.weekPlanId)).toEqual([`${shared.id}@2`, `${shared.id}@2`])
    expect(keysOf(groups)).toEqual(['num:s-tue:ps-pe-1-1', 'num:s-thu:ps-pe-1-1'])
    // deciding Tuesday's leaves Thursday's
    const decided = review({
      last: [shared],
      sessions: [thu, tue],
      decisions: [{ weekPlanId: `${shared.id}@2`, itemKey: 'num:s-tue:ps-pe-1-1' }],
      extra: { workouts: [{ id: 'wd-fb', name: 'Full Body' }] },
    })
    expect(keysOf(decided)).toEqual(['num:s-thu:ps-pe-1-1'])
  })

  it('groups come in the order of last week\'s days; a moved session is where it was done', () => {
    const upper = oneExerciseWeek('ua', 1, 1, { targetWeight: 80 })
    const lower = oneExerciseWeek('la', 1, 1, { targetWeight: 80 })
    const heavier = (id: string, sessionId: string, planned: string) => [setLog(id, sessionId, 'ex-1', { weekPlanSetId: planned, weight: 90 })]
    const sessions = [
      session('s-lower', lower.id, 'completed', heavier('lg-l', 's-lower', lower.sets[0].id), { date: '2026-10-07' }),
      session('s-upper', upper.id, 'completed', heavier('lg-u', 's-upper', upper.sets[0].id), { date: '2026-10-05', movedToDate: '2026-10-08' }),
    ]
    const groups = review({ last: [lower, upper], sessions, extra: { workouts: [{ id: 'wd-ua', name: 'Upper A' }, { id: 'wd-la', name: 'Lower A' }] } })
    // Monday's Upper A was moved to Thursday: Wednesday's Lower A comes first
    expect(groups.map((g) => [g.heading, g.date])).toEqual([
      ['WED · LOWER A', '2026-10-07'],
      ['THU · UPPER A', '2026-10-08'],
    ])
  })

  it('the heading names the weekday and the workout: its plan row first, then the names given, then the session\'s', () => {
    const w = oneExerciseWeek('a', 1, 1, { targetWeight: 80 })
    const named = { ...w, workoutDay: workoutDay('wd-a', 'Pull 1') }
    const s = session('s1', w.id, 'completed', different(w), { date: '2026-10-06' })
    expect(review({ last: [named], sessions: [s], extra: { workouts: [{ id: 'wd-a', name: 'Other' }] } })[0].heading).toBe('TUE · PULL 1')
    expect(review({ last: [w], sessions: [s], extra: { workouts: [{ id: 'wd-a', name: 'Upper A' }] } })[0].heading).toBe('TUE · UPPER A')
    expect(review({ last: [w], sessions: [{ ...s, workoutDay: workoutDay('wd-a', 'Legs') }] })[0].heading).toBe('TUE · LEGS')
    // no name anywhere: the weekday alone, no dangling separator
    expect(review({ last: [w], sessions: [s] })[0].heading).toBe('TUE')
  })
})

describe('decisions and keys', () => {
  const w1 = () => oneExerciseWeek('a', 1, 2, { targetWeight: 80 })
  const logs = (w: ReturnType<typeof w1>) => [
    setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: w.sets[0].id, weight: 90 }),
    setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: w.sets[1].id, weight: 70 }),
  ]

  it('a decided item is gone and never comes back; the others stay', () => {
    const w = w1()
    const s = session('s1', w.id, 'completed', logs(w))
    expect(keysOf(review({ last: [w], sessions: [s] }))).toEqual(['num:s1:ps-pe-1-1', 'num:s1:ps-pe-1-2'])
    const decided = [{ weekPlanId: `${w.id}@2`, itemKey: 'num:s1:ps-pe-1-1' }]
    expect(keysOf(review({ last: [w], sessions: [s], decisions: decided }))).toEqual(['num:s1:ps-pe-1-2'])
    // listed again after anything else changed (another log, a new decision): still gone
    const more = [...decided, { weekPlanId: `${w.id}@2`, itemKey: 'num:s1:ps-pe-1-2' }]
    expect(review({ last: [w], sessions: [s], decisions: more })).toEqual([])
  })

  it('a decision counts on this week\'s row of the workout and under its key only', () => {
    const w = w1()
    const s = session('s1', w.id, 'completed', logs(w))
    // the same key on another plan row, and another key on this row, hide nothing
    const elsewhere = [{ weekPlanId: 'wp-somewhere-else', itemKey: 'num:s1:ps-pe-1-1' }]
    expect(keysOf(review({ last: [w], sessions: [s], decisions: elsewhere }))).toEqual(['num:s1:ps-pe-1-1', 'num:s1:ps-pe-1-2'])
    const otherKey = [{ weekPlanId: `${w.id}@2`, itemKey: 'num:s1:ps-pe-1-3' }]
    expect(keysOf(review({ last: [w], sessions: [s], decisions: otherKey }))).toEqual(['num:s1:ps-pe-1-1', 'num:s1:ps-pe-1-2'])
  })

  it('the key of an item is itemKey(item), the one function, and unique within a list', () => {
    const w = w1()
    const found = review({ last: [w], sessions: [session('s1', w.id, 'completed', logs(w))] })
    for (const entry of found.flatMap((g) => g.items)) expect(entry.key).toBe(itemKey(entry.item))
    expect(new Set(keysOf(found)).size).toBe(keysOf(found).length)
  })

  it('every kind has its own key shape, and none holds a set log id', () => {
    const last = weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Bench'), row('pe-2', 'ex-2', 2, 'Row'), row('pe-3', 'ex-3', 3, 'Dips')],
      [
        wset('ps-1', 'pe-1', 1, { targetWeight: 80 }),
        wset('ps-2', 'pe-1', 2),
        wset('ps-3', 'pe-1', 3),
        wset('ps-d', 'pe-2', 1),
        wset('ps-e', 'pe-3', 1),
      ],
    )
    const logs = [
      setLog('log-aaaa-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 90 }), // number
      setLog('log-aaaa-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', stageKind: 'dropset' }), // type (with its drop)
      dropLog('log-aaaa-3', 's1', 'ex-1', 'log-aaaa-2', 1),
      // ps-3 not logged: skipped
      setLog('log-aaaa-4', 's1', 'ex-2', { weekPlanSetId: 'ps-d' }),
      setLog('log-aaaa-5', 's1', 'ex-2', { setNumber: 2 }), // added set
      setLog('log-aaaa-6', 's1', 'ex-fly', { setNumber: 1 }), // added exercise
      setLog('log-aaaa-7', 's1', 'ex-md', { setNumber: 1 }), // the swap's replacement
    ]
    const s = session('s1', last.id, 'completed', logs, { swaps: [swapRecord({ programExerciseId: 'pe-3', originalExerciseId: 'ex-3', replacementExerciseId: 'ex-md' })] })
    const found = review({ last: [last], sessions: [s] })
    expect(keysOf(found)).toEqual([
      'num:s1:ps-1',
      'type:s1:ps-2',
      'skipped:s1:ps-3',
      'added-set:s1:ex-2:2',
      'swap:s1:pe-3',
      'added-ex:s1:ex-fly',
    ])
    for (const key of keysOf(found)) expect(key).not.toMatch(/log-aaaa/)
  })

  it('an added set keeps its key when it is unlogged and logged again as a new log row, so its decision still hides it', () => {
    const last = oneExerciseWeek('a', 1, 1)
    const planned = setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' })
    const before = [planned, setLog('lg-old', 's1', 'ex-1', { setNumber: 2, weight: 20, reps: 15, loggedAt: '2026-10-05T18:10:00.000Z' })]
    const after = [planned, setLog('lg-new', 's1', 'ex-1', { setNumber: 2, weight: 20, reps: 15, loggedAt: '2026-10-05T19:30:00.000Z' })]
    const keyBefore = keysOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', before)] }))
    const keyAfter = keysOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', after)] }))
    expect(keyBefore).toEqual(['added-set:s1:ex-1:2'])
    expect(keyAfter).toEqual(keyBefore)
    const decided = [{ weekPlanId: `${last.id}@2`, itemKey: keyBefore[0] }]
    expect(review({ last: [last], sessions: [session('s1', last.id, 'completed', after)], decisions: decided })).toEqual([])
  })

  it('two logs that number one added set the same way (a duplicate) are one item, with one key', () => {
    const last = oneExerciseWeek('a', 1, 1)
    const planned = setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1' })
    const twice = [planned, setLog('lg-x1', 's1', 'ex-1', { setNumber: 2, weight: 20, reps: 15 }), setLog('lg-x2', 's1', 'ex-1', { setNumber: 2, weight: 20, reps: 15 })]
    expect(keysOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', twice)] }))).toEqual(['added-set:s1:ex-1:2'])
  })

  it('the same planned set in two sessions has two keys (the session is in the key)', () => {
    const w = oneExerciseWeek('a', 1, 1, { targetWeight: 80 })
    const a = session('s-a', w.id, 'completed', [setLog('lg-a', 's-a', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 90 })], { date: '2026-10-05' })
    const b = session('s-b', w.id, 'completed', [setLog('lg-b', 's-b', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 90 })], { date: '2026-10-07' })
    const [first, second] = keysOf(review({ last: [w], sessions: [a, b] }))
    expect(first).not.toBe(second)
  })
})

describe('names and units', () => {
  it('an exercise\'s name comes from its plan row, else the names given, else its logs', () => {
    const last = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Bench Press')], [wset('ps-1', 'pe-1', 1, { targetWeight: 80 })])
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 90 }),
      setLog('lg-2', 's1', 'ex-fly', { setNumber: 1, exercise: { id: 'ex-fly', userId: 'u', name: 'From The Log', muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null } }),
    ]
    const found = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))
    expect(found.map((i) => ('exerciseName' in i ? i.exerciseName : ''))).toEqual(['Bench Press', 'From The Log'])
    const named = items(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)], extra: { exercises: [{ id: 'ex-fly', name: 'From The List' }, { id: 'ex-1', name: 'Never Used' }] } }))
    expect(named.map((i) => ('exerciseName' in i ? i.exerciseName : ''))).toEqual(['Bench Press', 'From The List'])
  })

  it('a plan row with no joined exercise takes its name from the names given', () => {
    const bare = { ...row('pe-1', 'ex-1', 1, 'Unused'), exercise: undefined }
    const last = weekPlan('a', 1, [bare], [wset('ps-1', 'pe-1', 1, { targetWeight: 80 })])
    const s = session('s1', last.id, 'completed', [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 90 })])
    expect(only<ReviewNumberItem>(review({ last: [last], sessions: [s] })).exerciseName).toBe('')
    expect(only<ReviewNumberItem>(review({ last: [last], sessions: [s], extra: { exercises: [{ id: 'ex-1', name: 'Bench Press' }] } })).exerciseName).toBe('Bench Press')
  })

  it('a weight reads in the exercise\'s own unit, else the Settings unit, else kg', () => {
    const lbs = { ...row('pe-1', 'ex-1', 1, 'Lateral Raise'), weightUnit: 'lbs' as const }
    const last = weekPlan('a', 1, [lbs], [wset('ps-1', 'pe-1', 1, { targetWeight: 9 })])
    const s = session('s1', last.id, 'completed', [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 10 })])
    expect(only<ReviewNumberItem>(review({ last: [last], sessions: [s] })).unit).toBe('lbs')
    const plain = weekPlan('a', 1, [row('pe-1', 'ex-1', 1, 'Lateral Raise')], [wset('ps-1', 'pe-1', 1, { targetWeight: 9 })])
    const s2 = session('s1', plain.id, 'completed', [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 10 })])
    expect(only<ReviewNumberItem>(review({ last: [plain], sessions: [s2] })).unit).toBe('kg')
    expect(only<ReviewNumberItem>(review({ last: [plain], sessions: [s2], extra: { weightUnit: 'lbs' } })).unit).toBe('lbs')
  })
})

describe('two weights are the same when they read the same in the exercise\'s unit', () => {
  // 9 kg is 19.8 lbs; typing the displayed 19.8 lbs stores 8.98 kg: a set done as planned, not a difference
  const lbs = (done: number) => {
    const rowOf = { ...row('pe-1', 'ex-1', 1, 'Lateral Raise'), weightUnit: 'lbs' as const }
    const last = weekPlan('a', 1, [rowOf], [wset('ps-1', 'pe-1', 1, { targetWeight: 9, repMin: 15, repMax: 15 })])
    return review({ last: [last], sessions: [session('s1', last.id, 'completed', [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: done, reps: 15 })])] })
  }

  it('in lbs, the stored 8.98 kg of a typed 19.8 lbs is the planned 9 kg; a heavier weight is not', () => {
    expect(lbs(8.98)).toEqual([])
    expect(lbs(9)).toEqual([])
    expect(only<ReviewNumberItem>(lbs(9.5))).toMatchObject({ weightDiffers: true, done: { weight: 9.5 } })
  })

  it('in kg, 8.98 is not 9', () => {
    const last = oneExerciseWeek('a', 1, 1, { targetWeight: 9, repMin: 15, repMax: 15 })
    const s = session('s1', last.id, 'completed', [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 8.98, reps: 15 })])
    expect(only<ReviewNumberItem>(review({ last: [last], sessions: [s] }))).toMatchObject({ weightDiffers: true })
  })
})

describe('what comes out does not depend on the order what goes in arrives in', () => {
  it('exercises, planned sets and logs in any order give the items in the order the workout is laid out', () => {
    const last = weekPlan(
      'a',
      1,
      [row('pe-1', 'ex-1', 1, 'Bench'), row('pe-2', 'ex-2', 2, 'Row'), row('pe-3', 'ex-3', 3, 'Curl')],
      [
        wset('ps-w', 'pe-1', 1, { isWarmup: true, targetWeight: 40, repMin: 10, repMax: 10, targetRir: null }),
        wset('ps-1', 'pe-1', 2, { targetWeight: 80 }),
        wset('ps-2', 'pe-1', 3, { targetWeight: 80 }),
        wset('ps-3', 'pe-2', 1, { targetWeight: 80 }),
        wset('ps-d', 'pe-2', 2, { targetWeight: 80 }),
        wset('ps-e', 'pe-3', 1, { targetWeight: 80 }),
      ],
    )
    const lift = (id: string, exerciseId: string, planned: string, n: number, over: Partial<SetLog> = {}) =>
      setLog(id, 's1', exerciseId, { weekPlanSetId: planned, setNumber: n, weight: 90, ...over })
    const logs = [
      lift('lg-w', 'ex-1', 'ps-w', 1, { isWarmup: true, weight: 50, rir: null }),
      lift('lg-1', 'ex-1', 'ps-1', 1),
      lift('lg-2', 'ex-1', 'ps-2', 2),
      lift('lg-3', 'ex-2', 'ps-3', 1),
      lift('lg-4', 'ex-2', 'ps-d', 2),
      lift('lg-5', 'ex-3', 'ps-e', 1),
    ]
    const expected = ['num:s1:ps-w', 'num:s1:ps-1', 'num:s1:ps-2', 'num:s1:ps-3', 'num:s1:ps-d', 'num:s1:ps-e']
    expect(keysOf(review({ last: [last], sessions: [session('s1', last.id, 'completed', logs)] }))).toEqual(expected)
    const scrambled = { ...last, exercises: [...last.exercises].reverse(), sets: [...last.sets].reverse() }
    const found = review({ last: [scrambled], thisWeek: [mirrorWeek(scrambled)], sessions: [session('s1', last.id, 'completed', [...logs].reverse())] })
    expect(keysOf(found)).toEqual(expected)
    // the numbers follow the planned positions too, not the order the rows arrived in
    expect(items(found).map((i) => ('setNumber' in i ? i.setNumber : 0))).toEqual([1, 1, 2, 1, 2, 1])
  })
})

describe('the module reads its input and never changes it', () => {
  it('a deep-frozen input lists the same items', () => {
    const last = oneExerciseWeek('a', 1, 3, { targetWeight: 80 })
    const logs = [
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-1', weight: 90 }),
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-pe-1-2', isSkipped: true, weight: null, reps: null }),
      setLog('lg-3', 's1', 'ex-1', { setNumber: 4, weight: 50 }),
    ]
    const input = {
      weekNumber: 2,
      lastWeek: { sessions: [session('s1', last.id, 'completed', logs)], plan: [last] },
      thisWeek: [mirrorWeek(last)],
      decisions: [],
    }
    const expected = reviewItems(structuredCloneJson(input))
    expect(kinds(expected)).toEqual(['number', 'skipped', 'skipped', 'added_set'])
    expect(reviewItems(deepFreeze(input))).toEqual(expected)
  })
})

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
