// @vitest-environment jsdom
//
// B1 (2026-10-10, DECISIONS 39): the screen a finished session lands on used
// to carry REDO SESSION, whose CONFIRM marked the finished session `skipped`
// (keeping its sets) and started a fresh one. That left Friday 2026-10-09's
// PULL 2 as a SKIPPED session full of numbers plus an empty in-progress twin.
// REDO is removed (Adam's decision): this screen can only CONTINUE (reopen) a
// finished session or edit its note. These tests pin that nothing on it can
// skip or create a session, and that CONTINUE still reopens.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { WorkoutDay, Session } from '../../types'

const activeSessionMock = vi.fn()
const reopenSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const skipSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const createSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const updateNoteMutateAsyncMock = vi.fn().mockResolvedValue(undefined)

vi.mock('./useSession', () => ({
  useActiveSession: (id: string) => activeSessionMock(id),
  useReopenSession: () => ({ mutateAsync: reopenSessionMutateAsyncMock, isPending: false }),
  // Still provided so the test would catch the screen calling them again.
  useSkipSession: () => ({ mutateAsync: skipSessionMutateAsyncMock, isPending: false }),
  useCreateSession: () => ({ mutateAsync: createSessionMutateAsyncMock, isPending: false }),
  useUpdateSessionNote: () => ({ mutateAsync: updateNoteMutateAsyncMock, isPending: false }),
}))

// The screen no longer plans or starts anything; kept mocked so a regression
// that brought REDO back would run against the same harness and fail on the
// assertions below, not on a missing QueryClient.
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: vi.fn().mockResolvedValue('wp-resolved'),
}))

const { default: CompletedTodayScreen } = await import('./CompletedTodayScreen')

afterEach(() => cleanup())
beforeEach(() => {
  activeSessionMock.mockReturnValue({ data: undefined })
  reopenSessionMutateAsyncMock.mockClear()
  skipSessionMutateAsyncMock.mockClear()
  createSessionMutateAsyncMock.mockClear()
  updateNoteMutateAsyncMock.mockClear()
})

const workoutDay: WorkoutDay = { id: 'wd-a', programId: 'prog-1', userId: 'user-1', name: 'PULL 2', position: 0, exercises: [] }
const session: Session = {
  id: 's-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-a',
  date: '2026-02-10', status: 'completed', note: null, startedAt: '2026-02-10T09:00:00Z',
  completedAt: '2026-02-10T10:00:00Z', createdAt: '2026-02-10T09:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
}
function renderScreen(scheduleType?: 'weekday' | 'sequence') {
  return render(
    <CompletedTodayScreen
      session={session}
      workoutDay={workoutDay}
      weekNumber={3}
      todayLabel="TUESDAY"
      scheduleType={scheduleType}
    />,
  )
}

describe.each([['weekday', undefined], ['sequence', 'sequence' as const]])(
  'CompletedTodayScreen (%s run) — a finished session cannot be redone',
  (_name, scheduleType) => {
    it('offers no REDO control and no text promising the session is discarded or marked skipped', () => {
      renderScreen(scheduleType)

      expect(screen.queryByText(/redo/i)).toBeNull()
      expect(screen.queryByText(/discard/i)).toBeNull()
      expect(screen.queryByText(/marked skipped/i)).toBeNull()
    })

    it('CONTINUE SESSION then CONFIRM reopens this very session, and nothing is skipped or created', async () => {
      renderScreen(scheduleType)

      fireEvent.click(screen.getByText('CONTINUE SESSION'))
      fireEvent.click(screen.getByText('CONFIRM'))

      await waitFor(() => expect(reopenSessionMutateAsyncMock).toHaveBeenCalledWith('s-1'))
      expect(skipSessionMutateAsyncMock).not.toHaveBeenCalled()
      expect(createSessionMutateAsyncMock).not.toHaveBeenCalled()
    })

    it('tapping CONFIRM with no CONTINUE chosen is impossible (no confirm card until a choice is made)', () => {
      renderScreen(scheduleType)

      expect(screen.queryByText('CONFIRM')).toBeNull()
      expect(reopenSessionMutateAsyncMock).not.toHaveBeenCalled()
      expect(skipSessionMutateAsyncMock).not.toHaveBeenCalled()
    })
  },
)
