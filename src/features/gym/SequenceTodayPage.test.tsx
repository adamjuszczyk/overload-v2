// @vitest-environment jsdom
//
// Chunk 25 (reviewer's note 4 — "Today (sequence run): the next workout
// and when it's due; on a rest day, the next workout plus TRAIN ANYWAY;
// Skip."; Lessons — "screen-layer tests asserting what each button hands
// to its hook"). Heavy-mocked at the hook boundary, same precedent as
// StepExercises.test.tsx/TodayPage.moveSession.test.tsx: useSequenceScheduler
// is replaced wholesale with a canned SequenceSchedulerData per test, and
// every write hook is a spy asserting its exact call arguments.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Mesocycle, WorkoutDay, Session } from '../../types'
import type { SequenceSchedulerData } from './useSequenceScheduler'

let schedulerData: SequenceSchedulerData
const createSessionMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const skipNextMutateAsyncMock = vi.fn().mockResolvedValue(undefined)
const planWeekThenFindIdMock = vi.fn().mockResolvedValue('wp-resolved')

vi.mock('./useSequenceScheduler', () => ({
  useSequenceScheduler: () => schedulerData,
}))
vi.mock('./useSession', () => ({
  useCreateSession: () => ({ mutateAsync: createSessionMutateAsyncMock, isPending: false }),
  useSkipMissedSession: () => ({ mutateAsync: skipNextMutateAsyncMock, isPending: false }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: (...args: unknown[]) => planWeekThenFindIdMock(...args),
}))
vi.mock('../plan/weekPlanService', () => ({ fetchWeekPlans: vi.fn() }))
vi.mock('./GymSession', () => ({ default: ({ scheduleType }: { scheduleType?: string }) => <div>GYM_SESSION:{scheduleType}</div> }))
vi.mock('./CompletedTodayScreen', () => ({ default: ({ scheduleType }: { scheduleType?: string }) => <div>COMPLETED:{scheduleType}</div> }))

const { default: SequenceTodayPage } = await import('./SequenceTodayPage')

afterEach(() => cleanup())
beforeEach(() => {
  createSessionMutateAsyncMock.mockClear()
  skipNextMutateAsyncMock.mockClear()
  planWeekThenFindIdMock.mockClear()
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Seq Meso', programId: 'prog-1', status: 'active',
  startDate: '2026-01-01', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

const workoutDayA: WorkoutDay = { id: 'wd-a', programId: 'prog-1', userId: 'user-1', name: 'A', position: 0, exercises: [] }

function loading(): SequenceSchedulerData {
  return { result: null, isLoading: true, workoutDays: [], allWeekPlans: [] }
}

function nextResult(overrides: Partial<{ dueDate: string | null; isDue: boolean; weekNumber: number; sequencePosition: number }> = {}): SequenceSchedulerData {
  return {
    result: {
      type: 'next',
      next: { workoutDayId: 'wd-a', weekNumber: overrides.weekNumber ?? 2, sequencePosition: overrides.sequencePosition ?? 0 },
      dueDate: overrides.dueDate === undefined ? '2026-02-10' : overrides.dueDate,
      isDue: overrides.isDue ?? true,
    },
    isLoading: false,
    workoutDays: [workoutDayA],
    allWeekPlans: [],
  }
}

describe('SequenceTodayPage — loading', () => {
  it('shows a spinner while loading', () => {
    schedulerData = loading()
    const { container } = render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })
})

describe('SequenceTodayPage — active_session / completed_today delegate with scheduleType="sequence"', () => {
  it('active_session renders GymSession with scheduleType="sequence"', () => {
    const session: Session = {
      id: 's-1', userId: 'u1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-a',
      date: '2026-02-10', status: 'in_progress', note: null, startedAt: '2026-02-10T09:00:00Z',
      completedAt: null, createdAt: '2026-02-10T09:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
    }
    schedulerData = { result: { type: 'active_session', session }, isLoading: false, workoutDays: [workoutDayA], allWeekPlans: [] }
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('GYM_SESSION:sequence')).toBeTruthy()
  })

  it('completed_today renders CompletedTodayScreen with scheduleType="sequence"', () => {
    const session: Session = {
      id: 's-1', userId: 'u1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-a',
      date: '2026-02-10', status: 'completed', note: null, startedAt: '2026-02-10T09:00:00Z',
      completedAt: '2026-02-10T10:00:00Z', createdAt: '2026-02-10T09:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
    }
    schedulerData = { result: { type: 'completed_today', session }, isLoading: false, workoutDays: [workoutDayA], allWeekPlans: [] }
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('COMPLETED:sequence')).toBeTruthy()
  })
})

describe('SequenceTodayPage — "next": due text and the START/TRAIN ANYWAY button', () => {
  it('ready now (dueDate null — nothing ever trained) shows READY NOW and START SESSION', () => {
    schedulerData = nextResult({ dueDate: null, isDue: true })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('READY NOW')).toBeTruthy()
    expect(screen.getByText('START SESSION')).toBeTruthy()
  })

  it('due today shows DUE TODAY and START SESSION', () => {
    schedulerData = nextResult({ dueDate: '2026-02-10', isDue: true })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('DUE TODAY')).toBeTruthy()
    expect(screen.getByText('START SESSION')).toBeTruthy()
  })

  it('overdue shows OVERDUE BY N DAYS and still START SESSION (isDue stays true)', () => {
    schedulerData = nextResult({ dueDate: '2026-02-07', isDue: true })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('OVERDUE BY 3 DAYS')).toBeTruthy()
  })

  it('not yet due ("on a rest day") shows DUE IN N DAYS and TRAIN ANYWAY, never START SESSION', () => {
    schedulerData = nextResult({ dueDate: '2026-02-13', isDue: false })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('DUE IN 3 DAYS')).toBeTruthy()
    expect(screen.getByText('TRAIN ANYWAY')).toBeTruthy()
    expect(screen.queryByText('START SESSION')).toBeNull()
  })

  it('due tomorrow (not yet due) shows DUE TOMORROW', () => {
    schedulerData = nextResult({ dueDate: '2026-02-11', isDue: false })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('DUE TOMORROW')).toBeTruthy()
  })

  it('shows "CYCLE n" (the cycle index), never "WEEK"', () => {
    schedulerData = nextResult({ weekNumber: 5 })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('CYCLE 5')).toBeTruthy()
    expect(screen.queryByText(/WEEK 5/)).toBeNull()
  })
})

