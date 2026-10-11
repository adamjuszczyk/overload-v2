import { describe, it, expect } from 'vitest'
import type { WeekPlan, ProgramExercise, WeekPlanSet } from '../../types'
import {
  planApplyAhead,
  planApplyAheadGroups,
  summarizeApplyAheadByWeek,
  type AheadGroup,
  type ChangeRecord,
  type DefaultSetShape,
  type WeekApplyResult,
} from './applyAhead'

// Chunk 32 — "Apply this change to planned weeks ahead" after "Make this week the new
// default" (SPEC Weeks and copying [P1.1]): a later planned week is updated "only where
// it still matches the old default", per part (G26). These are the records
// makeWeekDefault.ts builds (the ones carrying `defaultSet` / `defaultRow` / `relink`),
// resolved against a later week:
//   - a part is found BY ID (the set's link to the old default's program set), never by
//     position, and a value is written only where the week still holds the OLD one;
//   - what is added names the default's OWN row and program sets (an `addPointed…` op),
//     never a fresh week-only row per week (the `addExercise` op that creates one);
//   - every record is resolved on its own, so a part that diverged leaves the others alone.
// Each test names the break that would make it fail.

// ─── Fixtures ────────────────────────────────────────────────────────────────

function pe(id: string, overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return { id, workoutDayId: 'wd-1', userId: 'u', exerciseId: `ex-${id}`, position: 0, weightUnit: null, ...overrides }
}

function set(id: string, programExerciseId: string, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id, weekPlanId: 'wp-x', userId: 'u', programExerciseId, setNumber: 1, targetRir: null, isDropset: false,
    parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...overrides,
  }
}

function week(weekNumber: number, exercises: ProgramExercise[], sets: WeekPlanSet[], overrides: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'u', mesocycleId: 'm', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null,
    exercises, sets, createdAt: '', ...overrides,
  }
}

function shape(programSetId: string, programExerciseId: string, overrides: Partial<DefaultSetShape> = {}): DefaultSetShape {
  return {
    programSetId, programExerciseId, position: 1, isWarmup: false, stageKind: null, repMin: null, repMax: null, isAmrap: false,
    stageIndex: 0, stages: [], ...overrides,
  }
}

const REPS_8_10 = { repMin: 8, repMax: 10, isAmrap: false }
const REPS_6_8 = { repMin: 6, repMax: 8, isAmrap: false }

function one(change: ChangeRecord, w: WeekPlan): WeekApplyResult {
  return planApplyAhead(change, [w])[0]
}

// ─── An exercise that joined the default ─────────────────────────────────────

