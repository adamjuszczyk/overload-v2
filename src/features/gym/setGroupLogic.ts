// Pure grouping logic for the v3 dropset model (TASKS.md §2.1). A "group" is
// one head row (parent id null) plus its ordered stage rows (parent id ==
// head id, ordered by stage_index). Works for both v2_set_logs (SetLog) and
// v2_week_plan_sets (WeekPlanSet) via the accessor functions below — the
// grouping rule is identical on both tables, only the field names differ.
//
// Deliberately generic and side-effect free so it's independently testable
// (same precedent as referenceLogic.ts / formatRestTime.ts).

import type { SetLog, WeekPlanSet } from '../../types'

export interface SetGroup<T> {
  head: T
  stages: T[] // ordered by stage_index ascending
}

// Exported (not just the SetLog/WeekPlanSet wrappers below) so other flat
// per-row shapes that carry the same parent/stage-index relationship — e.g.
// historyService.ts's HistorySetRow — can group without re-deriving this
// algorithm a third time.
//
// Precondition: `rows` must be the complete row set for whatever scope is
// being grouped (a session's logs, a plan's sets, an exercise's history) —
// a stage whose parent id isn't present in `rows` is silently dropped from
// every group's stages (it can never become a head, since only rows with a
// null parent id do). Every current call site fetches its full scope in one
// query, so this never triggers; if a future caller ever passes a partial
// row set (e.g. a paginated fetch), this needs a rethink, not a silent gap.
export function groupByParent<T>(
  rows: T[],
  getId: (row: T) => string,
  getParentId: (row: T) => string | null,
  getStageIndex: (row: T) => number | undefined,
): SetGroup<T>[] {
  const stagesByParent = new Map<string, T[]>()
  const heads: T[] = []

  for (const row of rows) {
    const parentId = getParentId(row)
    if (parentId == null) {
      heads.push(row)
    } else {
      const list = stagesByParent.get(parentId)
      if (list) list.push(row)
      else stagesByParent.set(parentId, [row])
    }
  }

  return heads.map((head) => ({
    head,
    // Cached rows written before the stageIndex column existed carry
    // `undefined`, not 0 — treat that as 0 rather than crash (db.ts §2.1).
    stages: (stagesByParent.get(getId(head)) ?? []).sort(
      (a, b) => (getStageIndex(a) ?? 0) - (getStageIndex(b) ?? 0),
    ),
  }))
}

export function groupSetLogs(logs: SetLog[]): SetGroup<SetLog>[] {
  return groupByParent(
    logs,
    (l) => l.id,
    (l) => l.parentSetId,
    (l) => l.stageIndex,
  )
}

export function groupWeekPlanSets(sets: WeekPlanSet[]): SetGroup<WeekPlanSet>[] {
  return groupByParent(
    sets,
    (s) => s.id,
    (s) => s.parentWeekPlanSetId,
    (s) => s.stageIndex,
  )
}

// Heads only, in input order — the "count/index heads only" fix used
// throughout §2.7 items 1–3 wherever a full group isn't needed.
export function headsOnly<T>(rows: T[], getParentId: (row: T) => string | null): T[] {
  return rows.filter((row) => getParentId(row) == null)
}

// The stage_index to give a newly-added stage. Deliberately max(existing) +
// 1, not stages.length + 1 — those diverge once a non-last stage has been
// individually deleted (e.g. stages [1,2,3], delete 2 → [1,3], length is 2
// but the next free index is 4, not 3, which would collide with the
// survivor). A collision breaks stage ordering wherever stage_index is
// relied on to be a unique, strictly-increasing sequence within a group.
export function nextStageIndex<T>(
  group: SetGroup<T>,
  getStageIndex: (row: T) => number | undefined,
): number {
  return group.stages.reduce((max, s) => Math.max(max, getStageIndex(s) ?? 0), 0) + 1
}

// The client-side cascade guard's deletion order (TASKS.md §2.1 "The guard —
// cascade client-side, stages first"): stage rows first, in descending
// stage_index order, then the head last. This is deliberately the less
// obvious order. Head-first means a failure partway through this
// non-transactional mutation leaves permanently orphaned stages — the exact
// corruption the guard exists to prevent. Stages-first fails into a head
// with fewer stages: visible, harmless, re-deletable.
export function cascadeDeleteOrder<T>(
  group: SetGroup<T>,
  getStageIndex: (row: T) => number | undefined,
): T[] {
  const stagesDescending = [...group.stages].sort(
    (a, b) => (getStageIndex(b) ?? 0) - (getStageIndex(a) ?? 0),
  )
  return [...stagesDescending, group.head]
}
