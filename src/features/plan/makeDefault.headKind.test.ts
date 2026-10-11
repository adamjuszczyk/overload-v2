import { describe, it, expect } from 'vitest'
import type { WeekPlan, ProgramExercise, WeekPlanSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary.js'
import { planApplyAheadGroups, type AheadGroup, type ApplyAheadOp, type WeekApplyResult } from './applyAhead'
import { diffDefault, type DefaultExercise, type DefaultSet, type SourceLinks } from './makeWeekDefault'

// Chunk 32, final round — a head's KIND is ONE part, and a make-default never leaves a head that is both a
// warmup and staged. These run the pure pipeline end to end: the old default → new default records
// (diffDefault) resolved against a later week (planApplyAheadGroups), and the week as the ops leave it.
//
// The review found that the `warmup`, `stageKind` and `addStage` records each checked only the field they write,
// so a later week that had made the head something else got half of a change:
//   CASE 1  the default makes a1 a warmup; the week made it a dropset with a stage of its own.
//   CASE 2  the default stages a1 as a dropset; the week made it a warmup.
//   CASE 3  the default adds a stage to a dropset head; the week made it myo-reps, or a warmup with no stages.
//   B       old dropset (s1, s2) -> new myo-reps (s1); the week's head has NO kind stored (reads as a dropset):
//           the kind change AND the stage removal both apply, and null -> 'dropset' is not a change to write.
//   C       a swapped slot's sets are paired by the source week's own links, not by ordinal.
// Each test names the break that makes it fail.

// ─── Fixtures ────────────────────────────────────────────────────────────────

function dset(id: string, overrides: Partial<DefaultSet> = {}): DefaultSet {
  return { id, position: 1, isWarmup: false, parentProgramSetId: null, stageIndex: 0, stageKind: null, repMin: null, repMax: null, isAmrap: false, ...overrides }
}
function dstage(id: string, head: string, stageIndex: number, overrides: Partial<DefaultSet> = {}): DefaultSet {
  return dset(id, { parentProgramSetId: head, stageIndex, ...overrides })
}
function dex(id: string, position: number, sets: DefaultSet[], exerciseId = `ex-of-${id}`): DefaultExercise {
  return { id, exerciseId, position, sets }
}

function pe(id: string, overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return { id, workoutDayId: 'wd-1', userId: 'u', exerciseId: `ex-of-${id}`, position: 0, weightUnit: null, ...overrides }
}
function wset(id: string, programExerciseId: string, programSetId: string | null, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id, weekPlanId: 'wp-4', userId: 'u', programExerciseId, setNumber: 1, targetRir: null, isDropset: false,
    parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId, ...overrides,
  }
}
// The later week: one exercise row (its exercise is the one the default's row of that id has: dex() names it
// `ex-of-<id>` unless told otherwise).
function later(rowId: string, sets: WeekPlanSet[], exerciseId = `ex-of-${rowId}`): WeekPlan {
  return {
    id: 'wp-4', userId: 'u', mesocycleId: 'm', workoutDayId: 'wd-1', weekNumber: 4, isDeload: false, notes: null,
    exercises: [pe(rowId, { exerciseId })], sets, createdAt: '',
  }
}

// The later week's head `h` (row pe-1), linked to a1, with the given stages (a stage naming `null` is the week's own).
function headWeek(head: Partial<WeekPlanSet>, stages: { programSetId: string | null; stageIndex?: number }[] = []): WeekPlan {
  return later('pe-1', [
    wset('h', 'pe-1', 'a1', head),
    ...stages.map((s, i) => wset(`st${i + 1}`, 'pe-1', s.programSetId, { parentWeekPlanSetId: 'h', stageIndex: s.stageIndex ?? i + 1 })),
  ])
}

// ─── The week as the ops leave it ────────────────────────────────────────────

