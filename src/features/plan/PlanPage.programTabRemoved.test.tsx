// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, SequenceItem, WeekPlan } from '../../types'
import type { DeloadRules } from '../../lib/deloadRules'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

// Chunk 33 (TASKS-1.1 "The program tab is removed"; SPEC Plan screen [P1.1]:
// "No program tab. It's removed; what it did happens in the week or is fixed for
// the run"; Empty states: "A run with no schedule (started before Start needed
// one) → a line linking to the Programs page"; SPEC Deload [P1.1]: "Plan shows
// the rules in effect, read-only, next to the deload action").
//
// Driven through the REAL PlanPage tree (the seam every PlanPage test uses: only
// the data hooks are mocked). Three things are proved here, each by what must be
// ABSENT as well as by what is there (Checks that lied #32):
//   - the page has no program tab, and none of the editors it held shows anywhere
//     in Plan (a running program's schedule, workouts and deload-rules override are
//     fixed for the run);
//   - a run with no schedule gets one line linking to the Programs page, for a
//     weekday run and a sequence run alike, and nothing of the old two;
//   - the deload rules in effect show read-only under the deload action: the Settings
//     rules as they are now ("from Settings", chunk 48: programs have no override, a
//     stored one is not read), nothing when no rule is on, and exactly the rules a
//     tap on the action hands to marking.

const START_DATE = format(new Date(), 'yyyy-MM-dd') // the viewed week is week 1, the current one

let activeMeso: Mesocycle
let program: Program
let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] = []
let weekPlans: WeekPlan[] = []
let daysLoading = false
const setWeekDeloadMutate = vi.fn()
const setDeloadMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: workoutDays, isLoading: daysLoading }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: sequenceItems, isLoading: false }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// A sequence run waits for its current cycle (three reads, chunk 35); the cycle is the subject of
// PlanPage.sequenceCycle.test.tsx, not of this file, so it is cycle 1 here.
vi.mock('./useSequenceCurrentCycle', () => ({
  useSequenceCurrentCycle: () => ({ cycle: 1, failed: false }),
}))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: weekPlans, isLoading: false }),
  useAllWeekPlans: () => ({ data: weekPlans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: setWeekDeloadMutate, isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  cleanup()
  setWeekDeloadMutate.mockClear()
  setDeloadMutate.mockClear()
  useSettingsStore.setState({ deloadRules: DEFAULT_SETTINGS.deloadRules })
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  activeMeso = {
    id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
    startDate: START_DATE, endDate: null, createdAt: '2026-01-01T00:00:00Z',
  }
  workoutDays = [WORKOUT_DAY]
  sequenceItems = []
  weekPlans = []
  daysLoading = false
  program = makeProgram()
  useSettingsStore.setState({ deloadRules: DEFAULT_SETTINGS.deloadRules })
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WORKOUT_DAY: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const MONDAY = { ...EMPTY_SCHEDULE, monday: 'wd-1' }

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: MONDAY, workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent', scheduleType: 'weekday',
    ...overrides,
  }
}
const sequenceProgram = (overrides: Partial<Program> = {}) => makeProgram({ scheduleType: 'sequence', schedule: EMPTY_SCHEDULE, ...overrides })
const slot = (position: number, workoutDayId: string | null): SequenceItem =>
  ({ id: `si-${position}`, userId: 'user-1', programId: 'prog-1', position, workoutDayId })

// A program that STORED a deload-rules override of its own, as an older version left it in
// v2_programs.deload_rules. The Program type has no such field any more (chunk 48), so it
// rides along outside the type, the way a stale row or a regression would carry it.
function withStoredOverride(program: Program, override: DeloadRules): Program {
  return Object.assign(program, { deloadRules: override })
}

