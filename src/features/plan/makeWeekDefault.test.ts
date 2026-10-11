import { describe, it, expect } from 'vitest'
import type { ProgramExercise, ProgramSet, WeekPlan, WeekPlanSet } from '../../types'
import {
  buildDefaultOffer,
  canMakeWeekDefault,
  diffDefault,
  isDefaultSource,
  laterSessionsOf,
  parseMakeDefaultResult,
  sourceLinksOf,
  toDefaultExercises,
  type DefaultExercise,
  type DefaultSet,
  type MakeDefaultResult,
  type SourceLinks,
} from './makeWeekDefault'
import type { ChangeRecord } from './applyAhead'

// Chunk 32 — the pure half of "Make this week the new default": whether a week can be
// made the default, the function's answer parsed, and old default → new default as change
// records (the parts a later week is offered). Every rule has a case where the wrong
// answer would change the result.

// ─── Fixtures ────────────────────────────────────────────────────────────────

function dset(id: string, overrides: Partial<DefaultSet> = {}): DefaultSet {
  return { id, position: 1, isWarmup: false, parentProgramSetId: null, stageIndex: 0, stageKind: null, repMin: null, repMax: null, isAmrap: false, ...overrides }
}
// A stage of `head`.
function dstage(id: string, head: string, stageIndex: number, overrides: Partial<DefaultSet> = {}): DefaultSet {
  return dset(id, { parentProgramSetId: head, stageIndex, ...overrides })
}
function dex(id: string, position: number, sets: DefaultSet[] = [], exerciseId = `ex-of-${id}`): DefaultExercise {
  return { id, exerciseId, position, sets }
}

const sets = (count: number, prefix: string, extra: Partial<DefaultSet> = {}): DefaultSet[] =>
  Array.from({ length: count }, (_, i) => dset(`${prefix}${i + 1}`, { position: i + 1, ...extra }))

function records(old: DefaultExercise[], neu: DefaultExercise[], links?: SourceLinks): ChangeRecord[] {
  return diffDefault('wd-1', old, neu, links).changes
}

// What the source week showed before the call: the swapped-in row `rowId`'s planned sets named
// these program sets (the replaced row's: a swap moves the sets with their link unchanged).
const named = (rowId: string, ...programSetIds: string[]): SourceLinks => new Map([[rowId, new Set(programSetIds)]])

const shape = (set: DefaultSet, programExerciseId: string) => ({
  programSetId: set.id,
  programExerciseId,
  position: set.position,
  isWarmup: set.isWarmup,
  stageKind: set.isWarmup ? null : set.stageKind,
  repMin: set.repMin,
  repMax: set.repMax,
  isAmrap: set.isAmrap,
  stageIndex: set.parentProgramSetId == null ? 0 : set.stageIndex,
  stages: [] as unknown[],
})

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

// ─── The evidence of a swap: what the source week's rows named before the call ──

describe('sourceLinksOf — per exercise row, the program sets its planned sets name', () => {
  const row = (id: string): ProgramExercise => ({ id, workoutDayId: 'wd-1', userId: 'u', exerciseId: `ex-${id}`, position: 0, weightUnit: null })
  const planned = (id: string, programExerciseId: string, programSetId: string | null, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
    id, weekPlanId: 'wp', userId: 'u', programExerciseId, setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId, ...overrides,
  })

  it('a swapped-in row\'s sets name the replaced row\'s program sets; a row added by hand names nothing', () => {
    const links = sourceLinksOf({
      exercises: [row('kept'), row('swapped-in'), row('by-hand')],
      sets: [
        planned('s1', 'kept', 'k1'),
        planned('s2', 'swapped-in', 'old-1'),
        planned('s3', 'swapped-in', 'old-2', { setNumber: 2 }),
        planned('s4', 'by-hand', null),
        planned('s5', 'by-hand', undefined as unknown as null, { setNumber: 2 }),
      ],
    })
    expect([...links.keys()].sort()).toEqual(['kept', 'swapped-in'])
    expect([...links.get('swapped-in')!].sort()).toEqual(['old-1', 'old-2'])
    expect(links.has('by-hand')).toBe(false)
  })

  it('stages count: they name program sets too', () => {
    const links = sourceLinksOf({
      exercises: [row('r')],
      sets: [planned('h', 'r', 'p1'), planned('st', 'r', 'p1s1', { parentWeekPlanSetId: 'h', stageIndex: 1 })],
    })
    expect([...links.get('r')!].sort()).toEqual(['p1', 'p1s1'])
  })

  it('sets under a row the session does not list are not read: the function only reads the session\'s own rows', () => {
    const links = sourceLinksOf({ exercises: [row('r')], sets: [planned('s', 'gone', 'p1')] })
    expect(links.size).toBe(0)
  })
})

// ─── 2. The function's answer, parsed ────────────────────────────────────────

