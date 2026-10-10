import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createFakeSupabase,
  fakeWeekPlan,
  fakeWeekPlanExercise,
  fakeWeekPlanSet,
  type FakeCall,
} from './fakeWeekPlanDb.testutil'

// Chunk 27 (TASKS-1.1: "Rule: stored values are ignored by copying — Client"
// / SPEC [P1.1] "'Only this week' is removed … Existing data: 'only this
// week' values already stored are ignored from now on. Copying uses each
// week's actual content."). This drives the REAL copy path — copyFromPreviousWeek
// / copyWorkoutFromPreviousWeek -> copyOneWorkoutFromHistory ->
// copyOnePlanForward -> copyExercisesForward + copySetsWithGrouping — against
// an in-memory Supabase (fakeWeekPlanDb.testutil.ts) and asserts the EXACT
// rows it writes. weekPlanService.test.ts proves the two pure halves in
// isolation; this proves they are wired: that the source plan's rows really
// reach copyExercisesForward / copySetsWithGrouping, and that nothing
// between them maps an id or a position through carry_*.
//
// The source week is the shape an old "only this week" tick left behind:
//   - 'pe-swapped-in' was swapped in only-this-week, so its row stores
//     carry_program_exercise_id = 'pe-original' (the slot copying used to
//     revert to) and carry_position = 0 (an old reorder's pre-move spot),
//     while its own position is 1;
//   - 'pe-b' stores a carry_position (5) different from its own position (0).
// Its sets point at their own exercise rows ('pe-swapped-in' / 'pe-b'), as a
// swap leaves them. Copying must reproduce THIS content — own ids, own
// positions — not the stored carry values. Break proof: restore the
// `ex.carry_program_exercise_id ?? ex.program_exercise_id` /
// `ex.carry_position ?? ex.position` fallbacks (and the set remap through
// them) in weekPlanService.ts and every test below fails.

let writes: FakeCall[] = []
let fake = createFakeSupabase([])

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))

const { copyFromPreviousWeek, copyWorkoutFromPreviousWeek, fetchWeekPlans, fetchAllWeekPlansForMeso } = await import('./weekPlanService')

function buildWorld() {
  // The FIRST set in the list is pe-b's head, not pe-swapped-in's: the stage
  // below belongs to pe-swapped-in, so a stage (or head) insert that took its
  // exercise from prevSets[0] instead of from its own row is caught here.
  const sourceSets = [
    fakeWeekPlanSet('wp-1', 's-b-1', 'pe-b', { set_number: 1 }),
    fakeWeekPlanSet('wp-1', 's-swapped-1', 'pe-swapped-in', { set_number: 1 }),
    fakeWeekPlanSet('wp-1', 's-swapped-1-drop', 'pe-swapped-in', {
      set_number: 1,
      is_dropset: true,
      parent_week_plan_set_id: 's-swapped-1',
      stage_index: 1,
      target_rir: 0,
    }),
    fakeWeekPlanSet('wp-1', 's-swapped-2', 'pe-swapped-in', { set_number: 2 }),
  ]
  const source = fakeWeekPlan('wp-1', 1, {
    sets: sourceSets,
    exercises: [
      fakeWeekPlanExercise('wp-1', 'pe-swapped-in', 1, { programExerciseId: 'pe-original', position: 0 }),
      fakeWeekPlanExercise('wp-1', 'pe-b', 0, { position: 5 }),
    ],
  })
  const destination = fakeWeekPlan('wp-2', 2) // v2_plan_week already made the row; it is empty
  fake = createFakeSupabase([source, destination])
  writes = fake.writes
}

function byCall(table: string, method: string) {
  return writes.filter((c) => c.table === table && c.method === method)
}

beforeEach(() => {
  buildWorld()
})

