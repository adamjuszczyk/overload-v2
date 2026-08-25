import { supabase } from '../../lib/supabase'
import type { CoachNote } from '../../types'

// CRUD for v2_coach_notes (COACH-PERSONALIZATION-TASKS.md §6 step 13),
// following coachContextService.ts's exact shape: snake_case DB row type
// kept separate from the camelCase public interface, explicit
// .eq('user_id', userId) defence-in-depth alongside RLS on every query,
// plain `if (error) throw error` rethrow.

type DbCoachNote = {
  id: string
  user_id: string
  body: string
  session_id: string | null
  curated_at: string | null
  created_at: string
}

function toCoachNote(row: DbCoachNote): CoachNote {
  return {
    id: row.id,
    userId: row.user_id,
    body: row.body,
    sessionId: row.session_id,
    curatedAt: row.curated_at,
    createdAt: row.created_at,
  }
}

const COACH_NOTE_COLUMNS = 'id, user_id, body, session_id, curated_at, created_at'

export async function fetchCoachNotes(userId: string): Promise<CoachNote[]> {
  const { data, error } = await supabase
    .from('v2_coach_notes')
    .select(COACH_NOTE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbCoachNote[]).map(toCoachNote)
}

// `id` is caller-supplied (useCoachNotes.ts's useCreateCoachNote), not left
// to the column's own `default gen_random_uuid()` — the same id is used for
// the optimistic cache entry and the real row, online or offline, so the
// two are trivially reconciled by id instead of needing a second lookup
// (same reasoning as useLogSet's shared id, TASKS §6 step 15's sidebar
// mutation reuses this service directly).
export async function createCoachNote(
  userId: string,
  body: string,
  sessionId: string | null,
  id: string,
): Promise<CoachNote> {
  const { data, error } = await supabase
    .from('v2_coach_notes')
    .insert({ id, user_id: userId, body, session_id: sessionId })
    .select(COACH_NOTE_COLUMNS)
    .single()
  if (error) throw error
  return toCoachNote(data as DbCoachNote)
}

export async function updateCoachNote(id: string, userId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_notes')
    .update({ body })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteCoachNote(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_notes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}
