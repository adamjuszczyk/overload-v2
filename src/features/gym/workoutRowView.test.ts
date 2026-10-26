import { describe, it, expect } from 'vitest'
import type { ResolvedRow } from './workoutRules'
import {
  formatClock, jumpLabelText, lastLineText, loggedText, repTargetText, rirTargetText, rowDefaults, rowLabelText, stageChipText,
  stageKindWord, stageLock, targetsText,
} from './workoutRowView'

// Chunk 58a — what the rows say (SPEC [1.2] "What a row shows (C3)"; DECISIONS 162 (a)).
const target = (over: Record<string, unknown> = {}) => ({ targetWeight: null, repMin: null, repMax: null, isAmrap: false, targetRir: null, targetRirMax: null, ...over })

describe('rowDefaults — an untouched row holds the plan\'s targets (DECISIONS 162 (a), Adam 2026-10-16)', () => {
  it('a number target and a planned weight are the values of the boxes, in the exercise\'s unit', () => {
    expect(rowDefaults(target({ targetWeight: 102.06, repMin: 8, repMax: 8 }), 'lbs')).toMatchObject({ weight: '225', reps: '8', repsHint: '' })
    expect(rowDefaults(target({ targetWeight: 52.5, repMin: 8, repMax: 8 }), 'kg')).toMatchObject({ weight: '52.5', reps: '8' })
  })

  it('a range is a placeholder, not a value: LOG needs reps typed ("8–10")', () => {
    expect(rowDefaults(target({ repMin: 8, repMax: 10 }), 'kg')).toMatchObject({ reps: '', repsHint: '8–10' })
  })

  it('AMRAP is a placeholder too', () => {
    expect(rowDefaults(target({ isAmrap: true }), 'kg')).toMatchObject({ reps: '', repsHint: 'AMRAP' })
  })

  it('with no planned weight the weight box is empty (LOG needs it), and with no rep target so is the reps box, with no hint', () => {
    expect(rowDefaults(target(), 'kg')).toEqual({ weight: '', reps: '', repsHint: '', rirHint: '' })
    expect(rowDefaults(null, 'kg')).toEqual({ weight: '', reps: '', repsHint: '', rirHint: '' })
  })

  it('the planned RIR is a placeholder, a range as "1–2" (high end read from target_rir_max)', () => {
    expect(rowDefaults(target({ targetRir: 1 }), 'kg').rirHint).toBe('1')
    expect(rowDefaults(target({ targetRir: 1, targetRirMax: 2 }), 'kg').rirHint).toBe('1–2')
    expect(rirTargetText({ targetRir: 0, targetRirMax: null })).toBe('0')
    expect(rirTargetText({ targetRir: 2, targetRirMax: 2 })).toBe('2')
    expect(rirTargetText({ targetRir: null, targetRirMax: null })).toBe('')
  })
})

describe('what an upcoming, logged and LAST line say', () => {
  it('a row that shows targets only (a locked drop) says "52.5 kg × 8–10 @ RIR 1–2", leaving out what the plan doesn\'t give', () => {
    expect(targetsText(target({ targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1, targetRirMax: 2 }), 'kg')).toBe('52.5 kg × 8–10 @ RIR 1–2')
    expect(targetsText(target({ repMin: 12, repMax: 12 }), 'kg')).toBe('12')
    expect(targetsText(target({ targetRir: 2 }), 'kg')).toBe('@ RIR 2')
    expect(targetsText(null, 'kg')).toBe('')
  })

  it('a logged row: the weight in the unit it was logged in, the reps and the RIR achieved', () => {
    expect(loggedText({ weight: 55, reps: 9, rir: 2, enteredUnit: null }, 'kg')).toEqual({ weight: '55', unit: 'kg', reps: '9', rir: '@ RIR 2' })
    expect(loggedText({ weight: 100, reps: 5, rir: null, enteredUnit: 'lbs' }, 'kg')).toMatchObject({ unit: 'lbs', rir: '' })
    expect(loggedText({ weight: null, reps: null, rir: null, enteredUnit: null }, 'kg')).toMatchObject({ weight: '—', reps: '—' })
  })

  it('the LAST line is last time\'s set at the place: "52.5 × 10 @ 1", empty without a weight and reps', () => {
    expect(lastLineText({ weight: 52.5, reps: 10, rir: 1, enteredUnit: null }, 'kg')).toBe('52.5 × 10 @ 1')
    expect(lastLineText({ weight: 60, reps: 12, rir: null, enteredUnit: null }, 'kg')).toBe('60 × 12')
    expect(lastLineText({ weight: null, reps: null, rir: null, enteredUnit: null }, 'kg')).toBe('')
    expect(lastLineText(null, 'kg')).toBe('')
  })

  it('rep targets read as the plan\'s own words', () => {
    expect(repTargetText({ repMin: 8, repMax: 12, isAmrap: false })).toBe('8–12')
    expect(repTargetText({ repMin: 5, repMax: 5, isAmrap: false })).toBe('5')
    expect(repTargetText({ repMin: null, repMax: null, isAmrap: true })).toBe('AMRAP')
    expect(repTargetText({ repMin: null, repMax: null, isAmrap: false })).toBe('')
  })
})

