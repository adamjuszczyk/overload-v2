import { describe, it, expect } from 'vitest'
import type { Op, SavedPlanSet } from './programChange'
import { type Db, USER, applyOpsToDb, cloneDb } from './programChange.testutil'
import { stableWorld } from './programChange.worlds.testutil'

// DECISIONS 142 (Adam, 2026-10-15): "Migration 043's executor may write v2_week_plans for that one column only, as an
// update only: no insert or delete on v2_week_plans, no other column. A patch touching any other v2_week_plans column is
// rejected like a protected column, with a test."
//
// The op type (programChange.ts) is what chunk 47's executor and client are written against, so the rule is stated twice
// here: in the type, which `npm run typecheck` holds (a `@ts-expect-error` line that stops being an error fails TS2578), and
// in the stand-in executor (programChange.testutil.ts `applyOpsToDb`, which mirrors 043 as TASKS-1.2 describes it), which
// refuses the same ops at run time with the same words as for `id` and `user_id`: "patch sets a protected column".

const SAVED: SavedPlanSet[] = [
  {
    programExerciseId: 'pe-leg',
    setNumber: 1,
    stageIndex: 0,
    isWarmup: false,
    isDropset: false,
    stageKind: null,
    programSetId: 'pe-leg-s1',
    repMin: 10,
    repMax: 12,
    isAmrap: false,
    targetWeight: 60,
    targetRir: 2,
    tags: null,
  },
]

describe('the op type', () => {
  it('names `v2_week_plans` for an update of `deload_restore` only: an insert, a delete and any other column do not type-check', () => {
    // Each @ts-expect-error is on the line of the op it is about: `npm run typecheck` fails (TS2578) if the line stops being an error.
    // @ts-expect-error an insert into v2_week_plans is not an op
    const insert: Op = { op: 'insert', table: 'v2_week_plans', row: { id: 'x', user_id: USER, deload_restore: null } }
    // @ts-expect-error a delete of a v2_week_plans row is not an op
    const del: Op = { op: 'delete', table: 'v2_week_plans', id: 'p3-fb' }
    // @ts-expect-error is_deload is not a column an op may write
    const flag: Op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { is_deload: false } }
    // @ts-expect-error nor is a column written beside deload_restore
    const both: Op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: null, is_deload: false } }
    // @ts-expect-error nor is the saved plan a list of anything: it is the entries of lib/deloadRules.ts
    const wrongShape: Op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: [{ setNumber: 1 }] } }
    const fine: Op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: SAVED } }
    const cleared: Op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: null } }
    expect([insert, del, flag, both, wrongShape, fine, cleared]).toHaveLength(7)
  })
})

describe('the executor stands in for 043: `v2_week_plans` takes an update of `deload_restore` and nothing else', () => {
  const row = (db: Db) => db.v2_week_plans.find((p) => p.id === 'p3-fb')!

  it('an update of deload_restore lands, to a list and to null', () => {
    const w = stableWorld()
    const saved = applyOpsToDb(w.db, [{ op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: SAVED } }])
    expect(row(saved).deload_restore).toEqual(SAVED)
    const cleared = applyOpsToDb(saved, [{ op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: null } }])
    expect(row(cleared).deload_restore).toBeNull()
    expect(row(saved)).toMatchObject({ is_deload: false, week_number: 3, workout_day_id: 'fb' }) // and nothing else about the row
  })

  it.each(['is_deload', 'notes', 'week_number', 'workout_day_id', 'mesocycle_id', 'sequence_position', 'created_at', 'id', 'user_id'])(
    'a patch of %s is refused like a protected column, and the row is as it was',
    (column) => {
      const w = stableWorld()
      const before = JSON.stringify(w.db)
      const op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { [column]: column === 'is_deload' ? true : 'x' } } as unknown as Op
      expect(() => applyOpsToDb(w.db, [op])).toThrow(/patch sets a protected column/)
      expect(JSON.stringify(w.db)).toBe(before)
    },
  )

  it('the one column beside another is refused whole: deload_restore is not written either (all or none)', () => {
    const w = stableWorld()
    const op = { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: SAVED, is_deload: true } } as unknown as Op
    expect(() => applyOpsToDb(w.db, [op])).toThrow(/patch sets a protected column/)
    expect(row(w.db).deload_restore).toBeUndefined()
    expect(row(w.db).is_deload).toBe(false)
  })

  it('an insert into `v2_week_plans` is refused', () => {
    const w = stableWorld()
    const before = JSON.stringify(w.db)
    const op = { op: 'insert', table: 'v2_week_plans', row: { id: 'new-plan', user_id: USER, mesocycle_id: 'meso', workout_day_id: 'fb', week_number: 9, is_deload: false, sequence_position: null, deload_restore: null } } as unknown as Op
    expect(() => applyOpsToDb(w.db, [op])).toThrow(/insert not allowed/)
    expect(JSON.stringify(w.db)).toBe(before)
  })

  it('a delete of a `v2_week_plans` row is refused, and the row, its exercises and its sets stay', () => {
    const w = stableWorld()
    const before = JSON.stringify(w.db)
    const op = { op: 'delete', table: 'v2_week_plans', id: 'p3-fb' } as unknown as Op
    expect(() => applyOpsToDb(w.db, [op])).toThrow(/delete not allowed/)
    expect(JSON.stringify(w.db)).toBe(before)
    expect(w.db.v2_week_plan_sets.some((s) => s.week_plan_id === 'p3-fb')).toBe(true)
  })

  it('a refusal anywhere in a list refuses the list: the first op\'s change is not kept', () => {
    const w = stableWorld()
    const ops = [
      { op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: SAVED } },
      { op: 'update', table: 'v2_week_plans', id: 'p2-fb', patch: { is_deload: true } },
    ] as unknown as Op[]
    const db = cloneDb(w.db)
    expect(() => applyOpsToDb(db, ops)).toThrow(/protected/)
    expect(row(db).deload_restore).toBeUndefined()
  })

  it('it is scoped to the caller like every update: another user\'s plan row is not found', () => {
    const w = stableWorld()
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_week_plans', id: 'p3-fb', patch: { deload_restore: null } }], 'someone-else')).toThrow(/row not found: v2_week_plans\/p3-fb/)
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_week_plans', id: 'no-such-plan', patch: { deload_restore: null } }])).toThrow(/row not found/)
  })
})
