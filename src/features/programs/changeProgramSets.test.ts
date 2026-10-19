import { describe, expect, it } from 'vitest'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { DraftSet, DraftStage } from './programChange'
import {
  allText,
  kindText,
  newSetAfter,
  numberSets,
  repTargetOf,
  repText,
  restAfterText,
  setChanged,
  setTypeOf,
  stageChanged,
  withRepTarget,
  withSetType,
} from './changeProgramSets'

// Chunk 51b: the default's sets of one exercise as a stable run's CHANGE THE PROGRAM draws and edits them. Pure. The set type picker
// (chunk 39) speaks `SetType`; a default's set is `isWarmup`, `stageKind` and its stages: these tests pin the one mapping each way.

const stage = (id: string | null, reps?: [number, number] | 'amrap'): DraftStage =>
  reps === 'amrap'
    ? { id, repMin: null, repMax: null, isAmrap: true }
    : { id, repMin: reps?.[0] ?? null, repMax: reps?.[1] ?? null, isAmrap: false }

const set = (id: string | null, over: Partial<DraftSet> = {}): DraftSet => ({
  id,
  isWarmup: false,
  stageKind: null,
  repMin: 8,
  repMax: 10,
  isAmrap: false,
  restSeconds: null,
  stageRestSeconds: null,
  stages: [],
  ...over,
})

describe('a set (or stage) and its rep target', () => {
  it('reads each kind of target the way the picker holds it', () => {
    expect(repTargetOf(set('a', { repMin: 12, repMax: 12 }))).toEqual({ type: 'number', value: 12 })
    expect(repTargetOf(set('a'))).toEqual({ type: 'range', min: 8, max: 10 })
    expect(repTargetOf(set('a', { repMin: null, repMax: null, isAmrap: true }))).toEqual({ type: 'amrap' })
    expect(repTargetOf(set('a', { repMin: null, repMax: null }))).toEqual({ type: 'none' })
    expect(repTargetOf(stage('s', [6, 8]))).toEqual({ type: 'range', min: 6, max: 8 })
  })

  it('writes a target as the three columns, and nothing else of the set changes', () => {
    const base = set('a', { restSeconds: 120, stages: [stage('s1', [6, 8])] })
    const next = withRepTarget(base, { type: 'number', value: 5 })
    expect(next).toEqual({ ...base, repMin: 5, repMax: 5, isAmrap: false })
    expect(withRepTarget(base, { type: 'amrap' })).toMatchObject({ repMin: null, repMax: null, isAmrap: true })
    expect(withRepTarget(base, { type: 'none' })).toMatchObject({ repMin: null, repMax: null, isAmrap: false })
    expect(withRepTarget(base, { type: 'range', min: 10, max: 12 })).toMatchObject({ repMin: 10, repMax: 12, isAmrap: false })
  })

  it('says a range with an en dash, AMRAP, and a dash for no target (the word none is never printed)', () => {
    expect(repText({ type: 'range', min: 8, max: 10 })).toBe('8–10')
    expect(repText({ type: 'number', value: 12 })).toBe('12')
    expect(repText({ type: 'amrap' })).toBe('AMRAP')
    expect(repText({ type: 'none' })).toBe('—')
  })
})

