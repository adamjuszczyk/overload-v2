import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DefaultSetShape } from './applyAhead'

// Chunk 32 — what "Apply this change to planned weeks ahead" writes after "Make this week
// the new default" (weekPlanService.ts): rows that name the DEFAULT'S own exercise row and
// program sets, in the payload each request sends. A set added by hand sends exactly what
// it always did (weekPlanService.test.ts / weekPlanService.weekActions.test.ts prove it);
// these tests are the new columns, and the order and shape of the requests around them.

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))
vi.mock('../programs/runProgramExercises', () => ({
  fetchSwapSourceSlot: vi.fn(),
  createWeekOnlyProgramExercise: vi.fn(),
  fetchRunProgramExercises: vi.fn(),
}))

const { addSet, addWarmupSet, addStage, addPointedSet, addPointedStage, addPointedExercise, repointWeekExercise } = await import('./weekPlanService')

type Result = { data?: unknown; error?: unknown }

// One chain per `from()` call, in the order the code makes them. Every builder method
// returns the chain; awaiting it (or .single()) gives `result`.
function makeChain(result: Result = { data: null, error: null }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'is']) chain[m] = vi.fn(() => chain)
  chain.single = vi.fn(() => Promise.resolve(result))
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return chain as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

function queue(...chains: ReturnType<typeof makeChain>[]) {
  for (const c of chains) fromMock.mockReturnValueOnce(c)
}

const dbSet = (overrides: Record<string, unknown> = {}) => ({
  id: 'new-set', week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-1', set_number: 1, target_rir: null, is_dropset: false,
  ...overrides,
})

function shape(programSetId: string, overrides: Partial<DefaultSetShape> = {}): DefaultSetShape {
  return {
    programSetId, programExerciseId: 'pe-1', position: 1, isWarmup: false, stageKind: null, repMin: null, repMax: null, isAmrap: false,
    stageIndex: 0, stages: [], ...overrides,
  }
}

beforeEach(() => fromMock.mockReset())

