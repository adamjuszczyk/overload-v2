// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 15 (SPEC "Warmup sets" — "the week plan offer[s] warmup sets"):
// PlanSetGroup's WARMUP chip, head-only and mutually exclusive with
// staging (same posture as StepVolume.tsx's own, one layer up — the
// program's own sets). Same mocking recipe as PlanPage.stageKind.test.tsx.

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
const addWarmupMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
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
  useAddWarmupSet: () => ({ mutate: addWarmupMutate, isPending: false }),
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
const { openExerciseMenu, openSetMenu } = await import('./planMenus.testutil')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

describe('PlanPage — warmup sets (chunk 15; per-row chip replaced by the exercise ⋯ "Add warmup sets", 2026-10-10)', () => {
  it('a plain week shows no warmup control anywhere by default, and no per-row WARMUP option in the set\'s ⋯', () => {
    mockState.plans = [makePlan([makeSet({ id: 'head', isWarmup: false })])]
    renderPlanPage()
    expect(screen.queryByText('SET KIND')).toBeNull()
    expect(screen.queryByText(/WARMUP/)).toBeNull()
    expect(screen.getByText('NO RIR')).toBeTruthy()

    openSetMenu(1)
    expect(screen.queryByRole('button', { name: 'WARMUP' })).toBeNull()
    expect(screen.queryByText('SET KIND')).toBeNull()
  })

  it('"Add warmup sets" is in the exercise\'s ⋯ and calls useAddWarmupSet for that exercise', () => {
    addWarmupMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ id: 'head' })])]
    renderPlanPage()
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull() // not on the page by default

    openExerciseMenu()
    fireEvent.click(screen.getByLabelText('Add warmup sets'))

    expect(addWarmupMutate).toHaveBeenCalledTimes(1)
    expect(addWarmupMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-1', programExerciseId: 'pe-1' })
    // The menu closes after the action.
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull()
  })

  it('a warmup head shows a WARMUP marker, no RIR stepper, and no ADD STAGE (a warmup is never staged)', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'warm', setNumber: 1, isWarmup: true }),
      makeSet({ id: 'work', setNumber: 2 }),
    ])]
    renderPlanPage()
    // Only the working set has an RIR stepper.
    expect(screen.getAllByText('NO RIR')).toHaveLength(1)
    // One marker — on the warmup row only.
    expect(screen.getAllByText('WARMUP')).toHaveLength(1)

    openSetMenu(1) // the warmup, shown above the working set
    expect(screen.queryByRole('button', { name: /ADD STAGE/i })).toBeNull()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
  })

  it('warmups render above the first working set (ordered by set number)', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'work', setNumber: 2 }),
      makeSet({ id: 'warm', setNumber: 1, isWarmup: true }),
    ])]
    renderPlanPage()
    const rows = screen.getAllByLabelText(/^Options for set /)
    expect(rows).toHaveLength(2)
    // Row 1 carries the marker, row 2 does not.
    const marker = screen.getByText('WARMUP')
    expect(rows[0].compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(marker.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
