// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { subWeeks, format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise, WeekPlanSet } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 20, review fix 2 (second review) — the coordinator's own repro
// (PlanPage.tsx:656, `resultingProgramExerciseId: replacement.id` swapped
// for a wrong literal) passed every test because nothing ran the swap
// ALL THE WAY THROUGH: PlanPage.applyAhead.test.tsx mocks `./useWeekPlan`
// entirely, so applyAhead.ts's own pure core and useWeekPlan.ts's executor
// never actually run there — only PlanPage.tsx's own ChangeRecord gets
// inspected. This file mocks nothing but the Supabase-touching leaves
// (weekPlanService.ts, useAuth, and the other screens' own data hooks),
// so the REAL useSwapWeekExercise -> the REAL applyAhead.ts pure core ->
// the REAL useApplyAhead executor all run, and asserts the one thing the
// coordinator named directly: repointWeekExercise is called with the
// LATER week's own matched row id and the edited week's real resulting id
// — never a hand-built literal standing in for either.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd') // lands viewWeek on 2, same trick PlanPage.applyAhead.test.tsx uses

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

const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const EX_X: Exercise = {
  id: 'ex-x', userId: 'user-1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

// Week 2 (the edited week) owns the slot's own canonical id (no carry of
// its own); week 3 (the later planned week) was copied forward from it, so
// its OWN row carries a DIFFERENT real id but the SAME carry marker —
// exactly how copyExercisesForward actually propagates identity (applyAhead
// .ts's own header comment), never a same-id shortcut.
const peWeek2: ProgramExercise = {
  id: 'pe-2-a', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null,
  carryProgramExerciseId: null, exercise: EX_A,
}
const peWeek3: ProgramExercise = {
  id: 'pe-3-a', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null,
  carryProgramExerciseId: 'pe-2-a', exercise: EX_A,
}
const set2: WeekPlanSet = {
  id: 'set-2', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-2-a', setNumber: 1,
  targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
}
const week2Plan: WeekPlan = {
  id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
  isDeload: false, notes: null, sets: [set2], exercises: [peWeek2], createdAt: '2026-01-01T00:00:00Z',
}
const week3Plan: WeekPlan = {
  id: 'wp-3', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
  isDeload: false, notes: null, sets: [], exercises: [peWeek3], createdAt: '2026-01-01T00:00:00Z',
}

// The swap's own resulting row — swapWeekExercise's real return shape is
// the new week-only ProgramExercise (weekPlanService.ts), never just an id.
const swapResultRow: ProgramExercise = {
  id: 'pe-2-x-new', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null,
}

const fetchWeekPlansMock = vi.fn(async (_mesoId: string, weekNumber: number) => (weekNumber === 2 ? [week2Plan] : []))
const fetchAllWeekPlansForMesoMock = vi.fn(async () => [week2Plan, week3Plan])
const swapWeekExerciseMock = vi.fn(async () => swapResultRow)
const repointWeekExerciseMock = vi.fn(async (_weekPlanId: string, _fromId: string, _toId: string) => undefined)
const planWeekMock = vi.fn(async () => 0)

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }), // fallback only — weekPlan.exercises wins once loaded
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [EX_X] }) }))

// Every weekPlanService.ts export useWeekPlan.ts imports, so none resolves
// to `undefined` (a factory mock replaces the WHOLE module) — only the
// five above are ever actually hit by this one scenario; the rest are
// inert stubs so an unrelated hook (useSetDeload, etc.) never throws
// merely by existing in the render tree.
vi.mock('./weekPlanService', () => ({
  fetchWeekPlans: (mesoId: string, weekNumber: number) => fetchWeekPlansMock(mesoId, weekNumber),
  fetchAllWeekPlansForMeso: () => fetchAllWeekPlansForMesoMock(),
  fetchWeekPlanById: vi.fn(async () => null),
  createWeekPlan: vi.fn(async () => ({ id: 'wp-new' })),
  setDeload: vi.fn(async () => undefined),
  addSet: vi.fn(async () => undefined),
  addStage: vi.fn(async () => undefined),
  updateSet: vi.fn(async () => undefined),
  removeSet: vi.fn(async () => undefined),
  copyFromPreviousWeek: vi.fn(async () => undefined),
  copyWorkoutFromPreviousWeek: vi.fn(async () => undefined),
  planWeek: (...args: unknown[]) => planWeekMock(...(args as [])),
  swapWeekExercise: () => swapWeekExerciseMock(),
  repointWeekExercise: (weekPlanId: string, fromId: string, toId: string) => repointWeekExerciseMock(weekPlanId, fromId, toId),
  addWeekExercise: vi.fn(async () => undefined),
  removeWeekExercise: vi.fn(async () => undefined),
  reorderWeekExercises: vi.fn(async () => undefined),
}))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  fetchWeekPlansMock.mockClear()
  fetchAllWeekPlansForMesoMock.mockClear()
  swapWeekExerciseMock.mockClear()
  repointWeekExerciseMock.mockClear()
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

describe('PlanPage — applying a swap ahead, through the REAL pure core and executor (review fix 2)', () => {
  it('repoints the later week\'s OWN matched row at the edited week\'s real resulting row — never a hand-built id on either side', async () => {
    renderPlanPage()

    await screen.findByLabelText('Swap Bench Press')
    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    await act(async () => {
      fireEvent.click(await screen.findByText('Incline Press'))
    })

    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))

    await waitFor(() => expect(repointWeekExerciseMock).toHaveBeenCalledTimes(1))
    // week 3's own plan id; week 3's own row for this slot (pe-3-a, found
    // by carry — NOT week 2's pe-2-a); the real row swapWeekExercise's own
    // mock resolved, for THIS run (pe-2-x-new) — never a literal standing
    // in for either id.
    expect(repointWeekExerciseMock).toHaveBeenCalledWith('wp-3', 'pe-3-a', swapResultRow.id)
  })
})
