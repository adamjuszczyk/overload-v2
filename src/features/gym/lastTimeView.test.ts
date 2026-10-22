// Chunk 58b — the "last time" line and sheet's wording from the reference's own resolution (boards W6, W16, W17): every state W17 draws.
import { describe, it, expect } from 'vitest'
import { format, parseISO } from 'date-fns'
import { lastTimeView, type LastTimePanel } from './lastTimeView'
import { lastTimeSession, lastTimeSetAt } from './lastTimeSet'
import { logOf, referenceSessionOf } from './cardHarness.testutil'
import type { ReferenceSession } from './sessionService'

// Today is Thursday 2026-01-08. Last week is Mon 2025-12-29 to Sun 2026-01-04; this week began Mon 2026-01-05. The queue is printed below.
const TODAY = '2026-01-08'
const LAST_WEEK_TUE = '2025-12-30'
const EARLIER_MON = '2026-01-05'
const THREE_WEEKS_THU = '2025-12-18'
const MONTH_AGO_MON = '2025-12-01'

describe('the fixture dates are the weekdays they are named for', () => {
  it.each([
    [TODAY, 'Thu'],
    [LAST_WEEK_TUE, 'Tue'],
    [EARLIER_MON, 'Mon'],
    [THREE_WEEKS_THU, 'Thu'],
    [MONTH_AGO_MON, 'Mon'],
  ])('%s is a %s', (date, weekday) => {
    expect(format(parseISO(date), 'EEE')).toBe(weekday)
  })
})

const head = (sessionId: string, n: number, weight: number, reps: number, rir: number | null, over = {}) =>
  logOf({ id: `${sessionId}-${n}`, sessionId, setNumber: n, weight, reps, rir, ...over })
const drop = (sessionId: string, n: number, weight: number, reps: number) =>
  logOf({ id: `${sessionId}-${n}-d1`, sessionId, setNumber: n, parentSetId: `${sessionId}-${n}`, stageIndex: 1, isDropset: true, weight, reps, rir: null })
const skipped = (sessionId: string, n: number) => head(sessionId, n, 0, 0, null, { isSkipped: true, weight: null, reps: null })

const lastWeek = referenceSessionOf('lw', LAST_WEEK_TUE, [head('lw', 1, 52.5, 10, 2), head('lw', 2, 52.5, 9, 1), head('lw', 3, 50, 10, 1), drop('lw', 3, 37.5, 9)])
const earlier = referenceSessionOf('ew', EARLIER_MON, [head('ew', 1, 55, 8, 1), head('ew', 2, 55, 7, 0)])
const monthAgo = referenceSessionOf('ma', MONTH_AGO_MON, [head('ma', 1, 25, 12, 2), head('ma', 2, 25, 11, 2)])
const threeWeeks = referenceSessionOf('tw', THREE_WEEKS_THU, [head('tw', 1, 15, 12, 2), head('tw', 2, 15, 11, 1), head('tw', 3, 12.5, 12, 1)])

const view = (sessions: ReferenceSession[], over: Partial<Parameters<typeof lastTimeView>[0]> = {}) =>
  lastTimeView({ today: TODAY, scheduleType: 'weekday', sessions, isLoading: false, isError: false, isFromCache: false, unit: 'kg', ...over })
const panelsOf = (v: ReturnType<typeof view>): LastTimePanel[] => (v.body.kind === 'panels' ? v.body.panels : [])
const rowTexts = (panel: LastTimePanel) => panel.rows.map((r) => [r.n, r.text, r.rir, r.badge].join('|'))

describe('LAST WEEK, with a dropset, and EARLIER THIS WEEK (W16, W17)', () => {
  const v = view([lastWeek, earlier])

  it('the line names last week\'s weekday and, beside it, the weekday it was also done this week', () => {
    expect(v.line).toBe('LAST = LAST WEEK, TUE · ALSO MON')
  })

  it('LAST WEEK holds last week\'s session and EARLIER THIS WEEK this week\'s, told apart by their dates (not by the order they come in)', () => {
    for (const sessions of [[lastWeek, earlier], [earlier, lastWeek]]) {
      const [first, second] = panelsOf(view(sessions))
      expect([first.title, first.when]).toEqual(['LAST WEEK', 'TUE 30 DEC'])
      expect(rowTexts(first)).toEqual(['01|52.5 × 10|@ 2|', '02|52.5 × 9|@ 1|', '03|50 × 10|@ 1|', '↳|37.5 × 9||DROP'])
      expect([second.title, second.when]).toEqual(['EARLIER THIS WEEK', 'MON 5 JAN'])
      expect(rowTexts(second)).toEqual(['01|55 × 8|@ 1|', '02|55 × 7|@ 0|'])
    }
  })

  it('a drop is marked as one and sits indented under its head', () => {
    const rows = panelsOf(v)[0].rows
    expect(rows[3]).toMatchObject({ n: '↳', stage: true, badge: 'DROP' })
    expect(rows.slice(0, 3).every((r) => !r.stage)).toBe(true)
  })

  it('weights are shown in the exercise\'s unit (stored kg)', () => {
    const lbs = panelsOf(view([lastWeek], { unit: 'lbs' }))[0].rows[0].text
    expect(lbs).toBe('115.7 × 10')
  })
})

