// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 19 (SPEC "Targets" — "Rep targets ... The week plan can override a
// set's rep target for that week"; reviewer's note: "parsed only by
// parseRepTarget. Invalid input is refused inline and nothing is written.
// Writes only that week-plan set's rep_min/rep_max/is_amrap, never the
// program set"; and "AMRAP ... RIR defaults to 0, editable ... when a week
// set is changed to AMRAP in Plan and its target_rir is null, write
// target_rir = 0 in the same update; never overwrite an existing RIR").
// Same mocking recipe as PlanPage.stageKind.test.tsx.
//
// Chunk 54a: the reps cell opens the rep target picker (the inline field it was, with its free-text parsing and its inline refusal, is
// gone: the picker's own tests, components/pickers/TargetPickers.test.tsx, hold what a box accepts), and this file keeps what the PAGE does
// with the target the picker returns: which columns are written, to which sets, and the AMRAP RIR default.

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

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
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
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const picker = () => within(screen.getByRole('dialog', { name: 'Rep target' }))
const segment = (name: string) => picker().getByRole('button', { name })
const box = (name: string) => picker().getByRole('textbox', { name }) as HTMLInputElement
const typeInto = (name: string, value: string) => fireEvent.change(box(name), { target: { value } })
const useForAll = () => picker().queryByRole('checkbox', { name: /^Use for all/ })
const submit = (name: string) => fireEvent.click(picker().getByRole('button', { name }))
const repsOf = (text: string, nth = 0) => screen.getAllByText(text)[nth]
const noRepTarget = (nth = 0) => screen.getAllByRole('button', { name: 'Set rep target' })[nth]

describe('PlanPage — rep target picker (chunk 19; the picker since chunk 54a)', () => {
  it('a range writes rep_min/rep_max via useUpdateSet, is_amrap false, no target_rir key at all', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(noRepTarget())
    fireEvent.click(segment('RANGE'))
    typeInto('From', '8')
    typeInto('To', '12')
    submit('SET 8–12 REPS')

    expect(updateSetMutate).toHaveBeenCalledWith({
      id: 'set-1',
      changes: { repMin: 8, repMax: 12, isAmrap: false },
    })
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect('targetRir' in updateSetMutate.mock.calls[0][0].changes).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull() // the picker closes on SET
  })

  it('a number writes the same value for both ends', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()

    fireEvent.click(noRepTarget())
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS', '5')
    submit('SET 5 REPS')

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { repMin: 5, repMax: 5, isAmrap: false } })
  })

  it('closing the picker any other way (×, the scrim, Escape) writes nothing', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ repMin: 8, repMax: 12 })])]
    renderPlanPage()

    fireEvent.click(repsOf('8–12'))
    fireEvent.click(segment('AMRAP'))
    fireEvent.click(screen.getByLabelText('Close'))

    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('8–12')).toBeTruthy() // the row is as it was
  })

  it('NONE clears an existing target — writes { repMin: null, repMax: null, isAmrap: false }', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ repMin: 8, repMax: 12 })])]
    renderPlanPage()

    fireEvent.click(repsOf('8–12'))
    fireEvent.click(segment('NONE'))
    submit('CLEAR TARGET')

    expect(updateSetMutate).toHaveBeenCalledWith({
      id: 'set-1',
      changes: { repMin: null, repMax: null, isAmrap: false },
    })
  })

  it('it opens on the set\'s own target (8–12), and picking the exact same target writes nothing', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ repMin: 8, repMax: 12 })])]
    renderPlanPage()

    fireEvent.click(repsOf('8–12'))
    expect(segment('RANGE').getAttribute('aria-pressed')).toBe('true')
    expect(box('From').value).toBe('8')
    expect(box('To').value).toBe('12')
    submit('SET 8–12 REPS')

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('only writes THIS week-plan set\'s own columns — a stage row\'s picker writes that stage and offers no "Use for all"', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1 }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()

    // The head (one head: nothing to use it for, so "Use for all" isn't drawn either) ...
    fireEvent.click(noRepTarget(0))
    expect(useForAll()).toBeNull()
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS', '5')
    submit('SET 5 REPS')
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head', changes: { repMin: 5, repMax: 5, isAmrap: false } })
    updateSetMutate.mockClear()

    // ... and the stage's own picker writes the stage.
    fireEvent.click(noRepTarget(1))
    expect(useForAll()).toBeNull()
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS', '6')
    submit('SET 6 REPS')
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'stage', changes: { repMin: 6, repMax: 6, isAmrap: false } })
  })

  // Independent-review break R9 (chunk 54a sweep): handing a stage row's picker the heads passed every test, because the one fixture that
  // opened a stage's picker had a single head, and the picker draws "Use for all" only where there are two sets to use it for.
  it('a stage row\'s picker offers no "Use for all" even where the exercise has other sets, and writes that stage alone', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1, repMin: 8, repMax: 12 }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
      makeSet({ id: 'other', setNumber: 2, repMin: 8, repMax: 12 }),
    ])]
    renderPlanPage()

    fireEvent.click(noRepTarget(0)) // the stage's cell: the only one with no target
    expect(useForAll()).toBeNull()
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS', '6')
    submit('SET 6 REPS')

    expect(updateSetMutate.mock.calls.map(([v]) => v)).toEqual([{ id: 'stage', changes: { repMin: 6, repMax: 6, isAmrap: false } }])
  })

  it('"Use for all" starts ticked and writes every head of the exercise — a warmup too, never a stage; a head that already has the target is not written', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'warm', setNumber: 1, isWarmup: true, repMin: 10, repMax: 10 }),
      makeSet({ id: 'a', setNumber: 2, repMin: 8, repMax: 12 }),
      makeSet({ id: 'a-stage', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'a', stageIndex: 1, repMin: 6, repMax: 6 }),
      makeSet({ id: 'b', setNumber: 3, repMin: 8, repMax: 12 }),
      makeSet({ id: 'c', setNumber: 4, repMin: 4, repMax: 6 }),
    ])]
    renderPlanPage()

    fireEvent.click(repsOf('8–12', 0)) // set 01 (the first working set; the warmup is W)
    expect(useForAll()?.getAttribute('aria-checked')).toBe('true')
    expect(useForAll()?.textContent).toContain('Use for all 4 sets of Bench Press')
    typeInto('From', '4')
    typeInto('To', '6')
    submit('SET 4–6 REPS')

    expect(updateSetMutate.mock.calls.map(([v]) => v)).toEqual([
      { id: 'warm', changes: { repMin: 4, repMax: 6, isAmrap: false } },
      { id: 'a', changes: { repMin: 4, repMax: 6, isAmrap: false } },
      { id: 'b', changes: { repMin: 4, repMax: 6, isAmrap: false } },
    ]) // not 'c', which has 4–6 already; not the stage row
  })

  it('"Use for all" unticked writes this set alone', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ id: 'a', setNumber: 1, repMin: 8, repMax: 12 }), makeSet({ id: 'b', setNumber: 2, repMin: 8, repMax: 12 })])]
    renderPlanPage()

    fireEvent.click(repsOf('8–12', 1))
    fireEvent.click(useForAll() as HTMLElement)
    typeInto('From', '4')
    typeInto('To', '6')
    submit('SET 4–6 REPS')

    expect(updateSetMutate.mock.calls.map(([v]) => v)).toEqual([{ id: 'b', changes: { repMin: 4, repMax: 6, isAmrap: false } }])
  })
})

