import { describe, it, expect } from 'vitest'
import type { ProgramSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary.js'
import { applySetType, sameSetType, setTypeId, type SetType, type SetTypeId } from '../../components/pickers/pickerLogic'
import { nextProgramPosition, programRows, programSetTypeChange, programSetTypeOf, type ProgramRow, type ProgramSetTypeOp } from './programSetRows'

// Chunk 67 (TASKS-1.2; SPEC Set types and staged sets [1.2]). The planner's one mapping from a picked set type to program set writes, and its
// rows. Pure, so it is proven here against a model of the two checks the writes must respect (v2_program_sets_warmup_check and the stage row's own),
// at every step of every change, not only at its end; the screen files prove the same writes end to end against a stand-in for the table.

const ps = (id: string, over: Partial<ProgramSet> = {}): ProgramSet => ({
  id, userId: 'user-1', programExerciseId: 'pe-1', position: 1, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '2026-01-01T00:00:00Z', ...over,
})
const stage = (id: string, parent: string, index: number, position = 1): ProgramSet => ps(id, { parentProgramSetId: parent, stageIndex: index, position })

const rowOf = (head: ProgramSet, stages: ProgramSet[] = []): Pick<ProgramRow, 'head' | 'stages'> => ({ head, stages })

describe('programRows — an exercise\'s sets in order, each with its stages and the number it shows', () => {
  const sets = [
    ps('c', { position: 3 }),
    stage('a-s2', 'a', 2, 1),
    ps('a', { position: 1, isWarmup: true }),
    stage('a-s1', 'a', 1, 1),
    ps('b', { position: 2 }),
  ]

  it('orders heads by position and stages by index, numbers by rank (a warmup counts), and pads the label', () => {
    const rows = programRows(sets)
    expect(rows.map((r) => [r.head.id, r.stages.map((s) => s.id), r.number, r.label])).toEqual([
      ['a', ['a-s1', 'a-s2'], 1, '01'],
      ['b', [], 2, '02'],
      ['c', [], 3, '03'],
    ])
  })

  it('the same rows whatever order the read came back in (every ordering of the input)', () => {
    const expected = programRows(sets).map((r) => [r.head.id, r.stages.map((s) => s.id), r.number])
    const permutations = (xs: ProgramSet[]): ProgramSet[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])))
    for (const order of permutations(sets)) {
      expect(programRows(order).map((r) => [r.head.id, r.stages.map((s) => s.id), r.number])).toEqual(expected)
    }
  })

  it('a gap in the stored positions (REMOVE THIS SET leaves one) is not a gap in the numbers', () => {
    const rows = programRows([ps('a', { position: 1 }), ps('c', { position: 3 }), ps('d', { position: 4 })])
    expect(rows.map((r) => [r.head.id, r.head.position, r.number])).toEqual([['a', 1, 1], ['c', 3, 2], ['d', 4, 3]])
  })

  it('two heads that share a position (the old stepper could write that) are numbered the same way on every phone: by id', () => {
    const a = programRows([ps('y', { position: 2 }), ps('x', { position: 2 })])
    const b = programRows([ps('x', { position: 2 }), ps('y', { position: 2 })])
    expect(a.map((r) => r.head.id)).toEqual(['x', 'y'])
    expect(b.map((r) => r.head.id)).toEqual(['x', 'y'])
  })

  it('no sets, no rows', () => {
    expect(programRows([])).toEqual([])
  })
})

describe('nextProgramPosition — "+ always adds after the highest position" (DECISIONS 213 (a))', () => {
  it('one past the highest, whatever the count and the order', () => {
    expect(nextProgramPosition([])).toBe(1)
    expect(nextProgramPosition([{ position: 1 }, { position: 2 }, { position: 3 }])).toBe(4)
    expect(nextProgramPosition([{ position: 3 }, { position: 1 }])).toBe(4) // set 2 of 1–3 was removed: 2 heads, position 4, never 3
    expect(nextProgramPosition([{ position: 7 }])).toBe(8)
  })
})