describe('addExercise from a make-default — pointed at the default\'s own row', () => {
  const added = {
    programExerciseId: 'pe-new',
    position: 3,
    sets: [shape('q1', 'pe-new', { position: 1, repMin: 12, repMax: 15 }), shape('q2', 'pe-new', { position: 2, stageKind: 'dropset', stages: [shape('q2s1', 'pe-new', { position: 2, stageIndex: 1, repMin: 20, repMax: 20 })] })],
  }
  const change: ChangeRecord = { editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new', defaultRow: added }

  // Break: planApplyAhead writes the `addExercise` op (addWeekExercise: a NEW week-only row per
  // week) instead of pointing at the default's row -> kind and programExerciseId differ.
  it('writes the DEFAULT\'S row (its id, its position, its sets) — not a fresh week-only row', () => {
    const w = week(3, [pe('pe-1', { position: 0 })], [])
    expect(one(change, w)).toEqual({
      weekPlanId: 'wp-3',
      weekNumber: 3,
      status: 'applied',
      ops: [{ kind: 'addPointedExercise', weekPlanId: 'wp-3', programExerciseId: 'pe-new', position: 3, sets: added.sets }],
    })
  })

  it('every week gets the SAME row id, so the next week\'s weights can be matched to last week\'s sets by that row', () => {
    const results = planApplyAhead(change, [week(3, [pe('pe-1')], []), week(4, [pe('pe-1'), pe('pe-2', { position: 1 })], [])])
    const rowIds = results.map((r) => (r.status === 'applied' ? (r.ops[0] as { programExerciseId: string }).programExerciseId : null))
    expect(rowIds).toEqual(['pe-new', 'pe-new'])
  })

  it('a week that already has the row is left alone (it would also break the unique (week, row) key)', () => {
    expect(one(change, week(3, [pe('pe-1'), pe('pe-new', { exerciseId: 'ex-new' })], []))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a week that already has the same exercise on another row (added by hand) is left alone, not given a second one', () => {
    expect(one(change, week(3, [pe('pe-1'), pe('pe-hand', { exerciseId: 'ex-new', position: 1 })], []))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a deload week is skipped, as for every edit', () => {
    expect(one(change, week(3, [pe('pe-1')], [], { isDeload: true }))).toMatchObject({ status: 'skipped', reason: 'deload' })
  })

  it('a record without defaultRow is the hand edit it always was: a fresh row appended at the week\'s own end', () => {
    const hand: ChangeRecord = { editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' }
    expect(one(hand, week(3, [pe('pe-1')], []))).toMatchObject({
      status: 'applied',
      ops: [{ kind: 'addExercise', weekPlanId: 'wp-3', workoutDayId: 'wd-1', exerciseId: 'ex-new', position: 1 }],
    })
  })
})

// ─── A swap ──────────────────────────────────────────────────────────────────

describe('swapExercise from a make-default — the sets move to the swapped-in row\'s program sets', () => {
  const change: ChangeRecord = {
    editType: 'swapExercise', slotId: 'pe-old', exerciseId: 'ex-pe-old', newExerciseId: 'ex-new', resultingProgramExerciseId: 'pe-new',
    relink: [{ from: 'a1', to: 'q1' }, { from: 'a2', to: 'q2' }, { from: 'a2s1', to: 'q2s1' }],
  }

  it('repoints the row at the default\'s swapped-in row and re-links the sets that name the old row\'s program sets, in set order', () => {
    const w = week(3, [pe('pe-old')], [
      set('s2', 'pe-old', { setNumber: 2, programSetId: 'a2' }),
      set('s1', 'pe-old', { setNumber: 1, programSetId: 'a1' }),
      set('s2-1', 'pe-old', { setNumber: 2, stageIndex: 1, parentWeekPlanSetId: 's2', programSetId: 'a2s1' }),
    ])
    expect(one(change, w)).toEqual({
      weekPlanId: 'wp-3',
      weekNumber: 3,
      status: 'applied',
      ops: [{
        kind: 'repointExercise', weekPlanId: 'wp-3', fromProgramExerciseId: 'pe-old', toProgramExerciseId: 'pe-new',
        relink: [{ weekSetId: 's1', programSetId: 'q1' }, { weekSetId: 's2', programSetId: 'q2' }, { weekSetId: 's2-1', programSetId: 'q2s1' }],
      }],
    })
  })

  it('a set with no link, and one linked to some other program set, is carried over as it is: not re-linked', () => {
    const w = week(3, [pe('pe-old')], [
      set('s1', 'pe-old', { setNumber: 1, programSetId: 'a1' }),
      set('s-hand', 'pe-old', { setNumber: 2 }),
      set('s-other', 'pe-old', { setNumber: 3, programSetId: 'zzz' }),
    ])
    const result = one(change, w)
    expect(result.status === 'applied' && (result.ops[0] as { relink: unknown }).relink).toEqual([{ weekSetId: 's1', programSetId: 'q1' }])
  })

  it('a week that already holds the swapped-in row is skipped (the unique (week, row) key)', () => {
    const w = week(3, [pe('pe-old'), pe('pe-new', { position: 1 })], [])
    expect(one(change, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a week whose row is gone, or holds a different exercise, is skipped', () => {
    expect(one(change, week(3, [pe('pe-other')], []))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(change, week(3, [pe('pe-old', { exerciseId: 'ex-different' })], []))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a hand swap has no relink: the op is exactly what it was (no relink key)', () => {
    const hand: ChangeRecord = { editType: 'swapExercise', slotId: 'pe-old', exerciseId: 'ex-pe-old', newExerciseId: 'ex-new', resultingProgramExerciseId: 'pe-new' }
    const result = one(hand, week(3, [pe('pe-old')], []))
    expect(result).toMatchObject({ status: 'applied', ops: [{ kind: 'repointExercise', fromProgramExerciseId: 'pe-old', toProgramExerciseId: 'pe-new' }] })
    expect(result.status === 'applied' && 'relink' in result.ops[0]).toBe(false)
  })
})

// ─── A week that took the swap already (R7) ──────────────────────────────────

// The usual order of events: the source week's swap was offered ahead (chunk 20) and a later week took
// it. Its row is the swapped-in row (the very row id the default keeps: a repoint names the same one) and
// its sets, moved with the swap, still name the REPLACED row's program sets. Make-default has no row to
// repoint there, but the sets must follow the default's new program sets, and the swapped slot's other
// parts must find their sets under the swapped-in row.
describe('a swap from a make-default, in a week that took the swap already', () => {
  const swap: ChangeRecord = {
    editType: 'swapExercise', slotId: 'pe-old', exerciseId: 'ex-pe-old', newExerciseId: 'ex-new', resultingProgramExerciseId: 'pe-new',
    relink: [{ from: 'a1', to: 'q1' }, { from: 'a2', to: 'q2' }, { from: 'a2s1', to: 'q2s1' }],
  }
  const swappedIn = (overrides: Partial<ProgramExercise> = {}) => pe('pe-new', { exerciseId: 'ex-new', ...overrides })
  const took = (extra: WeekPlanSet[] = [], weekNumber = 3) =>
    week(weekNumber, [swappedIn()], [
      set('s2', 'pe-new', { setNumber: 2, programSetId: 'a2', targetWeight: 90 }),
      set('s1', 'pe-new', { setNumber: 1, programSetId: 'a1', targetWeight: 100 }),
      set('s2-1', 'pe-new', { setNumber: 2, stageIndex: 1, parentWeekPlanSetId: 's2', programSetId: 'a2s1' }),
      ...extra,
    ])

  // Break: skip the week because it does not hold the replaced row (what it did before) -> this fails.
  it('re-links the sets that still name the replaced row\'s program sets to the swapped-in row\'s own, in set order: a relink op, no repoint', () => {
    expect(one(swap, took())).toEqual({
      weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
      ops: [{
        kind: 'relinkSets', weekPlanId: 'wp-3',
        links: [{ weekSetId: 's1', programSetId: 'q1' }, { weekSetId: 's2', programSetId: 'q2' }, { weekSetId: 's2-1', programSetId: 'q2s1' }],
      }],
    })
  })

  it('only the default\'s sets are re-linked: a set with no link, or linked to some other program set, stays as it is', () => {
    const w = took([set('hand', 'pe-new', { setNumber: 3 }), set('other', 'pe-new', { setNumber: 4, programSetId: 'zzz' })])
    const result = one(swap, w)
    expect(result.status === 'applied' && (result.ops[0] as { links: { weekSetId: string }[] }).links.map((l) => l.weekSetId)).toEqual(['s1', 's2', 's2-1'])
  })

  it('a week whose sets under the swapped-in row already name its own program sets has nothing to re-link: skipped, not rewritten', () => {
    const w = week(3, [swappedIn()], [set('s1', 'pe-new', { programSetId: 'q1' }), set('s2', 'pe-new', { setNumber: 2, programSetId: 'q2' })])
    expect(one(swap, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a week that holds neither the replaced nor the swapped-in row is skipped', () => {
    expect(one(swap, week(3, [pe('pe-other')], [set('s1', 'pe-other', { programSetId: 'a1' })]))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('the swapped slot\'s other parts find their sets under the swapped-in row, by the same link, and write only where the old value stands', () => {
    const rep: ChangeRecord = {
      editType: 'repTarget', slotId: 'pe-old', exerciseId: 'ex-pe-old', setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: REPS_8_10, newValue: REPS_6_8, defaultSet: { programSetId: 'a1', swappedInto: 'pe-new' },
    }
    const holds = took().sets.map((s) => (s.id === 's1' ? { ...s, repMin: 8, repMax: 10 } : s))
    expect(one(rep, { ...took(), sets: holds })).toMatchObject({ status: 'applied', ops: [{ kind: 'updateSet', setId: 's1', changes: { repMin: 6, repMax: 8, isAmrap: false } }] })
    // A week that took the swap and then changed the rep target itself keeps it, as any week does.
    const own = took().sets.map((s) => (s.id === 's1' ? { ...s, repMin: 12, repMax: 12 } : s))
    expect(one(rep, { ...took(), sets: own })).toMatchObject({ status: 'skipped', reason: 'structural' })
    // Without the swapped-in row named, the record finds no row of the old default in this week.
    expect(one({ ...rep, defaultSet: { programSetId: 'a1' } }, { ...took(), sets: holds })).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a set the default dropped is removed from the swapped-in row, by its link', () => {
    const removeSecond: ChangeRecord = { editType: 'removeHeadSet', slotId: 'pe-old', exerciseId: 'ex-pe-old', headOrdinal: 2, defaultSet: { programSetId: 'a2', swappedInto: 'pe-new' } }
    expect(one(removeSecond, took())).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet', setId: 's2' }] })
  })

  it('a set the default added belongs to the swapped-in row: added there, in a week that took the swap and in one that did not', () => {
    const addSet: ChangeRecord = { editType: 'addSet', slotId: 'pe-old', exerciseId: 'ex-pe-old', defaultSet: shape('q3', 'pe-new', { position: 3 }), oldSetIds: ['a1', 'a2'] }
    expect(one(addSet, took())).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedSet', programExerciseId: 'pe-new', set: { programSetId: 'q3' } }] })
    const holdsOld = week(3, [pe('pe-old')], [set('s1', 'pe-old', { programSetId: 'a1' }), set('s2', 'pe-old', { setNumber: 2, programSetId: 'a2' })])
    expect(one(addSet, holdsOld)).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedSet', programExerciseId: 'pe-new' }] })
  })

  it('one swap, two weeks: a week that holds the replaced row is repointed and re-linked, a week that took the swap is re-linked, each with its own sets', () => {
    const results = planApplyAheadGroups([{ workoutDayId: 'wd-1', changes: [swap] }], [
      week(3, [pe('pe-old')], [set('o1', 'pe-old', { programSetId: 'a1' })]),
      took([], 4),
    ])
    expect(results.map((r) => (r.status === 'applied' ? r.ops.map((o) => o.kind) : r.reason))).toEqual([['repointExercise'], ['relinkSets']])
  })
})

// ─── A stage the default adds under a swapped slot's head (M12) ──────────────

describe('addStage in a swapped slot — the head is found by the OLD head\'s program set', () => {
  const swap: ChangeRecord = {
    editType: 'swapExercise', slotId: 'pe-old', exerciseId: 'ex-pe-old', newExerciseId: 'ex-new', resultingProgramExerciseId: 'pe-new',
    relink: [{ from: 'a1', to: 'q1' }],
  }
  const stage = shape('q1s1', 'pe-new', { stageIndex: 1, repMin: 10, repMax: 10 })
  // (The old head was a plain working set: no stages, so its whole kind is "working".)
  const addStage: ChangeRecord = { editType: 'addStage', slotId: 'pe-old', exerciseId: 'ex-pe-old', headOrdinal: 1, headProgramSetId: 'a1', defaultSet: stage, oldSetIds: [], headKind: 'working' }
  const holdsOld = week(3, [pe('pe-old')], [set('h', 'pe-old', { programSetId: 'a1', stageKind: 'dropset' })])

  // Break: name the NEW head (q1) as the head -> the week's head (still linked to a1 until the swap's
  // re-link runs) is not found, and the stage is silently skipped: this fails.
  it('the stage is added under the week\'s head, which still names the old program set when the records are resolved', () => {
    const [result] = planApplyAheadGroups([{ workoutDayId: 'wd-1', changes: [swap, addStage] }], [holdsOld])
    expect(result).toEqual({
      weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
      ops: [
        { kind: 'repointExercise', weekPlanId: 'wp-3', fromProgramExerciseId: 'pe-old', toProgramExerciseId: 'pe-new', relink: [{ weekSetId: 'h', programSetId: 'q1' }] },
        { kind: 'addPointedStage', weekPlanId: 'wp-3', programExerciseId: 'pe-new', parentId: 'h', stageIndex: 1, set: stage },
      ],
    })
  })

  it('...and a record that names the new head instead finds nothing: the stage is not added (what the right id prevents)', () => {
    const wrong: ChangeRecord = { ...addStage, headProgramSetId: 'q1' } as ChangeRecord
    const [result] = planApplyAheadGroups([{ workoutDayId: 'wd-1', changes: [swap, wrong] }], [holdsOld])
    expect(result.status === 'applied' && result.ops.map((o) => o.kind)).toEqual(['repointExercise'])
  })

  it('in a week that took the swap already, the stage goes under the head of the swapped-in row', () => {
    const took = week(3, [pe('pe-new', { exerciseId: 'ex-new' })], [set('h', 'pe-new', { programSetId: 'a1', stageKind: 'dropset' })])
    expect(one(addStage, took)).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedStage', programExerciseId: 'pe-new', parentId: 'h' }] })
  })
})

// ─── A set that left the default ─────────────────────────────────────────────

describe('removeHeadSet / removeStage from a make-default — the set is found by its link', () => {
  const removeSecond: ChangeRecord = { editType: 'removeHeadSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2, defaultSet: { programSetId: 'a2' } }

  it('removes the set linked to the old default\'s set, even though a warmup added in that week moved its ordinal', () => {
    // Ordinal 2 of this week is the added warmup's neighbour: set "a1", not "a2". By position the
    // wrong set would go (break: match by headOrdinal -> removes s-a1).
    const w = week(3, [pe('pe-1')], [
      set('s-warm', 'pe-1', { setNumber: 1, isWarmup: true }),
      set('s-a1', 'pe-1', { setNumber: 2, programSetId: 'a1' }),
      set('s-a2', 'pe-1', { setNumber: 3, programSetId: 'a2' }),
    ])
    expect(one(removeSecond, w)).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet', weekPlanId: 'wp-3', setId: 's-a2' }] })
  })

  it('a set added in that week (no link) is not the default\'s and is never removed: nothing links to the old set -> the week is skipped', () => {
    const w = week(3, [pe('pe-1')], [set('s-a1', 'pe-1', { setNumber: 1, programSetId: 'a1' }), set('s-hand', 'pe-1', { setNumber: 2 })])
    expect(one(removeSecond, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a set linked to the program set but under ANOTHER row is not this row\'s set', () => {
    const w = week(3, [pe('pe-1'), pe('pe-2', { position: 1 })], [set('s-x', 'pe-2', { programSetId: 'a2' })])
    expect(one(removeSecond, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a stage under that link is not a head: removeHeadSet leaves it', () => {
    const w = week(3, [pe('pe-1')], [set('s-a1', 'pe-1', { programSetId: 'a1' }), set('st', 'pe-1', { parentWeekPlanSetId: 's-a1', stageIndex: 1, programSetId: 'a2' })])
    expect(one(removeSecond, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('removeStage removes the stage linked to the old stage, and only a stage', () => {
    const removeStage: ChangeRecord = { editType: 'removeStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: 2 }, defaultSet: { programSetId: 's2', headKind: 'dropset' } }
    const w = week(3, [pe('pe-1')], [
      set('h', 'pe-1', { programSetId: 'a1' }),
      set('st1', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 's1' }),
      set('st2', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 2, programSetId: 's2' }),
    ])
    expect(one(removeStage, w)).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet', setId: 'st2' }] })
    expect(one({ ...removeStage, defaultSet: { programSetId: 'a1' } }, w)).toMatchObject({ status: 'skipped', reason: 'structural' }) // a head under the link
  })

  // R8: the old default's head was a dropset head with a stage; the default drops the stage. A later week that
  // changed the head's kind ITSELF (myo-reps, a warmup) has stages of its own, which a removal must not take: the
  // head's WHOLE kind (headKindOf) must still be the old head's.
  describe('removeStage — only under a head that still has the old head\'s whole kind', () => {
    const drop: ChangeRecord = {
      editType: 'removeStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: 1 },
      defaultSet: { programSetId: 's1', headKind: 'dropset' },
    }
    const under = (headKind: 'dropset' | 'myo_reps' | null | undefined) =>
      week(3, [pe('pe-1')], [
        set('h', 'pe-1', { programSetId: 'a1', ...(headKind === undefined ? {} : { stageKind: headKind }) }),
        set('st1', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 's1' }),
      ])

    it('removes the stage when the week\'s head still has the old head\'s kind', () => {
      expect(one(drop, under('dropset'))).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet', setId: 'st1' }] })
    })

    // Break: skip the head-kind check (what it did) -> the stage of the week's own myo-reps head goes.
    it('a week that changed the head\'s kind itself keeps its stages', () => {
      expect(one(drop, under('myo_reps'))).toMatchObject({ status: 'skipped', reason: 'structural' })
    })

    // B: a null kind on a head that has stages reads as a dropset (the record names the old head's RESOLVED kind,
    // makeWeekDefault.ts), so a week head with no kind stored IS the old dropset head.
    it('a null kind on a head that has stages reads as a dropset', () => {
      expect(one(drop, under(null))).toMatchObject({ status: 'applied' })
      expect(one(drop, under(undefined))).toMatchObject({ status: 'applied' })
    })

    // Case 3's cousin: the week's head is a warmup (with a stage, which only a legacy bug could leave there) or has
    // become a plain working set: not the old dropset head, so the stage stays.
    it('a head the week made a warmup, or a plain working set, is not the old head: its stage stays', () => {
      const asWarmup = week(3, [pe('pe-1')], [
        set('h', 'pe-1', { programSetId: 'a1', isWarmup: true }),
        set('st1', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 's1' }),
      ])
      expect(one(drop, asWarmup)).toMatchObject({ status: 'skipped', reason: 'structural' })
    })

    // A record that does not name the old head's kind cannot tell the week still holds the old head: nothing is
    // removed (every record the diff builds names it).
    it('a record without headKind is left alone: there is no old kind to hold', () => {
      const bare: ChangeRecord = { ...drop, defaultSet: { programSetId: 's1' } } as ChangeRecord
      expect(one(bare, under('dropset'))).toMatchObject({ status: 'skipped', reason: 'structural' })
      expect(one(bare, under('myo_reps'))).toMatchObject({ status: 'skipped', reason: 'structural' })
    })
  })

  it('a record without defaultSet is still matched by ordinal (the hand edit it always was)', () => {
    const hand: ChangeRecord = { editType: 'removeHeadSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2 }
    const w = week(3, [pe('pe-1')], [set('s1', 'pe-1', { setNumber: 1 }), set('s2', 'pe-1', { setNumber: 2 })])
    expect(one(hand, w)).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet', setId: 's2' }] })
  })
})

// ─── A value that changed ────────────────────────────────────────────────────

describe('repTarget from a make-default — written only where the week still holds the old default\'s', () => {
  const change: ChangeRecord = {
    editType: 'repTarget', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 2, stageIndex: null },
    oldValue: REPS_8_10, newValue: REPS_6_8, defaultSet: { programSetId: 'a2' },
  }

  it('writes the new rep target on the set linked to the old default\'s set when it still reads the old one', () => {
    const w = week(3, [pe('pe-1')], [set('s-a1', 'pe-1', { setNumber: 1, programSetId: 'a1', repMin: 8, repMax: 10 }), set('s-a2', 'pe-1', { setNumber: 2, programSetId: 'a2', repMin: 8, repMax: 10 })])
    expect(one(change, w)).toEqual({
      weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
      ops: [{ kind: 'updateSet', weekPlanId: 'wp-3', setId: 's-a2', changes: { repMin: 6, repMax: 8, isAmrap: false } }],
    })
  })

  // Break: apply regardless of what the week holds -> this week's own 12 is overwritten.
  it('a week whose set has its own rep target keeps it: nothing is written, the week is skipped', () => {
    const w = week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { setNumber: 2, programSetId: 'a2', repMin: 12, repMax: 12 })])
    expect(one(change, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a set with no rep target at all is not "the old default\'s 8–10" either', () => {
    const w = week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { setNumber: 2, programSetId: 'a2' })])
    expect(one(change, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a number target is the old default\'s number', () => {
    const num: ChangeRecord = { ...change, oldValue: { repMin: 8, repMax: 8, isAmrap: false } } as ChangeRecord
    expect(one(num, week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: 8 })]))).toMatchObject({ status: 'applied' })
    expect(one(num, week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: 9 })]))).toMatchObject({ status: 'skipped' })
  })

  // M19: "the same" is what the row SHOWS, not how it is stored. A lone minimum (no maximum) reads "none", as an
  // empty target does; an AMRAP set reads "AMRAP" whatever min and max it still carries. The week's storage
  // differs from the old default's here and the display does not, so it still matches.
  // Break: compare the raw columns instead of the shown targets -> both fail.
  it('storage that differs but displays the same counts as matching: a lone minimum is "none", as an empty target is', () => {
    const fromNone: ChangeRecord = { ...change, oldValue: { repMin: null, repMax: null, isAmrap: false } } as ChangeRecord
    const lone = week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: null })])
    expect(one(fromNone, lone)).toMatchObject({ status: 'applied', ops: [{ setId: 's-a2' }] })
    // ...the other way round too: the old default's lone minimum, the week's empty target.
    const fromLone: ChangeRecord = { ...change, oldValue: { repMin: 8, repMax: null, isAmrap: false } } as ChangeRecord
    expect(one(fromLone, week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2' })]))).toMatchObject({ status: 'applied' })
  })

  it('...and an AMRAP set that still carries a minimum and a maximum is the old default\'s AMRAP', () => {
    const fromAmrap: ChangeRecord = { ...change, oldValue: { repMin: null, repMax: null, isAmrap: true } } as ChangeRecord
    const stale = week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', isAmrap: true, repMin: 5, repMax: 5 })])
    expect(one(fromAmrap, stale)).toMatchObject({ status: 'applied' })
  })

  it('...while what differs on screen still differs: a lone minimum is not an AMRAP, nor an 8–10', () => {
    const fromAmrap: ChangeRecord = { ...change, oldValue: { repMin: null, repMax: null, isAmrap: true } } as ChangeRecord
    expect(one(fromAmrap, week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: null })]))).toMatchObject({ status: 'skipped' })
    expect(one(change, week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: null })]))).toMatchObject({ status: 'skipped' })
  })

  it('AMRAP is a target of its own: an AMRAP set is not an 8–10 set, and an 8–10 set is not AMRAP', () => {
    const fromAmrap: ChangeRecord = { ...change, oldValue: { repMin: null, repMax: null, isAmrap: true } } as ChangeRecord
    expect(one(fromAmrap, week(3, [pe('pe-1')], [set('s', 'pe-1', { programSetId: 'a2', isAmrap: true })]))).toMatchObject({ status: 'applied' })
    expect(one(fromAmrap, week(3, [pe('pe-1')], [set('s', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: 10 })]))).toMatchObject({ status: 'skipped' })
  })

  it('the set is found by its link, not its ordinal: the week deleted the default\'s first set, so the linked set is its ordinal 1', () => {
    const w = week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { setNumber: 2, programSetId: 'a2', repMin: 8, repMax: 10 })])
    // by headOrdinal (2) this week has no such set; by link it does.
    expect(one(change, w)).toMatchObject({ status: 'applied', ops: [{ setId: 's-a2' }] })
  })

  it('a set with no link is not touched even when it sits at the ordinal and reads the old value', () => {
    const w = week(3, [pe('pe-1')], [set('s1', 'pe-1', { setNumber: 1, programSetId: 'a1' }), set('s-hand', 'pe-1', { setNumber: 2, repMin: 8, repMax: 10 })])
    expect(one(change, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a stage\'s rep target is matched through the stage\'s own link', () => {
    const stage: ChangeRecord = {
      editType: 'repTarget', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: 1 },
      oldValue: { repMin: 10, repMax: 10, isAmrap: false }, newValue: { repMin: 12, repMax: 12, isAmrap: false }, defaultSet: { programSetId: 'a1s1' },
    }
    const w = week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1' }), set('st', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 'a1s1', repMin: 10, repMax: 10 })])
    expect(one(stage, w)).toMatchObject({ status: 'applied', ops: [{ setId: 'st', changes: { repMin: 12, repMax: 12, isAmrap: false } }] })
  })

  it('a record without defaultSet still writes whatever is there, by position (the hand edit of chunk 20)', () => {
    const hand: ChangeRecord = { ...change, defaultSet: undefined }
    const w = week(3, [pe('pe-1')], [set('s1', 'pe-1', { setNumber: 1 }), set('s2', 'pe-1', { setNumber: 2, repMin: 12, repMax: 12 })])
    expect(one(hand, w)).toMatchObject({ status: 'applied', ops: [{ setId: 's2' }] })
  })
})