describe('addSet / addWarmupSet / addStage — a set from the default names its program set', () => {
  it('addSet: program_set_id, stage kind and rep target ride along with what a hand set sends', async () => {
    const chain = makeChain({ data: dbSet({ set_number: 4 }), error: null })
    queue(chain)
    await addSet('u1', 'wp-3', 'pe-1', 4, shape('q4', { stageKind: 'rest_pause', repMin: 6, repMax: 8 }))
    expect(fromMock).toHaveBeenCalledWith('v2_week_plan_sets')
    expect(chain.insert).toHaveBeenCalledWith({
      week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-1', set_number: 4, target_rir: null, is_dropset: false,
      program_set_id: 'q4', stage_kind: 'rest_pause', rep_min: 6, rep_max: 8, is_amrap: false,
    })
  })

  it('addSet by hand sends exactly what it always did: no program set, no kind, no rep target', async () => {
    const chain = makeChain({ data: dbSet(), error: null })
    queue(chain)
    await addSet('u1', 'wp-3', 'pe-1', 2)
    expect(chain.insert).toHaveBeenCalledWith({ week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-1', set_number: 2, target_rir: null, is_dropset: false })
  })

  it('addStage: the stage names its program set and carries no stage kind (a stage row can\'t: 027\'s check)', async () => {
    const chain = makeChain({ data: dbSet({ is_dropset: true }), error: null })
    queue(chain)
    await addStage('u1', 'wp-3', 'pe-1', 'head-1', 4, 2, shape('n1', { stageIndex: 2, stageKind: 'dropset', repMin: 12, repMax: 12 }))
    expect(chain.insert).toHaveBeenCalledWith({
      week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-1', set_number: 4, target_rir: null, is_dropset: true,
      parent_week_plan_set_id: 'head-1', stage_index: 2,
      program_set_id: 'n1', stage_kind: null, rep_min: 12, rep_max: 12, is_amrap: false,
    })
  })

  it('addWarmupSet: the warmup names its program set, after the shifts that make room for it', async () => {
    const read = makeChain({ data: [{ id: 'a', set_number: 1, is_warmup: false, parent_week_plan_set_id: null }, { id: 'b', set_number: 2, is_warmup: false, parent_week_plan_set_id: null }], error: null })
    const shiftB = makeChain()
    const shiftA = makeChain()
    const insert = makeChain({ data: dbSet({ is_warmup: true }), error: null })
    queue(read, shiftB, shiftA, insert)
    await addWarmupSet('u1', 'wp-3', 'pe-1', shape('w1', { isWarmup: true, repMin: 12, repMax: 12 }))
    expect(shiftB.update).toHaveBeenCalledWith({ set_number: 3 })
    expect(shiftA.update).toHaveBeenCalledWith({ set_number: 2 })
    expect(insert.insert).toHaveBeenCalledWith({
      week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-1', set_number: 1, target_rir: null, is_dropset: false, is_warmup: true,
      program_set_id: 'w1', stage_kind: null, rep_min: 12, rep_max: 12, is_amrap: false,
    })
  })
})

describe('addPointedSet — the number is the week\'s own, decided when the set is written', () => {
  it('a working set takes the number after the week\'s highest head at that moment (a gap left by a deleted set is not reused)', async () => {
    const read = makeChain({ data: [{ set_number: 1 }, { set_number: 2 }, { set_number: 5 }], error: null })
    const insert = makeChain({ data: dbSet({ set_number: 6 }), error: null })
    queue(read, insert)
    await addPointedSet('u1', 'wp-3', 'pe-1', shape('q', { repMin: 5, repMax: 5 }))
    // Only the exercise's heads are read: this week, this row, no stage rows.
    expect(read.eq).toHaveBeenCalledWith('week_plan_id', 'wp-3')
    expect(read.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-1')
    expect(read.is).toHaveBeenCalledWith('parent_week_plan_set_id', null)
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ set_number: 6, program_set_id: 'q' }))
  })

  it('the first set of an empty exercise is number 1', async () => {
    queue(makeChain({ data: [], error: null }), makeChain({ data: dbSet(), error: null }))
    await addPointedSet('u1', 'wp-3', 'pe-1', shape('q'))
    expect((fromMock.mock.results[1].value as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith(expect.objectContaining({ set_number: 1 }))
  })

  it('a staged set brings its stages: each named, under the head just written, sharing its number', async () => {
    const read = makeChain({ data: [{ set_number: 3 }], error: null })
    const head = makeChain({ data: dbSet({ id: 'head-new', set_number: 4 }), error: null })
    const stage1 = makeChain({ data: dbSet({ id: 'st-1', is_dropset: true }), error: null })
    const stage2 = makeChain({ data: dbSet({ id: 'st-2', is_dropset: true }), error: null })
    queue(read, head, stage1, stage2)
    await addPointedSet('u1', 'wp-3', 'pe-1', shape('q', {
      stageKind: 'myo_reps',
      stages: [shape('q-s1', { stageIndex: 1, repMin: 10, repMax: 10 }), shape('q-s2', { stageIndex: 2 })],
    }))
    expect(head.insert).toHaveBeenCalledWith(expect.objectContaining({ set_number: 4, stage_kind: 'myo_reps', program_set_id: 'q' }))
    expect(stage1.insert).toHaveBeenCalledWith(expect.objectContaining({ parent_week_plan_set_id: 'head-new', set_number: 4, stage_index: 1, program_set_id: 'q-s1', stage_kind: null, rep_min: 10, rep_max: 10 }))
    expect(stage2.insert).toHaveBeenCalledWith(expect.objectContaining({ parent_week_plan_set_id: 'head-new', set_number: 4, stage_index: 2, program_set_id: 'q-s2' }))
  })

  it('a warmup is placed by the week\'s own rows (above its first working set), not numbered by the working-set rule', async () => {
    const read = makeChain({ data: [{ id: 'a', set_number: 1, is_warmup: false, parent_week_plan_set_id: null }], error: null })
    const shift = makeChain()
    const insert = makeChain({ data: dbSet({ is_warmup: true }), error: null })
    queue(read, shift, insert)
    await addPointedSet('u1', 'wp-3', 'pe-1', shape('w', { isWarmup: true }))
    expect(shift.update).toHaveBeenCalledWith({ set_number: 2 })
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ set_number: 1, is_warmup: true, program_set_id: 'w' }))
  })

  it('a failed read writes nothing', async () => {
    queue(makeChain({ data: null, error: new Error('boom') }))
    await expect(addPointedSet('u1', 'wp-3', 'pe-1', shape('q'))).rejects.toThrow('boom')
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

describe('addPointedStage — shares the head\'s number as the head has it now', () => {
  it('reads the head\'s current number, then writes the stage with it', async () => {
    const read = makeChain({ data: { set_number: 5 }, error: null })
    const insert = makeChain({ data: dbSet({ is_dropset: true }), error: null })
    queue(read, insert)
    await addPointedStage('u1', 'wp-3', 'pe-1', 'head-1', 3, shape('n1', { stageIndex: 3, repMin: 8, repMax: 8 }))
    expect(read.eq).toHaveBeenCalledWith('id', 'head-1')
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ parent_week_plan_set_id: 'head-1', set_number: 5, stage_index: 3, program_set_id: 'n1' }))
  })
})

