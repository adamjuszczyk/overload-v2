import type { MovementPattern, MuscleGroup, MuscleSubgroup } from '../types/index.js'

// Vocabulary module for exercises.muscle_subgroup / .movement_pattern
// (EXERCISE-LIBRARY-TASKS.md §2.6/§8 step 4) — same precedent as
// setGroupLogic.ts, e1rm.ts, ratingScales.ts: pure, no React, no Supabase,
// the one place this vocabulary and its display labels are decided, so no
// component embeds a second copy of it.
//
// §7.10's asymmetry survives intact: movement_pattern stays DB-enforced by
// migration 013's CHECK *and* is now mirrored here — MOVEMENT_PATTERNS
// below must match that constraint exactly, or a value that typechecks in
// the UI produces a runtime 23514. muscle_subgroup has no DB constraint
// and this module does not add one (EXERCISE-LIBRARY-TASKS.md §8 step 4) —
// it becomes the single source of truth for that vocabulary going
// forward. Migration 014 and COACH-WEEK-ANALYSIS-TASKS.md §4.3 remain the
// historical record, not a second place code should read it from; both
// were read directly while writing this module (not reconstructed from
// summary) and agree exactly — every value migration 014 ever wrote is
// among §4.3's proposed 22, and only 'obliques' from that proposal was
// never assigned to a real exercise on the account.

// The muscle_group vocabulary (PRIORITY-CONTEXT-TASKS.md §0.1 finding 1) —
// this module owns muscle_subgroup and movement_pattern already but, until
// now, had no canonical muscle_group list or label map of its own: the
// 12-value MuscleGroup type (types/index.ts) had five verbatim local copies
// across components and no single source. Added here as the sixth, and the
// only one anything new should import going forward — the five existing
// copies are deliberately left alone (their label maps have already
// diverged for real layout reasons, e.g. a narrow filter chip rendering
// 'HAMS' instead of 'HAMSTRINGS'), so this export doesn't silently change
// any of their UIs.
export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'CHEST',
  back: 'BACK',
  shoulders: 'SHOULDERS',
  biceps: 'BICEPS',
  triceps: 'TRICEPS',
  forearms: 'FOREARMS',
  quads: 'QUADS',
  hamstrings: 'HAMSTRINGS',
  glutes: 'GLUTES',
  calves: 'CALVES',
  core: 'CORE',
  other: 'OTHER',
}

// Exactly migration 013's `exercises_movement_pattern_chk`, same order.
export const MOVEMENT_PATTERNS: readonly MovementPattern[] = [
  'horizontal_push', 'vertical_push',
  'horizontal_pull', 'vertical_pull',
  'hip_hinge', 'squat', 'isolation',
]

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  horizontal_push: 'HORIZONTAL PUSH',
  vertical_push: 'VERTICAL PUSH',
  horizontal_pull: 'HORIZONTAL PULL',
  vertical_pull: 'VERTICAL PULL',
  hip_hinge: 'HIP HINGE',
  squat: 'SQUAT',
  isolation: 'ISOLATION',
}

// The six category buckets COACH-WEEK-ANALYSIS-TASKS.md §4.3 grouped the
// subgroup vocabulary under — coarser than the app's 12-value MuscleGroup
// (no separate biceps/triceps/forearms or quads/hamstrings/glutes/calves
// buckets here), because that is the grouping the source proposal itself
// specifies, not a reconstruction. Display-only categories for a
// sensibly-ordered grid, not a filter keyed to an exercise's own
// muscleGroup — §4.4's own worked example (an incline press tagged both
// upper_chest and front_delt) already shows a subgroup tag routinely
// crossing muscle_group lines, and migration 014 tags several exercises
// this way for real (e.g. Incline Barbell Bench Press: chest muscle_group,
// upper_chest + front_delt subgroups).
export type MuscleSubgroupCategory = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core'

export const MUSCLE_SUBGROUP_CATEGORIES: readonly MuscleSubgroupCategory[] = [
  'chest', 'back', 'shoulders', 'arms', 'legs', 'core',
]

export const MUSCLE_SUBGROUP_CATEGORY_LABELS: Record<MuscleSubgroupCategory, string> = {
  chest: 'CHEST',
  back: 'BACK',
  shoulders: 'SHOULDERS',
  arms: 'ARMS',
  legs: 'LEGS',
  core: 'CORE',
}

