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
// identity, deload skip, "touch nothing else") and the two selector
// helpers. Fixtures are minimal — only the fields each test actually reads —
// following this codebase's existing "hand-built fixture" convention
// (WeekPlan/ProgramExercise/WeekPlanSet's own optional-field comments).

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
})

// ─── Value edits: weightTarget / rir / repTarget / tags / stageKind ────────

describe('weightTarget', () => {
  const change: ChangeRecord = {
    editType: 'weightTarget',
    slotId: 'pe-1',
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

  it('matches through a later week\'s own carry (its slot survived an earlier only-this-week swap there)', () => {
    const w = week(2, {
      exercises: [pe('pe-1-weekonly', { carryProgramExerciseId: 'pe-1' })],
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
    const change: ChangeRecord = { editType: 'rir', slotId: 'pe-1', setPosition: { headOrdinal: 1, stageIndex: null }, oldValue: 3, newValue: 1 }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('s1', 'pe-1')] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 's1', changes: { targetRir: 1 } }])
  })

  it('a null newValue (RIR cleared) is written as null, not skipped', () => {
    const change: ChangeRecord = { editType: 'rir', slotId: 'pe-1', setPosition: { headOrdinal: 1, stageIndex: null }, oldValue: 3, newValue: null }
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
      setPosition: { headOrdinal: 1, stageIndex: null },
      oldValue: null,
      newValue: 'rest_pause',
    }
    const w = week(2, { exercises: [pe('pe-1')], sets: [set('h1', 'pe-1'), set('stg1', 'pe-1', { parentWeekPlanSetId: 'h1', stageIndex: 1 })] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'updateSet', weekPlanId: 'wp-2', setId: 'h1', changes: { stageKind: 'rest_pause' } }])
  })
})

// ─── swapExercise (chunk 9) ─────────────────────────────────────────────────

describe('swapExercise', () => {
  const change: ChangeRecord = { editType: 'swapExercise', slotId: 'pe-1', oldExerciseId: 'pe-1', newExerciseId: 'ex-replacement' }

  it('applies: swaps using the LATER week\'s own current programExerciseId, not the slotId', () => {
    // This later week's own row is itself a week-only replacement from an
    // earlier only-this-week swap there — its own current id ('pe-1-local')
    // differs from the canonical slotId ('pe-1'), but its carry still
    // traces back to the same slot.
    const w = week(2, { exercises: [pe('pe-1-local', { carryProgramExerciseId: 'pe-1' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    expect(result.status).toBe('applied')
    if (result.status === 'applied') {
      expect(result.ops).toEqual([
        { kind: 'swapExercise', weekPlanId: 'wp-2', programExerciseId: 'pe-1-local', replacementExerciseId: 'ex-replacement' },
      ])
    }
  })

  it('skips structurally when the slot does not exist', () => {
    const w = week(2, { exercises: [pe('pe-OTHER')], sets: [] })
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
    if (result.status === 'applied') expect(result.ops[0]).toMatchObject({ programExerciseId: 'pe-1' })
  })
})

// ─── removeExercise / addExercise (chunk 9, and stable program-tab) ────────

describe('removeExercise', () => {
  const change: ChangeRecord = { editType: 'removeExercise', slotId: 'pe-1' }

  it('applies: removes the later week\'s own current row for the matched slot', () => {
    const w = week(2, { exercises: [pe('pe-1-local', { carryProgramExerciseId: 'pe-1' })], sets: [] })
    const [result] = planApplyAhead(change, [w])
    if (result.status === 'applied') expect(result.ops).toEqual([{ kind: 'removeExercise', weekPlanId: 'wp-2', programExerciseId: 'pe-1-local' }])
  })

  it('skips structurally when already absent (e.g. that week already removed/swapped it)', () => {
    const w = week(2, { exercises: [], sets: [] })
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

// ─── reorderExercise (chunk 9) ──────────────────────────────────────────────

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
})

// ─── addStage / removeStage (chunk 14) ─────────────────────────────────────

describe('addStage', () => {
  const change: ChangeRecord = { editType: 'addStage', slotId: 'pe-1', headOrdinal: 1 }

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
})

describe('removeStage', () => {
  const change: ChangeRecord = { editType: 'removeStage', slotId: 'pe-1', setPosition: { headOrdinal: 1, stageIndex: 2 } }

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

// ─── addSet / removeSet (stable program-tab volume edits only) ────────────

describe('addSet (stable program-tab)', () => {
  const change: ChangeRecord = { editType: 'addSet', slotId: 'pe-1' }

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
})

describe('removeSet (stable program-tab)', () => {
  const change: ChangeRecord = { editType: 'removeSet', slotId: 'pe-1' }

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
})

// ─── Multi-week integration (several candidate weeks at once) ─────────────

// ─── planApplyAheadBundle (a compound edit — e.g. AMRAP's RIR default) ────

describe('planApplyAheadBundle', () => {
  const repTargetChange: ChangeRecord = {
    editType: 'repTarget',
    slotId: 'pe-1',
    setPosition: { headOrdinal: 1, stageIndex: null },
    oldValue: { repMin: 8, repMax: 12, isAmrap: false },
    newValue: { repMin: null, repMax: null, isAmrap: true },
  }
  const rirChange: ChangeRecord = { editType: 'rir', slotId: 'pe-1', setPosition: { headOrdinal: 1, stageIndex: null }, oldValue: null, newValue: 0 }

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
