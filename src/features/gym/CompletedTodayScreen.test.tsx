// @vitest-environment jsdom
//
// Chunk 25 review fix 2 (DECISIONS 73 option a) — this component's own
// "plan-then-create" wiring (handleRedo: skip the completed session, plan
// the slot, create a fresh one) had no screen-layer test of its own at
// all — not even for the weekday case. This closes that gap directly, with
// the exact focus the review names: the sequencePosition argument handed
// to planWeekThenFindId is the SELECTED slot's own (weekPlan.sequencePosition),
// never null and never the other slot's, for a repeated workout's second
// occurrence.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Mesocycle, WorkoutDay, WeekPlan, Session } from '../../types'

const activeSessionMock = vi.fn()
const reopenSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const skipSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const createSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const updateNoteMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const planWeekThenFindIdMock = vi.fn().mockResolvedValue('wp-resolved')

vi.mock('./useSession', () => ({
  useActiveSession: (id: string) => activeSessionMock(id),
  useReopenSession: () => ({ mutateAsync: reopenSessionMutateAsyncMock, isPending: false }),
  useSkipSession: () => ({ mutateAsync: skipSessionMutateAsyncMock, isPending: false }),
  useCreateSession: () => ({ mutateAsync: createSessionMutateAsyncMock, isPending: false }),
  useUpdateSessionNote: () => ({ mutateAsync: updateNoteMutateAsyncMock, isPending: false }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: (...args: unknown[]) => planWeekThenFindIdMock(...args),
}))

const { default: CompletedTodayScreen } = await import('./CompletedTodayScreen')

afterEach(() => cleanup())
beforeEach(() => {
  activeSessionMock.mockReturnValue({ data: undefined })
  reopenSessionMutateAsyncMock.mockClear()
  skipSessionMutateAsyncMock.mockClear()
  createSessionMutateAsyncMock.mockClear()
  updateNoteMutateAsyncMock.mockClear()
  planWeekThenFindIdMock.mockClear()
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Seq Meso', programId: 'prog-1', status: 'active',
  startDate: '2026-01-01', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDayA: WorkoutDay = { id: 'wd-a', programId: 'prog-1', userId: 'user-1', name: 'A', position: 0, exercises: [] }
const basicSession: Session = {
  id: 's-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-slot2', workoutDayId: 'wd-a',
  date: '2026-02-10', status: 'completed', note: null, startedAt: '2026-02-10T09:00:00Z',
  completedAt: '2026-02-10T10:00:00Z', createdAt: '2026-02-10T09:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
}

function weekPlan(overrides: Partial<WeekPlan> & { id: string }): WeekPlan {
  return {
    userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 3, isDeload: false,
    notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function clickRedo() {
  fireEvent.click(screen.getByText('REDO SESSION'))
  fireEvent.click(screen.getByText('CONFIRM'))
}

describe('CompletedTodayScreen — REDO\'s own plan-then-create wiring (chunk 25 review fix 2)', () => {
  it('a repeated workout\'s SECOND slot (sequencePosition 2): planWeekThenFindId is called with 2, never null and never 0', async () => {
    render(
      <CompletedTodayScreen
        session={basicSession}
        activeMeso={activeMeso}
        workoutDay={workoutDayA}
        weekPlan={weekPlan({ id: 'wp-slot2', sequencePosition: 2 })}
        weekNumber={3}
        today="2026-02-10"
        todayLabel="TUESDAY"
        scheduleType="sequence"
      />,
    )

    clickRedo()

    await waitFor(() => expect(createSessionMutateAsyncMock).toHaveBeenCalled())
    // planWeekThenFindId(mesoId, weekNumber, workoutDayId, fallback, planWeekMutation, fetchPlans, sequencePosition)
    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', 3, 'wd-a', 'wp-slot2', expect.anything(), undefined, 2,
    )
  })

  it('the FIRST slot (sequencePosition 0) of the same repeated workout: planWeekThenFindId is called with 0, never 2', async () => {
    render(
      <CompletedTodayScreen
        session={basicSession}
        activeMeso={activeMeso}
        workoutDay={workoutDayA}
        weekPlan={weekPlan({ id: 'wp-slot0', sequencePosition: 0 })}
        weekNumber={3}
        today="2026-02-10"
        todayLabel="TUESDAY"
        scheduleType="sequence"
      />,
    )

    clickRedo()

    await waitFor(() => expect(createSessionMutateAsyncMock).toHaveBeenCalled())
    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', 3, 'wd-a', 'wp-slot0', expect.anything(), undefined, 0,
    )
  })

  it('a weekday run (sequencePosition undefined on the weekPlan): planWeekThenFindId is called with null, unchanged', async () => {
    render(
      <CompletedTodayScreen
        session={basicSession}
        activeMeso={activeMeso}
        workoutDay={workoutDayA}
        weekPlan={weekPlan({ id: 'wp-weekday' })}
        weekNumber={3}
        today="2026-02-10"
        todayLabel="TUESDAY"
      />,
    )

    clickRedo()

    await waitFor(() => expect(createSessionMutateAsyncMock).toHaveBeenCalled())
    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', 3, 'wd-a', 'wp-weekday', expect.anything(), undefined, null,
    )
  })
})