describe('the set type', () => {
  it('reads Normal, Warmup and a staged set (a null kind with stages is a dropset; a kind with no stages is Normal)', () => {
    expect(setTypeOf(set('a'))).toEqual({ kind: 'normal' })
    expect(setTypeOf(set('a', { isWarmup: true }))).toEqual({ kind: 'warmup' })
    expect(setTypeOf(set('a', { stageKind: 'rest_pause', stages: [stage('s1'), stage('s2')], stageRestSeconds: 20 }))).toEqual({
      kind: 'staged',
      stageKind: 'rest_pause',
      stageCount: 2,
      stageRestSeconds: 20,
    })
    expect(setTypeOf(set('a', { stageKind: null, stages: [stage('s1')] }))).toEqual({ kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })
    expect(setTypeOf(set('a', { stageKind: 'cluster', stages: [] }))).toEqual({ kind: 'normal' })
  })

  it('Normal to a staged kind adds its first stage, with no rep target of its own; the set keeps its target and rest', () => {
    const next = withSetType(set('a', { restSeconds: 90 }), { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })
    expect(next).toMatchObject({ isWarmup: false, stageKind: 'dropset', repMin: 8, repMax: 10, restSeconds: 90, stageRestSeconds: null })
    expect(next.stages).toEqual([{ id: null, repMin: null, repMax: null, isAmrap: false }])
  })

  it('another staged kind keeps the stages the set has (ids and targets) and the count', () => {
    const had = set('a', { stageKind: 'dropset', stages: [stage('s1', [6, 8]), stage('s2', 'amrap')] })
    const next = withSetType(had, { kind: 'staged', stageKind: 'myo_reps', stageCount: 2, stageRestSeconds: 15 })
    expect(next.stageKind).toBe('myo_reps')
    expect(next.stageRestSeconds).toBe(15)
    expect(next.stages).toEqual(had.stages)
  })

  it('the count: more adds new stages at the end, fewer drops the last ones', () => {
    const had = set('a', { stageKind: 'dropset', stages: [stage('s1', [6, 8]), stage('s2', [4, 6])] })
    const more = withSetType(had, { kind: 'staged', stageKind: 'dropset', stageCount: 4, stageRestSeconds: null })
    expect(more.stages.map((s) => s.id)).toEqual(['s1', 's2', null, null])
    const fewer = withSetType(had, { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })
    expect(fewer.stages.map((s) => s.id)).toEqual(['s1'])
  })

  it('Normal and Warmup remove the stages and the rest between them, and a warmup is never staged', () => {
    const staged = set('a', { stageKind: 'cluster', stageRestSeconds: 20, restSeconds: 60, stages: [stage('s1', [4, 4])] })
    expect(withSetType(staged, { kind: 'normal' })).toEqual({ ...staged, isWarmup: false, stageKind: null, stageRestSeconds: null, stages: [] })
    expect(withSetType(staged, { kind: 'warmup' })).toEqual({ ...staged, isWarmup: true, stageKind: null, stageRestSeconds: null, stages: [] })
  })

  it('a warmup made a staged kind is a working set again', () => {
    const next = withSetType(set('a', { isWarmup: true }), { kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: null })
    expect(next.isWarmup).toBe(false)
    expect(setTypeOf(next)).toEqual({ kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: null })
  })

  it.each<SetType>([
    { kind: 'normal' },
    { kind: 'warmup' },
    { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null },
    { kind: 'staged', stageKind: 'rest_pause', stageCount: 3, stageRestSeconds: 30 },
    { kind: 'staged', stageKind: 'myo_reps', stageCount: 5, stageRestSeconds: 15 },
    { kind: 'staged', stageKind: 'cluster', stageCount: 2, stageRestSeconds: 45 },
  ])('what the picker asked for is what the set reads as: %j', (type) => {
    expect(setTypeOf(withSetType(set('a', { stages: [stage('s1')], stageKind: 'dropset' }), type))).toEqual(type)
    expect(setTypeOf(withSetType(set('b'), type))).toEqual(type)
  })

  it('says it on the rep box: WARMUP, the kind with how many stages, nothing for a Normal set', () => {
    expect(kindText(set('a'))).toBeNull()
    expect(kindText(set('a', { isWarmup: true }))).toBe('WARMUP')
    expect(kindText(set('a', { stageKind: 'dropset', stages: [stage('s1')] }))).toBe('DROPSET · 1')
    expect(kindText(set('a', { stageKind: 'rest_pause', stages: [stage('s1'), stage('s2')] }))).toBe('REST-PAUSE · 2')
    expect(kindText(set('a', { stageKind: 'myo_reps', stages: [stage('s1'), stage('s2'), stage('s3')] }))).toBe('MYO-REPS · 3')
    expect(kindText(set('a', { stageKind: 'cluster', stages: [stage('s1'), stage('s2')] }))).toBe('CLUSTER · 2')
    expect(kindText(set('a', { stageKind: null, stages: [stage('s1')] }))).toBe('DROPSET · 1')
  })
})

describe('ALL and the REST AFTER reading', () => {
  it('ALL shows the target every set has, MIXED when they differ (a warmup counts), a dash when none has one', () => {
    expect(allText([set('a'), set('b'), set('c')])).toBe('8–10')
    expect(allText([set('a'), set('b', { repMin: 10, repMax: 12 })])).toBe('MIXED')
    expect(allText([set('w', { isWarmup: true, repMin: 12, repMax: 12 }), set('a', { repMin: 10, repMax: 10 })])).toBe('MIXED')
    expect(allText([set('a', { repMin: null, repMax: null }), set('b', { repMin: null, repMax: null })])).toBe('—')
    expect(allText([set('a', { repMin: null, repMax: null, isAmrap: true }), set('b', { repMin: null, repMax: null, isAmrap: true })])).toBe('AMRAP')
    expect(allText([])).toBe('—')
  })

  it('a staged set is judged by its own target, not its stages', () => {
    expect(allText([set('a'), set('b', { stageKind: 'dropset', stages: [stage('s1', [4, 6])] })])).toBe('8–10')
  })

  it('REST AFTER reads CHAIN until the set has a rest of its own, then m:ss', () => {
    expect(restAfterText(null)).toBe('CHAIN')
    expect(restAfterText(120)).toBe('2:00')
    expect(restAfterText(15)).toBe('0:15')
    expect(restAfterText(90)).toBe('1:30')
  })
})

