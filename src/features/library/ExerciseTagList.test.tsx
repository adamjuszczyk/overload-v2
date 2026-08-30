// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Exercise } from '../../types'
import { MOVEMENT_PATTERN_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import ExerciseTagList from './ExerciseTagList'

const mutateMock = vi.fn()
vi.mock('./useExercises', () => ({
  useUpdateExercise: () => ({ mutate: mutateMock, isPending: false }),
}))

afterEach(() => {
  cleanup()
  mutateMock.mockReset()
})

const EXERCISE: Exercise = {
  id: 'ex-1',
  userId: 'user-1',
  name: 'Chest Press',
  muscleGroup: 'chest',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: ['mid_chest'],
  movementPattern: 'horizontal_push',
  status: 'active',
  sourceLibraryId: null,
  lostAt: null,
}

describe('ExerciseTagList', () => {
  it('renders a collapsed summary row per exercise, chip grids hidden until expanded', () => {
    render(<ExerciseTagList exercises={[EXERCISE]} />)
    expect(screen.getByText('Chest Press')).toBeTruthy()
    expect(screen.queryByRole('button', { name: MOVEMENT_PATTERN_LABELS.isolation })).toBeNull()
  })

  it('expanding a row reveals both chip grids', () => {
    render(<ExerciseTagList exercises={[EXERCISE]} />)
    fireEvent.click(screen.getByText('Chest Press'))
    expect(screen.getByRole('button', { name: MOVEMENT_PATTERN_LABELS.isolation })).toBeTruthy()
    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.lower_chest })).toBeTruthy()
  })

  it('tapping a movement pattern chip auto-saves immediately — a single tap, no separate confirm step', () => {
    render(<ExerciseTagList exercises={[EXERCISE]} />)
    fireEvent.click(screen.getByText('Chest Press')) // expand
    fireEvent.click(screen.getByRole('button', { name: MOVEMENT_PATTERN_LABELS.isolation }))

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock).toHaveBeenCalledWith({
      id: 'ex-1',
      name: 'Chest Press',
      muscleGroup: 'chest',
      tags: { movementPattern: 'isolation' },
    })
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('a subgroup tap saves immediately too, and omits movementPattern from the payload — the real don\'t-blank-on-omit call site', () => {
    render(<ExerciseTagList exercises={[EXERCISE]} />)
    fireEvent.click(screen.getByText('Chest Press'))
    fireEvent.click(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.lower_chest }))

    expect(mutateMock).toHaveBeenCalledTimes(1)
    const payload = mutateMock.mock.calls[0][0]
    expect(payload).toEqual({
      id: 'ex-1',
      name: 'Chest Press',
      muscleGroup: 'chest',
      tags: { muscleSubgroups: ['mid_chest', 'lower_chest'] },
    })
    expect(payload.tags).not.toHaveProperty('movementPattern')
  })
})
