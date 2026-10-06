import { describe, it, expect, vi, beforeEach } from 'vitest'

// Isolates weekPlanService's own orchestration (which calls go out, in what
// order, with what payload) from runProgramExercises.ts's internals
// (covered by its own test file) and from the real Supabase client
// (programService.test.ts's own precedent for mocking it).
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))

const fetchSwapSourceSlotMock = vi.fn()
const createWeekOnlyProgramExerciseMock = vi.fn()
vi.mock('../programs/runProgramExercises', () => ({
  fetchSwapSourceSlot: (...args: unknown[]) => fetchSwapSourceSlotMock(...args),
  createWeekOnlyProgramExercise: (...args: unknown[]) => createWeekOnlyProgramExerciseMock(...args),
}))

const { swapWeekExercise, addWeekExercise, removeWeekExercise, reorderWeekExercises } = await import(
  './weekPlanService'
)

function makeChain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

// A fresh row's carry lookup — both carry_* already null, the common case
// for tests not specifically about an existing carry surviving a repeat
// only-this-week edit (weekEdits.test.ts covers those at the pure-function
// level; a couple of tests below also check this file wires fetchCurrentCarry
// through correctly).
function makeCarryLookup(carry: { carryProgramExerciseId: string | null; carryPosition: number | null }) {
  return makeChain({
    data: { carry_program_exercise_id: carry.carryProgramExerciseId, carry_position: carry.carryPosition },
    error: null,
  })
}
const NO_CARRY = { carryProgramExerciseId: null, carryPosition: null }

beforeEach(() => {
  fromMock.mockReset()
  fetchSwapSourceSlotMock.mockReset()
  createWeekOnlyProgramExerciseMock.mockReset()
})

describe('swapWeekExercise', () => {
  it('creates the replacement from the replaced slot\'s own position/superset block, points this week at it, and moves this week\'s own sets with it', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 2, supersetBlockId: 'block-1' })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new', exerciseId: 'ex-new' })
    const carryChain = makeCarryLookup(NO_CARRY)
    const exChain = makeChain()
    const setsChain = makeChain()
    fromMock.mockReturnValueOnce(carryChain).mockReturnValueOnce(exChain).mockReturnValueOnce(setsChain)

    const result = await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-old',
      replacementExerciseId: 'ex-new',
      onlyThisWeek: false,
    })

    expect(fetchSwapSourceSlotMock).toHaveBeenCalledWith('pe-old')
    expect(createWeekOnlyProgramExerciseMock).toHaveBeenCalledWith('u1', {
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 2,
      supersetBlockId: 'block-1',
    })

    // Call 1: the current-carry lookup (read before the write, every time).
    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_exercises')
    expect(carryChain.select).toHaveBeenCalledWith('carry_program_exercise_id, carry_position')
    expect(carryChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(carryChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    // Call 2: the exercise row's own update.
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_exercises')
    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-new',
      carry_program_exercise_id: null,
      carry_position: null,
    })
    expect(exChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(exChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    // Call 3: this week's own sets follow the replacement.
    expect(fromMock).toHaveBeenNthCalledWith(3, 'v2_week_plan_sets')
    expect(setsChain.update).toHaveBeenCalledWith({ program_exercise_id: 'pe-new' })
    expect(setsChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(setsChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    expect(result).toEqual({ id: 'pe-new', exerciseId: 'ex-new' })
  })

  it('"only this week", no existing carry: records the pre-swap slot in carry_program_exercise_id', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const exChain = makeChain()
    fromMock.mockReturnValueOnce(makeCarryLookup(NO_CARRY)).mockReturnValueOnce(exChain).mockReturnValueOnce(makeChain())

    await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-old',
      replacementExerciseId: 'ex-new',
      onlyThisWeek: true,
    })

    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-new',
      carry_program_exercise_id: 'pe-old',
      carry_position: null,
    })
  })

  // Orchestration-level proof that this file reads the row's CURRENT carry
  // (via fetchCurrentCarry) and threads it into resolveSwapCarry, rather
  // than recomputing from this swap's own before-state alone (the review's
  // blocking bug — weekEdits.test.ts proves the pure decision; this proves
  // weekPlanService.ts actually wires the read through).
  it('"only this week" with an existing carry keeps the existing carry, not this swap\'s own pre-swap identity', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-w2' })
    const exChain = makeChain()
    // The row already carries 'pe-S' from an earlier only-this-week swap
    // (S swapped to W1); this call is W1 swapped to W2.
    fromMock
      .mockReturnValueOnce(makeCarryLookup({ carryProgramExerciseId: 'pe-S', carryPosition: null }))
      .mockReturnValueOnce(exChain)
      .mockReturnValueOnce(makeChain())

    await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-w1',
      replacementExerciseId: 'ex-new',
      onlyThisWeek: true,
    })

    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-w2',
      carry_program_exercise_id: 'pe-S',
      carry_position: null,
    })
  })

  it('a swap echoes an existing carry_position back unchanged, even when permanent (off)', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const exChain = makeChain()
    // An earlier only-this-week reorder of this same row left carry_position: 2.
    fromMock
      .mockReturnValueOnce(makeCarryLookup({ carryProgramExerciseId: null, carryPosition: 2 }))
      .mockReturnValueOnce(exChain)
      .mockReturnValueOnce(makeChain())

    await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-old',
      replacementExerciseId: 'ex-new',
      onlyThisWeek: false,
    })

    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-new',
      carry_program_exercise_id: null,
      carry_position: 2,
    })
  })
})

