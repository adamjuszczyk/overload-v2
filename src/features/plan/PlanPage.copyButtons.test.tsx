// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { subWeeks, format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 8 (TASKS.md "Weeks plan themselves, from the right source") — the
// empty-state "Copy last week" (SPEC "Plan screen"/"Weeks and copying").
// PlanPage.renderParity.test.tsx's own fixture never exercises this path
// (its one week plan always has real exercises), so this file builds a
// second, minimal fixture specifically for a week-dependent run's EMPTY
// week beyond week 1 — the scenario v2_plan_week creates when
// week_start = 'empty', or when nothing non-deload has ever been planned.
//
// Renders the real PlanPage/WorkoutDayPanel component tree; only the data
// hooks are mocked (same seam as the render-parity test). Asserted by
// visible button text, not a byte-identical snapshot — these cases care
// about whether the button shows up at all, not its exact markup.

afterEach(() => cleanup())

// Week 2 of a meso that started 8 days ago — computeWeekNumber (date-fns
// differenceInCalendarWeeks, Monday-anchored) lands on week 2 for "today"
// without needing to click the week switcher, and isPast stays false
// (viewWeek === currentWeek).
const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0,
  weightUnit: null,
}

function makeProgram(planningType: Program['planningType']): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType,
  }
}

function makePlan(weekNumber: number, opts: { isDeload?: boolean; withContent?: boolean } = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber, isDeload: opts.isDeload ?? false, notes: null,
    sets: opts.withContent
      ? [{ id: `set-${weekNumber}`, weekPlanId: `wp-${weekNumber}`, userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false }]
      : [],
    exercises: opts.withContent ? [pe1] : [],
    createdAt: '2026-01-01T00:00:00Z',
  }
}

// mockState is read by the mocked hooks below — each test sets it before
// rendering, so one shared mock module can serve every scenario.
const mockState: { currentPlans: WeekPlan[]; allPlans: WeekPlan[]; program: Program } = {
  currentPlans: [],
  allPlans: [],
  program: makeProgram('week_dependent'),
}

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.currentPlans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.allPlans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  // Chunk 9 — Week actions, called unconditionally by WorkoutDayPanel on
  // every render; not exercised by this file's own copy-button assertions.
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

describe('PlanPage — empty-state "Copy last week" (chunk 8)', () => {
  it('shows COPY WEEK and COPY THIS WORKOUT when week 2 is empty and week 1 (non-deload) exists', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: false })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: false })]

    const { container } = renderPlanPage()
    expect(container.textContent).toContain('COPY WEEK')
    expect(container.textContent).toContain('COPY THIS WORKOUT')
  })

  it('DECISIONS 42 (b): shows neither button when the only prior week was empty (not deload) — empty is skipped the same as deload', () => {
    // historyFor (PlanPage.tsx) computes isEmpty from wp.sets.length === 0,
    // the same v2_week_plan_sets-backed data useAllWeekPlans already
    // fetches in full — week 1 here carries no sets, so this is the real
    // wiring, not just resolveManualCopySource's own pure-function proof.
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: false })]
    mockState.allPlans = [makePlan(1, { withContent: false }), makePlan(2, { withContent: false })]

    const { container } = renderPlanPage()
    expect(container.textContent).not.toContain('COPY WEEK')
    expect(container.textContent).not.toContain('COPY THIS WORKOUT')
  })

  it('shows neither button when nothing has ever been planned for this workout ("missing source")', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: false })]
    mockState.allPlans = [makePlan(2, { withContent: false })] // no week 1 at all

    const { container } = renderPlanPage()
    expect(container.textContent).not.toContain('COPY WEEK')
    expect(container.textContent).not.toContain('COPY THIS WORKOUT')
  })

  it('shows neither button when the only prior occurrence was deload (deload is never a copy source)', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: false })]
    mockState.allPlans = [makePlan(1, { withContent: true, isDeload: true }), makePlan(2, { withContent: false })]

    const { container } = renderPlanPage()
    expect(container.textContent).not.toContain('COPY WEEK')
    expect(container.textContent).not.toContain('COPY THIS WORKOUT')
  })

  it('shows neither button for a stable program, even though a non-deload week 1 exists', () => {
    mockState.program = makeProgram('stable')
    mockState.currentPlans = [makePlan(2, { withContent: false })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: false })]

    const { container } = renderPlanPage()
    expect(container.textContent).not.toContain('COPY WEEK')
    expect(container.textContent).not.toContain('COPY THIS WORKOUT')
  })

  it('shows neither button when the week already has content (nothing to copy into)', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: true })]

    const { container } = renderPlanPage()
    expect(container.textContent).not.toContain('COPY WEEK')
    expect(container.textContent).not.toContain('COPY THIS WORKOUT')
  })
})
