import { describe, it, expect } from 'vitest'
import { resolveWeek } from './weekResolution'
import type { DayOfWeek, Mesocycle, Program, Session, WeeklySchedule, WorkoutDay } from '../../types'

// Monday 2026-08-17 through Sunday 2026-08-23 — the same real week the
// step 1 diagnostic (CONTEXT.md, 2026-08-20 session) ran against.
const WEEK_START = '2026-08-17'

function schedule(overrides: Partial<WeeklySchedule>): WeeklySchedule {
  const base: WeeklySchedule = {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  }
  return { ...base, ...overrides }
}

function workoutDay(id: string, programId: string): WorkoutDay {
  return { id, programId, userId: 'u1', name: id, position: 0, exercises: [] }
}

function program(id: string, sched: WeeklySchedule, workoutDays: WorkoutDay[]): Program {
  return {
    id,
    userId: 'u1',
    name: id,
    schedule: sched,
    workoutDays,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function meso(id: string, programId: string, startDate: string, endDate: string | null): Mesocycle {
  return { id, userId: 'u1', name: id, programId, status: 'active', startDate, endDate, createdAt: '2026-01-01T00:00:00Z' }
}

function session(date: string, status: Session['status']): Session {
  return {
    id: `s-${date}`,
    userId: 'u1',
    mesocycleId: 'm1',
    weekPlanId: null,
    workoutDayId: null,
    date,
    status,
    note: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    energyRating: null,
    pumpRating: null,
  }
}

// 5-day schedule matching the real account's shape: Mon/Tue/Thu/Fri/Sat
// trained, Wed/Sun rest — exactly the step 1 diagnostic's real findings.
const WD = { push1: 'wd-push1', pull1: 'wd-pull1', push2: 'wd-push2', pull2: 'wd-pull2', legs: 'wd-legs' }
const FIVE_DAY_SCHEDULE = schedule({
  monday: WD.push1,
  tuesday: WD.pull1,
  thursday: WD.push2,
  friday: WD.pull2,
  saturday: WD.legs,
})

describe('resolveWeek', () => {
  it('a fully resolved week: every expected date completed', () => {
    const workoutDays = Object.values(WD).map((id) => workoutDay(id, 'p1'))
    const p = program('p1', FIVE_DAY_SCHEDULE, workoutDays)
    const m = meso('m1', 'p1', '2026-07-05', null)
    const sessions = [
      session('2026-08-17', 'completed'),
      session('2026-08-18', 'completed'),
      session('2026-08-20', 'completed'),
      session('2026-08-21', 'completed'),
      session('2026-08-22', 'completed'),
    ]
    const result = resolveWeek(WEEK_START, [m], [p], sessions)
    expect(result.weekStart).toBe('2026-08-17')
    expect(result.weekEnd).toBe('2026-08-23')
    expect(result.expected).toHaveLength(5)
    expect(result.isComplete).toBe(true)
  })

  it('one unresolved expected date: not complete', () => {
    const workoutDays = Object.values(WD).map((id) => workoutDay(id, 'p1'))
    const p = program('p1', FIVE_DAY_SCHEDULE, workoutDays)
    const m = meso('m1', 'p1', '2026-07-05', null)
    // Thursday (2026-08-20) has no session row at all — exactly the real
    // "today, not yet trained" case from the step 1 diagnostic.
    const sessions = [
      session('2026-08-17', 'completed'),
      session('2026-08-18', 'completed'),
    ]
    const result = resolveWeek(WEEK_START, [m], [p], sessions)
    expect(result.expected).toHaveLength(5)
    expect(result.isComplete).toBe(false)
  })

  it('an in_progress session does not count as resolved (§7.2 — deliberate divergence from scheduler.ts)', () => {
    const workoutDays = Object.values(WD).map((id) => workoutDay(id, 'p1'))
    const p = program('p1', FIVE_DAY_SCHEDULE, workoutDays)
    const m = meso('m1', 'p1', '2026-07-05', null)
    const sessions = [
      session('2026-08-17', 'completed'),
      session('2026-08-18', 'completed'),
      session('2026-08-20', 'in_progress'), // partial session, not a resolution
      session('2026-08-21', 'completed'),
      session('2026-08-22', 'completed'),
    ]
    const result = resolveWeek(WEEK_START, [m], [p], sessions)
    expect(result.isComplete).toBe(false)
  })

  it('a week with zero expected sessions is not complete — vacuously resolved is not analyzable (§7.1)', () => {
    // No mesocycle at all covers this week.
    const workoutDays = Object.values(WD).map((id) => workoutDay(id, 'p1'))
    const p = program('p1', FIVE_DAY_SCHEDULE, workoutDays)
    const result = resolveWeek(WEEK_START, [], [p], [])
    expect(result.expected).toHaveLength(0)
    expect(result.isComplete).toBe(false)
  })

  it('every expected session skipped is resolved but not complete — nothing to analyze (§7.1)', () => {
    const workoutDays = Object.values(WD).map((id) => workoutDay(id, 'p1'))
    const p = program('p1', FIVE_DAY_SCHEDULE, workoutDays)
    const m = meso('m1', 'p1', '2026-07-05', null)
    const sessions = [
      session('2026-08-17', 'skipped'),
      session('2026-08-18', 'skipped'),
      session('2026-08-20', 'skipped'),
      session('2026-08-21', 'skipped'),
      session('2026-08-22', 'skipped'),
    ]
    const result = resolveWeek(WEEK_START, [m], [p], sessions)
    expect(result.expected).toHaveLength(5)
    expect(result.isComplete).toBe(false)
  })

  it('a week straddling a meso end and a new meso start uses each date\'s own covering meso/program', () => {
    // Meso A covers Mon–Wed only (ends 2026-08-19); meso B starts Thu and
    // covers the rest of the week, on a DIFFERENT program with a different
    // schedule — Thu/Fri/Sat trained under B, nothing expected under A
    // past its end date.
    const wdA = workoutDay('wd-a-mon', 'pA')
    const pA = program('pA', schedule({ monday: wdA.id, tuesday: wdA.id }), [wdA])
    const mA = meso('mA', 'pA', '2026-08-01', '2026-08-19')

    const wdB = workoutDay('wd-b-thu', 'pB')
    const pB = program('pB', schedule({ thursday: wdB.id, friday: wdB.id, saturday: wdB.id }), [wdB])
    const mB = meso('mB', 'pB', '2026-08-20', null)

    const sessions = [
      session('2026-08-17', 'completed'), // Monday, under meso A
      session('2026-08-18', 'completed'), // Tuesday, under meso A
      session('2026-08-20', 'completed'), // Thursday, under meso B
      session('2026-08-21', 'completed'), // Friday, under meso B
      session('2026-08-22', 'completed'), // Saturday, under meso B
    ]
    const result = resolveWeek(WEEK_START, [mA, mB], [pA, pB], sessions)

    // Monday+Tuesday expected under A's schedule; Thu/Fri/Sat expected
    // under B's — 2026-08-19 (Wed, inside A's range but A has no
    // Wednesday scheduled) and 2026-08-23 (Sun, outside both mesos) are
    // correctly absent.
    expect(result.expected.map((e) => e.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ])
    expect(result.expected.find((e) => e.date === '2026-08-17')?.mesocycleId).toBe('mA')
    expect(result.expected.find((e) => e.date === '2026-08-20')?.mesocycleId).toBe('mB')
    expect(result.isComplete).toBe(true)
  })

  it('a stale workout_day_id (deleted from the program) makes that date not expected, matching scheduler.ts\'s own guard', () => {
    // Schedule references wd-push1, but it's been deleted from the
    // program's workoutDays — the exact stale-reference shape
    // scheduler.ts:69 already defends against.
    const survivingDays = [WD.pull1, WD.push2, WD.pull2, WD.legs].map((id) => workoutDay(id, 'p1'))
    const p = program('p1', FIVE_DAY_SCHEDULE, survivingDays) // wd-push1 NOT included
    const m = meso('m1', 'p1', '2026-07-05', null)
    const sessions = [
      session('2026-08-18', 'completed'),
      session('2026-08-20', 'completed'),
      session('2026-08-21', 'completed'),
      session('2026-08-22', 'completed'),
    ]
    const result = resolveWeek(WEEK_START, [m], [p], sessions)
    // Monday (the stale reference) is silently absent, not "expected and
    // unresolved" — so the remaining 4 real, resolvable dates alone can
    // still make the week complete.
    expect(result.expected.map((e) => e.dow)).not.toContain('monday' satisfies DayOfWeek)
    expect(result.expected).toHaveLength(4)
    expect(result.isComplete).toBe(true)
  })
})
