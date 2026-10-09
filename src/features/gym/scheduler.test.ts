import { describe, it, expect } from 'vitest'
import { schedule } from './scheduler'
import type { Program, Mesocycle, WorkoutDay, WeekPlan, Session, WeeklySchedule } from '../../types'

// Week of 2026-08-24 (Monday) .. 2026-08-30 (Sunday) — hand-verified via
// `date -d 2026-08-24 +%A` etc. (same convention as MissedSessionPrompt.
// test.tsx's own header). Meso starts on this Monday, so week 1 is exactly
// this calendar week — weekNumber math never enters into it.
const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const FRI = '2026-08-28'
const SAT = '2026-08-29'
const SUN = '2026-08-30'

const EMPTY_SCHEDULE: WeeklySchedule = {
  monday: null, tuesday: null, wednesday: null, thursday: null,
  friday: null, saturday: null, sunday: null,
}

const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const wdPull: WorkoutDay = { id: 'wd-pull', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }

function makeProgram(schedule: Partial<WeeklySchedule>): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { ...EMPTY_SCHEDULE, ...schedule },
    workoutDays: [wdPush, wdPull], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run',
  }
}

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: MON, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

function makeSession(overrides: Partial<Session> & Pick<Session, 'date' | 'workoutDayId' | 'status'>): Session {
  return {
    id: `session-${overrides.date}-${overrides.workoutDayId}`,
    userId: 'user-1',
    mesocycleId: 'meso-1',
    weekPlanId: null,
    note: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    energyRating: null,
    pumpRating: null,
    ...overrides,
  }
}

const BASE = {
  programs: [] as Program[],
  workoutDays: [wdPush, wdPull],
  currentWeekPlans: [] as WeekPlan[],
  allWeekPlans: [] as WeekPlan[],
}

describe('schedule — regression: a plain single scheduled session, no moves (parity with pre-chunk-24)', () => {
  it('no session yet today -> suggest_no_plan, unchanged shape', () => {
    const program = makeProgram({ monday: 'wd-push' })
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [] })
    expect(result).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: MON })
  })

  it('a completed session today -> completed_today, unchanged shape', () => {
    const program = makeProgram({ monday: 'wd-push' })
    const s = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'completed' })
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [s] })
    expect(result).toEqual({ type: 'completed_today', session: s })
  })

  it('an in-progress session anywhere -> active_session, unchanged shape (one session in progress at a time)', () => {
    const program = makeProgram({ monday: 'wd-push' })
    const s = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'in_progress' })
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [s] })
    expect(result).toEqual({ type: 'active_session', session: s })
  })

  it('a skipped session today does not block re-suggestion (unchanged — the scheduler has never examined skipped rows)', () => {
    const program = makeProgram({ monday: 'wd-push' })
    const skipped = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'skipped' })
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [skipped] })
    expect(result).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: MON })
  })
})

describe('schedule — due today: moved-away exclusion, moved-here inclusion (reviewer\'s note 2)', () => {
  it('today\'s own session moved away (to Friday) is excluded from today\'s view -> empty state, not the old suggestion', () => {
    const program = makeProgram({ monday: 'wd-push', friday: 'wd-pull' })
    const moved = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'planned', movedToDate: FRI })
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [moved] })
    expect(result.type).toBe('rest_day')
  })

  it('a session moved here from Monday is included on Friday as a single `planned` entry', () => {
    const movedPush = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'planned', movedToDate: FRI })
    // Friday's own normal workout (wd-pull) hasn't started yet either, so
    // this is a two-entry day — covered by its own test below. Here we
    // isolate the moved-in entry alone by giving Friday no program slot.
    const programNoFridayOwn = makeProgram({ monday: 'wd-push' })
    const result = schedule(FRI, {
      ...BASE, activeMeso, programs: [programNoFridayOwn], sessions: [movedPush],
    })
    expect(result).toEqual({
      type: 'planned', session: movedPush, weekPlan: null, workoutDay: wdPush,
    })
  })

  it('moving onto a day that already has one leaves both, listed (G14 / due_today)', () => {
    const program = makeProgram({ monday: 'wd-push', friday: 'wd-pull' })
    const movedPush = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'planned', movedToDate: FRI })
    const result = schedule(FRI, { ...BASE, activeMeso, programs: [program], sessions: [movedPush] })
    expect(result.type).toBe('due_today')
    if (result.type !== 'due_today') throw new Error('unreachable')
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions).toContainEqual({ type: 'planned', session: movedPush, weekPlan: null, workoutDay: wdPush })
    expect(result.sessions).toContainEqual({ type: 'suggest_no_plan', workoutDay: wdPull, date: FRI })
  })

  it('swapping two days is two independent moves — each day shows only its own incoming session', () => {
    const program = makeProgram({ monday: 'wd-push', friday: 'wd-pull' })
    // Monday's session (push) moved to Friday; Friday's session (pull) moved to Monday.
    const pushMovedToFri = makeSession({ id: 's-push', date: MON, workoutDayId: 'wd-push', status: 'planned', movedToDate: FRI })
    const pullMovedToMon = makeSession({ id: 's-pull', date: FRI, workoutDayId: 'wd-pull', status: 'planned', movedToDate: MON })

    const mondayResult = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [pushMovedToFri, pullMovedToMon] })
    expect(mondayResult).toEqual({ type: 'planned', session: pullMovedToMon, weekPlan: null, workoutDay: wdPull })

    const fridayResult = schedule(FRI, { ...BASE, activeMeso, programs: [program], sessions: [pushMovedToFri, pullMovedToMon] })
    expect(fridayResult).toEqual({ type: 'planned', session: pushMovedToFri, weekPlan: null, workoutDay: wdPush })
  })

  it('a completed session moved here (e.g. a trained "do it now") shows as completed_today, not planned', () => {
    const program = makeProgram({})
    const moved = makeSession({
      date: SAT, workoutDayId: 'wd-push', status: 'completed', movedToDate: SUN,
      startedAt: `${SUN}T09:00:00Z`, completedAt: `${SUN}T10:00:00Z`,
    })
    const result = schedule(SUN, { ...BASE, activeMeso, programs: [program], sessions: [moved] })
    expect(result).toEqual({ type: 'completed_today', session: moved })
  })
})

