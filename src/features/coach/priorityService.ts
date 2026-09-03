import { supabase } from '../../lib/supabase'
import type { PriorityTagType, PriorityLevel } from '../../lib/priorityTags.js'

// CRUD for v2_coach_meso_tag_priorities (PRIORITY-CONTEXT-TASKS.md §2.6/
// §5.8), following coachContextService.ts's/coachMemoryService.ts's shape:
// browser-singleton client, explicit .eq('user_id', userId) alongside RLS,
// plain `if (error) throw error` rethrow, updated_at set explicitly on
// every write rather than left to the column default.

type DbTagPriorityWrite = {
  tag_type: string
  tag_value: string
  priority: string
}

// One row per (user, meso, tag_type, tag_value) — the unique index is the
// upsert target, not just an integrity guard (TASKS §2.6), so "set a
// priority" is one idempotent call whether or not a row already exists.
export async function setTagPriority(
  userId: string,
  mesocycleId: string,
  tagType: PriorityTagType,
  tagValue: string,
  priority: PriorityLevel,
): Promise<void> {
  const { error } = await supabase.from('v2_coach_meso_tag_priorities').upsert(
    {
      user_id: userId,
      mesocycle_id: mesocycleId,
      tag_type: tagType,
      tag_value: tagValue,
      priority,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,mesocycle_id,tag_type,tag_value' },
  )
  if (error) throw error
}

// §5.8: copies the source meso's *explicit rows only*, verbatim — never the
// densified 34. Copying the dense set would write ~30 explicit 'normal' rows
// that were never stated for this meso, manufacturing exactly the
// stated-preference data Q1's blank-plus-explicit-copy resolution exists to
// avoid. Same principle copyFromPreviousWeek (weekPlanService.ts) follows:
// it copies what actually exists, not a materialised full week.
//
// The caller (§5.8 / the eventual COPY FROM button) is responsible for
// only offering this when the target meso has no explicit rows yet — this
// function itself has no overwrite guard because the same upsert
// setTagPriority uses backs the write, so even a double-tap before the
// query cache invalidates cannot produce a duplicate row.
export async function copyPrioritiesFromMeso(
  userId: string,
  fromMesocycleId: string,
  toMesocycleId: string,
): Promise<void> {
  const { data: sourceRows, error: fetchError } = await supabase
    .from('v2_coach_meso_tag_priorities')
    .select('tag_type, tag_value, priority')
    .eq('user_id', userId)
    .eq('mesocycle_id', fromMesocycleId)
  if (fetchError) throw fetchError
  if (!sourceRows || sourceRows.length === 0) return

  const now = new Date().toISOString()
  const rows = (sourceRows as DbTagPriorityWrite[]).map((row) => ({
    user_id: userId,
    mesocycle_id: toMesocycleId,
    tag_type: row.tag_type,
    tag_value: row.tag_value,
    priority: row.priority,
    updated_at: now,
  }))

  const { error } = await supabase
    .from('v2_coach_meso_tag_priorities')
    .upsert(rows, { onConflict: 'user_id,mesocycle_id,tag_type,tag_value' })
  if (error) throw error
}
