// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { addDays, format, parseISO } from 'date-fns'
import type { DayOfWeek, Mesocycle, Program, RunSchedule, Session, WeeklySchedule, WorkoutDay } from '../../types'

// Chunk 50: Today's scheduler is handed the weekday schedule in force per week, built from the run's rows
// (`useRunSchedule`) and the run copy's schedule (the program the run points at). This is the call site (scheduler.test.ts
// and scheduler.scheduleForWeek.test.ts prove the rule; this proves the hook gives it the right data): the run copy holds
// a day no row says, so a hook that hands the scheduler the run copy (or leaves the rows out) answers differently from
// one that resolves the rows. Only the data hooks beneath it are mocked.

const MESO_MONDAY = parseISO('2026-08-24') // a Monday
const DOW_INDEX: Record<DayOfWeek, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 }
function on(week: number, day: DayOfWeek): string {
  const date = addDays(MESO_MONDAY, (week - 1) * 7 + DOW_INDEX[day])
  expect(format(date, 'EEEE').toLowerCase(), `${format(date, 'yyyy-MM-dd')} is not a ${day}`).toBe(day)
  return format(date, 'yyyy-MM-dd')
}

const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const days = (over: Partial<WeeklySchedule>): WeeklySchedule => ({ ...NONE, ...over })

const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const meso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-08-24', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const runCopy: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: days({ saturday: 'wd-push' }), workoutDays: [wdPush],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run',
}
const row = (fromWeek: number, schedule: WeeklySchedule): RunSchedule => ({
  id: `r${fromWeek}`, userId: 'user-1', mesocycleId: 'meso-1', fromWeek, schedule, createdAt: '2026-09-01T00:00:00Z',
})
const ROWS = [row(1, days({ tuesday: 'wd-push' })), row(3, days({ wednesday: 'wd-push' }))]

const mock: { rows: RunSchedule[] | undefined; sessions: Session[]; askedMeso: Array<string | undefined>; program: Program } = {
  rows: ROWS,
  sessions: [],
  askedMeso: [],
  program: runCopy,
}

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [meso] }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mock.program] }),
  useWorkoutDays: () => ({ data: [wdPush] }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [] }),
  useAllWeekPlans: () => ({ data: [] }),
}))
vi.mock('../plan/useRunSchedule', () => ({
  useRunSchedule: (mesoId: string | undefined) => {
    mock.askedMeso.push(mesoId)
    return { data: mock.rows }
  },
}))
vi.mock('./useSession', () => ({ useSessionsInRange: () => ({ data: mock.sessions }) }))

const { useScheduler } = await import('./useScheduler')

beforeEach(() => {
  mock.rows = ROWS
  mock.sessions = []
  mock.askedMeso = []
  mock.program = runCopy
})

const result = (today: string, dismissMissed = false) => renderHook(() => useScheduler(today, dismissMissed)).result.current

describe('useScheduler hands the scheduler the weekday schedule in force per week', () => {
  it('reads the rows of the active run', () => {
    result(on(3, 'wednesday'))
    expect(mock.askedMeso).toContain('meso-1')
  })

  it('week 3 (the row\'s own week): Wednesday is today\'s session, not the run copy\'s Saturday', () => {
    const data = result(on(3, 'wednesday'))
    expect(data.isLoading).toBe(false)
    expect(data.currentWeek).toBe(3)
    expect(data.result).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(3, 'wednesday') })
  })

  it('week 3: a Tuesday is a rest day (the week-2 Tuesday is gone), and the run copy\'s Saturday is not a session day either', () => {
    expect(result(on(3, 'tuesday')).result?.type).toBe('rest_day')
    expect(result(on(3, 'saturday'), true).result?.type).toBe('rest_day')
  })

  it('week 2: Tuesday is today\'s session (the row from week 1)', () => {
    expect(result(on(2, 'tuesday')).result).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(2, 'tuesday') })
  })

  it('the missed-session queue of week 2 holds the missed Tuesday and never a Wednesday', () => {
    const data = result(on(2, 'friday'))
    if (data.result?.type !== 'missed_sessions') throw new Error(`expected the missed Tuesday, got ${data.result?.type}`)
    expect(data.result.queue.map((m) => m.date)).toEqual([on(2, 'tuesday')])
  })

  it('a run with no rows resolves to the run copy in every week (a run nobody changed the days of)', () => {
    mock.rows = []
    expect(result(on(3, 'saturday')).result).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(3, 'saturday') })
    expect(result(on(3, 'wednesday'), true).result?.type).toBe('rest_day')
  })

  it('waits for the rows: until they have answered, nothing is decided from the run copy\'s days', () => {
    mock.rows = undefined
    const data = result(on(3, 'wednesday'))
    expect(data.isLoading).toBe(true)
    expect(data.result).toBeNull()
  })

  it('a sequence run waits for nothing: it has no weekday schedule and no rows, so the read can\'t hold its Today', () => {
    mock.program = { ...runCopy, scheduleType: 'sequence' }
    mock.rows = undefined
    const data = result(on(3, 'wednesday'))
    expect(data.isLoading).toBe(false)
    expect(data.program?.scheduleType).toBe('sequence')
  })

  it('gives the screens the same data as before (the active run\'s program, workouts and week)', () => {
    const data = result(on(3, 'wednesday'))
    expect(data.activeMeso).toEqual(meso)
    expect(data.program).toEqual(runCopy)
    expect(data.workoutDays).toEqual([wdPush])
  })
})
