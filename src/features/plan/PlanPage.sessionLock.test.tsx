// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// A session that is completed or skipped can't be edited in Plan: its week
// rows are read-only, like a past week's. Plan reads which week plans have
// such a session (useDoneWeekPlanIds); this file renders the CURRENT week and
// flips that set. Same mocking recipe as PlanPage.uiRule.test.tsx.

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

const mockState: { plans: WeekPlan[]; done: Set<string> } = { plans: [], done: new Set() }
const updateSetMutate = vi.fn()
const addWarmupMutate = vi.fn()
const removeSetMutate = vi.fn()

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
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
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
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => mockState.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))

const { default: PlanPage } = await import('./PlanPage')
const { openSetMenu } = await import('./planMenus.testutil')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

function week() {
  return makePlan([
    makeSet({ id: 's1', setNumber: 1, targetRir: 2, targetWeight: 100, repMin: 8, repMax: 12 }),
    makeSet({ id: 's2', setNumber: 2, targetRir: 2, targetWeight: 100, repMin: 8, repMax: 12 }),
  ])
}

beforeEach(() => {
  mockState.plans = [week()]
  mockState.done = new Set()
  updateSetMutate.mockClear()
  removeSetMutate.mockClear()
  addWarmupMutate.mockClear()
})

describe('PlanPage — a completed or skipped session is read-only (current week)', () => {
  it('an open session’s week is editable (the baseline this file compares against)', () => {
    renderPlanPage()
    expect(screen.getAllByLabelText(/^Options for set /)).toHaveLength(2)
    fireEvent.click(screen.getAllByText('8–12')[0])
    expect(screen.getByLabelText('Rep target')).toBeTruthy()
    expect((screen.getByLabelText('Mark this session as deload') as HTMLButtonElement).disabled).toBe(false)
  })

  it('when the session on this week plan is completed or skipped, no set can be edited, deleted or tagged', () => {
    mockState.done = new Set(['wp-1'])
    renderPlanPage()

    expect(screen.queryAllByLabelText(/^Options for set /)).toHaveLength(0)
    fireEvent.click(screen.getAllByText('8–12')[0])
    expect(screen.queryByLabelText('Rep target')).toBeNull()
    expect(updateSetMutate).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Mark this session as deload') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why, once, only on the locked session', () => {
    renderPlanPage()
    expect(screen.queryByText(/SESSION DONE — READ ONLY/)).toBeNull()
    cleanup()
    mockState.done = new Set(['wp-1'])
    renderPlanPage()
    expect(screen.getAllByText(/SESSION DONE — READ ONLY/)).toHaveLength(1)
  })

  it('only the locked session’s rows lock: another week plan id in the done set changes nothing here', () => {
    mockState.done = new Set(['wp-other'])
    renderPlanPage()
    expect(screen.getAllByLabelText(/^Options for set /)).toHaveLength(2)
    openSetMenu(1)
    expect(screen.getByLabelText('Delete set')).toBeTruthy()
  })
})
