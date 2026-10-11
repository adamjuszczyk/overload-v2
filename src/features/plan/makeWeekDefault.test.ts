import { describe, it, expect } from 'vitest'
import type { ProgramExercise, WeekPlan, WeekPlanSet } from '../../types'
import { canMakeWeekDefault, isDefaultSource, parseMakeDefaultResult } from './makeWeekDefault'

// Chunk 32 — the pure half of "Make this week the new default": whether a week can be
// made the default, and the function's answer parsed. (There is no apply-ahead offer after
// it, so nothing else lives here.)

// ─── 1. Can this week be made the default ────────────────────────────────────

function session(overrides: Partial<WeekPlan> & { setRows?: string[]; exerciseRows?: string[] } = {}): WeekPlan {
  const { setRows = ['pe-1'], exerciseRows = ['pe-1'], ...rest } = overrides
  const exercises = exerciseRows.map((id, position): ProgramExercise => ({ id, workoutDayId: 'wd-1', userId: 'u', exerciseId: `ex-${id}`, position, weightUnit: null }))
  const planSets = setRows.map((programExerciseId, i): WeekPlanSet => ({
    id: `s-${i}`, weekPlanId: 'wp', userId: 'u', programExerciseId, setNumber: i + 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }))
  return { id: 'wp', userId: 'u', mesocycleId: 'm', workoutDayId: 'wd-1', weekNumber: 3, isDeload: false, notes: null, sets: planSets, exercises, createdAt: '', ...rest }
}

describe('canMakeWeekDefault — the function\'s own refusals, on the client', () => {
  it('a normal planned session can be made the default', () => {
    expect(isDefaultSource(session())).toBe(true)
    expect(canMakeWeekDefault([session()])).toBe(true)
  })

  it('a week that is all deload is not offered (G27)', () => {
    expect(canMakeWeekDefault([session({ isDeload: true }), session({ id: 'wp-b', isDeload: true })])).toBe(false)
  })

  it('a week of empty sessions is not offered (the function refuses it: nothing to be the default)', () => {
    expect(canMakeWeekDefault([session({ setRows: [] })])).toBe(false)
  })

  it('a session whose only sets sit under a row it does not list is empty, as the function counts it', () => {
    // sets under 'pe-gone', exercise list holds only 'pe-1': the function joins sets to the
    // session's own exercise rows, so there is no planned set at all.
    expect(isDefaultSource(session({ setRows: ['pe-gone'], exerciseRows: ['pe-1'] }))).toBe(false)
  })

  it('a week that is only deload and empty sessions is not offered', () => {
    expect(canMakeWeekDefault([session({ isDeload: true }), session({ id: 'wp-b', setRows: [] })])).toBe(false)
  })

  it('one session that can be a source is enough; the others keep their workouts\' defaults', () => {
    expect(canMakeWeekDefault([session({ isDeload: true }), session({ id: 'wp-b' })])).toBe(true)
  })

  it('a week with nothing planned is not offered', () => {
    expect(canMakeWeekDefault([])).toBe(false)
  })
})

// ─── 2. The function's answer, parsed ────────────────────────────────────────

describe('parseMakeDefaultResult — the shape migration 040 documents', () => {
  const answer = {
    mesocycle_id: 'meso-1',
    week_number: 3,
    // The old default of every workout it rewrote: the action does not read it.
    workouts: [{ workout_day_id: 'wd-1', source: { week_plan_id: 'wp-3', sequence_position: null }, old_default: { exercises: [{ id: 'pe-1', exercise_id: 'ex-1', position: 0, sets: [] }] } }],
    skipped: [
      { workout_day_id: 'wd-2', reason: 'deload' },
      { workout_day_id: 'wd-3', reason: 'empty' },
    ],
  }

  it('reads which workouts were left alone, and why', () => {
    expect(parseMakeDefaultResult(answer)).toEqual({
      mesocycleId: 'meso-1',
      weekNumber: 3,
      skipped: [
        { workoutDayId: 'wd-2', reason: 'deload' },
        { workoutDayId: 'wd-3', reason: 'empty' },
      ],
    })
  })

  it('an answer with nobody left alone has none skipped', () => {
    expect(parseMakeDefaultResult({ ...answer, skipped: [] }).skipped).toEqual([])
    expect(parseMakeDefaultResult({ mesocycle_id: 'meso-1', week_number: 3 }).skipped).toEqual([])
  })

  it('an entry without a workout, and a reason it does not know, are read as the rest are', () => {
    const parsed = parseMakeDefaultResult({ skipped: [{ reason: 'deload' }, { workout_day_id: 'wd-4', reason: 'something else' }, 'nope', null] })
    expect(parsed.skipped).toEqual([{ workoutDayId: 'wd-4', reason: 'empty' }])
  })

  // The default is written by the time the answer is read, so an answer that can't be read must
  // not look like a failed call: it reads as "no workout was left alone".
  it('an answer it cannot read is not a throw', () => {
    for (const unreadable of [null, undefined, 'x', 7, [], { skipped: 'x' }]) {
      expect(parseMakeDefaultResult(unreadable).skipped).toEqual([])
    }
    expect(parseMakeDefaultResult(null)).toEqual({ mesocycleId: '', weekNumber: 0, skipped: [] })
  })
})
