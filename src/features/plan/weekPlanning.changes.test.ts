import { describe, it, expect } from 'vitest'
import type { ProgramExercise, WeekPlan, WeekPlanSet } from '../../types'
import {
  changesSinceSource,
  chooseChangeSources,
  movedEntries,
  needsRunCopy,
  weeksOfSlot,
  type ExerciseChanges,
  type RunCopy,
  type WeekChanges,
} from './weekPlanning'
import { plan, pe, pset, sets, stage, wset } from './weekPlanning.testutil'

// Chunk 42 — the 1.2 "changes since the source" rules (SPEC, Weeks and copying → Changes since the source; G48, G49):
// week-dependent against last week; stable: counts, kinds, stages and rep targets against the default, weight and RIR
// against last week; week 1 against nothing; exercises by identity, sets by position; cues never; deload nothing.
// Chunk 54b draws them. These tests carry weekDiff.ts's matching rules over (chunk 31: provisional 82 and 83) and pin
// what 1.2 changes; each fixture tells the right source from the wrong one (the default's rep target from last week's,
// last week's weight from the default's none, this slot's history from another slot's).

// ─── Builders ──────────────────────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_ROWS = (exercises: ProgramExercise[], programSets: ReturnType<typeof pset>[]): RunCopy => ({
  exercises,
  sets: programSets,
})

// A week-dependent week 2 against a week 1, from plain lists. A week with no set rows is "empty" and never a source
// (DECISIONS 42), so an exercise-only last week carries one set that no exercise holds.
function between(
  week: [ProgramExercise[], WeekPlanSet[]],
  last: [ProgramExercise[], WeekPlanSet[]],
  over: { weekNumber?: number; lastWeekNumber?: number } = {},
): WeekChanges {
  return changesSinceSource({
    planningType: 'week_dependent',
    weekNumber: over.weekNumber ?? 2,
    week: { isDeload: false, exercises: week[0], sets: week[1] },
    slotWeeks: [plan(over.lastWeekNumber ?? 1, last[0], last[1].length > 0 ? last[1] : [wset('filler', 'no-such-row', 1)])],
    runCopy: null,
  })!
}

const flagsOf = (d: WeekChanges, exId: string): ExerciseChanges => d.exercises.get(exId)!
const setFlags = (d: WeekChanges, exId: string, setId: string) => flagsOf(d, exId).sets.get(setId)
const CLEAN = { added: false, weight: false, reps: false, rir: false, kind: false }

// ─── The order rule (provisional 82) ──────────────────────────────────────────────────────────────────────────────

describe('movedEntries — every exercise outside any of the largest groups that kept their order (provisional 82)', () => {
  it('nothing moved when the order is kept, or there is nothing to move', () => {
    expect(movedEntries([0, 1, 2, 3])).toEqual([false, false, false, false])
    expect(movedEntries([0])).toEqual([false])
    expect(movedEntries([])).toEqual([])
    expect(movedEntries([0, 2, 5])).toEqual([false, false, false]) // gaps (an exercise only the source has) are not a move
  })

  it('one exercise moved past two others is the only one', () => {
    expect(movedEntries([1, 2, 0])).toEqual([false, false, true])
    expect(movedEntries([2, 0, 1])).toEqual([true, false, false])
    expect(movedEntries([0, 3, 1, 2])).toEqual([false, true, false, false])
  })

  it('two neighbours that traded places are both; two such pairs are all four; a reversal is all of them', () => {
    expect(movedEntries([1, 0, 2])).toEqual([true, true, false])
    expect(movedEntries([0, 2, 1, 3])).toEqual([false, true, true, false])
    expect(movedEntries([1, 0, 3, 2])).toEqual([true, true, true, true])
    expect(movedEntries([3, 2, 1, 0])).toEqual([true, true, true, true])
  })
})

// ─── Which sources (1.2) ──────────────────────────────────────────────────────────────────────────────────────────

