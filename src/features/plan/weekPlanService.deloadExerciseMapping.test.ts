import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 22, review fix — "marking with rules on can write planned sets for
// exercises the marked session doesn't have, and drop sets for ones it
// does" (a mismatched exercise list between the base occurrence and the
// marked week — a stable program-tab add after week 1, a week-dependent
// add/remove, or a swap on either side). This is the hook/executor-level
// proof the review asked for: run the REAL markSessionDeload end-to-end
// (only Supabase mocked, same precedent as weekPlanService.
// deloadGuard.test.ts) against a fixture where the base week has
// [A, C] and the marked week has [A, B] — C removed, B added since — and
// assert every INSERTED set's program_exercise_id belongs to the marked
// week's own exercise list, B (the added exercise) still gets sets (from
// its own current planned sets, the documented fallback), and C (removed)
// contributes nothing. The pure mapping decision itself
// (resolveDeloadExerciseMapping, including the swap-divergence cases) is
// exhaustively unit-tested in deloadRules.test.ts; this file proves the
// executor actually wires it up and never lets a stray id through.

type Call = { table: string; method: string; args: unknown[] }
const calls: Call[] = []

function makeChain(table: string, resolve: () => { data?: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table, method, args })
    return chain
  }
  chain.select = record('select')
  chain.eq = record('eq')
  chain.lt = record('lt')
  chain.in = record('in')
  chain.update = record('update')
  chain.delete = record('delete')
  chain.insert = record('insert')
  chain.single = () => Promise.resolve(resolve())
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(res, rej)
  return chain
}

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}))

const { markSessionDeload } = await import('./weekPlanService')

beforeEach(() => {
  calls.length = 0
  fromMock.mockReset()
})

function programExerciseEmbed(exerciseId: string) {
  return { exercise_id: exerciseId }
}

