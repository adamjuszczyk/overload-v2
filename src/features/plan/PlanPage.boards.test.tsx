// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, SequenceItem, WeekPlan, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import type { DeloadRules } from '../../lib/deloadRules'
import { captureRender } from '../../testing/captureRender'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 52's screens, rendered the way the boards draw them, for the 390 px screenshots beside the boards (`CAPTURE_RENDER=1` writes
// `__fixtures__/plan-<board>.html`; `npm run shot` turns each into design/1.2/built/<board>.png + .txt). Each test captures first, then
// asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it asserts, so a broken
// rule still writes the fixture the Chromium check measures). Boards: 1 (header and action row), 1b (PLAN FORWARD), 1c (a past week), 1d (CYCLE tiles),
// 1e (WEEK ⋯, every frame), 2 (COPY, week-dependent and stable), 12 (opening, couldn't load, loading the week).
// Not drawn here, because other chunks build them: VOLUME and REVIEW (55, 56), the exercise cards and set rows (54a, 54b), the SLOT
// chips' new look (54b). The page below the header is today's.

afterEach(() => {
  cleanup()
  useSettingsStore.setState(DEFAULT_SETTINGS)
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
})

const PROGRAM_NAME = 'Push Pull Legs'
const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const DAYS = [wd('wd-push1', 'Push 1', 0), wd('wd-pull1', 'Pull 1', 1), wd('wd-push2', 'Push 2', 2), wd('wd-pull2', 'Pull 2', 3), wd('wd-legs', 'Legs', 4)]

interface Read<T> { data: T | undefined; isLoading: boolean; isError?: boolean; error?: unknown }
const state = vi.hoisted(() => ({
  programsLoading: false,
  meso: null as unknown as Mesocycle,
  program: null as unknown as Program,
  sequence: [] as SequenceItem[],
  days: [] as WorkoutDay[],
  all: null as unknown as Read<WeekPlan[]>,
  week: null as unknown as Read<WeekPlan[]>,
  done: new Set<string>(),
  deloadHook: { isPending: false, isError: false, error: null as unknown, variables: undefined as { isDeload: boolean; rules: null } | undefined },
  cycle: 3,
}))
const setWeekDeloadMutate = vi.hoisted(() => vi.fn())

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [state.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: state.programsLoading ? undefined : [state.program], isLoading: state.programsLoading }),
  useWorkoutDays: () => ({ data: state.days, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: state.sequence }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false, error: null }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: true }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => (state.week.data ? { ...state.week, data: state.week.data.filter((p) => p.weekNumber === weekNumber) } : state.week),
  useAllWeekPlans: () => state.all,
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: setWeekDeloadMutate, ...state.deloadHook }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekMenu, openWeekTile } = await import('./planMenus.testutil')

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')

// ─── The runs the boards draw ─────────────────────────────────────────────────

const LAT = pe('pe-lat', 'lat-pulldown', 0, { workoutDayId: 'wd-pull1' })
const ROW = pe('pe-row', 'seated-cable-row', 1, { workoutDayId: 'wd-pull1' })
const BENCH = pe('pe-bench', 'bench-press', 0, { workoutDayId: 'wd-push1' })
const nameOf = (id: string) => id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function session(workoutDayId: string, week: number, exercises = [BENCH], numbers: { weight: number | null; rir: number | null } = { weight: 60, rir: 2 }, over: Partial<WeekPlan> = {}): WeekPlan {
  const exs = exercises.map((e) => ({ ...e, workoutDayId, exercise: { ...e.exercise!, name: nameOf(e.exerciseId) } }))
  const sets = exs.flatMap((e) => [1, 2, 3].map((n) => wset(`s-${workoutDayId}-${week}-${e.id}-${n}`, e.id, n, { weekPlanId: `wp-${workoutDayId}-${week}`, targetWeight: numbers.weight, repMin: 8, repMax: 10, targetRir: numbers.rir })))
  return plan(week, exs, sets, { id: `wp-${workoutDayId}-${week}`, workoutDayId, ...over })
}

const WEEKDAYS = { ...EMPTY_SCHEDULE, monday: 'wd-push1', tuesday: 'wd-pull1', thursday: 'wd-push2', friday: 'wd-pull2', saturday: 'wd-legs' }

function weekdayRun(opts: { planningType?: Program['planningType']; deload?: boolean } = {}) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: PROGRAM_NAME, programId: 'prog-1', status: 'active', startDate: monday(1), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: PROGRAM_NAME, workoutDays: [], schedule: WEEKDAYS, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: opts.planningType ?? 'week_dependent' }
  state.days = DAYS
  state.sequence = []
  const forWeek = (week: number) => DAYS.map((d) => session(d.id, week, d.id === 'wd-pull1' ? [LAT, ROW] : [BENCH], week === 1 ? { weight: 57.5, rir: 2 } : { weight: null, rir: null }, { isDeload: !!opts.deload && week === 2 }))
  state.all = { data: [...forWeek(1), ...forWeek(2)], isLoading: false }
  state.week = { data: state.all.data, isLoading: false }
  state.done = new Set(['wp-wd-push1-2']) // Monday's Push 1 is done (board 2 locks it)
  state.deloadHook = { isPending: false, isError: false, error: null, variables: undefined }
}

