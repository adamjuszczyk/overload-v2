import { describe, it, expect } from 'vitest'
import type { ProgramExercise, ProgramSet, WeekPlan, WeekPlanSet } from '../../types'
import { groupWeekPlanSets } from '../gym/setGroupLogic'
import { setPositionOf } from './applyAhead'
import {
  chooseDiffSources,
  computeWeekDiff,
  diffWeek,
  movedEntries,
  needsRunCopy,
  plannedWeekRecords,
  runCopyToDiffExercises,
  weekToDiffExercises,
  weeksOfSlot,
  type ExerciseDiff,
  type WeekDiff,
} from './weekDiff'

// Chunk 31 (TASKS-1.1 "Differences from the week's source are highlighted"; SPEC Plan screen [P1.1]).
// The pure rules: which source a week is compared with, how exercises and sets are matched, and what
// counts as a difference. PlanPage.highlights.test.tsx proves the same rules are wired to the screen.

// ─── Builders ──────────────────────────────────────────────────────────────────

const pe = (id: string, exerciseId: string, position: number, over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u', exerciseId, position, weightUnit: null,
  exercise: { id: exerciseId, userId: 'u', name: exerciseId.toUpperCase(), muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
  ...over,
})

function wset(id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id, weekPlanId: 'wp', userId: 'u', programExerciseId, setNumber, targetRir: 2, isDropset: false,
    parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: 100, repMin: 8, repMax: 8, ...over,
  }
}
const stage = (id: string, parent: string, programExerciseId: string, stageIndex: number, over: Partial<WeekPlanSet> = {}) =>
  wset(id, programExerciseId, 1, { isDropset: true, parentWeekPlanSetId: parent, stageIndex, ...over })

function pset(id: string, programExerciseId: string, position: number, over: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id, userId: 'u', programExerciseId, position, isWarmup: false, stageKind: null, stageRestSeconds: null,
    parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 8, isAmrap: false, restSeconds: null, createdAt: '', ...over,
  }
}

function plan(weekNumber: number, exercises: ProgramExercise[], sets: WeekPlanSet[], over: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'u', mesocycleId: 'm', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null,
    sets, exercises, createdAt: '', ...over,
  }
}