describe('chooseChangeSources — where each kind of week is compared from', () => {
  const prior = (...weeks: Array<[number, { deload?: boolean; empty?: boolean }?]>) =>
    weeks.map(([weekNumber, o]) => ({ weekNumber, isDeload: o?.deload ?? false, isEmpty: o?.empty ?? false }))
  const choose = (over: Partial<Parameters<typeof chooseChangeSources>[0]>) =>
    chooseChangeSources({ planningType: 'week_dependent', weekNumber: 3, isDeload: false, priorWeeks: prior([1], [2]), ...over })
  const NONE = { shape: { kind: 'none' }, numbers: { kind: 'none' } }

  it('a week-dependent week is compared with last week for everything', () => {
    expect(choose({})).toEqual({ shape: { kind: 'week', weekNumber: 2 }, numbers: { kind: 'week', weekNumber: 2 } })
  })

  it('a stable week: sets, structure and reps against the default, weights and RIR against last week', () => {
    expect(choose({ planningType: 'stable' })).toEqual({ shape: { kind: 'default' }, numbers: { kind: 'week', weekNumber: 2 } })
  })

  it('week 1 is compared with nothing, either type (1.1 compared its reps with the run copy; 1.2 does not)', () => {
    for (const planningType of ['week_dependent', 'stable'] as const) {
      expect(choose({ planningType, weekNumber: 1, priorWeeks: [] })).toEqual(NONE)
    }
  })

  it('a deload session is compared with nothing, on any week and either type', () => {
    expect(choose({ isDeload: true })).toEqual(NONE)
    expect(choose({ isDeload: true, planningType: 'stable' })).toEqual(NONE)
    expect(choose({ isDeload: true, weekNumber: 1, priorWeeks: [] })).toEqual(NONE)
  })

  it('last week is the last normal, non-empty occurrence: a deload week and an empty one are skipped; a later week is never a source', () => {
    expect(choose({ weekNumber: 4, priorWeeks: prior([1], [2, { deload: true }], [3, { empty: true }]) })).toEqual({
      shape: { kind: 'week', weekNumber: 1 },
      numbers: { kind: 'week', weekNumber: 1 },
    })
    expect(choose({ weekNumber: 2, priorWeeks: prior([1], [2], [3]) }).numbers).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('a week nobody planned in between is no source: week 4 after planned weeks 1 and 2 is compared with week 2, either type (G56)', () => {
    expect(choose({ weekNumber: 4, priorWeeks: prior([1], [2]) })).toEqual({
      shape: { kind: 'week', weekNumber: 2 },
      numbers: { kind: 'week', weekNumber: 2 },
    })
    expect(choose({ planningType: 'stable', weekNumber: 4, priorWeeks: prior([1], [2]) })).toEqual({
      shape: { kind: 'default' },
      numbers: { kind: 'week', weekNumber: 2 },
    })
  })

  it('a stable week\'s numbers skip a deload or empty week too; with nothing usable before it only the default remains', () => {
    const stable = (weekNumber: number, ...weeks: Parameters<typeof prior>) => choose({ planningType: 'stable', weekNumber, priorWeeks: prior(...weeks) })
    expect(stable(4, [1], [2, { deload: true }], [3, { empty: true }])).toEqual({ shape: { kind: 'default' }, numbers: { kind: 'week', weekNumber: 1 } })
    expect(stable(3, [1, { deload: true }], [2, { empty: true }])).toEqual({ shape: { kind: 'default' }, numbers: { kind: 'none' } })
    expect(choose({ planningType: 'stable', priorWeeks: [] })).toEqual({ shape: { kind: 'default' }, numbers: { kind: 'none' } })
  })

  it('a week-dependent week with no last week has nothing to compare with — there is no "week start" setting to ask any more', () => {
    expect(choose({ priorWeeks: [] })).toEqual(NONE)
    expect(choose({ priorWeeks: prior([1, { deload: true }], [2, { empty: true }]) })).toEqual(NONE)
  })

  it('only a choice that reads the default needs the run copy read', () => {
    expect(needsRunCopy(choose({}))).toBe(false)
    expect(needsRunCopy(choose({ planningType: 'stable' }))).toBe(true)
    expect(needsRunCopy(choose({ planningType: 'stable', weekNumber: 1, priorWeeks: [] }))).toBe(false) // week 1: nothing
    expect(needsRunCopy(choose({ planningType: 'stable', isDeload: true }))).toBe(false)
  })
})

// ─── The whole decision ───────────────────────────────────────────────────────────────────────────────────────────

describe('changesSinceSource — the week against its sources', () => {
  const ex = [pe('e', 'bench', 0)]

  it('week 1 is compared with nothing, even with the run copy read and a source it could use', () => {
    const copy = DEFAULT_ROWS(ex, [pset('p1', 'e', 1, { repMin: 5, repMax: 5 })])
    const week = { isDeload: false, exercises: ex, sets: [wset('e-1', 'e', 1, { repMin: 8, repMax: 8 }), wset('e-2', 'e', 2)] }
    for (const planningType of ['week_dependent', 'stable'] as const) {
      expect(changesSinceSource({ planningType, weekNumber: 1, week, slotWeeks: [], runCopy: copy })).toBeNull()
      expect(changesSinceSource({ planningType, weekNumber: 1, week, slotWeeks: [plan(1, ex, week.sets)], runCopy: copy })).toBeNull()
    }
  })

  it('a deload session shows no highlighting, whatever it differs by', () => {
    const last = plan(1, ex, sets('e', 3))
    const week = { isDeload: true, exercises: ex, sets: sets('e', 1, { targetWeight: 50 }) }
    expect(changesSinceSource({ planningType: 'week_dependent', weekNumber: 2, week, slotWeeks: [last], runCopy: null })).toBeNull()
    expect(changesSinceSource({ planningType: 'stable', weekNumber: 2, week, slotWeeks: [last], runCopy: DEFAULT_ROWS(ex, [pset('p', 'e', 1)]) })).toBeNull()
  })

  it('week-dependent: weight, reps and RIR all against last week; the legend names last week', () => {
    const week = [wset('e-1', 'e', 1, { targetWeight: 105, repMin: 6, repMax: 6, targetRir: 1 })]
    const d = between([ex, week], [ex, sets('e', 1)])
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: true, reps: true, rir: true })
    expect(d.sourceWeek).toBe(1)
  })

  it('stable: a rep target equal to last week\'s but not the default\'s IS marked; one equal to the default\'s but not last week\'s is not', () => {
    // Default: 8 reps. Last week: 10 reps (the user changed it then). This week: 10 / 8.
    const lastWeek = plan(1, ex, [wset('e-1', 'e', 1, { repMin: 10, repMax: 10 }), wset('e-2', 'e', 2, { repMin: 10, repMax: 10 })])
    const thisWeek = [wset('e-1', 'e', 1, { repMin: 10, repMax: 10 }), wset('e-2', 'e', 2, { repMin: 8, repMax: 8 })]
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: ex, sets: thisWeek },
      slotWeeks: [lastWeek],
      runCopy: DEFAULT_ROWS(ex, [pset('p1', 'e', 1, { repMin: 8, repMax: 8 }), pset('p2', 'e', 2, { repMin: 8, repMax: 8 })]),
    })!
    expect(setFlags(d, 'e', 'e-1')?.reps).toBe(true) // 10 = last week's, ≠ the default's 8
    expect(setFlags(d, 'e', 'e-2')?.reps).toBe(false) // 8 = the default's, ≠ last week's 10
  })

  it('stable: weight and RIR against last week, sets and structure against the default (the default holds no weight)', () => {
    const lastWeek = plan(1, ex, [wset('e-1', 'e', 1, { targetWeight: 100, targetRir: 2 }), wset('e-2', 'e', 2, { targetWeight: 105, targetRir: 2 })])
    const thisWeek = [
      wset('e-1', 'e', 1, { targetWeight: 100, targetRir: 2 }),
      wset('e-2', 'e', 2, { targetWeight: 107.5, targetRir: 1 }),
      wset('e-3', 'e', 3, { targetWeight: 100 }),
    ]
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: ex, sets: thisWeek },
      slotWeeks: [lastWeek],
      runCopy: DEFAULT_ROWS(ex, [pset('p1', 'e', 1), pset('p2', 'e', 2)]),
    })!
    // If weights were compared with the default (none), set 1's 100 kg, equal to last week's, would be marked.
    expect(setFlags(d, 'e', 'e-1')).toEqual(CLEAN)
    expect(setFlags(d, 'e', 'e-2')).toMatchObject({ weight: true, rir: true, reps: false, added: false })
    // The default has two sets, so a third is new — and last week had no third set either, so its numbers differ from last week's.
    expect(setFlags(d, 'e', 'e-3')).toMatchObject({ added: true, weight: true, rir: true })
    expect(d.sourceWeek).toBe(1)
  })

  it('stable: a stable week\'s marks exist at all (G48): the legend names last week and an unchanged week marks nothing', () => {
    const last = plan(1, ex, sets('e', 2))
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: ex, sets: sets('e', 2) },
      slotWeeks: [last],
      runCopy: DEFAULT_ROWS(ex, [pset('p1', 'e', 1), pset('p2', 'e', 2)]),
    })!
    expect(d).not.toBeNull()
    expect(d.sourceWeek).toBe(1)
    expect([...flagsOf(d, 'e').sets.values()].every((f) => !f.added && !f.weight && !f.reps && !f.rir && !f.kind)).toBe(true)
  })

  it('stable: waits for the run copy — until it is read, nothing is marked', () => {
    const week = { isDeload: false, exercises: ex, sets: sets('e', 1) }
    expect(changesSinceSource({ planningType: 'stable', weekNumber: 2, week, slotWeeks: [plan(1, ex, sets('e', 1))], runCopy: null })).toBeNull()
  })

  it('stable: weights and RIR are the last NORMAL, non-empty week\'s — a deload week or an empty one between is skipped', () => {
    const copy = DEFAULT_ROWS(ex, [pset('p1', 'e', 1)])
    const at = (n: number, weight: number, rir: number, over: Partial<WeekPlan> = {}) => plan(n, ex, sets('e', 1, { targetWeight: weight, targetRir: rir }), over)
    const view = (weekSets: WeekPlanSet[], slotWeeks: WeekPlan[]) =>
      changesSinceSource({ planningType: 'stable', weekNumber: 4, week: { isDeload: false, exercises: ex, sets: weekSets }, slotWeeks, runCopy: copy })!
    const equal = sets('e', 1, { targetWeight: 100, targetRir: 2 }) // week 2's
    const heavier = sets('e', 1, { targetWeight: 105, targetRir: 1 })

    const deloadBetween = [at(2, 100, 2), at(3, 60, 4, { isDeload: true })]
    expect(setFlags(view(equal, deloadBetween), 'e', 'e-1')).toMatchObject({ weight: false, rir: false })
    expect(setFlags(view(heavier, deloadBetween), 'e', 'e-1')).toMatchObject({ weight: true, rir: true })
    expect(view(equal, deloadBetween).sourceWeek).toBe(2)

    for (const empty of [plan(3, ex, []), plan(3, [], [])]) {
      const emptyBetween = [at(2, 100, 2), empty]
      expect(setFlags(view(equal, emptyBetween), 'e', 'e-1'), 'equal to week 2').toMatchObject({ weight: false, rir: false })
      expect(setFlags(view(heavier, emptyBetween), 'e', 'e-1'), 'differs from week 2').toMatchObject({ weight: true, rir: true })
    }
  })

  it('stable: the default is read for structure even when there is no last week; weight and RIR then mark nothing, and the legend has no week', () => {
    const thisWeek = [wset('e-1', 'e', 1, { targetWeight: 80 }), wset('e-2', 'e', 2)]
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: ex, sets: thisWeek },
      slotWeeks: [],
      runCopy: DEFAULT_ROWS(ex, [pset('p1', 'e', 1)]),
    })!
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: false, rir: false })
    expect(setFlags(d, 'e', 'e-2')?.added).toBe(true)
    expect(d.sourceWeek).toBeNull()
  })

  it('stable: the default is the run copy as autoCopy reads it — a set it dropped and a week-only exercise are not in it', () => {
    const copy: RunCopy = {
      exercises: [{ id: 'e', exerciseId: 'bench', position: 0 }, { id: 'x', exerciseId: 'curl', position: 1, weekOnly: true }],
      sets: [
        pset('p1', 'e', 1),
        pset('p2', 'e', 2, { removedAt: '2026-10-01T00:00:00Z' }),
        pset('p3', 'e', 3),
        pset('px', 'x', 1),
      ],
    }
    const week = [pe('e', 'bench', 0)]
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: week, sets: sets('e', 3) },
      slotWeeks: [],
      runCopy: copy,
    })!
    expect(setFlags(d, 'e', 'e-1')?.added).toBe(false)
    expect(setFlags(d, 'e', 'e-2')?.added).toBe(false)
    expect(setFlags(d, 'e', 'e-3')?.added).toBe(true) // the default has two live sets
    expect(d.removedExercises).toEqual([]) // the week-only exercise isn't a default exercise to be missed
  })

  it('a week with no last week (nothing planned before, or only deload and empty weeks) shows no highlighting', () => {
    const week = { isDeload: false, exercises: ex, sets: sets('e', 1) }
    const wd = (slotWeeks: WeekPlan[]) => changesSinceSource({ planningType: 'week_dependent', weekNumber: 3, week, slotWeeks, runCopy: null })
    expect(wd([])).toBeNull()
    expect(wd([plan(1, ex, sets('e', 1), { isDeload: true }), plan(2, ex, [])])).toBeNull()
  })

  it('last week is the last normal occurrence, skipping a deload week between, and the viewed week is never its own source', () => {
    const w1 = plan(1, ex, sets('e', 1, { targetWeight: 100 }))
    const w2 = plan(2, ex, sets('e', 1, { targetWeight: 50 }), { isDeload: true })
    const w3 = plan(3, ex, sets('e', 1, { targetWeight: 100 }))
    const d = changesSinceSource({ planningType: 'week_dependent', weekNumber: 3, week: { isDeload: false, exercises: ex, sets: w3.sets }, slotWeeks: [w1, w2, w3], runCopy: null })!
    expect(setFlags(d, 'e', 'e-1')?.weight).toBe(false) // against week 1 (100), not the deload week 2 (50)
    expect(d.sourceWeek).toBe(1)
  })

  it('the week after a week nobody planned is compared with the last planned normal week, and the legend names it (G56)', () => {
    const w1 = plan(1, ex, sets('e', 1, { targetWeight: 100 }))
    const w2 = plan(2, ex, sets('e', 1, { targetWeight: 120 }))
    // Week 3 was never planned. Week 4 holds 120 kg: the same as week 2's, not week 1's.
    const same = changesSinceSource({ planningType: 'week_dependent', weekNumber: 4, week: { isDeload: false, exercises: ex, sets: sets('e', 1, { targetWeight: 120 }) }, slotWeeks: [w1, w2], runCopy: null })!
    expect(same.sourceWeek).toBe(2)
    expect(setFlags(same, 'e', 'e-1')?.weight).toBe(false)
    const changed = changesSinceSource({ planningType: 'week_dependent', weekNumber: 4, week: { isDeload: false, exercises: ex, sets: sets('e', 1, { targetWeight: 125 }) }, slotWeeks: [w1, w2], runCopy: null })!
    expect(setFlags(changed, 'e', 'e-1')?.weight).toBe(true) // 125 against week 2's 120
  })

  it('past weeks are compared with what came before them; a later week is never a source', () => {
    const w1 = plan(1, ex, sets('e', 1, { targetWeight: 100 }))
    const w2 = plan(2, ex, sets('e', 1, { targetWeight: 110 }))
    const w3 = plan(3, ex, sets('e', 1, { targetWeight: 120 }))
    const d = changesSinceSource({ planningType: 'week_dependent', weekNumber: 2, week: { isDeload: false, exercises: ex, sets: w2.sets }, slotWeeks: [w1, w2, w3], runCopy: null })!
    expect(setFlags(d, 'e', 'e-1')?.weight).toBe(true) // 110 against week 1's 100
  })

  it('a sequence run\'s slot has its own history: the same workout in another slot is not its last cycle', () => {
    const slot = (n: number, position: number, weight: number) =>
      plan(n, ex, sets('e', 1, { targetWeight: weight }), { id: `c${n}-s${position}`, workoutDayId: 'wd-A', sequencePosition: position })
    const all = [slot(1, 1, 55), slot(1, 4, 100), slot(2, 1, 57.5)]
    const slotWeeks = weeksOfSlot(all, 'wd-A', 1)
    const d = changesSinceSource({ planningType: 'week_dependent', weekNumber: 2, week: { isDeload: false, exercises: ex, sets: all[2].sets }, slotWeeks, runCopy: null })!
    expect(setFlags(d, 'e', 'e-1')?.weight).toBe(true) // 57.5 against this slot's 55
    // The same 55 kg this slot had last cycle is no change. Slot 4's history (100 kg) would call it one.
    const same = changesSinceSource({ planningType: 'week_dependent', weekNumber: 2, week: { isDeload: false, exercises: ex, sets: sets('e', 1, { targetWeight: 55 }) }, slotWeeks, runCopy: null })!
    expect(setFlags(same, 'e', 'e-1')?.weight).toBe(false)
  })
})

