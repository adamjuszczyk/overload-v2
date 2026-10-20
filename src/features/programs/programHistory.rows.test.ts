import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase } from '../plan/fakeWeekPlanDb.testutil'

// Chunk 66: a finished program's history from stored rows, through the REAL reader (`fetchAllWeekPlansForMeso`, the one Plan reads a run's weeks
// with and the finished program screen reads them with) and the real mapper behind it, into `buildProgramHistory`. `programHistory.test.ts` builds
// the app's types by hand; the screen test mocks the reader. This is where a column the history depends on is shown to arrive: the exercise's name
// (the join), `superset_block_id` (on the joined program exercise), `is_warmup`, `stage_kind` and `parent_week_plan_set_id` (the set rows), and the
// week row's own `position`. The rows are the shape PostgREST returns (snake_case, children nested), written by hand.

let fake = createFakeSupabase([])
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))

const { fetchAllWeekPlansForMeso } = await import('../plan/weekPlanService')
const { buildProgramHistory } = await import('./programHistory')

const exerciseRow = (id: string, name: string) => ({
  id, user_id: 'user-1', name, muscle_group: 'back', is_archived: false, created_at: '', muscle_subgroup: null, movement_pattern: null, status: 'active', source_library_id: null, lost_at: null,
})
const weekExercise = (weekPlanId: string, peId: string, exerciseId: string, name: string, position: number, block: string | null) => ({
  id: `wpe-${weekPlanId}-${peId}`,
  week_plan_id: weekPlanId,
  user_id: 'user-1',
  program_exercise_id: peId,
  position,
  carry_program_exercise_id: null,
  carry_position: null,
  created_at: '',
  v2_program_exercises: { id: peId, workout_day_id: 'wd-pull', user_id: 'user-1', exercise_id: exerciseId, position: 99, weight_unit: null, superset_block_id: block, exercises: exerciseRow(exerciseId, name) },
})
const setRow = (weekPlanId: string, id: string, peId: string, setNumber: number, over: Record<string, unknown> = {}) => ({
  id, week_plan_id: weekPlanId, user_id: 'user-1', program_exercise_id: peId, set_number: setNumber, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, ...over,
})
const planRow = (id: string, weekNumber: number, sets: unknown[], exercises: unknown[], over: Record<string, unknown> = {}) => ({
  id, user_id: 'user-1', mesocycle_id: 'meso-1', workout_day_id: 'wd-pull', week_number: weekNumber, is_deload: false, notes: null, created_at: '', sequence_position: null, v2_week_plan_sets: sets, v2_week_plan_exercises: exercises, ...over,
})

describe('the history of rows as the database stores them', () => {
  it('names, superset places, warmups, set counts and set kinds come through the reader\'s own mapping, and a stage row is not a set', async () => {
    // Week 1: Lat Pulldown (3 sets) and Seated Cable Row (1 warmup, 2 sets) in one superset, then Straight-Arm Pulldown (2 sets).
    // Week 2: Lat Pulldown's set 3 is a dropset with one stage row; Straight-Arm Pulldown is gone. The week rows list their exercises in the
    // week's own order (the program exercises' own positions, 99, are not it).
    const w1 = 'wp-1'
    const w2 = 'wp-2'
    fake = createFakeSupabase([
      planRow(w2, 2,
        [
          setRow(w2, 'l1', 'pe-lat', 1), setRow(w2, 'l2', 'pe-lat', 2), setRow(w2, 'l3', 'pe-lat', 3, { stage_kind: 'dropset' }),
          setRow(w2, 'l3-d', 'pe-lat', 3, { is_dropset: true, parent_week_plan_set_id: 'l3', stage_index: 1 }),
          setRow(w2, 'r0', 'pe-row', 1, { is_warmup: true }), setRow(w2, 'r1', 'pe-row', 2), setRow(w2, 'r2', 'pe-row', 3),
        ],
        [weekExercise(w2, 'pe-row', 'ex-row', 'Seated Cable Row', 1, 'blk-1'), weekExercise(w2, 'pe-lat', 'ex-lat', 'Lat Pulldown', 0, 'blk-1')],
      ) as never,
      planRow(w1, 1,
        [
          setRow(w1, 'l1', 'pe-lat', 1), setRow(w1, 'l2', 'pe-lat', 2), setRow(w1, 'l3', 'pe-lat', 3),
          setRow(w1, 'r0', 'pe-row', 1, { is_warmup: true }), setRow(w1, 'r1', 'pe-row', 2), setRow(w1, 'r2', 'pe-row', 3),
          setRow(w1, 's1', 'pe-sap', 1), setRow(w1, 's2', 'pe-sap', 2),
        ],
        [weekExercise(w1, 'pe-lat', 'ex-lat', 'Lat Pulldown', 0, 'blk-1'), weekExercise(w1, 'pe-row', 'ex-row', 'Seated Cable Row', 1, 'blk-1'), weekExercise(w1, 'pe-sap', 'ex-sap', 'Straight-Arm Pulldown', 2, null)],
      ) as never,
    ])

    const plans = await fetchAllWeekPlansForMeso('meso-1')
    const h = buildProgramHistory({ plans, workoutDays: [{ id: 'wd-pull', name: 'Pull 1', position: 0 }], unit: 'week', scheduleFor: () => ({ tuesday: 'wd-pull' }) })

    const rows = (week: number) => h.weeks.find((w) => w.week === week)!.workouts[0].rows.map((r) => [r.number, r.name, r.meta, r.state])
    expect(rows(1)).toEqual([
      ['01', 'Lat Pulldown', 'A1 · 3 SETS', 'same'],
      ['02', 'Seated Cable Row', 'A2 · 1 WARMUP · 2 SETS', 'same'],
      ['03', 'Straight-Arm Pulldown', '2 SETS', 'same'],
    ])
    expect(rows(2)).toEqual([
      ['01', 'Lat Pulldown', 'A1 · 3 SETS · 1 DROPSET', 'changed'],
      ['02', 'Seated Cable Row', 'A2 · 1 WARMUP · 2 SETS', 'same'],
      ['—', 'Straight-Arm Pulldown', 'REMOVED', 'removed'],
    ])
    expect(h.weeks[1].changes.map((c) => `${c.sign} ${c.text} (${c.where})`)).toEqual(['~ Lat Pulldown set 3 is now a dropset (PULL 1)', '− Straight-Arm Pulldown removed (PULL 1)'])
    expect(h.weeks[1].workouts[0].dayLabel).toBe('TUESDAY')
  })
})