// One exercise with `n` identical working sets, set ids `${pe}-1`…
function sets(peId: string, n: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet[] {
  return Array.from({ length: n }, (_, i) => wset(`${peId}-${i + 1}`, peId, i + 1, over))
}

// Compare two plain lists the way a week-dependent week is compared with last week.
function diffBetween(weekRows: [ProgramExercise[], WeekPlanSet[]], sourceRows: [ProgramExercise[], WeekPlanSet[]]): WeekDiff {
  const source = weekToDiffExercises(sourceRows[0], sourceRows[1])
  return diffWeek(weekToDiffExercises(weekRows[0], weekRows[1]), { shape: source, numbers: source })
}

const flagsOf = (d: WeekDiff, exId: string): ExerciseDiff => d.exercises.get(exId)!
const setFlags = (d: WeekDiff, exId: string, setId: string) => flagsOf(d, exId).sets.get(setId)

// ─── The order rule (provisional 82) ──────────────────────────────────────────

describe('movedEntries — every exercise outside any of the largest groups that kept their order (provisional 82)', () => {
  it('nothing moved when the order is kept, or there is nothing to move', () => {
    expect(movedEntries([0, 1, 2, 3])).toEqual([false, false, false, false])
    expect(movedEntries([0])).toEqual([false])
    expect(movedEntries([])).toEqual([])
    // Gaps (an exercise only the source has between them) are not a move.
    expect(movedEntries([0, 2, 5])).toEqual([false, false, false])
  })

  it('one exercise moved past two others is the only one', () => {
    expect(movedEntries([1, 2, 0])).toEqual([false, false, true]) // the first moved to the end
    expect(movedEntries([2, 0, 1])).toEqual([true, false, false]) // the last moved to the front
    expect(movedEntries([0, 3, 1, 2])).toEqual([false, true, false, false]) // the last moved up past the middle two
  })

  it('two neighbours that traded places are both', () => {
    expect(movedEntries([1, 0, 2])).toEqual([true, true, false])
    expect(movedEntries([0, 2, 1, 3])).toEqual([false, true, true, false])
  })

  it('two such pairs are all four; a reversal is all of them', () => {
    expect(movedEntries([1, 0, 3, 2])).toEqual([true, true, true, true])
    expect(movedEntries([3, 2, 1, 0])).toEqual([true, true, true, true])
  })
})

// ─── Exercises ────────────────────────────────────────────────────────────────

describe('diffWeek — exercises are matched by exercise identity (G23, G36)', () => {
  it('a swap is the old exercise removed, directly above the new one added — not one changed row', () => {
    // Source: Bench, Row, Squat. This week the Row was swapped for Incline (its own new row, at the same place).
    const source = [pe('s-bench', 'bench', 0), pe('s-row', 'row', 1), pe('s-squat', 'squat', 2)]
    const week = [pe('w-bench', 'bench', 0), pe('w-incline', 'incline', 1), pe('w-squat', 'squat', 2)]
    const d = diffBetween([week, []], [source, []])

    expect(flagsOf(d, 'w-incline').added).toBe(true)
    expect(flagsOf(d, 'w-bench').added).toBe(false)
    expect(flagsOf(d, 'w-squat').added).toBe(false)
    expect(d.removedExercises).toEqual([{ exerciseId: 'row', name: 'ROW', after: 'w-bench' }])
    // Nothing moved: the others kept their order around the swap.
    expect([...d.exercises.values()].some((e) => e.moved)).toBe(false)
  })

  it('a swap at the top has its removed line above everything', () => {
    const d = diffBetween([[pe('w-incline', 'incline', 0), pe('w-bench', 'bench', 1)], []], [[pe('s-row', 'row', 0), pe('s-bench', 'bench', 1)], []])
    expect(d.removedExercises).toEqual([{ exerciseId: 'row', name: 'ROW', after: null }])
  })

  it('a row is the same exercise whichever row holds it: a different program-exercise id with the same exercise matches', () => {
    // The week's row for Row is a different row from the source's (as after a swap back), still Row.
    const d = diffBetween([[pe('w-row', 'row', 0)], []], [[pe('s-row', 'row', 0)], []])
    expect(flagsOf(d, 'w-row').added).toBe(false)
    expect(d.removedExercises).toEqual([])
  })

  it('an exercise only the week has is added; one only the source has is removed in its place, in the source\'s order', () => {
    const source = [pe('a', 'a', 0), pe('x', 'x', 1), pe('y', 'y', 2), pe('b', 'b', 3), pe('z', 'z', 4)]
    const week = [pe('a2', 'a', 0), pe('b2', 'b', 1), pe('n', 'n', 2)]
    const d = diffBetween([week, []], [source, []])
    expect(flagsOf(d, 'n').added).toBe(true)
    expect(d.removedExercises).toEqual([
      { exerciseId: 'x', name: 'X', after: 'a2' },
      { exerciseId: 'y', name: 'Y', after: 'a2' },
      { exerciseId: 'z', name: 'Z', after: 'b2' },
    ])
  })

  it('the same exercise twice in one workout is paired in order of position (provisional 83)', () => {
    // Heavy bench (8 reps) first, light bench (15 reps) second — on both sides.
    const source = [pe('s1', 'bench', 0), pe('s2', 'bench', 1)]
    const sourceSets = [wset('s1-1', 's1', 1, { repMin: 8, repMax: 8 }), wset('s2-1', 's2', 1, { repMin: 15, repMax: 15 })]
    const weekRows = [pe('w1', 'bench', 0), pe('w2', 'bench', 1)]
    const weekSets = [wset('w1-1', 'w1', 1, { repMin: 8, repMax: 8 }), wset('w2-1', 'w2', 1, { repMin: 15, repMax: 15 })]
    const d = diffBetween([weekRows, weekSets], [source, sourceSets])
    // First with first, second with second: nothing differs. (If the second were compared with the first, 15 ≠ 8.)
    expect(setFlags(d, 'w1', 'w1-1')?.reps).toBe(false)
    expect(setFlags(d, 'w2', 'w2-1')?.reps).toBe(false)
    expect(flagsOf(d, 'w1').added || flagsOf(d, 'w2').added).toBe(false)
    expect(d.removedExercises).toEqual([])
  })

  it('a second occurrence with no second occurrence in the source is added; the reverse is removed', () => {
    const one = [pe('s1', 'bench', 0)]
    const two = [pe('w1', 'bench', 0), pe('w2', 'bench', 1)]
    const grew = diffBetween([two, []], [one, []])
    expect(flagsOf(grew, 'w1').added).toBe(false)
    expect(flagsOf(grew, 'w2').added).toBe(true)
    const shrank = diffBetween([[pe('w1', 'bench', 0)], []], [[pe('s1', 'bench', 0), pe('s2', 'bench', 1)], []])
    expect(shrank.removedExercises).toEqual([{ exerciseId: 'bench', name: 'BENCH', after: 'w1' }])
  })

  it('order: only the moved exercise is flagged; two neighbours that traded places are both; adding or removing around them moves nothing', () => {
    const rows = (ids: string[]) => ids.map((id, i) => pe(`w-${id}`, id, i))
    const src = rows(['a', 'b', 'c', 'd']).map((r) => ({ ...r, id: r.id.replace('w-', 's-') }))

    const oneMoved = diffBetween([rows(['b', 'c', 'a', 'd']), []], [src, []]) // a moved past b and c
    expect([...oneMoved.exercises].filter(([, e]) => e.moved).map(([id]) => id)).toEqual(['w-a'])

    const traded = diffBetween([rows(['a', 'c', 'b', 'd']), []], [src, []])
    expect([...traded.exercises].filter(([, e]) => e.moved).map(([id]) => id)).toEqual(['w-c', 'w-b'])

    const aroundIt = diffBetween([rows(['a', 'n', 'b', 'd']), []], [src, []]) // c removed, n added, order kept
    expect([...aroundIt.exercises].some(([, e]) => e.moved)).toBe(false)
  })

  it('an exercise the week has and the source has is not "added" and an added exercise is never "moved"', () => {
    const d = diffBetween([[pe('n', 'n', 0), pe('a', 'a', 1)], []], [[pe('a', 'a', 0)], []])
    expect(flagsOf(d, 'n')).toMatchObject({ added: true, moved: false })
    expect(flagsOf(d, 'a')).toMatchObject({ added: false, moved: false })
  })
})

// ─── Sets, by position ───────────────────────────────────────────────────────

describe('diffWeek — sets are matched by position (G23): head ordinal, then stage index, warmups included', () => {
  const ex = [pe('e', 'bench', 0)]

  it('only the set whose weight differs is flagged', () => {
    const source = sets('e', 3)
    const week = sets('e', 3).map((s) => (s.id === 'e-2' ? { ...s, targetWeight: 105 } : s))
    const d = diffBetween([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: false, reps: false, rir: false, added: false, kind: false })
    expect(setFlags(d, 'e', 'e-2')).toMatchObject({ weight: true, reps: false, rir: false })
    expect(setFlags(d, 'e', 'e-3')).toMatchObject({ weight: false, reps: false, rir: false })
  })

  it('weight, reps and RIR are each flagged on their own', () => {
    const source = sets('e', 1)
    const d = (over: Partial<WeekPlanSet>) => setFlags(diffBetween([ex, [{ ...source[0], ...over }]], [ex, source]), 'e', 'e-1')
    expect(d({ targetWeight: 102.5 })).toMatchObject({ weight: true, reps: false, rir: false })
    expect(d({ repMin: 8, repMax: 12 })).toMatchObject({ weight: false, reps: true, rir: false })
    expect(d({ isAmrap: true, repMin: null, repMax: null })).toMatchObject({ reps: true })
    expect(d({ targetRir: 1 })).toMatchObject({ weight: false, reps: false, rir: true })
    expect(d({ targetWeight: null })).toMatchObject({ weight: true })
    expect(d({ targetRir: null })).toMatchObject({ rir: true })
  })

  it('a rep target is compared as it shows: 8 to 8 is 8, and no target equals no target', () => {
    const source = [wset('e-1', 'e', 1, { repMin: 8, repMax: 8 }), wset('e-2', 'e', 2, { repMin: null, repMax: null })]
    const week = [wset('e-1', 'e', 1, { repMin: 8, repMax: 8, isAmrap: false }), wset('e-2', 'e', 2, { repMin: undefined, repMax: undefined, isAmrap: undefined })]
    const d = diffBetween([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'e-1')?.reps).toBe(false)
    expect(setFlags(d, 'e', 'e-2')?.reps).toBe(false)

    // An AMRAP is AMRAP whatever stray min and max it carries; a half-set pair shows as no target at all.
    const amrapSource = [wset('e-1', 'e', 1, { isAmrap: true, repMin: null, repMax: null }), wset('e-2', 'e', 2, { repMin: 8, repMax: null })]
    const amrapWeek = [wset('e-1', 'e', 1, { isAmrap: true, repMin: 6, repMax: 8 }), wset('e-2', 'e', 2, { repMin: null, repMax: null })]
    const same = diffBetween([ex, amrapWeek], [ex, amrapSource])
    expect(setFlags(same, 'e', 'e-1')?.reps).toBe(false)
    expect(setFlags(same, 'e', 'e-2')?.reps).toBe(false)
  })

  it('a set the source has and the week hasn\'t is removed (always the trailing one); a set only the week has is added', () => {
    const source = sets('e', 3)
    const fewer = diffBetween([ex, sets('e', 2)], [ex, source])
    expect(flagsOf(fewer, 'e').removedHeads).toEqual([
      { ordinal: 3, stageIndex: null, isWarmup: false, numbers: { repMin: 8, repMax: 8, isAmrap: false, targetWeight: 100, targetRir: 2 } },
    ])
    expect(setFlags(fewer, 'e', 'e-2')?.added).toBe(false)

    const more = diffBetween([ex, sets('e', 4)], [ex, source])
    expect(setFlags(more, 'e', 'e-4')?.added).toBe(true)
    expect(setFlags(more, 'e', 'e-3')?.added).toBe(false)
    expect(flagsOf(more, 'e').removedHeads).toEqual([])
  })

  it('warmups count in the position: a warmup added above the working sets shifts every position after it', () => {
    // Source: working 100, 105, 110. Week: a warmup 40 above them, the same three after.
    const source = [wset('s1', 'e', 1, { targetWeight: 100 }), wset('s2', 'e', 2, { targetWeight: 105 }), wset('s3', 'e', 3, { targetWeight: 110 })]
    const week = [
      wset('w0', 'e', 1, { isWarmup: true, targetWeight: 40, targetRir: null }),
      wset('w1', 'e', 2, { targetWeight: 100 }),
      wset('w2', 'e', 3, { targetWeight: 105 }),
      wset('w3', 'e', 4, { targetWeight: 110 }),
    ]
    const d = diffBetween([ex, week], [ex, source])
    // Position 1 is the warmup against the first working set; each working set meets the next one's weight.
    expect(setFlags(d, 'e', 'w0')).toMatchObject({ weight: true, kind: true })
    expect(setFlags(d, 'e', 'w1')?.weight).toBe(true) // 100 against 105
    expect(setFlags(d, 'e', 'w2')?.weight).toBe(true) // 105 against 110
    expect(setFlags(d, 'e', 'w3')?.added).toBe(true) // position 4 has no counterpart
    expect(flagsOf(d, 'e').removedHeads).toEqual([])
  })

  it('a position is chunk 20\'s set position: the head ordinal (a rank, not the raw set number) then the stage index — the same one apply-ahead uses', () => {
    // Set numbers with gaps and a duplicate; stages out of order.
    const rows = [
      wset('c', 'e', 7),
      wset('a', 'e', 1),
      wset('b', 'e', 3, { stageKind: 'dropset' }),
      stage('b2', 'b', 'e', 2),
      stage('b1', 'b', 'e', 1),
      wset('d', 'e', 3),
    ]
    const [exercise] = weekToDiffExercises(ex, rows)
    const groups = groupWeekPlanSets(rows).sort((x, y) => x.head.setNumber - y.head.setNumber)
    exercise.heads.forEach((head, i) => {
      expect(setPositionOf(groups, head.id)).toEqual({ headOrdinal: i + 1, stageIndex: null })
      head.stages.forEach((st) => expect(setPositionOf(groups, st.id)).toEqual({ headOrdinal: i + 1, stageIndex: st.stageIndex }))
    })
    expect(exercise.heads.map((h) => h.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(exercise.heads[1].stages.map((st) => st.id)).toEqual(['b1', 'b2'])

    // So set numbers 1, 3, 7 against 1, 2, 3 are first, second and third in both: nothing differs.
    const week = [wset('w1', 'e', 1), wset('w3', 'e', 3), wset('w7', 'e', 7)]
    const d = diffBetween([ex, week], [ex, sets('e', 3)])
    expect([...flagsOf(d, 'e').sets.values()].every((f) => !f.added && !f.weight && !f.reps && !f.rir && !f.kind)).toBe(true)
    expect(flagsOf(d, 'e').removedHeads).toEqual([])
  })

  it('the heads are ranked by set number, however the rows come in', () => {
    const source = [wset('s1', 'e', 1, { targetWeight: 100 }), wset('s2', 'e', 2, { targetWeight: 105 })]
    const week = [wset('w2', 'e', 2, { targetWeight: 105 }), wset('w1', 'e', 1, { targetWeight: 100 })]
    const d = diffBetween([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'w1')?.weight).toBe(false)
    expect(setFlags(d, 'e', 'w2')?.weight).toBe(false)
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
    const d = diffBetween([ex, week], [ex, source])
    expect(setFlags(d, 'e', 'w1a')).toMatchObject({ weight: false, added: false })
    expect(setFlags(d, 'e', 'w1c')).toMatchObject({ weight: true, added: false }) // matched with stage 3, not with the second stage
    expect(setFlags(d, 'e', 'w1d')?.added).toBe(true)
    expect(flagsOf(d, 'e').removedStages.get('w1')).toEqual([
      { ordinal: 1, stageIndex: 2, isWarmup: false, numbers: { repMin: 8, repMax: 8, isAmrap: false, targetWeight: 60, targetRir: 2 } },
    ])
  })

  it('the stages of a set the source doesn\'t have are added with it', () => {
    const week = [wset('w1', 'e', 1), wset('w2', 'e', 2, { stageKind: 'rest_pause' }), stage('w2a', 'w2', 'e', 1)]
    const d = diffBetween([ex, week], [ex, sets('e', 1)])
    expect(setFlags(d, 'e', 'w2')?.added).toBe(true)
    expect(setFlags(d, 'e', 'w2a')?.added).toBe(true)
  })

  it('the stages of a set the week no longer has go with it: one removed set, no removed stages of their own', () => {
    const source = [wset('s1', 'e', 1), wset('s2', 'e', 2, { stageKind: 'dropset' }), stage('s2a', 's2', 'e', 1), stage('s2b', 's2', 'e', 2)]
    const d = diffBetween([ex, [wset('w1', 'e', 1)]], [ex, source])
    expect(flagsOf(d, 'e').removedHeads.map((r) => [r.ordinal, r.stageIndex])).toEqual([[2, null]])
    expect(flagsOf(d, 'e').removedStages.size).toBe(0)
  })

  it('an added exercise has nothing inside it compared, and a removed one leaves only its line', () => {
    const d = diffBetween([[pe('n', 'n', 0)], sets('n', 2)], [[pe('x', 'x', 0)], sets('x', 2)])
    expect(flagsOf(d, 'n').added).toBe(true)
    expect(flagsOf(d, 'n').sets.size).toBe(0)
    expect(d.removedExercises).toHaveLength(1)
  })
})

// ─── Set kinds ───────────────────────────────────────────────────────────────

describe('diffWeek — set kinds (warmup, staged and its kind)', () => {
  const ex = [pe('e', 'bench', 0)]
  const staged = (kind: WeekPlanSet['stageKind']) => [wset('h', 'e', 1, { stageKind: kind }), stage('hs', 'h', 'e', 1)]

  it('a changed stage kind flags the set\'s kind', () => {
    const d = diffBetween([ex, staged('rest_pause')], [ex, staged('dropset')])
    expect(setFlags(d, 'e', 'h')?.kind).toBe(true)
  })

  it('a null kind on a set with stages reads as a dropset, as the row shows it', () => {
    const d = diffBetween([ex, staged(null)], [ex, staged('dropset')])
    expect(setFlags(d, 'e', 'h')?.kind).toBe(false)
  })

  it('a stage kind on a set without stages shows nowhere, so it is not a difference', () => {
    const d = diffBetween([ex, [wset('h', 'e', 1, { stageKind: 'cluster' })]], [ex, [wset('h', 'e', 1, { stageKind: null })]])
    expect(setFlags(d, 'e', 'h')?.kind).toBe(false)
  })

  it('a warmup against a working set, and a plain set that gains stages, are kind changes', () => {
    const warm = diffBetween([ex, [wset('h', 'e', 1, { isWarmup: true, targetRir: null })]], [ex, [wset('h', 'e', 1)]])
    expect(setFlags(warm, 'e', 'h')?.kind).toBe(true)
    const gained = diffBetween([ex, staged('dropset')], [ex, [wset('h', 'e', 1)]])
    expect(setFlags(gained, 'e', 'h')?.kind).toBe(true)
    expect(setFlags(gained, 'e', 'hs')?.added).toBe(true)
  })

  it('a stage kind that differs does not flag the numbers, and numbers that differ do not flag the kind', () => {
    const k = diffBetween([ex, staged('myo_reps')], [ex, staged('dropset')])
    expect(setFlags(k, 'e', 'h')).toMatchObject({ kind: true, weight: false, reps: false, rir: false })
    const n = diffBetween([ex, [wset('h', 'e', 1, { targetWeight: 90 })]], [ex, [wset('h', 'e', 1)]])
    expect(setFlags(n, 'e', 'h')).toMatchObject({ kind: false, weight: true })
  })
})

// ─── Never compared ──────────────────────────────────────────────────────────

describe('what is never compared: tags, rest, tempo, superset grouping, the unit', () => {
  it('a week that differs from its source only in those has no difference at all', () => {
    const sourceRows = [pe('e', 'bench', 0, { restSeconds: 90, restAfterSeconds: 120, tempo: '3-1-1-0', weightUnit: 'kg', supersetBlockId: null })]
    const weekRows = [pe('e', 'bench', 0, { restSeconds: 150, restAfterSeconds: null, tempo: '2-0-2-0', weightUnit: 'lbs', supersetBlockId: 'block-1' })]
    const sourceSets = [wset('s1', 'e', 1, { tags: ['push here'], programSetId: 'ps-1' }), wset('s2', 'e', 2, { tags: null })]
    const weekSets = [wset('s1', 'e', 1, { tags: null, programSetId: 'ps-9' }), wset('s2', 'e', 2, { tags: ['pause', 'custom tag'] })]
    const d = diffBetween([weekRows, weekSets], [sourceRows, sourceSets])
    expect(flagsOf(d, 'e')).toMatchObject({ added: false, moved: false })
    expect([...flagsOf(d, 'e').sets.values()].every((f) => !f.added && !f.weight && !f.reps && !f.rir && !f.kind)).toBe(true)
    expect(flagsOf(d, 'e').removedHeads).toEqual([])
    expect(d.removedExercises).toEqual([])
  })

  it('weights are compared as stored (kg): the unit chosen to show them can neither cause nor hide a difference', () => {
    // 100 kg is 100 kg whether the exercise shows it as kg or lbs; 100 kg against 100.5 kg differs either way.
    const same = diffBetween([[pe('e', 'bench', 0, { weightUnit: 'lbs' })], sets('e', 1)], [[pe('e', 'bench', 0, { weightUnit: 'kg' })], sets('e', 1)])
    expect(setFlags(same, 'e', 'e-1')?.weight).toBe(false)
    const differ = diffBetween([[pe('e', 'bench', 0, { weightUnit: 'lbs' })], sets('e', 1, { targetWeight: 100.5 })], [[pe('e', 'bench', 0, { weightUnit: 'lbs' })], sets('e', 1)])
    expect(setFlags(differ, 'e', 'e-1')?.weight).toBe(true)
  })
})

// ─── The run's copy ──────────────────────────────────────────────────────────

describe('runCopyToDiffExercises — the run\'s copy as it is now', () => {
  const ex = [pe('e', 'bench', 0)]

  it('a program set with removed_at set is not part of it: the default dropped it', () => {
    const programSets = [
      pset('p1', 'e', 1),
      pset('p2', 'e', 2, { removedAt: '2026-10-01T00:00:00Z' }),
      pset('p3', 'e', 3),
    ]
    const copy = runCopyToDiffExercises(ex, programSets)
    expect(copy[0].heads.map((h) => h.id)).toEqual(['p1', 'p3'])
    // So a week with three sets, compared with it, has one set the default doesn't have.
    const d = diffWeek(weekToDiffExercises(ex, sets('e', 3)), { shape: copy, numbers: null })
    expect(setFlags(d, 'e', 'e-1')?.added).toBe(false)
    expect(setFlags(d, 'e', 'e-2')?.added).toBe(false)
    expect(setFlags(d, 'e', 'e-3')?.added).toBe(true)
    // ... and a week with two sets has nothing removed.
    const two = diffWeek(weekToDiffExercises(ex, sets('e', 2)), { shape: copy, numbers: null })
    expect(flagsOf(two, 'e').removedHeads).toEqual([])
  })

  it('a removed stage, and the stages of a removed head, are not part of it either', () => {
    const programSets = [
      pset('h1', 'e', 1, { stageKind: 'dropset' }),
      pset('h1a', 'e', 1, { parentProgramSetId: 'h1', stageIndex: 1 }),
      pset('h1b', 'e', 1, { parentProgramSetId: 'h1', stageIndex: 2, removedAt: '2026-10-01T00:00:00Z' }),
      pset('h2', 'e', 2, { removedAt: '2026-10-01T00:00:00Z' }),
      pset('h2a', 'e', 2, { parentProgramSetId: 'h2', stageIndex: 1 }),
    ]
    const copy = runCopyToDiffExercises(ex, programSets)
    expect(copy[0].heads.map((h) => [h.id, h.stages.map((s) => s.id)])).toEqual([['h1', ['h1a']]])
  })

  it('heads are in position order and stages in stage order, whatever order they are read in', () => {
    const programSets = [
      pset('b', 'e', 2),
      pset('a1', 'e', 1, { stageKind: 'rest_pause' }),
      pset('a2', 'e', 1, { parentProgramSetId: 'a1', stageIndex: 2 }),
      pset('a1x', 'e', 1, { parentProgramSetId: 'a1', stageIndex: 1 }),
    ]
    const copy = runCopyToDiffExercises(ex, programSets)
    expect(copy[0].heads.map((h) => h.id)).toEqual(['a1', 'b'])
    expect(copy[0].heads[0].stages.map((s) => s.id)).toEqual(['a1x', 'a2'])
  })

  it('it carries rep targets and kinds but no weight or RIR (week plan only)', () => {
    const copy = runCopyToDiffExercises(ex, [pset('p1', 'e', 1, { repMin: 6, repMax: 10, isWarmup: false })])
    expect(copy[0].heads[0]).toMatchObject({ repMin: 6, repMax: 10, targetWeight: null, targetRir: null })
  })

  it('only the sets of each exercise\'s own row are its sets', () => {
    const rows = [pe('e1', 'bench', 0), pe('e2', 'squat', 1)]
    const copy = runCopyToDiffExercises(rows, [pset('p1', 'e1', 1), pset('p2', 'e2', 1), pset('p3', 'e2', 2)])
    expect(copy.map((c) => c.heads.map((h) => h.id))).toEqual([['p1'], ['p2', 'p3']])
  })
})

// ─── Which source ────────────────────────────────────────────────────────────

describe('chooseDiffSources — where each kind of week is compared from', () => {
  const prior = (...weeks: Array<[number, { deload?: boolean; empty?: boolean }?]>) =>
    weeks.map(([weekNumber, o]) => ({ weekNumber, isDeload: o?.deload ?? false, isEmpty: o?.empty ?? false }))
  const choose = (over: Partial<Parameters<typeof chooseDiffSources>[0]>) =>
    chooseDiffSources({ planningType: 'week_dependent', weekNumber: 3, weekStart: 'copy', isDeload: false, priorWeeks: prior([1], [2]), ...over })

  it('a week-dependent week is compared with last week for everything', () => {
    expect(choose({})).toEqual({ shape: { kind: 'week', weekNumber: 2 }, numbers: { kind: 'week', weekNumber: 2 } })
  })

  it('a stable week: sets, structure and reps against the run\'s copy, weights and RIR against last week', () => {
    expect(choose({ planningType: 'stable' })).toEqual({ shape: { kind: 'runCopy' }, numbers: { kind: 'week', weekNumber: 2 } })
  })

  it('week 1, either type: the run\'s copy as it is now, reps included; weights and RIR are not compared', () => {
    for (const planningType of ['week_dependent', 'stable'] as const) {
      expect(choose({ planningType, weekNumber: 1, priorWeeks: [] })).toEqual({ shape: { kind: 'runCopy' }, numbers: { kind: 'none' } })
    }
  })

  it('last week is the last normal, non-empty occurrence: deload and empty ones are skipped (weekSources.ts\'s search)', () => {
    const priorWeeks = prior([1], [2, { deload: true }], [3, { empty: true }])
    expect(choose({ weekNumber: 4, priorWeeks })).toEqual({ shape: { kind: 'week', weekNumber: 1 }, numbers: { kind: 'week', weekNumber: 1 } })
    // Only weeks before this one count (a past week is compared with what came before it).
    expect(choose({ weekNumber: 2, priorWeeks: prior([1], [2], [3]) })).toEqual({ shape: { kind: 'week', weekNumber: 1 }, numbers: { kind: 'week', weekNumber: 1 } })
  })

  it('nothing is compared: a deload session, a week with no last week, and a week that started empty (provisional 84)', () => {
    const none = { shape: { kind: 'none' }, numbers: { kind: 'none' } }
    expect(choose({ isDeload: true })).toEqual(none)
    expect(choose({ isDeload: true, weekNumber: 1, priorWeeks: [] })).toEqual(none)
    expect(choose({ priorWeeks: [] })).toEqual(none)
    expect(choose({ priorWeeks: prior([1, { deload: true }], [2, { empty: true }]) })).toEqual(none)
    expect(choose({ weekStart: 'empty' })).toEqual(none)
  })

  it('the "empty" setting touches only a week-dependent week after week 1', () => {
    expect(choose({ weekStart: 'empty', weekNumber: 1, priorWeeks: [] }).shape).toEqual({ kind: 'runCopy' })
    expect(choose({ weekStart: 'empty', planningType: 'stable' })).toEqual({ shape: { kind: 'runCopy' }, numbers: { kind: 'week', weekNumber: 2 } })
  })

  it('a stable week with no last week still compares its sets, structure and reps with the default, but not its numbers', () => {
    expect(choose({ planningType: 'stable', priorWeeks: [] })).toEqual({ shape: { kind: 'runCopy' }, numbers: { kind: 'none' } })
  })

  it('only a source that is the run\'s copy needs it read', () => {
    expect(needsRunCopy(choose({}))).toBe(false)
    expect(needsRunCopy(choose({ planningType: 'stable' }))).toBe(true)
    expect(needsRunCopy(choose({ weekNumber: 1, priorWeeks: [] }))).toBe(true)
    expect(needsRunCopy(choose({ isDeload: true, weekNumber: 1, priorWeeks: [] }))).toBe(false)
  })
})

describe('weeksOfSlot / plannedWeekRecords — a slot\'s own history', () => {
  it('a sequence run\'s repeated workout is two histories: the same workout at another position is not this slot', () => {
    const a0 = plan(1, [], [], { sequencePosition: 0, id: 'a0' })
    const a2 = plan(1, [], [], { sequencePosition: 2, id: 'a2' })
    const b1 = plan(1, [], [], { workoutDayId: 'wd-b', sequencePosition: 1, id: 'b1' })
    expect(weeksOfSlot([a0, a2, b1], 'wd-1', 0).map((w) => w.id)).toEqual(['a0'])
    expect(weeksOfSlot([a0, a2, b1], 'wd-1', 2).map((w) => w.id)).toEqual(['a2'])
    expect(weeksOfSlot([a0, a2, b1], 'wd-b', 1).map((w) => w.id)).toEqual(['b1'])
  })

  it('a weekday row (no sequence position, or null) is the slot with position null', () => {
    const noField = plan(1, [], [], { id: 'x' })
    const nul = plan(2, [], [], { id: 'y', sequencePosition: null })
    const seq = plan(3, [], [], { id: 'z', sequencePosition: 0 })
    expect(weeksOfSlot([noField, nul, seq], 'wd-1', null).map((w) => w.id)).toEqual(['x', 'y'])
  })

  it('a week is empty when it has no sets (not when it has no exercises)', () => {
    const withExercisesOnly = plan(1, [pe('e', 'bench', 0)], [])
    const withSets = plan(2, [pe('e', 'bench', 0)], sets('e', 1))
    expect(plannedWeekRecords([withExercisesOnly, withSets])).toEqual([
      { weekNumber: 1, isDeload: false, isEmpty: true },
      { weekNumber: 2, isDeload: false, isEmpty: false },
    ])
  })
})

// ─── The whole decision ──────────────────────────────────────────────────────

describe('computeWeekDiff — a week against its sources', () => {
  const ex = [pe('e', 'bench', 0)]
  const base = { planningType: 'week_dependent' as const, weekStart: 'copy' as const }
  const runCopy = (programSets: ProgramSet[], exercises = ex) => ({ exercises, programSets })

  it('a deload session shows no highlighting, whatever it differs by', () => {
    const last = plan(1, ex, sets('e', 3))
    const d = computeWeekDiff({ ...base, weekNumber: 2, week: { isDeload: true, exercises: ex, sets: sets('e', 1, { targetWeight: 50 }) }, slotWeeks: [last], runCopy: null })
    expect(d).toBeNull()
    const w1 = computeWeekDiff({ ...base, weekNumber: 1, week: { isDeload: true, exercises: ex, sets: sets('e', 1) }, slotWeeks: [], runCopy: runCopy([pset('p', 'e', 1), pset('q', 'e', 2)]) })
    expect(w1).toBeNull()
  })

  it('week-dependent: weight, reps and RIR all against last week', () => {
    const last = plan(1, ex, sets('e', 1))
    const week = { isDeload: false, exercises: ex, sets: [wset('e-1', 'e', 1, { targetWeight: 105, repMin: 6, repMax: 6, targetRir: 1 })] }
    const d = computeWeekDiff({ ...base, weekNumber: 2, week, slotWeeks: [last, plan(2, ex, week.sets)], runCopy: null })!
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: true, reps: true, rir: true })
  })

  it('stable: a rep target equal to last week\'s but not the default\'s IS highlighted; the reverse is not', () => {
    // Default: 8 reps. Last week: 10 reps (the user changed it then). This week: 10 / 8.
    const lastWeek = plan(1, ex, [wset('e-1', 'e', 1, { repMin: 10, repMax: 10 }), wset('e-2', 'e', 2, { repMin: 10, repMax: 10 })])
    const thisWeek = [wset('e-1', 'e', 1, { repMin: 10, repMax: 10 }), wset('e-2', 'e', 2, { repMin: 8, repMax: 8 })]
    const d = computeWeekDiff({
      planningType: 'stable', weekStart: 'copy', weekNumber: 2, week: { isDeload: false, exercises: ex, sets: thisWeek },
      slotWeeks: [lastWeek], runCopy: runCopy([pset('p1', 'e', 1, { repMin: 8, repMax: 8 }), pset('p2', 'e', 2, { repMin: 8, repMax: 8 })]),
    })!
    expect(setFlags(d, 'e', 'e-1')?.reps).toBe(true) //  10 = last week's, ≠ the default's 8 → highlighted
    expect(setFlags(d, 'e', 'e-2')?.reps).toBe(false) //  8 = the default's, ≠ last week's 10 → not
  })

  it('stable: weights and RIR against last week, sets and structure against the default', () => {
    // Last week: two sets (100 / RIR 2, and 105 / RIR 2). This week: the first as it was, the second changed, a third the default has no room for.
    const lastWeek = plan(1, ex, [wset('e-1', 'e', 1, { targetWeight: 100, targetRir: 2 }), wset('e-2', 'e', 2, { targetWeight: 105, targetRir: 2 })])
    const thisWeek = [
      wset('e-1', 'e', 1, { targetWeight: 100, targetRir: 2 }),
      wset('e-2', 'e', 2, { targetWeight: 107.5, targetRir: 1 }),
      wset('e-3', 'e', 3, { targetWeight: 100 }),
    ]
    const d = computeWeekDiff({
      planningType: 'stable', weekStart: 'copy', weekNumber: 2, week: { isDeload: false, exercises: ex, sets: thisWeek },
      slotWeeks: [lastWeek], runCopy: runCopy([pset('p1', 'e', 1), pset('p2', 'e', 2)]),
    })!
    // The default has no weights at all: if it were what weights are compared with, set 1 (100 = last week's) would differ.
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: false, rir: false, reps: false, added: false })
    expect(setFlags(d, 'e', 'e-2')).toMatchObject({ weight: true, rir: true, reps: false, added: false })
    // The default has two sets; a third is new.
    expect(setFlags(d, 'e', 'e-3')).toMatchObject({ added: true })
  })

  it('stable: the default is read for structure even when there is no last week; weights and RIR then show nothing', () => {
    const thisWeek = [wset('e-1', 'e', 1, { targetWeight: 80 }), wset('e-2', 'e', 2)]
    const d = computeWeekDiff({
      planningType: 'stable', weekStart: 'copy', weekNumber: 2, week: { isDeload: false, exercises: ex, sets: thisWeek },
      slotWeeks: [], runCopy: runCopy([pset('p1', 'e', 1)]),
    })!
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ weight: false, rir: false })
    expect(setFlags(d, 'e', 'e-2')?.added).toBe(true)
  })

  it('week 1: against the run\'s copy as it is now — a missing exercise is removed, a different rep target is flagged — and never weights or RIR', () => {
    const copyRows = [pe('c-bench', 'bench', 0), pe('c-row', 'row', 1)]
    const copySets = [pset('p1', 'c-bench', 1, { repMin: 8, repMax: 8 }), pset('p2', 'c-row', 1)]
    const weekRows = [pe('e', 'bench', 0)]
    const weekSets = [wset('e-1', 'e', 1, { repMin: 5, repMax: 5, targetWeight: 999, targetRir: 0 })]
    const d = computeWeekDiff({ ...base, weekNumber: 1, week: { isDeload: false, exercises: weekRows, sets: weekSets }, slotWeeks: [], runCopy: runCopy(copySets, copyRows) })!
    expect(d.removedExercises).toEqual([{ exerciseId: 'row', name: 'ROW', after: 'e' }])
    expect(setFlags(d, 'e', 'e-1')).toMatchObject({ reps: true, weight: false, rir: false })
  })

  it('week 1 waits for the run\'s copy: until it is read, nothing is flagged', () => {
    const d = computeWeekDiff({ ...base, weekNumber: 1, week: { isDeload: false, exercises: ex, sets: sets('e', 1) }, slotWeeks: [], runCopy: null })
    expect(d).toBeNull()
  })

  it('a week that started empty (the setting) is compared with nothing', () => {
    const last = plan(2, ex, sets('e', 3))
    const week = { isDeload: false, exercises: ex, sets: sets('e', 1, { targetWeight: 1 }) }
    expect(computeWeekDiff({ ...base, weekStart: 'empty', weekNumber: 3, week, slotWeeks: [last], runCopy: null })).toBeNull()
    expect(computeWeekDiff({ ...base, weekStart: 'copy', weekNumber: 3, week, slotWeeks: [last], runCopy: null })).not.toBeNull()
  })

  it('a week with no last week (nothing planned before, or only deload and empty weeks) shows no highlighting', () => {
    const week = { isDeload: false, exercises: ex, sets: sets('e', 1) }
    expect(computeWeekDiff({ ...base, weekNumber: 3, week, slotWeeks: [], runCopy: null })).toBeNull()
    expect(computeWeekDiff({ ...base, weekNumber: 3, week, slotWeeks: [plan(1, ex, sets('e', 1), { isDeload: true }), plan(2, ex, [])], runCopy: null })).toBeNull()
  })

  it('last week is the last normal occurrence, skipping a deload week between (weekSources.ts\'s search), and the viewed week itself is never its own source', () => {
    const w1 = plan(1, ex, sets('e', 1, { targetWeight: 100 }))
    const w2 = plan(2, ex, sets('e', 1, { targetWeight: 50 }), { isDeload: true })
    const w3Sets = sets('e', 1, { targetWeight: 100 })
    const w3 = plan(3, ex, w3Sets)
    const d = computeWeekDiff({ ...base, weekNumber: 3, week: { isDeload: false, exercises: ex, sets: w3Sets }, slotWeeks: [w1, w2, w3], runCopy: null })!
    // Against week 1 (100), not the deload week 2 (50), and not itself.
    expect(setFlags(d, 'e', 'e-1')?.weight).toBe(false)
  })

  it('past weeks are compared the same way, with what came before them', () => {
    const w1 = plan(1, ex, sets('e', 1, { targetWeight: 100 }))
    const w2 = plan(2, ex, sets('e', 1, { targetWeight: 110 }))
    const w3 = plan(3, ex, sets('e', 1, { targetWeight: 120 }))
    const d = computeWeekDiff({ ...base, weekNumber: 2, week: { isDeload: false, exercises: ex, sets: w2.sets }, slotWeeks: [w1, w2, w3], runCopy: null })!
    expect(setFlags(d, 'e', 'e-1')?.weight).toBe(true) // 110 against week 1's 100 — week 3 (a later week) is never a source
  })
})