// ─── Exercises ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('changesSinceSource — exercises are matched by exercise identity (G23, G36)', () => {
  it('a swap is the old exercise removed, directly above the new one added — not one changed row', () => {
    const source = [pe('s-bench', 'bench', 0), pe('s-row', 'row', 1), pe('s-squat', 'squat', 2)]
    const week = [pe('w-bench', 'bench', 0), pe('w-incline', 'incline', 1), pe('w-squat', 'squat', 2)]
    const d = between([week, []], [source, []])
    expect(flagsOf(d, 'w-incline').added).toBe(true)
    expect(flagsOf(d, 'w-bench').added).toBe(false)
    expect(flagsOf(d, 'w-squat').added).toBe(false)
    expect(d.removedExercises).toEqual([{ exerciseId: 'row', name: 'ROW', after: 'w-bench' }])
    expect([...d.exercises.values()].some((e) => e.moved)).toBe(false) // the others kept their order around the swap
  })

  it('a swap at the top has its removed line above everything', () => {
    const d = between([[pe('w-incline', 'incline', 0), pe('w-bench', 'bench', 1)], []], [[pe('s-row', 'row', 0), pe('s-bench', 'bench', 1)], []])
    expect(d.removedExercises).toEqual([{ exerciseId: 'row', name: 'ROW', after: null }])
  })

  it('a row is the same exercise whichever row holds it: a different program-exercise id with the same exercise matches', () => {
    const d = between([[pe('w-row', 'row', 0)], []], [[pe('s-row', 'row', 0)], []])
    expect(flagsOf(d, 'w-row').added).toBe(false)
    expect(d.removedExercises).toEqual([])
  })

  it('an exercise only the week has is added; one only the source has is removed in its place, in the source\'s order', () => {
    const source = [pe('a', 'a', 0), pe('x', 'x', 1), pe('y', 'y', 2), pe('b', 'b', 3), pe('z', 'z', 4)]
    const week = [pe('a2', 'a', 0), pe('b2', 'b', 1), pe('n', 'n', 2)]
    const d = between([week, []], [source, []])
    expect(flagsOf(d, 'n').added).toBe(true)
    expect(d.removedExercises).toEqual([
      { exerciseId: 'x', name: 'X', after: 'a2' },
      { exerciseId: 'y', name: 'Y', after: 'a2' },
      { exerciseId: 'z', name: 'Z', after: 'b2' },
    ])
  })

  it('the same exercise twice in one workout is paired in order of position (provisional 83)', () => {
    const source = [pe('s1', 'bench', 0), pe('s2', 'bench', 1)]
    const sourceSets = [wset('s1-1', 's1', 1, { repMin: 8, repMax: 8 }), wset('s2-1', 's2', 1, { repMin: 15, repMax: 15 })]
    const weekRows = [pe('w1', 'bench', 0), pe('w2', 'bench', 1)]
    const weekSets = [wset('w1-1', 'w1', 1, { repMin: 8, repMax: 8 }), wset('w2-1', 'w2', 1, { repMin: 15, repMax: 15 })]
    const d = between([weekRows, weekSets], [source, sourceSets])
    expect(setFlags(d, 'w1', 'w1-1')?.reps).toBe(false)
    expect(setFlags(d, 'w2', 'w2-1')?.reps).toBe(false) // compared with the first, 15 ≠ 8
    expect(d.removedExercises).toEqual([])
  })

  it('a second occurrence with no second occurrence in the source is added; the reverse is removed', () => {
    const grew = between([[pe('w1', 'bench', 0), pe('w2', 'bench', 1)], []], [[pe('s1', 'bench', 0)], []])
    expect(flagsOf(grew, 'w1').added).toBe(false)
    expect(flagsOf(grew, 'w2').added).toBe(true)
    const shrank = between([[pe('w1', 'bench', 0)], []], [[pe('s1', 'bench', 0), pe('s2', 'bench', 1)], []])
    expect(shrank.removedExercises).toEqual([{ exerciseId: 'bench', name: 'BENCH', after: 'w1' }])
  })

  it('order: only the moved exercise is flagged; two neighbours that traded places are both; adding or removing around them moves nothing', () => {
    const rows = (ids: string[], prefix: string) => ids.map((id, i) => pe(`${prefix}-${id}`, id, i))
    const src = rows(['a', 'b', 'c', 'd'], 's')
    const moved = (week: ProgramExercise[]) => [...between([week, []], [src, []]).exercises].filter(([, e]) => e.moved).map(([id]) => id)
    expect(moved(rows(['b', 'c', 'a', 'd'], 'w'))).toEqual(['w-a']) // a moved past b and c
    expect(moved(rows(['a', 'c', 'b', 'd'], 'w'))).toEqual(['w-c', 'w-b']) // neighbours traded
    expect(moved(rows(['a', 'n', 'b', 'd'], 'w'))).toEqual([]) // c removed, n added, order kept
  })

  it('an added exercise has nothing inside it compared, and a removed one leaves only its line', () => {
    const d = between([[pe('n', 'n', 0)], sets('n', 2)], [[pe('x', 'x', 0)], sets('x', 2)])
    expect(flagsOf(d, 'n').added).toBe(true)
    expect(flagsOf(d, 'n').sets.size).toBe(0)
    expect(d.removedExercises).toHaveLength(1)
  })

  it('the exercise rows may come in any order: the week is read in its own position order', () => {
    const d = between([[pe('w-b', 'b', 1), pe('w-a', 'a', 0)], []], [[pe('s-a', 'a', 0), pe('s-b', 'b', 1)], []])
    expect([...d.exercises.values()].some((e) => e.moved)).toBe(false)
  })
})

