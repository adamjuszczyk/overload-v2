// @vitest-environment jsdom
// DECISIONS 241 (found in the release checklist's RC25, executed on staging; reachable in 1.1 too: Plan's MOVE offered "today and later days of the session's week"
// there as well): a session moved in Plan to a day BEFORE its own (Wednesday's Lower A to today, Tuesday) is written (`date` Wednesday, `moved_to_date` Tuesday, status planned),
// but Today read its sessions by `date` up to today, so a row dated tomorrow was never read and its `moved_to_date` of today was never seen: "REST DAY · NEXT UP Lower A TOMORROW".
//
// The call site is Today's scheduler: `useScheduler` -> the real `useSessionsInRange` -> the real `fetchSessionsInRange` -> a fake `v2_sessions` that answers a PostgREST `or` the way
// PostgREST reads it (only the shape the app sends is understood: anything else throws, so a read that stops filtering can't pass by returning everything). The hooks beneath the
// scheduler other than the sessions (runs, programs, plans, the run's schedule rows) are mocked, as `useScheduler.test.tsx` has them.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import type { ReactNode } from 'react'
import type { DayOfWeek, Mesocycle, Program, WeeklySchedule, WorkoutDay } from '../../types'

const MESO_MONDAY = parseISO('2026-08-24') // a Monday
const DOW_INDEX: Record<DayOfWeek, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 }
/** The date of a weekday of a run week, checked against the calendar and printed in the failure (RULES.md, Checks that lied #21). */
function on(week: number, day: DayOfWeek): string {
  const date = addDays(MESO_MONDAY, (week - 1) * 7 + DOW_INDEX[day])
  expect(format(date, 'EEEE').toLowerCase(), `${format(date, 'yyyy-MM-dd')} is not a ${day}`).toBe(day)
  return format(date, 'yyyy-MM-dd')
}

const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const wdUpperA: WorkoutDay = { id: 'wd-ua', programId: 'prog-1', userId: 'user-1', name: 'Upper A', position: 0, exercises: [] }
const wdLowerA: WorkoutDay = { id: 'wd-la', programId: 'prog-1', userId: 'user-1', name: 'Lower A', position: 1, exercises: [] }
const wdUpperB: WorkoutDay = { id: 'wd-ub', programId: 'prog-1', userId: 'user-1', name: 'Upper B', position: 2, exercises: [] }
const meso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Run', programId: 'prog-1', status: 'active', startDate: '2026-08-24', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
// Mon Upper A, Wed Lower A, Fri Upper B: the staging test account's run.
const runCopy: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Upper/Lower', schedule: { ...NONE, monday: 'wd-ua', wednesday: 'wd-la', friday: 'wd-ub' }, workoutDays: [wdUpperA, wdLowerA, wdUpperB],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run',
}

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ rows: [] as Row[], requests: [] as string[] }))
const session = (id: string, workoutDayId: string, date: string, movedToDate: string | null, status = 'planned'): Row => ({
  id, user_id: 'user-1', mesocycle_id: 'meso-1', week_plan_id: null, workout_day_id: workoutDayId, date, moved_to_date: movedToDate, status, note: null,
  started_at: null, completed_at: null, created_at: '2026-08-24T00:00:00Z',
})

/**
 * PostgREST's `or=(and(a.gte.X,a.lte.Y),and(b.gte.X,b.lte.Y))`: any group whose every condition holds. A NULL column fails a comparison. The reader knows `gte`, `lte` and `eq`
 * and exactly this grammar; a different spelling throws.
 */
function matchesOr(expression: string): (row: Row) => boolean {
  const groups = [...expression.matchAll(/and\(([^()]*)\)/g)]
  if (groups.length === 0 || groups.map((g) => g[0]).join(',') !== expression) throw new Error(`fake PostgREST: not an or of and(...) groups: ${expression}`)
  const parsed = groups.map((g) =>
    g[1].split(',').map((condition) => {
      const [column, op, ...value] = condition.split('.')
      if (!['gte', 'lte', 'eq'].includes(op)) throw new Error(`fake PostgREST: unknown operator in ${condition}`)
      return { column, op, value: value.join('.') }
    }),
  )
  const holds = (row: Row, c: { column: string; op: string; value: string }) => {
    const v = row[c.column]
    if (v === null || v === undefined) return false
    return c.op === 'gte' ? (v as string) >= c.value : c.op === 'lte' ? (v as string) <= c.value : v === c.value
  }
  return (row) => parsed.some((group) => group.every((c) => holds(row, c)))
}
function sessionsQuery() {
  const tests: Array<(row: Row) => boolean> = []
  const chain = {
    select: () => chain,
    gte: (column: string, value: string) => (tests.push((row) => row[column] != null && (row[column] as string) >= value), h.requests.push(`gte ${column} ${value}`), chain),
    lte: (column: string, value: string) => (tests.push((row) => row[column] != null && (row[column] as string) <= value), h.requests.push(`lte ${column} ${value}`), chain),
    or: (expression: string) => (tests.push(matchesOr(expression)), h.requests.push(`or ${expression}`), chain),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: h.rows.filter((row) => tests.every((test) => test(row))).map((row) => ({ ...row })), error: null }),
  }
  return chain
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => (table === 'v2_sessions' ? sessionsQuery() : (() => { throw new Error(`unexpected read of ${table}`) })()) } }))
vi.mock('../../lib/db', () => ({ db: { sync_queue: { toArray: async () => [], orderBy: () => ({ toArray: async () => [] }) } } }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [meso] }) }))
vi.mock('../programs/usePrograms', () => ({ usePrograms: () => ({ data: [runCopy] }), useWorkoutDays: () => ({ data: [wdUpperA, wdLowerA, wdUpperB] }) }))
vi.mock('../plan/useWeekPlan', () => ({ useWeekPlans: () => ({ data: [] }), useAllWeekPlans: () => ({ data: [] }) }))
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))