describe('parseMakeDefaultResult — the shape migration 040 documents', () => {
  const json = {
    mesocycle_id: 'meso-1',
    week_number: 3,
    workouts: [
      {
        workout_day_id: 'wd-1',
        source: { week_plan_id: 'wp-3', sequence_position: 2 },
        old_default: {
          exercises: [
            {
              id: 'pe-1', exercise_id: 'ex-a', position: 0, week_only: false, removed: false,
              sets: [
                { id: 'ps-1', position: 1, is_warmup: false, parent_program_set_id: null, stage_index: 0, stage_kind: 'rest_pause', rep_min: 8, rep_max: 10, is_amrap: false },
                { id: 'ps-2', position: 1, is_warmup: false, parent_program_set_id: 'ps-1', stage_index: 1, stage_kind: null, rep_min: null, rep_max: null, is_amrap: true },
              ],
            },
          ],
        },
      },
    ],
    skipped: [{ workout_day_id: 'wd-2', reason: 'deload' }, { workout_day_id: 'wd-3', reason: 'empty' }],
  }

  it('reads the old default of each rewritten workout, its source slot, and the workouts left alone', () => {
    expect(parseMakeDefaultResult(json)).toEqual<MakeDefaultResult>({
      mesocycleId: 'meso-1',
      weekNumber: 3,
      workouts: [
        {
          workoutDayId: 'wd-1',
          sourceWeekPlanId: 'wp-3',
          sourceSequencePosition: 2,
          oldExercises: [
            {
              id: 'pe-1', exerciseId: 'ex-a', position: 0,
              sets: [
                dset('ps-1', { position: 1, stageKind: 'rest_pause', repMin: 8, repMax: 10 }),
                dset('ps-2', { position: 1, parentProgramSetId: 'ps-1', stageIndex: 1, isAmrap: true }),
              ],
            },
          ],
        },
      ],
      skipped: [{ workoutDayId: 'wd-2', reason: 'deload' }, { workoutDayId: 'wd-3', reason: 'empty' }],
    })
  })

  it('a weekday run\'s source slot is null', () => {
    const parsed = parseMakeDefaultResult({ ...json, workouts: [{ ...json.workouts[0], source: { week_plan_id: 'wp-3', sequence_position: null } }] })
    expect(parsed.workouts[0].sourceSequencePosition).toBeNull()
  })

  it('an answer it cannot read is "nothing to offer", not a throw: the default has been written by then', () => {
    expect(parseMakeDefaultResult(null)).toEqual({ mesocycleId: '', weekNumber: 0, workouts: [], skipped: [] })
    expect(parseMakeDefaultResult('nope').workouts).toEqual([])
    expect(parseMakeDefaultResult({ workouts: [{ nonsense: true }, null, 5] }).workouts).toEqual([])
  })

  it('an unknown stage kind reads as none', () => {
    const parsed = parseMakeDefaultResult({
      ...json,
      workouts: [{ ...json.workouts[0], old_default: { exercises: [{ id: 'pe-1', exercise_id: 'ex-a', position: 0, sets: [{ id: 'ps-1', stage_kind: 'giant_set' }] }] } }],
    })
    expect(parsed.workouts[0].oldExercises[0].sets[0].stageKind).toBeNull()
  })
})

describe('toDefaultExercises — the new default, as the run\'s copy holds it after the call', () => {
  const pe = (id: string, position: number): ProgramExercise => ({ id, workoutDayId: 'wd-1', userId: 'u', exerciseId: `ex-${id}`, position, weightUnit: null })
  const ps = (id: string, programExerciseId: string, overrides: Partial<ProgramSet> = {}): ProgramSet => ({
    id, userId: 'u', programExerciseId, position: 1, isWarmup: false, stageKind: null, stageRestSeconds: null, parentProgramSetId: null, stageIndex: 0,
    repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '', ...overrides,
  })

  it('leaves out a program set the default dropped (removedAt), keeps heads, stages and warmups', () => {
    const result = toDefaultExercises(
      [pe('pe-1', 0), pe('pe-2', 1)],
      [
        ps('a', 'pe-1', { repMin: 5, repMax: 5 }),
        ps('b', 'pe-1', { removedAt: '2026-10-11T00:00:00Z' }),
        ps('c', 'pe-1', { parentProgramSetId: 'a', stageIndex: 1 }),
        ps('w', 'pe-2', { isWarmup: true }),
      ],
    )
    expect(result.map((e) => [e.id, e.sets.map((s) => s.id)])).toEqual([['pe-1', ['a', 'c']], ['pe-2', ['w']]])
    expect(result[0].sets[0]).toMatchObject({ repMin: 5, repMax: 5 })
    expect(result[1].sets[0].isWarmup).toBe(true)
  })
})

// ─── 3. Old default → new default ────────────────────────────────────────────

describe('diffDefault — nothing changed', () => {
  it('the same default makes no record', () => {
    const d = [dex('pe-1', 0, sets(3, 'a', { repMin: 8, repMax: 8 })), dex('pe-2', 1, sets(2, 'b'))]
    expect(records(d, d)).toEqual([])
  })

  it('a rep target that reads the same is no change: a lone minimum with no maximum shows as no target, as an empty one does', () => {
    // A row shows a target only with both ends (or AMRAP): 8 with no maximum reads "none".
    const old = [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: null })])]
    const neu = [dex('pe-1', 0, [dset('a1')])]
    expect(records(old, neu)).toEqual([])
    // ...and one that reads differently is a change.
    expect(records(neu, [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: 8 })])]).map((r) => r.editType)).toEqual(['repTarget'])
  })

  it('a program set\'s own position is not a part: a week keeps its own set numbers', () => {
    const old = [dex('pe-1', 0, [dset('a1', { position: 1 }), dset('a2', { position: 2 })])]
    const neu = [dex('pe-1', 0, [dset('a1', { position: 2 }), dset('a2', { position: 3 })])]
    expect(records(old, neu)).toEqual([])
  })
})

