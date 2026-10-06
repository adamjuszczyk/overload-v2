import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked the same way programService.test.ts's own precedent does — the
// real Supabase client throws at import time without env vars, so every
// test here inspects the exact chain this module built instead of a real
// round trip.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))

const {
  fetchRunProgramExercises,
  createWeekOnlyProgramExercise,
  fetchSwapSourceSlot,
  removeRunProgramExercise,
} = await import('./runProgramExercises')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('fetchRunProgramExercises — the program tab\'s list excludes week_only and removed_at rows', () => {
  it('filters week_only = false and removed_at is null, ordered by position', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchRunProgramExercises('wd-1')

    expect(fromMock).toHaveBeenCalledWith('v2_program_exercises')
    expect(chain.eq).toHaveBeenCalledWith('workout_day_id', 'wd-1')
    expect(chain.eq).toHaveBeenCalledWith('week_only', false)
    expect(chain.is).toHaveBeenCalledWith('removed_at', null)
    expect(chain.order).toHaveBeenCalledWith('position', { ascending: true })
  })

  it('maps a row through to ProgramExercise, exercise joined', async () => {
    const row = {
      id: 'pe-1',
      workout_day_id: 'wd-1',
      user_id: 'u1',
      exercise_id: 'ex-1',
      position: 0,
      target_reps: 8,
      weight_unit: 'kg',
      exercises: {
        id: 'ex-1',
        user_id: 'u1',
        name: 'Bench',
        muscle_group: 'chest',
        is_archived: false,
        created_at: '2026-01-01T00:00:00Z',
        muscle_subgroup: null,
        movement_pattern: null,
        status: 'active',
        source_library_id: null,
        lost_at: null,
      },
    }
    const chain = makeChain({ data: [row], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchRunProgramExercises('wd-1')

    expect(result).toEqual([
      {
        id: 'pe-1',
        workoutDayId: 'wd-1',
        userId: 'u1',
        exerciseId: 'ex-1',
        position: 0,
        targetReps: 8,
        weightUnit: 'kg',
        exercise: {
          id: 'ex-1',
          userId: 'u1',
          name: 'Bench',
          muscleGroup: 'chest',
          isArchived: false,
          createdAt: '2026-01-01T00:00:00Z',
          muscleSubgroups: null,
          movementPattern: null,
          status: 'active',
          sourceLibraryId: null,
          lostAt: null,
        },
      },
    ])
  })
})

describe('createWeekOnlyProgramExercise — always week_only = true, fresh target_reps/weight_unit', () => {
  it('writes the slot with week_only: true and null target_reps/weight_unit', async () => {
    const chain = makeChain({
      data: {
        id: 'pe-new',
        workout_day_id: 'wd-1',
        user_id: 'u1',
        exercise_id: 'ex-new',
        position: 2,
        target_reps: null,
        weight_unit: null,
        exercises: null,
      },
      error: null,
    })
    fromMock.mockReturnValue(chain)

    const result = await createWeekOnlyProgramExercise('u1', {
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 2,
      supersetBlockId: 'block-1',
    })

    expect(fromMock).toHaveBeenCalledWith('v2_program_exercises')
    expect(chain.insert).toHaveBeenCalledWith({
      user_id: 'u1',
      workout_day_id: 'wd-1',
      exercise_id: 'ex-new',
      position: 2,
      target_reps: null,
      weight_unit: null,
      superset_block_id: 'block-1',
      week_only: true,
    })
    expect(result.id).toBe('pe-new')
  })
})

describe('fetchSwapSourceSlot — just enough of the replaced slot to build its replacement', () => {
  it('reads workout_day_id, position and superset_block_id only', async () => {
    const chain = makeChain({
      data: { workout_day_id: 'wd-1', position: 3, superset_block_id: 'block-9' },
      error: null,
    })
    fromMock.mockReturnValue(chain)

    const result = await fetchSwapSourceSlot('pe-old')

    expect(chain.select).toHaveBeenCalledWith('workout_day_id, position, superset_block_id')
    expect(chain.eq).toHaveBeenCalledWith('id', 'pe-old')
    expect(result).toEqual({ workoutDayId: 'wd-1', position: 3, supersetBlockId: 'block-9' })
  })
})

describe('removeRunProgramExercise — soft on a run, hard on a saved program', () => {
  it('a run copy\'s row gets removed_at set (soft), never deleted', async () => {
    const lookupChain = makeChain({ data: { workout_day: { program: { kind: 'run' } } }, error: null })
    const updateChain = makeChain({ data: null, error: null })
    fromMock.mockReturnValueOnce(lookupChain).mockReturnValueOnce(updateChain)

    await removeRunProgramExercise('pe-1')

    expect(fromMock).toHaveBeenNthCalledWith(1, 'v2_program_exercises')
    expect(lookupChain.select).toHaveBeenCalledWith('workout_day:v2_workout_days(program:v2_programs(kind))')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v2_program_exercises')
    expect(updateChain.update).toHaveBeenCalledTimes(1)
    const [payload] = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>]
    expect(typeof payload.removed_at).toBe('string')
    expect(updateChain.delete).not.toHaveBeenCalled()
  })

  it('a saved program\'s row is hard-deleted, never soft-removed', async () => {
    const lookupChain = makeChain({ data: { workout_day: { program: { kind: 'saved' } } }, error: null })
    const deleteChain = makeChain({ data: null, error: null })
    fromMock.mockReturnValueOnce(lookupChain).mockReturnValueOnce(deleteChain)

    await removeRunProgramExercise('pe-2')

    expect(deleteChain.delete).toHaveBeenCalledTimes(1)
    expect(deleteChain.update).not.toHaveBeenCalled()
  })
})
