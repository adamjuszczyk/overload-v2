import { supabase } from '../../lib/supabase'
import type { CoachMemoryEntry, CurationResult } from '../../types'

// CRUD for v2_coach_memory_entries plus the POST to
// api/coach/curate-memory.ts (COACH-PERSONALIZATION-TASKS.md §6, phase 4),
// following coachNotesService.ts's exact shape for the CRUD half and
// coachWeekService.ts's analyzeWeek() shape for the generate-call half.

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

// ─── Curate — POST to the serverless function (§5.1/§5.2) ──────────────────
//
// The client sends no body at all — the function re-reads the caller's own
// uncurated notes and current memory itself, server-side (§5.3 steps 3/5).

export async function curateMemory(): Promise<CurationResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/api/coach/curate-memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({}),
  })
  // res.json() throws a raw SyntaxError on a non-JSON body — a real
  // possibility here specifically, since this endpoint runs one Anthropic
  // call plus up to two sequential Supabase writes inside vercel.json's 60s
  // maxDuration, and a genuine platform-level timeout/gateway failure
  // returns a non-JSON body the handler never gets a chance to shape. Found
  // during this session's adversarial review: without this guard, that
  // SyntaxError reaches CoachMemory.tsx's error banner verbatim instead of
  // the friendly message every other failure path here produces.
  let responseBody: unknown
  try {
    responseBody = await res.json()
  } catch {
    throw new Error('Curation failed')
  }
  if (!res.ok) throw new Error((responseBody as { error?: string })?.error ?? 'Curation failed')
  return responseBody as CurationResult
}