// ─── Sets, by position ────────────────────────────────────────────────────────────────────────────────────────────

describe('changesSinceSource — sets are matched by position: head ordinal, then stage index, warmups included', () => {
  const ex = [pe('e', 'bench', 0)]

  it('only the set whose weight differs is flagged', () => {
    const week = sets('e', 3).map((s) => (s.id === 'e-2' ? { ...s, targetWeight: 105 } : s))
    const d = between([ex, week], [ex, sets('e', 3)])
    expect(setFlags(d, 'e', 'e-1')).toEqual(CLEAN)
    expect(setFlags(d, 'e', 'e-2')).toMatchObject({ weight: true, reps: false, rir: false })
    expect(setFlags(d, 'e', 'e-3')).toEqual(CLEAN)
  })

  it('weight, reps and RIR are each flagged on their own', () => {
    const source = sets('e', 1)
    const flags = (over: Partial<WeekPlanSet>) => setFlags(between([ex, [{ ...source[0], ...over }]], [ex, source]), 'e', 'e-1')
    expect(flags({ targetWeight: 102.5 })).toMatchObject({ weight: true, reps: false, rir: false })
    expect(flags({ repMin: 8, repMax: 12 })).toMatchObject({ weight: false, reps: true, rir: false })
    expect(flags({ isAmrap: true, repMin: null, repMax: null })).toMatchObject({ reps: true })
    expect(flags({ targetRir: 1 })).toMatchObject({ weight: false, reps: false, rir: true })
    expect(flags({ targetWeight: null })).toMatchObject({ weight: true })
    expect(flags({ targetRir: null })).toMatchObject({ rir: true })
  })

  it('a rep target is compared as it shows: 8 to 8 is 8, and no target equals no target', () => {
    const source = [wset('e-1', 'e', 1, { repMin: 8, repMax: 8 }), wset('e-2', 'e', 2, { repMin: null, repMax: null })]
    const week = [wset('e-1', 'e', 1, { repMin: 8, repMax: 8, isAmrap: false }), wset('e-2', 'e', 2, { repMin: undefined, repMax: undefined, isAmrap: undefined })]
    const d = between([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'e-1')?.reps).toBe(false)
    expect(setFlags(d, 'e', 'e-2')?.reps).toBe(false)
    // An AMRAP is AMRAP whatever stray min and max it carries; a half-set pair shows as no target at all.
    const amrapSource = [wset('e-1', 'e', 1, { isAmrap: true, repMin: null, repMax: null }), wset('e-2', 'e', 2, { repMin: 8, repMax: null })]
    const amrapWeek = [wset('e-1', 'e', 1, { isAmrap: true, repMin: 6, repMax: 8 }), wset('e-2', 'e', 2, { repMin: null, repMax: null })]
    const same = between([ex, amrapWeek], [ex, amrapSource])
    expect(setFlags(same, 'e', 'e-1')?.reps).toBe(false)
    expect(setFlags(same, 'e', 'e-2')?.reps).toBe(false)
  })

  it('a set the source has and the week hasn\'t is removed (always the trailing one); a set only the week has is added', () => {
    const fewer = between([ex, sets('e', 2)], [ex, sets('e', 3)])
    expect(flagsOf(fewer, 'e').removedHeads).toEqual([
      { ordinal: 3, stageIndex: null, isWarmup: false, numbers: { repMin: 8, repMax: 8, isAmrap: false, targetWeight: 100, targetRir: 2, targetRirMax: null } },
    ])
    expect(setFlags(fewer, 'e', 'e-2')?.added).toBe(false)

    const more = between([ex, sets('e', 4)], [ex, sets('e', 3)])
    // Last week is both sources here, and it has no fourth set: new against it in every way.
    expect(setFlags(more, 'e', 'e-4')).toMatchObject({ added: true, weight: true, rir: true })
    expect(setFlags(more, 'e', 'e-3')).toEqual(CLEAN)
    expect(flagsOf(more, 'e').removedHeads).toEqual([])
  })

  it('warmups count in the position: a warmup added above the working sets shifts every position after it', () => {
    const source = [wset('s1', 'e', 1, { targetWeight: 100 }), wset('s2', 'e', 2, { targetWeight: 105 }), wset('s3', 'e', 3, { targetWeight: 110 })]
    const week = [
      wset('w0', 'e', 1, { isWarmup: true, targetWeight: 40, targetRir: null }),
      wset('w1', 'e', 2, { targetWeight: 100 }),
      wset('w2', 'e', 3, { targetWeight: 105 }),
      wset('w3', 'e', 4, { targetWeight: 110 }),
    ]
    const d = between([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'w0')).toMatchObject({ weight: true, kind: true })
    expect(setFlags(d, 'e', 'w1')?.weight).toBe(true) // 100 against 105
    expect(setFlags(d, 'e', 'w2')?.weight).toBe(true) // 105 against 110
    expect(setFlags(d, 'e', 'w3')?.added).toBe(true) // position 4 has no counterpart
  })

  it('the heads are ranked by set number, however the rows come in; set numbers 1, 3, 7 against 1, 2, 3 are first, second and third', () => {
    const week = [wset('w7', 'e', 7), wset('w1', 'e', 1), wset('w3', 'e', 3)]
    const d = between([ex, week], [ex, sets('e', 3)])
    expect([...flagsOf(d, 'e').sets.values()].every((f) => !f.added && !f.weight && !f.reps && !f.rir && !f.kind)).toBe(true)
    expect(flagsOf(d, 'e').removedHeads).toEqual([])
    const ordered = between(
      [ex, [wset('w2', 'e', 2, { targetWeight: 105 }), wset('w1', 'e', 1, { targetWeight: 100 })]],
      [ex, [wset('s1', 'e', 1, { targetWeight: 100 }), wset('s2', 'e', 2, { targetWeight: 105 })]],
    )
    expect(setFlags(ordered, 'e', 'w1')?.weight).toBe(false)
    expect(setFlags(ordered, 'e', 'w2')?.weight).toBe(false)
  })

  it('stages are matched by stage index within the matched set; one only the week has is added, one only the source has is removed under its set', () => {
    const source = [
      wset('s1', 'e', 1, { stageKind: 'dropset' }),
      stage('s1a', 's1', 'e', 1, { targetWeight: 80 }),
      stage('s1b', 's1', 'e', 2, { targetWeight: 60 }),
      stage('s1c', 's1', 'e', 3, { targetWeight: 40 }),
    ]
    const week = [
      wset('w1', 'e', 1, { stageKind: 'dropset' }),
      stage('w1a', 'w1', 'e', 1, { targetWeight: 80 }),
      stage('w1c', 'w1', 'e', 3, { targetWeight: 45 }), // stage 2 deleted; stage 3's weight differs
      stage('w1d', 'w1', 'e', 4, { targetWeight: 20 }), // a new stage 4
    ]
    const d = between([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'w1a')).toMatchObject({ weight: false, added: false })
    expect(setFlags(d, 'e', 'w1c')).toMatchObject({ weight: true, added: false }) // matched with stage 3, not with the second stage
    expect(setFlags(d, 'e', 'w1d')?.added).toBe(true)
    expect(flagsOf(d, 'e').removedStages.get('w1')).toEqual([
      { ordinal: 1, stageIndex: 2, isWarmup: false, numbers: { repMin: 8, repMax: 8, isAmrap: false, targetWeight: 60, targetRir: 2, targetRirMax: null } },
    ])
  })

  it('a stage\'s weight, reps and RIR are each flagged on their own, and a stage equal to its counterpart is not flagged at all', () => {
    const source = [wset('s1', 'e', 1, { stageKind: 'dropset' }), stage('s1a', 's1', 'e', 1, { targetWeight: 80, repMin: 6, repMax: 6, targetRir: 0 })]
    const flags = (over: Partial<WeekPlanSet>) => {
      const week = [wset('w1', 'e', 1, { stageKind: 'dropset' }), stage('w1a', 'w1', 'e', 1, { targetWeight: 80, repMin: 6, repMax: 6, targetRir: 0, ...over })]
      return setFlags(between([ex, week], [ex, source]), 'e', 'w1a')
    }
    expect(flags({})).toEqual(CLEAN)
    expect(flags({ targetWeight: 70 })).toMatchObject({ weight: true, reps: false, rir: false })
    expect(flags({ repMin: 8, repMax: 10 })).toMatchObject({ weight: false, reps: true, rir: false })
    expect(flags({ isAmrap: true, repMin: null, repMax: null })).toMatchObject({ weight: false, reps: true, rir: false })
    expect(flags({ targetRir: 1 })).toMatchObject({ weight: false, reps: false, rir: true })
    expect(flags({ targetRir: null })).toMatchObject({ weight: false, reps: false, rir: true })
  })

  it('the stages of a set the source doesn\'t have are added with it; the stages of a set the week no longer has go with it', () => {
    const added = between([ex, [wset('w1', 'e', 1), wset('w2', 'e', 2, { stageKind: 'rest_pause' }), stage('w2a', 'w2', 'e', 1)]], [ex, sets('e', 1)])
    expect(setFlags(added, 'e', 'w2')?.added).toBe(true)
    expect(setFlags(added, 'e', 'w2a')?.added).toBe(true)
    const source = [wset('s1', 'e', 1), wset('s2', 'e', 2, { stageKind: 'dropset' }), stage('s2a', 's2', 'e', 1), stage('s2b', 's2', 'e', 2)]
    const gone = between([ex, [wset('w1', 'e', 1)]], [ex, source])
    expect(flagsOf(gone, 'e').removedHeads.map((r) => [r.ordinal, r.stageIndex])).toEqual([[2, null]])
    expect(flagsOf(gone, 'e').removedStages.size).toBe(0)
  })
})

