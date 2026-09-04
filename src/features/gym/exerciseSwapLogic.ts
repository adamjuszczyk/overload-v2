// Pure logic for rendering a recorded exercise swap (migration 025,
// 2026-09-03 position/presentation fix) — same "pure logic gets its own
// Vitest coverage" convention as setGroupLogic.ts/referenceLogic.ts.

import type { Exercise } from '../../types'
import type { ExerciseSwap } from './sessionService'

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