// A head's kind is ONE part (headKindOf): a plain working set, a warmup, or staged with its resolved stage kind. The
// warmup and stageKind records name the old head's WHOLE kind (`headKind`) and a week takes one only where its head
// is still exactly that one: a head the week made something else keeps all of it, never half, and nothing is written
// that is both a warmup and staged.
describe('stageKind and warmup from a make-default — only where the week holds the old head\'s whole kind', () => {
  // The old default's head a1 was staged (a dropset), and the default makes it myo-reps.
  const kind: ChangeRecord = {
    editType: 'stageKind', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: 'dropset', newValue: 'myo_reps', defaultSet: { programSetId: 'a1', headKind: 'dropset' },
  }
  // The old default's head a1 was a plain working set, and the default makes it a warmup.
  const warmup: ChangeRecord = {
    editType: 'warmup', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: false, newValue: true, defaultSet: { programSetId: 'a1', headKind: 'working', oldStageIds: [] },
  }
  // The week's head `h` (linked to a1) with the stages given: a stage that names `programSetId` is the old default's.
  const head = (overrides: Partial<WeekPlanSet> = {}, stages: Partial<WeekPlanSet>[] = []) =>
    week(3, [pe('pe-1')], [
      set('h', 'pe-1', { programSetId: 'a1', ...overrides }),
      ...stages.map((s, i) => set(`st${i + 1}`, 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: i + 1, ...s })),
    ])

  it('a stage kind is written where the week\'s head is still the old staged kind', () => {
    expect(one(kind, head({ stageKind: 'dropset' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'applied', ops: [{ setId: 'h', changes: { stageKind: 'myo_reps' } }] })
  })

  it('a week that changed the kind itself keeps it', () => {
    expect(one(kind, head({ stageKind: 'cluster' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  // B: a head with stages and no kind stored IS a dropset (resolveStageKind), the old head's whole kind.
  it('a head with stages and no kind stored is the old dropset head: no kind and a missing kind are the same', () => {
    expect(one(kind, head({ stageKind: null }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'applied' })
    expect(one(kind, head({}, [{ programSetId: 's1' }]))).toMatchObject({ status: 'applied' })
  })

  // ...and a head WITHOUT stages is a plain working set whatever kind it still carries: not the old staged head.
  it('a head with no stages is a plain working set, whatever kind it carries: not the old staged head', () => {
    expect(one(kind, head({ stageKind: 'dropset' }))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a set becomes a warmup where it is still the plain working set the old default had; a week that already turned it into one is skipped', () => {
    expect(one(warmup, head())).toMatchObject({ status: 'applied', ops: [{ changes: { isWarmup: true } }] })
    expect(one(warmup, head({ isWarmup: true }))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('neither is written on a stage row', () => {
    const w = week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'x' }), set('st', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 'a1' })])
    expect(one(kind, w)).toMatchObject({ status: 'skipped' })
    expect(one(warmup, w)).toMatchObject({ status: 'skipped' })
  })

  // A record that names no whole kind cannot tell the week still holds the old head: it writes nothing (every
  // record the diff builds names it).
  it('a record without the old head\'s kind writes nothing', () => {
    const noKindOnKind: ChangeRecord = { ...kind, defaultSet: { programSetId: 'a1' } } as ChangeRecord
    const noKindOnWarmup: ChangeRecord = { ...warmup, defaultSet: { programSetId: 'a1', oldStageIds: [] } } as ChangeRecord
    expect(one(noKindOnKind, head({ stageKind: 'dropset' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(noKindOnWarmup, head())).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  // CASE 1. The old default makes a1 a warmup; the later week had made it a dropset with a stage of its own (a
  // stage that names no program set). The old kind was a plain working set; this head is not one any more, so the
  // warmup is not written, and the week's own stage is not left under a warmup. Break: gate the warmup record on
  // the single field it writes (`isWarmup === oldValue`, as it did) -> this week gets a warmup that is staged.
  it('CASE 1 — a week that made the head a dropset with a stage of its own gets no warmup over it', () => {
    for (const w of [
      head({ stageKind: 'dropset' }, [{ programSetId: null }]),
      head({ stageKind: null }, [{ programSetId: null }]),
      head({ stageKind: 'myo_reps' }, [{ programSetId: 'from-an-older-default' }]),
    ]) {
      expect(one(warmup, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
    }
  })

  // CASE 2. The old default stages a1 as a dropset (a plain working set becomes a dropset with a stage s1; the
  // kind here is the one that differs from the plain set's stored kind); the later week made it a warmup. The kind
  // is not written onto a warmup. Break: gate the stageKind record on `stageKind === oldValue` only (as it did) ->
  // the warmup of this week is given a stage kind.
  it('CASE 2 — a week that made the head a warmup gets no stage kind', () => {
    const plainToMyo: ChangeRecord = {
      editType: 'stageKind', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: 'rest_pause', newValue: 'myo_reps', defaultSet: { programSetId: 'a1', headKind: 'working' },
    }
    // The plain head the old default had stored a kind that showed nowhere; the warmup of this week carries the same one.
    expect(one(plainToMyo, head({ isWarmup: true, stageKind: 'rest_pause' }))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(plainToMyo, head({ isWarmup: true }))).toMatchObject({ status: 'skipped', reason: 'structural' })
    // The same record on a week whose head is still the plain working set the old default had does apply.
    expect(one(plainToMyo, head({ stageKind: 'rest_pause' }))).toMatchObject({ status: 'applied', ops: [{ changes: { stageKind: 'myo_reps' } }] })
  })

  // A record gated on a warmup (the old head WAS a warmup; the default makes it a staged working set) still never puts
  // a kind on the week's warmup: the kind of a warmup shows nowhere and a staged warmup is the state to avoid.
  it('no stage kind is ever written onto a warmup, even when the old head was one', () => {
    const fromWarmup: ChangeRecord = {
      editType: 'stageKind', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: null, newValue: 'myo_reps', defaultSet: { programSetId: 'a1', headKind: 'warmup' },
    }
    expect(one(fromWarmup, head({ isWarmup: true }))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  // A head becomes a warmup only over the old default's stages (the same offer removes them): a stage of the
  // week's own would stay under a warmup.
  describe('a head becomes a warmup only where every stage it has is one the old default had', () => {
    // The old default's a1 was a dropset with the stages s1 and s2, and the default makes it a warmup.
    const staged: ChangeRecord = {
      ...warmup, defaultSet: { programSetId: 'a1', headKind: 'dropset', oldStageIds: ['s1', 's2'] },
    } as ChangeRecord

    it('exactly the old default\'s stages (or fewer: the week deleted one itself): a warmup', () => {
      expect(one(staged, head({ stageKind: 'dropset' }, [{ programSetId: 's1' }, { programSetId: 's2' }]))).toMatchObject({ status: 'applied', ops: [{ changes: { isWarmup: true } }] })
      expect(one(staged, head({ stageKind: 'dropset' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'applied' })
    })

    it('a stage of its own (it names nothing, or a program set the old default no longer has): the head stays as it is', () => {
      expect(one(staged, head({}, [{ programSetId: 's1' }, { programSetId: null }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
      expect(one(staged, head({}, [{ programSetId: 's1' }, { programSetId: 'from-an-older-default' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    })

    it('two stages that name one program set are not "each of the old default\'s stages once": the second is its own', () => {
      expect(one(staged, head({}, [{ programSetId: 's1' }, { programSetId: 's1' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    })

    // The whole-kind equality, not only the guard above, keeps this week out: its stages ARE the old default's, so the guard
    // passes, but the removal of those stages is gated on the same kind (it is not a dropset any more) and would not take
    // them. Turning the head into a warmup would leave a warmup that is staged.
    it('a head the week made myo-reps is not turned into a warmup, though its stages are all the old default\'s', () => {
      expect(one(staged, head({ stageKind: 'myo_reps' }, [{ programSetId: 's1' }, { programSetId: 's2' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    })

    it('a record that lists no old stages cannot tell any stage is the old default\'s: a staged head is left alone', () => {
      const noStages: ChangeRecord = { ...staged, defaultSet: { programSetId: 'a1', headKind: 'dropset' } } as ChangeRecord
      expect(one(noStages, head({}, [{ programSetId: 's1' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    })

    it('turning a warmup into a working set needs no such check: it has no stages to keep', () => {
      const unWarm: ChangeRecord = { ...warmup, oldValue: true, newValue: false, defaultSet: { programSetId: 'a1', headKind: 'warmup', oldStageIds: [] } } as ChangeRecord
      expect(one(unWarm, head({ isWarmup: true }))).toMatchObject({ status: 'applied', ops: [{ changes: { isWarmup: false } }] })
    })
  })
})

// ─── A set that joined ───────────────────────────────────────────────────────

describe('addSet / addWarmupSet / addStage from a make-default — the new set names its program set', () => {
  const working = shape('q', 'pe-1', { position: 4, repMin: 6, repMax: 8 })
  const addSet: ChangeRecord = { editType: 'addSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', defaultSet: working }
  const addWarm: ChangeRecord = { editType: 'addWarmupSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', defaultSet: shape('w', 'pe-1', { isWarmup: true, repMin: 12, repMax: 12 }) }

  it('a working set is added naming its program set; its number is decided when it is written (no number in the op)', () => {
    const w = week(3, [pe('pe-1')], [set('s1', 'pe-1', { setNumber: 1, programSetId: 'a1' })])
    const result = one(addSet, w)
    expect(result).toEqual({
      weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
      ops: [{ kind: 'addPointedSet', weekPlanId: 'wp-3', programExerciseId: 'pe-1', set: working }],
    })
    expect(result.status === 'applied' && 'setNumber' in result.ops[0]).toBe(false)
  })

  it('a warmup is the same op: the service puts it above the week\'s first working set', () => {
    const w = week(3, [pe('pe-1')], [set('s1', 'pe-1', { programSetId: 'a1' })])
    expect(one(addWarm, w)).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedSet', set: { programSetId: 'w', isWarmup: true } }] })
  })

  it('a week that already has a set linked to that program set is left alone (not added twice)', () => {
    const w = week(3, [pe('pe-1')], [set('s1', 'pe-1', { programSetId: 'q' })])
    expect(one(addSet, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(addWarm, week(3, [pe('pe-1')], [set('s1', 'pe-1', { programSetId: 'w' })]))).toMatchObject({ status: 'skipped' })
  })

  it('a week without the exercise row, or with another exercise on it, is skipped', () => {
    expect(one(addSet, week(3, [pe('pe-9')], []))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(addSet, week(3, [pe('pe-1', { exerciseId: 'ex-other' })], []))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a swapped slot\'s new set belongs to the SWAPPED-IN row (the op names it), though the week still holds the old row', () => {
    const swappedSlot: ChangeRecord = { editType: 'addSet', slotId: 'pe-old', exerciseId: 'ex-pe-old', defaultSet: shape('q', 'pe-new') }
    expect(one(swappedSlot, week(3, [pe('pe-old')], []))).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedSet', programExerciseId: 'pe-new' }] })
  })

  const stage = shape('n1', 'pe-1', { position: 2, stageIndex: 2, repMin: 12, repMax: 12 })
  // (The old default's head a2 was a plain working set: no stages, its whole kind is "working".)
  const addStage: ChangeRecord = { editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2, headProgramSetId: 'a2', defaultSet: stage, headKind: 'working' }

  it('a stage is added under the head the week has linked to the old default\'s head, at the default\'s stage index', () => {
    const w = week(3, [pe('pe-1')], [set('h1', 'pe-1', { setNumber: 1, programSetId: 'a1' }), set('h2', 'pe-1', { setNumber: 2, programSetId: 'a2' })])
    expect(one(addStage, w)).toEqual({
      weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
      ops: [{ kind: 'addPointedStage', weekPlanId: 'wp-3', programExerciseId: 'pe-1', parentId: 'h2', stageIndex: 2, set: stage }],
    })
  })

  // The old default's own stages under that head (`oldSetIds`) are not the week's own, so a week that
  // still holds them takes the stage: at the week's next index when one of them sits at the default's.
  // (With stages, the old head was a staged one: here a dropset, a null kind reading as one.)
  const stageOfOldDefault: ChangeRecord = { ...addStage, oldSetIds: ['os2', 'os3'], headKind: 'dropset' } as ChangeRecord

  it('...or at the week\'s next index when the head holds one of the old default\'s stages at that index', () => {
    const w = week(3, [pe('pe-1')], [
      set('h2', 'pe-1', { programSetId: 'a2' }),
      set('old2', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 2, programSetId: 'os2' }),
      set('old3', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 3, programSetId: 'os3' }),
    ])
    expect(one(stageOfOldDefault, w)).toMatchObject({ status: 'applied', ops: [{ stageIndex: 4 }] })
  })

  it('skipped when the week has no set linked to the head, only a stage of its own, or already has the stage', () => {
    expect(one(addStage, week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1' })]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(addStage, week(3, [pe('pe-1')], [set('h2', 'pe-1', { programSetId: 'a2' }), set('x', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 2, programSetId: 'n1' })]))).toMatchObject({ status: 'skipped' })
  })

  // R3, for a stage: a head with a stage of its own already differs from the old default where the new stage
  // would go. Break: apply it anyway (appended at the next index, as it did) -> this fails.
  it('a head that has a stage of its own (none of the old default\'s) is left alone', () => {
    const w = week(3, [pe('pe-1')], [
      set('h2', 'pe-1', { programSetId: 'a2' }),
      set('old2', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 1, programSetId: 'os2' }),
      set('mine', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 2 }),
    ])
    expect(one(stageOfOldDefault, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
    // ...and the same when its link is to a program set the old default no longer has.
    const leftOver = week(3, [pe('pe-1')], [set('h2', 'pe-1', { programSetId: 'a2' }), set('x', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 2, programSetId: 'from-an-older-default' })])
    expect(one(stageOfOldDefault, leftOver)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })
})

// ─── A stage under a head the week made something else ───────────────────────

// An added stage is part of the head's kind: it goes only under a head that is still, as a whole, the old default's
// head (headKindOf), and never under a warmup. The week's head is found by its link to the old head.
describe('addStage from a make-default — only under a head that is still the old head\'s whole kind', () => {
  const head = (overrides: Partial<WeekPlanSet> = {}, stages: Partial<WeekPlanSet>[] = []) =>
    week(3, [pe('pe-1')], [
      set('h', 'pe-1', { programSetId: 'a1', ...overrides }),
      ...stages.map((s, i) => set(`st${i + 1}`, 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: i + 1, ...s })),
    ])

  // The old default's a1 was a dropset with the stage s1, and the default adds s2 under it.
  const s2 = shape('n2', 'pe-1', { position: 1, stageIndex: 2, repMin: 10, repMax: 10 })
  const addS2: ChangeRecord = { editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 1, headProgramSetId: 'a1', defaultSet: s2, oldSetIds: ['s1'], headKind: 'dropset' }

  it('a head that is still the old dropset head takes the stage, at the next index', () => {
    expect(one(addS2, head({ stageKind: 'dropset' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedStage', parentId: 'h', stageIndex: 2 }] })
    expect(one(addS2, head({}, [{ programSetId: 's1' }]))).toMatchObject({ status: 'applied' }) // no kind stored reads as a dropset
  })

  // CASE 3. The later week made the head myo-reps, or a warmup with no stages: it is not the old default's dropset
  // head, so the stage is not added. Break: skip the whole-kind check (only look for the linked head, as it did) ->
  // the stage lands under the week's myo-reps head, and under its warmup.
  it('CASE 3 — a week that made the head myo-reps, or a warmup with no stages, or a plain set again, gets no stage', () => {
    expect(one(addS2, head({ stageKind: 'myo_reps' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(addS2, head({ isWarmup: true }))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(addS2, head({ stageKind: 'dropset' }))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  // CASE 2. The old default stages the plain a1 (a dropset with a stage joins it); the later week made it a warmup.
  // Break: drop the check that the head is not a warmup (the kind check alone cannot see it when the record's old kind is a
  // warmup) -> a stage lands under a warmup; or skip the whole-kind check -> the same.
  it('CASE 2 — a week that made the plain head a warmup gets no stage under it', () => {
    const addS1: ChangeRecord = { editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 1, headProgramSetId: 'a1', defaultSet: shape('n1', 'pe-1', { stageIndex: 1 }), oldSetIds: [], headKind: 'working' }
    expect(one(addS1, head())).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedStage', parentId: 'h', stageIndex: 1 }] })
    expect(one(addS1, head({ isWarmup: true }))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('no stage goes under a warmup even when the old head was a warmup (a record that names it so)', () => {
    const fromWarmup: ChangeRecord = { ...addS2, oldSetIds: [], headKind: 'warmup' } as ChangeRecord
    expect(one(fromWarmup, head({ isWarmup: true }))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a record without the old head\'s kind adds nothing: it cannot tell the head is the old one', () => {
    const bare: ChangeRecord = { ...addS2, headKind: undefined } as ChangeRecord
    expect(one(bare, head({ stageKind: 'dropset' }, [{ programSetId: 's1' }]))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })
})

// ─── A set the week has of its own (R3) ──────────────────────────────────────

// The old default had two sets (a1, a2) and the new one adds a third. A later week with a THIRD set of its
// own (added there, linked to nothing) no longer matches the old default where the new set would go.
describe('addSet / addWarmupSet from a make-default — not where the week has a set of its own of that kind', () => {
  const addSet: ChangeRecord = { editType: 'addSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', defaultSet: shape('q3', 'pe-1', { position: 3, repMin: 6, repMax: 8 }), oldSetIds: ['a1', 'a2'] }
  const addWarm: ChangeRecord = { editType: 'addWarmupSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', defaultSet: shape('w1', 'pe-1', { isWarmup: true, repMin: 12, repMax: 12 }), oldSetIds: ['a1', 'a2'] }
  const two = [set('s1', 'pe-1', { setNumber: 1, programSetId: 'a1' }), set('s2', 'pe-1', { setNumber: 2, programSetId: 'a2' })]

  it('a week that holds exactly the old default\'s sets takes the new one', () => {
    expect(one(addSet, week(3, [pe('pe-1')], two))).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedSet' }] })
  })

  // Break: skip the own-set check (add regardless) -> this fails and the week gets a fourth set.
  it('a week with a third working set of its own (no link) is left alone', () => {
    const w = week(3, [pe('pe-1')], [...two, set('mine', 'pe-1', { setNumber: 3 })])
    expect(one(addSet, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('...and so is a week whose extra set is linked to a program set the old default no longer has (left over from an earlier default)', () => {
    const w = week(3, [pe('pe-1')], [...two, set('older', 'pe-1', { setNumber: 3, programSetId: 'from-an-older-default' })])
    expect(one(addSet, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a week that deleted one of the old default\'s sets has no set of its own: it takes the new one', () => {
    expect(one(addSet, week(3, [pe('pe-1')], [two[0]]))).toMatchObject({ status: 'applied' })
  })

  it('kinds are told apart: a warmup of its own does not stop a working set, and a working set of its own does not stop a warmup', () => {
    expect(one(addSet, week(3, [pe('pe-1')], [...two, set('w', 'pe-1', { setNumber: 0, isWarmup: true })]))).toMatchObject({ status: 'applied' })
    expect(one(addWarm, week(3, [pe('pe-1')], [...two, set('mine', 'pe-1', { setNumber: 3 })]))).toMatchObject({ status: 'applied' })
    // ...and a warmup of its own does stop a warmup.
    expect(one(addWarm, week(3, [pe('pe-1')], [...two, set('w', 'pe-1', { setNumber: 0, isWarmup: true })]))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('stages are not heads: a stage of its own under one of the old default\'s sets does not count as a set of its own', () => {
    const w = week(3, [pe('pe-1')], [...two, set('st', 'pe-1', { setNumber: 2, stageIndex: 1, parentWeekPlanSetId: 's2' })])
    expect(one(addSet, w)).toMatchObject({ status: 'applied' })
  })

  it('a record without oldSetIds has no old default to compare with: nothing is the week\'s own', () => {
    const bare: ChangeRecord = { ...addSet, oldSetIds: undefined } as ChangeRecord
    expect(one(bare, week(3, [pe('pe-1')], [...two, set('mine', 'pe-1', { setNumber: 3 })]))).toMatchObject({ status: 'applied' })
  })

  it('in a swapped slot the week\'s sets under the replaced row are compared with the old row\'s sets', () => {
    const swapped: ChangeRecord = { ...addSet, slotId: 'pe-old', exerciseId: 'ex-pe-old', defaultSet: shape('q3', 'pe-new', { position: 3 }) } as ChangeRecord
    const holdsOld = week(3, [pe('pe-old')], [set('s1', 'pe-old', { programSetId: 'a1' }), set('s2', 'pe-old', { setNumber: 2, programSetId: 'a2' })])
    expect(one(swapped, holdsOld)).toMatchObject({ status: 'applied', ops: [{ programExerciseId: 'pe-new' }] })
    const withOwn = week(3, [pe('pe-old')], [...holdsOld.sets, set('mine', 'pe-old', { setNumber: 3 })])
    expect(one(swapped, withOwn)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })
})

// ─── Per-part planning ───────────────────────────────────────────────────────

describe('planApplyAheadGroups — every part on its own', () => {
  const repChange: ChangeRecord = {
    editType: 'repTarget', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: REPS_8_10, newValue: REPS_6_8, defaultSet: { programSetId: 'a1' },
  }
  const removeChange: ChangeRecord = { editType: 'removeHeadSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2, defaultSet: { programSetId: 'a2' } }
  const groups: AheadGroup[] = [{ workoutDayId: 'wd-1', changes: [repChange, removeChange] }]

  const matching = week(3, [pe('pe-1')], [set('s1', 'pe-1', { setNumber: 1, programSetId: 'a1', repMin: 8, repMax: 10 }), set('s2', 'pe-1', { setNumber: 2, programSetId: 'a2' })])

  it('a week that holds every part takes every one, in record order', () => {
    expect(planApplyAheadGroups(groups, [matching])).toEqual([
      {
        weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
        ops: [
          { kind: 'updateSet', weekPlanId: 'wp-3', setId: 's1', changes: { repMin: 6, repMax: 8, isAmrap: false } },
          { kind: 'removeSet', weekPlanId: 'wp-3', setId: 's2' },
        ],
      },
    ])
  })

  // Break: resolve the records as one bundle (all or nothing) -> the removal is skipped with the diverged rep target.
  it('a diverged part does not stop the others: this week\'s own rep target stays, the removal still applies', () => {
    const diverged = week(3, [pe('pe-1')], [set('s1', 'pe-1', { setNumber: 1, programSetId: 'a1', repMin: 12, repMax: 12 }), set('s2', 'pe-1', { setNumber: 2, programSetId: 'a2' })])
    expect(planApplyAheadGroups(groups, [diverged])).toEqual([
      { weekPlanId: 'wp-3', weekNumber: 3, status: 'applied', ops: [{ kind: 'removeSet', weekPlanId: 'wp-3', setId: 's2' }] },
    ])
  })

  it('a week that holds none of the parts is skipped as already different, and nothing is written', () => {
    const none = week(3, [pe('pe-1')], [set('s1', 'pe-1', { programSetId: 'a1', repMin: 5, repMax: 5 })])
    expect(planApplyAheadGroups(groups, [none])).toEqual([{ weekPlanId: 'wp-3', weekNumber: 3, status: 'skipped', reason: 'structural' }])
  })

  it('a deload week is skipped as deload, however well it matches', () => {
    expect(planApplyAheadGroups(groups, [{ ...matching, isDeload: true }])).toEqual([{ weekPlanId: 'wp-3', weekNumber: 3, status: 'skipped', reason: 'deload' }])
  })

  it('a workout\'s records are applied to that workout\'s sessions only', () => {
    const otherWorkout = week(3, [pe('pe-1')], [set('s1', 'pe-1', { programSetId: 'a1', repMin: 8, repMax: 10 })], { id: 'wp-3b', workoutDayId: 'wd-2' })
    const [a, b] = planApplyAheadGroups(groups, [matching, otherWorkout])
    expect(a.status).toBe('applied')
    expect(b).toMatchObject({ weekPlanId: 'wp-3b', status: 'skipped', reason: 'structural' })
  })

  it('several workouts, each with its own group', () => {
    const second: AheadGroup = { workoutDayId: 'wd-2', changes: [{ editType: 'removeExercise', slotId: 'pe-9', exerciseId: 'ex-pe-9' }] }
    const wd2 = week(3, [pe('pe-9', { workoutDayId: 'wd-2' })], [], { id: 'wp-3b', workoutDayId: 'wd-2' })
    const results = planApplyAheadGroups([...groups, second], [matching, wd2])
    expect(results.map((r) => [r.weekPlanId, r.status])).toEqual([['wp-3', 'applied'], ['wp-3b', 'applied']])
    expect(results[1].status === 'applied' && results[1].ops).toEqual([{ kind: 'removeExercise', weekPlanId: 'wp-3b', programExerciseId: 'pe-9' }])
  })

  it('weeks are resolved one by one: one matches, the next has diverged', () => {
    const diverged = week(4, [pe('pe-1')], [set('s1', 'pe-1', { programSetId: 'a1', repMin: 5, repMax: 5 })])
    expect(planApplyAheadGroups(groups, [matching, diverged]).map((r) => r.status)).toEqual(['applied', 'skipped'])
  })
})

describe('summarizeApplyAheadByWeek — weeks, not sessions', () => {
  const applied = (n: number, plan: string): WeekApplyResult => ({ weekPlanId: plan, weekNumber: n, status: 'applied', ops: [] })
  const skip = (n: number, plan: string, reason: 'deload' | 'structural'): WeekApplyResult => ({ weekPlanId: plan, weekNumber: n, status: 'skipped', reason })

  it('a week with two sessions counts once', () => {
    expect(summarizeApplyAheadByWeek([applied(4, 'a4'), applied(4, 'b4'), applied(5, 'a5'), applied(5, 'b5')])).toEqual({ total: 2, applied: 2, skippedDeload: 0, skippedStructural: 0 })
  })

  it('applied when any session took a part; "already different" when one was left alone and none applied; deload only when every session is deload', () => {
    expect(summarizeApplyAheadByWeek([
      applied(4, 'a4'), skip(4, 'b4', 'structural'), // applied
      skip(5, 'a5', 'structural'), skip(5, 'b5', 'deload'), // already different
      skip(6, 'a6', 'deload'), skip(6, 'b6', 'deload'), // deload
    ])).toEqual({ total: 3, applied: 1, skippedDeload: 1, skippedStructural: 1 })
  })
})
