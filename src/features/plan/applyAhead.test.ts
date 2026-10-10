import { describe, it, expect } from 'vitest'
import type { WeekPlan, ProgramExercise, WeekPlanSet } from '../../types'
import {
  slotIdOf,
  setPositionOf,
  laterPlannedWeeks,
  allPlannedWeeks,
  planApplyAhead,
  planApplyAheadBundle,
  summarizeApplyAhead,
  sortedGroupsFor,
  type ChangeRecord,
  type WeekApplyResult,
} from './applyAhead'

// Chunk 20 — exhaustive unit tests for applyAhead.ts's pure core (reviewer's
// note 1: "Unit-test the pure part exhaustively"). One describe block per
// edit type from the report's table, plus the shared matching rule (slot
// identity, exercise identity, deload skip, "touch nothing else") and the
// two selector helpers. Fixtures are minimal — only the fields each test
// actually reads — following this codebase's existing "hand-built fixture"
// convention (WeekPlan/ProgramExercise/WeekPlanSet's own optional-field
// comments).
//
// Review fix (first review): two bugs here.
//   1. A swap applied ahead used to create a FRESH week-only program
//      exercise per later week, so a follow-up edit on the edited week's
//      own (shared) id could never again find them. Fixed: the swap change
//      record carries the edited week's own resultingProgramExerciseId;
//      applying it ahead repoints each matched later week at that SAME
//      row (ApplyAheadOp 'repointExercise', never a second insert).
//   2. Slot identity (the carry mapping) alone could still match a row
//      that has since diverged to a DIFFERENT exercise in a later week (an
//      "only this week" swap there deliberately keeps the ORIGINAL
//      identity in carry, for copying's sake — not because that week's
//      CURRENT occupant still is that exercise). Fixed: every edit type
//      but addExercise/reorderExercise also requires the matched row's
//      current exerciseId to equal the edited row's own (pre-edit)
//      exerciseId.

// ─── Fixture factories ──────────────────────────────────────────────────────

function pe(id: string, overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return {
    id,
    workoutDayId: 'wd-1',
    userId: 'user-1',
    exerciseId: `ex-${id}`,
    position: 0,
    weightUnit: null,
    ...overrides,
  }
}

function set(id: string, programExerciseId: string, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id,
    weekPlanId: 'wp-x',
    userId: 'user-1',
    programExerciseId,
    setNumber: 1,
    targetRir: null,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
    ...overrides,
  }
}

