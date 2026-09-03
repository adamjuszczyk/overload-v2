import { describe, it, expect } from 'vitest'
import type { MovementPattern, MuscleGroup } from '../types/index.js'
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  MOVEMENT_PATTERNS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_SUBGROUP_CATEGORIES,
  MUSCLE_SUBGROUP_CATEGORY_LABELS,
  MUSCLE_SUBGROUP_GROUPS,
  MUSCLE_SUBGROUPS,
  MUSCLE_SUBGROUP_LABELS,
  muscleSubgroupLabel,
  movementPatternsForMuscleGroup,
  muscleSubgroupsForMuscleGroup,
  type MuscleSubgroupTag,
} from './exerciseTags'

describe('MUSCLE_GROUPS', () => {
  // PRIORITY-CONTEXT-TASKS.md §0.1 finding 1: this module previously had no
  // canonical muscle_group list — types/index.ts:7's MuscleGroup type was
  // the only definition, copied verbatim into five components. Hardcoded
  // here (not imported from types/index.ts, which carries no runtime value)
  // as the same 12 values, same order, as the type declaration itself.
  it('matches MuscleGroup\'s declared 12 values exactly, same order', () => {
    expect(MUSCLE_GROUPS).toEqual([
      'chest', 'back', 'shoulders', 'biceps', 'triceps',
      'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
      'core', 'other',
    ])
  })

  it('has exactly twelve values, no duplicates', () => {
    expect(MUSCLE_GROUPS).toHaveLength(12)
    expect(new Set(MUSCLE_GROUPS).size).toBe(12)
  })

  it('has a label for every value and no extra label keys', () => {
    expect(Object.keys(MUSCLE_GROUP_LABELS).sort()).toEqual([...MUSCLE_GROUPS].sort())
  })

  it('labels are the full-word form, matching the majority of the five pre-existing duplicated copies (not History\'s narrow-chip "HAMS" abbreviation)', () => {
    expect(MUSCLE_GROUP_LABELS.hamstrings).toBe('HAMSTRINGS')
    expect(MUSCLE_GROUP_LABELS.other).toBe('OTHER')
  })
})

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