const ITEMS = [['si-0', 'wd-upperA'], ['si-1', null], ['si-2', 'wd-lowerA'], ['si-3', 'wd-upperB']] as const
function sequenceRun(opts: { deload?: boolean } = {}) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: 'Upper Lower', programId: 'prog-1', status: 'active', startDate: monday(0), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: 'Upper Lower', workoutDays: [], schedule: EMPTY_SCHEDULE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent', scheduleType: 'sequence' }
  state.days = [wd('wd-upperA', 'Upper A', 0), wd('wd-lowerA', 'Lower A', 1), wd('wd-upperB', 'Upper B', 2)]
  state.sequence = ITEMS.map(([id, workoutDayId], position) => ({ id, userId: 'user-1', programId: 'prog-1', position, workoutDayId }))
  state.cycle = 3
  const cycle = (week: number) => ITEMS.flatMap(([, workoutDayId], position) => (workoutDayId ? [session(workoutDayId, week, [BENCH], week === 2 ? { weight: 100, rir: 2 } : { weight: null, rir: null }, { sequencePosition: position, isDeload: !!opts.deload && week === 3 })] : []))
  state.all = { data: [...cycle(2), ...cycle(3)], isLoading: false }
  state.week = { data: state.all.data, isLoading: false }
  state.done = new Set()
  state.deloadHook = { isPending: false, isError: false, error: null, variables: undefined }
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <PlanPage />
  </MemoryRouter>
)
const SETS_AND_RIR: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, rir: { delta: 2 } }
const SEQUENCE_RULES: DeloadRules = { sets: { mode: 'count', value: 1, rounding: 'down' }, weight: { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'kg' } }

// ─── Board 1: the header and the action row ──────────────────────────────────

describe('board 1: the header, the week row and the action row', () => {
  it('PLAN | PROGRAMS, the run\'s name, WEEK 1 DONE · WEEK 2 THIS WEEK (open) · WEEK 3 NOT PLANNED, then COPY and WEEK ⋯', () => {
    weekdayRun()
    const { container } = render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-1', document.body)

    expect(screen.getByText('PUSH PULL LEGS · CURRENT PROGRAM')).toBeTruthy()
    expect(Array.from(container.querySelectorAll('[data-week]')).map((el) => el.getAttribute('aria-label'))).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    expect(screen.getByText('COPY')).toBeTruthy()
    expect(screen.getByLabelText('Week 2 options')).toBeTruthy()
  })
})

// A run in its week 8 (every week planned): ten tiles, so the strip scrolls. The fixture is for a Chromium check of the opening scroll
// (the screenshot pipeline renders static HTML, which carries no scroll position), not a board; it is not committed.
describe('a long run\'s week row', () => {
  it('weeks 1 to 8 planned, week 8 current: nine tiles, the last NOT PLANNED', () => {
    weekdayRun()
    state.meso = { ...state.meso, startDate: monday(7) }
    const forWeek = (week: number) => DAYS.map((d) => session(d.id, week))
    state.all = { data: [1, 2, 3, 4, 5, 6, 7, 8].flatMap(forWeek), isLoading: false }
    state.week = { data: state.all.data, isLoading: false }
    const { container } = render(ui())
    captureRender('plan-1-long-strip', document.body)

    expect(container.querySelectorAll('[data-week]')).toHaveLength(9)
    expect(container.querySelector('[data-week="9"]')?.getAttribute('aria-label')).toBe('WEEK 9 · NOT PLANNED')
  })
})

// ─── Board 1c: a past week ────────────────────────────────────────────────────

describe('board 1c: a past week', () => {
  it('WEEK 1 DONE open, WEEK 2 THIS WEEK outlined in the accent, the lock line "PAST WEEK · READ ONLY", no action row, no CHANGE THE PROGRAM', () => {
    weekdayRun()
    render(ui())
    openWeekTile('WEEK 1')
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-1c', document.body)

    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByLabelText('Week 1 options')).toBeNull()
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
  })
})

// ─── Board 1b: PLAN FORWARD ───────────────────────────────────────────────────

