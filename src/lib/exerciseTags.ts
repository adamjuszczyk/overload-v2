import type { MovementPattern, MuscleSubgroup } from '../types/index.js'

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
