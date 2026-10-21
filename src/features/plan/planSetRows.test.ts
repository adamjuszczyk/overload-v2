import { describe, it, expect } from 'vitest'
import type { ProgramExercise, ProgramSet, WeekPlanSet } from '../../types'
import { rirRange, type SetType } from '../../components/pickers/pickerLogic'
import {
  cuePatches,
  kindChipText,
  newSetFor,
  nextSetNumber,
  ownProgramSet,
  planRows,
  planSetTypeChange,
  removalOrder,
  repTargetPatches,
  rirTargetPatches,
  setTypeOfRow,
  supersetChips,
  type PlanRow,
} from './planSetRows'
import { addSetDefaults } from './weekPlanning'

// Chunk 54a — the rules behind Plan's set rows, each as a pure function, each tested on the rows earlier steps leave behind (gaps in the numbers,
// stages out of order, a legacy head with no kind), not only on fresh ones. The screens that call them (PlanPage.rows / sheets / e2e tests)
// prove the wiring; these prove the rules.

const head = (id: string, setNumber: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id,
  weekPlanId: 'wp-1',
  userId: 'u',
  programExerciseId: 'pe-1',
  setNumber,
  targetRir: 2,
  isDropset: false,
  parentWeekPlanSetId: null,
  stageIndex: 0,
  isWarmup: false,
  targetWeight: 100,
  repMin: 8,
  repMax: 8,
  ...over,
})
const stage = (id: string, parent: string, setNumber: number, stageIndex: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet =>
  head(id, setNumber, { isDropset: true, parentWeekPlanSetId: parent, stageIndex, ...over })
const rowOf = (h: WeekPlanSet, stages: WeekPlanSet[] = []): PlanRow => planRows([h, ...stages])[0]
const programSet = (id: string, programExerciseId: string, over: Partial<ProgramSet> = {}): ProgramSet => ({
  id, userId: 'u', programExerciseId, position: 0, isWarmup: false, stageKind: null, stageRestSeconds: null, parentProgramSetId: null,
  stageIndex: 0, repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})

describe('planRows — an exercise\'s rows in set order, working sets numbered from 1 and warmups W', () => {
  it('orders heads by set number whatever order they came in, each with its stages by stage index', () => {
    const rows = planRows([head('c', 7), head('a', 1), head('b', 3), stage('b2', 'b', 3, 2), stage('b1', 'b', 3, 1), head('d', 3)])
    expect(rows.map((r) => r.head.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(rows[1].stages.map((s) => s.id)).toEqual(['b1', 'b2'])
    expect(rows.map((r) => r.label)).toEqual(['01', '02', '03', '04'])
  })

  it('the same rows whatever order the input comes in: reversed input, same output — two heads with one number order by id', () => {
    const input = [head('c', 7), head('a', 1), head('b', 3), stage('b2', 'b', 3, 2), stage('b1', 'b', 3, 1), head('d', 3)]
    const shape = (rows: PlanRow[]) => rows.map((r) => [r.head.id, r.label, r.stages.map((s) => s.id)])
    expect(shape(planRows([...input].reverse()))).toEqual(shape(planRows(input)))
    expect(shape(planRows(input)).map((r) => r[0])).toEqual(['a', 'b', 'd', 'c'])
  })

  it('a warmup is W and never takes a working set\'s number: W, 01, 02 (board 1)', () => {
    const rows = planRows([head('w', 1, { isWarmup: true }), head('a', 2), head('b', 3)])
    expect(rows.map((r) => r.label)).toEqual(['W', '01', '02'])
    expect(rows.map((r) => r.eyebrowNumber)).toEqual([1, 1, 2])
  })

  it('two warmups are both W and count among the warmups for the picker\'s eyebrow; the working sets after them still start at 01', () => {
    const rows = planRows([head('w1', 1, { isWarmup: true }), head('w2', 2, { isWarmup: true }), head('a', 3)])
    expect(rows.map((r) => r.label)).toEqual(['W', 'W', '01'])
    expect(rows.map((r) => r.eyebrowNumber)).toEqual([1, 2, 1])
  })

  it('a stage never gets a row of its own: it is in its head\'s', () => {
    const rows = planRows([head('a', 1), stage('s1', 'a', 1, 1), stage('s2', 'a', 1, 2)])
    expect(rows).toHaveLength(1)
    expect(rows[0].stages).toHaveLength(2)
  })

  it('an exercise with no sets has no rows', () => {
    expect(planRows([])).toEqual([])
  })
})

describe('nextSetNumber / newSetFor — "+ ADD SET": one past the highest head number, the last head\'s rep target, nothing else', () => {
  it('one past the highest head number: 4 after heads 1, 2, 3', () => {
    expect(nextSetNumber([head('a', 1), head('b', 2), head('c', 3)])).toBe(4)
  })

  it('a removed middle set leaves a gap and the new number still follows the last one (a count would repeat 3)', () => {
    expect(nextSetNumber([head('a', 1), head('c', 3)])).toBe(4)
  })

  it('a stage is not a head: heads only are passed, so a staged head counts once', () => {
    const rows = planRows([head('a', 1), head('b', 2), stage('b1', 'b', 2, 1), stage('b2', 'b', 2, 2)])
    expect(newSetFor(rows).setNumber).toBe(3)
  })

  it('an exercise with no sets starts at 1 with no rep target', () => {
    expect(newSetFor([])).toEqual({ setNumber: 1, defaults: addSetDefaults(null) })
    expect(newSetFor([]).defaults).toMatchObject({ repMin: null, repMax: null, isAmrap: false })
  })

  it('follows the LAST head\'s rep target, not the first\'s: 8–10 after 12, 8–10', () => {
    const rows = planRows([head('a', 1, { repMin: 12, repMax: 12 }), head('b', 2, { repMin: 8, repMax: 10 })])
    expect(newSetFor(rows).defaults).toMatchObject({ repMin: 8, repMax: 10, isAmrap: false })
  })

  it('a staged last head gives its OWN rep target, never its last stage\'s', () => {
    const rows = planRows([head('a', 1, { repMin: 8, repMax: 10 }), stage('s1', 'a', 1, 1, { repMin: 20, repMax: 20 })])
    expect(newSetFor(rows).defaults).toMatchObject({ repMin: 8, repMax: 10 })
  })

  it('AMRAP carries over as the flag with no numbers', () => {
    const rows = planRows([head('a', 1, { repMin: null, repMax: null, isAmrap: true })])
    expect(newSetFor(rows).defaults).toMatchObject({ repMin: null, repMax: null, isAmrap: true })
  })

  it('is a Normal set with no weight, no RIR and no range, whatever the last set held', () => {
    const rows = planRows([head('a', 1, { targetWeight: 102.5, targetRir: 1, targetRirMax: 2, tags: ['push here'], stageKind: 'cluster' })])
    expect(newSetFor(rows).defaults).toEqual({ isWarmup: false, stageKind: null, repMin: 8, repMax: 8, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null })
  })

  it('the last head is the highest number, whatever its place in the list', () => {
    const rows = [rowOf(head('late', 9, { repMin: 5, repMax: 5 })), rowOf(head('early', 1, { repMin: 12, repMax: 12 }))]
    expect(newSetFor(rows).defaults).toMatchObject({ repMin: 5, repMax: 5 })
    expect(newSetFor(rows).setNumber).toBe(10)
  })
})

describe('ownProgramSet — the workout screen\'s own lookup: the set\'s program set, among its own exercise row\'s (G45)', () => {
  const weekSet = (over: Partial<WeekPlanSet>) => head('ws-1', 1, { programSetId: 'ps-1', ...over })
  const byId = (...sets: ProgramSet[]) => new Map(sets.map((s) => [s.id, s]))

  it('finds the program set a week set names when it belongs to the set\'s own exercise row', () => {
    const own = programSet('ps-1', 'pe-1')
    expect(ownProgramSet(weekSet({ programSetId: 'ps-1', programExerciseId: 'pe-1' }), byId(own))).toBe(own)
  })

  it('finds nothing for a set that names none (a set added in a week, an added exercise\'s sets)', () => {
    expect(ownProgramSet(weekSet({ programSetId: null }), byId(programSet('ps-1', 'pe-1')))).toBeNull()
    expect(ownProgramSet(weekSet({ programSetId: undefined }), byId(programSet('ps-1', 'pe-1')))).toBeNull()
  })

  it('finds nothing for one that names a program set which is gone, or not loaded', () => {
    expect(ownProgramSet(weekSet({ programSetId: 'ps-gone' }), byId(programSet('ps-1', 'pe-1')))).toBeNull()
    expect(ownProgramSet(weekSet({ programSetId: 'ps-1' }), byId())).toBeNull()
  })

  // CHANGE THE PROGRAM's swap inserts a new program-exercise row and soft-removes the old one; a set of the swapped-in row can still name
  // the replaced row's program set. The program set exists and is loaded; it is just not this exercise's, and the workout screen never
  // reads it for this row (G45 answered "no").
  it('refuses a program set that belongs to ANOTHER exercise row, though it exists', () => {
    const replacedRows = programSet('ps-1', 'pe-replaced')
    expect(ownProgramSet(weekSet({ programSetId: 'ps-1', programExerciseId: 'pe-swapped-in' }), byId(replacedRows))).toBeNull()
  })

  it('and compares the exercise rows, not the ids of the two sets', () => {
    const a = programSet('ps-a', 'pe-a')
    const b = programSet('ps-b', 'pe-b')
    expect(ownProgramSet(weekSet({ programSetId: 'ps-a', programExerciseId: 'pe-b' }), byId(a, b))).toBeNull()
    expect(ownProgramSet(weekSet({ programSetId: 'ps-b', programExerciseId: 'pe-b' }), byId(a, b))).toBe(b)
  })
})

describe('setTypeOfRow — what the set type picker opens on', () => {
  it('a plain head is Normal; a warmup is a warmup', () => {
    expect(setTypeOfRow(rowOf(head('a', 1)), null)).toEqual({ kind: 'normal' })
    expect(setTypeOfRow(rowOf(head('a', 1, { isWarmup: true })), null)).toEqual({ kind: 'warmup' })
  })

  it('a head with stage rows is staged: its kind, the number of rows it has, and its own program set\'s rest between stages', () => {
    const row = rowOf(head('a', 1, { stageKind: 'cluster' }), [stage('s1', 'a', 1, 1), stage('s2', 'a', 1, 2), stage('s3', 'a', 1, 3)])
    expect(setTypeOfRow(row, null)).toEqual({ kind: 'staged', stageKind: 'cluster', stageCount: 3, stageRestSeconds: null })
    expect(setTypeOfRow(row, programSet('ps', 'pe-1', { stageRestSeconds: 30 }))).toEqual({ kind: 'staged', stageKind: 'cluster', stageCount: 3, stageRestSeconds: 30 })
  })

  it('a staged head with no kind is a dropset (the legacy reading)', () => {
    expect(setTypeOfRow(rowOf(head('a', 1), [stage('s1', 'a', 1, 1)]), null)).toMatchObject({ kind: 'staged', stageKind: 'dropset' })
  })

  it('a head that has a kind but no stage rows is Normal: the stages are what make a set staged', () => {
    expect(setTypeOfRow(rowOf(head('a', 1, { stageKind: 'dropset' })), null)).toEqual({ kind: 'normal' })
  })

  it('a warmup is a warmup whatever else it holds (a stage row left under it does not make it staged)', () => {
    expect(setTypeOfRow(rowOf(head('a', 1, { isWarmup: true }), [stage('s1', 'a', 1, 1)]), null)).toEqual({ kind: 'warmup' })
  })
})

describe('planSetTypeChange — what picking a type writes, in the order it must be written', () => {
  const staged = (stageKind: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster', stageCount: number, stageRestSeconds: number | null = null): SetType => ({
    kind: 'staged', stageKind, stageCount, stageRestSeconds,
  })

  it('the same type is no change', () => {
    expect(planSetTypeChange(rowOf(head('h', 3)), { kind: 'normal' }, null)).toEqual({ ops: [] })
    expect(planSetTypeChange(rowOf(head('h', 3, { isWarmup: true })), { kind: 'warmup' }, null)).toEqual({ ops: [] })
    expect(planSetTypeChange(rowOf(head('h', 3), [stage('s', 'h', 3, 1)]), staged('dropset', 1), null)).toEqual({ ops: [] })
  })

  describe('Normal to a staged kind', () => {
    it('Dropset writes stage_kind "dropset" on the head and adds one stage under it: its number, its first index, the week and exercise of the head', () => {
      const change = planSetTypeChange(rowOf(head('h', 3)), staged('dropset', 1), null)
      expect(change.ops).toEqual([
        { kind: 'updateHead', id: 'h', changes: { stageKind: 'dropset' } },
        { kind: 'addStage', weekPlanId: 'wp-1', programExerciseId: 'pe-1', parentId: 'h', setNumber: 3, stageIndex: 1 },
      ])
      expect(change.stageRest).toBeUndefined()
    })

    it('each kind writes its own', () => {
      for (const kind of ['rest_pause', 'myo_reps', 'cluster'] as const) {
        expect(planSetTypeChange(rowOf(head('h', 1)), staged(kind, 1), null).ops[0]).toEqual({ kind: 'updateHead', id: 'h', changes: { stageKind: kind } })
      }
    })

    it('a head that already carries a stale kind still has it written, so a plain set picked Dropset reads Dropset', () => {
      const ops = planSetTypeChange(rowOf(head('h', 1, { stageKind: 'cluster' })), staged('dropset', 1), null).ops
      expect(ops[0]).toEqual({ kind: 'updateHead', id: 'h', changes: { stageKind: 'dropset' } })
    })
  })

  describe('a staged set\'s stepper', () => {
    const two = () => rowOf(head('h', 2, { stageKind: 'dropset' }), [stage('s1', 'h', 2, 1), stage('s2', 'h', 2, 2)])

    it('one more adds a stage one past the highest index (not the count: a gap in the indexes would collide)', () => {
      const gapped = rowOf(head('h', 2, { stageKind: 'dropset' }), [stage('s1', 'h', 2, 1), stage('s3', 'h', 2, 3)])
      expect(planSetTypeChange(gapped, staged('dropset', 3), null).ops).toEqual([
        { kind: 'addStage', weekPlanId: 'wp-1', programExerciseId: 'pe-1', parentId: 'h', setNumber: 2, stageIndex: 4 },
      ])
    })

    it('two more add two, indexes one apart', () => {
      const ops = planSetTypeChange(two(), staged('dropset', 4), null).ops
      expect(ops.map((o) => o.kind === 'addStage' && o.stageIndex)).toEqual([3, 4])
    })

    it('one fewer removes the LAST stage (the highest index), never the first', () => {
      expect(planSetTypeChange(two(), staged('dropset', 1), null).ops).toEqual([{ kind: 'removeStage', id: 's2' }])
    })

    it('removes from the highest index down, whatever order the stage rows came in', () => {
      const shuffled = rowOf(head('h', 2, { stageKind: 'dropset' }), [stage('s2', 'h', 2, 2), stage('s3', 'h', 2, 3), stage('s1', 'h', 2, 1)])
      expect(planSetTypeChange(shuffled, staged('dropset', 1), null).ops).toEqual([{ kind: 'removeStage', id: 's3' }, { kind: 'removeStage', id: 's2' }])
    })

    it('a stepper tap writes no head column: the kind is the same', () => {
      expect(planSetTypeChange(two(), staged('dropset', 3), null).ops.every((o) => o.kind === 'addStage')).toBe(true)
    })
  })

  describe('a kind change on a staged set', () => {
    it('writes the head\'s new kind and keeps the stages it has', () => {
      const row = rowOf(head('h', 2, { stageKind: 'dropset' }), [stage('s1', 'h', 2, 1), stage('s2', 'h', 2, 2)])
      expect(planSetTypeChange(row, staged('cluster', 2), null).ops).toEqual([{ kind: 'updateHead', id: 'h', changes: { stageKind: 'cluster' } }])
    })

    it('a legacy head with no kind picked Dropset is no change (it reads as a dropset already); picked Cluster writes it', () => {
      const legacy = rowOf(head('h', 2), [stage('s1', 'h', 2, 1)])
      expect(planSetTypeChange(legacy, staged('dropset', 1), null).ops).toEqual([])
      expect(planSetTypeChange(legacy, staged('cluster', 1), null).ops).toEqual([{ kind: 'updateHead', id: 'h', changes: { stageKind: 'cluster' } }])
    })

    it('the kind goes first, then the stages are added or removed', () => {
      const row = rowOf(head('h', 2, { stageKind: 'dropset' }), [stage('s1', 'h', 2, 1)])
      const ops = planSetTypeChange(row, staged('cluster', 3), null).ops
      expect(ops.map((o) => o.kind)).toEqual(['updateHead', 'addStage', 'addStage'])
    })
  })

  describe('to Normal or Warmup: the stages come off first, then the head is written', () => {
    const threeStages = () => rowOf(head('h', 2, { stageKind: 'dropset' }), [stage('s1', 'h', 2, 1), stage('s2', 'h', 2, 2), stage('s3', 'h', 2, 3)])

    it('Warmup on a staged head removes every stage (highest first), and only then writes is_warmup true and clears the kind', () => {
      expect(planSetTypeChange(threeStages(), { kind: 'warmup' }, null).ops).toEqual([
        { kind: 'removeStage', id: 's3' },
        { kind: 'removeStage', id: 's2' },
        { kind: 'removeStage', id: 's1' },
        { kind: 'updateHead', id: 'h', changes: { isWarmup: true, stageKind: null } },
      ])
    })

    it('Normal on a staged head removes the stages and clears the kind, and does not touch is_warmup', () => {
      expect(planSetTypeChange(threeStages(), { kind: 'normal' }, null).ops).toEqual([
        { kind: 'removeStage', id: 's3' },
        { kind: 'removeStage', id: 's2' },
        { kind: 'removeStage', id: 's1' },
        { kind: 'updateHead', id: 'h', changes: { stageKind: null } },
      ])
    })

    it('Warmup on a plain set writes is_warmup true and nothing else', () => {
      expect(planSetTypeChange(rowOf(head('h', 1)), { kind: 'warmup' }, null).ops).toEqual([{ kind: 'updateHead', id: 'h', changes: { isWarmup: true } }])
    })

    it('Normal on a warmup writes is_warmup false and nothing else', () => {
      expect(planSetTypeChange(rowOf(head('h', 1, { isWarmup: true })), { kind: 'normal' }, null).ops).toEqual([{ kind: 'updateHead', id: 'h', changes: { isWarmup: false } }])
    })

    it('a plain set that has a stale kind is cleared when it is made Normal again? No: it is Normal already, so nothing is written', () => {
      expect(planSetTypeChange(rowOf(head('h', 1, { stageKind: 'dropset' })), { kind: 'normal' }, null).ops).toEqual([])
    })

    it('a warmup that has stage rows left under it loses them when it is made Normal, so it is not staged by accident', () => {
      const odd = rowOf(head('h', 1, { isWarmup: true }), [stage('s1', 'h', 1, 1)])
      expect(planSetTypeChange(odd, { kind: 'normal' }, null).ops).toEqual([
        { kind: 'removeStage', id: 's1' },
        { kind: 'updateHead', id: 'h', changes: { isWarmup: false } },
      ])
    })
  })

  describe('REST BETWEEN is the program set\'s, not the week\'s', () => {
    const ps = programSet('ps-1', 'pe-1')

    it('moving it writes no week row, and names the program set and the value', () => {
      const row = rowOf(head('h', 2, { stageKind: 'rest_pause' }), [stage('s1', 'h', 2, 1)])
      const change = planSetTypeChange(row, staged('rest_pause', 1, 30), ps)
      expect(change.ops).toEqual([])
      expect(change.stageRest).toEqual({ programSetId: 'ps-1', stageRestSeconds: 30 })
    })

    it('back to the kind\'s own default is null', () => {
      const row = rowOf(head('h', 2, { stageKind: 'rest_pause' }), [stage('s1', 'h', 2, 1)])
      const change = planSetTypeChange(row, staged('rest_pause', 1, null), programSet('ps-1', 'pe-1', { stageRestSeconds: 30 }))
      expect(change.stageRest).toEqual({ programSetId: 'ps-1', stageRestSeconds: null })
    })

    it('a set with no program set of its own writes none (the picker draws no REST BETWEEN for it)', () => {
      const row = rowOf(head('h', 2, { stageKind: 'rest_pause' }), [stage('s1', 'h', 2, 1)])
      expect(planSetTypeChange(row, staged('rest_pause', 1, 30), null).stageRest).toBeUndefined()
    })

    it('a stepper tap that keeps the rest writes no rest', () => {
      const row = rowOf(head('h', 2, { stageKind: 'rest_pause' }), [stage('s1', 'h', 2, 1)])
      expect(planSetTypeChange(row, staged('rest_pause', 2, null), ps).stageRest).toBeUndefined()
    })
  })
})

describe('kindChipText — board 1\'s chip over a staged head', () => {
  it('names the kind and the stages in the kind\'s own noun: one is singular', () => {
    expect(kindChipText('dropset', 1)).toBe('DROPSET · 1 DROP')
    expect(kindChipText('dropset', 2)).toBe('DROPSET · 2 DROPS')
    expect(kindChipText('rest_pause', 1)).toBe('REST-PAUSE · 1 PAUSE')
    expect(kindChipText('rest_pause', 3)).toBe('REST-PAUSE · 3 PAUSES')
    expect(kindChipText('myo_reps', 1)).toBe('MYO-REPS · 1 MINI-SET')
    expect(kindChipText('myo_reps', 4)).toBe('MYO-REPS · 4 MINI-SETS')
    expect(kindChipText('cluster', 1)).toBe('CLUSTER · 1 CLUSTER')
    expect(kindChipText('cluster', 2)).toBe('CLUSTER · 2 CLUSTERS')
  })
})

describe('removalOrder — REMOVE THIS SET takes the stages, highest index first, then the head', () => {
  it('stages descending then the head last', () => {
    const row = rowOf(head('h', 1), [stage('s2', 'h', 1, 2), stage('s1', 'h', 1, 1), stage('s3', 'h', 1, 3)])
    expect(removalOrder(row)).toEqual(['s3', 's2', 's1', 'h'])
  })
  it('a plain set is just itself', () => {
    expect(removalOrder(rowOf(head('h', 1)))).toEqual(['h'])
  })
})

describe('repTargetPatches — a rep target, to one set or with "Use for all" to every head', () => {
  const sets = [
    head('w', 1, { isWarmup: true, targetRir: null, repMin: 12, repMax: 12 }),
    head('a', 2, { repMin: 8, repMax: 10 }),
    stage('as', 'a', 2, 1, { repMin: 6, repMax: 6 }),
    head('b', 3, { repMin: 8, repMax: 10 }),
    head('c', 4, { repMin: 5, repMax: 5, targetRir: null }),
  ]
  const heads = sets.filter((s) => s.parentWeekPlanSetId == null)
  const range = { type: 'range', min: 6, max: 8 } as const

  it('one set writes the three rep columns of that set alone', () => {
    expect(repTargetPatches({ set: heads[1], heads, target: range, applyToAll: false })).toEqual([{ id: 'a', changes: { repMin: 6, repMax: 8, isAmrap: false } }])
  })

  it('"Use for all" writes every head, the warmup included, never the stage row, in head order; a head that already has it is left alone', () => {
    const patches = repTargetPatches({ set: heads[1], heads, target: { type: 'range', min: 8, max: 10 }, applyToAll: true })
    expect(patches.map((p) => p.id)).toEqual(['w', 'c'])
    for (const p of patches) expect(p.changes).toEqual({ repMin: 8, repMax: 10, isAmrap: false })
  })

  it('"Use for all" writes the set itself too when it differs', () => {
    const patches = repTargetPatches({ set: heads[1], heads, target: range, applyToAll: true })
    expect(patches.map((p) => p.id)).toEqual(['w', 'a', 'b', 'c'])
  })

  it('a stage row\'s target is its own: "Use for all" on a stage writes the stage alone', () => {
    const patches = repTargetPatches({ set: sets[2], heads, target: range, applyToAll: true })
    expect(patches).toEqual([{ id: 'as', changes: { repMin: 6, repMax: 8, isAmrap: false } }])
  })

  it('the same target writes nothing', () => {
    expect(repTargetPatches({ set: heads[1], heads, target: { type: 'range', min: 8, max: 10 }, applyToAll: false })).toEqual([])
  })

  it('NONE clears the three columns', () => {
    expect(repTargetPatches({ set: heads[1], heads, target: { type: 'none' }, applyToAll: false })).toEqual([{ id: 'a', changes: { repMin: null, repMax: null, isAmrap: false } }])
  })

  it('a number writes min and max equal', () => {
    expect(repTargetPatches({ set: heads[1], heads, target: { type: 'number', value: 5 }, applyToAll: false })).toEqual([{ id: 'a', changes: { repMin: 5, repMax: 5, isAmrap: false } }])
  })

  describe('AMRAP\'s RIR default (SPEC: "Its RIR defaults to 0, editable")', () => {
    it('a set with no RIR gets RIR 0 in the same write; the rep columns hold the flag and no numbers', () => {
      expect(repTargetPatches({ set: heads[3], heads, target: { type: 'amrap' }, applyToAll: false })).toEqual([{ id: 'c', changes: { repMin: null, repMax: null, isAmrap: true, targetRir: 0 } }])
    })

    it('a set that has a RIR keeps it: no target_rir key at all (0 included)', () => {
      const [patch] = repTargetPatches({ set: heads[1], heads, target: { type: 'amrap' }, applyToAll: false })
      expect('targetRir' in patch.changes).toBe(false)
      const zero = head('z', 5, { targetRir: 0 })
      expect('targetRir' in repTargetPatches({ set: zero, heads: [zero], target: { type: 'amrap' }, applyToAll: false })[0].changes).toBe(false)
    })

    it('"Use for all" AMRAP gives the default to each head that has no RIR and leaves the others\' RIR alone', () => {
      const patches = repTargetPatches({ set: heads[1], heads, target: { type: 'amrap' }, applyToAll: true })
      const byId = Object.fromEntries(patches.map((p) => [p.id, p.changes]))
      expect('targetRir' in byId.a).toBe(false)
      expect('targetRir' in byId.b).toBe(false)
      expect(byId.c).toMatchObject({ targetRir: 0 })
    })

    it('a warmup has no RIR target (G49), so AMRAP never gives it one', () => {
      const [patch] = repTargetPatches({ set: heads[0], heads, target: { type: 'amrap' }, applyToAll: false })
      expect(patch.changes).toEqual({ repMin: null, repMax: null, isAmrap: true })
    })

    it('a non-AMRAP target never touches the RIR, even with none', () => {
      const [patch] = repTargetPatches({ set: heads[3], heads, target: range, applyToAll: false })
      expect('targetRir' in patch.changes).toBe(false)
    })

    it('a set that is already AMRAP is not written, so the default is not given again', () => {
      const amrap = head('m', 6, { repMin: null, repMax: null, isAmrap: true, targetRir: null })
      expect(repTargetPatches({ set: amrap, heads: [amrap], target: { type: 'amrap' }, applyToAll: false })).toEqual([])
    })
  })
})

describe('rirTargetPatches — a RIR target, target_rir and target_rir_max together', () => {
  const sets = [
    head('w', 1, { isWarmup: true, targetRir: null }),
    head('a', 2, { targetRir: 2 }),
    stage('as', 'a', 2, 1, { targetRir: 0 }),
    head('b', 3, { targetRir: 3, targetRirMax: 5 }),
    head('c', 4, { targetRir: null }),
  ]
  const heads = sets.filter((s) => s.parentWeekPlanSetId == null)

  it('a range writes both ends', () => {
    expect(rirTargetPatches({ set: heads[1], heads, target: rirRange(1, 2), applyToAll: false })).toEqual([{ id: 'a', changes: { targetRir: 1, targetRirMax: 2 } }])
  })

  it('a number writes the high end null, so a range it replaces loses its old end', () => {
    expect(rirTargetPatches({ set: heads[2], heads, target: { kind: 'number', value: 2 }, applyToAll: false })).toEqual([{ id: 'b', changes: { targetRir: 2, targetRirMax: null } }])
  })

  it('NONE clears both ends', () => {
    expect(rirTargetPatches({ set: heads[2], heads, target: { kind: 'none' }, applyToAll: false })).toEqual([{ id: 'b', changes: { targetRir: null, targetRirMax: null } }])
  })

  it('"Use for all" skips the warmup and the stage rows, and a head that already holds the target', () => {
    const patches = rirTargetPatches({ set: heads[1], heads, target: rirRange(1, 2), applyToAll: true })
    expect(patches.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    for (const p of patches) expect(p.changes).toEqual({ targetRir: 1, targetRirMax: 2 })
    expect(rirTargetPatches({ set: heads[1], heads, target: { kind: 'number', value: 2 }, applyToAll: true }).map((p) => p.id)).toEqual(['b', 'c'])
  })

  it('a stage row\'s RIR is its own, with or without "Use for all"', () => {
    expect(rirTargetPatches({ set: sets[2], heads, target: rirRange(1, 2), applyToAll: true })).toEqual([{ id: 'as', changes: { targetRir: 1, targetRirMax: 2 } }])
  })

  it('the same target writes nothing', () => {
    expect(rirTargetPatches({ set: heads[1], heads, target: { kind: 'number', value: 2 }, applyToAll: false })).toEqual([])
    expect(rirTargetPatches({ set: heads[2], heads, target: rirRange(3, 5), applyToAll: false })).toEqual([])
  })
})

describe('cuePatches — a set\'s cues, and "Use for all"', () => {
  const sets = [
    head('w', 1, { isWarmup: true }),
    head('a', 2, { tags: ['push here'] }),
    stage('as', 'a', 2, 1),
    head('b', 3, { tags: null }),
    head('c', 4, { tags: ['maintain strength'] }),
  ]
  const heads = sets.filter((s) => s.parentWeekPlanSetId == null)

  it('writes the cues the sheet returned as the set\'s own, only when they differ from what it has', () => {
    expect(cuePatches({ set: heads[2], heads, cues: ['push back'], applyToAll: false })).toEqual([{ id: 'b', changes: { tags: ['push back'] } }])
    expect(cuePatches({ set: heads[1], heads, cues: ['push here'], applyToAll: false })).toEqual([])
  })

  it('none is null, not an empty list', () => {
    expect(cuePatches({ set: heads[1], heads, cues: [], applyToAll: false })).toEqual([{ id: 'a', changes: { tags: null } }])
    expect(cuePatches({ set: heads[2], heads, cues: [], applyToAll: false })).toEqual([])
  })

  it('"Use for all" adds each cue to every other working head that lacks it: not the warmup, not a stage, never a removal', () => {
    const patches = cuePatches({ set: heads[1], heads, cues: ['push here'], applyToAll: true })
    expect(patches).toEqual([
      { id: 'b', changes: { tags: ['push here'] } },
      { id: 'c', changes: { tags: ['maintain strength', 'push here'] } },
    ])
  })

  it('two cues are ONE write per head, with both, not two writes that each start from the old list', () => {
    const patches = cuePatches({ set: heads[2], heads, cues: ['push here', 'heavy day'], applyToAll: true })
    expect(patches.filter((p) => p.id === 'c')).toEqual([{ id: 'c', changes: { tags: ['maintain strength', 'push here', 'heavy day'] } }])
    expect(patches.filter((p) => p.id === 'a')).toEqual([{ id: 'a', changes: { tags: ['push here', 'heavy day'] } }])
    expect(patches[0]).toEqual({ id: 'b', changes: { tags: ['push here', 'heavy day'] } })
    expect(new Set(patches.map((p) => p.id)).size).toBe(patches.length)
  })

  it('the set\'s own write comes first, and "Use for all" with nothing to add writes the set alone', () => {
    const patches = cuePatches({ set: heads[2], heads, cues: ['maintain strength'], applyToAll: true })
    expect(patches[0]).toEqual({ id: 'b', changes: { tags: ['maintain strength'] } })
    expect(patches.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('without "Use for all", no other set is written', () => {
    expect(cuePatches({ set: heads[2], heads, cues: ['push here'], applyToAll: false }).map((p) => p.id)).toEqual(['b'])
  })

  it('a stage row\'s cues never spread', () => {
    expect(cuePatches({ set: sets[2], heads, cues: ['push here'], applyToAll: true }).map((p) => p.id)).toEqual(['as'])
  })

  it('untick one cue and tick another with "Use for all": the set swaps, the others only gain the new one', () => {
    const patches = cuePatches({ set: heads[1], heads, cues: ['push back'], applyToAll: true })
    expect(patches[0]).toEqual({ id: 'a', changes: { tags: ['push back'] } })
    expect(patches.slice(1)).toEqual([
      { id: 'b', changes: { tags: ['push back'] } },
      { id: 'c', changes: { tags: ['maintain strength', 'push back'] } },
    ])
  })

  it('blank and repeated cues are dropped before anything is written', () => {
    expect(cuePatches({ set: heads[2], heads, cues: ['  push here ', 'push here', ''], applyToAll: false })).toEqual([{ id: 'b', changes: { tags: ['push here'] } }])
  })
})

describe('supersetChips — SUPERSET A · 1, A · 2 (board 1)', () => {
  const pe = (id: string, position: number, supersetBlockId: string | null): ProgramExercise => ({
    id, workoutDayId: 'wd', userId: 'u', exerciseId: `ex-${id}`, position, weightUnit: null, supersetBlockId,
  })

  it('a superset\'s members get its letter and their place; an exercise in none has no chip', () => {
    const chips = supersetChips([pe('a', 0, null), pe('b', 1, 'blk-1'), pe('c', 2, 'blk-1'), pe('d', 3, null)])
    expect(chips.get('a')).toBeUndefined()
    expect(chips.get('b')).toEqual({ letter: 'A', member: 1 })
    expect(chips.get('c')).toEqual({ letter: 'A', member: 2 })
    expect(chips.get('d')).toBeUndefined()
  })

  it('letters follow the order of the supersets in the week, A then B', () => {
    const chips = supersetChips([pe('a', 0, 'blk-9'), pe('b', 1, 'blk-9'), pe('c', 2, null), pe('d', 3, 'blk-2'), pe('e', 4, 'blk-2'), pe('f', 5, 'blk-2')])
    expect(chips.get('a')).toEqual({ letter: 'A', member: 1 })
    expect(chips.get('b')).toEqual({ letter: 'A', member: 2 })
    expect(chips.get('d')).toEqual({ letter: 'B', member: 1 })
    expect(chips.get('f')).toEqual({ letter: 'B', member: 3 })
  })

  it('a lone exercise whose block id has no partner here is no superset', () => {
    expect(supersetChips([pe('a', 0, 'blk-1'), pe('b', 1, null)]).size).toBe(0)
  })

  it('the same chips whatever the ids\' order: the letter is a place in the week, not the block\'s name', () => {
    const one = supersetChips([pe('a', 0, 'z'), pe('b', 1, 'z'), pe('c', 2, 'a'), pe('d', 3, 'a')])
    expect(one.get('a')?.letter).toBe('A')
    expect(one.get('c')?.letter).toBe('B')
  })
})