describe('diffDefault — a set that stayed (its program set was updated in place)', () => {
  it('a rep target that changed is a repTarget record, matched by the OLD default\'s program set', () => {
    const old = [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: 10 }), dset('a2', { position: 2, repMin: 8, repMax: 10 })])]
    const neu = [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: 10 }), dset('a2', { position: 2, repMin: 6, repMax: 8 })])]
    expect(records(old, neu)).toEqual([
      {
        editType: 'repTarget',
        slotId: 'pe-1',
        exerciseId: 'ex-of-pe-1',
        setPosition: { headOrdinal: 2, stageIndex: null },
        oldValue: { repMin: 8, repMax: 10, isAmrap: false },
        newValue: { repMin: 6, repMax: 8, isAmrap: false },
        defaultSet: { programSetId: 'a2' },
      },
    ])
  })

  it('AMRAP to a number, and a number to no target, are changes too', () => {
    const old = [dex('pe-1', 0, [dset('a1', { isAmrap: true }), dset('a2', { position: 2, repMin: 8, repMax: 8 })])]
    const neu = [dex('pe-1', 0, [dset('a1', { repMin: 5, repMax: 5 }), dset('a2', { position: 2 })])]
    const out = records(old, neu)
    expect(out.map((r) => [r.editType, 'defaultSet' in r ? r.defaultSet : null])).toEqual([
      ['repTarget', { programSetId: 'a1' }],
      ['repTarget', { programSetId: 'a2' }],
    ])
  })

  it('a head turned into a warmup is a warmup record', () => {
    const old = [dex('pe-1', 0, [dset('a1')])]
    const neu = [dex('pe-1', 0, [dset('a1', { isWarmup: true })])]
    expect(records(old, neu)).toEqual([
      { editType: 'warmup', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', setPosition: { headOrdinal: 1, stageIndex: null }, oldValue: false, newValue: true, defaultSet: { programSetId: 'a1' } },
    ])
  })

  it('a stage kind that changed is a stageKind record; a null kind and a missing one are the same', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dset('a2', { position: 2 })])]
    const neu = [dex('pe-1', 0, [dset('a1', { stageKind: 'myo_reps' }), dset('a2', { position: 2, stageKind: null })])]
    expect(records(old, neu)).toEqual([
      { editType: 'stageKind', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', setPosition: { headOrdinal: 1, stageIndex: null }, oldValue: 'dropset', newValue: 'myo_reps', defaultSet: { programSetId: 'a1' } },
    ])
  })

  it('a warmup carries no stage kind: working with a kind → warmup is a warmup change and a kind change', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'rest_pause' })])]
    const neu = [dex('pe-1', 0, [dset('a1', { isWarmup: true, stageKind: 'rest_pause' })])]
    expect(records(old, neu).map((r) => r.editType)).toEqual(['warmup', 'stageKind'])
  })

  it('a stage\'s rep target is matched by the stage\'s own program set and carries the stage\'s index', () => {
    const old = [dex('pe-1', 0, [dset('a1'), dstage('a1s1', 'a1', 1, { repMin: 10, repMax: 10 })])]
    const neu = [dex('pe-1', 0, [dset('a1'), dstage('a1s1', 'a1', 1, { repMin: 12, repMax: 12 })])]
    expect(records(old, neu)).toEqual([
      {
        editType: 'repTarget', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', setPosition: { headOrdinal: 1, stageIndex: 1 },
        oldValue: { repMin: 10, repMax: 10, isAmrap: false }, newValue: { repMin: 12, repMax: 12, isAmrap: false }, defaultSet: { programSetId: 'a1s1' },
      },
    ])
  })
})

