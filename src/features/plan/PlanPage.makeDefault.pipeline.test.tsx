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
// The run's program and workouts: one workout unless a test says otherwise (it resets after each).
let currentProgram: Program = program
let currentWorkoutDays: WorkoutDay[] = [workoutDay]

const makeWeekDefaultMock = vi.fn()
const fetchRunCopyDefaultsMock = vi.fn()
const updateSetMock = vi.fn(async (..._args: unknown[]) => undefined)
const addPointedExerciseMock = vi.fn(async (..._args: unknown[]) => undefined)
const addWeekExerciseMock = vi.fn(async (..._args: unknown[]) => undefined)
const addPointedSetMock = vi.fn(async (..._args: unknown[]) => undefined)
const addPointedStageMock = vi.fn(async (..._args: unknown[]) => undefined)
const removeSetMock = vi.fn(async (..._args: unknown[]) => undefined)
const repointMock = vi.fn(async (..._args: unknown[]) => undefined)
const relinkMock = vi.fn(async (..._args: unknown[]) => undefined)
const removeWeekExerciseMock = vi.fn(async (..._args: unknown[]) => undefined)
const planWeekMock = vi.fn(async () => 0)

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [currentProgram], isLoading: false }),
  useWorkoutDays: () => ({ data: currentWorkoutDays, isLoading: false }),
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
  removeSet: (...args: unknown[]) => removeSetMock(...args),
  copyFromPreviousWeek: vi.fn(async () => undefined),
  copyWorkoutFromPreviousWeek: vi.fn(async () => undefined),
  planWeek: () => planWeekMock(),
  swapWeekExercise: vi.fn(),
  repointWeekExercise: (...args: unknown[]) => repointMock(...args),
  relinkWeekSets: (...args: unknown[]) => relinkMock(...args),
  addWeekExercise: (...args: unknown[]) => addWeekExerciseMock(...args),
  addPointedExercise: (...args: unknown[]) => addPointedExerciseMock(...args),
  addPointedSet: (...args: unknown[]) => addPointedSetMock(...args),
  addPointedStage: (...args: unknown[]) => addPointedStageMock(...args),
  removeWeekExercise: (...args: unknown[]) => removeWeekExerciseMock(...args),
  reorderWeekExercises: vi.fn(async () => undefined),
}))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  makeWeekDefaultMock.mockReset()
  fetchRunCopyDefaultsMock.mockReset()
  updateSetMock.mockClear()
  addPointedExerciseMock.mockClear()
  addWeekExerciseMock.mockClear()
  addPointedSetMock.mockClear()
  addPointedStageMock.mockClear()
  removeSetMock.mockClear()
  repointMock.mockClear()
  relinkMock.mockClear()
  removeWeekExerciseMock.mockClear()
  planWeekMock.mockClear()
  currentProgram = program
  currentWorkoutDays = [workoutDay]
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

// ─── What the source week showed: a swap, or a removal and an addition ────────────

// The review's finding. PlanPage adds an exercise at programExercises.length and removeWeekExercise does not
// renumber, so "remove the last exercise, add another" puts the new one at the removed one's position. A
// position-only reading took that for a swap and repointed a later week's removed row at the added exercise,
// keeping its sets and their weights. What tells the two apart is what the source week's rows named BEFORE
// the call (a swapped-in row's sets keep their link to the replaced row's program sets; an added row's sets
// have none), so it is read from the week as Plan holds it when the confirm is tapped.

