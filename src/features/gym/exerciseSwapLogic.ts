// Pure logic for rendering a recorded exercise swap (migration 025,
// 2026-09-03 position/presentation fix) — same "pure logic gets its own
// Vitest coverage" convention as setGroupLogic.ts/referenceLogic.ts.

import type { Exercise } from '../../types'
import type { ExerciseSwap } from './sessionService'
import type { MovedSet, SwapRecord } from './workoutRules'

// Chunk 59 (migration 047, DECISIONS 183 and 46r's Q5): the swap row's `moved_sets` column holds the record of which sets moved,
// `{ fromKey, moved: [{ from: { weekPlanSetId } | { addedPlace }, place }] }` (chunk 46r's `SwapRecord`). It is stored explicitly
// and read back exactly as written; anything that is not that shape reads as no record at all (the swap is then drawn as before
// 1.2 draws it, DECISIONS 198), never as a record some of whose sets are guessed. `fromKey` is the swapped slot's card key, the
// program exercise's id on every phone.
export function parseSwapRecord(value: unknown): SwapRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { fromKey, moved } = value as { fromKey?: unknown; moved?: unknown }
  if (typeof fromKey !== 'string' || fromKey === '' || !Array.isArray(moved)) return null
  const sets: MovedSet[] = []
  for (const entry of moved) {
    if (typeof entry !== 'object' || entry === null) return null
    const { from, place } = entry as { from?: unknown; place?: unknown }
    if (!isPlace(place) || typeof from !== 'object' || from === null) return null
    const { weekPlanSetId, addedPlace } = from as { weekPlanSetId?: unknown; addedPlace?: unknown }
    if (typeof weekPlanSetId === 'string' && weekPlanSetId !== '' && addedPlace === undefined) sets.push({ from: { weekPlanSetId }, place })
    else if (isPlace(addedPlace) && weekPlanSetId === undefined) sets.push({ from: { addedPlace }, place })
    else return null
  }
  return { fromKey, moved: sets }
}

const isPlace = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

// Resolves a recorded swap's replacement to a full Exercise object —
// migration 025 only denormalises id/name onto the swap row itself, not the
// whole row, so GymSession.tsx needs this to render a real ExerciseCard
// (muscle group, weight unit, and the history link all come from the full
// object). Falls back to a minimal stub built from the swap's own
// denormalised name when the real exercise can't be found (not yet loaded,
// or hard-deleted since — replacement_exercise_id is ON DELETE SET NULL
// specifically so the swap fact survives that). The stub is display-only;
// nothing writes it back.
export function resolveReplacementExercise(swap: ExerciseSwap, allExercises: Exercise[]): Exercise {
  const found = swap.replacementExerciseId
    ? allExercises.find((e) => e.id === swap.replacementExerciseId)
    : undefined
  if (found) return found
  return {
    id: swap.replacementExerciseId ?? swap.id,
    userId: '',
    name: swap.replacementExerciseName,
    muscleGroup: 'other',
    isArchived: false,
    createdAt: swap.createdAt,
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  }
}
