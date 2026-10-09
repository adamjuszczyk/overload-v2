// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import type { DeloadRules } from '../../lib/deloadRules'

// Chunk 21 (SPEC "Deload" / TASKS.md "Deload is a property of a session") —
// the Plan screen's own marking UI: the week-level "MARK WEEK AS DELOAD" /
// "UNMARK THIS WEEK" action, the per-session toggle (unchanged mechanics,
// proven still independent of the week-level one), and the shared-row note
// (G14). Renders the real PlanPage/WorkoutDayPanel tree; only the data hooks
// are mocked (same seam as every other PlanPage test file) — this file
// proves the WIRING (right control -> right hook call with the right args),
// not the server-side row-set itself (every row of the week vs. just one),
// which is a property of the WHERE clause `setWeekDeload` sends, not
// anything a client-side mock could meaningfully stand in for — see the
// chunk's report for the scratch-Postgres proof of that.
//
// A SEPARATE file, PlanPage.deload.applyAhead.test.tsx, proves chunk 20
// reads a session marked here (the same is_deload) through the REAL
// useApplyAhead/applyAhead.ts pipeline — this file mocks `./useWeekPlan`
// entirely, which that one specifically does not.
//
// Chunk 22 extends every mutate-arg assertion below for the new `rules`
// field (the screen-resolved effective rules — "Lessons": a screen-layer
// test asserting the exact arguments the UI hands to each hook or
// mutation, ids/week numbers/rules object included) and adds: the program
// override winning over the global default, and the "already started"
// notice. PlanPage.tsx reads the global default via useSettingsStore
// directly (not useSettings' own query — no QueryClientProvider wraps this
// render, same as every other PlanPage test file), so this file drives
// that real Zustand singleton directly and resets it afterward.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(new Date(), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

const workoutDay1: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const workoutDay2: WorkoutDay = { id: 'wd-2', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }

const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null, exercise: EX_A }
const pe2: ProgramExercise = { id: 'pe-2', workoutDayId: 'wd-2', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null, exercise: EX_A }

function makeProgram(schedule: Program['schedule'] = { ...EMPTY_SCHEDULE, monday: 'wd-1' }, deloadRules: DeloadRules | null = null): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent', deloadRules,
  }
}

