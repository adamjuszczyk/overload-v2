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

const { createExercise, updateExercise } = await import('./exerciseService')

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
