import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_REST_SECONDS, STAGE_KINDS } from '../../lib/plannerVocabulary'
import type { RepTarget } from '../../lib/plannerVocabulary'
import type { SessionSetChangeType } from '../../types'
import {
  REP_BOUNDS,
  REP_TARGET_TEXT,
  REST_MAX_SECONDS,
  RIR_BOUNDS,
  RIR_TARGET_TEXT,
  SET_TYPE_OPTIONS,
  SET_TYPE_TEXT,
  STAGE_COUNT_MAX,
  STAGE_COUNT_MIN,
  TARGET_MODES,
  applySetType,
  applyToAllTargets,
  countApplyToAll,
  cuesSummary,
  draftFromRepTarget,
  draftFromRirTarget,
  formatRestClock,
  periodTail,
  pickTargetMode,
  pickerEyebrow,
  repRange,
  repTargetFromDraft,
  repTargetSummary,
  restAfterText,
  rirRange,
  rirTargetFromColumns,
  rirTargetFromDraft,
  rirTargetSummary,
  rirTargetToColumns,
  sameSetType,
  setTypeEyebrow,
  setTypeId,
  setTypeOptionsFor,
  setTypePickerRows,
  stageRestText,
  stepRest,
  stepStageCount,
  stepStageRest,
  stepTargetField,
  useForAllLabel,
  type RirTarget,
  type SetType,
  type SetTypeId,
  type SetTypePickerContext,
  type TargetDraft,
  type TargetableSet,
} from './pickerLogic'

// TASKS-1.2 chunk 39: what the three pickers decide, as pure functions. Each rule is asserted here
// and again where a picker draws it (SetTypePicker.test.tsx, TargetPickers.test.tsx).

const here = dirname(fileURLToPath(import.meta.url))
const board = (file: string) => readFileSync(join(here, '..', '..', '..', 'design', '1.2', 'source', file), 'utf8')

const staged = (stageKind: (typeof STAGE_KINDS)[number], stageCount: number, stageRestSeconds: number | null = null): SetType => ({
  kind: 'staged',
  stageKind,
  stageCount,
  stageRestSeconds,
})

describe('the set type list', () => {
  it("is board 5's: Normal, Warmup, then the stage kinds in STAGE_KINDS order", () => {
    expect(SET_TYPE_OPTIONS.map((option) => option.id)).toEqual(['normal', 'warmup', ...STAGE_KINDS])
    expect(SET_TYPE_OPTIONS.map((option) => option.name)).toEqual(['Normal', 'Warmup', 'Dropset', 'Rest-pause', 'Myo-reps', 'Cluster'])
  })

  it('gives each staged kind its stepper label and the two plain types none', () => {
    expect(SET_TYPE_OPTIONS.map((option) => option.stageLabel)).toEqual([null, null, 'DROPS', 'PAUSES', 'MINI-SETS', 'CLUSTERS'])
  })

  it('offers all six by default and only the allowed ones otherwise (G55: a warmup row)', () => {
    expect(setTypeOptionsFor()).toHaveLength(6)
    expect(setTypeOptionsFor(['normal', 'warmup']).map((option) => option.id)).toEqual(['normal', 'warmup'])
    // the allowed list never reorders the board's list
    expect(setTypeOptionsFor(['cluster', 'normal']).map((option) => option.id)).toEqual(['normal', 'cluster'])
  })
})

