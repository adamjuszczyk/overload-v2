// Chunk 35 (TASKS-1.1 "A sequence run's current cycle is the one with its
// next due workout"; SPEC Scheduling → Sequence [P1.1], G40) — pure tests for
// the helper Today and Plan share. resolveLastEvent is the step that lived
// inline in useSequenceScheduler.ts (its hook-level proof is still
// useSequenceScheduler.test.tsx, unmodified); resolveCurrentCycle is Plan's
// reading of the same event.
import { describe, it, expect } from 'vitest'
import { resolveLastEvent, resolveCurrentCycle } from './sequenceLastEvent'
import { scheduleSequence, type SequenceCycleItem, type SequenceLastEvent } from './sequenceSchedule'
import type { Session, WeekPlan } from '../../types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's-1', userId: 'u-1', mesocycleId: 'm-1', weekPlanId: 'wp-1', workoutDayId: 'wd-a',
    date: '2026-02-05', status: 'completed', note: null, startedAt: '2026-02-05T10:00:00Z',
    completedAt: '2026-02-05T11:00:00Z', createdAt: '2026-02-05T10:00:00Z', setLogs: [],
    energyRating: null, pumpRating: null, movedToDate: null,
    ...overrides,
  }
}

function plan(id: string, weekNumber: number, sequencePosition: number | null): Pick<WeekPlan, 'id' | 'weekNumber' | 'sequencePosition'> {
  return { id, weekNumber, sequencePosition }
}

// A, B, A, rest — SPEC G8's repeated-workout shape.
const ABAR: SequenceCycleItem[] = [
  { position: 0, workoutDayId: 'wd-a' },
  { position: 1, workoutDayId: 'wd-b' },
  { position: 2, workoutDayId: 'wd-a' },
  { position: 3, workoutDayId: null },
]

// A 3-day cycle: three workouts, no rests.
const ABC: SequenceCycleItem[] = [
  { position: 0, workoutDayId: 'wd-a' },
  { position: 1, workoutDayId: 'wd-b' },
  { position: 2, workoutDayId: 'wd-c' },
]

function event(overrides: Partial<SequenceLastEvent> = {}): SequenceLastEvent {
  return { weekNumber: 1, sequencePosition: 0, status: 'completed', date: '2026-02-02', ...overrides }
}

describe('resolveLastEvent — the last done-or-skipped session\'s own slot', () => {
  it('done: a completed session resolves to its week plan row\'s cycle and slot, with its own date', () => {
    const e = resolveLastEvent(
      session({ weekPlanId: 'wp-c2-s1', status: 'completed', date: '2026-02-05' }),
      [plan('wp-c1-s0', 1, 0), plan('wp-c2-s1', 2, 1)],
    )
    expect(e).toEqual({ weekNumber: 2, sequencePosition: 1, status: 'completed', date: '2026-02-05' })
  })

  it('skipped: a skipped session resolves the same way, with status skipped (the skip\'s own date)', () => {
    const e = resolveLastEvent(
      session({ weekPlanId: 'wp-c2-s1', status: 'skipped', date: '2026-02-06' }),
      [plan('wp-c2-s1', 2, 1)],
    )
    expect(e).toEqual({ weekNumber: 2, sequencePosition: 1, status: 'skipped', date: '2026-02-06' })
  })

  it('a moved session\'s date is its effective date (moved_to_date when set)', () => {
    const e = resolveLastEvent(
      session({ weekPlanId: 'wp-1', date: '2026-02-05', movedToDate: '2026-02-07' }),
      [plan('wp-1', 1, 0)],
    )
    expect(e?.date).toBe('2026-02-07')
  })

  it('repeated workout: two slots of one workout are told apart by the week plan row the session names, never by workout', () => {
    // wp-slot0 and wp-slot2 are both Workout A (positions 0 and 2) in cycle 3.
    const plans = [plan('wp-slot0', 3, 0), plan('wp-slot2', 3, 2)]
    const second = resolveLastEvent(session({ workoutDayId: 'wd-a', weekPlanId: 'wp-slot2' }), plans)
    const first = resolveLastEvent(session({ workoutDayId: 'wd-a', weekPlanId: 'wp-slot0' }), plans)
    expect(second?.sequencePosition).toBe(2)
    expect(first?.sequencePosition).toBe(0)
    // ... and the cycle each leads to differs: after the second A the sequence
    // wraps past the rest slot into cycle 4; after the first A it goes to B in cycle 3.
    expect(resolveCurrentCycle(ABAR, second)).toBe(4)
    expect(resolveCurrentCycle(ABAR, first)).toBe(3)
  })

  it('no events: no session at all (null, or a query that has no answer) → null', () => {
    expect(resolveLastEvent(null, [plan('wp-1', 1, 0)])).toBeNull()
    expect(resolveLastEvent(undefined, [plan('wp-1', 1, 0)])).toBeNull()
  })

  it('defensive: a session with no week plan, a week plan that is not in the list, or a weekday-shaped row (no slot) → null', () => {
    expect(resolveLastEvent(session({ weekPlanId: null }), [plan('wp-1', 1, 0)])).toBeNull()
    expect(resolveLastEvent(session({ weekPlanId: 'wp-gone' }), [plan('wp-1', 1, 0)])).toBeNull()
    expect(resolveLastEvent(session({ weekPlanId: 'wp-1' }), [plan('wp-1', 4, null)])).toBeNull()
    expect(resolveLastEvent(session({ weekPlanId: 'wp-1' }), [{ id: 'wp-1', weekNumber: 4 }])).toBeNull()
  })
})

