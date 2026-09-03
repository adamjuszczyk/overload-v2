import type { SupabaseClient } from '@supabase/supabase-js'
import { densifyPriorities } from '../../lib/priorityTags.js'
import type { PriorityTagType, PriorityLevel, StoredPriority, PriorityEntry } from '../../lib/priorityTags.js'
import type { MuscleSubgroupTag } from '../../lib/exerciseTags.js'
import type { MuscleGroup } from '../../types/index.js'

// The read interface for one mesocycle's priority set
// (PRIORITY-CONTEXT-TASKS.md §4). This is the contract
// MESOCYCLE-ANALYSIS-TASKS.md will cite as an already-built thing —
// mesocycleId is required and non-nullable on purpose: an optional
// "omit for the active meso" form would smuggle the old global "current
// priority" semantics back into a per-meso interface, and Mesocycle
// Analysis by definition runs against a *completed* meso, never the active
// one. Injected client, never the browser singleton (src/lib/supabase.ts
// throws at module load outside a Vite app — the same risk
// analysisInput.ts's header documents), so this is callable unmodified from
// a future api/coach/analyze-meso.ts, from the planner through
// usePriorityContext(), and from a zero-spend browser dry run before either.

export type { PriorityEntry } from '../../lib/priorityTags.js'

export interface PriorityContext {
  // Which block these priorities are for. Carried so a payload or stored
  // snapshot is self-identifying and two contexts can never be silently
  // confused for one another.
  mesocycleId: string
  muscleGroups: Record<MuscleGroup, PriorityEntry>
  muscleSubgroups: Record<MuscleSubgroupTag, PriorityEntry>
  // SPEC §3's compositional key, travelling with the data — makes
  // relative-within-group priority computable by a consumer instead of
  // something it has to re-derive.
  subgroupParent: Record<MuscleSubgroupTag, MuscleGroup>
  entries: PriorityEntry[]
  anyExplicit: boolean
}

type DbTagPriority = {
  tag_type: string
  tag_value: string
  priority: string
  updated_at: string
}

const PRIORITY_ROW_COLUMNS = 'tag_type, tag_value, priority, updated_at'

export async function fetchPriorityContext(
  client: SupabaseClient,
  userId: string,
  mesocycleId: string,
): Promise<PriorityContext> {
  const { data, error } = await client
    .from('v2_coach_meso_tag_priorities')
    .select(PRIORITY_ROW_COLUMNS)
    .eq('user_id', userId)
    .eq('mesocycle_id', mesocycleId)
  if (error) throw error

  const rows: StoredPriority[] = (data as DbTagPriority[]).map((row) => ({
    tagType: row.tag_type as PriorityTagType,
    tagValue: row.tag_value,
    priority: row.priority as PriorityLevel,
    updatedAt: row.updated_at,
  }))

  return { mesocycleId, ...densifyPriorities(rows) }
}
