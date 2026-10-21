// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, ProgramSet, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 15 (SPEC "Warmup sets" — "the week plan offer[s] warmup sets"), carried to
// chunk 54a (SPEC "Warmup sets [1.2]": a warmup is made with the set type picker;
// G49: a warmup row has no RIR; G55: a warmup row's ⋯ offers Normal and Warmup
// only). The per-row WARMUP chip, the exercise ⋯'s "Add warmup sets" and the
// STRUCTURE view's DELETE are gone: a set becomes a warmup by the picker's
// Warmup row (`useChangeSetType`), and a warmup is removed by REMOVE THIS SET.
// Same mocking recipe as PlanPage.stageKind.test.tsx, with the program sets the
// picker's rest row reads (week-dependent runs, G45 c).

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
const changeTypeMutate = vi.fn()
const removeSetMutate = vi.fn()
// The program sets the picker's rest row reads (useProgramSets) and the writes it makes (the run copy's rest, G45 c).
const programSetsState: { sets: ProgramSet[] } = { sets: [] }
const updateRestMutate = vi.fn()
const updateStageRestMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  useProgramSets: (ids: string[]) => ({ data: programSetsState.sets.filter((ps) => ids.includes(ps.programExerciseId)) }),
  useUpdateProgramSetRest: () => ({ mutate: updateRestMutate }),
  useUpdateProgramSetStageRest: () => ({ mutate: updateStageRestMutate }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
  useChangeSetType: () => ({ mutate: changeTypeMutate, isPending: false }),
}))

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openSetMenu } = await import('./planMenus.testutil')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const picker = () => within(screen.getByRole('dialog', { name: 'What is this set?' }))
const kind = (name: string) => picker().getByRole('button', { name: new RegExp(`^${name}`) })
const lastTypeChange = () => changeTypeMutate.mock.calls[changeTypeMutate.mock.calls.length - 1]?.[0]
const pset = (id: string, programExerciseId: string, over: Partial<ProgramSet> = {}): ProgramSet => ({
  id, userId: 'user-1', programExerciseId, position: 0, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 8, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})

afterEach(() => {
  programSetsState.sets = []
  changeTypeMutate.mockClear()
  removeSetMutate.mockClear()
  updateSetMutate.mockClear()
  updateRestMutate.mockClear()
  updateStageRestMutate.mockClear()
})