describe('programSetTypeOf — what the picker is opened on', () => {
  it('a warmup is a warmup, even when it holds a stage kind or stages (it can not, the table refuses it)', () => {
    expect(programSetTypeOf(rowOf(ps('a', { isWarmup: true })))).toEqual({ kind: 'warmup' })
  })
  it('a head with stages is staged: its kind (null reads as a dropset), how many stages it has and the rest between them', () => {
    expect(programSetTypeOf(rowOf(ps('a', { stageKind: 'cluster', stageRestSeconds: 30 }), [stage('s1', 'a', 1), stage('s2', 'a', 2)]))).toEqual({ kind: 'staged', stageKind: 'cluster', stageCount: 2, stageRestSeconds: 30 })
    expect(programSetTypeOf(rowOf(ps('a'), [stage('s1', 'a', 1)]))).toEqual({ kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })
  })
  it('a head with a kind and no stage is Normal: the stages are what make a set staged', () => {
    expect(programSetTypeOf(rowOf(ps('a', { stageKind: 'myo_reps', stageRestSeconds: 15 })))).toEqual({ kind: 'normal' })
  })
})

// ─── What picking a type writes ──────────────────────────────────────────────────────────────────────

describe('programSetTypeChange — the writes, in the order the table allows', () => {
  const a = (over: Partial<ProgramSet> = {}) => ps('a', { position: 4, ...over })
  const staged = (n: number, over: Partial<ProgramSet> = {}) => rowOf(a({ stageKind: 'rest_pause', stageRestSeconds: 20, ...over }), Array.from({ length: n }, (_, i) => stage(`s${i + 1}`, 'a', i + 1, 4)))
  const normal: SetType = { kind: 'normal' }
  const warmup: SetType = { kind: 'warmup' }

  it('the same type, or one that differs in nothing stored, is no change', () => {
    expect(programSetTypeChange(rowOf(a()), normal)).toEqual([])
    expect(programSetTypeChange(rowOf(a({ isWarmup: true })), warmup)).toEqual([])
    expect(programSetTypeChange(staged(2), { kind: 'staged', stageKind: 'rest_pause', stageCount: 2, stageRestSeconds: 20 })).toEqual([])
    expect(programSetTypeChange(rowOf(a(), [stage('s1', 'a', 1)]), { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null })).toEqual([])
  })

  it('Normal to a staged kind: the head\'s kind, then the first stage at the head\'s position with index 1 (what the chip and ADD STAGE wrote)', () => {
    expect(programSetTypeChange(rowOf(a()), applySetType(normal, 'dropset'))).toEqual([
      { kind: 'stageKind', id: 'a', stageKind: 'dropset' },
      { kind: 'addStage', programExerciseId: 'pe-1', parentId: 'a', position: 4, stageIndex: 1 },
    ])
  })

  it('a warmup to a staged kind: no longer a warmup first, then the kind, then the stage', () => {
    expect(programSetTypeChange(rowOf(a({ isWarmup: true })), applySetType(warmup, 'cluster')).map((op) => op.kind)).toEqual(['isWarmup', 'stageKind', 'addStage'])
    expect(programSetTypeChange(rowOf(a({ isWarmup: true })), applySetType(warmup, 'cluster'))[0]).toEqual({ kind: 'isWarmup', id: 'a', isWarmup: false })
  })

  it('a staged set to Warmup: the stages (highest index first), the kind, the rest between stages, then the flag', () => {
    expect(programSetTypeChange(staged(2), warmup)).toEqual([
      { kind: 'removeStage', id: 's2' },
      { kind: 'removeStage', id: 's1' },
      { kind: 'stageKind', id: 'a', stageKind: null },
      { kind: 'stageRest', id: 'a', stageRestSeconds: null },
      { kind: 'isWarmup', id: 'a', isWarmup: true },
    ])
  })

  it('a staged set to Normal: the same, with no flag to write', () => {
    expect(programSetTypeChange(staged(1), normal)).toEqual([
      { kind: 'removeStage', id: 's1' },
      { kind: 'stageKind', id: 'a', stageKind: null },
      { kind: 'stageRest', id: 'a', stageRestSeconds: null },
    ])
  })

  it('names only what is stored: no kind to clear on a head that has none, no rest to clear where there is none', () => {
    expect(programSetTypeChange(rowOf(a(), [stage('s1', 'a', 1)]), warmup)).toEqual([
      { kind: 'removeStage', id: 's1' },
      { kind: 'isWarmup', id: 'a', isWarmup: true },
    ])
    expect(programSetTypeChange(rowOf(a()), warmup)).toEqual([{ kind: 'isWarmup', id: 'a', isWarmup: true }])
    expect(programSetTypeChange(rowOf(a({ isWarmup: true })), normal)).toEqual([{ kind: 'isWarmup', id: 'a', isWarmup: false }])
  })

  it('a plain head that holds a stale kind (no stages) has it cleared before the flag, or the table refuses the flag', () => {
    expect(programSetTypeChange(rowOf(a({ stageKind: 'cluster' })), warmup)).toEqual([
      { kind: 'stageKind', id: 'a', stageKind: null },
      { kind: 'isWarmup', id: 'a', isWarmup: true },
    ])
  })

  it('one staged kind to another keeps the stages and the rest between them: only the kind is written', () => {
    expect(programSetTypeChange(staged(2), applySetType(programSetTypeOf(staged(2)), 'myo_reps'))).toEqual([{ kind: 'stageKind', id: 'a', stageKind: 'myo_reps' }])
  })

  it('the stage stepper: one more stage is one past the highest index (a gap is not filled), one fewer removes the highest', () => {
    const gapped = rowOf(a({ stageKind: 'dropset' }), [stage('s1', 'a', 1, 4), stage('s3', 'a', 3, 4)])
    const current = programSetTypeOf(gapped) as Extract<SetType, { kind: 'staged' }>
    expect(programSetTypeChange(gapped, { ...current, stageCount: 3 })).toEqual([{ kind: 'addStage', programExerciseId: 'pe-1', parentId: 'a', position: 4, stageIndex: 4 }])
    expect(programSetTypeChange(gapped, { ...current, stageCount: 1 })).toEqual([{ kind: 'removeStage', id: 's3' }])
    expect(programSetTypeChange(gapped, { ...current, stageCount: 4 }).map((op) => (op.kind === 'addStage' ? op.stageIndex : null))).toEqual([4, 5])
  })

  it('REST BETWEEN: only the head\'s stage_rest_seconds is written, after the stages; null goes back to the kind\'s own', () => {
    const current = programSetTypeOf(staged(1)) as Extract<SetType, { kind: 'staged' }>
    expect(programSetTypeChange(staged(1), { ...current, stageRestSeconds: 35 })).toEqual([{ kind: 'stageRest', id: 'a', stageRestSeconds: 35 }])
    expect(programSetTypeChange(staged(1), { ...current, stageRestSeconds: null })).toEqual([{ kind: 'stageRest', id: 'a', stageRestSeconds: null }])
  })

  it('a stage added by a pick carries nothing of its own: the op names the head and the stage index, no kind, rest or warmup flag', () => {
    const op = programSetTypeChange(rowOf(a()), applySetType(normal, 'dropset')).find((o) => o.kind === 'addStage')!
    expect(Object.keys(op).sort()).toEqual(['kind', 'parentId', 'position', 'programExerciseId', 'stageIndex'])
  })

  it('the stages in any order give the same writes', () => {
    const forward = programSetTypeChange(staged(3), warmup)
    const reversed = { head: staged(3).head, stages: [...staged(3).stages].reverse() }
    expect(programSetTypeChange(reversed, warmup)).toEqual(forward)
    expect(forward.filter((o) => o.kind === 'removeStage').map((o) => (o as { id: string }).id)).toEqual(['s3', 's2', 's1'])
    const current = programSetTypeOf(staged(3)) as Extract<SetType, { kind: 'staged' }>
    expect(programSetTypeChange(reversed, { ...current, stageCount: 1 })).toEqual(programSetTypeChange(staged(3), { ...current, stageCount: 1 }))
    expect(programSetTypeChange(reversed, { ...current, stageCount: 5 })).toEqual(programSetTypeChange(staged(3), { ...current, stageCount: 5 }))
  })
})

