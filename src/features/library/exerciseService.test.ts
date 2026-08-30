import { describe, it, expect, vi, beforeEach } from 'vitest'

// exerciseService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network). Mocked here — every other test in this suite is pure logic with
// no I/O, so this is the first file that needs it. `fromMock` is reassigned
// per test to a fresh chainable builder so each test can inspect exactly
// what payload reached `.update()`/`.insert()`, which is the whole point of
// the don't-blank-on-omit contract this file exists to prove
// (EXERCISE-LIBRARY-TASKS.md §2.6).
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { createExercise, updateExercise, previewExerciseDelete, deleteExercise, restoreExercise } = await import(
  './exerciseService'
)

// A chainable stand-in for supabase-js's query builder. `.insert`/`.update`
// are vi.fn so each test can read `.mock.calls[0][0]` to see the exact
// payload object passed — not just the values it wrote for keys it did
// touch, but which keys it touched at all, which is the part
// `toHaveProperty`/`not.toHaveProperty` below actually verifies.
function makeBuilder(row: Record<string, unknown>) {
  const builder = {
    insert: vi.fn((_payload: Record<string, unknown>) => builder),
    update: vi.fn((_payload: Record<string, unknown>) => builder),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve({ data: row, error: null })),
  }
  return builder
}

const BASE_ROW = {
  id: 'ex-1',
  user_id: 'user-1',
  name: 'Chest Press',
  muscle_group: 'chest',
  is_archived: false,
  created_at: '2026-01-01T00:00:00Z',
  muscle_subgroup: ['mid_chest'],
  movement_pattern: 'isolation',
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('updateExercise — the don\'t-blank-on-omit contract', () => {
  it('omitting muscleSubgroups leaves muscle_subgroup out of the payload entirely (not nulled)', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest', { movementPattern: 'isolation' })

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('muscle_subgroup')
    expect(payload.movement_pattern).toBe('isolation')
  })

  it('omitting movementPattern leaves movement_pattern out of the payload entirely (not nulled)', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest', { muscleSubgroups: ['lower_chest'] })

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('movement_pattern')
    expect(payload.muscle_subgroup).toEqual(['lower_chest'])
  })

  it('an explicit null for muscleSubgroups reaches the payload as null — "untag this axis", not "leave alone"', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest', { muscleSubgroups: null })

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toHaveProperty('muscle_subgroup', null)
  })

  it('an explicit null for movementPattern reaches the payload as null — "untag this axis", not "leave alone"', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest', { movementPattern: null })

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toHaveProperty('movement_pattern', null)
  })

  it('omitted is not the same as explicit null: one axis omitted, the other explicitly cleared, in the same call', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest', { movementPattern: null })

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('muscle_subgroup')
    expect(payload).toHaveProperty('movement_pattern', null)
  })

  it('calling with no tags argument at all — every pre-existing caller\'s exact shape — touches neither tag column', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest')

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('muscle_subgroup')
    expect(payload).not.toHaveProperty('movement_pattern')
    expect(payload).toEqual({ name: 'Chest Press', muscle_group: 'chest' })
  })

  it('resending both axes together (ExerciseForm.tsx\'s shape) writes both, independently of each other', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await updateExercise('ex-1', 'Chest Press', 'chest', {
      muscleSubgroups: ['upper_chest', 'front_delt'],
      movementPattern: 'horizontal_push',
    })

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.muscle_subgroup).toEqual(['upper_chest', 'front_delt'])
    expect(payload.movement_pattern).toBe('horizontal_push')
  })

  it('the resolved row round-trips through toExercise() with tags intact', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    const result = await updateExercise('ex-1', 'Chest Press', 'chest', { movementPattern: 'isolation' })

    expect(result.muscleSubgroups).toEqual(['mid_chest'])
    expect(result.movementPattern).toBe('isolation')
  })
})

describe('createExercise — no omit-vs-null distinction (a fresh insert has nothing to leave untouched)', () => {
  it('omitting tags entirely writes both tag columns as null', async () => {
    const builder = makeBuilder({ ...BASE_ROW, muscle_subgroup: null, movement_pattern: null })
    fromMock.mockReturnValue(builder)

    await createExercise('user-1', 'Chest Press', 'chest')

    const payload = builder.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.muscle_subgroup).toBeNull()
    expect(payload.movement_pattern).toBeNull()
  })

  it('omitting just one axis writes that axis as null too — unlike updateExercise, omission is not preserved', async () => {
    const builder = makeBuilder({ ...BASE_ROW, muscle_subgroup: ['abs'], movement_pattern: null })
    fromMock.mockReturnValue(builder)

    await createExercise('user-1', 'Chest Press', 'chest', { muscleSubgroups: ['abs'] })

    const payload = builder.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.muscle_subgroup).toEqual(['abs'])
    expect(payload.movement_pattern).toBeNull()
  })

  it('both axes provided write both plainly', async () => {
    const builder = makeBuilder(BASE_ROW)
    fromMock.mockReturnValue(builder)

    await createExercise('user-1', 'Chest Press', 'chest', {
      muscleSubgroups: ['mid_chest'],
      movementPattern: 'isolation',
    })

    const payload = builder.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.muscle_subgroup).toEqual(['mid_chest'])
    expect(payload.movement_pattern).toBe('isolation')
  })
})