describe('labels', () => {
  const row = (over: Partial<ResolvedRow>): ResolvedRow => ({ kind: 'working', number: 3, block: null, stageKind: null, stageNumber: null, ...over }) as ResolvedRow

  it('the number cell: 03, A2 for a superset member, W for a warmup, ↳ for a drop', () => {
    expect(rowLabelText(row({}))).toBe('03')
    expect(rowLabelText(row({ block: { id: 'b', letter: 'A', round: 2 } }))).toBe('A2')
    expect(rowLabelText(row({ kind: 'warmup' }))).toBe('W')
    expect(rowLabelText(row({ kind: 'stage', stageNumber: 1 }))).toBe('↳')
  })

  it('the jump button\'s words: SET 03, A2, SET 03 DROP 1, SET 01 STAGE 2', () => {
    expect(jumpLabelText(row({}))).toBe('SET 03')
    expect(jumpLabelText(row({ block: { id: 'b', letter: 'B', round: 1 } }))).toBe('B1')
    expect(jumpLabelText(row({ kind: 'stage', stageKind: 'dropset', stageNumber: 1 }))).toBe('SET 03 DROP 1')
    expect(jumpLabelText(row({ number: 1, kind: 'stage', stageKind: 'rest_pause', stageNumber: 2 }))).toBe('SET 01 STAGE 2')
  })

  it('a staged head\'s chip and a logged drop\'s kind word (board W3)', () => {
    expect(stageChipText('dropset', 1)).toBe('DROPSET · 1 DROP')
    expect(stageChipText('dropset', 2)).toBe('DROPSET · 2 DROPS')
    expect(stageChipText('rest_pause', 2)).toBe('REST-PAUSE · 2 STAGES')
    expect(stageKindWord('dropset')).toBe('DROP')
    expect(stageKindWord(null)).toBe('DROP')
    expect(stageKindWord('myo_reps')).toBe('MYO-REPS')
    expect(stageKindWord('cluster')).toBe('CLUSTER')
  })

  it('times as the boards write them (1:12, 0:48, 2:00)', () => {
    expect([formatClock(72), formatClock(48), formatClock(120), formatClock(0), formatClock(-3), formatClock(599.6)]).toEqual(['1:12', '0:48', '2:00', '0:00', '0:00', '10:00'])
  })
})

describe('stageLock — a drop waits until the row before it is logged (board W3)', () => {
  const rows = (headState: 'unlogged' | 'logged', drop1: 'unlogged' | 'logged', kind: ResolvedRow['stageKind'] = 'dropset'): ResolvedRow[] =>
    [
      { key: 'h', kind: 'working', state: headState, number: 3, stageKind: kind, headKey: null, stageNumber: null },
      { key: 'h:1', kind: 'stage', state: drop1, number: 3, stageKind: kind, headKey: 'h', stageNumber: 1 },
      { key: 'h:2', kind: 'stage', state: 'unlogged', number: 3, stageKind: kind, headKey: 'h', stageNumber: 2 },
    ] as ResolvedRow[]

  it('head unlogged: both drops are locked, the first after the set, the second after the drop before it', () => {
    const r = rows('unlogged', 'unlogged')
    expect([stageLock(r[1], r), stageLock(r[2], r)]).toEqual(['AFTER SET 03', 'AFTER DROP 1'])
  })

  it('head logged: the first drop is open, the second still locked', () => {
    const r = rows('logged', 'unlogged')
    expect([stageLock(r[1], r), stageLock(r[2], r)]).toEqual([null, 'AFTER DROP 1'])
  })

  it('both logged: nothing is locked, and a stage of another kind says STAGE', () => {
    const r = rows('logged', 'logged')
    expect([stageLock(r[1], r), stageLock(r[2], r)]).toEqual([null, null])
    const rp = rows('unlogged', 'unlogged', 'rest_pause')
    expect(stageLock(rp[2], rp)).toBe('AFTER STAGE 1')
  })

  it('a head or a logged row is never locked', () => {
    const r = rows('unlogged', 'logged')
    expect(stageLock(r[0], r)).toBeNull()
    expect(stageLock(r[1], r)).toBeNull()
  })
})
