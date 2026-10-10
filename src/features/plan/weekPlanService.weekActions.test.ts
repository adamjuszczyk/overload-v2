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

const { swapWeekExercise, repointWeekExercise, addWeekExercise, removeWeekExercise, reorderWeekExercises } = await import(
  './weekPlanService'
)

// `result` is what awaiting the chain gives (an update / delete / insert);
// `singleResult` (default: the same) is what `.single()` gives. They differ
// for a missing row, as in PostgREST: `.single()` errors (PGRST116) while an
// update that matches zero rows succeeds with nothing changed.
function makeChain(
  result: { data?: unknown; error?: unknown } = { data: null, error: null },
  singleResult: { data?: unknown; error?: unknown } = result,
) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(singleResult)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

// The week-row existence check swap and reorder make before they write
// (requireWeekExerciseRow): `.select('id')…single()`. Present = one row; the
// error is what PostgREST returns from .single() when the week has no such
// row (PGRST116) — the failure these actions have always had on a stale
// screen, from the carry lookup they used to make first.
function makeRowPresent() {
  return makeChain({ data: { id: 'wpe-1' }, error: null })
}
const NO_SUCH_ROW = {
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
}
// Only `.single()` errors. If the check were missing and this chain were used
// for an update instead, it would resolve successfully with nothing changed —
// the real database's behaviour, and the silent "success" this guards against.
function makeRowMissing() {
  return makeChain({ data: null, error: null }, { data: null, error: NO_SUCH_ROW })
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
    const checkChain = makeRowPresent()
    const exChain = makeChain()
    const setsChain = makeChain()
    fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(exChain).mockReturnValueOnce(setsChain)

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

    // Call 1: the existence check for the row about to change — id only.
    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_exercises')
    expect(checkChain.select).toHaveBeenCalledWith('id')
    expect(checkChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(checkChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-old')
    expect(checkChain.single).toHaveBeenCalledTimes(1)

    // Call 2: the exercise row's own update.
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_exercises')
    expect(exChain.update).toHaveBeenCalledWith({
      program_exercise_id: 'pe-new',
      carry_program_exercise_id: null,
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
    fromMock.mockReturnValueOnce(makeRowPresent()).mockReturnValueOnce(exChain).mockReturnValueOnce(makeChain())

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

  // The only read a swap makes is the id-only existence check: the carry
  // lookup it used to make (and the "existing carry wins" rule that needed
  // it) went with the tick, and no carry column is selected by anything.
  it('makes exactly three table calls — the id-only existence check, the exercise update, the sets update — and selects no carry column', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const checkChain = makeRowPresent()
    const exChain = makeChain()
    const setsChain = makeChain()
    fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(exChain).mockReturnValueOnce(setsChain)

    await swapWeekExercise({
      userId: 'u1',
      weekPlanId: 'wp-1',
      programExerciseId: 'pe-old',
      replacementExerciseId: 'ex-new',
    })

    expect(fromMock).toHaveBeenCalledTimes(3)
    expect((checkChain.select as ReturnType<typeof vi.fn>).mock.calls).toEqual([['id']])
    expect(exChain.select).not.toHaveBeenCalled()
    expect(setsChain.select).not.toHaveBeenCalled()
  })

  // Master's failure behaviour kept (chunk 27 retry): the swap of a row the
  // week no longer has (a stale screen — another tab removed the exercise)
  // throws BEFORE anything is written. Without the check it would insert a
  // week-only v2_program_exercises row, update zero rows twice and resolve
  // with a "success" whose resulting id no week row points at. Break proof:
  // remove requireWeekExerciseRow from swapWeekExercise.
  it('a row the week no longer has: throws the lookup error and writes nothing — no replacement row created, no update', async () => {
    fetchSwapSourceSlotMock.mockResolvedValue({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null })
    createWeekOnlyProgramExerciseMock.mockResolvedValue({ id: 'pe-new' })
    const checkChain = makeRowMissing()
    // Ordinary chains queued behind the check: if the check were removed the
    // swap would run to the end and RESOLVE (the regression), not crash.
    fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(makeChain()).mockReturnValueOnce(makeChain())

    await expect(
      swapWeekExercise({
        userId: 'u1',
        weekPlanId: 'wp-1',
        programExerciseId: 'pe-gone',
        replacementExerciseId: 'ex-new',
      }),
    ).rejects.toBe(NO_SUCH_ROW)

    expect(createWeekOnlyProgramExerciseMock).not.toHaveBeenCalled() // no orphan week-only exercise
    expect(fromMock).toHaveBeenCalledTimes(1) // the check, then nothing
    expect(checkChain.update).not.toHaveBeenCalled()
    expect(checkChain.insert).not.toHaveBeenCalled()
  })
})

describe('repointWeekExercise (the apply-ahead swap)', () => {
  // Chunk 27 retry: this is the write an applied-ahead swap makes on each
  // later week. It clears carry_program_exercise_id like a swap does — which
  // matters until 037 is replaced by 038, since 037 still honours a stored
  // carry — and sends no carry_position. Break proof: write the old slot
  // into carry_program_exercise_id, or add a carry_position key.
  it('updates the row to the resulting exercise with carry_program_exercise_id cleared (no carry_position key), then moves the week\'s sets', async () => {
    const exChain = makeChain()
    const setsChain = makeChain()
    fromMock.mockReturnValueOnce(exChain).mockReturnValueOnce(setsChain)

    await repointWeekExercise('wp-3', 'pe-from', 'pe-to')

    expect(fromMock).toHaveBeenCalledTimes(2) // no read first
    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_week_plan_exercises')
    const payload = (exChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ program_exercise_id: 'pe-to', carry_program_exercise_id: null })
    expect(Object.keys(payload).sort()).toEqual(['carry_program_exercise_id', 'program_exercise_id'])
    expect(payload.carry_program_exercise_id).toBeNull()
    expect('carry_position' in payload).toBe(false)
    expect(exChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-3')
    expect(exChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-from')

    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_week_plan_sets')
    expect(setsChain.update).toHaveBeenCalledWith({ program_exercise_id: 'pe-to' })
    expect(setsChain.eq).toHaveBeenCalledWith('week_plan_id', 'wp-3')
    expect(setsChain.eq).toHaveBeenCalledWith('program_exercise_id', 'pe-from')
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
  it('confirms every moved row, then writes each one\'s new position and clears carry_position, one update per row', async () => {
    const checkA = makeRowPresent()
    const checkB = makeRowPresent()
    const chainA = makeChain()
    const chainB = makeChain()
    fromMock
      .mockReturnValueOnce(checkA)
      .mockReturnValueOnce(checkB)
      .mockReturnValueOnce(chainA)
      .mockReturnValueOnce(chainB)

    await reorderWeekExercises('wp-1', [
      { programExerciseId: 'peA', oldPosition: 0, newPosition: 1 },
      { programExerciseId: 'peB', oldPosition: 1, newPosition: 0 },
    ])

    // Calls 1-2: the id-only existence checks, both before any update.
    expect(fromMock).toHaveBeenCalledTimes(4)
    for (const n of [1, 2, 3, 4]) expect(fromMock).toHaveBeenNthCalledWith(n, 'v2_week_plan_exercises')
    expect(checkA.select).toHaveBeenCalledWith('id')
    expect(checkA.eq).toHaveBeenCalledWith('week_plan_id', 'wp-1')
    expect(checkA.eq).toHaveBeenCalledWith('program_exercise_id', 'peA')
    expect(checkB.select).toHaveBeenCalledWith('id')
    expect(checkB.eq).toHaveBeenCalledWith('program_exercise_id', 'peB')
    expect(checkA.update).not.toHaveBeenCalled()
    expect(checkB.update).not.toHaveBeenCalled()
    // Calls 3-4: the updates.
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
    fromMock.mockReturnValueOnce(makeRowPresent()).mockReturnValueOnce(chainA)

    await reorderWeekExercises('wp-1', [{ programExerciseId: 'peA', oldPosition: 7, newPosition: 2 }])

    const payload = (chainA.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['carry_position', 'position'])
    expect(payload.position).toBe(2)
    expect(payload.carry_position).toBeNull() // not 7, the pre-reorder position
    expect('carry_program_exercise_id' in payload).toBe(false)
  })

  // Master's failure behaviour kept, and tightened (chunk 27 retry): a moved
  // row the week no longer has makes the reorder throw BEFORE the first
  // update, so a stale screen leaves the week exactly as it was. The first
  // row exists here and the SECOND does not — the case in which writing as it
  // went would already have moved the first. Break proof: remove the
  // existence checks from reorderWeekExercises.
  it('a moved row the week no longer has: throws the lookup error before the first update — nothing is written', async () => {
    const checkA = makeRowPresent()
    const checkB = makeRowMissing()
    const chainA = makeChain()
    const chainB = makeChain()
    fromMock
      .mockReturnValueOnce(checkA)
      .mockReturnValueOnce(checkB)
      .mockReturnValueOnce(chainA)
      .mockReturnValueOnce(chainB)

    await expect(
      reorderWeekExercises('wp-1', [
        { programExerciseId: 'peA', oldPosition: 0, newPosition: 1 },
        { programExerciseId: 'peGone', oldPosition: 1, newPosition: 0 },
      ]),
    ).rejects.toBe(NO_SUCH_ROW)

    expect(fromMock).toHaveBeenCalledTimes(2) // the two checks, nothing after them
    expect(checkA.update).not.toHaveBeenCalled()
    expect(checkB.update).not.toHaveBeenCalled()
    expect(chainA.update).not.toHaveBeenCalled()
    expect(chainB.update).not.toHaveBeenCalled()
  })

  it('no moves: nothing is read or written', async () => {
    await reorderWeekExercises('wp-1', [])
    expect(fromMock).not.toHaveBeenCalled()
  })
})