// Just enough of weekPlanService.ts to see what a head ends up as: an update of a set's columns, a removal (a head
// takes its stages with it), and the pointed adds of a stage and of a set with its stages.
interface Sim {
  id: string
  parent: string | null
  programSetId: string | null
  isWarmup: boolean
  stageKind: StageKind | null
}
function simulate(week: WeekPlan, result: WeekApplyResult): Sim[] {
  let sets: Sim[] = week.sets.map((s) => ({
    id: s.id, parent: s.parentWeekPlanSetId, programSetId: s.programSetId ?? null, isWarmup: s.isWarmup, stageKind: s.stageKind ?? null,
  }))
  if (result.status !== 'applied') return sets
  for (const op of result.ops as ApplyAheadOp[]) {
    if (op.kind === 'updateSet') {
      sets = sets.map((s) =>
        s.id !== op.setId ? s : {
          ...s,
          ...(op.changes.isWarmup !== undefined ? { isWarmup: op.changes.isWarmup } : {}),
          ...(op.changes.stageKind !== undefined ? { stageKind: op.changes.stageKind } : {}),
        },
      )
    } else if (op.kind === 'removeSet') {
      sets = sets.filter((s) => s.id !== op.setId && s.parent !== op.setId)
    } else if (op.kind === 'addPointedStage') {
      sets = [...sets, { id: `new-${op.set.programSetId}`, parent: op.parentId, programSetId: op.set.programSetId, isWarmup: false, stageKind: null }]
    } else if (op.kind === 'addPointedSet') {
      const id = `new-${op.set.programSetId}`
      sets = [
        ...sets,
        { id, parent: null, programSetId: op.set.programSetId, isWarmup: op.set.isWarmup, stageKind: op.set.stageKind },
        ...op.set.stages.map((st) => ({ id: `new-${st.programSetId}`, parent: id, programSetId: st.programSetId, isWarmup: false, stageKind: null as StageKind | null })),
      ]
    }
  }
  return sets
}
const headsOf = (sets: Sim[]) => sets.filter((s) => s.parent == null)
const stagesOf = (sets: Sim[], headId: string) => sets.filter((s) => s.parent === headId)
// The one thing that must never be written.
const warmupAndStaged = (sets: Sim[]) => headsOf(sets).filter((h) => h.isWarmup && stagesOf(sets, h.id).length > 0).map((h) => h.id)

function run(old: DefaultExercise[], neu: DefaultExercise[], week: WeekPlan, links?: SourceLinks, chain?: ReadonlyMap<string, string>) {
  const group: AheadGroup = diffDefault('wd-1', old, neu, links, chain)
  const [result] = planApplyAheadGroups([group], [week])
  return { group, result, after: simulate(week, result) }
}
const types = (group: AheadGroup) => group.changes.map((c) => c.editType)

// ─── CASE 1 ──────────────────────────────────────────────────────────────────

describe('CASE 1 — the default makes a1 a warmup; the later week had made it a dropset with a stage of its own', () => {
  const old = [dex('pe-1', 0, [dset('a1')])]
  const neu = [dex('pe-1', 0, [dset('a1', { isWarmup: true })])]

  // Break: gate the warmup record on the single field it writes (`isWarmup === oldValue`, as it did) -> the week's
  // dropset head becomes a warmup that still holds its stage.
  it('writes nothing to that head: it is neither made a warmup nor left a warmup that is staged', () => {
    const week = headWeek({ stageKind: 'dropset' }, [{ programSetId: null }])
    const { group, result, after } = run(old, neu, week)
    expect(types(group)).toEqual(['warmup'])
    expect(result).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(after).toEqual(simulate(week, { weekPlanId: 'wp-4', weekNumber: 4, status: 'skipped', reason: 'structural' })) // untouched
    expect(warmupAndStaged(after)).toEqual([])
  })

  it('...whatever its stage kind or the link its own stage carries', () => {
    for (const week of [
      headWeek({ stageKind: null }, [{ programSetId: null }]),
      headWeek({ stageKind: 'myo_reps' }, [{ programSetId: 'from-an-older-default' }, { programSetId: null }]),
    ]) {
      const { result } = run(old, neu, week)
      expect(result).toMatchObject({ status: 'skipped' })
    }
  })

  it('a week that still holds the old plain head does become a warmup (the part is applied where it matches)', () => {
    const { result, after } = run(old, neu, headWeek({}))
    expect(result).toMatchObject({ status: 'applied', ops: [{ kind: 'updateSet', setId: 'h', changes: { isWarmup: true } }] })
    expect(headsOf(after)[0].isWarmup).toBe(true)
  })
})

// ─── CASE 2 ──────────────────────────────────────────────────────────────────

