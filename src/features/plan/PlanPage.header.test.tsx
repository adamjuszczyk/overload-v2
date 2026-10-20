// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { addWeeks, format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WeekPlan, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { textOnAccentColours } from '../../testing/textOnAccent'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 52 (TASKS-1.2 "Plan's header"; SPEC Screens → Plan screen → Header (1, 8a), Week row, Loading and errors (board 12), Errors (15);
// P1.2-5). The header and the three states of board 12, at the screen: PLAN | PROGRAMS over "[PROGRAM] · CURRENT PROGRAM" over the week
// tiles, with none of the old header's controls; OPENING PLAN (a spinner under the title) while the run's weeks are out; PLAN COULDN'T
// LOAD with the real reason when they can't be read; LOADING THE WEEK (the tiles, with the week's own spinner under them) while the open
// week's plan is out, and its own error when that one can't be read. Hooks are mocked (the seam every Plan screen test uses) and driven by
// the states below.

afterEach(cleanup)
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  state.programsLoading = false
  planWeekMutate.mockReset()
  weekReads.length = 0
})

interface Read<T> { data: T | undefined; isLoading: boolean; isError?: boolean; error?: unknown }
const planWeekMutate = vi.hoisted(() => vi.fn())
/** Every (run, week) the screen asked the open week's plan of, in order: what `useWeekPlans` was called with. */
const weekReads = vi.hoisted(() => [] as Array<[string, number]>)
const state = vi.hoisted(() => ({
  programsLoading: false,
  meso: null as unknown as Mesocycle,
  all: null as unknown as Read<WeekPlan[]>,
  week: null as unknown as Read<WeekPlan[]>,
}))

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', workoutDays: [], schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
}
const BENCH = pe('pe-bench', 'bench', 0)
const week = (n: number): WeekPlan => plan(n, [BENCH], [wset(`s-${n}`, 'pe-bench', 1)], { id: `wp-${n}`, workoutDayId: 'wd-1' })

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [state.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: state.programsLoading ? undefined : [program], isLoading: state.programsLoading }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/ProgramsTab', async () => ({ default: (await import('./programsTab.standIn.testutil')).default }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./MakeWeekDefault', () => ({ default: () => null }))
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: undefined }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (mesoId: string, weekNumber: number) => {
    weekReads.push([mesoId, weekNumber])
    return state.week
  },
  useAllWeekPlans: () => state.all,
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: planWeekMutate, isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile } = await import('./planMenus.testutil')

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')

/** A run in its week `current` with the given weeks planned, whose open week's plan has been read. */
function run(current: number, planned: number[]) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active', startDate: monday(current - 1), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.all = { data: planned.map(week), isLoading: false }
  state.week = { data: [week(current)], isLoading: false }
}