describe('LAST TIME and the weekday-or-sequence rule', () => {
  it('an exercise not done last week reads LAST TIME with its elapsed time, in the line and the panel', () => {
    const v = view([monthAgo])
    expect(v.line).toBe('LAST = ABOUT 1 MONTH AGO')
    expect(panelsOf(v).map((p) => [p.title, p.when])).toEqual([['LAST TIME', 'ABOUT 1 MONTH AGO']])
  })

  it('21 days ago reads in days', () => {
    expect(view([threeWeeks]).line).toBe('LAST = 21 DAYS AGO')
  })

  it('a sequence run always reads LAST TIME of the most recent session and never EARLIER THIS WEEK', () => {
    const v = view([lastWeek, earlier], { scheduleType: 'sequence' })
    expect(v.line).toBe('LAST = 3 DAYS AGO')
    expect(panelsOf(v).map((p) => p.title)).toEqual(['LAST TIME'])
    expect(rowTexts(panelsOf(v)[0])).toEqual(['01|55 × 8|@ 1|', '02|55 × 7|@ 0|'])
  })

  it('deload sessions never count: last week\'s deload session is left out and the last normal one is LAST TIME', () => {
    const deloadLastWeek: ReferenceSession = { ...lastWeek, isDeload: true }
    const v = view([deloadLastWeek, threeWeeks])
    expect(v.line).toBe('LAST = 21 DAYS AGO')
    expect(panelsOf(v)[0].title).toBe('LAST TIME')
    expect(rowTexts(panelsOf(v)[0])[0]).toBe('01|15 × 12|@ 2|')
  })

  it('a session moved to another day is read at the day it was moved to', () => {
    const moved: ReferenceSession = { ...monthAgo, date: '2025-12-01', movedToDate: LAST_WEEK_TUE }
    expect(view([moved]).line).toBe('LAST = LAST WEEK, TUE')
  })

  it('FIRST TIME only when the exercise has truly never been done', () => {
    const v = view([])
    expect(v.line).toBe('FIRST TIME')
    expect(v.body).toEqual({ kind: 'first_time' })
  })
})

describe('all skipped: the reach-back, and nothing to compare against', () => {
  const allSkipped = referenceSessionOf('sk', LAST_WEEK_TUE, [skipped('sk', 1), skipped('sk', 2), skipped('sk', 3)])

  it('last week all skipped: its panel reads SKIPPED, and LAST TRAINED reaches back to the session really done (the line and the rows\' LAST line read it)', () => {
    const v = view([allSkipped, threeWeeks])
    const [first, second] = panelsOf(v)
    expect(rowTexts(first)).toEqual(['01|—||SKIPPED', '02|—||SKIPPED', '03|—||SKIPPED'])
    expect([second.title, second.when]).toEqual(['LAST TRAINED', '21 DAYS AGO'])
    expect(rowTexts(second)).toEqual(['01|15 × 12|@ 2|', '02|15 × 11|@ 1|', '03|12.5 × 12|@ 1|'])
    expect(v.line).toBe('LAST = 21 DAYS AGO')
    // the card's row-by-row line reads the same session as the sheet's second panel
    expect(lastTimeSession(TODAY, 'weekday', [allSkipped, threeWeeks])?.sessionId).toBe('tw')
    expect(lastTimeSetAt(lastTimeSession(TODAY, 'weekday', [allSkipped, threeWeeks]), 3)?.weight).toBe(12.5)
  })

  it('skipped every time on record: the note says so, and there is no LAST TRAINED panel', () => {
    const v = view([allSkipped])
    expect(v.body).toMatchObject({ kind: 'panels', note: 'Skipped every time on record.' })
    expect(panelsOf(v).map((p) => p.title)).toEqual(['LAST WEEK'])
    expect(v.line).toBe('LAST = SKIPPED EVERY TIME')
  })
})

describe('the loading, offline and failed states', () => {
  it('while the reference loads the line and the sheet say so', () => {
    expect(view([lastWeek], { isLoading: true })).toEqual({ line: 'LAST = ···', body: { kind: 'loading' } })
  })

  it('a failed read is its own state, not FIRST TIME (the old bug: a failed fetch read as no history)', () => {
    const v = view([], { isError: true })
    expect(v.body).toEqual({ kind: 'failed' })
    expect(v.line).toBe("COULDN'T LOAD LAST TIME")
  })

  it('numbers read from the phone\'s cache are marked OFFLINE · CACHED where the session\'s day would be', () => {
    const cached = panelsOf(view([lastWeek, earlier], { isFromCache: true }))
    expect(cached[0].when).toBe('OFFLINE · CACHED')
    expect(cached[0].title).toBe('LAST WEEK')
    expect(rowTexts(cached[0])[0]).toBe('01|52.5 × 10|@ 2|')
  })
})

describe('what a panel lists', () => {
  it('a warmup is never listed and the working sets are numbered from 01 (a warmup has no place)', () => {
    const withWarmup = referenceSessionOf('ww', LAST_WEEK_TUE, [head('ww', 1, 20, 12, null, { isWarmup: true }), head('ww', 2, 60, 8, 1), head('ww', 3, 60, 7, 0)])
    expect(rowTexts(panelsOf(view([withWarmup]))[0])).toEqual(['01|60 × 8|@ 1|', '02|60 × 7|@ 0|'])
  })

  it('a set without RIR shows no RIR', () => {
    const noRir = referenceSessionOf('nr', LAST_WEEK_TUE, [head('nr', 1, 40, 10, null)])
    expect(panelsOf(view([noRir]))[0].rows[0].rir).toBe('')
  })
})
