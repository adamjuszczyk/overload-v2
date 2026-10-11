// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise, SequenceItem, Session } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { AheadGroup, ChangeRecord } from './applyAhead'
import type { MakeWeekDefaultOutcome } from './useMakeWeekDefault'
import type { DefaultExercise, DefaultSet } from './makeWeekDefault'
import { useToastStore } from '../notifications/toastStore'

// Chunk 32 (TASKS-1.1 "Stable: Make this week the new default"; SPEC Weeks and copying
// [P1.1], Plan screen actions) — the action on the Plan screen. Renders the real PlanPage
// tree; only the data hooks are mocked (the seam every PlanPage test file uses). What is
// proved here, at the screen:
//   - WHERE it is offered, and (absence tests, Checks that lied #32) where it is not: a
//     stable run's current week and a later one; not a week-dependent run, a past week,
//     a week that is all deload (or all deload and empty), a week with nothing planned;
//     on a sequence run from chunk 35's current cycle, not from the calendar week;
//   - the confirm step: opening it calls nothing, CANCEL calls nothing, CONFIRM calls
//     the mutation for the viewed week (the hook calls the function with (run, week):
//     useMakeWeekDefault.test.tsx; the function's own call: makeDefaultService.test.ts);
//   - after it, "Apply this change to planned weeks ahead" is offered exactly when later
//     weeks of a rewritten workout are planned, carrying the records of the old default →
//     new default (the screen-layer record test the apply-ahead rule asks for); an error
//     of the call is a toast, no offer, nothing else.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  useToastStore.getState().clear()
})

// ─── Scenario state, read by the mocks below ─────────────────────────────────

const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const workoutDay2: WorkoutDay = { id: 'wd-2', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }

function makeProgram(planningType: Program['planningType'], overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-2' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType, ...overrides,
  }
}