describe('diffDefault — sets that joined or left', () => {
  it('a head that left the default is a removeHeadSet record by its program set (its stages go with it: no record of their own)', () => {
    const old = [dex('pe-1', 0, [dset('a1'), dset('a2', { position: 2 }), dstage('a2s1', 'a2', 1)])]
    const neu = [dex('pe-1', 0, [dset('a1')])]
    expect(records(old, neu)).toEqual([
      { editType: 'removeHeadSet', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', headOrdinal: 2, defaultSet: { programSetId: 'a2' } },
    ])
  })

  it('a stage that left a head that stayed is a removeStage record by the stage\'s program set, with the head\'s old kind', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'myo_reps' }), dstage('s1', 'a1', 1), dstage('s2', 'a1', 2)])]
    const neu = [dex('pe-1', 0, [dset('a1', { stageKind: 'myo_reps' }), dstage('s1', 'a1', 1)])]
    expect(records(old, neu)).toEqual([
      { editType: 'removeStage', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', setPosition: { headOrdinal: 1, stageIndex: 2 }, defaultSet: { programSetId: 's2', headKind: 'myo_reps' } },
    ])
  })

  // The kind the stage's head had BEFORE the default changed: a week that changed the head's kind itself
  // has stages of its own, which a removal must not take (applyAhead.ts).
  it('...the head\'s OLD kind, also when the same default changes it: dropset stages go as the head becomes plain', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1)])]
    const neu = [dex('pe-1', 0, [dset('a1')])]
    const out = records(old, neu)
    expect(out.map((r) => r.editType)).toEqual(['removeStage', 'stageKind'])
    expect(out[0]).toMatchObject({ defaultSet: { programSetId: 's1', headKind: 'dropset' } })
  })

  it('a working set that joined is an addSet record naming its new program set, its kind and rep target, and the old default\'s sets of the row', () => {
    const old = [dex('pe-1', 0, [dset('a1')])]
    const neu = [dex('pe-1', 0, [dset('a1'), dset('a2', { position: 2, repMin: 6, repMax: 8 })])]
    expect(records(old, neu)).toEqual([
      { editType: 'addSet', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', defaultSet: shape(dset('a2', { position: 2, repMin: 6, repMax: 8 }), 'pe-1'), oldSetIds: ['a1'] },
    ])
  })

  it('a warmup that joined is an addWarmupSet record (the week places it above its first working set)', () => {
    const old = [dex('pe-1', 0, [dset('a1', { position: 2 })])]
    const neu = [dex('pe-1', 0, [dset('w1', { position: 1, isWarmup: true }), dset('a1', { position: 2 })])]
    expect(records(old, neu)).toEqual([
      { editType: 'addWarmupSet', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', defaultSet: shape(dset('w1', { position: 1, isWarmup: true }), 'pe-1'), oldSetIds: ['a1'] },
    ])
  })

  it('a staged head that joined brings its stages with it, in stage order', () => {
    const old = [dex('pe-1', 0, [dset('a1')])]
    const neu = [dex('pe-1', 0, [
      dset('a1'),
      dset('a2', { position: 2, stageKind: 'rest_pause' }),
      dstage('a2s2', 'a2', 2, { position: 2, repMin: 4, repMax: 4 }),
      dstage('a2s1', 'a2', 1, { position: 2 }),
    ])]
    const [added] = records(old, neu)
    expect(added.editType).toBe('addSet')
    const defaultSet = (added as Extract<ChangeRecord, { editType: 'addSet' }>).defaultSet!
    expect(defaultSet.stageKind).toBe('rest_pause')
    expect(defaultSet.stages.map((s) => [s.programSetId, s.stageIndex, s.repMin])).toEqual([['a2s1', 1, null], ['a2s2', 2, 4]])
    expect(defaultSet.stages.every((s) => s.programExerciseId === 'pe-1')).toBe(true)
  })

  it('a stage that joined a head that stayed is an addStage record: the head is found by its OLD program set', () => {
    const old = [dex('pe-1', 0, [dset('a1'), dset('a2', { position: 2 })])]
    const neu = [dex('pe-1', 0, [dset('a1'), dset('a2', { position: 2 }), dstage('n1', 'a2', 1, { position: 2, repMin: 12, repMax: 12 })])]
    expect(records(old, neu)).toEqual([
      {
        editType: 'addStage', slotId: 'pe-1', exerciseId: 'ex-of-pe-1', headOrdinal: 2, headProgramSetId: 'a2',
        defaultSet: { ...shape(dstage('n1', 'a2', 1, { position: 2, repMin: 12, repMax: 12 }), 'pe-1') },
        oldSetIds: [], // the old default's stages under that head: none
      },
    ])
  })

  it('an addStage record carries the old default\'s stages under the head, whichever of them stay', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1)])]
    const neu = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1), dstage('n2', 'a1', 2)])]
    expect(records(old, neu)).toMatchObject([{ editType: 'addStage', headProgramSetId: 'a1', oldSetIds: ['s1'] }])
  })

  it('removals come first, then value changes, then additions', () => {
    const old = [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: 8 }), dset('a2', { position: 2 })])]
    const neu = [dex('pe-1', 0, [dset('a1', { repMin: 5, repMax: 5 }), dset('n1', { position: 3 })])]
    expect(records(old, neu).map((r) => r.editType)).toEqual(['removeHeadSet', 'repTarget', 'addSet'])
  })
})