// ─── An added set, on a stable week ───────────────────────────────────────────────────────────────────────────────

describe('changesSinceSource — an added set: its number and reps are the default\'s to say, its weight and RIR last week\'s (G48, G24)', () => {
  const ex = [pe('e', 'bench', 0)]
  const defaultThree = () => DEFAULT_ROWS(ex, [pset('p1', 'e', 1), pset('p2', 'e', 2), pset('p3', 'e', 3)])
  const stable = (weekNumber: number, weekSets: WeekPlanSet[], lastWeek: WeekPlanSet[] | null) =>
    changesSinceSource({
      planningType: 'stable',
      weekNumber,
      week: { isDeload: false, exercises: ex, sets: weekSets },
      slotWeeks: lastWeek ? [plan(1, ex, lastWeek)] : [],
      runCopy: defaultThree(),
    })!
  const four = (over: Partial<WeekPlanSet> = {}) => [...sets('e', 3), wset('e-4', 'e', 4, { targetWeight: 100, targetRir: 2, ...over })]

  it('a set beyond the default whose weight and RIR equal last week\'s set at that position is added, and nothing more', () => {
    expect(setFlags(stable(2, four(), four()), 'e', 'e-4')).toEqual({ ...CLEAN, added: true })
  })

  it('... where they differ from last week\'s set at that position, each is flagged on its own', () => {
    expect(setFlags(stable(2, four(), four({ targetWeight: 95 })), 'e', 'e-4')).toMatchObject({ added: true, weight: true, rir: false })
    expect(setFlags(stable(2, four(), four({ targetRir: 3 })), 'e', 'e-4')).toMatchObject({ added: true, weight: false, rir: true })
  })

  it('... and where last week has no set at that position, they differ from it', () => {
    const d = stable(2, four(), sets('e', 3))
    expect(setFlags(d, 'e', 'e-4')).toMatchObject({ added: true, weight: true, rir: true })
    expect(setFlags(d, 'e', 'e-3')).toEqual(CLEAN)
  })

  it('weight and RIR follow last week alone: a set the default has and last week hasn\'t differs from last week', () => {
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: ex, sets: four() },
      slotWeeks: [plan(1, ex, sets('e', 3))],
      runCopy: DEFAULT_ROWS(ex, [pset('p1', 'e', 1), pset('p2', 'e', 2), pset('p3', 'e', 3), pset('p4', 'e', 4)]),
    })!
    expect(setFlags(d, 'e', 'e-4')).toMatchObject({ added: false, weight: true, rir: true })
  })

  it('the stages of an added working set: their numbers follow last week\'s stage, or last week\'s lack of the set', () => {
    const staged = (over: Partial<WeekPlanSet> = {}) => [
      ...sets('e', 3),
      wset('e-4', 'e', 4, { stageKind: 'dropset' }),
      stage('e-4a', 'e-4', 'e', 1, { targetWeight: 80, repMin: 6, repMax: 6, targetRir: 0, ...over }),
    ]
    expect(setFlags(stable(2, staged(), staged()), 'e', 'e-4a')).toEqual({ ...CLEAN, added: true })
    expect(setFlags(stable(2, staged(), staged({ targetWeight: 70 })), 'e', 'e-4a')).toMatchObject({ added: true, weight: true, rir: false })
    expect(setFlags(stable(2, staged(), sets('e', 3)), 'e', 'e-4a')).toMatchObject({ added: true, weight: true, rir: true })
  })

  it('a stage added under a set last week also had is the structure\'s to mark: its numbers are not flagged for being new', () => {
    const d = stable(2, [...sets('e', 3), wset('e-4', 'e', 4, { stageKind: 'dropset' }), stage('e-4a', 'e-4', 'e', 1)], [...sets('e', 3), wset('e-4', 'e', 4)])
    expect(setFlags(d, 'e', 'e-4a')).toMatchObject({ added: true, weight: false, rir: false })
  })

  it('a warmup with no counterpart is the structure\'s to mark (a new set kind): its numbers are not flagged for being new', () => {
    const d = between([[pe('e', 'bench', 0)], [wset('e-1', 'e', 1), wset('e-2', 'e', 2, { isWarmup: true, targetRir: null, targetWeight: 40 })]], [[pe('e', 'bench', 0)], [wset('e-1', 'e', 1)]])
    expect(setFlags(d, 'e', 'e-2')).toMatchObject({ added: true, weight: false, rir: false })
  })

  it('an exercise the numbers source lacks has nothing inside it compared with that source', () => {
    const d = changesSinceSource({
      planningType: 'stable',
      weekNumber: 2,
      week: { isDeload: false, exercises: ex, sets: sets('e', 2) },
      slotWeeks: [plan(1, [pe('x', 'squat', 0)], sets('x', 2))],
      runCopy: DEFAULT_ROWS(ex, [pset('p1', 'e', 1), pset('p2', 'e', 2)]),
    })!
    expect([...flagsOf(d, 'e').sets.values()].every((f) => !f.weight && !f.rir && !f.added)).toBe(true)
  })
})

