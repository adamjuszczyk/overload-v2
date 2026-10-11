// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { MakeDefaultResult, DefaultExercise, DefaultSet } from './makeWeekDefault'
import { useToastStore } from '../notifications/toastStore'

// Chunk 32 — "Make this week the new default" and "Apply this change to planned weeks
// ahead" ALL THE WAY THROUGH: nothing is mocked but the Supabase-touching leaves
// (makeDefaultService.ts, weekPlanService.ts, useAuth and the other screens' data hooks), so
// the REAL useMakeWeekDefault, the REAL old-default → new-default records
// (makeWeekDefault.ts), the REAL applyAhead.ts planning and the REAL useApplyAhead executor
// run, and the assertions are the calls that would reach the database. This is what
// PlanPage.makeDefault.test.tsx (which mocks the hooks) cannot see: that the rows written
// into a later week are the DEFAULT'S (its row, its program sets), that a part which
// diverged is left alone, and that a deload week is not touched.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  useToastStore.getState().clear()
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
  startDate: format(subWeeks(new Date(), 2), 'yyyy-MM-dd'), // the current week is 3
  endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'stable',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

const bench = (position = 0): ProgramExercise => ({ id: 'pe-bench', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position, weightUnit: null, exercise: EX_A })
const joined = (): ProgramExercise => ({ id: 'pe-joined', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-joined', position: 1, weightUnit: null })

function planSet(weekNumber: number, id: string, setNumber: number, programSetId: string | null, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id: `${id}-w${weekNumber}`, weekPlanId: `wp-${weekNumber}`, userId: 'user-1', programExerciseId: 'pe-bench', setNumber, targetRir: null,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId, repMin: 8, repMax: 10, ...overrides,
  }
}

// A planned week that holds the OLD default: Bench Press, two sets at 8–10 naming the default's program sets.
function oldWeek(weekNumber: number, overrides: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null,
    exercises: [bench()], sets: [planSet(weekNumber, 's1', 1, 'ps-1'), planSet(weekNumber, 's2', 2, 'ps-2')],
    createdAt: '2026-01-01T00:00:00Z', ...overrides,
  }
}

const dset = (id: string, position: number, overrides: Partial<DefaultSet> = {}): DefaultSet => ({
  id, position, isWarmup: false, parentProgramSetId: null, stageIndex: 0, stageKind: null, repMin: 8, repMax: 10, isAmrap: false, ...overrides,
})
const oldExercises: DefaultExercise[] = [{ id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets: [dset('ps-1', 1), dset('ps-2', 2)] }]
// After the call: set 2 is 6–8 now, and an exercise joined with a set of its own.
const newExercises: DefaultExercise[] = [
  { id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets: [dset('ps-1', 1), dset('ps-2', 2, { repMin: 6, repMax: 8 })] },
  { id: 'pe-joined', exerciseId: 'ex-joined', position: 1, sets: [dset('ps-new', 1, { repMin: 12, repMax: 15 })] },
]
const functionAnswer: MakeDefaultResult = {
  mesocycleId: 'meso-1', weekNumber: 3, skipped: [],
  workouts: [{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-3', sourceSequencePosition: null, oldExercises }],
}

let allPlans: WeekPlan[] = []

const makeWeekDefaultMock = vi.fn()
const fetchRunCopyDefaultsMock = vi.fn()
const updateSetMock = vi.fn(async (..._args: unknown[]) => undefined)
const addPointedExerciseMock = vi.fn(async (..._args: unknown[]) => undefined)
const addWeekExerciseMock = vi.fn(async (..._args: unknown[]) => undefined)
const planWeekMock = vi.fn(async () => 0)

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./makeDefaultService', () => ({
  makeWeekDefault: (...args: unknown[]) => makeWeekDefaultMock(...args),
  fetchRunCopyDefaults: (...args: unknown[]) => fetchRunCopyDefaultsMock(...args),
}))
// Every weekPlanService.ts export useWeekPlan.ts imports (a factory mock replaces the whole module).
vi.mock('./weekPlanService', () => ({
  fetchWeekPlans: async (_mesoId: string, weekNumber: number) => allPlans.filter((p) => p.weekNumber === weekNumber),
  fetchAllWeekPlansForMeso: async () => allPlans,
  fetchWeekPlanById: vi.fn(async () => null),
  createWeekPlan: vi.fn(async () => ({ id: 'wp-new' })),
  markSessionDeload: vi.fn(),
  unmarkSessionDeload: vi.fn(),
  markWeekDeload: vi.fn(),
  unmarkWeekDeload: vi.fn(),
  addSet: vi.fn(async () => undefined),
  addWarmupSet: vi.fn(async () => undefined),
  addStage: vi.fn(async () => undefined),
  updateSet: (...args: unknown[]) => updateSetMock(...args),
  removeSet: vi.fn(async () => undefined),
  copyFromPreviousWeek: vi.fn(async () => undefined),
  copyWorkoutFromPreviousWeek: vi.fn(async () => undefined),
  planWeek: () => planWeekMock(),
  swapWeekExercise: vi.fn(),
  repointWeekExercise: vi.fn(async () => undefined),
  addWeekExercise: (...args: unknown[]) => addWeekExerciseMock(...args),
  addPointedExercise: (...args: unknown[]) => addPointedExerciseMock(...args),
  addPointedSet: vi.fn(async () => undefined),
  addPointedStage: vi.fn(async () => undefined),
  removeWeekExercise: vi.fn(async () => undefined),
  reorderWeekExercises: vi.fn(async () => undefined),
}))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  makeWeekDefaultMock.mockReset()
  fetchRunCopyDefaultsMock.mockReset()
  updateSetMock.mockClear()
  addPointedExerciseMock.mockClear()
  addWeekExerciseMock.mockClear()
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

