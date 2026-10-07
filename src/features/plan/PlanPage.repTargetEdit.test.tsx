// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 19 (SPEC "Targets" — "Rep targets ... The week plan can override a
// set's rep target for that week"; reviewer's note: "parsed only by
// parseRepTarget. Invalid input is refused inline and nothing is written.
// Writes only that week-plan set's rep_min/rep_max/is_amrap, never the
// program set"; and "AMRAP ... RIR defaults to 0, editable ... when a week
// set is changed to AMRAP in Plan and its target_rir is null, write
// target_rir = 0 in the same update; never overwrite an existing RIR").
// Same mocking recipe as PlanPage.stageKind.test.tsx.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(new Date(), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}
const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0,
  weightUnit: null, exercise: EX_A,
}

function makeProgram(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent',
  }
}

function makeSet(overrides: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'set-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1',
    setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
    ...overrides,
  }
}

function makePlan(sets: WeekPlanSet[]): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber: 1, isDeload: false, notes: null, sets, exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { plans: WeekPlan[] } = { plans: [] }
const updateSetMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

describe('PlanPage — rep target editor (chunk 19)', () => {
  it('typing a range writes rep_min/rep_max via useUpdateSet, is_amrap false, no target_rir key at all', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set rep target' }))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: '8-12' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledWith({
      id: 'set-1',
      changes: { repMin: 8, repMax: 12, isAmrap: false },
    })
    expect('targetRir' in updateSetMutate.mock.calls[0][0].changes).toBe(false)
  })

  it('invalid input is refused inline — nothing written, the raw text stays', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set rep target' }))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: 'eight' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/enter a number/i)).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('eight')
  })

  it('blank clears an existing target — writes { repMin: null, repMax: null, isAmrap: false }', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ repMin: 8, repMax: 12 })])]
    renderPlanPage()

    fireEvent.click(screen.getByText('8–12'))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledWith({
      id: 'set-1',
      changes: { repMin: null, repMax: null, isAmrap: false },
    })
  })

  it('re-committing the exact same target writes nothing', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ repMin: 8, repMax: 12 })])]
    renderPlanPage()

    fireEvent.click(screen.getByText('8–12'))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: '8-12' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('only writes THIS week-plan set\'s own columns — never touches a second row', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1 }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()

    const headButtons = screen.getAllByRole('button', { name: 'Set rep target' })
    fireEvent.click(headButtons[0])
    const input = screen.getAllByLabelText('Rep target')[0]
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head', changes: { repMin: 5, repMax: 5, isAmrap: false } })
  })
})

describe('PlanPage — AMRAP defaults target_rir to 0, only when null (chunk 19)', () => {
  it('changing to AMRAP with no existing RIR writes target_rir: 0 in the SAME update', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetRir: null })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set rep target' }))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: 'AMRAP' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({
      id: 'set-1',
      changes: { repMin: null, repMax: null, isAmrap: true, targetRir: 0 },
    })
  })

  it('changing to AMRAP with an EXISTING RIR never overwrites it — no target_rir key at all', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetRir: 3 })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set rep target' }))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: 'AMRAP' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { repMin: null, repMax: null, isAmrap: true } })
    expect('targetRir' in updateSetMutate.mock.calls[0][0].changes).toBe(false)
  })

  it('a non-AMRAP target change never gets a target_rir default, even with a null RIR', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetRir: null })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set rep target' }))
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: '8-12' } })
    fireEvent.blur(input)

    expect('targetRir' in updateSetMutate.mock.calls[0][0].changes).toBe(false)
  })
})
