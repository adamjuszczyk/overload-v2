// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Program, WorkoutDay, ProgramExercise } from '../../types'

// Chunk 9 (SPEC.md "Programs and runs" — "Volume... week-dependent:
// read-only, shown as week 1's reference"). WorkoutDayEditorPage is the
// SAME shared editor the planner (a saved program) and the Plan screen's
// Program tab (a run's own copy) both open (ProgramTab.tsx's own header
// comment) — this proves the one component's two behaviours, gated purely
// by the program's own kind/planningType, exactly as WorkoutDayEditorPage.tsx
// reads them.
//
// Checked at 375px: window.innerWidth is set before every render below.
// Every element this page renders uses percentage/flex widths (width:
// '100%', flex: 1) with no fixed pixel width wider than 375, so nothing
// here depends on jsdom's (absent) real layout engine to stay within a
// phone-width viewport — the DOM structure/visibility assertions below are
// what actually changes between the two program kinds, not layout.

let programs: Program[] = []
let exercises: ProgramExercise[] = []
const deleteMock = vi.fn()
const reorderMock = vi.fn()
const addMock = vi.fn()

vi.mock('./usePrograms', () => ({
  usePrograms: () => ({ data: programs, isLoading: false }),
  useWorkoutDays: () => ({ data: [DAY], isLoading: false }),
  useUpdateWorkoutDayName: () => ({ mutateAsync: vi.fn() }),
  useProgramExercises: () => ({ data: exercises, isLoading: false }),
  useUpdateProgramExerciseReps: () => ({ mutate: vi.fn() }),
  useUpdateProgramExerciseWeightUnit: () => ({ mutate: vi.fn() }),
  useDeleteProgramExercise: () => ({ mutate: deleteMock, isPending: false }),
  useReorderProgramExercises: () => ({ mutate: reorderMock }),
  useAddProgramExercise: () => ({ mutateAsync: addMock, isPending: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../settings/useSettings', () => ({ useSettings: () => ({ data: { weightUnit: 'kg' }, isLoading: false }) }))

const { default: WorkoutDayEditorPage } = await import('./WorkoutDayEditorPage')

const DAY: WorkoutDay = {
  id: 'day-1',
  programId: 'prog-1',
  userId: 'user-1',
  name: 'Push Day',
  position: 0,
  exercises: [],
}

const EXERCISE: ProgramExercise = {
  id: 'pe-1',
  workoutDayId: 'day-1',
  userId: 'user-1',
  exerciseId: 'ex-1',
  position: 0,
  targetReps: 8,
  weightUnit: null,
  exercise: {
    id: 'ex-1',
    userId: 'user-1',
    name: 'Bench Press',
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/program/prog-1/day/day-1']}>
      <Routes>
        <Route path="/program/:programId/day/:dayId" element={<WorkoutDayEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  exercises = [EXERCISE]
})

afterEach(() => {
  cleanup()
  programs = []
  deleteMock.mockReset()
  reorderMock.mockReset()
  addMock.mockReset()
})

describe('WorkoutDayEditorPage — a saved program stays fully editable', () => {
  it('shows ADD EXERCISE FROM LIBRARY and the per-row reorder/delete controls, no read-only notice', () => {
    programs = [{ id: 'prog-1', userId: 'u1', name: 'PPL', schedule: {} as Program['schedule'], workoutDays: [], createdAt: '', updatedAt: '', kind: 'saved' }]
    renderPage()

    expect(screen.getByText('ADD EXERCISE FROM LIBRARY')).toBeTruthy()
    expect(screen.queryByText(/READ-ONLY/)).toBeNull()
  })
})

describe('WorkoutDayEditorPage — a run\'s copy is read-only for volume (week-dependent, every run today)', () => {
  it('hides ADD EXERCISE FROM LIBRARY and shows the read-only notice', () => {
    programs = [{ id: 'prog-1', userId: 'u1', name: 'Run copy', schedule: {} as Program['schedule'], workoutDays: [], createdAt: '', updatedAt: '', kind: 'run', planningType: 'week_dependent' }]
    renderPage()

    expect(screen.queryByText('ADD EXERCISE FROM LIBRARY')).toBeNull()
    expect(screen.getByText('VOLUME IS READ-ONLY HERE — EDIT IT IN A WEEK')).toBeTruthy()
  })

  it('kind undefined (a pre-027 row) falls back to \'saved\' — stays editable', () => {
    programs = [{ id: 'prog-1', userId: 'u1', name: 'Legacy', schedule: {} as Program['schedule'], workoutDays: [], createdAt: '', updatedAt: '' }]
    renderPage()

    expect(screen.getByText('ADD EXERCISE FROM LIBRARY')).toBeTruthy()
  })

  it('planningType \'stable\' on a run is NOT read-only (forward compat for chunk 11)', () => {
    programs = [{ id: 'prog-1', userId: 'u1', name: 'Stable run', schedule: {} as Program['schedule'], workoutDays: [], createdAt: '', updatedAt: '', kind: 'run', planningType: 'stable' }]
    renderPage()

    expect(screen.getByText('ADD EXERCISE FROM LIBRARY')).toBeTruthy()
    expect(screen.queryByText(/READ-ONLY/)).toBeNull()
  })
})