// ─── Every change, step by step, against the table's checks ────────────────────────────────────────────

interface Model {
  isWarmup: boolean
  stageKind: StageKind | null
  stageRest: number | null
  stages: number[]
}

/** The rows' state a write list leaves after each write; throws where the table would refuse the write. */
function replay(start: Model, ops: ProgramSetTypeOp[]): Model[] {
  const states: Model[] = [start]
  let m = { ...start, stages: [...start.stages] }
  for (const op of ops) {
    m = { ...m, stages: [...m.stages] }
    if (op.kind === 'removeStage') {
      if (!m.stages.includes(Number(op.id.slice(1)))) throw new Error(`removing a stage that is not there: ${op.id}`)
      m.stages = m.stages.filter((i) => i !== Number(op.id.slice(1)))
    } else if (op.kind === 'isWarmup') m.isWarmup = op.isWarmup
    else if (op.kind === 'stageKind') m.stageKind = op.stageKind
    else if (op.kind === 'stageRest') m.stageRest = op.stageRestSeconds
    else {
      if (m.stages.includes(op.stageIndex)) throw new Error(`stage index ${op.stageIndex} written twice`)
      m.stages.push(op.stageIndex)
    }
    // v2_program_sets_warmup_check, at every step: a warmup has no stage kind and no stage under it
    if (m.isWarmup && (m.stageKind !== null || m.stages.length > 0)) throw new Error(`a warmup with ${m.stageKind ?? 'stages'} after ${JSON.stringify(op)}`)
    states.push(m)
  }
  return states
}

