// @vitest-environment jsdom
//
// Chunk 25 — useSequenceScheduler.ts's own gathering logic (Lessons: "prove
// every rule at the layer that applies it"): resolving the last
// done-or-skipped session's own SLOT via its week plan row (reviewer's
// note 2 — "read from that session's week plan sequence_position and
// week_number"), not re-derived from the sequence items list. sequenceSchedule.
// test.ts already exhaustively covers scheduleSequence itself given a
// hand-built lastEvent; this file is the one proof that THIS hook builds
// that lastEvent correctly from real-shaped query results.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type { WorkoutDay, WeekPlan, Session, SequenceItem, Mesocycle } from '../../types'

let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] = []
let allWeekPlans: WeekPlan[] = []
let lastDoneOrSkipped: Session | null = null
let sessions: Session[] = []

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays }),
  useSequenceItems: () => ({ data: sequenceItems }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  useAllWeekPlans: () => ({ data: allWeekPlans }),
}))
vi.mock('./useSession', () => ({
  useLastDoneOrSkippedSession: () => ({ data: lastDoneOrSkipped }),
  useSessionsInRange: () => ({ data: sessions }),
}))

const { useSequenceScheduler } = await import('./useSequenceScheduler')

afterEach(() => {
  cleanup()
  workoutDays = []
  sequenceItems = []
  allWeekPlans = []
  lastDoneOrSkipped = null
  sessions = []
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'u1', name: 'Seq', programId: 'prog-1', status: 'active',
  startDate: '2026-01-01', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

function Probe({ today }: { today: string }) {
  const data = useSequenceScheduler(today, activeMeso, 'prog-1')
  return <div>RESULT:{JSON.stringify(data.result)}</div>
}

function weekPlan(overrides: Partial<WeekPlan> & { id: string }): WeekPlan {
  return {
    userId: 'u1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 1, isDeload: false,
    notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z', sequencePosition: null,
    ...overrides,
  }
}

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    userId: 'u1', mesocycleId: 'meso-1', weekPlanId: null, workoutDayId: 'wd-a', date: '2026-02-01',
    status: 'completed', note: null, startedAt: '2026-02-01T09:00:00Z', completedAt: '2026-02-01T10:00:00Z',
    createdAt: '2026-02-01T09:00:00Z', setLogs: [], energyRating: null, pumpRating: null, movedToDate: null,
    ...overrides,
  }
}

describe('useSequenceScheduler — resolving lastEvent from the last done-or-skipped session\'s own week plan row', () => {
  it('resolves weekNumber/sequencePosition/status/date from the matching week plan row, feeding scheduleSequence correctly', () => {
    workoutDays = [{ id: 'wd-a', programId: 'prog-1', userId: 'u1', name: 'A', position: 0, exercises: [] }]
    sequenceItems = [
      { id: 'si-1', userId: 'u1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' },
      { id: 'si-2', userId: 'u1', programId: 'prog-1', position: 1, workoutDayId: null },
    ]
    allWeekPlans = [weekPlan({ id: 'wp-1', weekNumber: 4, sequencePosition: 0 })]
    lastDoneOrSkipped = session({ id: 's-1', weekPlanId: 'wp-1', status: 'completed', date: '2026-02-01' })
    sessions = []

    render(<Probe today="2026-02-05" />)
    const result = JSON.parse(screen.getByText(/RESULT:/).textContent!.replace('RESULT:', ''))
    // From week plan wp-1 (week 4, slot 0, completed 2026-02-01): next slot
    // wraps past the rest item back to position 0 (wd-a again), cycle 5,
    // due 2026-02-01 + 1 rest + 1 = 2026-02-03 — already overdue by 2026-02-05.
    expect(result).toEqual({
      type: 'next',
      next: { workoutDayId: 'wd-a', weekNumber: 5, sequencePosition: 0 },
      dueDate: '2026-02-03',
      isDue: true,
    })
  })

  it('a skipped last event anchors the next due date to the SKIP\'s own date (status read correctly off the session row)', () => {
    workoutDays = [{ id: 'wd-a', programId: 'prog-1', userId: 'u1', name: 'A', position: 0, exercises: [] }]
    sequenceItems = [{ id: 'si-1', userId: 'u1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' }]
    allWeekPlans = [weekPlan({ id: 'wp-1', weekNumber: 1, sequencePosition: 0 })]
    lastDoneOrSkipped = session({ id: 's-1', weekPlanId: 'wp-1', status: 'skipped', date: '2026-02-05' })
    sessions = []

    render(<Probe today="2026-02-05" />)
    const result = JSON.parse(screen.getByText(/RESULT:/).textContent!.replace('RESULT:', ''))
    expect(result.dueDate).toBe('2026-02-05')
    expect(result.isDue).toBe(true)
  })

  it('weekPlanId missing/unresolvable (defensive) falls back to lastEvent null — treated as "nothing ever trained"', () => {
    workoutDays = [{ id: 'wd-a', programId: 'prog-1', userId: 'u1', name: 'A', position: 0, exercises: [] }]
    sequenceItems = [{ id: 'si-1', userId: 'u1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' }]
    allWeekPlans = [] // the referenced week plan row isn't in the meso-wide list at all
    lastDoneOrSkipped = session({ id: 's-1', weekPlanId: 'wp-does-not-exist', status: 'completed', date: '2026-02-01' })
    sessions = []

    render(<Probe today="2026-02-05" />)
    const result = JSON.parse(screen.getByText(/RESULT:/).textContent!.replace('RESULT:', ''))
    expect(result).toEqual({
      type: 'next',
      next: { workoutDayId: 'wd-a', weekNumber: 1, sequencePosition: 0 },
      dueDate: null,
      isDue: true,
    })
  })

  it('a weekday-shaped week plan row (sequencePosition null) is also treated as unresolvable — never crosses into sequence scheduling by accident', () => {
    workoutDays = [{ id: 'wd-a', programId: 'prog-1', userId: 'u1', name: 'A', position: 0, exercises: [] }]
    sequenceItems = [{ id: 'si-1', userId: 'u1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' }]
    allWeekPlans = [weekPlan({ id: 'wp-1', weekNumber: 4, sequencePosition: null })]
    lastDoneOrSkipped = session({ id: 's-1', weekPlanId: 'wp-1', status: 'completed', date: '2026-02-01' })
    sessions = []

    render(<Probe today="2026-02-05" />)
    const result = JSON.parse(screen.getByText(/RESULT:/).textContent!.replace('RESULT:', ''))
    expect(result.dueDate).toBeNull()
    expect(result.next).toEqual({ workoutDayId: 'wd-a', weekNumber: 1, sequencePosition: 0 })
  })

  it('an in-progress session (within the lookback window) short-circuits to active_session regardless of lastEvent', () => {
    workoutDays = [{ id: 'wd-a', programId: 'prog-1', userId: 'u1', name: 'A', position: 0, exercises: [] }]
    sequenceItems = [{ id: 'si-1', userId: 'u1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' }]
    allWeekPlans = []
    lastDoneOrSkipped = null
    const active = session({ id: 's-active', status: 'in_progress', date: '2026-02-05' })
    sessions = [active]

    render(<Probe today="2026-02-05" />)
    const result = JSON.parse(screen.getByText(/RESULT:/).textContent!.replace('RESULT:', ''))
    expect(result).toEqual({ type: 'active_session', session: active })
  })
})
