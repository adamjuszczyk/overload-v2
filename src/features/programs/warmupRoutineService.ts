import { supabase } from '../../lib/supabase'
import type { WarmupRoutineItem } from '../../types'

// ─── Warmup routine (chunk 18 — SPEC.md "Warmup routine": "Per workout, in
// the program: a checklist shown at the top of the session. Items are
// ticked off; nothing else is logged." / TASKS.md "data model (warmup
// routine)"). v2_workout_warmup_items has existed since migration 027 and
// v2_copy_program (034's current version) already copies it into a run's
// own copy — this chunk is simply the first APP CODE to read or write it
// (CONTEXT rule: scripts/verify-rls.mjs's TABLES gains it in this same
// change).
//
// One service module for every read and write (reviewer's brief): the
// planner's editor (StepExercises.tsx — both the stepped planner and the
// program tab that reuses it, via usePrograms.ts's own hook wrappers) and
// the workout screen's own read-only checklist (WarmupRoutineChecklist.tsx,
// via the same fetch hook) both go through this file, never a direct
// supabase call of their own. Ticks themselves are NEVER written here —
// SPEC: "nothing else is logged" — they live only in
// src/features/gym/warmupRoutineStore.ts's own localStorage key, which this
// file never touches and never imports.

type DbWarmupItem = {
  id: string
  user_id: string
  workout_day_id: string
  position: number
  body: string
}

function toWarmupItem(row: DbWarmupItem): WarmupRoutineItem {
  return {
    id: row.id,
    userId: row.user_id,
    workoutDayId: row.workout_day_id,
    position: row.position,
    body: row.body,
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────
// One fetch per workout (same "batched, not per-row" posture as
// fetchProgramExercises/fetchSupersetBlockRests) — StepExercises.tsx's own
// editor and GymSession's own checklist each call this once per workout,
// ordered so both render the routine in the same order it was saved in.
export async function fetchWarmupItems(workoutDayId: string): Promise<WarmupRoutineItem[]> {
  const { data, error } = await supabase
    .from('v2_workout_warmup_items')
    .select('*')
    .eq('workout_day_id', workoutDayId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbWarmupItem[]).map(toWarmupItem)
}

// ─── Writes ─────────────────────────────────────────────────────────────────
// Design field (SPEC "Programs and runs"): editable in the planner and the
// program tab (run copy) for both planning types, never gated by
// volumeReadOnly — same posture rest/tempo/superset grouping already take
// (programService.ts's own header comments on each).

// Appended at the end (position = the caller's current item count) — the
// caller (StepExercises.tsx) refuses a blank body itself and never calls
// this for one (same "caller trims, refuses blank, this function just
// writes" convention createWorkoutDay/updateWorkoutDayName already use for
// a workout's own name); the column's own CHECK (length(btrim(body)) > 0)
// is the backstop, never the first line of defence.
export async function addWarmupItem(
  userId: string,
  workoutDayId: string,
  body: string,
  position: number,
): Promise<WarmupRoutineItem> {
  const { data, error } = await supabase
    .from('v2_workout_warmup_items')
    .insert({ user_id: userId, workout_day_id: workoutDayId, position, body: body.trim() })
    .select()
    .single()
  if (error) throw error
  return toWarmupItem(data as DbWarmupItem)
}

export async function updateWarmupItemBody(id: string, body: string): Promise<void> {
  const { error } = await supabase.from('v2_workout_warmup_items').update({ body: body.trim() }).eq('id', id)
  if (error) throw error
}

// Deletes the row, then re-packs every item AFTER it down by one position —
// "keep positions dense and unique" (reviewer's brief). Safe under the
// table's own unique (workout_day_id, position) index with no two-phase
// juggling needed: the delete is awaited and fully committed before any
// reassignment runs, and the loop below only ever writes a position that is
// ALREADY vacant the moment it's written — either it's the just-deleted
// row's own old position (first touched, i == the removed position), or it
// was vacated one iteration earlier by the row that used to sit there
// (ascending order, one position shift at a time). See this chunk's own
// report for the full proof and its scratch-SQL confirmation.
export async function removeWarmupItem(id: string, workoutDayId: string): Promise<void> {
  const { error: deleteError } = await supabase.from('v2_workout_warmup_items').delete().eq('id', id)
  if (deleteError) throw deleteError

  const remaining = await fetchWarmupItems(workoutDayId)
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position === i) continue // already dense at this slot — no write needed
    const { error } = await supabase.from('v2_workout_warmup_items').update({ position: i }).eq('id', remaining[i].id)
    if (error) throw error
  }
}

// Reorder (up/down arrows, same affordance StepExercises.tsx's own exercise
// rows use) — ALWAYS called with the workout's WHOLE item list, every item
// given a fresh, dense 0..n-1 position (same contract
// reorderProgramExercises/moveExercise already follow for exercises — there
// is no partial-list variant). Two-phase update under an offset, chosen
// over delete+insert so every row keeps its own id:
//
//   Phase 1 moves every row to `position + updates.length`. Every input
//   position is a distinct value in [0, n), so every phase-1 target is a
//   distinct value in [n, 2n) — a disjoint range. Because this function is
//   ALWAYS given the complete item list for one workout_day_id (the unique
//   index's own scope — nothing else of this workout day exists outside
//   this call), no phase-1 write can ever collide with another row's
//   current OR already-moved position, in any order.
//   Phase 2 moves every row from its phase-1 slot to its real, final
//   position in [0, n) — again all distinct, and disjoint from the phase-1
//   range any row still mid-flight might hold — so this can also run in any
//   order.
//
// Chosen over delete+insert specifically so a reorder never churns the
// rows' own ids. Proved on scratch SQL against the real unique index (this
// chunk's report): a single-phase per-row loop (reorderProgramExercises's
// own shape, which has no such index to worry about) hits 23505 under this
// table's unique index the moment two rows swap; the two-phase version
// below does not.
export async function reorderWarmupItems(updates: { id: string; position: number }[]): Promise<void> {
  const offset = updates.length
  for (const { id, position } of updates) {
    const { error } = await supabase
      .from('v2_workout_warmup_items')
      .update({ position: position + offset })
      .eq('id', id)
    if (error) throw error
  }
  for (const { id, position } of updates) {
    const { error } = await supabase.from('v2_workout_warmup_items').update({ position }).eq('id', id)
    if (error) throw error
  }
}

// Pure, unit-testable list reorder — same "returns the SAME array reference
// when the move is a no-op" convention supersetGroups.ts's own moveUnit
// uses, so a caller can cheaply skip a write (`if (next === items) return`,
// StepExercises.tsx's own moveExercise already does exactly this for
// moveUnit). No grouping concept for this table — a flat list, unlike
// exercises' superset units — so a plain adjacent swap.
export function moveWarmupItem(
  items: WarmupRoutineItem[],
  index: number,
  direction: 'up' | 'down',
): WarmupRoutineItem[] {
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= items.length) return items
  const reordered = [...items]
  ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
  return reordered
}
