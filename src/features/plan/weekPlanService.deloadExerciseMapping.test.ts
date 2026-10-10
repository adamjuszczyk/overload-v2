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
  // Chunk 25 — `.is(col, null)` is the slot-identity null-check this
  // file's own fixtures (every one a weekday run) now exercise.
  chain.is = record('is')
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
        { program_exercise_id: 'pe-A', v2_program_exercises: programExerciseEmbed('ex-A') },
        { program_exercise_id: 'pe-B', v2_program_exercises: programExerciseEmbed('ex-B') },
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
          { program_exercise_id: 'pe-A', v2_program_exercises: programExerciseEmbed('ex-A') },
          { program_exercise_id: 'pe-C', v2_program_exercises: programExerciseEmbed('ex-C') },
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

  // Chunk 27 (SPEC [P1.1] "'Only this week' is removed … 'only this week'
  // values already stored are ignored from now on") — matches ignore stored
  // values, proved at the one call site: markSessionDeload, the only caller of
  // resolveDeloadExerciseMapping. Both fixtures below carry a stored
  // carry_program_exercise_id on a row (the mocked rows return it whether or
  // not the select asks for it, so a regression that reads the column again
  // would see it). The two weeks' sets have DIFFERENT rep targets (base 8,
  // marked 12) and the rule is "reps −1", so which set the calculation took is
  // readable from the inserted rows: 7 = the BASE week's set, 11 = the marked
  // week's OWN set (the fallback). Break proof: restore
  // `carryProgramExerciseId ?? programExerciseId` in deloadRules.ts's
  // deloadSlotIdOf (with the field on DeloadExerciseSlot and read in
  // weekPlanService.ts's toExerciseSlot) — both tests below fail.
  function buildWorld(args: {
    markedExercise: { program_exercise_id: string; carry_program_exercise_id: string | null; exercise: string }
    baseExercise: { program_exercise_id: string; carry_program_exercise_id: string | null; exercise: string }
  }) {
    const { markedExercise, baseExercise } = args
    const markedWeekPlanRow = {
      mesocycle_id: 'meso-1',
      workout_day_id: 'wd-1',
      week_number: 3,
      deload_restore: null,
      v2_week_plan_sets: [
        { id: 'marked-1', week_plan_id: 'wp-marked', user_id: 'u1', program_exercise_id: markedExercise.program_exercise_id, set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, rep_min: 12, rep_max: 12 },
      ],
      v2_week_plan_exercises: [
        { program_exercise_id: markedExercise.program_exercise_id, carry_program_exercise_id: markedExercise.carry_program_exercise_id, v2_program_exercises: programExerciseEmbed(markedExercise.exercise) },
      ],
    }
    const historyRows = [
      {
        week_number: 1,
        is_deload: false,
        v2_week_plan_sets: [
          { id: 'base-1', week_plan_id: 'wp-base', user_id: 'u1', program_exercise_id: baseExercise.program_exercise_id, set_number: 1, target_rir: 2, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, rep_min: 8, rep_max: 8 },
        ],
        v2_week_plan_exercises: [
          { program_exercise_id: baseExercise.program_exercise_id, carry_program_exercise_id: baseExercise.carry_program_exercise_id, v2_program_exercises: programExerciseEmbed(baseExercise.exercise) },
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
          data: [{ week_plan_set_id: 'base-1', weight: 95, is_skipped: false, is_warmup: false, parent_set_id: null }],
          error: null,
        }))
      }
      if (table === 'v2_week_plan_sets') {
        return makeChain(table, () => ({ data: { id: `new-${++insertCounter}` }, error: null }))
      }
      throw new Error(`unexpected table in this test: ${table}`)
    })
  }

  function insertedSets() {
    return calls
      .filter((c) => c.table === 'v2_week_plan_sets' && c.method === 'insert')
      .map((c) => c.args[0] as Record<string, unknown>)
  }

  it('a base row whose stored carry names ANOTHER slot is still matched by own id: the inserted set takes the BASE week\'s content, under the marked week\'s program_exercise_id', async () => {
    buildWorld({
      markedExercise: { program_exercise_id: 'pe-A', carry_program_exercise_id: null, exercise: 'ex-A' },
      // Same own id and same exercise as the marked row; the stored carry
      // names a different slot. Under the old carry-based identity the slots
      // ('pe-OTHER' vs 'pe-A') differed and this fell back.
      baseExercise: { program_exercise_id: 'pe-A', carry_program_exercise_id: 'pe-OTHER', exercise: 'ex-A' },
    })

    const outcome = await markSessionDeload('u1', 'wp-marked', { reps: { delta: -1 } })
    expect(outcome).toBe('calculated')

    const sets = insertedSets()
    expect(sets).toHaveLength(1)
    expect(sets[0].program_exercise_id).toBe('pe-A')
    expect(sets[0].rep_min).toBe(7) // base's 8, minus 1 — matched. 11 would mean the carry kept them apart.
    expect(sets[0].rep_max).toBe(7)
  })

  // The two gathers (the marked week, then the earlier occurrences) no longer
  // ask for carry_program_exercise_id, and still hint the embed by FK name —
  // v2_week_plan_exercises keeps two FKs to v2_program_exercises, so an
  // un-hinted embed is PGRST201-ambiguous. Break proof: put the carry column
  // back into either select string, or drop the hint from it.
  it('both gathers select no carry column and keep the program_exercise_id FK hint on the embed', async () => {
    buildWorld({
      markedExercise: { program_exercise_id: 'pe-A', carry_program_exercise_id: null, exercise: 'ex-A' },
      baseExercise: { program_exercise_id: 'pe-A', carry_program_exercise_id: null, exercise: 'ex-A' },
    })

    await markSessionDeload('u1', 'wp-marked', { reps: { delta: -1 } })

    const selects = calls
      .filter((c) => c.table === 'v2_week_plans' && c.method === 'select')
      .map((c) => String(c.args[0]))
    expect(selects).toHaveLength(2)
    for (const s of selects) {
      expect(s).not.toContain('carry')
      expect(s).toContain('v2_week_plan_exercises(program_exercise_id, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(exercise_id))')
    }
  })

  it('two DIFFERENT rows that store the same carry are not paired: the marked exercise is calculated from its OWN current sets (the fallback)', async () => {
    buildWorld({
      // Each week's old "only this week" swap created its own week-only row
      // and stored the same original slot in carry. Own ids differ, so they
      // are not the same slot any more.
      markedExercise: { program_exercise_id: 'pe-Y-marked', carry_program_exercise_id: 'pe-A', exercise: 'ex-Y' },
      baseExercise: { program_exercise_id: 'pe-Y-base', carry_program_exercise_id: 'pe-A', exercise: 'ex-Y' },
    })

    const outcome = await markSessionDeload('u1', 'wp-marked', { reps: { delta: -1 } })
    expect(outcome).toBe('calculated')

    const sets = insertedSets()
    expect(sets).toHaveLength(1)
    expect(sets[0].program_exercise_id).toBe('pe-Y-marked') // the marked week's own row
    expect(sets[0].rep_min).toBe(11) // marked's own 12, minus 1 — not the base's 8. 7 would mean the shared carry paired them.
    expect(sets[0].rep_max).toBe(11)
  })
})