// EXERCISE-LIBRARY-TASKS.md muscle_group tag-filtering fix: the three tag
// pickers (ExerciseForm.tsx, ExerciseTagList.tsx, both via
// MuscleSubgroupPicker) used to offer all 7 patterns / all 22 subgroups for
// every exercise regardless of muscle_group. These two functions are the
// single shared source both surfaces now filter through.
describe('movementPatternsForMuscleGroup / muscleSubgroupsForMuscleGroup', () => {
  const ALL_MUSCLE_GROUPS: readonly MuscleGroup[] = [
    'chest', 'back', 'shoulders', 'biceps', 'triceps',
    'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
    'core', 'other',
  ]

  it('has a non-empty pattern set and a non-empty subgroup set for every muscle group', () => {
    for (const muscleGroup of ALL_MUSCLE_GROUPS) {
      expect(movementPatternsForMuscleGroup(muscleGroup).length).toBeGreaterThan(0)
      expect(muscleSubgroupsForMuscleGroup(muscleGroup).length).toBeGreaterThan(0)
    }
  })

  it("'other' is deliberately unfiltered — every pattern and every subgroup, the catch-all escape hatch", () => {
    expect(movementPatternsForMuscleGroup('other')).toEqual(MOVEMENT_PATTERNS)
    expect(muscleSubgroupsForMuscleGroup('other')).toEqual(MUSCLE_SUBGROUPS)
  })

  it('chest allows front_delt (a shoulders-category tag) — real precedent: Incline Barbell/Dumbbell/Smith Press', () => {
    expect(muscleSubgroupsForMuscleGroup('chest')).toContain('front_delt')
    expect(muscleSubgroupsForMuscleGroup('chest')).not.toContain('side_delt')
    expect(muscleSubgroupsForMuscleGroup('chest')).not.toContain('rear_delt')
  })

  it('shoulders allows traps (a back-category tag) — real precedent: Upright Row', () => {
    expect(muscleSubgroupsForMuscleGroup('shoulders')).toContain('traps')
  })

  it('hamstrings allows lower_back (Good Morning) and glutes (Romanian Deadlift)', () => {
    expect(muscleSubgroupsForMuscleGroup('hamstrings')).toEqual(
      expect.arrayContaining(['hamstrings', 'lower_back', 'glutes']),
    )
  })

  it('glutes does NOT allow hamstrings, despite the hamstrings->glutes precedent — rejected on review: migration 014 approved Deadlift back-only, and Hip Thrust is knee-flexed specifically to slacken the hamstrings', () => {
    expect(muscleSubgroupsForMuscleGroup('glutes')).toEqual(['glutes'])
  })

  it('quads does NOT allow adductors — the one real adductor exercise (Adduction Machine) was filed under muscle_group=other, not quads', () => {
    expect(muscleSubgroupsForMuscleGroup('quads')).not.toContain('adductors')
  })

  it('biceps/triceps/forearms stay disjoint from each other despite all three living in the "arms" subgroup category', () => {
    expect(muscleSubgroupsForMuscleGroup('biceps')).toEqual(['biceps', 'brachialis'])
    expect(muscleSubgroupsForMuscleGroup('triceps')).toEqual(['triceps_long_head', 'triceps_lateral_head'])
    expect(muscleSubgroupsForMuscleGroup('forearms')).toEqual(['forearms'])
  })

  it('triceps is the one muscle_group allowing all three of horizontal_push/vertical_push/isolation — real precedent: Close-Grip Bench Press, Dip machine (triceps), Skull Crusher', () => {
    expect(movementPatternsForMuscleGroup('triceps')).toEqual(
      expect.arrayContaining(['horizontal_push', 'vertical_push', 'isolation']),
    )
  })

  // The arithmetic proof, not just an assertion: every one of the app's 70
  // real, Adam-approved exercises (migration 014, cross-checked live
  // against production during this fix) has its actual muscle_group +
  // movement_pattern + muscle_subgroup already inside what this mapping
  // allows. A change to either mapping that orphans a real exercise's tag
  // fails this test, not just a manual spot check.
  const REAL_EXERCISES: ReadonlyArray<{
    name: string
    muscleGroup: MuscleGroup
    pattern: MovementPattern
    subgroups: readonly MuscleSubgroupTag[]
  }> = [
    { name: 'Barbell Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'Cable Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'Chin-Up', muscleGroup: 'back', pattern: 'vertical_pull', subgroups: ['lats'] },
    { name: 'Deadlift', muscleGroup: 'back', pattern: 'hip_hinge', subgroups: ['lower_back', 'traps'] },
    { name: 'Dumbbell Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'Lat Pulldown', muscleGroup: 'back', pattern: 'vertical_pull', subgroups: ['lats'] },
    { name: 'Lat Pulldown (machine)', muscleGroup: 'back', pattern: 'vertical_pull', subgroups: ['lats'] },
    { name: 'Neutral Lat Pulldown (cable)', muscleGroup: 'back', pattern: 'vertical_pull', subgroups: ['lats'] },
    { name: 'One-arm Cable Lat Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'One-arm Cable Pullover', muscleGroup: 'back', pattern: 'isolation', subgroups: ['lats'] },
    { name: 'Pendlay Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'Pull-Up', muscleGroup: 'back', pattern: 'vertical_pull', subgroups: ['lats'] },
    { name: 'Seated Cable Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'T-Bar Row', muscleGroup: 'back', pattern: 'horizontal_pull', subgroups: ['lats', 'mid_back'] },
    { name: 'Barbell Curl', muscleGroup: 'biceps', pattern: 'isolation', subgroups: ['biceps'] },
    { name: 'Dumbbell Curl', muscleGroup: 'biceps', pattern: 'isolation', subgroups: ['biceps'] },
    { name: 'Ezbar Preacher Curl', muscleGroup: 'biceps', pattern: 'isolation', subgroups: ['biceps'] },
    { name: 'Hammer Curl', muscleGroup: 'biceps', pattern: 'isolation', subgroups: ['biceps', 'brachialis'] },
    { name: 'One-arm Cable Curl', muscleGroup: 'biceps', pattern: 'isolation', subgroups: ['biceps'] },
    { name: 'Preacher Curl', muscleGroup: 'biceps', pattern: 'isolation', subgroups: ['biceps'] },
    { name: 'Seated Calf Raise', muscleGroup: 'calves', pattern: 'isolation', subgroups: ['calves'] },
    { name: 'Seated Machine Calf Raise', muscleGroup: 'calves', pattern: 'isolation', subgroups: ['calves'] },
    { name: 'Standing Calf Raise', muscleGroup: 'calves', pattern: 'isolation', subgroups: ['calves'] },
    { name: 'Standing Machine Calf Raise', muscleGroup: 'calves', pattern: 'isolation', subgroups: ['calves'] },
    { name: 'Barbell Bench Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['mid_chest'] },
    { name: 'Bench Supported Incline Cable Fly', muscleGroup: 'chest', pattern: 'isolation', subgroups: ['upper_chest'] },
    { name: 'Chest Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['mid_chest'] },
    { name: 'Dips', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['lower_chest'] },
    { name: 'Dumbbell Bench Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['mid_chest'] },
    { name: 'Dumbbell Fly', muscleGroup: 'chest', pattern: 'isolation', subgroups: ['mid_chest'] },
    { name: 'Incline Barbell Bench Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['upper_chest', 'front_delt'] },
    { name: 'Incline Dumbbell Bench Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['upper_chest', 'front_delt'] },
    { name: 'Incline Dumbell Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['upper_chest', 'front_delt'] },
    { name: 'Incline Smith Press', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['upper_chest', 'front_delt'] },
    { name: 'Pec Deck Fly', muscleGroup: 'chest', pattern: 'isolation', subgroups: ['mid_chest'] },
    { name: 'Push-Up', muscleGroup: 'chest', pattern: 'horizontal_push', subgroups: ['mid_chest'] },
    { name: 'Ab Wheel Rollout', muscleGroup: 'core', pattern: 'isolation', subgroups: ['abs'] },
    { name: 'Cable Crunch', muscleGroup: 'core', pattern: 'isolation', subgroups: ['abs'] },
    { name: 'Hanging Leg Raise', muscleGroup: 'core', pattern: 'isolation', subgroups: ['abs'] },
    { name: 'Plank', muscleGroup: 'core', pattern: 'isolation', subgroups: ['abs'] },
    { name: 'Cable Reverse Biceps Curl', muscleGroup: 'forearms', pattern: 'isolation', subgroups: ['forearms'] },
    { name: 'Hip Thrust', muscleGroup: 'glutes', pattern: 'hip_hinge', subgroups: ['glutes'] },
    { name: 'Hip Thrust (machine)', muscleGroup: 'glutes', pattern: 'hip_hinge', subgroups: ['glutes'] },
    { name: 'Good Morning', muscleGroup: 'hamstrings', pattern: 'hip_hinge', subgroups: ['hamstrings', 'lower_back'] },
    { name: 'Leg Curl', muscleGroup: 'hamstrings', pattern: 'isolation', subgroups: ['hamstrings'] },
    { name: 'Romanian Deadlift', muscleGroup: 'hamstrings', pattern: 'hip_hinge', subgroups: ['hamstrings', 'glutes'] },
    { name: 'Seated Leg Curl', muscleGroup: 'hamstrings', pattern: 'isolation', subgroups: ['hamstrings'] },
    { name: 'Adduction Machine', muscleGroup: 'other', pattern: 'isolation', subgroups: ['adductors'] },
    { name: 'Back Squat', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads', 'glutes'] },
    { name: 'Bulgarian Split Squat', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads', 'glutes'] },
    { name: 'Front Squat', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads'] },
    { name: 'Hack Squat', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads'] },
    { name: 'Leg Extension', muscleGroup: 'quads', pattern: 'isolation', subgroups: ['quads'] },
    { name: 'Leg Press', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads'] },
    { name: 'Squat', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads', 'glutes'] },
    { name: 'Walking Lunge', muscleGroup: 'quads', pattern: 'squat', subgroups: ['quads', 'glutes'] },
    { name: 'Cable Lateral Raise', muscleGroup: 'shoulders', pattern: 'isolation', subgroups: ['side_delt'] },
    { name: 'Face Pull', muscleGroup: 'shoulders', pattern: 'isolation', subgroups: ['rear_delt'] },
    { name: 'Lateral Raise', muscleGroup: 'shoulders', pattern: 'isolation', subgroups: ['side_delt'] },
    { name: 'One-arm Dumbell Lateral Raise', muscleGroup: 'shoulders', pattern: 'isolation', subgroups: ['side_delt'] },
    { name: 'Overhead Press', muscleGroup: 'shoulders', pattern: 'vertical_push', subgroups: ['front_delt', 'side_delt'] },
    { name: 'Rear Delt Fly', muscleGroup: 'shoulders', pattern: 'isolation', subgroups: ['rear_delt'] },
    { name: 'Seated Dumbbell Shoulder Press', muscleGroup: 'shoulders', pattern: 'vertical_push', subgroups: ['front_delt', 'side_delt'] },
    { name: 'Upright Row', muscleGroup: 'shoulders', pattern: 'isolation', subgroups: ['side_delt', 'traps'] },
    { name: 'Close-Grip Bench Press', muscleGroup: 'triceps', pattern: 'horizontal_push', subgroups: ['triceps_lateral_head'] },
    { name: 'Dip machine (triceps)', muscleGroup: 'triceps', pattern: 'vertical_push', subgroups: ['triceps_lateral_head'] },
    { name: 'Incline Skullcrusher', muscleGroup: 'triceps', pattern: 'isolation', subgroups: ['triceps_long_head'] },
    { name: 'Overhead Tricep Extension', muscleGroup: 'triceps', pattern: 'isolation', subgroups: ['triceps_long_head'] },
    { name: 'Skull Crusher', muscleGroup: 'triceps', pattern: 'isolation', subgroups: ['triceps_long_head'] },
    { name: 'Tricep Pushdown', muscleGroup: 'triceps', pattern: 'isolation', subgroups: ['triceps_lateral_head'] },
  ]

  it('has exactly 70 real exercises in this fixture, matching the account\'s real row count', () => {
    expect(REAL_EXERCISES).toHaveLength(70)
  })

  it('every real exercise\'s actual movement_pattern is inside its muscle_group\'s allowed pattern set', () => {
    for (const ex of REAL_EXERCISES) {
      expect(
        movementPatternsForMuscleGroup(ex.muscleGroup),
        `${ex.name} (${ex.muscleGroup}): pattern "${ex.pattern}"`,
      ).toContain(ex.pattern)
    }
  })

  it('every real exercise\'s actual muscle_subgroup tags are all inside its muscle_group\'s allowed subgroup set', () => {
    for (const ex of REAL_EXERCISES) {
      const allowed = muscleSubgroupsForMuscleGroup(ex.muscleGroup)
      for (const tag of ex.subgroups) {
        expect(allowed, `${ex.name} (${ex.muscleGroup}): subgroup "${tag}"`).toContain(tag)
      }
    }
  })
})
