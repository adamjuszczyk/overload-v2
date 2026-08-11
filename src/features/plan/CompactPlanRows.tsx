// Compact display mode (TASKS.md §4 item 32 / SPEC §5) — collapses an
// exercise's repeated plain-set rows into one "N× sets" line instead of N
// stacked rows. A dropset always renders as its own entry (never merged with
// a plain run or with another dropset), annotated with its stage count,
// since merging it would misrepresent what's actually planned for that set.
// The order-preserving grouping itself lives in compactPlanLogic.ts (pure,
// tested) — this file is presentational only.
//
// No exercise name in the line itself (post-launch fix, 2026-08-10) — it's
// redundant with ExerciseSection's own header row immediately above every
// one of these, which already names the exercise. Decision on merging
// consecutive same-stage-count dropsets (also part of that fix): kept them
// never merging, matching Phase 3.7's deliberate, tested behaviour
// (compactPlanLogic.test.ts's "never merges two adjacent dropsets... even
// with equal stage counts") — toRuns itself is unchanged, only this file's
// label text changed from "1× Exercise Name +K stages" to
// "1× dropsets (K stages)".
//
// Counts groups (heads), never raw rows — a group's stages never inflate
// the count, matching the stage-exclusion rule (§2.1) every other §2.7 site
// already applies. Read-only: compact mode is a glance view, not an editing
// surface — toggle back to expanded to edit RIR or add/remove stages.

import type { WeekPlanSet } from '../../types'
import type { SetGroup as Group } from '../gym/setGroupLogic'
import { toRuns } from './compactPlanLogic'

export default function CompactPlanRows({ groups }: { groups: Group<WeekPlanSet>[] }) {
  if (groups.length === 0) return null

  return (
    <div style={{ paddingBottom: 10 }}>
      {toRuns(groups).map((run, i) => (
        <CompactLine
          key={i}
          text={
            run.stageCount === 0
              ? `${run.count}× sets`
              // toRuns never merges dropsets (see this file's header
              // comment), so run.count is always exactly 1 here — singular
              // "dropset" is the only value this can ever read, but it's
              // pluralized properly anyway rather than hardcoded (found by
              // adversarial review: the original always read the grammatically
              // wrong "1× dropsets"), same pattern as the stage count next to it.
              : `${run.count}× dropset${run.count === 1 ? '' : 's'} (${run.stageCount} stage${run.stageCount === 1 ? '' : 's'})`
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
