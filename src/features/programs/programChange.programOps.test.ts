import { describe, it, expect } from 'vitest'
import type { WeeklySchedule } from '../../types'
import type { DeletableTable, DeleteOp, InsertableTable, Op, OpTable } from './programChange'
import { USER, applyOpsToDb } from './programChange.testutil'
import { stableWorld } from './programChange.worlds.testutil'

// DECISIONS 157 (c), Adam, 2026-10-16: "Narrow the app's op type so v2_programs and v2_workout_days allow update only, no delete,
// with a test. No migration." (TASKS 47: "only an update is allowed" for those two tables.) 043's `v2_apply_ops` still accepts such
// a delete as built (#137: a run's workout cascades through every week plan of it; a program with a run is held by a foreign
// key), so the refusal is the app's: no op list it builds can hold one, because the op type leaves both tables out of
// `DeletableTable`. The rule is stated three times, like the week plan's (DECISIONS 142, programChange.weekPlansOp.test.ts):
//   - in the type, which `npm run typecheck` holds (a `@ts-expect-error` line that stops being an error fails TS2578);
//   - in the stand-in executor (programChange.testutil.ts `applyOpsToDb`), which refuses the same ops at run time;
//   - in the lists the planner really makes (changeProgramDraft.test.ts's random walks and changeProgramDraft.deload.test.ts
//     read every list for a delete of either table).

const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

describe('the op type: v2_programs and v2_workout_days take an update, and no insert and no delete', () => {
  it('a delete of either does not type-check, in an op or as a table name; an update of either does', () => {
    // Each @ts-expect-error is on the line it is about: `npm run typecheck` fails (TS2578) if the line stops being an error.
    // @ts-expect-error a delete of a v2_programs row is not an op
    const deleteProgram: Op = { op: 'delete', table: 'v2_programs', id: 'prog' }
    // @ts-expect-error a delete of a v2_workout_days row is not an op
    const deleteWorkout: Op = { op: 'delete', table: 'v2_workout_days', id: 'wd' }
    // @ts-expect-error nor is it a DeleteOp
    const deleteOp: DeleteOp = { op: 'delete', table: 'v2_programs', id: 'prog' }
    // @ts-expect-error v2_programs is not a table an op may delete from
    const programTable: DeletableTable = 'v2_programs'
    // @ts-expect-error v2_workout_days is not either
    const workoutTable: DeletableTable = 'v2_workout_days'
    const updateProgram: Op = { op: 'update', table: 'v2_programs', id: 'prog', patch: { schedule: NO_DAYS } }
    const updateWorkout: Op = { op: 'update', table: 'v2_workout_days', id: 'wd', patch: { name: 'Push' } }
    expect([deleteProgram, deleteWorkout, deleteOp, programTable, workoutTable, updateProgram, updateWorkout]).toHaveLength(7)
  })

  it('inserts into them are refused by the type too (the same two tables, 043: "an insert into v2_programs raises")', () => {
    // @ts-expect-error no insert into v2_programs
    const insertProgram: Op = { op: 'insert', table: 'v2_programs', row: { id: 'x', user_id: USER, schedule: {} } }
    // @ts-expect-error no insert into v2_workout_days
    const insertWorkout: Op = { op: 'insert', table: 'v2_workout_days', row: { id: 'x', user_id: USER, name: 'Push' } }
    // @ts-expect-error neither is an InsertableTable
    const insertable: InsertableTable = 'v2_programs'
    expect([insertProgram, insertWorkout, insertable]).toHaveLength(3)
  })

  it('DeletableTable is every table of an op but those two and v2_week_plans, exactly (a table added to the type must be decided here)', () => {
    type Rest = Exclude<OpTable, 'v2_programs' | 'v2_workout_days' | 'v2_week_plans'>
    const exact: Equal<DeletableTable, Rest> = true
    const named: Equal<
      DeletableTable,
      | 'v2_program_exercises'
      | 'v2_program_sets'
      | 'v2_program_superset_blocks'
      | 'v2_workout_warmup_items'
      | 'v2_run_schedules'
      | 'v2_week_plan_exercises'
      | 'v2_week_plan_sets'
      | 'v2_week_review_decisions'
      | 'v2_session_set_changes'
    > = true
    expect([exact, named]).toEqual([true, true])
  })
})

describe('the stand-in executor refuses the same deletes, and takes every other one', () => {
  const lastSet = (w: ReturnType<typeof stableWorld>) => w.db.v2_program_sets[w.db.v2_program_sets.length - 1]

  it("a delete of the run's program or of one of its workouts is refused in the words of a week plan's, and leaves the database as it was", () => {
    const w = stableWorld()
    const before = JSON.stringify(w.db)
    for (const [table, id] of [
      ['v2_programs', w.db.v2_programs[0].id],
      ['v2_workout_days', w.db.v2_workout_days[0].id],
    ] as const) {
      // the op is built by a cast: the type refuses to build it
      expect(() => applyOpsToDb(w.db, [{ op: 'delete', table, id } as unknown as Op]), table).toThrow(/delete not allowed/)
    }
    // the refusal is in the list's order, all or none: a good op before it is not kept
    expect(() =>
      applyOpsToDb(w.db, [
        { op: 'delete', table: 'v2_program_sets', id: lastSet(w).id },
        { op: 'delete', table: 'v2_workout_days', id: w.db.v2_workout_days[0].id } as unknown as Op,
      ]),
    ).toThrow(/op 2 \(delete v2_workout_days\): delete not allowed/)
    expect(JSON.stringify(w.db)).toBe(before)
  })

  it('a delete of a week plan is refused as before, and a delete of any other table in the list still lands', () => {
    const w = stableWorld()
    expect(() => applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_week_plans', id: w.db.v2_week_plans[0].id } as unknown as Op])).toThrow(/delete not allowed/)
    const set = lastSet(w)
    const after = applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_program_sets', id: set.id }])
    expect(after.v2_program_sets.some((r) => r.id === set.id)).toBe(false)
    expect(after.v2_program_sets).toHaveLength(w.db.v2_program_sets.length - 1)
  })

  it('an update of the program or of a workout still lands', () => {
    const w = stableWorld()
    const program = w.db.v2_programs[0]
    const workout = w.db.v2_workout_days[0]
    const after = applyOpsToDb(w.db, [
      { op: 'update', table: 'v2_programs', id: program.id, patch: { schedule: { ...NO_DAYS, monday: workout.id } } },
      { op: 'update', table: 'v2_workout_days', id: workout.id, patch: { name: 'Renamed' } },
    ])
    expect(after.v2_workout_days.find((r) => r.id === workout.id)!.name).toBe('Renamed')
    expect(after.v2_programs[0].schedule).toMatchObject({ monday: workout.id })
  })
})
