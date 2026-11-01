// @vitest-environment jsdom
//
// Chunk 77 (1.2.1 item 4; SPEC "PREVIEW SESSION": the header is "[eyebrow as the workout writes it] · PREVIEW") — what Today hands the preview, and what the
// preview's START does. `SessionPreview.test.tsx` proves the screen from what it is given; this file proves the hand-over: the eyebrow is the one the
// workout's own header writes (`headerEyebrow`: the week and the weekday the session is due on, a moved session on the day it was moved to, DELOAD first on a
// deload session), and START SESSION in the preview is the card's own start (no new write). It also holds the rules the old preview's deload test pinned
// (chunk 21: a deload session says DELOAD, never DELOAD WEEK; a session that isn't one says no DELOAD anywhere; no week plan reads like the others).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Mesocycle, Session, SchedulerResult, WeekPlan } from '../../types'
import type { SchedulerData } from './useScheduler'
import { blocks, lastByExercise, peLat, w1Plan, workoutDay } from './previewWorld.testutil'

afterEach(() => cleanup())

const TODAY = '2026-01-06' // a Tuesday, in week 2 of the run
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'u1', name: 'Test Meso', programId: 'p1', status: 'active', startDate: '2025-12-29', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const mockState: { result: SchedulerResult | null } = { result: null }
const createSession = vi.fn().mockResolvedValue(undefined)
const startMoved = vi.fn().mockResolvedValue(undefined)