describe('numbering the rows', () => {
  it('numbers the working sets 01, 02 and says W for a warmup, which is numbered apart', () => {
    const sets = [set('w', { isWarmup: true }), set('a'), set('b')]
    expect(numberSets(sets, null)).toEqual([
      { label: 'W', number: 1 },
      { label: '01', number: 1 },
      { label: '02', number: 2 },
    ])
  })

  it('numbers the second warmup among the warmups', () => {
    const sets = [set('w1', { isWarmup: true }), set('w2', { isWarmup: true }), set('a')]
    expect(numberSets(sets, null).map((n) => n.number)).toEqual([1, 2, 1])
  })

  it("in a superset the member's letter leads: A1, A2, and AW for a warmup (TASKS 51b: A1/B1 labels)", () => {
    expect(numberSets([set('w', { isWarmup: true }), set('a'), set('b')], 'A').map((n) => n.label)).toEqual(['AW', 'A1', 'A2'])
    expect(numberSets([set('a'), set('b')], 'B').map((n) => n.label)).toEqual(['B1', 'B2'])
  })

  it('a set added after a warmup is the last working set', () => {
    expect(numberSets([set('a'), set('w', { isWarmup: true }), set('b')], null).map((n) => n.label)).toEqual(['01', 'W', '02'])
  })
})

describe('"+ SET" (Defaults 8)', () => {
  it("a Normal set with the last set's rep target, no stages, no rest of its own, a new row", () => {
    expect(newSetAfter(set('a', { repMin: 10, repMax: 12, restSeconds: 120 }))).toEqual({
      id: null,
      isWarmup: false,
      stageKind: null,
      repMin: 10,
      repMax: 12,
      isAmrap: false,
      restSeconds: null,
      stageRestSeconds: null,
      stages: [],
    })
  })

  it("a staged set's own target, not its last stage's; a warmup's target too, as a working set", () => {
    const staged = set('a', { repMin: 8, repMax: 10, stageKind: 'dropset', stages: [stage('s1', [4, 6])] })
    expect(newSetAfter(staged)).toMatchObject({ repMin: 8, repMax: 10, isWarmup: false, stageKind: null, stages: [] })
    expect(newSetAfter(set('w', { isWarmup: true, repMin: 12, repMax: 12 }))).toMatchObject({ repMin: 12, repMax: 12, isWarmup: false })
  })

  it('AMRAP is followed by AMRAP, and the first set of an exercise has no target', () => {
    expect(newSetAfter(set('a', { repMin: null, repMax: null, isAmrap: true }))).toMatchObject({ repMin: null, repMax: null, isAmrap: true })
    expect(newSetAfter(undefined)).toMatchObject({ repMin: null, repMax: null, isAmrap: false, id: null })
  })
})

describe('changed in this edit', () => {
  const was = set('a', { restSeconds: 90, stageKind: 'dropset', stages: [stage('s1', [4, 6]), stage('s2', [2, 4])] })

  it('a set is as it was, or changed in its type, rep target or rest after; a new one is changed', () => {
    expect(setChanged(was, was)).toBe(false)
    expect(setChanged(withRepTarget(was, { type: 'number', value: 5 }), was)).toBe(true)
    expect(setChanged({ ...was, restSeconds: 105 }, was)).toBe(true)
    expect(setChanged(withSetType(was, { kind: 'staged', stageKind: 'cluster', stageCount: 2, stageRestSeconds: null }), was)).toBe(true)
    expect(setChanged(withSetType(was, { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null }), was)).toBe(true)
    expect(setChanged(withSetType(was, { kind: 'staged', stageKind: 'dropset', stageCount: 2, stageRestSeconds: 30 }), was)).toBe(true)
    expect(setChanged(withSetType(was, { kind: 'normal' }), was)).toBe(true)
    expect(setChanged(set(null), undefined)).toBe(true)
  })

  it("a stage's own target belongs to the stage row: the set itself is not marked for it", () => {
    const next = { ...was, stages: [stage('s1', [6, 8]), was.stages[1]] }
    expect(setChanged(next, was)).toBe(false)
    expect(stageChanged(next.stages[0], was)).toBe(true)
    expect(stageChanged(next.stages[1], was)).toBe(false)
  })

  it('a new stage is changed, and so is any stage of a set that is new', () => {
    expect(stageChanged(stage(null), was)).toBe(true)
    expect(stageChanged(stage('s1', [4, 6]), undefined)).toBe(true)
  })

  it('a null kind and the dropset it reads as are the same type', () => {
    const kindless = set('a', { stageKind: null, stages: [stage('s1')] })
    expect(setChanged(withSetType(kindless, { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null }), kindless)).toBe(false)
  })
})