// COACH-WEEK-ANALYSIS-TASKS.md §4.3's proposal, verbatim.
const MUSCLE_SUBGROUP_GROUPS_CONST = {
  chest: ['upper_chest', 'mid_chest', 'lower_chest'],
  back: ['lats', 'mid_back', 'lower_back', 'traps'],
  shoulders: ['front_delt', 'side_delt', 'rear_delt'],
  arms: ['biceps', 'brachialis', 'triceps_long_head', 'triceps_lateral_head', 'forearms'],
  legs: ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'],
  core: ['abs', 'obliques'],
} as const satisfies Record<MuscleSubgroupCategory, readonly string[]>

// The known 22-value vocabulary, derived from the grouping above rather
// than retyped — one definition, not two lists that could drift apart.
export type MuscleSubgroupTag = (typeof MUSCLE_SUBGROUP_GROUPS_CONST)[MuscleSubgroupCategory][number]

export const MUSCLE_SUBGROUP_GROUPS: Record<MuscleSubgroupCategory, readonly MuscleSubgroupTag[]> =
  MUSCLE_SUBGROUP_GROUPS_CONST

// Flattened, in category order — the full 22-value vocabulary as one
// list, for callers that don't need the grouping (e.g. validation).
export const MUSCLE_SUBGROUPS: readonly MuscleSubgroupTag[] = MUSCLE_SUBGROUP_CATEGORIES.flatMap(
  (category) => MUSCLE_SUBGROUP_GROUPS[category],
)

export const MUSCLE_SUBGROUP_LABELS: Record<MuscleSubgroupTag, string> = {
  upper_chest: 'UPPER CHEST',
  mid_chest: 'MID CHEST',
  lower_chest: 'LOWER CHEST',
  lats: 'LATS',
  mid_back: 'MID BACK',
  lower_back: 'LOWER BACK',
  traps: 'TRAPS',
  front_delt: 'FRONT DELT',
  side_delt: 'SIDE DELT',
  rear_delt: 'REAR DELT',
  biceps: 'BICEPS',
  brachialis: 'BRACHIALIS',
  triceps_long_head: 'TRICEPS LONG HEAD',
  triceps_lateral_head: 'TRICEPS LATERAL HEAD',
  forearms: 'FOREARMS',
  quads: 'QUADS',
  hamstrings: 'HAMSTRINGS',
  glutes: 'GLUTES',
  adductors: 'ADDUCTORS',
  calves: 'CALVES',
  abs: 'ABS',
  obliques: 'OBLIQUES',
}

// The one safe way to label a *stored* muscle_subgroup value: MuscleSubgroup
// is deliberately `string`, not this module's literal union (types/
// index.ts's own reasoning — a tag this module doesn't recognise must
// degrade to a readable label, never a type error or a dropped
// occurrence), so a plain `MUSCLE_SUBGROUP_LABELS[tag]` index doesn't
// typecheck against it. No equivalent is exported for movement_pattern:
// that vocabulary is DB-enforced, so a real MovementPattern value can
// always index MOVEMENT_PATTERN_LABELS directly.
export function muscleSubgroupLabel(tag: MuscleSubgroup): string {
  const known = MUSCLE_SUBGROUP_LABELS[tag as MuscleSubgroupTag] as string | undefined
  return known ?? tag.replace(/_/g, ' ').toUpperCase()
}

