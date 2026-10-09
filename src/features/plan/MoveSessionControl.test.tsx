// @vitest-environment jsdom
//
// Chunk 24 (SPEC "Weekday" — "'Move this session' on Today and in Plan").
// The real component (every PlanPage.*.test.tsx file stubs this one to
// null — see this chunk's report for why); this file is where it's
// actually proven, same "screen-layer tests asserting what each button
// hands to its hook" Lessons bullet TodayPage.moveSession.test.tsx follows.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { Session, WorkoutDay, WeekPlan } from '../../types'

afterEach(() => cleanup())

const MON = '2026-08-24'
const FRI = '2026-08-28'

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const weekPlan: WeekPlan = { id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z' }

let sessionsData: Session[] | undefined = []
let isOnline = true
const moveMutate = vi.fn()
const clearMutate = vi.fn()

vi.mock('../gym/useSession', () => ({
  useSessionsInRange: () => ({ data: sessionsData }),
  useMoveSession: () => ({ mutate: moveMutate, isPending: false }),
  useClearMovedSession: () => ({ mutate: clearMutate, isPending: false }),
}))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => isOnline }))

const { default: MoveSessionControl } = await import('./MoveSessionControl')

beforeEach(() => {
  sessionsData = []
  isOnline = true
  moveMutate.mockClear()
  clearMutate.mockClear()
})

function renderControl(isCurrentWeek = true) {
  return render(
    <MoveSessionControl
      workoutDay={workoutDay}
      weekPlan={weekPlan}
      mesoId="meso-1"
      date={MON}
      isCurrentWeek={isCurrentWeek}
    />,
  )
}

describe('MoveSessionControl — scope: current week only', () => {
  it('renders nothing when the viewed week is not the current one', () => {
    const { container } = renderControl(false)
    expect(container.innerHTML).toBe('')
  })
})

describe('MoveSessionControl — no existing row (not yet started)', () => {
  it('shows the control, and picking a day hands useMoveSession the exact write', () => {
    renderControl()

    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(screen.getByText('FRI').closest('button')!)

    expect(moveMutate).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: MON, targetDate: FRI,
    })
    expect(clearMutate).not.toHaveBeenCalled()
  })

  it('offline: disabled, with a note', () => {
    isOnline = false
    renderControl()

    const button = screen.getByText('MOVE THIS SESSION').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('REQUIRES A CONNECTION')).toBeTruthy()
  })
})

describe('MoveSessionControl — an already-moved (planned) row for this slot', () => {
  it('picking it back to its own original day calls useClearMovedSession', () => {
    sessionsData = [{
      id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1',
      workoutDayId: 'wd-1', date: MON, status: 'planned', note: null, startedAt: null,
      completedAt: null, createdAt: MON, energyRating: null, pumpRating: null, movedToDate: FRI,
    }]
    renderControl()

    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(screen.getByText('MON').closest('button')!)

    expect(clearMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', date: MON })
    expect(moveMutate).not.toHaveBeenCalled()
  })
})

describe('MoveSessionControl — a started session (in progress or completed) cannot be moved', () => {
  it.each(['in_progress', 'completed'] as const)('%s: shows the "cannot be moved" note, no MOVE button', (status) => {
    sessionsData = [{
      id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1',
      workoutDayId: 'wd-1', date: MON, status, note: null,
      startedAt: `${MON}T09:00:00Z`, completedAt: status === 'completed' ? `${MON}T10:00:00Z` : null,
      createdAt: MON, energyRating: null, pumpRating: null,
    }]
    renderControl()

    expect(screen.getByText(/CAN'T BE MOVED/)).toBeTruthy()
    expect(screen.queryByText('MOVE THIS SESSION')).toBeNull()
  })
})
