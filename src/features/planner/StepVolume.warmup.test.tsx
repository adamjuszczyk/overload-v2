// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Program, WorkoutDay, ProgramExercise, ProgramSet } from '../../types'

// Chunk 15 — "A set kind, planned in step 3" (SPEC.md "Warmup sets"):
// ProgramSetGroupEditor's WARMUP chip, head-only, mutually exclusive with
// staging by construction (hidden once a head has stages; ADD STAGE hidden
// once a head is a warmup). Same mocking recipe as
// StepVolume.stageKind.test.tsx.

let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
let setsByExercise: Record<string, ProgramSet[]> = {}
const setWarmupMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: exercisesByDay[workoutDayId] ?? [], isLoading: false }),
  useUpdatePlanningType: () => ({ mutate: vi.fn(), isPending: false }),
  // Chunk 22 — the program-tab/planner deload-rules override, mounted
  // unconditionally right alongside the PLANNING picker above.
  useUpdateProgramDeloadRules: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('./usePlanner', async () => {
  const actual = await vi.importActual<typeof import('./plannerService')>('./plannerService')
  return {
    useProgramSets: (ids: string[]) => ({
      data: ids.flatMap((id) => setsByExercise[id] ?? []),
      isLoading: false,
    }),
    useSetExerciseSetCount: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateSetRepTarget: () => ({ mutate: vi.fn(), isPending: false }),
    useSetRepTargetForAllSets: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateProgramSetIsWarmup: () => ({ mutate: setWarmupMutateMock }),
    useUpdateProgramSetStageKind: () => ({ mutate: vi.fn() }),
    // Chunk 16 (SPEC "Rest") — not this file's own concern (the WARMUP
    // chip); every render now also mounts RestStepper(s), so these must
    // resolve too.
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
  setWarmupMutateMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }]
  exercisesByDay = {
    'wd-1': [{
      id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
      exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
    }],
  }
  setsByExercise = {}
})

function program(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'saved', planningType: 'week_dependent',
  }
}

function set(overrides: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id: 'ps-1', userId: 'user-1', programExerciseId: 'pe-1', position: 1, isWarmup: false,
    stageKind: null, stageRestSeconds: null, parentProgramSetId: null, stageIndex: 0,
    repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderStep() {
  return render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
}

describe('StepVolume — WARMUP chip (chunk 15, head-only)', () => {
  it('a plain head (no stages) offers the WARMUP chip, unselected', () => {
    setsByExercise['pe-1'] = [set({ id: 'head', isWarmup: false })]
    renderStep()
    expect(screen.getByText('SET KIND')).toBeTruthy()
    const chip = screen.getByRole('button', { name: /WARMUP/i })
    // Unselected: --surface background (RatingChips' own inactive token).
    expect(chip.style.backgroundColor).toBe('var(--surface)')
  })

  it('tapping WARMUP calls useUpdateProgramSetIsWarmup with {id, isWarmup: true}', () => {
    setsByExercise['pe-1'] = [set({ id: 'head' })]
    renderStep()
    fireEvent.click(screen.getByRole('button', { name: /WARMUP/i }))
    expect(setWarmupMutateMock).toHaveBeenCalledWith({ id: 'head', isWarmup: true })
  })

  it('an already-warmup head shows the chip selected, and tapping it again clears back to isWarmup: false', () => {
    setsByExercise['pe-1'] = [set({ id: 'head', isWarmup: true })]
    renderStep()
    const chip = screen.getByRole('button', { name: /WARMUP/i })
    expect(chip.style.backgroundColor).toBe('var(--accent)')
    fireEvent.click(chip)
    expect(setWarmupMutateMock).toHaveBeenCalledWith({ id: 'head', isWarmup: false })
  })

  it('a warmup head never offers ADD STAGE (a warmup is never staged)', () => {
    setsByExercise['pe-1'] = [set({ id: 'head', isWarmup: true })]
    renderStep()
    expect(screen.queryByRole('button', { name: /ADD STAGE/i })).toBeNull()
  })

  it('a head with a real stage shows no WARMUP chip at all (mutually exclusive with staging)', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1, isWarmup: false }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()
    expect(screen.queryByText('SET KIND')).toBeNull()
    expect(screen.queryByRole('button', { name: /^WARMUP$/i })).toBeNull()
  })
})
