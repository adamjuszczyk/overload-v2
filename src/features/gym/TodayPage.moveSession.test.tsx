// @vitest-environment jsdom
//
// Chunk 24 (SPEC "Weekday" — "Move this session"/"Several sessions a day
// are listed; each opens on its own"/Empty state). Screen-layer proof
// (Lessons: "screen-layer tests asserting what each button hands to its
// hook, session id, target date") for TodayPage.tsx's own new wiring —
// scheduler.ts's own logic is proven separately (scheduler.test.ts), and
// the day-chip picker's own behaviour (which days are offered/disabled) is
// proven separately too (MoveSessionSheet.test.tsx). This file's job is
// narrower: given a SchedulerResult, does TodayPage hand the right
// arguments to the right hook.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Mesocycle, WorkoutDay, WeekPlan, Session, SchedulerResult } from '../../types'
import type { SchedulerData } from './useScheduler'

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// Week of 2026-08-24 (Monday) .. 2026-08-30 (Sunday) — same hand-verified
// week as scheduler.test.ts/moveSession.test.ts. TODAY is Tuesday.
const TODAY = '2026-08-25'
const MON = '2026-08-24'
const FRI = '2026-08-28'

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: MON, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const workoutDay2: WorkoutDay = { id: 'wd-2', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }

function makeWeekPlan(id = 'wp-1'): WeekPlan {
  return { id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z' }
}

function makePlannedSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-planned', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1',
    workoutDayId: 'wd-1', date: MON, status: 'planned', note: null, startedAt: null,
    completedAt: null, createdAt: '2026-08-20T00:00:00Z', energyRating: null, pumpRating: null,
    movedToDate: TODAY,
    ...overrides,
  }
}

const mockState: { result: SchedulerResult | null } = { result: null }
let isOnline = true

vi.mock('./useScheduler', () => ({
  useScheduler: (): SchedulerData => ({
    result: mockState.result,
    isLoading: false,
    activeMeso,
    workoutDays: [workoutDay, workoutDay2],
    currentWeekPlans: mockState.result?.type === 'suggest_from_plan' ? [mockState.result.weekPlan] : [],
    allWeekPlans: [],
    currentWeek: 1,
  }),
}))

const moveMutate = vi.fn()
const clearMutate = vi.fn()
const startMutateAsync = vi.fn().mockResolvedValue(undefined)
const createMutateAsync = vi.fn().mockResolvedValue(undefined)

vi.mock('./useSession', () => ({
  useCreateSession: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useActiveSession: () => ({ data: undefined }),
  useReopenSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkipSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSessionNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveSession: () => ({ mutate: moveMutate, isPending: false }),
  useClearMovedSession: () => ({ mutate: clearMutate, isPending: false }),
  useStartMovedSession: () => ({ mutateAsync: startMutateAsync, isPending: false }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: vi.fn(async () => 'wp-1'),
}))
vi.mock('../../hooks/useToday', () => ({ useToday: () => TODAY }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => isOnline }))
// RestDayScreen reads real TanStack queries of its own (usePrograms,
// useSessionsInRange) — irrelevant to this file's own new addition (the
// "NEXT UP" card is a sibling of it, not inside it), stubbed the same way
// GymSession is stubbed by every other TodayPage test file that never
// exercises the active_session branch.
vi.mock('./RestDayScreen', () => ({ default: () => <div>REST DAY STUB</div> }))

const { default: TodayPage } = await import('./TodayPage')

function renderToday() {
  return render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockState.result = null
  isOnline = true
  moveMutate.mockClear()
  clearMutate.mockClear()
  startMutateAsync.mockClear()
  createMutateAsync.mockClear()
})

