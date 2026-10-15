import { describe, it, expect } from 'vitest'
import type { SessionSetChange, SessionSetChangeType, SetLog, WeekPlan, WeekPlanSet } from '../../types'
import {
  applyReviewAction,
  itemKey,
  primaryAction,
  type ReviewAction,
  type ReviewAddedExerciseItem,
  type ReviewAddedSetItem,
  type ReviewItem,
  type ReviewNumberItem,
  type ReviewRetypedItem,
  type ReviewSkippedItem,
  type ReviewSwappedItem,
  type ReviewWrite,
} from './review'
import { applyWrites, deepFreeze, dropLog, review, row, session, setLog, stage, swapRecord, weekPlan, wset } from './review.testutil'

// Chunk 43 (TASKS-1.2 "REVIEW as a pure function"): what each action writes. Every test names what is
// written (the set's own field names, the ids of THIS week's rows, the decision row) and uses a this
// week whose ids and positions differ from last week's, so a write to last week's row, or to the wrong
// position, shows. A "writer" here is the data an action returns; chunk 56 sends it.

const counter = () => {
  let n = 0
  return () => `new-${++n}`
}

const exercises = [row('pe-1', 'ex-1', 1, 'Bench Press'), row('pe-2', 'ex-2', 2, 'Row')]

// Last week's Upper A: a warmup and three working sets of bench (set numbers 1–4), two row sets.
const lastWeek = (): WeekPlan =>
  weekPlan(
    'a',
    1,
    exercises,
    [
      wset('ps-w', 'pe-1', 1, { isWarmup: true, targetWeight: 40, repMin: 10, repMax: 10, targetRir: null }),
      wset('ps-1', 'pe-1', 2, { targetWeight: 80, repMin: 6, repMax: 8, targetRir: 2 }),
      wset('ps-2', 'pe-1', 3, { targetWeight: 80, repMin: 6, repMax: 8, targetRir: 2 }),
      wset('ps-3', 'pe-1', 4, { targetWeight: 80, repMin: 6, repMax: 8, targetRir: 2 }),
      wset('ps-r1', 'pe-2', 1, { targetWeight: 60 }),
      wset('ps-r2', 'pe-2', 2, { targetWeight: 60 }),
    ],
  )

// This week: its own ids, TWO warmups on the bench (so a pairing by raw position hits the wrong set), other numbers.
const thisWeekSets = (): WeekPlanSet[] => [
  wset('ts-w1', 'pe-1', 1, { isWarmup: true, targetWeight: 30, repMin: 10, repMax: 10, targetRir: null }),
  wset('ts-w2', 'pe-1', 2, { isWarmup: true, targetWeight: 40, repMin: 8, repMax: 8, targetRir: null }),
  wset('ts-1', 'pe-1', 3, { targetWeight: 77.5, repMin: 8, repMax: 10, targetRir: 2 }),
  wset('ts-2', 'pe-1', 4, { targetWeight: 77.5, repMin: 8, repMax: 10, targetRir: 2 }),
  wset('ts-3', 'pe-1', 5, { targetWeight: 77.5, repMin: 8, repMax: 10, targetRir: 2 }),
  wset('ts-r1', 'pe-2', 1, { targetWeight: 55 }),
  wset('ts-r2', 'pe-2', 2, { targetWeight: 55 }),
]
const thisWeek = (sets = thisWeekSets(), exs = exercises): WeekPlan => weekPlan('a', 2, exs, sets)

// The items of a completed Upper A with `logs`, listed against this week's plan.
function itemsFor(
  logs: SetLog[],
  opts: { last?: WeekPlan; thisWeek?: WeekPlan; swaps?: ReturnType<typeof swapRecord>[]; changes?: SessionSetChange[] } = {},
): ReviewItem[] {
  const last = opts.last ?? lastWeek()
  const groups = review({
    last: [last],
    thisWeek: [opts.thisWeek ?? thisWeek()],
    sessions: [session('s1', last.id, 'completed', logs, { swaps: opts.swaps ?? [], sessionSetChanges: opts.changes ?? [] })],
  })
  return groups.flatMap((g) => g.items.map((e) => e.item))
}

const asPlanned = (): SetLog[] => [
  setLog('lg-w', 's1', 'ex-1', { weekPlanSetId: 'ps-w', isWarmup: true, weight: 40, reps: 10, rir: null, loggedAt: '2026-10-05T18:00:00.000Z' }),
  setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', setNumber: 1, weight: 80, reps: 8, loggedAt: '2026-10-05T18:05:00.000Z' }),
  setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', setNumber: 2, weight: 80, reps: 7, loggedAt: '2026-10-05T18:10:00.000Z' }),
  setLog('lg-3', 's1', 'ex-1', { weekPlanSetId: 'ps-3', setNumber: 3, weight: 80, reps: 6, loggedAt: '2026-10-05T18:15:00.000Z' }),
  setLog('lg-r1', 's1', 'ex-2', { weekPlanSetId: 'ps-r1', setNumber: 1, weight: 60, reps: 8, loggedAt: '2026-10-05T18:20:00.000Z' }),
  setLog('lg-r2', 's1', 'ex-2', { weekPlanSetId: 'ps-r2', setNumber: 2, weight: 60, reps: 8, loggedAt: '2026-10-05T18:25:00.000Z' }),
]
const withLog = (id: string, over: Partial<SetLog>): SetLog[] => asPlanned().map((l) => (l.id === id ? { ...l, ...over } : l))

const first = <T extends ReviewItem>(found: ReviewItem[], kind: T['kind']): T => {
  const item = found.find((i) => i.kind === kind)
  if (!item) throw new Error(`no ${kind} item in ${found.map((i) => i.kind).join(', ')}`)
  return item as T
}