describe('applySetType: what picking a row does', () => {
  it('Warmup from a dropset with 2 drops is a warmup with no stages', () => {
    expect(applySetType(staged('dropset', 2), 'warmup')).toEqual({ kind: 'warmup' })
  })

  it('Normal from a staged set drops the stages', () => {
    expect(applySetType(staged('myo_reps', 3, 30), 'normal')).toEqual({ kind: 'normal' })
  })

  it('a staged kind from Normal starts at one stage on the kind\'s own rest', () => {
    expect(applySetType({ kind: 'normal' }, 'dropset')).toEqual({ kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })
    expect(applySetType({ kind: 'normal' }, 'cluster')).toEqual({ kind: 'staged', stageKind: 'cluster', stageCount: 1, stageRestSeconds: null })
  })

  it('a staged kind from a warmup starts at one stage too', () => {
    expect(applySetType({ kind: 'warmup' }, 'rest_pause')).toEqual({ kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: null })
  })

  it('Cluster from a dropset with 3 drops keeps the 3', () => {
    expect(applySetType(staged('dropset', 3), 'cluster')).toEqual(staged('cluster', 3))
  })

  it("keeps a set's own rest between stages when the kind changes (the old STAGE KIND chip didn't touch it either)", () => {
    expect(applySetType(staged('dropset', 2, 45), 'myo_reps')).toEqual(staged('myo_reps', 2, 45))
  })

  it('picking the kind already picked changes nothing', () => {
    const current = staged('dropset', 2, 45)
    expect(applySetType(current, 'dropset')).toBe(current)
    expect(sameSetType(applySetType(current, 'dropset'), current)).toBe(true)
  })

  it('names the row a value is: its stage kind when staged', () => {
    const ids: SetTypeId[] = [setTypeId({ kind: 'normal' }), setTypeId({ kind: 'warmup' }), ...STAGE_KINDS.map((kind) => setTypeId(staged(kind, 1)))]
    expect(ids).toEqual(['normal', 'warmup', ...STAGE_KINDS])
  })

  it('sameSetType compares kind, stage kind, count and rest', () => {
    expect(sameSetType({ kind: 'normal' }, { kind: 'normal' })).toBe(true)
    expect(sameSetType({ kind: 'normal' }, { kind: 'warmup' })).toBe(false)
    expect(sameSetType(staged('dropset', 2), staged('dropset', 2))).toBe(true)
    expect(sameSetType(staged('dropset', 2), staged('dropset', 3))).toBe(false)
    expect(sameSetType(staged('dropset', 2), staged('cluster', 2))).toBe(false)
    expect(sameSetType(staged('dropset', 2), staged('dropset', 2, 30))).toBe(false)
    expect(sameSetType(staged('dropset', 2), { kind: 'normal' })).toBe(false)
  })
})

describe('the stage stepper', () => {
  it('adds and removes one stage a tap', () => {
    expect(stepStageCount(staged('dropset', 1), 1)).toEqual(staged('dropset', 2))
    expect(stepStageCount(staged('dropset', 3), -1)).toEqual(staged('dropset', 2))
  })

  it('never goes below one stage (the way back to none is Normal) and stops at the top', () => {
    const one = staged('dropset', STAGE_COUNT_MIN)
    expect(stepStageCount(one, -1)).toBe(one)
    const top = staged('dropset', STAGE_COUNT_MAX)
    expect(stepStageCount(top, 1)).toBe(top)
    expect(stepStageCount(staged('dropset', STAGE_COUNT_MAX - 1), 1)).toEqual(top)
  })

  it('leaves a count above the top alone but lets it come down', () => {
    const above = staged('dropset', STAGE_COUNT_MAX + 2)
    expect(stepStageCount(above, 1)).toBe(above)
    expect(stepStageCount(above, -1)).toEqual(staged('dropset', STAGE_COUNT_MAX + 1))
  })

  it('does nothing to a set with no stages', () => {
    const normal: SetType = { kind: 'normal' }
    const warmup: SetType = { kind: 'warmup' }
    expect(stepStageCount(normal, 1)).toBe(normal)
    expect(stepStageCount(warmup, 1)).toBe(warmup)
  })
})