describe('SequenceTodayPage — what START/TRAIN ANYWAY hands to its hooks (Lessons)', () => {
  it('START SESSION plans the slot (workoutDayId + sequencePosition) then creates a session dated today', async () => {
    schedulerData = nextResult({ weekNumber: 3, sequencePosition: 2, isDue: true })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)

    fireEvent.click(screen.getByText('START SESSION'))

    await waitFor(() => expect(createSessionMutateAsyncMock).toHaveBeenCalled())
    // planWeekThenFindId(mesoId, weekNumber, workoutDayId, fallback, planWeekMutation, fetchPlans, sequencePosition)
    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', 3, 'wd-a', null, expect.anything(), expect.anything(), 2,
    )
    expect(createSessionMutateAsyncMock).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-resolved', workoutDayId: 'wd-a', date: '2026-02-10',
    })
  })

  it('TRAIN ANYWAY (not yet due) runs the exact same plan-then-create sequence as START SESSION', async () => {
    schedulerData = nextResult({ weekNumber: 3, sequencePosition: 2, isDue: false, dueDate: '2026-02-15' })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)

    fireEvent.click(screen.getByText('TRAIN ANYWAY'))

    await waitFor(() => expect(createSessionMutateAsyncMock).toHaveBeenCalled())
    expect(createSessionMutateAsyncMock).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-resolved', workoutDayId: 'wd-a', date: '2026-02-10',
    })
  })

  // Chunk 25 review fix 2 (DECISIONS 73 option a — the first named gap:
  // "changing next.sequencePosition to null in Skip's plan lookup passes
  // all 412 gym tests"). sequencePosition: 2 (not 0) — a repeated workout's
  // SECOND slot, so a `null` or "the other slot's" substitution reads as a
  // visibly different, wrong number here, never coincidentally right.
  it('SKIP plans THAT SLOT (position 2, not 0 or null) then skips it with no existing session id, never calling createSession', async () => {
    schedulerData = nextResult({ weekNumber: 3, sequencePosition: 2, isDue: true })
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)

    fireEvent.click(screen.getByText('SKIP'))

    await waitFor(() => expect(skipNextMutateAsyncMock).toHaveBeenCalled())
    // planWeekThenFindId(mesoId, weekNumber, workoutDayId, fallback, planWeekMutation, fetchPlans, sequencePosition)
    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', 3, 'wd-a', null, expect.anything(), expect.anything(), 2,
    )
    expect(skipNextMutateAsyncMock).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-resolved', workoutDayId: 'wd-a', date: '2026-02-10', existingSessionId: null,
    })
    expect(createSessionMutateAsyncMock).not.toHaveBeenCalled()
  })
})