describe('USE on a number item: the done weight and reps into this week\'s matching set', () => {
  it('writes the done weight and the done reps as a number (a range becomes it), by the set\'s own field names, to this week\'s set', () => {
    const found = itemsFor(withLog('lg-2', { weight: 82.5, reps: 7 }))
    const item = first<ReviewNumberItem>(found, 'number')
    const result = applyReviewAction(item, 'use', thisWeek(), counter())
    expect(result.writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-2', changes: { targetWeight: 82.5, repMin: 7, repMax: 7, isAmrap: false } },
    ])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'num:s1:ps-2', decision: 'used' })
  })

  it('matches by planned position, warmups to warmups: last week\'s working set 3 is this week\'s working set 3, not its third set', () => {
    // this week has two warmups, so its third row (ts-1) is a working set 1: a pairing by raw index would write there
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-3', { weight: 90, reps: 5 })), 'number')
    expect(item.plannedSetId).toBe('ps-3')
    const [write] = applyReviewAction(item, 'use', thisWeek(), counter()).writes
    expect(write).toMatchObject({ kind: 'update_set', setId: 'ts-3' })
  })

  it('a warmup\'s item writes into this week\'s FIRST warmup, never a working set', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-w', { weight: 50 })), 'number')
    expect(item.isWarmup).toBe(true)
    const [write] = applyReviewAction(item, 'use', thisWeek(), counter()).writes
    // this week's first warmup already has 10 reps: only the weight changes (the second one, ts-w2, is not touched)
    expect(write).toEqual({ kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-w1', changes: { targetWeight: 50 } })
  })

  it('writes only what changes: a field this week\'s set already holds is left out, and nothing at all when both match', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-2', { weight: 77.5, reps: 7 })), 'number')
    // weight equals this week's 77.5; only the reps change from 8–10 to 7
    const sets = thisWeekSets()
    const [write] = applyReviewAction(item, 'use', thisWeek(sets), counter()).writes
    expect(write).toMatchObject({ changes: { repMin: 7, repMax: 7, isAmrap: false } })
    expect((write as Extract<ReviewWrite, { kind: 'update_set' }>).changes).not.toHaveProperty('targetWeight')
    // this week's set already is 77.5 × 7: nothing to write, the decision still is
    const holding = thisWeekSets().map((s) => (s.id === 'ts-2' ? { ...s, repMin: 7, repMax: 7 } : s))
    const result = applyReviewAction(item, 'use', thisWeek(holding), counter())
    expect(result.writes).toEqual([])
    expect(result.decision).toMatchObject({ decision: 'used' })
  })

  it('a weight that reads the same in the exercise\'s unit is not written: 9 kg in lbs is 19.8, as is the 8.98 that was logged', () => {
    const rowOf = { ...row('pe-1', 'ex-1', 1, 'Lateral Raise'), weightUnit: 'lbs' as const }
    const last = weekPlan('a', 1, [rowOf], [wset('ps-1', 'pe-1', 1, { targetWeight: 9, repMin: 15, repMax: 15 })])
    const week2 = weekPlan('a', 2, [rowOf], [wset('ts-1', 'pe-1', 1, { targetWeight: 9, repMin: 12, repMax: 12 })])
    const logs = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 8.98, reps: 10 })] // reps differ, the weight reads the same
    const item = first<ReviewNumberItem>(itemsFor(logs, { last, thisWeek: week2 }), 'number')
    expect(item.weightDiffers).toBe(false)
    const [write] = applyReviewAction(item, 'use', week2, counter()).writes
    expect(write).toEqual({ kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { repMin: 10, repMax: 10, isAmrap: false } })
    // a weight that really differs is written, whatever this week's reads
    const heavier = [setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 10, reps: 10 })]
    const [other] = applyReviewAction(first<ReviewNumberItem>(itemsFor(heavier, { last, thisWeek: week2 }), 'number'), 'use', week2, counter()).writes
    expect(other).toMatchObject({ changes: { targetWeight: 10, repMin: 10, repMax: 10 } })
    // and one this week has none of is written too
    const empty = weekPlan('a', 2, [rowOf], [wset('ts-1', 'pe-1', 1, { targetWeight: null, repMin: 10, repMax: 10 })])
    const [filled] = applyReviewAction(first<ReviewNumberItem>(itemsFor(logs, { last, thisWeek: empty }), 'number'), 'use', empty, counter()).writes
    expect(filled).toMatchObject({ changes: { targetWeight: 8.98 } })
  })

  it('the reps are written when ANY of the three columns differs: a range that differs only in its low end, only in its high end', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-2', { weight: 77.5, reps: 7 })), 'number')
    const withReps = (repMin: number, repMax: number) => thisWeek(thisWeekSets().map((s) => (s.id === 'ts-2' ? { ...s, repMin, repMax } : s)))
    const expected = { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-2', changes: { repMin: 7, repMax: 7, isAmrap: false } }
    expect(applyReviewAction(item, 'use', withReps(6, 7), counter()).writes).toEqual([expected]) // only the low end differs
    expect(applyReviewAction(item, 'use', withReps(7, 9), counter()).writes).toEqual([expected]) // only the high end differs
    expect(applyReviewAction(item, 'use', withReps(7, 7), counter()).writes).toEqual([]) // none differs
    // an AMRAP target this week becomes the number (the done weight equals this week's: nothing else changes)
    const amrap = thisWeek(thisWeekSets().map((s) => (s.id === 'ts-2' ? { ...s, repMin: null, repMax: null, isAmrap: true } : s)))
    expect(applyReviewAction(item, 'use', amrap, counter()).writes).toEqual([expected])
  })

  it('AMRAP planned: the weight is taken over and the reps are not (this week\'s target stays AMRAP)', () => {
    const last = weekPlan('a', 1, exercises, [wset('ps-a', 'pe-1', 1, { targetWeight: 100, repMin: null, repMax: null, isAmrap: true })])
    const week2 = weekPlan('a', 2, exercises, [wset('ts-a', 'pe-1', 1, { targetWeight: 95, repMin: null, repMax: null, isAmrap: true })])
    const logs = [setLog('lg-a', 's1', 'ex-1', { weekPlanSetId: 'ps-a', weight: 105, reps: 14 })]
    const item = first<ReviewNumberItem>(itemsFor(logs, { last, thisWeek: week2 }), 'number')
    const result = applyReviewAction(item, 'use', week2, counter())
    expect(result.writes).toEqual([{ kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-a', changes: { targetWeight: 105 } }])
  })

  it('with no matching set (this week has fewer) it becomes ADD THIS SET: appended after the last set, with the done numbers', () => {
    const fewer = thisWeekSets().filter((s) => s.id !== 'ts-3') // this week's bench has working sets 1 and 2 only
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-3', { weight: 90, reps: 5 }), { thisWeek: thisWeek(fewer) }), 'number')
    expect(item.target.setId).toBeNull()
    const result = applyReviewAction(item, 'use', thisWeek(fewer), counter())
    expect(result.writes).toEqual([
      {
        kind: 'insert_set',
        set: {
          id: 'new-1',
          weekPlanId: 'wp-a-2',
          programExerciseId: 'pe-1',
          setNumber: 5, // after this week's highest set number on the bench (4), not last week's
          parentWeekPlanSetId: null,
          stageIndex: 0,
          isDropset: false,
          isWarmup: false,
          stageKind: null,
          targetWeight: 90,
          repMin: 5,
          repMax: 5,
          isAmrap: false,
          targetRir: null,
          targetRirMax: null,
          tags: null,
          programSetId: null,
        },
      },
    ])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'num:s1:ps-3', decision: 'used' })
  })

  it('nothing is written when this week no longer has the exercise at all; the decision is still left', () => {
    const noBench = [exercises[1]]
    const week2 = thisWeek(thisWeekSets().filter((s) => s.programExerciseId === 'pe-2'), noBench)
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-3', { weight: 90, reps: 5 }), { thisWeek: week2 }), 'number')
    expect(item.target).toEqual({ programExerciseId: null, setId: null })
    const result = applyReviewAction(item, 'use', week2, counter())
    expect(result.writes).toEqual([])
    expect(result.decision.decision).toBe('used')
  })
})