function makePlan(weekNumber: number, workoutDayId: string, pe: ProgramExercise, opts: { isDeload?: boolean; id?: string } = {}): WeekPlan {
  return {
    id: opts.id ?? `wp-${weekNumber}-${workoutDayId}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId,
    weekNumber, isDeload: opts.isDeload ?? false, notes: null, sets: [], exercises: [pe], createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { plans: WeekPlan[]; program: Program; workoutDays: WorkoutDay[]; meso: Mesocycle } = {
  plans: [],
  program: makeProgram(),
  workoutDays: [workoutDay1],
  meso: activeMeso,
}

const setWeekDeloadMutate = vi.fn()
const setDeloadMutate = vi.fn()
// Review fix — the first review found that every PlanPage test mocked
// useSetWeekDeload as a plain `() => ({ mutate, isPending })`, discarding
// its own (mesoId, weekNumber) arguments entirely: a break that changed
// PlanPage.tsx's own call site to `useSetWeekDeload(mesoId, viewWeek + 1)`
// (marking the FOLLOWING week instead of the viewed one) left the whole
// suite green, because nothing ever inspected what this factory was
// CALLED WITH, only what its returned `mutate` was called with. Wrapping
// it in a spy closes that gap — see the "created with the viewed week's
// own (mesoId, weekNumber)" test below.
const useSetWeekDeloadSpy = vi.fn((_mesoId: string, _weekNumber: number) => ({ mutate: setWeekDeloadMutate, isPending: false }))

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [mockState.meso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.workoutDays, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({
  useExercises: () => ({ data: [] }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: (mesoId: string, weekNumber: number) => useSetWeekDeloadSpy(mesoId, weekNumber),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
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

// First arg of a mutate() call — ignores the second (TanStack's own
// per-call { onSuccess } options object, chunk 22's own addition for the
// "already started" notice), which every assertion below is about the
// hook/mutation's own payload, not that plumbing.
function firstArg(mock: ReturnType<typeof vi.fn>, callIndex = 0) {
  return mock.mock.calls[callIndex]?.[0]
}

afterEach(() => {
  setWeekDeloadMutate.mockReset()
  setDeloadMutate.mockReset()
  useSetWeekDeloadSpy.mockClear()
  mockState.program = makeProgram()
  mockState.workoutDays = [workoutDay1]
  mockState.meso = activeMeso
  // useSettingsStore is a real, module-level Zustand singleton — reset it
  // so no test's own global-default fixture leaks into the next (same
  // "module-level singleton" discipline useWeekPlan.test.tsx's own
  // queryClient.clear() already documents).
  useSettingsStore.setState(DEFAULT_SETTINGS)
})

describe('PlanPage — "Mark this week as deload" / "Unmark this week" (chunk 21, SPEC "Deload")', () => {
  // Review fix — proves the wiring the mutate-args checks below cannot:
  // which week the hook itself was built for. meso-1 starts TODAY, so
  // computeWeekNumber lands viewWeek on 1 with no week-switcher click
  // needed; the broken `viewWeek + 1` call site would show up here as
  // ('meso-1', 2), never ('meso-1', 1).
  it('creates useSetWeekDeload with the viewed meso and week number, not a neighboring week', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    expect(useSetWeekDeloadSpy).toHaveBeenCalledWith('meso-1', 1)
    expect(useSetWeekDeloadSpy).not.toHaveBeenCalledWith('meso-1', 2)
  })

  it('shows MARK WEEK AS DELOAD when the week is not fully deload, and marks it on click — with no rules configured, rules is null', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expect(screen.queryByText('UNMARK THIS WEEK')).toBeNull()

    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: null })
  })

  // Review fix — "clicking MARK then UNMARK calls mutate with
  // {isDeload: true} then {isDeload: false}", both through the SAME
  // (mesoId, weekNumber)-scoped hook instance (re-rendered here with the
  // week now fully deload, as a real refetch after MARK would leave it).
  it('MARK then (once the week reads fully deload) UNMARK both go through the one hook built for this week', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate, 0)).toEqual({ isDeload: true, rules: null })
    cleanup()

    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true })]
    renderPlanPage()
    fireEvent.click(screen.getByText('UNMARK THIS WEEK'))
    expect(firstArg(setWeekDeloadMutate, 1)).toEqual({ isDeload: false, rules: null })

    // Every call to the factory itself, across both renders, was for THIS
    // one week — never a neighbor.
    for (const call of useSetWeekDeloadSpy.mock.calls) {
      expect(call).toEqual(['meso-1', 1])
    }
  })

  it('reads UNMARK THIS WEEK once every planned row of the week is already deload, and clears on click', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true })]
    renderPlanPage()

    expect(screen.getByText('UNMARK THIS WEEK')).toBeTruthy()
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()

    fireEvent.click(screen.getByText('UNMARK THIS WEEK'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: false, rules: null })
  })

  it('still reads MARK (not UNMARK) when only some of the week\'s planned rows are deload', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1', tuesday: 'wd-2' })
    mockState.workoutDays = [workoutDay1, workoutDay2]
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true }), makePlan(1, 'wd-2', pe2, { isDeload: false })]
    renderPlanPage()

    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    // Completing the job marks every row true, including the one already true.
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: null })
  })

  it('is hidden once the viewed week is stepped into the past (same read-only rule as every other week action)', () => {
    mockState.meso = { ...activeMeso, startDate: format(subDays(new Date(), 21), 'yyyy-MM-dd') }
    mockState.plans = [makePlan(1, 'wd-1', pe1), makePlan(4, 'wd-1', pe1, { id: 'wp-4-wd-1' })]
    renderPlanPage()

    expect(screen.getByText('WEEK 4')).toBeTruthy() // sanity: mounted on the current week
    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Previous week'))
    fireEvent.click(screen.getByLabelText('Previous week'))
    fireEvent.click(screen.getByLabelText('Previous week')) // week 1 — now past (1 < 4)

    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(screen.queryByText('UNMARK THIS WEEK')).toBeNull()
  })

  it('is hidden when nothing is scheduled (nothing to mark)', () => {
    mockState.program = makeProgram(EMPTY_SCHEDULE)
    mockState.workoutDays = []
    mockState.plans = []
    renderPlanPage()

    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(screen.queryByText('UNMARK THIS WEEK')).toBeNull()
  })

  // Chunk 22 — "the screen-layer argument assertions from Lessons":
  // the exact rules OBJECT handed to the mutation, not just that one was
  // passed.
  it('passes the global default as `rules` when the program has no override', () => {
    const globalRules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: globalRules })
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }, null)
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: globalRules })
  })

  // Chunk 22 — "a program override wins over the global rules" (TASKS.md
  // verbatim). Two DIFFERENT rules objects in play; only the program's own
  // must reach the mutation.
  it('a program override wins over the global default rules', () => {
    const globalRules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }
    const programOverride: DeloadRules = { weight: { percent: 80, rounding: 'up', step: 5, stepUnit: 'kg' } }
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: globalRules })
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }, programOverride)
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: programOverride })
  })

  // Chunk 22, reviewer's note 5 — "Default: flag-only plus a one-line
  // notice... say what you did." The mock's own mutate() invokes the
  // caller's onSuccess, exactly as the real TanStack Query mutation would
  // once the (mocked, in this file) executor resolves.
  it('shows the "already started" notice when the week-level mark/unmark outcome says so', () => {
    setWeekDeloadMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ anyAlreadyStarted: true }))
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    expect(screen.queryByText('Already started — sets left as they are')).toBeNull()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(screen.getByText('Already started — sets left as they are')).toBeTruthy()
  })
})

describe('PlanPage — the per-session toggle still marks only that session (chunk 21 keeps it unchanged)', () => {
  it('clicking the per-session DELOAD toggle calls useSetDeload, independent of the week-level action', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false, id: 'wp-session' })]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(firstArg(setDeloadMutate)).toEqual({ weekPlanId: 'wp-session', isDeload: true, rules: null })
    expect(setWeekDeloadMutate).not.toHaveBeenCalled()
  })

  it('reads "Unmark this session as deload" once that one session is marked', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true, id: 'wp-session' })]
    renderPlanPage()

    expect(screen.getByLabelText('Unmark this session as deload')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Unmark this session as deload'))
    expect(firstArg(setDeloadMutate)).toEqual({ weekPlanId: 'wp-session', isDeload: false, rules: null })
  })

  // Review fix — "the per-session DELOAD toggle: its mutation receives
  // that session's own weekPlanId, not a sibling's." Two scheduled
  // workouts, each with its OWN plan row id; switching the workout
  // switcher must swap which row the toggle targets.
  it('targets the SELECTED workout\'s own row, never the sibling workout\'s, when switching between them', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1', tuesday: 'wd-2' })
    mockState.workoutDays = [workoutDay1, workoutDay2]
    mockState.plans = [
      makePlan(1, 'wd-1', pe1, { isDeload: false, id: 'wp-push' }),
      makePlan(1, 'wd-2', pe2, { isDeload: false, id: 'wp-pull' }),
    ]
    renderPlanPage()

    // Mounts on the first scheduled day (Monday / Push Day).
    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(firstArg(setDeloadMutate, 0)).toEqual({ weekPlanId: 'wp-push', isDeload: true, rules: null })

    fireEvent.click(screen.getByText('TUE'))
    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(firstArg(setDeloadMutate, 1)).toEqual({ weekPlanId: 'wp-pull', isDeload: true, rules: null })
  })

  // Chunk 22 — the per-session toggle resolves and passes the SAME
  // effective-rules precedence as the week-level action above.
  it('a program override wins over the global default for the per-session toggle too', () => {
    const globalRules: DeloadRules = { reps: { delta: -2 } }
    const programOverride: DeloadRules = { rir: { delta: 1 } }
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: globalRules })
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }, programOverride)
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false, id: 'wp-session' })]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(firstArg(setDeloadMutate)).toEqual({ weekPlanId: 'wp-session', isDeload: true, rules: programOverride })
  })

  it('shows the "already started" notice when the per-session outcome says so', () => {
    setDeloadMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.('alreadyStarted'))
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false, id: 'wp-session' })]
    renderPlanPage()

    expect(screen.queryByText('Already started — sets left as they are')).toBeNull()
    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(screen.getByText('Already started — sets left as they are')).toBeTruthy()
  })
})

// G14 (CONTEXT.md, Adam's second account, 2026-10-05) — one workout on
// several weekdays shares one plan row; marking it deload marks every day
// it covers, as every other week edit already does (chunk 20's own
// precedent). The note names the exact weekdays, shown where the mark is
// set (reviewer's note 2), and never appears for an un-shared workout.
describe('PlanPage — the shared-row note (chunk 21, G14)', () => {
  it('names every weekday a Mon-Fri shared workout covers', () => {
    mockState.program = makeProgram({
      ...EMPTY_SCHEDULE, monday: 'wd-1', tuesday: 'wd-1', wednesday: 'wd-1', thursday: 'wd-1', friday: 'wd-1',
    })
    mockState.plans = [makePlan(1, 'wd-1', pe1)]
    renderPlanPage()

    expect(screen.getByText('Marks Mon, Tue, Wed, Thu, Fri — they share one plan.')).toBeTruthy()
  })

  it('says nothing extra for a workout on only one weekday', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' })
    mockState.plans = [makePlan(1, 'wd-1', pe1)]
    renderPlanPage()

    expect(screen.queryByText(/they share one plan/)).toBeNull()
  })
})