const renderPlan = () => render(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
// The spinner's ring as a captured render carries it: its borders written as longhands (a `border` shorthand with `var()` is dropped by
// jsdom, and the screenshot then shows no ring: the first capture of board 12 did), the accent on its top.
const drawnRing = (el: HTMLElement) => el.style.borderStyle === 'solid' && el.style.borderWidth === '2px' && el.style.borderTopColor === 'var(--accent)' && el.style.borderLeftColor === 'var(--border-strong)'
const tileLabels = () => Array.from(document.querySelectorAll('[data-week]')).map((el) => el.getAttribute('aria-label'))

describe('the header (boards 1, 1b, 1d)', () => {
  it('PLAN | PROGRAMS tabs with PLAN selected, then "[PROGRAM] · CURRENT PROGRAM", then the tiles; the old header\'s controls are gone', () => {
    run(2, [1, 2])
    renderPlan()

    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getAllByRole('tab').map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['PLAN', 'true'], ['PROGRAMS', 'false']])
    expect(screen.getByText('TEST MESO · CURRENT PROGRAM')).toBeTruthy()
    // a long name wraps inside its line: an unbroken word must not run past the screen (RULES, 128 (i); the 375 px check of a long name)
    expect(screen.getByText('TEST MESO · CURRENT PROGRAM').style.overflowWrap).toBe('anywhere')
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    // in that order, one under the other
    const caption = screen.getByText('TEST MESO · CURRENT PROGRAM')
    expect(tabs.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(caption.compareDocumentPosition(document.querySelector('[data-week="1"]') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // absence (Checks that lied #32): no arrows, no Programs icon, no PRIORITIES, no old title or week label
    for (const gone of ['Previous week', 'Next week', 'Programs']) expect(screen.queryByLabelText(gone)).toBeNull()
    expect(screen.queryByText('PRIORITIES')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'PLAN' })).toBeNull()
    expect(screen.queryByText('Test Meso')).toBeNull() // the name is only ever in the caption, in capitals
  })

  it('opens on the current week: its tile is the open one, and it is not read-only', () => {
    run(3, [1, 2, 3])
    renderPlan()
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('3')
    expect(screen.queryByText('PAST WEEK · READ ONLY')).toBeNull()
    expect(screen.getByLabelText('Week 3 options')).toBeTruthy()
  })

  it('tapping a tile opens that week: the open one moves, the panel follows, and the lock line shows only on a past week', () => {
    run(3, [1, 2, 3])
    state.week = { data: [week(3)], isLoading: false }
    renderPlan()
    openWeekTile('WEEK 1')
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('1')
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    openWeekTile('WEEK 3')
    expect(screen.queryByText('PAST WEEK · READ ONLY')).toBeNull()
  })

  it('a run that has not started yet is in week 1 (it has no current week yet): THIS WEEK on week 1, week 2 NOT PLANNED', () => {
    state.meso = { id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active', startDate: format(addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
    state.all = { data: [week(1)], isLoading: false }
    state.week = { data: [week(1)], isLoading: false }
    renderPlan()
    expect(tileLabels()).toEqual(['WEEK 1 · THIS WEEK', 'WEEK 2 · NOT PLANNED'])
    expect(screen.getByLabelText('Week 1 options')).toBeTruthy()
  })

  it('the PROGRAMS tab replaces the screen under the tabs and PLAN brings it back (the shell, P1.2-12)', () => {
    run(2, [1, 2])
    renderPlan()
    fireEvent.click(screen.getByRole('tab', { name: 'PROGRAMS' }))
    expect(screen.getByRole('tab', { name: 'PROGRAMS' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('PROGRAMS TAB')).toBeTruthy()
    expect(document.querySelector('[data-week]')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    expect(tileLabels()).toHaveLength(3)
  })
})

describe('the current week is planned once per run and week', () => {
  it('a current week with no rows is planned with the current week and the run, and not again when the run\'s weeks are read again (a failure does not loop; TRY AGAIN is the retry)', () => {
    run(2, [1]) // week 2 is current and has no rows
    const view = render(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    expect(planWeekMutate).toHaveBeenCalledTimes(1)
    expect(planWeekMutate.mock.calls[0][0]).toEqual({ mesoId: 'meso-1', weekNumber: 2 })

    // the run's weeks are out and come back (the cache reset, a sign-in): the effect runs again and must not plan the week again by itself
    state.all = { data: undefined, isLoading: true }
    view.rerender(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    state.all = { data: [week(1)], isLoading: false }
    view.rerender(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    expect(planWeekMutate).toHaveBeenCalledTimes(1)
  })

  it('nothing is planned while the run\'s weeks are not read, or when the current week has its rows', () => {
    run(2, [1, 2])
    render(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    expect(planWeekMutate).not.toHaveBeenCalled()
    cleanup()
    run(2, [1])
    state.all = { data: undefined, isLoading: true }
    render(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    expect(planWeekMutate).not.toHaveBeenCalled()
  })
})

describe('the strip opens on the current week\'s tile (P1.2-6)', () => {
  // jsdom has no layout: a tile is 100 px per week from the strip's left edge and 90 px wide, the strip 300 px wide.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.week ? (Number(this.dataset.week) - 1) * 100 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.week ? 90 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label')?.endsWith('of this program') ? 300 : 0
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('a run in week 5: the strip is scrolled to week 5\'s tile as it opens, and tapping another tile does not move it (the page hands the strip the current week, not the open one)', () => {
    run(5, [1, 2, 3, 4, 5])
    renderPlan()
    const row = screen.getByLabelText('Weeks of this program')
    expect(row.scrollLeft).toBe(295) // week 5 starts at 400; centred in 300 px with a 90 px tile: 400 − 105
    openWeekTile('WEEK 1')
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('1')
    expect(row.scrollLeft).toBe(295)
    openWeekTile('WEEK 3')
    expect(row.scrollLeft).toBe(295)
  })
})

describe('board 12: opening Plan, Plan couldn\'t load, loading the week', () => {
  it('OPENING PLAN: while the programs are out (DECISIONS 94), the title over a spinner, and no tab, tile or action', () => {
    run(2, [1, 2])
    state.programsLoading = true
    renderPlan()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(drawnRing(screen.getByRole('status', { name: 'Loading' }))).toBe(true)
    expect(screen.getByRole('heading', { name: 'PLAN' })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()
    expect(screen.queryByText('COPY')).toBeNull()
  })

  it('while the run\'s weeks are out the tabs and the run\'s name are there with a spinner, and no tile yet (none can be drawn: provisional, D31)', () => {
    run(2, [1, 2])
    state.all = { data: undefined, isLoading: true }
    renderPlan()
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.getByText('TEST MESO · CURRENT PROGRAM')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(document.querySelector('[data-week]')).toBeNull()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
  })

  it('PLAN COULDN\'T LOAD: the headline and the REAL reason, never the fixed "Check your connection" line', () => {
    run(2, [1, 2])
    state.all = { data: undefined, isLoading: false, isError: true, error: { message: 'JWT expired', code: 'PGRST301' } }
    renderPlan()
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText("COULDN'T LOAD PLAN")).toBeTruthy()
    expect(within(alert).getByText('JWT expired')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Check your connection')
    expect(screen.queryByRole('status')).toBeNull() // not an endless spinner
  })

  it('...with no message: "Something went wrong."; offline with no message: "You may be offline."; offline with a message: the message', () => {
    run(2, [1, 2])
    state.all = { data: undefined, isLoading: false, isError: true, error: {} }
    const { unmount } = renderPlan()
    expect(screen.getByText('Something went wrong.')).toBeTruthy()
    unmount()

    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const again = renderPlan()
      expect(screen.getByText('You may be offline.')).toBeTruthy()
      expect(screen.queryByText('Something went wrong.')).toBeNull()
      again.unmount()
      state.all = { data: undefined, isLoading: false, isError: true, error: { message: 'Failed to fetch' } }
      renderPlan()
      expect(screen.getByText('Failed to fetch')).toBeTruthy()
      expect(screen.queryByText('You may be offline.')).toBeNull()
    } finally {
      online.mockRestore()
    }
  })

  it('a refetch that failed with the weeks still in hand does not blank the page', () => {
    run(2, [1, 2])
    state.all = { data: [week(1), week(2)], isLoading: false, isError: true, error: { message: 'Failed to fetch' } }
    renderPlan()
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    expect(screen.queryByText("COULDN'T LOAD PLAN")).toBeNull()
  })

  // react-dom/server draws the first render alone, with no effect run: what RTL's render (effects flushed in act) can't show. A run in
  // week 3 must not draw week 1 (open, with its lock line) for a render before an effect moves the page to week 3.
  const firstRender = () => renderToString(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)

  it('the first render of a run in week 3 whose weeks are already read opens week 3: no lock line, no week 1 open', () => {
    run(3, [1, 2, 3])
    const first = firstRender()
    expect(first).toMatch(/data-week="3"[^>]*aria-current="true"/)
    expect(first).not.toMatch(/data-week="1"[^>]*aria-current="true"/)
    expect(first).not.toContain('PAST WEEK')
  })

  it('the first render of a run in week 3 whose weeks are still out: the spinner and no lock line', () => {
    run(3, [1, 2, 3])
    state.all = { data: undefined, isLoading: true }
    const first = firstRender()
    expect(first).toContain('aria-label="Loading"')
    expect(first).not.toContain('PAST WEEK')
    renderPlan()
    expect(screen.queryByText('PAST WEEK · READ ONLY')).toBeNull()
  })

  it('LOADING THE WEEK: the tiles stay, with the open week\'s own spinner under them, and no panel, actions or CHANGE THE PROGRAM until it has been read', () => {
    run(2, [1, 2])
    state.week = { data: undefined, isLoading: true }
    renderPlan()
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(drawnRing(screen.getByRole('status', { name: 'Loading' }))).toBe(true)
    for (const gone of ['COPY']) expect(screen.queryByText(gone)).toBeNull()
    expect(screen.queryByLabelText('Week 2 options')).toBeNull()
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
    expect(screen.queryByText('SETS')).toBeNull()
  })

  it('the open week\'s own read failing: its note, "Couldn\'t load this week" and the real reason, under the tiles; the other tiles still open', () => {
    run(2, [1, 2])
    state.week = { data: undefined, isLoading: false, isError: true, error: { message: 'canceling statement due to statement timeout' } }
    renderPlan()
    expect(within(screen.getByRole('alert')).getByText("Couldn't load this week")).toBeTruthy()
    expect(screen.getByText('canceling statement due to statement timeout')).toBeTruthy()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
    expect(tileLabels()).toHaveLength(3)
  })

  it('...with no message: "Something went wrong."; offline with no message: "You may be offline."; offline with a message: the message', () => {
    run(2, [1, 2])
    state.week = { data: undefined, isLoading: false, isError: true, error: {} }
    const { unmount } = renderPlan()
    expect(within(screen.getByRole('alert')).getByText('Something went wrong.')).toBeTruthy()
    unmount()

    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const again = renderPlan()
      expect(within(screen.getByRole('alert')).getByText('You may be offline.')).toBeTruthy()
      expect(screen.queryByText('Something went wrong.')).toBeNull()
      again.unmount()
      state.week = { data: undefined, isLoading: false, isError: true, error: { message: 'Failed to fetch' } }
      renderPlan()
      expect(screen.getByText('Failed to fetch')).toBeTruthy()
      expect(screen.queryByText('You may be offline.')).toBeNull()
    } finally {
      online.mockRestore()
    }
  })

  it('a refetch of the open week that failed with its plan in hand does not blank the week: no alert, and the actions are still there', () => {
    run(2, [1, 2])
    state.week = { data: [week(2)], isLoading: false, isError: true, error: { message: 'Failed to fetch' } }
    renderPlan()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText("Couldn't load this week")).toBeNull()
    expect(screen.getByText('COPY')).toBeTruthy()
    expect(screen.getByLabelText('Week 2 options')).toBeTruthy()
  })

  it('a planned week whose own read came back empty offers no COPY and no WEEK ⋯: nothing to copy into, nothing to mark', () => {
    run(2, [1, 2])
    state.week = { data: [], isLoading: false }
    renderPlan()
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByLabelText('Week 2 options')).toBeNull()
  })

  it('a week that is not planned has no spinner while its (empty) read is out: the card is a card, not a week to load', () => {
    run(2, [1, 2])
    state.week = { data: undefined, isLoading: true }
    renderPlan()
    openWeekTile('WEEK 3')
    expect(screen.getByText("Week 3 isn't planned yet")).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('the open week is always one of the tiles', () => {
  it('another run takes the screen while the first one\'s week 6 is open: the first render of the new run already reads its own current week, never week 6', () => {
    run(5, [1, 2, 3, 4, 5]) // tiles 1 to 6: week 6 is the one PLAN FORWARD opens
    const { rerender } = renderPlan()
    openWeekTile('WEEK 6')
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('6')

    // a second run, in its week 2 with weeks 1 and 2 planned: its tiles are 1 to 3, and 6 is not one of them
    state.meso = { ...state.meso, id: 'meso-2', startDate: monday(1) }
    state.all = { data: [week(1), week(2)], isLoading: false }
    state.week = { data: [week(2)], isLoading: false }
    weekReads.length = 0
    rerender(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)

    expect(weekReads.length).toBeGreaterThan(0)
    expect(weekReads.every(([meso, weekNumber]) => meso === 'meso-2' && weekNumber === 2)).toBe(true)
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('2')
  })

  it('a week that is one of the tiles stays open when the tiles change under it', () => {
    run(5, [1, 2, 3, 4, 5])
    const { rerender } = renderPlan()
    openWeekTile('WEEK 2')
    weekReads.length = 0
    state.all = { data: [1, 2, 3, 4, 5, 6].map(week), isLoading: false } // week 6 is planned: the strip grows to 7
    rerender(<MemoryRouter initialEntries={['/plan']}><PlanPage /></MemoryRouter>)
    expect(tileLabels()).toHaveLength(7)
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('2')
    expect(weekReads.every(([, weekNumber]) => weekNumber === 2)).toBe(true)
  })
})

describe('text on the accent on the screen (DECISIONS 128 (g))', () => {
  it('the open tile and PLAN FORWARD draw in --on-accent; nothing else sits on the accent', () => {
    run(2, [1, 2])
    renderPlan()
    expect(textOnAccentColours(screen.getByLabelText('Weeks of this program'))).toEqual(['var(--on-accent)']) // the open tile (week 2)
    openWeekTile('WEEK 3')
    // the open tile (week 3) and the PLAN FORWARD button, and nothing else on the screen
    expect(textOnAccentColours(document.body)).toEqual(['var(--on-accent)', 'var(--on-accent)'])
    expect((screen.getByText('PLAN FORWARD').closest('button') as HTMLButtonElement).style.color).toBe('var(--on-accent)')
  })
})
