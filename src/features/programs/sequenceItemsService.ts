import { supabase } from '../../lib/supabase'
import type { SequenceItem } from '../../types'

// ─── Sequence items (chunk 25 — SPEC.md "Scheduling → Sequence": "An
// ordered list of workouts and rest days, not tied to dates." / TASKS.md
// "Planner step 2 gains the schedule type and a sequence editor (workout
// and rest-day slots, up/down; a workout may appear more than once)").
// v2_program_sequence_items has existed since migration 027 and
// v2_copy_program (028's current version) already copies it into a run's
// own copy — this chunk is simply the first APP CODE to read or write it
// (CONTEXT rule: scripts/verify-rls.mjs's TABLES gains it in this same
// change).
//
// Mirrors warmupRoutineService.ts's own shape exactly (same "one service
// module for every read and write", same dense-position/two-phase-reorder
// conventions) — the one structural difference is scope: a workout's own
// warmup items are scoped to workout_day_id; a program's sequence items are
// scoped to program_id (one ordered cycle per program, independent of how
// many workouts it has), and a slot's own "body" is workout_day_id itself
// (null = a rest day), not free text.

type DbSequenceItem = {
  id: string
  user_id: string
  program_id: string
  position: number
  workout_day_id: string | null
}

function toSequenceItem(row: DbSequenceItem): SequenceItem {
  return {
    id: row.id,
    userId: row.user_id,
    programId: row.program_id,
    position: row.position,
    workoutDayId: row.workout_day_id,
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────
// One fetch per program (same "batched, not per-row" posture
// fetchWarmupItems/fetchProgramExercises already take) — ordered so the
// editor and any future reader render the cycle in the order it was saved.
export async function fetchSequenceItems(programId: string): Promise<SequenceItem[]> {
  const { data, error } = await supabase
    .from('v2_program_sequence_items')
    .select('*')
    .eq('program_id', programId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbSequenceItem[]).map(toSequenceItem)
}

// ─── Writes ─────────────────────────────────────────────────────────────────
// Schedule type stays "when"/"what", not "volume" — same never-gated-by-
// volumeReadOnly posture the weekday assignment row already takes
// (StepExercises.tsx's own header comment).

// Appended at the end (position = the caller's current item count).
// workoutDayId null = a rest slot — a slot starts as rest and the caller
// picks a workout for it afterwards (same two-step "add, then set" flow a
// blank-body warmup item would need were blank bodies allowed; here a rest
// slot is simply a valid resting state, never refused).
export async function addSequenceItem(
  userId: string,
  programId: string,
  position: number,
  workoutDayId: string | null,
): Promise<SequenceItem> {
  const { data, error } = await supabase
    .from('v2_program_sequence_items')
    .insert({ user_id: userId, program_id: programId, position, workout_day_id: workoutDayId })
    .select()
    .single()
  if (error) throw error
  return toSequenceItem(data as DbSequenceItem)
}

// Changes one slot's own workout (or sets it to REST — null). Never touches
// position — that's reorderSequenceItems' own field, same split
// updateWarmupItemBody/moveWarmupItem take.
export async function updateSequenceItemWorkout(id: string, workoutDayId: string | null): Promise<void> {
  const { error } = await supabase.from('v2_program_sequence_items').update({ workout_day_id: workoutDayId }).eq('id', id)
  if (error) throw error
}

// Deletes the row, then re-packs every item AFTER it down by one position —
// identical shape to removeWarmupItem (027's own unique index on
// (program_id, position) is the same "keep positions dense and unique"
// scope, just program_id instead of workout_day_id).
export async function removeSequenceItem(id: string, programId: string): Promise<void> {
  const { error: deleteError } = await supabase.from('v2_program_sequence_items').delete().eq('id', id)
  if (deleteError) throw deleteError

  const remaining = await fetchSequenceItems(programId)
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position === i) continue // already dense at this slot — no write needed
    const { error } = await supabase.from('v2_program_sequence_items').update({ position: i }).eq('id', remaining[i].id)
    if (error) throw error
  }
}

// Reorder (up/down arrows) — ALWAYS called with the program's WHOLE item
// list, every item given a fresh, dense 0..n-1 position. Same two-phase
// update-under-an-offset as reorderWarmupItems (see that function's own
// header for the full proof — program_id's unique index makes the
// argument identical, just scoped to the whole program's cycle instead of
// one workout's warmup list).
export async function reorderSequenceItems(updates: { id: string; position: number }[]): Promise<void> {
  const offset = updates.length
  for (const { id, position } of updates) {
    const { error } = await supabase
      .from('v2_program_sequence_items')
      .update({ position: position + offset })
      .eq('id', id)
    if (error) throw error
  }
  for (const { id, position } of updates) {
    const { error } = await supabase.from('v2_program_sequence_items').update({ position }).eq('id', id)
    if (error) throw error
  }
}

// Pure, unit-testable list reorder — same "returns the SAME array reference
// when the move is a no-op" convention moveWarmupItem/moveUnit already use.
export function moveSequenceItem(
  items: SequenceItem[],
  index: number,
  direction: 'up' | 'down',
): SequenceItem[] {
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= items.length) return items
  const reordered = [...items]
  ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
  return reordered
}