const rowEx = (): ProgramExercise => ({ id: 'pe-row', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-row', position: 1, weightUnit: null })
const inclineEx = (): ProgramExercise => ({ id: 'pe-incline', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-incline', position: 1, weightUnit: null })
const curlEx = (): ProgramExercise => ({ id: 'pe-curl', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-curl', position: 1, weightUnit: null })

const benchSets = (n: number) => [planSet(n, 's1', 1, 'ps-1'), planSet(n, 's2', 2, 'ps-2')]
// A later week that holds the old default: Bench and Row, the row's two sets at 140 kg.
const rowSets = (n: number, row = 'pe-row') => [
  planSet(n, 'r1', 1, 'pr-1', { programExerciseId: row, targetWeight: 140 }),
  planSet(n, 'r2', 2, 'pr-2', { programExerciseId: row, targetWeight: 140 }),
]
const withRow = (n: number): WeekPlan => oldWeek(n, { exercises: [bench(), rowEx()], sets: [...benchSets(n), ...rowSets(n)] })
// A later week that took the swap already (a hand swap's apply-ahead repointed its row at the swapped-in row).
const tookSwap = (n: number): WeekPlan => oldWeek(n, { exercises: [bench(), inclineEx()], sets: [...benchSets(n), ...rowSets(n, 'pe-incline')] })

const benchDefault = (): DefaultExercise => ({ id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets: [dset('ps-1', 1), dset('ps-2', 2)] })
const rowDefault = (): DefaultExercise => ({ id: 'pe-row', exerciseId: 'ex-row', position: 1, sets: [dset('pr-1', 1), dset('pr-2', 2)] })
const answerWithRow: MakeDefaultResult = {
  mesocycleId: 'meso-1', weekNumber: 3, skipped: [],
  workouts: [{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-3', sourceSequencePosition: null, oldExercises: [benchDefault(), rowDefault()] }],
}

describe('PlanPage — make this week the default after the source week removed the last exercise and added another', () => {
  // Source week 3: Curl was added by hand where Row was (position 1): its set names no program set.
  const sourceWithAdd = (): WeekPlan => oldWeek(3, { exercises: [bench(), curlEx()], sets: [...benchSets(3), planSet(3, 'c1', 1, null, { programExerciseId: 'pe-curl', repMin: 10, repMax: 12 })] })
  const newDefault: DefaultExercise[] = [benchDefault(), { id: 'pe-curl', exerciseId: 'ex-curl', position: 1, sets: [dset('pq-1', 1, { repMin: 10, repMax: 12 })] }]

  beforeEach(() => {
    makeWeekDefaultMock.mockResolvedValue(answerWithRow)
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', newDefault]]))
  })

  // Break: pair a removed and an added row at the same place as a swap, with no evidence -> repointMock is called
  // with each later week's Row and removeWeekExercise / addPointedExercise are not.
  it('is a removal and an addition in the later weeks: the removed row goes, the added one comes in as the DEFAULT\'S row, nothing is repointed', async () => {
    allPlans = [sourceWithAdd(), withRow(4), withRow(5)]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 2 OF 2 PLANNED WEEKS/)

    expect(repointMock).not.toHaveBeenCalled() // no later week's Row (and its 140 kg) was handed to Curl
    expect(removeWeekExerciseMock.mock.calls).toEqual([['wp-4', 'pe-row'], ['wp-5', 'pe-row']])
    const added = addPointedExerciseMock.mock.calls.map((c) => c[0] as { weekPlanId: string; programExerciseId: string; position: number; sets: { programSetId: string }[] })
    expect(added.map((a) => [a.weekPlanId, a.programExerciseId, a.position, a.sets.map((s) => s.programSetId)])).toEqual([
      ['wp-4', 'pe-curl', 1, ['pq-1']],
      ['wp-5', 'pe-curl', 1, ['pq-1']],
    ])
  })
})

describe('PlanPage — make this week the default after the source week swapped an exercise', () => {
  // Source week 3: Row was swapped for Incline (a week-only row at its place) whose sets kept naming Row's program sets.
  const sourceWithSwap = (): WeekPlan => oldWeek(3, { exercises: [bench(), inclineEx()], sets: [...benchSets(3), planSet(3, 'i1', 1, 'pr-1', { programExerciseId: 'pe-incline' }), planSet(3, 'i2', 2, 'pr-2', { programExerciseId: 'pe-incline' })] })
  const inclineDefault = (sets: DefaultSet[] = [dset('pi-1', 1), dset('pi-2', 2)]): DefaultExercise => ({ id: 'pe-incline', exerciseId: 'ex-incline', position: 1, sets })

  beforeEach(() => {
    makeWeekDefaultMock.mockResolvedValue(answerWithRow)
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [benchDefault(), inclineDefault()]]]))
  })

  async function apply(count: number) {
    await makeDefaultAndOfferAhead()
    await screen.findByText(`APPLY THIS CHANGE TO ${count} PLANNED WEEKS AHEAD?`)
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(new RegExp(`APPLIED TO ${count} OF ${count} PLANNED WEEKS`))
  }

  it('a swap the source week showed repoints each later week\'s row, its sets re-linked to the new row\'s program sets (weights stay)', async () => {
    allPlans = [sourceWithSwap(), withRow(4), withRow(5)]
    await apply(2)
    expect(repointMock.mock.calls).toEqual([
      ['wp-4', 'pe-row', 'pe-incline', [{ weekSetId: 'r1-w4', programSetId: 'pi-1' }, { weekSetId: 'r2-w4', programSetId: 'pi-2' }]],
      ['wp-5', 'pe-row', 'pe-incline', [{ weekSetId: 'r1-w5', programSetId: 'pi-1' }, { weekSetId: 'r2-w5', programSetId: 'pi-2' }]],
    ])
    expect(removeWeekExerciseMock).not.toHaveBeenCalled()
    expect(addPointedExerciseMock).not.toHaveBeenCalled()
  })

  // R7. Break: skip a week that does not hold the replaced row (what it did) -> relinkMock is not called.
  it('a later week that took the swap already has its sets re-linked in place; one that did not is repointed', async () => {
    allPlans = [sourceWithSwap(), tookSwap(4), withRow(5)]
    await apply(2)
    expect(relinkMock.mock.calls).toEqual([[[{ weekSetId: 'r1-w4', programSetId: 'pi-1' }, { weekSetId: 'r2-w4', programSetId: 'pi-2' }]]])
    expect(repointMock.mock.calls.map((c) => c[0])).toEqual(['wp-5'])
  })

  // ...and the swapped slot's other parts reach it there: the default also changed the swapped-in exercise's
  // first set to 6–8, and the week that took the swap holds that set under the swapped-in row, not the replaced one.
  // Break: look for the swapped slot's sets only under the replaced row -> week 4 is not updated.
  it('the swapped slot\'s other parts reach a week that took the swap: its set under the swapped-in row is updated too', async () => {
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [benchDefault(), inclineDefault([dset('pi-1', 1, { repMin: 6, repMax: 8 }), dset('pi-2', 2)])]]]))
    allPlans = [sourceWithSwap(), tookSwap(4), withRow(5)]
    await apply(2)
    expect(updateSetMock.mock.calls).toEqual([
      ['r1-w4', { repMin: 6, repMax: 8, isAmrap: false }],
      ['r1-w5', { repMin: 6, repMax: 8, isAmrap: false }],
    ])
    expect(relinkMock).toHaveBeenCalledTimes(1)
    expect(repointMock.mock.calls.map((c) => c[0])).toEqual(['wp-5'])
  })

  it('without the source session in what Plan held (the function names another), a swap is told as a removal and an addition: never guessed', async () => {
    makeWeekDefaultMock.mockResolvedValue({ ...answerWithRow, workouts: [{ ...answerWithRow.workouts[0], sourceWeekPlanId: 'wp-elsewhere' }] })
    allPlans = [sourceWithSwap(), withRow(4)]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 1 PLANNED WEEK/)
    expect(repointMock).not.toHaveBeenCalled()
    expect(removeWeekExerciseMock.mock.calls).toEqual([['wp-4', 'pe-row']])
    expect(addPointedExerciseMock.mock.calls.map((c) => (c[0] as { programExerciseId: string }).programExerciseId)).toEqual(['pe-incline'])
  })

  // M12: a stage the source week added under the swapped-in exercise's head is added ahead under the week's head
  // for it. In a later week that head still names the replaced row's program set until the swap's re-link runs, so
  // the record has to name the OLD head; the new head's id finds nothing and the stage is silently not added.
  // Break: name the new head (pi-1) in the record -> addPointedStage is never called.
  it('M12 — a stage added under a swapped slot\'s head is added ahead under the later week\'s head', async () => {
    const rowDropset = (): DefaultExercise => ({ id: 'pe-row', exerciseId: 'ex-row', position: 1, sets: [dset('pr-1', 1, { stageKind: 'dropset' })] })
    makeWeekDefaultMock.mockResolvedValue({ ...answerWithRow, workouts: [{ ...answerWithRow.workouts[0], oldExercises: [benchDefault(), rowDropset()] }] })
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [benchDefault(), inclineDefault([dset('pi-1', 1, { stageKind: 'dropset' }), dset('pi-1s1', 1, { parentProgramSetId: 'pi-1', stageIndex: 1, repMin: 12, repMax: 12 })])]]]))
    allPlans = [
      oldWeek(3, {
        exercises: [bench(), inclineEx()],
        sets: [
          ...benchSets(3),
          planSet(3, 'i1', 1, 'pr-1', { programExerciseId: 'pe-incline', stageKind: 'dropset' }),
          planSet(3, 'i1s', 1, null, { programExerciseId: 'pe-incline', parentWeekPlanSetId: 'i1-w3', stageIndex: 1, isDropset: true, repMin: 12, repMax: 12 }),
        ],
      }),
      oldWeek(4, { exercises: [bench(), rowEx()], sets: [...benchSets(4), planSet(4, 'r1', 1, 'pr-1', { programExerciseId: 'pe-row', stageKind: 'dropset', targetWeight: 140 })] }),
    ]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 1 PLANNED WEEK/)

    expect(repointMock.mock.calls).toEqual([['wp-4', 'pe-row', 'pe-incline', [{ weekSetId: 'r1-w4', programSetId: 'pi-1' }]]])
    // (userId, week plan, the SWAPPED-IN row, the week's own head, the stage's index, the stage as the default has it)
    expect(addPointedStageMock).toHaveBeenCalledTimes(1)
    const [userId, weekPlanId, rowId, parentId, stageIndex, stage] = addPointedStageMock.mock.calls[0] as [string, string, string, string, number, { programSetId: string; programExerciseId: string }]
    expect([userId, weekPlanId, rowId, parentId, stageIndex]).toEqual(['user-1', 'wp-4', 'pe-incline', 'r1-w4', 1])
    expect([stage.programSetId, stage.programExerciseId]).toEqual(['pi-1s1', 'pe-incline'])
  })

  // R1: the source week also added a warmup on the swapped-in exercise. Paired by plain ordinal, a later week's
  // first 100 kg WORKING set stood for the new row's warmup: it became a warmup, and the last set was added bare.
  // Break: pair a swapped slot's sets by plain ordinal -> updateSet turns a working set into a warmup, and the
  // relink names the wrong program sets.
  it('R1 — a warmup the source week added on the swapped-in exercise is added ahead as a warmup; no working set turns into one', async () => {
    const warm = planSet(3, 'iw', 1, null, { programExerciseId: 'pe-incline', isWarmup: true, repMin: 12, repMax: 12 })
    allPlans = [
      oldWeek(3, { exercises: [bench(), inclineEx()], sets: [...benchSets(3), warm, planSet(3, 'i1', 2, 'pr-1', { programExerciseId: 'pe-incline' }), planSet(3, 'i2', 3, 'pr-2', { programExerciseId: 'pe-incline' })] }),
      withRow(4),
    ]
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [benchDefault(), inclineDefault([dset('pi-w', 1, { isWarmup: true, repMin: 12, repMax: 12 }), dset('pi-1', 2), dset('pi-2', 3)])]]]))
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 1 PLANNED WEEK/)

    expect(repointMock.mock.calls).toEqual([['wp-4', 'pe-row', 'pe-incline', [{ weekSetId: 'r1-w4', programSetId: 'pi-1' }, { weekSetId: 'r2-w4', programSetId: 'pi-2' }]]])
    expect(updateSetMock).not.toHaveBeenCalled() // no working set became a warmup, nothing was flipped
    expect(addPointedSetMock.mock.calls.map((c) => [c[1], (c[3] as { programSetId: string; isWarmup: boolean }).programSetId, (c[3] as { isWarmup: boolean }).isWarmup])).toEqual([['wp-4', 'pi-w', true]])
  })
})

