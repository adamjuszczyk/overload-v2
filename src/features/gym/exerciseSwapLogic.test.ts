import { describe, it, expect } from 'vitest'
import { resolveReplacementExercise } from './exerciseSwapLogic'
import type { ExerciseSwap } from './sessionService'
import type { Exercise } from '../../types'

function makeSwap(overrides: Partial<ExerciseSwap> = {}): ExerciseSwap {
  return {
    id: 'swap-1',
    sessionId: 'session-1',
    programExerciseId: 'pe-1',
    originalExerciseId: 'ex-chest-press',
    originalExerciseName: 'Chest Press',
    replacementExerciseId: 'ex-smith-press',
    replacementExerciseName: 'Smith Press',
    createdAt: '2026-09-03T09:31:00Z',
    ...overrides,
  }
}

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-smith-press',
    userId: 'u1',
    name: 'Smith Press',
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
    ...overrides,
  }
}

describe('resolveReplacementExercise', () => {
  it('returns the real Exercise object when replacementExerciseId is present in the list', () => {
    const swap = makeSwap()
    const real = makeExercise({ id: 'ex-smith-press', muscleGroup: 'chest', isArchived: false })
    const result = resolveReplacementExercise(swap, [makeExercise({ id: 'other' }), real])
    expect(result).toBe(real)
  })

  it('falls back to a stub built from the denormalised name when the id is not found (not yet loaded)', () => {
    const swap = makeSwap({ replacementExerciseId: 'ex-not-loaded-yet', replacementExerciseName: 'Not Loaded Yet' })
    const result = resolveReplacementExercise(swap, [])
    expect(result.id).toBe('ex-not-loaded-yet')
    expect(result.name).toBe('Not Loaded Yet')
    expect(result.muscleGroup).toBe('other')
    expect(result.status).toBe('active')
  })

  it('falls back to a stub keyed by the swap row id when replacementExerciseId is null (hard-deleted since)', () => {
    const swap = makeSwap({ replacementExerciseId: null, replacementExerciseName: 'Deleted Exercise', id: 'swap-42' })
    const result = resolveReplacementExercise(swap, [makeExercise({ id: 'unrelated' })])
    expect(result.id).toBe('swap-42')
    expect(result.name).toBe('Deleted Exercise')
  })

  it('an archived real exercise is still found and returned (includeArchived lookup)', () => {
    const swap = makeSwap()
    const archived = makeExercise({ id: 'ex-smith-press', isArchived: true })
    const result = resolveReplacementExercise(swap, [archived])
    expect(result).toBe(archived)
  })
})