function week(
  weekNumber: number,
  overrides: Partial<WeekPlan> & { exercises: ProgramExercise[]; sets: WeekPlanSet[] },
): WeekPlan {
  return {
    id: `wp-${weekNumber}`,
    userId: 'user-1',
    mesocycleId: 'meso-1',
    workoutDayId: 'wd-1',
    weekNumber,
    isDeload: false,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── slotIdOf ────────────────────────────────────────────────────────────────

describe('slotIdOf', () => {
  it('falls back to the row id when there is no carry override', () => {
    expect(slotIdOf(pe('pe-1'))).toBe('pe-1')
  })

  it('uses carryProgramExerciseId when set (an only-this-week swap/reorder\'s pre-edit slot)', () => {
    expect(slotIdOf(pe('pe-1-swapped', { carryProgramExerciseId: 'pe-1-original' }))).toBe('pe-1-original')
  })

  it('a program-tab row (no carry concept) collapses to its own id — undefined ?? id === id', () => {
    expect(slotIdOf({ id: 'pe-program-1' })).toBe('pe-program-1')
  })

  it('null carry (explicit, not undefined) also falls back to the row id', () => {
    expect(slotIdOf(pe('pe-1', { carryProgramExerciseId: null }))).toBe('pe-1')
  })
})

// ─── setPositionOf ───────────────────────────────────────────────────────────

describe('setPositionOf', () => {
  it('finds a head by its 1-based rank in the sorted groups', () => {
    const sets = [set('s1', 'pe-1', { setNumber: 1 }), set('s2', 'pe-1', { setNumber: 2 })]
    const groups = sortedGroupsFor(sets, 'pe-1')
    expect(setPositionOf(groups, 's1')).toEqual({ headOrdinal: 1, stageIndex: null })
    expect(setPositionOf(groups, 's2')).toEqual({ headOrdinal: 2, stageIndex: null })
  })

  it('finds a stage by its head\'s ordinal plus its own stage_index', () => {
    const sets = [
      set('h1', 'pe-1', { setNumber: 1 }),
      set('st1', 'pe-1', { setNumber: 1, parentWeekPlanSetId: 'h1', stageIndex: 1 }),
      set('h2', 'pe-1', { setNumber: 2 }),
    ]
    const groups = sortedGroupsFor(sets, 'pe-1')
    expect(setPositionOf(groups, 'st1')).toEqual({ headOrdinal: 1, stageIndex: 1 })
    expect(setPositionOf(groups, 'h2')).toEqual({ headOrdinal: 2, stageIndex: null })
  })

  it('returns null for an id that is not in any group', () => {
    const groups = sortedGroupsFor([set('s1', 'pe-1')], 'pe-1')
    expect(setPositionOf(groups, 'does-not-exist')).toBeNull()
  })

  it('ranks by set_number ascending, not by input array order (matches PlanPage.tsx\'s own display order)', () => {
    // Deliberately out of order in the input array.
    const sets = [set('s2', 'pe-1', { setNumber: 2 }), set('s1', 'pe-1', { setNumber: 1 })]
    const groups = sortedGroupsFor(sets, 'pe-1')
    expect(setPositionOf(groups, 's1')).toEqual({ headOrdinal: 1, stageIndex: null })
    expect(setPositionOf(groups, 's2')).toEqual({ headOrdinal: 2, stageIndex: null })
  })
})

// ─── Candidate-week selectors ────────────────────────────────────────────────

describe('laterPlannedWeeks', () => {
  it('only weeks strictly after the edited one, for the same workout, in week-number order', () => {
    const weeks = [
      week(3, { exercises: [], sets: [], workoutDayId: 'wd-1' }),
      week(1, { exercises: [], sets: [], workoutDayId: 'wd-1' }),
      week(2, { exercises: [], sets: [], workoutDayId: 'wd-2' }), // different workout
      week(2, { exercises: [], sets: [], workoutDayId: 'wd-1', id: 'wp-2-wd1' }),
    ]
    expect(laterPlannedWeeks(weeks, 'wd-1', 1).map((w) => w.weekNumber)).toEqual([2, 3])
  })

  it('an empty week (zero exercises) still counts as planned — it has a row', () => {
    const weeks = [week(2, { exercises: [], sets: [], workoutDayId: 'wd-1' })]
    expect(laterPlannedWeeks(weeks, 'wd-1', 1)).toHaveLength(1)
  })

  it('excludes the edited week itself and earlier weeks', () => {
    const weeks = [week(1, { exercises: [], sets: [] }), week(2, { exercises: [], sets: [] })]
    expect(laterPlannedWeeks(weeks, 'wd-1', 2)).toHaveLength(0)
  })

  // Chunk 25 (reviewer's note 3 — "Apply-ahead... match by slot for
  // sequence runs. Say how sequence_position enters their slot identity,
  // and test it").
  describe('slot identity (chunk 25 — sequence_position)', () => {
    it('a weekday run (sequence_position always null) is unaffected — omitting the new parameter still matches', () => {
      const weeks = [week(2, { exercises: [], sets: [], workoutDayId: 'wd-1' })]
      expect(laterPlannedWeeks(weeks, 'wd-1', 1)).toHaveLength(1)
    })

    it('workoutDayId alone is NOT enough once a cycle can repeat a workout (R16, SPEC G8) — a later week\'s row at a DIFFERENT slot is excluded', () => {
      const weeks = [
        week(2, { exercises: [], sets: [], workoutDayId: 'wd-a', sequencePosition: 0 }),
        week(2, { exercises: [], sets: [], workoutDayId: 'wd-a', sequencePosition: 2, id: 'wp-2-slot2' }),
      ]
      // Editing slot 0's own occurrence in cycle 1 must only reach slot
      // 0's own later row, never slot 2's (same workout, different slot).
      expect(laterPlannedWeeks(weeks, 'wd-a', 1, 0).map((w) => w.id)).toEqual(['wp-2'])
    })

    it('the matching slot (same workoutDayId AND sequence_position) is found regardless of the OTHER slot\'s presence', () => {
      const weeks = [
        week(2, { exercises: [], sets: [], workoutDayId: 'wd-a', sequencePosition: 0 }),
        week(2, { exercises: [], sets: [], workoutDayId: 'wd-a', sequencePosition: 2, id: 'wp-2-slot2' }),
      ]
      expect(laterPlannedWeeks(weeks, 'wd-a', 1, 2).map((w) => w.id)).toEqual(['wp-2-slot2'])
    })

    it('a pre-chunk-25 fixture with sequence_position simply absent (undefined) is treated as null, same as an explicit weekday row', () => {
      const weeks = [week(2, { exercises: [], sets: [], workoutDayId: 'wd-1' })] // sequencePosition never set
      expect(laterPlannedWeeks(weeks, 'wd-1', 1, null)).toHaveLength(1)
    })
  })
})

describe('allPlannedWeeks', () => {
  it('every planned week for the workout, regardless of number (program-tab edits have no "edited week")', () => {
    const weeks = [
      week(1, { exercises: [], sets: [] }),
      week(2, { exercises: [], sets: [] }),
      week(1, { exercises: [], sets: [], workoutDayId: 'wd-2', id: 'wp-other' }),
    ]
    expect(allPlannedWeeks(weeks, 'wd-1').map((w) => w.weekNumber)).toEqual([1, 2])
  })

  // Chunk 25 (reviewer's note 3) — deliberately NOT scoped by slot, unlike
  // laterPlannedWeeks above: a stable program's volume is rebuilt fresh
  // from the program at plan time regardless of slot, so a Program-tab
  // volume edit must reach EVERY slot's own row for that workout, not just
  // one (see this function's own header comment for the full reasoning).
  it('a stable sequence program: a Program-tab edit reaches BOTH slots of a repeated workout, not just one', () => {
    const weeks = [
      week(2, { exercises: [], sets: [], workoutDayId: 'wd-a', sequencePosition: 0 }),
      week(2, { exercises: [], sets: [], workoutDayId: 'wd-a', sequencePosition: 2, id: 'wp-2-slot2' }),
    ]
    expect(allPlannedWeeks(weeks, 'wd-a').map((w) => w.id)).toEqual(['wp-2', 'wp-2-slot2'])
  })
})

// ─── Value edits: weightTarget / rir / repTarget / tags / stageKind / warmup

describe('weightTarget', () => {
  const change: ChangeRecord = {
    editType: 'weightTarget',
    slotId: 'pe-1',
    exerciseId: 'ex-pe-1',
    setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: 60,
    newValue: 70,
  }

  it('applies: writes targetWeight on the matched head only', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1', { setNumber: 1 })] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({
      weekPlanId: 'wp-2',
      weekNumber: 2,
      status: 'applied',
      ops: [{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { targetWeight: 70 } }],
    })
  })

  it('matches through a later week\'s own carry (its slot survived an earlier only-this-week swap there) when the exercise still agrees', () => {
    const w = week(2, {
      exercises: [pe('pe-1-weekonly', { exerciseId: 'ex-pe-1', carryProgramExerciseId: 'pe-1' })],
      sets: [set('s1', 'pe-1-weekonly', { setNumber: 1 })],
    })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
  })

  it('skips structurally when the slot does not exist in the later week', () => {
    const w = week(2, { exercises: [pe('pe-OTHER')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  // Review fix (bug 2) — break-proof target: the slot matches by identity,
  // but that week's row has since diverged to a DIFFERENT exercise (e.g. an
  // "only this week" swap there kept the original slot in carry so copying
  // reverts to it, but today it genuinely is something else) — the edit
  // must not land on it.
  it('skips structurally when the slot matches but the later week\'s row has diverged to a different exercise', () => {
    const w = week(2, {
      exercises: [pe('pe-1-diverged', { exerciseId: 'ex-OTHER', carryProgramExerciseId: 'pe-1' })],
      sets: [set('s1', 'pe-1-diverged', { setNumber: 1 })],
    })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips structurally when the slot exists but has fewer heads than the edited position', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [] }) // zero heads; change targets ordinal 1
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips deload sessions, counted separately from a structural skip', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')], isDeload: true })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'deload' })
  })

  // Chunk 22, reviewer's note 8 — "Apply-ahead keeps skipping deload
  // sessions. A rules-calculated session is deload, so it's skipped." This
  // module decides purely from WeekPlan.isDeload; it has no notion of
  // whether rules produced a week's current sets or a user planned them by
  // hand, so the SAME skip above already covers a rules-calculated week —
  // this fixture just makes that explicit: sets/weight shaped exactly like
  // a deload calculation's own output (fewer sets, a reduced weight) still
  // skip, never "applies because the numbers look different now".
  it('still skips a week whose CURRENT sets were produced by the deload-rules calculator (chunk 22), not hand-planned', () => {
    const calculatedLikeSet = set('s1', 'pe-1', { setNumber: 1, targetWeight: 72.5 }) // e.g. 90% down-rounded
    const w = week(2, { exercises: [pe('pe-1')], sets: [calculatedLikeSet], isDeload: true })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'deload' })
  })

  it('a stage position (non-null stageIndex) resolves to the stage row, not its head', () => {
    const stageChange: ChangeRecord = { ...change, setPosition: { headOrdinal: 1, stageIndex: 1 } }
    const w = week(2, {
      exercises: [pe('pe-1')],
      sets: [set('h1', 'pe-1', { setNumber: 1 }), set('stg1', 'pe-1', { setNumber: 1, parentWeekPlanSetId: 'h1', stageIndex: 1 })],
    })
    const [result] = planApplyAhead(stageChange, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') expect(result.ops[0]).toMatchObject({ setId: 'stg1' })
  })

  it('skips structurally when the exact stage index is missing on an otherwise-matching head', () => {
    const stageChange: ChangeRecord = { ...change, setPosition: { headOrdinal: 1, stageIndex: 2 } }
    const w = week(2, {
      exercises: [pe('pe-1')],
      sets: [set('h1', 'pe-1', { setNumber: 1 }), set('stg1', 'pe-1', { setNumber: 1, parentWeekPlanSetId: 'h1', stageIndex: 1 })],
    })
    const [result] = planApplyAhead(stageChange, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  // Reviewer's note 3 — "touch nothing else": a week with several exercises
  // and several sets each only ever yields ONE op, targeting exactly the
  // matched set, whatever else is in the week.
  it('touches nothing else: exactly one op, for exactly the matched set, however much else is in the week', () => {
    const w = week(2, {
      exercises: [pe('pe-OTHER-A'), pe('pe-1'), pe('pe-OTHER-B')],
      sets: [
        set('other-a-1', 'pe-OTHER-A', { setNumber: 1 }),
        set('s1', 'pe-1', { setNumber: 1 }),
        set('s2', 'pe-1', { setNumber: 2 }),
        set('other-b-1', 'pe-OTHER-B', { setNumber: 1 }),
      ],
    })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      expect(result.ops).toHaveLength(1)
      expect(result.ops[0]).toEqual({ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { targetWeight: 70 } })
    }
  })
})

describe('rir', () => {
  it('applies: writes targetRir only', () => {
    const change: ChangeRecord = {
      editType: 'rir',
      slotId: 'pe-1',
      exerciseId: 'ex-pe-1',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: 3,
      newValue: 1,
    }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { targetRir: 1 } }])
  })

  it('a null newValue (RIR cleared) is written as null, not skipped', () => {
    const change: ChangeRecord = {
      editType: 'rir',
      slotId: 'pe-1',
      exerciseId: 'ex-pe-1',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: 3,
      newValue: null,
    }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops[0]).toMatchObject({ changes: { targetRir: null } })
  })
})

