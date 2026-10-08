// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { subWeeks, format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise, WeekPlanSet } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { ChangeRecord } from './applyAhead'

// Chunk 20 ("Apply this change to planned weeks ahead") — the offer banner
// on the Plan screen's week view. Renders the real PlanPage/WorkoutDayPanel/
// ExerciseSection tree; only the data hooks are mocked (same seam as
// PlanPage.weekActions.test.tsx/PlanPage.copyButtons.test.tsx). Checked at
// 375px (this file's own beforeEach, same convention as every other
// PlanPage test file).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// Week 2 of a meso that started 8 days ago, so viewWeek mounts on week 2
// without a week-switcher click (differenceInCalendarWeeks, Monday-anchored
// — same convention PlanPage.copyButtons.test.tsx already uses).
const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')

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
const EX_REPLACEMENT: Exercise = {
  id: 'ex-replacement', userId: 'user-1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null, exercise: EX_A,
}

function set1(overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id: 'set-1', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
    ...overrides,
  }
}

function makeProgram(planningType: Program['planningType'] = 'week_dependent', schedule: Program['schedule'] = { ...EMPTY_SCHEDULE, monday: 'wd-1' }): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType,
  }
}

function makePlan(weekNumber: number, sets: WeekPlanSet[] = [set1()], exercises: ProgramExercise[] = [pe1]): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber, isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { currentPlans: WeekPlan[]; allPlans: WeekPlan[]; program: Program } = {
  currentPlans: [],
  allPlans: [],
  program: makeProgram('week_dependent'),
}

const updateSetMutate = vi.fn()
const swapMutate = vi.fn().mockResolvedValue({ id: 'ex-replacement-row' })
let applyAheadLastCall: { changes: ChangeRecord[]; weeks: WeekPlan[] } | null = null
let applyAheadOnSuccess: ((data: unknown) => void) | undefined
const applyAheadMutate = vi.fn((vars: { changes: ChangeRecord[]; weeks: WeekPlan[] }, opts?: { onSuccess?: (d: unknown) => void }) => {
  applyAheadLastCall = vars
  applyAheadOnSuccess = opts?.onSuccess
})

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({
  useExercises: () => ({ data: [EX_REPLACEMENT] }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.currentPlans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.allPlans, isLoading: false }),
  useApplyAhead: () => ({ mutate: applyAheadMutate, isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: swapMutate, isPending: false }),
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

afterEach(() => {
  updateSetMutate.mockClear()
  swapMutate.mockClear()
  applyAheadMutate.mockClear()
  applyAheadLastCall = null
  applyAheadOnSuccess = undefined
  mockState.program = makeProgram('week_dependent')
})

function editWeightTarget() {
  fireEvent.click(screen.getByRole('button', { name: '—' }))
  fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
  fireEvent.blur(screen.getByLabelText('Weight target'))
}

describe('PlanPage — apply-ahead offer appears exactly when later planned weeks exist', () => {
  it('does not appear when there is no later planned week for this workout', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2)] // only week 2 itself — nothing later
    renderPlanPage()

    editWeightTarget()

    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
  })

  it('appears, naming the count, when a later week is already planned (even if empty)', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])] // week 3 exists, empty — still "planned"
    renderPlanPage()

    editWeightTarget()

    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
  })

  it('counts every later planned week (not just the very next one)', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], []), makePlan(4, [], [])]
    renderPlanPage()

    editWeightTarget()

    expect(screen.getByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')).toBeTruthy()
  })

  it('is absent before any edit has been made', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
  })
})

describe('PlanPage — apply-ahead is never offered after an "only this week" swap', () => {
  // handlePickReplacement is async (review fix — it awaits the swap's own
  // mutateAsync to get the resulting row id before building the change
  // record), so the offer/dismiss only lands after that promise resolves —
  // flushed here with act() before asserting.
  it('suppresses the offer even though later planned weeks exist', async () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    fireEvent.click(screen.getByText('ONLY THIS WEEK'))
    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    await act(async () => {
      fireEvent.click(screen.getByText('Incline Press'))
    })

    expect(swapMutate).toHaveBeenCalledWith(expect.objectContaining({ onlyThisWeek: true }))
    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
  })

  it('a plain (not "only this week") swap DOES offer it', async () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    await act(async () => {
      fireEvent.click(screen.getByText('Incline Press'))
    })

    expect(swapMutate).toHaveBeenCalledWith(expect.objectContaining({ onlyThisWeek: false }))
    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
  })
})