async function makeDefaultAndOfferAhead() {
  renderPlanPage()
  fireEvent.click(await screen.findByText('MAKE THIS WEEK THE NEW DEFAULT'))
  fireEvent.click(screen.getByText('MAKE DEFAULT'))
}

describe('PlanPage — make this week the default, then apply it ahead (real hooks, real planning)', () => {
  beforeEach(() => {
    makeWeekDefaultMock.mockResolvedValue(functionAnswer)
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', newExercises]]))
  })

  it('confirm calls the function with the run and the week, and nothing is written to any week by it', async () => {
    allPlans = [oldWeek(3)]
    await makeDefaultAndOfferAhead()
    await waitFor(() => expect(makeWeekDefaultMock).toHaveBeenCalledTimes(1))
    expect(makeWeekDefaultMock).toHaveBeenCalledWith('meso-1', 3)
    // The new default is read from the run's copy for exactly the workouts it rewrote.
    await waitFor(() => expect(fetchRunCopyDefaultsMock).toHaveBeenCalledWith(['wd-1']))
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(addPointedExerciseMock).not.toHaveBeenCalled()
  })

  // Break: have applyAhead.ts write the joined exercise through `addExercise` (-> addWeekExercise, a fresh
  // week-only row per week) -> addWeekExercise is called and addPointedExercise is not.
  it('a later week that still holds the old default gets the change: the rep target, and the joined exercise as the DEFAULT\'S OWN row with its program sets', async () => {
    allPlans = [oldWeek(3), oldWeek(4), oldWeek(5)]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 2 OF 2 PLANNED WEEKS/)

    // The rep target of the set that stayed (set 2): written on each later week's set linked to it, not on set 1.
    expect(updateSetMock).toHaveBeenCalledTimes(2)
    expect(updateSetMock).toHaveBeenCalledWith('s2-w4', { repMin: 6, repMax: 8, isAmrap: false })
    expect(updateSetMock).toHaveBeenCalledWith('s2-w5', { repMin: 6, repMax: 8, isAmrap: false })

    // The joined exercise: the default's own row id in EVERY later week, never a fresh week-only row.
    expect(addWeekExerciseMock).not.toHaveBeenCalled()
    expect(addPointedExerciseMock).toHaveBeenCalledTimes(2)
    const calls = addPointedExerciseMock.mock.calls.map((c) => c[0] as { userId: string; weekPlanId: string; programExerciseId: string; position: number; sets: { programSetId: string; programExerciseId: string }[] })
    expect(calls.map((c) => c.weekPlanId)).toEqual(['wp-4', 'wp-5'])
    for (const call of calls) {
      expect(call.programExerciseId).toBe('pe-joined')
      expect(call.userId).toBe('user-1')
      expect(call.position).toBe(1)
      expect(call.sets.map((s) => [s.programSetId, s.programExerciseId])).toEqual([['ps-new', 'pe-joined']])
    }
  })

  // Break: write the new rep target regardless of what the week holds -> s2-w5 is written too.
  it('a later week whose set diverged keeps its own value — and still takes the parts it does hold', async () => {
    allPlans = [oldWeek(3), oldWeek(4), oldWeek(5, { sets: [planSet(5, 's1', 1, 'ps-1'), planSet(5, 's2', 2, 'ps-2', { repMin: 12, repMax: 12 })] })]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 2 OF 2 PLANNED WEEKS/)

    expect(updateSetMock.mock.calls.map((c) => c[0])).toEqual(['s2-w4']) // week 5's own 12 is left as it is
    expect(addPointedExerciseMock.mock.calls.map((c) => (c[0] as { weekPlanId: string }).weekPlanId)).toEqual(['wp-4', 'wp-5'])
  })

  it('a week that holds none of the parts is skipped as already different; a deload week is skipped as deload; neither is written', async () => {
    allPlans = [
      oldWeek(3),
      oldWeek(4),
      // Week 5 differs everywhere: its set 2 has its own rep target, and it already has the joined exercise's exercise, by hand.
      oldWeek(5, {
        exercises: [bench(), { ...joined(), id: 'pe-by-hand' }],
        sets: [planSet(5, 's1', 1, 'ps-1'), planSet(5, 's2', 2, 'ps-2', { repMin: 12, repMax: 12 })],
      }),
      oldWeek(6, { isDeload: true }),
    ]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 3 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 3 PLANNED WEEKS/)
    expect(screen.getByText(/1 SKIPPED \(DELOAD\)/)).toBeTruthy()
    expect(screen.getByText(/1 SKIPPED \(ALREADY DIFFERENT\)/)).toBeTruthy()

    expect(updateSetMock.mock.calls.map((c) => c[0])).toEqual(['s2-w4'])
    expect(addPointedExerciseMock.mock.calls.map((c) => (c[0] as { weekPlanId: string }).weekPlanId)).toEqual(['wp-4'])
  })

  it('no offer when no later week is planned: nothing to apply, nothing written', async () => {
    allPlans = [oldWeek(2), oldWeek(3)]
    await makeDefaultAndOfferAhead()
    await waitFor(() => expect(fetchRunCopyDefaultsMock).toHaveBeenCalled())
    await waitFor(() => expect(useToastStore.getState().message).toBe('Week 3 is now the default.'))
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(addPointedExerciseMock).not.toHaveBeenCalled()
  })

  it('dismissing the offer writes nothing', async () => {
    allPlans = [oldWeek(3), oldWeek(4)]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(addPointedExerciseMock).not.toHaveBeenCalled()
  })
})

describe('PlanPage — make this week the default, when the call fails', () => {
  it('an error toast, no offer, nothing read and nothing written', async () => {
    allPlans = [oldWeek(3), oldWeek(4)]
    makeWeekDefaultMock.mockRejectedValue(new Error('v2_make_week_default: every session of week 3 of mesocycle meso-1 is deload or empty; there is nothing to make the default'))
    await makeDefaultAndOfferAhead()
    await waitFor(() => expect(useToastStore.getState().message).toBe('v2_make_week_default: every session of week 3 of mesocycle meso-1 is deload or empty; there is nothing to make the default'))
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(fetchRunCopyDefaultsMock).not.toHaveBeenCalled()
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(addPointedExerciseMock).not.toHaveBeenCalled()
    expect(addWeekExerciseMock).not.toHaveBeenCalled()
  })

  it('offline it fails (the call rejects) instead of hanging on the confirm', async () => {
    allPlans = [oldWeek(3)]
    makeWeekDefaultMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await makeDefaultAndOfferAhead()
    await waitFor(() => expect(useToastStore.getState().message).toBe('Failed to fetch'))
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.getByText('MAKE THIS WEEK THE NEW DEFAULT')).toBeTruthy()
  })
})
