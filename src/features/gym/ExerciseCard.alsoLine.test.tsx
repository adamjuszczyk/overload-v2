// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { format, parseISO } from 'date-fns'
import type { SetLog } from '../../types'
import type { ReferenceSession } from './sessionService'
import { exerciseOf, headLogOf, logOf, plannedDrop, plannedSet, referenceSessionOf, renderCard } from './cardHarness.testutil'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

// Chunk 78 (SPEC 1.2.1 [21], DECISIONS 218 (a), TASKS "Sweep of SPEC.md": "the most recent earlier session this week" is the reference's this-week sessions, newest first,
// the first with a log at the row's number, warmups out): a working row's LAST line adds the same set from earlier this week, "LAST 30 × 8 @ 1   MON 32.5 × 8 @ 1" (board W1).
// There is no new read: it is the sessions the card's own line ("· ALSO MON") and the last-time sheet read. Today is Thursday 2026-01-08 (weeks run Monday to Sunday), the
// way the LAST-line tests of ExerciseCard.rows.test.tsx have it; every date below is checked against its weekday (Checks that lied #21).
afterEach(cleanup)
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

const TODAY = '2026-01-08'
const DAY = { mon: '2026-01-05', tue: '2026-01-06', wed: '2026-01-07', lastWed: '2025-12-31' }

const sets = (sessionId: string, weights: number[], over: Partial<SetLog> = {}): SetLog[] =>
  weights.map((weight, i) => logOf({ id: `${sessionId}-${i + 1}`, sessionId, setNumber: i + 1, weight, reps: 10, rir: 1, ...over }))
const session = (sessionId: string, date: string, weights: number[], over: Partial<ReferenceSession> = {}) => referenceSessionOf(sessionId, date, sets(sessionId, weights), over)
const card = (referenceSessions: ReferenceSession[], props: Record<string, unknown> = {}) =>
  renderCard({ plannedSets: [1, 2, 3].map((n) => plannedSet(n)), props: { today: TODAY, referenceSessions, ...props } })

const rowEls = (container: Element) => Array.from(container.querySelectorAll('[data-row-key]'))
/** The earlier-this-week text of each row, in the order the rows are drawn (null: the row draws none). */
const alsoLines = (container: Element) => rowEls(container).map((row) => row.querySelector('[data-also-line]')?.textContent ?? null)
/** The whole text of each row's LAST line (the <p> that holds LAST and/or the earlier-this-week numbers), null for none. */
const lastParagraphs = (container: Element) =>
  rowEls(container).map((row) => Array.from(row.querySelectorAll('p')).map((p) => p.textContent ?? '').find((t) => t.startsWith('LAST') || t.includes('×')) ?? null)