describe('PlanPage — AMRAP defaults target_rir to 0, only when null (chunk 19)', () => {
  it('changing to AMRAP with no existing RIR writes target_rir: 0 in the SAME update', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetRir: null })])]
    renderPlanPage()

    fireEvent.click(noRepTarget())
    fireEvent.click(segment('AMRAP'))
    submit('SET AMRAP')

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({
      id: 'set-1',
      changes: { repMin: null, repMax: null, isAmrap: true, targetRir: 0 },
    })
  })

  it('changing to AMRAP with an EXISTING RIR never overwrites it — no target_rir key at all', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetRir: 3 })])]
    renderPlanPage()

    fireEvent.click(noRepTarget())
    fireEvent.click(segment('AMRAP'))
    submit('SET AMRAP')

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { repMin: null, repMax: null, isAmrap: true } })
    expect('targetRir' in updateSetMutate.mock.calls[0][0].changes).toBe(false)
  })

  it('a non-AMRAP target change never gets a target_rir default, even with a null RIR', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ targetRir: null })])]
    renderPlanPage()

    fireEvent.click(noRepTarget())
    fireEvent.click(segment('RANGE'))
    typeInto('From', '8')
    typeInto('To', '12')
    submit('SET 8–12 REPS')

    expect('targetRir' in updateSetMutate.mock.calls[0][0].changes).toBe(false)
  })

  it('"Use for all" AMRAP gives RIR 0 to the heads that have none and leaves a head that has a RIR alone; a warmup gets none (G49)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: null }),
      makeSet({ id: 'a', setNumber: 2, targetRir: null }),
      makeSet({ id: 'b', setNumber: 3, targetRir: 3 }),
    ])]
    renderPlanPage()

    fireEvent.click(noRepTarget(1)) // set 01 (the warmup is W)
    fireEvent.click(segment('AMRAP'))
    submit('SET AMRAP')

    expect(updateSetMutate.mock.calls.map(([v]) => v)).toEqual([
      { id: 'warm', changes: { repMin: null, repMax: null, isAmrap: true } },
      { id: 'a', changes: { repMin: null, repMax: null, isAmrap: true, targetRir: 0 } },
      { id: 'b', changes: { repMin: null, repMax: null, isAmrap: true } },
    ])
  })
})
