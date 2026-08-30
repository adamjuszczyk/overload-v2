// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { ExerciseLibrary } from '../../types'
import LibraryCatalog from './LibraryCatalog'

// Light coverage per EXERCISE-LIBRARY-TASKS.md §8 step 8's Part 1a — the
// split preview must be fetched and shown before the delete is confirmed
// (§6.3/§9.2), and an all-zero split must short-circuit to a toast instead
// of an empty confirm dialog. The split's own counting logic is
// libraryService.test.ts's job; this only proves the UI wiring.
const downloadMutateMock = vi.fn()
const deletePreviewMutateAsyncMock = vi.fn()
const deleteLibraryMutateMock = vi.fn()
const showToastMock = vi.fn()

vi.mock('./useLibraries', () => ({
  useLibraries: () => ({ data: [LIBRARY], isLoading: false, error: null }),
  useLibraryItems: () => ({ data: [], isLoading: false }),
  useDownloadLibrary: () => ({ mutate: downloadMutateMock, isPending: false }),
  useLibraryDeletePreview: () => ({ mutateAsync: deletePreviewMutateAsyncMock }),
  useDeleteLibrary: () => ({ mutate: deleteLibraryMutateMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

afterEach(() => {
  cleanup()
  downloadMutateMock.mockReset()
  deletePreviewMutateAsyncMock.mockReset()
  deleteLibraryMutateMock.mockReset()
  showToastMock.mockReset()
})

const LIBRARY: ExerciseLibrary = {
  id: 'lib-1',
  slug: 'dumbbell',
  name: 'Dumbbell Exercises',
  description: null,
  isListed: true,
  position: 0,
}

describe('LibraryCatalog — delete / split-preview', () => {
  it('an all-zero split shows a toast instead of an empty confirm dialog', async () => {
    deletePreviewMutateAsyncMock.mockResolvedValue({ toDeleteCount: 0, toLostCount: 0 })
    render(<LibraryCatalog onClose={() => {}} />)

    fireEvent.click(screen.getByLabelText('Delete exercises downloaded from Dumbbell Exercises'))

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("You haven't downloaded any exercises from Dumbbell Exercises"),
    )
    expect(screen.queryByText('DELETE LIBRARY EXERCISES')).toBeNull()
  })

  it('a mixed split shows both counts before confirming, and confirming fires the bulk delete', async () => {
    deletePreviewMutateAsyncMock.mockResolvedValue({ toDeleteCount: 4, toLostCount: 8 })
    render(<LibraryCatalog onClose={() => {}} />)

    fireEvent.click(screen.getByLabelText('Delete exercises downloaded from Dumbbell Exercises'))
    await screen.findByText('DELETE LIBRARY EXERCISES')
    expect(screen.getByText(/4 deleted permanently/)).toBeTruthy()
    expect(screen.getByText(/8 moved to/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))
    expect(deleteLibraryMutateMock).toHaveBeenCalledWith('lib-1', expect.anything())
  })
})
