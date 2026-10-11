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
    const removeStage: ChangeRecord = { editType: 'removeStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: 2 }, defaultSet: { programSetId: 's2' } }
    const w = week(3, [pe('pe-1')], [
      set('h', 'pe-1', { programSetId: 'a1' }),
      set('st1', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 's1' }),
      set('st2', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 2, programSetId: 's2' }),
    ])
    expect(one(removeStage, w)).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet', setId: 'st2' }] })
    expect(one({ ...removeStage, defaultSet: { programSetId: 'a1' } }, w)).toMatchObject({ status: 'skipped', reason: 'structural' }) // a head under the link
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

  it('equal as the row shows it is equal: a number target 8 stored as 8–8 is the old default\'s 8', () => {
    const num: ChangeRecord = { ...change, oldValue: { repMin: 8, repMax: 8, isAmrap: false } } as ChangeRecord
    const w = week(3, [pe('pe-1')], [set('s-a2', 'pe-1', { programSetId: 'a2', repMin: 8, repMax: 8 })])
    expect(one(num, w)).toMatchObject({ status: 'applied' })
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

describe('stageKind and warmup from a make-default — also only where the week holds the old kind', () => {
  const kind: ChangeRecord = {
    editType: 'stageKind', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: 'dropset', newValue: 'myo_reps', defaultSet: { programSetId: 'a1' },
  }
  const warmup: ChangeRecord = {
    editType: 'warmup', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: false, newValue: true, defaultSet: { programSetId: 'a1' },
  }

  it('a stage kind is written where the week\'s set still has the old kind', () => {
    const w = week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1', stageKind: 'dropset' })])
    expect(one(kind, w)).toMatchObject({ status: 'applied', ops: [{ setId: 'h', changes: { stageKind: 'myo_reps' } }] })
  })

  it('a week that changed the kind itself keeps it', () => {
    const w = week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1', stageKind: 'cluster' })])
    expect(one(kind, w)).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('no kind and a missing kind are the same old value', () => {
    const fromNone: ChangeRecord = { ...kind, oldValue: null } as ChangeRecord
    expect(one(fromNone, week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1' })]))).toMatchObject({ status: 'applied' })
  })

  it('a set becomes a warmup where it still isn\'t one; a week that already turned it into one is skipped', () => {
    expect(one(warmup, week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1' })]))).toMatchObject({ status: 'applied', ops: [{ changes: { isWarmup: true } }] })
    expect(one(warmup, week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1', isWarmup: true })]))).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('neither is written on a stage row', () => {
    const w = week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'x' }), set('st', 'pe-1', { parentWeekPlanSetId: 'h', stageIndex: 1, programSetId: 'a1' })])
    expect(one(kind, w)).toMatchObject({ status: 'skipped' })
    expect(one(warmup, w)).toMatchObject({ status: 'skipped' })
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
  const addStage: ChangeRecord = { editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2, headProgramSetId: 'a2', defaultSet: stage }

  it('a stage is added under the head the week has linked to the old default\'s head, at the default\'s stage index', () => {
    const w = week(3, [pe('pe-1')], [set('h1', 'pe-1', { setNumber: 1, programSetId: 'a1' }), set('h2', 'pe-1', { setNumber: 2, programSetId: 'a2' })])
    expect(one(addStage, w)).toEqual({
      weekPlanId: 'wp-3', weekNumber: 3, status: 'applied',
      ops: [{ kind: 'addPointedStage', weekPlanId: 'wp-3', programExerciseId: 'pe-1', parentId: 'h2', stageIndex: 2, set: stage }],
    })
  })

  it('...or at the week\'s next index when the head already has a stage there', () => {
    const w = week(3, [pe('pe-1')], [
      set('h2', 'pe-1', { programSetId: 'a2' }),
      set('hand', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 2 }),
      set('hand2', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 3 }),
    ])
    expect(one(addStage, w)).toMatchObject({ status: 'applied', ops: [{ stageIndex: 4 }] })
  })

  it('skipped when the week has no set linked to the head, only a stage of its own, or already has the stage', () => {
    expect(one(addStage, week(3, [pe('pe-1')], [set('h', 'pe-1', { programSetId: 'a1' })]))).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(one(addStage, week(3, [pe('pe-1')], [set('h2', 'pe-1', { programSetId: 'a2' }), set('x', 'pe-1', { parentWeekPlanSetId: 'h2', stageIndex: 2, programSetId: 'n1' })]))).toMatchObject({ status: 'skipped' })
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
