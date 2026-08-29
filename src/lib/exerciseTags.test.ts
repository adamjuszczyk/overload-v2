import { describe, it, expect } from 'vitest'
import {
  MOVEMENT_PATTERNS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_SUBGROUP_CATEGORIES,
  MUSCLE_SUBGROUP_CATEGORY_LABELS,
  MUSCLE_SUBGROUP_GROUPS,
  MUSCLE_SUBGROUPS,
  MUSCLE_SUBGROUP_LABELS,
  muscleSubgroupLabel,
} from './exerciseTags'

describe('MOVEMENT_PATTERNS', () => {
  // The critical test (EXERCISE-LIBRARY-TASKS.md §8 step 4): these seven
  // values, in this order, must match migration 013's
  // `exercises_movement_pattern_chk` exactly — read directly from
  // supabase/migrations/013_v3_coach_week_analysis.sql, not retyped from
  // memory. Drift here means a value that typechecks in the UI produces a
  // runtime 23514.
  it('matches migration 013\'s CHECK constraint exactly, same order', () => {
    expect(MOVEMENT_PATTERNS).toEqual([
      'horizontal_push', 'vertical_push',
      'horizontal_pull', 'vertical_pull',
      'hip_hinge', 'squat', 'isolation',
    ])
  })

  it('has exactly seven values, no duplicates', () => {
    expect(MOVEMENT_PATTERNS).toHaveLength(7)
    expect(new Set(MOVEMENT_PATTERNS).size).toBe(7)
  })

  it('has a label for every value and no extra label keys', () => {
    expect(Object.keys(MOVEMENT_PATTERN_LABELS).sort()).toEqual([...MOVEMENT_PATTERNS].sort())
  })

  it('labels are upper-case with spaces, not raw snake_case', () => {
    expect(MOVEMENT_PATTERN_LABELS.horizontal_push).toBe('HORIZONTAL PUSH')
    expect(MOVEMENT_PATTERN_LABELS.hip_hinge).toBe('HIP HINGE')
    expect(MOVEMENT_PATTERN_LABELS.isolation).toBe('ISOLATION')
  })
})

describe('MUSCLE_SUBGROUP_CATEGORIES', () => {
  it('is the six buckets COACH-WEEK-ANALYSIS-TASKS.md §4.3 groups the vocabulary under', () => {
    expect(MUSCLE_SUBGROUP_CATEGORIES).toEqual(['chest', 'back', 'shoulders', 'arms', 'legs', 'core'])
  })

  it('has a label for every category and no extra label keys', () => {
    expect(Object.keys(MUSCLE_SUBGROUP_CATEGORY_LABELS).sort()).toEqual(
      [...MUSCLE_SUBGROUP_CATEGORIES].sort(),
    )
  })
})

describe('MUSCLE_SUBGROUP_GROUPS', () => {
  // §4.3's proposal, verbatim — read directly from
  // COACH-WEEK-ANALYSIS-TASKS.md, not reconstructed from summary.
  it('matches §4.3\'s proposed grouping exactly, per category', () => {
    expect(MUSCLE_SUBGROUP_GROUPS.chest).toEqual(['upper_chest', 'mid_chest', 'lower_chest'])
    expect(MUSCLE_SUBGROUP_GROUPS.back).toEqual(['lats', 'mid_back', 'lower_back', 'traps'])
    expect(MUSCLE_SUBGROUP_GROUPS.shoulders).toEqual(['front_delt', 'side_delt', 'rear_delt'])
    expect(MUSCLE_SUBGROUP_GROUPS.arms).toEqual([
      'biceps', 'brachialis', 'triceps_long_head', 'triceps_lateral_head', 'forearms',
    ])
    expect(MUSCLE_SUBGROUP_GROUPS.legs).toEqual(['quads', 'hamstrings', 'glutes', 'adductors', 'calves'])
    expect(MUSCLE_SUBGROUP_GROUPS.core).toEqual(['abs', 'obliques'])
  })

  it('every category from MUSCLE_SUBGROUP_CATEGORIES has a group, and no extras', () => {
    expect(Object.keys(MUSCLE_SUBGROUP_GROUPS).sort()).toEqual([...MUSCLE_SUBGROUP_CATEGORIES].sort())
  })
})

