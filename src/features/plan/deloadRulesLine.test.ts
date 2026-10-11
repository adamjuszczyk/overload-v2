import { describe, it, expect } from 'vitest'
import { describeDeloadRules, deloadRulesLine } from './deloadRulesLine'
import { resolveEffectiveDeloadRules, type DeloadRules } from '../../lib/deloadRules'
import { DEFAULT_DELOAD_SETS_RULE, DEFAULT_DELOAD_WEIGHT_RULE } from '../../lib/plannerVocabulary.js'

// Chunk 33 (SPEC Deload [P1.1], G43; DECISIONS 87): the one read-only line under
// the deload action — the rules in effect, and whose they are.

describe('describeDeloadRules — every rule that is on, in the shape\'s order, with its rounding', () => {
  it('sets as a percentage: the percentage and how it rounds', () => {
    expect(describeDeloadRules({ sets: { mode: 'percent', value: 50, rounding: 'down' } })).toBe('sets −50% (rounded down)')
    expect(describeDeloadRules({ sets: { mode: 'percent', value: 25, rounding: 'up' } })).toBe('sets −25% (rounded up)')
  })

  it('sets as a count: the number of sets (nothing to round)', () => {
    expect(describeDeloadRules({ sets: { mode: 'count', value: 2, rounding: 'down' } })).toBe('sets −2')
    expect(describeDeloadRules({ sets: { mode: 'count', value: 1, rounding: 'up' } })).toBe('sets −1')
  })

  it('weight: the percentage of the base, how it rounds and the step in its unit', () => {
    expect(describeDeloadRules({ weight: { percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' } })).toBe('weight 75% (rounded down to 2.5 kg)')
    expect(describeDeloadRules({ weight: { percent: 80, rounding: 'up', step: 5, stepUnit: 'lbs' } })).toBe('weight 80% (rounded up to 5 lbs)')
  })

  it('reps and RIR: a signed change', () => {
    expect(describeDeloadRules({ reps: { delta: -2 } })).toBe('reps −2')
    expect(describeDeloadRules({ reps: { delta: 3 } })).toBe('reps +3')
    expect(describeDeloadRules({ rir: { delta: 1 } })).toBe('RIR +1')
    expect(describeDeloadRules({ rir: { delta: -1 } })).toBe('RIR −1')
  })

  it('a rule that is on but changes nothing (how Settings starts reps and RIR) reads 0, not nothing', () => {
    expect(describeDeloadRules({ reps: { delta: 0 }, rir: { delta: 0 } })).toBe('reps 0 · RIR 0')
  })

  it('several rules: sets, weight, reps, RIR, whatever order the object was built in', () => {
    const rules: DeloadRules = {
      rir: { delta: 1 },
      reps: { delta: -2 },
      weight: { percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' },
      sets: { mode: 'percent', value: 50, rounding: 'down' },
    }
    expect(describeDeloadRules(rules)).toBe('sets −50% (rounded down) · weight 75% (rounded down to 2.5 kg) · reps −2 · RIR +1')
  })

  it('a rule that is off (an absent key) is not mentioned', () => {
    const text = describeDeloadRules({ weight: { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'kg' } })
    expect(text).not.toMatch(/sets|reps|RIR/)
  })

  it('words the rules Settings starts from (the defaults the editor writes), so they read as the app states them', () => {
    expect(describeDeloadRules({ sets: { ...DEFAULT_DELOAD_SETS_RULE } })).toBe('sets −50% (rounded down)')
    expect(describeDeloadRules({ weight: { ...DEFAULT_DELOAD_WEIGHT_RULE } })).toBe('weight 75% (rounded down to 2.5 kg)')
  })

  it('an empty set of rules is empty text', () => {
    expect(describeDeloadRules({})).toBe('')
  })
})

describe('deloadRulesLine — the line, and whose rules it names', () => {
  const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }

  it('names the run\'s own rules as this run\'s', () => {
    expect(deloadRulesLine(rules, 'run')).toBe("Deload rules (this run's): sets −50% (rounded down)")
  })

  it('names the Settings default as your default', () => {
    expect(deloadRulesLine(rules, 'default')).toBe('Deload rules (your default): sets −50% (rounded down)')
  })

  it('is nothing when no rule is on (an unset feature shows nothing)', () => {
    expect(deloadRulesLine(null, 'run')).toBeNull()
    expect(deloadRulesLine(null, 'default')).toBeNull()
    expect(deloadRulesLine({}, 'default')).toBeNull()
  })

  it('words what resolveEffectiveDeloadRules resolves, the very value marking is given', () => {
    const mine: DeloadRules = { reps: { delta: -1 } }
    const settings: DeloadRules = { rir: { delta: 2 } }
    expect(deloadRulesLine(resolveEffectiveDeloadRules(mine, settings), 'run')).toBe("Deload rules (this run's): reps −1")
    expect(deloadRulesLine(resolveEffectiveDeloadRules(null, settings), 'default')).toBe('Deload rules (your default): RIR +2')
    expect(deloadRulesLine(resolveEffectiveDeloadRules(null, null), 'default')).toBeNull()
  })
})
