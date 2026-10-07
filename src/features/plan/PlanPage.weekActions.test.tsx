// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 9 (TASKS.md "Edit a week's exercises" / SPEC.md "Weeks and
// copying", "Plan screen", "Supersets") — swap/reorder/add/remove in a
// week, the "only this week" toggle, and G14 (one workout on several
// weekdays shares one plan row). Renders the real PlanPage/WorkoutDayPanel/
// ExerciseSection tree; only the data hooks are mocked (same seam as
// PlanPage.copyButtons.test.tsx).
//
// Checked at 375px: window.innerWidth is set before every render. Every
// element this screen adds uses the same percentage/flex/fixed-under-40px
// tokens as the rest of PlanPage.tsx (no fixed width over 375), so what
// changes between scenarios below is DOM presence/attrs, not layout —
// jsdom has no real layout engine to measure against regardless.

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
const EX_B: Exercise = {
  id: 'ex-b', userId: 'user-1', name: 'Row', muscleGroup: 'back', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const EX_REPLACEMENT: Exercise = {
  id: 'ex-replacement', userId: 'user-1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0,
  weightUnit: null, exercise: EX_A,
}
const pe2: ProgramExercise = {
  id: 'pe-2', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-b', position: 1,
  weightUnit: null, exercise: EX_B,
}

function makeProgram(planningType: Program['planningType'], schedule: Program['schedule'] = { ...EMPTY_SCHEDULE, monday: 'wd-1' }): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType,
  }
}

function makePlan(weekNumber: number, exercises: ProgramExercise[]): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber, isDeload: false, notes: null, sets: [], exercises, createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { plans: WeekPlan[]; program: Program; allExercises: Exercise[]; meso: Mesocycle } = {
  plans: [],
  program: makeProgram('week_dependent'),
  allExercises: [EX_REPLACEMENT],
  meso: activeMeso,
}

const swapMutate = vi.fn()
const addMutate = vi.fn()
const removeMutate = vi.fn()
const reorderMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [mockState.meso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({
  useExercises: () => ({ data: mockState.allExercises }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutate: swapMutate, isPending: false }),
  useAddWeekExercise: () => ({ mutate: addMutate, isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: removeMutate, isPending: false }),
  useReorderWeekExercises: () => ({ mutate: reorderMutate, isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  swapMutate.mockReset()
  addMutate.mockReset()
  removeMutate.mockReset()
  reorderMutate.mockReset()
  mockState.meso = activeMeso
})

describe('PlanPage — week actions are visible on the current (non-past) week', () => {
  it('shows SWAP, reorder and remove per exercise, and ADD EXERCISE for the week', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]

    renderPlanPage()

    expect(screen.getAllByLabelText(/^Swap /).length).toBe(2)
    expect(screen.getAllByLabelText(/from this week$/).length).toBe(2)
    expect(screen.getByText('ADD EXERCISE')).toBeTruthy()
  })
})

describe('PlanPage — swap', () => {
  it('opens the picker and confirms with onlyThisWeek: false by default', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    expect(screen.getByText('SWAP Bench Press')).toBeTruthy()
    fireEvent.click(screen.getByText('Incline Press'))

    expect(swapMutate).toHaveBeenCalledWith({
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-1',
      replacementExerciseId: 'ex-replacement',
      onlyThisWeek: false,
    })
  })

  it('"ONLY THIS WEEK" ticked passes onlyThisWeek: true through to the swap', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    fireEvent.click(screen.getByText('ONLY THIS WEEK'))
    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    fireEvent.click(screen.getByText('Incline Press'))

    expect(swapMutate).toHaveBeenCalledWith(expect.objectContaining({ onlyThisWeek: true }))
  })

  it('the "only this week" toggle does not render for a stable program (DECISIONS 48 (a) — stable needs no tick)', () => {
    mockState.program = makeProgram('stable')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    expect(screen.queryByText('ONLY THIS WEEK')).toBeNull()
  })
})

describe('PlanPage — reorder', () => {
  it('moving the first exercise down swaps positions with the second, both directions carried in one call', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    fireEvent.click(screen.getAllByLabelText('Move down')[0])

    expect(reorderMutate).toHaveBeenCalledWith({
      weekPlanId: 'wp-1',
      moves: [
        { programExerciseId: 'pe-1', oldPosition: 0, newPosition: 1 },
        { programExerciseId: 'pe-2', oldPosition: 1, newPosition: 0 },
      ],
      onlyThisWeek: false,
    })
  })

  it('the first row\'s move-up and the last row\'s move-down are disabled', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    // No jest-dom in this suite — plain DOM property check (same
    // convention as ReassignSheet.test.tsx).
    const ups = screen.getAllByLabelText('Move up') as HTMLButtonElement[]
    const downs = screen.getAllByLabelText('Move down') as HTMLButtonElement[]
    expect(ups[0].disabled).toBe(true)
    expect(downs[downs.length - 1].disabled).toBe(true)
  })
})