describe('rest steppers', () => {
  it('+ from the default goes one step past what the default amounts to; - back to it returns the default', () => {
    expect(stepRest(null, 1)).toBe(15)
    expect(stepRest(15, -1)).toBeNull()
    expect(stepRest(30, -1)).toBe(15)
    expect(stepRest(null, 1, 15)).toBe(30)
    expect(stepRest(30, -1, 15)).toBeNull()
  })

  it('- on the default is a no-op, and never produces a rest of zero seconds (only null means no timer)', () => {
    expect(stepRest(null, -1)).toBeNull()
    expect(stepRest(null, -1, 15)).toBeNull()
    for (const base of [0, 15]) {
      let value: number | null = null
      for (let taps = 0; taps < 60; taps++) {
        value = stepRest(value, 1, base)
        expect(value === null || value > base).toBe(true)
      }
      for (let taps = 0; taps < 60; taps++) {
        value = stepRest(value, -1, base)
        expect(value === null || value > base).toBe(true)
      }
      expect(value).toBeNull()
    }
  })

  it('stops at 10 minutes and leaves a value above that alone', () => {
    expect(stepRest(REST_MAX_SECONDS - 5, 1)).toBe(REST_MAX_SECONDS)
    expect(stepRest(REST_MAX_SECONDS, 1)).toBe(REST_MAX_SECONDS)
    expect(stepRest(REST_MAX_SECONDS + 100, 1)).toBe(REST_MAX_SECONDS + 100)
    expect(stepRest(REST_MAX_SECONDS + 100, -1)).toBe(REST_MAX_SECONDS + 85)
  })

  it('REST BETWEEN starts from the kind: a dropset has no timer, the others 15 s', () => {
    expect(DEFAULT_STAGE_REST_SECONDS.dropset).toBeNull()
    expect(stepStageRest(staged('dropset', 1), 1)).toEqual(staged('dropset', 1, 15))
    expect(stepStageRest(staged('cluster', 1), 1)).toEqual(staged('cluster', 1, 30))
    expect(stepStageRest(staged('dropset', 1, 15), -1)).toEqual(staged('dropset', 1, null))
    expect(stepStageRest(staged('cluster', 1, 30), -1)).toEqual(staged('cluster', 1, null))
  })

  it('REST BETWEEN on the default has nowhere lower to go, and a plain set has none', () => {
    const dropset = staged('dropset', 1)
    const pause = staged('rest_pause', 1)
    expect(stepStageRest(dropset, -1)).toBe(dropset)
    expect(stepStageRest(pause, -1)).toBe(pause)
    const normal: SetType = { kind: 'normal' }
    expect(stepStageRest(normal, 1)).toBe(normal)
  })

  it('reads m:ss, DEFAULT for a rest after with none of its own, and the kind\'s default under REST BETWEEN', () => {
    expect(formatRestClock(15)).toBe('0:15')
    expect(formatRestClock(120)).toBe('2:00')
    expect(formatRestClock(90)).toBe('1:30')
    expect(formatRestClock(600)).toBe('10:00')
    expect(restAfterText(null)).toBe('DEFAULT')
    expect(restAfterText(105)).toBe('1:45')
    expect(stageRestText('dropset', null)).toBe('NO TIMER')
    expect(stageRestText('rest_pause', null)).toBe('0:15')
    expect(stageRestText('myo_reps', null)).toBe('0:15')
    expect(stageRestText('cluster', null)).toBe('0:15')
    expect(stageRestText('dropset', 45)).toBe('0:45')
  })
})

describe('which rows each variant shows (SPEC "Rest [1.2]", "Set types and staged sets [1.2]")', () => {
  const none = { restBetween: false, restAfter: false, cues: false, remove: false, workoutNote: false }

  it('Plan, week-dependent: the rest rows only for a set with a program set of its own exercise, Cues and REMOVE THIS SET', () => {
    expect(setTypePickerRows('plan-week-dependent', { canEditRest: true })).toEqual({ ...none, restBetween: true, restAfter: true, cues: true, remove: true })
    expect(setTypePickerRows('plan-week-dependent', { canEditRest: false })).toEqual({ ...none, cues: true, remove: true })
  })

  it('Plan, stable: no REST BETWEEN and no rest row whatever the caller says', () => {
    for (const canEditRest of [true, false]) {
      expect(setTypePickerRows('plan-stable', { canEditRest })).toEqual({ ...none, cues: true, remove: true })
    }
  })

  it('the stepped planner and CHANGE THE PROGRAM: REST BETWEEN and REMOVE THIS SET, no rest after, no Cues', () => {
    for (const context of ['planner', 'change-program'] as const) {
      for (const canEditRest of [true, false]) {
        expect(setTypePickerRows(context, { canEditRest })).toEqual({ ...none, restBetween: true, remove: true })
      }
    }
  })

  it('the workout: the line "Changes this workout only" and nothing else', () => {
    for (const canEditRest of [true, false]) {
      expect(setTypePickerRows('workout', { canEditRest })).toEqual({ ...none, workoutNote: true })
    }
  })

  it('names every context once', () => {
    const contexts: SetTypePickerContext[] = ['plan-week-dependent', 'plan-stable', 'planner', 'change-program', 'workout']
    const shapes = new Set(contexts.map((context) => JSON.stringify(setTypePickerRows(context, { canEditRest: true }))))
    // planner and change-program draw the same rows; the other three differ
    expect(shapes.size).toBe(4)
  })
})

