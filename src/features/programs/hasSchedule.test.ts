import { describe, it, expect } from 'vitest'
import { hasScheduledWorkout, NO_SCHEDULE_START_REASON } from './hasSchedule'
import type { WeeklySchedule } from '../../types'

// Chunk 33 (SPEC Programs and runs [P1.1], G39): "Starting a run needs a schedule:
// at least one workout on a weekday (weekday), or one workout in the sequence
// (sequence)." The one check every START and Plan's no-schedule line share.

const NO_DAYS: WeeklySchedule = {
  monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null,
}
const WORKOUTS = [{ id: 'wd-a' }, { id: 'wd-b' }]
const slot = (workoutDayId: string | null) => ({ workoutDayId })

describe('hasScheduledWorkout — a weekday program', () => {
  it('is false with no workout on any weekday', () => {
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(false)
  })

  it('is false for a program with no workouts at all, whatever the map holds', () => {
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: { ...NO_DAYS, monday: 'wd-a' }, workoutDays: [], sequenceItems: [] })).toBe(false)
  })

  it.each(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const)(
    'is true with one workout on %s (every weekday counts, not just the first)',
    (dow) => {
      expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: { ...NO_DAYS, [dow]: 'wd-b' }, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(true)
    },
  )

  it('is true with one workout on several weekdays (G14: one shared workout)', () => {
    const schedule = { ...NO_DAYS, monday: 'wd-a', wednesday: 'wd-a', friday: 'wd-a' }
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(true)
  })

  it('does not count a weekday that names a workout the program does not have', () => {
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: { ...NO_DAYS, tuesday: 'wd-gone' }, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(false)
  })

  it('counts the workout that exists when another weekday names one that does not', () => {
    const schedule = { ...NO_DAYS, tuesday: 'wd-gone', thursday: 'wd-a' }
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(true)
  })

  it('reads an unset schedule type (null or absent) as weekday, the column default', () => {
    const schedule = { ...NO_DAYS, monday: 'wd-a' }
    expect(hasScheduledWorkout({ schedule, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(true)
    expect(hasScheduledWorkout({ scheduleType: null, schedule, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(true)
    expect(hasScheduledWorkout({ scheduleType: null, schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [slot('wd-a')] })).toBe(false)
  })

  it('does not read the sequence at all: slots under a weekday program do not schedule it', () => {
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [slot('wd-a'), slot('wd-b')] })).toBe(false)
  })

  it('tolerates a missing or partial schedule map', () => {
    expect(hasScheduledWorkout({ scheduleType: 'weekday', workoutDays: WORKOUTS, sequenceItems: [] })).toBe(false)
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: null, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(false)
    expect(hasScheduledWorkout({ scheduleType: 'weekday', schedule: { sunday: 'wd-a' }, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(true)
  })
})

describe('hasScheduledWorkout — a sequence program', () => {
  it('is false with no slot', () => {
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(false)
  })

  it('is false with only rest slots (a null workout is a rest day)', () => {
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [slot(null), slot(null), slot(null)] })).toBe(false)
  })

  it('is true with one workout slot among rests, wherever it sits', () => {
    const items = [slot(null), slot(null), slot('wd-a')]
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: items })).toBe(true)
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [slot('wd-b'), slot(null)] })).toBe(true)
  })

  it('is true when one workout fills several slots (a repeated workout)', () => {
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [slot('wd-a'), slot(null), slot('wd-a')] })).toBe(true)
  })

  it('does not count a slot that names a workout the program does not have', () => {
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: WORKOUTS, sequenceItems: [slot('wd-gone')] })).toBe(false)
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: NO_DAYS, workoutDays: [], sequenceItems: [slot('wd-a')] })).toBe(false)
  })

  it('does not read the weekday map: a stale one left under a sequence program does not schedule it (the switch converts nothing)', () => {
    const stale = { ...NO_DAYS, monday: 'wd-a', thursday: 'wd-b' }
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: stale, workoutDays: WORKOUTS, sequenceItems: [] })).toBe(false)
    expect(hasScheduledWorkout({ scheduleType: 'sequence', schedule: stale, workoutDays: WORKOUTS, sequenceItems: [slot(null)] })).toBe(false)
  })
})

describe('the reason line', () => {
  it('is the one the planner and the Programs page show under a START that cannot start (DECISIONS 85)', () => {
    expect(NO_SCHEDULE_START_REASON).toBe('Schedule at least one workout to start')
  })
})