describe('a number the plan cannot hold is left out: its table checks target_weight >= 0 and rep_min > 0', () => {
  // A log takes any number typed: 0 reps for a failed attempt, a weight below 0. A write of either would be
  // refused by the plan's table and would fail the whole request, so the action leaves that number out.
  const weekWithBodyweight = () =>
    weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { targetWeight: 0, repMin: 8, repMax: 8 }), wset('ps-2', 'pe-1', 2, { targetWeight: 0, repMin: 8, repMax: 8 })])
  const bodyweightThisWeek = () =>
    weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { targetWeight: 0, repMin: 8, repMax: 10 }), wset('ts-2', 'pe-1', 2, { targetWeight: 0, repMin: 8, repMax: 10 })])
  const numberItem = (logs: SetLog[], last = lastWeek(), week2 = thisWeek()) => first<ReviewNumberItem>(itemsFor(logs, { last, thisWeek: week2 }), 'number')

  it('USE: 0 reps are not written as a target; the weight is', () => {
    const item = numberItem(withLog('lg-2', { weight: 85, reps: 0 }))
    expect(item).toMatchObject({ weightDiffers: true, repsDiffer: true })
    expect(applyReviewAction(item, 'use', thisWeek(), counter()).writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-2', changes: { targetWeight: 85 } },
    ])
  })

  it('USE: a weight below 0 is not written as a target; the reps are', () => {
    const last = weekWithBodyweight()
    const week2 = bodyweightThisWeek()
    const item = numberItem([setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: -20, reps: 10 }), setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', weight: 0, reps: 8 })], last, week2)
    expect(item).toMatchObject({ weightDiffers: true, repsDiffer: true })
    expect(applyReviewAction(item, 'use', week2, counter()).writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { repMin: 10, repMax: 10, isAmrap: false } },
    ])
    // a weight of 0 (bodyweight) is a target
    const added = numberItem([setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: 0, reps: 9 }), setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', weight: 0, reps: 8 })], last, week2)
    expect(added.weightDiffers).toBe(false)
  })

  it('USE: when neither number can be held nothing is written and the decision is still left', () => {
    const last = weekWithBodyweight()
    const week2 = bodyweightThisWeek()
    const item = numberItem([setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', weight: -20, reps: 0 }), setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2' })], last, week2)
    expect(applyReviewAction(item, 'use', week2, counter())).toMatchObject({ writes: [], decision: { decision: 'used' } })
  })

  it('the edges are held: a weight of exactly 0 and a single rep are targets, in USE, ADD THIS SET and ADD EXERCISE', () => {
    const use = numberItem(withLog('lg-2', { weight: 0, reps: 1 }))
    expect(use).toMatchObject({ weightDiffers: true, repsDiffer: true })
    expect(applyReviewAction(use, 'use', thisWeek(), counter()).writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-2', changes: { targetWeight: 0, repMin: 1, repMax: 1, isAmrap: false } },
    ])

    const extra = setLog('lg-x', 's1', 'ex-2', { setNumber: 3, weight: 0, reps: 1, loggedAt: '2026-10-05T18:30:00.000Z' })
    const added = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), extra]), 'added_set')
    const [write] = applyReviewAction(added, 'add_set', thisWeek(), counter()).writes
    expect(write).toMatchObject({ kind: 'insert_set', set: { targetWeight: 0, repMin: 1, repMax: 1, isAmrap: false } })

    const fly = setLog('lg-fly-1', 's1', 'ex-fly', { setNumber: 1, weight: 0, reps: 1, loggedAt: '2026-10-05T18:41:00.000Z' })
    const exercise = first<ReviewAddedExerciseItem>(itemsFor([...asPlanned(), fly]), 'added_exercise')
    const [edit] = applyReviewAction(exercise, 'add_exercise', thisWeek(), counter()).writes
    expect(edit).toMatchObject({ edit: { sets: [{ weight: 0, reps: 1 }] } })
  })

  it('ADD THIS SET and ADD EXERCISE: those numbers are left out of what is added', () => {
    const extra = setLog('lg-x', 's1', 'ex-2', { setNumber: 3, weight: -10, reps: 0, loggedAt: '2026-10-05T18:30:00.000Z' })
    const added = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), extra]), 'added_set')
    const [write] = applyReviewAction(added, 'add_set', thisWeek(), counter()).writes
    expect(write).toMatchObject({ kind: 'insert_set', set: { targetWeight: null, repMin: null, repMax: null, isAmrap: false } })

    const fly = (n: number, over: Partial<SetLog>) => setLog(`lg-fly-${n}`, 's1', 'ex-fly', { setNumber: n, loggedAt: `2026-10-05T18:4${n}:00.000Z`, ...over })
    const exercise = first<ReviewAddedExerciseItem>(itemsFor([...asPlanned(), fly(1, { weight: -10, reps: 12 }), fly(2, { weight: 20, reps: 0 })]), 'added_exercise')
    const [edit] = applyReviewAction(exercise, 'add_exercise', thisWeek(), counter()).writes
    expect(edit).toMatchObject({ edit: { sets: [{ weight: null, reps: 12 }, { weight: 20, reps: null }] } })
  })
})

describe('ADD THIS SET: a new set at the end of the exercise, with the done weight, reps and kind', () => {
  const extra = (over: Partial<SetLog> = {}) => setLog('lg-x', 's1', 'ex-2', { setNumber: 3, weight: 20, reps: 15, rir: 2, loggedAt: '2026-10-05T18:30:00.000Z', ...over })

  it('inserts one head: this week\'s plan row and exercise row, the number after this week\'s highest set number, the done numbers as targets, no RIR', () => {
    const sets = thisWeekSets().map((s) => (s.id === 'ts-r2' ? { ...s, setNumber: 4 } : s)) // a gap: numbers 1 and 4
    const week2 = thisWeek(sets)
    const item = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), extra()], { thisWeek: week2 }), 'added_set')
    const result = applyReviewAction(item, 'add_set', week2, counter())
    expect(result.writes).toEqual([
      {
        kind: 'insert_set',
        set: {
          id: 'new-1',
          weekPlanId: 'wp-a-2',
          programExerciseId: 'pe-2',
          setNumber: 5,
          parentWeekPlanSetId: null,
          stageIndex: 0,
          isDropset: false,
          isWarmup: false,
          stageKind: null,
          targetWeight: 20,
          repMin: 15,
          repMax: 15,
          isAmrap: false,
          targetRir: null,
          targetRirMax: null,
          tags: null,
          programSetId: null,
        },
      },
    ])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'added-set:s1:ex-2:3', decision: 'used' })
  })

  it('takes the done kind: a dropset adds its head with the kind and one stage row per drop, parented, numbered, empty', () => {
    const logs = [...asPlanned(), extra({ stageKind: 'dropset' }), dropLog('lg-xd1', 's1', 'ex-2', 'lg-x', 1), dropLog('lg-xd2', 's1', 'ex-2', 'lg-x', 2)]
    const item = first<ReviewAddedSetItem>(itemsFor(logs), 'added_set')
    const writes = applyReviewAction(item, 'add_set', thisWeek(), counter()).writes
    expect(writes.map((w) => (w.kind === 'insert_set' ? [w.set.id, w.set.parentWeekPlanSetId, w.set.stageIndex, w.set.isDropset, w.set.stageKind, w.set.setNumber] : w.kind))).toEqual([
      ['new-1', null, 0, false, 'dropset', 3],
      ['new-2', 'new-1', 1, true, null, 3],
      ['new-3', 'new-1', 2, true, null, 3],
    ])
    const stageRow = (writes[1] as Extract<ReviewWrite, { kind: 'insert_set' }>).set
    expect(stageRow).toMatchObject({ targetWeight: null, repMin: null, repMax: null, isAmrap: false, targetRir: null, tags: null, isWarmup: false })
  })

  it('DECISIONS 141: an added set given a stage kind with no drop done is added as that kind with the count set in the workout: its pending-stages row, else one drop', () => {
    const logs = [...asPlanned(), extra({ stageKind: 'dropset' })]
    const stageRows = (changes: SessionSetChange[]) => {
      const item = first<ReviewAddedSetItem>(itemsFor(logs, { changes }), 'added_set')
      const writes = applyReviewAction(item, 'add_set', thisWeek(), counter()).writes
      return writes.map((w) => (w.kind === 'insert_set' ? [w.set.parentWeekPlanSetId, w.set.stageIndex, w.set.stageKind] : w.kind))
    }
    expect(stageRows([])).toEqual([[null, 0, 'dropset'], ['new-1', 1, null]])
    expect(stageRows([{ kind: 'pending_stages', setLogId: 'lg-x', stageKind: 'dropset', stageCount: 2 }])).toEqual([[null, 0, 'dropset'], ['new-1', 1, null], ['new-1', 2, null]])
    // a pending-stages row of another log is not this set's
    expect(stageRows([{ kind: 'pending_stages', setLogId: 'lg-other', stageKind: 'dropset', stageCount: 3 }])).toEqual([[null, 0, 'dropset'], ['new-1', 1, null]])
  })

  it('a warmup is added as a warmup; reps never done leave no rep target', () => {
    const warm = extra({ isWarmup: true, weight: 10, reps: null, rir: null })
    const item = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), warm]), 'added_set')
    const [write] = applyReviewAction(item, 'add_set', thisWeek(), counter()).writes
    expect(write).toMatchObject({ kind: 'insert_set', set: { isWarmup: true, targetWeight: 10, repMin: null, repMax: null, isAmrap: false } })
  })

  it('a set done with no numbers is added with no targets', () => {
    const ticked = extra({ isWarmup: true, weight: null, reps: null, rir: null })
    const item = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), ticked]), 'added_set')
    const [write] = applyReviewAction(item, 'add_set', thisWeek(), counter()).writes
    expect(write).toMatchObject({ kind: 'insert_set', set: { isWarmup: true, targetWeight: null, repMin: null, repMax: null, isAmrap: false } })
  })

  it('writes nothing when this week no longer has the exercise; the decision is left', () => {
    const week2 = thisWeek(thisWeekSets().filter((s) => s.programExerciseId === 'pe-1'), [exercises[0]])
    const item = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), extra()], { thisWeek: week2 }), 'added_set')
    expect(item.target.programExerciseId).toBeNull()
    expect(applyReviewAction(item, 'add_set', week2, counter())).toMatchObject({ writes: [], decision: { decision: 'used' } })
  })
})

