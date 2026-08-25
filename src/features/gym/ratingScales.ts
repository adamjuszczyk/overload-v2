import type { FormRating, EnergyRating, PumpRating } from '../../types/index.js'

// Pure vocabulary/aggregation module (COACH-PERSONALIZATION-TASKS.md §2.2) —
// same precedent as setGroupLogic.ts, referenceLogic.ts, e1rm.ts,
// weightUnit.ts, positionMatch.ts, compactPlanLogic.ts, weekBuckets.ts: the
// one place the vocabulary, its display labels, and the ordinal scale used
// for averaging are decided, so no component embeds this logic itself.

export interface RatingScale<T extends string> {
  values: readonly T[]        // ordered low → high; also the chip order
  labels: Record<T, string>   // 'extra_controlled' → 'EXTRA CONTROLLED'
}

export interface RatingAverage {
  mean: number       // 1-based, matching toOrdinal
  scaleMax: number   // 4 or 5 — always rendered, never dropped
  count: number       // how many rated values produced it
}

export const FORM_SCALE: RatingScale<FormRating> = {
  values: ['rushed', 'normal', 'controlled', 'extra_controlled'],
  labels: {
    rushed: 'RUSHED',
    normal: 'NORMAL',
    controlled: 'CONTROLLED',
    extra_controlled: 'EXTRA CONTROLLED',
  },
}

export const ENERGY_SCALE: RatingScale<EnergyRating> = {
  values: ['none', 'low', 'normal', 'high', 'supreme'],
  labels: {
    none: 'NONE',
    low: 'LOW',
    normal: 'NORMAL',
    high: 'HIGH',
    supreme: 'SUPREME',
  },
}

export const PUMP_SCALE: RatingScale<PumpRating> = {
  values: ['none', 'some', 'good', 'extreme'],
  labels: {
    none: 'NONE',
    some: 'SOME',
    good: 'GOOD',
    extreme: 'EXTREME',
  },
}

export function toOrdinal<T extends string>(scale: RatingScale<T>, value: T): number {
  return scale.values.indexOf(value) + 1
}

// null for zero rated values, never 0 — a 0 would render as a real rating
// rather than "nothing to average" (TASKS.md §2.2).
export function averageRating<T extends string>(
  scale: RatingScale<T>,
  values: (T | null)[],
): RatingAverage | null {
  const rated = values.filter((v): v is T => v != null)
  if (rated.length === 0) return null
  const sum = rated.reduce((total, v) => total + toOrdinal(scale, v), 0)
  return { mean: sum / rated.length, scaleMax: scale.values.length, count: rated.length }
}