describe('addWeekExercise', () => {
  it('creates a week-only slot with no superset block and inserts it into this week at the given position', async () => {
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const insertChain = makeChain()
    fromMock.mockReturnValueOnce(insertChain)

    const result = await addWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 3,
    })

    expect(createWeekOnlyProgramExerciseMock).toHaveBeenCalledWith('u1', {
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 3,
      supersetBlockId: null,
    })
    expect(fromMock).toHaveBeenCalledWith('v2_week_plan_exercises')
    expect(insertChain.insert).toHaveBeenCalledWith({
      user_id: 'u1',
      week_plan_id: 'wp-1',
      program_exercise_id: 'pe-new',
      position: 3,
    })
    expect(result).toEqual({ id: 'pe-new' })
  })
})

describe('removeWeekExercise', () => {
  it('deletes this week\'s own sets for the exercise before deleting the exercise row itself', async () => {
    const setsChain = makeChain()
    const exChain = makeChain()
    fromMock.mockReturnValueOnce(setsChain).mockReturnValueOnce(exChain)

    await removeWeekExercise('wp-1', 'pe-1')

    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_sets')
    expect(setsChain.delete).toHaveBeenCalledTimes(1)
    expect(setsChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(setsChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-1')

    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_exercises')
    expect(exChain.delete).toHaveBeenCalledTimes(1)
    expect(exChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(exChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-1')
  })
})

describe('reorderWeekExercises', () => {
  it('"only this week", no existing carry: writes the new position and the pre-reorder position in carry_position, per row', async () => {
    const chainA = makeChain()
    const chainB = makeChain()
    fromMock
      .mockReturnValueOnce(makeCarryLookup(NO_CARRY))
      .mockReturnValueOnce(chainA)
      .mockReturnValueOnce(makeCarryLookup(NO_CARRY))
      .mockReturnValueOnce(chainB)

    await reorderWeekExercises(
      'wp-1',
      [
        { programExerciseId: 'peA', oldPosition: 0, newPosition: 1 },
        { programExerciseId: 'peB', oldPosition: 1, newPosition: 0 },
      ],
      true,
    )

    expect(chainA.update).toHaveBeenCalledWith({ position: 1, carry_position: 0 })
    expect(chainA.eq).toHaveBeenCalledWith('program_exercise_id', 'peA')
    expect(chainB.update).toHaveBeenCalledWith({ position: 0, carry_position: 1 })
    expect(chainB.eq).toHaveBeenCalledWith('program_exercise_id', 'peB')
  })

  it('permanent (off, the default): carry_position clears to null, even though a position changed', async () => {
    const chainA = makeChain()
    fromMock.mockReturnValueOnce(makeCarryLookup(NO_CARRY)).mockReturnValueOnce(chainA)

    await reorderWeekExercises('wp-1', [{ programExerciseId: 'peA', oldPosition: 0, newPosition: 2 }], false)

    expect(chainA.update).toHaveBeenCalledWith({ position: 2, carry_position: null })
  })

  // Orchestration-level proof, same purpose as swapWeekExercise's own
  // existing-carry test above: this file must read the row's CURRENT
  // carry_position and thread it through resolveReorderCarry rather than
  // recompute from this reorder's own pre-reorder position alone.
  it('"only this week" with an existing carry keeps the existing carry, not this reorder\'s own pre-reorder position', async () => {
    const chainA = makeChain()
    // The row already carries position 0 (the true original) from an
    // earlier only-this-week reorder; this call's own "before" is 2, an
    // already-moved, intermediate position.
    fromMock.mockReturnValueOnce(makeCarryLookup({ carryProgramExerciseId: null, carryPosition: 0 })).mockReturnValueOnce(chainA)

    await reorderWeekExercises('wp-1', [{ programExerciseId: 'peA', oldPosition: 2, newPosition: 3 }], true)

    expect(chainA.update).toHaveBeenCalledWith({ position: 3, carry_position: 0 })
  })
})