describe('USE on a type item: this week\'s matching set takes the kind and the number of drops', () => {
  const planned = (): WeekPlan => weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
  const retypedItem = (last: WeekPlan, week2: WeekPlan, logs: SetLog[], changes: SessionSetChange[] = []) =>
    first<ReviewRetypedItem>(itemsFor(logs, { last, thisWeek: week2, changes }), 'retyped')
  const head = (over: Partial<SetLog> = {}) => setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', ...over })
  const done = (n: number) => [head({ stageKind: 'dropset' }), ...Array.from({ length: n }, (_, i) => dropLog(`lg-d${i + 1}`, 's1', 'ex-1', 'lg-1', i + 1))]
  const rest = [setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', setNumber: 2 })]

  it('a plain set made a dropset: the head takes the kind and the drops are inserted under it, in order', () => {
    const last = planned()
    const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1), wset('ts-2', 'pe-1', 2)])
    const item = retypedItem(last, week2, [...done(2), ...rest])
    const writes = applyReviewAction(item, 'use', week2, counter()).writes
    expect(writes).toHaveLength(3)
    expect(writes[0]).toEqual({ kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { stageKind: 'dropset' } })
    expect(writes.slice(1).map((w) => (w.kind === 'insert_set' ? [w.set.parentWeekPlanSetId, w.set.stageIndex, w.set.setNumber, w.set.isDropset] : null))).toEqual([
      ['ts-1', 1, 1, true],
      ['ts-1', 2, 1, true],
    ])
  })

  it('more drops than this week has: only the missing ones are inserted, after the last; the kind it has is not rewritten', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
    const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ts-s1', 'ts-1', 'pe-1', 1), wset('ts-2', 'pe-1', 2)])
    const item = retypedItem(last, week2, [...done(3), ...rest])
    expect(item.doneType).toMatchObject({ stageCount: 3 })
    const writes = applyReviewAction(item, 'use', week2, counter()).writes
    expect(writes.map((w) => (w.kind === 'insert_set' ? w.set.stageIndex : w.kind))).toEqual([2, 3])
  })

  it('a dropset made a warmup (or plain): the kind changes and the stage rows are deleted, the highest first', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
    const week2 = weekPlan('a', 2, [exercises[0]], [
      wset('ts-1', 'pe-1', 1, { stageKind: 'dropset' }),
      stage('ts-s1', 'ts-1', 'pe-1', 1),
      stage('ts-s2', 'ts-1', 'pe-1', 2),
      stage('ts-s3', 'ts-1', 'pe-1', 3),
      wset('ts-2', 'pe-1', 2),
    ])
    const asWarmup = [head({ isWarmup: true }), ...rest]
    const item = retypedItem(last, week2, asWarmup)
    // the rows arrive in any order; the highest drop still goes first
    const scrambled = { ...week2, sets: [...week2.sets].sort((a, b) => b.id.localeCompare(a.id)).sort((a, b) => (a.id === 'ts-s2' ? -1 : b.id === 'ts-s2' ? 1 : 0)) }
    expect(scrambled.sets.map((x) => x.id).join()).not.toBe(week2.sets.map((x) => x.id).join())
    const writes = applyReviewAction(item, 'use', scrambled, counter()).writes
    expect(writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { isWarmup: true, stageKind: null } },
      { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s3' },
      { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s2' },
      { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s1' },
    ])
  })

  it('a dropset switched back to Normal (its log gave up the kind, no drop logged): the kind is cleared and the stage rows are deleted, the highest first', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
    const week2 = weekPlan('a', 2, [exercises[0]], [
      wset('ts-1', 'pe-1', 1, { stageKind: 'dropset' }),
      stage('ts-s1', 'ts-1', 'pe-1', 1),
      stage('ts-s2', 'ts-1', 'pe-1', 2),
      wset('ts-2', 'pe-1', 2),
    ])
    const item = retypedItem(last, week2, [head({ stageKind: null }), ...rest])
    expect(item.doneType).toEqual({ kind: 'normal' })
    const result = applyReviewAction(item, 'use', week2, counter())
    expect(result.writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { stageKind: null } },
      { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s2' },
      { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s1' },
    ])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'type:s1:ps-1', decision: 'used' })
    // this week's plan after those writes: the set is a plain one with no stage rows, and the set after it is as it was
    expect(applyWrites(week2, result.writes).sets.map((s) => [s.id, s.stageKind ?? null, s.parentWeekPlanSetId])).toEqual([
      ['ts-1', null, null],
      ['ts-2', null, null],
    ])
  })

  it('a warmup made normal clears the warmup flag and nothing else', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { isWarmup: true, targetRir: null }), wset('ps-2', 'pe-1', 2)])
    const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { isWarmup: true, targetRir: null }), wset('ts-2', 'pe-1', 2)])
    const item = retypedItem(last, week2, [head({ isWarmup: false }), ...rest])
    expect(applyReviewAction(item, 'use', week2, counter()).writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { isWarmup: false } },
    ])
  })

  it('one stage kind changed for another keeps the drops it has and rewrites the kind', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
    const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ts-s1', 'ts-1', 'pe-1', 1), wset('ts-2', 'pe-1', 2)])
    const item = retypedItem(last, week2, [head({ stageKind: 'rest_pause' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1), ...rest])
    expect(applyReviewAction(item, 'use', week2, counter()).writes).toEqual([
      { kind: 'update_set', weekPlanId: 'wp-a-2', setId: 'ts-1', changes: { stageKind: 'rest_pause' } },
    ])
  })

  it('a head with no stage kind (before 1.1) that has stages already is a dropset: no kind is written for it', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
    const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { stageKind: null }), stage('ts-s1', 'ts-1', 'pe-1', 1), wset('ts-2', 'pe-1', 2)])
    const item = retypedItem(last, week2, [...done(1), ...rest])
    expect(applyReviewAction(item, 'use', week2, counter()).writes).toEqual([])
  })

  it('writes nothing when this week has no matching set; the decision is left', () => {
    const last = planned()
    const week2 = weekPlan('a', 2, [exercises[0]], [])
    const item = retypedItem(last, week2, [...done(1), ...rest])
    expect(item.target.setId).toBeNull()
    expect(applyReviewAction(item, 'use', week2, counter())).toMatchObject({ writes: [], decision: { decision: 'used' } })
  })

  // DECISIONS 141 (a): "USE writes the stage count set in the workout": the drops done when some were, else the
  // retyped row's count, else the head's pending-stages row, else 1. Each fixture's change row and log differ.
  describe('DECISIONS 141: the kind and the stage count set in the workout', () => {
    const dropsetOf = (prefix: 'ps' | 'ts', drops: number, set2 = prefix + '-2') => [
      wset(`${prefix}-1`, 'pe-1', 1, { stageKind: 'dropset' }),
      ...Array.from({ length: drops }, (_, i) => stage(`${prefix}-s${i + 1}`, `${prefix}-1`, 'pe-1', i + 1)),
      wset(set2, 'pe-1', 2),
    ]
    const toRestPause = (count: number): SessionSetChange => ({ kind: 'retyped', weekPlanSetId: 'ps-1', type: { kind: 'staged', stageKind: 'rest_pause', stageCount: count } })
    const shape = (writes: ReviewWrite[]) =>
      writes.map((w) =>
        w.kind === 'update_set' ? ['update', w.setId, w.changes] : w.kind === 'insert_set' ? ['insert', w.set.parentWeekPlanSetId, w.set.stageIndex, w.set.stageKind] : w.kind === 'delete_set' ? ['delete', w.setId] : [w.kind],
      )

    it('a dropset made rest-pause with none done: this week\'s set takes the kind and the retyped row\'s count, inserted in order', () => {
      const last = weekPlan('a', 1, [exercises[0]], dropsetOf('ps', 1))
      const week2 = weekPlan('a', 2, [exercises[0]], dropsetOf('ts', 1))
      const item = retypedItem(last, week2, [head({ stageKind: 'rest_pause' }), ...rest], [toRestPause(3)])
      expect(item.doneType).toEqual({ kind: 'staged', stageKind: 'rest_pause', stageCount: 3 })
      const result = applyReviewAction(item, 'use', week2, counter())
      expect(shape(result.writes)).toEqual([
        ['update', 'ts-1', { stageKind: 'rest_pause' }],
        ['insert', 'ts-1', 2, null],
        ['insert', 'ts-1', 3, null],
      ])
      expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'type:s1:ps-1', decision: 'used' })
      const after = applyWrites(week2, result.writes)
      expect(after.sets.filter((x) => x.parentWeekPlanSetId === 'ts-1').map((x) => x.stageIndex)).toEqual([1, 2, 3])
      expect(after.sets.find((x) => x.id === 'ts-1')).toMatchObject({ stageKind: 'rest_pause' })
    })

    it('the count comes from the change row, then the head\'s pending-stages row, then 1; this week\'s own stage count is neither', () => {
      const last = weekPlan('a', 1, [exercises[0]], dropsetOf('ps', 1))
      const week2 = weekPlan('a', 2, [exercises[0]], dropsetOf('ts', 3)) // this week's set has three drops already
      const writes = (changes: SessionSetChange[]) => shape(applyReviewAction(retypedItem(last, week2, [head({ stageKind: 'rest_pause' }), ...rest], changes), 'use', week2, counter()).writes)
      // no row: one drop, so the two extra ones go, highest first
      expect(writes([])).toEqual([['update', 'ts-1', { stageKind: 'rest_pause' }], ['delete', 'ts-s3'], ['delete', 'ts-s2']])
      // the head's pending-stages row: two
      expect(writes([{ kind: 'pending_stages', setLogId: 'lg-1', stageKind: 'rest_pause', stageCount: 2 }])).toEqual([['update', 'ts-1', { stageKind: 'rest_pause' }], ['delete', 'ts-s3']])
      // the retyped row: four, the pending-stages row's two not taken
      expect(writes([{ kind: 'pending_stages', setLogId: 'lg-1', stageKind: 'rest_pause', stageCount: 2 }, toRestPause(4)])).toEqual([
        ['update', 'ts-1', { stageKind: 'rest_pause' }],
        ['insert', 'ts-1', 4, null],
      ])
    })

    it('a plain set made a dropset with none done: the kind and one drop with nothing recorded, the pending count with a row; the drops done when some were', () => {
      const last = planned()
      const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1), wset('ts-2', 'pe-1', 2)])
      const writes = (logs: SetLog[], changes: SessionSetChange[]) => shape(applyReviewAction(retypedItem(last, week2, logs, changes), 'use', week2, counter()).writes)
      const kindOnly = [head({ stageKind: 'dropset' }), ...rest]
      expect(writes(kindOnly, [])).toEqual([['update', 'ts-1', { stageKind: 'dropset' }], ['insert', 'ts-1', 1, null]])
      expect(writes(kindOnly, [{ kind: 'pending_stages', setLogId: 'lg-1', stageKind: 'dropset', stageCount: 2 }])).toEqual([
        ['update', 'ts-1', { stageKind: 'dropset' }],
        ['insert', 'ts-1', 1, null],
        ['insert', 'ts-1', 2, null],
      ])
      // one drop done of the three the retyped row sets: one
      const oneDone = [...done(1), ...rest]
      const three: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'ps-1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 3 } }
      expect(writes(oneDone, [three])).toEqual([['update', 'ts-1', { stageKind: 'dropset' }], ['insert', 'ts-1', 1, null]])
    })

    it('a kindless dropset switched to Normal: this week\'s stage rows go, highest first, and no kind is written where the head has none to clear', () => {
      const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { stageKind: null }), stage('ps-s1', 'ps-1', 'pe-1', 1), wset('ps-2', 'pe-1', 2)])
      const kindless = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { stageKind: null }), stage('ts-s1', 'ts-1', 'pe-1', 1), stage('ts-s2', 'ts-1', 'pe-1', 2), wset('ts-2', 'pe-1', 2)])
      const toNormal: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'ps-1', type: { kind: 'normal' } }
      const item = retypedItem(last, kindless, [head({ stageKind: null }), ...rest], [toNormal])
      expect(item).toMatchObject({ plannedType: { kind: 'staged', stageKind: 'dropset', stageCount: 1 }, doneType: { kind: 'normal' } })
      const result = applyReviewAction(item, 'use', kindless, counter())
      expect(result.writes).toEqual([
        { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s2' },
        { kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-s1' },
      ])
      expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'type:s1:ps-1', decision: 'used' })
      expect(applyWrites(kindless, result.writes).sets.map((x) => [x.id, x.stageKind ?? null, x.parentWeekPlanSetId])).toEqual([
        ['ts-1', null, null],
        ['ts-2', null, null],
      ])
      // this week's head DOES carry a kind: that one is cleared, and only that
      const kinded = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ts-s1', 'ts-1', 'pe-1', 1), wset('ts-2', 'pe-1', 2)])
      const itemKinded = retypedItem(last, kinded, [head({ stageKind: null }), ...rest], [toNormal])
      expect(shape(applyReviewAction(itemKinded, 'use', kinded, counter()).writes)).toEqual([['update', 'ts-1', { stageKind: null }], ['delete', 'ts-s1']])
    })
  })

  // DECISIONS 150, option (b), which Adam chose (2026-10-15): "Its USE gives this week's matching set that type, and "Skipped" keeps
  // its own REMOVE THIS SET." The type item of a set then skipped or never logged is applied like any other type item (the kind
  // and the count set in the workout, into THIS week's set at the same planned position); the fixtures are built through
  // `reviewItems`, so the item is the one the module lists for such a set, and this week's set ids differ from last week's.
  describe('DECISIONS 150 (b): USE on the type item of a set then skipped or never logged, beside its own REMOVE THIS SET', () => {
    const numbers = { targetWeight: 60, repMin: 10, repMax: 12 }
    const noNumbers = { targetWeight: null, repMin: null, repMax: null, isAmrap: false, targetRir: null }
    const lastOf = (over: Partial<WeekPlanSet> = {}) => weekPlan('a', 1, [exercises[0]], [1, 2, 3].map((n) => wset(`ps-${n}`, 'pe-1', n, over)))
    const weekTwoOf = (over: Partial<WeekPlanSet> = {}) => weekPlan('a', 2, [exercises[0]], [1, 2, 3].map((n) => wset(`ts-${n}`, 'pe-1', n, over)))
    const skippedLog = (n: number) => setLog(`lg-${n}`, 's1', 'ex-1', { weekPlanSetId: `ps-${n}`, setNumber: n, isSkipped: true, weight: null, reps: null, rir: null })
    const doneLog = (n: number) => setLog(`lg-${n}`, 's1', 'ex-1', { weekPlanSetId: `ps-${n}`, setNumber: n, weight: 60, reps: 10 })
    const retypedTo = (n: number, type: SessionSetChangeType): SessionSetChange => ({ kind: 'retyped', weekPlanSetId: `ps-${n}`, type })
    const dropsetOf = (stageCount: number): SessionSetChangeType => ({ kind: 'staged', stageKind: 'dropset', stageCount })
    const shapeOf = (writes: ReviewWrite[]) =>
      writes.map((w) => (w.kind === 'update_set' ? ['update', w.setId, w.changes] : w.kind === 'insert_set' ? ['insert', w.set.parentWeekPlanSetId, w.set.stageIndex] : w.kind === 'delete_set' ? ['delete', w.setId] : [w.kind]))
    // set 1: retyped, then skipped; set 2: done as planned; set 3: retyped, never logged
    const scenario = (over: Partial<WeekPlanSet> = {}) => {
      const last = lastOf(over)
      const week2 = weekTwoOf(over)
      const found = itemsFor([skippedLog(1), doneLog(2)], { last, thisWeek: week2, changes: [retypedTo(1, dropsetOf(2)), retypedTo(3, { kind: 'warmup' })] })
      return { week2, found }
    }

    it('the module lists each set\'s two items, and USE on the type item gives this week\'s matching set the kind and the row\'s count', () => {
      const { week2, found } = scenario(numbers)
      expect(found.map((i) => `${i.kind}:${'plannedSetId' in i ? i.plannedSetId : '-'}`)).toEqual(['skipped:ps-1', 'retyped:ps-1', 'skipped:ps-3', 'retyped:ps-3'])
      const type1 = first<ReviewRetypedItem>(found, 'retyped')
      const result = applyReviewAction(type1, 'use', week2, counter())
      // this week's set 1 (ts-1, not last week's ps-1): the kind, then the two drops under it, in order
      expect(shapeOf(result.writes)).toEqual([['update', 'ts-1', { stageKind: 'dropset' }], ['insert', 'ts-1', 1], ['insert', 'ts-1', 2]])
      expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'type:s1:ps-1', decision: 'used' })
      const after = applyWrites(week2, result.writes)
      expect(after.sets.find((s) => s.id === 'ts-1')).toMatchObject({ stageKind: 'dropset' })
      expect(after.sets.filter((s) => s.parentWeekPlanSetId === 'ts-1').map((s) => s.stageIndex)).toEqual([1, 2])
      expect(after.sets.filter((s) => s.id !== 'ts-1' && s.parentWeekPlanSetId === null)).toEqual(week2.sets.filter((s) => s.id !== 'ts-1')) // the other sets as they were
    })

    it('a set retyped to Warmup and never logged: USE makes this week\'s matching set a warmup and writes nothing else', () => {
      const { week2, found } = scenario(numbers)
      const type3 = found.filter((i): i is ReviewRetypedItem => i.kind === 'retyped')[1]
      expect(type3.plannedSetId).toBe('ps-3')
      expect(shapeOf(applyReviewAction(type3, 'use', week2, counter()).writes)).toEqual([['update', 'ts-3', { isWarmup: true }]])
    })

    it('with no numbers planned there is no "Skipped" item and USE on the type item writes the same', () => {
      const { week2, found } = scenario(noNumbers)
      expect(found.map((i) => `${i.kind}:${'plannedSetId' in i ? i.plannedSetId : '-'}`)).toEqual(['retyped:ps-1', 'retyped:ps-3'])
      const writes = applyReviewAction(first<ReviewRetypedItem>(found, 'retyped'), 'use', week2, counter()).writes
      expect(shapeOf(writes)).toEqual([['update', 'ts-1', { stageKind: 'dropset' }], ['insert', 'ts-1', 1], ['insert', 'ts-1', 2]])
    })

    it('REMOVE THIS SET on the "Skipped" item and USE on the type item are each their own: either order, the removed set takes its drops with it', () => {
      const { week2, found } = scenario(numbers)
      const skipped1 = first<ReviewSkippedItem>(found, 'skipped')
      const type1 = first<ReviewRetypedItem>(found, 'retyped')
      expect([itemKey(skipped1), itemKey(type1)]).toEqual(['skipped:s1:ps-1', 'type:s1:ps-1'])
      // USE first, then REMOVE: the set and the drops USE inserted under it are gone
      const used = applyWrites(week2, applyReviewAction(type1, 'use', week2, counter()).writes)
      const removeAfter = applyReviewAction(skipped1, 'remove_set', used, counter())
      expect(shapeOf(removeAfter.writes)).toEqual([['delete', 'ts-1']])
      expect(removeAfter.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'skipped:s1:ps-1', decision: 'used' })
      expect(applyWrites(used, removeAfter.writes).sets.map((s) => s.id)).toEqual(['ts-2', 'ts-3'])
      // REMOVE first, then USE: this week no longer has the set, so USE writes nothing and still leaves its decision
      const removed = applyWrites(week2, applyReviewAction(skipped1, 'remove_set', week2, counter()).writes)
      expect(applyReviewAction(type1, 'use', removed, counter())).toEqual({ decision: { weekPlanId: 'wp-a-2', itemKey: 'type:s1:ps-1', decision: 'used' }, writes: [] })
    })

    it('IGNORE on the type item leaves an `ignored` decision under its own key and writes nothing', () => {
      const { week2, found } = scenario(numbers)
      expect(applyReviewAction(first<ReviewRetypedItem>(found, 'retyped'), 'ignore', week2, counter())).toEqual({
        decision: { weekPlanId: 'wp-a-2', itemKey: 'type:s1:ps-1', decision: 'ignored' },
        writes: [],
      })
    })

    it('the count is the row\'s, whatever drops this week\'s sets have', () => {
      // the workout set three pauses on set 1 and two drops on set 3; this week's set 1 has one drop already, and set 3 has none
      const last = lastOf(numbers)
      const week2 = weekPlan('a', 2, [exercises[0]], [
        wset('ts-1', 'pe-1', 1, { ...numbers, stageKind: 'dropset' }),
        stage('ts-s1', 'ts-1', 'pe-1', 1),
        wset('ts-2', 'pe-1', 2, numbers),
        wset('ts-3', 'pe-1', 3, numbers),
      ])
      const retypedItems = (type: SessionSetChangeType) =>
        itemsFor([skippedLog(1), doneLog(2)], { last, thisWeek: week2, changes: [retypedTo(1, type)] }).filter((i): i is ReviewRetypedItem => i.kind === 'retyped')
      // dropset ×1 → rest-pause ×3: the kind, then the missing two drops after the one it has
      const toRestPause = retypedItems({ kind: 'staged', stageKind: 'rest_pause', stageCount: 3 })
      expect(toRestPause).toHaveLength(1)
      expect(shapeOf(applyReviewAction(toRestPause[0], 'use', week2, counter()).writes)).toEqual([['update', 'ts-1', { stageKind: 'rest_pause' }], ['insert', 'ts-1', 2], ['insert', 'ts-1', 3]])
      // a plain set 3 never logged, made a dropset ×2: two drops, this week's set 1 having one makes no difference
      const itemsThree = itemsFor([skippedLog(1), doneLog(2)], { last, thisWeek: week2, changes: [retypedTo(3, dropsetOf(2))] }).filter((i): i is ReviewRetypedItem => i.kind === 'retyped')
      expect(itemsThree).toHaveLength(1)
      expect(shapeOf(applyReviewAction(itemsThree[0], 'use', week2, counter()).writes)).toEqual([['update', 'ts-3', { stageKind: 'dropset' }], ['insert', 'ts-3', 1], ['insert', 'ts-3', 2]])
    })
  })
})

