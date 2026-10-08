import { describe, it, expect } from 'vitest'
import {
  insertCalculatedPlanSets,
  insertRestoredPlanSets,
  applyCalculatedDeloadMark,
  applyDeloadRestore,
  type DeloadMarkWriteOps,
  type DeloadRestoreWriteOps,
} from './weekPlanService'
import { calculateDeloadSets, type DeloadCalculatedSet, type DeloadRestoreEntry, type DeloadRules } from '../../lib/deloadRules'
import type { DbWeekPlanSet } from './weekPlanService'

// Chunk 22 — the WRITE-ORDER proofs "Lessons" demands (a hook or executor
// test for the write order): both of this chunk's destructive sequences
// (mark: snapshot commits before anything is deleted; unmark: the restored
// sets are written before the snapshot pointer is cleared) via the same
// injectable-ops seam weekPlanService.ts's own copySetsWithGrouping
// (insertPlanSet) already establishes — fakes record call order, never a
// real Supabase round trip. The pure CALCULATION itself is proven in
// deloadRules.test.ts; this file proves the I/O glues it together in the
// right order and the id-remap it depends on is correct.

function makeFakeInsertOneSet() {
  let counter = 0
  const calls: Record<string, unknown>[] = []
  const insertOneSet = async (payload: Record<string, unknown>) => {
    calls.push(payload)
    counter += 1
    return { id: `new-${counter}` }
  }
  return { insertOneSet, calls }
}

function calcSet(overrides: Partial<DeloadCalculatedSet>): DeloadCalculatedSet {
  return {
    sourceId: 'src', parentSourceId: null, programExerciseId: 'pe1', setNumber: 1, stageIndex: 0,
    isWarmup: false, stageKind: null, programSetId: null, repMin: null, repMax: null, isAmrap: false,
    targetRir: null, tags: null, isDropset: false, targetWeight: null,
    ...overrides,
  }
}

describe('insertCalculatedPlanSets — id remap (mirrors copySetsWithGrouping\'s own precedent)', () => {
  it('inserts heads before stages and resolves each stage\'s parent to its OWN head\'s new id', async () => {
    const head = calcSet({ sourceId: 'h1', setNumber: 1, stageKind: 'dropset' })
    const stage = calcSet({ sourceId: 's1', parentSourceId: 'h1', setNumber: 1, stageIndex: 1, isDropset: true })
    const { insertOneSet, calls } = makeFakeInsertOneSet()

    await insertCalculatedPlanSets('u1', 'wp1', [head, stage], insertOneSet)

    expect(calls).toHaveLength(2)
    expect(calls[0].parent_week_plan_set_id).toBeUndefined() // head insert never sets this key
    expect(calls[1].parent_week_plan_set_id).toBe('new-1') // the head's real new id
    expect(calls[1].week_plan_id).toBe('wp1')
    expect(calls[1].user_id).toBe('u1')
  })

  it('a stage never attaches to a same-numbered head from a different exercise', async () => {
    const headA = calcSet({ sourceId: 'hA', programExerciseId: 'peA', setNumber: 1 })
    const headB = calcSet({ sourceId: 'hB', programExerciseId: 'peB', setNumber: 1 })
    const stageB = calcSet({ sourceId: 'sB', parentSourceId: 'hB', programExerciseId: 'peB', setNumber: 1, stageIndex: 1, isDropset: true })
    const { insertOneSet, calls } = makeFakeInsertOneSet()

    // Deliberately non-adjacent order, same adversarial shape
    // weekPlanService.test.ts's own copySetsWithGrouping tests use.
    await insertCalculatedPlanSets('u1', 'wp1', [headA, stageB, headB], insertOneSet)

    expect(calls[0].program_exercise_id).toBe('peA') // new-1
    expect(calls[1].program_exercise_id).toBe('peB') // new-2
    expect(calls[2].parent_week_plan_set_id).toBe('new-2') // headB's id, never headA's (new-1)
  })

  it('carries is_warmup, stage_kind, program_set_id, target_weight/rir, rep target and tags through verbatim', async () => {
    const warmup = calcSet({ sourceId: 'w1', isWarmup: true, targetWeight: 40, programSetId: 'ps1', tags: ['push here'] })
    const { insertOneSet, calls } = makeFakeInsertOneSet()
    await insertCalculatedPlanSets('u1', 'wp1', [warmup], insertOneSet)
    expect(calls[0]).toMatchObject({ is_warmup: true, target_weight: 40, program_set_id: 'ps1', tags: ['push here'] })
  })
})