describe('COPY WEEK (copyFromPreviousWeek -> copyOnePlanForward) — a source row with stored carry values copies as its own content', () => {
  it('upserts the source rows\' OWN program_exercise_id and position into v2_week_plan_exercises, never the stored carry values', async () => {
    await copyFromPreviousWeek('user-1', 'meso-1', 2)

    const upserts = byCall('v2_week_plan_exercises', 'upsert')
    expect(upserts).toHaveLength(1)
    const [payloads, opts] = upserts[0].args as [Record<string, unknown>[], unknown]
    expect(payloads).toEqual([
      { week_plan_id: 'wp-2', user_id: 'user-1', program_exercise_id: 'pe-swapped-in', position: 1 },
      { week_plan_id: 'wp-2', user_id: 'user-1', program_exercise_id: 'pe-b', position: 0 },
    ])
    expect(opts).toEqual({ onConflict: 'week_plan_id,program_exercise_id' })
    // The copied row starts clean: no carry_* key of any kind.
    for (const p of payloads) {
      expect(Object.keys(p).sort()).toEqual(['position', 'program_exercise_id', 'user_id', 'week_plan_id'])
    }
    // Spelled out, because these are the two mappings the old code applied.
    expect(payloads.map((p) => p.program_exercise_id)).not.toContain('pe-original')
    expect(payloads.find((p) => p.program_exercise_id === 'pe-b')?.position).not.toBe(5)
  })

  it('each copied set keeps its OWN program_exercise_id (heads, then stages), never the carry slot', async () => {
    await copyFromPreviousWeek('user-1', 'meso-1', 2)

    const inserts = byCall('v2_week_plan_sets', 'insert').map((c) => c.args[0] as Record<string, unknown>)
    // Heads first (source order: pe-b's, then the two pe-swapped-in heads), then the stage.
    expect(inserts.map((p) => p.program_exercise_id)).toEqual(['pe-b', 'pe-swapped-in', 'pe-swapped-in', 'pe-swapped-in'])
    expect(inserts.map((p) => p.program_exercise_id)).not.toContain('pe-original')
    for (const p of inserts) expect(p.week_plan_id).toBe('wp-2')
    // The stage keeps its OWN exercise (pe-swapped-in) although the first set
    // in the list is pe-b's, and still reattaches to its head's NEW id
    // (new-2: pe-swapped-in's first head) — the grouping the copy exists to preserve.
    const stage = inserts[3]
    expect(stage.program_exercise_id).toBe('pe-swapped-in')
    expect(stage.parent_week_plan_set_id).toBe('new-2')
    expect(stage.stage_index).toBe(1)
  })

  it('copies into the existing empty row — no second v2_week_plans row is created', async () => {
    await copyFromPreviousWeek('user-1', 'meso-1', 2)
    expect(byCall('v2_week_plans', 'insert')).toHaveLength(0)
  })
})

// Chunk 27: "carryProgramExerciseId / carryPosition leave src/types/index.ts and the
// mappers". The mapper behind every Plan read (toPlan -> the week's
// ProgramExercise rows) must not hand the stored values to the screen: the
// type has no such field, and a screen consumer that could read one would
// bring the old identity back. The source row below stores both. Break proof:
// put `carryProgramExerciseId: row.carry_program_exercise_id` and
// `carryPosition: row.carry_position` back into
// toProgramExerciseFromWeekPlanExercise.
describe('reading a week whose rows store carry values — the mapped exercises carry none', () => {
  it('fetchWeekPlans: each exercise keeps its own id and position, with no carryProgramExerciseId / carryPosition', async () => {
    const [plan] = await fetchWeekPlans('meso-1', 1)

    expect(plan.exercises.map((e) => [e.id, e.position])).toEqual([['pe-b', 0], ['pe-swapped-in', 1]])
    for (const e of plan.exercises) {
      expect('carryProgramExerciseId' in e).toBe(false)
      expect('carryPosition' in e).toBe(false)
    }
  })

  it('fetchAllWeekPlansForMeso: the same, for the meso-wide read the offer and the copy buttons use', async () => {
    const plans = await fetchAllWeekPlansForMeso('meso-1')

    const weekOne = plans.find((p) => p.weekNumber === 1)!
    expect(weekOne.exercises.map((e) => [e.id, e.position])).toEqual([['pe-b', 0], ['pe-swapped-in', 1]])
    for (const p of plans) {
      for (const e of p.exercises) {
        expect('carryProgramExerciseId' in e).toBe(false)
        expect('carryPosition' in e).toBe(false)
      }
    }
  })
})

describe('COPY THIS WORKOUT (copyWorkoutFromPreviousWeek -> the same copyOnePlanForward) — same content rule', () => {
  it('writes the same own-id / own-position rows for one workout', async () => {
    await copyWorkoutFromPreviousWeek('user-1', 'meso-1', 2, 'wd-1', 'wp-2')

    const [payloads] = byCall('v2_week_plan_exercises', 'upsert')[0].args as [Record<string, unknown>[]]
    expect(payloads).toEqual([
      { week_plan_id: 'wp-2', user_id: 'user-1', program_exercise_id: 'pe-swapped-in', position: 1 },
      { week_plan_id: 'wp-2', user_id: 'user-1', program_exercise_id: 'pe-b', position: 0 },
    ])
    const setIds = byCall('v2_week_plan_sets', 'insert').map((c) => (c.args[0] as Record<string, unknown>).program_exercise_id)
    expect(setIds).toEqual(['pe-b', 'pe-swapped-in', 'pe-swapped-in', 'pe-swapped-in'])
  })
})