const { queryClient } = await import('../../lib/queryClient')
const { useScheduler } = await import('./useScheduler')
const { fetchSessionsInRange } = await import('./sessionService')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
beforeEach(() => {
  h.rows = []
  h.requests = []
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
})
async function todayAt(today: string) {
  const view = renderHook(() => useScheduler(today), { wrapper })
  await waitFor(() => expect(view.result.current.isLoading).toBe(false))
  return view.result.current.result
}

// The days of week 2 that came before, done, so that no earlier scheduled day reads as missed (the scheduler's prompt would take over Today).
const mondayDone = () => session('s-mon', 'wd-ua', on(2, 'monday'), null, 'completed')
const wednesdayDone = () => session('s-wed', 'wd-la', on(2, 'wednesday'), null, 'completed')

describe('Today finds a session moved to a day before its own (DECISIONS 241)', () => {
  it('Wednesday\'s Lower A moved to Tuesday (today): Tuesday lists it as the planned session, not "rest day, next up Lower A tomorrow"', async () => {
    h.rows = [mondayDone(), session('s-la', 'wd-la', on(2, 'wednesday'), on(2, 'tuesday'))]
    const result = await todayAt(on(2, 'tuesday'))
    if (result?.type !== 'planned') throw new Error(`Tuesday should list the moved session, got ${result?.type}`)
    expect(result.session.id).toBe('s-la')
    expect(result.session).toMatchObject({ date: on(2, 'wednesday'), movedToDate: on(2, 'tuesday') })
    expect(result.workoutDay).toEqual(wdLowerA)
  })

  it('the day it left is not Wednesday\'s any more: with the browser clock on Wednesday the row is read by its own date and the slot is not suggested again (as before)', async () => {
    h.rows = [mondayDone(), session('s-la', 'wd-la', on(2, 'wednesday'), on(2, 'tuesday'))]
    const result = await todayAt(on(2, 'wednesday'))
    expect(result?.type).toBe('rest_day')
  })

  it('a session moved to a LATER day still shows on that day (the case that was always right) and not on its own', async () => {
    h.rows = [mondayDone(), wednesdayDone(), session('s-ub', 'wd-ub', on(2, 'friday'), on(2, 'saturday'))]
    expect((await todayAt(on(2, 'saturday')))?.type).toBe('planned')
    queryClient.clear()
    expect((await todayAt(on(2, 'friday')))?.type).toBe('rest_day') // Friday's slot was vacated: no suggestion, no second Upper B
  })

  it('a session dated later in the week and moved to a day that is still ahead is not read for today: Wednesday\'s Lower A moved to Thursday is not Tuesday\'s', async () => {
    h.rows = [mondayDone(), session('s-la', 'wd-la', on(2, 'wednesday'), on(2, 'thursday'))]
    expect((await todayAt(on(2, 'tuesday')))?.type).toBe('rest_day')
  })

  it('two sessions on the day: the moved-in one is listed beside the day\'s own', async () => {
    h.rows = [session('s-la', 'wd-la', on(2, 'wednesday'), on(2, 'monday'))]
    const result = await todayAt(on(2, 'monday')) // Monday's own Upper A is suggested, and Lower A moved here is listed with it
    if (result?.type !== 'due_today') throw new Error(`expected both sessions listed, got ${result?.type}`)
    expect(result.sessions.map((entry) => entry.type)).toEqual(['planned', 'suggest_no_plan'])
  })
})

describe('fetchSessionsInRange reads the sessions dated in the window and those moved into it (DECISIONS 241)', () => {
  const from = on(1, 'tuesday')
  const to = on(2, 'tuesday')
  it('asks for both ranges in one request, and answers the rows of either', async () => {
    h.rows = [
      session('dated-in', 'wd-ua', on(2, 'monday'), null),
      session('dated-in-moved-out', 'wd-ua', on(2, 'monday'), on(2, 'saturday')), // dated in the window, moved beyond it: still read (the scheduler needs it)
      session('moved-in', 'wd-la', on(2, 'wednesday'), on(2, 'tuesday')), // dated beyond the window, moved into it
      session('too-early', 'wd-ua', on(1, 'monday'), null),
      session('later-week', 'wd-ub', on(2, 'friday'), on(2, 'sunday')), // dated and moved beyond the window: not read
    ]
    const rows = await fetchSessionsInRange(from, to)
    expect(rows.map((r) => r.id).sort()).toEqual(['dated-in', 'dated-in-moved-out', 'moved-in'])
    expect(h.requests).toEqual([`or and(date.gte.${from},date.lte.${to}),and(moved_to_date.gte.${from},moved_to_date.lte.${to})`])
  })

  it('a single-day window (Plan\'s MOVE control asks for one day) reads the day\'s own rows and those moved onto it', async () => {
    h.rows = [session('own', 'wd-la', on(2, 'wednesday'), null), session('moved-onto', 'wd-ua', on(2, 'monday'), on(2, 'wednesday')), session('other', 'wd-ub', on(2, 'friday'), null)]
    const rows = await fetchSessionsInRange(on(2, 'wednesday'), on(2, 'wednesday'))
    expect(rows.map((r) => r.id).sort()).toEqual(['moved-onto', 'own'])
  })
})