// ─── Set kinds ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('changesSinceSource — set kinds (warmup, staged and its kind)', () => {
  const ex = [pe('e', 'bench', 0)]
  const staged = (kind: WeekPlanSet['stageKind']) => [wset('h', 'e', 1, { stageKind: kind }), stage('hs', 'h', 'e', 1)]

  it('a changed stage kind flags the set\'s kind', () => {
    expect(setFlags(between([ex, staged('rest_pause')], [ex, staged('dropset')]), 'e', 'h')?.kind).toBe(true)
  })

  it('a null kind on a set with stages reads as a dropset, as the row shows it', () => {
    expect(setFlags(between([ex, staged(null)], [ex, staged('dropset')]), 'e', 'h')?.kind).toBe(false)
  })

  it('a stage kind on a set without stages shows nowhere, so it is not a difference', () => {
    const d = between([ex, [wset('h', 'e', 1, { stageKind: 'cluster' })]], [ex, [wset('h', 'e', 1, { stageKind: null })]])
    expect(setFlags(d, 'e', 'h')?.kind).toBe(false)
  })

  it('a warmup against a working set, and a plain set that gains stages, are kind changes', () => {
    const warm = between([ex, [wset('h', 'e', 1, { isWarmup: true, targetRir: null })]], [ex, [wset('h', 'e', 1)]])
    expect(setFlags(warm, 'e', 'h')?.kind).toBe(true)
    const gained = between([ex, staged('dropset')], [ex, [wset('h', 'e', 1)]])
    expect(setFlags(gained, 'e', 'h')?.kind).toBe(true)
    expect(setFlags(gained, 'e', 'hs')?.added).toBe(true)
  })

  it('a stage kind that differs does not flag the numbers, and numbers that differ do not flag the kind', () => {
    expect(setFlags(between([ex, staged('myo_reps')], [ex, staged('dropset')]), 'e', 'h')).toMatchObject({ kind: true, weight: false, reps: false, rir: false })
    expect(setFlags(between([ex, [wset('h', 'e', 1, { targetWeight: 90 })]], [ex, [wset('h', 'e', 1)]]), 'e', 'h')).toMatchObject({ kind: false, weight: true })
  })
})