describe('TodayPage — MOVE THIS SESSION on the virtual (not-yet-created) suggestion', () => {
  it('opens the sheet and picking a day hands useMoveSession the session id-equivalent (meso/week/workout/date) and the picked target', async () => {
    mockState.result = { type: 'suggest_from_plan', weekPlan: makeWeekPlan(), date: TODAY }
    renderToday()

    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(screen.getByText('FRI').closest('button')!)

    expect(moveMutate).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: TODAY, targetDate: FRI,
    })
    expect(clearMutate).not.toHaveBeenCalled()
  })

  it('offline: the control is disabled and says so', () => {
    isOnline = false
    mockState.result = { type: 'suggest_from_plan', weekPlan: makeWeekPlan(), date: TODAY }
    renderToday()

    const button = screen.getByText('MOVE THIS SESSION').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('REQUIRES A CONNECTION')).toBeTruthy()
  })
})

describe('TodayPage — the `planned` entry (a session moved here, not yet started)', () => {
  it('shows a MOVED FROM label and START updates the existing row (useStartMovedSession), never createSession', async () => {
    const session = makePlannedSession()
    mockState.result = { type: 'planned', session, weekPlan: makeWeekPlan(), workoutDay }
    renderToday()

    expect(screen.getByText(/MOVED FROM/)).toBeTruthy()
    fireEvent.click(screen.getByText('START SESSION'))

    expect(startMutateAsync).toHaveBeenCalledWith('session-planned')
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('moving it back to its own original day calls useClearMovedSession, not useMoveSession', () => {
    const session = makePlannedSession()
    mockState.result = { type: 'planned', session, weekPlan: makeWeekPlan(), workoutDay }
    renderToday()

    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(screen.getByText('MOVE BACK').closest('button')!)

    expect(clearMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', date: MON })
    expect(moveMutate).not.toHaveBeenCalled()
  })

  it('moving it again (to a third day) calls useMoveSession with the ORIGINAL date, not the current moved-to one', () => {
    const session = makePlannedSession()
    mockState.result = { type: 'planned', session, weekPlan: makeWeekPlan(), workoutDay }
    renderToday()

    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(screen.getByText('SAT').closest('button')!)

    expect(moveMutate).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: MON, targetDate: '2026-08-29',
    })
  })
})

describe('TodayPage — several sessions due today (G14), each opens on its own', () => {
  it('lists both, and selecting one opens that entry specifically; BACK returns to the list', () => {
    const completed = {
      id: 'session-done', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1',
      workoutDayId: 'wd-2', date: TODAY, status: 'completed' as const, note: null,
      startedAt: `${TODAY}T09:00:00Z`, completedAt: `${TODAY}T10:00:00Z`, createdAt: TODAY,
      energyRating: null, pumpRating: null,
    }
    mockState.result = {
      type: 'due_today',
      sessions: [
        { type: 'suggest_from_plan', weekPlan: makeWeekPlan(), date: TODAY },
        { type: 'completed_today', session: completed },
      ],
    }
    renderToday()

    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText('Pull Day')).toBeTruthy()
    expect(screen.getByText('NOT STARTED')).toBeTruthy()
    expect(screen.getByText('DONE')).toBeTruthy()

    fireEvent.click(screen.getByText('Pull Day').closest('button')!)
    expect(screen.getByText('SESSION COMPLETE · WEEK 1')).toBeTruthy()

    fireEvent.click(screen.getByText('← BACK'))
    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText('Pull Day')).toBeTruthy()
  })
})

describe('TodayPage — empty state: the next scheduled session and when it\'s due', () => {
  it('shows NEXT UP with the workout name and days away', () => {
    mockState.result = { type: 'rest_day', next: { date: FRI, workoutDay } }
    renderToday()

    expect(screen.getByText('NEXT UP')).toBeTruthy()
    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText('IN 3 DAYS')).toBeTruthy()
  })

  it('tomorrow reads TOMORROW, not "IN 1 DAYS"', () => {
    mockState.result = { type: 'rest_day', next: { date: '2026-08-26', workoutDay } }
    renderToday()

    expect(screen.getByText('TOMORROW')).toBeTruthy()
  })

  it('nothing scheduled at all: no NEXT UP card', () => {
    mockState.result = { type: 'rest_day', next: null }
    renderToday()

    expect(screen.queryByText('NEXT UP')).toBeNull()
  })
})