describe('PlanPage — reorder moves a superset block as one unit (chunk 13, SPEC "Supersets")', () => {
  const pe1Blocked: ProgramExercise = { ...pe1, supersetBlockId: 'blk-1' }
  const pe2Blocked: ProgramExercise = { ...pe2, supersetBlockId: 'blk-1' }
  const pe3: ProgramExercise = {
    id: 'pe-3', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-c', position: 2,
    weightUnit: null, exercise: { ...EX_REPLACEMENT, id: 'ex-c', name: 'Dips' },
  }

  it('shows exactly one move-down pair for the whole 2-member block, not one per row', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1Blocked, pe2Blocked, pe3])]
    renderPlanPage()

    // 2 units total (the block, and pe3) → 2 move-down buttons, not 3.
    expect(screen.getAllByLabelText('Move down')).toHaveLength(2)
  })

  it('reads SUPERSET on both members of the block, not on the plain exercise', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1Blocked, pe2Blocked, pe3])]
    const { container } = renderPlanPage()
    const text = container.textContent ?? ''
    expect(text).toContain('SUPERSET')
  })

  it('moving the block down carries BOTH its members\' own positions in one call, past the single exercise', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1Blocked, pe2Blocked, pe3])]
    renderPlanPage()

    fireEvent.click(screen.getAllByLabelText('Move down')[0]) // the block's own (only) down button

    expect(reorderMutate).toHaveBeenCalledWith({
      weekPlanId: 'wp-1',
      moves: [
        { programExerciseId: 'pe-1', oldPosition: 0, newPosition: 1 },
        { programExerciseId: 'pe-2', oldPosition: 1, newPosition: 2 },
        { programExerciseId: 'pe-3', oldPosition: 2, newPosition: 0 },
      ],
      onlyThisWeek: false,
    })
  })
})

describe('PlanPage — add', () => {
  it('ADD EXERCISE opens the picker and confirms with the next position', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    fireEvent.click(screen.getByText('ADD EXERCISE'))
    fireEvent.click(screen.getByText('Incline Press'))

    expect(addMutate).toHaveBeenCalledWith({
      weekPlanId: 'wp-1',
      workoutDayId: 'wd-1',
      exerciseId: 'ex-replacement',
      position: 2,
    })
  })
})

describe('PlanPage — remove', () => {
  it('shows a confirmation naming the exercise and the week before removing', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Remove Bench Press from this week'))
    expect(screen.getByText('Remove "Bench Press" from week 1?')).toBeTruthy()
    expect(removeMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('REMOVE'))
    expect(removeMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-1', programExerciseId: 'pe-1' })
  })

  it('CANCEL dismisses without removing', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Remove Bench Press from this week'))
    fireEvent.click(screen.getByText('CANCEL'))

    expect(screen.queryByText(/Remove "Bench Press"/)).toBeNull()
    expect(removeMutate).not.toHaveBeenCalled()
  })
})

// G14 (CONTEXT.md, Adam's second account, 2026-10-05) — one workout on
// several weekdays shares one plan row; a week edit on it applies to every
// weekday it covers. Both Monday and Thursday map to the SAME workout_day_id
// here, so there is exactly one WorkoutDay/weekPlan row either way —
// WorkoutSwitcher's own dow selection never changes which plan row renders.
describe('PlanPage — G14: a workout on two weekdays shares one plan row', () => {
  it('swapping while Monday is selected mutates the one shared weekPlanId — the same row Thursday would show', () => {
    mockState.program = makeProgram('week_dependent', { ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-1' })
    mockState.plans = [makePlan(1, [pe1, pe2])]
    renderPlanPage()

    // Both weekday tabs are offered, both resolve to the one shared workout.
    expect(screen.getByText('MON')).toBeTruthy()
    expect(screen.getByText('THU')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    fireEvent.click(screen.getByText('Incline Press'))

    // Only one plan row exists for wd-1/week 1 in this fixture (mockState.plans
    // has a single entry) — the mutation targets that one shared id,
    // regardless of which weekday tab is currently selected.
    expect(swapMutate).toHaveBeenCalledWith(expect.objectContaining({ weekPlanId: 'wp-1' }))

    // Switching to Thursday renders the SAME exercises (pe-1/pe-2) — not a
    // second, independent list — because it reads the identical weekPlan row.
    fireEvent.click(screen.getByText('THU'))
    expect(screen.getAllByText('Bench Press').length).toBeGreaterThan(0)
  })
})

describe('PlanPage — a past week is read-only for week actions too', () => {
  it('hides swap/reorder/remove/add once the viewed week is stepped into the past', () => {
    // A meso started 3 calendar weeks ago (Monday-anchored, same
    // differenceInCalendarWeeks computeWeekNumber uses) puts the CURRENT
    // week at 4; viewWeek mounts there (not past), then PREVIOUS WEEK steps
    // it below currentWeek — isPast = viewWeek < currentWeek, the exact
    // flag WorkoutDayPanel/ExerciseSection gate every other per-row control
    // on too (RIR stepper, add set, remove set), so this proves week
    // actions share that same wiring rather than needing their own.
    mockState.meso = { ...activeMeso, startDate: format(new Date(Date.now() - 21 * 86400000), 'yyyy-MM-dd') }
    mockState.program = makeProgram('week_dependent')
    mockState.plans = [makePlan(1, [pe1, pe2]), makePlan(4, [pe1, pe2])]
    renderPlanPage()

    expect(screen.getByText('WEEK 4')).toBeTruthy() // sanity: mounted on the current week
    expect(screen.getByLabelText('Swap Bench Press')).toBeTruthy() // visible on the (non-past) current week

    fireEvent.click(screen.getByLabelText('Previous week')) // week 3
    fireEvent.click(screen.getByLabelText('Previous week')) // week 2
    fireEvent.click(screen.getByLabelText('Previous week')) // week 1 — now past (1 < 4)

    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()
    expect(screen.queryByLabelText(/^Swap /)).toBeNull()
    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    expect(screen.queryByLabelText('Move down')).toBeNull()
    expect(screen.queryByText(/from this week$/)).toBeNull()
  })
})