// ─── A part the later week no longer matches: its own set, its own head kind ──────

describe('PlanPage — make this week the default, and a later week that differs where a part would go', () => {
  // R3: the default adds a third set to Bench. A week that already has a third set of its own (added there,
  // linked to nothing) differs from the old default where the new set would go; it keeps its own.
  // Break: add the set anyway -> week 5 gets a fourth set.
  it('R3 — a set the default adds is not added to a week that has a set of its own there', async () => {
    makeWeekDefaultMock.mockResolvedValue(functionAnswer)
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [{ id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets: [dset('ps-1', 1), dset('ps-2', 2), dset('ps-3', 3, { repMin: 6, repMax: 8 })] }]]]))
    allPlans = [oldWeek(3), oldWeek(4), oldWeek(5, { sets: [...benchSets(5), planSet(5, 'mine', 3, null)] })]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 2 PLANNED WEEKS/)
    expect(screen.getByText(/1 SKIPPED \(ALREADY DIFFERENT\)/)).toBeTruthy()
    expect(addPointedSetMock.mock.calls.map((c) => [c[1], (c[3] as { programSetId: string }).programSetId])).toEqual([['wp-4', 'ps-3']])
  })

  // R8: the old default's first set was a dropset head with a stage, and the default drops the stage. A week
  // that changed the head's kind itself (myo-reps) has stages of its own, which stay.
  // Break: drop the head-kind check -> the stage of week 5's myo-reps head is removed too.
  it('R8 — a stage the default drops is not removed from a head whose kind the week changed itself', async () => {
    const staged = (n: number, headKind: 'dropset' | 'myo_reps'): WeekPlan =>
      oldWeek(n, {
        sets: [
          planSet(n, 's1', 1, 'ps-1', { stageKind: headKind }),
          planSet(n, 's1s', 1, 'ps-1s1', { parentWeekPlanSetId: `s1-w${n}`, stageIndex: 1, isDropset: true, repMin: 12, repMax: 12 }),
          planSet(n, 's2', 2, 'ps-2'),
        ],
      })
    const oldStaged: DefaultExercise = { id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets: [dset('ps-1', 1, { stageKind: 'dropset' }), dset('ps-1s1', 1, { parentProgramSetId: 'ps-1', stageIndex: 1, repMin: 12, repMax: 12 }), dset('ps-2', 2)] }
    const newPlain: DefaultExercise = { id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets: [dset('ps-1', 1, { stageKind: 'dropset' }), dset('ps-2', 2)] }
    makeWeekDefaultMock.mockResolvedValue({ ...functionAnswer, workouts: [{ ...functionAnswer.workouts[0], oldExercises: [oldStaged] }] })
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [newPlain]]]))
    allPlans = [staged(3, 'dropset'), staged(4, 'dropset'), staged(5, 'myo_reps')]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 2 PLANNED WEEKS/)
    expect(removeSetMock.mock.calls.map((c) => c[0])).toEqual(['s1s-w4']) // week 4's stage; week 5's own stage stays
  })
})

