import { supabase } from '../../lib/supabase'
import type { PriorityMark, PriorityMarkTagType, StoredMark } from '../../lib/priorityMarks.js'

// CRUD for v2_program_priorities (chunk 10: TASKS.md "Priorities: focus /
// don't care"), following programService.ts's shape: browser-singleton
// client, plain `if (error) throw error` rethrow. Scoped by program_id, not
// mesocycle_id — this is the RUN'S COPY's own program row (PlanPage.tsx
// passes activeMeso.programId), the same id ProgramTab.tsx already edits
// for the run's workouts/exercises. The saved program's own marks (edited
// in the planner, chunk 11) use these same functions with a different
// program_id — nothing here is Plan-specific on purpose.

type DbProgramPriority = {
  tag_type: string
  tag_value: string
  mark: string
  updated_at: string
}

const PRIORITY_ROW_COLUMNS = 'tag_type, tag_value, mark, updated_at'

export async function fetchProgramPriorities(programId: string): Promise<StoredMark[]> {
  const { data, error } = await supabase
    .from('v2_program_priorities')
    .select(PRIORITY_ROW_COLUMNS)
    .eq('program_id', programId)
  if (error) throw error
  return (data as DbProgramPriority[]).map((row) => ({
    tagType: row.tag_type as PriorityMarkTagType,
    tagValue: row.tag_value,
    mark: row.mark as PriorityMark,
    updatedAt: row.updated_at,
  }))
}

// One row per (user, program, tag_type, tag_value) — the unique index
// (027) is the upsert target, not just an integrity guard, so "set a mark"
// is one idempotent call whether or not a row already exists.
//
// `mark: null` means "left normal" (SPEC) — unlike the old table, there is
// no stored value for that: v2_program_priorities.mark is CHECK-constrained
// to ('focus', 'dont_care') only ("no row = normal", TASKS.md's data-model
// line), so returning to normal deletes the row instead of upserting a
// third value that doesn't exist.
export async function setPriorityMark(
  userId: string,
  programId: string,
  tagType: PriorityMarkTagType,
  tagValue: string,
  mark: PriorityMark | null,
): Promise<void> {
  if (mark === null) {
    const { error } = await supabase
      .from('v2_program_priorities')
      .delete()
      .eq('user_id', userId)
      .eq('program_id', programId)
      .eq('tag_type', tagType)
      .eq('tag_value', tagValue)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('v2_program_priorities').upsert(
    {
      user_id: userId,
      program_id: programId,
      tag_type: tagType,
      tag_value: tagValue,
      mark,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,program_id,tag_type,tag_value' },
  )
  if (error) throw error
}
