import { describe, it, expect } from 'vitest'
import type { DayOfWeek, ProgramExercise } from '../../types'
import { dayShort, legendText, menuEyebrow, sessionEyebrow, sessionStateOf, sharedMarksLine, sharedWithLine, thisWeekOnlyExercises, type PlanSession } from './weekViewLogic'
import { pe, pset, wset, stage } from './weekPlanning.testutil'

// Chunk 54b: the week view's rules as pure functions (weekViewLogic.ts). The screens that draw them are PlanPage.weekView.test.tsx's.

const s = (over: Partial<PlanSession> = {}): PlanSession => ({
  id: 's1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-10-19', movedToDate: null, status: 'planned', ...over,
})

describe('sessionStateOf — which session a chip or a header is about, and how far it got', () => {
  it('nothing read, no plan row or no session of it: no state', () => {
    for (const state of [sessionStateOf(undefined, { id: 'wp-1' }, null), sessionStateOf([s()], undefined, null), sessionStateOf([], { id: 'wp-1' }, null)]) {
      expect(state).toEqual({ session: undefined, finished: null, started: false, movedTo: null })
    }
  })

  it('a weekday chip matches its plan row AND its date: a shared plan\'s other day, and another plan\'s session on the same day, are not it', () => {
    const sessions = [s({ id: 'mon', date: '2026-10-19', status: 'completed' }), s({ id: 'other-plan', weekPlanId: 'wp-2', date: '2026-10-22', status: 'completed' })]
    expect(sessionStateOf(sessions, { id: 'wp-1' }, '2026-10-19')).toMatchObject({ finished: 'done', started: true })
    expect(sessionStateOf(sessions, { id: 'wp-1' }, '2026-10-22').session).toBeUndefined() // Thursday of the same plan: no session of its own
  })

  it('a sequence slot (no date) matches by its plan row alone', () => {
    expect(sessionStateOf([s({ status: 'skipped', date: '2026-10-20' })], { id: 'wp-1' }, null)).toMatchObject({ finished: 'skipped', started: false })
  })

  it('the furthest a plan\'s sessions got wins: completed over skipped over in progress over planned, whatever the order', () => {
    const rows = [s({ id: 'a', status: 'planned' }), s({ id: 'b', status: 'in_progress' }), s({ id: 'c', status: 'skipped' }), s({ id: 'd', status: 'completed' })]
    expect(sessionStateOf(rows, { id: 'wp-1' }, null).session?.id).toBe('d')
    expect(sessionStateOf([...rows].reverse(), { id: 'wp-1' }, null).session?.id).toBe('d')
    expect(sessionStateOf(rows.slice(0, 3), { id: 'wp-1' }, null).session?.id).toBe('c')
    expect(sessionStateOf(rows.slice(0, 2), { id: 'wp-1' }, null).session?.id).toBe('b')
  })

  it('started is in progress or completed (a session that can no longer be moved); a skipped one is finished but not started', () => {
    expect(sessionStateOf([s({ status: 'in_progress' })], { id: 'wp-1' }, null)).toMatchObject({ finished: null, started: true })
    expect(sessionStateOf([s({ status: 'completed' })], { id: 'wp-1' }, null)).toMatchObject({ finished: 'done', started: true })
    expect(sessionStateOf([s({ status: 'skipped' })], { id: 'wp-1' }, null)).toMatchObject({ finished: 'skipped', started: false })
    expect(sessionStateOf([s({ status: 'planned' })], { id: 'wp-1' }, null)).toMatchObject({ finished: null, started: false })
  })

  it('moved: a planned or started session whose moved_to_date differs from its date; never a finished one, never one moved onto its own day', () => {
    expect(sessionStateOf([s({ movedToDate: '2026-10-23' })], { id: 'wp-1' }, null).movedTo).toBe('2026-10-23')
    expect(sessionStateOf([s({ movedToDate: '2026-10-23', status: 'in_progress' })], { id: 'wp-1' }, null).movedTo).toBe('2026-10-23')
    expect(sessionStateOf([s({ movedToDate: '2026-10-23', status: 'completed' })], { id: 'wp-1' }, null).movedTo).toBeNull()
    expect(sessionStateOf([s({ movedToDate: '2026-10-23', status: 'skipped' })], { id: 'wp-1' }, null).movedTo).toBeNull()
    expect(sessionStateOf([s({ movedToDate: '2026-10-19' })], { id: 'wp-1' }, null).movedTo).toBeNull()
  })

  it('dayShort names the weekday of a date (2026-10-23 is a Friday)', () => {
    expect(dayShort('2026-10-23')).toBe('FRI')
    expect(dayShort('2026-10-18')).toBe('SUN')
  })
})

