// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 19 (SPEC "Tags" — preset list plus custom text, several allowed,
// each removable, "Apply to all sets" fills one tag across an exercise's
// sets, heads only — not warmups, not stages). Same mocking recipe as
// PlanPage.stageKind.test.tsx.

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

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

describe('PlanPage — tags editor, heads only (chunk 19)', () => {
  it('tapping a preset chip writes it as this set\'s first tag', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'push here' }))

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: ['push here'] } })
  })

  it('tapping an already-active preset chip removes it (same "tap to clear" interaction as every other chip in this app)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['push here', 'push back'] })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'push here' }))

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: ['push back'] } })
  })

  it('removing the last tag collapses to null, not an empty array', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['push here'] })])]
    renderPlanPage()

    fireEvent.click(screen.getByRole('button', { name: 'push here' }))

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: null } })
  })

  it('custom text: typing and committing adds it, trimmed', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(screen.getByText('+ CUSTOM'))
    const input = screen.getByLabelText('Custom tag')
    fireEvent.change(input, { target: { value: '  heavy day  ' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: ['heavy day'] } })
  })

  it('blank custom text is refused — nothing written', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(screen.getByText('+ CUSTOM'))
    const input = screen.getByLabelText('Custom tag')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('a duplicate custom tag (exact match to one already on this set) is refused — no second copy', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['focus on execution'] })])]
    renderPlanPage()

    fireEvent.click(screen.getByText('+ CUSTOM'))
    const input = screen.getByLabelText('Custom tag')
    fireEvent.change(input, { target: { value: 'focus on execution' } })
    fireEvent.blur(input)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('a custom tag already on the set shows as its own removable chip, alongside the four presets', () => {
    mockState.plans = [makePlan([makeSet({ tags: ['triceps feel off today'] })])]
    renderPlanPage()

    expect(screen.getByRole('button', { name: 'triceps feel off today' })).toBeTruthy()
  })

  it('a stage row never shows a TAGS section at all — heads only', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()

    expect(screen.queryByText('TAGS')).toBeTruthy() // the head's own
    // Exactly one preset-chip row exists (the head's) — if the stage also
    // rendered one, there would be two "push here" buttons instead of one.
    expect(screen.getAllByRole('button', { name: 'push here' })).toHaveLength(1)
  })
})

describe('PlanPage — "Apply to all sets" (chunk 19)', () => {
  it('broadcasts one tag to every OTHER working head of the same exercise, heads only, never touching a warmup or a stage', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-1-drop', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head-1', stageIndex: 1 }),
      makeSet({ id: 'head-2', setNumber: 2 }),
      makeSet({ id: 'head-3-warmup', setNumber: 3, isWarmup: true }),
    ])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Apply "push here" to all sets'))

    // Only head-2 needed the write (head-1 already has it, head-1-drop is a
    // stage, head-3-warmup is a warmup) — exactly one mutate call.
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head-2', changes: { tags: ['push here'] } })
  })

  it('never removes another tag already on a set it reaches', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['maintain strength'] }),
    ])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Apply "push here" to all sets'))

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head-2', changes: { tags: ['maintain strength', 'push here'] } })
  })

  it('idempotent: tapping it again once every working head already has the tag writes nothing', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['push here'] }),
    ])]
    renderPlanPage()
    updateSetMutate.mockClear() // clear any mount-time noise before the tap we're testing

    // Both heads already carry the tag, so both show their own "apply to
    // all" control — either one exercises the same idempotent path.
    fireEvent.click(screen.getAllByLabelText('Apply "push here" to all sets')[0])

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('the "apply to all" control only exists on an ACTIVE tag — never on an inactive preset', () => {
    mockState.plans = [makePlan([makeSet({ tags: ['push here'] })])]
    renderPlanPage()

    expect(screen.getByLabelText('Apply "push here" to all sets')).toBeTruthy()
    expect(screen.queryByLabelText('Apply "push back" to all sets')).toBeNull()
  })
})
