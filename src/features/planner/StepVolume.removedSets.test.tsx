// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Program, WorkoutDay, ProgramExercise, ProgramSet } from '../../types'

// Chunk 32 (TASKS-1.1 "Who reads removed sets"): "Make this week the new default" soft-removes
// a program set the default drops (v2_program_sets.removed_at, migration 040) instead of
// deleting it, so weeks planned earlier keep their link and its rest. fetchProgramSets
// keeps returning such a set (the workout screen finds a planned set's rest through it), so
// what lists "the default" must leave it out: until chunk 33 removes the program tab, that
// is StepVolume's list. These render the real component with a set the default dropped.

let setsByExercise: Record<string, ProgramSet[]> = {}
const setCountMutateMock = vi.fn()
const updateTargetMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: [day()], isLoading: false }),
  useProgramExercises: () => ({ data: [exercise()], isLoading: false }),
  useUpdatePlanningType: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProgramDeloadRules: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./usePlanner', async () => {
  const actual = await vi.importActual<typeof import('./plannerService')>('./plannerService')
  return {
    // The real read keeps returning a dropped set (plannerService.ts's fetchProgramSets): it is in this list.
    useProgramSets: (ids: string[]) => ({ data: ids.flatMap((id) => setsByExercise[id] ?? []), isLoading: false }),
    useSetExerciseSetCount: () => ({ mutate: setCountMutateMock, isPending: false }),
    useUpdateSetRepTarget: () => ({ mutate: updateTargetMutateMock, isPending: false }),
    useSetRepTargetForAllSets: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateProgramSetIsWarmup: () => ({ mutate: vi.fn() }),
    useUpdateProgramSetStageKind: () => ({ mutate: vi.fn() }),
    useUpdateProgramSetRest: () => ({ mutate: vi.fn() }),
    useUpdateProgramSetStageRest: () => ({ mutate: vi.fn() }),
    useAddProgramSetStage: () => ({ mutate: vi.fn(), isPending: false }),
    useRemoveProgramSetStage: () => ({ mutate: vi.fn() }),
    headSets: actual.headSets,
    summarizeRepTargets: actual.summarizeRepTargets,
  }
})

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  setCountMutateMock.mockReset()
  updateTargetMutateMock.mockReset()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  setsByExercise = {}
})

function program(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '', updatedAt: '', kind: 'run', planningType: 'stable',
  }
}
function day(): WorkoutDay {
  return { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
}
function exercise(): ProgramExercise {
  return {
    id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
    exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
  }
}
function set(overrides: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id: 'ps-1', userId: 'user-1', programExerciseId: 'pe-1', position: 1, isWarmup: false, stageKind: null, stageRestSeconds: null,
    parentProgramSetId: null, stageIndex: 0, repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '', ...overrides,
  }
}
const DROPPED = '2026-10-11T10:00:00Z'

describe('StepVolume — a set the default dropped (removed_at) is not in the list', () => {
  // Break: drop the removedAt filter in WorkoutVolumeEditor -> three rows, the count reads 3, 03 shows.
  it('is not listed or counted: the rows and the SETS stepper show the sets that are part of the default', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'a', position: 1, repMin: 8, repMax: 10 }),
      set({ id: 'dropped', position: 2, repMin: 5, repMax: 5, removedAt: DROPPED }),
      set({ id: 'b', position: 3, repMin: 6, repMax: 8 }),
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType={false} />)

    // Two rows, numbered 01 and 02: the dropped set is not a row, so the one after it takes 02.
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
    expect(screen.queryByText('03')).toBeNull()
    // Its rep target (5) is nowhere on the screen; the two that remain are.
    expect(screen.queryByRole('button', { name: '5' })).toBeNull()
    expect(screen.getByRole('button', { name: '8–10' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '6–8' })).toBeTruthy()
  })

  it('+ and − act on the sets that are part of the default: − hands the stepper the two live sets, not the dropped one', () => {
    const a = set({ id: 'a', position: 1 })
    const b = set({ id: 'b', position: 3 })
    setsByExercise['pe-1'] = [a, set({ id: 'dropped', position: 2, removedAt: DROPPED }), b]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType={false} />)

    fireEvent.click(screen.getByLabelText('Fewer sets for Bench Press'))
    // The call carries the live heads only (it would shrink the default by trimming its LAST set,
    // and a dropped one is never that), and the new count is one fewer than the live count.
    expect(setCountMutateMock).toHaveBeenCalledTimes(1)
    expect(setCountMutateMock).toHaveBeenCalledWith({ programExerciseId: 'pe-1', currentHeads: [a, b], count: 1 })
  })

  it('an exercise whose every set was dropped reads as having none', () => {
    setsByExercise['pe-1'] = [set({ id: 'dropped', position: 1, removedAt: DROPPED })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType={false} />)
    expect(screen.getByText('NO SETS YET')).toBeTruthy()
    expect(screen.queryByText('01')).toBeNull()
  })

  it('a dropped stage under a live head is not listed either', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1, stageKind: 'dropset' }),
      set({ id: 'stage-live', position: 1, parentProgramSetId: 'head', stageIndex: 1, repMin: 12, repMax: 12 }),
      set({ id: 'stage-dropped', position: 1, parentProgramSetId: 'head', stageIndex: 2, repMin: 20, repMax: 20, removedAt: DROPPED }),
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType={false} />)
    expect(screen.getByRole('button', { name: '12' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '20' })).toBeNull()
  })

  it('a set that was never dropped is listed as ever: removedAt absent, or null', () => {
    setsByExercise['pe-1'] = [set({ id: 'a', position: 1 }), set({ id: 'b', position: 2, removedAt: null })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType={false} />)
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
  })
})
