// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 14 — "Staged sets: all four stage kinds" (SPEC.md), the week-plan
// authoring half: PlanSetGroup labels each stage row by its head's
// resolved kind and, once a head has at least one real stage, offers a
// STAGE KIND chip row (RatingChips, same component/look FORM rating
// already uses) to set it. Same mocking recipe as
// PlanPage.repTargets.test.tsx, extended with a capturable useUpdateSet
// mock so the chip tap's own write can be asserted.

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
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
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

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

describe('PlanPage — a head with no stages shows no STAGE KIND chip row yet', () => {
  it('no chip row, no kind label — nothing staged to label', () => {
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    expect(screen.queryByText('DROPSET')).toBeNull()
  })
})

describe('PlanPage — stage rows are labelled by the head\'s resolved kind (chunk 14)', () => {
  it('a legacy/null stage_kind head (today\'s only case) labels its stage DROPSET and shows the chip row', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1 }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()
    expect(screen.getByText('STAGE KIND')).toBeTruthy()
    // Appears twice: the stage row's own label, and the (active) DROPSET
    // chip in the picker below it.
    expect(screen.getAllByText('DROPSET')).toHaveLength(2)
  })

  it('a head planned with stageKind "rest_pause" labels its stage REST-PAUSE', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1, stageKind: 'rest_pause' }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()
    // Same reasoning — the stage row's own label, and the active chip.
    expect(screen.getAllByText('REST-PAUSE')).toHaveLength(2)
  })
})

describe('PlanPage — the STAGE KIND chip row writes the head\'s own stage_kind (chunk 14)', () => {
  it('tapping CLUSTER calls useUpdateSet with {id: head.id, changes: {stageKind: "cluster"}}', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1 }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'CLUSTER' }))

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head', changes: { stageKind: 'cluster' } })
  })
})
