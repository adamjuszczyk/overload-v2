import { describe, it, expect } from 'vitest'
import { DELETE_NOTE, deleteConfirm, loggedNumbersText, optionsEyebrow, plannedNumbersText, typeRowText } from './setOptionsView'
import type { ResolvedRow } from './workoutRules'

// Chunk 61 — what the set ⋯ sheet, the edit panel and W9 say (boards W7, W8, W9), as pure functions.
const row = (over: Partial<ResolvedRow> = {}): Pick<ResolvedRow, 'kind' | 'number' | 'block' | 'stageKind' | 'stageNumber' | 'exerciseName' | 'type'> => ({
  kind: 'working', number: 3, block: null, stageKind: null, stageNumber: null, exerciseName: 'Lat Pulldown', type: { kind: 'normal' }, ...over,
})

describe('optionsEyebrow', () => {
  it('names the exercise and the set the way the boards do', () => {
    expect(optionsEyebrow(row())).toBe('LAT PULLDOWN · SET 03')
    expect(optionsEyebrow(row({ number: 12 }))).toBe('LAT PULLDOWN · SET 12')
  })
  it('a drop adds its own place after its set (W8), "STAGE" for the kinds that are not a dropset', () => {
    expect(optionsEyebrow(row({ kind: 'stage', stageKind: 'dropset', stageNumber: 1 }))).toBe('LAT PULLDOWN · SET 03 · DROP 1')
    expect(optionsEyebrow(row({ kind: 'stage', stageKind: null, stageNumber: 2 }))).toBe('LAT PULLDOWN · SET 03 · DROP 2')
    expect(optionsEyebrow(row({ kind: 'stage', stageKind: 'rest_pause', stageNumber: 1 }))).toBe('LAT PULLDOWN · SET 03 · STAGE 1')
  })
  it('a superset member is its letter and round (board W7b names it so), a warmup is a warmup', () => {
    expect(optionsEyebrow(row({ exerciseName: 'Seated Cable Row', block: { id: 'b', letter: 'A', round: 2 } }))).toBe('SEATED CABLE ROW · A2')
    expect(optionsEyebrow(row({ kind: 'warmup' }))).toBe('LAT PULLDOWN · WARMUP')
  })
})

describe('typeRowText', () => {
  it('Normal, Warmup and the staged kinds with their drops or stages', () => {
    expect(typeRowText({ kind: 'normal' })).toBe('Normal')
    expect(typeRowText(null)).toBe('Normal')
    expect(typeRowText({ kind: 'warmup' })).toBe('Warmup')
    expect(typeRowText({ kind: 'staged', stageKind: 'dropset', stageCount: 1 })).toBe('Dropset · 1 drop')
    expect(typeRowText({ kind: 'staged', stageKind: 'dropset', stageCount: 2 })).toBe('Dropset · 2 drops')
    expect(typeRowText({ kind: 'staged', stageKind: 'rest_pause', stageCount: 2 })).toBe('Rest-pause · 2 stages')
    expect(typeRowText({ kind: 'staged', stageKind: 'myo_reps', stageCount: 1 })).toBe('Myo-reps · 1 stage')
    expect(typeRowText({ kind: 'staged', stageKind: 'cluster', stageCount: 3 })).toBe('Cluster · 3 stages')
  })
})

describe('the numbers W9 says', () => {
  it('the plan\'s, in the exercise\'s unit: weight and reps, a range, AMRAP, either alone, none', () => {
    expect(plannedNumbersText({ targetWeight: 52.5, repMin: 8, repMax: 10, isAmrap: false }, 'kg')).toBe('52.5 kg × 8–10')
    expect(plannedNumbersText({ targetWeight: 9, repMin: 8, repMax: 8, isAmrap: false }, 'lbs')).toBe('19.8 lbs × 8')
    expect(plannedNumbersText({ targetWeight: 40, repMin: null, repMax: null, isAmrap: true }, 'kg')).toBe('40 kg × AMRAP')
    expect(plannedNumbersText({ targetWeight: null, repMin: 8, repMax: 10, isAmrap: false }, 'kg')).toBe('8–10')
    expect(plannedNumbersText({ targetWeight: null, repMin: null, repMax: null, isAmrap: false }, 'kg')).toBe('')
    expect(plannedNumbersText(null, 'kg')).toBe('')
  })
  it('a log\'s, in the unit it was logged in; a skipped set has none', () => {
    expect(loggedNumbersText({ weight: 52.5, reps: 10, enteredUnit: null, isSkipped: false }, 'kg')).toBe('52.5 kg × 10')
    expect(loggedNumbersText({ weight: 9, reps: 8, enteredUnit: 'lbs', isSkipped: false }, 'kg')).toBe('19.8 lbs × 8')
    expect(loggedNumbersText({ weight: null, reps: null, enteredUnit: null, isSkipped: true }, 'kg')).toBe('')
  })
})

describe('deleteConfirm (board W9)', () => {
  it('the board\'s words: "Delete set 03?" and "52.5 kg × 8–10. Only today\'s session changes; the plan stays the same."', () => {
    expect(deleteConfirm(row(), '52.5 kg × 8–10')).toEqual({
      eyebrow: 'LAT PULLDOWN · SET 03',
      title: 'Delete set 03?',
      body: "52.5 kg × 8–10. Only today's session changes; the plan stays the same.",
    })
  })
  it('a set with nothing to say about its numbers (a skipped one) gives the note alone', () => {
    expect(deleteConfirm(row(), '').body).toBe(DELETE_NOTE)
  })
  it('a head says its drops go with it: "and its drop", "and its 2 drops", "stages" for the kinds that are not a dropset', () => {
    const staged = (stageKind: 'dropset' | 'rest_pause', stageCount: number) => row({ type: { kind: 'staged', stageKind, stageCount } })
    expect(deleteConfirm(staged('dropset', 1), '52.5 kg × 10').body).toBe(`52.5 kg × 10 and its drop. ${DELETE_NOTE}`)
    expect(deleteConfirm(staged('dropset', 2), '52.5 kg × 10').body).toBe(`52.5 kg × 10 and its 2 drops. ${DELETE_NOTE}`)
    expect(deleteConfirm(staged('rest_pause', 2), '35 kg × 10').body).toBe(`35 kg × 10 and its 2 stages. ${DELETE_NOTE}`)
    expect(deleteConfirm(staged('dropset', 1), '').body).toBe(`This set and its drop. ${DELETE_NOTE}`)
  })
  it('a drop is not asked about its own drops, and is titled by its place', () => {
    const drop = row({ kind: 'stage', stageKind: 'dropset', stageNumber: 1, type: null })
    expect(deleteConfirm(drop, '40 kg × AMRAP')).toMatchObject({ title: 'Delete set 03 drop 1?', eyebrow: 'LAT PULLDOWN · SET 03 · DROP 1', body: `40 kg × AMRAP. ${DELETE_NOTE}` })
  })
  it('a superset member is named by its letter and round, a warmup is a warmup', () => {
    expect(deleteConfirm(row({ block: { id: 'b', letter: 'A', round: 2 } }), '60 kg × 12').title).toBe('Delete A2?')
    expect(deleteConfirm(row({ kind: 'warmup', type: { kind: 'warmup' } }), '20 kg × 12').title).toBe('Delete warmup?')
  })
})
