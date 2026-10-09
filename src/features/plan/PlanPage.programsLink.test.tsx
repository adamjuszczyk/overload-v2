// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 26 (SPEC.md "Programs page" — "Reached from the plan screen's
// header"; TASKS.md chunk 26 verification: "a checklist of every former
// PROGRAM capability... each reached from Plan's header"). This file proves
// the ENTRY POINT only: PlanPage's new "Programs" icon button really
// navigates to the real /program route App.tsx wires to ProgramsPage — not
// just that some onClick fires. Every capability ONCE THERE (create/open in
// planner/start/end run/delete/priorities) is ProgramsPage's own layer,
// proven in ProgramsPage.test.tsx — "prove every rule at the layer that
// applies it" (Lessons). Same LocationProbe idiom PlannerPage.test.tsx
// already established for "real navigation targets".
//
// Minimal fixture/mocks — same shapes PlanPage.renderParity.test.tsx already
// uses successfully for the active-meso render, trimmed to what's needed
// just to reach the header (no exercises/sets: this test doesn't touch the
// Weeks tab's content at all).

const today = new Date().toISOString().slice(0, 10)

const activeMeso: Mesocycle = {
  id: 'meso-1',
  userId: 'user-1',
  name: 'Test Meso',
  programId: 'prog-1',
  status: 'active',
  startDate: today,
  endDate: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const program: Program = {
  id: 'prog-1',
  userId: 'user-1',
  name: 'Test Program',
  schedule: EMPTY_SCHEDULE,
  workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run',
}

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [], isLoading: false }),
  useAllWeekPlans: () => ({ data: [], isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => cleanup())

function LocationProbe() {
  const location = useLocation()
  return <div>AT {location.pathname}</div>
}

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/program" element={<LocationProbe />} />
        <Route path="/plan/priorities" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PlanPage — the header\'s new "Programs" link (chunk 26)', () => {
  it('navigates to the real /program route — the one App.tsx wires to ProgramsPage', () => {
    renderPlan()

    fireEvent.click(screen.getByLabelText('Programs'))

    expect(screen.getByText('AT /program')).toBeTruthy()
  })

  it('is a distinct control from the existing PRIORITIES link, which still goes to /plan/priorities', () => {
    renderPlan()

    fireEvent.click(screen.getByText('PRIORITIES'))

    expect(screen.getByText('AT /plan/priorities')).toBeTruthy()
  })
})