describe('REMOVE THIS SET: this week\'s matching set is deleted', () => {
  it('deletes this week\'s set at the same planned position, not last week\'s row', () => {
    const logs = asPlanned().map((l) => (l.id === 'lg-r2' ? { ...l, isSkipped: true, weight: null, reps: null } : l))
    const item = first<ReviewSkippedItem>(itemsFor(logs), 'skipped')
    expect(item.plannedSetId).toBe('ps-r2')
    const result = applyReviewAction(item, 'remove_set', thisWeek(), counter())
    expect(result.writes).toEqual([{ kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-r2' }])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'skipped:s1:ps-r2', decision: 'used' })
  })

  it('"Not logged" is removed the same way; a head\'s drops go with it (one delete, the head)', () => {
    const last = weekPlan('a', 1, [exercises[0]], [wset('ps-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ps-s1', 'ps-1', 'pe-1', 1)])
    const week2 = weekPlan('a', 2, [exercises[0]], [wset('ts-1', 'pe-1', 1, { stageKind: 'dropset' }), stage('ts-s1', 'ts-1', 'pe-1', 1)])
    const item = first<ReviewSkippedItem>(itemsFor([], { last, thisWeek: week2 }), 'skipped')
    expect(item.reason).toBe('not_logged')
    expect(applyReviewAction(item, 'remove_set', week2, counter()).writes).toEqual([{ kind: 'delete_set', weekPlanId: 'wp-a-2', setId: 'ts-1' }])
  })

  it('there is nothing to remove when this week has fewer sets; the decision is left', () => {
    const logs = asPlanned().map((l) => (l.id === 'lg-r2' ? { ...l, isSkipped: true, weight: null, reps: null } : l))
    const week2 = thisWeek(thisWeekSets().filter((s) => s.id !== 'ts-r2'))
    const item = first<ReviewSkippedItem>(itemsFor(logs, { thisWeek: week2 }), 'skipped')
    expect(applyReviewAction(item, 'remove_set', week2, counter())).toMatchObject({ writes: [], decision: { decision: 'used' } })
  })
})

describe('ADD EXERCISE and SWAP FROM WEEK N: CHANGE THE PROGRAM changes, from this week on', () => {
  const fly = (n: number, at: string, over: Partial<SetLog> = {}) => setLog(`lg-fly-${n}`, 's1', 'ex-fly', { setNumber: n, weight: 20, reps: 12, loggedAt: at, ...over })

  it('ADD EXERCISE describes the exercise, where it goes (after the one it followed, this week\'s row) and the sets as done', () => {
    const logs = [...asPlanned(), fly(1, '2026-10-05T18:22:00.000Z'), fly(2, '2026-10-05T18:24:00.000Z', { weight: 25, reps: 10 })]
    const item = first<ReviewAddedExerciseItem>(itemsFor(logs), 'added_exercise')
    const result = applyReviewAction(item, 'add_exercise', thisWeek(), counter())
    expect(result.writes).toEqual([
      {
        kind: 'program_edit',
        edit: {
          type: 'add_exercise',
          exerciseId: 'ex-fly',
          afterProgramExerciseId: 'pe-2', // the row exercise was the last planned one logged before it
          sets: [
            { weight: 20, reps: 12, rir: 2, type: { kind: 'normal' } },
            { weight: 25, reps: 10, rir: 2, type: { kind: 'normal' } },
          ],
        },
      },
    ])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'added-ex:s1:ex-fly', decision: 'used' })
  })

  it('ADD EXERCISE for an exercise done before anything planned goes first: after nothing', () => {
    const first1 = setLog('lg-fly', 's1', 'ex-fly', { loggedAt: '2026-10-05T17:00:00.000Z', weight: 20, reps: 12 })
    const item = first<ReviewAddedExerciseItem>(itemsFor([...asPlanned(), first1]), 'added_exercise')
    const [write] = applyReviewAction(item, 'add_exercise', thisWeek(), counter()).writes
    expect(write).toMatchObject({ kind: 'program_edit', edit: { type: 'add_exercise', afterProgramExerciseId: null } })
  })

  it('SWAP FROM WEEK N names this week\'s slot row and both exercises', () => {
    const logs = [...asPlanned().filter((l) => l.exerciseId !== 'ex-2'), setLog('lg-m', 's1', 'ex-md', { setNumber: 1, loggedAt: '2026-10-05T18:21:00.000Z' })]
    const swaps = [swapRecord({ programExerciseId: 'pe-2', originalExerciseId: 'ex-2', originalExerciseName: 'Row', replacementExerciseId: 'ex-md', replacementExerciseName: 'Machine Row' })]
    const item = first<ReviewSwappedItem>(itemsFor(logs, { swaps }), 'swapped')
    const result = applyReviewAction(item, 'swap', thisWeek(), counter())
    expect(result.writes).toEqual([
      { kind: 'program_edit', edit: { type: 'swap_exercise', programExerciseId: 'pe-2', fromExerciseId: 'ex-2', toExerciseId: 'ex-md' } },
    ])
    expect(result.decision).toEqual({ weekPlanId: 'wp-a-2', itemKey: 'swap:s1:pe-2', decision: 'used' })
  })

  it('a slot whose exercise was changed in between maps to the row that exercise has this week', () => {
    // this week's bench is on another program exercise row (a swap landed there): the pairing is by exercise
    const swappedRow = row('pe-swapped', 'ex-1', 1, 'Bench Press')
    const week2 = thisWeek(thisWeekSets().map((s) => (s.programExerciseId === 'pe-1' ? { ...s, programExerciseId: 'pe-swapped' } : s)), [swappedRow, exercises[1]])
    const logs = [...asPlanned().filter((l) => l.exerciseId !== 'ex-2'), setLog('lg-m', 's1', 'ex-md', { setNumber: 1 })]
    const swaps = [swapRecord({ programExerciseId: 'pe-1', originalExerciseId: 'ex-1', replacementExerciseId: 'ex-md' })]
    const item = first<ReviewSwappedItem>(itemsFor(logs, { swaps, thisWeek: week2 }), 'swapped')
    const [write] = applyReviewAction(item, 'swap', week2, counter()).writes
    expect(write).toMatchObject({ edit: { programExerciseId: 'pe-swapped' } })
  })

  it('a swap of a slot this week no longer has writes nothing; the decision is left', () => {
    const week2 = thisWeek(thisWeekSets().filter((s) => s.programExerciseId === 'pe-1'), [exercises[0]])
    const logs = [...asPlanned().filter((l) => l.exerciseId !== 'ex-2'), setLog('lg-m', 's1', 'ex-md', { setNumber: 1 })]
    const swaps = [swapRecord({ programExerciseId: 'pe-2', originalExerciseId: 'ex-2', replacementExerciseId: 'ex-md' })]
    const item = first<ReviewSwappedItem>(itemsFor(logs, { swaps, thisWeek: week2 }), 'swapped')
    expect(item.target.programExerciseId).toBeNull()
    expect(applyReviewAction(item, 'swap', week2, counter())).toMatchObject({ writes: [], decision: { decision: 'used' } })
  })
})

describe('an item applied to a plan that has moved on since it was listed', () => {
  // The item was listed against this week's plan as it was; by the time the button is pressed another device
  // or another action has changed the plan. Nothing is written for a set or exercise the plan no longer has.
  const without = (ids: string[], exs = exercises): WeekPlan => thisWeek(thisWeekSets().filter((s) => !ids.includes(s.id) && !ids.includes(s.parentWeekPlanSetId ?? '')), exs)

  it('USE (number): this week\'s matching set is gone but the exercise is not: it becomes ADD THIS SET', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-2', { weight: 90, reps: 6 })), 'number')
    expect(item.target.setId).toBe('ts-2')
    const writes = applyReviewAction(item, 'use', without(['ts-2']), counter()).writes
    expect(writes.map((w) => w.kind)).toEqual(['insert_set'])
    // this week's bench now ends at set number 5 (ts-3): the new set is 6
    expect(writes[0]).toMatchObject({ set: { programExerciseId: 'pe-1', setNumber: 6, targetWeight: 90, repMin: 6 } })
  })

  it('USE (type), REMOVE THIS SET: nothing is written for a set the plan no longer has', () => {
    const logs = [...withLog('lg-1', { stageKind: 'dropset' }), dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1)]
    const typed = first<ReviewRetypedItem>(itemsFor(logs), 'retyped')
    expect(applyReviewAction(typed, 'use', without([typed.target.setId!]), counter()).writes).toEqual([])
    const skippedLogs = asPlanned().map((l) => (l.id === 'lg-r2' ? { ...l, isSkipped: true, weight: null, reps: null } : l))
    const skipped = first<ReviewSkippedItem>(itemsFor(skippedLogs), 'skipped')
    expect(applyReviewAction(skipped, 'remove_set', without([skipped.target.setId!]), counter()).writes).toEqual([])
  })

  it('ADD THIS SET and a number\'s ADD: nothing when the exercise is gone from the plan', () => {
    const extra = setLog('lg-x', 's1', 'ex-2', { setNumber: 3, loggedAt: '2026-10-05T18:30:00.000Z' })
    const added = first<ReviewAddedSetItem>(itemsFor([...asPlanned(), extra]), 'added_set')
    expect(added.target.programExerciseId).toBe('pe-2')
    const noRow = thisWeek(thisWeekSets().filter((s) => s.programExerciseId === 'pe-1'), [exercises[0]])
    expect(applyReviewAction(added, 'add_set', noRow, counter()).writes).toEqual([])
  })

  it('SWAP: nothing when the slot is gone from the plan', () => {
    const logs = [...asPlanned().filter((l) => l.exerciseId !== 'ex-2'), setLog('lg-m', 's1', 'ex-md', { setNumber: 1 })]
    const swaps = [swapRecord({ programExerciseId: 'pe-2', originalExerciseId: 'ex-2', replacementExerciseId: 'ex-md' })]
    const item = first<ReviewSwappedItem>(itemsFor(logs, { swaps }), 'swapped')
    expect(item.target.programExerciseId).toBe('pe-2') // it was there when listed
    expect(applyReviewAction(item, 'swap', thisWeek(thisWeekSets().filter((s) => s.programExerciseId === 'pe-1'), [exercises[0]]), counter()).writes).toEqual([])
  })
})

