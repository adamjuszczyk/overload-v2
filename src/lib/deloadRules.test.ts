import { describe, it, expect } from 'vitest'
import {
  validateDeloadRules,
  resolveEffectiveDeloadRules,
  resolveDeloadBaseOccurrence,
  resolveDeloadExerciseMapping,
  occurrenceHasWorkingLog,
  resolveLoggedWeightKg,
  calculateDeloadSetCount,
  calculateDeloadWeightKg,
  calculateDeloadRepTarget,
  calculateDeloadRir,
  calculateDeloadSets,
  buildDeloadRestoreSnapshot,
  groupDeloadRestoreEntries,
  type DeloadSourceSet,
  type DeloadExerciseSlot,
  type DeloadRules,
  type DeloadSetsRule,
  type DeloadWeightRule,
} from './deloadRules'
import { DEFAULT_DELOAD_SETS_RULE, DEFAULT_DELOAD_WEIGHT_RULE } from './plannerVocabulary.js'

// ─── Validation ─────────────────────────────────────────────────────────────

describe('validateDeloadRules', () => {
  it('null/undefined → null ("no rules on")', () => {
    expect(validateDeloadRules(null)).toBeNull()
    expect(validateDeloadRules(undefined)).toBeNull()
  })

  it('an absent key means that rule is off — a partial object keeps only the present keys', () => {
    const result = validateDeloadRules({ sets: { mode: 'percent', value: 50, rounding: 'down' } })
    expect(result).toEqual({ sets: { mode: 'percent', value: 50, rounding: 'down' } })
    expect(result).not.toHaveProperty('weight')
    expect(result).not.toHaveProperty('reps')
    expect(result).not.toHaveProperty('rir')
  })

  it('every key present validates the full TASKS shape', () => {
    const raw = {
      sets: { mode: 'count', value: 2, rounding: 'up' },
      weight: { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'kg' },
      reps: { delta: -2 },
      rir: { delta: 1 },
    }
    expect(validateDeloadRules(raw)).toEqual(raw)
  })

  it('an object with every key absent ({}) canonicalises to null, same as the column being null', () => {
    expect(validateDeloadRules({})).toBeNull()
  })

  it('rejects the whole object when one present key is malformed', () => {
    expect(validateDeloadRules({ sets: { mode: 'bogus', value: 50, rounding: 'down' } })).toBeNull()
    expect(validateDeloadRules({ sets: { mode: 'percent', value: 'fifty', rounding: 'down' } })).toBeNull()
    expect(validateDeloadRules({ sets: { mode: 'percent', value: 50, rounding: 'sideways' } })).toBeNull()
    expect(validateDeloadRules({ weight: { percent: 90, rounding: 'down', step: 0, stepUnit: 'kg' } })).toBeNull()
    expect(validateDeloadRules({ weight: { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'stone' } })).toBeNull()
    expect(validateDeloadRules({ reps: { delta: 'two' } })).toBeNull()
    expect(validateDeloadRules({ rir: {} })).toBeNull()
  })

  it('rejects a non-object and an array', () => {
    expect(validateDeloadRules('nonsense')).toBeNull()
    expect(validateDeloadRules(42)).toBeNull()
    expect(validateDeloadRules([])).toBeNull()
  })
})

describe('resolveEffectiveDeloadRules', () => {
  const userRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }

  it("the run's program override wins when non-null", () => {
    const programRules = { weight: { percent: 80, rounding: 'up', step: 5, stepUnit: 'kg' } }
    expect(resolveEffectiveDeloadRules(programRules, userRules)).toEqual(programRules)
  })

  it('falls back to the global default when the program override is null', () => {
    expect(resolveEffectiveDeloadRules(null, userRules)).toEqual(userRules)
  })

  it('a present-but-empty program override ({}) wins too — "no rules for this program", not a fall-through', () => {
    expect(resolveEffectiveDeloadRules({}, userRules)).toBeNull()
  })

  it('none at all → null', () => {
    expect(resolveEffectiveDeloadRules(null, null)).toBeNull()
    expect(resolveEffectiveDeloadRules(undefined, undefined)).toBeNull()
  })
})

