// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, SequenceItem, WeekPlan, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 65 — Plan's shell (TASKS-1.2 "The PROGRAMS tab"; SPEC Navigation and settings [1.2] → PLAN | PROGRAMS (8): "Tapping Plan in the nav
// opens straight into the week. With no program running it opens on PROGRAMS; PLAN shows a lock"; Programs and runs [1.2], Starting: "lands
// on Plan, week 1"; F6; Errors (15)). The shell at its own layer: which tab it opens, what it does when the run list isn't known or couldn't
// be read, and START's one-shot `?week=1` (what it opens, what it takes out of the address, what it ignores). What the PROGRAMS tab itself
// draws is `ProgramsTab.test.tsx`'s; here it is the shared stand-in, which draws the real tabs and one marker.
//
// Hooks are mocked at the seam every Plan screen test uses; the fixtures give each run's weeks and the run list a state of their own.

afterEach(cleanup)
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  planWeekMutate.mockReset()
})

interface Read<T> { data: T | undefined; isLoading: boolean; isError?: boolean; error?: unknown }
const planWeekMutate = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({
  mesos: null as unknown as { data: unknown[] | undefined; isLoading: boolean; isError?: boolean; error?: unknown },
  program: null as unknown as Program,
  sequence: [] as SequenceItem[],
  all: null as unknown as Read<WeekPlan[]>,
  week: null as unknown as Read<WeekPlan[]>,
  cycle: 3,
}))

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const BENCH = pe('pe-bench', 'bench', 0)
const week = (n: number): WeekPlan => plan(n, [BENCH], [wset(`s-${n}`, 'pe-bench', 1)], { id: `wp-${n}`, workoutDayId: 'wd-1' })
const sequencePlan = (n: number): WeekPlan => plan(n, [BENCH], [wset(`s-${n}`, 'pe-bench', 1)], { id: `wp-${n}`, workoutDayId: 'wd-1', sequencePosition: 0 })