describe('the line above a title', () => {
  it('reads [EXERCISE] · SET NN · WEEK N in Plan, CYCLE N on a sequence program', () => {
    const parts = { exerciseName: 'Lat Pulldown', setNumber: 3, weekNumber: 2 }
    expect(setTypeEyebrow('plan-week-dependent', parts)).toBe('Lat Pulldown · SET 03 · WEEK 2')
    expect(setTypeEyebrow('plan-stable', parts)).toBe('Lat Pulldown · SET 03 · WEEK 2')
    expect(setTypeEyebrow('plan-week-dependent', { ...parts, isCycle: true })).toBe('Lat Pulldown · SET 03 · CYCLE 2')
  })

  it('says THIS WORKOUT in the workout and names no week in the planner or CHANGE THE PROGRAM, whatever week is passed', () => {
    const parts = { exerciseName: 'Lat Pulldown', setNumber: 3, weekNumber: 2 }
    expect(setTypeEyebrow('workout', parts)).toBe('Lat Pulldown · SET 03 · THIS WORKOUT')
    expect(setTypeEyebrow('planner', parts)).toBe('Lat Pulldown · SET 03')
    expect(setTypeEyebrow('change-program', parts)).toBe('Lat Pulldown · SET 03')
  })

  it('pads the set number to two digits and leaves out a tail that is not given', () => {
    expect(pickerEyebrow({ exerciseName: 'Row', setNumber: 12 })).toBe('Row · SET 12')
    expect(pickerEyebrow({ exerciseName: 'Row', setNumber: 1, tail: periodTail(4) })).toBe('Row · SET 01 · WEEK 4')
    expect(periodTail(undefined)).toBeUndefined()
  })
})

describe('the RIR target', () => {
  it('rirRange(2, 2) and rirRange(3, 2) are numbers: a range whose ends meet (or cross) is a number', () => {
    expect(rirRange(2, 2)).toEqual({ kind: 'number', value: 2 })
    expect(rirRange(3, 2)).toEqual({ kind: 'number', value: 3 })
  })

  it('rirRange(1, 2) is a range', () => {
    expect(rirRange(1, 2)).toEqual({ kind: 'range', min: 1, max: 2 })
  })

  it('values go well beyond 5: 12 is accepted, in a number and as a range end', () => {
    expect(rirRange(10, 12)).toEqual({ kind: 'range', min: 10, max: 12 })
    expect(RIR_BOUNDS.max).toBeGreaterThanOrEqual(12)
    const draft: TargetDraft = { mode: 'number', number: 11, from: 11, to: 12 }
    expect(stepTargetField(draft, 'number', 1, 'rir').number).toBe(12)
    expect(rirTargetFromDraft({ ...draft, number: 12 })).toEqual({ kind: 'number', value: 12 })
  })

  it('NONE is none', () => {
    expect(rirTargetFromDraft({ mode: 'none', number: 2, from: 1, to: 2 })).toEqual({ kind: 'none' })
    expect(rirTargetFromColumns(null, null)).toEqual({ kind: 'none' })
    expect(rirTargetToColumns({ kind: 'none' })).toEqual({ targetRir: null, targetRirMax: null })
  })

  it('maps to and from target_rir / target_rir_max (a number keeps the max null; ends that meet are a number)', () => {
    expect(rirTargetFromColumns(2, null)).toEqual({ kind: 'number', value: 2 })
    expect(rirTargetFromColumns(2, undefined)).toEqual({ kind: 'number', value: 2 })
    expect(rirTargetFromColumns(1, 2)).toEqual({ kind: 'range', min: 1, max: 2 })
    expect(rirTargetFromColumns(2, 2)).toEqual({ kind: 'number', value: 2 })
    // a max with no low end isn't a state the table allows; it reads as no target
    expect(rirTargetFromColumns(null, 3)).toEqual({ kind: 'none' })
    expect(rirTargetToColumns({ kind: 'number', value: 2 })).toEqual({ targetRir: 2, targetRirMax: null })
    expect(rirTargetToColumns(rirRange(1, 3))).toEqual({ targetRir: 1, targetRirMax: 3 })
    for (const [low, high] of [[0, 0], [0, 1], [1, 2], [2, null], [null, null], [5, 9]] as const) {
      const target = rirTargetFromColumns(low, high)
      const back = rirTargetToColumns(target)
      expect(rirTargetFromColumns(back.targetRir, back.targetRirMax)).toEqual(target)
    }
  })

  it('cannot be built wrong (these lines compile only because the errors they expect are real)', () => {
    // @ts-expect-error a warmup carries no stage count
    const warmupWithStages: SetType = { kind: 'warmup', stageCount: 1 }
    // @ts-expect-error a normal set carries no stage kind
    const normalWithStageKind: SetType = { kind: 'normal', stageKind: 'dropset' }
    // @ts-expect-error a staged set needs its count
    const stagedWithoutCount: SetType = { kind: 'staged', stageKind: 'dropset', stageRestSeconds: null }
    // @ts-expect-error a range literal built outside rirRange
    const literalRange: RirTarget = { kind: 'range', min: 1, max: 2 }
    // @ts-expect-error a range that ends before it begins, built outside rirRange
    const backwardsRange: RirTarget = { kind: 'range', min: 3, max: 2 }
    expect([warmupWithStages, normalWithStageKind, stagedWithoutCount, literalRange, backwardsRange]).toHaveLength(5)
  })

  it('a SetType is assignable to what a session set change stores (types/index.ts SessionSetChangeType)', () => {
    const asChangeType = (type: SetType): SessionSetChangeType => type
    const type = staged('dropset', 2, 30)
    expect(asChangeType(type)).toBe(type)
  })
})

