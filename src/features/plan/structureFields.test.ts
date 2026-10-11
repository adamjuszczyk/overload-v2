import { describe, it, expect } from 'vitest'
import type { ProgramExercise, ProgramSet, WeekPlanSet } from '../../types'
import { ownProgramSet, exerciseMarkers, setRestMarkers, stageRestDefaultText } from './structureFields'

// Chunk 30 — the pure decisions behind Plan's STRUCTURE view of the run-wide fields. The screen
// (PlanPage.structureFields.test.tsx) proves they are wired; these prove the rules themselves.

const weekSet = (over: Partial<WeekPlanSet>): WeekPlanSet => ({
  id: 'ws-1', weekPlanId: 'wp-1', userId: 'u', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false,
  parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId: 'ps-1', ...over,
})
const programSet = (over: Partial<ProgramSet>): ProgramSet => ({
  id: 'ps-1', userId: 'u', programExerciseId: 'pe-1', position: 0, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})
const exercise = (over: Partial<ProgramExercise>): ProgramExercise => ({
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'u', exerciseId: 'ex-1', position: 0, weightUnit: null, ...over,
})
const byId = (...sets: ProgramSet[]) => new Map(sets.map((s) => [s.id, s]))

describe('ownProgramSet — the workout screen\'s own lookup: the set\'s program set, among its own exercise row\'s', () => {
  it('finds the program set a week set names when it belongs to the set\'s own exercise row', () => {
    const own = programSet({ id: 'ps-1', programExerciseId: 'pe-1' })
    expect(ownProgramSet(weekSet({ programSetId: 'ps-1', programExerciseId: 'pe-1' }), byId(own))).toBe(own)
  })

  it('finds nothing for a set that names none (a set added in a week, an added exercise\'s sets)', () => {
    expect(ownProgramSet(weekSet({ programSetId: null }), byId(programSet({})))).toBeNull()
    expect(ownProgramSet(weekSet({ programSetId: undefined }), byId(programSet({})))).toBeNull()
  })

  it('finds nothing for one that names a program set which is gone, or not loaded', () => {
    expect(ownProgramSet(weekSet({ programSetId: 'ps-gone' }), byId(programSet({ id: 'ps-1' })))).toBeNull()
    expect(ownProgramSet(weekSet({ programSetId: 'ps-1' }), byId())).toBeNull()
  })

  // The swapped-in exercise's sets still name the replaced row's program sets (swapWeekExercise moves the
  // week's sets to the new row without touching program_set_id). The program set exists and is loaded; it is
  // just not this exercise's, and the workout screen never reads it for this row. G45 answered "no".
  it('refuses a program set that belongs to ANOTHER exercise row, though it exists — the swapped-in exercise\'s sets', () => {
    const replacedRows = programSet({ id: 'ps-1', programExerciseId: 'pe-replaced' })
    expect(ownProgramSet(weekSet({ programSetId: 'ps-1', programExerciseId: 'pe-swapped-in' }), byId(replacedRows))).toBeNull()
  })

  it('and compares the exercise rows, not the ids of the two sets', () => {
    const a = programSet({ id: 'ps-a', programExerciseId: 'pe-a' })
    const b = programSet({ id: 'ps-b', programExerciseId: 'pe-b' })
    expect(ownProgramSet(weekSet({ programSetId: 'ps-a', programExerciseId: 'pe-b' }), byId(a, b))).toBeNull()
    expect(ownProgramSet(weekSet({ programSetId: 'ps-b', programExerciseId: 'pe-b' }), byId(a, b))).toBe(b)
  })
})

describe('exerciseMarkers — only the fields that are set', () => {
  it('is empty for an exercise with none set', () => {
    expect(exerciseMarkers(exercise({}), 'kg')).toEqual([])
    expect(exerciseMarkers(exercise({ restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null }), 'kg')).toEqual([])
    expect(exerciseMarkers(exercise({ tempo: '' }), 'kg')).toEqual([])
  })

  it('names each field that is set, in the order REST, REST AFTER, TEMPO, UNIT', () => {
    expect(exerciseMarkers(exercise({ restSeconds: 90, restAfterSeconds: 180, tempo: '3-1-1-0', weightUnit: 'lbs' }), 'kg')).toEqual([
      'REST 1min 30s', 'REST AFTER 3min 0s', 'TEMPO 3-1-1-0', 'UNIT LBS',
    ])
  })

  it('shows one field alone', () => {
    expect(exerciseMarkers(exercise({ restSeconds: 45 }), 'kg')).toEqual(['REST 45s'])
    expect(exerciseMarkers(exercise({ restAfterSeconds: 60 }), 'kg')).toEqual(['REST AFTER 1min 0s'])
    expect(exerciseMarkers(exercise({ tempo: 'X-0-X-0' }), 'kg')).toEqual(['TEMPO X-0-X-0'])
  })

  it('does not mistake a zero for unset (a rest of 0 is not stored by the steppers, but null is the only "unset")', () => {
    expect(exerciseMarkers(exercise({ restSeconds: 0 }), 'kg')).toEqual(['REST 0s'])
  })

  it('marks a unit only where it overrides the Settings unit', () => {
    expect(exerciseMarkers(exercise({ weightUnit: 'lbs' }), 'kg')).toEqual(['UNIT LBS'])
    expect(exerciseMarkers(exercise({ weightUnit: 'kg' }), 'lbs')).toEqual(['UNIT KG'])
    expect(exerciseMarkers(exercise({ weightUnit: 'kg' }), 'kg')).toEqual([]) // the same as the default: nothing to see
    expect(exerciseMarkers(exercise({ weightUnit: 'lbs' }), 'lbs')).toEqual([])
    expect(exerciseMarkers(exercise({ weightUnit: null }), 'lbs')).toEqual([])
  })
})

describe('setRestMarkers — a set\'s own rest, and a staged head\'s stage rest, where set', () => {
  it('is empty for a set with no program set (G45) or one with nothing set', () => {
    expect(setRestMarkers(null, false)).toEqual([])
    expect(setRestMarkers(null, true)).toEqual([])
    expect(setRestMarkers(programSet({}), false)).toEqual([])
    expect(setRestMarkers(programSet({}), true)).toEqual([])
  })

  it('shows the rest of any set; the stage rest only of a staged head', () => {
    expect(setRestMarkers(programSet({ restSeconds: 120 }), false)).toEqual(['REST 2min 0s'])
    expect(setRestMarkers(programSet({ restSeconds: 120, stageRestSeconds: 20 }), true)).toEqual(['REST 2min 0s', 'STAGE REST 20s'])
    expect(setRestMarkers(programSet({ stageRestSeconds: 20 }), true)).toEqual(['STAGE REST 20s'])
    // a stage rest left on a head that has no stage (its stages were removed) is not shown, as it is not used
    expect(setRestMarkers(programSet({ stageRestSeconds: 20 }), false)).toEqual([])
  })
})

describe('stageRestDefaultText — what an unset STAGE REST reads', () => {
  it('is its kind\'s own default: no timer for a dropset, 15 s for the others', () => {
    expect(stageRestDefaultText('dropset')).toBe('NO TIMER')
    expect(stageRestDefaultText('rest_pause')).toBe('15S')
    expect(stageRestDefaultText('myo_reps')).toBe('15S')
    expect(stageRestDefaultText('cluster')).toBe('15S')
  })
})
