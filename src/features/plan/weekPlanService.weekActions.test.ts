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
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  fetchSwapSourceSlotMock.mockReset()
  createWeekOnlyProgramExerciseMock.mockReset()
})

describe('swapWeekExercise', () => {
  it('creates the replacement from the replaced slot\'s own position/superset block, points this week at it, and moves this week\'s own sets with it', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 2, supersetBlockId: 'block-1' })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new', exerciseId: 'ex-new' })
    const exChain = makeChain()
    const setsChain = makeChain()
    fromMock.mockReturnValueOnce(exChain).mockReturnValueOnce(setsChain)

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

    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_exercises')
    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-new',
      carry_program_exercise_id: null,
      carry_position: null,
    })
    expect(exChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(exChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_sets')
    expect(setsChain.update).toHaveBeenCalledWith({ program_exercise_id: 'pe-new' })
    expect(setsChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(setsChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    expect(result).toEqual({ id: 'pe-new', exerciseId: 'ex-new' })
  })

  it('"only this week" records the pre-swap slot in carry_program_exercise_id', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const exChain = makeChain()
    fromMock.mockReturnValueOnce(exChain).mockReturnValueOnce(makeChain())

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
  it('"only this week": writes the new position and the pre-reorder position in carry_position, per row', async () => {
    const chainA = makeChain()
    const chainB = makeChain()
    fromMock.mockReturnValueOnce(chainA).mockReturnValueOnce(chainB)

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
    fromMock.mockReturnValueOnce(chainA)

    await reorderWeekExercises('wp-1', [{ programExerciseId: 'peA', oldPosition: 0, newPosition: 2 }], false)

    expect(chainA.update).toHaveBeenCalledWith({ position: 2, carry_position: null })
  })
})
