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

// ReassignSheet.tsx has its own dedicated test file (ReassignSheet.test.tsx)
// covering the confirm gate, the picker, and the preview numbers — mocked
// here to a bare stand-in so this file only proves the entry-point wiring:
// tapping Reassign opens it for the tapped exercise, and it closes.
const reassignSheetPropsSpy = vi.fn()
vi.mock('./ReassignSheet', () => ({
  default: (props: { sourceExercise: Exercise; onClose: () => void }) => {
    reassignSheetPropsSpy(props.sourceExercise)
    return (
      <div>
        <span>REASSIGN SHEET OPEN</span>
        <button onClick={props.onClose}>close reassign sheet</button>
      </div>
    )
  },
}))

afterEach(() => {
  cleanup()
  restoreMutateMock.mockReset()
  showToastMock.mockReset()
  reassignSheetPropsSpy.mockReset()
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

  it('tapping Reassign opens ReassignSheet for that exercise, and closing it clears the state', () => {
    lostExercises = [LOST_EXERCISE]
    render(<LostExercises onClose={() => {}} />)

    expect(screen.queryByText('REASSIGN SHEET OPEN')).toBeNull()

    fireEvent.click(screen.getByTitle('Reassign'))

    expect(screen.getByText('REASSIGN SHEET OPEN')).toBeTruthy()
    expect(reassignSheetPropsSpy).toHaveBeenCalledWith(LOST_EXERCISE)

    fireEvent.click(screen.getByText('close reassign sheet'))
    expect(screen.queryByText('REASSIGN SHEET OPEN')).toBeNull()
  })
})
