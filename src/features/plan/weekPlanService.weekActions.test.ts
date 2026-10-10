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
    })

    expect(fetchSwapSourceSlotMock).toHaveBeenCalledWith('pe-old')
    expect(createWeekOnlyProgramExerciseMock).toHaveBeenCalledWith('u1', {
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 2,
      supersetBlockId: 'block-1',
    })

    // Call 1: the exercise row's own update.
    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_exercises')
    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-new',
      carry_program_exercise_id: null,
    })
    expect(exChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(exChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    // Call 2: this week's own sets follow the replacement.
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_sets')
    expect(setsChain.update).toHaveBeenCalledWith({ program_exercise_id: 'pe-new' })
    expect(setsChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(setsChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')

    expect(result).toEqual({ id: 'pe-new', exerciseId: 'ex-new' })
  })

  // Chunk 27 (SPEC [P1.1] "'Only this week' is removed"): a swap writes
  // exactly what a permanent edit always wrote. Checked on the payload's KEYS
  // (toHaveBeenCalledWith treats an explicit undefined like a missing key):
  // carry_program_exercise_id is cleared to null, and there is NO
  // carry_position key at all, so an earlier reorder's stored carry_position
  // stays in the row untouched. Break proof: write the pre-swap slot into
  // carry_program_exercise_id (what a ticked swap did) or echo carry_position.
  it('writes a permanent edit: carry_program_exercise_id cleared to null and no carry_position key (a stored carry_position stays untouched)', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const exChain = makeChain()
    fromMock.mockReturnValueOnce(exChain).mockReturnValueOnce(makeChain())

    await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-old',
      replacementExerciseId: 'ex-new',
    })

    const payload = (exChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['carry_program_exercise_id', 'program_exercise_id'])
    expect(payload.carry_program_exercise_id).toBeNull()
    expect('carry_position' in payload).toBe(false)
  })

  // No pre-read of the row's carry any more: nothing in a swap depends on a
  // stored value (the old "existing carry wins" lookup went with the tick).
  // Exactly two table calls go out — the exercise-row update and the sets
  // update — and neither is a select.
  it('reads nothing first: exactly two table calls, the exercise update then the sets update', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const exChain = makeChain()
    const setsChain = makeChain()
    fromMock.mockReturnValueOnce(exChain).mockReturnValueOnce(setsChain)

    await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-old',
      replacementExerciseId: 'ex-new',
    })

    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(exChain.select).not.toHaveBeenCalled()
    expect(setsChain.select).not.toHaveBeenCalled()
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
  it('writes each moved row\'s new position and clears carry_position, one update per row', async () => {
    const chainA = makeChain()
    const chainB = makeChain()
    fromMock.mockReturnValueOnce(chainA).mockReturnValueOnce(chainB)

    await reorderWeekExercises('wp-1', [
      { programExerciseId: 'peA', oldPosition: 0, newPosition: 1 },
      { programExerciseId: 'peB', oldPosition: 1, newPosition: 0 },
    ])

    expect(fromMock).toHaveBeenCalledTimes(2) // no carry lookup before either write
    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_exercises')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_exercises')
    expect(chainA.update).toHaveBeenCalledWith({ position: 1, carry_position: null })
    expect(chainA.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(chainA.eq).toHaveBeenCalledWith('program_exercise_id', 'peA')
    expect(chainB.update).toHaveBeenCalledWith({ position: 0, carry_position: null })
    expect(chainB.eq).toHaveBeenCalledWith('program_exercise_id', 'peB')
    expect(chainA.select).not.toHaveBeenCalled()
    expect(chainB.select).not.toHaveBeenCalled()
  })

  // Chunk 27: a reorder writes exactly what a permanent edit always wrote —
  // carry_position cleared to null (never the row's pre-reorder position, as
  // a ticked reorder wrote), and NO carry_program_exercise_id key, so an
  // earlier swap's stored value stays in the row untouched. Break proof:
  // write oldPosition into carry_position, or add carry_program_exercise_id.
  it('the payload is {position, carry_position: null} only: no carry_program_exercise_id key, and oldPosition is never written', async () => {
    const chainA = makeChain()
    fromMock.mockReturnValueOnce(chainA)

    await reorderWeekExercises('wp-1', [{ programExerciseId: 'peA', oldPosition: 7, newPosition: 2 }])

    const payload = (chainA.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['carry_position', 'position'])
    expect(payload.position).toBe(2)
    expect(payload.carry_position).toBeNull() // not 7, the pre-reorder position
    expect('carry_program_exercise_id' in payload).toBe(false)
  })
})
