// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, RunSchedule, SequenceItem, WeekPlan, WeeklySchedule, WorkoutDay } from '../../types'

// Chunk 50 (SPEC [1.2] Programs and runs → "Weekdays storage"; TASKS-1.2 chunk 50: "Plan: the week chips show week 3's days
// on week 3 and week 2's on week 2"). Plan draws the weekdays in force for the VIEWED week: the run's schedule rows decide
// (`v2_run_schedules`), and the run copy's own schedule (the newest days, once CHANGE THE PROGRAM has moved some) is what
// applies only where no row does. The chips, the "they share one plan" note and the date MOVE THIS SESSION is given all read
// the viewed week's schedule.
//
// The real PlanPage tree; only the data hooks are mocked (the seam every PlanPage test uses). The fixture is a run in its
// week 3 whose days changed at week 3: Push Day on Monday and Thursday (one shared plan row, G14) and Leg Day on Wednesday
// before; Push Day on Tuesday and Leg Day on Friday from week 3, which is also what the run copy holds. Dates are derived
// from the run's start Monday, never typed, and proven to be the weekday they claim.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const START_MONDAY = startOfWeek(subWeeks(new Date(), 2), { weekStartsOn: 1 }) // today is in week 3 of the run
const startDate = format(START_MONDAY, 'yyyy-MM-dd')
const dow = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
function on(week: number, day: (typeof dow)[number]): string {
  const date = addDays(START_MONDAY, (week - 1) * 7 + dow.indexOf(day))
  expect(format(date, 'EEEE').toLowerCase(), `${format(date, 'yyyy-MM-dd')} is not a ${day}`).toBe(day)
  return format(date, 'yyyy-MM-dd')
}

const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const days = (over: Partial<WeeklySchedule>): WeeklySchedule => ({ ...NONE, ...over })
const BEFORE = days({ monday: 'wd-push', wednesday: 'wd-leg', thursday: 'wd-push' }) // weeks 1 and 2
const FROM_WEEK_3 = days({ tuesday: 'wd-push', friday: 'wd-leg' }) // week 3 on, and what the run copy holds

const row = (fromWeek: number, schedule: WeeklySchedule): RunSchedule => ({
  id: `r${fromWeek}`, userId: 'user-1', mesocycleId: 'meso-1', fromWeek, schedule, createdAt: '2026-09-01T00:00:00Z',
})
const ROWS = [row(1, BEFORE), row(3, FROM_WEEK_3)]

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const wdLeg: WorkoutDay = { id: 'wd-leg', programId: 'prog-1', userId: 'user-1', name: 'Leg Day', position: 1, exercises: [] }