describe('insertRestoredPlanSets — regroups the id-free snapshot and resolves parent ids', () => {
  function entry(overrides: Partial<DeloadRestoreEntry>): DeloadRestoreEntry {
    return {
      programExerciseId: 'pe1', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false,
      stageKind: null, programSetId: null, repMin: null, repMax: null, isAmrap: false,
      targetWeight: null, targetRir: null, tags: null,
      ...overrides,
    }
  }

  it('inserts the head first, then each stage parented to the head\'s own new id', async () => {
    const head = entry({ setNumber: 1, stageKind: 'dropset', targetWeight: 100 })
    const stage1 = entry({ setNumber: 1, stageIndex: 1, isDropset: true, targetWeight: 80 })
    const stage2 = entry({ setNumber: 1, stageIndex: 2, isDropset: true, targetWeight: 60 })
    const { insertOneSet, calls } = makeFakeInsertOneSet()

    // Input deliberately out of stage order — grouping/ordering is this
    // function's own job, not the caller's.
    await insertRestoredPlanSets('u1', 'wp1', [stage2, head, stage1], insertOneSet)

    expect(calls).toHaveLength(3)
    expect(calls[0].target_weight).toBe(100) // head inserted first
    expect(calls[0].parent_week_plan_set_id).toBeUndefined()
    expect(calls[1].target_weight).toBe(80) // stage 1 before stage 2, by stageIndex
    expect(calls[1].parent_week_plan_set_id).toBe('new-1')
    expect(calls[2].target_weight).toBe(60)
    expect(calls[2].parent_week_plan_set_id).toBe('new-1')
  })

  it('two exercises sharing a setNumber never cross-attach (grouping key includes programExerciseId)', async () => {
    const headA = entry({ programExerciseId: 'peA', setNumber: 1, targetWeight: 10 })
    const headB = entry({ programExerciseId: 'peB', setNumber: 1, targetWeight: 20 })
    const stageB = entry({ programExerciseId: 'peB', setNumber: 1, stageIndex: 1, isDropset: true, targetWeight: 15 })
    const { insertOneSet, calls } = makeFakeInsertOneSet()

    await insertRestoredPlanSets('u1', 'wp1', [headA, stageB, headB], insertOneSet)

    expect(calls).toHaveLength(3)
    const stageCall = calls.find((c) => c.target_weight === 15)!
    const headBId = calls.find((c) => c.target_weight === 20) // headB inserted second (new-2)
    expect(headBId).toBeDefined()
    expect(stageCall.parent_week_plan_set_id).toBe('new-2') // peB's own head, never peA's
  })
})

describe('applyCalculatedDeloadMark — write order (reviewer\'s note 3)', () => {
  function makeDbSet(overrides: Partial<DbWeekPlanSet>): DbWeekPlanSet {
    return {
      id: 'old', week_plan_id: 'wp1', user_id: 'u1', program_exercise_id: 'pe1', set_number: 1,
      target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0,
      ...overrides,
    }
  }

  it('commits the snapshot (with the is_deload flip) BEFORE deleting, and only then inserts the calculated sets', async () => {
    const calls: string[] = []
    const ops: DeloadMarkWriteOps = {
      writeSnapshotAndMark: async () => { calls.push('snapshot') },
      deleteAllSets: async () => { calls.push('delete') },
      insertCalculatedSets: async () => { calls.push('insert') },
    }
    const current = [makeDbSet({ id: 'old1' })]
    const calculated = [calcSet({ sourceId: 'old1' })]

    await applyCalculatedDeloadMark('u1', 'wp1', current, calculated, ops)

    expect(calls).toEqual(['snapshot', 'delete', 'insert'])
  })

  it('a failure between snapshot and delete leaves the snapshot already committed (it was the first and only call to succeed)', async () => {
    const calls: string[] = []
    const ops: DeloadMarkWriteOps = {
      writeSnapshotAndMark: async () => { calls.push('snapshot') },
      deleteAllSets: async () => { calls.push('delete'); throw new Error('boom') },
      insertCalculatedSets: async () => { calls.push('insert') },
    }
    await expect(
      applyCalculatedDeloadMark('u1', 'wp1', [makeDbSet({ id: 'old1' })], [], ops),
    ).rejects.toThrow('boom')
    expect(calls).toEqual(['snapshot', 'delete']) // snapshot had already committed before the throw
  })

  it('the snapshot it writes is the exact pre-mark row, not the calculated one — proves it snapshots BEFORE recalculating, not the output', async () => {
    let writtenSnapshot: unknown
    const ops: DeloadMarkWriteOps = {
      writeSnapshotAndMark: async (_id, snapshot) => { writtenSnapshot = snapshot },
      deleteAllSets: async () => {},
      insertCalculatedSets: async () => {},
    }
    const current = [makeDbSet({ id: 'old1', target_rir: 3, is_dropset: false })]
    const calculated = [calcSet({ sourceId: 'old1', targetRir: 99 })] // the CALCULATED value — must not leak into the snapshot

    await applyCalculatedDeloadMark('u1', 'wp1', current, calculated, ops)

    expect(writtenSnapshot).toEqual([
      expect.objectContaining({ targetRir: 3, programExerciseId: 'pe1', setNumber: 1 }),
    ])
  })
})

