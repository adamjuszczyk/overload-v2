// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Mesocycle, Program, RunSchedule, Session, WeeklySchedule } from '../../types'

// Chunk 50: the rest-day screen's "N of M sessions done this week" counts the weekdays that hold a workout IN THIS
// WEEK's schedule. A weekday change saved in week N starts in week N + 1 and the run copy then holds the NEW days, so a
// count read off the run copy would show next week's number in this week. The fixture's run changed from three days to two
// at week 3, so the run copy (two days) and the rows (three days before week 3) tell the right source from the wrong one.

afterEach(() => cleanup())

const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const days = (over: Partial<WeeklySchedule>): WeeklySchedule => ({ ...NONE, ...over })
const THREE_DAYS = days({ monday: 'wd-a', wednesday: 'wd-b', friday: 'wd-a' }) // weeks 1 and 2
const TWO_DAYS = days({ tuesday: 'wd-a', thursday: 'wd-b' }) // week 3 on, and what the run copy holds
const row = (fromWeek: number, schedule: WeeklySchedule): RunSchedule => ({
  id: `r${fromWeek}`, userId: 'user-1', mesocycleId: 'meso-1', fromWeek, schedule, createdAt: '2026-09-01T00:00:00Z',
})

const meso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-08-24', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const runCopy: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: TWO_DAYS, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run',
}
const completed = (date: string): Session => ({
  id: `s-${date}`, userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: null, workoutDayId: 'wd-a', date, status: 'completed',
  note: null, startedAt: null, completedAt: null, createdAt: '2026-08-01T00:00:00Z', energyRating: null, pumpRating: null,
})

const mock: { rows: RunSchedule[] | undefined; sessions: Session[]; askedMeso: Array<string | undefined> } = {
  rows: [row(1, THREE_DAYS), row(3, TWO_DAYS)],
  sessions: [],
  askedMeso: [],
}

vi.mock('../programs/usePrograms', () => ({ usePrograms: () => ({ data: [runCopy] }) }))
vi.mock('./useSession', () => ({ useSessionsInRange: () => ({ data: mock.sessions }) }))
vi.mock('../plan/useRunSchedule', () => ({
  useRunSchedule: (mesoId: string | undefined) => {
    mock.askedMeso.push(mesoId)
    return { data: mock.rows }
  },
}))

const { default: RestDayScreen } = await import('./RestDayScreen')

beforeEach(() => {
  mock.rows = [row(1, THREE_DAYS), row(3, TWO_DAYS)]
  mock.sessions = []
  mock.askedMeso = []
})

// A Wednesday of week 2 (2026-09-02) and of week 3 (2026-09-09): the screen reads the week from `currentWeek`.
const dots = (container: HTMLElement) => container.querySelectorAll('span.rounded-full').length

describe('RestDayScreen — the sessions planned this week are the weekdays in force this week (chunk 50)', () => {
  it('reads the rows of the active run', () => {
    render(<RestDayScreen activeMeso={meso} currentWeek={3} today="2026-09-09" />)
    expect(mock.askedMeso).toContain('meso-1')
  })

  it('week 3 (the row\'s own week): two sessions', () => {
    const { container } = render(<RestDayScreen activeMeso={meso} currentWeek={3} today="2026-09-09" />)
    expect(screen.getByText('0 OF 2 SESSIONS DONE THIS WEEK')).toBeTruthy()
    expect(dots(container)).toBe(2)
  })

  it('week 2: three sessions, though the run copy now holds two days', () => {
    const { container } = render(<RestDayScreen activeMeso={meso} currentWeek={2} today="2026-09-02" />)
    expect(screen.getByText('0 OF 3 SESSIONS DONE THIS WEEK')).toBeTruthy()
    expect(dots(container)).toBe(3)
  })

  it('counts what was done this week against that number', () => {
    mock.sessions = [completed('2026-09-01'), completed('2026-09-02')]
    render(<RestDayScreen activeMeso={meso} currentWeek={2} today="2026-09-02" />)
    expect(screen.getByText('2 OF 3 SESSIONS DONE THIS WEEK')).toBeTruthy()
  })

  it('with no rows the run copy\'s days count in every week (a run nobody changed the days of)', () => {
    mock.rows = []
    render(<RestDayScreen activeMeso={meso} currentWeek={2} today="2026-09-02" />)
    expect(screen.getByText('0 OF 2 SESSIONS DONE THIS WEEK')).toBeTruthy()
  })

  it('a week with no workout on any day shows no count at all', () => {
    mock.rows = [row(1, NONE)]
    const { container } = render(<RestDayScreen activeMeso={meso} currentWeek={2} today="2026-09-02" />)
    expect(screen.queryByText(/SESSIONS DONE THIS WEEK/)).toBeNull()
    expect(dots(container)).toBe(0)
  })
})