describe('diffDefault — exercises that joined, left, were swapped or moved', () => {
  it('an exercise that left the default is a removeExercise record', () => {
    const old = [dex('pe-1', 0, sets(1, 'a')), dex('pe-2', 1, sets(1, 'b'))]
    const neu = [dex('pe-1', 0, sets(1, 'a'))]
    expect(records(old, neu)).toEqual([{ editType: 'removeExercise', slotId: 'pe-2', exerciseId: 'ex-of-pe-2' }])
  })

  it('an exercise that joined is an addExercise record naming the default\'s OWN row, its position and the program sets it brought', () => {
    const old = [dex('pe-1', 0, sets(1, 'a'))]
    const added = dex('pe-new', 1, [dset('n1', { position: 1 }), dset('n2', { position: 2, stageKind: 'dropset' }), dstage('n2s1', 'n2', 1, { position: 2 })], 'ex-new')
    const out = records(old, [dex('pe-1', 0, sets(1, 'a')), added])
    expect(out).toHaveLength(1)
    const record = out[0] as Extract<ChangeRecord, { editType: 'addExercise' }>
    expect(record).toMatchObject({ editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' })
    expect(record.defaultRow).toMatchObject({ programExerciseId: 'pe-new', position: 1 })
    expect(record.defaultRow!.sets.map((s) => [s.programSetId, s.programExerciseId, s.position])).toEqual([['n1', 'pe-new', 1], ['n2', 'pe-new', 2]])
    expect(record.defaultRow!.sets[1].stages.map((s) => s.programSetId)).toEqual(['n2s1'])
  })

  // ── What a swap is: the source week SHOWED one ──
  // A swap in the source week moves the replaced row's sets to the swapped-in row with their link to
  // the replaced row's program sets unchanged, so the swapped-in row's planned sets NAME them (the
  // `named` helper above stands for sourceLinksOf's answer). A row added by hand has sets that name nothing.

  it('a swap — the swapped-in row\'s sets named the replaced row\'s program sets, and it sits at its place — is one swapExercise record, with its sets re-linked', () => {
    const old = [dex('pe-1', 0, [dset('a1'), dset('a2', { position: 2 }), dstage('a2s1', 'a2', 1, { position: 2 })], 'ex-bench')]
    const neu = [dex('pe-9', 0, [dset('q1'), dset('q2', { position: 2 }), dstage('q2s1', 'q2', 1, { position: 2 })], 'ex-incline')]
    expect(records(old, neu, named('pe-9', 'a1', 'a2', 'a2s1'))).toEqual([
      {
        editType: 'swapExercise', slotId: 'pe-1', exerciseId: 'ex-bench', newExerciseId: 'ex-incline', resultingProgramExerciseId: 'pe-9',
        relink: [{ from: 'a1', to: 'q1' }, { from: 'a2', to: 'q2' }, { from: 'a2s1', to: 'q2s1' }],
      },
    ])
  })

  // The review's case. PlanPage adds an exercise at programExercises.length and removeWeekExercise does
  // not renumber, so "remove C (the last), add D" puts D at C's position. Position alone read that as
  // C -> D: a later week's C row was repointed at D, keeping C's sets and their 140 kg.
  // Break: pair a removed and an added row at the same position as a swap, with no evidence -> this fails.
  it('removing the last exercise and adding another at its place is a removal and an addition, NOT a swap', () => {
    const old = [dex('A', 0, sets(1, 'pa')), dex('B', 1, sets(1, 'pb')), dex('C', 2, [dset('pc1'), dset('pc2', { position: 2 })], 'ex-c')]
    const neu = [dex('A', 0, sets(1, 'pa')), dex('B', 1, sets(1, 'pb')), dex('D', 2, [dset('pd1')], 'ex-d')]
    // D was added by hand in the source week: its planned sets name no program set.
    const out = records(old, neu, new Map())
    expect(out.map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
    expect(out[0]).toMatchObject({ slotId: 'C', exerciseId: 'ex-c' })
    expect(out[1]).toMatchObject({ exerciseId: 'ex-d', defaultRow: { programExerciseId: 'D', position: 2 } })
    expect(out.some((r) => r.editType === 'swapExercise')).toBe(false)
  })

  it('...and when the source week was not at hand (no evidence at all) nothing is a swap, even a row at the same place', () => {
    const old = [dex('pe-1', 0, sets(1, 'a'), 'ex-bench')]
    const neu = [dex('pe-9', 0, sets(1, 'q'), 'ex-incline')]
    expect(records(old, neu).map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
    expect(records(old, neu, undefined).map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
  })

  it('...and when the added row\'s sets named other program sets than the removed row\'s', () => {
    const old = [dex('pe-1', 0, sets(1, 'a')), dex('pe-2', 1, sets(1, 'b'))]
    const neu = [dex('pe-1', 0, sets(1, 'a')), dex('pe-9', 1, sets(1, 'q'))]
    // pe-9's sets named a KEPT row's program set, or one that is nobody's here: neither is pe-2's.
    expect(records(old, neu, named('pe-9', 'a1')).map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
    expect(records(old, neu, named('pe-9', 'zzz')).map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
    // ...and it is a swap when they did name pe-2's.
    expect(records(old, neu, named('pe-9', 'b1')).map((r) => r.editType)).toEqual(['swapExercise'])
  })

  it('a row that replaced another but sits at a DIFFERENT place (swapped, then moved) is a removal and an addition: re-pointing a row cannot carry its place', () => {
    const old = [dex('pe-1', 0, sets(1, 'a')), dex('pe-2', 1, sets(1, 'b'))]
    const neu = [dex('pe-1', 0, sets(1, 'a')), dex('pe-9', 5, sets(1, 'q'))]
    expect(records(old, neu, named('pe-9', 'b1')).map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
  })

  it('a row gone and another at a DIFFERENT place is a removal and an addition, not a swap', () => {
    const old = [dex('pe-1', 0, sets(1, 'a')), dex('pe-2', 1, sets(1, 'b'))]
    const neu = [dex('pe-1', 0, sets(1, 'a')), dex('pe-9', 5, sets(1, 'q'))]
    expect(records(old, neu).map((r) => r.editType)).toEqual(['removeExercise', 'addExercise'])
  })

  it('a row whose sets named the program sets of TWO removed rows is not guessed to be either one\'s swap', () => {
    // Both removed rows sit at the added row's position (a default whose positions repeat).
    const old = [dex('pe-1', 0, sets(1, 'a'), 'ex-a'), dex('pe-2', 0, sets(1, 'b'), 'ex-b')]
    const neu = [dex('pe-9', 0, sets(1, 'q'), 'ex-q')]
    expect(records(old, neu, named('pe-9', 'a1', 'b1')).map((r) => r.editType)).toEqual(['removeExercise', 'removeExercise', 'addExercise'])
  })

  it('two added rows that both name one removed row\'s program sets: only one of them is its swap', () => {
    const old = [dex('pe-1', 0, sets(1, 'a'), 'ex-a')]
    const neu = [dex('pe-8', 0, sets(1, 'p'), 'ex-p'), dex('pe-9', 0, sets(1, 'q'), 'ex-q')]
    const out = records(old, neu, new Map([['pe-8', new Set(['a1'])], ['pe-9', new Set(['a1'])]]))
    expect(out.map((r) => r.editType)).toEqual(['swapExercise', 'addExercise'])
    expect(out[0]).toMatchObject({ resultingProgramExerciseId: 'pe-8' })
    expect(out[1]).toMatchObject({ defaultRow: { programExerciseId: 'pe-9' } })
  })

  it('two swaps at two places are two swaps, each pairing its own', () => {
    const old = [dex('pe-1', 0, sets(1, 'a'), 'ex-a'), dex('pe-2', 1, sets(1, 'b'), 'ex-b')]
    const neu = [dex('pe-8', 0, sets(1, 'p'), 'ex-p'), dex('pe-9', 1, sets(1, 'q'), 'ex-q')]
    const links: SourceLinks = new Map([['pe-8', new Set(['a1'])], ['pe-9', new Set(['b1'])]])
    const swaps = records(old, neu, links).filter((r) => r.editType === 'swapExercise') as Extract<ChangeRecord, { editType: 'swapExercise' }>[]
    expect(swaps.map((s) => [s.slotId, s.resultingProgramExerciseId])).toEqual([['pe-1', 'pe-8'], ['pe-2', 'pe-9']])
    // Crossed evidence pairs crossed: pe-8 sits at pe-1's place but named pe-2's sets, so it is nobody's swap.
    const crossed: SourceLinks = new Map([['pe-8', new Set(['b1'])], ['pe-9', new Set(['a1'])]])
    expect(records(old, neu, crossed).filter((r) => r.editType === 'swapExercise')).toEqual([])
  })

  // ── A swapped slot's sets: paired by ordinal WITHIN KIND (G44's rule, as weights are paired) ──

  it('a swapped slot\'s set-level changes are found between the old row\'s sets and the new row\'s, by ordinal', () => {
    const old = [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: 8 }), dset('a2', { position: 2 }), dset('a3', { position: 3 })], 'ex-bench')]
    const neu = [dex('pe-9', 0, [dset('q1', { repMin: 5, repMax: 5 }), dset('q2', { position: 2 }), dset('q3', { position: 3 }), dset('q4', { position: 4 })], 'ex-incline')]
    const out = records(old, neu, named('pe-9', 'a1', 'a2', 'a3'))
    expect(out.map((r) => r.editType)).toEqual(['swapExercise', 'repTarget', 'addSet'])
    // The rep change is matched through the OLD row's program set (and names the row that replaced it,
    // which a week that took the swap already holds); the new set belongs to the NEW row.
    expect(out[1]).toMatchObject({ slotId: 'pe-1', defaultSet: { programSetId: 'a1', swappedInto: 'pe-9' }, newValue: { repMin: 5, repMax: 5 } })
    expect((out[2] as Extract<ChangeRecord, { editType: 'addSet' }>).defaultSet).toMatchObject({ programSetId: 'q4', programExerciseId: 'pe-9' })
  })

  it('a swapped slot that lost a set removes it by the old row\'s program set', () => {
    const old = [dex('pe-1', 0, sets(3, 'a'), 'ex-bench')]
    const neu = [dex('pe-9', 0, sets(2, 'q'), 'ex-incline')]
    const out = records(old, neu, named('pe-9', 'a1', 'a2'))
    expect(out.map((r) => r.editType)).toEqual(['swapExercise', 'removeHeadSet'])
    expect(out[1]).toMatchObject({ slotId: 'pe-1', headOrdinal: 3, defaultSet: { programSetId: 'a3', swappedInto: 'pe-9' } })
    expect((out[0] as Extract<ChangeRecord, { editType: 'swapExercise' }>).relink).toEqual([{ from: 'a1', to: 'q1' }, { from: 'a2', to: 'q2' }])
  })

  // R1: the source week also added a warmup on the swapped-in exercise. Paired by plain ordinal, the old
  // row's first WORKING set stood for the new row's WARMUP: a later week's 100 kg working set became a
  // warmup, and the last working set was added with no weight.
  // Break: pair a swapped slot's heads by plain ordinal (warmups and working sets together) -> this fails.
  it('R1 — a warmup the source week added on the swapped-in exercise is an addition: no working set becomes a warmup', () => {
    const old = [dex('pe-1', 0, [dset('p1', { position: 1 }), dset('p2', { position: 2 })], 'ex-a')]
    const neu = [dex('pe-9', 0, [dset('qw', { position: 1, isWarmup: true }), dset('q1', { position: 2 }), dset('q2', { position: 3 })], 'ex-b')]
    const out = records(old, neu, named('pe-9', 'p1', 'p2'))
    expect(out.map((r) => r.editType)).toEqual(['swapExercise', 'addWarmupSet'])
    expect(out[0]).toMatchObject({ relink: [{ from: 'p1', to: 'q1' }, { from: 'p2', to: 'q2' }] })
    expect(out[1]).toMatchObject({ slotId: 'pe-1', defaultSet: { programSetId: 'qw', programExerciseId: 'pe-9', isWarmup: true } })
  })

  // R1b: the source week removed a warmup from the swapped-in exercise. By plain ordinal the heavy working
  // set was removed instead of the warmup, and the warmup was flipped to working.
  // Break: plain ordinal pairing -> this fails.
  it('R1b — a warmup the source week removed from the swapped-in exercise is a removal of the warmup, not of a working set', () => {
    const old = [dex('pe-1', 0, [dset('pw', { position: 1, isWarmup: true }), dset('p1', { position: 2 }), dset('p2', { position: 3 })], 'ex-a')]
    const neu = [dex('pe-9', 0, [dset('q1', { position: 1 }), dset('q2', { position: 2 })], 'ex-b')]
    const out = records(old, neu, named('pe-9', 'p1', 'p2'))
    expect(out.map((r) => r.editType)).toEqual(['swapExercise', 'removeHeadSet'])
    expect(out[0]).toMatchObject({ relink: [{ from: 'p1', to: 'q1' }, { from: 'p2', to: 'q2' }] })
    expect(out[1]).toMatchObject({ defaultSet: { programSetId: 'pw', swappedInto: 'pe-9' } })
  })

  it('warmups pair with warmups and working sets with working sets, each by its own ordinal', () => {
    const old = [dex('pe-1', 0, [dset('w1', { position: 1, isWarmup: true }), dset('w2', { position: 2, isWarmup: true }), dset('p1', { position: 3 }), dset('p2', { position: 4 })], 'ex-a')]
    const neu = [dex('pe-9', 0, [dset('v1', { position: 1, isWarmup: true }), dset('q1', { position: 2 }), dset('q2', { position: 3 }), dset('q3', { position: 4 })], 'ex-b')]
    const out = records(old, neu, named('pe-9', 'w1', 'p1'))
    const swap = out[0] as Extract<ChangeRecord, { editType: 'swapExercise' }>
    expect(swap.relink).toEqual([{ from: 'w1', to: 'v1' }, { from: 'p1', to: 'q1' }, { from: 'p2', to: 'q2' }])
    expect(out.slice(1).map((r) => [r.editType, (r as { defaultSet?: { programSetId: string } }).defaultSet?.programSetId])).toEqual([
      ['removeHeadSet', 'w2'], // the second warmup of the old row has no partner
      ['addSet', 'q3'], // the third working set of the new row has none either
    ])
  })

  it('a swapped head\'s stages follow it by stage index, not by their order', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('a1s1', 'a1', 1), dstage('a1s2', 'a1', 2)], 'ex-a')]
    // The new head has only its stage 2: stage 1 has no partner. By order, a1s1 would stand for q1s2.
    const neu = [dex('pe-9', 0, [dset('q1', { stageKind: 'dropset' }), dstage('q1s2', 'q1', 2)], 'ex-b')]
    const out = records(old, neu, named('pe-9', 'a1', 'a1s1', 'a1s2'))
    expect((out[0] as Extract<ChangeRecord, { editType: 'swapExercise' }>).relink).toEqual([{ from: 'a1', to: 'q1' }, { from: 'a1s2', to: 'q1s2' }])
    expect(out.slice(1)).toMatchObject([{ editType: 'removeStage', defaultSet: { programSetId: 'a1s1', swappedInto: 'pe-9', headKind: 'dropset' } }])
  })

  // A stage the default adds under a swapped slot's head is found in a later week by the OLD head's
  // program set (the week's head names it until the swap record re-links it), while the stage itself
  // belongs to the NEW row. A wrong head id finds nothing and the stage is silently skipped.
  // Break: name the new head (q1) as headProgramSetId -> this fails.
  it('a stage added under a swapped slot\'s head names the OLD head and belongs to the swapped-in row', () => {
    const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' })], 'ex-a')]
    const neu = [dex('pe-9', 0, [dset('q1', { stageKind: 'dropset' }), dstage('q1s1', 'q1', 1, { repMin: 10, repMax: 10 })], 'ex-b')]
    const out = records(old, neu, named('pe-9', 'a1'))
    expect(out.map((r) => r.editType)).toEqual(['swapExercise', 'addStage'])
    expect(out[1]).toMatchObject({
      slotId: 'pe-1',
      headProgramSetId: 'a1',
      defaultSet: { programSetId: 'q1s1', programExerciseId: 'pe-9', stageIndex: 1, repMin: 10, repMax: 10 },
      oldSetIds: [],
    })
  })

  it('a kept row whose place changed is a reorderExercise record with its old and new position', () => {
    const old = [dex('pe-1', 0), dex('pe-2', 1), dex('pe-3', 2)]
    const neu = [dex('pe-1', 0), dex('pe-3', 1), dex('pe-2', 2)]
    expect(records(old, neu)).toEqual([
      {
        editType: 'reorderExercise',
        moves: [{ slotId: 'pe-2', oldPosition: 1, newPosition: 2 }, { slotId: 'pe-3', oldPosition: 2, newPosition: 1 }],
      },
    ])
  })

  it('moves that trade places are one part; moves that are independent are separate parts', () => {
    const old = [dex('pe-1', 0), dex('pe-2', 1), dex('pe-3', 2), dex('pe-4', 3)]
    // 0↔1 trade, and 2↔3 trade: two independent pairs.
    const neu = [dex('pe-2', 0), dex('pe-1', 1), dex('pe-4', 2), dex('pe-3', 3)]
    const out = records(old, neu) as Extract<ChangeRecord, { editType: 'reorderExercise' }>[]
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.moves.map((m) => m.slotId))).toEqual([['pe-1', 'pe-2'], ['pe-3', 'pe-4']])
  })

  it('a chain (D moves up; the ones it passes move down) is one part', () => {
    const old = [dex('pe-1', 0), dex('pe-2', 1), dex('pe-3', 2), dex('pe-4', 3)]
    const neu = [dex('pe-1', 0), dex('pe-4', 1), dex('pe-2', 2), dex('pe-3', 3)]
    const out = records(old, neu) as Extract<ChangeRecord, { editType: 'reorderExercise' }>[]
    expect(out).toHaveLength(1)
    expect(out[0].moves.map((m) => [m.slotId, m.oldPosition, m.newPosition])).toEqual([['pe-2', 1, 2], ['pe-3', 2, 3], ['pe-4', 3, 1]])
  })

  it('positions are the default\'s own values, not ranks: a gap the source week left is a move', () => {
    const old = [dex('pe-1', 0), dex('pe-2', 1)]
    const neu = [dex('pe-1', 0), dex('pe-2', 4)]
    expect(records(old, neu)).toEqual([{ editType: 'reorderExercise', moves: [{ slotId: 'pe-2', oldPosition: 1, newPosition: 4 }] }])
  })

  it('records are ordered: removals, swaps, set-level changes, reorders, additions', () => {
    const old = [dex('pe-1', 0, sets(1, 'a')), dex('pe-2', 1, sets(1, 'b')), dex('pe-3', 2, sets(2, 'c'), 'ex-c'), dex('pe-4', 3, sets(1, 'd'))]
    const neu = [
      dex('pe-4', 0, sets(1, 'd')), // moved up
      dex('pe-7', 2, sets(2, 'q'), 'ex-q'), // swapped in for pe-3
      dex('pe-1', 1, [dset('a1', { repMin: 5, repMax: 5 })]), // moved, rep target changed
      dex('pe-new', 4, sets(1, 'n'), 'ex-new'), // joined
    ] // pe-2 left
    expect(records(old, neu, named('pe-7', 'c1', 'c2')).map((r) => r.editType)).toEqual(['removeExercise', 'swapExercise', 'repTarget', 'reorderExercise', 'addExercise'])
  })
})