describe('schedule — empty state: next scheduled session and when it\'s due', () => {
  it('a true rest day (program schedules nothing today) names the next scheduled day', () => {
    const program = makeProgram({ wednesday: 'wd-push' })
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [] })
    expect(result).toEqual({ type: 'rest_day', next: { date: WED, workoutDay: wdPush } })
  })

  it('wraps to next week when nothing remains scheduled later this week', () => {
    const program = makeProgram({ monday: 'wd-push' })
    // Monday itself is unhandled, so it would otherwise surface as a missed
    // day first (its own, separately-tested rule below) — dismissMissed
    // isolates the "next scheduled" computation on its own, same escape
    // hatch TodayPage.tsx already uses after the user closes that prompt.
    const result = schedule(TUE, {
      ...BASE, activeMeso, programs: [program], sessions: [], dismissMissed: true,
    })
    expect(result).toEqual({ type: 'rest_day', next: { date: '2026-08-31', workoutDay: wdPush } })
  })

  it('no day scheduled at all -> next is null', () => {
    const program = makeProgram({})
    const result = schedule(MON, { ...BASE, activeMeso, programs: [program], sessions: [] })
    expect(result).toEqual({ type: 'rest_day', next: null })
  })
})

describe('schedule — missed sessions: current week only (SPEC — the cross-week look-back goes)', () => {
  it('a missed day earlier in the CURRENT week is prompted', () => {
    const program = makeProgram({ monday: 'wd-push' })
    // Querying Wednesday: Monday (this week) was scheduled and never handled.
    const result = schedule(WED, { ...BASE, activeMeso, programs: [program], sessions: [] })
    expect(result).toEqual({
      type: 'missed_sessions',
      queue: [{ date: MON, weekPlan: null, workoutDay: wdPush, existingSessionId: null }],
    })
  })

  it('a missed day from LAST week is not prompted', () => {
    // Sunday of last week (2026-08-23) would have been missed under the old
    // 7-day cross-week look-back; the meso starts Monday 2026-08-24, so last
    // week isn't even reachable here — use a meso that started earlier to
    // isolate the rule.
    const earlyMeso: Mesocycle = { ...activeMeso, startDate: '2026-08-17' }
    const program = makeProgram({ sunday: 'wd-push' })
    const result = schedule(MON, { ...BASE, activeMeso: earlyMeso, programs: [program], sessions: [] })
    // Last Sunday (2026-08-23) is missed under the old rule but must NOT
    // appear now; this week has no missed days yet (today is Monday, the
    // first day of the week), so the result falls through to today's own
    // suggestion instead of a missed-sessions prompt.
    expect(result.type).not.toBe('missed_sessions')
  })

  it('a day moved away earlier this week does not count as missed (the user already rescheduled it)', () => {
    const program = makeProgram({ monday: 'wd-push', friday: 'wd-pull' })
    const moved = makeSession({ date: MON, workoutDayId: 'wd-push', status: 'planned', movedToDate: FRI })
    const result = schedule(WED, { ...BASE, activeMeso, programs: [program], sessions: [moved] })
    expect(result.type).not.toBe('missed_sessions')
  })

  it('dismissMissed skips straight to today\'s own suggestion', () => {
    const program = makeProgram({ monday: 'wd-push' })
    const result = schedule(WED, { ...BASE, activeMeso, programs: [program], sessions: [], dismissMissed: true })
    expect(result.type).not.toBe('missed_sessions')
  })
})