// ─── RIR, as a range (1.2) and on a warmup (G49) ──────────────────────────────────────────────────────────────────

describe('changesSinceSource — RIR is a number or a range (both ends compared), and a warmup row has no RIR target (G49)', () => {
  const ex = [pe('e', 'bench', 0)]
  const one = (over: Partial<WeekPlanSet>) => [wset('e-1', 'e', 1, over)]

  it('a range against the same range is not a difference; either end that differs is, and so is a range against a number', () => {
    const last = one({ targetRir: 1, targetRirMax: 2 })
    const rir = (over: Partial<WeekPlanSet>) => setFlags(between([ex, one(over)], [ex, last]), 'e', 'e-1')?.rir
    expect(rir({ targetRir: 1, targetRirMax: 2 })).toBe(false)
    expect(rir({ targetRir: 1, targetRirMax: 3 })).toBe(true) // the high end
    expect(rir({ targetRir: 0, targetRirMax: 2 })).toBe(true) // the low end
    expect(rir({ targetRir: 1, targetRirMax: null })).toBe(true) // the range became a number
    expect(rir({ targetRir: 2, targetRirMax: null })).toBe(true)
  })

  it('a number that became a range is a difference too', () => {
    expect(setFlags(between([ex, one({ targetRir: 2, targetRirMax: 3 })], [ex, one({ targetRir: 2 })]), 'e', 'e-1')?.rir).toBe(true)
  })

  it('a stage\'s RIR range is compared on both ends', () => {
    const rows = (max: number | null) => [wset('h', 'e', 1, { stageKind: 'dropset' }), stage('hs', 'h', 'e', 1, { targetRir: 0, targetRirMax: max })]
    expect(setFlags(between([ex, rows(1)], [ex, rows(1)]), 'e', 'hs')?.rir).toBe(false)
    expect(setFlags(between([ex, rows(2)], [ex, rows(1)]), 'e', 'hs')?.rir).toBe(true)
  })

  it('a warmup\'s RIR is never a mark: its row has no RIR cell (a 1.1 week may still hold one)', () => {
    const warm = (rir: number | null) => [wset('e-w', 'e', 1, { isWarmup: true, targetRir: rir }), wset('e-1', 'e', 2)]
    const d = between([ex, warm(null)], [ex, warm(5)]) // last week's legacy warmup RIR 5, this week's none
    expect(setFlags(d, 'e', 'e-w')?.rir).toBe(false)
    expect(setFlags(d, 'e', 'e-1')?.rir).toBe(false)
    // The working set beside it still marks its own RIR.
    const working = between([ex, [wset('e-w', 'e', 1, { isWarmup: true, targetRir: null }), wset('e-1', 'e', 2, { targetRir: 3 })]], [ex, warm(5)])
    expect(setFlags(working, 'e', 'e-1')?.rir).toBe(true)
    expect(setFlags(working, 'e', 'e-w')?.rir).toBe(false)
  })

  it('a warmup\'s weight and reps are still marked', () => {
    const d = between(
      [ex, [wset('e-w', 'e', 1, { isWarmup: true, targetWeight: 40, targetRir: null, repMin: 10, repMax: 10 })]],
      [ex, [wset('e-w', 'e', 1, { isWarmup: true, targetWeight: 30, targetRir: null, repMin: 12, repMax: 12 })]],
    )
    expect(setFlags(d, 'e', 'e-w')).toMatchObject({ weight: true, reps: true, rir: false })
  })
})

