// Chunk 25 (TASKS.md "sequenceSchedule.ts" / SPEC.md "Scheduling →
// Sequence") — pure tests for the scheduler (Lessons: "pure tests for the
// scheduler"). Every SPEC rule named in reviewer's note 2 gets its own
// case: due dates counted from the last workout DONE; a missed due day
// shifts nothing; Train anyway; Skip; a repeated workout (A, B, A, rest)
// resolves to the right slot after each A; cycle rollover.
import { describe, it, expect } from 'vitest'
import {
  resolveNextSlot,
  computeDueDate,
  scheduleSequence,
  type SequenceCycleItem,
  type SequenceLastEvent,
} from './sequenceSchedule'
import type { Session } from '../../types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's-1', userId: 'u-1', mesocycleId: 'm-1', weekPlanId: 'wp-1', workoutDayId: 'wd-a',
    date: '2026-02-05', status: 'completed', note: null, startedAt: '2026-02-05T10:00:00Z',
    completedAt: '2026-02-05T11:00:00Z', createdAt: '2026-02-05T10:00:00Z', setLogs: [],
    energyRating: null, pumpRating: null, movedToDate: null,
    ...overrides,
  }
}

// A, B, A, rest (SPEC, G8's own example).
const ABAR: SequenceCycleItem[] = [
  { position: 0, workoutDayId: 'wd-a' },
  { position: 1, workoutDayId: 'wd-b' },
  { position: 2, workoutDayId: 'wd-a' },
  { position: 3, workoutDayId: null },
]

function lastEvent(overrides: Partial<SequenceLastEvent> = {}): SequenceLastEvent {
  return { weekNumber: 1, sequencePosition: 0, status: 'completed', date: '2026-02-02', ...overrides }
}

describe('resolveNextSlot', () => {
  it('no items at all → null ("no_workouts")', () => {
    expect(resolveNextSlot([], null)).toBeNull()
  })

  it('every slot is REST → null', () => {
    expect(resolveNextSlot([{ position: 0, workoutDayId: null }, { position: 1, workoutDayId: null }], null)).toBeNull()
  })

  it('nothing ever trained (lastEvent null) → the first workout-bearing slot, cycle 1, no rest delay', () => {
    const result = resolveNextSlot(ABAR, null)
    expect(result).toEqual({ next: { workoutDayId: 'wd-a', weekNumber: 1, sequencePosition: 0 }, restsBetween: 0 })
  })

  it('nothing ever trained, with LEADING rest slots → skips them to the first real workout', () => {
    const items: SequenceCycleItem[] = [{ position: 0, workoutDayId: null }, { position: 1, workoutDayId: 'wd-b' }]
    const result = resolveNextSlot(items, null)
    expect(result?.next).toEqual({ workoutDayId: 'wd-b', weekNumber: 1, sequencePosition: 1 })
  })

  it('A done, two rests planned before B → next is B, restsBetween = 2 (SPEC: "A Monday with two rests → B due Thursday")', () => {
    const items: SequenceCycleItem[] = [
      { position: 0, workoutDayId: 'wd-a' },
      { position: 1, workoutDayId: null },
      { position: 2, workoutDayId: null },
      { position: 3, workoutDayId: 'wd-b' },
    ]
    const result = resolveNextSlot(items, lastEvent({ sequencePosition: 0 }))
    expect(result).toEqual({ next: { workoutDayId: 'wd-b', weekNumber: 1, sequencePosition: 3 }, restsBetween: 2 })
  })

  it('A, B, A, rest: after the FIRST A (position 0) resolves to B (position 1), same cycle', () => {
    const result = resolveNextSlot(ABAR, lastEvent({ sequencePosition: 0, weekNumber: 3 }))
    expect(result).toEqual({ next: { workoutDayId: 'wd-b', weekNumber: 3, sequencePosition: 1 }, restsBetween: 0 })
  })

  it('A, B, A, rest: after the SECOND A (position 2) resolves to A again at position 0, next cycle, past the trailing rest', () => {
    const result = resolveNextSlot(ABAR, lastEvent({ sequencePosition: 2, weekNumber: 3 }))
    expect(result).toEqual({ next: { workoutDayId: 'wd-a', weekNumber: 4, sequencePosition: 0 }, restsBetween: 1 })
  })

  it('cycle rollover: the cycle index is week_number — wrapping past the last item increments it by exactly one', () => {
    const items: SequenceCycleItem[] = [{ position: 0, workoutDayId: 'wd-a' }]
    const result = resolveNextSlot(items, lastEvent({ sequencePosition: 0, weekNumber: 7 }))
    expect(result).toEqual({ next: { workoutDayId: 'wd-a', weekNumber: 8, sequencePosition: 0 }, restsBetween: 0 })
  })

  it('the last-trained slot no longer exists in the CURRENT item list (edited since) → falls back to the first workout slot, same cycle index (scope decision)', () => {
    const result = resolveNextSlot(ABAR, lastEvent({ sequencePosition: 99, weekNumber: 5 }))
    expect(result).toEqual({ next: { workoutDayId: 'wd-a', weekNumber: 5, sequencePosition: 0 }, restsBetween: 0 })
  })
})

