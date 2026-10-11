// B5: unmarking a deload restores the sets saved when it was marked. That
// saved copy keeps the id of the program set each planned set came from. A
// program set deleted after marking is gone, so inserting the saved row with
// its old id broke the foreign key — after the session's sets had already
// been deleted. The session was left without sets, the saved copy stayed,
// and every retry failed the same way. The restore now checks which program
// sets still exist before it deletes anything, and restores a set whose
// program set is gone without the link (what the database itself does to a
// live row when its program set is deleted: on delete set null).
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const db = {
  programSetIds: new Set<string>(),
  planSets: [] as Row[],
  weekPlan: {
    id: 'wp-1',
    mesocycle_id: 'meso-1',
    workout_day_id: 'wd-1',
    week_number: 3,
    sequence_position: null as number | null,
    is_deload: true,
    deload_restore: [] as unknown,
  },
  nextId: 1,
  failInsertsAfter: Infinity,
  inserts: 0,
}

function from(table: string) {
  let op: 'select' | 'delete' | 'insert' | 'update' = 'select'
  let payload: Row | null = null
  let inIds: string[] | null = null
  const chain: Record<string, unknown> = {
    select: () => chain,
    delete: () => {
      op = 'delete'
      return chain
    },
    insert: (p: Row) => {
      op = 'insert'
      payload = p
      return chain
    },
    update: (p: Row) => {
      op = 'update'
      payload = p
      return chain
    },
    eq: () => chain,
    in: (_col: string, ids: string[]) => {
      inIds = ids
      return chain
    },
    single: async () => run(true),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run(false).then(resolve, reject),
  }
  async function run(single: boolean): Promise<{ data?: unknown; error: unknown }> {
    if (table === 'v2_week_plans') {
      if (op === 'update') {
        Object.assign(db.weekPlan, payload)
        return { error: null }
      }
      return {
        data: { ...db.weekPlan, v2_week_plan_sets: db.planSets, v2_week_plan_exercises: [] },
        error: null,
      }
    }
    if (table === 'v2_sessions') return { data: [], error: null }
    if (table === 'v2_program_sets') {
      return { data: [...db.programSetIds].filter((id) => (inIds ?? []).includes(id)).map((id) => ({ id })), error: null }
    }
    if (table === 'v2_week_plan_sets') {
      if (op === 'delete') {
        db.planSets = []
        return { error: null }
      }
      if (op === 'insert') {
        const p = payload as Row
        db.inserts++
        if (db.inserts > db.failInsertsAfter) return { error: { message: 'network down' } }
        if (p.program_set_id != null && !db.programSetIds.has(p.program_set_id as string)) {
          return { error: { code: '23503', message: 'insert violates foreign key constraint on program_set_id' } }
        }
        const row = { ...p, id: `new-${db.nextId++}` }
        db.planSets.push(row)
        return single ? { data: { id: row.id }, error: null } : { error: null }
      }
    }
    return { data: [], error: null }
  }
  return chain
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => from(t) } }))

const { unmarkSessionDeload } = await import('./weekPlanService')

const entry = (setNumber: number, programSetId: string | null) => ({
  programExerciseId: 'pe-1', setNumber, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null,
  programSetId, repMin: 8, repMax: 12, isAmrap: false, targetWeight: 100, targetRir: 2, tags: null,
})

beforeEach(() => {
  db.programSetIds = new Set(['ps-1', 'ps-3'])
  db.planSets = [{ id: 'calc-1', program_exercise_id: 'pe-1', set_number: 1 }]
  db.weekPlan.is_deload = true
  db.weekPlan.deload_restore = [entry(1, 'ps-1'), entry(2, 'ps-2'), entry(3, 'ps-3')]
  db.nextId = 1
  db.failInsertsAfter = Infinity
  db.inserts = 0
})

describe('unmarkSessionDeload — a program set deleted after marking (B5)', () => {
  it('restores every saved set; the one whose program set is gone comes back without the link', async () => {
    const outcome = await unmarkSessionDeload('user-1', 'wp-1')

    expect(outcome).toBe('restored')
    expect(db.planSets.map((s) => [s.set_number, s.program_set_id])).toEqual([
      [1, 'ps-1'],
      [2, null],
      [3, 'ps-3'],
    ])
    expect(db.weekPlan.is_deload).toBe(false)
    expect(db.weekPlan.deload_restore).toBeNull()
  })

  it('retrying after a failed unmark works', async () => {
    db.failInsertsAfter = 1
    await expect(unmarkSessionDeload('user-1', 'wp-1')).rejects.toBeTruthy()
    expect(db.weekPlan.deload_restore).not.toBeNull()

    db.failInsertsAfter = Infinity
    db.inserts = 0
    await expect(unmarkSessionDeload('user-1', 'wp-1')).resolves.toBe('restored')
    expect(db.planSets).toHaveLength(3)
    expect(db.weekPlan.deload_restore).toBeNull()
  })

  it('when every program set still exists nothing changes: ids restored as saved', async () => {
    db.programSetIds = new Set(['ps-1', 'ps-2', 'ps-3'])
    await unmarkSessionDeload('user-1', 'wp-1')
    expect(db.planSets.map((s) => s.program_set_id)).toEqual(['ps-1', 'ps-2', 'ps-3'])
  })

  it('a snapshot with no program-set links restores without looking any up', async () => {
    db.weekPlan.deload_restore = [entry(1, null), entry(2, null)]
    await unmarkSessionDeload('user-1', 'wp-1')
    expect(db.planSets).toHaveLength(2)
  })
})
