// @vitest-environment jsdom
import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { addDays, differenceInCalendarWeeks, format, set, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, SequenceItem, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { createFakeSupabase, fakeWeekPlan, fakeWeekPlanSet, type FakePlanWeek, type FakeWeekPlanRow } from './fakeWeekPlanDb.testutil'

// Chunk 52 (TASKS-1.2 "Plan's header"; SPEC Weeks and copying [1.2] → "when a week (cycle) gets planned: when it starts, or earlier when
// the user taps PLAN FORWARD on it. Opening it doesn't plan it"; SPEC Scheduling → Sequence (PLAN FORWARD per cycle); Screens → Plan
// screen → Week row; DECISIONS 131 and the carry notes for 52). When a week gets planned, at the layer where the calls are made.
//
// It mocks NOTHING of Plan's own code below the screen: the real PlanPage, the real week-plan hooks (useWeekPlans, useAllWeekPlans,
// usePlanWeek), the real usePlanForward and the real weekPlanService.ts run against an in-memory Supabase (fakeWeekPlanDb.testutil.ts),
// which answers `v2_plan_week` by making that week's rows, so the tiles change the way they do on a real run once a week is planned.
// What every test asserts is the list of calls that reached the database client: a `v2_plan_week` with its week, or none.
//
// The fixtures tell the right data source from the wrong one:
//  - the run's weeks are chosen so that the week PLAN FORWARD plans (the first unplanned week after the current one) is neither the
//    current week plus one nor the highest planned week plus one: planned {1, 2, 3, 5} with week 3 current plans 4, and {1, 2, 3, 4}
//    plans 5;
//  - a sequence run's cycle (7, 8) is told from its slot positions (0, 1, 2) and from the calendar week it is in (3): the call carries
//    the cycle;
//  - the week that is open is not the current week when the browsing tests tap tiles, so a plan of "the week on screen" is not one of
//    "the current week".
// Break proofs (chunk 52's report): the planning effect planning the open week; PLAN FORWARD naming the current week plus one or the
// highest planned week plus one; the effect restored to plan every week shown. Attempt 2 (review 1, F2) adds the last describe: the current
// week moving on under an open Plan, which is where "the open week" and "the current week" part; the break is the effect naming the open week.
// Its mutation sweep of the planning effect and its retry added three more: a run that has not started yet plans week 1 (never week 0), a
// second run in the same week is tried on its own, and a failed attempt does not hold back the week that starts under the open page.

afterEach(() => {
  cleanup()
  queryClient.clear()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  queryClient.setDefaultOptions({ queries: { retry: false } })
})

// ─── The run ──────────────────────────────────────────────────────────────────

const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const wdPull: WorkoutDay = { id: 'wd-pull', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }
const SEQUENCE: SequenceItem[] = [
  { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-push' },
  { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: 'wd-pull' },
  { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: null },
]

const state = vi.hoisted(() => ({
  meso: null as unknown as Mesocycle,
  program: null as unknown as Program,
  sequence: false,
  cycle: 1,
  defaultHasSets: undefined as boolean | undefined,
  defaultAsked: [] as Array<{ ids: string[]; enabled: boolean }>,
}))

let fake = createFakeSupabase([])

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [state.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [wdPush, wdPull], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: state.sequence ? SEQUENCE : [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false, error: null }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
// Only the default's read is stood in for (it reads the program's tables, which this file has no rows for); the mutation is the real one.
vi.mock('./usePlanForward', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePlanForward')>()),
  useDefaultHasSets: (ids: readonly string[], enabled: boolean) => {
    state.defaultAsked.push({ ids: [...ids], enabled })
    return { data: enabled ? state.defaultHasSets : undefined }
  },
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile } = await import('./planMenus.testutil')

/** The Monday of the week `n` of a run whose current week is `current`: today is in week `current`, whatever day the suite runs on. */
function startOf(current: number): string {
  return format(startOfWeek(subWeeks(new Date(), current - 1), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

interface RunOptions {
  /** The current week (cycle) of the run. */
  current: number
  /** The calendar week the run is in, when it is not the current one: a sequence run's cycle is not the calendar week (chunk 35). */
  calendarWeek?: number
  /** The week (cycle) numbers that have plan rows. */
  planned: number[]
  planningType?: Program['planningType']
  sequence?: boolean
  /** What `v2_plan_week` does (default: it plans nothing, as a call on a week that is planned already). */
  planWeek?: FakePlanWeek
}

// A planned session holds one set, so it is not an empty occurrence (an empty one is never a source, DECISIONS 42 (b)).
function sessionRow(id: string, week: number, over: Partial<FakeWeekPlanRow>): FakeWeekPlanRow {
  return fakeWeekPlan(id, week, { sets: [fakeWeekPlanSet(id, `${id}-set`, `pe-${over.workout_day_id}`)] }, over)
}

function rowsOfWeek(week: number, sequence: boolean): FakeWeekPlanRow[] {
  if (sequence) {
    return [
      sessionRow(`wp-${week}-s0`, week, { workout_day_id: 'wd-push', sequence_position: 0 }),
      sessionRow(`wp-${week}-s1`, week, { workout_day_id: 'wd-pull', sequence_position: 1 }),
    ]
  }
  return [sessionRow(`wp-${week}-push`, week, { workout_day_id: 'wd-push' }), sessionRow(`wp-${week}-pull`, week, { workout_day_id: 'wd-pull' })]
}

function useRun({ current, calendarWeek = current, planned, planningType = 'week_dependent', sequence = false, planWeek }: RunOptions) {
  state.sequence = sequence
  state.cycle = current
  state.meso = {
    id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
    startDate: startOf(calendarWeek), endDate: null, createdAt: '2026-01-01T00:00:00Z',
  }
  state.program = {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', workoutDays: [],
    schedule: sequence ? EMPTY_SCHEDULE : { ...EMPTY_SCHEDULE, monday: 'wd-push', wednesday: 'wd-pull' },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType,
    ...(sequence ? { scheduleType: 'sequence' as const } : {}),
  }
  fake = createFakeSupabase(
    planned.flatMap((week) => rowsOfWeek(week, sequence)),
    { planWeek: planWeek ?? (() => []) },
  )
}

/** `v2_plan_week` makes the week's rows, as the real function does for a week with no rows. */
const plans = (sequence = false) => (week: number) => rowsOfWeek(week, sequence)

function renderPlan() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The same tree renderPlan() draws, for a rerender (a run or a cycle that changes under a mounted Plan). */
const planTree = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>
  </QueryClientProvider>
)

const FOUND = { timeout: 3000 }
const planCalls = () => fake.writes.filter((w) => w.table === 'rpc' && w.method === 'v2_plan_week').map((w) => w.args[0])
const calledWeeks = () => planCalls().map((args) => (args as { p_week_number: number }).p_week_number)
const tileLabels = () => Array.from(document.querySelectorAll<HTMLElement>('[data-week]')).map((el) => el.getAttribute('aria-label'))
/** The strip once the run's weeks have been read. */
const stripOpen = () => screen.findByLabelText(/^(Weeks|Cycles) of this program$/, {}, FOUND)

// ─── Opening a week plans nothing ─────────────────────────────────────────────

describe('opening Plan, and tapping tiles, plans nothing', () => {
  it('weeks 1 and 2 planned, week 2 current: no week is planned by opening Plan or by opening any of its tiles', async () => {
    useRun({ current: 2, planned: [1, 2] })
    renderPlan()
    await stripOpen()
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])

    openWeekTile('WEEK 3') // the card
    await screen.findByText("Week 3 isn't planned yet", {}, FOUND)
    openWeekTile('WEEK 1')
    await screen.findByText('PAST WEEK · READ ONLY', {}, FOUND)
    openWeekTile('WEEK 2')
    await screen.findByLabelText('Week 2 options', {}, FOUND)

    expect(planCalls()).toEqual([])
    // not one write of any kind: Plan only read what it drew
    expect(fake.writes).toEqual([])
  })

  it('the week that is open is never planned for being open: a week ahead has its card and no call', async () => {
    useRun({ current: 3, planned: [1, 2, 3] })
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 4')
    await screen.findByText("Week 4 isn't planned yet", {}, FOUND)
    // let any effect run
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(planCalls()).toEqual([])
  })

  it('a week that passed unplanned is NOT PLANNED, read-only, and nothing is written for it (DECISIONS 131): no PLAN FORWARD, no actions', async () => {
    useRun({ current: 3, planned: [2, 3] })
    renderPlan()
    await stripOpen()
    expect(tileLabels()).toEqual(['WEEK 1 · NOT PLANNED', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · NOT PLANNED'])

    openWeekTile('WEEK 1')
    await screen.findByText("Week 1 wasn't planned", {}, FOUND)
    // nothing went wrong, so the note is announced as a status, not as an alert
    expect(screen.getByText("Week 1 wasn't planned").parentElement?.getAttribute('role')).toBe('status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByText('PLAN FORWARD')).toBeNull()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByLabelText('Week 1 options')).toBeNull()
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(fake.writes).toEqual([])
  })
})

// ─── The current week plans itself, and only it ───────────────────────────────

describe('the current week is planned when it has no rows, once, and nothing else is', () => {
  it('week 2 current with no rows (week 1 planned): one v2_plan_week for week 2, and nothing for the other tiles however many are opened', async () => {
    useRun({ current: 2, planned: [1], planWeek: plans() })
    renderPlan()
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(planCalls()[0]).toEqual({ p_mesocycle_id: 'meso-1', p_week_number: 2 })

    // the week appears once planned, and the page draws it
    await screen.findByLabelText('Week 2 options', {}, FOUND)
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])

    openWeekTile('WEEK 3')
    openWeekTile('WEEK 1')
    openWeekTile('WEEK 2')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calledWeeks()).toEqual([2])
  })

  it('under StrictMode, as the app runs (effects run, clean up and run again), the current week is planned once', async () => {
    useRun({ current: 2, planned: [1], planWeek: plans() })
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/plan']}>
            <PlanPage />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    )
    await screen.findByLabelText('Week 2 options', {}, FOUND)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calledWeeks()).toEqual([2])
  })

  it('while the current week is being planned the screen says so, and a failure shows the real message with TRY AGAIN (which plans the same week again)', async () => {
    let failing = true
    useRun({
      current: 2,
      planned: [1],
      planWeek: (week) => (failing ? { message: 'v2_plan_week: row-level security refused the plan', code: '42501' } : rowsOfWeek(week, false)),
    })
    renderPlan()

    await screen.findByText("Week 2 isn't planned yet", {}, FOUND)
    await screen.findByText('v2_plan_week: row-level security refused the plan', {}, FOUND) // the server's message, not a fixed line
    expect(screen.queryByText('Planning this week now.')).toBeNull()
    expect(calledWeeks()).toEqual([2]) // a failure does not loop

    failing = false
    fireEvent.click(screen.getByText('TRY AGAIN'))
    await screen.findByLabelText('Week 2 options', {}, FOUND)
    expect(calledWeeks()).toEqual([2, 2])
  })

  it('planning the current week failing with no message says "Something went wrong."; with none and the phone offline, "You may be offline." (a real message still wins)', async () => {
    useRun({ current: 2, planned: [1], planWeek: () => ({ message: '' }) })
    renderPlan()
    await screen.findByText("Week 2 isn't planned yet", {}, FOUND)
    await screen.findByText('Something went wrong.', {}, FOUND)
    expect(screen.getByRole('alert').textContent).toContain("Week 2 isn't planned yet")
    expect(screen.queryByText('You may be offline.')).toBeNull()

    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      cleanup()
      queryClient.clear()
      useRun({ current: 2, planned: [1], planWeek: () => ({ message: '' }) })
      renderPlan()
      await screen.findByText('You may be offline.', {}, FOUND)
      expect(screen.queryByText('Something went wrong.')).toBeNull()

      cleanup()
      queryClient.clear()
      useRun({ current: 2, planned: [1], planWeek: () => ({ message: 'Failed to fetch' }) })
      renderPlan()
      await screen.findByText('Failed to fetch', {}, FOUND)
      expect(screen.queryByText('You may be offline.')).toBeNull()
    } finally {
      online.mockRestore()
    }
  })

  it('a sequence run plans the current cycle only (cycle 7, whose slots sit at positions 0 and 1), not a cycle the slot positions name', async () => {
    useRun({ current: 7, calendarWeek: 3, planned: [6], sequence: true, planWeek: plans(true) })
    renderPlan()
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(planCalls()[0]).toEqual({ p_mesocycle_id: 'meso-1', p_week_number: 7 })
    await screen.findByLabelText('Cycle 7 options', {}, FOUND)
    expect(calledWeeks()).toEqual([7])
  })

  // The effect names `tilesCurrent`, the current week clamped to 1; the unclamped week of a run that starts next Monday is 0, and
  // `v2_plan_week` for week 0 is not a week of the run. Break proof (attempt 2's sweep): `weekNumber: currentWeek` in the effect.
  it('a run that has not started yet (its first week begins next Monday) is in week 1: with no rows, week 1 is planned, never week 0', async () => {
    useRun({ current: 0, planned: [], planWeek: plans() })
    renderPlan()
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(planCalls()[0]).toEqual({ p_mesocycle_id: 'meso-1', p_week_number: 1 })
    await screen.findByLabelText('Week 1 options', {}, FOUND)
    expect(calledWeeks()).toEqual([1])
  })

  // The effect's comment says a week is tried "once per run and week", so a spent attempt belongs to the run it was made for. (A run
  // changes under a mounted Plan only when the runs are read again; the PROGRAMS tab unmounts the screen.) Break proof (attempt 2's sweep):
  // the attempt key without the run's id.
  it('once per run and week: another run, in the same week, is tried on its own — the spent attempt was the first run\'s', async () => {
    useRun({ current: 2, planned: [1], planWeek: plans() })
    const view = renderPlan()
    await waitFor(() => expect(calledWeeks()).toEqual([2]), FOUND)
    await screen.findByLabelText('Week 2 options', {}, FOUND)

    // another run, in the same calendar week, with its own database and no rows at all: its current week (2) has none
    fake = createFakeSupabase([], { planWeek: plans() })
    state.meso = { ...state.meso, id: 'meso-2' }
    view.rerender(planTree())
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(planCalls()[0]).toEqual({ p_mesocycle_id: 'meso-2', p_week_number: 2 })
  })
})