describe('CASE 2 — the default stages a1 as a dropset; the later week made it a warmup', () => {
  const old = [dex('pe-1', 0, [dset('a1')])]
  // Myo-reps with a stage: the kind (resolved: dropset -> myo_reps) and the stage are both parts of the change.
  const neuMyo = [dex('pe-1', 0, [dset('a1', { stageKind: 'myo_reps' }), dstage('s1', 'a1', 1, { repMin: 10, repMax: 10 })])]
  // A plain dropset: a null kind on a head with stages already reads as one, so only the stage is a part.
  const neuDropset = [dex('pe-1', 0, [dset('a1'), dstage('s1', 'a1', 1, { repMin: 10, repMax: 10 })])]
  const warmupWeek = () => headWeek({ isWarmup: true })

  // Break: gate stageKind / addStage on their own field only (as they did) -> the kind lands on the warmup, and the
  // stage under it.
  it('no stage kind and no stage are written under the warmup', () => {
    const { group, result, after } = run(old, neuMyo, warmupWeek())
    expect(types(group)).toEqual(['stageKind', 'addStage'])
    expect(result).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(after).toEqual(simulate(warmupWeek(), result))
    expect(warmupAndStaged(after)).toEqual([])
  })

  it('...also for a plain dropset (only the stage is a part)', () => {
    const { group, result } = run(old, neuDropset, warmupWeek())
    expect(types(group)).toEqual(['addStage'])
    expect(result).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  it('a week that still holds the plain head takes both: the kind and the stage', () => {
    const { result, after } = run(old, neuMyo, headWeek({}))
    expect(result).toMatchObject({
      status: 'applied',
      ops: [{ kind: 'updateSet', setId: 'h', changes: { stageKind: 'myo_reps' } }, { kind: 'addPointedStage', parentId: 'h', stageIndex: 1 }],
    })
    expect(stagesOf(after, 'h')).toHaveLength(1)
    expect(warmupAndStaged(after)).toEqual([])
  })
})

// ─── CASE 3 ──────────────────────────────────────────────────────────────────

describe('CASE 3 — the default adds a stage to a dropset head; the later week made the head myo-reps, or a warmup with no stages', () => {
  const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1)])]
  const neu = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1), dstage('s2', 'a1', 2, { repMin: 8, repMax: 8 })])]

  // Break: leave the whole-kind gate out of addStage (find the linked head, check its own stages, add) -> the stage
  // lands under the week's myo-reps head, and under its warmup.
  it('adds no stage under a head the week made myo-reps', () => {
    const week = headWeek({ stageKind: 'myo_reps' }, [{ programSetId: 's1' }])
    const { group, result, after } = run(old, neu, week)
    expect(types(group)).toEqual(['addStage'])
    expect(result).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(stagesOf(after, 'h')).toHaveLength(1)
  })

  it('adds no stage under a warmup with no stages', () => {
    const week = headWeek({ isWarmup: true })
    const { result, after } = run(old, neu, week)
    expect(result).toMatchObject({ status: 'skipped', reason: 'structural' })
    expect(stagesOf(after, 'h')).toHaveLength(0)
    expect(warmupAndStaged(after)).toEqual([])
  })

  it('a week that still holds the old dropset head gets the stage, at the next index', () => {
    const { result, after } = run(old, neu, headWeek({ stageKind: 'dropset' }, [{ programSetId: 's1' }]))
    expect(result).toMatchObject({ status: 'applied', ops: [{ kind: 'addPointedStage', parentId: 'h', stageIndex: 2 }] })
    expect(stagesOf(after, 'h')).toHaveLength(2)
  })
})

// ─── B ───────────────────────────────────────────────────────────────────────

