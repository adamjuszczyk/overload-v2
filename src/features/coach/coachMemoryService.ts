import { supabase } from '../../lib/supabase'
import type { CoachMemoryEntry } from '../../types'

// CRUD for v2_coach_memory_entries (COACH-PERSONALIZATION-TASKS.md §6,
// phase 4), following coachNotesService.ts's exact shape.
//
// No client-side call into api/coach/curate-memory.ts here — the Notes/
// Memory restructure (COACH-PERSONALIZATION-SPEC.md v1.1) removed the
// "UPDATE MEMORY" button that used to be curation's only manual trigger;
// curation now runs automatically, server-side, as part of
// api/coach/analyze.ts (see curationRunner.ts). The endpoint itself is
// still live for direct/diagnostic use, just no longer called from the app.

type DbCoachMemoryEntry = {
  id: string
  user_id: string
  body: string
  source: 'curation' | 'manual'
  status: 'active' | 'expired'
  created_at: string
  updated_at: string
}

function toCoachMemoryEntry(row: DbCoachMemoryEntry): CoachMemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    body: row.body,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const MEMORY_COLUMNS = 'id, user_id, body, source, status, created_at, updated_at'

// Every entry, active and expired both (TASKS §2.7 — an expired entry stays
// visible/restorable, never hidden entirely). The view splits them, not
// this query.
export async function fetchCoachMemoryEntries(userId: string): Promise<CoachMemoryEntry[]> {
  const { data, error } = await supabase
    .from('v2_coach_memory_entries')
    .select(MEMORY_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbCoachMemoryEntry[]).map(toCoachMemoryEntry)
}

export async function createCoachMemoryEntry(userId: string, body: string): Promise<CoachMemoryEntry> {
  const { data, error } = await supabase
    .from('v2_coach_memory_entries')
    .insert({ user_id: userId, body, source: 'manual' })
    .select(MEMORY_COLUMNS)
    .single()
  if (error) throw error
  return toCoachMemoryEntry(data as DbCoachMemoryEntry)
}

// A hand edit flips `source` to 'manual' regardless of what it was before
// (TASKS §2.7 — "the lifter corrected this one themselves" is itself a
// useful signal for a future curation run to see).
export async function updateCoachMemoryEntry(id: string, userId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_memory_entries')
    .update({ body, source: 'manual', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

// The user's own delete is a real, hard delete — distinct from curation's
// soft expire (TASKS §9.4).
export async function deleteCoachMemoryEntry(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_memory_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

// Un-expires an entry curation previously expired. Status only — restoring
// isn't a content edit, so `source` is left exactly as it was.
export async function restoreCoachMemoryEntry(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_memory_entries')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}