// ─── PLAN FORWARD ─────────────────────────────────────────────────────────────

describe('PLAN FORWARD plans the week of the tile that carries it, then the next one appears', () => {
  it('week 3 (NOT PLANNED, after the current week 2): the card, no call until PLAN FORWARD; then one call for week 3, week 4 is NOT PLANNED and there is no tile beyond it', async () => {
    useRun({ current: 2, planned: [1, 2], planWeek: plans() })
    renderPlan()
    await stripOpen()

    openWeekTile('WEEK 3')
    await screen.findByText("Week 3 isn't planned yet", {}, FOUND)
    expect(screen.getByText('It plans itself when the week starts. Plan it now if you want to set its numbers ahead.')).toBeTruthy()
    expect(planCalls()).toEqual([]) // opening it did not plan it

    fireEvent.click(screen.getByText('PLAN FORWARD'))
    await waitFor(() => expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · PLANNED', 'WEEK 4 · NOT PLANNED']), FOUND)
    expect(planCalls()).toEqual([{ p_mesocycle_id: 'meso-1', p_week_number: 3 }])
    expect(document.querySelector('[data-week="5"]')).toBeNull() // no tile beyond the first unplanned one
    // the open week is week 3 and is a planned week now: its card is gone, its actions are there
    await screen.findByLabelText('Week 3 options', {}, FOUND)
    expect(screen.queryByText("Week 3 isn't planned yet")).toBeNull()
    expect(screen.queryByText('PLAN FORWARD')).toBeNull()
  })

  it('planned {1, 2, 3, 5}, week 3 current: PLAN FORWARD is on week 4 (the first unplanned week after the current one) and plans week 4, not week 6', async () => {
    useRun({ current: 3, planned: [1, 2, 3, 5], planWeek: plans() })
    renderPlan()
    await stripOpen()
    // the strip goes no further than the first unplanned week after the current one, though week 5 is planned
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · NOT PLANNED'])

    openWeekTile('WEEK 4')
    fireEvent.click(await screen.findByText('PLAN FORWARD', {}, FOUND))
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(calledWeeks()).toEqual([4])
    // week 5 was planned and still is: no new call names it, and the strip now runs to the week after the planned ones
    await waitFor(() => expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · PLANNED', 'WEEK 5 · PLANNED', 'WEEK 6 · NOT PLANNED']), FOUND)
  })

  it('planned {1, 2, 3, 4}, week 3 current: PLAN FORWARD is on week 5 and plans week 5, not week 4 (the current week plus one)', async () => {
    useRun({ current: 3, planned: [1, 2, 3, 4], planWeek: plans() })
    renderPlan()
    await stripOpen()
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · PLANNED', 'WEEK 5 · NOT PLANNED'])

    openWeekTile('WEEK 5')
    fireEvent.click(await screen.findByText('PLAN FORWARD', {}, FOUND))
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(calledWeeks()).toEqual([5])
  })

  it('a sequence run: PLAN FORWARD plans the next CYCLE (8), told from the slot positions (0, 1, 2), and cycle 9 then appears as NOT PLANNED', async () => {
    useRun({ current: 7, calendarWeek: 3, planned: [6, 7], sequence: true, planWeek: plans(true) })
    renderPlan()
    await stripOpen()
    expect(tileLabels().slice(-3)).toEqual(['CYCLE 6 · DONE', 'CYCLE 7 · THIS CYCLE', 'CYCLE 8 · NOT PLANNED'])

    openWeekTile('CYCLE 8')
    await screen.findByText("Cycle 8 isn't planned yet", {}, FOUND)
    expect(screen.getByText('CYCLE 8 WILL HAVE')).toBeTruthy()
    // the slots of the cycle, in order, a rest slot saying so; and the cycle it takes (each slot is its own history)
    const list = screen.getByText('CYCLE 8 WILL HAVE').parentElement as HTMLElement
    expect(Array.from(list.querySelectorAll('span')).map((el) => el.textContent).filter((t) => t && !t.startsWith('CYCLE'))).toEqual(['SLOT 1', 'Push Day', 'SLOT 2', 'Pull Day', 'SLOT 3', 'Rest day'])
    expect(screen.getByText("Takes cycle 7's sets and set types. Numbers come with COPY. Cycle 9 opens once cycle 8 is planned.")).toBeTruthy()
    expect(planCalls()).toEqual([])
    fireEvent.click(screen.getByText('PLAN FORWARD'))
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(planCalls()[0]).toEqual({ p_mesocycle_id: 'meso-1', p_week_number: 8 })
    await waitFor(() => expect(tileLabels().slice(-2)).toEqual(['CYCLE 8 · PLANNED', 'CYCLE 9 · NOT PLANNED']), FOUND)
    expect(document.querySelector('[data-week="10"]')).toBeNull()
  })

  it('the card lists the workouts the week will have, by the week\'s own weekdays, and says what it takes', async () => {
    useRun({ current: 2, planned: [1, 2] })
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    await screen.findByText('WEEK 3 WILL HAVE', {}, FOUND)
    const list = screen.getByText('WEEK 3 WILL HAVE').parentElement as HTMLElement
    expect(within(list).getByText('MON')).toBeTruthy()
    expect(within(list).getByText('Push Day')).toBeTruthy()
    expect(within(list).getByText('WED')).toBeTruthy()
    expect(within(list).getByText('Pull Day')).toBeTruthy()
    // a workout name wraps inside its row (an unbroken 80-letter name must not run past the screen: the 375 px check)
    expect(within(list).getByText('Pull Day').style.overflowWrap).toBe('anywhere')
    expect(within(list).getByText('Pull Day').style.minWidth).toBe('0px')
    // a week-dependent run takes each workout's last planned week with sets: week 2, and numbers come with COPY
    expect(screen.getByText("Takes week 2's sets and set types. Numbers come with COPY. Week 4 opens once week 3 is planned.")).toBeTruthy()
  })

  it('the source it names is an EARLIER week: planned {1, 2, 3, 5} with week 3 current, week 4\'s card takes week 3\'s (not week 5\'s)', async () => {
    useRun({ current: 3, planned: [1, 2, 3, 5] })
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 4')
    expect(await screen.findByText("Takes week 3's sets and set types. Numbers come with COPY. Week 5 opens once week 4 is planned.", {}, FOUND)).toBeTruthy()
  })

  it('a stable run takes the default\'s sets, set types and rep targets', async () => {
    useRun({ current: 2, planned: [1, 2], planningType: 'stable' })
    state.defaultHasSets = true
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    expect(await screen.findByText("Takes the default's sets, set types and rep targets. Numbers come with COPY. Week 4 opens once week 3 is planned.", {}, FOUND)).toBeTruthy()
  })

  it('a failed PLAN FORWARD shows "Couldn\'t plan week 3." and the server\'s message, plans nothing, and the button works again', async () => {
    let failing = true
    useRun({ current: 2, planned: [1, 2], planWeek: (week) => (failing ? { message: 'v2_plan_week: week 3 would skip a week', code: 'P0001' } : rowsOfWeek(week, false)) })
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    fireEvent.click(await screen.findByText('PLAN FORWARD', {}, FOUND))

    await screen.findByText("Couldn't plan week 3.", {}, FOUND)
    expect(screen.getByText('v2_plan_week: week 3 would skip a week')).toBeTruthy()
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED']) // nothing was planned
    expect((screen.getByText('PLAN FORWARD').closest('button') as HTMLButtonElement).disabled).toBe(false)

    failing = false
    fireEvent.click(screen.getByText('PLAN FORWARD'))
    await waitFor(() => expect(tileLabels()).toContain('WEEK 4 · NOT PLANNED'), FOUND)
    expect(calledWeeks()).toEqual([3, 3])
  })

  it('a failure with no message says "Something went wrong."; with none and the phone offline, "You may be offline." (a real message still wins)', async () => {
    useRun({ current: 2, planned: [1, 2], planWeek: () => ({ message: '' }) })
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    fireEvent.click(await screen.findByText('PLAN FORWARD', {}, FOUND))
    await screen.findByText("Couldn't plan week 3.", {}, FOUND)
    expect(screen.getByText('Something went wrong.')).toBeTruthy()
    expect(screen.queryByText('You may be offline.')).toBeNull()

    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      cleanup()
      queryClient.clear()
      useRun({ current: 2, planned: [1, 2], planWeek: () => ({ message: '' }) })
      renderPlan()
      await stripOpen()
      openWeekTile('WEEK 3')
      fireEvent.click(await screen.findByText('PLAN FORWARD', {}, FOUND))
      await screen.findByText("Couldn't plan week 3.", {}, FOUND)
      expect(screen.getByText('You may be offline.')).toBeTruthy()
      expect(screen.queryByText('Something went wrong.')).toBeNull()
    } finally {
      online.mockRestore()
    }
  })

  it('two presses in one instant make one call (the second finds the first in flight)', async () => {
    let release: (rows: FakeWeekPlanRow[]) => void = () => {}
    useRun({ current: 2, planned: [1, 2], planWeek: () => new Promise<FakeWeekPlanRow[]>((resolve) => (release = resolve)) })
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    const button = (await screen.findByText('PLAN FORWARD', {}, FOUND)).closest('button') as HTMLButtonElement

    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    await waitFor(() => expect(planCalls()).toHaveLength(1), FOUND)
    expect(screen.getByText('PLANNING…')).toBeTruthy()
    expect((screen.getByText('PLANNING…').closest('button') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      release(rowsOfWeek(3, false))
    })
    await waitFor(() => expect(tileLabels()).toContain('WEEK 4 · NOT PLANNED'), FOUND)
    expect(planCalls()).toHaveLength(1)
  })
})

// ─── P1.2-10: a stable run's default with nothing in it ───────────────────────

describe('PLAN FORWARD on a stable run whose default has no set (P1.2-10)', () => {
  it('is disabled and says "Nothing to plan from": pressing it calls nothing; the default is read for the week\'s own workouts', async () => {
    useRun({ current: 2, planned: [1, 2], planningType: 'stable', planWeek: plans() })
    state.defaultHasSets = false
    state.defaultAsked = []
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')

    await screen.findByText('Nothing to plan from', {}, FOUND)
    const button = screen.getByText('PLAN FORWARD').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(planCalls()).toEqual([])
    // asked of the workouts the week will have (Push and Pull), on a stable run only
    expect(state.defaultAsked.filter((a) => a.enabled).map((a) => a.ids)).toContainEqual(['wd-push', 'wd-pull'])
  })

  it('a default with sets plans, on the same card', async () => {
    useRun({ current: 2, planned: [1, 2], planningType: 'stable', planWeek: plans() })
    state.defaultHasSets = true
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    await screen.findByText('PLAN FORWARD', {}, FOUND)
    expect(screen.queryByText('Nothing to plan from')).toBeNull()
    fireEvent.click(screen.getByText('PLAN FORWARD'))
    await waitFor(() => expect(calledWeeks()).toEqual([3]), FOUND)
  })

  it('a week-dependent run never reads the default, and is never blocked by it', async () => {
    useRun({ current: 2, planned: [1, 2], planWeek: plans() })
    state.defaultHasSets = false
    state.defaultAsked = []
    renderPlan()
    await stripOpen()
    openWeekTile('WEEK 3')
    await screen.findByText('PLAN FORWARD', {}, FOUND)
    expect(state.defaultAsked.filter((a) => a.enabled)).toEqual([])
    expect(screen.queryByText('Nothing to plan from')).toBeNull()
    expect((screen.getByText('PLAN FORWARD').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })
})

// ─── The current week moves on while Plan is open ─────────────────────────────

// Review 1, F2 (RULES: "A writer that takes its target from what the screen has open is tested with something open other than what the
// screen opens on"). On opening, the week that is open IS the current week, so a plan of "the open week" and a plan of "the current week" are
// the same call and every test above passes under either. They part when the current week moves on under an open page: `computeWeekNumber`
// reads `new Date()`, `useToday` re-renders the screen at midnight and whenever the tab becomes visible again, and the week that is open stays
// the one the user was on (it follows a run change only). The planning effect's own comment claims the case ("a new current week (Plan left
// open over Sunday midnight) is tried on its own"): the call must name the NEW current week, once, and not the week still on screen.
//
// The clock is moved with a fake `Date` alone (timers stay real, so the queries and the waits run as everywhere else in this file). Its
// dates are derived from a Monday and printed by the first test (Checks that lied #21), not typed as "Sunday" and "Monday".
describe('the current week moves on while Plan is open: the new current week is planned by its own call, and the week on screen is not', () => {
  const WEEK_1_MONDAY = startOfWeek(new Date(2026, 9, 12), { weekStartsOn: 1 })
  /** Sunday, ten minutes to midnight: the last night of week 2 of a run whose week 1 starts on WEEK_1_MONDAY. */
  const LAST_NIGHT_OF_WEEK_2 = set(addDays(WEEK_1_MONDAY, 13), { hours: 23, minutes: 50, seconds: 0, milliseconds: 0 })
  /** Monday, one minute past midnight: the first minute of week 3. */
  const FIRST_MINUTE_OF_WEEK_3 = set(addDays(WEEK_1_MONDAY, 14), { hours: 0, minutes: 1, seconds: 0, milliseconds: 0 })

  afterEach(() => {
    vi.useRealTimers()
    delete (document as unknown as Record<string, unknown>).visibilityState // the own property the tests define; the prototype's reading is back
  })

  /** The tab becomes visible again: `useToday` reads the clock and re-renders the screen (it does the same at midnight). */
  async function tabBecomesVisible() {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  /** `useRun` for a run that is in `current` at the moment the (fake) clock reads: the start date follows the clock, so the weeks are as named. */
  function useRunAt(now: Date, options: RunOptions) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    useRun(options)
    expect(state.meso.startDate).toBe(format(WEEK_1_MONDAY, 'yyyy-MM-dd'))
  }

  it('the fixture: week 2 ends on a Sunday night and week 3 starts on a Monday', () => {
    expect([format(LAST_NIGHT_OF_WEEK_2, 'EEEE HH:mm'), format(FIRST_MINUTE_OF_WEEK_3, 'EEEE HH:mm')]).toEqual(['Sunday 23:50', 'Monday 00:01'])
    const weekOf = (date: Date) => differenceInCalendarWeeks(date, WEEK_1_MONDAY, { weekStartsOn: 1 }) + 1
    expect([weekOf(LAST_NIGHT_OF_WEEK_2), weekOf(FIRST_MINUTE_OF_WEEK_3)]).toEqual([2, 3])
  })

  it('weeks 1 and 2 planned, week 2 open on the Sunday night: nothing is planned; once Monday has come, exactly one call, for week 3 (not the open week 2)', async () => {
    useRunAt(LAST_NIGHT_OF_WEEK_2, { current: 2, planned: [1, 2], planWeek: plans() })
    renderPlan()
    await stripOpen()
    await waitFor(() => expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED']), FOUND)
    expect(calledWeeks()).toEqual([])

    vi.setSystemTime(FIRST_MINUTE_OF_WEEK_3)
    await tabBecomesVisible()
    await waitFor(() => expect(calledWeeks()).toEqual([3]), FOUND)
    // week 3 is planned now and is the current one; week 2 is a past week and the strip reaches the next unplanned week
    await waitFor(() => expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · NOT PLANNED']), FOUND)
    // what makes this test tell the two weeks apart: the week the user had open stays open (it follows a run change only), so the open
    // week (2) and the current week (3) are different weeks. If Plan ever follows the current week by itself, this stops holding and the
    // test needs another way to part them.
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('2')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calledWeeks()).toEqual([3])
  })

  it('week 2 was itself planned when Plan opened (that attempt is spent): the week that starts under the open page is still tried, by its own call — weeks 2, then 3', async () => {
    useRunAt(LAST_NIGHT_OF_WEEK_2, { current: 2, planned: [1], planWeek: plans() })
    renderPlan()
    await waitFor(() => expect(calledWeeks()).toEqual([2]), FOUND)
    await screen.findByLabelText('Week 2 options', {}, FOUND)

    vi.setSystemTime(FIRST_MINUTE_OF_WEEK_3)
    await tabBecomesVisible()
    await waitFor(() => expect(calledWeeks()).toEqual([2, 3]), FOUND)
    await waitFor(() => expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · NOT PLANNED']), FOUND)
  })

  // The effect re-runs when the current week moves although nothing about the planned weeks changed (week 2 had no rows and week 3 has
  // none), which only a dependency on the current week itself does. Break proof (attempt 2's sweep): `tilesCurrent` left out of the
  // effect's dependencies.
  it('week 2\'s own attempt failed (nothing was planned): the week that starts under the open page is still tried — weeks 2, then 3', async () => {
    let failing = true
    useRunAt(LAST_NIGHT_OF_WEEK_2, {
      current: 2,
      planned: [1],
      planWeek: (week) => (failing ? { message: 'v2_plan_week: row-level security refused the plan', code: '42501' } : rowsOfWeek(week, false)),
    })
    renderPlan()
    await screen.findByText('v2_plan_week: row-level security refused the plan', {}, FOUND)
    expect(calledWeeks()).toEqual([2]) // a failure does not loop

    failing = false
    vi.setSystemTime(FIRST_MINUTE_OF_WEEK_3)
    await tabBecomesVisible()
    await waitFor(() => expect(calledWeeks()).toEqual([2, 3]), FOUND)
    // week 3 is planned; week 2, which nobody planned, is a week that passed unplanned (131)
    await waitFor(() => expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · NOT PLANNED', 'WEEK 3 · THIS WEEK', 'WEEK 4 · NOT PLANNED']), FOUND)
  })

  it('the next day of the same week changes nothing: the tab coming back on the Monday after, with week 2 still the current week, plans nothing', async () => {
    useRunAt(set(addDays(WEEK_1_MONDAY, 7), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }), { current: 2, planned: [1, 2], planWeek: plans() })
    renderPlan()
    await stripOpen()
    vi.setSystemTime(set(addDays(WEEK_1_MONDAY, 9), { hours: 18, minutes: 0, seconds: 0, milliseconds: 0 })) // Wednesday of the same week
    await tabBecomesVisible()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · THIS WEEK', 'WEEK 3 · NOT PLANNED'])
    expect(calledWeeks()).toEqual([])
  })

  it('a sequence run: the current cycle moves on under the open Plan (cycle 2 to cycle 3): cycle 3 is planned, once, not the open cycle 2', async () => {
    useRun({ current: 2, calendarWeek: 1, planned: [1, 2], sequence: true, planWeek: plans(true) })
    const view = renderPlan()
    await stripOpen()
    await waitFor(() => expect(tileLabels()).toEqual(['CYCLE 1 · DONE', 'CYCLE 2 · THIS CYCLE', 'CYCLE 3 · NOT PLANNED']), FOUND)
    expect(calledWeeks()).toEqual([])

    // the last workout of cycle 2 is done and Plan's read of the current cycle answers again (the stand-in reads `state.cycle` on every render)
    state.cycle = 3
    view.rerender(planTree())
    await waitFor(() => expect(calledWeeks()).toEqual([3]), FOUND)
    await waitFor(() => expect(tileLabels()).toEqual(['CYCLE 1 · DONE', 'CYCLE 2 · DONE', 'CYCLE 3 · THIS CYCLE', 'CYCLE 4 · NOT PLANNED']), FOUND)
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-week')).toBe('2') // the open cycle stays 2, as above
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calledWeeks()).toEqual([3])
  })
})
