import { supabase } from '../../lib/supabase'
import type { PhaseEntry, TrainingPhase, WeightEntry, WeightEntryKind } from '../../types'

// CRUD for v2_coach_phase_entries and v2_coach_weight_entries
// (COACH-ANALYSIS-TASKS.md §4 step C), following historyService.ts's shape:
// snake_case DB row types kept separate from the camelCase public interface,
// explicit .eq('user_id', userId) defence-in-depth alongside RLS on every
// query, plain `if (error) throw error` rethrow.
//
// Both tables carry a `unique` index (session_id-independent here — it's
// (user_id, start_date) for phases, (user_id, entry_date, kind) for weight)
// that a normal user action can legitimately hit (two phases starting the
// same day; two entries of the same kind on the same date/week). Postgres
// 23505 is translated into a plain, specific Error message here so the UI
// never has to know a Postgres error code to show something sensible.

const UNIQUE_VIOLATION = '23505'

// ─── Phase entries ────────────────────────────────────────────────────────────

type DbPhaseEntry = {
  id: string
  user_id: string
  phase: string
  start_date: string
  created_at: string
}

function toPhaseEntry(row: DbPhaseEntry): PhaseEntry {
  return {
    id: row.id,
    userId: row.user_id,
    phase: row.phase as TrainingPhase,
    startDate: row.start_date,
    createdAt: row.created_at,
  }
}

const PHASE_ENTRY_COLUMNS = 'id, user_id, phase, start_date, created_at'

export async function fetchPhaseEntries(userId: string): Promise<PhaseEntry[]> {
  const { data, error } = await supabase
    .from('v2_coach_phase_entries')
    .select(PHASE_ENTRY_COLUMNS)
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
  if (error) throw error
  return (data as DbPhaseEntry[]).map(toPhaseEntry)
}

export async function createPhaseEntry(
  userId: string,
  phase: TrainingPhase,
  startDate: string,
): Promise<PhaseEntry> {
  const { data, error } = await supabase
    .from('v2_coach_phase_entries')
    .insert({ user_id: userId, phase, start_date: startDate })
    .select(PHASE_ENTRY_COLUMNS)
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error('A phase already starts on that date — edit the existing entry instead.')
    }
    throw error
  }
  return toPhaseEntry(data as DbPhaseEntry)
}

export async function updatePhaseEntry(
  id: string,
  userId: string,
  updates: { phase: TrainingPhase; startDate: string },
): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_phase_entries')
    .update({ phase: updates.phase, start_date: updates.startDate })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error('Another phase already starts on that date.')
    }
    throw error
  }
}

export async function deletePhaseEntry(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_phase_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

// ─── Weight entries ───────────────────────────────────────────────────────────

type DbWeightEntry = {
  id: string
  user_id: string
  entry_date: string
  weight_kg: number
  kind: string
  created_at: string
}

function toWeightEntry(row: DbWeightEntry): WeightEntry {
  return {
    id: row.id,
    userId: row.user_id,
    entryDate: row.entry_date,
    weightKg: row.weight_kg,
    kind: row.kind as WeightEntryKind,
    createdAt: row.created_at,
  }
}

const WEIGHT_ENTRY_COLUMNS = 'id, user_id, entry_date, weight_kg, kind, created_at'

function weightUniqueMessage(kind: WeightEntryKind): string {
  return kind === 'weekly_average'
    ? 'You already have a weekly average for that week — edit the existing entry instead.'
    : 'You already have a daily weigh-in for that date — edit the existing entry instead.'
}

export async function fetchWeightEntries(userId: string): Promise<WeightEntry[]> {
  const { data, error } = await supabase
    .from('v2_coach_weight_entries')
    .select(WEIGHT_ENTRY_COLUMNS)
    .eq('user_id', userId)
    .order('entry_date', { ascending: false })
  if (error) throw error
  return (data as DbWeightEntry[]).map(toWeightEntry)
}

// `entryDate` must already be normalised to the week's Monday for
// kind === 'weekly_average' (COACH-ANALYSIS-TASKS.md §5.2) — this service
// stores exactly what it's given, the caller (WeightLog.tsx, via
// weightLogic.ts's weekKey) owns the normalisation.
export async function createWeightEntry(
  userId: string,
  weightKg: number,
  kind: WeightEntryKind,
  entryDate: string,
): Promise<WeightEntry> {
  const { data, error } = await supabase
    .from('v2_coach_weight_entries')
    .insert({ user_id: userId, weight_kg: weightKg, kind, entry_date: entryDate })
    .select(WEIGHT_ENTRY_COLUMNS)
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error(weightUniqueMessage(kind))
    throw error
  }
  return toWeightEntry(data as DbWeightEntry)
}

export async function updateWeightEntry(
  id: string,
  userId: string,
  updates: { weightKg: number; kind: WeightEntryKind; entryDate: string },
): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_weight_entries')
    .update({ weight_kg: updates.weightKg, kind: updates.kind, entry_date: updates.entryDate })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error(weightUniqueMessage(updates.kind))
    throw error
  }
}

export async function deleteWeightEntry(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('v2_coach_weight_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}