describe('board 1b: the first unplanned week after the current one', () => {
  it('"Week 3 isn\'t planned yet", PLAN FORWARD, what it takes, and the workouts week 3 will have', () => {
    weekdayRun()
    render(ui())
    openWeekTile('WEEK 3')
    captureRender('plan-1b', document.body)

    expect(screen.getByText("Week 3 isn't planned yet")).toBeTruthy()
    expect(screen.getByText('PLAN FORWARD')).toBeTruthy()
    expect(screen.getByText("Takes week 2's sets and set types. Numbers come with COPY. Week 4 opens once week 3 is planned.")).toBeTruthy()
    expect(screen.getByText('WEEK 3 WILL HAVE')).toBeTruthy()
  })
})

// ─── Board 1d: a sequence run ─────────────────────────────────────────────────

describe('board 1d: CYCLE tiles and CYCLE ⋯ (the SLOT chips stay as they are until 54b)', () => {
  it('CYCLE 2 DONE · CYCLE 3 THIS CYCLE (open) · CYCLE 4 NOT PLANNED, then COPY and CYCLE ⋯', () => {
    sequenceRun()
    const { container } = render(ui())
    fireEvent.click(screen.getByText('SLOT 3'))
    captureRender('plan-1d', document.body)

    expect(Array.from(container.querySelectorAll('[data-week]')).map((el) => el.getAttribute('aria-label')).slice(-3)).toEqual(['CYCLE 2 · DONE', 'CYCLE 3 · THIS CYCLE', 'CYCLE 4 · NOT PLANNED'])
    expect(screen.getByText('UPPER LOWER · CURRENT PROGRAM')).toBeTruthy()
    expect(screen.getByLabelText('Cycle 3 options')).toBeTruthy()
  })
})

// ─── Board 1e: WEEK ⋯, every frame ───────────────────────────────────────────

describe('board 1e: the week menu', () => {
  it('WEEK MENU · WEEK 2: "Push Pull Legs / Week 2", MARK WEEK AS DELOAD, the Settings rules', () => {
    weekdayRun()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETS_AND_RIR })
    render(ui())
    openWeekMenu()
    captureRender('plan-1e', document.body)

    const dialog = within(screen.getByRole('dialog', { name: 'Week 2' }))
    expect(dialog.getByText('Push Pull Legs')).toBeTruthy()
    expect(dialog.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expect(dialog.getByText(/^Deload rules \(from Settings\): sets/)).toBeTruthy()
  })

  it('WEEK MARKED · A SESSION ALREADY STARTED: UNMARK THIS WEEK with the DELOAD chip, the rules, "Already started — sets left as they are"', () => {
    weekdayRun()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETS_AND_RIR })
    setWeekDeloadMutate.mockImplementation((_vars, options) => options?.onSuccess?.({ anyAlreadyStarted: true }))
    const view = render(ui())
    openWeekMenu()
    fireEvent.click(screen.getByText('MARK WEEK AS DELOAD')) // the answer says a session had started; the plans then read marked
    weekdayRun({ deload: true })
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETS_AND_RIR })
    view.rerender(ui())
    captureRender('plan-1e-marked', document.body)

    const dialog = within(screen.getByRole('dialog', { name: 'Week 2' }))
    expect(dialog.getByText('UNMARK THIS WEEK')).toBeTruthy()
    expect(dialog.getByText('DELOAD')).toBeTruthy()
    expect(dialog.getByText('Already started — sets left as they are')).toBeTruthy()
    setWeekDeloadMutate.mockReset()
  })

  it('DELOAD RULES ALL OFF: the row alone, no rules line', () => {
    weekdayRun()
    render(ui())
    openWeekMenu()
    captureRender('plan-1e-rules-off', document.body)

    const dialog = within(screen.getByRole('dialog', { name: 'Week 2' }))
    expect(dialog.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    expect(dialog.queryByText(/Deload rules/)).toBeNull()
  })

  it('MARKING: MARKING… in the muted row, the rules under it', () => {
    weekdayRun()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETS_AND_RIR })
    state.deloadHook = { isPending: true, isError: false, error: null, variables: { isDeload: true, rules: null } }
    render(ui())
    openWeekMenu()
    captureRender('plan-1e-marking', document.body)

    expect(within(screen.getByRole('dialog')).getByText('MARKING…')).toBeTruthy()
  })

  it('SEQUENCE PROGRAM · CYCLE 3: "Upper Lower / Cycle 3", MARK CYCLE AS DELOAD, its rules', () => {
    sequenceRun()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SEQUENCE_RULES })
    render(ui())
    openWeekMenu()
    captureRender('plan-1e-sequence', document.body)

    const dialog = within(screen.getByRole('dialog', { name: 'Cycle 3' }))
    expect(dialog.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
    expect(dialog.getByText(/^Deload rules \(from Settings\): sets/)).toBeTruthy()
  })

  it('SEQUENCE PROGRAM · CYCLE MARKED: UNMARK THIS CYCLE with the DELOAD chip', () => {
    sequenceRun({ deload: true })
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SEQUENCE_RULES })
    render(ui())
    openWeekMenu()
    captureRender('plan-1e-sequence-marked', document.body)

    const dialog = within(screen.getByRole('dialog', { name: 'Cycle 3' }))
    expect(dialog.getByText('UNMARK THIS CYCLE')).toBeTruthy()
    expect(dialog.getByText('DELOAD')).toBeTruthy()
  })
})

