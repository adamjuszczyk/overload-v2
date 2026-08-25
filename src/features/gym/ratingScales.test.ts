import { describe, it, expect } from 'vitest'
import { FORM_SCALE, ENERGY_SCALE, PUMP_SCALE, toOrdinal, averageRating } from './ratingScales'

describe('toOrdinal', () => {
  it('assigns 1-based ordinals matching low-to-high order, for every value of all three scales', () => {
    expect(toOrdinal(FORM_SCALE, 'rushed')).toBe(1)
    expect(toOrdinal(FORM_SCALE, 'normal')).toBe(2)
    expect(toOrdinal(FORM_SCALE, 'controlled')).toBe(3)
    expect(toOrdinal(FORM_SCALE, 'extra_controlled')).toBe(4)

    expect(toOrdinal(ENERGY_SCALE, 'none')).toBe(1)
    expect(toOrdinal(ENERGY_SCALE, 'low')).toBe(2)
    expect(toOrdinal(ENERGY_SCALE, 'normal')).toBe(3)
    expect(toOrdinal(ENERGY_SCALE, 'high')).toBe(4)
    expect(toOrdinal(ENERGY_SCALE, 'supreme')).toBe(5)

    expect(toOrdinal(PUMP_SCALE, 'none')).toBe(1)
    expect(toOrdinal(PUMP_SCALE, 'some')).toBe(2)
    expect(toOrdinal(PUMP_SCALE, 'good')).toBe(3)
    expect(toOrdinal(PUMP_SCALE, 'extreme')).toBe(4)
  })
})

describe('scale shape', () => {
  it('values order matches the low → high semantics the chip row renders', () => {
    expect(FORM_SCALE.values).toEqual(['rushed', 'normal', 'controlled', 'extra_controlled'])
    expect(ENERGY_SCALE.values).toEqual(['none', 'low', 'normal', 'high', 'supreme'])
    expect(PUMP_SCALE.values).toEqual(['none', 'some', 'good', 'extreme'])
  })

  it('scaleMax is correct per dimension (4/5/4)', () => {
    expect(averageRating(FORM_SCALE, ['rushed'])?.scaleMax).toBe(4)
    expect(averageRating(ENERGY_SCALE, ['low'])?.scaleMax).toBe(5)
    expect(averageRating(PUMP_SCALE, ['some'])?.scaleMax).toBe(4)
  })
})

describe('averageRating', () => {
  it('averages a mixed list, excluding nulls from both the sum and the count', () => {
    // rushed=1, controlled=3 -> mean 2, count 2 (the null contributes to neither)
    const result = averageRating(FORM_SCALE, ['rushed', null, 'controlled'])
    expect(result).toEqual({ mean: 2, scaleMax: 4, count: 2 })
  })

  it('returns null (not 0) over an all-null list', () => {
    expect(averageRating(FORM_SCALE, [null, null])).toBeNull()
    expect(averageRating(FORM_SCALE, [])).toBeNull()
  })

  it('returns the exact ordinal for a single rated value', () => {
    expect(averageRating(ENERGY_SCALE, ['high'])).toEqual({ mean: 4, scaleMax: 5, count: 1 })
  })

  it("treats a rated 'none' as ordinal 1, not the same as an absent rating", () => {
    const result = averageRating(ENERGY_SCALE, ['none', 'supreme'])
    // none=1, supreme=5 -> mean 3, count 2
    expect(result).toEqual({ mean: 3, scaleMax: 5, count: 2 })
  })
})
