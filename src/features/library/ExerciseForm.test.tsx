// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Exercise } from '../../types'
import { MOVEMENT_PATTERN_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import ExerciseForm from './ExerciseForm'

const mutateAsyncMock = vi.fn().mockResolvedValue(undefined)
vi.mock('./useExercises', () => ({
  useCreateExercise: () => ({ mutateAsync: mutateAsyncMock, isPending: false, error: null }),
  useUpdateExercise: () => ({ mutateAsync: mutateAsyncMock, isPending: false, error: null }),
}))

afterEach(() => {
  cleanup()
  mutateAsyncMock.mockReset()
  mutateAsyncMock.mockResolvedValue(undefined)
})

// EXERCISE-LIBRARY-TASKS.md muscle_group tag-filtering fix — this form is
// the create/edit surface, defaulting to muscleGroup 'chest' with no tags.
describe('ExerciseForm tag pickers filtered by muscle_group', () => {
  it('defaults to chest, offering only chest-relevant patterns/subgroups', () => {
    render(<ExerciseForm onClose={() => {}} />)

    expect(screen.getByRole('button', { name: MOVEMENT_PATTERN_LABELS.horizontal_push })).toBeTruthy()
    expect(screen.getByRole('button', { name: MOVEMENT_PATTERN_LABELS.isolation })).toBeTruthy()
    expect(screen.queryByRole('button', { name: MOVEMENT_PATTERN_LABELS.squat })).toBeNull()
    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.upper_chest })).toBeTruthy()
    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.front_delt })).toBeTruthy()
    // side_delt, not quads — several subgroup labels ("QUADS", "BICEPS", …)
    // are spelled identically to a muscle-group chip's own label, which
    // this form always renders regardless of filtering; side_delt has no
    // such collision.
    expect(screen.queryByRole('button', { name: MUSCLE_SUBGROUP_LABELS.side_delt })).toBeNull()
  })

  it('switching muscle group re-filters both pickers live', () => {
    render(<ExerciseForm onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'BICEPS' }))

    // 'BRACHIALIS', not 'BICEPS' — the muscle-group chip and the biceps
    // subgroup chip share the exact same label ("BICEPS"), so asserting on
    // the subgroup chip directly would be ambiguous between the two.
    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.brachialis })).toBeTruthy()
    expect(screen.queryByRole('button', { name: MUSCLE_SUBGROUP_LABELS.upper_chest })).toBeNull()
    expect(screen.getByRole('button', { name: MOVEMENT_PATTERN_LABELS.isolation })).toBeTruthy()
    expect(screen.queryByRole('button', { name: MOVEMENT_PATTERN_LABELS.horizontal_push })).toBeNull()
  })

  it('editing an exercise whose stored tags fall outside its muscle_group\'s allowed set still shows and preserves them — switching muscle_group never silently strips a real tag', () => {
    // Simulates a muscle_group edited after tagging, or a stale pre-fix
    // tag: a biceps exercise carrying a chest-only subgroup and a pattern
    // (squat) that isn't in biceps' allowed set at all.
    const stale: Exercise = {
      id: 'ex-1',
      userId: 'user-1',
      name: 'Odd Curl Variant',
      muscleGroup: 'biceps',
      isArchived: false,
      createdAt: '2026-01-01T00:00:00Z',
      muscleSubgroups: ['biceps', 'mid_chest'],
      movementPattern: 'squat',
      status: 'active',
      sourceLibraryId: null,
      lostAt: null,
    }
    render(<ExerciseForm exercise={stale} onClose={() => {}} />)

    const staleSubgroupChip = screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.mid_chest })
    expect(staleSubgroupChip.style.background).toBe('var(--accent-muted)')
    const stalePatternChip = screen.getByRole('button', { name: MOVEMENT_PATTERN_LABELS.squat })
    expect(stalePatternChip.style.background).toBe('var(--accent-muted)')
  })
})
