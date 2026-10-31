// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WeekPlan, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 51a (SPEC Plan screen [1.2] → Bottom: "CHANGE THE PROGRAM FROM WEEK N (or CYCLE N)"; TASKS 51a: "today's PlanPage gets 'CHANGE THE
// PROGRAM FROM WEEK N' / 'FROM CYCLE N' at the bottom of the week panel in this chunk — the only Plan change here"). This file
// proves the button and nothing behind it: where it is, the number it names, that a past week has none, and that it opens the
// route the app wires to the screen. N is chunk 45's `changeStartWeek` over the run's planned weeks and the sessions Plan knows
// are done or in progress, so the fixtures differ in exactly what N depends on: which plan rows are done and which are in progress.
// The second display follow-up (DECISIONS 172 (j), Adam, 2026-10-19: "The button follows the screen.") reads the screen's own
// statuses, so a session in progress is left as it is and the changes start the week after (the last describe below; the twin
// that holds the button against the screen's rule box on the same rows is PlanPage.changeProgramButton.screenRule.test.tsx).
// Chunk 52 (the header): the week body is drawn only for a week that has a plan and a run that has a schedule, and a past week, or the
// week PLAN FORWARD opens, has no button (boards 1b, 1c), so the run here has one scheduled workout and every week the tests open is planned.

// The run started two Mondays ago, so today is in week 3 whatever day this runs.
const startDate = format(startOfWeek(subWeeks(new Date(), 2), { weekStartsOn: 1 }), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1',
  userId: 'user-1',
  name: 'Test Meso',
  programId: 'prog-1',
  status: 'active',
  startDate,
  endDate: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const state = vi.hoisted(() => ({
  program: null as unknown as Program,
  plans: [] as WeekPlan[],
  done: new Set<string>(),
  statuses: new Map<string, 'done' | 'in_progress'>(),
  cycle: 3,
}))

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

function makeProgram(over: Partial<Program> = {}): Program {
  return {
    id: 'prog-1',
    userId: 'user-1',
    name: 'Test Program',
    schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run',
    ...over,
  }
}

function plan(id: string, weekNumber: number): WeekPlan {
  return { id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z' }
}

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [{ id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-1' }] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
// PLAN FORWARD's card (a week ahead that isn't planned) owns its mutation; nothing here opens one.
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: undefined }),
}))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => state.statuses }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: state.plans.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: state.plans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile } = await import('./planMenus.testutil')

beforeEach(() => {
  state.program = makeProgram()
  state.plans = []
  state.done = new Set()
  state.statuses = new Map()
  state.cycle = 3
})
afterEach(() => cleanup())

// What Plan knows of the plan rows' sessions: the rows with a session done (what locks a row: `useDoneWeekPlanIds`) and the statuses
// the button reads (`usePlanRowStatuses`: done or in progress; a row missing from it is not started).
function sessions({ done = [], inProgress = [] }: { done?: string[]; inProgress?: string[] }) {
  state.done = new Set(done)
  state.statuses = new Map<string, 'done' | 'in_progress'>([...done.map((id) => [id, 'done'] as const), ...inProgress.map((id) => [id, 'in_progress'] as const)])
}

function LocationProbe() {
  return <div>AT {useLocation().pathname}</div>
}

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/change" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const BUTTON = /^CHANGE THE PROGRAM FROM (WEEK|CYCLE) \d+$/