describe('computeDueDate', () => {
  it('lastEvent null → null (no anchor, always due)', () => {
    expect(computeDueDate(null, 0)).toBeNull()
  })

  it('completed, 0 rests between → due the very next day', () => {
    expect(computeDueDate(lastEvent({ status: 'completed', date: '2026-02-02' }), 0)).toBe('2026-02-03')
  })

  it('completed, 2 rests between → due 3 days later (SPEC: "A Monday with two rests → B due Thursday")', () => {
    // Monday 2026-02-02 + 2 rests (Tue, Wed) → due Thursday 2026-02-05.
    expect(computeDueDate(lastEvent({ status: 'completed', date: '2026-02-02' }), 2)).toBe('2026-02-05')
  })

  it('skipped → due the SAME day as the skip, regardless of how many rests sit between the slots', () => {
    expect(computeDueDate(lastEvent({ status: 'skipped', date: '2026-02-10' }), 0)).toBe('2026-02-10')
    expect(computeDueDate(lastEvent({ status: 'skipped', date: '2026-02-10' }), 3)).toBe('2026-02-10')
  })
})

describe('scheduleSequence — active/completed short-circuits', () => {
  it('an in-progress session anywhere short-circuits everything else', () => {
    const active = session({ id: 's-active', status: 'in_progress', date: '2026-02-01' })
    const result = scheduleSequence('2026-02-10', { items: ABAR, sessions: [active], lastEvent: null })
    expect(result).toEqual({ type: 'active_session', session: active })
  })

  it('a session completed today (effective date) shows completed_today', () => {
    const done = session({ id: 's-done', status: 'completed', date: '2026-02-10' })
    const result = scheduleSequence('2026-02-10', { items: ABAR, sessions: [done], lastEvent: null })
    expect(result).toEqual({ type: 'completed_today', session: done })
  })

  it('a session completed YESTERDAY does not trigger completed_today', () => {
    const done = session({ id: 's-done', status: 'completed', date: '2026-02-09' })
    const result = scheduleSequence('2026-02-10', { items: ABAR, sessions: [done], lastEvent: null })
    expect(result.type).toBe('next')
  })

  it('no_workouts when the cycle has nothing but rest', () => {
    const items: SequenceCycleItem[] = [{ position: 0, workoutDayId: null }]
    const result = scheduleSequence('2026-02-10', { items, sessions: [], lastEvent: null })
    expect(result).toEqual({ type: 'no_workouts' })
  })
})