// ─── Never compared ───────────────────────────────────────────────────────────────────────────────────────────────

describe('what is never compared: cues, rest, tempo, superset grouping, the unit', () => {
  it('a week that differs from its source only in those has no difference at all', () => {
    const sourceRows = [pe('e', 'bench', 0, { restSeconds: 90, restAfterSeconds: 120, tempo: '3-1-1-0', weightUnit: 'kg', supersetBlockId: null })]
    const weekRows = [pe('e', 'bench', 0, { restSeconds: 150, restAfterSeconds: null, tempo: '2-0-2-0', weightUnit: 'lbs', supersetBlockId: 'block-1' })]
    const sourceSets = [wset('s1', 'e', 1, { tags: ['push here'], programSetId: 'ps-1' }), wset('s2', 'e', 2, { tags: null })]
    const weekSets = [wset('s1', 'e', 1, { tags: null, programSetId: 'ps-9' }), wset('s2', 'e', 2, { tags: ['pause', 'custom tag'] })]
    const d = between([weekRows, weekSets], [sourceRows, sourceSets])
    expect(flagsOf(d, 'e')).toMatchObject({ added: false, moved: false })
    expect([...flagsOf(d, 'e').sets.values()].every((f) => !f.added && !f.weight && !f.reps && !f.rir && !f.kind)).toBe(true)
    expect(flagsOf(d, 'e').removedHeads).toEqual([])
    expect(d.removedExercises).toEqual([])
  })

  it('weights are compared as stored (kg): the unit chosen to show them can neither cause nor hide a difference', () => {
    const same = between([[pe('e', 'bench', 0, { weightUnit: 'lbs' })], sets('e', 1)], [[pe('e', 'bench', 0, { weightUnit: 'kg' })], sets('e', 1)])
    expect(setFlags(same, 'e', 'e-1')?.weight).toBe(false)
    const differ = between([[pe('e', 'bench', 0, { weightUnit: 'lbs' })], sets('e', 1, { targetWeight: 100.5 })], [[pe('e', 'bench', 0, { weightUnit: 'lbs' })], sets('e', 1)])
    expect(setFlags(differ, 'e', 'e-1')?.weight).toBe(true)
  })
})

// ─── What 1.2 leaves as 1.1 had it ────────────────────────────────────────────────────────────────────────────────

describe('changesSinceSource — a box that differs from the source is a change, empty or not (SPEC: "anything ... that differs"; D31 provisional)', () => {
  it('a week planned forward with no numbers of its own marks every number last week had: the 1.1 rule, kept as built', () => {
    const ex = [pe('e', 'bench', 0)]
    const d = between([ex, sets('e', 1, { targetWeight: null, targetRir: null, repMin: null, repMax: null })], [ex, sets('e', 1)])
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: true, rir: true, reps: true, added: false })
  })
})