vi.mock('./useScheduler', () => ({
  useScheduler: (): SchedulerData => ({
    result: mockState.result,
    isLoading: false,
    activeMeso,
    workoutDays: [workoutDay],
    currentWeekPlans: mockState.result?.type === 'suggest_from_plan' ? [mockState.result.weekPlan] : [],
    allWeekPlans: [],
    currentWeek: 2,
  }),
}))
vi.mock('./useSession', () => ({
  useCreateSession: () => ({ mutateAsync: createSession, isPending: false }),
  useActiveSession: () => ({ data: undefined }),
  useReopenSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkipSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSessionNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveSession: () => ({ mutate: vi.fn(), isPending: false }),
  useClearMovedSession: () => ({ mutate: vi.fn(), isPending: false }),
  useStartMovedSession: () => ({ mutateAsync: startMoved, isPending: false }),
  // what the preview reads: last week's Tuesday for each exercise
  useExerciseReferenceSessions: () => ({ data: lastByExercise, isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
}))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [peLat], isPending: false }), // the program's own list: what a week with no plan row previews
  useSupersetBlockRests: () => ({ data: blocks }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: vi.fn(async () => 'wp-1'),
}))
vi.mock('../../hooks/useToday', () => ({ useToday: () => TODAY }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/useSyncQueue', () => ({ retrySyncFailures: vi.fn() }))

const { default: TodayPage } = await import('./TodayPage')

beforeEach(() => {
  mockState.result = null
  createSession.mockClear()
  startMoved.mockClear()
})

function openPreview(result: SchedulerResult) {
  mockState.result = result
  const view = render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByText('PREVIEW SESSION'))
  return view
}

const movedHere = (date: string, movedToDate: string): Session => ({
  id: 'session-moved', userId: 'u1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date, status: 'planned', note: null, startedAt: null,
  completedAt: null, createdAt: '2026-01-01T00:00:00Z', energyRating: null, pumpRating: null, movedToDate,
})
const deloadPlan: WeekPlan = { ...w1Plan, isDeload: true }

describe('TodayPage → PREVIEW SESSION: the eyebrow is the workout\'s own first line', () => {
  it('a weekday session reads "WEEK 2 · TUESDAY · PREVIEW" over its name, with the plan\'s rows', () => {
    const { container } = openPreview({ type: 'suggest_from_plan', weekPlan: w1Plan, date: TODAY })
    expect(screen.getByText('WEEK 2 · TUESDAY · PREVIEW')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PULL 1')
    expect(container.textContent).toContain('55 kg × 9 @ RIR 2')
    // Today's own date is the one "last week" is counted from: Tuesday 2026-01-06, last week's Tuesday
    expect(Array.from(container.querySelectorAll('[data-last-line]')).map((el) => el.textContent)).toEqual(Array(4).fill('LAST = LAST WEEK, TUE'))
    expect(screen.queryByText(/DELOAD/)).toBeNull()
  })

  it('a deload session\'s own plan row says DELOAD first, never DELOAD WEEK; one that isn\'t a deload says no DELOAD anywhere', () => {
    openPreview({ type: 'suggest_from_plan', weekPlan: deloadPlan, date: TODAY })
    expect(screen.getByText('DELOAD · WEEK 2 · TUESDAY · PREVIEW')).toBeTruthy()
    expect(screen.queryByText(/DELOAD WEEK/)).toBeNull()
    cleanup()
    const plain = openPreview({ type: 'suggest_from_plan', weekPlan: w1Plan, date: TODAY })
    expect(plain.container.textContent).not.toContain('DELOAD')
  })

  it('no week plan yet (the week isn\'t planned) reads the same, with the program\'s own exercises and NO SETS PLANNED', () => {
    const { container } = openPreview({ type: 'suggest_no_plan', workoutDay, date: TODAY })
    expect(screen.getByText('WEEK 2 · TUESDAY · PREVIEW')).toBeTruthy()
    expect(container.textContent).not.toContain('DELOAD')
    expect(screen.getByText('Lat Pulldown')).toBeTruthy()
    expect(screen.getByText('NO SETS PLANNED')).toBeTruthy()
  })

  it('a session moved here is on the day it was moved to, not the day it was planned for (planned for Thursday, moved to today, Tuesday)', () => {
    openPreview({ type: 'planned', session: movedHere('2026-01-08', TODAY), weekPlan: w1Plan, workoutDay })
    expect(screen.getByText('WEEK 2 · TUESDAY · PREVIEW')).toBeTruthy()
    expect(screen.queryByText(/THURSDAY/)).toBeNull()
  })

  it('BACK returns to the session\'s card', () => {
    openPreview({ type: 'suggest_from_plan', weekPlan: w1Plan, date: TODAY })
    fireEvent.click(screen.getByLabelText('Back to Today'))
    expect(screen.getByText('PREVIEW SESSION')).toBeTruthy()
    expect(screen.queryByText('WEEK 2 · TUESDAY · PREVIEW')).toBeNull()
  })
})

describe('TodayPage → PREVIEW SESSION: START SESSION is the card\'s own start', () => {
  it('a planned week: the preview\'s START creates the session once, with exactly what the card\'s START creates', async () => {
    mockState.result = { type: 'suggest_from_plan', weekPlan: w1Plan, date: TODAY }
    const card = render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('START SESSION'))
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    const fromCard = createSession.mock.calls[0][0]
    card.unmount()
    createSession.mockClear()

    openPreview({ type: 'suggest_from_plan', weekPlan: w1Plan, date: TODAY })
    fireEvent.click(screen.getByRole('button', { name: 'START SESSION' }))
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    expect(createSession.mock.calls[0][0]).toEqual(fromCard)
    expect(fromCard).toEqual({ mesoId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: TODAY })
    expect(startMoved).not.toHaveBeenCalled()
  })

  it('a session moved here: the preview\'s START starts that session, once, and creates none', async () => {
    openPreview({ type: 'planned', session: movedHere('2026-01-08', TODAY), weekPlan: w1Plan, workoutDay })
    fireEvent.click(screen.getByRole('button', { name: 'START SESSION' }))
    await waitFor(() => expect(startMoved).toHaveBeenCalledTimes(1))
    expect(startMoved).toHaveBeenCalledWith('session-moved')
    expect(createSession).not.toHaveBeenCalled()
  })
})