// Which movement_pattern / muscle_subgroup values are actually valid for a
// given muscle_group — the tag pickers used to offer all 7 patterns and all
// 22 subgroups regardless of muscle_group, which let a chest exercise be
// tagged squat or a biceps exercise be tagged lower_chest. Derived from two
// sources, not guessed: (1) migration 014's real, Adam-approved tagging of
// all 70 exercises — cross-checked so every real (muscle_group, pattern,
// subgroup) combination in production is a subset of the set below, and (2)
// migration 014's own stated structural rule ("fly/pullover/raise ->
// isolation regardless of prime mover; compound press/pull tagged by
// structure, not by library filing"), extended to allow a pattern/subgroup
// that's anatomically valid for a muscle_group even where no exercise uses
// it yet today — same "valid but unused" treatment this file already gives
// 'obliques' under core.
//
// Cross-category entries are deliberate, not a mistake: chest exercises can
// carry front_delt (Incline Barbell/Dumbbell/Smith Press all do, migration
// 014), shoulders can carry traps (Upright Row), hamstrings can carry
// lower_back (Good Morning) and glutes (Romanian Deadlift). One entry was
// considered and rejected during review: glutes carrying hamstrings, by
// analogy to hamstrings->glutes — rejected because migration 014's own
// approved Deadlift filing (back-only {lower_back,traps}, deliberately
// omitting hamstrings/glutes despite obvious anatomical loading) shows this
// app's convention is "reviewed and approved for that exercise," not
// "anatomically active in the lift," and because Hip Thrust is performed
// knee-flexed specifically to slacken the hamstrings — the opposite
// mechanism from RDL, where knee-extension keeps hamstrings genuinely
// loaded as a co-prime-mover.
//
// 'other' is deliberately left unfiltered (every pattern, every subgroup):
// it's the app's explicit catch-all MuscleGroup value with no defined
// anatomical territory (EXERCISE-LIBRARY-TASKS.md/types/index.ts), and
// filtering it would make it unusable for exactly the edge-case exercises
// it exists to hold — e.g. Adduction Machine, the one real 'other' row,
// which needed 'adductors' + 'isolation' available and would not fit any
// of the other 11 groups' sets.
//
// Two flagged, unresolved judgment calls, carried here rather than guessed
// past: (1) glutes' 'isolation' pattern is allowed but currently unused (only
// hip_hinge exists via the two Hip Thrust rows) — included for a future
// glute-isolation machine exercise (cable kickback, hip abduction) by the
// same structural-rule reasoning above, but it's a pre-emptive allowance,
// not something a real exercise has needed yet. (2) quads does NOT carry
// 'adductors', even though the 22-value vocabulary's own 'legs' category
// groups adductors alongside quads/hamstrings/glutes/calves — a future
// adductor-dominant squat/lunge variant (Sumo Squat, Cossack Squat) would
// need it, but the one real adductor exercise today (Adduction Machine) was
// filed under muscle_group='other' rather than 'quads', which reads as a
// real signal the product owner wants adductors kept out of the named leg
// groups specifically. Left out; 'other' remains available for such a case
// until this is confirmed either way.
const MOVEMENT_PATTERNS_BY_MUSCLE_GROUP: Record<MuscleGroup, readonly MovementPattern[]> = {
  chest: ['horizontal_push', 'isolation'],
  back: ['horizontal_pull', 'vertical_pull', 'hip_hinge', 'isolation'],
  shoulders: ['vertical_push', 'isolation'],
  biceps: ['isolation'],
  triceps: ['horizontal_push', 'vertical_push', 'isolation'],
  forearms: ['isolation'],
  quads: ['squat', 'isolation'],
  hamstrings: ['hip_hinge', 'isolation'],
  glutes: ['hip_hinge', 'isolation'],
  calves: ['isolation'],
  core: ['isolation'],
  other: MOVEMENT_PATTERNS,
}

const MUSCLE_SUBGROUPS_BY_MUSCLE_GROUP: Record<MuscleGroup, readonly MuscleSubgroupTag[]> = {
  chest: ['upper_chest', 'mid_chest', 'lower_chest', 'front_delt'],
  back: ['lats', 'mid_back', 'lower_back', 'traps'],
  shoulders: ['front_delt', 'side_delt', 'rear_delt', 'traps'],
  biceps: ['biceps', 'brachialis'],
  triceps: ['triceps_long_head', 'triceps_lateral_head'],
  forearms: ['forearms'],
  quads: ['quads', 'glutes'],
  hamstrings: ['hamstrings', 'glutes', 'lower_back'],
  glutes: ['glutes'],
  calves: ['calves'],
  core: ['abs', 'obliques'],
  other: MUSCLE_SUBGROUPS,
}

export function movementPatternsForMuscleGroup(muscleGroup: MuscleGroup): readonly MovementPattern[] {
  return MOVEMENT_PATTERNS_BY_MUSCLE_GROUP[muscleGroup]
}

export function muscleSubgroupsForMuscleGroup(muscleGroup: MuscleGroup): readonly MuscleSubgroupTag[] {
  return MUSCLE_SUBGROUPS_BY_MUSCLE_GROUP[muscleGroup]
}
