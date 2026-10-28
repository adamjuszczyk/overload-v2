import { describe, it, expect } from 'vitest'
import { parseISO, format } from 'date-fns'
import { lastTimeSession, lastTimeSetAt } from './lastTimeSet'
import type { ReferenceSession } from './sessionService'
import type { SetLog } from '../../types'

// Chunk 58a, fix-forward (review 1, finding 2): the LAST line reads the session the reference panel calls its primary one, resolved by
// the same functions it calls. Weeks are Monday-anchored; the dates below are checked against their weekdays (RULES, Checks that
// lied #21) and the weekday run's "today" is a Wednesday.
const TODAY = '2026-01-14'
const DAYS = {
  today: TODAY, // Wednesday
  thisWeekMon: '2026-01-12', // earlier this week
  lastWeekWed: '2026-01-07', // the preceding calendar week (Mon 05 – Sun 11)
  twoWeeksWed: '2025-12-31',
  threeWeeksWed: '2025-12-24',
}
const weekdayOf = (iso: string) => format(parseISO(iso), 'EEE')
it('the fixture dates are the weekdays they are named for', () => {
  expect(Object.values(DAYS).map(weekdayOf)).toEqual(['Wed', 'Mon', 'Wed', 'Wed', 'Wed'])
})

const log = (id: string, setNumber: number, weight: number, over: Partial<SetLog> = {}): SetLog => ({
  id, userId: 'u1', sessionId: 'x', exerciseId: 'ex-1', weekPlanSetId: null, setNumber, weight, reps: 10, rir: 1, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-01T10:00:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})
const skipped = (id: string, setNumber: number): SetLog => log(id, setNumber, 0, { isSkipped: true, weight: null, reps: null, rir: null })
const session = (sessionId: string, date: string, weights: number[], over: Partial<ReferenceSession> = {}): ReferenceSession => ({
  sessionId, date, completedAt: `${date}T11:00:00Z`, mesocycleId: 'm1', isDeload: false,
  logs: weights.map((w, i) => ({ head: log(`${sessionId}-${i + 1}`, i + 1, w), stages: [] })),
  ...over,
})
const allSkipped = (sessionId: string, date: string, count: number): ReferenceSession => ({
  ...session(sessionId, date, []),
  logs: Array.from({ length: count }, (_, i) => ({ head: skipped(`${sessionId}-${i + 1}`, i + 1), stages: [] })),
})
const weightAt = (s: ReferenceSession | null, number: number) => lastTimeSetAt(s, number)?.weight ?? null

describe('lastTimeSession: the session the reference panel calls its primary one', () => {
  it('is none with nothing on record (FIRST TIME)', () => {
    expect(lastTimeSession(TODAY, 'weekday', [])).toBeNull()
  })

  it('is last week\'s session (LAST WEEK)', () => {
    const lastWeek = session('lw', DAYS.lastWeekWed, [50, 52.5])
    expect(lastTimeSession(TODAY, 'weekday', [session('older', DAYS.twoWeeksWed, [40]), lastWeek])?.sessionId).toBe('lw')
  })

  it('never a deload session: with one last week the line reads the session before it (the latest completed session is the deload)', () => {
    const sessions = [session('deload', DAYS.lastWeekWed, [30, 30], { isDeload: true }), session('before', DAYS.twoWeeksWed, [60, 62.5])]
    const picked = lastTimeSession(TODAY, 'weekday', sessions)
    expect(picked?.sessionId).toBe('before')
    expect(weightAt(picked, 1)).toBe(60)
  })

  it('the exercise done earlier this week does not replace last week\'s: that is the panel\'s EARLIER THIS WEEK, apart', () => {
    const sessions = [session('early', DAYS.thisWeekMon, [70, 72.5]), session('lw', DAYS.lastWeekWed, [50, 52.5])]
    expect(lastTimeSession(TODAY, 'weekday', sessions)?.sessionId).toBe('lw')
  })

  it('with nothing last week, the most recent past session is LAST TIME, this week\'s included (as the panel resolves it)', () => {
    const sessions = [session('early', DAYS.thisWeekMon, [70]), session('older', DAYS.twoWeeksWed, [40])]
    expect(lastTimeSession(TODAY, 'weekday', sessions)?.sessionId).toBe('early')
  })

  it('after a last session in which every set was skipped, it reaches back to the session the panel calls LAST ACTUALLY TRAINED', () => {
    const sessions = [allSkipped('lw', DAYS.lastWeekWed, 3), session('before', DAYS.twoWeeksWed, [60, 62.5, 65]), session('oldest', DAYS.threeWeeksWed, [1])]
    const picked = lastTimeSession(TODAY, 'weekday', sessions)
    expect(picked?.sessionId).toBe('before')
    expect(weightAt(picked, 3)).toBe(65)
  })

  it('is none when every session on record was skipped (the panel says SKIPPED EVERY TIME ON RECORD)', () => {
    expect(lastTimeSession(TODAY, 'weekday', [allSkipped('lw', DAYS.lastWeekWed, 3), allSkipped('tw', DAYS.twoWeeksWed, 3)])).toBeNull()
  })

  it('on a sequence run it is the most recent past non-deload session, whatever its week (the panel has no LAST WEEK there)', () => {
    const sessions = [session('early', DAYS.thisWeekMon, [70]), session('lw', DAYS.lastWeekWed, [50]), session('deload', '2026-01-13', [20], { isDeload: true })]
    expect(lastTimeSession(TODAY, 'sequence', sessions)?.sessionId).toBe('early')
    expect(lastTimeSession(TODAY, 'weekday', sessions)?.sessionId).toBe('lw') // the weekday run's answer differs: the schedule type is read
  })
})

describe('lastTimeSetAt: the working set at the row\'s place', () => {
  const withWarmups: ReferenceSession = {
    ...session('lw', DAYS.lastWeekWed, []),
    logs: [
      { head: log('w1', 1, 20, { isWarmup: true }), stages: [] },
      { head: log('w2', 2, 40, { isWarmup: true }), stages: [] },
      { head: log('a', 3, 60), stages: [log('a-drop', 3, 45, { parentSetId: 'a', stageIndex: 1, isDropset: true })] },
      { head: log('b', 4, 62.5), stages: [] },
      { head: log('c', 5, 65), stages: [] },
    ],
  }

  it('row 01 is the first working set, row 02 the second, row 03 the third: never always the first, never a warmup', () => {
    expect([1, 2, 3].map((n) => weightAt(withWarmups, n))).toEqual([60, 62.5, 65])
  })

  it('a drop is its head\'s, it does not take a place of its own', () => {
    expect(lastTimeSetAt(withWarmups, 1)?.id).toBe('a')
    expect(lastTimeSetAt(withWarmups, 2)?.id).toBe('b')
  })

  it('has none past the last set, for no session, and for a row numbered 0', () => {
    expect(lastTimeSetAt(withWarmups, 4)).toBeNull()
    expect(lastTimeSetAt(null, 1)).toBeNull()
    expect(lastTimeSetAt(withWarmups, 0)).toBeNull()
  })
})