describe('applyDeloadRestore — write order (reviewer\'s note 4)', () => {
  const snapshot: DeloadRestoreEntry[] = [
    { programExerciseId: 'pe1', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: null, repMin: 8, repMax: 12, isAmrap: false, targetWeight: 100, targetRir: 2, tags: null },
  ]

  it('deletes, then inserts the restored sets, and only THEN clears the snapshot/flag', async () => {
    const calls: string[] = []
    const ops: DeloadRestoreWriteOps = {
      deleteAllSets: async () => { calls.push('delete') },
      insertRestoredSets: async () => { calls.push('insert') },
      clearSnapshotAndUnmark: async () => { calls.push('clear') },
    }
    await applyDeloadRestore('u1', 'wp1', snapshot, ops)
    expect(calls).toEqual(['delete', 'insert', 'clear'])
  })

  it('a failure during insert never clears the snapshot — it stays recoverable for a retry', async () => {
    const calls: string[] = []
    const ops: DeloadRestoreWriteOps = {
      deleteAllSets: async () => { calls.push('delete') },
      insertRestoredSets: async () => { calls.push('insert'); throw new Error('boom') },
      clearSnapshotAndUnmark: async () => { calls.push('clear') },
    }
    await expect(applyDeloadRestore('u1', 'wp1', snapshot, ops)).rejects.toThrow('boom')
    expect(calls).toEqual(['delete', 'insert']) // clear never ran
  })

  it("restore's only input is the snapshot — a hand-edit to the CURRENT (calculated) sets between mark and unmark cannot change what it writes", async () => {
    // applyDeloadRestore takes no "current sets" argument at all — there is
    // nothing for a prior hand-edit to leak through. This test pins that
    // by construction: the restored payload is wholly determined by
    // `snapshot`, independent of whatever the (unrepresented) current sets
    // might be.
    let restoredPayload: unknown
    const ops: DeloadRestoreWriteOps = {
      deleteAllSets: async () => {},
      insertRestoredSets: async (_u, _w, entries) => { restoredPayload = entries },
      clearSnapshotAndUnmark: async () => {},
    }
    await applyDeloadRestore('u1', 'wp1', snapshot, ops)
    expect(restoredPayload).toEqual(snapshot) // exactly the pre-mark snapshot, untouched
  })
})

describe('the executor writes exactly what the calculator computed (bridges deloadRules.test.ts to the I/O layer)', () => {
  it('insertCalculatedPlanSets\' payloads match calculateDeloadSets\' own output for the same fixture', async () => {
    const base = [
      { id: 'b1', programExerciseId: 'pe1', setNumber: 1, parentId: null, stageIndex: 0, isWarmup: false, stageKind: null, programSetId: null, repMin: 8, repMax: 12, isAmrap: false, targetRir: 2, tags: null, isDropset: false, plannedWeight: 100, loggedWeight: 95 },
      { id: 'b2', programExerciseId: 'pe1', setNumber: 2, parentId: null, stageIndex: 0, isWarmup: false, stageKind: null, programSetId: null, repMin: 8, repMax: 12, isAmrap: false, targetRir: 2, tags: null, isDropset: false, plannedWeight: 100, loggedWeight: null },
    ]
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, weight: { percent: 90, rounding: 'down', step: 2.5, stepUnit: 'kg' } }
    const calculated = calculateDeloadSets(base, rules)
    expect(calculated).toHaveLength(1) // 2 -> 1

    const { insertOneSet, calls } = makeFakeInsertOneSet()
    await insertCalculatedPlanSets('u1', 'wp1', calculated, insertOneSet)

    expect(calls).toHaveLength(1)
    expect(calls[0].target_weight).toBe(calculated[0].targetWeight)
    expect(calls[0].rep_min).toBe(calculated[0].repMin)
    expect(calls[0].rep_max).toBe(calculated[0].repMax)
  })
})