describe('resolveCurrentCycle — the cycle containing the next due workout', () => {
  it('no events: cycle 1', () => {
    expect(resolveCurrentCycle(ABC, null)).toBe(1)
    expect(resolveCurrentCycle(ABAR, null)).toBe(1)
  })

  it('done mid-cycle: the cycle the done workout is in (the next workout is in the same cycle)', () => {
    expect(resolveCurrentCycle(ABC, event({ weekNumber: 2, sequencePosition: 0 }))).toBe(2)
    expect(resolveCurrentCycle(ABC, event({ weekNumber: 2, sequencePosition: 1 }))).toBe(2)
  })

  it('done on the last workout of a cycle: the next cycle (a 3-day cycle, cycle 2\'s last workout done → cycle 3)', () => {
    expect(resolveCurrentCycle(ABC, event({ weekNumber: 2, sequencePosition: 2 }))).toBe(3)
  })

  it('skipped counts exactly like done: skipping cycle 2\'s last workout → cycle 3', () => {
    expect(resolveCurrentCycle(ABC, event({ weekNumber: 2, sequencePosition: 2, status: 'skipped' }))).toBe(3)
    expect(resolveCurrentCycle(ABC, event({ weekNumber: 2, sequencePosition: 1, status: 'skipped' }))).toBe(2)
  })

  it('in progress: a workout in progress is not an event, so it stays the next slot and its cycle stays current', () => {
    // Cycle 2's last workout (C) is being done: the last done one is B. Until C is
    // done, cycle 2 is the current cycle; once C is done, cycle 3 is.
    const bDone = event({ weekNumber: 2, sequencePosition: 1 })
    const cDone = event({ weekNumber: 2, sequencePosition: 2 })
    expect(resolveCurrentCycle(ABC, bDone)).toBe(2)
    expect(resolveCurrentCycle(ABC, cDone)).toBe(3)
  })

  it('whether the next workout is due yet or not: trailing rest days do not hold the old cycle open', () => {
    // A, B, A, rest — the second A is done in cycle 1: the next workout is cycle 2's A,
    // after the rest day, even though that rest day hasn't passed.
    expect(resolveCurrentCycle(ABAR, event({ weekNumber: 1, sequencePosition: 2, date: '2026-02-05' }))).toBe(2)
  })

  it('repeated workout: after the first A the current cycle is still this one; after the second A it is the next', () => {
    expect(resolveCurrentCycle(ABAR, event({ weekNumber: 5, sequencePosition: 0 }))).toBe(5)
    expect(resolveCurrentCycle(ABAR, event({ weekNumber: 5, sequencePosition: 1 }))).toBe(5)
    expect(resolveCurrentCycle(ABAR, event({ weekNumber: 5, sequencePosition: 2 }))).toBe(6)
  })

  it('a sequence with no workout (every slot a rest, or no slots at all): stays 1, even with an event', () => {
    expect(resolveCurrentCycle([], null)).toBe(1)
    expect(resolveCurrentCycle([], event({ weekNumber: 4 }))).toBe(1)
    const allRest: SequenceCycleItem[] = [{ position: 0, workoutDayId: null }, { position: 1, workoutDayId: null }]
    expect(resolveCurrentCycle(allRest, null)).toBe(1)
    expect(resolveCurrentCycle(allRest, event({ weekNumber: 4 }))).toBe(1)
  })

  it('the last event\'s slot no longer exists in the (edited) sequence: the cycle index is kept, as Today keeps it', () => {
    expect(resolveCurrentCycle(ABC, event({ weekNumber: 3, sequencePosition: 9 }))).toBe(3)
  })

  it('does not reorder or change the items it is given', () => {
    const shuffled: SequenceCycleItem[] = [ABC[2], ABC[0], ABC[1]]
    const copy = shuffled.map((i) => ({ ...i }))
    expect(resolveCurrentCycle(shuffled, event({ weekNumber: 2, sequencePosition: 2 }))).toBe(3)
    expect(shuffled).toEqual(copy)
  })
})

describe('Plan and Today read one rule: resolveCurrentCycle equals the cycle Today\'s scheduleSequence puts its next workout in', () => {
  const scenarios: { name: string; items: SequenceCycleItem[]; lastEvent: SequenceLastEvent | null }[] = [
    { name: 'nothing done yet', items: ABAR, lastEvent: null },
    { name: 'mid-cycle, done', items: ABC, lastEvent: event({ weekNumber: 2, sequencePosition: 1 }) },
    { name: 'last of the cycle, done', items: ABC, lastEvent: event({ weekNumber: 2, sequencePosition: 2 }) },
    { name: 'last of the cycle, skipped', items: ABC, lastEvent: event({ weekNumber: 2, sequencePosition: 2, status: 'skipped' }) },
    { name: 'second A of A, B, A, rest', items: ABAR, lastEvent: event({ weekNumber: 3, sequencePosition: 2 }) },
    { name: 'first A of A, B, A, rest', items: ABAR, lastEvent: event({ weekNumber: 3, sequencePosition: 0 }) },
    { name: 'slot no longer in the sequence', items: ABC, lastEvent: event({ weekNumber: 3, sequencePosition: 9 }) },
  ]

  for (const s of scenarios) {
    it(s.name, () => {
      const today = scheduleSequence('2026-03-01', { items: s.items, sessions: [], lastEvent: s.lastEvent })
      expect(today.type).toBe('next')
      if (today.type !== 'next') return
      expect(resolveCurrentCycle(s.items, s.lastEvent)).toBe(today.next.weekNumber)
    })
  }

  it('a sequence with no workout: Today says no_workouts, Plan says cycle 1', () => {
    const allRest: SequenceCycleItem[] = [{ position: 0, workoutDayId: null }]
    expect(scheduleSequence('2026-03-01', { items: allRest, sessions: [], lastEvent: null }).type).toBe('no_workouts')
    expect(resolveCurrentCycle(allRest, null)).toBe(1)
  })
})