describe('scheduleSequence — due dates and "a missed due day misses nothing"', () => {
  it('the day it becomes due, isDue is true', () => {
    const result = scheduleSequence('2026-02-05', { items: ABAR, sessions: [], lastEvent: lastEvent({ sequencePosition: 0, date: '2026-02-04' }) })
    expect(result).toEqual({ type: 'next', next: { workoutDayId: 'wd-b', weekNumber: 1, sequencePosition: 1 }, dueDate: '2026-02-05', isDue: true })
  })

  it('before its due date, isDue is false ("on a rest day")', () => {
    const result = scheduleSequence('2026-02-04', { items: ABAR, sessions: [], lastEvent: lastEvent({ sequencePosition: 0, date: '2026-02-04' }) })
    expect(result).toEqual({ type: 'next', next: { workoutDayId: 'wd-b', weekNumber: 1, sequencePosition: 1 }, dueDate: '2026-02-05', isDue: false })
  })

  it('a missed due day misses nothing: the SAME next slot and due date keep showing, now overdue, for as many days as nothing is done', () => {
    const le = lastEvent({ sequencePosition: 0, date: '2026-02-04' }) // due 2026-02-05
    const day1 = scheduleSequence('2026-02-06', { items: ABAR, sessions: [], lastEvent: le })
    const day2 = scheduleSequence('2026-02-09', { items: ABAR, sessions: [], lastEvent: le })
    expect(day1).toEqual({ type: 'next', next: { workoutDayId: 'wd-b', weekNumber: 1, sequencePosition: 1 }, dueDate: '2026-02-05', isDue: true })
    expect(day2).toEqual(day1) // identical — nothing shifted, nothing was consumed
  })
})

describe('scheduleSequence — Train anyway (training the next workout before its due date)', () => {
  it('starting/completing the already-next workout EARLY becomes the new anchor, discarding the old due date and its remaining rests', () => {
    // Old anchor: A done 2026-02-02, 2 rests before B → B due 2026-02-05.
    const oldAnchor = lastEvent({ sequencePosition: 0, date: '2026-02-02' })
    const items: SequenceCycleItem[] = [
      { position: 0, workoutDayId: 'wd-a' }, { position: 1, workoutDayId: null },
      { position: 2, workoutDayId: null }, { position: 3, workoutDayId: 'wd-b' },
    ]
    const resting = scheduleSequence('2026-02-03', { items, sessions: [], lastEvent: oldAnchor })
    expect(resting).toMatchObject({ type: 'next', dueDate: '2026-02-05', isDue: false }) // still resting

    // "Train anyway" on 2026-02-03 — B gets done TODAY instead of waiting.
    // The new anchor is B's own slot, today, completed.
    const newAnchor = lastEvent({ sequencePosition: 3, date: '2026-02-03' })
    const after = scheduleSequence('2026-02-03', { items, sessions: [], lastEvent: newAnchor })
    // Next slot wraps past the end back to A (position 0), next cycle — the
    // OLD due date (2026-02-05) and its 2 rests are never consulted again.
    expect(after).toEqual({
      type: 'next',
      next: { workoutDayId: 'wd-a', weekNumber: 2, sequencePosition: 0 },
      dueDate: '2026-02-04', // newAnchor's own date + 0 rests (none between B and A here) + 1
      isDue: false,
    })
  })
})

describe('scheduleSequence — Skip', () => {
  it('a skip anchors the NEXT workout to the skip\'s own day, regardless of how many rests the sequence would otherwise count', () => {
    const items: SequenceCycleItem[] = [
      { position: 0, workoutDayId: 'wd-a' }, { position: 1, workoutDayId: null },
      { position: 2, workoutDayId: null }, { position: 3, workoutDayId: 'wd-b' },
    ]
    // A was skipped on 2026-02-10 — B is due that same day, not after 2 rests.
    const afterSkip = lastEvent({ sequencePosition: 0, status: 'skipped', date: '2026-02-10' })
    const result = scheduleSequence('2026-02-10', { items, sessions: [], lastEvent: afterSkip })
    expect(result).toEqual({
      type: 'next',
      next: { workoutDayId: 'wd-b', weekNumber: 1, sequencePosition: 3 },
      dueDate: '2026-02-10',
      isDue: true,
    })
  })
})

describe('scheduleSequence — first-ever workout (lastEvent null)', () => {
  it('is immediately due, no waiting', () => {
    const result = scheduleSequence('2026-01-01', { items: ABAR, sessions: [], lastEvent: null })
    expect(result).toEqual({ type: 'next', next: { workoutDayId: 'wd-a', weekNumber: 1, sequencePosition: 0 }, dueDate: null, isDue: true })
  })
})
