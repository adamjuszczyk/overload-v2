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
const fetchSourceSetLinksMock = vi.fn()
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
  fetchSourceSetLinks: (...args: unknown[]) => fetchSourceSetLinksMock(...args),
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

beforeEach(() => {
  // What the source sessions' planned sets name after the call. Nothing, unless a test says: only a swapped slot
  // reads it, and a slot it does not reach is paired by ordinal within kind (the fallback).
  fetchSourceSetLinksMock.mockResolvedValue(new Map())
})

afterEach(() => {
  makeWeekDefaultMock.mockReset()
  fetchRunCopyDefaultsMock.mockReset()
  fetchSourceSetLinksMock.mockReset()
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
    // The call pointed each of the source week's planned sets at the program set it ended up on: Row's pr-1 and pr-2
    // are Incline's pi-1 and pi-2 now. That, with what Plan held before the call, is the exact pairing.
    fetchSourceSetLinksMock.mockResolvedValue(new Map([['wp-3', new Map([['i1-w3', 'pi-1'], ['i2-w3', 'pi-2']])]]))
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
    fetchSourceSetLinksMock.mockResolvedValue(new Map([['wp-3', new Map([['i1-w3', 'pi-1'], ['i1s-w3', 'pi-1s1']])]]))
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
    fetchSourceSetLinksMock.mockResolvedValue(new Map([['wp-3', new Map([['iw-w3', 'pi-w'], ['i1-w3', 'pi-1'], ['i2-w3', 'pi-2']])]]))
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

// ─── C: a swapped slot's sets are paired by what the source week did with each of them ───

// The review's case. Row's old default sets: pr-1 (8), pr-2 (10), pr-3 (12). The source week swapped Row for Incline and
// deleted the first set, so Incline's two planned sets named pr-2 and pr-3 before the call and name pi-1 (10) and pi-2
// (12) after it. The later week holds Row's three sets, each with a weight.
describe('PlanPage — make this week the default after the source week swapped an exercise AND deleted its first set (C)', () => {
  const rowThree = (): DefaultExercise => ({ id: 'pe-row', exerciseId: 'ex-row', position: 1, sets: [dset('pr-1', 1, { repMin: 8, repMax: 8 }), dset('pr-2', 2, { repMin: 10, repMax: 10 }), dset('pr-3', 3, { repMin: 12, repMax: 12 })] })
  const inclineTwo = (): DefaultExercise => ({ id: 'pe-incline', exerciseId: 'ex-incline', position: 1, sets: [dset('pi-1', 1, { repMin: 10, repMax: 10 }), dset('pi-2', 2, { repMin: 12, repMax: 12 })] })
  const source = (): WeekPlan =>
    oldWeek(3, {
      exercises: [bench(), inclineEx()],
      sets: [
        ...benchSets(3),
        planSet(3, 'i2', 1, 'pr-2', { programExerciseId: 'pe-incline', repMin: 10, repMax: 10 }),
        planSet(3, 'i3', 2, 'pr-3', { programExerciseId: 'pe-incline', repMin: 12, repMax: 12 }),
      ],
    })
  const rowWeek = (n: number): WeekPlan =>
    oldWeek(n, {
      exercises: [bench(), rowEx()],
      sets: [
        ...benchSets(n),
        planSet(n, 'L1', 1, 'pr-1', { programExerciseId: 'pe-row', repMin: 8, repMax: 8, targetWeight: 80 }),
        planSet(n, 'L2', 2, 'pr-2', { programExerciseId: 'pe-row', repMin: 10, repMax: 10, targetWeight: 70 }),
        planSet(n, 'L3', 3, 'pr-3', { programExerciseId: 'pe-row', repMin: 12, repMax: 12, targetWeight: 60 }),
      ],
    })

  beforeEach(() => {
    makeWeekDefaultMock.mockResolvedValue({ ...answerWithRow, workouts: [{ ...answerWithRow.workouts[0], oldExercises: [benchDefault(), rowThree()] }] })
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', [benchDefault(), inclineTwo()]]]))
    allPlans = [source(), rowWeek(4)]
  })

  async function apply() {
    await makeDefaultAndOfferAhead()
    await screen.findByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(/APPLIED TO 1 OF 1 PLANNED WEEK/)
  }

  // Break: pair the slot's sets by ordinal even where the source week's links are known -> L1 is relinked to pi-1 and
  // rewritten to 10, L2 to pi-2 and rewritten to 12, and L3 (the set the source week kept) is deleted.
  it('deletes L1, re-links L2 to pi-1 and L3 to pi-2, and rewrites no rep target', async () => {
    fetchSourceSetLinksMock.mockResolvedValue(new Map([['wp-3', new Map([['i2-w3', 'pi-1'], ['i3-w3', 'pi-2']])]]))
    await apply()
    expect(fetchSourceSetLinksMock).toHaveBeenCalledWith(['wp-3'])
    expect(repointMock.mock.calls).toEqual([['wp-4', 'pe-row', 'pe-incline', [{ weekSetId: 'L2-w4', programSetId: 'pi-1' }, { weekSetId: 'L3-w4', programSetId: 'pi-2' }]]])
    expect(removeSetMock.mock.calls.map((c) => c[0])).toEqual(['L1-w4'])
    expect(updateSetMock).not.toHaveBeenCalled() // no rep target rewritten, no weight touched
  })

  // The fallback, said exactly: where the source sessions could not be re-read after the call there is no chain, and the
  // slot is paired by ordinal within kind (the nth working set of the old row for the nth of the new one). Here that
  // reads the deleted first set as the new first set: a guess, and wrong for this week.
  it('where the source week could not be re-read it falls back to ordinal within kind (a guess)', async () => {
    fetchSourceSetLinksMock.mockRejectedValue(new Error('read failed'))
    await apply()
    expect(repointMock.mock.calls).toEqual([['wp-4', 'pe-row', 'pe-incline', [{ weekSetId: 'L1-w4', programSetId: 'pi-1' }, { weekSetId: 'L2-w4', programSetId: 'pi-2' }]]])
    expect(removeSetMock.mock.calls.map((c) => c[0])).toEqual(['L3-w4'])
    expect(updateSetMock.mock.calls).toEqual([['L1-w4', { repMin: 10, repMax: 10, isAmrap: false }], ['L2-w4', { repMin: 12, repMax: 12, isAmrap: false }]])
  })
})

// ─── A head's kind is ONE part: a later week that made the head something else keeps all of it ───

describe('PlanPage — make this week the default, and a later week that made a head something else (A, B)', () => {
  const benchSetsOf = (sets: DefaultSet[]): DefaultExercise[] => [{ id: 'pe-bench', exerciseId: 'ex-a', position: 0, sets }]
  const stageOf = (id: string, head: string, stageIndex: number, overrides: Partial<DefaultSet> = {}) =>
    dset(id, 1, { parentProgramSetId: head, stageIndex, repMin: 12, repMax: 12, ...overrides })
  const plain2 = () => dset('ps-2', 2)

  // A later week whose first set is `head` (linked to the default's ps-1) with the stages given; a stage that names
  // `null` is the week's own. The second set is the default's.
  const weekWithHead = (n: number, head: Partial<WeekPlanSet>, stages: { programSetId: string | null }[] = []): WeekPlan =>
    oldWeek(n, {
      sets: [
        planSet(n, 's1', 1, 'ps-1', head),
        ...stages.map((st, i) => planSet(n, `st${i + 1}`, 1, st.programSetId, { parentWeekPlanSetId: `s1-w${n}`, stageIndex: i + 1, isDropset: true, repMin: 12, repMax: 12 })),
        planSet(n, 's2', 2, 'ps-2'),
      ],
    })

  function offer(old: DefaultExercise[], neu: DefaultExercise[]) {
    makeWeekDefaultMock.mockResolvedValue({ ...functionAnswer, workouts: [{ ...functionAnswer.workouts[0], oldExercises: old }] })
    fetchRunCopyDefaultsMock.mockResolvedValue(new Map([['wd-1', neu]]))
  }
  async function applyAll(weeks: number, outcome: RegExp) {
    await makeDefaultAndOfferAhead()
    await screen.findByText(`APPLY THIS CHANGE TO ${weeks} PLANNED WEEKS AHEAD?`)
    fireEvent.click(screen.getByText('APPLY'))
    await screen.findByText(outcome)
  }
  const writtenTo = (week: number) => [
    ...updateSetMock.mock.calls.map((c) => c[0] as string),
    ...removeSetMock.mock.calls.map((c) => c[0] as string),
    ...addPointedStageMock.mock.calls.map((c) => c[1] as string),
    ...addPointedSetMock.mock.calls.map((c) => c[1] as string),
  ].filter((id) => id.endsWith(`-w${week}`) || id === `wp-${week}`)

  // CASE 1. Break: gate the warmup record on the single field it writes -> week 5's dropset head (and its own stage)
  // is made a warmup.
  it('CASE 1 — the default makes a set a warmup: a week that made it a dropset with a stage of its own is left alone', async () => {
    offer(benchSetsOf([dset('ps-1', 1), plain2()]), benchSetsOf([dset('ps-1', 1, { isWarmup: true }), plain2()]))
    allPlans = [oldWeek(3), oldWeek(4), weekWithHead(5, { stageKind: 'dropset' }, [{ programSetId: null }])]
    await applyAll(2, /APPLIED TO 1 OF 2 PLANNED WEEKS/)
    expect(screen.getByText(/1 SKIPPED \(ALREADY DIFFERENT\)/)).toBeTruthy()
    expect(updateSetMock.mock.calls).toEqual([['s1-w4', { isWarmup: true }]]) // week 4 held the old plain set
    expect(writtenTo(5)).toEqual([]) // nothing at all was written to week 5: no warmup over its stage
  })

  // CASE 2. Break: gate stageKind and addStage on their own field only -> week 5's warmup is given the kind and a stage.
  it('CASE 2 — the default stages a set as myo-reps: a week that made it a warmup gets neither the kind nor the stage', async () => {
    offer(
      benchSetsOf([dset('ps-1', 1), plain2()]),
      benchSetsOf([dset('ps-1', 1, { stageKind: 'myo_reps' }), stageOf('ps-1s1', 'ps-1', 1), plain2()]),
    )
    allPlans = [oldWeek(3), oldWeek(4), weekWithHead(5, { isWarmup: true })]
    await applyAll(2, /APPLIED TO 1 OF 2 PLANNED WEEKS/)
    expect(updateSetMock.mock.calls).toEqual([['s1-w4', { stageKind: 'myo_reps' }]])
    expect(addPointedStageMock.mock.calls.map((c) => [c[1], c[3]])).toEqual([['wp-4', 's1-w4']])
    expect(writtenTo(5)).toEqual([])
  })

  // CASE 3. Break: skip the whole-kind check in addStage -> the stage lands under week 5's myo-reps head and week 6's warmup.
  it('CASE 3 — the default adds a stage to a dropset head: weeks that made it myo-reps, or a warmup with no stages, get none', async () => {
    const oldDrop = benchSetsOf([dset('ps-1', 1, { stageKind: 'dropset' }), stageOf('ps-1s1', 'ps-1', 1), plain2()])
    offer(oldDrop, benchSetsOf([dset('ps-1', 1, { stageKind: 'dropset' }), stageOf('ps-1s1', 'ps-1', 1), stageOf('ps-1s2', 'ps-1', 2, { repMin: 8, repMax: 8 }), plain2()]))
    allPlans = [
      oldWeek(3),
      weekWithHead(4, { stageKind: 'dropset' }, [{ programSetId: 'ps-1s1' }]),
      weekWithHead(5, { stageKind: 'myo_reps' }, [{ programSetId: 'ps-1s1' }]),
      weekWithHead(6, { isWarmup: true }),
    ]
    await applyAll(3, /APPLIED TO 1 OF 3 PLANNED WEEKS/)
    expect(screen.getByText(/2 SKIPPED \(ALREADY DIFFERENT\)/)).toBeTruthy()
    expect(addPointedStageMock.mock.calls.map((c) => [c[1], c[3], c[4]])).toEqual([['wp-4', 's1-w4', 2]])
    expect(writtenTo(5)).toEqual([])
    expect(writtenTo(6)).toEqual([])
  })

  // B. Break: compare the raw kind column in the stageKind gate -> week 4's kind stays a dropset while its stage goes.
  it('B — old dropset (two stages) to myo-reps (one): a week whose head has no kind stored gets the kind change AND the stage removal', async () => {
    offer(
      benchSetsOf([dset('ps-1', 1, { stageKind: 'dropset' }), stageOf('ps-1s1', 'ps-1', 1), stageOf('ps-1s2', 'ps-1', 2), plain2()]),
      benchSetsOf([dset('ps-1', 1, { stageKind: 'myo_reps' }), stageOf('ps-1s1', 'ps-1', 1), plain2()]),
    )
    allPlans = [
      oldWeek(3),
      weekWithHead(4, { stageKind: null }, [{ programSetId: 'ps-1s1' }, { programSetId: 'ps-1s2' }]),
      weekWithHead(5, { stageKind: 'myo_reps' }, [{ programSetId: 'ps-1s1' }, { programSetId: 'ps-1s2' }]),
    ]
    await applyAll(2, /APPLIED TO 1 OF 2 PLANNED WEEKS/)
    expect(removeSetMock.mock.calls.map((c) => c[0])).toEqual(['st2-w4'])
    expect(updateSetMock.mock.calls).toEqual([['s1-w4', { stageKind: 'myo_reps' }]])
    expect(writtenTo(5)).toEqual([]) // week 5 made the head myo-reps itself: it keeps both its kind and its stages
  })

  it('B — a default that only moves a head from "no kind" to "dropset" has nothing to offer: it reads the same', async () => {
    offer(
      benchSetsOf([dset('ps-1', 1, { stageKind: null }), stageOf('ps-1s1', 'ps-1', 1), plain2()]),
      benchSetsOf([dset('ps-1', 1, { stageKind: 'dropset' }), stageOf('ps-1s1', 'ps-1', 1), plain2()]),
    )
    allPlans = [oldWeek(3), oldWeek(4)]
    await makeDefaultAndOfferAhead()
    await waitFor(() => expect(useToastStore.getState().message).toBe('Week 3 is now the default.'))
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(updateSetMock).not.toHaveBeenCalled()
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