describe('B — stage kinds are compared as the app reads them (a null kind on a head with stages is a dropset), in every record', () => {
  // Old dropset with s1, s2; new myo-reps with s1. The later week's head has no kind stored and the two stages.
  const old = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1), dstage('s2', 'a1', 2)])]
  const neu = [dex('pe-1', 0, [dset('a1', { stageKind: 'myo_reps' }), dstage('s1', 'a1', 1)])]
  const nullKindWeek = () => headWeek({ stageKind: null }, [{ programSetId: 's1' }, { programSetId: 's2' }])

  // Break: compare the raw column in the stageKind gate (`stageKind === oldValue`: null is not 'dropset') -> the
  // stage is removed but the kind change is not written: half of the change.
  it('the kind change AND the stage removal both apply to a head with no kind stored', () => {
    const { group, result, after } = run(old, neu, nullKindWeek())
    expect(types(group)).toEqual(['removeStage', 'stageKind'])
    expect(result).toMatchObject({
      status: 'applied',
      ops: [{ kind: 'removeSet', setId: 'st2' }, { kind: 'updateSet', setId: 'h', changes: { stageKind: 'myo_reps' } }],
    })
    expect(headsOf(after)[0].stageKind).toBe('myo_reps')
    expect(stagesOf(after, 'h').map((s) => s.programSetId)).toEqual(['s1'])
  })

  it('...and the same with the kind stored as a dropset', () => {
    const { result } = run(old, neu, headWeek({ stageKind: 'dropset' }, [{ programSetId: 's1' }, { programSetId: 's2' }]))
    expect(result).toMatchObject({ status: 'applied', ops: [{ kind: 'removeSet' }, { kind: 'updateSet', changes: { stageKind: 'myo_reps' } }] })
  })

  it('a week that made the head myo-reps itself keeps both: neither part is written', () => {
    const { result } = run(old, neu, headWeek({ stageKind: 'myo_reps' }, [{ programSetId: 's1' }, { programSetId: 's2' }]))
    expect(result).toMatchObject({ status: 'skipped', reason: 'structural' })
  })

  // Break: compare raw kinds when the record is built -> a record that writes 'dropset' over a null that already reads as one.
  it('null and "dropset" are one kind: a default that only moves between them has nothing to write', () => {
    const nullKind = [dex('pe-1', 0, [dset('a1', { stageKind: null }), dstage('s1', 'a1', 1)])]
    const dropset = [dex('pe-1', 0, [dset('a1', { stageKind: 'dropset' }), dstage('s1', 'a1', 1)])]
    expect(diffDefault('wd-1', nullKind, dropset).changes).toEqual([])
    expect(diffDefault('wd-1', dropset, nullKind).changes).toEqual([])
  })
})

// ─── C ───────────────────────────────────────────────────────────────────────

describe('C — a swapped slot\'s sets are paired by the source week\'s own links', () => {
  // Old R: a1 8, a2 10, a3 12. The source week swapped R for N and deleted a1's set, so N's sets named a2 and a3
  // before the call, and name n1 (10) and n2 (12) after it. The later week: L1, L2, L3 linked to a1, a2, a3.
  const old = [dex('R', 0, [dset('a1', { position: 1, repMin: 8, repMax: 8 }), dset('a2', { position: 2, repMin: 10, repMax: 10 }), dset('a3', { position: 3, repMin: 12, repMax: 12 })], 'ex-r')]
  const neu = [dex('N', 0, [dset('n1', { position: 1, repMin: 10, repMax: 10 }), dset('n2', { position: 2, repMin: 12, repMax: 12 })], 'ex-n')]
  const evidence: SourceLinks = new Map([['N', new Set(['a2', 'a3'])]])
  const chain = new Map([['a2', 'n1'], ['a3', 'n2']])
  const weekOfR = () =>
    later('R', [
      wset('L1', 'R', 'a1', { setNumber: 1, repMin: 8, repMax: 8, targetWeight: 80 }),
      wset('L2', 'R', 'a2', { setNumber: 2, repMin: 10, repMax: 10, targetWeight: 70 }),
      wset('L3', 'R', 'a3', { setNumber: 3, repMin: 12, repMax: 12, targetWeight: 60 }),
    ], 'ex-r')

  // Break: pair the slot by ordinal even where the chain is known -> L1 is relinked to n1 and rewritten to 10, L2 to
  // n2 and rewritten to 12, and L3 (the set the source week kept) is deleted.
  it('deletes L1, re-links L2 to n1 and L3 to n2, and rewrites no rep target', () => {
    const { group, result } = run(old, neu, weekOfR(), evidence, chain)
    expect(types(group)).toEqual(['swapExercise', 'removeHeadSet'])
    expect(result).toEqual({
      weekPlanId: 'wp-4', weekNumber: 4, status: 'applied',
      ops: [
        { kind: 'repointExercise', weekPlanId: 'wp-4', fromProgramExerciseId: 'R', toProgramExerciseId: 'N', relink: [{ weekSetId: 'L2', programSetId: 'n1' }, { weekSetId: 'L3', programSetId: 'n2' }] },
        { kind: 'removeSet', weekPlanId: 'wp-4', setId: 'L1' },
      ],
    })
  })

  // The fallback, where no chain could be read: ordinal within kind (the nth working set for the nth working set).
  it('where the source week could not be re-read it falls back to ordinal within kind, which is only a guess', () => {
    const { result } = run(old, neu, weekOfR(), evidence)
    expect(result).toMatchObject({
      status: 'applied',
      ops: [
        { kind: 'repointExercise', relink: [{ weekSetId: 'L1', programSetId: 'n1' }, { weekSetId: 'L2', programSetId: 'n2' }] },
        { kind: 'removeSet', setId: 'L3' },
        { kind: 'updateSet', setId: 'L1', changes: { repMin: 10, repMax: 10 } },
        { kind: 'updateSet', setId: 'L2', changes: { repMin: 12, repMax: 12 } },
      ],
    })
  })

  it('a week that took the swap already is re-linked the same way, in place', () => {
    const tookSwap = later('N', [
      wset('L1', 'N', 'a1', { setNumber: 1, repMin: 8, repMax: 8 }),
      wset('L2', 'N', 'a2', { setNumber: 2, repMin: 10, repMax: 10 }),
      wset('L3', 'N', 'a3', { setNumber: 3, repMin: 12, repMax: 12 }),
    ], 'ex-n')
    const { result } = run(old, neu, tookSwap, evidence, chain)
    expect(result).toMatchObject({
      status: 'applied',
      ops: [
        { kind: 'relinkSets', links: [{ weekSetId: 'L2', programSetId: 'n1' }, { weekSetId: 'L3', programSetId: 'n2' }] },
        { kind: 'removeSet', setId: 'L1' },
      ],
    })
  })
})