const runCopy: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: FROM_WEEK_3, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
}
const sequenceProgram: Program = { ...runCopy, schedule: NONE, scheduleType: 'sequence' }
const sequenceItems: SequenceItem[] = [
  { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-push' },
  { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: null },
]

const plan = (weekNumber: number, workoutDayId: string, sequencePosition?: number): WeekPlan => ({
  id: `wp-${weekNumber}-${workoutDayId}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber,
  ...(sequencePosition === undefined ? {} : { sequencePosition }),
  isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
})
// Weeks 1 to 3 are planned (the run is in its week 3): a week with no plan is a tile that draws no weekdays at all (chunk 52).
const PLANS = [1, 2, 3].flatMap((week) => [plan(week, 'wd-push'), plan(week, 'wd-leg')])

const mockState: { rows: RunSchedule[] | undefined; program: Program; askedMeso: Array<string | undefined> } = {
  rows: ROWS,
  program: runCopy,
  askedMeso: [],
}
type ControlProps = { date: string; isCurrentWeek: boolean; workoutDay: WorkoutDay }
const controlProps: ControlProps[] = []
const lastControl = (): ControlProps => controlProps[controlProps.length - 1]

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [wdPush, wdLeg], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: 3, failed: false }) }))
vi.mock('./useRunSchedule', () => ({
  useRunSchedule: (mesoId: string | undefined) => {
    mockState.askedMeso.push(mesoId)
    return { data: mockState.rows }
  },
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: PLANS.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: PLANS, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
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
// PLAN FORWARD's card (week 4 here) owns its mutation; this file only reads what the card lists.
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: undefined }),
}))
// The control is given the date of the selected (week, weekday): captured, not drawn.
vi.mock('./MoveSessionControl', () => ({
  default: (props: ControlProps) => {
    controlProps.push(props)
    return null
  },
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile } = await import('./planMenus.testutil')

beforeEach(() => {
  mockState.rows = ROWS
  mockState.program = runCopy
  mockState.askedMeso = []
  controlProps.length = 0
})

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
/** The weekday chips on screen, in the order drawn. */
const chips = () => SHORT.filter((d) => screen.queryByText(d))
const chip = (d: string) => screen.getByText(d).closest('button') as HTMLElement
const SHARED_NOTE = /they share one plan/

describe('Plan draws the weekdays in force for the viewed week (chunk 50)', () => {
  it('reads the rows of the active run', () => {
    renderPlan()
    expect(mockState.askedMeso).toContain('meso-1')
  })

  it('week 3 (the row\'s own week, the current week): Push Day on Tuesday and Leg Day on Friday, nothing else', () => {
    renderPlan()
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(chips()).toEqual(['TUE', 'FRI'])
  })

  it('week 2: the days before the change: Monday, Wednesday and Thursday — and none of week 3\'s', () => {
    renderPlan()
    openWeekTile('WEEK 2')
    expect(screen.getByText('WEEK 2')).toBeTruthy()
    expect(chips()).toEqual(['MON', 'WED', 'THU'])
  })

  it('week 4, not planned yet: its card lists the days of the last row (Tuesday and Friday), the weekdays the week will have', () => {
    renderPlan()
    openWeekTile('WEEK 4')
    expect(screen.getByText('WEEK 4 WILL HAVE')).toBeTruthy() // PLAN FORWARD's card, which draws no weekday chips
    expect(chips()).toEqual(['TUE', 'FRI'])
    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText('Leg Day')).toBeTruthy()
  })

  it('week 1 reads the row from week 1 as well (the run copy holds only the newest days)', () => {
    renderPlan()
    openWeekTile('WEEK 1')
    expect(screen.getByText('WEEK 1')).toBeTruthy()
    expect(chips()).toEqual(['MON', 'WED', 'THU'])
  })

  it('a run with no rows draws the run copy\'s days in every week (nothing changes until a run has a schedule change)', () => {
    mockState.rows = []
    renderPlan()
    expect(chips()).toEqual(['TUE', 'FRI'])
    openWeekTile('WEEK 2')
    expect(chips()).toEqual(['TUE', 'FRI'])
  })
})

describe('the shared-plan note follows the viewed week\'s days (G14)', () => {
  it('week 2: Push Day is on Monday and Thursday, so its plan row says it covers both', () => {
    renderPlan()
    openWeekTile('WEEK 2')
    expect(chip('MON').textContent).toContain('Push Day')
    expect(screen.getByText('Marks Mon, Thu — they share one plan.')).toBeTruthy()
  })

  it('week 2: Leg Day is on one day, so no note', () => {
    renderPlan()
    openWeekTile('WEEK 2')
    fireEvent.click(chip('WED'))
    expect(screen.queryByText(SHARED_NOTE)).toBeNull()
  })

  it('week 3: Push Day is on one day now, so no note', () => {
    renderPlan()
    expect(screen.queryByText(SHARED_NOTE)).toBeNull()
  })

  it('with no rows the run copy\'s days decide it in every week: Push Day on one day, no note in week 2', () => {
    mockState.rows = []
    renderPlan()
    openWeekTile('WEEK 2')
    expect(screen.queryByText(SHARED_NOTE)).toBeNull()
  })
})

describe('MOVE THIS SESSION is given the date of the weekday the viewed week puts the workout on', () => {
  it('week 3: Push Day\'s Tuesday of week 3, then Leg Day\'s Friday of week 3', () => {
    renderPlan()
    expect(lastControl()).toMatchObject({ date: on(3, 'tuesday'), isCurrentWeek: true })
    expect(lastControl().workoutDay.name).toBe('Push Day')
    fireEvent.click(chip('FRI'))
    expect(lastControl()).toMatchObject({ date: on(3, 'friday'), isCurrentWeek: true })
    expect(lastControl().workoutDay.name).toBe('Leg Day')
  })

  it('week 2: Monday, Wednesday and Thursday of week 2 (the run copy has no such days: Tuesday and Friday)', () => {
    renderPlan()
    fireEvent.click(chip('FRI'))
    openWeekTile('WEEK 2')
    // Friday is not a day of week 2, so the first day is selected.
    expect(lastControl()).toMatchObject({ date: on(2, 'monday'), isCurrentWeek: false })
    expect(lastControl().workoutDay.name).toBe('Push Day')
    fireEvent.click(chip('WED'))
    expect(lastControl()).toMatchObject({ date: on(2, 'wednesday') })
    expect(lastControl().workoutDay.name).toBe('Leg Day')
    fireEvent.click(chip('THU'))
    expect(lastControl()).toMatchObject({ date: on(2, 'thursday') })
    expect(lastControl().workoutDay.name).toBe('Push Day')
  })
})

describe('Plan waits for the rows before it draws any weekday', () => {
  it('until they have answered: a spinner and no chip, and no control (the run copy\'s days are the newest, not this week\'s)', () => {
    mockState.rows = undefined
    const { container, rerender } = renderPlan()
    expect(chips()).toEqual([])
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(controlProps).toEqual([])

    mockState.rows = ROWS
    rerender(
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>,
    )
    expect(chips()).toEqual(['TUE', 'FRI'])
  })

  it('a sequence run waits for nothing: it has no weekday schedule and no rows', () => {
    mockState.program = sequenceProgram
    mockState.rows = undefined
    renderPlan()
    expect(screen.getByText('CYCLE 3')).toBeTruthy()
    expect(screen.getByLabelText('Sequence slot switcher')).toBeTruthy()
    expect(chips()).toEqual([])
  })
})
