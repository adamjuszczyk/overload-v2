import { describe, it, expect, vi, beforeEach } from 'vitest'

// programService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing) — mocked here the same way
// sessionService.test.ts's own precedent does, so fetchSavedPrograms' exact
// filter can be inspected directly rather than inferred.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))

const { fetchPrograms, fetchSavedPrograms, updatePlanningType } = await import('./programService')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

// Chunk 6, TASKS.md — "program lists show kind = 'saved' only". Two
// functions, not one filtered conditionally: fetchSavedPrograms is for
// ProgramPage's own list and its Start Mesocycle picker — the only two
// places a user picks a reusable template from; fetchPrograms stays
// unfiltered for PlanPage/the planner (PlannerPage.tsx), which look a
// program up by a known id that is a run's own copy (kind = 'run') while a
// run is active.
describe('fetchSavedPrograms — filters to kind = \'saved\' at the query', () => {
  it('calls v2_programs with .eq(\'kind\', \'saved\')', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchSavedPrograms()

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.eq).toHaveBeenCalledWith('kind', 'saved')
  })

  it('maps rows to Program the same way fetchPrograms does, with kind carried through', async () => {
    const row = {
      id: 'prog-1',
      user_id: 'user-1',
      name: 'PPL',
      schedule: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      kind: 'saved',
    }
    const chain = makeChain({ data: [row], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchSavedPrograms()

    expect(result[0].kind).toBe('saved')
    expect(result[0].id).toBe('prog-1')
  })
})

describe('fetchPrograms — stays unfiltered (PlanPage/the planner need a run\'s own copy too)', () => {
  it('does not call .eq(\'kind\', ...) at all', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchPrograms()

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('a kind = \'run\' row still maps through (not silently dropped)', async () => {
    const row = {
      id: 'run-copy-1',
      user_id: 'user-1',
      name: 'Upper/Lower',
      schedule: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      kind: 'run',
    }
    const chain = makeChain({ data: [row], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchPrograms()

    expect(result[0].kind).toBe('run')
  })
})

// Chunk 11 (SPEC.md "Stepped program planner" step 3) — the planner's own
// first writer of v2_programs.planning_type.
describe('updatePlanningType', () => {
  it('updates v2_programs by id, writing exactly planning_type (+ updated_at)', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updatePlanningType('prog-1', 'stable')

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ planning_type: 'stable' }),
    )
    expect(chain.eq).toHaveBeenCalledWith('id', 'prog-1')
  })

  it('throws on a Supabase error rather than swallowing it', async () => {
    const chain = makeChain({ data: null, error: new Error('boom') })
    fromMock.mockReturnValue(chain)

    await expect(updatePlanningType('prog-1', 'week_dependent')).rejects.toThrow('boom')
  })
})