describe('the same set earlier this week, after LAST (SPEC 1.2.1 [21]; DECISIONS 218 (a))', () => {
  it('the fixture dates are the weekdays they are named for', () => {
    expect(Object.values(DAY).map((d) => format(parseISO(d), 'EEE'))).toEqual(['Mon', 'Tue', 'Wed', 'Wed'])
    expect(format(parseISO(TODAY), 'EEE')).toBe('Thu')
  })

  it('a Monday session with sets 1 and 2: "MON …" on rows 01 and 02 after last week\'s LAST, none on row 03 (it has no third set); one line, LAST first', () => {
    const { container } = card([session('mon', DAY.mon, [70, 72.5]), session('lw', DAY.lastWed, [50, 52.5, 55])])
    expect(alsoLines(container)).toEqual(['MON 70 × 10 @ 1', 'MON 72.5 × 10 @ 1', null])
    // board W1: "LAST 30 × 8 @ 1   MON 32.5 × 8 @ 1": LAST (last week\'s) and then Monday\'s, in the same line
    expect(lastParagraphs(container)).toEqual(['LAST 50 × 10 @ 1 MON 70 × 10 @ 1', 'LAST 52.5 × 10 @ 1 MON 72.5 × 10 @ 1', 'LAST 55 × 10 @ 1'])
  })

  it('a row with no LAST but an earlier-this-week set draws that alone (last week\'s session has two sets, this week\'s Monday three)', () => {
    const { container } = card([session('mon', DAY.mon, [70, 72.5, 75]), session('lw', DAY.lastWed, [50, 52.5])])
    expect(lastParagraphs(container)).toEqual(['LAST 50 × 10 @ 1 MON 70 × 10 @ 1', 'LAST 52.5 × 10 @ 1 MON 72.5 × 10 @ 1', 'MON 75 × 10 @ 1'])
    expect(alsoLines(container)[2]).toBe('MON 75 × 10 @ 1')
  })

  it('two earlier sessions this week: the newer one\'s set at the row\'s number, and where the newer has none the older one\'s (never the oldest first, whatever order they come in)', () => {
    const monday = session('mon', DAY.mon, [70, 72.5, 75])
    const tuesday = session('tue', DAY.tue, [80, 82.5])
    const lastWeek = session('lw', DAY.lastWed, [50, 52.5, 55])
    for (const order of [[monday, tuesday, lastWeek], [lastWeek, tuesday, monday], [tuesday, lastWeek, monday]]) {
      const { container, unmount } = card(order)
      expect(alsoLines(container)).toEqual(['TUE 80 × 10 @ 1', 'TUE 82.5 × 10 @ 1', 'MON 75 × 10 @ 1'])
      unmount()
    }
  })

  it('the day is the weekday of the session\'s effective date, the one the card\'s own line names: a Monday session moved to Tuesday says TUE, as "· ALSO TUE" does', () => {
    const moved = session('mon', DAY.mon, [70, 72.5, 75], { movedToDate: DAY.tue })
    const { container } = card([moved, session('lw', DAY.lastWed, [50, 52.5, 55])])
    expect(alsoLines(container)).toEqual(['TUE 70 × 10 @ 1', 'TUE 72.5 × 10 @ 1', 'TUE 75 × 10 @ 1'])
    expect(container.querySelector('[data-last-line]')!.textContent).toBe('LAST = LAST WEEK, WED · ALSO TUE')
  })

  it('warmup logs are left out: the place counts working sets only, and a warmup\'s numbers are never the earlier-this-week set', () => {
    const logs = [
      ...sets('mon', [20], { isWarmup: true }), // the warmup, stored as setNumber 1
      logOf({ id: 'mon-2', sessionId: 'mon', setNumber: 2, weight: 70, reps: 10, rir: 1 }),
      logOf({ id: 'mon-3', sessionId: 'mon', setNumber: 3, weight: 72.5, reps: 10, rir: 1 }),
    ]
    const { container } = card([referenceSessionOf('mon', DAY.mon, logs), session('lw', DAY.lastWed, [50, 52.5, 55])])
    expect(alsoLines(container)).toEqual(['MON 70 × 10 @ 1', 'MON 72.5 × 10 @ 1', null])
    expect(container.textContent).not.toContain('MON 20')
  })

  it('last week\'s session alone gives no earlier-this-week line: LAST has it all', () => {
    const { container } = card([session('lw', DAY.lastWed, [50, 52.5, 55])])
    expect(alsoLines(container)).toEqual([null, null, null])
    expect(lastParagraphs(container)).toEqual(['LAST 50 × 10 @ 1', 'LAST 52.5 × 10 @ 1', 'LAST 55 × 10 @ 1'])
    expect(container.querySelector('[data-last-line]')!.textContent).toBe('LAST = LAST WEEK, WED') // and the card\'s line has no ALSO
  })

  it('a sequence run has none (EARLIER THIS WEEK is hidden: the reference has no this-week sessions for it)', () => {
    const { container } = card([session('mon', DAY.mon, [70, 72.5, 75]), session('lw', DAY.lastWed, [50, 52.5, 55])], { referenceScheduleType: 'sequence' })
    expect(alsoLines(container)).toEqual([null, null, null])
  })

  it('a deload session this week never counts, as it never counts for LAST', () => {
    const deload = session('dl', DAY.mon, [40, 40, 40], { isDeload: true })
    const lastWeek = session('lw', DAY.lastWed, [50, 52.5, 55])
    expect(alsoLines(card([deload, lastWeek]).container)).toEqual([null, null, null])
    cleanup()
    expect(alsoLines(card([deload, session('tue', DAY.tue, [80, 82.5, 85]), lastWeek]).container)).toEqual(['TUE 80 × 10 @ 1', 'TUE 82.5 × 10 @ 1', 'TUE 85 × 10 @ 1'])
  })

  it('a skipped set in the newer session is its log at that number: the row then has nothing to add, rather than an older session\'s numbers (as a skipped set last week gives LAST nothing)', () => {
    const tuesday = referenceSessionOf('tue', DAY.tue, [
      logOf({ id: 'tue-1', sessionId: 'tue', setNumber: 1, weight: 80, reps: 10, rir: 1 }),
      logOf({ id: 'tue-2', sessionId: 'tue', setNumber: 2, weight: null, reps: null, rir: null, isSkipped: true }),
    ])
    const { container } = card([tuesday, session('mon', DAY.mon, [70, 72.5, 75]), session('lw', DAY.lastWed, [50, 52.5, 55])])
    // 01: Tuesday\'s; 02: Tuesday skipped it, so no line (and no bare "TUE"); 03: Tuesday has no third set, so Monday\'s
    expect(alsoLines(container)).toEqual(['TUE 80 × 10 @ 1', null, 'MON 75 × 10 @ 1'])
  })

  it('the numbers are in the exercise\'s unit, as LAST\'s are: 9 kg on a pound exercise reads 19.8 (and the shown figure is not converted twice)', () => {
    const lbs = exerciseOf({ weightUnit: 'lbs' })
    const { container } = renderCard({
      plannedSets: [plannedSet(1)],
      props: { programExercise: lbs, today: TODAY, referenceSessions: [session('mon', DAY.mon, [9]), session('lw', DAY.lastWed, [10])] },
    })
    expect(alsoLines(container)).toEqual(['MON 19.8 × 10 @ 1'])
    expect(lastParagraphs(container)).toEqual(['LAST 22 × 10 @ 1 MON 19.8 × 10 @ 1'])
  })

  it('the RIR is "@ n" when the set had one and is left out when it had none', () => {
    const noRir = referenceSessionOf('mon', DAY.mon, [logOf({ id: 'mon-1', sessionId: 'mon', setNumber: 1, weight: 70, reps: 8, rir: null })])
    const { container } = card([noRir, session('lw', DAY.lastWed, [50, 52.5, 55])])
    expect(alsoLines(container)[0]).toBe('MON 70 × 8')
  })

  it('while the reference loads, or when it could not be read, there is no earlier-this-week line (the row says it is loading, or fails, as before)', () => {
    const sessions = [session('mon', DAY.mon, [70, 72.5, 75]), session('lw', DAY.lastWed, [50, 52.5, 55])]
    expect(alsoLines(card(sessions, { referenceLoading: true }).container)).toEqual([null, null, null])
    cleanup()
    const failed = card(sessions, { referenceIsError: true })
    expect(alsoLines(failed.container)).toEqual([null, null, null])
    expect(failed.container.textContent).toContain("COULDN'T LOAD LAST WEEK")
  })

  it('only a working set that is open has one: a logged row, a drop and a warmup draw none, whatever Monday did at their number', () => {
    const planned = [plannedSet(1, { isWarmup: true }), plannedSet(2, { stageKind: 'dropset' }), plannedDrop(2, 1), plannedSet(3)]
    const { container } = renderCard({
      plannedSets: planned,
      logs: [headLogOf(2, { stageKind: 'dropset' })], // the dropset head (the first working set) is logged: its drop is the current row, the warmup is still open
      props: { today: TODAY, referenceSessions: [session('mon', DAY.mon, [70, 72.5, 75]), session('lw', DAY.lastWed, [50, 52.5, 55])] },
    })
    expect(rowEls(container).map((row) => row.getAttribute('data-row-key'))).toEqual(['set:set-1', 'set:set-2', 'set:set-2:stage:1', 'set:set-3'])
    // warmup (open), logged head, open drop: none. The open working set 02 (set-3) has Monday\'s second set
    expect(alsoLines(container)).toEqual([null, null, null, 'MON 72.5 × 10 @ 1'])
  })
})