describe('PlanPage — warmup sets (chunk 15; made with the set type picker since chunk 54a)', () => {
  it('a plain week shows no warmup marker anywhere by default; the set\'s ⋯ offers Warmup among the six types (no per-row chip)', () => {
    mockState.plans = [makePlan([makeSet({ id: 'head', isWarmup: false })])]
    renderPlanPage()
    expect(screen.queryByText('SET KIND')).toBeNull()
    expect(screen.queryByText(/WARMUP/)).toBeNull()
    expect(screen.getByText('RIR')).toBeTruthy() // a working set has its RIR cell: "RIR –" with none set
    expect(screen.queryByText('W')).toBeNull() // no row is a warmup

    openSetMenu(1)
    expect(kind('Warmup').getAttribute('aria-pressed')).toBe('false')
    expect(kind('Normal').getAttribute('aria-pressed')).toBe('true')
  })

  it('"Add warmup sets" is gone: no exercise ⋯, nothing on the page or in a set\'s picker adds a block of them', () => {
    mockState.plans = [makePlan([makeSet({ id: 'head' })])]
    renderPlanPage()
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull()
    expect(screen.queryByLabelText('Bench Press options')).toBeNull()

    openSetMenu(1)
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull()
    expect(screen.queryByText(/ADD WARMUP/i)).toBeNull()
  })

  it('Warmup on a plain set writes isWarmup: true to that head — and clears no kind and no stages (it has none)', () => {
    mockState.plans = [makePlan([makeSet({ id: 'head' })])]
    renderPlanPage()

    openSetMenu(1)
    fireEvent.click(kind('Warmup'))

    expect(changeTypeMutate).toHaveBeenCalledTimes(1)
    expect(lastTypeChange()).toEqual({ ops: [{ kind: 'updateHead', id: 'head', changes: { isWarmup: true } }] })
  })

  it('a warmup head is W, shows no RIR cell, and its picker opens on Warmup', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'warm', setNumber: 1, isWarmup: true }),
      makeSet({ id: 'work', setNumber: 2 }),
    ])]
    renderPlanPage()
    // Only the working set has an RIR cell.
    expect(screen.getAllByText('RIR')).toHaveLength(1)
    // The warmup is W; the working set is 01 (a warmup is not counted).
    expect(screen.getAllByText('W')).toHaveLength(1)
    expect(screen.getByText('01')).toBeTruthy()

    openSetMenu(1) // the first WORKING set is "set 1": the warmup's ⋯ is "warmup set 1"
    expect(kind('Normal').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getAllByLabelText('Close')[0])

    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    expect(kind('Warmup').getAttribute('aria-pressed')).toBe('true')
  })

  it('a warmup row\'s picker offers exactly Normal and Warmup — no staged kind, no stage stepper (a warmup is never staged, G55)', () => {
    mockState.plans = [makePlan([makeSet({ id: 'warm', setNumber: 1, isWarmup: true }), makeSet({ id: 'work', setNumber: 2 })])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    const names = within(picker().getByRole('group', { name: 'Set type' })).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['NormalA straight working set.', 'WarmupLighter, not counted as volume. Usually the first sets.'])
    for (const staged of ['Dropset', 'Rest-pause', 'Myo-reps', 'Cluster']) expect(picker().queryByText(staged), staged).toBeNull()
    expect(picker().queryByText('DROPS')).toBeNull()
    expect(screen.queryByText(/ADD STAGE/)).toBeNull()
    // ... and it has Cues and REMOVE THIS SET like any other set's.
    expect(picker().getByText('Cues')).toBeTruthy()
    expect(picker().getByText('REMOVE THIS SET')).toBeTruthy()
  })

  it('Normal on a warmup writes isWarmup: false; a tap on Warmup (what it is) asks for nothing', () => {
    mockState.plans = [makePlan([makeSet({ id: 'warm', setNumber: 1, isWarmup: true }), makeSet({ id: 'work', setNumber: 2 })])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    fireEvent.click(kind('Warmup'))
    expect(changeTypeMutate).not.toHaveBeenCalled()
    fireEvent.click(kind('Normal'))

    expect(changeTypeMutate).toHaveBeenCalledTimes(1)
    expect(lastTypeChange()).toEqual({ ops: [{ kind: 'updateHead', id: 'warm', changes: { isWarmup: false } }] })
  })

  it('REMOVE THIS SET on a warmup removes that warmup alone', () => {
    mockState.plans = [makePlan([makeSet({ id: 'warm', setNumber: 1, isWarmup: true }), makeSet({ id: 'work', setNumber: 2 })])]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    fireEvent.click(picker().getByText('REMOVE THIS SET'))

    expect(removeSetMutate.mock.calls).toEqual([['warm']])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('warmups render above the first working set (ordered by set number)', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'work', setNumber: 2 }),
      makeSet({ id: 'warm', setNumber: 1, isWarmup: true }),
    ])]
    renderPlanPage()
    const rows = screen.getAllByLabelText(/^Options for /)
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Options for warmup set 1', 'Options for set 1'])
    // Row 1 carries the W, row 2 the 01.
    const marker = screen.getByText('W')
    expect(rows[0].compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(marker.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('01').compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})

// G45 (c): "Rest after this set" is the run copy's program set's rest, and only a set that names a program set OF ITS OWN exercise row has
// one. A warmup row has it where any other set would (TASKS 54a): the picker is the same, the rows it draws are `canEditRest`'s.
describe('PlanPage — a warmup row\'s rest row (G45 c; chunk 54a)', () => {
  const warmWeek = (programSetId: string | null) => makePlan([
    makeSet({ id: 'warm', setNumber: 1, isWarmup: true, programSetId }),
    makeSet({ id: 'work', setNumber: 2 }),
  ])
  const restRow = () => screen.queryByText('Rest after this set')

  it('is there when the warmup\'s program set is its own exercise row\'s, and writes that program set (not the week set)', () => {
    programSetsState.sets = [pset('ps-warm', 'pe-1', { restSeconds: 90, isWarmup: true })]
    mockState.plans = [warmWeek('ps-warm')]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    expect(restRow()).toBeTruthy()
    expect(picker().getByText('1:30')).toBeTruthy() // the program set's own rest, as the picker shows it
    fireEvent.click(picker().getByRole('button', { name: 'Rest after this set: more' }))

    expect(updateRestMutate.mock.calls).toEqual([[{ id: 'ps-warm', restSeconds: 105 }]])
    expect(updateSetMutate).not.toHaveBeenCalled() // the week set is not written for it
    expect(changeTypeMutate).not.toHaveBeenCalled()
  })

  it('is NOT there when the week set\'s program set belongs to another exercise row (the run\'s copy of a different exercise), or names none', () => {
    programSetsState.sets = [pset('ps-warm', 'pe-other', { restSeconds: 90 })]
    mockState.plans = [warmWeek('ps-warm')]
    renderPlanPage()
    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    expect(restRow()).toBeNull() // another exercise row's program set is no rest of this set's
    expect(picker().queryByRole('button', { name: /^Rest after this set/ })).toBeNull()
    cleanup()

    programSetsState.sets = [pset('ps-warm', 'pe-1', { restSeconds: 90 })]
    mockState.plans = [warmWeek(null)]
    renderPlanPage()
    fireEvent.click(screen.getByLabelText('Options for warmup set 1'))
    expect(restRow()).toBeNull()
  })
})
