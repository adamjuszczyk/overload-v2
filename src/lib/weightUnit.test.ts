import { describe, it, expect } from 'vitest'
import {
  kgToLbs,
  lbsToKg,
  toDisplayWeight,
  toStorageWeight,
  resolveWeightUnit,
  resolveEditedWeightKg,
  toDisplayVolume,
} from './weightUnit'

describe('kgToLbs / lbsToKg', () => {
  it('converts kg to lbs, rounded to 1 decimal', () => {
    expect(kgToLbs(100)).toBe(220.5)
    expect(kgToLbs(60)).toBe(132.3)
    expect(kgToLbs(0)).toBe(0)
  })

  it('converts lbs to kg, rounded to 2 decimals', () => {
    expect(lbsToKg(225)).toBe(102.06)
    expect(lbsToKg(45)).toBe(20.41)
    expect(lbsToKg(0)).toBe(0)
  })
})

describe('toDisplayWeight', () => {
  it('kg display rounds to 2 decimals (matches numeric(6,2))', () => {
    expect(toDisplayWeight(100.005, 'kg')).toBeCloseTo(100.01, 2)
    expect(toDisplayWeight(82.5, 'kg')).toBe(82.5)
  })

  it('lbs display rounds to 1 decimal', () => {
    expect(toDisplayWeight(100, 'lbs')).toBe(220.5)
  })
})

describe('toStorageWeight', () => {
  it('kg entry rounds to 2 decimals for storage', () => {
    expect(toStorageWeight(82.5, 'kg')).toBe(82.5)
    expect(toStorageWeight(82.505, 'kg')).toBeCloseTo(82.51, 2)
  })

  it('lbs entry converts down to kg for storage', () => {
    expect(toStorageWeight(220.5, 'lbs')).toBe(lbsToKg(220.5))
  })
})

describe('toDisplayVolume', () => {
  it('passes through unchanged for kg', () => {
    expect(toDisplayVolume(1000, 'kg')).toBe(1000)
  })

  it('scales by the same factor a single weight value would, since reps are unit-independent', () => {
    // Σ(weight_kg × reps) converted should equal Σ(weight_lbs × reps) —
    // i.e. converting the total is equivalent to converting each weight
    // first and summing, since the reps multiplier distributes over the sum.
    const weightsKg = [100, 90, 80]
    const reps = [8, 8, 8]
    const volumeKg = weightsKg.reduce((s, w, i) => s + w * reps[i], 0)
    const volumeFromTotal = toDisplayVolume(volumeKg, 'lbs')
    const volumeFromPerSet = weightsKg.reduce((s, w, i) => s + kgToLbs(w) * reps[i], 0)
    // Not exactly equal — kgToLbs rounds each weight individually — but
    // close, confirming the scaling factor itself is the same one used
    // per-weight, just applied without per-set rounding error compounding.
    expect(volumeFromTotal).toBeCloseTo(volumeFromPerSet, -1)
  })
})

describe('resolveWeightUnit', () => {
  it('prefers the program-exercise unit when set', () => {
    expect(resolveWeightUnit('lbs', 'kg')).toBe('lbs')
  })

  it('falls back to the global unit when the program-exercise unit is null (inherit)', () => {
    expect(resolveWeightUnit(null, 'lbs')).toBe('lbs')
    expect(resolveWeightUnit(undefined, 'lbs')).toBe('lbs')
  })

  it('falls back to kg when nothing is resolvable', () => {
    expect(resolveWeightUnit(null, null)).toBe('kg')
    expect(resolveWeightUnit(undefined, undefined)).toBe('kg')
  })
})

// The core risk TASKS.md §2.4 flags by name: repeated edits round-tripping
// through a *displayed* lbs value drift (100kg -> 220.5lbs -> 100.01... kg,
// not 100), because kgToLbs/lbsToKg are each independently rounded. The fix
// has to compare against what the stored kg value *would already display
// as*, not blindly re-derive kg from whatever string is in the edit field.
describe('resolveEditedWeightKg — round-trip drift guard', () => {
  it('returns the original kg exactly when the displayed lbs value is unchanged', () => {
    const originalKg = 100
    const displayedLbs = toDisplayWeight(originalKg, 'lbs') // 220.5
    expect(resolveEditedWeightKg(originalKg, 'lbs', displayedLbs)).toBe(100)
  })

  it('does not drift across many repeated no-op edit cycles', () => {
    let storedKg = 100
    for (let i = 0; i < 25; i++) {
      const displayed = toDisplayWeight(storedKg, 'lbs')
      storedKg = resolveEditedWeightKg(storedKg, 'lbs', displayed)
    }
    expect(storedKg).toBe(100)
  })

  it('demonstrates the drift a naive lbsToKg(display) re-derivation would produce', () => {
    const originalKg = 100
    const displayedLbs = toDisplayWeight(originalKg, 'lbs') // 220.5
    const naiveRoundTrip = lbsToKg(displayedLbs)
    expect(naiveRoundTrip).not.toBe(originalKg) // proves the guard is necessary
    expect(resolveEditedWeightKg(originalKg, 'lbs', displayedLbs)).toBe(originalKg) // the guard fixes it
  })

  it('still converts a genuinely changed value', () => {
    const originalKg = 100
    expect(resolveEditedWeightKg(originalKg, 'lbs', 225)).toBe(lbsToKg(225))
  })

  it('round-trips exactly through kg too (2-decimal display equals stored value)', () => {
    const originalKg = 82.5
    const displayed = toDisplayWeight(originalKg, 'kg')
    expect(resolveEditedWeightKg(originalKg, 'kg', displayed)).toBe(82.5)
  })

  it('unchanged-value guard also holds after a unit switch, not just repeated edits in one unit', () => {
    // Logged in kg, then the exercise's resolved unit is later switched to lbs —
    // opening the edit in the new unit and saving without touching the number
    // must still not drift, since the guard compares against the *current*
    // display unit at edit time, not whatever unit was originally used.
    const originalKg = 100
    const displayedInLbs = toDisplayWeight(originalKg, 'lbs')
    expect(resolveEditedWeightKg(originalKg, 'lbs', displayedInLbs)).toBe(100)
  })
})