describe('addPointedExercise — the default\'s own row, never a fresh week-only one', () => {
  it('writes the exercise row for the DEFAULT\'S program exercise id, then its heads (one request), then their stages (one request)', async () => {
    const row = makeChain()
    const heads = makeChain({
      data: [{ id: 'wps-1', program_set_id: 'q1' }, { id: 'wps-2', program_set_id: 'q2' }],
      error: null,
    })
    const stages = makeChain()
    queue(row, heads, stages)

    await addPointedExercise({
      userId: 'u1',
      weekPlanId: 'wp-3',
      programExerciseId: 'pe-new',
      position: 3,
      sets: [
        shape('q1', { programExerciseId: 'pe-new', position: 1, isWarmup: true, repMin: 12, repMax: 12 }),
        shape('q2', { programExerciseId: 'pe-new', position: 2, stageKind: 'dropset', repMin: 8, repMax: 10, stages: [shape('q2s1', { programExerciseId: 'pe-new', position: 2, stageIndex: 1, repMin: 20, repMax: 20 })] }),
      ],
    })

    expect(fromMock.mock.calls.map((c) => c[0])).toEqual(['v2_week_plan_exercises', 'v2_week_plan_sets', 'v2_week_plan_sets'])
    // The row: the default's id. No program exercise is created (createWeekOnlyProgramExercise is never called).
    expect(row.insert).toHaveBeenCalledWith({ user_id: 'u1', week_plan_id: 'wp-3', program_exercise_id: 'pe-new', position: 3 })
    expect(row.insert.mock.calls[0][0]).not.toHaveProperty('carry_program_exercise_id')
    // The heads: numbered by the program set's position, each naming its program set; no weight, RIR or tags.
    expect(heads.insert).toHaveBeenCalledWith([
      { week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-new', set_number: 1, target_rir: null, is_dropset: false, is_warmup: true, program_set_id: 'q1', stage_kind: null, rep_min: 12, rep_max: 12, is_amrap: false },
      { week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-new', set_number: 2, target_rir: null, is_dropset: false, is_warmup: false, program_set_id: 'q2', stage_kind: 'dropset', rep_min: 8, rep_max: 10, is_amrap: false },
    ])
    expect(heads.select).toHaveBeenCalledWith('id, program_set_id')
    // The stages: under their own head's new id (matched through the program set), sharing its number.
    expect(stages.insert).toHaveBeenCalledWith([
      { week_plan_id: 'wp-3', user_id: 'u1', program_exercise_id: 'pe-new', set_number: 2, target_rir: null, is_dropset: true, parent_week_plan_set_id: 'wps-2', stage_index: 1, program_set_id: 'q2s1', stage_kind: null, rep_min: 20, rep_max: 20, is_amrap: false },
    ])
  })

  it('an exercise with no sets is just the row', async () => {
    const row = makeChain()
    queue(row)
    await addPointedExercise({ userId: 'u1', weekPlanId: 'wp-3', programExerciseId: 'pe-new', position: 0, sets: [] })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('a failed row writes no sets', async () => {
    queue(makeChain({ data: null, error: new Error('row failed') }))
    await expect(addPointedExercise({ userId: 'u1', weekPlanId: 'wp-3', programExerciseId: 'pe-new', position: 0, sets: [shape('q1')] })).rejects.toThrow('row failed')
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('a set number comes from the program set\'s position, so the week reads as one planned from the default', async () => {
    const row = makeChain()
    const heads = makeChain({ data: [{ id: 'w1', program_set_id: 'q1' }], error: null })
    queue(row, heads)
    await addPointedExercise({ userId: 'u1', weekPlanId: 'wp-3', programExerciseId: 'pe-new', position: 0, sets: [shape('q1', { position: 7 })] })
    expect((heads.insert.mock.calls[0][0] as { set_number: number }[])[0].set_number).toBe(7)
  })
})

describe('repointWeekExercise — re-links the moved sets when asked to', () => {
  it('without relink it is the two updates it always was', async () => {
    const ex = makeChain()
    const sets = makeChain()
    queue(ex, sets)
    await repointWeekExercise('wp-3', 'pe-old', 'pe-new')
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(ex.update).toHaveBeenCalledWith({ program_exercise_id: 'pe-new', carry_program_exercise_id: null })
    expect(sets.update).toHaveBeenCalledWith({ program_exercise_id: 'pe-new' })
  })

  it('with relink, each moved set then names its new program set (by the set\'s own id)', async () => {
    const ex = makeChain()
    const sets = makeChain()
    const l1 = makeChain()
    const l2 = makeChain()
    queue(ex, sets, l1, l2)
    await repointWeekExercise('wp-3', 'pe-old', 'pe-new', [{ weekSetId: 's1', programSetId: 'q1' }, { weekSetId: 's2', programSetId: 'q2' }])
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual(['v2_week_plan_exercises', 'v2_week_plan_sets', 'v2_week_plan_sets', 'v2_week_plan_sets'])
    expect(l1.update).toHaveBeenCalledWith({ program_set_id: 'q1' })
    expect(l1.eq).toHaveBeenCalledWith('id', 's1')
    expect(l2.update).toHaveBeenCalledWith({ program_set_id: 'q2' })
    expect(l2.eq).toHaveBeenCalledWith('id', 's2')
  })

  it('the re-links come after the row and its sets have moved, and a failed one stops the rest', async () => {
    queue(makeChain(), makeChain(), makeChain({ data: null, error: new Error('relink failed') }), makeChain())
    await expect(repointWeekExercise('wp-3', 'pe-old', 'pe-new', [{ weekSetId: 's1', programSetId: 'q1' }, { weekSetId: 's2', programSetId: 'q2' }])).rejects.toThrow('relink failed')
    expect(fromMock).toHaveBeenCalledTimes(3)
  })
})
