// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { subWeeks, format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 21, reviewer's note 5 — "Chunk 20 (apply ahead) skips later deload
// sessions. Make sure a session marked here is what it reads (the same
// is_deload)." PlanPage.deload.test.tsx mocks `./useWeekPlan` entirely, so
// applyAhead.ts's own pure core and useWeekPlan.ts's executor never
// actually run there — same gap PlanPage.applyAhead.pipeline.test.tsx
// (chunk 20) already closed for the swap-repoint bug. This file follows
// that exact precedent: mocks nothing but the Supabase-touching leaf
// (weekPlanService.ts) and useAuth, so the REAL useUpdateSet -> the REAL
// applyAhead.ts pure core -> the REAL useApplyAhead executor all run
// against a LATER week whose own is_deload is true (exactly the column
// chunk 21's marking writes, read back through the same WeekPlan shape
// every other caller uses) and proves it is skipped, not applied — no
// Supabase call is ever reached for that skipped week (every
// weekPlanService export is an inert local stub, so this never touches the
// network regardless of whether the skip logic holds).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd') // lands viewWeek on 2

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run', planningType: 'week_dependent',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const pe2: ProgramExercise = {
  id: 'pe-2-a', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null,
  carryProgramExerciseId: null,
  exercise: { id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
}
const set2: WeekPlanSet = {
  id: 'set-2', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-2-a', setNumber: 1,
  targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
}
const week2Plan: WeekPlan = {
  id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
  isDeload: false, notes: null, sets: [set2], exercises: [pe2], createdAt: '2026-01-01T00:00:00Z',
}
// Week 3 — marked deload exactly the way chunk 21's marking does: is_deload
// true on its own v2_week_plans row, read back as WeekPlan.isDeload through
// the SAME toPlan() mapping every other caller (fetchAllWeekPlansForMeso)
// uses. No exercises/sets of its own — resolveOneWeek's deload check runs
// BEFORE any slot match, so this is already enough to prove the skip (same
// fixture shape applyAhead.test.ts's own "still skips a deload week" case
// uses at the pure-function layer).
const week3Plan: WeekPlan = {
  id: 'wp-3', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
  isDeload: true, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
}

const fetchWeekPlansMock = vi.fn(async (_mesoId: string, weekNumber: number) => (weekNumber === 2 ? [week2Plan] : []))
const fetchAllWeekPlansForMesoMock = vi.fn(async () => [week2Plan, week3Plan])
const updateSetMock = vi.fn(async () => undefined)
const planWeekMock = vi.fn(async () => 0)

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))

// Every weekPlanService.ts export useWeekPlan.ts imports, inert — same
// convention as PlanPage.applyAhead.pipeline.test.tsx (chunk 20). This
// keeps the REAL useWeekPlan.ts (and therefore the REAL applyAhead.ts) in
// the render tree, with no Supabase call ever actually reachable.
vi.mock('./weekPlanService', () => ({
  fetchWeekPlans: (mesoId: string, weekNumber: number) => fetchWeekPlansMock(mesoId, weekNumber),
  fetchAllWeekPlansForMeso: () => fetchAllWeekPlansForMesoMock(),
  fetchWeekPlanById: vi.fn(async () => null),
  createWeekPlan: vi.fn(async () => ({ id: 'wp-new' })),
  setDeload: vi.fn(async () => undefined),
  setWeekDeload: vi.fn(async () => undefined),
  addSet: vi.fn(async () => undefined),
  addStage: vi.fn(async () => undefined),
  updateSet: (...args: unknown[]) => updateSetMock(...(args as [])),
  removeSet: vi.fn(async () => undefined),
  copyFromPreviousWeek: vi.fn(async () => undefined),
  copyWorkoutFromPreviousWeek: vi.fn(async () => undefined),
  planWeek: (...args: unknown[]) => planWeekMock(...(args as [])),
  swapWeekExercise: vi.fn(async () => ({ id: 'pe-new' })),
  repointWeekExercise: vi.fn(async () => undefined),
  addWeekExercise: vi.fn(async () => undefined),
  removeWeekExercise: vi.fn(async () => undefined),
  reorderWeekExercises: vi.fn(async () => undefined),
}))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  fetchWeekPlansMock.mockClear()
  fetchAllWeekPlansForMesoMock.mockClear()
  updateSetMock.mockClear()
  planWeekMock.mockClear()
})

function renderPlanPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PlanPage — apply-ahead skips a later week marked deload, through the REAL pure core and executor (chunk 21 x chunk 20)', () => {
  it('a weight-target edit on week 2 offers week 3, but APPLY skips it (deload) and never calls updateSet for it', async () => {
    renderPlanPage()

    // handleUpdateSet's own direct write (week 2's own set) — one call,
    // independent of apply-ahead.
    fireEvent.click(await screen.findByRole('button', { name: '—' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    await waitFor(() => expect(updateSetMock).toHaveBeenCalledTimes(1))

    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))

    await screen.findByText('APPLIED TO 0 OF 1 PLANNED WEEK — 1 SKIPPED (DELOAD)')
    // The direct edit's own call is still the only one — the executor never
    // reached runApplyAheadOp for week 3, so updateSet was never called a
    // second time for it.
    expect(updateSetMock).toHaveBeenCalledTimes(1)
  })
})