describe('programSetTypeChange — every change from every kind of set to every type, at every step', () => {
  const STAGED: StageKind[] = ['dropset', 'rest_pause', 'myo_reps', 'cluster']
  // the kinds of set a program can hold: plain, plain with a stale kind or rest, a warmup, and staged ones (a null kind is a dropset)
  const STARTS: Model[] = [
    { isWarmup: false, stageKind: null, stageRest: null, stages: [] },
    { isWarmup: false, stageKind: 'cluster', stageRest: 15, stages: [] },
    { isWarmup: true, stageKind: null, stageRest: null, stages: [] },
    { isWarmup: false, stageKind: null, stageRest: null, stages: [1] },
    { isWarmup: false, stageKind: 'dropset', stageRest: null, stages: [1, 3] },
    { isWarmup: false, stageKind: 'rest_pause', stageRest: 20, stages: [1, 2, 3] },
    { isWarmup: false, stageKind: 'myo_reps', stageRest: 15, stages: [2] },
  ]
  const TARGETS: SetType[] = [
    { kind: 'normal' },
    { kind: 'warmup' },
    ...STAGED.flatMap((stageKind) => [1, 2, 4].flatMap((stageCount) => [null, 30].map((stageRestSeconds): SetType => ({ kind: 'staged', stageKind, stageCount, stageRestSeconds })))),
  ]

  const rowFor = (m: Model): Pick<ProgramRow, 'head' | 'stages'> =>
    rowOf(ps('a', { position: 2, isWarmup: m.isWarmup, stageKind: m.stageKind, stageRestSeconds: m.stageRest }), m.stages.map((i) => stage(`s${i}`, 'a', i, 2)))

  it('every prefix of every change is a set the table accepts, and the end is the type that was picked', () => {
    let changes = 0
    for (const start of STARTS) {
      for (const target of TARGETS) {
        const row = rowFor(start)
        const ops = programSetTypeChange(row, target)
        const states = replay(start, ops)
        const end = states[states.length - 1]
        const label = `${JSON.stringify(start)} -> ${JSON.stringify(target)}`
        // the end reads as the picked type
        expect(programSetTypeOf(rowFor(end)), label).toSatisfy((got: SetType) => sameSetType(got, target))
        if (ops.length > 0) changes += 1
        // a stage row never holds a kind, a rest or the flag of its own: the ops never name them on a stage
        for (const op of ops) if (op.kind !== 'addStage' && op.kind !== 'removeStage') expect(op.id, label).toBe('a')
        // A pick that is no change (a plain set that holds a stale kind, read as Normal, picked as Normal) writes nothing, and the stale
        // columns stay where they are: they show nowhere, and the next pick that needs them clean clears them (the Warmup case above).
        if (ops.length === 0) continue
        // staged ends carry the picked rest between stages; a Normal or Warmup end carries none
        if (target.kind === 'staged') expect(end.stageRest, label).toBe(target.stageRestSeconds)
        else expect([end.stageKind, end.stageRest, end.stages.length], label).toEqual([null, null, 0])
        expect(end.isWarmup, label).toBe(target.kind === 'warmup')
        // writing the same type again after the change is nothing
        expect(programSetTypeChange(rowFor(end), target), label).toEqual([])
      }
    }
    expect(changes).toBeGreaterThan(50)
  })

  it('the picker\'s own steps (a pick, then a stepper tap) reach what the picker held', () => {
    const start = rowFor({ isWarmup: true, stageKind: null, stageRest: null, stages: [] })
    const picked = applySetType(programSetTypeOf(start), 'dropset' as SetTypeId)
    expect(setTypeId(picked)).toBe('dropset')
    const ops = programSetTypeChange(start, picked)
    expect(replay({ isWarmup: true, stageKind: null, stageRest: null, stages: [] }, ops).pop()).toEqual({ isWarmup: false, stageKind: 'dropset', stageRest: null, stages: [1] })
  })
})