// ─── previewExerciseDelete / deleteExercise / restoreExercise ──────────────
// (EXERCISE-LIBRARY-TASKS.md §8 step 7, tests added retroactively per §8
// step 8's Part 1a). These three touch three different tables in a single
// call (v2_set_logs, v2_program_exercises, exercises), unlike
// updateExercise/createExercise's single-table shape above, so `fromMock`
// is dispatched per-table rather than reassigned to one fixed builder.

// Every chain method returns the same object, and the object itself is
// thenable (real supabase-js query builders are too), so `await
// supabase.from(...).eq(...)` resolves without a trailing `.single()` —
// none of these three functions' queries use one.
function makeChain(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

describe('previewExerciseDelete', () => {
  it('zero-history exercise: outcome "gone", and the program-template lookup fires and dedupes names', async () => {
    const setLogsChain = makeChain({ count: 0, error: null })
    const programsChain = makeChain({
      error: null,
      data: [
        { workout_day: { program: { name: 'Push Pull Legs' } } },
        { workout_day: { program: { name: 'Push Pull Legs' } } },
        { workout_day: { program: { name: 'Old Program' } } },
      ],
    })
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_set_logs') return setLogsChain
      if (table === 'v2_program_exercises') return programsChain
      throw new Error(`unexpected table ${table}`)
    })

    const result = await previewExerciseDelete('ex-1')

    expect(result.outcome).toBe('gone')
    expect(result.setCount).toBe(0)
    expect(result.programNames).toEqual(['Push Pull Legs', 'Old Program'])
    expect(programsChain.eq).toHaveBeenCalledWith('exercise_id', 'ex-1')
  })

  it('zero-history exercise not listed in any program: programNames is empty, not skipped', async () => {
    const setLogsChain = makeChain({ count: 0, error: null })
    const programsChain = makeChain({ error: null, data: [] })
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_set_logs') return setLogsChain
      if (table === 'v2_program_exercises') return programsChain
      throw new Error(`unexpected table ${table}`)
    })

    const result = await previewExerciseDelete('ex-1')

    expect(result.outcome).toBe('gone')
    expect(result.programNames).toEqual([])
  })

  it('has-history exercise: outcome "lost", and the program lookup never fires — it only matters on the hard-delete branch', async () => {
    const setLogsChain = makeChain({ count: 12, error: null })
    const programsChain = makeChain({ error: null, data: [] })
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_set_logs') return setLogsChain
      if (table === 'v2_program_exercises') return programsChain
      throw new Error(`unexpected table ${table}`)
    })

    const result = await previewExerciseDelete('ex-1')

    expect(result.outcome).toBe('lost')
    expect(result.setCount).toBe(12)
    expect(result.programNames).toEqual([])
    expect(programsChain.select).not.toHaveBeenCalled()
  })
})

describe('deleteExercise', () => {
  it('zero-history path: clears referencing v2_program_exercises rows before hard-deleting the exercise — not just "doesn\'t throw"', async () => {
    const setLogsChain = makeChain({ count: 0, error: null })
    const programsChain = makeChain({ error: null, data: [] }) // previewExerciseDelete's own lookup, then the clear-refs delete
    const exercisesChain = makeChain({ error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_set_logs') return setLogsChain
      if (table === 'v2_program_exercises') return programsChain
      if (table === 'exercises') return exercisesChain
      throw new Error(`unexpected table ${table}`)
    })

    const outcome = await deleteExercise('ex-1')

    expect(outcome).toBe('gone')
    // The actual reference-clearing call, not merely "no error was thrown":
    expect(programsChain.delete).toHaveBeenCalledTimes(1)
    expect(programsChain.eq).toHaveBeenCalledWith('exercise_id', 'ex-1')
    expect(exercisesChain.delete).toHaveBeenCalledTimes(1)
    expect(exercisesChain.eq).toHaveBeenCalledWith('id', 'ex-1')
    // Program references must be cleared before the exercise row itself is
    // deleted (the NO ACTION FK this delete depends on) — enforced order,
    // not incidental.
    const programDeleteOrder = (programsChain.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const exerciseDeleteOrder = (exercisesChain.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(programDeleteOrder).toBeLessThan(exerciseDeleteOrder)
  })

  it('has-history path: moves the exercise to lost, touches neither v2_program_exercises nor a hard delete', async () => {
    const setLogsChain = makeChain({ count: 3, error: null })
    const programsChain = makeChain({ error: null })
    const exercisesChain = makeChain({ error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_set_logs') return setLogsChain
      if (table === 'v2_program_exercises') return programsChain
      if (table === 'exercises') return exercisesChain
      throw new Error(`unexpected table ${table}`)
    })

    const outcome = await deleteExercise('ex-1')

    expect(outcome).toBe('lost')
    expect(programsChain.delete).not.toHaveBeenCalled()
    expect(exercisesChain.delete).not.toHaveBeenCalled()
    expect(exercisesChain.update).toHaveBeenCalledTimes(1)
    const payload = (exercisesChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload.status).toBe('lost')
    expect(typeof payload.lost_at).toBe('string')
    expect(exercisesChain.eq).toHaveBeenCalledWith('id', 'ex-1')
  })
})

describe('restoreExercise', () => {
  it('lost → active transition: status back to active, lost_at cleared', async () => {
    const exercisesChain = makeChain({ error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'exercises') return exercisesChain
      throw new Error(`unexpected table ${table}`)
    })

    await restoreExercise('ex-1')

    expect(exercisesChain.update).toHaveBeenCalledWith({ status: 'active', lost_at: null })
    expect(exercisesChain.eq).toHaveBeenCalledWith('id', 'ex-1')
  })
})