describe('the CHANGE THE PROGRAM button at the foot of the week panel', () => {
  it('is the last thing in the panel and names the week the changes start in', () => {
    // Week 3 is current: three plan rows, none done.
    state.plans = [plan('w3-a', 3), plan('w3-b', 3), plan('w3-c', 3)]
    const { container } = renderPlan()
    const button = screen.getByRole('button', { name: BUTTON })
    expect(button.textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
    // The panel's last child: the button closes the week's content (board 1: "Bottom").
    expect(button.parentElement!.lastElementChild).toBe(button)
    expect(container.contains(button)).toBe(true)
  })

  it('names the week of the first session that has not started, not simply the current week', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3), plan('w4-a', 4)]
    // Everything in week 3 is done: the changes start where the next not-done session is.
    sessions({ done: ['w3-a', 'w3-b'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it('with nothing planned beyond a finished current week, names the week after it', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3)]
    sessions({ done: ['w3-a', 'w3-b'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it('with a session of the current week not done, a done one earlier in that week does not move it', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3)]
    sessions({ done: ['w3-a'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
  })

  it('opens CHANGE THE PROGRAM', () => {
    state.plans = [plan('w3-a', 3)]
    renderPlan()
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    expect(screen.getByText('AT /plan/change')).toBeTruthy()
  })

  it('a past week has no button (SPEC: "A past week has no COPY / VOLUME / WEEK row and no CHANGE THE PROGRAM button"), planned or not', () => {
    state.plans = [plan('w2-a', 2), plan('w3-a', 3)]
    renderPlan()
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeNull()
    openWeekTile('WEEK 2') // planned, and past
    expect(screen.getByText('WEEK 2')).toBeTruthy()
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
    openWeekTile('WEEK 1') // never planned, and past
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })

  it('a week ahead that is planned has it, still naming the week the changes start in (the next session that is not done), not the viewed week', () => {
    state.plans = [plan('w3-a', 3), plan('w4-a', 4)]
    renderPlan()
    openWeekTile('WEEK 4')
    expect(screen.getByText('WEEK 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
  })

  it('the week PLAN FORWARD opens has none: it is a card, not a week of sessions (board 1b)', () => {
    state.plans = [plan('w3-a', 3)]
    renderPlan()
    openWeekTile('WEEK 4')
    expect(screen.getByText('PLAN FORWARD')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
  })

  it('a sequence run says CYCLE and names the cycle', () => {
    state.program = makeProgram({ scheduleType: 'sequence' })
    state.cycle = 5
    state.plans = [plan('c5-a', 5), plan('c5-b', 5)]
    sessions({ done: ['c5-a'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM CYCLE 5')
  })
})

// DECISIONS 172 (j), Adam, 2026-10-19: "Plan's "CHANGE THE PROGRAM FROM WEEK N" button naming a different week than the screen's rule box when
// the week's last open session is in progress ... The button follows the screen." The screen's N is the week of the first session that
// has not STARTED (`changeStartWeek` over done, in progress and not started): a session in progress is left as it is, so the changes
// start the week after it. The button used to count done sessions only, so on the day a week's last open session was the one in
// progress it named that week and the screen's rule box the next.
describe('a session in progress is left as it is: the button names the week the screen names (DECISIONS 172 (j))', () => {
  it("the week's last open session in progress: the week after, with a week planned after it", () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3), plan('w4-a', 4)]
    sessions({ done: ['w3-a'], inProgress: ['w3-b'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it("the week's last open session in progress, nothing planned after it: the week after the last one there is", () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3)]
    sessions({ done: ['w3-a'], inProgress: ['w3-b'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it('the only session of the week in progress (none done yet): still the week after', () => {
    state.plans = [plan('w3-a', 3)]
    sessions({ inProgress: ['w3-a'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 4')
  })

  it('a session in progress does not move it while a session of the same week has not started: that one is where the changes start', () => {
    state.plans = [plan('w3-a', 3), plan('w3-b', 3), plan('w3-c', 3)]
    sessions({ done: ['w3-a'], inProgress: ['w3-b'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
  })

  it('a session in progress in an earlier week is not a session from this week on: it moves nothing', () => {
    // the current week is 3; week 2's session is still in progress (never finished), and week 3 has not started
    state.plans = [plan('w2-a', 2), plan('w3-a', 3)]
    sessions({ inProgress: ['w2-a'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM WEEK 3')
  })

  it('a sequence run: the cycle after the one whose last open slot is in progress', () => {
    state.program = makeProgram({ scheduleType: 'sequence' })
    state.cycle = 5
    state.plans = [plan('c5-a', 5), plan('c5-b', 5)]
    sessions({ done: ['c5-a'], inProgress: ['c5-b'] })
    renderPlan()
    expect(screen.getByRole('button', { name: BUTTON }).textContent).toBe('CHANGE THE PROGRAM FROM CYCLE 6')
  })

  it('what locks a row is unchanged: a session in progress locks nothing, and the button is there either way', () => {
    state.plans = [plan('w3-a', 3)]
    sessions({ inProgress: ['w3-a'] })
    expect(state.done.has('w3-a')).toBe(false)
    renderPlan()
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeNull()
  })
})