describe('repTarget', () => {
  it('applies: writes repMin/repMax/isAmrap together', () => {
    const change: ChangeRecord = {
      editType: 'repTarget',
      slotId: 'pe-1',
      exerciseId: 'ex-pe-1',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: { repMin: 8, repMax: 12, isAmrap: false },
      newValue: { repMin: 6, repMax: 10, isAmrap: false },
    }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') {
      expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { repMin: 6, repMax: 10, isAmrap: false } }])
    } else {
      throw new Error('expected applied')
    }
  })
})

describe('tags', () => {
  it('applies: writes tags on the matched head only (heads only, by construction of the change record)', () => {
    const change: ChangeRecord = {
      editType: 'tags',
      slotId: 'pe-1',
      exerciseId: 'ex-pe-1',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: null,
      newValue: ['last_set'],
    }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { tags: ['last_set'] } }])
  })
})

describe('stageKind', () => {
  it('applies: writes stageKind on the matched head only', () => {
    const change: ChangeRecord = {
      editType: 'stageKind',
      slotId: 'pe-1',
      exerciseId: 'ex-pe-1',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: null,
      newValue: 'rest_pause',
    }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('h1', 'pe-1'), set('stg1', 'pe-1', { parentWeekPlanSetId: 'h1', stageIndex: 1 })] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 'h1', changes: { stageKind: 'rest_pause' } }])
  })
})

