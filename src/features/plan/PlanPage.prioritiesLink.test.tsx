// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 28 put a PRIORITIES button in Plan's header (the way into the run's view-only priorities screen); chunk 52 (TASKS-1.2: "the
// header's Programs icon and PRIORITIES button go"; SPEC Screens → Plan screen → Header (1, 8a): the PLAN | PROGRAMS tabs, then
// "[PROGRAM] · CURRENT PROGRAM"; PR1: FOCUS / DON'T CARE sit on the CURRENT PROGRAM card, which chunk 65 builds) takes it out. Absence
// test (Checks that lied #32): no control on Plan opens /plan/priorities. The route itself stays (App.tsx; PrioritiesEditor.test.tsx
// proves the screen), and the PROGRAMS tab's CURRENT PROGRAM card (chunk 65: its FOCUS and DON'T CARE rows) is where a run's priorities are reached.

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
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
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
      <LocationProbe />
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/priorities" element={<div>PRIORITIES SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("PlanPage — the header's PRIORITIES button is gone (chunk 52)", () => {
  it('no control is called PRIORITIES, and none of the screen\'s buttons opens /plan/priorities', () => {
    renderPlan()
    expect(screen.getByText('AT /plan')).toBeTruthy()

    expect(screen.queryByText('PRIORITIES')).toBeNull()
    expect(screen.queryByLabelText(/priorities/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /priorities/i })).toBeNull()
    // Every button and tab on the screen, tapped in turn: the route never becomes the priorities screen.
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('tab')]) fireEvent.click(control)
    expect(screen.queryByText('PRIORITIES SCREEN')).toBeNull()
    expect(screen.getByText('AT /plan')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    for (const button of screen.queryAllByRole('button')) fireEvent.click(button)
    expect(screen.queryByText('PRIORITIES SCREEN')).toBeNull()
    expect(screen.getByText('AT /plan')).toBeTruthy()
  })
})