// ─── Base occurrence (reviewer's note 2) ───────────────────────────────────

describe('resolveDeloadBaseOccurrence', () => {
  it('uses the immediately previous occurrence when it is normal and happened', () => {
    const occ = [
      { weekNumber: 1, isDeload: false, happened: true },
      { weekNumber: 2, isDeload: false, happened: true },
    ]
    expect(resolveDeloadBaseOccurrence(occ, 3)).toEqual({ kind: 'week', weekNumber: 2 })
  })

  it("walks back past a week that didn't happen (skipped/never started)", () => {
    const occ = [
      { weekNumber: 1, isDeload: false, happened: true },
      { weekNumber: 2, isDeload: false, happened: false }, // skipped last-normal week
    ]
    expect(resolveDeloadBaseOccurrence(occ, 3)).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('walks back past a deload week even if it happened', () => {
    const occ = [
      { weekNumber: 1, isDeload: false, happened: true },
      { weekNumber: 2, isDeload: true, happened: true },
    ]
    expect(resolveDeloadBaseOccurrence(occ, 3)).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('never looks at or past the marked week itself', () => {
    const occ = [
      { weekNumber: 3, isDeload: false, happened: true }, // the week being marked — not a candidate
      { weekNumber: 4, isDeload: false, happened: true }, // a later week — not a candidate either
    ]
    expect(resolveDeloadBaseOccurrence(occ, 3)).toEqual({ kind: 'none' })
  })

  it('with none at all, reports "none" (caller falls back to the current planned sets)', () => {
    expect(resolveDeloadBaseOccurrence([], 1)).toEqual({ kind: 'none' })
    expect(resolveDeloadBaseOccurrence([{ weekNumber: 1, isDeload: true, happened: true }], 2)).toEqual({ kind: 'none' })
  })
})

// Review fix — the base occurrence's sets must never be written under the
// base week's own program_exercise_id verbatim; this function decides,
// per the MARKED week's own exercise, whether a base exercise matches it
// (same slot per applyAhead.ts's own chunk-20 rule, AND the same CURRENT
// exerciseId) or must fall back to the marked week's own current sets.
// Chunk 27: a slot is a row's OWN programExerciseId; stored carry_* values
// are ignored.
describe('resolveDeloadExerciseMapping', () => {
  function slot(overrides: Partial<DeloadExerciseSlot>): DeloadExerciseSlot {
    return { programExerciseId: 'pe', exerciseId: 'ex', ...overrides }
  }

  // A slot as a caller reading the database could still hand it over, with the
  // carry value an old "only this week" tick stored. DeloadExerciseSlot no
  // longer has the field (chunk 27), so it is added through a cast: every test
  // using this asserts that the value changes nothing.
  function slotWithStoredCarry(carryProgramExerciseId: string, overrides: Partial<DeloadExerciseSlot>): DeloadExerciseSlot {
    return { ...slot(overrides), carryProgramExerciseId } as DeloadExerciseSlot
  }

  it('the plain case: same programExerciseId on both sides, no carry at all, matches', () => {
    const marked = [slot({ programExerciseId: 'pe-1', exerciseId: 'ex-a' })]
    const base = [slot({ programExerciseId: 'pe-1', exerciseId: 'ex-a' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-1', source: { kind: 'matched', baseProgramExerciseId: 'pe-1' } },
    ])
  })

  it('added in the marked week (base has nothing at all for it): falls back to its own current sets', () => {
    const marked = [slot({ programExerciseId: 'pe-new', exerciseId: 'ex-new' })]
    const base: DeloadExerciseSlot[] = [] // the stable program-tab add-after-week-1 case, or simply a different exercise list
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-new', source: { kind: 'fallback' } },
    ])
  })

  it('removed in the marked week: a base exercise with no marked-week counterpart is simply never produced (ignored, never written)', () => {
    const marked: DeloadExerciseSlot[] = [] // this one workout's only exercise was removed from the marked week
    const base = [slot({ programExerciseId: 'pe-gone', exerciseId: 'ex-gone' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([])
  })

  it('a swap in the BASE week (base row Y, marked week still plain A): the rows differ, so it falls back — never matched on a stored carry', () => {
    // Base week: A was swapped to a week-only row Y (an old tick also stored
    // carry_program_exercise_id = 'pe-A' on it). Marked week: never swapped —
    // still plainly A. The rows are different slots; the stored carry that
    // names A on the base row is ignored.
    const base = [slotWithStoredCarry('pe-A', { programExerciseId: 'pe-Y', exerciseId: 'ex-Y' })]
    const marked = [slot({ programExerciseId: 'pe-A', exerciseId: 'ex-A' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-A', source: { kind: 'fallback' } },
    ])
  })

  it('a PERMANENT swap made only in the marked week: its own slot is now \'pe-Z\', which the base week never had — falls back', () => {
    const marked = [slot({ programExerciseId: 'pe-Z', exerciseId: 'ex-Z' })]
    // Base week (chronologically earlier, before the swap ever happened):
    // still plainly A.
    const base = [slot({ programExerciseId: 'pe-A', exerciseId: 'ex-A' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-Z', source: { kind: 'fallback' } },
    ])
  })

  // Chunk 27 — matches ignore stored values. The base row stores a carry that
  // names ANOTHER slot ('pe-OTHER'), but it is the same row as the marked
  // week's (same own id, same exercise): it matches. Before chunk 27 its
  // slot read 'pe-OTHER' against the marked week's 'pe-A' and it fell back.
  // Break proof: restore `carryProgramExerciseId ?? programExerciseId` in
  // deloadSlotIdOf (with the field back on DeloadExerciseSlot).
  it('a base row whose stored carry names another slot still matches the marked row with the same own id', () => {
    const base = [slotWithStoredCarry('pe-OTHER', { programExerciseId: 'pe-A', exerciseId: 'ex-A' })]
    const marked = [slot({ programExerciseId: 'pe-A', exerciseId: 'ex-A' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-A', source: { kind: 'matched', baseProgramExerciseId: 'pe-A' } },
    ])
  })

  it('two DIFFERENT rows that store the same carry are not paired: own ids differ, so the marked exercise falls back (an old tick mirrored in both weeks)', () => {
    // Each week's old "only this week" swap created its OWN week-only row,
    // both storing carry 'pe-A'. Pairing them used to rest on that shared
    // carry; with carry ignored they are two different rows.
    const base = [slotWithStoredCarry('pe-A', { programExerciseId: 'pe-Y-base', exerciseId: 'ex-Y' })]
    const marked = [slotWithStoredCarry('pe-A', { programExerciseId: 'pe-Y-marked', exerciseId: 'ex-Y' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-Y-marked', source: { kind: 'fallback' } },
    ])
  })

  it('same own id but a different CURRENT exercise: still falls back (the exercise must agree)', () => {
    const base = [slot({ programExerciseId: 'pe-A', exerciseId: 'ex-Y' })]
    const marked = [slot({ programExerciseId: 'pe-A', exerciseId: 'ex-A' })]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-A', source: { kind: 'fallback' } },
    ])
  })

  it('several exercises at once: each marked exercise is resolved independently', () => {
    const marked = [
      slot({ programExerciseId: 'pe-1', exerciseId: 'ex-1' }), // matches
      slot({ programExerciseId: 'pe-new', exerciseId: 'ex-new' }), // added — fallback
    ]
    const base = [
      slot({ programExerciseId: 'pe-1', exerciseId: 'ex-1' }),
      slot({ programExerciseId: 'pe-removed', exerciseId: 'ex-removed' }), // not in marked — ignored
    ]
    expect(resolveDeloadExerciseMapping(marked, base)).toEqual([
      { markedProgramExerciseId: 'pe-1', source: { kind: 'matched', baseProgramExerciseId: 'pe-1' } },
      { markedProgramExerciseId: 'pe-new', source: { kind: 'fallback' } },
    ])
  })
})

describe('occurrenceHasWorkingLog / resolveLoggedWeightKg', () => {
  it('"happened" requires a non-skipped, non-warmup, non-stage logged set', () => {
    expect(occurrenceHasWorkingLog([{ weekPlanSetId: 's1', weight: 100, isSkipped: false, isWarmup: false, parentSetId: null }], ['s1'])).toBe(true)
  })

  it('a skipped log does not count as happened', () => {
    expect(occurrenceHasWorkingLog([{ weekPlanSetId: 's1', weight: null, isSkipped: true, isWarmup: false, parentSetId: null }], ['s1'])).toBe(false)
  })

  it('a warmup log does not count as happened', () => {
    expect(occurrenceHasWorkingLog([{ weekPlanSetId: 's1', weight: 20, isSkipped: false, isWarmup: true, parentSetId: null }], ['s1'])).toBe(false)
  })

  it('a stage log (parentSetId set) does not count as happened — stages are never independent sets', () => {
    expect(occurrenceHasWorkingLog([{ weekPlanSetId: 's1', weight: 20, isSkipped: false, isWarmup: false, parentSetId: 'head' }], ['s1'])).toBe(false)
  })

  it('resolveLoggedWeightKg finds the first non-skipped log for that exact planned set, else null', () => {
    const logs = [
      { weekPlanSetId: 's1', weight: 100, isSkipped: false, isWarmup: false, parentSetId: null },
      { weekPlanSetId: 's2', weight: null, isSkipped: true, isWarmup: false, parentSetId: null },
    ]
    expect(resolveLoggedWeightKg(logs, 's1')).toBe(100)
    expect(resolveLoggedWeightKg(logs, 's2')).toBeNull() // only a skipped log — no usable weight
    expect(resolveLoggedWeightKg(logs, 's3')).toBeNull() // nothing logged at all
  })
})

// ─── Calculator — TASKS cases, verbatim ────────────────────────────────────

describe('calculateDeloadSetCount — TASKS cases, verbatim', () => {
  const pctDown: DeloadSetsRule = { mode: 'percent', value: 50, rounding: 'down' }
  const pctUp: DeloadSetsRule = { mode: 'percent', value: 50, rounding: 'up' }

  it('4 sets −50% → 2 either way', () => {
    expect(calculateDeloadSetCount(4, pctDown)).toBe(2)
    expect(calculateDeloadSetCount(4, pctUp)).toBe(2)
  })

  it('3 sets −50% → 1 down / 2 up', () => {
    expect(calculateDeloadSetCount(3, pctDown)).toBe(1)
    expect(calculateDeloadSetCount(3, pctUp)).toBe(2)
  })

  it('1 set −50% → 1 (never below 1)', () => {
    expect(calculateDeloadSetCount(1, pctDown)).toBe(1)
    expect(calculateDeloadSetCount(1, pctUp)).toBe(1)
  })

  it('0 working sets stays 0 — nothing to floor at 1', () => {
    expect(calculateDeloadSetCount(0, pctDown)).toBe(0)
  })

  it('count mode subtracts a flat number, never below 1, never above the original', () => {
    expect(calculateDeloadSetCount(5, { mode: 'count', value: 2, rounding: 'down' })).toBe(3)
    expect(calculateDeloadSetCount(2, { mode: 'count', value: 10, rounding: 'down' })).toBe(1)
  })

  it("uses plannerVocabulary.ts's own default — no duplicated literal", () => {
    expect(DEFAULT_DELOAD_SETS_RULE).toEqual({ mode: 'percent', value: 50, rounding: 'down' })
    expect(calculateDeloadSetCount(4, DEFAULT_DELOAD_SETS_RULE)).toBe(2)
  })
})

describe('calculateDeloadWeightKg — TASKS cases, verbatim', () => {
  it('82.5 kg × 90% = 74.25 → 72.5 down / 75 up at 2.5 kg', () => {
    const down: DeloadWeightRule = { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'kg' }
    const up: DeloadWeightRule = { percent: 90, rounding: 'up', step: 2.5, stepUnit: 'kg' }
    expect(calculateDeloadWeightKg(82.5, down)).toBe(72.5)
    expect(calculateDeloadWeightKg(82.5, up)).toBe(75)
  })

  // A lbs step — the brief names no concrete numbers for this case
  // ("a lbs step"), so these are this chunk's own, independently verified
  // via the real kgToLbs/lbsToKg helpers (a node one-off, not hand
  // arithmetic) before being pinned here: 60 kg at 75% = 45 kg = 99.2 lbs
  // (kgToLbs's own 1-decimal rounding); floor/ceil to a 5 lb step gives 95 /
  // 100 lbs, i.e. 43.09 / 45.36 kg once converted back.
  it('a lbs step: 60 kg base, 75%, step 5 lbs → 43.09 kg down / 45.36 kg up', () => {
    const down: DeloadWeightRule = { percent: 75, rounding: 'down', step: 5, stepUnit: 'lbs' }
    const up: DeloadWeightRule = { percent: 75, rounding: 'up', step: 5, stepUnit: 'lbs' }
    expect(calculateDeloadWeightKg(60, down)).toBe(43.09)
    expect(calculateDeloadWeightKg(60, up)).toBe(45.36)
  })

  it("uses plannerVocabulary.ts's own default (rounding down, 2.5 kg step) plus DECISIONS 33's 75% — no duplicated literal", () => {
    expect(DEFAULT_DELOAD_WEIGHT_RULE).toEqual({ percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' })
  })
})

describe('calculateDeloadRepTarget — TASKS cases, verbatim', () => {
  it('a range: 8–12 with −2 → 6–10', () => {
    expect(calculateDeloadRepTarget({ type: 'range', min: 8, max: 12 }, { delta: -2 })).toEqual({ type: 'range', min: 6, max: 10 })
  })

  it('AMRAP is unchanged', () => {
    expect(calculateDeloadRepTarget({ type: 'amrap' }, { delta: -2 })).toEqual({ type: 'amrap' })
  })

  it('"none" is unchanged (nothing to shift)', () => {
    expect(calculateDeloadRepTarget({ type: 'none' }, { delta: -2 })).toEqual({ type: 'none' })
  })

  it('a single number shifts the same as both ends of a range, never below 1', () => {
    expect(calculateDeloadRepTarget({ type: 'number', value: 8 }, { delta: -2 })).toEqual({ type: 'number', value: 6 })
    expect(calculateDeloadRepTarget({ type: 'number', value: 2 }, { delta: -5 })).toEqual({ type: 'number', value: 1 })
  })

  it('a range clamped at the floor on both ends collapses to a plain number, not a degenerate min===max range', () => {
    expect(calculateDeloadRepTarget({ type: 'range', min: 2, max: 3 }, { delta: -5 })).toEqual({ type: 'number', value: 1 })
  })
})

describe('calculateDeloadRir', () => {
  it('RIR: +n', () => {
    expect(calculateDeloadRir(2, { delta: 1 })).toBe(3)
  })

  it('no RIR target means nothing to adjust — stays null', () => {
    expect(calculateDeloadRir(null, { delta: 1 })).toBeNull()
  })

  it('no stated floor — a negative delta can take RIR below 0', () => {
    expect(calculateDeloadRir(0, { delta: -2 })).toBe(-2)
  })
})

// ─── calculateDeloadSets — the full per-exercise pass ──────────────────────

function set(overrides: Partial<DeloadSourceSet>): DeloadSourceSet {
  return {
    id: 'set', programExerciseId: 'pe1', setNumber: 1, parentId: null, stageIndex: 0,
    isWarmup: false, stageKind: null, programSetId: null, repMin: null, repMax: null,
    isAmrap: false, targetRir: null, tags: null, isDropset: false, plannedWeight: null,
    loggedWeight: null,
    ...overrides,
  }
}

describe('calculateDeloadSets', () => {
  it('a staged set counts as one: dropping a head drops its stages with it, and a kept staged set counts once toward "how many kept"', () => {
    // Exercise has 3 "sets" by position: set 1 is a staged head+1 stage,
    // sets 2-3 are plain heads. −50% down on 3 (correct, heads-only count)
    // keeps exactly 1 — set 1, staged form and all (first by position, per
    // "removes the LAST"). Deliberately an ODD correct count with exactly
    // one stage: a broken count that includes the stage row (4, not 3)
    // rounds to a DIFFERENT kept total (2, not 1) at -50% down — floor(3/2)
    // = 1 but floor(4/2) = 2 — so a miscount here is never masked by a
    // coincidental equal result the way an even count could mask it (break
    // proof: counting the stage as its own set must fail this test).
    const head1 = set({ id: 'h1', setNumber: 1, stageKind: 'dropset' })
    const stage1 = set({ id: 's1', setNumber: 1, parentId: 'h1', stageIndex: 1, isDropset: true })
    const head2 = set({ id: 'h2', setNumber: 2 })
    const head3 = set({ id: 'h3', setNumber: 3 })
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }

    const result = calculateDeloadSets([head1, stage1, head2, head3], rules)

    expect(result.map((r) => r.sourceId)).toEqual(['h1', 's1']) // sets 2 and 3 (the LAST two) dropped entirely
  })

  it('warmups are never touched or counted: a 4-working-set exercise with 2 warmups still keeps 2 working sets at −50%, and every warmup is untouched', () => {
    const warmup1 = set({ id: 'w1', setNumber: 1, isWarmup: true, plannedWeight: 40 })
    const warmup2 = set({ id: 'w2', setNumber: 2, isWarmup: true, plannedWeight: 60 })
    const working = [1, 2, 3, 4].map((n) =>
      set({ id: `w${n + 2}`, setNumber: n + 2, plannedWeight: 100 }),
    )
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, weight: { percent: 50, rounding: 'down', step: 2.5, stepUnit: 'kg' } }

    const result = calculateDeloadSets([warmup1, warmup2, ...working], rules)

    const resultWarmups = result.filter((r) => r.isWarmup)
    const resultWorking = result.filter((r) => !r.isWarmup)
    expect(resultWarmups).toHaveLength(2)
    expect(resultWarmups.find((r) => r.sourceId === 'w1')?.targetWeight).toBe(40) // untouched despite a weight rule being on
    expect(resultWarmups.find((r) => r.sourceId === 'w2')?.targetWeight).toBe(60)
    expect(resultWorking).toHaveLength(2) // 4 −50% → 2, warmups excluded from the count entirely
  })

  it('weight rule: base is the logged weight when one exists, else the planned weight', () => {
    const logged = set({ id: 'a', setNumber: 1, plannedWeight: 100, loggedWeight: 95 })
    const notLogged = set({ id: 'b', setNumber: 2, plannedWeight: 100, loggedWeight: null })
    const rules: DeloadRules = { weight: { percent: 100, rounding: 'down', step: 2.5, stepUnit: 'kg' } }

    const result = calculateDeloadSets([logged, notLogged], rules)

    expect(result.find((r) => r.sourceId === 'a')?.targetWeight).toBe(95) // from the log, not the plan
    expect(result.find((r) => r.sourceId === 'b')?.targetWeight).toBe(100) // nothing logged — planned weight
  })

  it('no base weight means none is set', () => {
    const noWeight = set({ id: 'a', setNumber: 1, plannedWeight: null, loggedWeight: null })
    const rules: DeloadRules = { weight: { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'kg' } }

    const result = calculateDeloadSets([noWeight], rules)
    expect(result[0].targetWeight).toBeNull()
  })

  it('each rule is independent and optional: only the sets rule on leaves weight/reps/rir untouched', () => {
    const s = set({ id: 'a', setNumber: 1, plannedWeight: 100, repMin: 8, repMax: 12, targetRir: 2 })
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }

    const result = calculateDeloadSets([s], rules)
    expect(result[0].targetWeight).toBe(100)
    expect(result[0].repMin).toBe(8)
    expect(result[0].repMax).toBe(12)
    expect(result[0].targetRir).toBe(2)
  })

  it('no rules at all is a pure passthrough (every set kept, nothing changed)', () => {
    const a = set({ id: 'a', setNumber: 1, plannedWeight: 100, repMin: 8, repMax: 12, targetRir: 2 })
    const b = set({ id: 'b', setNumber: 2, plannedWeight: 100 })
    const result = calculateDeloadSets([a, b], {})
    expect(result).toHaveLength(2)
    expect(result.find((r) => r.sourceId === 'a')).toMatchObject({ targetWeight: 100, repMin: 8, repMax: 12, targetRir: 2 })
  })

  it('operates per exercise independently — a 4-set exercise and a 2-set exercise each apply the sets rule to their OWN count', () => {
    const exA = [1, 2, 3, 4].map((n) => set({ id: `a${n}`, programExerciseId: 'peA', setNumber: n }))
    const exB = [1, 2].map((n) => set({ id: `b${n}`, programExerciseId: 'peB', setNumber: n }))
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }

    const result = calculateDeloadSets([...exA, ...exB], rules)
    expect(result.filter((r) => r.programExerciseId === 'peA')).toHaveLength(2) // 4 → 2
    expect(result.filter((r) => r.programExerciseId === 'peB')).toHaveLength(1) // 2 → 1
  })
})

// ─── Snapshot / restore grouping (reviewer's note 3/4) ─────────────────────

describe('buildDeloadRestoreSnapshot / groupDeloadRestoreEntries', () => {
  it('snapshot carries every restorable column and nothing id-shaped', () => {
    const snapshot = buildDeloadRestoreSnapshot([
      { programExerciseId: 'pe1', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: 'ps1', repMin: 8, repMax: 12, isAmrap: false, targetWeight: 100, targetRir: 2, tags: ['push here'] },
    ])
    expect(snapshot).toEqual([
      { programExerciseId: 'pe1', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: 'ps1', repMin: 8, repMax: 12, isAmrap: false, targetWeight: 100, targetRir: 2, tags: ['push here'] },
    ])
    expect(snapshot[0]).not.toHaveProperty('id')
  })

  it('regroups a head + its stages by (programExerciseId, setNumber), ordered by stageIndex, with no ids at all', () => {
    const head = { programExerciseId: 'pe1', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: 'dropset' as const, programSetId: null, repMin: null, repMax: null, isAmrap: false, targetWeight: 100, targetRir: null, tags: null }
    const stage2 = { ...head, stageIndex: 2, isDropset: true, stageKind: null, targetWeight: 80 }
    const stage1 = { ...head, stageIndex: 1, isDropset: true, stageKind: null, targetWeight: 90 }
    const otherHead = { ...head, programExerciseId: 'pe2', setNumber: 1, targetWeight: 50 }

    const groups = groupDeloadRestoreEntries([head, stage2, stage1, otherHead])

    expect(groups).toHaveLength(2)
    const pe1Group = groups.find((g) => g.head.programExerciseId === 'pe1')!
    expect(pe1Group.stages.map((s) => s.stageIndex)).toEqual([1, 2]) // ordered, not input order
    expect(pe1Group.stages.map((s) => s.targetWeight)).toEqual([90, 80])
    const pe2Group = groups.find((g) => g.head.programExerciseId === 'pe2')!
    expect(pe2Group.stages).toEqual([])
  })

  it('two different exercises sharing the same setNumber never cross-group (the key includes programExerciseId)', () => {
    const headA = { programExerciseId: 'peA', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: null, repMin: null, repMax: null, isAmrap: false, targetWeight: 10, targetRir: null, tags: null }
    const stageB = { programExerciseId: 'peB', setNumber: 1, stageIndex: 1, isWarmup: false, isDropset: true, stageKind: null, programSetId: null, repMin: null, repMax: null, isAmrap: false, targetWeight: 10, targetRir: null, tags: null }
    const headB = { ...stageB, stageIndex: 0, isDropset: false, targetWeight: 20 }

    const groups = groupDeloadRestoreEntries([headA, stageB, headB])
    const peAGroup = groups.find((g) => g.head.programExerciseId === 'peA')!
    const peBGroup = groups.find((g) => g.head.programExerciseId === 'peB')!
    expect(peAGroup.stages).toEqual([]) // stageB never attaches to peA's head
    expect(peBGroup.stages).toHaveLength(1)
  })
})
