import type { MuscleSubgroup } from '../../types'
import {
  MUSCLE_SUBGROUP_CATEGORIES,
  MUSCLE_SUBGROUP_CATEGORY_LABELS,
  MUSCLE_SUBGROUP_GROUPS,
  MUSCLE_SUBGROUP_LABELS,
} from '../../lib/exerciseTags'
import TagChipGrid from './TagChipGrid'

// One TagChipGrid per §4.3 category, each under its own label — the
// grouping itself lives in exerciseTags.ts (the single source of truth),
// this component only lays it out. `selected` spans every category at
// once (a tag from "arms" and a tag from "chest" can both be active on the
// same exercise — COACH-WEEK-ANALYSIS-TASKS.md §4.4's own worked example),
// so toggling within any one category's grid reports through the same
// `onToggle` regardless of which category the tapped chip belongs to.
//
// `allowed` (EXERCISE-LIBRARY-TASKS.md muscle_group tag-filtering fix) is
// the flat set of tags the caller wants offered — normally
// `muscleSubgroupsForMuscleGroup(exercise.muscleGroup)` unioned with
// whatever's already selected, so an existing tag that falls outside the
// current muscle_group's set (a stale tag from before this fix, or from a
// muscle_group edit) still renders and stays toggleable rather than being
// silently hidden. This component has no muscle_group opinion of its own —
// it only renders whichever tags `allowed` contains, per category, and
// skips a category's whole section when nothing in it is allowed (e.g. no
// SHOULDERS section for a biceps exercise).
//
// Typed `MuscleSubgroup` (plain string), not exerciseTags.ts's narrower
// `MuscleSubgroupTag` union — `selected` carries whatever's actually stored
// on the exercise (§7.10's own reasoning: an unrecognised tag must degrade
// gracefully, never a type error), and `allowed` is built by unioning the
// known-vocabulary allowed set with that same `selected`, so it has to
// accept the same wide type.
export default function MuscleSubgroupPicker({
  selected,
  onToggle,
  allowed,
}: {
  selected: readonly MuscleSubgroup[]
  onToggle: (value: MuscleSubgroup) => void
  allowed: readonly MuscleSubgroup[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {MUSCLE_SUBGROUP_CATEGORIES.map((category) => {
        const values = MUSCLE_SUBGROUP_GROUPS[category].filter((tag) => allowed.includes(tag))
        if (values.length === 0) return null
        return (
          <div key={category}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: 'var(--text-dim)',
                marginBottom: 8,
              }}
            >
              {MUSCLE_SUBGROUP_CATEGORY_LABELS[category]}
            </span>
            <TagChipGrid values={values} labels={MUSCLE_SUBGROUP_LABELS} selected={selected} onToggle={onToggle} />
          </div>
        )
      })}
    </div>
  )
}
