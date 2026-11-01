// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import type { DayOfWeek, Mesocycle, Program, RunSchedule, Session, WeeklySchedule, WorkoutDay } from '../../types'

// Chunk 50 (SPEC [1.2] Screens → Today: "it finds sessions by the weekdays in force that week"; TASKS-1.2 chunk 50: "a
// session moved in week 3 offers week 3's days", "the missed-session prompt in week 2 lists a missed Tuesday, never a
// Wednesday"). The REAL TodayPage, `useScheduler` and scheduler: only the data hooks beneath them are mocked, so a screen
// that drew the run copy's days (or ignored the rows) answers differently from one that resolves them. The run changed at
// week 3: Tuesday before, Wednesday from week 3, which is also what the run copy holds (as a save in 51b leaves it).
// Dates are derived from a week and a weekday, each proven to be that weekday.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const MESO_MONDAY = parseISO('2026-08-24') // a Monday
const DOW_INDEX: Record<DayOfWeek, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 }
function on(week: number, day: DayOfWeek): string {
  const date = addDays(MESO_MONDAY, (week - 1) * 7 + DOW_INDEX[day])
  expect(format(date, 'EEEE').toLowerCase(), `${format(date, 'yyyy-MM-dd')} is not a ${day}`).toBe(day)
  return format(date, 'yyyy-MM-dd')
}

const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const days = (over: Partial<WeeklySchedule>): WeeklySchedule => ({ ...NONE, ...over })
const TUESDAY = days({ tuesday: 'wd-push' })
const WEDNESDAY = days({ wednesday: 'wd-push' })
const row = (fromWeek: number, schedule: WeeklySchedule): RunSchedule => ({
  id: `r${fromWeek}`, userId: 'user-1', mesocycleId: 'meso-1', fromWeek, schedule, createdAt: '2026-09-01T00:00:00Z',
})

const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const meso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-08-24', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const runCopy: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: WEDNESDAY, workoutDays: [wdPush],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run',
}
const completed = (date: string): Session => ({
  id: `s-${date}`, userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: null, workoutDayId: 'wd-push', date, status: 'completed',
  note: null, startedAt: null, completedAt: null, createdAt: '2026-08-01T00:00:00Z', energyRating: null, pumpRating: null,
})

const mock: { today: string; rows: RunSchedule[] | undefined; sessions: Session[] } = {
  today: on(3, 'wednesday'),
  rows: [row(1, TUESDAY), row(3, WEDNESDAY)],
  sessions: [],
}
const moveMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [meso] }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [runCopy] }),
  useWorkoutDays: () => ({ data: [wdPush] }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [] }),
  useAllWeekPlans: () => ({ data: [] }),
  usePlanWeek: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: vi.fn(async () => 'wp-1'),
}))
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: () => ({ data: mock.rows }) }))
vi.mock('./useSession', () => ({
  useSessionsInRange: () => ({ data: mock.sessions }),
  useCreateSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkipMissedSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActiveSession: () => ({ data: undefined }),
  useReopenSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkipSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSessionNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveSession: () => ({ mutate: moveMutate, isPending: false }),
  useClearMovedSession: () => ({ mutate: vi.fn(), isPending: false }),
  useStartMovedSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../hooks/useToday', () => ({ useToday: () => mock.today }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('./RestDayScreen', () => ({ default: () => <div>REST DAY STUB</div> }))

const { default: TodayPage } = await import('./TodayPage')

beforeEach(() => {
  mock.today = on(3, 'wednesday')
  mock.rows = [row(1, TUESDAY), row(3, WEDNESDAY)]
  mock.sessions = []
  moveMutate.mockClear()
})

function renderToday(today: string) {
  mock.today = today
  return render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  )
}

describe('TodayPage — the session of the day is the one the weekdays in force that week say', () => {
  it('week 3, Wednesday: Push Day is due (the row from week 3)', () => {
    renderToday(on(3, 'wednesday'))
    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText('START SESSION')).toBeTruthy()
    expect(screen.getByText(/WEEK 3$/)).toBeTruthy()
  })

  it('week 3, Tuesday: a rest day whose next session is tomorrow\'s Wednesday (week 2\'s Tuesday is gone)', () => {
    renderToday(on(3, 'tuesday'))
    expect(screen.queryByText('START SESSION')).toBeNull()
    expect(screen.getByText('REST DAY STUB')).toBeTruthy()
    expect(screen.getByText('NEXT UP')).toBeTruthy()
    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText('TOMORROW')).toBeTruthy()
  })

  it('week 2, Tuesday: Push Day is due (the row from week 1), though the run copy now holds Wednesday', () => {
    renderToday(on(2, 'tuesday'))
    expect(screen.getByText('START SESSION')).toBeTruthy()
    expect(screen.getByText(/WEEK 2$/)).toBeTruthy()
  })

  it('Sunday of week 2: the next session is week 3\'s Wednesday, three days on', () => {
    mock.sessions = [completed(on(2, 'tuesday'))]
    renderToday(on(2, 'sunday'))
    expect(screen.getByText('NEXT UP')).toBeTruthy()
    expect(screen.getByText('IN 3 DAYS')).toBeTruthy()
  })

  it('waits for the rows: a spinner and no session, whatever the run copy says', () => {
    mock.rows = undefined
    const { container } = renderToday(on(3, 'wednesday'))
    expect(screen.queryByText('START SESSION')).toBeNull()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })
})

describe('TodayPage — the missed-session prompt lists the days of its own week', () => {
  it('week 2: a missed Tuesday, never a Wednesday', () => {
    renderToday(on(2, 'friday'))
    expect(screen.getByText('1 session to catch up')).toBeTruthy()
    expect(screen.getByText('TUESDAY, SEP 1')).toBeTruthy()
    expect(screen.queryByText('WEDNESDAY, SEP 2')).toBeNull()
  })

  it('week 3: a missed Wednesday, never the Tuesday', () => {
    renderToday(on(3, 'friday'))
    expect(screen.getByText('1 session to catch up')).toBeTruthy()
    expect(screen.getByText('WEDNESDAY, SEP 9')).toBeTruthy()
    expect(screen.queryByText('TUESDAY, SEP 8')).toBeNull()
  })
})

describe('TodayPage — a session moved in week 3 offers week 3\'s days', () => {
  it('the sheet lists the 9th to the 13th, and picking Friday moves the session of Wednesday the 9th to Friday the 11th', () => {
    renderToday(on(3, 'wednesday'))
    fireEvent.click(screen.getByText('MOVE THIS SESSION'))

    const chips = ['WED', 'THU', 'FRI', 'SAT', 'SUN'].map((label) => screen.getByText(label).closest('button') as HTMLElement)
    expect(chips.map((chip) => within(chip).getByText(/^\d+$/).textContent)).toEqual(['9', '10', '11', '12', '13'])
    expect(within(chips[0]).getByText('HERE NOW')).toBeTruthy()
    expect(screen.queryByText('MON')).toBeNull() // already past
    expect(screen.queryByText('TUE')).toBeNull()

    fireEvent.click(chips[2])
    expect(moveMutate).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: null, workoutDayId: 'wd-push', date: on(3, 'wednesday'), targetDate: on(3, 'friday'),
    })
  })

  it('week 2, Tuesday: the sheet is week 2\'s (the 1st to the 6th), its own day marked', () => {
    renderToday(on(2, 'tuesday'))
    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    const labels = ['TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((label) => screen.getByText(label).closest('button') as HTMLElement)
    expect(labels.map((chip) => within(chip).getByText(/^\d+$/).textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(within(labels[0]).getByText('HERE NOW')).toBeTruthy()
  })
})
