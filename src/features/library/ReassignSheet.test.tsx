// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Exercise, ReassignPreview } from '../../types'
import type { ReassignBlockers } from './reassignService'
import ReassignSheet from './ReassignSheet'

// EXERCISE-LIBRARY-TASKS.md §8 step 9 — the confirmation sheet for the one
// irreversible action in the feature. Three things are worth locking down
// here rather than trusting by inspection: (1) the typed-name gate (§6.2/
// §11.1) actually requires an exact match — not a case- or whitespace-
// tolerant one, which would defeat the whole point of forcing the reader to
// look at what they typed; (2) the picker's pick-vs-create paths both reach
// the same confirm step; (3) the numbers shown are whatever the preview
// query actually returned for *this* target, not a stale value left over
// from a previous pick or some default. The RPC/query logic itself is
// reassignService.test.ts's and the migration's own job.

const previewMutateAsyncMock = vi.fn()
const blockersMutateAsyncMock = vi.fn()
const reassignMutateMock = vi.fn()
const createExerciseMutateAsyncMock = vi.fn()
const showToastMock = vi.fn()

let allExercises: Exercise[] = []

vi.mock('./useExercises', () => ({
  useExercises: () => ({ data: allExercises }),
  useCreateExercise: () => ({
    mutateAsync: createExerciseMutateAsyncMock,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('./useReassign', () => ({
  useReassignPreview: () => ({ mutateAsync: previewMutateAsyncMock }),
  useReassignBlockers: () => ({ mutateAsync: blockersMutateAsyncMock }),
  useReassignExerciseHistory: () => ({ mutate: reassignMutateMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

afterEach(() => {
  cleanup()
  previewMutateAsyncMock.mockReset()
  blockersMutateAsyncMock.mockReset()
  reassignMutateMock.mockReset()
  createExerciseMutateAsyncMock.mockReset()
  showToastMock.mockReset()
  allExercises = []
})

const SOURCE: Exercise = {
  id: 'src-1',
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

const TARGET: Exercise = {
  id: 'tgt-1',
  userId: 'user-1',
  name: 'Incline Smith Press',
  muscleGroup: 'chest',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null,
  movementPattern: null,
  status: 'active',
  sourceLibraryId: null,
  lostAt: null,
}

const CLEAR_BLOCKERS: ReassignBlockers = { hasUnsyncedSets: false, hasSessionInProgress: false }

function preview(overrides: Partial<ReassignPreview> = {}): ReassignPreview {
  return {
    setCount: 184,
    sessionCount: 23,
    firstDate: '2026-02-14T10:00:00Z',
    lastDate: '2026-08-21T10:00:00Z',
    affectedWorkoutDays: [],
    overlappingSessionCount: 0,
    frozenAnalysisCount: 0,
    ...overrides,
  }
}

async function pickTarget() {
  render(<ReassignSheet sourceExercise={SOURCE} onClose={() => {}} />)
  fireEvent.click(screen.getByText('Incline Smith Press'))
  await screen.findByText(/will move\.$/)
}

// No jest-dom in this suite (exerciseService.test.ts etc. never needed it) —
// plain DOM property check instead of a .toBeDisabled() matcher.
function mergeButtonDisabled(): boolean {
  return (screen.getByRole('button', { name: 'MERGE HISTORY' }) as HTMLButtonElement).disabled
}

describe('ReassignSheet — picker', () => {
  it('excludes the source exercise from the candidate list', () => {
    allExercises = [SOURCE, TARGET]
    render(<ReassignSheet sourceExercise={SOURCE} onClose={() => {}} />)

    expect(screen.queryByText('Chest Press')).toBeNull()
    expect(screen.getByText('Incline Smith Press')).toBeTruthy()
  })

  it('picking an existing exercise fetches the preview/blockers for that target and advances to confirm', async () => {
    allExercises = [TARGET]
    previewMutateAsyncMock.mockResolvedValue(preview())
    blockersMutateAsyncMock.mockResolvedValue(CLEAR_BLOCKERS)

    await pickTarget()

    expect(previewMutateAsyncMock).toHaveBeenCalledWith({ sourceId: 'src-1', targetId: 'tgt-1' })
    expect(blockersMutateAsyncMock).toHaveBeenCalled()
    // Confirm step rendered (both names appear in the direction line and
    // elsewhere in the copy — several matches is expected, so just confirm
    // at least one of each landed rather than picking one arbitrarily).
    expect(screen.getAllByText(/Chest Press/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Incline Smith Press/).length).toBeGreaterThan(0)
  })

  it('creating a new exercise advances to confirm with the newly created exercise as the target', async () => {
    allExercises = []
    const created: Exercise = { ...TARGET, id: 'new-1', name: 'Cable Fly' }
    createExerciseMutateAsyncMock.mockResolvedValue(created)
    previewMutateAsyncMock.mockResolvedValue(preview())
    blockersMutateAsyncMock.mockResolvedValue(CLEAR_BLOCKERS)

    render(<ReassignSheet sourceExercise={SOURCE} onClose={() => {}} />)

    fireEvent.click(screen.getByText('CREATE NEW EXERCISE'))
    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Fly' } })
    fireEvent.click(screen.getByText('CREATE'))

    await waitFor(() =>
      expect(createExerciseMutateAsyncMock).toHaveBeenCalledWith({ name: 'Cable Fly', muscleGroup: 'chest' }),
    )
    await waitFor(() =>
      expect(previewMutateAsyncMock).toHaveBeenCalledWith({ sourceId: 'src-1', targetId: 'new-1' }),
    )
    await waitFor(() => expect(screen.getAllByText(/Cable Fly/).length).toBeGreaterThan(0))
  })
})

describe('ReassignSheet — confirmation numbers reflect the actual preview result', () => {
  it('renders this target\'s real counts and date range, not a placeholder', async () => {
    allExercises = [TARGET]
    previewMutateAsyncMock.mockResolvedValue(
      preview({ setCount: 184, sessionCount: 23, firstDate: '2026-02-14T10:00:00Z', lastDate: '2026-08-21T10:00:00Z' }),
    )
    blockersMutateAsyncMock.mockResolvedValue(CLEAR_BLOCKERS)

    await pickTarget()

    expect(screen.getByText('184 sets across 23 sessions will move.')).toBeTruthy()
    expect(screen.getByText('Feb 14, 2026 – Aug 21, 2026')).toBeTruthy()
  })

  it('a different target with different numbers renders those numbers, not the previous pick\'s', async () => {
    allExercises = [TARGET]
    previewMutateAsyncMock.mockResolvedValue(preview({ setCount: 7, sessionCount: 2 }))
    blockersMutateAsyncMock.mockResolvedValue(CLEAR_BLOCKERS)

    await pickTarget()

    expect(screen.getByText('7 sets across 2 sessions will move.')).toBeTruthy()
    expect(screen.queryByText('184 sets across 23 sessions will move.')).toBeNull()
  })

  it('going back and picking again re-fetches rather than keeping the previous pick\'s stale numbers', async () => {
    const other: Exercise = { ...TARGET, id: 'tgt-2', name: 'Machine Press' }
    allExercises = [TARGET, other]
    previewMutateAsyncMock.mockResolvedValueOnce(preview({ setCount: 184, sessionCount: 23 }))
    blockersMutateAsyncMock.mockResolvedValue(CLEAR_BLOCKERS)

    await pickTarget()
    expect(screen.getByText('184 sets across 23 sessions will move.')).toBeTruthy()

    fireEvent.click(screen.getByText('BACK'))
    previewMutateAsyncMock.mockResolvedValueOnce(preview({ setCount: 3, sessionCount: 1 }))
    fireEvent.click(screen.getByText('Machine Press'))

    await waitFor(() => expect(screen.getByText('3 sets across 1 session will move.')).toBeTruthy())
    expect(previewMutateAsyncMock).toHaveBeenLastCalledWith({ sourceId: 'src-1', targetId: 'tgt-2' })
  })
})

describe('ReassignSheet — the typed-name confirm gate (§6.2/§11.1)', () => {
  async function setUpConfirmStep() {
    allExercises = [TARGET]
    previewMutateAsyncMock.mockResolvedValue(preview())
    blockersMutateAsyncMock.mockResolvedValue(CLEAR_BLOCKERS)
    await pickTarget()
    return screen.getByLabelText('Type Incline Smith Press to confirm') as HTMLInputElement
  }

  it('MERGE HISTORY starts disabled before anything is typed', async () => {
    await setUpConfirmStep()
    expect(mergeButtonDisabled()).toBe(true)
  })

  it('the exact target name enables the control', async () => {
    const input = await setUpConfirmStep()
    fireEvent.change(input, { target: { value: 'Incline Smith Press' } })
    expect(mergeButtonDisabled()).toBe(false)
  })

  it('a different case does not enable the control', async () => {
    const input = await setUpConfirmStep()
    fireEvent.change(input, { target: { value: 'incline smith press' } })
    expect(mergeButtonDisabled()).toBe(true)
  })

  it('trailing whitespace does not enable the control', async () => {
    const input = await setUpConfirmStep()
    fireEvent.change(input, { target: { value: 'Incline Smith Press ' } })
    expect(mergeButtonDisabled()).toBe(true)
  })

  it('leading whitespace does not enable the control', async () => {
    const input = await setUpConfirmStep()
    fireEvent.change(input, { target: { value: ' Incline Smith Press' } })
    expect(mergeButtonDisabled()).toBe(true)
  })

  it('a partial (prefix) match does not enable the control', async () => {
    const input = await setUpConfirmStep()
    fireEvent.change(input, { target: { value: 'Incline Smith' } })
    expect(mergeButtonDisabled()).toBe(true)
  })

  it('clicking MERGE HISTORY once enabled fires the mutation with source/target ids', async () => {
    const input = await setUpConfirmStep()
    fireEvent.change(input, { target: { value: 'Incline Smith Press' } })
    fireEvent.click(screen.getByRole('button', { name: 'MERGE HISTORY' }))

    expect(reassignMutateMock).toHaveBeenCalledWith(
      { sourceId: 'src-1', targetId: 'tgt-1' },
      expect.anything(),
    )
  })
})

describe('ReassignSheet — P3/P4 blockers gate the control even with a matching name', () => {
  it('unsynced sets keep MERGE HISTORY disabled and explain why', async () => {
    allExercises = [TARGET]
    previewMutateAsyncMock.mockResolvedValue(preview())
    blockersMutateAsyncMock.mockResolvedValue({ hasUnsyncedSets: true, hasSessionInProgress: false })

    await pickTarget()
    fireEvent.change(screen.getByLabelText('Type Incline Smith Press to confirm'), {
      target: { value: 'Incline Smith Press' },
    })

    expect(screen.getByText(/unsynced sets/i)).toBeTruthy()
    expect(mergeButtonDisabled()).toBe(true)
  })

  it('a session in progress keeps MERGE HISTORY disabled and explains why', async () => {
    allExercises = [TARGET]
    previewMutateAsyncMock.mockResolvedValue(preview())
    blockersMutateAsyncMock.mockResolvedValue({ hasUnsyncedSets: false, hasSessionInProgress: true })

    await pickTarget()
    fireEvent.change(screen.getByLabelText('Type Incline Smith Press to confirm'), {
      target: { value: 'Incline Smith Press' },
    })

    expect(screen.getByText(/in-progress session/i)).toBeTruthy()
    expect(mergeButtonDisabled()).toBe(true)
  })
})