// Review fix item 3 — chunk 15's WARMUP toggle, not in the brief's original
// enumerated list; SPEC names no exception for it ("offered when a week is
// edited and later weeks are already planned").
describe('warmup', () => {
  const change: ChangeRecord = {
    editType: 'warmup',
    slotId: 'pe-1',
    exerciseId: 'ex-pe-1',
    setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: false,
    newValue: true,
  }

  it('applies: writes isWarmup on the matched head only', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { isWarmup: true } }])
  })

  it('skips structurally when the matched row has diverged to a different exercise', () => {
    const w = week(2, { exercises: [pe('pe-1', { exerciseId: 'ex-OTHER' })], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

// ─── swapExercise (chunk 9) ─────────────────────────────────────────────────

describe('swapExercise', () => {
  const change: ChangeRecord = {
    editType: 'swapExercise',
    slotId: 'pe-1',
    exerciseId: 'ex-pe-1', // the PRE-swap real exercise — what later weeks still show
    newExerciseId: 'ex-replacement',
    resultingProgramExerciseId: 'pe-1-replacement', // the edited week's OWN resulting row
  }

  it('applies: repoints using the LATER week\'s own current programExerciseId, at the SAME resulting row for every week (review fix — never a fresh row per week)', () => {
    // This later week's own row is itself a week-only replacement from an
    // earlier only-this-week swap there — its own current id ('pe-1-local')
    // differs from the canonical slotId ('pe-1'), but its carry still
    // traces back to the same slot, and its own exercise still agrees.
    const w = week(2, { exercises: [pe('pe-1-local', { exerciseId: 'ex-pe-1', carryProgramExerciseId: 'pe-1' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      expect(result.ops).toEqual([
        { kind: 'repointExercise', weekPlanId: 'wp-2', fromProgramExerciseId: 'pe-1-local', toProgramExerciseId: 'pe-1-replacement' },
      ])
    }
  })

  it('review fix (bug 1): applied to two later weeks, BOTH repoint at the identical resulting row — never two different fresh rows', () => {
    const w2 = week(2, { exercises: [pe('pe-1')], sets: [] })
    const w3 = week(3, { exercises: [pe('pe-1')], sets: [] })
    const [r2, r3] = planApplyAhead(change, [w2, w3])
    expect(r2.status).toBe('applied')
    expect(r3.status).toBe('applied')
    if (r2.status === 'applied' && r3.status === 'applied') {
      // Same resulting row referenced by both weeks' own ops (only
      // weekPlanId differs, as it must) — this is exactly what makes a
      // FOLLOW-UP edit on that row findable in every week afterward (see
      // the "follow-up edit" test below) — the bug this fixes was a fresh,
      // distinct row created per week instead.
      expect(r2.ops[0]).toMatchObject({ toProgramExerciseId: 'pe-1-replacement' })
      expect(r3.ops[0]).toMatchObject({ toProgramExerciseId: 'pe-1-replacement' })
      expect(r2.ops[0]).toEqual({ ...r3.ops[0], weekPlanId: 'wp-2' })
    }
  })

  it('review fix (bug 1): a follow-up edit on the edited week\'s OWN resulting id finds a later week that already got the swap applied', () => {
    // Simulates: week 1 swapped and applied ahead to week 2 (both now point
    // at 'pe-1-replacement', per repointExercise, never two distinct rows).
    // A SECOND, follow-up edit (e.g. a weight change) on 'pe-1-replacement'
    // must still find week 2.
    const week2AfterSwapAhead = week(2, { exercises: [pe('pe-1-replacement', { exerciseId: 'ex-replacement' })], sets: [set('s1', 'pe-1-replacement')] })
    const followUp: ChangeRecord = {
      editType: 'weightTarget',
      slotId: 'pe-1-replacement', // the edited week's own row has no carry after a permanent swap
      exerciseId: 'ex-replacement',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: null,
      newValue: 80,
    }
    const [result] = planApplyAhead(followUp, [week2AfterSwapAhead])
    expect(result.status).toBe('applied')
  })

  it('skips structurally when the slot does not exist', () => {
    const w = week(2, { exercises: [pe('pe-OTHER')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  // Review fix (bug 2) — break-proof target: week 3 did its OWN "only this
  // week" swap at this slot (to a DIFFERENT real exercise, carry pointing
  // back to the same slot) — a permanent swap-ahead must not overwrite that
  // one-off; it must skip this week, not repoint it.
  it('skips structurally when the later week\'s own row has already diverged to a different exercise (an "only this week" swap there)', () => {
    const w = week(2, { exercises: [pe('pe-1-oneoff', { exerciseId: 'ex-SOMETHING-ELSE', carryProgramExerciseId: 'pe-1' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  // Break-proof #1 (report): matching MUST be by slot identity, never by
  // array position. Two weeks whose exercise arrays put different things at
  // index 0 prove it: the matched week's "pe-1" is at index 1, not 0, and a
  // position-based matcher would wrongly grab (or wrongly skip) it.
  it('matches by identity, not by array position (break-proof #1)', () => {
    const w = week(2, { exercises: [pe('pe-DECOY'), pe('pe-1')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') expect(result.ops[0]).toMatchObject({ fromProgramExerciseId: 'pe-1' })
  })
})

// ─── removeExercise / addExercise (chunk 9, and stable program-tab) ────────

describe('removeExercise', () => {
  const change: ChangeRecord = { editType: 'removeExercise', slotId: 'pe-1', exerciseId: 'ex-pe-1' }

  it('applies: removes the later week\'s own current row for the matched slot', () => {
    const w = week(2, { exercises: [pe('pe-1-local', { exerciseId: 'ex-pe-1', carryProgramExerciseId: 'pe-1' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'removeExercise', weekPlanId: 'wp-2', programExerciseId: 'pe-1-local' }])
  })

  it('skips structurally when already absent (e.g. that week already removed/swapped it)', () => {
    const w = week(2, { exercises: [], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  // Review fix (bug 2): a one-off diverged row at this slot must not be
  // removed — it isn't the exercise this remove was ever about.
  it('skips structurally when the later week\'s own row has diverged to a different exercise', () => {
    const w = week(2, { exercises: [pe('pe-1-oneoff', { exerciseId: 'ex-SOMETHING-ELSE', carryProgramExerciseId: 'pe-1' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

describe('addExercise', () => {
  const change: ChangeRecord = { editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' }

  it('applies even to a week whose exercise list already differs completely — only a deload week skips', () => {
    const w = week(2, { exercises: [pe('pe-X'), pe('pe-Y')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      // Appended at THIS week's own current end (2 existing -> position 2),
      // not the edited week's own recorded position.
      expect(result.ops).toEqual([{ kind: 'addExercise', weekPlanId: 'wp-2', workoutDayId: 'wd-1', exerciseId: 'ex-new', position: 2 }])
    }
  })

  it('a later week with zero exercises appends at position 0', () => {
    const w = week(2, { exercises: [], sets: [] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops[0]).toMatchObject({ position: 0 })
  })

  it('still skips a deload week (the one skip that does apply to an insert)', () => {
    const w = week(2, { exercises: [], sets: [], isDeload: true })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'deload' })
  })
})

// ─── reorderExercise (chunk 9, and stable program-tab) ─────────────────────

describe('reorderExercise', () => {
  it('applies when every moved slot exists AND is at its recorded pre-move position', () => {
    const change: ChangeRecord = {
      editType: 'reorderExercise',
      moves: [
        { slotId: 'pe-1', oldPosition: 0, newPosition: 1 },
        { slotId: 'pe-2', oldPosition: 1, newPosition: 0 },
      ],
    }
    const w = week(2, { exercises: [pe('pe-1', { position: 0 }), pe('pe-2', { position: 1 })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      expect(result.ops).toEqual([
        {
          kind: 'reorderExercises',
          weekPlanId: 'wp-2',
          moves: [
            { programExerciseId: 'pe-1', oldPosition: 0, newPosition: 1 },
            { programExerciseId: 'pe-2', oldPosition: 1, newPosition: 0 },
          ],
        },
      ])
    }
  })

  it('skips the WHOLE week (all-or-nothing) when one moved slot is missing', () => {
    const change: ChangeRecord = {
      editType: 'reorderExercise',
      moves: [
        { slotId: 'pe-1', oldPosition: 0, newPosition: 1 },
        { slotId: 'pe-MISSING', oldPosition: 1, newPosition: 0 },
      ],
    }
    const w = week(2, { exercises: [pe('pe-1', { position: 0 }), pe('pe-2', { position: 1 })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips the whole week when a matched slot exists but has already moved to a different position there', () => {
    const change: ChangeRecord = {
      editType: 'reorderExercise',
      moves: [{ slotId: 'pe-1', oldPosition: 0, newPosition: 1 }],
    }
    // This week's own pe-1 is already at position 2 (it diverged independently).
    const w = week(2, { exercises: [pe('pe-OTHER', { position: 0 }), pe('pe-ANOTHER', { position: 1 }), pe('pe-1', { position: 2 })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('matches regardless of which exercise occupies the slot (reviewer\'s own call — no exerciseId check for reorder)', () => {
    const change: ChangeRecord = {
      editType: 'reorderExercise',
      moves: [{ slotId: 'pe-1', oldPosition: 0, newPosition: 1 }],
    }
    // This week's pe-1 row points at a totally different real exercise —
    // reorder doesn't care, only identity + position.
    const w = week(2, { exercises: [pe('pe-1', { exerciseId: 'ex-SOMETHING-ELSE', position: 0 })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
  })
})

// ─── addStage / removeStage (chunk 14) ─────────────────────────────────────

describe('addStage', () => {
  const change: ChangeRecord = { editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 1 }

  it('applies: appends a stage at this week\'s own fresh next stage_index, not the edited week\'s', () => {
    // This later week's head already has TWO stages (a different history
    // than the edited week had) — the new stage must land at index 3 here,
    // not whatever index it became in the edited week.
    const w = week(2, {
      exercises: [pe('pe-1')],
      sets: [
        set('h1', 'pe-1', { setNumber: 5 }),
        set('stg1', 'pe-1', { setNumber: 5, parentWeekPlanSetId: 'h1', stageIndex: 1 }),
        set('stg2', 'pe-1', { setNumber: 5, parentWeekPlanSetId: 'h1', stageIndex: 2 }),
      ],
    })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      expect(result.ops).toEqual([
        { kind: 'addStage', weekPlanId: 'wp-2', programExerciseId: 'pe-1', parentId: 'h1', setNumber: 5, stageIndex: 3 },
      ])
    }
  })

  it('skips structurally when the matched head ordinal does not exist (fewer heads there)', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips structurally when the matched row has diverged to a different exercise', () => {
    const w = week(2, { exercises: [pe('pe-1', { exerciseId: 'ex-OTHER' })], sets: [set('h1', 'pe-1', { setNumber: 1 })] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

describe('removeStage', () => {
  const change: ChangeRecord = { editType: 'removeStage', slotId: 'pe-1', exerciseId: 'ex-pe-1', setPosition: { headOrdinal: 1, stageIndex: 2 } }

  it('applies: removes exactly the matched stage', () => {
    const w = week(2, {
      exercises: [pe('pe-1')],
      sets: [
        set('h1', 'pe-1'),
        set('stg1', 'pe-1', { parentWeekPlanSetId: 'h1', stageIndex: 1 }),
        set('stg2', 'pe-1', { parentWeekPlanSetId: 'h1', stageIndex: 2 }),
      ],
    })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'removeSet', weekPlanId: 'wp-2', setId: 'stg2' }])
  })

  it('skips structurally when that exact stage index is missing', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('h1', 'pe-1'), set('stg1', 'pe-1', { parentWeekPlanSetId: 'h1', stageIndex: 1 })] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

// ─── removeHeadSet (review fix item 3 — week-level REMOVE SET, any ordinal)

describe('removeHeadSet', () => {
  const change: ChangeRecord = { editType: 'removeHeadSet', slotId: 'pe-1', exerciseId: 'ex-pe-1', headOrdinal: 2 }

  it('applies: removes exactly the matched ordinal, never the trailing one by default', () => {
    // Four heads in this later week; ordinal 2 must be removed, not the
    // trailing (4th) one — the distinguishing behaviour from the
    // program-tab's own removeSet (always trailing).
    const w = week(2, { exercises: [pe('pe-1')], sets: [1, 2, 3, 4].map((n) => set(`s${n}`, 'pe-1', { setNumber: n })) })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'removeSet', weekPlanId: 'wp-2', setId: 's2' }])
  })

  it('skips structurally when that ordinal does not exist', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1', { setNumber: 1 })] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips structurally when the matched row has diverged to a different exercise', () => {
    const w = week(2, {
      exercises: [pe('pe-1', { exerciseId: 'ex-OTHER' })],
      sets: [set('s1', 'pe-1', { setNumber: 1 }), set('s2', 'pe-1', { setNumber: 2 })],
    })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

// ─── addSet / removeSet (week-level ADD SET, and the stable program-tab) ──

describe('addSet (week-level ADD SET and the stable program-tab stepper)', () => {
  const change: ChangeRecord = { editType: 'addSet', slotId: 'pe-1', exerciseId: 'ex-pe-1' }

  it('applies: appends at this week\'s own current head count, with no rep-target carried (scope decision 6)', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1', { setNumber: 1 }), set('s2', 'pe-1', { setNumber: 2 })] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'addSet', weekPlanId: 'wp-2', programExerciseId: 'pe-1', setNumber: 3 }])
  })

  it('a week with zero existing heads for the slot still applies (first set)', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops[0]).toMatchObject({ setNumber: 1 })
  })

  it('skips structurally when the slot itself is missing', () => {
    const w = week(2, { exercises: [], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips structurally when the matched row has diverged to a different exercise', () => {
    const w = week(2, { exercises: [pe('pe-1', { exerciseId: 'ex-OTHER' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

describe('addWarmupSet (the exercise ⋯ menu\'s "Add warmup sets")', () => {
  const change: ChangeRecord = { editType: 'addWarmupSet', slotId: 'pe-1', exerciseId: 'ex-pe-1' }

  it('applies: one op naming the matched row — the insert point is decided per week at write time', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1', { setNumber: 1 })] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({
      weekPlanId: 'wp-2',
      weekNumber: 2,
      status: 'applied',
      ops: [{ kind: 'addWarmupSet', weekPlanId: 'wp-2', programExerciseId: 'pe-1' }],
    })
  })

  it('skips structurally when the slot is missing or holds a different exercise', () => {
    const missing = week(2, { exercises: [], sets: [] })
    const diverged = week(3, { exercises: [pe('pe-1', { exerciseId: 'ex-OTHER' })], sets: [] })
    expect(planApplyAhead(change, [missing, diverged]).map((r) => r.status === 'skipped' && r.reason)).toEqual(['structural', 'structural'])
  })

  it('skips a deload week', () => {
    const w = week(2, { isDeload: true, exercises: [pe('pe-1')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'deload' })
  })
})

describe('removeSet (stable program-tab only — always trailing)', () => {
  const change: ChangeRecord = { editType: 'removeSet', slotId: 'pe-1', exerciseId: 'ex-pe-1' }

  it('applies: removes THIS week\'s own trailing head, not a recorded ordinal', () => {
    // This week has 4 heads (a different count than the edited exercise
    // had) — the trailing one here (set_number 4) must be the one removed.
    const w = week(2, {
      exercises: [pe('pe-1')],
      sets: [1, 2, 3, 4].map((n) => set(`s${n}`, 'pe-1', { setNumber: n })),
    })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'removeSet', weekPlanId: 'wp-2', setId: 's4' }])
  })

  it('skips structurally when the slot has zero heads to remove', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('skips structurally when the slot itself is missing', () => {
    const w = week(2, { exercises: [], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

// ─── summarizeApplyAhead + the "N of M" count ──────────────────────────────

describe('summarizeApplyAhead', () => {
  it('counts applied/skippedDeload/skippedStructural independently, total = every candidate week', () => {
    const results: WeekApplyResult[] = [
      { weekPlanId: 'a', weekNumber: 2, status: 'applied', ops: [] },
      { weekPlanId: 'b', weekNumber: 3, status: 'skipped', reason: 'deload' },
      { weekPlanId: 'c', weekNumber: 4, status: 'skipped', reason: 'structural' },
      { weekPlanId: 'd', weekNumber: 5, status: 'applied', ops: [] },
    ]
    expect(summarizeApplyAhead(results)).toEqual({ total: 4, applied: 2, skippedDeload: 1, skippedStructural: 1 })
  })

  it('"applied to N of M planned weeks" (TASKS.md example) — 2 of 3', () => {
    const results: WeekApplyResult[] = [
      { weekPlanId: 'a', weekNumber: 2, status: 'applied', ops: [] },
      { weekPlanId: 'b', weekNumber: 3, status: 'applied', ops: [] },
      { weekPlanId: 'c', weekNumber: 4, status: 'skipped', reason: 'structural' },
    ]
    const s = summarizeApplyAhead(results)
    expect(`${s.applied} of ${s.total}`).toBe('2 of 3')
  })

  it('an empty candidate list summarises to all zeros', () => {
    expect(summarizeApplyAhead([])).toEqual({ total: 0, applied: 0, skippedDeload: 0, skippedStructural: 0 })
  })

  // Review fix (bug 1's own scenario): "Applied to 2 of 2", end to end
  // through planApplyAhead once a follow-up edit's own slot is shared
  // (never two distinct fresh rows).
  it('bug-1 scenario: a follow-up edit after a shared-row swap-ahead ends "Applied to 2 of 2"', () => {
    const followUp: ChangeRecord = {
      editType: 'weightTarget',
      slotId: 'pe-1-replacement',
      exerciseId: 'ex-replacement',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: null,
      newValue: 80,
    }
    const week2 = week(2, { exercises: [pe('pe-1-replacement', { exerciseId: 'ex-replacement' })], sets: [set('s1', 'pe-1-replacement')] })
    const week3 = week(3, { exercises: [pe('pe-1-replacement', { exerciseId: 'ex-replacement' })], sets: [set('s1', 'pe-1-replacement')] })
    const results = planApplyAhead(followUp, [week2, week3])
    const s = summarizeApplyAhead(results)
    expect(`${s.applied} of ${s.total}`).toBe('2 of 2')
  })
})

// ─── planApplyAheadBundle (a compound edit — e.g. AMRAP's RIR default) ────

describe('planApplyAheadBundle', () => {
  const repTargetChange: ChangeRecord = {
    editType: 'repTarget',
    slotId: 'pe-1',
    exerciseId: 'ex-pe-1',
    setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: { repMin: 8, repMax: 12, isAmrap: false },
    newValue: { repMin: null, repMax: null, isAmrap: true },
  }
  const rirChange: ChangeRecord = {
    editType: 'rir',
    slotId: 'pe-1',
    exerciseId: 'ex-pe-1',
    setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: null,
    newValue: 0,
  }

  it('applies both parts together as one week result, with both ops', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAheadBundle([repTargetChange, rirChange], [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      expect(result.ops).toEqual([
        { kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { repMin: null, repMax: null, isAmrap: true } },
        { kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { targetRir: 0 } },
      ])
    }
  })

  it('skips the week entirely when either part fails to match (never a partial write)', () => {
    const w = week(2, { exercises: [pe('pe-OTHER')], sets: [] })
    const [result] = planApplyAheadBundle([repTargetChange, rirChange], [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })

  it('an empty bundle skips every week structurally (nothing to apply)', () => {
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAheadBundle([], [w])
    expect(result).toEqual({ weekPlanId: 'wp-2', weekNumber: 2, status: 'skipped', reason: 'structural' })
  })
})

describe('planApplyAhead across several weeks at once', () => {
  it('week 3 already differs structurally at one slot and is skipped; week 2 is unaffected and applies', () => {
    const change: ChangeRecord = {
      editType: 'weightTarget',
      slotId: 'pe-1',
      exerciseId: 'ex-pe-1',
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: 60,
      newValue: 70,
    }
    const week2 = week(2, { exercises: [pe('pe-1')], sets: [set('w2-s1', 'pe-1', { setNumber: 1 })] })
    const week3 = week(3, { exercises: [pe('pe-DIFFERENT')], sets: [] }) // this slot was swapped/removed in week 3
    const results = planApplyAhead(change, [week2, week3])
    expect(results.map((r) => r.status)).toEqual(['applied', 'skipped'])
    expect(summarizeApplyAhead(results)).toEqual({ total: 2, applied: 1, skippedDeload: 0, skippedStructural: 1 })
  })
})
