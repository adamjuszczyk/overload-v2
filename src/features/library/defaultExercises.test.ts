import { describe, it, expect } from 'vitest'
import { DEFAULT_EXERCISES } from './defaultExercises'
import type { MuscleGroup } from '../../types'

// Independently listed from the MuscleGroup type (src/types/index.ts), not
// derived from DEFAULT_EXERCISES itself — a list built from the data under
// test couldn't fail on a coverage gap.
const ALL_MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]
const VALID_MUSCLE_GROUPS = new Set(ALL_MUSCLE_GROUPS)

// The given default-exercise list (SPEC §9) has no dedicated "forearm"
// exercise and no seedable entry for the 'other' catch-all — these two
// picker categories are deliberately left empty, not an oversight. Listed
// explicitly so a future change to either intent shows up as a failing
// assertion here rather than as a silent gap.
const INTENTIONALLY_UNSEEDED: MuscleGroup[] = ['forearms', 'other']

describe('DEFAULT_EXERCISES', () => {
  it('every entry has a non-empty name and a valid muscle group', () => {
    for (const ex of DEFAULT_EXERCISES) {
      expect(ex.name.trim()).toBe(ex.name)
      expect(ex.name.length).toBeGreaterThan(0)
      expect(VALID_MUSCLE_GROUPS.has(ex.muscleGroup)).toBe(true)
    }
  })

  it('has no duplicate names', () => {
    const names = DEFAULT_EXERCISES.map((ex) => ex.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers every picker muscle group except the deliberately unseeded ones', () => {
    const groups = new Set(DEFAULT_EXERCISES.map((ex) => ex.muscleGroup))
    for (const g of ALL_MUSCLE_GROUPS) {
      const shouldBeCovered = !INTENTIONALLY_UNSEEDED.includes(g)
      expect(groups.has(g)).toBe(shouldBeCovered)
    }
  })
})
