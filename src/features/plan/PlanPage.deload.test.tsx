// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import type { DeloadRules } from '../../lib/deloadRules'
import { openWeekMenu, openWeekTile } from './planMenus.testutil'

// Chunk 21 (SPEC "Deload" / TASKS.md "Deload is a property of a session") —
// the Plan screen's own marking UI (since chunk 52 the week-level action is in WEEK ⋯'s sheet, board 1e: every test below opens
// it first): the week-level "MARK WEEK AS DELOAD" /
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
// mutation, ids/week numbers/rules object included) and adds the "already
// started" notice; chunk 48 makes the rules the Settings rules and nothing
// else (a program that stored an override is not read: the call-site tests
// below give it one and assert Settings' reach the mutation).
// PlanPage.tsx reads the Settings rules via useSettingsStore
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

function makeProgram(schedule: Program['schedule'] = { ...EMPTY_SCHEDULE, monday: 'wd-1' }): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent',
  }
}

// A run whose program STORED a deload-rules override of its own, as an older version
// left it in v2_programs.deload_rules. The Program type has no such field any more
// (chunk 48: SPEC Deload [1.2], "programs have no override"), so it rides along outside
// the type, the way a stale row or a regression would carry it: nothing may read it.
function withStoredOverride(program: Program, override: DeloadRules): Program {
  return Object.assign(program, { deloadRules: override })
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
// Chunk 52 (board 1e): what the sheet draws while a mark is out (MARKING…, UNMARKING…) and when it failed ("Couldn't mark the week."
// and the real reason) is the hook's own state, so the stand-in carries it and a test sets it.
const weekDeloadHook: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null }
const useSetWeekDeloadSpy = vi.fn((_mesoId: string, _weekNumber: number) => ({ mutate: setWeekDeloadMutate, ...weekDeloadHook }))

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [mockState.meso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.workoutDays, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../library/useExercises', () => ({
  useExercises: () => ({ data: [] }),
}))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: (mesoId: string, weekNumber: number) => useSetWeekDeloadSpy(mesoId, weekNumber),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
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
  Object.assign(weekDeloadHook, { isPending: false, isError: false, error: null })
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

    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull() // not on the page: it is in WEEK ⋯
    openWeekMenu()
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
    openWeekMenu()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate, 0)).toEqual({ isDeload: true, rules: null })
    cleanup()

    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true })]
    renderPlanPage()
    openWeekMenu()
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

    openWeekMenu()
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

    openWeekMenu()
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
    expect(screen.getByLabelText('Week 4 options')).toBeTruthy()

    openWeekTile('WEEK 1') // week 1 — now past (1 < 4)

    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByLabelText(/^Week \d+ options$/)).toBeNull() // no WEEK ⋯: nothing to mark
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(screen.queryByText('UNMARK THIS WEEK')).toBeNull()
  })

  it('is hidden when nothing is scheduled (nothing to mark)', () => {
    mockState.program = makeProgram(EMPTY_SCHEDULE)
    mockState.workoutDays = []
    mockState.plans = []
    renderPlanPage()

    expect(screen.queryByLabelText(/^Week \d+ options$/)).toBeNull()
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(screen.queryByText('UNMARK THIS WEEK')).toBeNull()
  })

  // Chunk 22 — "the screen-layer argument assertions from Lessons":
  // the exact rules OBJECT handed to the mutation, not just that one was
  // passed.
  it('passes the Settings rules as `rules`', () => {
    const settingsRules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: settingsRules })
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' })
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    openWeekMenu()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: settingsRules })
  })

  // Chunk 48 — "Deload rules are read from Settings and nowhere else" (SPEC Deload [1.2], 16b;
  // before it, chunk 22's "a program override wins over the global rules"). Two DIFFERENT
  // rules objects in play, the stored override and Settings': only Settings' reaches the
  // mutation, and nothing says an override was set aside ("falls back to Settings silently").
  it('a run whose program stored an override still marks with the Settings rules', () => {
    const settingsRules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }
    const storedOverride: DeloadRules = { weight: { percent: 80, rounding: 'up', step: 5, stepUnit: 'kg' } }
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: settingsRules })
    mockState.program = withStoredOverride(makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }), storedOverride)
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    openWeekMenu()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: settingsRules })
    expect(screen.queryByText(/deload.*override|override.*deload/i)).toBeNull() // silent: no notice that one was set aside
  })

  it('with no rules in Settings the stored override is not a fallback either: marking is flag-only (rules null)', () => {
    const storedOverride: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }
    mockState.program = withStoredOverride(makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }), storedOverride)
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    openWeekMenu()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(firstArg(setWeekDeloadMutate)).toEqual({ isDeload: true, rules: null })
  })

  // Chunk 22, reviewer's note 5 — "Default: flag-only plus a one-line
  // notice... say what you did." The mock's own mutate() invokes the
  // caller's onSuccess, exactly as the real TanStack Query mutation would
  // once the (mocked, in this file) executor resolves.
  it('shows the "already started" notice when the week-level mark/unmark outcome says so', () => {
    setWeekDeloadMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ anyAlreadyStarted: true }))
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()

    openWeekMenu()
    expect(screen.queryByText('Already started — sets left as they are')).toBeNull()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD'))
    expect(screen.getByText('Already started — sets left as they are')).toBeTruthy()
  })
})

