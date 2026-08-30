import { describe, it, expect, vi, beforeEach } from 'vitest'

// libraryService.ts's previewLibraryDelete/deleteLibrary are bulk wrappers
// around exerciseService.ts's own previewExerciseDelete/deleteExercise
// (EXERCISE-LIBRARY-TASKS.md §9.2 — "a bulk version of the single delete,
// not a separate mechanism"). Mocked here rather than re-testing
// previewExerciseDelete's own classification logic (already covered in
// exerciseService.test.ts) — this file only proves the split is assembled
// correctly from a mixed set of per-exercise outcomes.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const previewExerciseDeleteMock = vi.fn()
const deleteExerciseMock = vi.fn()
vi.mock('./exerciseService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exerciseService')>()
  return {
    ...actual,
    previewExerciseDelete: (...args: Parameters<typeof actual.previewExerciseDelete>) =>
      previewExerciseDeleteMock(...args),
    deleteExercise: (...args: Parameters<typeof actual.deleteExercise>) => deleteExerciseMock(...args),
  }
})

const { previewLibraryDelete, deleteLibrary } = await import('./libraryService')

// fetchActiveExerciseIdsFromLibrary's own supabase chain — a plain
// select().eq().eq(), thenable like the real query builder.
function makeIdsChain(ids: string[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  previewExerciseDeleteMock.mockReset()
  deleteExerciseMock.mockReset()
})

describe('previewLibraryDelete — the split, over a mixed set of zero-history and has-history exercises', () => {
  it('sorts three zero-history and two has-history exercises into the correct counts, order-independent', async () => {
    const ids = ['gone-1', 'lost-1', 'gone-2', 'lost-2', 'gone-3']
    fromMock.mockReturnValue(makeIdsChain(ids))
    previewExerciseDeleteMock.mockImplementation((id: string) =>
      Promise.resolve({
        outcome: id.startsWith('gone') ? 'gone' : 'lost',
        setCount: id.startsWith('gone') ? 0 : 4,
        programNames: [],
      }),
    )

    const preview = await previewLibraryDelete('lib-1')

    expect(preview).toEqual({ toDeleteCount: 3, toLostCount: 2 })
    expect(previewExerciseDeleteMock).toHaveBeenCalledTimes(5)
  })

  it('a library with only has-history exercises reports zero for the delete count, not a skipped/omitted one', async () => {
    const ids = ['lost-1', 'lost-2']
    fromMock.mockReturnValue(makeIdsChain(ids))
    previewExerciseDeleteMock.mockResolvedValue({ outcome: 'lost', setCount: 1, programNames: [] })

    const preview = await previewLibraryDelete('lib-1')

    expect(preview).toEqual({ toDeleteCount: 0, toLostCount: 2 })
  })

  it('an empty library (nothing downloaded) reports zero for both counts', async () => {
    fromMock.mockReturnValue(makeIdsChain([]))

    const preview = await previewLibraryDelete('lib-1')

    expect(preview).toEqual({ toDeleteCount: 0, toLostCount: 0 })
    expect(previewExerciseDeleteMock).not.toHaveBeenCalled()
  })
})

describe('deleteLibrary — actually performs the split it previewed', () => {
  it('deletes the zero-history exercises and moves the has-history ones to lost, counted correctly', async () => {
    const ids = ['gone-1', 'lost-1', 'gone-2']
    fromMock.mockReturnValue(makeIdsChain(ids))
    deleteExerciseMock.mockImplementation((id: string) => Promise.resolve(id.startsWith('gone') ? 'gone' : 'lost'))

    const result = await deleteLibrary('lib-1')

    expect(result).toEqual({ deleted: 2, lost: 1 })
    expect(deleteExerciseMock).toHaveBeenCalledTimes(3)
    ids.forEach((id) => expect(deleteExerciseMock).toHaveBeenCalledWith(id))
  })
})
