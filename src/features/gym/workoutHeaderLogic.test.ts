// Chunk 58b — the header's two lines (boards W4, W6): the eyebrow's variants and "N OF M SETS".
import { describe, it, expect, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { format, parseISO } from 'date-fns'
import { headerEyebrow, setsLabel, setsProgress } from './workoutHeaderLogic'
import { countCompletedSets } from './countCompletedSets'
import { effectiveDate } from './effectiveDate'
import { resolveRows, sessionOrder } from './workoutRules'
import { headLogOf, logOf, plannedDrop, plannedSet } from './cardHarness.testutil'

// Fixture dates come from weekdays, and the queue is printed (RULES, Checks that lied #21): a Monday, a Tuesday and a Sunday of January 2026.
const MONDAY = '2026-01-05'
const TUESDAY = '2026-01-06'
const SUNDAY = '2026-01-11'

describe('the fixture dates are the weekdays they are named for', () => {
  it.each([
    [MONDAY, 'Monday'],
    [TUESDAY, 'Tuesday'],
    [SUNDAY, 'Sunday'],
  ])('%s is a %s', (date, weekday) => {
    expect(format(parseISO(date), 'EEEE')).toBe(weekday)
  })
})

describe('headerEyebrow (board W4)', () => {
  const weekday = { scheduleType: 'weekday' as const, weekNumber: 2, isDeload: false, slot: null }

  it('a weekday run names the week and the weekday the session is on', () => {
    expect(headerEyebrow({ ...weekday, date: TUESDAY })).toBe('WEEK 2 · TUESDAY')
    expect(headerEyebrow({ ...weekday, date: SUNDAY })).toBe('WEEK 2 · SUNDAY')
  })

  it('a deload session says DELOAD first, and never "DELOAD WEEK"', () => {
    expect(headerEyebrow({ ...weekday, isDeload: true, date: TUESDAY })).toBe('DELOAD · WEEK 2 · TUESDAY')
  })

  it('a sequence run names the cycle and the slot (and says DELOAD first on a deload session); the weekday is not in it', () => {
    const sequence = { scheduleType: 'sequence' as const, weekNumber: 3, isDeload: false, date: TUESDAY, slot: 2 }
    expect(headerEyebrow(sequence)).toBe('CYCLE 3 · SLOT 2')
    expect(headerEyebrow({ ...sequence, isDeload: true })).toBe('DELOAD · CYCLE 3 · SLOT 2')
  })

  it('a part that is not known yet is left out, not guessed: no date while the session loads, no slot without its plan row', () => {
    expect(headerEyebrow({ ...weekday, date: null })).toBe('WEEK 2')
    expect(headerEyebrow({ scheduleType: 'sequence', weekNumber: 3, isDeload: false, date: TUESDAY, slot: null })).toBe('CYCLE 3')
  })

  it('a session moved to another day reads that day (the effective date, as Plan and "last time" read it)', () => {
    const moved = { date: MONDAY, movedToDate: SUNDAY }
    expect(headerEyebrow({ ...weekday, date: effectiveDate(moved) })).toBe('WEEK 2 · SUNDAY')
    expect(headerEyebrow({ ...weekday, date: effectiveDate({ date: MONDAY, movedToDate: null }) })).toBe('WEEK 2 · MONDAY')
  })
})

describe('setsProgress (TASKS 58b: heads and stages planned vs logged, warmups out)', () => {
  // A warmup (logged), set 1 (logged), set 2 (skipped), set 3 a dropset (head and one drop, not logged), and a set added today (not logged).
  const planned = [
    plannedSet(1, { id: 'w', isWarmup: true }),
    plannedSet(1, { id: 'set-1' }),
    plannedSet(2, { id: 'set-2' }),
    plannedSet(3, { id: 'set-3', stageKind: 'dropset' }),
    plannedDrop(3, 1),
  ]
  const logs = [
    logOf({ id: 'lw', weekPlanSetId: 'w', isWarmup: true, setNumber: 1 }),
    headLogOf(1, { weekPlanSetId: 'set-1' }),
    logOf({ id: 'sk', weekPlanSetId: 'set-2', setNumber: 2, isSkipped: true, weight: null, reps: null }),
  ]
  const rowsOf = (plannedSets: typeof planned, sessionLogs: typeof logs, added = 0) => {
    const entries = Array.from({ length: added }, (_, i) => ({ localId: `a${i}`, logId: null, type: { kind: 'normal' as const }, place: i + 1 }))
    return resolveRows(sessionOrder([{ key: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', plannedSets, added: entries }], []), sessionLogs)
  }

  it('counts the working heads and drops: a skipped set is in the total and not done, a warmup is in neither', () => {
    const progress = setsProgress(rowsOf(planned, logs))
    expect(progress).toEqual({ done: 1, total: 4 })
    expect(setsLabel(progress)).toBe('1 OF 4 SETS')
  })

  it('a set added in the session joins the total; logging a drop or a head raises the done count by one each', () => {
    expect(setsProgress(rowsOf(planned, logs, 1))).toEqual({ done: 1, total: 5 })
    const withHead = [...logs, headLogOf(3, { weekPlanSetId: 'set-3', stageKind: 'dropset' })]
    expect(setsProgress(rowsOf(planned, withHead))).toEqual({ done: 2, total: 4 })
    const withDrop = [...withHead, logOf({ id: 'd1', setNumber: 3, parentSetId: 'log-3', stageIndex: 1, isDropset: true })]
    expect(setsProgress(rowsOf(planned, withDrop))).toEqual({ done: 3, total: 4 })
  })

  it('agrees with countCompletedSets over the same logs (its warmup rule is the header\'s)', () => {
    const withHead = [...logs, headLogOf(3, { weekPlanSetId: 'set-3', stageKind: 'dropset' })]
    for (const sessionLogs of [logs, withHead]) {
      expect(setsProgress(rowsOf(planned, sessionLogs)).done).toBe(countCompletedSets(sessionLogs).total)
    }
  })

  it('a session with nothing planned reads 0 OF 0', () => {
    expect(setsProgress([])).toEqual({ done: 0, total: 0 })
  })
})
