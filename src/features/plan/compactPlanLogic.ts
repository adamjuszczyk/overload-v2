// Pure logic for compact display mode (TASKS.md §4 item 32 / SPEC §5).
// Extracted from CompactPlanRows.tsx so it's independently testable — same
// precedent as setGroupLogic.ts/e1rm.ts/referenceLogic.ts.
//
// Groups must already be in true set order (PlanPage.tsx sorts by
// set_number before calling in) — toRuns preserves that order rather than
// bucketing all plain sets before all dropsets, which is what Phase 3.7's
// adversarial review caught: a fixed "plain, then dropsets" partition made
// toggling COMPACT imply a different set order than expanded mode shows for
// identical underlying data whenever a dropset sits between plain sets.

import type { WeekPlanSet } from '../../types'
import type { SetGroup as Group } from '../gym/setGroupLogic'

export interface Run {
  count: number
  stageCount: number // 0 = a run of plain sets; >0 = a single dropset's stage count
}

// Consecutive plain groups merge into one run (the "3× Bench Press"
// collapse). A dropset never merges with anything — not with a plain run,
// not with another dropset — so its stage count always reads as its own
// entry, and its position in the output always matches its position in the
// input (which is what makes compact mode order-faithful to expanded mode).
export function toRuns(groups: Group<WeekPlanSet>[]): Run[] {
  const runs: Run[] = []
  for (const g of groups) {
    const stageCount = g.stages.length
    const last = runs[runs.length - 1]
    if (stageCount === 0 && last && last.stageCount === 0) {
      last.count += 1
    } else {
      runs.push({ count: 1, stageCount })
    }
  }
  return runs
}
