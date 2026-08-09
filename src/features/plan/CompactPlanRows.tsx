// Compact display mode (TASKS.md §4 item 32 / SPEC §5) — collapses an
// exercise's repeated plain-set rows into one "N× Exercise Name" line
// instead of N stacked rows. A dropset always renders as its own entry
// (never merged with a plain run or with another dropset), annotated with
// its stage count, since merging it would misrepresent what's actually
// planned for that set. The order-preserving grouping itself lives in
// compactPlanLogic.ts (pure, tested) — this file is presentational only.
//
// Counts groups (heads), never raw rows — a group's stages never inflate
// the count, matching the stage-exclusion rule (§2.1) every other §2.7 site
// already applies. Read-only: compact mode is a glance view, not an editing
// surface — toggle back to expanded to edit RIR or add/remove stages.

import type { WeekPlanSet } from '../../types'
import type { SetGroup as Group } from '../gym/setGroupLogic'
import { toRuns } from './compactPlanLogic'

export default function CompactPlanRows({
  exerciseName,
  groups,
}: {
  exerciseName: string
  groups: Group<WeekPlanSet>[]
}) {
  if (groups.length === 0) return null

  return (
    <div style={{ paddingBottom: 10 }}>
      {toRuns(groups).map((run, i) => (
        <CompactLine
          key={i}
          text={
            run.stageCount === 0
              ? `${run.count}× ${exerciseName}`
              : `1× ${exerciseName} +${run.stageCount} stage${run.stageCount === 1 ? '' : 's'}`
          }
        />
      ))}
    </div>
  )
}

function CompactLine({ text }: { text: string }) {
  return (
    <div style={{ padding: '4px 16px' }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 13,
          color: 'var(--text-primary)',
        }}
      >
        {text}
      </span>
    </div>
  )
}