// A planned session of a workout in a week: one exercise with one set (so it can be a source), unless told otherwise.
function plan(weekNumber: number, overrides: Partial<WeekPlan> & { withSets?: boolean; workoutDayId?: string } = {}): WeekPlan {
  const { withSets = true, workoutDayId = 'wd-1', ...rest } = overrides
  const peId = `pe-${workoutDayId}`
  const pe: ProgramExercise = { id: peId, workoutDayId, userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null, exercise: EX_A }
  const sets: WeekPlanSet[] = withSets
    ? [{ id: `s-${workoutDayId}-${weekNumber}`, weekPlanId: `wp-${workoutDayId}-${weekNumber}`, userId: 'user-1', programExerciseId: peId, setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId: `ps-${workoutDayId}` }]
    : []
  return {
    id: `wp-${workoutDayId}-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber, isDeload: false, notes: null,
    exercises: [pe], sets, createdAt: '2026-01-01T00:00:00Z', ...rest,
  }
}

let activeMeso: Mesocycle
let program: Program
let plans: WeekPlan[] = []
let sequenceItems: SequenceItem[] = []
let lastDoneOrSkipped: Session | null | undefined = null

// The run started two calendar weeks ago, so a weekday run's current week is 3.
function useWeekdayRun(planningType: Program['planningType'], weekPlans: WeekPlan[]) {
  activeMeso = {
    id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
    startDate: format(subWeeks(new Date(), 2), 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z',
  }
  program = makeProgram(planningType)
  plans = weekPlans
}

const makeMutate = vi.fn()
const applyAheadMutate = vi.fn()
const makeIsPending = { value: false }
const updateSetMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay, workoutDay2], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../gym/useSession', () => ({ useLastDoneOrSkippedSession: () => ({ data: lastDoneOrSkipped }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: plans.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: applyAheadMutate, isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./useMakeWeekDefault', () => ({
  useMakeWeekDefault: (mesoId: string) => ({
    mutate: (vars: { weekNumber: number }, options?: unknown) => makeMutate(mesoId, vars, options),
    isPending: makeIsPending.value,
  }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  makeMutate.mockReset()
  applyAheadMutate.mockReset()
  updateSetMutate.mockReset()
  makeIsPending.value = false
  sequenceItems = []
  lastDoneOrSkipped = null
})

const ACTION = 'MAKE THIS WEEK THE NEW DEFAULT'
const CYCLE_ACTION = 'MAKE THIS CYCLE THE NEW DEFAULT'
const nextWeek = () => fireEvent.click(screen.getByLabelText('Next week'))
const previousWeek = () => fireEvent.click(screen.getByLabelText('Previous week'))

// ─── Where the action is offered ─────────────────────────────────────────────

describe('PlanPage — "Make this week the new default": where it is offered', () => {
  it('shows on the current week of a stable run', () => {
    useWeekdayRun('stable', [plan(3), plan(3, { workoutDayId: 'wd-2' })])
    renderPlanPage()
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.getByText(ACTION)).toBeTruthy()
  })

  it('shows on a future week of a stable run too', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    nextWeek()
    expect(screen.getByText('WEEK 4')).toBeTruthy()
    expect(screen.getByText(ACTION)).toBeTruthy()
  })

  it('is a page-level action: above the views, next to the other week actions, in both views', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    const button = screen.getByText(ACTION)
    const markDeload = screen.getByText('MARK WEEK AS DELOAD')
    const switcher = screen.getByText('STRUCTURE')
    // After MARK WEEK AS DELOAD, before the SETS / STRUCTURE switch in document order.
    expect(markDeload.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(button.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(switcher)
    expect(screen.getByText(ACTION)).toBeTruthy()
  })

  // Absence tests (Checks that lied #32): the action is NOT there where SPEC doesn't offer it.
  it('is absent on a week-dependent run (its next week copies this one anyway)', () => {
    useWeekdayRun('week_dependent', [plan(3), plan(4)])
    renderPlanPage()
    expect(screen.queryByText(ACTION)).toBeNull()
    nextWeek()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('is absent on a run whose planning type is not stated (it reads as week-dependent)', () => {
    useWeekdayRun(undefined, [plan(3)])
    renderPlanPage()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('is absent on a past week, with the default still offered on the current and later ones', () => {
    useWeekdayRun('stable', [plan(2), plan(3), plan(4)])
    renderPlanPage()
    expect(screen.getByText(ACTION)).toBeTruthy()
    previousWeek()
    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()
    expect(screen.queryByText(ACTION)).toBeNull()
    nextWeek()
    expect(screen.getByText(ACTION)).toBeTruthy()
  })

  it('is absent on a week that is all deload', () => {
    useWeekdayRun('stable', [plan(3, { isDeload: true }), plan(3, { workoutDayId: 'wd-2', isDeload: true })])
    renderPlanPage()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('is absent on a week of deload and empty sessions, as the function refuses it', () => {
    useWeekdayRun('stable', [plan(3, { isDeload: true }), plan(3, { workoutDayId: 'wd-2', withSets: false })])
    renderPlanPage()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('is absent on a week whose every session is empty (nothing to be the default)', () => {
    useWeekdayRun('stable', [plan(3, { withSets: false }), plan(3, { workoutDayId: 'wd-2', withSets: false })])
    renderPlanPage()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('is absent on a week with nothing planned', () => {
    useWeekdayRun('stable', [plan(2)])
    renderPlanPage()
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('is offered on a week where only SOME sessions are deload: the others can be the default', () => {
    useWeekdayRun('stable', [plan(3, { isDeload: true }), plan(3, { workoutDayId: 'wd-2' })])
    renderPlanPage()
    expect(screen.getByText(ACTION)).toBeTruthy()
  })
})

// ─── A sequence run: the current cycle, not the calendar week ────────────────

describe('PlanPage — on a sequence run the action follows chunk 35\'s current cycle', () => {
  // The run started this calendar week (calendar week 1), but cycle 1's last workout is done:
  // the next due workout is in cycle 2, so cycle 2 is the current cycle and cycle 1 is past.
  function setUpSequenceRun() {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
    activeMeso = {
      id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
      startDate: format(monday, 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z',
    }
    program = makeProgram('stable', { scheduleType: 'sequence', schedule: EMPTY_SCHEDULE })
    sequenceItems = [
      { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-1' },
      { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: 'wd-2' },
    ]
    const slotPlan = (cycle: number, position: number): WeekPlan => ({ ...plan(cycle, { workoutDayId: position === 0 ? 'wd-1' : 'wd-2' }), sequencePosition: position, id: `wp-c${cycle}-s${position}` })
    plans = [slotPlan(1, 0), slotPlan(1, 1), slotPlan(2, 0), slotPlan(2, 1), slotPlan(3, 0), slotPlan(3, 1)]
    // The last workout done: the cycle's last slot, in cycle 1.
    const day = format(addDays(monday, 1), 'yyyy-MM-dd')
    lastDoneOrSkipped = {
      id: 's-last', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-c1-s1', workoutDayId: 'wd-2', date: day, status: 'completed', note: null,
      startedAt: `${day}T09:00:00Z`, completedAt: `${day}T10:00:00Z`, createdAt: `${day}T09:00:00Z`, setLogs: [], energyRating: null, pumpRating: null, movedToDate: null,
    }
  }

  // Break: take the calendar week (1) for the current one -> cycle 2 opens as a future cycle but
  // cycle 1 is "current" and still offers the action, which fails the last two assertions.
  it('is offered from the current cycle (the one with the next due workout) and later ones, not on the cycle the calendar week names', () => {
    setUpSequenceRun()
    renderPlanPage()
    // Opens on cycle 2: the next due workout is in it. The calendar week is 1.
    expect(screen.getByText('CYCLE 2')).toBeTruthy()
    expect(screen.queryByText('PAST WEEK — READ ONLY')).toBeNull()
    expect(screen.getByText(CYCLE_ACTION)).toBeTruthy()
    // A later cycle: offered.
    nextWeek()
    expect(screen.getByText('CYCLE 3')).toBeTruthy()
    expect(screen.getByText(CYCLE_ACTION)).toBeTruthy()
    // Cycle 1 is the calendar's current week but a past cycle here: absent.
    previousWeek()
    previousWeek()
    expect(screen.getByText('CYCLE 1')).toBeTruthy()
    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()
    expect(screen.queryByText(CYCLE_ACTION)).toBeNull()
    expect(screen.queryByText(ACTION)).toBeNull()
  })

  it('a sequence run says CYCLE where the others say WEEK, as every other week-level action does', () => {
    setUpSequenceRun()
    renderPlanPage()
    expect(screen.queryByText(ACTION)).toBeNull()
    expect(screen.getByText(CYCLE_ACTION)).toBeTruthy()
    fireEvent.click(screen.getByText(CYCLE_ACTION))
    expect(screen.getByText('Make cycle 2 the new default?')).toBeTruthy()
  })

  it('a week-dependent sequence run does not have it', () => {
    setUpSequenceRun()
    program = makeProgram('week_dependent', { scheduleType: 'sequence', schedule: EMPTY_SCHEDULE })
    renderPlanPage()
    expect(screen.queryByText(CYCLE_ACTION)).toBeNull()
  })
})

// ─── The confirm step ────────────────────────────────────────────────────────

describe('PlanPage — "Make this week the new default": the confirm step', () => {
  function open() {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    fireEvent.click(screen.getByText(ACTION))
  }

  it('tapping it asks first, saying what it does, and calls nothing', () => {
    open()
    expect(screen.getByText('Make week 3 the new default?')).toBeTruthy()
    expect(screen.getByText(/Its sets, reps and structure become the default every week planned from now on starts from/)).toBeTruthy()
    expect(screen.getByText(/Weights, RIR and tags are not part of it, and deload sessions keep the current default/)).toBeTruthy()
    expect(screen.getByText(/This cannot be undone/)).toBeTruthy()
    expect(makeMutate).not.toHaveBeenCalled()
  })

  it('CANCEL closes it and calls nothing', () => {
    open()
    fireEvent.click(screen.getByText('CANCEL'))
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(makeMutate).not.toHaveBeenCalled()
    // ...and the action is still there to try again.
    expect(screen.getByText(ACTION)).toBeTruthy()
  })

  // Break: call the mutation straight from the button (no confirm step) -> makeMutate has been called before CONFIRM.
  it('CONFIRM calls the action once, for the viewed week of the run', () => {
    open()
    expect(makeMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('MAKE DEFAULT'))
    expect(makeMutate).toHaveBeenCalledTimes(1)
    expect(makeMutate.mock.calls[0][0]).toBe('meso-1')
    expect(makeMutate.mock.calls[0][1]).toEqual({ weekNumber: 3 })
  })

  it('on a future week it is that week that is made the default', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    nextWeek()
    fireEvent.click(screen.getByText(ACTION))
    expect(screen.getByText('Make week 4 the new default?')).toBeTruthy()
    fireEvent.click(screen.getByText('MAKE DEFAULT'))
    expect(makeMutate.mock.calls[0][1]).toEqual({ weekNumber: 4 })
  })

  it('while it runs the action cannot be tapped again', () => {
    useWeekdayRun('stable', [plan(3)])
    makeIsPending.value = true
    renderPlanPage()
    const button = screen.getByText('MAKING THE DEFAULT…').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

// ─── What follows: the toast, and "Apply this change to planned weeks ahead" ──

function setDefaultSet(id: string, overrides: Partial<DefaultSet> = {}): DefaultSet {
  return { id, position: 1, isWarmup: false, parentProgramSetId: null, stageIndex: 0, stageKind: null, repMin: null, repMax: null, isAmrap: false, ...overrides }
}
function defaultExercise(id: string, position: number, sets: DefaultSet[]): DefaultExercise {
  return { id, exerciseId: 'ex-a', position, sets }
}

// The function's answer for workout wd-1 (old default: one exercise, one set at 8–10), and the run's
// copy afterwards (the rep target is 6–8 now, and an exercise joined).
function outcome(overrides: Partial<MakeWeekDefaultOutcome> = {}): MakeWeekDefaultOutcome {
  const oldExercises = [defaultExercise('pe-wd-1', 0, [setDefaultSet('ps-wd-1', { repMin: 8, repMax: 10 })])]
  return {
    result: { mesocycleId: 'meso-1', weekNumber: 3, skipped: [], workouts: [{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-wd-1-3', sourceSequencePosition: null, oldExercises }] },
    newDefaults: new Map([[
      'wd-1',
      [
        defaultExercise('pe-wd-1', 0, [setDefaultSet('ps-wd-1', { repMin: 6, repMax: 8 })]),
        { id: 'pe-joined', exerciseId: 'ex-joined', position: 1, sets: [setDefaultSet('ps-joined', { position: 1, repMin: 12, repMax: 15 })] },
      ],
    ]]),
    ...overrides,
  }
}

type MutateOptions = { onSuccess: (o: MakeWeekDefaultOutcome) => void; onError: (e: unknown) => void }

function confirmAndAnswer(answer: (options: MutateOptions) => void) {
  fireEvent.click(screen.getByText(ACTION))
  fireEvent.click(screen.getByText('MAKE DEFAULT'))
  act(() => answer(makeMutate.mock.calls[0][2] as MutateOptions))
}

describe('PlanPage — after "Make this week the new default"', () => {
  it('says what happened, closes the confirm, and offers nothing when no later week is planned', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome()))
    expect(useToastStore.getState().message).toBe('Week 3 is now the default.')
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
  })

  it('offers "Apply this change to planned weeks ahead" when later weeks of a rewritten workout are planned', () => {
    useWeekdayRun('stable', [plan(3), plan(4), plan(5)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome()))
    expect(screen.getByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')).toBeTruthy()
  })

  it('...and not when the only planned weeks are before it or are another workout\'s', () => {
    useWeekdayRun('stable', [plan(2), plan(3), plan(4, { workoutDayId: 'wd-2' })])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome()))
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
  })

  it('counts weeks, not sessions: two workouts rewritten, two later weeks planned for both, is "2 planned weeks"', () => {
    useWeekdayRun('stable', [plan(3), plan(3, { workoutDayId: 'wd-2' }), plan(4), plan(4, { workoutDayId: 'wd-2' }), plan(5), plan(5, { workoutDayId: 'wd-2' })])
    renderPlanPage()
    const both = outcome()
    both.result.workouts.push({
      workoutDayId: 'wd-2', sourceWeekPlanId: 'wp-wd-2-3', sourceSequencePosition: null,
      oldExercises: [defaultExercise('pe-wd-2', 0, [setDefaultSet('ps-wd-2', { repMin: 8, repMax: 10 })])],
    })
    both.newDefaults!.set('wd-2', [defaultExercise('pe-wd-2', 0, [setDefaultSet('ps-wd-2', { repMin: 5, repMax: 5 })])])
    confirmAndAnswer((o) => o.onSuccess(both))
    expect(screen.getByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')).toBeTruthy()
  })

  it('no offer when nothing about the default changed', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    const same = outcome()
    same.newDefaults = new Map([['wd-1', same.result.workouts[0].oldExercises]])
    confirmAndAnswer((o) => o.onSuccess(same))
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
  })

  // The screen-layer record test (CONTEXT: every new edit type extends applyAhead.ts, its tests AND a
  // screen-layer record test): APPLY hands the apply-ahead mutation the records of old default → new
  // default, per workout, with the later sessions — not records built from a screen edit.
  it('APPLY hands over the records of the old default → new default, per workout, and the later planned sessions', () => {
    useWeekdayRun('stable', [plan(3), plan(4), plan(5)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome()))
    expect(applyAheadMutate).not.toHaveBeenCalled() // the offer is made, never applied by itself
    fireEvent.click(screen.getByText('APPLY'))
    expect(applyAheadMutate).toHaveBeenCalledTimes(1)
    const sent = applyAheadMutate.mock.calls[0][0] as { changes: ChangeRecord[]; weeks: WeekPlan[]; groups: AheadGroup[] }
    expect(sent.weeks.map((w) => w.id)).toEqual(['wp-wd-1-4', 'wp-wd-1-5'])
    expect(sent.groups).toHaveLength(1)
    expect(sent.groups[0].workoutDayId).toBe('wd-1')
    expect(sent.groups[0].changes).toEqual([
      {
        editType: 'repTarget',
        slotId: 'pe-wd-1',
        exerciseId: 'ex-a',
        setPosition: { headOrdinal: 1, stageIndex: null },
        oldValue: { repMin: 8, repMax: 10, isAmrap: false },
        newValue: { repMin: 6, repMax: 8, isAmrap: false },
        defaultSet: { programSetId: 'ps-wd-1' },
      },
      {
        editType: 'addExercise',
        workoutDayId: 'wd-1',
        exerciseId: 'ex-joined',
        defaultRow: {
          programExerciseId: 'pe-joined',
          position: 1,
          sets: [{ programSetId: 'ps-joined', programExerciseId: 'pe-joined', position: 1, isWarmup: false, stageKind: null, repMin: 12, repMax: 15, isAmrap: false, stageIndex: 0, stages: [] }],
        },
      },
    ])
    expect(sent.changes).toEqual(sent.groups[0].changes)
  })

  it('a skipped workout (deload or empty everywhere this week) is told in the toast', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    const withSkipped = outcome()
    withSkipped.result.skipped = [{ workoutDayId: 'wd-2', reason: 'deload' }]
    confirmAndAnswer((o) => o.onSuccess(withSkipped))
    expect(useToastStore.getState().message).toBe('Week 3 is now the default. Deload or empty sessions kept the current default.')
  })

  it('the default is written even when the new default could not be read: the toast says the offer could not be made, and there is none', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome({ newDefaults: null })))
    expect(useToastStore.getState().message).toBe('Week 3 is now the default. Planned weeks ahead could not be offered the change.')
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
  })

  it('...and without later weeks that is not worth a word', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome({ newDefaults: null })))
    expect(useToastStore.getState().message).toBe('Week 3 is now the default.')
  })

  it('moving to another week clears a pending offer: it was made for the week it was made on', () => {
    useWeekdayRun('stable', [plan(3), plan(4), plan(5)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome()))
    expect(screen.getByText('APPLY THIS CHANGE TO 2 PLANNED WEEKS AHEAD?')).toBeTruthy()
    nextWeek()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
  })

  it('an offer can be dismissed and then applies nothing', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(outcome()))
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(applyAheadMutate).not.toHaveBeenCalled()
  })
})

// ─── A swap is told from the week on screen, read before the call ────────────

// The old default's one exercise (pe-wd-1) is gone from the new default, and one at the same place
// (pe-new) is in. Whether that is a SWAP or a removal and an addition is not in the function's answer: it
// is in what the source week's rows named before the call, which the call erases (it points every planned
// set of that week at the program set it ends up on). A swapped-in row's sets keep naming the replaced
// row's program sets; an exercise added by hand names none.
describe('PlanPage — offered ahead as a swap only when the week on screen showed one', () => {
  function replacedOutcome(): MakeWeekDefaultOutcome {
    const oldExercises = [defaultExercise('pe-wd-1', 0, [setDefaultSet('ps-wd-1', { repMin: 8, repMax: 10 })])]
    return {
      result: { mesocycleId: 'meso-1', weekNumber: 3, skipped: [], workouts: [{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-wd-1-3', sourceSequencePosition: null, oldExercises }] },
      newDefaults: new Map([['wd-1', [{ id: 'pe-new', exerciseId: 'ex-new', position: 0, sets: [setDefaultSet('ps-new', { repMin: 8, repMax: 10 })] }]]]),
    }
  }
  // Source week 3 as Plan holds it: the row at the replaced row's place, its one set naming `programSetId`.
  function sourceWeek(programSetId: string | null): WeekPlan {
    const row: ProgramExercise = { id: 'pe-new', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-new', position: 0, weightUnit: null }
    const planned: WeekPlanSet = { id: 's-new-3', weekPlanId: 'wp-wd-1-3', userId: 'user-1', programExerciseId: 'pe-new', setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId }
    return plan(3, { exercises: [row], sets: [planned] })
  }
  const changesOfferedOnApply = () => {
    fireEvent.click(screen.getByText('APPLY'))
    return (applyAheadMutate.mock.calls[0][0] as { groups: AheadGroup[] }).groups[0].changes
  }

  // Break: pair a removed and an added row at the same place as a swap, evidence or not -> the second case
  // offers a swap too, and fails.
  it('the row\'s sets named the replaced row\'s program set: one swap record', () => {
    useWeekdayRun('stable', [sourceWeek('ps-wd-1'), plan(4)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(replacedOutcome()))
    expect(changesOfferedOnApply().map((c: ChangeRecord) => c.editType)).toEqual(['swapExercise'])
  })

  it('the row\'s set named nothing (an exercise added by hand where the removed one was): a removal and an addition, never a swap', () => {
    useWeekdayRun('stable', [sourceWeek(null), plan(4)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(replacedOutcome()))
    expect(changesOfferedOnApply().map((c: ChangeRecord) => c.editType)).toEqual(['removeExercise', 'addExercise'])
  })

  it('the evidence is what was on screen when the confirm was tapped: the refetch after the call (its sets now name the new program set) does not erase it', () => {
    useWeekdayRun('stable', [sourceWeek('ps-wd-1'), plan(4)])
    const { rerender } = renderPlanPage()
    fireEvent.click(screen.getByText(ACTION))
    fireEvent.click(screen.getByText('MAKE DEFAULT'))
    // The call has pointed the source week's sets at the program sets they ended up on, and the page re-read them.
    plans = [sourceWeek('ps-new'), plan(4)]
    rerender(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    act(() => (makeMutate.mock.calls[0][2] as MutateOptions).onSuccess(replacedOutcome()))
    expect(changesOfferedOnApply().map((c: ChangeRecord) => c.editType)).toEqual(['swapExercise'])
  })
})

describe('PlanPage — when the call fails', () => {
  it('shows the error as a toast, closes the confirm, offers nothing and touches nothing', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onError(new Error('v2_make_week_default: mesocycle m is not a stable run (planning type week_dependent)')))
    expect(useToastStore.getState().message).toBe('v2_make_week_default: mesocycle m is not a stable run (planning type week_dependent)')
    // The dialog is gone (its overlay would hide the toast), the screen is as it was, there is no offer.
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(screen.getByText(ACTION)).toBeTruthy()
    // Nothing was written from here: no apply-ahead, no set edit.
    expect(applyAheadMutate).not.toHaveBeenCalled()
    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(makeMutate).toHaveBeenCalledTimes(1)
  })

  // What the real client throws: supabase-js answers a refused RPC with the parsed error body, a plain
  // object that is not an Error, and the service throws it as it came (seen in a real browser: the toast
  // then reads the fixed copy, the same as the app's other RPC toasts). It still says something, and the
  // screen is as it was.
  it('an error that is not an Error (a PostgREST error body) says the fixed copy', () => {
    useWeekdayRun('stable', [plan(3), plan(4)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onError({ code: 'P0001', details: null, hint: null, message: 'v2_make_week_default: week 3 of mesocycle m is not planned' }))
    expect(useToastStore.getState().message).toBe('Could not make this week the default')
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(applyAheadMutate).not.toHaveBeenCalled()
  })

  it('...and a plain string too', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onError('boom'))
    expect(useToastStore.getState().message).toBe('Could not make this week the default')
  })
})