describe('the words', () => {
  it('"Shared with …": the OTHER days, "both" for two and "all" for three or more; nothing for one day', () => {
    const days = (...d: DayOfWeek[]) => d
    expect(sharedWithLine(days('monday', 'thursday'), 'monday')).toBe('Shared with Thu — changes apply to both')
    expect(sharedWithLine(days('monday', 'thursday'), 'thursday')).toBe('Shared with Mon — changes apply to both')
    expect(sharedWithLine(days('monday', 'wednesday', 'friday'), 'wednesday')).toBe('Shared with Mon, Fri — changes apply to all')
    expect(sharedWithLine(days('tuesday', 'thursday', 'saturday'), 'tuesday')).toBe('Shared with Thu, Sat — changes apply to all') // P1.2-7
    expect(sharedWithLine(days('monday'), 'monday')).toBeNull()
    expect(sharedWithLine([], null)).toBeNull()
  })

  it('the menu\'s line names every day that shares the plan, this one included', () => {
    expect(sharedMarksLine(['monday', 'thursday'])).toBe('Marks Mon, Thu — they share one plan.')
    expect(sharedMarksLine(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])).toBe('Marks Mon, Tue, Wed, Thu, Fri — they share one plan.')
  })

  it('the header\'s top line names the week or cycle only when it isn\'t the current one; the menu\'s always does', () => {
    expect(sessionEyebrow({ label: 'TUESDAY', unit: 'week', viewWeek: 3, currentWeek: 3 })).toBe('TUESDAY')
    expect(sessionEyebrow({ label: 'THURSDAY', unit: 'week', viewWeek: 1, currentWeek: 3 })).toBe('THURSDAY · WEEK 1')
    expect(sessionEyebrow({ label: 'SLOT 3', unit: 'cycle', viewWeek: 4, currentWeek: 3 })).toBe('SLOT 3 · CYCLE 4')
    expect(menuEyebrow({ label: 'TUESDAY', unit: 'week', viewWeek: 2 })).toBe('TUESDAY · WEEK 2')
    expect(menuEyebrow({ label: 'SLOT 3', unit: 'cycle', viewWeek: 3 })).toBe('SLOT 3 · CYCLE 3')
  })

  it('the legend says WEEK or CYCLE', () => {
    expect(legendText('week', 2)).toBe('CHANGED SINCE WEEK 2')
    expect(legendText('cycle', 1)).toBe('CHANGED SINCE CYCLE 1')
  })
})

describe('thisWeekOnlyExercises — one exercise at a time against the default (SPEC Stable weeks)', () => {
  const A = pe('pe-a', 'ex-a', 0)
  const B = pe('pe-b', 'ex-b', 1)
  const runCopy = {
    exercises: [A, B],
    sets: [pset('a1', 'pe-a', 1), pset('a2', 'pe-a', 2), pset('b1', 'pe-b', 1), pset('b2', 'pe-b', 2)],
  }
  const aSets = [wset('wa1', 'pe-a', 1), wset('wa2', 'pe-a', 2)]
  const bSets = [wset('wb1', 'pe-b', 1), wset('wb2', 'pe-b', 2)]
  const ids = (exercises: ProgramExercise[], sets: ReturnType<typeof wset>[], copy = runCopy) => [...thisWeekOnlyExercises(exercises, sets, copy)].sort()

  it('the default\'s own sets: none; a set more, a kind, a stage and a rep target each make the exercise one', () => {
    expect(ids([A, B], [...aSets, ...bSets])).toEqual([])
    expect(ids([A, B], [...aSets, wset('wa3', 'pe-a', 3), ...bSets])).toEqual(['pe-a']) // count
    expect(ids([A, B], [...aSets, ...bSets.map((x) => (x.id === 'wb2' ? { ...x, isWarmup: true } : x))])).toEqual(['pe-b']) // kind
    expect(ids([A, B], [...aSets, ...bSets, stage('wb2s', 'wb2', 'pe-b', 1)])).toEqual(['pe-b']) // a stage
    expect(ids([A, B], [...aSets.map((x) => (x.id === 'wa1' ? { ...x, repMin: 12, repMax: 12 } : x)), ...bSets])).toEqual(['pe-a']) // rep target
  })

  it('weight, RIR and cues never count: the default holds none', () => {
    const changed = [...aSets, ...bSets].map((x) => ({ ...x, targetWeight: 77, targetRir: 0, targetRirMax: 2, tags: ['push here'] }))
    expect(ids([A, B], changed)).toEqual([])
  })

  it('an exercise the run copy no longer has (removed, or a week-only row) differs; no run copy read yet: none', () => {
    expect(ids([A, B], [...aSets, ...bSets], { ...runCopy, exercises: [A, { ...B, removedAt: '2026-10-01T00:00:00Z' } as ProgramExercise] })).toEqual(['pe-b'])
    expect(ids([A, B], [...aSets, ...bSets], { ...runCopy, exercises: [A, { ...B, weekOnly: true } as ProgramExercise] })).toEqual(['pe-b'])
    expect(thisWeekOnlyExercises([A, B], [...aSets, ...bSets], null).size).toBe(0)
  })

  it('a set the default dropped (removed_at) is not part of the default', () => {
    const dropped = { ...runCopy, sets: runCopy.sets.map((x) => (x.id === 'a2' ? { ...x, removedAt: '2026-10-01T00:00:00Z' } : x)) }
    expect(ids([A, B], [...aSets, ...bSets], dropped)).toEqual(['pe-a']) // the week still has two sets, the default one
    expect(ids([A, B], [aSets[0], ...bSets], dropped)).toEqual([])
  })
})