describe('IGNORE and the decision row', () => {
  // One completed Upper A with one item of every kind: bench set 1 made a dropset (type), set 2 at another
  // weight (number), set 3 skipped, a bench set nobody planned (added set), the row swapped for a machine row
  // (swap), a cable fly nobody planned (added exercise).
  const everyKind = (): ReviewItem[] => {
    const logs: SetLog[] = [
      setLog('lg-w', 's1', 'ex-1', { weekPlanSetId: 'ps-w', isWarmup: true, weight: 40, reps: 10, rir: null, loggedAt: '2026-10-05T18:00:00.000Z' }),
      setLog('lg-1', 's1', 'ex-1', { weekPlanSetId: 'ps-1', setNumber: 1, weight: 80, reps: 8, stageKind: 'dropset', loggedAt: '2026-10-05T18:05:00.000Z' }),
      dropLog('lg-d1', 's1', 'ex-1', 'lg-1', 1, { loggedAt: '2026-10-05T18:06:00.000Z' }),
      setLog('lg-2', 's1', 'ex-1', { weekPlanSetId: 'ps-2', setNumber: 2, weight: 82.5, reps: 7, loggedAt: '2026-10-05T18:10:00.000Z' }),
      setLog('lg-3', 's1', 'ex-1', { weekPlanSetId: 'ps-3', setNumber: 3, isSkipped: true, weight: null, reps: null, loggedAt: '2026-10-05T18:15:00.000Z' }),
      setLog('lg-x', 's1', 'ex-1', { setNumber: 4, weight: 70, reps: 10, loggedAt: '2026-10-05T18:17:00.000Z' }),
      setLog('lg-md', 's1', 'ex-md', { setNumber: 1, loggedAt: '2026-10-05T18:20:00.000Z' }),
      setLog('lg-fly', 's1', 'ex-fly', { setNumber: 1, loggedAt: '2026-10-05T18:30:00.000Z' }),
    ]
    const swaps = [swapRecord({ programExerciseId: 'pe-2', originalExerciseId: 'ex-2', replacementExerciseId: 'ex-md' })]
    return itemsFor(logs, { swaps })
  }

  it('every kind of item is in the fixture (so the next tests cover each)', () => {
    expect(new Set(everyKind().map((i) => i.kind))).toEqual(new Set(['number', 'skipped', 'retyped', 'added_set', 'added_exercise', 'swapped']))
  })

  it('IGNORE writes nothing and leaves an `ignored` decision on this week\'s row under the item\'s key, whatever the kind', () => {
    for (const item of everyKind()) {
      const result = applyReviewAction(item, 'ignore', thisWeek(), counter())
      expect(result.writes, item.kind).toEqual([])
      expect(result.decision, item.kind).toEqual({ weekPlanId: 'wp-a-2', itemKey: itemKey(item), decision: 'ignored' })
    }
  })

  it('the item\'s own action leaves a `used` decision under the same key, whatever the kind', () => {
    for (const item of everyKind()) {
      const result = applyReviewAction(item, primaryAction(item), thisWeek(), counter())
      expect(result.decision, item.kind).toEqual({ weekPlanId: 'wp-a-2', itemKey: itemKey(item), decision: 'used' })
    }
  })

  it('an action that is not the item\'s own throws, each kind against every other action', () => {
    const actions: ReviewAction[] = ['use', 'add_set', 'remove_set', 'add_exercise', 'swap']
    for (const item of everyKind()) {
      for (const action of actions.filter((a) => a !== primaryAction(item))) {
        expect(() => applyReviewAction(item, action, thisWeek(), counter()), `${item.kind} / ${action}`).toThrow(/is not an action of a/)
      }
    }
  })

  it('an item is only applied to the plan row it belongs to', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-2', { weight: 90 })), 'number')
    const other = weekPlan('a', 2, exercises, thisWeekSets(), { id: 'wp-other' })
    expect(() => applyReviewAction(item, 'use', other, counter())).toThrow(/belongs to plan row wp-a-2/)
    expect(() => applyReviewAction(item, 'ignore', other, counter())).toThrow(/belongs to plan row wp-a-2/)
  })

  it('new rows get their ids from the generator, one each; without one they get distinct ids of their own', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-3', { weight: 90 }), { thisWeek: thisWeek(thisWeekSets().filter((s) => s.id !== 'ts-3')) }), 'number')
    const week2 = thisWeek(thisWeekSets().filter((s) => s.id !== 'ts-3'))
    const ids = (writes: ReviewWrite[]) => writes.flatMap((w) => (w.kind === 'insert_set' ? [w.set.id] : []))
    expect(ids(applyReviewAction(item, 'use', week2, counter()).writes)).toEqual(['new-1'])
    const a = ids(applyReviewAction(item, 'use', week2).writes)
    const b = ids(applyReviewAction(item, 'use', week2).writes)
    expect(a[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(a[0]).not.toBe(b[0])
  })

  it('a deep-frozen plan is read, never changed', () => {
    const item = first<ReviewNumberItem>(itemsFor(withLog('lg-2', { weight: 90 })), 'number')
    const frozen = deepFreeze(thisWeek())
    expect(applyReviewAction(deepFreeze(item), 'use', frozen, counter()).writes).toHaveLength(1)
  })
})
