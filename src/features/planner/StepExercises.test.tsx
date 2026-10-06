// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Program, WorkoutDay, ProgramExercise } from '../../types'

// Chunk 11 — step 2 (exercises, order, weekday). Heavy-mocked at the hook
// boundary, same precedent as ProgramPage.test.tsx/PrioritiesEditor.test.tsx:
// usePrograms.ts's hooks value-import the real Supabase client at module
// load.

let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
const createDayMutateAsyncMock = vi.fn()
const updateNameMutateAsyncMock = vi.fn()
const deleteDayMutateMock = vi.fn()
const reorderMutateMock = vi.fn()
const deleteExerciseMutateMock = vi.fn()
const updateWeightUnitMutateMock = vi.fn()
const assignWeekdayMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useCreateWorkoutDay: () => ({ mutateAsync: createDayMutateAsyncMock, isPending: false }),
  useUpdateWorkoutDayName: () => ({ mutateAsync: updateNameMutateAsyncMock, isPending: false }),
  useDeleteWorkoutDay: () => ({ mutate: deleteDayMutateMock, isPending: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: exercisesByDay[workoutDayId] ?? [], isLoading: false }),
  useReorderProgramExercises: () => ({ mutate: reorderMutateMock, isPending: false }),
  useDeleteProgramExercise: () => ({ mutate: deleteExerciseMutateMock, isPending: false }),
  useUpdateProgramExerciseWeightUnit: () => ({ mutate: updateWeightUnitMutateMock, isPending: false }),
}))

vi.mock('./usePlanner', () => ({
  useAssignWorkoutWeekday: () => ({ mutate: assignWeekdayMutateMock, isPending: false }),
}))

vi.mock('../settings/settingsStore', () => ({
  useSettingsStore: (selector: (s: { weightUnit: string }) => unknown) => selector({ weightUnit: 'kg' }),
}))

vi.mock('../programs/ExercisePicker', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      EXERCISE PICKER
      <button onClick={onClose}>close picker</button>
    </div>
  ),
}))

const { default: StepExercises } = await import('./StepExercises')

afterEach(() => {
  cleanup()
  createDayMutateAsyncMock.mockReset()
  updateNameMutateAsyncMock.mockReset()
  deleteDayMutateMock.mockReset()
  reorderMutateMock.mockReset()
  deleteExerciseMutateMock.mockReset()
  updateWeightUnitMutateMock.mockReset()
  assignWeekdayMutateMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  workoutDays = []
  exercisesByDay = {}
})

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'saved', planningType: 'week_dependent',
    ...overrides,
  }
}

function day(overrides: Partial<WorkoutDay> = {}): WorkoutDay {
  return { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [], ...overrides }
}

function exercise(overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return {
    id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0,
    targetReps: null, weightUnit: null,
    exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
    ...overrides,
  }
}

describe('StepExercises — empty states', () => {
  it('no workouts yet', () => {
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByText('NO WORKOUTS YET')).toBeTruthy()
  })

  it('a workout with no exercises shows the SPEC empty state "Add an exercise"', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByText('Add an exercise')).toBeTruthy()
  })

  it('read-only: a workout with no exercises shows NO EXERCISES YET, not an add button', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly />)
    expect(screen.getByText('NO EXERCISES YET')).toBeTruthy()
    expect(screen.queryByText('Add an exercise')).toBeNull()
  })
})

describe('StepExercises — weekday assignment ("one weekday per workout")', () => {
  it('tapping an unassigned day assigns this workout to it', () => {
    workoutDays = [day({ id: 'wd-1' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('MON'))

    expect(assignWeekdayMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ workoutDayId: 'wd-1', dow: 'monday' }),
    )
  })

  it('tapping the already-assigned day clears it back to rest (dow: null)', () => {
    workoutDays = [day({ id: 'wd-1' })]
    const p = program({ schedule: { monday: 'wd-1', tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } })
    render(<StepExercises program={p} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('MON'))

    expect(assignWeekdayMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ workoutDayId: 'wd-1', dow: null }),
    )
  })

  it('weekday chips stay interactive even when volumeReadOnly (schedule is not "volume")', () => {
    workoutDays = [day({ id: 'wd-1' })]
    render(<StepExercises program={program()} volumeReadOnly />)

    fireEvent.click(screen.getByText('TUE'))

    expect(assignWeekdayMutateMock).toHaveBeenCalled()
  })
})

describe('StepExercises — volumeReadOnly gates exercise and workout structure, not schedule', () => {
  it('hides reorder/delete on an exercise row and the ADD EXERCISE button', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    render(<StepExercises program={program()} volumeReadOnly />)

    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    expect(screen.queryByLabelText(`Delete ${workoutDays[0].name}`)).toBeNull()
  })

  it('hides ADD WORKOUT when read-only', () => {
    render(<StepExercises program={program()} volumeReadOnly />)
    expect(screen.queryByText('ADD WORKOUT')).toBeNull()
  })

  it('shows ADD WORKOUT and per-exercise controls when editable', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('ADD WORKOUT')).toBeTruthy()
    expect(screen.getByText('ADD EXERCISE')).toBeTruthy()
  })
})

describe('StepExercises — reorder, 375px', () => {
  it('moving the second exercise up swaps its position with the first', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    const upButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up'))
    fireEvent.click(upButtons[1]) // Incline Press's own "up"

    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-2', position: 0 },
      { id: 'pe-1', position: 1 },
    ])
  })

  it('no rendered element carries a fixed pixel width wider than 375px', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    const { container } = render(<StepExercises program={program()} volumeReadOnly={false} />)
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