describe('PlanPage — WEEK ⋯ while a mark is out, and when it failed (chunk 52, board 1e)', () => {
  const wordsOf = () => screen.getByRole('dialog')

  it('the sheet is "[PROGRAM] / Week 1": the run\'s name over the week\'s title, with the one action', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    openWeekMenu()
    expect(screen.getByRole('dialog', { name: 'Week 1' })).toBeTruthy()
    expect(within(wordsOf()).getByText('Test Meso')).toBeTruthy()
    expect(within(wordsOf()).getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expect(within(wordsOf()).queryByText('DELOAD')).toBeNull() // the chip is for a marked week
  })

  it('a marked week says UNMARK THIS WEEK with the DELOAD chip', () => {
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true })]
    renderPlanPage()
    openWeekMenu()
    expect(within(wordsOf()).getByText('UNMARK THIS WEEK')).toBeTruthy()
    expect(within(wordsOf()).getByText('DELOAD')).toBeTruthy()
  })

  it('while the mark is out the row says MARKING… and is disabled: a press calls nothing more', () => {
    weekDeloadHook.isPending = true
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    openWeekMenu()
    const button = within(wordsOf()).getByText('MARKING…').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.style.color).toBe('var(--text-muted)') // board 1e: the row is muted while it works
    fireEvent.click(button)
    expect(setWeekDeloadMutate).not.toHaveBeenCalled()
    expect(within(wordsOf()).queryByText('MARK WEEK AS DELOAD')).toBeNull()
  })

  it('while the unmark is out it says UNMARKING… (a marked week), without the chip', () => {
    weekDeloadHook.isPending = true
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true })]
    renderPlanPage()
    openWeekMenu()
    expect(within(wordsOf()).getByText('UNMARKING…')).toBeTruthy()
    expect((within(wordsOf()).getByText('UNMARKING…').closest('button') as HTMLButtonElement).style.color).toBe('var(--text-muted)')
    expect(within(wordsOf()).queryByText('DELOAD')).toBeNull()
  })

  it('a failed mark: "Couldn\'t mark the week." and the real reason (a server message, verbatim), the row still MARK so it can be tried again', () => {
    weekDeloadHook.isError = true
    weekDeloadHook.error = { message: 'row-level security: v2_week_plans refused the update', code: '42501' }
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    openWeekMenu()
    expect(within(wordsOf()).getByText("Couldn't mark the week.")).toBeTruthy()
    expect(within(wordsOf()).getByText('row-level security: v2_week_plans refused the update')).toBeTruthy()
    expect((within(wordsOf()).getByText('MARK WEEK AS DELOAD').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a failed unmark says "unmark", not "mark" (the week is still marked)', () => {
    weekDeloadHook.isError = true
    weekDeloadHook.error = new Error('network down')
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: true })]
    renderPlanPage()
    openWeekMenu()
    expect(within(wordsOf()).getByText("Couldn't unmark the week.")).toBeTruthy()
    expect(within(wordsOf()).getByText('network down')).toBeTruthy()
    expect(within(wordsOf()).queryByText("Couldn't mark the week.")).toBeNull()
  })

  it('a failure with no message: "Something went wrong."', () => {
    weekDeloadHook.isError = true
    weekDeloadHook.error = {}
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    openWeekMenu()
    expect(within(wordsOf()).getByText('Something went wrong.')).toBeTruthy()
  })

  it('a failure with no message while the phone is offline: "You may be offline."; with a message, offline too, the message wins', () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      weekDeloadHook.isError = true
      weekDeloadHook.error = {}
      mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
      const first = renderPlanPage()
      openWeekMenu()
      expect(within(wordsOf()).getByText('You may be offline.')).toBeTruthy()
      expect(within(wordsOf()).queryByText('Something went wrong.')).toBeNull()
      first.unmount()

      weekDeloadHook.error = { message: 'Failed to fetch' }
      renderPlanPage()
      openWeekMenu()
      expect(within(wordsOf()).getByText('Failed to fetch')).toBeTruthy()
      expect(within(wordsOf()).queryByText('You may be offline.')).toBeNull()
    } finally {
      onLine.mockRestore()
    }
  })

  it('a new attempt clears the "already started" notice before it asks again: the second ask is still out, and the first one\'s notice is gone', () => {
    setWeekDeloadMutate.mockImplementationOnce((_vars, opts) => opts?.onSuccess?.({ anyAlreadyStarted: true }))
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    openWeekMenu()
    fireEvent.click(within(wordsOf()).getByText('MARK WEEK AS DELOAD'))
    expect(within(wordsOf()).getByText('Already started — sets left as they are')).toBeTruthy()
    fireEvent.click(within(wordsOf()).getByText('MARK WEEK AS DELOAD')) // the second mutation does not answer (no onSuccess)
    expect(setWeekDeloadMutate).toHaveBeenCalledTimes(2)
    expect(within(wordsOf()).queryByText('Already started — sets left as they are')).toBeNull()
  })

  it('the sheet closes with ×, and opened again it shows no notice from before', () => {
    setWeekDeloadMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ anyAlreadyStarted: true }))
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false })]
    renderPlanPage()
    openWeekMenu()
    fireEvent.click(within(wordsOf()).getByText('MARK WEEK AS DELOAD'))
    expect(within(wordsOf()).getByText('Already started — sets left as they are')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    openWeekMenu() // opened again: no stale notice
    expect(screen.queryByText('Already started — sets left as they are')).toBeNull()
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

  // Chunk 22, chunk 48 — the per-session toggle passes the SAME Settings rules as the
  // week-level action above (a stored override on the program is not read here either).
  it('a run whose program stored an override marks a session with the Settings rules too', () => {
    const settingsRules: DeloadRules = { reps: { delta: -2 } }
    const storedOverride: DeloadRules = { rir: { delta: 1 } }
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: settingsRules })
    mockState.program = withStoredOverride(makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }), storedOverride)
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false, id: 'wp-session' })]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(firstArg(setDeloadMutate)).toEqual({ weekPlanId: 'wp-session', isDeload: true, rules: settingsRules })
  })

  it('... and with no rules in Settings the session is marked flag-only (rules null), whatever the program stored', () => {
    mockState.program = withStoredOverride(makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1' }), { rir: { delta: 1 } })
    mockState.plans = [makePlan(1, 'wd-1', pe1, { isDeload: false, id: 'wp-session' })]
    renderPlanPage()

    fireEvent.click(screen.getByLabelText('Mark this session as deload'))
    expect(firstArg(setDeloadMutate)).toEqual({ weekPlanId: 'wp-session', isDeload: true, rules: null })
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