describe('MUSCLE_SUBGROUPS', () => {
  it('has exactly 22 values, matching §4.3\'s proposed vocabulary size', () => {
    expect(MUSCLE_SUBGROUPS).toHaveLength(22)
  })

  it('has no duplicate values across categories', () => {
    expect(new Set(MUSCLE_SUBGROUPS).size).toBe(22)
  })

  it('is exactly the flattened union of every category\'s group, in category order', () => {
    expect(MUSCLE_SUBGROUPS).toEqual([
      'upper_chest', 'mid_chest', 'lower_chest',
      'lats', 'mid_back', 'lower_back', 'traps',
      'front_delt', 'side_delt', 'rear_delt',
      'biceps', 'brachialis', 'triceps_long_head', 'triceps_lateral_head', 'forearms',
      'quads', 'hamstrings', 'glutes', 'adductors', 'calves',
      'abs', 'obliques',
    ])
  })

  // Cross-check against real, applied data: every one of these was
  // actually written to a live exercises row by migration 014 (confirmed
  // by reading that migration file directly, not from memory) — so the
  // vocabulary this module exports isn't just the proposal, it's provably
  // a superset of what's already in production.
  it('includes every muscle_subgroup value migration 014 actually applied', () => {
    const appliedByMigration014 = [
      'lats', 'mid_back', 'lower_back', 'traps',
      'biceps', 'brachialis',
      'calves',
      'mid_chest', 'upper_chest', 'lower_chest', 'front_delt',
      'abs',
      'forearms',
      'glutes',
      'hamstrings',
      'adductors',
      'quads',
      'side_delt', 'rear_delt',
      'triceps_lateral_head', 'triceps_long_head',
    ]
    for (const value of appliedByMigration014) {
      expect(MUSCLE_SUBGROUPS).toContain(value)
    }
  })

  it('includes "obliques" even though no real exercise has ever used it', () => {
    // §4.3 proposes it; migration 014 never assigned it to a row (no
    // rotational/oblique-specific exercise exists on this account). A
    // vocabulary value being unused is not the same as it not existing —
    // this module is the proposal's source of truth, not a report of
    // what happens to be applied today.
    expect(MUSCLE_SUBGROUPS).toContain('obliques')
  })

  it('has a label for every value and no extra label keys', () => {
    expect(Object.keys(MUSCLE_SUBGROUP_LABELS).sort()).toEqual([...MUSCLE_SUBGROUPS].sort())
  })
})

describe('muscleSubgroupLabel', () => {
  it('returns the dictionary label for a known tag', () => {
    expect(muscleSubgroupLabel('upper_chest')).toBe('UPPER CHEST')
    expect(muscleSubgroupLabel('triceps_long_head')).toBe('TRICEPS LONG HEAD')
    expect(muscleSubgroupLabel('obliques')).toBe('OBLIQUES')
  })

  // The load-bearing behaviour: MuscleSubgroup is app-layer-only and not
  // DB-enforced (§7.10), so a value this module doesn't recognise —
  // written directly via the SQL Editor, say, or added in a future
  // migration this module hasn't been updated for — must still render as
  // something readable, never throw and never silently disappear.
  it('degrades an unrecognised tag to an uppercased, space-joined label instead of throwing', () => {
    expect(muscleSubgroupLabel('some_future_tag')).toBe('SOME FUTURE TAG')
  })

  it('degrades a single-word unrecognised tag with no underscores', () => {
    expect(muscleSubgroupLabel('neck')).toBe('NECK')
  })
})