// ─── Board 2: COPY ────────────────────────────────────────────────────────────

describe('board 2: the COPY sheet', () => {
  it('week-dependent: "WEEK 2 · FROM WEEK 1\'S PLAN", WEIGHT / REPS / RIR ticked, Push 1 DONE, four workouts ticked, overwrite off, COPY INTO 4 WORKOUTS', () => {
    weekdayRun()
    render(ui())
    fireEvent.click(screen.getByText('COPY'))
    captureRender('plan-2', document.body)

    const dialog = within(screen.getByRole('dialog', { name: "Copy last week's numbers" }))
    expect(screen.getByText("WEEK 2 · FROM WEEK 1'S PLAN")).toBeTruthy()
    for (const name of ['WEIGHT', 'REPS', 'RIR']) expect(dialog.getByRole('checkbox', { name })).toBeTruthy()
    expect(dialog.getByText('COPY INTO 4 WORKOUTS')).toBeTruthy()
    expect(dialog.getByText('Off: only empty boxes get filled.')).toBeTruthy()
  })

  it('stable (G53): WEIGHT and RIR only', () => {
    weekdayRun({ planningType: 'stable' })
    render(ui())
    fireEvent.click(screen.getByText('COPY'))
    captureRender('plan-2-stable', document.body)

    const dialog = within(screen.getByRole('dialog', { name: "Copy last week's numbers" }))
    expect(dialog.queryByRole('checkbox', { name: 'REPS' })).toBeNull()
    expect(dialog.getByRole('checkbox', { name: 'WEIGHT' })).toBeTruthy()
  })
})

// ─── Long names: the sheet overflow check and the 375 px check ───────────────

// A word with no break opportunity (RULES: a hyphenated name breaks at its hyphens and proves nothing): 80 of one letter.
const LONG = 'X'.repeat(80)

describe('an 80-letter name in each place chunk 52 draws one', () => {
  it('the COPY sheet\'s rows and the PLAN FORWARD card\'s list name a workout with a long name', () => {
    weekdayRun()
    state.days = state.days.map((d) => (d.id === 'wd-pull1' ? { ...d, name: LONG } : d))
    render(ui())
    fireEvent.click(screen.getByText('COPY'))
    captureRender('plan-2-long-name', document.body)

    expect(within(screen.getByRole('dialog')).getByText(LONG)).toBeTruthy()
  })

  it('the WEEK ⋯ sheet\'s eyebrow and the header\'s caption name a program with a long name', () => {
    weekdayRun()
    state.meso = { ...state.meso, name: LONG }
    render(ui())
    openWeekMenu()
    captureRender('plan-1e-long-name', document.body)

    expect(within(screen.getByRole('dialog')).getByText(LONG)).toBeTruthy()
  })

  it('the header\'s caption and the PLAN FORWARD list, with the long names, at the page level', () => {
    weekdayRun()
    state.meso = { ...state.meso, name: LONG }
    state.days = state.days.map((d) => (d.id === 'wd-pull1' ? { ...d, name: LONG } : d))
    render(ui())
    openWeekTile('WEEK 3')
    captureRender('plan-1b-long-name', document.body)

    expect(screen.getByText('WEEK 3 WILL HAVE')).toBeTruthy()
  })
})

// ─── Board 12: opening, couldn't load, loading the week ──────────────────────

describe('board 12', () => {
  it('OPENING PLAN: the title over a spinner', () => {
    weekdayRun()
    state.programsLoading = true
    render(ui())
    captureRender('plan-12-opening', document.body)
    state.programsLoading = false

    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })

  it('PLAN COULDN\'T LOAD: the headline and the real reason', () => {
    weekdayRun()
    state.all = { data: undefined, isLoading: false, isError: true, error: { message: 'Failed to fetch' } }
    render(ui())
    captureRender('plan-12-error', document.body)

    expect(screen.getByText("COULDN'T LOAD PLAN")).toBeTruthy()
    expect(screen.getByText('Failed to fetch')).toBeTruthy()
  })

  it('LOADING THE WEEK: the tiles, the week\'s own spinner under them', () => {
    weekdayRun()
    state.week = { data: undefined, isLoading: true }
    render(ui())
    captureRender('plan-12-loading-week', document.body)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(document.querySelectorAll('[data-week]')).toHaveLength(3)
  })
})
