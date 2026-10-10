// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 28 (TASKS-1.1 "Header link": "Plan's PRIORITIES still opens
// /plan/priorities (screen test)"). Plan's header PRIORITIES button is the
// only way into the run's priorities screen, which chunk 28 makes view-only.
// This proves the link end to end at the screen layer: Plan rendered with the
// REAL PrioritiesEditor on the /plan/priorities route (the one App.tsx wires),
// so a button that navigated anywhere else — or to a route that isn't the
// priorities screen — fails here, not just "some onClick fires". What the
// screen then shows and refuses to offer is PrioritiesEditor.test.tsx's job.
//
// Mocks are the same shapes PlanPage.programsLink.test.tsx uses to reach the
// header, plus the priorities read hook (the screen under the link).

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

// The run's stored marks: chest is FOCUS.
const runMarks: StoredMark[] = [
  { tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: '2026-01-01T00:00:00Z' },
]

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('./useProgramPriorities', () => ({
  useProgramPriorities: () => ({ data: runMarks, isLoading: false, isError: false }),
  useSetPriorityMark: () => ({ mutate: vi.fn(), isPending: false }),
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
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
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
const { default: PrioritiesEditor } = await import('./PrioritiesEditor')

afterEach(() => cleanup())

// Rendered outside <Routes>, so it shows the current path whichever screen is
// up (the priorities route renders the real editor, which can't host a probe).
function LocationProbe() {
  const location = useLocation()
  return <div>AT {location.pathname}</div>
}

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <LocationProbe />
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/priorities" element={<PrioritiesEditor />} />
        <Route path="/program" element={<div>PROGRAMS PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("PlanPage — the header's PRIORITIES link (chunk 28)", () => {
  it("opens /plan/priorities: the active run's priorities screen, showing its mark and offering no control to change it", () => {
    renderPlan()
    expect(screen.getByText('AT /plan')).toBeTruthy()

    fireEvent.click(screen.getByText('PRIORITIES'))

    // The route...
    expect(screen.getByText('AT /plan/priorities')).toBeTruthy()
    expect(screen.queryByText('PROGRAMS PAGE')).toBeNull()
    // ...and the screen on it: the run's own chest FOCUS, as a label.
    const chestToggle = screen.getByText('CHEST').closest('button') as HTMLElement
    expect(within(chestToggle.parentElement as HTMLElement).getByText('FOCUS')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'FOCUS' })).toEqual([])
    expect(screen.queryAllByRole('button', { name: "DON'T CARE" })).toEqual([])
  })
})
