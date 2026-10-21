// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 26 gave Plan's header a "Programs" icon button that navigated to /program; chunk 52 (TASKS-1.2: "the header's Programs icon
// and PRIORITIES button go; the header becomes 'PLAN | PROGRAMS' tabs"; SPEC Screens → Plan screen → Header (1, 8a), P1.2-12) takes it
// out. PROGRAMS is a tab now (chunk 65's ProgramsTab), so opening it is a change of what the screen shows, not a navigation: the route
// stays /plan. Absence tests (Checks that lied #32): the icon is not on the
// header, no control of the header navigates to /program, and the tab is a tab.
//
// Same minimal fixture and mocks as the rest of Plan's header tests, with the PROGRAMS tab stood in by the shared marker that draws the
// tabs the shell hands it its tab switch for.

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
vi.mock('../programs/ProgramsTab', async () => ({ default: (await import('./programsTab.standIn.testutil')).default }))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [], isLoading: false }),
  useAllWeekPlans: () => ({ data: [], isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
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
      <LocationProbe />
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/program" element={<div>PROGRAMS ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PlanPage — the header has no Programs icon any more (chunk 52); PROGRAMS is a tab', () => {
  it('has no "Programs" labelled control, and none of the header\'s buttons leaves /plan', () => {
    renderPlan()
    expect(screen.getByText('AT /plan')).toBeTruthy()

    expect(screen.queryByLabelText('Programs')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Programs' })).toBeNull()
    // Every button the screen has, tapped in turn: the route never changes.
    for (const button of screen.getAllByRole('button')) fireEvent.click(button)
    expect(screen.getByText('AT /plan')).toBeTruthy()
    expect(screen.queryByText('PROGRAMS ROUTE')).toBeNull()
  })

  it('the PROGRAMS tab draws the PROGRAMS tab, inside the shell, and stays on /plan', () => {
    renderPlan()
    expect(screen.queryByText('PROGRAMS TAB')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'PROGRAMS' }))

    expect(screen.getByText('PROGRAMS TAB')).toBeTruthy()
    expect(screen.getByText('AT /plan')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'PROGRAMS' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'PLAN' }).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    expect(screen.queryByText('PROGRAMS TAB')).toBeNull()
  })
})
