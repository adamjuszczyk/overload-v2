// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 19 (SPEC "Targets" — "Weight targets: per set, in the week plan
// only. Never in the program"; reviewer's note: "entered and shown in the
// exercise's resolved unit and stored in kg ... The round trip must show
// what was typed: 225 lb in → 225 lb shown after reload, despite
// numeric(6,2) kg storage. Prove it with a test. Blank → null."). Same
// mocking recipe as PlanPage.stageKind.test.tsx (a capturable useUpdateSet
// mock), trimmed to this file's own concern.

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
// weightUnit: 'lbs' — the exercise's own resolved unit, per the brief's own
// "225 lb in → 225 lb shown" scenario (not the global Settings default).
const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0,
  weightUnit: 'lbs', exercise: EX_A,
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

function openWeightEditor() {
  fireEvent.click(screen.getByRole('button', { name: '—' }))
}

describe('PlanPage — weight target editor (chunk 19)', () => {
  it('no target shows "—", not a note of any kind', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    expect(screen.getByRole('button', { name: '—' })).toBeTruthy()
  })

  it('typing 225 (lbs, the exercise\'s resolved unit) writes target_weight in kg via useUpdateSet', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    openWeightEditor()
    const input = screen.getByLabelText('Weight target')
    fireEvent.change(input, { target: { value: '225' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    const call = updateSetMutate.mock.calls[0][0] as { id: string; changes: Record<string, unknown> }
    expect(call.id).toBe('set-1')
    // lbsToKg(225) = 102.06 (weightUnit.ts, 2-decimal rounding) — the
    // canonical kg value this chunk's own round-trip guard is built on.
    expect(call.changes).toEqual({ targetWeight: 102.06 })
  })

  it('round trip: the stored kg value (102.06) displays back as 225lbs, exactly what was typed', () => {
    mockState.plans = [makePlan([makeSet({ targetWeight: 102.06 })])]
    renderPlanPage()

    expect(screen.getByRole('button', { name: '225lbs' })).toBeTruthy()
  })

  it('blank clears the target — writes { targetWeight: null }', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetWeight: 102.06 })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: '225lbs' }))
    const input = screen.getByLabelText('Weight target')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { targetWeight: null } })
  })

  it('invalid input is refused inline — nothing is written, the raw text stays', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    openWeightEditor()
    const input = screen.getByLabelText('Weight target')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/enter a valid weight/i)).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('abc')
  })

  it('a negative number is also refused inline (matches the DB\'s own target_weight >= 0 check)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    openWeightEditor()
    const input = screen.getByLabelText('Weight target')
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('re-committing the same displayed value writes nothing (no spurious update)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetWeight: 102.06 })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: '225lbs' }))
    const input = screen.getByLabelText('Weight target')
    fireEvent.change(input, { target: { value: '225' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('a dropset stage also gets its own, independent weight target (reviewer\'s note: stages already edit RIR-style fields, so weight/reps follow)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1 }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1, targetWeight: 61.23 }),
    ])]
    renderPlanPage()

    // Head "—", stage "135lbs" (61.23kg -> lbs) — two independent editors.
    expect(screen.getByRole('button', { name: '—' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '135lbs' })).toBeTruthy()
  })
})