// ─── Never both ──────────────────────────────────────────────────────────────

// Every old head × every new head × every later-week head, kept and swapped: whatever the records say, the week's
// head is never left a warmup that is staged. (A week that holds the old head takes the change; one that made the
// head something else keeps it. Either way the invariant holds.)
describe('no combination of old default, new default and later week leaves a head that is both a warmup and staged', () => {
  type Head = { name: string; set: Partial<DefaultSet>; stages: string[] }
  const oldHeads: Head[] = [
    { name: 'plain', set: {}, stages: [] },
    { name: 'plain, hidden kind', set: { stageKind: 'myo_reps' }, stages: [] },
    { name: 'warmup', set: { isWarmup: true }, stages: [] },
    { name: 'dropset (no kind)', set: { stageKind: null }, stages: ['s1'] },
    { name: 'dropset', set: { stageKind: 'dropset' }, stages: ['s1'] },
    { name: 'myo-reps', set: { stageKind: 'myo_reps' }, stages: ['s1', 's2'] },
  ]
  const newHeads: Head[] = [
    { name: 'plain', set: {}, stages: [] },
    { name: 'warmup', set: { isWarmup: true }, stages: [] },
    { name: 'warmup that carries a stage row (a past bug)', set: { isWarmup: true }, stages: ['s1'] },
    { name: 'dropset (no kind)', set: {}, stages: ['s1'] },
    { name: 'dropset + a new stage', set: { stageKind: 'dropset' }, stages: ['s1', 'n1'] },
    { name: 'myo-reps', set: { stageKind: 'myo_reps' }, stages: ['s1'] },
    { name: 'myo-reps + s2 + a new stage', set: { stageKind: 'myo_reps' }, stages: ['s1', 's2', 'n2'] },
    { name: 'cluster, only a new stage', set: { stageKind: 'cluster' }, stages: ['n3'] },
  ]
  const weekHeads: { name: string; head: Partial<WeekPlanSet>; stages: (string | null)[] }[] = [
    { name: 'plain', head: {}, stages: [] },
    { name: 'plain, hidden kind', head: { stageKind: 'rest_pause' }, stages: [] },
    { name: 'warmup', head: { isWarmup: true }, stages: [] },
    { name: 'warmup, hidden kind', head: { isWarmup: true, stageKind: 'dropset' }, stages: [] },
    { name: 'dropset (no kind), s1', head: {}, stages: ['s1'] },
    { name: 'dropset, s1 s2', head: { stageKind: 'dropset' }, stages: ['s1', 's2'] },
    { name: 'myo-reps, s1 s2', head: { stageKind: 'myo_reps' }, stages: ['s1', 's2'] },
    { name: 'dropset, a stage of its own', head: { stageKind: 'dropset' }, stages: [null] },
    { name: 'no kind, s1 and one of its own', head: {}, stages: ['s1', null] },
    { name: 'cluster, one of its own', head: { stageKind: 'cluster' }, stages: ['from-an-older-default'] },
  ]

  const defaultRow = (id: string, head: Head, setId: (s: string) => string, stageId: (s: string) => string): DefaultExercise => {
    const headId = setId('a1')
    return dex(id, 0, [
      dset(headId, { ...head.set }),
      ...head.stages.map((s, i) => dstage(stageId(s), headId, i + 1)),
    ])
  }

  it('kept slot (every combination)', () => {
    const offenders: string[] = []
    let combos = 0
    let written = 0
    for (const o of oldHeads) {
      for (const n of newHeads) {
        const old = [defaultRow('pe-1', o, (s) => s, (s) => s)]
        const neu = [defaultRow('pe-1', n, (s) => s, (s) => s)]
        for (const w of weekHeads) {
          combos++
          const week = headWeek(w.head, w.stages.map((programSetId) => ({ programSetId })))
          expect(warmupAndStaged(simulate(week, { weekPlanId: 'wp-4', weekNumber: 4, status: 'skipped', reason: 'structural' }))).toEqual([]) // the week itself is sound
          const { result, after } = run(old, neu, week)
          if (result.status === 'applied') written++
          const bad = warmupAndStaged(after)
          if (bad.length > 0) offenders.push(`old ${o.name} -> new ${n.name} on week ${w.name}: ${bad.join(',')}`)
        }
      }
    }
    expect(combos).toBe(oldHeads.length * newHeads.length * weekHeads.length)
    expect(written).toBeGreaterThan(30) // not vacuous: plenty of these weeks do take the change
    expect(written).toBeLessThan(combos) // ...and plenty keep what they made
    expect(offenders).toEqual([])
  })

  it('swapped slot (every combination): the same, through the source week\'s links', () => {
    const offenders: string[] = []
    let written = 0
    for (const o of oldHeads) {
      for (const n of newHeads) {
        // N's program sets have ids of their own (t…); the chain pairs old → new for the head and for each stage that has
        // a partner in the new head (same stage name), as the call's re-pointing would have left them.
        const old = [dex('R', 0, defaultRow('R', o, (s) => s, (s) => s).sets, 'ex-r')]
        const neu = [dex('N', 0, defaultRow('N', n, (s) => (s === 'a1' ? 'b1' : s), (s) => `t-${s}`).sets, 'ex-n')]
        const evidenceIds = new Set(['a1', ...o.stages])
        const chain = new Map<string, string>([['a1', 'b1']])
        for (const s of o.stages) if (n.stages.includes(s)) chain.set(s, `t-${s}`)
        for (const w of weekHeads) {
          const week = later('R', [
            wset('h', 'R', 'a1', w.head),
            ...w.stages.map((programSetId, i) => wset(`st${i + 1}`, 'R', programSetId, { parentWeekPlanSetId: 'h', stageIndex: i + 1 })),
          ], 'ex-r')
          const { result, after } = run(old, neu, week, new Map([['N', evidenceIds]]), chain)
          if (result.status === 'applied') written++
          const bad = warmupAndStaged(after)
          if (bad.length > 0) offenders.push(`old ${o.name} -> new ${n.name} (swapped) on week ${w.name}: ${bad.join(',')}`)
        }
      }
    }
    expect(written).toBeGreaterThan(30)
    expect(offenders).toEqual([])
  })

  // The writes of a part that does apply are not lost to the guards: a week that holds the old head takes the change.
  it('...and a week that holds the old head still takes the new one, whole', () => {
    const cases: { old: Head; neu: Head; week: (typeof weekHeads)[number]; expected: { warmup: boolean; stages: number } }[] = [
      { old: oldHeads[0], neu: newHeads[1], week: weekHeads[0], expected: { warmup: true, stages: 0 } }, // plain -> warmup
      { old: oldHeads[4], neu: newHeads[1], week: weekHeads[5], expected: { warmup: true, stages: 0 } }, // dropset (s1) -> warmup: its stages go
      { old: oldHeads[0], neu: newHeads[4], week: weekHeads[0], expected: { warmup: false, stages: 2 } }, // plain -> dropset with two stages
      { old: oldHeads[2], neu: newHeads[0], week: weekHeads[2], expected: { warmup: false, stages: 0 } }, // warmup -> plain
    ]
    for (const c of cases) {
      const old = [defaultRow('pe-1', c.old, (s) => s, (s) => s)]
      const neu = [defaultRow('pe-1', c.neu, (s) => s, (s) => s)]
      // (week stages that the old default does not have are the week's own; drop them from the fixture)
      const stages = c.week.stages.filter((s) => s === null || c.old.stages.includes(s))
      const week = headWeek(c.week.head, stages.map((programSetId) => ({ programSetId })))
      const { after } = run(old, neu, week)
      const head = headsOf(after).find((h) => h.programSetId === 'a1')!
      expect([head.isWarmup, stagesOf(after, head.id).length]).toEqual([c.expected.warmup, c.expected.stages])
    }
  })
})
