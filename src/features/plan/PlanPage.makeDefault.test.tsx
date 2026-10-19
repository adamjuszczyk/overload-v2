// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise, SequenceItem, Session } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { MakeDefaultResult } from './makeWeekDefault'
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
//   - after it: a toast, and nothing else. There is NO "Apply this change to planned weeks
//     ahead" offer (taken out of this chunk after review), and nothing is written to any
//     week, however many later weeks are planned (absence tests, Checks that lied #32); an
//     error of the call is a toast, nothing else.

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
const makeIsPending = { value: false }
// Every write the Plan screen can make to a week goes through one of the hooks mocked below; each
// is recorded here by name, so a test can say that none was called.
const writes: string[] = []
const record = (name: string) => (..._args: unknown[]) => {
  writes.push(name)
}

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
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: plans.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: record('useApplyAhead'), isPending: false }),
  // Not recorded: the page itself plans the week it opens (v2_plan_week leaves rows that exist as they are),
  // whenever a week is viewed, with or without this action.
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: record('useSetDeload') }),
  useSetWeekDeload: () => ({ mutate: record('useSetWeekDeload'), isPending: false }),
  useAddSet: () => ({ mutate: record('useAddSet'), isPending: false }),
  useAddStage: () => ({ mutate: record('useAddStage') }),
  useAddWarmupSet: () => ({ mutate: record('useAddWarmupSet'), isPending: false }),
  useUpdateSet: () => ({ mutate: record('useUpdateSet') }),
  useRemoveSet: () => ({ mutate: record('useRemoveSet'), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: record('useCopyFromPreviousWeek'), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: record('useCopyWorkoutFromPreviousWeek'), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: record('useSwapWeekExercise'), isPending: false }),
  useAddWeekExercise: () => ({ mutate: record('useAddWeekExercise'), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: record('useRemoveWeekExercise'), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: record('useReorderWeekExercises'), isPending: false }),
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
  writes.length = 0
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

// ─── What follows: the toast, and nothing else ───────────────────────────────

// What the hook hands over (useMakeWeekDefault.ts): the function's answer.
const answer = (skipped: MakeDefaultResult['skipped'] = []): MakeDefaultResult => ({ mesocycleId: 'meso-1', weekNumber: 3, skipped })

type MutateOptions = { onSuccess: (result: MakeDefaultResult) => void; onError: (e: unknown) => void }

function confirmAndAnswer(reply: (options: MutateOptions) => void) {
  fireEvent.click(screen.getByText(ACTION))
  fireEvent.click(screen.getByText('MAKE DEFAULT'))
  act(() => reply(makeMutate.mock.calls[0][2] as MutateOptions))
}

describe('PlanPage — after "Make this week the new default"', () => {
  it('says what happened and closes the confirm', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(answer()))
    expect(useToastStore.getState().message).toBe('Week 3 is now the default.')
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
  })

  it('a workout that kept the current default (deload or empty everywhere this week) is told in the toast', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onSuccess(answer([{ workoutDayId: 'wd-2', reason: 'deload' }])))
    expect(useToastStore.getState().message).toBe('Week 3 is now the default. Deload or empty sessions kept the current default.')
  })

  // ABSENCE. Chunk 32 ships without the apply-ahead offer: the weeks planned after the one made the
  // default keep exactly what they have. Break: show the offer again (the banner, a hand-over to
  // apply-ahead, or any write to a week) after a success -> this fails.
  it('offers nothing for the weeks planned after it, hands nothing to apply-ahead, and writes to no week', () => {
    for (const reply of [answer(), answer([{ workoutDayId: 'wd-2', reason: 'deload' }])]) {
      useWeekdayRun('stable', [plan(3), plan(3, { workoutDayId: 'wd-2' }), plan(4), plan(4, { workoutDayId: 'wd-2' }), plan(5), plan(6, { isDeload: true })])
      const view = renderPlanPage()
      writes.length = 0 // whatever the screen did to mount is not what is asked about
      makeMutate.mockReset()
      confirmAndAnswer((o) => o.onSuccess(reply))
      expect(makeMutate).toHaveBeenCalledTimes(1)
      expect(useToastStore.getState().message).toContain('Week 3 is now the default.')
      expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
      expect(screen.queryByText('APPLY')).toBeNull()
      expect(screen.queryByLabelText('Dismiss')).toBeNull()
      expect(writes).toEqual([])
      view.unmount()
    }
  })

  it('...and a later week looked at afterwards shows no offer either', () => {
    useWeekdayRun('stable', [plan(3), plan(4), plan(5)])
    renderPlanPage()
    writes.length = 0
    confirmAndAnswer((o) => o.onSuccess(answer()))
    nextWeek()
    expect(screen.getByText('WEEK 4')).toBeTruthy()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(writes).toEqual([])
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
    // Nothing was written from here: no apply-ahead, no set edit, no week touched.
    expect(writes).toEqual([])
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
    expect(writes).toEqual([])
  })

  it('...and a plain string too', () => {
    useWeekdayRun('stable', [plan(3)])
    renderPlanPage()
    confirmAndAnswer((o) => o.onError('boom'))
    expect(useToastStore.getState().message).toBe('Could not make this week the default')
  })
})