// M31, through the screen: the outcome counts WEEKS. A make-default rewrites every workout of the week at
// once, so a later week holds one session per workout: two workouts over two later weeks is "2 of 2".
// Break: count the sessions (the bundle's summarizeApplyAhead) -> "APPLIED TO 4 OF 4".
describe('PlanPage — make this week the default on a week with two workouts', () => {
  const workoutDay2: WorkoutDay = { id: 'wd-2', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }
  const pullEx = (): ProgramExercise => ({ id: 'pe-pull', workoutDayId: 'wd-2', userId: 'user-1', exerciseId: 'ex-pull', position: 0, weightUnit: null })
  const pullWeek = (n: number): WeekPlan => ({
    id: `wp-pull-${n}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-2', weekNumber: n, isDeload: false, notes: null,
    exercises: [pullEx()], sets: [planSet(n, 'p1', 1, 'pp-1', { programExerciseId: 'pe-pull', weekPlanId: `wp-pull-${n}` })], createdAt: '2026-01-01T00:00:00Z',
  })
  const answer: MakeDefaultResult = {
    mesocycleId: 'meso-1', weekNumber: 3, skipped: [],
    workouts: [
      { workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-3', sourceSequencePosition: null, oldExercises },
      { workoutDayId: 'wd-2', sourceWeekPlanId: 'wp-pull-3', sourceSequencePosition: null, oldExercises: [{ id: 'pe-pull', exerciseId: 'ex-pull', position: 0, sets: [dset('pp-1', 1)] }] },
    ],
  }

  beforeEach(() => {
    currentProgram = { ...program, schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-2' } }
    currentWorkoutDays = [workoutDay, workoutDay2]
    makeWeekDefaultMock.mockResolvedValue(answer)
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([
      ['wd-1', newExercises],
      ['wd-2', [{ id: 'pe-pull', exerciseId: 'ex-pull', position: 0, sets: [dset('pp-1', 1, { repMin: 6, repMax: 8 })] }]],
    ]))
  })

  it('four later sessions in two later weeks: the offer says 2 planned weeks and the outcome says 2 of 2, every session written', async () => {
    allPlans = [oldWeek(3), pullWeek(3), oldWeek(4), pullWeek(4), oldWeek(5), pullWeek(5)]
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText('APPLIED TO 2 OF 2 PLANNED WEEKS')
    // Both workouts' later sessions were written: the bench set and the pull set, in each later week.
    expect(updateSetMock.mock.calls.map((c) => c[0]).sort()).toEqual(['p1-w4', 'p1-w5', 's2-w4', 's2-w5'])
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