// ─── The offer ───────────────────────────────────────────────────────────────

describe('laterSessionsOf / buildDefaultOffer', () => {
  function week(weekNumber: number, workoutDayId = 'wd-1', overrides: Partial<WeekPlan> = {}): WeekPlan {
    return { id: `wp-${workoutDayId}-${weekNumber}-${overrides.sequencePosition ?? 'x'}`, userId: 'u', mesocycleId: 'm', workoutDayId, weekNumber, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '', ...overrides }
  }
  const result = (overrides: Partial<MakeDefaultResult> = {}): MakeDefaultResult => ({
    mesocycleId: 'm', weekNumber: 3, skipped: [],
    workouts: [{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-3', sourceSequencePosition: null, oldExercises: [dex('pe-1', 0, [dset('a1', { repMin: 8, repMax: 8 })])] }],
    ...overrides,
  })
  const changed = new Map([['wd-1', [dex('pe-1', 0, [dset('a1', { repMin: 5, repMax: 5 })])]]])

  it('later sessions are those of the workout in weeks AFTER the one made the default, in week order', () => {
    const all = [week(5), week(1), week(3), week(4), week(4, 'wd-2'), week(2)]
    expect(laterSessionsOf(all, 'wd-1', 3).map((w) => w.weekNumber)).toEqual([4, 5])
  })

  it('on a sequence run every slot of the workout in later cycles counts, the cycle\'s own other slots do not', () => {
    const all = [week(3, 'wd-1', { sequencePosition: 0 }), week(3, 'wd-1', { sequencePosition: 2 }), week(4, 'wd-1', { sequencePosition: 2 }), week(4, 'wd-1', { sequencePosition: 0 })]
    expect(laterSessionsOf(all, 'wd-1', 3).map((w) => [w.weekNumber, w.sequencePosition])).toEqual([[4, 0], [4, 2]])
  })

  it('no offer when no later week is planned', () => {
    expect(buildDefaultOffer(result(), changed, [week(2), week(3)])).toBeNull()
  })

  it('no offer when the new default is what the old one was', () => {
    expect(buildDefaultOffer(result(), new Map([['wd-1', result().workouts[0].oldExercises]]), [week(4)])).toBeNull()
  })

  it('no offer for a workout whose new default could not be read', () => {
    expect(buildDefaultOffer(result(), new Map(), [week(4)])).toBeNull()
  })

  it('an offer carries the records per workout, the later sessions and the number of weeks (not sessions)', () => {
    const wd2 = { workoutDayId: 'wd-2', sourceWeekPlanId: 'wp-x', sourceSequencePosition: null, oldExercises: [dex('pe-5', 0, [dset('b1', { repMin: 8, repMax: 8 })])] }
    const r = result({ workouts: [...result().workouts, wd2] })
    const next = new Map([...changed, ['wd-2', [dex('pe-5', 0, [dset('b1', { repMin: 5, repMax: 5 })])]]])
    const all = [week(4), week(5), week(4, 'wd-2'), week(5, 'wd-2'), week(3), week(3, 'wd-2')]
    const offer = buildDefaultOffer(r, next, all)!
    expect(offer.groups.map((g) => [g.workoutDayId, g.changes.length])).toEqual([['wd-1', 1], ['wd-2', 1]])
    expect(offer.weeks).toHaveLength(4)
    expect(offer.weekCount).toBe(2)
  })

  // The swap is told from the evidence of the SOURCE session the function names (read before the call);
  // without it a row at the replaced row's place is a removal and an addition (the review's false swap).
  // Break: ignore the evidence map in buildDefaultOffer -> the first expectation fails.
  it('swaps are told from the evidence of the session the default came from; without it there is none', () => {
    const swapped = result({ workouts: [{ workoutDayId: 'wd-1', sourceWeekPlanId: 'wp-3', sourceSequencePosition: null, oldExercises: [dex('pe-1', 0, sets(1, 'a'), 'ex-a')] }] })
    const next = new Map([['wd-1', [dex('pe-9', 0, sets(1, 'q'), 'ex-q')]]])
    const types = (links?: ReadonlyMap<string, SourceLinks>) => buildDefaultOffer(swapped, next, [week(4)], links)!.groups[0].changes.map((c) => c.editType)
    expect(types(new Map([['wp-3', named('pe-9', 'a1')]]))).toEqual(['swapExercise'])
    expect(types()).toEqual(['removeExercise', 'addExercise'])
    expect(types(new Map())).toEqual(['removeExercise', 'addExercise'])
    // Another session's evidence is not this workout's.
    expect(types(new Map([['wp-elsewhere', named('pe-9', 'a1')]]))).toEqual(['removeExercise', 'addExercise'])
    // The session's own, with nothing named by that row: the removal and the addition again.
    expect(types(new Map([['wp-3', new Map()]]))).toEqual(['removeExercise', 'addExercise'])
  })

  it('a workout with nothing planned ahead is left out; another with something to apply still gets its offer', () => {
    const wd2 = { workoutDayId: 'wd-2', sourceWeekPlanId: 'wp-x', sourceSequencePosition: null, oldExercises: [dex('pe-5', 0, [dset('b1', { repMin: 8, repMax: 8 })])] }
    const r = result({ workouts: [...result().workouts, wd2] })
    const next = new Map([...changed, ['wd-2', [dex('pe-5', 0, [dset('b1', { repMin: 5, repMax: 5 })])]]])
    const offer = buildDefaultOffer(r, next, [week(4, 'wd-2')])!
    expect(offer.groups.map((g) => g.workoutDayId)).toEqual(['wd-2'])
  })
})