describe('PlanPage — applying the offer reports the "N of M" count', () => {
  it('tapping APPLY calls useApplyAhead with the change and candidate weeks, then shows the result', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], []), makePlan(4, [], [])]
    renderPlanPage()

    editWeightTarget()
    expect(screen.getByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')).toBeTruthy()

    fireEvent.click(screen.getByText('APPLY'))

    expect(applyAheadMutate).toHaveBeenCalledTimes(1)
    expect(applyAheadLastCall?.weeks.map((w) => w.weekNumber)).toEqual([3, 4])
    expect(applyAheadLastCall?.changes[0]).toMatchObject({ editType: 'weightTarget', slotId: 'pe-1' })

    // Simulate the mutation settling: applied to 1 of 2 (one skipped). Wrapped
    // in act() — calling the captured callback directly bypasses fireEvent's
    // own act() wrapping, so React's state update needs flushing explicitly.
    act(() => {
      applyAheadOnSuccess?.({ summary: { total: 2, applied: 1, skippedDeload: 0, skippedStructural: 1 }, writtenWeekNumbers: [3] })
    })

    expect(screen.getByText(/APPLIED TO 1 OF 2 PLANNED WEEKS/)).toBeTruthy()
    expect(screen.getByText(/1 SKIPPED \(ALREADY DIFFERENT\)/)).toBeTruthy()
    // The offer itself is gone once a result is showing.
    expect(screen.queryByText(/AHEAD\?/)).toBeNull()
  })

  it('dismissing the offer clears it without calling useApplyAhead', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    editWeightTarget()
    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Dismiss'))

    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
    expect(applyAheadMutate).not.toHaveBeenCalled()
  })
})

describe('PlanPage — apply-ahead says so when the workout is shared (G14)', () => {
  it('names the shared-weekday wording when this workout covers more than one weekday', () => {
    mockState.program = makeProgram('week_dependent', { ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-1' })
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    editWeightTarget()

    expect(screen.getByText(/scheduled on more than one weekday/)).toBeTruthy()
  })

  it('says nothing extra for an un-shared workout', () => {
    mockState.program = makeProgram('week_dependent', { ...EMPTY_SCHEDULE, monday: 'wd-1' })
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    editWeightTarget()

    expect(screen.queryByText(/scheduled on more than one weekday/)).toBeNull()
  })
})

// Review fix item 3 — SPEC names no exception for these; one jsdom offer
// test per newly-wired edit type.
describe('PlanPage — apply-ahead offer for the newly-wired edit types (review fix item 3)', () => {
  it('week-level ADD SET offers it', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    // The per-exercise "+" (ADD SET) is icon-only (no text, no aria-label)
    // — found here by its lucide-plus icon with no surrounding text, which
    // distinguishes it from "ADD EXERCISE" (same icon, but with a label).
    const addSetButton = screen.getAllByRole('button').find((b) => !!b.querySelector('svg.lucide-plus') && b.textContent?.trim() === '')
    expect(addSetButton).toBeTruthy()
    fireEvent.click(addSetButton!)

    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
  })

  it('week-level REMOVE SET (a head, via compact mode\'s MINUS) offers it', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    fireEvent.click(screen.getByText('COMPACT'))
    fireEvent.click(screen.getByLabelText('Remove last set'))

    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
  })

  it('the WARMUP toggle offers it', () => {
    mockState.currentPlans = [makePlan(2)]
    mockState.allPlans = [makePlan(2), makePlan(3, [], [])]
    renderPlanPage()

    fireEvent.click(screen.getByText('WARMUP'))

    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { isWarmup: true } })
  })
})