describe('markSessionDeload — never orphans a set onto an exercise the marked week doesn\'t have, never drops one it does', () => {
  it('base = [A, C], marked = [A, B]: A is calculated from base, B keeps its own current sets, C contributes nothing', async () => {
    const markedWeekPlanRow = {
      mesocycle_id: 'meso-1',
      workout_day_id: 'wd-1',
      week_number: 2,
      deload_restore: null,
      v2_week_plan_sets: [
        { id: 'marked-a1', week_plan_id: 'wp-marked', user_id: 'u1', program_exercise_id: 'pe-A', set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, target_weight: 100 },
        { id: 'marked-b1', week_plan_id: 'wp-marked', user_id: 'u1', program_exercise_id: 'pe-B', set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, target_weight: 50 },
      ],
      v2_week_plan_exercises: [
        { program_exercise_id: 'pe-A', carry_program_exercise_id: null, v2_program_exercises: programExerciseEmbed('ex-A') },
        { program_exercise_id: 'pe-B', carry_program_exercise_id: null, v2_program_exercises: programExerciseEmbed('ex-B') },
      ],
    }
    const historyRows = [
      {
        week_number: 1,
        is_deload: false,
        v2_week_plan_sets: [
          { id: 'base-a1', week_plan_id: 'wp-base', user_id: 'u1', program_exercise_id: 'pe-A', set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, target_weight: 100 },
          { id: 'base-c1', week_plan_id: 'wp-base', user_id: 'u1', program_exercise_id: 'pe-C', set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, target_weight: 80 },
        ],
        v2_week_plan_exercises: [
          { program_exercise_id: 'pe-A', carry_program_exercise_id: null, v2_program_exercises: programExerciseEmbed('ex-A') },
          { program_exercise_id: 'pe-C', carry_program_exercise_id: null, v2_program_exercises: programExerciseEmbed('ex-C') },
        ],
      },
    ]

    let weekPlansCallIndex = 0
    let insertCounter = 0
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_sessions') return makeChain(table, () => ({ data: [], error: null })) // marked week never started
      if (table === 'v2_week_plans') {
        weekPlansCallIndex += 1
        // 1st call: fetchDeloadWeekPlanCore (the marked week, .single()).
        // 2nd call: fetchDeloadOccurrenceHistory (the array of prior weeks).
        // 3rd call: applyCalculatedDeloadMark's own writeSnapshotAndMark.
        if (weekPlansCallIndex === 1) return makeChain(table, () => ({ data: markedWeekPlanRow, error: null }))
        if (weekPlansCallIndex === 2) return makeChain(table, () => ({ data: historyRows, error: null }))
        return makeChain(table, () => ({ data: null, error: null }))
      }
      if (table === 'v2_set_logs') {
        // One non-skipped, non-warmup, non-stage log against the base
        // week's own set-a1 — makes week 1 "happened".
        return makeChain(table, () => ({
          data: [{ week_plan_set_id: 'base-a1', weight: 95, is_skipped: false, is_warmup: false, parent_set_id: null }],
          error: null,
        }))
      }
      if (table === 'v2_week_plan_sets') {
        // Serves both the delete (array/then-shaped) and each insert
        // (.select('id').single()) — the delete's own resolve value is
        // never inspected by the code, so one generic resolver is fine.
        return makeChain(table, () => ({ data: { id: `new-${++insertCounter}` }, error: null }))
      }
      throw new Error(`unexpected table in this test: ${table}`)
    })

    const outcome = await markSessionDeload('u1', 'wp-marked', { reps: { delta: -1 } })
    expect(outcome).toBe('calculated')

    const inserts = calls.filter((c) => c.table === 'v2_week_plan_sets' && c.method === 'insert')
    const insertedProgramExerciseIds = inserts.map((c) => (c.args[0] as Record<string, unknown>).program_exercise_id)

    // The break this review caught: C (base-only) must NEVER appear.
    expect(insertedProgramExerciseIds).not.toContain('pe-C')
    // Every inserted row belongs to the MARKED week's own exercise list.
    for (const id of insertedProgramExerciseIds) {
      expect(['pe-A', 'pe-B']).toContain(id)
    }
    // B (added since, no base counterpart) must still get its own sets —
    // the documented fallback, not silently dropped.
    expect(insertedProgramExerciseIds).toContain('pe-B')
    // A (matched) is present too.
    expect(insertedProgramExerciseIds).toContain('pe-A')
    expect(insertedProgramExerciseIds).toHaveLength(2)
  })

  // The plain-add/remove fixture above happens to use the SAME row id on
  // both sides for its one matched exercise (pe-A on base, pe-A on
  // marked), so it can't tell "wrote the marked week's own
  // program_exercise_id" apart from "wrote the base's" — they're equal by
  // coincidence. A swap (chunk 20's own case: a row carried forward keeps
  // its carry identity but gets a NEW id each week it's touched) is where
  // those two ids genuinely diverge, so this is the fixture that actually
  // exercises toSourceSet's markedProgramExerciseId override.
  it("swap mirrored on both sides (same carry slot, different own row ids): writes with the MARKED week's own program_exercise_id, never the base's", async () => {
    const markedWeekPlanRow = {
      mesocycle_id: 'meso-1',
      workout_day_id: 'wd-1',
      week_number: 3,
      deload_restore: null,
      v2_week_plan_sets: [
        { id: 'marked-a1', week_plan_id: 'wp-marked', user_id: 'u1', program_exercise_id: 'pe-marked-swapped', set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, target_weight: 100 },
      ],
      v2_week_plan_exercises: [
        { program_exercise_id: 'pe-marked-swapped', carry_program_exercise_id: 'pe-carry-A', v2_program_exercises: programExerciseEmbed('ex-A') },
      ],
    }
    const historyRows = [
      {
        week_number: 1,
        is_deload: false,
        v2_week_plan_sets: [
          { id: 'base-a1', week_plan_id: 'wp-base', user_id: 'u1', program_exercise_id: 'pe-base-swapped', set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, target_weight: 100 },
        ],
        v2_week_plan_exercises: [
          { program_exercise_id: 'pe-base-swapped', carry_program_exercise_id: 'pe-carry-A', v2_program_exercises: programExerciseEmbed('ex-A') },
        ],
      },
    ]

    let weekPlansCallIndex = 0
    let insertCounter = 0
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_sessions') return makeChain(table, () => ({ data: [], error: null }))
      if (table === 'v2_week_plans') {
        weekPlansCallIndex += 1
        if (weekPlansCallIndex === 1) return makeChain(table, () => ({ data: markedWeekPlanRow, error: null }))
        if (weekPlansCallIndex === 2) return makeChain(table, () => ({ data: historyRows, error: null }))
        return makeChain(table, () => ({ data: null, error: null }))
      }
      if (table === 'v2_set_logs') {
        return makeChain(table, () => ({
          data: [{ week_plan_set_id: 'base-a1', weight: 95, is_skipped: false, is_warmup: false, parent_set_id: null }],
          error: null,
        }))
      }
      if (table === 'v2_week_plan_sets') {
        return makeChain(table, () => ({ data: { id: `new-${++insertCounter}` }, error: null }))
      }
      throw new Error(`unexpected table in this test: ${table}`)
    })

    const outcome = await markSessionDeload('u1', 'wp-marked', { reps: { delta: -1 } })
    expect(outcome).toBe('calculated')

    const inserts = calls.filter((c) => c.table === 'v2_week_plan_sets' && c.method === 'insert')
    const insertedProgramExerciseIds = inserts.map((c) => (c.args[0] as Record<string, unknown>).program_exercise_id)

    expect(insertedProgramExerciseIds).toEqual(['pe-marked-swapped'])
    expect(insertedProgramExerciseIds).not.toContain('pe-base-swapped')
  })
})