describe('the numbers behind the boxes', () => {
  const repDraft = (mode: TargetDraft['mode'], number = 8, from = 8, to = 10): TargetDraft => ({ mode, number, from, to })

  it("opens on the set's own target", () => {
    expect(draftFromRepTarget({ type: 'range', min: 8, max: 10 })).toEqual(repDraft('range', 8, 8, 10))
    expect(draftFromRepTarget({ type: 'number', value: 12 })).toMatchObject({ mode: 'number', number: 12 })
    expect(draftFromRepTarget({ type: 'amrap' }).mode).toBe('amrap')
    expect(draftFromRepTarget({ type: 'none' }).mode).toBe('none')
    expect(draftFromRirTarget(rirRange(1, 2))).toEqual({ mode: 'range', number: 1, from: 1, to: 2 })
    expect(draftFromRirTarget({ kind: 'number', value: 3 })).toMatchObject({ mode: 'number', number: 3 })
    expect(draftFromRirTarget({ kind: 'none' }).mode).toBe('none')
  })

  it("starts from the boards' own examples when there is nothing to start from", () => {
    expect(draftFromRepTarget({ type: 'none' })).toEqual({ mode: 'none', number: 8, from: 8, to: 10 })
    expect(draftFromRirTarget({ kind: 'none' })).toEqual({ mode: 'none', number: 2, from: 1, to: 2 })
  })

  it('shows a stored value past the bounds as it is: only the steppers are bounded', () => {
    expect(draftFromRepTarget({ type: 'number', value: 120 })).toMatchObject({ mode: 'number', number: 120 })
  })

  it('NUMBER takes the number, or the FROM box when it comes from a range; RANGE grows a number into a range', () => {
    expect(pickTargetMode(repDraft('range', 8, 6, 9), 'number', 'reps')).toMatchObject({ mode: 'number', number: 6 })
    expect(pickTargetMode(repDraft('none', 12, 8, 10), 'number', 'reps')).toMatchObject({ mode: 'number', number: 12 })
    expect(pickTargetMode(repDraft('number', 12, 12, 14), 'range', 'reps')).toMatchObject({ mode: 'range', from: 12, to: 14 })
    expect(pickTargetMode({ mode: 'number', number: 2, from: 2, to: 3 }, 'range', 'rir')).toMatchObject({ mode: 'range', from: 2, to: 3 })
  })

  it('a segment tapped away and back finds its numbers where they were', () => {
    const range = repDraft('range', 8, 6, 9)
    expect(pickTargetMode(pickTargetMode(range, 'none', 'reps'), 'range', 'reps')).toEqual(range)
    expect(pickTargetMode(pickTargetMode(range, 'amrap', 'reps'), 'range', 'reps')).toEqual(range)
  })

  it('the RIR picker has no AMRAP segment and refuses it', () => {
    expect(TARGET_MODES.reps.map((mode) => mode.id)).toEqual(['none', 'number', 'range', 'amrap'])
    expect(TARGET_MODES.rir.map((mode) => mode.id)).toEqual(['none', 'number', 'range'])
    const draft = repDraft('range')
    expect(pickTargetMode(draft, 'amrap', 'rir')).toBe(draft)
  })

  it('a range grown from a number at the top of the bounds stays inside them', () => {
    const grown = pickTargetMode({ mode: 'number', number: RIR_BOUNDS.max, from: 0, to: 1 }, 'range', 'rir')
    expect(grown.to).toBe(RIR_BOUNDS.max)
    expect(grown.from).toBeLessThanOrEqual(grown.to)
  })

  it('steps one a tap inside the bounds: reps 1-100, RIR 0-20', () => {
    expect(REP_BOUNDS).toEqual({ min: 1, max: 100 })
    expect(RIR_BOUNDS).toEqual({ min: 0, max: 20 })
    const reps = (number: number): TargetDraft => ({ mode: 'number', number, from: number, to: number })
    expect(stepTargetField(reps(8), 'number', 1, 'reps').number).toBe(9)
    expect(stepTargetField(reps(8), 'number', -1, 'reps').number).toBe(7)
    const lowest = reps(REP_BOUNDS.min)
    expect(stepTargetField(lowest, 'number', -1, 'reps')).toBe(lowest)
    const highest = reps(REP_BOUNDS.max)
    expect(stepTargetField(highest, 'number', 1, 'reps')).toBe(highest)
    const zero = reps(0)
    expect(stepTargetField(zero, 'number', -1, 'rir')).toBe(zero)
    expect(stepTargetField(zero, 'number', 1, 'rir').number).toBe(1)
    const top = reps(RIR_BOUNDS.max)
    expect(stepTargetField(top, 'number', 1, 'rir')).toBe(top)
  })

  it('RIR 0 is a target that is there: reps stop at 1 but RIR goes down to 0', () => {
    const one: TargetDraft = { mode: 'number', number: 1, from: 1, to: 2 }
    expect(stepTargetField(one, 'number', -1, 'reps')).toBe(one)
    expect(stepTargetField(one, 'number', -1, 'rir').number).toBe(0)
  })

  it('FROM never passes TO and TO never goes below FROM', () => {
    const range: TargetDraft = { mode: 'range', number: 8, from: 8, to: 10 }
    expect(stepTargetField(range, 'from', 1, 'reps').from).toBe(9)
    const meeting: TargetDraft = { ...range, from: 10 }
    expect(stepTargetField(meeting, 'from', 1, 'reps')).toBe(meeting)
    expect(stepTargetField(meeting, 'to', -1, 'reps')).toBe(meeting)
    expect(stepTargetField(range, 'to', -1, 'reps').to).toBe(9)
    expect(stepTargetField(range, 'to', 1, 'reps').to).toBe(11)
    const lowFrom: TargetDraft = { ...range, from: 1 }
    expect(stepTargetField(lowFrom, 'from', -1, 'reps')).toBe(lowFrom)
  })

  it('builds the target the footer button sets: NONE clears, a range whose ends meet is a number', () => {
    expect(repTargetFromDraft(repDraft('none'))).toEqual({ type: 'none' })
    expect(repTargetFromDraft(repDraft('amrap'))).toEqual({ type: 'amrap' })
    expect(repTargetFromDraft(repDraft('number', 12))).toEqual({ type: 'number', value: 12 })
    expect(repTargetFromDraft(repDraft('range', 8, 8, 10))).toEqual({ type: 'range', min: 8, max: 10 })
    expect(repTargetFromDraft(repDraft('range', 8, 10, 10))).toEqual({ type: 'number', value: 10 })
    expect(repRange(9, 8)).toEqual({ type: 'number', value: 9 })
    expect(rirTargetFromDraft({ mode: 'range', number: 1, from: 1, to: 2 })).toEqual({ kind: 'range', min: 1, max: 2 })
    expect(rirTargetFromDraft({ mode: 'range', number: 1, from: 2, to: 2 })).toEqual({ kind: 'number', value: 2 })
    expect(rirTargetFromDraft({ mode: 'number', number: 0, from: 0, to: 1 })).toEqual({ kind: 'number', value: 0 })
  })
})

