// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 14 — "Staged sets: all four stage kinds" (SPEC.md), the week-plan
// authoring half: a staged head is marked by its resolved kind, and the kind
// is set on the head. Chunk 54a moved both: the mark is the kind chip above the
// head's row ("DROPSET · 1 DROP"), and the kind is picked in the set type
// picker (the set's ⋯), whose one pick is a list of week writes in order
// (`useChangeSetType`: the head's stage_kind, then the stage rows added or
// removed). What the old STAGE KIND chip row and ADD STAGE wrote is what the
// picker writes now: the same service calls (updateSet on the head, addStage).
// Same mocking recipe as PlanPage.repTargets.test.tsx, extended with
// capturable mutations so the picks' own writes can be asserted.

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

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
// The set type picker (a set's ⋯) reads the exercise's program sets for its rest row; this file gives it none.
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
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
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
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
const isPicked = (name: string) => kind(name).getAttribute('aria-pressed') === 'true'
const staged = (kindOfHead: WeekPlanSet['stageKind'] = null, stages = 1) => [
  makeSet({ id: 'head', setNumber: 1, stageKind: kindOfHead }),
  ...Array.from({ length: stages }, (_, i) => makeSet({ id: `stage-${i + 1}`, setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: i + 1 })),
]

describe('PlanPage — a head with no stages shows no kind chip yet', () => {
  it('no chip, no kind label — nothing staged to label; the set\'s ⋯ opens the picker on Normal, with no ADD STAGE and no STAGE KIND', () => {
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    expect(screen.queryByText('DROPSET')).toBeNull()
    expect(screen.queryByText(/ · \d+ (DROP|PAUSE|MINI-SET|CLUSTER)/)).toBeNull() // the kind chip
    // UI rule (2026-10-10): the kinds are not on the row, they're in the set's ⋯ ...
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    openSetMenu(1)
    // ... as one list; a plain set is Normal; the stage kinds are rows of it, not an ADD STAGE.
    expect(isPicked('Normal')).toBe(true)
    for (const name of ['Warmup', 'Dropset', 'Rest-pause', 'Myo-reps', 'Cluster']) expect(isPicked(name), name).toBe(false)
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    expect(screen.queryByText('DROPS')).toBeNull() // no stepper until a staged kind is picked
  })
})

describe('PlanPage — a staged head is marked by its resolved kind (chunk 14; the kind chip since chunk 54a)', () => {
  it('a legacy/null stage_kind head (today\'s only case) is marked DROPSET; the picker opens on Dropset with one drop', () => {
    mockState.plans = [makePlan(staged(null, 1))]
    renderPlanPage()
    // By default: one compact marker on the head, no picker.
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    expect(screen.getAllByText('DROPSET · 1 DROP')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    openSetMenu(1)
    expect(isPicked('Dropset')).toBe(true)
    expect(isPicked('Normal')).toBe(false)
    expect(picker().getByText('DROPS')).toBeTruthy()
    expect(picker().getByText('1')).toBeTruthy()
  })

  it('a head planned with stageKind "rest_pause" is marked REST-PAUSE, and the picker opens on Rest-pause', () => {
    mockState.plans = [makePlan(staged('rest_pause', 1))]
    renderPlanPage()
    expect(screen.getAllByText('REST-PAUSE · 1 PAUSE')).toHaveLength(1)
    openSetMenu(1)
    expect(isPicked('Rest-pause')).toBe(true)
    expect(isPicked('Dropset')).toBe(false)
    expect(picker().getByText('PAUSES')).toBeTruthy()
  })

  it('the chip counts the stage rows the head really has, in the kind\'s own noun', () => {
    mockState.plans = [makePlan(staged('myo_reps', 3))]
    renderPlanPage()
    expect(screen.getByText('MYO-REPS · 3 MINI-SETS')).toBeTruthy()
    expect(screen.getAllByText('↳')).toHaveLength(3)
  })

  it('the kind chip opens the same picker the ⋯ does', () => {
    mockState.plans = [makePlan(staged('dropset', 2))]
    renderPlanPage()
    fireEvent.click(screen.getByText('DROPSET · 2 DROPS'))
    expect(isPicked('Dropset')).toBe(true)
  })
})

// The one pick is a list of week writes (`useChangeSetType`'s ops), applied in order; the screen asks for the list and writes none itself.
describe('PlanPage — the set type picker writes the head\'s own stage_kind and its stage rows (chunk 14; chunk 54a)', () => {
  const lastTypeChange = () => changeTypeMutate.mock.calls[changeTypeMutate.mock.calls.length - 1]?.[0]

  it('Cluster on a dropset head writes {stageKind: "cluster"} to the head and touches no stage', () => {
    changeTypeMutate.mockClear()
    updateSetMutate.mockClear()
    mockState.plans = [makePlan(staged('dropset', 1))]
    renderPlanPage()

    openSetMenu(1)
    fireEvent.click(kind('Cluster'))

    expect(changeTypeMutate).toHaveBeenCalledTimes(1)
    expect(lastTypeChange()).toEqual({ ops: [{ kind: 'updateHead', id: 'head', changes: { stageKind: 'cluster' } }] })
    expect(updateSetMutate).not.toHaveBeenCalled() // the picker's write is its own list, not a loose update
  })

  it('Dropset on a plain set writes {stageKind: "dropset"} and adds one stage — the calls ADD STAGE made (parent, number, index 1)', () => {
    changeTypeMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ id: 'set-1', setNumber: 2 })])]
    renderPlanPage()

    openSetMenu(1)
    fireEvent.click(kind('Dropset'))

    expect(lastTypeChange()).toEqual({
      ops: [
        { kind: 'updateHead', id: 'set-1', changes: { stageKind: 'dropset' } },
        { kind: 'addStage', weekPlanId: 'wp-1', programExerciseId: 'pe-1', parentId: 'set-1', setNumber: 2, stageIndex: 1 },
      ],
    })
  })

  it('the stepper\'s More adds a stage after the last one; Fewer removes the last', () => {
    changeTypeMutate.mockClear()
    mockState.plans = [makePlan(staged('dropset', 2))]
    renderPlanPage()

    openSetMenu(1)
    fireEvent.click(picker().getByRole('button', { name: 'More drops' }))
    expect(lastTypeChange()).toEqual({
      ops: [{ kind: 'addStage', weekPlanId: 'wp-1', programExerciseId: 'pe-1', parentId: 'head', setNumber: 1, stageIndex: 3 }],
    })

    fireEvent.click(picker().getByRole('button', { name: 'Fewer drops' }))
    expect(lastTypeChange()).toEqual({ ops: [{ kind: 'removeStage', id: 'stage-2' }] })
  })

  it('Normal on a staged head removes its stages (the last first) and clears the head\'s kind', () => {
    changeTypeMutate.mockClear()
    mockState.plans = [makePlan(staged('rest_pause', 2))]
    renderPlanPage()

    openSetMenu(1)
    fireEvent.click(kind('Normal'))

    expect(lastTypeChange()).toEqual({
      ops: [
        { kind: 'removeStage', id: 'stage-2' },
        { kind: 'removeStage', id: 'stage-1' },
        { kind: 'updateHead', id: 'head', changes: { stageKind: null } },
      ],
    })
  })

  it('a tap on the type the set already is asks for nothing', () => {
    changeTypeMutate.mockClear()
    mockState.plans = [makePlan(staged('dropset', 1))]
    renderPlanPage()

    openSetMenu(1)
    fireEvent.click(kind('Dropset'))

    expect(changeTypeMutate).not.toHaveBeenCalled()
  })
})
