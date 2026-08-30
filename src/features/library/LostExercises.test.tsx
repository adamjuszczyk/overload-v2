// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Exercise } from '../../types'
import LostExercises from './LostExercises'

// Light coverage per EXERCISE-LIBRARY-TASKS.md §8 step 8's Part 1a — the
// restore action firing correctly is the one behaviour worth a component
// test here; the reversible-transition logic itself is
// exerciseService.test.ts's job.
const restoreMutateMock = vi.fn()
const showToastMock = vi.fn()
let lostExercises: Exercise[] = []

vi.mock('./useExercises', () => ({
  useLostExercises: () => ({ data: lostExercises, isLoading: false, error: null }),
  useRestoreExercise: () => ({ mutate: restoreMutateMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

afterEach(() => {
  cleanup()
  restoreMutateMock.mockReset()
  showToastMock.mockReset()
})

const LOST_EXERCISE: Exercise = {
  id: 'ex-1',
  userId: 'user-1',
  name: 'Chest Press',
  muscleGroup: 'chest',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null,
  movementPattern: null,
  status: 'lost',
  sourceLibraryId: null,
  lostAt: '2026-08-01T00:00:00Z',
}

describe('LostExercises', () => {
  it('renders the empty state when there are no lost exercises', () => {
    lostExercises = []
    render(<LostExercises onClose={() => {}} />)
    expect(screen.getByText('NO LOST EXERCISES')).toBeTruthy()
  })

  it('renders a row per lost exercise', () => {
    lostExercises = [LOST_EXERCISE]
    render(<LostExercises onClose={() => {}} />)
    expect(screen.getByText('Chest Press')).toBeTruthy()
  })

  it('tapping restore fires the mutation for that exercise immediately — no confirm step (§9.4/§11.4)', () => {
    lostExercises = [LOST_EXERCISE]
    render(<LostExercises onClose={() => {}} />)

    fireEvent.click(screen.getByTitle('Restore'))

    expect(restoreMutateMock).toHaveBeenCalledTimes(1)
    const [id, opts] = restoreMutateMock.mock.calls[0] as [string, { onSuccess: () => void }]
    expect(id).toBe('ex-1')
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()

    opts.onSuccess()
    expect(showToastMock).toHaveBeenCalledWith('Chest Press restored to your active library')
  })
})
