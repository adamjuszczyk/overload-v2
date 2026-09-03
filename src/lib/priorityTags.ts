import { MUSCLE_GROUPS } from './exerciseTags.js'
import type { MuscleSubgroupTag } from './exerciseTags.js'
import type { MuscleGroup } from '../types/index.js'

// Priority Context's own vocabulary and pure structure
// (PRIORITY-CONTEXT-TASKS.md §3) — same precedent as exerciseTags.ts,
// setGroupLogic.ts, e1rm.ts, ratingScales.ts: pure, no React, no Supabase.
// Nothing here is meso-aware — the meso scope lives entirely in the query
// (priorityContext.ts) and the row key (migration 024). Placed beside
// exerciseTags.ts (whose vocabulary it extends) rather than under
// features/coach/ because it must be importable from a Vercel function too.

export type PriorityLevel = 'low' | 'normal' | 'high' | 'top'
export type PriorityTagType = 'muscle_group' | 'muscle_subgroup'

// RatingScale<T>'s shape (ratingScales.ts:9), not the module — TASKS §0.1
// finding 3 is why RatingChips.tsx/its scale type aren't reused directly:
// priority has no "absence" value, so the shared nullable-chip contract
// doesn't fit.
export const PRIORITY_SCALE: {
  values: readonly PriorityLevel[]
  labels: Record<PriorityLevel, string>
} = {
  values: ['low', 'normal', 'high', 'top'],
  labels: {
    low: 'LOW',
    normal: 'NORMAL',
    high: 'HIGH',
    top: 'TOP',
  },
}

export const DEFAULT_PRIORITY: PriorityLevel = 'normal'

// The muscle_group -> muscle_subgroup partition SPEC §3's compositional
// semantic requires (TASKS §0.1 finding 2 / §3.2, A1 approved): each of the
// 12 groups mapped to a *disjoint* set of subgroups, covering all 22 exactly
// once. Derived from exerciseTags.ts's MUSCLE_SUBGROUP_GROUPS by splitting
// its 'arms' category across biceps/triceps/forearms and its 'legs' category
// across quads/hamstrings/glutes/calves — not invented from anatomy, and
// deliberately NOT the same as exerciseTags.ts's own
// muscleSubgroupsForMuscleGroup(), which is a *validity* map (what an
// exercise in that group may be tagged) built with intentional overlaps —
// rendering that map as a partition would give 26 rows for 21 distinct
// subgroups and leave 'adductors' unreachable under any of the 11 named
// groups. Order matches MuscleGroup's own declared order (types/index.ts),
// which is also this table's row order.
export const PRIORITY_TREE: Record<MuscleGroup, readonly MuscleSubgroupTag[]> = {
  chest: ['upper_chest', 'mid_chest', 'lower_chest'],
  back: ['lats', 'mid_back', 'lower_back', 'traps'],
  shoulders: ['front_delt', 'side_delt', 'rear_delt'],
  biceps: ['biceps', 'brachialis'],
  triceps: ['triceps_long_head', 'triceps_lateral_head'],
  forearms: ['forearms'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes'],
  calves: ['calves'],
  core: ['abs', 'obliques'],
  other: ['adductors'],
}

// Exact inverse of PRIORITY_TREE. Makes SPEC §3's relative-within-group
// semantic mechanically available to a consumer instead of something it has
// to re-derive — the same "feed pre-computed data, don't make the model
// derive it" principle types/index.ts applies to dayOfWeek.
export const SUBGROUP_PARENT: Record<MuscleSubgroupTag, MuscleGroup> = (() => {
  const parent = {} as Record<MuscleSubgroupTag, MuscleGroup>
  for (const group of MUSCLE_GROUPS) {
    for (const subgroup of PRIORITY_TREE[group]) {
      parent[subgroup] = group
    }
  }
  return parent
})()

// ─── Densification ──────────────────────────────────────────────────────────

// One row as read back from v2_coach_meso_tag_priorities, already scoped to
// one user and one mesocycle by the caller (priorityContext.ts) — this
// module never sees a mesocycle_id.
export interface StoredPriority {
  tagType: PriorityTagType
  tagValue: string
  priority: PriorityLevel
  updatedAt: string
}

export interface PriorityEntry {
  tagType: PriorityTagType
  tagValue: string
  priority: PriorityLevel
  isExplicit: boolean // false = no row exists; this is the default
  updatedAt: string | null // null exactly when isExplicit is false
}

export interface DensePriorities {
  // Total records — indexing either can never yield undefined. Always all
  // 12 / all 22, whether or not any row exists for this meso.
  muscleGroups: Record<MuscleGroup, PriorityEntry>
  muscleSubgroups: Record<MuscleSubgroupTag, PriorityEntry>
  subgroupParent: Record<MuscleSubgroupTag, MuscleGroup>
  // All 34, flat, in PRIORITY_TREE order (each group immediately followed by
  // its own subgroups) — for serialising into a payload, where a stable
  // order makes two mesos' contexts diffable.
  entries: PriorityEntry[]
  // False = nothing was ever set. Distinct from "everything is normal": lets
  // a consumer treat "no stated priorities at all" as a real branch instead
  // of reading 34 defaults as 34 stated preferences.
  anyExplicit: boolean
}

// Turns any sparse row set into the complete 34-entry set. THIS is where
// PRIORITY-CONTEXT-SPEC.md §4's "no row = normal priority" default actually
// lives (TASKS §2.4) — one named function, reached by every consumer through
// fetchPriorityContext, so the UI and a server-side reader cannot default
// differently.
//
// Meso-agnostic by design: the caller has already restricted rows to one
// mesocycle. An empty array is the ordinary case for a meso nothing has been
// set on yet, not an error path.
//
// A row whose tag_value/tag_type falls outside the 34-value vocabulary is
// never looked up by the loop below, so it's silently excluded rather than
// thrown on — the dense set is always exactly 34 entries in PRIORITY_TREE
// order.
export function densifyPriorities(rows: StoredPriority[]): DensePriorities {
  const stored = new Map<string, StoredPriority>()
  for (const row of rows) {
    stored.set(`${row.tagType}:${row.tagValue}`, row)
  }

  function entryFor(tagType: PriorityTagType, tagValue: string): PriorityEntry {
    const row = stored.get(`${tagType}:${tagValue}`)
    return row
      ? { tagType, tagValue, priority: row.priority, isExplicit: true, updatedAt: row.updatedAt }
      : { tagType, tagValue, priority: DEFAULT_PRIORITY, isExplicit: false, updatedAt: null }
  }

  const muscleGroups = {} as Record<MuscleGroup, PriorityEntry>
  const muscleSubgroups = {} as Record<MuscleSubgroupTag, PriorityEntry>
  const subgroupParent = {} as Record<MuscleSubgroupTag, MuscleGroup>
  const entries: PriorityEntry[] = []

  for (const group of MUSCLE_GROUPS) {
    const groupEntry = entryFor('muscle_group', group)
    muscleGroups[group] = groupEntry
    entries.push(groupEntry)

    for (const subgroup of PRIORITY_TREE[group]) {
      const subgroupEntry = entryFor('muscle_subgroup', subgroup)
      muscleSubgroups[subgroup] = subgroupEntry
      subgroupParent[subgroup] = group
      entries.push(subgroupEntry)
    }
  }

  return {
    muscleGroups,
    muscleSubgroups,
    subgroupParent,
    entries,
    anyExplicit: entries.some((e) => e.isExplicit),
  }
}