const SETS_RULE = { mode: 'percent', value: 50, rounding: 'down' } as const
const WEIGHT_RULE = { percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' } as const
// What a program stored (never shown, never used) and what Settings holds (what Plan shows and marking applies).
const STORED_OVERRIDE: DeloadRules = { sets: SETS_RULE, weight: WEIGHT_RULE }
const SETTINGS_RULES: DeloadRules = { sets: { mode: 'count', value: 1, rounding: 'down' }, reps: { delta: -2 }, rir: { delta: 1 } }
const SETTINGS_RULES_TEXT = 'Deload rules (from Settings): sets −1 · reps −2 · RIR +1'
const anyRulesLine = () => screen.queryByText(/^Deload rules \(/)

function LocationProbe() {
  const location = useLocation()
  return <div>AT {location.pathname}</div>
}

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/program" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

// What the program tab held, by the words it showed (ProgramTab.tsx → StepExercises / StepVolume),
// none of which may show anywhere in Plan any more: the bar, the tab's two section heads and its
// read-only notice, the schedule-type toggle and the workout editors, the sequence editor, the
// PLANNING picker, and the deload-rules override chooser.
const PROGRAM_TAB_TEXT = [
  'PROGRAM', 'WEEKS', 'EXERCISES & SCHEDULE', 'VOLUME', 'VOLUME IS READ-ONLY HERE — EDIT IT IN A WEEK',
  'WEEKDAY', 'SEQUENCE', 'ADD WORKOUT', 'NO WORKOUTS YET', 'ADD SLOT', 'NO SLOTS YET',
  'PLANNING', 'STABLE', 'WEEK-DEPENDENT', 'DELOAD RULES', 'USE MY DEFAULT', 'CUSTOM',
]

// ─── No program tab ──────────────────────────────────────────────────────────

describe('PlanPage — there is no program tab (chunk 33)', () => {
  function expectNoProgramTab() {
    for (const text of PROGRAM_TAB_TEXT) expect(screen.queryByText(text)).toBeNull()
    // ... and nothing that could edit a running program's schedule, workouts or override.
    expect(screen.queryByLabelText(/^Delete /)).toBeNull()
    expect(screen.queryByPlaceholderText('e.g. Push Day')).toBeNull()
  }

  it('a weekday run: the page is there (week switcher, deload action, SETS / STRUCTURE), the tab and its editors are not', () => {
    program = makeProgram({ planningType: 'stable' })
    renderPlan()

    // The page rendered (the absences below are not vacuous).
    expect(screen.getByText('WEEK 1')).toBeTruthy()
    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expect(screen.getByText('SETS')).toBeTruthy()
    expect(screen.getByText('STRUCTURE')).toBeTruthy()
    expectNoProgramTab()
  })

  it('a week-dependent weekday run: the same', () => {
    program = makeProgram({ planningType: 'week_dependent' })
    renderPlan()

    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expectNoProgramTab()
  })

  it('a sequence run: the same', () => {
    program = sequenceProgram()
    sequenceItems = [slot(0, 'wd-1'), slot(1, null)]
    renderPlan()

    expect(screen.getByText('CYCLE 1')).toBeTruthy()
    expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
    expectNoProgramTab()
  })

  it('opening the STRUCTURE view does not bring a tab, or a schedule or workout editor, back either', () => {
    renderPlan()

    fireEvent.click(screen.getByText('STRUCTURE'))

    expect(screen.getByText('STRUCTURE').style.background).toBe('var(--accent)')
    expectNoProgramTab()
  })

  it('the header keeps the Programs link, now the only way to the schedule\'s page', () => {
    renderPlan()

    fireEvent.click(screen.getByLabelText('Programs'))

    expect(screen.getByText('AT /program')).toBeTruthy()
  })
})

// ─── A run with no schedule ──────────────────────────────────────────────────

describe('PlanPage — a run with no schedule shows one line linking to the Programs page (chunk 33)', () => {
  const LINE = 'NO WORKOUTS SCHEDULED'
  const LINK = 'Programs →'
  // The two states this line replaces, and their links into the tab.
  const OLD_TEXT = ['NO DAYS SCHEDULED', 'Set up weekly schedule →', 'NO SLOTS SCHEDULED', 'Set up the sequence →']

  function expectTheLine() {
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.getByText(LINK)).toBeTruthy()
    for (const text of OLD_TEXT) expect(screen.queryByText(text)).toBeNull()
    // Nothing of a scheduled run's week: no workout to switch to, no panel, no week actions.
    expect(screen.queryByText('SETS')).toBeNull()
    expect(screen.queryByText('STRUCTURE')).toBeNull()
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
  }

  function expectScheduled() {
    expect(screen.queryByText(LINE)).toBeNull()
    expect(screen.queryByText(LINK)).toBeNull()
    for (const text of OLD_TEXT) expect(screen.queryByText(text)).toBeNull()
    expect(screen.getByText('SETS')).toBeTruthy()
  }

  describe('a weekday run', () => {
    it('with no workout on any weekday: the line and its link; the old states are absent', () => {
      program = makeProgram({ schedule: EMPTY_SCHEDULE })
      renderPlan()

      expectTheLine()
    })

    it('its link opens the Programs page', () => {
      program = makeProgram({ schedule: EMPTY_SCHEDULE })
      renderPlan()

      fireEvent.click(screen.getByText(LINK))

      expect(screen.getByText('AT /program')).toBeTruthy()
    })

    it('a weekday that names a workout the program no longer has does not count as scheduled', () => {
      program = makeProgram({ schedule: { ...EMPTY_SCHEDULE, wednesday: 'wd-gone' } })
      renderPlan()

      expectTheLine()
    })

    it('with a workout on a weekday: no line, and the week is there', () => {
      program = makeProgram({ schedule: { ...EMPTY_SCHEDULE, friday: 'wd-1' } })
      renderPlan()

      expectScheduled()
    })

    it('a sequence left under a weekday run is not read: with no weekday it is still unscheduled', () => {
      program = makeProgram({ schedule: EMPTY_SCHEDULE })
      sequenceItems = [slot(0, 'wd-1')]
      renderPlan()

      expectTheLine()
    })

    it('while the workouts are still loading: no line yet (it must not flash on a run that has a schedule)', () => {
      program = makeProgram({ schedule: EMPTY_SCHEDULE })
      daysLoading = true
      renderPlan()

      expect(screen.queryByText(LINE)).toBeNull()
      expect(screen.queryByText(LINK)).toBeNull()
    })
  })

  describe('a sequence run', () => {
    it('with no slot: the SAME line and link (one line for both types); the old states are absent', () => {
      program = sequenceProgram()
      sequenceItems = []
      renderPlan()

      expectTheLine()
    })

    it('with only rest slots: the line', () => {
      program = sequenceProgram()
      sequenceItems = [slot(0, null), slot(1, null)]
      renderPlan()

      expectTheLine()
    })

    it('its link opens the Programs page', () => {
      program = sequenceProgram()
      renderPlan()

      fireEvent.click(screen.getByText(LINK))

      expect(screen.getByText('AT /program')).toBeTruthy()
    })

    it('a weekday map left under a sequence run does not schedule it', () => {
      program = sequenceProgram({ schedule: MONDAY })
      sequenceItems = []
      renderPlan()

      expectTheLine()
    })

    it('with a workout in the sequence: no line, and the cycle is there', () => {
      program = sequenceProgram()
      sequenceItems = [slot(0, null), slot(1, 'wd-1')]
      renderPlan()

      expectScheduled()
    })
  })
})

// ─── The deload rules in effect ──────────────────────────────────────────────

describe('PlanPage — the deload rules in effect show read-only under the deload action (chunk 33; from Settings, chunk 48)', () => {
  // The line sits directly under the page-level action (DECISIONS 87, provisional).
  const markButton = (label = 'MARK WEEK AS DELOAD') => screen.getByText(label).closest('button') as HTMLButtonElement

  it('the Settings rules show as "from Settings", under MARK WEEK AS DELOAD', () => {
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()

    const line = screen.getByText(SETTINGS_RULES_TEXT)
    expect(markButton().nextElementSibling).toBe(line)
  })

  it('a run whose program stored an override shows the Settings rules, never the stored ones (and never "this run\'s")', () => {
    program = withStoredOverride(makeProgram(), STORED_OVERRIDE)
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()

    expect(screen.getByText(SETTINGS_RULES_TEXT)).toBeTruthy()
    expect(screen.queryAllByText(/^Deload rules \(/)).toHaveLength(1)
    expect(screen.queryByText(/weight 75%/)).toBeNull() // the stored override's own words
    expect(screen.queryByText(/sets −50%/)).toBeNull()
    expect(screen.queryByText(/this run's|your default/)).toBeNull()
  })

  it('follows a change in Settings, with no reload: new rules, then none (a stored override never takes over)', () => {
    program = withStoredOverride(makeProgram(), STORED_OVERRIDE)
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()
    expect(screen.getByText(SETTINGS_RULES_TEXT)).toBeTruthy()

    act(() => useSettingsStore.setState({ deloadRules: { weight: WEIGHT_RULE } }))
    expect(screen.getByText('Deload rules (from Settings): weight 75% (rounded down to 2.5 kg)')).toBeTruthy()
    expect(screen.queryByText(SETTINGS_RULES_TEXT)).toBeNull()

    act(() => useSettingsStore.setState({ deloadRules: null }))
    expect(anyRulesLine()).toBeNull()
  })

  it('no rules in Settings shows no line, even for a run whose program stored an override', () => {
    program = withStoredOverride(makeProgram(), STORED_OVERRIDE)
    renderPlan()

    expect(anyRulesLine()).toBeNull()
    // The deload action itself is there; only the line is not.
    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expect(markButton().nextElementSibling).not.toBeInstanceOf(HTMLParagraphElement)
  })

  it('is read-only text: it holds no button or field, and a tap on it marks nothing', () => {
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()

    const line = screen.getByText(SETTINGS_RULES_TEXT)
    expect(line.tagName).toBe('P')
    expect(line.querySelector('button, input, select, textarea')).toBeNull()
    expect(line.closest('button')).toBeNull()
    fireEvent.click(line)
    expect(setWeekDeloadMutate).not.toHaveBeenCalled()
  })

  it('shows exactly the rules a tap on the action hands to marking: the Settings rules, whatever the program stored', () => {
    program = withStoredOverride(makeProgram(), STORED_OVERRIDE)
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()
    expect(screen.getByText(SETTINGS_RULES_TEXT)).toBeTruthy()

    fireEvent.click(markButton())

    expect(setWeekDeloadMutate).toHaveBeenCalledTimes(1)
    expect(setWeekDeloadMutate.mock.calls[0][0]).toEqual({ isDeload: true, rules: SETTINGS_RULES })
  })

  it('... and the Settings rules as they are now, after a change', () => {
    program = withStoredOverride(makeProgram(), STORED_OVERRIDE)
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()
    expect(screen.getByText(SETTINGS_RULES_TEXT)).toBeTruthy()

    act(() => useSettingsStore.setState({ deloadRules: { weight: WEIGHT_RULE } }))
    fireEvent.click(markButton())

    expect(setWeekDeloadMutate.mock.calls[0][0]).toEqual({ isDeload: true, rules: { weight: WEIGHT_RULE } })
  })

  it('a sequence run: under MARK CYCLE AS DELOAD', () => {
    program = withStoredOverride(sequenceProgram(), STORED_OVERRIDE)
    sequenceItems = [slot(0, 'wd-1')]
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()

    const line = screen.getByText(SETTINGS_RULES_TEXT)
    expect(markButton('MARK CYCLE AS DELOAD').nextElementSibling).toBe(line)
  })

  // The sequence run's slot panel is its own call site for the per-session toggle (the weekday panel's is
  // proven in PlanPage.deload.test.tsx): it, too, hands marking the Settings rules and never the stored ones.
  it('a sequence run: the slot\'s own session toggle marks with the Settings rules, whatever the program stored', () => {
    program = withStoredOverride(sequenceProgram(), STORED_OVERRIDE)
    sequenceItems = [slot(0, 'wd-1')]
    weekPlans = [{
      id: 'wp-slot', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, sequencePosition: 0,
      isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
    }]
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()

    fireEvent.click(screen.getByLabelText('Mark this session as deload'))

    expect(setDeloadMutate).toHaveBeenCalledTimes(1)
    expect(setDeloadMutate.mock.calls[0][0]).toEqual({ weekPlanId: 'wp-slot', isDeload: true, rules: SETTINGS_RULES })
  })

  it('stays with the action when the week is marked (UNMARK THIS WEEK)', () => {
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    weekPlans = [{
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: true, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
    }]
    renderPlan()

    expect(screen.getByText('UNMARK THIS WEEK')).toBeTruthy()
    expect(markButton('UNMARK THIS WEEK').nextElementSibling).toBe(screen.getByText(SETTINGS_RULES_TEXT))
  })

  it('a past week has no deload action, so no line either', () => {
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    activeMeso = { ...activeMeso, startDate: format(subWeeks(new Date(), 2), 'yyyy-MM-dd') } // week 3 is the current one
    renderPlan()
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.getByText(SETTINGS_RULES_TEXT)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Previous week')) // week 2: read-only

    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(anyRulesLine()).toBeNull()
  })

  it('a run with no schedule has no deload action, so no line', () => {
    program = makeProgram({ schedule: EMPTY_SCHEDULE })
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    renderPlan()

    expect(screen.getByText('NO WORKOUTS SCHEDULED')).toBeTruthy()
    expect(anyRulesLine()).toBeNull()
  })
})

// ─── 375px ───────────────────────────────────────────────────────────────────

describe('PlanPage — 375px (chunk 33)', () => {
  function fixedWidthOffenders(container: HTMLElement): string[] {
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    return offenders
  }

  it('the no-schedule line and the deload rules line add no fixed width wider than 375px', () => {
    program = makeProgram({ schedule: EMPTY_SCHEDULE })
    const first = renderPlan()
    expect(screen.getByText('NO WORKOUTS SCHEDULED')).toBeTruthy()
    expect(fixedWidthOffenders(first.container)).toEqual([])
    first.unmount()

    program = makeProgram()
    useSettingsStore.setState({ deloadRules: SETTINGS_RULES })
    const second = renderPlan()
    expect(screen.getByText(SETTINGS_RULES_TEXT)).toBeTruthy()
    expect(fixedWidthOffenders(second.container)).toEqual([])
  })
})