vi.mock('../programs/useMesos', () => ({ useMesos: () => state.mesos }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: state.sequence }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/ProgramsTab', async () => ({ default: (await import('./programsTab.standIn.testutil')).default }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false, error: null }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: undefined }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => (state.week.data ? { ...state.week, data: state.week.data.filter((p) => p.weekNumber === weekNumber) } : state.week),
  useAllWeekPlans: () => state.all,
  usePlanWeek: () => ({ mutate: planWeekMutate, isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile } = await import('./planMenus.testutil')

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const meso = (current: number): Mesocycle => ({ id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active', startDate: monday(current - 1), endDate: null, createdAt: '2026-01-01T00:00:00Z' })

const PROGRAM: Program = { id: 'prog-1', userId: 'user-1', name: 'Test Program', workoutDays: [], schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent' }

/** A weekday run in its week `current` with weeks 1 to `current` planned. */
function weekdayRun(current: number) {
  state.mesos = { data: [meso(current)], isLoading: false }
  state.program = PROGRAM
  state.sequence = []
  const weeks = Array.from({ length: current }, (_, i) => week(i + 1))
  state.all = { data: weeks, isLoading: false }
  state.week = { data: weeks, isLoading: false }
}

/** A sequence run in its cycle `current` with cycles 1 to `current` planned. */
function sequenceRun(current: number) {
  state.mesos = { data: [meso(current)], isLoading: false }
  state.program = { ...PROGRAM, scheduleType: 'sequence', schedule: EMPTY_SCHEDULE }
  state.sequence = [{ id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-1' }]
  state.cycle = current
  const cycles = Array.from({ length: current }, (_, i) => sequencePlan(i + 1))
  state.all = { data: cycles, isLoading: false }
  state.week = { data: cycles, isLoading: false }
}

function noRun() {
  state.mesos = { data: [], isLoading: false }
  state.program = PROGRAM
  state.all = { data: [], isLoading: false }
  state.week = { data: [], isLoading: false }
}

function Probe() {
  const location = useLocation()
  return <div data-testid="at">{`AT ${location.pathname}${location.search}`}</div>
}
/** Where the tests send the page the way START does: a `navigate` to a path with a query. */
function Go() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/plan?week=1')}>GO TO /plan?week=1</button>
}
const at = () => screen.getByTestId('at').textContent
const ui = (path = '/plan', props: React.ComponentProps<typeof PlanPage> = {}) => (
  <MemoryRouter initialEntries={[path]}>
    <PlanPage {...props} />
    <Probe />
    <Go />
  </MemoryRouter>
)
const tileLabels = () => Array.from(document.querySelectorAll('[data-week]')).map((el) => el.getAttribute('aria-label'))
const openTile = () => document.querySelector('[aria-current="true"]')?.getAttribute('data-week')
const programsTab = () => screen.queryByText('PROGRAMS TAB')

describe('which tab the page opens', () => {
  it('a program is running: the week (its tiles), not PROGRAMS', () => {
    weekdayRun(2)
    render(ui())
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    expect(programsTab()).toBeNull()
    expect(screen.getByRole('tab', { name: 'PLAN' }).getAttribute('aria-selected')).toBe('true')
  })

  it('no program is running: PROGRAMS (where PLAN is locked), not a week or a "no active run" page', () => {
    noRun()
    render(ui())
    expect(programsTab()).not.toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()
    expect(screen.queryByText(/NO ACTIVE/i)).toBeNull()
    expect(screen.queryByText('START A PROGRAM →')).toBeNull()
    expect(planWeekMutate).not.toHaveBeenCalled() // and nothing is planned for a run that doesn't exist
  })

  it('/program (initialTab "programs"): PROGRAMS even with a program running; PLAN then opens the week', () => {
    weekdayRun(2)
    render(ui('/program', { initialTab: 'programs' }))
    expect(programsTab()).not.toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    expect(tileLabels()).toHaveLength(3)
    expect(programsTab()).toBeNull()
  })

  it('PROGRAMS by a tap, PLAN by a tap, with a program running', () => {
    weekdayRun(2)
    render(ui())
    fireEvent.click(screen.getByRole('tab', { name: 'PROGRAMS' }))
    expect(programsTab()).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    expect(programsTab()).toBeNull()
    expect(tileLabels()).toHaveLength(3)
  })

  it('with no program running Plan can\'t be opened, whatever the tab was asked: PLAN is locked, so the shell never draws a week without a run', () => {
    noRun()
    render(ui())
    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' })) // the stand-in's tabs aren't locked: the shell must hold
    expect(programsTab()).not.toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()
  })

  it('a program that finishes under an open Plan takes the page to PROGRAMS (a tab chosen earlier is not kept for a run that isn\'t there)', () => {
    weekdayRun(2)
    const view = render(ui())
    fireEvent.click(screen.getByRole('tab', { name: 'PROGRAMS' }))
    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    expect(tileLabels()).toHaveLength(3)

    noRun()
    view.rerender(ui())

    expect(programsTab()).not.toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()
  })

  it('a sequence run opens its cycle\'s week too (CYCLE tiles), not PROGRAMS', () => {
    sequenceRun(2)
    render(ui())
    expect(tileLabels()).toEqual(['CYCLE 1 · DONE', 'CYCLE 2 · THIS CYCLE', 'CYCLE 3 · NOT PLANNED'])
    expect(programsTab()).toBeNull()
  })
})

describe('while the run list is not known, and when it could not be read', () => {
  it('while it is out: the opening spinner (board 12), not PROGRAMS (an unknown answer is not "no program running")', () => {
    weekdayRun(2)
    state.mesos = { data: undefined, isLoading: true }
    render(ui())
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(programsTab()).toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()
    expect(planWeekMutate).not.toHaveBeenCalled()
  })

  it('when it failed with nothing to show: "COULDN\'T LOAD PLAN" and the real reason, not PROGRAMS and its "no program running"', () => {
    weekdayRun(2)
    state.mesos = { data: undefined, isLoading: false, isError: true, error: { message: 'JWT expired', code: 'PGRST301' } }
    render(ui())
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText("COULDN'T LOAD PLAN")).toBeTruthy()
    expect(within(alert).getByText('JWT expired')).toBeTruthy()
    expect(programsTab()).toBeNull()
    expect(planWeekMutate).not.toHaveBeenCalled()
  })

  it('a failed refetch with the earlier answer still in hand shows the run\'s week, as every other read does', () => {
    weekdayRun(2)
    state.mesos = { data: [meso(2)], isLoading: false, isError: true, error: { message: 'refetch failed' } }
    render(ui())
    expect(tileLabels()).toHaveLength(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('on PROGRAMS (the route /program) it is the tab\'s to say: the shell does not take the page away from it', () => {
    state.mesos = { data: undefined, isLoading: false, isError: true, error: { message: 'JWT expired' } }
    render(ui('/program', { initialTab: 'programs' }))
    expect(programsTab()).not.toBeNull()
    expect(screen.queryByText("COULDN'T LOAD PLAN")).toBeNull()
  })
})

describe('START\'s one-shot ?week=1', () => {
  it('opens Plan on week 1 of a run that is in week 3, takes `week` out of the address, and plans nothing', () => {
    weekdayRun(3)
    render(ui('/plan?week=1'))

    expect(openTile()).toBe('1')
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy() // week 1 of a run in week 3 is a past week
    expect(at()).toBe('AT /plan')
    expect(planWeekMutate).not.toHaveBeenCalled()
  })

  it('the FIRST render is already on that week: no frame of the current week before an effect moves it (a server render runs no effect)', () => {
    weekdayRun(3)
    const html = renderToString(ui('/plan?week=1'))
    const opened = new DOMParser().parseFromString(html, 'text/html').querySelector('[aria-current="true"]')
    expect(opened?.getAttribute('data-week')).toBe('1')
    // ... and without it, the first render is the current week
    const plain = new DOMParser().parseFromString(renderToString(ui('/plan')), 'text/html').querySelector('[aria-current="true"]')
    expect(plain?.getAttribute('data-week')).toBe('3')
  })

  it('a sequence run\'s FIRST render is already on cycle 1 too, not on its current cycle (a server render runs no effect)', () => {
    sequenceRun(3)
    const html = renderToString(ui('/plan?week=1'))
    const opened = new DOMParser().parseFromString(html, 'text/html').querySelector('[aria-current="true"]')
    expect(opened?.getAttribute('data-week')).toBe('1')
    // ... and without it, the first render is the current cycle
    const plain = new DOMParser().parseFromString(renderToString(ui('/plan')), 'text/html').querySelector('[aria-current="true"]')
    expect(plain?.getAttribute('data-week')).toBe('3')
  })

  it('without it, Plan opens on the current week (week 3 of the same run): the param is what moves it', () => {
    weekdayRun(3)
    render(ui('/plan'))
    expect(openTile()).toBe('3')
    expect(screen.queryByText('PAST WEEK · READ ONLY')).toBeNull()
  })

  it('from the PROGRAMS tab on /plan, where START leaves from: Plan opens, on week 1, and the address is /plan', () => {
    weekdayRun(3)
    render(ui('/plan'))
    fireEvent.click(screen.getByRole('tab', { name: 'PROGRAMS' }))
    expect(programsTab()).not.toBeNull()

    fireEvent.click(screen.getByText('GO TO /plan?week=1'))

    expect(programsTab()).toBeNull()
    expect(openTile()).toBe('1')
    expect(at()).toBe('AT /plan')
  })

  it('it is one-shot: the week it asked for is only where Plan opens, and the person\'s own taps after that are theirs', () => {
    weekdayRun(3)
    render(ui('/plan?week=1'))
    expect(openTile()).toBe('1')

    openWeekTile('WEEK 3')
    expect(openTile()).toBe('3')
    openWeekTile('WEEK 2')
    expect(openTile()).toBe('2')
    expect(at()).toBe('AT /plan')
  })

  it.each(['0', '-1', '1.5', 'abc', '', '1e2', ' 1', '99999999999999999999'])('?week=%s is no week: Plan opens on the current week as ever, and the param is taken out all the same', (value) => {
    weekdayRun(3)
    render(ui(`/plan?week=${encodeURIComponent(value)}`))
    expect(openTile()).toBe('3')
    expect(at()).toBe('AT /plan')
  })

  it('a week that has no tile (week 9 of a run in week 3) opens the current week, not a week that is not on the strip', () => {
    weekdayRun(3)
    render(ui('/plan?week=9'))
    expect(openTile()).toBe('3')
    expect(at()).toBe('AT /plan')
  })

  it('only `week` is taken out of the address: another parameter stays', () => {
    weekdayRun(3)
    render(ui('/plan?week=1&from=nav'))
    expect(openTile()).toBe('1')
    expect(at()).toBe('AT /plan?from=nav')
  })

  it('a sequence run opens on cycle 1 of its three', () => {
    sequenceRun(3)
    render(ui('/plan?week=1'))
    expect(openTile()).toBe('1')
    expect(screen.getByText('PAST CYCLE · READ ONLY')).toBeTruthy()
    expect(at()).toBe('AT /plan')
  })

  it('the one-shot opens Plan even when the page was on PROGRAMS (initialTab) with a program running: START\'s target is the week', () => {
    weekdayRun(3)
    render(ui('/plan?week=1', { initialTab: 'programs' }))
    expect(programsTab()).toBeNull()
    expect(openTile()).toBe('1')
  })

  it.each(['0', '-1', 'abc', ''])('?week=%s is no week for a page opened on PROGRAMS either: it stays there (a junk parameter must not take the tab away), and the param is taken out', (value) => {
    weekdayRun(3)
    render(ui(`/plan?week=${encodeURIComponent(value)}`, { initialTab: 'programs' }))
    expect(programsTab()).not.toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()
    expect(at()).toBe('AT /plan')
  })

  it('with no program running yet (the run list not read again) it does not draw a week for a run that isn\'t there: PROGRAMS, until the run is', () => {
    noRun()
    const view = render(ui('/plan?week=1'))
    expect(programsTab()).not.toBeNull()
    expect(document.querySelector('[data-week]')).toBeNull()

    weekdayRun(3)
    view.rerender(ui('/plan?week=1'))
    expect(programsTab()).toBeNull()
    expect(openTile()).toBe('1')
  })
})
