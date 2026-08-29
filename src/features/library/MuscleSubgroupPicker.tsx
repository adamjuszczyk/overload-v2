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
export default function MuscleSubgroupPicker({
  selected,
  onToggle,
}: {
  selected: readonly MuscleSubgroup[]
  onToggle: (value: MuscleSubgroup) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {MUSCLE_SUBGROUP_CATEGORIES.map((category) => (
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
          <TagChipGrid
            values={MUSCLE_SUBGROUP_GROUPS[category]}
            labels={MUSCLE_SUBGROUP_LABELS}
            selected={selected}
            onToggle={onToggle}
          />
        </div>
      ))}
    </div>
  )
}
