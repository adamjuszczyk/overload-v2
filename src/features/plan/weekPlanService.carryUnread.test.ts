import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase, fakeWeekPlan, fakeWeekPlanExercise, fakeWeekPlanSet, type FakeWeekPlanExerciseRow } from './fakeWeekPlanDb.testutil'

// Chunk 27 (TASKS-1.1: "`carryProgramExerciseId` / `carryPosition` leave `src/types/index.ts` and the mappers"; RULES, "Carry fields are
// unread (chunk 27)": `carry_program_exercise_id` / `carry_position` stay in `v2_week_plan_exercises`, nothing reads them, "Don't add a reader").
// The mapper behind every Plan read (toPlan -> the week's ProgramExercise rows) must not hand the stored values to the screen: the type has no
// such field, and a screen consumer that could read one would bring the old identity back, and a position taken from the stored carry would
// reorder the week.
//
// These two tests lived in `weekPlanService.copyForward.test.ts`, which chunk 52 removed with the copy code it tested. Only its other
// describes tested that code: this one tests the two readers that stay (`fetchWeekPlans`, `fetchAllWeekPlansForMeso`), through the in-memory
// Supabase (fakeWeekPlanDb.testutil.ts), and was lost with the file until review 1 (F3) found that two breaks of the mapper passed the whole
// suite. Chunk 52's COPY twin (PlanPage.copyWeek.storedCarry.test.tsx) pairs a copy's rows by exercise and can't see either break.
//
// The week read below is the shape an old "only this week" tick left behind:
//   - 'pe-swapped-in' was swapped in only-this-week, so its row stores carry_program_exercise_id = 'pe-original' (the slot copying used to
//     revert to) and carry_position = 0 (an old reorder's pre-move spot), while its own position is 1;
//   - 'pe-b' stores a carry_position (5) different from its own position (0).
// The program exercises they point at have positions of their own in their workouts (4 and 7), which are neither the week rows' nor the carry's:
// the week lists its exercises in the order of ITS rows (v2_week_plan_exercises.position), so a position read from the program exercise would
// reorder the week too (the last test; found by attempt 2's mutation sweep).
// Break proofs (chunk 52's report, attempt 2): put `carryProgramExerciseId: row.carry_program_exercise_id` and `carryPosition:
// row.carry_position` back into toProgramExerciseFromWeekPlanExercise (the mapped exercise grows two keys); take `position` from
// `row.carry_position ?? row.position` (the week reads in another order, with the stored positions) or from the program exercise's `pe.position`.
// A comment-only change to the mapper passes.

let fake = createFakeSupabase([])

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))

const { fetchWeekPlans, fetchAllWeekPlansForMeso } = await import('./weekPlanService')

/** The program exercise a week row points at, with a position of its own in its workout. */
function withProgramPosition(row: FakeWeekPlanExerciseRow, position: number): FakeWeekPlanExerciseRow {
  return { ...row, v2_program_exercises: { ...row.v2_program_exercises, position } }
}

function weekOneRow() {
  return fakeWeekPlan('wp-1', 1, {
    sets: [
      fakeWeekPlanSet('wp-1', 's-b-1', 'pe-b', { set_number: 1 }),
      fakeWeekPlanSet('wp-1', 's-swapped-1', 'pe-swapped-in', { set_number: 1 }),
    ],
    exercises: [
      withProgramPosition(fakeWeekPlanExercise('wp-1', 'pe-swapped-in', 1, { programExerciseId: 'pe-original', position: 0 }), 4),
      withProgramPosition(fakeWeekPlanExercise('wp-1', 'pe-b', 0, { position: 5 }), 7),
    ],
  })
}

function buildWorld() {
  const weekTwo = fakeWeekPlan('wp-2', 2) // v2_plan_week had made the row; it is empty
  fake = createFakeSupabase([weekOneRow(), weekTwo])
}

describe('reading a week whose rows store carry values — the mapped exercises carry none', () => {
  it('fixture: the stored week really holds the carry values the readers must ignore, and program exercises with positions of their own (so the tests below are not vacuous)', () => {
    const stored = weekOneRow().v2_week_plan_exercises.map((e) => [e.program_exercise_id, e.position, e.carry_program_exercise_id, e.carry_position, e.v2_program_exercises.position])
    expect(stored).toEqual([
      ['pe-swapped-in', 1, 'pe-original', 0, 4],
      ['pe-b', 0, null, 5, 7],
    ])
  })

  it('fetchWeekPlans: each exercise keeps its own id and position, with no carryProgramExerciseId / carryPosition', async () => {
    buildWorld()
    const [plan] = await fetchWeekPlans('meso-1', 1)

    expect(plan.exercises.map((e) => [e.id, e.position])).toEqual([['pe-b', 0], ['pe-swapped-in', 1]])
    for (const e of plan.exercises) {
      expect('carryProgramExerciseId' in e).toBe(false)
      expect('carryPosition' in e).toBe(false)
    }
  })

  it('fetchAllWeekPlansForMeso: the same, for the meso-wide read the offer and the copy buttons use', async () => {
    buildWorld()
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

  it('a week lists its exercises in the order of its own rows: the position is the week row\'s, not the program exercise\'s (4 and 7 here) and not the stored carry\'s (0 and 5)', async () => {
    buildWorld()
    const [plan] = await fetchWeekPlans('meso-1', 1)
    expect(plan.exercises.map((e) => [e.id, e.position])).toEqual([['pe-b', 0], ['pe-swapped-in', 1]])
    const all = await fetchAllWeekPlansForMeso('meso-1')
    expect(all.find((p) => p.weekNumber === 1)!.exercises.map((e) => [e.id, e.position])).toEqual([['pe-b', 0], ['pe-swapped-in', 1]])
  })
})
