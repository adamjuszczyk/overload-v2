// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WeekPlan } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 51a (SPEC Plan screen [1.2] → Bottom: "CHANGE THE PROGRAM FROM WEEK N (or CYCLE N)"; TASKS 51a: "today's PlanPage gets 'CHANGE THE
// PROGRAM FROM WEEK N' / 'FROM CYCLE N' at the bottom of the week panel in this chunk — the only Plan change here"). This file
// proves the button and nothing behind it: where it is, the number it names, that a past week has none, and that it opens the
// route the app wires to the screen. N is chunk 45's `changeStartWeek` over the run's planned weeks and the sessions Plan knows
// are done, so the fixtures differ in exactly what N depends on: which plan rows are done.

// The run started two Mondays ago, so today is in week 3 whatever day this runs.
const startDate = format(startOfWeek(subWeeks(new Date(), 2), { weekStartsOn: 1 }), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1',
  userId: 'user-1',
  name: 'Test Meso',
  programId: 'prog-1',
  status: 'active',
  startDate,
  endDate: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const state = vi.hoisted(() => ({
  program: null as unknown as Program,
  plans: [] as WeekPlan[],
  done: new Set<string>(),
  cycle: 3,
}))

function makeProgram(over: Partial<Program> = {}): Program {
  return {
    id: 'prog-1',
    userId: 'user-1',
    name: 'Test Program',
    schedule: EMPTY_SCHEDULE,
    workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run',
    ...over,
  }
}

function plan(id: string, weekNumber: number): WeekPlan {
  return { id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z' }
}

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [], isLoading: false }),
  useAllWeekPlans: () => ({ data: state.plans, isLoading: false }),
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

beforeEach(() => {
  state.program = makeProgram()
  state.plans = []
  state.done = new Set()
  state.cycle = 3
})
afterEach(() => cleanup())

function LocationProbe() {
  return <div>AT {useLocation().pathname}</div>
}

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/change" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const BUTTON = /^CHANGE THE PROGRAM FROM (WEEK|CYCLE) \d+$/

describe('the CHANGE THE PROGRAM button at the foot of the week panel', () => {
  it('is the last thing in the panel and names the week the changes start in', () => {
    // Week 3 is current: three plan rows, none done.
    state.plans = [plan('w3-a', 3), plan('w3-b', 3), plan('w3-c', 3)]
    const { container } = renderPlan()
    const button = screen.getByRole('button', { name: BUTTON })
    expect(button.textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
    // The panel's last child: the button closes the week's content (board 1: "Bottom").
    expect(button.parentElement!.lastElementChild).toBe(button)
    expect(container.contains(button)).toBe(true)
  })

  it('names the week of the first session that has not started, not simply the current week', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3), plan('w4-a', 4)]
    // Everything in week 3 is done: the changes start where the next not-done session is.
    state.done = new Set(['w3-a', 'w3-b'])
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it('with nothing planned beyond a finished current week, names the week after it', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3)]
    state.done = new Set(['w3-a', 'w3-b'])
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it('with a session of the current week not done, a done one earlier in that week does not move it', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3)]
    state.done = new Set(['w3-a'])
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
  })

  it('opens CHANGE THE PROGRAM', () => {
    state.plans = [plan('w3-a', 3)]
    renderPlan()
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    expect(screen.getByText('AT /plan/change')).toBeTruthy()
  })

  it('a past week has no button (SPEC: "A past week has no COPY / VOLUME / WEEK row and no CHANGE THE PROGRAM button")', () => {
    state.plans = [plan('w3-a', 3)]
    renderPlan()
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeNull()
    fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.getByText('WEEK 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })

  it('a week ahead has it, still naming the week the changes start in (the next session that is not done), not the viewed week', () => {
    state.plans = [plan('w3-a', 3)]
    renderPlan()
    fireEvent.click(screen.getByLabelText('Next week'))
    expect(screen.getByText('WEEK 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
  })

  it('a sequence run says CYCLE and names the cycle', () => {
    state.program = makeProgram({ scheduleType: 'sequence' })
    state.cycle = 5
    state.plans = [plan('c5-a', 5), plan('c5-b', 5)]
    state.done = new Set(['c5-a'])
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM CYCLE 5')
  })
})