// Chunk 25 review fix 2 — the OTHER half of the "next" result's own slot
// wiring (lines 113-115): the weekPlan looked up for DISPLAY (the DELOAD
// badge) and as planWeekThenFindId's own fallback id, matched by BOTH
// workoutDayId AND sequencePosition — never by workoutDayId alone, so a
// repeated workout's two already-planned rows (allWeekPlans, same
// workoutDayId, different ids and positions) are told apart correctly.
describe('SequenceTodayPage — the next result\'s own weekPlan lookup picks the right slot\'s row among several sharing one workoutDayId', () => {
  function withTwoSlotPlans(sequencePosition: number): SequenceSchedulerData {
    return {
      result: {
        type: 'next',
        next: { workoutDayId: 'wd-a', weekNumber: 3, sequencePosition },
        dueDate: '2026-02-10',
        isDue: true,
      },
      isLoading: false,
      workoutDays: [workoutDayA],
      allWeekPlans: [
        {
          id: 'wp-slot0', userId: 'u1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 3,
          sequencePosition: 0, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'wp-slot2', userId: 'u1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 3,
          sequencePosition: 2, isDeload: true, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    }
  }

  it('slot 2 is marked deload in allWeekPlans, slot 0 is not — the DELOAD badge shows only when `next` names slot 2', () => {
    schedulerData = withTwoSlotPlans(2)
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText('DELOAD')).toBeTruthy()
  })

  it('the SAME allWeekPlans, but `next` names slot 0 instead — no DELOAD badge (slot 0\'s own row isn\'t marked)', () => {
    schedulerData = withTwoSlotPlans(0)
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.queryByText('DELOAD')).toBeNull()
  })

  it('starting from slot 2 passes slot 2\'s OWN row id as the fallback, never slot 0\'s', async () => {
    schedulerData = withTwoSlotPlans(2)
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)

    fireEvent.click(screen.getByText('START SESSION'))

    await waitFor(() => expect(createSessionMutateAsyncMock).toHaveBeenCalled())
    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', 3, 'wd-a', 'wp-slot2', expect.anything(), expect.anything(), 2,
    )
  })
})

describe('SequenceTodayPage — no_workouts', () => {
  it('shows an empty-cycle message, no crash', () => {
    schedulerData = { result: { type: 'no_workouts' }, isLoading: false, workoutDays: [], allWeekPlans: [] }
    render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    expect(screen.getByText(/no workouts yet/i)).toBeTruthy()
  })
})

describe('SequenceTodayPage — 375px', () => {
  it('no element carries a fixed pixel width wider than 375px', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
    schedulerData = nextResult()
    const { container } = render(<SequenceTodayPage today="2026-02-10" todayLabel="TUESDAY" activeMeso={activeMeso} programId="prog-1" />)
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