describe('the footer button says what it will set', () => {
  it('reps: SET 8–10 REPS, SET 12 REPS, SET 1 REP, SET AMRAP, CLEAR TARGET', () => {
    expect(repTargetSummary({ type: 'range', min: 8, max: 10 })).toBe('SET 8–10 REPS')
    expect(repTargetSummary({ type: 'number', value: 12 })).toBe('SET 12 REPS')
    expect(repTargetSummary({ type: 'number', value: 1 })).toBe('SET 1 REP')
    expect(repTargetSummary({ type: 'amrap' })).toBe('SET AMRAP')
    expect(repTargetSummary({ type: 'none' })).toBe('CLEAR TARGET')
  })

  it('RIR: SET RIR 1–2, SET RIR 2, SET RIR 0, CLEAR TARGET', () => {
    expect(rirTargetSummary(rirRange(1, 2))).toBe('SET RIR 1–2')
    expect(rirTargetSummary({ kind: 'number', value: 2 })).toBe('SET RIR 2')
    expect(rirTargetSummary({ kind: 'number', value: 0 })).toBe('SET RIR 0')
    expect(rirTargetSummary({ kind: 'none' })).toBe('CLEAR TARGET')
  })
})

describe('"Use for all N sets of [exercise]"', () => {
  const heads: TargetableSet[] = [
    { id: 'w1', isWarmup: true },
    { id: 's1', isWarmup: false },
    { id: 's2', isWarmup: false },
    { id: 's3', isWarmup: false },
  ]

  it('a RIR target skips a warmup head (G49)', () => {
    expect(applyToAllTargets(heads, rirRange(1, 2), 'rir').map((write) => write.id)).toEqual(['s1', 's2', 's3'])
    expect(countApplyToAll(heads, 'rir')).toBe(3)
  })

  it('a rep target goes to every head, a warmup included', () => {
    expect(applyToAllTargets<RepTarget>(heads, { type: 'amrap' }, 'reps').map((write) => write.id)).toEqual(['w1', 's1', 's2', 's3'])
    expect(countApplyToAll(heads, 'reps')).toBe(4)
  })

  it('writes the one value to each, in the order given', () => {
    const value: RepTarget = { type: 'range', min: 8, max: 10 }
    expect(applyToAllTargets(heads, value, 'reps')).toEqual([
      { id: 'w1', value },
      { id: 's1', value },
      { id: 's2', value },
      { id: 's3', value },
    ])
    expect(applyToAllTargets([], value, 'reps')).toEqual([])
  })

  it('reads "Use for all 3 sets of Lat Pulldown"', () => {
    expect(useForAllLabel(3, 'Lat Pulldown')).toBe('Use for all 3 sets of Lat Pulldown')
  })
})

describe('the Cues row\'s second line', () => {
  it('shows the cues with a capital first letter, joined by commas, and nothing for none', () => {
    expect(cuesSummary(['push here'])).toBe('Push here')
    expect(cuesSummary(['push here', 'focus on execution'])).toBe('Push here, Focus on execution')
    expect(cuesSummary([])).toBe('')
    expect(cuesSummary(['  ', ''])).toBe('')
  })
})

describe("wording: every string here is on the board it comes from", () => {
  const setKind = board('SetKindPicker.dc.html')
  const rep = board('RepTargetPicker.dc.html')
  const rir = board('RirTargetPicker.dc.html')

  it("board 5's list: names, descriptions and stepper labels", () => {
    for (const option of SET_TYPE_OPTIONS) {
      expect(setKind).toContain(`name: '${option.name}'`)
      expect(setKind).toContain(`desc: '${option.description}'`)
      if (option.stageLabel !== null) expect(setKind).toContain(`stageLabel: '${option.stageLabel}'`)
    }
  })

  it("board 5's other rows and the workout's line", () => {
    expect(setKind).toContain(SET_TYPE_TEXT.title)
    expect(setKind).toContain(`>${SET_TYPE_TEXT.restBetween}<`)
    expect(setKind).toContain(`>${SET_TYPE_TEXT.restAfter}<`)
    expect(setKind).toContain(SET_TYPE_TEXT.restAfterNote)
    expect(setKind).toContain(`>${SET_TYPE_TEXT.cues}<`)
    expect(setKind).toContain(`>${SET_TYPE_TEXT.remove}<`)
    expect(setKind).toContain(`>${SET_TYPE_TEXT.workoutNote}<`)
    expect(setKind).toContain(`>${SET_TYPE_TEXT.defaultRest}<`)
    expect(setKind).toContain(`'${SET_TYPE_TEXT.noTimer}'`)
    // REST BETWEEN's default for the kinds that have one, as the board's own sample reads it
    expect(setKind).toContain(`'${stageRestText('rest_pause', null)}'`)
  })

  it("the three eyebrows of board 5 (Plan, planner, workout) are what the pickers build", () => {
    const plan = setTypeEyebrow('plan-week-dependent', { exerciseName: 'Lat Pulldown', setNumber: 3, weekNumber: 2 })
    const planner = setTypeEyebrow('planner', { exerciseName: 'Incline Dumbbell Press', setNumber: 4 })
    const workout = setTypeEyebrow('workout', { exerciseName: 'Lat Pulldown', setNumber: 3 })
    expect(setKind).toContain(`'${plan.toUpperCase()}'`)
    expect(setKind).toContain(`'${planner.toUpperCase()}'`)
    expect(setKind).toContain(`'${workout.toUpperCase()}'`)
  })

  it("board 6's texts, segments and footer buttons", () => {
    expect(rep).toContain(`>${REP_TARGET_TEXT.title}<`)
    expect(rep).toContain(`>${REP_TARGET_TEXT.numberLabel}<`)
    expect(rep).toContain(`>${REP_TARGET_TEXT.from}<`)
    expect(rep).toContain(`>${REP_TARGET_TEXT.to}<`)
    expect(rep).toContain(`>${REP_TARGET_TEXT.none}<`)
    expect(rep).toContain(`>${REP_TARGET_TEXT.amrap}<`)
    expect(rep).toContain(`>${REP_TARGET_TEXT.amrapNote}<`)
    for (const mode of TARGET_MODES.reps) expect(rep).toContain(`'${mode.label}'`)
    expect(rep).toContain(`'${repTargetSummary({ type: 'none' })}'`)
    expect(rep).toContain(`'${repTargetSummary({ type: 'number', value: 8 })}'`)
    expect(rep).toContain(`'${repTargetSummary({ type: 'range', min: 8, max: 10 })}'`)
    expect(rep).toContain(`'${repTargetSummary({ type: 'amrap' })}'`)
    expect(rep).toContain(useForAllLabel(3, 'Lat Pulldown'))
    expect(rep).toContain(useForAllLabel(4, 'Incline Dumbbell Press'))
    expect(rep).toContain(`'${pickerEyebrow({ exerciseName: 'Lat Pulldown', setNumber: 1, tail: periodTail(2) }).toUpperCase()}'`)
    expect(rep).toContain(`'${pickerEyebrow({ exerciseName: 'Incline Dumbbell Press', setNumber: 2 }).toUpperCase()}'`)
  })

  it("board 7's texts, segments and footer buttons", () => {
    expect(rir).toContain(`>${RIR_TARGET_TEXT.title}<`)
    expect(rir).toContain(`>${RIR_TARGET_TEXT.numberLabel}<`)
    expect(rir).toContain(`>${RIR_TARGET_TEXT.from}<`)
    expect(rir).toContain(`>${RIR_TARGET_TEXT.to}<`)
    expect(rir).toContain(`>${RIR_TARGET_TEXT.none}<`)
    expect(rir).toContain(`>${RIR_TARGET_TEXT.rangeNote}<`)
    for (const mode of TARGET_MODES.rir) expect(rir).toContain(`'${mode.label}'`)
    expect(rir).toContain(`'${rirTargetSummary({ kind: 'none' })}'`)
    expect(rir).toContain(`'${rirTargetSummary({ kind: 'number', value: 2 })}'`)
    expect(rir).toContain(`'${rirTargetSummary(rirRange(1, 2))}'`)
    expect(rir).toContain(useForAllLabel(3, 'Seated Cable Row'))
    expect(rir).toContain(`${pickerEyebrow({ exerciseName: 'Seated Cable Row', setNumber: 1, tail: periodTail(2) }).toUpperCase()}`)
  })

  it("the boards' aria-labels for the steppers are the ones the pickers use", () => {
    expect(setKind).toContain('aria-label="Rest between: less"')
    expect(setKind).toContain('aria-label="Rest after this set: less"')
    expect(rep).toContain('aria-label="Fewer reps"')
    expect(rep).toContain('aria-label="From: fewer"')
    expect(rep).toContain('aria-label="To: more"')
    expect(rir).toContain('aria-label="Less RIR"')
    expect(rir).toContain('aria-label="From: fewer"')
  })
})

describe('what the pickers import and what they draw', () => {
  const files = readdirSync(here).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name))

  it('has the files this chunk makes, and reads them all', () => {
    expect(files).toEqual(
      expect.arrayContaining(['SetTypePicker.tsx', 'RepTargetPicker.tsx', 'RirTargetPicker.tsx', 'TargetPickerSheet.tsx', 'pickerLogic.ts', 'pickerControls.tsx', 'index.ts']),
    )
  })

  it('no picker imports anything from src/features (a picker is a shared component, not a screen)', () => {
    for (const name of files) {
      const source = readFileSync(join(here, name), 'utf8')
      const imports = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
      for (const path of imports) expect(path, `${name} imports ${path}`).not.toMatch(/features/)
    }
  })

  it('writes no colour literal of its own (hex, rgb, hsl): every colour is a custom property', () => {
    for (const name of files) {
      const source = readFileSync(join(here, name), 'utf8')
      expect(source.match(/#[0-9a-fA-F]{3,8}\b/g), `${name} has a hex colour`).toBeNull()
      expect(source.match(/\b(?:rgb|rgba|hsl|hsla)\(/g), `${name} has a colour function`).toBeNull()
    }
  })
})
